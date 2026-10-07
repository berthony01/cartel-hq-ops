ALTER TABLE public.pcart_auction_liquidity_plan_reviews
  DROP CONSTRAINT pcart_auction_liquidity_plan_reviews_manifest_version_check;
ALTER TABLE public.pcart_auction_liquidity_plan_reviews
  ADD CONSTRAINT pcart_auction_liquidity_plan_reviews_manifest_version_check
  CHECK (manifest_version IN ('pcart-auction-liquidity-p8a-v1','pcart-auction-liquidity-p8a-v2'));

CREATE OR REPLACE FUNCTION public.record_pcart_auction_liquidity_plan_review(
  _launch_id uuid,
  _manifest_version text,
  _manifest_fingerprint text,
  _rehearsal_mode text,
  _dependency_attestation jsonb,
  _simulation_fingerprint text,
  _simulation_summary jsonb
) RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  l record;
  v_kind text;
  v_dep uuid;
  v_id uuid;
  v_bad int;
BEGIN
  IF auth.uid() IS NULL OR NOT public.is_platform_owner(auth.uid()) THEN
    RAISE EXCEPTION 'PCART_P8A: platform owner only.' USING errcode = '42501';
  END IF;
  IF _manifest_version IS DISTINCT FROM 'pcart-auction-liquidity-p8a-v2' THEN
    RAISE EXCEPTION 'PCART_P8A: only plan v2 can be reviewed.' USING errcode = '22023';
  END IF;
  IF NOT private.is_canonical_pcart_launch(_launch_id) THEN
    RAISE EXCEPTION 'PCART_P8A: not the canonical PEPECARTEL launch.' USING errcode = '42501';
  END IF;
  IF jsonb_typeof(_dependency_attestation -> 'mainnet') IS DISTINCT FROM 'array'
     OR jsonb_array_length(_dependency_attestation -> 'mainnet') < 1 THEN
    RAISE EXCEPTION 'PCART_P8A: mainnet dependency attestation missing.' USING errcode = '22023';
  END IF;
  SELECT count(*) INTO v_bad FROM jsonb_array_elements(_dependency_attestation -> 'mainnet') e
   WHERE e ->> 'status' IS DISTINCT FROM 'MATCH';
  IF v_bad > 0 THEN
    RAISE EXCEPTION 'PCART_P8A: mainnet dependency not MATCH; review blocked.' USING errcode = '22023';
  END IF;
  SELECT id, official_contract_address, official_contract_deployment_id INTO l FROM public.launches WHERE id = _launch_id;
  IF l.official_contract_address IS NULL THEN
    v_kind := 'PREDEPLOYMENT'; v_dep := NULL;
  ELSE
    IF l.official_contract_deployment_id IS NULL THEN
      RAISE EXCEPTION 'PCART_P8A: incomplete official binding.' USING errcode = '22023';
    END IF;
    v_kind := 'POST_REGISTRATION'; v_dep := l.official_contract_deployment_id;
  END IF;
  INSERT INTO public.pcart_auction_liquidity_plan_reviews (
    launch_id, deployment_id, review_kind, manifest_version, manifest_fingerprint, rehearsal_mode,
    dependency_attestation, mainnet_dependencies_ok, simulation_fingerprint, simulation_summary,
    unsold_policy, unsold_policy_requires_live_reconfirmation, lp_custody_policy,
    reviewed_by, reviewed_at, expires_at)
  VALUES (_launch_id, v_dep, v_kind, _manifest_version, lower(_manifest_fingerprint), _rehearsal_mode,
    _dependency_attestation, true, lower(_simulation_fingerprint), _simulation_summary,
    'RETURN_TO_TREASURY_SAFE', true, 'PERMANENT_FEES_OFF_FEESPLITTER',
    auth.uid(), now(), now() + interval '24 hours')
  RETURNING id INTO v_id;
  RETURN v_id;
END $$;
REVOKE ALL ON FUNCTION public.record_pcart_auction_liquidity_plan_review(uuid, text, text, text, jsonb, text, jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.record_pcart_auction_liquidity_plan_review(uuid, text, text, text, jsonb, text, jsonb) TO authenticated;