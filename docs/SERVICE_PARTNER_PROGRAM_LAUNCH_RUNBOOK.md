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

## 3. Production order (exact; each step needs explicit owner approval)

**Why activation cannot happen before publishing:** the currently published frontend predates the independent track gates. It may treat any active terms row as "the general program is open" and may expose retired Affiliate/economics behavior (commission, referral, payout surfaces). Therefore the new service-only frontend must be published while BOTH tracks are still closed, and terms may only be activated afterwards. Activation must never precede the new frontend publication.

1. **Read-only preflight and backup/PITR check** (Section 4). WARNING: the organization is on the Supabase Free plan, so managed PITR or a downloadable backup cannot be confirmed. Record this warning and the owner's explicit acceptance of it; do not change plan or backup settings as part of this release.
2. **Apply the service-track migration while both tracks remain closed** (CP-SVC-SQL). Apply the staged body as migration `service_partner_track_separation`. No terms row is saved or activated in this step.
3. **Verify schema, RLS, RPC permissions, security advisors, and generated types.** New columns present; RLS enabled on all 7 partner tables; `anon` executes only `get_partner_program_status`; PostgREST schema cache reloaded; types regenerated. `get_partner_program_status()` must return both tracks `false`. Security advisors: rerun the advisors and compare against the recorded pre-migration baseline. Advisor lint 0028 (`security_definer` on a function executable by `anon`) is expected to add exactly one new finding for `public.get_partner_program_status()`. Allow only that explicitly reviewed finding; treat every other new Service Partner finding as a STOP condition. Why this one finding is accepted: the function takes no parameters; its body is a single fixed `SELECT`; it returns only the service/affiliate booleans, the active version number, and SHA-256 hashes — no PII and no full agreement text; it sets `search_path TO ''`; `EXECUTE` is granted explicitly to `anon`/`authenticated`/`service_role`; and `anon` cannot call any other Partner RPC.
4. **Publish the new service-only frontend while both tracks remain closed** (CP-SVC-PUBLISH, separate approval). No Edge Function deploy. No Stripe change.
5. **Smoke-test that Service Partner is closed and Affiliate is deferred** (S1–S3 in Section 5).
6. **Save the exact canonical Service Partner Agreement and disclosure** (CP-SVC-TERMS). Admin → Partner Program uses the canonical preset; any modified or incomplete text is rejected at activation (`PARTNER_TERMS_NOT_CANONICAL` / `PARTNER_TERMS_INCOMPLETE`).
7. **Activate Service Partner applications only** by typing `OPEN SERVICE PARTNER APPLICATIONS V<n>`. Affiliate activation fails closed (`AFFILIATE_PROGRAM_DEFERRED`).
8. **Run live application, approval, agreement-acceptance, suspension, and Affiliate-closed tests** (S4–S10 in Section 5).
9. **Retire active terms immediately if any critical test fails** (Admin → Retire active terms). Applications close at once; rows are preserved.

## 4. Preflight (read-only)
```sql
select count(*) from public.partner_program_terms;              -- expect 0
select count(*) from public.partner_applications;               -- expect 0
select count(*) from public.partners;                           -- expect 0
select count(*) from public.partner_agreement_acceptances;      -- expect 0
select count(*) from public.partner_referrals;                  -- expect 0
select count(*) from public.partner_commission_ledger;          -- expect 0
select count(*) from public.partner_payout_requests;            -- expect 0
select column_name from information_schema.columns
 where table_schema='public' and table_name='partner_program_terms'
   and column_name in ('service_partner_applications_open','affiliate_applications_open','commission_duration_invoices'); -- expect 0 rows
select proname from pg_proc where pronamespace='public'::regnamespace
 and proname in ('owner_save_service_partner_terms_draft','get_partner_program_status');  -- expect 0 rows
```
Stop if any count is not zero or a column/function already exists. Backup warning: Free plan, PITR/downloadable backup unconfirmed (see step 1).

## 5. Smoke tests
Closed-state (after step 4, before step 6):
- S1 Anon: `/partner-program` shows "Applications not open yet"; Affiliate card "Not open · planned later"; no 20%/hold/$50.
- S2 `/legal/partner-agreement` shows "Draft — not effective".
- S3 Signed-in user: service application via RPC → `SERVICE_PARTNER_APPLICATIONS_CLOSED`; Affiliate → `AFFILIATE_APPLICATIONS_CLOSED`.

Live (after step 7):
- S4 Anon: `/partner-program` shows applications open; agreement page shows "Effective v<n>".
- S5 Signed-in non-partner: `/partners` shows only the Service Partner form (no Affiliate checkbox, economics, tax, ledger, payouts). Submit succeeds; second submit shows "You already have a pending application."
- S6 Owner approves; partner shows Service Partner badge, no referral code; accept agreement works.
- S7 `select public.request_partner_payout(5000)` as that partner → `PARTNER_NOT_AFFILIATE`.
- S8 Affiliate-only and dual applications via RPC → `AFFILIATE_APPLICATIONS_CLOSED`.
- S9 Owner suspends the test partner (`owner_set_partner_status(<id>,'suspended')`); status reflects suspended.
- S10 Owner unrestricted access and billing/checkout unchanged.
Any critical failure → step 9.

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
Nothing in this runbook has been executed. Stop before step 1 / CP-SVC-SQL.
