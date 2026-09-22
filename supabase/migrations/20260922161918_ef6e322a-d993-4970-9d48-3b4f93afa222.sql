CREATE OR REPLACE FUNCTION public.can_use_project_tools(_workspace_id uuid, _user_id uuid DEFAULT auth.uid())
RETURNS boolean
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
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

  -- Minimum Project Identity ONLY: non-empty project_name plus a public_slug
  -- matching the canonical project_profiles_public_slug_format contract.
  -- Publication status and every optional field are deliberately irrelevant.
  RETURN EXISTS (
    SELECT 1
    FROM public.project_profiles p
    WHERE p.workspace_id = _workspace_id
      AND char_length(btrim(p.project_name)) >= 1
      AND char_length(p.public_slug) >= 2
      AND char_length(p.public_slug) <= 64
      AND p.public_slug ~ '^[a-z0-9]+(?:-[a-z0-9]+)*$'
  );
END;
$$;

REVOKE ALL ON FUNCTION public.can_use_project_tools(uuid, uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.can_use_project_tools(uuid, uuid) FROM anon;
GRANT EXECUTE ON FUNCTION public.can_use_project_tools(uuid, uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.can_use_project_tools(uuid, uuid) TO service_role;
GRANT EXECUTE ON FUNCTION public.can_use_project_tools(uuid, uuid) TO postgres;