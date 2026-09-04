-- C8.3 — additive fixed-supply ERC-20 test-token support on the existing
-- launch_chain_deployments model. TESTNET (46630) ONLY.
-- No C8.2 object is modified. No launch lifecycle column is touched.

ALTER TABLE public.launch_chain_deployments
  ADD COLUMN deployment_kind text NOT NULL DEFAULT 'TEST_ARTIFACT',
  ADD COLUMN artifact_id text,
  ADD COLUMN token_name text,
  ADD COLUMN token_symbol text,
  ADD COLUMN token_decimals smallint,
  ADD COLUMN token_total_supply numeric(78, 0),
  ADD COLUMN token_recipient text,
  ADD COLUMN verified_token_name text,
  ADD COLUMN verified_token_symbol text,
  ADD COLUMN verified_token_decimals smallint,
  ADD COLUMN verified_total_supply numeric(78, 0),
  ADD COLUMN verified_recipient_balance numeric(78, 0);

ALTER TABLE public.launch_chain_deployments
  ADD CONSTRAINT launch_chain_deployments_kind_chk
    CHECK (deployment_kind IN ('TEST_ARTIFACT', 'FIXED_SUPPLY_ERC20')),
  ADD CONSTRAINT launch_chain_deployments_artifact_chk
    CHECK (artifact_id IS NULL OR artifact_id = 'cartel-fixed-erc20-v1'),
  ADD CONSTRAINT launch_chain_deployments_token_name_chk
    CHECK (token_name IS NULL OR (char_length(token_name) BETWEEN 1 AND 32
           AND token_name ~ '^[ -~]+$' AND token_name = btrim(token_name))),
  ADD CONSTRAINT launch_chain_deployments_token_symbol_chk
    CHECK (token_symbol IS NULL OR token_symbol ~ '^[A-Z0-9]{2,11}$'),
  ADD CONSTRAINT launch_chain_deployments_token_decimals_chk
    CHECK (token_decimals IS NULL OR token_decimals = 18),
  ADD CONSTRAINT launch_chain_deployments_token_supply_chk
    CHECK (token_total_supply IS NULL
           OR (token_total_supply >= 1000000000000000000
               AND token_total_supply <= 1000000000000000000000000000000)),
  ADD CONSTRAINT launch_chain_deployments_token_recipient_chk
    CHECK (token_recipient IS NULL
           OR (token_recipient ~ '^0x[0-9a-f]{40}$'
               AND token_recipient <> '0x0000000000000000000000000000000000000000')),
  ADD CONSTRAINT launch_chain_deployments_verified_decimals_chk
    CHECK (verified_token_decimals IS NULL OR verified_token_decimals = 18),
  ADD CONSTRAINT launch_chain_deployments_verified_amounts_chk
    CHECK ((verified_total_supply IS NULL OR verified_total_supply >= 0)
           AND (verified_recipient_balance IS NULL OR verified_recipient_balance >= 0)),
  -- Token intent is mandatory and complete for the token kind, and entirely
  -- absent for the legacy inert test-artifact kind (all existing rows).
  ADD CONSTRAINT launch_chain_deployments_kind_shape_chk
    CHECK (
      CASE deployment_kind
        WHEN 'FIXED_SUPPLY_ERC20' THEN
          artifact_id IS NOT NULL AND token_name IS NOT NULL AND token_symbol IS NOT NULL
          AND token_decimals IS NOT NULL AND token_total_supply IS NOT NULL
          AND token_recipient IS NOT NULL
        ELSE
          artifact_id IS NULL AND token_name IS NULL AND token_symbol IS NULL
          AND token_decimals IS NULL AND token_total_supply IS NULL
          AND token_recipient IS NULL AND verified_token_name IS NULL
          AND verified_token_symbol IS NULL AND verified_token_decimals IS NULL
          AND verified_total_supply IS NULL AND verified_recipient_balance IS NULL
      END
    );

-- Token intent recorded at creation is immutable for the life of the attempt.
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
     OR NEW.token_recipient IS DISTINCT FROM OLD.token_recipient THEN
    RAISE EXCEPTION 'Token deployment intent is immutable' USING ERRCODE = '42501';
  END IF;
  RETURN NEW;
END;
$function$;

REVOKE ALL ON FUNCTION public.enforce_launch_chain_token_intent_immutable() FROM PUBLIC, anon, authenticated;

CREATE TRIGGER trg_launch_chain_token_intent_immutable
  BEFORE UPDATE ON public.launch_chain_deployments
  FOR EACH ROW EXECUTE FUNCTION public.enforce_launch_chain_token_intent_immutable();

-- Owner-scoped token attempt creation. Mirrors the C8.2 authorization,
-- idempotency and attempt-numbering semantics exactly. The browser cannot
-- supply artifact id, chain id, environment, bytecode or any hash.
CREATE OR REPLACE FUNCTION public.create_launch_chain_token_deployment_attempt(
  _launch_id uuid,
  _client_request_id text,
  _deployer_address text,
  _token_name text,
  _token_symbol text,
  _token_total_supply numeric,
  _token_recipient text
)
RETURNS launch_chain_deployments
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
  END;

  RETURN v_row;
END;
$function$;

REVOKE ALL ON FUNCTION public.create_launch_chain_token_deployment_attempt(uuid, text, text, text, text, numeric, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.create_launch_chain_token_deployment_attempt(uuid, text, text, text, text, numeric, text) TO authenticated;

-- Service-role-only sink for the server verifier's independent chain reads.
-- The C8.2 apply function is untouched and still serves TEST_ARTIFACT rows.
CREATE OR REPLACE FUNCTION public.apply_launch_chain_token_deployment_verification(
  _deployment_id uuid,
  _status text,
  _confirmations integer DEFAULT 0,
  _contract_address text DEFAULT NULL,
  _block_number bigint DEFAULT NULL,
  _block_hash text DEFAULT NULL,
  _failure_code text DEFAULT NULL,
  _failure_detail text DEFAULT NULL,
  _verified_token_name text DEFAULT NULL,
  _verified_token_symbol text DEFAULT NULL,
  _verified_token_decimals smallint DEFAULT NULL,
  _verified_total_supply numeric DEFAULT NULL,
  _verified_recipient_balance numeric DEFAULT NULL
)
RETURNS launch_chain_deployments
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

REVOKE ALL ON FUNCTION public.apply_launch_chain_token_deployment_verification(uuid, text, integer, text, bigint, text, text, text, text, text, smallint, numeric, numeric) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.apply_launch_chain_token_deployment_verification(uuid, text, integer, text, bigint, text, text, text, text, text, smallint, numeric, numeric) TO service_role;