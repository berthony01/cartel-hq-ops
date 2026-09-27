-- =============================================================================
-- PCART-L3 — Exact-artifact TESTNET rehearsal path + canonical mainnet isolation
-- =============================================================================
-- STATUS: APPLIED as migration 20260927141715 / pcart_l3_rehearsal_and_mainnet_isolation.
-- The exact payload below is recorded byte-for-byte in
-- supabase/migrations/20260927141715_pcart_l3_rehearsal_and_mainnet_isolation.sql.
-- If the rehearsal RPC is ever missing or drifted, the app still fails closed:
-- no attempt is created and nothing is broadcast.
--
-- Additive, single transaction. Does NOT:
--   - production-allowlist pepecartel-token-v1;
--   - change runtime execution control, emergency stop or liquidity switches;
--   - write launches.official_contract_address, lifecycle, notifications or
--     liquidity state;
--   - change the signature or generic behavior of any existing RPC.
--
-- Canonical launch identity is SEMANTIC and EXACT (no generated id pinned):
-- public_slug 'pepecartel-launch' AND launch_kind 'PROJECT' AND
-- token_name 'PEPECARTEL' AND ticker '$PCART'.
-- =============================================================================

BEGIN;

-- -----------------------------------------------------------------------------
-- 1. Canonical identity helper (private schema, not exposed over the Data API)
-- -----------------------------------------------------------------------------
CREATE SCHEMA IF NOT EXISTS private;

CREATE OR REPLACE FUNCTION private.is_canonical_pcart_launch(_launch_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT _launch_id IS NOT NULL AND EXISTS (
    SELECT 1 FROM public.launches l
     WHERE l.id = _launch_id
       AND l.public_slug = 'pepecartel-launch'
       AND l.launch_kind = 'PROJECT'
       AND l.token_name = 'PEPECARTEL'
       AND l.ticker = '$PCART'
  );
$$;
REVOKE ALL ON FUNCTION private.is_canonical_pcart_launch(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION private.is_canonical_pcart_launch(uuid) TO service_role;

-- -----------------------------------------------------------------------------
-- 2. Deployment evidence: permit pepecartel-token-v1 ONLY on TESTNET 46630
-- -----------------------------------------------------------------------------
ALTER TABLE public.launch_chain_deployments
  DROP CONSTRAINT launch_chain_deployments_artifact_chk;
ALTER TABLE public.launch_chain_deployments
  ADD CONSTRAINT launch_chain_deployments_artifact_chk CHECK (
    artifact_id IS NULL
    OR artifact_id = 'cartel-fixed-erc20-v1'
    OR (
      artifact_id = 'pepecartel-token-v1'
      AND chain_id = 46630
      AND network_environment = 'TESTNET'
      AND deployment_kind = 'FIXED_SUPPLY_ERC20'
      AND token_name = 'PEPECARTEL'
      AND token_symbol = 'PCART'
      AND token_decimals = 18
      AND token_total_supply = 1000000000000000000000000000
      AND token_recipient IS NOT NULL
      AND token_recipient <> '0x0000000000000000000000000000000000000000'
    )
  );

-- -----------------------------------------------------------------------------
-- 2b. One active-or-confirmed PCART rehearsal per launch (race-safe authority)
-- Live audit before staging: zero pepecartel-token-v1 rows, so no conflict.
-- -----------------------------------------------------------------------------
CREATE UNIQUE INDEX IF NOT EXISTS launch_chain_deployments_one_active_pcart_rehearsal
  ON public.launch_chain_deployments (launch_id)
  WHERE artifact_id = 'pepecartel-token-v1'
    AND status IN ('DRAFT', 'SUBMITTED', 'PENDING', 'CONFIRMED');

-- -----------------------------------------------------------------------------
-- 3. Dedicated authenticated PCART rehearsal-attempt RPC
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.create_launch_chain_pcart_rehearsal_attempt(
  _launch_id uuid,
  _client_request_id text,
  _deployer_address text,
  _rehearsal_recipient text
)
RETURNS public.launch_chain_deployments
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
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
  -- Platform owner + workspace operator, exactly as the generic path.
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
       OR v_row.token_recipient IS DISTINCT FROM v_recipient THEN
      RAISE EXCEPTION 'Idempotency key conflict' USING ERRCODE = '22023';
    END IF;
    RETURN v_row;
  END IF;

  -- Audit-first / no-repeat: refuse a new PCART rehearsal while one is active
  -- or already CONFIRMED. Runs AFTER the idempotent replay above so an exact
  -- same-request retry still returns its row. The partial unique index
  -- launch_chain_deployments_one_active_pcart_rehearsal is the concurrency authority.
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
      token_total_supply, token_recipient
    ) VALUES (
      v_workspace, _launch_id, v_next, v_request,
      46630, 'TESTNET', v_deployer, 'DRAFT', auth.uid(),
      'FIXED_SUPPLY_ERC20', 'pepecartel-token-v1', 'PEPECARTEL', 'PCART', 18,
      v_supply, v_recipient
    )
    RETURNING * INTO v_row;
  EXCEPTION WHEN unique_violation THEN
    SELECT * INTO v_row FROM public.launch_chain_deployments
     WHERE launch_id = _launch_id AND client_request_id = v_request;
    IF NOT FOUND THEN RAISE; END IF;
    IF v_row.artifact_id IS DISTINCT FROM 'pepecartel-token-v1'
       OR v_row.deployer_address IS DISTINCT FROM v_deployer
       OR v_row.token_recipient IS DISTINCT FROM v_recipient THEN
      RAISE EXCEPTION 'Idempotency key conflict' USING ERRCODE = '22023';
    END IF;
  END;

  RETURN v_row;
END;
$$;
REVOKE ALL ON FUNCTION public.create_launch_chain_pcart_rehearsal_attempt(uuid, text, text, text)
  FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.create_launch_chain_pcart_rehearsal_attempt(uuid, text, text, text)
  TO authenticated;

-- -----------------------------------------------------------------------------
-- 4. Service-role verification apply: artifact-aware, generic branch unchanged
--    (same signature; search_path hardened to empty; PCART rows additionally
--    pinned to the exact fixed intent on TESTNET).
-- -----------------------------------------------------------------------------
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
SET search_path = ''
AS $$
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

  -- PCART-L3: pepecartel-token-v1 rows are TESTNET rehearsal evidence only.
  IF v_row.artifact_id = 'pepecartel-token-v1' AND (
       v_row.chain_id <> 46630
       OR v_row.network_environment IS DISTINCT FROM 'TESTNET'
       OR v_row.token_name IS DISTINCT FROM 'PEPECARTEL'
       OR v_row.token_symbol IS DISTINCT FROM 'PCART'
       OR v_row.token_decimals IS DISTINCT FROM 18::smallint
       OR v_row.token_total_supply IS DISTINCT FROM 1000000000000000000000000000::numeric) THEN
    RAISE EXCEPTION 'PCART rehearsal row does not match the frozen intent' USING ERRCODE = '22023';
  END IF;

  IF v_status = 'CONFIRMED' THEN
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
$$;
REVOKE ALL ON FUNCTION public.apply_launch_chain_token_deployment_verification(
  uuid, text, integer, text, bigint, text, text, text, text, text, smallint, numeric, numeric
) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.apply_launch_chain_token_deployment_verification(
  uuid, text, integer, text, bigint, text, text, text, text, text, smallint, numeric, numeric
) TO service_role;

-- -----------------------------------------------------------------------------
-- 5. Immutable artifact binding on production requests
--    Existing rows receive 'cartel-fixed-erc20-v1'. PCART is NOT allowed here.
-- -----------------------------------------------------------------------------
ALTER TABLE public.launch_production_deployment_requests
  ADD COLUMN IF NOT EXISTS artifact_id text NOT NULL DEFAULT 'cartel-fixed-erc20-v1';
ALTER TABLE public.launch_production_deployment_requests
  ADD CONSTRAINT launch_production_deployment_requests_artifact_chk
  CHECK (artifact_id = 'cartel-fixed-erc20-v1');

CREATE OR REPLACE FUNCTION public.enforce_launch_production_request_artifact_immutable()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  IF NEW.artifact_id IS DISTINCT FROM OLD.artifact_id THEN
    RAISE EXCEPTION 'Production request artifact binding is immutable' USING ERRCODE = '42501';
  END IF;
  RETURN NEW;
END;
$$;
REVOKE ALL ON FUNCTION public.enforce_launch_production_request_artifact_immutable()
  FROM PUBLIC, anon, authenticated;

CREATE TRIGGER trg_launch_production_request_artifact_immutable
  BEFORE UPDATE ON public.launch_production_deployment_requests
  FOR EACH ROW EXECUTE FUNCTION public.enforce_launch_production_request_artifact_immutable();

-- -----------------------------------------------------------------------------
-- 6. Generic production request RPC: explicitly reject the canonical launch.
--    Signature and every other behavior unchanged.
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.submit_launch_production_deployment_request(
  _launch_id uuid, _token_supply_whole text, _token_recipient text
)
RETURNS public.launch_production_deployment_requests
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
declare
  l public.launches%rowtype;
  p public.project_profiles%rowtype;
  r public.launch_production_deployment_requests%rowtype;
  v_uid uuid := auth.uid();
  v_supply_text text := btrim(coalesce(_token_supply_whole, ''));
  v_supply_whole numeric;
  v_supply_base numeric;
  v_recipient text := lower(btrim(coalesce(_token_recipient, '')));
  v_ticker text;
  v_symbol text;
  v_name text;
begin
  if v_uid is null then
    raise exception 'Not authorized' using errcode = '42501';
  end if;
  if _launch_id is null then
    raise exception 'Launch is required' using errcode = '22023';
  end if;

  -- PCART-L3: the canonical PEPECARTEL launch can never enter the generic
  -- cartel-fixed-erc20-v1 production path.
  if private.is_canonical_pcart_launch(_launch_id) then
    raise exception 'The canonical PEPECARTEL launch uses the protected PCART path, which remains blocked'
      using errcode = '42501';
  end if;

  select * into l from public.launches where id = _launch_id for update;
  if not found then
    raise exception 'Launch not found' using errcode = 'P0002';
  end if;

  if l.launch_kind is distinct from 'PROJECT' then
    raise exception 'Production deployment requests are only available for project launches' using errcode = '22023';
  end if;
  if not public.is_workspace_owner(l.workspace_id, v_uid) then
    raise exception 'Only the workspace owner can request production deployment' using errcode = '42501';
  end if;
  if not public.launch_chain_label_is_robinhood_mainnet(l.chain) then
    raise exception 'This launch is not configured for Robinhood Chain mainnet' using errcode = '22023';
  end if;
  if l.status not in ('WATCHLIST_OPEN','LAUNCH_APPROACHING','CONTRACT_PENDING') then
    raise exception 'The launch lifecycle is not eligible for a production deployment request' using errcode = '22023';
  end if;
  if l.launch_at is null and (l.launch_window_start is null or l.launch_window_end is null) then
    raise exception 'Set the launch schedule before requesting production deployment' using errcode = '22023';
  end if;
  if l.official_contract_address is not null
     or l.official_contract_deployment_id is not null
     or l.contract_registered_at is not null then
    raise exception 'An official contract is already registered or partially recorded for this launch' using errcode = '22023';
  end if;

  select * into p from public.project_profiles where id = l.project_profile_id;
  if not found or p.workspace_id is distinct from l.workspace_id then
    raise exception 'Project profile does not match this launch' using errcode = '22023';
  end if;
  if p.discovery_status is distinct from 'published' then
    raise exception 'Publish the Project Profile before requesting production deployment' using errcode = '22023';
  end if;

  v_name := btrim(l.token_name);
  if char_length(v_name) < 1 or char_length(v_name) > 32 or v_name !~ '^[ -~]+$' then
    raise exception 'Token name must be 1-32 printable ASCII characters for mainnet deployment' using errcode = '22023';
  end if;

  v_ticker := btrim(l.ticker);
  if v_ticker ~ '^[A-Z0-9]{2,11}$' then
    v_symbol := v_ticker;
  elsif left(v_ticker, 1) = '$' and substring(v_ticker from 2) ~ '^[A-Z0-9]{2,11}$' then
    v_symbol := substring(v_ticker from 2);
  else
    raise exception 'Ticker cannot be safely converted to a 2-11 character on-chain symbol' using errcode = '22023';
  end if;

  if v_supply_text !~ '^[1-9][0-9]{0,12}$' then
    raise exception 'Supply must be a whole-token integer between 1 and 1000000000000' using errcode = '22023';
  end if;
  v_supply_whole := v_supply_text::numeric;
  if v_supply_whole < 1 or v_supply_whole > 1000000000000 then
    raise exception 'Supply must be between 1 and 1000000000000 whole tokens' using errcode = '22023';
  end if;
  v_supply_base := v_supply_whole * 1000000000000000000::numeric;

  if v_recipient !~ '^0x[0-9a-f]{40}$'
     or v_recipient = '0x0000000000000000000000000000000000000000' then
    raise exception 'Recipient must be a non-zero EVM address' using errcode = '22023';
  end if;

  if exists (
    select 1 from public.launch_chain_deployments d
    where d.launch_id = l.id
      and d.chain_id = 4663
      and d.network_environment = 'PRODUCTION'
      and d.deployment_kind = 'FIXED_SUPPLY_ERC20'
      and d.artifact_id = 'cartel-fixed-erc20-v1'
      and d.status in ('DRAFT','SUBMITTED','PENDING','CONFIRMED')
  ) then
    raise exception 'A production deployment already exists or is in progress for this launch' using errcode = '22023';
  end if;

  select * into r
  from public.launch_production_deployment_requests
  where launch_id = l.id
    and status in ('REQUESTED','IN_REVIEW','APPROVED','EXECUTING')
  order by requested_at desc
  limit 1;

  if found then
    if r.token_name is distinct from v_name
       or r.token_symbol is distinct from v_symbol
       or r.token_supply_whole is distinct from v_supply_whole
       or r.token_total_supply_base_units is distinct from v_supply_base
       or r.token_recipient is distinct from v_recipient then
      raise exception 'An open production deployment request already exists with different immutable token intent' using errcode = '22023';
    end if;
    return r;
  end if;

  insert into public.launch_production_deployment_requests (
    workspace_id, project_profile_id, launch_id,
    status, chain_id, network_environment, declared_chain,
    token_name, token_symbol, token_decimals,
    token_supply_whole, token_total_supply_base_units, token_recipient,
    requested_by, artifact_id
  ) values (
    l.workspace_id, l.project_profile_id, l.id,
    'REQUESTED', 4663, 'PRODUCTION', l.chain,
    v_name, v_symbol, 18,
    v_supply_whole, v_supply_base, v_recipient,
    v_uid, 'cartel-fixed-erc20-v1'
  ) returning * into r;

  return r;
end;
$$;
REVOKE ALL ON FUNCTION public.submit_launch_production_deployment_request(uuid, text, text)
  FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.submit_launch_production_deployment_request(uuid, text, text)
  TO authenticated;

-- -----------------------------------------------------------------------------
-- 7. Begin-execution RPC: explicitly reject the canonical launch and require
--    the generic artifact binding. Signature and other behavior unchanged.
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.begin_launch_production_request_execution(
  _request_id uuid, _deployer_address text, _review_fingerprint text, _init_code_hash text
)
RETURNS public.launch_production_deployment_requests
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
declare
  r public.launch_production_deployment_requests%rowtype;
  l public.launches%rowtype;
  p public.project_profiles%rowtype;
  d public.launch_chain_deployments%rowtype;
  v_uid uuid := auth.uid();
  v_deployer text := lower(btrim(coalesce(_deployer_address,'')));
  v_fingerprint text := lower(btrim(coalesce(_review_fingerprint,'')));
  v_init_hash text := lower(btrim(coalesce(_init_code_hash,'')));
  v_client_request_id text;
begin
  if v_uid is null or not public.is_platform_owner(v_uid) then
    raise exception 'Not authorized' using errcode = '42501';
  end if;
  if _request_id is null then
    raise exception 'Request is required' using errcode = '22023';
  end if;
  if v_deployer !~ '^0x[0-9a-f]{40}$'
     or v_deployer = '0x0000000000000000000000000000000000000000' then
    raise exception 'Invalid deployer address' using errcode = '22023';
  end if;
  if v_fingerprint !~ '^0x[0-9a-f]{64}$' then
    raise exception 'Invalid review fingerprint' using errcode = '22023';
  end if;
  if v_init_hash !~ '^0x[0-9a-f]{64}$' then
    raise exception 'Invalid init code hash' using errcode = '22023';
  end if;

  select * into r
  from public.launch_production_deployment_requests
  where id = _request_id
  for update;
  if not found then
    raise exception 'Request not found' using errcode = 'P0002';
  end if;

  -- PCART-L3: never execute the canonical launch through the generic path,
  -- and never execute a request bound to any artifact but the generic one.
  if private.is_canonical_pcart_launch(r.launch_id) then
    raise exception 'The canonical PEPECARTEL launch uses the protected PCART path, which remains blocked'
      using errcode = '42501';
  end if;
  if r.artifact_id is distinct from 'cartel-fixed-erc20-v1' then
    raise exception 'Request artifact binding is not executable on the generic path' using errcode = '42501';
  end if;

  if r.status = 'EXECUTING' and r.execution_deployment_id is not null then
    if r.assigned_operator_id is distinct from v_uid then
      raise exception 'Not authorized' using errcode = '42501';
    end if;
    select * into d
    from public.launch_chain_deployments
    where id = r.execution_deployment_id;
    if not found
       or d.workspace_id is distinct from r.workspace_id
       or d.launch_id is distinct from r.launch_id
       or d.chain_id <> 4663
       or d.network_environment <> 'PRODUCTION'
       or d.deployment_kind <> 'FIXED_SUPPLY_ERC20'
       or d.artifact_id is distinct from 'cartel-fixed-erc20-v1'
       or d.deployer_address is distinct from v_deployer
       or d.token_name is distinct from r.token_name
       or d.token_symbol is distinct from r.token_symbol
       or d.token_decimals is distinct from r.token_decimals
       or d.token_total_supply is distinct from r.token_total_supply_base_units
       or d.token_recipient is distinct from r.token_recipient
       or d.review_fingerprint is distinct from v_fingerprint
       or d.init_code_hash is distinct from v_init_hash then
      raise exception 'Existing execution binding does not match immutable request intent' using errcode = '22023';
    end if;
    return r;
  end if;

  if r.status is distinct from 'APPROVED'
     or r.execution_deployment_id is not null
     or r.assigned_operator_id is not null then
    raise exception 'Request is not ready to begin execution' using errcode = '22023';
  end if;

  select * into l from public.launches where id = r.launch_id for update;
  if not found
     or l.workspace_id is distinct from r.workspace_id
     or l.project_profile_id is distinct from r.project_profile_id
     or l.launch_kind is distinct from 'PROJECT' then
    raise exception 'Request launch binding is invalid' using errcode = '22023';
  end if;
  if not public.launch_chain_label_is_robinhood_mainnet(l.chain) then
    raise exception 'Launch is not configured for Robinhood Chain mainnet' using errcode = '22023';
  end if;
  if l.status not in ('WATCHLIST_OPEN','LAUNCH_APPROACHING','CONTRACT_PENDING') then
    raise exception 'Launch lifecycle is no longer eligible for production deployment' using errcode = '22023';
  end if;
  if l.launch_at is null and (l.launch_window_start is null or l.launch_window_end is null) then
    raise exception 'Launch schedule is no longer complete' using errcode = '22023';
  end if;
  if l.official_contract_address is not null
     or l.official_contract_deployment_id is not null
     or l.contract_registered_at is not null then
    raise exception 'Official contract state already exists for this launch' using errcode = '22023';
  end if;

  select * into p from public.project_profiles where id = r.project_profile_id;
  if not found
     or p.workspace_id is distinct from r.workspace_id
     or p.discovery_status is distinct from 'published' then
    raise exception 'Project Profile is no longer eligible for production deployment' using errcode = '22023';
  end if;

  if r.chain_id <> 4663
     or r.network_environment <> 'PRODUCTION'
     or r.token_decimals <> 18
     or r.declared_chain is distinct from l.chain
     or r.token_name is distinct from btrim(l.token_name) then
    raise exception 'Stored production request no longer matches launch identity' using errcode = '22023';
  end if;

  if exists (
    select 1
    from public.launch_chain_deployments existing
    where existing.launch_id = r.launch_id
      and existing.chain_id = 4663
      and existing.network_environment = 'PRODUCTION'
      and existing.deployment_kind = 'FIXED_SUPPLY_ERC20'
      and existing.artifact_id = 'cartel-fixed-erc20-v1'
      and existing.status in ('DRAFT','SUBMITTED','PENDING','CONFIRMED')
  ) then
    raise exception 'A production deployment already exists or is in progress for this launch' using errcode = '22023';
  end if;

  update public.launch_production_deployment_requests
  set status = 'EXECUTING',
      assigned_operator_id = v_uid,
      status_changed_at = now()
  where id = r.id
  returning * into r;

  v_client_request_id := 'launcher-b3:' || r.id::text;

  d := public.create_launch_chain_production_token_deployment_attempt(
    r.launch_id,
    v_client_request_id,
    v_deployer,
    r.token_name,
    r.token_symbol,
    r.token_total_supply_base_units,
    r.token_recipient,
    v_fingerprint,
    v_init_hash
  );

  if d.id is null
     or d.workspace_id is distinct from r.workspace_id
     or d.launch_id is distinct from r.launch_id
     or d.chain_id <> 4663
     or d.network_environment <> 'PRODUCTION'
     or d.deployment_kind <> 'FIXED_SUPPLY_ERC20'
     or d.artifact_id is distinct from 'cartel-fixed-erc20-v1'
     or d.deployer_address is distinct from v_deployer
     or d.token_name is distinct from r.token_name
     or d.token_symbol is distinct from r.token_symbol
     or d.token_decimals is distinct from r.token_decimals
     or d.token_total_supply is distinct from r.token_total_supply_base_units
     or d.token_recipient is distinct from r.token_recipient
     or d.review_fingerprint is distinct from v_fingerprint
     or d.init_code_hash is distinct from v_init_hash then
    raise exception 'Created deployment does not match immutable request intent' using errcode = '22023';
  end if;

  update public.launch_production_deployment_requests
  set execution_deployment_id = d.id,
      status_changed_at = now()
  where id = r.id
    and status = 'EXECUTING'
    and assigned_operator_id = v_uid
    and execution_deployment_id is null
  returning * into r;

  if not found then
    raise exception 'Execution binding failed' using errcode = '42501';
  end if;

  return r;
end;
$$;
REVOKE ALL ON FUNCTION public.begin_launch_production_request_execution(uuid, text, text, text)
  FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.begin_launch_production_request_execution(uuid, text, text, text)
  TO authenticated;

-- -----------------------------------------------------------------------------
-- 8. Authoritative table-boundary guard: while pepecartel-token-v1 is NOT
--    production-allowlisted, NO production (PRODUCTION or chain 4663) row may
--    be created for, or moved onto, the canonical PCART launch — regardless of
--    artifact or calling path (generic canary, request execution, direct
--    insert). TESTNET rehearsal rows and every noncanonical launch are
--    unaffected.
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.enforce_canonical_pcart_no_production_deployment()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  IF (NEW.network_environment = 'PRODUCTION' OR NEW.chain_id = 4663)
     AND private.is_canonical_pcart_launch(NEW.launch_id) THEN
    RAISE EXCEPTION 'The canonical PEPECARTEL launch has no production-allowlisted artifact; production deployment rows are refused'
      USING ERRCODE = '42501';
  END IF;
  RETURN NEW;
END;
$$;
REVOKE ALL ON FUNCTION public.enforce_canonical_pcart_no_production_deployment()
  FROM PUBLIC, anon, authenticated;

CREATE TRIGGER trg_canonical_pcart_no_production_deployment
  BEFORE INSERT OR UPDATE OF launch_id, chain_id, network_environment, artifact_id
  ON public.launch_chain_deployments
  FOR EACH ROW EXECUTE FUNCTION public.enforce_canonical_pcart_no_production_deployment();

COMMIT;
