# Launcher-B — Production Deployment Handoff (audit + surgical build plan)

## Start gate (read-only, verified this turn)

- `git rev-parse HEAD` = `e8bb7f1477a45fcaeff7db64461f833f34279716`
- `git status --short` = empty (clean tree)
- No files created or edited; no migration, Supabase, secret, Edge Function, cron, wallet, Telegram or publish action taken.

## What the audit found

**The dead-end is real and is a missing state, not a missing button.**
`src/lib/project-journey.ts` stage `deployment` is deliberately non-actionable for ordinary owners: it only reports evidence counts (`verifiedProductionCount`, `managedFinalizedVerifiedCount`, ambiguity) derived from `list_launch_chain_deployments` and `evaluateLaunchDeploymentEvidence`. Stage `registration` unlocks only when exactly one eligible, unambiguous production deployment exists. So a PROJECT launch on Robinhood Chain can reach "Launch Watch open" and then has nothing to do and nothing to ask for.

**Execution authority already exists and is hardened.**
`src/lib/chain-mainnet-canary.functions.ts` re-checks `is_platform_owner` server-side in every wrapper and calls exactly one authoritative RPC each (`create_launch_chain_production_token_deployment_attempt`, arm, emergency stop, read control/attempt). `chain-mainnet-handoff.functions.ts` owns claim / send-window / persist with database-authoritative permits, control revision and one-time issuance. None of this should be touched.

**Owner tooling cannot currently see another workspace's launch.**
`src/routes/_authenticated/mainnet-canary.tsx` builds its launch list from `listLaunches(workspaceId, profileId)` for the operator's own active workspace. A customer handoff queue therefore needs an owner-only, cross-workspace read. Whether the existing production attempt RPC itself permits a platform owner to create an attempt against a launch in a workspace they are not a member of is **not determinable from the repo** (RPC bodies are not in this codebase) and must be verified read-only before the build.

**Launch kind isolation already exists** (`toLaunchKind`, `isProjectLaunch` in `src/lib/launch-control.ts`), so INTERNAL_TEST exclusion reuses existing helpers.

## Product behavior to build

1. Owner of a PROJECT launch on Robinhood Chain, past the eligibility bar, sees a single explicit action: **Request production deployment**.
2. Submitting records exactly one request row. It performs no chain, wallet, Telegram, lifecycle or registration action of any kind.
3. The launch surface then shows truthful status: `REQUESTED` → `IN_REVIEW` → `SCHEDULED` → `EXECUTING` → `COMPLETED` / `DECLINED` / `WITHDRAWN`, plus "what happens next" copy that promises no timeline.
4. Platform owner sees the queue in owner-only tooling, opens the exact launch, and runs the existing canary pipeline unchanged.
5. **Completion is derived, never asserted:** the request resolves to `COMPLETED` from verified production deployment evidence for that launch (same predicate the journey already uses). Registration then unlocks through the existing evidence-bound flow.

## Eligibility, idempotency, isolation

- Eligible only when: launch kind is `PROJECT`; `chain` matches Robinhood Chain via the existing `isRobinhoodChainLaunchMetadata`; project profile is published; launch is at/after `WATCHLIST_OPEN` and before `LIVE`; no official contract registered; no qualifying verified production evidence already exists.
- Idempotent: unique partial index allows at most one open request per launch. Re-submitting returns the existing row.
- Owner may **withdraw** only while `REQUESTED` or `IN_REVIEW`. Withdrawal is a status change, never a delete, and can never touch an executing or completed request.
- Isolation: request rows carry `workspace_id` + `launch_id`; RLS scopes owner reads/writes to their own workspace; INTERNAL_TEST launches are rejected server-side, not just hidden.

## Minimum backend (one migration, staged for your approval — not applied in this turn)

- Table `public.launch_production_deployment_requests`: `id`, `workspace_id`, `launch_id`, `project_profile_id`, `status`, `requested_by`, `requested_at`, `decided_by`, `decided_at`, `decision_note`, `resolved_deployment_id`, `created_at`, `updated_at`, plus updated-at trigger.
- GRANTs to `authenticated` and `service_role`; RLS enabled; workspace-owner read/insert policies, platform-owner read/update policy via existing `is_platform_owner`.
- Unique partial index on `launch_id` where status is open.
- `submit_launch_production_deployment_request(_launch_id)` — SECURITY DEFINER, re-derives every eligibility rule server-side, idempotent, returns the row.
- `withdraw_launch_production_deployment_request(_request_id)` — owner-only, open statuses only.
- `list_launch_production_deployment_requests()` — platform-owner-only cross-workspace queue read.
- `set_launch_production_deployment_request_status(_request_id, _status, _note)` — platform-owner-only, forward-only transitions, cannot fabricate `COMPLETED`.
- Completion derivation: `COMPLETED` is set only from verified production evidence for that launch (trigger on the deployment verification path, or derived at read time — the safer of the two is chosen after inspecting the existing verification apply path read-only).

No change to any existing RPC, permit, control, presign, send-window, registration, lifecycle or notification object.

## Frontend allowlist

1. `src/lib/launch-production-request.ts` (new) — typed client wrappers + status vocabulary.
2. `src/lib/project-journey.ts` — the `deployment` stage becomes actionable **only** when a request may be submitted; otherwise it reports request status truthfully. No new authority.
3. `src/routes/_authenticated/launch-control.tsx` — request panel in the contract/evidence section.
4. `src/components/cartel/ProjectJourney.tsx` — row CTA + status wording.
5. `src/routes/_authenticated/mainnet-canary.tsx` — owner-only queue list that selects a launch into the existing flow. No change to any canary call, gate or confirmation.

## Prohibited in this build

Deploying, signing, broadcasting, arming, claiming, issuing send windows, persisting hashes, registering or correcting contracts, lifecycle transitions, Telegram sends, liquidity, runtime flag changes, secret changes, Edge Function deploys, publishing, weakening `is_platform_owner` or any existing RLS, editing `launch-verified-eligibility.ts`, `launch-production-finality.ts`, `chain-mainnet-*` execution modules, or any historical row.

## Verification

- New `scripts/launcher-b-handoff-regression.ts`: eligibility matrix (kind, chain, profile, lifecycle, existing evidence, existing registration), idempotency, withdraw legality, forward-only status transitions, INTERNAL_TEST rejection, journey derivation for every status.
- Re-run `p1a-project-journey-regression.ts` and `p2c2-launch-isolation-regression.ts` unchanged.
- `bunx tsgo --noEmit`, production build, `git diff --check`, exact-scope diff.
- Read-only DB check that PEPECARTEL's PROJECT launch still has no production evidence and no registered contract.

## Open question before build

Can a platform owner create a production attempt against a launch in a workspace they are not a member of? If the existing attempt RPC is workspace-membership-bound, the owner execution step needs an authorized path decision from you — I will not widen any existing RPC's authority on my own.

STOP point: this plan only. No build until approved.
