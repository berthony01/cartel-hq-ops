create schema if not exists private;
revoke all on schema private from public;
grant usage on schema private to authenticated, service_role;

create or replace function private.can_operate_launch_production_request(
  _workspace_id uuid,
  _launch_id uuid,
  _user_id uuid
)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select _user_id is not null
    and ((select auth.uid()) is null or (select auth.uid()) = _user_id)
    and public.is_platform_owner(_user_id)
    and exists (
      select 1
      from public.launch_production_deployment_requests r
      join public.launches l on l.id = r.launch_id
      where r.workspace_id = _workspace_id
        and r.launch_id = _launch_id
        and r.status = 'EXECUTING'
        and r.assigned_operator_id = _user_id
        and l.workspace_id = _workspace_id
        and l.launch_kind = 'PROJECT'
    );
$$;
revoke all on function private.can_operate_launch_production_request(uuid,uuid,uuid) from public, anon, authenticated, service_role;
grant execute on function private.can_operate_launch_production_request(uuid,uuid,uuid) to authenticated, service_role;

create or replace function public.authorize_launch_chain_deployment(_launch_id uuid)
returns uuid
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_workspace uuid;
  v_uid uuid := auth.uid();
begin
  if v_uid is null or not public.is_platform_owner(v_uid) then
    raise exception 'Not authorized' using errcode = '42501';
  end if;

  select l.workspace_id into v_workspace
  from public.launches l
  where l.id = _launch_id;

  if v_workspace is null
     or not (
       public.is_workspace_operator(v_workspace, v_uid)
       or private.can_operate_launch_production_request(v_workspace, _launch_id, v_uid)
     ) then
    raise exception 'Not authorized' using errcode = '42501';
  end if;

  return v_workspace;
end;
$$;

drop policy if exists "Platform owner operators read launch chain deployments" on public.launch_chain_deployments;
create policy "Platform owner operators read launch chain deployments"
on public.launch_chain_deployments
for select
to authenticated
using (
  public.can_read_launch_chain_deployment(workspace_id)
  or private.can_operate_launch_production_request(workspace_id, launch_id, (select auth.uid()))
);

do $$
declare
  rec record;
  v_oid oid;
  v_def text;
  v_count integer;
begin
  for rec in
    select * from (values
      ('public.arm_launch_chain_production_canary_execution(uuid,uuid,uuid,bigint,text)',
       'public\.is_workspace_operator\(d\.workspace_id,\s*_operator_user_id\)',
       'private.can_operate_launch_production_request(d.workspace_id, d.launch_id, _operator_user_id)'),
      ('public.authorize_launch_chain_production_send_window_issuance(uuid,uuid,uuid)',
       'public\.is_workspace_operator\(d\.workspace_id,\s*_operator_user_id\)',
       'private.can_operate_launch_production_request(d.workspace_id, d.launch_id, _operator_user_id)'),
      ('public.cancel_claimed_launch_chain_production_presign_authorization(uuid,uuid,text)',
       'public\.is_workspace_operator\(d\.workspace_id,\s*_operator_user_id\)',
       'private.can_operate_launch_production_request(d.workspace_id, d.launch_id, _operator_user_id)'),
      ('public.get_launch_chain_production_reconciliation_snapshot(uuid,uuid)',
       'public\.is_workspace_operator\(d\.workspace_id,\s*_operator_user_id\)',
       'private.can_operate_launch_production_request(d.workspace_id, d.launch_id, _operator_user_id)'),
      ('public.submit_launch_chain_production_deployment_tx(uuid,uuid,uuid,text)',
       'public\.is_workspace_operator\(d\.workspace_id,\s*_operator_user_id\)',
       'private.can_operate_launch_production_request(d.workspace_id, d.launch_id, _operator_user_id)'),
      ('public.enforce_launch_chain_production_presign()',
       'public\.is_workspace_operator\(d\.workspace_id,\s*NEW\.operator_user_id\)',
       'private.can_operate_launch_production_request(d.workspace_id, d.launch_id, NEW.operator_user_id)')
    ) as t(signature, pattern, replacement)
  loop
    v_oid := to_regprocedure(rec.signature);
    if v_oid is null then
      raise exception 'Required function missing: %', rec.signature;
    end if;
    select pg_get_functiondef(v_oid) into v_def;
    select count(*) into v_count from regexp_matches(v_def, rec.pattern, 'gi');
    if v_count <> 1 then
      raise exception 'Expected exactly one authorization predicate in %, found %', rec.signature, v_count;
    end if;
    execute regexp_replace(v_def, rec.pattern, rec.replacement, 'gi');
  end loop;
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
  if v_target not in ('IN_REVIEW','APPROVED','DECLINED') then
    raise exception 'Invalid target request status' using errcode = '22023';
  end if;
  if v_note is not null and char_length(v_note) > 1000 then
    raise exception 'Decision note is too long' using errcode = '22023';
  end if;
  if v_target = 'DECLINED' and v_note is null then
    raise exception 'A decline reason is required' using errcode = '22023';
  end if;

  select * into r
  from public.launch_production_deployment_requests
  where id = _request_id
  for update;
  if not found then
    raise exception 'Request not found' using errcode = 'P0002';
  end if;

  v_allowed :=
    (r.status = 'REQUESTED' and v_target in ('IN_REVIEW','APPROVED','DECLINED'))
    or (r.status = 'IN_REVIEW' and v_target in ('APPROVED','DECLINED'))
    or (r.status = 'APPROVED' and v_target = 'DECLINED');
  if not v_allowed then
    raise exception 'Invalid production deployment request transition' using errcode = '22023';
  end if;

  update public.launch_production_deployment_requests
  set status = v_target,
      decision_note = v_note,
      status_changed_at = now()
  where id = r.id
  returning * into r;

  return r;
end;
$$;

create or replace function public.begin_launch_production_request_execution(
  _request_id uuid,
  _deployer_address text,
  _review_fingerprint text,
  _init_code_hash text
)
returns public.launch_production_deployment_requests
language plpgsql
security definer
set search_path = ''
as $$
declare
  r public.launch_production_deployment_requests%rowtype;
  l public.launches%rowtype;
  p public.project_profiles%rowtype;
  d public.launch_chain_deployments%rowtype;
  v_uid uuid := auth.uid();
  v_deployer text := lower(btrim(coalesce(_deployer_address,'')));
  v_fingerprint text := lower(btrim(coalesce(_review_fingerprint,'')));
  v_init_hash text := lower(btrim(coalesce(_init_code_hash,'')));
  v_client_request_id text;
begin
  if v_uid is null or not public.is_platform_owner(v_uid) then
    raise exception 'Not authorized' using errcode = '42501';
  end if;
  if _request_id is null then
    raise exception 'Request is required' using errcode = '22023';
  end if;
  if v_deployer !~ '^0x[0-9a-f]{40}$'
     or v_deployer = '0x0000000000000000000000000000000000000000' then
    raise exception 'Invalid deployer address' using errcode = '22023';
  end if;
  if v_fingerprint !~ '^0x[0-9a-f]{64}$' then
    raise exception 'Invalid review fingerprint' using errcode = '22023';
  end if;
  if v_init_hash !~ '^0x[0-9a-f]{64}$' then
    raise exception 'Invalid init code hash' using errcode = '22023';
  end if;

  select * into r
  from public.launch_production_deployment_requests
  where id = _request_id
  for update;
  if not found then
    raise exception 'Request not found' using errcode = 'P0002';
  end if;

  if r.status = 'EXECUTING' and r.execution_deployment_id is not null then
    if r.assigned_operator_id is distinct from v_uid then
      raise exception 'Not authorized' using errcode = '42501';
    end if;
    select * into d
    from public.launch_chain_deployments
    where id = r.execution_deployment_id;
    if not found
       or d.workspace_id is distinct from r.workspace_id
       or d.launch_id is distinct from r.launch_id
       or d.chain_id <> 4663
       or d.network_environment <> 'PRODUCTION'
       or d.deployment_kind <> 'FIXED_SUPPLY_ERC20'
       or d.artifact_id is distinct from 'cartel-fixed-erc20-v1'
       or d.deployer_address is distinct from v_deployer
       or d.token_name is distinct from r.token_name
       or d.token_symbol is distinct from r.token_symbol
       or d.token_decimals is distinct from r.token_decimals
       or d.token_total_supply is distinct from r.token_total_supply_base_units
       or d.token_recipient is distinct from r.token_recipient
       or d.review_fingerprint is distinct from v_fingerprint
       or d.init_code_hash is distinct from v_init_hash then
      raise exception 'Existing execution binding does not match immutable request intent' using errcode = '22023';
    end if;
    return r;
  end if;

  if r.status is distinct from 'APPROVED'
     or r.execution_deployment_id is not null
     or r.assigned_operator_id is not null then
    raise exception 'Request is not ready to begin execution' using errcode = '22023';
  end if;

  select * into l from public.launches where id = r.launch_id for update;
  if not found
     or l.workspace_id is distinct from r.workspace_id
     or l.project_profile_id is distinct from r.project_profile_id
     or l.launch_kind is distinct from 'PROJECT' then
    raise exception 'Request launch binding is invalid' using errcode = '22023';
  end if;
  if not public.launch_chain_label_is_robinhood_mainnet(l.chain) then
    raise exception 'Launch is not configured for Robinhood Chain mainnet' using errcode = '22023';
  end if;
  if l.status not in ('WATCHLIST_OPEN','LAUNCH_APPROACHING','CONTRACT_PENDING') then
    raise exception 'Launch lifecycle is no longer eligible for production deployment' using errcode = '22023';
  end if;
  if l.launch_at is null and (l.launch_window_start is null or l.launch_window_end is null) then
    raise exception 'Launch schedule is no longer complete' using errcode = '22023';
  end if;
  if l.official_contract_address is not null
     or l.official_contract_deployment_id is not null
     or l.contract_registered_at is not null then
    raise exception 'Official contract state already exists for this launch' using errcode = '22023';
  end if;

  select * into p from public.project_profiles where id = r.project_profile_id;
  if not found
     or p.workspace_id is distinct from r.workspace_id
     or p.discovery_status is distinct from 'published' then
    raise exception 'Project Profile is no longer eligible for production deployment' using errcode = '22023';
  end if;

  if r.chain_id <> 4663
     or r.network_environment <> 'PRODUCTION'
     or r.token_decimals <> 18
     or r.declared_chain is distinct from l.chain
     or r.token_name is distinct from btrim(l.token_name) then
    raise exception 'Stored production request no longer matches launch identity' using errcode = '22023';
  end if;

  if exists (
    select 1
    from public.launch_chain_deployments existing
    where existing.launch_id = r.launch_id
      and existing.chain_id = 4663
      and existing.network_environment = 'PRODUCTION'
      and existing.deployment_kind = 'FIXED_SUPPLY_ERC20'
      and existing.artifact_id = 'cartel-fixed-erc20-v1'
      and existing.status in ('DRAFT','SUBMITTED','PENDING','CONFIRMED')
  ) then
    raise exception 'A production deployment already exists or is in progress for this launch' using errcode = '22023';
  end if;

  update public.launch_production_deployment_requests
  set status = 'EXECUTING',
      assigned_operator_id = v_uid,
      status_changed_at = now()
  where id = r.id
  returning * into r;

  v_client_request_id := 'launcher-b3:' || r.id::text;

  d := public.create_launch_chain_production_token_deployment_attempt(
    r.launch_id,
    v_client_request_id,
    v_deployer,
    r.token_name,
    r.token_symbol,
    r.token_total_supply_base_units,
    r.token_recipient,
    v_fingerprint,
    v_init_hash
  );

  if d.id is null
     or d.workspace_id is distinct from r.workspace_id
     or d.launch_id is distinct from r.launch_id
     or d.chain_id <> 4663
     or d.network_environment <> 'PRODUCTION'
     or d.deployment_kind <> 'FIXED_SUPPLY_ERC20'
     or d.artifact_id is distinct from 'cartel-fixed-erc20-v1'
     or d.deployer_address is distinct from v_deployer
     or d.token_name is distinct from r.token_name
     or d.token_symbol is distinct from r.token_symbol
     or d.token_decimals is distinct from r.token_decimals
     or d.token_total_supply is distinct from r.token_total_supply_base_units
     or d.token_recipient is distinct from r.token_recipient
     or d.review_fingerprint is distinct from v_fingerprint
     or d.init_code_hash is distinct from v_init_hash then
    raise exception 'Created deployment does not match immutable request intent' using errcode = '22023';
  end if;

  update public.launch_production_deployment_requests
  set execution_deployment_id = d.id,
      status_changed_at = now()
  where id = r.id
    and status = 'EXECUTING'
    and assigned_operator_id = v_uid
    and execution_deployment_id is null
  returning * into r;

  if not found then
    raise exception 'Execution binding failed' using errcode = '42501';
  end if;

  return r;
end;
$$;

revoke all on function public.begin_launch_production_request_execution(uuid,text,text,text) from public, anon, service_role;
grant execute on function public.begin_launch_production_request_execution(uuid,text,text,text) to authenticated;