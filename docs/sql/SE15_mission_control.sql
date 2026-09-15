-- ============================================================================
-- SE-15 — TELEGRAM MISSION CONTROL
--
-- PREPARED ONLY. Lovable does NOT apply this migration. It is reviewed and
-- applied externally against the authoritative Supabase project
-- `ocoinbnjgstkmnwwvnhi`.
--
-- INVARIANTS THIS MIGRATION PRESERVES
--   * `social_missions.metadata -> 'effective_config'` is IMMUTABLE FOREVER.
--     Nothing here writes, merges into, or deletes that key. Mission Control
--     stores its overrides in a SEPARATE `metadata -> 'mission_control'`
--     object and a resolver folds it OVER the frozen config at read time.
--   * No new table. Session state reuses `telegram_team_sessions`; override
--     state and audit history ride in the existing `social_missions.metadata`
--     jsonb column.
--   * Every mutating function is SECURITY DEFINER with an explicit
--     `search_path`, REVOKEd from PUBLIC/anon/authenticated and GRANTed only to
--     service_role and postgres. The browser has no write path.
--   * Authorization is never inferred from session state, callback data or a
--     client-supplied workspace id. The caller (the Telegram webhook) must have
--     ALREADY performed a LIVE `getChatMember` administrator/creator check and
--     passes the verified chat id; every function re-binds
--     mission -> workspace -> target -> verified chat server-side.
--   * Idempotency: every mutation carries a caller-derived key. A replay
--     returns the recorded outcome and never appends duplicate history.
--   * SENT schedule history is never mutated. A CLAIMED event at race time
--     yields a typed conflict instead of duplicate work.
-- ============================================================================

BEGIN;

-- ----------------------------------------------------------------------------
-- 1. SESSION STATE — extend the existing bot console session table.
--    telegram_team_sessions stays CONVENIENCE STATE ONLY and is never an
--    authorization source. INBOX / REPLY behaviour is untouched.
-- ----------------------------------------------------------------------------

ALTER TABLE public.telegram_team_sessions
  ADD COLUMN IF NOT EXISTS active_mission_id uuid
    REFERENCES public.social_missions(id) ON DELETE SET NULL;

ALTER TABLE public.telegram_team_sessions
  ADD COLUMN IF NOT EXISTS pending_control_field text;

ALTER TABLE public.telegram_team_sessions
  DROP CONSTRAINT IF EXISTS telegram_team_sessions_mode_chk;

ALTER TABLE public.telegram_team_sessions
  ADD CONSTRAINT telegram_team_sessions_mode_chk
  CHECK (mode = ANY (ARRAY['NONE', 'INBOX', 'REPLY', 'MISSION_CONTROL']));

ALTER TABLE public.telegram_team_sessions
  DROP CONSTRAINT IF EXISTS telegram_team_sessions_pending_field_chk;

ALTER TABLE public.telegram_team_sessions
  ADD CONSTRAINT telegram_team_sessions_pending_field_chk
  CHECK (
    pending_control_field IS NULL
    OR pending_control_field = ANY (ARRAY[
      'PRIMARY_TARGET', 'VIEWS', 'LIKES', 'REPLIES', 'REPOSTS', 'BOOKMARKS',
      'DURATION_MINUTES'
    ])
  );

-- ----------------------------------------------------------------------------
-- 2. RESOLVED CONFIG READER
--    resolved = immutable effective_config, with the ACTIVE Mission Control
--    override merged over it when mode = 'MANUAL'. A mission with no
--    mission_control state behaves EXACTLY as it does today.
-- ----------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.social_mission_resolve_config(
  _metadata jsonb
) RETURNS jsonb
LANGUAGE sql
IMMUTABLE
AS $$
  SELECT CASE
    WHEN coalesce(_metadata -> 'mission_control' ->> 'mode', 'AUTO') = 'MANUAL'
         AND jsonb_typeof(_metadata -> 'mission_control' -> 'override_config') = 'object'
      THEN coalesce(_metadata -> 'effective_config', '{}'::jsonb)
           || (_metadata -> 'mission_control' -> 'override_config')
    ELSE coalesce(_metadata -> 'effective_config', '{}'::jsonb)
  END;
$$;

CREATE OR REPLACE FUNCTION public.social_mission_effective_config_resolved(
  _mission_id uuid
) RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_meta jsonb;
BEGIN
  IF _mission_id IS NULL THEN RETURN NULL; END IF;
  SELECT m.metadata INTO v_meta FROM public.social_missions m WHERE m.id = _mission_id;
  IF v_meta IS NULL THEN
    -- Preserve the existing fallback contract of social_mission_effective_config.
    RETURN public.social_mission_effective_config(_mission_id);
  END IF;
  IF (v_meta -> 'effective_config') IS NULL THEN
    RETURN public.social_mission_effective_config(_mission_id);
  END IF;
  RETURN public.social_mission_resolve_config(v_meta);
END;
$$;

REVOKE ALL ON FUNCTION public.social_mission_resolve_config(jsonb) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.social_mission_effective_config_resolved(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.social_mission_resolve_config(jsonb) TO service_role, postgres;
GRANT EXECUTE ON FUNCTION public.social_mission_effective_config_resolved(uuid) TO service_role, postgres;

-- ----------------------------------------------------------------------------
-- 3. SHARED AUTHORIZATION BINDING
--    Gate 1 (linked Telegram user) and gate 2 (workspace owner/admin) are
--    enforced here. Gate 3 (LIVE Telegram administrator/creator) is performed
--    by the caller and proven by `_verified_chat_id`, which MUST equal the
--    mission target's own Telegram chat.
-- ----------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.social_mission_control_authorize(
  _telegram_user_id bigint,
  _mission_id uuid,
  _verified_chat_id bigint
) RETURNS TABLE(outcome text, workspace_id uuid, actor_user_id uuid, target_id uuid, mission_status text)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_uid uuid;
  v_ws uuid;
  v_status text;
  v_target uuid;
BEGIN
  IF _telegram_user_id IS NULL OR _telegram_user_id <= 0 OR _mission_id IS NULL
     OR _verified_chat_id IS NULL THEN
    RETURN QUERY SELECT 'denied'::text, NULL::uuid, NULL::uuid, NULL::uuid, NULL::text;
    RETURN;
  END IF;

  SELECT tc.user_id INTO v_uid
    FROM public.telegram_connections tc
   WHERE tc.telegram_user_id = _telegram_user_id
   LIMIT 1;
  IF v_uid IS NULL THEN
    RETURN QUERY SELECT 'not_linked'::text, NULL::uuid, NULL::uuid, NULL::uuid, NULL::text;
    RETURN;
  END IF;

  SELECT m.workspace_id, m.status INTO v_ws, v_status
    FROM public.social_missions m WHERE m.id = _mission_id;
  IF v_ws IS NULL THEN
    RETURN QUERY SELECT 'not_found'::text, NULL::uuid, NULL::uuid, NULL::uuid, NULL::text;
    RETURN;
  END IF;

  IF NOT public.is_workspace_operator(v_ws, v_uid) THEN
    RETURN QUERY SELECT 'not_operator'::text, NULL::uuid, NULL::uuid, NULL::uuid, NULL::text;
    RETURN;
  END IF;

  -- The verified chat must be THIS mission's own delivered target chat.
  SELECT t.id INTO v_target
    FROM public.social_mission_targets t
   WHERE t.mission_id = _mission_id
     AND t.workspace_id = v_ws
     AND t.telegram_chat_id = _verified_chat_id
   LIMIT 1;
  IF v_target IS NULL THEN
    RETURN QUERY SELECT 'chat_mismatch'::text, NULL::uuid, NULL::uuid, NULL::uuid, NULL::text;
    RETURN;
  END IF;

  RETURN QUERY SELECT 'ok'::text, v_ws, v_uid, v_target, v_status;
END;
$$;

REVOKE ALL ON FUNCTION public.social_mission_control_authorize(bigint, uuid, bigint) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.social_mission_control_authorize(bigint, uuid, bigint) TO service_role, postgres;

-- ----------------------------------------------------------------------------
-- 4. MISSION CONTROL STATE MERGE + AUDIT APPEND HELPER
--
--    NESTED-PATH HAZARD. `jsonb_set(metadata, '{mission_control,history}', ...)`
--    is NOT safe on a mission that has never been controlled: with a missing
--    intermediate `mission_control` object the write silently does nothing.
--    Every first-use write therefore goes through this merge helper, which
--    concatenates at the top level and re-creates the object when absent while
--    preserving every sibling key — including, always, `effective_config`.
-- ----------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.social_mission_control_merge_state(
  _mission_id uuid,
  _patch jsonb
) RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
BEGIN
  UPDATE public.social_missions m
     SET metadata = coalesce(m.metadata, '{}'::jsonb)
                    || jsonb_build_object(
                         'mission_control',
                         coalesce(m.metadata -> 'mission_control', '{}'::jsonb)
                         || coalesce(_patch, '{}'::jsonb)
                       ),
         updated_at = now()
   WHERE m.id = _mission_id;
END;
$$;

REVOKE ALL ON FUNCTION public.social_mission_control_merge_state(uuid, jsonb) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.social_mission_control_merge_state(uuid, jsonb) TO service_role, postgres;

CREATE OR REPLACE FUNCTION public.social_mission_control_append_history(
  _mission_id uuid,
  _action text,
  _actor_user_id uuid,
  _telegram_user_id bigint,
  _before jsonb,
  _after jsonb,
  _idempotency_key text
) RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_entry jsonb;
  v_hist jsonb;
BEGIN
  v_entry := jsonb_build_object(
    'at', to_char(now() AT TIME ZONE 'utc', 'YYYY-MM-DD"T"HH24:MI:SS"Z"'),
    'action', _action,
    'actor_user_id', _actor_user_id,
    'telegram_user_id', _telegram_user_id,
    'before', coalesce(_before, '{}'::jsonb),
    'after', coalesce(_after, '{}'::jsonb),
    'key', _idempotency_key
  );

  SELECT coalesce(m.metadata -> 'mission_control' -> 'history', '[]'::jsonb)
    INTO v_hist
    FROM public.social_missions m WHERE m.id = _mission_id;

  v_hist := coalesce(v_hist, '[]'::jsonb) || jsonb_build_array(v_entry);
  -- Bound the stored history so the mission row cannot grow without limit.
  IF jsonb_array_length(v_hist) > 50 THEN
    v_hist := (
      SELECT coalesce(jsonb_agg(e), '[]'::jsonb)
        FROM (
          SELECT e FROM jsonb_array_elements(v_hist) WITH ORDINALITY AS x(e, n)
           ORDER BY n OFFSET jsonb_array_length(v_hist) - 50
        ) s
    );
  END IF;

  -- Merge, never jsonb_set on a nested path: this is frequently the FIRST ever
  -- write to mission_control (duration-only change, END_NOW, CANCEL).
  PERFORM public.social_mission_control_merge_state(
    _mission_id, jsonb_build_object('history', v_hist));
END;
$$;

REVOKE ALL ON FUNCTION public.social_mission_control_append_history(uuid, text, uuid, bigint, jsonb, jsonb, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.social_mission_control_append_history(uuid, text, uuid, bigint, jsonb, jsonb, text) TO service_role, postgres;

CREATE OR REPLACE FUNCTION public.social_mission_control_key_used(
  _mission_id uuid,
  _idempotency_key text
) RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $$
  SELECT EXISTS (
    SELECT 1
      FROM public.social_missions m,
           LATERAL jsonb_array_elements(
             coalesce(m.metadata -> 'mission_control' -> 'history', '[]'::jsonb)
           ) e
     WHERE m.id = _mission_id
       AND e ->> 'key' = _idempotency_key
  );
$$;

REVOKE ALL ON FUNCTION public.social_mission_control_key_used(uuid, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.social_mission_control_key_used(uuid, text) TO service_role, postgres;

-- ----------------------------------------------------------------------------
-- 5. PICKERS — never leak a workspace or mission the caller cannot operate.
-- ----------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.social_mission_control_workspaces(
  _telegram_user_id bigint
) RETURNS TABLE(workspace_id uuid, workspace_name text, live_missions integer)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_uid uuid;
BEGIN
  IF _telegram_user_id IS NULL OR _telegram_user_id <= 0 THEN RETURN; END IF;
  SELECT tc.user_id INTO v_uid
    FROM public.telegram_connections tc
   WHERE tc.telegram_user_id = _telegram_user_id LIMIT 1;
  IF v_uid IS NULL THEN RETURN; END IF;

  RETURN QUERY
  SELECT w.id, w.name,
         (SELECT count(*)::integer FROM public.social_missions m
           WHERE m.workspace_id = w.id AND m.status = 'LIVE')
    FROM public.workspace_members wm
    JOIN public.workspaces w ON w.id = wm.workspace_id
   WHERE wm.user_id = v_uid
     AND wm.role IN ('owner', 'admin')
   ORDER BY w.name
   LIMIT 20;
END;
$$;

CREATE OR REPLACE FUNCTION public.social_mission_control_missions(
  _telegram_user_id bigint,
  _workspace_id uuid
) RETURNS TABLE(
  mission_id uuid,
  telegram_chat_id bigint,
  author_handle text,
  canonical_url text,
  started_at timestamptz,
  ends_at timestamptz,
  control_mode text
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_uid uuid;
BEGIN
  IF _telegram_user_id IS NULL OR _workspace_id IS NULL THEN RETURN; END IF;
  SELECT tc.user_id INTO v_uid
    FROM public.telegram_connections tc
   WHERE tc.telegram_user_id = _telegram_user_id LIMIT 1;
  IF v_uid IS NULL THEN RETURN; END IF;
  IF NOT public.is_workspace_operator(_workspace_id, v_uid) THEN RETURN; END IF;

  RETURN QUERY
  SELECT m.id,
         t.telegram_chat_id,
         p.author_handle,
         p.canonical_url,
         m.started_at,
         m.ends_at,
         coalesce(m.metadata -> 'mission_control' ->> 'mode', 'AUTO')
    FROM public.social_missions m
    JOIN public.social_mission_targets t
      ON t.mission_id = m.id AND t.workspace_id = m.workspace_id
    LEFT JOIN public.social_posts p ON p.id = m.social_post_id
   WHERE m.workspace_id = _workspace_id
     AND m.status = 'LIVE'
   ORDER BY m.started_at DESC NULLS LAST
   LIMIT 10;
END;
$$;

CREATE OR REPLACE FUNCTION public.social_mission_control_panel(
  _telegram_user_id bigint,
  _mission_id uuid,
  _verified_chat_id bigint
) RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_auth record;
  v_m record;
  v_post record;
BEGIN
  SELECT * INTO v_auth
    FROM public.social_mission_control_authorize(_telegram_user_id, _mission_id, _verified_chat_id);
  IF v_auth.outcome <> 'ok' THEN
    RETURN jsonb_build_object('outcome', v_auth.outcome);
  END IF;

  SELECT * INTO v_m FROM public.social_missions WHERE id = _mission_id;
  SELECT * INTO v_post FROM public.social_posts WHERE id = v_m.social_post_id;

  RETURN jsonb_build_object(
    'outcome', 'ok',
    'mission_id', _mission_id,
    'workspace_id', v_auth.workspace_id,
    'target_id', v_auth.target_id,
    'status', v_m.status,
    'started_at', v_m.started_at,
    'ends_at', v_m.ends_at,
    'author_handle', v_post.author_handle,
    'canonical_url', v_post.canonical_url,
    'control_mode', coalesce(v_m.metadata -> 'mission_control' ->> 'mode', 'AUTO'),
    'resolved_config', public.social_mission_resolve_config(v_m.metadata),
    'history_count', jsonb_array_length(
      coalesce(v_m.metadata -> 'mission_control' -> 'history', '[]'::jsonb)
    )
  );
END;
$$;

REVOKE ALL ON FUNCTION public.social_mission_control_workspaces(bigint) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.social_mission_control_missions(bigint, uuid) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.social_mission_control_panel(bigint, uuid, bigint) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.social_mission_control_workspaces(bigint) TO service_role, postgres;
GRANT EXECUTE ON FUNCTION public.social_mission_control_missions(bigint, uuid) TO service_role, postgres;
GRANT EXECUTE ON FUNCTION public.social_mission_control_panel(bigint, uuid, bigint) TO service_role, postgres;

-- ----------------------------------------------------------------------------
-- 6. SESSION SETTER for the Mission Control DM console.
--    Convenience state only. Never consulted for authorization.
-- ----------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.social_mission_control_set_session(
  _telegram_user_id bigint,
  _workspace_id uuid DEFAULT NULL,
  _mission_id uuid DEFAULT NULL,
  _pending_field text DEFAULT NULL,
  _clear boolean DEFAULT false
) RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_uid uuid;
BEGIN
  IF _telegram_user_id IS NULL OR _telegram_user_id <= 0 THEN RETURN 'denied'; END IF;
  SELECT tc.user_id INTO v_uid FROM public.telegram_connections tc
   WHERE tc.telegram_user_id = _telegram_user_id LIMIT 1;
  IF v_uid IS NULL THEN RETURN 'denied'; END IF;

  IF _clear THEN
    DELETE FROM public.telegram_team_sessions s WHERE s.telegram_user_id = _telegram_user_id;
    RETURN 'ok';
  END IF;

  IF _workspace_id IS NOT NULL AND NOT public.is_workspace_operator(_workspace_id, v_uid) THEN
    RETURN 'denied';
  END IF;

  INSERT INTO public.telegram_team_sessions
    (telegram_user_id, selected_workspace_id, active_conversation_id, active_mission_id,
     pending_control_field, mode, expires_at, updated_at)
  VALUES
    (_telegram_user_id, _workspace_id, NULL, _mission_id, _pending_field,
     'MISSION_CONTROL', now() + interval '30 minutes', now())
  ON CONFLICT (telegram_user_id) DO UPDATE
     SET selected_workspace_id = EXCLUDED.selected_workspace_id,
         active_conversation_id = NULL,
         active_mission_id = EXCLUDED.active_mission_id,
         pending_control_field = EXCLUDED.pending_control_field,
         mode = 'MISSION_CONTROL',
         expires_at = EXCLUDED.expires_at,
         updated_at = now();
  RETURN 'ok';
END;
$$;

CREATE OR REPLACE FUNCTION public.social_mission_control_active_session(
  _telegram_user_id bigint
) RETURNS TABLE(workspace_id uuid, mission_id uuid, pending_control_field text)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $$
  SELECT s.selected_workspace_id, s.active_mission_id, s.pending_control_field
    FROM public.telegram_team_sessions s
   WHERE s.telegram_user_id = _telegram_user_id
     AND s.mode = 'MISSION_CONTROL'
     AND s.expires_at > now()
   LIMIT 1;
$$;

REVOKE ALL ON FUNCTION public.social_mission_control_set_session(bigint, uuid, uuid, text, boolean) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.social_mission_control_active_session(bigint) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.social_mission_control_set_session(bigint, uuid, uuid, text, boolean) TO service_role, postgres;
GRANT EXECUTE ON FUNCTION public.social_mission_control_active_session(bigint) TO service_role, postgres;

-- ----------------------------------------------------------------------------
-- 7. TARGET OVERRIDE / RESET TO AUTO
--    Writes ONLY metadata.mission_control. effective_config is never touched.
--    MANUAL mode never carries a stale AUTO stretch goal: stretch_goal_target
--    is explicitly null in V1.
-- ----------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.social_mission_apply_target_override(
  _telegram_user_id bigint,
  _mission_id uuid,
  _verified_chat_id bigint,
  _mode text,
  _primary_type text,
  _primary_target bigint,
  _views bigint,
  _likes bigint,
  _replies bigint,
  _reposts bigint,
  _bookmarks bigint,
  _idempotency_key text
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_auth record;
  v_status text;
  v_before jsonb;
  v_targets jsonb := '{}'::jsonb;
  v_override jsonb;
  v_mode text := upper(coalesce(_mode, ''));
  v_type text := upper(coalesce(_primary_type, 'NONE'));
BEGIN
  IF _idempotency_key IS NULL OR length(_idempotency_key) < 8 THEN
    RETURN jsonb_build_object('outcome', 'denied');
  END IF;

  SELECT * INTO v_auth
    FROM public.social_mission_control_authorize(_telegram_user_id, _mission_id, _verified_chat_id);
  IF v_auth.outcome <> 'ok' THEN
    RETURN jsonb_build_object('outcome', v_auth.outcome);
  END IF;

  -- LOCK FIRST. Status and the idempotency key are only authoritative under the
  -- row lock, so a concurrent replay cannot append a second history entry.
  SELECT m.status INTO v_status
    FROM public.social_missions m WHERE m.id = _mission_id FOR UPDATE;

  IF public.social_mission_control_key_used(_mission_id, _idempotency_key) THEN
    RETURN jsonb_build_object('outcome', 'replayed', 'mission_id', _mission_id);
  END IF;
  IF v_status IS DISTINCT FROM 'LIVE' THEN
    RETURN jsonb_build_object('outcome', 'not_live', 'status', v_status);
  END IF;

  IF v_mode NOT IN ('AUTO', 'MANUAL') THEN
    RETURN jsonb_build_object('outcome', 'invalid_mode');
  END IF;

  SELECT jsonb_build_object(
           'mode', coalesce(m.metadata -> 'mission_control' ->> 'mode', 'AUTO'),
           'config', public.social_mission_resolve_config(m.metadata))
    INTO v_before
    FROM public.social_missions m WHERE m.id = _mission_id;

  IF v_mode = 'AUTO' THEN
    -- RESET TO AUTO. Works on a mission that has never been controlled; the
    -- merge helper creates mission_control and preserves any existing history.
    PERFORM public.social_mission_control_merge_state(
      _mission_id,
      jsonb_build_object('mode', 'AUTO', 'override_config', NULL));

    PERFORM public.social_mission_control_append_history(
      _mission_id, 'RESET_AUTO', v_auth.actor_user_id, _telegram_user_id,
      v_before,
      jsonb_build_object('mode', 'AUTO'),
      _idempotency_key);

    RETURN jsonb_build_object(
      'outcome', 'ok', 'mode', 'AUTO', 'mission_id', _mission_id,
      'target_id', v_auth.target_id,
      'resolved_config', public.social_mission_effective_config_resolved(_mission_id));
  END IF;

  -- MANUAL
  IF v_type NOT IN ('VIEWS', 'LIKES', 'REPLIES', 'REPOSTS', 'TOTAL_INTERACTIONS') THEN
    RETURN jsonb_build_object('outcome', 'invalid_primary_type');
  END IF;
  IF _primary_target IS NULL OR _primary_target <= 0 THEN
    RETURN jsonb_build_object('outcome', 'invalid_primary_target');
  END IF;

  IF _views     IS NOT NULL AND _views     > 0 THEN v_targets := v_targets || jsonb_build_object('views', _views); END IF;
  IF _likes     IS NOT NULL AND _likes     > 0 THEN v_targets := v_targets || jsonb_build_object('likes', _likes); END IF;
  IF _replies   IS NOT NULL AND _replies   > 0 THEN v_targets := v_targets || jsonb_build_object('replies', _replies); END IF;
  IF _reposts   IS NOT NULL AND _reposts   > 0 THEN v_targets := v_targets || jsonb_build_object('reposts', _reposts); END IF;
  IF _bookmarks IS NOT NULL AND _bookmarks > 0 THEN v_targets := v_targets || jsonb_build_object('bookmarks', _bookmarks); END IF;

  -- The Primary Goal PINS its own supporting metric when it maps to one.
  IF v_type = 'VIEWS'   THEN v_targets := v_targets || jsonb_build_object('views', _primary_target); END IF;
  IF v_type = 'LIKES'   THEN v_targets := v_targets || jsonb_build_object('likes', _primary_target); END IF;
  IF v_type = 'REPLIES' THEN v_targets := v_targets || jsonb_build_object('replies', _primary_target); END IF;
  IF v_type = 'REPOSTS' THEN v_targets := v_targets || jsonb_build_object('reposts', _primary_target); END IF;

  v_override := jsonb_build_object(
    'milestone_type', v_type,
    'milestone_target', _primary_target,
    'stretch_goal_target', NULL,
    'goal_source', 'MANUAL',
    'metric_targets', CASE WHEN v_targets = '{}'::jsonb THEN NULL ELSE v_targets END,
    'metric_targets_source', 'MANUAL'
  );

  -- First-ever MANUAL override on a mission with no mission_control object
  -- must still work: the merge helper creates it and keeps history intact.
  PERFORM public.social_mission_control_merge_state(
    _mission_id,
    jsonb_build_object('mode', 'MANUAL', 'override_config', v_override));

  PERFORM public.social_mission_control_append_history(
    _mission_id, 'SET_TARGETS', v_auth.actor_user_id, _telegram_user_id,
    v_before,
    jsonb_build_object('mode', 'MANUAL', 'config', v_override),
    _idempotency_key);

  RETURN jsonb_build_object(
    'outcome', 'ok', 'mode', 'MANUAL', 'mission_id', _mission_id,
    'target_id', v_auth.target_id,
    'resolved_config', public.social_mission_effective_config_resolved(_mission_id));
END;
$$;

REVOKE ALL ON FUNCTION public.social_mission_apply_target_override(bigint, uuid, bigint, text, text, bigint, bigint, bigint, bigint, bigint, bigint, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.social_mission_apply_target_override(bigint, uuid, bigint, text, text, bigint, bigint, bigint, bigint, bigint, bigint, text) TO service_role, postgres;

-- ----------------------------------------------------------------------------
-- 8. DURATION / END TIME CHANGE — one atomic transaction.
--    SENT history is never mutated. A CLAIMED event yields a typed conflict.
-- ----------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.social_mission_apply_duration_override(
  _telegram_user_id bigint,
  _mission_id uuid,
  _verified_chat_id bigint,
  _minutes_from_now integer,
  _idempotency_key text
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_auth record;
  v_now timestamptz := now();
  v_status text;
  v_old_end timestamptz;
  v_new_end timestamptz;
  v_before jsonb;
  v_claimed integer;
  v_pending integer;
  v_row record;
  v_i integer := 0;
  v_fraction double precision;
  v_old_window double precision;
  v_new_window double precision;
BEGIN
  IF _idempotency_key IS NULL OR length(_idempotency_key) < 8 THEN
    RETURN jsonb_build_object('outcome', 'denied');
  END IF;
  IF _minutes_from_now IS NULL OR _minutes_from_now < 1 OR _minutes_from_now > 1440 THEN
    RETURN jsonb_build_object('outcome', 'invalid_minutes');
  END IF;

  SELECT * INTO v_auth
    FROM public.social_mission_control_authorize(_telegram_user_id, _mission_id, _verified_chat_id);
  IF v_auth.outcome <> 'ok' THEN RETURN jsonb_build_object('outcome', v_auth.outcome); END IF;

  -- LOCK FIRST so a concurrent control action serializes behind us; only then
  -- are the status and the idempotency key authoritative.
  SELECT m.status, m.ends_at INTO v_status, v_old_end
    FROM public.social_missions m WHERE m.id = _mission_id FOR UPDATE;

  IF public.social_mission_control_key_used(_mission_id, _idempotency_key) THEN
    RETURN jsonb_build_object('outcome', 'replayed', 'mission_id', _mission_id);
  END IF;
  IF v_status IS DISTINCT FROM 'LIVE' THEN
    RETURN jsonb_build_object('outcome', 'not_live', 'status', v_status);
  END IF;

  SELECT count(*)::integer INTO v_claimed
    FROM public.social_mission_schedule_events e
   WHERE e.mission_id = _mission_id AND e.state = 'CLAIMED';
  IF v_claimed > 0 THEN
    RETURN jsonb_build_object('outcome', 'conflict', 'reason', 'event_claimed');
  END IF;

  v_new_end := v_now + make_interval(mins => _minutes_from_now);
  v_before := jsonb_build_object('ends_at', v_old_end);

  UPDATE public.social_missions SET ends_at = v_new_end, updated_at = now()
   WHERE id = _mission_id;

  -- The single COMPLETE event moves to the new end. SENT/FAILED rows are not
  -- touched: only a still-PENDING COMPLETE can be rescheduled.
  UPDATE public.social_mission_schedule_events e
     SET due_at = v_new_end, updated_at = now()
   WHERE e.mission_id = _mission_id
     AND e.event_type = 'COMPLETE'
     AND e.state = 'PENDING';

  SELECT count(*)::integer INTO v_pending
    FROM public.social_mission_schedule_events e
   WHERE e.mission_id = _mission_id AND e.event_type = 'PULSE' AND e.state = 'PENDING';

  -- PROPORTIONAL RESCHEDULE. Each still-PENDING pulse keeps its RELATIVE
  -- position inside the remaining window rather than being spread evenly, so a
  -- mission that was nearly over does not suddenly bunch its pulses. When the
  -- old remaining window is degenerate (already past its end, or unknown) we
  -- fall back to a deterministic even spread. Every result is strictly after
  -- now and strictly before the new COMPLETE end, and sequence_no is preserved.
  v_old_window := GREATEST(EXTRACT(EPOCH FROM (coalesce(v_old_end, v_now) - v_now)), 0);
  v_new_window := EXTRACT(EPOCH FROM (v_new_end - v_now));

  IF v_pending > 0 THEN
    FOR v_row IN
      SELECT e.id, e.due_at FROM public.social_mission_schedule_events e
       WHERE e.mission_id = _mission_id AND e.event_type = 'PULSE' AND e.state = 'PENDING'
       ORDER BY e.sequence_no
    LOOP
      v_i := v_i + 1;
      IF v_old_window > 0 THEN
        v_fraction := EXTRACT(EPOCH FROM (v_row.due_at - v_now)) / v_old_window;
      ELSE
        v_fraction := v_i::double precision / (v_pending + 1)::double precision;
      END IF;
      -- Keep it inside the open interval (now, new_end).
      v_fraction := LEAST(GREATEST(v_fraction, 0.02), 0.98);

      UPDATE public.social_mission_schedule_events
         SET due_at = v_now + make_interval(secs => v_new_window * v_fraction),
             updated_at = now()
       WHERE id = v_row.id;
    END LOOP;
  END IF;

  PERFORM public.social_mission_control_append_history(
    _mission_id, 'SET_END_TIME', v_auth.actor_user_id, _telegram_user_id,
    v_before,
    jsonb_build_object('ends_at', v_new_end, 'pulses_rescheduled', v_pending),
    _idempotency_key);

  RETURN jsonb_build_object(
    'outcome', 'ok', 'mission_id', _mission_id, 'target_id', v_auth.target_id,
    'ends_at', v_new_end, 'pulses_rescheduled', v_pending);
END;
$$;

REVOKE ALL ON FUNCTION public.social_mission_apply_duration_override(bigint, uuid, bigint, integer, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.social_mission_apply_duration_override(bigint, uuid, bigint, integer, text) TO service_role, postgres;

-- ----------------------------------------------------------------------------
-- 9. END MISSION NOW — mission-specific, DM-control-safe COMPLETE.
--    Mirrors close_social_mission_from_telegram semantics but selects by exact
--    mission id and truthfully sets ends_at = now() instead of COALESCEing an
--    old future end.
--
--    OWNERSHIP ORDER IS THE WHOLE POINT. The mission is only marked COMPLETED
--    AFTER this call has provably claimed the exact PENDING COMPLETE event for
--    this target. We never hand the webhook an event we did not claim, and we
--    never leave a COMPLETED mission whose completion edit belongs to someone
--    else. Any conflict returns BEFORE the first mutation.
-- ----------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.end_social_mission_from_control(
  _telegram_user_id bigint,
  _mission_id uuid,
  _verified_chat_id bigint,
  _idempotency_key text
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_auth record;
  v_now timestamptz := now();
  v_status text;
  v_event_id uuid;
  v_event_state text;
  v_claimed_id uuid;
  v_request text;
  v_pinned boolean;
  v_message_id bigint;
  v_other_claimed integer;
BEGIN
  IF _idempotency_key IS NULL OR length(_idempotency_key) < 8 THEN
    RETURN jsonb_build_object('outcome', 'denied');
  END IF;

  SELECT * INTO v_auth
    FROM public.social_mission_control_authorize(_telegram_user_id, _mission_id, _verified_chat_id);
  IF v_auth.outcome <> 'ok' THEN RETURN jsonb_build_object('outcome', v_auth.outcome); END IF;

  -- LOCK FIRST. Status and the idempotency key are only trustworthy under the
  -- row lock; a concurrent replay serializes behind this and then observes the
  -- key already recorded.
  SELECT m.status INTO v_status
    FROM public.social_missions m WHERE m.id = _mission_id FOR UPDATE;

  IF public.social_mission_control_key_used(_mission_id, _idempotency_key) THEN
    RETURN jsonb_build_object('outcome', 'replayed', 'mission_id', _mission_id);
  END IF;
  IF v_status IS DISTINCT FROM 'LIVE' THEN
    RETURN jsonb_build_object('outcome', 'not_live', 'status', v_status);
  END IF;

  -- Any CLAIMED event anywhere on this mission means the runner/transport is
  -- mid-flight. Refuse and mutate nothing.
  SELECT count(*)::integer INTO v_other_claimed
    FROM public.social_mission_schedule_events e
   WHERE e.mission_id = _mission_id AND e.state = 'CLAIMED';
  IF v_other_claimed > 0 THEN
    RETURN jsonb_build_object('outcome', 'conflict', 'reason', 'event_claimed');
  END IF;

  -- The exact COMPLETE event for THIS target, locked. A SENT/FAILED/AMBIGUOUS/
  -- CANCELLED completion is never reused.
  SELECT e.id, e.state, e.client_request_id
    INTO v_event_id, v_event_state, v_request
    FROM public.social_mission_schedule_events e
   WHERE e.mission_id = _mission_id AND e.target_id = v_auth.target_id
     AND e.event_type = 'COMPLETE'
   ORDER BY e.created_at
   LIMIT 1
     FOR UPDATE;

  IF v_event_id IS NOT NULL AND v_event_state IS DISTINCT FROM 'PENDING' THEN
    RETURN jsonb_build_object(
      'outcome', 'conflict', 'reason', 'complete_event_not_pending',
      'event_state', v_event_state);
  END IF;

  IF v_event_id IS NULL THEN
    INSERT INTO public.social_mission_schedule_events
      (workspace_id, mission_id, target_id, event_type, sequence_no, due_at, state, client_request_id)
    VALUES
      (v_auth.workspace_id, _mission_id, v_auth.target_id, 'COMPLETE', 1, v_now, 'PENDING',
       gen_random_uuid())
    RETURNING id, client_request_id INTO v_event_id, v_request;
  END IF;

  -- Prove ownership BEFORE the mission status changes.
  UPDATE public.social_mission_schedule_events
     SET state = 'CLAIMED', claimed_at = v_now, due_at = least(due_at, v_now), updated_at = now()
   WHERE id = v_event_id AND state = 'PENDING'
   RETURNING id, client_request_id INTO v_claimed_id, v_request;

  IF v_claimed_id IS NULL THEN
    RETURN jsonb_build_object('outcome', 'conflict', 'reason', 'complete_event_not_claimed');
  END IF;

  -- Ownership proven. Only now does the mission itself change.
  UPDATE public.social_missions
     SET status = 'COMPLETED', completed_at = v_now, ends_at = v_now, updated_at = now()
   WHERE id = _mission_id AND status = 'LIVE';
  IF NOT FOUND THEN
    -- Cannot normally happen under the lock. Fail loudly so the transaction
    -- rolls back rather than leaving a claimed event on a LIVE mission.
    RAISE EXCEPTION 'SE-15 end_now lost the LIVE mission under lock: %', _mission_id;
  END IF;

  -- Pending pulses stop. SENT history is untouched.
  UPDATE public.social_mission_schedule_events
     SET state = 'CANCELLED', finished_at = v_now, updated_at = now()
   WHERE mission_id = _mission_id AND event_type = 'PULSE' AND state = 'PENDING';

  SELECT t.pinned_by_hq, t.telegram_message_id INTO v_pinned, v_message_id
    FROM public.social_mission_targets t WHERE t.id = v_auth.target_id;

  PERFORM public.social_mission_control_append_history(
    _mission_id, 'END_NOW', v_auth.actor_user_id, _telegram_user_id,
    jsonb_build_object('status', 'LIVE'),
    jsonb_build_object('status', 'COMPLETED', 'ends_at', v_now),
    _idempotency_key);

  RETURN jsonb_build_object(
    'outcome', 'ok', 'mission_id', _mission_id, 'target_id', v_auth.target_id,
    'workspace_id', v_auth.workspace_id, 'schedule_event_id', v_claimed_id,
    'event_owned', true,
    'client_request_id', v_request, 'pinned_by_hq', coalesce(v_pinned, false),
    'telegram_message_id', v_message_id);
END;
$$;

REVOKE ALL ON FUNCTION public.end_social_mission_from_control(bigint, uuid, bigint, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.end_social_mission_from_control(bigint, uuid, bigint, text) TO service_role, postgres;

-- ----------------------------------------------------------------------------
-- 10. CANCEL MISSION — no completion claim, no provider read.
--     A replay is "already applied", never an error and never a second edit.
-- ----------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.cancel_social_mission_from_control(
  _telegram_user_id bigint,
  _mission_id uuid,
  _verified_chat_id bigint,
  _idempotency_key text
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_auth record;
  v_now timestamptz := now();
  v_status text;
  v_claimed integer;
  v_pinned boolean;
  v_message_id bigint;
  v_started timestamptz;
BEGIN
  IF _idempotency_key IS NULL OR length(_idempotency_key) < 8 THEN
    RETURN jsonb_build_object('outcome', 'denied');
  END IF;

  SELECT * INTO v_auth
    FROM public.social_mission_control_authorize(_telegram_user_id, _mission_id, _verified_chat_id);
  IF v_auth.outcome <> 'ok' THEN RETURN jsonb_build_object('outcome', v_auth.outcome); END IF;

  -- LOCK FIRST, then key, then status.
  SELECT m.status, m.started_at INTO v_status, v_started
    FROM public.social_missions m WHERE m.id = _mission_id FOR UPDATE;

  IF public.social_mission_control_key_used(_mission_id, _idempotency_key) THEN
    RETURN jsonb_build_object('outcome', 'replayed', 'mission_id', _mission_id);
  END IF;
  IF v_status IS DISTINCT FROM 'LIVE' THEN
    RETURN jsonb_build_object('outcome', 'not_live', 'status', v_status);
  END IF;

  SELECT count(*)::integer INTO v_claimed
    FROM public.social_mission_schedule_events e
   WHERE e.mission_id = _mission_id AND e.state = 'CLAIMED';
  IF v_claimed > 0 THEN
    RETURN jsonb_build_object('outcome', 'conflict', 'reason', 'event_claimed');
  END IF;

  UPDATE public.social_missions
     SET status = 'CANCELLED',
         ends_at = greatest(coalesce(v_started, v_now), v_now),
         updated_at = now()
   WHERE id = _mission_id AND status = 'LIVE';
  IF NOT FOUND THEN
    RETURN jsonb_build_object('outcome', 'not_live');
  END IF;

  -- Every remaining PENDING event stops. SENT history is preserved verbatim.
  UPDATE public.social_mission_schedule_events
     SET state = 'CANCELLED', finished_at = v_now, updated_at = now()
   WHERE mission_id = _mission_id AND state = 'PENDING';

  SELECT t.pinned_by_hq, t.telegram_message_id INTO v_pinned, v_message_id
    FROM public.social_mission_targets t WHERE t.id = v_auth.target_id;

  PERFORM public.social_mission_control_append_history(
    _mission_id, 'CANCEL', v_auth.actor_user_id, _telegram_user_id,
    jsonb_build_object('status', 'LIVE'),
    jsonb_build_object('status', 'CANCELLED'),
    _idempotency_key);

  RETURN jsonb_build_object(
    'outcome', 'ok', 'mission_id', _mission_id, 'target_id', v_auth.target_id,
    'workspace_id', v_auth.workspace_id, 'pinned_by_hq', coalesce(v_pinned, false),
    'telegram_message_id', v_message_id);
END;
$$;

REVOKE ALL ON FUNCTION public.cancel_social_mission_from_control(bigint, uuid, bigint, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.cancel_social_mission_from_control(bigint, uuid, bigint, text) TO service_role, postgres;

COMMIT;

-- ============================================================================
-- NOT INCLUDED, DELIBERATELY
--   * No new table.
--   * No change to social_mission_settings, record_social_mission_metric_snapshot,
--     social_mission_auto_goal, social_mission_metric_targets, the SE-13/SE-14
--     goal or metric-target establishment gates, or social_mission_effective_config.
--   * No points, rewards, badges, quotas or per-user engagement tracking.
--   * No second scheduler and no second session table.
-- ============================================================================
