-- ===========================================================================
-- SE-6 — CARTEL SOCIAL mission engine reconciliation.
--
-- PREPARED ONLY. Lovable has NOT applied this file. It must be reviewed and
-- applied externally against the authoritative Supabase project
-- `ocoinbnjgstkmnwwvnhi`. It is additive and re-runnable, layered on top of
-- `docs/sql/SE5_social_mission_engine.sql` (apply SE-5 first).
--
-- Covers frozen requirements:
--   2. five-minute centralized refresh, cached snapshots, no viewer reads
--   4. delta pulse defaults +100 views / +10 likes / +5 reposts / +5 replies,
--      crossings only, combined, never repeated
--   5. idempotent milestone events (active, tier 1-10, trending, closing soon,
--      completed)
--   6. admin tier presets, reusable and named, mission code optional
--   7. persisted final mission performance history
--   8. X link availability state; auto-pin defaults OFF
-- ===========================================================================

BEGIN;

-- ---------------------------------------------------------------------------
-- 1. Requirement 8 — auto-pin is OFF by default. Existing rows are untouched
--    only where they still carry the SE-5 default and no mission has pinned.
-- ---------------------------------------------------------------------------
ALTER TABLE public.social_mission_settings
  ALTER COLUMN auto_pin_mission SET DEFAULT false;

-- ---------------------------------------------------------------------------
-- 2. Requirement 6 — reusable named tier presets.
--    `tier_targets` is a 10-element array of
--    {tier, views, likes, shares, comments}; a null entry means "not part of
--    this tier's bundle". `mission_code` is OPTIONAL. Wallet targets are
--    deliberately absent (postponed).
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.social_mission_presets (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
  name text NOT NULL,
  mission_code text,
  base_preset text NOT NULL DEFAULT 'STANDARD',
  tier_targets jsonb NOT NULL DEFAULT '[]'::jsonb,
  pulse_deltas jsonb NOT NULL
    DEFAULT jsonb_build_object('views', 100, 'likes', 10, 'shares', 5, 'comments', 5),
  is_default boolean NOT NULL DEFAULT false,
  created_by uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT social_mission_presets_name_ck CHECK (length(btrim(name)) BETWEEN 1 AND 80),
  CONSTRAINT social_mission_presets_code_ck
    CHECK (mission_code IS NULL OR mission_code ~ '^[A-Za-z0-9_-]{1,32}$'),
  CONSTRAINT social_mission_presets_base_ck
    CHECK (base_preset IN ('STANDARD', 'QUICK', 'MAJOR_ANNOUNCEMENT', 'LAUNCH')),
  CONSTRAINT social_mission_presets_tiers_ck
    CHECK (jsonb_typeof(tier_targets) = 'array' AND jsonb_array_length(tier_targets) <= 10),
  CONSTRAINT social_mission_presets_deltas_ck CHECK (jsonb_typeof(pulse_deltas) = 'object')
);

CREATE UNIQUE INDEX IF NOT EXISTS social_mission_presets_workspace_name_uidx
  ON public.social_mission_presets (workspace_id, lower(btrim(name)));

-- At most one default preset per workspace.
CREATE UNIQUE INDEX IF NOT EXISTS social_mission_presets_workspace_default_uidx
  ON public.social_mission_presets (workspace_id)
  WHERE is_default;

DROP TRIGGER IF EXISTS social_mission_presets_set_updated_at ON public.social_mission_presets;
CREATE TRIGGER social_mission_presets_set_updated_at
  BEFORE UPDATE ON public.social_mission_presets
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

REVOKE ALL ON TABLE public.social_mission_presets FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.social_mission_presets TO authenticated;
GRANT ALL ON TABLE public.social_mission_presets TO service_role;

ALTER TABLE public.social_mission_presets ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.social_mission_presets FORCE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS social_mission_presets_select_member ON public.social_mission_presets;
CREATE POLICY social_mission_presets_select_member
  ON public.social_mission_presets FOR SELECT TO authenticated
  USING (public.is_workspace_member(workspace_id, (SELECT auth.uid())));

DROP POLICY IF EXISTS social_mission_presets_insert_operator ON public.social_mission_presets;
CREATE POLICY social_mission_presets_insert_operator
  ON public.social_mission_presets FOR INSERT TO authenticated
  WITH CHECK (public.is_workspace_operator(workspace_id, (SELECT auth.uid())));

DROP POLICY IF EXISTS social_mission_presets_update_operator ON public.social_mission_presets;
CREATE POLICY social_mission_presets_update_operator
  ON public.social_mission_presets FOR UPDATE TO authenticated
  USING (public.is_workspace_operator(workspace_id, (SELECT auth.uid())))
  WITH CHECK (public.is_workspace_operator(workspace_id, (SELECT auth.uid())));

DROP POLICY IF EXISTS social_mission_presets_delete_operator ON public.social_mission_presets;
CREATE POLICY social_mission_presets_delete_operator
  ON public.social_mission_presets FOR DELETE TO authenticated
  USING (public.is_workspace_operator(workspace_id, (SELECT auth.uid())));

-- The workspace default settings row points at the saved preset in use.
ALTER TABLE public.social_mission_settings
  ADD COLUMN IF NOT EXISTS active_preset_id uuid
    REFERENCES public.social_mission_presets(id) ON DELETE SET NULL;

-- ---------------------------------------------------------------------------
-- 3. Requirement 4 — pulse marks. ONE row per mission holding the last metric
--    values that were already pulsed. Advancing the marks and emitting the
--    crossings happen in the SAME statement, so a crossing can never repeat.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.social_mission_pulse_marks (
  mission_id uuid PRIMARY KEY REFERENCES public.social_missions(id) ON DELETE CASCADE,
  workspace_id uuid NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
  views_mark bigint,
  likes_mark bigint,
  shares_mark bigint,
  comments_mark bigint,
  last_pulse_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

DROP TRIGGER IF EXISTS social_mission_pulse_marks_set_updated_at ON public.social_mission_pulse_marks;
CREATE TRIGGER social_mission_pulse_marks_set_updated_at
  BEFORE UPDATE ON public.social_mission_pulse_marks
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- Service-role only: the browser never reads or writes transport state.
REVOKE ALL ON TABLE public.social_mission_pulse_marks FROM PUBLIC, anon, authenticated;
GRANT ALL ON TABLE public.social_mission_pulse_marks TO service_role;
ALTER TABLE public.social_mission_pulse_marks ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.social_mission_pulse_marks FORCE ROW LEVEL SECURITY;

-- ---------------------------------------------------------------------------
-- 4. Requirement 5 — idempotent milestone events.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.social_mission_milestone_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  mission_id uuid NOT NULL REFERENCES public.social_missions(id) ON DELETE CASCADE,
  workspace_id uuid NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
  milestone_key text NOT NULL,
  tier integer,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  occurred_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT social_mission_milestone_events_key_ck
    CHECK (milestone_key IN (
      'MISSION_ACTIVE', 'PROJECT_TRENDING', 'MISSION_CLOSING_SOON', 'MISSION_COMPLETED',
      'TIER_1', 'TIER_2', 'TIER_3', 'TIER_4', 'TIER_5',
      'TIER_6', 'TIER_7', 'TIER_8', 'TIER_9', 'TIER_10')),
  CONSTRAINT social_mission_milestone_events_tier_ck
    CHECK (tier IS NULL OR (tier BETWEEN 1 AND 10))
);

-- THE idempotency guarantee: one row per (mission, milestone) forever.
CREATE UNIQUE INDEX IF NOT EXISTS social_mission_milestone_events_uidx
  ON public.social_mission_milestone_events (mission_id, milestone_key);

REVOKE ALL ON TABLE public.social_mission_milestone_events FROM PUBLIC, anon, authenticated;
GRANT SELECT ON TABLE public.social_mission_milestone_events TO authenticated;
GRANT ALL ON TABLE public.social_mission_milestone_events TO service_role;
ALTER TABLE public.social_mission_milestone_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.social_mission_milestone_events FORCE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS social_mission_milestone_events_select_member
  ON public.social_mission_milestone_events;
CREATE POLICY social_mission_milestone_events_select_member
  ON public.social_mission_milestone_events FOR SELECT TO authenticated
  USING (public.is_workspace_member(workspace_id, (SELECT auth.uid())));

-- ---------------------------------------------------------------------------
-- 5. Requirement 7 — persisted final mission performance history.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.social_mission_performance_history (
  mission_id uuid PRIMARY KEY REFERENCES public.social_missions(id) ON DELETE CASCADE,
  workspace_id uuid NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
  mission_code text,
  preset text,
  canonical_url text,
  external_post_id text,
  started_at timestamptz,
  ended_at timestamptz,
  duration_minutes integer,
  baseline_views bigint, baseline_likes bigint, baseline_comments bigint, baseline_shares bigint,
  final_views bigint, final_likes bigint, final_comments bigint, final_shares bigint, final_saves bigint,
  gained_views bigint, gained_likes bigint, gained_comments bigint, gained_shares bigint,
  highest_tier integer,
  accomplished boolean NOT NULL DEFAULT false,
  x_link_status text NOT NULL DEFAULT 'UNKNOWN',
  snapshot_count integer NOT NULL DEFAULT 0,
  pulse_count integer NOT NULL DEFAULT 0,
  recorded_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT social_mission_performance_history_link_ck
    CHECK (x_link_status IN ('OK', 'UNAVAILABLE', 'UNKNOWN'))
);

REVOKE ALL ON TABLE public.social_mission_performance_history FROM PUBLIC, anon, authenticated;
GRANT SELECT ON TABLE public.social_mission_performance_history TO authenticated;
GRANT ALL ON TABLE public.social_mission_performance_history TO service_role;
ALTER TABLE public.social_mission_performance_history ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.social_mission_performance_history FORCE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS social_mission_performance_history_select_member
  ON public.social_mission_performance_history;
CREATE POLICY social_mission_performance_history_select_member
  ON public.social_mission_performance_history FOR SELECT TO authenticated
  USING (public.is_workspace_member(workspace_id, (SELECT auth.uid())));

-- ---------------------------------------------------------------------------
-- 6. Requirement 8 — X link availability state on the mission itself.
--    UNAVAILABLE never stops the lifecycle; it only changes what admins see.
-- ---------------------------------------------------------------------------
ALTER TABLE public.social_missions
  ADD COLUMN IF NOT EXISTS x_link_status text NOT NULL DEFAULT 'UNKNOWN',
  ADD COLUMN IF NOT EXISTS x_link_checked_at timestamptz,
  ADD COLUMN IF NOT EXISTS mission_code text,
  ADD COLUMN IF NOT EXISTS highest_tier integer NOT NULL DEFAULT 0;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'social_missions_x_link_status_ck'
  ) THEN
    ALTER TABLE public.social_missions
      ADD CONSTRAINT social_missions_x_link_status_ck
      CHECK (x_link_status IN ('OK', 'UNAVAILABLE', 'UNKNOWN'));
  END IF;
END $$;

CREATE OR REPLACE FUNCTION public.record_social_mission_link_status(
  _mission_id uuid,
  _status text
)
RETURNS void
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  UPDATE public.social_missions
     SET x_link_status = _status,
         x_link_checked_at = now()
   WHERE id = _mission_id
     AND _status IN ('OK', 'UNAVAILABLE', 'UNKNOWN')
     AND (x_link_status IS DISTINCT FROM _status OR x_link_checked_at IS NULL);
$$;

REVOKE ALL ON FUNCTION public.record_social_mission_link_status(uuid, text)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.record_social_mission_link_status(uuid, text) TO service_role, postgres;

-- ---------------------------------------------------------------------------
-- 7. Requirement 2 — five-minute work list. A mission that already has a
--    snapshot inside the current bucket is EXCLUDED, so the centralized worker
--    performs at most one X read per mission per five minutes, whatever the
--    cron cadence is and however many viewers are looking at the UI.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.list_social_missions_due_for_metrics(
  _bucket timestamptz,
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
  ends_at timestamptz,
  x_link_status text,
  highest_tier integer,
  group_connection_id uuid,
  effective_config jsonb,
  tier_targets jsonb,
  pulse_deltas jsonb

)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT base.mission_id,
         base.workspace_id,
         base.target_id,
         base.external_post_id,
         base.canonical_url,
         base.telegram_chat_id,
         base.telegram_message_id,
         base.edit_revision,
         base.edit_state,
         base.mission_created_by,
         base.accomplished_at,
         base.last_metric_signature,
         m.ends_at,
         m.x_link_status,
         COALESCE(m.highest_tier, 0),
         tg.group_connection_id,
         base.effective_config,
         COALESCE(pr.tier_targets, '[]'::jsonb),
         COALESCE(pr.pulse_deltas,
                  jsonb_build_object('views', 100, 'likes', 10, 'shares', 5, 'comments', 5))
    FROM public.list_active_social_missions_for_metrics(_limit) AS base
    JOIN public.social_missions m ON m.id = base.mission_id
    JOIN public.social_mission_targets tg ON tg.id = base.target_id
    LEFT JOIN public.social_mission_settings s ON s.workspace_id = base.workspace_id
    LEFT JOIN public.social_mission_presets pr ON pr.id = s.active_preset_id
   WHERE NOT EXISTS (

           SELECT 1
             FROM public.social_metric_snapshots sn
            WHERE sn.mission_id = base.mission_id
              AND sn.poll_bucket = _bucket
         )
   LIMIT LEAST(GREATEST(COALESCE(_limit, 100), 1), 500);
$$;

REVOKE ALL ON FUNCTION public.list_social_missions_due_for_metrics(timestamptz, integer)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.list_social_missions_due_for_metrics(timestamptz, integer)
  TO service_role, postgres;

-- ---------------------------------------------------------------------------
-- 8. Requirement 4 — atomic crossing evaluation. Returns the crossings that
--    have NOT been announced yet and advances the marks in the same statement.
--    A first observation only seeds the marks and never pulses.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.evaluate_social_mission_pulse(
  _mission_id uuid,
  _workspace_id uuid,
  _views bigint,
  _likes bigint,
  _shares bigint,
  _comments bigint,
  _delta_views integer DEFAULT 100,
  _delta_likes integer DEFAULT 10,
  _delta_shares integer DEFAULT 5,
  _delta_comments integer DEFAULT 5
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_row public.social_mission_pulse_marks%ROWTYPE;
  v_crossings jsonb := '[]'::jsonb;
  v_seeded boolean := false;
  v_next_views bigint;
  v_next_likes bigint;
  v_next_shares bigint;
  v_next_comments bigint;
BEGIN

  INSERT INTO public.social_mission_pulse_marks (mission_id, workspace_id)
  VALUES (_mission_id, _workspace_id)
  ON CONFLICT (mission_id) DO NOTHING;

  -- Serialize concurrent workers on this mission's marks.
  SELECT * INTO v_row
    FROM public.social_mission_pulse_marks
   WHERE mission_id = _mission_id
     FOR UPDATE;

  v_next_views := v_row.views_mark;
  v_next_likes := v_row.likes_mark;
  v_next_shares := v_row.shares_mark;
  v_next_comments := v_row.comments_mark;

  -- views
  IF _views IS NOT NULL THEN
    IF v_row.views_mark IS NULL THEN
      v_next_views := _views; v_seeded := true;
    ELSIF _views - v_row.views_mark >= GREATEST(_delta_views, 1) THEN
      v_next_views := v_row.views_mark + (((_views - v_row.views_mark) / GREATEST(_delta_views, 1)) * GREATEST(_delta_views, 1));
      v_crossings := v_crossings || jsonb_build_object(
        'metric', 'views', 'label', 'views',
        'gained', v_next_views - v_row.views_mark, 'total', _views);
    END IF;
  END IF;

  -- likes
  IF _likes IS NOT NULL THEN
    IF v_row.likes_mark IS NULL THEN
      v_next_likes := _likes; v_seeded := true;
    ELSIF _likes - v_row.likes_mark >= GREATEST(_delta_likes, 1) THEN
      v_next_likes := v_row.likes_mark + (((_likes - v_row.likes_mark) / GREATEST(_delta_likes, 1)) * GREATEST(_delta_likes, 1));
      v_crossings := v_crossings || jsonb_build_object(
        'metric', 'likes', 'label', 'likes',
        'gained', v_next_likes - v_row.likes_mark, 'total', _likes);
    END IF;
  END IF;

  -- shares / reposts
  IF _shares IS NOT NULL THEN
    IF v_row.shares_mark IS NULL THEN
      v_next_shares := _shares; v_seeded := true;
    ELSIF _shares - v_row.shares_mark >= GREATEST(_delta_shares, 1) THEN
      v_next_shares := v_row.shares_mark + (((_shares - v_row.shares_mark) / GREATEST(_delta_shares, 1)) * GREATEST(_delta_shares, 1));
      v_crossings := v_crossings || jsonb_build_object(
        'metric', 'shares', 'label', 'reposts',
        'gained', v_next_shares - v_row.shares_mark, 'total', _shares);
    END IF;
  END IF;

  -- comments / replies
  IF _comments IS NOT NULL THEN
    IF v_row.comments_mark IS NULL THEN
      v_next_comments := _comments; v_seeded := true;
    ELSIF _comments - v_row.comments_mark >= GREATEST(_delta_comments, 1) THEN
      v_next_comments := v_row.comments_mark + (((_comments - v_row.comments_mark) / GREATEST(_delta_comments, 1)) * GREATEST(_delta_comments, 1));
      v_crossings := v_crossings || jsonb_build_object(
        'metric', 'comments', 'label', 'replies',
        'gained', v_next_comments - v_row.comments_mark, 'total', _comments);
    END IF;
  END IF;

  UPDATE public.social_mission_pulse_marks
     SET views_mark = v_next_views,
         likes_mark = v_next_likes,
         shares_mark = v_next_shares,
         comments_mark = v_next_comments,
         last_pulse_at = CASE WHEN jsonb_array_length(v_crossings) > 0 THEN now() ELSE last_pulse_at END
   WHERE mission_id = _mission_id;

  RETURN jsonb_build_object(
    'seeded', v_seeded,
    'should_pulse', jsonb_array_length(v_crossings) > 0,
    'crossings', v_crossings);
END;
$$;

REVOKE ALL ON FUNCTION public.evaluate_social_mission_pulse(
  uuid, uuid, bigint, bigint, bigint, bigint, integer, integer, integer, integer)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.evaluate_social_mission_pulse(
  uuid, uuid, bigint, bigint, bigint, bigint, integer, integer, integer, integer)
  TO service_role, postgres;

-- ---------------------------------------------------------------------------
-- 9. Requirement 5 — idempotent milestone recording. Returns true ONLY the
--    first time a milestone is entered, so the caller announces it once.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.record_social_mission_milestone(
  _mission_id uuid,
  _workspace_id uuid,
  _milestone_key text,
  _tier integer DEFAULT NULL,
  _metadata jsonb DEFAULT '{}'::jsonb
)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_inserted uuid;
BEGIN
  INSERT INTO public.social_mission_milestone_events
    (mission_id, workspace_id, milestone_key, tier, metadata)
  VALUES (_mission_id, _workspace_id, _milestone_key, _tier, COALESCE(_metadata, '{}'::jsonb))
  ON CONFLICT (mission_id, milestone_key) DO NOTHING
  RETURNING id INTO v_inserted;

  IF v_inserted IS NOT NULL AND _tier IS NOT NULL THEN
    UPDATE public.social_missions
       SET highest_tier = GREATEST(COALESCE(highest_tier, 0), _tier)
     WHERE id = _mission_id;
  END IF;

  RETURN v_inserted IS NOT NULL;
END;
$$;

REVOKE ALL ON FUNCTION public.record_social_mission_milestone(uuid, uuid, text, integer, jsonb)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.record_social_mission_milestone(uuid, uuid, text, integer, jsonb)
  TO service_role, postgres;

-- ---------------------------------------------------------------------------
-- 10. Requirement 7 — persist final performance at mission end. Idempotent:
--     one row per mission, written from stored snapshots only.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.finalize_social_mission_performance(_mission_id uuid)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_m public.social_missions%ROWTYPE;
  v_views bigint; v_likes bigint; v_comments bigint; v_shares bigint; v_saves bigint;
  v_post record;
  v_snapshots integer := 0;
  v_pulses integer := 0;
  v_inserted uuid;
BEGIN
  SELECT * INTO v_m FROM public.social_missions WHERE id = _mission_id;
  IF NOT FOUND THEN RETURN false; END IF;

  SELECT views, likes, comments, shares, saves
    INTO v_views, v_likes, v_comments, v_shares, v_saves

    FROM public.social_metric_snapshots
   WHERE mission_id = _mission_id
   ORDER BY observed_at DESC
   LIMIT 1;

  SELECT canonical_url, external_post_id
    INTO v_post
    FROM public.social_posts
   WHERE id = v_m.social_post_id;

  SELECT count(*) INTO v_snapshots
    FROM public.social_metric_snapshots WHERE mission_id = _mission_id;

  -- SE-6 correction (G): count the THRESHOLD-CROSSING pulses recorded on the
  -- mission's pulse marks, never the superseded time-based schedule rows.
  SELECT COALESCE(pulse_count, 0) INTO v_pulses
    FROM public.social_mission_pulse_marks
   WHERE mission_id = _mission_id;


  INSERT INTO public.social_mission_performance_history (
    mission_id, workspace_id, mission_code, preset, canonical_url, external_post_id,
    started_at, ended_at, duration_minutes,
    baseline_views, baseline_likes, baseline_comments, baseline_shares,
    final_views, final_likes, final_comments, final_shares, final_saves,
    gained_views, gained_likes, gained_comments, gained_shares,
    highest_tier, accomplished, x_link_status, snapshot_count, pulse_count)
  VALUES (
    v_m.id, v_m.workspace_id, v_m.mission_code,
    COALESCE(public.social_mission_effective_config(v_m.id) ->> 'preset', 'STANDARD'),
    v_post.canonical_url, v_post.external_post_id,
    v_m.started_at, COALESCE(v_m.completed_at, v_m.ends_at, now()),
    CASE
      WHEN v_m.started_at IS NOT NULL
      THEN GREATEST(0, (EXTRACT(EPOCH FROM (COALESCE(v_m.completed_at, v_m.ends_at, now()) - v_m.started_at)) / 60)::integer)
    END,
    v_m.baseline_views, v_m.baseline_likes, v_m.baseline_comments, v_m.baseline_shares,
    v_views, v_likes, v_comments, v_shares, v_saves,
    CASE WHEN v_views IS NOT NULL AND v_m.baseline_views IS NOT NULL THEN v_views - v_m.baseline_views END,
    CASE WHEN v_likes IS NOT NULL AND v_m.baseline_likes IS NOT NULL THEN v_likes - v_m.baseline_likes END,
    CASE WHEN v_comments IS NOT NULL AND v_m.baseline_comments IS NOT NULL THEN v_comments - v_m.baseline_comments END,
    CASE WHEN v_shares IS NOT NULL AND v_m.baseline_shares IS NOT NULL THEN v_shares - v_m.baseline_shares END,

    COALESCE(v_m.highest_tier, 0),
    v_m.accomplished_at IS NOT NULL,
    COALESCE(v_m.x_link_status, 'UNKNOWN'),
    COALESCE(v_snapshots, 0), COALESCE(v_pulses, 0))
  ON CONFLICT (mission_id) DO NOTHING
  RETURNING mission_id INTO v_inserted;

  RETURN v_inserted IS NOT NULL;
END;
$$;

REVOKE ALL ON FUNCTION public.finalize_social_mission_performance(uuid)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.finalize_social_mission_performance(uuid) TO service_role, postgres;

COMMIT;
