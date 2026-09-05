# C8.7 Cartel Verified Launch — Controlled Surgical Audit (read-only)

Zero code, schema, data, migration, secret, Telegram or publish change was made this turn. All database access was SELECT / catalog metadata only.

## 0. State at audit time

- `git rev-parse HEAD` = `c4e3711c15a2b6b0332b7ee92e3daca4e7c0c694`, working tree clean, unpublished.
- **SHA drift disclosure:** the last reported C8.7B parity commit was `ed042c910a0f282395ed8b8b658d6ebb0e165b21`. `git diff ed042c9 c4e3711` is **empty** — `c4e3711` ("Harden ed 2 files, only 2") is a platform auto-commit with an identical tree. No content changed.

## 1. Original C8.7 scope recovered from project history

Source: message #839 (2026-09-04 23:41) defined C8.7 "Cartel Verified Launch"; #847, #849, #851, #853, #855, #857, #859 executed and closed the subphases.

Recovered subphase ladder (#839 §G, explicitly named):

| Label | Intended behavior | Status per history |
|---|---|---|
| C8.7A | Read-only eligibility evaluator + deployment evidence panel in Launch Control. Zero writes, zero schema. | Defined, built, closeout-audited, hardened |
| C8.7B | Guarded, owner-only, evidence-bound official contract registration. Address derived from evidence, human input is confirmation only. Status unchanged, no event/notification/Telegram in the same transaction. | Defined, built, closed, ACL-corrected, parity-hardened |
| C8.7C | Launch Watch notification integration — decouple notification enqueue from the registration transaction; explicit operator-triggered "notify watchers". | **Defined only. Never authorized, never started.** Every prompt from #847 onward says "do not start C8.7C". |
| C8.7D | Telegram / official group broadcast integration reusing `telegram-group`. | Defined only. Not started. |
| C8.7E | Correction workflow, audit ledger, terminology hardening. | Defined only. Not started. |

Governing acceptance principles from #839: blockchain is authoritative; "Verified" means specific evidence was verified, never safety/endorsement; a TESTNET deployment may never become official or trigger sends; registration must be idempotent and replace-protected; no lifecycle transition / watcher notification / Telegram send in the same transaction as registration; reuse existing engines; preserve tenant isolation; no custody.

**Last confirmed continuation point:** end of C8.7B parity closeout hardening. Next authorized-but-unstarted slice is C8.7C.

## 2. Implemented, with evidence

Repository delta from the C8.7 gate `b5ad35a` to HEAD — 11 paths, 1995 insertions:

- `src/lib/launch-verified-eligibility.ts` (new, 807 lines) — pure evaluator, no Supabase import, no I/O. Carries the hardened checks: `approved_kind`, `verified_at`, `block_number`, full fixed-supply token-state incl. recipient balance, canonical lowercase hex patterns for `tx_hash` / `contract_address`, fail-closed partial-registration detection, explicit AMBIGUOUS with no auto-selection.
- `src/components/cartel/VerifiedDeploymentEvidencePanel.tsx` (new) — per-deployment blocking-check display.
- `src/components/cartel/VerifiedContractRegistrationPanel.tsx` (new) — the only registration surface; no data access, render-derived selection/confirmation, retyped-address confirmation, owner-only presentation hint, permanence and non-endorsement wording.
- `src/routes/_authenticated/launch-control.tsx` — mounts both panels, `registerContractMutation`, three-field `contractRegistered` derivation.
- `src/lib/launch-control.ts` — `registerVerifiedLaunchContract(launchId, deploymentId, expectedContractAddress)`.
- `src/integrations/supabase/types.ts` — `launches.official_contract_deployment_id`.

Database (live, verified in catalog this turn):

- `launches.official_contract_deployment_id` uuid FK → `launch_chain_deployments(id)` ON DELETE RESTRICT, indexed, nulled by `launches_before_insert`.
- `launch_chain_deployments_network_pair_chk`: exactly (46630, TESTNET) or (4663, PRODUCTION).
- `assert_launch_contract_evidence(uuid,uuid,text,uuid)` SECURITY DEFINER — enforces launch/workspace match, `FIXED_SUPPLY_ERC20`, frozen artifact `cartel-fixed-erc20-v1`, PRODUCTION/4663 only, declared-chain match via `launch_chain_label_is_robinhood_mainnet`, `CONFIRMED`, canonical tx/address hex, ≥5 confirmations, block + verified_at present, no failure fields, verified-vs-intent token identity with decimals 18, supply and recipient balance equal to intent.
- `register_verified_launch_contract(...)` SECURITY DEFINER, `FOR UPDATE` lock, `is_workspace_owner` gate, typed-address confirmation, derives address server-side. ACL `postgres, authenticated` only.
- Trigger `enforce_launch_contract_update_trigger` BEFORE UPDATE OF the four registration columns; guard function SECURITY DEFINER, ACL `postgres=X/postgres` only.
- `assert_launch_contract_evidence` and `launch_chain_label_is_robinhood_mainnet` ACL `postgres=X/postgres` only — unreachable directly.
- Legacy `set_launch_contract_address` body is now a hard `raise exception` stub. Free-text registration is retired.
- `enforce_launch_status_transition` refuses `OFFICIAL_CONTRACT_REGISTERED` unless address + deployment id + registered_at are all present.

Live invariants re-checked, unchanged: deployments 5, max attempt 5, launch_events 3, deliveries 4, telegram_group_announcements 7; PEPECARTEL `9f9af215…` chain `Solana`, status `WATCHLIST_OPEN`, all four registration fields NULL.

## 3. Partial or missing

Nothing in C8.7A/C8.7B is partial. Genuinely missing, all by design and unauthorized:

1. **C8.7C — communication decoupling.** Trigger `launches_enqueue_notification_events` (AFTER UPDATE OF status) still fires in the same transaction as the `OFFICIAL_CONTRACT_REGISTERED` lifecycle write, and `launch_events_enqueue_deliveries` fans out subscriber deliveries immediately. Registration itself is now clean, but the *subsequent status transition* still auto-sends. #839's "no notification in the same transaction" principle is satisfied for registration, not for the transition.
2. **C8.7D** — no operator-triggered group broadcast for a registered contract.
3. **C8.7E** — no correction workflow for a wrongly registered address (immutability is absolute), no decision ledger recording why an address was accepted, and the "Verified Launch Packet" wording still describes a project-declared contract.

## 4. Did a recent C8.7 build execute despite a timeout?

Yes, once, earlier and already handled: commit `9688ac1` "Halted C8.7B mid-phase" was a timed-out partial run; message #851 explicitly resumed from that partial commit rather than repeating it. Since then no timed-out or duplicated build exists. The only anomaly at HEAD is the empty-diff auto-commit noted in §0. **No unexecuted or double-executed C8.7 work.**

## 5. Exact surfaces involved

Files: `src/lib/launch-verified-eligibility.ts`, `src/lib/launch-control.ts`, `src/routes/_authenticated/launch-control.tsx`, `src/components/cartel/VerifiedDeploymentEvidencePanel.tsx`, `src/components/cartel/VerifiedContractRegistrationPanel.tsx`, `src/integrations/supabase/types.ts`.

Migrations: `20260905005615_…`, `20260905010704_…`, `20260905012833_…`, `20260905013812_…`.

DB objects: `launches.official_contract_deployment_id`; `launch_chain_deployments_network_pair_chk`; functions `assert_launch_contract_evidence`, `launch_chain_label_is_robinhood_mainnet`, `register_verified_launch_contract`, `enforce_launch_contract_update`, `launches_before_insert`, `enforce_launch_status_transition`, `set_launch_contract_address` (retired stub); triggers `enforce_launch_contract_update_trigger`, `launches_enqueue_notification_events`, `launch_events_enqueue_deliveries`.

## 6. Findings

- **Security:** registration is fail-closed at the database, owner-only, and re-derived independently of the client. Helper functions have no `authenticated` EXECUTE. The legacy free-text path is dead. No new advisory attributable to C8.7 remains open.
- **Tenant isolation:** preserved — evidence must match both `launch_id` and `workspace_id`, and authority is `is_workspace_owner`, stricter than the operator-level check it replaced.
- **Routing:** no route added; registration lives inside the existing authenticated Launch Control route.
- **State:** registration does not move the lifecycle; the separate transition now refuses to advance without a complete evidence-bound registration. Partial registration state is treated as registered (fail-closed) by both DB guard and UI.
- **Edge cases:** multiple eligible candidates stay AMBIGUOUS with no auto-selection; uppercase-hex bypass closed; confirmation input re-arms on launch/candidate change.
- **Integration:** unchanged Telegram, Launch Watch, broadcast and inbox surfaces — which is exactly why item §3.1 remains open.
- **Terminology:** "Official contract registered by the authenticated project", explicitly not a safety check, audit or endorsement. No "safe"/"audited" claim exists. The C8.7A audit's recommendation to rename the self-attested path is deferred to C8.7E.
- **Operational reality:** every existing evidence row is TESTNET/46630 and PEPECARTEL's declared chain is `Solana`, so no live launch can register today. That is intended fail-closed behavior, not a defect.

## 7. Smallest safe next delta

**C8.7C — separate registration from communication.** Make the watcher notification for `OFFICIAL_CONTRACT_REGISTERED` an explicit, owner/operator-triggered, idempotent action instead of a trigger side effect, reusing `launch_events` / `launch_notification_deliveries` / the existing `launch-notifications` worker. No new send engine, no new table if an existing event/idempotency key suffices.

This requires the three NO-GO decisions already flagged and still unresolved: (1) authorization to modify `enqueue_launch_lifecycle_notification_events`; (2) whether historical automatic behavior for other lifecycle states must be preserved verbatim; (3) how a launch whose declared chain can never match EVM evidence (e.g. `Solana`) should be handled operationally.

Until those are authorized, the correct action is **no delta**.

## 8. Proposed allowlist for that delta (not authorized yet)

- Migrate: exactly one migration altering `enqueue_launch_lifecycle_notification_events` plus one owner-gated notify RPC.
- Modify: `src/lib/launch-control.ts`, `src/routes/_authenticated/launch-control.tsx`, `src/integrations/supabase/types.ts`.
- Create: at most one panel component for the explicit notify action.
- Prohibited: `chain-registry.ts`, chain launcher/verifier/liquidity, contracts, edge functions, `telegram-*`, packages/lockfiles, secrets, public network routes, `.lovable/**`, publish.

## 9. Verification required before C8.7 can close

Rollback-only DB proof that: the registration transaction still creates zero events/deliveries; the lifecycle transition no longer auto-enqueues; the explicit notify action enqueues exactly once and is idempotent on retry; non-owner and cross-workspace callers are refused; muted/stopped watchers receive nothing. Plus deterministic evaluator tests unchanged, ESLint zero on touched files, `bunx tsgo --noEmit`, `bun run build`, live invariants re-checked (5 / 5 / 3 / 4 / 7, PEPECARTEL unchanged), security advisor delta, clean tree, unpublished.

## 10. Conclusion

**C8.7 INCOMPLETE.** C8.7A and C8.7B are complete, verified and closed against their recovered acceptance criteria. C8.7C, C8.7D and C8.7E were defined in the original scope, were never authorized, and were never started; C8.7C additionally carries three unresolved decisions that keep it NO-GO until you rule on them.

Stopping. No build.
