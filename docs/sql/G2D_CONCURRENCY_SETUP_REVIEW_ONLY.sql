-- CARTEL HQ STAGING G2D: COMMITTED SYNTHETIC FIXTURE SETUP - REQUIRES APPROVAL
-- REVIEW ONLY; NOT APPROVED FOR EXECUTION. Project llicojkxpzwylghptmkf only.
-- Other project forbidden. No Kie.ai, AI calls, production, CI or Lovable.
-- PEPE CARTEL / CARTEL HQ — G2D STAGING-ONLY BEHAVIORAL TEST
-- *** REVIEW-ONLY FILE. DO NOT EXECUTE WITHOUT SEPARATE OWNER APPROVAL. ***
-- STAGING project ONLY: llicojkxpzwylghptmkf
-- Never run in production (ocoinbnjgstkmnwwvnhi) or apply as a migration.
-- This tests the *exact corrected PR #11 budget reservation function*;
-- it DOES NOT apply the separate production-shape G2D migration, because
-- the existing isolated staging commercial tables intentionally omit
-- price_cents, currency, billing_interval, customer_visible and metadata.
-- No Kie.ai, AI model, HTTP, wallet, Stripe, Telegram, sticker, or paid calls.
-- A later approved runner must execute this COMPLETE file in ONE session,
-- with transaction/autocommit behavior verified, and inspect its SQL.
-- DO NOT run partial selections; if interrupted or any statement fails,
-- explicitly ROLLBACK in the same session (or close the connection) and
-- verify post-run staging state independently.
-- DDL inside this transaction can briefly lock STAGING public functions/tables;
-- schedule an isolated quiet staging test window before separate execution approval.
-- Only synthetic fixture A/B and already-confirmed staging test users are eligible.
-- This single-session test is SEQUENTIAL, not a concurrency proof.
-- The existing Guide remains HTTP-disabled, and any temporary enabling here
-- is uncommitted and invisible to other sessions; FINAL ROLLBACK IS MANDATORY.
--
-- STRICT ALLOWLIST INSIDE THIS ROLLBACK TEST:
-- public.cartel_guide_budget_controls (column + temporary row updates);
-- public.cartel_guide_reserve_budget(uuid,uuid,uuid) (temporary replacement);
-- public.commercial_plan_entitlements (enable one existing stage Pro fixture);
-- public.workspace_commercial_assignments (temporary fixture-B assignment);
-- public.workspace_members (temporary second member for B);
-- public.cartel_guide_budget_reservations (function-created synthetic holds).
-- No production writes, no persistent schema, no other tables.
BEGIN;
SET LOCAL lock_timeout = '3s';
SET LOCAL statement_timeout = '120s';
SET LOCAL idle_in_transaction_session_timeout = '150s';
SET LOCAL client_min_messages = notice;

-- NOTE: This intentionally FAILS FAST outside this exact known staging fixture.
DO $preflight$
DECLARE
 v_first uuid := '8dceeade-c653-4861-ac82-b265b0cacf0c'::uuid;
 v_second uuid := '9da5e296-dc49-43ce-82d5-200cbd0130c7'::uuid;
 v_b uuid := 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb'::uuid;
 v_a uuid := 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'::uuid;
BEGIN
 IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public'
            AND table_name='commercial_plans' AND column_name='price_cents')
    OR EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public'
            AND table_name='commercial_plan_entitlements' AND column_name='customer_visible')
 THEN RAISE EXCEPTION 'NOT_SIMPLIFIED_CARTEL_HQ_STAGING_SCHEMA'; END IF;
 IF (SELECT COUNT(*) FROM auth.users) <> 2
    OR (SELECT COUNT(*) FROM auth.users
        WHERE id IN (v_first,v_second) AND email_confirmed_at IS NOT NULL) <> 2
    OR EXISTS (SELECT 1 FROM auth.users WHERE id IN (v_first,v_second)
        AND (public.has_platform_unrestricted_access(id) IS TRUE))
 THEN RAISE EXCEPTION 'STAGING_AUTH_FIXTURE_CHANGED'; END IF;
 IF (SELECT COUNT(*) FROM public.workspaces WHERE id IN (v_a,v_b)) <> 2
    OR NOT EXISTS(SELECT 1 FROM public.workspace_members
        WHERE workspace_id=v_b AND user_id=v_first)
    OR EXISTS(SELECT 1 FROM public.workspace_members
        WHERE workspace_id=v_b AND user_id=v_second)
    OR EXISTS(SELECT 1 FROM public.workspace_members
        WHERE workspace_id=v_a AND user_id=v_first)
 THEN RAISE EXCEPTION 'STAGING_WORKSPACE_FIXTURE_CHANGED'; END IF;
 IF EXISTS (SELECT 1 FROM public.workspace_commercial_assignments
            WHERE workspace_id=v_b)
    OR EXISTS (SELECT 1 FROM public.cartel_guide_budget_reservations
            WHERE workspace_id=v_b)
 THEN RAISE EXCEPTION 'STAGING_WORKSPACE_B_NOT_CLEAN'; END IF;
 IF (SELECT count(*) FROM public.cartel_guide_budget_controls
     WHERE singleton=true AND enabled=false AND emergency_stop=true
       AND customer_pilot_enabled=false AND customer_user_month_requests=10
       AND customer_workspace_month_cap_micro_usd=10000
       AND customer_user_month_cap_micro_usd=10000) <> 1
 THEN RAISE EXCEPTION 'GUIDE_NOT_AT_EXPECTED_EMERGENCY_STOP'; END IF;
 IF (SELECT COUNT(*) FROM public.commercial_plans
     WHERE code='cartel_49' AND version=1 AND status='active') <> 1
    OR (SELECT COUNT(*) FROM public.commercial_plan_entitlements e
        JOIN public.commercial_plans p ON p.id=e.plan_id
        WHERE p.code='cartel_49' AND e.feature_key='guide_conversation'
        AND e.enabled=false AND e.kind='feature') <> 1
 THEN RAISE EXCEPTION 'STAGING_PRO_ENTITLEMENT_FIXTURE_CHANGED'; END IF;
 IF (SELECT count(*) FROM public.cartel_guide_budget_controls c
     JOIN public.cartel_guide_model_quotes q ON q.id=c.quote_id
     WHERE c.singleton=true AND q.provider='test-provider-never-called'
       AND q.model='offline-test-model' AND q.max_input_tokens=1000
       AND q.max_output_tokens=1000) <> 1
 THEN RAISE EXCEPTION 'FAKE_QUOTE_FIXTURE_CHANGED'; END IF;
 IF EXISTS (SELECT 1 FROM information_schema.columns
    WHERE table_schema='public' AND table_name='cartel_guide_budget_controls'
      AND column_name='customer_workspace_month_requests')
 THEN RAISE EXCEPTION 'G2D_WORKSPACE_QUOTA_ALREADY_INSTALLED'; END IF;
 IF md5(pg_get_functiondef('public.cartel_guide_reserve_budget(uuid,uuid,uuid)'::regprocedure))
      <> 'c4c3d33069006ecd021d49497dadee4d'
 THEN RAISE EXCEPTION 'STAGING_RESERVATION_FUNCTION_CHANGED'; END IF;
 RAISE NOTICE 'Preflight passed: exact staging fixtures, emergency stop, and fake provider quote.';
END;
$preflight$;

-- Uncommitted schema setup, rolled back below; DOES NOT apply the real migration.
ALTER TABLE public.cartel_guide_budget_controls
 ADD COLUMN customer_workspace_month_requests integer
 CHECK (customer_workspace_month_requests > 0);

-- Exact production-candidate FUNCTION BODY from corrected PR #11:
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

-- Confirm temporary function correctly denies everything under original STOP.
DO $disabled$
DECLARE v jsonb;
BEGIN
 SELECT public.cartel_guide_reserve_budget(
   '8dceeade-c653-4861-ac82-b265b0cacf0c'::uuid,
   'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb'::uuid,
   md5('cartel-guide-roll-back-disabled')::uuid) INTO v;
 IF v->>'reason' IS DISTINCT FROM 'GUIDE_DISABLED'
 THEN RAISE EXCEPTION 'DISABLED_GATE_FAILED: %', v->>'reason'; END IF;
 SELECT public.cartel_guide_reserve_budget(
   '8dceeade-c653-4861-ac82-b265b0cacf0c'::uuid,
   'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'::uuid,
   md5('cartel-guide-roll-back-foreign')::uuid) INTO v;
 IF v->>'reason' IS DISTINCT FROM 'FORBIDDEN'
 THEN RAISE EXCEPTION 'FOREIGN_WORKSPACE_NOT_BLOCKED: %', v->>'reason'; END IF;
 RAISE NOTICE 'PASS disabled stop + cross-tenant denial; no reservations.';
END;
$disabled$;

-- ONLY IN THIS UNCOMMITTED TRANSACTION:
-- Fake quote reserves 1,100 micro-USD/request, so 100 ~ 110,000 micro-USD
-- ($0.11 synthetic reserved cost; NEVER a Kie provider charge).
-- Temporarily raise test-only caps so the shared workspace limit is the blocker.
UPDATE public.cartel_guide_budget_controls
SET enabled=true,
    customer_pilot_enabled=true,
    emergency_stop=false,
    customer_workspace_month_requests=100,
    customer_user_month_requests=110,
    customer_workspace_month_cap_micro_usd=500000,
    customer_user_month_cap_micro_usd=500000,
    global_day_cap_micro_usd=1000000,
    global_month_cap_micro_usd=1000000,
    platform_concurrent_reservations=250
WHERE singleton=true AND enabled=false
  AND emergency_stop=true AND customer_pilot_enabled=false;

-- Before provisioning Pro fixture, budget guard must refuse the Free/default.
DO $not_pro$
DECLARE v jsonb;
BEGIN
 SELECT public.cartel_guide_reserve_budget(
   '8dceeade-c653-4861-ac82-b265b0cacf0c'::uuid,
   'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb'::uuid,
   md5('cartel-guide-roll-back-not-entitled')::uuid) INTO v;
 IF v->>'reason' IS DISTINCT FROM 'ENTITLEMENT_NOT_CONFIGURED'
 THEN RAISE EXCEPTION 'DEFAULT_FREE_GUIDE_WAS_NOT_DENIED: %', v->>'reason'; END IF;
 RAISE NOTICE 'PASS no Pro assignment / no Guide entitlement denied.';
END;
$not_pro$;

-- Temporary staging-only Pro assignment and secondary member.
UPDATE public.commercial_plan_entitlements e
SET enabled=true
FROM public.commercial_plans p
WHERE p.id=e.plan_id AND p.code='cartel_49' AND p.version=1
  AND p.status='active' AND e.feature_key='guide_conversation'
  AND e.enabled=false AND e.kind='feature';
INSERT INTO public.workspace_commercial_assignments
(workspace_id,plan_id,status,enforcement_mode,starts_at,ends_at)
SELECT 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb'::uuid,id,'active','enforce',
       now()-interval '1 hour',NULL
FROM public.commercial_plans WHERE code='cartel_49' AND version=1 AND status='active';
INSERT INTO public.workspace_members (workspace_id,user_id)
VALUES ('bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb'::uuid,
        '9da5e296-dc49-43ce-82d5-200cbd0130c7'::uuid);

-- Actual database RPC, real SQL transaction, NO provider/network action.

-- The previous rollback test performed DO $behavior$ now replaced by 99 synthetic holds.
DO $seed$
DECLARE i integer; v jsonb;
BEGIN
 FOR i IN 1..99 LOOP
 SELECT public.cartel_guide_reserve_budget(CASE WHEN i%2=1 THEN '8dceeade-c653-4861-ac82-b265b0cacf0c'::uuid ELSE '9da5e296-dc49-43ce-82d5-200cbd0130c7'::uuid END,
 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb'::uuid,md5('cartel-g2d-concurrency-seed-'||i::text)::uuid) INTO v;
 IF v->>'allowed' IS DISTINCT FROM 'true' THEN RAISE EXCEPTION 'SEED_%_DENIED: %',i,v->>'reason'; END IF;
 END LOOP;
 IF (SELECT count(*) FROM public.cartel_guide_budget_reservations WHERE workspace_id='bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb'::uuid AND state='held' AND owner_quota_exempt=false)<>99 THEN RAISE EXCEPTION 'SEED_NOT_99'; END IF;
END $seed$;
COMMIT;
SELECT 'SETUP_COMMITTED' AS marker,pg_backend_pid() AS connection_id,
 (SELECT count(*) FROM public.cartel_guide_budget_reservations WHERE workspace_id='bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb'::uuid) AS b_count,
 (SELECT enabled AND customer_pilot_enabled AND NOT emergency_stop AND customer_workspace_month_requests=100 FROM public.cartel_guide_budget_controls WHERE singleton=true) AS test_ready;
-- STOP_FIRST must be executed afterward regardless of race outcome.
