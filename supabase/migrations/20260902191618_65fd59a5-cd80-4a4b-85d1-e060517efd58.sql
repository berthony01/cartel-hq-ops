-- =========================================================
-- C7.3A Two-Way Project Inbox data foundation (service-only)
-- =========================================================

-- ---------- A. project_inbox_settings ----------
CREATE TABLE public.project_inbox_settings (
  workspace_id uuid PRIMARY KEY REFERENCES public.workspaces(id) ON DELETE CASCADE,
  replies_enabled boolean NOT NULL DEFAULT false,
  new_conversations_enabled boolean NOT NULL DEFAULT false,
  security_warning_version text NOT NULL DEFAULT 'v1',
  updated_by uuid NULL REFERENCES public.profiles(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT project_inbox_settings_warning_version_chk
    CHECK (length(btrim(security_warning_version)) BETWEEN 1 AND 32)
);

REVOKE ALL ON public.project_inbox_settings FROM PUBLIC, anon, authenticated;
GRANT ALL ON public.project_inbox_settings TO service_role;
ALTER TABLE public.project_inbox_settings ENABLE ROW LEVEL SECURITY;

CREATE TRIGGER project_inbox_settings_set_updated_at
  BEFORE UPDATE ON public.project_inbox_settings
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- ---------- B. project_inbox_contacts ----------
CREATE TABLE public.project_inbox_contacts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
  telegram_user_id bigint NOT NULL,
  member_ref text NOT NULL DEFAULT upper(substr(replace(gen_random_uuid()::text, '-', ''), 1, 8)),
  status text NOT NULL DEFAULT 'ACTIVE',
  blocked_at timestamptz NULL,
  blocked_by uuid NULL REFERENCES public.profiles(id) ON DELETE SET NULL,
  first_contact_at timestamptz NOT NULL DEFAULT now(),
  last_contact_at timestamptz NOT NULL DEFAULT now(),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT project_inbox_contacts_status_chk CHECK (status IN ('ACTIVE', 'BLOCKED')),
  CONSTRAINT project_inbox_contacts_member_ref_chk
    CHECK (member_ref ~ '^[A-Z0-9]{6,12}$'),
  CONSTRAINT project_inbox_contacts_block_shape_chk CHECK (
    (status = 'BLOCKED' AND blocked_at IS NOT NULL)
    OR (status = 'ACTIVE' AND blocked_at IS NULL AND blocked_by IS NULL)
  ),
  CONSTRAINT project_inbox_contacts_ws_tg_key UNIQUE (workspace_id, telegram_user_id),
  CONSTRAINT project_inbox_contacts_ws_ref_key UNIQUE (workspace_id, member_ref),
  CONSTRAINT project_inbox_contacts_id_ws_key UNIQUE (id, workspace_id)
);

COMMENT ON COLUMN public.project_inbox_contacts.telegram_user_id IS
  'Server-only. Never expose through browser-facing RPCs.';
COMMENT ON COLUMN public.project_inbox_contacts.member_ref IS
  'Opaque random alias shown to the team. Not derived from telegram_user_id.';

REVOKE ALL ON public.project_inbox_contacts FROM PUBLIC, anon, authenticated;
GRANT ALL ON public.project_inbox_contacts TO service_role;
ALTER TABLE public.project_inbox_contacts ENABLE ROW LEVEL SECURITY;

CREATE TRIGGER project_inbox_contacts_set_updated_at
  BEFORE UPDATE ON public.project_inbox_contacts
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- ---------- C. project_conversations ----------
CREATE TABLE public.project_conversations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL,
  contact_id uuid NOT NULL,
  origin_type text NOT NULL,
  origin_launch_delivery_id uuid NULL REFERENCES public.launch_notification_deliveries(id) ON DELETE SET NULL,
  origin_launch_event_id uuid NULL REFERENCES public.launch_events(id) ON DELETE SET NULL,
  origin_launch_id uuid NULL REFERENCES public.launches(id) ON DELETE SET NULL,
  origin_group_announcement_id uuid NULL REFERENCES public.telegram_group_announcements(id) ON DELETE SET NULL,
  origin_telegram_message_id bigint NULL,
  origin_title_snapshot text NULL,
  origin_text_snapshot text NULL,
  category text NOT NULL DEFAULT 'GENERAL',
  status text NOT NULL DEFAULT 'WAITING_ON_TEAM',
  priority text NOT NULL DEFAULT 'NORMAL',
  assigned_to uuid NULL REFERENCES public.profiles(id) ON DELETE SET NULL,
  opened_at timestamptz NOT NULL DEFAULT now(),
  last_message_at timestamptz NOT NULL DEFAULT now(),
  resolved_at timestamptz NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT project_conversations_contact_ws_fkey
    FOREIGN KEY (contact_id, workspace_id)
    REFERENCES public.project_inbox_contacts(id, workspace_id) ON DELETE RESTRICT,
  CONSTRAINT project_conversations_origin_type_chk CHECK (
    origin_type IN ('LAUNCH_DELIVERY', 'LAUNCH_CONFIRMATION', 'MEMBER_INITIATED', 'COMMUNITY_BROADCAST')
  ),
  CONSTRAINT project_conversations_category_chk CHECK (
    category IN ('SECURITY', 'LAUNCH', 'VERIFY', 'TECHNICAL', 'GENERAL', 'PARTNERSHIP')
  ),
  CONSTRAINT project_conversations_status_chk CHECK (
    status IN ('OPEN', 'WAITING_ON_TEAM', 'WAITING_ON_MEMBER', 'RESOLVED')
  ),
  CONSTRAINT project_conversations_priority_chk CHECK (priority IN ('NORMAL', 'HIGH')),
  CONSTRAINT project_conversations_title_snapshot_chk
    CHECK (origin_title_snapshot IS NULL OR length(origin_title_snapshot) <= 200),
  CONSTRAINT project_conversations_text_snapshot_chk
    CHECK (origin_text_snapshot IS NULL OR length(origin_text_snapshot) <= 6000),
  CONSTRAINT project_conversations_resolution_shape_chk CHECK (
    (status = 'RESOLVED' AND resolved_at IS NOT NULL)
    OR (status <> 'RESOLVED' AND resolved_at IS NULL)
  )
);

CREATE UNIQUE INDEX project_conversations_contact_origin_msg_key
  ON public.project_conversations (contact_id, origin_telegram_message_id)
  WHERE origin_telegram_message_id IS NOT NULL;

CREATE INDEX project_conversations_ws_status_last_msg_idx
  ON public.project_conversations (workspace_id, status, last_message_at DESC);
CREATE INDEX project_conversations_contact_last_msg_idx
  ON public.project_conversations (contact_id, last_message_at DESC);

REVOKE ALL ON public.project_conversations FROM PUBLIC, anon, authenticated;
GRANT ALL ON public.project_conversations TO service_role;
ALTER TABLE public.project_conversations ENABLE ROW LEVEL SECURITY;

CREATE TRIGGER project_conversations_set_updated_at
  BEFORE UPDATE ON public.project_conversations
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- ---------- D. project_conversation_messages ----------
CREATE TABLE public.project_conversation_messages (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  conversation_id uuid NOT NULL REFERENCES public.project_conversations(id) ON DELETE CASCADE,
  author_type text NOT NULL,
  channel text NOT NULL,
  team_user_id uuid NULL REFERENCES public.profiles(id) ON DELETE SET NULL,
  body text NOT NULL,
  reply_to_message_id uuid NULL REFERENCES public.project_conversation_messages(id) ON DELETE SET NULL,
  telegram_update_id bigint NULL,
  telegram_chat_id bigint NULL,
  telegram_message_id bigint NULL,
  telegram_reply_to_message_id bigint NULL,
  client_request_id uuid NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT project_conversation_messages_author_chk
    CHECK (author_type IN ('MEMBER', 'TEAM', 'SYSTEM')),
  CONSTRAINT project_conversation_messages_channel_chk
    CHECK (channel IN ('TELEGRAM', 'WEB', 'SYSTEM')),
  CONSTRAINT project_conversation_messages_body_chk
    CHECK (length(btrim(body)) BETWEEN 1 AND 4096),
  CONSTRAINT project_conversation_messages_author_shape_chk CHECK (
    (author_type = 'TEAM' AND team_user_id IS NOT NULL)
    OR (author_type IN ('MEMBER', 'SYSTEM') AND team_user_id IS NULL)
  ),
  CONSTRAINT project_conversation_messages_channel_shape_chk CHECK (
    (author_type = 'SYSTEM' AND channel = 'SYSTEM')
    OR (channel = 'WEB' AND author_type = 'TEAM')
    OR (channel = 'TELEGRAM' AND author_type IN ('MEMBER', 'TEAM'))
  ),
  CONSTRAINT project_conversation_messages_id_conv_key UNIQUE (id, conversation_id)
);

CREATE UNIQUE INDEX project_conversation_messages_client_request_key
  ON public.project_conversation_messages (conversation_id, client_request_id)
  WHERE client_request_id IS NOT NULL;
CREATE UNIQUE INDEX project_conversation_messages_tg_msg_key
  ON public.project_conversation_messages (telegram_chat_id, telegram_message_id)
  WHERE telegram_chat_id IS NOT NULL AND telegram_message_id IS NOT NULL;
CREATE UNIQUE INDEX project_conversation_messages_tg_update_key
  ON public.project_conversation_messages (telegram_update_id)
  WHERE telegram_update_id IS NOT NULL;
CREATE INDEX project_conversation_messages_conv_created_asc_idx
  ON public.project_conversation_messages (conversation_id, created_at ASC);
CREATE INDEX project_conversation_messages_conv_created_desc_idx
  ON public.project_conversation_messages (conversation_id, created_at DESC);

REVOKE ALL ON public.project_conversation_messages FROM PUBLIC, anon, authenticated;
GRANT ALL ON public.project_conversation_messages TO service_role;
ALTER TABLE public.project_conversation_messages ENABLE ROW LEVEL SECURITY;

-- central thread-state trigger
CREATE OR REPLACE FUNCTION public.project_inbox_apply_message_state()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_conv public.project_conversations%ROWTYPE;
BEGIN
  SELECT * INTO v_conv FROM public.project_conversations WHERE id = NEW.conversation_id FOR UPDATE;
  IF NOT FOUND THEN
    RETURN NEW;
  END IF;

  UPDATE public.project_conversations c
     SET last_message_at = GREATEST(c.last_message_at, NEW.created_at),
         status = CASE
           WHEN c.status = 'RESOLVED' THEN c.status
           WHEN NEW.author_type = 'MEMBER' THEN 'WAITING_ON_TEAM'
           WHEN NEW.author_type = 'TEAM' THEN 'WAITING_ON_MEMBER'
           ELSE c.status
         END,
         updated_at = now()
   WHERE c.id = NEW.conversation_id;

  IF NEW.author_type = 'MEMBER' THEN
    UPDATE public.project_inbox_contacts
       SET last_contact_at = GREATEST(last_contact_at, NEW.created_at),
           updated_at = now()
     WHERE id = v_conv.contact_id;
  END IF;

  RETURN NEW;
END;
$$;

COMMENT ON FUNCTION public.project_inbox_apply_message_state() IS
  'Maintains conversation last_message_at/waiting state. A RESOLVED conversation is never silently reopened.';

CREATE TRIGGER project_conversation_messages_apply_state
  AFTER INSERT ON public.project_conversation_messages
  FOR EACH ROW EXECUTE FUNCTION public.project_inbox_apply_message_state();

-- ---------- E. telegram_inbound_updates ----------
CREATE TABLE public.telegram_inbound_updates (
  telegram_update_id bigint PRIMARY KEY,
  update_kind text NOT NULL,
  telegram_chat_id bigint NULL,
  telegram_message_id bigint NULL,
  telegram_user_id bigint NULL,
  status text NOT NULL DEFAULT 'RECEIVED',
  conversation_message_id uuid NULL REFERENCES public.project_conversation_messages(id) ON DELETE SET NULL,
  last_error text NULL,
  received_at timestamptz NOT NULL DEFAULT now(),
  processed_at timestamptz NULL,
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT telegram_inbound_updates_kind_chk
    CHECK (update_kind IN ('MESSAGE', 'CALLBACK_QUERY', 'OTHER')),
  CONSTRAINT telegram_inbound_updates_status_chk
    CHECK (status IN ('RECEIVED', 'PROCESSED', 'IGNORED', 'FAILED')),
  CONSTRAINT telegram_inbound_updates_last_error_chk
    CHECK (last_error IS NULL OR length(last_error) <= 1000),
  CONSTRAINT telegram_inbound_updates_shape_chk CHECK (
    (status IN ('PROCESSED', 'IGNORED') AND processed_at IS NOT NULL)
    OR (status = 'RECEIVED' AND processed_at IS NULL)
    OR (status = 'FAILED' AND last_error IS NOT NULL AND length(btrim(last_error)) > 0)
  )
);

CREATE UNIQUE INDEX telegram_inbound_updates_chat_msg_key
  ON public.telegram_inbound_updates (telegram_chat_id, telegram_message_id)
  WHERE telegram_chat_id IS NOT NULL AND telegram_message_id IS NOT NULL;
CREATE INDEX telegram_inbound_updates_status_received_idx
  ON public.telegram_inbound_updates (status, received_at);
CREATE INDEX telegram_inbound_updates_user_received_idx
  ON public.telegram_inbound_updates (telegram_user_id, received_at DESC);

REVOKE ALL ON public.telegram_inbound_updates FROM PUBLIC, anon, authenticated;
GRANT ALL ON public.telegram_inbound_updates TO service_role;
ALTER TABLE public.telegram_inbound_updates ENABLE ROW LEVEL SECURITY;

CREATE TRIGGER telegram_inbound_updates_set_updated_at
  BEFORE UPDATE ON public.telegram_inbound_updates
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- ---------- F. project_inbox_deliveries ----------
CREATE TABLE public.project_inbox_deliveries (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  conversation_id uuid NOT NULL REFERENCES public.project_conversations(id) ON DELETE CASCADE,
  message_id uuid NOT NULL,
  telegram_user_id bigint NOT NULL,
  status text NOT NULL DEFAULT 'pending',
  attempt_count integer NOT NULL DEFAULT 0,
  next_attempt_at timestamptz NOT NULL DEFAULT now(),
  claimed_at timestamptz NULL,
  sent_at timestamptz NULL,
  telegram_message_id bigint NULL,
  error_class text NULL,
  last_error text NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT project_inbox_deliveries_message_conv_fkey
    FOREIGN KEY (message_id, conversation_id)
    REFERENCES public.project_conversation_messages(id, conversation_id) ON DELETE CASCADE,
  CONSTRAINT project_inbox_deliveries_message_key UNIQUE (message_id),
  CONSTRAINT project_inbox_deliveries_status_chk
    CHECK (status IN ('pending', 'processing', 'retry', 'sent', 'failed', 'ambiguous')),
  CONSTRAINT project_inbox_deliveries_attempts_chk CHECK (attempt_count >= 0),
  CONSTRAINT project_inbox_deliveries_last_error_chk
    CHECK (last_error IS NULL OR length(last_error) <= 1000),
  CONSTRAINT project_inbox_deliveries_sent_shape_chk CHECK (
    (status = 'sent' AND telegram_message_id IS NOT NULL AND sent_at IS NOT NULL)
    OR (status <> 'sent' AND telegram_message_id IS NULL AND sent_at IS NULL)
  )
);

COMMENT ON COLUMN public.project_inbox_deliveries.telegram_user_id IS
  'Server-only outbound target. Never expose through browser-facing RPCs.';

CREATE INDEX project_inbox_deliveries_due_idx
  ON public.project_inbox_deliveries (status, next_attempt_at);
CREATE INDEX project_inbox_deliveries_conv_order_idx
  ON public.project_inbox_deliveries (conversation_id, created_at ASC, id ASC);

REVOKE ALL ON public.project_inbox_deliveries FROM PUBLIC, anon, authenticated;
GRANT ALL ON public.project_inbox_deliveries TO service_role;
ALTER TABLE public.project_inbox_deliveries ENABLE ROW LEVEL SECURITY;

CREATE TRIGGER project_inbox_deliveries_set_updated_at
  BEFORE UPDATE ON public.project_inbox_deliveries
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- ---------- G. telegram_team_sessions ----------
CREATE TABLE public.telegram_team_sessions (
  telegram_user_id bigint PRIMARY KEY
    REFERENCES public.telegram_connections(telegram_user_id) ON DELETE CASCADE,
  selected_workspace_id uuid NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
  active_conversation_id uuid NULL REFERENCES public.project_conversations(id) ON DELETE SET NULL,
  mode text NOT NULL DEFAULT 'NONE',
  expires_at timestamptz NOT NULL,
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT telegram_team_sessions_mode_chk CHECK (mode IN ('NONE', 'INBOX', 'REPLY'))
);

COMMENT ON TABLE public.telegram_team_sessions IS
  'Short-lived Telegram team console UI state only. This table is NEVER authorization by itself: runtime must always re-check public.is_workspace_operator(workspace_id, user) before exposing or mutating any inbox data.';

REVOKE ALL ON public.telegram_team_sessions FROM PUBLIC, anon, authenticated;
GRANT ALL ON public.telegram_team_sessions TO service_role;
ALTER TABLE public.telegram_team_sessions ENABLE ROW LEVEL SECURITY;

CREATE TRIGGER telegram_team_sessions_set_updated_at
  BEFORE UPDATE ON public.telegram_team_sessions
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- ---------- H. project_inbox_team_preferences ----------
CREATE TABLE public.project_inbox_team_preferences (
  workspace_id uuid NOT NULL,
  user_id uuid NOT NULL,
  new_security_alerts boolean NOT NULL DEFAULT true,
  new_conversation_alerts boolean NOT NULL DEFAULT true,
  assigned_reply_alerts boolean NOT NULL DEFAULT true,
  every_message_alerts boolean NOT NULL DEFAULT false,
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT project_inbox_team_preferences_pkey PRIMARY KEY (workspace_id, user_id),
  CONSTRAINT project_inbox_team_preferences_member_fkey
    FOREIGN KEY (workspace_id, user_id)
    REFERENCES public.workspace_members(workspace_id, user_id) ON DELETE CASCADE
);

REVOKE ALL ON public.project_inbox_team_preferences FROM PUBLIC, anon, authenticated;
GRANT ALL ON public.project_inbox_team_preferences TO service_role;
ALTER TABLE public.project_inbox_team_preferences ENABLE ROW LEVEL SECURITY;

CREATE TRIGGER project_inbox_team_preferences_set_updated_at
  BEFORE UPDATE ON public.project_inbox_team_preferences
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- ---------- Existing-table lookup indexes (no behavior change) ----------
CREATE INDEX IF NOT EXISTS launch_notification_deliveries_tg_user_msg_idx
  ON public.launch_notification_deliveries (telegram_user_id, telegram_message_id)
  WHERE telegram_message_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS launch_watch_subscriptions_tg_user_confirm_msg_idx
  ON public.launch_watch_subscriptions (telegram_user_id, confirmation_telegram_message_id)
  WHERE confirmation_telegram_message_id IS NOT NULL;

-- =========================================================
-- Internal queue RPCs (service_role only)
-- =========================================================
CREATE OR REPLACE FUNCTION public.claim_project_inbox_deliveries(_limit integer DEFAULT 100)
RETURNS TABLE (
  delivery_id uuid,
  conversation_id uuid,
  message_id uuid,
  telegram_user_id bigint,
  body text,
  attempt_count integer
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_limit integer := LEAST(GREATEST(COALESCE(_limit, 100), 1), 250);
BEGIN
  RETURN QUERY
  WITH candidate AS (
    SELECT d.id
      FROM public.project_inbox_deliveries d
     WHERE d.status IN ('pending', 'retry')
       AND d.next_attempt_at <= now()
       AND NOT EXISTS (
         SELECT 1
           FROM public.project_inbox_deliveries e
          WHERE e.conversation_id = d.conversation_id
            AND e.status IN ('pending', 'processing', 'retry', 'ambiguous')
            AND (e.created_at, e.id) < (d.created_at, d.id)
       )
     ORDER BY d.next_attempt_at ASC, d.created_at ASC, d.id ASC
     LIMIT v_limit
     FOR UPDATE SKIP LOCKED
  ),
  claimed AS (
    UPDATE public.project_inbox_deliveries d
       SET status = 'processing',
           claimed_at = now(),
           attempt_count = d.attempt_count + 1,
           updated_at = now()
      FROM candidate c
     WHERE d.id = c.id
     RETURNING d.id, d.conversation_id, d.message_id, d.telegram_user_id, d.attempt_count
  )
  SELECT cl.id, cl.conversation_id, cl.message_id, cl.telegram_user_id, m.body, cl.attempt_count
    FROM claimed cl
    JOIN public.project_conversation_messages m ON m.id = cl.message_id;
END;
$$;

COMMENT ON FUNCTION public.claim_project_inbox_deliveries(integer) IS
  'Service-role only. Claims due inbox deliveries with strict per-conversation ordering.';

REVOKE ALL ON FUNCTION public.claim_project_inbox_deliveries(integer) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.claim_project_inbox_deliveries(integer) TO service_role;

CREATE OR REPLACE FUNCTION public.mark_stale_project_inbox_delivery_claims()
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_count integer;
BEGIN
  -- Conservative 2 minute timeout. Stale claims become AMBIGUOUS and are never retried,
  -- because Telegram may already have received the send.
  UPDATE public.project_inbox_deliveries
     SET status = 'ambiguous',
         error_class = COALESCE(error_class, 'STALE_CLAIM'),
         last_error = COALESCE(last_error, 'Claim exceeded 2 minute processing timeout'),
         updated_at = now()
   WHERE status = 'processing'
     AND claimed_at IS NOT NULL
     AND claimed_at < now() - interval '2 minutes';
  GET DIAGNOSTICS v_count = ROW_COUNT;
  RETURN v_count;
END;
$$;

REVOKE ALL ON FUNCTION public.mark_stale_project_inbox_delivery_claims() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.mark_stale_project_inbox_delivery_claims() TO service_role;

-- =========================================================
-- Privacy-safe browser RPCs (operator only, no Telegram identifiers)
-- =========================================================
CREATE OR REPLACE FUNCTION public.get_project_inbox_settings(_workspace_id uuid)
RETURNS TABLE (
  workspace_id uuid,
  replies_enabled boolean,
  new_conversations_enabled boolean,
  security_warning_version text,
  updated_at timestamptz
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $$
BEGIN
  IF NOT public.is_workspace_operator(_workspace_id, auth.uid()) THEN
    RAISE EXCEPTION 'Not authorized' USING ERRCODE = '42501';
  END IF;

  RETURN QUERY
  SELECT _workspace_id,
         COALESCE(s.replies_enabled, false),
         COALESCE(s.new_conversations_enabled, false),
         COALESCE(s.security_warning_version, 'v1'),
         s.updated_at
    FROM (SELECT 1) x
    LEFT JOIN public.project_inbox_settings s ON s.workspace_id = _workspace_id;
END;
$$;

REVOKE ALL ON FUNCTION public.get_project_inbox_settings(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_project_inbox_settings(uuid) TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.set_project_inbox_settings(
  _workspace_id uuid,
  _replies_enabled boolean,
  _new_conversations_enabled boolean
)
RETURNS TABLE (
  workspace_id uuid,
  replies_enabled boolean,
  new_conversations_enabled boolean,
  security_warning_version text,
  updated_at timestamptz
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
BEGIN
  IF NOT public.is_workspace_operator(_workspace_id, auth.uid()) THEN
    RAISE EXCEPTION 'Not authorized' USING ERRCODE = '42501';
  END IF;

  RETURN QUERY
  INSERT INTO public.project_inbox_settings AS s
    (workspace_id, replies_enabled, new_conversations_enabled, updated_by, updated_at)
  VALUES
    (_workspace_id, COALESCE(_replies_enabled, false), COALESCE(_new_conversations_enabled, false), auth.uid(), now())
  ON CONFLICT (workspace_id) DO UPDATE
    SET replies_enabled = COALESCE(EXCLUDED.replies_enabled, false),
        new_conversations_enabled = COALESCE(EXCLUDED.new_conversations_enabled, false),
        updated_by = auth.uid(),
        updated_at = now()
  RETURNING s.workspace_id, s.replies_enabled, s.new_conversations_enabled, s.security_warning_version, s.updated_at;
END;
$$;

REVOKE ALL ON FUNCTION public.set_project_inbox_settings(uuid, boolean, boolean) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.set_project_inbox_settings(uuid, boolean, boolean) TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.get_project_inbox_summary(_workspace_id uuid)
RETURNS TABLE (
  open_count integer,
  waiting_on_team_count integer,
  waiting_on_member_count integer,
  resolved_count integer,
  blocked_contact_count integer
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $$
BEGIN
  IF NOT public.is_workspace_operator(_workspace_id, auth.uid()) THEN
    RAISE EXCEPTION 'Not authorized' USING ERRCODE = '42501';
  END IF;

  RETURN QUERY
  SELECT
    (SELECT COUNT(*)::integer FROM public.project_conversations c WHERE c.workspace_id = _workspace_id AND c.status = 'OPEN'),
    (SELECT COUNT(*)::integer FROM public.project_conversations c WHERE c.workspace_id = _workspace_id AND c.status = 'WAITING_ON_TEAM'),
    (SELECT COUNT(*)::integer FROM public.project_conversations c WHERE c.workspace_id = _workspace_id AND c.status = 'WAITING_ON_MEMBER'),
    (SELECT COUNT(*)::integer FROM public.project_conversations c WHERE c.workspace_id = _workspace_id AND c.status = 'RESOLVED'),
    (SELECT COUNT(*)::integer FROM public.project_inbox_contacts ct WHERE ct.workspace_id = _workspace_id AND ct.status = 'BLOCKED');
END;
$$;

REVOKE ALL ON FUNCTION public.get_project_inbox_summary(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_project_inbox_summary(uuid) TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.list_project_inbox_conversations(
  _workspace_id uuid,
  _status text DEFAULT NULL,
  _limit integer DEFAULT 50
)
RETURNS TABLE (
  conversation_id uuid,
  member_ref text,
  contact_status text,
  category text,
  status text,
  priority text,
  origin_type text,
  origin_title_snapshot text,
  latest_message_preview text,
  last_message_at timestamptz,
  opened_at timestamptz,
  assigned_to uuid,
  assigned_display_name text
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_limit integer := LEAST(GREATEST(COALESCE(_limit, 50), 1), 100);
BEGIN
  IF NOT public.is_workspace_operator(_workspace_id, auth.uid()) THEN
    RAISE EXCEPTION 'Not authorized' USING ERRCODE = '42501';
  END IF;

  IF _status IS NOT NULL AND _status NOT IN ('OPEN', 'WAITING_ON_TEAM', 'WAITING_ON_MEMBER', 'RESOLVED') THEN
    RAISE EXCEPTION 'Invalid status' USING ERRCODE = '22023';
  END IF;

  RETURN QUERY
  SELECT c.id,
         ct.member_ref,
         ct.status,
         c.category,
         c.status,
         c.priority,
         c.origin_type,
         c.origin_title_snapshot,
         LEFT(COALESCE(lm.body, ''), 280),
         c.last_message_at,
         c.opened_at,
         c.assigned_to,
         p.display_name
    FROM public.project_conversations c
    JOIN public.project_inbox_contacts ct ON ct.id = c.contact_id
    LEFT JOIN public.profiles p ON p.id = c.assigned_to
    LEFT JOIN LATERAL (
      SELECT m.body
        FROM public.project_conversation_messages m
       WHERE m.conversation_id = c.id
       ORDER BY m.created_at DESC, m.id DESC
       LIMIT 1
    ) lm ON true
   WHERE c.workspace_id = _workspace_id
     AND (_status IS NULL OR c.status = _status)
   ORDER BY c.last_message_at DESC
   LIMIT v_limit;
END;
$$;

REVOKE ALL ON FUNCTION public.list_project_inbox_conversations(uuid, text, integer) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.list_project_inbox_conversations(uuid, text, integer) TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.list_project_conversation_messages(
  _conversation_id uuid,
  _limit integer DEFAULT 100
)
RETURNS TABLE (
  message_id uuid,
  author_type text,
  channel text,
  body text,
  team_display_name text,
  created_at timestamptz,
  reply_to_message_id uuid
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_workspace_id uuid;
  v_limit integer := LEAST(GREATEST(COALESCE(_limit, 100), 1), 200);
BEGIN
  SELECT c.workspace_id INTO v_workspace_id
    FROM public.project_conversations c
   WHERE c.id = _conversation_id;

  IF v_workspace_id IS NULL OR NOT public.is_workspace_operator(v_workspace_id, auth.uid()) THEN
    RAISE EXCEPTION 'Not authorized' USING ERRCODE = '42501';
  END IF;

  RETURN QUERY
  SELECT m.id, m.author_type, m.channel, m.body, p.display_name, m.created_at, m.reply_to_message_id
    FROM public.project_conversation_messages m
    LEFT JOIN public.profiles p ON p.id = m.team_user_id
   WHERE m.conversation_id = _conversation_id
   ORDER BY m.created_at ASC, m.id ASC
   LIMIT v_limit;
END;
$$;

REVOKE ALL ON FUNCTION public.list_project_conversation_messages(uuid, integer) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.list_project_conversation_messages(uuid, integer) TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.update_project_conversation_status(
  _conversation_id uuid,
  _status text
)
RETURNS TABLE (
  conversation_id uuid,
  status text,
  resolved_at timestamptz,
  updated_at timestamptz
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_workspace_id uuid;
BEGIN
  IF _status NOT IN ('OPEN', 'WAITING_ON_TEAM', 'WAITING_ON_MEMBER', 'RESOLVED') THEN
    RAISE EXCEPTION 'Invalid status' USING ERRCODE = '22023';
  END IF;

  SELECT c.workspace_id INTO v_workspace_id
    FROM public.project_conversations c
   WHERE c.id = _conversation_id;

  IF v_workspace_id IS NULL OR NOT public.is_workspace_operator(v_workspace_id, auth.uid()) THEN
    RAISE EXCEPTION 'Not authorized' USING ERRCODE = '42501';
  END IF;

  RETURN QUERY
  UPDATE public.project_conversations c
     SET status = _status,
         resolved_at = CASE WHEN _status = 'RESOLVED' THEN COALESCE(c.resolved_at, now()) ELSE NULL END,
         updated_at = now()
   WHERE c.id = _conversation_id
  RETURNING c.id, c.status, c.resolved_at, c.updated_at;
END;
$$;

REVOKE ALL ON FUNCTION public.update_project_conversation_status(uuid, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.update_project_conversation_status(uuid, text) TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.set_project_inbox_contact_blocked(
  _contact_id uuid,
  _blocked boolean
)
RETURNS TABLE (
  contact_id uuid,
  member_ref text,
  status text,
  blocked_at timestamptz
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_workspace_id uuid;
BEGIN
  SELECT ct.workspace_id INTO v_workspace_id
    FROM public.project_inbox_contacts ct
   WHERE ct.id = _contact_id;

  IF v_workspace_id IS NULL OR NOT public.is_workspace_operator(v_workspace_id, auth.uid()) THEN
    RAISE EXCEPTION 'Not authorized' USING ERRCODE = '42501';
  END IF;

  RETURN QUERY
  UPDATE public.project_inbox_contacts ct
     SET status = CASE WHEN _blocked THEN 'BLOCKED' ELSE 'ACTIVE' END,
         blocked_at = CASE WHEN _blocked THEN COALESCE(ct.blocked_at, now()) ELSE NULL END,
         blocked_by = CASE WHEN _blocked THEN auth.uid() ELSE NULL END,
         updated_at = now()
   WHERE ct.id = _contact_id
  RETURNING ct.id, ct.member_ref, ct.status, ct.blocked_at;
END;
$$;

REVOKE ALL ON FUNCTION public.set_project_inbox_contact_blocked(uuid, boolean) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.set_project_inbox_contact_blocked(uuid, boolean) TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.get_my_project_inbox_team_preferences(_workspace_id uuid)
RETURNS TABLE (
  workspace_id uuid,
  new_security_alerts boolean,
  new_conversation_alerts boolean,
  assigned_reply_alerts boolean,
  every_message_alerts boolean,
  updated_at timestamptz
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $$
BEGIN
  IF NOT public.is_workspace_operator(_workspace_id, auth.uid()) THEN
    RAISE EXCEPTION 'Not authorized' USING ERRCODE = '42501';
  END IF;

  RETURN QUERY
  SELECT _workspace_id,
         COALESCE(t.new_security_alerts, true),
         COALESCE(t.new_conversation_alerts, true),
         COALESCE(t.assigned_reply_alerts, true),
         COALESCE(t.every_message_alerts, false),
         t.updated_at
    FROM (SELECT 1) x
    LEFT JOIN public.project_inbox_team_preferences t
      ON t.workspace_id = _workspace_id AND t.user_id = auth.uid();
END;
$$;

REVOKE ALL ON FUNCTION public.get_my_project_inbox_team_preferences(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_my_project_inbox_team_preferences(uuid) TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.set_my_project_inbox_team_preferences(
  _workspace_id uuid,
  _new_security_alerts boolean,
  _new_conversation_alerts boolean,
  _assigned_reply_alerts boolean,
  _every_message_alerts boolean
)
RETURNS TABLE (
  workspace_id uuid,
  new_security_alerts boolean,
  new_conversation_alerts boolean,
  assigned_reply_alerts boolean,
  every_message_alerts boolean,
  updated_at timestamptz
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
BEGIN
  IF NOT public.is_workspace_operator(_workspace_id, auth.uid()) THEN
    RAISE EXCEPTION 'Not authorized' USING ERRCODE = '42501';
  END IF;

  RETURN QUERY
  INSERT INTO public.project_inbox_team_preferences AS t
    (workspace_id, user_id, new_security_alerts, new_conversation_alerts, assigned_reply_alerts, every_message_alerts, updated_at)
  VALUES
    (_workspace_id, auth.uid(),
     COALESCE(_new_security_alerts, true),
     COALESCE(_new_conversation_alerts, true),
     COALESCE(_assigned_reply_alerts, true),
     COALESCE(_every_message_alerts, false),
     now())
  ON CONFLICT (workspace_id, user_id) DO UPDATE
    SET new_security_alerts = COALESCE(EXCLUDED.new_security_alerts, true),
        new_conversation_alerts = COALESCE(EXCLUDED.new_conversation_alerts, true),
        assigned_reply_alerts = COALESCE(EXCLUDED.assigned_reply_alerts, true),
        every_message_alerts = COALESCE(EXCLUDED.every_message_alerts, false),
        updated_at = now()
  RETURNING t.workspace_id, t.new_security_alerts, t.new_conversation_alerts, t.assigned_reply_alerts, t.every_message_alerts, t.updated_at;
END;
$$;

REVOKE ALL ON FUNCTION public.set_my_project_inbox_team_preferences(uuid, boolean, boolean, boolean, boolean) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.set_my_project_inbox_team_preferences(uuid, boolean, boolean, boolean, boolean) TO authenticated, service_role;