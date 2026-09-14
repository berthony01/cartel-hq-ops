-- ===========================================================================
-- SE-5 — CARTEL SOCIAL mission engine completion.
--
-- PREPARE ONLY. Lovable does NOT apply this migration. Apply it externally
-- against the authoritative Supabase project `ocoinbnjgstkmnwwvnhi` after
-- independent diff review.
--
-- What this adds, minimum necessary
--   1. `social_mission_settings` — ONE workspace-scoped settings table
--      (presets, live metrics, link finder, command cleanup, auto pin,
--      milestone). Members read; only owner/admin may insert/update.
--   2. `social_mission_link_candidates` — transient SERVICE-ONLY provenance
--      for the X Link Finder admin prompt. No browser grant at all.
--   3. Minimum new columns:
--        social_missions.accomplished_at        (product-level ACCOMPLISHED)
--        social_mission_targets.pinned_by_hq    (only unpin what HQ pinned)
--        social_mission_targets.pinned_at
--        social_mission_targets.command_message_id
--        social_mission_targets.command_deleted_at
--        social_mission_targets.last_metric_signature
--      Immutable effective preset/pulse/milestone configuration lives in
--      `social_missions.metadata -> 'effective_config'`, not in new columns.
--   4. `activate_social_mission_schedule` reseeded from the mission's OWN
--      snapshotted effective preset instead of a hardcoded 45/3,8,15,25,35.
--      Missions with no snapshot fall back to STANDARD semantics.
--   5. Service-role RPCs for the metrics engine and the link finder.
--
-- Frozen invariants preserved
--   * The existing schedule table, the existing one-minute
--     `cartel-social-mission-runner` cron and the existing cleanup worker are
--     REUSED. No second scheduler is created here.
--   * DB lifecycle stays LIVE -> COMPLETED. ACCOMPLISHED is a derived product
--     state recorded as `accomplished_at` while the mission stays LIVE.
--   * One snapshot per (mission, provider, poll_bucket). Baseline is written
--     exactly once. NULL metrics stay NULL and are never coerced to 0.
--   * No reward, quota, point or payout mechanic exists anywhere below.
--   * No secret value is embedded, printed or returned.
-- ===========================================================================

BEGIN;

-- ---------------------------------------------------------------------------
-- 1. Preset catalogue (pure function; no table, no configuration drift).
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.social_mission_preset_config(_preset text)
RETURNS jsonb
LANGUAGE sql
IMMUTABLE
SET search_path = public
AS $$
  SELECT CASE upper(coalesce(_preset, 'STANDARD'))
    WHEN 'QUICK' THEN
      jsonb_build_object('preset', 'QUICK', 'duration_minutes', 20,
                         'pulse_offsets', jsonb_build_array(2, 5, 10, 15))
    WHEN 'MAJOR_ANNOUNCEMENT' THEN
      jsonb_build_object('preset', 'MAJOR_ANNOUNCEMENT', 'duration_minutes', 120,
                         'pulse_offsets', jsonb_build_array(5, 15, 30, 60, 90))
    WHEN 'LAUNCH' THEN
      jsonb_build_object('preset', 'LAUNCH', 'duration_minutes', 60,
                         'pulse_offsets', jsonb_build_array(3, 8, 15, 30, 45))
    ELSE
      jsonb_build_object('preset', 'STANDARD', 'duration_minutes', 45,
                         'pulse_offsets', jsonb_build_array(3, 8, 15, 25, 35))
  END;
$$;

GRANT EXECUTE ON FUNCTION public.social_mission_preset_config(text) TO authenticated, service_role, postgres;

-- ---------------------------------------------------------------------------
-- 2. Workspace-scoped Social Mission settings. ONE table.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.social_mission_settings (
  workspace_id uuid PRIMARY KEY REFERENCES public.workspaces(id) ON DELETE CASCADE,
  default_preset text NOT NULL DEFAULT 'STANDARD',
  live_metrics_enabled boolean NOT NULL DEFAULT true,
  link_finder_enabled boolean NOT NULL DEFAULT true,
  delete_command_after_send boolean NOT NULL DEFAULT true,
  auto_pin_mission boolean NOT NULL DEFAULT true,
  milestone_type text NOT NULL DEFAULT 'NONE',
  milestone_target integer,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT social_mission_settings_preset_ck
    CHECK (default_preset IN ('STANDARD', 'QUICK', 'MAJOR_ANNOUNCEMENT', 'LAUNCH')),
  CONSTRAINT social_mission_settings_milestone_type_ck
    CHECK (milestone_type IN ('NONE', 'VIEWS', 'LIKES', 'REPLIES', 'REPOSTS', 'TOTAL_INTERACTIONS')),
  -- A milestone is either off, or an explicit positive integer target.
  CONSTRAINT social_mission_settings_milestone_target_ck
    CHECK (
      (milestone_type = 'NONE' AND milestone_target IS NULL)
      OR (milestone_type <> 'NONE' AND milestone_target IS NOT NULL AND milestone_target > 0)
    )
);

DROP TRIGGER IF EXISTS social_mission_settings_set_updated_at ON public.social_mission_settings;
CREATE TRIGGER social_mission_settings_set_updated_at
  BEFORE UPDATE ON public.social_mission_settings
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

REVOKE ALL ON TABLE public.social_mission_settings FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT, UPDATE ON TABLE public.social_mission_settings TO authenticated;
GRANT ALL ON TABLE public.social_mission_settings TO service_role;

ALTER TABLE public.social_mission_settings ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.social_mission_settings FORCE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS social_mission_settings_select_member ON public.social_mission_settings;
CREATE POLICY social_mission_settings_select_member
  ON public.social_mission_settings
  FOR SELECT
  TO authenticated
  USING (public.is_workspace_member(workspace_id, (SELECT auth.uid())));

DROP POLICY IF EXISTS social_mission_settings_insert_operator ON public.social_mission_settings;
CREATE POLICY social_mission_settings_insert_operator
  ON public.social_mission_settings
  FOR INSERT
  TO authenticated
  WITH CHECK (public.is_workspace_operator(workspace_id, (SELECT auth.uid())));

DROP POLICY IF EXISTS social_mission_settings_update_operator ON public.social_mission_settings;
CREATE POLICY social_mission_settings_update_operator
  ON public.social_mission_settings
  FOR UPDATE
  TO authenticated
  USING (public.is_workspace_operator(workspace_id, (SELECT auth.uid())))
  WITH CHECK (public.is_workspace_operator(workspace_id, (SELECT auth.uid())));

-- No DELETE policy by design: the browser never removes settings.

-- ---------------------------------------------------------------------------
-- 3. Transient X Link Finder candidates. SERVICE ROLE ONLY.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.social_mission_link_candidates (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
  group_connection_id uuid NOT NULL REFERENCES public.telegram_group_connections(id) ON DELETE CASCADE,
  telegram_chat_id bigint NOT NULL,
  -- The ORIGINAL member message that contained the link. Idempotency key.
  telegram_message_id bigint NOT NULL,
  telegram_user_id bigint,
  prompt_message_id bigint,
  canonical_url text NOT NULL,
  external_post_id text NOT NULL,
  author_handle text NOT NULL,
  state text NOT NULL DEFAULT 'PENDING',
  expires_at timestamptz NOT NULL,
  resolved_at timestamptz,
  resolved_by uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT social_mission_link_candidates_state_ck
    CHECK (state IN ('PENDING', 'STARTED', 'IGNORED', 'EXPIRED')),
  CONSTRAINT social_mission_link_candidates_unique
    UNIQUE (telegram_chat_id, telegram_message_id)
);

CREATE INDEX IF NOT EXISTS social_mission_link_candidates_pending_idx
  ON public.social_mission_link_candidates (state, expires_at)
  WHERE state = 'PENDING';

DROP TRIGGER IF EXISTS social_mission_link_candidates_set_updated_at
  ON public.social_mission_link_candidates;
CREATE TRIGGER social_mission_link_candidates_set_updated_at
  BEFORE UPDATE ON public.social_mission_link_candidates
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- Service-only: no SELECT, INSERT, UPDATE or DELETE for the browser at all.
REVOKE ALL ON TABLE public.social_mission_link_candidates FROM PUBLIC, anon, authenticated;
GRANT ALL ON TABLE public.social_mission_link_candidates TO service_role;

ALTER TABLE public.social_mission_link_candidates ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.social_mission_link_candidates FORCE ROW LEVEL SECURITY;
-- Deliberately NO policy: every access path is SECURITY DEFINER/service role.

-- ---------------------------------------------------------------------------
-- 4. Minimum new columns on existing tables.
-- ---------------------------------------------------------------------------
ALTER TABLE public.social_missions
  ADD COLUMN IF NOT EXISTS accomplished_at timestamptz;

ALTER TABLE public.social_mission_targets
  ADD COLUMN IF NOT EXISTS pinned_by_hq boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS pinned_at timestamptz,
  ADD COLUMN IF NOT EXISTS command_message_id bigint,
  ADD COLUMN IF NOT EXISTS command_deleted_at timestamptz,
  -- Visible-metric fingerprint of the last rendered card. The runner only
  -- edits Telegram when this changes, so an unchanged minute is a no-op.
  ADD COLUMN IF NOT EXISTS last_metric_signature text;

-- ---------------------------------------------------------------------------
-- 5. Effective-configuration resolution for a mission.
--    Old missions carry no snapshot and safely resolve to STANDARD.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.social_mission_effective_config(_mission_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_meta jsonb;
  v_config jsonb;
BEGIN
  SELECT metadata INTO v_meta FROM public.social_missions WHERE id = _mission_id;
  v_config := v_meta -> 'effective_config';
  IF v_config IS NULL OR jsonb_typeof(v_config) <> 'object' THEN
    RETURN public.social_mission_preset_config('STANDARD');
  END IF;
  -- Defensive: a malformed snapshot never breaks scheduling.
  IF jsonb_typeof(v_config -> 'pulse_offsets') <> 'array'
     OR jsonb_typeof(v_config -> 'duration_minutes') <> 'number' THEN
    RETURN public.social_mission_preset_config(coalesce(v_config ->> 'preset', 'STANDARD'));
  END IF;
  RETURN v_config;
END;
$$;

REVOKE ALL ON FUNCTION public.social_mission_effective_config(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.social_mission_effective_config(uuid) TO authenticated, service_role, postgres;

-- ---------------------------------------------------------------------------
-- 6. activate_social_mission_schedule — preset-driven, no hardcoded 45/3,8,...
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.activate_social_mission_schedule(
  _mission_id uuid,
  _target_id uuid
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_mission public.social_missions%ROWTYPE;
  v_target public.social_mission_targets%ROWTYPE;
  v_config jsonb;
  v_duration integer;
  v_offsets integer[];
  v_ends timestamptz;
  v_index integer;
  v_seeded integer := 0;
  v_inserted integer;
BEGIN
  IF _mission_id IS NULL OR _target_id IS NULL THEN
    RETURN jsonb_build_object('outcome', 'REJECTED', 'reason', 'invalid_identifiers');
  END IF;

  SELECT * INTO v_mission FROM public.social_missions WHERE id = _mission_id FOR UPDATE;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('outcome', 'REJECTED', 'reason', 'mission_not_found');
  END IF;

  SELECT * INTO v_target
    FROM public.social_mission_targets
   WHERE id = _target_id
     AND mission_id = _mission_id
     AND workspace_id = v_mission.workspace_id
   FOR UPDATE;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('outcome', 'REJECTED', 'reason', 'target_not_bound');
  END IF;

  IF v_target.delivery_state <> 'SENT'
     OR v_target.telegram_message_id IS NULL
     OR v_target.sent_at IS NULL THEN
    RETURN jsonb_build_object('outcome', 'REJECTED', 'reason', 'delivery_not_confirmed');
  END IF;

  IF v_mission.status = 'COMPLETED' THEN
    RETURN jsonb_build_object('outcome', 'ALREADY_COMPLETED', 'mission_id', _mission_id, 'target_id', _target_id);
  END IF;

  IF v_mission.status <> 'LIVE' THEN
    RETURN jsonb_build_object('outcome', 'REJECTED', 'reason', 'mission_not_live');
  END IF;

  -- The mission's OWN snapshotted preset decides duration and pulse offsets.
  v_config := public.social_mission_effective_config(_mission_id);
  v_duration := GREATEST(1, LEAST(1440, (v_config ->> 'duration_minutes')::integer));
  SELECT COALESCE(array_agg(value::integer ORDER BY value::integer), ARRAY[]::integer[])
    INTO v_offsets
    FROM jsonb_array_elements_text(v_config -> 'pulse_offsets') AS value
   WHERE value::integer > 0 AND value::integer < v_duration;

  -- Duration is anchored to CONFIRMED delivery, never to command time.
  v_ends := v_target.sent_at + make_interval(mins => v_duration);

  UPDATE public.social_missions
     SET started_at = COALESCE(started_at, v_target.sent_at),
         ends_at = COALESCE(ends_at, v_ends)
   WHERE id = _mission_id;

  -- Idempotent seeding. A duplicate activation inserts nothing.
  IF array_length(v_offsets, 1) IS NOT NULL THEN
    FOR v_index IN 1..LEAST(array_length(v_offsets, 1), 5) LOOP
      INSERT INTO public.social_mission_schedule_events (
        workspace_id, mission_id, target_id, event_type, sequence_no, due_at
      )
      VALUES (
        v_mission.workspace_id, _mission_id, _target_id, 'PULSE', v_index::smallint,
        v_target.sent_at + make_interval(mins => v_offsets[v_index])
      )
      ON CONFLICT (target_id, event_type, sequence_no) DO NOTHING;
      GET DIAGNOSTICS v_inserted = ROW_COUNT;
      v_seeded := v_seeded + v_inserted;
    END LOOP;
  END IF;

  INSERT INTO public.social_mission_schedule_events (
    workspace_id, mission_id, target_id, event_type, sequence_no, due_at
  )
  VALUES (
    v_mission.workspace_id, _mission_id, _target_id, 'COMPLETE', 1::smallint,
    v_target.sent_at + make_interval(mins => v_duration)
  )
  ON CONFLICT (target_id, event_type, sequence_no) DO NOTHING;
  GET DIAGNOSTICS v_inserted = ROW_COUNT;
  v_seeded := v_seeded + v_inserted;

  RETURN jsonb_build_object(
    'outcome', CASE WHEN v_seeded = 0 THEN 'EXISTING' ELSE 'ACTIVATED' END,
    'workspace_id', v_mission.workspace_id,
    'mission_id', _mission_id,
    'target_id', _target_id,
    'preset', v_config ->> 'preset',
    'duration_minutes', v_duration,
    'sent_at', v_target.sent_at,
    'ends_at', (SELECT ends_at FROM public.social_missions WHERE id = _mission_id),
    'events_seeded', v_seeded
  );
END;
$$;

REVOKE ALL ON FUNCTION public.activate_social_mission_schedule(uuid, uuid)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.activate_social_mission_schedule(uuid, uuid) TO service_role;
GRANT EXECUTE ON FUNCTION public.activate_social_mission_schedule(uuid, uuid) TO postgres;

-- ---------------------------------------------------------------------------
-- 7. Metrics engine — work list.
--    Returns one row per ACTIVE mission that opted into live metrics, with the
--    external post id the runner batches by. No X call happens in the DB.
-- ---------------------------------------------------------------------------
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
         public.social_mission_effective_config(m.id)
    FROM public.social_missions m
    JOIN public.social_mission_targets t
      ON t.mission_id = m.id AND t.workspace_id = m.workspace_id
    JOIN public.social_posts p
      ON p.id = m.social_post_id
    LEFT JOIN public.social_mission_settings s
      ON s.workspace_id = m.workspace_id
   WHERE m.status = 'LIVE'
     AND m.completed_at IS NULL
     AND t.delivery_state = 'SENT'
     AND t.telegram_message_id IS NOT NULL
     AND p.platform = 'x'
     AND p.external_post_id ~ '^[0-9]{1,32}$'
     AND COALESCE(s.live_metrics_enabled, true) = true
     AND COALESCE((public.social_mission_effective_config(m.id) ->> 'live_metrics_enabled')::boolean, true) = true
   ORDER BY m.started_at NULLS LAST
   LIMIT LEAST(GREATEST(COALESCE(_limit, 100), 1), 500);
$$;

REVOKE ALL ON FUNCTION public.list_active_social_missions_for_metrics(integer)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.list_active_social_missions_for_metrics(integer) TO service_role;
GRANT EXECUTE ON FUNCTION public.list_active_social_missions_for_metrics(integer) TO postgres;

-- ---------------------------------------------------------------------------
-- 8. Metrics engine — atomic snapshot + baseline + milestone.
--
--    * Exactly one snapshot per (mission_id, provider, poll_bucket).
--    * Baseline metrics are written ONCE, only where currently NULL.
--    * `accomplished_at` is set at most once, with a conditional UPDATE.
--    * NULL stays NULL. No metric is defaulted to 0 anywhere in this function.
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
  v_inserted integer := 0;
  v_baseline_written boolean := false;
  v_accomplished_now boolean := false;
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
  GET DIAGNOSTICS v_inserted = ROW_COUNT;

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
           baseline_captured_at = COALESCE(baseline_captured_at, COALESCE(_observed_at, now()))
     WHERE id = _mission_id
       AND baseline_views IS NULL
       AND baseline_likes IS NULL
       AND baseline_comments IS NULL
       AND baseline_shares IS NULL
       AND baseline_saves IS NULL;
    GET DIAGNOSTICS v_inserted = ROW_COUNT;
    v_baseline_written := v_inserted = 1;
  END IF;

  -- Milestone. Absolute public metrics only; never a per-user requirement and
  -- never a reward. TOTAL_INTERACTIONS excludes views and bookmarks.
  v_config := public.social_mission_effective_config(_mission_id);
  v_type := upper(coalesce(v_config ->> 'milestone_type', 'NONE'));
  v_target_value := NULLIF(v_config ->> 'milestone_target', '')::integer;

  IF v_mission.accomplished_at IS NULL AND v_type <> 'NONE'
     AND v_target_value IS NOT NULL AND v_target_value > 0 THEN
    v_progress := CASE v_type
      WHEN 'VIEWS' THEN _views
      WHEN 'LIKES' THEN _likes
      WHEN 'REPLIES' THEN _comments
      WHEN 'REPOSTS' THEN _shares
      WHEN 'TOTAL_INTERACTIONS' THEN
        CASE
          WHEN _likes IS NULL AND _comments IS NULL AND _shares IS NULL THEN NULL
          ELSE COALESCE(_likes, 0) + COALESCE(_comments, 0) + COALESCE(_shares, 0)
        END
      ELSE NULL
    END;

    IF v_progress IS NOT NULL AND v_progress >= v_target_value THEN
      UPDATE public.social_missions
         SET accomplished_at = COALESCE(_observed_at, now())
       WHERE id = _mission_id
         AND accomplished_at IS NULL;
      GET DIAGNOSTICS v_inserted = ROW_COUNT;
      v_accomplished_now := v_inserted = 1;
    END IF;
  END IF;

  RETURN jsonb_build_object(
    'outcome', 'RECORDED',
    'mission_id', _mission_id,
    'workspace_id', v_mission.workspace_id,
    'baseline_written', v_baseline_written,
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

-- ---------------------------------------------------------------------------
-- 9. Visible-signature gate. The runner may edit Telegram ONLY when this
--    returns true, so an unchanged minute never touches Telegram.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.claim_social_mission_card_refresh(
  _target_id uuid,
  _signature text
)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_rows integer := 0;
BEGIN
  IF _target_id IS NULL OR coalesce(btrim(_signature), '') = '' THEN
    RETURN false;
  END IF;

  UPDATE public.social_mission_targets
     SET last_metric_signature = _signature
   WHERE id = _target_id
     AND (last_metric_signature IS DISTINCT FROM _signature);

  GET DIAGNOSTICS v_rows = ROW_COUNT;
  RETURN v_rows = 1;
END;
$$;

REVOKE ALL ON FUNCTION public.claim_social_mission_card_refresh(uuid, text)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.claim_social_mission_card_refresh(uuid, text) TO service_role;
GRANT EXECUTE ON FUNCTION public.claim_social_mission_card_refresh(uuid, text) TO postgres;

-- ---------------------------------------------------------------------------
-- 10. Pin / command-cleanup bookkeeping. Service role only.
--     Pin state is recorded ONLY when CARTEL HQ itself performed the pin, so a
--     later unpin can never remove a pin the community set themselves.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.record_social_mission_target_pin(
  _target_id uuid,
  _pinned boolean
)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_rows integer := 0;
BEGIN
  IF _target_id IS NULL OR _pinned IS NULL THEN RETURN false; END IF;
  UPDATE public.social_mission_targets
     SET pinned_by_hq = _pinned,
         pinned_at = CASE WHEN _pinned THEN now() ELSE NULL END
   WHERE id = _target_id;
  GET DIAGNOSTICS v_rows = ROW_COUNT;
  RETURN v_rows = 1;
END;
$$;

REVOKE ALL ON FUNCTION public.record_social_mission_target_pin(uuid, boolean)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.record_social_mission_target_pin(uuid, boolean) TO service_role;
GRANT EXECUTE ON FUNCTION public.record_social_mission_target_pin(uuid, boolean) TO postgres;

CREATE OR REPLACE FUNCTION public.record_social_mission_command_deleted(
  _target_id uuid,
  _command_message_id bigint
)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_rows integer := 0;
BEGIN
  IF _target_id IS NULL THEN RETURN false; END IF;
  UPDATE public.social_mission_targets
     SET command_message_id = COALESCE(_command_message_id, command_message_id),
         command_deleted_at = now()
   WHERE id = _target_id;
  GET DIAGNOSTICS v_rows = ROW_COUNT;
  RETURN v_rows = 1;
END;
$$;

REVOKE ALL ON FUNCTION public.record_social_mission_command_deleted(uuid, bigint)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.record_social_mission_command_deleted(uuid, bigint) TO service_role;
GRANT EXECUTE ON FUNCTION public.record_social_mission_command_deleted(uuid, bigint) TO postgres;

-- ---------------------------------------------------------------------------
-- 11. X Link Finder — candidate creation.
--     Fails closed on every authorization/ownership fact and is idempotent per
--     (chat, original message).
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.create_social_mission_link_candidate(
  _telegram_chat_id bigint,
  _telegram_message_id bigint,
  _telegram_user_id bigint,
  _canonical_url text,
  _external_post_id text,
  _author_handle text,
  _ttl_minutes integer DEFAULT 15
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_workspace_id uuid;
  v_connection_id uuid;
  v_official_handle text;
  v_x_url text;
  v_handle text := lower(btrim(coalesce(_author_handle, '')));
  v_post text := btrim(coalesce(_external_post_id, ''));
  v_url text := btrim(coalesce(_canonical_url, ''));
  v_enabled boolean;
  v_id uuid;
  v_rows integer := 0;
BEGIN
  IF _telegram_chat_id IS NULL OR _telegram_message_id IS NULL THEN
    RETURN jsonb_build_object('outcome', 'REJECTED', 'reason', 'invalid_telegram_identifiers');
  END IF;
  IF v_post !~ '^[0-9]{1,32}$' OR v_handle !~ '^[a-z0-9_]{1,15}$' THEN
    RETURN jsonb_build_object('outcome', 'REJECTED', 'reason', 'invalid_post');
  END IF;
  IF v_url <> ('https://x.com/' || v_handle || '/status/' || v_post) THEN
    RETURN jsonb_build_object('outcome', 'REJECTED', 'reason', 'invalid_canonical_url');
  END IF;

  SELECT gc.id, gc.workspace_id INTO v_connection_id, v_workspace_id
    FROM public.telegram_group_connections gc
   WHERE gc.telegram_chat_id = _telegram_chat_id
   LIMIT 1;
  IF v_connection_id IS NULL THEN
    RETURN jsonb_build_object('outcome', 'REJECTED', 'reason', 'group_not_connected');
  END IF;

  SELECT COALESCE(s.link_finder_enabled, true) INTO v_enabled
    FROM public.workspaces w
    LEFT JOIN public.social_mission_settings s ON s.workspace_id = w.id
   WHERE w.id = v_workspace_id;
  IF COALESCE(v_enabled, true) IS NOT TRUE THEN
    RETURN jsonb_build_object('outcome', 'REJECTED', 'reason', 'link_finder_disabled');
  END IF;

  -- Only the workspace's OWN official X account can produce a candidate.
  SELECT pp.x_url INTO v_x_url
    FROM public.project_profiles pp
   WHERE pp.workspace_id = v_workspace_id
   LIMIT 1;
  v_official_handle := lower(
    (regexp_match(
      coalesce(v_x_url, ''),
      '^https?://(?:www\.|mobile\.)?(?:x|twitter)\.com/@?([A-Za-z0-9_]{1,15})(?:[/?#].*)?$'
    ))[1]
  );
  IF v_official_handle IS NULL THEN
    RETURN jsonb_build_object('outcome', 'REJECTED', 'reason', 'official_x_account_missing');
  END IF;
  IF v_official_handle <> v_handle THEN
    RETURN jsonb_build_object('outcome', 'REJECTED', 'reason', 'handle_not_official');
  END IF;

  -- Idempotent per original message: a repeated webhook delivery adds nothing.
  INSERT INTO public.social_mission_link_candidates (
    workspace_id, group_connection_id, telegram_chat_id, telegram_message_id,
    telegram_user_id, canonical_url, external_post_id, author_handle, expires_at
  )
  VALUES (
    v_workspace_id, v_connection_id, _telegram_chat_id, _telegram_message_id,
    _telegram_user_id, v_url, v_post, v_handle,
    now() + make_interval(mins => GREATEST(1, LEAST(60, COALESCE(_ttl_minutes, 15))))
  )
  ON CONFLICT (telegram_chat_id, telegram_message_id) DO NOTHING
  RETURNING id INTO v_id;
  GET DIAGNOSTICS v_rows = ROW_COUNT;

  IF v_rows = 0 THEN
    RETURN jsonb_build_object('outcome', 'EXISTING', 'workspace_id', v_workspace_id);
  END IF;

  RETURN jsonb_build_object(
    'outcome', 'CREATED',
    'candidate_id', v_id,
    'workspace_id', v_workspace_id,
    'canonical_url', v_url
  );
END;
$$;

REVOKE ALL ON FUNCTION public.create_social_mission_link_candidate(
  bigint, bigint, bigint, text, text, text, integer
) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.create_social_mission_link_candidate(
  bigint, bigint, bigint, text, text, text, integer
) TO service_role;
GRANT EXECUTE ON FUNCTION public.create_social_mission_link_candidate(
  bigint, bigint, bigint, text, text, text, integer
) TO postgres;

CREATE OR REPLACE FUNCTION public.attach_social_mission_link_prompt(
  _candidate_id uuid,
  _prompt_message_id bigint
)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_rows integer := 0;
BEGIN
  IF _candidate_id IS NULL OR _prompt_message_id IS NULL THEN RETURN false; END IF;
  UPDATE public.social_mission_link_candidates
     SET prompt_message_id = _prompt_message_id
   WHERE id = _candidate_id AND state = 'PENDING';
  GET DIAGNOSTICS v_rows = ROW_COUNT;
  RETURN v_rows = 1;
END;
$$;

REVOKE ALL ON FUNCTION public.attach_social_mission_link_prompt(uuid, bigint)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.attach_social_mission_link_prompt(uuid, bigint) TO service_role;
GRANT EXECUTE ON FUNCTION public.attach_social_mission_link_prompt(uuid, bigint) TO postgres;

-- ---------------------------------------------------------------------------
-- 12. X Link Finder — authorized START / IGNORE resolution.
--     The SAME authorization chain as `/mission`: linked CARTEL HQ user AND
--     current workspace owner/admin. The webhook additionally re-verifies live
--     Telegram administrator/creator status before calling this.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.resolve_social_mission_link_candidate(
  _candidate_id uuid,
  _telegram_user_id bigint,
  _decision text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_candidate public.social_mission_link_candidates%ROWTYPE;
  v_actor_user_id uuid;
  v_decision text := upper(btrim(coalesce(_decision, '')));
BEGIN
  IF _candidate_id IS NULL OR _telegram_user_id IS NULL
     OR v_decision NOT IN ('START', 'IGNORE') THEN
    RETURN jsonb_build_object('outcome', 'REJECTED', 'reason', 'invalid_arguments');
  END IF;

  SELECT * INTO v_candidate
    FROM public.social_mission_link_candidates
   WHERE id = _candidate_id
   FOR UPDATE;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('outcome', 'REJECTED', 'reason', 'candidate_not_found');
  END IF;

  IF v_candidate.state <> 'PENDING' THEN
    RETURN jsonb_build_object('outcome', 'ALREADY_RESOLVED', 'state', v_candidate.state);
  END IF;

  IF v_candidate.expires_at <= now() THEN
    UPDATE public.social_mission_link_candidates
       SET state = 'EXPIRED', resolved_at = now()
     WHERE id = _candidate_id AND state = 'PENDING';
    RETURN jsonb_build_object('outcome', 'EXPIRED');
  END IF;

  SELECT tc.user_id INTO v_actor_user_id
    FROM public.telegram_connections tc
   WHERE tc.telegram_user_id = _telegram_user_id
   LIMIT 1;
  IF v_actor_user_id IS NULL THEN
    RETURN jsonb_build_object('outcome', 'REJECTED', 'reason', 'actor_not_linked');
  END IF;

  IF NOT public.is_workspace_operator(v_candidate.workspace_id, v_actor_user_id) THEN
    RETURN jsonb_build_object('outcome', 'REJECTED', 'reason', 'actor_not_operator');
  END IF;

  UPDATE public.social_mission_link_candidates
     SET state = CASE WHEN v_decision = 'START' THEN 'STARTED' ELSE 'IGNORED' END,
         resolved_at = now(),
         resolved_by = v_actor_user_id
   WHERE id = _candidate_id AND state = 'PENDING';

  RETURN jsonb_build_object(
    'outcome', v_decision,
    'candidate_id', _candidate_id,
    'workspace_id', v_candidate.workspace_id,
    'actor_user_id', v_actor_user_id,
    'telegram_chat_id', v_candidate.telegram_chat_id,
    'telegram_message_id', v_candidate.telegram_message_id,
    'prompt_message_id', v_candidate.prompt_message_id,
    'canonical_url', v_candidate.canonical_url,
    'external_post_id', v_candidate.external_post_id,
    'author_handle', v_candidate.author_handle
  );
END;
$$;

REVOKE ALL ON FUNCTION public.resolve_social_mission_link_candidate(uuid, bigint, text)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.resolve_social_mission_link_candidate(uuid, bigint, text) TO service_role;
GRANT EXECUTE ON FUNCTION public.resolve_social_mission_link_candidate(uuid, bigint, text) TO postgres;

-- ---------------------------------------------------------------------------
-- 13. create_social_mission_from_telegram_link — source provenance + effective
--     config snapshot. The old signature is replaced; the added parameters are
--     DEFAULTed so the existing webhook call shape keeps working unchanged.
--     Old missions are never backfilled.
-- ---------------------------------------------------------------------------
DROP FUNCTION IF EXISTS public.create_social_mission_from_telegram_link(
  bigint, bigint, bigint, bigint, text, text, text
);

CREATE OR REPLACE FUNCTION public.create_social_mission_from_telegram_link(
  _telegram_update_id bigint,
  _telegram_chat_id bigint,
  _telegram_message_id bigint,
  _telegram_user_id bigint,
  _canonical_url text,
  _external_post_id text,
  _author_handle text,
  _source text DEFAULT 'telegram_mission_command'
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_claimed boolean := false;
  v_claim_rows integer := 0;
  v_workspace_id uuid;
  v_connection_id uuid;
  v_actor_user_id uuid;
  v_official_handle text;
  v_x_url text;
  v_post_id uuid;
  v_mission_id uuid;
  v_target_id uuid;
  v_delivery_state text;
  v_existing_update_chat bigint;
  v_existing_update_user bigint;
  v_settings public.social_mission_settings%ROWTYPE;
  v_config jsonb;
  v_handle text := lower(btrim(coalesce(_author_handle, '')));
  v_url text := btrim(coalesce(_canonical_url, ''));
  v_post_external text := btrim(coalesce(_external_post_id, ''));
  v_source text := CASE
    WHEN lower(btrim(coalesce(_source, ''))) = 'telegram_link_finder' THEN 'telegram_link_finder'
    ELSE 'telegram_mission_command'
  END;
BEGIN
  -- 1. Structural validation. Nothing here touches the network.
  IF _telegram_update_id IS NULL OR _telegram_chat_id IS NULL
     OR _telegram_message_id IS NULL OR _telegram_user_id IS NULL THEN
    RETURN jsonb_build_object('outcome', 'REJECTED', 'reason', 'invalid_telegram_identifiers');
  END IF;

  IF v_post_external !~ '^[0-9]{1,32}$' THEN
    RETURN jsonb_build_object('outcome', 'REJECTED', 'reason', 'invalid_post_id');
  END IF;

  IF v_handle !~ '^[a-z0-9_]{1,15}$' THEN
    RETURN jsonb_build_object('outcome', 'REJECTED', 'reason', 'invalid_handle');
  END IF;

  IF v_url <> ('https://x.com/' || v_handle || '/status/' || v_post_external)
     OR char_length(v_url) > 2048 THEN
    RETURN jsonb_build_object('outcome', 'REJECTED', 'reason', 'invalid_canonical_url');
  END IF;

  -- 2. Atomic command-idempotency claim on the Telegram update id.
  INSERT INTO public.telegram_inbound_updates (
    telegram_update_id, update_kind, telegram_chat_id, telegram_message_id, telegram_user_id, status
  )
  VALUES (
    _telegram_update_id, 'MESSAGE', _telegram_chat_id, _telegram_message_id, _telegram_user_id, 'RECEIVED'
  )
  ON CONFLICT (telegram_update_id) DO NOTHING;

  GET DIAGNOSTICS v_claim_rows = ROW_COUNT;
  v_claimed := v_claim_rows = 1;

  IF NOT v_claimed THEN
    SELECT tiu.telegram_chat_id, tiu.telegram_user_id
      INTO v_existing_update_chat, v_existing_update_user
      FROM public.telegram_inbound_updates tiu
     WHERE tiu.telegram_update_id = _telegram_update_id;

    IF v_existing_update_chat IS DISTINCT FROM _telegram_chat_id
       OR v_existing_update_user IS DISTINCT FROM _telegram_user_id THEN
      RETURN jsonb_build_object('outcome', 'DUPLICATE_UPDATE', 'reason', 'provenance_mismatch');
    END IF;

    SELECT m.id, t.id, t.delivery_state, m.workspace_id
      INTO v_mission_id, v_target_id, v_delivery_state, v_workspace_id
      FROM public.social_missions m
      JOIN public.social_mission_targets t
        ON t.mission_id = m.id AND t.workspace_id = m.workspace_id
     WHERE t.telegram_chat_id = _telegram_chat_id
       AND m.metadata ->> 'telegram_update_id' = _telegram_update_id::text
     LIMIT 1;

    IF v_mission_id IS NULL THEN
      RETURN jsonb_build_object('outcome', 'DUPLICATE_UPDATE', 'reason', 'already_claimed');
    END IF;

    RETURN jsonb_build_object(
      'outcome', 'EXISTING',
      'reason', 'duplicate_update',
      'workspace_id', v_workspace_id,
      'mission_id', v_mission_id,
      'target_id', v_target_id,
      'delivery_state', v_delivery_state
    );
  END IF;

  -- 3. Exact Telegram group binding -> one workspace.
  SELECT gc.id, gc.workspace_id
    INTO v_connection_id, v_workspace_id
    FROM public.telegram_group_connections gc
   WHERE gc.telegram_chat_id = _telegram_chat_id
   LIMIT 1;

  IF v_connection_id IS NULL THEN
    UPDATE public.telegram_inbound_updates
       SET status = 'IGNORED', processed_at = now(), updated_at = now()
     WHERE telegram_update_id = _telegram_update_id;
    RETURN jsonb_build_object('outcome', 'REJECTED', 'reason', 'group_not_connected');
  END IF;

  -- 4. Linked application user.
  SELECT tc.user_id INTO v_actor_user_id
    FROM public.telegram_connections tc
   WHERE tc.telegram_user_id = _telegram_user_id
   LIMIT 1;

  IF v_actor_user_id IS NULL THEN
    UPDATE public.telegram_inbound_updates
       SET status = 'IGNORED', processed_at = now(), updated_at = now()
     WHERE telegram_update_id = _telegram_update_id;
    RETURN jsonb_build_object('outcome', 'REJECTED', 'reason', 'actor_not_linked');
  END IF;

  -- 5. Re-authorize CURRENT workspace owner/admin inside the RPC.
  IF NOT public.is_workspace_operator(v_workspace_id, v_actor_user_id) THEN
    UPDATE public.telegram_inbound_updates
       SET status = 'IGNORED', processed_at = now(), updated_at = now()
     WHERE telegram_update_id = _telegram_update_id;
    RETURN jsonb_build_object('outcome', 'REJECTED', 'reason', 'actor_not_operator');
  END IF;

  -- 6. Independent server-side official-handle verification.
  SELECT pp.x_url INTO v_x_url
    FROM public.project_profiles pp
   WHERE pp.workspace_id = v_workspace_id
   LIMIT 1;

  v_official_handle := lower(
    (regexp_match(
      coalesce(v_x_url, ''),
      '^https?://(?:www\.|mobile\.)?(?:x|twitter)\.com/@?([A-Za-z0-9_]{1,15})(?:[/?#].*)?$'
    ))[1]
  );

  IF v_official_handle IS NULL THEN
    UPDATE public.telegram_inbound_updates
       SET status = 'IGNORED', processed_at = now(), updated_at = now()
     WHERE telegram_update_id = _telegram_update_id;
    RETURN jsonb_build_object('outcome', 'REJECTED', 'reason', 'official_x_account_missing');
  END IF;

  IF v_official_handle <> v_handle THEN
    UPDATE public.telegram_inbound_updates
       SET status = 'IGNORED', processed_at = now(), updated_at = now()
     WHERE telegram_update_id = _telegram_update_id;
    RETURN jsonb_build_object('outcome', 'REJECTED', 'reason', 'handle_not_official');
  END IF;

  -- 7. Get-or-create the social post. An existing row is PRESERVED as-is.
  INSERT INTO public.social_posts (
    workspace_id, platform, external_post_id, canonical_url, author_handle, content_text, metadata
  )
  VALUES (
    v_workspace_id, 'x', v_post_external, v_url, v_handle, NULL,
    jsonb_build_object('source', v_source)
  )
  ON CONFLICT (workspace_id, platform, external_post_id) DO NOTHING;

  SELECT sp.id INTO v_post_id
    FROM public.social_posts sp
   WHERE sp.workspace_id = v_workspace_id
     AND sp.platform = 'x'
     AND sp.external_post_id = v_post_external;

  IF v_post_id IS NULL THEN
    UPDATE public.telegram_inbound_updates
       SET status = 'FAILED', last_error = 'social post unresolved', updated_at = now()
     WHERE telegram_update_id = _telegram_update_id;
    RETURN jsonb_build_object('outcome', 'UNRESOLVED', 'reason', 'post_unresolved');
  END IF;

  -- 8. One post + one community = one mission. Never duplicate.
  SELECT m.id, t.id, t.delivery_state
    INTO v_mission_id, v_target_id, v_delivery_state
    FROM public.social_missions m
    JOIN public.social_mission_targets t
      ON t.mission_id = m.id AND t.workspace_id = m.workspace_id
   WHERE m.workspace_id = v_workspace_id
     AND m.social_post_id = v_post_id
     AND t.telegram_chat_id = _telegram_chat_id
   ORDER BY m.created_at DESC
   LIMIT 1;

  IF v_mission_id IS NOT NULL THEN
    UPDATE public.telegram_inbound_updates
       SET status = 'PROCESSED', processed_at = now(), updated_at = now()
     WHERE telegram_update_id = _telegram_update_id;
    RETURN jsonb_build_object(
      'outcome', 'EXISTING',
      'reason', 'mission_already_exists',
      'actor_user_id', v_actor_user_id,
      'workspace_id', v_workspace_id,
      'mission_id', v_mission_id,
      'target_id', v_target_id,
      'delivery_state', v_delivery_state
    );
  END IF;

  -- 9. Snapshot the EFFECTIVE configuration into the mission, so a later
  --    settings change can never mutate a mission that is already live.
  SELECT * INTO v_settings
    FROM public.social_mission_settings
   WHERE workspace_id = v_workspace_id;

  v_config := public.social_mission_preset_config(COALESCE(v_settings.default_preset, 'STANDARD'))
    || jsonb_build_object(
         'live_metrics_enabled', COALESCE(v_settings.live_metrics_enabled, true),
         'auto_pin_mission', COALESCE(v_settings.auto_pin_mission, true),
         'delete_command_after_send', COALESCE(v_settings.delete_command_after_send, true),
         'milestone_type', COALESCE(v_settings.milestone_type, 'NONE'),
         'milestone_target', v_settings.milestone_target
       );

  -- 10. Create exactly one LIVE mission and one PENDING target.
  --     Baseline metrics stay NULL here: the launch metrics read happens in the
  --     transport path and is fail-soft.
  INSERT INTO public.social_missions (
    workspace_id, social_post_id, status, started_at, created_by, metadata
  )
  VALUES (
    v_workspace_id, v_post_id, 'LIVE', now(), v_actor_user_id,
    jsonb_build_object(
      'source', v_source,
      'telegram_update_id', _telegram_update_id,
      'telegram_chat_id', _telegram_chat_id,
      'telegram_message_id', _telegram_message_id,
      'telegram_user_id', _telegram_user_id,
      'effective_config', v_config
    )
  )
  RETURNING id INTO v_mission_id;

  INSERT INTO public.social_mission_targets (
    workspace_id, mission_id, group_connection_id, telegram_chat_id, delivery_state, command_message_id
  )
  VALUES (
    v_workspace_id, v_mission_id, v_connection_id, _telegram_chat_id, 'PENDING',
    CASE WHEN v_source = 'telegram_mission_command' THEN _telegram_message_id ELSE NULL END
  )
  RETURNING id, delivery_state INTO v_target_id, v_delivery_state;

  UPDATE public.telegram_inbound_updates
     SET status = 'PROCESSED', processed_at = now(), updated_at = now()
   WHERE telegram_update_id = _telegram_update_id;

  RETURN jsonb_build_object(
    'outcome', 'CREATED',
    'reason', 'created',
    'source', v_source,
    'actor_user_id', v_actor_user_id,
    'workspace_id', v_workspace_id,
    'mission_id', v_mission_id,
    'target_id', v_target_id,
    'delivery_state', v_delivery_state,
    'effective_config', v_config
  );
END;
$$;

REVOKE ALL ON FUNCTION public.create_social_mission_from_telegram_link(
  bigint, bigint, bigint, bigint, text, text, text, text
) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.create_social_mission_from_telegram_link(
  bigint, bigint, bigint, bigint, text, text, text, text
) TO service_role;
GRANT EXECUTE ON FUNCTION public.create_social_mission_from_telegram_link(
  bigint, bigint, bigint, bigint, text, text, text, text
) TO postgres;

COMMIT;
