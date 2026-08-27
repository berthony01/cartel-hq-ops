CREATE POLICY "workspace_assets_select_member"
ON storage.objects FOR SELECT TO authenticated
USING (
  bucket_id = 'workspace-assets'
  AND (storage.foldername(name))[1] ~ '^[0-9a-fA-F-]{36}$'
  AND public.is_workspace_member(((storage.foldername(name))[1])::uuid, auth.uid())
);

CREATE POLICY "workspace_assets_insert_member"
ON storage.objects FOR INSERT TO authenticated
WITH CHECK (
  bucket_id = 'workspace-assets'
  AND (storage.foldername(name))[1] ~ '^[0-9a-fA-F-]{36}$'
  AND public.is_workspace_member(((storage.foldername(name))[1])::uuid, auth.uid())
);

CREATE POLICY "workspace_assets_update_member"
ON storage.objects FOR UPDATE TO authenticated
USING (
  bucket_id = 'workspace-assets'
  AND (storage.foldername(name))[1] ~ '^[0-9a-fA-F-]{36}$'
  AND public.is_workspace_member(((storage.foldername(name))[1])::uuid, auth.uid())
)
WITH CHECK (
  bucket_id = 'workspace-assets'
  AND (storage.foldername(name))[1] ~ '^[0-9a-fA-F-]{36}$'
  AND public.is_workspace_member(((storage.foldername(name))[1])::uuid, auth.uid())
);

CREATE POLICY "workspace_assets_delete_member"
ON storage.objects FOR DELETE TO authenticated
USING (
  bucket_id = 'workspace-assets'
  AND (storage.foldername(name))[1] ~ '^[0-9a-fA-F-]{36}$'
  AND public.is_workspace_member(((storage.foldername(name))[1])::uuid, auth.uid())
);