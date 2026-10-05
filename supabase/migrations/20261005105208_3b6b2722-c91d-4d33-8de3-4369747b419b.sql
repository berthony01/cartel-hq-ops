CREATE OR REPLACE FUNCTION public.get_canonical_pcart_production_readiness(_launch_id uuid)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  uid uuid := auth.uid(); owner boolean; ev jsonb; r public.pcart_production_readiness_approvals; c record;
  reh boolean; safe_saved boolean; safe_ver boolean;
BEGIN
  IF uid IS NULL THEN RAISE EXCEPTION 'Not authenticated' USING ERRCODE = '42501'; END IF;
  owner := public.is_platform_owner(uid);
  IF NOT owner AND NOT EXISTS (SELECT 1 FROM public.launches l JOIN public.workspace_members m
       ON m.workspace_id = l.workspace_id WHERE l.id = _launch_id AND m.user_id = uid) THEN
    RAISE EXCEPTION 'Not allowed' USING ERRCODE = '42501';
  END IF;
  IF NOT private.is_canonical_pcart_launch(_launch_id) THEN
    RETURN jsonb_build_object('canonical', false);
  END IF;
  ev := private.pcart_production_readiness_evidence(_launch_id, false);
  SELECT * INTO r FROM public.pcart_production_readiness_approvals a WHERE a.launch_id = _launch_id;
  SELECT * INTO c FROM public.launch_chain_production_execution_controls k WHERE k.control_key = 'ROBINHOOD_MAINNET_DEPLOYMENT';
  reh := EXISTS (SELECT 1 FROM public.launch_chain_deployments x WHERE x.launch_id = _launch_id
          AND x.artifact_id = 'pepecartel-token-v1' AND x.network_environment = 'TESTNET'
          AND x.status = 'CONFIRMED' AND x.verified_at IS NOT NULL);
  safe_saved := EXISTS (SELECT 1 FROM public.launch_treasury_signer_configs t WHERE t.launch_id = _launch_id
          AND t.threshold = 2 AND t.safe_address IS NOT NULL AND t.signer_1 IS NOT NULL AND t.signer_2 IS NOT NULL AND t.signer_3 IS NOT NULL);
  safe_ver := EXISTS (SELECT 1 FROM public.launch_treasury_signer_configs t WHERE t.launch_id = _launch_id
          AND t.safe_verified_at IS NOT NULL);
  RETURN jsonb_build_object(
    'canonical', true,
    'is_platform_owner', owner,
    'rehearsal_complete', reh,
    'safe_configured', safe_saved,
    'safe_verified', safe_ver,
    'evidence_ok', (ev->>'ok')::boolean,
    'evidence_reason', ev->>'reason',
    'rehearsal_attempt_number', ev->'rehearsal_attempt_number',
    'rehearsal_tx_hash', ev->>'rehearsal_tx_hash',
    'safe_address', ev->>'safe_address',
    'execution_locked', COALESCE(c.execution_enabled = false AND c.emergency_stop_engaged = true, false),
    'approval', CASE WHEN r.id IS NULL THEN NULL ELSE jsonb_build_object(
      'id', r.id, 'artifact_id', r.artifact_id, 'rehearsal_tx_hash', r.rehearsal_tx_hash,
      'safe_address', r.safe_address, 'approved_at', r.approved_at,
      'evidence_still_matches', COALESCE(r.readiness_fingerprint = ev->>'fingerprint', false)) END
  );
END;
$$;
REVOKE ALL ON FUNCTION public.get_canonical_pcart_production_readiness(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_canonical_pcart_production_readiness(uuid) TO authenticated;