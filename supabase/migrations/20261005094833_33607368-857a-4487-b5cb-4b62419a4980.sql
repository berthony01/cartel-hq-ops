-- PCART P2: dedicated canonical production DRAFT (review only, zero send capability).
CREATE OR REPLACE FUNCTION public.create_canonical_pcart_production_draft(
  _launch_id uuid,
  _client_request_id text,
  _deployer_address text,
  _deployer_nonce_before bigint,
  _init_code_hash text,
  _review_fingerprint text
) RETURNS public.launch_chain_deployments
LANGUAGE plpgsql SECURITY DEFINER SET search_path = ''
AS $$
DECLARE
  c_safe constant text := '0xe0d055b3e07c2d1d9c1762ca9e19b3062207ad03';
  c_init_hash constant text := '0x3482c250d8500b20f731938be3cf2eab39e59b9fa7aff21ffb5085e1ceddd818';
  c_supply constant numeric := 1000000000000000000000000000;
  v_request text := btrim(coalesce(_client_request_id, ''));
  v_deployer text := lower(btrim(coalesce(_deployer_address, '')));
  v_init text := lower(btrim(coalesce(_init_code_hash, '')));
  v_fp text := lower(btrim(coalesce(_review_fingerprint, '')));
  v_expected_fp text;
  l public.launches%rowtype;
  a public.pcart_production_readiness_approvals%rowtype;
  s public.launch_treasury_signer_configs%rowtype;
  k record;
  ev jsonb;
  v_row public.launch_chain_deployments;
  v_next integer;
BEGIN
  IF auth.uid() IS NULL OR NOT public.is_platform_owner(auth.uid()) THEN
    RAISE EXCEPTION 'Only the platform owner can prepare the PCART production draft' USING ERRCODE = '42501';
  END IF;

  SELECT * INTO l FROM public.launches WHERE id = _launch_id;
  IF NOT FOUND OR NOT private.is_canonical_pcart_launch(_launch_id) OR l.chain IS DISTINCT FROM 'Robinhood Chain' THEN
    RAISE EXCEPTION 'Not the canonical PEPECARTEL launch' USING ERRCODE = '42501';
  END IF;

  IF char_length(v_request) < 8 OR char_length(v_request) > 128 THEN
    RAISE EXCEPTION 'Invalid request id' USING ERRCODE = '22023';
  END IF;
  IF v_deployer !~ '^0x[0-9a-f]{40}$' OR v_deployer = '0x0000000000000000000000000000000000000000' OR v_deployer = c_safe THEN
    RAISE EXCEPTION 'Invalid deployer' USING ERRCODE = '22023';
  END IF;
  IF _deployer_nonce_before IS NULL OR _deployer_nonce_before < 0 THEN
    RAISE EXCEPTION 'Invalid deployer nonce' USING ERRCODE = '22023';
  END IF;
  IF v_init IS DISTINCT FROM c_init_hash THEN
    RAISE EXCEPTION 'Init code hash does not match the frozen PCART artifact with the verified Treasury Safe' USING ERRCODE = '22023';
  END IF;
  IF v_fp !~ '^0x[0-9a-f]{64}$' THEN
    RAISE EXCEPTION 'Invalid review fingerprint' USING ERRCODE = '22023';
  END IF;

  -- Idempotent replay: same request id must carry identical immutable fields.
  SELECT * INTO v_row FROM public.launch_chain_deployments
   WHERE launch_id = _launch_id AND client_request_id = v_request;
  IF FOUND THEN
    IF v_row.network_environment IS DISTINCT FROM 'PRODUCTION' OR v_row.chain_id <> 4663
       OR v_row.artifact_id IS DISTINCT FROM 'pepecartel-token-v1'
       OR v_row.deployer_address IS DISTINCT FROM v_deployer
       OR v_row.token_recipient IS DISTINCT FROM c_safe
       OR v_row.deployer_nonce_before IS DISTINCT FROM _deployer_nonce_before
       OR v_row.init_code_hash IS DISTINCT FROM v_init
       OR v_row.review_fingerprint IS DISTINCT FROM v_fp THEN
      RAISE EXCEPTION 'Idempotency key conflict' USING ERRCODE = '22023';
    END IF;
    RETURN v_row;
  END IF;

  SELECT * INTO a FROM public.pcart_production_readiness_approvals
   WHERE launch_id = _launch_id AND artifact_id = 'pepecartel-token-v1';
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Production readiness approval is required' USING ERRCODE = '42501';
  END IF;
  IF lower(a.safe_address) IS DISTINCT FROM c_safe THEN
    RAISE EXCEPTION 'Approved Treasury Safe does not match the pinned recipient' USING ERRCODE = '42501';
  END IF;

  ev := private.pcart_production_readiness_evidence(_launch_id, false);
  IF NOT coalesce((ev->>'ok')::boolean, false) OR a.readiness_fingerprint IS DISTINCT FROM ev->>'fingerprint' THEN
    RAISE EXCEPTION 'Readiness evidence no longer matches (%)', coalesce(ev->>'reason', 'FINGERPRINT') USING ERRCODE = '42501';
  END IF;

  SELECT * INTO s FROM public.launch_treasury_signer_configs WHERE launch_id = _launch_id;
  IF NOT FOUND OR lower(s.safe_address) IS DISTINCT FROM c_safe OR s.threshold IS DISTINCT FROM 2
     OR v_deployer NOT IN (lower(s.signer_1), lower(s.signer_2), lower(s.signer_3)) THEN
    RAISE EXCEPTION 'Deployer must be one of the three verified Treasury signers' USING ERRCODE = '42501';
  END IF;

  SELECT * INTO k FROM public.launch_chain_production_execution_controls WHERE control_key = 'ROBINHOOD_MAINNET_DEPLOYMENT';
  IF NOT FOUND OR k.execution_enabled IS DISTINCT FROM false OR k.emergency_stop_engaged IS DISTINCT FROM true THEN
    RAISE EXCEPTION 'Mainnet execution must remain locked to prepare a draft' USING ERRCODE = '42501';
  END IF;

  IF EXISTS (SELECT 1 FROM public.launch_chain_deployments x
              WHERE x.launch_id = _launch_id
                AND (x.network_environment = 'PRODUCTION' OR x.chain_id = 4663)
                AND x.status IN ('DRAFT','SUBMITTED','PENDING','CONFIRMED')) THEN
    RAISE EXCEPTION 'A PCART production attempt already exists; resolve it first' USING ERRCODE = '23505';
  END IF;

  v_expected_fp := '0x' || encode(sha256(convert_to(concat_ws('|',
      'pcart-production-review-v1', lower(_launch_id::text), 'pepecartel-token-v1', '4663', 'PRODUCTION',
      'PEPECARTEL', 'PCART', '18', '1000000000000000000000000000',
      c_safe, v_deployer, _deployer_nonce_before::text, v_init, lower(a.readiness_fingerprint)), 'UTF8')), 'hex');
  IF v_fp IS DISTINCT FROM v_expected_fp THEN
    RAISE EXCEPTION 'Review fingerprint does not match the canonical review inputs' USING ERRCODE = '22023';
  END IF;

  SELECT coalesce(max(d.attempt_number), 0) + 1 INTO v_next
    FROM public.launch_chain_deployments d WHERE d.launch_id = _launch_id;

  BEGIN
    INSERT INTO public.launch_chain_deployments (
      workspace_id, launch_id, attempt_number, client_request_id,
      chain_id, network_environment, deployer_address, status, created_by,
      deployment_kind, artifact_id, token_name, token_symbol, token_decimals,
      token_total_supply, token_total_supply_text, token_recipient,
      deployer_nonce_before, init_code_hash, review_fingerprint
    ) VALUES (
      l.workspace_id, _launch_id, v_next, v_request,
      4663, 'PRODUCTION', v_deployer, 'DRAFT', auth.uid(),
      'FIXED_SUPPLY_ERC20', 'pepecartel-token-v1', 'PEPECARTEL', 'PCART', 18,
      c_supply, '1000000000000000000000000000', c_safe,
      _deployer_nonce_before, v_init, v_fp
    ) RETURNING * INTO v_row;
  EXCEPTION WHEN unique_violation THEN
    SELECT * INTO v_row FROM public.launch_chain_deployments
     WHERE launch_id = _launch_id AND client_request_id = v_request;
    IF NOT FOUND OR v_row.review_fingerprint IS DISTINCT FROM v_fp OR v_row.deployer_address IS DISTINCT FROM v_deployer THEN
      RAISE;
    END IF;
  END;
  RETURN v_row;
END;
$$;

CREATE OR REPLACE FUNCTION public.abandon_canonical_pcart_production_draft(_deployment_id uuid, _reason text)
RETURNS public.launch_chain_deployments
LANGUAGE plpgsql SECURITY DEFINER SET search_path = ''
AS $$
DECLARE
  v_row public.launch_chain_deployments;
  v_reason text := btrim(coalesce(_reason, ''));
BEGIN
  IF auth.uid() IS NULL OR NOT public.is_platform_owner(auth.uid()) THEN
    RAISE EXCEPTION 'Only the platform owner can abandon the PCART production draft' USING ERRCODE = '42501';
  END IF;
  IF char_length(v_reason) < 4 OR char_length(v_reason) > 500 THEN
    RAISE EXCEPTION 'A reason is required' USING ERRCODE = '22023';
  END IF;
  SELECT * INTO v_row FROM public.launch_chain_deployments WHERE id = _deployment_id FOR UPDATE;
  IF NOT FOUND OR NOT private.is_canonical_pcart_launch(v_row.launch_id)
     OR v_row.network_environment IS DISTINCT FROM 'PRODUCTION' OR v_row.chain_id <> 4663
     OR v_row.artifact_id IS DISTINCT FROM 'pepecartel-token-v1' THEN
    RAISE EXCEPTION 'Not a canonical PCART production draft' USING ERRCODE = '42501';
  END IF;
  IF v_row.status = 'ABANDONED' THEN RETURN v_row; END IF;
  IF v_row.status <> 'DRAFT' OR v_row.tx_hash IS NOT NULL OR v_row.submitted_at IS NOT NULL OR v_row.contract_address IS NOT NULL THEN
    RAISE EXCEPTION 'Only an unsent PCART production draft can be abandoned' USING ERRCODE = '42501';
  END IF;
  UPDATE public.launch_chain_deployments
     SET status = 'ABANDONED', failure_code = 'ABANDONED', failure_detail = left(v_reason, 2000)
   WHERE id = _deployment_id
   RETURNING * INTO v_row;
  RETURN v_row;
END;
$$;

REVOKE ALL ON FUNCTION public.create_canonical_pcart_production_draft(uuid, text, text, bigint, text, text) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.abandon_canonical_pcart_production_draft(uuid, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.create_canonical_pcart_production_draft(uuid, text, text, bigint, text, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.abandon_canonical_pcart_production_draft(uuid, text) TO authenticated;