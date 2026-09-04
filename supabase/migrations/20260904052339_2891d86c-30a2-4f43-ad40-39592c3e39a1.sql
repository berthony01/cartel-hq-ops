-- C8.2 corrective: is_platform_owner / is_workspace_operator are not
-- EXECUTE-able by `authenticated`, so referencing them directly from the RLS
-- policy made every browser read fail with "permission denied for function".
-- Wrap the identical double gate in a SECURITY DEFINER boolean predicate.

CREATE OR REPLACE FUNCTION public.can_read_launch_chain_deployment(_workspace_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT auth.uid() IS NOT NULL
     AND public.is_platform_owner(auth.uid())
     AND public.is_workspace_operator(_workspace_id, auth.uid());
$$;

REVOKE ALL ON FUNCTION public.can_read_launch_chain_deployment(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.can_read_launch_chain_deployment(uuid) TO authenticated, service_role;

DROP POLICY "Platform owner operators read launch chain deployments"
  ON public.launch_chain_deployments;

CREATE POLICY "Platform owner operators read launch chain deployments"
  ON public.launch_chain_deployments
  FOR SELECT
  TO authenticated
  USING (public.can_read_launch_chain_deployment(workspace_id));