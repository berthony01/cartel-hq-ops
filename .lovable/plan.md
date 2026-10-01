# PCART Launcher — Read-Only Audit and Simplify / Finish / Test / Lock Plan

Audit only. Nothing was edited, applied, deployed or published. Live database values were not queried; switch states below come from repository migrations and source, and must be confirmed read-only before any build.

## A. Current flow and where complexity leaks

Two owner pages plus one harness:

```text
/chain-launcher  (6 sections)
  1 Wallet + network connect
  2 "Test deployment" (legacy C8.2 throwaway artifact)        <- leak
  3 PCART rehearsal panel (frozen pepecartel-token-v1, testnet)
  4 Token form + "Run simulation" + SimulationReviewCard        <- jargon
  5 LaunchReceiptCard
  6 Liquidity planning (LiquidityPlanCard, local math only)     <- implies a capability that does not exist
/launch-control  (~17 sections)
  Overview, Details, Schedule, Launch Watch, Communications, Deploy & Contract,
  LaunchLifecycleRail, contract registration,
  TreasurySignerSetupPanel -> PcartProductionBlockedCheckpoint -> ProductionDeploymentRequestPanel
/mainnet-canary  (8 sections, canary permits, operator log)    <- operator-only internals
```

Leaks: the user goes back and forth between pages; "simulation", "init code", "canary", "presign", "canonical", "verifier" wording; the legacy test deployment sits next to the real flow; liquidity planning has no auction or liquidity behind it; treasury appears last instead of before token setup (the treasury address is the token's mint recipient).

## B. Keep unchanged (protected)

- `contracts/PepeCartelToken.sol`, `artifacts/pepecartel-token-v1.*`, `src/lib/pepecartel-token.artifact.ts` (frozen, immutable 1B, no mint/tax/admin — already matches the locked direction).
- `src/lib/launch-artifact-registry.ts` (`isArtifactAllowedIn`), `src/lib/chain-mainnet-registry.ts`, `src/lib/chain-mainnet-presign.functions.ts`, `src/lib/chain-verify.functions.ts`.
- `src/lib/treasury-safe-verify.ts`, `src/lib/treasury-signers.ts`, and their SQL/RPCs.
- `launch_chain_production_execution_controls`, canary permits, presign authorizations, emergency stop, verification RPCs (`apply_launch_chain_*`), `assert_launch_contract_evidence`.
- Launch lifecycle RPCs, Launch Watch, notifications.
- All `scripts/pcart-*`, `launcher-b*`, `p3c-f*`, `hardening-b`, `verifier-state-write-activation` regressions.

## C. Simplify / merge / hide (presentation only)

- `src/routes/_authenticated/chain-launcher.tsx`: hide the "Test deployment" section (~line 826–898) behind an Advanced toggle; rename "Run simulation" to "Check launch"; hide the liquidity planning section (~1126–1230) or label it "Planning preview — not live".
- `src/components/chain/SimulationReviewCard.tsx`, `LaunchReceiptCard.tsx`, `PcartRehearsalPanel.tsx`: plain wording by default, technical details folded into "Technical details".
- `src/components/chain/LiquidityPlanCard.tsx`: move behind Advanced.
- `src/routes/_authenticated/launch-control.tsx` + `TreasurySignerSetupPanel`, `PcartProductionBlockedCheckpoint`, `ProductionDeploymentRequestPanel`, `LaunchLifecycleRail`: put them under a single five-step guide (Token, Auction, Treasury, Review, Launch) with one Ready / Not Ready summary.
- `/mainnet-canary`: keep it owner/operator-only and leave it out of the normal user guide.
- New view-model helper (pure, like `src/lib/launch-readiness.ts`) that works out the 5 steps and PCART Ready / Not Ready from existing state. It is read-only.

## D. Missing vs hidden

Missing (no code at all, only in the docs):
- CCA auction: config, contract addresses, creation, bidding, settlement. `chain-mainnet-registry.ts` deliberately contains no auction or Uniswap addresses.
- Target Raise vs Graduation Floor fields and the logic between them.
- Moving funds into Uniswap v4 after the auction, and permanent LP custody.
- Team vesting contract or integration.
- Safe creation. Only signer recording and checking an existing Safe exist.

Hidden / incomplete:
- Liquidity planning: a local calculator only.
- The PCART artifact is testnet-only. The L1-e2 exact-artifact testnet rehearsal has not been done.
- The treasury recipient is unresolved.

## E. PCART work left before "finished but mainnet locked"

1. Real 2-of-3 Safe deployed (by the owner, outside the app). Its 3 signers recorded. It must pass the existing canonical Safe check.
2. Exact-artifact testnet rehearsal of `pepecartel-token-v1` with the Safe as recipient. Then verification and a receipt.
3. Check the current upstream CCA and Uniswap v4 deployments on Robinhood Chain (L1 manifest addresses are "RESEARCHED / NOT ON-CHAIN VERIFIED"). Confirm whether permanent LP custody is supported there.
4. Decide on auction integration: CCA factory call from the Safe or the user's wallet. That needs design approval before any code.
5. Choose and integrate a vesting mechanism (an existing audited vesting contract). The economics are not decided here.
6. Production allowlist change for `pepecartel-token-v1`. This is a separate high-risk gate and stays off until launch authorization.
7. Simplified UX plus a PCART Ready / Not Ready checklist that names each item above.

"Finished but mainnet locked" means items 1–5 and 7 are done and tested on testnet. Item 6 and the execution controls stay off.

## F. Staged batches (each its own approval)

```text
L-S1 UX shell (low risk)  -> five-step guide + Advanced toggle + plain wording; presentation only
L-S2 Readiness model       -> pure PCART Ready/Not Ready derivation + unit tests; no backend
L-S3 Upstream verification -> read-only on-chain check of CCA, Uniswap v4, LP custody, vesting candidates; doc only
L-S4 Treasury + rehearsal  -> owner deploys Safe; record signers; testnet rehearsal of frozen artifact (existing paths)
L-S5 Auction design lock   -> written contract: auction params (target, floor, ~96h), who signs, settlement; no code
L-S6 Auction integration   -> testnet only, behind existing controls; staged SQL if needed
L-S7 Liquidity + vesting   -> testnet only; permanent LP custody; vesting
L-S8 Lock                  -> full regression, readiness = Ready (testnet), mainnet controls verified OFF
```

Dependencies: S1 and S2 can run in parallel. S4 needs the Safe. S6 needs S3 and S5. S7 needs S6. Tests per batch: the existing launcher regressions must stay green, plus a check at 390px and on desktop for S1, unit fixtures for S2 (0/N through N/N), and a testnet receipt check for S4, S6 and S7.

## G. Defer (not launch-critical)

- Legacy C8.2 test-artifact deployment (hide, don't delete).
- Generic `cartel-fixed-erc20-v1` launches for other projects (keep, but out of PCART focus).
- Liquidity calculator UI until S7.
- Mainnet canary UI improvements.
- Quick Launch / custom contracts, Protected Launch, Launch Passport, public launchpad.

## H. Safety switches (from repo; live confirmation pending)

- `execution_enabled=false`, `emergency_stop_engaged=true` (bootstrap row `INITIAL_DEFAULT_OFF`), service-role only, RLS forced; the stop can only be engaged, never cleared by the same path.
- `MAINNET_LIQUIDITY_TX_ENABLED=false`. `MAINNET_DEPLOYMENT_TX_ENABLED=true` is a capability flag that does nothing alone: a send also needs the control row, a canary permit and a presign authorization.
- `pepecartel-token-v1` is TESTNET-only in `launch-artifact-registry.ts`.
- Do not change casually: the files in section B, the execution-control/canary/presign SQL, `enforce_launch_chain_*` triggers, `enforce_canonical_pcart_no_production_deployment`, the verifier RPCs, and the wallet-only signer rule (no server signer).

Recommended first step: a read-only SQL check of the live control row, canary permits and presign rows. Then approve L-S1 and L-S2.
