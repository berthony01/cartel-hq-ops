-- CARTEL HQ G2D — APPROVED PRODUCT POLICY, UNAPPLIED DRAFT SQL.
-- Applies ONLY after G2A.2 atomic Guide budget schema exists and is verified.
-- DO NOT apply to production/staging without separate explicit owner release approval.
-- No model, key, billing checkout, Stripe, price, Telegram or PCART transaction changes.
-- This is a second-step follow-on migration: G2A.2 was ALREADY APPLIED to staging.
--
-- Approved product: Free keeps deterministic non-AI Setup Help/docs.
-- Pro ($49/month) is entitled to Guide conversation; 100 reserved Guide
-- questions per workspace in a UTC calendar month, shared across members.
-- This count uses the EXISTING server-only atomic Guide reservation table,
-- not commercial_feature_usage(), which currently returns 0 for new keys.
-- An owner exemption skips customer quota only, NEVER global spend/stop checks.
--
-- Safety: no enabled flags flipped, no model quote selected, no API calls.
BEGIN;

DO $guard$
BEGIN
 IF (SELECT count(*) FROM public.commercial_plans
     WHERE code = 'cartel_49' AND version = 1
       AND status = 'active' AND price_cents = 4900
       AND currency = 'USD' AND billing_interval = 'month') <> 1 THEN
   RAISE EXCEPTION 'GUIDE_PRO_PLAN_MISMATCH';
 END IF;
 IF (SELECT count(*) FROM public.commercial_plans
     WHERE code = 'cartel_free' AND version = 1
       AND status = 'active' AND price_cents = 0) <> 1 THEN
   RAISE EXCEPTION 'GUIDE_FREE_PLAN_MISMATCH';
 END IF;
 IF to_regclass('public.cartel_guide_budget_controls') IS NULL OR
    to_regclass('public.cartel_guide_budget_reservations') IS NULL OR
    to_regprocedure('public.cartel_guide_reserve_budget(uuid,uuid,uuid)') IS NULL THEN
   RAISE EXCEPTION 'GUIDE_ATOMIC_GUARD_NOT_INSTALLED';
 END IF;
 IF EXISTS (SELECT 1 FROM public.cartel_guide_budget_controls
            WHERE enabled IS DISTINCT FROM false
               OR customer_pilot_enabled IS DISTINCT FROM false
               OR emergency_stop IS DISTINCT FROM true) THEN
   RAISE EXCEPTION 'GUIDE_MUST_REMAIN_DISABLED';
 END IF;
 IF EXISTS (SELECT 1 FROM public.commercial_plan_entitlements e
            JOIN public.commercial_plans p ON e.plan_id=p.id
            WHERE p.code='cartel_free' AND e.feature_key='guide_conversation'
              AND e.enabled) THEN
   RAISE EXCEPTION 'GUIDE_FREE_PAID_ENTITLEMENT_MISMATCH';
 END IF;
END;
$guard$;

-- Paid model work stays OFF; only add the workspace request-count cap.
ALTER TABLE public.cartel_guide_budget_controls
  ADD COLUMN IF NOT EXISTS customer_workspace_month_requests integer
    CHECK (customer_workspace_month_requests > 0);

-- Fail closed if the old customer limits are not configured or the new cap
-- was not set. Any live enable/paid pilot is a separate owner approval.
UPDATE public.cartel_guide_budget_controls
SET customer_workspace_month_requests = 100, updated_at = now()
WHERE singleton = true AND enabled = false AND
      customer_pilot_enabled = false AND emergency_stop = true;

DO $guard$
BEGIN
 IF (SELECT count(*) FROM public.cartel_guide_budget_controls
     WHERE singleton=true AND enabled=false AND
       customer_pilot_enabled=false AND emergency_stop=true AND
       customer_workspace_month_requests=100) <> 1 THEN
   RAISE EXCEPTION 'GUIDE_POLICY_CONFIG_NOT_SAFELY_STAGED';
 END IF;
END;
$guard$;

-- Reuse the existing reservation transaction lock, duplicate-request
-- protection, owner bypass and global budget safeguards.
-- Add a workspace-level count of all unresolved (held/in_flight) holds
-- and current UTC month's settled charges. Released-before-dispatch
-- reservations are excluded. This treats ambiguous in-flight calls as spent
-- rather than risk exceeding the monthly allowance.
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

-- Pro feature authorization is separate from the 100-request counter.
-- Quota enforcement lives in the atomic Guide reservation guard above;
-- using kind='quota' without commercial_feature_usage integration
-- would falsely report zero usage and fail to enforce 100.
INSERT INTO public.commercial_plan_entitlements
 (plan_id,feature_key,kind,enabled,limit_value,period,customer_visible,metadata)
SELECT id,'guide_conversation','feature',true,NULL,'none',false,
       '{"guide_limit_note":"100 shared Guide requests per UTC calendar month; enforce in atomic Guide budget guard"}'::jsonb
FROM public.commercial_plans
WHERE code='cartel_49' AND version=1 AND status='active'
  AND price_cents=4900 AND currency='USD' AND billing_interval='month'
ON CONFLICT (plan_id,feature_key) DO NOTHING;

DO $guard$
BEGIN
 IF (SELECT count(*) FROM public.commercial_plan_entitlements e
     JOIN public.commercial_plans p ON p.id=e.plan_id
     WHERE p.code='cartel_49' AND p.version=1
       AND e.feature_key='guide_conversation'
       AND e.enabled=true AND e.kind='feature'
       AND e.period='none' AND e.limit_value IS NULL) <> 1 THEN
   RAISE EXCEPTION 'GUIDE_PRO_ENTITLEMENT_NOT_CONFIGURED';
 END IF;
 IF EXISTS (SELECT 1 FROM public.commercial_plan_entitlements e
     JOIN public.commercial_plans p ON p.id=e.plan_id
     WHERE p.code='cartel_free' AND e.feature_key='guide_conversation'
       AND e.enabled=true) THEN
   RAISE EXCEPTION 'GUIDE_FREE_MUST_NOT_GET_PAID_CHAT';
 END IF;
 IF EXISTS (SELECT 1 FROM public.cartel_guide_budget_controls
     WHERE enabled=true OR customer_pilot_enabled=true OR emergency_stop=false) THEN
   RAISE EXCEPTION 'GUIDE_STAGING_GUARD_CHANGED';
 END IF;
END;
$guard$;

COMMIT;
