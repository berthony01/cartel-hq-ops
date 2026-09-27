-- COMMERCIAL C3A — get_workspace_commercial_usage: replace unassigned-record v_free
-- STATUS: STAGED FOR REVIEW ONLY. NOT APPLIED.
--
-- Live defect: ERROR 55000 record "v_free" is not assigned yet, reached via
-- get_workspace_billing_status for unrestricted / assigned workspaces, because
-- v_free was only populated in the no-assignment + non-unrestricted branch.
-- Fix: v_free record -> typed scalars (v_free_id, v_free_code, v_free_version,
-- v_free_name). Every other line is copied from the live definition.
-- CREATE OR REPLACE keeps signature, owner (postgres) and grants
-- (authenticated, service_role, postgres; no anon/PUBLIC).

BEGIN;

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
  v_free_id uuid;
  v_free_code text;
  v_free_version integer;
  v_free_name text;
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
    SELECT p.id, p.code, p.version, p.name INTO v_free_id, v_free_code, v_free_version, v_free_name
    FROM public.commercial_plans p
    WHERE p.code = 'cartel_free' AND p.version = 1 AND p.status = 'active';
    IF FOUND THEN
      v_virtual := true;
      v_plan_id := v_free_id;
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
      WHEN v_virtual THEN jsonb_build_object('code', v_free_code, 'version', v_free_version, 'name', v_free_name, 'virtual', true)
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

COMMIT;

-- Rollback: re-run the previous live definition (v_free record) — not recommended,
-- it reintroduces the 55000 defect.
