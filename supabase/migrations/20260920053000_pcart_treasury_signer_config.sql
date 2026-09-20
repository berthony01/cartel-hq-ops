-- PCART Treasury Signer Setup Foundation — Phase A
--
-- Records the THREE INTENDED public signer wallet addresses for a launch's
-- future 2-of-3 Safe treasury. Public addresses only: no private key, no seed
-- phrase, no label, no secret, no Safe address, no on-chain status. Row
-- existence means "signers ready". Creating the Safe, signing and moving value
-- are separate, later, explicitly authorized steps. Nothing here touches chain.

CREATE TABLE public.launch_treasury_signer_configs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
  launch_id uuid NOT NULL REFERENCES public.launches(id) ON DELETE CASCADE,
  signer_1 text NOT NULL,
  signer_2 text NOT NULL,
  signer_3 text NOT NULL,
  threshold smallint NOT NULL DEFAULT 2,
  created_by uuid NOT NULL,
  updated_by uuid NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT launch_treasury_signer_configs_launch_unique UNIQUE (launch_id),
  CONSTRAINT launch_treasury_signer_configs_threshold_fixed
    CHECK (threshold = 2),
  CONSTRAINT launch_treasury_signer_configs_signer_1_shape
    CHECK (signer_1 ~ '^0x[0-9a-f]{40}$'),
  CONSTRAINT launch_treasury_signer_configs_signer_2_shape
    CHECK (signer_2 ~ '^0x[0-9a-f]{40}$'),
  CONSTRAINT launch_treasury_signer_configs_signer_3_shape
    CHECK (signer_3 ~ '^0x[0-9a-f]{40}$'),
  CONSTRAINT launch_treasury_signer_configs_signers_nonzero
    CHECK (
      signer_1 <> ('0x' || repeat('0', 40))
      AND signer_2 <> ('0x' || repeat('0', 40))
      AND signer_3 <> ('0x' || repeat('0', 40))
    ),
  CONSTRAINT launch_treasury_signer_configs_signers_distinct
    CHECK (
      signer_1 <> signer_2
      AND signer_1 <> signer_3
      AND signer_2 <> signer_3
    )
);

CREATE INDEX idx_launch_treasury_signer_configs_workspace
  ON public.launch_treasury_signer_configs(workspace_id);

-- No anon grant and no DELETE grant anywhere. Owner-only by policy.
GRANT SELECT, INSERT, UPDATE ON public.launch_treasury_signer_configs TO authenticated;
GRANT ALL ON public.launch_treasury_signer_configs TO service_role;

ALTER TABLE public.launch_treasury_signer_configs ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Workspace owner reads its treasury signer config"
  ON public.launch_treasury_signer_configs
  FOR SELECT TO authenticated
  USING (public.is_workspace_owner(workspace_id, auth.uid()));

CREATE POLICY "Workspace owner inserts its treasury signer config"
  ON public.launch_treasury_signer_configs
  FOR INSERT TO authenticated
  WITH CHECK (public.is_workspace_owner(workspace_id, auth.uid()));

CREATE POLICY "Workspace owner updates its treasury signer config"
  ON public.launch_treasury_signer_configs
  FOR UPDATE TO authenticated
  USING (public.is_workspace_owner(workspace_id, auth.uid()))
  WITH CHECK (public.is_workspace_owner(workspace_id, auth.uid()));

-- No DELETE policy: this configuration is not removable through the Data API.

CREATE TRIGGER update_launch_treasury_signer_configs_updated_at
  BEFORE UPDATE ON public.launch_treasury_signer_configs
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- ---------------------------------------------------------------- save RPC
-- Owner-only upsert. The workspace is resolved FROM THE LAUNCH ROW and is
-- never accepted from the client. Threshold is the server-side literal 2.
CREATE OR REPLACE FUNCTION public.save_launch_treasury_signers(
  _launch_id uuid,
  _signer_1 text,
  _signer_2 text,
  _signer_3 text
)
RETURNS public.launch_treasury_signer_configs
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_workspace_id uuid;
  v_s1 text;
  v_s2 text;
  v_s3 text;
  v_zero text := '0x' || repeat('0', 40);
  v_row public.launch_treasury_signer_configs;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'Authentication required.';
  END IF;

  SELECT l.workspace_id INTO v_workspace_id
  FROM public.launches l
  WHERE l.id = _launch_id;

  IF v_workspace_id IS NULL THEN
    RAISE EXCEPTION 'Launch not found.';
  END IF;

  IF NOT public.is_workspace_owner(v_workspace_id, v_uid) THEN
    RAISE EXCEPTION 'Only the workspace owner can set treasury signers.';
  END IF;

  v_s1 := lower(btrim(coalesce(_signer_1, '')));
  v_s2 := lower(btrim(coalesce(_signer_2, '')));
  v_s3 := lower(btrim(coalesce(_signer_3, '')));

  IF v_s1 !~ '^0x[0-9a-f]{40}$'
     OR v_s2 !~ '^0x[0-9a-f]{40}$'
     OR v_s3 !~ '^0x[0-9a-f]{40}$' THEN
    RAISE EXCEPTION 'Each signer must be a valid 0x wallet address.';
  END IF;

  IF v_s1 = v_zero OR v_s2 = v_zero OR v_s3 = v_zero THEN
    RAISE EXCEPTION 'A signer address cannot be the empty address.';
  END IF;

  IF v_s1 = v_s2 OR v_s1 = v_s3 OR v_s2 = v_s3 THEN
    RAISE EXCEPTION 'The three signer addresses must be different.';
  END IF;

  INSERT INTO public.launch_treasury_signer_configs AS c (
    workspace_id, launch_id, signer_1, signer_2, signer_3,
    threshold, created_by, updated_by
  )
  VALUES (v_workspace_id, _launch_id, v_s1, v_s2, v_s3, 2, v_uid, v_uid)
  ON CONFLICT (launch_id) DO UPDATE
    SET signer_1 = EXCLUDED.signer_1,
        signer_2 = EXCLUDED.signer_2,
        signer_3 = EXCLUDED.signer_3,
        threshold = 2,
        updated_by = v_uid,
        updated_at = now()
    WHERE c.workspace_id = v_workspace_id
  RETURNING * INTO v_row;

  IF v_row IS NULL THEN
    RAISE EXCEPTION 'Treasury signers could not be saved.';
  END IF;

  RETURN v_row;
END;
$$;

REVOKE ALL ON FUNCTION public.save_launch_treasury_signers(uuid, text, text, text)
  FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.save_launch_treasury_signers(uuid, text, text, text)
  TO authenticated;
