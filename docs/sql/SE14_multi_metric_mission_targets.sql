-- ---------------------------------------------------------------------------
-- SE-14 (Multi-Metric Mission Targets + Overall Momentum) — PREPARED ONLY.
-- NOT APPLIED BY LOVABLE.
--
-- Target project: ocoinbnjgstkmnwwvnhi (external Supabase, sole system of
-- record). Apply AFTER `docs/sql/SE13_social_mission_goal_experience.sql`.
--
-- WHAT THIS DOES
--   1. `social_mission_support_target(bigint, bigint)` — PURE, IMMUTABLE,
--      deterministic supporting-target rounding.
--   2. `social_mission_metric_targets(...)` — PURE, IMMUTABLE. Builds the
--      five-metric target object from the FIRST official snapshot. The existing
--      Primary Goal ALWAYS wins for its own metric.
--   3. `record_social_mission_metric_snapshot` — SE-13 behaviour unchanged,
--      plus: establishes `metadata.effective_config.metric_targets` EXACTLY
--      ONCE, from the first DURABLY INSERTED `x-official` snapshot, in the same
--      transaction, AFTER goal resolution and never affecting accomplishment.
--   4. A conservative backfill for LIVE missions only.
--
-- WHAT THIS DOES NOT DO
--   * No new table, no column, no reward/points/badge machinery, no per-member
--     engagement tracking, no second goal system, no second mission engine.
--   * Supporting targets NEVER set `accomplished_at`. Accomplishment remains
--     driven exclusively by the SE-13 Primary Goal.
--   * `TOTAL_INTERACTIONS` stays a valid Primary Goal and never becomes a sixth
--     supporting target. The Primary Goal enum is NOT widened for bookmarks.
--   * No change to `social_mission_effective_config` ACL hardening
--     (service_role + postgres only). No cron, secret or publishing change.
--
-- FORMULA (frozen)
--   views      : the Primary Goal target when the primary type is VIEWS,
--                otherwise `social_mission_auto_goal(views).milestone_target`.
--   likes      : raw = max(baseline + 3, ceil(baseline * 1.50))
--   replies    : raw = max(baseline + 2, ceil(baseline * 1.50))
--   reposts    : raw = max(baseline + 2, ceil(baseline * 1.50))
--   bookmarks  : raw = max(baseline + 1, ceil(baseline * 1.50))
--   step       : 1 (<20), 5 (<100), 10 (<500), else 25
--   target     : ceil(raw / step) * step
--   A NULL baseline yields NO target for that metric. Unknown never becomes 0.
--
-- Re-runnable. Additive. No table is dropped and no data is deleted.
-- ---------------------------------------------------------------------------

BEGIN;

-- ---------------------------------------------------------------------------
-- 1. Supporting-metric target — PURE.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.social_mission_support_target(
  _baseline bigint,
  _floor_add bigint
)
RETURNS bigint
LANGUAGE plpgsql
IMMUTABLE
SET search_path = public
AS $$
DECLARE
  v_step bigint;
  v_raw bigint;
BEGIN
  IF _baseline IS NULL OR _baseline < 0 OR _floor_add IS NULL THEN
    RETURN NULL;
  END IF;

  v_step := CASE
    WHEN _baseline < 20 THEN 1
    WHEN _baseline < 100 THEN 5
    WHEN _baseline < 500 THEN 10
    ELSE 25
  END;

  v_raw := GREATEST(_baseline + _floor_add, ceil(_baseline * 1.50)::bigint);
  RETURN (ceil(v_raw::numeric / v_step)::bigint) * v_step;
END;
$$;

REVOKE ALL ON FUNCTION public.social_mission_support_target(bigint, bigint) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.social_mission_support_target(bigint, bigint) TO service_role, postgres;

-- ---------------------------------------------------------------------------
-- 2. The five-metric target set — PURE.
--
-- An explicit or auto Primary Goal ALWAYS wins for its matching metric, so the
-- scorecard can never contradict the goal the mission launched with.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.social_mission_metric_targets(
  _views bigint,
  _likes bigint,
  _comments bigint,
  _shares bigint,
  _saves bigint,
  _primary_type text,
  _primary_target bigint
)
RETURNS jsonb
LANGUAGE plpgsql
IMMUTABLE
SET search_path = public
AS $$
DECLARE
  v_type text := upper(coalesce(_primary_type, 'NONE'));
  v_pin bigint := CASE WHEN _primary_target IS NOT NULL AND _primary_target > 0 THEN _primary_target END;
  v_out jsonb := '{}'::jsonb;
  v_value bigint;
  v_auto jsonb;
BEGIN
  -- Views: pinned to the Primary Goal, else the SE-13 auto primary target.
  IF v_pin IS NOT NULL AND v_type = 'VIEWS' THEN
    v_value := v_pin;
  ELSE
    v_auto := public.social_mission_auto_goal(_views);
    v_value := NULLIF(v_auto ->> 'milestone_target', '')::bigint;
  END IF;
  IF v_value IS NOT NULL THEN
    v_out := v_out || jsonb_build_object('views', v_value);
  END IF;

  v_value := CASE
    WHEN v_pin IS NOT NULL AND v_type = 'LIKES' THEN v_pin
    ELSE public.social_mission_support_target(_likes, 3)
  END;
  IF v_value IS NOT NULL THEN
    v_out := v_out || jsonb_build_object('likes', v_value);
  END IF;

  v_value := CASE
    WHEN v_pin IS NOT NULL AND v_type = 'REPLIES' THEN v_pin
    ELSE public.social_mission_support_target(_comments, 2)
  END;
  IF v_value IS NOT NULL THEN
    v_out := v_out || jsonb_build_object('replies', v_value);
  END IF;

  v_value := CASE
    WHEN v_pin IS NOT NULL AND v_type = 'REPOSTS' THEN v_pin
    ELSE public.social_mission_support_target(_shares, 2)
  END;
  IF v_value IS NOT NULL THEN
    v_out := v_out || jsonb_build_object('reposts', v_value);
  END IF;

  -- Bookmarks are a SUPPORTING target only; the Primary Goal enum is not
  -- widened, and TOTAL_INTERACTIONS never becomes a sixth metric target.
  v_value := public.social_mission_support_target(_saves, 1);
  IF v_value IS NOT NULL THEN
    v_out := v_out || jsonb_build_object('bookmarks', v_value);
  END IF;

  IF v_out = '{}'::jsonb THEN
    RETURN NULL;
  END IF;
  RETURN v_out;
END;
$$;

REVOKE ALL ON FUNCTION public.social_mission_metric_targets(
  bigint, bigint, bigint, bigint, bigint, text, bigint
) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.social_mission_metric_targets(
  bigint, bigint, bigint, bigint, bigint, text, bigint
) TO service_role, postgres;

-- ---------------------------------------------------------------------------
-- 3. record_social_mission_metric_snapshot — SE-13 behaviour, plus the SE-14
--    target-set establishment step. Everything else (snapshot idempotency,
--    internal provider telemetry, baseline-once, goal establishment and
--    null-honest accomplishment) is preserved exactly.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.record_social_mission_metric_snapshot(
  _mission_id uuid,
  _provider text,
  _observed_at timestamptz,
  _poll_bucket timestamptz,
  _views bigint DEFAULT NULL,
  _likes bigint DEFAULT NULL,
  _comments bigint DEFAULT NULL,
  _shares bigint DEFAULT NULL,
  _saves bigint DEFAULT NULL,
  _availability jsonb DEFAULT '{}'::jsonb,
  _metadata jsonb DEFAULT '{}'::jsonb
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_mission public.social_missions%ROWTYPE;
  v_config jsonb;
  v_type text;
  v_target_value integer;
  v_progress bigint;
  v_rows integer := 0;
  v_snapshot_inserted boolean := false;
  v_baseline_written boolean := false;
  v_accomplished_now boolean := false;
  v_auto_goal jsonb;
  v_goal_source text;
  v_goal_established boolean := false;
  v_metric_targets jsonb;
  v_targets_established boolean := false;
BEGIN
  IF _mission_id IS NULL OR coalesce(btrim(_provider), '') = '' THEN
    RETURN jsonb_build_object('outcome', 'REJECTED', 'reason', 'invalid_arguments');
  END IF;

  SELECT * INTO v_mission FROM public.social_missions WHERE id = _mission_id FOR UPDATE;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('outcome', 'REJECTED', 'reason', 'mission_not_found');
  END IF;

  INSERT INTO public.social_metric_snapshots (
    mission_id, workspace_id, provider, observed_at, poll_bucket,
    views, likes, comments, shares, saves, availability, metadata
  )
  VALUES (
    _mission_id, v_mission.workspace_id, _provider,
    COALESCE(_observed_at, now()), COALESCE(_poll_bucket, date_trunc('minute', now())),
    _views, _likes, _comments, _shares, _saves,
    COALESCE(_availability, '{}'::jsonb), COALESCE(_metadata, '{}'::jsonb)
  )
  ON CONFLICT (mission_id, provider, poll_bucket) DO NOTHING;
  GET DIAGNOSTICS v_rows = ROW_COUNT;
  v_snapshot_inserted := v_rows = 1;

  -- Internal-only telemetry, tied to the durable snapshot idempotency fact.
  IF v_snapshot_inserted AND _provider = 'x-official' THEN
    INSERT INTO public.usage_ledger (workspace_id, user_id, action_type, units)
    VALUES (v_mission.workspace_id, NULL, 'social_x_tracked_post_read', 1);
  END IF;

  -- Baseline is written exactly once, and only into columns still NULL.
  IF v_mission.baseline_views IS NULL
     AND v_mission.baseline_likes IS NULL
     AND v_mission.baseline_comments IS NULL
     AND v_mission.baseline_shares IS NULL
     AND v_mission.baseline_saves IS NULL THEN
    UPDATE public.social_missions
       SET baseline_views = _views,
           baseline_likes = _likes,
           baseline_comments = _comments,
           baseline_shares = _shares,
           baseline_saves = _saves,
           baseline_observed_at = COALESCE(baseline_observed_at, COALESCE(_observed_at, now()))
     WHERE id = _mission_id
       AND baseline_views IS NULL
       AND baseline_likes IS NULL
       AND baseline_comments IS NULL
       AND baseline_shares IS NULL
       AND baseline_saves IS NULL;
    GET DIAGNOSTICS v_rows = ROW_COUNT;
    v_baseline_written := v_rows = 1;
  END IF;

  -- -------------------------------------------------------------------------
  -- SE-13 — establish the MISSION GOAL before accomplishment is evaluated, so
  -- the very first card render after the launch metrics read already shows it.
  -- -------------------------------------------------------------------------
  v_config := public.social_mission_effective_config(_mission_id);
  v_type := upper(coalesce(v_config ->> 'milestone_type', 'NONE'));
  v_target_value := NULLIF(v_config ->> 'milestone_target', '')::integer;
  v_goal_source := NULLIF(v_config ->> 'goal_source', '');

  IF v_type <> 'NONE' AND v_target_value IS NOT NULL AND v_target_value > 0 THEN
    -- EXPLICIT workspace goal ALWAYS wins. Only provenance is stamped, and
    -- only when it is missing; the type and target are never rewritten.
    IF v_goal_source IS NULL THEN
      UPDATE public.social_missions
         SET metadata = jsonb_set(
               COALESCE(metadata, '{}'::jsonb),
               '{effective_config}',
               COALESCE(metadata -> 'effective_config', '{}'::jsonb)
                 || jsonb_build_object('goal_source', 'EXPLICIT'),
               true
             )
       WHERE id = _mission_id
         AND COALESCE(metadata -> 'effective_config' ->> 'goal_source', '') = '';
      v_config := public.social_mission_effective_config(_mission_id);
    END IF;
  ELSIF v_goal_source IS NULL
        AND _provider = 'x-official'
        AND v_snapshot_inserted
        AND _views IS NOT NULL AND _views >= 0 THEN
    -- SE-13.2 — No goal at launch: derive one ONCE from the first DURABLE,
    -- newly inserted OFFICIAL X snapshot with a known nonnegative views value.
    -- A non-official provider, or a duplicate call whose snapshot INSERT lost
    -- the (mission_id, provider, poll_bucket) conflict, can NEVER establish it.
    v_auto_goal := public.social_mission_auto_goal(_views);
    IF v_auto_goal IS NOT NULL THEN
      UPDATE public.social_missions
         SET metadata = jsonb_set(
               COALESCE(metadata, '{}'::jsonb),
               '{effective_config}',
               COALESCE(metadata -> 'effective_config', '{}'::jsonb) || v_auto_goal,
               true
             )
       WHERE id = _mission_id
         -- IDEMPOTENT: only the FIRST valid snapshot can establish the goal.
         AND COALESCE(metadata -> 'effective_config' ->> 'goal_source', '') = ''
         AND upper(COALESCE(metadata -> 'effective_config' ->> 'milestone_type', 'NONE')) = 'NONE';
      GET DIAGNOSTICS v_rows = ROW_COUNT;
      v_goal_established := v_rows = 1;
      IF v_goal_established THEN
        v_config := public.social_mission_effective_config(_mission_id);
        v_type := upper(coalesce(v_config ->> 'milestone_type', 'NONE'));
        v_target_value := NULLIF(v_config ->> 'milestone_target', '')::integer;
      END IF;
    END IF;
  END IF;

  -- -------------------------------------------------------------------------
  -- SE-14 — establish the SUPPORTING METRIC TARGET SET exactly once, from the
  -- first DURABLY INSERTED OFFICIAL X snapshot, using the Primary Goal that has
  -- just been resolved above so the two can never disagree. Informational only:
  -- this block never reads or writes accomplished_at.
  -- -------------------------------------------------------------------------
  IF _provider = 'x-official'
     AND v_snapshot_inserted
     AND v_config -> 'metric_targets' IS NULL THEN
    v_metric_targets := public.social_mission_metric_targets(
      _views, _likes, _comments, _shares, _saves, v_type, v_target_value::bigint
    );
    IF v_metric_targets IS NOT NULL THEN
      UPDATE public.social_missions
         SET metadata = jsonb_set(
               COALESCE(metadata, '{}'::jsonb),
               '{effective_config}',
               COALESCE(metadata -> 'effective_config', '{}'::jsonb)
                 || jsonb_build_object(
                      'metric_targets', v_metric_targets,
                      'metric_targets_source', 'AUTO'
                    ),
               true
             )
       WHERE id = _mission_id
         -- IMMUTABLE: only the FIRST valid snapshot can establish the set. A
         -- duplicate minute, a retry and every later snapshot are no-ops.
         AND metadata -> 'effective_config' -> 'metric_targets' IS NULL;
      GET DIAGNOSTICS v_rows = ROW_COUNT;
      v_targets_established := v_rows = 1;
      IF v_targets_established THEN
        v_config := public.social_mission_effective_config(_mission_id);
      END IF;
    END IF;
  END IF;

  -- Goal accomplishment. Absolute public metrics only; never a per-user
  -- requirement and never a reward. TOTAL_INTERACTIONS excludes views and
  -- bookmarks. Unknown stays unknown: a NULL metric never counts as 0. The
  -- Stretch Goal is display-only and NEVER sets accomplished_at, and so are the
  -- SE-14 supporting targets.
  IF v_mission.accomplished_at IS NULL AND v_type <> 'NONE'
     AND v_target_value IS NOT NULL AND v_target_value > 0 THEN
    v_progress := CASE v_type
      WHEN 'VIEWS' THEN _views
      WHEN 'LIKES' THEN _likes
      WHEN 'REPLIES' THEN _comments
      WHEN 'REPOSTS' THEN _shares
      -- NULL-HONEST: computable ONLY when ALL THREE components are known.
      WHEN 'TOTAL_INTERACTIONS' THEN
        CASE
          WHEN _likes IS NULL OR _comments IS NULL OR _shares IS NULL THEN NULL
          ELSE _likes + _comments + _shares
        END
      ELSE NULL
    END;

    IF v_progress IS NOT NULL AND v_progress >= v_target_value THEN
      UPDATE public.social_missions
         SET accomplished_at = COALESCE(_observed_at, now())
       WHERE id = _mission_id
         AND accomplished_at IS NULL;
      GET DIAGNOSTICS v_rows = ROW_COUNT;
      v_accomplished_now := v_rows = 1;
    END IF;
  END IF;

  RETURN jsonb_build_object(
    'outcome', 'RECORDED',
    'mission_id', _mission_id,
    'workspace_id', v_mission.workspace_id,
    'snapshot_inserted', v_snapshot_inserted,
    'baseline_written', v_baseline_written,
    'goal_established', v_goal_established,
    'goal_source', v_config ->> 'goal_source',
    'milestone_target', v_config ->> 'milestone_target',
    'stretch_goal_target', v_config ->> 'stretch_goal_target',
    'metric_targets_established', v_targets_established,
    'metric_targets', v_config -> 'metric_targets',
    'accomplished_now', v_accomplished_now,
    'accomplished_at', (SELECT accomplished_at FROM public.social_missions WHERE id = _mission_id)
  );
END;
$$;

REVOKE ALL ON FUNCTION public.record_social_mission_metric_snapshot(
  uuid, text, timestamptz, timestamptz, bigint, bigint, bigint, bigint, bigint, jsonb, jsonb
) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.record_social_mission_metric_snapshot(
  uuid, text, timestamptz, timestamptz, bigint, bigint, bigint, bigint, bigint, jsonb, jsonb
) TO service_role;
GRANT EXECUTE ON FUNCTION public.record_social_mission_metric_snapshot(
  uuid, text, timestamptz, timestamptz, bigint, bigint, bigint, bigint, bigint, jsonb, jsonb
) TO postgres;

-- The SE-5 ACL hardening on the config reader is preserved, not widened.
REVOKE ALL ON FUNCTION public.social_mission_effective_config(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.social_mission_effective_config(uuid) TO service_role, postgres;

-- ---------------------------------------------------------------------------
-- 4. Conservative backfill — LIVE missions ONLY, and ONLY where the set is
--    absent. A mission that already carries a target set is never rewritten.
--    COMPLETED / CANCELLED / FAILED missions are deliberately untouched.
-- ---------------------------------------------------------------------------
UPDATE public.social_missions AS sm
   SET metadata = jsonb_set(
         COALESCE(sm.metadata, '{}'::jsonb),
         '{effective_config}',
         COALESCE(sm.metadata -> 'effective_config', '{}'::jsonb)
           || jsonb_build_object(
                'metric_targets', public.social_mission_metric_targets(
                  sm.baseline_views, sm.baseline_likes, sm.baseline_comments,
                  sm.baseline_shares, sm.baseline_saves,
                  upper(COALESCE(sm.metadata -> 'effective_config' ->> 'milestone_type', 'NONE')),
                  NULLIF(sm.metadata -> 'effective_config' ->> 'milestone_target', '')::bigint
                ),
                'metric_targets_source', 'AUTO'
              ),
         true
       )
 WHERE sm.status = 'LIVE'
   AND sm.metadata -> 'effective_config' -> 'metric_targets' IS NULL
   AND public.social_mission_metric_targets(
         sm.baseline_views, sm.baseline_likes, sm.baseline_comments,
         sm.baseline_shares, sm.baseline_saves,
         upper(COALESCE(sm.metadata -> 'effective_config' ->> 'milestone_type', 'NONE')),
         NULLIF(sm.metadata -> 'effective_config' ->> 'milestone_target', '')::bigint
       ) IS NOT NULL;

COMMIT;
