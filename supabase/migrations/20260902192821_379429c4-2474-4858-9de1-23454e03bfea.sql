CREATE OR REPLACE FUNCTION public.claim_project_inbox_deliveries(_limit integer DEFAULT 100)
 RETURNS TABLE(delivery_id uuid, conversation_id uuid, message_id uuid, telegram_user_id bigint, body text, attempt_count integer)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_limit integer := LEAST(GREATEST(COALESCE(_limit, 100), 1), 250);
BEGIN
  RETURN QUERY
  WITH candidate AS (
    SELECT d.id
      FROM public.project_inbox_deliveries d
      JOIN public.project_conversation_messages m
        ON m.id = d.message_id
       AND m.conversation_id = d.conversation_id
     WHERE d.status IN ('pending', 'retry')
       AND d.next_attempt_at <= now()
       AND NOT EXISTS (
         SELECT 1
           FROM public.project_conversation_messages em
           JOIN public.project_inbox_deliveries e
             ON e.message_id = em.id
            AND e.conversation_id = em.conversation_id
          WHERE em.conversation_id = m.conversation_id
            AND (em.created_at, em.id) < (m.created_at, m.id)
            AND e.status IN ('pending', 'processing', 'retry', 'ambiguous')
       )
     ORDER BY d.next_attempt_at ASC, m.created_at ASC, m.id ASC, d.id ASC
     LIMIT v_limit
     FOR UPDATE OF d SKIP LOCKED
  ),
  claimed AS (
    UPDATE public.project_inbox_deliveries d
       SET status = 'processing',
           claimed_at = now(),
           attempt_count = d.attempt_count + 1,
           updated_at = now()
      FROM candidate c
     WHERE d.id = c.id
     RETURNING d.id, d.conversation_id, d.message_id, d.telegram_user_id, d.attempt_count
  )
  SELECT cl.id, cl.conversation_id, cl.message_id, cl.telegram_user_id, m.body, cl.attempt_count
    FROM claimed cl
    JOIN public.project_conversation_messages m ON m.id = cl.message_id;
END;
$function$;

REVOKE ALL ON FUNCTION public.claim_project_inbox_deliveries(integer) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.claim_project_inbox_deliveries(integer) FROM anon;
REVOKE ALL ON FUNCTION public.claim_project_inbox_deliveries(integer) FROM authenticated;
GRANT EXECUTE ON FUNCTION public.claim_project_inbox_deliveries(integer) TO service_role;

COMMENT ON FUNCTION public.claim_project_inbox_deliveries(integer) IS
  'Service-role only. Claims due outbound project inbox deliveries. Per-conversation ordering is determined by the canonical project_conversation_messages sequence ((created_at, id) of the message), never by project_inbox_deliveries.created_at or delivery id. A delivery is blocked while any earlier canonical message in the same conversation has an outbound delivery in pending/processing/retry/ambiguous; sent or definite failed do not block.';