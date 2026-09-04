# C8.1 — Cartel Chain Launcher: Architecture Contract (Testnet Only)

Architecture only. No app code, no migration, no packages, no deploy/publish in this turn. Builds on the C8.0 audit (HEAD `8440931`, clean tree; C7.3D D2 present and untouched).

C8.0 confirmed: **zero** wallet/EVM/provider/signing/deployment/explorer/monitoring code exists anywhere in the repo. `launches.chain` is unvalidated free text. `set_launch_contract_address` is workspace-operator gated, requires status `CONTRACT_PENDING`, caps 256 chars, does no chain validation; `enforce_launch_contract_update` makes registration one-way.

## A. Trust boundaries

Four zones, one direction of trust:
1. **Browser + user wallet** — sole holder of keys, sole signer. Produces a tx hash. Treated as an untrusted claim.
2. **Application DB** — records *workflow* only (attempts, statuses, timestamps). Never canonical proof.
3. **Server verifier** — the only component permitted to move an attempt to CONFIRMED, and only after reading the chain itself.
4. **Chain RPC** — the sole source of truth. Every CONFIRMED state must be re-derivable by replaying the receipt read.

Absolute invariants: no private key, seed, custody, server-side signer, or deployer key exists in any layer. No testnet artifact can ever reach `official_contract_address`, `launch_events`, or `launch_notification_deliveries`. No deployment ever calls `transition_launch_status`.

## B. Chain registry — code/config, not a table

Recommendation: a frozen TypeScript constant in `src/lib/chain-registry.ts`, mirrored by a hardcoded allowlist inside the verifier. **Not** a DB table for C8.1/C8.2.

Reason: a table is a mutable attack/mistake surface — one row edit could introduce mainnet. A code constant makes mainnet absence a property of the deployed artifact, reviewable in a diff.

Single entry:
- chain_id `46630` (numeric, canonical identity)
- name `Robinhood Chain Testnet`, native token `ETH`
- rpc_url `https://rpc.testnet.chain.robinhood.com`
- explorer `https://explorer.testnet.chain.robinhood.com`, verification API `.../api/`
- network_environment `TESTNET`, required confirmations (default 5, config knob)

Chain id `4663` (mainnet) is **not present in the registry at all** — not disabled, absent. `launches.chain` free text is never consulted for routing or verification.

RPC URL is read from an env override falling back to the public endpoint, so a managed provider drops in later with zero data-model change.

## C. Subordinate record: `public.launch_chain_deployments`

Name follows repo convention and is collision-free. One row per **attempt**; never updated in place across attempts.

Columns: `id` uuid pk; `workspace_id` uuid not null; `launch_id` uuid not null → `launches(id)`; `attempt_number` int not null; `client_request_id` text not null (browser-generated idempotency key, unique per launch); `chain_id` bigint not null; `network_environment` text not null; `deployer_address` text not null; `tx_hash` text; `contract_address` text; `status` text not null; `block_number` bigint; `block_hash` text; `confirmations` int not null default 0; `submitted_at`, `verified_at`, `last_checked_at` timestamptz; `failure_code` text; `failure_detail` text (bounded); `created_by` uuid; `created_at`/`updated_at` timestamptz not null.

Deliberately excluded as overbuild for C8.2: gas accounting, ABI/bytecode blobs, token metadata (that is C8.3), reorg-history log, multi-chain routing tables.

Constraints: `chain_id = 46630` and `network_environment = 'TESTNET'` enforced by CHECK for this phase; unique `(launch_id, client_request_id)`; unique `(chain_id, tx_hash)` where tx_hash not null; partial unique on at most one non-terminal attempt per launch.

## D. Attempt state machine

`DRAFT → SUBMITTED → PENDING → CONFIRMED` with `FAILED` and `ABANDONED` as terminals.

- DRAFT: row created server-side before the wallet is invoked (gives an idempotency anchor if the browser dies).
- SUBMITTED: browser reports a tx hash; still an untrusted claim.
- PENDING: verifier has seen the tx on chain but confirmations < required.
- CONFIRMED: receipt fetched, `status = 1`, contract address present, confirmations ≥ required, deployer matches. Only the verifier writes this.
- FAILED: receipt `status = 0`, tx replaced/dropped past deadline, deployer mismatch, or chain mismatch. Carries `failure_code`.
- ABANDONED: user cancelled in wallet, or a stale non-terminal attempt is retired.

Rules: transitions are forward-only and enforced by a trigger mirroring the existing `enforce_launch_status_transition` pattern. Terminal rows are immutable. **Retry creates a new row with `attempt_number + 1`** — history is never overwritten. CONFIRMED is unreachable without a verifier-supplied receipt.

## E. Transaction flow (testnet only)

1. Owner opens the launcher, picks a launch in their workspace, connects wallet.
2. Client asserts `chainId === 46630`; wrong chain → prompt switch, refuse to proceed. No mainnet path exists in the UI or the registry.
3. Server RPC creates the DRAFT attempt (authorization checked here) and returns its id.
4. Wallet signs and broadcasts. User cancellation → attempt marked ABANDONED.
5. Client reports `tx_hash` → server moves DRAFT to SUBMITTED. Hash format validated; content still untrusted.
6. Verifier independently queries the chain: `eth_getTransactionReceipt`, current block height, and the tx's `from`. It does **not** trust any client-supplied address, block, or status.
7. PENDING until confirmations ≥ required; then CONFIRMED with the receipt's `contractAddress`. Contract address is only ever taken from the receipt.
8. Nothing is promoted. Nothing notifies. No lifecycle transition.

Recovery after browser close: the attempt row plus tx hash lets the verifier finish independently; reopening the page re-reads current state.

## F. Server verification surface

An **authenticated RPC + Edge Function pair**, matching the project's existing patterns:
- SECURITY DEFINER RPCs (fixed `search_path`, authenticated-only EXECUTE) own authorization and all state writes: create attempt, record submitted hash, apply verified receipt, abandon.
- An Edge Function (`verify_jwt=true`) owns the outbound chain read, because Postgres must not make outbound HTTP for this. It authenticates the caller, re-checks platform-owner + workspace-operator, queries the registry RPC endpoint, then calls the apply-receipt RPC.

The RPC endpoint and any future managed-provider key live in Edge Function secrets, read at request time. The browser never sees a secret, never sees service-role, and never writes the deployment table directly.

Every authorization check is server-side and repeated in the Edge Function — UI gating is UX only.

## G. RLS, grants, tenant isolation

RLS enabled; explicit GRANTs (this project gets no default Data API privileges). SELECT granted to `authenticated` under a policy requiring `is_platform_owner(auth.uid()) AND is_workspace_operator(workspace_id, auth.uid())`. **No** browser INSERT/UPDATE/DELETE — all writes flow through the SECURITY DEFINER RPCs. `GRANT ALL` to `service_role` for the verifier.

`workspace_id` must be derived server-side from `launches.workspace_id`, never accepted from the client, and a trigger enforces the pair matches — this is the cross-tenant defence.

Browser-readable fields: status, chain_id, network_environment, tx_hash, contract_address, confirmations, block_number, attempt_number, timestamps, failure_code. Nothing sensitive exists in this table by construction. Deployment rows never surface on the public Cartel Network.

## H. Anti-confusion: testnet cannot be promoted

Defence in depth, none of it cosmetic:
1. Registry contains no mainnet entry.
2. CHECK constraint pins `chain_id = 46630` / `network_environment = 'TESTNET'`.
3. **No code path in C8.2 writes `official_contract_address`.** No promotion RPC is created in this phase at all — the capability does not exist to be misused.
4. The existing `enforce_launch_contract_update` trigger still blocks writes outside `CONTRACT_PENDING`, independently.
5. Any future promotion RPC (C8.4+) must reject `network_environment <> 'MAINNET'` as its first check.
6. UI labels every artifact TESTNET and states plainly it is not the official contract.

Manual `set_launch_contract_address` for externally launched projects is untouched. Launch Watch, `launch_events`, and deliveries are untouched.

## I. UI seam

New owner-only route `src/routes/_authenticated/chain-launcher.tsx`, added to nav with the existing `ownerOnly: true` flag alongside Owner Console — the same pattern `/admin` uses, gated by `usePlatformAccess({ fresh: true })` failing closed.

Launch Control remains the sole lifecycle authority and is **not modified in C8.2**; at most a later phase adds a read-only reference. Keeping the launcher on its own route avoids touching the 2132-line Launch Control file and keeps the C8.2 diff auditable.

## J. Wallet approach

**Recommendation: native injected EIP-1193 + `viem` only.** No WalletConnect, no RainbowKit, no wagmi.

Rationale: the audience is a single platform owner on testnet using a browser wallet. `viem` is one well-audited, tree-shakeable dependency covering both the browser request path and the server-side receipt read, so client and verifier share one code path. A full wallet stack adds many transitive dependencies, relay infrastructure, and remote session surface for zero benefit at this scale. Broader wallet support can be added later without changing the data model or the verifier.

## K. C8.2 implementation allowlist (candidates — not created now)

- `package.json` — add `viem` only (needs explicit authorization)
- `supabase/migrations/<ts>_c8_2_launch_chain_deployments.sql` — one migration: table, GRANTs, RLS, policy, CHECKs, state trigger, the four RPCs
- `src/lib/chain-registry.ts` (new)
- `src/lib/chain-launcher.ts` (new client layer)
- `src/routes/_authenticated/chain-launcher.tsx` (new)
- `src/lib/nav.ts` (one owner-only entry)
- `supabase/functions/chain-verify/index.ts` + `deno.json`, and its `backend-source/edge-functions/chain-verify/` snapshot per the repo's mirror rule
- `src/integrations/supabase/types.ts` (generated)

Explicitly out of scope: `launches`, `set_launch_contract_address`, Launch Control, Launch Watch, notifications, Project Inbox, Telegram, Cartel Network.

## L. C8.2 verification matrix

Non-owner denied; owner without workspace-operator denied; cross-tenant launch_id denied; wrong chain id rejected client- and server-side; mainnet id rejected by CHECK; wallet cancellation → ABANDONED; insufficient gas → FAILED with code; tx replaced/dropped → FAILED, not stuck; receipt `status = 0` → FAILED, never CONFIRMED; forged/nonexistent tx hash → never CONFIRMED; deployer address mismatch → FAILED; duplicate `client_request_id` → same row, no second attempt; duplicate verifier callback idempotent; confirmations below threshold stay PENDING; reorg re-check does not silently keep a stale CONFIRMED; browser-close recovery resumes correctly; **zero** Telegram sends; **zero** writes to `official_contract_address`; **zero** launch status transitions; `bunx tsgo --noEmit` and `bun run build` pass; rollback-only SQL QA leaves no residue.

## M. Deferred to C8.3

The ERC-20 token factory is entirely C8.3: token contract source, supply/decimals/ownership semantics, mint/burn authority, liquidity, verification-on-explorer, and any mainnet capability. C8.2 must **not** partially implement any of it.

C8.2 proves plumbing only — wallet connect, network assertion, attempt record, signed deployment, independent receipt verification — using a harmless deterministic minimal test contract with no token semantics. No production token, no user-supplied token parameters.

## GO / NO-GO for C8.2

**GO**, scoped exactly as above: owner-only, testnet-only, no promotion path, non-token test artifact.

One authorization needed before the build contract: adding `viem` to `package.json`, since package changes are otherwise prohibited.

**NO-GO** for any mainnet path, any ERC-20 factory work, or any `official_contract_address` write in C8.2.
