# SP-B Audit and Plan — Scoped Service Partner Permissions

Start gate: HEAD `7c2fe7cd8e5c01756a3b7004f58f45bdf5feef8e` confirmed. Plan only; no edits, no SQL, no publish.

## Findings from the audit (verified this turn)

Every existing backend check for these six areas uses `is_workspace_operator` (owner/admin) or `is_workspace_member`. None of them call `partner_has_scope`. So today a partner is correctly denied everywhere, and **no existing function can be reused just by adding "OR partner_has_scope"** without editing owner/admin functions. That edit would be risky, so every scope needs its own new partner-only wrapper.

| Scope | Screens | How it works today | Current check | Dangerous parts (stay owner-only) | Can it be a wrapper? |
|---|---|---|---|---|---|
| project_inbox | `/telegram` Inbox (`ProjectInboxPanel`, `src/lib/project-inbox.ts`) | Only database functions (`list_project_inbox_conversations`, `get_project_inbox_conversation`, `list_project_conversation_messages`, `create_project_inbox_team_reply`, `update_project_conversation_status`, `acknowledge_project_inbox_delivery_uncertainty`, summary/settings, block/unblock). Messages go out through the existing `project-inbox-delivery` queue worker (service role). | operator | Settings changes (`set_project_inbox_*`), blocking members | **Yes.** Only database functions, and the worker reads the queue without depending on who wrote it. |
| launch_watcher_comms | Launch Control audience/updates (`src/lib/launch-control.ts`) | `get_launch_*_summary` (member check), `create_launch_watcher_update`, `dismiss_launch_schedule_communication`, `notify_launch_watchers_official_contract` (operator) | member / operator | Registering or correcting the contract, changing launch status, anything to do with production or the chain | Reads yes. Sending is a live DM to all watchers, so it needs an approval step |
| broadcasts | `BroadcastsPanel`, `GroupAnnouncementComposer`, `OfficialContractGroupBroadcastPanel` | Tables `telegram_group_announcements` plus the `telegram-group` Edge Function (requires sign-in) | operator, checked inside the Edge Function | Contract broadcasts, sending to every group | No. The Edge Function would have to change |
| community_management | `/telegram` group cards, `CommunityWelcomeDialog`, `TelegramConnectionCard` | `telegram_community_settings` / `telegram_group_connections` plus the `telegram-group` Edge Function | operator | Connecting or removing groups, bot admin rights, removing the bot, choosing the Launch Watch launch | Partly, but needs the Edge Function |
| sticker_tools | `/sticker-lab/*`, `StickerDropScheduleDialog` | Tables with member write policies, `archive/delete/restore_sticker_pack`, Edge Functions `sticker-ai`, `sticker-concepts`, `sticker-motion-ai`, `sticker-motion-telegram`, `sticker-drop-config` | member policies / operator / inside Edge Functions | Paid AI generation (usage cost), deleting packs, Telegram pack publishing | No. Several Edge Functions and member write policies are involved |
| missions | `SocialMissionsPanel`, mission control, `social-mission-telegram` | `social_*` tables, `social-mission-telegram` Edge Function, server functions using `is_workspace_operator` | operator | X account connection, provider settings, paid metric reads | No. Needs the Edge Function and server functions |

## Recommended phase order

1. **SP-B1: project_inbox (reply, assign status, acknowledge)**. It is the smallest change (database only, no Edge Function), the most useful to resellers every day, and it keeps member privacy (the opaque member reference only).
2. **SP-B2: launch_watcher_comms read-only** (audience and watch counts, update stats). Sending watcher updates follows as B2b with an owner-approval queue.
3. **SP-B3: community_management safe settings** (welcome text, auto-delete timing, turning the welcome card on or off). Needs a partner check inside `telegram-group`, so a separate Edge Function review is required.
4. **SP-B4: broadcasts**, staged as partner drafts first. Sending live requires owner approval (or an explicit per-grant "may send" flag in a later phase).
5. **SP-B5: sticker_tools** without paid AI (pack metadata and drop scheduling). AI generation stays owner-only until partner usage accounting is designed.
6. **SP-B6: missions content**. X connection and provider credentials stay owner-only permanently.

Live Telegram sending: none in B1 other than inbox replies, which are one-to-one answers to a member who started the conversation and use the existing queue with its idempotency. Mass sends (B2b and B4) stay behind owner approval.

## SP-B1 exact scope

Partner with an active, accepted grant that includes `project_inbox` can:
- see the summary counts, the conversation list and a conversation's details and messages
- send a team reply (same duplicate-safe `client_request_id`, same blocked/resolved/unresolved-delivery guards)
- change status (open / waiting / resolved)
- acknowledge an uncertain delivery

Partner cannot: change inbox settings, block or unblock members, or see Telegram identifiers (already never returned).

### Database (staged in `docs/sql/SP_B1_partner_project_inbox.sql`, not applied)
New SECURITY DEFINER functions, each with `SET search_path TO ''`. Each one checks `auth.uid()` is not null, requires `partner_has_scope(auth.uid(), _workspace_id, 'project_inbox')`, and resolves the conversation using both `id` and `workspace_id`. PUBLIC and anon access is revoked; only `authenticated` can run them:
- `partner_inbox_summary(_workspace_id)`
- `partner_inbox_list_conversations(_workspace_id, _status, _limit)`
- `partner_inbox_get_conversation(_workspace_id, _conversation_id)`
- `partner_inbox_list_messages(_workspace_id, _conversation_id, _limit)`. Takes the workspace, unlike the owner version.
- `partner_inbox_create_reply(_workspace_id, _conversation_id, _body, _client_request_id)`
- `partner_inbox_update_status(_workspace_id, _conversation_id, _status)`
- `partner_inbox_ack_uncertainty(_workspace_id, _conversation_id, _message_id)`

Implementation: move each owner function's core into a private internal helper (no grant to authenticated), then call it from a partner wrapper. **Do not change existing owner function bodies or grants.** If sharing code would mean editing the owner functions, copy the logic into the partner wrappers instead. The author display name for a partner reply is "Service Partner", without their email. No table, RLS, `workspace_members` or helper changes. The existing `partner_has_scope` already checks for an active partner, an active Service Partner track and a non-revoked grant.

Pre-build check (read-only): read the exact definitions of the 7 owner inbox functions and `partner_has_scope`. Also confirm that `project_conversation_messages` can record a team author that is not a workspace member (a foreign key or NOT NULL on the author could block it). If it cannot, STOP and report.

### Frontend
- `src/lib/partner-client-access.ts`: add `"project_inbox"` to `ACTIVE_PARTNER_SCOPES`, and add `/telegram` to allowed paths only when the grant has the scope (a scope-aware `isManagedAllowedPath(pathname, scopes)`).
- `src/lib/project-inbox.ts`: add partner-mode wrappers that call the `partner_inbox_*` functions. Owner calls are unchanged.
- `src/components/cartel/ProjectInboxPanel.tsx`: a `mode="partner"` prop that hides the settings toggles and the block/unblock control.
- `src/routes/_authenticated/telegram.tsx`: when the workspace is managed, render only the partner Inbox panel (no groups, stickers, broadcasts or settings).
- `src/components/cartel/ManagedAccessGuard.tsx`, `SidebarNav.tsx`: show nav items based on scope.
- `src/components/cartel/ServicePartnerAccessPanel.tsx`: show "Project inbox" as active, not "coming soon".

Edge Functions: none changed. `project-inbox-delivery` is left as is.

## Strict allowlist for SP-B1
- docs/sql/SP_B1_partner_project_inbox.sql
- docs/SP_B1_PARTNER_INBOX_RUNBOOK.md
- src/lib/partner-client-access.ts
- src/lib/project-inbox.ts
- src/components/cartel/ProjectInboxPanel.tsx
- src/components/cartel/ManagedAccessGuard.tsx
- src/components/cartel/SidebarNav.tsx
- src/components/cartel/ServicePartnerAccessPanel.tsx
- src/routes/_authenticated/telegram.tsx
- scripts/sp-b1-partner-inbox-regression.ts
- scripts/sp-a-managed-client-access-regression.ts (update only the "project_inbox inactive" assertion)
- scripts/public-discovery-seo-regression.ts (D-24 allowlist only)
- roadmap.md
- src/integrations/supabase/types.ts only after migration, via regeneration

## Regression and smoke tests
Regression (throwaway local Postgres, same as SP-A):
- a partner with the scope can list, read, reply, change status and acknowledge; the reply is queued once, and replaying with the same request id returns the original
- a partner without the scope, a revoked, declined or pending grant, a suspended partner, or a closed Service Partner track gets denied on every function
- a conversation from another workspace is denied
- no function returns a Telegram id, chat id, username or contact_id
- partners cannot call settings or block functions (denied by operator check)
- owner functions are byte-identical to the baseline definitions
- anon has no execute; PUBLIC is revoked; `search_path` is empty
- `is_workspace_member` and `is_workspace_operator` are unchanged; `workspace_members` gets no rows added
- owner bypass: platform owner inbox is unaffected

Also run: typecheck, build, SP-A, Service Partner, public discovery, Partner 1A/1B suites, `git diff --check`.

Live smoke (two accounts, after approval): partner sees only the Inbox for the managed project → replies → the member receives it once → owner revokes → partner is denied immediately and the history is kept.

## Production activation order
1. Build and stage (repo only), then independent diff review.
2. CP-SPB1-PUBLISH: publish the frontend. It fails closed while the functions are missing: the partner Inbox shows as unavailable.
3. CP-SPB1-SQL: apply the staged SQL. Then check the advisor delta (only the 7 new authenticated SECURITY DEFINER findings), grants and function definitions.
4. Regenerate types (types-only turn).
5. Two-account browser smoke.
Rollback: revoke execute on the `partner_inbox_*` functions. The owner Inbox is unaffected.

## Permanently owner-only (every phase)
Billing and subscriptions, workspace ownership or transfer, invites and scope edits for Service Partners, wallets/treasury/signers/private keys, production chain deployment and launch execution, contract registration and correction, launch status changes, platform admin and owner controls, Telegram group connection and removal and bot admin, inbox settings and member blocking, X account and provider credentials, paid AI generation (until designed), Affiliate program.

## STOP conditions
Stop if SP-B1 needs any of these: an edit to an owner inbox function, a change to `is_workspace_*`, a `workspace_members` row, an Edge Function change, or a table or constraint change to record a partner author.
