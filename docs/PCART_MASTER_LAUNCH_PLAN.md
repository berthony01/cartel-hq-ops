# PCART Master Launch Plan

Date: 2026-09-12
Status: Authoritative working plan / DOCUMENTATION ONLY
Project: PEPECARTEL ($PCART) on Robinhood Chain

## 1. Core objective

Launch the official PEPECARTEL token, ticker PCART, on Robinhood Chain mainnet (chain ID 4663), make it publicly tradable only after deployment verification, managed finality, source verification, official-contract registration, and independently verified liquidity/trading readiness.

## 2. Frozen token direction

- One official PEPECARTEL token only: $PCART.
- No separate “launcher token” is planned. CARTEL HQ / the future launchpad is software and may use $PCART as ecosystem utility.
- **Frozen total supply: exactly 1,000,000,000 PCART, 18 decimals, permanently fixed supply.**
- Dedicated production artifact for PEPECARTEL, separate from generic launchpad templates. Working artifact name: `pepecartel-token-v1`; working source name: `PepeCartelToken.sol`.
- **Frozen V1 token behavior: standard ERC-20; 0% fee-on-transfer / transfer tax; name/symbol/supply fixed; mint once at deployment to the deliberately chosen initial treasury; no post-deployment minting; no owner/admin; no blacklist/freeze; no pause; no max-wallet/max-tx; no proxy/upgradeability; no hidden transfer controls.**
- DO NOT finalize or deploy the Solidity until all remaining L1 inputs close and L1 is explicitly approved.

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

- **Team allocation:** 100,000,000 PCART vests linearly over 12 months from launch. **Zero team allocation is liquid or unlocked at launch.** Prefer continuous/time-based linear vesting so 100% is vested at 365 days; do not create a one-time 100M cliff unlock. Exact vesting contract implementation remains for a later audited step.
- **Strategic partnerships:** 50,000,000 PCART preserved with the recommended guardrail of a 6-month initial lock followed by 24-month linear release, unless later L1 approval explicitly changes it. Grants must be disclosed from the allocation, not treated as hidden discretionary supply.
- Public launch + liquidity, ecosystem + community, and treasury allocations are not subject to the above vesting locks unless separately decided.

### 3.3 Treasury architecture

- **Frozen preferred architecture: 2-of-3 multisig, separate from deployer/everyday wallet.**
- Treasury is intended to receive the 150M treasury allocation plus project trading-fee revenue and operational assets.
- Exact multisig implementation/addresses remain unresolved until chain compatibility and security audit are complete.

## 4. Transfer-tax / trading-revenue decision gate

User wants modest ongoing revenue from trading for marketing, production, and ecosystem operations.

**Frozen direction:** keep PCART a standard 0%-transfer-tax ERC-20 and seek project revenue through audited liquidity-layer creator/LP fees. The Uniswap LiquidityLauncher technical reference states rebasing and fee-on-transfer tokens are not compatible with LiquidityLauncher. The Robinhood Chain Uniswap stack currently exposes creator-fee / fee-splitter infrastructure, which may offer ongoing trading-fee revenue while keeping PCART a standard ERC-20. This must be reverified from current Uniswap code/on-chain contracts immediately before implementation.

**Frozen launch-distribution and price-discovery decision:** PEPECARTEL chooses **Option A: public onchain CCA/LBP launch auction** as the preferred launch path because the project does not expect to supply all required launch liquidity ETH itself. A Continuous Clearing Auction (CCA) / Liquidity Bootstrapping Pool (LBP) is a public onchain token sale/auction economically; it is not a private fixed-price presale. Do not market it as “no sale” or imply legal distinctions that have not been reviewed.

The current technical reason for choosing CCA/LBP is that Uniswap's LBP strategy can run a Continuous Clearing Auction, transfer raised currency to the LBP strategy, discover a market-clearing price, and migrate reserved token supply plus raised currency into Uniswap v4 liquidity according to configured migration parameters. Exact Robinhood Chain contracts, code hashes, parameters, auction amount, reserve/starting price, duration, LP allocation schedule, token/currency split, position recipient/lock, creator-fee compatibility, and failure-recovery behavior must be reverified in PCART-L5 before any execution.

Choosing CCA/LBP can reduce the amount of ETH the project must contribute for initial liquidity, but does NOT mean the launch requires zero ETH. PEPECARTEL still needs ETH for deployment/gas and may need additional ETH depending on final auction/liquidity configuration and operational requirements.

The 500,000,000 PCART public-launch/liquidity allocation is now frozen: 150,000,000 PCART maximum to the CCA public auction, 200,000,000 PCART reserved for token-side LBP migration/liquidity, and 150,000,000 PCART held as future liquidity/market reserve outside the initial launcher.

Important: creator-fee percentages are percentages of protocol/pool fee streams, NOT percentages of gross trade volume. No revenue projection is frozen.

**Treasury revenue policy target (non-contractual, adjustable):** 35% marketing/content/community growth; 35% CARTEL HQ development/infrastructure; 20% liquidity/security/reserve; 10% legal/audits/compliance/admin. This is an operating-policy target, not token-holder entitlement and not hard-coded in Solidity.

## 4.1 PCART-L1A — CCA Auction Economics Simulation (FROZEN / OWNER-APPROVED)

This section records the owner-approved and frozen CCA/LBP auction economics for the 500,000,000 PCART public launch + liquidity bucket. These parameters are frozen as planning inputs; they do not authorize execution.

### 4.1.1 Scenario comparison within the frozen 500M public-launch/liquidity bucket

| Scenario | Max auction supply | Reserved token-side LP budget | Future liquidity/market reserve |
|---|---|---|---|
| Conservative | 100,000,000 PCART | 150,000,000 PCART | 250,000,000 PCART |
| **Balanced (FROZEN / APPROVED)** | **150,000,000 PCART** | **200,000,000 PCART** | **150,000,000 PCART** |
| Aggressive | 200,000,000 PCART | 250,000,000 PCART | 50,000,000 PCART |

**Why Balanced is approved:** it exposes at most 15% of total supply to the initial auction, keeps a large 20% token-side LP budget available for migration, and retains another 15% of total supply as flexible future liquidity/market support. It avoids both a very small initial public distribution and committing almost the entire 500M bucket at launch.

### 4.1.2 Current Uniswap LBP mechanical fit (must be reverified before execution)

Current-source finding: `LBPStrategy` splits the amount deposited into auction supply (`distribution amount minus reservedTokenAmountForLP`) while `reservedTokenAmountForLP` stays in the strategy for migration. Under the frozen approved candidate, the planned LBP deposit would therefore be **350,000,000 PCART**, with **200,000,000 PCART reserved** and up to **150,000,000 PCART** sent to the CCA. The other **150,000,000 PCART** from the 500M bucket remains outside this launch transaction as designated future liquidity/market reserve.

Unused migration currency and unused reserved LP tokens return to the configured recipient; failed-migration recovery also returns raised currency and reserved tokens to the recipient. These mechanics are **not frozen external facts** and must be reverified against current Robinhood Chain/Uniswap contracts and SDK immediately before build/execution.

### 4.1.3 FROZEN auction parameters (planning inputs, not execution authorization)

- **Raise currency:** native ETH.
- **Public onchain CCA/LBP launch path:** remains frozen.
- **Max auction supply:** 150,000,000 PCART.
- **Reserved token-side LP budget:** 200,000,000 PCART.
- **Future liquidity/market reserve outside launcher:** 150,000,000 PCART.
- **Auction window:** 24 hours is the approved planning parameter, subject only to exact block/timing derivation during implementation.
- **Frozen floor FDV planning guardrail:** 50 ETH equivalent across the 1,000,000,000 PCART total supply. This is an approved planning input, not a promised valuation or fundraising target.
- **Frozen graduation minimum / `requiredCurrencyRaised` planning gate:** 10 ETH. This is an approved minimum launch-liquidity planning gate, not a fundraising target.
- **Tick spacing:** approximately 1% of floor price, subject to SDK derivation and validation.
- **Auction emission/supply schedule:** use the current audited SDK convex schedule derivation and independently validate significant final issuance; do not hand-invent a schedule.
- **Frozen post-auction static LP fee planning input:** 0.25%, technically conditional on live Robinhood Chain v4 pool-key availability / creator-fee compatibility. Do not mislabel this technical compatibility gate as owner indecision.
- **Validation hook:** none by default unless legal/compliance or technical audit requires one.

### 4.1.4 FROZEN tiered LP allocation of ETH raised

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

### 4.1.6 Frozen LP custody / creator-fee preference

Prefer permanent/non-ruggable LP custody using the current creator-fees-on `FeeSplitter` path **if and only if** the existing-token LBP path can correctly register and route PEPECARTEL's beneficiary. Current SDK history indicates that new auction/crowd-launch positions on Robinhood need the current creator-fees position recipient, but addresses and beneficiary compatibility have changed through redeploys. Therefore **do not pin a production address in this master plan**.

This is a **hard PCART-L5 reverification gate**. If existing-token beneficiary routing cannot be proven before execution, stop and audit a timelocked or alternative LP custody + fee collection design rather than improvising.

### 4.1.7 Recommendation disposition

- **PCART-L1A ECONOMICS:** **OWNER-APPROVED AND FROZEN**.
- **Balanced 150M / 200M / 150M split:** **FROZEN**.
- **24h window / 50 ETH floor-FDV / 10 ETH graduation minimum / tiered 100-90-80 LP schedule / 0.25% fee:** **FROZEN PLANNING INPUTS**, not execution authorization.
- **Still OPEN before PCART-L1 can fully close:** exact operational ETH reserve for gas, exact multisig implementation/address, legal/comms review, live Robinhood/Uniswap compatibility confirmation, and fork/testnet simulation. Exact on-chain encoding is derived from these frozen policies in PCART-L5.
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

Status: **Strategic tokenomics, utility, custody, trading-revenue and launch-distribution direction substantially approved; PCART-L1A CCA auction economics are now OWNER-APPROVED AND FROZEN (Balanced 150M/200M/150M split, 24h window, 50 ETH floor-FDV planning guardrail, 10 ETH graduation-minimum planning gate, tiered 100-90-80 LP allocation, 0.25% static LP fee planning input). L1 is NOT fully closed until exact operational ETH reserve for gas, exact multisig implementation/address, legal/comms review, live Robinhood/Uniswap compatibility, and fork/testnet simulation inputs are resolved.**

No deployment.
Required outputs:
- exact 1B allocation percentages and vesting/lock policy if applicable; ✅ FROZEN: 50% public launch + liquidity, 20% ecosystem + community, 15% treasury, 10% team (12-month linear vesting, zero liquid at launch), 5% strategic partnerships (6-month lock + 24-month linear release);
- initial recipient/treasury architecture, preferably hardened/multisig rather than an ordinary hot wallet; ✅ FROZEN PREFERRED: 2-of-3 multisig, separate from deployer/everyday wallet;
- exact launch-day utility benefits and any holder thresholds/discount formulas; ✅ FROZEN: Verified Holder 1+, Cartel Member 10,000+ (5% discount), Cartel Capo 100,000+ (10% discount), Cartel Boss 1,000,000+ (20% discount);
- explicit non-security-style utility/comms guardrails; ✅ FROZEN: no passive revenue, no dividends, no guaranteed yield, treasury revenue for operations;
- final decision: 0% transfer tax plus liquidity-layer fee revenue versus separate taxed-token architecture; ✅ FROZEN: 0% transfer tax, liquidity-layer creator/LP fee revenue preferred;
- launch-distribution and price-discovery method: ✅ FROZEN: public onchain CCA/LBP launch auction (Option A), because the project does not expect to supply all required launch liquidity ETH itself. CCA/LBP is a public onchain token sale/auction economically, not a private fixed-price presale. Choosing CCA/LBP can reduce required project ETH for initial liquidity but does NOT mean zero ETH; ETH is still required for deployment/gas and may be required for additional auction/liquidity/operational configuration.
- liquidity budget and intended launch pricing/strategy inputs, without sending value. ✅ FROZEN: 500M public-launch/liquidity bucket split as 150M CCA auction / 200M reserved token-side LP budget / 150M future liquidity/market reserve; 24h window; 50 ETH floor-FDV planning guardrail; 10 ETH graduation-minimum planning gate; tiered 100-90-80 LP allocation; 0.25% static LP fee planning input. ⏳ STILL OPEN: exact operational ETH reserve for gas, multisig implementation/address, legal/comms review, live Robinhood/Uniswap compatibility, and fork/testnet simulation. These remain for PCART-L5/L6.

STOP for approval before proceeding to L2. L1 is not closed while the open items above remain unresolved.

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
Freeze: liquidity amounts, paired ETH, price/auction/instant-launch strategy, pool parameters, beneficiary/treasury destination, protocol fee/creator-fee treatment, LP ownership/lock/compounding rules, approvals/Permit2, slippage/deadline, recovery/finality, and revenue accounting.
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

PCART-L1A economics are now OWNER-APPROVED AND FROZEN. L1 remains open only for genuinely unresolved implementation gates: exact operational ETH reserve for gas, exact multisig implementation/address, legal/comms review, live Robinhood/Uniswap compatibility confirmation, fork/testnet simulation, and exact on-chain encoding derived from frozen policy.

**Immediate next phase:** read-only Treasury/Multisig Implementation + Live Robinhood/Uniswap CCA Compatibility Audit. Do not authorize Solidity or value movement merely by this documentation freeze. Do not write Solidity or initiate a production deployment until L1 fully closes.

## 12. PCART-L1B — Safe Treasury Verification Foundation (BUILT, QA-PASSED)

**Status: BUILT AND QA-PASSED.** A read-only Safe treasury verifier exists in CARTEL HQ for Robinhood Chain mainnet (4663). An authenticated workspace owner can check the production-recipient address already entered in Launch Control and see whether it is a Safe-compatible 2-of-3 multisig.

Scope and limits of what was built:
- Server-side, authenticated, read-only only: `eth_chainId`, `eth_getCode`, and `eth_call` for `getOwners()`, `getThreshold()` and optional `VERSION()`, over the existing managed Robinhood mainnet RPC path only. No second RPC transport, no client-side RPC URL.
- Suitability requires contract code present, exactly 3 unique non-zero owners, threshold exactly 2, and successful decoding. Every malformed, reverted, wrong-chain or ambiguous outcome fails closed.
- The result is labelled Safe-**compatible** 2-of-3 based on live interface reads. It is NOT cryptographic proof of a specific Safe proxy/singleton version.
- Ephemeral only: no Supabase migration, no schema change, no persistence, no lifecycle change, no Telegram, no wallet signing, no transaction, no value movement, no liquidity change. Mainnet runtime execution control and `MAINNET_LIQUIDITY_TX_ENABLED` were untouched.
- No production-request submission gating was added. Generic launchpad users are NOT forced into a 2-of-3 Safe.

**Still unresolved:** the actual PEPECARTEL Safe has NOT been created. The Safe address and the 3 signer addresses remain undetermined, and no PCART initial recipient is fixed. PCART-L1 remains OPEN.

