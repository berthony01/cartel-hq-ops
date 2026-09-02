-- C6: schedule-change communication send (atomic, idempotent, operator-only).

ALTER TABLE public.launch_schedule_communications
  ADD COLUMN sent_event_id uuid REFERENCES public.launch_events(id) ON DELETE RESTRICT,
  ADD COLUMN sent_client_request_id uuid;

ALTER TABLE public.launch_schedule_communications
  ADD CONSTRAINT launch_schedule_communications_sent_fields_ck CHECK (
    (status = 'SENT'
      AND sent_event_id IS NOT NULL
      AND sent_client_request_id IS NOT NULL)
    OR
    (status <> 'SENT'
      AND sent_event_id IS NULL
      AND sent_client_request_id IS NULL)
  );

CREATE INDEX IF NOT EXISTS launch_schedule_communications_sent_event_idx
  ON public.launch_schedule_communications (sent_event_id);

-- Readable, timezone-honest rendering of a stored schedule snapshot.
CREATE OR REPLACE FUNCTION public.format_launch_schedule_snapshot(
  _at timestamptz,
  _ws timestamptz,
  _we timestamptz,
  _tz text
)
RETURNS text
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_tz text := coalesce(nullif(btrim(coalesce(_tz, '')), ''), 'UTC');
BEGIN
  BEGIN
    PERFORM now() AT TIME ZONE v_tz;
  EXCEPTION WHEN OTHERS THEN
    v_tz := 'UTC';
  END;

  IF _at IS NOT NULL THEN
    RETURN to_char(_at AT TIME ZONE v_tz, 'Dy DD Mon YYYY HH24:MI') || ' (' || v_tz || ')';
  ELSIF _ws IS NOT NULL AND _we IS NOT NULL THEN
    RETURN 'Between ' || to_char(_ws AT TIME ZONE v_tz, 'Dy DD Mon YYYY HH24:MI')
        || ' and ' || to_char(_we AT TIME ZONE v_tz, 'Dy DD Mon YYYY HH24:MI')
        || ' (' || v_tz || ')';
  ELSIF _ws IS NOT NULL THEN
    RETURN 'From ' || to_char(_ws AT TIME ZONE v_tz, 'Dy DD Mon YYYY HH24:MI') || ' (' || v_tz || ')';
  ELSIF _we IS NOT NULL THEN
    RETURN 'By ' || to_char(_we AT TIME ZONE v_tz, 'Dy DD Mon YYYY HH24:MI') || ' (' || v_tz || ')';
  END IF;

  RETURN 'Not set';
END;
$function$;

REVOKE ALL ON FUNCTION public.format_launch_schedule_snapshot(timestamptz, timestamptz, timestamptz, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.format_launch_schedule_snapshot(timestamptz, timestamptz, timestamptz, text) TO service_role;

CREATE OR REPLACE FUNCTION public.send_launch_schedule_communication(
  _id uuid,
  _client_request_id uuid,
  _note text DEFAULT NULL
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_row public.launch_schedule_communications%ROWTYPE;
  v_launch public.launches%ROWTYPE;
  v_launch_id uuid;
  v_actor uuid := auth.uid();
  v_note text;
  v_title text;
  v_body text;
  v_event_id uuid;
BEGIN
  IF _client_request_id IS NULL THEN
    RAISE EXCEPTION 'A client request id is required.' USING ERRCODE = '22023';
  END IF;

  SELECT launch_id INTO v_launch_id
    FROM public.launch_schedule_communications
   WHERE id = _id;

  IF v_launch_id IS NULL THEN
    RAISE EXCEPTION 'Schedule communication not found.' USING ERRCODE = 'P0002';
  END IF;

  -- Lock ordering: launches FIRST, then the communication row. This matches
  -- the launch UPDATE -> C5 AFTER trigger ordering and avoids deadlocks.
  SELECT * INTO v_launch FROM public.launches WHERE id = v_launch_id FOR UPDATE;
  IF v_launch.id IS NULL THEN
    RAISE EXCEPTION 'Launch not found.' USING ERRCODE = 'P0002';
  END IF;

  SELECT * INTO v_row
    FROM public.launch_schedule_communications
   WHERE id = _id
   FOR UPDATE;

  IF v_row.id IS NULL THEN
    RAISE EXCEPTION 'Schedule communication not found.' USING ERRCODE = 'P0002';
  END IF;

  IF v_actor IS NULL OR NOT public.is_workspace_operator(v_row.workspace_id, v_actor) THEN
    RAISE EXCEPTION 'Not authorized to send this schedule update.' USING ERRCODE = '42501';
  END IF;

  -- Idempotent ambiguous retry.
  IF v_row.status = 'SENT' THEN
    IF v_row.sent_event_id IS NOT NULL
       AND v_row.sent_client_request_id IS NOT DISTINCT FROM _client_request_id THEN
      RETURN v_row.sent_event_id;
    END IF;
    RAISE EXCEPTION 'This schedule update has already been sent.' USING ERRCODE = '22023';
  END IF;

  IF v_row.status <> 'PENDING' THEN
    RAISE EXCEPTION 'Schedule communication is already resolved (%).', v_row.status
      USING ERRCODE = '22023';
  END IF;

  -- Never send stale schedule facts.
  IF (v_launch.launch_at, v_launch.launch_window_start, v_launch.launch_window_end, v_launch.timezone)
     IS DISTINCT FROM
     (v_row.current_launch_at, v_row.current_window_start, v_row.current_window_end, v_row.current_timezone)
  THEN
    RAISE EXCEPTION 'The launch schedule changed since this update was prepared. Review it again.'
      USING ERRCODE = '22023';
  END IF;

  v_note := nullif(btrim(coalesce(_note, '')), '');
  IF v_note IS NOT NULL AND char_length(v_note) > 800 THEN
    RAISE EXCEPTION 'Explanation must be 800 characters or fewer.' USING ERRCODE = '22023';
  END IF;

  v_title := 'Launch schedule updated';

  v_body := 'The launch schedule for ' || v_launch.token_name || ' (' || v_launch.ticker || ') has been updated.'
    || E'\n\nPrevious: '
    || public.format_launch_schedule_snapshot(
         v_row.baseline_launch_at, v_row.baseline_window_start,
         v_row.baseline_window_end, v_row.baseline_timezone)
    || E'\nNew: '
    || public.format_launch_schedule_snapshot(
         v_row.current_launch_at, v_row.current_window_start,
         v_row.current_window_end, v_row.current_timezone);

  IF v_note IS NOT NULL THEN
    v_body := v_body || E'\n\nFrom the project:\n' || v_note;
  END IF;

  IF char_length(v_body) > 2200 THEN
    RAISE EXCEPTION 'The composed schedule update is too long. Shorten the explanation.'
      USING ERRCODE = '22023';
  END IF;

  -- Existing engine stays authoritative for lifecycle, profile gate, audience,
  -- anti-spam, daily cap, fan-out and idempotency.
  v_event_id := public.create_launch_watcher_update(
    v_launch.id, _client_request_id, v_title, v_body
  );

  IF v_event_id IS NULL THEN
    RAISE EXCEPTION 'The watcher update could not be created.' USING ERRCODE = '22023';
  END IF;

  UPDATE public.launch_schedule_communications
     SET status                 = 'SENT',
         resolved_at            = now(),
         resolved_by            = v_actor,
         sent_event_id          = v_event_id,
         sent_client_request_id = _client_request_id
   WHERE id = v_row.id
     AND status = 'PENDING';

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Schedule communication could not be marked as sent.' USING ERRCODE = '22023';
  END IF;

  RETURN v_event_id;
END;
$function$;

REVOKE ALL ON FUNCTION public.send_launch_schedule_communication(uuid, uuid, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.send_launch_schedule_communication(uuid, uuid, text) TO authenticated, service_role;

-- Re-assert the C5 table ACL after ALTER TABLE.
REVOKE ALL PRIVILEGES ON TABLE public.launch_schedule_communications FROM PUBLIC, anon, authenticated;
GRANT SELECT ON TABLE public.launch_schedule_communications TO authenticated;
GRANT ALL ON TABLE public.launch_schedule_communications TO service_role;