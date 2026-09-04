# C8.6 Liquidity Integration — Read-Only Architecture Audit

Audit only. No code, migrations, packages, wallet requests, transactions, or publishing were performed.

## 1. Start gate — CONFIRMED

- HEAD `b9968902d243200eb513a7ff5df0d949f90d1580`, working tree clean (`git status --porcelain` empty).
- Attempt #5 `ea54b0cc-4800-4a48-b03d-bc4f62c9083e`: status `CONFIRMED`, kind `FIXED_SUPPLY_ERC20`, artifact `cartel-fixed-erc20-v1`, chain 46630 / TESTNET, contract `0x7fee942a9200ae5a3f64315be53039b38bc5b8fa`, 2235 confirmations, CTEST / 18 / `1000000000000000000000000` / recipient `0x1fc16e...52b68`.
- Launch `9f9af215-66ee-4a10-92db-617b61fb7fd3` PEPECARTEL / $PCART: chain `Solana`, status `WATCHLIST_OPEN`, `official_contract_address` NULL, `contract_registered_at` NULL. Unchanged.

## 2. Current state — what exists and must be reused

| Surface | File / object | Reuse |
|---|---|---|
| Chain registry (testnet-only constant, no mainnet entry) | `src/lib/chain-registry.ts` | Extend with liquidity infra addresses only after external verification |
| Frozen token artifact | `src/lib/cartel-fixed-erc20.artifact.ts`, `contracts/CartelFixedSupplyToken.sol` | Reuse verbatim; frozen, no contract change |
| Wallet layer (EIP-1193, injected only, no server signer) | `src/lib/chain-launcher.ts` | Reuse `getInjectedProvider`, `connectWallet`, `readAccount`, `readChainId`, `readBalanceWei`, `WalletError`, `isUserRejection` |
| Deterministic preflight + fingerprint + 90s TTL + fail-closed fee/balance gate | `src/lib/chain-simulation.ts`, `src/components/chain/SimulationReviewCard.tsx` | Reuse the pattern for a liquidity preflight; do not fork a second simulation engine |
| Receipt derivation (platform record vs on-chain evidence separated) | `src/lib/launch-receipt.ts`, `src/components/chain/LaunchReceiptCard.tsx` | Reuse the receipt shape and provenance model |
| Independent server verifier (authenticated server fn, RLS re-check, service-role RPC write) | `src/lib/chain-verify.functions.ts` | Reuse the exact trust model for liquidity verification |
| Attempt/receipt persistence | `launch_chain_deployments` + `create_/submit_/abandon_/apply_..._verification` RPCs, text mirrors for big integers | Reuse pattern, see section 7 |
| Operator UI | `src/routes/_authenticated/chain-launcher.tsx` | Host the liquidity panel here; no new route |

**No liquidity code or schema exists.** Repository-wide search for `uniswap`, `liquidity`, `WETH`, `poolKey`, `tickSpacing`, `nonfungible` returns only disclaimer copy. `viem ^2.56.3` is already a dependency — no new package is needed for encoding, ABI work, or read-only calls. Duplicate-system risk is therefore concentrated in one place: do not build a second simulation engine, a second verifier, a second receipt model, or a second attempts table.

## 3. Infrastructure availability — BLOCKER

Read-only `eth_getCode` probe on chain 46630:

```text
Permit2  0x000000000022D473030F116dDEE9F6B43aC78BA3   CODE PRESENT (18306 hex chars)
UniswapV2Factory  0x5C69bEe7...cc5aA6f                 NO CODE
UniswapV3Factory  0x1F98431c...31F984                  NO CODE
V3 NonfungiblePositionManager 0xC36442b4...11FE88      NO CODE
UniversalRouter   0x66a9893c...1dBA8Af                 NO CODE
V4 PoolManager    0x00000000...3dE08A90                NO CODE
V4 PositionManager 0xbD216513...FF64ee9e               NO CODE
```

Permit2 is deployed deterministically and its presence does **not** prove any Uniswap router, factory, PoolManager or PositionManager exists here. The repository holds no authoritative Uniswap deployment address for 46630, and none will be invented. **External verification of official Uniswap deployment addresses on Robinhood Chain Testnet 46630 — plus the canonical WETH9 address — is a hard prerequisite before any liquidity transaction is enabled.** Each address must be confirmed by `eth_getCode` presence plus an on-chain identity read (for example factory `owner()`/`poolManager()`, WETH `symbol()`/`decimals()`) at build time, not trusted from a document.

No custom AMM, router, factory, pair, or position contract will be written under any circumstance.

## 4. Token artifact compatibility

`CartelFixedSupplyToken` is stock OpenZeppelin 5.6.1 ERC20: standard `approve`/`transferFrom`, 18 decimals, no fee-on-transfer, no hooks, no blacklist, no pausing, no rebasing, no transfer restrictions. It is compatible with Uniswap v2, v3, and v4 style liquidity provision with **zero contract changes**. The artifact stays frozen; nothing in C8.6 recompiles or edits Solidity.

## 5. Plan vs transaction — hard separation

- **Liquidity PLAN / readiness / quote (C8.6A):** pure, zero-persistence, read-only. No `approve`, no pool creation, no `eth_sendTransaction`. Produces a fingerprinted, TTL-bounded `LiquidityPlan` mirroring the C8.4 preflight contract.
- **Liquidity TRANSACTION (C8.6B):** remains hard-blocked behind a compile-time constant `LIQUIDITY_TX_ENABLED = false` until infrastructure addresses, pair, fee tier/tick spacing, price encoding, slippage, approval strategy, and signing flow are each explicitly reviewed and authorized. In C8.6A the button does not exist — not disabled, absent.

## 6. Proposed phases

- **C8.6A — Liquidity Readiness & Plan (first build, transaction-free).** Registry entries only for addresses that pass live identity probes; a pure `liquidity-plan` module; a review card; a panel in the existing chain launcher. No DB, no RPC, no approvals, no signing.
- **C8.6B — Testnet liquidity transaction.** Exact-amount approval, pool create/initialize, add-liquidity, all browser-wallet signed. Requires its own contract and start gate.
- **C8.6C — Server verification + Liquidity Receipt.** Independent server-side verification and receipt rendering.

## 7. Minimum database model (C8.6B/C, not C8.6A)

`launch_chain_deployments` is a token-deployment table (`deployment_kind`, `artifact_id`, `token_*`, `verified_token_*`); overloading it with pool/position/pair columns would corrupt its contract. Recommendation: one new subordinate table `launch_chain_liquidity_attempts`, modelled *exactly* on the existing pattern — `workspace_id`, `launch_chain_deployment_id` FK, `attempt_number`, `client_request_id` idempotency, `chain_id`, `network_environment`, `status` state machine (`DRAFT|APPROVAL_SUBMITTED|SUBMITTED|PENDING|CONFIRMED|FAILED|ABANDONED`), `tx_hash`, `block_number/hash`, `confirmations`, plus `GENERATED ALWAYS AS STORED` text mirrors for every amount and liquidity/position value. Same privilege posture: RLS platform-owner AND workspace-operator for SELECT; all writes through service-role-only RPCs; internal trigger functions with EXECUTE revoked. No second source of truth: the chain remains authoritative and the row records evidence.

## 8. Server-side verification (C8.6C)

Authenticated server function in the `chain-verify.functions.ts` mould, trusting nothing from the browser: re-read the row through the caller's RLS context; pin chain 46630; fetch tx and receipt independently; assert `tx.from` equals recorded operator, `tx.to` equals the pinned verified router/manager address (never a browser-supplied address), receipt `status === success`, confirmations at or above `REQUIRED_CONFIRMATIONS`; re-derive the expected pool/pair address deterministically and compare with the address read from the factory/manager; read pool token0/token1, fee tier, and reserves/liquidity on chain; read the operator's resulting LP balance or position; write the verified values only through the service-role RPC, using exact text mirrors.

## 9. Threat model and required mitigations

| Threat | Mitigation |
|---|---|
| Wrong/spoofed router or factory | Addresses are frozen code constants, identity-probed on chain at build time; never user input, never from DB |
| Malicious approval target | `approve` spender restricted to the single pinned address; any mismatch fails closed |
| Unlimited allowance | Exact-amount approval only; never `MaxUint256`; show current allowance, and require reset-to-zero before re-approving a different amount |
| Wrong token / wrong recipient | Token pinned to the CONFIRMED attempt's `contract_address`; recipient pinned to the connected signer |
| Price inversion / token ordering | Canonical sort by address; price encoded after sorting; display the human price both ways for confirmation |
| Zero or absurd initial price | Bounded validation with explicit refusal; no silent clamping |
| Slippage abuse | Explicit min amounts and a bounded deadline; defaults conservative, no unlimited slippage |
| Replay / double-click | `client_request_id` idempotency plus in-flight lock, as in C8.5 |
| Tx replacement / reorg | Confirmation floor of 5, block hash recorded, verifier re-reads chain and never trusts prior state |
| Stale quote | Fingerprint plus 90s TTL, invalidated on account/chain/param change |
| Partial approve-then-add | Distinct persisted statuses so an interrupted sequence is recoverable, never assumed complete |
| Browser crash / DB write fails after broadcast | Reuse the C8.5 sessionStorage recovery record with validate-on-write and delete-on-parse-failure |
| Unsupported chain / RPC inconsistency | Hard chain pin; missing or contradictory RPC data yields no PASS |

## 10. C8.6A allowlist (first build only)

**Allowed to create:** `src/lib/liquidity-plan.ts`, `src/components/chain/LiquidityPlanCard.tsx`.
**Allowed to modify:** `src/lib/chain-registry.ts` (verified infra addresses + `LIQUIDITY_TX_ENABLED=false` only), `src/routes/_authenticated/chain-launcher.tsx` (mount the panel).

**Prohibited surfaces:** any migration, any RPC, `src/lib/chain-launcher.ts`, `chain-simulation.ts`, `chain-verify.functions.ts`, `launch-receipt.ts`, the token artifact, `contracts/`, `package.json`/lockfile, all Telegram/Launch Watch/broadcast code, `launches.official_contract_address`, any lifecycle transition, any mainnet 4663 path, any publish.

**Acceptance tests:** deterministic plan fingerprint across repeated runs; canonical token ordering stable under input order; refusal on zero/absurd price; TTL expiry invalidates the plan; account or chain change invalidates the plan; no `eth_sendTransaction`, `approve`, or write RPC reachable from the new modules; disclaimer copy states TESTNET ONLY and no endorsement; `eslint` (no fix), `tsgo --noEmit`, and `bun run build` pass.

## 11. Verdict

**GO for C8.6A (readiness/plan only). NO-GO for C8.6B/C until the blocker clears.**

Blocker: no authoritative Uniswap deployment addresses (and no WETH9 address) for Robinhood Chain Testnet 46630 exist in this repository, and the canonical mainnet addresses carry no code on 46630. These must be externally verified and on-chain identity-probed before any liquidity transaction is enabled.

Audit complete. STOP — no build.
