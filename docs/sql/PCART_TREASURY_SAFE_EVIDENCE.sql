-- PCART treasury Safe evidence — STAGED, NOT APPLIED.
-- Apply only with explicit owner authorization. Rollback:
-- docs/sql/PCART_TREASURY_SAFE_EVIDENCE_ROLLBACK.sql
--
-- Extends the existing launch_treasury_signer_configs row (no parallel table)
-- with nullable verified-Safe evidence. Evidence is writable ONLY through the
-- owner-only SECURITY DEFINER RPC below, which the app calls only after a fresh
-- server-side canonical Safe v1.4.1 verification against the saved owners.
-- Readiness never trusts these columns alone; it re-verifies on chain.
-- No delete path. Signer fields lock once a Safe address is recorded.

ALTER TABLE public.launch_treasury_signer_configs
  ADD COLUMN IF NOT EXISTS safe_address text,
  ADD COLUMN IF NOT EXISTS safe_salt_nonce text,
  ADD COLUMN IF NOT EXISTS safe_creation_tx_hash text,
  ADD COLUMN IF NOT EXISTS safe_verified_at timestamptz,
  ADD COLUMN IF NOT EXISTS safe_verified_block bigint;

ALTER TABLE public.launch_treasury_signer_configs
  ADD CONSTRAINT launch_treasury_signer_configs_safe_address_shape
    CHECK (safe_address IS NULL OR (safe_address ~ '^0x[0-9a-f]{40}$' AND safe_address <> ('0x' || repeat('0', 40)))),
  ADD CONSTRAINT launch_treasury_signer_configs_safe_salt_shape
    CHECK (safe_salt_nonce IS NULL OR safe_salt_nonce ~ '^(0|[1-9][0-9]{0,77})$'),
  ADD CONSTRAINT launch_treasury_signer_configs_safe_tx_shape
    CHECK (safe_creation_tx_hash IS NULL OR safe_creation_tx_hash ~ '^0x[0-9a-f]{64}$'),
  ADD CONSTRAINT launch_treasury_signer_configs_safe_block_positive
    CHECK (safe_verified_block IS NULL OR safe_verified_block > 0),
  ADD CONSTRAINT launch_treasury_signer_configs_safe_evidence_complete
    CHECK (
      (safe_address IS NULL AND safe_salt_nonce IS NULL AND safe_creation_tx_hash IS NULL
        AND safe_verified_at IS NULL AND safe_verified_block IS NULL)
      OR (safe_address IS NOT NULL AND safe_salt_nonce IS NOT NULL
        AND safe_verified_at IS NOT NULL AND safe_verified_block IS NOT NULL)
    );

-- Guard: evidence columns change only inside the RPC; signers lock after a Safe exists.
CREATE OR REPLACE FUNCTION public.guard_launch_treasury_safe_evidence()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
DECLARE
  v_rpc boolean := coalesce(current_setting('cartel.treasury_safe_evidence_write', true), '') = 'on';
BEGIN
  IF TG_OP = 'INSERT' THEN
    IF NOT v_rpc AND (NEW.safe_address IS NOT NULL OR NEW.safe_salt_nonce IS NOT NULL
        OR NEW.safe_creation_tx_hash IS NOT NULL OR NEW.safe_verified_at IS NOT NULL
        OR NEW.safe_verified_block IS NOT NULL) THEN
      RAISE EXCEPTION 'Treasury Safe evidence can only be recorded after verification.';
    END IF;
    RETURN NEW;
  END IF;

  IF NOT v_rpc AND (
       NEW.safe_address IS DISTINCT FROM OLD.safe_address
    OR NEW.safe_salt_nonce IS DISTINCT FROM OLD.safe_salt_nonce
    OR NEW.safe_creation_tx_hash IS DISTINCT FROM OLD.safe_creation_tx_hash
    OR NEW.safe_verified_at IS DISTINCT FROM OLD.safe_verified_at
    OR NEW.safe_verified_block IS DISTINCT FROM OLD.safe_verified_block) THEN
    RAISE EXCEPTION 'Treasury Safe evidence can only be recorded after verification.';
  END IF;

  IF OLD.safe_address IS NOT NULL AND (
       NEW.signer_1 IS DISTINCT FROM OLD.signer_1
    OR NEW.signer_2 IS DISTINCT FROM OLD.signer_2
    OR NEW.signer_3 IS DISTINCT FROM OLD.signer_3
    OR NEW.threshold IS DISTINCT FROM OLD.threshold) THEN
    RAISE EXCEPTION 'Signer wallets are locked because the treasury Safe already exists.';
  END IF;

  IF OLD.safe_address IS NOT NULL AND NEW.safe_address IS DISTINCT FROM OLD.safe_address THEN
    RAISE EXCEPTION 'A recorded treasury Safe address cannot be replaced.';
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS guard_launch_treasury_safe_evidence ON public.launch_treasury_signer_configs;
CREATE TRIGGER guard_launch_treasury_safe_evidence
  BEFORE INSERT OR UPDATE ON public.launch_treasury_signer_configs
  FOR EACH ROW EXECUTE FUNCTION public.guard_launch_treasury_safe_evidence();

CREATE OR REPLACE FUNCTION public.save_launch_treasury_safe_evidence(
  _launch_id uuid,
  _safe_address text,
  _safe_salt_nonce text,
  _safe_creation_tx_hash text,
  _safe_verified_block bigint
)
RETURNS public.launch_treasury_signer_configs
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_row public.launch_treasury_signer_configs;
  v_addr text := lower(btrim(coalesce(_safe_address, '')));
  v_salt text := btrim(coalesce(_safe_salt_nonce, ''));
  v_tx text := nullif(lower(btrim(coalesce(_safe_creation_tx_hash, ''))), '');
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'Authentication required.';
  END IF;

  SELECT * INTO v_row FROM public.launch_treasury_signer_configs
  WHERE launch_id = _launch_id
  FOR UPDATE;

  IF v_row.id IS NULL THEN
    RAISE EXCEPTION 'Save the treasury signer wallets first.';
  END IF;
  IF NOT public.is_workspace_owner(v_row.workspace_id, v_uid) THEN
    RAISE EXCEPTION 'Only the workspace owner can record the treasury Safe.';
  END IF;
  IF v_addr !~ '^0x[0-9a-f]{40}$' OR v_addr = ('0x' || repeat('0', 40)) THEN
    RAISE EXCEPTION 'Invalid Safe address.';
  END IF;
  IF v_salt !~ '^(0|[1-9][0-9]{0,77})$' THEN
    RAISE EXCEPTION 'Invalid salt nonce.';
  END IF;
  IF v_tx IS NOT NULL AND v_tx !~ '^0x[0-9a-f]{64}$' THEN
    RAISE EXCEPTION 'Invalid transaction hash.';
  END IF;
  IF _safe_verified_block IS NULL OR _safe_verified_block <= 0 THEN
    RAISE EXCEPTION 'Invalid verification block.';
  END IF;
  IF v_row.safe_address IS NOT NULL AND v_row.safe_address <> v_addr THEN
    RAISE EXCEPTION 'A different treasury Safe is already recorded.';
  END IF;

  PERFORM set_config('cartel.treasury_safe_evidence_write', 'on', true);

  UPDATE public.launch_treasury_signer_configs
     SET safe_address = v_addr,
         safe_salt_nonce = v_salt,
         safe_creation_tx_hash = coalesce(v_tx, safe_creation_tx_hash),
         safe_verified_at = now(),
         safe_verified_block = _safe_verified_block,
         updated_by = v_uid
   WHERE id = v_row.id
  RETURNING * INTO v_row;

  PERFORM set_config('cartel.treasury_safe_evidence_write', '', true);

  RETURN v_row;
END;
$$;

REVOKE ALL ON FUNCTION public.save_launch_treasury_safe_evidence(uuid, text, text, text, bigint)
  FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.save_launch_treasury_safe_evidence(uuid, text, text, text, bigint)
  TO authenticated;
