CREATE TABLE public.pcart_production_readiness_approvals (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  launch_id uuid NOT NULL UNIQUE REFERENCES public.launches(id) ON DELETE RESTRICT,
  artifact_id text NOT NULL DEFAULT 'pepecartel-token-v1' CHECK (artifact_id = 'pepecartel-token-v1'),
  rehearsal_deployment_id uuid NOT NULL REFERENCES public.launch_chain_deployments(id) ON DELETE RESTRICT,
  rehearsal_tx_hash text NOT NULL CHECK (rehearsal_tx_hash ~ '^0x[0-9a-f]{64}$'),
  signer_config_id uuid NOT NULL REFERENCES public.launch_treasury_signer_configs(id) ON DELETE RESTRICT,
  safe_address text NOT NULL CHECK (safe_address ~ '^0x[0-9a-f]{40}$'),
  safe_verified_at timestamptz NOT NULL,
  approved_by uuid NOT NULL,
  approved_at timestamptz NOT NULL DEFAULT now(),
  readiness_fingerprint text NOT NULL CHECK (readiness_fingerprint ~ '^[0-9a-f]{64}$')
);
REVOKE ALL ON public.pcart_production_readiness_approvals FROM PUBLIC, anon, authenticated;
GRANT ALL ON public.pcart_production_readiness_approvals TO service_role;
ALTER TABLE public.pcart_production_readiness_approvals ENABLE ROW LEVEL SECURITY;

CREATE OR REPLACE FUNCTION private.pcart_readiness_immutable()
RETURNS trigger LANGUAGE plpgsql SET search_path = '' AS $$
BEGIN
  RAISE EXCEPTION 'PCART production readiness approvals are immutable' USING ERRCODE = '42501';
END;
$$;
CREATE TRIGGER trg_pcart_readiness_immutable
  BEFORE UPDATE OR DELETE ON public.pcart_production_readiness_approvals
  FOR EACH ROW EXECUTE FUNCTION private.pcart_readiness_immutable();

-- Evidence evaluation. Returns jsonb {ok, reason, ...}. Never writes.
-- _require_no_production: approval-time check 8 (skipped by the table guard,
-- which evaluates the row being inserted itself).
CREATE OR REPLACE FUNCTION private.pcart_production_readiness_evidence(_launch_id uuid, _require_no_production boolean)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  l record; d record; s record; c record; n int; fp text;
BEGIN
  SELECT * INTO l FROM public.launches WHERE id = _launch_id;
  IF NOT FOUND OR NOT private.is_canonical_pcart_launch(_launch_id) OR l.chain IS DISTINCT FROM 'Robinhood Chain' THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'NOT_CANONICAL');
  END IF;
  IF l.official_contract_address IS NOT NULL OR l.official_contract_deployment_id IS NOT NULL
     OR l.contract_registered_at IS NOT NULL
     OR EXISTS (SELECT 1 FROM public.launch_contract_registration_events e WHERE e.launch_id = _launch_id) THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'OFFICIAL_CONTRACT_EXISTS');
  END IF;
  IF _require_no_production AND EXISTS (SELECT 1 FROM public.launch_chain_deployments x
       WHERE x.launch_id = _launch_id AND (x.network_environment = 'PRODUCTION' OR x.chain_id = 4663)) THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'PRODUCTION_ROW_EXISTS');
  END IF;

  SELECT count(*) INTO n FROM public.launch_chain_deployments x
   WHERE x.launch_id = _launch_id AND x.artifact_id = 'pepecartel-token-v1'
     AND x.network_environment = 'TESTNET' AND x.status = 'CONFIRMED';
  IF n <> 1 THEN RETURN jsonb_build_object('ok', false, 'reason', 'REHEARSAL_NOT_EXACTLY_ONE'); END IF;
  SELECT * INTO d FROM public.launch_chain_deployments x
   WHERE x.launch_id = _launch_id AND x.artifact_id = 'pepecartel-token-v1'
     AND x.network_environment = 'TESTNET' AND x.status = 'CONFIRMED';
  IF d.verified_at IS NULL OR d.contract_address IS NULL OR d.tx_hash IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'REHEARSAL_UNVERIFIED');
  END IF;
  IF d.chain_id IS DISTINCT FROM 46630 OR d.deployment_kind IS DISTINCT FROM 'FIXED_SUPPLY_ERC20'
     OR d.token_name IS DISTINCT FROM 'PEPECARTEL' OR d.token_symbol IS DISTINCT FROM 'PCART'
     OR d.token_decimals IS DISTINCT FROM 18
     OR d.token_total_supply IS DISTINCT FROM 1000000000000000000000000000::numeric
     OR d.token_recipient IS NULL OR d.token_recipient = '0x0000000000000000000000000000000000000000' THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'REHEARSAL_INTENT_MISMATCH');
  END IF;

  SELECT count(*) INTO n FROM public.launch_treasury_signer_configs t WHERE t.launch_id = _launch_id;
  IF n <> 1 THEN RETURN jsonb_build_object('ok', false, 'reason', 'SAFE_NOT_READY'); END IF;
  SELECT * INTO s FROM public.launch_treasury_signer_configs t WHERE t.launch_id = _launch_id;
  IF s.threshold IS DISTINCT FROM 2 OR s.safe_address IS NULL OR s.safe_verified_at IS NULL
     OR s.signer_1 IS NULL OR s.signer_2 IS NULL OR s.signer_3 IS NULL
     OR s.signer_1 !~ '^0x[0-9a-f]{40}$' OR s.signer_2 !~ '^0x[0-9a-f]{40}$' OR s.signer_3 !~ '^0x[0-9a-f]{40}$'
     OR s.signer_1 = s.signer_2 OR s.signer_1 = s.signer_3 OR s.signer_2 = s.signer_3 THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'SAFE_NOT_READY');
  END IF;

  SELECT * INTO c FROM public.launch_chain_production_execution_controls k WHERE k.control_key = 'ROBINHOOD_MAINNET_DEPLOYMENT';
  IF NOT FOUND OR c.execution_enabled IS DISTINCT FROM false OR c.emergency_stop_engaged IS DISTINCT FROM true THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'EXECUTION_NOT_LOCKED');
  END IF;

  fp := encode(sha256(convert_to(concat_ws('|', _launch_id::text, 'pepecartel-token-v1', d.id::text, d.tx_hash,
          d.contract_address, d.token_recipient, s.id::text, s.safe_address, s.safe_verified_at::text,
          s.signer_1, s.signer_2, s.signer_3, s.threshold::text), 'UTF8')), 'hex');
  RETURN jsonb_build_object('ok', true, 'reason', null,
    'rehearsal_deployment_id', d.id, 'rehearsal_attempt_number', d.attempt_number, 'rehearsal_tx_hash', d.tx_hash,
    'signer_config_id', s.id, 'safe_address', s.safe_address, 'safe_verified_at', s.safe_verified_at,
    'fingerprint', fp);
END;
$$;
REVOKE ALL ON FUNCTION private.pcart_production_readiness_evidence(uuid, boolean) FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.approve_canonical_pcart_production_readiness(_launch_id uuid)
RETURNS public.pcart_production_readiness_approvals
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  uid uuid := auth.uid(); ev jsonb; r public.pcart_production_readiness_approvals;
BEGIN
  IF uid IS NULL OR NOT public.is_platform_owner(uid) THEN
    RAISE EXCEPTION 'Only the platform owner can approve production readiness' USING ERRCODE = '42501';
  END IF;
  PERFORM 1 FROM public.launches WHERE id = _launch_id FOR UPDATE;
  ev := private.pcart_production_readiness_evidence(_launch_id, true);
  IF NOT (ev->>'ok')::boolean THEN
    RAISE EXCEPTION 'Production readiness not satisfied: %', ev->>'reason' USING ERRCODE = '22023';
  END IF;
  SELECT * INTO r FROM public.pcart_production_readiness_approvals a WHERE a.launch_id = _launch_id;
  IF FOUND THEN
    IF r.readiness_fingerprint = ev->>'fingerprint'
       AND r.rehearsal_deployment_id = (ev->>'rehearsal_deployment_id')::uuid
       AND r.signer_config_id = (ev->>'signer_config_id')::uuid
       AND r.safe_address = ev->>'safe_address' THEN
      RETURN r;
    END IF;
    RAISE EXCEPTION 'Existing readiness approval no longer matches current evidence' USING ERRCODE = '22023';
  END IF;
  INSERT INTO public.pcart_production_readiness_approvals
    (launch_id, rehearsal_deployment_id, rehearsal_tx_hash, signer_config_id, safe_address, safe_verified_at, approved_by, readiness_fingerprint)
  VALUES (_launch_id, (ev->>'rehearsal_deployment_id')::uuid, ev->>'rehearsal_tx_hash', (ev->>'signer_config_id')::uuid,
    ev->>'safe_address', (ev->>'safe_verified_at')::timestamptz, uid, ev->>'fingerprint')
  RETURNING * INTO r;
  RETURN r;
END;
$$;
REVOKE ALL ON FUNCTION public.approve_canonical_pcart_production_readiness(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.approve_canonical_pcart_production_readiness(uuid) TO authenticated;

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
  ev := private.pcart_production_readiness_evidence(_launch_id, true);
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

-- Artifact shape: PCART permitted on PRODUCTION/4663 only with the exact frozen shape.
ALTER TABLE public.launch_chain_deployments DROP CONSTRAINT launch_chain_deployments_artifact_chk;
ALTER TABLE public.launch_chain_deployments ADD CONSTRAINT launch_chain_deployments_artifact_chk CHECK (
  artifact_id IS NULL OR artifact_id = 'cartel-fixed-erc20-v1'
  OR (artifact_id = 'pepecartel-token-v1'
      AND ((chain_id = 46630 AND network_environment = 'TESTNET') OR (chain_id = 4663 AND network_environment = 'PRODUCTION'))
      AND deployment_kind = 'FIXED_SUPPLY_ERC20' AND token_name = 'PEPECARTEL' AND token_symbol = 'PCART'
      AND token_decimals = 18 AND token_total_supply = 1000000000000000000000000000::numeric
      AND token_recipient IS NOT NULL AND token_recipient <> '0x0000000000000000000000000000000000000000'));

-- Table-boundary guard: canonical PRODUCTION rows only for PCART with matching approval + locked execution.
CREATE OR REPLACE FUNCTION public.enforce_canonical_pcart_no_production_deployment()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE ev jsonb; r public.pcart_production_readiness_approvals;
BEGIN
  IF (NEW.network_environment = 'PRODUCTION' OR NEW.chain_id = 4663)
     AND private.is_canonical_pcart_launch(NEW.launch_id) THEN
    IF NEW.artifact_id IS DISTINCT FROM 'pepecartel-token-v1' THEN
      RAISE EXCEPTION 'The canonical PEPECARTEL launch only permits pepecartel-token-v1 in production' USING ERRCODE = '42501';
    END IF;
    SELECT * INTO r FROM public.pcart_production_readiness_approvals a
     WHERE a.launch_id = NEW.launch_id AND a.artifact_id = 'pepecartel-token-v1';
    IF NOT FOUND THEN
      RAISE EXCEPTION 'Canonical PCART production rows require a production readiness approval' USING ERRCODE = '42501';
    END IF;
    ev := private.pcart_production_readiness_evidence(NEW.launch_id, false);
    IF NOT (ev->>'ok')::boolean OR r.readiness_fingerprint IS DISTINCT FROM ev->>'fingerprint' THEN
      RAISE EXCEPTION 'Canonical PCART production readiness evidence no longer matches (%)', COALESCE(ev->>'reason','FINGERPRINT') USING ERRCODE = '42501';
    END IF;
  END IF;
  RETURN NEW;
END;
$$;
REVOKE ALL ON FUNCTION public.enforce_canonical_pcart_no_production_deployment() FROM PUBLIC, anon, authenticated;