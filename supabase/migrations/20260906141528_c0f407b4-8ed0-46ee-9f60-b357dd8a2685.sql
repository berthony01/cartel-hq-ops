REVOKE ALL ON FUNCTION public.enforce_launch_chain_production_presign() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.enforce_launch_chain_production_presign() FROM anon;
REVOKE ALL ON FUNCTION public.enforce_launch_chain_production_presign() FROM authenticated;
REVOKE ALL ON FUNCTION public.enforce_launch_chain_production_presign() FROM service_role;