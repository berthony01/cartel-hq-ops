# Pre-Canary Read-Only Audit — HEAD `7339a73`, worktree clean

No file edited, no SQL executed, no wallet touched, no publish, no Telegram, nothing armed.

## 1. Current production capability switches and verifier write gate

| Constant | File:line | Value |
|---|---|---|
| `MAINNET_DEPLOYMENT_TX_ENABLED` | `src/lib/chain-mainnet-registry.ts:63` | `true as const` (compile-time capability only) |
| `MAINNET_LIQUIDITY_TX_ENABLED` | `src/lib/chain-mainnet-registry.ts:64` | `false as const` |
| `LIQUIDITY_TX_ENABLED` (testnet) | `src/lib/chain-registry.ts:45` | `false as const` |
| `MAINNET_VERIFICATION_STATE_WRITES_ENABLED` | `src/lib/chain-mainnet-verify-apply.ts:30` | `true as const` (verifier/finality writes ACTIVE) |

Runtime execution control is a DB singleton, not source: last authoritative external read was `execution_enabled=false`, `emergency_stop_engaged=true`, `revision=1`, reason `INITIAL_DEFAULT_OFF`. The deployment switch authorizes nothing on its own; the simulation still reports `deploymentAuthorized: false` blamed on `RUNTIME_EXECUTION_CONTROL_AND_SEND_WINDOW`.

## 2. A–G flow — DB state vs wallet

Route `src/routes/_authenticated/mainnet-canary.tsx` (owner-only, linear, no timer/render-driven action).

| Stage | Server function | Effect |
|---|---|---|
| A — exact production intent | `createCanaryDeploymentAttempt` | **DB write**: creates one DRAFT production `launch_chain_deployments` row. No wallet. |
| B — managed pre-sign / economic evidence | `presignMainnetTokenDeployment` | Managed RPC reads + **DB write**: one ISSUED `launch_chain_production_presign_authorizations` row. No wallet. |
| C–E — typed confirm, claim, arm | `claimMainnetDeploymentHandoff`, `armCanaryExecution` | **DB writes**: presign ISSUED→CLAIMED; arm compare-and-swap bumps the control singleton to `execution_enabled=true`/`emergency_stop_engaged=false` (revision+1) and creates one immutable ~30s canary permit. No wallet. |
| F — send window + one-shot send | `authorizeMainnetSendWindow`, then `src/lib/chain-mainnet-wallet.ts:371` | **DB write** for the send-window issuance row; then the **only wallet touch** in the whole flow: exactly one `eth_sendTransaction`. |
| G — persist, reconcile, verify | `persistMainnetDeploymentTxHash`, `getMainnetDeploymentReconciliationSnapshot`, `verifyMainnetChainDeployment` | **DB writes** for tx hash and verifier/finality state; managed RPC reads. No wallet. |
| any time | `engageCanaryEmergencyStop` | **DB write**, one-way stop. |

Every one of these is behind `.middleware([requireSupabaseAuth])` plus a server-side `is_platform_owner` re-check.

## 3. PEPECARTEL production supply / deployer / recipient

**Not defined anywhere in repo, config or docs.** The canary route initialises `deployer`, `recipient`, `name`, `symbol`, `supply` as empty strings (lines 85–89) with no defaults, no env var, no seeded row. Only the *bounds* exist (`chain-mainnet-canary-intent.ts`: base-units supply ≥ 10^18, ≤ 10^30, divisible by 10^18; symbol `^[A-Z0-9]{2,11}$`). Docs mention "a funded deployer wallet" as a prerequisite but never an address. These three values must be supplied by you; I will not guess them.

## 4. Does the final send require your browser wallet?

**Yes, necessarily.** `chain-mainnet-wallet.ts` reads `window.ethereum` inside `getProvider()` and refuses when `typeof window === "undefined"`. The single `eth_sendTransaction` is issued from the browser against the injected provider, using a bounded server-issued envelope validated key-for-key (exactly the EIP-1559 or exactly the LEGACY key set, `to` always absent). The helper never calls `wallet_switchEthereumChain`/`wallet_addEthereumChain`, so the wallet must already be on Robinhood Chain 4663 and unlocked on the deployer account.

## 5. Server-side signer / private key path

**None.** Repo-wide search finds no `privateKey`, `PRIVATE_KEY`, `signTransaction`, `eth_sendRawTransaction`, `createWalletClient`, or any keystore/HSM path. Server functions touch only managed RPC reads (`process.env[ROBINHOOD_MAINNET_RPC_URL]`, read inside handlers) and Supabase RPCs. The only signing authority in the system is your wallet.

## 6. Managed RPC prerequisite

`ROBINHOOD_MAINNET_RPC_URL` (server-only, referenced by name at `chain-mainnet-registry.ts:51`) must be configured and healthy. It is read inside handlers in presign, verify, reconciliation and health, never in a `VITE_*` var, never returned or logged. The public diagnostic endpoint is never an authoritative fallback — if the managed endpoint is unavailable, presign and verification fail closed rather than degrade.

## 7. Safest next action after this audit

Before anything that writes state or arms execution:

1. Confirm the managed RPC health probe passes against chain 4663 (read-only, no DB write).
2. You supply the three missing values in writing: exact production total supply in base units, deployer address, recipient address — and confirm the deployer is funded with enough native ETH on chain 4663 to cover `gas_limit × max_fee`.
3. Then the smallest safe next checkpoint is **Stage A only**: create the single DRAFT production deployment row and stop, so the recorded intent can be independently inspected in live Supabase before any presign, arm or send.

Arming runtime execution, issuing a permit or send window, and the one-shot send remain separate, explicitly authorized checkpoints. STOP.
