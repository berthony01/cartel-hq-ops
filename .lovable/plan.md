# C8.4 Read-Only Architecture Audit — Launch Simulation / Pre-Sign Preflight

Audit only. No code, migrations, SQL writes, deployments, or publishes were performed in this turn.

## 1. Authoritative current-state findings (verified this turn)

- HEAD is `4f544f6defae69d9393b188499f8aef3adfca8d8`, `git status --porcelain` empty. No newer code commit exists.
- PEPECARTEL launch `9f9af215-66ee-4a10-92db-617b61fb7fd3`: chain `Solana`, status `WATCHLIST_OPEN`, `official_contract_address` NULL, `contract_registered_at` NULL, Launch Watch token present, 4 chain deployment attempts.
- `src/lib/chain-registry.ts` holds the only chain configuration: `ROBINHOOD_TESTNET_CHAIN_ID = 46630`, `NETWORK_ENVIRONMENT = "TESTNET"`, RPC/explorer constants, `CHAIN_ID_HEX`, `REQUIRED_CONFIRMATIONS = 5`, and the inert C8.2 test artifact. Mainnet 4663 is absent, not disabled.
- `src/lib/chain-launcher.ts` already contains every primitive C8.4 needs, and they are already non-mutating: `getInjectedProvider`, `connectWallet`, `readChainId`, `readBalanceWei`, `formatEth`, `ensureTestnet`, `normalizeTokenIntent` (ASCII-only 1–32 char name, `^[A-Z0-9]{2,11}$` symbol, digits-only supply 1…1e12 whole tokens, non-zero checksum-insensitive recipient), `buildTokenInitCode` (frozen creation bytecode + `encodeAbiParameters` for `(string,string,uint256,address)`), and exact base-unit handling via `bigint`/text only.
- There is **no** `eth_estimateGas`, fee-data, or `eth_call` preflight anywhere in the client today. Gas estimation exists only as out-of-band audit scripting from earlier phases.
- Mutating boundary today: `handleDeployToken` calls `createTokenDeploymentAttempt` (DB row) **before** `broadcastTokenDeployment`. Nothing between validation and row creation reviews the intent. That gap is exactly what C8.4 fills.
- `src/lib/chain-verify.functions.ts` is an authenticated `createServerFn` with `requireSupabaseAuth`; it re-derives init code server-side and enforces the 5-confirmation floor. C8.4 must not alter it.
- `src/routes/_authenticated/chain-launcher.tsx` gates on `usePlatformAccess({ fresh: true })` plus `useWorkspace()`; RPCs and the verifier enforce authorization independently (fail-closed).
- No test runner is installed (no `vitest` dependency, no test script, no test files). C8.4 tests must therefore be out-of-band Node/bun scripts under `/tmp`, not new repo test infrastructure — adding a runner would require package.json changes, which are prohibited.

**Verdict: GO** for a client-side, zero-persistence simulation layer as specified below.

## 2. Recommended C8.4 architecture

A pure, in-memory preflight module plus a review card. No database, no server function, no new RPC, no schema.

```text
operator input (name, symbol, supplyWhole, recipient)
        v
normalizeTokenIntent()                      [existing, unchanged]
        v
buildSimulationIntent()                     [new, pure]
  -> frozen fields + initCode + initCodeHash + intentFingerprint
        v
runPreflight(provider, intent)              [new, read-only RPC only]
  -> eth_chainId, eth_accounts, eth_getBalance,
     eth_call(create), eth_estimateGas(create), fee data
        v
SimulationReviewCard                        [new UI, testnet warning]
        v
operator confirms -> existing handleDeployToken, gated on
  fingerprint match + freshness  ->  createTokenDeploymentAttempt -> sign
```

Authorization: the simulation is rendered only inside the existing `usePlatformAccess({ fresh: true })` + workspace-scoped route. No new data is exposed that the operator did not type or that the wallet does not already expose to the page, so no new server-side authorization surface is required. The authoritative checks remain the existing SECURITY DEFINER RPCs and the server verifier.

## 3. Simulation data model (in-memory only)

```ts
type SimulationIntent = {
  environment: "TESTNET";
  chainId: 46630;
  artifactId: "cartel-fixed-erc20-v1";
  runtimeBytecodeHash: `0x${string}`;   // frozen artifact hash
  deployer: `0x${string}`;              // lowercase
  recipient: `0x${string}`;             // lowercase
  name: string;
  symbol: string;
  decimals: 18;
  supplyWhole: string;                  // exact decimal string
  totalSupplyBaseUnits: string;         // exact decimal string, never a number
  initCode: `0x${string}`;
  initCodeHash: `0x${string}`;          // keccak256(initCode)
  fingerprint: `0x${string}`;           // see section 4
};

type PreflightResult = {
  observedChainId: number | null;
  chainOk: boolean;
  observedAccount: string | null;       // lowercase
  accountMatchesDeployer: boolean;
  recipientValid: boolean;
  balanceWei: string | null;            // decimal string
  callOk: boolean;                      // eth_call on the creation tx
  gasEstimate: string | null;           // decimal string
  feeWeiPerGas: string | null;          // decimal string
  estimatedCostWei: string | null;      // gas * fee, bigint math only
  sufficientBalance: boolean | null;
  txValueWei: "0";
  errors: string[];
  quotedAtMs: number;
};
```

**Persistence recommendation: none.** Storing a simulation adds a writable pre-signing surface, an attacker-visible table, and retention/RLS obligations, while buying nothing — the binding property is the fingerprint, which is recomputed deterministically from the intent at sign time and re-derived independently server-side during verification. The server verifier is already the authority on what was actually deployed. Persist nothing in C8.4.

## 4. Deterministic intent fingerprint

`fingerprint = keccak256(utf8(canonicalString))` where `canonicalString` joins the following with `\u001f`, in this fixed order, all lowercase for hex fields:

```
"cartel-sim-v1"
environment            "TESTNET"
chainId                "46630"
artifactId             "cartel-fixed-erc20-v1"
runtimeBytecodeHash
deployer
recipient
name                   exact normalized string, NFC-normalized
symbol                 exact normalized uppercase string
decimals               "18"
totalSupplyBaseUnits   exact decimal string
initCodeHash
```

Properties: `initCode` is not included directly (its hash pins it); every mutable input is covered, so changing name, symbol, supply, recipient, deployer, chain, or artifact changes the fingerprint. Because it is a pure function of the intent, it cannot be replayed against a different intent, and a stale fingerprint carried forward is caught by recomputation immediately before signing.

Deliberately excluded: gas, fee, balance, nonce, timestamps — these are dynamic and must not invalidate a still-correct intent.

## 5. Expiration / staleness rules

- Fingerprint: never expires; it is recomputed, not remembered.
- Preflight quote (`gasEstimate`, `feeWeiPerGas`, `estimatedCostWei`, `balanceWei`): valid for **90 seconds**. After that the review card shows "Estimate expired — re-run preflight" and the deploy control is disabled.
- Any `chainChanged` or `accountsChanged` event immediately invalidates the whole simulation (not just the quote) and clears the card.
- Editing any intent field clears the simulation; the deploy control stays disabled until a fresh preflight passes.

## 6. UI/UX

A `SimulationReviewCard` rendered between the token form and the deploy button:

- Header: "Simulation — TESTNET ONLY. This is not the official PEPECARTEL token and creates no official contract."
- Intent block: name, symbol, decimals 18 (fixed), supply in whole tokens **and** exact base units, recipient, deployer, chain "Robinhood Chain Testnet (46630)", artifact `cartel-fixed-erc20-v1`.
- Guarantees block (restating the frozen contract): no owner/admin role, no post-deployment minting, no tax, no blacklist, no pause, no trading toggle, no proxy, no upgrade path.
- Preflight block: chain match, account match, recipient valid, balance, gas estimate, fee, estimated cost, `value = 0 ETH`, `eth_call` result — each pass/fail with a plain reason on failure.
- Fingerprint shown truncated with a copy affordance.
- Deploy is disabled unless every hard check passes and the quote is fresh.

## 7. C8.5 handoff contract

Before `createTokenDeploymentAttempt` and before `eth_sendTransaction`, C8.5 must require:

1. A `SimulationIntent` exists in state and its fingerprint, recomputed from the current form values at that instant, equals the stored fingerprint byte-for-byte.
2. Live `eth_chainId` still equals 46630, and live `eth_accounts[0]` still equals `intent.deployer`.
3. The preflight quote is fresh (< 90s) and `callOk` is true.
4. The transaction sent uses exactly `intent.initCode` as `data`, no `to`, `value: "0x0"` — the init code is taken from the simulation object, never rebuilt from raw form state.
5. The DB attempt is created from the same intent fields, so the existing server-side idempotency-conflict guard and the verifier's byte-for-byte init-code comparison both re-prove the binding.

Any mismatch aborts before the attempt row is created.

## 8. Security invariants and threat model

| Threat | Mitigation |
| --- | --- |
| Parameter tampering between simulation and signing | Fingerprint recomputed at sign time; init code taken from the simulation object |
| Chain switching mid-flow | `chainChanged` clears simulation; live `eth_chainId` re-read before signing; server verifier re-checks chain |
| Stale wallet account | `accountsChanged` clears simulation; live account re-read and compared to `intent.deployer` |
| Stale gas quote | 90s freshness window; expired quote disables deploy |
| Malicious injected provider response | All provider output is untrusted: hex strings are regex-validated before `BigInt`, gas/fee are advisory only, and no provider value ever enters the fingerprint or the init code |
| Oversized string / supply input | Existing `normalizeTokenIntent` bounds (name ≤ 32 printable ASCII, symbol 2–11 A–Z0–9, supply 1…1e12 whole) apply unchanged and are re-enforced server-side |
| Unicode / metadata ambiguity | Name is printable-ASCII-only already; fingerprint applies NFC normalization defensively so no two visually identical intents can diverge |
| Replay of a simulation fingerprint | Fingerprint is a pure function of intent, so replaying it against different values is impossible; it grants no authority by itself |
| Client-only trust | Simulation is advisory UX. Authority remains the SECURITY DEFINER RPCs, the idempotency-conflict guard, and the server verifier's init-code and 5-confirmation checks |
| Mainnet leakage | No 4663 constant may be introduced; chain id is a frozen literal |
| Floating point | Every supply/gas/fee/balance value is `bigint` or decimal string end-to-end; no `Number` on base units |

Hard invariants: zero DB writes during simulation; zero lifecycle writes; no signing or broadcasting; no new chain constants; artifact bytecode and hashes byte-identical; no bytecode input surface.

## 9. Exact file allowlist for C8.4 implementation

Allowed to edit / create:
- `src/lib/chain-simulation.ts` (new — intent building, fingerprint, preflight, all pure/read-only)
- `src/lib/chain-launcher.ts` (only to export existing helpers the simulation needs, or add read-only `eth_call`/`eth_estimateGas`/fee-data helpers; no change to broadcast or RPC functions)
- `src/components/chain/SimulationReviewCard.tsx` (new presentational component; final path confirmed against existing component conventions at build time)
- `src/routes/_authenticated/chain-launcher.tsx` (wire the card and gate the existing deploy handler)

Prohibited: `contracts/CartelFixedSupplyToken.sol`, `src/lib/cartel-fixed-erc20.artifact.ts`, `src/lib/chain-registry.ts`, `src/lib/chain-verify.functions.ts`, `src/integrations/supabase/*`, any `supabase/migrations/*` (no new migration in C8.4), `package.json`/lockfiles, all `launch_chain_deployments` tables/RPCs/policies, `launches` and Launch Control, Telegram/Launch Watch/notification/broadcast surfaces, and every publish/deploy action.

## 10. Test matrix (out-of-band scripts under /tmp; no test runner added)

1. `bunx eslint` (no `--fix`) on every touched file — 0 errors, 0 warnings.
2. `bunx tsgo --noEmit` clean.
3. `bun run build` passes.
4. Fingerprint determinism: same intent → same hash across repeated runs and fresh processes.
5. Fingerprint sensitivity: changed name, symbol, supply, recipient, deployer, artifact id, or chain id each produce a different hash.
6. Exact init code: computed init code equals frozen creation bytecode + `encodeAbiParameters(...)`, and matches the already-verified attempt #4 input byte-for-byte for the same intent.
7. Max-supply precision: 1e12 whole tokens → `1000000000000000000000000000000` base units exactly, digits only, no exponent, no rounding.
8. Wrong-chain preflight: observed chain ≠ 46630 → hard fail, deploy disabled.
9. Account changed after simulation → simulation cleared, deploy disabled.
10. Gas-estimate failure / `eth_call` revert → hard fail with a readable reason, no signing path reachable.
11. Zero DB writes: `launch_chain_deployments` row count and `updated_at` values unchanged across a full simulation session.
12. Zero lifecycle writes: PEPECARTEL row still Solana / WATCHLIST_OPEN / NULL contract / NULL registered_at / Launch Watch token present.
13. Mainnet grep: `rg -n "4663\b"` finds no mainnet chain id anywhere in `src/`.
14. C8.2 / C8.3 regression: inert test-artifact path and existing token deploy path unchanged apart from the added pre-sign gate; artifact bytecode and both keccak hashes byte-identical.
15. Final `git diff --stat` / `git status` proving scope.

## 11. Stop point

C8.4 implementation stops after the simulation module, the review card, the deploy gate, and the full verification report. No token is deployed, no attempt row is created, nothing is published, and C8.5 is not started.
