-- P3C-C1: production handoff database safety boundary

ALTER TABLE public.launch_chain_production_presign_authorizations
  ADD COLUMN consumed_at timestamptz,
  ADD COLUMN consumed_tx_hash text;

ALTER TABLE public.launch_chain_production_presign_authorizations
  DROP CONSTRAINT lcppa_status_chk,
  DROP CONSTRAINT lcppa_claimed_at_chk,
  DROP CONSTRAINT lcppa_invalidated_at_chk;

ALTER TABLE public.launch_chain_production_presign_authorizations
  ADD CONSTRAINT lcppa_status_chk
    CHECK (status = ANY (ARRAY['ISSUED'::text,'CLAIMED'::text,'INVALIDATED'::text,'EXPIRED'::text,'CONSUMED'::text])),
  ADD CONSTRAINT lcppa_consumed_tx_hash_chk
    CHECK (consumed_tx_hash IS NULL OR consumed_tx_hash ~ '^0x[0-9a-f]{64}$'),
  ADD CONSTRAINT lcppa_consumed_order_chk
    CHECK (claimed_at IS NULL OR consumed_at IS NULL OR consumed_at >= claimed_at),
  ADD CONSTRAINT lcppa_state_evidence_chk CHECK (
    (status = 'ISSUED' AND claimed_at IS NULL AND invalidated_at IS NULL AND consumed_at IS NULL AND consumed_tx_hash IS NULL)
    OR (status = 'CLAIMED' AND claimed_at IS NOT NULL AND invalidated_at IS NULL AND consumed_at IS NULL AND consumed_tx_hash IS NULL)
    OR (status = 'EXPIRED' AND claimed_at IS NULL AND invalidated_at IS NULL AND consumed_at IS NULL AND consumed_tx_hash IS NULL)
    OR (status = 'INVALIDATED' AND invalidated_at IS NOT NULL AND consumed_at IS NULL AND consumed_tx_hash IS NULL)
    OR (status = 'CONSUMED' AND claimed_at IS NOT NULL AND invalidated_at IS NULL AND consumed_at IS NOT NULL AND consumed_tx_hash IS NOT NULL)
  );

-- B. internal trigger state machine
CREATE OR REPLACE FUNCTION public.enforce_launch_chain_production_presign()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  d public.launch_chain_deployments%ROWTYPE;
BEGIN
  IF TG_OP = 'INSERT' THEN
    SELECT * INTO d FROM public.launch_chain_deployments WHERE id = NEW.deployment_id FOR SHARE;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'Deployment not found' USING ERRCODE = '22023';
    END IF;
    IF d.chain_id <> 4663
       OR d.network_environment <> 'PRODUCTION'
       OR d.deployment_kind <> 'FIXED_SUPPLY_ERC20'
       OR d.artifact_id IS DISTINCT FROM 'cartel-fixed-erc20-v1'
       OR d.status <> 'DRAFT'
       OR d.tx_hash IS NOT NULL THEN
      RAISE EXCEPTION 'Deployment not eligible for production pre-sign authorization' USING ERRCODE = '22023';
    END IF;
    IF NEW.workspace_id <> d.workspace_id
       OR NEW.launch_id <> d.launch_id
       OR NEW.deployer_address <> lower(d.deployer_address)
       OR NEW.review_fingerprint IS DISTINCT FROM d.review_fingerprint
       OR NEW.init_code_hash IS DISTINCT FROM d.init_code_hash THEN
      RAISE EXCEPTION 'Authorization does not match deployment intent' USING ERRCODE = '22023';
    END IF;
    IF NOT public.is_platform_owner(NEW.operator_user_id)
       OR NOT public.is_workspace_operator(d.workspace_id, NEW.operator_user_id) THEN
      RAISE EXCEPTION 'Not authorized' USING ERRCODE = '42501';
    END IF;
    IF NEW.status <> 'ISSUED'
       OR NEW.claimed_at IS NOT NULL
       OR NEW.invalidated_at IS NOT NULL
       OR NEW.invalidated_reason IS NOT NULL
       OR NEW.consumed_at IS NOT NULL
       OR NEW.consumed_tx_hash IS NOT NULL THEN
      RAISE EXCEPTION 'Authorization must be created in ISSUED state' USING ERRCODE = '22023';
    END IF;
    RETURN NEW;
  END IF;

  IF TG_OP = 'UPDATE' THEN
    IF NEW.id <> OLD.id
       OR NEW.deployment_id <> OLD.deployment_id
       OR NEW.workspace_id <> OLD.workspace_id
       OR NEW.launch_id <> OLD.launch_id
       OR NEW.chain_id <> OLD.chain_id
       OR NEW.network_environment <> OLD.network_environment
       OR NEW.deployer_address <> OLD.deployer_address
       OR NEW.operator_user_id <> OLD.operator_user_id
       OR NEW.review_fingerprint <> OLD.review_fingerprint
       OR NEW.init_code_hash <> OLD.init_code_hash
       OR NEW.gas_estimate_text <> OLD.gas_estimate_text
       OR NEW.gas_limit_text <> OLD.gas_limit_text
       OR NEW.fee_model <> OLD.fee_model
       OR NEW.observed_fee_per_gas_wei_text <> OLD.observed_fee_per_gas_wei_text
       OR NEW.max_fee_per_gas_wei_text <> OLD.max_fee_per_gas_wei_text
       OR NEW.max_priority_fee_per_gas_wei_text IS DISTINCT FROM OLD.max_priority_fee_per_gas_wei_text
       OR NEW.estimated_cost_wei_text <> OLD.estimated_cost_wei_text
       OR NEW.max_total_cost_wei_text <> OLD.max_total_cost_wei_text
       OR NEW.tx_value_wei <> OLD.tx_value_wei
       OR NEW.client_request_id <> OLD.client_request_id
       OR NEW.ttl_seconds <> OLD.ttl_seconds
       OR NEW.issued_at <> OLD.issued_at
       OR NEW.expires_at <> OLD.expires_at
       OR NEW.created_at <> OLD.created_at THEN
      RAISE EXCEPTION 'Authorization binding fields are immutable' USING ERRCODE = '22023';
    END IF;

    IF OLD.status IN ('INVALIDATED','EXPIRED','CONSUMED') THEN
      RAISE EXCEPTION 'Authorization is frozen' USING ERRCODE = '22023';
    END IF;

    IF OLD.claimed_at IS NOT NULL AND NEW.claimed_at IS DISTINCT FROM OLD.claimed_at THEN
      RAISE EXCEPTION 'claimed_at is immutable' USING ERRCODE = '22023';
    END IF;

    IF OLD.status = 'ISSUED' THEN
      IF NEW.status NOT IN ('CLAIMED','INVALIDATED','EXPIRED') THEN
        RAISE EXCEPTION 'Illegal authorization transition' USING ERRCODE = '22023';
      END IF;
      IF NEW.consumed_at IS NOT NULL OR NEW.consumed_tx_hash IS NOT NULL THEN
        RAISE EXCEPTION 'Consumption evidence is not permitted for this transition' USING ERRCODE = '22023';
      END IF;
      IF NEW.status = 'CLAIMED' AND (NEW.claimed_at IS NULL OR NEW.invalidated_at IS NOT NULL) THEN
        RAISE EXCEPTION 'Claim requires claimed_at' USING ERRCODE = '22023';
      END IF;
      IF NEW.status = 'INVALIDATED' AND (NEW.invalidated_at IS NULL OR NEW.claimed_at IS NOT NULL) THEN
        RAISE EXCEPTION 'Invalidation requires invalidated_at' USING ERRCODE = '22023';
      END IF;
      IF NEW.status = 'EXPIRED' AND (NEW.claimed_at IS NOT NULL OR NEW.invalidated_at IS NOT NULL) THEN
        RAISE EXCEPTION 'Expired authorization must not carry claim or invalidation evidence' USING ERRCODE = '22023';
      END IF;
    ELSIF OLD.status = 'CLAIMED' THEN
      IF NEW.status NOT IN ('INVALIDATED','CONSUMED') THEN
        RAISE EXCEPTION 'Illegal authorization transition' USING ERRCODE = '22023';
      END IF;
      IF NEW.claimed_at IS NULL THEN
        RAISE EXCEPTION 'claimed_at must be preserved' USING ERRCODE = '22023';
      END IF;
      IF NEW.status = 'INVALIDATED' AND (NEW.invalidated_at IS NULL OR NEW.consumed_at IS NOT NULL OR NEW.consumed_tx_hash IS NOT NULL) THEN
        RAISE EXCEPTION 'Cancellation requires invalidated_at and no consumption evidence' USING ERRCODE = '22023';
      END IF;
      IF NEW.status = 'CONSUMED' AND (
           NEW.consumed_at IS NULL
           OR NEW.consumed_tx_hash IS NULL
           OR NEW.consumed_tx_hash !~ '^0x[0-9a-f]{64}$'
           OR NEW.invalidated_at IS NOT NULL) THEN
        RAISE EXCEPTION 'Consumption requires canonical consumed_tx_hash and no invalidation evidence' USING ERRCODE = '22023';
      END IF;
    ELSE
      RAISE EXCEPTION 'Illegal authorization transition' USING ERRCODE = '22023';
    END IF;

    NEW.updated_at := now();
    RETURN NEW;
  END IF;

  RAISE EXCEPTION 'Unsupported operation' USING ERRCODE = '22023';
END;
$function$;

REVOKE ALL ON FUNCTION public.enforce_launch_chain_production_presign() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.enforce_launch_chain_production_presign() FROM anon;
REVOKE ALL ON FUNCTION public.enforce_launch_chain_production_presign() FROM authenticated;
REVOKE ALL ON FUNCTION public.enforce_launch_chain_production_presign() FROM service_role;

-- C. service-role-only claim cancellation
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

-- D. service-role-only atomic production submission
CREATE OR REPLACE FUNCTION public.submit_launch_chain_production_deployment_tx(
  _deployment_id uuid,
  _authorization_id uuid,
  _operator_user_id uuid,
  _tx_hash text
)
 RETURNS public.launch_chain_deployments
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  d public.launch_chain_deployments%ROWTYPE;
  a public.launch_chain_production_presign_authorizations%ROWTYPE;
  v_hash text := lower(btrim(coalesce(_tx_hash, '')));
BEGIN
  IF _deployment_id IS NULL OR _authorization_id IS NULL OR _operator_user_id IS NULL THEN
    RAISE EXCEPTION 'Not authorized' USING ERRCODE = '42501';
  END IF;
  IF v_hash !~ '^0x[0-9a-f]{64}$' THEN
    RAISE EXCEPTION 'Invalid transaction hash' USING ERRCODE = '22023';
  END IF;

  -- deterministic lock order: deployment first, then authorization
  SELECT * INTO d FROM public.launch_chain_deployments WHERE id = _deployment_id FOR UPDATE;
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
     OR d.deployment_kind <> 'FIXED_SUPPLY_ERC20'
     OR d.artifact_id IS DISTINCT FROM 'cartel-fixed-erc20-v1' THEN
    RAISE EXCEPTION 'Deployment is not an eligible production attempt' USING ERRCODE = '22023';
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

  -- lost-response idempotency
  IF d.status = 'SUBMITTED'
     AND d.tx_hash = v_hash
     AND a.status = 'CONSUMED'
     AND a.consumed_tx_hash = v_hash
     AND a.claimed_at IS NOT NULL THEN
    RETURN d;
  END IF;

  IF d.status <> 'DRAFT'
     OR d.tx_hash IS NOT NULL
     OR a.status <> 'CLAIMED'
     OR a.claimed_at IS NULL
     OR a.consumed_at IS NOT NULL
     OR a.consumed_tx_hash IS NOT NULL THEN
    RAISE EXCEPTION 'Production submission state is not eligible' USING ERRCODE = '42501';
  END IF;

  UPDATE public.launch_chain_production_presign_authorizations
     SET status = 'CONSUMED',
         consumed_at = now(),
         consumed_tx_hash = v_hash
   WHERE id = a.id AND status = 'CLAIMED'
  RETURNING * INTO a;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Not authorized' USING ERRCODE = '42501';
  END IF;

  UPDATE public.launch_chain_deployments
     SET tx_hash = v_hash, status = 'SUBMITTED', submitted_at = now()
   WHERE id = d.id AND status = 'DRAFT' AND tx_hash IS NULL
  RETURNING * INTO d;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Not authorized' USING ERRCODE = '42501';
  END IF;

  RETURN d;
END;
$function$;

REVOKE ALL ON FUNCTION public.submit_launch_chain_production_deployment_tx(uuid, uuid, uuid, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.submit_launch_chain_production_deployment_tx(uuid, uuid, uuid, text) FROM anon;
REVOKE ALL ON FUNCTION public.submit_launch_chain_production_deployment_tx(uuid, uuid, uuid, text) FROM authenticated;
GRANT EXECUTE ON FUNCTION public.submit_launch_chain_production_deployment_tx(uuid, uuid, uuid, text) TO service_role;

-- E. generic submission refuses production
CREATE OR REPLACE FUNCTION public.submit_launch_chain_deployment_tx(_deployment_id uuid, _tx_hash text)
 RETURNS public.launch_chain_deployments
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_row public.launch_chain_deployments;
  v_hash text := lower(btrim(coalesce(_tx_hash, '')));
BEGIN
  SELECT * INTO v_row FROM public.launch_chain_deployments WHERE id = _deployment_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Not authorized' USING ERRCODE = '42501';
  END IF;
  PERFORM public.authorize_launch_chain_deployment(v_row.launch_id);

  IF v_row.chain_id = 4663 AND v_row.network_environment = 'PRODUCTION' THEN
    RAISE EXCEPTION 'Production deployments must use submit_launch_chain_production_deployment_tx' USING ERRCODE = '42501';
  END IF;

  IF v_hash !~ '^0x[0-9a-f]{64}$' THEN
    RAISE EXCEPTION 'Invalid transaction hash' USING ERRCODE = '22023';
  END IF;

  IF v_row.tx_hash = v_hash THEN
    RETURN v_row;
  END IF;
  IF v_row.status <> 'DRAFT' THEN
    RAISE EXCEPTION 'Attempt is no longer accepting a transaction' USING ERRCODE = '42501';
  END IF;

  UPDATE public.launch_chain_deployments
     SET tx_hash = v_hash, status = 'SUBMITTED', submitted_at = now()
   WHERE id = _deployment_id
   RETURNING * INTO v_row;

  RETURN v_row;
END;
$function$;