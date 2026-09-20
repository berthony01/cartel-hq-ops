# PCART-L1 Robinhood / Uniswap / Safe Compatibility Manifest

Manifest version: **v1**
Manifest date: **2026-09-20**
Status: **RESEARCH EVIDENCE FOR PCART-L1 POLICY CLOSURE ONLY — NOT TRANSACTION AUTHORIZATION**

## 0. Evidence class and fail-closed rule

Every external address in this manifest is **RESEARCHED / NOT ON-CHAIN VERIFIED BY CARTEL HQ IN THIS UNIT**. No address here was read from chain, called, simulated, or used in any transaction by this unit, and none of them appears in runtime code.

**Mandatory pre-L5 revalidation.** Every address below MUST be independently revalidated on chain immediately before any PCART-L5 liquidity/CCA execution. **Any mismatch — address, code hash, version, or ownership — blocks execution. Fail closed. Do not improvise a substitute address.**

Robinhood Chain and Uniswap deployment addresses **changed multiple times during 2026**. Treat this manifest as dated evidence with a short shelf life, never as a standing source of truth.

## 1. Network

| Property | Value |
|---|---|
| Robinhood Chain mainnet chain ID | `4663` |
| Robinhood Chain testnet chain ID | `46630` |
| Native gas asset | ETH |
| EVM compatibility | EVM-compatible |

## 2. Safe (treasury) — canonical v1.4.1 deployment

The Safe official deployment registry maps Robinhood chain `4663` and testnet `46630` to the canonical Safe v1.4.1 deployment.

| Component | Address | Expected code hash |
|---|---|---|
| SafeL2 v1.4.1 singleton | `0x29fcB43b46531BcA003ddC8FCB67FFE91900C762` | `0xb1f926978a0f44a2c0ec8fe822418ae969bd8c3f18d61e5103100339894f81ff` |
| SafeProxyFactory v1.4.1 | `0x4e1DCf7AD4e460CfD30791CCC4F9c8a4f820ec67` | `0x50c3cdc4074750a7a974204a716c999edd37482f907608d960b2b025ee0b3317` |

RESEARCHED / NOT ON-CHAIN VERIFIED BY CARTEL HQ IN THIS UNIT.

**No PEPECARTEL Safe exists.** No Safe address, no signer address and no PCART treasury recipient is recorded here or anywhere in this repository.

## 3. Uniswap / Robinhood liquidity stack

| Component | Address |
|---|---|
| Uniswap LiquidityLauncher core launcher (Robinhood) v3.2.0 | `0x0000FffFBE8efE702c8703aE3477FF5dE3d319C0` |
| SDK Robinhood LBPStrategy pointer | `0xbf1aB81f7d534b2CC0Da76fcf4d541322bB0e000` |
| CCA factory | `0x000000001F26a0044BaA66024e7b6599c61963F8` |
| Robinhood TokenSplitter | `0x4F5E3FBb9745358A92Da5674305FAb8D2B8a73cE` |
| Permit2 | `0x000000000022D473030F116dDEE9F6B43aC78BA3` |
| Robinhood UniversalRouterStrategy pointer | `0x1242c9439d589cAE85E121B1f79f2aF51e91DCEE` |

Each entry is RESEARCHED / NOT ON-CHAIN VERIFIED BY CARTEL HQ IN THIS UNIT.

## 4. Existing-token flow compatibility

- An already-deployed ("existing") token is supported conceptually via **Permit2 + `depositToken` + `distributeToken` within one LiquidityLauncher multicall**. Exact calldata, parameters, beneficiary routing and failure recovery remain PCART-L5 work and are not encoded anywhere in this repository.
- **Fee-on-transfer and rebasing tokens are unsupported by LiquidityLauncher.** The DRAFT PCART shape (`contracts/PepeCartelToken.sol`) is a standard 0%-transfer-tax ERC-20 with no rebasing, so it does not introduce that incompatibility. This is a source-shape statement only; it is not a compiled-artifact or on-chain proof.

## 5. Scope limits

- This manifest authorizes nothing. It does not authorize a Safe deployment, a compile, an artifact, a production request, a testnet or mainnet transaction, liquidity work, or any value movement.
- None of these addresses may be placed in `src/**`, `supabase/**`, `contracts/**` or `docs/sql/**`. Documentation only.
- Infrastructure/protocol compatibility evidence for PCART-L1 closure (item **L1-e1**) consists of this manifest, the already-finalized separate generic mainnet canary, and static/read-only checks. It does **not** include exact-artifact rehearsal, which remains **L1-e2 / Phase 3**.
