# SP-B0 + SP-B1 Partner Project Inbox — Runbook

Status: STAGED ONLY. Nothing here has been applied to production (`ocoinbnjgstkmnwwvnhi`) or published.

## What this enables
A Service Partner with an owner-accepted, active grant that includes `project_inbox`, on an approved Service Partner record while the Service Partner track is active, can in that client project only:
- read Inbox summary counts
- list conversations and open a conversation with its messages (opaque member reference only)
- send a team reply (same idempotent `client_request_id` queue, same guards as the owner reply)
- set status to Open / Needs reply / Waiting on member / Resolved
- acknowledge an uncertain delivery (nothing is resent)

The client project's own commercial plan controls replies through the shared SP-B0 entitlement core.

## Stays owner/operator-only
Inbox settings (reply capture, new member conversations), block/unblock members, Telegram identifiers, groups, broadcasts, missions, stickers, launch controls, billing/subscription, ownership, wallets/treasury, launch execution, platform admin, Service Partner invites and scope edits.

## Staged artifacts
- `docs/sql/SP_B0_commercial_workspace_entitlement_core.sql`: `commercial_evaluate_workspace_feature` (service_role only), re-created `evaluate_commercial_access` (same contract), `partner_evaluate_commercial_access` (service_role only, `project_inbox` only).
- `docs/sql/SP_B1_partner_project_inbox.sql`: seven `partner_inbox_*` RPCs (authenticated + service_role; PUBLIC/anon revoked; `search_path ''`).
- Regressions: `scripts/sp-b0-commercial-core-regression.ts`, `scripts/sp-b1-partner-inbox-regression.ts`.

## Production order (each step needs explicit owner approval)
1. Read-only preflight: confirm the live `evaluate_commercial_access` body still equals migration `20260924021801`, and that the owner inbox RPC bodies are unchanged. Record the md5 of each function definition.
2. **CP-SPB1-PUBLISH**: publish the frontend. Until the SQL exists, the partner Inbox fails closed with an error state. Owners and members are unaffected.
3. **CP-SPB0-SQL**: apply SP-B0. Then read-only checks:
   - evaluator ACL, owner, search_path and signature are unchanged
   - the core and adapter are not executable by anon or authenticated
   - sample evaluator outputs (owner, member, non-member) match the preflight
4. **CP-SPB1-SQL**: apply SP-B1. Then check that the seven RPCs have empty search_path, no PUBLIC/anon execute, and owner inbox md5s unchanged. Expected advisor delta: lint 0029 +7 (partner RPCs); the internal core and adapter should add no authenticated/anon findings.
5. Separate types-only turn: regenerate Supabase types.
6. Two-account smoke test (needs an approved active Service Partner test account):
   1. The owner grants `project_inbox`.
   2. The partner sees only the Inbox under Telegram.
   3. The partner replies once and the member receives it once.
   4. The owner revokes access, and the partner is denied immediately with history intact.

## Rollback
- SP-B1: `REVOKE EXECUTE` on the seven `partner_inbox_*` functions from authenticated. Owner Inbox is untouched.
- SP-B0: re-apply the `evaluate_commercial_access` body from migration `20260924021801`, then revoke/drop `commercial_evaluate_workspace_feature` and `partner_evaluate_commercial_access`.
- Frontend: partners lose Inbox access automatically when the RPCs are gone (fails closed).
