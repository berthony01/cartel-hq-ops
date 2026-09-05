-- =========================================================================
-- C7.3 — Team-side Telegram Project Inbox console (service-only bot RPCs).
-- Reuses existing project_conversations / project_conversation_messages /
-- project_inbox_deliveries / telegram_team_sessions. No new tables.
-- =========================================================================

-- -------------------------------------------------------------------------
-- 1. Continuity matcher: a delivered TEAM message sent from the bot console
--    (channel 'TELEGRAM') is a valid member reply target, exactly like 'WEB'.
--    ONLY the two channel predicates change; every other check is unchanged.
-- -------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.capture_project_inbox_launch_reply(_telegram_update_id bigint, _telegram_user_id bigint, _telegram_chat_id bigint, _telegram_message_id bigint, _telegram_reply_to_message_id bigint, _body text)
 RETURNS TABLE(outcome text, reason text, conversation_id uuid, conversation_message_id uuid)
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
  -- D3: TEAM-response continuity target
  v_team_conv_id uuid;
  v_team_workspace_id uuid;
  v_team_contact_id uuid;
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

  -- 6. Fail-closed reply-target resolution across ALL eligible target sources.
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
    UNION ALL
    SELECT td.id
    FROM public.project_inbox_deliveries td
    JOIN public.project_conversation_messages tm
      ON tm.id = td.message_id
     AND tm.conversation_id = td.conversation_id
    JOIN public.project_conversations tc ON tc.id = td.conversation_id
    JOIN public.project_inbox_contacts tct
      ON tct.id = tc.contact_id
     AND tct.workspace_id = tc.workspace_id
    WHERE td.telegram_user_id = _telegram_user_id
      AND td.telegram_message_id = _telegram_reply_to_message_id
      AND td.status = 'sent'
      AND tm.author_type = 'TEAM'
      AND tm.channel IN ('WEB', 'TELEGRAM')
      AND tct.telegram_user_id = _telegram_user_id
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

  -- 6b. D3 TEAM continuity path.
  SELECT tc.id, tc.workspace_id, tc.contact_id
    INTO v_team_conv_id, v_team_workspace_id, v_team_contact_id
  FROM public.project_inbox_deliveries td
  JOIN public.project_conversation_messages tm
    ON tm.id = td.message_id
   AND tm.conversation_id = td.conversation_id
  JOIN public.project_conversations tc ON tc.id = td.conversation_id
  JOIN public.project_inbox_contacts tct
    ON tct.id = tc.contact_id
   AND tct.workspace_id = tc.workspace_id
  WHERE td.telegram_user_id = _telegram_user_id
    AND td.telegram_message_id = _telegram_reply_to_message_id
    AND td.status = 'sent'
    AND tm.author_type = 'TEAM'
    AND tm.channel IN ('WEB', 'TELEGRAM')
    AND tct.telegram_user_id = _telegram_user_id;

  IF v_team_conv_id IS NOT NULL THEN
    SELECT ps.replies_enabled INTO v_replies_enabled
    FROM public.project_inbox_settings ps
    WHERE ps.workspace_id = v_team_workspace_id;

    IF coalesce(v_replies_enabled, false) IS NOT TRUE THEN
      UPDATE public.telegram_inbound_updates t
         SET status = 'IGNORED', processed_at = now(), last_error = 'replies_disabled'
       WHERE t.telegram_update_id = _telegram_update_id;
      RETURN QUERY SELECT 'ignored'::text, 'replies_disabled'::text, NULL::uuid, NULL::uuid;
      RETURN;
    END IF;

    SELECT cv.id, cv.status INTO v_conv_id, v_conv_status
    FROM public.project_conversations cv
    WHERE cv.id = v_team_conv_id
      AND cv.workspace_id = v_team_workspace_id
    FOR UPDATE;

    IF v_conv_id IS NULL THEN
      UPDATE public.telegram_inbound_updates t
         SET status = 'IGNORED', processed_at = now(), last_error = 'conversation_unavailable'
       WHERE t.telegram_update_id = _telegram_update_id;
      RETURN QUERY SELECT 'ignored'::text, 'conversation_unavailable'::text, NULL::uuid, NULL::uuid;
      RETURN;
    END IF;

    SELECT c.id, c.status INTO v_contact_id, v_contact_status
    FROM public.project_inbox_contacts c
    WHERE c.id = v_team_contact_id
      AND c.workspace_id = v_team_workspace_id
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

    IF v_conv_status = 'RESOLVED' THEN
      UPDATE public.project_conversations cv
         SET status = 'WAITING_ON_TEAM', resolved_at = NULL, updated_at = now()
       WHERE cv.id = v_conv_id;
    END IF;

    INSERT INTO public.project_conversation_messages (
      conversation_id, author_type, channel, team_user_id, body,
      telegram_update_id, telegram_chat_id, telegram_message_id, telegram_reply_to_message_id
    ) VALUES (
      v_conv_id, 'MEMBER', 'TELEGRAM', NULL, v_body,
      _telegram_update_id, _telegram_chat_id, _telegram_message_id, _telegram_reply_to_message_id
    )
    RETURNING id INTO v_msg_id;

    UPDATE public.telegram_inbound_updates t
       SET status = 'PROCESSED', processed_at = now(), conversation_message_id = v_msg_id
     WHERE t.telegram_update_id = _telegram_update_id;

    RETURN QUERY SELECT 'captured'::text, NULL::text, v_conv_id, v_msg_id;
    RETURN;
  END IF;

  -- 7. Launch-origin path (unchanged).
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

  INSERT INTO public.project_inbox_contacts (workspace_id, telegram_user_id)
  VALUES (v_workspace_id, _telegram_user_id)
  ON CONFLICT (workspace_id, telegram_user_id) DO NOTHING;

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

  IF v_conv_status = 'RESOLVED' THEN
    UPDATE public.project_conversations cv
       SET status = 'WAITING_ON_TEAM', resolved_at = NULL, updated_at = now()
     WHERE cv.id = v_conv_id;
  END IF;

  INSERT INTO public.project_conversation_messages (
    conversation_id, author_type, channel, team_user_id, body,
    telegram_update_id, telegram_chat_id, telegram_message_id, telegram_reply_to_message_id
  ) VALUES (
    v_conv_id, 'MEMBER', 'TELEGRAM', NULL, v_body,
    _telegram_update_id, _telegram_chat_id, _telegram_message_id, _telegram_reply_to_message_id
  )
  RETURNING id INTO v_msg_id;

  UPDATE public.telegram_inbound_updates t
     SET status = 'PROCESSED', processed_at = now(), conversation_message_id = v_msg_id
   WHERE t.telegram_update_id = _telegram_update_id;

  RETURN QUERY SELECT 'captured'::text, NULL::text, v_conv_id, v_msg_id;
END;
$function$;

-- -------------------------------------------------------------------------
-- 2. Operator workspace resolution. Telegram identity -> app user -> CURRENT
--    workspace_members authorization. telegram_team_sessions is never an
--    authorization source.
-- -------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.bot_inbox_operator_workspaces(_telegram_user_id bigint)
 RETURNS TABLE(workspace_id uuid, workspace_name text, waiting_count integer)
 LANGUAGE plpgsql
 STABLE
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_uid uuid;
BEGIN
  IF _telegram_user_id IS NULL OR _telegram_user_id <= 0 THEN RETURN; END IF;

  SELECT tc.user_id INTO v_uid
    FROM public.telegram_connections tc
   WHERE tc.telegram_user_id = _telegram_user_id
   LIMIT 1;
  IF v_uid IS NULL THEN RETURN; END IF;

  RETURN QUERY
  SELECT w.id, w.name,
         (SELECT count(*)::integer
            FROM public.project_conversations c
           WHERE c.workspace_id = w.id
             AND c.status IN ('OPEN', 'WAITING_ON_TEAM'))
    FROM public.workspace_members wm
    JOIN public.workspaces w ON w.id = wm.workspace_id
   WHERE wm.user_id = v_uid
     AND wm.role IN ('owner', 'admin')
   ORDER BY w.name
   LIMIT 20;
END;
$function$;

-- -------------------------------------------------------------------------
-- 3. Bounded conversation list for one authorized workspace.
-- -------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.bot_inbox_list_conversations(_telegram_user_id bigint, _workspace_id uuid, _limit integer DEFAULT 8)
 RETURNS TABLE(conversation_id uuid, member_ref text, conversation_status text, preview text, last_message_at timestamp with time zone)
 LANGUAGE plpgsql
 STABLE
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_uid uuid;
  v_limit integer := LEAST(GREATEST(COALESCE(_limit, 8), 1), 10);
BEGIN
  IF _telegram_user_id IS NULL OR _workspace_id IS NULL THEN RETURN; END IF;

  SELECT tc.user_id INTO v_uid
    FROM public.telegram_connections tc
   WHERE tc.telegram_user_id = _telegram_user_id
   LIMIT 1;
  IF v_uid IS NULL OR NOT public.is_workspace_operator(_workspace_id, v_uid) THEN RETURN; END IF;

  RETURN QUERY
  SELECT c.id, ct.member_ref, c.status,
         left(coalesce(lm.body, ''), 120),
         c.last_message_at
    FROM public.project_conversations c
    JOIN public.project_inbox_contacts ct
      ON ct.id = c.contact_id
     AND ct.workspace_id = c.workspace_id
    LEFT JOIN LATERAL (
      SELECT m.body
        FROM public.project_conversation_messages m
       WHERE m.conversation_id = c.id
       ORDER BY m.created_at DESC, m.id DESC
       LIMIT 1
    ) lm ON true
   WHERE c.workspace_id = _workspace_id
   ORDER BY (c.status IN ('OPEN', 'WAITING_ON_TEAM')) DESC, c.last_message_at DESC
   LIMIT v_limit;
END;
$function$;

-- -------------------------------------------------------------------------
-- 4. Open one conversation and arm a short-lived REPLY session.
-- -------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.bot_inbox_open_conversation(_telegram_user_id bigint, _conversation_id uuid)
 RETURNS TABLE(outcome text, member_ref text, conversation_status text, workspace_name text, transcript jsonb)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_uid uuid;
  v_conv public.project_conversations%ROWTYPE;
  v_ref text;
  v_ws_name text;
  v_selected uuid;
  v_transcript jsonb;
BEGIN
  IF _telegram_user_id IS NULL OR _conversation_id IS NULL THEN
    RETURN QUERY SELECT 'denied'::text, NULL::text, NULL::text, NULL::text, NULL::jsonb;
    RETURN;
  END IF;

  SELECT tc.user_id INTO v_uid
    FROM public.telegram_connections tc
   WHERE tc.telegram_user_id = _telegram_user_id
   LIMIT 1;
  IF v_uid IS NULL THEN
    RETURN QUERY SELECT 'denied'::text, NULL::text, NULL::text, NULL::text, NULL::jsonb;
    RETURN;
  END IF;

  SELECT * INTO v_conv
    FROM public.project_conversations c
   WHERE c.id = _conversation_id;
  IF NOT FOUND OR NOT public.is_workspace_operator(v_conv.workspace_id, v_uid) THEN
    RETURN QUERY SELECT 'denied'::text, NULL::text, NULL::text, NULL::text, NULL::jsonb;
    RETURN;
  END IF;

  -- If a workspace is already selected in this session it must match.
  SELECT s.selected_workspace_id INTO v_selected
    FROM public.telegram_team_sessions s
   WHERE s.telegram_user_id = _telegram_user_id;
  IF v_selected IS NOT NULL AND v_selected <> v_conv.workspace_id THEN
    RETURN QUERY SELECT 'denied'::text, NULL::text, NULL::text, NULL::text, NULL::jsonb;
    RETURN;
  END IF;

  SELECT ct.member_ref INTO v_ref
    FROM public.project_inbox_contacts ct
   WHERE ct.id = v_conv.contact_id
     AND ct.workspace_id = v_conv.workspace_id;

  SELECT w.name INTO v_ws_name FROM public.workspaces w WHERE w.id = v_conv.workspace_id;

  SELECT coalesce(jsonb_agg(t ORDER BY t.created_at ASC, t.id ASC), '[]'::jsonb)
    INTO v_transcript
  FROM (
    SELECT m.id, m.author_type, m.channel, left(m.body, 400) AS body, m.created_at
      FROM public.project_conversation_messages m
     WHERE m.conversation_id = _conversation_id
     ORDER BY m.created_at DESC, m.id DESC
     LIMIT 8
  ) t;

  INSERT INTO public.telegram_team_sessions
    (telegram_user_id, selected_workspace_id, active_conversation_id, mode, expires_at, updated_at)
  VALUES
    (_telegram_user_id, v_conv.workspace_id, _conversation_id, 'REPLY', now() + interval '30 minutes', now())
  ON CONFLICT (telegram_user_id) DO UPDATE
     SET selected_workspace_id = EXCLUDED.selected_workspace_id,
         active_conversation_id = EXCLUDED.active_conversation_id,
         mode = 'REPLY',
         expires_at = EXCLUDED.expires_at,
         updated_at = now();

  RETURN QUERY SELECT 'ok'::text, v_ref, v_conv.status, v_ws_name, v_transcript;
END;
$function$;

-- -------------------------------------------------------------------------
-- 5. Session mode control (workspace selection / cancel). REPLY is only ever
--    armed by bot_inbox_open_conversation.
-- -------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.bot_inbox_set_session(_telegram_user_id bigint, _mode text, _workspace_id uuid DEFAULT NULL)
 RETURNS text
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_uid uuid;
BEGIN
  IF _telegram_user_id IS NULL OR _mode NOT IN ('NONE', 'INBOX') THEN
    RETURN 'denied';
  END IF;

  SELECT tc.user_id INTO v_uid
    FROM public.telegram_connections tc
   WHERE tc.telegram_user_id = _telegram_user_id
   LIMIT 1;
  IF v_uid IS NULL THEN RETURN 'denied'; END IF;

  IF _mode = 'NONE' THEN
    DELETE FROM public.telegram_team_sessions s WHERE s.telegram_user_id = _telegram_user_id;
    RETURN 'ok';
  END IF;

  IF _workspace_id IS NOT NULL AND NOT public.is_workspace_operator(_workspace_id, v_uid) THEN
    RETURN 'denied';
  END IF;

  INSERT INTO public.telegram_team_sessions
    (telegram_user_id, selected_workspace_id, active_conversation_id, mode, expires_at, updated_at)
  VALUES
    (_telegram_user_id, _workspace_id, NULL, 'INBOX', now() + interval '30 minutes', now())
  ON CONFLICT (telegram_user_id) DO UPDATE
     SET selected_workspace_id = EXCLUDED.selected_workspace_id,
         active_conversation_id = NULL,
         mode = 'INBOX',
         expires_at = EXCLUDED.expires_at,
         updated_at = now();

  RETURN 'ok';
END;
$function$;

-- -------------------------------------------------------------------------
-- 6. Validated active REPLY session. Re-authorizes on every call.
-- -------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.bot_inbox_active_reply_session(_telegram_user_id bigint)
 RETURNS TABLE(conversation_id uuid, workspace_id uuid, member_ref text)
 LANGUAGE plpgsql
 STABLE
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_uid uuid;
BEGIN
  IF _telegram_user_id IS NULL THEN RETURN; END IF;

  SELECT tc.user_id INTO v_uid
    FROM public.telegram_connections tc
   WHERE tc.telegram_user_id = _telegram_user_id
   LIMIT 1;
  IF v_uid IS NULL THEN RETURN; END IF;

  RETURN QUERY
  SELECT c.id, c.workspace_id, ct.member_ref
    FROM public.telegram_team_sessions s
    JOIN public.project_conversations c
      ON c.id = s.active_conversation_id
     AND c.workspace_id = s.selected_workspace_id
    JOIN public.project_inbox_contacts ct
      ON ct.id = c.contact_id
     AND ct.workspace_id = c.workspace_id
   WHERE s.telegram_user_id = _telegram_user_id
     AND s.mode = 'REPLY'
     AND s.expires_at > now()
     AND public.is_workspace_operator(c.workspace_id, v_uid);
END;
$function$;

-- -------------------------------------------------------------------------
-- 7. Bot-console TEAM reply. Same durable queue, same safety model and the
--    same official response wrapper as create_project_inbox_team_reply.
--    Channel is truthfully recorded as 'TELEGRAM'.
-- -------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.bot_inbox_create_team_reply(_telegram_user_id bigint, _body text, _client_request_id uuid)
 RETURNS TABLE(outcome text, reason text, message_id uuid)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_uid uuid;
  v_body text := btrim(COALESCE(_body, ''));
  v_conversation_id uuid;
  v_workspace_id uuid;
  v_conv public.project_conversations%ROWTYPE;
  v_contact public.project_inbox_contacts%ROWTYPE;
  v_msg public.project_conversation_messages%ROWTYPE;
  v_name text;
  v_ticker text;
  v_delivered text;
  v_new_message_id uuid;
BEGIN
  IF _telegram_user_id IS NULL OR _client_request_id IS NULL THEN
    RETURN QUERY SELECT 'denied'::text, 'invalid_input'::text, NULL::uuid;
    RETURN;
  END IF;

  SELECT tc.user_id INTO v_uid
    FROM public.telegram_connections tc
   WHERE tc.telegram_user_id = _telegram_user_id
   LIMIT 1;
  IF v_uid IS NULL THEN
    RETURN QUERY SELECT 'denied'::text, 'not_linked'::text, NULL::uuid;
    RETURN;
  END IF;

  SELECT s.conversation_id, s.workspace_id
    INTO v_conversation_id, v_workspace_id
    FROM public.bot_inbox_active_reply_session(_telegram_user_id) s;
  IF v_conversation_id IS NULL THEN
    RETURN QUERY SELECT 'denied'::text, 'no_active_session'::text, NULL::uuid;
    RETURN;
  END IF;

  IF NOT public.is_workspace_operator(v_workspace_id, v_uid) THEN
    RETURN QUERY SELECT 'denied'::text, 'not_operator'::text, NULL::uuid;
    RETURN;
  END IF;

  IF char_length(v_body) < 1 OR char_length(v_body) > 3500 THEN
    RETURN QUERY SELECT 'rejected'::text, 'invalid_length'::text, NULL::uuid;
    RETURN;
  END IF;

  -- Idempotency before current-state validation.
  SELECT m.* INTO v_msg
    FROM public.project_conversation_messages m
    JOIN public.project_conversations c ON c.id = m.conversation_id
   WHERE m.conversation_id = v_conversation_id
     AND c.workspace_id = v_workspace_id
     AND m.client_request_id = _client_request_id;
  IF FOUND THEN
    IF v_msg.author_type <> 'TEAM'
       OR v_msg.channel <> 'TELEGRAM'
       OR v_msg.team_user_id IS DISTINCT FROM v_uid
       OR btrim(v_msg.body) <> v_body
       OR NOT EXISTS (SELECT 1 FROM public.project_inbox_deliveries d WHERE d.message_id = v_msg.id) THEN
      RETURN QUERY SELECT 'rejected'::text, 'request_id_reused'::text, NULL::uuid;
      RETURN;
    END IF;
    RETURN QUERY SELECT 'queued'::text, 'idempotent_replay'::text, v_msg.id;
    RETURN;
  END IF;

  SELECT * INTO v_conv
    FROM public.project_conversations c
   WHERE c.id = v_conversation_id
     AND c.workspace_id = v_workspace_id
   FOR UPDATE;
  IF NOT FOUND THEN
    RETURN QUERY SELECT 'denied'::text, 'conversation_unavailable'::text, NULL::uuid;
    RETURN;
  END IF;

  SELECT m.* INTO v_msg
    FROM public.project_conversation_messages m
   WHERE m.conversation_id = v_conversation_id
     AND m.client_request_id = _client_request_id;
  IF FOUND THEN
    IF v_msg.author_type <> 'TEAM'
       OR v_msg.channel <> 'TELEGRAM'
       OR v_msg.team_user_id IS DISTINCT FROM v_uid
       OR btrim(v_msg.body) <> v_body
       OR NOT EXISTS (SELECT 1 FROM public.project_inbox_deliveries d WHERE d.message_id = v_msg.id) THEN
      RETURN QUERY SELECT 'rejected'::text, 'request_id_reused'::text, NULL::uuid;
      RETURN;
    END IF;
    RETURN QUERY SELECT 'queued'::text, 'idempotent_replay'::text, v_msg.id;
    RETURN;
  END IF;

  IF v_conv.status = 'RESOLVED' THEN
    RETURN QUERY SELECT 'rejected'::text, 'conversation_resolved'::text, NULL::uuid;
    RETURN;
  END IF;

  SELECT * INTO v_contact
    FROM public.project_inbox_contacts ct
   WHERE ct.id = v_conv.contact_id
     AND ct.workspace_id = v_workspace_id
   FOR UPDATE;
  IF NOT FOUND THEN
    RETURN QUERY SELECT 'denied'::text, 'contact_unavailable'::text, NULL::uuid;
    RETURN;
  END IF;
  IF v_contact.status <> 'ACTIVE' THEN
    RETURN QUERY SELECT 'rejected'::text, 'contact_blocked'::text, NULL::uuid;
    RETURN;
  END IF;

  IF EXISTS (
    SELECT 1 FROM public.project_inbox_deliveries d
     WHERE d.conversation_id = v_conversation_id
       AND (d.status IN ('pending', 'processing', 'retry')
            OR (d.status = 'ambiguous' AND d.uncertainty_acknowledged_at IS NULL))
  ) THEN
    RETURN QUERY SELECT 'rejected'::text, 'earlier_reply_unsettled'::text, NULL::uuid;
    RETURN;
  END IF;

  SELECT btrim(p.project_name), NULLIF(btrim(COALESCE(p.ticker, '')), '')
    INTO v_name, v_ticker
    FROM public.project_profiles p
   WHERE p.workspace_id = v_workspace_id;
  IF v_name IS NULL OR char_length(v_name) < 1 THEN
    RETURN QUERY SELECT 'rejected'::text, 'missing_project_name'::text, NULL::uuid;
    RETURN;
  END IF;

  v_delivered := v_name
    || CASE WHEN v_ticker IS NULL THEN '' ELSE ' · ' || v_ticker END
    || E'\nOFFICIAL PROJECT RESPONSE\n\n'
    || v_body
    || E'\n\nOfficial response through @PepeCartelHQBot';

  IF char_length(v_delivered) < 1 OR char_length(v_delivered) > 4096 THEN
    RETURN QUERY SELECT 'rejected'::text, 'too_long_to_deliver'::text, NULL::uuid;
    RETURN;
  END IF;

  INSERT INTO public.project_conversation_messages
    (conversation_id, author_type, channel, team_user_id, body, client_request_id)
  VALUES
    (v_conversation_id, 'TEAM', 'TELEGRAM', v_uid, v_body, _client_request_id)
  RETURNING id INTO v_new_message_id;

  INSERT INTO public.project_inbox_deliveries
    (conversation_id, message_id, telegram_user_id, status, next_attempt_at,
     template_version, project_name_snapshot, ticker_snapshot, delivered_text_snapshot)
  VALUES
    (v_conversation_id, v_new_message_id, v_contact.telegram_user_id, 'pending', now(),
     'telegram_text_v1', v_name, v_ticker, v_delivered);

  UPDATE public.telegram_team_sessions s
     SET expires_at = now() + interval '30 minutes', updated_at = now()
   WHERE s.telegram_user_id = _telegram_user_id;

  RETURN QUERY SELECT 'queued'::text, NULL::text, v_new_message_id;
END;
$function$;

-- -------------------------------------------------------------------------
-- 8. Which linked operators should be alerted about a captured member
--    message. Never returns the member's Telegram identity.
-- -------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.bot_inbox_capture_alert_targets(_telegram_update_id bigint)
 RETURNS TABLE(operator_telegram_user_id bigint, conversation_id uuid, member_ref text, body text, is_new_conversation boolean)
 LANGUAGE plpgsql
 STABLE
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_msg_id uuid;
  v_conv_id uuid;
  v_workspace_id uuid;
  v_contact_tg bigint;
  v_ref text;
  v_body text;
  v_is_new boolean;
BEGIN
  IF _telegram_update_id IS NULL THEN RETURN; END IF;

  SELECT u.conversation_message_id INTO v_msg_id
    FROM public.telegram_inbound_updates u
   WHERE u.telegram_update_id = _telegram_update_id
     AND u.status = 'PROCESSED';
  IF v_msg_id IS NULL THEN RETURN; END IF;

  SELECT m.conversation_id, left(m.body, 500), c.workspace_id, ct.member_ref, ct.telegram_user_id
    INTO v_conv_id, v_body, v_workspace_id, v_ref, v_contact_tg
    FROM public.project_conversation_messages m
    JOIN public.project_conversations c ON c.id = m.conversation_id
    JOIN public.project_inbox_contacts ct
      ON ct.id = c.contact_id
     AND ct.workspace_id = c.workspace_id
   WHERE m.id = v_msg_id
     AND m.author_type = 'MEMBER';
  IF v_conv_id IS NULL THEN RETURN; END IF;

  SELECT NOT EXISTS (
    SELECT 1 FROM public.project_conversation_messages m2
     WHERE m2.conversation_id = v_conv_id
       AND m2.id <> v_msg_id
  ) INTO v_is_new;

  RETURN QUERY
  SELECT DISTINCT tc.telegram_user_id, v_conv_id, v_ref, v_body, v_is_new
    FROM public.workspace_members wm
    JOIN public.telegram_connections tc ON tc.user_id = wm.user_id
    LEFT JOIN public.project_inbox_team_preferences pr
      ON pr.workspace_id = wm.workspace_id
     AND pr.user_id = wm.user_id
   WHERE wm.workspace_id = v_workspace_id
     AND wm.role IN ('owner', 'admin')
     AND tc.telegram_user_id <> v_contact_tg
     AND (
       (v_is_new AND COALESCE(pr.new_conversation_alerts, true))
       OR COALESCE(pr.every_message_alerts, false)
       OR EXISTS (
         SELECT 1 FROM public.telegram_team_sessions s
          WHERE s.telegram_user_id = tc.telegram_user_id
            AND s.mode = 'REPLY'
            AND s.expires_at > now()
            AND s.active_conversation_id = v_conv_id
       )
     );
END;
$function$;

-- -------------------------------------------------------------------------
-- 9. Service-role-only execution for every new bot console function.
-- -------------------------------------------------------------------------
REVOKE ALL ON FUNCTION public.bot_inbox_operator_workspaces(bigint) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.bot_inbox_list_conversations(bigint, uuid, integer) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.bot_inbox_open_conversation(bigint, uuid) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.bot_inbox_set_session(bigint, text, uuid) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.bot_inbox_active_reply_session(bigint) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.bot_inbox_create_team_reply(bigint, text, uuid) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.bot_inbox_capture_alert_targets(bigint) FROM PUBLIC, anon, authenticated;

GRANT EXECUTE ON FUNCTION public.bot_inbox_operator_workspaces(bigint) TO service_role;
GRANT EXECUTE ON FUNCTION public.bot_inbox_list_conversations(bigint, uuid, integer) TO service_role;
GRANT EXECUTE ON FUNCTION public.bot_inbox_open_conversation(bigint, uuid) TO service_role;
GRANT EXECUTE ON FUNCTION public.bot_inbox_set_session(bigint, text, uuid) TO service_role;
GRANT EXECUTE ON FUNCTION public.bot_inbox_active_reply_session(bigint) TO service_role;
GRANT EXECUTE ON FUNCTION public.bot_inbox_create_team_reply(bigint, text, uuid) TO service_role;
GRANT EXECUTE ON FUNCTION public.bot_inbox_capture_alert_targets(bigint) TO service_role;