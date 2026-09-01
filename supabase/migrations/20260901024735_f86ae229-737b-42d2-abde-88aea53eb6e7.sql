ALTER TABLE public.sticker_versions
  ADD COLUMN IF NOT EXISTS variation_group_id uuid,
  ADD COLUMN IF NOT EXISTS variation_label text;

ALTER TABLE public.sticker_versions DROP CONSTRAINT IF EXISTS sticker_versions_origin_check;
ALTER TABLE public.sticker_versions
  ADD CONSTRAINT sticker_versions_origin_check
  CHECK (origin IN ('generation','backfill','candidate_generation','variation_generation'));

ALTER TABLE public.sticker_versions DROP CONSTRAINT IF EXISTS sticker_versions_variation_shape_check;
ALTER TABLE public.sticker_versions
  ADD CONSTRAINT sticker_versions_variation_shape_check
  CHECK (
    (variation_group_id IS NULL AND variation_label IS NULL)
    OR (variation_group_id IS NOT NULL AND variation_label IN ('A','B','C'))
  );

CREATE UNIQUE INDEX IF NOT EXISTS sticker_versions_variation_slot_key
  ON public.sticker_versions (sticker_id, variation_group_id, variation_label)
  WHERE variation_group_id IS NOT NULL;