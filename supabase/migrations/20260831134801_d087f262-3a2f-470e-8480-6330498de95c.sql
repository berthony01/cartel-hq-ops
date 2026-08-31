create or replace function public.get_my_launch_watchlist_state()
returns table(telegram_connected boolean, active_watch_count bigint)
language sql
stable
security definer
set search_path to 'public'
as $function$
  select
    exists (
      select 1 from public.telegram_connections tc
      where auth.uid() is not null and tc.user_id = auth.uid()
    ) as telegram_connected,
    (
      select count(*)::bigint
      from public.launch_watch_subscriptions s
      join public.telegram_connections tc
        on tc.telegram_user_id = s.telegram_user_id
      join public.launches l on l.id = s.launch_id
      join public.project_profiles p on p.id = l.project_profile_id
      where auth.uid() is not null
        and tc.user_id = auth.uid()
        and s.is_active = true
        and p.discovery_status = 'published'
        and l.status <> 'DRAFT'
    ) as active_watch_count;
$function$;

revoke all on function public.get_my_launch_watchlist_state() from public;
revoke all on function public.get_my_launch_watchlist_state() from anon;
grant execute on function public.get_my_launch_watchlist_state() to authenticated;

create or replace function public.get_my_launch_watchlist()
returns table(
  launch_public_slug text,
  token_name text,
  ticker text,
  chain text,
  status text,
  launch_at timestamptz,
  launch_window_start timestamptz,
  launch_window_end timestamptz,
  timezone text,
  official_contract_address text,
  contract_registered_at timestamptz,
  live_at timestamptz,
  project_public_slug text,
  project_name text,
  project_primary_chain text,
  has_logo boolean,
  reminders_enabled boolean,
  subscribed_at timestamptz
)
language sql
stable
security definer
set search_path to 'public'
as $function$
  select
    l.public_slug,
    l.token_name,
    l.ticker,
    l.chain,
    l.status,
    l.launch_at,
    l.launch_window_start,
    l.launch_window_end,
    l.timezone,
    case when l.contract_registered_at is not null
               and l.status = any(array['OFFICIAL_CONTRACT_REGISTERED','LIVE','COMPLETED'])
         then l.official_contract_address else null end,
    case when l.contract_registered_at is not null
               and l.status = any(array['OFFICIAL_CONTRACT_REGISTERED','LIVE','COMPLETED'])
         then l.contract_registered_at else null end,
    l.live_at,
    p.public_slug,
    p.project_name,
    p.primary_chain,
    (p.logo_asset_id is not null) as has_logo,
    s.reminders_enabled,
    s.subscribed_at
  from public.launch_watch_subscriptions s
  join public.telegram_connections tc
    on tc.telegram_user_id = s.telegram_user_id
  join public.launches l on l.id = s.launch_id
  join public.project_profiles p on p.id = l.project_profile_id
  where auth.uid() is not null
    and tc.user_id = auth.uid()
    and s.is_active = true
    and p.discovery_status = 'published'
    and l.status <> 'DRAFT'
  order by
    (l.status = 'COMPLETED') asc,
    coalesce(l.launch_at, l.launch_window_start) asc nulls last,
    s.subscribed_at desc,
    l.public_slug asc;
$function$;

revoke all on function public.get_my_launch_watchlist() from public;
revoke all on function public.get_my_launch_watchlist() from anon;
grant execute on function public.get_my_launch_watchlist() to authenticated;

create or replace function public.get_cartel_network_signals(
  _chain text default null,
  _limit integer default 24,
  _offset integer default 0
)
returns table(
  signal_type text,
  occurred_at timestamptz,
  launch_public_slug text,
  token_name text,
  ticker text,
  chain text,
  status text,
  official_contract_address text,
  project_public_slug text,
  project_name text,
  project_primary_chain text,
  has_logo boolean,
  total_count bigint
)
language sql
stable
security definer
set search_path to 'public'
as $function$
  with params as (
    select
      nullif(left(btrim(coalesce(_chain, '')), 64), '') as chain_filter,
      least(greatest(coalesce(_limit, 24), 1), 50) as lim,
      greatest(coalesce(_offset, 0), 0) as off
  ),
  base as (
    select l.*, p.public_slug as project_public_slug, p.project_name,
           p.primary_chain as project_primary_chain,
           (p.logo_asset_id is not null) as has_logo
    from public.launches l
    join public.project_profiles p on p.id = l.project_profile_id
    cross join params pr
    where p.discovery_status = 'published'
      and l.status <> 'DRAFT'
      and (pr.chain_filter is null or lower(l.chain) = lower(pr.chain_filter))
  ),
  events as (
    select 'LAUNCH_ANNOUNCED'::text as signal_type, b.announced_at as occurred_at, b.* from base b where b.announced_at is not null
    union all
    select 'WATCHLIST_OPENED', b.watchlist_opened_at, b.* from base b where b.watchlist_opened_at is not null
    union all
    select 'OFFICIAL_CONTRACT_REGISTERED', b.contract_registered_at, b.* from base b where b.contract_registered_at is not null
    union all
    select 'LAUNCH_LIVE', b.live_at, b.* from base b where b.live_at is not null
    union all
    select 'LAUNCH_COMPLETED', b.completed_at, b.* from base b where b.completed_at is not null
  ),
  ranked as (
    select
      e.signal_type,
      e.occurred_at,
      e.public_slug as launch_public_slug,
      e.token_name,
      e.ticker,
      e.chain,
      e.status,
      case when e.contract_registered_at is not null
                 and e.status = any(array['OFFICIAL_CONTRACT_REGISTERED','LIVE','COMPLETED'])
           then e.official_contract_address else null end as official_contract_address,
      e.project_public_slug,
      e.project_name,
      e.project_primary_chain,
      e.has_logo,
      count(*) over ()::bigint as total_count
    from events e
  )
  select r.*
  from ranked r
  cross join params pr
  order by r.occurred_at desc, r.launch_public_slug asc, r.signal_type asc
  offset (select off from params)
  limit (select lim from params);
$function$;

revoke all on function public.get_cartel_network_signals(text, integer, integer) from public;
grant execute on function public.get_cartel_network_signals(text, integer, integer) to anon;
grant execute on function public.get_cartel_network_signals(text, integer, integer) to authenticated;