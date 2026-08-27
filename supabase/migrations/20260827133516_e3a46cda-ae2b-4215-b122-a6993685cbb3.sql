ALTER TABLE public.sticker_packs
  ADD COLUMN IF NOT EXISTS character_name text,
  ADD COLUMN IF NOT EXISTS brief text,
  ADD COLUMN IF NOT EXISTS style_notes text,
  ADD COLUMN IF NOT EXISTS reference_asset_id uuid NULL REFERENCES public.media_assets(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS sticker_packs_reference_asset_id_idx
  ON public.sticker_packs (reference_asset_id);