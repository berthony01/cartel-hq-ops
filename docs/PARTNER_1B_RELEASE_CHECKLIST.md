# CARTEL HQ Partner Program Phase 1B — Release Checklist

> **STAGED, NOT APPROVED FOR PRODUCTION. NOTHING IN THIS DOCUMENT HAS BEEN EXECUTED.**
>
> No SQL has been applied, no Edge Function deployed, no Stripe setting or webhook
> subscription changed, no terms seeded or activated, and no Phase 1B commit published.
> Every live step below needs its own explicit owner approval at the checkpoint named.

- Accepted pre-1B baseline: `0286783ad58e3bae372d76214ce51d45c992e2f4` (Phase 1A + pitch-limit correction)
- Stage 1B-4 accepted: `708d0b526abc1a9528bfac4a9fb7aa236e643469`
- Stage 1B-5 (this document): repository-only; resulting commit recorded in the final report
- System of record: external Supabase `ocoinbnjgstkmnwwvnhi`; Stripe (shared account, filtered by `app=cartel_hq`)
- Published deployment: older, pre-Phase-1B. Evidence: `https://pepecartelhq.com/legal/terms` returns 404 (route added in 1B-1).

## 1. Inventory of staged components

| Area | Files | State |
|---|---|---|
| 1B-1 Legal drafts + policy acceptance | `src/lib/legal-policies.ts`, `src/lib/policy-acceptance.ts`, `src/components/cartel/{LegalDocumentPage,LegalFooter,PolicyAcceptancePrompt,PolicyAdminSection,PolicyConsent}.tsx`, `src/routes/legal.{terms,privacy,refunds,partner-agreement}.tsx`, `src/routes/index.tsx`, `src/routes/auth.tsx`, `src/components/cartel/AppShell.tsx`, `src/routes/_authenticated/admin.tsx`, `src/components/cartel/BillingSection.tsx`, `backend-source/edge-functions/billing-checkout/index.ts` (consent flag, default OFF), `docs/sql/PARTNER_1B_1_policy_acceptance.sql` | Repo only; drafts show `DRAFT — NOT EFFECTIVE`; SQL unapplied |
| 1B-2 Referral click tokens | `docs/sql/PARTNER_1B_2_referral_click_tokens.sql`, `backend-source/edge-functions/partner-referral-capture/{index.ts,logic.ts,deno.json}`, `src/lib/partners.ts`, `src/routes/auth.tsx`, `src/components/cartel/ReferralAttributionBridge.tsx` | SQL unapplied; capture function undeployed |
| 1B-3 Commission accounting | `docs/sql/PARTNER_1B_3_commission_accounting.sql` | Unapplied |
| 1B-4 Webhook integration | `backend-source/edge-functions/stripe-billing-webhook/{index.ts,commission.ts}` | Undeployed; refund/dispute events not subscribed |
| 1B-4 Partner/owner UI | `src/routes/_authenticated/partners.tsx`, `src/components/cartel/PartnerAdminSection.tsx`, `src/lib/partners.ts` | Unpublished; fails closed while contracts unapplied |
| G12a reconciliation utility | `scripts/partner-program-1b-reconcile.ts`, `scripts/partner-program-1b-reconcile-core.ts` | Repo only; dry-run default; no non-production validation |
| Tests | `scripts/partner-program-1b-{1,2,3,4}-regression.ts`, `scripts/partner-program-1b-reconcile-regression.ts`, `scripts/partner-program-1b-release-regression.ts`, updated `scripts/partner-program-1a-regression.ts` | Repo; G12a regression uses pure mocks and zero external calls |
| Docs | this file, `docs/PARTNER_1B_ACTIVATION_ROLLBACK_RUNBOOK.md`, `roadmap.md` | Repo |

Required Edge modes (from repo headers): `partner-referral-capture` **verify_jwt=false** (pre-signup capture; CORS-restricted, uniform response, hash-only storage); `stripe-billing-webhook` **verify_jwt=false** (Stripe signature is the authentication). `billing-checkout` / `billing-portal` remain verify_jwt=true.

## 2. Gate status

| # | Gate | Status | Owner |
|---|---|---|---|
| G1 | Legal operator name | PASS — Berthony Petit Frere | Owner |
| G2 | Mailing address | DEFERRED — not included in website policies; promotional email campaigns remain blocked until a valid physical postal address exists | Owner |
| G3 | Jurisdiction / entity posture | PASS — individual Texas sole proprietor; not an LLC, corporation or registered DBA | Owner |
| G4 | Support / legal email | PENDING DNS VERIFICATION — `support@pepecartelhq.com` and `legal@pepecartelhq.com` selected; inbound MX not verified | Owner/Operator |
| G5 | Limited U.S. beta confirmation | PASS | Owner |
| G6 | Attorney review: Terms, Privacy, Refund Policy, Partner Agreement, disclaimers | NOT OBTAINED | Counsel |
| G7 | CPA review: Texas sales-tax treatment and Stripe Tax decision | PENDING | CPA + Owner |
| G8 | Privacy / subprocessor / data-transfer review | NOT OBTAINED | Counsel |
| G9 | Backups + production version/config record (no secrets) | NOT DONE | Owner/Operator |
| G10 | SQL validated in non-production Supabase (1B-1, 1B-2, 1B-3) | NOT DONE | Operator |
| G11 | Production SQL apply (explicit approval) | NOT DONE | Owner |
| G12 | Post-apply RLS/grants/append-only/RPC/schema-cache/zero-row checks | NOT DONE | Operator |
| G12a-A | Rollback-gap reconciliation utility built and tested with mocks | PASS | Engineering |
| G12a-B | Rollback-gap reconciliation utility validated against non-production Supabase + Stripe test environment (required before Edge/Stripe activation) | NOT DONE | Engineering/Operator |
| G13 | Edge deploy: referral capture + billing webhook (explicit approval) | NOT DONE | Owner |
| G14 | Stripe refund/dispute event subscription — test, then live (explicit approval) | NOT DONE | Owner |
| G15 | Draft terms seeded, previewed, activated via typed confirmation (explicit approval) | NOT DONE | Owner |
| G16 | Test-mode smoke matrix + reconciliation | NOT DONE | Operator |
| G17 | Publication (separate explicit approval) | NOT DONE | Owner |
| G18 | Post-launch monitoring + reconciliation | NOT DONE | Operator |
| G19 | Repository regressions (Phase 1B suites) | PASS | Engineering |
| G20 | Unrelated pre-existing failures (Section 6) | NOT DONE (not waived) | Owner |

Legal note: broad "no refund" and "use at your own risk" wording does **not** remove non-waivable consumer-protection, privacy, card-network/payment-processor, or statutory obligations. It must be approved by counsel before any policy version becomes effective.

## 3. Activation order (non-production first)

1. Confirm the completed identity and U.S.-beta policy text, verify inbound email DNS, obtain counsel and CPA signoff, and complete privacy/subprocessor review (G1–G8). Promotional email campaigns remain blocked until a valid physical postal address is available (G2).
2. Create/verify backups; record current production Edge versions, webhook endpoint event list, cron jobs and relevant config — **no secret values** (G9).
3. Validate SQL in a non-production Supabase project; then production only after explicit approval, strictly in order 1B-1, 1B-2, 1B-3 (G10, G11). Never reapply `20260927170206`, `20260927171231`, `20260927173127`, `20260928110628`.
4. Verify RLS/grants, append-only ledger triggers, exact RPC signatures, `NOTIFY pgrst, 'reload schema'`, and zero unexpected rows in new tables (G12).
4a. The local service-role rollback-gap reconciliation utility is built and mock-tested (G12a-A). Validate its dry-run and controlled execution against non-production Supabase + Stripe test data (G12a-B). Normal Stripe resend cannot backfill commission for events already processed/ignored in `commercial_billing_events`. G12a-B must pass before steps 5 and 6.
5. Deploy `partner-referral-capture` (verify_jwt=false) and `stripe-billing-webhook` (verify_jwt=false) only after steps 4 and 4a pass. Webhook deploy **before** SQL would make every Cartel `invoice.paid` retry with 500 (entitlement still applied idempotently) — do not do it (G13).
6. Add exactly `refund.created`, `refund.updated`, `refund.failed`, `charge.dispute.created`, `charge.dispute.updated`, `charge.dispute.closed` to the **existing** endpoint — test mode first, then live. Do not remove existing events. No secret rotation (G14).
7. Seed a draft terms version with approved text and economics (20%, 12 invoices, 30-day attribution, 45-day hold, $50 min, USD, manual monthly); preview; activate only via typed owner confirmation (G15).
8. Execute the test-mode smoke matrix (Section 4) and reconcile (G16).
9. Preview, then publish only after separate explicit owner approval (G17).
10. Monitor and reconcile initial production events per runbook (G18).

## 4. Test-mode smoke matrix

| ID | Case | Expected |
|---|---|---|
| S1 | invoice.paid normal (affiliate referral, $49) | one accrual 980 cents, held 45 days |
| S2 | invoice.paid duplicate event | no second ledger row |
| S3 | invoice.paid out-of-order vs subscription events | entitlement correct; single accrual |
| S4 | No referral | processed no-op |
| S5 | Direct signup | processed no-op |
| S6 | Self-referral | rejected at claim; no accrual |
| S7 | Service-only partner | no commission |
| S8 | Approved affiliate | accrual |
| S9 | Invoices 1–12 then 13th | 12 accruals; 13th capped no-op |
| S10 | Discount / credit | base after discount/credit |
| S11 | Tax (exclusive and inclusive) | tax excluded |
| S12 | Proration line | excluded |
| S13 | One-time / setup line | excluded |
| S14 | Non-Cartel line on invoice | excluded |
| S15 | Partial refund | proportional reversal |
| S16 | Full refund | full reversal, never beyond original |
| S17 | Refund failed / canceled | immutable restoration delta |
| S18 | Dispute opened | proportional reversal |
| S19 | Dispute lost | stays reversed |
| S20 | Dispute won | restored |
| S21 | Refund + dispute overlap | total reversal capped at original |
| S22 | Shared-account unrelated event | acknowledged; zero Cartel mutation |
| S23 | test/live mismatch | rejected before processing |
| S24 | Missing contract | 500, event `failed`, retried; never `processed` |
| S25 | Owner account | unrestricted access unchanged |
| S26 | Payout gates (approval, tax verified, agreement, $50, available) | enforced |
| S27 | Typed confirmations (activate terms, mark paid) | required |
| S28 | Logs / DB rows | no PII, raw payload, token, code, IP or secrets |
| S29 | Reversal after payout | negative carry-forward, paid rows unchanged |

## 5. Explicit approval checkpoints (one per live mutation class)

- [ ] CP-SQL: Supabase SQL apply (non-production, then production separately)
- [ ] CP-EDGE: Edge Function deploy (each function named) — requires G12a-B PASS
- [ ] CP-STRIPE: Stripe webhook event subscription (test, then live separately) — requires G12a-B PASS
- [ ] CP-TERMS: Terms seed and, separately, activation
- [ ] CP-PUBLISH: Publication

## 6. Current unresolved failures (NOT passes, NOT waived)

| Suite | Result | Failure | Origin |
|---|---|---|---|
| commercial-billing | 112/1 | B-13.5 telegram-webhook mirrors byte-identical | Pre-existing, unrelated to Phase 1B |
| project-identity-gate-b | 94/1 | 2.2 telegram-webhook deployable byte-identical | Pre-existing, same root cause |
| commercial-guards | 66/4 | 1.1 migration count (92 vs 100); 1.2 authorized post-gate list; 4.2 telegram parity; 10.1 PCART/chain file changes since commercial gate | Pre-existing; Phase 1B added no migrations, no Telegram and no PCART/chain/wallet files |

Also unverified: signed-in partner/admin UI (external Supabase auth not automatable), live webhook behaviour, live SQL constraint behaviour, mobile layouts across devices, cross-device email confirmation losing the local referral token (documented limitation).
