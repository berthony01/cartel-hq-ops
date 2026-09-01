CREATE TABLE public.sticker_motion_versions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
  pack_id uuid NOT NULL REFERENCES public.sticker_packs(id) ON DELETE CASCADE,
  sticker_id uuid NOT NULL REFERENCES public.stickers(id) ON DELETE CASCADE,
  source_static_version_id uuid NULL REFERENCES public.sticker_versions(id) ON DELETE SET NULL,
  source_static_asset_id uuid NULL REFERENCES public.media_assets(id) ON DELETE SET NULL,
  motion_asset_id uuid NULL REFERENCES public.media_assets(id) ON DELETE SET NULL,
  telegram_asset_id uuid NULL REFERENCES public.media_assets(id) ON DELETE SET NULL,
  version_number integer NOT NULL CHECK (version_number > 0),
  motion_mode text NULL CHECK (motion_mode IS NULL OR motion_mode IN ('quick','ai','custom')),
  motion_preset text NULL,
  motion_instruction text NULL,
  provider_metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT sticker_motion_versions_sticker_version_key UNIQUE (sticker_id, version_number),
  CONSTRAINT sticker_motion_versions_sticker_motion_asset_key UNIQUE (sticker_id, motion_asset_id)
);

CREATE INDEX sticker_motion_versions_sticker_created_idx
  ON public.sticker_motion_versions (sticker_id, created_at DESC);

GRANT SELECT ON public.sticker_motion_versions TO authenticated;
GRANT ALL ON public.sticker_motion_versions TO service_role;

ALTER TABLE public.sticker_motion_versions ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Workspace members can view motion versions"
  ON public.sticker_motion_versions
  FOR SELECT
  TO authenticated
  USING (public.is_workspace_member(workspace_id, auth.uid()));

ALTER TABLE public.stickers
  ADD COLUMN current_motion_version_id uuid NULL REFERENCES public.sticker_motion_versions(id) ON DELETE SET NULL,
  ADD COLUMN release_variant text NOT NULL DEFAULT 'static';

ALTER TABLE public.stickers
  ADD CONSTRAINT stickers_release_variant_check CHECK (release_variant IN ('static','motion'));

ALTER TABLE public.media_assets DROP CONSTRAINT media_assets_asset_type_check;
ALTER TABLE public.media_assets ADD CONSTRAINT media_assets_asset_type_check
  CHECK (asset_type = ANY (ARRAY['logo'::text,'mascot'::text,'reference_image'::text,'generated_sticker'::text,'other'::text,'generated_motion'::text,'telegram_motion'::text]));