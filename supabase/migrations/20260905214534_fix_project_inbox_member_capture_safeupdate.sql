DO $fix$
DECLARE
  v_def text;
  v_new text;
  v_count integer;
BEGIN
  SELECT pg_get_functiondef(p.oid)
    INTO v_def
  FROM pg_proc p
  JOIN pg_namespace n ON n.oid = p.pronamespace
  WHERE n.nspname = 'public'
    AND p.proname = 'capture_project_inbox_member_message'
    AND pg_get_function_identity_arguments(p.oid) = '_telegram_update_id bigint, _telegram_user_id bigint, _telegram_chat_id bigint, _telegram_message_id bigint, _body text';

  IF v_def IS NULL THEN
    RAISE EXCEPTION 'capture_project_inbox_member_message definition not found';
  END IF;

  v_count := (length(v_def) - length(replace(v_def, 'DELETE FROM _pi_candidates;', ''))) / length('DELETE FROM _pi_candidates;');
  IF v_count <> 1 THEN
    RAISE EXCEPTION 'expected exactly one unsafe temp-table DELETE, found %', v_count;
  END IF;

  v_new := replace(v_def, 'DELETE FROM _pi_candidates;', 'PERFORM 1;');
  EXECUTE v_new;
END
$fix$;
