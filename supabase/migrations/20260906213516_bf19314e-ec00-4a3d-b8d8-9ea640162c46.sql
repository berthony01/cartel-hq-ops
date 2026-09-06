-- P3C-D4: bounded canary re-arm + atomic auto-relock foundation (control plane only).
--
-- Invariants introduced here:
--   * The ONLY function that can move the singleton control to
--     execution_enabled=true / emergency_stop_engaged=false is the exact
--     authorization-bound arm RPC below. It is compare-and-set on the current
--     revision, requires a physically stopped control, and mints exactly one
--     immutable 30-second canary permit at the new armed revision in the same
--     transaction.
--   * The execution-state reader now reports EFFECTIVE authority: raw armed
--     state counts only while exactly one matching current-revision permit is
--     unexpired, unconsumed and still bound to a live authorization. Anything
--     else reads as stopped, so the app-side runtime gate fails closed with no
--     TypeScript change.
--   * Final send-window issuance physically re-locks the control and appends
--     the relock event BEFORE it returns. If the relock cannot be written, the
--     issuance row rolls back with it.
--   * Every explicit emergency stop bumps the revision, even when already
--     stopped, so any in-flight arm at an older expected revision is defeated.
--   * CLAIMED cancellation refuses once any issuance evidence exists.
--   * No permit reset/reissue/delete path. No app wrapper. Compile-time
--     production sends remain OFF in the application.

-- ------------------------------------------------------------------
-- A. Bounded, authorization-bound, compare-and-set arm RPC (service role only).
-- ------------------------------------------------------------------
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
BEGIN
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
REVOKE ALL ON FUNCTION public.arm_launch_chain_production_canary_execution(uuid, uuid, uuid, bigint, text) FROM authenticated;
GRANT EXECUTE ON FUNCTION public.arm_launch_chain_production_canary_execution(uuid, uuid, uuid, bigint, text) TO service_role;

-- ------------------------------------------------------------------
-- B. Execution-state reader now reports EFFECTIVE authority (same signature).
--    Raw armed state is honoured only while exactly one matching current-
--    revision permit is unexpired, unconsumed and bound to a live authorization.
-- ------------------------------------------------------------------
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
BEGIN
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
REVOKE ALL ON FUNCTION public.get_launch_chain_production_execution_state() FROM authenticated;
GRANT EXECUTE ON FUNCTION public.get_launch_chain_production_execution_state() TO service_role;

-- ------------------------------------------------------------------
-- C. Final issuance now auto-relocks production atomically BEFORE return.
-- ------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.authorize_launch_chain_production_send_window_issuance(
  _deployment_id uuid,
  _authorization_id uuid,
  _operator_user_id uuid
)
RETURNS public.launch_chain_production_send_window_issuances
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  d public.launch_chain_deployments%ROWTYPE;
  a public.launch_chain_production_presign_authorizations%ROWTYPE;
  c public.launch_chain_production_execution_controls%ROWTYPE;
  c_relocked public.launch_chain_production_execution_controls%ROWTYPE;
  p public.launch_chain_production_canary_permits%ROWTYPE;
  v_deadline timestamptz;
  v_row public.launch_chain_production_send_window_issuances%ROWTYPE;
BEGIN
  IF _deployment_id IS NULL OR _authorization_id IS NULL OR _operator_user_id IS NULL THEN
    RAISE EXCEPTION 'Missing required identifiers' USING ERRCODE = '22023';
  END IF;

  -- Deterministic lock order: deployment -> authorization -> control -> permit.
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

  -- Deployment eligibility.
  IF d.chain_id <> 4663
     OR d.network_environment <> 'PRODUCTION'
     OR d.deployment_kind <> 'FIXED_SUPPLY_ERC20'
     OR d.artifact_id IS DISTINCT FROM 'cartel-fixed-erc20-v1'
     OR d.status <> 'DRAFT'
     OR d.tx_hash IS NOT NULL
     OR d.review_fingerprint IS NULL
     OR d.init_code_hash IS NULL THEN
    RAISE EXCEPTION 'Deployment not eligible for send-window issuance' USING ERRCODE = '22023';
  END IF;

  -- Exact authorization/deployment binding.
  IF a.deployment_id <> d.id
     OR a.workspace_id <> d.workspace_id
     OR a.launch_id <> d.launch_id
     OR a.chain_id <> d.chain_id
     OR a.network_environment <> d.network_environment
     OR a.deployer_address <> lower(d.deployer_address)
     OR a.review_fingerprint IS DISTINCT FROM d.review_fingerprint
     OR a.init_code_hash IS DISTINCT FROM d.init_code_hash
     OR a.operator_user_id <> _operator_user_id THEN
    RAISE EXCEPTION 'Authorization does not match deployment intent' USING ERRCODE = '22023';
  END IF;

  -- Authority.
  IF NOT public.is_platform_owner(_operator_user_id)
     OR NOT public.is_workspace_operator(d.workspace_id, _operator_user_id) THEN
    RAISE EXCEPTION 'Not authorized' USING ERRCODE = '42501';
  END IF;

  -- Exactly one acceptable authorization state.
  IF a.status <> 'CLAIMED'
     OR a.claimed_at IS NULL
     OR a.consumed_at IS NOT NULL
     OR a.consumed_tx_hash IS NOT NULL
     OR a.invalidated_at IS NOT NULL THEN
    RAISE EXCEPTION 'Authorization is not claimed and unconsumed' USING ERRCODE = '22023';
  END IF;

  -- Runtime control re-checked HERE. Closes the TOCTOU with the app read.
  IF c.execution_enabled IS DISTINCT FROM true
     OR c.emergency_stop_engaged IS DISTINCT FROM false THEN
    RAISE EXCEPTION 'Production runtime execution is disabled' USING ERRCODE = '42501';
  END IF;

  -- D3: mandatory exact, current-revision, unexpired canary permit.
  SELECT * INTO p FROM public.launch_chain_production_canary_permits
    WHERE authorization_id = a.id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'No canary permit for this authorization' USING ERRCODE = '42501';
  END IF;
  IF p.deployment_id <> d.id
     OR p.workspace_id <> d.workspace_id
     OR p.launch_id <> d.launch_id
     OR p.operator_user_id <> _operator_user_id
     OR p.chain_id <> d.chain_id
     OR p.network_environment <> d.network_environment
     OR p.deployer_address <> lower(d.deployer_address)
     OR p.review_fingerprint IS DISTINCT FROM d.review_fingerprint
     OR p.init_code_hash IS DISTINCT FROM d.init_code_hash
     OR p.authorization_expires_at IS DISTINCT FROM a.expires_at THEN
    RAISE EXCEPTION 'Canary permit does not match authorization intent' USING ERRCODE = '42501';
  END IF;
  IF p.control_revision IS DISTINCT FROM c.revision THEN
    RAISE EXCEPTION 'Canary permit control revision is stale' USING ERRCODE = '42501';
  END IF;
  IF NOT (now() < p.expires_at) THEN
    RAISE EXCEPTION 'Canary permit expired' USING ERRCODE = '22023';
  END IF;

  -- Database server time only. No mutation of the authorization.
  v_deadline := least(a.expires_at, a.claimed_at + interval '10 seconds');
  IF NOT (now() < a.expires_at) OR NOT (now() < v_deadline) THEN
    RAISE EXCEPTION 'Send window expired' USING ERRCODE = '22023';
  END IF;

  -- Duplicate issuance is an explicit refusal, never idempotent success.
  IF EXISTS (
    SELECT 1 FROM public.launch_chain_production_send_window_issuances i
    WHERE i.authorization_id = a.id OR i.canary_permit_id = p.id
  ) THEN
    RAISE EXCEPTION 'Send window already issued for this authorization' USING ERRCODE = '23505';
  END IF;

  -- Exactly one immutable issuance row; it is the permit's consumption evidence
  -- and records the ARMED control revision that authorized it.
  INSERT INTO public.launch_chain_production_send_window_issuances (
    authorization_id, deployment_id, workspace_id, launch_id, operator_user_id,
    chain_id, network_environment, review_fingerprint, init_code_hash,
    control_revision, claimed_at, authorization_expires_at, send_window_expires_at,
    canary_permit_id
  ) VALUES (
    a.id, d.id, d.workspace_id, d.launch_id, _operator_user_id,
    d.chain_id, d.network_environment, d.review_fingerprint, d.init_code_hash,
    c.revision, a.claimed_at, a.expires_at, v_deadline,
    p.id
  )
  RETURNING * INTO v_row;

  -- D4: physically re-lock production in this same transaction BEFORE return.
  -- Compare-and-set against the exact locked armed revision that authorized
  -- the issuance. If this cannot be written, the issuance row rolls back too.
  UPDATE public.launch_chain_production_execution_controls AS t
     SET execution_enabled = false,
         emergency_stop_engaged = true,
         revision = c.revision + 1,
         reason = 'AUTO_RELOCK_AFTER_SEND_WINDOW_ISSUANCE',
         updated_by = _operator_user_id,
         updated_at = now()
   WHERE t.control_key = 'ROBINHOOD_MAINNET_DEPLOYMENT'
     AND t.revision = c.revision
     AND t.execution_enabled = true
     AND t.emergency_stop_engaged = false
  RETURNING * INTO c_relocked;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Production auto-relock failed; send-window issuance aborted' USING ERRCODE = '42501';
  END IF;

  INSERT INTO public.launch_chain_production_execution_control_events
    (revision, previous_execution_enabled, new_execution_enabled,
     previous_emergency_stop_engaged, new_emergency_stop_engaged, reason, changed_by)
  VALUES
    (c_relocked.revision, true, false, false, true,
     'AUTO_RELOCK_AFTER_SEND_WINDOW_ISSUANCE', _operator_user_id);

  RETURN v_row;
END;
$function$;

REVOKE ALL ON FUNCTION public.authorize_launch_chain_production_send_window_issuance(uuid, uuid, uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.authorize_launch_chain_production_send_window_issuance(uuid, uuid, uuid) FROM anon;
REVOKE ALL ON FUNCTION public.authorize_launch_chain_production_send_window_issuance(uuid, uuid, uuid) FROM authenticated;
GRANT EXECUTE ON FUNCTION public.authorize_launch_chain_production_send_window_issuance(uuid, uuid, uuid) TO service_role;

-- ------------------------------------------------------------------
-- D. Emergency stop is now an immediate revision-revocation barrier.
--    Every successful call, including from an already-stopped state, sets
--    false/true, bumps the revision by exactly one and appends one event.
-- ------------------------------------------------------------------
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
BEGIN
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
REVOKE ALL ON FUNCTION public.engage_launch_chain_production_emergency_stop(uuid, text) FROM authenticated;
GRANT EXECUTE ON FUNCTION public.engage_launch_chain_production_emergency_stop(uuid, text) TO service_role;

-- ------------------------------------------------------------------
-- E. Latent CLAIMED cancellation refuses once issuance evidence exists.
-- ------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.cancel_claimed_launch_chain_production_presign_authorization(
  _authorization_id uuid,
  _operator_user_id uuid,
  _reason text
)
RETURNS public.launch_chain_production_presign_authorizations
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_deployment_id uuid;
  d public.launch_chain_deployments%ROWTYPE;
  a public.launch_chain_production_presign_authorizations%ROWTYPE;
BEGIN
  IF _authorization_id IS NULL OR _operator_user_id IS NULL THEN
    RAISE EXCEPTION 'Not authorized' USING ERRCODE = '42501';
  END IF;

  SELECT deployment_id INTO v_deployment_id
    FROM public.launch_chain_production_presign_authorizations
   WHERE id = _authorization_id;
  IF v_deployment_id IS NULL THEN
    RAISE EXCEPTION 'Authorization not found' USING ERRCODE = '22023';
  END IF;

  -- Deterministic lock order: deployment -> authorization.
  SELECT * INTO d FROM public.launch_chain_deployments WHERE id = v_deployment_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Deployment not found' USING ERRCODE = '22023';
  END IF;

  SELECT * INTO a
    FROM public.launch_chain_production_presign_authorizations
   WHERE id = _authorization_id
   FOR UPDATE;
  IF NOT FOUND OR a.deployment_id <> d.id THEN
    RAISE EXCEPTION 'Authorization not found' USING ERRCODE = '22023';
  END IF;

  IF d.chain_id <> 4663
     OR d.network_environment <> 'PRODUCTION'
     OR d.status <> 'DRAFT'
     OR d.tx_hash IS NOT NULL THEN
    RAISE EXCEPTION 'Deployment is not cancellable' USING ERRCODE = '22023';
  END IF;

  IF a.workspace_id <> d.workspace_id
     OR a.launch_id <> d.launch_id
     OR a.chain_id <> d.chain_id
     OR a.network_environment <> d.network_environment
     OR a.deployer_address <> lower(d.deployer_address)
     OR a.review_fingerprint IS DISTINCT FROM d.review_fingerprint
     OR a.init_code_hash IS DISTINCT FROM d.init_code_hash THEN
    RAISE EXCEPTION 'Authorization binding mismatch' USING ERRCODE = '22023';
  END IF;

  IF a.operator_user_id <> _operator_user_id
     OR NOT public.is_platform_owner(_operator_user_id)
     OR NOT public.is_workspace_operator(d.workspace_id, _operator_user_id) THEN
    RAISE EXCEPTION 'Not authorized' USING ERRCODE = '42501';
  END IF;

  -- D4: once immutable issuance evidence exists for this authorization or
  -- deployment, an envelope may already have left the server. Cancellation is
  -- unsafe even while tx_hash is still NULL. Refuse before any mutation.
  IF EXISTS (
    SELECT 1 FROM public.launch_chain_production_send_window_issuances i
     WHERE i.authorization_id = a.id OR i.deployment_id = d.id
  ) THEN
    RAISE EXCEPTION 'Send window already issued; cancellation refused' USING ERRCODE = '42501';
  END IF;

  IF a.status = 'INVALIDATED' THEN
    RETURN a;
  END IF;

  IF a.status <> 'CLAIMED' THEN
    RAISE EXCEPTION 'Authorization cannot be cancelled in state %', a.status USING ERRCODE = '22023';
  END IF;

  UPDATE public.launch_chain_production_presign_authorizations
     SET status = 'INVALIDATED',
         invalidated_at = now(),
         invalidated_reason = left(nullif(btrim(coalesce(_reason, '')), ''), 2000)
   WHERE id = a.id AND status = 'CLAIMED'
  RETURNING * INTO a;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Not authorized' USING ERRCODE = '42501';
  END IF;

  RETURN a;
END;
$function$;

REVOKE ALL ON FUNCTION public.cancel_claimed_launch_chain_production_presign_authorization(uuid, uuid, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.cancel_claimed_launch_chain_production_presign_authorization(uuid, uuid, text) FROM anon;
REVOKE ALL ON FUNCTION public.cancel_claimed_launch_chain_production_presign_authorization(uuid, uuid, text) FROM authenticated;
GRANT EXECUTE ON FUNCTION public.cancel_claimed_launch_chain_production_presign_authorization(uuid, uuid, text) TO service_role;

-- ------------------------------------------------------------------
-- F. Reconciliation snapshot: separate effective-control visibility, no mutation.
-- ------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.get_launch_chain_production_reconciliation_snapshot(
  _deployment_id uuid,
  _operator_user_id uuid
)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  d public.launch_chain_deployments%ROWTYPE;
  v_presigns jsonb;
  v_issuances jsonb;
  v_permits jsonb;
  v_control jsonb;
  v_effective_control jsonb;
  v_control_events jsonb;
  v_now timestamptz := now();
  v_classification text;
  v_auth_count integer;
  v_claimed_count integer;
  v_issuance_count integer;
  v_open_issued_count integer;
  v_active_permit_count integer;
  c public.launch_chain_production_execution_controls%ROWTYPE;
  ep public.launch_chain_production_canary_permits%ROWTYPE;
  ea public.launch_chain_production_presign_authorizations%ROWTYPE;
  v_runtime_active boolean;
  v_effective boolean := false;
  v_effective_reason text := 'RAW_RUNTIME_STOPPED';
  v_effective_permit_id uuid := NULL;
  v_effective_permit_expires_at timestamptz := NULL;
BEGIN
  IF _deployment_id IS NULL OR _operator_user_id IS NULL THEN
    RAISE EXCEPTION 'Missing required identifiers' USING ERRCODE = '22023';
  END IF;

  SELECT * INTO d FROM public.launch_chain_deployments WHERE id = _deployment_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Deployment not found' USING ERRCODE = '22023';
  END IF;

  IF NOT public.is_platform_owner(_operator_user_id)
     OR NOT public.is_workspace_operator(d.workspace_id, _operator_user_id) THEN
    RAISE EXCEPTION 'Not authorized' USING ERRCODE = '42501';
  END IF;

  IF d.chain_id <> 4663 OR d.network_environment <> 'PRODUCTION' THEN
    RAISE EXCEPTION 'Deployment is not a production mainnet deployment' USING ERRCODE = '22023';
  END IF;

  SELECT * INTO c FROM public.launch_chain_production_execution_controls
   WHERE control_key = 'ROBINHOOD_MAINNET_DEPLOYMENT';
  v_runtime_active := coalesce(c.execution_enabled, false) = true
                  AND coalesce(c.emergency_stop_engaged, true) = false;

  -- Effective authority (read-only derivation, same rules as the execution-state reader).
  IF c.control_key IS NULL THEN
    v_effective_reason := 'CONTROL_MISSING';
  ELSIF v_runtime_active THEN
    SELECT * INTO ep
      FROM public.launch_chain_production_canary_permits x
     WHERE x.control_revision = c.revision;
    IF NOT FOUND THEN
      v_effective_reason := 'NO_CURRENT_ACTIVE_PERMIT';
    ELSIF EXISTS (
      SELECT 1 FROM public.launch_chain_production_send_window_issuances i
       WHERE i.canary_permit_id = ep.id OR i.authorization_id = ep.authorization_id
    ) THEN
      v_effective_reason := 'CURRENT_PERMIT_CONSUMED';
    ELSIF NOT (v_now < ep.expires_at) THEN
      v_effective_reason := 'CURRENT_PERMIT_EXPIRED';
    ELSE
      SELECT * INTO ea
        FROM public.launch_chain_production_presign_authorizations y
       WHERE y.id = ep.authorization_id;
      IF NOT FOUND
         OR ea.expires_at IS DISTINCT FROM ep.authorization_expires_at
         OR NOT (v_now < ea.expires_at)
         OR ea.invalidated_at IS NOT NULL
         OR ea.consumed_at IS NOT NULL
         OR ea.consumed_tx_hash IS NOT NULL
         OR ea.status NOT IN ('ISSUED', 'CLAIMED') THEN
        v_effective_reason := 'CURRENT_PERMIT_AUTHORIZATION_NOT_ELIGIBLE';
      ELSE
        v_effective := true;
        v_effective_reason := 'ACTIVE_CANARY_PERMIT';
        v_effective_permit_id := ep.id;
        v_effective_permit_expires_at := ep.expires_at;
      END IF;
    END IF;
  END IF;

  v_effective_control := jsonb_build_object(
    'effective_execution_enabled', v_effective,
    'effective_emergency_stop_engaged', NOT v_effective,
    'raw_execution_enabled', coalesce(c.execution_enabled, false),
    'raw_emergency_stop_engaged', coalesce(c.emergency_stop_engaged, true),
    'control_revision', c.revision,
    'active_canary_permit_id', v_effective_permit_id,
    'active_canary_permit_expires_at', v_effective_permit_expires_at,
    'effective_reason', v_effective_reason,
    'evaluated_at', v_now
  );

  SELECT coalesce(jsonb_agg(x ORDER BY x_issued_at), '[]'::jsonb),
         count(*)::int,
         count(*) FILTER (WHERE x_status = 'CLAIMED')::int,
         count(*) FILTER (WHERE x_status = 'ISSUED' AND x_expires_at > v_now)::int
    INTO v_presigns, v_auth_count, v_claimed_count, v_open_issued_count
  FROM (
    SELECT a.issued_at AS x_issued_at,
           a.status AS x_status,
           a.expires_at AS x_expires_at,
           jsonb_build_object(
             'id', a.id,
             'deployment_id', a.deployment_id,
             'workspace_id', a.workspace_id,
             'launch_id', a.launch_id,
             'chain_id', a.chain_id,
             'network_environment', a.network_environment,
             'deployer_address', a.deployer_address,
             'operator_user_id', a.operator_user_id,
             'review_fingerprint', a.review_fingerprint,
             'init_code_hash', a.init_code_hash,
             'client_request_id', a.client_request_id,
             'fee_model', a.fee_model,
             'gas_estimate_text', a.gas_estimate_text,
             'gas_limit_text', a.gas_limit_text,
             'observed_fee_per_gas_wei_text', a.observed_fee_per_gas_wei_text,
             'max_fee_per_gas_wei_text', a.max_fee_per_gas_wei_text,
             'max_priority_fee_per_gas_wei_text', a.max_priority_fee_per_gas_wei_text,
             'estimated_cost_wei_text', a.estimated_cost_wei_text,
             'max_total_cost_wei_text', a.max_total_cost_wei_text,
             'tx_value_wei', a.tx_value_wei,
             'ttl_seconds', a.ttl_seconds,
             'status', a.status,
             'effective_status', CASE
               WHEN a.status = 'ISSUED' AND a.expires_at <= v_now THEN 'EFFECTIVELY_EXPIRED'
               ELSE a.status
             END,
             'issued_at', a.issued_at,
             'expires_at', a.expires_at,
             'claimed_at', a.claimed_at,
             'consumed_at', a.consumed_at,
             'consumed_tx_hash', a.consumed_tx_hash,
             'invalidated_at', a.invalidated_at,
             'invalidated_reason', a.invalidated_reason
           ) AS x
    FROM public.launch_chain_production_presign_authorizations a
    WHERE a.deployment_id = d.id
  ) s;

  SELECT coalesce(jsonb_agg(jsonb_build_object(
           'id', i.id,
           'authorization_id', i.authorization_id,
           'canary_permit_id', i.canary_permit_id,
           'deployment_id', i.deployment_id,
           'workspace_id', i.workspace_id,
           'launch_id', i.launch_id,
           'operator_user_id', i.operator_user_id,
           'chain_id', i.chain_id,
           'network_environment', i.network_environment,
           'review_fingerprint', i.review_fingerprint,
           'init_code_hash', i.init_code_hash,
           'control_revision', i.control_revision,
           'claimed_at', i.claimed_at,
           'authorization_expires_at', i.authorization_expires_at,
           'issued_at', i.issued_at,
           'send_window_expires_at', i.send_window_expires_at
         ) ORDER BY i.issued_at), '[]'::jsonb),
         count(*)::int
    INTO v_issuances, v_issuance_count
  FROM public.launch_chain_production_send_window_issuances i
  WHERE i.deployment_id = d.id;

  SELECT coalesce(jsonb_agg(y ORDER BY y_issued_at), '[]'::jsonb),
         count(*) FILTER (WHERE y_effective = 'ACTIVE')::int
    INTO v_permits, v_active_permit_count
  FROM (
    SELECT p.issued_at AS y_issued_at,
           CASE
             WHEN EXISTS (
               SELECT 1 FROM public.launch_chain_production_send_window_issuances i2
                WHERE i2.canary_permit_id = p.id
             ) THEN 'CONSUMED'
             WHEN p.expires_at <= v_now THEN 'EXPIRED'
             WHEN p.control_revision IS DISTINCT FROM c.revision THEN 'STALE_CONTROL_REVISION'
             WHEN NOT v_runtime_active THEN 'RUNTIME_NOT_ACTIVE'
             ELSE 'ACTIVE'
           END AS y_effective,
           jsonb_build_object(
             'id', p.id,
             'authorization_id', p.authorization_id,
             'deployment_id', p.deployment_id,
             'workspace_id', p.workspace_id,
             'launch_id', p.launch_id,
             'operator_user_id', p.operator_user_id,
             'chain_id', p.chain_id,
             'network_environment', p.network_environment,
             'deployer_address', p.deployer_address,
             'review_fingerprint', p.review_fingerprint,
             'init_code_hash', p.init_code_hash,
             'control_revision', p.control_revision,
             'authorization_expires_at', p.authorization_expires_at,
             'issued_at', p.issued_at,
             'expires_at', p.expires_at,
             'reason', p.reason,
             'effective_status', CASE
               WHEN EXISTS (
                 SELECT 1 FROM public.launch_chain_production_send_window_issuances i3
                  WHERE i3.canary_permit_id = p.id
               ) THEN 'CONSUMED'
               WHEN p.expires_at <= v_now THEN 'EXPIRED'
               WHEN p.control_revision IS DISTINCT FROM c.revision THEN 'STALE_CONTROL_REVISION'
               WHEN NOT v_runtime_active THEN 'RUNTIME_NOT_ACTIVE'
               ELSE 'ACTIVE'
             END
           ) AS y
    FROM public.launch_chain_production_canary_permits p
    WHERE p.deployment_id = d.id
  ) t;

  SELECT jsonb_build_object(
           'control_key', c.control_key,
           'execution_enabled', c.execution_enabled,
           'emergency_stop_engaged', c.emergency_stop_engaged,
           'revision', c.revision,
           'reason', c.reason,
           'updated_by', c.updated_by,
           'updated_at', c.updated_at
         )
    INTO v_control
  FROM public.launch_chain_production_execution_controls c2
  WHERE c2.control_key = 'ROBINHOOD_MAINNET_DEPLOYMENT';

  SELECT coalesce(jsonb_agg(jsonb_build_object(
           'id', e.id,
           'revision', e.revision,
           'previous_execution_enabled', e.previous_execution_enabled,
           'new_execution_enabled', e.new_execution_enabled,
           'previous_emergency_stop_engaged', e.previous_emergency_stop_engaged,
           'new_emergency_stop_engaged', e.new_emergency_stop_engaged,
           'reason', e.reason,
           'changed_by', e.changed_by,
           'created_at', e.created_at
         ) ORDER BY e.revision), '[]'::jsonb)
    INTO v_control_events
  FROM public.launch_chain_production_execution_control_events e;

  IF d.tx_hash IS NOT NULL OR d.status <> 'DRAFT' THEN
    v_classification := 'TX_HASH_RECORDED_OR_LATER';
  ELSIF v_issuance_count > 0 THEN
    v_classification := 'SEND_WINDOW_ISSUED_NO_TX_HASH';
  ELSIF v_claimed_count > 0 THEN
    v_classification := 'CLAIMED_NO_SEND_WINDOW_ISSUED';
  ELSIF v_auth_count = 0 THEN
    v_classification := 'NO_AUTHORIZATION';
  ELSIF v_open_issued_count > 0 THEN
    v_classification := CASE
      WHEN v_active_permit_count > 0 THEN 'AUTHORIZATION_ISSUED_UNCLAIMED_PERMIT_ACTIVE'
      ELSE 'AUTHORIZATION_ISSUED_UNCLAIMED_NO_ACTIVE_PERMIT'
    END;
  ELSE
    v_classification := 'AUTHORIZATION_EFFECTIVELY_EXPIRED_OR_CLOSED';
  END IF;

  RETURN jsonb_build_object(
    'snapshot_at', v_now,
    'classification', v_classification,
    'deployment', jsonb_build_object(
      'id', d.id,
      'workspace_id', d.workspace_id,
      'launch_id', d.launch_id,
      'attempt_number', d.attempt_number,
      'client_request_id', d.client_request_id,
      'chain_id', d.chain_id,
      'network_environment', d.network_environment,
      'deployment_kind', d.deployment_kind,
      'artifact_id', d.artifact_id,
      'deployer_address', d.deployer_address,
      'status', d.status,
      'tx_hash', d.tx_hash,
      'contract_address', d.contract_address,
      'review_fingerprint', d.review_fingerprint,
      'init_code_hash', d.init_code_hash,
      'token_name', d.token_name,
      'token_symbol', d.token_symbol,
      'token_decimals', d.token_decimals,
      'token_total_supply_text', d.token_total_supply_text,
      'token_recipient', d.token_recipient,
      'verified_token_name', d.verified_token_name,
      'verified_token_symbol', d.verified_token_symbol,
      'verified_token_decimals', d.verified_token_decimals,
      'verified_total_supply_text', d.verified_total_supply_text,
      'verified_recipient_balance_text', d.verified_recipient_balance_text,
      'block_number', d.block_number,
      'block_hash', d.block_hash,
      'observed_confirmations_diagnostic', d.confirmations,
      'finality_state', d.finality_state,
      'finalized_at', d.finalized_at,
      'finalized_block_number', d.finalized_block_number,
      'finalized_head_block_number', d.finalized_head_block_number,
      'finalized_block_hash_confirmed', d.finalized_block_hash_confirmed,
      'finality_provider_kind', d.finality_provider_kind,
      'finality_last_checked_at', d.finality_last_checked_at,
      'finality_notice', d.finality_notice,
      'submitted_at', d.submitted_at,
      'last_checked_at', d.last_checked_at,
      'verified_at', d.verified_at,
      'failure_code', d.failure_code,
      'failure_detail', d.failure_detail,
      'created_by', d.created_by,
      'created_at', d.created_at,
      'updated_at', d.updated_at
    ),
    'presign_authorizations', v_presigns,
    'canary_permits', v_permits,
    'send_window_issuances', v_issuances,
    'execution_control', v_control,
    'effective_execution_control', v_effective_control,
    'execution_control_events', v_control_events
  );
END;
$function$;

REVOKE ALL ON FUNCTION public.get_launch_chain_production_reconciliation_snapshot(uuid, uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.get_launch_chain_production_reconciliation_snapshot(uuid, uuid) FROM anon;
REVOKE ALL ON FUNCTION public.get_launch_chain_production_reconciliation_snapshot(uuid, uuid) FROM authenticated;
GRANT EXECUTE ON FUNCTION public.get_launch_chain_production_reconciliation_snapshot(uuid, uuid) TO service_role;