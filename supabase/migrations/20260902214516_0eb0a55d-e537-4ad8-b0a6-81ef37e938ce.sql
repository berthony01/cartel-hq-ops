-- =====================================================================
-- C7.3D D1 CORRECTION — Project Inbox durable team replies
-- Replaces the rejected D1 surface with the frozen contract.
-- =====================================================================

-- ------------------------------------------------ drop rejected functions
DROP FUNCTION IF EXISTS public.create_project_inbox_team_reply(uuid, uuid, text, text);
DROP FUNCTION IF EXISTS public.acknowledge_project_inbox_delivery(uuid, uuid);
DROP FUNCTION IF EXISTS public.finalize_project_inbox_delivery(uuid, text, bigint, text, text, integer);
DROP FUNCTION IF EXISTS public.claim_project_inbox_deliveries(integer);
DROP FUNCTION IF EXISTS public.list_project_conversation_messages(uuid, integer);

-- ------------------------------------------- drop rejected table surface
ALTER TABLE public.project_inbox_deliveries
  DROP CONSTRAINT IF EXISTS project_inbox_deliveries_ack_shape,
  DROP CONSTRAINT IF EXISTS project_inbox_deliveries_body_snapshot_len;

DROP INDEX IF EXISTS public.project_inbox_deliveries_workspace_idx;

ALTER TABLE public.project_inbox_deliveries
  DROP COLUMN IF EXISTS workspace_id,
  DROP COLUMN IF EXISTS team_user_id,
  DROP COLUMN IF EXISTS body_snapshot,
  DROP COLUMN IF EXISTS acknowledged_at,
  DROP COLUMN IF EXISTS acknowledged_by;

-- --------------------------------------------------- corrected D1 fields
ALTER TABLE public.project_inbox_deliveries
  ADD COLUMN IF NOT EXISTS template_version text,
  ADD COLUMN IF NOT EXISTS project_name_snapshot text,
  ADD COLUMN IF NOT EXISTS ticker_snapshot text,
  ADD COLUMN IF NOT EXISTS delivered_text_snapshot text,
  ADD COLUMN IF NOT EXISTS uncertainty_acknowledged_at timestamptz,
  ADD COLUMN IF NOT EXISTS uncertainty_acknowledged_by uuid;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid = 'public.project_inbox_deliveries'::regclass AND conname = 'project_inbox_deliveries_template_chk') THEN
    ALTER TABLE public.project_inbox_deliveries
      ADD CONSTRAINT project_inbox_deliveries_template_chk
      CHECK (template_version IS NULL OR template_version = 'telegram_text_v1');
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid = 'public.project_inbox_deliveries'::regclass AND conname = 'project_inbox_deliveries_project_name_chk') THEN
    ALTER TABLE public.project_inbox_deliveries
      ADD CONSTRAINT project_inbox_deliveries_project_name_chk
      CHECK (project_name_snapshot IS NULL OR char_length(btrim(project_name_snapshot)) BETWEEN 1 AND 120);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid = 'public.project_inbox_deliveries'::regclass AND conname = 'project_inbox_deliveries_ticker_chk') THEN
    ALTER TABLE public.project_inbox_deliveries
      ADD CONSTRAINT project_inbox_deliveries_ticker_chk
      CHECK (ticker_snapshot IS NULL OR char_length(ticker_snapshot) <= 20);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid = 'public.project_inbox_deliveries'::regclass AND conname = 'project_inbox_deliveries_delivered_text_chk') THEN
    ALTER TABLE public.project_inbox_deliveries
      ADD CONSTRAINT project_inbox_deliveries_delivered_text_chk
      CHECK (delivered_text_snapshot IS NULL OR char_length(delivered_text_snapshot) BETWEEN 1 AND 4096);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid = 'public.project_inbox_deliveries'::regclass AND conname = 'project_inbox_deliveries_uncertainty_ack_shape') THEN
    ALTER TABLE public.project_inbox_deliveries
      ADD CONSTRAINT project_inbox_deliveries_uncertainty_ack_shape
      CHECK ((uncertainty_acknowledged_at IS NULL AND uncertainty_acknowledged_by IS NULL)
          OR (uncertainty_acknowledged_at IS NOT NULL AND uncertainty_acknowledged_by IS NOT NULL));
  END IF;
END $$;

-- ------------------------------------------------- message state trigger
-- Authoring a TEAM reply does NOT hand the thread back to the member; only a
-- CONFIRMED delivery does (see finalize_project_inbox_delivery).
CREATE OR REPLACE FUNCTION public.project_inbox_apply_message_state()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
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
$function$;

-- ------------------------------------------------------ create team reply
CREATE OR REPLACE FUNCTION public.create_project_inbox_team_reply(
  _workspace_id uuid,
  _conversation_id uuid,
  _body text,
  _client_request_id uuid
)
 RETURNS TABLE(message_id uuid, delivery_status text, created_at timestamptz, conversation_status text, idempotent_replay boolean)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_uid uuid := auth.uid();
  v_body text := btrim(COALESCE(_body, ''));
  v_msg public.project_conversation_messages%ROWTYPE;
  v_conv public.project_conversations%ROWTYPE;
  v_contact public.project_inbox_contacts%ROWTYPE;
  v_status text;
  v_conv_status text;
  v_name text;
  v_ticker text;
  v_delivered text;
  v_new_message_id uuid;
  v_created_at timestamptz;
BEGIN
  IF _workspace_id IS NULL OR _conversation_id IS NULL OR _client_request_id IS NULL OR v_uid IS NULL THEN
    RAISE EXCEPTION 'Not authorized' USING ERRCODE = '42501';
  END IF;

  IF NOT public.is_workspace_operator(_workspace_id, v_uid) THEN
    RAISE EXCEPTION 'Not authorized' USING ERRCODE = '42501';
  END IF;

  IF char_length(v_body) < 1 OR char_length(v_body) > 3500 THEN
    RAISE EXCEPTION 'Reply must be between 1 and 3500 characters' USING ERRCODE = '22023';
  END IF;

  -- Idempotency BEFORE current-state validation: an already accepted request
  -- must replay exactly, even if the contact/profile/status changed since.
  SELECT m.* INTO v_msg
    FROM public.project_conversation_messages m
    JOIN public.project_conversations c ON c.id = m.conversation_id
   WHERE m.conversation_id = _conversation_id
     AND c.workspace_id = _workspace_id
     AND m.client_request_id = _client_request_id;
  IF FOUND THEN
    IF v_msg.author_type <> 'TEAM'
       OR v_msg.channel <> 'WEB'
       OR v_msg.team_user_id IS DISTINCT FROM v_uid
       OR btrim(v_msg.body) <> v_body THEN
      RAISE EXCEPTION 'This request id was already used for a different reply' USING ERRCODE = '22023';
    END IF;
    SELECT d.status INTO v_status FROM public.project_inbox_deliveries d WHERE d.message_id = v_msg.id;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'This request id was already used for a different reply' USING ERRCODE = '22023';
    END IF;
    SELECT c.status INTO v_conv_status FROM public.project_conversations c WHERE c.id = _conversation_id;
    RETURN QUERY SELECT v_msg.id, v_status, v_msg.created_at, v_conv_status, true;
    RETURN;
  END IF;

  SELECT * INTO v_conv
    FROM public.project_conversations c
   WHERE c.id = _conversation_id
     AND c.workspace_id = _workspace_id
   FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Not authorized' USING ERRCODE = '42501';
  END IF;

  -- Recheck under the conversation lock to close a concurrent same-request race.
  SELECT m.* INTO v_msg
    FROM public.project_conversation_messages m
   WHERE m.conversation_id = _conversation_id
     AND m.client_request_id = _client_request_id;
  IF FOUND THEN
    IF v_msg.author_type <> 'TEAM'
       OR v_msg.channel <> 'WEB'
       OR v_msg.team_user_id IS DISTINCT FROM v_uid
       OR btrim(v_msg.body) <> v_body THEN
      RAISE EXCEPTION 'This request id was already used for a different reply' USING ERRCODE = '22023';
    END IF;
    SELECT d.status INTO v_status FROM public.project_inbox_deliveries d WHERE d.message_id = v_msg.id;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'This request id was already used for a different reply' USING ERRCODE = '22023';
    END IF;
    RETURN QUERY SELECT v_msg.id, v_status, v_msg.created_at, v_conv.status, true;
    RETURN;
  END IF;

  IF v_conv.status = 'RESOLVED' THEN
    RAISE EXCEPTION 'This conversation is resolved. Reopen it before replying.' USING ERRCODE = '22023';
  END IF;

  SELECT * INTO v_contact
    FROM public.project_inbox_contacts ct
   WHERE ct.id = v_conv.contact_id
     AND ct.workspace_id = _workspace_id
   FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Not authorized' USING ERRCODE = '42501';
  END IF;
  IF v_contact.status <> 'ACTIVE' THEN
    RAISE EXCEPTION 'This member is blocked' USING ERRCODE = '22023';
  END IF;

  -- An unresolved earlier delivery must be settled or acknowledged first.
  IF EXISTS (
    SELECT 1 FROM public.project_inbox_deliveries d
     WHERE d.conversation_id = _conversation_id
       AND (d.status IN ('pending', 'processing', 'retry')
            OR (d.status = 'ambiguous' AND d.uncertainty_acknowledged_at IS NULL))
  ) THEN
    RAISE EXCEPTION 'An earlier reply in this conversation is not settled yet' USING ERRCODE = '22023';
  END IF;

  SELECT btrim(p.project_name), NULLIF(btrim(COALESCE(p.ticker, '')), '')
    INTO v_name, v_ticker
    FROM public.project_profiles p
   WHERE p.workspace_id = _workspace_id;
  IF v_name IS NULL OR char_length(v_name) < 1 THEN
    RAISE EXCEPTION 'Save your Project Profile name before replying' USING ERRCODE = '22023';
  END IF;

  v_delivered := v_name
    || CASE WHEN v_ticker IS NULL THEN '' ELSE ' · ' || v_ticker END
    || E'\nOFFICIAL PROJECT RESPONSE\n\n'
    || v_body
    || E'\n\nOfficial response through @PepeCartelHQBot';

  IF char_length(v_delivered) < 1 OR char_length(v_delivered) > 4096 THEN
    RAISE EXCEPTION 'This reply is too long to deliver' USING ERRCODE = '22023';
  END IF;

  INSERT INTO public.project_conversation_messages
    (conversation_id, author_type, channel, team_user_id, body, client_request_id)
  VALUES
    (_conversation_id, 'TEAM', 'WEB', v_uid, v_body, _client_request_id)
  RETURNING id, project_conversation_messages.created_at INTO v_new_message_id, v_created_at;

  INSERT INTO public.project_inbox_deliveries
    (conversation_id, message_id, telegram_user_id, status, next_attempt_at,
     template_version, project_name_snapshot, ticker_snapshot, delivered_text_snapshot)
  VALUES
    (_conversation_id, v_new_message_id, v_contact.telegram_user_id, 'pending', now(),
     'telegram_text_v1', v_name, v_ticker, v_delivered);

  SELECT c.status INTO v_conv_status FROM public.project_conversations c WHERE c.id = _conversation_id;

  RETURN QUERY SELECT v_new_message_id, 'pending'::text, v_created_at, v_conv_status, false;
END;
$function$;

REVOKE ALL ON FUNCTION public.create_project_inbox_team_reply(uuid, uuid, text, uuid) FROM public, anon;
GRANT EXECUTE ON FUNCTION public.create_project_inbox_team_reply(uuid, uuid, text, uuid) TO authenticated, service_role;

-- ------------------------------------------- acknowledge delivery uncertainty
CREATE OR REPLACE FUNCTION public.acknowledge_project_inbox_delivery_uncertainty(
  _workspace_id uuid,
  _conversation_id uuid,
  _message_id uuid
)
 RETURNS TABLE(message_id uuid, delivery_status text, uncertainty_acknowledged_at timestamptz)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_uid uuid := auth.uid();
  v_delivery_id uuid;
  v_status text;
  v_ack timestamptz;
BEGIN
  IF _workspace_id IS NULL OR _conversation_id IS NULL OR _message_id IS NULL OR v_uid IS NULL THEN
    RAISE EXCEPTION 'Not authorized' USING ERRCODE = '42501';
  END IF;
  IF NOT public.is_workspace_operator(_workspace_id, v_uid) THEN
    RAISE EXCEPTION 'Not authorized' USING ERRCODE = '42501';
  END IF;

  SELECT d.id, d.status, d.uncertainty_acknowledged_at
    INTO v_delivery_id, v_status, v_ack
    FROM public.project_inbox_deliveries d
    JOIN public.project_conversations c ON c.id = d.conversation_id
   WHERE d.conversation_id = _conversation_id
     AND d.message_id = _message_id
     AND c.workspace_id = _workspace_id
   FOR UPDATE OF d;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Not authorized' USING ERRCODE = '42501';
  END IF;

  -- ONLY an uncertain delivery is acknowledgeable. A failed delivery is
  -- already settled and needs no acknowledgement.
  IF v_status <> 'ambiguous' THEN
    RAISE EXCEPTION 'Only an uncertain delivery can be acknowledged' USING ERRCODE = '22023';
  END IF;

  IF v_ack IS NULL THEN
    UPDATE public.project_inbox_deliveries d
       SET uncertainty_acknowledged_at = now(),
           uncertainty_acknowledged_by = v_uid,
           updated_at = now()
     WHERE d.id = v_delivery_id
     RETURNING d.uncertainty_acknowledged_at INTO v_ack;
  END IF;

  RETURN QUERY SELECT _message_id, v_status, v_ack;
END;
$function$;

REVOKE ALL ON FUNCTION public.acknowledge_project_inbox_delivery_uncertainty(uuid, uuid, uuid) FROM public, anon;
GRANT EXECUTE ON FUNCTION public.acknowledge_project_inbox_delivery_uncertainty(uuid, uuid, uuid) TO authenticated, service_role;

-- --------------------------------------------------------------- claim
CREATE OR REPLACE FUNCTION public.claim_project_inbox_deliveries(_limit integer DEFAULT 100)
 RETURNS TABLE(
   delivery_id uuid,
   conversation_id uuid,
   message_id uuid,
   telegram_user_id bigint,
   delivered_text_snapshot text,
   attempt_count integer,
   workspace_id uuid,
   team_user_id uuid
 )
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_limit integer := LEAST(GREATEST(COALESCE(_limit, 100), 1), 250);
BEGIN
  RETURN QUERY
  WITH candidate AS (
    SELECT d.id
      FROM public.project_inbox_deliveries d
      JOIN public.project_conversation_messages m
        ON m.id = d.message_id
       AND m.conversation_id = d.conversation_id
     WHERE d.status IN ('pending', 'retry')
       AND d.next_attempt_at <= now()
       AND d.delivered_text_snapshot IS NOT NULL
       AND NOT EXISTS (
         SELECT 1
           FROM public.project_conversation_messages em
           JOIN public.project_inbox_deliveries e
             ON e.message_id = em.id
            AND e.conversation_id = em.conversation_id
          WHERE em.conversation_id = m.conversation_id
            AND (em.created_at, em.id) < (m.created_at, m.id)
            AND (e.status IN ('pending', 'processing', 'retry')
                 OR (e.status = 'ambiguous' AND e.uncertainty_acknowledged_at IS NULL))
       )
     ORDER BY d.next_attempt_at ASC, m.created_at ASC, m.id ASC, d.id ASC
     LIMIT v_limit
     FOR UPDATE OF d SKIP LOCKED
  ),
  claimed AS (
    UPDATE public.project_inbox_deliveries d
       SET status = 'processing',
           claimed_at = now(),
           attempt_count = d.attempt_count + 1,
           updated_at = now()
      FROM candidate c
     WHERE d.id = c.id
     RETURNING d.id, d.conversation_id, d.message_id, d.telegram_user_id,
               d.delivered_text_snapshot, d.attempt_count
  )
  -- The worker only ever sees the FROZEN delivered text; live message body,
  -- contact state and settings are revalidated by the worker itself.
  SELECT cl.id, cl.conversation_id, cl.message_id, cl.telegram_user_id,
         cl.delivered_text_snapshot, cl.attempt_count,
         conv.workspace_id, m2.team_user_id
    FROM claimed cl
    JOIN public.project_conversations conv ON conv.id = cl.conversation_id
    JOIN public.project_conversation_messages m2 ON m2.id = cl.message_id;
END;
$function$;

REVOKE ALL ON FUNCTION public.claim_project_inbox_deliveries(integer) FROM public, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.claim_project_inbox_deliveries(integer) TO service_role;

-- ------------------------------------------------------------- finalize
CREATE OR REPLACE FUNCTION public.finalize_project_inbox_delivery(
  _delivery_id uuid,
  _outcome text,
  _telegram_message_id bigint DEFAULT NULL,
  _next_attempt_at timestamptz DEFAULT NULL,
  _error_class text DEFAULT NULL,
  _last_error text DEFAULT NULL
)
 RETURNS TABLE(delivery_id uuid, status text, next_attempt_at timestamptz, sent_at timestamptz)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_delivery public.project_inbox_deliveries%ROWTYPE;
  v_msg public.project_conversation_messages%ROWTYPE;
  v_error_class text := NULLIF(left(COALESCE(_error_class, ''), 120), '');
  v_last_error text := NULLIF(left(COALESCE(_last_error, ''), 1000), '');
  v_is_latest boolean;
  v_out public.project_inbox_deliveries%ROWTYPE;
BEGIN
  IF _delivery_id IS NULL OR _outcome IS NULL OR _outcome NOT IN ('sent', 'retry', 'failed', 'ambiguous') THEN
    RAISE EXCEPTION 'Invalid delivery outcome' USING ERRCODE = '22023';
  END IF;

  SELECT * INTO v_delivery
    FROM public.project_inbox_deliveries d
   WHERE d.id = _delivery_id
   FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Unknown delivery' USING ERRCODE = '22023';
  END IF;

  -- Settled history is never rewritten: only an in-flight claim is finalizable.
  IF v_delivery.status <> 'processing' THEN
    RAISE EXCEPTION 'This delivery is not in flight' USING ERRCODE = '22023';
  END IF;

  IF _outcome = 'sent' THEN
    IF _telegram_message_id IS NULL OR _telegram_message_id <= 0 THEN
      RAISE EXCEPTION 'A delivered reply requires a Telegram message id' USING ERRCODE = '22023';
    END IF;

    UPDATE public.project_inbox_deliveries d
       SET status = 'sent',
           sent_at = now(),
           telegram_message_id = _telegram_message_id,
           claimed_at = NULL,
           error_class = NULL,
           last_error = NULL,
           updated_at = now()
     WHERE d.id = _delivery_id
     RETURNING d.* INTO v_out;

    SELECT * INTO v_msg
      FROM public.project_conversation_messages m
     WHERE m.id = v_delivery.message_id;

    SELECT NOT EXISTS (
      SELECT 1 FROM public.project_conversation_messages m2
       WHERE m2.conversation_id = v_delivery.conversation_id
         AND (m2.created_at, m2.id) > (v_msg.created_at, v_msg.id)
    ) INTO v_is_latest;

    -- Confirmed delivery hands the thread back to the member ONLY when this
    -- reply is still the newest message in the conversation.
    IF v_is_latest THEN
      UPDATE public.project_conversations c
         SET status = 'WAITING_ON_MEMBER',
             updated_at = now()
       WHERE c.id = v_delivery.conversation_id
         AND c.status <> 'RESOLVED';
    END IF;

  ELSIF _outcome = 'retry' THEN
    IF _next_attempt_at IS NULL OR _next_attempt_at <= now() THEN
      RAISE EXCEPTION 'A retry requires a future next attempt time' USING ERRCODE = '22023';
    END IF;
    UPDATE public.project_inbox_deliveries d
       SET status = 'retry',
           claimed_at = NULL,
           next_attempt_at = _next_attempt_at,
           error_class = v_error_class,
           last_error = v_last_error,
           updated_at = now()
     WHERE d.id = _delivery_id
     RETURNING d.* INTO v_out;

  ELSE
    UPDATE public.project_inbox_deliveries d
       SET status = _outcome,
           claimed_at = NULL,
           error_class = v_error_class,
           last_error = v_last_error,
           updated_at = now()
     WHERE d.id = _delivery_id
     RETURNING d.* INTO v_out;
  END IF;

  RETURN QUERY SELECT v_out.id, v_out.status, v_out.next_attempt_at, v_out.sent_at;
END;
$function$;

REVOKE ALL ON FUNCTION public.finalize_project_inbox_delivery(uuid, text, bigint, timestamptz, text, text) FROM public, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.finalize_project_inbox_delivery(uuid, text, bigint, timestamptz, text, text) TO service_role;

-- --------------------------------------------- browser-safe message list
CREATE OR REPLACE FUNCTION public.list_project_conversation_messages(
  _conversation_id uuid,
  _limit integer DEFAULT 100
)
 RETURNS TABLE(
   message_id uuid,
   author_type text,
   channel text,
   body text,
   team_display_name text,
   created_at timestamp with time zone,
   reply_to_message_id uuid,
   delivery_status text,
   delivery_sent_at timestamp with time zone,
   delivery_uncertainty_acknowledged_at timestamp with time zone
 )
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
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

  -- Delivery state only: no delivery id, no error class, no attempt counts,
  -- no Telegram identifiers and no provider payloads reach the browser.
  RETURN QUERY
  SELECT m.id, m.author_type, m.channel, m.body, p.display_name, m.created_at, m.reply_to_message_id,
         d.status, d.sent_at, d.uncertainty_acknowledged_at
    FROM public.project_conversation_messages m
    LEFT JOIN public.profiles p ON p.id = m.team_user_id
    LEFT JOIN public.project_inbox_deliveries d ON d.message_id = m.id
   WHERE m.conversation_id = _conversation_id
   ORDER BY m.created_at ASC, m.id ASC
   LIMIT v_limit;
END;
$function$;

REVOKE ALL ON FUNCTION public.list_project_conversation_messages(uuid, integer) FROM public, anon;
GRANT EXECUTE ON FUNCTION public.list_project_conversation_messages(uuid, integer) TO authenticated, service_role;

-- ------------------------------------------------------- scheduler secret
CREATE OR REPLACE FUNCTION public.project_inbox_delivery_scheduler_secret_matches(p_secret text)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'vault'
AS $function$
  select exists (
    select 1
    from vault.decrypted_secrets
    where name = 'project_inbox_delivery_scheduler_secret'
      and decrypted_secret = p_secret
  );
$function$;

REVOKE ALL ON FUNCTION public.project_inbox_delivery_scheduler_secret_matches(text) FROM public, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.project_inbox_delivery_scheduler_secret_matches(text) TO service_role;