CREATE OR REPLACE FUNCTION public.enforce_launch_chain_deployment_update()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
BEGIN
  IF NEW.workspace_id <> OLD.workspace_id
     OR NEW.launch_id <> OLD.launch_id
     OR NEW.attempt_number <> OLD.attempt_number
     OR NEW.client_request_id <> OLD.client_request_id
     OR NEW.chain_id <> OLD.chain_id
     OR NEW.network_environment <> OLD.network_environment
     OR NEW.deployer_address <> OLD.deployer_address
     OR NEW.created_at <> OLD.created_at
     OR NEW.created_by IS DISTINCT FROM OLD.created_by THEN
    RAISE EXCEPTION 'Deployment attempt identity is immutable' USING ERRCODE = '42501';
  END IF;

  IF OLD.tx_hash IS NOT NULL AND NEW.tx_hash IS DISTINCT FROM OLD.tx_hash THEN
    RAISE EXCEPTION 'Transaction hash is immutable' USING ERRCODE = '42501';
  END IF;

  -- PCART P6: the canonical PCART finality RPC may update ONLY finality
  -- columns on a CONFIRMED canonical pepecartel-token-v1 production row.
  IF OLD.status = 'CONFIRMED' AND NEW.status = 'CONFIRMED'
     AND current_setting('cartel.pcart_p6_finality', true) = 'on'
     AND OLD.artifact_id = 'pepecartel-token-v1' AND OLD.chain_id = 4663
     AND OLD.network_environment = 'PRODUCTION'
     AND (to_jsonb(NEW) - ARRAY['finality_state','finalized_at','finalized_block_number','finalized_head_block_number','finalized_block_hash_confirmed','finality_provider_kind','finality_last_checked_at','finality_notice','updated_at'])
       = (to_jsonb(OLD) - ARRAY['finality_state','finalized_at','finalized_block_number','finalized_head_block_number','finalized_block_hash_confirmed','finality_provider_kind','finality_last_checked_at','finality_notice','updated_at']) THEN
    RETURN NEW;
  END IF;

  IF OLD.status IN ('CONFIRMED','FAILED','ABANDONED') THEN
    RAISE EXCEPTION 'Deployment attempt is final' USING ERRCODE = '42501';
  END IF;

  IF NEW.status <> OLD.status THEN
    IF NOT (
      (OLD.status = 'DRAFT' AND NEW.status IN ('SUBMITTED','ABANDONED'))
      OR (OLD.status = 'SUBMITTED' AND NEW.status IN ('PENDING','CONFIRMED','FAILED'))
      OR (OLD.status = 'PENDING' AND NEW.status IN ('CONFIRMED','FAILED'))
    ) THEN
      RAISE EXCEPTION 'Invalid deployment status transition % -> %', OLD.status, NEW.status
        USING ERRCODE = '42501';
    END IF;
  END IF;

  IF NEW.status = 'CONFIRMED' AND (NEW.contract_address IS NULL OR NEW.verified_at IS NULL) THEN
    RAISE EXCEPTION 'Confirmed deployment requires a verified contract address'
      USING ERRCODE = '42501';
  END IF;

  RETURN NEW;
END;
$function$;

CREATE OR REPLACE FUNCTION private.pcart_p6_assert_row(_deployment_id uuid, _lock boolean)
 RETURNS public.launch_chain_deployments
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
DECLARE
  d public.launch_chain_deployments%rowtype;
  c public.pcart_production_send_claims%rowtype;
  r public.pcart_production_readiness_approvals%rowtype;
  l public.launches%rowtype;
  ev jsonb;
BEGIN
  IF auth.uid() IS NULL OR NOT public.is_platform_owner(auth.uid()) THEN
    RAISE EXCEPTION 'Only the platform owner can verify the PCART deployment' USING ERRCODE = '42501';
  END IF;
  IF _lock THEN
    SELECT * INTO d FROM public.launch_chain_deployments WHERE id = _deployment_id FOR UPDATE;
  ELSE
    SELECT * INTO d FROM public.launch_chain_deployments WHERE id = _deployment_id;
  END IF;
  IF NOT FOUND THEN RAISE EXCEPTION 'Deployment not found' USING ERRCODE = 'P0002'; END IF;
  IF NOT private.is_canonical_pcart_launch(d.launch_id) THEN
    RAISE EXCEPTION 'Not the canonical PEPECARTEL launch' USING ERRCODE = '42501';
  END IF;
  IF d.chain_id IS DISTINCT FROM 4663 OR d.network_environment IS DISTINCT FROM 'PRODUCTION'
     OR d.artifact_id IS DISTINCT FROM 'pepecartel-token-v1' OR d.deployment_kind IS DISTINCT FROM 'FIXED_SUPPLY_ERC20'
     OR d.token_name IS DISTINCT FROM 'PEPECARTEL' OR d.token_symbol IS DISTINCT FROM 'PCART'
     OR d.token_decimals IS DISTINCT FROM 18::smallint
     OR d.token_total_supply IS DISTINCT FROM 1000000000000000000000000000::numeric
     OR d.token_total_supply_text IS DISTINCT FROM '1000000000000000000000000000'
     OR d.init_code_hash IS NULL OR d.review_fingerprint IS NULL OR d.deployer_nonce_before IS NULL THEN
    RAISE EXCEPTION 'Deployment is not the exact canonical PCART production intent' USING ERRCODE = '42501';
  END IF;
  IF d.status NOT IN ('SUBMITTED','PENDING','CONFIRMED') THEN
    RAISE EXCEPTION 'PCART verification is unavailable for status %', d.status USING ERRCODE = '42501';
  END IF;
  IF d.tx_hash IS NULL OR d.submitted_at IS NULL THEN
    RAISE EXCEPTION 'No broadcast transaction is recorded' USING ERRCODE = '42501';
  END IF;
  SELECT * INTO c FROM public.pcart_production_send_claims
   WHERE deployment_id = d.id AND claim_status = 'BROADCAST' AND tx_hash = d.tx_hash;
  IF NOT FOUND OR c.wallet_account IS DISTINCT FROM lower(d.deployer_address)
     OR c.deployer_nonce IS DISTINCT FROM d.deployer_nonce_before OR c.chain_id IS DISTINCT FROM 4663 THEN
    RAISE EXCEPTION 'No matching BROADCAST send claim for this transaction' USING ERRCODE = '42501';
  END IF;
  SELECT * INTO l FROM public.launches WHERE id = d.launch_id;
  IF l.official_contract_address IS NOT NULL OR l.official_contract_deployment_id IS NOT NULL THEN
    RAISE EXCEPTION 'An official contract is already registered' USING ERRCODE = '42501';
  END IF;
  SELECT * INTO r FROM public.pcart_production_readiness_approvals
   WHERE launch_id = d.launch_id AND artifact_id = 'pepecartel-token-v1';
  IF NOT FOUND OR lower(r.safe_address) IS DISTINCT FROM lower(d.token_recipient) THEN
    RAISE EXCEPTION 'Readiness approval does not match the deployment recipient' USING ERRCODE = '42501';
  END IF;
  ev := private.pcart_production_readiness_evidence(d.launch_id, false);
  IF NOT coalesce((ev->>'ok')::boolean, false) OR r.readiness_fingerprint IS DISTINCT FROM ev->>'fingerprint' THEN
    RAISE EXCEPTION 'Readiness evidence no longer matches (%)', coalesce(ev->>'reason','FINGERPRINT') USING ERRCODE = '42501';
  END IF;
  RETURN d;
END;
$function$;
REVOKE ALL ON FUNCTION private.pcart_p6_assert_row(uuid, boolean) FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.apply_canonical_pcart_production_verification(
  _deployment_id uuid,
  _outcome text,
  _observed_tx_hash text,
  _contract_address text DEFAULT NULL,
  _block_number bigint DEFAULT NULL,
  _block_hash text DEFAULT NULL,
  _confirmations integer DEFAULT 0,
  _runtime_code_hash text DEFAULT NULL,
  _verified_token_name text DEFAULT NULL,
  _verified_token_symbol text DEFAULT NULL,
  _verified_token_decimals smallint DEFAULT NULL,
  _verified_total_supply_text text DEFAULT NULL,
  _safe_balance_text text DEFAULT NULL,
  _deployer_balance_text text DEFAULT NULL,
  _failure_code text DEFAULT NULL,
  _failure_detail text DEFAULT NULL
)
 RETURNS public.launch_chain_deployments
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
DECLARE
  d public.launch_chain_deployments%rowtype;
  c public.pcart_production_send_claims%rowtype;
  v_outcome text := upper(btrim(coalesce(_outcome, '')));
  v_hash text := lower(btrim(coalesce(_observed_tx_hash, '')));
  v_addr text := lower(btrim(coalesce(_contract_address, '')));
  v_bhash text := lower(btrim(coalesce(_block_hash, '')));
  v_code text := upper(btrim(coalesce(_failure_code, '')));
  v_supply constant text := '1000000000000000000000000000';
  v_runtime constant text := '0x69ef7ad36b6c4b900d390bc4977eb61a518e9d35e506a6f83712192c7e7d03e4';
  v_conf integer := greatest(coalesce(_confirmations, 0), 0);
BEGIN
  d := private.pcart_p6_assert_row(_deployment_id, true);
  IF v_hash IS DISTINCT FROM d.tx_hash THEN
    RAISE EXCEPTION 'Observed transaction hash does not match the recorded hash' USING ERRCODE = '22023';
  END IF;
  SELECT * INTO c FROM public.pcart_production_send_claims
   WHERE deployment_id = d.id AND claim_status = 'BROADCAST' AND tx_hash = d.tx_hash;

  IF v_outcome = 'PENDING' THEN
    IF d.status = 'CONFIRMED' THEN RETURN d; END IF; -- never downgrade
    UPDATE public.launch_chain_deployments
       SET status = 'PENDING', last_checked_at = now(), confirmations = 0
     WHERE id = d.id RETURNING * INTO d;
    RETURN d;
  END IF;

  IF v_outcome = 'FAILED' THEN
    IF d.status = 'CONFIRMED' THEN
      RAISE EXCEPTION 'Confirmed PCART evidence contradicted (%) — manual incident review required; nothing written', v_code USING ERRCODE = '42501';
    END IF;
    IF v_code NOT IN ('REVERTED','REPLACED_OR_DROPPED','MISMATCH_SENDER','MISMATCH_TO','MISMATCH_NONCE','MISMATCH_VALUE',
                      'MISMATCH_INIT_CODE','MISMATCH_TX_HASH','MISMATCH_CONTRACT_ADDRESS','MISMATCH_RUNTIME',
                      'MISMATCH_TOKEN_METADATA','MISMATCH_SAFE_BALANCE','MISMATCH_DEPLOYER_BALANCE') THEN
      RAISE EXCEPTION 'Unsupported terminal failure code' USING ERRCODE = '22023';
    END IF;
    UPDATE public.launch_chain_deployments
       SET status = 'FAILED', failure_code = v_code,
           failure_detail = left(nullif(btrim(coalesce(_failure_detail, '')), ''), 2000),
           last_checked_at = now(),
           block_number = CASE WHEN _block_number IS NOT NULL AND _block_number >= 0 THEN _block_number ELSE block_number END,
           block_hash = CASE WHEN v_bhash ~ '^0x[0-9a-f]{64}$' THEN v_bhash ELSE block_hash END
     WHERE id = d.id RETURNING * INTO d;
    RETURN d;
  END IF;

  IF v_outcome <> 'CONFIRMED' THEN
    RAISE EXCEPTION 'Unsupported verification outcome' USING ERRCODE = '22023';
  END IF;

  IF v_addr !~ '^0x[0-9a-f]{40}$' OR v_addr IS DISTINCT FROM lower(c.predicted_contract_address)
     OR _block_number IS NULL OR _block_number < 0 OR v_bhash !~ '^0x[0-9a-f]{64}$'
     OR lower(coalesce(_runtime_code_hash, '')) IS DISTINCT FROM v_runtime
     OR _verified_token_name IS DISTINCT FROM 'PEPECARTEL' OR _verified_token_symbol IS DISTINCT FROM 'PCART'
     OR _verified_token_decimals IS DISTINCT FROM 18::smallint
     OR _verified_total_supply_text IS DISTINCT FROM v_supply
     OR _safe_balance_text IS DISTINCT FROM v_supply
     OR _deployer_balance_text IS DISTINCT FROM '0' THEN
    RAISE EXCEPTION 'Confirmation evidence does not match the canonical PCART intent' USING ERRCODE = '22023';
  END IF;

  IF d.status = 'CONFIRMED' THEN
    IF d.contract_address = v_addr AND d.block_number = _block_number AND d.block_hash = v_bhash THEN
      RETURN d; -- idempotent recheck, no write
    END IF;
    RAISE EXCEPTION 'Confirmed PCART evidence contradicted — manual incident review required; nothing written' USING ERRCODE = '42501';
  END IF;

  UPDATE public.launch_chain_deployments
     SET status = 'CONFIRMED', contract_address = v_addr, block_number = _block_number, block_hash = v_bhash,
         confirmations = v_conf, verified_at = now(), last_checked_at = now(),
         failure_code = NULL, failure_detail = NULL,
         verified_token_name = 'PEPECARTEL', verified_token_symbol = 'PCART', verified_token_decimals = 18,
         verified_total_supply = v_supply::numeric, verified_total_supply_text = v_supply,
         verified_recipient_balance = v_supply::numeric, verified_recipient_balance_text = v_supply,
         finality_state = 'FINALITY_PENDING', finality_provider_kind = 'MANAGED',
         finality_last_checked_at = now(), finality_notice = 'PCART P6 verified; awaiting managed finality'
   WHERE id = d.id RETURNING * INTO d;
  RETURN d;
END;
$function$;
REVOKE ALL ON FUNCTION public.apply_canonical_pcart_production_verification(uuid, text, text, text, bigint, text, integer, text, text, text, smallint, text, text, text, text, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.apply_canonical_pcart_production_verification(uuid, text, text, text, bigint, text, integer, text, text, text, smallint, text, text, text, text, text) TO authenticated;

CREATE OR REPLACE FUNCTION public.apply_canonical_pcart_production_finality(
  _deployment_id uuid,
  _finality_state text,
  _finalized_block_number bigint DEFAULT NULL,
  _finalized_head_block_number bigint DEFAULT NULL,
  _reread_block_hash text DEFAULT NULL,
  _finality_notice text DEFAULT NULL
)
 RETURNS public.launch_chain_deployments
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
DECLARE
  d public.launch_chain_deployments%rowtype;
  v_state text := upper(btrim(coalesce(_finality_state, '')));
  v_reread text := lower(btrim(coalesce(_reread_block_hash, '')));
  v_notice text := left(nullif(btrim(coalesce(_finality_notice, '')), ''), 2000);
BEGIN
  d := private.pcart_p6_assert_row(_deployment_id, true);
  IF d.status IS DISTINCT FROM 'CONFIRMED' THEN
    RAISE EXCEPTION 'Finality requires a CONFIRMED PCART deployment' USING ERRCODE = '42501';
  END IF;
  IF d.contract_address IS NULL OR d.block_number IS NULL OR d.block_hash IS NULL OR d.verified_at IS NULL
     OR d.verified_recipient_balance_text IS DISTINCT FROM '1000000000000000000000000000' THEN
    RAISE EXCEPTION 'Deployment has no complete verified evidence' USING ERRCODE = '42501';
  END IF;
  IF d.finality_state = 'FINALIZED' THEN RETURN d; END IF; -- immutable / idempotent
  IF v_state NOT IN ('FINALIZED','FINALITY_PENDING','PROVIDER_INCONSISTENT') THEN
    RAISE EXCEPTION 'Unsupported finality state' USING ERRCODE = '22023';
  END IF;

  PERFORM set_config('cartel.pcart_p6_finality', 'on', true);

  IF v_state = 'FINALIZED' THEN
    IF _finalized_block_number IS DISTINCT FROM d.block_number
       OR _finalized_head_block_number IS NULL OR _finalized_head_block_number < d.block_number
       OR v_reread IS DISTINCT FROM d.block_hash THEN
      RAISE EXCEPTION 'Finality evidence does not prove the deployment block' USING ERRCODE = '22023';
    END IF;
    UPDATE public.launch_chain_deployments
       SET finality_state = 'FINALIZED', finalized_at = now(), finalized_block_number = d.block_number,
           finalized_head_block_number = _finalized_head_block_number, finalized_block_hash_confirmed = true,
           finality_provider_kind = 'MANAGED', finality_last_checked_at = now(), finality_notice = v_notice
     WHERE id = d.id RETURNING * INTO d;
  ELSIF v_state = 'PROVIDER_INCONSISTENT' THEN
    UPDATE public.launch_chain_deployments
       SET finality_state = 'PROVIDER_INCONSISTENT', finalized_at = NULL, finalized_block_number = NULL,
           finalized_head_block_number = CASE WHEN _finalized_head_block_number >= 0 THEN _finalized_head_block_number END,
           finalized_block_hash_confirmed = false, finality_provider_kind = 'MANAGED',
           finality_last_checked_at = now(), finality_notice = v_notice
     WHERE id = d.id RETURNING * INTO d;
  ELSE
    IF d.finality_state = 'PROVIDER_INCONSISTENT' AND v_reread IS DISTINCT FROM d.block_hash THEN
      RAISE EXCEPTION 'Clearing provider inconsistency requires a clean block hash re-read' USING ERRCODE = '22023';
    END IF;
    UPDATE public.launch_chain_deployments
       SET finality_state = 'FINALITY_PENDING', finalized_at = NULL, finalized_block_number = NULL,
           finalized_head_block_number = CASE WHEN _finalized_head_block_number >= 0 THEN _finalized_head_block_number END,
           finalized_block_hash_confirmed = NULL, finality_provider_kind = 'MANAGED',
           finality_last_checked_at = now(), finality_notice = v_notice
     WHERE id = d.id RETURNING * INTO d;
  END IF;
  PERFORM set_config('cartel.pcart_p6_finality', 'off', true);
  RETURN d;
END;
$function$;
REVOKE ALL ON FUNCTION public.apply_canonical_pcart_production_finality(uuid, text, bigint, bigint, text, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.apply_canonical_pcart_production_finality(uuid, text, bigint, bigint, text, text) TO authenticated;