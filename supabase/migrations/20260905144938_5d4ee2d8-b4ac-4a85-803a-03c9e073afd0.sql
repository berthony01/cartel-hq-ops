do $$
begin
  if exists (select 1 from public.launch_contract_registration_events) then
    raise exception 'E1 hardening aborted: registration ledger is not empty.' using errcode = '22023';
  end if;
  if exists (
    select 1 from public.launches
    where official_contract_address is not null
       or official_contract_deployment_id is not null
       or contract_registered_at is not null
       or contract_registered_by is not null
  ) then
    raise exception 'E1 hardening aborted: a launch already carries official registration state.' using errcode = '22023';
  end if;
end;
$$;

alter table public.launch_contract_registration_events
  alter column actor_id set not null;

create or replace function public.register_verified_launch_contract(_launch_id uuid, _deployment_id uuid, _expected_contract_address text)
 returns launches
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
declare
  launch_row public.launches;
  derived_address text;
  expected_address text;
  d public.launch_chain_deployments;
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

  if exists (
    select 1 from public.launch_contract_registration_events e
    where e.launch_id = launch_row.id and e.action = 'ACCEPTED'
  ) then
    raise exception 'A registration decision already exists for this launch.' using errcode = '42501';
  end if;

  select * into d from public.launch_chain_deployments where id = _deployment_id;

  insert into public.launch_contract_registration_events (
    workspace_id, launch_id, action, deployment_id, contract_address, evidence_snapshot, actor_id
  ) values (
    launch_row.workspace_id,
    launch_row.id,
    'ACCEPTED',
    d.id,
    coalesce(launch_row.official_contract_address, derived_address),
    jsonb_build_object(
      'deployment_id', d.id,
      'chain_id', d.chain_id,
      'network_environment', d.network_environment,
      'deployment_kind', d.deployment_kind,
      'artifact_id', d.artifact_id,
      'tx_hash', d.tx_hash,
      'contract_address', d.contract_address,
      'status', d.status,
      'block_number', d.block_number,
      'block_hash', d.block_hash,
      'confirmations', d.confirmations,
      'verified_at', d.verified_at,
      'deployer_address', d.deployer_address,
      'token_name', d.token_name,
      'token_symbol', d.token_symbol,
      'token_decimals', d.token_decimals,
      'token_recipient', d.token_recipient,
      'token_total_supply_text', d.token_total_supply_text,
      'verified_token_name', d.verified_token_name,
      'verified_token_symbol', d.verified_token_symbol,
      'verified_token_decimals', d.verified_token_decimals,
      'verified_total_supply_text', d.verified_total_supply_text,
      'verified_recipient_balance_text', d.verified_recipient_balance_text
    ),
    auth.uid()
  );

  return launch_row;
end;
$function$;

revoke all on function public.register_verified_launch_contract(uuid, uuid, text) from public;
revoke all on function public.register_verified_launch_contract(uuid, uuid, text) from anon;
revoke all on function public.register_verified_launch_contract(uuid, uuid, text) from service_role;
grant execute on function public.register_verified_launch_contract(uuid, uuid, text) to authenticated;

create or replace function public.correct_verified_launch_contract(_launch_id uuid, _deployment_id uuid, _expected_contract_address text, _reason text)
 returns jsonb
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
declare
  l public.launches;
  d public.launch_chain_deployments;
  derived_address text;
  expected_address text;
  reason_text text;
  current_event public.launch_contract_registration_events;
  current_count integer;
  previous_address text;
  new_event public.launch_contract_registration_events;
begin
  select * into l from public.launches where id = _launch_id for update;
  if l.id is null then
    raise exception 'Launch not found.' using errcode = 'P0002';
  end if;

  if not public.is_workspace_owner(l.workspace_id, auth.uid()) then
    raise exception 'Only the project owner can correct the official contract.' using errcode = '42501';
  end if;

  if l.status not in ('OFFICIAL_CONTRACT_REGISTERED', 'LIVE', 'COMPLETED') then
    raise exception 'Only a registered official contract can be corrected.' using errcode = '22023';
  end if;

  if nullif(btrim(coalesce(l.official_contract_address, '')), '') is null
     or l.official_contract_deployment_id is null
     or l.contract_registered_at is null
     or l.contract_registered_by is null then
    raise exception 'This launch does not carry a complete evidence-bound official contract registration.' using errcode = '22023';
  end if;

  reason_text := nullif(btrim(coalesce(_reason, '')), '');
  if reason_text is null or char_length(reason_text) > 1000 then
    raise exception 'A correction reason of 1 to 1000 characters is required.' using errcode = '22023';
  end if;

  expected_address := lower(nullif(btrim(coalesce(_expected_contract_address, '')), ''));
  if expected_address is null then
    raise exception 'Type the exact contract address to confirm the correction.' using errcode = '22023';
  end if;

  derived_address := public.assert_launch_contract_evidence(
    l.id,
    l.workspace_id,
    l.chain,
    _deployment_id
  );

  if expected_address <> lower(derived_address) then
    raise exception 'The confirmation address does not match the selected deployment evidence.' using errcode = '22023';
  end if;

  select count(*) into current_count
  from public.launch_contract_registration_events e
  where e.launch_id = l.id
    and not exists (
      select 1 from public.launch_contract_registration_events c
      where c.superseded_event_id = e.id
    );

  if current_count <> 1 then
    raise exception 'Exactly one current registration decision is required for this launch.' using errcode = '22023';
  end if;

  select e.* into current_event
  from public.launch_contract_registration_events e
  where e.launch_id = l.id
    and not exists (
      select 1 from public.launch_contract_registration_events c
      where c.superseded_event_id = e.id
    )
  for update;

  if current_event.id is null then
    raise exception 'No current registration decision exists for this launch.' using errcode = '22023';
  end if;

  if current_event.deployment_id is distinct from l.official_contract_deployment_id
     or lower(current_event.contract_address) is distinct from lower(l.official_contract_address) then
    raise exception 'The registration ledger no longer matches the launch registration state.' using errcode = '22023';
  end if;

  if current_event.deployment_id = _deployment_id
     and lower(current_event.contract_address) = lower(derived_address) then
    return jsonb_build_object(
      'status', 'unchanged',
      'launch_id', l.id,
      'registration_event_id', current_event.id,
      'contract_address', l.official_contract_address,
      'deployment_id', current_event.deployment_id
    );
  end if;

  previous_address := l.official_contract_address;

  select * into d from public.launch_chain_deployments where id = _deployment_id;

  update public.launches
  set official_contract_deployment_id = _deployment_id
  where id = l.id
  returning * into l;

  insert into public.launch_contract_registration_events (
    workspace_id, launch_id, action, deployment_id, contract_address,
    evidence_snapshot, actor_id, correction_reason, superseded_event_id
  ) values (
    l.workspace_id,
    l.id,
    'CORRECTED',
    d.id,
    l.official_contract_address,
    jsonb_build_object(
      'deployment_id', d.id,
      'chain_id', d.chain_id,
      'network_environment', d.network_environment,
      'deployment_kind', d.deployment_kind,
      'artifact_id', d.artifact_id,
      'tx_hash', d.tx_hash,
      'contract_address', d.contract_address,
      'status', d.status,
      'block_number', d.block_number,
      'block_hash', d.block_hash,
      'confirmations', d.confirmations,
      'verified_at', d.verified_at,
      'deployer_address', d.deployer_address,
      'token_name', d.token_name,
      'token_symbol', d.token_symbol,
      'token_decimals', d.token_decimals,
      'token_recipient', d.token_recipient,
      'token_total_supply_text', d.token_total_supply_text,
      'verified_token_name', d.verified_token_name,
      'verified_token_symbol', d.verified_token_symbol,
      'verified_token_decimals', d.verified_token_decimals,
      'verified_total_supply_text', d.verified_total_supply_text,
      'verified_recipient_balance_text', d.verified_recipient_balance_text
    ),
    auth.uid(),
    reason_text,
    current_event.id
  )
  returning * into new_event;

  return jsonb_build_object(
    'status', 'corrected',
    'launch_id', l.id,
    'registration_event_id', new_event.id,
    'superseded_event_id', current_event.id,
    'previous_contract_address', previous_address,
    'contract_address', l.official_contract_address,
    'deployment_id', new_event.deployment_id,
    'created_at', new_event.created_at
  );
end;
$function$;

revoke all on function public.correct_verified_launch_contract(uuid, uuid, text, text) from public;
revoke all on function public.correct_verified_launch_contract(uuid, uuid, text, text) from anon;
revoke all on function public.correct_verified_launch_contract(uuid, uuid, text, text) from service_role;
grant execute on function public.correct_verified_launch_contract(uuid, uuid, text, text) to authenticated;

create or replace function public.launch_contract_correction_payload(_launch_id uuid, _registration_event_id uuid)
 returns jsonb
 language plpgsql
 stable
 security definer
 set search_path to 'public'
as $function$
declare
  e public.launch_contract_registration_events;
  prev public.launch_contract_registration_events;
  l public.launches;
begin
  select * into e from public.launch_contract_registration_events where id = _registration_event_id;
  if e.id is null or e.launch_id is distinct from _launch_id then
    raise exception 'Registration decision not found for this launch.' using errcode = 'P0002';
  end if;

  if e.action is distinct from 'CORRECTED' or e.superseded_event_id is null then
    raise exception 'Registration decision is not a valid correction.' using errcode = '22023';
  end if;

  select * into prev from public.launch_contract_registration_events where id = e.superseded_event_id;
  if prev.id is null or prev.launch_id is distinct from e.launch_id then
    raise exception 'The superseded registration decision is missing for this launch.' using errcode = '22023';
  end if;

  select * into l from public.launches where id = _launch_id;
  if l.id is null then
    raise exception 'Launch not found.' using errcode = 'P0002';
  end if;

  return public.launch_notification_payload(_launch_id) || jsonb_build_object(
    'registration_event_id', e.id,
    'previous_contract_address', prev.contract_address,
    'official_contract_address', l.official_contract_address,
    'contract_address', e.contract_address,
    'deployment_id', e.deployment_id,
    'correction_reason', e.correction_reason
  );
end;
$function$;

revoke all on function public.launch_contract_correction_payload(uuid, uuid) from public;
revoke all on function public.launch_contract_correction_payload(uuid, uuid) from anon;
revoke all on function public.launch_contract_correction_payload(uuid, uuid) from authenticated;
revoke all on function public.launch_contract_correction_payload(uuid, uuid) from service_role;

create or replace function public.notify_launch_watchers_official_contract_correction(_launch_id uuid, _registration_event_id uuid)
 returns jsonb
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
declare
  l public.launches;
  e public.launch_contract_registration_events;
  derived_address text;
  profile_published boolean;
  v_event_id uuid;
  inserted boolean := false;
  v_delivery_count integer := 0;
begin
  select * into l from public.launches where id = _launch_id for update;
  if l.id is null then
    raise exception 'Launch not found.' using errcode = 'P0002';
  end if;

  if not public.is_workspace_owner(l.workspace_id, auth.uid()) then
    raise exception 'Only the project owner can notify Launch Watch subscribers.' using errcode = '42501';
  end if;

  if l.status not in ('OFFICIAL_CONTRACT_REGISTERED', 'LIVE', 'COMPLETED') then
    raise exception 'Subscribers can only be notified about a correction after the official contract is registered.' using errcode = '22023';
  end if;

  if nullif(btrim(coalesce(l.official_contract_address, '')), '') is null
     or l.official_contract_deployment_id is null
     or l.contract_registered_at is null
     or l.contract_registered_by is null then
    raise exception 'This launch does not carry a complete evidence-bound official contract registration.' using errcode = '22023';
  end if;

  select * into e from public.launch_contract_registration_events
  where id = _registration_event_id;

  if e.id is null
     or e.launch_id is distinct from l.id
     or e.workspace_id is distinct from l.workspace_id
     or e.action is distinct from 'CORRECTED' then
    raise exception 'Correction record not found for this launch.' using errcode = 'P0002';
  end if;

  if exists (
    select 1 from public.launch_contract_registration_events c
    where c.superseded_event_id = e.id
  ) then
    raise exception 'This correction has been superseded by a later correction.' using errcode = '22023';
  end if;

  if e.deployment_id is distinct from l.official_contract_deployment_id
     or lower(e.contract_address) is distinct from lower(l.official_contract_address) then
    raise exception 'This correction no longer matches the current registration state.' using errcode = '22023';
  end if;

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

  insert into public.launch_events (
    launch_id, event_type, source, scheduled_for, payload
  ) values (
    l.id,
    'OFFICIAL_CONTRACT_CORRECTED',
    'operator',
    e.created_at,
    public.launch_contract_correction_payload(l.id, e.id)
  )
  on conflict do nothing
  returning id into v_event_id;

  if v_event_id is not null then
    inserted := true;
  else
    select ev.id into v_event_id
    from public.launch_events ev
    where ev.launch_id = l.id
      and ev.event_type = 'OFFICIAL_CONTRACT_CORRECTED'
      and ev.payload ->> 'registration_event_id' = e.id::text;

    if v_event_id is null then
      raise exception 'The correction notification could not be confirmed. No matching queued event was found.' using errcode = '22023';
    end if;
  end if;

  select count(*) into v_delivery_count
  from public.launch_notification_deliveries dd
  where dd.event_id = v_event_id;

  return jsonb_build_object(
    'status', case when inserted then 'queued' else 'already_notified' end,
    'event_id', v_event_id,
    'registration_event_id', e.id,
    'delivery_count', v_delivery_count
  );
end;
$function$;

revoke all on function public.notify_launch_watchers_official_contract_correction(uuid, uuid) from public;
revoke all on function public.notify_launch_watchers_official_contract_correction(uuid, uuid) from anon;
revoke all on function public.notify_launch_watchers_official_contract_correction(uuid, uuid) from service_role;
grant execute on function public.notify_launch_watchers_official_contract_correction(uuid, uuid) to authenticated;