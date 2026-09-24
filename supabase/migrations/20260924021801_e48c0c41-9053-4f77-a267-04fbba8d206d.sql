-- Stripe lifecycle + Free/Pro foundation (additive)

-- A) Plans / entitlements
INSERT INTO public.commercial_plans (code, version, name, status, price_cents, currency, billing_interval)
VALUES ('cartel_free', 1, 'Cartel HQ Free', 'active', 0, 'USD', 'none')
ON CONFLICT (code, version) DO NOTHING;

INSERT INTO public.commercial_plan_entitlements (plan_id, feature_key, kind, enabled, limit_value, period)
SELECT p.id, v.feature_key, v.kind, true, v.limit_value, v.period
FROM public.commercial_plans p
CROSS JOIN (VALUES
  ('public_project_profile', 'feature', NULL::integer, 'none'),
  ('community_basic', 'feature', NULL::integer, 'none'),
  ('telegram_groups', 'quota', 1, 'none')
) AS v(feature_key, kind, limit_value, period)
WHERE p.code = 'cartel_free' AND p.version = 1
ON CONFLICT (plan_id, feature_key) DO NOTHING;

INSERT INTO public.commercial_plan_entitlements (plan_id, feature_key, kind, enabled, limit_value, period)
SELECT p.id, v.feature_key, v.kind, true, NULL::integer, 'none'
FROM public.commercial_plans p
CROSS JOIN (VALUES ('community_basic', 'feature'), ('telegram_groups', 'quota')) AS v(feature_key, kind)
WHERE p.code = 'cartel_49' AND p.version = 1
ON CONFLICT (plan_id, feature_key) DO NOTHING;

-- B) Service-only billing tables
CREATE TABLE public.commercial_plan_provider_refs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  plan_id uuid NOT NULL REFERENCES public.commercial_plans(id) ON DELETE RESTRICT,
  provider text NOT NULL DEFAULT 'stripe' CHECK (provider = 'stripe'),
  environment text NOT NULL CHECK (environment IN ('test','live')),
  product_ref text NOT NULL,
  price_ref text NOT NULL,
  portal_configuration_ref text,
  active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT commercial_plan_provider_refs_plan_env_uniq UNIQUE (plan_id, provider, environment),
  CONSTRAINT commercial_plan_provider_refs_price_uniq UNIQUE (provider, environment, price_ref)
);
REVOKE ALL ON public.commercial_plan_provider_refs FROM PUBLIC, anon, authenticated;
GRANT ALL ON public.commercial_plan_provider_refs TO service_role;
ALTER TABLE public.commercial_plan_provider_refs ENABLE ROW LEVEL SECURITY;
CREATE TRIGGER commercial_plan_provider_refs_set_updated_at BEFORE UPDATE ON public.commercial_plan_provider_refs
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

CREATE TABLE public.commercial_billing_customers (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  provider text NOT NULL DEFAULT 'stripe' CHECK (provider = 'stripe'),
  environment text NOT NULL CHECK (environment IN ('test','live')),
  billing_owner_user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  customer_ref text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT commercial_billing_customers_owner_uniq UNIQUE (billing_owner_user_id, environment, provider),
  CONSTRAINT commercial_billing_customers_ref_uniq UNIQUE (customer_ref, environment, provider)
);
REVOKE ALL ON public.commercial_billing_customers FROM PUBLIC, anon, authenticated;
GRANT ALL ON public.commercial_billing_customers TO service_role;
ALTER TABLE public.commercial_billing_customers ENABLE ROW LEVEL SECURITY;
CREATE TRIGGER commercial_billing_customers_set_updated_at BEFORE UPDATE ON public.commercial_billing_customers
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

CREATE TABLE public.commercial_billing_subscriptions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
  billing_owner_user_id uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  provider text NOT NULL DEFAULT 'stripe' CHECK (provider = 'stripe'),
  environment text NOT NULL CHECK (environment IN ('test','live')),
  customer_ref text NOT NULL,
  subscription_ref text NOT NULL,
  price_ref text NOT NULL,
  plan_id uuid NOT NULL REFERENCES public.commercial_plans(id) ON DELETE RESTRICT,
  stripe_status text NOT NULL,
  cancel_at_period_end boolean NOT NULL DEFAULT false,
  current_period_start timestamptz,
  current_period_end timestamptz,
  last_payment_failed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT commercial_billing_subscriptions_ref_uniq UNIQUE (provider, environment, subscription_ref)
);
CREATE INDEX commercial_billing_subscriptions_workspace_env_idx ON public.commercial_billing_subscriptions (workspace_id, environment);
CREATE INDEX commercial_billing_subscriptions_owner_idx ON public.commercial_billing_subscriptions (billing_owner_user_id);
REVOKE ALL ON public.commercial_billing_subscriptions FROM PUBLIC, anon, authenticated;
GRANT ALL ON public.commercial_billing_subscriptions TO service_role;
ALTER TABLE public.commercial_billing_subscriptions ENABLE ROW LEVEL SECURITY;
CREATE TRIGGER commercial_billing_subscriptions_set_updated_at BEFORE UPDATE ON public.commercial_billing_subscriptions
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

CREATE TABLE public.commercial_billing_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  provider text NOT NULL DEFAULT 'stripe' CHECK (provider = 'stripe'),
  environment text NOT NULL CHECK (environment IN ('test','live')),
  event_ref text NOT NULL,
  event_type text NOT NULL,
  livemode boolean NOT NULL,
  object_ref text,
  workspace_id uuid REFERENCES public.workspaces(id) ON DELETE SET NULL,
  subscription_ref text,
  processing_status text NOT NULL DEFAULT 'processing' CHECK (processing_status IN ('processing','processed','failed','ignored')),
  attempt_count integer NOT NULL DEFAULT 1,
  last_error text,
  processed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT commercial_billing_events_ref_uniq UNIQUE (provider, environment, event_ref)
);
REVOKE ALL ON public.commercial_billing_events FROM PUBLIC, anon, authenticated;
GRANT ALL ON public.commercial_billing_events TO service_role;
ALTER TABLE public.commercial_billing_events ENABLE ROW LEVEL SECURITY;
CREATE TRIGGER commercial_billing_events_set_updated_at BEFORE UPDATE ON public.commercial_billing_events
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- C) Usage source: add telegram_groups (current connected groups)
CREATE OR REPLACE FUNCTION public.commercial_feature_usage(_workspace_id uuid, _feature_key text, _period_start timestamp with time zone, _period_end timestamp with time zone)
 RETURNS bigint
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  SELECT CASE _feature_key
    WHEN 'static_ai_generations' THEN (
      SELECT count(*) FROM public.ai_jobs j
      WHERE j.workspace_id = _workspace_id AND j.job_type = 'sticker_generate'
        AND j.created_at >= _period_start AND j.created_at < _period_end)
    WHEN 'motion_ai_generations' THEN (
      SELECT count(*) FROM public.ai_jobs j
      WHERE j.workspace_id = _workspace_id AND j.job_type = 'sticker_motion_generate'
        AND j.created_at >= _period_start AND j.created_at < _period_end)
    WHEN 'x_missions' THEN (
      SELECT count(*) FROM public.social_missions m
      WHERE m.workspace_id = _workspace_id
        AND m.created_at >= _period_start AND m.created_at < _period_end)
    WHEN 'telegram_groups' THEN (
      SELECT count(*) FROM public.telegram_group_connections g
      WHERE g.workspace_id = _workspace_id)
    ELSE 0::bigint
  END;
$function$;

-- D) Evaluator: unrestricted first; no assignment => virtual cartel_free enforce
CREATE OR REPLACE FUNCTION public.evaluate_commercial_access(_workspace_id uuid, _feature_key text, _user_id uuid DEFAULT auth.uid())
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_caller uuid := auth.uid();
  v_effective uuid := COALESCE(_user_id, auth.uid());
  v_assign record;
  v_virtual boolean := false;
  v_ent record;
  v_mode text;
  v_start timestamptz;
  v_end timestamptz;
  v_used bigint;
  v_reason text;
  v_result jsonb := jsonb_build_object(
    'allowed', false, 'reason', NULL, 'mode', NULL, 'would_block', false,
    'plan_code', NULL, 'plan_version', NULL, 'feature_key', _feature_key,
    'kind', NULL, 'enabled', NULL, 'used', NULL, 'limit', NULL, 'period', NULL,
    'period_start', NULL, 'period_end', NULL, 'assignment_status', NULL, 'enforcement_mode', NULL);
BEGIN
  -- 1. context
  IF _workspace_id IS NULL OR v_effective IS NULL OR _feature_key IS NULL OR btrim(_feature_key) = '' THEN
    RETURN v_result || jsonb_build_object('reason', 'INVALID_CONTEXT');
  END IF;
  -- 2. self-only for authenticated callers
  IF v_caller IS NOT NULL AND _user_id IS NOT NULL AND _user_id <> v_caller THEN
    RETURN v_result || jsonb_build_object('reason', 'ACTOR_MISMATCH');
  END IF;
  -- 3. FIRST commercial bypass: platform owner / unrestricted
  IF public.has_platform_unrestricted_access(v_effective) THEN
    RETURN v_result || jsonb_build_object('allowed', true, 'reason', 'UNRESTRICTED', 'mode', 'unrestricted');
  END IF;
  -- 4. membership
  IF NOT public.is_workspace_member(_workspace_id, v_effective) THEN
    RETURN v_result || jsonb_build_object('reason', 'NOT_MEMBER');
  END IF;
  -- 5. current assignment
  SELECT a.status, a.enforcement_mode, a.plan_id, p.code AS plan_code, p.version AS plan_version
    INTO v_assign
  FROM public.workspace_commercial_assignments a
  JOIN public.commercial_plans p ON p.id = a.plan_id
  WHERE a.workspace_id = _workspace_id
    AND a.starts_at <= now()
    AND (a.ends_at IS NULL OR a.ends_at > now())
  ORDER BY a.starts_at DESC
  LIMIT 1;
  -- 6. no assignment => virtual cartel_free v1, active, ENFORCE (never observe-allow)
  IF NOT FOUND THEN
    SELECT 'active'::text AS status, 'enforce'::text AS enforcement_mode, p.id AS plan_id,
           p.code AS plan_code, p.version AS plan_version
      INTO v_assign
    FROM public.commercial_plans p
    WHERE p.code = 'cartel_free' AND p.version = 1 AND p.status = 'active';
    IF NOT FOUND THEN
      RETURN v_result || jsonb_build_object('reason', 'NO_COMMERCIAL_PLAN', 'mode', 'enforce', 'would_block', true);
    END IF;
    v_virtual := true;
  END IF;
  v_mode := v_assign.enforcement_mode;
  v_result := v_result || jsonb_build_object(
    'mode', v_mode, 'plan_code', v_assign.plan_code, 'plan_version', v_assign.plan_version,
    'assignment_status', v_assign.status, 'enforcement_mode', v_mode, 'virtual_assignment', v_virtual);
  -- 7. assignment status
  IF v_assign.status NOT IN ('active','trialing') THEN
    v_reason := 'ASSIGNMENT_' || upper(v_assign.status);
    RETURN v_result || jsonb_build_object('allowed', v_mode = 'observe', 'reason', v_reason, 'would_block', true);
  END IF;
  -- 8. entitlement
  SELECT e.kind, e.enabled, e.limit_value, e.period INTO v_ent
  FROM public.commercial_plan_entitlements e
  WHERE e.plan_id = v_assign.plan_id AND e.feature_key = _feature_key;
  IF NOT FOUND OR v_ent.enabled IS NOT TRUE THEN
    RETURN v_result || jsonb_build_object(
      'allowed', v_mode = 'observe', 'reason', 'FEATURE_NOT_INCLUDED', 'would_block', true,
      'kind', CASE WHEN FOUND THEN v_ent.kind END, 'enabled', false);
  END IF;
  v_result := v_result || jsonb_build_object('kind', v_ent.kind, 'enabled', true, 'limit', v_ent.limit_value, 'period', v_ent.period);
  -- 9. feature
  IF v_ent.kind = 'feature' THEN
    RETURN v_result || jsonb_build_object('allowed', true, 'reason', 'FEATURE_INCLUDED');
  END IF;
  -- 10. quota
  IF v_ent.period = 'calendar_month_utc' THEN
    v_start := date_trunc('month', now() AT TIME ZONE 'UTC') AT TIME ZONE 'UTC';
    v_end := v_start + interval '1 month';
  ELSIF v_ent.period = 'day_utc' THEN
    v_start := date_trunc('day', now() AT TIME ZONE 'UTC') AT TIME ZONE 'UTC';
    v_end := v_start + interval '1 day';
  ELSE
    v_start := '-infinity'::timestamptz;
    v_end := 'infinity'::timestamptz;
  END IF;
  v_used := public.commercial_feature_usage(_workspace_id, _feature_key, v_start, v_end);
  v_result := v_result || jsonb_build_object(
    'used', v_used,
    'period_start', CASE WHEN v_ent.period = 'none' THEN NULL ELSE to_jsonb(v_start) END,
    'period_end', CASE WHEN v_ent.period = 'none' THEN NULL ELSE to_jsonb(v_end) END);
  IF v_ent.limit_value IS NULL OR v_used < v_ent.limit_value THEN
    RETURN v_result || jsonb_build_object('allowed', true, 'reason', 'WITHIN_LIMIT', 'would_block', false);
  END IF;
  RETURN v_result || jsonb_build_object('allowed', v_mode = 'observe', 'reason', 'PLAN_LIMIT_REACHED', 'would_block', true);
END;
$function$;

-- E) Usage RPC: virtual Free for normal no-assignment members; telegram_groups counter
CREATE OR REPLACE FUNCTION public.get_workspace_commercial_usage(_workspace_id uuid, _user_id uuid DEFAULT auth.uid())
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_caller uuid := auth.uid();
  v_effective uuid := COALESCE(_user_id, auth.uid());
  v_unrestricted boolean;
  v_assign record;
  v_has_assign boolean := false;
  v_virtual boolean := false;
  v_plan_id uuid;
  v_start timestamptz := date_trunc('month', now() AT TIME ZONE 'UTC') AT TIME ZONE 'UTC';
  v_end timestamptz;
  v_counters jsonb := '{}'::jsonb;
  v_key text;
  v_limit integer;
  v_free record;
BEGIN
  v_end := v_start + interval '1 month';
  IF _workspace_id IS NULL OR v_effective IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'INVALID_CONTEXT');
  END IF;
  IF v_caller IS NOT NULL AND _user_id IS NOT NULL AND _user_id <> v_caller THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'ACTOR_MISMATCH');
  END IF;
  v_unrestricted := public.has_platform_unrestricted_access(v_effective);
  IF NOT (v_unrestricted OR public.is_workspace_member(_workspace_id, v_effective)) THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'NOT_MEMBER');
  END IF;

  SELECT a.id, a.status, a.enforcement_mode, a.plan_id, a.channel, a.assignment_source,
         a.starts_at, a.ends_at, p.code AS plan_code, p.version AS plan_version, p.name AS plan_name
    INTO v_assign
  FROM public.workspace_commercial_assignments a
  JOIN public.commercial_plans p ON p.id = a.plan_id
  WHERE a.workspace_id = _workspace_id
    AND a.starts_at <= now()
    AND (a.ends_at IS NULL OR a.ends_at > now())
  ORDER BY a.starts_at DESC
  LIMIT 1;
  v_has_assign := FOUND;

  IF v_has_assign THEN
    v_plan_id := v_assign.plan_id;
  ELSIF NOT v_unrestricted THEN
    SELECT p.id, p.code, p.version, p.name INTO v_free
    FROM public.commercial_plans p
    WHERE p.code = 'cartel_free' AND p.version = 1 AND p.status = 'active';
    IF FOUND THEN
      v_virtual := true;
      v_plan_id := v_free.id;
    END IF;
  END IF;

  FOREACH v_key IN ARRAY ARRAY['static_ai_generations','motion_ai_generations','x_missions','telegram_groups'] LOOP
    v_limit := NULL;
    IF v_plan_id IS NOT NULL THEN
      SELECT e.limit_value INTO v_limit FROM public.commercial_plan_entitlements e
      WHERE e.plan_id = v_plan_id AND e.feature_key = v_key AND e.kind = 'quota' AND e.enabled;
      IF NOT FOUND AND NOT v_unrestricted THEN
        v_limit := 0;
      END IF;
    END IF;
    v_counters := v_counters || jsonb_build_object(v_key, jsonb_build_object(
      'used', CASE WHEN v_key = 'telegram_groups'
                THEN public.commercial_feature_usage(_workspace_id, v_key, '-infinity'::timestamptz, 'infinity'::timestamptz)
                ELSE public.commercial_feature_usage(_workspace_id, v_key, v_start, v_end) END,
      'limit', v_limit,
      'period', CASE WHEN v_key = 'telegram_groups' THEN 'none' ELSE 'calendar_month_utc' END));
  END LOOP;

  RETURN jsonb_build_object(
    'ok', true,
    'workspace_id', _workspace_id,
    'unrestricted', v_unrestricted,
    'mode', CASE WHEN v_has_assign THEN v_assign.enforcement_mode WHEN v_virtual THEN 'enforce' ELSE 'observe' END,
    'plan', CASE
      WHEN v_has_assign THEN jsonb_build_object('code', v_assign.plan_code, 'version', v_assign.plan_version, 'name', v_assign.plan_name)
      WHEN v_virtual THEN jsonb_build_object('code', v_free.code, 'version', v_free.version, 'name', v_free.name, 'virtual', true)
    END,
    'assignment', CASE WHEN v_has_assign THEN jsonb_build_object(
      'id', v_assign.id, 'status', v_assign.status, 'enforcement_mode', v_assign.enforcement_mode,
      'channel', v_assign.channel, 'assignment_source', v_assign.assignment_source,
      'starts_at', v_assign.starts_at, 'ends_at', v_assign.ends_at) END,
    'period', 'calendar_month_utc',
    'period_start', v_start,
    'period_end', v_end,
    'counters', v_counters);
END;
$function$;

-- F) New workspaces: owner member + real Free assignment for non-unrestricted owners
CREATE OR REPLACE FUNCTION public.handle_new_workspace()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_free_id uuid;
BEGIN
  INSERT INTO public.workspace_members (workspace_id, user_id, role)
  VALUES (NEW.id, NEW.owner_id, 'owner')
  ON CONFLICT (workspace_id, user_id) DO NOTHING;

  IF NOT public.has_platform_unrestricted_access(NEW.owner_id) THEN
    SELECT p.id INTO v_free_id FROM public.commercial_plans p
    WHERE p.code = 'cartel_free' AND p.version = 1 AND p.status = 'active';
    IF v_free_id IS NOT NULL AND NOT EXISTS (
      SELECT 1 FROM public.workspace_commercial_assignments a
      WHERE a.workspace_id = NEW.id AND (a.ends_at IS NULL OR a.ends_at > now())
    ) THEN
      INSERT INTO public.workspace_commercial_assignments (
        workspace_id, plan_id, status, enforcement_mode, billing_owner_user_id,
        channel, assignment_source, starts_at, assigned_by)
      VALUES (NEW.id, v_free_id, 'active', 'enforce', NEW.owner_id, 'direct', 'internal', now(), NEW.owner_id);
    END IF;
  END IF;
  RETURN NEW;
END;
$function$;

-- One-time backfill: only non-unrestricted workspaces with no open assignment
INSERT INTO public.workspace_commercial_assignments (
  workspace_id, plan_id, status, enforcement_mode, billing_owner_user_id,
  channel, assignment_source, starts_at, assigned_by)
SELECT w.id, p.id, 'active', 'enforce', w.owner_id, 'direct', 'internal', now(), w.owner_id
FROM public.workspaces w
CROSS JOIN public.commercial_plans p
WHERE p.code = 'cartel_free' AND p.version = 1 AND p.status = 'active'
  AND NOT public.has_platform_unrestricted_access(w.owner_id)
  AND NOT EXISTS (
    SELECT 1 FROM public.workspace_commercial_assignments a
    WHERE a.workspace_id = w.id AND (a.ends_at IS NULL OR a.ends_at > now()));

-- G) Downgrade effects: only pause enabled Sticker Drop schedules
CREATE OR REPLACE FUNCTION public.apply_commercial_downgrade_effects(_workspace_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_owner uuid;
  v_paused integer := 0;
BEGIN
  IF auth.uid() IS NOT NULL
     OR (COALESCE(auth.role(), '') <> 'service_role' AND session_user NOT IN ('postgres', 'supabase_admin')) THEN
    RAISE EXCEPTION 'NOT_AUTHORIZED' USING ERRCODE = '42501';
  END IF;
  SELECT w.owner_id INTO v_owner FROM public.workspaces w WHERE w.id = _workspace_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'WORKSPACE_NOT_FOUND' USING ERRCODE = '22023';
  END IF;
  IF public.has_platform_unrestricted_access(v_owner) THEN
    RETURN jsonb_build_object('workspace_id', _workspace_id, 'skipped', 'UNRESTRICTED', 'sticker_drop_schedules_paused', 0);
  END IF;
  UPDATE public.sticker_drop_schedules s
     SET enabled = false, paused_reason = 'plan_downgrade', updated_at = now()
   WHERE s.workspace_id = _workspace_id AND s.enabled = true;
  GET DIAGNOSTICS v_paused = ROW_COUNT;
  -- social_missions and launch notification deliveries are intentionally untouched.
  RETURN jsonb_build_object('workspace_id', _workspace_id, 'skipped', NULL, 'sticker_drop_schedules_paused', v_paused);
END;
$function$;
REVOKE ALL ON FUNCTION public.apply_commercial_downgrade_effects(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.apply_commercial_downgrade_effects(uuid) TO service_role, postgres;

-- H) Apply Stripe subscription state (service-only, transactional)
CREATE OR REPLACE FUNCTION public.apply_stripe_subscription_state(
  _environment text,
  _workspace_id uuid,
  _billing_owner_user_id uuid,
  _customer_ref text,
  _subscription_ref text,
  _price_ref text,
  _stripe_status text,
  _cancel_at_period_end boolean,
  _current_period_start timestamptz,
  _current_period_end timestamptz,
  _payment_failed_at timestamptz,
  _plan_code text,
  _plan_version integer)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_now timestamptz := now();
  v_owner uuid;
  v_ref record;
  v_existing_customer text;
  v_existing_sub record;
  v_status text := lower(COALESCE(_stripe_status, ''));
  v_ignored_stale boolean := false;
  v_active_sub record;
  v_desired_plan record;
  v_desired_external text;
  v_current record;
  v_has_current boolean;
  v_changed boolean := false;
  v_downgrade jsonb := NULL;
BEGIN
  IF auth.uid() IS NOT NULL
     OR (COALESCE(auth.role(), '') <> 'service_role' AND session_user NOT IN ('postgres', 'supabase_admin')) THEN
    RAISE EXCEPTION 'NOT_AUTHORIZED' USING ERRCODE = '42501';
  END IF;
  IF _environment IS NULL OR _environment NOT IN ('test','live') THEN
    RAISE EXCEPTION 'INVALID_ENVIRONMENT' USING ERRCODE = '22023';
  END IF;
  IF v_status NOT IN ('active','trialing','past_due','incomplete','incomplete_expired','unpaid','canceled','paused') THEN
    RAISE EXCEPTION 'INVALID_STRIPE_STATUS' USING ERRCODE = '22023';
  END IF;
  IF COALESCE(btrim(_customer_ref), '') = '' OR COALESCE(btrim(_subscription_ref), '') = '' OR COALESCE(btrim(_price_ref), '') = '' THEN
    RAISE EXCEPTION 'INVALID_PROVIDER_REFS' USING ERRCODE = '22023';
  END IF;
  SELECT w.owner_id INTO v_owner FROM public.workspaces w WHERE w.id = _workspace_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'WORKSPACE_NOT_FOUND' USING ERRCODE = '22023';
  END IF;
  -- Billing owner must be the workspace owner or the current assignment billing owner (reseller-safe). No email authority.
  IF _billing_owner_user_id IS NULL OR NOT (
       public.is_workspace_owner(_workspace_id, _billing_owner_user_id)
       OR EXISTS (SELECT 1 FROM public.workspace_commercial_assignments a
                  WHERE a.workspace_id = _workspace_id AND (a.ends_at IS NULL OR a.ends_at > v_now)
                    AND a.billing_owner_user_id = _billing_owner_user_id)) THEN
    RAISE EXCEPTION 'BILLING_OWNER_MISMATCH' USING ERRCODE = '42501';
  END IF;
  -- Exact active provider price mapping + plan identity
  SELECT r.plan_id, p.code, p.version INTO v_ref
  FROM public.commercial_plan_provider_refs r
  JOIN public.commercial_plans p ON p.id = r.plan_id
  WHERE r.provider = 'stripe' AND r.environment = _environment AND r.price_ref = _price_ref AND r.active;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'PRICE_NOT_MAPPED' USING ERRCODE = '22023';
  END IF;
  IF v_ref.code IS DISTINCT FROM _plan_code OR v_ref.version IS DISTINCT FROM _plan_version THEN
    RAISE EXCEPTION 'PLAN_IDENTITY_MISMATCH' USING ERRCODE = '22023';
  END IF;

  -- Customer: one per billing owner/environment
  INSERT INTO public.commercial_billing_customers (provider, environment, billing_owner_user_id, customer_ref)
  VALUES ('stripe', _environment, _billing_owner_user_id, _customer_ref)
  ON CONFLICT (billing_owner_user_id, environment, provider) DO NOTHING;
  SELECT c.customer_ref INTO v_existing_customer FROM public.commercial_billing_customers c
  WHERE c.provider = 'stripe' AND c.environment = _environment AND c.billing_owner_user_id = _billing_owner_user_id;
  IF v_existing_customer IS DISTINCT FROM _customer_ref THEN
    RAISE EXCEPTION 'CUSTOMER_MISMATCH' USING ERRCODE = '22023';
  END IF;

  -- Subscription upsert
  SELECT s.* INTO v_existing_sub FROM public.commercial_billing_subscriptions s
  WHERE s.provider = 'stripe' AND s.environment = _environment AND s.subscription_ref = _subscription_ref
  FOR UPDATE;
  IF FOUND THEN
    IF v_existing_sub.workspace_id <> _workspace_id THEN
      RAISE EXCEPTION 'SUBSCRIPTION_WORKSPACE_MISMATCH' USING ERRCODE = '22023';
    END IF;
    -- Terminal Stripe subscriptions never revive; ignore stale out-of-order state.
    IF v_existing_sub.stripe_status IN ('canceled','incomplete_expired') AND v_status NOT IN ('canceled','incomplete_expired') THEN
      v_ignored_stale := true;
    ELSE
      UPDATE public.commercial_billing_subscriptions s SET
        billing_owner_user_id = _billing_owner_user_id,
        customer_ref = _customer_ref,
        price_ref = _price_ref,
        plan_id = v_ref.plan_id,
        stripe_status = v_status,
        cancel_at_period_end = COALESCE(_cancel_at_period_end, false),
        current_period_start = _current_period_start,
        current_period_end = _current_period_end,
        last_payment_failed_at = CASE
          WHEN _payment_failed_at IS NOT NULL THEN _payment_failed_at
          WHEN v_status IN ('active','trialing') THEN NULL
          WHEN v_status = 'past_due' THEN COALESCE(s.last_payment_failed_at, v_now)
          ELSE s.last_payment_failed_at END,
        updated_at = v_now
      WHERE s.id = v_existing_sub.id;
    END IF;
  ELSE
    INSERT INTO public.commercial_billing_subscriptions (
      workspace_id, billing_owner_user_id, provider, environment, customer_ref, subscription_ref, price_ref,
      plan_id, stripe_status, cancel_at_period_end, current_period_start, current_period_end, last_payment_failed_at)
    VALUES (
      _workspace_id, _billing_owner_user_id, 'stripe', _environment, _customer_ref, _subscription_ref, _price_ref,
      v_ref.plan_id, v_status, COALESCE(_cancel_at_period_end, false), _current_period_start, _current_period_end,
      CASE WHEN _payment_failed_at IS NOT NULL THEN _payment_failed_at WHEN v_status = 'past_due' THEN v_now END);
  END IF;

  -- Desired plan: any entitling subscription (active/trialing/past_due) for this workspace/env => Pro
  SELECT s.subscription_ref, s.plan_id, s.billing_owner_user_id INTO v_active_sub
  FROM public.commercial_billing_subscriptions s
  WHERE s.workspace_id = _workspace_id AND s.environment = _environment AND s.provider = 'stripe'
    AND s.stripe_status IN ('active','trialing','past_due')
  ORDER BY (s.subscription_ref = _subscription_ref) DESC, s.updated_at DESC
  LIMIT 1;
  IF FOUND THEN
    SELECT p.id, p.code, p.version INTO v_desired_plan FROM public.commercial_plans p WHERE p.id = v_active_sub.plan_id;
    v_desired_external := v_active_sub.subscription_ref;
  ELSE
    SELECT p.id, p.code, p.version INTO v_desired_plan FROM public.commercial_plans p
    WHERE p.code = 'cartel_free' AND p.version = 1 AND p.status = 'active';
    IF NOT FOUND THEN
      RAISE EXCEPTION 'FREE_PLAN_MISSING' USING ERRCODE = '22023';
    END IF;
    v_desired_external := _subscription_ref;
  END IF;

  SELECT a.id, a.plan_id, a.assignment_source, a.external_ref, a.enforcement_mode, a.status, a.starts_at, p.code AS plan_code
    INTO v_current
  FROM public.workspace_commercial_assignments a
  JOIN public.commercial_plans p ON p.id = a.plan_id
  WHERE a.workspace_id = _workspace_id AND (a.ends_at IS NULL OR a.ends_at > v_now)
  ORDER BY a.starts_at DESC LIMIT 1
  FOR UPDATE OF a;
  v_has_current := FOUND;

  IF v_has_current AND v_current.plan_id = v_desired_plan.id AND v_current.assignment_source = 'stripe'
     AND v_current.external_ref IS NOT DISTINCT FROM v_desired_external
     AND v_current.enforcement_mode = 'enforce' AND v_current.status = 'active' THEN
    v_changed := false; -- no churn
  ELSIF v_desired_plan.code = 'cartel_free' AND v_has_current AND v_current.assignment_source <> 'stripe' THEN
    v_changed := false; -- Stripe only revokes what Stripe granted; manual/reseller/internal assignments untouched
  ELSE
    IF v_has_current THEN
      UPDATE public.workspace_commercial_assignments a
         SET status = 'ended', ends_at = GREATEST(a.starts_at, v_now), updated_at = v_now
       WHERE a.id = v_current.id;
    END IF;
    INSERT INTO public.workspace_commercial_assignments (
      workspace_id, plan_id, status, enforcement_mode, billing_owner_user_id, channel,
      assignment_source, external_ref, starts_at, assigned_by)
    VALUES (_workspace_id, v_desired_plan.id, 'active', 'enforce', _billing_owner_user_id, 'direct',
      'stripe', v_desired_external, v_now, NULL);
    v_changed := true;
    IF v_has_current AND v_current.plan_code = 'cartel_49' AND v_desired_plan.code = 'cartel_free' THEN
      v_downgrade := public.apply_commercial_downgrade_effects(_workspace_id);
    END IF;
  END IF;

  RETURN jsonb_build_object(
    'workspace_id', _workspace_id, 'environment', _environment, 'stripe_status', v_status,
    'ignored_stale', v_ignored_stale, 'effective_plan_code', v_desired_plan.code,
    'effective_plan_version', v_desired_plan.version, 'assignment_changed', v_changed,
    'downgrade', v_downgrade);
END;
$function$;
REVOKE ALL ON FUNCTION public.apply_stripe_subscription_state(text, uuid, uuid, text, text, text, text, boolean, timestamptz, timestamptz, timestamptz, text, integer) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.apply_stripe_subscription_state(text, uuid, uuid, text, text, text, text, boolean, timestamptz, timestamptz, timestamptz, text, integer) TO service_role, postgres;

-- I) Sanitized billing status for operators / unrestricted
CREATE OR REPLACE FUNCTION public.get_workspace_billing_status(_workspace_id uuid, _user_id uuid DEFAULT auth.uid())
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_caller uuid := auth.uid();
  v_effective uuid := COALESCE(_user_id, auth.uid());
  v_unrestricted boolean;
  v_is_owner boolean;
  v_usage jsonb;
  v_sub record;
  v_has_sub boolean;
  v_billing_owner uuid;
  v_plan_code text;
BEGIN
  IF _workspace_id IS NULL OR v_effective IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'INVALID_CONTEXT');
  END IF;
  IF v_caller IS NOT NULL AND _user_id IS NOT NULL AND _user_id <> v_caller THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'ACTOR_MISMATCH');
  END IF;
  v_unrestricted := public.has_platform_unrestricted_access(v_effective);
  IF NOT (v_unrestricted OR public.is_workspace_operator(_workspace_id, v_effective)) THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'NOT_AUTHORIZED');
  END IF;
  v_is_owner := public.is_workspace_owner(_workspace_id, v_effective);
  v_usage := public.get_workspace_commercial_usage(_workspace_id, v_effective);
  v_plan_code := v_usage #>> '{plan,code}';

  SELECT a.billing_owner_user_id INTO v_billing_owner
  FROM public.workspace_commercial_assignments a
  WHERE a.workspace_id = _workspace_id AND (a.ends_at IS NULL OR a.ends_at > now())
  ORDER BY a.starts_at DESC LIMIT 1;

  SELECT s.environment, s.stripe_status, s.cancel_at_period_end, s.current_period_end, s.last_payment_failed_at
    INTO v_sub
  FROM public.commercial_billing_subscriptions s
  WHERE s.workspace_id = _workspace_id
  ORDER BY (s.stripe_status IN ('active','trialing','past_due')) DESC, s.updated_at DESC
  LIMIT 1;
  v_has_sub := FOUND;

  RETURN jsonb_build_object(
    'ok', true,
    'workspace_id', _workspace_id,
    'unrestricted', v_unrestricted,
    'plan', v_usage -> 'plan',
    'enforcement_mode', v_usage ->> 'mode',
    'subscription', CASE WHEN v_has_sub THEN jsonb_build_object(
      'status', v_sub.stripe_status,
      'cancel_at_period_end', v_sub.cancel_at_period_end,
      'current_period_end', v_sub.current_period_end,
      'payment_issue', (v_sub.stripe_status IN ('past_due','unpaid') OR (v_sub.last_payment_failed_at IS NOT NULL AND v_sub.stripe_status IN ('active','trialing','past_due'))),
      'environment', v_sub.environment) END,
    'usage', v_usage -> 'counters',
    'period_start', v_usage -> 'period_start',
    'period_end', v_usage -> 'period_end',
    'can_upgrade', (NOT v_unrestricted AND v_is_owner
                    AND COALESCE(v_plan_code, '') <> 'cartel_49'
                    AND NOT (v_has_sub AND v_sub.stripe_status IN ('active','trialing','past_due','incomplete'))),
    'can_manage_billing', (NOT v_unrestricted AND v_has_sub
                    AND (v_is_owner OR v_billing_owner = v_effective)));
END;
$function$;
REVOKE ALL ON FUNCTION public.get_workspace_billing_status(uuid, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_workspace_billing_status(uuid, uuid) TO authenticated, service_role, postgres;