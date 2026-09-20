# PCART-L1/L2 Dedicated Production Artifact Foundation — Phased Plan (PLAN/AUDIT ONLY)

HEAD inspected: `ab21611c951de5405165e1e4189ff636336c7b7c`, working tree clean. No file was edited, no SQL run, nothing deployed.

## 1. Where `cartel-fixed-erc20-v1` is hard-coded today

**Single source of truth**
- `src/lib/cartel-fixed-erc20.artifact.ts:22` — `CARTEL_FIXED_ERC20_ARTIFACT_ID`; also creation/runtime bytecode + both keccak hashes (lines 150–162).

**Application code that assumes exactly this artifact (TypeScript)**
- `src/lib/launch-evidence-checks.ts:21` — `APPROVED_OFFICIAL_ARTIFACT_ID` (the official-registration allowlist, a literal, not an array).
- `src/lib/launch-verified-eligibility.ts:2,54,238,245`
- `src/lib/chain-mainnet-presign.functions.ts:136`; `chain-mainnet-presign.helpers.ts:184,185,209`
- `src/lib/chain-mainnet-handoff.functions.ts:311,312,336,415`
- `src/lib/chain-mainnet-reconciliation.helpers.ts:203,204,228,290`
- `src/lib/chain-mainnet-verify.functions.ts:150,338`; `chain-mainnet-verify-shape.ts:85`
- `src/lib/chain-mainnet-simulation.ts:63,223,224,239,240`
- `src/lib/chain-simulation.ts:48,184,185,198,199`; `chain-launcher.ts:317`; `chain-verify.functions.ts:103,244,343`
- `src/lib/launch-receipt.ts`, `src/routes/_authenticated/chain-launcher.tsx:61,978` (display only)

**Database (live, already applied — treated as read-only here)**
- `launch_chain_deployments` CHECK: `artifact_id IS NULL OR artifact_id = 'cartel-fixed-erc20-v1'` (`supabase/migrations/20260904125451_…sql:23`) — a hard single-artifact constraint.
- `assert_launch_contract_evidence` (`20260907045317_…sql:39`), attempt-intent RPC (`20260906133800_…sql:130,156,167`), handoff request/claim RPCs (`20260911213957_…sql:195`, `20260911222451_…sql:235,299,332`), canary runtime control (`docs/sql/20260909_…sql:157`).

**Regressions that pin it**: `scripts/hardening-b-regression.ts:63`, `scripts/p1a-project-journey-regression.ts:620`.

Conclusion: a second artifact id is a **Phase 3** change touching both the TS allowlist and at least one DB CHECK + several SECURITY DEFINER RPCs. Nothing in Phase 1 or 2 may touch them.

## 2. Phase 1 — exact minimum files (non-operational foundation)

Add only:
1. `contracts/PepeCartelToken.sol` — DRAFT, header-marked NOT DEPLOYABLE, not compiled anywhere (repo has no solc/hardhat/foundry tooling; confirmed in `package.json`).
2. `docs/PCART_L2_TOKEN_SPECIFICATION.md` — the frozen behavioural spec, intended future artifact id `pepecartel-token-v1`, compiler settings to be used in Phase 2, and the explicit statement that no artifact file, allowlist entry, request, or migration exists yet.
3. `scripts/pcart-l2-draft-artifact-regression.ts` — source-level invariants (section 5).

Change only:
4. `docs/PCART_MASTER_LAUNCH_PLAN.md` — one narrow amendment recording owner authorization for a DRAFT, non-deployable source file while L1 stays OPEN (see section 9 — without this the plan text forbids Phase 1).
5. `package.json` — only if a `scripts` entry is wanted for the new regression; otherwise untouched (preferred: untouched, run via `bun run scripts/...`).

No changes to any `src/**` file, any migration, any Supabase object, any flag.

## 3. DRAFT `PepeCartelToken.sol` design

Mirrors the audited behaviour of `CartelFixedSupplyToken.sol` with identity hard-coded instead of constructor-supplied:

- `// SPDX-License-Identifier: MIT`, `pragma solidity 0.8.36;`
- imports only `@openzeppelin/contracts/token/ERC20/ERC20.sol` (OZ 5.6.1)
- `contract PepeCartelToken is ERC20`
- `ERC20("PEPECARTEL", "PCART")`; `decimals()` NOT overridden → 18
- `uint256 public constant INITIAL_SUPPLY = 1_000_000_000 * 10 ** 18;` (constant, not immutable, so runtime bytecode stays argument-independent and hashable)
- constructor: `constructor(address treasury_)`; `if (treasury_ == address(0)) revert ZeroTreasury();` then `_mint(treasury_, INITIAL_SUPPLY);`
- `error ZeroTreasury();` only
- Explicitly absent: Ownable/AccessControl/roles, any mint/burn path after construction, pausable, capped, permit, tax/fee-on-transfer, blacklist/whitelist/freeze/cooldown, trading toggle, max-wallet/max-tx, overridden hooks, proxy/initializer/upgrade path, `selfdestruct`, `delegatecall`, `immutable` state, and any constructor argument other than `treasury_`.
- Header comment states: DRAFT, PCART-L2 candidate, NOT COMPILED, NOT FROZEN, NOT ALLOWLISTED, not deployable while PCART-L1 is open.

## 4. Is Phase 1 safe now?

Technically yes — a `.sol` file alone cannot make PCART deployable: deployment reads only the frozen `src/lib/cartel-fixed-erc20.artifact.ts` bytecode, the DB CHECK rejects any other `artifact_id`, `MAINNET_DEPLOYMENT` is `execution_enabled=false` / `emergency_stop_engaged=true` at revision 5, and no PCART production request row exists.

Procedurally it needs the section 9 amendment first, because the master plan currently forbids writing Solidity before L1 closes.

## 5. Phase 1 regression tests

`scripts/pcart-l2-draft-artifact-regression.ts`, in the existing dependency-free `node:assert` + `node:fs` style, asserting:
1. The draft source exists and carries the DRAFT / NOT DEPLOYABLE / PCART-L1-open markers.
2. Exact pragma `0.8.36`, sole import is the OZ ERC20, base is `ERC20` only.
3. Name `PEPECARTEL`, symbol `PCART`, supply literal `1_000_000_000 * 10 ** 18`, no `decimals()` override.
4. Exactly one constructor parameter, an `address`; zero-address revert present.
5. Forbidden-token-scan: no `Ownable`, `AccessControl`, `onlyOwner`, `_mint(` outside the constructor, `mint`, `burn`, `pause`, `blacklist`, `maxWallet`, `maxTx`, `fee`, `tax`, `_update` override, `initializer`, `upgrade`, `delegatecall`, `selfdestruct`, `immutable`.
6. **Non-activation tripwires (the important ones):** `pepecartel-token-v1` appears in NO file under `src/`, `supabase/migrations/`; `APPROVED_OFFICIAL_ARTIFACT_ID` is still exactly `cartel-fixed-erc20-v1`; `src/lib/cartel-fixed-erc20.artifact.ts` is byte-identical to HEAD (hash-pinned); no new file under `supabase/migrations/`; no `PepeCartelToken` reference from any `src/**` file.
7. The spec doc states L1-open and non-deployable status.

Also re-run unchanged: `hardening-b`, `p1a-project-journey`, `p2c2-launch-isolation`, `p3c-f`/`f1`/`f2`, `launcher-b`/`b3`, `verifier-state-write-activation`, `pcart-l1b-treasury-safe-verify`, `wallet-connector`, plus `bunx tsgo --noEmit` and `bun run build`.

## 6. DB migration in Phase 1?

**None. Zero SQL.** No table, column, CHECK, RPC, policy, grant or data change. The `artifact_id` CHECK widening and PCART-specific fail-closed request/execution invariants belong to Phase 3, after Phase 2 freezes real hashes. Attempting the CHECK change earlier would widen the accepted artifact space before any artifact exists to accept.

## 7. Prohibited in Phase 1

Editing `src/lib/cartel-fixed-erc20.artifact.ts` or its id/hashes; adding `pepecartel-token-v1` anywhere outside the draft spec doc; touching any `src/**` runtime file; any migration or SQL; any change to `MAINNET_DEPLOYMENT_TX_ENABLED`, `MAINNET_LIQUIDITY_TX_ENABLED`, `MAINNET_VERIFICATION_STATE_WRITES_ENABLED`, or runtime execution control; creating a PCART production deployment request; arming, claiming, or issuing a send window; any wallet, RPC-write, or blockchain transaction on any chain; deploy, publish, secret change, Telegram send; weakening or deleting any existing assertion in any regression suite; installing solc/hardhat/foundry or any compile step.

## 8. Stop point and acceptance criteria

Stop immediately after Phase 1 verification. Acceptance:
- Diff vs `ab21611c` is exactly the files in section 2 (3 added, 1–2 docs/config changed), nothing else.
- `src/`, `supabase/`, `docs/sql/`, generated types, `.lovable/plan.md`: zero diff.
- New regression passes; all listed existing suites pass at their current counts; `tsgo` clean; `bun run build` succeeds.
- Live state unchanged: PCART launch still WATCHLIST_OPEN, `official_contract_address` NULL, no production request rows, control still `execution_enabled=false` / `emergency_stop_engaged=true` revision 5.
- Report SHA, diffstat, per-suite counts, and residual uncertainty. Do not start Phase 2.

## 9. Doc/implementation inconsistencies that affect Phase 1 safety

1. **Blocking:** `docs/PCART_MASTER_LAUNCH_PLAN.md:18` and `:304` say do not write Solidity until L1 fully closes, and `:220` puts `PepeCartelToken.sol` under L2 ("only after L1 fully closes"). Phase 1 as requested contradicts the plan unless the plan is amended in the same commit to permit a DRAFT, non-compiled, non-allowlisted source. Recommendation: make that amendment the first hunk of Phase 1.
2. **Non-blocking, affects Phase 3 sizing:** the DB allowlist is a single-value CHECK plus the literal baked into ~6 SECURITY DEFINER RPCs, not a lookup table. Phase 3 is therefore a multi-RPC migration, not a one-line change — budget it accordingly.
3. **Non-blocking:** the TS allowlist `APPROVED_OFFICIAL_ARTIFACT_ID` is a single literal, not a set; Phase 3 must convert it to an explicit two-entry allowlist without changing the canary's evaluation result.
4. **Unresolved L1 inputs that gate Phase 2, not Phase 1:** no PEPECARTEL Safe exists, no treasury recipient address is fixed (`docs/PCART_MASTER_LAUNCH_PLAN.md:317`), plus operational ETH reserve, legal/comms review, Robinhood/Uniswap compatibility, fork/testnet simulation. Since the draft constructor takes the treasury as an argument, the unknown address does not block Phase 1.
5. **Note:** `TreasurySafeVerificationPanel` is advisory/optional and no treasury/artifact DB table exists — consistent with the docs; no conflict for Phase 1.
