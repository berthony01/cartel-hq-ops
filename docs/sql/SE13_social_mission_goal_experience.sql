-- ---------------------------------------------------------------------------
-- SE-13 (Social Mission Goal Experience) — PREPARED ONLY. NOT APPLIED BY
-- LOVABLE.
--
-- Target project: ocoinbnjgstkmnwwvnhi (external Supabase, sole system of
-- record). Apply AFTER `docs/sql/SE6_step1_reconciliation.sql`.
--
-- WHAT THIS DOES
--   1. `social_mission_auto_goal(bigint)` — a PURE, IMMUTABLE, deterministic
--      helper that derives an automatic VIEWS goal from the first known views
--      baseline. No table read, no side effect.
--   2. `record_social_mission_metric_snapshot` — unchanged semantics plus, in
--      the SAME transaction and BEFORE accomplishment evaluation:
--        * stamps `goal_source = 'EXPLICIT'` on a mission whose immutable
--          effective_config already carries a valid positive milestone target;
--        * establishes an automatic VIEWS goal EXACTLY ONCE when the mission
--          launched with `milestone_type = 'NONE'` and this snapshot carries a
--          known, non-negative views value.
--
-- WHAT THIS DOES NOT DO
--   * No new table, no goal table, no reward/points/badge machinery, no
--     per-member engagement tracking, no second mission engine.
--   * No schema change: provenance (`goal_source`) and the stretch target
--     (`stretch_goal_target`) ride inside the EXISTING immutable
--     `social_missions.metadata -> 'effective_config'` JSON.
--   * No change to `social_mission_effective_config` ACL hardening
--     (service_role + postgres only). No cron, secret or publishing change.
--
-- IMMUTABILITY / IDEMPOTENCY
--   An explicit workspace milestone ALWAYS wins and is never rewritten. An
--   automatic goal can be established only when no goal exists yet, and the
--   establishing UPDATE is guarded on that same condition, so a retried
--   webhook, a duplicated cron minute and an overlapping manual close can
--   never change an established goal.
--
-- Re-runnable. Additive. No table is dropped and no data is deleted.
-- ---------------------------------------------------------------------------

BEGIN;

-- ---------------------------------------------------------------------------
-- 1. Deterministic automatic goal — PURE.
--
--   baseline    = first known views count (>= 0)
--   rawPrimary  = max(baseline + 25, ceil(baseline * 1.30))
--   step        = 10 (<100), 25 (<500), 50 (<1000), 100 (<5000),
--                 250 (<10000), 500 (<50000), else 1000
--   primary     = ceil(rawPrimary / step) * step
--   stretch     = ceil((primary * 1.50) / step) * step, forced > primary
--
-- Returns NULL for a NULL or negative baseline: unknown stays unknown and is
-- never coerced to 0.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.social_mission_auto_goal(_baseline bigint)
RETURNS jsonb
LANGUAGE plpgsql
IMMUTABLE
SET search_path = public
AS $$
DECLARE
  v_step bigint;
  v_raw bigint;
  v_primary bigint;
  v_stretch bigint;
BEGIN
  IF _baseline IS NULL OR _baseline < 0 THEN
    RETURN NULL;
  END IF;

  v_step := CASE
    WHEN _baseline < 100 THEN 10
    WHEN _baseline < 500 THEN 25
    WHEN _baseline < 1000 THEN 50
    WHEN _baseline < 5000 THEN 100
    WHEN _baseline < 10000 THEN 250
    WHEN _baseline < 50000 THEN 500
    ELSE 1000
  END;

  v_raw := GREATEST(_baseline + 25, ceil(_baseline * 1.30)::bigint);
  v_primary := (ceil(v_raw::numeric / v_step)::bigint) * v_step;
  v_stretch := (ceil((v_primary * 1.50) / v_step)::bigint) * v_step;
  IF v_stretch <= v_primary THEN
    v_stretch := v_primary + v_step;
  END IF;

  RETURN jsonb_build_object(
    'goal_source', 'AUTO',
    'milestone_type', 'VIEWS',
    'milestone_target', v_primary,
    'stretch_goal_target', v_stretch,
    'auto_goal_baseline_views', _baseline,
    'auto_goal_step', v_step
  );
END;
$$;

REVOKE ALL ON FUNCTION public.social_mission_auto_goal(bigint) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.social_mission_auto_goal(bigint) TO service_role, postgres;

-- ---------------------------------------------------------------------------
-- 2. record_social_mission_metric_snapshot — SE-6 behavior, plus the SE-13
--    goal establishment step. Everything else (snapshot idempotency, internal
--    provider telemetry, baseline-once, null-honest accomplishment) is
--    preserved byte-for-byte in intent.
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
  ELSIF v_goal_source IS NULL AND _views IS NOT NULL AND _views >= 0 THEN
    -- No goal at launch: derive one ONCE from the first known views value.
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

  -- Goal accomplishment. Absolute public metrics only; never a per-user
  -- requirement and never a reward. TOTAL_INTERACTIONS excludes views and
  -- bookmarks. Unknown stays unknown: a NULL metric never counts as 0. The
  -- Stretch Goal is display-only and NEVER sets accomplished_at.
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

COMMIT;
