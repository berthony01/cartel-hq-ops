-- SE-3 — Social Mission Telegram transport hardening
-- PREPARE ONLY. Lovable does NOT apply this migration.
-- Apply externally through the authoritative Supabase connector
-- (project ocoinbnjgstkmnwwvnhi) after diff review.
--
-- Scope: public.social_mission_targets only.
-- Does NOT touch usage_ledger, telegram_group_connections, social_missions,
-- social_posts, social_metric_snapshots, or any Telegram function.
--
-- Intent vs confirmed:
--   send_text_intent      = exact server-rendered text durably claimed BEFORE transport.
--   message_text_snapshot = text Telegram DEFINITIVELY confirmed (SENT / EDITED only).
-- A failed or ambiguous attempt must never be recorded as confirmed text.

BEGIN;

-- 1. Transport-owned columns -------------------------------------------------

ALTER TABLE public.social_mission_targets
  ADD COLUMN IF NOT EXISTS send_client_request_id uuid NULL,
  ADD COLUMN IF NOT EXISTS send_text_intent text NULL,
  ADD COLUMN IF NOT EXISTS message_text_snapshot text NULL,
  ADD COLUMN IF NOT EXISTS edit_state text NOT NULL DEFAULT 'IDLE',
  ADD COLUMN IF NOT EXISTS edit_client_request_id uuid NULL,
  ADD COLUMN IF NOT EXISTS edit_revision bigint NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS edit_text_snapshot text NULL,
  ADD COLUMN IF NOT EXISTS edit_last_error text NULL,
  ADD COLUMN IF NOT EXISTS last_edit_at timestamptz NULL;

-- 2. Idempotency indexes -----------------------------------------------------

CREATE UNIQUE INDEX IF NOT EXISTS social_mission_targets_send_request_unique
  ON public.social_mission_targets (workspace_id, send_client_request_id)
  WHERE send_client_request_id IS NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS social_mission_targets_edit_request_unique
  ON public.social_mission_targets (workspace_id, edit_client_request_id)
  WHERE edit_client_request_id IS NOT NULL;

-- 3. Shape checks ------------------------------------------------------------

-- Send intent is claimed together with the request id, and only once the row
-- has left PENDING. PENDING must carry no transport claim at all.
ALTER TABLE public.social_mission_targets
  DROP CONSTRAINT IF EXISTS social_mission_targets_send_intent_shape_ck;
ALTER TABLE public.social_mission_targets
  ADD CONSTRAINT social_mission_targets_send_intent_shape_ck CHECK (
    (
      delivery_state = 'PENDING'
      AND send_client_request_id IS NULL
      AND send_text_intent IS NULL
    )
    OR (
      delivery_state IN ('SENDING', 'SENT', 'FAILED', 'AMBIGUOUS')
      AND send_client_request_id IS NOT NULL
      AND send_text_intent IS NOT NULL
    )
  );

-- Confirmed text exists only for SENT. Non-SENT rows carry no confirmed text,
-- no message id and no sent_at.
ALTER TABLE public.social_mission_targets
  DROP CONSTRAINT IF EXISTS social_mission_targets_confirmed_shape_ck;
ALTER TABLE public.social_mission_targets
  ADD CONSTRAINT social_mission_targets_confirmed_shape_ck CHECK (
    (
      delivery_state = 'SENT'
      AND telegram_message_id IS NOT NULL
      AND sent_at IS NOT NULL
      AND message_text_snapshot IS NOT NULL
    )
    OR (
      delivery_state <> 'SENT'
      AND telegram_message_id IS NULL
      AND sent_at IS NULL
      AND message_text_snapshot IS NULL
    )
  );

ALTER TABLE public.social_mission_targets
  DROP CONSTRAINT IF EXISTS social_mission_targets_edit_state_ck;
ALTER TABLE public.social_mission_targets
  ADD CONSTRAINT social_mission_targets_edit_state_ck CHECK (
    edit_state IN ('IDLE', 'EDITING', 'EDITED', 'FAILED', 'AMBIGUOUS')
  );

ALTER TABLE public.social_mission_targets
  DROP CONSTRAINT IF EXISTS social_mission_targets_edit_revision_ck;
ALTER TABLE public.social_mission_targets
  ADD CONSTRAINT social_mission_targets_edit_revision_ck CHECK (edit_revision >= 0);

ALTER TABLE public.social_mission_targets
  DROP CONSTRAINT IF EXISTS social_mission_targets_edit_shape_ck;
ALTER TABLE public.social_mission_targets
  ADD CONSTRAINT social_mission_targets_edit_shape_ck CHECK (
    (
      edit_state = 'IDLE'
      AND edit_client_request_id IS NULL
      AND edit_revision = 0
      AND edit_text_snapshot IS NULL
      AND edit_last_error IS NULL
      AND last_edit_at IS NULL
    )
    OR (
      edit_state <> 'IDLE'
      AND edit_client_request_id IS NOT NULL
      AND edit_revision >= 1
      AND edit_text_snapshot IS NOT NULL
    )
  );

-- last_edit_at is proof of a confirmed edit, so it belongs to EDITED only.
ALTER TABLE public.social_mission_targets
  DROP CONSTRAINT IF EXISTS social_mission_targets_last_edit_at_ck;
ALTER TABLE public.social_mission_targets
  ADD CONSTRAINT social_mission_targets_last_edit_at_ck CHECK (
    (edit_state = 'EDITED' AND last_edit_at IS NOT NULL)
    OR (edit_state <> 'EDITED' AND last_edit_at IS NULL)
  );

ALTER TABLE public.social_mission_targets
  DROP CONSTRAINT IF EXISTS social_mission_targets_text_length_ck;
ALTER TABLE public.social_mission_targets
  ADD CONSTRAINT social_mission_targets_text_length_ck CHECK (
    (send_text_intent IS NULL OR char_length(send_text_intent) BETWEEN 1 AND 4096)
    AND (message_text_snapshot IS NULL OR char_length(message_text_snapshot) BETWEEN 1 AND 4096)
    AND (edit_text_snapshot IS NULL OR char_length(edit_text_snapshot) BETWEEN 1 AND 4096)
    AND (edit_last_error IS NULL OR char_length(edit_last_error) BETWEEN 1 AND 1000)
  );

-- 4. Browser hardening -------------------------------------------------------
-- Transport state is service-owned. The browser may only declare intent rows.

REVOKE UPDATE ON public.social_mission_targets FROM authenticated;
DROP POLICY IF EXISTS social_mission_targets_update_operator ON public.social_mission_targets;

REVOKE INSERT ON public.social_mission_targets FROM authenticated;
GRANT INSERT (workspace_id, mission_id, group_connection_id, telegram_chat_id)
  ON public.social_mission_targets TO authenticated;

DROP POLICY IF EXISTS social_mission_targets_insert_operator ON public.social_mission_targets;
CREATE POLICY social_mission_targets_insert_operator
  ON public.social_mission_targets
  FOR INSERT
  TO authenticated
  WITH CHECK (
    public.is_workspace_operator(workspace_id, (SELECT auth.uid()))
    AND group_connection_id IS NOT NULL
    AND telegram_chat_id IS NOT NULL
    AND delivery_state = 'PENDING'
    AND telegram_message_id IS NULL
    AND sent_at IS NULL
    AND last_error IS NULL
    AND send_client_request_id IS NULL
    AND send_text_intent IS NULL
    AND message_text_snapshot IS NULL
    AND edit_state = 'IDLE'
    AND edit_client_request_id IS NULL
    AND edit_revision = 0
    AND edit_text_snapshot IS NULL
    AND edit_last_error IS NULL
    AND last_edit_at IS NULL
  );

-- SELECT and DRAFT-only DELETE policies are intentionally preserved unchanged.
-- Service role remains authoritative for every transport write.
GRANT ALL ON public.social_mission_targets TO service_role;

COMMIT;
