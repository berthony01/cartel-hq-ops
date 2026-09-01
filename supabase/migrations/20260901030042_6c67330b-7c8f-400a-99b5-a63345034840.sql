ALTER TABLE public.sticker_versions
  DROP CONSTRAINT IF EXISTS sticker_versions_variation_shape_check;

ALTER TABLE public.sticker_versions
  ADD CONSTRAINT sticker_versions_variation_shape_check CHECK (
    (variation_group_id IS NULL AND variation_label IS NULL)
    OR (
      variation_group_id IS NOT NULL
      AND variation_label IS NOT NULL
      AND variation_label IN ('A','B','C')
    )
  );