# Verify and finalize — read-only diagnosis and minimal fix proposal

HEAD `c95bd02c63bc02fd7c4a99d628968154fd3c7f97`, tree clean. No file, DB, wallet, or transaction action taken. RPC endpoint never printed.

## 1. On-chain evidence reproduced (read-only managed RPC)

Every check the verifier performs passes on chain for tx `0xa9979a94…d6ae`:

- chain id `0x1237` = 4663 (production)
- transaction: `from 0xe5b2…d617`, `to = null` (contract creation), `value 0x0`, init code present
- receipt: `status 0x1`, contract `0xef60997969d865c9542f3ea8dd9794e842038873`, block `0x385ee61` (59108961), block hash `0xf00ade04…8bc0`
- deployment-block re-read returns the identical block hash (no reorg)
- runtime code keccak256 = `0xcac530c4300d48804d9707b87f0ab52e91ba7b2ced97bc84e5a377ae702c10c0`, which equals the frozen `CARTEL_FIXED_ERC20_RUNTIME_BYTECODE_HASH` exactly
- token reads: `decimals = 18`, `totalSupply = 1000e18`, name/symbol return normally
- finalized head `0x38628ad` (59122349) is far past the deployment block, so managed finality is FINALIZED, not pending

Conclusion: the chain side is fully valid. Nothing on chain can explain a SUBMITTED row with no evidence — the verifier either never ran to completion or threw.

## 2. Why the UI "did nothing" (confirmed defect)

`useBusy.run()` in `src/components/cartel/CanaryReadout.tsx` wraps the action in `try { await fn() } finally { setBusy(null) }` — there is **no catch**. The Verify handler in `src/routes/_authenticated/mainnet-canary.tsx` is:

```
setTail(await verify({ data: { deploymentId: activeDeploymentId } }));
note("Verifier run.");
```

If the server function throws, `setTail` and `note` are both skipped, the spinner clears, and the failure becomes an unhandled promise rejection visible only in the browser console. The operator sees an exactly silent button. This applies to every stage handler, not just Verify.

## 3. Where the verifier throws rather than returning a notice

`verifyMainnetChainDeployment` returns structured `notice` codes for every chain/provider uncertainty, but it **throws** in three places:

1. `Invalid deployment id` — input validator (not applicable here; persist used the same id).
2. `Not authorized` — the RLS read of `launch_chain_deployments` returned an error or no row.
3. `Unsupported deployment artifact` — the row-pin block: chain id, `network_environment`, `deployment_kind`, `artifact_id`, `token_decimals`, `token_name`, `token_symbol`, `token_total_supply_text` (digits only), `token_recipient` and `deployer_address` must all be present and exact on the row.

Given the row exists (persist succeeded against it) and the chain evidence matches, the overwhelmingly likely throw point is **(3)**: one or more of the pinned token columns on deployment `11381a8c…` is null or not in the expected shape, so the verifier aborts before any RPC read and before any state write. A secondary, less likely possibility is that the verifier ran, reached the PENDING apply, and the RPC refused the `SUBMITTED → PENDING` transition — but that path returns `STATE_WRITE_FAILED_RETRYABLE` in the readout, which the operator did not see, which again points at a throw.

This cannot be narrowed further without reading the deployment row; DB access was out of scope for this turn.

## 4. Root cause

Two independent defects, both real:

- **A (visibility, certain):** thrown server errors in the canary console are silently swallowed by `useBusy`, so a failing Verify is indistinguishable from a no-op.
- **B (behaviour, near-certain):** `verifyMainnetChainDeployment` throws on the row-pin check instead of returning a diagnostic notice, so an incomplete/mismatched deployment row produces a bare 500 with no indication of which pin failed.

## 5. Minimal fix proposal (not applied)

1. `src/components/cartel/CanaryReadout.tsx` — add `catch` to `useBusy.run`, storing a sanitized message so the caller can surface it. Presentation only; no change to gating or ordering.
2. `src/routes/_authenticated/mainnet-canary.tsx` — every `run(...)` handler reports the caught error via `note()` and `setTail({ error: message })`. No new server calls, no auto-advance, no retry.
3. `src/lib/chain-mainnet-verify.functions.ts` — replace the `Unsupported deployment artifact` throw with a structured fail-closed return (`result.notice = "ROW_PIN_MISMATCH:<field>"`), naming only the failing field name, no values. Still refuses all chain reads and all writes — identical safety, diagnosable outcome.
4. Before or alongside the fix: a read-only inspection of deployment row `11381a8c…` to confirm which pinned column is missing, and whether the recorded `status` must be advanced by the persist/verify RPC contract rather than by the verifier.

Nothing in this proposal touches presign/arm/claim/send-window/send, liquidity, secrets, migrations, or publication.
