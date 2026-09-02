-- C7.3E — at most ONE unresolved MEMBER_INITIATED conversation per (workspace, contact).
-- Fail-closed: refuse to create the index if production already violates it.
-- No production rows are deleted, merged, rewritten or seeded.
DO $$
DECLARE
  v_dupes integer;
BEGIN
  SELECT count(*)::integer INTO v_dupes
  FROM (
    SELECT c.workspace_id, c.contact_id
    FROM public.project_conversations c
    WHERE c.origin_type = 'MEMBER_INITIATED'
      AND c.status IN ('OPEN', 'WAITING_ON_TEAM', 'WAITING_ON_MEMBER')
    GROUP BY c.workspace_id, c.contact_id
    HAVING count(*) > 1
  ) d;

  IF v_dupes > 0 THEN
    RAISE EXCEPTION
      'C7.3E aborted: % (workspace_id, contact_id) pair(s) already have more than one unresolved MEMBER_INITIATED conversation. Resolve them manually before applying this migration.',
      v_dupes;
  END IF;
END
$$;

CREATE UNIQUE INDEX IF NOT EXISTS project_conversations_member_initiated_unresolved_key
  ON public.project_conversations (workspace_id, contact_id)
  WHERE origin_type = 'MEMBER_INITIATED'
    AND status IN ('OPEN', 'WAITING_ON_TEAM', 'WAITING_ON_MEMBER');