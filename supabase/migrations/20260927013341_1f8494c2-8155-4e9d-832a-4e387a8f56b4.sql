DROP POLICY IF EXISTS "Authenticated users can read commercial plans" ON public.commercial_plans;
DROP POLICY IF EXISTS "Authenticated users can read commercial plan entitlements" ON public.commercial_plan_entitlements;
REVOKE SELECT ON public.commercial_plans FROM authenticated;
REVOKE SELECT ON public.commercial_plan_entitlements FROM authenticated;