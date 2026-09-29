-- SP-B1 Partner Project Inbox
-- STAGED ONLY. NOT APPLIED. Apply only at checkpoint CP-SPB1-SQL, AFTER SP-B0
-- (docs/sql/SP_B0_commercial_workspace_entitlement_core.sql) is applied and verified.
--
-- Additive partner-only RPCs. Every entry point:
--   * requires auth.uid()
--   * requires public.partner_has_scope(_workspace_id, 'project_inbox')
--   * resolves conversations/messages ONLY by id AND workspace_id
--   * SECURITY DEFINER with SET search_path TO '' and fully qualified names
-- Guards are copied from the owner inbox RPCs (unchanged, not replaced):
--   create_project_inbox_team_reply, update_project_conversation_status,
--   acknowledge_project_inbox_delivery_uncertainty, get/list inbox functions.
-- NOT provided to partners: inbox settings, block/unblock, Telegram identifiers.
-- No table, RLS, constraint, trigger, membership-helper, owner-RPC or Edge Function change.
-- Rollback: REVOKE EXECUTE on the seven partner_inbox_* functions from authenticated.

BEGIN;

CREATE OR REPLACE FUNCTION public.partner_inbox_summary(_workspace_id uuid)
 RETURNS TABLE(open_count integer, waiting_on_team_count integer, waiting_on_member_count integer, resolved_count integer, blocked_contact_count integer)
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
BEGIN
  IF auth.uid() IS NULL OR _workspace_id IS NULL
     OR NOT public.partner_has_scope(_workspace_id, 'project_inbox') THEN
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
$function$;

CREATE OR REPLACE FUNCTION public.partner_inbox_list_conversations(_workspace_id uuid, _status text DEFAULT NULL::text, _limit integer DEFAULT 50)
 RETURNS TABLE(conversation_id uuid, member_ref text, contact_status text, category text, status text, priority text, origin_type text, origin_title_snapshot text, latest_message_preview text, last_message_at timestamp with time zone, opened_at timestamp with time zone, assigned_to uuid, assigned_display_name text)
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
DECLARE
  v_limit integer := LEAST(GREATEST(COALESCE(_limit, 50), 1), 100);
BEGIN
  IF auth.uid() IS NULL OR _workspace_id IS NULL
     OR NOT public.partner_has_scope(_workspace_id, 'project_inbox') THEN
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
$function$;

CREATE OR REPLACE FUNCTION public.partner_inbox_get_conversation(_workspace_id uuid, _conversation_id uuid)
 RETURNS TABLE(conversation_id uuid, member_ref text, contact_status text, category text, status text, priority text, origin_type text, origin_title_snapshot text, origin_text_snapshot text, last_message_at timestamp with time zone, opened_at timestamp with time zone, resolved_at timestamp with time zone, assigned_to uuid, assigned_display_name text)
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
BEGIN
  IF auth.uid() IS NULL OR _workspace_id IS NULL OR _conversation_id IS NULL
     OR NOT public.partner_has_scope(_workspace_id, 'project_inbox') THEN
    RAISE EXCEPTION 'Not authorized' USING ERRCODE = '42501';
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
         c.origin_text_snapshot,
         c.last_message_at,
         c.opened_at,
         c.resolved_at,
         c.assigned_to,
         p.display_name
    FROM public.project_conversations c
    JOIN public.project_inbox_contacts ct ON ct.id = c.contact_id
    LEFT JOIN public.profiles p ON p.id = c.assigned_to
   WHERE c.id = _conversation_id
     AND c.workspace_id = _workspace_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Not authorized' USING ERRCODE = '42501';
  END IF;
END;
$function$;

CREATE OR REPLACE FUNCTION public.partner_inbox_list_messages(_workspace_id uuid, _conversation_id uuid, _limit integer DEFAULT 100)
 RETURNS TABLE(message_id uuid, author_type text, channel text, body text, team_display_name text, created_at timestamp with time zone, reply_to_message_id uuid, delivery_status text, delivery_sent_at timestamp with time zone, delivery_uncertainty_acknowledged_at timestamp with time zone)
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
DECLARE
  v_limit integer := LEAST(GREATEST(COALESCE(_limit, 100), 1), 200);
BEGIN
  IF auth.uid() IS NULL OR _workspace_id IS NULL OR _conversation_id IS NULL
     OR NOT public.partner_has_scope(_workspace_id, 'project_inbox') THEN
    RAISE EXCEPTION 'Not authorized' USING ERRCODE = '42501';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM public.project_conversations c
     WHERE c.id = _conversation_id AND c.workspace_id = _workspace_id
  ) THEN
    RAISE EXCEPTION 'Not authorized' USING ERRCODE = '42501';
  END IF;

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

CREATE OR REPLACE FUNCTION public.partner_inbox_create_reply(_workspace_id uuid, _conversation_id uuid, _body text, _client_request_id uuid)
 RETURNS TABLE(message_id uuid, delivery_status text, created_at timestamp with time zone, conversation_status text, idempotent_replay boolean)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
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
  v_commercial jsonb;
BEGIN
  IF _workspace_id IS NULL OR _conversation_id IS NULL OR _client_request_id IS NULL OR v_uid IS NULL THEN
    RAISE EXCEPTION 'Not authorized' USING ERRCODE = '42501';
  END IF;

  IF NOT public.partner_has_scope(_workspace_id, 'project_inbox') THEN
    RAISE EXCEPTION 'Not authorized' USING ERRCODE = '42501';
  END IF;

  -- SP-B0: the CLIENT project's plan controls project_inbox, via the shared core.
  v_commercial := public.partner_evaluate_commercial_access(_workspace_id, 'project_inbox');
  IF COALESCE((v_commercial->>'allowed')::boolean, false) IS NOT TRUE THEN
    RAISE EXCEPTION 'COMMERCIAL_ACCESS_DENIED: %', COALESCE(v_commercial->>'reason', 'UNKNOWN') USING ERRCODE = '42501';
  END IF;

  IF char_length(v_body) < 1 OR char_length(v_body) > 3500 THEN
    RAISE EXCEPTION 'Reply must be between 1 and 3500 characters' USING ERRCODE = '22023';
  END IF;

  -- Idempotency BEFORE current-state validation.
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

  -- Recheck under the conversation lock.
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
  RETURNING id, public.project_conversation_messages.created_at INTO v_new_message_id, v_created_at;

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

CREATE OR REPLACE FUNCTION public.partner_inbox_update_status(_workspace_id uuid, _conversation_id uuid, _status text)
 RETURNS TABLE(conversation_id uuid, status text, resolved_at timestamp with time zone, updated_at timestamp with time zone)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
BEGIN
  IF auth.uid() IS NULL OR _workspace_id IS NULL OR _conversation_id IS NULL
     OR NOT public.partner_has_scope(_workspace_id, 'project_inbox') THEN
    RAISE EXCEPTION 'Not authorized' USING ERRCODE = '42501';
  END IF;

  IF _status IS NULL OR _status NOT IN ('OPEN', 'WAITING_ON_TEAM', 'WAITING_ON_MEMBER', 'RESOLVED') THEN
    RAISE EXCEPTION 'Invalid status' USING ERRCODE = '22023';
  END IF;

  RETURN QUERY
  UPDATE public.project_conversations c
     SET status = _status,
         resolved_at = CASE WHEN _status = 'RESOLVED' THEN COALESCE(c.resolved_at, now()) ELSE NULL END,
         updated_at = now()
   WHERE c.id = _conversation_id
     AND c.workspace_id = _workspace_id
  RETURNING c.id, c.status, c.resolved_at, c.updated_at;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Not authorized' USING ERRCODE = '42501';
  END IF;
END;
$function$;

CREATE OR REPLACE FUNCTION public.partner_inbox_ack_uncertainty(_workspace_id uuid, _conversation_id uuid, _message_id uuid)
 RETURNS TABLE(message_id uuid, delivery_status text, uncertainty_acknowledged_at timestamp with time zone)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
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
  IF NOT public.partner_has_scope(_workspace_id, 'project_inbox') THEN
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

REVOKE ALL ON FUNCTION public.partner_inbox_summary(uuid) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.partner_inbox_list_conversations(uuid, text, integer) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.partner_inbox_get_conversation(uuid, uuid) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.partner_inbox_list_messages(uuid, uuid, integer) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.partner_inbox_create_reply(uuid, uuid, text, uuid) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.partner_inbox_update_status(uuid, uuid, text) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.partner_inbox_ack_uncertainty(uuid, uuid, uuid) FROM PUBLIC, anon;

GRANT EXECUTE ON FUNCTION public.partner_inbox_summary(uuid) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.partner_inbox_list_conversations(uuid, text, integer) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.partner_inbox_get_conversation(uuid, uuid) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.partner_inbox_list_messages(uuid, uuid, integer) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.partner_inbox_create_reply(uuid, uuid, text, uuid) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.partner_inbox_update_status(uuid, uuid, text) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.partner_inbox_ack_uncertainty(uuid, uuid, uuid) TO authenticated, service_role;

COMMIT;
