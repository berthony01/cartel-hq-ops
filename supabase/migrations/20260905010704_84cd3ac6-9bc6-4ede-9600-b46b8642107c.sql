DROP TRIGGER IF EXISTS enforce_launch_contract_update_trigger ON public.launches;

CREATE TRIGGER enforce_launch_contract_update_trigger
BEFORE UPDATE OF
  official_contract_address,
  official_contract_deployment_id,
  contract_registered_at,
  contract_registered_by
ON public.launches
FOR EACH ROW
EXECUTE FUNCTION public.enforce_launch_contract_update();