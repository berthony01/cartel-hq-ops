# Production Launcher Mainnet Graduation — P0 Production Safety Contract

Status: P0 AUTHORITATIVE SAFETY CONTRACT / NO REAL-MONEY EXECUTION ENABLED
Date: 2026-09-05
Project: PEPE CARTEL / Cartel HQ
Lovable project: 469fb83c-0f27-4aa7-bb99-c4125279c565
Supabase project: ocoinbnjgstkmnwwvnhi

## 0. Authority, scope, and hard boundary

- This document starts a new post-Phase-8 workstream. It is NOT C8.8, NOT E6, and does not reopen C8.7E or C8.6B/C.
- Phase 8 remains CLOSED.
- Goal of this workstream: graduate the proven Robinhood Chain Testnet deployment foundation into a controlled Robinhood Chain Mainnet production launcher with real ETH, real token deployment, independently verified finality, real liquidity, immutable evidence, and explicit Launch Watch/Telegram handoff.
- P0 is documentation and safety architecture only. P0 must move no money and enable no production transaction.

## 1. Proven current baseline

Record these as current proven facts:

- Robinhood Chain Testnet chain ID 46630 launcher exists and has successfully produced verified fixed-supply ERC-20 deployments.
- Current application chain registry is testnet-only by construction.
- Browser-injected EIP-1193 wallet is the only signer. Cartel HQ does not possess or transmit private keys or seed phrases.
- Existing pre-sign simulation uses exact reviewed init code, intent fingerprinting, gas/balance checks, account/chain rebinding, 90-second freshness, and invalidates on changes.
- Existing deployment flow has stable idempotency request IDs and a recovery path when a transaction was broadcast but its hash was not persisted.
- Existing independent server-side verifier checks creation transaction shape, sender, zero value, exact init code, receipt, runtime bytecode hash, token identity, supply, and recipient balance.
- Existing testnet verifier uses 5 confirmations. This remains a TESTNET rule only and MUST NOT be treated as production finality.
- Current liquidity code is plan-only and has no transaction surface.
- Current database launch_chain_deployments constraint accepts exactly 46630/TESTNET or 4663/PRODUCTION.
- Current create_launch_chain_token_deployment_attempt remains hard-coded to 46630/TESTNET, therefore there is currently no application/RPC creation path for a production deployment row.
- Existing assert_launch_contract_evidence requires FIXED_SUPPLY_ERC20, approved artifact cartel-fixed-erc20-v1, PRODUCTION, chain 4663, matching declared Robinhood Chain mainnet label, CONFIRMED evidence, valid tx/address, block/verification evidence, matching token state, and no recorded failure before official registration can succeed.

## 2. Robinhood Chain production network contract

Freeze the production network identity:

- Network name: Robinhood Chain
- Chain ID: 4663
- Native gas asset: ETH
- Block explorer: https://robinhoodchain.blockscout.com
- Public RPC exists at https://rpc.mainnet.chain.robinhood.com but is rate-limited and MUST NOT be the default production backend verification provider.
- Production backend verification must use a managed Robinhood Chain RPC provider. Robinhood documentation currently recommends Alchemy; provider must be configured by secret/env, never hard-coded with a credential in client code.
- A public RPC may be used only as an optional read-only fallback/diagnostic if explicitly designed later, never as a silent authority when the managed provider disagrees.
- No bridge automation in the initial production launcher. Operator must arrive with sufficient ETH already on Robinhood Chain. Bridging is a later, separate risk domain.

## 3. Mainnet transaction separation and kill switches

Production behavior MUST be separated from testnet. Never turn the existing testnet constants into a runtime “mainnet” by simply replacing 46630 with 4663.

Require independent hard gates, default OFF:

- MAINNET_DEPLOYMENT_TX_ENABLED = false
- MAINNET_LIQUIDITY_TX_ENABLED = false

Rules:

- Deployment may eventually be enabled while liquidity remains disabled.
- Liquidity can never be implicitly enabled by enabling deployment.
- No UI state, database row, URL parameter, launch label, or client-side flag may bypass these hard gates.
- Any manifest mismatch, RPC uncertainty, chain mismatch, account mismatch, stale review, or ambiguous prior transaction must fail closed.
- First production releases remain platform-owner controlled/canary-only. Public self-service launchpad enablement is a later rollout decision after production proof.

## 4. Wallet and custody model

- Non-custodial only. User wallet signs all value-moving transactions.
- No Cartel server-side private key, seed phrase, hot wallet, automatic signer, or hidden transaction relay in the initial production design.
- Every signature request must show chain 4663 and a clear “REAL ETH / REAL ASSETS” warning.
- Mainnet UI must be visually and semantically distinct from Testnet.
- Account and chain must be re-read immediately before every signature request.
- A wallet/account/chain change invalidates the reviewed transaction and requires a new simulation/review.

## 5. Production RPC and verification trust model

- Browser wallet/provider is never authoritative evidence for deployment or liquidity success.
- Backend independently queries Robinhood Chain using managed production RPC.
- Exact transaction hash, sender, target/creation shape, value, calldata/init code, receipt, block identity, token/protocol state, and finality evidence must be re-derived server-side.
- Backend provider errors do not convert into success or failure evidence. Uncertainty stays retryable/pending.
- No automatic re-broadcast/resend after an ambiguous wallet or RPC outcome.

## 6. Production finality is a mandatory unresolved gate

Freeze these rules:

- The existing testnet “5 confirmations” threshold is NOT sufficient as the production finality definition.
- Robinhood Chain is an Arbitrum L2 built on Ethereum. Production irreversible actions require a finality rule tied to authoritative parent-chain/L2 finality semantics, not an arbitrary L2 block count.
- Before P3 can enable any mainnet deployment transaction, P1/P2 must verify from authoritative Robinhood/Arbitrum documentation AND a read-only live 4663 RPC probe exactly which finality primitive is reliable on the selected provider.
- Candidate mechanisms to investigate include standard `safe`/`finalized` block tags if actually supported/reliable on Robinhood Chain, or Arbitrum parent-chain inclusion/finality primitives such as NodeInterface/batch evidence.
- Do NOT freeze `safe`/`finalized` as the implementation until live support and semantics are verified.
- If finality cannot be proven, production state remains FINALITY_PENDING and no irreversible downstream handoff is unlocked.

Define the desired logical deployment state progression:

```text
DRAFT_REVIEW -> PRECHECK_PASSED -> SIGN_REQUESTED -> BROADCAST -> MINED -> FINALITY_PENDING -> FINALIZED -> DEPLOYMENT_VERIFIED
```

A failed or abandoned path remains immutable history. Ambiguous outcomes remain pending/recoverable, never silently retried.

## 7. Token artifact contract

- Initial production token is the already-audited/frozen behavioral model represented by cartel-fixed-erc20-v1 unless a later dedicated artifact-upgrade audit explicitly changes it.
- Fixed supply minted once in constructor.
- 18 decimals.
- No owner/admin role after deployment.
- No post-deployment minting.
- No tax/fee-on-transfer, blacklist, freeze, pause, trading toggle, max-wallet, max-transaction, proxy, or upgrade path.
- Production verification must bind to exact approved creation/runtime artifact evidence and on-chain token state.
- Any future artifact version requires a new explicit artifact ID, audit, verifier support, and migration of safety rules. Never silently reuse cartel-fixed-erc20-v1 for different bytecode.

## 8. Mainnet liquidity protocol direction and versioned manifest

Preferred first production integration: Uniswap Liquidity Launcher on Robinhood Chain, using the existing-token path so Cartel deploys/verifies the token first and liquidity is a separate explicit step.

As observed from the official Uniswap SDK source on 2026-09-05, record these CURRENT CANDIDATE Robinhood Chain 4663 values for the future manifest. They are NOT activated by P0 and MUST be independently re-verified on-chain, including bytecode/code hashes and immutable relationships, immediately before P4/P5 activation:

- Liquidity Launcher: 0x0000FffFBE8efE702c8703aE3477FF5dE3d319C0
- LBP Strategy: 0x05d552391067389EE44fec3924157ed33F976000
- Token Splitter: 0x4F5E3FBb9745358A92Da5674305FAb8D2B8a73cE
- CCA Factory: 0x000000001F26a0044BaA66024e7b6599c61963F8
- Permit2: 0x000000000022D473030F116dDEE9F6B43aC78BA3
- Universal Router Strategy: 0x1242c9439d589cAE85E121B1f79f2aF51e91DCEE
- uERC20 Factory: 0x000000e200088D55C39a11F609E5F667729ad49b
- V4 Position Manager: 0x58daec3116aae6D93017bAAea7749052E8a04fA7
- Current Instant Launch strategy, creator fees ON: 0x23f8209572b4a1C2AD88A42749E830791Fb027f1
- Current Instant Launch strategy, creator fees OFF: 0xAD44D55E7f8337C3cE113fBb591486E85be104b2

Record current authoritative source locations:

- Robinhood network docs: https://docs.robinhood.com/chain/connecting/
- Robinhood deploy docs: https://docs.robinhood.com/chain/deploy-smart-contracts/
- Robinhood token contracts: https://docs.robinhood.com/chain/contracts/
- Uniswap SDK source: https://github.com/Uniswap/sdks/blob/main/sdks/liquidity-launcher-sdk/src/addresses.ts
- Uniswap SDK changelog: https://github.com/Uniswap/sdks/blob/main/sdks/liquidity-launcher-sdk/CHANGELOG.md

Manifest rules:

- Never resolve production targets from “latest SDK” at signing time.
- P4 must freeze a Cartel-owned, versioned production manifest containing source revision/package version, chain ID, target addresses, expected code hashes, supported selectors/action types, verification timestamp, and source references.
- Live code/address mismatch disables liquidity with an explicit INFRASTRUCTURE_CHANGED / MANIFEST_MISMATCH state.
- Uniswap’s Robinhood launcher stack has had recent redeploys. Historical addresses are not valid just because they once appeared in an SDK changelog.
- Choice of CCA/LBP crowd launch vs Instant Launch is NOT activated by P0. P4 must explicitly select, model, and simulate the first supported strategy before P5 can send value.

## 9. Permit2 and approval rules

- Existing-token liquidity may require ERC-20 approval/Permit2 authorization.
- Never request casual unlimited approval by default.
- Prefer exact or tightly bounded approval for the reviewed token amount and intended spender when protocol mechanics permit.
- Before signing, show token, spender, exact/bounded amount, expiration/deadline, chain 4663, and the protocol manifest identity.
- Approval state must be read independently before and after transaction.
- If a separate on-chain approval transaction is required, it has its own transaction record, recovery semantics, finality/verification, and must not be hidden inside UI state.
- Do not sign liquidity if an unexpected existing allowance/Permit2 state creates a material mismatch with the reviewed plan.

## 10. Liquidity transaction contract

- Liquidity is always a separate explicit action after finalized/verified deployment evidence.
- Build a deterministic, expiring liquidity intent fingerprint that binds at minimum: environment, chain ID, source deployment ID, token address, operator, strategy/manifest version, every target contract, token amount, native amount if any, slippage/price bounds, deadline, Permit2/approval parameters, expected calls/selectors, and exact calldata hashes.
- Re-read account, chain, balances, allowances, protocol state, and manifest integrity immediately before sign.
- Prefer atomic protocol flows where documented, specifically avoiding a design that deposits launch tokens into an intermediate launcher contract and leaves them stranded between independent steps.
- No transaction builder may accept arbitrary target addresses or arbitrary calldata from the browser/user.
- The browser may display and sign only server/client independently derived calls from the frozen manifest and reviewed intent.

Desired logical liquidity progression:

```text
PLAN_DRAFT -> PRECHECK_PASSED -> APPROVAL_REQUIRED/ALLOWANCE_READY -> APPROVAL_BROADCAST (if needed) -> APPROVAL_VERIFIED -> LAUNCH_SIGN_REQUESTED -> LAUNCH_BROADCAST -> MINED -> FINALITY_PENDING -> PROTOCOL_STATE_VERIFIED -> FINALIZED -> LIQUIDITY_VERIFIED
```

- Any failure/abandonment is immutable history.
- Any ambiguous broadcast stays recoverable and blocks a second send until reconciled.

## 11. Future Supabase evidence model requirements

P0 changes no database objects. Future implementation must reuse existing launch_chain_deployments rather than rebuild it and add separate append-only liquidity evidence.

Future liquidity evidence should be centered on a new table such as `launch_chain_liquidity_attempts`, tenant-bound to workspace + launch + verified deployment. It should record, at minimum:

- immutable client request/idempotency key
- chain/environment
- source deployment ID and token address
- operator wallet
- manifest ID/version/hash
- strategy type + protocol target addresses
- exact token/native amounts as base-unit text/numeric-safe representations
- approval/Permit2 evidence where applicable
- review/fingerprint hash
- transaction hash(es)
- mined block/hash
- finality evidence
- auction/pool identifiers and expected pool key where applicable
- independently verified protocol state
- status/failure code/detail
- created/submitted/verified/finalized timestamps and actor

Future mainnet finality evidence must be explicit. Do not overload `confirmations >= 5` to mean production-finalized.

RLS / RPC rules:

- tenant isolation at DB layer
- owner/operator authorization re-enforced server-side
- no direct browser insert/update for authoritative evidence tables
- SECURITY DEFINER mutation RPCs must validate caller, tenant, state transition, idempotency, chain/environment and immutable fields
- verifier writes through service-only/server-only authority
- terminal evidence cannot be rewritten into a different transaction/contract

## 12. Official contract registration and launch lifecycle handoff

Preserve the existing separation of concerns:

- Finalized verified deployment evidence can make a contract ELIGIBLE for official registration.
- Registration remains a deliberate owner action bound to exact deployment evidence and exact typed contract-address confirmation.
- Registration does NOT automatically send Launch Watch notifications, broadcast to Telegram, add liquidity, or change lifecycle status.
- Official-contract notification and group broadcast remain explicit/idempotent actions.
- If liquidity is required for the launch configuration, “Go Live” must remain blocked until the required liquidity evidence is independently verified/finalized.
- It is acceptable for a contract to be officially registered before liquidity is complete, but UI/communications must clearly distinguish “official contract registered” from “liquidity verified / trading live.”
- Never use “verified” language as a token safety guarantee. Verification means specific recorded deployment/liquidity evidence only.

## 13. Launch Watch and Telegram handoff

- Reuse existing Launch Watch and official Telegram broadcast infrastructure. Do not rebuild it.
- No automatic CA blast immediately upon deployment.
- The handoff happens only through existing explicit official registration/notification/broadcast controls after eligibility rules are satisfied.
- A launch-live message must not be sent until the production launch readiness gate is satisfied.
- No Telegram test message is needed during P0-P4 unless explicitly authorized.

## 14. Recovery and ambiguous-outcome policy

For every real-money transaction:

- Claim an idempotency key before wallet request.
- Never create a second attempt because the UI timed out.
- If wallet returns a tx hash but persistence fails, preserve the hash locally and recover/attach it to the same attempt. Do not rebroadcast.
- If wallet/provider outcome is ambiguous and no hash is known, block resend until account nonce/history or other authoritative chain evidence reconciles whether a transaction was sent.
- Replacement/dropped transaction handling must be explicit and evidence-based.
- No automatic retry of value-moving writes.
- User rejection is not a failure transaction and may abandon only an unbroadcast draft.

## 15. Production QA and canary protocol

Before enabling real-money public use:

- Typecheck/build/lint as applicable.
- Unit tests for exact amount parsing, fingerprinting, manifest validation, state transitions, finality rules, idempotency and recovery.
- Rollback-safe DB tests for authorization, tenant isolation, immutable evidence and invalid transitions.
- Mainnet-fork E2E tests against frozen real contract addresses/code before any live canary.
- Read-only live 4663 health/finality probes.
- First live mainnet deployment is a deliberately small, platform-owner-controlled canary with MAINNET_LIQUIDITY_TX_ENABLED still false.
- Re-audit all evidence after the canary before enabling liquidity.
- First live liquidity action is separately authorized, small/canary, and performed only after P4/P5 approval.
- No public rollout until canaries, recovery paths, finality, and verification all pass.

## 16. Strict build sequence after P0

- **P0 — Production Safety Contract:** THIS DOCUMENT ONLY.
- **P1 — Mainnet Read-Only Infrastructure:** chain 4663 registry/read-only health, managed RPC, explorer, finality capability probe. Both transaction switches OFF.
- **P2 — Mainnet Deployment Simulation:** production preflight/review/fingerprint, no sendTransaction.
- **P3 — Mainnet Token Deployment:** dedicated 4663/PRODUCTION attempt creation + broadcast + independent verifier + production finality. Deployment switch enabled only after audit; liquidity still OFF.
- **P4 — Liquidity Readiness:** freeze/reverify Uniswap production manifest, code hashes/immutables, strategy decision, balances/allowances/Permit2, exact transaction assembly and simulation. No liquidity send.
- **P5 — Real Liquidity Execution:** separately gated approvals + liquidity launcher transaction, fork tests then controlled canary.
- **P6 — Liquidity Verification + Finality:** independent protocol/pool/auction evidence and production finality.
- **P7 — Cartel Verified Launch Handoff:** existing official registration, Launch Watch, Telegram broadcast, Go Live/monitoring gates. Reuse, do not rebuild.

Each phase must be a separate controlled audit/build slice. Never ask Lovable to “make the launcher mainnet ready” in one broad instruction.

## 17. Hard NO-GO conditions

Real-money execution stays disabled if ANY of these is unresolved:

- managed production RPC missing/unhealthy
- Robinhood Chain 4663 mismatch
- finality primitive not authoritatively verified
- production artifact/version mismatch
- mainnet verifier not independently re-deriving transaction + token state
- database authorization/tenant isolation not proven
- ambiguous prior transaction not reconciled
- Uniswap manifest address/code/immutable mismatch
- protocol strategy not explicitly selected and simulated
- Permit2/approval spender/amount not understood and shown
- exact amounts cannot be represented without floating-point loss
- recovery/idempotency tests fail
- fork or canary tests fail
- build/type/security checks fail
- any unexpected unrelated diff appears

## 18. Branding / external claims

- Always say “Robinhood Chain,” not shorthand that could imply a different brand/product.
- Never imply launching on Robinhood Chain means listing on the Robinhood brokerage/app.
- Never describe Cartel verification as an investment endorsement, safety guarantee, audit, or assurance of token quality.

## 19. Continuation checkpoint

This file is the authoritative handoff artifact for a future assistant.
A future assistant must:

1. Read this file first.
2. Audit current Lovable HEAD, recent edits/messages, and live Supabase state before any build.
3. Confirm project is still private/unpublished.
4. Confirm both mainnet transaction paths remain disabled before continuing.
5. Resume at the first incomplete P-phase; do not infer completion from this document alone.
6. Re-verify all external Robinhood/Uniswap addresses and finality assumptions from current authoritative sources because protocol infrastructure can change.
7. Never reopen Phase 8 or invent C8.8/E6.

## P0 Disposition

- **P0:** COMPLETE once this document exists and is verified as the only diff.
- **Mainnet deployment transactions:** DISABLED / NOT BUILT
- **Mainnet liquidity transactions:** DISABLED / NOT BUILT
- **Production finality implementation:** UNRESOLVED GATE, must be verified in P1/P2
- **Uniswap addresses above:** CURRENT CANDIDATES ONLY, not activated until reverified/frozen in P4
- **Supabase changes in P0:** NONE
- **Edge Function changes in P0:** NONE
- **Telegram sends in P0:** NONE
- **Web app publish/deploy in P0:** NONE
- **Next allowed step after verification:** P1 read-only audit/design only, unless separately authorized to build.

