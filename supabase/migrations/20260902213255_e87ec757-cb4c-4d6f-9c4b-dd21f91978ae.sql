-- =====================================================================
-- C7.3D D1 — Durable web team replies foundation
-- =====================================================================

-- ---------------------------------------------------------------- columns
ALTER TABLE public.project_inbox_deliveries
  ADD COLUMN IF NOT EXISTS workspace_id uuid,
  ADD COLUMN IF NOT EXISTS team_user_id uuid,
  ADD COLUMN IF NOT EXISTS body_snapshot text,
  ADD COLUMN IF NOT EXISTS acknowledged_at timestamptz,
  ADD COLUMN IF NOT EXISTS acknowledged_by uuid;

UPDATE public.project_inbox_deliveries d
   SET workspace_id = COALESCE(d.workspace_id, c.workspace_id),
       team_user_id = COALESCE(d.team_user_id, m.team_user_id),
       body_snapshot = COALESCE(d.body_snapshot, m.body)
  FROM public.project_conversations c,
       public.project_conversation_messages m
 WHERE c.id = d.conversation_id
   AND m.id = d.message_id
   AND (d.workspace_id IS NULL OR d.team_user_id IS NULL OR d.body_snapshot IS NULL);

DELETE FROM public.project_inbox_deliveries
 WHERE workspace_id IS NULL OR team_user_id IS NULL OR body_snapshot IS NULL;

ALTER TABLE public.project_inbox_deliveries
  ALTER COLUMN workspace_id SET NOT NULL,
  ALTER COLUMN team_user_id SET NOT NULL,
  ALTER COLUMN body_snapshot SET NOT NULL;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
     WHERE conrelid = 'public.project_inbox_deliveries'::regclass
       AND conname = 'project_inbox_deliveries_body_snapshot_len'
  ) THEN
    ALTER TABLE public.project_inbox_deliveries
      ADD CONSTRAINT project_inbox_deliveries_body_snapshot_len
      CHECK (char_length(btrim(body_snapshot)) BETWEEN 1 AND 4096);
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
     WHERE conrelid = 'public.project_inbox_deliveries'::regclass
       AND conname = 'project_inbox_deliveries_ack_shape'
  ) THEN
    ALTER TABLE public.project_inbox_deliveries
      ADD CONSTRAINT project_inbox_deliveries_ack_shape
      CHECK (
        (acknowledged_at IS NULL AND acknowledged_by IS NULL)
        OR (acknowledged_at IS NOT NULL AND acknowledged_by IS NOT NULL
            AND status IN ('ambiguous', 'failed'))
      );
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS project_inbox_deliveries_workspace_idx
  ON public.project_inbox_deliveries (workspace_id, created_at DESC);

-- --------------------------------------------------- message state trigger
-- A written TEAM reply is NOT yet delivered. The conversation only moves to
-- WAITING_ON_MEMBER once the delivery worker confirms Telegram accepted it
-- (see finalize_project_inbox_delivery). MEMBER behaviour is unchanged.
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

-- ------------------------------------------------------- create team reply
CREATE OR REPLACE FUNCTION public.create_project_inbox_team_reply(
  _workspace_id uuid,
  _conversation_id uuid,
  _body text,
  _client_request_id text
)
 RETURNS TABLE(message_id uuid, delivery_id uuid, delivery_status text, replayed boolean)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_uid uuid := auth.uid();
  v_body text := btrim(COALESCE(_body, ''));
  v_request text := btrim(COALESCE(_client_request_id, ''));
  v_conv public.project_conversations%ROWTYPE;
  v_contact public.project_inbox_contacts%ROWTYPE;
  v_replies_enabled boolean;
  v_existing_message uuid;
  v_existing_delivery uuid;
  v_existing_status text;
  v_message_id uuid;
  v_delivery_id uuid;
BEGIN
  IF _workspace_id IS NULL OR _conversation_id IS NULL OR v_uid IS NULL THEN
    RAISE EXCEPTION 'Not authorized' USING ERRCODE = '42501';
  END IF;

  -- Operator of the ACTIVE workspace first; wrong workspace and nonexistent
  -- conversation fail identically.
  IF NOT public.is_workspace_operator(_workspace_id, v_uid) THEN
    RAISE EXCEPTION 'Not authorized' USING ERRCODE = '42501';
  END IF;

  IF char_length(v_request) NOT BETWEEN 8 AND 100 THEN
    RAISE EXCEPTION 'A request id is required' USING ERRCODE = '22023';
  END IF;

  SELECT * INTO v_conv
    FROM public.project_conversations
   WHERE id = _conversation_id
     AND workspace_id = _workspace_id
   FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Not authorized' USING ERRCODE = '42501';
  END IF;

  -- Idempotent replay: the same client request never sends twice.
  SELECT m.id INTO v_existing_message
    FROM public.project_conversation_messages m
   WHERE m.conversation_id = _conversation_id
     AND m.client_request_id = v_request;
  IF FOUND THEN
    SELECT d.id, d.status INTO v_existing_delivery, v_existing_status
      FROM public.project_inbox_deliveries d
     WHERE d.message_id = v_existing_message;
    RETURN QUERY SELECT v_existing_message, v_existing_delivery, v_existing_status, true;
    RETURN;
  END IF;

  IF char_length(v_body) NOT BETWEEN 1 AND 4096 THEN
    RAISE EXCEPTION 'Reply must be between 1 and 4096 characters' USING ERRCODE = '22023';
  END IF;

  SELECT s.replies_enabled INTO v_replies_enabled
    FROM public.project_inbox_settings s
   WHERE s.workspace_id = _workspace_id;
  IF COALESCE(v_replies_enabled, false) IS NOT TRUE THEN
    RAISE EXCEPTION 'Reply capture is off for this workspace' USING ERRCODE = '22023';
  END IF;

  SELECT * INTO v_contact
    FROM public.project_inbox_contacts
   WHERE id = v_conv.contact_id
     AND workspace_id = _workspace_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Not authorized' USING ERRCODE = '42501';
  END IF;
  IF v_contact.status <> 'ACTIVE' THEN
    RAISE EXCEPTION 'This member is blocked' USING ERRCODE = '22023';
  END IF;

  INSERT INTO public.project_conversation_messages
    (conversation_id, author_type, channel, team_user_id, body, client_request_id)
  VALUES
    (_conversation_id, 'TEAM', 'WEB', v_uid, v_body, v_request)
  RETURNING id INTO v_message_id;

  INSERT INTO public.project_inbox_deliveries
    (conversation_id, message_id, workspace_id, team_user_id, telegram_user_id,
     body_snapshot, status, next_attempt_at)
  VALUES
    (_conversation_id, v_message_id, _workspace_id, v_uid, v_contact.telegram_user_id,
     v_body, 'pending', now())
  RETURNING id INTO v_delivery_id;

  RETURN QUERY SELECT v_message_id, v_delivery_id, 'pending'::text, false;
END;
$function$;

REVOKE ALL ON FUNCTION public.create_project_inbox_team_reply(uuid, uuid, text, text) FROM public, anon;
GRANT EXECUTE ON FUNCTION public.create_project_inbox_team_reply(uuid, uuid, text, text) TO authenticated, service_role;

-- --------------------------------------------- acknowledge uncertain result
CREATE OR REPLACE FUNCTION public.acknowledge_project_inbox_delivery(
  _workspace_id uuid,
  _delivery_id uuid
)
 RETURNS TABLE(delivery_id uuid, status text, acknowledged_at timestamptz)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_uid uuid := auth.uid();
  v_status text;
  v_ack timestamptz;
BEGIN
  IF _workspace_id IS NULL OR _delivery_id IS NULL OR v_uid IS NULL THEN
    RAISE EXCEPTION 'Not authorized' USING ERRCODE = '42501';
  END IF;
  IF NOT public.is_workspace_operator(_workspace_id, v_uid) THEN
    RAISE EXCEPTION 'Not authorized' USING ERRCODE = '42501';
  END IF;

  UPDATE public.project_inbox_deliveries d
     SET acknowledged_at = COALESCE(d.acknowledged_at, now()),
         acknowledged_by = COALESCE(d.acknowledged_by, v_uid),
         updated_at = now()
   WHERE d.id = _delivery_id
     AND d.workspace_id = _workspace_id
     AND d.status IN ('ambiguous', 'failed')
   RETURNING d.status, d.acknowledged_at INTO v_status, v_ack;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Not authorized' USING ERRCODE = '42501';
  END IF;

  RETURN QUERY SELECT _delivery_id, v_status, v_ack;
END;
$function$;

REVOKE ALL ON FUNCTION public.acknowledge_project_inbox_delivery(uuid, uuid) FROM public, anon;
GRANT EXECUTE ON FUNCTION public.acknowledge_project_inbox_delivery(uuid, uuid) TO authenticated, service_role;

-- ------------------------------------------------------------- claim (v2)
DROP FUNCTION IF EXISTS public.claim_project_inbox_deliveries(integer);

CREATE OR REPLACE FUNCTION public.claim_project_inbox_deliveries(_limit integer DEFAULT 100)
 RETURNS TABLE(
   delivery_id uuid,
   conversation_id uuid,
   message_id uuid,
   workspace_id uuid,
   team_user_id uuid,
   telegram_user_id bigint,
   body_snapshot text,
   attempt_count integer,
   contact_blocked boolean,
   replies_enabled boolean
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
       AND NOT EXISTS (
         SELECT 1
           FROM public.project_conversation_messages em
           JOIN public.project_inbox_deliveries e
             ON e.message_id = em.id
            AND e.conversation_id = em.conversation_id
          WHERE em.conversation_id = m.conversation_id
            AND (em.created_at, em.id) < (m.created_at, m.id)
            AND e.status IN ('pending', 'processing', 'retry', 'ambiguous')
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
     RETURNING d.id, d.conversation_id, d.message_id, d.workspace_id, d.team_user_id,
               d.telegram_user_id, d.body_snapshot, d.attempt_count
  )
  -- The worker never reads live message text: the frozen snapshot taken at
  -- send time is authoritative. Blocked-contact and reply-capture state are
  -- re-read at claim time so the worker can refuse a now-forbidden send.
  SELECT cl.id, cl.conversation_id, cl.message_id, cl.workspace_id, cl.team_user_id,
         cl.telegram_user_id, cl.body_snapshot, cl.attempt_count,
         (ct.status <> 'ACTIVE'),
         COALESCE(s.replies_enabled, false)
    FROM claimed cl
    JOIN public.project_conversations conv ON conv.id = cl.conversation_id
    JOIN public.project_inbox_contacts ct ON ct.id = conv.contact_id
    LEFT JOIN public.project_inbox_settings s ON s.workspace_id = cl.workspace_id;
END;
$function$;

REVOKE ALL ON FUNCTION public.claim_project_inbox_deliveries(integer) FROM public, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.claim_project_inbox_deliveries(integer) TO service_role;

-- -------------------------------------------------------------- finalize
CREATE OR REPLACE FUNCTION public.finalize_project_inbox_delivery(
  _delivery_id uuid,
  _outcome text,
  _telegram_message_id bigint DEFAULT NULL,
  _error_class text DEFAULT NULL,
  _last_error text DEFAULT NULL,
  _retry_after_seconds integer DEFAULT NULL
)
 RETURNS text
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_delivery public.project_inbox_deliveries%ROWTYPE;
  v_wait integer := LEAST(GREATEST(COALESCE(_retry_after_seconds, 60), 1), 3600);
  v_error text := left(COALESCE(_last_error, ''), 1000);
BEGIN
  IF _delivery_id IS NULL OR _outcome NOT IN ('sent', 'retry', 'failed', 'ambiguous') THEN
    RAISE EXCEPTION 'Invalid delivery outcome' USING ERRCODE = '22023';
  END IF;

  SELECT * INTO v_delivery
    FROM public.project_inbox_deliveries
   WHERE id = _delivery_id
   FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Unknown delivery' USING ERRCODE = '22023';
  END IF;

  -- Only a claim in flight may be finalized. Anything else is a no-op so a
  -- duplicate worker report can never rewrite a settled outcome.
  IF v_delivery.status <> 'processing' THEN
    RETURN v_delivery.status;
  END IF;

  IF _outcome = 'sent' THEN
    IF _telegram_message_id IS NULL THEN
      RAISE EXCEPTION 'A delivered reply requires a Telegram message id' USING ERRCODE = '22023';
    END IF;
    UPDATE public.project_inbox_deliveries
       SET status = 'sent',
           sent_at = now(),
           telegram_message_id = _telegram_message_id,
           claimed_at = NULL,
           error_class = NULL,
           last_error = NULL,
           updated_at = now()
     WHERE id = _delivery_id;

    -- Delivery — not authoring — is what hands the thread back to the member.
    UPDATE public.project_conversations c
       SET status = CASE WHEN c.status = 'RESOLVED' THEN c.status ELSE 'WAITING_ON_MEMBER' END,
           updated_at = now()
     WHERE c.id = v_delivery.conversation_id;

  ELSIF _outcome = 'retry' THEN
    UPDATE public.project_inbox_deliveries
       SET status = 'retry',
           claimed_at = NULL,
           next_attempt_at = now() + make_interval(secs => v_wait),
           error_class = _error_class,
           last_error = NULLIF(v_error, ''),
           updated_at = now()
     WHERE id = _delivery_id;

  ELSE
    UPDATE public.project_inbox_deliveries
       SET status = _outcome,
           claimed_at = NULL,
           error_class = _error_class,
           last_error = NULLIF(v_error, ''),
           updated_at = now()
     WHERE id = _delivery_id;
  END IF;

  RETURN _outcome;
END;
$function$;

REVOKE ALL ON FUNCTION public.finalize_project_inbox_delivery(uuid, text, bigint, text, text, integer) FROM public, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.finalize_project_inbox_delivery(uuid, text, bigint, text, text, integer) TO service_role;

-- ------------------------------------------------- message list with state
DROP FUNCTION IF EXISTS public.list_project_conversation_messages(uuid, integer);

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
   delivery_id uuid,
   delivery_status text,
   delivery_error_class text,
   delivery_acknowledged_at timestamp with time zone
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

  -- Delivery metadata is operational state only: no Telegram identifiers and
  -- no raw provider payloads are ever returned to the browser.
  RETURN QUERY
  SELECT m.id, m.author_type, m.channel, m.body, p.display_name, m.created_at, m.reply_to_message_id,
         d.id, d.status, d.error_class, d.acknowledged_at
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
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM vault.secrets WHERE name = 'project_inbox_delivery_scheduler_secret'
  ) THEN
    PERFORM vault.create_secret(
      encode(gen_random_bytes(32), 'hex'),
      'project_inbox_delivery_scheduler_secret',
      'Scheduler secret for the project-inbox-delivery worker'
    );
  END IF;
END $$;

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
