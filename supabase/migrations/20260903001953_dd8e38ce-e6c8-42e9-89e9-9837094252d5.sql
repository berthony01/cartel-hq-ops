CREATE OR REPLACE FUNCTION public.capture_project_inbox_member_message(_telegram_update_id bigint, _telegram_user_id bigint, _telegram_chat_id bigint, _telegram_message_id bigint, _body text)
 RETURNS text
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_body text;
  v_candidate_count int;
  v_workspace_id uuid;
  v_qualifying_count int;
  v_inbound bigint;
  v_contact_id uuid;
  v_contact_status text;
  v_conversation_id uuid;
  v_message_id uuid;
BEGIN
  -- 1. Structural validation. Zero writes on failure.
  IF _telegram_update_id IS NULL OR _telegram_update_id <= 0
     OR _telegram_user_id IS NULL OR _telegram_user_id <= 0
     OR _telegram_chat_id IS NULL OR _telegram_chat_id <= 0
     OR _telegram_message_id IS NULL OR _telegram_message_id <= 0
     OR _telegram_chat_id <> _telegram_user_id THEN
    RETURN 'invalid_input';
  END IF;

  v_body := btrim(COALESCE(_body, ''));
  IF length(v_body) < 1 OR length(v_body) > 4096 THEN
    RETURN 'invalid_input';
  END IF;

  -- 2. Candidate workspaces from EXISTING server-side evidence only:
  --    ACTIVE inbox contacts, plus active launch watch subscriptions.
  --    A BLOCKED contact excludes that workspace entirely.
  CREATE TEMP TABLE IF NOT EXISTS _pi_candidates (workspace_id uuid PRIMARY KEY) ON COMMIT DROP;
  DELETE FROM _pi_candidates;

  INSERT INTO _pi_candidates (workspace_id)
  SELECT DISTINCT w FROM (
    SELECT c.workspace_id AS w
      FROM public.project_inbox_contacts c
     WHERE c.telegram_user_id = _telegram_user_id
       AND c.status = 'ACTIVE'
    UNION
    SELECT l.workspace_id AS w
      FROM public.launch_watch_subscriptions s
      JOIN public.launches l ON l.id = s.launch_id
     WHERE s.telegram_user_id = _telegram_user_id
       AND s.is_active IS TRUE
  ) src
  WHERE w IS NOT NULL
    AND NOT EXISTS (
      SELECT 1 FROM public.project_inbox_contacts b
       WHERE b.telegram_user_id = _telegram_user_id
         AND b.workspace_id = w
         AND b.status = 'BLOCKED'
    )
  ON CONFLICT DO NOTHING;

  SELECT count(*) INTO v_candidate_count FROM _pi_candidates;
  IF v_candidate_count = 0 THEN
    RETURN 'no_candidate_workspace';
  END IF;

  -- 3. Only workspaces that explicitly allow new member conversations.
  --    Missing settings row = false (inner join).
  SELECT count(*) INTO v_qualifying_count
    FROM public.project_inbox_settings s
    JOIN _pi_candidates c ON c.workspace_id = s.workspace_id
   WHERE s.new_conversations_enabled IS TRUE;

  IF v_qualifying_count = 0 THEN
    RETURN 'new_conversations_disabled';
  ELSIF v_qualifying_count > 1 THEN
    RETURN 'ambiguous_workspace';
  END IF;

  SELECT s.workspace_id INTO v_workspace_id
    FROM public.project_inbox_settings s
    JOIN _pi_candidates c ON c.workspace_id = s.workspace_id
   WHERE s.new_conversations_enabled IS TRUE
   LIMIT 1;

  IF v_workspace_id IS NULL THEN
    RETURN 'no_candidate_workspace';
  END IF;

  -- 4. Atomic inbound dedupe inside this transaction.
  INSERT INTO public.telegram_inbound_updates
    (telegram_update_id, update_kind, telegram_chat_id, telegram_message_id, telegram_user_id, status)
  VALUES
    (_telegram_update_id, 'MESSAGE', _telegram_chat_id, _telegram_message_id, _telegram_user_id, 'RECEIVED')
  ON CONFLICT (telegram_update_id) DO NOTHING
  RETURNING telegram_update_id INTO v_inbound;

  IF v_inbound IS NULL THEN
    RETURN 'duplicate';
  END IF;

  -- 5. Get-or-create the workspace-scoped contact, then serialize on it.
  INSERT INTO public.project_inbox_contacts (workspace_id, telegram_user_id)
  VALUES (v_workspace_id, _telegram_user_id)
  ON CONFLICT (workspace_id, telegram_user_id) DO NOTHING;

  SELECT c.id, c.status
    INTO v_contact_id, v_contact_status
    FROM public.project_inbox_contacts c
   WHERE c.workspace_id = v_workspace_id
     AND c.telegram_user_id = _telegram_user_id
   FOR UPDATE;

  IF v_contact_id IS NULL THEN
    UPDATE public.telegram_inbound_updates
       SET status = 'IGNORED', processed_at = now(), updated_at = now(), last_error = 'contact_unavailable'
     WHERE telegram_update_id = _telegram_update_id;
    RETURN 'contact_unavailable';
  END IF;

  -- A BLOCKED contact is NEVER reactivated.
  IF v_contact_status <> 'ACTIVE' THEN
    UPDATE public.telegram_inbound_updates
       SET status = 'IGNORED', processed_at = now(), updated_at = now(), last_error = 'contact_blocked'
     WHERE telegram_update_id = _telegram_update_id;
    RETURN 'contact_blocked';
  END IF;

  -- 6. Continue the single unresolved MEMBER_INITIATED thread, else open one.
  SELECT v.id INTO v_conversation_id
    FROM public.project_conversations v
   WHERE v.workspace_id = v_workspace_id
     AND v.contact_id = v_contact_id
     AND v.origin_type = 'MEMBER_INITIATED'
     AND v.status IN ('OPEN', 'WAITING_ON_TEAM', 'WAITING_ON_MEMBER')
   FOR UPDATE;

  IF v_conversation_id IS NULL THEN
    BEGIN
      INSERT INTO public.project_conversations
        (workspace_id, contact_id, origin_type, category, status, priority)
      VALUES
        (v_workspace_id, v_contact_id, 'MEMBER_INITIATED', 'GENERAL', 'WAITING_ON_TEAM', 'NORMAL')
      RETURNING id INTO v_conversation_id;
    EXCEPTION WHEN unique_violation THEN
      -- Concurrent insert won the partial unique index: re-read the winner.
      SELECT v.id INTO v_conversation_id
        FROM public.project_conversations v
       WHERE v.workspace_id = v_workspace_id
         AND v.contact_id = v_contact_id
         AND v.origin_type = 'MEMBER_INITIATED'
         AND v.status IN ('OPEN', 'WAITING_ON_TEAM', 'WAITING_ON_MEMBER')
       FOR UPDATE;
    END;
  END IF;

  IF v_conversation_id IS NULL THEN
    UPDATE public.telegram_inbound_updates
       SET status = 'IGNORED', processed_at = now(), updated_at = now(), last_error = 'conversation_unavailable'
     WHERE telegram_update_id = _telegram_update_id;
    RETURN 'conversation_unavailable';
  END IF;

  -- 7. Exactly one MEMBER / TELEGRAM message.
  BEGIN
    INSERT INTO public.project_conversation_messages
      (conversation_id, author_type, channel, team_user_id, body,
       telegram_update_id, telegram_chat_id, telegram_message_id, telegram_reply_to_message_id)
    VALUES
      (v_conversation_id, 'MEMBER', 'TELEGRAM', NULL, v_body,
       _telegram_update_id, _telegram_chat_id, _telegram_message_id, NULL)
    RETURNING id INTO v_message_id;
  EXCEPTION WHEN unique_violation THEN
    UPDATE public.telegram_inbound_updates
       SET status = 'IGNORED', processed_at = now(), updated_at = now(), last_error = 'duplicate_message'
     WHERE telegram_update_id = _telegram_update_id;
    RETURN 'duplicate';
  END;

  -- 8. Mark PROCESSED only after the message exists.
  UPDATE public.telegram_inbound_updates
     SET status = 'PROCESSED', processed_at = now(), updated_at = now(),
         conversation_message_id = v_message_id, last_error = NULL
   WHERE telegram_update_id = _telegram_update_id;

  RETURN 'captured';
END;
$function$;

REVOKE ALL ON FUNCTION public.capture_project_inbox_member_message(bigint, bigint, bigint, bigint, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.capture_project_inbox_member_message(bigint, bigint, bigint, bigint, text) TO service_role;