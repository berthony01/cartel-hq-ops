-- C7.3C CORRECTION — bind Inbox conversation detail/block to the ACTIVE workspace.
-- Replaces ONLY the two C7.3C RPCs with workspace-bound signatures.
-- No table/column/index/trigger/policy changes. No historical migration edits.
--
-- Why: the one-arg forms authorized against the conversation's OWN workspace,
-- so a user who operates workspaces A and B could switch to B while A's
-- conversation stayed selected and still read/mutate A. The new forms require
-- the caller's CURRENT workspace id and fail with ONE generic error when the
-- conversation does not belong to it — wrong-workspace and nonexistent are
-- indistinguishable.

-- ============================================================================
-- 1) Detail RPC: (uuid) -> (_workspace_id uuid, _conversation_id uuid)
-- ============================================================================
DROP FUNCTION public.get_project_inbox_conversation(uuid);

CREATE FUNCTION public.get_project_inbox_conversation(_workspace_id uuid, _conversation_id uuid)
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
BEGIN
  -- Fail closed on NULL input: identical generic error, nothing leaked.
  IF _workspace_id IS NULL OR _conversation_id IS NULL THEN
    RAISE EXCEPTION 'Not authorized' USING ERRCODE = '42501';
  END IF;

  -- FIRST: the caller must be an operator of the CLAIMED (active) workspace.
  IF NOT public.is_workspace_operator(_workspace_id, auth.uid()) THEN
    RAISE EXCEPTION 'Not authorized' USING ERRCODE = '42501';
  END IF;

  -- Resolve the conversation ONLY inside that workspace.
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
   WHERE c.id = _conversation_id
     AND c.workspace_id = _workspace_id;

  -- Wrong workspace and nonexistent fail IDENTICALLY — no existence leak.
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Not authorized' USING ERRCODE = '42501';
  END IF;
END;
$function$;

COMMENT ON FUNCTION public.get_project_inbox_conversation(uuid, uuid) IS
'C7.3C workspace-bound privacy-safe conversation detail for the Project Inbox UI. Requires is_workspace_operator on the caller-supplied ACTIVE workspace FIRST, then resolves the conversation only with id AND workspace_id. NULL input, wrong workspace, nonexistent conversation and non-operator all fail with the same generic 42501. Never returns workspace_id, contact_id or any Telegram identifier.';

REVOKE ALL ON FUNCTION public.get_project_inbox_conversation(uuid, uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.get_project_inbox_conversation(uuid, uuid) FROM anon;
GRANT EXECUTE ON FUNCTION public.get_project_inbox_conversation(uuid, uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_project_inbox_conversation(uuid, uuid) TO service_role;

-- ============================================================================
-- 2) Block RPC: (uuid, boolean) -> (_workspace_id uuid, _conversation_id uuid, _blocked boolean)
-- ============================================================================
DROP FUNCTION public.set_project_inbox_conversation_contact_blocked(uuid, boolean);

CREATE FUNCTION public.set_project_inbox_conversation_contact_blocked(_workspace_id uuid, _conversation_id uuid, _blocked boolean)
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
  v_contact_id uuid;
BEGIN
  -- Fail closed on NULL input (including NULL _blocked): generic error only.
  IF _workspace_id IS NULL OR _conversation_id IS NULL OR _blocked IS NULL THEN
    RAISE EXCEPTION 'Not authorized' USING ERRCODE = '42501';
  END IF;

  -- FIRST: the caller must be an operator of the CLAIMED (active) workspace.
  IF NOT public.is_workspace_operator(_workspace_id, auth.uid()) THEN
    RAISE EXCEPTION 'Not authorized' USING ERRCODE = '42501';
  END IF;

  -- Resolve the contact ONLY from a conversation matching BOTH id and workspace.
  SELECT c.contact_id INTO v_contact_id
    FROM public.project_conversations c
   WHERE c.id = _conversation_id
     AND c.workspace_id = _workspace_id;

  -- Wrong workspace and nonexistent fail IDENTICALLY — no existence leak.
  IF v_contact_id IS NULL THEN
    RAISE EXCEPTION 'Not authorized' USING ERRCODE = '42501';
  END IF;

  -- Same ACTIVE/BLOCKED shape as set_project_inbox_contact_blocked. The UPDATE
  -- row lock continues to serialize naturally against C7.3B capture's
  -- SELECT ... FOR UPDATE on the same contact row. No history is deleted.
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

COMMENT ON FUNCTION public.set_project_inbox_conversation_contact_blocked(uuid, uuid, boolean) IS
'C7.3C workspace-bound conversation-scoped contact block/unblock for the Project Inbox UI. Requires is_workspace_operator on the caller-supplied ACTIVE workspace FIRST, then resolves the contact only from a conversation matching id AND workspace_id. NULL input, wrong workspace, nonexistent conversation and non-operator all fail with the same generic 42501. Same ACTIVE/BLOCKED shape as set_project_inbox_contact_blocked; the UPDATE row lock serializes against C7.3B capture''s FOR UPDATE contact lock. Blocking affects future capture only and never deletes history. Never returns workspace_id, contact_id or Telegram identifiers.';

REVOKE ALL ON FUNCTION public.set_project_inbox_conversation_contact_blocked(uuid, uuid, boolean) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.set_project_inbox_conversation_contact_blocked(uuid, uuid, boolean) FROM anon;
GRANT EXECUTE ON FUNCTION public.set_project_inbox_conversation_contact_blocked(uuid, uuid, boolean) TO authenticated;
GRANT EXECUTE ON FUNCTION public.set_project_inbox_conversation_contact_blocked(uuid, uuid, boolean) TO service_role;