-- =========================================================
-- C7.3B CORRECTION: serialize inbound capture against contact block
-- Replaces ONLY public.capture_project_inbox_launch_reply. No schema changes.
-- =========================================================

CREATE OR REPLACE FUNCTION public.capture_project_inbox_launch_reply(
  _telegram_update_id bigint,
  _telegram_user_id bigint,
  _telegram_chat_id bigint,
  _telegram_message_id bigint,
  _telegram_reply_to_message_id bigint,
  _body text
)
RETURNS TABLE (outcome text, reason text, conversation_id uuid, conversation_message_id uuid)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_body text;
  v_inserted integer;
  v_match_count integer := 0;
  v_origin_type text;
  v_workspace_id uuid;
  v_launch_id uuid;
  v_event_id uuid;
  v_delivery_id uuid;
  v_event_type text;
  v_event_payload jsonb;
  v_title text;
  v_text_snapshot text;
  v_replies_enabled boolean;
  v_contact_id uuid;
  v_contact_status text;
  v_conv_id uuid;
  v_conv_status text;
  v_msg_id uuid;
BEGIN
  -- 3. Structural validation. Nothing is persisted for malformed input.
  IF _telegram_update_id IS NULL OR _telegram_update_id <= 0
     OR _telegram_user_id IS NULL OR _telegram_user_id <= 0
     OR _telegram_chat_id IS NULL OR _telegram_chat_id <= 0
     OR _telegram_message_id IS NULL OR _telegram_message_id <= 0
     OR _telegram_reply_to_message_id IS NULL OR _telegram_reply_to_message_id <= 0
     OR _telegram_chat_id <> _telegram_user_id THEN
    RETURN QUERY SELECT 'ignored'::text, 'invalid_input'::text, NULL::uuid, NULL::uuid;
    RETURN;
  END IF;

  v_body := btrim(coalesce(_body, ''));
  IF char_length(v_body) < 1 OR char_length(v_body) > 4096 THEN
    RETURN QUERY SELECT 'ignored'::text, 'invalid_body'::text, NULL::uuid, NULL::uuid;
    RETURN;
  END IF;

  -- 4/5. Atomic dedupe first. No raw payload and no body are stored here.
  INSERT INTO public.telegram_inbound_updates AS t (
    telegram_update_id, update_kind, telegram_chat_id, telegram_message_id, telegram_user_id, status
  ) VALUES (
    _telegram_update_id, 'MESSAGE', _telegram_chat_id, _telegram_message_id, _telegram_user_id, 'RECEIVED'
  )
  ON CONFLICT DO NOTHING;

  GET DIAGNOSTICS v_inserted = ROW_COUNT;
  IF v_inserted = 0 THEN
    RETURN QUERY SELECT 'duplicate'::text, 'already_received'::text, NULL::uuid, NULL::uuid;
    RETURN;
  END IF;

  -- 6. Fail-closed reply-target resolution. Route ONLY by exact stored
  -- outbound Telegram message id + the same Telegram user id.
  SELECT count(*)::integer INTO v_match_count
  FROM (
    SELECT d.id
    FROM public.launch_notification_deliveries d
    JOIN public.launch_watch_subscriptions s ON s.id = d.subscription_id
    JOIN public.launch_events e ON e.id = d.event_id
    JOIN public.launches l ON l.id = d.launch_id
    WHERE d.telegram_user_id = _telegram_user_id
      AND d.telegram_message_id = _telegram_reply_to_message_id
      AND d.status = 'sent'
      AND s.telegram_user_id = _telegram_user_id
      AND s.launch_id = l.id
      AND e.launch_id = l.id
    UNION ALL
    SELECT s2.id
    FROM public.launch_watch_subscriptions s2
    JOIN public.launches l2 ON l2.id = s2.launch_id
    WHERE s2.telegram_user_id = _telegram_user_id
      AND s2.confirmation_telegram_message_id = _telegram_reply_to_message_id
      AND s2.confirmation_status = 'sent'
  ) AS matches;

  IF v_match_count <> 1 THEN
    UPDATE public.telegram_inbound_updates t
       SET status = 'IGNORED',
           processed_at = now(),
           last_error = CASE WHEN v_match_count = 0 THEN 'unknown_reply_target' ELSE 'ambiguous_reply_target' END
     WHERE t.telegram_update_id = _telegram_update_id;
    RETURN QUERY SELECT 'ignored'::text,
      (CASE WHEN v_match_count = 0 THEN 'unknown_reply_target' ELSE 'ambiguous_reply_target' END)::text,
      NULL::uuid, NULL::uuid;
    RETURN;
  END IF;

  -- 7. Watch activity is deliberately NOT required: an inbound reply is
  -- user-initiated and must not be blocked by having stopped outbound watch.
  SELECT 'LAUNCH_DELIVERY', l.workspace_id, l.id, e.id, d.id, e.event_type, e.payload
    INTO v_origin_type, v_workspace_id, v_launch_id, v_event_id, v_delivery_id, v_event_type, v_event_payload
  FROM public.launch_notification_deliveries d
  JOIN public.launch_watch_subscriptions s ON s.id = d.subscription_id
  JOIN public.launch_events e ON e.id = d.event_id
  JOIN public.launches l ON l.id = d.launch_id
  WHERE d.telegram_user_id = _telegram_user_id
    AND d.telegram_message_id = _telegram_reply_to_message_id
    AND d.status = 'sent'
    AND s.telegram_user_id = _telegram_user_id
    AND s.launch_id = l.id
    AND e.launch_id = l.id;

  IF v_origin_type IS NULL THEN
    SELECT 'LAUNCH_CONFIRMATION', l2.workspace_id, l2.id
      INTO v_origin_type, v_workspace_id, v_launch_id
    FROM public.launch_watch_subscriptions s2
    JOIN public.launches l2 ON l2.id = s2.launch_id
    WHERE s2.telegram_user_id = _telegram_user_id
      AND s2.confirmation_telegram_message_id = _telegram_reply_to_message_id
      AND s2.confirmation_status = 'sent';
  END IF;

  IF v_origin_type IS NULL OR v_workspace_id IS NULL OR v_launch_id IS NULL THEN
    UPDATE public.telegram_inbound_updates t
       SET status = 'IGNORED', processed_at = now(), last_error = 'unresolved_target'
     WHERE t.telegram_update_id = _telegram_update_id;
    RETURN QUERY SELECT 'ignored'::text, 'unresolved_target'::text, NULL::uuid, NULL::uuid;
    RETURN;
  END IF;

  -- 8. Feature gate. Missing settings row is false.
  SELECT ps.replies_enabled INTO v_replies_enabled
  FROM public.project_inbox_settings ps
  WHERE ps.workspace_id = v_workspace_id;

  IF coalesce(v_replies_enabled, false) IS NOT TRUE THEN
    UPDATE public.telegram_inbound_updates t
       SET status = 'IGNORED', processed_at = now(), last_error = 'replies_disabled'
     WHERE t.telegram_update_id = _telegram_update_id;
    RETURN QUERY SELECT 'ignored'::text, 'replies_disabled'::text, NULL::uuid, NULL::uuid;
    RETURN;
  END IF;

  -- 9. Get-or-create contact. Never enriched with Telegram profile data.
  INSERT INTO public.project_inbox_contacts (workspace_id, telegram_user_id)
  VALUES (v_workspace_id, _telegram_user_id)
  ON CONFLICT (workspace_id, telegram_user_id) DO NOTHING;

  -- 9b. CORRECTION: serialize against set_project_inbox_contact_blocked.
  -- The contact row is locked FOR UPDATE and the lock is held for the rest of
  -- this transaction, so a concurrent block UPDATE either commits first (this
  -- call then observes BLOCKED and captures nothing) or waits until this
  -- capture has fully committed. No message can land after a committed block.
  SELECT c.id, c.status INTO v_contact_id, v_contact_status
  FROM public.project_inbox_contacts c
  WHERE c.workspace_id = v_workspace_id
    AND c.telegram_user_id = _telegram_user_id
  FOR UPDATE;

  IF v_contact_id IS NULL THEN
    UPDATE public.telegram_inbound_updates t
       SET status = 'IGNORED', processed_at = now(), last_error = 'contact_unavailable'
     WHERE t.telegram_update_id = _telegram_update_id;
    RETURN QUERY SELECT 'ignored'::text, 'contact_unavailable'::text, NULL::uuid, NULL::uuid;
    RETURN;
  END IF;

  IF v_contact_status = 'BLOCKED' THEN
    UPDATE public.telegram_inbound_updates t
       SET status = 'IGNORED', processed_at = now(), last_error = 'contact_blocked'
     WHERE t.telegram_update_id = _telegram_update_id;
    RETURN QUERY SELECT 'ignored'::text, 'contact_blocked'::text, NULL::uuid, NULL::uuid;
    RETURN;
  END IF;

  -- 10. Safe origin snapshots only.
  IF v_origin_type = 'LAUNCH_CONFIRMATION' THEN
    v_title := 'Launch Watch Confirmation';
  ELSIF v_event_type = 'WATCHER_UPDATE' THEN
    v_title := left(coalesce(nullif(btrim(coalesce(v_event_payload ->> 'title', '')), ''), 'Project Update'), 200);
    v_text_snapshot := left(nullif(btrim(coalesce(v_event_payload ->> 'body', '')), ''), 6000);
  ELSIF v_event_type = 'REMINDER_24H' THEN
    v_title := 'Launch Reminder — 24 Hours';
  ELSIF v_event_type = 'REMINDER_1H' THEN
    v_title := 'Launch Reminder — 1 Hour';
  ELSIF v_event_type = 'OFFICIAL_CONTRACT_REGISTERED' THEN
    v_title := 'Official Contract Registered';
  ELSIF v_event_type = 'LAUNCH_LIVE' THEN
    v_title := 'Launch Is Live';
  ELSE
    v_title := 'Launch Watch Message';
  END IF;

  INSERT INTO public.project_conversations (
    workspace_id, contact_id, origin_type,
    origin_launch_delivery_id, origin_launch_event_id, origin_launch_id,
    origin_telegram_message_id, origin_title_snapshot, origin_text_snapshot,
    category, priority
  ) VALUES (
    v_workspace_id, v_contact_id, v_origin_type,
    v_delivery_id, v_event_id, v_launch_id,
    _telegram_reply_to_message_id, v_title, v_text_snapshot,
    'LAUNCH', 'NORMAL'
  )
  ON CONFLICT (contact_id, origin_telegram_message_id)
    WHERE origin_telegram_message_id IS NOT NULL
  DO NOTHING
  RETURNING id INTO v_conv_id;

  IF v_conv_id IS NULL THEN
    SELECT cv.id, cv.status INTO v_conv_id, v_conv_status
    FROM public.project_conversations cv
    WHERE cv.contact_id = v_contact_id
      AND cv.origin_telegram_message_id = _telegram_reply_to_message_id
    FOR UPDATE;
  END IF;

  IF v_conv_id IS NULL THEN
    UPDATE public.telegram_inbound_updates t
       SET status = 'IGNORED', processed_at = now(), last_error = 'conversation_unavailable'
     WHERE t.telegram_update_id = _telegram_update_id;
    RETURN QUERY SELECT 'ignored'::text, 'conversation_unavailable'::text, NULL::uuid, NULL::uuid;
    RETURN;
  END IF;

  -- 11. Explicit inbound-reply reopen. The state trigger never does this.
  IF v_conv_status = 'RESOLVED' THEN
    UPDATE public.project_conversations cv
       SET status = 'WAITING_ON_TEAM', resolved_at = NULL, updated_at = now()
     WHERE cv.id = v_conv_id;
  END IF;

  -- 12. Exactly one MEMBER/TELEGRAM message. No outbound delivery row.
  INSERT INTO public.project_conversation_messages (
    conversation_id, author_type, channel, team_user_id, body,
    telegram_update_id, telegram_chat_id, telegram_message_id, telegram_reply_to_message_id
  ) VALUES (
    v_conv_id, 'MEMBER', 'TELEGRAM', NULL, v_body,
    _telegram_update_id, _telegram_chat_id, _telegram_message_id, _telegram_reply_to_message_id
  )
  RETURNING id INTO v_msg_id;

  -- 14. Only a successful capture marks the inbound update PROCESSED.
  UPDATE public.telegram_inbound_updates t
     SET status = 'PROCESSED', processed_at = now(), conversation_message_id = v_msg_id
   WHERE t.telegram_update_id = _telegram_update_id;

  RETURN QUERY SELECT 'captured'::text, NULL::text, v_conv_id, v_msg_id;
END;
$function$;

COMMENT ON FUNCTION public.capture_project_inbox_launch_reply(bigint, bigint, bigint, bigint, bigint, text) IS
  'C7.3B service-only atomic capture of a private Telegram reply to a known official Launch Watch bot message. Routes strictly by stored outbound telegram_message_id + same telegram_user_id. Returns no Telegram identifiers. The contact row is locked FOR UPDATE so capture is linearizable against set_project_inbox_contact_blocked.';

REVOKE ALL ON FUNCTION public.capture_project_inbox_launch_reply(bigint, bigint, bigint, bigint, bigint, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.capture_project_inbox_launch_reply(bigint, bigint, bigint, bigint, bigint, text) FROM anon;
REVOKE ALL ON FUNCTION public.capture_project_inbox_launch_reply(bigint, bigint, bigint, bigint, bigint, text) FROM authenticated;
GRANT EXECUTE ON FUNCTION public.capture_project_inbox_launch_reply(bigint, bigint, bigint, bigint, bigint, text) TO service_role;