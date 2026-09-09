-- PARITY / REFERENCE ONLY
-- Migration: harden_authenticated_mainnet_canary_runtime_control
-- Already applied live to the authoritative Supabase project on 2026-09-09.
-- DO NOT re-apply. This file exists only to document the exact change in the repository.
--
-- Hardens the three mainnet-canary runtime-control RPCs so they are callable by
-- authenticated sessions (with caller-identity binding) as well as service_role.
-- Presign and send-window issuance functions are intentionally untouched.

-- ------------------------------------------------------------------------------
-- 1. Execution-state reader: effective authority, caller-bound.
-- ------------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.get_launch_chain_production_execution_state()
RETURNS TABLE (
  control_key text,
  execution_enabled boolean,
  emergency_stop_engaged boolean,
  revision bigint,
  reason text,
  updated_by uuid,
  updated_at timestamptz
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_count integer;
  c public.launch_chain_production_execution_controls%ROWTYPE;
  p public.launch_chain_production_canary_permits%ROWTYPE;
  a public.launch_chain_production_presign_authorizations%ROWTYPE;
  v_effective boolean := false;
  v_uid uuid := auth.uid();
  v_role text := auth.role();
BEGIN
  IF v_role IS DISTINCT FROM 'service_role' AND NOT public.is_platform_owner(v_uid) THEN
    RAISE EXCEPTION 'Not authorized' USING ERRCODE = '42501';
  END IF;

  SELECT count(*) INTO v_count FROM public.launch_chain_production_execution_controls;
  IF v_count <> 1 THEN
    RAISE EXCEPTION 'Production execution control state is invalid' USING ERRCODE = '22023';
  END IF;

  SELECT * INTO c
    FROM public.launch_chain_production_execution_controls
   WHERE launch_chain_production_execution_controls.control_key = 'ROBINHOOD_MAINNET_DEPLOYMENT';
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Production execution control state is missing' USING ERRCODE = '22023';
  END IF;

  IF c.execution_enabled = true AND c.emergency_stop_engaged = false THEN
    -- control_revision is UNIQUE on permits: FOUND means exactly one.
    SELECT * INTO p
      FROM public.launch_chain_production_canary_permits x
     WHERE x.control_revision = c.revision;
    IF FOUND
       AND now() < p.expires_at
       AND NOT EXISTS (
         SELECT 1 FROM public.launch_chain_production_send_window_issuances i
          WHERE i.canary_permit_id = p.id OR i.authorization_id = p.authorization_id
       ) THEN
      SELECT * INTO a
        FROM public.launch_chain_production_presign_authorizations y
       WHERE y.id = p.authorization_id;
      IF FOUND
         AND a.expires_at = p.authorization_expires_at
         AND now() < a.expires_at
         AND a.invalidated_at IS NULL
         AND a.consumed_at IS NULL
         AND a.consumed_tx_hash IS NULL
         AND a.status IN ('ISSUED', 'CLAIMED') THEN
        v_effective := true;
      END IF;
    END IF;
  END IF;

  control_key := c.control_key;
  execution_enabled := v_effective;
  emergency_stop_engaged := NOT v_effective;
  revision := c.revision;
  reason := c.reason;
  updated_by := c.updated_by;
  updated_at := c.updated_at;
  RETURN NEXT;
END;
$function$;

REVOKE ALL ON FUNCTION public.get_launch_chain_production_execution_state() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.get_launch_chain_production_execution_state() FROM anon;
GRANT EXECUTE ON FUNCTION public.get_launch_chain_production_execution_state() TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_launch_chain_production_execution_state() TO service_role;

-- ------------------------------------------------------------------------------
-- 2. Canary ARM: deployment eligibility + authorization binding, caller-bound.
-- ------------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.arm_launch_chain_production_canary_execution(
  _deployment_id uuid,
  _authorization_id uuid,
  _operator_user_id uuid,
  _expected_control_revision bigint,
  _reason text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  d public.launch_chain_deployments%ROWTYPE;
  a public.launch_chain_production_presign_authorizations%ROWTYPE;
  c public.launch_chain_production_execution_controls%ROWTYPE;
  p public.launch_chain_production_canary_permits%ROWTYPE;
  v_reason text := btrim(coalesce(_reason, ''));
  v_new_revision bigint;
  v_uid uuid := auth.uid();
  v_role text := auth.role();
BEGIN
  IF v_role IS DISTINCT FROM 'service_role' AND v_uid IS DISTINCT FROM _operator_user_id THEN
    RAISE EXCEPTION 'Not authorized' USING ERRCODE = '42501';
  END IF;

  IF _deployment_id IS NULL OR _authorization_id IS NULL OR _operator_user_id IS NULL THEN
    RAISE EXCEPTION 'Missing required identifiers' USING ERRCODE = '22023';
  END IF;
  IF _expected_control_revision IS NULL OR _expected_control_revision < 1 THEN
    RAISE EXCEPTION 'Invalid expected control revision' USING ERRCODE = '22023';
  END IF;
  IF char_length(v_reason) < 8 OR char_length(v_reason) > 2000 THEN
    RAISE EXCEPTION 'Invalid arm reason' USING ERRCODE = '22023';
  END IF;

  -- Deterministic lock order: deployment -> authorization -> control.
  SELECT * INTO d FROM public.launch_chain_deployments
    WHERE id = _deployment_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Deployment not found' USING ERRCODE = '22023';
  END IF;

  SELECT * INTO a FROM public.launch_chain_production_presign_authorizations
    WHERE id = _authorization_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Authorization not found' USING ERRCODE = '22023';
  END IF;

  SELECT * INTO c FROM public.launch_chain_production_execution_controls
    WHERE control_key = 'ROBINHOOD_MAINNET_DEPLOYMENT' FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Production execution control unavailable' USING ERRCODE = '22023';
  END IF;

  -- Exact deployment eligibility.
  IF d.chain_id <> 4663
     OR d.network_environment <> 'PRODUCTION'
     OR d.deployment_kind <> 'FIXED_SUPPLY_ERC20'
     OR d.artifact_id IS DISTINCT FROM 'cartel-fixed-erc20-v1'
     OR d.status <> 'DRAFT'
     OR d.tx_hash IS NOT NULL
     OR d.review_fingerprint IS NULL
     OR d.init_code_hash IS NULL
     OR d.deployer_address IS NULL THEN
    RAISE EXCEPTION 'Deployment not eligible for canary arm' USING ERRCODE = '22023';
  END IF;

  -- Exact authorization binding.
  IF a.deployment_id <> d.id
     OR a.workspace_id <> d.workspace_id
     OR a.launch_id <> d.launch_id
     OR a.operator_user_id <> _operator_user_id
     OR a.chain_id <> d.chain_id
     OR a.network_environment <> d.network_environment
     OR a.deployer_address <> lower(d.deployer_address)
     OR a.review_fingerprint IS DISTINCT FROM d.review_fingerprint
     OR a.init_code_hash IS DISTINCT FROM d.init_code_hash THEN
    RAISE EXCEPTION 'Authorization does not match deployment intent' USING ERRCODE = '22023';
  END IF;

  -- Authority.
  IF NOT public.is_platform_owner(_operator_user_id)
     OR NOT public.is_workspace_operator(d.workspace_id, _operator_user_id) THEN
    RAISE EXCEPTION 'Not authorized' USING ERRCODE = '42501';
  END IF;

  -- Pristine ISSUED authorization with strictly more than 30 s remaining
  -- on database time, so the lease is never silently shortened.
  IF a.status <> 'ISSUED'
     OR a.claimed_at IS NOT NULL
     OR a.consumed_at IS NOT NULL
     OR a.consumed_tx_hash IS NOT NULL
     OR a.invalidated_at IS NOT NULL THEN
    RAISE EXCEPTION 'Authorization is not a pristine ISSUED authorization' USING ERRCODE = '22023';
  END IF;
  IF NOT (a.expires_at > now() + interval '30 seconds') THEN
    RAISE EXCEPTION 'Authorization has insufficient remaining lifetime for a 30-second canary lease' USING ERRCODE = '22023';
  END IF;

  -- No issuance evidence and no permit may already exist for this authorization.
  -- Permits are never reset or reissued; a new authorization is required.
  IF EXISTS (
    SELECT 1 FROM public.launch_chain_production_send_window_issuances i
     WHERE i.authorization_id = a.id
  ) THEN
    RAISE EXCEPTION 'Send window already issued for this authorization' USING ERRCODE = '23505';
  END IF;
  IF EXISTS (
    SELECT 1 FROM public.launch_chain_production_canary_permits x
     WHERE x.authorization_id = a.id
  ) THEN
    RAISE EXCEPTION 'Canary permit already exists for this authorization' USING ERRCODE = '23505';
  END IF;

  -- Control must be physically stopped, and the caller must name the exact
  -- current revision (compare-and-set).
  IF c.execution_enabled IS DISTINCT FROM false
     OR c.emergency_stop_engaged IS DISTINCT FROM true THEN
    RAISE EXCEPTION 'Production control is not in the stopped state' USING ERRCODE = '42501';
  END IF;
  IF c.revision <> _expected_control_revision THEN
    RAISE EXCEPTION 'Stale expected control revision' USING ERRCODE = '42501';
  END IF;

  v_new_revision := c.revision + 1;

  UPDATE public.launch_chain_production_execution_controls AS t
     SET execution_enabled = true,
         emergency_stop_engaged = false,
         revision = v_new_revision,
         reason = v_reason,
         updated_by = _operator_user_id,
         updated_at = now()
   WHERE t.control_key = 'ROBINHOOD_MAINNET_DEPLOYMENT'
     AND t.revision = c.revision
     AND t.execution_enabled = false
     AND t.emergency_stop_engaged = true
  RETURNING * INTO c;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Production control compare-and-set failed' USING ERRCODE = '42501';
  END IF;

  INSERT INTO public.launch_chain_production_execution_control_events
    (revision, previous_execution_enabled, new_execution_enabled,
     previous_emergency_stop_engaged, new_emergency_stop_engaged, reason, changed_by)
  VALUES
    (v_new_revision, false, true, true, false, v_reason, _operator_user_id);

  INSERT INTO public.launch_chain_production_canary_permits (
    authorization_id, deployment_id, workspace_id, launch_id, operator_user_id,
    chain_id, network_environment, deployer_address, review_fingerprint, init_code_hash,
    control_revision, authorization_expires_at, issued_at, expires_at, reason
  ) VALUES (
    a.id, d.id, d.workspace_id, d.launch_id, _operator_user_id,
    d.chain_id, d.network_environment, lower(d.deployer_address), d.review_fingerprint, d.init_code_hash,
    v_new_revision, a.expires_at, now(), now() + interval '30 seconds', v_reason
  )
  RETURNING * INTO p;

  RETURN jsonb_build_object(
    'permit_id', p.id,
    'deployment_id', d.id,
    'authorization_id', a.id,
    'control_revision', c.revision,
    'permit_issued_at', p.issued_at,
    'permit_expires_at', p.expires_at,
    'authorization_expires_at', a.expires_at,
    'execution_enabled', c.execution_enabled,
    'emergency_stop_engaged', c.emergency_stop_engaged
  );
END;
$function$;

REVOKE ALL ON FUNCTION public.arm_launch_chain_production_canary_execution(uuid, uuid, uuid, bigint, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.arm_launch_chain_production_canary_execution(uuid, uuid, uuid, bigint, text) FROM anon;
GRANT EXECUTE ON FUNCTION public.arm_launch_chain_production_canary_execution(uuid, uuid, uuid, bigint, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.arm_launch_chain_production_canary_execution(uuid, uuid, uuid, bigint, text) TO service_role;

-- ------------------------------------------------------------------------------
-- 3. One-way emergency stop: owner-only, caller-bound.
-- ------------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.engage_launch_chain_production_emergency_stop(
  _operator_user_id uuid,
  _reason text
)
RETURNS TABLE (
  control_key text,
  execution_enabled boolean,
  emergency_stop_engaged boolean,
  revision bigint,
  reason text,
  updated_by uuid,
  updated_at timestamptz
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  c public.launch_chain_production_execution_controls%ROWTYPE;
  c_after public.launch_chain_production_execution_controls%ROWTYPE;
  v_reason text := btrim(coalesce(_reason, ''));
  v_uid uuid := auth.uid();
  v_role text := auth.role();
BEGIN
  IF v_role IS DISTINCT FROM 'service_role' AND v_uid IS DISTINCT FROM _operator_user_id THEN
    RAISE EXCEPTION 'Not authorized' USING ERRCODE = '42501';
  END IF;

  IF _operator_user_id IS NULL OR NOT public.is_platform_owner(_operator_user_id) THEN
    RAISE EXCEPTION 'Not authorized' USING ERRCODE = '42501';
  END IF;
  IF char_length(v_reason) < 8 OR char_length(v_reason) > 2000 THEN
    RAISE EXCEPTION 'Invalid emergency stop reason' USING ERRCODE = '22023';
  END IF;

  SELECT * INTO c
    FROM public.launch_chain_production_execution_controls
   WHERE launch_chain_production_execution_controls.control_key = 'ROBINHOOD_MAINNET_DEPLOYMENT'
   FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Production execution control state is missing' USING ERRCODE = '22023';
  END IF;

  UPDATE public.launch_chain_production_execution_controls AS t
     SET execution_enabled = false,
         emergency_stop_engaged = true,
         revision = c.revision + 1,
         reason = v_reason,
         updated_by = _operator_user_id,
         updated_at = now()
   WHERE t.control_key = 'ROBINHOOD_MAINNET_DEPLOYMENT'
     AND t.revision = c.revision
  RETURNING * INTO c_after;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Not authorized' USING ERRCODE = '42501';
  END IF;

  INSERT INTO public.launch_chain_production_execution_control_events
    (revision, previous_execution_enabled, new_execution_enabled,
     previous_emergency_stop_engaged, new_emergency_stop_engaged, reason, changed_by)
  VALUES
    (c_after.revision, c.execution_enabled, false, c.emergency_stop_engaged, true, v_reason, _operator_user_id);

  control_key := c_after.control_key;
  execution_enabled := c_after.execution_enabled;
  emergency_stop_engaged := c_after.emergency_stop_engaged;
  revision := c_after.revision;
  reason := c_after.reason;
  updated_by := c_after.updated_by;
  updated_at := c_after.updated_at;
  RETURN NEXT;
END;
$function$;

REVOKE ALL ON FUNCTION public.engage_launch_chain_production_emergency_stop(uuid, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.engage_launch_chain_production_emergency_stop(uuid, text) FROM anon;
GRANT EXECUTE ON FUNCTION public.engage_launch_chain_production_emergency_stop(uuid, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.engage_launch_chain_production_emergency_stop(uuid, text) TO service_role;
