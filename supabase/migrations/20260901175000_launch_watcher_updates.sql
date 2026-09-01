-- Launch Control L2A — Watcher Updates (manual, privacy-first project updates).
--
-- Reuses the existing launch_events -> launch_notification_deliveries ->
-- launch-notifications worker architecture. No new fan-out mechanism, no new
-- delivery table, and no watcher identity is ever exposed to the browser.

-- ---------------------------------------------------------------------------
-- A1. Subscription preference with consent-preserving backfill.
--
-- Existing watchers joined under copy that said "Nothing else is sent." They
-- are therefore backfilled FALSE and can only opt in themselves, from inside
-- Telegram. Only NEW subscriptions default to TRUE, under the new disclosure.
-- reminders_enabled is untouched.
-- ---------------------------------------------------------------------------
alter table public.launch_watch_subscriptions
  add column if not exists updates_enabled boolean;

update public.launch_watch_subscriptions
set updates_enabled = false
where updates_enabled is null;

alter table public.launch_watch_subscriptions
  alter column updates_enabled set default true;

alter table public.launch_watch_subscriptions
  alter column updates_enabled set not null;

-- ---------------------------------------------------------------------------
-- A2. Extend event checks, preserving every existing value.
-- ---------------------------------------------------------------------------
alter table public.launch_events
  drop constraint if exists launch_events_event_type_check;

alter table public.launch_events
  add constraint launch_events_event_type_check
  check (event_type = any (array[
    'REMINDER_24H',
    'REMINDER_1H',
    'OFFICIAL_CONTRACT_REGISTERED',
    'LAUNCH_LIVE',
    'WATCHER_UPDATE'
  ]::text[]));

alter table public.launch_events
  drop constraint if exists launch_events_source_check;

alter table public.launch_events
  add constraint launch_events_source_check
  check (source = any (array[
    'reminder_runner',
    'lifecycle',
    'operator'
  ]::text[]));

-- ---------------------------------------------------------------------------
-- Idempotency for operator-created watcher updates:
-- exactly one WATCHER_UPDATE event per (launch, client_request_id).
-- ---------------------------------------------------------------------------
create unique index if not exists launch_events_watcher_update_request_uniq
  on public.launch_events (launch_id, ((payload ->> 'client_request_id')))
  where event_type = 'WATCHER_UPDATE';

-- ---------------------------------------------------------------------------
-- A3. Fan-out trigger function (same name/signature; trigger untouched).
--
-- Preference gating is per event class:
--   REMINDER_24H / REMINDER_1H -> reminders_enabled
--   WATCHER_UPDATE             -> updates_enabled
--   contract / live lifecycle  -> all active watchers, regardless of mutes
-- ---------------------------------------------------------------------------
create or replace function public.enqueue_launch_event_deliveries()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $function$
begin
  insert into public.launch_notification_deliveries (
    event_id,
    launch_id,
    subscription_id,
    telegram_user_id,
    status,
    next_attempt_at
  )
  select
    new.id,
    new.launch_id,
    s.id,
    s.telegram_user_id,
    'pending',
    now()
  from public.launch_watch_subscriptions s
  where s.launch_id = new.launch_id
    and s.is_active = true
    and (
      new.event_type not in ('REMINDER_24H','REMINDER_1H')
      or s.reminders_enabled = true
    )
    and (
      new.event_type <> 'WATCHER_UPDATE'
      or s.updates_enabled = true
    )
  on conflict (event_id, subscription_id) do nothing;

  return new;
end;
$function$;

-- ---------------------------------------------------------------------------
-- A4. Idempotent authenticated operator RPC.
-- ---------------------------------------------------------------------------
create or replace function public.create_launch_watcher_update(
  _launch_id uuid,
  _client_request_id uuid,
  _title text,
  _body text
)
returns uuid
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  _launch public.launches%rowtype;
  _discovery text;
  _norm_title text;
  _norm_body text;
  _existing uuid;
  _event_id uuid;
  _eligible bigint;
  _recent bigint;
  _daily bigint;
begin
  if _client_request_id is null then
    raise exception 'A client request id is required.' using errcode = '22023';
  end if;

  select * into _launch from public.launches l where l.id = _launch_id;
  if _launch.id is null then
    raise exception 'Launch not found.' using errcode = 'P0002';
  end if;

  if not public.is_workspace_operator(_launch.workspace_id, auth.uid()) then
    raise exception 'Only project owners and admins can send watcher updates.' using errcode = '42501';
  end if;

  if _launch.status not in (
    'WATCHLIST_OPEN',
    'LAUNCH_APPROACHING',
    'CONTRACT_PENDING',
    'OFFICIAL_CONTRACT_REGISTERED',
    'LIVE'
  ) then
    raise exception 'Watcher updates are not available at this lifecycle stage.' using errcode = '22023';
  end if;

  select p.discovery_status into _discovery
  from public.project_profiles p
  where p.id = _launch.project_profile_id;

  if coalesce(_discovery, '') <> 'published' then
    raise exception 'Publish the Project Profile before sending watcher updates.' using errcode = '22023';
  end if;

  -- Idempotent retry: the same client request id always returns the first event.
  select e.id into _existing
  from public.launch_events e
  where e.launch_id = _launch_id
    and e.event_type = 'WATCHER_UPDATE'
    and (e.payload ->> 'client_request_id') = _client_request_id::text
  limit 1;

  if _existing is not null then
    return _existing;
  end if;

  _norm_title := nullif(btrim(coalesce(_title, '')), '');
  _norm_body := btrim(coalesce(_body, ''));

  if _norm_title is not null and char_length(_norm_title) > 120 then
    raise exception 'Title must be 120 characters or fewer.' using errcode = '22023';
  end if;

  if _norm_body = '' then
    raise exception 'Update text is required.' using errcode = '22023';
  end if;

  if char_length(_norm_body) > 2200 then
    raise exception 'Update text must be 2200 characters or fewer.' using errcode = '22023';
  end if;

  select count(*)::bigint into _eligible
  from public.launch_watch_subscriptions s
  where s.launch_id = _launch_id
    and s.is_active = true
    and s.updates_enabled = true;

  if _eligible < 1 then
    raise exception 'No active watchers currently allow project updates.' using errcode = '22023';
  end if;

  select count(*)::bigint into _recent
  from public.launch_events e
  where e.launch_id = _launch_id
    and e.event_type = 'WATCHER_UPDATE'
    and e.created_at > now() - interval '60 seconds';

  if _recent > 0 then
    raise exception 'Please wait a minute between watcher updates.' using errcode = '22023';
  end if;

  select count(*)::bigint into _daily
  from public.launch_events e
  where e.launch_id = _launch_id
    and e.event_type = 'WATCHER_UPDATE'
    and e.created_at > now() - interval '24 hours';

  if _daily >= 20 then
    raise exception 'Daily watcher update limit reached for this launch.' using errcode = '22023';
  end if;

  insert into public.launch_events (launch_id, event_type, source, scheduled_for, payload)
  values (
    _launch_id,
    'WATCHER_UPDATE',
    'operator',
    now(),
    jsonb_build_object(
      'version', 1,
      'client_request_id', _client_request_id::text,
      'title', _norm_title,
      'body', _norm_body
    )
  )
  returning id into _event_id;

  return _event_id;
exception
  when unique_violation then
    -- A concurrent identical request already created the event.
    select e.id into _existing
    from public.launch_events e
    where e.launch_id = _launch_id
      and e.event_type = 'WATCHER_UPDATE'
      and (e.payload ->> 'client_request_id') = _client_request_id::text
    limit 1;
    if _existing is null then
      raise;
    end if;
    return _existing;
end;
$function$;

-- ---------------------------------------------------------------------------
-- A5. Aggregate-only read RPCs (workspace membership; read-only members OK).
-- ---------------------------------------------------------------------------
create or replace function public.get_launch_watcher_update_stats(_launch_id uuid)
returns table(
  active_watchers bigint,
  updates_enabled_watchers bigint,
  updates_muted_watchers bigint
)
language plpgsql
stable
security definer
set search_path to 'public'
as $function$
declare
  _workspace_id uuid;
begin
  select l.workspace_id into _workspace_id
  from public.launches l
  where l.id = _launch_id;

  if _workspace_id is null then
    raise exception 'Launch not found.' using errcode = 'P0002';
  end if;

  if not public.is_workspace_member(_workspace_id, auth.uid()) then
    raise exception 'You do not have access to this launch.' using errcode = '42501';
  end if;

  return query
  select
    count(*) filter (where s.is_active)::bigint,
    count(*) filter (where s.is_active and s.updates_enabled)::bigint,
    count(*) filter (where s.is_active and not s.updates_enabled)::bigint
  from public.launch_watch_subscriptions s
  where s.launch_id = _launch_id;
end;
$function$;

create or replace function public.list_launch_watcher_updates(
  _launch_id uuid,
  _limit integer default 10
)
returns table(
  event_id uuid,
  title text,
  body text,
  created_at timestamptz,
  pending_count bigint,
  sent_count bigint,
  failed_count bigint,
  ambiguous_count bigint,
  skipped_count bigint
)
language plpgsql
stable
security definer
set search_path to 'public'
as $function$
declare
  _workspace_id uuid;
  _effective_limit integer;
begin
  select l.workspace_id into _workspace_id
  from public.launches l
  where l.id = _launch_id;

  if _workspace_id is null then
    raise exception 'Launch not found.' using errcode = 'P0002';
  end if;

  if not public.is_workspace_member(_workspace_id, auth.uid()) then
    raise exception 'You do not have access to this launch.' using errcode = '42501';
  end if;

  _effective_limit := least(greatest(coalesce(_limit, 10), 1), 20);

  return query
  select
    e.id,
    (e.payload ->> 'title')::text,
    (e.payload ->> 'body')::text,
    e.created_at,
    (select count(*)::bigint from public.launch_notification_deliveries d
      where d.event_id = e.id and d.status in ('pending','processing','retry')),
    (select count(*)::bigint from public.launch_notification_deliveries d
      where d.event_id = e.id and d.status = 'sent'),
    (select count(*)::bigint from public.launch_notification_deliveries d
      where d.event_id = e.id and d.status = 'failed'),
    (select count(*)::bigint from public.launch_notification_deliveries d
      where d.event_id = e.id and d.status = 'ambiguous'),
    (select count(*)::bigint from public.launch_notification_deliveries d
      where d.event_id = e.id and d.status = 'skipped')
  from public.launch_events e
  where e.launch_id = _launch_id
    and e.event_type = 'WATCHER_UPDATE'
  order by e.created_at desc
  limit _effective_limit;
end;
$function$;

-- ---------------------------------------------------------------------------
-- Execution grants: authenticated callers only.
-- ---------------------------------------------------------------------------
revoke all on function public.create_launch_watcher_update(uuid, uuid, text, text) from public;
revoke all on function public.get_launch_watcher_update_stats(uuid) from public;
revoke all on function public.list_launch_watcher_updates(uuid, integer) from public;

grant execute on function public.create_launch_watcher_update(uuid, uuid, text, text) to authenticated;
grant execute on function public.get_launch_watcher_update_stats(uuid) to authenticated;
grant execute on function public.list_launch_watcher_updates(uuid, integer) to authenticated;
