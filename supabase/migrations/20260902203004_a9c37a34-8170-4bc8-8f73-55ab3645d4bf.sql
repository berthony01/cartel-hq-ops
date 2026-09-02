-- C7.3C — Project Inbox UI support: two privacy-safe browser RPCs.
-- No table/column/index/trigger/schema changes. No changes to historical migrations.

-- ============================================================================
-- RPC 1: privacy-safe conversation detail.
-- Authorization: resolve the conversation's workspace, then require
-- is_workspace_operator(workspace_id, auth.uid()). A nonexistent conversation
-- fails with the identical 'Not authorized' error so cross-workspace existence
-- is never leaked.
-- Returns NO contact_id, NO telegram identifiers, NO raw payloads.
-- ============================================================================
CREATE OR REPLACE FUNCTION public.get_project_inbox_conversation(_conversation_id uuid)
RETURNS TABLE(
  conversation_id uuid,
  member_ref text,
  contact_status text,
  category text,
  status text,
  priority text,
  origin_type text,
  origin_title_snapshot text,
  origin_text_snapshot text,
  last_message_at timestamp with time zone,
  opened_at timestamp with time zone,
  resolved_at timestamp with time zone,
  assigned_to uuid,
  assigned_display_name text
)
LANGUAGE plpgsql
STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_workspace_id uuid;
BEGIN
  SELECT c.workspace_id INTO v_workspace_id
    FROM public.project_conversations c
   WHERE c.id = _conversation_id;

  IF v_workspace_id IS NULL OR NOT public.is_workspace_operator(v_workspace_id, auth.uid()) THEN
    RAISE EXCEPTION 'Not authorized' USING ERRCODE = '42501';
  END IF;

  RETURN QUERY
  SELECT c.id,
         ct.member_ref,
         ct.status,
         c.category,
         c.status,
         c.priority,
         c.origin_type,
         c.origin_title_snapshot,
         c.origin_text_snapshot,
         c.last_message_at,
         c.opened_at,
         c.resolved_at,
         c.assigned_to,
         p.display_name
    FROM public.project_conversations c
    JOIN public.project_inbox_contacts ct ON ct.id = c.contact_id
    LEFT JOIN public.profiles p ON p.id = c.assigned_to
   WHERE c.id = _conversation_id;
END;
$function$;

COMMENT ON FUNCTION public.get_project_inbox_conversation(uuid) IS
'C7.3C privacy-safe conversation detail for the Project Inbox UI. Operator-only via is_workspace_operator; nonexistent conversations fail identically to unauthorized ones. Never returns contact_id or any Telegram identifier.';

REVOKE ALL ON FUNCTION public.get_project_inbox_conversation(uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.get_project_inbox_conversation(uuid) FROM anon;
GRANT EXECUTE ON FUNCTION public.get_project_inbox_conversation(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_project_inbox_conversation(uuid) TO service_role;

-- ============================================================================
-- RPC 2: block/unblock the conversation's contact by conversation id.
-- Same ACTIVE/BLOCKED shape as existing set_project_inbox_contact_blocked:
--   BLOCKED => blocked_at set/preserved, blocked_by = auth.uid()
--   ACTIVE  => blocked_at NULL, blocked_by NULL
-- The UPDATE takes a row lock on project_inbox_contacts and therefore
-- serializes naturally against C7.3B capture's SELECT ... FOR UPDATE on the
-- same contact row. Blocking controls future capture only; no history is
-- deleted. Returns NO contact_id and NO Telegram identifiers.
-- ============================================================================
CREATE OR REPLACE FUNCTION public.set_project_inbox_conversation_contact_blocked(_conversation_id uuid, _blocked boolean)
RETURNS TABLE(
  conversation_id uuid,
  member_ref text,
  contact_status text,
  blocked_at timestamp with time zone
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_workspace_id uuid;
  v_contact_id uuid;
BEGIN
  SELECT c.workspace_id, c.contact_id INTO v_workspace_id, v_contact_id
    FROM public.project_conversations c
   WHERE c.id = _conversation_id;

  IF v_workspace_id IS NULL OR NOT public.is_workspace_operator(v_workspace_id, auth.uid()) THEN
    RAISE EXCEPTION 'Not authorized' USING ERRCODE = '42501';
  END IF;

  RETURN QUERY
  UPDATE public.project_inbox_contacts ct
     SET status = CASE WHEN _blocked THEN 'BLOCKED' ELSE 'ACTIVE' END,
         blocked_at = CASE WHEN _blocked THEN COALESCE(ct.blocked_at, now()) ELSE NULL END,
         blocked_by = CASE WHEN _blocked THEN auth.uid() ELSE NULL END,
         updated_at = now()
   WHERE ct.id = v_contact_id
  RETURNING _conversation_id, ct.member_ref, ct.status, ct.blocked_at;
END;
$function$;

COMMENT ON FUNCTION public.set_project_inbox_conversation_contact_blocked(uuid, boolean) IS
'C7.3C conversation-scoped contact block/unblock for the Project Inbox UI. Operator-only. Same ACTIVE/BLOCKED shape as set_project_inbox_contact_blocked; the UPDATE row lock serializes against C7.3B capture''s FOR UPDATE contact lock. Blocking affects future capture only and never deletes history. Never returns contact_id or Telegram identifiers.';

REVOKE ALL ON FUNCTION public.set_project_inbox_conversation_contact_blocked(uuid, boolean) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.set_project_inbox_conversation_contact_blocked(uuid, boolean) FROM anon;
GRANT EXECUTE ON FUNCTION public.set_project_inbox_conversation_contact_blocked(uuid, boolean) TO authenticated;
GRANT EXECUTE ON FUNCTION public.set_project_inbox_conversation_contact_blocked(uuid, boolean) TO service_role;