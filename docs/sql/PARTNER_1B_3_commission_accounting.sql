-- PARTNER PROGRAM PHASE 1B-3 — DATABASE-SIDE COMMISSION ACCOUNTING
-- STAGED FOR REVIEW ONLY. NOT APPLIED. Do not run without explicit authorization.
--
-- Extends the applied Phase 1A contract (20260928170228/170613/170917) and the
-- staged 1B-2 click tokens. No terms are seeded or activated. No webhook change.
--
-- Model
--  * partner_commission_ledger stays append-only (existing guard trigger).
--    Every change in commission is a NEW signed row: accrual (+), reversal (-),
--    restoration (+). Paid rows are never touched; reversals after payout drive
--    the derived balance negative (carry-forward).
--  * Server-only state tables hold the latest provider object state for
--    invoices, refunds and disputes. They may be updated by service_role; they
--    store provider object IDs, integer cents and statuses only — no raw
--    payload, customer, email, card or address data.
--  * For each accrued invoice the target commission is recomputed from
--    aggregate exposure and only the delta is inserted, bounded to
--    [0, original commission]. This bound prevents refund+dispute overlap from
--    reversing more than was accrued.
--  * Available balance keeps the Phase 1A rule (positive after available_at,
--    negatives immediately). Restorations inherit the original accrual's
--    available_at, so no maturation job is required.
--  * checkout.session.completed has no ingestion function and never accrues.

-- ---------------------------------------------------------------------
-- A) Terms: commission duration (intended 12) + stricter activation guard
-- ---------------------------------------------------------------------
ALTER TABLE public.partner_program_terms
  ADD COLUMN IF NOT EXISTS commission_duration_invoices integer NULL
  CHECK (commission_duration_invoices IS NULL OR (commission_duration_invoices BETWEEN 1 AND 120));

CREATE OR REPLACE FUNCTION public.partner_terms_validate()
RETURNS trigger LANGUAGE plpgsql SET search_path = '' AS $$
BEGIN
  IF NEW.status = 'active' AND (
       NEW.commission_bps IS NULL OR NEW.attribution_window_days IS NULL
    OR NEW.hold_days IS NULL OR NEW.min_payout_cents IS NULL OR NEW.currency IS NULL
    OR NEW.commission_duration_invoices IS NULL
    OR coalesce(btrim(NEW.agreement_text), '') = '' OR coalesce(btrim(NEW.disclosure_text), '') = '') THEN
    RAISE EXCEPTION 'PARTNER_TERMS_INCOMPLETE' USING ERRCODE = '22023';
  END IF;
  -- Legal text must be final: no unresolved [PLACEHOLDER] tokens.
  IF NEW.status = 'active' AND (NEW.agreement_text ~ '\[[A-Z0-9][A-Z0-9 /&.,''-]*\]'
                             OR NEW.disclosure_text ~ '\[[A-Z0-9][A-Z0-9 /&.,''-]*\]') THEN
    RAISE EXCEPTION 'PARTNER_TERMS_PLACEHOLDERS_REMAIN' USING ERRCODE = '22023';
  END IF;
  IF TG_OP = 'UPDATE' AND OLD.status IN ('active','retired') THEN
    IF NEW.commission_bps IS DISTINCT FROM OLD.commission_bps
      OR NEW.attribution_window_days IS DISTINCT FROM OLD.attribution_window_days
      OR NEW.hold_days IS DISTINCT FROM OLD.hold_days
      OR NEW.min_payout_cents IS DISTINCT FROM OLD.min_payout_cents
      OR NEW.currency IS DISTINCT FROM OLD.currency
      OR NEW.commission_duration_invoices IS DISTINCT FROM OLD.commission_duration_invoices
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
REVOKE ALL ON FUNCTION public.partner_terms_validate() FROM PUBLIC, anon, authenticated;

-- Owner draft save including duration. The Phase 1A 8-argument overload stays
-- (it leaves duration NULL, so activation fails closed until set here).
CREATE OR REPLACE FUNCTION public.owner_save_partner_terms_draft(
  _version integer, _commission_bps integer, _attribution_window_days integer, _hold_days integer,
  _min_payout_cents integer, _currency text, _agreement_text text, _disclosure_text text,
  _commission_duration_invoices integer)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE v_owner uuid := public.partner_require_owner(); v_status text;
BEGIN
  IF _version IS NULL OR _version <= 0 THEN RAISE EXCEPTION 'INVALID_VERSION' USING ERRCODE = '22023'; END IF;
  SELECT status INTO v_status FROM public.partner_program_terms WHERE version = _version FOR UPDATE;
  IF v_status IS NULL THEN
    INSERT INTO public.partner_program_terms (version, status, commission_bps, attribution_window_days, hold_days,
      min_payout_cents, currency, agreement_text, disclosure_text, commission_duration_invoices, created_by)
    VALUES (_version, 'draft', _commission_bps, _attribution_window_days, _hold_days,
      _min_payout_cents, lower(_currency), _agreement_text, _disclosure_text, _commission_duration_invoices, v_owner);
    RETURN jsonb_build_object('ok', true, 'version', _version, 'created', true);
  END IF;
  IF v_status <> 'draft' THEN RAISE EXCEPTION 'TERMS_NOT_DRAFT' USING ERRCODE = '22023'; END IF;
  UPDATE public.partner_program_terms
     SET commission_bps = _commission_bps, attribution_window_days = _attribution_window_days,
         hold_days = _hold_days, min_payout_cents = _min_payout_cents, currency = lower(_currency),
         agreement_text = _agreement_text, disclosure_text = _disclosure_text,
         commission_duration_invoices = _commission_duration_invoices
   WHERE version = _version AND status = 'draft';
  RETURN jsonb_build_object('ok', true, 'version', _version, 'created', false);
END $$;
REVOKE ALL ON FUNCTION public.owner_save_partner_terms_draft(integer, integer, integer, integer, integer, text, text, text, integer) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.owner_save_partner_terms_draft(integer, integer, integer, integer, integer, text, text, text, integer) TO authenticated, service_role;

-- ---------------------------------------------------------------------
-- B) Ledger: compatible extension (existing rows remain valid)
-- ---------------------------------------------------------------------
ALTER TABLE public.partner_commission_ledger
  ADD COLUMN IF NOT EXISTS stripe_environment text NULL CHECK (stripe_environment IS NULL OR stripe_environment IN ('test','live')),
  ADD COLUMN IF NOT EXISTS source_object text NULL CHECK (source_object IS NULL OR source_object IN ('invoice','refund','dispute')),
  ADD COLUMN IF NOT EXISTS stripe_invoice_ref text NULL CHECK (stripe_invoice_ref IS NULL OR stripe_invoice_ref ~ '^in_[A-Za-z0-9]{1,250}$'),
  ADD COLUMN IF NOT EXISTS stripe_charge_ref text NULL CHECK (stripe_charge_ref IS NULL OR stripe_charge_ref ~ '^(ch|py)_[A-Za-z0-9]{1,250}$'),
  ADD COLUMN IF NOT EXISTS stripe_refund_ref text NULL CHECK (stripe_refund_ref IS NULL OR stripe_refund_ref ~ '^(re|pyr)_[A-Za-z0-9]{1,250}$'),
  ADD COLUMN IF NOT EXISTS stripe_dispute_ref text NULL CHECK (stripe_dispute_ref IS NULL OR stripe_dispute_ref ~ '^(dp|du)_[A-Za-z0-9]{1,250}$'),
  ADD COLUMN IF NOT EXISTS accrual_entry_id uuid NULL REFERENCES public.partner_commission_ledger(id),
  ADD COLUMN IF NOT EXISTS occurred_at timestamptz NULL;

-- Allow the new positive 'restoration' type. Existing rows satisfy the new
-- check (it is a strict superset of the Phase 1A rule).
ALTER TABLE public.partner_commission_ledger DROP CONSTRAINT IF EXISTS ledger_sign_by_type;
ALTER TABLE public.partner_commission_ledger ADD CONSTRAINT ledger_sign_by_type CHECK (
       (entry_type = 'accrual'     AND amount_cents > 0)
    OR (entry_type = 'reversal'    AND amount_cents < 0)
    OR (entry_type = 'restoration' AND amount_cents > 0 AND accrual_entry_id IS NOT NULL)
    OR (entry_type = 'payout'      AND amount_cents < 0 AND payout_request_id IS NOT NULL)
    OR (entry_type = 'adjustment'));
ALTER TABLE public.partner_commission_ledger DROP CONSTRAINT IF EXISTS partner_commission_ledger_entry_type_check;
ALTER TABLE public.partner_commission_ledger ADD CONSTRAINT partner_commission_ledger_entry_type_check
  CHECK (entry_type IN ('accrual','reversal','restoration','adjustment','payout'));
-- Stripe-sourced rows must carry environment + object + invoice (+ link for deltas).
ALTER TABLE public.partner_commission_ledger ADD CONSTRAINT ledger_stripe_source_shape CHECK (
  source_kind <> 'stripe_event' OR (
    stripe_environment IS NOT NULL AND source_object IS NOT NULL AND stripe_invoice_ref IS NOT NULL
    AND occurred_at IS NOT NULL
    AND (entry_type = 'accrual' OR accrual_entry_id IS NOT NULL))) NOT VALID;
-- NOT VALID: Phase 1A never wrote stripe_event rows (live table empty); the
-- constraint is enforced for every new row. VALIDATE after apply if desired.

-- One accrual per provider invoice per environment.
CREATE UNIQUE INDEX IF NOT EXISTS partner_commission_ledger_one_invoice_accrual
  ON public.partner_commission_ledger (stripe_environment, stripe_invoice_ref)
  WHERE entry_type = 'accrual' AND source_kind = 'stripe_event';
-- One delta per (triggering provider event, accrual). Replays insert nothing.
CREATE UNIQUE INDEX IF NOT EXISTS partner_commission_ledger_one_delta_per_event
  ON public.partner_commission_ledger (stripe_environment, source_event_ref, accrual_entry_id)
  WHERE entry_type IN ('reversal','restoration') AND source_kind = 'stripe_event';
CREATE INDEX IF NOT EXISTS partner_commission_ledger_accrual_link_idx
  ON public.partner_commission_ledger (accrual_entry_id) WHERE accrual_entry_id IS NOT NULL;

-- ---------------------------------------------------------------------
-- C) Server-only state tables (service_role only; RLS on; no policies)
-- ---------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.partner_commission_events (
  environment text NOT NULL CHECK (environment IN ('test','live')),
  event_ref text NOT NULL CHECK (event_ref ~ '^evt_[A-Za-z0-9]{1,250}$'),
  kind text NOT NULL CHECK (kind IN ('invoice_paid','refund','dispute')),
  outcome text NOT NULL CHECK (char_length(outcome) <= 60),
  processed_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (environment, event_ref)
);

CREATE TABLE IF NOT EXISTS public.partner_invoice_commissions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  environment text NOT NULL CHECK (environment IN ('test','live')),
  invoice_ref text NOT NULL CHECK (invoice_ref ~ '^in_[A-Za-z0-9]{1,250}$'),
  charge_ref text NULL CHECK (charge_ref IS NULL OR charge_ref ~ '^(ch|py)_[A-Za-z0-9]{1,250}$'),
  subscription_ref text NOT NULL,
  workspace_id uuid NOT NULL REFERENCES public.workspaces(id),
  partner_id uuid NOT NULL REFERENCES public.partners(id),
  referral_id uuid NOT NULL REFERENCES public.partner_referrals(id),
  terms_version integer NOT NULL REFERENCES public.partner_program_terms(version),
  currency text NOT NULL CHECK (currency ~ '^[a-z]{3}$'),
  amount_paid_cents integer NOT NULL CHECK (amount_paid_cents > 0),
  eligible_base_cents integer NOT NULL CHECK (eligible_base_cents > 0),
  commission_bps integer NOT NULL CHECK (commission_bps BETWEEN 1 AND 10000),
  commission_cents integer NOT NULL CHECK (commission_cents > 0),
  applied_commission_cents integer NOT NULL CHECK (applied_commission_cents >= 0),
  invoice_sequence integer NOT NULL CHECK (invoice_sequence >= 1),
  accrual_entry_id uuid NOT NULL UNIQUE REFERENCES public.partner_commission_ledger(id),
  paid_at timestamptz NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT pic_base_le_paid CHECK (eligible_base_cents <= amount_paid_cents),
  CONSTRAINT pic_applied_le_commission CHECK (applied_commission_cents <= commission_cents),
  UNIQUE (environment, invoice_ref),
  UNIQUE (referral_id, invoice_sequence)
);
CREATE INDEX IF NOT EXISTS pic_charge_idx ON public.partner_invoice_commissions (environment, charge_ref);

CREATE TABLE IF NOT EXISTS public.partner_refund_states (
  environment text NOT NULL CHECK (environment IN ('test','live')),
  refund_ref text NOT NULL CHECK (refund_ref ~ '^(re|pyr)_[A-Za-z0-9]{1,250}$'),
  invoice_ref text NOT NULL CHECK (invoice_ref ~ '^in_[A-Za-z0-9]{1,250}$'),
  charge_ref text NULL,
  amount_cents integer NOT NULL CHECK (amount_cents > 0),
  status text NOT NULL CHECK (status IN ('pending','requires_action','succeeded','failed','canceled')),
  last_event_ref text NOT NULL,
  last_event_created timestamptz NOT NULL,
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (environment, refund_ref)
);
CREATE INDEX IF NOT EXISTS prs_invoice_idx ON public.partner_refund_states (environment, invoice_ref);

CREATE TABLE IF NOT EXISTS public.partner_dispute_states (
  environment text NOT NULL CHECK (environment IN ('test','live')),
  dispute_ref text NOT NULL CHECK (dispute_ref ~ '^(dp|du)_[A-Za-z0-9]{1,250}$'),
  invoice_ref text NOT NULL CHECK (invoice_ref ~ '^in_[A-Za-z0-9]{1,250}$'),
  charge_ref text NULL,
  amount_cents integer NOT NULL CHECK (amount_cents > 0),
  status text NOT NULL CHECK (status IN ('warning_needs_response','warning_under_review','warning_closed',
                                         'needs_response','under_review','won','lost')),
  last_event_ref text NOT NULL,
  last_event_created timestamptz NOT NULL,
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (environment, dispute_ref)
);
CREATE INDEX IF NOT EXISTS pds_invoice_idx ON public.partner_dispute_states (environment, invoice_ref);

REVOKE ALL ON public.partner_commission_events, public.partner_invoice_commissions,
  public.partner_refund_states, public.partner_dispute_states FROM PUBLIC, anon, authenticated;
GRANT ALL ON public.partner_commission_events, public.partner_invoice_commissions,
  public.partner_refund_states, public.partner_dispute_states TO service_role;
ALTER TABLE public.partner_commission_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.partner_invoice_commissions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.partner_refund_states ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.partner_dispute_states ENABLE ROW LEVEL SECURITY;
-- Intentionally no policies: clients cannot read or write state tables.

-- ---------------------------------------------------------------------
-- D) Pure helpers
-- ---------------------------------------------------------------------
-- Commission from integer cents: floor(base * bps / 10000). $49.00 @ 2000 = 980.
CREATE OR REPLACE FUNCTION public.partner_commission_cents(_base_cents bigint, _bps integer)
RETURNS integer LANGUAGE sql IMMUTABLE SET search_path = '' AS $$
  SELECT ((_base_cents * _bps) / 10000)::integer
$$;
-- Target after exposure: floor(commission * (paid - exposure) / paid), with
-- exposure clamped to [0, paid]. Result always within [0, commission].
CREATE OR REPLACE FUNCTION public.partner_commission_target(_commission integer, _paid integer, _exposure bigint)
RETURNS integer LANGUAGE sql IMMUTABLE SET search_path = '' AS $$
  SELECT (_commission::bigint * (_paid - least(greatest(_exposure, 0), _paid)) / _paid)::integer
$$;
CREATE OR REPLACE FUNCTION public.partner_refund_rank(_s text)
RETURNS integer LANGUAGE sql IMMUTABLE SET search_path = '' AS $$
  SELECT CASE _s WHEN 'pending' THEN 1 WHEN 'requires_action' THEN 1 WHEN 'succeeded' THEN 2
                 WHEN 'failed' THEN 3 WHEN 'canceled' THEN 3 ELSE 0 END
$$;
CREATE OR REPLACE FUNCTION public.partner_dispute_rank(_s text)
RETURNS integer LANGUAGE sql IMMUTABLE SET search_path = '' AS $$
  SELECT CASE WHEN _s IN ('won','lost','warning_closed') THEN 2 ELSE 1 END
$$;
-- Newer event wins; ties broken by status precedence (terminal outranks open).
CREATE OR REPLACE FUNCTION public.partner_event_supersedes(_new_created timestamptz, _new_rank integer,
  _old_created timestamptz, _old_rank integer)
RETURNS boolean LANGUAGE sql IMMUTABLE SET search_path = '' AS $$
  SELECT _new_created > _old_created OR (_new_created = _old_created AND _new_rank > _old_rank)
$$;

-- ---------------------------------------------------------------------
-- E) Recompute exposure for one accrued invoice and insert only the delta
-- ---------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.partner_recompute_invoice_commission(
  _environment text, _invoice_ref text, _event_ref text, _event_created timestamptz, _source_object text,
  _refund_ref text, _dispute_ref text)
RETURNS integer LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE v_i public.partner_invoice_commissions; v_refunds bigint; v_disputes bigint; v_target integer; v_delta integer;
        v_accrual public.partner_commission_ledger;
BEGIN
  IF coalesce(auth.role(), '') <> 'service_role' THEN RAISE EXCEPTION 'SERVICE_ROLE_REQUIRED' USING ERRCODE = '42501'; END IF;
  SELECT * INTO v_i FROM public.partner_invoice_commissions
   WHERE environment = _environment AND invoice_ref = _invoice_ref FOR UPDATE;
  IF v_i.id IS NULL THEN RETURN 0; END IF;  -- not accrued (yet): state kept for later
  -- Conservative exposure: pending/requires_action/succeeded refunds, plus
  -- open or lost disputes. won / warning_closed / failed / canceled release.
  SELECT coalesce(sum(amount_cents), 0) INTO v_refunds FROM public.partner_refund_states
   WHERE environment = _environment AND invoice_ref = _invoice_ref
     AND status IN ('pending','requires_action','succeeded');
  SELECT coalesce(sum(amount_cents), 0) INTO v_disputes FROM public.partner_dispute_states
   WHERE environment = _environment AND invoice_ref = _invoice_ref
     AND status NOT IN ('won','warning_closed');
  -- Overlap cap: combined exposure never exceeds the amount paid, so the
  -- target never falls below 0 nor rises above the original commission.
  v_target := public.partner_commission_target(v_i.commission_cents, v_i.amount_paid_cents, v_refunds + v_disputes);
  v_delta := v_target - v_i.applied_commission_cents;
  IF v_delta = 0 THEN RETURN 0; END IF;
  SELECT * INTO v_accrual FROM public.partner_commission_ledger WHERE id = v_i.accrual_entry_id;
  INSERT INTO public.partner_commission_ledger (
    partner_id, referral_id, workspace_id, terms_version, entry_type, amount_cents, currency, available_at,
    source_kind, source_event_ref, stripe_environment, source_object, stripe_invoice_ref, stripe_charge_ref,
    stripe_refund_ref, stripe_dispute_ref, accrual_entry_id, occurred_at, note)
  VALUES (
    v_i.partner_id, v_i.referral_id, v_i.workspace_id, v_i.terms_version,
    CASE WHEN v_delta < 0 THEN 'reversal' ELSE 'restoration' END, v_delta, v_i.currency,
    CASE WHEN v_delta < 0 THEN now() ELSE v_accrual.available_at END,
    'stripe_event', _event_ref, _environment, _source_object, _invoice_ref, v_i.charge_ref,
    _refund_ref, _dispute_ref, v_i.accrual_entry_id, _event_created, NULL)
  ON CONFLICT DO NOTHING;
  IF NOT FOUND THEN RETURN 0; END IF;
  UPDATE public.partner_invoice_commissions SET applied_commission_cents = v_target, updated_at = now() WHERE id = v_i.id;
  RETURN v_delta;
END $$;

-- ---------------------------------------------------------------------
-- F) Ingestion: invoice.paid
--    Caller (future webhook) supplies Stripe-retrieved values; the database
--    revalidates every eligibility rule and computes commission itself.
-- ---------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.partner_ingest_invoice_paid(
  _environment text, _event_ref text, _event_created timestamptz,
  _invoice_ref text, _charge_ref text, _subscription_ref text, _price_ref text,
  _workspace_id uuid, _currency text, _amount_paid_cents integer, _eligible_base_cents integer,
  _paid_at timestamptz)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE v_cur text := lower(coalesce(_currency, '')); v_r public.partner_referrals; v_p public.partners;
        v_t public.partner_program_terms; v_count integer; v_commission integer; v_paid_at timestamptz;
        v_entry uuid; v_owner uuid;
BEGIN
  IF coalesce(auth.role(), '') <> 'service_role' THEN RAISE EXCEPTION 'SERVICE_ROLE_REQUIRED' USING ERRCODE = '42501'; END IF;
  IF _environment NOT IN ('test','live') OR coalesce(_event_ref, '') !~ '^evt_[A-Za-z0-9]{1,250}$'
     OR coalesce(_invoice_ref, '') !~ '^in_[A-Za-z0-9]{1,250}$' OR _event_created IS NULL OR _paid_at IS NULL THEN
    RETURN jsonb_build_object('accrued', false, 'reason', 'INVALID_INPUT');
  END IF;
  -- Event idempotency (duplicate delivery of the same event).
  INSERT INTO public.partner_commission_events (environment, event_ref, kind, outcome)
  VALUES (_environment, _event_ref, 'invoice_paid', 'processing') ON CONFLICT DO NOTHING;
  IF NOT FOUND THEN RETURN jsonb_build_object('accrued', false, 'reason', 'DUPLICATE_EVENT'); END IF;
  -- Invoice idempotency (different event, same invoice).
  IF EXISTS (SELECT 1 FROM public.partner_invoice_commissions WHERE environment = _environment AND invoice_ref = _invoice_ref) THEN
    UPDATE public.partner_commission_events SET outcome = 'DUPLICATE_INVOICE' WHERE environment = _environment AND event_ref = _event_ref;
    RETURN jsonb_build_object('accrued', false, 'reason', 'DUPLICATE_INVOICE');
  END IF;

  -- Shared-account isolation: the subscription must be a mapped Cartel HQ
  -- subscription for this workspace in THIS environment, on an active mapped price.
  IF NOT EXISTS (SELECT 1 FROM public.commercial_billing_subscriptions s
                  WHERE s.provider = 'stripe' AND s.environment = _environment
                    AND s.subscription_ref = _subscription_ref AND s.workspace_id = _workspace_id)
     OR NOT EXISTS (SELECT 1 FROM public.commercial_plan_provider_refs pr
                     WHERE pr.provider = 'stripe' AND pr.environment = _environment
                       AND pr.price_ref = _price_ref AND pr.active) THEN
    UPDATE public.partner_commission_events SET outcome = 'NOT_MAPPED' WHERE environment = _environment AND event_ref = _event_ref;
    RETURN jsonb_build_object('accrued', false, 'reason', 'NOT_MAPPED');
  END IF;
  -- Owner unrestricted workspaces are never billed and never generate commission.
  SELECT w.owner_id INTO v_owner FROM public.workspaces w WHERE w.id = _workspace_id;
  IF v_owner IS NULL OR public.has_platform_unrestricted_access(v_owner) THEN
    UPDATE public.partner_commission_events SET outcome = 'NOT_ELIGIBLE' WHERE environment = _environment AND event_ref = _event_ref;
    RETURN jsonb_build_object('accrued', false, 'reason', 'NOT_ELIGIBLE');
  END IF;
  -- Qualified, workspace-bound referral (direct / no attribution => none).
  SELECT * INTO v_r FROM public.partner_referrals
   WHERE workspace_id = _workspace_id AND status = 'qualified' FOR UPDATE;
  IF v_r.id IS NULL THEN
    UPDATE public.partner_commission_events SET outcome = 'NO_REFERRAL' WHERE environment = _environment AND event_ref = _event_ref;
    RETURN jsonb_build_object('accrued', false, 'reason', 'NO_REFERRAL');
  END IF;
  -- Approved affiliate (service-only partners earn nothing).
  SELECT * INTO v_p FROM public.partners WHERE id = v_r.partner_id;
  IF v_p.id IS NULL OR v_p.status <> 'approved' OR NOT v_p.is_affiliate THEN
    UPDATE public.partner_commission_events SET outcome = 'PARTNER_NOT_ELIGIBLE' WHERE environment = _environment AND event_ref = _event_ref;
    RETURN jsonb_build_object('accrued', false, 'reason', 'PARTNER_NOT_ELIGIBLE');
  END IF;
  -- Snapshotted terms, complete, with agreement acceptance for that version.
  SELECT * INTO v_t FROM public.partner_program_terms WHERE version = v_r.terms_version;
  IF v_t.id IS NULL OR v_t.status NOT IN ('active','retired') OR v_t.commission_bps IS NULL
     OR v_t.hold_days IS NULL OR v_t.commission_duration_invoices IS NULL OR v_t.currency IS NULL THEN
    UPDATE public.partner_commission_events SET outcome = 'TERMS_INCOMPLETE' WHERE environment = _environment AND event_ref = _event_ref;
    RETURN jsonb_build_object('accrued', false, 'reason', 'TERMS_INCOMPLETE');
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.partner_agreement_acceptances WHERE partner_id = v_p.id AND terms_version = v_t.version) THEN
    UPDATE public.partner_commission_events SET outcome = 'AGREEMENT_NOT_ACCEPTED' WHERE environment = _environment AND event_ref = _event_ref;
    RETURN jsonb_build_object('accrued', false, 'reason', 'AGREEMENT_NOT_ACCEPTED');
  END IF;
  IF v_cur <> v_t.currency THEN
    UPDATE public.partner_commission_events SET outcome = 'CURRENCY_MISMATCH' WHERE environment = _environment AND event_ref = _event_ref;
    RETURN jsonb_build_object('accrued', false, 'reason', 'CURRENCY_MISMATCH');
  END IF;
  IF _eligible_base_cents IS NULL OR _amount_paid_cents IS NULL OR _eligible_base_cents <= 0
     OR _eligible_base_cents > _amount_paid_cents THEN
    UPDATE public.partner_commission_events SET outcome = 'NO_ELIGIBLE_BASE' WHERE environment = _environment AND event_ref = _event_ref;
    RETURN jsonb_build_object('accrued', false, 'reason', 'NO_ELIGIBLE_BASE');
  END IF;
  -- Duration cap (first N accrued paid invoices per referred workspace).
  SELECT count(*) INTO v_count FROM public.partner_invoice_commissions WHERE referral_id = v_r.id;
  IF v_count >= v_t.commission_duration_invoices THEN
    UPDATE public.partner_commission_events SET outcome = 'CAP_REACHED' WHERE environment = _environment AND event_ref = _event_ref;
    RETURN jsonb_build_object('accrued', false, 'reason', 'CAP_REACHED');
  END IF;
  v_commission := public.partner_commission_cents(_eligible_base_cents, v_t.commission_bps);
  IF v_commission <= 0 THEN
    UPDATE public.partner_commission_events SET outcome = 'ZERO_COMMISSION' WHERE environment = _environment AND event_ref = _event_ref;
    RETURN jsonb_build_object('accrued', false, 'reason', 'ZERO_COMMISSION');
  END IF;
  v_paid_at := least(_paid_at, now());  -- never trust a future payment time
  INSERT INTO public.partner_commission_ledger (
    partner_id, referral_id, workspace_id, terms_version, entry_type, amount_cents, currency, available_at,
    source_kind, source_event_ref, stripe_environment, source_object, stripe_invoice_ref, stripe_charge_ref, occurred_at)
  VALUES (v_p.id, v_r.id, _workspace_id, v_t.version, 'accrual', v_commission, v_cur,
    v_paid_at + make_interval(days => v_t.hold_days),
    'stripe_event', _event_ref, _environment, 'invoice', _invoice_ref, _charge_ref, v_paid_at)
  RETURNING id INTO v_entry;
  INSERT INTO public.partner_invoice_commissions (environment, invoice_ref, charge_ref, subscription_ref, workspace_id,
    partner_id, referral_id, terms_version, currency, amount_paid_cents, eligible_base_cents, commission_bps,
    commission_cents, applied_commission_cents, invoice_sequence, accrual_entry_id, paid_at)
  VALUES (_environment, _invoice_ref, _charge_ref, _subscription_ref, _workspace_id, v_p.id, v_r.id, v_t.version,
    v_cur, _amount_paid_cents, _eligible_base_cents, v_t.commission_bps, v_commission, v_commission,
    v_count + 1, v_entry, v_paid_at);
  UPDATE public.partner_commission_events SET outcome = 'ACCRUED' WHERE environment = _environment AND event_ref = _event_ref;
  -- Refunds/disputes that arrived before the invoice (out of order) apply now.
  PERFORM public.partner_recompute_invoice_commission(_environment, _invoice_ref, _event_ref, _event_created, 'invoice', NULL, NULL);
  RETURN jsonb_build_object('accrued', true, 'commission_cents', v_commission, 'invoice_sequence', v_count + 1);
END $$;

-- ---------------------------------------------------------------------
-- G) Ingestion: refund created / updated / failed / canceled
-- ---------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.partner_ingest_refund_state(
  _environment text, _event_ref text, _event_created timestamptz,
  _refund_ref text, _invoice_ref text, _charge_ref text, _amount_cents integer, _status text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE v_old public.partner_refund_states; v_delta integer;
BEGIN
  IF coalesce(auth.role(), '') <> 'service_role' THEN RAISE EXCEPTION 'SERVICE_ROLE_REQUIRED' USING ERRCODE = '42501'; END IF;
  IF _environment NOT IN ('test','live') OR coalesce(_event_ref, '') !~ '^evt_[A-Za-z0-9]{1,250}$'
     OR coalesce(_refund_ref, '') !~ '^(re|pyr)_[A-Za-z0-9]{1,250}$' OR coalesce(_invoice_ref, '') !~ '^in_[A-Za-z0-9]{1,250}$'
     OR _amount_cents IS NULL OR _amount_cents <= 0 OR _event_created IS NULL
     OR _status NOT IN ('pending','requires_action','succeeded','failed','canceled') THEN
    RETURN jsonb_build_object('applied', false, 'reason', 'INVALID_INPUT');
  END IF;
  INSERT INTO public.partner_commission_events (environment, event_ref, kind, outcome)
  VALUES (_environment, _event_ref, 'refund', 'processing') ON CONFLICT DO NOTHING;
  IF NOT FOUND THEN RETURN jsonb_build_object('applied', false, 'reason', 'DUPLICATE_EVENT'); END IF;
  SELECT * INTO v_old FROM public.partner_refund_states WHERE environment = _environment AND refund_ref = _refund_ref FOR UPDATE;
  IF v_old.refund_ref IS NULL THEN
    INSERT INTO public.partner_refund_states (environment, refund_ref, invoice_ref, charge_ref, amount_cents, status, last_event_ref, last_event_created)
    VALUES (_environment, _refund_ref, _invoice_ref, _charge_ref, _amount_cents, _status, _event_ref, _event_created);
  ELSIF v_old.invoice_ref <> _invoice_ref THEN
    UPDATE public.partner_commission_events SET outcome = 'INVOICE_MISMATCH' WHERE environment = _environment AND event_ref = _event_ref;
    RETURN jsonb_build_object('applied', false, 'reason', 'INVOICE_MISMATCH');
  ELSIF public.partner_event_supersedes(_event_created, public.partner_refund_rank(_status),
                                        v_old.last_event_created, public.partner_refund_rank(v_old.status)) THEN
    UPDATE public.partner_refund_states SET status = _status, amount_cents = _amount_cents,
      last_event_ref = _event_ref, last_event_created = _event_created, updated_at = now()
     WHERE environment = _environment AND refund_ref = _refund_ref;
  ELSE
    UPDATE public.partner_commission_events SET outcome = 'STALE' WHERE environment = _environment AND event_ref = _event_ref;
    RETURN jsonb_build_object('applied', false, 'reason', 'STALE');
  END IF;
  v_delta := public.partner_recompute_invoice_commission(_environment, _invoice_ref, _event_ref, _event_created, 'refund', _refund_ref, NULL);
  UPDATE public.partner_commission_events SET outcome = 'APPLIED' WHERE environment = _environment AND event_ref = _event_ref;
  RETURN jsonb_build_object('applied', true, 'delta_cents', v_delta);
END $$;

-- ---------------------------------------------------------------------
-- H) Ingestion: dispute created / updated / closed
-- ---------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.partner_ingest_dispute_state(
  _environment text, _event_ref text, _event_created timestamptz,
  _dispute_ref text, _invoice_ref text, _charge_ref text, _amount_cents integer, _status text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE v_old public.partner_dispute_states; v_delta integer;
BEGIN
  IF coalesce(auth.role(), '') <> 'service_role' THEN RAISE EXCEPTION 'SERVICE_ROLE_REQUIRED' USING ERRCODE = '42501'; END IF;
  IF _environment NOT IN ('test','live') OR coalesce(_event_ref, '') !~ '^evt_[A-Za-z0-9]{1,250}$'
     OR coalesce(_dispute_ref, '') !~ '^(dp|du)_[A-Za-z0-9]{1,250}$' OR coalesce(_invoice_ref, '') !~ '^in_[A-Za-z0-9]{1,250}$'
     OR _amount_cents IS NULL OR _amount_cents <= 0 OR _event_created IS NULL
     OR _status NOT IN ('warning_needs_response','warning_under_review','warning_closed','needs_response','under_review','won','lost') THEN
    RETURN jsonb_build_object('applied', false, 'reason', 'INVALID_INPUT');
  END IF;
  INSERT INTO public.partner_commission_events (environment, event_ref, kind, outcome)
  VALUES (_environment, _event_ref, 'dispute', 'processing') ON CONFLICT DO NOTHING;
  IF NOT FOUND THEN RETURN jsonb_build_object('applied', false, 'reason', 'DUPLICATE_EVENT'); END IF;
  SELECT * INTO v_old FROM public.partner_dispute_states WHERE environment = _environment AND dispute_ref = _dispute_ref FOR UPDATE;
  IF v_old.dispute_ref IS NULL THEN
    INSERT INTO public.partner_dispute_states (environment, dispute_ref, invoice_ref, charge_ref, amount_cents, status, last_event_ref, last_event_created)
    VALUES (_environment, _dispute_ref, _invoice_ref, _charge_ref, _amount_cents, _status, _event_ref, _event_created);
  ELSIF v_old.invoice_ref <> _invoice_ref THEN
    UPDATE public.partner_commission_events SET outcome = 'INVOICE_MISMATCH' WHERE environment = _environment AND event_ref = _event_ref;
    RETURN jsonb_build_object('applied', false, 'reason', 'INVOICE_MISMATCH');
  ELSIF public.partner_event_supersedes(_event_created, public.partner_dispute_rank(_status),
                                        v_old.last_event_created, public.partner_dispute_rank(v_old.status)) THEN
    UPDATE public.partner_dispute_states SET status = _status, amount_cents = _amount_cents,
      last_event_ref = _event_ref, last_event_created = _event_created, updated_at = now()
     WHERE environment = _environment AND dispute_ref = _dispute_ref;
  ELSE
    UPDATE public.partner_commission_events SET outcome = 'STALE' WHERE environment = _environment AND event_ref = _event_ref;
    RETURN jsonb_build_object('applied', false, 'reason', 'STALE');
  END IF;
  v_delta := public.partner_recompute_invoice_commission(_environment, _invoice_ref, _event_ref, _event_created, 'dispute', NULL, _dispute_ref);
  UPDATE public.partner_commission_events SET outcome = 'APPLIED' WHERE environment = _environment AND event_ref = _event_ref;
  RETURN jsonb_build_object('applied', true, 'delta_cents', v_delta);
END $$;

-- ---------------------------------------------------------------------
-- I) Derived balances (no stored balance; nothing mutated)
-- ---------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.partner_balance_breakdown(_partner_id uuid, _currency text)
RETURNS jsonb LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' AS $$
  SELECT jsonb_build_object(
    'held_cents',      coalesce(sum(amount_cents) FILTER (WHERE amount_cents > 0 AND available_at > now()), 0),
    'available_cents', coalesce(sum(amount_cents) FILTER (WHERE available_at <= now() OR amount_cents < 0), 0),
    'accrued_cents',   coalesce(sum(amount_cents) FILTER (WHERE entry_type = 'accrual'), 0),
    'reversed_cents',  coalesce(-sum(amount_cents) FILTER (WHERE entry_type = 'reversal'), 0),
    'restored_cents',  coalesce(sum(amount_cents) FILTER (WHERE entry_type = 'restoration'), 0),
    'adjustment_cents',coalesce(sum(amount_cents) FILTER (WHERE entry_type = 'adjustment'), 0),
    'paid_cents',      coalesce(-sum(amount_cents) FILTER (WHERE entry_type = 'payout'), 0),
    'net_cents',       coalesce(sum(amount_cents), 0),
    'net_payable_cents', coalesce(sum(amount_cents) FILTER (WHERE available_at <= now() OR amount_cents < 0), 0)
      - coalesce((SELECT sum(r.amount_cents) FROM public.partner_payout_requests r
                   WHERE r.partner_id = _partner_id AND r.currency = _currency AND r.status IN ('requested','approved')), 0),
    'carry_forward_cents', least(coalesce(sum(amount_cents) FILTER (WHERE available_at <= now() OR amount_cents < 0), 0), 0))
  FROM public.partner_commission_ledger
  WHERE partner_id = _partner_id AND currency = _currency
$$;

-- ---------------------------------------------------------------------
-- J) Privileges: financial ingestion is service_role only
-- ---------------------------------------------------------------------
REVOKE ALL ON FUNCTION public.partner_commission_cents(bigint, integer) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.partner_commission_target(integer, integer, bigint) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.partner_refund_rank(text) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.partner_dispute_rank(text) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.partner_event_supersedes(timestamptz, integer, timestamptz, integer) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.partner_recompute_invoice_commission(text, text, text, timestamptz, text, text, text) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.partner_ingest_invoice_paid(text, text, timestamptz, text, text, text, text, uuid, text, integer, integer, timestamptz) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.partner_ingest_refund_state(text, text, timestamptz, text, text, text, integer, text) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.partner_ingest_dispute_state(text, text, timestamptz, text, text, text, integer, text) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.partner_balance_breakdown(uuid, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.partner_commission_cents(bigint, integer) TO service_role;
GRANT EXECUTE ON FUNCTION public.partner_commission_target(integer, integer, bigint) TO service_role;
GRANT EXECUTE ON FUNCTION public.partner_refund_rank(text) TO service_role;
GRANT EXECUTE ON FUNCTION public.partner_dispute_rank(text) TO service_role;
GRANT EXECUTE ON FUNCTION public.partner_event_supersedes(timestamptz, integer, timestamptz, integer) TO service_role;
GRANT EXECUTE ON FUNCTION public.partner_recompute_invoice_commission(text, text, text, timestamptz, text, text, text) TO service_role;
GRANT EXECUTE ON FUNCTION public.partner_ingest_invoice_paid(text, text, timestamptz, text, text, text, text, uuid, text, integer, integer, timestamptz) TO service_role;
GRANT EXECUTE ON FUNCTION public.partner_ingest_refund_state(text, text, timestamptz, text, text, text, integer, text) TO service_role;
GRANT EXECUTE ON FUNCTION public.partner_ingest_dispute_state(text, text, timestamptz, text, text, text, integer, text) TO service_role;
GRANT EXECUTE ON FUNCTION public.partner_balance_breakdown(uuid, text) TO service_role;
