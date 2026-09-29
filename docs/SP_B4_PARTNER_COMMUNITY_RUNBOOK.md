# SP-B4 V1 — Service Partner Community Management Runbook

Status: STAGED (repository only). Not applied, not deployed, not published.
Baseline: app `76c5df41`, audit plan `688b085b`. Deployed `telegram-group` v49 == repo baseline (md5 `3ea60946a4125e6d78623c49e82f53ad`).

## Scope
Activates only the stored partner scope `community_management`. A Service Partner with an accepted active client grant may:
- list the client's already-connected Telegram groups (safe fields only: connection UUID, title, chat type, bot admin, stored operational flag, verified_at);
- read welcome settings for one group, plus a read-only Launch Watch card summary (enabled, available, project name, ticker);
- edit ONLY `welcome_enabled`, `welcome_message`, `mention_member`, `auto_delete_enabled`, `auto_delete_seconds`;
- send the existing welcome test to that group.

Owner-only / deferred: connect, disconnect, reassign, live verify/status, bot/admin permissions, bot token/secrets, every `launch_watch_*` setting, sticker actions (`sticker_tools`), missions, broadcasts (SP-B3), watcher messages (SP-B2), inbox (SP-B1), official contract broadcasts, launcher/contracts/wallet/treasury, billing, platform admin, Affiliate.

## Owner validation mirrored (unchanged, shared)
`save_welcome_settings`: message trimmed; empty rejected (`INVALID_MESSAGE`); > 3500 rejected; `welcomeEnabled`, `mentionMember`, `autoDeleteEnabled` must be booleans; auto-delete integer 10..120 (`INVALID_SECONDS`); Launch Watch booleans/lifetime/launch eligibility checked. No idempotency key and no rate limit exist on the owner path, so none are added.

## Commercial gate
Owner path: Project Identity + `community_basic` (Gate B). Partner path: `partner_authorize_community_action` evaluates Project Identity via `project_identity_ready` and `community_basic` against the CLIENT workspace via `commercial_evaluate_workspace_feature`. No partner or platform-owner bypass. `community_basic` is enabled on cartel_free v1 and cartel_49 v1 (start gate), so current clients are allowed. Edge mapping: plan limit 429, not included/inactive/denied 403, identity 403, group not found 404, unavailable 503.

## Edge change (fall-through, no second engine)
`backend-source/edge-functions/telegram-group/index.ts`:
- new pre-check: non-member + `save_welcome_settings`/`send_welcome_test` → `partner_authorize_community_action` with the partner's JWT → `partnerCommunityAuthorized`;
- 3 baseline lines changed: non-member guard, Gate B condition, save/test guard;
- partner save forces all six `launch_watch_*` inputs to stored values (or defaults false/null/true/false/true/900) before the one existing validation + upsert;
- partner responses omit Telegram message ids and launch data;
- every other action remains member-only.

## Activation order (each needs explicit approval)
1. CP-SPB4-SQL: apply `docs/sql/SP_B4_partner_community_management.sql`; run rolled-back smoke below.
2. Re-confirm deployed v49 byte-equals repo baseline, then CP-SPB4-EDGE: deploy staged `telegram-group`; owner save + owner welcome test first.
3. CP-SPB4-PUBLISH: publish frontend.
4. Types sync.

## Production smoke (one transaction, ROLLBACK)
Temporary approved partner + accepted `community_management` grant only → list groups (safe fields) → get settings (stored/default) → cross-workspace / wrong group / invalid action denied → authorize on current client plan (allowed) → revoke → denied → row counts and hashes unchanged after rollback. Do NOT call Edge `send_welcome_test` from the DB smoke (Telegram is outside the transaction). Real welcome test waits for an approved active Service Partner and an explicit test group.

## Expected advisor delta
0028 unchanged (9). 0029 +3 (126 → 129). Mutable search path unchanged (1).

## Rollback
Redeploy `telegram-group` v49; `DROP FUNCTION public.partner_list_community_groups(uuid), public.partner_get_welcome_settings(uuid, uuid), public.partner_authorize_community_action(uuid, uuid, text);`; republish previous frontend. No data migration.

## Known limits
- Local regression stubs the plan evaluator; it proves mapping, not the real evaluator.
- If the owner's stored Launch Watch launch becomes ineligible, a partner save fails with `LAUNCH_NOT_ELIGIBLE` exactly as the owner's would; the partner is told to ask the owner.
