CREATE OR REPLACE FUNCTION public.invoke_project_inbox_delivery_scheduler()
RETURNS bigint
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'vault', 'net'
AS $function$
DECLARE
  _secret text;
  _request_id bigint;
BEGIN
  SELECT decrypted_secret INTO _secret
  FROM vault.decrypted_secrets
  WHERE name = 'project_inbox_delivery_scheduler_secret'
  LIMIT 1;

  IF _secret IS NULL THEN
    RAISE EXCEPTION 'Project Inbox delivery scheduler secret is not configured.';
  END IF;

  SELECT net.http_post(
    url := 'https://ocoinbnjgstkmnwwvnhi.supabase.co/functions/v1/project-inbox-delivery',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'x-cartel-inbox-scheduler-secret', _secret
    ),
    body := '{}'::jsonb,
    timeout_milliseconds := 10000
  ) INTO _request_id;

  RETURN _request_id;
END;
$function$;

REVOKE ALL ON FUNCTION public.invoke_project_inbox_delivery_scheduler() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.invoke_project_inbox_delivery_scheduler() TO service_role;

DO $schedule$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM cron.job WHERE jobname = 'cartel-project-inbox-delivery-runner'
  ) THEN
    PERFORM cron.schedule(
      'cartel-project-inbox-delivery-runner',
      '* * * * *',
      'select public.invoke_project_inbox_delivery_scheduler();'
    );
  END IF;
END
$schedule$;
