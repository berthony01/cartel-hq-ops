create table public.launch_production_deployment_requests (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete restrict,
  project_profile_id uuid not null references public.project_profiles(id) on delete restrict,
  launch_id uuid not null references public.launches(id) on delete restrict,
  status text not null default 'REQUESTED' check (status in ('REQUESTED','IN_REVIEW','APPROVED','EXECUTING','DECLINED','WITHDRAWN')),
  chain_id bigint not null default 4663 check (chain_id = 4663),
  network_environment text not null default 'PRODUCTION' check (network_environment = 'PRODUCTION'),
  declared_chain text not null,
  token_name text not null check (char_length(token_name) between 1 and 32 and token_name ~ '^[ -~]+$'),
  token_symbol text not null check (token_symbol ~ '^[A-Z0-9]{2,11}$'),
  token_decimals smallint not null default 18 check (token_decimals = 18),
  token_supply_whole numeric not null check (token_supply_whole = trunc(token_supply_whole) and token_supply_whole between 1 and 1000000000000),
  token_total_supply_base_units numeric not null check (token_total_supply_base_units = token_supply_whole * 1000000000000000000::numeric),
  token_recipient text not null check (token_recipient ~ '^0x[0-9a-f]{40}$' and token_recipient <> '0x0000000000000000000000000000000000000000'),
  requested_by uuid not null references auth.users(id) on delete restrict,
  requested_at timestamptz not null default now(),
  assigned_operator_id uuid references auth.users(id) on delete restrict,
  decision_note text check (decision_note is null or char_length(decision_note) between 1 and 1000),
  execution_deployment_id uuid references public.launch_chain_deployments(id) on delete restrict,
  status_changed_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create unique index launch_production_deployment_requests_one_open_per_launch
  on public.launch_production_deployment_requests(launch_id)
  where status in ('REQUESTED','IN_REVIEW','APPROVED','EXECUTING');
create index launch_production_deployment_requests_workspace_idx
  on public.launch_production_deployment_requests(workspace_id, requested_at desc);
create index launch_production_deployment_requests_operator_idx
  on public.launch_production_deployment_requests(assigned_operator_id, status)
  where assigned_operator_id is not null;
create unique index launch_production_deployment_requests_execution_deployment_uidx
  on public.launch_production_deployment_requests(execution_deployment_id)
  where execution_deployment_id is not null;

create trigger set_launch_production_deployment_requests_updated_at
before update on public.launch_production_deployment_requests
for each row execute function public.set_updated_at();

alter table public.launch_production_deployment_requests enable row level security;
alter table public.launch_production_deployment_requests force row level security;

create policy launch_production_deployment_requests_owner_or_platform_read
on public.launch_production_deployment_requests
for select
to authenticated
using (
  public.is_workspace_owner(workspace_id, auth.uid())
  or public.is_platform_owner(auth.uid())
);

revoke all on public.launch_production_deployment_requests from anon;
revoke insert, update, delete on public.launch_production_deployment_requests from authenticated;
grant select on public.launch_production_deployment_requests to authenticated;
grant all on public.launch_production_deployment_requests to service_role;

create or replace function public.launch_production_request_is_completed(_request_id uuid)
returns boolean
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  r public.launch_production_deployment_requests%rowtype;
  l public.launches%rowtype;
  v_contract text;
begin
  select * into r
  from public.launch_production_deployment_requests
  where id = _request_id;
  if not found or r.execution_deployment_id is null then
    return false;
  end if;

  select * into l from public.launches where id = r.launch_id;
  if not found then return false; end if;

  begin
    v_contract := public.assert_launch_contract_evidence(
      r.launch_id,
      r.workspace_id,
      l.chain,
      r.execution_deployment_id
    );
    return v_contract is not null;
  exception when others then
    return false;
  end;
end;
$$;

revoke all on function public.launch_production_request_is_completed(uuid) from public, anon, authenticated, service_role;
grant execute on function public.launch_production_request_is_completed(uuid) to postgres;

create or replace function public.submit_launch_production_deployment_request(
  _launch_id uuid,
  _token_supply_whole text,
  _token_recipient text
)
returns public.launch_production_deployment_requests
language plpgsql
security definer
set search_path = ''
as $$
declare
  l public.launches%rowtype;
  p public.project_profiles%rowtype;
  r public.launch_production_deployment_requests%rowtype;
  v_uid uuid := auth.uid();
  v_supply_text text := btrim(coalesce(_token_supply_whole, ''));
  v_supply_whole numeric;
  v_supply_base numeric;
  v_recipient text := lower(btrim(coalesce(_token_recipient, '')));
  v_ticker text;
  v_symbol text;
  v_name text;
begin
  if v_uid is null then
    raise exception 'Not authorized' using errcode = '42501';
  end if;
  if _launch_id is null then
    raise exception 'Launch is required' using errcode = '22023';
  end if;

  select * into l from public.launches where id = _launch_id for update;
  if not found then
    raise exception 'Launch not found' using errcode = 'P0002';
  end if;

  if l.launch_kind is distinct from 'PROJECT' then
    raise exception 'Production deployment requests are only available for project launches' using errcode = '22023';
  end if;
  if not public.is_workspace_owner(l.workspace_id, v_uid) then
    raise exception 'Only the workspace owner can request production deployment' using errcode = '42501';
  end if;
  if not public.launch_chain_label_is_robinhood_mainnet(l.chain) then
    raise exception 'This launch is not configured for Robinhood Chain mainnet' using errcode = '22023';
  end if;
  if l.status not in ('WATCHLIST_OPEN','LAUNCH_APPROACHING','CONTRACT_PENDING') then
    raise exception 'The launch lifecycle is not eligible for a production deployment request' using errcode = '22023';
  end if;
  if l.launch_at is null and (l.launch_window_start is null or l.launch_window_end is null) then
    raise exception 'Set the launch schedule before requesting production deployment' using errcode = '22023';
  end if;
  if l.official_contract_address is not null
     or l.official_contract_deployment_id is not null
     or l.contract_registered_at is not null then
    raise exception 'An official contract is already registered or partially recorded for this launch' using errcode = '22023';
  end if;

  select * into p from public.project_profiles where id = l.project_profile_id;
  if not found or p.workspace_id is distinct from l.workspace_id then
    raise exception 'Project profile does not match this launch' using errcode = '22023';
  end if;
  if p.discovery_status is distinct from 'published' then
    raise exception 'Publish the Project Profile before requesting production deployment' using errcode = '22023';
  end if;

  v_name := btrim(l.token_name);
  if char_length(v_name) < 1 or char_length(v_name) > 32 or v_name !~ '^[ -~]+$' then
    raise exception 'Token name must be 1-32 printable ASCII characters for mainnet deployment' using errcode = '22023';
  end if;

  v_ticker := btrim(l.ticker);
  if v_ticker ~ '^[A-Z0-9]{2,11}$' then
    v_symbol := v_ticker;
  elsif left(v_ticker, 1) = '$' and substring(v_ticker from 2) ~ '^[A-Z0-9]{2,11}$' then
    v_symbol := substring(v_ticker from 2);
  else
    raise exception 'Ticker cannot be safely converted to a 2-11 character on-chain symbol' using errcode = '22023';
  end if;

  if v_supply_text !~ '^[1-9][0-9]{0,12}$' then
    raise exception 'Supply must be a whole-token integer between 1 and 1000000000000' using errcode = '22023';
  end if;
  v_supply_whole := v_supply_text::numeric;
  if v_supply_whole < 1 or v_supply_whole > 1000000000000 then
    raise exception 'Supply must be between 1 and 1000000000000 whole tokens' using errcode = '22023';
  end if;
  v_supply_base := v_supply_whole * 1000000000000000000::numeric;

  if v_recipient !~ '^0x[0-9a-f]{40}$'
     or v_recipient = '0x0000000000000000000000000000000000000000' then
    raise exception 'Recipient must be a non-zero EVM address' using errcode = '22023';
  end if;

  if exists (
    select 1 from public.launch_chain_deployments d
    where d.launch_id = l.id
      and d.chain_id = 4663
      and d.network_environment = 'PRODUCTION'
      and d.deployment_kind = 'FIXED_SUPPLY_ERC20'
      and d.artifact_id = 'cartel-fixed-erc20-v1'
      and d.status in ('DRAFT','SUBMITTED','PENDING','CONFIRMED')
  ) then
    raise exception 'A production deployment already exists or is in progress for this launch' using errcode = '22023';
  end if;

  select * into r
  from public.launch_production_deployment_requests
  where launch_id = l.id
    and status in ('REQUESTED','IN_REVIEW','APPROVED','EXECUTING')
  order by requested_at desc
  limit 1;

  if found then
    if r.token_name is distinct from v_name
       or r.token_symbol is distinct from v_symbol
       or r.token_supply_whole is distinct from v_supply_whole
       or r.token_total_supply_base_units is distinct from v_supply_base
       or r.token_recipient is distinct from v_recipient then
      raise exception 'An open production deployment request already exists with different immutable token intent' using errcode = '22023';
    end if;
    return r;
  end if;

  insert into public.launch_production_deployment_requests (
    workspace_id, project_profile_id, launch_id,
    status, chain_id, network_environment, declared_chain,
    token_name, token_symbol, token_decimals,
    token_supply_whole, token_total_supply_base_units, token_recipient,
    requested_by
  ) values (
    l.workspace_id, l.project_profile_id, l.id,
    'REQUESTED', 4663, 'PRODUCTION', l.chain,
    v_name, v_symbol, 18,
    v_supply_whole, v_supply_base, v_recipient,
    v_uid
  ) returning * into r;

  return r;
end;
$$;

create or replace function public.withdraw_launch_production_deployment_request(_request_id uuid)
returns public.launch_production_deployment_requests
language plpgsql
security definer
set search_path = ''
as $$
declare
  r public.launch_production_deployment_requests%rowtype;
  v_uid uuid := auth.uid();
begin
  if v_uid is null then raise exception 'Not authorized' using errcode = '42501'; end if;
  select * into r from public.launch_production_deployment_requests where id = _request_id for update;
  if not found then raise exception 'Request not found' using errcode = 'P0002'; end if;
  if not public.is_workspace_owner(r.workspace_id, v_uid) then
    raise exception 'Only the workspace owner can withdraw this request' using errcode = '42501';
  end if;
  if r.status not in ('REQUESTED','IN_REVIEW','APPROVED') then
    raise exception 'This request can no longer be withdrawn' using errcode = '22023';
  end if;
  if r.execution_deployment_id is not null then
    raise exception 'A request bound to production execution cannot be withdrawn' using errcode = '22023';
  end if;
  update public.launch_production_deployment_requests
  set status = 'WITHDRAWN', status_changed_at = now(), decision_note = null
  where id = r.id returning * into r;
  return r;
end;
$$;

create or replace function public.set_launch_production_deployment_request_status(
  _request_id uuid,
  _target_status text,
  _note text default null
)
returns public.launch_production_deployment_requests
language plpgsql
security definer
set search_path = ''
as $$
declare
  r public.launch_production_deployment_requests%rowtype;
  v_uid uuid := auth.uid();
  v_target text := upper(btrim(coalesce(_target_status,'')));
  v_note text := nullif(btrim(coalesce(_note,'')), '');
  v_allowed boolean := false;
begin
  if v_uid is null or not public.is_platform_owner(v_uid) then
    raise exception 'Not authorized' using errcode = '42501';
  end if;
  if v_target not in ('IN_REVIEW','APPROVED','EXECUTING','DECLINED') then
    raise exception 'Invalid target request status' using errcode = '22023';
  end if;
  if v_note is not null and char_length(v_note) > 1000 then
    raise exception 'Decision note is too long' using errcode = '22023';
  end if;
  if v_target = 'DECLINED' and v_note is null then
    raise exception 'A decline reason is required' using errcode = '22023';
  end if;

  select * into r from public.launch_production_deployment_requests where id = _request_id for update;
  if not found then raise exception 'Request not found' using errcode = 'P0002'; end if;

  v_allowed :=
    (r.status = 'REQUESTED' and v_target in ('IN_REVIEW','APPROVED','DECLINED'))
    or (r.status = 'IN_REVIEW' and v_target in ('APPROVED','DECLINED'))
    or (r.status = 'APPROVED' and v_target in ('EXECUTING','DECLINED'));
  if not v_allowed then
    raise exception 'Invalid production deployment request transition' using errcode = '22023';
  end if;

  if v_target = 'EXECUTING' then
    if r.execution_deployment_id is not null then
      raise exception 'Request already has an execution deployment binding' using errcode = '22023';
    end if;
    update public.launch_production_deployment_requests
    set status = v_target,
        assigned_operator_id = v_uid,
        decision_note = coalesce(v_note, decision_note),
        status_changed_at = now()
    where id = r.id returning * into r;
  else
    update public.launch_production_deployment_requests
    set status = v_target,
        decision_note = v_note,
        status_changed_at = now()
    where id = r.id returning * into r;
  end if;
  return r;
end;
$$;

create or replace function public.get_launch_production_deployment_request(_launch_id uuid)
returns table (
  id uuid, workspace_id uuid, project_profile_id uuid, launch_id uuid,
  status text, effective_status text,
  chain_id bigint, network_environment text, declared_chain text,
  token_name text, token_symbol text, token_decimals smallint,
  token_supply_whole text, token_total_supply_base_units text, token_recipient text,
  requested_by uuid, requested_at timestamptz, assigned_operator_id uuid,
  decision_note text, execution_deployment_id uuid,
  status_changed_at timestamptz, updated_at timestamptz
)
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  r public.launch_production_deployment_requests%rowtype;
  v_uid uuid := auth.uid();
  v_effective text;
begin
  if v_uid is null then raise exception 'Not authorized' using errcode = '42501'; end if;
  select q.* into r
  from public.launch_production_deployment_requests q
  where q.launch_id = _launch_id
  order by (q.status in ('REQUESTED','IN_REVIEW','APPROVED','EXECUTING')) desc, q.requested_at desc
  limit 1;
  if not found then return; end if;
  if not public.is_workspace_owner(r.workspace_id, v_uid) and not public.is_platform_owner(v_uid) then
    raise exception 'Not authorized' using errcode = '42501';
  end if;
  v_effective := case when public.launch_production_request_is_completed(r.id) then 'COMPLETED' else r.status end;
  return query select
    r.id, r.workspace_id, r.project_profile_id, r.launch_id,
    r.status, v_effective,
    r.chain_id, r.network_environment, r.declared_chain,
    r.token_name, r.token_symbol, r.token_decimals,
    r.token_supply_whole::text, r.token_total_supply_base_units::text, r.token_recipient,
    r.requested_by, r.requested_at, r.assigned_operator_id,
    r.decision_note, r.execution_deployment_id,
    r.status_changed_at, r.updated_at;
end;
$$;

create or replace function public.list_launch_production_deployment_requests()
returns table (
  id uuid, workspace_id uuid, workspace_name text,
  project_profile_id uuid, project_name text,
  launch_id uuid, launch_name text, launch_ticker text, launch_status text, launch_kind text,
  status text, effective_status text,
  token_name text, token_symbol text, token_supply_whole text,
  token_total_supply_base_units text, token_recipient text,
  requested_by uuid, requested_at timestamptz, assigned_operator_id uuid,
  decision_note text, execution_deployment_id uuid, status_changed_at timestamptz
)
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_uid uuid := auth.uid();
begin
  if v_uid is null or not public.is_platform_owner(v_uid) then
    raise exception 'Not authorized' using errcode = '42501';
  end if;
  return query
  select
    r.id, r.workspace_id, w.name,
    r.project_profile_id, p.project_name,
    r.launch_id, l.token_name, l.ticker, l.status, l.launch_kind,
    r.status,
    case when public.launch_production_request_is_completed(r.id) then 'COMPLETED' else r.status end,
    r.token_name, r.token_symbol, r.token_supply_whole::text,
    r.token_total_supply_base_units::text, r.token_recipient,
    r.requested_by, r.requested_at, r.assigned_operator_id,
    r.decision_note, r.execution_deployment_id, r.status_changed_at
  from public.launch_production_deployment_requests r
  join public.workspaces w on w.id = r.workspace_id
  join public.project_profiles p on p.id = r.project_profile_id
  join public.launches l on l.id = r.launch_id
  order by
    (case r.status when 'EXECUTING' then 0 when 'APPROVED' then 1 when 'IN_REVIEW' then 2 when 'REQUESTED' then 3 else 4 end),
    r.requested_at asc;
end;
$$;

revoke all on function public.submit_launch_production_deployment_request(uuid,text,text) from public, anon;
revoke all on function public.withdraw_launch_production_deployment_request(uuid) from public, anon;
revoke all on function public.set_launch_production_deployment_request_status(uuid,text,text) from public, anon;
revoke all on function public.get_launch_production_deployment_request(uuid) from public, anon;
revoke all on function public.list_launch_production_deployment_requests() from public, anon;

grant execute on function public.submit_launch_production_deployment_request(uuid,text,text) to authenticated;
grant execute on function public.withdraw_launch_production_deployment_request(uuid) to authenticated;
grant execute on function public.set_launch_production_deployment_request_status(uuid,text,text) to authenticated;
grant execute on function public.get_launch_production_deployment_request(uuid) to authenticated;
grant execute on function public.list_launch_production_deployment_requests() to authenticated;