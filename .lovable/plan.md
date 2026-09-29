# SP-B4 Community Management — Audit and Plan (plan only, no edits)

Baseline: HEAD `76c5df41`. What was checked: the repository copies of `telegram-group/index.ts` (112,650 bytes), `src/lib/telegram-group.ts`, `CommunityWelcomeDialog.tsx` and the generated types. **The live database and the deployed Edge bundle v49 were not inspected this turn.** Step 0 of the build has to check them.

## 1. How owner community management works today (repository)

All owner community actions go through one server function: `CommunityWelcomeDialog` / other panels → `src/lib/telegram-group.ts` → the `telegram-group` Edge function (`action` switch).
- Who can do what: any `workspace_members` row can read. Changes need `canManageCommunity`, which means role owner or admin (line 85).
- Gate B, for sending or changing actions: `requireProjectToolAccess` (Project Identity), then `requireCommercialAccess` using the action's feature key (lines 89–110). Both run against the service role using `user.id`, so the platform-owner bypass applies to owners.
- Where the data lives: `telegram_community_settings` (one row per `group_connection_id`, with `workspace_id`) and `telegram_group_connections`. Settings are written through a service-role upsert inside Edge. There are no idempotency keys and no rate limits on welcome actions.

| Action | Gate | What it does and returns | Class |
|---|---|---|---|
| `welcome_settings` (read) | any member, no identity or plan check | full settings row + `canManage` + eligible launch options (no tokens) | **B** (partner wrapper RPC, safe fields) |
| `save_welcome_settings` | owner/admin + identity + `community_basic` | checks 1..3500 characters, 3 booleans, auto-delete 10..120s, card lifetime in {300,600,900,1800,3600}, Launch Watch launch eligibility; upserts | **B** (partner Edge fall-through, welcome fields only) |
| `send_welcome_test` | owner/admin + identity + `community_basic` | posts a preview to the connected group, auto-deletes it with a timer, and also posts the Launch Watch card when set up (a cleanup job deletes it later) | **B** (partner fall-through, same code) |
| Launch Watch button fields in save (`launch_watch_*`) | same as save | choosing which launch the button points to | **D** (the partner cannot change them in V1; the server keeps the stored values) |
| `status` | any member | calls `verifyGroup` (updates stored group details, and can mark the bot removed / pause Sticker Drops); **returns full group rows including `telegram_chat_id`** | **B** only as a stored-data safe-field read (no live verify in V1) |
| `assign_pack`, `distribute_pack`, `distribution_status`, `send_group_test` | Sticker Drops plan feature / `community_basic` | sticker actions | **D** (`sticker_tools`) |
| `send_group_announcement`, `broadcast_launch_options` | `official_broadcasts` | already covered by SP-B3 | unchanged |
| `send_official_contract_(correction_)broadcast` | `official_broadcasts` | about official contracts | **C** |
| Connect / disconnect / reassign groups, bot admin re-check and removal handling, bot token | handled outside `telegram-group`'s action list (Step 0 confirms exactly where in the `telegram-link` / `telegram-webhook` code) | install and ownership | **C** |
| Member lists, member counts beyond display, raw chat/user IDs, usernames of private groups, metadata | — | — | **C** |
| Moderation, command menus, conversation start/end | not found in `telegram-group`; conversation handling belongs to SP-B1 | — | **D** / not applicable |

Linked systems: saving welcome settings reads launches, but only to check eligibility for the button. The welcome test can post the Launch Watch card and queue a cleanup job. `verifyGroup` can pause Sticker Drops if the bot was removed. None of these actions touch billing, the launcher, wallets or ownership.

## 2. Recommended SP-B4 V1

A partner with an active `community_management` grant can:
1. List the client's connected groups. Only safe fields: an internal connection ID, title, chat type, stored readiness flags (bot is admin, removed state).
2. Read the welcome settings for one group: welcome on/off, message, mention member, auto-delete on/off and seconds. They also see a read-only summary of the Launch Watch button (on/off and launch title, never the launch token).
3. Save only the welcome message, mention member, welcome on/off, and auto-delete on/off and seconds. The Launch Watch button fields are kept exactly as they are stored.
4. Send a welcome test to that group only, using the existing owner code. If the owner has set up the Launch Watch card, it is posted too (same as owner behaviour, with the same durable cleanup).
5. Revoking the grant stops the partner's very next read or save.

## 3. Plan check (commercial gate)

Owner changes use `community_basic` (confirmed at line 94–96). The partner path checks the **client** workspace's plan through `commercial_evaluate_workspace_feature(_ws,'community_basic',...)` (the shared SP-B0 check), after the scope and group checks and after `project_identity_ready(_ws)`. Partners get no owner bypass. Denial codes reuse the SP-B3 mapping: plan limit 429, feature not included or plan inactive 403, missing identity 403, group not found 404, plan check unavailable 503. The owner's read has no plan check, so the partner read has none either (it only needs the scope). No pricing or plan changes.

## 4. Database changes (staged `docs/sql/SP_B4_partner_community_management.sql`)

Three authenticated RPCs: SECURITY DEFINER, owned by postgres, `SET search_path TO ''`, explicit `auth.uid()` check, `partner_has_scope(_ws,'community_management')` checked first, EXECUTE revoked from PUBLIC and anon, granted to authenticated and service_role:
- `partner_list_community_groups(_workspace_id)`
- `partner_get_welcome_settings(_workspace_id,_group_connection_id)`: the group must belong to the workspace; returns defaults that match the Edge defaults when no row exists.
- `partner_authorize_community_action(_workspace_id,_group_connection_id,_action text)`: `_action` must be one of `save_welcome_settings` / `send_welcome_test`; runs the scope, group, identity and `community_basic` checks for the client; returns `{allowed, reason}` only.

No table, column, RLS, grant or helper changes. `can_use_project_tools`, `is_workspace_member` and `is_workspace_operator` stay untouched.

## 5. Edge change (staged source only: `telegram-group/index.ts`)

Same fall-through pattern as SP-B3, with no second save or send code path:
- A non-member calling `save_welcome_settings` or `send_welcome_test` → the Edge function calls `partner_authorize_community_action` with the partner's own login → sets `partnerCommunityAuthorized`, then skips Gate B for that request only.
- The line 410 guard becomes `!canManageCommunity && !partnerCommunityAuthorized`.
- On a partner save, before the existing checks run, the Edge function replaces `raw.launchWatch*` with the stored row's values (or the defaults). The existing checks and upsert then run unchanged.
- `welcome_settings` and `status` stay member-only (partners read through the RPCs). Every other action is unchanged.
- Existing code reused: the checks, upsert, preview rendering, auto-delete, card and cleanup-job logic.

## 6. Screens and files

- New: `src/lib/partner-community-management.ts`, `src/components/cartel/PartnerCommunityPanel.tsx` (group picker, welcome editor with a 3500-character counter, 10–120s control, read-only Launch Watch summary, send-test confirmation).
- Update only if needed: `src/routes/_authenticated/telegram.tsx` (adds a "Community" tab for this scope), `src/lib/partner-client-access.ts` (makes `community_management` active), plus `ManagedAccessGuard.tsx`, `SidebarNav.tsx`, `ServicePartnerAccessPanel.tsx`.

## 7. Strict allowlist

The SQL file above; `backend-source/edge-functions/telegram-group/index.ts`; the two new frontend files; the five update-if-needed files; `scripts/sp-b4-partner-community-management-regression.ts`; `docs/SP_B4_PARTNER_COMMUNITY_RUNBOOK.md`; expectation-only updates to the SP-A, SP-B1, SP-B2 and SP-B3 regressions (active scopes, allowed files) and public-discovery D-24; `roadmap.md`.

## 8. Regression checks

- Active scopes are exactly the 4 current ones plus `community_management`; `sticker_tools` and `missions` stay inactive.
- Denied when: a different workspace's group, list or settings is used; no scope; grant pending, declined, revoked or suspended; anonymous caller.
- Outputs never contain `telegram_chat_id`, user IDs, private usernames, `member_count`, `metadata` or `requested_by`.
- The group must belong to the workspace, including a group ID from another workspace.
- Save boundaries: empty / 3500 / 3501 characters; 9, 10, 120, 121 seconds; non-boolean flags rejected.
- A partner save cannot change any `launch_watch_*` field (stored values kept, including a crafted request body).
- Client plan: denied on free, allowed on a plan that includes it, limit maps to 429, no owner bypass; missing Project Identity is denied.
- `_action` outside the allowed list is rejected.
- Owner behaviour unchanged: Edge changes limited to the listed lines, and the owner save and test paths match.
- No group connect, disconnect, reassign or delete; no rows in `launch_events`, watcher deliveries, announcements, sticker tables or missions tables; no launch or billing writes.
- Revocation denies the very next authorization.
- Existing suites, TypeScript, production build and `git diff --check` all pass.

## 9. Production smoke test (one transaction, rolled back)

Temporary partner and grant with `community_management` → list and settings return only safe fields → cross-workspace, wrong group and wrong action denied → authorize on a free client returns FEATURE_NOT_INCLUDED → a plan assignment made inside the transaction allows it → revoke, then denied → row counts match before and after (settings, groups, announcements, launch events, deliveries, cleanup jobs, partner_client_access 0).

## 10. Activation order and rollback

CP-SPB4-SQL (plus smoke) → compare the deployed v49 bundle to the repository byte-for-byte → CP-SPB4-EDGE (owner save and test check first) → CP-SPB4-PUBLISH → types sync.
Rollback: redeploy v49 → drop the 3 RPCs → republish the previous frontend. No data migration is needed.

## 11. Expected advisor results

0028 stays at 9. 0029 goes up by 3 (126 → 129). The mutable-search-path count stays at 1.

## 12. STOP conditions

Stop if any of these is true:
- the deployed v49 does not match the repository;
- safe delegation would need connect, disconnect or reassign, raw IDs, workspace membership, pretending to be the owner, or any launcher or wallet change;
- the partner save cannot keep the Launch Watch fields without restructuring the save code;
- live `telegram_community_settings` or its policies differ from the generated types.

## Decisions (locked)

1. The partner welcome test mirrors owner behaviour and includes the owner's already-configured eligible Launch Watch card (confirmed).
2. The partner cannot change any Launch Watch button settings in V1; the server keeps the stored values, and changing them is deferred (confirmed).

The live schema, commercial gate and Edge start gates were independently verified as stated in the build specification.
