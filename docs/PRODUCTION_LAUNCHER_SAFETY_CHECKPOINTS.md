# Production Launcher — Phase Completion Checkpoints

Companion to [PRODUCTION_LAUNCHER_SAFETY_CONTRACT.md](./PRODUCTION_LAUNCHER_SAFETY_CONTRACT.md).
The safety contract in that document remains authoritative; this file preserves the
per-phase completion checkpoints exactly as recorded, split out unchanged so the main
contract document stays within the project file-size rule.

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

## P3C-D4 Bounded Canary Re-Arm + Atomic Auto-Relock Foundation Checkpoint — 2026-09-06

1. Authoritative pre-doc HEAD is `e8348dd72adc81119e013215e52aa6a8bf2b1a79`. Working tree was clean before this documentation edit. Project remains PRIVATE / UNPUBLISHED.
2. D4 migration file `supabase/migrations/20260906213516_bf19314e-ec00-4a3d-b8d8-9ea640162c46.sql` was applied successfully and is the only D4 migration; no later D4 repair migration exists.
3. One new service-role-only arm RPC binds exactly one production DRAFT deployment, one pristine ISSUED presign, the operator, and the expected current control revision. It requires physically stopped control (`execution_enabled=false` and `emergency_stop_engaged=true`), exact immutable bindings across deployment/workspace/launch/operator/chain/environment/deployer/review fingerprint/init-code hash, more than 30 seconds remaining authorization lifetime, no prior permit for the authorization, no prior send-window issuance, and platform-owner plus workspace-operator authority. It performs a compare-and-swap: bumps the singleton to revision+1 with `execution_enabled=true` and `emergency_stop_engaged=false`, appends a control event, and atomically creates one immutable 30-second canary permit bound to that exact authorization and control revision. There is no generic enable/clear-stop RPC and no application or UI arm wrapper.
4. `get_launch_chain_production_execution_state()` now returns effective authority only. A raw ON/stop-cleared state is considered executable only while a current-revision, unexpired, unconsumed canary permit remains bound to an eligible ISSUED or CLAIMED authorization; otherwise it fails closed as OFF/STOP while still preserving raw revision/history fields for audit.
5. Final send-window issuance now inserts the immutable issuance row and then atomically re-locks the singleton to `execution_enabled=false` / `emergency_stop_engaged=true` at revision+1 with reason exactly `AUTO_RELOCK_AFTER_SEND_WINDOW_ISSUANCE`, appending the relock event BEFORE returning. If the relock or event fails, the whole transaction including the issuance rolls back.
6. Every successful explicit emergency-stop call now sets `execution_enabled=false` and `emergency_stop_engaged=true`, bumps the revision exactly once, and appends an event even if the singleton was already stopped, creating a revision-revocation barrier against permits and issuances tied to the prior revision.
7. Latent CLAIMED cancellation remains service-role only with no application wrapper, and now refuses whenever immutable send-window issuance evidence exists for that authorization.
8. The reconciliation snapshot RPC preserves raw control fields and adds a separate `effective_execution_control` field derived read-only from database time, current permit, authorization, and issuance state.
9. Rollback-only live QA was executed inside one deliberately aborted transaction and persisted nothing. Verified: stale revision refusal; authenticated cannot execute the arm RPC; a valid arm creates exactly one permit and one control event at revision+1; the effective execution-state reader reports active while the permit is current; a second arm attempt is refused; claim succeeds through the real authenticated claim RPC with transaction-local `auth.uid` emulation; one send-window issuance plus atomic auto-relock and relock event occur before return; the effective reader reports stopped after issuance; a second issuance is refused; cancellation after issuance is refused; explicit stop from already-stopped bumps revision and appends an event; an expired current-revision permit fixture fails closed in the reader and snapshot; duplicate permit and permit DELETE are refused. Permit expiry was exercised by controlled fixture timestamps, not real elapsed wall time.
10. Post-QA live database returned to exactly 0 production deployments, 0 presign authorizations, 0 canary permits, 0 send-window issuances; runtime `execution_enabled=false` and `emergency_stop_engaged=true` at revision 1 with reason `INITIAL_DEFAULT_OFF`; 1 control event.
11. ACLs: arm, stop, issuance, reconciliation snapshot, cancellation, and the execution-state reader are executable only by `postgres`/`service_role`; the claim RPC remains executable only by `postgres`/`authenticated`.
12. All three hard switches remain literal `false`: `MAINNET_DEPLOYMENT_TX_ENABLED = false as const`, `MAINNET_LIQUIDITY_TX_ENABLED = false as const`, `MAINNET_VERIFICATION_STATE_WRITES_ENABLED = false as const`.
13. This closure run's `bunx tsgo --noEmit` PASS and `bun run build` PASS.
14. No wallet, signer, browser provider, broadcast, raw send, testnet path, secret change, Edge Function deploy, Telegram, liquidity, lifecycle, registry, verifier, presign/reconciliation TypeScript, UI route, package/lockfile, plan file, or publish occurred; no real transaction, signature, ETH, or production data mutation occurred.
15. Next allowed step: ZERO-MONEY REHEARSAL ONLY, with all three switches remaining literal false. Do not start it in this turn.

## P3C Zero-Money Rehearsal Checkpoint — 2026-09-06

1. Starting HEAD `dfda357578bab4cdfbf3e083baa53d999866d531`, working tree clean, project private/unpublished.
2. Start-gate live baseline verified before any test: 0 chain-4663 PRODUCTION deployments, 0 presign authorizations, 0 CLAIMED, 0 CONSUMED, 0 canary permits, 0 send-window issuances; singleton `ROBINHOOD_MAINNET_DEPLOYMENT` `execution_enabled=false`, `emergency_stop_engaged=true`, revision 1, reason `INITIAL_DEFAULT_OFF`; 1 control event; `arm_launch_chain_production_canary_execution` present.
3. Rehearsal A1 (source order): in both `claimMainnetDeploymentHandoff` (`if (PRODUCTION_SEND_ENABLED !== true)` at line 532) and `authorizeMainnetSendWindow` (line 859), the compile-time refusal precedes `readRuntimeExecutionGate` (537 / 864), every `context.supabase` RLS read (541 / 868), every claim or issuance RPC (611 / 985), and the service-role `client.server` import (985 region).
4. Rehearsal A2 (mocked provider): `sendClaimedMainnetDeployment` executed locally against a counting/throwing `window.ethereum.request` mock with a valid-shaped EIP-1559 envelope and a fresh 10-second send window. Exact result `{ ok: false, notice: "PRODUCTION_TX_DISABLED", phase: "PRE_SEND", sendInvoked: false, txHash: null }` with provider request count **0**. No real wallet or provider was used.
5. Rehearsal A3: `chain-mainnet-wallet.ts` contains exactly one `eth_sendTransaction` call site (line 371), textually downstream of the hard gate at line 329; no `eth_sendRawTransaction`, no signing method, and no retry/backoff/rebroadcast loop (the only loops are key-set validation in `hasExactKeys`).
6. Rehearsal B executed entirely inside ONE live transaction that ended in an explicit `ROLLBACK`. No schema, function, grant, policy, or trigger was altered. Fixtures were created through the real production RPCs (`create_launch_chain_production_token_deployment_attempt`, `issue_launch_chain_production_presign_authorization`) with transaction-local `auth.uid()` emulation via `set_config('request.jwt.claim.sub', ..., true)`.
7. B1: arm with a stale expected revision (99) refused with `42501 Stale expected control revision`; control unchanged (false/true, revision 1, `INITIAL_DEFAULT_OFF`), 0 permits, 1 event.
8. B2: one valid authorization-bound arm from the stopped baseline succeeded — control revision 1 → 2 with `execution_enabled=true`/`emergency_stop_engaged=false`, exactly one canary permit at control revision 2 with a 30-second window bounded by the authorization expiry, and exactly one arm event at revision 2.
9. B3: `get_launch_chain_production_execution_state()` reported effective ON / stop-cleared only while that exact current permit and eligible authorization were live.
10. B4 (EXECUTED, not bypassed): the real authenticated `claim_launch_chain_production_presign_authorization` RPC ran under transaction-local `auth.uid()` emulation bound to the authorization's operator; the authorization became `CLAIMED` with a database-time `claimed_at`.
11. B5: `authorize_launch_chain_production_send_window_issuance` produced exactly one issuance row bound to the permit (`canary_permit_id` equal to the single permit id, `control_revision` = armed revision 2, send window = `claimed_at + 10s`) and, in the SAME transaction before returning, physically auto-relocked control to `execution_enabled=false`/`emergency_stop_engaged=true` at revision 3 with reason `AUTO_RELOCK_AFTER_SEND_WINDOW_ISSUANCE` plus exactly one matching relock event.
12. B6: the effective execution reader reported OFF/STOP immediately after issuance while the raw control revision read 3.
13. B7: a duplicate issuance for the same authorization was refused (`42501 Production runtime execution is disabled`). Honest qualification: the refusal came from the post-relock runtime-control gate, which precedes the `23505` duplicate-evidence check inside the same RPC; the dedicated duplicate branch was therefore not the refusing clause in this run.
14. B8: cancellation of the CLAIMED authorization after issuance evidence existed was refused with `42501 Send window already issued; cancellation refused`; the authorization stayed `CLAIMED` with `invalidated_at` NULL.
15. B9: an explicit emergency stop from the already-stopped state incremented the revision exactly once (3 → 4) and appended exactly one event, preserving OFF/STOP.
16. B10: `get_launch_chain_production_reconciliation_snapshot` accurately separated raw from effective control (`raw_execution_enabled=false`, `raw_emergency_stop_engaged=true`, `effective_execution_enabled=false`, `effective_reason=RAW_RUNTIME_STOPPED`, no active permit), classified the deployment `SEND_WINDOW_ISSUED_NO_TX_HASH`, and reported the permit `effective_status=CONSUMED`.
17. B11: the transaction ended in `ROLLBACK`. Nothing was committed.
18. Rehearsal C: an independent post-rollback read returned the EXACT original baseline — 0 production deployments, 0 presign authorizations, 0 CLAIMED/CONSUMED, 0 permits, 0 issuances, control `false`/`true` at revision 1 with reason `INITIAL_DEFAULT_OFF`, 1 control event.
19. `bunx tsgo --noEmit` PASS; `bun run build` PASS; `git status --porcelain` clean before this documentation edit.
20. All three hard switches remain literal `false`: `MAINNET_DEPLOYMENT_TX_ENABLED = false as const`, `MAINNET_LIQUIDITY_TX_ENABLED = false as const`, `MAINNET_VERIFICATION_STATE_WRITES_ENABLED = false as const`.
21. No real wallet or provider connection, signature, `eth_sendTransaction`, `eth_sendRawTransaction`, broadcast, candidate-hash persistence, ETH movement, liquidity action, Telegram action, lifecycle or official-contract registration, verifier state-write activation, migration, DDL, grant, policy, trigger, generated-types edit, source edit, package/lockfile edit, secret/env change, Edge Function deploy, UI edit, cron, or publish occurred. No `REHEARSAL_MODE`, bypass, alternate send path, or reset/reissue capability was created.
22. Unexecuted / inconclusive: permit expiry by elapsed wall-clock time was not exercised (the rollback harness observes a single transaction timestamp); the duplicate-issuance `23505` branch was masked by the earlier relock gate (item 13); no production-path behaviour beyond the rollback harness and the mocked-provider refusal was observed.
23. Next allowed step: READ-ONLY pre-canary hardening audit ONLY — main verifier receipt-error classification and the mainnet official-registration legacy five-confirmation liveness mismatch. Not started in this turn.

## P3C Pre-Canary Hardening A — Receipt Classification Checkpoint — 2026-09-06

1. Start HEAD `a24a7aef9c29d479645e641625efb071568c44d0`, tree clean. Scope: pre-canary finding A only. Finding B (mainnet official-registration legacy five-confirmation liveness mismatch) was NOT touched.
2. Defect: the main production verifier read the receipt via viem `getTransactionReceipt`, which throws for BOTH a genuine not-found receipt and a transport/RPC failure. The single `catch` collapsed both into `RECEIPT_NOT_MINED_RETRYABLE`, asserting "not mined" on evidence that did not prove it.
3. Fix: the receipt is now read with a module-private raw managed `eth_getTransactionReceipt` (the pattern already proven in the D2 reconciliation verifier, duplicated minimally inside the single allowlisted file; the D2 source was not edited).
4. Classifications now implemented:
   - `RECEIPT_NOT_MINED_RETRYABLE` — ONLY on a successful JSON-RPC response whose `result` is `null` (authoritative absence).
   - `RECEIPT_UNAVAILABLE_RETRYABLE` — HTTP/transport/timeout/JSON-RPC-error/non-object payload/missing `result`.
   - `RECEIPT_MALFORMED_RETRYABLE` — successful transport, structurally unusable receipt payload (bad hash, status not `0x0`/`0x1`, bad address/quantity/block hash).
   - PRESENT — continues unchanged through exact tx-hash binding, revert check, created-contract check, block number/hash checks and every downstream evidence, finality and ordering rule.
5. Managed provider remains the only production evidence authority; no public diagnostic fallback was added. The endpoint value and raw provider error text are never returned, logged or serialized; callers receive deterministic non-secret codes only.
6. Provider uncertainty never promotes status, finality, `CONFIRMED` or `FAILED`, and performs no state write. No persisted FAILED path was introduced for receipt uncertainty. Finality authority, confirmations logic, PENDING/FINALIZED/CONFIRMED ordering, early terminal-state handling and state-write lock semantics are unchanged.
7. Validation: `bunx tsgo --noEmit` PASS; `bun run build` PASS. Static branch proof confirmed all four classifications are reachable and distinct; no signer/send/retry/rebroadcast code exists in the file.
8. `MAINNET_DEPLOYMENT_TX_ENABLED`, `MAINNET_LIQUIDITY_TX_ENABLED` and `MAINNET_VERIFICATION_STATE_WRITES_ENABLED` all remain literal `false as const`.
9. No migration, schema, generated-types, package/lockfile, registry, wallet, handoff, reconciliation, UI, testnet, Edge Function or secret change. No Supabase data write, no runtime control mutation, no official registration, no liquidity, no Telegram, no transaction, no publish/deploy. Project remains private/unpublished.
10. Diff from start HEAD before this append contained exactly `src/lib/chain-mainnet-verify.functions.ts`.
11. STOP point: finding B is NOT started and requires separate explicit authorization.

## Hardening B — Production Registration Managed-Finality Completion Checkpoint — 2026-09-07

1. Client/server correction complete: production official-contract registration no longer applies a separate fixed five-confirmation depth gate. Managed FINALIZED evidence is authoritative; the confirmations column remains stored and diagnostic only.
2. Testnet semantics unchanged: the fixed five-confirmation rule (`REQUIRED_CONFIRMATIONS` / `EVIDENCE_REQUIRED_CONFIRMATIONS`) continues to apply to Robinhood Chain Testnet.
3. QA fixture corrected: regression case H now uses `ROBINHOOD_TESTNET_CHAIN_ID` (46630) instead of a hardcoded incompatible chain id, so it genuinely proves the testnet confirmation check FAILs at 4 confirmations while official production registration stays false.
4. Validation: `bun run scripts/hardening-b-regression.ts` cases A–H PASS; `bunx tsgo --noEmit` PASS; `bun run build` PASS.
5. Live migration applied externally through the Supabase migration API to project `ocoinbnjgstkmnwwvnhi`: version `20260907045317`, name `hardening_b_production_registration_managed_finality`. Repository parity copy stored at `supabase/migrations/20260907045317_hardening_b_production_registration_managed_finality.sql`; no migration was applied or re-applied from Lovable.
6. Live post-apply audit: the fixed five-confirmation branch and its message are ABSENT from `public.assert_launch_contract_evidence`; every managed-finality predicate is retained (FINALIZED state, MANAGED provider kind, confirmed finalized block hash, `finalized_at`, finalized block number equal to the deployment block, finalized head at or beyond the deployment block); function remains SECURITY DEFINER with pinned `search_path`; EXECUTE granted to `authenticated` only (anon false, PUBLIC false).
7. Runtime safety state unchanged and physically stopped: `ROBINHOOD_MAINNET_DEPLOYMENT` `execution_enabled=false`, `emergency_stop_engaged=true`, `revision=1`, reason `INITIAL_DEFAULT_OFF`.
8. `MAINNET_DEPLOYMENT_TX_ENABLED`, `MAINNET_LIQUIDITY_TX_ENABLED` and `MAINNET_VERIFICATION_STATE_WRITES_ENABLED` all remain literal `false as const`.
9. Post-apply counts remain zero: open production presign authorizations, send-window issuances, unexpired canary permits, production deployments with a tx hash, confirmed production deployments, contract-registration events, and launches with an official contract.
10. No real-value action occurred: no transaction, signing, broadcast, presign/canary/send-window issuance, verifier state write, official contract registration, liquidity action, secret/env change, Telegram message, or publish/deploy. CARTEL HQ remains private and unpublished.
11. STOP point: Hardening B is closed. Any canary or execution-arming step requires separate explicit authorization.

## P3C-E — Verifier State-Write Activation Checkpoint — 2026-09-07

1. Activation: the authoritative verifier state-write gate `MAINNET_VERIFICATION_STATE_WRITES_ENABLED` is now literal `true as const`, relocated verbatim into `src/lib/chain-mainnet-verify-apply.ts`. Production verifier database evidence and managed-finality writes are ENABLED.
2. Scope: this gate authorizes DATABASE writes only. It grants nothing to transaction execution. `MAINNET_DEPLOYMENT_TX_ENABLED` and `MAINNET_LIQUIDITY_TX_ENABLED` remain literal `false as const`, and the Supabase runtime execution control remains physically stopped (`execution_enabled=false`, `emergency_stop_engaged=true`, `revision=1`, reason `INITIAL_DEFAULT_OFF`).
3. Fail-closed preserved: each apply helper still calls `assertStateWritesEnabled()` before any dynamic service-role import. Setting the gate back to false refuses every write before the admin client is loaded.
4. Invocation-bound: importing the verifier performs zero I/O and zero writes. Writes occur only inside the authenticated `verifyMainnetChainDeployment` handler after its existing independent evidence validation. No UI caller was added; the server function still has no caller.
5. Truthful API: `MainnetVerifyResult.stateWritesEnabled` is now `boolean` and `baseResult()` reports the actual gate state instead of a hardcoded `false`.
6. Oversized-file requirement: `chain-mainnet-verify.functions.ts` reduced 901 -> 588 LOC by verbatim extraction into `chain-mainnet-verify-apply.ts` (161), `chain-mainnet-verify-receipt.ts` (136) and `chain-mainnet-verify-shape.ts` (85). Behavior, evidence predicates, receipt classification, finality semantics, confirmation semantics, PENDING/FINALIZED/CONFIRMED ordering, retryable error codes and RPC names are unchanged.
7. Validation: `bun run scripts/verifier-state-write-activation-regression.ts` A–G ALL CHECKS PASSED; `bun run scripts/hardening-b-regression.ts` PASS; `bunx tsgo --noEmit` PASS; `bun run build` PASS.
8. No production data write occurred: zero production deployments exist and the verifier was not invoked in this checkpoint.
9. No migration, schema, RPC, grant, policy, generated-types, secret/env, package or Edge Function change. No wallet action, signing, broadcast, transaction, ETH movement, presign/canary/send-window issuance, official contract registration, liquidity action, Telegram message, or publish/deploy. CARTEL HQ remains private and unpublished.
10. STOP point: canary and production execution arming remain unauthorized and require a separate explicit checkpoint.

## P3C-F — Canary Activation PREPARATION Checkpoint (capability only) — 2026-09-07

1. Capability flip: `MAINNET_DEPLOYMENT_TX_ENABLED` is now literal `true as const` (`src/lib/chain-mainnet-registry.ts`). This is a COMPILE-TIME capability only. It authorizes nothing by itself.
2. Remaining authoritative stops are untouched and still deny execution: Supabase runtime execution control `ROBINHOOD_MAINNET_DEPLOYMENT` (`execution_enabled=false`, `emergency_stop_engaged=true`, `revision=1`, reason `INITIAL_DEFAULT_OFF`), the canary permit requirement, the presign authorization + claim, and the short-lived send-window issuance.
3. Liquidity remains fully disabled: `MAINNET_LIQUIDITY_TX_ENABLED` and testnet `LIQUIDITY_TX_ENABLED` are literal `false as const`.
4. Simulation corrected (`src/lib/chain-mainnet-simulation.ts`): the impossible `deploymentKillSwitchOff` comparison is removed; `simulationPassed` no longer depends on the deployment switch; the result now reports `deploymentTxCapabilityEnabled: boolean`; `deploymentAuthorized` stays literal `false`; `authorizationBlockedBy` is now `"RUNTIME_EXECUTION_CONTROL_AND_SEND_WINDOW"`. Simulation still contains no signing or send path.
5. New owner-only wrappers (`src/lib/chain-mainnet-canary.functions.ts`): `readCanaryExecutionState`, `createCanaryDeploymentAttempt`, `armCanaryExecution`, `engageCanaryEmergencyStop`. Each is behind `requireSupabaseAuth`, re-checks `is_platform_owner` server-side and fails closed, and calls exactly one authoritative RPC. Arm requires the exact deployment, exact authorization, an expected control revision and an operator reason. There is no re-arm, reset, enable or stop-clearing path. Emergency stop is one-way.
6. New owner-only surface `/mainnet-canary` (`src/routes/_authenticated/mainnet-canary.tsx`): linear stages A–G, no effect-driven or timer-driven invocation, no auto-advance, no retry, no rebroadcast, no batch mode, no liquidity and no registration action. Claim/arm require the typed phrase `ARM MAINNET CANARY`; the single send requires the typed phrase `SEND ONE MAINNET DEPLOYMENT` AND a valid server-issued send window. `EMERGENCY STOP` is visible whenever an attempt or authorization exists. Owner-only nav entry added in `src/lib/nav.ts`.
7. Validation: `bun run scripts/p3c-f-canary-activation-regression.ts` ALL CHECKS PASSED (capability/liquidity/verifier pins, simulation semantics, single-send-site and no-retry proof, runtime-gate retention in claim and send window, arm binding and absence of re-arm/reset, one-way stop, four server-side owner checks, no liquidity/registration/Telegram/service-role/env path added, no render-triggered action, exact confirmation phrases). `bun run scripts/verifier-state-write-activation-regression.ts` re-pinned to deployment-capability true, ALL CHECKS PASSED. `bun run scripts/hardening-b-regression.ts` A–H PASS. `bunx tsgo --noEmit` PASS. `bun run build` PASS.
8. No real-value action occurred in this checkpoint: no wallet connection, signing, broadcast, transaction, ETH movement, production deployment/presign/canary/send-window row, verifier write, official contract registration, liquidity action, Telegram message, secret/env change, migration, schema/RPC/grant/policy/generated-types change, or publish/deploy. CARTEL HQ remains private and unpublished.
9. STOP point: executing a real mainnet canary requires deliberately arming the runtime execution control and issuing a canary permit, plus a funded deployer wallet. That is a separate explicitly authorized checkpoint.

## P3C-F2 — PEPECARTEL Launch Chain Metadata Reconciliation (PREPARED, NOT APPLIED) — 2026-09-07

1. Defect: `public.launches.chain` for `public_slug='pepecartel-launch'` still records the historical `'Solana'`, while the linked `project_profiles.primary_chain` already records `'Robinhood Chain'`. The P3C-F1 chain guard therefore fails closed on the real production launch. The launch row is the stale side of the pair.
2. Artifact: `docs/sql/20260907062000_reconcile_pepecartel_launch_chain_to_robinhood.sql`. It is STAGED ONLY. It was NOT applied, and no file was written to `supabase/migrations/`. Applying it is a separate, explicitly authorized action; the file header records the exact intended migration filename.
3. Shape: one `DO` block. `LOCK TABLE public.launches IN ACCESS EXCLUSIVE MODE` is taken BEFORE any trigger state changes, so no concurrent session can write a launch while the identity lock is off.
4. Preconditions (all fail closed with `RAISE EXCEPTION`): exactly one row for the stable slug; `token_name='PEPECARTEL'`; `ticker='$PCART'`; `chain='Solana'`; `status='WATCHLIST_OPEN'`; no official contract address or deployment; linked profile `primary_chain='Robinhood Chain'`; zero PRODUCTION `launch_chain_deployments`; `ROBINHOOD_MAINNET_DEPLOYMENT` control present with `execution_enabled=false` and `emergency_stop_engaged=true`; zero open PRODUCTION presign authorizations; zero unexpired PRODUCTION canary permits; zero PRODUCTION send-window issuances; zero contract registration events. No UUID is hardcoded.
5. Identity lock: the trigger is resolved dynamically from `pg_trigger` by `tgrelid = public.launches` + `NOT tgisinternal` + `tgfoid = public.enforce_launch_update_rules::regproc`, its name is asserted to be `enforce_launch_update_rules_trigger` and its state asserted to be `'O'`. Exactly one named trigger is disabled and re-enabled. `DISABLE TRIGGER ALL/USER` is never used, and the status, schedule and contract triggers are never touched. The trigger definition is not dropped, recreated or altered.
6. Repair: a single `UPDATE public.launches SET chain = 'Robinhood Chain' WHERE public_slug = 'pepecartel-launch' AND chain = 'Solana'`, requiring `ROW_COUNT = 1`. No INSERT, DELETE or TRUNCATE exists in the artifact.
7. Postconditions: exactly one row now records `'Robinhood Chain'`; a field-by-field comparison proves id, slug, token_name, ticker, status, workspace, profile, creator, schedule, watch token and all contract fields are unchanged; the identity-lock trigger is back at `tgenabled='O'`. Any failure rolls back the entire transaction, including the temporary trigger state.
8. No reverse migration is provided by design: silently restoring `'Solana'` would reintroduce the defect.
9. Validation: `bun run scripts/p3c-f2-launch-chain-reconciliation-regression.ts` — source-level only, no DB connection, no SQL executed — ALL CHECKS PASSED (staging, lock-before-bypass ordering, all fourteen preconditions, exact single-trigger handling, single narrow UPDATE, absence of function/policy/grant/schema/reverse-migration surface, absence of any arm/presign/send-window/registration/emergency-stop/Telegram/pg_notify/http path, and all postconditions). `p3c-f1`, `p3c-f`, verifier and Hardening B suites all re-run and PASS.
10. No production data was read or written by this checkpoint, and no live database query was issued. No migration applied, no schema/RPC/grant/policy/generated-types change, no secret/env change, no wallet action, signing, broadcast, transaction, liquidity action, Telegram message, or publish. CARTEL HQ remains private and unpublished.
11. STOP point: applying the reconciliation is the next explicitly authorized action.
