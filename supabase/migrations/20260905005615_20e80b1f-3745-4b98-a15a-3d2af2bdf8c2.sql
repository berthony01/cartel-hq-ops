-- =========================================================================
-- C8.7B — Evidence-bound official contract registration
-- Registration metadata only. No executable production chain configuration,
-- no wallet/deployment/verifier behaviour, no communication side effects.
-- =========================================================================

-- ---- A. conservative network pair constraint ----------------------------
alter table public.launch_chain_deployments
  drop constraint launch_chain_deployments_chain_id_check;
alter table public.launch_chain_deployments
  drop constraint launch_chain_deployments_network_environment_check;

alter table public.launch_chain_deployments
  add constraint launch_chain_deployments_network_pair_chk
  check (
    (chain_id = 46630 and network_environment = 'TESTNET')
    or (chain_id = 4663 and network_environment = 'PRODUCTION')
  );

-- ---- B. evidence binding column ----------------------------------------
alter table public.launches
  add column if not exists official_contract_deployment_id uuid null
  references public.launch_chain_deployments(id) on delete restrict;

comment on column public.launches.official_contract_deployment_id is
  'System-managed, immutable once set. Bound by register_verified_launch_contract to the verified deployment evidence row the official contract address was derived from.';

create index if not exists launches_official_contract_deployment_id_idx
  on public.launches (official_contract_deployment_id);

create or replace function public.launches_before_insert()
returns trigger
language plpgsql
set search_path to 'public'
as $function$
begin
  if not exists (
    select 1
    from public.project_profiles pp
    where pp.id = new.project_profile_id
      and pp.workspace_id = new.workspace_id
  ) then
    raise exception 'Project profile must belong to the launch workspace.' using errcode = '23514';
  end if;

  new.status := 'DRAFT';
  new.status_changed_at := now();
  new.status_changed_by := auth.uid();
  new.announced_at := null;
  new.watchlist_opened_at := null;
  new.launch_approaching_at := null;
  new.contract_pending_at := null;
  new.contract_registered_at := null;
  new.contract_registered_by := null;
  new.live_at := null;
  new.completed_at := null;
  new.official_contract_address := null;
  new.official_contract_deployment_id := null;
  new.launch_watch_token := null;
  new.launch_watch_token_created_at := null;

  if auth.uid() is not null then
    new.created_by := auth.uid();
  end if;

  return new;
end;
$function$;

-- ---- C. authoritative evidence predicate --------------------------------
create or replace function public.launch_chain_label_is_robinhood_mainnet(_chain text)
returns boolean
language sql
immutable
set search_path to 'public'
as $function$
  select lower(regexp_replace(btrim(coalesce(_chain, '')), '\s+', ' ', 'g'))
         in ('robinhood chain', 'robinhood chain mainnet', '4663');
$function$;

create or replace function public.assert_launch_contract_evidence(
  _launch_id uuid,
  _workspace_id uuid,
  _declared_chain text,
  _deployment_id uuid
)
returns text
language plpgsql
stable
security definer
set search_path to 'public'
as $function$
declare
  d public.launch_chain_deployments;
begin
  if _deployment_id is null then
    raise exception 'Official contract registration must be bound to verified deployment evidence.' using errcode = '22023';
  end if;

  select * into d from public.launch_chain_deployments where id = _deployment_id;
  if d.id is null then
    raise exception 'Deployment evidence record not found.' using errcode = 'P0002';
  end if;

  if d.launch_id is distinct from _launch_id or d.workspace_id is distinct from _workspace_id then
    raise exception 'Deployment evidence does not belong to this launch and workspace.' using errcode = '42501';
  end if;

  if d.deployment_kind is distinct from 'FIXED_SUPPLY_ERC20' then
    raise exception 'Only a fixed-supply token deployment can become an official contract.' using errcode = '22023';
  end if;

  if d.artifact_id is distinct from 'cartel-fixed-erc20-v1' then
    raise exception 'Deployment evidence does not carry the approved frozen artifact.' using errcode = '22023';
  end if;

  if d.network_environment is distinct from 'PRODUCTION' or d.chain_id is distinct from 4663 then
    raise exception 'Only a production Robinhood Chain (4663) deployment can become an official contract.' using errcode = '22023';
  end if;

  if not public.launch_chain_label_is_robinhood_mainnet(_declared_chain) then
    raise exception 'The declared launch chain does not clearly match Robinhood Chain mainnet.' using errcode = '22023';
  end if;

  if d.status is distinct from 'CONFIRMED' then
    raise exception 'Deployment evidence is not CONFIRMED.' using errcode = '22023';
  end if;

  if d.tx_hash is null or d.tx_hash !~ '^0x[0-9a-f]{64}$' then
    raise exception 'Deployment evidence has no well-formed transaction hash.' using errcode = '22023';
  end if;

  if d.contract_address is null or d.contract_address !~ '^0x[0-9a-f]{40}$' then
    raise exception 'Deployment evidence has no well-formed contract address.' using errcode = '22023';
  end if;

  if coalesce(d.confirmations, 0) < 5 then
    raise exception 'Deployment evidence has fewer than 5 confirmations.' using errcode = '22023';
  end if;

  if d.block_number is null or d.verified_at is null then
    raise exception 'Deployment evidence is missing a mined block or verification timestamp.' using errcode = '22023';
  end if;

  if d.failure_code is not null or d.failure_detail is not null then
    raise exception 'Deployment evidence records a failure state.' using errcode = '22023';
  end if;

  if d.verified_token_name is distinct from d.token_name
     or d.verified_token_symbol is distinct from d.token_symbol
     or d.verified_token_decimals is distinct from d.token_decimals
     or d.verified_token_decimals is distinct from 18::smallint then
    raise exception 'Verified token identity does not match the recorded deployment intent.' using errcode = '22023';
  end if;

  if d.token_total_supply is null
     or d.verified_total_supply is distinct from d.token_total_supply
     or d.verified_recipient_balance is distinct from d.token_total_supply then
    raise exception 'Verified token supply or recipient balance does not match the recorded deployment intent.' using errcode = '22023';
  end if;

  return d.contract_address;
end;
$function$;

revoke all on function public.assert_launch_contract_evidence(uuid, uuid, text, uuid) from public, anon;
grant execute on function public.assert_launch_contract_evidence(uuid, uuid, text, uuid) to authenticated;
revoke all on function public.launch_chain_label_is_robinhood_mainnet(text) from public, anon;
grant execute on function public.launch_chain_label_is_robinhood_mainnet(text) to authenticated;

create or replace function public.enforce_launch_contract_update()
returns trigger
language plpgsql
set search_path to 'public'
as $function$
declare
  derived_address text;
begin
  if new.official_contract_address is not distinct from old.official_contract_address
     and new.official_contract_deployment_id is not distinct from old.official_contract_deployment_id
     and new.contract_registered_at is not distinct from old.contract_registered_at
     and new.contract_registered_by is not distinct from old.contract_registered_by then
    return new;
  end if;

  if old.official_contract_address is not null
     or old.official_contract_deployment_id is not null
     or old.contract_registered_at is not null
     or old.contract_registered_by is not null then
    raise exception 'A registered official contract cannot be replaced or cleared.' using errcode = '42501';
  end if;

  if old.status <> 'CONTRACT_PENDING' then
    raise exception 'An official contract can only be registered while contract registration is pending.' using errcode = '42501';
  end if;

  if not public.is_workspace_owner(old.workspace_id, auth.uid()) then
    raise exception 'Only the project owner can register the official contract.' using errcode = '42501';
  end if;

  derived_address := public.assert_launch_contract_evidence(
    old.id,
    old.workspace_id,
    old.chain,
    new.official_contract_deployment_id
  );

  new.official_contract_address := derived_address;
  new.contract_registered_at := now();
  new.contract_registered_by := auth.uid();

  return new;
end;
$function$;

-- ---- D. owner-only, evidence-bound registration RPC ---------------------
create or replace function public.register_verified_launch_contract(
  _launch_id uuid,
  _deployment_id uuid,
  _expected_contract_address text
)
returns public.launches
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  launch_row public.launches;
  derived_address text;
  expected_address text;
begin
  select * into launch_row from public.launches where id = _launch_id for update;
  if launch_row.id is null then
    raise exception 'Launch not found.' using errcode = 'P0002';
  end if;

  if not public.is_workspace_owner(launch_row.workspace_id, auth.uid()) then
    raise exception 'Only the project owner can register the official contract.' using errcode = '42501';
  end if;

  expected_address := lower(nullif(btrim(coalesce(_expected_contract_address, '')), ''));
  if expected_address is null then
    raise exception 'Type the exact contract address to confirm registration.' using errcode = '22023';
  end if;

  derived_address := public.assert_launch_contract_evidence(
    launch_row.id,
    launch_row.workspace_id,
    launch_row.chain,
    _deployment_id
  );

  if expected_address <> lower(derived_address) then
    raise exception 'The confirmation address does not match the selected deployment evidence.' using errcode = '22023';
  end if;

  if launch_row.official_contract_address is not null
     or launch_row.official_contract_deployment_id is not null
     or launch_row.contract_registered_at is not null then
    if launch_row.official_contract_deployment_id = _deployment_id
       and lower(launch_row.official_contract_address) = lower(derived_address) then
      return launch_row;
    end if;
    raise exception 'A registered official contract cannot be replaced.' using errcode = '42501';
  end if;

  if launch_row.status <> 'CONTRACT_PENDING' then
    raise exception 'An official contract can only be registered while the launch is Contract Pending.' using errcode = '22023';
  end if;

  update public.launches
  set official_contract_deployment_id = _deployment_id
  where id = _launch_id
  returning * into launch_row;

  return launch_row;
end;
$function$;

revoke all on function public.register_verified_launch_contract(uuid, uuid, text) from public, anon;
grant execute on function public.register_verified_launch_contract(uuid, uuid, text) to authenticated;

-- ---- E. retire the legacy free-text write path --------------------------
create or replace function public.set_launch_contract_address(
  _launch_id uuid,
  _contract_address text
)
returns public.launches
language plpgsql
security definer
set search_path to 'public'
as $function$
begin
  raise exception 'Free-text contract registration has been retired. Register the official contract from verified deployment evidence.' using errcode = '42501';
end;
$function$;

revoke all on function public.set_launch_contract_address(uuid, text) from public, anon;

-- ---- F. lifecycle precondition ------------------------------------------
create or replace function public.enforce_launch_status_transition()
returns trigger
language plpgsql
set search_path to 'public'
as $function$
declare
  expected_status text;
begin
  if new.status is not distinct from old.status then
    return new;
  end if;

  expected_status := case old.status
    when 'DRAFT' then 'ANNOUNCED'
    when 'ANNOUNCED' then 'WATCHLIST_OPEN'
    when 'WATCHLIST_OPEN' then 'LAUNCH_APPROACHING'
    when 'LAUNCH_APPROACHING' then 'CONTRACT_PENDING'
    when 'CONTRACT_PENDING' then 'OFFICIAL_CONTRACT_REGISTERED'
    when 'OFFICIAL_CONTRACT_REGISTERED' then 'LIVE'
    when 'LIVE' then 'COMPLETED'
    else null
  end;

  if expected_status is null or new.status <> expected_status then
    raise exception 'Invalid launch status transition from % to %.', old.status, new.status using errcode = '22023';
  end if;

  if new.status = 'LAUNCH_APPROACHING'
     and new.launch_at is null
     and new.launch_window_start is null then
    raise exception 'A launch time or launch window is required before Launch Approaching.' using errcode = '22023';
  end if;

  if new.status = 'OFFICIAL_CONTRACT_REGISTERED'
     and (
       nullif(btrim(coalesce(new.official_contract_address, '')), '') is null
       or new.official_contract_deployment_id is null
       or new.contract_registered_at is null
     ) then
    raise exception 'An evidence-bound official contract registration is required before registration.' using errcode = '22023';
  end if;

  new.status_changed_at := now();
  new.status_changed_by := auth.uid();

  case new.status
    when 'ANNOUNCED' then new.announced_at := coalesce(old.announced_at, now());
    when 'WATCHLIST_OPEN' then
      new.watchlist_opened_at := coalesce(old.watchlist_opened_at, now());
      if old.launch_watch_token is null then
        new.launch_watch_token := encode(extensions.gen_random_bytes(12), 'hex');
        new.launch_watch_token_created_at := now();
      else
        new.launch_watch_token := old.launch_watch_token;
        new.launch_watch_token_created_at := old.launch_watch_token_created_at;
      end if;
    when 'LAUNCH_APPROACHING' then new.launch_approaching_at := coalesce(old.launch_approaching_at, now());
    when 'CONTRACT_PENDING' then new.contract_pending_at := coalesce(old.contract_pending_at, now());
    when 'OFFICIAL_CONTRACT_REGISTERED' then
      new.contract_registered_at := coalesce(old.contract_registered_at, now());
      new.contract_registered_by := coalesce(old.contract_registered_by, auth.uid());
    when 'LIVE' then new.live_at := coalesce(old.live_at, now());
    when 'COMPLETED' then new.completed_at := coalesce(old.completed_at, now());
    else null;
  end case;

  return new;
end;
$function$;
