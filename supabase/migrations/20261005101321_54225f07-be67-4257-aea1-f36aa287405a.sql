DROP INDEX IF EXISTS public.launch_chain_deployments_one_active_pcart_rehearsal;
CREATE UNIQUE INDEX launch_chain_deployments_one_active_pcart_rehearsal
  ON public.launch_chain_deployments (launch_id)
  WHERE artifact_id = 'pepecartel-token-v1'
    AND network_environment = 'TESTNET'
    AND chain_id = 46630
    AND status IN ('DRAFT', 'SUBMITTED', 'PENDING', 'CONFIRMED');
CREATE UNIQUE INDEX launch_chain_deployments_one_active_pcart_production
  ON public.launch_chain_deployments (launch_id)
  WHERE artifact_id = 'pepecartel-token-v1'
    AND network_environment = 'PRODUCTION'
    AND chain_id = 4663
    AND status IN ('DRAFT', 'SUBMITTED', 'PENDING', 'CONFIRMED');