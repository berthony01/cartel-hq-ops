-- C8.3 HARDENING (additive only). Bytecode, artifact and C8.2 behaviour untouched.

-- A) Exact-decimal text mirrors of the numeric money columns. Generated
--    columns cannot be written independently and are NULL when the source is
--    NULL, so they are proof of the persisted numeric value, never a rival
--    source of truth.
ALTER TABLE public.launch_chain_deployments
  ADD COLUMN token_total_supply_text text
    GENERATED ALWAYS AS (token_total_supply::text) STORED,
  ADD COLUMN verified_total_supply_text text
    GENERATED ALWAYS AS (verified_total_supply::text) STORED,
  ADD COLUMN verified_recipient_balance_text text
    GENERATED ALWAYS AS (verified_recipient_balance::text) STORED;

COMMENT ON COLUMN public.launch_chain_deployments.token_total_supply_text IS
  'Exact decimal string mirror of token_total_supply. Application logic must read this, never the JSON number.';
COMMENT ON COLUMN public.launch_chain_deployments.verified_total_supply_text IS
  'Exact decimal string mirror of verified_total_supply.';
COMMENT ON COLUMN public.launch_chain_deployments.verified_recipient_balance_text IS
  'Exact decimal string mirror of verified_recipient_balance.';

-- B) Idempotency must never return a row whose immutable intent differs from
--    the incoming request. Same key + different intent is a hard conflict.
CREATE OR REPLACE FUNCTION public.create_launch_chain_token_deployment_attempt(
  _launch_id uuid,
  _client_request_id text,
  _deployer_address text,
  _token_name text,
  _token_symbol text,
  _token_total_supply numeric,
  _token_recipient text
)
RETURNS public.launch_chain_deployments
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_workspace uuid;
  v_request text := btrim(coalesce(_client_request_id, ''));
  v_deployer text := lower(btrim(coalesce(_deployer_address, '')));
  v_name text := btrim(coalesce(_token_name, ''));
  v_symbol text := upper(btrim(coalesce(_token_symbol, '')));
  v_recipient text := lower(btrim(coalesce(_token_recipient, '')));
  v_supply numeric := _token_total_supply;
  v_row public.launch_chain_deployments;
  v_next integer;
BEGIN
  v_workspace := public.authorize_launch_chain_deployment(_launch_id);

  IF char_length(v_request) < 8 OR char_length(v_request) > 128 THEN
    RAISE EXCEPTION 'Invalid request id' USING ERRCODE = '22023';
  END IF;
  IF v_deployer !~ '^0x[0-9a-f]{40}$' THEN
    RAISE EXCEPTION 'Invalid deployer address' USING ERRCODE = '22023';
  END IF;
  IF char_length(v_name) < 1 OR char_length(v_name) > 32 OR v_name !~ '^[ -~]+$' THEN
    RAISE EXCEPTION 'Invalid token name' USING ERRCODE = '22023';
  END IF;
  IF v_symbol !~ '^[A-Z0-9]{2,11}$' THEN
    RAISE EXCEPTION 'Invalid token symbol' USING ERRCODE = '22023';
  END IF;
  IF v_recipient !~ '^0x[0-9a-f]{40}$'
     OR v_recipient = '0x0000000000000000000000000000000000000000' THEN
    RAISE EXCEPTION 'Invalid token recipient' USING ERRCODE = '22023';
  END IF;
  IF v_supply IS NULL
     OR v_supply <> trunc(v_supply)
     OR v_supply < 1000000000000000000
     OR v_supply > 1000000000000000000000000000000
     OR (v_supply % 1000000000000000000) <> 0 THEN
    RAISE EXCEPTION 'Invalid token supply' USING ERRCODE = '22023';
  END IF;

  SELECT * INTO v_row FROM public.launch_chain_deployments
   WHERE launch_id = _launch_id AND client_request_id = v_request;
  IF FOUND THEN
    IF v_row.deployment_kind IS DISTINCT FROM 'FIXED_SUPPLY_ERC20'
       OR v_row.artifact_id IS DISTINCT FROM 'cartel-fixed-erc20-v1'
       OR v_row.deployer_address IS DISTINCT FROM v_deployer
       OR v_row.token_name IS DISTINCT FROM v_name
       OR v_row.token_symbol IS DISTINCT FROM v_symbol
       OR v_row.token_decimals IS DISTINCT FROM 18::smallint
       OR v_row.token_total_supply IS DISTINCT FROM v_supply
       OR v_row.token_recipient IS DISTINCT FROM v_recipient THEN
      RAISE EXCEPTION 'Idempotency key conflict' USING ERRCODE = '22023';
    END IF;
    RETURN v_row;
  END IF;

  SELECT coalesce(max(attempt_number), 0) + 1 INTO v_next
    FROM public.launch_chain_deployments WHERE launch_id = _launch_id;

  BEGIN
    INSERT INTO public.launch_chain_deployments (
      workspace_id, launch_id, attempt_number, client_request_id,
      chain_id, network_environment, deployer_address, status, created_by,
      deployment_kind, artifact_id, token_name, token_symbol, token_decimals,
      token_total_supply, token_recipient
    ) VALUES (
      v_workspace, _launch_id, v_next, v_request,
      46630, 'TESTNET', v_deployer, 'DRAFT', auth.uid(),
      'FIXED_SUPPLY_ERC20', 'cartel-fixed-erc20-v1', v_name, v_symbol, 18,
      v_supply, v_recipient
    )
    RETURNING * INTO v_row;
  EXCEPTION WHEN unique_violation THEN
    SELECT * INTO v_row FROM public.launch_chain_deployments
     WHERE launch_id = _launch_id AND client_request_id = v_request;
    IF NOT FOUND THEN RAISE; END IF;
    IF v_row.deployment_kind IS DISTINCT FROM 'FIXED_SUPPLY_ERC20'
       OR v_row.artifact_id IS DISTINCT FROM 'cartel-fixed-erc20-v1'
       OR v_row.deployer_address IS DISTINCT FROM v_deployer
       OR v_row.token_name IS DISTINCT FROM v_name
       OR v_row.token_symbol IS DISTINCT FROM v_symbol
       OR v_row.token_decimals IS DISTINCT FROM 18::smallint
       OR v_row.token_total_supply IS DISTINCT FROM v_supply
       OR v_row.token_recipient IS DISTINCT FROM v_recipient THEN
      RAISE EXCEPTION 'Idempotency key conflict' USING ERRCODE = '22023';
    END IF;
  END;

  RETURN v_row;
END;
$function$;

-- C) Confirmation barrier in the database as well as the verifier.
CREATE OR REPLACE FUNCTION public.apply_launch_chain_token_deployment_verification(
  _deployment_id uuid,
  _status text,
  _confirmations integer DEFAULT 0,
  _contract_address text DEFAULT NULL::text,
  _block_number bigint DEFAULT NULL::bigint,
  _block_hash text DEFAULT NULL::text,
  _failure_code text DEFAULT NULL::text,
  _failure_detail text DEFAULT NULL::text,
  _verified_token_name text DEFAULT NULL::text,
  _verified_token_symbol text DEFAULT NULL::text,
  _verified_token_decimals smallint DEFAULT NULL::smallint,
  _verified_total_supply numeric DEFAULT NULL::numeric,
  _verified_recipient_balance numeric DEFAULT NULL::numeric
)
RETURNS public.launch_chain_deployments
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_row public.launch_chain_deployments;
  v_status text := upper(btrim(coalesce(_status, '')));
  v_addr text := nullif(lower(btrim(coalesce(_contract_address, ''))), '');
  v_bhash text := nullif(lower(btrim(coalesce(_block_hash, ''))), '');
BEGIN
  IF v_status NOT IN ('PENDING', 'CONFIRMED', 'FAILED') THEN
    RAISE EXCEPTION 'Invalid verification status' USING ERRCODE = '22023';
  END IF;
  IF v_addr IS NOT NULL AND v_addr !~ '^0x[0-9a-f]{40}$' THEN
    RAISE EXCEPTION 'Invalid contract address' USING ERRCODE = '22023';
  END IF;
  IF v_bhash IS NOT NULL AND v_bhash !~ '^0x[0-9a-f]{64}$' THEN
    RAISE EXCEPTION 'Invalid block hash' USING ERRCODE = '22023';
  END IF;

  SELECT * INTO v_row FROM public.launch_chain_deployments
   WHERE id = _deployment_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Unknown deployment attempt' USING ERRCODE = '42704';
  END IF;
  IF v_row.deployment_kind <> 'FIXED_SUPPLY_ERC20' THEN
    RAISE EXCEPTION 'Wrong deployment kind' USING ERRCODE = '22023';
  END IF;

  IF v_status = 'CONFIRMED' THEN
    -- Defence in depth: the TypeScript verifier already enforces this
    -- threshold before calling, and the database refuses to record a
    -- confirmation below it under any circumstances.
    IF coalesce(_confirmations, 0) < 5 THEN
      RAISE EXCEPTION 'Confirmation requires at least 5 confirmations'
        USING ERRCODE = '22023';
    END IF;
    IF v_addr IS NULL
       OR _verified_token_name IS DISTINCT FROM v_row.token_name
       OR _verified_token_symbol IS DISTINCT FROM v_row.token_symbol
       OR _verified_token_decimals IS DISTINCT FROM 18::smallint
       OR _verified_total_supply IS DISTINCT FROM v_row.token_total_supply
       OR _verified_recipient_balance IS DISTINCT FROM v_row.token_total_supply THEN
      RAISE EXCEPTION 'Confirmation requires fully matching verified token metadata'
        USING ERRCODE = '22023';
    END IF;
  END IF;

  -- Terminal rows and un-broadcast drafts are a safe no-op, as in C8.2.
  IF v_row.status IN ('CONFIRMED', 'FAILED', 'ABANDONED') THEN
    RETURN v_row;
  END IF;
  IF v_row.status = 'DRAFT' THEN
    RETURN v_row;
  END IF;

  UPDATE public.launch_chain_deployments
     SET status = v_status,
         confirmations = greatest(coalesce(_confirmations, 0), 0),
         contract_address = v_addr,
         block_number = _block_number,
         block_hash = v_bhash,
         last_checked_at = now(),
         verified_at = CASE WHEN v_status = 'CONFIRMED' THEN now() ELSE NULL END,
         verified_token_name = CASE WHEN v_status = 'CONFIRMED' THEN _verified_token_name END,
         verified_token_symbol = CASE WHEN v_status = 'CONFIRMED' THEN _verified_token_symbol END,
         verified_token_decimals = CASE WHEN v_status = 'CONFIRMED' THEN _verified_token_decimals END,
         verified_total_supply = CASE WHEN v_status = 'CONFIRMED' THEN _verified_total_supply END,
         verified_recipient_balance = CASE WHEN v_status = 'CONFIRMED' THEN _verified_recipient_balance END,
         failure_code = CASE WHEN v_status = 'FAILED'
                             THEN left(btrim(coalesce(_failure_code, 'VERIFICATION_FAILED')), 64)
                             ELSE NULL END,
         failure_detail = CASE WHEN v_status = 'FAILED'
                               THEN left(btrim(coalesce(_failure_detail, '')), 2000)
                               ELSE NULL END
   WHERE id = _deployment_id
   RETURNING * INTO v_row;

  RETURN v_row;
END;
$function$;

-- Re-assert the exact existing privilege boundary (unchanged).
REVOKE ALL ON FUNCTION public.create_launch_chain_token_deployment_attempt(uuid, text, text, text, text, numeric, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.create_launch_chain_token_deployment_attempt(uuid, text, text, text, text, numeric, text) TO authenticated;

REVOKE ALL ON FUNCTION public.apply_launch_chain_token_deployment_verification(uuid, text, integer, text, bigint, text, text, text, text, text, smallint, numeric, numeric) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.apply_launch_chain_token_deployment_verification(uuid, text, integer, text, bigint, text, text, text, text, text, smallint, numeric, numeric) TO service_role;