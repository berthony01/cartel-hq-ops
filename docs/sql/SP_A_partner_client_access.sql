-- SP-A: Managed Client Access for Service Partners.
-- STAGED ONLY. NOT APPLIED. Apply only after explicit owner approval (CP-SPA-SQL),
-- following docs/SP_A_MANAGED_CLIENT_ACCESS_RUNBOOK.md.
--
-- Design invariants:
--  * Separate relation. Service Partners are NEVER added to workspace_members;
--    is_workspace_member / is_workspace_operator / can_use_project_tools and every
--    existing RLS policy are unchanged, so a partner gains zero implicit access.
--  * Owner-authorized (workspaces.owner_id), partner-accepted, owner-revocable,
--    scope-limited. Revoke/decline only change status; no row is ever deleted.
--  * Access requires: row active + scope granted + partner approved + Service
--    Partner + an active terms row with Service Partner track open. Suspension or
--    closing the track removes access immediately.
--  * Only the project_identity scope is enforced end-to-end in SP-A. The other
--    scopes are stored for SP-B and grant nothing.
--  * Denied regardless of scope: billing/subscription, workspace ownership,
--    wallet/treasury/private keys, chain deployment/launch execution, platform admin.
--    No SP-A function touches those surfaces.
--  * No direct INSERT/UPDATE/DELETE grant to authenticated; writes go through RPCs.
--  * Emails are resolved only inside the owner-only invite RPC and never returned.

CREATE TABLE public.partner_client_access (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
  partner_id uuid NOT NULL REFERENCES public.partners(id) ON DELETE RESTRICT,
  partner_user_id uuid NOT NULL,
  status text NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'active', 'declined', 'revoked')),
  scopes text[] NOT NULL DEFAULT '{}'::text[]
    CHECK (scopes <@ ARRAY['community_management','broadcasts','launch_watcher_comms','sticker_tools','missions','project_inbox','project_identity']::text[]),
  invited_by uuid NOT NULL,
  invited_at timestamptz NOT NULL DEFAULT now(),
  responded_at timestamptz,
  revoked_at timestamptz,
  revoked_by uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX partner_client_access_one_open
  ON public.partner_client_access (workspace_id, partner_id)
  WHERE status IN ('pending', 'active');
CREATE INDEX partner_client_access_partner_user_idx
  ON public.partner_client_access (partner_user_id, status);

REVOKE ALL ON public.partner_client_access FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.partner_client_access TO authenticated;
GRANT ALL ON public.partner_client_access TO service_role;

ALTER TABLE public.partner_client_access ENABLE ROW LEVEL SECURITY;

CREATE POLICY partner_client_access_select_owner_or_partner
  ON public.partner_client_access FOR SELECT TO authenticated
  USING (
    partner_user_id = (SELECT auth.uid())
    OR EXISTS (
      SELECT 1 FROM public.workspaces w
      WHERE w.id = partner_client_access.workspace_id AND w.owner_id = (SELECT auth.uid())
    )
  );

CREATE OR REPLACE FUNCTION public.partner_client_access_touch()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO ''
AS $$
BEGIN
  NEW.updated_at := now();
  RETURN NEW;
END
$$;

CREATE TRIGGER partner_client_access_set_updated_at
  BEFORE UPDATE ON public.partner_client_access
  FOR EACH ROW EXECUTE FUNCTION public.partner_client_access_touch();

-- Internal: is this partner currently eligible to hold client access?
CREATE OR REPLACE FUNCTION public.partner_client_access_eligible(_partner_id uuid)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.partners p
    WHERE p.id = _partner_id AND p.status = 'approved' AND p.is_service_partner = true
  ) AND EXISTS (
    SELECT 1 FROM public.partner_program_terms t
    WHERE t.status = 'active' AND t.service_partner_applications_open = true
  );
$$;

-- Caller-only scope check (no user parameter: cannot probe other users).
CREATE OR REPLACE FUNCTION public.partner_has_scope(_workspace_id uuid, _scope text)
 RETURNS boolean
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $$
DECLARE
  _uid uuid := auth.uid();
BEGIN
  IF _uid IS NULL OR _workspace_id IS NULL OR _scope IS NULL THEN
    RETURN false;
  END IF;
  RETURN EXISTS (
    SELECT 1 FROM public.partner_client_access a
    WHERE a.workspace_id = _workspace_id
      AND a.partner_user_id = _uid
      AND a.status = 'active'
      AND _scope = ANY (a.scopes)
      AND public.partner_client_access_eligible(a.partner_id)
  );
END
$$;

CREATE OR REPLACE FUNCTION public.partner_client_scopes_valid(_scopes text[])
 RETURNS boolean
 LANGUAGE sql
 IMMUTABLE
 SET search_path TO ''
AS $$
  SELECT _scopes IS NOT NULL
    AND array_position(_scopes, NULL) IS NULL
    AND _scopes <@ ARRAY['community_management','broadcasts','launch_watcher_comms','sticker_tools','missions','project_inbox','project_identity']::text[];
$$;

-- Owner invites an approved, active Service Partner by sign-in email.
CREATE OR REPLACE FUNCTION public.owner_invite_service_partner(_workspace_id uuid, _partner_email text, _scopes text[])
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $$
DECLARE
  _uid uuid := auth.uid();
  _partner_id uuid;
  _partner_user uuid;
  _id uuid;
BEGIN
  IF _uid IS NULL THEN RAISE EXCEPTION 'AUTH_REQUIRED'; END IF;
  IF NOT EXISTS (SELECT 1 FROM public.workspaces w WHERE w.id = _workspace_id AND w.owner_id = _uid) THEN
    RAISE EXCEPTION 'WORKSPACE_OWNER_REQUIRED';
  END IF;
  IF NOT public.partner_client_scopes_valid(_scopes) THEN RAISE EXCEPTION 'INVALID_SCOPES'; END IF;
  IF _partner_email IS NULL OR char_length(btrim(_partner_email)) NOT BETWEEN 3 AND 320 THEN
    RAISE EXCEPTION 'SERVICE_PARTNER_NOT_AVAILABLE';
  END IF;

  SELECT p.id, p.user_id INTO _partner_id, _partner_user
  FROM auth.users u
  JOIN public.partners p ON p.user_id = u.id
  WHERE lower(u.email) = lower(btrim(_partner_email))
  LIMIT 1;

  IF _partner_id IS NULL OR _partner_user = _uid OR NOT public.partner_client_access_eligible(_partner_id) THEN
    RAISE EXCEPTION 'SERVICE_PARTNER_NOT_AVAILABLE';
  END IF;

  BEGIN
    INSERT INTO public.partner_client_access (workspace_id, partner_id, partner_user_id, status, scopes, invited_by)
    VALUES (_workspace_id, _partner_id, _partner_user, 'pending', ARRAY(SELECT DISTINCT unnest(_scopes)), _uid)
    RETURNING id INTO _id;
  EXCEPTION WHEN unique_violation THEN
    RAISE EXCEPTION 'ACCESS_ALREADY_EXISTS';
  END;
  RETURN _id;
END
$$;

-- Invited partner accepts or declines a pending invitation.
CREATE OR REPLACE FUNCTION public.partner_respond_client_invite(_access_id uuid, _accept boolean)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $$
DECLARE
  _uid uuid := auth.uid();
  _row public.partner_client_access%ROWTYPE;
BEGIN
  IF _uid IS NULL THEN RAISE EXCEPTION 'AUTH_REQUIRED'; END IF;
  SELECT * INTO _row FROM public.partner_client_access
  WHERE id = _access_id AND partner_user_id = _uid AND status = 'pending'
  FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'INVITE_NOT_FOUND'; END IF;
  IF _accept IS TRUE THEN
    IF NOT public.partner_client_access_eligible(_row.partner_id) THEN
      RAISE EXCEPTION 'SERVICE_PARTNER_NOT_AVAILABLE';
    END IF;
    UPDATE public.partner_client_access SET status = 'active', responded_at = now() WHERE id = _access_id;
  ELSE
    UPDATE public.partner_client_access SET status = 'declined', responded_at = now() WHERE id = _access_id;
  END IF;
END
$$;

-- Owner revokes immediately. Touches only this access row.
CREATE OR REPLACE FUNCTION public.owner_revoke_service_partner(_access_id uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $$
DECLARE
  _uid uuid := auth.uid();
BEGIN
  IF _uid IS NULL THEN RAISE EXCEPTION 'AUTH_REQUIRED'; END IF;
  UPDATE public.partner_client_access a
  SET status = 'revoked', revoked_at = now(), revoked_by = _uid
  FROM public.workspaces w
  WHERE a.id = _access_id AND w.id = a.workspace_id AND w.owner_id = _uid
    AND a.status IN ('pending', 'active');
  IF NOT FOUND THEN RAISE EXCEPTION 'ACCESS_NOT_FOUND'; END IF;
END
$$;

-- Owner edits scopes on a pending or active grant.
CREATE OR REPLACE FUNCTION public.owner_update_partner_scopes(_access_id uuid, _scopes text[])
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $$
DECLARE
  _uid uuid := auth.uid();
BEGIN
  IF _uid IS NULL THEN RAISE EXCEPTION 'AUTH_REQUIRED'; END IF;
  IF NOT public.partner_client_scopes_valid(_scopes) THEN RAISE EXCEPTION 'INVALID_SCOPES'; END IF;
  UPDATE public.partner_client_access a
  SET scopes = ARRAY(SELECT DISTINCT unnest(_scopes))
  FROM public.workspaces w
  WHERE a.id = _access_id AND w.id = a.workspace_id AND w.owner_id = _uid
    AND a.status IN ('pending', 'active');
  IF NOT FOUND THEN RAISE EXCEPTION 'ACCESS_NOT_FOUND'; END IF;
END
$$;

-- Partner: active, currently eligible managed projects only.
CREATE OR REPLACE FUNCTION public.list_my_managed_workspaces()
 RETURNS TABLE (access_id uuid, workspace_id uuid, workspace_name text, scopes text[], created_at timestamptz)
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $$
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'AUTH_REQUIRED'; END IF;
  RETURN QUERY
  SELECT a.id, w.id, w.name, a.scopes, w.created_at
  FROM public.partner_client_access a
  JOIN public.workspaces w ON w.id = a.workspace_id
  WHERE a.partner_user_id = auth.uid() AND a.status = 'active'
    AND public.partner_client_access_eligible(a.partner_id)
  ORDER BY w.name;
END
$$;

-- Partner: pending invitations addressed to the caller.
CREATE OR REPLACE FUNCTION public.list_my_partner_invites()
 RETURNS TABLE (access_id uuid, workspace_name text, scopes text[], invited_at timestamptz)
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $$
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'AUTH_REQUIRED'; END IF;
  RETURN QUERY
  SELECT a.id, w.name, a.scopes, a.invited_at
  FROM public.partner_client_access a
  JOIN public.workspaces w ON w.id = a.workspace_id
  WHERE a.partner_user_id = auth.uid() AND a.status = 'pending'
  ORDER BY a.invited_at DESC;
END
$$;

-- Owner: access history for one owned workspace. No email or personal data.
CREATE OR REPLACE FUNCTION public.owner_list_partner_access(_workspace_id uuid)
 RETURNS TABLE (access_id uuid, partner_reference text, status text, scopes text[], invited_at timestamptz, responded_at timestamptz, revoked_at timestamptz)
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $$
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'AUTH_REQUIRED'; END IF;
  IF NOT EXISTS (SELECT 1 FROM public.workspaces w WHERE w.id = _workspace_id AND w.owner_id = auth.uid()) THEN
    RAISE EXCEPTION 'WORKSPACE_OWNER_REQUIRED';
  END IF;
  RETURN QUERY
  SELECT a.id, 'SP-' || upper(left(replace(a.partner_id::text, '-', ''), 8)), a.status, a.scopes, a.invited_at, a.responded_at, a.revoked_at
  FROM public.partner_client_access a
  WHERE a.workspace_id = _workspace_id
  ORDER BY a.invited_at DESC;
END
$$;

-- project_identity scope: read the permitted profile fields.
CREATE OR REPLACE FUNCTION public.partner_get_project_profile(_workspace_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $$
DECLARE
  _r jsonb;
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'AUTH_REQUIRED'; END IF;
  IF NOT public.partner_has_scope(_workspace_id, 'project_identity') THEN
    RAISE EXCEPTION 'PARTNER_SCOPE_REQUIRED';
  END IF;
  SELECT jsonb_build_object(
    'project_name', p.project_name, 'ticker', p.ticker, 'primary_chain', p.primary_chain,
    'tagline', p.tagline, 'description', p.description, 'website_url', p.website_url,
    'telegram_url', p.telegram_url, 'x_url', p.x_url, 'discovery_status', p.discovery_status,
    'updated_at', p.updated_at)
  INTO _r
  FROM public.project_profiles p WHERE p.workspace_id = _workspace_id;
  RETURN _r;
END
$$;

-- project_identity scope: update ONLY these fields. No slug, discovery status,
-- logo, verification, or profile creation.
CREATE OR REPLACE FUNCTION public.partner_update_project_profile(
  _workspace_id uuid, _project_name text, _ticker text, _primary_chain text, _tagline text,
  _description text, _website_url text, _telegram_url text, _x_url text)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $$
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'AUTH_REQUIRED'; END IF;
  IF NOT public.partner_has_scope(_workspace_id, 'project_identity') THEN
    RAISE EXCEPTION 'PARTNER_SCOPE_REQUIRED';
  END IF;
  IF (_website_url IS NOT NULL AND btrim(_website_url) <> '' AND btrim(_website_url) !~* '^https://')
     OR (_telegram_url IS NOT NULL AND btrim(_telegram_url) <> '' AND btrim(_telegram_url) !~* '^https://')
     OR (_x_url IS NOT NULL AND btrim(_x_url) <> '' AND btrim(_x_url) !~* '^https://') THEN
    RAISE EXCEPTION 'INVALID_URL';
  END IF;
  IF _tagline IS NOT NULL AND char_length(btrim(_tagline)) > 140 THEN RAISE EXCEPTION 'TAGLINE_TOO_LONG'; END IF;
  UPDATE public.project_profiles SET
    project_name = btrim(_project_name),
    ticker = nullif(btrim(_ticker), ''),
    primary_chain = nullif(btrim(_primary_chain), ''),
    tagline = nullif(btrim(_tagline), ''),
    description = nullif(btrim(_description), ''),
    website_url = nullif(btrim(_website_url), ''),
    telegram_url = nullif(btrim(_telegram_url), ''),
    x_url = nullif(btrim(_x_url), '')
  WHERE workspace_id = _workspace_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'PROJECT_PROFILE_NOT_FOUND'; END IF;
END
$$;

-- Execute grants: authenticated + service_role only. Internal helpers: service_role only.
REVOKE ALL ON FUNCTION public.partner_client_access_touch() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.partner_client_access_eligible(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.partner_client_access_eligible(uuid) TO service_role;
REVOKE ALL ON FUNCTION public.partner_client_scopes_valid(text[]) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.partner_client_scopes_valid(text[]) TO service_role;

REVOKE ALL ON FUNCTION public.partner_has_scope(uuid, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.partner_has_scope(uuid, text) TO authenticated, service_role;
REVOKE ALL ON FUNCTION public.owner_invite_service_partner(uuid, text, text[]) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.owner_invite_service_partner(uuid, text, text[]) TO authenticated, service_role;
REVOKE ALL ON FUNCTION public.partner_respond_client_invite(uuid, boolean) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.partner_respond_client_invite(uuid, boolean) TO authenticated, service_role;
REVOKE ALL ON FUNCTION public.owner_revoke_service_partner(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.owner_revoke_service_partner(uuid) TO authenticated, service_role;
REVOKE ALL ON FUNCTION public.owner_update_partner_scopes(uuid, text[]) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.owner_update_partner_scopes(uuid, text[]) TO authenticated, service_role;
REVOKE ALL ON FUNCTION public.list_my_managed_workspaces() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.list_my_managed_workspaces() TO authenticated, service_role;
REVOKE ALL ON FUNCTION public.list_my_partner_invites() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.list_my_partner_invites() TO authenticated, service_role;
REVOKE ALL ON FUNCTION public.owner_list_partner_access(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.owner_list_partner_access(uuid) TO authenticated, service_role;
REVOKE ALL ON FUNCTION public.partner_get_project_profile(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.partner_get_project_profile(uuid) TO authenticated, service_role;
REVOKE ALL ON FUNCTION public.partner_update_project_profile(uuid, text, text, text, text, text, text, text, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.partner_update_project_profile(uuid, text, text, text, text, text, text, text, text) TO authenticated, service_role;
