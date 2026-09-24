-- Commercial Foundation B: function-only commercial guards for four browser RPCs.
-- No table, schema, policy, grant or data change. Signatures/return types/security preserved.

CREATE OR REPLACE FUNCTION public.transition_launch_status(_launch_id uuid, _target_status text)
 RETURNS launches
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  launch_row public.launches;
  normalized_target text;
  v_commercial jsonb;
begin
  select * into launch_row
  from public.launches
  where id = _launch_id
  for update;

  if launch_row.id is null then
    raise exception 'Launch not found.' using errcode = 'P0002';
  end if;

  if not public.is_workspace_operator(launch_row.workspace_id, auth.uid()) then
    raise exception 'You do not have permission to manage this launch.' using errcode = '42501';
  end if;

  normalized_target := upper(btrim(_target_status));

  -- Commercial Foundation B: only opening Launch Watch is commercially guarded.
  if normalized_target = 'WATCHLIST_OPEN' then
    v_commercial := public.evaluate_commercial_access(launch_row.workspace_id, 'launch_watch', auth.uid());
    if coalesce((v_commercial->>'allowed')::boolean, false) is not true then
      raise exception 'COMMERCIAL_ACCESS_DENIED: %', coalesce(v_commercial->>'reason', 'UNKNOWN') using errcode = '42501';
    end if;
  end if;

  update public.launches
  set status = normalized_target
  where id = _launch_id
  returning * into launch_row;

  return launch_row;
end;
$function$;

CREATE OR REPLACE FUNCTION public.notify_launch_watchers_official_contract(_launch_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  l public.launches;
  derived_address text;
  profile_published boolean;
  v_event_id uuid;
  inserted boolean := false;
  v_delivery_count integer := 0;
  v_commercial jsonb;
begin
  select * into l from public.launches where id = _launch_id for update;
  if l.id is null then
    raise exception 'Launch not found.' using errcode = 'P0002';
  end if;

  -- Strongest existing C8.7 boundary: owner-only, workspace-isolated.
  if not public.is_workspace_owner(l.workspace_id, auth.uid()) then
    raise exception 'Only the project owner can notify Launch Watch subscribers.' using errcode = '42501';
  end if;

  -- Commercial Foundation B: official broadcast entitlement before any enqueue.
  v_commercial := public.evaluate_commercial_access(l.workspace_id, 'official_broadcasts', auth.uid());
  if coalesce((v_commercial->>'allowed')::boolean, false) is not true then
    raise exception 'COMMERCIAL_ACCESS_DENIED: %', coalesce(v_commercial->>'reason', 'UNKNOWN') using errcode = '42501';
  end if;

  if l.status is distinct from 'OFFICIAL_CONTRACT_REGISTERED' then
    raise exception 'Launch Watch subscribers can only be notified while the launch is at Official Contract Registered.' using errcode = '22023';
  end if;

  -- Fail closed on any partial registration record.
  if nullif(btrim(coalesce(l.official_contract_address, '')), '') is null
     or l.official_contract_deployment_id is null
     or l.contract_registered_at is null
     or l.contract_registered_by is null then
    raise exception 'This launch does not carry a complete evidence-bound official contract registration.' using errcode = '22023';
  end if;

  -- Re-derive the address from the bound evidence. The client is never trusted.
  derived_address := public.assert_launch_contract_evidence(
    l.id,
    l.workspace_id,
    l.chain,
    l.official_contract_deployment_id
  );

  if lower(btrim(derived_address)) is distinct from lower(btrim(l.official_contract_address)) then
    raise exception 'The registered official contract no longer matches its bound deployment evidence.' using errcode = '22023';
  end if;

  select (pp.discovery_status = 'published') into profile_published
  from public.project_profiles pp
  where pp.id = l.project_profile_id;

  if coalesce(profile_published, false) is not true then
    raise exception 'The project profile must be published before Launch Watch subscribers can be notified.' using errcode = '22023';
  end if;

  -- Idempotency reuses the existing launch_events uniqueness key. The
  -- scheduled_for anchor is the immutable registration timestamp, so a retry
  -- or double click can never create a second logical event.
  insert into public.launch_events (
    launch_id, event_type, source, scheduled_for, payload
  ) values (
    l.id,
    'OFFICIAL_CONTRACT_REGISTERED',
    'operator',
    l.contract_registered_at,
    public.launch_notification_payload(l.id)
  )
  on conflict (launch_id, event_type, scheduled_for) do nothing
  returning id into v_event_id;

  if v_event_id is not null then
    inserted := true;
  else
    select e.id into v_event_id
    from public.launch_events e
    where e.launch_id = l.id
      and e.event_type = 'OFFICIAL_CONTRACT_REGISTERED'
      and e.scheduled_for = l.contract_registered_at;
  end if;

  select count(*) into v_delivery_count
  from public.launch_notification_deliveries d
  where d.event_id = v_event_id;

  return jsonb_build_object(
    'status', case when inserted then 'queued' else 'already_notified' end,
    'event_id', v_event_id,
    'delivery_count', v_delivery_count
  );
end;
$function$;

CREATE OR REPLACE FUNCTION public.set_project_inbox_replies_enabled(_workspace_id uuid, _enabled boolean)
 RETURNS TABLE(workspace_id uuid, replies_enabled boolean, new_conversations_enabled boolean, security_warning_version text, updated_at timestamp with time zone)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_commercial jsonb;
BEGIN
  IF NOT public.is_workspace_operator(_workspace_id, auth.uid()) THEN
    RAISE EXCEPTION 'Not authorized' USING ERRCODE = '42501';
  END IF;

  -- Commercial Foundation B: only ENABLING replies is guarded; disabling never is.
  IF COALESCE(_enabled, false) = true THEN
    v_commercial := public.evaluate_commercial_access(_workspace_id, 'project_inbox', auth.uid());
    IF COALESCE((v_commercial->>'allowed')::boolean, false) IS NOT TRUE THEN
      RAISE EXCEPTION 'COMMERCIAL_ACCESS_DENIED: %', COALESCE(v_commercial->>'reason', 'UNKNOWN') USING ERRCODE = '42501';
    END IF;
  END IF;

  RETURN QUERY
  INSERT INTO public.project_inbox_settings AS s
    (workspace_id, replies_enabled, updated_by, updated_at)
  VALUES
    (_workspace_id, COALESCE(_enabled, false), auth.uid(), now())
  ON CONFLICT (workspace_id) DO UPDATE
    SET replies_enabled = COALESCE(EXCLUDED.replies_enabled, false),
        updated_by = auth.uid(),
        updated_at = now()
  RETURNING s.workspace_id, s.replies_enabled, s.new_conversations_enabled, s.security_warning_version, s.updated_at;
END;
$function$;

CREATE OR REPLACE FUNCTION public.create_project_inbox_team_reply(_workspace_id uuid, _conversation_id uuid, _body text, _client_request_id uuid)
 RETURNS TABLE(message_id uuid, delivery_status text, created_at timestamp with time zone, conversation_status text, idempotent_replay boolean)
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
  v_commercial jsonb;
BEGIN
  IF _workspace_id IS NULL OR _conversation_id IS NULL OR _client_request_id IS NULL OR v_uid IS NULL THEN
    RAISE EXCEPTION 'Not authorized' USING ERRCODE = '42501';
  END IF;

  IF NOT public.is_workspace_operator(_workspace_id, v_uid) THEN
    RAISE EXCEPTION 'Not authorized' USING ERRCODE = '42501';
  END IF;

  -- Commercial Foundation B: project_inbox entitlement before any insert/enqueue.
  v_commercial := public.evaluate_commercial_access(_workspace_id, 'project_inbox', v_uid);
  IF COALESCE((v_commercial->>'allowed')::boolean, false) IS NOT TRUE THEN
    RAISE EXCEPTION 'COMMERCIAL_ACCESS_DENIED: %', COALESCE(v_commercial->>'reason', 'UNKNOWN') USING ERRCODE = '42501';
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