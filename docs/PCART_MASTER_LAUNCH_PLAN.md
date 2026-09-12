# PCART Master Launch Plan

Date: 2026-09-12
Status: Authoritative working plan / DOCUMENTATION ONLY
Project: PEPECARTEL ($PCART) on Robinhood Chain

## 1. Core objective

Launch the official PEPECARTEL token, ticker PCART, on Robinhood Chain mainnet (chain ID 4663), make it publicly tradable only after deployment verification, managed finality, source verification, official-contract registration, and independently verified liquidity/trading readiness.

## 2. Frozen token direction

- One official PEPECARTEL token only: $PCART.
- No separate “launcher token” is planned. CARTEL HQ / the future launchpad is software and may use $PCART as ecosystem utility.
- Proposed/favored total supply: 1,000,000,000 PCART, 18 decimals, permanently fixed supply.
- Dedicated production artifact for PEPECARTEL, separate from generic launchpad templates. Working artifact name: `pepecartel-token-v1`; working source name: `PepeCartelToken.sol`.
- Preferred PCART production contract architecture: standard ERC-20; name/symbol/supply fixed; mint once at deployment to a deliberately chosen initial recipient/treasury; no post-deployment minting; no owner/admin; no blacklist/freeze; no pause; no max-wallet/max-tx; no proxy/upgradeability; no hidden transfer controls.
- DO NOT finalize or deploy the Solidity until tokenomics, custody/treasury, utility, liquidity-revenue model, and legal/comms review gates below close.

## 3. Transfer-tax / trading-revenue decision gate

User wants modest ongoing revenue from trading for marketing, production, and ecosystem operations.
Current preferred direction is NOT to put a fee-on-transfer tax in PCART itself until compatibility is proven. The Uniswap LiquidityLauncher technical reference states rebasing and fee-on-transfer tokens are not compatible with LiquidityLauncher. The Robinhood Chain Uniswap stack currently exposes creator-fee / fee-splitter infrastructure, which may offer ongoing trading-fee revenue while keeping PCART a standard ERC-20. This must be reverified from current Uniswap code/on-chain contracts immediately before implementation.

Preferred order of evaluation:
A. Standard 0%-transfer-tax PCART + creator/LP trading-fee revenue at the liquidity layer (RECOMMENDED candidate).
B. If A cannot meet the project’s legitimate revenue requirement, perform a separate design/audit for a very small transfer-tax token and a compatible DEX/liquidity path. Do not add a transfer tax casually or by broad toggle.

Important: creator-fee percentages are percentages of protocol/pool fee streams, NOT percentages of gross trade volume. No revenue projection is frozen.

## 4. Utility model

$PCART is intended to be the ecosystem utility token for PEPECARTEL and CARTEL HQ. Utility should generally live in CARTEL HQ / surrounding smart-contract services, not be hardcoded into the immutable ERC-20.
Candidate practical utilities to design and activate:
- verified-holder identity/badges and community roles;
- holder-only community areas/content/events where appropriate;
- Sticker Lab benefits such as discounts, credits, enhanced generation limits/features;
- AI Operator / AI usage discounts or additional allowances;
- future launchpad fee discounts / platform-service benefits;
- premium project-profile, analytics, creative, broadcast, or other non-safety features;
- NFT Studio or future ecosystem-service benefits;
- optional advisory/community voting on non-financial product/cultural topics;
- potential future optional PCART payment paths only after separate audit.

Safety-critical functionality such as verified contract information, anti-scam protections, and critical launch communications should not be withheld solely because a user does not hold PCART.

## 5. Securities / communications risk guardrails

Design and market PCART as genuine utility/culture functionality, not equity or a claim on CARTEL HQ.
Do not promise or encode:
- dividends or ownership of CARTEL HQ;
- revenue/profit share paid to holders merely for holding;
- guaranteed APY/passive yield;
- guaranteed returns or price appreciation;
- entitlement to company/platform profits or assets;
- marketing that buyers should expect the team’s future managerial work to increase token value.
A transfer tax or liquidity-layer fee paid to a project treasury is not assumed by this plan to determine securities status. Final token terms, distribution and public communications require qualified U.S. crypto/securities counsel review before public offering/launch. Do not claim legal certainty.

## 6. Public launchpad architecture

The future CARTEL HQ launchpad does NOT need a second PEPECARTEL ecosystem token. $PCART can be the platform utility token.
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

## 7. Required launch phases

### PCART-L0 — Master decisions / no build

Status: IN PROGRESS.
Freeze exact tokenomics allocation, custody/treasury architecture, utility launch set, liquidity/trading-fee revenue model, legal/comms review scope, and final contract requirements.

### PCART-L1 — Utility + tokenomics + treasury specification freeze

No deployment.
Required outputs:
- exact 1B allocation percentages and vesting/lock policy if applicable;
- initial recipient/treasury architecture, preferably hardened/multisig rather than an ordinary hot wallet;
- exact launch-day utility benefits and any holder thresholds/discount formulas;
- explicit non-security-style utility/comms guardrails;
- final decision: 0% transfer tax plus liquidity-layer fee revenue versus separate taxed-token architecture;
- liquidity budget and intended launch pricing/strategy inputs, without sending value.
STOP for approval.

### PCART-L2 — Dedicated production contract artifact

Only after L1 approval.
Create `PepeCartelToken.sol` / `pepecartel-token-v1` with the frozen token behavior. Prefer hard-coded PEPECARTEL/PCART/1,000,000,000/18 and constructor-controlled initial recipient only unless L1 explicitly changes this. Compile reproducibly, pin creation/runtime hashes, document compiler/OpenZeppelin settings, and add exact verifier support without weakening generic/testnet paths.
No mainnet transaction.
STOP for audit.

### PCART-L3 — Exact-artifact testnet rehearsal

Deploy the exact production artifact on Robinhood Chain Testnet 46630 using the protected flow. Verify name, symbol, 18 decimals, exactly 1B supply, recipient balance, creation/runtime bytecode hashes, recovery/idempotency, and mobile wallet behavior. Test every failure gate. No mainnet value.
STOP unless all tests pass.

### PCART-L4 — CARTEL HQ PCART Utility Engine

Build the modular utility layer using chain-verified wallet holdings, with server-side/RLS protections as appropriate. Utility policy must be versioned outside the token contract. Test against testnet PCART artifact. At least meaningful real utilities should be ready before public launch rather than only promised for the future.
STOP for QA.

### PCART-L5 — Liquidity + trading-revenue production design

Reverify current Robinhood Chain and Uniswap LiquidityLauncher contracts/code hashes/SDK revision on chain 4663. Determine exact supported strategy for the already-deployed PEPECARTEL token.
Priority: evaluate standard ERC-20 + audited creator/LP fee revenue without fee-on-transfer behavior.
Freeze: liquidity amounts, paired ETH, price/auction/instant-launch strategy, pool parameters, beneficiary/treasury destination, protocol fee/creator-fee treatment, LP ownership/lock/compounding rules, approvals/Permit2, slippage/deadline, recovery/finality, and revenue accounting.
If current LiquidityLauncher cannot satisfy the revenue model, STOP and separately audit alternatives. Never silently add token transfer taxes.
No liquidity send until separately authorized.

### PCART-L6 — Legal/comms + public-surface readiness

Qualified counsel review of final token terms, allocation, launch/distribution method, trading-fee/treasury model, utilities and marketing language.
Correct stale public PEPECARTEL website references to Solana/Pump.fun and align all official surfaces to Robinhood Chain only after the launch plan is frozen.
Prepare verified-contract anti-scam messaging, risk disclosures, and official-channel communication plan. Do not imply Robinhood Chain deployment means Robinhood brokerage listing.
STOP for final launch authorization.

### PCART-L7 — Mainnet production deployment request

In Launch Control, create the immutable PEPECARTEL production deployment request using the approved exact supply and recipient. Owner review only. No transaction occurs merely because the request exists.
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

## 8. Current known baseline

- CARTEL HQ has proven a real Robinhood Chain mainnet ERC-20 canary deployment on chain 4663 with managed finality.
- Official PEPECARTEL mainnet contract is NOT deployed or registered.
- PEPECARTEL launch record is on Robinhood Chain and currently has no official contract.
- Existing mainnet deployment pipeline is protected by compiled capability plus runtime stop/ARM/claim/send-window controls and independent verification.
- Mainnet liquidity execution remains a separate unfinished/disabled area and must be completed before a full tradable launch through CARTEL HQ can be certified.
- Current public PEPECARTEL website contains stale Solana/Pump.fun references that must be corrected before launch.

## 9. Strict continuation protocol

At the start of every future phase:
1. Read this file first.
2. Audit current Lovable HEAD and live Supabase state before editing.
3. Reconfirm system-of-record boundaries and current Robinhood/Uniswap external facts.
4. Use the smallest allowlist possible.
5. Reuse existing launcher/verification/Telegram/Launch Watch infrastructure; do not duplicate it.
6. Run tests and report exact diffs/state changes.
7. Stop at the named checkpoint. Never jump directly from planning to mainnet value movement.
8. A user saying “proceed” means proceed only to the next incomplete phase/checkpoint, not permission to skip irreversible safety gates.

## 10. Immediate next phase

PCART-L1 — Utility + Tokenomics + Treasury Specification Freeze.
Do not write Solidity or initiate a production deployment until L1 closes.
