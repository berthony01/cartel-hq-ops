# Wallet Identity Mismatch — Read-Only Audit (Mainnet Canary console)

HEAD `54866be3246495553a1dea07a83a33ae1c40552c` ("Harden wallet identity gating"), `git status` clean. No files edited, no migration, no secret, no transaction, no publish during this audit.

## A. Root cause

Two distinct defects, both in the console, none in the wallet layer.

**A1 — CONFIRMED attempts are treated as live "existing attempts".**
`src/lib/chain-mainnet-canary.functions.ts` → `readCanaryExistingAttempt`:

```
const TERMINAL_ATTEMPT_STATUSES = ["FAILED", "ABANDONED"]
```

`CONFIRMED` is not in that list, so the query returns the newest non-FAILED/non-ABANDONED row. For launch `bade8faa` that is attempt 2 (`11381a8c`, status `CONFIRMED`). The route (`src/routes/_authenticated/mainnet-canary.tsx`) then feeds `existingAttempt.deployerAddress` / `existingAttempt.tokenRecipient` into `CanaryIntentForm` as `attemptBoundDeployer` / `attemptBoundRecipient`, and `CanaryIntentForm` renders those read-only with "existing attempt — immutable". So a finished historical deployment is presented as current editable-launch intent, showing recipient `0xf95f…6485` next to deployer `0xe5b2…d617`.

Data path: table `launch_chain_deployments` columns `status`, `deployer_address`, `token_recipient`, filtered by `launch_id`, `chain_id=4663`, `network_environment='PRODUCTION'`, `deployment_kind='FIXED_SUPPLY_ERC20'`. No RPC involved in the read.

**A2 — Launch switching does not reset per-launch state.**
In `mainnet-canary.tsx`, `onSelectLaunch` only sets `name` and `symbol`. It does **not** clear `deployer`, `recipient`, `supply`, `intent`, `deploymentId`, `authorizationId`, `authorizationExpiresAt`, `armPhrase`, `armSuccess`, `claimSuccess`, `quote`, `preflight`, `txHash`. Consequences:

- `activeDeploymentId = deploymentId ?? existingAttempt?.deploymentId` can still hold the *previous* launch's deployment id after switching — presign/ARM/CLAIM would target the wrong launch.
- `intent` built for launch X survives into launch Y and would be submitted by "Create production attempt".
- `CanaryIntentForm.syncBinding` only re-runs on wallet events (`useEffect` deps `[syncBinding]`, which is stable), not when `attemptBound*` props change, so after leaving a launch that had an attempt, the previously bound/typed deployer and recipient remain in form state.

## B. Fabricated addresses?

None. `rg` over `src/` and `scripts/` finds no hardcoded EOA addresses — only the zero address, artifact bytecode/hashes, and `0x1111…`/`0x2222…` test fixtures in the regression script. Every unexpected address is persisted historical DB data:

- attempt 1 `685300e1` ABANDONED — deployer `0xc23b…9245`, recipient `0xf95f…6485`
- attempt 2 `11381a8c` CONFIRMED — deployer `0xe5b2…d617`, recipient `0xf95f…6485`, tx `0xa997…d6ae`, contract `0xef60…8873`

## C. Was attempt 2's recipient actually committed on chain?

Yes. Prior read-only RPC evidence for contract `0xef60…8873` on chain 4663 showed total supply `1000e18` held entirely by `0xf95f…6485`. Attempt 2's recipient is immutable historical truth and must never be edited or "corrected" — it predates the later deployer==recipient canary rule.

## D. Correct behavior for a NEW unsubmitted attempt

With a verified connected wallet on chain 4663 and no *live* attempt: deployer and recipient are both bound to the validated connected account, read-only, and any historical CONFIRMED/FAILED/ABANDONED row is shown only as history — never as the source of the new intent. Historical identity may never prefill or silently override current wallet identity.

## E. Minimal surgical fix (proposed, not applied)

1. `chain-mainnet-canary.functions.ts`: treat `CONFIRMED` (and any other terminal state) as terminal for the *blocking* lookup; return it separately as `historicalAttempt` (read-only display) rather than `attempt`. Keep creation blocked only by genuinely live attempts, and keep the fail-closed unverified path.
2. `mainnet-canary.tsx`: on launch change, reset all per-launch state listed in A2 (deployer, recipient, supply, intent, deploymentId, authorizationId/expiry, arm/claim flags, quote, preflight, txHash, tail).
3. `CanaryIntentForm.tsx`: re-run `syncBinding` when `attemptBoundDeployer` / `attemptBoundRecipient` change, so releasing an attempt binding immediately re-binds to the validated connected wallet or clears.

No DB writes, no migration, no change to presign/ARM/CLAIM/send/verify semantics.

## F. UI distinction

Yes. The console should render two clearly separate blocks: **CURRENT CONNECTED WALLET** (validated session identity, used for any new attempt) and **HISTORICAL ATTEMPT IDENTITY** (read-only, per attempt, with status). When a *live* attempt's immutable deployer differs from the connected account, fail closed: block the send path and state the mismatch, exactly as the pre-send handoff already does — but never bind or display historical identity as current intent.

## G. Verification tests to add

1. Lookup: a `CONFIRMED`-only launch returns `attempt: null` (creation unblocked) and surfaces history separately; a `SUBMITTED`/live row still blocks.
2. Switching launch X→Y clears deployer, recipient, supply, intent, deploymentId, authorizationId, arm/claim flags — asserted as an exact field list tripwire.
3. `activeDeploymentId` can never be a deployment id belonging to a different launch id.
4. Form re-binds to the validated connected account when `attemptBound*` transitions from set to null, and never copies a historical recipient into a new intent.
5. Server rejects `tokenRecipient !== deployerAddress` before the create RPC (existing assertion, keep).
6. No new attempt is created with a deployer that differs from the validated connected account while a wallet is connected.
7. No path added that mutates or corrects any historical `launch_chain_deployments` row.

STOP — audit only, nothing built.
