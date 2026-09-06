# P3C-B Managed Server-Side Pre-Sign Gate — Audit / Design (READ-ONLY)

No product file was edited, no migration created, no DB write performed, no secret read or printed.

## 1. Authoritative audit findings

- HEAD confirmed `b82e1eb` ("Revoke anon on P3C-A2 trigger"), working tree clean. Preceding commits `0c316a7`, `55db978`.
- **P3C-B does not exist under any name.** Searching the whole repo for pre-sign wiring returns only: the two A2 migrations, and generated `src/integrations/supabase/types.ts`. No server function calls `issue_launch_chain_production_presign_authorization`. Genuinely missing — nothing to duplicate.
- Live routines confirmed present in `public`, all SECURITY DEFINER: `issue_…`, `claim_…`, `invalidate_…`, `get_launch_chain_production_presign_authorization`, `create_launch_chain_production_token_deployment_attempt`, plus internal trigger `enforce_launch_chain_production_presign()`.
- Live `issue_…` signature (exact, in order): `_deployment_id uuid, _operator_user_id uuid, _client_request_id text, _gas_estimate_text text, _gas_limit_text text, _fee_model text, _observed_fee_per_gas_wei_text text, _max_fee_per_gas_wei_text text, _max_priority_fee_per_gas_wei_text text, _estimated_cost_wei_text text, _max_total_cost_wei_text text, _ttl_seconds integer`.
- Live `issue_…` body enforces: request id 8..128 chars; ttl 30..300 (default 60); fee model `EIP1559|LEGACY`; all economic values unsigned decimal `^(0|[1-9][0-9]{0,77})$`; EIP1559 requires priority, LEGACY forbids it; `gas_estimate > 0`; `gas_limit >= gas_estimate`; `max_fee >= observed_fee`; `priority <= max_fee`; `max_total_cost >= estimated_cost`; `max_total_cost >= gas_limit * max_fee`. Deployment must be chain 4663 / PRODUCTION / FIXED_SUPPLY_ERC20 / artifact `cartel-fixed-erc20-v1` / status DRAFT / `tx_hash IS NULL` / `review_fingerprint` and `init_code_hash` non-null. Expired ISSUED rows are swept to EXPIRED. Same `(deployment_id, client_request_id)` returns the identical row only when every authoritative field matches, otherwise `22023` conflict. Row values for fingerprint/init-code/deployer/workspace/launch/tx_value are copied from the deployment, not from parameters.
- **Conclusion: no P3C-B migration is required.** A2 schema and RPC surface are sufficient. Default position: zero migrations.
- Auth context: `requireSupabaseAuth` (`src/integrations/supabase/auth-middleware.ts`) provides `context.supabase` (RLS as caller), `context.userId` (JWT `sub`), `context.claims`. `src/start.ts` already registers `attachSupabaseAuth`, so the bearer is attached automatically.
- Managed RPC env name: `ROBINHOOD_MAINNET_RPC_URL`, referenced only through `ROBINHOOD_MAINNET_MANAGED_RPC_ENV` in `src/lib/chain-mainnet-registry.ts`. Configured status checked by presence only — **present**; value never read, logged, or returned.
- Frozen artifact reusable constants (`src/lib/cartel-fixed-erc20.artifact.ts`): `CARTEL_FIXED_ERC20_ARTIFACT_ID`, `_DECIMALS`, `_ABI`, `_CONSTRUCTOR_INPUTS`, `_CREATION_BYTECODE`, `_CREATION_BYTECODE_HASH`, `_RUNTIME_BYTECODE_HASH`.
- Coupling assessment:
  - `chain-launcher.ts` exports `getInjectedProvider` (browser `window.ethereum`) and testnet deployment/query surface. **Do not import into the server module** — browser + testnet coupling.
  - `chain-mainnet-simulation.ts` imports `chain-launcher.ts` transitively, so it inherits the same coupling. **Do not import.** Its `mainnetFingerprintPreimage` field order and separator are the fingerprint contract and must be reproduced independently, byte-identically, in the server module (domain `cartel-mainnet-sim-v1`, `\u001f` separator, NFC-normalized name/symbol, lowercased hex fields, `txValueWei = "0"`).
  - `chain-mainnet-registry.ts` is server-safe and must be reused.
  - Precedent for structure: `chain-mainnet-verify.functions.ts` (RLS read via `context.supabase`, managed-endpoint-only transport, `supabaseAdmin` dynamically imported inside the handler).

## 2. Recommended P3C-B architecture and data flow

Single authenticated server function `presignMainnetTokenDeployment` in one new file `src/lib/chain-mainnet-presign.functions.ts`.

```text
browser -> presignMainnetTokenDeployment({ deploymentId, clientRequestId })
  1. requireSupabaseAuth -> context.userId (operator identity is NEVER an input)
  2. context.supabase read of launch_chain_deployments (RLS = tenancy gate)
  3. hard row pins: chain 4663, PRODUCTION, FIXED_SUPPLY_ERC20, artifact id,
     status DRAFT, tx_hash null, review_fingerprint + init_code_hash present
  4. independent server reconstruction of constructor args + init code from the
     frozen artifact and stored token intent (no browser payload accepted)
  5. recompute keccak256(initCode) == stored init_code_hash  (else fail closed)
     recompute canonical fingerprint == stored review_fingerprint (else fail closed)
  6. managed provider reads only (chain 4663 pinned)
  7. deterministic gas/fee/cost derivation, bigint only
  8. supabaseAdmin.rpc('issue_launch_chain_production_presign_authorization', ...)
     with _operator_user_id = context.userId
  9. return authorization id/status/expiry + evidence summary. Never the endpoint.
```

`supabaseAdmin` is loaded with `await import("@/integrations/supabase/client.server")` **inside the handler**, after all authorization checks, matching the verifier.

No transaction is prepared, signed, or submitted. No deployment status transition, no tx-hash write, no liquidity, no kill-switch read other than as a refusal condition. The module must also refuse outright while `MAINNET_DEPLOYMENT_TX_ENABLED === false`, unless the build contract explicitly authorizes issuing authorizations with the execution switch still off (recommended: allow issuance, since A2 authorization is not execution — but state the chosen semantics as a literal constant `PRESIGN_REQUIRES_DEPLOYMENT_SWITCH`).

## 3. Managed RPC method set and gas/fee/balance policy

Managed endpoint only, no public-diagnostic fallback, 8s timeout per call, sequential-then-parallel like the health probe.

| Method | Purpose | Failure |
|---|---|---|
| `eth_chainId` | pin 4663 | `MANAGED_RPC_CHAIN_MISMATCH` / `..._UNAVAILABLE` |
| `eth_call` (`{from: deployer, data: initCode, value: "0x0"}`, `latest`) | creation would not revert | `CREATION_SIMULATION_REVERTED` |
| `eth_estimateGas` (same tx) | `gas_estimate_text` | `GAS_ESTIMATION_FAILED` |
| `eth_getBlockByNumber("latest", false)` | `baseFeePerGas` | fee model fallback |
| `eth_maxPriorityFeePerGas` | tip | tolerated 0 fallback only in EIP1559 |
| `eth_gasPrice` | LEGACY fee | `FEE_DATA_UNAVAILABLE` |
| `eth_getBalance(deployer, "latest")` | coverage | `BALANCE_UNAVAILABLE` |

Fee model mapping:
- **EIP1559** when `latest.baseFeePerGas` parses: `observed_fee_per_gas = baseFee + priority`; `max_priority_fee_per_gas = priority`; `max_fee_per_gas = baseFee * 2 + priority` (one-doubling headroom, matching the P2 review convention).
- **LEGACY** only when no base fee is present: `observed = max_fee = eth_gasPrice`, priority omitted (A2 rejects it for LEGACY).

Deterministic, cannot-understate policy constants (explicit, named in the module):
- `PRESIGN_GAS_LIMIT_NUMERATOR = 125n`, `PRESIGN_GAS_LIMIT_DENOMINATOR = 100n` → `gas_limit = ceil(gas_estimate * 125 / 100)`. Integer ceiling division; a 25% margin absorbs state drift between quote and send while staying well inside block limits.
- `PRESIGN_BASE_FEE_HEADROOM_MULTIPLIER = 2n` → the doubling above; covers roughly six consecutive maximal base-fee increases.
- `estimated_cost = gas_estimate * observed_fee_per_gas`.
- `max_total_cost = gas_limit * max_fee_per_gas` (exactly the A2 floor, never below).
- Balance gate: refuse unless `balance >= max_total_cost` (strictly stronger than P2's estimated-cost check).
- All arithmetic in `bigint`; serialization via `.toString()`. `Number()` appears nowhere for wei/gas/fee/cost. Provider hex parsed by a strict `^0x(0|[1-9a-f][0-9a-f]*)$` parser; malformed → fail closed, never a guess.

## 4. Security, tenancy, idempotency, freshness

- **Operator identity** is `context.userId` only. `operator_user_id` is not accepted from the browser.
- **Tenancy**: the deployment is read through `context.supabase` so RLS decides visibility; a missing or foreign row returns a generic `Not authorized`. `supabaseAdmin` is only reached afterwards and only to call the service-role-only issue RPC.
- **Payload integrity**: the browser supplies no bytecode, address, supply, gas, fee, or balance. Any mismatch of recomputed `initCodeHash` or `reviewFingerprint` against the stored A1 values is a hard refusal (`INTENT_FINGERPRINT_MISMATCH` / `INIT_CODE_HASH_MISMATCH`).
- **Idempotency**: `clientRequestId` validated as 8..128 chars of `[A-Za-z0-9_-]`. The RPC returns the identical row when every authoritative field matches, and raises `22023` otherwise; the server function maps that to `PRESIGN_REQUEST_CONFLICT` without retry. Because fresh gas/fee reads normally differ between attempts, a genuine retry must reuse the same request id **and** will legitimately conflict if chain conditions moved — that is the intended fail-closed behaviour; a new quote requires a new request id.
- **Freshness**: `ttl_seconds = 60` (`PRESIGN_TTL_SECONDS`, inside A2's 30..300). Expiry is `now()` server-side inside the RPC. The browser P2 quote is advisory display only and is never an input; the authoritative quote is the one derived in this handler. The handler additionally aborts if its own managed reads took longer than `PRESIGN_MAX_QUOTE_BUILD_MS = 15_000`, so a stale quote is never issued with a fresh expiry.
- **Error hygiene**: a fixed union of notice codes only. Never include the endpoint, provider error text, revert data, or DB error detail. All provider failures collapse to `UNREACHABLE | TIMEOUT | RPC_ERROR | MALFORMED_RESPONSE` as in the health module.

## 5. Build allowlist (future authorized turn only)

Allowed to create — exactly one file:
- `src/lib/chain-mainnet-presign.functions.ts`

Must stay untouched: `chain-mainnet-registry.ts`, `chain-mainnet-simulation.ts`, `chain-mainnet-health.functions.ts`, `chain-mainnet-verify.functions.ts`, `cartel-fixed-erc20.artifact.ts`, `chain-launcher.ts`, `chain-simulation.ts`, `chain-registry.ts`, `chain-verify.functions.ts`, all routes and UI, `src/start.ts`, all Supabase integration files, `supabase/migrations/**`, `supabase/config.toml`, `backend-source/**`, `package.json`, lockfiles, `docs/**`.

Prohibited in the build turn: any migration or DB schema change; any DB write other than the A2 issue RPC itself; `eth_sendTransaction`, signing, `wallet_addEthereumChain`, `wallet_switchEthereumChain`, any injected-provider use; tx-hash recording; deployment status transition; liquidity or pool code; kill-switch changes; Telegram; UI wiring; package installs; edge deploy; publish.

## 6. Acceptance tests

Static/no-network:
1. `bunx tsgo --noEmit` and `bun run build` pass.
2. Grep proof: no `eth_sendTransaction`, `personal_sign`, `eth_signTransaction`, `wallet_`, `window.ethereum`, no import of `chain-launcher` or `chain-mainnet-simulation` in the new file.
3. Grep proof: no `Number(` applied to any wei/gas/fee/cost value; `process.env` only inside the handler.
4. Fingerprint parity: a pure unit check that the server pre-image for a fixed intent equals the P2 pre-image byte-for-byte.
5. Ceiling-division and fee-derivation unit checks on bigint fixtures, including `gas_limit >= gas_estimate` and `max_total_cost >= gas_limit * max_fee` (the exact A2 invariants).

Integration, zero-persistence:
6. Reject paths (unauthenticated, foreign deployment, non-DRAFT, testnet chain, missing fingerprint, mismatched init code) must return before any `supabaseAdmin` import — asserted by mocking the dynamic import and proving it is never called.
7. ISSUE RPC integration exercised only inside an explicit transaction with `ROLLBACK`, or against a temporary DRAFT production deployment row that is removed in the same rolled-back transaction. No committed authorization row and no committed production deployment row.
8. Post-test DB proof (must both be 0):
   `select count(*) from public.launch_chain_production_presign_authorizations;`
   `select count(*) from public.launch_chain_deployments where chain_id = 4663 and network_environment = 'PRODUCTION';`
9. Confirm all three switches still `false` and the A2 trigger still attached with EXECUTE revoked.

## 7. Verdict

**GO** for a later, explicitly authorized P3C-B build, scoped to the single file above, with **no migration**. P3C-C/D, UI wiring, and P3D real-money canary remain **NO-GO** and out of scope.
