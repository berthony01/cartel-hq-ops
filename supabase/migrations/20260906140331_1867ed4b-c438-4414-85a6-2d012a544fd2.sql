CREATE TABLE public.launch_chain_production_presign_authorizations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  deployment_id uuid NOT NULL REFERENCES public.launch_chain_deployments(id) ON DELETE RESTRICT,
  workspace_id uuid NOT NULL,
  launch_id uuid NOT NULL,
  chain_id bigint NOT NULL,
  network_environment text NOT NULL,
  deployer_address text NOT NULL,
  operator_user_id uuid NOT NULL,
  review_fingerprint text NOT NULL,
  init_code_hash text NOT NULL,
  gas_estimate_text text NOT NULL,
  gas_limit_text text NOT NULL,
  fee_model text NOT NULL,
  observed_fee_per_gas_wei_text text NOT NULL,
  max_fee_per_gas_wei_text text NOT NULL,
  max_priority_fee_per_gas_wei_text text,
  estimated_cost_wei_text text NOT NULL,
  max_total_cost_wei_text text NOT NULL,
  tx_value_wei text NOT NULL DEFAULT '0',
  client_request_id text NOT NULL,
  ttl_seconds integer NOT NULL,
  issued_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz NOT NULL,
  status text NOT NULL DEFAULT 'ISSUED',
  claimed_at timestamptz,
  invalidated_at timestamptz,
  invalidated_reason text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT lcppa_chain_chk CHECK (chain_id = 4663),
  CONSTRAINT lcppa_env_chk CHECK (network_environment = 'PRODUCTION'),
  CONSTRAINT lcppa_deployer_chk CHECK (deployer_address ~ '^0x[0-9a-f]{40}$' AND deployer_address <> '0x0000000000000000000000000000000000000000'),
  CONSTRAINT lcppa_review_fp_chk CHECK (review_fingerprint ~ '^0x[0-9a-f]{64}$'),
  CONSTRAINT lcppa_init_code_hash_chk CHECK (init_code_hash ~ '^0x[0-9a-f]{64}$'),
  CONSTRAINT lcppa_gas_estimate_chk CHECK (gas_estimate_text ~ '^(0|[1-9][0-9]{0,77})$'),
  CONSTRAINT lcppa_gas_limit_chk CHECK (gas_limit_text ~ '^(0|[1-9][0-9]{0,77})$'),
  CONSTRAINT lcppa_fee_model_chk CHECK (fee_model IN ('EIP1559','LEGACY')),
  CONSTRAINT lcppa_observed_fee_chk CHECK (observed_fee_per_gas_wei_text ~ '^(0|[1-9][0-9]{0,77})$'),
  CONSTRAINT lcppa_max_fee_chk CHECK (max_fee_per_gas_wei_text ~ '^(0|[1-9][0-9]{0,77})$'),
  CONSTRAINT lcppa_max_priority_chk CHECK (max_priority_fee_per_gas_wei_text IS NULL OR max_priority_fee_per_gas_wei_text ~ '^(0|[1-9][0-9]{0,77})$'),
  CONSTRAINT lcppa_estimated_cost_chk CHECK (estimated_cost_wei_text ~ '^(0|[1-9][0-9]{0,77})$'),
  CONSTRAINT lcppa_max_total_cost_chk CHECK (max_total_cost_wei_text ~ '^(0|[1-9][0-9]{0,77})$'),
  CONSTRAINT lcppa_tx_value_chk CHECK (tx_value_wei = '0'),
  CONSTRAINT lcppa_client_request_id_chk CHECK (char_length(client_request_id) BETWEEN 8 AND 128),
  CONSTRAINT lcppa_ttl_chk CHECK (ttl_seconds BETWEEN 30 AND 300),
  CONSTRAINT lcppa_expiry_window_chk CHECK (expires_at > issued_at AND expires_at <= issued_at + interval '5 minutes' AND expires_at >= issued_at + interval '30 seconds'),
  CONSTRAINT lcppa_status_chk CHECK (status IN ('ISSUED','CLAIMED','INVALIDATED','EXPIRED')),
  CONSTRAINT lcppa_claimed_at_chk CHECK ((status = 'CLAIMED' AND claimed_at IS NOT NULL) OR (status <> 'CLAIMED' AND claimed_at IS NULL)),
  CONSTRAINT lcppa_invalidated_at_chk CHECK ((status = 'INVALIDATED' AND invalidated_at IS NOT NULL) OR (status <> 'INVALIDATED' AND invalidated_at IS NULL)),
  CONSTRAINT lcppa_invalidated_reason_chk CHECK (invalidated_reason IS NULL OR char_length(invalidated_reason) <= 2000),
  CONSTRAINT lcppa_fee_model_priority_chk CHECK (
    (fee_model = 'EIP1559' AND max_priority_fee_per_gas_wei_text IS NOT NULL)
    OR (fee_model = 'LEGACY' AND max_priority_fee_per_gas_wei_text IS NULL)
  )
);

CREATE UNIQUE INDEX lcppa_deployment_request_uidx
  ON public.launch_chain_production_presign_authorizations (deployment_id, client_request_id);

CREATE UNIQUE INDEX lcppa_deployment_unresolved_uidx
  ON public.launch_chain_production_presign_authorizations (deployment_id)
  WHERE status IN ('ISSUED','CLAIMED');

REVOKE ALL ON public.launch_chain_production_presign_authorizations FROM PUBLIC;
REVOKE ALL ON public.launch_chain_production_presign_authorizations FROM anon;
REVOKE ALL ON public.launch_chain_production_presign_authorizations FROM authenticated;
REVOKE ALL ON public.launch_chain_production_presign_authorizations FROM service_role;

ALTER TABLE public.launch_chain_production_presign_authorizations ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.launch_chain_production_presign_authorizations FORCE ROW LEVEL SECURITY;

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
    IF NEW.status <> 'ISSUED' OR NEW.claimed_at IS NOT NULL OR NEW.invalidated_at IS NOT NULL OR NEW.invalidated_reason IS NOT NULL THEN
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

    IF OLD.status <> 'ISSUED' THEN
      RAISE EXCEPTION 'Authorization is frozen' USING ERRCODE = '22023';
    END IF;
    IF NEW.status NOT IN ('CLAIMED','INVALIDATED','EXPIRED') THEN
      RAISE EXCEPTION 'Illegal authorization transition' USING ERRCODE = '22023';
    END IF;
    IF NEW.status = 'CLAIMED' AND NEW.claimed_at IS NULL THEN
      RAISE EXCEPTION 'Claim requires claimed_at' USING ERRCODE = '22023';
    END IF;
    IF NEW.status = 'INVALIDATED' AND NEW.invalidated_at IS NULL THEN
      RAISE EXCEPTION 'Invalidation requires invalidated_at' USING ERRCODE = '22023';
    END IF;
    IF NEW.status = 'EXPIRED' AND (NEW.claimed_at IS NOT NULL OR NEW.invalidated_at IS NOT NULL) THEN
      RAISE EXCEPTION 'Expired authorization must not carry claim or invalidation evidence' USING ERRCODE = '22023';
    END IF;
    NEW.updated_at := now();
    RETURN NEW;
  END IF;

  RAISE EXCEPTION 'Unsupported operation' USING ERRCODE = '22023';
END;
$function$;

CREATE TRIGGER trg_launch_chain_production_presign
BEFORE INSERT OR UPDATE ON public.launch_chain_production_presign_authorizations
FOR EACH ROW EXECUTE FUNCTION public.enforce_launch_chain_production_presign();

CREATE OR REPLACE FUNCTION public.issue_launch_chain_production_presign_authorization(
  _deployment_id uuid,
  _operator_user_id uuid,
  _client_request_id text,
  _gas_estimate_text text,
  _gas_limit_text text,
  _fee_model text,
  _observed_fee_per_gas_wei_text text,
  _max_fee_per_gas_wei_text text,
  _max_priority_fee_per_gas_wei_text text,
  _estimated_cost_wei_text text,
  _max_total_cost_wei_text text,
  _ttl_seconds integer DEFAULT 60
)
RETURNS public.launch_chain_production_presign_authorizations
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  d public.launch_chain_deployments%ROWTYPE;
  v_req text := btrim(coalesce(_client_request_id, ''));
  v_fee_model text := upper(btrim(coalesce(_fee_model, '')));
  v_prio text := nullif(btrim(coalesce(_max_priority_fee_per_gas_wei_text, '')), '');
  v_ttl integer := coalesce(_ttl_seconds, 60);
  v_row public.launch_chain_production_presign_authorizations%ROWTYPE;
  v_dec text := '^(0|[1-9][0-9]{0,77})$';
BEGIN
  IF _deployment_id IS NULL OR _operator_user_id IS NULL THEN
    RAISE EXCEPTION 'Deployment and operator are required' USING ERRCODE = '22023';
  END IF;
  IF char_length(v_req) < 8 OR char_length(v_req) > 128 THEN
    RAISE EXCEPTION 'Invalid client request id' USING ERRCODE = '22023';
  END IF;
  IF v_ttl < 30 OR v_ttl > 300 THEN
    RAISE EXCEPTION 'Invalid ttl_seconds' USING ERRCODE = '22023';
  END IF;
  IF v_fee_model NOT IN ('EIP1559','LEGACY') THEN
    RAISE EXCEPTION 'Invalid fee model' USING ERRCODE = '22023';
  END IF;
  IF coalesce(_gas_estimate_text,'') !~ v_dec
     OR coalesce(_gas_limit_text,'') !~ v_dec
     OR coalesce(_observed_fee_per_gas_wei_text,'') !~ v_dec
     OR coalesce(_max_fee_per_gas_wei_text,'') !~ v_dec
     OR coalesce(_estimated_cost_wei_text,'') !~ v_dec
     OR coalesce(_max_total_cost_wei_text,'') !~ v_dec
     OR (v_prio IS NOT NULL AND v_prio !~ v_dec) THEN
    RAISE EXCEPTION 'Invalid unsigned decimal economic value' USING ERRCODE = '22023';
  END IF;
  IF v_fee_model = 'EIP1559' AND v_prio IS NULL THEN
    RAISE EXCEPTION 'EIP1559 requires max priority fee' USING ERRCODE = '22023';
  END IF;
  IF v_fee_model = 'LEGACY' AND v_prio IS NOT NULL THEN
    RAISE EXCEPTION 'LEGACY must not carry max priority fee' USING ERRCODE = '22023';
  END IF;

  IF _gas_estimate_text::numeric <= 0 THEN
    RAISE EXCEPTION 'Gas estimate must be positive' USING ERRCODE = '22023';
  END IF;
  IF _gas_limit_text::numeric < _gas_estimate_text::numeric THEN
    RAISE EXCEPTION 'Gas limit must cover gas estimate' USING ERRCODE = '22023';
  END IF;
  IF _max_fee_per_gas_wei_text::numeric < _observed_fee_per_gas_wei_text::numeric THEN
    RAISE EXCEPTION 'Max fee must cover observed fee' USING ERRCODE = '22023';
  END IF;
  IF v_prio IS NOT NULL AND v_prio::numeric > _max_fee_per_gas_wei_text::numeric THEN
    RAISE EXCEPTION 'Max priority fee must not exceed max fee' USING ERRCODE = '22023';
  END IF;
  IF _max_total_cost_wei_text::numeric < _estimated_cost_wei_text::numeric THEN
    RAISE EXCEPTION 'Max total cost must cover estimated cost' USING ERRCODE = '22023';
  END IF;
  IF _max_total_cost_wei_text::numeric < (_gas_limit_text::numeric * _max_fee_per_gas_wei_text::numeric) THEN
    RAISE EXCEPTION 'Max total cost must cover gas limit at max fee' USING ERRCODE = '22023';
  END IF;

  SELECT * INTO d FROM public.launch_chain_deployments WHERE id = _deployment_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Deployment not found' USING ERRCODE = '22023';
  END IF;
  IF d.chain_id <> 4663
     OR d.network_environment <> 'PRODUCTION'
     OR d.deployment_kind <> 'FIXED_SUPPLY_ERC20'
     OR d.artifact_id IS DISTINCT FROM 'cartel-fixed-erc20-v1'
     OR d.status <> 'DRAFT'
     OR d.tx_hash IS NOT NULL
     OR d.review_fingerprint IS NULL
     OR d.init_code_hash IS NULL THEN
    RAISE EXCEPTION 'Deployment not eligible for production pre-sign authorization' USING ERRCODE = '22023';
  END IF;

  UPDATE public.launch_chain_production_presign_authorizations a
     SET status = 'EXPIRED'
   WHERE a.deployment_id = _deployment_id
     AND a.status = 'ISSUED'
     AND a.expires_at <= now();

  SELECT * INTO v_row
    FROM public.launch_chain_production_presign_authorizations a
   WHERE a.deployment_id = _deployment_id
     AND a.client_request_id = v_req
   FOR UPDATE;

  IF FOUND THEN
    IF v_row.operator_user_id <> _operator_user_id
       OR v_row.gas_estimate_text <> _gas_estimate_text
       OR v_row.gas_limit_text <> _gas_limit_text
       OR v_row.fee_model <> v_fee_model
       OR v_row.observed_fee_per_gas_wei_text <> _observed_fee_per_gas_wei_text
       OR v_row.max_fee_per_gas_wei_text <> _max_fee_per_gas_wei_text
       OR v_row.max_priority_fee_per_gas_wei_text IS DISTINCT FROM v_prio
       OR v_row.estimated_cost_wei_text <> _estimated_cost_wei_text
       OR v_row.max_total_cost_wei_text <> _max_total_cost_wei_text
       OR v_row.ttl_seconds <> v_ttl
       OR v_row.review_fingerprint <> d.review_fingerprint
       OR v_row.init_code_hash <> d.init_code_hash
       OR v_row.deployer_address <> lower(d.deployer_address) THEN
      RAISE EXCEPTION 'Conflicting pre-sign authorization for this request id' USING ERRCODE = '22023';
    END IF;
    RETURN v_row;
  END IF;

  BEGIN
    INSERT INTO public.launch_chain_production_presign_authorizations (
      deployment_id, workspace_id, launch_id, chain_id, network_environment,
      deployer_address, operator_user_id, review_fingerprint, init_code_hash,
      gas_estimate_text, gas_limit_text, fee_model,
      observed_fee_per_gas_wei_text, max_fee_per_gas_wei_text, max_priority_fee_per_gas_wei_text,
      estimated_cost_wei_text, max_total_cost_wei_text, tx_value_wei,
      client_request_id, ttl_seconds, issued_at, expires_at, status
    ) VALUES (
      d.id, d.workspace_id, d.launch_id, 4663, 'PRODUCTION',
      lower(d.deployer_address), _operator_user_id, d.review_fingerprint, d.init_code_hash,
      _gas_estimate_text, _gas_limit_text, v_fee_model,
      _observed_fee_per_gas_wei_text, _max_fee_per_gas_wei_text, v_prio,
      _estimated_cost_wei_text, _max_total_cost_wei_text, '0',
      v_req, v_ttl, now(), now() + make_interval(secs => v_ttl), 'ISSUED'
    )
    RETURNING * INTO v_row;
  EXCEPTION WHEN unique_violation THEN
    SELECT * INTO v_row
      FROM public.launch_chain_production_presign_authorizations a
     WHERE a.deployment_id = _deployment_id
       AND a.client_request_id = v_req
     FOR UPDATE;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'An unresolved pre-sign authorization already exists for this deployment' USING ERRCODE = '22023';
    END IF;
    IF v_row.operator_user_id <> _operator_user_id
       OR v_row.gas_estimate_text <> _gas_estimate_text
       OR v_row.gas_limit_text <> _gas_limit_text
       OR v_row.fee_model <> v_fee_model
       OR v_row.observed_fee_per_gas_wei_text <> _observed_fee_per_gas_wei_text
       OR v_row.max_fee_per_gas_wei_text <> _max_fee_per_gas_wei_text
       OR v_row.max_priority_fee_per_gas_wei_text IS DISTINCT FROM v_prio
       OR v_row.estimated_cost_wei_text <> _estimated_cost_wei_text
       OR v_row.max_total_cost_wei_text <> _max_total_cost_wei_text
       OR v_row.ttl_seconds <> v_ttl THEN
      RAISE EXCEPTION 'Conflicting pre-sign authorization for this request id' USING ERRCODE = '22023';
    END IF;
    RETURN v_row;
  END;

  RETURN v_row;
END;
$function$;

CREATE OR REPLACE FUNCTION public.claim_launch_chain_production_presign_authorization(
  _authorization_id uuid,
  _expected_review_fingerprint text,
  _expected_init_code_hash text
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

  PERFORM public.authorize_launch_chain_deployment(d.launch_id);

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
    RAISE EXCEPTION 'Deployment no longer eligible' USING ERRCODE = '22023';
  END IF;
  IF a.review_fingerprint IS DISTINCT FROM _expected_review_fingerprint
     OR a.init_code_hash IS DISTINCT FROM _expected_init_code_hash
     OR d.review_fingerprint IS DISTINCT FROM _expected_review_fingerprint
     OR d.init_code_hash IS DISTINCT FROM _expected_init_code_hash THEN
    RAISE EXCEPTION 'Authorization intent mismatch' USING ERRCODE = '22023';
  END IF;
  IF a.status <> 'ISSUED' OR a.expires_at <= now() THEN
    RAISE EXCEPTION 'Not authorized' USING ERRCODE = '42501';
  END IF;

  UPDATE public.launch_chain_production_presign_authorizations
     SET status = 'CLAIMED', claimed_at = now()
   WHERE id = a.id AND status = 'ISSUED'
  RETURNING * INTO a;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Not authorized' USING ERRCODE = '42501';
  END IF;

  RETURN a;
END;
$function$;

CREATE OR REPLACE FUNCTION public.invalidate_launch_chain_production_presign_authorization(
  _authorization_id uuid,
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

  PERFORM public.authorize_launch_chain_deployment(d.launch_id);

  SELECT * INTO a
    FROM public.launch_chain_production_presign_authorizations
   WHERE id = _authorization_id
   FOR UPDATE;
  IF NOT FOUND OR a.deployment_id <> d.id THEN
    RAISE EXCEPTION 'Authorization not found' USING ERRCODE = '22023';
  END IF;

  IF a.status = 'INVALIDATED' THEN
    RETURN a;
  END IF;
  IF a.status <> 'ISSUED' THEN
    RAISE EXCEPTION 'Authorization cannot be invalidated in state %', a.status USING ERRCODE = '22023';
  END IF;

  UPDATE public.launch_chain_production_presign_authorizations
     SET status = 'INVALIDATED',
         invalidated_at = now(),
         invalidated_reason = left(nullif(btrim(coalesce(_reason, '')), ''), 2000)
   WHERE id = a.id AND status = 'ISSUED'
  RETURNING * INTO a;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Not authorized' USING ERRCODE = '42501';
  END IF;

  RETURN a;
END;
$function$;

CREATE OR REPLACE FUNCTION public.get_launch_chain_production_presign_authorization(
  _deployment_id uuid
)
RETURNS public.launch_chain_production_presign_authorizations
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  d public.launch_chain_deployments%ROWTYPE;
  a public.launch_chain_production_presign_authorizations%ROWTYPE;
BEGIN
  SELECT * INTO d FROM public.launch_chain_deployments WHERE id = _deployment_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Deployment not found' USING ERRCODE = '22023';
  END IF;

  PERFORM public.authorize_launch_chain_deployment(d.launch_id);

  SELECT * INTO a
    FROM public.launch_chain_production_presign_authorizations
   WHERE deployment_id = _deployment_id
   ORDER BY issued_at DESC
   LIMIT 1;

  RETURN a;
END;
$function$;

REVOKE ALL ON FUNCTION public.issue_launch_chain_production_presign_authorization(uuid, uuid, text, text, text, text, text, text, text, text, text, integer) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.issue_launch_chain_production_presign_authorization(uuid, uuid, text, text, text, text, text, text, text, text, text, integer) FROM anon;
REVOKE ALL ON FUNCTION public.issue_launch_chain_production_presign_authorization(uuid, uuid, text, text, text, text, text, text, text, text, text, integer) FROM authenticated;
GRANT EXECUTE ON FUNCTION public.issue_launch_chain_production_presign_authorization(uuid, uuid, text, text, text, text, text, text, text, text, text, integer) TO service_role;

REVOKE ALL ON FUNCTION public.claim_launch_chain_production_presign_authorization(uuid, text, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.claim_launch_chain_production_presign_authorization(uuid, text, text) FROM anon;
GRANT EXECUTE ON FUNCTION public.claim_launch_chain_production_presign_authorization(uuid, text, text) TO authenticated;

REVOKE ALL ON FUNCTION public.invalidate_launch_chain_production_presign_authorization(uuid, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.invalidate_launch_chain_production_presign_authorization(uuid, text) FROM anon;
GRANT EXECUTE ON FUNCTION public.invalidate_launch_chain_production_presign_authorization(uuid, text) TO authenticated;

REVOKE ALL ON FUNCTION public.get_launch_chain_production_presign_authorization(uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.get_launch_chain_production_presign_authorization(uuid) FROM anon;
GRANT EXECUTE ON FUNCTION public.get_launch_chain_production_presign_authorization(uuid) TO authenticated;