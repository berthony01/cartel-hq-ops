-- SP-B3 V1 — Service Partner community group broadcasts (plain text only).
-- STAGED ONLY. NOT APPLIED. Apply only under CP-SPB3-SQL.
--
-- Activates the stored partner scope `broadcasts` through least-privilege wrappers.
-- The Telegram send itself stays in the EXISTING Edge action
-- `telegram-group` / send_group_announcement (ledger, idempotency, verifyGroup,
-- single transport call). This file adds NO send engine, NO table, NO column,
-- NO RLS policy, NO trigger, NO membership/operator change and NO DML grant.
--
-- A) project_identity_ready(uuid): internal service_role-only core holding the
--    exact minimum Project Identity predicate previously inlined in
--    can_use_project_tools. can_use_project_tools now calls it; every other line,
--    its signature, owner, SECURITY DEFINER, search_path and ACL are unchanged.
-- B) partner_list_broadcast_groups / partner_list_group_broadcasts /
--    partner_authorize_group_broadcast: authenticated partner RPCs, scope first.
--
-- Community broadcasts are announcement_kind = 'OPERATOR_TEXT' (column default,
-- verified live). Official-contract / correction kinds are never returned.
--
-- Rollback: DROP the three partner functions; re-apply the pre-SP-B3
-- can_use_project_tools body (inline EXISTS predicate, captured in the runbook);
-- DROP FUNCTION public.project_identity_ready(uuid).

BEGIN;

-- A) Internal Project Identity core -------------------------------------------
CREATE OR REPLACE FUNCTION public.project_identity_ready(_workspace_id uuid)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
  -- Minimum Project Identity ONLY: non-empty project_name plus a public_slug
  -- matching the canonical project_profiles_public_slug_format contract.
  SELECT _workspace_id IS NOT NULL AND EXISTS (
    SELECT 1
    FROM public.project_profiles p
    WHERE p.workspace_id = _workspace_id
      AND char_length(btrim(p.project_name)) >= 1
      AND char_length(p.public_slug) >= 2
      AND char_length(p.public_slug) <= 64
      AND p.public_slug ~ '^[a-z0-9]+(?:-[a-z0-9]+)*$'
  );
$function$;

REVOKE ALL ON FUNCTION public.project_identity_ready(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.project_identity_ready(uuid) TO service_role;

CREATE OR REPLACE FUNCTION public.can_use_project_tools(_workspace_id uuid, _user_id uuid DEFAULT auth.uid())
 RETURNS boolean
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  _caller uuid := auth.uid();
  _effective uuid := COALESCE(_user_id, auth.uid());
BEGIN
  -- Project Identity Gate A. Workspace-scoped, never user-global.
  IF _workspace_id IS NULL OR _effective IS NULL THEN
    RETURN false;
  END IF;

  -- An authenticated direct caller may only ever test itself.
  IF _caller IS NOT NULL AND _user_id IS NOT NULL AND _user_id <> _caller THEN
    RETURN false;
  END IF;

  -- Platform owner / unrestricted access bypasses the product gate BEFORE any
  -- profile requirement is evaluated. No email literal anywhere.
  IF public.has_platform_unrestricted_access(_effective) THEN
    RETURN true;
  END IF;

  IF NOT public.is_workspace_member(_workspace_id, _effective) THEN
    RETURN false;
  END IF;

  -- Minimum Project Identity ONLY (SP-B3: single shared core, same predicate).
  RETURN public.project_identity_ready(_workspace_id);
END;
$function$;

-- B1) Safe group list ---------------------------------------------------------
CREATE OR REPLACE FUNCTION public.partner_list_broadcast_groups(_workspace_id uuid)
 RETURNS TABLE(group_connection_id uuid, title text, chat_type text, bot_is_admin boolean, operational boolean, verified_at timestamptz)
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
BEGIN
  IF auth.uid() IS NULL OR _workspace_id IS NULL
     OR NOT public.partner_has_scope(_workspace_id, 'broadcasts') THEN
    RAISE EXCEPTION 'Not authorized' USING ERRCODE = '42501';
  END IF;
  -- No telegram_chat_id, username, member count, raw metadata or connector ids.
  RETURN QUERY
  SELECT g.id, g.title, g.chat_type, g.bot_is_admin,
         (g.bot_is_admin IS TRUE
           AND coalesce(g.metadata ->> 'last_member_status', '') NOT IN ('left', 'kicked')
           AND coalesce((g.metadata ->> 'bot_can_change_info')::boolean, true)) AS operational,
         g.verified_at
  FROM public.telegram_group_connections g
  WHERE g.workspace_id = _workspace_id
  ORDER BY g.connected_at DESC NULLS LAST, g.id;
END;
$function$;

-- B2) Safe COMMUNITY broadcast history ---------------------------------------
CREATE OR REPLACE FUNCTION public.partner_list_group_broadcasts(_workspace_id uuid, _limit integer DEFAULT 10)
 RETURNS TABLE(announcement_id uuid, group_title text, message_text text, status text, delivery_kind text, requested_at timestamptz, sent_at timestamptz, actor_kind text)
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
DECLARE
  v_uid uuid := auth.uid();
  v_limit integer := least(greatest(coalesce(_limit, 10), 1), 20);
BEGIN
  IF v_uid IS NULL OR _workspace_id IS NULL
     OR NOT public.partner_has_scope(_workspace_id, 'broadcasts') THEN
    RAISE EXCEPTION 'Not authorized' USING ERRCODE = '42501';
  END IF;
  -- No telegram_chat_id, telegram_message_id, requested_by, launch/contract/CTA/branding fields.
  RETURN QUERY
  SELECT a.id, a.group_title, a.message_text,
         CASE WHEN a.status = 'SENDING' THEN 'AMBIGUOUS' ELSE a.status END,
         a.delivery_kind, a.requested_at, a.sent_at,
         CASE
           WHEN a.requested_by = v_uid THEN 'you'
           WHEN EXISTS (SELECT 1 FROM public.workspace_members m
                         WHERE m.workspace_id = _workspace_id AND m.user_id = a.requested_by) THEN 'project_team'
           ELSE 'service_partner'
         END
  FROM public.telegram_group_announcements a
  WHERE a.workspace_id = _workspace_id
    AND a.announcement_kind = 'OPERATOR_TEXT'
  ORDER BY a.requested_at DESC, a.id
  LIMIT v_limit;
END;
$function$;

-- B3) Send authorization (called by telegram-group with the PARTNER's JWT) ---
CREATE OR REPLACE FUNCTION public.partner_authorize_group_broadcast(_workspace_id uuid, _group_connection_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
DECLARE
  v_uid uuid := auth.uid();
  v_eval jsonb;
  v_reason text;
  v_base jsonb := jsonb_build_object(
    'allowed', false, 'reason', NULL, 'mode', NULL, 'would_block', false,
    'plan_code', NULL, 'plan_version', NULL, 'feature_key', 'official_broadcasts',
    'kind', NULL, 'enabled', NULL, 'used', NULL, 'limit', NULL, 'period', NULL,
    'period_start', NULL, 'period_end', NULL, 'assignment_status', NULL, 'enforcement_mode', NULL);
BEGIN
  -- 1. Scope FIRST.
  IF v_uid IS NULL OR _workspace_id IS NULL
     OR NOT public.partner_has_scope(_workspace_id, 'broadcasts') THEN
    RAISE EXCEPTION 'Not authorized' USING ERRCODE = '42501';
  END IF;
  -- 2. Target group must belong to the client workspace.
  IF _group_connection_id IS NULL OR NOT EXISTS (
    SELECT 1 FROM public.telegram_group_connections g
    WHERE g.id = _group_connection_id AND g.workspace_id = _workspace_id) THEN
    RETURN jsonb_build_object('allowed', false, 'code', 'GROUP_NOT_FOUND');
  END IF;
  -- 3. Client Project Identity through the one shared core. No partner bypass.
  IF NOT public.project_identity_ready(_workspace_id) THEN
    RETURN jsonb_build_object('allowed', false, 'code', 'PROJECT_IDENTITY_REQUIRED');
  END IF;
  -- 4. CLIENT workspace entitlement through the SP-B0 core. No owner/unrestricted bypass.
  v_eval := public.commercial_evaluate_workspace_feature(_workspace_id, 'official_broadcasts', v_base);
  IF v_eval IS NULL OR jsonb_typeof(v_eval -> 'allowed') IS DISTINCT FROM 'boolean' THEN
    RETURN jsonb_build_object('allowed', false, 'code', 'COMMERCIAL_ACCESS_UNAVAILABLE');
  END IF;
  IF (v_eval ->> 'allowed')::boolean THEN
    RETURN jsonb_build_object('allowed', true, 'code', NULL);
  END IF;
  v_reason := coalesce(v_eval ->> 'reason', '');
  RETURN jsonb_build_object('allowed', false, 'code',
    CASE
      WHEN v_reason = 'PLAN_LIMIT_REACHED' THEN 'PLAN_LIMIT_REACHED'
      WHEN v_reason = 'FEATURE_NOT_INCLUDED' THEN 'FEATURE_NOT_INCLUDED'
      WHEN v_reason LIKE 'ASSIGNMENT\_%' THEN 'PLAN_ACCESS_INACTIVE'
      ELSE 'COMMERCIAL_ACCESS_DENIED'
    END);
END;
$function$;

REVOKE ALL ON FUNCTION public.partner_list_broadcast_groups(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.partner_list_broadcast_groups(uuid) TO authenticated, service_role;
REVOKE ALL ON FUNCTION public.partner_list_group_broadcasts(uuid, integer) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.partner_list_group_broadcasts(uuid, integer) TO authenticated, service_role;
REVOKE ALL ON FUNCTION public.partner_authorize_group_broadcast(uuid, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.partner_authorize_group_broadcast(uuid, uuid) TO authenticated, service_role;

COMMIT;
