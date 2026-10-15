-- PEPE CARTEL / CARTEL HQ — G2D STAGING-COMPATIBLE PRO POLICY
-- REVIEW ONLY — DO NOT EXECUTE WITHOUT SEPARATE STAGING DB APPROVAL.
-- Supabase isolated staging project llicojkxpzwylghptmkf ONLY.
-- Production ocoinbnjgstkmnwwvnhi is NOT an acceptable target.
-- Does not apply the production-format G2D migration to simplified staging.
-- No Kie calls, model quote substitution, secret, Telegram, wallet, Stripe,
-- paid task, new infrastructure, customer billing, production or PCART changes.
-- Derived exact reserve function from G2D approved draft
-- docs/sql/G2D_CARTEL_GUIDE_PRO_100_WORKSPACE_POLICY_CANDIDATE.sql.
-- Structural change: exactly ONE column; one function replacement;
-- one existing staging Pro entitlement activation (NO payment);
-- controlled row update, STOP remains ON through transaction and afterward.
-- This is a persistent STAGING migration, NOT the rollback behavioral test.
-- Requires explicit migration approval and post-commit verification, then STOP.
BEGIN;
SET LOCAL lock_timeout='3s';
SET LOCAL statement_timeout='45s';
SET LOCAL idle_in_transaction_session_timeout='55s';
DO $preflight$
BEGIN
 -- Hard failure on real Cartel HQ production's different billing schema.
 IF EXISTS (SELECT 1 FROM information_schema.columns
  WHERE table_schema='public' AND table_name='commercial_plans'
    AND column_name='price_cents')
 OR EXISTS (SELECT 1 FROM information_schema.columns
  WHERE table_schema='public' AND table_name='commercial_plan_entitlements'
    AND column_name='customer_visible') THEN
 RAISE EXCEPTION 'WRONG_PROJECT_PRODUCTION_SCHEMA'; END IF;
 IF (SELECT count(*) FROM public.commercial_plans
  WHERE code='cartel_49' AND version=1 AND status='active')<>1
 OR (SELECT count(*) FROM public.commercial_plan_entitlements e
  JOIN public.commercial_plans p ON p.id=e.plan_id
  WHERE p.code='cartel_49' AND p.version=1
    AND e.feature_key='guide_conversation' AND e.enabled=false
    AND e.kind='feature' AND e.period='none')<>1 THEN
 RAISE EXCEPTION 'STAGING_PRO_FIXTURE_DRIFT'; END IF;
 IF (SELECT count(*) FROM public.cartel_guide_budget_controls
  WHERE singleton=true AND enabled=false AND customer_pilot_enabled=false
    AND emergency_stop=true AND customer_user_month_requests=10)<>1
 OR EXISTS (SELECT 1 FROM information_schema.columns
   WHERE table_schema='public' AND table_name='cartel_guide_budget_controls'
     AND column_name='customer_workspace_month_requests')
 OR md5(pg_get_functiondef('public.cartel_guide_reserve_budget(uuid,uuid,uuid)'::regprocedure))
    <> 'c4c3d33069006ecd021d49497dadee4d'
 OR (SELECT count(*) FROM public.cartel_guide_budget_reservations)<>7
 OR (SELECT count(*) FROM public.cartel_guide_budget_reservations
   WHERE workspace_id='bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb'::uuid)<>0 THEN
 RAISE EXCEPTION 'GUIDE_STAGING_BASELINE_DRIFT'; END IF;
 IF (SELECT count(*) FROM public.cartel_guide_budget_controls c
 JOIN public.cartel_guide_model_quotes q ON q.id=c.quote_id
 WHERE c.singleton=true AND q.provider='test-provider-never-called'
 AND q.model='offline-test-model')<>1 THEN
 RAISE EXCEPTION 'STAGING_FAKE_MODEL_QUOTE_DRIFT'; END IF;
END $preflight$;
-- Add only the already-approved customer shared-workspace request cap.
ALTER TABLE public.cartel_guide_budget_controls
  ADD COLUMN customer_workspace_month_requests integer
    CHECK (customer_workspace_month_requests > 0);
-- Corrected atomic reservation function from G2D source unchanged:
CREATE OR REPLACE FUNCTION public.cartel_guide_reserve_budget(
  _user_id uuid, _workspace_id uuid, _request_id uuid
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public
AS $function$
DECLARE
  v_cfg public.cartel_guide_budget_controls%ROWTYPE;
  v_quote public.cartel_guide_model_quotes%ROWTYPE;
  v_existing public.cartel_guide_budget_reservations%ROWTYPE;
  v_owner boolean;
  v_eval jsonb;
  v_cost bigint;
  v_day timestamptz := date_trunc('day', now() AT TIME ZONE 'UTC') AT TIME ZONE 'UTC';
  v_month timestamptz := date_trunc('month', now() AT TIME ZONE 'UTC') AT TIME ZONE 'UTC';
  v_global_day bigint;
  v_global_month bigint;
  v_workspace_month bigint;
  v_workspace_requests bigint;
  v_user_month bigint;
  v_user_requests bigint;
  v_pending bigint;
  v_id uuid;
BEGIN
  IF _user_id IS NULL OR _workspace_id IS NULL OR _request_id IS NULL THEN
    RETURN jsonb_build_object('allowed', false, 'reason', 'INVALID_CONTEXT');
  END IF;

  -- Fail closed against cross-workspace requests, even with privileged caller.
  IF NOT EXISTS (
    SELECT 1 FROM public.workspaces w WHERE w.id = _workspace_id AND w.owner_id = _user_id
  ) AND NOT EXISTS (
    SELECT 1 FROM public.workspace_members m
    WHERE m.workspace_id = _workspace_id AND m.user_id = _user_id
  ) THEN
    RETURN jsonb_build_object('allowed', false, 'reason', 'FORBIDDEN');
  END IF;

  PERFORM pg_catalog.pg_advisory_xact_lock(4127, 2202);
  SELECT * INTO v_existing FROM public.cartel_guide_budget_reservations
  WHERE user_id = _user_id AND workspace_id = _workspace_id AND request_id = _request_id;
  IF FOUND THEN
    -- Never authorize a duplicate provider request.
    RETURN jsonb_build_object('allowed', false, 'reason', 'DUPLICATE_REQUEST');
  END IF;

  SELECT * INTO v_cfg FROM public.cartel_guide_budget_controls
    WHERE singleton = true FOR SHARE;
  IF NOT FOUND OR v_cfg.enabled IS DISTINCT FROM true
     OR v_cfg.emergency_stop IS DISTINCT FROM false THEN
    RETURN jsonb_build_object('allowed', false, 'reason', 'GUIDE_DISABLED');
  END IF;
  IF v_cfg.quote_id IS NULL OR v_cfg.global_day_cap_micro_usd IS NULL
     OR v_cfg.global_month_cap_micro_usd IS NULL
     OR v_cfg.platform_concurrent_reservations IS NULL THEN
    RETURN jsonb_build_object('allowed', false, 'reason', 'BUDGET_UNCONFIGURED');
  END IF;

  SELECT * INTO v_quote FROM public.cartel_guide_model_quotes
  WHERE id = v_cfg.quote_id;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('allowed', false, 'reason', 'QUOTE_UNAVAILABLE');
  END IF;
  -- Prices represent micro-USD per one million tokens. Quote is server-owned.
  v_cost := greatest(1, ceil(
    (v_quote.max_input_tokens::numeric * v_quote.input_micro_usd_per_million +
     v_quote.max_output_tokens::numeric * v_quote.output_micro_usd_per_million) / 1000000
  )::bigint);

  SELECT COALESCE(SUM(CASE
    WHEN state IN ('held','in_flight') THEN reserved_micro_usd
    WHEN state = 'settled' THEN actual_micro_usd ELSE 0 END),0)
    INTO v_global_day
  FROM public.cartel_guide_budget_reservations
  WHERE state IN ('held','in_flight') OR (state = 'settled' AND reserved_at >= v_day);

  SELECT COALESCE(SUM(CASE
    WHEN state IN ('held','in_flight') THEN reserved_micro_usd
    WHEN state = 'settled' THEN actual_micro_usd ELSE 0 END),0)
    INTO v_global_month
  FROM public.cartel_guide_budget_reservations
  WHERE state IN ('held','in_flight') OR (state = 'settled' AND reserved_at >= v_month);

  SELECT COUNT(*) INTO v_pending FROM public.cartel_guide_budget_reservations
  WHERE state IN ('held','in_flight');

  IF v_cost > v_cfg.global_day_cap_micro_usd - v_global_day
    OR v_cost > v_cfg.global_month_cap_micro_usd - v_global_month
    OR v_pending >= v_cfg.platform_concurrent_reservations THEN
    RETURN jsonb_build_object('allowed', false, 'reason', 'GLOBAL_BUDGET_LIMIT');
  END IF;

  v_owner := public.has_platform_unrestricted_access(_user_id) IS TRUE;
  IF NOT v_owner THEN
    IF v_cfg.customer_pilot_enabled IS DISTINCT FROM true THEN
      RETURN jsonb_build_object('allowed', false, 'reason', 'CUSTOMERS_NOT_ENABLED');
    END IF;
    -- No existing customer Guide entitlement was found in the live system
    -- during audit. Customer access must fail closed until explicitly added.
    IF NOT EXISTS (
      SELECT 1 FROM public.workspace_commercial_assignments a
      JOIN public.commercial_plan_entitlements e ON e.plan_id = a.plan_id
      WHERE a.workspace_id = _workspace_id AND e.feature_key = 'guide_conversation'
        AND e.enabled = true
    ) THEN
      RETURN jsonb_build_object('allowed', false, 'reason', 'ENTITLEMENT_NOT_CONFIGURED');
    END IF;
    v_eval := public.evaluate_commercial_access(
      _workspace_id, 'guide_conversation', _user_id
    );
    IF v_eval IS NULL OR v_eval->>'allowed' IS DISTINCT FROM 'true'
       OR v_eval->>'would_block' = 'true' THEN
      RETURN jsonb_build_object('allowed', false, 'reason', 'ENTITLEMENT_DENIED');
    END IF;
    IF v_cfg.customer_workspace_month_cap_micro_usd IS NULL
       OR v_cfg.customer_workspace_month_requests IS NULL
       OR v_cfg.customer_user_month_cap_micro_usd IS NULL
       OR v_cfg.customer_user_month_requests IS NULL THEN
      RETURN jsonb_build_object('allowed', false, 'reason', 'CUSTOMER_BUDGET_UNCONFIGURED');
    END IF;

    SELECT COALESCE(SUM(CASE WHEN state IN ('held','in_flight') THEN reserved_micro_usd
       WHEN state = 'settled' THEN actual_micro_usd ELSE 0 END),0),
      COUNT(*) INTO v_workspace_month, v_workspace_requests FROM public.cartel_guide_budget_reservations
    WHERE workspace_id = _workspace_id
      AND owner_quota_exempt = false
      AND (state IN ('held','in_flight') OR (state = 'settled' AND reserved_at >= v_month));

    SELECT COALESCE(SUM(CASE WHEN state IN ('held','in_flight') THEN reserved_micro_usd
       WHEN state = 'settled' THEN actual_micro_usd ELSE 0 END),0),
      COUNT(*) INTO v_user_month, v_user_requests
    FROM public.cartel_guide_budget_reservations
    WHERE user_id = _user_id
      AND (state IN ('held','in_flight') OR (state = 'settled' AND reserved_at >= v_month));

    IF v_cost > v_cfg.customer_workspace_month_cap_micro_usd - v_workspace_month
      OR v_workspace_requests >= v_cfg.customer_workspace_month_requests
      OR v_cost > v_cfg.customer_user_month_cap_micro_usd - v_user_month
      OR v_user_requests >= v_cfg.customer_user_month_requests THEN
      RETURN jsonb_build_object('allowed', false, 'reason', 'CUSTOMER_BUDGET_LIMIT');
    END IF;
  END IF;

  INSERT INTO public.cartel_guide_budget_reservations (
    user_id, workspace_id, request_id, owner_quota_exempt, quote_id, provider, model, price_version,
    max_input_tokens, max_output_tokens, input_micro_usd_per_million,
    output_micro_usd_per_million, reserved_micro_usd
  ) VALUES (
    _user_id, _workspace_id, _request_id, v_owner, v_quote.id, v_quote.provider,
    v_quote.model, v_quote.price_version, v_quote.max_input_tokens,
    v_quote.max_output_tokens, v_quote.input_micro_usd_per_million,
    v_quote.output_micro_usd_per_million, v_cost
  ) RETURNING id INTO v_id;

  RETURN jsonb_build_object('allowed', true, 'reservation_id', v_id,
    'reserved_micro_usd', v_cost, 'provider', v_quote.provider,
    'model', v_quote.model, 'price_version', v_quote.price_version,
    'max_input_tokens', v_quote.max_input_tokens,
    'max_output_tokens', v_quote.max_output_tokens);
EXCEPTION WHEN OTHERS THEN
  -- No raw SQL exception text, no secrets. Fail closed and roll back writes.
  RETURN jsonb_build_object('allowed', false, 'reason', 'BUDGET_UNAVAILABLE');
END;
$function$;
-- Configure the staged customer quota with STOP continuously enforced.
-- Limit per-user to <=100; all requests across users must also satisfy 100/workspace.
UPDATE public.cartel_guide_budget_controls
SET customer_workspace_month_requests=100, customer_user_month_requests=100,
    updated_at=now()
WHERE singleton=true AND enabled=false
 AND customer_pilot_enabled=false AND emergency_stop=true;
-- Add Pro entitlement to the EXISTING simplified staging billing row ONLY.
-- Does not charge customers or make guide endpoint available.
UPDATE public.commercial_plan_entitlements e SET enabled=true
 FROM public.commercial_plans p WHERE p.id=e.plan_id
  AND p.code='cartel_49' AND p.version=1 AND p.status='active'
  AND e.feature_key='guide_conversation' AND e.kind='feature'
  AND e.period='none' AND e.enabled=false;
DO $postcheck$
BEGIN
 IF (SELECT count(*) FROM public.cartel_guide_budget_controls
 WHERE singleton=true AND enabled=false AND customer_pilot_enabled=false
   AND emergency_stop=true AND customer_workspace_month_requests=100
   AND customer_user_month_requests=100)<>1
 OR (SELECT count(*) FROM public.commercial_plan_entitlements e
    JOIN public.commercial_plans p ON p.id=e.plan_id WHERE
    p.code='cartel_49' AND p.version=1
    AND e.feature_key='guide_conversation' AND e.enabled=true
    AND e.kind='feature' AND e.period='none')<>1
 OR (SELECT count(*) FROM public.cartel_guide_budget_reservations)<>7
 OR EXISTS (SELECT 1 FROM public.cartel_guide_model_quotes
 WHERE provider='kie.ai') THEN
  RAISE EXCEPTION 'GUIDE_STAGE_POSTCHECK_FAILED'; END IF;
END $postcheck$;
COMMIT;
-- Separate read-only post-commit verification is REQUIRED:
-- confirm emergency_stop=true, enabled=false, pilot=false,
-- workspace_month_requests=100 and Pro entitlement=true;
-- original 7 historical reservations unchanged, fake quote still selected.
-- Edge G2E deploy, Origin selection, live quote and test customer plan assignment
-- are each separate authorizations; this script does NONE of those.
