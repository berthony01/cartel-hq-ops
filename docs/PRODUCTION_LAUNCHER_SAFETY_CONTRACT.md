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

## P1 Completion Checkpoint — 2026-09-06

- **P1 Mainnet Read-Only Infrastructure:** COMPLETE.
- **P1 authoritative Lovable HEAD:** `4a39ab48845fe4bb6d4b1bc59c0bd1a27638513f`.
- P1 created exactly two source files:
  - `src/lib/chain-mainnet-registry.ts`
  - `src/lib/chain-mainnet-health.functions.ts`
- Robinhood Chain production identity is now represented separately as chain `4663`, environment `PRODUCTION`, native asset `ETH`, with Blockscout explorer metadata and the Robinhood public RPC explicitly labeled diagnostic-only.
- Server-only managed production RPC hook name is `ROBINHOOD_MAINNET_RPC_URL`. No secret value is stored in source.
- `MAINNET_DEPLOYMENT_TX_ENABLED = false` and `MAINNET_LIQUIDITY_TX_ENABLED = false` are frozen in the P1 mainnet registry.
- The P1 server health probe is authenticated and read-only. It permits only `eth_chainId`, `eth_blockNumber`, and `eth_getBlockByNumber` for `latest`, `safe`, and `finalized`.
- Managed provider and public diagnostic results are kept separate; the public endpoint never substitutes for the managed provider.
- `productionFinalitySemanticsVerified` remains `false`; `finalityGate` remains `UNRESOLVED`.
- The existing testnet launcher, testnet verifier, testnet 5-confirmation rule, deployment RPCs, receipt/eligibility gates, and liquidity-plan behavior were not changed.
- No mainnet wallet switch/add-network path exists.
- No mainnet sign/broadcast/deployment path exists.
- No liquidity approval/Permit2/Uniswap transaction path exists.
- Typecheck passed and production build passed after P1.
- Supabase state remains unchanged by P1: no migration, no schema change, no new production deployment row, no liquidity-attempt table, and no Edge Function deploy.
- Project remains private and unpublished.

### P1 Remaining Gates Before P2/P3

- A managed Robinhood Chain production RPC endpoint still needs to be configured under the server-only secret/env name `ROBINHOOD_MAINNET_RPC_URL` before managed-provider parity can be proven.
- Public RPC observation confirmed chain 4663 and support for `latest`, `safe`, and `finalized`, but this is capability evidence only, not semantic proof of production finality.
- Production finality semantics must still be verified against authoritative Robinhood/Arbitrum documentation and the selected managed provider before P3 can enable any deployment transaction.
- Existing production database verification/registration logic still contains the legacy `>= 5 confirmations` rule. That rule must not be interpreted as production finality and must be separated/strengthened before production deployment can be accepted as finalized.
- Real-money execution remains NO-GO.

### Next Allowed Step

- **P2 audit/design first:** Mainnet Deployment Simulation and production-finality contract design, with no `eth_sendTransaction` and both mainnet transaction switches still OFF.
- Before any P2 build, audit current Lovable HEAD, recent message/diff history, live Supabase state, managed-RPC configuration status, and current authoritative Robinhood/Arbitrum finality documentation.
- Do not infer P2 completion from this checkpoint.

## P2 Completion Checkpoint — 2026-09-06

- **P2 Mainnet Deployment Simulation:** COMPLETE.
- **P2 authoritative Lovable HEAD before this documentation-only checkpoint:** `432ff85a6daf7264f98a19818b8f7514d3e147e0`.
- P2 added exactly one source file:
  - `src/lib/chain-mainnet-simulation.ts`
- Existing testnet `src/lib/chain-simulation.ts` remained unchanged.
- P2 mainnet simulation is isolated from testnet and binds `PRODUCTION`, Robinhood Chain `4663`, the frozen `cartel-fixed-erc20-v1` artifact/runtime hash, deployer, recipient, token identity/supply, exact init code/hash, and zero transaction value into a mainnet-specific fingerprint domain `cartel-mainnet-sim-v1`.
- Production simulation quote TTL is 60 seconds.
- Mainnet preflight performs read-only wallet/provider checks only: chain id, current account, balance, exact creation `eth_call`, exact creation `eth_estimateGas`, fee data, and sufficient ETH.
- All token/gas/balance arithmetic remains bigint/exact decimal-string based.
- `simulationPassed` does NOT authorize deployment. `deploymentAuthorized` remains literal `false` and is blocked by `MAINNET_DEPLOYMENT_TX_ENABLED`.
- No mainnet wallet add/switch path, signing path, send/broadcast path, production deployment-row creation path, database mutation, verifier mutation, liquidity/Permit2/Uniswap path, finality promotion, Telegram action, or UI was added by P2.
- `MAINNET_DEPLOYMENT_TX_ENABLED = false` and `MAINNET_LIQUIDITY_TX_ENABLED = false` remain frozen.
- Typecheck passed and production build passed after P2.
- Supabase state remained unchanged by P2: zero 4663/PRODUCTION deployment rows, no liquidity-attempt table, no migration/schema/RPC/Edge change.
- Project remains private and unpublished.

### P2 Finality Conclusion

- P2 confirmed that the legacy testnet `confirmations >= 5` rule MUST NOT represent Robinhood Chain production finality.
- Authoritative Robinhood Chain documentation states high-value/irreversible actions should wait for Ethereum posting/finality.
- Authoritative Arbitrum documentation for Dedicated Blockchains states standard RPC tags represent `latest` soft confirmation, `safe` parent-chain-safe, and `finalized` parent-chain-final; irreversible actions should wait for `finalized`, and fixed child-block confirmation counts should not be used as a substitute.
- Robinhood Chain public RPC capability previously accepted `latest`, `safe`, and `finalized`, but public RPC is diagnostic only.
- Production finality promotion remains blocked until the configured MANAGED Robinhood Chain provider is probed and its `finalized` behavior is proven consistent with the documented model.

### P3 Hard Gate / Next Allowed Step

- **P3 audit/design only comes next before any P3 build.**
- `ROBINHOOD_MAINNET_RPC_URL` is currently not configured in the Lovable runtime. This is a hard blocker for managed-provider-authoritative P3 finality verification.
- P3 must design a separate 4663/PRODUCTION deployment attempt creation path, production verifier, explicit finality evidence/state, idempotent recovery, and a production pre-sign/send handoff without loosening the existing 46630/TESTNET path.
- Future production finality evidence must remain separate from the legacy `confirmations` column and must fail closed to `FINALITY_PENDING` on missing/malformed/inconsistent managed-provider data.
- No P3 transaction path may be enabled until the managed production RPC exists, provider parity/finality behavior is verified, database changes are separately audited and tested, and an explicit controlled build authorization is given.
- Real-money execution remains NO-GO.

## P3A Completion Checkpoint — 2026-09-06

- **P3A Database Finality / Evidence Foundation:** COMPLETE.
- Repository migration files added:
  - `supabase/migrations/20260906063000_production_launcher_finality_evidence.sql`
  - `supabase/migrations/20260906063600_production_verifier_generated_column_fix.sql`
- First migration added eight production-finality evidence columns to `launch_chain_deployments`, production-only/fail-closed CHECK constraints, service-role-only `apply_launch_chain_production_finality`, service-role-only `apply_launch_chain_production_token_deployment_verification`, and strengthened `assert_launch_contract_evidence` so official-contract registration requires managed FINALIZED evidence in addition to all prior checks.
- Independent audit caught and hardened mined-evidence immutability before/while applying P3A: once contract address/block number/block hash are recorded, later production verification cannot replace them; finalized evidence cannot be rewound by a PENDING replay; CONFIRMED no longer rewrites mined/token evidence.
- Rollback-safe runtime testing then caught that `verified_total_supply_text` and `verified_recipient_balance_text` are GENERATED ALWAYS columns. A separate corrective migration removed direct assignments to those columns. Generated text values now derive automatically from the numeric verified fields.
- Supabase migration history confirms both migrations applied successfully:
  - `production_launcher_finality_evidence`
  - `production_verifier_generated_column_fix`
- Rollback-safe P3A database tests PASS, including:
  - default NOT_APPLICABLE finality state
  - production PENDING mined/token evidence path
  - generated verified text values derive correctly
  - mined block-hash immutability rejection
  - finalized-head-behind rejection
  - managed FINALIZED positive path
  - PENDING replay cannot rewind FINALIZED
  - CONFIRMED promotion only after FINALIZED evidence
  - finalized official-contract evidence positive path
  - 5-confirmation/no-finality negative tripwire rejected
  - TESTNET row cannot enter a production finality state
- Post-test state is clean: zero 4663/PRODUCTION deployment rows remain; all rollback fixtures removed; TESTNET rows remain NOT_APPLICABLE.
- Production apply functions are executable by `service_role` and NOT executable by `authenticated`.
- Existing testnet verifier and testnet 5-confirmation behavior were not modified.
- `MAINNET_DEPLOYMENT_TX_ENABLED=false` and `MAINNET_LIQUIDITY_TX_ENABLED=false` remain unchanged.
- No wallet, signature, blockchain transaction, liquidity action, Telegram action, Edge deploy, or web publish occurred.
- Project remains private and unpublished.

### P3A Remaining Gates / Next Allowed Step

- `ROBINHOOD_MAINNET_RPC_URL` is still not configured in the Lovable runtime.
- P3A does not prove managed-provider finality semantics and does not enable any real-money transaction.
- **Next allowed step: P3B audit/build for the separate production verifier + finality checker**, still fail-closed with `MANAGED_RPC_UNCONFIGURED` while the managed endpoint is absent, and still with both mainnet transaction switches OFF.
- P3C broadcast/signing and any UI remain later, separate slices.
- P3D real-money canary remains NO-GO until the managed provider exists and finality behavior is proven.

## P3B Completion Checkpoint — 2026-09-06

- **P3B Production Verifier + Finality Checker:** COMPLETE as a code foundation.
- **P3B authoritative Lovable HEAD before this documentation-only checkpoint:** `4de08fd312f77757100cf9836048e9414c85ae23`.
- New production-only source file created:
  - `src/lib/chain-mainnet-verify.functions.ts`
- P3B was first built as a one-new-file slice, then independently reviewed and corrected in a one-file hardening pass.
- Managed-RPC-only authority: the verifier reads the managed production endpoint only from the server-only secret/env name `ROBINHOOD_MAINNET_RPC_URL`; there is no public diagnostic fallback and no client-side RPC URL exposure.
- Managed endpoint chain id is independently pinned to `4663` before any deployment evidence is read; any chain-id mismatch returns `MANAGED_RPC_CHAIN_MISMATCH` and writes nothing.
- The verifier independently checks exact contract-creation transaction shape (`to === null`, `value === 0n`), deployer address, frozen init-code byte equality, successful receipt, contract address, canonical block hash continuity, frozen runtime bytecode hash, and exact ERC-20 name/symbol/decimals/total supply/recipient balance.
- Stored mined evidence (`contract_address`, `block_number`, `block_hash`) is treated as immutable; when already present, incoming evidence must match exactly or the verification is rejected.
- Finality uses only the managed provider's `finalized` block tag; any fixed L2 confirmation count is observational only and never authorizes finality promotion.
- Finality logic detects retreating finalized heads, performs a second canonical deployment-block hash re-read after obtaining the finalized head, and classifies the result fail-closed as `FINALITY_PENDING`, `FINALIZED_CANDIDATE`, or `PROVIDER_INCONSISTENT`.
- Local write-gate `MAINNET_VERIFICATION_STATE_WRITES_ENABLED = false` keeps the P3A service-role apply helpers inert; those helpers are module-private and the main handler does not call them today.
- `MAINNET_DEPLOYMENT_TX_ENABLED = false` and `MAINNET_LIQUIDITY_TX_ENABLED = false` remain unchanged.
- Typecheck passed and production build passed after the P3B correction pass.
- Supabase post-build read-only check: zero 4663/PRODUCTION deployment rows; zero testnet rows with non-default production finality state; P3A production apply RPCs remain present.
- `ROBINHOOD_MAINNET_RPC_URL` remains NOT configured in the Lovable runtime, so live managed-provider verification/finality proof remains blocked.
- No schema/migration change, database write, secret/env change, Edge Function deploy, Telegram send, wallet action, blockchain transaction, or web publish occurred in P3B.
- Project remains private and unpublished.

### P3B Remaining Gates / Next Allowed Step

- Do NOT mark real-money mainnet safe or enabled.
- Before P3C, managed RPC configuration and live finality semantics proof should be addressed in a separately controlled step, or P3C must remain fully kill-switched/inert.
- **P3C broadcast/signing and any UI remain NOT STARTED.**
- **P3D real-money canary remains NO-GO.**




## P3C-A1 Completion Checkpoint — 2026-09-06

**P3C-A1 Production Attempt DB Foundation: COMPLETE.**

### Artifacts
- Repository migration: `supabase/migrations/20260906133800_p3c_a1_production_token_attempt_intent.sql`.
- Migration commit: `419a359381fb1b7aad51770d0b5989ed37ae37c3`.
- Supabase applied migration: `p3c_a1_production_token_attempt_intent`, live migration version `20260906134001`.
- After application, Lovable automatically regenerated `src/integrations/supabase/types.ts`. Independent diff inspection confirmed generated schema/RPC typing only (`review_fingerprint`, `init_code_hash`, and `create_launch_chain_production_token_deployment_attempt` args/returns) with no behavioral code. Post-sync pre-checkpoint HEAD: `bfc06a62b8bdc9e8c5435440dadbea01f66c499d`.

### Schema and function changes
- Added nullable `review_fingerprint` and `init_code_hash`, with strict lowercase 32-byte hex constraints, and a production `FIXED_SUPPLY_ERC20` requirement for both fields.
- Extended `enforce_launch_chain_token_intent_immutable()` so the binding fields are immutable, preserving all prior token intent protections.
- Added `create_launch_chain_production_token_deployment_attempt`, hard-coded to chain 4663 / `PRODUCTION` / `DRAFT` / `FIXED_SUPPLY_ERC20` / `cartel-fixed-erc20-v1` / 18 decimals, reusing the existing platform-owner + workspace-operator authorization and performing full immutable-field idempotency conflict checks.
- Permissions verified: `authenticated` execute = true, `anon` = false, `service_role` = false. Existing testnet RPC permissions unchanged.

### QA (rollback-safe) — PASS
- Valid normalized row shape.
- Exact replay idempotency.
- Conflicting idempotency rejection.
- Malformed fingerprint rejection.
- Binding immutability rejection.
- Missing binding constraint rejection.
- Unauthorized-user rejection.
- After rollback: zero 4663/`PRODUCTION` deployment rows, and zero `TESTNET` rows with non-default production finality.

### Repository verification this turn
- `bunx tsgo --noEmit`: PASS.
- `bun run build`: PASS.

### Safety state (unchanged)
- No production transaction submission, signing, or broadcast capability was added.
- `MAINNET_DEPLOYMENT_TX_ENABLED = false`, `MAINNET_LIQUIDITY_TX_ENABLED = false`, `MAINNET_VERIFICATION_STATE_WRITES_ENABLED = false`.
- Managed Alchemy RPC configured by secret name only; the secret value is never recorded.
- Project private/unpublished. No wallet signature, blockchain transaction, ETH movement, liquidity action, Telegram send, or Edge deploy occurred.

### Next allowed step
- **P3C-A2 AUDIT/DESIGN FIRST** for short-lived, single-use, replay-resistant pre-sign authorization evidence/state. A2 is NOT built.
- P3C-B / P3C-C / P3C-D, UI, P3D canary, and all real-money execution remain NOT STARTED / NO-GO.

## P3C-A2 Completion Checkpoint — 2026-09-06

**P3C-A2 Production Pre-Sign Authorization Evidence: COMPLETE / APPLIED / VERIFIED.**

### Change of record
- Migration file: `supabase/migrations/20260906140331_1867ed4b-c438-4414-85a6-2d012a544fd2.sql`
- Supabase live migration version `20260906140331`, migration name `1867ed4b-c438-4414-85a6-2d012a544fd2`
- Post-sync pre-checkpoint HEAD: `951010bde9a2d4e7136cbfea0cef1c0e24973c13`
- Diff from P3C-A2 audit checkpoint `e575d855e902ac1316aa9296d517ba8d58c34d03`: the migration file plus auto-generated `src/integrations/supabase/types.ts` (schema/RPC typing only, no behavioral code). No other file changed.

### Table: `public.launch_chain_production_presign_authorizations`
- Chain `4663` / `PRODUCTION` only, enforced by CHECK and by trigger against the live deployment row.
- Deployment FK uses `ON DELETE RESTRICT` so authorization evidence is preserved.
- Strict exact binding to deployment id, workspace, launch, deployer address, operator user, `review_fingerprint`, and `init_code_hash`; all must equal the live deployment row at insert time.
- Economic evidence stored as exact unsigned-decimal text: gas estimate, gas limit, observed fee per gas, max fee per gas, max priority fee per gas, estimated cost, max total cost. Signs, decimals, hex, spaces, and empty strings are rejected.
- `tx_value_wei` is constrained to exactly `'0'`.
- `ttl_seconds` is immutable, constrained to 30..300, default issue TTL 60; `expires_at` derived server-side from `now()` and bounded to `issued_at + 30s .. issued_at + 5 minutes`.
- States: `ISSUED`, `CLAIMED`, `INVALIDATED`, `EXPIRED`. Partial unique unresolved index covers BOTH `ISSUED` and `CLAIMED`, so at most one unresolved authorization exists per deployment.
- `CLAIMED` is frozen in A2 and blocks reissue; no recovery of `CLAIMED` exists yet.
- Deployment eligibility required at insert and at claim: `FIXED_SUPPLY_ERC20`, artifact `cartel-fixed-erc20-v1`, status `DRAFT`, `tx_hash IS NULL`.

### Access boundary
- RLS ENABLED and FORCED; zero policies.
- Zero direct table grants — `PUBLIC`, `anon`, `authenticated`, and `service_role` all revoked. All access flows through SECURITY DEFINER RPCs, removing the direct-insert bypass around economic-coherence checks.
- `issue_launch_chain_production_presign_authorization(...)`: SECURITY DEFINER, EXECUTE granted to `service_role` ONLY; `authenticated` and `anon` cannot issue. The browser cannot mint authoritative authorization.
- `claim_launch_chain_production_presign_authorization(...)`, `invalidate_launch_chain_production_presign_authorization(...)`, `get_launch_chain_production_presign_authorization(...)`: `authenticated` only, authorized through `authorize_launch_chain_deployment` (platform owner AND workspace operator); `anon` EXECUTE false.
- Claim and invalidate use one consistent lock order: read `deployment_id` unlocked, lock the DEPLOYMENT `FOR UPDATE` first, then lock/re-read the AUTHORIZATION `FOR UPDATE` and re-verify ownership. Issue already locks the deployment first.
- `INVALIDATE` operates only on `ISSUED`, is idempotent when already `INVALIDATED`, and REFUSES `CLAIMED`.

### Economic coherence
- Required economic arguments are required RPC parameters; only `_ttl_seconds` defaults (60).
- Strict unsigned-decimal validation runs BEFORE any numeric cast.
- `EIP1559` requires a non-null max priority fee and enforces `max_priority <= max_fee`; `LEGACY` forbids a priority fee.
- Enforced: gas estimate > 0, gas limit >= gas estimate, max fee >= observed fee, max total cost >= estimated cost, max total cost >= gas limit * max fee.
- Exact-replay idempotency compares every bound field INCLUDING `ttl_seconds`; any mismatch raises `22023` on both the pre-read and unique-violation re-read paths.

### Non-capability statement
- A2 authorizes only a later wallet-handoff step. It does NOT sign, assemble, submit, broadcast, or record any blockchain transaction, and adds no transaction capability.

### Independent live verification
- Table exists; `rows = 0`; 4663/PRODUCTION deployment rows = 0 before and after.
- RLS `enabled/forced`, policies = 0, table grants = none, 22 CHECK constraints live, FK delete action `RESTRICT`, indexes `lcppa_deployment_request_uidx` and `lcppa_deployment_unresolved_uidx` present.
- Privilege probes: issue → `service_role` true, `authenticated` false, `anon` false; claim/invalidate/get → `authenticated` true, `anon` false; table SELECT/INSERT false for `authenticated`, `anon`, and `service_role`.

### Rollback-safe negative QA — PASS
All executed inside a single transaction deliberately rolled back; zero rows persisted.
- Unknown deployment → rejected
- TTL out of range (900) → rejected
- `LEGACY` with priority fee → rejected
- `EIP1559` missing priority fee → rejected
- Malformed decimals (hex / padded whitespace) → rejected
- Max total cost below `gas_limit * max_fee` → rejected
- Short `client_request_id` → rejected
- Existing non-production deployment → rejected as ineligible
- Direct table insert bypass → rejected by trigger

### Build validation
- `bunx tsgo --noEmit` PASS.
- `bun run build` PASS.

### Safety state
- No real ETH moved; no wallet signature; no blockchain transaction; no liquidity action; no Telegram send; no Edge Function deploy; no secret change; no publish. Project remains private/unpublished.
- `MAINNET_DEPLOYMENT_TX_ENABLED`, `MAINNET_LIQUIDITY_TX_ENABLED`, and `MAINNET_VERIFICATION_STATE_WRITES_ENABLED` all remain literal `false`.

### Next allowed step
- **P3C-B AUDIT/DESIGN FIRST ONLY** for the managed server-side pre-sign gate: independently reconstruct the exact production transaction from stored intent and the frozen artifact, use managed Alchemy chain 4663 simulation/gas/fees/balance, and issue the A2 authorization through the service-role-only RPC. No wallet signing or broadcast in B.
- P3C-C, P3C-D, UI, and P3D canary remain NOT STARTED / NO-GO.

## P3C-C3 Completion Checkpoint — 2026-09-06

- **P3C-C3 Runtime Emergency Stop + Final Send-Window Hardening:** COMPLETE as a safety foundation, while real-money execution remains disabled.
- **P3C-C3 migration file:** `supabase/migrations/20260906160112_34aaaf53-0408-40c1-8a1f-92b6b6a52704.sql`.
- **Runtime singleton seeded default deny:** `execution_enabled = false`, `emergency_stop_engaged = true`, `revision = 1`, `reason = INITIAL_DEFAULT_OFF`.
- **Append-only immutable execution-control event history** exists in `public.launch_chain_production_execution_control_events`.
- **`get_launch_chain_production_execution_state()`** is service-role only and fails closed on missing or ambiguous state.
- **`engage_launch_chain_production_emergency_stop(uuid, text)`** is service-role only, platform-owner validated, and one-way stop only. It cannot enable execution and cannot clear the emergency stop.
- **There is intentionally NO RPC in C3 that can enable production execution or clear the emergency stop.** Enabling execution or lifting the stop is a later, separately authorized, fail-closed operation.
- **CLAIM no longer emits a sendable wallet envelope.** `claimMainnetDeploymentHandoff` returns a claim receipt only. `authorizeMainnetSendWindow` is the only server-side envelope issuer.
- **Final server-authoritative send window** uses server time and is `min(original expires_at, claimed_at + 10 seconds)`. Expired or invalid windows freeze the attempt for reconciliation with no auto-cancel, no auto-reissue, and no client-side extension.
- **Browser wallet helper** consumes only the final server-issued envelope, keeps exact-envelope validation, re-reads account and chain immediately before its single future `eth_sendTransaction`, and never retries.
- **Known same-hash persistence/recovery remains available even after execution is stopped.** The emergency stop gates new send-window issuance; it does not erase or alter existing deployment attempt/intent records needed for incident recovery.
- **Incident-response limitation:** an emergency stop cannot cryptographically recall an envelope that was already delivered to a browser, nor cancel a wallet prompt or transaction already in flight. The server-side final 10-second window minimizes that exposure, and no automatic rebroadcast is allowed. A stop prevents new issuance; reconciliation of in-flight or already-broadcast transactions remains a manual, evidence-driven process.
- **Independent post-build state:** 4663/PRODUCTION deployment rows = 0; production presign rows = 0; execution-control rows = 1; execution-control event rows = 1; control state `execution_enabled = false`, `emergency_stop_engaged = true`, `revision = 1`, `reason = INITIAL_DEFAULT_OFF`. Project remains private/unpublished. No real wallet, signature, transaction, ETH, liquidity, Telegram, Edge Function deploy, or web publish occurred.
- **All three hard switches remain literal `false`:** `MAINNET_DEPLOYMENT_TX_ENABLED = false`, `MAINNET_LIQUIDITY_TX_ENABLED = false`, `MAINNET_VERIFICATION_STATE_WRITES_ENABLED = false`.
- **Next allowed step is READ-ONLY next-boundary audit only.** Do not automatically start P3C-D, P3C-UI, P3D canary, liquidity, verifier-write activation, or any real-money action.

## P3C-D1 Disabled Verifier State-Write Wiring Checkpoint — 2026-09-06

1. Scope: `src/lib/chain-mainnet-verify.functions.ts` only. No migration, no schema/RPC/grant/policy/data change, no generated type drift, no secret, no Edge Function, no Telegram, no publish.
2. The exported production verifier is now wired to the pre-existing service-role apply helpers as a DISABLED FOUNDATION. Ordering is explicit: complete mined/token evidence -> `PENDING`; managed `finalized` head only -> `FINALITY_PENDING` / `PROVIDER_INCONSISTENT` / `FINALIZED`; `CONFIRMED` only after a successful `FINALIZED` apply, reusing the identical immutable evidence. In a future enabled state the returned deployment status advances only after the corresponding database apply actually succeeds: to `PENDING` after the `PENDING` apply, staying `PENDING` across `FINALIZED`, and to `CONFIRMED` only after the `CONFIRMED` apply succeeds. Any failed state write preserves the last status known to have landed and surfaces only the sanitized retryable code. With the lock literally false no write occurs and the status remains the value read through RLS.
3. `MAINNET_VERIFICATION_STATE_WRITES_ENABLED` remains literally `false as const`. A widened runtime mirror exists solely for dead-code-safe typechecking; each helper still refuses before any service-role import.
4. `MAINNET_DEPLOYMENT_TX_ENABLED` and `MAINNET_LIQUIDITY_TX_ENABLED` remain literally `false`.
5. No verifier database state write occurred. While the lock is false there is zero admin-client import and zero row mutation on the apply paths; output still reports `stateWritesEnabled: false` with the `STATE_WRITES_DISABLED` notice.
6. `PROVIDER_INCONSISTENT` is recordable only against a `PENDING` row established in the same run; a `PENDING` row is never fabricated to carry an inconsistency.
7. No path persists `FAILED`. Mismatches stay observational and fail-closed; terminal-failure policy is deferred to reconciliation/operator work.
8. Retryable managed-provider/transport failures never become `FAILED` or `CONFIRMED`. State-write failures surface only the sanitized code `STATE_WRITE_FAILED_RETRYABLE`; no raw database or provider error text is returned.
9. Confirmations remain diagnostic only and never a finality gate. A diagnostic confirmation value is sent to the `integer` RPC parameter only when it falls inside the PostgreSQL signed INTEGER range `[0, 2,147,483,647]` (`POSTGRES_INTEGER_MAX = 2_147_483_647n`); otherwise it is omitted, never coerced. This bound is deliberately the PostgreSQL INTEGER maximum, not `Number.MAX_SAFE_INTEGER`.
10. Chain access remains read-only: no signer, wallet, browser provider, raw send, signing, router, pool, liquidity, or transaction builder was added, and no testnet module is imported.
11. The audit-only `mainnetApplyHelpersInternal` reference was removed now that the helpers are genuinely called.
12. Verification: `bunx tsgo --noEmit` PASS; `bun run build` PASS; diff from start gate `97aaafd020b23c883462454d89126c088cb184be` contains only the verifier file plus this checkpoint.
13. Live database re-read after build: production deployment rows 0; production presign authorization rows 0; one execution-control row with `execution_enabled=false`, `emergency_stop_engaged=true`, revision 1; one execution-control event.
14. Project remains PRIVATE / UNPUBLISHED. No activation, canary, re-arm, or real-money action occurred.
15. Next allowed step: READ-ONLY operator/reconciliation boundary audit only.

## P3C-D2 Reconciliation Evidence Foundation Checkpoint — 2026-09-06

1. Start gate `96cf2f64e2900f796ad1aae2a9d63e8fd3c3073d`, clean tree, private/unpublished, verified before any edit.
2. Exactly one migration added `public.launch_chain_production_send_window_issuances`: immutable, `authorization_id` UNIQUE with `ON DELETE RESTRICT`, chain pinned 4663, environment pinned PRODUCTION, `control_revision >= 1`, and no envelope, calldata, signature, key or secret material of any kind.
3. That table has RLS ENABLED and FORCED with zero policies, all privileges revoked from PUBLIC/anon/authenticated/service_role, an append-only trigger rejecting UPDATE and DELETE, and the trigger function's EXECUTE revoked.
4. Exactly one issuance RPC, `authorize_launch_chain_production_send_window_issuance(_deployment_id, _authorization_id, _operator_user_id)`, SECURITY DEFINER, executable only by `postgres`/`service_role`.
5. The RPC takes deterministic locks deployment → authorization → control singleton `ROBINHOOD_MAINNET_DEPLOYMENT`, and requires 4663/PRODUCTION/`FIXED_SUPPLY_ERC20`/`cartel-fixed-erc20-v1`/DRAFT/NULL tx_hash, exact binding including operator identity, platform owner plus workspace operator, and an authorization that is CLAIMED with `claimed_at` present and `consumed_at`/`consumed_tx_hash` null.
6. The RPC re-checks `execution_enabled = true AND emergency_stop_engaged = false` inside the same locked transaction, closing the TOCTOU gap left open by the read-side runtime gate.
7. The RPC uses DATABASE SERVER TIME only, recomputes the deadline as `least(authorization.expires_at, authorization.claimed_at + interval '10 seconds')`, fails closed at or past that deadline, and never mutates, cancels, consumes or reissues the authorization.
8. A second issuance for the same authorization is an explicit refusal, never an idempotent success; success inserts exactly one row and returns it.
9. `authorizeMainnetSendWindow` keeps every P3C-C3 gate and now, after all checks, performs the durable issuance before any envelope is returned; the returned `sendWindowExpiresAt` comes from the database row, and drift beyond one second or an already-passed deadline fails closed.
10. Issuance failures return no envelope under sanitized notices `SEND_WINDOW_ALREADY_ISSUED`, `SEND_WINDOW_ISSUANCE_REFUSED`, `SEND_WINDOW_ISSUANCE_FAILED`; a durable issuance row is never deleted after the fact, so an ambiguous response freezes the authorization for reconciliation rather than reissuing.
11. New read-only `get_launch_chain_production_reconciliation_snapshot` returns deployment evidence, the FULL presign history with a derived `effective_status` (`ISSUED` past expiry reported as `EFFECTIVELY_EXPIRED` without mutating the row), all issuances, the control singleton, the full control-event history and a deterministic classification. It performs no write.
12. New `src/lib/chain-mainnet-reconciliation.functions.ts` exposes only `getMainnetDeploymentReconciliationSnapshot` and `verifyMainnetCandidateTransaction`; both read tenancy through the caller's RLS-bound client first and only then use the service-role client, and neither contains any insert/update/upsert/delete.
13. The candidate verifier reconstructs init code from immutable stored intent plus the frozen artifact, uses ONLY the managed `ROBINHOOD_MAINNET_RPC_URL` endpoint read by name inside the handler (never returned or logged), pins chain id 4663 before reading, and requires hash match, contract creation, zero value, sender equal to the recorded deployer and byte-identical input; a transaction-object hash mismatch reports `MISMATCH_TX_HASH`. Receipt semantics (corrected 2026-09-06): once the exact transaction is matched, `exactIntentObserved` stays true and the receipt is read through a server-only managed raw `eth_getTransactionReceipt` call so that provider failure can never be collapsed into "unmined". `EXACT_INTENT_UNMINED` is returned ONLY when the provider answers successfully with `result: null`; HTTP/transport/timeout/JSON-RPC-error responses return `RECEIPT_UNAVAILABLE_RETRYABLE` and structurally invalid receipt payloads return `RECEIPT_MALFORMED_RETRYABLE`, both classified `RECEIPT_UNAVAILABLE_RETRYABLE` with `exactIntentObserved: true` and never implying non-broadcast. Raw receipts are validated field by field (canonical `transactionHash` equal to the candidate, `status` exactly `0x0`/`0x1`, contract address null or canonical, block number null or canonical hex quantity, block hash null or canonical 32-byte hash) before any mined success/revert conclusion. It still classifies `NOT_VISIBLE_RETRYABLE` for transaction-lookup silence, re-reads the mined block by exact number for block-hash consistency as evidence only, treats a revert as proof of broadcast, and never persists the candidate hash. No retry, rebroadcast, public fallback or database write exists on this path.
14. `persistMainnetDeploymentTxHash` is unchanged and intentionally ungated for same-hash recovery; the CLAIMED cancellation RPC remains service-role only with no application wrapper; no generic CLAIMED cancellation path was added.
15. All three literal switches remain false: `MAINNET_DEPLOYMENT_TX_ENABLED`, `MAINNET_LIQUIDITY_TX_ENABLED`, `MAINNET_VERIFICATION_STATE_WRITES_ENABLED`.
16. Verification: `bunx tsgo --noEmit` PASS; `bun run build` PASS; diff from the start gate contains exactly the one migration, `chain-mainnet-handoff.functions.ts`, the one new reconciliation file, schema-forced generated `types.ts`, and this checkpoint.
17. Live database re-read: production deployment rows 0; presign authorization rows 0; issuance rows 0; one execution-control row with `execution_enabled=false`, `emergency_stop_engaged=true`; issuance table `relrowsecurity`/`relforcerowsecurity` both true with 0 policies; both new functions SECURITY DEFINER with EXECUTE limited to `postgres`/`service_role`.
18. With runtime execution disabled, emergency stop engaged and zero eligible production deployments, the issuance RPC independently refuses today even if every compile-time switch were flipped.
19. No wallet, signer, browser provider, broadcast, testnet path, secret change, Edge Function, Telegram, liquidity, lifecycle or UI surface was touched; no real transaction, signature or ETH movement occurred; project remains PRIVATE / UNPUBLISHED.
20. Known deferred item: the security linter reports pre-existing categories (RLS-enabled-with-no-policy, SECURITY DEFINER reachable-by-role checks); the new table's policy-free state is intentional and remediation was not attempted because a second migration is outside this contract.
21. Known unexecuted QA: rollback-only fixture integration QA of the candidate verifier was NOT executed, because no safe fixture transaction could be established under the zero-production baseline (0 production deployments, 0 presign authorizations). No claim of passing integration QA is made for that path; only type-check, build and static/read-only inspection were performed.
22. Next allowed step: READ-ONLY audit of bounded runtime re-arm / zero-money rehearsal architecture only.


## P3C-D3 Bounded Canary Permit Foundation Checkpoint — 2026-09-06

1. Start gate `8c1efe2e478c08d1c17e32331c96b5e3781f1db4`, clean tree, verified before any edit; resulting commit `e64ea28c68b95923a3c21ea0ff999e6160ea7161`.
2. Diff from the start gate contains exactly: one new migration `supabase/migrations/20260906202942_7626c10b-b457-4c69-9a51-65be137a14d7.sql`, `src/lib/chain-mainnet-handoff.functions.ts`, and schema-forced generated `src/integrations/supabase/types.ts` (plus this checkpoint). No other file changed.
3. New immutable table `public.launch_chain_production_canary_permits` binds a single permit to one authorization (`authorization_id` UNIQUE), plus deployment, workspace, launch, operator, chain 4663, PRODUCTION, deployer address, review fingerprint, init-code hash, `control_revision`, `authorization_expires_at` and a hard-bounded short `expires_at`. It stores no envelope, calldata, signature or secret material. RLS is ENABLED and FORCED with zero policies, all role grants revoked, and an append-only trigger whose EXECUTE is revoked.
4. There is NO arm/re-arm/reset/reissue path: no application wrapper, no RPC, and no reachable role privilege exists to create, modify or delete a permit. Live check `arm_like_funcs = 0`.
5. The issuance RPC `authorize_launch_chain_production_send_window_issuance` now requires, inside its own locked transaction and in deterministic lock order (deployment -> authorization -> control singleton -> permit), an exact-binding, current-`control_revision`, unexpired, not-yet-consumed canary permit, in addition to every earlier gate. Every refusal is fail-closed and mutates nothing.
6. The immutable send-window issuance row now carries `canary_permit_id` (NOT NULL, UNIQUE, FK ON DELETE RESTRICT), making it the one-time consumption evidence for that permit; a second issuance against the same authorization or permit is an explicit refusal, never idempotent success.
7. Function privileges re-read live: claim RPC EXECUTE limited to `postgres`/`authenticated`; issuance RPC and reconciliation snapshot RPC EXECUTE limited to `postgres`/`service_role`; the permit append-only trigger function is `postgres`-only.
8. Rollback-only integration QA (single transaction, deliberately aborted, zero rows persisted) against the live schema returned: runtime disabled -> `Production runtime execution is disabled`; no permit -> `No canary permit for this authorization`; exact valid permit -> one issuance row with `canary_permit_id` correctly linked; repeat call -> `Send window already issued for this authorization`; mismatched binding -> `Canary permit does not match authorization intent`; stale revision -> `Canary permit control revision is stale`; permit UPDATE and DELETE -> `Production canary permits are append-only`; issuance UPDATE -> `Production send-window issuance evidence is append-only`.
9. Known inconclusive QA case: permit expiry could not be exercised in the rollback harness because PostgreSQL `now()` is frozen for the whole transaction, so simulated elapsed time never advances. The check `IF NOT (now() < p.expires_at) THEN RAISE 'Canary permit expired'` is present and executes before any issuance in production, where each RPC call is its own transaction. No claim of a passing expiry integration test is made.
10. `claimMainnetDeploymentHandoff` still returns nothing sendable; `authorizeMainnetSendWindow` remains the only emitter of a wallet envelope and still mints durable database evidence before returning one; `persistMainnetDeploymentTxHash` is unchanged and still intentionally ungated for same-hash recovery; the CLAIMED cancellation RPC remains service-role only with no application wrapper.
11. All three literal switches remain false: `MAINNET_DEPLOYMENT_TX_ENABLED`, `MAINNET_LIQUIDITY_TX_ENABLED`, `MAINNET_VERIFICATION_STATE_WRITES_ENABLED`.
12. Verification: `bunx tsgo --noEmit` PASS; `bun run build` PASS.
13. Live database after all work: 0 production deployments, 0 presign authorizations, 0 send-window issuances, 0 canary permits; one control row `ROBINHOOD_MAINNET_DEPLOYMENT` with `execution_enabled=false`, `emergency_stop_engaged=true`, revision 1, reason `INITIAL_DEFAULT_OFF`; 1 control event. The rollback QA persisted nothing.
14. With runtime execution disabled, emergency stop engaged, zero permits and zero eligible deployments, real-money execution is now blocked by four independent gates (compile-time switch, runtime control, canary permit, send window) and would still refuse today even if every compile-time switch were flipped.
15. No wallet, signer, browser provider, broadcast, testnet path, secret change, Edge Function deploy, Telegram, liquidity, lifecycle or UI surface was touched; no real transaction, signature or ETH movement occurred; project remains PRIVATE / UNPUBLISHED.
16. Known deferred item: the security linter reports pre-existing categories (RLS-enabled-with-no-policy, SECURITY DEFINER reachable-by-role checks); the permit table's policy-free state is intentional and remediation was not attempted because a second migration is outside this contract.
17. Next allowed step: READ-ONLY audit of bounded runtime re-arm / auto-disarm / zero-money rehearsal contract only. STOP.
