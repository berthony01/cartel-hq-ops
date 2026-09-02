ALTER TABLE public.telegram_group_announcements
  ADD COLUMN IF NOT EXISTS delivery_kind text NOT NULL DEFAULT 'TEXT',
  ADD COLUMN IF NOT EXISTS delivered_text_snapshot text,
  ADD COLUMN IF NOT EXISTS branding_template_version text,
  ADD COLUMN IF NOT EXISTS branding_project_name text,
  ADD COLUMN IF NOT EXISTS branding_ticker text,
  ADD COLUMN IF NOT EXISTS branding_logo_asset_id uuid,
  ADD COLUMN IF NOT EXISTS branding_logo_storage_path text,
  ADD COLUMN IF NOT EXISTS branding_logo_mime_type text;

UPDATE public.telegram_group_announcements
  SET delivered_text_snapshot = message_text
  WHERE delivered_text_snapshot IS NULL;

ALTER TABLE public.telegram_group_announcements
  ALTER COLUMN delivered_text_snapshot SET NOT NULL;

ALTER TABLE public.telegram_group_announcements
  ADD CONSTRAINT telegram_group_announcements_delivery_kind_ck
  CHECK (delivery_kind IN ('TEXT','BRANDED_PHOTO'));

ALTER TABLE public.telegram_group_announcements
  ADD CONSTRAINT telegram_group_announcements_branding_logo_asset_id_fkey
  FOREIGN KEY (branding_logo_asset_id) REFERENCES public.media_assets(id) ON DELETE SET NULL;

ALTER TABLE public.telegram_group_announcements
  ADD CONSTRAINT telegram_group_announcements_delivery_shape_ck
  CHECK (
    (
      delivery_kind = 'TEXT'
      AND delivered_text_snapshot = message_text
      AND char_length(delivered_text_snapshot) BETWEEN 1 AND 3500
      AND branding_template_version IS NULL
      AND branding_project_name IS NULL
      AND branding_ticker IS NULL
      AND branding_logo_asset_id IS NULL
      AND branding_logo_storage_path IS NULL
      AND branding_logo_mime_type IS NULL
    )
    OR
    (
      delivery_kind = 'BRANDED_PHOTO'
      AND branding_template_version = 'telegram_photo_v1'
      AND branding_project_name IS NOT NULL
      AND char_length(btrim(branding_project_name)) >= 1
      AND branding_logo_storage_path IS NOT NULL
      AND char_length(btrim(branding_logo_storage_path)) >= 1
      AND branding_logo_mime_type IN ('image/png','image/jpeg')
      AND char_length(delivered_text_snapshot) BETWEEN 1 AND 1024
    )
  );

REVOKE ALL ON public.telegram_group_announcements FROM PUBLIC;
REVOKE ALL ON public.telegram_group_announcements FROM anon;
REVOKE ALL ON public.telegram_group_announcements FROM authenticated;
GRANT ALL ON public.telegram_group_announcements TO service_role;