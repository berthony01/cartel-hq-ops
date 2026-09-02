REVOKE ALL ON FUNCTION public.project_inbox_apply_message_state() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.project_inbox_apply_message_state() TO service_role;