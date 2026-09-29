-- SP-B5 V1 — Service Partner sticker tools (Sticker Drops management only).
-- STAGED ONLY. NOT APPLIED. Apply only under CP-SPB5-SQL.
--
-- Activates the stored partner scope `sticker_tools` through three
-- least-privilege wrappers. Schedule writes stay in the EXISTING Edge actions
-- `sticker-drop-config` / save_schedule, set_schedule_enabled, delete_schedule
-- (one validation + write path). The existing trigger
-- validate_sticker_drop_schedule keeps enforcing pack/group/sticker ownership for
-- every writer. The cron worker `sticker-drops` is reused unchanged.
--
-- This file adds NO table, NO column, NO constraint, NO RLS policy, NO trigger,
-- NO storage policy, NO DML grant and NO change to is_workspace_member /
-- is_workspace_operator / can_use_project_tools / project_identity_ready.
-- Paid AI generation, Telegram pack publishing, test sends and the workspace kill
-- switch are NOT reachable through anything in this file.
--
-- Rollback: DROP the three functions below.

BEGIN;

-- 1) Safe pack + sticker list (labels/emoji only) ------------------------------
CREATE OR REPLACE FUNCTION public.partner_list_sticker_drop_packs(_workspace_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
BEGIN
  IF auth.uid() IS NULL OR _workspace_id IS NULL
     OR NOT public.partner_has_scope(_workspace_id, 'sticker_tools') THEN
    RAISE EXCEPTION 'Not authorized' USING ERRCODE = '42501';
  END IF;
  -- Same eligibility as the owner Sticker Drops state: published packs with a
  -- Telegram set, published stickers with a Telegram file. No file id, set name,
  -- storage path, asset id or Telegram owner id is returned.
  RETURN coalesce((
    SELECT jsonb_agg(jsonb_build_object(
      'pack_id', p.id,
      'title', p.title,
      'theme', p.theme,
      'published_at', p.telegram_published_at,
      'sticker_count', (SELECT count(*) FROM public.stickers s
                        WHERE s.pack_id = p.id AND s.status = 'published' AND s.telegram_file_id IS NOT NULL),
      'stickers', coalesce((
        SELECT jsonb_agg(jsonb_build_object(
          'sticker_id', s.id, 'label', s.label, 'emoji_list', s.emoji_list, 'sort_order', s.sort_order)
          ORDER BY s.sort_order, s.id)
        FROM public.stickers s
        WHERE s.pack_id = p.id AND s.status = 'published' AND s.telegram_file_id IS NOT NULL), '[]'::jsonb))
      ORDER BY p.updated_at DESC, p.id)
    FROM public.sticker_packs p
    WHERE p.workspace_id = _workspace_id
      AND p.status = 'published'
      AND p.telegram_set_name IS NOT NULL), '[]'::jsonb);
END;
$function$;

-- 2) Safe schedule/group/history state -----------------------------------------
CREATE OR REPLACE FUNCTION public.partner_list_sticker_drop_state(_workspace_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
BEGIN
  IF auth.uid() IS NULL OR _workspace_id IS NULL
     OR NOT public.partner_has_scope(_workspace_id, 'sticker_tools') THEN
    RAISE EXCEPTION 'Not authorized' USING ERRCODE = '42501';
  END IF;
  -- No telegram_chat_id, username, metadata, telegram_message_id,
  -- telegram_file_id, created_by or storage path.
  RETURN jsonb_build_object(
    'groups', coalesce((
      SELECT jsonb_agg(jsonb_build_object(
        'group_connection_id', g.id,
        'title', g.title,
        'chat_type', g.chat_type,
        'bot_is_admin', g.bot_is_admin,
        'operational', (g.bot_is_admin IS TRUE
           AND coalesce(g.metadata ->> 'last_member_status', '') NOT IN ('left', 'kicked')))
        ORDER BY g.connected_at DESC NULLS LAST, g.id)
      FROM public.telegram_group_connections g
      WHERE g.workspace_id = _workspace_id), '[]'::jsonb),
    'schedules', coalesce((
      SELECT jsonb_agg(jsonb_build_object(
        'id', d.id,
        'group_connection_id', d.group_connection_id,
        'pack_id', d.pack_id,
        'interval_minutes', d.interval_minutes,
        'timezone', d.timezone,
        'active_start', to_char(d.active_start, 'HH24:MI'),
        'active_end', to_char(d.active_end, 'HH24:MI'),
        'daily_cap', d.daily_cap,
        'silent', d.silent,
        'no_immediate_repeat', d.no_immediate_repeat,
        'selected_sticker_ids', to_jsonb(coalesce(d.selected_sticker_ids, '{}'::uuid[])),
        'enabled', d.enabled,
        'paused_reason', d.paused_reason,
        'next_run_at', d.next_run_at,
        'last_run_at', d.last_sent_at)
        ORDER BY d.created_at DESC, d.id)
      FROM public.sticker_drop_schedules d
      WHERE d.workspace_id = _workspace_id), '[]'::jsonb),
    'kill_switch', coalesce((
      SELECT c.kill_switch FROM public.sticker_drop_workspace_controls c
      WHERE c.workspace_id = _workspace_id), false),
    'events', coalesce((
      SELECT jsonb_agg(jsonb_build_object(
        'status', e.status,
        'local_date', e.local_date,
        'created_at', e.created_at,
        'group_title', e.group_title,
        'sticker_label', e.sticker_label,
        'error_message', e.error_message)
        ORDER BY e.created_at DESC)
      FROM (
        SELECT ev.status, ev.local_date, ev.created_at, ev.error_message,
               g.title AS group_title, s.label AS sticker_label
        FROM public.sticker_drop_events ev
        LEFT JOIN public.telegram_group_connections g
          ON g.id = ev.group_connection_id AND g.workspace_id = _workspace_id
        LEFT JOIN public.stickers s ON s.id = ev.sticker_id
        WHERE ev.workspace_id = _workspace_id
        ORDER BY ev.created_at DESC
        LIMIT 50) e), '[]'::jsonb));
END;
$function$;

-- 3) Action authorization (called by sticker-drop-config with the PARTNER's JWT)
-- _enabled carries the requested set_schedule_enabled value so disabling stays
-- ungated exactly like the owner path; it is ignored for other actions.
CREATE OR REPLACE FUNCTION public.partner_authorize_sticker_drop_action(
  _workspace_id uuid,
  _action text,
  _group_connection_id uuid DEFAULT NULL,
  _pack_id uuid DEFAULT NULL,
  _schedule_id uuid DEFAULT NULL,
  _enabled boolean DEFAULT NULL)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
DECLARE
  v_uid uuid := auth.uid();
  v_eval jsonb;
  v_reason text;
  v_base jsonb := jsonb_build_object(
    'allowed', false, 'reason', NULL, 'mode', NULL, 'would_block', false,
    'plan_code', NULL, 'plan_version', NULL, 'feature_key', 'sticker_drops',
    'kind', NULL, 'enabled', NULL, 'used', NULL, 'limit', NULL, 'period', NULL,
    'period_start', NULL, 'period_end', NULL, 'assignment_status', NULL, 'enforcement_mode', NULL);
BEGIN
  -- 1. Scope FIRST.
  IF v_uid IS NULL OR _workspace_id IS NULL
     OR NOT public.partner_has_scope(_workspace_id, 'sticker_tools') THEN
    RAISE EXCEPTION 'Not authorized' USING ERRCODE = '42501';
  END IF;
  -- 2. Exact action allow-list (kill switch, status and everything else denied).
  IF _action IS NULL OR _action NOT IN ('save_schedule', 'set_schedule_enabled', 'delete_schedule') THEN
    RETURN jsonb_build_object('allowed', false, 'code', 'ACTION_NOT_ALLOWED');
  END IF;
  -- 3. Required targets per action.
  IF _action = 'save_schedule' AND (_group_connection_id IS NULL OR _pack_id IS NULL) THEN
    RETURN jsonb_build_object('allowed', false, 'code', 'GROUP_AND_PACK_REQUIRED');
  END IF;
  IF _action IN ('set_schedule_enabled', 'delete_schedule') AND _schedule_id IS NULL THEN
    RETURN jsonb_build_object('allowed', false, 'code', 'SCHEDULE_REQUIRED');
  END IF;
  -- 4. Every supplied target must belong to the client workspace.
  IF _group_connection_id IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM public.telegram_group_connections g
    WHERE g.id = _group_connection_id AND g.workspace_id = _workspace_id) THEN
    RETURN jsonb_build_object('allowed', false, 'code', 'GROUP_NOT_FOUND');
  END IF;
  IF _pack_id IS NOT NULL THEN
    IF NOT EXISTS (SELECT 1 FROM public.sticker_packs p
                   WHERE p.id = _pack_id AND p.workspace_id = _workspace_id) THEN
      RETURN jsonb_build_object('allowed', false, 'code', 'PACK_NOT_FOUND');
    END IF;
    IF NOT EXISTS (SELECT 1 FROM public.sticker_packs p
                   WHERE p.id = _pack_id AND p.workspace_id = _workspace_id
                     AND p.status = 'published' AND p.telegram_set_name IS NOT NULL) THEN
      RETURN jsonb_build_object('allowed', false, 'code', 'PACK_NOT_PUBLISHED');
    END IF;
  END IF;
  IF _schedule_id IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM public.sticker_drop_schedules d
    WHERE d.id = _schedule_id AND d.workspace_id = _workspace_id) THEN
    RETURN jsonb_build_object('allowed', false, 'code', 'SCHEDULE_NOT_FOUND');
  END IF;
  -- 5. Disable and delete are safety stops: ungated, exactly like the owner path.
  IF _action = 'delete_schedule' OR (_action = 'set_schedule_enabled' AND _enabled IS NOT TRUE) THEN
    RETURN jsonb_build_object('allowed', true, 'code', NULL);
  END IF;
  -- 6. Save / enable: client Project Identity through the one shared core.
  IF NOT public.project_identity_ready(_workspace_id) THEN
    RETURN jsonb_build_object('allowed', false, 'code', 'PROJECT_IDENTITY_REQUIRED');
  END IF;
  -- 7. CLIENT workspace sticker_drops entitlement via SP-B0 core. No owner/unrestricted bypass.
  v_eval := public.commercial_evaluate_workspace_feature(_workspace_id, 'sticker_drops', v_base);
  IF v_eval IS NULL OR jsonb_typeof(v_eval -> 'allowed') IS DISTINCT FROM 'boolean' THEN
    RETURN jsonb_build_object('allowed', false, 'code', 'COMMERCIAL_ACCESS_UNAVAILABLE');
  END IF;
  IF (v_eval ->> 'allowed')::boolean THEN
    RETURN jsonb_build_object('allowed', true, 'code', NULL);
  END IF;
  v_reason := coalesce(v_eval ->> 'reason', '');
  RETURN jsonb_build_object('allowed', false, 'code',
    CASE
      WHEN v_reason = 'PLAN_LIMIT_REACHED' THEN 'PLAN_LIMIT_REACHED'
      WHEN v_reason = 'FEATURE_NOT_INCLUDED' THEN 'FEATURE_NOT_INCLUDED'
      WHEN v_reason LIKE 'ASSIGNMENT\_%' THEN 'PLAN_ACCESS_INACTIVE'
      ELSE 'COMMERCIAL_ACCESS_DENIED'
    END);
END;
$function$;

ALTER FUNCTION public.partner_list_sticker_drop_packs(uuid) OWNER TO postgres;
ALTER FUNCTION public.partner_list_sticker_drop_state(uuid) OWNER TO postgres;
ALTER FUNCTION public.partner_authorize_sticker_drop_action(uuid, text, uuid, uuid, uuid, boolean) OWNER TO postgres;

REVOKE ALL ON FUNCTION public.partner_list_sticker_drop_packs(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.partner_list_sticker_drop_packs(uuid) TO authenticated, service_role;
REVOKE ALL ON FUNCTION public.partner_list_sticker_drop_state(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.partner_list_sticker_drop_state(uuid) TO authenticated, service_role;
REVOKE ALL ON FUNCTION public.partner_authorize_sticker_drop_action(uuid, text, uuid, uuid, uuid, boolean) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.partner_authorize_sticker_drop_action(uuid, text, uuid, uuid, uuid, boolean) TO authenticated, service_role;

COMMIT;
