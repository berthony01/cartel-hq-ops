-- P2-C2 repository parity migration.
-- This exact schema/data change was ALREADY APPLIED to the project database
-- externally; this file only records it in the repository. Every statement is
-- idempotent so re-running is safe.

-- 1. Classification column.
ALTER TABLE public.launches
  ADD COLUMN IF NOT EXISTS launch_kind text NOT NULL DEFAULT 'PROJECT';

-- 2. Allowed classifications.
ALTER TABLE public.launches
  DROP CONSTRAINT IF EXISTS launches_launch_kind_check;
ALTER TABLE public.launches
  ADD CONSTRAINT launches_launch_kind_check
  CHECK (launch_kind IN ('PROJECT', 'INTERNAL_TEST'));

-- 3. Classify the existing internal chain-test records by stable public slug,
--    BEFORE the immutability trigger exists.
UPDATE public.launches
   SET launch_kind = 'INTERNAL_TEST'
 WHERE public_slug IN ('cartel-mainnet-canary', 'cartel-liquidity-canary')
   AND launch_kind <> 'INTERNAL_TEST';

-- 4. Internal test records are permanently private and unbindable.
ALTER TABLE public.launches
  DROP CONSTRAINT IF EXISTS launches_internal_test_isolation;
ALTER TABLE public.launches
  ADD CONSTRAINT launches_internal_test_isolation
  CHECK (
    launch_kind <> 'INTERNAL_TEST'
    OR (
      status = 'DRAFT'
      AND launch_watch_token IS NULL
      AND official_contract_address IS NULL
      AND official_contract_deployment_id IS NULL
      AND contract_registered_at IS NULL
    )
  );

-- 5. Selection index for project-scoped, kind-filtered launch reads.
CREATE INDEX IF NOT EXISTS launches_project_profile_kind_status_idx
  ON public.launches (project_profile_id, launch_kind, status, updated_at DESC);

-- 6. Classification is immutable after creation.
CREATE OR REPLACE FUNCTION public.prevent_launch_kind_reclassification()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NEW.launch_kind IS DISTINCT FROM OLD.launch_kind THEN
    RAISE EXCEPTION 'launch_kind is immutable after creation';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS launches_prevent_kind_reclassification ON public.launches;
CREATE TRIGGER launches_prevent_kind_reclassification
  BEFORE UPDATE OF launch_kind ON public.launches
  FOR EACH ROW
  EXECUTE FUNCTION public.prevent_launch_kind_reclassification();
