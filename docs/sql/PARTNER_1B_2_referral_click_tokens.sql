-- PARTNER PROGRAM PHASE 1B-2 — SERVER-ISSUED REFERRAL CLICK TOKENS
-- STAGED FOR REVIEW ONLY. NOT APPLIED. Do not run without explicit authorization.
--
-- Replaces trust in a browser-held referral code/timestamp with a
-- server-issued, high-entropy opaque token. Only the SHA-256 hash of the
-- token is stored. No raw token, IP, fingerprint, user agent, email or PII.
-- Attribution time is the SERVER created_at of the click; the client never
-- supplies a timestamp. bind_referral_to_workspace is unchanged: it keeps
-- reading partner_referrals.attributed_at (now the server click time), so the
-- new-workspace (WORKSPACE_PREDATES_REFERRAL) guard and window checks hold.
-- Owner unrestricted access is untouched (no commercial gate here).

CREATE TABLE IF NOT EXISTS public.partner_referral_clicks (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  token_hash text NOT NULL UNIQUE CHECK (token_hash ~ '^[0-9a-f]{64}$'),
  partner_id uuid NOT NULL REFERENCES public.partners(id),
  terms_version integer NOT NULL REFERENCES public.partner_program_terms(version),
  status text NOT NULL DEFAULT 'issued' CHECK (status IN ('issued','claimed','rejected')),
  created_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz NOT NULL,
  claimed_by uuid NULL,
  claimed_at timestamptz NULL,
  CONSTRAINT partner_referral_clicks_expiry_after_create CHECK (expires_at > created_at),
  CONSTRAINT partner_referral_clicks_claim_shape CHECK (
    (status = 'issued' AND claimed_by IS NULL AND claimed_at IS NULL) OR
    (status IN ('claimed','rejected') AND claimed_by IS NOT NULL AND claimed_at IS NOT NULL)
  )
);
-- Cleanup of stale unclaimed tokens, and per-partner rate-limit window scans.
CREATE INDEX IF NOT EXISTS partner_referral_clicks_unclaimed_expiry_idx
  ON public.partner_referral_clicks (expires_at) WHERE status = 'issued';
CREATE INDEX IF NOT EXISTS partner_referral_clicks_partner_created_idx
  ON public.partner_referral_clicks (partner_id, created_at);
CREATE INDEX IF NOT EXISTS partner_referral_clicks_terms_idx
  ON public.partner_referral_clicks (terms_version);

-- Least privilege: service_role only. No anon/authenticated table access.
REVOKE ALL ON public.partner_referral_clicks FROM PUBLIC, anon, authenticated;
GRANT ALL ON public.partner_referral_clicks TO service_role;
ALTER TABLE public.partner_referral_clicks ENABLE ROW LEVEL SECURITY;
-- Intentionally NO policies: direct client access is denied by RLS.

-- ---------------------------------------------------------------------
-- Issuance (service_role only; called by the pre-auth capture function).
-- Returns a uniform shape; callers must not reveal the reason publicly.
-- ---------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.partner_issue_referral_click(_code text, _token_hash text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE v_code text; v_t public.partner_program_terms; v_p public.partners; v_recent integer; v_exp timestamptz;
BEGIN
  IF coalesce(auth.role(), '') <> 'service_role' THEN RAISE EXCEPTION 'SERVICE_ROLE_REQUIRED' USING ERRCODE = '42501'; END IF;
  v_code := lower(btrim(coalesce(_code, '')));
  IF v_code !~ '^[a-z0-9]{10}$' OR coalesce(_token_hash, '') !~ '^[0-9a-f]{64}$' THEN
    RETURN jsonb_build_object('issued', false);
  END IF;
  v_t := public.partner_active_terms();
  IF v_t.id IS NULL OR v_t.attribution_window_days IS NULL THEN RETURN jsonb_build_object('issued', false); END IF;
  SELECT * INTO v_p FROM public.partners
   WHERE referral_code = v_code AND status = 'approved' AND is_affiliate AND approved_at IS NOT NULL;
  IF v_p.id IS NULL THEN RETURN jsonb_build_object('issued', false); END IF;
  -- Per-code server bucket (no IP/device data): max 300 issued clicks per partner per rolling hour.
  SELECT count(*) INTO v_recent FROM public.partner_referral_clicks
   WHERE partner_id = v_p.id AND created_at > now() - interval '1 hour';
  IF v_recent >= 300 THEN RETURN jsonb_build_object('issued', false); END IF;
  v_exp := now() + make_interval(days => v_t.attribution_window_days);
  INSERT INTO public.partner_referral_clicks (token_hash, partner_id, terms_version, expires_at)
  VALUES (_token_hash, v_p.id, v_t.version, v_exp)
  ON CONFLICT (token_hash) DO NOTHING;
  IF NOT FOUND THEN RETURN jsonb_build_object('issued', false); END IF;
  RETURN jsonb_build_object('issued', true, 'expires_at', v_exp);
END $$;

-- ---------------------------------------------------------------------
-- Claim (authenticated). auth.uid() + server time only. Atomic first-valid.
-- Client-facing reasons are coarse: TOKEN_INVALID covers unknown, expired,
-- already-claimed and malformed tokens, so tokens cannot be probed.
-- ---------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.claim_referral_click(_token text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE v_uid uuid := auth.uid(); v_hash text; v_c public.partner_referral_clicks; v_p public.partners; v_t public.partner_program_terms; v_ins uuid;
BEGIN
  IF v_uid IS NULL THEN RAISE EXCEPTION 'AUTH_REQUIRED' USING ERRCODE = '42501'; END IF;
  IF coalesce(_token, '') !~ '^[A-Za-z0-9_-]{43}$' THEN RETURN jsonb_build_object('ok', false, 'reason', 'TOKEN_INVALID'); END IF;
  -- First valid attribution already exists: never overwrite; token stays unclaimed.
  IF EXISTS (SELECT 1 FROM public.partner_referrals WHERE referred_user_id = v_uid AND status IN ('pending','qualified')) THEN
    RETURN jsonb_build_object('ok', true, 'already_attributed', true);
  END IF;
  v_hash := encode(pg_catalog.sha256(convert_to(_token, 'UTF8')), 'hex');
  -- Atomic single-use claim; concurrent claimers serialize on the row lock.
  UPDATE public.partner_referral_clicks
     SET status = 'claimed', claimed_by = v_uid, claimed_at = now()
   WHERE token_hash = v_hash AND status = 'issued' AND expires_at > now()
  RETURNING * INTO v_c;
  IF v_c.id IS NULL THEN RETURN jsonb_build_object('ok', false, 'reason', 'TOKEN_INVALID'); END IF;
  SELECT * INTO v_p FROM public.partners WHERE id = v_c.partner_id;
  IF v_p.id IS NULL OR v_p.status <> 'approved' OR NOT v_p.is_affiliate THEN
    UPDATE public.partner_referral_clicks SET status = 'rejected' WHERE id = v_c.id;
    RETURN jsonb_build_object('ok', false, 'reason', 'REFERRAL_NOT_ACTIVE');
  END IF;
  IF v_p.user_id = v_uid THEN
    UPDATE public.partner_referral_clicks SET status = 'rejected' WHERE id = v_c.id;
    RETURN jsonb_build_object('ok', false, 'reason', 'SELF_REFERRAL');
  END IF;
  SELECT * INTO v_t FROM public.partner_program_terms WHERE version = v_c.terms_version;
  IF v_t.id IS NULL OR v_t.status NOT IN ('active','retired') THEN
    UPDATE public.partner_referral_clicks SET status = 'rejected' WHERE id = v_c.id;
    RETURN jsonb_build_object('ok', false, 'reason', 'REFERRAL_NOT_ACTIVE');
  END IF;
  -- attributed_at = SERVER click time (never client-supplied).
  INSERT INTO public.partner_referrals (partner_id, referred_user_id, terms_version, source, attributed_at)
  VALUES (v_p.id, v_uid, v_c.terms_version, 'link', v_c.created_at)
  ON CONFLICT (referred_user_id) WHERE status IN ('pending','qualified') DO NOTHING
  RETURNING id INTO v_ins;
  IF v_ins IS NULL THEN
    -- Lost a concurrent race to another valid attribution: first valid wins.
    UPDATE public.partner_referral_clicks SET status = 'rejected' WHERE id = v_c.id;
    RETURN jsonb_build_object('ok', true, 'already_attributed', true);
  END IF;
  RETURN jsonb_build_object('ok', true, 'already_attributed', false);
END $$;

-- Cleanup (service_role only): remove long-expired unclaimed tokens.
CREATE OR REPLACE FUNCTION public.partner_purge_expired_referral_clicks()
RETURNS integer LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE n integer;
BEGIN
  IF coalesce(auth.role(), '') <> 'service_role' THEN RAISE EXCEPTION 'SERVICE_ROLE_REQUIRED' USING ERRCODE = '42501'; END IF;
  DELETE FROM public.partner_referral_clicks WHERE status = 'issued' AND expires_at < now() - interval '7 days';
  GET DIAGNOSTICS n = ROW_COUNT;
  RETURN n;
END $$;

REVOKE ALL ON FUNCTION public.partner_issue_referral_click(text, text) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.claim_referral_click(text) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.partner_purge_expired_referral_clicks() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.partner_issue_referral_click(text, text) TO service_role;
GRANT EXECUTE ON FUNCTION public.claim_referral_click(text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.partner_purge_expired_referral_clicks() TO service_role;

-- Legacy code-based attribution trusted a browser-held code: close it.
REVOKE ALL ON FUNCTION public.record_referral_attribution(text, text) FROM PUBLIC, anon, authenticated;
