# C8.7 Cartel Verified Launch — Read-Only Architecture Audit

Audit only. No code, schema, data, migration, package, secret, Telegram send, or publish change was made.

## 0. Start gate — CONFIRMED

- HEAD `b5ad35acd3ce71a7f28ce4d4b272abac25c3842e`, working tree clean.
- PEPECARTEL launch `9f9af215-66ee-4a10-92db-617b61fb7fd3`: chain `Solana`, status `WATCHLIST_OPEN`, `official_contract_address` NULL, `contract_registered_at` NULL. Unchanged.
- 5 deployment rows, all TESTNET / chain 46630, max attempt 5. Attempts 3, 4, 5 are all `CONFIRMED`; 4 and 5 are `FIXED_SUPPLY_ERC20` (CTEST).

## A. System-of-record map

| Layer | Authoritative object |
|---|---|
| Launch model | `public.launches` — `chain` (free text, currently "Solana"), `status`, `official_contract_address` (text, nullable, no format constraint), `contract_registered_at`, `contract_registered_by`, `launch_watch_token` |
| Lifecycle enforcement | triggers `enforce_launch_status_transition`, `enforce_launch_contract_update`, `enforce_launch_update_rules`, `launches_before_insert` |
| Contract write | RPC `set_launch_contract_address(_launch_id, _contract_address)` SECURITY DEFINER; RPC `transition_launch_status` |
| Chain evidence | `public.launch_chain_deployments` (+ `launch_id` FK, `chain_id`, `network_environment`, `deployment_kind`, `artifact_id`, `contract_address`, `tx_hash`, `block_*`, `confirmations`, `verified_token_*`, `verified_total_supply_text`, `verified_recipient_balance_text`) and RPCs `create_/submit_/abandon_/apply_launch_chain_token_deployment_verification` |
| Client verification | `src/lib/chain-verify.functions.ts`, `chain-registry.ts`, `launch-receipt.ts`, `chain-simulation.ts`, route `_authenticated/chain-launcher.tsx` |
| Launch Control UI | `src/lib/launch-control.ts`, `src/routes/_authenticated/launch-control.tsx` (contract field at ~1859-1903) |
| Notifications | `launch_events`, `launch_notification_deliveries`, `launch_watch_subscriptions`; triggers `enqueue_launch_lifecycle_notification_events`, `enqueue_launch_event_deliveries`; fn `launch_notification_payload`; edge fn `launch-notifications` + per-minute runner |
| Telegram | edge fns `telegram-webhook`, `telegram-group`; `src/lib/telegram-group.ts`; `telegram_group_announcements` |
| Broadcast UI | `BroadcastsPanel.tsx`, `GroupAnnouncementComposer.tsx` |
| Identity/roles | `project_profiles`, `project_platform_reviews` + `src/lib/project-verification.ts`; `is_workspace_operator/owner/member`, `has_platform_unrestricted_access` |

## B. Current registration flow

1. Launch must be at `CONTRACT_PENDING` (single-step lifecycle, no skipping).
2. Owner/admin types a free-text string into the Launch Control field and saves.
3. `set_launch_contract_address` locks the row `FOR UPDATE`, requires `is_workspace_operator(workspace_id, auth.uid())`, requires status `CONTRACT_PENDING`, trims, and only checks **1–256 characters**. No address format, no checksum, no chain match, no on-chain existence check, no link to any deployment row.
4. `enforce_launch_contract_update` allows edits only while `CONTRACT_PENDING` and only while `contract_registered_at` is NULL — so it is effectively immutable after registration, with no correction workflow.
5. Registration is *completed* by a separate `transition_launch_status` to `OFFICIAL_CONTRACT_REGISTERED`, which stamps `contract_registered_at/by`.

**Confirmed:** there is no code path, RPC, or trigger anywhere that promotes a `launch_chain_deployments` row into `launches.official_contract_address`. The C8 pipeline is walled off by design and by explicit doc comments.

## C. Current communication flow — registration DOES auto-send

The status transition to `OFFICIAL_CONTRACT_REGISTERED` fires `enqueue_launch_lifecycle_notification_events` **in the same transaction**, inserting a `launch_events` row with the payload snapshot; that insert fires `enqueue_launch_event_deliveries`, fanning out `launch_notification_deliveries` rows for every active subscriber. The per-minute `launch-notifications` worker then DMs a "📦 VERIFIED LAUNCH PACKET" (it re-checks published profile, non-empty address, and not already LIVE/COMPLETED; stale claims become `ambiguous`, never blind-retried).

Group broadcasts are **not** automatic: `telegram-group` requires an authenticated owner/admin and a `clientRequestId`, deduped in `telegram_group_announcements`.

So: watcher DMs fire automatically on the lifecycle write, group posts do not. This violates the C8.7 "no send in the same transaction as registration" principle and is the single most important architectural finding.

## D. Gap analysis

1. No evidence binding: no column/table joins a launch's official contract to the deployment row that proves it.
2. No eligibility gate: `CONFIRMED` alone is meaningless — three CONFIRMED testnet rows already hang off PEPECARTEL.
3. No environment guard: nothing prevents a TESTNET address from being pasted into the official field.
4. No chain-consistency guard: launch `chain` is free text ("Solana") while evidence is EVM 46630 — mismatch is currently unrepresentable and unchecked.
5. No separation of registration from notification (see C).
6. No correction workflow for a wrong-but-registered address.
7. No audit record of *why* an address was accepted (`launch_events` is a notification queue, not a decision ledger; `contract_registered_by` is the only trace).
8. No owner-only fail-closed review step; workspace operator is sufficient today.

## E. Threat model

| Threat | Current exposure |
|---|---|
| Testnet mistaken for official | HIGH — free text, no environment check |
| Wrong chain | HIGH — `chain` is free text, never compared to `chain_id` |
| Stale / ambiguous deployment | HIGH — 3 CONFIRMED rows, no "which one" concept |
| Manual fake CA | HIGH — any 1–256 char string accepted |
| Confirmed tx but wrong runtime/token metadata | Mitigated in C8 verifier (bytecode hash + token reads), unused by registration |
| Manipulated DB row | Writes are RPC/service-role only; trigger functions have EXECUTE revoked |
| Duplicate registration / replacement | Blocked after `contract_registered_at` — but also blocks legitimate correction |
| Cross-tenant | Enforced (`is_workspace_operator`, tenant trigger on deployments) |
| Unauthorized team member | Operator-level today, not owner-only |
| Duplicate / partial notification | Handled: `on conflict do nothing`, claim + stale→`ambiguous` |
| Race condition | `FOR UPDATE` on launch; no lock coupling registration to evidence |
| Replay | Deployment RPCs use `client_request_id`; registration has none |

## F. Proposed state machine (reusing existing names)

```text
DEPLOYMENT CONFIRMED (existing, chain-verified)
   -> C8.7 ELIGIBILITY EVALUATED   (pure derivation, no write)
   -> OWNER REVIEW / EXPLICIT CONFIRMATION (owner-only, typed confirmation)
   -> OFFICIAL REGISTRATION        (bind evidence + write address; NO sends)
   -> COMMUNICATION READY          (explicit separate step)
   -> NOTIFY WATCHERS / GROUP BROADCAST (existing engines, operator-triggered)
```

Requires decoupling the auto-enqueue trigger from the lifecycle write — a deliberate, separately authorized change.

## G. Build slices

- **C8.7A** — read-only eligibility + evidence panel in Launch Control (pure derivation, zero writes, zero schema).
- **C8.7B** — schema: evidence binding columns/table + eligibility-gated, owner-only registration RPC.
- **C8.7C** — decouple notification enqueue from the registration transaction; explicit "notify watchers" action.
- **C8.7D** — group broadcast integration reusing `telegram-group`.
- **C8.7E** — correction workflow, audit ledger, terminology hardening.

## H. C8.7A allowlist (first slice only)

- **Create:** `src/lib/launch-verified-eligibility.ts`, `src/components/cartel/VerifiedDeploymentEvidencePanel.tsx`.
- **Modify:** `src/routes/_authenticated/launch-control.tsx` (mount panel only).
- **Prohibited:** any migration/RPC/grant/trigger; any write; `set_launch_contract_address`; `transition_launch_status`; `official_contract_address`; chain-launcher/chain-verify/chain-registry/launch-receipt/liquidity files; Telegram, Launch Watch, broadcast; mainnet 4663; publish.
- **Tests:** deterministic eligibility across the 5 live rows; TESTNET → BLOCKED; chain mismatch (`Solana` vs 46630) → FAIL; multiple CONFIRMED rows → explicit AMBIGUOUS, never auto-pick; `registrationReady` always false in C8.7A; eslint 0/0; `tsgo --noEmit`; `bun run build`.
- **DB QA (read-only, rollback-safe by containing no writes):** 5 deployment rows / max attempt 5 unchanged; PEPECARTEL still Solana / WATCHLIST_OPEN / NULL / NULL; zero `launch_events` of type `OFFICIAL_CONTRACT_REGISTERED`; unpublished.
- **Stop point:** after C8.7A verification report.

## I. NO-GO factors

- **GO for C8.7A** (read-only evidence and eligibility).
- **NO-GO for C8.7B+** until three decisions are authorized: (1) how launch `chain` maps to a numeric chain id, since "Solana" can never match EVM evidence; (2) that the notification auto-enqueue trigger may be modified; (3) a mainnet-eligible environment, since every existing evidence row is TESTNET and can never be official.

## J. Terminology flags

"Verified Launch Packet" and "Official contract registered" currently describe *operator self-attestation*, not chain verification, and every occurrence carries an explicit disclaimer. `project-verification.ts` correctly labels staff review as "Platform Reviewed". No "audited"/"endorsed" claims exist. Recommendation for C8.7: reserve "VERIFIED DEPLOYMENT" / "VERIFIED CONTRACT" strictly for chain-evidenced registrations and rename the self-attested path to "PROJECT-DECLARED CONTRACT" to keep the two provably distinct.

## Confirmation

No application code, schema, data, migration, secret, Telegram message, or publish state was changed. All database access was SELECT-only. STOP — no build.
