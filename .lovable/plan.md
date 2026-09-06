# P3C-A2 — Read-Only Audit + Design: Pre-Sign Authorization Evidence

Audit only. No file created or edited except this plan. No migration applied, no secret change, no publish, no Telegram, no signing, no broadcast. All database access was SELECT / catalog reads.

## 1. Start gate

- HEAD `711b078710bd60163e42ea9f59d87785998f3136` ("Closed P3C-A1 via doc sync"); `git status --porcelain` empty (clean tree).
- Recent commits: `36cf2c0`, `bfc06a6` (generated types sync), `419a359` (P3C-A1 migration), `2f79de1`, `5657bd0` (P3B checkpoint).
- P3C-A2 does not already exist under any name: no migration file matching a pre-sign/authorization slice (latest migration is `20260906133800_p3c_a1_production_token_attempt_intent.sql`), and the live database has **no** table whose name matches `%author%`, `%presign%`, `%pre_sign%`, `%claim%`, or `%nonce%`. Only `docs/PRODUCTION_LAUNCHER_SAFETY_CONTRACT.md` and the A1 migration mention P3C.
- Project state: `is_published: false` (private/unpublished).
- Kill switches, literal values confirmed in source:
  - `src/lib/chain-mainnet-registry.ts:57` `MAINNET_DEPLOYMENT_TX_ENABLED = false as const`
  - `src/lib/chain-mainnet-registry.ts:58` `MAINNET_LIQUIDITY_TX_ENABLED = false as const`
  - `src/lib/chain-mainnet-verify.functions.ts:47` `MAINNET_VERIFICATION_STATE_WRITES_ENABLED = false as const`

## 2. Current state relevant to A2

`public.launch_chain_deployments` (47 columns) now carries production intent binding: `review_fingerprint`, `init_code_hash` (both nullable, `^0x[0-9a-f]{64}$` CHECK, and both required for `chain_id = 4663 AND network_environment = 'PRODUCTION' AND deployment_kind = 'FIXED_SUPPLY_ERC20'`).

Triggers on that table:

| Trigger | Function | Effect |
|---|---|---|
| `launch_chain_deployments_tenant` (BEFORE INSERT) | `enforce_launch_chain_deployment_tenant` | launch/workspace must agree |
| `launch_chain_deployments_update` (BEFORE UPDATE) | `enforce_launch_chain_deployment_update` | identity immutable, `tx_hash` immutable once set, terminal rows frozen, status machine `DRAFT→SUBMITTED/ABANDONED`, `SUBMITTED→PENDING/CONFIRMED/FAILED`, `PENDING→CONFIRMED/FAILED` |
| `trg_launch_chain_token_intent_immutable` (BEFORE UPDATE) | `enforce_launch_chain_token_intent_immutable` | kind/artifact/name/symbol/decimals/supply/recipient plus the two A1 fields immutable |
| `launch_chain_deployments_set_updated_at` | `set_updated_at` | timestamp |

Authorization primitive: `authorize_launch_chain_deployment(_launch_id)` — `SECURITY DEFINER`, requires `auth.uid()`, `is_platform_owner`, and `is_workspace_operator(workspace)`, returns the workspace id. `can_read_launch_chain_deployment` mirrors it for reads. `abandon_launch_chain_deployment_attempt` is the DRAFT-only cancel path.

Reusable patterns already in the repo/DB:
- Idempotency: `(launch_id, client_request_id)` pre-read + unique-violation re-read with a full-field conflict raise (`22023`) — exactly the shape A1 uses.
- Atomic claim with expiry: `claim_launch_notification_deliveries`, `claim_project_inbox_deliveries`, `claim_telegram_message_cleanup_jobs` all use `FOR UPDATE SKIP LOCKED` + stale reclaim windows. A2 should reuse the `SELECT … FOR UPDATE` + single-row conditional `UPDATE … WHERE status = <expected>` claim discipline (not `SKIP LOCKED`, since A2 claims one specific row).
- Client-side quote model: `src/lib/chain-mainnet-simulation.ts` already produces the exact evidence A2 must bind — `MAINNET_SIMULATION_FINGERPRINT_DOMAIN` (`cartel-mainnet-sim-v1`), the deterministic `mainnetFingerprintPreimage` (domain, environment, chainId, artifactId, runtimeBytecodeHash, deployer, recipient, name, symbol, decimals, supplyWhole, totalSupplyBaseUnits, initCodeHash, txValueWei), `initCodeHash`, and a `MainnetPreflightResult` carrying `gasEstimate`, `feeWeiPerGas`, `feeSource`, `estimatedCostWei`, `balanceWei`, `quotedAtMs`, with `MAINNET_SIMULATION_QUOTE_TTL_MS = 60_000` and a hard `deploymentAuthorized: false`.
- P3B verifier (`src/lib/chain-mainnet-verify.functions.ts`) is read-only, managed-RPC-only, finality-tag-only, and its state writes are locked off. A2 must not touch it.

## 3. What A2 is (design)

A **pre-sign authorization record**: short-lived, single-use, replay-resistant evidence that a specific production deployment attempt was reviewed under a specific fee/gas envelope and is cleared to be handed to a wallet. It authorizes nothing else — no signing helper, no broadcast helper, no `tx_hash` write, no status change beyond its own lifecycle.

### 3.1 Smallest safe shape — one new table

`public.launch_chain_production_presign_authorizations`

Binding columns (all NOT NULL unless stated):
- `id uuid pk default gen_random_uuid()`
- `deployment_id uuid` → `launch_chain_deployments(id) ON DELETE CASCADE`, **unique when active** (see index below)
- `workspace_id uuid`, `launch_id uuid` (denormalized, trigger-verified against the deployment row)
- `chain_id bigint CHECK (chain_id = 4663)`, `network_environment text CHECK (= 'PRODUCTION')`
- `deployer_address text` (`^0x[0-9a-f]{40}$`, non-zero)
- `operator_user_id uuid` (the `auth.uid()` that minted it)
- `review_fingerprint text`, `init_code_hash text` (both `^0x[0-9a-f]{64}$`)
- Fee envelope evidence, exact decimal strings validated by `^[0-9]{1,78}$` (never numeric/float): `gas_estimate_text`, `fee_wei_per_gas_text`, `estimated_cost_wei_text`, `max_fee_wei_per_gas_text` (ceiling the operator accepts), `max_total_cost_wei_text`, plus `fee_source text CHECK (fee_source IN ('eth_gasPrice','baseFee+priority'))`
- `tx_value_wei text NOT NULL DEFAULT '0' CHECK (tx_value_wei = '0')`
- `issued_at timestamptz NOT NULL DEFAULT now()`, `expires_at timestamptz NOT NULL`
- `status text NOT NULL DEFAULT 'ISSUED'` with `CHECK (status IN ('ISSUED','CONSUMED','INVALIDATED','EXPIRED'))`
- `claimed_at`, `consumed_at`, `invalidated_at` (nullable timestamptz), `invalidated_reason text`
- `client_request_id text` (8–128 chars) for mint idempotency
- `created_at`, `updated_at`

Indexes / constraints:
- `UNIQUE (deployment_id, client_request_id)` — idempotent mint.
- Partial unique `ON (deployment_id) WHERE status = 'ISSUED'` — **at most one live authorization per deployment attempt**; this is the core replay/duplicate guard.
- `CHECK (expires_at > issued_at)` and a TTL ceiling check `CHECK (expires_at <= issued_at + interval '10 minutes')`.
- Terminal-consistency CHECKs: `status='CONSUMED'` requires `consumed_at NOT NULL`; `status='INVALIDATED'` requires `invalidated_at NOT NULL`.

RLS: **enabled, zero policies**, grants to `service_role` only plus the read path exposed exclusively through an RPC (mirroring `telegram_group_announcements`). The browser never reads or writes the table directly, so it can never mint or resurrect its own authorization.

### 3.2 Trigger requirements

`enforce_launch_chain_production_presign()`:
- BEFORE INSERT: resolve the deployment row `FOR SHARE`; require `chain_id=4663`, `network_environment='PRODUCTION'`, `deployment_kind='FIXED_SUPPLY_ERC20'`, `status='DRAFT'`, `tx_hash IS NULL`; require `workspace_id`/`launch_id`/`deployer_address`/`review_fingerprint`/`init_code_hash` to equal the deployment row's values exactly (case-normalized). Any mismatch → `42501`.
- BEFORE UPDATE: every binding column immutable (`deployment_id`, workspace/launch, chain, environment, deployer, operator, both hashes, every fee-envelope column, `issued_at`, `expires_at`, `client_request_id`). Only `status`, `claimed_at`, `consumed_at`, `invalidated_at`, `invalidated_reason`, `updated_at` may change. Status machine: `ISSUED → CONSUMED | INVALIDATED | EXPIRED`; terminal states frozen; no transition back to `ISSUED`.

### 3.3 RPC boundary

All `SECURITY DEFINER`, `SET search_path = public`, all reusing `authorize_launch_chain_deployment(launch_id)` for the owner/operator gate.

1. `issue_launch_chain_production_presign_authorization(_deployment_id, _client_request_id, _gas_estimate_text, _fee_wei_per_gas_text, _fee_source, _estimated_cost_wei_text, _max_fee_wei_per_gas_text, _max_total_cost_wei_text, _ttl_seconds)` → row. Locks the deployment `FOR UPDATE`; fails closed on non-DRAFT, non-production, foreign workspace, missing intent fields, malformed decimals, `_ttl_seconds` outside 30–600, or `max_* < estimate` inconsistency. Expires any stale `ISSUED` row for the same deployment first (`expires_at <= now()` → `EXPIRED`). Idempotency: pre-read on `(deployment_id, client_request_id)` and unique-violation re-read, with a full-field conflict raise `22023` — same discipline as A1. Server sets `issued_at = now()` and `expires_at = now() + ttl`; the client can never supply them.
2. `consume_launch_chain_production_presign_authorization(_authorization_id, _expected_review_fingerprint, _expected_init_code_hash)` → row. Single atomic `UPDATE … WHERE id = $1 AND status = 'ISSUED' AND expires_at > now()` after `SELECT … FOR UPDATE`; re-verifies the two hashes against both the authorization and the live deployment row and refuses on any drift. Zero rows updated → `42501` (already consumed / expired / invalidated). This is the single-use gate; **A2 stops here — consumption records intent to hand off, it does not sign, assemble, or broadcast anything.**
3. `invalidate_launch_chain_production_presign_authorization(_authorization_id, _reason)` → row. `ISSUED → INVALIDATED`, idempotent when already `INVALIDATED`, refuses on `CONSUMED`.
4. `get_launch_chain_production_presign_authorization(_deployment_id)` → read-only current state for the UI (never returns anything the browser could replay; there is no token/secret in the record — the record *is* the state).

Privileges: `REVOKE ALL … FROM PUBLIC, anon`; `GRANT EXECUTE … TO authenticated` only, exactly as A1.

### 3.4 State machine

```text
                (issue RPC, owner+operator, DRAFT prod attempt)
                          |
                        ISSUED --- expires_at <= now() ---> EXPIRED
                          |  \
        (consume RPC,     |   \  (invalidate RPC / intent drift / abandon)
         hash re-match)   |    \
                          v     v
                      CONSUMED  INVALIDATED     [all three terminal]
```

Replay behavior: one `ISSUED` row per deployment (partial unique index) + `WHERE status='ISSUED' AND expires_at > now()` in the consume update + terminal freeze in the trigger. A repeated consume of the same id fails closed; a repeated issue with the same `client_request_id` returns the identical row; a repeated issue with a *different* request id while one is live is refused by the partial unique index.

### 3.5 Rollback-safe tests (all inside a rolled-back transaction, no chain calls)

1. Non-owner / non-operator caller → `42501`, no row.
2. Deployment in another workspace → `42501`.
3. Testnet (chain 46630) deployment → refused.
4. Deployment `status <> 'DRAFT'` or `tx_hash NOT NULL` → refused.
5. Deployment missing `review_fingerprint`/`init_code_hash` → refused (cannot occur for production rows given the A1 CHECK; asserted anyway).
6. Malformed decimals (`1.5`, `-1`, `0x…`, empty) in any fee field → refused.
7. `_ttl_seconds` = 0 / 29 / 601 → refused; 300 → `expires_at = issued_at + 300s`.
8. Same `client_request_id` twice → identical row, exactly one row in the table.
9. Different `client_request_id` while one `ISSUED` exists → partial-unique refusal.
10. Consume with correct hashes → `CONSUMED`; second consume → `42501`.
11. Consume after `expires_at` (simulated by direct service-role backdating in-transaction) → `42501`.
12. Consume with mismatched `_expected_init_code_hash` → `42501`.
13. Invalidate `ISSUED` → `INVALIDATED`; invalidate again → idempotent; invalidate a `CONSUMED` row → refused.
14. Direct `UPDATE` of any binding column as service role → `42501` from the trigger.
15. `anon`/`authenticated` direct `SELECT`/`INSERT` on the table → permission denied (RLS + no grants).
16. Post-suite invariants: table empty, `launch_chain_deployments` row counts and all `MAINNET_*` switches unchanged.

## 4. Conflicts / weakening risks flagged

1. **`enforce_launch_chain_deployment_update` terminal freeze.** A consumed authorization must never be modelled as a deployment-row column, because the deployment row's own update trigger already governs `DRAFT→SUBMITTED`. Keeping A2 in a separate table avoids widening that trigger. Do **not** add authorization columns to `launch_chain_deployments`.
2. **`abandon_launch_chain_deployment_attempt`** sets `DRAFT → ABANDONED` without knowing about authorizations, leaving a dangling `ISSUED` row. A2 must either extend that RPC (scope decision) or — preferred, smaller — make the consume path re-check the live deployment `status = 'DRAFT'`, so an abandoned attempt can never be consumed. Recommendation: consume-side re-check only; leave the existing RPC untouched.
3. **`ON DELETE CASCADE`** on `deployment_id` is correct only because deployment rows are never deleted in practice; a delete would silently erase authorization history. Alternative `ON DELETE RESTRICT` preserves evidence. Decision required; `RESTRICT` is the fail-closed default.
4. **Clock trust.** `expires_at` must be derived server-side from `now()`; accepting a client timestamp would make the TTL forgeable. No client-supplied `issued_at`/`expires_at` parameter exists in the design above.
5. **No expiry sweeper exists.** Nothing lazily flips `ISSUED → EXPIRED`; the design relies on the `expires_at > now()` predicate at consume time plus opportunistic expiry inside the issue RPC. A cron sweeper is explicitly **not** part of A2.
6. **Fee-envelope numeric type.** Storing wei as `numeric` risks silent precision/format drift; the design stores exact decimal `text` with regex CHECKs, matching the existing `*_text` column convention already on `launch_chain_deployments`.
7. **`MAINNET_SIMULATION_QUOTE_TTL_MS` is 60 s** in the simulation module while the proposed authorization TTL range is 30–600 s. These must be reconciled at build time or the UI can present a stale quote inside a still-valid authorization. Recommendation: default the authorization TTL to 60 s to match, cap at 300 s.
8. **Kill switches remain false.** Nothing in A2 reads or flips them; the authorization record is meaningless until a later slice (A3+) exists, and that slice remains gated by `MAINNET_DEPLOYMENT_TX_ENABLED`.

## 5. Proposed build allowlist for P3C-A2 (not executed)

**Create:** exactly one migration under `supabase/migrations/` — one table, its constraints/indexes, one trigger function + trigger, four RPCs, RLS enable with zero policies, grants (`service_role` on the table; `EXECUTE` to `authenticated` on the RPCs only).
**Modify:** nothing.
**Prohibited:** any TypeScript file, any UI/route, any Edge Function, any change to `launch_chain_deployments` columns or its existing triggers, `abandon_launch_chain_deployment_attempt`, the P3B verifier, the kill switches, secrets, packages, publish, Telegram, wallet, signing, broadcast, liquidity, Permit2/Uniswap.

## 6. Verdict

**P3C-A2 READY TO BUILD** as a single repository migration (not applied), pending two decisions: (a) `ON DELETE RESTRICT` vs `CASCADE` on `deployment_id`; (b) default/max authorization TTL (recommended 60 s default, 300 s max, to match the existing simulation quote TTL).

No file was created or edited other than this plan; no migration, secret, deployment, message, transaction, or publish action occurred.
