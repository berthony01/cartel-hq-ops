REVOKE ALL PRIVILEGES ON TABLE public.launch_chain_deployments FROM anon;
REVOKE ALL PRIVILEGES ON TABLE public.launch_chain_deployments FROM authenticated;
GRANT SELECT ON TABLE public.launch_chain_deployments TO authenticated;
GRANT ALL ON TABLE public.launch_chain_deployments TO service_role;

REVOKE ALL ON FUNCTION public.enforce_launch_chain_deployment_tenant() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.enforce_launch_chain_deployment_tenant() FROM anon;
REVOKE ALL ON FUNCTION public.enforce_launch_chain_deployment_tenant() FROM authenticated;
REVOKE ALL ON FUNCTION public.enforce_launch_chain_deployment_update() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.enforce_launch_chain_deployment_update() FROM anon;
REVOKE ALL ON FUNCTION public.enforce_launch_chain_deployment_update() FROM authenticated;