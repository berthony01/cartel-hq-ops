ALTER TABLE public.launch_chain_deployments
  ADD COLUMN IF NOT EXISTS deployer_nonce_before bigint;

ALTER TABLE public.launch_chain_deployments
  DROP CONSTRAINT IF EXISTS launch_chain_deployments_deployer_nonce_before_nonneg;
ALTER TABLE public.launch_chain_deployments
  ADD CONSTRAINT launch_chain_deployments_deployer_nonce_before_nonneg
  CHECK (deployer_nonce_before IS NULL OR deployer_nonce_before >= 0);

CREATE OR REPLACE FUNCTION public.create_launch_chain_pcart_rehearsal_attempt_v2(
  _launch_id uuid, _client_request_id text, _deployer_address text,
  _rehearsal_recipient text, _deployer_nonce_before bigint)
 RETURNS launch_chain_deployments
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
DECLARE
  v_workspace uuid;
  v_request text := btrim(coalesce(_client_request_id, ''));
  v_deployer text := lower(btrim(coalesce(_deployer_address, '')));
  v_recipient text := lower(btrim(coalesce(_rehearsal_recipient, '')));
  v_supply numeric := 1000000000000000000000000000;
  l public.launches%rowtype;
  v_row public.launch_chain_deployments;
  v_next integer;
BEGIN
  v_workspace := public.authorize_launch_chain_deployment(_launch_id);

  SELECT * INTO l FROM public.launches WHERE id = _launch_id;
  IF NOT FOUND
     OR NOT private.is_canonical_pcart_launch(l.id)
     OR l.public_slug IS DISTINCT FROM 'pepecartel-launch'
     OR l.launch_kind IS DISTINCT FROM 'PROJECT'
     OR l.token_name IS DISTINCT FROM 'PEPECARTEL'
     OR l.ticker IS DISTINCT FROM '$PCART'
     OR l.workspace_id IS DISTINCT FROM v_workspace THEN
    RAISE EXCEPTION 'PCART rehearsal is only available for the canonical PEPECARTEL project launch'
      USING ERRCODE = '42501';
  END IF;

  IF char_length(v_request) < 8 OR char_length(v_request) > 128 THEN
    RAISE EXCEPTION 'Invalid request id' USING ERRCODE = '22023';
  END IF;
  IF v_deployer !~ '^0x[0-9a-f]{40}$'
     OR v_deployer = '0x0000000000000000000000000000000000000000' THEN
    RAISE EXCEPTION 'Invalid deployer address' USING ERRCODE = '22023';
  END IF;
  IF v_recipient !~ '^0x[0-9a-f]{40}$'
     OR v_recipient = '0x0000000000000000000000000000000000000000' THEN
    RAISE EXCEPTION 'Invalid rehearsal recipient' USING ERRCODE = '22023';
  END IF;
  IF _deployer_nonce_before IS NULL OR _deployer_nonce_before < 0 THEN
    RAISE EXCEPTION 'Invalid deployer nonce' USING ERRCODE = '22023';
  END IF;

  SELECT * INTO v_row FROM public.launch_chain_deployments
   WHERE launch_id = _launch_id AND client_request_id = v_request;
  IF FOUND THEN
    IF v_row.deployment_kind IS DISTINCT FROM 'FIXED_SUPPLY_ERC20'
       OR v_row.artifact_id IS DISTINCT FROM 'pepecartel-token-v1'
       OR v_row.chain_id <> 46630
       OR v_row.network_environment IS DISTINCT FROM 'TESTNET'
       OR v_row.deployer_address IS DISTINCT FROM v_deployer
       OR v_row.token_name IS DISTINCT FROM 'PEPECARTEL'
       OR v_row.token_symbol IS DISTINCT FROM 'PCART'
       OR v_row.token_decimals IS DISTINCT FROM 18::smallint
       OR v_row.token_total_supply IS DISTINCT FROM v_supply
       OR v_row.token_recipient IS DISTINCT FROM v_recipient
       OR v_row.deployer_nonce_before IS DISTINCT FROM _deployer_nonce_before THEN
      RAISE EXCEPTION 'Idempotency key conflict' USING ERRCODE = '22023';
    END IF;
    RETURN v_row;
  END IF;

  IF EXISTS (
    SELECT 1 FROM public.launch_chain_deployments b
     WHERE b.launch_id = _launch_id
       AND b.artifact_id = 'pepecartel-token-v1'
       AND b.status IN ('DRAFT', 'SUBMITTED', 'PENDING', 'CONFIRMED')
  ) THEN
    RAISE EXCEPTION 'A PCART rehearsal is already active or confirmed for this launch; resolve it first (confirmed rehearsals are not repeated)'
      USING ERRCODE = '23505';
  END IF;

  SELECT coalesce(max(d.attempt_number), 0) + 1 INTO v_next
    FROM public.launch_chain_deployments d WHERE d.launch_id = _launch_id;

  BEGIN
    INSERT INTO public.launch_chain_deployments (
      workspace_id, launch_id, attempt_number, client_request_id,
      chain_id, network_environment, deployer_address, status, created_by,
      deployment_kind, artifact_id, token_name, token_symbol, token_decimals,
      token_total_supply, token_recipient, deployer_nonce_before
    ) VALUES (
      v_workspace, _launch_id, v_next, v_request,
      46630, 'TESTNET', v_deployer, 'DRAFT', auth.uid(),
      'FIXED_SUPPLY_ERC20', 'pepecartel-token-v1', 'PEPECARTEL', 'PCART', 18,
      v_supply, v_recipient, _deployer_nonce_before
    )
    RETURNING * INTO v_row;
  EXCEPTION WHEN unique_violation THEN
    SELECT * INTO v_row FROM public.launch_chain_deployments
     WHERE launch_id = _launch_id AND client_request_id = v_request;
    IF NOT FOUND THEN RAISE; END IF;
    IF v_row.artifact_id IS DISTINCT FROM 'pepecartel-token-v1'
       OR v_row.deployer_address IS DISTINCT FROM v_deployer
       OR v_row.token_recipient IS DISTINCT FROM v_recipient
       OR v_row.deployer_nonce_before IS DISTINCT FROM _deployer_nonce_before THEN
      RAISE EXCEPTION 'Idempotency key conflict' USING ERRCODE = '22023';
    END IF;
  END;

  RETURN v_row;
END;
$function$;

REVOKE ALL ON FUNCTION public.create_launch_chain_pcart_rehearsal_attempt_v2(uuid, text, text, text, bigint) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.create_launch_chain_pcart_rehearsal_attempt_v2(uuid, text, text, text, bigint) TO authenticated;