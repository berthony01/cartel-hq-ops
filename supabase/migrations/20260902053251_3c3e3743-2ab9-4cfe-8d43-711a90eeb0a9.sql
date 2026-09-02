CREATE TABLE public.telegram_group_announcements (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
  group_connection_id uuid NULL REFERENCES public.telegram_group_connections(id) ON DELETE SET NULL,
  telegram_chat_id bigint NOT NULL,
  group_title text NOT NULL,
  requested_by uuid NULL REFERENCES auth.users(id) ON DELETE SET NULL,
  client_request_id uuid NOT NULL,
  message_text text NOT NULL,
  status text NOT NULL,
  telegram_message_id bigint NULL,
  last_error text NULL,
  requested_at timestamptz NOT NULL DEFAULT now(),
  sent_at timestamptz NULL,
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT telegram_group_announcements_status_ck
    CHECK (status IN ('SENDING', 'SENT', 'FAILED', 'AMBIGUOUS')),
  CONSTRAINT telegram_group_announcements_message_len_ck
    CHECK (char_length(message_text) BETWEEN 1 AND 3500),
  CONSTRAINT telegram_group_announcements_group_title_ck
    CHECK (char_length(group_title) BETWEEN 1 AND 512),
  CONSTRAINT telegram_group_announcements_last_error_len_ck
    CHECK (last_error IS NULL OR char_length(last_error) <= 1000),
  CONSTRAINT telegram_group_announcements_sent_fields_ck
    CHECK (
      (status = 'SENT' AND telegram_message_id IS NOT NULL AND sent_at IS NOT NULL)
      OR
      (status <> 'SENT' AND telegram_message_id IS NULL AND sent_at IS NULL)
    )
);

COMMENT ON TABLE public.telegram_group_announcements IS
  'C7 durable ledger of one-off plain-text announcements posted to a connected Telegram community. Service-role only; never exposed to the browser. Separate from launch_events / Launch Watch watcher DMs.';

CREATE UNIQUE INDEX telegram_group_announcements_idempotency_idx
  ON public.telegram_group_announcements (workspace_id, client_request_id);

CREATE INDEX telegram_group_announcements_workspace_recent_idx
  ON public.telegram_group_announcements (workspace_id, requested_at DESC);

CREATE INDEX telegram_group_announcements_group_recent_idx
  ON public.telegram_group_announcements (group_connection_id, requested_at DESC);

CREATE TRIGGER telegram_group_announcements_set_updated_at
  BEFORE UPDATE ON public.telegram_group_announcements
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

ALTER TABLE public.telegram_group_announcements ENABLE ROW LEVEL SECURITY;

REVOKE ALL PRIVILEGES ON public.telegram_group_announcements FROM PUBLIC;
REVOKE ALL PRIVILEGES ON public.telegram_group_announcements FROM anon;
REVOKE ALL PRIVILEGES ON public.telegram_group_announcements FROM authenticated;
GRANT ALL PRIVILEGES ON public.telegram_group_announcements TO service_role;
