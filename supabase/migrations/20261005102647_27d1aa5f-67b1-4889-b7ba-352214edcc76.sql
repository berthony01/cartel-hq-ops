-- PCART P3: wallet-ready preparation authorization. NO send window, NO canary permit,
-- NO arming, NO execution-control change, NO deployment-row mutation.
CREATE TABLE public.pcart_production_preparation_authorizations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  deployment_id uuid NOT NULL REFERENCES public.launch_chain_deployments(id) ON DELETE RESTRICT,
  launch_id uuid NOT NULL REFERENCES public.launches(id) ON DELETE RESTRICT,
  client_request_id text NOT NULL,
  artifact_id text NOT NULL DEFAULT 'pepecartel-token-v1' CHECK (artifact_id = 'pepecartel-token-v1'),
  chain_id integer NOT NULL DEFAULT 4663 CHECK (chain_id = 4663),
  network_environment text NOT NULL DEFAULT 'PRODUCTION' CHECK (network_environment = 'PRODUCTION'),
  deployer_address text NOT NULL,
  wallet_account text NOT NULL,
  deployer_nonce_before bigint NOT NULL CHECK (deployer_nonce_before >= 0),
  observed_latest_nonce bigint NOT NULL,
  observed_pending_nonce bigint NOT NULL,
  safe_address text NOT NULL,
  predicted_contract_address text NOT NULL,
  init_code_hash text NOT NULL,
  review_fingerprint text NOT NULL,
  readiness_fingerprint text NOT NULL,
  issued_by uuid NOT NULL,
  issued_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz NOT NULL,
  cancelled_at timestamptz,
  cancelled_by uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (deployment_id, client_request_id),
  CHECK (expires_at > issued_at AND expires_at <= issued_at + interval '90 seconds')
);
GRANT SELECT ON public.pcart_production_preparation_authorizations TO authenticated;
GRANT ALL ON public.pcart_production_preparation_authorizations TO service_role;
ALTER TABLE public.pcart_production_preparation_authorizations ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Platform owner reads PCART preparation authorizations"
  ON public.pcart_production_preparation_authorizations FOR SELECT TO authenticated
  USING (public.is_platform_owner(auth.uid()));

-- Immutable except a single cancellation stamp; never deletable.
CREATE OR REPLACE FUNCTION private.enforce_pcart_preparation_authorization_immutable()
RETURNS trigger LANGUAGE plpgsql SET search_path = '' AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'PCART preparation authorizations cannot be deleted' USING ERRCODE = '42501';
  END IF;
  IF OLD.cancelled_at IS NOT NULL
     OR NEW.cancelled_at IS NULL OR NEW.cancelled_by IS NULL
     OR (to_jsonb(NEW) - 'cancelled_at' - 'cancelled_by') IS DISTINCT FROM (to_jsonb(OLD) - 'cancelled_at' - 'cancelled_by') THEN
    RAISE EXCEPTION 'PCART preparation authorizations are immutable except one cancellation' USING ERRCODE = '42501';
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER pcart_preparation_authorization_immutable
  BEFORE UPDATE OR DELETE ON public.pcart_production_preparation_authorizations
  FOR EACH ROW EXECUTE FUNCTION private.enforce_pcart_preparation_authorization_immutable();

CREATE OR REPLACE FUNCTION public.issue_canonical_pcart_production_presign_authorization(
  _deployment_id uuid,
  _client_request_id text,
  _wallet_account text,
  _observed_chain_id integer,
  _observed_latest_nonce bigint,
  _observed_pending_nonce bigint,
  _predicted_contract_address text
) RETURNS public.pcart_production_preparation_authorizations
LANGUAGE plpgsql SECURITY DEFINER SET search_path = ''
AS $$
DECLARE
  c_safe constant text := '0xe0d055b3e07c2d1d9c1762ca9e19b3062207ad03';
  c_init_hash constant text := '0x3482c250d8500b20f731938be3cf2eab39e59b9fa7aff21ffb5085e1ceddd818';
  c_supply constant numeric := 1000000000000000000000000000;
  c_ttl constant interval := interval '90 seconds';
  v_request text := btrim(coalesce(_client_request_id, ''));
  v_wallet text := lower(btrim(coalesce(_wallet_account, '')));
  v_predicted text := lower(btrim(coalesce(_predicted_contract_address, '')));
  d public.launch_chain_deployments%rowtype;
  l public.launches%rowtype;
  a public.pcart_production_readiness_approvals%rowtype;
  s public.launch_treasury_signer_configs%rowtype;
  k record;
  ev jsonb;
  v_expected_fp text;
  v_row public.pcart_production_preparation_authorizations;
BEGIN
  IF auth.uid() IS NULL OR NOT public.is_platform_owner(auth.uid()) THEN
    RAISE EXCEPTION 'Only the platform owner can prepare the PCART production wallet' USING ERRCODE = '42501';
  END IF;
  IF char_length(v_request) < 8 OR char_length(v_request) > 128 THEN
    RAISE EXCEPTION 'Invalid request id' USING ERRCODE = '22023';
  END IF;
  IF v_predicted !~ '^0x[0-9a-f]{40}$' THEN
    RAISE EXCEPTION 'Invalid predicted contract address' USING ERRCODE = '22023';
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
    RAISE EXCEPTION 'Only an unsent PCART production draft can be prepared' USING ERRCODE = '42501';
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
  IF d.deployer_nonce_before IS NULL OR d.deployer_nonce_before < 0
     OR d.init_code_hash IS NULL OR d.review_fingerprint IS NULL THEN
    RAISE EXCEPTION 'Draft is missing reviewed evidence' USING ERRCODE = '42501';
  END IF;
  IF lower(d.init_code_hash) IS DISTINCT FROM c_init_hash THEN
    RAISE EXCEPTION 'Draft init code hash does not match the frozen artifact' USING ERRCODE = '42501';
  END IF;

  -- Live wallet binding evidence (observed in the browser, re-checked server-side by the caller).
  IF v_wallet IS DISTINCT FROM lower(d.deployer_address) THEN
    RAISE EXCEPTION 'Connected wallet is not the reviewed deployer' USING ERRCODE = '42501';
  END IF;
  IF _observed_chain_id IS DISTINCT FROM 4663 THEN
    RAISE EXCEPTION 'Wallet is not on Robinhood Chain mainnet' USING ERRCODE = '42501';
  END IF;
  IF _observed_latest_nonce IS DISTINCT FROM d.deployer_nonce_before
     OR _observed_pending_nonce IS DISTINCT FROM d.deployer_nonce_before THEN
    RAISE EXCEPTION 'Deployer nonce changed since review; abandon and review again' USING ERRCODE = '42501';
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

  v_expected_fp := '0x' || encode(sha256(convert_to(concat_ws('|',
      'pcart-production-review-v1', lower(d.launch_id::text), 'pepecartel-token-v1', '4663', 'PRODUCTION',
      'PEPECARTEL', 'PCART', '18', '1000000000000000000000000000',
      c_safe, lower(d.deployer_address), d.deployer_nonce_before::text, lower(d.init_code_hash), lower(a.readiness_fingerprint)), 'UTF8')), 'hex');
  IF lower(d.review_fingerprint) IS DISTINCT FROM v_expected_fp THEN
    RAISE EXCEPTION 'Review fingerprint no longer matches; abandon and review again' USING ERRCODE = '42501';
  END IF;

  IF l.official_contract_address IS NOT NULL OR l.official_contract_deployment_id IS NOT NULL THEN
    RAISE EXCEPTION 'An official contract is already registered' USING ERRCODE = '42501';
  END IF;

  SELECT * INTO k FROM public.launch_chain_production_execution_controls WHERE control_key = 'ROBINHOOD_MAINNET_DEPLOYMENT';
  IF NOT FOUND OR k.execution_enabled IS DISTINCT FROM false OR k.emergency_stop_engaged IS DISTINCT FROM true THEN
    RAISE EXCEPTION 'Mainnet execution must remain locked during preparation' USING ERRCODE = '42501';
  END IF;

  IF EXISTS (SELECT 1 FROM public.launch_chain_deployments x
              WHERE x.launch_id = d.launch_id AND x.id <> d.id
                AND (x.network_environment = 'PRODUCTION' OR x.chain_id = 4663)
                AND x.status IN ('DRAFT','SUBMITTED','PENDING','CONFIRMED')) THEN
    RAISE EXCEPTION 'Another PCART production attempt exists' USING ERRCODE = '42501';
  END IF;
  IF EXISTS (SELECT 1 FROM public.launch_chain_production_send_window_issuances w WHERE w.deployment_id = d.id)
     OR EXISTS (SELECT 1 FROM public.launch_chain_production_canary_permits c WHERE c.deployment_id = d.id)
     OR EXISTS (SELECT 1 FROM public.launch_chain_production_presign_authorizations p WHERE p.deployment_id = d.id) THEN
    RAISE EXCEPTION 'A send window, canary permit or generic presign already exists for this draft' USING ERRCODE = '42501';
  END IF;

  -- Idempotent replay of the same request with identical evidence.
  SELECT * INTO v_row FROM public.pcart_production_preparation_authorizations
   WHERE deployment_id = d.id AND client_request_id = v_request;
  IF FOUND THEN
    IF v_row.wallet_account IS DISTINCT FROM v_wallet
       OR v_row.predicted_contract_address IS DISTINCT FROM v_predicted
       OR v_row.review_fingerprint IS DISTINCT FROM lower(d.review_fingerprint)
       OR v_row.readiness_fingerprint IS DISTINCT FROM lower(a.readiness_fingerprint)
       OR v_row.cancelled_at IS NOT NULL OR v_row.expires_at <= now() THEN
      RAISE EXCEPTION 'Preparation request conflict; start a new preparation' USING ERRCODE = '22023';
    END IF;
    RETURN v_row;
  END IF;

  IF EXISTS (SELECT 1 FROM public.pcart_production_preparation_authorizations p
              WHERE p.deployment_id = d.id AND p.cancelled_at IS NULL AND p.expires_at > now()) THEN
    RAISE EXCEPTION 'A wallet preparation is already active for this draft' USING ERRCODE = '23505';
  END IF;

  INSERT INTO public.pcart_production_preparation_authorizations (
    deployment_id, launch_id, client_request_id, deployer_address, wallet_account,
    deployer_nonce_before, observed_latest_nonce, observed_pending_nonce,
    safe_address, predicted_contract_address, init_code_hash, review_fingerprint,
    readiness_fingerprint, issued_by, issued_at, expires_at
  ) VALUES (
    d.id, d.launch_id, v_request, lower(d.deployer_address), v_wallet,
    d.deployer_nonce_before, _observed_latest_nonce, _observed_pending_nonce,
    c_safe, v_predicted, lower(d.init_code_hash), lower(d.review_fingerprint),
    lower(a.readiness_fingerprint), auth.uid(), now(), now() + c_ttl
  ) RETURNING * INTO v_row;
  RETURN v_row;
END;
$$;

CREATE OR REPLACE FUNCTION public.cancel_canonical_pcart_production_presign_authorization(_authorization_id uuid)
RETURNS public.pcart_production_preparation_authorizations
LANGUAGE plpgsql SECURITY DEFINER SET search_path = ''
AS $$
DECLARE v_row public.pcart_production_preparation_authorizations;
BEGIN
  IF auth.uid() IS NULL OR NOT public.is_platform_owner(auth.uid()) THEN
    RAISE EXCEPTION 'Only the platform owner can cancel a PCART wallet preparation' USING ERRCODE = '42501';
  END IF;
  SELECT * INTO v_row FROM public.pcart_production_preparation_authorizations WHERE id = _authorization_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Preparation not found' USING ERRCODE = '42501';
  END IF;
  IF v_row.cancelled_at IS NOT NULL THEN RETURN v_row; END IF;
  UPDATE public.pcart_production_preparation_authorizations
     SET cancelled_at = now(), cancelled_by = auth.uid()
   WHERE id = _authorization_id
   RETURNING * INTO v_row;
  RETURN v_row;
END;
$$;

REVOKE ALL ON FUNCTION public.issue_canonical_pcart_production_presign_authorization(uuid, text, text, integer, bigint, bigint, text) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.cancel_canonical_pcart_production_presign_authorization(uuid) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION private.enforce_pcart_preparation_authorization_immutable() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.issue_canonical_pcart_production_presign_authorization(uuid, text, text, integer, bigint, bigint, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.cancel_canonical_pcart_production_presign_authorization(uuid) TO authenticated;