-- SP-B6 V1 — Service Partner missions (read + FUTURE defaults only).
-- STAGED ONLY. NOT APPLIED. Apply only under CP-SPB6-SQL.
--
-- Activates the stored partner scope `missions` through exactly two
-- least-privilege wrappers:
--   1) partner_list_mission_state   — safe, read-only mission history/metrics/
--      timeline + current defaults for ONE client workspace.
--   2) partner_save_mission_settings — upserts ONLY that workspace's
--      social_mission_settings row (defaults for FUTURE missions).
--
-- Mission start / close / end / resurface and all Mission Control remain
-- owner-only Telegram flows (deferred to SP-B6.1). Nothing here calls X or
-- Telegram, inserts metric snapshots, writes usage, or consumes x_missions.
--
-- This file adds NO table, NO column, NO constraint, NO RLS policy, NO trigger,
-- NO DML grant and NO change to is_workspace_member / is_workspace_operator /
-- project_identity_ready / partner_has_scope.
--
-- Rollback: DROP the two functions below.

BEGIN;

-- 1) Safe read-only mission state ---------------------------------------------
CREATE OR REPLACE FUNCTION public.partner_list_mission_state(_workspace_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
DECLARE
  v_settings public.social_mission_settings%ROWTYPE;
BEGIN
  IF auth.uid() IS NULL OR _workspace_id IS NULL
     OR NOT public.partner_has_scope(_workspace_id, 'missions') THEN
    RAISE EXCEPTION 'Not authorized' USING ERRCODE = '42501';
  END IF;

  SELECT * INTO v_settings FROM public.social_mission_settings WHERE workspace_id = _workspace_id;

  -- Never returned: telegram_chat_id, telegram_user_id, telegram_message_id,
  -- mission/post/snapshot metadata, availability, created_by, request ids,
  -- last_error text, message snapshots.
  RETURN jsonb_build_object(
    'settings', jsonb_build_object(
      'default_preset', coalesce(v_settings.default_preset, 'STANDARD'),
      'live_metrics_enabled', coalesce(v_settings.live_metrics_enabled, true),
      'link_finder_enabled', coalesce(v_settings.link_finder_enabled, true),
      'delete_command_after_send', coalesce(v_settings.delete_command_after_send, true),
      'auto_pin_mission', coalesce(v_settings.auto_pin_mission, true),
      'milestone_type', coalesce(v_settings.milestone_type, 'NONE'),
      'milestone_target', v_settings.milestone_target,
      'saved', v_settings.workspace_id IS NOT NULL),
    'missions', coalesce((
      SELECT jsonb_agg(row_to_json(x)::jsonb ORDER BY x.created_at DESC)
      FROM (
        SELECT
          m.id,
          m.status,
          p.canonical_url,
          p.author_handle,
          m.created_at,
          m.started_at,
          m.ends_at,
          m.completed_at,
          m.accomplished_at,
          jsonb_build_object(
            'preset', cfg ->> 'preset',
            'duration_minutes', cfg -> 'duration_minutes',
            'milestone_type', coalesce(cfg ->> 'milestone_type', 'NONE'),
            'milestone_target', cfg -> 'milestone_target') AS goal,
          (SELECT jsonb_build_object(
             'views', s.views, 'likes', s.likes, 'replies', s.comments,
             'reposts', s.shares, 'bookmarks', s.saves, 'observed_at', s.observed_at)
             FROM public.social_metric_snapshots s
            WHERE s.mission_id = m.id AND s.workspace_id = _workspace_id
            ORDER BY s.observed_at DESC LIMIT 1) AS latest_metrics,
          coalesce((
            SELECT jsonb_agg(jsonb_build_object(
              'group_connection_id', t.group_connection_id,
              'group_title', g.title,
              'delivery_state', t.delivery_state,
              'sent_at', t.sent_at) ORDER BY t.created_at)
              FROM public.social_mission_targets t
              LEFT JOIN public.telegram_group_connections g
                ON g.id = t.group_connection_id AND g.workspace_id = _workspace_id
             WHERE t.mission_id = m.id AND t.workspace_id = _workspace_id), '[]'::jsonb) AS targets,
          coalesce((
            SELECT jsonb_agg(jsonb_build_object(
              'event_type', e.event_type, 'sequence_no', e.sequence_no, 'state', e.state,
              'due_at', e.due_at, 'finished_at', e.finished_at) ORDER BY e.due_at, e.sequence_no)
              FROM (SELECT * FROM public.social_mission_schedule_events ev
                     WHERE ev.mission_id = m.id AND ev.workspace_id = _workspace_id
                     ORDER BY ev.due_at DESC LIMIT 50) e), '[]'::jsonb) AS timeline
        FROM public.social_missions m
        LEFT JOIN public.social_posts p ON p.id = m.social_post_id AND p.workspace_id = _workspace_id
        CROSS JOIN LATERAL (SELECT public.social_mission_effective_config(m.id) AS cfg) c
        WHERE m.workspace_id = _workspace_id
        ORDER BY m.created_at DESC
        LIMIT 50
      ) x), '[]'::jsonb));
END;
$function$;

-- 2) Save FUTURE mission defaults ---------------------------------------------
CREATE OR REPLACE FUNCTION public.partner_save_mission_settings(_workspace_id uuid, _settings jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
DECLARE
  v_preset text;
  v_type text;
  v_target_raw jsonb;
  v_target integer;
  v_live boolean;
  v_finder boolean;
  v_delete boolean;
  v_pin boolean;
BEGIN
  IF auth.uid() IS NULL OR _workspace_id IS NULL
     OR NOT public.partner_has_scope(_workspace_id, 'missions') THEN
    RAISE EXCEPTION 'Not authorized' USING ERRCODE = '42501';
  END IF;
  IF NOT public.project_identity_ready(_workspace_id) THEN
    RAISE EXCEPTION 'PROJECT_IDENTITY_REQUIRED' USING ERRCODE = 'P0001';
  END IF;
  IF _settings IS NULL OR jsonb_typeof(_settings) <> 'object' THEN
    RAISE EXCEPTION 'INVALID_SETTINGS' USING ERRCODE = '22023';
  END IF;

  -- Mirrors validateMissionSettings + table CHECK constraints exactly.
  v_preset := _settings ->> 'default_preset';
  IF v_preset IS NULL OR v_preset NOT IN ('STANDARD', 'QUICK', 'MAJOR_ANNOUNCEMENT', 'LAUNCH') THEN
    RAISE EXCEPTION 'INVALID_PRESET' USING ERRCODE = '22023';
  END IF;
  v_type := coalesce(_settings ->> 'milestone_type', 'NONE');
  IF v_type NOT IN ('NONE', 'VIEWS', 'LIKES', 'REPLIES', 'REPOSTS', 'TOTAL_INTERACTIONS') THEN
    RAISE EXCEPTION 'INVALID_MILESTONE_TYPE' USING ERRCODE = '22023';
  END IF;
  v_target_raw := _settings -> 'milestone_target';
  IF v_type = 'NONE' THEN
    IF v_target_raw IS NOT NULL AND jsonb_typeof(v_target_raw) <> 'null' THEN
      RAISE EXCEPTION 'INVALID_MILESTONE_TARGET' USING ERRCODE = '22023';
    END IF;
    v_target := NULL;
  ELSE
    IF v_target_raw IS NULL OR jsonb_typeof(v_target_raw) <> 'number'
       OR (v_target_raw #>> '{}') !~ '^[0-9]+$'
       OR length(v_target_raw #>> '{}') > 10
       OR (v_target_raw #>> '{}')::bigint <= 0
       OR (v_target_raw #>> '{}')::bigint > 2147483647 THEN
      RAISE EXCEPTION 'INVALID_MILESTONE_TARGET' USING ERRCODE = '22023';
    END IF;
    v_target := (v_target_raw #>> '{}')::integer;
  END IF;

  FOREACH v_preset IN ARRAY ARRAY['live_metrics_enabled','link_finder_enabled','delete_command_after_send','auto_pin_mission'] LOOP
    IF _settings -> v_preset IS NULL OR jsonb_typeof(_settings -> v_preset) <> 'boolean' THEN
      RAISE EXCEPTION 'INVALID_TOGGLE' USING ERRCODE = '22023';
    END IF;
  END LOOP;
  v_preset := _settings ->> 'default_preset';
  v_live := (_settings ->> 'live_metrics_enabled')::boolean;
  v_finder := (_settings ->> 'link_finder_enabled')::boolean;
  v_delete := (_settings ->> 'delete_command_after_send')::boolean;
  v_pin := (_settings ->> 'auto_pin_mission')::boolean;

  INSERT INTO public.social_mission_settings AS s (
    workspace_id, default_preset, live_metrics_enabled, link_finder_enabled,
    delete_command_after_send, auto_pin_mission, milestone_type, milestone_target)
  VALUES (_workspace_id, v_preset, v_live, v_finder, v_delete, v_pin, v_type, v_target)
  ON CONFLICT (workspace_id) DO UPDATE SET
    default_preset = EXCLUDED.default_preset,
    live_metrics_enabled = EXCLUDED.live_metrics_enabled,
    link_finder_enabled = EXCLUDED.link_finder_enabled,
    delete_command_after_send = EXCLUDED.delete_command_after_send,
    auto_pin_mission = EXCLUDED.auto_pin_mission,
    milestone_type = EXCLUDED.milestone_type,
    milestone_target = EXCLUDED.milestone_target;

  RETURN jsonb_build_object('saved', true, 'settings', jsonb_build_object(
    'default_preset', v_preset, 'live_metrics_enabled', v_live, 'link_finder_enabled', v_finder,
    'delete_command_after_send', v_delete, 'auto_pin_mission', v_pin,
    'milestone_type', v_type, 'milestone_target', v_target));
END;
$function$;

ALTER FUNCTION public.partner_list_mission_state(uuid) OWNER TO postgres;
ALTER FUNCTION public.partner_save_mission_settings(uuid, jsonb) OWNER TO postgres;
REVOKE ALL ON FUNCTION public.partner_list_mission_state(uuid) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.partner_save_mission_settings(uuid, jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.partner_list_mission_state(uuid) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.partner_save_mission_settings(uuid, jsonb) TO authenticated, service_role;

COMMIT;
