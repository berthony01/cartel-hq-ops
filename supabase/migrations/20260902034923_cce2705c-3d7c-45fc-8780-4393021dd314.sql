CREATE OR REPLACE FUNCTION public.enqueue_due_launch_reminder_events(_now timestamp with time zone DEFAULT now())
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  _inserted integer := 0;
  _count integer := 0;
begin
  with candidates as (
    select
      l.id,
      coalesce(l.launch_at, l.launch_window_start) as target_at
    from public.launches l
    join public.project_profiles pp on pp.id = l.project_profile_id
    where pp.discovery_status = 'published'
      and l.status in ('LAUNCH_APPROACHING','CONTRACT_PENDING','OFFICIAL_CONTRACT_REGISTERED')
      and coalesce(l.launch_at, l.launch_window_start) > _now
      and exists (
        select 1
        from public.launch_watch_subscriptions s
        where s.launch_id = l.id
          and s.is_active = true
          and s.reminders_enabled = true
      )
  )
  insert into public.launch_events (launch_id, event_type, source, scheduled_for, payload)
  select
    c.id,
    'REMINDER_24H',
    'reminder_runner',
    c.target_at - interval '24 hours',
    case
      when c.target_at - interval '24 hours' <= _now - interval '15 minutes'
        then public.launch_notification_payload(c.id) || jsonb_build_object('catch_up', true)
      else public.launch_notification_payload(c.id)
    end
  from candidates c
  where c.target_at - interval '24 hours' <= _now
    and c.target_at > _now + interval '1 hour'
  on conflict (launch_id, event_type, scheduled_for) do nothing;

  get diagnostics _count = row_count;
  _inserted := _inserted + _count;

  with candidates as (
    select
      l.id,
      coalesce(l.launch_at, l.launch_window_start) as target_at
    from public.launches l
    join public.project_profiles pp on pp.id = l.project_profile_id
    where pp.discovery_status = 'published'
      and l.status in ('LAUNCH_APPROACHING','CONTRACT_PENDING','OFFICIAL_CONTRACT_REGISTERED')
      and coalesce(l.launch_at, l.launch_window_start) > _now
      and exists (
        select 1
        from public.launch_watch_subscriptions s
        where s.launch_id = l.id
          and s.is_active = true
          and s.reminders_enabled = true
      )
  )
  insert into public.launch_events (launch_id, event_type, source, scheduled_for, payload)
  select
    c.id,
    'REMINDER_1H',
    'reminder_runner',
    c.target_at - interval '1 hour',
    case
      when c.target_at - interval '1 hour' <= _now - interval '15 minutes'
        then public.launch_notification_payload(c.id) || jsonb_build_object('catch_up', true)
      else public.launch_notification_payload(c.id)
    end
  from candidates c
  where c.target_at - interval '1 hour' <= _now
    and c.target_at > _now
  on conflict (launch_id, event_type, scheduled_for) do nothing;

  get diagnostics _count = row_count;
  _inserted := _inserted + _count;

  return _inserted;
end;
$function$;