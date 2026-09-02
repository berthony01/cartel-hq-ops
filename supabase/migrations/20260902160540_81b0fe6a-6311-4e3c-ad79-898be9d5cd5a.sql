ALTER TABLE public.telegram_group_announcements
  ADD COLUMN IF NOT EXISTS cta_enabled boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS cta_launch_id text,
  ADD COLUMN IF NOT EXISTS cta_project_name text,
  ADD COLUMN IF NOT EXISTS cta_token_name text,
  ADD COLUMN IF NOT EXISTS cta_ticker text,
  ADD COLUMN IF NOT EXISTS cta_chain text,
  ADD COLUMN IF NOT EXISTS cta_launch_status text;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'telegram_group_announcements_cta_shape_ck'
      AND conrelid = 'public.telegram_group_announcements'::regclass
  ) THEN
    ALTER TABLE public.telegram_group_announcements
      ADD CONSTRAINT telegram_group_announcements_cta_shape_ck
      CHECK (
        (COALESCE(cta_enabled, false) = false AND cta_launch_id IS NULL)
        OR (cta_enabled = true AND cta_launch_id IS NOT NULL AND length(btrim(cta_launch_id)) > 0)
      );
  END IF;
END
$$;

REVOKE ALL ON public.telegram_group_announcements FROM anon, authenticated;
GRANT ALL ON public.telegram_group_announcements TO service_role;