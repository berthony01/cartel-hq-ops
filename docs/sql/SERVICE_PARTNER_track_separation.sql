-- =====================================================================
-- SERVICE PARTNER TRACK SEPARATION — STAGED ONLY. NOT APPLIED.
-- Target: external Supabase ocoinbnjgstkmnwwvnhi (production system of record).
-- Intended migration name: service_partner_track_separation
--   (create with `supabase migration new service_partner_track_separation`
--    and paste this body ONLY after CP-SVC-SQL approval; see
--    docs/SERVICE_PARTNER_PROGRAM_LAUNCH_RUNBOOK.md).
--
-- Behavior:
--  * partner_program_terms gains independent track switches
--    service_partner_applications_open / affiliate_applications_open
--    (NOT NULL DEFAULT false) and nullable commission_duration_invoices.
--  * Active terms need >=1 open track + nonblank agreement/disclosure.
--    Service-only active terms may keep every affiliate financial field NULL.
--  * Affiliate is DEFERRED: any active row with affiliate_applications_open
--    = true is rejected (AFFILIATE_PROGRAM_DEFERRED). A later, separately
--    approved migration must replace this guard to open Affiliate.
--  * submit_partner_application rejects closed tracks
--    (SERVICE_PARTNER_APPLICATIONS_CLOSED / AFFILIATE_APPLICATIONS_CLOSED).
--  * Owner approval of an Affiliate/dual application is refused while
--    Affiliate is closed; service-only approval => is_affiliate=false,
--    referral_code=NULL, no tax/payout prerequisite.
--  * Payout requests and legacy referral attribution require Affiliate open.
--  * Canonical-text gate: service-only activation requires agreement_text
--    and disclosure_text to match the canonical Service Partner Agreement v2
--    and disclosure EXACTLY (SHA-256 of UTF-8 text, hashes embedded below and
--    derived from src/lib/legal-policies.ts). Otherwise PARTNER_TERMS_NOT_CANONICAL.
--  * get_my_partner_summary returns both flags; program_open = either.
--  * get_partner_program_status(): public read of the two booleans, active
--    version and active text hashes only (anon + authenticated). No other anon capability added.
--  * RLS, row-ownership/owner policies, append-only ledger guard unchanged.
-- Additive: no DROP, no data rewrite. All 7 partner tables have 0 rows.
-- =====================================================================
BEGIN;

ALTER TABLE public.partner_program_terms
  ADD COLUMN IF NOT EXISTS service_partner_applications_open boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS affiliate_applications_open boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS commission_duration_invoices integer;

-- ---------------------------------------------------------------------
-- Trigger validation: per-track requirements; Affiliate hard-deferred.
-- ---------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.partner_terms_validate()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO ''
AS $function$
BEGIN
  IF NEW.status = 'active' THEN
    IF NOT (NEW.service_partner_applications_open OR NEW.affiliate_applications_open) THEN
      RAISE EXCEPTION 'PARTNER_TERMS_NO_TRACK_OPEN' USING ERRCODE = '22023';
    END IF;
    IF coalesce(btrim(NEW.agreement_text), '') = '' OR coalesce(btrim(NEW.disclosure_text), '') = '' THEN
      RAISE EXCEPTION 'PARTNER_TERMS_INCOMPLETE' USING ERRCODE = '22023';
    END IF;
    IF NEW.affiliate_applications_open THEN
      -- Affiliate production prerequisites (Phase 1B SQL/Edge/Stripe, legal,
      -- CPA, G12a-B) are NOT satisfied. Fail closed unconditionally.
      RAISE EXCEPTION 'AFFILIATE_PROGRAM_DEFERRED' USING ERRCODE = '22023';
    END IF;
    -- Canonical Service Partner Agreement v2 + exact disclosure only.
    IF encode(sha256(convert_to(NEW.agreement_text, 'UTF8')), 'hex') <> '02e337dd2ae09436813e5d69ac402f9cc03d80fc79336d4cc7713e868cd7508e'
      OR encode(sha256(convert_to(NEW.disclosure_text, 'UTF8')), 'hex') <> '2d8b74957f7f4d66dcd262a49d3ae8a331c8084b8b11390bddae40f7363df91e' THEN
      RAISE EXCEPTION 'PARTNER_TERMS_NOT_CANONICAL' USING ERRCODE = '22023';
    END IF;
  END IF;
  IF TG_OP = 'UPDATE' AND OLD.status IN ('active','retired') THEN
    IF NEW.commission_bps IS DISTINCT FROM OLD.commission_bps
      OR NEW.attribution_window_days IS DISTINCT FROM OLD.attribution_window_days
      OR NEW.hold_days IS DISTINCT FROM OLD.hold_days
      OR NEW.min_payout_cents IS DISTINCT FROM OLD.min_payout_cents
      OR NEW.currency IS DISTINCT FROM OLD.currency
      OR NEW.commission_duration_invoices IS DISTINCT FROM OLD.commission_duration_invoices
      OR NEW.service_partner_applications_open IS DISTINCT FROM OLD.service_partner_applications_open
      OR NEW.affiliate_applications_open IS DISTINCT FROM OLD.affiliate_applications_open
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
END $function$;
REVOKE ALL ON FUNCTION public.partner_terms_validate() FROM PUBLIC, anon, authenticated;

-- ---------------------------------------------------------------------
-- Owner: service-only draft. Affiliate fields forced NULL / closed.
-- ---------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.owner_save_service_partner_terms_draft(_version integer, _agreement_text text, _disclosure_text text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
DECLARE v_owner uuid := public.partner_require_owner(); v_status text;
BEGIN
  IF _version IS NULL OR _version <= 0 THEN RAISE EXCEPTION 'INVALID_VERSION' USING ERRCODE = '22023'; END IF;
  SELECT status INTO v_status FROM public.partner_program_terms WHERE version = _version FOR UPDATE;
  IF v_status IS NULL THEN
    INSERT INTO public.partner_program_terms (version, status, service_partner_applications_open, affiliate_applications_open,
      commission_bps, attribution_window_days, hold_days, min_payout_cents, currency, commission_duration_invoices,
      agreement_text, disclosure_text, created_by)
    VALUES (_version, 'draft', true, false, NULL, NULL, NULL, NULL, NULL, NULL, _agreement_text, _disclosure_text, v_owner);
    RETURN jsonb_build_object('ok', true, 'version', _version, 'created', true);
  END IF;
  IF v_status <> 'draft' THEN RAISE EXCEPTION 'TERMS_NOT_DRAFT' USING ERRCODE = '22023'; END IF;
  UPDATE public.partner_program_terms
     SET service_partner_applications_open = true, affiliate_applications_open = false,
         commission_bps = NULL, attribution_window_days = NULL, hold_days = NULL, min_payout_cents = NULL,
         currency = NULL, commission_duration_invoices = NULL,
         agreement_text = _agreement_text, disclosure_text = _disclosure_text
   WHERE version = _version AND status = 'draft';
  RETURN jsonb_build_object('ok', true, 'version', _version, 'created', false);
END $function$;
REVOKE ALL ON FUNCTION public.owner_save_service_partner_terms_draft(integer, text, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.owner_save_service_partner_terms_draft(integer, text, text) TO authenticated, service_role;
-- Existing 8-arg owner_save_partner_terms_draft is left unchanged: rows it
-- creates default to both tracks closed and therefore cannot activate.

-- ---------------------------------------------------------------------
-- Applications: database rejects closed tracks.
-- ---------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.submit_partner_application(_wants_affiliate boolean, _wants_service_partner boolean, _pitch text)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
DECLARE v_uid uuid := auth.uid(); v_t public.partner_program_terms; v_id uuid;
BEGIN
  IF v_uid IS NULL THEN RAISE EXCEPTION 'AUTH_REQUIRED' USING ERRCODE = '42501'; END IF;
  IF NOT (coalesce(_wants_affiliate, false) OR coalesce(_wants_service_partner, false)) THEN
    RAISE EXCEPTION 'ROLE_REQUIRED' USING ERRCODE = '22023';
  END IF;
  v_t := public.partner_active_terms();
  IF coalesce(_wants_affiliate, false) AND NOT coalesce(v_t.affiliate_applications_open, false) THEN
    RAISE EXCEPTION 'AFFILIATE_APPLICATIONS_CLOSED' USING ERRCODE = '22023';
  END IF;
  IF coalesce(_wants_service_partner, false) AND NOT coalesce(v_t.service_partner_applications_open, false) THEN
    RAISE EXCEPTION 'SERVICE_PARTNER_APPLICATIONS_CLOSED' USING ERRCODE = '22023';
  END IF;
  IF v_t.id IS NULL THEN RAISE EXCEPTION 'PROGRAM_NOT_OPEN' USING ERRCODE = '22023'; END IF;
  IF EXISTS (SELECT 1 FROM public.partners WHERE user_id = v_uid AND status IN ('approved','suspended','terminated')) THEN
    RAISE EXCEPTION 'ALREADY_PARTNER' USING ERRCODE = '22023';
  END IF;
  INSERT INTO public.partner_applications (user_id, wants_affiliate, wants_service_partner, pitch, terms_version)
  VALUES (v_uid, coalesce(_wants_affiliate, false), coalesce(_wants_service_partner, false), left(btrim(_pitch), 1000), v_t.version)
  RETURNING id INTO v_id;  -- partner_applications_one_pending blocks duplicate pending
  RETURN v_id;
END $function$;

-- ---------------------------------------------------------------------
-- Owner review: Affiliate approvals refused while Affiliate closed.
-- ---------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.owner_review_partner_application(_application_id uuid, _approve boolean, _note text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
DECLARE v_owner uuid := public.partner_require_owner(); v_a public.partner_applications; v_t public.partner_program_terms; v_code text;
BEGIN
  SELECT * INTO v_a FROM public.partner_applications WHERE id = _application_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'APPLICATION_NOT_FOUND' USING ERRCODE = 'P0002'; END IF;
  IF v_a.status <> 'pending' THEN RAISE EXCEPTION 'APPLICATION_NOT_PENDING' USING ERRCODE = '22023'; END IF;
  IF _approve AND v_a.wants_affiliate THEN
    v_t := public.partner_active_terms();
    IF NOT coalesce(v_t.affiliate_applications_open, false) THEN
      RAISE EXCEPTION 'AFFILIATE_APPLICATIONS_CLOSED' USING ERRCODE = '22023';
    END IF;
  END IF;
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
END $function$;

-- ---------------------------------------------------------------------
-- Payouts: affiliate-only AND Affiliate track open.
-- ---------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.request_partner_payout(_amount_cents integer)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
DECLARE v_uid uuid := auth.uid(); v_p public.partners; v_t public.partner_program_terms;
        v_available bigint; v_reserved bigint; v_id uuid;
BEGIN
  IF v_uid IS NULL THEN RAISE EXCEPTION 'AUTH_REQUIRED' USING ERRCODE = '42501'; END IF;
  SELECT * INTO v_p FROM public.partners WHERE user_id = v_uid FOR UPDATE;
  IF v_p.id IS NULL OR v_p.status <> 'approved' THEN RAISE EXCEPTION 'PARTNER_NOT_APPROVED' USING ERRCODE = '42501'; END IF;
  IF NOT v_p.is_affiliate THEN RAISE EXCEPTION 'PARTNER_NOT_AFFILIATE' USING ERRCODE = '42501'; END IF;
  IF v_p.tax_doc_status <> 'verified' THEN RAISE EXCEPTION 'TAX_DOCS_NOT_VERIFIED' USING ERRCODE = '42501'; END IF;
  v_t := public.partner_active_terms();
  IF v_t.id IS NULL OR NOT v_t.affiliate_applications_open THEN RAISE EXCEPTION 'AFFILIATE_PROGRAM_CLOSED' USING ERRCODE = '22023'; END IF;
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
END $function$;

-- ---------------------------------------------------------------------
-- Legacy referral attribution: requires Affiliate open.
-- ---------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.record_referral_attribution(_code text, _source text DEFAULT 'link'::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
DECLARE v_uid uuid := auth.uid(); v_code text; v_t public.partner_program_terms; v_p public.partners; v_existing uuid;
BEGIN
  IF v_uid IS NULL THEN RAISE EXCEPTION 'AUTH_REQUIRED' USING ERRCODE = '42501'; END IF;
  v_code := lower(btrim(coalesce(_code, '')));
  IF v_code !~ '^[a-z0-9]{10}$' THEN RETURN jsonb_build_object('ok', false, 'reason', 'INVALID_CODE'); END IF;
  IF _source NOT IN ('link','code') THEN RETURN jsonb_build_object('ok', false, 'reason', 'INVALID_SOURCE'); END IF;
  SELECT id INTO v_existing FROM public.partner_referrals WHERE referred_user_id = v_uid AND status IN ('pending','qualified');
  IF v_existing IS NOT NULL THEN RETURN jsonb_build_object('ok', true, 'already_attributed', true); END IF;
  v_t := public.partner_active_terms();
  IF v_t.id IS NULL OR NOT v_t.affiliate_applications_open THEN RETURN jsonb_build_object('ok', false, 'reason', 'PROGRAM_NOT_OPEN'); END IF;
  SELECT * INTO v_p FROM public.partners WHERE referral_code = v_code AND status = 'approved' AND is_affiliate;
  IF v_p.id IS NULL THEN RETURN jsonb_build_object('ok', false, 'reason', 'CODE_NOT_ACTIVE'); END IF;
  IF v_p.user_id = v_uid THEN RETURN jsonb_build_object('ok', false, 'reason', 'SELF_REFERRAL'); END IF;
  INSERT INTO public.partner_referrals (partner_id, referred_user_id, terms_version, source)
  VALUES (v_p.id, v_uid, v_t.version, _source)
  ON CONFLICT (referred_user_id) WHERE status IN ('pending','qualified') DO NOTHING;
  RETURN jsonb_build_object('ok', true, 'already_attributed', false);
END $function$;

-- ---------------------------------------------------------------------
-- Summary: independent flags; program_open = either track open.
-- ---------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.get_my_partner_summary()
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
DECLARE v_uid uuid := auth.uid(); v_p public.partners; v_t public.partner_program_terms; v_cur text;
        v_year timestamptz := date_trunc('year', now()); v_svc boolean; v_aff boolean;
BEGIN
  IF v_uid IS NULL THEN RAISE EXCEPTION 'AUTH_REQUIRED' USING ERRCODE = '42501'; END IF;
  v_t := public.partner_active_terms();
  v_svc := coalesce(v_t.service_partner_applications_open, false);
  v_aff := coalesce(v_t.affiliate_applications_open, false);
  SELECT * INTO v_p FROM public.partners WHERE user_id = v_uid;
  IF v_p.id IS NULL THEN
    RETURN jsonb_build_object('ok', true, 'is_partner', false, 'program_open', v_svc OR v_aff,
      'service_partner_applications_open', v_svc, 'affiliate_applications_open', v_aff);
  END IF;
  v_cur := coalesce(v_t.currency, (SELECT currency FROM public.partner_commission_ledger WHERE partner_id = v_p.id LIMIT 1));
  RETURN jsonb_build_object(
    'ok', true, 'is_partner', true, 'program_open', v_svc OR v_aff,
    'service_partner_applications_open', v_svc, 'affiliate_applications_open', v_aff,
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
END $function$;

-- ---------------------------------------------------------------------
-- Public status: two booleans, active version, and SHA-256 of the active
-- agreement/disclosure text (lets the public agreement page verify it is
-- showing the effective canonical text). No PII.
-- ---------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.get_partner_program_status()
 RETURNS jsonb
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
  SELECT jsonb_build_object(
    'service_partner_applications_open', coalesce((SELECT t.service_partner_applications_open FROM public.partner_program_terms t WHERE t.status = 'active' LIMIT 1), false),
    'affiliate_applications_open', coalesce((SELECT t.affiliate_applications_open FROM public.partner_program_terms t WHERE t.status = 'active' LIMIT 1), false),
    'active_version', (SELECT t.version FROM public.partner_program_terms t WHERE t.status = 'active' LIMIT 1),
    'agreement_sha256', (SELECT encode(sha256(convert_to(t.agreement_text, 'UTF8')), 'hex') FROM public.partner_program_terms t WHERE t.status = 'active' LIMIT 1),
    'disclosure_sha256', (SELECT encode(sha256(convert_to(t.disclosure_text, 'UTF8')), 'hex') FROM public.partner_program_terms t WHERE t.status = 'active' LIMIT 1)
  )
$function$;
REVOKE ALL ON FUNCTION public.get_partner_program_status() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_partner_program_status() TO anon, authenticated, service_role;

-- Re-assert privileges on replaced RPCs (CREATE OR REPLACE keeps ACLs; explicit for parity).
REVOKE ALL ON FUNCTION public.submit_partner_application(boolean, boolean, text) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.owner_review_partner_application(uuid, boolean, text) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.request_partner_payout(integer) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.record_referral_attribution(text, text) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.get_my_partner_summary() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.submit_partner_application(boolean, boolean, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.owner_review_partner_application(uuid, boolean, text) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.request_partner_payout(integer) TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_my_partner_summary() TO authenticated;
-- record_referral_attribution: grants intentionally not widened (1B-2 revokes it later).

COMMIT;
