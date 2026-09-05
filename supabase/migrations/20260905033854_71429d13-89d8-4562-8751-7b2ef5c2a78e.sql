create or replace function public.notify_launch_watchers_official_contract(_launch_id uuid)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  l public.launches;
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

  -- Strongest existing C8.7 boundary: owner-only, workspace-isolated.
  if not public.is_workspace_owner(l.workspace_id, auth.uid()) then
    raise exception 'Only the project owner can notify Launch Watch subscribers.' using errcode = '42501';
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

revoke all on function public.notify_launch_watchers_official_contract(uuid) from public, anon;
grant execute on function public.notify_launch_watchers_official_contract(uuid) to authenticated;