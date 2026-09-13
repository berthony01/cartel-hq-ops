-- ===========================================================================
-- SE-4B — Durable Social Mission lifecycle + Mission Pulse schedule.
--
-- PREPARE ONLY. Lovable does NOT apply this migration. Apply it externally
-- against the authoritative Supabase project `ocoinbnjgstkmnwwvnhi` after
-- diff review.
--
-- What this adds
--   1. `social_mission_schedule_events` — ONE durable internal schedule table
--      carrying both the five ephemeral PULSE events and the single COMPLETE
--      event for a mission target. Service-role writes only; workspace members
--      may read.
--   2. Service-role-only RPCs: activation, claim, finalize, Telegram close.
--   3. Widening of the existing `telegram_message_cleanup_jobs.cleanup_kind`
--      CHECK so the SAME generic cleanup worker can also expire pulses. The
--      cleanup worker itself is NOT modified.
--   4. Scheduler secret + secret-match RPC + invoke function + one-minute cron
--      for the new `social-mission-runner` worker, following the established
--      Vault + pg_net + pg_cron pattern. No secret value is ever embedded or
--      printed here.
--
-- Frozen product rules encoded below
--   * Mission duration starts from CONFIRMED canonical-card delivery:
--     ends_at = social_mission_targets.sent_at + 45 minutes.
--   * Pulse offsets are exactly 3, 8, 15, 25, 35 minutes after sent_at.
--   * The completion event is exactly 45 minutes after sent_at.
--   * The DATABASE lifecycle is authoritative. Completion transitions the
--     mission to COMPLETED FIRST; the same-message Telegram edit is then
--     attempted exactly once. A failed or ambiguous edit NEVER reverts the
--     completion and NEVER produces a replacement message.
--   * No ACCOMPLISHED status. No X API read anywhere in this file.
-- ===========================================================================

BEGIN;

-- ---------------------------------------------------------------------------
-- 0. Composite-unique prerequisite for the target FK.
--    `social_missions` and `social_sources` already carry (id, workspace_id);
--    targets did not. Purely additive.
-- ---------------------------------------------------------------------------
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
     WHERE conrelid = 'public.social_mission_targets'::regclass
       AND conname = 'social_mission_targets_id_workspace_unique'
  ) THEN
    ALTER TABLE public.social_mission_targets
      ADD CONSTRAINT social_mission_targets_id_workspace_unique UNIQUE (id, workspace_id);
  END IF;
END
$$;

-- ---------------------------------------------------------------------------
-- 1. The durable schedule table.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.social_mission_schedule_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
  mission_id uuid NOT NULL,
  target_id uuid NOT NULL,
  event_type text NOT NULL,
  sequence_no smallint NOT NULL,
  due_at timestamptz NOT NULL,
  state text NOT NULL DEFAULT 'PENDING',
  -- Stored ONCE at seeding. The completion edit is idempotent by this id, so a
  -- reclaimed stale COMPLETE event reuses it and the transport absorbs the
  -- duplicate instead of producing a second edit.
  client_request_id uuid NOT NULL DEFAULT gen_random_uuid(),
  telegram_message_id bigint,
  claimed_at timestamptz,
  finished_at timestamptz,
  last_error text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT social_mission_schedule_events_mission_workspace_fkey
    FOREIGN KEY (mission_id, workspace_id)
    REFERENCES public.social_missions(id, workspace_id)
    ON DELETE CASCADE,
  CONSTRAINT social_mission_schedule_events_target_workspace_fkey
    FOREIGN KEY (target_id, workspace_id)
    REFERENCES public.social_mission_targets(id, workspace_id)
    ON DELETE CASCADE,
  CONSTRAINT social_mission_schedule_events_type_ck
    CHECK (event_type IN ('PULSE', 'COMPLETE')),
  CONSTRAINT social_mission_schedule_events_state_ck
    CHECK (state IN ('PENDING', 'CLAIMED', 'SENT', 'FAILED', 'AMBIGUOUS', 'CANCELLED')),
  CONSTRAINT social_mission_schedule_events_sequence_ck
    CHECK (
      (event_type = 'PULSE' AND sequence_no BETWEEN 1 AND 5)
      OR (event_type = 'COMPLETE' AND sequence_no = 1)
    ),
  -- Only an ephemeral pulse ever owns its own Telegram message id.
  CONSTRAINT social_mission_schedule_events_message_shape_ck
    CHECK (telegram_message_id IS NULL OR event_type = 'PULSE'),
  CONSTRAINT social_mission_schedule_events_last_error_len_ck
    CHECK (last_error IS NULL OR char_length(last_error) <= 1000),
  CONSTRAINT social_mission_schedule_events_unique
    UNIQUE (target_id, event_type, sequence_no)
);

-- Indexes exist only for the runner's actual claim queries.
CREATE INDEX IF NOT EXISTS social_mission_schedule_events_due_idx
  ON public.social_mission_schedule_events (state, due_at)
  WHERE state = 'PENDING';
CREATE INDEX IF NOT EXISTS social_mission_schedule_events_claimed_idx
  ON public.social_mission_schedule_events (state, claimed_at)
  WHERE state = 'CLAIMED';
CREATE INDEX IF NOT EXISTS social_mission_schedule_events_mission_idx
  ON public.social_mission_schedule_events (mission_id, event_type, sequence_no);

DROP TRIGGER IF EXISTS social_mission_schedule_events_set_updated_at
  ON public.social_mission_schedule_events;
CREATE TRIGGER social_mission_schedule_events_set_updated_at
  BEFORE UPDATE ON public.social_mission_schedule_events
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- Grants: workspace members may READ. The browser can never write schedule
-- state; every write is service-role/SECURITY DEFINER only.
REVOKE ALL ON TABLE public.social_mission_schedule_events FROM PUBLIC, anon, authenticated;
GRANT SELECT ON TABLE public.social_mission_schedule_events TO authenticated;
GRANT ALL ON TABLE public.social_mission_schedule_events TO service_role;

ALTER TABLE public.social_mission_schedule_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.social_mission_schedule_events FORCE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS social_mission_schedule_events_select_member
  ON public.social_mission_schedule_events;
CREATE POLICY social_mission_schedule_events_select_member
  ON public.social_mission_schedule_events
  FOR SELECT
  TO authenticated
  USING (public.is_workspace_member(workspace_id, (SELECT auth.uid())));

-- No INSERT, UPDATE or DELETE policy is created for `authenticated` by design.

-- ---------------------------------------------------------------------------
-- 2. Cleanup-kind widening. Additive only: `launch_watch_cta` keeps working
--    and the generic cleanup worker is untouched.
--
--    ONLY the exact live constraint `telegram_message_cleanup_jobs_cleanup_kind_check`
--    is dropped. No other CHECK on this table is inspected or removed. The
--    block is rerunnable: the widened constraint is dropped by its exact name
--    first if a previous run already created it.
-- ---------------------------------------------------------------------------
ALTER TABLE public.telegram_message_cleanup_jobs
  DROP CONSTRAINT IF EXISTS telegram_message_cleanup_jobs_cleanup_kind_check;

ALTER TABLE public.telegram_message_cleanup_jobs
  DROP CONSTRAINT IF EXISTS telegram_message_cleanup_jobs_cleanup_kind_ck;

ALTER TABLE public.telegram_message_cleanup_jobs
  ADD CONSTRAINT telegram_message_cleanup_jobs_cleanup_kind_ck
  CHECK (cleanup_kind IN ('launch_watch_cta', 'social_mission_pulse'));

-- ---------------------------------------------------------------------------
-- 3. activate_social_mission_schedule
--    Called once by the webhook AFTER the transport confirms SENT.
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
  v_ends timestamptz;
  v_offsets constant integer[] := ARRAY[3, 8, 15, 25, 35];
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

  -- Duration is anchored to CONFIRMED delivery, never to command time.
  v_ends := v_target.sent_at + interval '45 minutes';

  UPDATE public.social_missions
     SET started_at = COALESCE(started_at, v_target.sent_at),
         ends_at = COALESCE(ends_at, v_ends)
   WHERE id = _mission_id;

  -- Idempotent seeding. A duplicate activation inserts nothing.
  FOR v_index IN 1..array_length(v_offsets, 1) LOOP
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

  INSERT INTO public.social_mission_schedule_events (
    workspace_id, mission_id, target_id, event_type, sequence_no, due_at
  )
  VALUES (
    v_mission.workspace_id, _mission_id, _target_id, 'COMPLETE', 1::smallint,
    v_target.sent_at + interval '45 minutes'
  )
  ON CONFLICT (target_id, event_type, sequence_no) DO NOTHING;
  GET DIAGNOSTICS v_inserted = ROW_COUNT;
  v_seeded := v_seeded + v_inserted;

  RETURN jsonb_build_object(
    'outcome', CASE WHEN v_seeded = 0 THEN 'EXISTING' ELSE 'ACTIVATED' END,
    'workspace_id', v_mission.workspace_id,
    'mission_id', _mission_id,
    'target_id', _target_id,
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
-- 4. claim_due_social_mission_schedule_events
--
--    PULSE  : claim PENDING + due, only while the mission is LIVE and the
--             target is SENT. A pulse is NEVER stale-reclaimed; a CLAIMED
--             pulse older than 5 minutes becomes AMBIGUOUS so it can never be
--             resent. Losing an ephemeral pulse beats duplicate spam.
--    COMPLETE: claiming IS the authoritative completion. The mission is moved
--             to COMPLETED first and remaining PENDING pulses are cancelled in
--             the same statement. A stale CLAIMED COMPLETE is returned again
--             after 5 minutes with the SAME client_request_id, because the
--             downstream edit transport is idempotent by request id.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.claim_due_social_mission_schedule_events(
  _limit integer DEFAULT 25
)
RETURNS TABLE (
  event_id uuid,
  event_type text,
  sequence_no smallint,
  workspace_id uuid,
  mission_id uuid,
  target_id uuid,
  client_request_id uuid,
  edit_revision integer,
  telegram_chat_id bigint,
  telegram_message_id bigint,
  group_connection_id uuid,
  mission_created_by uuid,
  canonical_url text
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_limit integer := LEAST(GREATEST(COALESCE(_limit, 25), 1), 200);
  v_stale timestamptz := now() - interval '5 minutes';
BEGIN
  -- Maintenance: an unresolved pulse is retired, never retried.
  UPDATE public.social_mission_schedule_events e
     SET state = 'AMBIGUOUS',
         finished_at = now(),
         last_error = COALESCE(e.last_error, 'Pulse claim expired without a confirmed outcome.')
   WHERE e.event_type = 'PULSE'
     AND e.state = 'CLAIMED'
     AND e.claimed_at IS NOT NULL
     AND e.claimed_at < v_stale;

  -- COMPLETE: database-first completion.
  WITH due AS (
    SELECT e.id
      FROM public.social_mission_schedule_events e
     WHERE e.event_type = 'COMPLETE'
       AND (
         (e.state = 'PENDING' AND e.due_at <= now())
         OR (e.state = 'CLAIMED' AND e.claimed_at IS NOT NULL AND e.claimed_at < v_stale)
       )
     ORDER BY e.due_at
     LIMIT v_limit
     FOR UPDATE SKIP LOCKED
  ),
  completed AS (
    UPDATE public.social_missions m
       SET status = 'COMPLETED',
           completed_at = COALESCE(m.completed_at, now()),
           ends_at = COALESCE(m.ends_at, now())
      FROM public.social_mission_schedule_events e
      JOIN due ON due.id = e.id
     WHERE m.id = e.mission_id
       AND m.status = 'LIVE'
     RETURNING m.id
  ),
  cancelled AS (
    UPDATE public.social_mission_schedule_events p
       SET state = 'CANCELLED',
           finished_at = now()
      FROM public.social_mission_schedule_events e
      JOIN due ON due.id = e.id
     WHERE p.target_id = e.target_id
       AND p.event_type = 'PULSE'
       AND p.state = 'PENDING'
     RETURNING p.id
  )
  UPDATE public.social_mission_schedule_events e
     SET state = 'CLAIMED',
         claimed_at = now()
   WHERE e.id IN (SELECT id FROM due);

  -- PULSE: only while the mission is genuinely still live.
  WITH due AS (
    SELECT e.id
      FROM public.social_mission_schedule_events e
      JOIN public.social_missions m ON m.id = e.mission_id
      JOIN public.social_mission_targets t ON t.id = e.target_id
     WHERE e.event_type = 'PULSE'
       AND e.state = 'PENDING'
       AND e.due_at <= now()
       AND m.status = 'LIVE'
       AND t.delivery_state = 'SENT'
       AND t.telegram_message_id IS NOT NULL
     ORDER BY e.due_at
     LIMIT v_limit
     FOR UPDATE SKIP LOCKED
  )
  UPDATE public.social_mission_schedule_events e
     SET state = 'CLAIMED',
         claimed_at = now()
   WHERE e.id IN (SELECT id FROM due);

  RETURN QUERY
  SELECT e.id,
         e.event_type,
         e.sequence_no,
         e.workspace_id,
         e.mission_id,
         e.target_id,
         e.client_request_id,
         COALESCE(t.edit_revision, 0)::integer,
         t.telegram_chat_id,
         t.telegram_message_id,
         t.group_connection_id,
         m.created_by,
         p.canonical_url
    FROM public.social_mission_schedule_events e
    JOIN public.social_mission_targets t ON t.id = e.target_id
    JOIN public.social_missions m ON m.id = e.mission_id
    JOIN public.social_posts p ON p.id = m.social_post_id
   WHERE e.state = 'CLAIMED'
     AND e.claimed_at IS NOT NULL
     AND e.claimed_at >= now() - interval '30 seconds'
   ORDER BY e.due_at
   LIMIT v_limit;
END;
$$;

REVOKE ALL ON FUNCTION public.claim_due_social_mission_schedule_events(integer)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.claim_due_social_mission_schedule_events(integer) TO service_role;
GRANT EXECUTE ON FUNCTION public.claim_due_social_mission_schedule_events(integer) TO postgres;

-- ---------------------------------------------------------------------------
-- 5. finish_social_mission_schedule_event
--    Narrow finalizer. Only CLAIMED may move on, and AMBIGUOUS is terminal:
--    an unresolved event can never return to a retryable state.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.finish_social_mission_schedule_event(
  _event_id uuid,
  _state text,
  _telegram_message_id bigint DEFAULT NULL,
  _last_error text DEFAULT NULL
)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_rows integer := 0;
BEGIN
  IF _event_id IS NULL OR _state NOT IN ('SENT', 'FAILED', 'AMBIGUOUS') THEN
    RETURN false;
  END IF;

  UPDATE public.social_mission_schedule_events e
     SET state = _state,
         finished_at = now(),
         telegram_message_id = CASE
           WHEN e.event_type = 'PULSE' AND _state = 'SENT' THEN _telegram_message_id
           ELSE e.telegram_message_id
         END,
         last_error = CASE WHEN _last_error IS NULL THEN NULL ELSE left(_last_error, 1000) END
   WHERE e.id = _event_id
     AND e.state = 'CLAIMED';

  GET DIAGNOSTICS v_rows = ROW_COUNT;
  RETURN v_rows = 1;
END;
$$;

REVOKE ALL ON FUNCTION public.finish_social_mission_schedule_event(uuid, text, bigint, text)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.finish_social_mission_schedule_event(uuid, text, bigint, text) TO service_role;
GRANT EXECUTE ON FUNCTION public.finish_social_mission_schedule_event(uuid, text, bigint, text) TO postgres;

-- ---------------------------------------------------------------------------
-- 6. close_social_mission_from_telegram
--    `/mission close`. Authorization is re-established INSIDE the function
--    exactly like the launcher RPC; the webhook additionally keeps its live
--    Telegram administrator/creator check. Zero X reads.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.close_social_mission_from_telegram(
  _telegram_chat_id bigint,
  _telegram_user_id bigint
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_workspace_id uuid;
  v_connection_id uuid;
  v_actor_user_id uuid;
  v_mission public.social_missions%ROWTYPE;
  v_target public.social_mission_targets%ROWTYPE;
  v_event public.social_mission_schedule_events%ROWTYPE;
BEGIN
  IF _telegram_chat_id IS NULL OR _telegram_user_id IS NULL THEN
    RETURN jsonb_build_object('outcome', 'REJECTED', 'reason', 'invalid_telegram_identifiers');
  END IF;

  SELECT gc.id, gc.workspace_id INTO v_connection_id, v_workspace_id
    FROM public.telegram_group_connections gc
   WHERE gc.telegram_chat_id = _telegram_chat_id
   LIMIT 1;
  IF v_connection_id IS NULL THEN
    RETURN jsonb_build_object('outcome', 'REJECTED', 'reason', 'group_not_connected');
  END IF;

  SELECT tc.user_id INTO v_actor_user_id
    FROM public.telegram_connections tc
   WHERE tc.telegram_user_id = _telegram_user_id
   LIMIT 1;
  IF v_actor_user_id IS NULL THEN
    RETURN jsonb_build_object('outcome', 'REJECTED', 'reason', 'actor_not_linked');
  END IF;

  IF NOT public.is_workspace_operator(v_workspace_id, v_actor_user_id) THEN
    RETURN jsonb_build_object('outcome', 'REJECTED', 'reason', 'actor_not_operator');
  END IF;

  -- At most ONE active mission for this exact community.
  SELECT m.* INTO v_mission
    FROM public.social_missions m
    JOIN public.social_mission_targets t
      ON t.mission_id = m.id AND t.workspace_id = m.workspace_id
   WHERE m.workspace_id = v_workspace_id
     AND m.status = 'LIVE'
     AND t.telegram_chat_id = _telegram_chat_id
     AND t.delivery_state = 'SENT'
   ORDER BY m.created_at DESC
   LIMIT 1
   FOR UPDATE OF m;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('outcome', 'NO_ACTIVE_MISSION');
  END IF;

  SELECT * INTO v_target
    FROM public.social_mission_targets
   WHERE mission_id = v_mission.id
     AND workspace_id = v_mission.workspace_id
     AND telegram_chat_id = _telegram_chat_id
   FOR UPDATE;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('outcome', 'REJECTED', 'reason', 'target_not_bound');
  END IF;

  -- Database-first completion. The Telegram edit is attempted afterwards and
  -- can never revert this.
  UPDATE public.social_missions
     SET status = 'COMPLETED',
         completed_at = COALESCE(completed_at, now()),
         ends_at = COALESCE(ends_at, now())
   WHERE id = v_mission.id;

  UPDATE public.social_mission_schedule_events
     SET state = 'CANCELLED',
         finished_at = now()
   WHERE target_id = v_target.id
     AND event_type = 'PULSE'
     AND state = 'PENDING';

  -- Get-or-create the single COMPLETE event, then claim it. Never a second one.
  INSERT INTO public.social_mission_schedule_events (
    workspace_id, mission_id, target_id, event_type, sequence_no, due_at
  )
  VALUES (
    v_mission.workspace_id, v_mission.id, v_target.id, 'COMPLETE', 1::smallint, now()
  )
  ON CONFLICT (target_id, event_type, sequence_no) DO NOTHING;

  SELECT * INTO v_event
    FROM public.social_mission_schedule_events
   WHERE target_id = v_target.id AND event_type = 'COMPLETE' AND sequence_no = 1
   FOR UPDATE;

  IF v_event.state = 'SENT' THEN
    RETURN jsonb_build_object(
      'outcome', 'ALREADY_COMPLETED',
      'workspace_id', v_mission.workspace_id,
      'mission_id', v_mission.id,
      'target_id', v_target.id,
      'event_state', v_event.state
    );
  END IF;

  UPDATE public.social_mission_schedule_events
     SET state = 'CLAIMED',
         claimed_at = now()
   WHERE id = v_event.id;

  RETURN jsonb_build_object(
    'outcome', 'CLOSED',
    'workspace_id', v_mission.workspace_id,
    'mission_id', v_mission.id,
    'target_id', v_target.id,
    'event_id', v_event.id,
    'client_request_id', v_event.client_request_id,
    'edit_revision', COALESCE(v_target.edit_revision, 0),
    'telegram_chat_id', v_target.telegram_chat_id,
    'telegram_message_id', v_target.telegram_message_id,
    'actor_user_id', COALESCE(v_mission.created_by, v_actor_user_id)
  );
END;
$$;

REVOKE ALL ON FUNCTION public.close_social_mission_from_telegram(bigint, bigint)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.close_social_mission_from_telegram(bigint, bigint) TO service_role;
GRANT EXECUTE ON FUNCTION public.close_social_mission_from_telegram(bigint, bigint) TO postgres;

-- ---------------------------------------------------------------------------
-- 7. Scheduler secret, secret-match RPC, invoke function, one-minute cron.
--    Same established pattern as the existing Launch Notification, Project
--    Inbox, Sticker Drop and Telegram cleanup runners. No secret value is
--    embedded, logged or returned here; it is generated inside the database.
-- ---------------------------------------------------------------------------
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM vault.secrets WHERE name = 'social_mission_scheduler_secret') THEN
    PERFORM vault.create_secret(
      encode(gen_random_bytes(32), 'hex'),
      'social_mission_scheduler_secret',
      'Shared secret for the social-mission-runner cron invocation.'
    );
  END IF;
END
$$;

CREATE OR REPLACE FUNCTION public.social_mission_scheduler_secret_matches(p_secret text)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_expected text;
BEGIN
  IF p_secret IS NULL OR length(p_secret) = 0 THEN
    RETURN false;
  END IF;
  SELECT decrypted_secret INTO v_expected
    FROM vault.decrypted_secrets
   WHERE name = 'social_mission_scheduler_secret'
   LIMIT 1;
  IF v_expected IS NULL THEN
    RETURN false;
  END IF;
  RETURN v_expected = p_secret;
END;
$$;

REVOKE ALL ON FUNCTION public.social_mission_scheduler_secret_matches(text)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.social_mission_scheduler_secret_matches(text) TO service_role;
GRANT EXECUTE ON FUNCTION public.social_mission_scheduler_secret_matches(text) TO postgres;

CREATE OR REPLACE FUNCTION public.invoke_social_mission_runner()
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_secret text;
BEGIN
  SELECT decrypted_secret INTO v_secret
    FROM vault.decrypted_secrets
   WHERE name = 'social_mission_scheduler_secret'
   LIMIT 1;
  IF v_secret IS NULL THEN
    RETURN;
  END IF;

  PERFORM net.http_post(
    url := 'https://ocoinbnjgstkmnwwvnhi.supabase.co/functions/v1/social-mission-runner',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'x-cartel-social-mission-scheduler-secret', v_secret
    ),
    body := '{}'::jsonb,
    timeout_milliseconds := 20000
  );
END;
$$;

REVOKE ALL ON FUNCTION public.invoke_social_mission_runner() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.invoke_social_mission_runner() TO service_role;
GRANT EXECUTE ON FUNCTION public.invoke_social_mission_runner() TO postgres;

-- Idempotent cron registration. No existing cron job is altered.
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'cartel-social-mission-runner') THEN
    PERFORM cron.schedule(
      'cartel-social-mission-runner',
      '* * * * *',
      $cron$SELECT public.invoke_social_mission_runner();$cron$
    );
  END IF;
END
$$;

COMMIT;
