-- C8.2 — Owner-only Robinhood Chain TESTNET deployment plumbing.
-- Subordinate to public.launches. Records WORKFLOW only; the chain is truth.
-- Structurally incapable of writing launches.official_contract_address or
-- changing launch lifecycle: no function here updates public.launches.

CREATE TABLE public.launch_chain_deployments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
  launch_id uuid NOT NULL REFERENCES public.launches(id) ON DELETE CASCADE,
  attempt_number integer NOT NULL CHECK (attempt_number > 0),
  client_request_id text NOT NULL CHECK (char_length(client_request_id) BETWEEN 8 AND 128),
  chain_id bigint NOT NULL CHECK (chain_id = 46630),
  network_environment text NOT NULL CHECK (network_environment = 'TESTNET'),
  deployer_address text NOT NULL CHECK (deployer_address ~ '^0x[0-9a-f]{40}$'),
  tx_hash text NULL CHECK (tx_hash IS NULL OR tx_hash ~ '^0x[0-9a-f]{64}$'),
  contract_address text NULL CHECK (contract_address IS NULL OR contract_address ~ '^0x[0-9a-f]{40}$'),
  status text NOT NULL DEFAULT 'DRAFT'
    CHECK (status IN ('DRAFT','SUBMITTED','PENDING','CONFIRMED','FAILED','ABANDONED')),
  block_number bigint NULL CHECK (block_number IS NULL OR block_number >= 0),
  block_hash text NULL CHECK (block_hash IS NULL OR block_hash ~ '^0x[0-9a-f]{64}$'),
  confirmations integer NOT NULL DEFAULT 0 CHECK (confirmations >= 0),
  submitted_at timestamptz NULL,
  verified_at timestamptz NULL,
  last_checked_at timestamptz NULL,
  failure_code text NULL CHECK (failure_code IS NULL OR char_length(failure_code) <= 64),
  failure_detail text NULL CHECK (failure_detail IS NULL OR char_length(failure_detail) <= 2000),
  created_by uuid NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

GRANT SELECT ON public.launch_chain_deployments TO authenticated;
GRANT ALL ON public.launch_chain_deployments TO service_role;

ALTER TABLE public.launch_chain_deployments ENABLE ROW LEVEL SECURITY;

-- Read requires BOTH gates. No INSERT/UPDATE/DELETE policy exists at all,
-- so the browser can never mutate this table directly.
CREATE POLICY "Platform owner operators read launch chain deployments"
  ON public.launch_chain_deployments
  FOR SELECT
  TO authenticated
  USING (
    public.is_platform_owner(auth.uid())
    AND public.is_workspace_operator(workspace_id, auth.uid())
  );

CREATE UNIQUE INDEX launch_chain_deployments_launch_request_key
  ON public.launch_chain_deployments (launch_id, client_request_id);

CREATE UNIQUE INDEX launch_chain_deployments_chain_tx_key
  ON public.launch_chain_deployments (chain_id, tx_hash)
  WHERE tx_hash IS NOT NULL;

CREATE UNIQUE INDEX launch_chain_deployments_launch_attempt_key
  ON public.launch_chain_deployments (launch_id, attempt_number);

CREATE INDEX launch_chain_deployments_launch_created_idx
  ON public.launch_chain_deployments (launch_id, created_at DESC);

CREATE TRIGGER launch_chain_deployments_set_updated_at
  BEFORE UPDATE ON public.launch_chain_deployments
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- Tenant coherence: workspace_id must always equal the launch's workspace.
CREATE OR REPLACE FUNCTION public.enforce_launch_chain_deployment_tenant()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_workspace uuid;
BEGIN
  SELECT l.workspace_id INTO v_workspace FROM public.launches l WHERE l.id = NEW.launch_id;
  IF v_workspace IS NULL OR v_workspace <> NEW.workspace_id THEN
    RAISE EXCEPTION 'Launch/workspace mismatch' USING ERRCODE = '42501';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER launch_chain_deployments_tenant
  BEFORE INSERT ON public.launch_chain_deployments
  FOR EACH ROW EXECUTE FUNCTION public.enforce_launch_chain_deployment_tenant();

-- Immutable identity + strict forward-only state machine, enforced in the DB.
CREATE OR REPLACE FUNCTION public.enforce_launch_chain_deployment_update()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NEW.workspace_id <> OLD.workspace_id
     OR NEW.launch_id <> OLD.launch_id
     OR NEW.attempt_number <> OLD.attempt_number
     OR NEW.client_request_id <> OLD.client_request_id
     OR NEW.chain_id <> OLD.chain_id
     OR NEW.network_environment <> OLD.network_environment
     OR NEW.deployer_address <> OLD.deployer_address
     OR NEW.created_at <> OLD.created_at
     OR NEW.created_by IS DISTINCT FROM OLD.created_by THEN
    RAISE EXCEPTION 'Deployment attempt identity is immutable' USING ERRCODE = '42501';
  END IF;

  -- A broadcast transaction hash can never be swapped for another.
  IF OLD.tx_hash IS NOT NULL AND NEW.tx_hash IS DISTINCT FROM OLD.tx_hash THEN
    RAISE EXCEPTION 'Transaction hash is immutable' USING ERRCODE = '42501';
  END IF;

  -- Terminal rows are frozen. Repeated verification of a terminal row is a
  -- no-op at the RPC layer, so it never reaches this trigger.
  IF OLD.status IN ('CONFIRMED','FAILED','ABANDONED') THEN
    RAISE EXCEPTION 'Deployment attempt is final' USING ERRCODE = '42501';
  END IF;

  IF NEW.status <> OLD.status THEN
    IF NOT (
      (OLD.status = 'DRAFT' AND NEW.status IN ('SUBMITTED','ABANDONED'))
      OR (OLD.status = 'SUBMITTED' AND NEW.status IN ('PENDING','CONFIRMED','FAILED'))
      OR (OLD.status = 'PENDING' AND NEW.status IN ('CONFIRMED','FAILED'))
    ) THEN
      RAISE EXCEPTION 'Invalid deployment status transition % -> %', OLD.status, NEW.status
        USING ERRCODE = '42501';
    END IF;
  END IF;

  IF NEW.status = 'CONFIRMED' AND (NEW.contract_address IS NULL OR NEW.verified_at IS NULL) THEN
    RAISE EXCEPTION 'Confirmed deployment requires a verified contract address'
      USING ERRCODE = '42501';
  END IF;

  RETURN NEW;
END;
$$;

CREATE TRIGGER launch_chain_deployments_update
  BEFORE UPDATE ON public.launch_chain_deployments
  FOR EACH ROW EXECUTE FUNCTION public.enforce_launch_chain_deployment_update();

-- Shared gate: platform owner AND workspace operator for the launch's tenant.
-- Returns the launch workspace, or raises a GENERIC error (no tenant leak).
CREATE OR REPLACE FUNCTION public.authorize_launch_chain_deployment(_launch_id uuid)
RETURNS uuid
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_workspace uuid;
BEGIN
  IF auth.uid() IS NULL OR NOT public.is_platform_owner(auth.uid()) THEN
    RAISE EXCEPTION 'Not authorized' USING ERRCODE = '42501';
  END IF;
  SELECT l.workspace_id INTO v_workspace FROM public.launches l WHERE l.id = _launch_id;
  IF v_workspace IS NULL OR NOT public.is_workspace_operator(v_workspace, auth.uid()) THEN
    RAISE EXCEPTION 'Not authorized' USING ERRCODE = '42501';
  END IF;
  RETURN v_workspace;
END;
$$;

REVOKE ALL ON FUNCTION public.authorize_launch_chain_deployment(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.authorize_launch_chain_deployment(uuid) TO authenticated, service_role;

-- 1. Create (or idempotently return) a DRAFT attempt.
CREATE OR REPLACE FUNCTION public.create_launch_chain_deployment_attempt(
  _launch_id uuid,
  _client_request_id text,
  _deployer_address text
)
RETURNS public.launch_chain_deployments
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_workspace uuid;
  v_request text := btrim(coalesce(_client_request_id, ''));
  v_deployer text := lower(btrim(coalesce(_deployer_address, '')));
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
      chain_id, network_environment, deployer_address, status, created_by
    ) VALUES (
      v_workspace, _launch_id, v_next, v_request,
      46630, 'TESTNET', v_deployer, 'DRAFT', auth.uid()
    )
    RETURNING * INTO v_row;
  EXCEPTION WHEN unique_violation THEN
    SELECT * INTO v_row FROM public.launch_chain_deployments
     WHERE launch_id = _launch_id AND client_request_id = v_request;
    IF NOT FOUND THEN RAISE; END IF;
  END;

  RETURN v_row;
END;
$$;

REVOKE ALL ON FUNCTION public.create_launch_chain_deployment_attempt(uuid, text, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.create_launch_chain_deployment_attempt(uuid, text, text) TO authenticated;

-- 2. Record the broadcast transaction hash. Idempotent for the same hash.
CREATE OR REPLACE FUNCTION public.submit_launch_chain_deployment_tx(
  _deployment_id uuid,
  _tx_hash text
)
RETURNS public.launch_chain_deployments
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_row public.launch_chain_deployments;
  v_hash text := lower(btrim(coalesce(_tx_hash, '')));
BEGIN
  SELECT * INTO v_row FROM public.launch_chain_deployments WHERE id = _deployment_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Not authorized' USING ERRCODE = '42501';
  END IF;
  PERFORM public.authorize_launch_chain_deployment(v_row.launch_id);

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
$$;

REVOKE ALL ON FUNCTION public.submit_launch_chain_deployment_tx(uuid, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.submit_launch_chain_deployment_tx(uuid, text) TO authenticated;

-- 3. Abandon a DRAFT attempt (wallet cancelled before broadcast). Idempotent.
CREATE OR REPLACE FUNCTION public.abandon_launch_chain_deployment_attempt(
  _deployment_id uuid,
  _reason text DEFAULT NULL
)
RETURNS public.launch_chain_deployments
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_row public.launch_chain_deployments;
BEGIN
  SELECT * INTO v_row FROM public.launch_chain_deployments WHERE id = _deployment_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Not authorized' USING ERRCODE = '42501';
  END IF;
  PERFORM public.authorize_launch_chain_deployment(v_row.launch_id);

  IF v_row.status = 'ABANDONED' THEN
    RETURN v_row;
  END IF;
  IF v_row.status <> 'DRAFT' THEN
    RAISE EXCEPTION 'Only an unbroadcast attempt can be abandoned' USING ERRCODE = '42501';
  END IF;

  UPDATE public.launch_chain_deployments
     SET status = 'ABANDONED',
         failure_code = 'ABANDONED',
         failure_detail = left(btrim(coalesce(_reason, 'Cancelled in wallet')), 2000)
   WHERE id = _deployment_id
   RETURNING * INTO v_row;

  RETURN v_row;
END;
$$;

REVOKE ALL ON FUNCTION public.abandon_launch_chain_deployment_attempt(uuid, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.abandon_launch_chain_deployment_attempt(uuid, text) TO authenticated;

-- 4. Apply an independently chain-verified result. SERVICE ROLE ONLY: the
-- browser cannot forge a confirmation. Idempotent and reorg-conservative.
CREATE OR REPLACE FUNCTION public.apply_launch_chain_deployment_verification(
  _deployment_id uuid,
  _status text,
  _confirmations integer DEFAULT 0,
  _contract_address text DEFAULT NULL,
  _block_number bigint DEFAULT NULL,
  _block_hash text DEFAULT NULL,
  _failure_code text DEFAULT NULL,
  _failure_detail text DEFAULT NULL
)
RETURNS public.launch_chain_deployments
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_row public.launch_chain_deployments;
  v_status text := upper(btrim(coalesce(_status, '')));
  v_addr text := nullif(lower(btrim(coalesce(_contract_address, ''))), '');
  v_bhash text := nullif(lower(btrim(coalesce(_block_hash, ''))), '');
BEGIN
  IF v_status NOT IN ('PENDING','CONFIRMED','FAILED') THEN
    RAISE EXCEPTION 'Invalid verification status' USING ERRCODE = '22023';
  END IF;
  IF v_addr IS NOT NULL AND v_addr !~ '^0x[0-9a-f]{40}$' THEN
    RAISE EXCEPTION 'Invalid contract address' USING ERRCODE = '22023';
  END IF;
  IF v_bhash IS NOT NULL AND v_bhash !~ '^0x[0-9a-f]{64}$' THEN
    RAISE EXCEPTION 'Invalid block hash' USING ERRCODE = '22023';
  END IF;
  IF v_status = 'CONFIRMED' AND v_addr IS NULL THEN
    RAISE EXCEPTION 'Confirmation requires a contract address' USING ERRCODE = '22023';
  END IF;

  SELECT * INTO v_row FROM public.launch_chain_deployments WHERE id = _deployment_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Unknown deployment attempt' USING ERRCODE = '42704';
  END IF;

  -- Already final: repeated callbacks are a safe no-op.
  IF v_row.status IN ('CONFIRMED','FAILED','ABANDONED') THEN
    RETURN v_row;
  END IF;
  -- Nothing broadcast yet: verification is meaningless.
  IF v_row.status = 'DRAFT' THEN
    RETURN v_row;
  END IF;

  UPDATE public.launch_chain_deployments
     SET status = v_status,
         confirmations = greatest(coalesce(_confirmations, 0), 0),
         -- Pre-confirmation block data is provisional and always overwritten,
         -- so a reorged block hash never lingers as stale proof.
         contract_address = v_addr,
         block_number = _block_number,
         block_hash = v_bhash,
         last_checked_at = now(),
         verified_at = CASE WHEN v_status = 'CONFIRMED' THEN now() ELSE NULL END,
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

REVOKE ALL ON FUNCTION public.apply_launch_chain_deployment_verification(uuid, text, integer, text, bigint, text, text, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.apply_launch_chain_deployment_verification(uuid, text, integer, text, bigint, text, text, text) TO service_role;

-- 5. Read attempts for a launch (both gates enforced server-side).
CREATE OR REPLACE FUNCTION public.list_launch_chain_deployments(_launch_id uuid)
RETURNS SETOF public.launch_chain_deployments
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  PERFORM public.authorize_launch_chain_deployment(_launch_id);
  RETURN QUERY
    SELECT * FROM public.launch_chain_deployments
     WHERE launch_id = _launch_id
     ORDER BY attempt_number DESC;
END;
$$;

REVOKE ALL ON FUNCTION public.list_launch_chain_deployments(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.list_launch_chain_deployments(uuid) TO authenticated;