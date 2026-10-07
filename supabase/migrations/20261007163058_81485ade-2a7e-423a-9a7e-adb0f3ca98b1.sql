CREATE TABLE public.pcart_auction_execution_rehearsal_reviews (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  launch_id uuid NOT NULL REFERENCES public.launches(id) ON DELETE RESTRICT,
  p8a_review_id uuid NOT NULL REFERENCES public.pcart_auction_liquidity_plan_reviews(id) ON DELETE RESTRICT,
  manifest_version text NOT NULL CHECK (manifest_version = 'pcart-auction-execution-p8b-v1'),
  manifest_fingerprint text NOT NULL CHECK (manifest_fingerprint ~ '^0x[0-9a-f]{64}$'),
  fork_block bigint NOT NULL CHECK (fork_block = 82592963),
  source_attestation_fingerprint text NOT NULL CHECK (source_attestation_fingerprint ~ '^0x[0-9a-f]{64}$'),
  success_fingerprint text NOT NULL CHECK (success_fingerprint ~ '^0x[0-9a-f]{64}$'),
  refund_fingerprint text NOT NULL CHECK (refund_fingerprint ~ '^0x[0-9a-f]{64}$'),
  floor_price_q96 numeric(78,0) NOT NULL CHECK (floor_price_q96 = 5281877500950955839500),
  tick_spacing_q96 numeric(78,0) NOT NULL CHECK (tick_spacing_q96 = 52818775009509558395),
  release_schedule_fingerprint text NOT NULL CHECK (release_schedule_fingerprint ~ '^0x[0-9a-f]{64}$'),
  duration_blocks integer NOT NULL CHECK (duration_blocks = 5885000),
  transaction_sequence jsonb NOT NULL,
  live_attestation jsonb NOT NULL,
  safe_tx_count_pre integer NOT NULL CHECK (safe_tx_count_pre = 1),
  safe_tx_count_post integer NOT NULL CHECK (safe_tx_count_post = 1),
  signatures_per_safe_tx integer NOT NULL CHECK (signatures_per_safe_tx = 2),
  settlement_mode text NOT NULL CHECK (settlement_mode = 'AUTOMATIC_IN_MIGRATE'),
  migration_mode text NOT NULL CHECK (migration_mode = 'EXPLICIT_PERMISSIONLESS_MIGRATE'),
  refund_mode text NOT NULL CHECK (refund_mode = 'CLAIM_BASED_EXIT_BID'),
  unsold_mode text NOT NULL CHECK (unsold_mode = 'SAFE_SWEEP_UNSOLD_TOKENS'),
  lp_custody_mode text NOT NULL CHECK (lp_custody_mode = 'AUTOMATIC_PERMANENT_FEES_OFF_FEESPLITTER'),
  overall_result text NOT NULL CHECK (overall_result = 'PASS'),
  reviewed_by uuid NOT NULL,
  reviewed_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX pcart_p8b_reviews_launch_idx ON public.pcart_auction_execution_rehearsal_reviews (launch_id, reviewed_at DESC);
GRANT SELECT ON public.pcart_auction_execution_rehearsal_reviews TO authenticated;
GRANT ALL ON public.pcart_auction_execution_rehearsal_reviews TO service_role;
ALTER TABLE public.pcart_auction_execution_rehearsal_reviews ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Platform owner reads P8B rehearsal reviews"
  ON public.pcart_auction_execution_rehearsal_reviews FOR SELECT TO authenticated
  USING (public.is_platform_owner(auth.uid()));

CREATE OR REPLACE FUNCTION private.pcart_p8b_reviews_immutable()
RETURNS trigger LANGUAGE plpgsql SET search_path = public AS $$
BEGIN
  RAISE EXCEPTION 'PCART_P8B: rehearsal reviews are immutable.' USING errcode = '42501';
END $$;
CREATE TRIGGER pcart_p8b_reviews_no_update BEFORE UPDATE OR DELETE ON public.pcart_auction_execution_rehearsal_reviews
  FOR EACH ROW EXECUTE FUNCTION private.pcart_p8b_reviews_immutable();

-- Review record only. Never mutates launches, deployments, controls or official-contract state.
CREATE OR REPLACE FUNCTION public.review_canonical_pcart_p8b_rehearsal(
  _launch_id uuid,
  _manifest_fingerprint text,
  _source_attestation_fingerprint text,
  _success_fingerprint text,
  _refund_fingerprint text,
  _release_schedule_fingerprint text,
  _transaction_sequence jsonb,
  _live_attestation jsonb
) RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  c_manifest constant text := '0x78435a8789fe12d4985821e0e48d8ec0a2191fb9606d04ebb63b6bb16974f579';
  c_p8a_fp constant text := '0x320269f530f5f5d886dd3579c1f8866ebcc2f7affc8e888232edd070fb86e7e2';
  a record;
  v_existing uuid;
  v_id uuid;
BEGIN
  IF auth.uid() IS NULL OR NOT public.is_platform_owner(auth.uid()) THEN
    RAISE EXCEPTION 'PCART_P8B: platform owner only.' USING errcode = '42501';
  END IF;
  IF NOT private.is_canonical_pcart_launch(_launch_id) THEN
    RAISE EXCEPTION 'PCART_P8B: not the canonical PEPECARTEL launch.' USING errcode = '42501';
  END IF;
  IF lower(coalesce(_manifest_fingerprint, '')) <> c_manifest THEN
    RAISE EXCEPTION 'PCART_P8B: execution manifest fingerprint mismatch.' USING errcode = '22023';
  END IF;
  IF coalesce((_live_attestation ->> 'codeHashesOk')::boolean, false) IS NOT TRUE
     OR coalesce((_live_attestation ->> 'safeOk')::boolean, false) IS NOT TRUE THEN
    RAISE EXCEPTION 'PCART_P8B: live read-only attestation not PASS.' USING errcode = '22023';
  END IF;
  SELECT id, expires_at INTO a FROM public.pcart_auction_liquidity_plan_reviews
   WHERE launch_id = _launch_id AND manifest_version = 'pcart-auction-liquidity-p8a-v2'
     AND manifest_fingerprint = c_p8a_fp AND expires_at > now()
   ORDER BY reviewed_at DESC LIMIT 1;
  IF a.id IS NULL THEN
    RAISE EXCEPTION 'PCART_P8B: current P8A v2 review required.' USING errcode = '22023';
  END IF;
  SELECT id INTO v_existing FROM public.pcart_auction_execution_rehearsal_reviews
   WHERE launch_id = _launch_id AND manifest_fingerprint = c_manifest AND expires_at > now()
   ORDER BY reviewed_at DESC LIMIT 1;
  IF v_existing IS NOT NULL THEN
    RETURN v_existing;
  END IF;
  INSERT INTO public.pcart_auction_execution_rehearsal_reviews (
    launch_id, p8a_review_id, manifest_version, manifest_fingerprint, fork_block,
    source_attestation_fingerprint, success_fingerprint, refund_fingerprint,
    floor_price_q96, tick_spacing_q96, release_schedule_fingerprint, duration_blocks,
    transaction_sequence, live_attestation, safe_tx_count_pre, safe_tx_count_post, signatures_per_safe_tx,
    settlement_mode, migration_mode, refund_mode, unsold_mode, lp_custody_mode, overall_result,
    reviewed_by, reviewed_at, expires_at)
  VALUES (_launch_id, a.id, 'pcart-auction-execution-p8b-v1', c_manifest, 82592963,
    lower(_source_attestation_fingerprint), lower(_success_fingerprint), lower(_refund_fingerprint),
    5281877500950955839500, 52818775009509558395, lower(_release_schedule_fingerprint), 5885000,
    _transaction_sequence, _live_attestation, 1, 1, 2,
    'AUTOMATIC_IN_MIGRATE', 'EXPLICIT_PERMISSIONLESS_MIGRATE', 'CLAIM_BASED_EXIT_BID', 'SAFE_SWEEP_UNSOLD_TOKENS',
    'AUTOMATIC_PERMANENT_FEES_OFF_FEESPLITTER', 'PASS',
    auth.uid(), now(), least(a.expires_at, now() + interval '24 hours'))
  RETURNING id INTO v_id;
  RETURN v_id;
END $$;
REVOKE ALL ON FUNCTION public.review_canonical_pcart_p8b_rehearsal(uuid, text, text, text, text, text, jsonb, jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.review_canonical_pcart_p8b_rehearsal(uuid, text, text, text, text, text, jsonb, jsonb) TO authenticated;