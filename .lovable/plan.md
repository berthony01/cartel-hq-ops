# C8.0 — Cartel Chain Launcher: Read-Only Architecture Audit

Audit only. No code, migrations, packages, deploys, or publishes were produced in this turn.

HEAD at audit time: `8440931e3f0bb3127956e494ecefc68faf0af284`, working tree clean. The C7.3D D2 migration/copy hardening is present and untouched (`supabase/migrations/20260902220631_c73d_d2_activate_project_inbox_delivery_scheduler.sql`).

## 1. VERIFIED EXISTING STATE

Cross-checked against the repository and the live database — each item below was read directly, not inferred.

Launch lifecycle (confirmed live in Postgres):
- `public.launches` has 29 columns including `chain text NOT NULL`, `official_contract_address text NULL`, `contract_registered_at`, `contract_registered_by`, plus one timestamp per lifecycle stage and `launch_watch_token`.
- `transition_launch_status(uuid, text)` is SECURITY DEFINER, locks the row `FOR UPDATE`, and authorizes via `is_workspace_operator(workspace_id, auth.uid())` — that is, workspace `owner` or `admin`. There is no platform-owner bypass in this path.
- `enforce_launch_status_transition()` is a trigger enforcing a strictly linear chain: DRAFT → ANNOUNCED → WATCHLIST_OPEN → LAUNCH_APPROACHING → CONTRACT_PENDING → OFFICIAL_CONTRACT_REGISTERED → LIVE → COMPLETED. No skips, no branches, no rollback. It refuses OFFICIAL_CONTRACT_REGISTERED unless a non-blank `official_contract_address` is already set, and it mints the Launch Watch token at first WATCHLIST_OPEN.
- `set_launch_contract_address(uuid, text)` is the only sanctioned writer of the address: workspace-operator gated, requires status exactly `CONTRACT_PENDING`, trims, and caps at 256 characters. It performs **no** chain-format validation and no chain-side verification.
- `enforce_launch_contract_update()` additionally blocks any address change outside `CONTRACT_PENDING` and blocks replacing an already-registered address.

Frontend: `src/lib/launch-control.ts` (809 lines) is the RPC-only client layer; `src/routes/_authenticated/launch-control.tsx` (2132 lines) is the operator surface. `src/lib/cartel-network.ts` serves the public read side.

Authorization: two independent, already-working ladders — `is_workspace_operator(workspace_id, user_id)` for owner/admin within a tenant, and `is_platform_owner(user_id)` / `has_platform_unrestricted_access(user_id)` reading `platform_user_roles`. The client mirror is `usePlatformAccess` (fails closed on error/pending) and the `ownerOnly` nav flag already used by `/admin`.

## 2. WEB3 / ONCHAIN SURFACE — EXPLICIT FINDING

**None exists anywhere in the repository.** Confirmed by dependency read and full-tree search:
- `package.json` contains no wagmi, viem, ethers, web3.js, WalletConnect, RainbowKit, or any crypto/RPC library. Zero.
- No wallet connection UI, no EVM provider, no signer, no transaction construction or signing.
- No contract deployment, no bytecode, no ABI, no Solidity, no token factory, no liquidity/DEX integration.
- No chain RPC client, no block explorer integration, no transaction receipt polling, no confirmation monitoring, no reorg handling.
- No chain-side verification of `official_contract_address` — the string is operator-asserted and trusted only as "the authenticated project said so", exactly matching existing trust copy.

The `chain` column is a free-text label, not a validated chain identifier. Phase 8 is a genuine greenfield capability on top of a mature lifecycle, not a rebuild.

## 3. REUSE MAP — do NOT duplicate

| Need in Phase 8 | Reuse this |
| --- | --- |
| Launch identity, schedule, lifecycle | `public.launches` + `transition_launch_status` + the status trigger |
| Project identity / publish state | `project_profiles` |
| Contract address of record | `official_contract_address` + `set_launch_contract_address` |
| Watcher notification on contract/live | `launch_events`, `launch_notification_deliveries`, existing scheduler + runner cron |
| Schedule-change comms | `launch_schedule_communications` |
| Public display of the launch | `cartel-network` routes and `get_cartel_network_launch` |
| Tenant authorization | `is_workspace_operator` |
| Owner-only gating | `is_platform_owner` / `usePlatformAccess` / `ownerOnly` nav |
| Owner console surface | `src/routes/_authenticated/admin.tsx` |
| Background/idempotent job pattern | the claim/stale-reclaim/attempt-cap pattern already used by inbox delivery and message cleanup |

## 4. GAPS (what Phase 8 must genuinely add)

1. Client-side wallet connect + signing for Robinhood Chain testnet (new dependency; currently zero).
2. A record of an attempted/confirmed onchain deployment, distinct from `launches`.
3. Server-side, read-only chain confirmation (receipt + N confirmations) before anything is treated as registered.
4. A chain registry (chain id, RPC URL, explorer base, testnet flag) — currently `chain` is only a label.
5. Address-format validation, which `set_launch_contract_address` deliberately does not do today.

## 5. SECURITY RISKS TO DESIGN AGAINST

- **Private keys: never.** No key material may be stored, transmitted, or handled by the database, Edge Functions, or repository — the user's own wallet signs, the server only observes.
- **The database must never be authoritative proof of deployment.** A row saying "deployed" proves nothing; only a fetched chain receipt with sufficient confirmations does. Any status must be derived from a verification read, and must be re-derivable.
- Mainnet/testnet confusion is the highest-severity product risk: a testnet address promoted into `official_contract_address` would be published to real watchers via the existing notification engine. Testnet must be structurally incapable of promoting.
- Client-supplied tx hash or address is untrusted input; verify server-side against the chain before any promotion.
- The existing one-way, non-replaceable contract registration is a safety feature — an automated writer must not weaken it.
- RPC endpoint secrets belong in Supabase secrets, read inside handlers, never in the browser bundle.

## 6. TENANT ISOLATION / RLS

Any new deployment table is workspace-scoped and must carry `workspace_id`, with RLS enabled and grants issued explicitly (the project's tables get no default Data API privileges). Read for workspace operators only; all writes through SECURITY DEFINER RPCs or service-role, never direct table writes from the browser. Chain-verification writes are service-role-only, matching how watcher and delivery rows are already kept out of the browser. Nothing about a deployment should surface on the public Cartel Network until it is confirmed and promoted.

## 7. PROPOSED INTEGRATION SEAMS

Recommendation: **a new subordinate data model linked to `launches`**, not new columns on `launches`. Reasons: a launch may have several attempts (failed, replaced, testnet then mainnet); `launches` is already 29 columns and guarded by two triggers that assume a single one-way registration; and a separate table lets the deployment lifecycle be messy without destabilizing the audited launch lifecycle.

Shape (indicative, not to be built yet): one row per deployment attempt — workspace, launch, chain id, network (`TESTNET` first), deployer wallet address, tx hash, deployed contract address, status (`DRAFT → SUBMITTED → PENDING → CONFIRMED → FAILED`), confirmation count, verified-at, error text.

Promotion rule for `official_contract_address`:
- Manual registration for externally launched projects stays exactly as-is via `set_launch_contract_address`. Unchanged. No regression.
- For Cartel-created deployments, promotion is a **separate** SECURITY DEFINER RPC that succeeds only when: the deployment row is `CONFIRMED` by server-side chain verification, network is mainnet (testnet can never promote), the launch belongs to the same workspace, the launch is in `CONTRACT_PENDING`, and no address is registered yet. It writes the same field with the same one-way guarantee, so the trigger invariants and all downstream notification/public-network behavior hold untouched.
- Testnet deployments in C8.1/C8.2 promote nothing. They exercise wallet → sign → verify → record only.

Lifecycle seam: the launcher is additive. It does not add, remove, or reorder any status, and it does not call `transition_launch_status`. The operator still advances the lifecycle by hand.

## 8. FUTURE ALLOWLIST CANDIDATES (C8.1/C8.2) — not created

Migration: one, creating the deployment table with GRANTs, RLS, workspace-operator read policy, and the verification/promotion RPCs.

Files likely in scope:
- `package.json` (wallet/EVM dependency — explicit authorization required)
- `src/lib/chain-launcher.ts` (new client layer)
- a new owner-only route or an `admin.tsx` section
- `src/integrations/supabase/types.ts` (generated)
- a chain-verification server function or Edge Function, plus its `backend-source` snapshot

## 9. CONFLICTS / UNSAFE ASSUMPTIONS FOUND

- Writing `official_contract_address` outside `CONTRACT_PENDING`, or attempting to replace it, will be rejected by `enforce_launch_contract_update`. Any launcher design that assumes it can write the address at deploy time is wrong.
- `launches.chain` is unvalidated free text, so it cannot currently be trusted to identify a chain; a real chain id must come from the new model, not from that column.
- `set_launch_contract_address` accepts up to 256 characters of arbitrary text — no EVM format check exists today. Do not assume validation you have not added.
- Any hint of a testnet address reaching the public network or the notification engine is a correctness failure, not a cosmetic one.

## 10. NARROWEST GATE FOR THE FIRST TESTNET LAUNCHER

**Platform owner only** (`is_platform_owner`), and additionally workspace-operator on the target launch. Not workspace admin, not member. The launcher stays behind the existing `ownerOnly` Owner Console pattern until testnet behavior is proven end-to-end, then widens deliberately in a later phase.

## C8.0 GO / NO-GO

**GO for C8.1 scoped as owner-only Robinhood Chain TESTNET, with no promotion path to `official_contract_address`.**

Reason: nothing in Phase 8 duplicates existing systems — the onchain surface is verifiably empty — and the additive subordinate-model seam leaves the audited launch lifecycle, contract-registration invariants, notification engine, and tenant isolation untouched.

Two conditions before C8.1 is contracted:
1. Robinhood Chain testnet chain id, RPC endpoint, and explorer base must be supplied as authoritative values; they are not in the repository and must not be guessed.
2. Adding a wallet/EVM dependency to `package.json` needs explicit authorization, since package changes are otherwise prohibited.

**NO-GO for any mainnet deployment or any automated write to `official_contract_address`** until testnet deploy-and-verify is proven against live chain data.
