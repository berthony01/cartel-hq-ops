-- CARTEL HQ G2A.2 — ATOMIC GUIDE BUDGET CANDIDATE (REVIEW ONLY; NEVER APPLIED).
-- Must be independently reviewed, sandbox-tested, and approved before migration.
-- External Supabase ocoinbnjgstkmnwwvnhi is the only authoritative backend.
-- No provider/model requests, commercial plan rows or existing RPCs changed.
BEGIN;

CREATE TABLE public.cartel_guide_model_quotes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  provider text NOT NULL CHECK (length(provider) BETWEEN 1 AND 80),
  model text NOT NULL CHECK (length(model) BETWEEN 1 AND 120),
  price_version text NOT NULL CHECK (length(price_version) BETWEEN 1 AND 80),
  max_input_tokens integer NOT NULL CHECK (max_input_tokens BETWEEN 1 AND 16000),
  max_output_tokens integer NOT NULL CHECK (max_output_tokens BETWEEN 1 AND 4096),
  input_micro_usd_per_million numeric(18,4) NOT NULL
    CHECK (input_micro_usd_per_million > 0 AND input_micro_usd_per_million <= 1000000000),
  output_micro_usd_per_million numeric(18,4) NOT NULL
    CHECK (output_micro_usd_per_million > 0 AND output_micro_usd_per_million <= 1000000000),
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (provider, model, price_version)
);
COMMENT ON TABLE public.cartel_guide_model_quotes IS
  'Review-controlled immutable price snapshots. Add new version; never edit or delete a used quote. No seed rows.';

-- Database-enforced price immutability: new prices require a NEW version row.
-- A historical quote cannot be silently repriced, even by an admin script.
CREATE FUNCTION public.cartel_guide_prevent_quote_mutation()
RETURNS trigger LANGUAGE plpgsql SET search_path = pg_catalog, public
AS $function$
BEGIN
  RAISE EXCEPTION 'GUIDE_QUOTE_IMMUTABLE';
END;
$function$;
CREATE TRIGGER cartel_guide_quote_no_edits
BEFORE UPDATE OR DELETE ON public.cartel_guide_model_quotes
FOR EACH ROW EXECUTE FUNCTION public.cartel_guide_prevent_quote_mutation();
REVOKE ALL ON FUNCTION public.cartel_guide_prevent_quote_mutation()
  FROM PUBLIC, anon, authenticated;

CREATE TABLE public.cartel_guide_budget_controls (
  singleton boolean PRIMARY KEY DEFAULT true CHECK (singleton),
  enabled boolean NOT NULL DEFAULT false,
  emergency_stop boolean NOT NULL DEFAULT true,
  customer_pilot_enabled boolean NOT NULL DEFAULT false,
  quote_id uuid REFERENCES public.cartel_guide_model_quotes(id),
  global_day_cap_micro_usd bigint CHECK (global_day_cap_micro_usd > 0),
  global_month_cap_micro_usd bigint CHECK (global_month_cap_micro_usd > 0),
  customer_workspace_month_cap_micro_usd bigint CHECK (customer_workspace_month_cap_micro_usd > 0),
  customer_user_month_cap_micro_usd bigint CHECK (customer_user_month_cap_micro_usd > 0),
  customer_user_month_requests integer CHECK (customer_user_month_requests > 0),
  platform_concurrent_reservations integer CHECK (platform_concurrent_reservations > 0),
  updated_at timestamptz NOT NULL DEFAULT now()
);
-- This is deliberately disabled even if someone applies the migration.
INSERT INTO public.cartel_guide_budget_controls(singleton, enabled, emergency_stop, customer_pilot_enabled)
VALUES (true, false, true, false);

CREATE TABLE public.cartel_guide_budget_reservations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL,
  workspace_id uuid NOT NULL,
  request_id uuid NOT NULL,
  -- Snapshot the server-authoritative owner exemption at reservation time.
  owner_quota_exempt boolean NOT NULL DEFAULT false,
  quote_id uuid NOT NULL REFERENCES public.cartel_guide_model_quotes(id),
  provider text NOT NULL,
  model text NOT NULL,
  price_version text NOT NULL,
  max_input_tokens integer NOT NULL,
  max_output_tokens integer NOT NULL,
  input_micro_usd_per_million numeric(18,4) NOT NULL,
  output_micro_usd_per_million numeric(18,4) NOT NULL,
  reserved_micro_usd bigint NOT NULL CHECK (reserved_micro_usd > 0),
  actual_micro_usd bigint CHECK (actual_micro_usd >= 0),
  actual_input_tokens integer CHECK (actual_input_tokens >= 0),
  actual_output_tokens integer CHECK (actual_output_tokens >= 0),
  state text NOT NULL DEFAULT 'held'
    CHECK (state IN ('held','in_flight','settled','released')),
  reserved_at timestamptz NOT NULL DEFAULT now(),
  started_at timestamptz,
  closed_at timestamptz,
  UNIQUE (user_id, workspace_id, request_id),
  CHECK ((state = 'settled' AND actual_micro_usd IS NOT NULL AND closed_at IS NOT NULL)
      OR (state <> 'settled' AND actual_micro_usd IS NULL)),
  CHECK (state <> 'in_flight' OR started_at IS NOT NULL)
);
CREATE INDEX cartel_guide_budget_window_idx
  ON public.cartel_guide_budget_reservations (reserved_at, state);
CREATE INDEX cartel_guide_budget_workspace_idx
  ON public.cartel_guide_budget_reservations (workspace_id, reserved_at, state);
CREATE INDEX cartel_guide_budget_user_idx
  ON public.cartel_guide_budget_reservations (user_id, reserved_at, state);

-- RLS is defense-in-depth; no direct browser role permissions or policies.
ALTER TABLE public.cartel_guide_model_quotes ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.cartel_guide_budget_controls ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.cartel_guide_budget_reservations ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.cartel_guide_model_quotes FROM PUBLIC, anon, authenticated;
REVOKE ALL ON public.cartel_guide_budget_controls FROM PUBLIC, anon, authenticated;
REVOKE ALL ON public.cartel_guide_budget_reservations FROM PUBLIC, anon, authenticated;

-- One transaction-wide, app-global lock serializes every reservation.
-- This is deliberately low-throughput and easy to audit for a limited pilot.
-- All pending holds count against every relevant limit until explicitly
-- settled/released. NEVER expire an ambiguous/in-flight provider request.
CREATE FUNCTION public.cartel_guide_reserve_budget(
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
       OR v_cfg.customer_user_month_cap_micro_usd IS NULL
       OR v_cfg.customer_user_month_requests IS NULL THEN
      RETURN jsonb_build_object('allowed', false, 'reason', 'CUSTOMER_BUDGET_UNCONFIGURED');
    END IF;

    SELECT COALESCE(SUM(CASE WHEN state IN ('held','in_flight') THEN reserved_micro_usd
       WHEN state = 'settled' THEN actual_micro_usd ELSE 0 END),0)
      INTO v_workspace_month FROM public.cartel_guide_budget_reservations
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

-- Must transition into in_flight BEFORE sending any provider request.
-- Never dispatch the provider call if this denies (including emergency stop).
CREATE FUNCTION public.cartel_guide_mark_in_flight(
  _reservation_id uuid, _user_id uuid
) RETURNS boolean
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public
AS $function$
DECLARE v_enabled boolean; v_stop boolean;
BEGIN
  PERFORM pg_catalog.pg_advisory_xact_lock(4127, 2202);
  SELECT enabled, emergency_stop INTO v_enabled, v_stop
    FROM public.cartel_guide_budget_controls WHERE singleton = true FOR SHARE;
  IF v_enabled IS DISTINCT FROM true OR v_stop IS DISTINCT FROM false THEN
    RETURN false;
  END IF;
  UPDATE public.cartel_guide_budget_reservations
    SET state='in_flight', started_at=now()
    WHERE id=_reservation_id AND user_id=_user_id AND state='held';
  RETURN FOUND;
EXCEPTION WHEN OTHERS THEN
  RETURN false;
END;
$function$;

-- Release is SAFE ONLY when no provider call could have started.
CREATE FUNCTION public.cartel_guide_release_unstarted(
  _reservation_id uuid, _user_id uuid
) RETURNS boolean
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public
AS $function$
BEGIN
  PERFORM pg_catalog.pg_advisory_xact_lock(4127, 2202);
  UPDATE public.cartel_guide_budget_reservations
    SET state='released', closed_at=now()
    WHERE id=_reservation_id AND user_id=_user_id AND state='held';
  RETURN FOUND;
EXCEPTION WHEN OTHERS THEN
  RETURN false;
END;
$function$;

-- Missing provider usage is charged at the FULL reserved amount.
-- A provider overrun triggers the permanent emergency stop until review.
-- The call is idempotent: settlement repeats never debit a second time.
CREATE FUNCTION public.cartel_guide_settle_budget(
  _reservation_id uuid, _user_id uuid,
  _input_tokens integer DEFAULT NULL, _output_tokens integer DEFAULT NULL
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public
AS $function$
DECLARE
  v_row public.cartel_guide_budget_reservations%ROWTYPE;
  v_actual bigint;
  v_overrun boolean;
BEGIN
  PERFORM pg_catalog.pg_advisory_xact_lock(4127, 2202);
  SELECT * INTO v_row FROM public.cartel_guide_budget_reservations
    WHERE id = _reservation_id AND user_id = _user_id FOR UPDATE;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'NOT_FOUND');
  END IF;
  IF v_row.state = 'settled' THEN
    RETURN jsonb_build_object('ok', true, 'replayed', true);
  END IF;
  IF v_row.state <> 'in_flight' THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'INVALID_STATE');
  END IF;
  IF (_input_tokens IS NULL) <> (_output_tokens IS NULL)
     OR _input_tokens < 0 OR _output_tokens < 0 THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'INVALID_USAGE');
  END IF;

  IF _input_tokens IS NULL THEN
    v_actual := v_row.reserved_micro_usd;
    v_overrun := false;
  ELSE
    v_actual := greatest(1, ceil(
      (_input_tokens::numeric * v_row.input_micro_usd_per_million +
       _output_tokens::numeric * v_row.output_micro_usd_per_million) / 1000000
    )::bigint);
    v_overrun := _input_tokens > v_row.max_input_tokens
      OR _output_tokens > v_row.max_output_tokens
      OR v_actual > v_row.reserved_micro_usd;
  END IF;

  UPDATE public.cartel_guide_budget_reservations
    SET state='settled', actual_micro_usd=v_actual,
        actual_input_tokens=_input_tokens, actual_output_tokens=_output_tokens,
        closed_at=now()
    WHERE id=_reservation_id AND user_id=_user_id;
  IF v_overrun THEN
    UPDATE public.cartel_guide_budget_controls
      SET emergency_stop=true, updated_at=now() WHERE singleton=true;
  END IF;
  RETURN jsonb_build_object('ok', true, 'replayed', false,
    'charged_micro_usd', v_actual, 'overrun_stop', v_overrun);
EXCEPTION WHEN OTHERS THEN
  RETURN jsonb_build_object('ok', false, 'reason', 'SETTLEMENT_UNAVAILABLE');
END;
$function$;

-- Security: service role is the ONLY permitted caller of these RPCs.
REVOKE ALL ON FUNCTION public.cartel_guide_reserve_budget(uuid,uuid,uuid)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.cartel_guide_reserve_budget(uuid,uuid,uuid)
  TO service_role;
REVOKE ALL ON FUNCTION public.cartel_guide_mark_in_flight(uuid,uuid)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.cartel_guide_mark_in_flight(uuid,uuid)
  TO service_role;
REVOKE ALL ON FUNCTION public.cartel_guide_release_unstarted(uuid,uuid)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.cartel_guide_release_unstarted(uuid,uuid)
  TO service_role;
REVOKE ALL ON FUNCTION public.cartel_guide_settle_budget(uuid,uuid,integer,integer)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.cartel_guide_settle_budget(uuid,uuid,integer,integer)
  TO service_role;

COMMIT;

-- No ROLLBACK SQL is supplied until a sandbox migration and dependency review.
-- Critical: no TTL reaper, automatic stale-hold release, service-role client
-- writes or provider integration in G2A.2. Ambiguous in-flight holds stay held.
