ALTER TABLE public.launch_watch_subscriptions
  ADD COLUMN IF NOT EXISTS confirmation_status text,
  ADD COLUMN IF NOT EXISTS confirmation_attempt_count integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS confirmation_attempted_at timestamptz,
  ADD COLUMN IF NOT EXISTS confirmation_sent_at timestamptz,
  ADD COLUMN IF NOT EXISTS confirmation_telegram_message_id bigint,
  ADD COLUMN IF NOT EXISTS confirmation_error_class text,
  ADD COLUMN IF NOT EXISTS confirmation_last_error text;

ALTER TABLE public.launch_watch_subscriptions
  DROP CONSTRAINT IF EXISTS launch_watch_subscriptions_confirmation_status_check;
ALTER TABLE public.launch_watch_subscriptions
  ADD CONSTRAINT launch_watch_subscriptions_confirmation_status_check
  CHECK (confirmation_status IS NULL OR confirmation_status IN ('sent','failed','ambiguous'));

ALTER TABLE public.launch_watch_subscriptions
  DROP CONSTRAINT IF EXISTS launch_watch_subscriptions_confirmation_attempts_check;
ALTER TABLE public.launch_watch_subscriptions
  ADD CONSTRAINT launch_watch_subscriptions_confirmation_attempts_check
  CHECK (confirmation_attempt_count >= 0);

CREATE OR REPLACE FUNCTION public.get_launch_watch_confirmation_summary(_launch_id uuid)
RETURNS TABLE(
  delivered_count bigint,
  failed_count bigint,
  ambiguous_count bigint,
  untracked_count bigint,
  attempted_count bigint
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $$
declare
  launch_workspace uuid;
begin
  select workspace_id into launch_workspace
  from public.launches
  where id = _launch_id;

  if launch_workspace is null then
    raise exception 'Launch not found.' using errcode = 'P0002';
  end if;

  if not public.is_workspace_member(launch_workspace, auth.uid()) then
    raise exception 'You do not have access to this launch.' using errcode = '42501';
  end if;

  return query
  select
    count(*) filter (where s.confirmation_status = 'sent')::bigint,
    count(*) filter (where s.confirmation_status = 'failed')::bigint,
    count(*) filter (where s.confirmation_status = 'ambiguous')::bigint,
    count(*) filter (where s.confirmation_status is null)::bigint,
    count(*) filter (where s.confirmation_attempt_count > 0)::bigint
  from public.launch_watch_subscriptions s
  where s.launch_id = _launch_id
    and s.is_active = true;
end;
$$;

REVOKE ALL ON FUNCTION public.get_launch_watch_confirmation_summary(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_launch_watch_confirmation_summary(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_launch_watch_confirmation_summary(uuid) TO service_role;