# SP-B3 V1 — Service Partner Community Broadcasts Runbook

Status: STAGED IN REPOSITORY ONLY. No SQL applied, no Edge deploy, no publish.

## Scope
Activates only the stored partner scope `broadcasts`. A Service Partner with an active, accepted client grant that includes `broadcasts` can:
- list the client's connected Telegram communities (opaque connection id, title, chat type, bot-admin/operational state only);
- post ONE plain-text message (1..3500 characters, owner-equal) to ONE selected community after preview/confirm;
- see recent community broadcast history (`announcement_kind = 'OPERATOR_TEXT'`) with status, text, time and actor kind (you / project team / Service Partner).

Never exposed: telegram chat ids, usernames, member counts, raw metadata, requester UUIDs, Telegram message ids, bot tokens.

## Owner-only / deferred
Branded photo broadcasts, Launch Watch CTA button, official contract and correction broadcasts, group connect/disconnect/re-verify, bot admin, welcome settings, sticker assign/distribute/drops, group test, templates, watcher DMs (SP-B2 owns watcher comms), launch/contract/deploy/treasury/wallet, billing, Affiliate.

## Architecture
- SQL `docs/sql/SP_B3_partner_group_broadcasts.sql`:
  - `project_identity_ready(uuid)` — service_role-only core holding the exact minimum Project Identity predicate. `can_use_project_tools` now calls it; signature, owner, SECURITY DEFINER, `search_path 'public'`, ACL and output unchanged (equivalence proven over 120 caller/workspace/user cases).
  - `partner_list_broadcast_groups`, `partner_list_group_broadcasts`, `partner_authorize_group_broadcast` — authenticated, SECURITY DEFINER, empty search_path, `partner_has_scope(_workspace_id,'broadcasts')` first.
  - Authorize order: scope → group belongs to workspace → client Project Identity (core) → client `official_broadcasts` via SP-B0 `commercial_evaluate_workspace_feature`. No platform-owner/unrestricted bypass for the partner. Returns only `{allowed, code}`.
- Edge `telegram-group` (staged source only): for a NON-member calling `send_group_announcement` only, the function calls `partner_authorize_group_broadcast` with the partner's own JWT, forces plain text (branding/CTA off), then falls through into the one existing send implementation (idempotency ledger, verifyGroup, single Telegram call, SENT/FAILED/AMBIGUOUS). `requested_by` = partner user id. Every other action and every member path is unchanged. Five baseline lines changed; no second send engine.
- HTTP mapping: scope/RPC error 403 FORBIDDEN; GROUP_NOT_FOUND 404; PROJECT_IDENTITY_REQUIRED 403; FEATURE_NOT_INCLUDED 403; PLAN_LIMIT_REACHED 429; PLAN_ACCESS_INACTIVE 403; unavailable 503 (shared `commercialDenialFor`).
- Rate limit: none, matching the owner community path. Idempotency: existing `(workspace_id, client_request_id)` semantics, unchanged.
- Accepted side effect: verifyGroup refreshes group verification metadata; if the bot was removed, enabled Sticker Drops for that group are paused — exactly as for an owner send.

## Start gate evidence
Production `telegram-group` ACTIVE v48, verify_jwt=true, deployed source reported identical to repository baseline at plan commit `ed945d96` (repository file md5 `68e8d0892b3c235307914bdb47ed9353`, 110,005 bytes locally — reconfirm byte count/md5 against the deployed bundle before CP-SPB3-EDGE).

## Activation order
1. CP-SPB3-SQL — apply the staged SQL. Verify: 4 new functions + replaced `can_use_project_tools` (ACL unchanged); rolled-back transactional smoke (scope denial, cross-workspace, safe outputs, commercial mapping, identity, revoke). Expected advisor: 0028 unchanged (9); 0029 +3 (123 → 126). The service_role-only core adds no 0029 finding.
2. CP-SPB3-EDGE — deploy `telegram-group` from the staged source. First re-run an owner send regression (owner result shape unchanged), then partner non-send actions must return 403.
3. CP-SPB3-PUBLISH — publish frontend (fails closed until 1 and 2 are live).
4. Types sync.
5. Real two-account browser smoke with a committed test-group post — PENDING an approved active Service Partner account.

## Rollback
Redeploy prior `telegram-group` (baseline md5 above). Drop the three partner functions. Restore `can_use_project_tools` with the inline EXISTS predicate (captured in `scripts/sp-b3-partner-group-broadcasts-regression.ts` as `CUPT_ORIGINAL`), then drop `project_identity_ready(uuid)`. Remove `broadcasts` from `ACTIVE_PARTNER_SCOPES`.
