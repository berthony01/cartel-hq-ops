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

| Component | Address |
|---|---|
| Component | Address | Status (2026-10-01) |
|---|---|---|
| LiquidityLauncher core v3.2.0 | `0x0000FffFBE8efE702c8703aE3477FF5dE3d319C0` | in scope |
| Robinhood LBPStrategy v3.3.0 | `0xbf1aB81f7d534b2CC0Da76fcf4d541322bB0e000` | in scope |
| Robinhood InitializerHook v3.3.0 | `0x5fB5229FBA341dFE5a7e6A14d4809D6Cf887a000` | in scope |
| ContinuousClearingAuctionFactory (CCA v2.1.0, recommended) | `0x000000001F26a0044BaA66024e7b6599c61963F8` | in scope |
| Robinhood FeeSplitter — autocompound / fees-off | `0x882Ae5e2095435A62Fd1BBDEfcb637f5CeAFc0ee` | LP custody candidate (L-S5/L-S7 gate) |
| Robinhood FeeSplitter — creator-fees-on | `0x9411fa7F956f64aa7981AA27cB3bC6eC0415449C` | OPEN — PCART routing unproven (section 6) |
| UERC20BeneficiaryVault | `0x26d2F7AcB07707034406a0dC458351Bb63C02553` | OPEN — UERC20-specific attribution (section 6) |
| CompoundingClaimRecipient | `0xf585b5D728A8fdE743027307BF5F3556E3B9C58D` | reference only |
| Robinhood TokenSplitter (v1 record) | `0x4F5E3FBb9745358A92Da5674305FAb8D2B8a73cE` | not re-confirmed in v2; verify before any use |
| Permit2 | `0x000000000022D473030F116dDEE9F6B43aC78BA3` | in scope |
| Robinhood UniversalRouterStrategy | conflicting: README `0x0A122717bc36E3C7A7958128a5C789E0b070b3Ae` vs SDK 1.15.0 `0x1242c9439d589cAE85E121B1f79f2aF51e91DCEE` | **OUT OF SCOPE** — PCART CCA/LBP doesn't need it; neither address chosen without direct on-chain verification |

Each entry: CURRENT OFFICIAL UPSTREAM SOURCE VERIFIED, NOT YET CARTEL HQ ON-CHAIN CODE-HASH VERIFIED.

Upstream notes:
- **CCA v2.1.0** includes an Arbitrum/Orbit bug fix. `startBlock`/`endBlock`/`claimBlock` are fixed in the instance config, and graduation depends on `requiredCurrencyRaised`. If the auction never graduates, bidders can reclaim their funds. There is no normal admin action to extend an auction after it starts.
- **Liquidity Launcher v3.3.0** (released 2026-09-29) adds fee-update integration and fixes a nested PoolManager unlock issue in `LBPStrategy.migrate`.
- **Robinhood auction clock:** the current SDK changelog documents a clock of about 0.1 s and an older bug caused by a 12-second fallback. The ~96h duration must be encoded from the current blocknumberish-aware SDK and the current chain timing, then checked independently. Never hand-hardcode a block count.
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

## 6. Open: creator fees for existing-token PCART

Do NOT assume that the creator-fees-on FeeSplitter routes PCART creator fees to the PEPECARTEL treasury. `UERC20BeneficiaryVault` creator attribution behaves specifically for launcher-created UERC20 tokens, and PCART is a custom existing `PepeCartelToken`. Creator-fee and treasury-revenue compatibility on the existing-token LBP path stays **OPEN** until explicitly proven. The fees-off/autocompound FeeSplitter is a candidate for permanent LP custody only. The production choice is an L-S5/L-S7 gate.

## 7. Vesting candidate (research only)

OpenZeppelin `VestingWallet` (linear ERC-20 vesting) and `VestingWalletCliff` (available since v5.1) are candidates. **Caveat:** `VestingWallet` is `Ownable` and ownership can be transferred, so unvested rights can effectively be sold or transferred. The current OpenZeppelin release is v5.7.0. The frozen PCART token artifact and its OZ 5.6.1 compilation are NOT changed. Sources: https://docs.openzeppelin.com/contracts/5.x/api/finance, https://github.com/OpenZeppelin/openzeppelin-contracts/releases

## 8. Scope limits

- This manifest authorizes nothing. It does not authorize a Safe deployment, a compile, an artifact, a production request, a testnet or mainnet transaction, liquidity work, or any value movement.
- None of these addresses may be placed in `src/**`, `supabase/**`, `contracts/**` or `docs/sql/**`. Documentation only.
- Infrastructure/protocol compatibility evidence for PCART-L1 closure (item **L1-e1**) consists of this manifest, the already-finalized separate generic mainnet canary, and static/read-only checks. It does **not** include exact-artifact rehearsal, which remains **L1-e2 / Phase 3**.
