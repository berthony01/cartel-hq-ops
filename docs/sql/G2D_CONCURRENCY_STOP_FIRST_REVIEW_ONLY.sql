-- CARTEL HQ STAGING G2D: EMERGENCY STOP - RUN BEFORE CLEANUP EVEN IF RACE FAILS
-- REVIEW ONLY; NOT APPROVED FOR EXECUTION. Project llicojkxpzwylghptmkf only.
-- Other project forbidden. No Kie.ai, AI calls, production, CI or Lovable.
-- This COMMIT is separate from CLEANUP so a later failure cannot undo stop.
BEGIN;
SET LOCAL statement_timeout='10s';
SET LOCAL lock_timeout='4s';
DO $guard$ BEGIN
 IF EXISTS(SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='commercial_plans' AND column_name='price_cents')
 OR (SELECT COUNT(*) FROM public.workspaces WHERE id='bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb'::uuid)<>1
 OR (SELECT COUNT(*) FROM public.cartel_guide_model_quotes WHERE provider='test-provider-never-called' AND model='offline-test-model')<>1
 THEN RAISE EXCEPTION 'NOT_CARTEL_HQ_STAGE'; END IF;
END $guard$;
UPDATE public.cartel_guide_budget_controls SET enabled=false,customer_pilot_enabled=false,emergency_stop=true WHERE singleton=true;
COMMIT;
SELECT enabled,customer_pilot_enabled,emergency_stop FROM public.cartel_guide_budget_controls WHERE singleton=true;
