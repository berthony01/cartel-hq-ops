GRANT SELECT, INSERT, UPDATE ON public.launch_treasury_signer_configs TO authenticated;
GRANT ALL ON public.launch_treasury_signer_configs TO service_role;

DROP POLICY IF EXISTS "Workspace owner inserts its treasury signer config" ON public.launch_treasury_signer_configs;
CREATE POLICY "Workspace owner inserts its treasury signer config"
  ON public.launch_treasury_signer_configs
  FOR INSERT TO authenticated
  WITH CHECK (public.is_workspace_owner(workspace_id, auth.uid()));

DROP POLICY IF EXISTS "Workspace owner updates its treasury signer config" ON public.launch_treasury_signer_configs;
CREATE POLICY "Workspace owner updates its treasury signer config"
  ON public.launch_treasury_signer_configs
  FOR UPDATE TO authenticated
  USING (public.is_workspace_owner(workspace_id, auth.uid()))
  WITH CHECK (public.is_workspace_owner(workspace_id, auth.uid()));