# PCART Master Launch Plan

Date: 2026-09-12
Status: Authoritative working plan / DOCUMENTATION ONLY
Last direction update: 2026-10-01 (L-S5 — economic/auction design lock; documentation/policy only; authorizes no transaction or production integration)

## 00. L-S5 economic/auction design lock (2026-10-01) — SUPERSEDES section 0 TBDs and all conflicting older text

Policy/design lock only. Not implementation, not transaction authorization. Where this section conflicts with section 0 or anything below, this section wins.

**1. Auction.** Public Uniswap Continuous Clearing Auction (CCA) run through the current LBPStrategy on Robinhood Chain. About 96 hours (4 days). Exact `startBlock`/`endBlock`/`claimBlock` are derived at execution from the current blocknumberish-aware Uniswap SDK and current Robinhood clock and independently checked; never hardcode a block count from the old 12-second assumption. No normal extension after bidding starts. Currency: native ETH. No whitelist by default. No custom presale. Pre-launch marketing/Launch Watch may run for several weeks and collects no funds.

**2. Target Raise vs Graduation Floor (separate concepts).**
- Desired **Target Raise: 30 ETH.** An aspiration, not a gate. Missing it does NOT block launch.
- **Graduation Floor / `requiredCurrencyRaised`: 5 ETH.** Below it the auction does not graduate; bidders use the CCA refund path and the launch does not proceed to liquidity.
- These are PEPECARTEL economic settings, not Robinhood/Uniswap protocol minimums.
- Rationale: under the LP schedule below, 5 ETH is the minimum floor at which 100% of raised ETH is still directed to liquidity.
- No USD promises or projections.

**3. Public-launch/liquidity allocation (final, 500M bucket).** 150,000,000 PCART max auction supply; 200,000,000 PCART reserved token-side LBP/liquidity budget; 150,000,000 PCART future liquidity/market reserve held outside the initial launcher. If execution testing proves a mechanical incompatibility, this fails closed and requires explicit re-review; no silent parameter substitution.

**4. LP allocation of ETH raised (final bracket policy).**

| Auction ETH raised | To LP | To treasury/operations |
|---|---|---|
| Under 5 ETH | — no graduation, refund path | — |
| 5 ETH up to <15 ETH | 100% | 0% |
| 15 ETH up to <30 ETH | 90% | 10% |
| 30 ETH or more | 80% | 20% |

Percentages apply to net available auction ETH; protocol fees and gas are accounted before any net treasury remainder is claimed. The operational gas reserve policy (0.10 ETH reserve, 0.05 ETH execution-wallet floor) stays outside auction proceeds unless explicitly changed later.

**5. Pool / LP custody (safety-first).** Static-fee Uniswap v4 pool, 0.25% LP fee, if current integration/fork tests confirm the pool parameters. Default production `positionRecipient`: the current Robinhood v3.3.0 fees-off/autocompound FeeSplitter `0x882Ae5e2095435A62Fd1BBDEfcb637f5CeAFc0ee`, only after mandatory on-chain hash/config verification and testnet/fork simulation pass. This permanently locks the LP NFT and directs 100% of LP fees into the current CompoundingClaimRecipient path, not to the PEPECARTEL treasury. Creator-fee/trading-fee revenue is REMOVED from the launch-critical requirements; `UERC20BeneficiaryVault` is not relied on for the custom existing PCART token. A future audited revenue mechanism may be researched after launch, must not weaken or alter the immutable PCART token, and is not required for launch readiness. No custom FeeSplitter is deployed; custom contracts are minimized.

**6. Vesting.**
- Team: 100,000,000 PCART, 24-month linear on-chain vesting, starting at the public launch/trading go-live timestamp, no cliff, 0 team tokens liquid at that exact timestamp, accruing continuously thereafter. Preferred implementation: OpenZeppelin `VestingWallet` with a dedicated team beneficiary Safe as owner/beneficiary. Caveat: `VestingWallet` is `Ownable`, so ownership/beneficiary rights can be transferred; for PCART any ownership change must be publicly disclosed and should require the team beneficiary Safe policy. The frozen PCART token artifact is not modified.
- Strategic partnerships: 50,000,000 PCART, 6-month delay + 24-month linear, implemented as `VestingWallet` start = launch + 6 months, duration = 24 months (no cliff catch-up unlock). Individual grant recipients are later operational data, not launcher policy.

**7. Treasury.** 2-of-3 Safe required/preferred, with three distinct independently secured keys (not necessarily three different people). Actual signer addresses and Safe address are operational inputs and are not recorded in docs.

**8. "Finished but mainnet locked" means all of:** frozen PCART artifact ready; current CCA/LBP integration implemented and testnet/fork tested; the auction parameters above encoded and tested; real 2-of-3 Safe created/verified; exact PCART testnet rehearsal confirmed; vesting contracts/path tested; permanent LP custody path tested; production allowlist/migration prepared but NOT applied until final launch authorization; mainnet execution locked until launch day.

**9. Upstream facts preserved (manifest v2 sources).** CCA graduation is based on `requiredCurrencyRaised`; if not reached, bidders can refund. LBPStrategy migration has a configurable `positionRecipient`. FeeSplitter is zero-admin and positions sent to it are irrecoverable. The current Robinhood fees-off FeeSplitter sends 100% of native ETH and token fee shares to CompoundingClaimRecipient per the upstream README. The existing-token flow must batch Permit2 `depositToken` + `distributeToken` in one LiquidityLauncher multicall.

**Status of remaining dependencies (none done):** A. managed-RPC ABI/config verification and pinning of observed hashes/configs; B. treasury Safe creation + signer recording; C. exact PCART testnet rehearsal; D. only then L-S6 testnet auction integration and L-S7 liquidity/vesting integration.

## 0. L-S3 locked launch direction (2026-10-01) — SUPERSEDES conflicting older text below

Older text below is kept as history. Where it conflicts with this section, this section wins. Superseded items are labelled inline.

- **Still frozen:** 1,000,000,000 PCART total supply, set once in the token contract, which cannot be changed. The frozen PCART token artifact and its OpenZeppelin 5.6.1 compilation are not changed.
- **Locked/preferred:** a 2-of-3 Safe treasury, kept separate from the deployer wallet.
- **Launch mechanism:** a public Uniswap CCA auction. No traditional long presale and no custom presale contract.
- **Auction duration:** about 96 hours (4 days). The exact blocks are derived at execution from the current blocknumberish-aware Uniswap SDK and the current Robinhood clock (about 0.1 s per auction clock tick per the SDK changelog), and checked independently. No block count is hardcoded from older 12-second assumptions.
- **No extension:** the auction is not extended after it starts as a normal plan. All rules are fixed before bidding opens. CCA `startBlock`/`endBlock`/`claimBlock` are fixed in the instance config. If the auction does not graduate, bidders can reclaim their funds.
- **Pre-launch:** several weeks of marketing and Launch Watch, with no funds collected.
- **Target Raise vs Graduation Floor (separate):**
  - The **Target Raise** is the amount we would like to raise. Missing it does NOT block launch.
  - The **Graduation Floor** (`requiredCurrencyRaised`) is the minimum technically and economically responsible amount for liquidity. It is not a fundraising quota. _(L-S3 TBD now RESOLVED by section 00: Graduation Floor 5 ETH, Target Raise 30 ETH.)_
- **After the auction:** CCA/LBP migrates into Uniswap v4 liquidity, with permanent, non-ruggable LP custody **only if compatibility is proven** (L-S5/L-S7 gate).
- **Team vesting:** longer, transparent, on-chain vesting. _(Resolved in section 00: 24-month linear, no cliff.)_ The OpenZeppelin `VestingWallet`/`VestingWalletCliff` is a candidate. Caveat: it is `Ownable`, so unvested rights can be transferred.
- **Allocation:** 150M auction / 200M reserved LP / 150M future liquidity — now FINAL per section 00.
- **Creator-fee revenue:** _(SUPERSEDED by section 00: removed from launch-critical requirements; LP custody = fees-off FeeSplitter.)_
- **User experience:** the user-facing launcher stays simple. Technical detail stays internal.
- See `docs/PCART_L1_CHAIN_COMPATIBILITY_MANIFEST.md` v2. Those upstream sources are verified as current; CARTEL HQ has NOT verified the code hashes on-chain yet.

Project: PEPECARTEL ($PCART) on Robinhood Chain

## 1. Core objective

Launch the official PEPECARTEL token, ticker PCART, on Robinhood Chain mainnet (chain ID 4663), make it publicly tradable only after deployment verification, managed finality, source verification, official-contract registration, and independently verified liquidity/trading readiness.

## 2. Frozen token direction

- One official PEPECARTEL token only: $PCART.
- No separate “launcher token” is planned. CARTEL HQ / the future launchpad is software and may use $PCART as ecosystem utility.
- **Frozen total supply: exactly 1,000,000,000 PCART, 18 decimals, permanently fixed supply.**
- Dedicated production artifact for PEPECARTEL, separate from generic launchpad templates. Working artifact name: `pepecartel-token-v1`; working source name: `PepeCartelToken.sol`.
- **Frozen V1 token behavior: standard ERC-20; 0% fee-on-transfer / transfer tax; name/symbol/supply fixed; mint once at deployment to the deliberately chosen initial treasury; no post-deployment minting; no owner/admin; no blacklist/freeze; no pause; no max-wallet/max-tx; no proxy/upgradeability; no hidden transfer controls.**
- DO NOT finalize or deploy the Solidity until all remaining L1 inputs close and L1 is explicitly approved. (Narrow owner-authorized exception for a DRAFT, non-compiled, non-frozen, non-allowlisted source file only: see section 13.)

## 3. Tokenomics, allocation and custody freeze

### 3.1 Allocation

| Category | Share | Amount |
|---|---|---|
| Public launch + liquidity | 50% | 500,000,000 PCART |
| Ecosystem + community | 20% | 200,000,000 PCART |
| PEPECARTEL treasury | 15% | 150,000,000 PCART |
| Founder/team | 10% | 100,000,000 PCART |
| Strategic partnerships | 5% | 50,000,000 PCART |
| **Total** | **100%** | **1,000,000,000 PCART** |

### 3.2 Vesting and lock policy

- **Team allocation:** 100,000,000 PCART vests linearly over 12 months from launch _(SUPERSEDED 2026-10-01: historical; now 24-month linear, no cliff — section 00)_. **Zero team allocation is liquid or unlocked at launch.** Prefer continuous/time-based linear vesting so 100% is vested at the end of the schedule; do not create a one-time 100M cliff unlock. Exact vesting contract implementation remains for a later audited step.
- **Strategic partnerships:** 50,000,000 PCART preserved with the recommended guardrail of a 6-month initial lock followed by 24-month linear release, unless later L1 approval explicitly changes it. Grants must be disclosed from the allocation, not treated as hidden discretionary supply.
- Public launch + liquidity, ecosystem + community, and treasury allocations are not subject to the above vesting locks unless separately decided.

### 3.3 Treasury architecture

- **Frozen preferred architecture: 2-of-3 multisig, separate from deployer/everyday wallet.**
- Treasury is intended to receive the 150M treasury allocation plus operational assets and any treasury share of auction ETH per section 00 _(historical "project trading-fee revenue" SUPERSEDED: LP fees go to CompoundingClaimRecipient, not treasury)_.
- Exact multisig implementation/addresses remain unresolved until chain compatibility and security audit are complete.

## 4. Transfer-tax / trading-revenue decision gate

User wants modest ongoing revenue from trading for marketing, production, and ecosystem operations.

_(Revenue portion SUPERSEDED by section 00: creator-fee/trading-fee revenue is not launch-critical.)_ **Historical direction:** keep PCART a standard 0%-transfer-tax ERC-20 and seek project revenue through audited liquidity-layer creator/LP fees. The Uniswap LiquidityLauncher technical reference states rebasing and fee-on-transfer tokens are not compatible with LiquidityLauncher. The Robinhood Chain Uniswap stack currently exposes creator-fee / fee-splitter infrastructure, which may offer ongoing trading-fee revenue while keeping PCART a standard ERC-20. This must be reverified from current Uniswap code/on-chain contracts immediately before implementation.

**Frozen launch-distribution and price-discovery decision:** PEPECARTEL chooses **Option A: public onchain CCA/LBP launch auction** as the preferred launch path because the project does not expect to supply all required launch liquidity ETH itself. A Continuous Clearing Auction (CCA) / Liquidity Bootstrapping Pool (LBP) is a public onchain token sale/auction economically; it is not a private fixed-price presale. Do not market it as “no sale” or imply legal distinctions that have not been reviewed.

The current technical reason for choosing CCA/LBP is that Uniswap's LBP strategy can run a Continuous Clearing Auction, transfer raised currency to the LBP strategy, discover a market-clearing price, and migrate reserved token supply plus raised currency into Uniswap v4 liquidity according to configured migration parameters. Exact Robinhood Chain contracts, code hashes, parameters, auction amount, reserve/starting price, duration, LP allocation schedule, token/currency split, position recipient/lock, creator-fee compatibility (no longer launch-critical — section 00), and failure-recovery behavior must be reverified in PCART-L5 before any execution.

Choosing CCA/LBP can reduce the amount of ETH the project must contribute for initial liquidity, but does NOT mean the launch requires zero ETH. PEPECARTEL still needs ETH for deployment/gas and may need additional ETH depending on final auction/liquidity configuration and operational requirements.

The 500,000,000 PCART public-launch/liquidity allocation is a **carried-forward working allocation pending final L-S5 economic simulation (not frozen, 2026-10-01)**: 150,000,000 PCART maximum to the CCA public auction, 200,000,000 PCART reserved for token-side LBP migration/liquidity, and 150,000,000 PCART held as future liquidity/market reserve outside the initial launcher.

Important: creator-fee percentages are percentages of protocol/pool fee streams, NOT percentages of gross trade volume. No revenue projection is frozen.

**Treasury revenue policy target (non-contractual, adjustable):** 35% marketing/content/community growth; 35% CARTEL HQ development/infrastructure; 20% liquidity/security/reserve; 10% legal/audits/compliance/admin. This is an operating-policy target, not token-holder entitlement and not hard-coded in Solidity.

## 4.1 PCART-L1A — CCA Auction Economics Simulation (HISTORICAL — partly SUPERSEDED 2026-10-01, see section 0)

This section records the earlier (2026-09) CCA/LBP auction economics. Duration, graduation minimum and allocation are superseded or unfrozen by section 0. It covers for the 500,000,000 PCART public launch + liquidity bucket. They do not authorize execution.

### 4.1.1 Scenario comparison within the frozen 500M public-launch/liquidity bucket

| Scenario | Max auction supply | Reserved token-side LP budget | Future liquidity/market reserve |
|---|---|---|---|
| Conservative | 100,000,000 PCART | 150,000,000 PCART | 250,000,000 PCART |
| **Balanced (carried-forward working allocation, not frozen)** | **150,000,000 PCART** | **200,000,000 PCART** | **150,000,000 PCART** |
| Aggressive | 200,000,000 PCART | 250,000,000 PCART | 50,000,000 PCART |

**Why Balanced was chosen (working allocation):** it exposes at most 15% of total supply to the initial auction, keeps a large 20% token-side LP budget available for migration, and retains another 15% of total supply as flexible future liquidity/market support. It avoids both a very small initial public distribution and committing almost the entire 500M bucket at launch.

### 4.1.2 Current Uniswap LBP mechanical fit (must be reverified before execution)

Current-source finding: `LBPStrategy` splits the amount deposited into auction supply (`distribution amount minus reservedTokenAmountForLP`) while `reservedTokenAmountForLP` stays in the strategy for migration. Under the carried-forward working allocation, the planned LBP deposit would therefore be **350,000,000 PCART**, with **200,000,000 PCART reserved** and up to **150,000,000 PCART** sent to the CCA. The other **150,000,000 PCART** from the 500M bucket remains outside this launch transaction as designated future liquidity/market reserve.

Unused migration currency and unused reserved LP tokens return to the configured recipient; failed-migration recovery also returns raised currency and reserved tokens to the recipient. These mechanics are **not frozen external facts** and must be reverified against current Robinhood Chain/Uniswap contracts and SDK immediately before build/execution.

### 4.1.3 Auction planning parameters (historical; superseded items marked; not execution authorization)

- **Raise currency:** native ETH.
- **Public onchain CCA/LBP launch path:** remains the locked direction.
- **Max auction supply:** 150,000,000 PCART.
- **Reserved token-side LP budget:** 200,000,000 PCART.
- **Future liquidity/market reserve outside launcher:** 150,000,000 PCART.
- **Auction window:** ~~24h~~ SUPERSEDED (historical) → ~96 hours, exact blocks derived at execution from current SDK/Robinhood clock (section 0).
- **Floor FDV planning guardrail (pending L-S5 re-confirmation):** 50 ETH equivalent across the 1,000,000,000 PCART total supply. This is an approved planning input, not a promised valuation or fundraising target.
- **Graduation Floor / `requiredCurrencyRaised`:** old 10 ETH value SUPERSEDED/UNFROZEN (historical). New Graduation Floor 5 ETH; Target Raise 30 ETH, separate (section 00).
- **Tick spacing:** approximately 1% of floor price, subject to SDK derivation and validation.
- **Auction emission/supply schedule:** use the current audited SDK convex schedule derivation and independently validate significant final issuance; do not hand-invent a schedule.
- **Post-auction static LP fee planning input (LOCKED in section 00):** 0.25% static fee, conditional on integration/fork tests confirming pool parameters. Do not mislabel this technical compatibility gate as owner indecision.
- **Validation hook:** none by default unless legal/compliance or technical audit requires one.

### 4.1.4 Tiered LP allocation of ETH raised (historical; FINAL version with 5 ETH floor in section 00)

Current SDK supports bracketed LP allocations, but exact inclusive on-chain thresholds must be encoded and tested later. The objective is that weak/modest demand prioritizes liquidity, while stronger demand creates a modest operational reserve. Protocol fees, gas, and exact accounting must be deducted and verified in simulation; these percentages are not net guaranteed proceeds.

| Raise range | LP allocation | Operational remainder to configured treasury recipient |
|---|---|---|
| Below 15 ETH | 100% | 0% |
| 15 ETH up to but below 30 ETH | 90% | 10% |
| 30 ETH or more | 80% | 20% |

### 4.1.5 Current-price illustrative economics only (NOT frozen or promised)

The following price snapshot is **illustrative and stale immediately after writing**. Using ETH ≈ **$2,513.57** on 2026-09-12, and assuming for illustration only that all 150,000,000 auction tokens are sold at an average clearing price:

| ETH raised | USD contributed (illustrative) | Simplified implied FDV (illustrative) | LP allocation | Treasury remainder |
|---|---|---|---|---|
| 5 ETH | ~$12,568 | ~$83,786 | 5 ETH | 0 ETH |
| 10 ETH | ~$25,136 | ~$167,573 | 10 ETH | 0 ETH |
| 15 ETH | ~$37,704 | ~$251,359 | 13.5 ETH | 1.5 ETH |
| 30 ETH | ~$75,407 | ~$502,718 | 24 ETH | 6 ETH |
| 50 ETH | ~$125,679 | ~$837,864 | 40 ETH | 10 ETH |

Actual CCA clearing, unsold tokens, protocol fees, and position construction mean real outcomes can differ materially. These figures are a planning sensitivity table, not a guarantee, prediction, or offering document.

### 4.1.6 LP custody / creator-fee preference (HISTORICAL — SUPERSEDED by section 00 item 5)

Prefer permanent/non-ruggable LP custody using the current creator-fees-on `FeeSplitter` path **if and only if** the existing-token LBP path can correctly register and route PEPECARTEL's beneficiary. Current SDK history indicates that new auction/crowd-launch positions on Robinhood need the current creator-fees position recipient, but addresses and beneficiary compatibility have changed through redeploys. Therefore **do not pin a production address in this master plan**.

**2026-10-01 caution:** `UERC20BeneficiaryVault` creator attribution behaves specifically for launcher-created UERC20 tokens, and PCART is a custom existing token. So creator-fee/treasury routing for PCART is **OPEN** and needs explicit proof. The fees-off/autocompound FeeSplitter is a candidate for permanent LP custody only. Any position sent to a FeeSplitter can never be recovered, by design. The exact choice is an L-S5/L-S7 gate.

This is a **hard PCART-L5 reverification gate**. If existing-token beneficiary routing cannot be proven before execution, stop and audit a timelocked or alternative LP custody + fee collection design rather than improvising.

### 4.1.7 Recommendation disposition

- **PCART-L1A ECONOMICS:** historically owner-approved (2026-09); **partly SUPERSEDED 2026-10-01** (section 0).
- **Balanced 150M / 200M / 150M split:** carried-forward working allocation pending L-S5 (not frozen).
- **Old 24h window and old 10 ETH graduation minimum:** SUPERSEDED (historical). Tiered 100-90-80 LP schedule and 0.25% fee: now LOCKED in section 00 (with 5 ETH floor / 30 ETH target); 50 ETH floor-FDV is historical illustration only. Not execution authorization.
- **Formerly open before PCART-L1 could close:** exact operational ETH reserve for gas, exact multisig implementation/address, legal/comms review, live Robinhood/Uniswap compatibility confirmation, and fork/testnet simulation. These are now dispositioned in section 14 as **POLICY CLOSED / EXECUTION PREREQUISITES PENDING** (fork/testnet simulation split into L1-e1 policy evidence and L1-e2 mandatory Phase 3 exact-artifact rehearsal). Exact on-chain encoding is derived from these frozen policies in PCART-L5.
- **No Solidity or value-moving action until those gates close.**

## 5. Utility model

$PCART is the ecosystem utility token for PEPECARTEL and CARTEL HQ. Utility lives in CARTEL HQ services, not in the immutable ERC-20. Utility policy must be versioned outside the token contract.

**Frozen launch-day utility tiers (chain-verified wallet holdings):**

| Tier | Holdings | Benefits |
|---|---|---|
| Verified Holder | 1+ PCART | Holder identity/badge/community role and eligible community participation. |
| Cartel Member | 10,000+ PCART | 5% discount on eligible CARTEL HQ paid services plus member utility features. |
| Cartel Capo | 100,000+ PCART | 10% discount plus premium features / priority beta access. |
| Cartel Boss | 1,000,000+ PCART | 20% discount plus highest utility tier, premium features and future launchpad benefits. |

Safety-critical functionality such as verified contract information, anti-scam protections, and critical launch communications must not be gated by token holdings.

Additional candidate utilities to activate over time:
- verified-holder identity/badges and community roles;
- holder-only community areas/content/events where appropriate;
- Sticker Lab benefits such as discounts, credits, enhanced generation limits/features;
- AI Operator / AI usage discounts or additional allowances;
- future launchpad fee discounts / platform-service benefits;
- premium project-profile, analytics, creative, broadcast, or other non-safety features;
- NFT Studio or future ecosystem-service benefits;
- optional advisory/community voting on non-financial product/cultural topics;
- potential future optional PCART payment paths only after separate audit.

## 6. Securities / communications risk guardrails

Design and market PCART as genuine utility/culture functionality, not equity or a claim on CARTEL HQ.

Do not promise or encode:
- dividends or ownership of CARTEL HQ;
- revenue/profit share paid to holders merely for holding;
- guaranteed APY/passive yield;
- guaranteed returns or price appreciation;
- entitlement to company/platform profits or assets;
- marketing that buyers should expect the team’s future managerial work to increase token value.

**There is no passive holder revenue, dividends, guaranteed APY/yield, or entitlement to CARTEL HQ revenue. Treasury revenue is for project/ecosystem operations, not pro-rata holder distributions.**

A transfer tax or liquidity-layer fee paid to a project treasury is not assumed by this plan to determine securities status. Final token terms, distribution and public communications require qualified U.S. crypto/securities counsel review before public offering/launch. Do not claim legal certainty.

## 7. Public launchpad architecture

The future CARTEL HQ launchpad does NOT need a second PEPECARTEL ecosystem token. $PCART remains the ecosystem utility token.

Tokens created for third-party projects are separate project tokens and should use separate, versioned, audited generic contract templates, not the PEPECARTEL-specific artifact.

Initial generic template direction:
- `cartel-standard-erc20-v1`
- configurable name, symbol, fixed supply, recipient;
- 18 decimals;
- mint once;
- no owner/admin after deployment;
- no future mint;
- no tax, blacklist, freeze, pause, proxy, hidden transfer restrictions.

Avoid an arbitrary “toggle anything” Solidity generator. Future optional capabilities should be separate audited artifact versions with explicit IDs, hashes, verifier support, and audits.

## 8. Required launch phases

### PCART-L0 — Master decisions / no build

Status: IN PROGRESS.
Freeze exact tokenomics allocation, custody/treasury architecture, utility launch set, liquidity/trading-fee revenue model, legal/comms review scope, and final contract requirements.

### PCART-L1 — Utility + tokenomics + treasury specification freeze

Status: **POLICY CLOSED / EXECUTION PREREQUISITES PENDING.** Strategic tokenomics, utility, custody, trading-revenue and launch-distribution direction approved; PCART-L1A CCA auction economics were historically owner-approved; as of 2026-10-01 the old 24h window and 10 ETH graduation minimum are SUPERSEDED (historical) and the 150M/200M/150M split is FINAL per L-S5 (section 00). The formerly open inputs — operational ETH reserve, multisig implementation, internal comms policy, live Robinhood/Uniswap compatibility, and fork/testnet simulation sequencing — are dispositioned in **section 14**. POLICY CLOSED does **not** mean launch-ready, execution-ready or mainnet-ready; every execution prerequisite in section 14 remains PENDING.

No deployment.
Required outputs:
- exact 1B allocation percentages and vesting/lock policy if applicable; ✅ FROZEN: 50% public launch + liquidity, 20% ecosystem + community, 15% treasury, 10% team (zero liquid at launch; historical 12-month schedule SUPERSEDED — 24-month linear, no cliff, section 00), 5% strategic partnerships (6-month lock + 24-month linear release);
- initial recipient/treasury architecture, preferably hardened/multisig rather than an ordinary hot wallet; ✅ FROZEN PREFERRED: 2-of-3 multisig, separate from deployer/everyday wallet;
- exact launch-day utility benefits and any holder thresholds/discount formulas; ✅ FROZEN: Verified Holder 1+, Cartel Member 10,000+ (5% discount), Cartel Capo 100,000+ (10% discount), Cartel Boss 1,000,000+ (20% discount);
- explicit non-security-style utility/comms guardrails; ✅ FROZEN: no passive revenue, no dividends, no guaranteed yield, treasury revenue for operations;
- final decision: 0% transfer tax plus liquidity-layer fee revenue versus separate taxed-token architecture; ✅ FROZEN: 0% transfer tax, liquidity-layer creator/LP fee revenue preferred;
- launch-distribution and price-discovery method: ✅ FROZEN: public onchain CCA/LBP launch auction (Option A), because the project does not expect to supply all required launch liquidity ETH itself. CCA/LBP is a public onchain token sale/auction economically, not a private fixed-price presale. Choosing CCA/LBP can reduce required project ETH for initial liquidity but does NOT mean zero ETH; ETH is still required for deployment/gas and may be required for additional auction/liquidity/operational configuration.
- liquidity budget and intended launch pricing/strategy inputs, without sending value. ✅ LOCKED L-S5 (2026-10-01): 150M CCA auction / 200M reserved LP / 150M future reserve; old 24h window and old 10 ETH graduation minimum SUPERSEDED (historical) — ~96h auction, Graduation Floor 5 ETH, Target Raise 30 ETH (section 00). ✅ POLICY CLOSED in section 14: operational ETH reserve policy (0.10 ETH reserve / 0.05 ETH execution-wallet floor), multisig implementation choice (Safe v1.4.1 SafeL2 + SafeProxyFactory, 2-of-3), internal comms policy, dated Robinhood/Uniswap compatibility manifest, and L1-e1 infrastructure/protocol compatibility evidence. ⏳ STILL PENDING AS EXECUTION PREREQUISITES: actual Safe deployment, signer addresses, Safe/treasury recipient address, stronger Safe verification, funded execution wallet, external legal review if required, Phase 2 compilation, L1-e2 exact-artifact testnet rehearsal, and pre-L5 on-chain revalidation.

STOP for approval before proceeding to L2. L1 POLICY is closed; PCART-L2 still requires separate explicit authorization, and no execution prerequisite in section 14 may be assumed satisfied.

### PCART-L2 — Dedicated production contract artifact

Only after L1 fully closes.
Create `PepeCartelToken.sol` / `pepecartel-token-v1` with the frozen token behavior. Prefer hard-coded PEPECARTEL/PCART/1,000,000,000/18 and constructor-controlled initial treasury only unless L1 explicitly changes this. Compile reproducibly, pin creation/runtime hashes, document compiler/OpenZeppelin settings, and add exact verifier support without weakening generic/testnet paths.
No mainnet transaction.
STOP for audit.

### PCART-L3 — Exact-artifact testnet rehearsal

Deploy the exact production artifact on Robinhood Chain Testnet 46630 using the protected flow. Verify name, symbol, 18 decimals, exactly 1B supply, treasury balance, creation/runtime bytecode hashes, recovery/idempotency, and mobile wallet behavior. Test every failure gate. No mainnet value.
STOP unless all tests pass.

### PCART-L4 — CARTEL HQ PCART Utility Engine

Build the modular utility layer using chain-verified wallet holdings, with server-side/RLS protections as appropriate. Utility policy must be versioned outside the token contract. Test against testnet PCART artifact. At least meaningful real utilities should be ready before public launch rather than only promised for the future.
STOP for QA.

### PCART-L5 — Liquidity + trading-revenue production design

Reverify current Robinhood Chain and Uniswap LiquidityLauncher contracts/code hashes/SDK revision on chain 4663. Determine exact supported strategy for the already-deployed PEPECARTEL token.
Priority: evaluate standard ERC-20 + audited creator/LP fee revenue without fee-on-transfer behavior, and existing-token CCA/LBP compatibility for the approved allocation.
Freeze: liquidity amounts, paired ETH, price/auction/instant-launch strategy, pool parameters, beneficiary/treasury destination, protocol fee/creator-fee treatment (creator-fee revenue not launch-critical per section 00), LP ownership/lock/compounding rules, approvals/Permit2, slippage/deadline, recovery/finality, and revenue accounting.
If current LiquidityLauncher / CCA/LBP path cannot satisfy the revenue model or the approved tokenomics, STOP and separately audit alternatives. Never silently add token transfer taxes.
No liquidity send until separately authorized.

### PCART-L6 — Legal/comms + public-surface readiness

Qualified counsel review of final token terms, allocation, launch/distribution method, trading-fee/treasury model, utilities and marketing language.
Correct stale public PEPECARTEL website references to Solana/Pump.fun and align all official surfaces to Robinhood Chain only after the launch plan is frozen.
Prepare verified-contract anti-scam messaging, risk disclosures, and official-channel communication plan. Do not imply Robinhood Chain deployment means Robinhood brokerage listing.
STOP for final launch authorization.

### PCART-L7 — Mainnet production deployment request

In Launch Control, create the immutable PEPECARTEL production deployment request using the approved exact supply and treasury. Owner review only. No transaction occurs merely because the request exists.
STOP and verify immutable intent.

### PCART-L8 — Protected Robinhood Chain mainnet deployment

Use the existing protected production path: request approval/execution binding -> attempt -> managed pre-sign -> runtime read -> ARM -> CLAIM -> one short send window -> one wallet send -> persist exact tx hash -> reconciliation -> independent managed-RPC verification -> managed finalized evidence.
Never retry/rebroadcast an ambiguous value-moving transaction automatically.
STOP after CONFIRMED + FINALIZED evidence.

### PCART-L9 — Explorer source verification + official registration

Verify the exact production source/compiler settings on Robinhood Chain Blockscout. Then, only from verified managed-finalized deployment evidence, deliberately register the official PCART contract through Launch Control. Registration is permanent and is not itself “trading live.”
STOP and re-audit public CA.

### PCART-L10 — Real liquidity execution and verification

Only after L5 is built/audited and L8/L9 are complete. Perform separately authorized approval/Permit2 and liquidity/launch transaction(s), then independently verify protocol/pool/auction state and managed finality. No “LIVE” communications until the required liquidity/trading evidence is complete.
STOP after verified liquidity.

### PCART-L11 — Public go-live

Update official website and CARTEL HQ public surfaces with the verified official CA, chain, and trading access. Use existing Launch Watch/Telegram official broadcast infrastructure for explicit announcements. Never auto-blast an unverified CA. Activate the approved PCART utilities. Begin monitoring contract, pool/liquidity, RPC health, bot communications, utility balance reads, and incident-response procedures.

### PCART-L12 — Post-launch launchpad expansion

After PCART is stable, expand CARTEL HQ for third-party production launches using a versioned audited artifact registry and generic contract templates. Integrate PCART as platform utility/discount/access where legally and product-wise appropriate. Do not create a second launcher token merely because the launcher expands.

## 9. Current known baseline

- CARTEL HQ has proven a real Robinhood Chain mainnet ERC-20 canary deployment on chain 4663 with managed finality.
- Official PEPECARTEL mainnet contract is NOT deployed or registered.
- PEPECARTEL launch record is on Robinhood Chain and currently has no official contract.
- Existing mainnet deployment pipeline is protected by compiled capability plus runtime stop/ARM/claim/send-window controls and independent verification.
- Mainnet liquidity execution remains a separate unfinished/disabled area and must be completed before a full tradable launch through CARTEL HQ can be certified.
- Current public PEPECARTEL website contains stale Solana/Pump.fun references that must be corrected before launch.

## 10. Strict continuation protocol

At the start of every future phase:
1. Read this file first.
2. Audit current Lovable HEAD and live Supabase state before editing.
3. Reconfirm system-of-record boundaries and current Robinhood/Uniswap external facts.
4. Use the smallest allowlist possible.
5. Reuse existing launcher/verification/Telegram/Launch Watch infrastructure; do not duplicate it.
6. Run tests and report exact diffs/state changes.
7. Stop at the named checkpoint. Never jump directly from planning to mainnet value movement.
8. A user saying “proceed” means proceed only to the next incomplete phase/checkpoint, not permission to skip irreversible safety gates.

## 11. Immediate next phase

PCART-L1A economics were historically owner-approved and are partly superseded by section 0 (2026-10-01); PCART-L1 is now **POLICY CLOSED / EXECUTION PREREQUISITES PENDING** per section 14. What remains is execution work, not policy: the actual Safe, its signers and address, stronger Safe verification, a funded execution wallet, Phase 2 compilation, the L1-e2 exact-artifact testnet rehearsal, pre-L5 on-chain revalidation, and exact on-chain encoding derived from the section 0 direction after the L-S5 design lock.

**Immediate next phase:** PCART-L2 Phase 2 — reproducible compilation and freezing of `pepecartel-token-v1` — which requires **separate explicit authorization** and has not been started. Do not authorize Solidity compilation, Safe creation or value movement merely by this documentation closure. (Narrow owner-authorized exception for a DRAFT, non-compiled, non-frozen, non-allowlisted source file only: see section 13.)

*Superseded by section 15: PCART-L2 Phase 2 was subsequently authorized and is now COMPLETE (compiled + frozen repository artifact only). The immediate next phase is now PCART-L2 Phase 3 — exact-artifact testnet rehearsal.*

## 12. PCART-L1B — Safe Treasury Verification Foundation (BUILT, QA-PASSED)

**Status: BUILT AND QA-PASSED.** A read-only Safe treasury verifier exists in CARTEL HQ for Robinhood Chain mainnet (4663). An authenticated workspace owner can check the production-recipient address already entered in Launch Control and see whether it is a Safe-compatible 2-of-3 multisig.

Scope and limits of what was built:
- Server-side, authenticated, read-only only: `eth_chainId`, `eth_getCode`, and `eth_call` for `getOwners()`, `getThreshold()` and optional `VERSION()`, over the existing managed Robinhood mainnet RPC path only. No second RPC transport, no client-side RPC URL.
- Suitability requires contract code present, exactly 3 unique non-zero owners, threshold exactly 2, and successful decoding. Every malformed, reverted, wrong-chain or ambiguous outcome fails closed.
- The result is labelled Safe-**compatible** 2-of-3 based on live interface reads. It is NOT cryptographic proof of a specific Safe proxy/singleton version.
- Ephemeral only: no Supabase migration, no schema change, no persistence, no lifecycle change, no Telegram, no wallet signing, no transaction, no value movement, no liquidity change. Mainnet runtime execution control and `MAINNET_LIQUIDITY_TX_ENABLED` were untouched.
- No production-request submission gating was added. Generic launchpad users are NOT forced into a 2-of-3 Safe.

**Still unresolved:** the actual PEPECARTEL Safe has NOT been created. The Safe address and the 3 signer addresses remain undetermined, and no PCART initial recipient is fixed. PCART-L1 remains OPEN.

### 12.1 Canonical Safe v1.4.1 hardening (BUILT / LIVE VALIDATION PENDING)

A later, separately authorized read-only, repo-only unit replaced the ABI-only suitability check with a **canonical Safe v1.4.1 profile check**: exact SafeProxy runtime code-hash match, `masterCopy()` equal to the canonical SafeL2 v1.4.1 singleton, strict `VERSION()` exactly `1.4.1` (no longer optional), readable `nonce()`, empty modules with the sentinel `next`, zero/unset transaction guard, plus the existing 3 unique non-zero owners and threshold 2. Reads use the managed server RPC only (`eth_chainId`, `eth_getCode`, `eth_getStorageAt`, and read-only `eth_call`), are authenticated, and fail closed on any failed, reverted or malformed read. See `docs/PCART_L1_CLOSURE_PACK.md` section 2.2.

**Still PENDING:** a live pass against the future actual PEPECARTEL Safe, and the exact selected owner-address match. No Safe was created, no signers were selected, and the verifier remains **non-gating** for production request submission. A canonical pass is not a PEPECARTEL treasury approval.

## 13. PCART-L1/L2 Phase 1 — narrow owner-authorized DRAFT Solidity exception

**PCART-L1 remains OPEN.** Every open L1 item in sections 4.1.7, 8 (L1) and 12 stands unchanged, and every frozen economic/tokenomic decision in sections 2, 3, 4 and 5 stands unchanged. This section adds no authorization beyond the single exception below.

**Exception (owner-authorized):** a DRAFT, NON-COMPILED, NON-FROZEN, NON-ALLOWLISTED `contracts/PepeCartelToken.sol` may exist in the repository during PCART-L1, solely for source-level review and static regression testing. Its specification is `docs/PCART_L2_TOKEN_SPECIFICATION.md`; its static guardrails are `scripts/pcart-l2-draft-artifact-regression.ts`.

**This exception does NOT authorize:** compilation or any build tooling; creation of a frozen artifact or `pepecartel-token-v1` artifact id; pinning of creation/runtime bytecode hashes; production artifact allowlisting or verifier support; any database, schema, RPC, policy or migration change; any PCART production deployment request; testnet deployment; mainnet deployment; mainnet ARM/CLAIM/send-window action; Safe deployment; liquidity, CCA or LBP work; or any value movement.

**PCART-L2 may not begin until PCART-L1 is explicitly closed** and L2 is separately authorized. The only production-allowlisted artifact remains `cartel-fixed-erc20-v1`, unchanged in identity, bytecode and hashes.

*Status note (section 14): PCART-L1 is now POLICY CLOSED. Section 13's DRAFT exception and its list of non-authorizations stand unchanged, and PCART-L2 still requires separate explicit authorization.*

## 14. PCART-L1 Closure — POLICY CLOSED / EXECUTION PREREQUISITES PENDING

Date: 2026-09-20. Authoritative record: `docs/PCART_L1_CLOSURE_PACK.md`, with `docs/PCART_L1_CHAIN_COMPATIBILITY_MANIFEST.md` (v1) and `docs/PCART_L1_COMMS_RULES.md` (v1). Static guardrails: `scripts/pcart-l1-closure-regression.ts`.

Every frozen tokenomics, allocation, vesting, utility and CCA-economics value in sections 2, 3, 4, 4.1 and 5 stands **unchanged**. This section changes status only.

**POLICY CLOSED does not mean launch-ready, execution-ready or mainnet-ready.** It authorizes no Safe creation, no compilation, no artifact, no SQL, no production request, no testnet or mainnet transaction, no wallet funding, no ARM/CLAIM/send window, no liquidity execution, no deploy/publish and no value movement.

### 14.1 Closed policy items

1. **Operational ETH policy.** 0.10 ETH frozen as the operational gas reserve budget, separate from liquidity/CCA funding; at least 0.05 ETH must be immediately available in the designated execution wallet before any mainnet PCART deployment/launch execution action. These are budget guardrails, not gas predictions and not authorization to spend; live gas estimation plus a substantial safety margin remains mandatory at execution time. Documentation only — no runtime balance gate was added.
2. **Treasury implementation choice.** Safe v1.4.1 SafeL2 + SafeProxyFactory on Robinhood Chain 4663, exactly 3 unique non-zero owners, threshold 2. **The actual PEPECARTEL Safe does not exist**; signers, Safe address and PCART treasury recipient remain unresolved and are not invented anywhere.
3. **Internal communications policy.** Recorded in `docs/PCART_L1_COMMS_RULES.md`. This is an internal policy only; **no legal counsel review and no legal/compliance approval is claimed**, and external legal review, if the owner requires it, remains a separate owner-side prerequisite.
4. **Robinhood/Uniswap compatibility manifest.** Dated 2026-09-20, version v1, every external address marked RESEARCHED / NOT ON-CHAIN VERIFIED, with mandatory independent on-chain revalidation immediately before L5 and a fail-closed mismatch rule.
5. **L1-e1 infrastructure/protocol compatibility evidence.** The already-finalized separate generic mainnet canary (protected chain / RPC / gas / evidence / finality rails), plus the dated manifest, plus static/read-only checks.

### 14.2 L1-e1 / L1-e2 sequencing

The former single "fork/testnet simulation" prerequisite was circular — it required exact-artifact simulation before L1 closure, while the exact PCART artifact is deliberately uncompiled until Phase 2, which only begins after closure. It is **split, not waived**:

- **L1-e1** — infrastructure/protocol compatibility evidence. **Closes L1 policy.**
- **L1-e2** — exact-artifact rehearsal. **Remains mandatory Phase 3**, after Phase 2 compiles and freezes `pepecartel-token-v1`. It **MUST pass on Robinhood testnet 46630 before any PCART mainnet deployment.** Relocated, not waived.

### 14.3 Pending execution prerequisites

Actual PCART Safe deployment; exact 3 signer addresses; actual Safe address and PCART treasury recipient; stronger Safe verification (singleton/masterCopy equals canonical SafeL2, proxy runtime code hash match, strict readable `VERSION()` = 1.4.1, empty modules, zero/unset guard, readable `nonce()`, owners exactly the selected 3 signers, threshold exactly 2 — fail closed on ambiguity) implemented and passing against the real Safe; funded execution wallet satisfying the 0.05 ETH floor at execution time; external legal review if the owner requires it; Phase 2 compilation and frozen artifact, separately authorized; Phase 3 exact-artifact testnet rehearsal; independent on-chain revalidation of the compatibility manifest immediately before L5; and every existing deployment/liquidity safety gate, unchanged.



## 15. PCART-L2 Phase 2 — reproducible compile + frozen artifact (COMPLETE, repo-only)

Date: 2026-09-20. Status update only. Every frozen tokenomics, allocation, vesting, utility, CCA-economics, treasury and comms decision in sections 2, 3, 4, 4.1, 5, 13 and 14 stands **unchanged**.

`contracts/PepeCartelToken.sol` has been reproducibly compiled out of band and frozen in the repository as artifact id `pepecartel-token-v1`:

- `artifacts/pepecartel-token-v1.compiler-input.json` — canonical, self-contained standard-JSON compiler input
- `artifacts/pepecartel-token-v1.manifest.json` — frozen manifest
- `src/lib/pepecartel-token.artifact.ts` — ABI, creation + runtime bytecode and keccak hashes

solc `0.8.36+commit.8a079791.Emscripten.clang`, OpenZeppelin Contracts `5.6.1`, optimizer enabled runs 200, viaIR false, evmVersion `paris`, metadata bytecodeHash `none`, appendCBOR false. Creation bytecode keccak256 `0x2edebe9de5877c0775dc87644ca9051a54034f4eee8bd9662c7657d0fd3c2196`; deployed runtime bytecode keccak256 `0x69ef7ad36b6c4b900d390bc4977eb61a518e9d35e506a6f83712192c7e7d03e4`.

**This phase authorized nothing operational.** The artifact is NOT production-allowlisted (the only allowlisted artifact remains `cartel-fixed-erc20-v1`), NOT deployed, and has passed NO testnet rehearsal. No SQL, no Safe, no wallet, no signature, no testnet or mainnet transaction, no deployment request, no liquidity action. The `treasury_` recipient remains unresolved.

**Immediate next phase:** PCART-L2 Phase 3 — exact-artifact testnet rehearsal of the frozen `pepecartel-token-v1` artifact — which requires separate explicit authorization. Production allowlist integration is a distinct later phase. Static guardrails: `scripts/pcart-l2-draft-artifact-regression.ts` and `scripts/pcart-l2-frozen-artifact-regression.ts`.
