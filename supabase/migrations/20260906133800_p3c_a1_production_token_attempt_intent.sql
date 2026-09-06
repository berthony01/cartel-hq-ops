-- P3C-A1: production fixed-supply ERC20 deployment intent binding.
-- Repository migration only. Adds review fingerprint / init code hash intent
-- columns, strict format + production-required CHECK constraints, extends the
-- existing intent immutability trigger function, and introduces a
-- production-specific attempt creation RPC. No transaction capability added.

-- 1. Intent binding columns (nullable; testnet rows remain valid).
ALTER TABLE public.launch_chain_deployments
  ADD COLUMN IF NOT EXISTS review_fingerprint text,
  ADD COLUMN IF NOT EXISTS init_code_hash text;

-- 2. Strict format + production-required constraints.
ALTER TABLE public.launch_chain_deployments
  DROP CONSTRAINT IF EXISTS launch_chain_deployments_review_fingerprint_format_chk;
ALTER TABLE public.launch_chain_deployments
  ADD CONSTRAINT launch_chain_deployments_review_fingerprint_format_chk
  CHECK (review_fingerprint IS NULL OR review_fingerprint ~ '^0x[0-9a-f]{64}$');

ALTER TABLE public.launch_chain_deployments
  DROP CONSTRAINT IF EXISTS launch_chain_deployments_init_code_hash_format_chk;
ALTER TABLE public.launch_chain_deployments
  ADD CONSTRAINT launch_chain_deployments_init_code_hash_format_chk
  CHECK (init_code_hash IS NULL OR init_code_hash ~ '^0x[0-9a-f]{64}$');

ALTER TABLE public.launch_chain_deployments
  DROP CONSTRAINT IF EXISTS launch_chain_deployments_production_token_intent_required_chk;
ALTER TABLE public.launch_chain_deployments
  ADD CONSTRAINT launch_chain_deployments_production_token_intent_required_chk
  CHECK (
    NOT (
      chain_id = 4663
      AND network_environment = 'PRODUCTION'
      AND deployment_kind = 'FIXED_SUPPLY_ERC20'
    )
    OR (review_fingerprint IS NOT NULL AND init_code_hash IS NOT NULL)
  );

-- 3. Extend intent immutability (all existing protections preserved).
CREATE OR REPLACE FUNCTION public.enforce_launch_chain_token_intent_immutable()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
BEGIN
  IF NEW.deployment_kind IS DISTINCT FROM OLD.deployment_kind
     OR NEW.artifact_id IS DISTINCT FROM OLD.artifact_id
     OR NEW.token_name IS DISTINCT FROM OLD.token_name
     OR NEW.token_symbol IS DISTINCT FROM OLD.token_symbol
     OR NEW.token_decimals IS DISTINCT FROM OLD.token_decimals
     OR NEW.token_total_supply IS DISTINCT FROM OLD.token_total_supply
     OR NEW.token_recipient IS DISTINCT FROM OLD.token_recipient
     OR NEW.review_fingerprint IS DISTINCT FROM OLD.review_fingerprint
     OR NEW.init_code_hash IS DISTINCT FROM OLD.init_code_hash THEN
    RAISE EXCEPTION 'Token deployment intent is immutable' USING ERRCODE = '42501';
  END IF;
  RETURN NEW;
END;
$function$;

-- 4. Production-specific attempt creation RPC (DRAFT row only; no broadcast).
CREATE OR REPLACE FUNCTION public.create_launch_chain_production_token_deployment_attempt(
  _launch_id uuid,
  _client_request_id text,
  _deployer_address text,
  _token_name text,
  _token_symbol text,
  _token_total_supply numeric,
  _token_recipient text,
  _review_fingerprint text,
  _init_code_hash text
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
  v_fingerprint text := lower(btrim(coalesce(_review_fingerprint, '')));
  v_init_hash text := lower(btrim(coalesce(_init_code_hash, '')));
  v_supply numeric := _token_total_supply;
  v_row public.launch_chain_deployments;
  v_next integer;
BEGIN
  v_workspace := public.authorize_launch_chain_deployment(_launch_id);

  IF char_length(v_request) < 8 OR char_length(v_request) > 128 THEN
    RAISE EXCEPTION 'Invalid request id' USING ERRCODE = '22023';
  END IF;
  IF v_deployer !~ '^0x[0-9a-f]{40}$'
     OR v_deployer = '0x0000000000000000000000000000000000000000' THEN
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
  IF v_fingerprint !~ '^0x[0-9a-f]{64}$' THEN
    RAISE EXCEPTION 'Invalid review fingerprint' USING ERRCODE = '22023';
  END IF;
  IF v_init_hash !~ '^0x[0-9a-f]{64}$' THEN
    RAISE EXCEPTION 'Invalid init code hash' USING ERRCODE = '22023';
  END IF;

  SELECT * INTO v_row FROM public.launch_chain_deployments
   WHERE launch_id = _launch_id AND client_request_id = v_request;
  IF FOUND THEN
    IF v_row.chain_id IS DISTINCT FROM 4663
       OR v_row.network_environment IS DISTINCT FROM 'PRODUCTION'
       OR v_row.deployment_kind IS DISTINCT FROM 'FIXED_SUPPLY_ERC20'
       OR v_row.artifact_id IS DISTINCT FROM 'cartel-fixed-erc20-v1'
       OR v_row.deployer_address IS DISTINCT FROM v_deployer
       OR v_row.token_name IS DISTINCT FROM v_name
       OR v_row.token_symbol IS DISTINCT FROM v_symbol
       OR v_row.token_decimals IS DISTINCT FROM 18::smallint
       OR v_row.token_total_supply IS DISTINCT FROM v_supply
       OR v_row.token_recipient IS DISTINCT FROM v_recipient
       OR v_row.review_fingerprint IS DISTINCT FROM v_fingerprint
       OR v_row.init_code_hash IS DISTINCT FROM v_init_hash THEN
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
      token_total_supply, token_recipient, review_fingerprint, init_code_hash
    ) VALUES (
      v_workspace, _launch_id, v_next, v_request,
      4663, 'PRODUCTION', v_deployer, 'DRAFT', auth.uid(),
      'FIXED_SUPPLY_ERC20', 'cartel-fixed-erc20-v1', v_name, v_symbol, 18,
      v_supply, v_recipient, v_fingerprint, v_init_hash
    )
    RETURNING * INTO v_row;
  EXCEPTION WHEN unique_violation THEN
    SELECT * INTO v_row FROM public.launch_chain_deployments
     WHERE launch_id = _launch_id AND client_request_id = v_request;
    IF NOT FOUND THEN RAISE; END IF;
    IF v_row.chain_id IS DISTINCT FROM 4663
       OR v_row.network_environment IS DISTINCT FROM 'PRODUCTION'
       OR v_row.deployment_kind IS DISTINCT FROM 'FIXED_SUPPLY_ERC20'
       OR v_row.artifact_id IS DISTINCT FROM 'cartel-fixed-erc20-v1'
       OR v_row.deployer_address IS DISTINCT FROM v_deployer
       OR v_row.token_name IS DISTINCT FROM v_name
       OR v_row.token_symbol IS DISTINCT FROM v_symbol
       OR v_row.token_decimals IS DISTINCT FROM 18::smallint
       OR v_row.token_total_supply IS DISTINCT FROM v_supply
       OR v_row.token_recipient IS DISTINCT FROM v_recipient
       OR v_row.review_fingerprint IS DISTINCT FROM v_fingerprint
       OR v_row.init_code_hash IS DISTINCT FROM v_init_hash THEN
      RAISE EXCEPTION 'Idempotency key conflict' USING ERRCODE = '22023';
    END IF;
  END;

  RETURN v_row;
END;
$function$;

-- 5. Execution privileges: authenticated only.
REVOKE ALL ON FUNCTION public.create_launch_chain_production_token_deployment_attempt(
  uuid, text, text, text, text, numeric, text, text, text
) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.create_launch_chain_production_token_deployment_attempt(
  uuid, text, text, text, text, numeric, text, text, text
) FROM anon;
GRANT EXECUTE ON FUNCTION public.create_launch_chain_production_token_deployment_attempt(
  uuid, text, text, text, text, numeric, text, text, text
) TO authenticated;
