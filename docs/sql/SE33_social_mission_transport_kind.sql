-- ===========================================================================
-- SE-3.3 — Durable Telegram transport kind for Social Mission targets.
--
-- REPOSITORY AUDIT PARITY COPY. ALREADY APPLIED externally to the authoritative
-- Supabase project `ocoinbnjgstkmnwwvnhi` as migration
-- `se33_social_mission_transport_kind`. Lovable never runs this file.
--
-- Why the column exists:
--   `social_mission_targets` had no durable place to record WHICH Telegram
--   method created a message. A branded card is sent with `sendPhoto` and must
--   later be updated with `editMessageCaption`; a plain card is sent with
--   `sendMessage` and must be updated with `editMessageText`. Inferring the
--   kind from the current project logo is not durable (the logo can change),
--   and probing Telegram would require a second transport call, breaking the
--   frozen exactly-one-call guarantee.
--
-- Compatibility:
--   DEFAULT 'TEXT' means every historical row — including the proven test
--   message #1848 — keeps using `editMessageText` with no backfill.
--
-- Authority:
--   Only service-role transport may promote a claimed row to 'PHOTO'. The
--   authenticated INSERT policy pins new operator rows to 'TEXT', so the
--   browser can never preselect the branded transport.
-- ===========================================================================

ALTER TABLE public.social_mission_targets
  ADD COLUMN IF NOT EXISTS transport_kind text NOT NULL DEFAULT 'TEXT';

ALTER TABLE public.social_mission_targets
  DROP CONSTRAINT IF EXISTS social_mission_targets_transport_kind_chk;

ALTER TABLE public.social_mission_targets
  ADD CONSTRAINT social_mission_targets_transport_kind_chk
  CHECK (transport_kind IN ('TEXT', 'PHOTO'));

-- Insert policy hardening: unchanged except for the final transport_kind pin.
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
    AND transport_kind = 'TEXT'
  );

-- The narrow authenticated INSERT column grant is deliberately NOT widened:
-- `transport_kind` is not grantable to `authenticated`, so it can only ever be
-- written by service-role transport.
GRANT ALL ON public.social_mission_targets TO service_role;
