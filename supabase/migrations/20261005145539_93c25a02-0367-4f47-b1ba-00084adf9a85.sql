-- PCART P5: one-time mainnet send claim. No global execution-control change.
CREATE TABLE public.pcart_production_send_claims (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  deployment_id uuid NOT NULL REFERENCES public.launch_chain_deployments(id) ON DELETE RESTRICT,
  permit_id uuid NOT NULL UNIQUE REFERENCES public.pcart_production_execution_permits(id) ON DELETE RESTRICT,
  launch_id uuid NOT NULL REFERENCES public.launches(id) ON DELETE RESTRICT,
  wallet_account text NOT NULL CHECK (wallet_account ~ '^0x[0-9a-f]{40}$'),
  chain_id integer NOT NULL DEFAULT 4663 CHECK (chain_id = 4663),
  deployer_nonce bigint NOT NULL CHECK (deployer_nonce >= 0),
  predicted_contract_address text NOT NULL CHECK (predicted_contract_address ~ '^0x[0-9a-f]{40}$'),
  unsigned_tx_fingerprint text NOT NULL CHECK (unsigned_tx_fingerprint ~ '^0x[0-9a-f]{64}$'),
  claim_status text NOT NULL DEFAULT 'CLAIMED' CHECK (claim_status IN ('CLAIMED','BROADCAST','RELEASED','AMBIGUOUS')),
  tx_hash text UNIQUE CHECK (tx_hash IS NULL OR tx_hash ~ '^0x[0-9a-f]{64}$'),
  claimed_by uuid NOT NULL,
  claimed_at timestamptz NOT NULL DEFAULT now(),
  broadcast_at timestamptz,
  released_at timestamptz,
  release_reason text,
  last_recovery_checked_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CHECK ((claim_status = 'BROADCAST') = (tx_hash IS NOT NULL AND broadcast_at IS NOT NULL)),
  CHECK ((claim_status = 'RELEASED') = (released_at IS NOT NULL AND release_reason IS NOT NULL))
);
GRANT SELECT ON public.pcart_production_send_claims TO authenticated;
GRANT ALL ON public.pcart_production_send_claims TO service_role;
ALTER TABLE public.pcart_production_send_claims ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Platform owner reads PCART send claims"
  ON public.pcart_production_send_claims FOR SELECT TO authenticated
  USING (public.is_platform_owner(auth.uid()));
CREATE UNIQUE INDEX pcart_production_send_claims_one_live_per_deployment
  ON public.pcart_production_send_claims (deployment_id) WHERE claim_status <> 'RELEASED';

CREATE OR REPLACE FUNCTION private.enforce_pcart_send_claim_rules()
RETURNS trigger LANGUAGE plpgsql SET search_path = '' AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'PCART send claims cannot be deleted' USING ERRCODE = '42501';
  END IF;
  IF NEW.id <> OLD.id OR NEW.deployment_id <> OLD.deployment_id OR NEW.permit_id <> OLD.permit_id
     OR NEW.launch_id <> OLD.launch_id OR NEW.wallet_account <> OLD.wallet_account OR NEW.chain_id <> OLD.chain_id
     OR NEW.deployer_nonce <> OLD.deployer_nonce OR NEW.predicted_contract_address <> OLD.predicted_contract_address
     OR NEW.unsigned_tx_fingerprint <> OLD.unsigned_tx_fingerprint OR NEW.claimed_by <> OLD.claimed_by
     OR NEW.claimed_at <> OLD.claimed_at OR NEW.created_at <> OLD.created_at THEN
    RAISE EXCEPTION 'PCART send claim identity is immutable' USING ERRCODE = '42501';
  END IF;
  IF OLD.tx_hash IS NOT NULL AND NEW.tx_hash IS DISTINCT FROM OLD.tx_hash THEN
    RAISE EXCEPTION 'PCART transaction hash is immutable' USING ERRCODE = '42501';
  END IF;
  IF OLD.claim_status IN ('BROADCAST','RELEASED') THEN
    RAISE EXCEPTION 'PCART send claim is final' USING ERRCODE = '42501';
  END IF;
  IF NEW.claim_status <> OLD.claim_status AND NOT (
       (OLD.claim_status = 'CLAIMED' AND NEW.claim_status IN ('BROADCAST','RELEASED','AMBIGUOUS'))
    OR (OLD.claim_status = 'AMBIGUOUS' AND NEW.claim_status IN ('BROADCAST','RELEASED'))) THEN
    RAISE EXCEPTION 'Invalid PCART send claim transition % -> %', OLD.claim_status, NEW.claim_status USING ERRCODE = '42501';
  END IF;
  NEW.updated_at := now();
  RETURN NEW;
END;
$$;
CREATE TRIGGER pcart_send_claim_rules
  BEFORE UPDATE OR DELETE ON public.pcart_production_send_claims
  FOR EACH ROW EXECUTE FUNCTION private.enforce_pcart_send_claim_rules();

-- Permits: allow exactly one consumption (by the claim RPC) OR one cancellation.
ALTER TABLE public.pcart_production_execution_permits DROP CONSTRAINT pcart_production_execution_permits_consumed_at_check;
CREATE OR REPLACE FUNCTION private.enforce_pcart_execution_permit_immutable()
RETURNS trigger LANGUAGE plpgsql SET search_path = '' AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'PCART execution permits cannot be deleted' USING ERRCODE = '42501';
  END IF;
  IF OLD.cancelled_at IS NULL AND OLD.consumed_at IS NULL
     AND NEW.cancelled_at IS NOT NULL AND NEW.cancelled_by IS NOT NULL AND NEW.consumed_at IS NULL
     AND (to_jsonb(NEW) - 'cancelled_at' - 'cancelled_by') = (to_jsonb(OLD) - 'cancelled_at' - 'cancelled_by') THEN
    RETURN NEW;
  END IF;
  IF OLD.cancelled_at IS NULL AND OLD.consumed_at IS NULL
     AND NEW.consumed_at IS NOT NULL AND NEW.cancelled_at IS NULL
     AND (to_jsonb(NEW) - 'consumed_at') = (to_jsonb(OLD) - 'consumed_at') THEN
    RETURN NEW;
  END IF;
  RAISE EXCEPTION 'PCART execution permits are immutable except one cancellation or one consumption' USING ERRCODE = '42501';
END;
$$;

-- Re-issue after a RELEASED claim only (surgical text patch of the live P4 issue RPC).
DO $do$
DECLARE src text; patched text;
BEGIN
  src := pg_get_functiondef('public.issue_canonical_pcart_execution_permit(uuid,uuid,text,bigint,numeric,numeric)'::regprocedure);
  patched := replace(src,
    'WHERE e.deployment_id = d.id AND e.consumed_at IS NOT NULL) THEN',
    'WHERE e.deployment_id = d.id AND e.consumed_at IS NOT NULL AND NOT EXISTS (SELECT 1 FROM public.pcart_production_send_claims c WHERE c.permit_id = e.id AND c.claim_status = ''RELEASED'')) THEN');
  IF patched = src THEN
    RAISE EXCEPTION 'P5 patch anchor not found in issue_canonical_pcart_execution_permit';
  END IF;
  EXECUTE patched;
END;
$do$;

CREATE OR REPLACE FUNCTION public.claim_canonical_pcart_mainnet_send(_permit_id uuid)
RETURNS public.pcart_production_send_claims
LANGUAGE plpgsql SECURITY DEFINER SET search_path = ''
AS $$
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
  k record;
  ev jsonb;
  v_fp text;
  v_row public.pcart_production_send_claims;
BEGIN
  IF auth.uid() IS NULL OR NOT public.is_platform_owner(auth.uid()) THEN
    RAISE EXCEPTION 'Only the platform owner can claim the PCART mainnet send' USING ERRCODE = '42501';
  END IF;
  SELECT * INTO e FROM public.pcart_production_execution_permits WHERE id = _permit_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Permit not found' USING ERRCODE = '42501'; END IF;

  -- Idempotent replay of the same still-CLAIMED claim for this permit.
  SELECT * INTO v_row FROM public.pcart_production_send_claims WHERE permit_id = e.id;
  IF FOUND THEN
    IF v_row.claim_status = 'CLAIMED' AND v_row.claimed_by = auth.uid() THEN RETURN v_row; END IF;
    RAISE EXCEPTION 'This permit was already used' USING ERRCODE = '23505';
  END IF;

  IF e.cancelled_at IS NOT NULL OR e.consumed_at IS NOT NULL OR e.expires_at < now() + interval '10 seconds' THEN
    RAISE EXCEPTION 'Final send permit expired, used or cancelled; run P3/P4 again' USING ERRCODE = '42501';
  END IF;

  SELECT * INTO d FROM public.launch_chain_deployments WHERE id = e.deployment_id FOR UPDATE;
  IF NOT FOUND OR NOT private.is_canonical_pcart_launch(d.launch_id) OR d.launch_id <> e.launch_id THEN
    RAISE EXCEPTION 'Not a canonical PCART production draft' USING ERRCODE = '42501';
  END IF;
  SELECT * INTO l FROM public.launches WHERE id = d.launch_id FOR SHARE;
  IF l.chain IS DISTINCT FROM 'Robinhood Chain' THEN
    RAISE EXCEPTION 'Not the canonical PEPECARTEL launch' USING ERRCODE = '42501';
  END IF;
  IF l.status IS DISTINCT FROM 'LAUNCH_APPROACHING' THEN
    RAISE EXCEPTION 'Launch lifecycle must be LAUNCH_APPROACHING' USING ERRCODE = '42501';
  END IF;
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
  IF NOT FOUND OR lower(a.safe_address) IS DISTINCT FROM c_safe THEN
    RAISE EXCEPTION 'Production readiness approval is missing or mismatched' USING ERRCODE = '42501';
  END IF;
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

  -- Permit must exactly match the draft + readiness.
  IF e.wallet_account IS DISTINCT FROM lower(d.deployer_address) OR e.deployer_nonce IS DISTINCT FROM d.deployer_nonce_before
     OR e.safe_recipient IS DISTINCT FROM c_safe OR e.init_code_hash IS DISTINCT FROM lower(d.init_code_hash)
     OR e.review_fingerprint IS DISTINCT FROM lower(d.review_fingerprint)
     OR e.readiness_fingerprint IS DISTINCT FROM lower(a.readiness_fingerprint) THEN
    RAISE EXCEPTION 'Permit does not match the draft' USING ERRCODE = '42501';
  END IF;
  v_fp := private.pcart_unsigned_tx_fingerprint(d.id, d.launch_id, e.wallet_account, e.deployer_nonce, e.init_code_hash,
    e.gas_limit, e.max_fee_per_gas, e.max_priority_fee_per_gas, c_safe, e.predicted_contract_address,
    e.review_fingerprint, e.readiness_fingerprint);
  IF v_fp IS DISTINCT FROM e.unsigned_tx_fingerprint THEN
    RAISE EXCEPTION 'Permit fingerprint does not match' USING ERRCODE = '42501';
  END IF;

  -- Active P3 preparation for the same draft/wallet.
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
  SELECT * INTO k FROM public.launch_chain_production_execution_controls WHERE control_key = 'ROBINHOOD_MAINNET_DEPLOYMENT';
  IF NOT FOUND OR k.execution_enabled IS DISTINCT FROM false OR k.emergency_stop_engaged IS DISTINCT FROM true THEN
    RAISE EXCEPTION 'Global mainnet execution must remain locked' USING ERRCODE = '42501';
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
    deployment_id, permit_id, launch_id, wallet_account, deployer_nonce, predicted_contract_address,
    unsigned_tx_fingerprint, claimed_by
  ) VALUES (d.id, e.id, d.launch_id, e.wallet_account, e.deployer_nonce, e.predicted_contract_address,
    e.unsigned_tx_fingerprint, auth.uid())
  RETURNING * INTO v_row;
  RETURN v_row;
END;
$$;

CREATE OR REPLACE FUNCTION public.record_canonical_pcart_mainnet_tx_hash(_claim_id uuid, _tx_hash text)
RETURNS public.pcart_production_send_claims
LANGUAGE plpgsql SECURITY DEFINER SET search_path = ''
AS $$
DECLARE
  v_hash text := lower(btrim(coalesce(_tx_hash, '')));
  c public.pcart_production_send_claims%rowtype;
  d public.launch_chain_deployments%rowtype;
  e public.pcart_production_execution_permits%rowtype;
BEGIN
  IF auth.uid() IS NULL OR NOT public.is_platform_owner(auth.uid()) THEN
    RAISE EXCEPTION 'Only the platform owner can record the PCART transaction' USING ERRCODE = '42501';
  END IF;
  IF v_hash !~ '^0x[0-9a-f]{64}$' THEN
    RAISE EXCEPTION 'Invalid transaction hash' USING ERRCODE = '22023';
  END IF;
  SELECT * INTO c FROM public.pcart_production_send_claims WHERE id = _claim_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Claim not found' USING ERRCODE = '42501'; END IF;
  IF c.claim_status = 'BROADCAST' THEN
    IF c.tx_hash = v_hash THEN RETURN c; END IF;
    RAISE EXCEPTION 'A different transaction is already recorded' USING ERRCODE = '42501';
  END IF;
  IF c.claim_status NOT IN ('CLAIMED','AMBIGUOUS') THEN
    RAISE EXCEPTION 'Claim is not awaiting a transaction' USING ERRCODE = '42501';
  END IF;
  SELECT * INTO e FROM public.pcart_production_execution_permits WHERE id = c.permit_id;
  SELECT * INTO d FROM public.launch_chain_deployments WHERE id = c.deployment_id FOR UPDATE;
  IF d.status IS DISTINCT FROM 'DRAFT' OR d.tx_hash IS NOT NULL OR d.submitted_at IS NOT NULL
     OR lower(d.deployer_address) IS DISTINCT FROM c.wallet_account OR d.deployer_nonce_before IS DISTINCT FROM c.deployer_nonce
     OR e.deployment_id IS DISTINCT FROM d.id OR e.wallet_account IS DISTINCT FROM c.wallet_account
     OR e.deployer_nonce IS DISTINCT FROM c.deployer_nonce OR e.unsigned_tx_fingerprint IS DISTINCT FROM c.unsigned_tx_fingerprint
     OR e.consumed_at IS NULL THEN
    RAISE EXCEPTION 'Claim no longer matches the draft' USING ERRCODE = '42501';
  END IF;
  UPDATE public.pcart_production_send_claims
     SET claim_status = 'BROADCAST', tx_hash = v_hash, broadcast_at = now()
   WHERE id = c.id RETURNING * INTO c;
  UPDATE public.launch_chain_deployments
     SET status = 'SUBMITTED', tx_hash = v_hash, submitted_at = now()
   WHERE id = d.id;
  RETURN c;
END;
$$;

CREATE OR REPLACE FUNCTION public.mark_canonical_pcart_send_ambiguous(_claim_id uuid)
RETURNS public.pcart_production_send_claims
LANGUAGE plpgsql SECURITY DEFINER SET search_path = ''
AS $$
DECLARE c public.pcart_production_send_claims%rowtype;
BEGIN
  IF auth.uid() IS NULL OR NOT public.is_platform_owner(auth.uid()) THEN
    RAISE EXCEPTION 'Only the platform owner can update a PCART send claim' USING ERRCODE = '42501';
  END IF;
  SELECT * INTO c FROM public.pcart_production_send_claims WHERE id = _claim_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Claim not found' USING ERRCODE = '42501'; END IF;
  IF c.claim_status <> 'CLAIMED' THEN RETURN c; END IF;
  UPDATE public.pcart_production_send_claims SET claim_status = 'AMBIGUOUS' WHERE id = c.id RETURNING * INTO c;
  RETURN c;
END;
$$;

-- Service-only: the server function proves chain evidence with the managed RPC before calling these.
CREATE OR REPLACE FUNCTION public.note_canonical_pcart_send_recovery_check(_claim_id uuid, _operator_user_id uuid)
RETURNS public.pcart_production_send_claims
LANGUAGE plpgsql SECURITY DEFINER SET search_path = ''
AS $$
DECLARE c public.pcart_production_send_claims%rowtype;
BEGIN
  IF _operator_user_id IS NULL OR NOT public.is_platform_owner(_operator_user_id) THEN
    RAISE EXCEPTION 'Not authorized' USING ERRCODE = '42501';
  END IF;
  SELECT * INTO c FROM public.pcart_production_send_claims WHERE id = _claim_id FOR UPDATE;
  IF NOT FOUND OR c.claim_status NOT IN ('CLAIMED','AMBIGUOUS') THEN
    RAISE EXCEPTION 'Claim not open' USING ERRCODE = '42501';
  END IF;
  -- Keep the FIRST clean check time so the release delay is measured from it.
  IF c.last_recovery_checked_at IS NULL THEN
    UPDATE public.pcart_production_send_claims SET last_recovery_checked_at = now() WHERE id = c.id RETURNING * INTO c;
  END IF;
  RETURN c;
END;
$$;

CREATE OR REPLACE FUNCTION public.release_canonical_pcart_mainnet_send_claim(_claim_id uuid, _operator_user_id uuid, _mode text)
RETURNS public.pcart_production_send_claims
LANGUAGE plpgsql SECURITY DEFINER SET search_path = ''
AS $$
DECLARE
  c public.pcart_production_send_claims%rowtype;
  d public.launch_chain_deployments%rowtype;
BEGIN
  IF _operator_user_id IS NULL OR NOT public.is_platform_owner(_operator_user_id) THEN
    RAISE EXCEPTION 'Not authorized' USING ERRCODE = '42501';
  END IF;
  SELECT * INTO c FROM public.pcart_production_send_claims WHERE id = _claim_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Claim not found' USING ERRCODE = '42501'; END IF;
  SELECT * INTO d FROM public.launch_chain_deployments WHERE id = c.deployment_id FOR UPDATE;
  IF d.status IS DISTINCT FROM 'DRAFT' OR d.tx_hash IS NOT NULL OR c.tx_hash IS NOT NULL THEN
    RAISE EXCEPTION 'A transaction is recorded; claim cannot be released' USING ERRCODE = '42501';
  END IF;
  IF _mode = 'USER_REJECTED' THEN
    IF c.claim_status <> 'CLAIMED' THEN
      RAISE EXCEPTION 'Only an un-ambiguous claim can be released after a wallet rejection' USING ERRCODE = '42501';
    END IF;
  ELSIF _mode = 'AMBIGUOUS_CLEARED' THEN
    IF c.claim_status <> 'AMBIGUOUS' OR c.claimed_at > now() - interval '120 seconds'
       OR c.last_recovery_checked_at IS NULL OR c.last_recovery_checked_at > now() - interval '30 seconds' THEN
      RAISE EXCEPTION 'Unknown result cannot be cleared yet; check again later' USING ERRCODE = '42501';
    END IF;
  ELSE
    RAISE EXCEPTION 'Invalid release mode' USING ERRCODE = '22023';
  END IF;
  UPDATE public.pcart_production_send_claims
     SET claim_status = 'RELEASED', released_at = now(), release_reason = _mode
   WHERE id = c.id RETURNING * INTO c;
  RETURN c;
END;
$$;

REVOKE ALL ON FUNCTION private.enforce_pcart_send_claim_rules() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.claim_canonical_pcart_mainnet_send(uuid) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.record_canonical_pcart_mainnet_tx_hash(uuid, text) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.mark_canonical_pcart_send_ambiguous(uuid) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.note_canonical_pcart_send_recovery_check(uuid, uuid) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.release_canonical_pcart_mainnet_send_claim(uuid, uuid, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.claim_canonical_pcart_mainnet_send(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.record_canonical_pcart_mainnet_tx_hash(uuid, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.mark_canonical_pcart_send_ambiguous(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.note_canonical_pcart_send_recovery_check(uuid, uuid) TO service_role;
GRANT EXECUTE ON FUNCTION public.release_canonical_pcart_mainnet_send_claim(uuid, uuid, text) TO service_role;