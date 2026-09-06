-- P3C-D2: durable one-time final-send-window issuance evidence + read-only reconciliation snapshot.

CREATE TABLE public.launch_chain_production_send_window_issuances (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  authorization_id uuid NOT NULL UNIQUE
    REFERENCES public.launch_chain_production_presign_authorizations(id) ON DELETE RESTRICT,
  deployment_id uuid NOT NULL
    REFERENCES public.launch_chain_deployments(id) ON DELETE RESTRICT,
  workspace_id uuid NOT NULL,
  launch_id uuid NOT NULL,
  operator_user_id uuid NOT NULL,
  chain_id bigint NOT NULL
    CONSTRAINT lcpswi_chain_chk CHECK (chain_id = 4663),
  network_environment text NOT NULL
    CONSTRAINT lcpswi_env_chk CHECK (network_environment = 'PRODUCTION'),
  review_fingerprint text NOT NULL
    CONSTRAINT lcpswi_review_fp_chk CHECK (review_fingerprint ~ '^0x[0-9a-f]{64}$'),
  init_code_hash text NOT NULL
    CONSTRAINT lcpswi_init_code_hash_chk CHECK (init_code_hash ~ '^0x[0-9a-f]{64}$'),
  control_revision bigint NOT NULL
    CONSTRAINT lcpswi_control_revision_chk CHECK (control_revision >= 1),
  claimed_at timestamptz NOT NULL,
  authorization_expires_at timestamptz NOT NULL,
  issued_at timestamptz NOT NULL DEFAULT now(),
  send_window_expires_at timestamptz NOT NULL,
  CONSTRAINT lcpswi_window_order_chk CHECK (send_window_expires_at > claimed_at),
  CONSTRAINT lcpswi_window_bound_chk CHECK (send_window_expires_at <= authorization_expires_at)
);

CREATE INDEX lcpswi_deployment_idx
  ON public.launch_chain_production_send_window_issuances (deployment_id, issued_at);

REVOKE ALL ON TABLE public.launch_chain_production_send_window_issuances FROM PUBLIC;
REVOKE ALL ON TABLE public.launch_chain_production_send_window_issuances FROM anon;
REVOKE ALL ON TABLE public.launch_chain_production_send_window_issuances FROM authenticated;
REVOKE ALL ON TABLE public.launch_chain_production_send_window_issuances FROM service_role;

ALTER TABLE public.launch_chain_production_send_window_issuances ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.launch_chain_production_send_window_issuances FORCE ROW LEVEL SECURITY;

-- Append-only: issuance evidence can never be rewritten or erased.
CREATE OR REPLACE FUNCTION public.reject_launch_chain_production_send_window_issuance_mutation()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
BEGIN
  RAISE EXCEPTION 'Production send-window issuance evidence is append-only' USING ERRCODE = '42501';
END;
$function$;

REVOKE ALL ON FUNCTION public.reject_launch_chain_production_send_window_issuance_mutation() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.reject_launch_chain_production_send_window_issuance_mutation() FROM anon;
REVOKE ALL ON FUNCTION public.reject_launch_chain_production_send_window_issuance_mutation() FROM authenticated;
REVOKE ALL ON FUNCTION public.reject_launch_chain_production_send_window_issuance_mutation() FROM service_role;

CREATE TRIGGER lcpswi_reject_mutation
  BEFORE UPDATE OR DELETE ON public.launch_chain_production_send_window_issuances
  FOR EACH ROW EXECUTE FUNCTION public.reject_launch_chain_production_send_window_issuance_mutation();

-- ------------------------------------------------------------------
-- B. Atomic, service-role-only final-send-window issuance.
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
  v_deadline timestamptz;
  v_row public.launch_chain_production_send_window_issuances%ROWTYPE;
BEGIN
  IF _deployment_id IS NULL OR _authorization_id IS NULL OR _operator_user_id IS NULL THEN
    RAISE EXCEPTION 'Missing required identifiers' USING ERRCODE = '22023';
  END IF;

  -- 2. Deterministic lock order: deployment -> authorization -> control singleton.
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

  -- 3. Deployment eligibility.
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

  -- 4. Exact authorization/deployment binding.
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

  -- 5. Authority.
  IF NOT public.is_platform_owner(_operator_user_id)
     OR NOT public.is_workspace_operator(d.workspace_id, _operator_user_id) THEN
    RAISE EXCEPTION 'Not authorized' USING ERRCODE = '42501';
  END IF;

  -- 6. Exactly one acceptable authorization state.
  IF a.status <> 'CLAIMED'
     OR a.claimed_at IS NULL
     OR a.consumed_at IS NOT NULL
     OR a.consumed_tx_hash IS NOT NULL
     OR a.invalidated_at IS NOT NULL THEN
    RAISE EXCEPTION 'Authorization is not claimed and unconsumed' USING ERRCODE = '22023';
  END IF;

  -- 7. Runtime control re-checked HERE. Closes the TOCTOU with the app read.
  IF c.execution_enabled IS DISTINCT FROM true
     OR c.emergency_stop_engaged IS DISTINCT FROM false THEN
    RAISE EXCEPTION 'Production runtime execution is disabled' USING ERRCODE = '42501';
  END IF;

  -- 8/9. Database server time only. No mutation of the authorization.
  v_deadline := least(a.expires_at, a.claimed_at + interval '10 seconds');
  IF NOT (now() < a.expires_at) OR NOT (now() < v_deadline) THEN
    RAISE EXCEPTION 'Send window expired' USING ERRCODE = '22023';
  END IF;

  -- 10. Duplicate issuance is an explicit refusal, never idempotent success.
  IF EXISTS (
    SELECT 1 FROM public.launch_chain_production_send_window_issuances
    WHERE authorization_id = a.id
  ) THEN
    RAISE EXCEPTION 'Send window already issued for this authorization' USING ERRCODE = '23505';
  END IF;

  -- 11. Exactly one immutable issuance row.
  INSERT INTO public.launch_chain_production_send_window_issuances (
    authorization_id, deployment_id, workspace_id, launch_id, operator_user_id,
    chain_id, network_environment, review_fingerprint, init_code_hash,
    control_revision, claimed_at, authorization_expires_at, send_window_expires_at
  ) VALUES (
    a.id, d.id, d.workspace_id, d.launch_id, _operator_user_id,
    d.chain_id, d.network_environment, d.review_fingerprint, d.init_code_hash,
    c.revision, a.claimed_at, a.expires_at, v_deadline
  )
  RETURNING * INTO v_row;

  RETURN v_row;
END;
$function$;

REVOKE ALL ON FUNCTION public.authorize_launch_chain_production_send_window_issuance(uuid, uuid, uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.authorize_launch_chain_production_send_window_issuance(uuid, uuid, uuid) FROM anon;
REVOKE ALL ON FUNCTION public.authorize_launch_chain_production_send_window_issuance(uuid, uuid, uuid) FROM authenticated;
GRANT EXECUTE ON FUNCTION public.authorize_launch_chain_production_send_window_issuance(uuid, uuid, uuid) TO service_role;

-- ------------------------------------------------------------------
-- D. Read-only reconciliation snapshot.
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
  v_control jsonb;
  v_control_events jsonb;
  v_now timestamptz := now();
  v_classification text;
  v_auth_count integer;
  v_claimed_count integer;
  v_issuance_count integer;
  v_open_issued_count integer;
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
  FROM public.launch_chain_production_execution_controls c
  WHERE c.control_key = 'ROBINHOOD_MAINNET_DEPLOYMENT';

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
    v_classification := 'AUTHORIZATION_ISSUED_UNCLAIMED';
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
    'send_window_issuances', v_issuances,
    'execution_control', v_control,
    'execution_control_events', v_control_events
  );
END;
$function$;

REVOKE ALL ON FUNCTION public.get_launch_chain_production_reconciliation_snapshot(uuid, uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.get_launch_chain_production_reconciliation_snapshot(uuid, uuid) FROM anon;
REVOKE ALL ON FUNCTION public.get_launch_chain_production_reconciliation_snapshot(uuid, uuid) FROM authenticated;
GRANT EXECUTE ON FUNCTION public.get_launch_chain_production_reconciliation_snapshot(uuid, uuid) TO service_role;