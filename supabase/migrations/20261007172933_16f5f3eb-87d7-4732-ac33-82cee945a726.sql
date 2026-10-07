-- P9.2: bind the EXISTING canonical PCART execution permit. CANONICAL_PCART_PROTECTED unchanged.
ALTER TABLE public.pcart_production_execution_permits
  ADD COLUMN binding_version text,
  ADD COLUMN action_type text,
  ADD COLUMN p8a_manifest_version text,
  ADD COLUMN p8a_manifest_fingerprint text,
  ADD COLUMN p8a_review_id uuid,
  ADD COLUMN p8b_manifest_version text,
  ADD COLUMN p8b_manifest_fingerprint text,
  ADD COLUMN p8b_review_id uuid,
  ADD COLUMN dependency_attestation_fingerprint text,
  ADD COLUMN safe_attestation_fingerprint text,
  ADD COLUMN safe_nonce bigint,
  ADD COLUMN execution_control_revision bigint;
ALTER TABLE public.pcart_production_execution_permits ADD CONSTRAINT pcart_permit_binding_complete CHECK (
  binding_version IS NULL OR (
    binding_version = 'P9_2_DEPLOY_V1' AND action_type = 'DEPLOY_OFFICIAL_PCART'
    AND p8a_manifest_version IS NOT NULL AND p8a_manifest_fingerprint ~ '^0x[0-9a-f]{64}$' AND p8a_review_id IS NOT NULL
    AND p8b_manifest_version IS NOT NULL AND p8b_manifest_fingerprint ~ '^0x[0-9a-f]{64}$' AND p8b_review_id IS NOT NULL
    AND dependency_attestation_fingerprint ~ '^0x[0-9a-f]{64}$' AND safe_attestation_fingerprint ~ '^0x[0-9a-f]{64}$'
    AND safe_nonce IS NOT NULL AND execution_control_revision IS NOT NULL));

-- Latest review for the kind; NULL unless it matches the pinned manifest and is not revoked.
CREATE OR REPLACE FUNCTION private.pcart_p9_2_current_policy_review(_launch_id uuid, _kind text)
RETURNS uuid LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = '' AS $$
DECLARE v_id uuid; v_ver text; v_fp text; v_res text;
BEGIN
  IF _kind = 'P8A' THEN
    SELECT id, manifest_version, lower(manifest_fingerprint), 'PASS' INTO v_id, v_ver, v_fp, v_res
      FROM public.pcart_auction_liquidity_plan_reviews WHERE launch_id = _launch_id ORDER BY reviewed_at DESC LIMIT 1;
    IF v_ver IS DISTINCT FROM 'pcart-auction-liquidity-p8a-v2' OR v_fp IS DISTINCT FROM '0x320269f530f5f5d886dd3579c1f8866ebcc2f7affc8e888232edd070fb86e7e2' THEN RETURN NULL; END IF;
  ELSIF _kind = 'P8B' THEN
    SELECT id, manifest_version, lower(manifest_fingerprint), overall_result INTO v_id, v_ver, v_fp, v_res
      FROM public.pcart_auction_execution_rehearsal_reviews WHERE launch_id = _launch_id ORDER BY reviewed_at DESC LIMIT 1;
    IF v_ver IS DISTINCT FROM 'pcart-auction-execution-p8b-v1' OR v_fp IS DISTINCT FROM '0x78435a8789fe12d4985821e0e48d8ec0a2191fb9606d04ebb63b6bb16974f579' OR v_res IS DISTINCT FROM 'PASS' THEN RETURN NULL; END IF;
  ELSE RETURN NULL; END IF;
  IF v_id IS NULL OR EXISTS (SELECT 1 FROM public.pcart_policy_approval_revocations r WHERE r.review_kind = _kind AND r.review_id = v_id) THEN RETURN NULL; END IF;
  RETURN v_id;
END $$;

-- Must stay byte-identical to safeAttestationPreimage() in src/lib/pcart-p9-2-permit-binding.ts
CREATE OR REPLACE FUNCTION private.pcart_p9_2_safe_attestation(_owners_sorted text, _nonce bigint)
RETURNS text LANGUAGE sql IMMUTABLE SET search_path = '' AS $$
  SELECT '0x' || encode(extensions.digest(convert_to(concat_ws('|',
    'pcart-p9-2-safe-attest-v1', '4663', '0xe0d055b3e07c2d1d9c1762ca9e19b3062207ad03',
    '0xd7d408ebcd99b2b70be43e20253d6d92a8ea8fab29bd3be7f55b10032331fb4c', '1.4.1', '2', _owners_sorted, _nonce::text), 'UTF8'), 'sha256'), 'hex')
$$;

CREATE OR REPLACE FUNCTION public.issue_canonical_pcart_execution_permit_v2(
  _actor uuid, _deployment_id uuid, _preparation_authorization_id uuid, _unsigned_tx_fingerprint text,
  _gas_limit bigint, _max_fee_per_gas numeric, _max_priority_fee_per_gas numeric,
  _dependency_attestation_fingerprint text, _safe_nonce bigint, _safe_attestation_fingerprint text
) RETURNS public.pcart_production_execution_permits
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  c_safe constant text := '0xe0d055b3e07c2d1d9c1762ca9e19b3062207ad03';
  c_owners constant text := '0xa068b94e6f11a7e2daef086c5190dc265a523f67,0xc23bd6148a29318cc19264e096623ffcdac19245,0xe5b2f446317d03de6e69fa697ab25d635f6dd617';
  c_dep_fp constant text := '0x52549f0a5b05ac4187162991db2e14467ba337a005344f7608c57590a1c6f292';
  c_init_hash constant text := '0x3482c250d8500b20f731938be3cf2eab39e59b9fa7aff21ffb5085e1ceddd818';
  c_supply constant numeric := 1000000000000000000000000000;
  c_ttl constant interval := interval '30 seconds';
  v_fp text := lower(btrim(coalesce(_unsigned_tx_fingerprint, '')));
  d public.launch_chain_deployments%rowtype;
  l public.launches%rowtype;
  a public.pcart_production_readiness_approvals%rowtype;
  s public.launch_treasury_signer_configs%rowtype;
  p public.pcart_production_preparation_authorizations%rowtype;
  k record; ev jsonb; v_expected_review text; v_expected_fp text; v_signers text;
  v_p8a uuid; v_p8b uuid;
  v_row public.pcart_production_execution_permits;
BEGIN
  IF _actor IS NULL OR NOT public.is_platform_owner(_actor) THEN
    RAISE EXCEPTION 'Only the platform owner can prepare the PCART final send' USING ERRCODE = '42501';
  END IF;
  IF v_fp !~ '^0x[0-9a-f]{64}$' THEN RAISE EXCEPTION 'Invalid unsigned transaction fingerprint' USING ERRCODE = '22023'; END IF;
  IF _gas_limit IS NULL OR _gas_limit <= 0 OR _gas_limit > 30000000
     OR _max_fee_per_gas IS NULL OR _max_fee_per_gas <= 0
     OR _max_priority_fee_per_gas IS NULL OR _max_priority_fee_per_gas < 0
     OR _max_priority_fee_per_gas > _max_fee_per_gas
     OR _max_fee_per_gas <> trunc(_max_fee_per_gas) OR _max_priority_fee_per_gas <> trunc(_max_priority_fee_per_gas) THEN
    RAISE EXCEPTION 'Invalid gas or fee snapshot' USING ERRCODE = '22023';
  END IF;

  SELECT * INTO d FROM public.launch_chain_deployments WHERE id = _deployment_id FOR UPDATE;
  IF NOT FOUND OR NOT private.is_canonical_pcart_launch(d.launch_id) THEN
    RAISE EXCEPTION 'Not a canonical PCART production draft' USING ERRCODE = '42501';
  END IF;
  SELECT * INTO l FROM public.launches WHERE id = d.launch_id;
  IF l.chain IS DISTINCT FROM 'Robinhood Chain' THEN RAISE EXCEPTION 'Not the canonical PEPECARTEL launch' USING ERRCODE = '42501'; END IF;
  IF d.status IS DISTINCT FROM 'DRAFT' OR d.tx_hash IS NOT NULL OR d.submitted_at IS NOT NULL OR d.contract_address IS NOT NULL THEN
    RAISE EXCEPTION 'Only an unsent PCART production draft can be prepared for send' USING ERRCODE = '42501';
  END IF;
  IF d.chain_id IS DISTINCT FROM 4663 OR d.network_environment IS DISTINCT FROM 'PRODUCTION'
     OR d.artifact_id IS DISTINCT FROM 'pepecartel-token-v1' OR d.deployment_kind IS DISTINCT FROM 'FIXED_SUPPLY_ERC20'
     OR d.token_name IS DISTINCT FROM 'PEPECARTEL' OR d.token_symbol IS DISTINCT FROM 'PCART'
     OR d.token_decimals IS DISTINCT FROM 18 OR d.token_total_supply IS DISTINCT FROM c_supply THEN
    RAISE EXCEPTION 'Draft does not match the frozen PCART production intent' USING ERRCODE = '42501';
  END IF;
  IF lower(d.token_recipient) IS DISTINCT FROM c_safe THEN RAISE EXCEPTION 'Draft recipient is not the verified Treasury Safe' USING ERRCODE = '42501'; END IF;
  IF d.deployer_nonce_before IS NULL OR d.deployer_nonce_before < 0 OR d.init_code_hash IS NULL OR d.review_fingerprint IS NULL THEN
    RAISE EXCEPTION 'Draft is missing reviewed evidence' USING ERRCODE = '42501';
  END IF;
  IF lower(d.init_code_hash) IS DISTINCT FROM c_init_hash THEN RAISE EXCEPTION 'Draft init code hash does not match the frozen artifact' USING ERRCODE = '42501'; END IF;

  SELECT * INTO a FROM public.pcart_production_readiness_approvals WHERE launch_id = d.launch_id AND artifact_id = 'pepecartel-token-v1';
  IF NOT FOUND OR lower(a.safe_address) IS DISTINCT FROM c_safe THEN RAISE EXCEPTION 'Production readiness approval is missing or mismatched' USING ERRCODE = '42501'; END IF;
  ev := private.pcart_production_readiness_evidence(d.launch_id, false);
  IF NOT coalesce((ev->>'ok')::boolean, false) OR a.readiness_fingerprint IS DISTINCT FROM ev->>'fingerprint' THEN
    RAISE EXCEPTION 'Readiness evidence no longer matches (%)', coalesce(ev->>'reason', 'FINGERPRINT') USING ERRCODE = '42501';
  END IF;

  SELECT * INTO s FROM public.launch_treasury_signer_configs WHERE launch_id = d.launch_id;
  IF NOT FOUND OR lower(s.safe_address) IS DISTINCT FROM c_safe OR s.threshold IS DISTINCT FROM 2
     OR lower(d.deployer_address) = c_safe
     OR lower(d.deployer_address) NOT IN (lower(s.signer_1), lower(s.signer_2), lower(s.signer_3)) THEN
    RAISE EXCEPTION 'Deployer is no longer one of the three verified Treasury signers' USING ERRCODE = '42501';
  END IF;
  SELECT string_agg(x, ',' ORDER BY x COLLATE "C") INTO v_signers FROM unnest(ARRAY[lower(s.signer_1), lower(s.signer_2), lower(s.signer_3)]) x;
  IF v_signers IS DISTINCT FROM c_owners THEN RAISE EXCEPTION 'Configured signers differ from the pinned Safe owner set' USING ERRCODE = '42501'; END IF;

  v_expected_review := '0x' || encode(sha256(convert_to(concat_ws('|',
      'pcart-production-review-v1', lower(d.launch_id::text), 'pepecartel-token-v1', '4663', 'PRODUCTION',
      'PEPECARTEL', 'PCART', '18', '1000000000000000000000000000',
      c_safe, lower(d.deployer_address), d.deployer_nonce_before::text, lower(d.init_code_hash), lower(a.readiness_fingerprint)), 'UTF8')), 'hex');
  IF lower(d.review_fingerprint) IS DISTINCT FROM v_expected_review THEN
    RAISE EXCEPTION 'Review fingerprint no longer matches; abandon and review again' USING ERRCODE = '42501';
  END IF;

  SELECT * INTO p FROM public.pcart_production_preparation_authorizations WHERE id = _preparation_authorization_id;
  IF NOT FOUND OR p.deployment_id IS DISTINCT FROM d.id
     OR p.wallet_account IS DISTINCT FROM lower(d.deployer_address)
     OR p.deployer_address IS DISTINCT FROM lower(d.deployer_address)
     OR p.deployer_nonce_before IS DISTINCT FROM d.deployer_nonce_before
     OR p.safe_address IS DISTINCT FROM c_safe
     OR p.init_code_hash IS DISTINCT FROM lower(d.init_code_hash)
     OR p.review_fingerprint IS DISTINCT FROM lower(d.review_fingerprint)
     OR p.readiness_fingerprint IS DISTINCT FROM lower(a.readiness_fingerprint)
     OR p.predicted_contract_address !~ '^0x[0-9a-f]{40}$' THEN
    RAISE EXCEPTION 'Wallet preparation does not match this draft' USING ERRCODE = '42501';
  END IF;
  IF p.cancelled_at IS NOT NULL OR p.expires_at <= now() OR p.issued_at < now() - interval '90 seconds' THEN
    RAISE EXCEPTION 'Wallet preparation expired or cancelled; re-authorize wallet preparation' USING ERRCODE = '42501';
  END IF;

  IF l.official_contract_address IS NOT NULL OR l.official_contract_deployment_id IS NOT NULL
     OR EXISTS (SELECT 1 FROM public.launch_contract_registration_events r WHERE r.launch_id = d.launch_id) THEN
    RAISE EXCEPTION 'An official contract is already registered' USING ERRCODE = '42501';
  END IF;

  -- CANONICAL_PCART_PROTECTED: global execution must stay OFF with emergency stop ON; bind the revision.
  SELECT * INTO k FROM public.launch_chain_production_execution_controls WHERE control_key = 'ROBINHOOD_MAINNET_DEPLOYMENT' FOR SHARE;
  IF NOT FOUND OR k.execution_enabled IS DISTINCT FROM false OR k.emergency_stop_engaged IS DISTINCT FROM true OR k.revision IS NULL THEN
    RAISE EXCEPTION 'Global mainnet execution must remain locked' USING ERRCODE = '42501';
  END IF;

  v_p8a := private.pcart_p9_2_current_policy_review(d.launch_id, 'P8A');
  v_p8b := private.pcart_p9_2_current_policy_review(d.launch_id, 'P8B');
  IF v_p8a IS NULL THEN RAISE EXCEPTION 'P9.2 binding: P8A approval is not manifest-current' USING ERRCODE = '42501'; END IF;
  IF v_p8b IS NULL THEN RAISE EXCEPTION 'P9.2 binding: P8B approval is not manifest-current' USING ERRCODE = '42501'; END IF;
  IF lower(coalesce(_dependency_attestation_fingerprint, '')) IS DISTINCT FROM c_dep_fp THEN
    RAISE EXCEPTION 'P9.2 binding: live dependency attestation mismatch' USING ERRCODE = '42501';
  END IF;
  IF _safe_nonce IS NULL OR _safe_nonce < 0
     OR lower(coalesce(_safe_attestation_fingerprint, '')) IS DISTINCT FROM private.pcart_p9_2_safe_attestation(c_owners, _safe_nonce) THEN
    RAISE EXCEPTION 'P9.2 binding: live Treasury Safe attestation mismatch' USING ERRCODE = '42501';
  END IF;

  IF EXISTS (SELECT 1 FROM public.launch_chain_deployments x
              WHERE x.launch_id = d.launch_id AND x.id <> d.id
                AND (x.network_environment = 'PRODUCTION' OR x.chain_id = 4663)
                AND x.status IN ('DRAFT','SUBMITTED','PENDING','CONFIRMED')) THEN
    RAISE EXCEPTION 'Another PCART production attempt exists' USING ERRCODE = '42501';
  END IF;
  IF EXISTS (SELECT 1 FROM public.launch_chain_production_send_window_issuances w WHERE w.deployment_id = d.id)
     OR EXISTS (SELECT 1 FROM public.launch_chain_production_canary_permits c WHERE c.deployment_id = d.id)
     OR EXISTS (SELECT 1 FROM public.launch_chain_production_presign_authorizations g WHERE g.deployment_id = d.id) THEN
    RAISE EXCEPTION 'A generic send window, canary permit or presign exists for this draft' USING ERRCODE = '42501';
  END IF;
  IF EXISTS (SELECT 1 FROM public.pcart_production_send_claims c WHERE c.deployment_id = d.id AND c.claim_status <> 'RELEASED') THEN
    RAISE EXCEPTION 'A PCART send claim already exists for this draft' USING ERRCODE = '23505';
  END IF;
  IF EXISTS (SELECT 1 FROM public.pcart_production_execution_permits e WHERE e.deployment_id = d.id AND e.consumed_at IS NOT NULL
               AND NOT EXISTS (SELECT 1 FROM public.pcart_production_send_claims c WHERE c.permit_id = e.id AND c.claim_status = 'RELEASED')) THEN
    RAISE EXCEPTION 'A consumed permit already exists for this draft' USING ERRCODE = '42501';
  END IF;

  v_expected_fp := private.pcart_unsigned_tx_fingerprint(
    d.id, d.launch_id, lower(d.deployer_address), d.deployer_nonce_before, lower(d.init_code_hash),
    _gas_limit, _max_fee_per_gas, _max_priority_fee_per_gas, c_safe, p.predicted_contract_address,
    lower(d.review_fingerprint), lower(a.readiness_fingerprint));
  IF v_fp IS DISTINCT FROM v_expected_fp THEN
    RAISE EXCEPTION 'Unsigned transaction fingerprint does not match the reviewed intent' USING ERRCODE = '42501';
  END IF;

  -- No silent regeneration: any active (unexpired, uncancelled, unconsumed) permit blocks a new one.
  IF EXISTS (SELECT 1 FROM public.pcart_production_execution_permits e
              WHERE e.deployment_id = d.id AND e.cancelled_at IS NULL AND e.consumed_at IS NULL AND e.expires_at > now()) THEN
    RAISE EXCEPTION 'A final send permit is already active for this draft' USING ERRCODE = '23505';
  END IF;

  INSERT INTO public.pcart_production_execution_permits (
    deployment_id, preparation_authorization_id, launch_id, wallet_account, deployer_nonce,
    safe_recipient, predicted_contract_address, init_code_hash, review_fingerprint, readiness_fingerprint,
    unsigned_tx_fingerprint, gas_limit, max_fee_per_gas, max_priority_fee_per_gas, issued_by, issued_at, expires_at,
    binding_version, action_type, p8a_manifest_version, p8a_manifest_fingerprint, p8a_review_id,
    p8b_manifest_version, p8b_manifest_fingerprint, p8b_review_id,
    dependency_attestation_fingerprint, safe_attestation_fingerprint, safe_nonce, execution_control_revision
  ) VALUES (
    d.id, p.id, d.launch_id, lower(d.deployer_address), d.deployer_nonce_before,
    c_safe, p.predicted_contract_address, lower(d.init_code_hash), lower(d.review_fingerprint), lower(a.readiness_fingerprint),
    v_fp, _gas_limit, _max_fee_per_gas, _max_priority_fee_per_gas, _actor, now(), now() + c_ttl,
    'P9_2_DEPLOY_V1', 'DEPLOY_OFFICIAL_PCART', 'pcart-auction-liquidity-p8a-v2', '0x320269f530f5f5d886dd3579c1f8866ebcc2f7affc8e888232edd070fb86e7e2', v_p8a,
    'pcart-auction-execution-p8b-v1', '0x78435a8789fe12d4985821e0e48d8ec0a2191fb9606d04ebb63b6bb16974f579', v_p8b,
    c_dep_fp, lower(_safe_attestation_fingerprint), _safe_nonce, k.revision
  ) RETURNING * INTO v_row;
  RETURN v_row;
END $$;

CREATE OR REPLACE FUNCTION public.claim_canonical_pcart_mainnet_send_v2(
  _actor uuid, _permit_id uuid, _dependency_attestation_fingerprint text, _safe_attestation_fingerprint text
) RETURNS public.pcart_production_send_claims
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  c_safe constant text := '0xe0d055b3e07c2d1d9c1762ca9e19b3062207ad03';
  c_init_hash constant text := '0x3482c250d8500b20f731938be3cf2eab39e59b9fa7aff21ffb5085e1ceddd818';
  c_supply constant numeric := 1000000000000000000000000000;
  e public.pcart_production_execution_permits%rowtype;
  d public.launch_chain_deployments%rowtype;
  l public.launches%rowtype;
  a public.pcart_production_readiness_approvals%rowtype;
  s public.launch_treasury_signer_configs%rowtype;
  p public.pcart_production_preparation_authorizations%rowtype;
  k record; ev jsonb; v_fp text;
  v_row public.pcart_production_send_claims;
BEGIN
  IF _actor IS NULL OR NOT public.is_platform_owner(_actor) THEN
    RAISE EXCEPTION 'Only the platform owner can claim the PCART mainnet send' USING ERRCODE = '42501';
  END IF;
  SELECT * INTO e FROM public.pcart_production_execution_permits WHERE id = _permit_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Permit not found' USING ERRCODE = '42501'; END IF;
  IF e.binding_version IS DISTINCT FROM 'P9_2_DEPLOY_V1' OR e.action_type IS DISTINCT FROM 'DEPLOY_OFFICIAL_PCART' THEN
    RAISE EXCEPTION 'P9.2 binding: legacy or unbound permit cannot authorize a canonical send' USING ERRCODE = '42501';
  END IF;

  SELECT * INTO v_row FROM public.pcart_production_send_claims WHERE permit_id = e.id;
  IF FOUND THEN
    IF v_row.claim_status = 'CLAIMED' AND v_row.claimed_by = _actor THEN RETURN v_row; END IF;
    RAISE EXCEPTION 'This permit was already used' USING ERRCODE = '23505';
  END IF;
  IF e.cancelled_at IS NOT NULL OR e.consumed_at IS NOT NULL OR e.expires_at < now() + interval '10 seconds' THEN
    RAISE EXCEPTION 'Final send permit expired, used or cancelled; run P3/P4 again' USING ERRCODE = '42501';
  END IF;
  IF e.chain_id IS DISTINCT FROM 4663 THEN RAISE EXCEPTION 'P9.2 binding: chain mismatch' USING ERRCODE = '42501'; END IF;

  SELECT * INTO d FROM public.launch_chain_deployments WHERE id = e.deployment_id FOR UPDATE;
  IF NOT FOUND OR NOT private.is_canonical_pcart_launch(d.launch_id) OR d.launch_id <> e.launch_id THEN
    RAISE EXCEPTION 'Not a canonical PCART production draft' USING ERRCODE = '42501';
  END IF;
  SELECT * INTO l FROM public.launches WHERE id = d.launch_id FOR SHARE;
  IF l.chain IS DISTINCT FROM 'Robinhood Chain' THEN RAISE EXCEPTION 'Not the canonical PEPECARTEL launch' USING ERRCODE = '42501'; END IF;
  IF l.status IS DISTINCT FROM 'LAUNCH_APPROACHING' THEN RAISE EXCEPTION 'Launch lifecycle must be LAUNCH_APPROACHING' USING ERRCODE = '42501'; END IF;
  IF l.launch_window_start IS NULL OR l.launch_window_end IS NULL OR l.launch_window_start >= l.launch_window_end
     OR now() < l.launch_window_start OR now() > l.launch_window_end THEN
    RAISE EXCEPTION 'Mainnet send is only available inside the launch window' USING ERRCODE = '42501';
  END IF;
  IF d.status IS DISTINCT FROM 'DRAFT' OR d.tx_hash IS NOT NULL OR d.submitted_at IS NOT NULL OR d.contract_address IS NOT NULL THEN
    RAISE EXCEPTION 'Only an unsent PCART production draft can be claimed' USING ERRCODE = '42501';
  END IF;
  IF d.chain_id IS DISTINCT FROM 4663 OR d.network_environment IS DISTINCT FROM 'PRODUCTION'
     OR d.artifact_id IS DISTINCT FROM 'pepecartel-token-v1' OR d.deployment_kind IS DISTINCT FROM 'FIXED_SUPPLY_ERC20'
     OR d.token_name IS DISTINCT FROM 'PEPECARTEL' OR d.token_symbol IS DISTINCT FROM 'PCART'
     OR d.token_decimals IS DISTINCT FROM 18 OR d.token_total_supply IS DISTINCT FROM c_supply
     OR lower(d.token_recipient) IS DISTINCT FROM c_safe
     OR lower(d.init_code_hash) IS DISTINCT FROM c_init_hash
     OR d.deployer_nonce_before IS NULL OR d.review_fingerprint IS NULL THEN
    RAISE EXCEPTION 'Draft does not match the frozen PCART production intent' USING ERRCODE = '42501';
  END IF;

  SELECT * INTO a FROM public.pcart_production_readiness_approvals WHERE launch_id = d.launch_id AND artifact_id = 'pepecartel-token-v1';
  IF NOT FOUND OR lower(a.safe_address) IS DISTINCT FROM c_safe THEN RAISE EXCEPTION 'Production readiness approval is missing or mismatched' USING ERRCODE = '42501'; END IF;
  ev := private.pcart_production_readiness_evidence(d.launch_id, false);
  IF NOT coalesce((ev->>'ok')::boolean, false) OR a.readiness_fingerprint IS DISTINCT FROM ev->>'fingerprint' THEN
    RAISE EXCEPTION 'Readiness evidence no longer matches' USING ERRCODE = '42501';
  END IF;
  SELECT * INTO s FROM public.launch_treasury_signer_configs WHERE launch_id = d.launch_id;
  IF NOT FOUND OR lower(s.safe_address) IS DISTINCT FROM c_safe OR s.threshold IS DISTINCT FROM 2
     OR lower(d.deployer_address) = c_safe
     OR lower(d.deployer_address) NOT IN (lower(s.signer_1), lower(s.signer_2), lower(s.signer_3)) THEN
    RAISE EXCEPTION 'Deployer is no longer one of the three verified Treasury signers' USING ERRCODE = '42501';
  END IF;

  IF e.wallet_account IS DISTINCT FROM lower(d.deployer_address) OR e.deployer_nonce IS DISTINCT FROM d.deployer_nonce_before
     OR e.safe_recipient IS DISTINCT FROM c_safe OR e.init_code_hash IS DISTINCT FROM lower(d.init_code_hash)
     OR e.review_fingerprint IS DISTINCT FROM lower(d.review_fingerprint)
     OR e.readiness_fingerprint IS DISTINCT FROM lower(a.readiness_fingerprint) THEN
    RAISE EXCEPTION 'P9.2 binding: permit does not match the draft' USING ERRCODE = '42501';
  END IF;
  v_fp := private.pcart_unsigned_tx_fingerprint(d.id, d.launch_id, e.wallet_account, e.deployer_nonce, e.init_code_hash,
    e.gas_limit, e.max_fee_per_gas, e.max_priority_fee_per_gas, c_safe, e.predicted_contract_address,
    e.review_fingerprint, e.readiness_fingerprint);
  IF v_fp IS DISTINCT FROM e.unsigned_tx_fingerprint THEN RAISE EXCEPTION 'P9.2 binding: permit fingerprint does not match' USING ERRCODE = '42501'; END IF;

  SELECT * INTO p FROM public.pcart_production_preparation_authorizations WHERE id = e.preparation_authorization_id;
  IF NOT FOUND OR p.deployment_id IS DISTINCT FROM d.id OR p.wallet_account IS DISTINCT FROM e.wallet_account
     OR p.predicted_contract_address IS DISTINCT FROM e.predicted_contract_address
     OR p.cancelled_at IS NOT NULL OR p.expires_at <= now() THEN
    RAISE EXCEPTION 'Wallet preparation expired or mismatched; run P3/P4 again' USING ERRCODE = '42501';
  END IF;

  IF l.official_contract_address IS NOT NULL OR l.official_contract_deployment_id IS NOT NULL
     OR EXISTS (SELECT 1 FROM public.launch_contract_registration_events r WHERE r.launch_id = d.launch_id) THEN
    RAISE EXCEPTION 'An official contract is already registered' USING ERRCODE = '42501';
  END IF;
  SELECT * INTO k FROM public.launch_chain_production_execution_controls WHERE control_key = 'ROBINHOOD_MAINNET_DEPLOYMENT' FOR SHARE;
  IF NOT FOUND OR k.execution_enabled IS DISTINCT FROM false OR k.emergency_stop_engaged IS DISTINCT FROM true THEN
    RAISE EXCEPTION 'Global mainnet execution must remain locked' USING ERRCODE = '42501';
  END IF;
  IF k.revision IS DISTINCT FROM e.execution_control_revision THEN
    RAISE EXCEPTION 'P9.2 binding: execution-control revision changed' USING ERRCODE = '42501';
  END IF;
  IF private.pcart_p9_2_current_policy_review(d.launch_id, 'P8A') IS DISTINCT FROM e.p8a_review_id
     OR e.p8a_manifest_fingerprint IS DISTINCT FROM '0x320269f530f5f5d886dd3579c1f8866ebcc2f7affc8e888232edd070fb86e7e2' THEN
    RAISE EXCEPTION 'P9.2 binding: P8A approval changed' USING ERRCODE = '42501';
  END IF;
  IF private.pcart_p9_2_current_policy_review(d.launch_id, 'P8B') IS DISTINCT FROM e.p8b_review_id
     OR e.p8b_manifest_fingerprint IS DISTINCT FROM '0x78435a8789fe12d4985821e0e48d8ec0a2191fb9606d04ebb63b6bb16974f579' THEN
    RAISE EXCEPTION 'P9.2 binding: P8B approval changed' USING ERRCODE = '42501';
  END IF;
  IF lower(coalesce(_dependency_attestation_fingerprint, '')) IS DISTINCT FROM e.dependency_attestation_fingerprint THEN
    RAISE EXCEPTION 'P9.2 binding: live dependency attestation changed' USING ERRCODE = '42501';
  END IF;
  IF lower(coalesce(_safe_attestation_fingerprint, '')) IS DISTINCT FROM e.safe_attestation_fingerprint THEN
    RAISE EXCEPTION 'P9.2 binding: live Treasury Safe attestation changed' USING ERRCODE = '42501';
  END IF;
  IF EXISTS (SELECT 1 FROM public.launch_chain_production_send_window_issuances w WHERE w.deployment_id = d.id)
     OR EXISTS (SELECT 1 FROM public.launch_chain_production_canary_permits c WHERE c.deployment_id = d.id)
     OR EXISTS (SELECT 1 FROM public.launch_chain_production_presign_authorizations g WHERE g.deployment_id = d.id) THEN
    RAISE EXCEPTION 'A generic send stage exists for this draft' USING ERRCODE = '42501';
  END IF;
  IF EXISTS (SELECT 1 FROM public.pcart_production_send_claims c WHERE c.deployment_id = d.id AND c.claim_status <> 'RELEASED') THEN
    RAISE EXCEPTION 'A PCART send claim already exists for this draft' USING ERRCODE = '23505';
  END IF;

  UPDATE public.pcart_production_execution_permits SET consumed_at = now() WHERE id = e.id;
  INSERT INTO public.pcart_production_send_claims (
    deployment_id, permit_id, launch_id, wallet_account, deployer_nonce, predicted_contract_address, unsigned_tx_fingerprint, claimed_by
  ) VALUES (d.id, e.id, d.launch_id, e.wallet_account, e.deployer_nonce, e.predicted_contract_address, e.unsigned_tx_fingerprint, _actor)
  RETURNING * INTO v_row;
  RETURN v_row;
END $$;

-- Retire the legacy unbound entry points: an unbound permit can never authorize a canonical send.
CREATE OR REPLACE FUNCTION public.issue_canonical_pcart_execution_permit(
  _deployment_id uuid, _preparation_authorization_id uuid, _unsigned_tx_fingerprint text,
  _gas_limit bigint, _max_fee_per_gas numeric, _max_priority_fee_per_gas numeric
) RETURNS public.pcart_production_execution_permits LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
BEGIN RAISE EXCEPTION 'Superseded by P9.2 bound permit issuance' USING ERRCODE = '42501'; END $$;
CREATE OR REPLACE FUNCTION public.claim_canonical_pcart_mainnet_send(_permit_id uuid)
RETURNS public.pcart_production_send_claims LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
BEGIN RAISE EXCEPTION 'Superseded by P9.2 bound send claim' USING ERRCODE = '42501'; END $$;

REVOKE ALL ON FUNCTION public.issue_canonical_pcart_execution_permit(uuid, uuid, text, bigint, numeric, numeric) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.claim_canonical_pcart_mainnet_send(uuid) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.issue_canonical_pcart_execution_permit_v2(uuid, uuid, uuid, text, bigint, numeric, numeric, text, bigint, text) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.claim_canonical_pcart_mainnet_send_v2(uuid, uuid, text, text) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION private.pcart_p9_2_current_policy_review(uuid, text) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION private.pcart_p9_2_safe_attestation(text, bigint) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.issue_canonical_pcart_execution_permit_v2(uuid, uuid, uuid, text, bigint, numeric, numeric, text, bigint, text) TO service_role;
GRANT EXECUTE ON FUNCTION public.claim_canonical_pcart_mainnet_send_v2(uuid, uuid, text, text) TO service_role;