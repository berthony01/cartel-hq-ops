-- P9.3B: Treasury Safe 2-of-3 signature evidence + permit-bound PREAUCTION_SAFE_EXECUTE (CANONICAL_PCART_PROTECTED).
ALTER TABLE public.pcart_launch_coordinator_events DROP CONSTRAINT IF EXISTS pcart_launch_coordinator_events_event_kind_check;
ALTER TABLE public.pcart_launch_coordinator_events ADD CONSTRAINT pcart_launch_coordinator_events_event_kind_check
  CHECK (event_kind IN ('PLAN_UPDATED','POLICY_APPROVAL_REVOKED','STATE_OBSERVED','ACTION_PREPARED','ACTION_STALED','ACTION_CANCELLED',
    'SIGNATURE_RECORDED','PERMIT_ISSUED','EXECUTION_CLAIMED','EXECUTION_SUBMITTED','EXECUTION_CONFIRMED','EXECUTION_REVERTED','HANDOFF_RELEASED'));

ALTER TABLE public.pcart_launch_coordinator_actions
  ADD COLUMN execution_tx_hash text CHECK (execution_tx_hash IS NULL OR execution_tx_hash ~ '^0x[0-9a-f]{64}$'),
  ADD COLUMN execution_submitted_at timestamptz,
  ADD COLUMN execution_confirmed_at timestamptz,
  ADD COLUMN execution_confirmed_block bigint CHECK (execution_confirmed_block IS NULL OR execution_confirmed_block > 0);

-- Guard: binding immutable; one-way status machine; tx hash/auction address write-once.
CREATE OR REPLACE FUNCTION private.pcart_p93_action_guard()
RETURNS trigger LANGUAGE plpgsql SET search_path = public AS $$
DECLARE mut text[] := ARRAY['status','status_reason','status_changed_at','execution_tx_hash','execution_submitted_at','execution_confirmed_at','execution_confirmed_block','auction_address'];
BEGIN
  IF TG_OP = 'DELETE' THEN RAISE EXCEPTION 'PCART_P9_3: prepared actions are never deleted.' USING errcode = '42501'; END IF;
  IF TG_OP = 'INSERT' THEN
    IF NEW.status <> 'PREPARED' OR NEW.execution_tx_hash IS NOT NULL THEN RAISE EXCEPTION 'PCART_P9_3: actions are created PREPARED only.' USING errcode = '42501'; END IF;
    RETURN NEW;
  END IF;
  IF (to_jsonb(NEW) - mut) IS DISTINCT FROM (to_jsonb(OLD) - mut) THEN
    RAISE EXCEPTION 'PCART_P9_3: action binding is immutable.' USING errcode = '42501';
  END IF;
  IF OLD.execution_tx_hash IS NOT NULL AND NEW.execution_tx_hash IS DISTINCT FROM OLD.execution_tx_hash THEN RAISE EXCEPTION 'PCART_P9_3B: tx hash is write-once.' USING errcode = '42501'; END IF;
  IF OLD.auction_address IS NOT NULL AND NEW.auction_address IS DISTINCT FROM OLD.auction_address THEN RAISE EXCEPTION 'PCART_P9_3B: auction address is write-once.' USING errcode = '42501'; END IF;
  IF NEW.auction_address IS DISTINCT FROM OLD.auction_address AND NOT (OLD.action_kind = 'PREAUCTION_SETUP' AND NEW.status = 'CONFIRMED') THEN
    RAISE EXCEPTION 'PCART_P9_3B: auction address only at confirmation.' USING errcode = '42501';
  END IF;
  IF NEW.status = OLD.status AND (to_jsonb(NEW) - 'status_changed_at') = (to_jsonb(OLD) - 'status_changed_at') THEN RETURN NEW; END IF;
  IF OLD.action_kind = 'POST_AUCTION_SWEEP' THEN
    IF NOT (OLD.status = 'PREPARED' AND NEW.status IN ('STALE','CANCELLED')) THEN
      RAISE EXCEPTION 'PCART_P9_3: sweep transition % -> % not allowed before P9.3C.', OLD.status, NEW.status USING errcode = '42501';
    END IF;
  ELSIF NOT (
       (OLD.status = 'PREPARED' AND NEW.status IN ('AWAITING_SIGNATURES','STALE','CANCELLED'))
    OR (OLD.status = 'AWAITING_SIGNATURES' AND NEW.status IN ('READY','STALE','CANCELLED'))
    OR (OLD.status = 'READY' AND NEW.status IN ('UNCERTAIN','STALE','CANCELLED'))
    OR (OLD.status = 'UNCERTAIN' AND NEW.status IN ('SUBMITTED','CONFIRMED','READY','CANCELLED'))
    OR (OLD.status = 'SUBMITTED' AND NEW.status IN ('CONFIRMED','CANCELLED'))
  ) THEN
    RAISE EXCEPTION 'PCART_P9_3B: status transition % -> % not allowed.', OLD.status, NEW.status USING errcode = '42501';
  END IF;
  IF NEW.status IN ('UNCERTAIN','SUBMITTED') AND OLD.status IN ('UNCERTAIN','SUBMITTED') AND OLD.execution_tx_hash IS NOT NULL AND NEW.status = 'READY' THEN
    RAISE EXCEPTION 'PCART_P9_3B: a submitted transaction is never released.' USING errcode = '42501';
  END IF;
  IF NEW.status = 'READY' AND OLD.status = 'UNCERTAIN' AND (OLD.execution_tx_hash IS NOT NULL OR NEW.execution_tx_hash IS NOT NULL) THEN
    RAISE EXCEPTION 'PCART_P9_3B: a handoff with a tx hash is never released.' USING errcode = '42501';
  END IF;
  IF NEW.status = 'SUBMITTED' AND NEW.execution_tx_hash IS NULL THEN RAISE EXCEPTION 'PCART_P9_3B: SUBMITTED requires a tx hash.' USING errcode = '42501'; END IF;
  IF NEW.status = 'CONFIRMED' AND (NEW.execution_tx_hash IS NULL OR NEW.execution_confirmed_block IS NULL OR NEW.auction_address IS NULL) THEN
    RAISE EXCEPTION 'PCART_P9_3B: CONFIRMED requires chain evidence.' USING errcode = '42501';
  END IF;
  NEW.status_changed_at := now();
  RETURN NEW;
END $$;

-- Staling now covers every pre-execution status (signatures are invalidated by the trigger below).
CREATE OR REPLACE FUNCTION private.pcart_p93_stale_prepared(_launch_id uuid, _reason text)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE r record;
BEGIN
  FOR r IN SELECT id FROM public.pcart_launch_coordinator_actions WHERE launch_id = _launch_id AND status IN ('PREPARED','AWAITING_SIGNATURES','READY') LOOP
    UPDATE public.pcart_launch_coordinator_actions SET status = 'STALE', status_reason = _reason WHERE id = r.id;
    INSERT INTO public.pcart_launch_coordinator_events (launch_id, event_kind, detail, actor)
    VALUES (_launch_id, 'ACTION_STALED', jsonb_build_object('action_id', r.id, 'reason', _reason), auth.uid());
  END LOOP;
END $$;
REVOKE ALL ON FUNCTION private.pcart_p93_stale_prepared(uuid, text) FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.cancel_canonical_pcart_coordinator_action(_action_id uuid, _reason text)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_launch uuid;
BEGIN
  IF auth.uid() IS NULL OR NOT public.is_platform_owner(auth.uid()) THEN RAISE EXCEPTION 'PCART_P9_3: platform owner only.' USING errcode = '42501'; END IF;
  IF _reason IS NULL OR length(_reason) NOT BETWEEN 3 AND 300 THEN RAISE EXCEPTION 'PCART_P9_3: reason required.' USING errcode = '22023'; END IF;
  UPDATE public.pcart_launch_coordinator_actions SET status = 'CANCELLED', status_reason = _reason
  WHERE id = _action_id AND status IN ('PREPARED','AWAITING_SIGNATURES','READY') RETURNING launch_id INTO v_launch;
  IF v_launch IS NULL THEN RAISE EXCEPTION 'PCART_P9_3: no cancellable (pre-execution) action.' USING errcode = '22023'; END IF;
  INSERT INTO public.pcart_launch_coordinator_events (launch_id, event_kind, detail, actor)
  VALUES (v_launch, 'ACTION_CANCELLED', jsonb_build_object('action_id', _action_id, 'reason', _reason), auth.uid());
END $$;
REVOKE ALL ON FUNCTION public.cancel_canonical_pcart_coordinator_action(uuid, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.cancel_canonical_pcart_coordinator_action(uuid, text) TO authenticated;

-- ------------------------------------------------------------ signature evidence
CREATE TABLE public.pcart_launch_coordinator_signatures (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  action_id uuid NOT NULL REFERENCES public.pcart_launch_coordinator_actions(id) ON DELETE RESTRICT,
  launch_id uuid NOT NULL REFERENCES public.launches(id) ON DELETE RESTRICT,
  signer_address text NOT NULL CHECK (signer_address IN ('0xc23bd6148a29318cc19264e096623ffcdac19245','0xa068b94e6f11a7e2daef086c5190dc265a523f67','0xe5b2f446317d03de6e69fa697ab25d635f6dd617')),
  owner_account_kind text NOT NULL CHECK (owner_account_kind IN ('EOA','EIP7702_DELEGATED')),
  safe_tx_hash text NOT NULL CHECK (safe_tx_hash ~ '^0x[0-9a-f]{64}$'),
  signature_format text NOT NULL CHECK (signature_format = 'SAFE_ECDSA_EIP712_V4'),
  signature text NOT NULL CHECK (signature ~ '^0x[0-9a-f]{128}(1b|1c)$'),
  recovered_signer text NOT NULL,
  control_revision bigint NOT NULL CHECK (control_revision >= 1),
  status text NOT NULL DEFAULT 'VALID' CHECK (status IN ('VALID','REVOKED','STALE')),
  status_reason text,
  signed_at timestamptz NOT NULL DEFAULT now(),
  recorded_by uuid NOT NULL,
  CONSTRAINT pcart_p93b_sig_recovered CHECK (recovered_signer = signer_address)
);
CREATE UNIQUE INDEX pcart_p93b_one_valid_sig_per_signer ON public.pcart_launch_coordinator_signatures (action_id, signer_address) WHERE status = 'VALID';
GRANT SELECT ON public.pcart_launch_coordinator_signatures TO authenticated;
GRANT ALL ON public.pcart_launch_coordinator_signatures TO service_role;
ALTER TABLE public.pcart_launch_coordinator_signatures ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Platform owner reads coordinator signatures" ON public.pcart_launch_coordinator_signatures
  FOR SELECT TO authenticated USING (public.is_platform_owner(auth.uid()));

CREATE OR REPLACE FUNCTION private.pcart_p93b_sig_guard() RETURNS trigger LANGUAGE plpgsql SET search_path = public AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN RAISE EXCEPTION 'PCART_P9_3B: signatures are never deleted.' USING errcode = '42501'; END IF;
  IF TG_OP = 'INSERT' THEN IF NEW.status <> 'VALID' THEN RAISE EXCEPTION 'PCART_P9_3B: signatures are recorded VALID.' USING errcode = '42501'; END IF; RETURN NEW; END IF;
  IF (to_jsonb(NEW) - 'status' - 'status_reason') IS DISTINCT FROM (to_jsonb(OLD) - 'status' - 'status_reason') THEN RAISE EXCEPTION 'PCART_P9_3B: signature evidence is immutable.' USING errcode = '42501'; END IF;
  IF NOT (OLD.status = 'VALID' AND NEW.status IN ('STALE','REVOKED')) THEN RAISE EXCEPTION 'PCART_P9_3B: signature status is one-way.' USING errcode = '42501'; END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER pcart_p93b_sig_guard BEFORE INSERT OR UPDATE OR DELETE ON public.pcart_launch_coordinator_signatures FOR EACH ROW EXECUTE FUNCTION private.pcart_p93b_sig_guard();

CREATE OR REPLACE FUNCTION private.pcart_p93b_on_action_end() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NEW.status IN ('STALE','CANCELLED') AND OLD.status IS DISTINCT FROM NEW.status THEN
    UPDATE public.pcart_launch_coordinator_signatures SET status = 'STALE', status_reason = 'ACTION_' || NEW.status WHERE action_id = NEW.id AND status = 'VALID';
    UPDATE public.pcart_launch_coordinator_action_permits SET cancelled_at = now(), cancel_reason = 'ACTION_' || NEW.status
      WHERE action_id = NEW.id AND consumed_at IS NULL AND cancelled_at IS NULL;
  END IF;
  RETURN NEW;
END $$;

-- ------------------------------------------------------------ action permits
CREATE TABLE public.pcart_launch_coordinator_action_permits (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  action_id uuid NOT NULL REFERENCES public.pcart_launch_coordinator_actions(id) ON DELETE RESTRICT,
  launch_id uuid NOT NULL REFERENCES public.launches(id) ON DELETE RESTRICT,
  binding_version text NOT NULL CHECK (binding_version = 'pcart-p9-3b-action-permit-v1'),
  action_type text NOT NULL CHECK (action_type = 'PREAUCTION_SAFE_EXECUTE'),
  chain_id integer NOT NULL CHECK (chain_id = 4663),
  official_token_address text NOT NULL, official_token_code_hash text NOT NULL,
  p8a_review_id uuid NOT NULL, p8a_manifest_fingerprint text NOT NULL, p8b_review_id uuid NOT NULL, p8b_manifest_fingerprint text NOT NULL,
  dependency_attestation_fingerprint text NOT NULL, safe_address text NOT NULL, safe_owners_fingerprint text NOT NULL,
  safe_threshold integer NOT NULL CHECK (safe_threshold = 2), safe_nonce bigint NOT NULL,
  safe_tx_hash text NOT NULL, call_batch_fingerprint text NOT NULL,
  signer_1 text NOT NULL, signer_2 text NOT NULL, signature_set_fingerprint text NOT NULL CHECK (signature_set_fingerprint ~ '^0x[0-9a-f]{64}$'),
  control_revision bigint NOT NULL, binding_fingerprint text NOT NULL CHECK (binding_fingerprint ~ '^0x[0-9a-f]{64}$'),
  issued_by uuid NOT NULL, issued_at timestamptz NOT NULL DEFAULT now(), expires_at timestamptz NOT NULL,
  consumed_at timestamptz, cancelled_at timestamptz, cancel_reason text,
  CONSTRAINT pcart_p93b_permit_ttl CHECK (expires_at > issued_at AND expires_at <= issued_at + interval '30 seconds'),
  CONSTRAINT pcart_p93b_permit_signers CHECK (signer_1 < signer_2)
);
CREATE UNIQUE INDEX pcart_p93b_one_open_permit ON public.pcart_launch_coordinator_action_permits (action_id) WHERE consumed_at IS NULL AND cancelled_at IS NULL;
GRANT SELECT ON public.pcart_launch_coordinator_action_permits TO authenticated;
GRANT ALL ON public.pcart_launch_coordinator_action_permits TO service_role;
ALTER TABLE public.pcart_launch_coordinator_action_permits ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Platform owner reads coordinator action permits" ON public.pcart_launch_coordinator_action_permits
  FOR SELECT TO authenticated USING (public.is_platform_owner(auth.uid()));

CREATE OR REPLACE FUNCTION private.pcart_p93b_permit_guard() RETURNS trigger LANGUAGE plpgsql SET search_path = public AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN RAISE EXCEPTION 'PCART_P9_3B: permits are never deleted.' USING errcode = '42501'; END IF;
  IF TG_OP = 'INSERT' THEN IF NEW.consumed_at IS NOT NULL OR NEW.cancelled_at IS NOT NULL THEN RAISE EXCEPTION 'PCART_P9_3B: permits start open.' USING errcode = '42501'; END IF; RETURN NEW; END IF;
  IF (to_jsonb(NEW) - 'consumed_at' - 'cancelled_at' - 'cancel_reason') IS DISTINCT FROM (to_jsonb(OLD) - 'consumed_at' - 'cancelled_at' - 'cancel_reason') THEN RAISE EXCEPTION 'PCART_P9_3B: permit binding is immutable.' USING errcode = '42501'; END IF;
  IF OLD.consumed_at IS NOT NULL OR OLD.cancelled_at IS NOT NULL THEN RAISE EXCEPTION 'PCART_P9_3B: permit already closed.' USING errcode = '42501'; END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER pcart_p93b_permit_guard BEFORE INSERT OR UPDATE OR DELETE ON public.pcart_launch_coordinator_action_permits FOR EACH ROW EXECUTE FUNCTION private.pcart_p93b_permit_guard();
CREATE TRIGGER pcart_p93b_action_end AFTER UPDATE OF status ON public.pcart_launch_coordinator_actions FOR EACH ROW EXECUTE FUNCTION private.pcart_p93b_on_action_end();

-- ------------------------------------------------------------ helpers
CREATE OR REPLACE FUNCTION private.pcart_p93b_assert(_actor uuid, _action uuid) RETURNS public.pcart_launch_coordinator_actions
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE a public.pcart_launch_coordinator_actions; c record;
BEGIN
  IF _actor IS NULL OR NOT public.is_platform_owner(_actor) THEN RAISE EXCEPTION 'PCART_P9_3B: platform owner only.' USING errcode = '42501'; END IF;
  SELECT * INTO a FROM public.pcart_launch_coordinator_actions WHERE id = _action FOR UPDATE;
  IF a.id IS NULL OR a.action_kind <> 'PREAUCTION_SETUP' THEN RAISE EXCEPTION 'PCART_P9_3B: pre-auction action not found.' USING errcode = '22023'; END IF;
  IF NOT private.is_canonical_pcart_launch(a.launch_id) THEN RAISE EXCEPTION 'PCART_P9_3B: not canonical.' USING errcode = '42501'; END IF;
  SELECT execution_enabled, emergency_stop_engaged INTO c FROM public.launch_chain_production_execution_controls WHERE control_key = 'ROBINHOOD_MAINNET_DEPLOYMENT';
  IF c.execution_enabled IS DISTINCT FROM false OR c.emergency_stop_engaged IS DISTINCT FROM true THEN
    RAISE EXCEPTION 'PCART_P9_3B: CANONICAL_PCART_PROTECTED controls required.' USING errcode = '42501';
  END IF;
  RETURN a;
END $$;
REVOKE ALL ON FUNCTION private.pcart_p93b_assert(uuid, uuid) FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION private.pcart_p93b_revision() RETURNS bigint LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT revision FROM public.launch_chain_production_execution_controls WHERE control_key = 'ROBINHOOD_MAINNET_DEPLOYMENT' $$;
REVOKE ALL ON FUNCTION private.pcart_p93b_revision() FROM PUBLIC, anon, authenticated;

-- Service-role only: server has already recovered the signer from the exact safeTxHash and re-attested live facts.
CREATE OR REPLACE FUNCTION public.record_canonical_pcart_safe_signature(_actor uuid, _action_id uuid, _signer text, _owner_kind text, _safe_tx_hash text, _signature text, _control_revision bigint)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE a public.pcart_launch_coordinator_actions; n int; v_id uuid;
BEGIN
  a := private.pcart_p93b_assert(_actor, _action_id);
  IF a.status NOT IN ('PREPARED','AWAITING_SIGNATURES') THEN RAISE EXCEPTION 'PCART_P9_3B: action not signable (%).', a.status USING errcode = '22023'; END IF;
  IF lower(_safe_tx_hash) <> a.safe_tx_hash THEN RAISE EXCEPTION 'PCART_P9_3B: signature is for a different Safe transaction.' USING errcode = '22023'; END IF;
  IF _control_revision IS DISTINCT FROM private.pcart_p93b_revision() THEN RAISE EXCEPTION 'PCART_P9_3B: control revision changed.' USING errcode = '22023'; END IF;
  IF EXISTS (SELECT 1 FROM public.pcart_launch_coordinator_signatures WHERE action_id = a.id AND status = 'VALID' AND control_revision <> _control_revision) THEN
    RAISE EXCEPTION 'PCART_P9_3B: existing signatures are at another control revision.' USING errcode = '22023';
  END IF;
  INSERT INTO public.pcart_launch_coordinator_signatures (action_id, launch_id, signer_address, owner_account_kind, safe_tx_hash, signature_format, signature, recovered_signer, control_revision, recorded_by)
  VALUES (a.id, a.launch_id, lower(_signer), _owner_kind, lower(_safe_tx_hash), 'SAFE_ECDSA_EIP712_V4', lower(_signature), lower(_signer), _control_revision, _actor)
  RETURNING id INTO v_id;
  SELECT count(*) INTO n FROM public.pcart_launch_coordinator_signatures WHERE action_id = a.id AND status = 'VALID';
  IF a.status = 'PREPARED' THEN UPDATE public.pcart_launch_coordinator_actions SET status = 'AWAITING_SIGNATURES', status_reason = NULL WHERE id = a.id; END IF;
  IF n >= 2 THEN UPDATE public.pcart_launch_coordinator_actions SET status = 'READY', status_reason = NULL WHERE id = a.id; END IF;
  INSERT INTO public.pcart_launch_coordinator_events (launch_id, event_kind, detail, actor)
  VALUES (a.launch_id, 'SIGNATURE_RECORDED', jsonb_build_object('action_id', a.id, 'signer', lower(_signer), 'owner_kind', _owner_kind, 'valid_count', n), _actor);
  RETURN jsonb_build_object('signature_id', v_id, 'valid_count', n);
END $$;
REVOKE ALL ON FUNCTION public.record_canonical_pcart_safe_signature(uuid, uuid, text, text, text, text, bigint) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.record_canonical_pcart_safe_signature(uuid, uuid, text, text, text, text, bigint) TO service_role;

CREATE OR REPLACE FUNCTION public.issue_canonical_pcart_action_permit(_actor uuid, _action_id uuid, _b jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE a public.pcart_launch_coordinator_actions; s1 text; s2 text; n int; v_id uuid; v_exp timestamptz; rev bigint;
BEGIN
  a := private.pcart_p93b_assert(_actor, _action_id);
  IF a.status <> 'READY' OR a.execution_tx_hash IS NOT NULL THEN RAISE EXCEPTION 'PCART_P9_3B: action not READY.' USING errcode = '22023'; END IF;
  rev := private.pcart_p93b_revision();
  IF (_b->>'control_revision')::bigint IS DISTINCT FROM rev THEN RAISE EXCEPTION 'PCART_P9_3B: control revision changed.' USING errcode = '22023'; END IF;
  SELECT count(*), min(signer_address), max(signer_address) INTO n, s1, s2 FROM public.pcart_launch_coordinator_signatures
    WHERE action_id = a.id AND status = 'VALID' AND safe_tx_hash = a.safe_tx_hash AND control_revision = rev;
  IF n <> 2 OR s1 <> lower(_b->>'signer_1') OR s2 <> lower(_b->>'signer_2') THEN RAISE EXCEPTION 'PCART_P9_3B: exactly two current valid signatures required.' USING errcode = '22023'; END IF;
  IF lower(_b->>'safe_tx_hash') <> a.safe_tx_hash OR lower(_b->>'call_batch_fingerprint') <> a.call_batch_fingerprint OR (_b->>'safe_nonce')::bigint <> a.safe_nonce
     OR lower(_b->>'official_token_address') <> a.official_token_address OR lower(_b->>'official_token_code_hash') <> a.official_token_code_hash
     OR (_b->>'p8a_review_id')::uuid <> a.p8a_review_id OR (_b->>'p8b_review_id')::uuid <> a.p8b_review_id
     OR lower(_b->>'p8a_manifest_fingerprint') <> a.p8a_manifest_fingerprint OR lower(_b->>'p8b_manifest_fingerprint') <> a.p8b_manifest_fingerprint
     OR lower(_b->>'dependency_attestation_fingerprint') <> a.dependency_attestation_fingerprint OR lower(_b->>'safe_owners_fingerprint') <> a.safe_owners_fingerprint
     OR lower(_b->>'safe_address') <> a.safe_address THEN
    RAISE EXCEPTION 'PCART_P9_3B: permit binding does not match the prepared action.' USING errcode = '22023';
  END IF;
  IF EXISTS (SELECT 1 FROM public.pcart_policy_approval_revocations WHERE review_id IN (a.p8a_review_id, a.p8b_review_id)) THEN RAISE EXCEPTION 'PCART_P9_3B: policy approval revoked.' USING errcode = '22023'; END IF;
  UPDATE public.pcart_launch_coordinator_action_permits SET cancelled_at = now(), cancel_reason = 'EXPIRED'
    WHERE action_id = a.id AND consumed_at IS NULL AND cancelled_at IS NULL AND expires_at <= now();
  IF EXISTS (SELECT 1 FROM public.pcart_launch_coordinator_action_permits WHERE action_id = a.id AND consumed_at IS NULL AND cancelled_at IS NULL) THEN
    RAISE EXCEPTION 'PCART_P9_3B: a conflicting permit is still open.' USING errcode = '22023';
  END IF;
  v_exp := now() + interval '30 seconds';
  INSERT INTO public.pcart_launch_coordinator_action_permits (action_id, launch_id, binding_version, action_type, chain_id, official_token_address, official_token_code_hash,
    p8a_review_id, p8a_manifest_fingerprint, p8b_review_id, p8b_manifest_fingerprint, dependency_attestation_fingerprint, safe_address, safe_owners_fingerprint,
    safe_threshold, safe_nonce, safe_tx_hash, call_batch_fingerprint, signer_1, signer_2, signature_set_fingerprint, control_revision, binding_fingerprint, issued_by, expires_at)
  VALUES (a.id, a.launch_id, _b->>'binding_version', 'PREAUCTION_SAFE_EXECUTE', 4663, a.official_token_address, a.official_token_code_hash,
    a.p8a_review_id, a.p8a_manifest_fingerprint, a.p8b_review_id, a.p8b_manifest_fingerprint, a.dependency_attestation_fingerprint, a.safe_address, a.safe_owners_fingerprint,
    2, a.safe_nonce, a.safe_tx_hash, a.call_batch_fingerprint, s1, s2, lower(_b->>'signature_set_fingerprint'), rev, lower(_b->>'binding_fingerprint'), _actor, v_exp)
  RETURNING id INTO v_id;
  INSERT INTO public.pcart_launch_coordinator_events (launch_id, event_kind, detail, actor)
  VALUES (a.launch_id, 'PERMIT_ISSUED', jsonb_build_object('action_id', a.id, 'permit_id', v_id, 'expires_at', v_exp, 'control_revision', rev), _actor);
  RETURN jsonb_build_object('permit_id', v_id, 'expires_at', v_exp);
END $$;
REVOKE ALL ON FUNCTION public.issue_canonical_pcart_action_permit(uuid, uuid, jsonb) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.issue_canonical_pcart_action_permit(uuid, uuid, jsonb) TO service_role;

-- Consumes the permit and moves READY -> UNCERTAIN *before* the wallet handoff (claim-before-send).
CREATE OR REPLACE FUNCTION public.claim_canonical_pcart_action_permit(_actor uuid, _permit_id uuid, _binding_fingerprint text, _signature_set_fingerprint text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE p public.pcart_launch_coordinator_action_permits; a public.pcart_launch_coordinator_actions;
BEGIN
  SELECT * INTO p FROM public.pcart_launch_coordinator_action_permits WHERE id = _permit_id FOR UPDATE;
  IF p.id IS NULL THEN RAISE EXCEPTION 'PCART_P9_3B: permit not found.' USING errcode = '22023'; END IF;
  a := private.pcart_p93b_assert(_actor, p.action_id);
  IF p.consumed_at IS NOT NULL OR p.cancelled_at IS NOT NULL THEN RAISE EXCEPTION 'PCART_P9_3B: permit already used.' USING errcode = '22023'; END IF;
  IF p.expires_at <= now() THEN
    UPDATE public.pcart_launch_coordinator_action_permits SET cancelled_at = now(), cancel_reason = 'EXPIRED' WHERE id = p.id;
    RETURN jsonb_build_object('ok', false, 'reason', 'PERMIT_EXPIRED');
  END IF;
  IF p.control_revision IS DISTINCT FROM private.pcart_p93b_revision() OR lower(_binding_fingerprint) <> p.binding_fingerprint OR lower(_signature_set_fingerprint) <> p.signature_set_fingerprint
     OR a.status <> 'READY' OR a.execution_tx_hash IS NOT NULL OR a.safe_tx_hash <> p.safe_tx_hash OR a.safe_nonce <> p.safe_nonce THEN
    UPDATE public.pcart_launch_coordinator_action_permits SET cancelled_at = now(), cancel_reason = 'BINDING_MISMATCH_AT_CLAIM' WHERE id = p.id;
    RETURN jsonb_build_object('ok', false, 'reason', 'BINDING_MISMATCH');
  END IF;
  IF (SELECT count(*) FROM public.pcart_launch_coordinator_signatures WHERE action_id = a.id AND status = 'VALID' AND control_revision = p.control_revision AND signer_address IN (p.signer_1, p.signer_2)) <> 2 THEN
    UPDATE public.pcart_launch_coordinator_action_permits SET cancelled_at = now(), cancel_reason = 'SIGNATURES_CHANGED' WHERE id = p.id;
    RETURN jsonb_build_object('ok', false, 'reason', 'SIGNATURES_CHANGED');
  END IF;
  UPDATE public.pcart_launch_coordinator_action_permits SET consumed_at = now() WHERE id = p.id;
  UPDATE public.pcart_launch_coordinator_actions SET status = 'UNCERTAIN', status_reason = 'HANDOFF_STARTED' WHERE id = a.id;
  INSERT INTO public.pcart_launch_coordinator_events (launch_id, event_kind, detail, actor)
  VALUES (a.launch_id, 'EXECUTION_CLAIMED', jsonb_build_object('action_id', a.id, 'permit_id', p.id), _actor);
  RETURN jsonb_build_object('ok', true);
END $$;
REVOKE ALL ON FUNCTION public.claim_canonical_pcart_action_permit(uuid, uuid, text, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.claim_canonical_pcart_action_permit(uuid, uuid, text, text) TO service_role;

CREATE OR REPLACE FUNCTION public.record_canonical_pcart_action_tx(_actor uuid, _action_id uuid, _tx_hash text)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE a public.pcart_launch_coordinator_actions;
BEGIN
  IF _actor IS NULL OR NOT public.is_platform_owner(_actor) THEN RAISE EXCEPTION 'PCART_P9_3B: platform owner only.' USING errcode = '42501'; END IF;
  SELECT * INTO a FROM public.pcart_launch_coordinator_actions WHERE id = _action_id FOR UPDATE;
  IF a.id IS NULL OR a.status <> 'UNCERTAIN' OR a.execution_tx_hash IS NOT NULL THEN RAISE EXCEPTION 'PCART_P9_3B: no open handoff for this action.' USING errcode = '22023'; END IF;
  UPDATE public.pcart_launch_coordinator_actions SET status = 'SUBMITTED', status_reason = NULL, execution_tx_hash = lower(_tx_hash), execution_submitted_at = now() WHERE id = a.id;
  INSERT INTO public.pcart_launch_coordinator_events (launch_id, event_kind, detail, actor)
  VALUES (a.launch_id, 'EXECUTION_SUBMITTED', jsonb_build_object('action_id', a.id, 'tx_hash', lower(_tx_hash)), _actor);
END $$;
REVOKE ALL ON FUNCTION public.record_canonical_pcart_action_tx(uuid, uuid, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.record_canonical_pcart_action_tx(uuid, uuid, text) TO service_role;

-- Server has verified receipt + Safe ExecutionSuccess(safeTxHash) + nonce+1 + InitializerCreated + auction views.
CREATE OR REPLACE FUNCTION public.confirm_canonical_pcart_action(_actor uuid, _action_id uuid, _tx_hash text, _block bigint, _auction_address text)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE a public.pcart_launch_coordinator_actions;
BEGIN
  IF _actor IS NULL OR NOT public.is_platform_owner(_actor) THEN RAISE EXCEPTION 'PCART_P9_3B: platform owner only.' USING errcode = '42501'; END IF;
  SELECT * INTO a FROM public.pcart_launch_coordinator_actions WHERE id = _action_id FOR UPDATE;
  IF a.id IS NULL OR a.status NOT IN ('UNCERTAIN','SUBMITTED') THEN RAISE EXCEPTION 'PCART_P9_3B: nothing to confirm.' USING errcode = '22023'; END IF;
  IF a.execution_tx_hash IS NOT NULL AND a.execution_tx_hash <> lower(_tx_hash) THEN RAISE EXCEPTION 'PCART_P9_3B: tx hash differs from the recorded one.' USING errcode = '22023'; END IF;
  UPDATE public.pcart_launch_coordinator_actions SET status = 'CONFIRMED', status_reason = NULL, execution_tx_hash = lower(_tx_hash),
    execution_submitted_at = coalesce(a.execution_submitted_at, now()), execution_confirmed_at = now(), execution_confirmed_block = _block, auction_address = lower(_auction_address)
  WHERE id = a.id;
  INSERT INTO public.pcart_launch_coordinator_events (launch_id, event_kind, detail, actor)
  VALUES (a.launch_id, 'EXECUTION_CONFIRMED', jsonb_build_object('action_id', a.id, 'tx_hash', lower(_tx_hash), 'block', _block, 'auction', lower(_auction_address)), _actor);
END $$;
REVOKE ALL ON FUNCTION public.confirm_canonical_pcart_action(uuid, uuid, text, bigint, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.confirm_canonical_pcart_action(uuid, uuid, text, bigint, text) TO service_role;

-- Server has proven the receipt reverted (Safe nonce unchanged) → action closes; signatures stale; re-prepare required.
CREATE OR REPLACE FUNCTION public.record_canonical_pcart_action_reverted(_actor uuid, _action_id uuid, _tx_hash text)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE a public.pcart_launch_coordinator_actions;
BEGIN
  IF _actor IS NULL OR NOT public.is_platform_owner(_actor) THEN RAISE EXCEPTION 'PCART_P9_3B: platform owner only.' USING errcode = '42501'; END IF;
  SELECT * INTO a FROM public.pcart_launch_coordinator_actions WHERE id = _action_id FOR UPDATE;
  IF a.id IS NULL OR a.status NOT IN ('UNCERTAIN','SUBMITTED') OR (a.execution_tx_hash IS NOT NULL AND a.execution_tx_hash <> lower(_tx_hash)) THEN
    RAISE EXCEPTION 'PCART_P9_3B: no matching submission.' USING errcode = '22023';
  END IF;
  UPDATE public.pcart_launch_coordinator_actions SET status = 'CANCELLED', status_reason = 'ON_CHAIN_REVERTED', execution_tx_hash = lower(_tx_hash) WHERE id = a.id;
  INSERT INTO public.pcart_launch_coordinator_events (launch_id, event_kind, detail, actor)
  VALUES (a.launch_id, 'EXECUTION_REVERTED', jsonb_build_object('action_id', a.id, 'tx_hash', lower(_tx_hash)), _actor);
END $$;
REVOKE ALL ON FUNCTION public.record_canonical_pcart_action_reverted(uuid, uuid, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.record_canonical_pcart_action_reverted(uuid, uuid, text) TO service_role;

-- Explicit owner acknowledgement that the wallet returned no hash; only while the Safe nonce is server-verified unchanged.
-- Safe: a later-mined stray execTransaction and a new one cannot both succeed (Safe nonce). A fresh permit is still required.
CREATE OR REPLACE FUNCTION public.release_canonical_pcart_action_handoff(_actor uuid, _action_id uuid, _verified_safe_nonce bigint)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE a public.pcart_launch_coordinator_actions;
BEGIN
  a := private.pcart_p93b_assert(_actor, _action_id);
  IF a.status <> 'UNCERTAIN' OR a.execution_tx_hash IS NOT NULL OR _verified_safe_nonce IS DISTINCT FROM a.safe_nonce THEN
    RAISE EXCEPTION 'PCART_P9_3B: handoff cannot be released.' USING errcode = '22023';
  END IF;
  UPDATE public.pcart_launch_coordinator_actions SET status = 'READY', status_reason = 'HANDOFF_RELEASED_NO_HASH' WHERE id = a.id;
  INSERT INTO public.pcart_launch_coordinator_events (launch_id, event_kind, detail, actor)
  VALUES (a.launch_id, 'HANDOFF_RELEASED', jsonb_build_object('action_id', a.id, 'safe_nonce', _verified_safe_nonce), _actor);
END $$;
REVOKE ALL ON FUNCTION public.release_canonical_pcart_action_handoff(uuid, uuid, bigint) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.release_canonical_pcart_action_handoff(uuid, uuid, bigint) TO service_role;