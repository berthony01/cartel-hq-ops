# Service Partner Program — Launch Runbook

**STAGED ONLY. NOT EXECUTED. STOP BEFORE PRODUCTION APPLICATION AND PUBLICATION.**

Scope: open the Service Partner track only. The Affiliate Program stays closed. Phase 1B SQL/Edge/Stripe work is NOT part of this release and must not be applied with it.

## 1. Change manifest (base 049aae3b)
| File | Change |
|---|---|
| docs/sql/SERVICE_PARTNER_track_separation.sql | Staged migration body (not applied) |
| src/lib/partners.ts | Track flags, public status read, service-only draft save, closed-track errors |
| src/routes/_authenticated/partners.tsx | Service-only apply/status/rules/workflow; dormant Affiliate UI behind flags |
| src/components/cartel/PartnerAdminSection.tsx | Service-only terms form, per-track status, service-only typed activation |
| src/routes/partner-program.tsx | Service Partner page, database-backed status, Affiliate "Not open" card |
| src/lib/legal-policies.ts | Service Partner Agreement v2; dormant Affiliate draft kept unpublished; Terms/Privacy lines |
| src/routes/legal.partner-agreement.tsx | Metadata renamed |
| src/routes/docs.tsx | Service Partner guide + FAQ |
| src/routes/index.tsx, src/components/cartel/BillingSection.tsx | "Offer services" copy; mobile Partners link |
| scripts/service-partner-track-regression.ts | New: static + executed local-Postgres regression |
| scripts/partner-program-1a / 1b-1 / 1b-4 / public-discovery-seo regressions | Obsolete assertions updated |
| roadmap.md, this runbook | Status |

## 2. Why the migration is a staged file
The Lovable platform applies every file under `supabase/migrations/` automatically, and the Supabase CLI is not installed in the sandbox. To honor "do not apply", the body is staged at `docs/sql/SERVICE_PARTNER_track_separation.sql`. At CP-SVC-SQL, the operator runs `supabase migration new service_partner_track_separation` and pastes the file body.

## 3. Preflight (read-only)
```sql
select count(*) from public.partner_program_terms;              -- expect 0
select count(*) from public.partner_applications;               -- expect 0
select count(*) from public.partners;                           -- expect 0
select count(*) from public.partner_referrals;                  -- expect 0
select count(*) from public.partner_commission_ledger;          -- expect 0
select count(*) from public.partner_payout_requests;            -- expect 0
select column_name from information_schema.columns
 where table_schema='public' and table_name='partner_program_terms'
   and column_name in ('service_partner_applications_open','affiliate_applications_open','commission_duration_invoices'); -- expect 0 rows
select proname from pg_proc where pronamespace='public'::regnamespace
 and proname in ('owner_save_service_partner_terms_draft','get_partner_program_status');  -- expect 0 rows
```
Stop if any count is not zero or a column/function already exists.

## 4. Production order (each step needs explicit owner approval)
1. **CP-SVC-SQL**: backup/PITR point recorded; apply the staged body as migration `service_partner_track_separation`; re-run `bun scripts/service-partner-track-regression.ts` locally; verify columns, grants (`anon` only on `get_partner_program_status`), RLS enabled on all 7 partner tables, PostgREST schema cache reload.
2. Regenerate types; confirm the dashboard reads both flags.
3. No Edge Function deploy. No Stripe change.
4. **CP-SVC-TERMS**: owner saves a service-only draft in Admin → Partner Program (agreement + disclosure text), types `OPEN SERVICE PARTNER APPLICATIONS V<n>`.
5. Smoke tests (Section 5) in preview.
6. **CP-SVC-PUBLISH**: publish only after separate explicit approval.

## 5. Smoke tests
- S1 Anon: `/partner-program` shows "Applications open"; Affiliate card "Not open · planned later"; no 20%/hold/$50.
- S2 Signed-in non-partner: `/partners` shows only the Service Partner form (no Affiliate checkbox, economics, tax, ledger, payouts).
- S3 Submit service application succeeds; second submit shows "You already have a pending application."
- S4 Owner approves; partner shows Service Partner badge, no referral code, rules + workflow, accept agreement works.
- S5 `select public.request_partner_payout(5000)` as that partner → `PARTNER_NOT_AFFILIATE`.
- S6 Affiliate application via RPC → `AFFILIATE_APPLICATIONS_CLOSED`.
- S7 Owner unrestricted access and billing/checkout unchanged.

## 6. Close program / rollback (non-destructive; never auto-executed)
- **Close Service applications**: Admin → Retire active terms (typed confirm). Applications stop immediately (`SERVICE_PARTNER_APPLICATIONS_CLOSED`); partner, application and acceptance rows are kept.
- **Suspend partners**: `owner_set_partner_status(<id>, 'suspended')`.
- **Code rollback**: revert the frontend commit; the database still fails closed.
- **SQL rollback**: prefer forward fixes. The new columns/functions are additive; do not drop columns holding acceptance history. If a function must be reverted, restore the Phase 1A definitions from `docs/sql/PARTNER_1A_foundation.sql` in a reviewed migration only.

## 7. Known risks
- Staged Phase 1B SQL (1B-1/2/3) redefines some of the same functions (`partner_terms_validate`, `owner_save_partner_terms_draft`, `submit_partner_application`, etc.). It must be rebased onto this track-separation contract before any future application, or it would erase the Affiliate deferral guard.
- Legal drafts still need attorney review; all four documents remain "Draft — not effective".
- Existing 8-arg `owner_save_partner_terms_draft` stays callable by the owner but creates rows with both tracks closed, which cannot activate.

## STOP
Nothing in this runbook has been executed. Stop before CP-SVC-SQL.
