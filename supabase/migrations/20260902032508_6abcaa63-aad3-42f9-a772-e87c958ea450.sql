CREATE INDEX IF NOT EXISTS launch_notification_deliveries_latest_idx
  ON public.launch_notification_deliveries (subscription_id, updated_at DESC, created_at DESC, id DESC);

CREATE OR REPLACE FUNCTION public.get_launch_audience_summary(_launch_id uuid)
RETURNS TABLE(
  active_watchers bigint,
  total_watchers bigint,
  updates_enabled_watchers bigint,
  updates_muted_watchers bigint,
  reminders_enabled_watchers bigint,
  reminders_muted_watchers bigint,
  last_sent_watchers bigint,
  last_failed_watchers bigint,
  last_ambiguous_watchers bigint,
  last_inflight_watchers bigint,
  last_skipped_watchers bigint,
  never_contacted_watchers bigint,
  last_delivery_at timestamptz
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
declare
  launch_workspace uuid;
begin
  select l.workspace_id into launch_workspace
  from public.launches l
  where l.id = _launch_id;

  if launch_workspace is null then
    raise exception 'Launch not found.' using errcode = 'P0002';
  end if;

  if not public.is_workspace_member(launch_workspace, auth.uid()) then
    raise exception 'You do not have access to this launch.' using errcode = '42501';
  end if;

  return query
  with subs as (
    select s.id, s.is_active, s.updates_enabled, s.reminders_enabled
    from public.launch_watch_subscriptions s
    where s.launch_id = _launch_id
  ),
  active_subs as (
    select * from subs where is_active = true
  ),
  latest as (
    select a.id as subscription_id, d.status, d.updated_at
    from active_subs a
    left join lateral (
      select d.status, d.updated_at
      from public.launch_notification_deliveries d
      where d.subscription_id = a.id
        and d.launch_id = _launch_id
      order by d.updated_at desc, d.created_at desc, d.id desc
      limit 1
    ) d on true
  )
  select
    (select count(*) from active_subs)::bigint,
    (select count(*) from subs)::bigint,
    (select count(*) filter (where updates_enabled = true) from active_subs)::bigint,
    (select count(*) filter (where updates_enabled = false) from active_subs)::bigint,
    (select count(*) filter (where reminders_enabled = true) from active_subs)::bigint,
    (select count(*) filter (where reminders_enabled = false) from active_subs)::bigint,
    (select count(*) filter (where status = 'sent') from latest)::bigint,
    (select count(*) filter (where status = 'failed') from latest)::bigint,
    (select count(*) filter (where status = 'ambiguous') from latest)::bigint,
    (select count(*) filter (where status in ('pending','processing','retry')) from latest)::bigint,
    (select count(*) filter (where status = 'skipped') from latest)::bigint,
    (select count(*) filter (where status is null) from latest)::bigint,
    (select max(updated_at) from latest);
end;
$function$;

REVOKE ALL ON FUNCTION public.get_launch_audience_summary(uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.get_launch_audience_summary(uuid) FROM anon;
GRANT EXECUTE ON FUNCTION public.get_launch_audience_summary(uuid) TO authenticated;