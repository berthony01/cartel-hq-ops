CREATE OR REPLACE FUNCTION public.record_launch_watch_confirmation(
  _subscription_id uuid,
  _attempted_at timestamptz,
  _status text,
  _message_id bigint DEFAULT NULL,
  _error_class text DEFAULT NULL,
  _last_error text DEFAULT NULL
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
declare
  _updated integer;
begin
  if _status is null or _status not in ('sent','failed','ambiguous') then
    raise exception 'Invalid confirmation status.' using errcode = '22023';
  end if;

  update public.launch_watch_subscriptions s
  set
    confirmation_attempt_count = s.confirmation_attempt_count + 1,
    confirmation_attempted_at = _attempted_at,
    confirmation_status = _status,
    confirmation_sent_at = case when _status = 'sent' then _attempted_at else null end,
    confirmation_telegram_message_id = case when _status = 'sent' then _message_id else null end,
    confirmation_error_class = case when _status = 'sent' then null else left(_error_class, 120) end,
    confirmation_last_error = case when _status = 'sent' then null else left(_last_error, 300) end
  where s.id = _subscription_id;

  get diagnostics _updated = row_count;
  if _updated = 0 then
    raise exception 'Launch Watch subscription not found.' using errcode = 'P0002';
  end if;
end;
$$;

REVOKE ALL ON FUNCTION public.record_launch_watch_confirmation(uuid, timestamptz, text, bigint, text, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.record_launch_watch_confirmation(uuid, timestamptz, text, bigint, text, text) FROM anon;
REVOKE ALL ON FUNCTION public.record_launch_watch_confirmation(uuid, timestamptz, text, bigint, text, text) FROM authenticated;
GRANT EXECUTE ON FUNCTION public.record_launch_watch_confirmation(uuid, timestamptz, text, bigint, text, text) TO service_role;