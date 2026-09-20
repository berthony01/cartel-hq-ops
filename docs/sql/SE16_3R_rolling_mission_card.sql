-- ============================================================================
-- SE-16.3R-1 — ROLLING CANONICAL MISSION CARD: DATABASE CONTRACT
--
-- PREPARED ONLY. Lovable does NOT apply this migration. It is reviewed and
-- applied externally against the authoritative Supabase project
-- `ocoinbnjgstkmnwwvnhi`.
--
-- GOAL
--   Exactly ONE active branded mission card per live mission target/chat.
--   Admin edits and busy-chat activity move that single card to the bottom of
--   the group by SENDING A NEW CARD FIRST and only then retiring the old one.
--
-- INVARIANTS THIS MIGRATION PRESERVES
--   * The SE-3 send/edit lanes are untouched. `delivery_state`, `sent_at`,
--     `send_client_request_id`, `send_text_intent`, `transport_kind`,
--     `edit_state`, `edit_revision`, `edit_client_request_id`,
--     `edit_text_snapshot`, `last_edit_at` keep their exact meaning and their
--     exact CHECK constraints. Replacement gets its OWN narrow state lane and
--     never resets or repurposes the edit lane.
--   * No table is created and no existing table is recreated. Old-card removal
--     reuses the proven `telegram_message_cleanup_jobs` queue and its existing
--     worker; this migration only WIDENS the allowed `cleanup_kind` values.
--   * No second activity-events table. Group-message accounting is deduplicated
--     by the monotonic Telegram message id stored on the target row itself.
--   * Both functions are SECURITY DEFINER with an explicit `search_path`,
--     REVOKEd from PUBLIC/anon/authenticated and GRANTed only to service_role
--     and postgres. The browser has no path to either.
--   * Zero pin behaviour. `pinned_by_hq` is read for reporting only and is
--     never written here. This feature is independent of chat pinning.
--   * Zero Telegram calls and zero X/provider reads. The database counts and
--     signals; the transport owns every network side effect.
-- ============================================================================

BEGIN;

-- ----------------------------------------------------------------------------
-- 1. REPLACEMENT STATE LANE on the existing target row.
--    Additive only. Every column has a safe default so existing rows are
--    instantly valid under the constraints added in section 2.
-- ----------------------------------------------------------------------------

ALTER TABLE public.social_mission_targets
  ADD COLUMN IF NOT EXISTS activity_message_count integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS last_activity_message_id bigint NULL,
  ADD COLUMN IF NOT EXISTS last_resurface_at timestamptz NULL,
  ADD COLUMN IF NOT EXISTS last_resurface_attempt_at timestamptz NULL,
  ADD COLUMN IF NOT EXISTS resurface_state text NOT NULL DEFAULT 'IDLE',
  ADD COLUMN IF NOT EXISTS resurface_client_request_id uuid NULL,
  ADD COLUMN IF NOT EXISTS resurface_revision bigint NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS resurface_last_error text NULL;

-- One replacement claim id may never be reused inside a workspace, so a retry
-- of the same claim can never produce a second card.
CREATE UNIQUE INDEX IF NOT EXISTS social_mission_targets_resurface_request_unique
  ON public.social_mission_targets (workspace_id, resurface_client_request_id)
  WHERE resurface_client_request_id IS NOT NULL;

-- ----------------------------------------------------------------------------
-- 2. SHAPE CONSTRAINTS. Each is dropped first so the migration is rerunnable.
--    Only the constraints named here are touched.
-- ----------------------------------------------------------------------------

ALTER TABLE public.social_mission_targets
  DROP CONSTRAINT IF EXISTS social_mission_targets_activity_count_ck;
ALTER TABLE public.social_mission_targets
  ADD CONSTRAINT social_mission_targets_activity_count_ck
  CHECK (activity_message_count >= 0);

ALTER TABLE public.social_mission_targets
  DROP CONSTRAINT IF EXISTS social_mission_targets_resurface_revision_ck;
ALTER TABLE public.social_mission_targets
  ADD CONSTRAINT social_mission_targets_resurface_revision_ck
  CHECK (resurface_revision >= 0);

ALTER TABLE public.social_mission_targets
  DROP CONSTRAINT IF EXISTS social_mission_targets_resurface_state_ck;
ALTER TABLE public.social_mission_targets
  ADD CONSTRAINT social_mission_targets_resurface_state_ck
  CHECK (resurface_state IN ('IDLE', 'CLAIMED', 'RESURFACED', 'FAILED', 'AMBIGUOUS'));

ALTER TABLE public.social_mission_targets
  DROP CONSTRAINT IF EXISTS social_mission_targets_resurface_error_ck;
ALTER TABLE public.social_mission_targets
  ADD CONSTRAINT social_mission_targets_resurface_error_ck
  CHECK (resurface_last_error IS NULL OR char_length(resurface_last_error) BETWEEN 1 AND 1000);

ALTER TABLE public.social_mission_targets
  DROP CONSTRAINT IF EXISTS social_mission_targets_activity_message_id_ck;
ALTER TABLE public.social_mission_targets
  ADD CONSTRAINT social_mission_targets_activity_message_id_ck
  CHECK (last_activity_message_id IS NULL OR last_activity_message_id > 0);

-- IDLE is the pristine lane: nothing claimed, nothing attempted, revision zero.
-- Any non-IDLE state proves a claim happened, so it must carry its request id,
-- a revision of at least one and an attempt timestamp.
-- `last_resurface_at` is deliberately NOT constrained here: FAILED and
-- AMBIGUOUS attempts must be able to exist with no successful replacement ever
-- having occurred.
ALTER TABLE public.social_mission_targets
  DROP CONSTRAINT IF EXISTS social_mission_targets_resurface_shape_ck;
ALTER TABLE public.social_mission_targets
  ADD CONSTRAINT social_mission_targets_resurface_shape_ck
  CHECK (
    (
      resurface_state = 'IDLE'
      AND resurface_client_request_id IS NULL
      AND resurface_revision = 0
      AND last_resurface_attempt_at IS NULL
    )
    OR (
      resurface_state <> 'IDLE'
      AND resurface_client_request_id IS NOT NULL
      AND resurface_revision >= 1
      AND last_resurface_attempt_at IS NOT NULL
    )
  );

-- ----------------------------------------------------------------------------
-- 3. CLEANUP QUEUE — widen the EXISTING constraint only.
--    The table, its worker, its claim RPC, its backoff and its idempotent
--    "already gone" handling are all reused verbatim. Both previously allowed
--    kinds are preserved.
-- ----------------------------------------------------------------------------

ALTER TABLE public.telegram_message_cleanup_jobs
  DROP CONSTRAINT IF EXISTS telegram_message_cleanup_jobs_cleanup_kind_check;

ALTER TABLE public.telegram_message_cleanup_jobs
  DROP CONSTRAINT IF EXISTS telegram_message_cleanup_jobs_cleanup_kind_ck;

ALTER TABLE public.telegram_message_cleanup_jobs
  ADD CONSTRAINT telegram_message_cleanup_jobs_cleanup_kind_ck
  CHECK (cleanup_kind IN ('launch_watch_cta', 'social_mission_pulse', 'social_mission_card'));

-- ----------------------------------------------------------------------------
-- 4. RPC 1 — public.social_mission_note_chat_activity
--
--    Counts ONE qualifying group message against the single LIVE canonical
--    target bound to that exact chat, and SIGNALS whether the resurface
--    threshold is met. It never claims, never sends and never deletes.
--    The transport performs the compare-and-set claim, so two concurrent
--    threshold messages may both signal but only one transport call can win.
-- ----------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.social_mission_note_chat_activity(
  _telegram_chat_id bigint,
  _telegram_message_id bigint
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_matches integer;
  v_target_id uuid;
  v_row public.social_mission_targets%ROWTYPE;
  v_status text;
  v_count integer;
  v_cooldown_anchor timestamptz;
  v_should boolean := false;
BEGIN
  IF _telegram_chat_id IS NULL OR _telegram_message_id IS NULL OR _telegram_message_id <= 0 THEN
    RETURN jsonb_build_object('outcome', 'ignored', 'reason', 'invalid_input');
  END IF;

  -- Exactly one LIVE, SENT, canonical target must be bound to this chat.
  -- Zero means nothing to do. More than one is genuinely ambiguous and we
  -- never guess which card is canonical.
  SELECT count(*), min(t.id)
    INTO v_matches, v_target_id
    FROM public.social_mission_targets t
    JOIN public.social_missions m
      ON m.id = t.mission_id
     AND m.workspace_id = t.workspace_id
   WHERE t.telegram_chat_id = _telegram_chat_id
     AND t.delivery_state = 'SENT'
     AND t.telegram_message_id IS NOT NULL
     AND m.status = 'LIVE';

  IF v_matches = 0 THEN
    RETURN jsonb_build_object('outcome', 'ignored', 'reason', 'no_live');
  END IF;

  IF v_matches > 1 THEN
    RETURN jsonb_build_object('outcome', 'ignored', 'reason', 'ambiguous_live_targets');
  END IF;

  -- Serialise every concurrent update for this chat behind the target row.
  SELECT * INTO v_row
    FROM public.social_mission_targets
   WHERE id = v_target_id
   FOR UPDATE;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('outcome', 'ignored', 'reason', 'no_live');
  END IF;

  -- Re-read status under the lock: the mission may have completed meanwhile.
  SELECT m.status INTO v_status
    FROM public.social_missions m
   WHERE m.id = v_row.mission_id;

  IF v_status IS DISTINCT FROM 'LIVE' THEN
    RETURN jsonb_build_object('outcome', 'ignored', 'reason', 'no_live');
  END IF;

  -- The card itself, and anything at or before it, is not member activity.
  IF _telegram_message_id <= coalesce(v_row.telegram_message_id, 0) THEN
    RETURN jsonb_build_object(
      'outcome', 'ignored', 'reason', 'not_after_card',
      'target_id', v_row.id, 'activity_message_count', v_row.activity_message_count);
  END IF;

  -- Telegram retry / out-of-order guard. Message ids are monotonic per chat,
  -- so a non-advancing id is a redelivery and must never double count.
  IF _telegram_message_id <= coalesce(v_row.last_activity_message_id, 0) THEN
    RETURN jsonb_build_object(
      'outcome', 'ignored', 'reason', 'duplicate_message',
      'target_id', v_row.id, 'activity_message_count', v_row.activity_message_count);
  END IF;

  UPDATE public.social_mission_targets
     SET activity_message_count = activity_message_count + 1,
         last_activity_message_id = _telegram_message_id,
         updated_at = now()
   WHERE id = v_row.id
   RETURNING activity_message_count INTO v_count;

  -- Cooldown runs from the most recent moment a card became current or was
  -- attempted: the original send, the last successful resurface, or the last
  -- attempt. GREATEST ignores nulls in Postgres.
  v_cooldown_anchor := GREATEST(
    v_row.sent_at,
    v_row.last_resurface_at,
    v_row.last_resurface_attempt_at);

  v_should := v_count >= 6
    AND v_row.resurface_state NOT IN ('CLAIMED', 'AMBIGUOUS')
    AND (v_cooldown_anchor IS NULL OR now() - v_cooldown_anchor >= interval '3 minutes');

  RETURN jsonb_build_object(
    'outcome', 'counted',
    'target_id', v_row.id,
    'workspace_id', v_row.workspace_id,
    'mission_id', v_row.mission_id,
    'telegram_chat_id', v_row.telegram_chat_id,
    'activity_message_count', v_count,
    'should_resurface', v_should);
END;
$$;

REVOKE ALL ON FUNCTION public.social_mission_note_chat_activity(bigint, bigint) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.social_mission_note_chat_activity(bigint, bigint) TO service_role, postgres;

-- ----------------------------------------------------------------------------
-- 5. RPC 2 — public.social_mission_finalize_resurface
--
--    Called ONLY after Telegram has confirmed a brand new card. In one
--    transaction it queues the OLD card for deletion and makes the NEW id
--    canonical. Either both happen or neither does, so the two references can
--    never both be lost. This function never calls Telegram and never deletes
--    a message itself; the existing cleanup worker owns deletion and retries.
-- ----------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.social_mission_finalize_resurface(
  _target_id uuid,
  _client_request_id uuid,
  _new_message_id bigint,
  _message_text text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_row public.social_mission_targets%ROWTYPE;
  v_status text;
  v_old_message_id bigint;
  v_now timestamptz := now();
BEGIN
  IF _target_id IS NULL OR _client_request_id IS NULL THEN
    RETURN jsonb_build_object('outcome', 'invalid', 'reason', 'missing_identifier');
  END IF;

  IF _new_message_id IS NULL OR _new_message_id <= 0 THEN
    RETURN jsonb_build_object('outcome', 'invalid', 'reason', 'invalid_message_id');
  END IF;

  IF _message_text IS NULL OR char_length(_message_text) < 1 OR char_length(_message_text) > 4096 THEN
    RETURN jsonb_build_object('outcome', 'invalid', 'reason', 'invalid_message_text');
  END IF;

  SELECT * INTO v_row
    FROM public.social_mission_targets
   WHERE id = _target_id
   FOR UPDATE;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('outcome', 'invalid', 'reason', 'unknown_target');
  END IF;

  -- Idempotent replay of the very same confirmed replacement. No second
  -- cleanup job, no second canonical swap.
  IF v_row.resurface_client_request_id = _client_request_id
     AND v_row.resurface_state = 'RESURFACED' THEN
    RETURN jsonb_build_object(
      'outcome', 'replayed',
      'target_id', v_row.id,
      'new_message_id', v_row.telegram_message_id,
      'pinned_by_hq', coalesce(v_row.pinned_by_hq, false));
  END IF;

  IF v_row.resurface_state <> 'CLAIMED'
     OR v_row.resurface_client_request_id IS DISTINCT FROM _client_request_id THEN
    RETURN jsonb_build_object('outcome', 'conflict', 'reason', 'not_claimed');
  END IF;

  -- The mission may have completed or been cancelled between the claim and the
  -- confirmed send. Nothing is mutated and nothing is queued in that case.
  SELECT m.status INTO v_status
    FROM public.social_missions m
   WHERE m.id = v_row.mission_id
     AND m.workspace_id = v_row.workspace_id;

  IF v_status IS DISTINCT FROM 'LIVE' THEN
    RETURN jsonb_build_object('outcome', 'not_live', 'target_id', v_row.id);
  END IF;

  IF v_row.delivery_state <> 'SENT'
     OR v_row.telegram_message_id IS NULL
     OR v_row.telegram_message_id <= 0
     OR v_row.group_connection_id IS NULL
     OR v_row.telegram_chat_id IS NULL
     OR v_row.workspace_id IS NULL THEN
    RETURN jsonb_build_object('outcome', 'conflict', 'reason', 'not_canonical');
  END IF;

  v_old_message_id := v_row.telegram_message_id;

  IF _new_message_id = v_old_message_id THEN
    RETURN jsonb_build_object('outcome', 'conflict', 'reason', 'same_message_id');
  END IF;

  -- Queue the OLD card for the existing cleanup worker. Uniqueness on
  -- (telegram_chat_id, telegram_message_id) is pre-existing; an already
  -- recorded job — including one already marked deleted — is left exactly as
  -- it is rather than duplicated or regressed.
  IF NOT EXISTS (
    SELECT 1 FROM public.telegram_message_cleanup_jobs j
     WHERE j.telegram_chat_id = v_row.telegram_chat_id
       AND j.telegram_message_id = v_old_message_id
  ) THEN
    INSERT INTO public.telegram_message_cleanup_jobs (
      workspace_id, group_connection_id, telegram_chat_id, telegram_message_id,
      cleanup_kind, status, delete_after, next_attempt_at)
    VALUES (
      v_row.workspace_id, v_row.group_connection_id, v_row.telegram_chat_id, v_old_message_id,
      'social_mission_card', 'pending', v_now, v_now);
  END IF;

  -- Canonical swap. sent_at, delivery_state, transport_kind, pinned_by_hq,
  -- edit_state and edit_revision are deliberately NOT in this SET list.
  UPDATE public.social_mission_targets
     SET telegram_message_id = _new_message_id,
         message_text_snapshot = _message_text,
         resurface_state = 'RESURFACED',
         last_resurface_at = v_now,
         activity_message_count = 0,
         last_activity_message_id = _new_message_id,
         resurface_last_error = NULL,
         updated_at = now()
   WHERE id = v_row.id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'social_mission_finalize_resurface: canonical swap failed for target %', v_row.id;
  END IF;

  RETURN jsonb_build_object(
    'outcome', 'finalized',
    'target_id', v_row.id,
    'old_message_id', v_old_message_id,
    'new_message_id', _new_message_id,
    'pinned_by_hq', coalesce(v_row.pinned_by_hq, false));
END;
$$;

REVOKE ALL ON FUNCTION public.social_mission_finalize_resurface(uuid, uuid, bigint, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.social_mission_finalize_resurface(uuid, uuid, bigint, text) TO service_role, postgres;

COMMIT;

-- ============================================================================
-- NOT INCLUDED, DELIBERATELY
--   * No claim RPC. The transport performs the IDLE/FAILED -> CLAIMED
--     compare-and-set with service-role credentials in the next unit.
--   * No new table, no activity-events table, no second scheduler.
--   * No change to send_mission / edit_mission columns, states or constraints.
--   * No pin or unpin behaviour of any kind.
--   * No RLS change, no anon/authenticated grant, no browser write path.
--   * No Telegram call and no X/provider read.
-- ============================================================================
