-- =====================================================================
-- PARTNER PROGRAM PHASE 1A — DATABASE CONTRACT (STAGED, NOT APPLIED)
-- Status: STAGED FOR REVIEW ONLY. Do not execute without explicit approval.
--
-- Scope:
--   * Affiliate + Service Partner identity, applications, owner approval.
--   * Configurable program terms, inactive until the platform owner activates.
--   * Referral attribution, immutable commission ledger, manual payouts.
--   * Tax-document READINESS STATUS only (no documents or identifiers).
--
-- Explicitly NOT in this phase:
--   * No service-partner workspace access. No workspace_members mutation.
--   * No automated accrual from Stripe (Phase 1B). No payout rail.
--   * No change to plans, prices, entitlements, billing lifecycle.
--
-- Owner authority: public.is_platform_owner(uuid) (existing server authority).
-- Additive + idempotent: IF NOT EXISTS / CREATE OR REPLACE / guarded policies.
-- =====================================================================

-- ---------------------------------------------------------------------
-- A) partner_program_terms
-- ---------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.partner_program_terms (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  version integer NOT NULL UNIQUE CHECK (version > 0),
  status text NOT NULL DEFAULT 'draft' CHECK (status IN ('draft','active','retired')),
  commission_bps integer NULL CHECK (commission_bps IS NULL OR (commission_bps > 0 AND commission_bps <= 10000)),
  attribution_window_days integer NULL CHECK (attribution_window_days IS NULL OR attribution_window_days > 0),
  hold_days integer NULL CHECK (hold_days IS NULL OR hold_days >= 0),
  min_payout_cents integer NULL CHECK (min_payout_cents IS NULL OR min_payout_cents > 0),
  currency text NULL CHECK (currency IS NULL OR currency ~ '^[a-z]{3}$'),
  agreement_text text NULL,
  disclosure_text text NULL,
  activated_at timestamptz NULL,
  activated_by uuid NULL,
  retired_at timestamptz NULL,
  created_by uuid NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS partner_program_terms_one_active
  ON public.partner_program_terms ((true)) WHERE status = 'active';

-- Required-terms guard: an active row must carry every required term.
CREATE OR REPLACE FUNCTION public.partner_terms_validate()
RETURNS trigger LANGUAGE plpgsql SET search_path = '' AS $$
BEGIN
  IF NEW.status = 'active' AND (
       NEW.commission_bps IS NULL OR NEW.attribution_window_days IS NULL
    OR NEW.hold_days IS NULL OR NEW.min_payout_cents IS NULL OR NEW.currency IS NULL
    OR coalesce(btrim(NEW.agreement_text), '') = '' OR coalesce(btrim(NEW.disclosure_text), '') = '') THEN
    RAISE EXCEPTION 'PARTNER_TERMS_INCOMPLETE' USING ERRCODE = '22023';
  END IF;
  IF TG_OP = 'UPDATE' AND OLD.status IN ('active','retired') THEN
    -- Activated terms are frozen except for the status/retirement transition.
    IF NEW.commission_bps IS DISTINCT FROM OLD.commission_bps
      OR NEW.attribution_window_days IS DISTINCT FROM OLD.attribution_window_days
      OR NEW.hold_days IS DISTINCT FROM OLD.hold_days
      OR NEW.min_payout_cents IS DISTINCT FROM OLD.min_payout_cents
      OR NEW.currency IS DISTINCT FROM OLD.currency
      OR NEW.agreement_text IS DISTINCT FROM OLD.agreement_text
      OR NEW.disclosure_text IS DISTINCT FROM OLD.disclosure_text
      OR NEW.version IS DISTINCT FROM OLD.version THEN
      RAISE EXCEPTION 'PARTNER_TERMS_FROZEN' USING ERRCODE = '22023';
    END IF;
    IF OLD.status = 'active' AND NEW.status NOT IN ('active','retired') THEN
      RAISE EXCEPTION 'PARTNER_TERMS_INVALID_TRANSITION' USING ERRCODE = '22023';
    END IF;
    IF OLD.status = 'retired' AND NEW.status <> 'retired' THEN
      RAISE EXCEPTION 'PARTNER_TERMS_RETIRED' USING ERRCODE = '22023';
    END IF;
  END IF;
  NEW.updated_at := now();
  RETURN NEW;
END $$;
CREATE OR REPLACE TRIGGER partner_program_terms_validate
  BEFORE INSERT OR UPDATE ON public.partner_program_terms
  FOR EACH ROW EXECUTE FUNCTION public.partner_terms_validate();

-- ---------------------------------------------------------------------
-- B) partners  (no tax forms, SSN/EIN, bank data, credentials, IPs, images)
-- ---------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.partners (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL UNIQUE,
  is_affiliate boolean NOT NULL DEFAULT false,
  is_service_partner boolean NOT NULL DEFAULT false,
  status text NOT NULL DEFAULT 'applied' CHECK (status IN ('applied','approved','suspended','rejected','terminated')),
  referral_code text NULL UNIQUE CHECK (referral_code IS NULL OR referral_code ~ '^[a-z0-9]{10}$'),
  tax_doc_status text NOT NULL DEFAULT 'not_submitted' CHECK (tax_doc_status IN ('not_submitted','submitted','verified','rejected')),
  approved_by uuid NULL,
  approved_at timestamptz NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT partners_has_kind CHECK (is_affiliate OR is_service_partner),
  CONSTRAINT partners_code_only_when_approved CHECK (referral_code IS NULL OR approved_at IS NOT NULL),
  CONSTRAINT partners_code_only_for_affiliate CHECK (referral_code IS NULL OR is_affiliate)
);
CREATE OR REPLACE TRIGGER partners_set_updated_at
  BEFORE UPDATE ON public.partners FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- ---------------------------------------------------------------------
-- C) partner_applications
-- ---------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.partner_applications (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL,
  wants_affiliate boolean NOT NULL DEFAULT false,
  wants_service_partner boolean NOT NULL DEFAULT false,
  pitch text NOT NULL CHECK (char_length(btrim(pitch)) BETWEEN 1 AND 1000),
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','approved','rejected')),
  terms_version integer NOT NULL REFERENCES public.partner_program_terms(version),
  -- APPLICANT-VISIBLE: the applicant can read this row (row-level RLS), so
  -- review_note is not private. Never put internal-only remarks here.
  review_note text NULL CHECK (review_note IS NULL OR char_length(review_note) <= 2000),
  submitted_at timestamptz NOT NULL DEFAULT now(),
  reviewed_at timestamptz NULL,
  reviewed_by uuid NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT partner_applications_has_kind CHECK (wants_affiliate OR wants_service_partner)
);
CREATE UNIQUE INDEX IF NOT EXISTS partner_applications_one_pending
  ON public.partner_applications (user_id) WHERE status = 'pending';
CREATE OR REPLACE TRIGGER partner_applications_set_updated_at
  BEFORE UPDATE ON public.partner_applications FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- ---------------------------------------------------------------------
-- D) partner_agreement_acceptances (append-only, no IP/fingerprint)
-- ---------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.partner_agreement_acceptances (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  partner_id uuid NOT NULL REFERENCES public.partners(id),
  terms_version integer NOT NULL REFERENCES public.partner_program_terms(version),
  accepted_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT partner_agreement_acceptances_unique UNIQUE (partner_id, terms_version)
);

-- ---------------------------------------------------------------------
-- E) partner_referrals
-- ---------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.partner_referrals (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  partner_id uuid NOT NULL REFERENCES public.partners(id),
  referred_user_id uuid NOT NULL,
  workspace_id uuid NULL REFERENCES public.workspaces(id),
  terms_version integer NOT NULL REFERENCES public.partner_program_terms(version),
  source text NOT NULL CHECK (source IN ('link','code')),
  attributed_at timestamptz NOT NULL DEFAULT now(),
  bound_at timestamptz NULL,
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','qualified','rejected_self','rejected_fraud','expired')),
  reason text NULL CHECK (reason IS NULL OR char_length(reason) <= 500),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
-- First VALID attribution wins: at most one pending/qualified referral per
-- referred user. Rejected/expired rows never block a later valid referral.
CREATE UNIQUE INDEX IF NOT EXISTS partner_referrals_first_valid_attribution
  ON public.partner_referrals (referred_user_id) WHERE status IN ('pending','qualified');
CREATE UNIQUE INDEX IF NOT EXISTS partner_referrals_one_per_workspace
  ON public.partner_referrals (workspace_id) WHERE workspace_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS partner_referrals_partner_idx ON public.partner_referrals (partner_id);
CREATE OR REPLACE TRIGGER partner_referrals_set_updated_at
  BEFORE UPDATE ON public.partner_referrals FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- ---------------------------------------------------------------------
-- G) partner_payout_requests (declared before ledger for FK)
-- ---------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.partner_payout_requests (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  partner_id uuid NOT NULL REFERENCES public.partners(id),
  amount_cents integer NOT NULL CHECK (amount_cents > 0),
  currency text NOT NULL CHECK (currency ~ '^[a-z]{3}$'),
  terms_version integer NOT NULL REFERENCES public.partner_program_terms(version),
  status text NOT NULL DEFAULT 'requested' CHECK (status IN ('requested','approved','rejected','paid','cancelled')),
  reviewer_id uuid NULL,
  review_note text NULL CHECK (review_note IS NULL OR char_length(review_note) <= 2000),
  paid_reference text NULL CHECK (paid_reference IS NULL OR char_length(paid_reference) <= 200),
  requested_at timestamptz NOT NULL DEFAULT now(),
  reviewed_at timestamptz NULL,
  paid_at timestamptz NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS partner_payout_requests_partner_idx ON public.partner_payout_requests (partner_id);
CREATE OR REPLACE TRIGGER partner_payout_requests_set_updated_at
  BEFORE UPDATE ON public.partner_payout_requests FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- ---------------------------------------------------------------------
-- F) partner_commission_ledger (append-only; available derived from available_at)
-- ---------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.partner_commission_ledger (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  partner_id uuid NOT NULL REFERENCES public.partners(id),
  referral_id uuid NULL REFERENCES public.partner_referrals(id),
  workspace_id uuid NULL REFERENCES public.workspaces(id),
  terms_version integer NULL REFERENCES public.partner_program_terms(version),
  entry_type text NOT NULL CHECK (entry_type IN ('accrual','reversal','adjustment','payout')),
  amount_cents integer NOT NULL CHECK (amount_cents <> 0),
  currency text NOT NULL CHECK (currency ~ '^[a-z]{3}$'),
  available_at timestamptz NOT NULL DEFAULT now(),
  source_kind text NOT NULL CHECK (source_kind IN ('manual','stripe_event')),
  source_event_ref text NULL,
  payout_request_id uuid NULL REFERENCES public.partner_payout_requests(id),
  note text NULL CHECK (note IS NULL OR char_length(note) <= 500),
  created_by uuid NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT ledger_sign_by_type CHECK (
       (entry_type = 'accrual'  AND amount_cents > 0)
    OR (entry_type = 'reversal' AND amount_cents < 0)
    OR (entry_type = 'payout'   AND amount_cents < 0 AND payout_request_id IS NOT NULL)
    OR (entry_type = 'adjustment')),
  CONSTRAINT ledger_stripe_needs_ref CHECK (source_kind <> 'stripe_event' OR source_event_ref IS NOT NULL)
);
CREATE UNIQUE INDEX IF NOT EXISTS partner_commission_ledger_source_ref
  ON public.partner_commission_ledger (entry_type, source_event_ref) WHERE source_event_ref IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS partner_commission_ledger_one_payout
  ON public.partner_commission_ledger (payout_request_id) WHERE entry_type = 'payout';
CREATE INDEX IF NOT EXISTS partner_commission_ledger_partner_idx ON public.partner_commission_ledger (partner_id);

-- Append-only guard for ledger + acceptances (never UPDATE or DELETE).
CREATE OR REPLACE FUNCTION public.partner_append_only_guard()
RETURNS trigger LANGUAGE plpgsql SET search_path = '' AS $$
BEGIN
  RAISE EXCEPTION 'APPEND_ONLY: % rows are immutable', TG_TABLE_NAME USING ERRCODE = '42501';
END $$;
CREATE OR REPLACE TRIGGER partner_commission_ledger_append_only
  BEFORE UPDATE OR DELETE ON public.partner_commission_ledger
  FOR EACH ROW EXECUTE FUNCTION public.partner_append_only_guard();
CREATE OR REPLACE TRIGGER partner_agreement_acceptances_append_only
  BEFORE UPDATE OR DELETE ON public.partner_agreement_acceptances
  FOR EACH ROW EXECUTE FUNCTION public.partner_append_only_guard();
REVOKE ALL ON FUNCTION public.partner_append_only_guard() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.partner_terms_validate() FROM PUBLIC, anon, authenticated;

-- ---------------------------------------------------------------------
-- H) Grants + RLS (explicit grants; anon none; no direct authenticated writes)
-- ---------------------------------------------------------------------
REVOKE ALL ON public.partner_program_terms, public.partners, public.partner_applications,
  public.partner_agreement_acceptances, public.partner_referrals,
  public.partner_payout_requests, public.partner_commission_ledger FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.partner_program_terms TO authenticated;
GRANT SELECT ON public.partners TO authenticated;
GRANT SELECT ON public.partner_applications TO authenticated;
GRANT SELECT ON public.partner_agreement_acceptances TO authenticated;
GRANT SELECT ON public.partner_referrals TO authenticated;
GRANT SELECT ON public.partner_payout_requests TO authenticated;
GRANT SELECT ON public.partner_commission_ledger TO authenticated;
GRANT ALL ON public.partner_program_terms, public.partners, public.partner_applications,
  public.partner_agreement_acceptances, public.partner_referrals,
  public.partner_payout_requests, public.partner_commission_ledger TO service_role;

ALTER TABLE public.partner_program_terms ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.partners ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.partner_applications ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.partner_agreement_acceptances ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.partner_referrals ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.partner_payout_requests ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.partner_commission_ledger ENABLE ROW LEVEL SECURITY;

DO $policies$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname='public' AND tablename='partner_program_terms' AND policyname='partner_terms_read_active_or_owner') THEN
    CREATE POLICY partner_terms_read_active_or_owner ON public.partner_program_terms FOR SELECT TO authenticated
      USING (status = 'active' OR public.is_platform_owner(auth.uid()));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname='public' AND tablename='partners' AND policyname='partners_read_own_or_owner') THEN
    CREATE POLICY partners_read_own_or_owner ON public.partners FOR SELECT TO authenticated
      USING (user_id = auth.uid() OR public.is_platform_owner(auth.uid()));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname='public' AND tablename='partner_applications' AND policyname='partner_applications_read_own_or_owner') THEN
    CREATE POLICY partner_applications_read_own_or_owner ON public.partner_applications FOR SELECT TO authenticated
      USING (user_id = auth.uid() OR public.is_platform_owner(auth.uid()));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname='public' AND tablename='partner_agreement_acceptances' AND policyname='partner_acceptances_read_own_or_owner') THEN
    CREATE POLICY partner_acceptances_read_own_or_owner ON public.partner_agreement_acceptances FOR SELECT TO authenticated
      USING (EXISTS (SELECT 1 FROM public.partners p WHERE p.id = partner_id AND p.user_id = auth.uid()) OR public.is_platform_owner(auth.uid()));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname='public' AND tablename='partner_referrals' AND policyname='partner_referrals_read_own_or_owner') THEN
    CREATE POLICY partner_referrals_read_own_or_owner ON public.partner_referrals FOR SELECT TO authenticated
      USING (EXISTS (SELECT 1 FROM public.partners p WHERE p.id = partner_id AND p.user_id = auth.uid()) OR public.is_platform_owner(auth.uid()));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname='public' AND tablename='partner_payout_requests' AND policyname='partner_payouts_read_own_or_owner') THEN
    CREATE POLICY partner_payouts_read_own_or_owner ON public.partner_payout_requests FOR SELECT TO authenticated
      USING (EXISTS (SELECT 1 FROM public.partners p WHERE p.id = partner_id AND p.user_id = auth.uid()) OR public.is_platform_owner(auth.uid()));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname='public' AND tablename='partner_commission_ledger' AND policyname='partner_ledger_read_own_or_owner') THEN
    CREATE POLICY partner_ledger_read_own_or_owner ON public.partner_commission_ledger FOR SELECT TO authenticated
      USING (EXISTS (SELECT 1 FROM public.partners p WHERE p.id = partner_id AND p.user_id = auth.uid()) OR public.is_platform_owner(auth.uid()));
  END IF;
END $policies$;

-- ---------------------------------------------------------------------
-- Internal helpers
-- ---------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.partner_require_owner()
RETURNS uuid LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = '' AS $$
DECLARE v uuid := auth.uid();
BEGIN
  IF v IS NULL THEN RAISE EXCEPTION 'AUTH_REQUIRED' USING ERRCODE = '42501'; END IF;
  IF NOT public.is_platform_owner(v) THEN RAISE EXCEPTION 'PLATFORM_OWNER_REQUIRED' USING ERRCODE = '42501'; END IF;
  RETURN v;
END $$;

CREATE OR REPLACE FUNCTION public.partner_active_terms()
RETURNS public.partner_program_terms LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' AS $$
  SELECT t.* FROM public.partner_program_terms t WHERE t.status = 'active' LIMIT 1
$$;

-- Available balance: entries whose available_at has passed, plus all negative
-- entries (reversals/payouts/negative adjustments apply immediately).
CREATE OR REPLACE FUNCTION public.partner_available_balance(_partner_id uuid, _currency text)
RETURNS bigint LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' AS $$
  SELECT coalesce(sum(l.amount_cents), 0)::bigint FROM public.partner_commission_ledger l
  WHERE l.partner_id = _partner_id AND l.currency = _currency
    AND (l.available_at <= now() OR l.amount_cents < 0)
$$;

REVOKE ALL ON FUNCTION public.partner_require_owner() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.partner_active_terms() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.partner_available_balance(uuid, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.partner_require_owner() TO service_role;
GRANT EXECUTE ON FUNCTION public.partner_active_terms() TO service_role;
GRANT EXECUTE ON FUNCTION public.partner_available_balance(uuid, text) TO service_role;

-- ---------------------------------------------------------------------
-- Owner functions
-- ---------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.owner_save_partner_terms_draft(
  _version integer, _commission_bps integer, _attribution_window_days integer, _hold_days integer,
  _min_payout_cents integer, _currency text, _agreement_text text, _disclosure_text text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE v_owner uuid := public.partner_require_owner(); v_status text;
BEGIN
  IF _version IS NULL OR _version <= 0 THEN RAISE EXCEPTION 'INVALID_VERSION' USING ERRCODE = '22023'; END IF;
  SELECT status INTO v_status FROM public.partner_program_terms WHERE version = _version FOR UPDATE;
  IF v_status IS NULL THEN
    -- All inputs are caller-supplied; NULLs stay NULL (no invented defaults).
    INSERT INTO public.partner_program_terms (version, status, commission_bps, attribution_window_days, hold_days,
      min_payout_cents, currency, agreement_text, disclosure_text, created_by)
    VALUES (_version, 'draft', _commission_bps, _attribution_window_days, _hold_days,
      _min_payout_cents, lower(_currency), _agreement_text, _disclosure_text, v_owner);
    RETURN jsonb_build_object('ok', true, 'version', _version, 'created', true);
  END IF;
  IF v_status <> 'draft' THEN RAISE EXCEPTION 'TERMS_NOT_DRAFT' USING ERRCODE = '22023'; END IF;
  UPDATE public.partner_program_terms
     SET commission_bps = _commission_bps, attribution_window_days = _attribution_window_days,
         hold_days = _hold_days, min_payout_cents = _min_payout_cents, currency = lower(_currency),
         agreement_text = _agreement_text, disclosure_text = _disclosure_text
   WHERE version = _version AND status = 'draft';
  RETURN jsonb_build_object('ok', true, 'version', _version, 'created', false);
END $$;

CREATE OR REPLACE FUNCTION public.owner_activate_partner_terms(_version integer)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE v_owner uuid := public.partner_require_owner(); v_t public.partner_program_terms;
BEGIN
  SELECT * INTO v_t FROM public.partner_program_terms WHERE version = _version FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'TERMS_NOT_FOUND' USING ERRCODE = 'P0002'; END IF;
  IF v_t.status <> 'draft' THEN RAISE EXCEPTION 'TERMS_NOT_DRAFT' USING ERRCODE = '22023'; END IF;
  UPDATE public.partner_program_terms SET status = 'retired', retired_at = now() WHERE status = 'active';
  -- partner_terms_validate rejects missing/invalid required terms here.
  UPDATE public.partner_program_terms SET status = 'active', activated_at = now(), activated_by = v_owner WHERE id = v_t.id;
  RETURN jsonb_build_object('ok', true, 'version', _version);
END $$;

CREATE OR REPLACE FUNCTION public.owner_retire_partner_terms(_version integer)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE v_owner uuid := public.partner_require_owner();
BEGIN
  UPDATE public.partner_program_terms SET status = 'retired', retired_at = now()
  WHERE version = _version AND status = 'active';
  IF NOT FOUND THEN RAISE EXCEPTION 'TERMS_NOT_ACTIVE' USING ERRCODE = '22023'; END IF;
  RETURN jsonb_build_object('ok', true, 'version', _version);
END $$;

CREATE OR REPLACE FUNCTION public.owner_review_partner_application(_application_id uuid, _approve boolean, _note text DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE v_owner uuid := public.partner_require_owner(); v_a public.partner_applications; v_code text;
BEGIN
  SELECT * INTO v_a FROM public.partner_applications WHERE id = _application_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'APPLICATION_NOT_FOUND' USING ERRCODE = 'P0002'; END IF;
  IF v_a.status <> 'pending' THEN RAISE EXCEPTION 'APPLICATION_NOT_PENDING' USING ERRCODE = '22023'; END IF;
  UPDATE public.partner_applications
     SET status = CASE WHEN _approve THEN 'approved' ELSE 'rejected' END,
         review_note = left(_note, 2000), reviewed_at = now(), reviewed_by = v_owner
   WHERE id = v_a.id;
  IF _approve THEN
    -- Referral codes exist only for affiliates; service-only partners get NULL.
    v_code := CASE WHEN v_a.wants_affiliate THEN substr(replace(gen_random_uuid()::text, '-', ''), 1, 10) ELSE NULL END;
    INSERT INTO public.partners (user_id, is_affiliate, is_service_partner, status, referral_code, approved_by, approved_at)
    VALUES (v_a.user_id, v_a.wants_affiliate, v_a.wants_service_partner, 'approved', v_code, v_owner, now())
    ON CONFLICT (user_id) DO UPDATE
      SET is_affiliate = EXCLUDED.is_affiliate, is_service_partner = EXCLUDED.is_service_partner,
          status = 'approved', approved_by = v_owner, approved_at = now(),
          referral_code = CASE WHEN EXCLUDED.is_affiliate
                               THEN coalesce(public.partners.referral_code, EXCLUDED.referral_code)
                               ELSE NULL END
      WHERE public.partners.status NOT IN ('terminated');
  ELSE
    UPDATE public.partners SET status = 'rejected' WHERE user_id = v_a.user_id AND status = 'applied';
  END IF;
  RETURN jsonb_build_object('ok', true, 'approved', _approve);
END $$;

CREATE OR REPLACE FUNCTION public.owner_set_partner_status(_partner_id uuid, _status text, _tax_doc_status text DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE v_owner uuid := public.partner_require_owner();
BEGIN
  IF _status NOT IN ('approved','suspended','terminated') THEN RAISE EXCEPTION 'INVALID_STATUS' USING ERRCODE = '22023'; END IF;
  IF _tax_doc_status IS NOT NULL AND _tax_doc_status NOT IN ('not_submitted','submitted','verified','rejected') THEN
    RAISE EXCEPTION 'INVALID_TAX_STATUS' USING ERRCODE = '22023';
  END IF;
  UPDATE public.partners
     SET status = _status, tax_doc_status = coalesce(_tax_doc_status, tax_doc_status)
   WHERE id = _partner_id AND approved_at IS NOT NULL;
  IF NOT FOUND THEN RAISE EXCEPTION 'PARTNER_NOT_FOUND' USING ERRCODE = 'P0002'; END IF;
  RETURN jsonb_build_object('ok', true);
END $$;

CREATE OR REPLACE FUNCTION public.owner_add_partner_ledger_adjustment(
  _partner_id uuid, _amount_cents integer, _currency text, _note text,
  _available_at timestamptz DEFAULT now(), _referral_id uuid DEFAULT NULL)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE v_owner uuid := public.partner_require_owner(); v_id uuid; v_ws uuid; v_tv integer;
BEGIN
  IF _amount_cents IS NULL OR _amount_cents = 0 THEN RAISE EXCEPTION 'INVALID_AMOUNT' USING ERRCODE = '22023'; END IF;
  IF coalesce(btrim(_note), '') = '' THEN RAISE EXCEPTION 'NOTE_REQUIRED' USING ERRCODE = '22023'; END IF;
  IF NOT EXISTS (SELECT 1 FROM public.partners WHERE id = _partner_id) THEN RAISE EXCEPTION 'PARTNER_NOT_FOUND' USING ERRCODE = 'P0002'; END IF;
  -- Ledger is affiliate-only. Suspended/terminated affiliates may still be corrected.
  IF NOT EXISTS (SELECT 1 FROM public.partners WHERE id = _partner_id AND is_affiliate) THEN
    RAISE EXCEPTION 'PARTNER_NOT_AFFILIATE' USING ERRCODE = '22023';
  END IF;
  IF _referral_id IS NOT NULL THEN
    SELECT workspace_id, terms_version INTO v_ws, v_tv FROM public.partner_referrals WHERE id = _referral_id AND partner_id = _partner_id;
    IF NOT FOUND THEN RAISE EXCEPTION 'REFERRAL_MISMATCH' USING ERRCODE = '22023'; END IF;
  END IF;
  INSERT INTO public.partner_commission_ledger (partner_id, referral_id, workspace_id, terms_version, entry_type,
    amount_cents, currency, available_at, source_kind, note, created_by)
  VALUES (_partner_id, _referral_id, v_ws, v_tv, 'adjustment', _amount_cents, lower(_currency),
    coalesce(_available_at, now()), 'manual', left(_note, 500), v_owner)
  RETURNING id INTO v_id;
  RETURN v_id;
END $$;

CREATE OR REPLACE FUNCTION public.owner_reject_partner_referral_for_fraud(_referral_id uuid, _reason text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE v_owner uuid := public.partner_require_owner(); v_r public.partner_referrals; v_unmarked boolean := false;
BEGIN
  IF coalesce(btrim(_reason), '') = '' THEN RAISE EXCEPTION 'REASON_REQUIRED' USING ERRCODE = '22023'; END IF;
  SELECT * INTO v_r FROM public.partner_referrals WHERE id = _referral_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'REFERRAL_NOT_FOUND' USING ERRCODE = 'P0002'; END IF;
  IF v_r.status NOT IN ('pending','qualified') THEN RAISE EXCEPTION 'REFERRAL_NOT_ACTIVE' USING ERRCODE = '22023'; END IF;
  -- workspace_id is kept for audit; the one-referral-per-workspace guard then
  -- blocks re-attribution gaming of a fraud-rejected qualified workspace.
  UPDATE public.partner_referrals SET status = 'rejected_fraud', reason = left(btrim(_reason), 500) WHERE id = v_r.id;
  IF v_r.status = 'qualified' AND v_r.workspace_id IS NOT NULL THEN
    -- Remove only our exact Free affiliate marker. Never touches Stripe,
    -- paid, reseller, manual, or unrelated assignment state.
    UPDATE public.workspace_commercial_assignments a
       SET channel = 'direct', channel_partner_ref = NULL
      FROM public.commercial_plans pl
     WHERE a.workspace_id = v_r.workspace_id
       AND a.plan_id = pl.id AND pl.code = 'cartel_free'
       AND a.channel = 'affiliate' AND a.channel_partner_ref = v_r.partner_id::text
       AND a.assignment_source = 'internal';
    v_unmarked := FOUND;
  END IF;
  RETURN jsonb_build_object('ok', true, 'previous_status', v_r.status, 'marker_removed', v_unmarked);
END $$;

CREATE OR REPLACE FUNCTION public.owner_review_partner_payout(_payout_id uuid, _approve boolean, _note text DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE v_owner uuid := public.partner_require_owner(); v_req public.partner_payout_requests; v_p public.partners; v_available bigint; v_reserved bigint;
BEGIN
  SELECT * INTO v_req FROM public.partner_payout_requests WHERE id = _payout_id FOR UPDATE;
  IF NOT FOUND OR v_req.status <> 'requested' THEN RAISE EXCEPTION 'PAYOUT_NOT_REQUESTED' USING ERRCODE = '22023'; END IF;
  IF _approve THEN
    SELECT * INTO v_p FROM public.partners WHERE id = v_req.partner_id FOR UPDATE;  -- serializes with requests
    IF v_p.status <> 'approved' THEN RAISE EXCEPTION 'PARTNER_NOT_APPROVED' USING ERRCODE = '22023'; END IF;
    IF NOT v_p.is_affiliate THEN RAISE EXCEPTION 'PARTNER_NOT_AFFILIATE' USING ERRCODE = '22023'; END IF;
    IF v_p.tax_doc_status <> 'verified' THEN RAISE EXCEPTION 'TAX_DOCS_NOT_VERIFIED' USING ERRCODE = '22023'; END IF;
    IF NOT EXISTS (SELECT 1 FROM public.partner_agreement_acceptances
                    WHERE partner_id = v_req.partner_id AND terms_version = v_req.terms_version) THEN
      RAISE EXCEPTION 'AGREEMENT_NOT_ACCEPTED' USING ERRCODE = '22023';
    END IF;
    -- Balance recheck: available now, minus OTHER open reservations (excluding this request).
    v_available := public.partner_available_balance(v_req.partner_id, v_req.currency);
    SELECT coalesce(sum(amount_cents), 0) INTO v_reserved FROM public.partner_payout_requests
     WHERE partner_id = v_req.partner_id AND currency = v_req.currency
       AND status IN ('requested','approved') AND id <> v_req.id;
    IF v_req.amount_cents > v_available - v_reserved THEN
      RAISE EXCEPTION 'INSUFFICIENT_AVAILABLE_BALANCE' USING ERRCODE = '22023';
    END IF;
  END IF;
  UPDATE public.partner_payout_requests
     SET status = CASE WHEN _approve THEN 'approved' ELSE 'rejected' END,
         reviewer_id = v_owner, review_note = left(_note, 2000), reviewed_at = now()
   WHERE id = v_req.id;
  RETURN jsonb_build_object('ok', true, 'approved', _approve);
END $$;

CREATE OR REPLACE FUNCTION public.owner_mark_partner_payout_paid(_payout_id uuid, _paid_reference text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE v_owner uuid := public.partner_require_owner(); v_p public.partner_payout_requests;
BEGIN
  SELECT * INTO v_p FROM public.partner_payout_requests WHERE id = _payout_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'PAYOUT_NOT_FOUND' USING ERRCODE = 'P0002'; END IF;
  IF v_p.status = 'paid' THEN RETURN jsonb_build_object('ok', true, 'already_paid', true); END IF;
  IF coalesce(btrim(_paid_reference), '') = '' THEN RAISE EXCEPTION 'PAID_REFERENCE_REQUIRED' USING ERRCODE = '22023'; END IF;
  IF v_p.status <> 'approved' THEN RAISE EXCEPTION 'PAYOUT_NOT_APPROVED' USING ERRCODE = '22023'; END IF;
  UPDATE public.partner_payout_requests
     SET status = 'paid', paid_at = now(), paid_reference = left(btrim(_paid_reference), 200), reviewer_id = v_owner
   WHERE id = v_p.id;
  -- Exactly one negative payout entry per request (unique index enforces).
  INSERT INTO public.partner_commission_ledger (partner_id, entry_type, amount_cents, currency, available_at,
    source_kind, payout_request_id, note, created_by)
  VALUES (v_p.partner_id, 'payout', -v_p.amount_cents, v_p.currency, now(), 'manual', v_p.id, 'Manual payout', v_owner)
  ON CONFLICT (payout_request_id) WHERE entry_type = 'payout' DO NOTHING;
  RETURN jsonb_build_object('ok', true, 'already_paid', false);
END $$;

-- ---------------------------------------------------------------------
-- User functions
-- ---------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.submit_partner_application(_wants_affiliate boolean, _wants_service_partner boolean, _pitch text)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE v_uid uuid := auth.uid(); v_t public.partner_program_terms; v_id uuid;
BEGIN
  IF v_uid IS NULL THEN RAISE EXCEPTION 'AUTH_REQUIRED' USING ERRCODE = '42501'; END IF;
  v_t := public.partner_active_terms();
  IF v_t.id IS NULL THEN RAISE EXCEPTION 'PROGRAM_NOT_OPEN' USING ERRCODE = '22023'; END IF;
  IF NOT (coalesce(_wants_affiliate, false) OR coalesce(_wants_service_partner, false)) THEN
    RAISE EXCEPTION 'ROLE_REQUIRED' USING ERRCODE = '22023';
  END IF;
  IF EXISTS (SELECT 1 FROM public.partners WHERE user_id = v_uid AND status IN ('approved','suspended','terminated')) THEN
    RAISE EXCEPTION 'ALREADY_PARTNER' USING ERRCODE = '22023';
  END IF;
  INSERT INTO public.partner_applications (user_id, wants_affiliate, wants_service_partner, pitch, terms_version)
  VALUES (v_uid, coalesce(_wants_affiliate, false), coalesce(_wants_service_partner, false), left(btrim(_pitch), 1000), v_t.version)
  RETURNING id INTO v_id;  -- partner_applications_one_pending blocks duplicate pending
  RETURN v_id;
END $$;

CREATE OR REPLACE FUNCTION public.accept_partner_agreement(_terms_version integer)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE v_uid uuid := auth.uid(); v_t public.partner_program_terms; v_pid uuid;
BEGIN
  IF v_uid IS NULL THEN RAISE EXCEPTION 'AUTH_REQUIRED' USING ERRCODE = '42501'; END IF;
  v_t := public.partner_active_terms();
  IF v_t.id IS NULL OR v_t.version <> _terms_version THEN RAISE EXCEPTION 'TERMS_NOT_ACTIVE' USING ERRCODE = '22023'; END IF;
  SELECT id INTO v_pid FROM public.partners WHERE user_id = v_uid AND status = 'approved';
  IF v_pid IS NULL THEN RAISE EXCEPTION 'PARTNER_NOT_APPROVED' USING ERRCODE = '42501'; END IF;
  INSERT INTO public.partner_agreement_acceptances (partner_id, terms_version)
  VALUES (v_pid, v_t.version) ON CONFLICT (partner_id, terms_version) DO NOTHING;
  RETURN jsonb_build_object('ok', true, 'version', v_t.version);
END $$;

CREATE OR REPLACE FUNCTION public.record_referral_attribution(_code text, _source text DEFAULT 'link')
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE v_uid uuid := auth.uid(); v_code text; v_t public.partner_program_terms; v_p public.partners; v_existing uuid;
BEGIN
  IF v_uid IS NULL THEN RAISE EXCEPTION 'AUTH_REQUIRED' USING ERRCODE = '42501'; END IF;
  v_code := lower(btrim(coalesce(_code, '')));
  IF v_code !~ '^[a-z0-9]{10}$' THEN RETURN jsonb_build_object('ok', false, 'reason', 'INVALID_CODE'); END IF;
  IF _source NOT IN ('link','code') THEN RETURN jsonb_build_object('ok', false, 'reason', 'INVALID_SOURCE'); END IF;
  -- First attribution wins (idempotent).
  SELECT id INTO v_existing FROM public.partner_referrals WHERE referred_user_id = v_uid AND status IN ('pending','qualified');
  IF v_existing IS NOT NULL THEN RETURN jsonb_build_object('ok', true, 'already_attributed', true); END IF;
  v_t := public.partner_active_terms();
  IF v_t.id IS NULL THEN RETURN jsonb_build_object('ok', false, 'reason', 'PROGRAM_NOT_OPEN'); END IF;
  SELECT * INTO v_p FROM public.partners WHERE referral_code = v_code AND status = 'approved' AND is_affiliate;
  IF v_p.id IS NULL THEN RETURN jsonb_build_object('ok', false, 'reason', 'CODE_NOT_ACTIVE'); END IF;
  IF v_p.user_id = v_uid THEN RETURN jsonb_build_object('ok', false, 'reason', 'SELF_REFERRAL'); END IF;
  INSERT INTO public.partner_referrals (partner_id, referred_user_id, terms_version, source)
  VALUES (v_p.id, v_uid, v_t.version, _source)
  ON CONFLICT (referred_user_id) WHERE status IN ('pending','qualified') DO NOTHING;
  RETURN jsonb_build_object('ok', true, 'already_attributed', false);
END $$;

CREATE OR REPLACE FUNCTION public.bind_referral_to_workspace(_workspace_id uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE v_uid uuid := auth.uid(); v_r public.partner_referrals; v_p public.partners; v_t public.partner_program_terms; v_assignment_id uuid;
BEGIN
  IF v_uid IS NULL THEN RAISE EXCEPTION 'AUTH_REQUIRED' USING ERRCODE = '42501'; END IF;
  IF NOT public.is_workspace_owner(_workspace_id, v_uid) THEN RAISE EXCEPTION 'WORKSPACE_OWNER_REQUIRED' USING ERRCODE = '42501'; END IF;
  SELECT * INTO v_r FROM public.partner_referrals
   WHERE referred_user_id = v_uid AND status IN ('pending','qualified') FOR UPDATE;
  IF NOT FOUND THEN RETURN jsonb_build_object('ok', true, 'bound', false, 'reason', 'NO_REFERRAL'); END IF;
  IF v_r.workspace_id IS NOT NULL THEN
    RETURN jsonb_build_object('ok', true, 'bound', v_r.workspace_id = _workspace_id, 'reason', 'ALREADY_BOUND');
  END IF;
  IF v_r.status <> 'pending' THEN RETURN jsonb_build_object('ok', true, 'bound', false, 'reason', 'REFERRAL_NOT_PENDING'); END IF;
  SELECT * INTO v_p FROM public.partners WHERE id = v_r.partner_id;
  IF v_p.id IS NULL OR v_p.status <> 'approved' OR NOT v_p.is_affiliate THEN
    RETURN jsonb_build_object('ok', true, 'bound', false, 'reason', 'PARTNER_NOT_ACTIVE_AFFILIATE');
  END IF;
  SELECT * INTO v_t FROM public.partner_program_terms WHERE version = v_r.terms_version;
  -- Self-referral: partner already owns/belongs to the target workspace.
  IF public.is_workspace_member(_workspace_id, v_p.user_id) OR public.is_workspace_owner(_workspace_id, v_p.user_id) THEN
    UPDATE public.partner_referrals SET status = 'rejected_self', reason = 'Partner is a member of the referred workspace' WHERE id = v_r.id;
    RETURN jsonb_build_object('ok', true, 'bound', false, 'reason', 'SELF_REFERRAL');
  END IF;
  IF v_t.attribution_window_days IS NULL OR v_r.attributed_at + make_interval(days => v_t.attribution_window_days) < now() THEN
    UPDATE public.partner_referrals SET status = 'expired', reason = 'Attribution window elapsed' WHERE id = v_r.id;
    RETURN jsonb_build_object('ok', true, 'bound', false, 'reason', 'EXPIRED');
  END IF;
  IF EXISTS (SELECT 1 FROM public.partner_referrals WHERE workspace_id = _workspace_id) THEN
    RETURN jsonb_build_object('ok', true, 'bound', false, 'reason', 'WORKSPACE_ALREADY_ATTRIBUTED');
  END IF;
  -- Step 1: atomically mark ONLY the eligible current Cartel Free assignment.
  -- Never overwrites Stripe, reseller, manual, paid, or any non-direct authority.
  UPDATE public.workspace_commercial_assignments a
     SET channel = 'affiliate', channel_partner_ref = v_p.id::text
    FROM public.commercial_plans pl
   WHERE a.workspace_id = _workspace_id
     AND a.plan_id = pl.id AND pl.code = 'cartel_free'
     AND a.channel = 'direct' AND a.channel_partner_ref IS NULL
     AND a.assignment_source = 'internal'
     AND a.status = 'active' AND a.starts_at <= now() AND (a.ends_at IS NULL OR a.ends_at > now())
  RETURNING a.id INTO v_assignment_id;
  IF v_assignment_id IS NULL THEN
    RETURN jsonb_build_object('ok', true, 'bound', false, 'reason', 'ASSIGNMENT_NOT_ELIGIBLE');
  END IF;
  -- Step 2: only after the marker succeeded, bind and qualify the referral.
  -- partner_referrals_one_per_workspace aborts (and rolls back step 1) on a race.
  UPDATE public.partner_referrals
     SET workspace_id = _workspace_id, bound_at = now(), status = 'qualified'
   WHERE id = v_r.id;
  RETURN jsonb_build_object('ok', true, 'bound', true, 'assignment_marked', true);
END $$;

CREATE OR REPLACE FUNCTION public.request_partner_payout(_amount_cents integer)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE v_uid uuid := auth.uid(); v_p public.partners; v_t public.partner_program_terms;
        v_available bigint; v_reserved bigint; v_id uuid;
BEGIN
  IF v_uid IS NULL THEN RAISE EXCEPTION 'AUTH_REQUIRED' USING ERRCODE = '42501'; END IF;
  SELECT * INTO v_p FROM public.partners WHERE user_id = v_uid FOR UPDATE;  -- serializes per partner
  IF v_p.id IS NULL OR v_p.status <> 'approved' THEN RAISE EXCEPTION 'PARTNER_NOT_APPROVED' USING ERRCODE = '42501'; END IF;
  IF NOT v_p.is_affiliate THEN RAISE EXCEPTION 'PARTNER_NOT_AFFILIATE' USING ERRCODE = '42501'; END IF;
  IF v_p.tax_doc_status <> 'verified' THEN RAISE EXCEPTION 'TAX_DOCS_NOT_VERIFIED' USING ERRCODE = '42501'; END IF;
  v_t := public.partner_active_terms();
  IF v_t.id IS NULL THEN RAISE EXCEPTION 'PROGRAM_NOT_OPEN' USING ERRCODE = '22023'; END IF;
  IF NOT EXISTS (SELECT 1 FROM public.partner_agreement_acceptances WHERE partner_id = v_p.id AND terms_version = v_t.version) THEN
    RAISE EXCEPTION 'AGREEMENT_NOT_ACCEPTED' USING ERRCODE = '42501';
  END IF;
  IF _amount_cents IS NULL OR _amount_cents < v_t.min_payout_cents THEN RAISE EXCEPTION 'BELOW_MINIMUM' USING ERRCODE = '22023'; END IF;
  v_available := public.partner_available_balance(v_p.id, v_t.currency);
  SELECT coalesce(sum(amount_cents), 0) INTO v_reserved FROM public.partner_payout_requests
   WHERE partner_id = v_p.id AND currency = v_t.currency AND status IN ('requested','approved');
  IF _amount_cents > v_available - v_reserved THEN RAISE EXCEPTION 'INSUFFICIENT_AVAILABLE_BALANCE' USING ERRCODE = '22023'; END IF;
  INSERT INTO public.partner_payout_requests (partner_id, amount_cents, currency, terms_version)
  VALUES (v_p.id, _amount_cents, v_t.currency, v_t.version) RETURNING id INTO v_id;
  RETURN v_id;
END $$;

CREATE OR REPLACE FUNCTION public.get_my_partner_summary()
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = '' AS $$
DECLARE v_uid uuid := auth.uid(); v_p public.partners; v_t public.partner_program_terms; v_cur text; v_year timestamptz := date_trunc('year', now());
BEGIN
  IF v_uid IS NULL THEN RAISE EXCEPTION 'AUTH_REQUIRED' USING ERRCODE = '42501'; END IF;
  v_t := public.partner_active_terms();
  SELECT * INTO v_p FROM public.partners WHERE user_id = v_uid;
  IF v_p.id IS NULL THEN
    RETURN jsonb_build_object('ok', true, 'is_partner', false, 'program_open', v_t.id IS NOT NULL);
  END IF;
  v_cur := coalesce(v_t.currency, (SELECT currency FROM public.partner_commission_ledger WHERE partner_id = v_p.id LIMIT 1));
  RETURN jsonb_build_object(
    'ok', true, 'is_partner', true, 'program_open', v_t.id IS NOT NULL,
    'status', v_p.status, 'is_affiliate', v_p.is_affiliate, 'is_service_partner', v_p.is_service_partner,
    'referral_code', v_p.referral_code, 'tax_doc_status', v_p.tax_doc_status, 'currency', v_cur,
    'agreement_accepted', EXISTS (SELECT 1 FROM public.partner_agreement_acceptances WHERE partner_id = v_p.id AND terms_version = v_t.version),
    'available_cents', CASE WHEN v_cur IS NULL THEN 0 ELSE public.partner_available_balance(v_p.id, v_cur) END,
    'pending_cents', (SELECT coalesce(sum(amount_cents),0) FROM public.partner_commission_ledger WHERE partner_id = v_p.id AND currency = v_cur AND amount_cents > 0 AND available_at > now()),
    'reserved_cents', (SELECT coalesce(sum(amount_cents),0) FROM public.partner_payout_requests WHERE partner_id = v_p.id AND currency = v_cur AND status IN ('requested','approved')),
    'ytd_earned_cents', (SELECT coalesce(sum(amount_cents),0) FROM public.partner_commission_ledger WHERE partner_id = v_p.id AND currency = v_cur AND entry_type IN ('accrual','adjustment','reversal') AND created_at >= v_year),
    'ytd_paid_cents', (SELECT coalesce(-sum(amount_cents),0) FROM public.partner_commission_ledger WHERE partner_id = v_p.id AND currency = v_cur AND entry_type = 'payout' AND created_at >= v_year),
    'referrals_total', (SELECT count(*) FROM public.partner_referrals WHERE partner_id = v_p.id)
  );
END $$;

-- ---------------------------------------------------------------------
-- Function privileges: revoke PUBLIC/anon; grant only what is needed.
-- ---------------------------------------------------------------------
REVOKE ALL ON FUNCTION public.owner_save_partner_terms_draft(integer, integer, integer, integer, integer, text, text, text) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.owner_activate_partner_terms(integer) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.owner_retire_partner_terms(integer) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.owner_review_partner_application(uuid, boolean, text) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.owner_set_partner_status(uuid, text, text) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.owner_add_partner_ledger_adjustment(uuid, integer, text, text, timestamptz, uuid) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.owner_reject_partner_referral_for_fraud(uuid, text) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.owner_review_partner_payout(uuid, boolean, text) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.owner_mark_partner_payout_paid(uuid, text) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.submit_partner_application(boolean, boolean, text) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.accept_partner_agreement(integer) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.record_referral_attribution(text, text) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.bind_referral_to_workspace(uuid) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.request_partner_payout(integer) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.get_my_partner_summary() FROM PUBLIC, anon;

GRANT EXECUTE ON FUNCTION public.owner_save_partner_terms_draft(integer, integer, integer, integer, integer, text, text, text) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.owner_activate_partner_terms(integer) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.owner_retire_partner_terms(integer) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.owner_review_partner_application(uuid, boolean, text) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.owner_set_partner_status(uuid, text, text) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.owner_add_partner_ledger_adjustment(uuid, integer, text, text, timestamptz, uuid) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.owner_reject_partner_referral_for_fraud(uuid, text) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.owner_review_partner_payout(uuid, boolean, text) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.owner_mark_partner_payout_paid(uuid, text) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.submit_partner_application(boolean, boolean, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.accept_partner_agreement(integer) TO authenticated;
GRANT EXECUTE ON FUNCTION public.record_referral_attribution(text, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.bind_referral_to_workspace(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.request_partner_payout(integer) TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_my_partner_summary() TO authenticated;

COMMENT ON COLUMN public.partner_applications.review_note IS 'Applicant-visible review note. Not private.';
COMMENT ON TABLE public.partner_commission_ledger IS 'Append-only. Corrections via new adjustment/reversal. Phase 1A: owner manual adjustments + payouts only.';
COMMENT ON COLUMN public.workspace_commercial_assignments.channel_partner_ref IS 'When channel=affiliate: partners.id as text. Durable attribution lives in partner_referrals.';
COMMENT ON COLUMN public.partners.is_service_partner IS 'Identity flag only. Phase 1A grants zero workspace permissions.';
