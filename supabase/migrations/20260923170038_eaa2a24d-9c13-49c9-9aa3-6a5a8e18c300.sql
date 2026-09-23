-- COMMERCIAL FOUNDATION A — pre-Stripe plan catalog, entitlements, workspace assignment, usage evaluation.
-- Additive only. No product data backfill. No workspace assignment inserted.

CREATE TABLE public.commercial_plans (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  code text NOT NULL,
  version integer NOT NULL CHECK (version > 0),
  name text NOT NULL,
  status text NOT NULL CHECK (status IN ('draft','active','retired')),
  price_cents integer NOT NULL CHECK (price_cents >= 0),
  currency text NOT NULL,
  billing_interval text NOT NULL CHECK (billing_interval IN ('month','year','none')),
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT commercial_plans_code_version_key UNIQUE (code, version)
);
REVOKE ALL ON public.commercial_plans FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.commercial_plans TO authenticated;
GRANT ALL ON public.commercial_plans TO service_role;
ALTER TABLE public.commercial_plans ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Authenticated users can read commercial plans"
  ON public.commercial_plans FOR SELECT TO authenticated USING (true);

CREATE TABLE public.commercial_plan_entitlements (
  plan_id uuid NOT NULL REFERENCES public.commercial_plans(id) ON DELETE RESTRICT,
  feature_key text NOT NULL,
  kind text NOT NULL CHECK (kind IN ('feature','quota')),
  enabled boolean NOT NULL DEFAULT true,
  limit_value integer NULL CHECK (limit_value IS NULL OR limit_value >= 0),
  period text NOT NULL CHECK (period IN ('none','calendar_month_utc','day_utc')),
  customer_visible boolean NOT NULL DEFAULT true,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (plan_id, feature_key)
);
REVOKE ALL ON public.commercial_plan_entitlements FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.commercial_plan_entitlements TO authenticated;
GRANT ALL ON public.commercial_plan_entitlements TO service_role;
ALTER TABLE public.commercial_plan_entitlements ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Authenticated users can read commercial plan entitlements"
  ON public.commercial_plan_entitlements FOR SELECT TO authenticated USING (true);

CREATE TABLE public.workspace_commercial_assignments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
  plan_id uuid NOT NULL REFERENCES public.commercial_plans(id) ON DELETE RESTRICT,
  status text NOT NULL CHECK (status IN ('active','trialing','past_due','suspended','ended')),
  enforcement_mode text NOT NULL DEFAULT 'observe' CHECK (enforcement_mode IN ('observe','enforce')),
  billing_owner_user_id uuid NULL REFERENCES auth.users(id) ON DELETE SET NULL,
  channel text NOT NULL DEFAULT 'direct' CHECK (channel IN ('direct','affiliate','reseller','internal')),
  channel_partner_ref text NULL,
  assignment_source text NOT NULL DEFAULT 'manual' CHECK (assignment_source IN ('manual','stripe','reseller','internal')),
  external_ref text NULL,
  starts_at timestamptz NOT NULL DEFAULT now(),
  ends_at timestamptz NULL,
  assigned_by uuid NULL REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT workspace_commercial_assignments_window_chk CHECK (ends_at IS NULL OR ends_at >= starts_at)
);
CREATE UNIQUE INDEX workspace_commercial_assignments_one_open_uniq
  ON public.workspace_commercial_assignments (workspace_id) WHERE ends_at IS NULL;
REVOKE ALL ON public.workspace_commercial_assignments FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.workspace_commercial_assignments TO authenticated;
GRANT ALL ON public.workspace_commercial_assignments TO service_role;
ALTER TABLE public.workspace_commercial_assignments ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Members and unrestricted users can read workspace commercial assignments"
  ON public.workspace_commercial_assignments FOR SELECT TO authenticated
  USING (public.is_workspace_member(workspace_id, auth.uid()) OR public.has_platform_unrestricted_access(auth.uid()));
CREATE TRIGGER workspace_commercial_assignments_set_updated_at
  BEFORE UPDATE ON public.workspace_commercial_assignments
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- Seed: cartel_49 v1
INSERT INTO public.commercial_plans (code, version, name, status, price_cents, currency, billing_interval)
VALUES ('cartel_49', 1, 'Cartel HQ Pro', 'active', 4900, 'USD', 'month');

INSERT INTO public.commercial_plan_entitlements (plan_id, feature_key, kind, enabled, limit_value, period, customer_visible)
SELECT p.id, e.feature_key, e.kind, true, e.limit_value, e.period, e.customer_visible
FROM public.commercial_plans p
CROSS JOIN (VALUES
  ('static_ai_generations', 'quota',   100,           'calendar_month_utc', true),
  ('motion_ai_generations', 'quota',   10,            'calendar_month_utc', true),
  ('x_missions',            'quota',   100,           'calendar_month_utc', true),
  ('static_ai_tools',       'feature', NULL::integer, 'none',               true),
  ('concept_generation',    'feature', NULL::integer, 'none',               true),
  ('telegram_motion_prep',  'feature', NULL::integer, 'none',               true),
  ('x_reads',               'feature', NULL::integer, 'none',               false),
  ('sticker_drops',         'feature', NULL::integer, 'none',               true),
  ('community_tools',       'feature', NULL::integer, 'none',               true),
  ('sticker_auto_posting',  'feature', NULL::integer, 'none',               true),
  ('launch_watch',          'feature', NULL::integer, 'none',               true),
  ('official_broadcasts',   'feature', NULL::integer, 'none',               true),
  ('project_inbox',         'feature', NULL::integer, 'none',               true),
  ('public_project_profile','feature', NULL::integer, 'none',               true)
) AS e(feature_key, kind, limit_value, period, customer_visible)
WHERE p.code = 'cartel_49' AND p.version = 1;

-- Usage authority: product rows only.
CREATE OR REPLACE FUNCTION public.commercial_feature_usage(
  _workspace_id uuid, _feature_key text, _period_start timestamptz, _period_end timestamptz
) RETURNS bigint
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
AS $$
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
    ELSE 0::bigint
  END;
$$;
REVOKE ALL ON FUNCTION public.commercial_feature_usage(uuid, text, timestamptz, timestamptz) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.commercial_feature_usage(uuid, text, timestamptz, timestamptz) TO service_role, postgres;

-- Central evaluator.
CREATE OR REPLACE FUNCTION public.evaluate_commercial_access(
  _workspace_id uuid, _feature_key text, _user_id uuid DEFAULT auth.uid()
) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_caller uuid := auth.uid();
  v_effective uuid := COALESCE(_user_id, auth.uid());
  v_assign record;
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
  -- 6. no assignment => observe, allowed
  IF NOT FOUND THEN
    RETURN v_result || jsonb_build_object('allowed', true, 'reason', 'NO_PLAN_ASSIGNED', 'mode', 'observe', 'would_block', false);
  END IF;
  v_mode := v_assign.enforcement_mode;
  v_result := v_result || jsonb_build_object(
    'mode', v_mode, 'plan_code', v_assign.plan_code, 'plan_version', v_assign.plan_version,
    'assignment_status', v_assign.status, 'enforcement_mode', v_mode);
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
$$;
REVOKE ALL ON FUNCTION public.evaluate_commercial_access(uuid, text, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.evaluate_commercial_access(uuid, text, uuid) TO authenticated, service_role, postgres;

-- Workspace usage summary.
CREATE OR REPLACE FUNCTION public.get_workspace_commercial_usage(
  _workspace_id uuid, _user_id uuid DEFAULT auth.uid()
) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_caller uuid := auth.uid();
  v_effective uuid := COALESCE(_user_id, auth.uid());
  v_assign record;
  v_has_assign boolean := false;
  v_start timestamptz := date_trunc('month', now() AT TIME ZONE 'UTC') AT TIME ZONE 'UTC';
  v_end timestamptz;
  v_counters jsonb := '{}'::jsonb;
  v_key text;
  v_limit integer;
BEGIN
  v_end := v_start + interval '1 month';
  IF _workspace_id IS NULL OR v_effective IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'INVALID_CONTEXT');
  END IF;
  IF v_caller IS NOT NULL AND _user_id IS NOT NULL AND _user_id <> v_caller THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'ACTOR_MISMATCH');
  END IF;
  IF NOT (public.has_platform_unrestricted_access(v_effective)
          OR public.is_workspace_member(_workspace_id, v_effective)) THEN
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

  FOREACH v_key IN ARRAY ARRAY['static_ai_generations','motion_ai_generations','x_missions'] LOOP
    v_limit := NULL;
    IF v_has_assign THEN
      SELECT e.limit_value INTO v_limit FROM public.commercial_plan_entitlements e
      WHERE e.plan_id = v_assign.plan_id AND e.feature_key = v_key AND e.kind = 'quota' AND e.enabled;
    END IF;
    v_counters := v_counters || jsonb_build_object(v_key, jsonb_build_object(
      'used', public.commercial_feature_usage(_workspace_id, v_key, v_start, v_end),
      'limit', v_limit));
  END LOOP;

  RETURN jsonb_build_object(
    'ok', true,
    'workspace_id', _workspace_id,
    'unrestricted', public.has_platform_unrestricted_access(v_effective),
    'mode', CASE WHEN v_has_assign THEN v_assign.enforcement_mode ELSE 'observe' END,
    'plan', CASE WHEN v_has_assign THEN jsonb_build_object(
      'code', v_assign.plan_code, 'version', v_assign.plan_version, 'name', v_assign.plan_name) END,
    'assignment', CASE WHEN v_has_assign THEN jsonb_build_object(
      'id', v_assign.id, 'status', v_assign.status, 'enforcement_mode', v_assign.enforcement_mode,
      'channel', v_assign.channel, 'assignment_source', v_assign.assignment_source,
      'starts_at', v_assign.starts_at, 'ends_at', v_assign.ends_at) END,
    'period', 'calendar_month_utc',
    'period_start', v_start,
    'period_end', v_end,
    'counters', v_counters);
END;
$$;
REVOKE ALL ON FUNCTION public.get_workspace_commercial_usage(uuid, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_workspace_commercial_usage(uuid, uuid) TO authenticated, service_role, postgres;

-- Owner/service assignment.
CREATE OR REPLACE FUNCTION public.set_workspace_commercial_assignment(
  _workspace_id uuid,
  _plan_code text,
  _plan_version integer,
  _status text DEFAULT 'active',
  _enforcement_mode text DEFAULT 'observe',
  _billing_owner_user_id uuid DEFAULT NULL,
  _channel text DEFAULT 'direct',
  _channel_partner_ref text DEFAULT NULL,
  _assignment_source text DEFAULT 'manual',
  _external_ref text DEFAULT NULL,
  _ends_at timestamptz DEFAULT NULL
) RETURNS jsonb
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_caller uuid := auth.uid();
  v_plan record;
  v_now timestamptz := now();
  v_ended integer := 0;
  v_new_id uuid;
BEGIN
  IF v_caller IS NOT NULL THEN
    IF NOT public.has_platform_unrestricted_access(v_caller) THEN
      RAISE EXCEPTION 'NOT_AUTHORIZED' USING ERRCODE = '42501';
    END IF;
  ELSIF COALESCE(auth.role(), '') <> 'service_role' AND session_user NOT IN ('postgres', 'supabase_admin') THEN
    RAISE EXCEPTION 'NOT_AUTHORIZED' USING ERRCODE = '42501';
  END IF;

  IF _workspace_id IS NULL OR NOT EXISTS (SELECT 1 FROM public.workspaces w WHERE w.id = _workspace_id) THEN
    RAISE EXCEPTION 'WORKSPACE_NOT_FOUND' USING ERRCODE = '22023';
  END IF;
  SELECT p.id, p.code, p.version, p.status INTO v_plan
  FROM public.commercial_plans p WHERE p.code = _plan_code AND p.version = _plan_version;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'PLAN_NOT_FOUND' USING ERRCODE = '22023';
  END IF;
  IF _status IS NULL OR _status NOT IN ('active','trialing','past_due','suspended','ended') THEN
    RAISE EXCEPTION 'INVALID_STATUS' USING ERRCODE = '22023';
  END IF;
  IF _enforcement_mode IS NULL OR _enforcement_mode NOT IN ('observe','enforce') THEN
    RAISE EXCEPTION 'INVALID_ENFORCEMENT_MODE' USING ERRCODE = '22023';
  END IF;
  IF _channel IS NULL OR _channel NOT IN ('direct','affiliate','reseller','internal') THEN
    RAISE EXCEPTION 'INVALID_CHANNEL' USING ERRCODE = '22023';
  END IF;
  IF _assignment_source IS NULL OR _assignment_source NOT IN ('manual','stripe','reseller','internal') THEN
    RAISE EXCEPTION 'INVALID_ASSIGNMENT_SOURCE' USING ERRCODE = '22023';
  END IF;
  IF _ends_at IS NOT NULL AND _ends_at < v_now THEN
    RAISE EXCEPTION 'INVALID_ENDS_AT' USING ERRCODE = '22023';
  END IF;

  -- End every currently open assignment (constraint-safe: ends_at never before starts_at).
  UPDATE public.workspace_commercial_assignments a
     SET status = 'ended',
         ends_at = GREATEST(a.starts_at, LEAST(COALESCE(a.ends_at, v_now), v_now)),
         updated_at = v_now
   WHERE a.workspace_id = _workspace_id
     AND (a.ends_at IS NULL OR a.ends_at > v_now);
  GET DIAGNOSTICS v_ended = ROW_COUNT;

  INSERT INTO public.workspace_commercial_assignments (
    workspace_id, plan_id, status, enforcement_mode, billing_owner_user_id, channel,
    channel_partner_ref, assignment_source, external_ref, starts_at, ends_at, assigned_by)
  VALUES (
    _workspace_id, v_plan.id, _status, _enforcement_mode, _billing_owner_user_id, _channel,
    _channel_partner_ref, _assignment_source, _external_ref, v_now, _ends_at, v_caller)
  RETURNING id INTO v_new_id;

  RETURN jsonb_build_object(
    'assignment_id', v_new_id, 'workspace_id', _workspace_id, 'ended_previous', v_ended,
    'plan_id', v_plan.id, 'plan_code', v_plan.code, 'plan_version', v_plan.version,
    'status', _status, 'enforcement_mode', _enforcement_mode,
    'channel', _channel, 'assignment_source', _assignment_source);
END;
$$;
REVOKE ALL ON FUNCTION public.set_workspace_commercial_assignment(uuid, text, integer, text, text, uuid, text, text, text, text, timestamptz) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.set_workspace_commercial_assignment(uuid, text, integer, text, text, uuid, text, text, text, text, timestamptz) TO authenticated, service_role, postgres;