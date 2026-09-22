-- Phase 2B correction — precise duration resolution.
--
-- The initial Phase 2B migration resolved duration_minutes to NULL for legacy
-- missions whose effective_config never stored one, so LEAST fell back to the
-- 24h absolute cap. That is safe but imprecise. Duration is now resolved as:
--   1. public.social_mission_resolve_config(m.metadata) so a Mission Control
--      MANUAL override duration is visible;
--   2. use its duration_minutes when it is an integer in 1..1440;
--   3. otherwise the preset default via public.social_mission_preset_config on
--      resolved.preset, else metadata.effective_config.preset, else STANDARD
--      (STANDARD 45, QUICK 20, LAUNCH 60, MAJOR_ANNOUNCEMENT 120).
-- NULL is never the normal fallback and the 24h cap is never substituted for a
-- configured duration. The cap itself is unchanged: earliest confirmed
-- sent_at + 24 hours. public.social_mission_effective_config is NOT modified.

CREATE OR REPLACE FUNCTION public.list_active_social_missions_for_metrics(
  _limit integer DEFAULT 100
)
RETURNS TABLE (
  mission_id uuid,
  workspace_id uuid,
  target_id uuid,
  external_post_id text,
  canonical_url text,
  telegram_chat_id bigint,
  telegram_message_id bigint,
  edit_revision integer,
  edit_state text,
  mission_created_by uuid,
  accomplished_at timestamptz,
  last_metric_signature text,
  effective_config jsonb
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT m.id,
         m.workspace_id,
         t.id,
         p.external_post_id,
         p.canonical_url,
         t.telegram_chat_id,
         t.telegram_message_id,
         COALESCE(t.edit_revision, 0)::integer,
         COALESCE(t.edit_state, 'IDLE'),
         m.created_by,
         m.accomplished_at,
         t.last_metric_signature,
         c.cfg
    FROM public.social_missions m
    JOIN public.social_mission_targets t
      ON t.mission_id = m.id AND t.workspace_id = m.workspace_id
    JOIN public.social_posts p
      ON p.id = m.social_post_id
    LEFT JOIN public.social_mission_settings s
      ON s.workspace_id = m.workspace_id
   CROSS JOIN LATERAL (
     SELECT public.social_mission_effective_config(m.id) AS cfg
   ) c
   CROSS JOIN LATERAL (
     SELECT public.social_mission_resolve_config(m.metadata) AS resolved
   ) r
   CROSS JOIN LATERAL (
     SELECT CASE
              WHEN (r.resolved ->> 'duration_minutes') ~ '^[0-9]+$'
                   AND (r.resolved ->> 'duration_minutes')::bigint BETWEEN 1 AND 1440
              THEN GREATEST(1, LEAST(1440, (r.resolved ->> 'duration_minutes')::integer))
              ELSE GREATEST(1, LEAST(1440,
                     (public.social_mission_preset_config(
                        COALESCE(
                          r.resolved ->> 'preset',
                          m.metadata -> 'effective_config' ->> 'preset',
                          'STANDARD'
                        )
                      ) ->> 'duration_minutes')::integer))
            END AS duration_minutes
   ) d
   WHERE m.status = 'LIVE'
     AND m.completed_at IS NULL
     AND t.delivery_state = 'SENT'
     AND t.sent_at IS NOT NULL
     AND t.telegram_message_id IS NOT NULL
     AND p.platform = 'x'
     AND p.external_post_id ~ '^[0-9]{1,32}$'
     AND COALESCE(s.live_metrics_enabled, true) = true
     AND COALESCE((c.cfg ->> 'live_metrics_enabled')::boolean, true) = true
     -- Hard safety window: effective end (mission ends_at, else its configured
     -- end) never beyond an absolute 24h cap from the confirmed delivery.
     AND now() < LEAST(
           COALESCE(
             m.ends_at,
             t.sent_at + make_interval(mins => d.duration_minutes)
           ),
           t.sent_at + interval '24 hours'
         )
   ORDER BY m.started_at NULLS LAST
   LIMIT LEAST(GREATEST(COALESCE(_limit, 100), 1), 500);
$$;

REVOKE ALL ON FUNCTION public.list_active_social_missions_for_metrics(integer)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.list_active_social_missions_for_metrics(integer) TO service_role;
GRANT EXECUTE ON FUNCTION public.list_active_social_missions_for_metrics(integer) TO postgres;

CREATE OR REPLACE FUNCTION public.repair_and_expire_social_missions_for_metrics(
  _limit integer DEFAULT 300
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_limit integer := LEAST(GREATEST(COALESCE(_limit, 300), 1), 500);
  v_now timestamptz := now();
  v_mission record;
  v_target record;
  v_resolved jsonb;
  v_duration integer;
  v_configured_end timestamptz;
  v_absolute_cap timestamptz;
  v_safe_end timestamptz;
  v_examined integer := 0;
  v_ends_repaired integer := 0;
  v_events_ensured integer := 0;
  v_events_pulled_in integer := 0;
  v_expired integer := 0;
  v_pulses_cancelled integer := 0;
  v_rows integer := 0;
BEGIN
  FOR v_mission IN
    SELECT m.id,
           m.workspace_id,
           m.ends_at,
           m.metadata,
           (SELECT min(t.sent_at)
              FROM public.social_mission_targets t
             WHERE t.mission_id = m.id
               AND t.workspace_id = m.workspace_id
               AND t.delivery_state = 'SENT'
               AND t.sent_at IS NOT NULL
               AND t.telegram_message_id IS NOT NULL) AS earliest_sent_at
      FROM public.social_missions m
     WHERE m.status = 'LIVE'
       AND m.completed_at IS NULL
     ORDER BY m.started_at NULLS LAST
     LIMIT v_limit
     FOR UPDATE OF m SKIP LOCKED
  LOOP
    CONTINUE WHEN v_mission.earliest_sent_at IS NULL;
    v_examined := v_examined + 1;

    -- Mission Control override first, then the mission's own duration, then the
    -- preset default. NULL is never the normal outcome.
    v_resolved := public.social_mission_resolve_config(v_mission.metadata);
    v_duration := CASE
                    WHEN (v_resolved ->> 'duration_minutes') ~ '^[0-9]+$'
                         AND (v_resolved ->> 'duration_minutes')::bigint BETWEEN 1 AND 1440
                    THEN GREATEST(1, LEAST(1440, (v_resolved ->> 'duration_minutes')::integer))
                    ELSE GREATEST(1, LEAST(1440,
                           (public.social_mission_preset_config(
                              COALESCE(
                                v_resolved ->> 'preset',
                                v_mission.metadata -> 'effective_config' ->> 'preset',
                                'STANDARD'
                              )
                            ) ->> 'duration_minutes')::integer))
                  END;

    v_absolute_cap := v_mission.earliest_sent_at + interval '24 hours';
    v_configured_end := v_mission.earliest_sent_at + make_interval(mins => v_duration);
    v_safe_end := LEAST(COALESCE(v_mission.ends_at, v_configured_end), v_absolute_cap);

    -- REPAIR: a missing or absurd end is pulled back to the safe end.
    IF v_mission.ends_at IS NULL OR v_mission.ends_at > v_absolute_cap THEN
      UPDATE public.social_missions
         SET ends_at = v_safe_end,
             updated_at = now()
       WHERE id = v_mission.id
         AND status = 'LIVE'
         AND (ends_at IS NULL OR ends_at > v_absolute_cap);
      GET DIAGNOSTICS v_rows = ROW_COUNT;
      v_ends_repaired := v_ends_repaired + v_rows;
    END IF;

    -- Exactly one COMPLETE event per confirmed SENT target, sequence 1.
    -- Terminal and CLAIMED states are never touched, and no PULSE event is
    -- ever synthesised after the fact.
    FOR v_target IN
      SELECT t.id
        FROM public.social_mission_targets t
       WHERE t.mission_id = v_mission.id
         AND t.workspace_id = v_mission.workspace_id
         AND t.delivery_state = 'SENT'
         AND t.sent_at IS NOT NULL
         AND t.telegram_message_id IS NOT NULL
    LOOP
      INSERT INTO public.social_mission_schedule_events (
        workspace_id, mission_id, target_id, event_type, sequence_no, due_at, state
      )
      VALUES (
        v_mission.workspace_id, v_mission.id, v_target.id, 'COMPLETE', 1::smallint,
        v_safe_end, 'PENDING'
      )
      ON CONFLICT (target_id, event_type, sequence_no) DO NOTHING;
      GET DIAGNOSTICS v_rows = ROW_COUNT;
      v_events_ensured := v_events_ensured + v_rows;

      UPDATE public.social_mission_schedule_events e
         SET due_at = LEAST(e.due_at, CASE WHEN v_safe_end <= v_now THEN v_now ELSE v_safe_end END),
             updated_at = now()
       WHERE e.target_id = v_target.id
         AND e.event_type = 'COMPLETE'
         AND e.sequence_no = 1
         AND e.state = 'PENDING'
         AND e.due_at > LEAST(e.due_at, CASE WHEN v_safe_end <= v_now THEN v_now ELSE v_safe_end END);
      GET DIAGNOSTICS v_rows = ROW_COUNT;
      v_events_pulled_in := v_events_pulled_in + v_rows;
    END LOOP;

    -- EXPIRE: only the existing COMPLETED status is ever used.
    IF v_safe_end <= v_now THEN
      UPDATE public.social_missions m
         SET status = 'COMPLETED',
             completed_at = COALESCE(m.completed_at, v_now),
             ends_at = v_safe_end,
             metadata = COALESCE(m.metadata, '{}'::jsonb)
                        || jsonb_build_object(
                             'safety_expiry',
                             jsonb_build_object(
                               'reason', 'runaway_polling_safety',
                               'version', 'PHASE-2B',
                               'expired_at', v_now
                             )
                           ),
             updated_at = now()
       WHERE m.id = v_mission.id
         AND m.status = 'LIVE';
      GET DIAGNOSTICS v_rows = ROW_COUNT;
      v_expired := v_expired + v_rows;

      IF v_rows = 1 THEN
        UPDATE public.social_mission_schedule_events e
           SET state = 'CANCELLED',
               finished_at = v_now,
               updated_at = now()
         WHERE e.mission_id = v_mission.id
           AND e.event_type = 'PULSE'
           AND e.state = 'PENDING';
        GET DIAGNOSTICS v_rows = ROW_COUNT;
        v_pulses_cancelled := v_pulses_cancelled + v_rows;
      END IF;
    END IF;
  END LOOP;

  RETURN jsonb_build_object(
    'outcome', 'ok',
    'examined', v_examined,
    'ends_repaired', v_ends_repaired,
    'complete_events_created', v_events_ensured,
    'complete_events_pulled_in', v_events_pulled_in,
    'missions_expired', v_expired,
    'pending_pulses_cancelled', v_pulses_cancelled
  );
END;
$$;

REVOKE ALL ON FUNCTION public.repair_and_expire_social_missions_for_metrics(integer)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.repair_and_expire_social_missions_for_metrics(integer) TO service_role;
GRANT EXECUTE ON FUNCTION public.repair_and_expire_social_missions_for_metrics(integer) TO postgres;