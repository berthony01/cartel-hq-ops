# Read-only audit: X read spend paths (no implementation)

Everything below comes from reading the code. No files were edited, no SQL was run, nothing was deployed. If you approve, this plan still does nothing: it is a report. Any fix would need its own execution contract.

## 1. Runtime callers

| Path | Caller (file:line) | Provider call |
|---|---|---|
| `socialRead` (src/lib/social-read.functions.ts:63) | **No runtime caller.** No route or component imports it. Only regression scripts reference it (se21-direct-first-provider, project-identity-gate-b). | `socialReadRouter.fetchPostByUrl` / `fetchPostMetrics` / `fetchSourceRecentPosts` (lines 125/128/132) |
| `captureMissionMetrics` (src/lib/social-mission-metrics.functions.ts:62) | src/components/cartel/SocialMissionTestControl.tsx:205. It is rendered only on src/routes/_authenticated/admin.tsx:1494 | `socialReadRouter.fetchPostMetrics` (line 165), fixed to one URL |
| `socialReadRouter` (src/lib/social-read-router.server.ts:112) | Only the two server functions above | Sends X URLs to `xReadProvider` in src/lib/social-read-x.server.ts (:410/:418/:429) and YouTube URLs to social-read-youtube.server.ts |
| src/lib/social-read-x.server.ts | Imported only by social-read-router.server.ts:28 | Direct official X API |
| social-read-refetcher.server.ts (a second provider with the same 3 methods) | No runtime importer | none |
| `x_reads` entitlement | Checked only in social-read.functions.ts:110 and social-mission-metrics.functions.ts:103. It also appears in the feature list in supabase/functions/_shared/commercial-access.ts:34. | — |

Separate X reads that do **not** use `socialRead` or `x_reads`. These are Edge Functions that call supabase/functions/_shared/x-metrics.ts `lookupXPostMetrics` (`GET api.x.com/2/tweets`):
- supabase/functions/social-mission-telegram/index.ts:126 `attemptLaunchMetricsRead`: one lookup when a mission launches.
- supabase/functions/social-mission-telegram/index.ts:198 `attemptFinalMetricsRead`: one lookup when a mission ends.
- supabase/functions/social-mission-runner (cron, every minute): a batch refresh of metrics.

## 2. What each call supports

- `socialRead`: no shipped feature. It is a generic read gateway (single post, metrics, recent posts from a source) with no UI.
- `captureMissionMetrics`: a test tool on the admin page for the PEPE CARTEL live mission. The URL, group and marker are hard-coded, and the browser supplies nothing.
- social-mission-telegram launch/final reads: the metrics shown on a mission card at launch and at the end, for X Missions.
- social-mission-runner: live metric updates and milestone edits on LIVE mission cards.

## 3. Would turning off x_reads for ordinary Pro break anything?

No. X Mission creation, launch and final snapshots, and live metric polling all run through the Edge Functions, and none of them check `x_reads`. The only gated paths are:
- `socialRead`, which has no caller;
- `captureMissionMetrics`, which only works on the hard-coded PEPECARTEL test mission. The owner can still use it because of the unrestricted bypass inside `evaluate_commercial_access`.

Current state: in migration 20260923170038, `cartel_49` has `x_reads` as a hidden feature that is turned on. C1 did not change this.

## 4. Background social-mission-runner

- It skips `x_reads` and every commercial check. It runs only on the cron schedule, is protected by the scheduler secret header, and uses the service role.
- Limits per run, once a minute:
  - worklist capped at `METRICS_WORKLIST_LIMIT = 300` LIVE missions;
  - post IDs de-duplicated across missions;
  - at most `METRICS_MAX_BATCHES = 3` lookups of up to 100 IDs each;
  - so at most 3 X requests and 300 posts per minute across all workspaces;
  - no retries.
- It stops if `X_API_BEARER_TOKEN` is missing.
- Spend is indirectly bounded per workspace by `x_missions` (quota 100 per month on Pro), because only LIVE missions are polled.
- Each post read is logged to `usage_ledger` as `social_x_post_resource_read`, charged to one workspace (lowest workspace ID, then mission ID). That is accounting only; it never blocks.
- Mission launch and final reads: at most one lookup each, no retry, no commercial check, triggered by the mission lifecycle.

## 5. Does socialRead track usage or have a quota?

No. It writes no `usage_ledger` row, and `x_reads` is a feature flag (`limit_value` NULL, `period` 'none'), so the only control is on or off. The only other checks are operator authorization and `can_use_project_tools`. It has no rate limit and no per-call counting. `captureMissionMetrics` also writes no ledger row, but it can only read one fixed URL.

Exposure today: a Pro workspace operator could call the `socialRead` endpoint directly, even though no screen uses it. Each call is one X read, with no limit. `source_recent_posts` also accepts a `limit` from the client. Its upper bound inside the X adapter was not checked in this audit.

## 6. Smallest safe options (not implemented)

Ranked from least to most change:

A. **Set `cartel_49` v1 `x_reads` enabled=false.** This is a one-row reversible migration. Owner access still works through the unrestricted bypass. It breaks no shipped Pro workflow (see section 3). Free already has it off. This is the smallest fix and closes the direct spend path. Risk: the old commercial suites that count migrations need a count update, the same pre-existing issue as before.

B. **Change `x_reads` to a hidden monthly quota** (for example `limit_value` N, `calendar_month_utc`), following the C1 pattern. This needs a new counting branch in `commercial_feature_usage` and a `usage_ledger` write inside `socialRead` for each successful call, otherwise the quota never counts. This is medium size: server function plus SQL.

C. **Retire `socialRead`**: delete the unused server function, or make it owner-only. This is a source-only change with no database work, but the se21 and gate-b regressions would need updating.

D. Defense in depth to add alongside A or B: cap `limit` on the server for `source_recent_posts`. Out of scope unless authorized.

Recommendation: A, optionally followed later by C. B is only worth doing if a Pro feature will actually use `socialRead`.

## Not verified

- The live value of the `cartel_49` `x_reads` row. This report relies on the seed migration plus C1 saying it left `x_reads` alone.
- The cron schedule of the live runner.
- The upper bound on `limit` inside the X adapter.
