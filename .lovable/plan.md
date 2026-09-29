# SP-B3 Partner Broadcasts — Audit and Plan (plan only, no edits)

HEAD at audit: `d2c2cf3b`. Production `ocoinbnjgstkmnwwvnhi` inspected read-only.

## 1. Current broadcast architecture (verified)

```text
BroadcastsPanel / GroupAnnouncementComposer (browser)
  -> src/lib/telegram-group.ts  sendGroupAnnouncement()
  -> Edge "telegram-group" action send_group_announcement   (verify_jwt=true)
       1. auth.getUser()
       2. workspace_members row required; owner/admin only (canManageCommunity)
       3. requireProjectToolAccess -> can_use_project_tools(ws, user)
       4. requireCommercialAccess -> evaluate_commercial_access(ws,'official_broadcasts',user)
       5. idempotency lookup on (workspace_id, client_request_id)
       6. INSERT telegram_group_announcements status SENDING (ledger claim)
       7. verifyGroup(): live getChat/getChatMember, UPDATEs group row status fields
       8. ONE sendMessage / sendPhoto, synchronous
       9. UPDATE ledger -> SENT / FAILED / AMBIGUOUS
```

- No queue and no worker: the send happens synchronously inside `telegram-group`. Source is in the repo at `backend-source/edge-functions/telegram-group/index.ts` (not in `supabase/functions/`).
- `telegram_group_announcements` has RLS with no policies (service role only). `announcement_kind` separates community posts from official-contract and correction posts.
- `telegram_group_connections` SELECT policy is `is_workspace_member` and returns `telegram_chat_id`. The owner UI gets raw chat IDs; a partner cannot read this table.
- Other owner actions in the same function: `broadcast_launch_options`, `send_official_contract_broadcast`, `send_official_contract_correction_broadcast`, welcome settings, sticker assign/distribute, group test.

## 2. Limits, rate, idempotency, commercial (verified)

- **Length:** plain text is 1..3500 characters after trimming. Branded photo caption max is 1024 (`BRANDED_CAPTION_MAX`), including the header and footer. **The 1024 you expected applies only to branded posts.** Both limits are enforced only in the Edge function.
- **Rate limit:** none. No cooldown and no daily cap on owner community broadcasts.
- **Idempotency:** `client_request_id` must be a UUID. The key is (workspace_id, client_request_id). A repeated id never sends again, in any state. A different intent with the same id returns 409. A concurrent 23505 error is resolved to the recorded row.
- **Commercial:** owner broadcasts ARE gated, with feature key `official_broadcasts`. Owner bypass lives only in `evaluate_commercial_access` / `can_use_project_tools`. Both use `is_workspace_member`, so a partner fails them.
- **SP-B0 adapter** `partner_evaluate_commercial_access` is service-role only, hard-limited to `project_inbox`, and reads `auth.uid()`. It cannot be reused for broadcasts unchanged.
- `partner_has_scope` reads `auth.uid()`. It works only under a user-JWT client, not the service-role client.

## 3. Classification

| Owner action | Class |
|---|---|
| List connected groups (display-safe fields) | B, new partner wrapper |
| Send plain-text community broadcast | B, new partner Edge action |
| Community broadcast history (aggregate/status) | B, new partner wrapper |
| Branded photo broadcast (logo/profile) | D |
| Launch Watch CTA button on broadcast | D (reads the private launch token) |
| Official contract / correction broadcast | C |
| Connect/disconnect/re-verify group, bot admin, sticker assign/distribute, welcome settings, group test | C |
| Templates / platform messages | C |

Nothing is class A: every owner path needs workspace membership.

## 4. SP-B3 V1 recommendation

A partner with an active `broadcasts` scope can:
- list the client's connected groups: `id` (uuid reference), title, chat type, operational flag. No chat ID or username.
- write a plain-text message (1..3500), preview it, confirm, then send to ONE selected group.
- see history of `COMMUNITY` announcements for that workspace: status, group title, time, text, and an actor kind (owner team or partner). No member data.

Behavior is the same as the owner path. The same UUID idempotency, ledger and SENT/FAILED/AMBIGUOUS rules apply. No invented cooldown, because the owner path has none. The client workspace's own `official_broadcasts` entitlement is checked through the SP-B0 core, with no partner owner-bypass.

**Documented side effect (owner-equivalent):** before sending, `verifyGroup` refreshes the group row's status fields. If the bot was removed, it also pauses that group's enabled Sticker Drops. This is lifecycle bookkeeping, not group management. A partner send would trigger it exactly as an owner send does. If you do not accept this, V1 must STOP, because avoiding it means forking the verification logic.

## 5. Required DB changes (staged SQL `docs/sql/SP_B3_partner_group_broadcasts.sql`)

1. `partner_list_broadcast_groups(_workspace_id)`: authenticated, SECURITY DEFINER, `search_path ''`. Checks `auth.uid()`, then `partner_has_scope(ws,'broadcasts')` first. Returns safe fields only.
2. `partner_list_group_broadcasts(_workspace_id, _limit)`: same posture. Limit clamped to 1..20. Filters `announcement_kind` = the community kind (exact value confirmed at build). Returns no chat ID, requester UUID or message ID.
3. `partner_authorize_group_broadcast(_workspace_id, _group_connection_id)`: authenticated. The Edge function calls it with the partner's user-JWT client. In order it checks:
   - scope
   - the group belongs to `_workspace_id`
   - the Project Identity predicate for the client workspace
   - `commercial_evaluate_workspace_feature(ws,'official_broadcasts', base)`

   It returns only `{allowed, reason_code}`, never plan internals.
4. Project Identity check without duplication: extract the workspace predicate from `can_use_project_tools` into a service-role-only core, `project_identity_ready(_workspace_id)`. `can_use_project_tools` would then call it, with output proven equivalent SP-B0-style. **Decision needed:** approve this extraction, or skip the identity gate for partners (not recommended).

No table, column, RLS, grant, trigger, or membership/operator helper changes. Owner functions stay byte-identical except the optional `can_use_project_tools` extraction in item 4.

## 6. Edge change: REQUIRED

Sending exists only inside `telegram-group`, and that function denies anyone without a membership row. Add a separate branch before the membership check, for the actions `partner_list_groups`, `partner_send_group_announcement` and `partner_group_history`:
- the membership check and the owner/admin role stay unchanged for every existing action.
- the partner branch runs the checks in item 3, forces `brandingEnabled=false`, `ctaEnabled=false`, `announcement_kind` = community, and sets `requested_by` to the partner's user id.
- it then reuses the existing plain-text idempotency, ledger, verification and send code as one internal function. This is a local refactor inside the file, with no behavior change to the owner path.
- **Shared send primitive:** yes, one internal plain-text send function inside the Edge file only. No new DB send primitive.
- **Start gate:** confirm the deployed `telegram-group` (v13) matches the repo source before editing. If it does not match, STOP.

## 7. Frontend

- New `src/lib/partner-group-broadcasts.ts` and `src/components/cartel/PartnerGroupBroadcastPanel.tsx`.
- Update `src/routes/_authenticated/telegram.tsx` so the managed view composes the Inbox, Launch Watcher messages and Broadcasts panels by scope.
- Update `src/lib/partner-client-access.ts` to add `broadcasts` to the active scopes and unlock `/telegram` for it.
- Owner panels and components are not touched.

## 8. Strict allowlist

- `docs/sql/SP_B3_partner_group_broadcasts.sql`
- `backend-source/edge-functions/telegram-group/index.ts`
- `src/lib/partner-group-broadcasts.ts`
- `src/components/cartel/PartnerGroupBroadcastPanel.tsx`
- `src/routes/_authenticated/telegram.tsx`
- `src/lib/partner-client-access.ts`
- `scripts/sp-b3-partner-group-broadcasts-regression.ts`
- `docs/SP_B3_PARTNER_BROADCASTS_RUNBOOK.md`
- test-expectation-only updates: `scripts/sp-a-...`, `sp-b1-...`, `sp-b2-...` (active scope sets / phase allowlists), `scripts/public-discovery-seo-regression.ts` (D-24)
- `roadmap.md`

## 9. Regression + transactional smoke matrix

- **Isolation:** a partner of workspace A cannot list, read history, authorize, or send to groups of workspace B. A group id from B passed with `_workspace_id`=A is denied.
- **Scope states:** no scope, pending, declined, revoked or suspended partner, and anon are all denied. Revoking access blocks the next send.
- **Privacy:** outputs contain no `telegram_chat_id`, user IDs, `requested_by` UUID, or member counts beyond the owner-visible aggregate.
- **Boundaries:** empty and whitespace messages are rejected; 3500 passes; 3501 is rejected. Branding and CTA flags are ignored or rejected on the partner path.
- **Commercial:** the client plan without `official_broadcasts` gives 403. Monthly limit reached gives 429. The partner never inherits platform-owner bypass.
- **Idempotency:** the same request id returns the same row with no second send. The same id with a different message or group returns 409.
- **Ledger:** exactly one row with `announcement_kind` = community, `requested_by` = partner. It appears in owner and partner history.
- **No mutation:** no change to group connect/admin/sticker/welcome rows beyond the documented verification refresh. No watcher DMs, `launch_events` or deliveries created.
- **Owner path:** owner actions give identical results. Owner function md5s unchanged, except the approved identity extraction with an equivalence proof.
- **Production smoke:** runs in a rolled-back transaction for the RPCs. The Edge send is proven only in the later two-account test. A real send needs an approved active Service Partner account and a test group.

## 10. Activation order and rollback

1. CP-SPB3-PUBLISH (frontend, fails closed until the RPCs and Edge function exist).
2. CP-SPB3-SQL (apply the migration, rolled-back smoke).
3. CP-SPB3-EDGE (deploy `telegram-group`; owner regression on the live function first).
4. Types sync.
5. Two-account smoke.

Rollback: redeploy the prior `telegram-group` source; `DROP FUNCTION` the three partner RPCs; restore the `can_use_project_tools` body if it was extracted; remove the scope from `ACTIVE_PARTNER_SCOPES`.

## 11. Expected advisor delta

- 0028 unchanged at 9.
- 0029 +3 (123 -> 126) for the three authenticated SECURITY DEFINER partner RPCs.
- The service-role-only identity core adds no 0029 finding.

## 12. STOP conditions (none triggered by this audit, subject to the decisions below)

- The deployed Edge function differs from the repo source.
- The owner does not accept the verification-refresh side effect.
- The identity gate cannot be satisfied without duplicating the predicate or broadening membership.

## Decisions needed before build

1. Partner V1 text limit: owner-equal 3500 (recommended), or a stricter 1024 cap for partners.
2. Approve the `can_use_project_tools` core extraction (recommended), or no identity gate for partners.
3. Accept the owner-equivalent verification side effect.
4. Branding and Launch Watch CTA are deferred to a later phase.
