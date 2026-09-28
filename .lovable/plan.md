# Partner Program MVP (Affiliate + Service Partner) — Audit and Plan

Audit only. No edits, migrations, secrets, Stripe, auth or Edge Function changes were made.

## Verified start state
- HEAD `a06b2c1c2e7e7eae161096ece7fbf903837daa05`, working tree clean, 97 migrations (last `20260928110628`).
- `workspace_commercial_assignments` has `channel` (direct|affiliate|reseller|internal), `channel_partner_ref` (free text), `assignment_source` (manual|stripe|reseller|internal), `billing_owner_user_id`.
- `workspace_members.role` is owner|admin|member. `platform_user_roles.role` is owner|admin|support, with `granted_by`.
- `commercial_billing_events` records Stripe event_ref/type/object_ref/workspace_id/subscription_ref/processing_status. It stores no amounts, currency, invoice or charge IDs.
- `commercial_billing_subscriptions` maps workspace to billing owner and Stripe subscription.
- There is no invitation table. Workspace membership comes only from the `handle_new_workspace` trigger.
- Owner console is `/admin`, backed by the `platform-admin` Edge Function. Nav supports `ownerOnly`. Regression convention: `scripts/*-regression.ts` read files from disk and check migration lists.

## Reuse
- Owner authority: `is_platform_owner` / `has_platform_unrestricted_access`. No email checks.
- Workspace ownership check: `is_workspace_owner`, `is_workspace_member`.
- Attribution marker: `workspace_commercial_assignments.channel='affiliate'` plus `channel_partner_ref`. The ref is set only by a server RPC, never by client input.
- Billing truth: `commercial_billing_subscriptions` and `commercial_billing_events`, read-only in Phase 1A.
- UI: AppShell, SidebarNav and nav.ts patterns, `/admin` tab structure, existing design tokens.

## Gaps
- Partner identity, applications and approval.
- Versioned program terms with an inactive-by-default switch.
- Referral codes, click/signup attribution, and self-referral controls.
- Commission ledger, reversals, payout requests, YTD totals, and tax-document status.
- Agreement/disclosure acceptance records.
- Consent-based service-partner access to a client workspace. There is no invite mechanism today.
- Money data on billing events (amount, currency, invoice/charge refs). Needed only for Phase 1B.

## Phase 1A — build now, Stripe webhook untouched

### Schema (one additive migration: `partner_program_1a_foundation`)
Every table: RLS enabled, explicit GRANTs, `updated_at` trigger.
- `partner_program_terms`: version, status (draft|active|retired), nullable fields `commission_bps`, `attribution_window_days`, `hold_days`, `min_payout_cents`, `currency`, and `agreement_text` / `disclosure_text`. Nothing is seeded active. A validation trigger blocks activation while any required field is null. Only one active version is allowed (partial unique index).
- `partners`: user_id (unique), kind flags `is_affiliate` / `is_service_partner`, status (applied|approved|suspended|rejected|terminated), `referral_code` (unique, server-generated), approved_by/at, `tax_doc_status` (not_submitted|submitted|verified|rejected). No tax data is stored, only the status.
- `partner_applications`: user, requested kinds, free-text pitch, status, reviewer, notes.
- `partner_agreement_acceptances`: partner, terms_version, accepted_at, ip_hash optional. Append-only.
- `partner_referrals`: partner, referred_user_id (unique: first valid attribution wins), workspace_id nullable, source (link|code), attributed_at, `terms_version`, status (pending|qualified|rejected_self|rejected_fraud|expired), reason.
- `partner_commission_ledger`: append-only entries. partner, referral, workspace, entry_type (accrual|reversal|adjustment), amount_cents, currency, source_event_ref (unique per entry_type), terms_version, available_at, status (pending|available|in_payout|paid|reversed). Phase 1A writes only owner manual adjustments.
- `partner_payout_requests`: partner, amount_cents, currency, status (requested|approved|rejected|paid|cancelled), reviewed_by, paid_reference (free text, manual), timestamps. Links to ledger entries through `partner_payout_items`.
- `workspace_partner_access`: workspace, partner, status (invited|active|revoked), invited_by (the workspace owner), accepted_at, revoked_at.

### RLS / privilege matrix
- Partner: reads only own `partners`, applications, referrals, ledger, payouts, acceptances. No direct writes. All writes go through RPCs.
- Workspace owner: reads and revokes `workspace_partner_access` for own workspaces.
- Platform owner/admin: everything through SECURITY DEFINER RPCs or the `platform-admin` Edge Function, gated by `is_platform_owner` / platform role.
- anon: no access. Commission tables get no direct `authenticated` INSERT/UPDATE.

### RPCs (SECURITY DEFINER, `search_path=''`, revoke PUBLIC/anon)
- `submit_partner_application(kinds, pitch)`. Requires an active terms version.
- `accept_partner_agreement(terms_version)`.
- `record_referral_attribution(code)`: called after signup. Rejects self-referral (same user, or partner is a member or billing owner of the target workspace). Idempotent. Honors the attribution window from active terms.
- `bind_referral_to_workspace(workspace_id)`: caller must be the workspace owner. Sets `channel='affiliate'` and `channel_partner_ref` only while the assignment is Free/direct, so it never overwrites a Stripe or manual assignment.
- `request_partner_payout(amount)`: amount must be ≤ available balance, at least the terms minimum, and `tax_doc_status='verified'`.
- `get_my_partner_summary()`: balances by status and YTD accrued/reversed/paid.
- Owner-only: `review_partner_application`, `set_partner_status`, `set_partner_tax_status`, `activate_partner_terms`, `review_payout_request`, `mark_payout_paid`, `add_commission_adjustment`.
- Service partner: `invite_service_partner(workspace_id, partner_id)` (workspace owner only), `accept_workspace_partner_invite`, `revoke_workspace_partner_access`. On accept, the partner is inserted into `workspace_members` as role `admin`. It is never `owner` and never billing owner. On revoke, that row is removed. Existing tool, commercial and billing checks then apply unchanged. Service partners cannot start checkout, because `billing-checkout` already requires the owner.

### UI
- `src/routes/_authenticated/partners.tsx`: apply, agreement/disclosure, referral link, referrals, ledger, payouts, YTD, tax-status banner. Shows "Program not yet open" while no terms are active.
- `src/routes/auth.tsx`: capture the `?ref=` code in sessionStorage (sanitized) and call `record_referral_attribution` after the session is confirmed.
- `src/routes/_authenticated/settings.tsx`: "Service partner access" card (invite, list, revoke) for workspace owners.
- `src/routes/_authenticated/admin.tsx`: new "Partners" tab (applications, partners, terms editor/activation, payouts, adjustments). Server enforcement in `platform-admin` actions or owner RPCs.
- `src/lib/partners.ts`: typed RPC client. `src/lib/nav.ts`: add a "Partners" entry.
- Owner bypass is unchanged. The owner can see all partner data, but partner status never gates owner features.

### Tests: `scripts/partner-program-1a-regression.ts`
- Migration exists, is additive only, and has GRANTs and RLS for every table.
- No DROP, and no change to plans, entitlements, `stripe-billing-webhook`, `billing-checkout` or the Stripe helper (hash parity).
- Terms cannot activate with null fields, and nothing is seeded active.
- Self-referral is rejected. Attribution is idempotent. Binding never overwrites a non-direct assignment.
- The payout RPC enforces balance, minimum and tax status.
- Service-partner access is `admin` only, requires an owner invite, and revoke removes membership.
- The owner bypass path remains first in `evaluate_commercial_access`.
- Live RLS checks as two distinct non-owner test users: partner A cannot read partner B's rows, and a partner cannot read a workspace without accepted access.
- Plus the existing commercial suites, tsgo, build, `diff --check`. Update the migration manifests in the existing suites.

**Stop point 1A:** migration staged in `docs/sql` for review, applied only on explicit approval, then post-apply sync. No publish.

## Phase 1B — later, webhook integration
How revenue will feed the ledger:
1. Additive migration: nullable `amount_cents`, `currency`, `invoice_ref`, `charge_ref` on `commercial_billing_events`.
2. Minimal webhook change: on `invoice.paid`, `charge.refunded` and `charge.dispute.created/closed`, store those fields. Then call a new service-role-only RPC `accrue_partner_commission_from_event(event_id)` after the existing state processing succeeds. A commission failure must never fail billing; it is logged and retried by a sweep.
3. Accrual only when all hold: workspace has a qualified referral within the window, the invoice is paid, livemode matches the active environment, and the partner is approved. Amount = collected amount × `commission_bps` of the terms version stored on the referral. `available_at` = paid_at + `hold_days`. Idempotent on `source_event_ref`.
4. A refund or chargeback creates a negative reversal linked to the original accrual. If the accrual was already paid, the balance goes negative and future payouts net against it.
5. Alternative with no webhook change: an owner-triggered, service-role reconcile that GETs paid invoices from Stripe. This costs more API calls and is not recommended.

**Stop point 1B:** separate approval covering the webhook diff, deploy, and a test-mode invoice/refund QA.

## Risks
- Adding `admin` membership gives service partners full workspace-admin tools. Review whether a narrower role is needed. That would be a schema change to the `workspace_members` CHECK and was not proposed.
- Attribution depends on signup-time capture. Cross-device clicks are lost; accepted for the MVP.
- Tax status is attestation only. No documents are stored, which avoids handling PII.
- Several revenue events currently lack amounts, so no commission can be computed until 1B.
- `channel_partner_ref` is free text. It will hold the partner UUID as text, and a code comment will document that.

## Files (proposed)
- New: `docs/sql/PARTNER_1A_foundation.sql` (and later its synced migration), `src/lib/partners.ts`, `src/routes/_authenticated/partners.tsx`, `scripts/partner-program-1a-regression.ts`.
- Edited: `src/routes/auth.tsx`, `src/routes/_authenticated/settings.tsx`, `src/routes/_authenticated/admin.tsx`, `src/lib/nav.ts`, `backend-source/edge-functions/platform-admin/index.ts` (owner actions, optional), existing regression migration manifests.
- Untouched: all Stripe/billing Edge Functions, plans/entitlements, Telegram, PCART, launcher, chain, treasury, liquidity.

## Open decisions
- Service partner role: `admin` (no schema change) or a new narrower role.
- Whether payouts or terms also need `platform_user_roles.admin`, or the owner only.
