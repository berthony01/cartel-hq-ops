REVOKE ALL ON FUNCTION public.archive_sticker_pack(uuid) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.restore_sticker_pack(uuid) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.sticker_pack_lifecycle_state(uuid) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.delete_sticker_pack_if_eligible(uuid) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.pause_sticker_drops_on_pack_archive() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.enforce_sticker_pack_archive_rules() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.block_sticker_drops_for_archived_pack() FROM PUBLIC, anon, authenticated;

GRANT EXECUTE ON FUNCTION public.archive_sticker_pack(uuid) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.restore_sticker_pack(uuid) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.sticker_pack_lifecycle_state(uuid) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.delete_sticker_pack_if_eligible(uuid) TO authenticated, service_role;