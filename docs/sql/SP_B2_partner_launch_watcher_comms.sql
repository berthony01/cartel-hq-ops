-- SP-B2 V1 Partner Launch Watcher Communications
-- STAGED ONLY. NOT APPLIED. Apply only at checkpoint CP-SPB2-SQL, after SP-A,
-- SP-B0 and SP-B1 are live (they are) and the staging regression passes.
--
-- Additive partner-only RPCs for the existing stored scope 'launch_watcher_comms'.
-- Every entry point:
--   * requires auth.uid()
--   * requires public.partner_has_scope(_workspace_id, 'launch_watcher_comms')
--     BEFORE any protected read
--   * resolves the launch ONLY by id AND workspace_id = _workspace_id
--     AND launch_kind = 'PROJECT' (internal test launches are never exposed)
--   * SECURITY DEFINER with SET search_path TO '' and fully qualified names
--   * returns aggregates / event text only: never telegram_user_id, chat ids,
--     subscription ids, contract, wallet, treasury or deployment data
--
-- partner_create_launch_watcher_update copies the owner
-- public.create_launch_watcher_update guards (client_request_id, launch FOR UPDATE
-- lock, lifecycle allow-list, published Project Profile, replay, title <= 120,
-- body 1..2200, >= 1 active+updates_enabled watcher, 60 s cooldown, 20 / 24 h,
-- unique_violation replay). It inserts WATCHER_UPDATE / source 'operator' only;
-- the existing enqueue trigger and launch-notifications worker are untouched.
-- The launch row is locked but never updated.
--
-- Commercial: matches the owner path, which has NO commercial gate today.
-- If owner watcher updates become gated, update this path in a separate phase
-- to the same CLIENT-workspace entitlement via the SP-B0 core.
--
-- No table, RLS, constraint, trigger, membership-helper, owner-RPC or Edge change.
-- Rollback: DROP FUNCTION the four partner_* functions below.

BEGIN;

CREATE OR REPLACE FUNCTION public.partner_list_launches_for_comms(_workspace_id uuid)
 RETURNS TABLE(launch_id uuid, token_name text, ticker text, status text, launch_at timestamp with time zone, can_send boolean)
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
BEGIN
  IF auth.uid() IS NULL OR _workspace_id IS NULL
     OR NOT public.partner_has_scope(_workspace_id, 'launch_watcher_comms') THEN
    RAISE EXCEPTION 'Not authorized' USING ERRCODE = '42501';
  END IF;

  RETURN QUERY
  SELECT l.id,
         l.token_name,
         l.ticker,
         l.status,
         l.launch_at,
         (l.status IN ('WATCHLIST_OPEN', 'LAUNCH_APPROACHING', 'CONTRACT_PENDING', 'OFFICIAL_CONTRACT_REGISTERED', 'LIVE')
          AND COALESCE(p.discovery_status, '') = 'published')
    FROM public.launches l
    LEFT JOIN public.project_profiles p ON p.id = l.project_profile_id
   WHERE l.workspace_id = _workspace_id
     AND l.launch_kind = 'PROJECT'
   ORDER BY l.created_at DESC
   LIMIT 50;
END;
$function$;

CREATE OR REPLACE FUNCTION public.partner_launch_watcher_stats(_workspace_id uuid, _launch_id uuid)
 RETURNS TABLE(active_watchers bigint, updates_enabled_watchers bigint, updates_muted_watchers bigint)
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
BEGIN
  IF auth.uid() IS NULL OR _workspace_id IS NULL
     OR NOT public.partner_has_scope(_workspace_id, 'launch_watcher_comms') THEN
    RAISE EXCEPTION 'Not authorized' USING ERRCODE = '42501';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM public.launches l
     WHERE l.id = _launch_id AND l.workspace_id = _workspace_id AND l.launch_kind = 'PROJECT'
  ) THEN
    RAISE EXCEPTION 'Not authorized' USING ERRCODE = '42501';
  END IF;

  RETURN QUERY
  SELECT
    count(*) FILTER (WHERE s.is_active)::bigint,
    count(*) FILTER (WHERE s.is_active AND s.updates_enabled)::bigint,
    count(*) FILTER (WHERE s.is_active AND NOT s.updates_enabled)::bigint
  FROM public.launch_watch_subscriptions s
  WHERE s.launch_id = _launch_id;
END;
$function$;

CREATE OR REPLACE FUNCTION public.partner_list_launch_watcher_updates(_workspace_id uuid, _launch_id uuid, _limit integer DEFAULT 10)
 RETURNS TABLE(event_id uuid, title text, body text, created_at timestamp with time zone, pending_count bigint, sent_count bigint, failed_count bigint, ambiguous_count bigint, skipped_count bigint)
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
DECLARE
  _effective_limit integer := LEAST(GREATEST(COALESCE(_limit, 10), 1), 20);
BEGIN
  IF auth.uid() IS NULL OR _workspace_id IS NULL
     OR NOT public.partner_has_scope(_workspace_id, 'launch_watcher_comms') THEN
    RAISE EXCEPTION 'Not authorized' USING ERRCODE = '42501';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM public.launches l
     WHERE l.id = _launch_id AND l.workspace_id = _workspace_id AND l.launch_kind = 'PROJECT'
  ) THEN
    RAISE EXCEPTION 'Not authorized' USING ERRCODE = '42501';
  END IF;

  RETURN QUERY
  SELECT
    e.id,
    (e.payload ->> 'title')::text,
    (e.payload ->> 'body')::text,
    e.created_at,
    (SELECT count(*)::bigint FROM public.launch_notification_deliveries d
      WHERE d.event_id = e.id AND d.status IN ('pending','processing','retry')),
    (SELECT count(*)::bigint FROM public.launch_notification_deliveries d
      WHERE d.event_id = e.id AND d.status = 'sent'),
    (SELECT count(*)::bigint FROM public.launch_notification_deliveries d
      WHERE d.event_id = e.id AND d.status = 'failed'),
    (SELECT count(*)::bigint FROM public.launch_notification_deliveries d
      WHERE d.event_id = e.id AND d.status = 'ambiguous'),
    (SELECT count(*)::bigint FROM public.launch_notification_deliveries d
      WHERE d.event_id = e.id AND d.status = 'skipped')
  FROM public.launch_events e
  WHERE e.launch_id = _launch_id
    AND e.event_type = 'WATCHER_UPDATE'
  ORDER BY e.created_at DESC
  LIMIT _effective_limit;
END;
$function$;

CREATE OR REPLACE FUNCTION public.partner_create_launch_watcher_update(_workspace_id uuid, _launch_id uuid, _client_request_id uuid, _title text, _body text)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
DECLARE
  _uid uuid := auth.uid();
  _launch public.launches%ROWTYPE;
  _discovery text;
  _access_id uuid;
  _norm_title text;
  _norm_body text;
  _existing uuid;
  _event_id uuid;
  _eligible bigint;
  _recent bigint;
  _daily bigint;
BEGIN
  -- Partner authorization replaces the owner is_workspace_operator check and
  -- runs BEFORE any launch data is read.
  IF _uid IS NULL OR _workspace_id IS NULL
     OR NOT public.partner_has_scope(_workspace_id, 'launch_watcher_comms') THEN
    RAISE EXCEPTION 'Not authorized' USING ERRCODE = '42501';
  END IF;

  IF _client_request_id IS NULL THEN
    RAISE EXCEPTION 'A client request id is required.' USING ERRCODE = '22023';
  END IF;

  -- Serialize concurrent sends for this launch (same lock as the owner path).
  -- The row is locked only; it is never updated here.
  SELECT * INTO _launch FROM public.launches l
   WHERE l.id = _launch_id AND l.workspace_id = _workspace_id AND l.launch_kind = 'PROJECT'
   FOR UPDATE;
  IF _launch.id IS NULL THEN
    RAISE EXCEPTION 'Not authorized' USING ERRCODE = '42501';
  END IF;

  IF _launch.status NOT IN (
    'WATCHLIST_OPEN',
    'LAUNCH_APPROACHING',
    'CONTRACT_PENDING',
    'OFFICIAL_CONTRACT_REGISTERED',
    'LIVE'
  ) THEN
    RAISE EXCEPTION 'Watcher updates are not available at this lifecycle stage.' USING ERRCODE = '22023';
  END IF;

  SELECT p.discovery_status INTO _discovery
    FROM public.project_profiles p
   WHERE p.id = _launch.project_profile_id;

  IF COALESCE(_discovery, '') <> 'published' THEN
    RAISE EXCEPTION 'Publish the Project Profile before sending watcher updates.' USING ERRCODE = '22023';
  END IF;

  SELECT e.id INTO _existing
    FROM public.launch_events e
   WHERE e.launch_id = _launch_id
     AND e.event_type = 'WATCHER_UPDATE'
     AND (e.payload ->> 'client_request_id') = _client_request_id::text
   LIMIT 1;

  IF _existing IS NOT NULL THEN
    RETURN _existing;
  END IF;

  _norm_title := NULLIF(btrim(COALESCE(_title, '')), '');
  _norm_body := btrim(COALESCE(_body, ''));

  IF _norm_title IS NOT NULL AND char_length(_norm_title) > 120 THEN
    RAISE EXCEPTION 'Title must be 120 characters or fewer.' USING ERRCODE = '22023';
  END IF;

  IF _norm_body = '' THEN
    RAISE EXCEPTION 'Update text is required.' USING ERRCODE = '22023';
  END IF;

  IF char_length(_norm_body) > 2200 THEN
    RAISE EXCEPTION 'Update text must be 2200 characters or fewer.' USING ERRCODE = '22023';
  END IF;

  SELECT count(*)::bigint INTO _eligible
    FROM public.launch_watch_subscriptions s
   WHERE s.launch_id = _launch_id
     AND s.is_active = true
     AND s.updates_enabled = true;

  IF _eligible < 1 THEN
    RAISE EXCEPTION 'No active watchers currently allow project updates.' USING ERRCODE = '22023';
  END IF;

  SELECT count(*)::bigint INTO _recent
    FROM public.launch_events e
   WHERE e.launch_id = _launch_id
     AND e.event_type = 'WATCHER_UPDATE'
     AND e.created_at > now() - interval '60 seconds';

  IF _recent > 0 THEN
    RAISE EXCEPTION 'Please wait a minute between watcher updates.' USING ERRCODE = '22023';
  END IF;

  SELECT count(*)::bigint INTO _daily
    FROM public.launch_events e
   WHERE e.launch_id = _launch_id
     AND e.event_type = 'WATCHER_UPDATE'
     AND e.created_at > now() - interval '24 hours';

  IF _daily >= 20 THEN
    RAISE EXCEPTION 'Daily watcher update limit reached for this launch.' USING ERRCODE = '22023';
  END IF;

  -- Audit reference to the grant used (internal; never returned to callers).
  SELECT a.id INTO _access_id
    FROM public.partner_client_access a
   WHERE a.workspace_id = _workspace_id
     AND a.partner_user_id = _uid
     AND a.status = 'active'
   LIMIT 1;

  INSERT INTO public.launch_events (launch_id, event_type, source, scheduled_for, payload)
  VALUES (
    _launch_id,
    'WATCHER_UPDATE',
    'operator',
    now(),
    jsonb_build_object(
      'version', 1,
      'client_request_id', _client_request_id::text,
      'title', _norm_title,
      'body', _norm_body,
      'actor', 'service_partner',
      'partner_access_id', _access_id
    )
  )
  RETURNING id INTO _event_id;

  RETURN _event_id;
EXCEPTION
  WHEN unique_violation THEN
    SELECT e.id INTO _existing
      FROM public.launch_events e
     WHERE e.launch_id = _launch_id
       AND e.event_type = 'WATCHER_UPDATE'
       AND (e.payload ->> 'client_request_id') = _client_request_id::text
     LIMIT 1;
    IF _existing IS NULL THEN
      RAISE;
    END IF;
    RETURN _existing;
END;
$function$;

REVOKE ALL ON FUNCTION public.partner_list_launches_for_comms(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.partner_list_launches_for_comms(uuid) TO authenticated, service_role;
REVOKE ALL ON FUNCTION public.partner_launch_watcher_stats(uuid, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.partner_launch_watcher_stats(uuid, uuid) TO authenticated, service_role;
REVOKE ALL ON FUNCTION public.partner_list_launch_watcher_updates(uuid, uuid, integer) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.partner_list_launch_watcher_updates(uuid, uuid, integer) TO authenticated, service_role;
REVOKE ALL ON FUNCTION public.partner_create_launch_watcher_update(uuid, uuid, uuid, text, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.partner_create_launch_watcher_update(uuid, uuid, uuid, text, text) TO authenticated, service_role;

COMMIT;
