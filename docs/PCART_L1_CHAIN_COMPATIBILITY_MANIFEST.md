# PCART-L1 Robinhood / Uniswap / Safe Compatibility Manifest

Manifest version: **v2** (v1 dated 2026-09-20)
Manifest date: **2026-10-01**
Evidence label: **CURRENT OFFICIAL UPSTREAM SOURCE VERIFIED, NOT YET CARTEL HQ ON-CHAIN CODE-HASH VERIFIED.**
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

Source: https://docs.robinhood.com/chain/connecting/ (checked 2026-10-01).

## 2. Safe (treasury) — canonical v1.4.1 deployment

The Safe official deployment registry maps Robinhood chain `4663` and testnet `46630` to the canonical Safe v1.4.1 deployment.

| Component | Address | Expected code hash |
|---|---|---|
| SafeL2 v1.4.1 singleton | `0x29fcB43b46531BcA003ddC8FCB67FFE91900C762` | `0xb1f926978a0f44a2c0ec8fe822418ae969bd8c3f18d61e5103100339894f81ff` |
| SafeProxyFactory v1.4.1 | `0x4e1DCf7AD4e460CfD30791CCC4F9c8a4f820ec67` | `0x50c3cdc4074750a7a974204a716c999edd37482f907608d960b2b025ee0b3317` |

Canonical **SafeProxy v1.4.x runtime code hash** (the code deployed at every Safe proxy, used by the read-only verifier as an exact-match pin): `0xd7d408ebcd99b2b70be43e20253d6d92a8ea8fab29bd3be7f55b10032331fb4c`. The v1.4.1 proxy exposes `masterCopy()` via selector `0xa619486e` (storage slot 0), the GuardManager transaction-guard storage slot is `0x4a204f620c8c5ccdca3fd54d003badd85ba500436a431f0cbda4f558c93c34c8`, and `getModulesPaginated` uses `SENTINEL_MODULES` `0x0000000000000000000000000000000000000001`.

RESEARCHED / NOT ON-CHAIN VERIFIED BY CARTEL HQ IN THIS UNIT. Mandatory pre-L5 revalidation applies to these values exactly as it does to every address above; any mismatch fails closed.


**No PEPECARTEL Safe exists.** No Safe address, no signer address and no PCART treasury recipient is recorded here or anywhere in this repository.

## 3. Uniswap / Robinhood liquidity stack

| Component | Address | Status (2026-10-01) |
|---|---|---|
| LiquidityLauncher core v3.2.0 | `0x0000FffFBE8efE702c8703aE3477FF5dE3d319C0` | in scope |
| Robinhood LBPStrategy v3.3.0 | `0xbf1aB81f7d534b2CC0Da76fcf4d541322bB0e000` | in scope |
| Robinhood InitializerHook v3.3.0 | `0x5fB5229FBA341dFE5a7e6A14d4809D6Cf887a000` | in scope |
| ContinuousClearingAuctionFactory (CCA v2.1.0, recommended) | `0x000000001F26a0044BaA66024e7b6599c61963F8` | in scope |
| Robinhood FeeSplitter — autocompound / fees-off | `0x882Ae5e2095435A62Fd1BBDEfcb637f5CeAFc0ee` | L-S5 LOCKED default PCART positionRecipient, subject to on-chain hash/config verification + testnet/fork simulation |
| Robinhood FeeSplitter — creator-fees-on | `0x9411fa7F956f64aa7981AA27cB3bC6eC0415449C` | NOT USED for PCART (L-S5; section 6) |
| UERC20BeneficiaryVault | `0x26d2F7AcB07707034406a0dC458351Bb63C02553` | NOT RELIED ON for PCART (L-S5; section 6) |
| CompoundingClaimRecipient | `0xf585b5D728A8fdE743027307BF5F3556E3B9C58D` | reference only |
| Robinhood TokenSplitter (v1 record) | `0x4F5E3FBb9745358A92Da5674305FAb8D2B8a73cE` | not re-confirmed in v2; verify before any use |
| Permit2 | `0x000000000022D473030F116dDEE9F6B43aC78BA3` | in scope |
| Robinhood UniversalRouterStrategy | conflicting: README `0x0A122717bc36E3C7A7958128a5C789E0b070b3Ae` vs SDK 1.15.0 `0x1242c9439d589cAE85E121B1f79f2aF51e91DCEE` | **OUT OF SCOPE** — PCART CCA/LBP doesn't need it; neither address chosen without direct on-chain verification |

Each entry: CURRENT OFFICIAL UPSTREAM SOURCE VERIFIED, NOT YET CARTEL HQ ON-CHAIN CODE-HASH VERIFIED.

Upstream notes:
- **CCA v2.1.0** includes an Arbitrum/Orbit bug fix. `startBlock`/`endBlock`/`claimBlock` are fixed in the instance config, and graduation depends on `requiredCurrencyRaised`. If the auction never graduates, bidders can reclaim their funds. There is no normal admin action to extend an auction after it starts.
- **Liquidity Launcher v3.3.0** (released 2026-09-29) adds fee-update integration and fixes a nested PoolManager unlock issue in `LBPStrategy.migrate`.
- **Robinhood auction clock:** the current SDK changelog documents a clock of about 0.1 s and an older bug caused by a 12-second fallback. The 7-day auction duration (plan v2; ~96h superseded) must be encoded from the current blocknumberish-aware SDK and the current chain timing, then checked independently. Never hand-hardcode a block count.
- **FeeSplitter** is zero-admin, permanent LP custody. Any position sent to it can never be recovered, by design, while fees are split or compounded.

Sources:
- https://github.com/Uniswap/continuous-clearing-auction
- https://github.com/Uniswap/continuous-clearing-auction/blob/main/docs/TechnicalDocumentation.md
- https://github.com/Uniswap/liquidity-launcher
- https://github.com/Uniswap/liquidity-launcher/blob/main/docs/TechnicalReference.md
- https://github.com/Uniswap/liquidity-launcher/releases
- https://github.com/Uniswap/sdks/blob/main/sdks/liquidity-launcher-sdk/README.md
- https://github.com/Uniswap/sdks/blob/main/sdks/liquidity-launcher-sdk/CHANGELOG.md

## 4. Existing-token flow compatibility

- An already-deployed ("existing") token is supported conceptually via **Permit2 + `depositToken` + `distributeToken` within one LiquidityLauncher multicall**. **Deposit/acquisition and `distributeToken` MUST stay in one multicall. Never leave deposited tokens in the launcher between transactions.** Exact calldata, parameters, beneficiary routing and failure recovery remain PCART-L5 work and are not encoded anywhere in this repository.
- **Fee-on-transfer and rebasing tokens are unsupported by LiquidityLauncher.** The DRAFT PCART shape (`contracts/PepeCartelToken.sol`) is a standard 0%-transfer-tax ERC-20 with no rebasing, so it does not introduce that incompatibility. This is a source-shape statement only; it is not a compiled-artifact or on-chain proof.

## 5. Mandatory pre-integration on-chain verification gate

Before any integration code or transaction, each in-scope address must be read directly through the managed Robinhood RPC. Check:
- that code exists at the exact address
- that the runtime code hash matches the pinned value, which must be recorded first
- the version
- that the methods we need are present: CCA factory/instance config, LBPStrategy/LiquidityLauncher multicall, Permit2, FeeSplitter

**Any mismatch, missing code or ambiguity fails closed.** Do not substitute an address. This manifest does not satisfy that gate.

## 6. Creator fees for existing-token PCART — RESOLVED BY L-S5 (2026-10-01): not launch-critical

Do NOT assume that the creator-fees-on FeeSplitter routes PCART creator fees to the PEPECARTEL treasury. `UERC20BeneficiaryVault` creator attribution behaves specifically for launcher-created UERC20 tokens, and PCART is a custom existing `PepeCartelToken`. Creator-fee and treasury-revenue compatibility on the existing-token LBP path stays **OPEN** until explicitly proven. The fees-off/autocompound FeeSplitter is a candidate for permanent LP custody only. The production choice is an L-S5/L-S7 gate. _(Historical paragraph.)_

**L-S5 decision:** creator-fee/trading-fee revenue is removed from PCART launch-critical requirements. Default `positionRecipient` is the fees-off/autocompound FeeSplitter `0x882Ae5e2095435A62Fd1BBDEfcb637f5CeAFc0ee` (permanent, irrecoverable LP custody; 100% of LP fees to CompoundingClaimRecipient per upstream README, not to treasury), only after mandatory on-chain hash/config verification and testnet/fork simulation. No custom FeeSplitter. See master plan section 00.

## 7. Vesting candidate (research only)

OpenZeppelin `VestingWallet` (linear ERC-20 vesting) and `VestingWalletCliff` (available since v5.1) are candidates. **Caveat:** `VestingWallet` is `Ownable` and ownership can be transferred, so unvested rights can effectively be sold or transferred. The current OpenZeppelin release is v5.7.0. The frozen PCART token artifact and its OZ 5.6.1 compilation are NOT changed. Sources: https://docs.openzeppelin.com/contracts/5.x/api/finance, https://github.com/OpenZeppelin/openzeppelin-contracts/releases

## 8. Scope limits

- This manifest authorizes nothing. It does not authorize a Safe deployment, a compile, an artifact, a production request, a testnet or mainnet transaction, liquidity work, or any value movement.
- None of these addresses may be placed in `src/**`, `supabase/**`, `contracts/**` or `docs/sql/**`. Documentation only.
- Infrastructure/protocol compatibility evidence for PCART-L1 closure (item **L1-e1**) consists of this manifest, the already-finalized separate generic mainnet canary, and static/read-only checks. It does **not** include exact-artifact rehearsal, which remains **L1-e2 / Phase 3**.

## 9. Managed-RPC observed + ABI/config verified 2026-10-01

Read through CARTEL HQ's managed Robinhood mainnet RPC (read-only `eth_chainId`/`eth_getCode`/`eth_call` only; no signing, no transaction). `eth_chainId` = **4663**. All reads pinned to block **77,685,829**. Every expectation below PASSED.

**PINNED AS CARTEL HQ OBSERVED MAINNET FINGERPRINTS** for future pre-send rechecks. These are not proof of a third-party audit. Future execution MUST re-read code hashes and config immediately before any integration/send and require an exact match; **any mismatch fails closed**.

| Component | Address | Runtime bytes | Runtime code keccak256 |
|---|---|---|---|
| LiquidityLauncher core | `0x0000FffFBE8efE702c8703aE3477FF5dE3d319C0` | 4127 | `0x4a586d925c9d59ece13ce2239ebd7dea9ee725f9d33c6667e0fd16ae8d977d80` |
| LBPStrategy v3.3.0 | `0xbf1aB81f7d534b2CC0Da76fcf4d541322bB0e000` | 21241 | `0x52b5ff6eb222744bfe04beab33c12d3d0126ab731d8bb0737d58b63b12e35d2c` |
| InitializerHook v3.3.0 | `0x5fB5229FBA341dFE5a7e6A14d4809D6Cf887a000` | 3104 | `0xb427c9117931c9139aa652ab6098bd9ffe6d2cc2c48ea47c75e8f52cebe24fff` |
| CCA factory v2.1.0 | `0x000000001F26a0044BaA66024e7b6599c61963F8` | 24214 | `0xa1d2a90564f4f63580b25de42efaff92505c254b00fc666f65ab38126cce5cfa` |
| FeeSplitter fees-off | `0x882Ae5e2095435A62Fd1BBDEfcb637f5CeAFc0ee` | 7260 | `0x8238e5106b3a895514083110d1f3b4e51be61148604f35113719af56ae325f42` |
| FeeSplitter fees-on | `0x9411fa7F956f64aa7981AA27cB3bC6eC0415449C` | 7260 | `0x8238e5106b3a895514083110d1f3b4e51be61148604f35113719af56ae325f42` |
| CompoundingClaimRecipient | `0xf585b5D728A8fdE743027307BF5F3556E3B9C58D` | 3598 | `0xd2fa4e20bd2f18107b33b38cd3115be9f8d11b9d03767a462c2fe224c67a7fe2` |
| UERC20BeneficiaryVault | `0x26d2F7AcB07707034406a0dC458351Bb63C02553` | 6390 | `0x60f051c91b567218a6703c35dd264b9c5257ee0db7379e9869c9968642fb8a44` |
| Permit2 | `0x000000000022D473030F116dDEE9F6B43aC78BA3` | 9152 | `0x5208783f52488f7d3493e5e38311ab707c1d75457fe472a19b0b4d57d66a7fca` |

Note: both FeeSplitters share identical runtime code; they differ only in their split configuration, so the config below (not the hash alone) distinguishes them and must be rechecked too.

**Observed config:**
- LBPStrategy `positionManager()` = `0x58daec3116aae6D93017bAAea7749052E8a04fA7` (code present, 23877 bytes); `poolManager()` = `0x8366a39CC670B4001A1121B8F6A443A643e40951` (code present, 24009 bytes); `initializerFactory()` = `0x000000001F26a0044BaA66024e7b6599c61963F8` (= CCA factory, PASS).
- InitializerHook `authorized()` = `0xbf1aB81f7d534b2CC0Da76fcf4d541322bB0e000` (= LBPStrategy, PASS).
- Fees-off FeeSplitter: `positionManager()`/`poolManager()` equal LBPStrategy's (PASS). `getSplits()` = `[(0xf585b5D728A8fdE743027307BF5F3556E3B9C58D, nativeBps 10000, tokenBps 10000, useCallback true)]` (PASS).
- Fees-on FeeSplitter: `positionManager()`/`poolManager()` equal LBPStrategy's (PASS). `getSplits()` = `[(0x26d2F7AcB07707034406a0dC458351Bb63C02553, 4000, 0, true), (0xf585b5D728A8fdE743027307BF5F3556E3B9C58D, 6000, 10000, true)]` (PASS). Not used for PCART (section 6).
- CCA factory: code existence and hash only; no non-interface getters were called.

Limits: one authoritative managed RPC reading, with no independent second source; positionManager/poolManager hashes were not pinned (only code presence checked). This section satisfies the section 5 code-hash/config gate as of this date only; it authorizes no transaction.
