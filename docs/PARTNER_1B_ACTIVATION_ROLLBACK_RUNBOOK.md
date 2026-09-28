# CARTEL HQ Partner Program Phase 1B — Activation & Rollback Runbook

> **STAGED ONLY. NOT EXECUTED.** Every command and query below uses placeholders
> (`<PROJECT_REF>`, `<ENDPOINT_ID>`, `<EVENT_ID>` …). Never paste secrets into this
> document, tickets or chat. Each live step requires the approval checkpoint named in
> `docs/PARTNER_1B_RELEASE_CHECKLIST.md` Section 5.

## 1. Preflight

- Confirm authoritative repo commit and that it contains the accepted Phase 1B files.
- Confirm Supabase target is `ocoinbnjgstkmnwwvnhi` (production) or the named non-production project.
- Record, without secret values: deployed Edge versions of `stripe-billing-webhook`; existence of `partner-referral-capture`; Stripe endpoint `<ENDPOINT_ID>` enabled event list; cron jobs; `commercial_billing_events` recent status counts.
- Record known-good webhook source: pre-1B-4 revision = file at commit `4dee009a6efdf8d2e47b69535238aa08bbe4d948` (identical to `0286783a`), SHA-256 `a0121c8a0712f3616b65201b22b3117d01d87e1521829780d7e1063b5c1d04a1`.
- Backups: verify a restorable point-in-time/backup exists and note its timestamp.
- Confirm legal gates G1–G8 are PASS.

## 2. Deployment order and verification

1. **SQL (CP-SQL)** — apply in order `docs/sql/PARTNER_1B_1_policy_acceptance.sql`, `PARTNER_1B_2_referral_click_tokens.sql`, `PARTNER_1B_3_commission_accounting.sql` (non-production first). Then `NOTIFY pgrst, 'reload schema';`.
   Verify (read-only):
   ```sql
   -- RLS enabled on new tables
   select relname, relrowsecurity from pg_class
   where relname in ('policy_documents','policy_acceptances','partner_referral_clicks',
     'partner_commission_events','partner_invoice_commissions','partner_refund_states','partner_dispute_states');
   -- Ingestion RPCs service_role only
   select p.proname, has_function_privilege('anon', p.oid,'execute') anon,
          has_function_privilege('authenticated', p.oid,'execute') authed,
          has_function_privilege('service_role', p.oid,'execute') svc, p.prosecdef, p.proconfig
   from pg_proc p join pg_namespace n on n.oid=p.pronamespace
   where n.nspname='public' and p.proname like 'partner_ingest_%';
   -- Legacy code-claim revoked
   select has_function_privilege('authenticated','public.record_referral_attribution(text,text)','execute');
   -- Zero unexpected rows
   select (select count(*) from partner_referral_clicks) clicks,
          (select count(*) from partner_commission_events) events,
          (select count(*) from partner_invoice_commissions) invoices;
   ```
   Also confirm UPDATE/DELETE on `partner_commission_ledger` is rejected by the append-only guard (in non-production only).
2. **Edge (CP-EDGE)** — deploy `partner-referral-capture` (verify_jwt=false) and `stripe-billing-webhook` (verify_jwt=false). Verify: unsigned POST to webhook returns 400; OPTIONS from a non-allowed origin to capture is refused.
3. **Stripe (CP-STRIPE)** — on existing endpoint `<ENDPOINT_ID>` add only `refund.created`, `refund.updated`, `refund.failed`, `charge.dispute.created`, `charge.dispute.updated`, `charge.dispute.closed`; test mode first. No secret rotation, no URL change.
4. **Terms (CP-TERMS)** — owner saves draft; review; activate with typed confirmation.
5. **Smoke** — run checklist Section 4 in test mode.
6. **Publish (CP-PUBLISH)** — separate approval.

## 3. Launch-day monitoring (read-only; do not run until approved)

```sql
-- Webhook outcome distribution, last 24h
select event_type, processing_status, last_error, count(*)
from commercial_billing_events where created_at > now() - interval '24 hours'
group by 1,2,3 order by 4 desc;
-- Duplicate accrual detector (must return 0 rows)
select stripe_environment, stripe_invoice_ref, count(*) from partner_commission_ledger
where source_object = 'invoice' group by 1,2 having count(*) > 1;
-- Over-reversal detector (must return 0 rows)
select environment, invoice_ref, commission_cents, applied_commission_cents
from partner_invoice_commissions
where applied_commission_cents < 0 or applied_commission_cents > commission_cents;
-- Negative balances for review
select * from partner_balance_breakdown(<PARTNER_ID>);
```
Column names match the staged 1B-3 SQL; re-confirm against the applied schema before use.

## 4. STOP conditions (halt rollout, escalate, do not proceed)

- Any signature failure spike, livemode/environment mismatch, or shared-account (non-`cartel_hq`) object reaching a commission RPC.
- Duplicate accrual for one `(environment, invoice_ref)`.
- Aggregate reversal beyond an invoice's original commission.
- Unexplained negative balance (not traceable to a post-payout refund/dispute).
- Commission RPC / schema-cache errors (PGRST202 / 42883) persisting after schema reload.
- Any mutation of unrelated Stripe objects, prices, products, subscriptions or portal settings.
- Any entitlement regression (Pro not granted/revoked correctly, owner restricted, $49 changed).

## 5. Rollback (non-destructive)

- **Never delete or rewrite ledger, state, event or evidence rows.** Corrections are new immutable entries.
- **Webhook**: if needed, redeploy the pre-1B-4 source (SHA above). This preserves existing billing/entitlement handling. **Reverting causes missed commission events** (accruals, refunds, disputes received while reverted). This requires a written financial reconciliation/backfill plan — not silent abandonment.
- **Stripe events**: disable only the six newly added refund/dispute events if required. Never remove existing billing events.
- **Referral capture**: may be undeployed; stored tokens simply expire.
- **Terms**: retire an active version only after legal/business review; accrued rows keep their snapshotted terms.
- **SQL**: rollback is limited (constraints, triggers and grants interact with live rows). Prefer forward-fix migrations. Do not drop tables holding financial data.

## 6. Reconciliation before resuming

1. List Stripe events for the gap window by type (`invoice.paid`, refund, dispute) and environment.
2. Match each by `event_ref`, `invoice_ref`, `refund_ref`, `dispute_ref` against `commercial_billing_events` and partner state tables.
3. Replay missing events through the normal signed webhook path (Stripe resend) — never by hand-inserting ledger rows. Idempotency makes duplicates safe.
4. Re-run Section 3 detectors; resume only when all return clean and the owner approves.
