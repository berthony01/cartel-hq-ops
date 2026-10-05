-- PCART P4: READY TO SEND permit. NO send, NO signing, NO global execution-control change.
CREATE TABLE public.pcart_production_execution_permits (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  deployment_id uuid NOT NULL REFERENCES public.launch_chain_deployments(id) ON DELETE RESTRICT,
  preparation_authorization_id uuid NOT NULL REFERENCES public.pcart_production_preparation_authorizations(id) ON DELETE RESTRICT,
  launch_id uuid NOT NULL REFERENCES public.launches(id) ON DELETE RESTRICT,
  artifact_id text NOT NULL DEFAULT 'pepecartel-token-v1' CHECK (artifact_id = 'pepecartel-token-v1'),
  chain_id integer NOT NULL DEFAULT 4663 CHECK (chain_id = 4663),
  wallet_account text NOT NULL,
  deployer_nonce bigint NOT NULL CHECK (deployer_nonce >= 0),
  safe_recipient text NOT NULL,
  predicted_contract_address text NOT NULL,
  init_code_hash text NOT NULL,
  review_fingerprint text NOT NULL,
  readiness_fingerprint text NOT NULL,
  unsigned_tx_fingerprint text NOT NULL,
  gas_limit bigint NOT NULL CHECK (gas_limit > 0 AND gas_limit <= 30000000),
  max_fee_per_gas numeric(78,0) NOT NULL CHECK (max_fee_per_gas > 0),
  max_priority_fee_per_gas numeric(78,0) NOT NULL CHECK (max_priority_fee_per_gas >= 0),
  issued_by uuid NOT NULL,
  issued_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz NOT NULL,
  cancelled_at timestamptz,
  cancelled_by uuid,
  consumed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  CHECK (max_priority_fee_per_gas <= max_fee_per_gas),
  CHECK (expires_at > issued_at AND expires_at <= issued_at + interval '30 seconds'),
  CHECK (consumed_at IS NULL)
);
GRANT SELECT ON public.pcart_production_execution_permits TO authenticated;
GRANT ALL ON public.pcart_production_execution_permits TO service_role;
ALTER TABLE public.pcart_production_execution_permits ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Platform owner reads PCART execution permits"
  ON public.pcart_production_execution_permits FOR SELECT TO authenticated
  USING (public.is_platform_owner(auth.uid()));
CREATE INDEX pcart_production_execution_permits_deployment_idx
  ON public.pcart_production_execution_permits (deployment_id, issued_at DESC);

CREATE OR REPLACE FUNCTION private.enforce_pcart_execution_permit_immutable()
RETURNS trigger LANGUAGE plpgsql SET search_path = '' AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'PCART execution permits cannot be deleted' USING ERRCODE = '42501';
  END IF;
  IF OLD.cancelled_at IS NOT NULL
     OR NEW.cancelled_at IS NULL OR NEW.cancelled_by IS NULL
     OR (to_jsonb(NEW) - 'cancelled_at' - 'cancelled_by') IS DISTINCT FROM (to_jsonb(OLD) - 'cancelled_at' - 'cancelled_by') THEN
    RAISE EXCEPTION 'PCART execution permits are immutable except one cancellation' USING ERRCODE = '42501';
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER pcart_execution_permit_immutable
  BEFORE UPDATE OR DELETE ON public.pcart_production_execution_permits
  FOR EACH ROW EXECUTE FUNCTION private.enforce_pcart_execution_permit_immutable();

-- Must stay byte-identical to pcartUnsignedTxFingerprintPreimage() in src/lib/pcart-production-execution.ts
CREATE OR REPLACE FUNCTION private.pcart_unsigned_tx_fingerprint(
  _deployment_id uuid, _launch_id uuid, _from text, _nonce bigint, _init_code_hash text,
  _gas_limit bigint, _max_fee numeric, _max_priority numeric, _safe text, _predicted text,
  _review_fp text, _readiness_fp text
) RETURNS text LANGUAGE sql IMMUTABLE SET search_path = '' AS $$
  SELECT '0x' || encode(extensions.digest(convert_to(concat_ws('|',
    'pcart-unsigned-tx-v1', lower(_deployment_id::text), lower(_launch_id::text), 'pepecartel-token-v1', '4663',
    lower(_from), 'CREATE', '0', _nonce::text, lower(_init_code_hash), _gas_limit::text,
    _max_fee::text, _max_priority::text, lower(_safe), lower(_predicted), lower(_review_fp), lower(_readiness_fp)
  ), 'UTF8'), 'sha256'), 'hex')
$$;

CREATE OR REPLACE FUNCTION public.issue_canonical_pcart_execution_permit(
  _deployment_id uuid,
  _preparation_authorization_id uuid,
  _unsigned_tx_fingerprint text,
  _gas_limit bigint,
  _max_fee_per_gas numeric,
  _max_priority_fee_per_gas numeric
) RETURNS public.pcart_production_execution_permits
LANGUAGE plpgsql SECURITY DEFINER SET search_path = ''
AS $$
DECLARE
  c_safe constant text := '0xe0d055b3e07c2d1d9c1762ca9e19b3062207ad03';
  c_init_hash constant text := '0x3482c250d8500b20f731938be3cf2eab39e59b9fa7aff21ffb5085e1ceddd818';
  c_supply constant numeric := 1000000000000000000000000000;
  c_ttl constant interval := interval '30 seconds';
  v_fp text := lower(btrim(coalesce(_unsigned_tx_fingerprint, '')));
  d public.launch_chain_deployments%rowtype;
  l public.launches%rowtype;
  a public.pcart_production_readiness_approvals%rowtype;
  s public.launch_treasury_signer_configs%rowtype;
  p public.pcart_production_preparation_authorizations%rowtype;
  k record;
  ev jsonb;
  v_expected_review text;
  v_expected_fp text;
  v_row public.pcart_production_execution_permits;
BEGIN
  IF auth.uid() IS NULL OR NOT public.is_platform_owner(auth.uid()) THEN
    RAISE EXCEPTION 'Only the platform owner can prepare the PCART final send' USING ERRCODE = '42501';
  END IF;
  IF v_fp !~ '^0x[0-9a-f]{64}$' THEN
    RAISE EXCEPTION 'Invalid unsigned transaction fingerprint' USING ERRCODE = '22023';
  END IF;
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
  IF l.chain IS DISTINCT FROM 'Robinhood Chain' THEN
    RAISE EXCEPTION 'Not the canonical PEPECARTEL launch' USING ERRCODE = '42501';
  END IF;
  IF d.status IS DISTINCT FROM 'DRAFT' OR d.tx_hash IS NOT NULL OR d.submitted_at IS NOT NULL OR d.contract_address IS NOT NULL THEN
    RAISE EXCEPTION 'Only an unsent PCART production draft can be prepared for send' USING ERRCODE = '42501';
  END IF;
  IF d.chain_id IS DISTINCT FROM 4663 OR d.network_environment IS DISTINCT FROM 'PRODUCTION'
     OR d.artifact_id IS DISTINCT FROM 'pepecartel-token-v1' OR d.deployment_kind IS DISTINCT FROM 'FIXED_SUPPLY_ERC20'
     OR d.token_name IS DISTINCT FROM 'PEPECARTEL' OR d.token_symbol IS DISTINCT FROM 'PCART'
     OR d.token_decimals IS DISTINCT FROM 18 OR d.token_total_supply IS DISTINCT FROM c_supply THEN
    RAISE EXCEPTION 'Draft does not match the frozen PCART production intent' USING ERRCODE = '42501';
  END IF;
  IF lower(d.token_recipient) IS DISTINCT FROM c_safe THEN
    RAISE EXCEPTION 'Draft recipient is not the verified Treasury Safe' USING ERRCODE = '42501';
  END IF;
  IF d.deployer_nonce_before IS NULL OR d.deployer_nonce_before < 0 OR d.init_code_hash IS NULL OR d.review_fingerprint IS NULL THEN
    RAISE EXCEPTION 'Draft is missing reviewed evidence' USING ERRCODE = '42501';
  END IF;
  IF lower(d.init_code_hash) IS DISTINCT FROM c_init_hash THEN
    RAISE EXCEPTION 'Draft init code hash does not match the frozen artifact' USING ERRCODE = '42501';
  END IF;

  SELECT * INTO a FROM public.pcart_production_readiness_approvals
   WHERE launch_id = d.launch_id AND artifact_id = 'pepecartel-token-v1';
  IF NOT FOUND OR lower(a.safe_address) IS DISTINCT FROM c_safe THEN
    RAISE EXCEPTION 'Production readiness approval is missing or mismatched' USING ERRCODE = '42501';
  END IF;
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

  v_expected_review := '0x' || encode(sha256(convert_to(concat_ws('|',
      'pcart-production-review-v1', lower(d.launch_id::text), 'pepecartel-token-v1', '4663', 'PRODUCTION',
      'PEPECARTEL', 'PCART', '18', '1000000000000000000000000000',
      c_safe, lower(d.deployer_address), d.deployer_nonce_before::text, lower(d.init_code_hash), lower(a.readiness_fingerprint)), 'UTF8')), 'hex');
  IF lower(d.review_fingerprint) IS DISTINCT FROM v_expected_review THEN
    RAISE EXCEPTION 'Review fingerprint no longer matches; abandon and review again' USING ERRCODE = '42501';
  END IF;

  -- Active P3 wallet preparation for the same draft, wallet and fingerprints.
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

  SELECT * INTO k FROM public.launch_chain_production_execution_controls WHERE control_key = 'ROBINHOOD_MAINNET_DEPLOYMENT';
  IF NOT FOUND OR k.execution_enabled IS DISTINCT FROM false OR k.emergency_stop_engaged IS DISTINCT FROM true THEN
    RAISE EXCEPTION 'Global mainnet execution must remain locked' USING ERRCODE = '42501';
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
  IF EXISTS (SELECT 1 FROM public.pcart_production_execution_permits e WHERE e.deployment_id = d.id AND e.consumed_at IS NOT NULL) THEN
    RAISE EXCEPTION 'A consumed permit already exists for this draft' USING ERRCODE = '42501';
  END IF;

  v_expected_fp := private.pcart_unsigned_tx_fingerprint(
    d.id, d.launch_id, lower(d.deployer_address), d.deployer_nonce_before, lower(d.init_code_hash),
    _gas_limit, _max_fee_per_gas, _max_priority_fee_per_gas, c_safe, p.predicted_contract_address,
    lower(d.review_fingerprint), lower(a.readiness_fingerprint));
  IF v_fp IS DISTINCT FROM v_expected_fp THEN
    RAISE EXCEPTION 'Unsigned transaction fingerprint does not match the reviewed intent' USING ERRCODE = '42501';
  END IF;

  SELECT * INTO v_row FROM public.pcart_production_execution_permits e
   WHERE e.deployment_id = d.id AND e.cancelled_at IS NULL AND e.expires_at > now()
   ORDER BY e.issued_at DESC LIMIT 1;
  IF FOUND THEN
    IF v_row.unsigned_tx_fingerprint = v_fp AND v_row.preparation_authorization_id = p.id THEN
      RETURN v_row;
    END IF;
    RAISE EXCEPTION 'A final send permit is already active for this draft' USING ERRCODE = '23505';
  END IF;

  INSERT INTO public.pcart_production_execution_permits (
    deployment_id, preparation_authorization_id, launch_id, wallet_account, deployer_nonce,
    safe_recipient, predicted_contract_address, init_code_hash, review_fingerprint, readiness_fingerprint,
    unsigned_tx_fingerprint, gas_limit, max_fee_per_gas, max_priority_fee_per_gas, issued_by, issued_at, expires_at
  ) VALUES (
    d.id, p.id, d.launch_id, lower(d.deployer_address), d.deployer_nonce_before,
    c_safe, p.predicted_contract_address, lower(d.init_code_hash), lower(d.review_fingerprint), lower(a.readiness_fingerprint),
    v_fp, _gas_limit, _max_fee_per_gas, _max_priority_fee_per_gas, auth.uid(), now(), now() + c_ttl
  ) RETURNING * INTO v_row;
  RETURN v_row;
END;
$$;

CREATE OR REPLACE FUNCTION public.cancel_canonical_pcart_execution_permit(_permit_id uuid)
RETURNS public.pcart_production_execution_permits
LANGUAGE plpgsql SECURITY DEFINER SET search_path = ''
AS $$
DECLARE v_row public.pcart_production_execution_permits;
BEGIN
  IF auth.uid() IS NULL OR NOT public.is_platform_owner(auth.uid()) THEN
    RAISE EXCEPTION 'Only the platform owner can cancel a PCART final send permit' USING ERRCODE = '42501';
  END IF;
  SELECT * INTO v_row FROM public.pcart_production_execution_permits WHERE id = _permit_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Permit not found' USING ERRCODE = '42501';
  END IF;
  IF v_row.cancelled_at IS NOT NULL THEN RETURN v_row; END IF;
  UPDATE public.pcart_production_execution_permits
     SET cancelled_at = now(), cancelled_by = auth.uid()
   WHERE id = _permit_id
   RETURNING * INTO v_row;
  RETURN v_row;
END;
$$;

REVOKE ALL ON FUNCTION public.issue_canonical_pcart_execution_permit(uuid, uuid, text, bigint, numeric, numeric) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.cancel_canonical_pcart_execution_permit(uuid) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION private.enforce_pcart_execution_permit_immutable() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION private.pcart_unsigned_tx_fingerprint(uuid, uuid, text, bigint, text, bigint, numeric, numeric, text, text, text, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.issue_canonical_pcart_execution_permit(uuid, uuid, text, bigint, numeric, numeric) TO authenticated;
GRANT EXECUTE ON FUNCTION public.cancel_canonical_pcart_execution_permit(uuid) TO authenticated;