-- P9.3A: canonical prepared-action model (PREPARE ONLY; no signatures, no sends).
ALTER TABLE public.pcart_launch_coordinator_events DROP CONSTRAINT IF EXISTS pcart_launch_coordinator_events_event_kind_check;
ALTER TABLE public.pcart_launch_coordinator_events ADD CONSTRAINT pcart_launch_coordinator_events_event_kind_check
  CHECK (event_kind IN ('PLAN_UPDATED','POLICY_APPROVAL_REVOKED','STATE_OBSERVED','ACTION_PREPARED','ACTION_STALED','ACTION_CANCELLED'));

CREATE TABLE public.pcart_launch_coordinator_actions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  launch_id uuid NOT NULL REFERENCES public.launches(id) ON DELETE RESTRICT,
  action_kind text NOT NULL CHECK (action_kind IN ('PREAUCTION_SETUP','POST_AUCTION_SWEEP')),
  binding_version text NOT NULL,
  chain_id integer NOT NULL CHECK (chain_id = 4663),
  official_token_address text NOT NULL CHECK (official_token_address ~ '^0x[0-9a-f]{40}$'),
  official_token_code_hash text NOT NULL CHECK (official_token_code_hash ~ '^0x[0-9a-f]{64}$'),
  p8a_review_id uuid NOT NULL,
  p8a_manifest_version text NOT NULL,
  p8a_manifest_fingerprint text NOT NULL,
  p8b_review_id uuid NOT NULL,
  p8b_manifest_version text NOT NULL,
  p8b_manifest_fingerprint text NOT NULL,
  dependency_attestation_fingerprint text NOT NULL CHECK (dependency_attestation_fingerprint ~ '^0x[0-9a-f]{64}$'),
  safe_address text NOT NULL CHECK (safe_address ~ '^0x[0-9a-f]{40}$'),
  safe_owners_fingerprint text NOT NULL CHECK (safe_owners_fingerprint ~ '^0x[0-9a-f]{64}$'),
  safe_threshold integer NOT NULL CHECK (safe_threshold = 2),
  safe_nonce bigint NOT NULL CHECK (safe_nonce >= 0),
  promotion_start_at timestamptz,
  intended_auction_start_at timestamptz,
  authoritative_start_block bigint CHECK (authoritative_start_block IS NULL OR authoritative_start_block > 0),
  end_block bigint CHECK (end_block IS NULL OR end_block > 0),
  permit2_expiration bigint CHECK (permit2_expiration IS NULL OR permit2_expiration > 0),
  auction_address text CHECK (auction_address IS NULL OR auction_address ~ '^0x[0-9a-f]{40}$'),
  unsold_amount numeric CHECK (unsold_amount IS NULL OR unsold_amount >= 0),
  call_batch_fingerprint text NOT NULL CHECK (call_batch_fingerprint ~ '^0x[0-9a-f]{64}$'),
  safe_tx_target text NOT NULL CHECK (safe_tx_target ~ '^0x[0-9a-f]{40}$'),
  safe_tx_operation smallint NOT NULL CHECK (safe_tx_operation IN (0,1)),
  safe_tx_data_keccak text NOT NULL CHECK (safe_tx_data_keccak ~ '^0x[0-9a-f]{64}$'),
  safe_tx_hash text NOT NULL CHECK (safe_tx_hash ~ '^0x[0-9a-f]{64}$'),
  binding_fingerprint text NOT NULL CHECK (binding_fingerprint ~ '^0x[0-9a-f]{64}$'),
  chain_head_block bigint NOT NULL CHECK (chain_head_block > 0),
  chain_head_captured_at timestamptz NOT NULL,
  status text NOT NULL DEFAULT 'PREPARED' CHECK (status IN ('PREPARED','AWAITING_SIGNATURES','READY','SUBMITTED','CONFIRMED','CANCELLED','STALE','UNCERTAIN')),
  status_reason text,
  prepared_by uuid NOT NULL,
  prepared_at timestamptz NOT NULL DEFAULT now(),
  status_changed_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT pcart_p93_preauction_blocks CHECK (action_kind <> 'PREAUCTION_SETUP' OR (
    authoritative_start_block IS NOT NULL AND end_block = authoritative_start_block + 5885000
    AND promotion_start_at IS NOT NULL AND intended_auction_start_at IS NOT NULL
    AND intended_auction_start_at >= promotion_start_at + interval '21 days' AND permit2_expiration IS NOT NULL)),
  CONSTRAINT pcart_p93_sweep_binding CHECK (action_kind <> 'POST_AUCTION_SWEEP' OR (auction_address IS NOT NULL AND unsold_amount IS NOT NULL))
);
CREATE UNIQUE INDEX pcart_p93_one_prepared_per_kind ON public.pcart_launch_coordinator_actions (launch_id, action_kind)
  WHERE status IN ('PREPARED','AWAITING_SIGNATURES','READY','SUBMITTED','UNCERTAIN');
GRANT SELECT ON public.pcart_launch_coordinator_actions TO authenticated;
GRANT ALL ON public.pcart_launch_coordinator_actions TO service_role;
ALTER TABLE public.pcart_launch_coordinator_actions ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Platform owner reads coordinator actions" ON public.pcart_launch_coordinator_actions
  FOR SELECT TO authenticated USING (public.is_platform_owner(auth.uid()));

-- Binding immutable; P9.3A permits only PREPARED -> STALE | CANCELLED. Signing/sending statuses are reserved for P9.3B.
CREATE OR REPLACE FUNCTION private.pcart_p93_action_guard()
RETURNS trigger LANGUAGE plpgsql SET search_path = public AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN RAISE EXCEPTION 'PCART_P9_3: prepared actions are never deleted.' USING errcode = '42501'; END IF;
  IF TG_OP = 'INSERT' THEN
    IF NEW.status <> 'PREPARED' THEN RAISE EXCEPTION 'PCART_P9_3: actions are created PREPARED only.' USING errcode = '42501'; END IF;
    RETURN NEW;
  END IF;
  IF (to_jsonb(NEW) - 'status' - 'status_reason' - 'status_changed_at') IS DISTINCT FROM (to_jsonb(OLD) - 'status' - 'status_reason' - 'status_changed_at') THEN
    RAISE EXCEPTION 'PCART_P9_3: action binding is immutable.' USING errcode = '42501';
  END IF;
  IF NOT (OLD.status = 'PREPARED' AND NEW.status IN ('STALE','CANCELLED')) THEN
    RAISE EXCEPTION 'PCART_P9_3: status transition % -> % not allowed in P9.3A.', OLD.status, NEW.status USING errcode = '42501';
  END IF;
  NEW.status_changed_at := now();
  RETURN NEW;
END $$;
CREATE TRIGGER pcart_p93_action_guard BEFORE INSERT OR UPDATE OR DELETE ON public.pcart_launch_coordinator_actions
  FOR EACH ROW EXECUTE FUNCTION private.pcart_p93_action_guard();

CREATE OR REPLACE FUNCTION private.pcart_p93_stale_prepared(_launch_id uuid, _reason text)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE r record;
BEGIN
  FOR r IN SELECT id FROM public.pcart_launch_coordinator_actions WHERE launch_id = _launch_id AND status = 'PREPARED' LOOP
    UPDATE public.pcart_launch_coordinator_actions SET status = 'STALE', status_reason = _reason WHERE id = r.id;
    INSERT INTO public.pcart_launch_coordinator_events (launch_id, event_kind, detail, actor)
    VALUES (_launch_id, 'ACTION_STALED', jsonb_build_object('action_id', r.id, 'reason', _reason), auth.uid());
  END LOOP;
END $$;
REVOKE ALL ON FUNCTION private.pcart_p93_stale_prepared(uuid, text) FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION private.pcart_p93_on_plan_change() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NEW.promotion_start_at IS DISTINCT FROM OLD.promotion_start_at OR NEW.intended_auction_start_at IS DISTINCT FROM OLD.intended_auction_start_at THEN
    PERFORM private.pcart_p93_stale_prepared(NEW.launch_id, 'PLAN_CHANGED');
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER pcart_p93_plan_change AFTER UPDATE ON public.pcart_launch_day_plans FOR EACH ROW EXECUTE FUNCTION private.pcart_p93_on_plan_change();

CREATE OR REPLACE FUNCTION private.pcart_p93_on_revocation() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN PERFORM private.pcart_p93_stale_prepared(NEW.launch_id, 'POLICY_APPROVAL_REVOKED'); RETURN NEW; END $$;
CREATE TRIGGER pcart_p93_revocation AFTER INSERT ON public.pcart_policy_approval_revocations FOR EACH ROW EXECUTE FUNCTION private.pcart_p93_on_revocation();

CREATE OR REPLACE FUNCTION private.pcart_p93_on_official_change() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NEW.official_contract_address IS DISTINCT FROM OLD.official_contract_address THEN
    PERFORM private.pcart_p93_stale_prepared(NEW.id, 'OFFICIAL_TOKEN_CHANGED');
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER pcart_p93_official_change AFTER UPDATE OF official_contract_address ON public.launches FOR EACH ROW EXECUTE FUNCTION private.pcart_p93_on_official_change();

-- Service-role only: called by the owner-verified server function AFTER a fresh live re-attestation.
CREATE OR REPLACE FUNCTION public.record_canonical_pcart_preauction_prepared(_actor uuid, _b jsonb)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_launch uuid := (_b->>'launch_id')::uuid; v_id uuid; l record; p record; c record; ra record; rb record;
BEGIN
  IF _actor IS NULL OR NOT public.is_platform_owner(_actor) THEN RAISE EXCEPTION 'PCART_P9_3: platform owner only.' USING errcode = '42501'; END IF;
  IF NOT private.is_canonical_pcart_launch(v_launch) THEN RAISE EXCEPTION 'PCART_P9_3: not the canonical PEPECARTEL launch.' USING errcode = '42501'; END IF;
  SELECT status, lower(official_contract_address) AS tok INTO l FROM public.launches WHERE id = v_launch;
  IF l.tok IS NULL OR l.tok <> lower(_b->>'official_token_address') THEN RAISE EXCEPTION 'PCART_P9_3: official token missing or mismatched.' USING errcode = '22023'; END IF;
  IF l.status <> 'OFFICIAL_CONTRACT_REGISTERED' THEN RAISE EXCEPTION 'PCART_P9_3: launch not at OFFICIAL_CONTRACT_REGISTERED.' USING errcode = '22023'; END IF;
  SELECT promotion_start_at, intended_auction_start_at INTO p FROM public.pcart_launch_day_plans WHERE launch_id = v_launch;
  IF p.promotion_start_at IS NULL OR p.intended_auction_start_at IS NULL
     OR p.promotion_start_at <> (_b->>'promotion_start_at')::timestamptz OR p.intended_auction_start_at <> (_b->>'intended_auction_start_at')::timestamptz THEN
    RAISE EXCEPTION 'PCART_P9_3: launch plan missing or changed.' USING errcode = '22023';
  END IF;
  SELECT execution_enabled, emergency_stop_engaged INTO c FROM public.launch_chain_production_execution_controls WHERE control_key = 'ROBINHOOD_MAINNET_DEPLOYMENT';
  IF c.execution_enabled IS DISTINCT FROM false OR c.emergency_stop_engaged IS DISTINCT FROM true THEN
    RAISE EXCEPTION 'PCART_P9_3: CANONICAL_PCART_PROTECTED controls required.' USING errcode = '42501';
  END IF;
  SELECT id, manifest_version, manifest_fingerprint INTO ra FROM public.pcart_auction_liquidity_plan_reviews WHERE launch_id = v_launch ORDER BY reviewed_at DESC LIMIT 1;
  SELECT id, manifest_version, manifest_fingerprint, overall_result INTO rb FROM public.pcart_auction_execution_rehearsal_reviews WHERE launch_id = v_launch ORDER BY reviewed_at DESC LIMIT 1;
  IF ra.id IS NULL OR ra.id <> (_b->>'p8a_review_id')::uuid OR ra.manifest_version <> _b->>'p8a_manifest_version' OR lower(ra.manifest_fingerprint) <> lower(_b->>'p8a_manifest_fingerprint')
     OR EXISTS (SELECT 1 FROM public.pcart_policy_approval_revocations WHERE review_id = ra.id) THEN
    RAISE EXCEPTION 'PCART_P9_3: P8A policy approval not current.' USING errcode = '22023';
  END IF;
  IF rb.id IS NULL OR rb.id <> (_b->>'p8b_review_id')::uuid OR rb.manifest_version <> _b->>'p8b_manifest_version' OR lower(rb.manifest_fingerprint) <> lower(_b->>'p8b_manifest_fingerprint')
     OR rb.overall_result IS DISTINCT FROM 'PASS' OR EXISTS (SELECT 1 FROM public.pcart_policy_approval_revocations WHERE review_id = rb.id) THEN
    RAISE EXCEPTION 'PCART_P9_3: P8B policy approval not current.' USING errcode = '22023';
  END IF;
  INSERT INTO public.pcart_launch_coordinator_actions (
    launch_id, action_kind, binding_version, chain_id, official_token_address, official_token_code_hash,
    p8a_review_id, p8a_manifest_version, p8a_manifest_fingerprint, p8b_review_id, p8b_manifest_version, p8b_manifest_fingerprint,
    dependency_attestation_fingerprint, safe_address, safe_owners_fingerprint, safe_threshold, safe_nonce,
    promotion_start_at, intended_auction_start_at, authoritative_start_block, end_block, permit2_expiration,
    call_batch_fingerprint, safe_tx_target, safe_tx_operation, safe_tx_data_keccak, safe_tx_hash, binding_fingerprint,
    chain_head_block, chain_head_captured_at, prepared_by)
  VALUES (v_launch, 'PREAUCTION_SETUP', _b->>'binding_version', (_b->>'chain_id')::int, lower(_b->>'official_token_address'), lower(_b->>'official_token_code_hash'),
    ra.id, ra.manifest_version, lower(ra.manifest_fingerprint), rb.id, rb.manifest_version, lower(rb.manifest_fingerprint),
    lower(_b->>'dependency_attestation_fingerprint'), lower(_b->>'safe_address'), lower(_b->>'safe_owners_fingerprint'), (_b->>'safe_threshold')::int, (_b->>'safe_nonce')::bigint,
    p.promotion_start_at, p.intended_auction_start_at, (_b->>'authoritative_start_block')::bigint, (_b->>'end_block')::bigint, (_b->>'permit2_expiration')::bigint,
    lower(_b->>'call_batch_fingerprint'), lower(_b->>'safe_tx_target'), (_b->>'safe_tx_operation')::smallint, lower(_b->>'safe_tx_data_keccak'), lower(_b->>'safe_tx_hash'), lower(_b->>'binding_fingerprint'),
    (_b->>'chain_head_block')::bigint, (_b->>'chain_head_captured_at')::timestamptz, _actor)
  RETURNING id INTO v_id;
  INSERT INTO public.pcart_launch_coordinator_events (launch_id, event_kind, detail, actor)
  VALUES (v_launch, 'ACTION_PREPARED', jsonb_build_object('action_id', v_id, 'action_kind', 'PREAUCTION_SETUP', 'safe_nonce', (_b->>'safe_nonce')::bigint,
    'start_block', (_b->>'authoritative_start_block')::bigint, 'end_block', (_b->>'end_block')::bigint, 'safe_tx_hash', lower(_b->>'safe_tx_hash')), _actor);
  RETURN v_id;
END $$;
REVOKE ALL ON FUNCTION public.record_canonical_pcart_preauction_prepared(uuid, jsonb) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.record_canonical_pcart_preauction_prepared(uuid, jsonb) TO service_role;

CREATE OR REPLACE FUNCTION public.cancel_canonical_pcart_coordinator_action(_action_id uuid, _reason text)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_launch uuid;
BEGIN
  IF auth.uid() IS NULL OR NOT public.is_platform_owner(auth.uid()) THEN RAISE EXCEPTION 'PCART_P9_3: platform owner only.' USING errcode = '42501'; END IF;
  IF _reason IS NULL OR length(_reason) NOT BETWEEN 3 AND 300 THEN RAISE EXCEPTION 'PCART_P9_3: reason required.' USING errcode = '22023'; END IF;
  UPDATE public.pcart_launch_coordinator_actions SET status = 'CANCELLED', status_reason = _reason
  WHERE id = _action_id AND status = 'PREPARED' RETURNING launch_id INTO v_launch;
  IF v_launch IS NULL THEN RAISE EXCEPTION 'PCART_P9_3: no PREPARED action to cancel.' USING errcode = '22023'; END IF;
  INSERT INTO public.pcart_launch_coordinator_events (launch_id, event_kind, detail, actor)
  VALUES (v_launch, 'ACTION_CANCELLED', jsonb_build_object('action_id', _action_id, 'reason', _reason), auth.uid());
END $$;
REVOKE ALL ON FUNCTION public.cancel_canonical_pcart_coordinator_action(uuid, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.cancel_canonical_pcart_coordinator_action(uuid, text) TO authenticated;