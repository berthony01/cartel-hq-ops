ALTER TABLE public.telegram_group_announcements
  DROP CONSTRAINT telegram_group_announcements_delivery_shape_ck;

ALTER TABLE public.telegram_group_announcements
  ADD CONSTRAINT telegram_group_announcements_delivery_shape_ck
  CHECK (
    COALESCE(
      delivery_kind = 'TEXT'
      AND delivered_text_snapshot = message_text
      AND char_length(delivered_text_snapshot) BETWEEN 1 AND 3500
      AND branding_template_version IS NULL
      AND branding_project_name IS NULL
      AND branding_ticker IS NULL
      AND branding_logo_asset_id IS NULL
      AND branding_logo_storage_path IS NULL
      AND branding_logo_mime_type IS NULL
    , false)
    OR
    COALESCE(
      delivery_kind = 'BRANDED_PHOTO'
      AND branding_template_version = 'telegram_photo_v1'
      AND branding_project_name IS NOT NULL
      AND char_length(btrim(branding_project_name)) >= 1
      AND branding_logo_storage_path IS NOT NULL
      AND char_length(btrim(branding_logo_storage_path)) >= 1
      AND branding_logo_mime_type IN ('image/png','image/jpeg')
      AND char_length(delivered_text_snapshot) BETWEEN 1 AND 1024
    , false)
  );

REVOKE ALL ON public.telegram_group_announcements FROM PUBLIC;
REVOKE ALL ON public.telegram_group_announcements FROM anon;
REVOKE ALL ON public.telegram_group_announcements FROM authenticated;
GRANT ALL ON public.telegram_group_announcements TO service_role;