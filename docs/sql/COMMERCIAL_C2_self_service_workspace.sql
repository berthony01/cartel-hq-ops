-- COMMERCIAL ONBOARDING C2 — self-service Free project creation
-- STATUS: APPLIED as Supabase migration 20260927171231 / commercial_c2_self_service_workspace.
--
-- Adds one authenticated SECURITY DEFINER RPC. It does NOT change the
-- workspaces_insert_private_beta policy: direct browser inserts by ordinary
-- users still fail. Owner membership and Free plan assignment remain owned by
-- the existing on_workspace_created -> public.handle_new_workspace() trigger;
-- this function performs neither write.
--
-- Slug contract mirrors the existing client slugify used for workspace
-- creation: nullable; otherwise lowercase [a-z0-9] groups separated by single
-- hyphens, max 48 chars. Uniqueness stays enforced by workspaces_slug_key.

BEGIN;

CREATE OR REPLACE FUNCTION public.create_self_service_workspace(_name text, _slug text)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_uid  uuid := auth.uid();
  v_name text := btrim(coalesce(_name, ''));
  v_slug text := nullif(btrim(coalesce(_slug, '')), '');
  v_id   uuid;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'AUTH_REQUIRED' USING ERRCODE = '42501';
  END IF;

  IF v_name = '' OR char_length(v_name) > 80 THEN
    RAISE EXCEPTION 'INVALID_PROJECT_NAME' USING ERRCODE = '22023';
  END IF;

  IF v_slug IS NOT NULL AND (
       char_length(v_slug) > 48
    OR v_slug !~ '^[a-z0-9]+(-[a-z0-9]+)*$'
  ) THEN
    RAISE EXCEPTION 'INVALID_PROJECT_SLUG' USING ERRCODE = '22023';
  END IF;

  -- Serialize all self-service creation for this user before checking.
  PERFORM pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended('create_self_service_workspace:' || v_uid::text, 0)
  );

  IF NOT public.has_platform_unrestricted_access(v_uid) THEN
    IF EXISTS (SELECT 1 FROM public.workspaces w WHERE w.owner_id = v_uid) THEN
      RAISE EXCEPTION 'FREE_PROJECT_LIMIT_REACHED' USING ERRCODE = 'P0001';
    END IF;
  END IF;

  IF v_slug IS NOT NULL AND EXISTS (SELECT 1 FROM public.workspaces w WHERE w.slug = v_slug) THEN
    RAISE EXCEPTION 'PROJECT_SLUG_TAKEN' USING ERRCODE = '23505';
  END IF;

  INSERT INTO public.workspaces (name, slug, owner_id)
  VALUES (v_name, v_slug, v_uid)
  RETURNING id INTO v_id;

  RETURN v_id;
END;
$$;

REVOKE ALL ON FUNCTION public.create_self_service_workspace(text, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.create_self_service_workspace(text, text) FROM anon;
GRANT EXECUTE ON FUNCTION public.create_self_service_workspace(text, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.create_self_service_workspace(text, text) TO service_role;

COMMIT;
