CREATE OR REPLACE FUNCTION public.bind_referral_to_workspace(_workspace_id uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE v_uid uuid := auth.uid(); v_r public.partner_referrals; v_p public.partners; v_t public.partner_program_terms; v_assignment_id uuid;
BEGIN
  IF v_uid IS NULL THEN RAISE EXCEPTION 'AUTH_REQUIRED' USING ERRCODE = '42501'; END IF;
  IF NOT public.is_workspace_owner(_workspace_id, v_uid) THEN RAISE EXCEPTION 'WORKSPACE_OWNER_REQUIRED' USING ERRCODE = '42501'; END IF;
  SELECT * INTO v_r FROM public.partner_referrals
   WHERE referred_user_id = v_uid AND status IN ('pending','qualified') FOR UPDATE;
  IF NOT FOUND THEN RETURN jsonb_build_object('ok', true, 'bound', false, 'reason', 'NO_REFERRAL'); END IF;
  IF v_r.workspace_id IS NOT NULL THEN
    RETURN jsonb_build_object('ok', true, 'bound', v_r.workspace_id = _workspace_id, 'reason', 'ALREADY_BOUND');
  END IF;
  IF v_r.status <> 'pending' THEN RETURN jsonb_build_object('ok', true, 'bound', false, 'reason', 'REFERRAL_NOT_PENDING'); END IF;
  -- Acquisition guard: an existing workspace cannot be retroactively attributed.
  IF (SELECT w.created_at FROM public.workspaces w WHERE w.id = _workspace_id) < v_r.attributed_at THEN
    RETURN jsonb_build_object('ok', true, 'bound', false, 'reason', 'WORKSPACE_PREDATES_REFERRAL');
  END IF;
  SELECT * INTO v_p FROM public.partners WHERE id = v_r.partner_id;
  IF v_p.id IS NULL OR v_p.status <> 'approved' OR NOT v_p.is_affiliate THEN
    RETURN jsonb_build_object('ok', true, 'bound', false, 'reason', 'PARTNER_NOT_ACTIVE_AFFILIATE');
  END IF;
  SELECT * INTO v_t FROM public.partner_program_terms WHERE version = v_r.terms_version;
  -- Self-referral: partner already owns/belongs to the target workspace.
  IF public.is_workspace_member(_workspace_id, v_p.user_id) OR public.is_workspace_owner(_workspace_id, v_p.user_id) THEN
    UPDATE public.partner_referrals SET status = 'rejected_self', reason = 'Partner is a member of the referred workspace' WHERE id = v_r.id;
    RETURN jsonb_build_object('ok', true, 'bound', false, 'reason', 'SELF_REFERRAL');
  END IF;
  IF v_t.attribution_window_days IS NULL OR v_r.attributed_at + make_interval(days => v_t.attribution_window_days) < now() THEN
    UPDATE public.partner_referrals SET status = 'expired', reason = 'Attribution window elapsed' WHERE id = v_r.id;
    RETURN jsonb_build_object('ok', true, 'bound', false, 'reason', 'EXPIRED');
  END IF;
  IF EXISTS (SELECT 1 FROM public.partner_referrals WHERE workspace_id = _workspace_id) THEN
    RETURN jsonb_build_object('ok', true, 'bound', false, 'reason', 'WORKSPACE_ALREADY_ATTRIBUTED');
  END IF;
  -- Step 1: atomically mark ONLY the eligible current Cartel Free assignment.
  -- Never overwrites Stripe, reseller, manual, paid, or any non-direct authority.
  UPDATE public.workspace_commercial_assignments a
     SET channel = 'affiliate', channel_partner_ref = v_p.id::text
    FROM public.commercial_plans pl
   WHERE a.workspace_id = _workspace_id
     AND a.plan_id = pl.id AND pl.code = 'cartel_free'
     AND a.channel = 'direct' AND a.channel_partner_ref IS NULL
     AND a.assignment_source = 'internal'
     AND a.status = 'active' AND a.starts_at <= now() AND (a.ends_at IS NULL OR a.ends_at > now())
  RETURNING a.id INTO v_assignment_id;
  IF v_assignment_id IS NULL THEN
    RETURN jsonb_build_object('ok', true, 'bound', false, 'reason', 'ASSIGNMENT_NOT_ELIGIBLE');
  END IF;
  -- Step 2: only after the marker succeeded, bind and qualify the referral.
  -- partner_referrals_one_per_workspace aborts (and rolls back step 1) on a race.
  UPDATE public.partner_referrals
     SET workspace_id = _workspace_id, bound_at = now(), status = 'qualified'
   WHERE id = v_r.id;
  RETURN jsonb_build_object('ok', true, 'bound', true, 'assignment_marked', true);
END $$;