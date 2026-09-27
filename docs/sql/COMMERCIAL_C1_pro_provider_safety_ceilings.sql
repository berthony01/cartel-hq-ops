-- COMMERCIAL SAFETY C1 — internal provider-spend safety ceilings for cartel_49 v1.
-- STAGED ONLY. Not applied. Additive and reversible (rollback at bottom).
-- Free plan, x_reads, primary quotas, owner bypass (inside evaluate_commercial_access) untouched.
BEGIN;

UPDATE public.commercial_plan_entitlements e
SET kind = 'quota',
    limit_value = v.limit_value,
    period = 'calendar_month_utc',
    customer_visible = false
FROM public.commercial_plans p,
     (VALUES ('concept_generation', 100), ('static_ai_tools', 100), ('telegram_motion_prep', 10))
       AS v(feature_key, limit_value)
WHERE e.plan_id = p.id
  AND p.code = 'cartel_49' AND p.version = 1
  AND e.feature_key = v.feature_key;

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
    WHEN 'concept_generation' THEN (
      SELECT count(*) FROM public.usage_ledger u
      WHERE u.workspace_id = _workspace_id AND u.action_type = 'sticker_concepts_generate'
        AND u.created_at >= _period_start AND u.created_at < _period_end)
    WHEN 'static_ai_tools' THEN (
      SELECT count(*) FROM public.ai_jobs j
      WHERE j.workspace_id = _workspace_id AND j.job_type = 'remove_background'
        AND j.created_at >= _period_start AND j.created_at < _period_end)
    WHEN 'telegram_motion_prep' THEN (
      SELECT count(*) FROM public.ai_jobs j
      WHERE j.workspace_id = _workspace_id AND j.job_type = 'sticker_motion_telegram_prepare'
        AND j.created_at >= _period_start AND j.created_at < _period_end)
    ELSE 0::bigint
  END;
$function$;

COMMIT;

-- ROLLBACK (manual, if ever needed):
-- UPDATE public.commercial_plan_entitlements e SET kind='feature', limit_value=NULL, period='none', customer_visible=true
--   FROM public.commercial_plans p WHERE e.plan_id=p.id AND p.code='cartel_49' AND p.version=1
--   AND e.feature_key IN ('concept_generation','static_ai_tools','telegram_motion_prep');
-- then re-create commercial_feature_usage without the three new WHEN branches.
