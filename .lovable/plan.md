# CARTEL HQ Partner Program Phase 1B — Staging Plan (repo only)

## Scope and hard boundaries
Repository and preview build only. No publish, no Supabase apply or write, no Edge deploy, no Stripe calls, no changes to secrets, webhooks, prices, products, subscriptions or the customer portal. No PCART, launcher, liquidity or Telegram changes. The owner bypass stays in place. No active terms seed. Legal operator fields stay as placeholders.

This request touches legal, schema/RLS, financial ingestion, the webhook and UI, so it is HIGH RISK. It is split into five atomic stages. Each stage ends with its own verification and a checkpoint, so every diff can be reviewed on its own. I run the stages in order and stop at each checkpoint for acceptance.

## Stage 1B-1: Legal pages and policy acceptance foundation
- New public pages `/legal/terms`, `/legal/privacy`, `/legal/refunds` and `/legal/partner-agreement`, in the noir/gold system, each with its own head().
- A "DRAFT — NOT EFFECTIVE" banner shows whenever no active policy version exists.
- Visible placeholders: [LEGAL OPERATOR NAME], [MAILING ADDRESS], [LEGAL CONTACT EMAIL], [STATE OF FORMATION], [GOVERNING LAW]. "Cartel HQ" is never used as a legal entity.
- Content follows the brief: refund rules, crypto and third-party risk, privacy categories without an unverified "no sale" claim, and the full partner agreement (20% for 12 invoices, 30-day window, 45-day hold, $50 minimum, W-9 handled externally, negative carry-forward).
- Footer links on the homepage, auth pages and app shell.
- Staged migration file (not applied): `policy_documents` (type, version, sha256 content hash, status draft/active/retired, placeholder_free flag) and `policy_acceptances` (user, document type, version, hash, accepted_at, source; no IP). Includes RLS, grants, and owner-only `owner_activate_policy_version(_type,_version,_confirm)`. That function refuses activation if the content contains `[` placeholders or the confirmation string does not match.
- Signup and pre-checkout consent checkboxes block the action until checked. Existing users are prompted only when the effective version differs from the version they accepted. The UI fails closed: no active policy means the draft notice shows and acceptance is recorded as draft-free.
- Stripe Checkout terms consent sits behind a server flag `CARTEL_HQ_STRIPE_TERMS_CONSENT_ENABLED` in the staged billing-checkout source. It defaults to off. No secret is set.

## Stage 1B-2: Referral click token integrity
- Staged migration: `partner_referral_clicks` (sha256 hash of the token only, partner_id, terms_version, created_at/expires_at from server time, claimed_by/claimed_at). No IP, fingerprint or PII. RLS is on with no client policies. Includes indexes on expires_at and on unclaimed rows.
- New RPC `claim_referral_click(_token)` uses auth.uid(), server time and an atomic `UPDATE … WHERE claimed_at IS NULL AND expires_at > now()`. First valid claim wins, and self-referral is rejected.
- EXECUTE on legacy `record_referral_attribution` is revoked from PUBLIC, anon and authenticated.
- `bind_referral_to_workspace` semantics are preserved.
- Edge source `backend-source/edge-functions/partner-referral-capture/` (verify_jwt=false) has narrow CORS, strict validation of the 10-character code, generic responses, a per-code bucket rate-limit design, and never logs tokens. It is not deployed.
- The browser stores only `{token, expiresAt}`. Client timestamps are ignored.

## Stage 1B-3: Commission accounting (database)
- Staged migration adds these ledger columns: stripe_environment, source_kind (invoice/refund/dispute/manual), invoice_ref, charge_ref, refund_ref, dispute_ref, source_event_ref, entry_kind (accrual/reversal/restoration/adjustment), and amounts in integer cents plus currency. Unique idempotency keys cover (environment, source_kind, source ref, entry_kind).
- The table stays append-only through the existing immutability triggers.
- New SECURITY DEFINER functions, all service_role only with pinned search_path and PUBLIC/anon/authenticated revoked:
  - `partner_accrue_invoice_commission`: base is the mapped subscription-line amount after discounts, excluding tax, credits and non-subscription lines. Accrues 20% using the snapshotted terms, capped at 12 paid invoices per referred workspace.
  - `partner_apply_refund_state`: creates a proportional reversal when a refund is pending or succeeded, and a restoration when a refund fails or is canceled.
  - `partner_apply_dispute_state`: reverses on created, restores only when won.
- Overlap guard: total reversals per invoice are capped at the original accrual, so a refund and a dispute on the same dollars cannot reverse twice.
- A negative balance carries forward and nothing is deleted.

## Stage 1B-4: Webhook source and UI
- `stripe-billing-webhook` source adds invoice.paid (commission), refund.created/updated/failed and charge.dispute.created/closed.
- Unchanged: signature verification, live/test separation, the shared-account filter, entitlement apply and event idempotency.
- Commission runs after the entitlement apply, and a commission failure never fails billing.
- checkout.session.completed never creates commission.
- Not deployed; the URL and secret are unchanged.
- `/partners` shows draft economics, the active terms version, token status, and held/available/paid/reversed balances with transparent ledger entry kinds. Service-only partners see "No Cartel commission".
- Owner console requires typed confirmation for terms activation, policy activation and mark-paid.

## Stage 1B-5: Tests and release checklist
- `scripts/partner-program-1b-regression.ts` is a deterministic pure-logic simulator that mirrors the SQL math. It also runs static SQL and security checks.
- It covers duplicate and out-of-order events, partial and multiple refunds, failed refunds, disputes won and lost, refund-plus-dispute overlap, negative balance after payout, direct/service-only/no attribution, self-referral, stale or claimed tokens, environment/price/metadata mismatch, the 12-invoice cap, the placeholder activation block, acceptance versioning, and the owner bypass.
- The existing four regressions' manifests are unchanged, because the new migrations live only as staged docs SQL until applied.
- `docs/PARTNER_1B_RELEASE_CHECKLIST.md` marks each of these BLOCKED/NOT DONE: legal review, legal operator fields, geography, Texas sales tax/Stripe Tax, Stripe Terms URL, webhook event subscription update, DB migrations, Edge deploys, active terms seed, smoke tests and publish approval.

## Technical details
- Staged SQL goes to `docs/sql/PARTNER_1B_*.sql`, not `supabase/migrations/`, to avoid accidental apply, matching the C1/C2/C3A pattern.
- UI that depends on the new tables uses untyped RPC wrappers with fail-closed handling until the types regenerate after an approved apply.
- Verification for each stage: git diff --check, tsgo, build, the new 1B regression, the partner 1A regression, and the three commercial regressions.

## Stop point
Stop after each stage checkpoint. Nothing is published or applied live.
