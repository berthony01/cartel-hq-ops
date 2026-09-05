# C8.7D Controlled Surgical Audit — Official Group Broadcast of the Registered Contract

Audit only. Zero code, schema, data, migration, Telegram send, or publish change. All DB access was SELECT-only.

## 0. Start gate

- Current HEAD `ac31b3d73a77a70beda424d4812323a89933f41d`; working tree clean; unpublished.
- `git diff eb977cbf5064c25f34e91c0ab2b28612b007eabe HEAD` is **empty** — `ac31b3d` is a platform merge commit (`gpt-engineer-app[bot]`, "Cleaned up C8.7C audit items", edit id `edt-d04d7218…`) whose tree is byte-identical to the C8.7C closure commit. Drift is platform metadata only; **no product-code drift**.
- C8.7A (`launch-verified-eligibility.ts`, `VerifiedDeploymentEvidencePanel.tsx`), C8.7B (`register_verified_launch_contract`, `assert_launch_contract_evidence`, `VerifiedContractRegistrationPanel.tsx`) and C8.7C (`notify_launch_watchers_official_contract`, `OfficialContractNotifyPanel.tsx`) are present, unchanged and closed.
- Live invariants unchanged: deployments 5, launch_events 3, deliveries 4, group announcements 7; PEPECARTEL `WATCHLIST_OPEN` / `official_contract_address` NULL / `official_contract_deployment_id` NULL.

## 0b. Queue safety check — stale C8.7C recovery card

Server-side state shows the C8.7C work completed and closed at `eb977cb`, with the follow-up cleanup merged as `ac31b3d`. No C8.7C recovery/build is active or pending; nothing is mid-flight. The queued UI card beginning "RECOVERY CONTINUATION ONLY…" is **stale and superseded** — it refers to a run that already completed. It was **not executed, re-run, or revived** in this turn, and it should be dismissed rather than accepted.

## 1. Recovered original C8.7D contract

From this project's own history (C8.7 architecture audit, message #839, build-slice list G, and the archived plan section G):

> **C8.7D — group broadcast integration reusing `telegram-group`.**

Binding principles carried from the same authoritative prompt: reuse existing send engines rather than creating new ones; no automatic lifecycle transition, watcher notification, Telegram send, group broadcast, or public visibility in the same DB transaction as registration; owner-only and fail-closed; tenant isolation preserved at DB and server boundaries; "verified" means evidence was verified, never that the project is safe/endorsed. No broader C8.7D scope exists in history — nothing here is inferred beyond that.

## 2. Current Telegram / group architecture

| Layer | Authoritative object |
|---|---|
| Send engine | Edge function `telegram-group` (v11 live, `verify_jwt = true`), snapshot `backend-source/edge-functions/telegram-group/index.ts` |
| Broadcast action | `action: "send_group_announcement"` — authorize → validate → resolve group in workspace → resolve idempotency → CLAIM ledger row → live-verify → send |
| Ledger | `public.telegram_group_announcements` (29 columns) with `status` vocabulary `SENT` / `FAILED` / `AMBIGUOUS` (+ transient `SENDING`) |
| Idempotency | unique index `telegram_group_announcements_idempotency_idx (workspace_id, client_request_id)`; a repeated id never re-sends for any prior state, and reusing an id with a different target/text/CTA is a *conflict*, not a duplicate |
| ACL | RLS enabled, **zero policies, zero grants** — service-role only. Browsers cannot read or write it. |
| Authorization | `workspace_members.role in ('owner','admin')` → `canManageCommunity`, checked inside the edge function against the caller's JWT |
| Client | `src/lib/telegram-group.ts` → `sendGroupAnnouncement({ workspaceId, groupConnectionId, message, clientRequestId, branding?, ctaLaunchId? })`, plus `fetchBroadcastLaunchOptions` |
| UI | `src/routes/_authenticated/telegram.tsx` → `BroadcastsPanel.tsx` → `GroupAnnouncementComposer.tsx` (both still authoritative) |
| Branding | `telegram_photo_v1` caption assembled server-side from the saved Project Profile; client copy is preview-only |
| Launch Watch CTA | server resolves the deep link; `launch_watch_token` never reaches the browser; immutable CTA snapshot columns on the ledger row |
| C8.7B registration | `register_verified_launch_contract(_launch_id, _deployment_id, _expected_contract_address)`, owner-only, evidence-derived |
| C8.7C watcher notify | `notify_launch_watchers_official_contract(_launch_id)`, owner-only, re-derives the address via `assert_launch_contract_evidence`, idempotent on `(launch_id, event_type, scheduled_for = contract_registered_at)` |

Confirmed: registration does **not** post to Telegram, the `OFFICIAL_CONTRACT_REGISTERED` transition does **not** post to Telegram, and C8.7C fans out DM deliveries only. No group post happens anywhere without an explicit authenticated operator call.

## 3. What can be reused as-is

1. `telegram-group` edge function and its whole claim-then-send ordering. No second send engine is needed.
2. `telegram_group_announcements` as the durable ledger, including its `SENT/FAILED/AMBIGUOUS` vocabulary and the never-auto-resend rule.
3. `(workspace_id, client_request_id)` unique index for double-click / retry idempotency.
4. Group resolution + live bot verification + `reconnectRequired` handling.
5. `telegram_photo_v1` branding and the existing Launch Watch CTA keyboard resolution.
6. `assert_launch_contract_evidence` for server-side re-derivation of the authoritative address from bound evidence.
7. `is_workspace_owner` for the owner-only C8.7 boundary.
8. `sendGroupAnnouncement` client shape and `GroupAnnouncementComposer` UX patterns.

## 4. What is genuinely missing

1. **No contract-aware broadcast path.** `send_group_announcement` takes free client text. Nothing derives the message body from the registered, evidence-bound contract, so today an operator could type any string and label it official.
2. **No registration precondition on the send.** The broadcast action never checks launch status, `official_contract_deployment_id`, `contract_registered_at/by`, or address/evidence agreement.
3. **No launch binding on the ledger row.** `telegram_group_announcements` has `cta_launch_id text` (a CTA pointer only) but no `announcement_kind` and no bound `launch_id` for the contract packet, so "has this launch's official contract already been broadcast to this group?" is not answerable and cannot be deduped server-side beyond the per-request-id key.
4. **No owner-only tightening for this specific action.** Group broadcasts are owner *or admin*; C8.7B/C are owner-only. The contract broadcast must match C8.7's stronger boundary.
5. **No Launch Control surface.** The registered-contract broadcast belongs next to the C8.7C notify panel; Community Command's composer is a generic free-text tool.

## 5. Smallest safe implementation delta

**One new action on the existing edge function, one narrow ledger extension, one panel.**

1. **Migration (single, additive):** add `announcement_kind text not null default 'OPERATOR_TEXT'` and `launch_id uuid null references public.launches(id)` to `telegram_group_announcements`; add a partial unique index `(launch_id, group_connection_id) where announcement_kind = 'OFFICIAL_CONTRACT'` so one launch can be broadcast to one group exactly once. No RLS/grant change — the table stays service-role only.
2. **Edge function `telegram-group`:** new `action: "send_official_contract_broadcast"` taking `{ workspaceId, groupConnectionId, launchId, clientRequestId }` and **no message text**. It calls a new owner-only SECURITY DEFINER read RPC (or reuses `assert_launch_contract_evidence` via service role plus an explicit `is_workspace_owner` check) to fail closed on: non-owner, wrong workspace, status not `OFFICIAL_CONTRACT_REGISTERED`, any NULL among address / `official_contract_deployment_id` / `contract_registered_at` / `contract_registered_by`, address ≠ evidence-derived address, unpublished project profile. It then assembles the packet text server-side from the derived values and reuses the existing claim → verify → send → ledger-update path.
3. **Client `src/lib/telegram-group.ts`:** one thin `sendOfficialContractBroadcast(...)` wrapper mirroring `sendGroupAnnouncement`.
4. **UI:** new `src/components/cartel/OfficialContractGroupBroadcastPanel.tsx` mounted in `src/routes/_authenticated/launch-control.tsx` beside `OfficialContractNotifyPanel`, arm-then-confirm, owner-only presentation hint, non-endorsement copy, server-derived preview only.

Terminology: "Official contract registered by the authenticated project, derived from its verified deployment record." Never safe / audited / guaranteed / brokerage- or Robinhood-listed.

## 6. Strict allowlist for the C8.7D build slice

**Create:** `src/components/cartel/OfficialContractGroupBroadcastPanel.tsx`; exactly one migration.
**Modify:** `backend-source/edge-functions/telegram-group/index.ts` (+ deploy that one function, `verify_jwt = true` preserved), `src/lib/telegram-group.ts`, `src/routes/_authenticated/launch-control.tsx` (mount + handler only).
**Prohibited:** any other edge function; `telegram-webhook`; `launch-notifications`; `notify_launch_watchers_official_contract`; `register_verified_launch_contract`; `set_launch_contract_address`; `transition_launch_status`; any lifecycle trigger; `launch_events` / `launch_notification_deliveries` / `launch_watch_subscriptions`; `BroadcastsPanel.tsx`; `GroupAnnouncementComposer.tsx`; chain / deployment / wallet / custody / artifact / liquidity files; mainnet 4663; RLS or grant changes on `telegram_group_announcements`; packages; secrets; publish.

## 7. Authorization, isolation, evidence, idempotency, race findings

- **Authorization gap:** existing broadcast = owner **or** admin. C8.7D must be owner-only to match C8.7B/C. Decision required, but owner-only is the fail-closed default.
- **Tenant isolation:** already enforced twice — `workspace_members` lookup in the edge function and group-in-workspace resolution. The new action must additionally assert `launches.workspace_id = workspaceId`.
- **Evidence binding:** must re-derive via `assert_launch_contract_evidence` and compare case-insensitively to `official_contract_address`, exactly as C8.7C does. Client text must never be trusted for the address.
- **Idempotency:** `(workspace_id, client_request_id)` covers double-click. The proposed partial unique index adds semantic dedupe (one contract broadcast per launch per group) that the current schema cannot express.
- **Race:** the ledger row is claimed as `SENDING` before any Telegram call, so an interrupted run surfaces as `AMBIGUOUS`, never as silent success. The new action should take `select … for update` on the launch row, mirroring C8.7C.
- **Stale registration:** if the address later diverges from its bound evidence the send must be refused, not warned about.

## 8. Rollback-safe / no-send verification matrix

All negative cases fail before any Telegram call, so none of them sends a message; the positive path is proven with a transaction-rolled-back ledger claim and a stubbed transport.

| # | Case | Expected |
|---|---|---|
| 1 | Non-member caller | 403, no ledger row |
| 2 | Workspace admin (non-owner) | 403 (owner-only), no ledger row |
| 3 | Launch from another workspace | 403/404, no ledger row |
| 4 | Status `WATCHLIST_OPEN` (PEPECARTEL today) | refused, no send |
| 5 | Address present, `official_contract_deployment_id` NULL | refused (partial registration) |
| 6 | Address ≠ evidence-derived address | refused (stale registration) |
| 7 | Unpublished project profile | refused |
| 8 | Group not connected / bot removed | refused, `reconnectRequired` |
| 9 | Same `clientRequestId` twice | `duplicate: true`, exactly one ledger row, one send |
| 10 | Fresh id, same launch + group already broadcast | refused by partial unique index, no second send |
| 11 | Transport failure | `FAILED` recorded, never auto-resent |
| 12 | Transport uncertainty | `AMBIGUOUS`, never auto-resent |
| 13 | Copy scan | no "safe", "audited", "guaranteed", "listed" |
| 14 | Live invariants after suite | deployments 5, events 3, deliveries 4, announcements 7, PEPECARTEL unchanged |

Plus `eslint`, `bunx tsgo --noEmit`, `bun run build`, and re-read of the deployed `telegram-group` version/hash/`verify_jwt` per the snapshot workflow.

## 9. GO / NO-GO decisions

Blockers: none technical. Three decisions are required before build:
1. **Owner-only vs owner+admin** for the contract broadcast. Recommendation: owner-only.
2. **Authorize the additive migration** on `telegram_group_announcements` (two columns + one partial unique index). Without it, semantic dedupe and audit binding are impossible; refusing it means accepting request-id-only idempotency.
3. **Authorize modifying and redeploying the live `telegram-group` edge function** (v11 → v12, `verify_jwt = true` preserved, snapshot + inventory updated in the same session).

Also note: PEPECARTEL currently has no registered contract, so C8.7D cannot be end-to-end proven against real production data — verification will be rollback-safe and no-send by construction.

## 10. Verdict

**C8.7D READY TO BUILD** — pending the three authorizations in section 9.

No application code, schema, data, migration, secret, Telegram message, or publish state was changed in this turn.