-- SP-B0 Commercial workspace entitlement core
-- STAGED ONLY. NOT APPLIED. Apply only at checkpoint CP-SPB0-SQL (see docs/SP_B1_PARTNER_INBOX_RUNBOOK.md).
--
-- Extracts steps 5-10 of public.evaluate_commercial_access (live definition verified
-- identical to canonical migration 20260924021801) into ONE internal core:
--   public.commercial_evaluate_workspace_feature(uuid, text, jsonb)
-- evaluate_commercial_access keeps its signature, owner, SECURITY DEFINER, search_path,
-- grants and steps 1-4 (context, actor mismatch, unrestricted owner bypass, membership)
-- and then delegates, so its JSON output is unchanged for every existing caller.
-- No commercial tables or rows are touched. No plans, prices, assignments or usage change.
-- Rollback: re-apply the evaluate_commercial_access body from migration 20260924021801,
-- then REVOKE/DROP the two new internal functions.

BEGIN;

-- 1) Internal workspace entitlement core (service_role / definer-internal only)
CREATE OR REPLACE FUNCTION public.commercial_evaluate_workspace_feature(_workspace_id uuid, _feature_key text, _base jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_assign record;
  v_virtual boolean := false;
  v_ent record;
  v_mode text;
  v_start timestamptz;
  v_end timestamptz;
  v_used bigint;
  v_reason text;
  v_result jsonb := _base;
BEGIN
  -- SP-B0: workspace-level entitlement core. Steps 5-10 moved VERBATIM from
  -- evaluate_commercial_access (canonical migration 20260924021801).
  -- NO actor, NO unrestricted bypass, NO membership authorization here.
  IF _workspace_id IS NULL OR _feature_key IS NULL OR btrim(_feature_key) = '' OR _base IS NULL THEN
    RETURN COALESCE(_base, '{}'::jsonb) || jsonb_build_object('allowed', false, 'reason', 'INVALID_CONTEXT');
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

REVOKE ALL ON FUNCTION public.commercial_evaluate_workspace_feature(uuid, text, jsonb) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.commercial_evaluate_workspace_feature(uuid, text, jsonb) TO service_role;

-- 2) Existing evaluator: steps 1-4 unchanged, 5-10 delegated
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
  -- 5-10. SP-B0: delegated verbatim to the shared workspace entitlement core.
  RETURN public.commercial_evaluate_workspace_feature(_workspace_id, _feature_key, v_result);
END;
$function$;

REVOKE ALL ON FUNCTION public.evaluate_commercial_access(uuid, text, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.evaluate_commercial_access(uuid, text, uuid) TO authenticated, service_role;

-- 3) Internal partner entitlement adapter (used only by SP-B1 partner_inbox_create_reply)
CREATE OR REPLACE FUNCTION public.partner_evaluate_commercial_access(_workspace_id uuid, _feature_key text)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
DECLARE
  v_uid uuid := auth.uid();
  v_base jsonb := jsonb_build_object(
    'allowed', false, 'reason', NULL, 'mode', NULL, 'would_block', false,
    'plan_code', NULL, 'plan_version', NULL, 'feature_key', _feature_key,
    'kind', NULL, 'enabled', NULL, 'used', NULL, 'limit', NULL, 'period', NULL,
    'period_start', NULL, 'period_end', NULL, 'assignment_status', NULL, 'enforcement_mode', NULL);
BEGIN
  -- Internal only (called from partner_inbox_create_reply). Only project_inbox in SP-B1.
  IF _workspace_id IS NULL OR _feature_key IS NULL OR _feature_key <> 'project_inbox' OR v_uid IS NULL THEN
    RETURN jsonb_build_object('allowed', false, 'reason', 'INVALID_CONTEXT', 'feature_key', _feature_key);
  END IF;
  -- Scope FIRST. Deny result exposes no plan internals. No partner unrestricted bypass.
  IF NOT public.partner_has_scope(_workspace_id, 'project_inbox') THEN
    RETURN jsonb_build_object('allowed', false, 'reason', 'NOT_PARTNER_SCOPE', 'feature_key', _feature_key);
  END IF;
  -- The CLIENT project's own plan decides, through the one canonical core.
  RETURN public.commercial_evaluate_workspace_feature(_workspace_id, _feature_key, v_base);
END;
$function$;

REVOKE ALL ON FUNCTION public.partner_evaluate_commercial_access(uuid, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.partner_evaluate_commercial_access(uuid, text) TO service_role;

COMMIT;
