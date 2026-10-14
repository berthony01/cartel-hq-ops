# PEPE CARTEL / Cartel HQ — G2D Pro 100-request concurrency QA
**REVIEW ONLY — DO NOT RUN without a new, explicit staging DB test approval.**  
Date: 2026-10-14. Existing app only, not a new AI system. Target: `CARTEL HQ STAGING` Supabase project `llicojkxpzwylghptmkf`, never PROD `ocoinbnjgstkmnwwvnhi`.

## Why this is a separate test
The already-approved single-session staging behavioral test ran and rolled back successfully: 99/100 requests allowed, 101 denied, duplicate denied, released hold replaced; all seven rollback assertions passed, separately confirmed. **Do not repeat it.** It was sequential. The missing evidence is whether **two simultaneous DB transactions** racing for the final shared-workspace slot serialize correctly.

The corrected candidate function in draft PR #11 uses `pg_catalog.pg_advisory_xact_lock(4127, 2202)` before reading current reservations and `COUNT(*)` before inserting a hold. Postgres transactions from *different sessions* should therefore serialize. This is source-level reasoning, NOT runtime concurrency proof.

## Important limitation — a single ROLLBACK cannot test two sessions
The prior review-only rollback script's temporary schema/function/entitlement/99 reservations existed only in **one uncommitted transaction**; a second DB connection cannot see them. Do **not** turn the prior rollback test into a purported concurrency test simply by calling the RPC twice inside that same transaction.

To test the real function concurrently, we need a **separately authorized, time-boxed staging fixture setup that is committed long enough for two independent connections to see it**, followed by explicit cleanup and full post-cleanup verification. It is NOT a rollback-only test. If persistent temporary staging writes are not approved, STOP with the existing 9/9 CTE plus sequential behavioral evidence and label concurrency NOT VERIFIED.

## Minimal existing-system plan, requiring explicit approval for execution
Only reuse the isolated staging SQL fixtures and the EXISTING `cartel_guide_reserve_budget(uuid,uuid,uuid)` RPC. **No** new database, extensions, table, edge function, new worker service, CI runner, Lovable message, or Kie.ai request.

### A. Preflight (read-only)
- Verify project ID, current PR #11 head, corrected function source, and stage reservation function MD5 baseline; refuse on drift.
- Confirm staging Guide HTTP provider remains `PROVIDER_NOT_CONFIGURED`, normal config OFF / emergency stop ON, fake quote `test-provider-never-called/offline-test-model`, actual stage Pro Guide entitlement disabled, 2 confirmed synthetic test users, workspace B membership, workspace A unrelated.
- Confirm B has zero reservations and no plan assignment, no other active staging Guide tests, and stage logging/cleanup pathway exists.
- Confirm the DB operator can obtain **two separate connections**, with distinct `pg_backend_pid()`, and intentionally overlap SQL execution. Parallel tool invocation without observed overlap is insufficient.

### B. Separately approved staged fixture setup (write/DDL; NOT AUTHORIZED YET)
- Scope the same six objects as the prior rollback review: Guide budget-controls row and added request-cap column, reservation function, existing Pro Guide entitlement, B's workspace plan assignment and second confirmed test-user membership, and 99 synthetic Guide reservation rows within B. These are temporary **committed** staging writes so independent sessions can see them.
- Do **not** apply G2D's production-shape migration to the simplified stage billing tables. Use only the stage-compatible reviewed function and known fake quote; no credentials or network calls. Cap `customer_workspace_month_requests=100`, temporarily set per-user request cap and fake-spend/global/pending caps high enough that these do not mask the intended final-slot decision.
- The `enabled=true` / `customer_pilot_enabled=true` / `emergency_stop=false` state would be TEMPORARY **staging DB-only** for the reservation function. It is a material risk even though staging Edge currently contains no provider caller. Preauthorize an isolated short maintenance window and a guaranteed stop/cleanup path BEFORE committing setup. Never perform this in production; do not expose or announce the test environment.
- Seed **99 active eligible held** reservations in workspace B, alternated across the two confirmed test users. All must be fake-quote holds and cost-capped; only one additional non-exempt slot may be granted.

### C. Deterministic two-session race
Run two *independent* DB sessions, connection A and connection B, recording backend PIDs and non-secret start/end timestamps. Unique request IDs for each, and two distinct authorized user IDs on the **same B workspace**.

1. Session A: `BEGIN`; acquire the same `pg_advisory_xact_lock(4127,2202)`; hold it briefly (e.g. `pg_sleep(2)`) as a synchronization barrier; then call the actual `cartel_guide_reserve_budget` for request A; `COMMIT`. Never hold the lock on the DB operator's client indefinitely. Use strict session/lock timeouts.
2. While A holds the lock, Session B starts the *same real* `cartel_guide_reserve_budget` for request B from a separate connection. Verify B actually blocks on the advisory lock / waits until A commits, then completes.
3. Expected: A's 100th request returns `allowed=true` and exactly one new held reservation; B's 101st returns `allowed=false, reason=CUSTOMER_BUDGET_LIMIT`; total eligible B reservations = **100**, not 101. Both user identities should be valid and entitled.
4. Repeat with A/B role order swapped, but only if the fixture can first be returned to **99 active holds** safely and without provider dispatch. At most two controlled race attempts, no load testing.
5. Optional narrow duplicate race (same user/workspace/request-id from two connections at 99): one accepted and other `DUPLICATE_REQUEST`, never two rows. It must be explicitly included in the next execution approval; otherwise leave optional.
6. If the tool cannot demonstrate distinct DB sessions or overlapping timestamps/waiting, mark result **INCONCLUSIVE**, not PASS. If unexpected 2 approvals occur, halt immediately and treat as a blocking quota defect.

### D. Mandatory cleanup (must be prepared/reviewed BEFORE any setup)
- Freeze additional test calls; while still stage-only, immediately re-enable `emergency_stop=true` and set `enabled=false`, `customer_pilot_enabled=false` FIRST.
- Remove ONLY the synthetic B reservations/request IDs created by this run; revert temporary member and B Pro assignment; disable only the temporarily enabled Guide entitlement; restore exactly the previous fake spend/user limits and original function and cap-column schema. Do not touch the seven historical reservations or other memberships.
- Verify in a **fresh connection** that the original reserve-function definition/hash `c4c3d33069006ecd021d49497dadee4d`, no G2D cap column, Guide OFF + emergency stop ON, preexisting 7 reservations globally, B reservations 0, B assignment 0, temporary second B member 0, Pro Guide entitlement still disabled, and both original fixed fixture memberships/denials preserved.
- If cleanup fails, STOP, report staging not restored, keep emergency stop ON and escalate for isolated recovery. **No success claim until post-cleanup verification passes.**
- Capture sanitized report: two distinct backend PIDs, start/end/wait proof, redacted request result codes, 100/101 final count, cleanup true/false. Never store passwords, JWTs, or DB connection strings.

## Cost and approval boundary
Estimated **new Kie.ai API costs: $0**, because this exercises database reservations against the stage-only fake quote; not AI calls. No planned Lovable credits or GitHub Actions minutes. Supabase database compute is existing-plan usage, but cannot promise zero incremental DB work or zero operational risk. Committing temporary stage changes, turning the stage reservation flags on, opening two DB connections, and cleanup are **not approved** by authorization to prepare this file.

## Verification status as of preparation
- Previously verified: real signed-in staged Guide Auth/tenant HTTP QA 6/6; corrected source test 27/27; stage read-only quota CTE 9/9; **single-session** 100/101 RPC quota test and 7/7 rollback restoration pass.
- Inspected now: PR #11 still OPEN/DRAFT/UNMERGED, `COUNT(*)` present, advisory xact lock present, stage OFF/emergency stop ON and B clean. No `dblink` or `pg_background` installed; this is not grounds to add an extension.
- **Concurrency runtime: NOT EXECUTED.** No stage DB writes or provider calls during this preparation.

## One next step
Before ANY committed stage setup or concurrent calls, ask the owner for a separate, narrowly scoped approval of the **temporary committed staging-fixture window, two-session race, and mandatory cleanup/recovery**. If not approved, retain honest `NOT VERIFIED` concurrency status.
