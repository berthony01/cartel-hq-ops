-- CARTEL HQ STAGING G2D: INDEPENDENT READ-ONLY POST-SETUP, POST-RACE, POST-CLEANUP CHECKS
-- REVIEW ONLY; NOT APPROVED FOR EXECUTION. Project llicojkxpzwylghptmkf only.
-- Other project forbidden. No Kie.ai, AI calls, production, CI or Lovable.
-- Only call POST-CLEANUP result PASS after every baseline result matches.
SELECT pg_backend_pid() as verify_pid,
(SELECT COUNT(*) FROM public.cartel_guide_budget_reservations WHERE workspace_id='bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb'::uuid) AS b_reservations,
(SELECT COUNT(*) FROM public.cartel_guide_budget_reservations) AS all_reservations,
(SELECT COUNT(*) FROM public.workspace_commercial_assignments WHERE workspace_id='bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb'::uuid) AS b_plan_assignments,
(SELECT COUNT(*) FROM public.workspace_members WHERE workspace_id='bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb'::uuid AND user_id='9da5e296-dc49-43ce-82d5-200cbd0130c7'::uuid) AS temporary_member_b,
(SELECT COUNT(*) FROM information_schema.columns WHERE table_schema='public' AND table_name='cartel_guide_budget_controls' AND column_name='customer_workspace_month_requests') AS new_cap_column,
md5(pg_get_functiondef('public.cartel_guide_reserve_budget(uuid,uuid,uuid)'::regprocedure)) AS reserve_func_md5,
(SELECT COUNT(*) FROM public.commercial_plan_entitlements e JOIN public.commercial_plans p ON p.id=e.plan_id WHERE p.code='cartel_49' AND p.version=1 AND e.feature_key='guide_conversation' AND e.enabled=false) AS pro_entitlement_disabled,
c.enabled,c.emergency_stop,c.customer_pilot_enabled,c.customer_user_month_requests,
c.global_day_cap_micro_usd,c.global_month_cap_micro_usd,
c.customer_workspace_month_cap_micro_usd,c.customer_user_month_cap_micro_usd,c.platform_concurrent_reservations
FROM public.cartel_guide_budget_controls c WHERE c.singleton=true;
-- Restored baseline: b=0,total=7,assignment=0,tempMember=0,newCap=0,
-- function MD5 c4c3d33069006ecd021d49497dadee4d,entDisabled=1,
-- enabled=false,stop=true,pilot=false,userReq=10,caps 50000/50000/10000/10000,pendingCap=20.
