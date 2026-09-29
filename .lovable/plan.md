# SP-B2 — Partner Launch Watcher Messages (audit + plan only)

Baseline: HEAD `13e5e4d5` (on top of `77c58130`). Production `ocoinbnjgstkmnwwvnhi` was read-only. Nothing was edited, applied, published or deployed.

## 1. Current architecture (checked against live definitions)

```text
Owner UI  BroadcastsPanel (/telegram, owner branch only)
  -> create_launch_watcher_update(launch, client_request_id, title, body)   [operator only]
       INSERT launch_events (event_type WATCHER_UPDATE, source 'operator', payload {version,client_request_id,title,body})
         -> trigger enqueue_launch_event_deliveries  (active AND updates_enabled watchers only)
              -> launch_notification_deliveries (pending, one row per subscription)
                   -> claim_launch_notification_deliveries (service_role) -> Edge launch-notifications (cron) -> Telegram DM
```

- **Watcher privacy:** `launch_watch_subscriptions` holds `telegram_user_id`. The browser gets counts only (`get_launch_watcher_update_stats`, `get_launch_audience_summary`, `get_launch_watch_summary`). `list_launch_watcher_updates` returns the event title, body and per-status counts. None of these return Telegram IDs or subscription IDs.
- **Owner send checks (`create_launch_watcher_update`):** client_request_id required; `FOR UPDATE` lock on the launch row (the row is locked, never changed); `is_workspace_operator`; status must be WATCHLIST_OPEN, LAUNCH_APPROACHING, CONTRACT_PENDING, OFFICIAL_CONTRACT_REGISTERED or LIVE; Project Profile must be published; replaying the same request returns the original event (backed by the unique index `launch_events_watcher_update_request_uniq` plus a unique_violation handler); title up to 120 characters; body 1–2200 characters; at least 1 eligible watcher; at most 1 update per 60 seconds and 20 per 24 hours per launch.
- **Opt-out:** enforced in the enqueue trigger (`is_active`, `updates_enabled`). The send function cannot get around it.
- **Commercial:** the owner send path has **no commercial check**. The only live function that checks `'launch_watch'` is `transition_launch_status`.
- **Read helpers** use `is_workspace_member`, so partners cannot call them today.
- **Other communication actions:** `notify_launch_watchers_official_contract[_correction]` (tied to contract registration), `send_launch_schedule_communication` / `dismiss_launch_schedule_communication` (tied to schedule-change detection), and reminder or lifecycle events produced by triggers on `launches`.
- **Constraints:** `launch_events.source` must be one of reminder_runner, lifecycle or operator. `event_type` must be one of a fixed set that includes WATCHER_UPDATE.
- **Edge Function:** `launch-notifications` is deployed but its source is **not in this repository**. It reads trusted queue rows through a service_role claim.

## 2. Classification

| Action | Class |
|---|---|
| Watcher counts (active / updates on / muted) | B — partner wrapper |
| Past watcher-update history (title, body, status counts) | B — partner wrapper |
| Send custom watcher update | B — partner wrapper |
| Full audience delivery breakdown | D — defer (counts are enough for v1) |
| Official contract packet / correction notices | C — owner only (tied to contract authority) |
| Schedule-change send / dismiss | D — defer (needs a separate comms-only approval) |
| Reminders and lifecycle alerts | C — automatic, driven by launch status |
| Launch status, contract, schedule, deploy, treasury | C — owner only, never exposed |
| Watcher list or export | C — never |

Nothing is class A: every existing function checks workspace membership or operator status.

## 3. Recommended SP-B2 V1

A partner with an active `launch_watcher_comms` grant opens a managed client, picks one of that client's launches, sees the watcher counts and recent update history, writes a title and body, confirms a preview, and sends. Delivery reuses the existing event, trigger, queue, worker path unchanged. History stays with the client's launch. No watcher identities are shown.

No STOP condition is triggered. This needs no operator or member widening, no impersonation, no watcher export, and no launcher or wallet changes.

## 4. Database work (new SQL file, additive)

`docs/sql/SP_B2_partner_launch_watcher_comms.sql` adds three functions. Each is SECURITY DEFINER, uses `SET search_path = ''` with fully qualified names, reads `auth.uid()` explicitly, revokes PUBLIC and anon, and grants authenticated and service_role.

1. `partner_launch_watcher_stats(_workspace_id, _launch_id)` — checks `partner_has_scope(_workspace_id,'launch_watcher_comms')` first, then that the launch exists **and** `launch.workspace_id = _workspace_id`. Returns the same three counts as the owner version.
2. `partner_list_launch_watcher_updates(_workspace_id, _launch_id, _limit)` — same checks first. Same columns as the owner version, limit clamped to 1–20.
3. `partner_create_launch_watcher_update(_workspace_id, _launch_id, _client_request_id, _title, _body)` — same scope check, then lock the launch row and require its workspace to match, then **copy the owner checks line for line**: status allow-list, published profile, replay lookup, validation (120 / 2200 characters), at least 1 eligible watcher, 60-second gap, 20 per day, and the unique_violation replay handler. It inserts `WATCHER_UPDATE` with `source 'operator'`, because the constraint allows nothing else and changing it is out of scope. The payload adds `actor:'service_partner'` and `partner_access_id` for audit. The partner shares the owner's rate limits because both count all events on the launch.

**Shared internal core:** not needed. The send logic is about 100 lines with no billing engine inside, so a reviewed line-for-line wrapper (the SP-B1 pattern) carries less risk than extracting from a live owner function. Owner functions stay unchanged.

**No** table, RLS, grant, trigger, constraint, or owner-function changes. **No** direct table permissions.

### Open decision: commercial gate
The owner path has no commercial gate, so v1 matches the owner exactly (no gate). If you want partner sends gated, the option is a separate additive `partner_evaluate_launch_watch_access` adapter. It would use the SP-B0 core with `'launch_watch'` against the **client** workspace, behind the scope check, and would not give partners the owner bypass. This adds a gate the owner doesn't have, so it needs your explicit approval. The default is no gate.

## 5. Edge Function
No changes. The worker consumes queue rows that are indistinguishable from owner sends, and the extra payload keys are additive. **Caveat:** the `launch-notifications` source is not in the repo, so "ignores extra payload keys" can only be proven by a live smoke that confirms the DM renders.

## 6. Frontend
- `src/lib/partner-launch-comms.ts` (new) — wrappers for the three RPCs; a missing RPC fails closed.
- `src/components/cartel/PartnerLaunchCommsPanel.tsx` (new) — launch picker (the client's launches in allowed statuses, through the existing partner-readable launch list if one exists; otherwise step 1 must add a fourth read RPC that returns only id, name and status for this workspace), counts, history, compose with the 120/2200 limits, a preview confirm dialog, one client_request_id per draft, and 44px+ touch targets.
- `src/routes/_authenticated/telegram.tsx` — the managed branch shows Inbox and/or Launch Watch messages based on scopes.
- `src/components/cartel/ManagedAccessGuard.tsx`, `SidebarNav.tsx` — allow `/telegram` when the grant has project_inbox **or** launch_watcher_comms.
- `src/lib/partner-client-access.ts` — scope helper only.

## 7. Strict allowlist
The SQL file above, `docs/SP_B2_PARTNER_LAUNCH_COMMS_RUNBOOK.md`, `scripts/sp-b2-partner-launch-comms-regression.ts`, the six frontend files above, `roadmap.md`, `.lovable/plan.md`, and the D-24 allowlist entry in `scripts/public-discovery-seo-regression.ts` only if required. Types are regenerated in a separate turn after activation. Forbidden: owner functions, membership and operator helpers, launches/contract/status/schedule/treasury/deploy, Edge Functions, Stripe, plans and prices, Affiliate, partner statuses, and production SQL.

## 8. Test matrix (static + local DB + production smoke rolled back)
- Cross-workspace: scope on workspace A with a launch from B → denied. A mismatched `_workspace_id` → denied before any data is read.
- Scope missing, grant pending, declined, revoked or suspended partner, anon → denied. Revoking mid-session blocks the next send.
- Output columns contain no telegram_user_id, chat_id or subscription_id. No function returns per-watcher rows.
- Opt-out: a muted or inactive watcher gets no delivery row. An unmuted watcher gets exactly one.
- Idempotency: the same client_request_id returns the same event id with no second delivery set. A concurrent duplicate is handled by the unique index.
- Queue: delivery rows equal the eligible count, status pending, event workspace equals the client workspace.
- Rate limits: a second send within 60 seconds is rejected; the 21st send in 24 hours is rejected (shared with the owner).
- Length: empty body, 2201 characters and a 121-character title are rejected; boundary values are accepted.
- Status and profile: DRAFT, ANNOUNCED and COMPLETED are rejected; an unpublished profile is rejected.
- No launch-state change: a before/after hash of the `launches` row shows no difference; no other event types are created.
- Commercial: none in v1. If the adapter is approved, test deny and allow on the client plan and confirm partners get no owner bypass.
- Owner unchanged: the owner function definitions match live byte for byte; owner send still works; `is_workspace_member` and `is_workspace_operator` are unchanged.
- Existing suites: SP-B0, SP-B1, SP-A, Service Partner, commercial-entitlements, Partner 1A and 1B-1 through 1B-4 plus reconcile, public discovery, typecheck, build, `git diff --check`.

## 9. Activation order and rollback
1. CP-SPB2-STAGE: build in the repo only, run the tests above.
2. CP-SPB2-SQL: apply the single additive migration → check ACLs, search_path and owner → run the production transactional smoke (sends inside a transaction that is rolled back, so no DM goes out) → confirm counts are unchanged.
3. Regenerate types (separate turn).
4. CP-SPB2-PUBLISH: frontend, only with explicit approval.
5. Real two-account smoke (needs an approved, active Service Partner test account; still pending).

Rollback: `DROP FUNCTION` the three (or four) partner functions and hide the panel. No data or owner path depends on them. Any events already queued deliver normally.

## 10. Expected advisor lint changes
- 0028 (anon SECURITY DEFINER): unchanged at 9.
- 0029 (authenticated SECURITY DEFINER): +3 (+4 if the launch-list read is needed, +0 for a service_role-only commercial adapter), from 119 to 122 or 123.
- Search-path lint: no new findings.
