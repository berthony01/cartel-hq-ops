/**
 * STEP 1 AUTHORITATIVE regression — CARTEL SOCIAL mission engine.
 *
 * This suite encodes the FROZEN Step 1 contract and supersedes the withdrawn
 * tier/threshold SE-6 direction. It is source/SQL/pure-logic only: ZERO
 * network, ZERO database, ZERO secrets, ZERO Telegram and ZERO X calls.
 *
 * Run: bun scripts/se6-step1-authoritative-regression.ts
 */

import { existsSync, readFileSync } from "node:fs";
import {
  X_BATCH_MAX,
  X_PROVIDER,
  batchPostIds,
  minuteBucket,
} from "../backend-source/edge-functions/_shared/x-metrics";
import {
  buildPulseText,
  pulseMetricLine,
  pulseMilestoneLine,
  pulseRemainingLine,
} from "../backend-source/edge-functions/_shared/mission-pulse-copy";
import {
  EMPTY_METRICS,
  milestoneProgressLine,
  renderMissionCard,
  type CanonicalMetrics,
} from "../backend-source/edge-functions/social-mission-telegram/card";
import {
  MISSION_PRESET_SHAPE,
  defaultMissionSettings,
} from "../src/lib/social-mission-settings";
import {
  MISSION_HISTORY_LIMIT,
  formatMetricChange,
  missionSummary,
  type MissionView,
} from "../src/lib/social-missions";

let passed = 0;
const failures: string[] = [];
function check(name: string, condition: boolean): void {
  if (condition) passed += 1;
  else failures.push(name);
}

const SE5_SQL = "docs/sql/SE5_social_mission_engine.sql";
const SE6_SQL = "docs/sql/SE6_step1_reconciliation.sql";
const RUNNER = "backend-source/edge-functions/social-mission-runner/index.ts";
const TRANSPORT = "backend-source/edge-functions/social-mission-telegram/index.ts";
const CARD = "backend-source/edge-functions/social-mission-telegram/card.ts";
const WEBHOOK = "supabase/functions/telegram-webhook/index.ts";
const MISSIONS_LIB = "src/lib/social-missions.ts";
const SETTINGS_LIB = "src/lib/social-mission-settings.ts";
const SETTINGS_UI = "src/components/cartel/MissionSettingsCard.tsx";
const MISSIONS_UI = "src/components/cartel/SocialMissionsPanel.tsx";

const read = (path: string) => readFileSync(path, "utf8");
const stripTs = (source: string) =>
  source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");

const se5Sql = read(SE5_SQL).replace(/^\s*--.*$/gm, "");
const se6Sql = read(SE6_SQL).replace(/^\s*--.*$/gm, "");
const runnerCode = stripTs(read(RUNNER));
const runnerRaw = read(RUNNER);
const transportCode = stripTs(read(TRANSPORT));
const cardCode = stripTs(read(CARD));
const webhookCode = stripTs(read(WEBHOOK));
const webhookRaw = read(WEBHOOK);

const missionsLibCode = stripTs(read(MISSIONS_LIB));
const settingsLibCode = stripTs(read(SETTINGS_LIB));
const settingsUiCode = stripTs(read(SETTINGS_UI));
const missionsUiCode = stripTs(read(MISSIONS_UI));

// ---------------------------------------------------------------------------
// 1. The withdrawn tier / threshold / 5-minute SE-6 direction is GONE.
// ---------------------------------------------------------------------------
const allSources = [
  se5Sql,
  se6Sql,
  runnerCode,
  transportCode,
  cardCode,
  webhookCode,
  missionsLibCode,
  settingsLibCode,
  settingsUiCode,
  missionsUiCode,
].join("\n");

check("1.1 the superseded tier/threshold migration file is deleted", !existsSync("docs/sql/SE6_mission_tiers_pulse_presets.sql"));
check("1.2 the superseded tier regression is deleted", !existsSync("scripts/se6-mission-tiers-pulse-presets-regression.ts"));
check("1.3 the superseded shared progress module is deleted", !existsSync("backend-source/edge-functions/_shared/mission-progress.ts"));
check("1.4 no saved-preset table remains", !/social_mission_presets/.test(allSources));
check("1.5 no pulse-mark table remains", !/social_mission_pulse_marks/.test(allSources));
check("1.6 no tier milestone table remains", !/social_mission_milestone_events/.test(allSources));
check("1.7 no duplicate performance-history table remains", !/social_mission_performance_history/.test(allSources));
check("1.8 no Tier 1-10 machinery remains", !/TIER_COUNT|DEFAULT_TIER_TARGETS|highestTierMet|tierIsMet|highest_tier/.test(allSources));
check("1.9 no five-minute refresh contract remains", !/REFRESH_INTERVAL_MINUTES|refreshBucket|five-minute|\bfive minute|(?<![0-9])5-minute/i.test(allSources));
check("1.10 no threshold-crossing pulse contract remains", !/evaluatePulseCrossings|PulseCrossing|pulse_deltas|DEFAULT_PULSE_DELTAS/.test(allSources));
check("1.11 no dead import of the removed shared module remains", !/mission-progress/.test(allSources));
check("1.12 no Connect X / OAuth surface was added", !/oauth|connect x/i.test(missionsUiCode + settingsUiCode + missionsLibCode));

// ---------------------------------------------------------------------------
// 2. Requirement 1 — official X metrics, fail-soft, minute-bucketed, batch<=100.
// ---------------------------------------------------------------------------
check("2.1 the official batch ceiling is 100 post ids", X_BATCH_MAX === 100);
check("2.2 batching never exceeds the ceiling", batchPostIds(Array.from({ length: 251 }, (_, i) => String(i + 1))).every((b) => b.length <= 100));
check("2.3 batching preserves every id exactly once", batchPostIds(["1", "2", "2", "3"]).flat().length === 3);
check("2.4 the metric bucket has MINUTE resolution", minuteBucket(Date.parse("2026-01-01T10:07:41.900Z")) === "2026-01-01T10:07:00.000Z");
check("2.5 two reads inside the same minute collapse onto one bucket", minuteBucket(Date.parse("2026-01-01T10:07:02Z")) === minuteBucket(Date.parse("2026-01-01T10:07:58Z")));
check("2.6 the one-minute runner remains the only metrics worker", /minuteBucket/.test(runnerCode));
check("2.7 the launch read is fail-soft", /attemptLaunchMetricsRead/.test(transportCode) && /catch\s*\{/.test(transportCode));
check("2.8 the bearer token is only read from the server environment", /Deno\.env\.get\("X_API_BEARER_TOKEN"\)/.test(transportCode));
check("2.9 the bearer token never reaches the browser bundle", !/X_API_BEARER_TOKEN/.test(missionsLibCode + settingsLibCode + settingsUiCode + missionsUiCode));
check("2.10 snapshots are unique per mission, provider and bucket", /ON CONFLICT \(mission_id, provider, poll_bucket\) DO NOTHING/.test(se6Sql));
check("2.11 unknown metrics stay NULL and are never zero-filled", !/COALESCE\(_views, 0\)|COALESCE\(_likes, 0\) AS/.test(se6Sql));
check("2.12 the card edit is gated on a changed metric signature", /metricSignature/.test(runnerCode) && /claim_social_mission_card_refresh/.test(runnerCode));

// ---------------------------------------------------------------------------
// 3. Requirement 3 — Pulse 2.0: preset cadence, stored metrics, ZERO X reads.
// ---------------------------------------------------------------------------
const pulseStart = runnerCode.indexOf('event.event_type === "PULSE"');
const pulseEnd = runnerCode.indexOf('"COMPLETE"', pulseStart);
const pulseBranch = runnerCode.slice(pulseStart, pulseEnd > pulseStart ? pulseEnd : pulseStart + 4000);
check("3.1 the PULSE branch performs no provider lookup", !/lookupXPostMetrics/.test(pulseBranch));
check("3.2 the PULSE branch reads STORED snapshots only", /social_metric_snapshots/.test(pulseBranch));
check("3.3 a pulse is exactly one reply-only sendMessage", /sendMessage/.test(pulseBranch) && !/sendPhoto/.test(pulseBranch));
check("3.4 a pulse never posts without its canonical card", !/allow_sending_without_reply/.test(pulseBranch));
check("3.5 pulses are auto-deleted after 120 seconds", /social_mission_pulse/.test(runnerCode));

check("3.6 a pulse omits unknown metrics entirely", pulseMetricLine({ views: null, likes: null, comments: null, shares: null, saves: null }) === null);
check("3.7 a pulse never prints an unknown metric as zero", !(pulseMetricLine({ views: 10, likes: null, comments: null, shares: null, saves: null }) ?? "").includes("0 likes"));
check("3.8 a known metric is quoted", (pulseMetricLine({ views: 10, likes: 2, comments: null, shares: null, saves: null }) ?? "").includes("10 views"));
check("3.9 milestone progress is shown when configured and known", (pulseMilestoneLine({ views: 40, likes: null, comments: null, shares: null, saves: null }, { milestone_type: "VIEWS", milestone_target: 100 }) ?? "").includes("40 / 100"));
check("3.10 a missing milestone prints nothing and is not a failure", pulseMilestoneLine({ views: 40, likes: null, comments: null, shares: null, saves: null }, { milestone_type: "NONE" }) === null);
check("3.11 an unknown milestone metric prints nothing", pulseMilestoneLine({ views: null, likes: null, comments: null, shares: null, saves: null }, { milestone_type: "VIEWS", milestone_target: 100 }) === null);
check("3.12 a reached milestone is reported as reached", (pulseMilestoneLine({ views: 120, likes: null, comments: null, shares: null, saves: null }, { milestone_type: "VIEWS", milestone_target: 100 }) ?? "").startsWith("Milestone reached"));
check("3.13 total interactions exclude views", (pulseMilestoneLine({ views: 999, likes: 1, comments: 1, shares: 1, saves: null }, { milestone_type: "TOTAL_INTERACTIONS", milestone_target: 10 }) ?? "").includes("3 / 10"));
const nowMs = Date.parse("2026-01-01T10:00:00Z");
check("3.14 remaining time is approximate and useful", pulseRemainingLine("2026-01-01T10:20:00Z", nowMs) === "About 20 minutes left.");
check("3.15 an ended window prints no remaining time", pulseRemainingLine("2026-01-01T09:00:00Z", nowMs) === null);
check("3.16 an unknown end prints no remaining time", pulseRemainingLine(null, nowMs) === null);
const pulseText = buildPulseText({ views: 100, likes: 5, comments: null, shares: null, saves: null }, false, {
  endsAt: "2026-01-01T10:30:00Z",
  config: { milestone_type: "LIKES", milestone_target: 50 },
  nowMs,
});
check("3.17 a pulse combines metrics, milestone and timing", pulseText.includes("100 views") && pulseText.includes("5 / 50 likes") && pulseText.includes("30 minutes left"));
check("3.18 a pulse with nothing known still sends its base copy", buildPulseText(null, false, { nowMs }).length > 0);
check("3.19 an accomplished mission pulses differently", buildPulseText(null, true, { nowMs }) !== buildPulseText(null, false, { nowMs }));
check("3.20 pulse copy reads from the mission's own immutable effective config", /effective_config/.test(runnerCode));

// ---------------------------------------------------------------------------
// 4. Requirement 6 — ONE preset system: STANDARD / QUICK / MAJOR / LAUNCH.
// ---------------------------------------------------------------------------
const presets = MISSION_PRESET_SHAPE as unknown as Record<string, { durationMinutes: number; pulseOffsets: number[] }>;
const offsets = (key: string) => (presets[key]?.pulseOffsets ?? []).join(",");
check("4.1 exactly four presets exist", Object.keys(presets).length === 4);
check("4.2 STANDARD runs 45 minutes", presets["STANDARD"]?.durationMinutes === 45);
check("4.3 STANDARD pulses at 3, 8, 15, 25 and 35 minutes", offsets("STANDARD") === "3,8,15,25,35");
check("4.4 QUICK runs 20 minutes at 2, 5, 10, 15", presets["QUICK"]?.durationMinutes === 20 && offsets("QUICK") === "2,5,10,15");
check("4.5 MAJOR_ANNOUNCEMENT runs 120 minutes at 5, 15, 30, 60, 90", presets["MAJOR_ANNOUNCEMENT"]?.durationMinutes === 120 && offsets("MAJOR_ANNOUNCEMENT") === "5,15,30,60,90");
check("4.6 LAUNCH runs 60 minutes at 3, 8, 15, 30, 45", presets["LAUNCH"]?.durationMinutes === 60 && offsets("LAUNCH") === "3,8,15,30,45");
check("4.7 the default preset is STANDARD", defaultMissionSettings("w").default_preset === "STANDARD");
check("4.8 the SQL seeds preset-driven scheduled PULSE rows", /activate_social_mission_schedule/.test(se5Sql) && /'PULSE'/.test(se5Sql));
check("4.9 the effective config is snapshotted per mission at launch", /effective_config/.test(se5Sql));
check("4.10 the due-list and pulses read the frozen snapshot, not live settings", /metadata/.test(runnerCode) && /effective_config/.test(runnerCode));
check("4.11 there is exactly one workspace settings table", (settingsLibCode.match(/\.from\(/g) ?? []).length === (settingsLibCode.match(/\.from\(TABLE\)/g) ?? []).length);

// ---------------------------------------------------------------------------
// 5. Requirement 5 — X Link Finder authorization SEQUENCING.
// ---------------------------------------------------------------------------
const peekIdx = webhookCode.indexOf("peek_social_mission_link_candidate");
const memberIdx = webhookCode.indexOf("getChatMember", peekIdx);
const resolveIdx = webhookCode.indexOf("resolve_social_mission_link_candidate", peekIdx);
check("5.1 a read-only preflight RPC exists", /CREATE OR REPLACE FUNCTION public\.peek_social_mission_link_candidate/.test(se6Sql));
check("5.2 the preflight is STABLE and mutates nothing", /peek_social_mission_link_candidate[\s\S]{0,900}STABLE/.test(se6Sql));
check("5.3 the preflight contains no write statement", !/peek_social_mission_link_candidate[\s\S]*?\$\$;/.exec(se6Sql)?.[0]?.match(/\b(UPDATE|INSERT|DELETE)\b/));
check("5.4 the webhook peeks before anything else", peekIdx > 0);
check("5.5 live Telegram admin verification runs after the preflight", memberIdx > peekIdx);
check("5.6 the candidate is consumed only after live verification", resolveIdx > memberIdx);
check("5.7 a non-admin tap leaves the candidate PENDING", /Only current administrators/.test(webhookCode));
check("5.8 the resolver requires the verified chat id", /_verified_chat_id bigint/.test(se6Sql) && /_verified_chat_id: candidateChatId/.test(webhookCode));
check("5.9 the resolver rejects a chat mismatch", /'chat_mismatch'/.test(se6Sql));
check("5.10 the old unverified 3-argument resolver is dropped", /DROP FUNCTION IF EXISTS public\.resolve_social_mission_link_candidate\(uuid, bigint, text\);/.test(se6Sql));
check("5.11 the resolver revalidates operator authority itself", /resolve_social_mission_link_candidate[\s\S]*?is_workspace_operator/.test(se6Sql));
check("5.12 the admin check uses the candidate's OWN chat", /telegram_chat_id.*preflight|candidateChatId/.test(webhookCode));
check("5.13 START reuses the existing authorized mission pipeline", /runMissionCommand\(\{[\s\S]{0,400}telegram_link_finder/.test(webhookCode));
// RE-PINNED by SE-7, not loosened: the withdrawn "never delete the member's
// post" rule (asserted as `messageId: null`) is replaced by the frozen product
// behaviour — START passes the candidate's REAL source message id, and that
// post is deleted ONLY after a confirmed card send plus an active schedule.
check("5.14 START carries the candidate's real source message id, never null", !/messageId: null/.test(webhookCode) && /messageId: sourceMessageId/.test(webhookCode));


// ---------------------------------------------------------------------------
// 6. Requirement 8 / (E) — final X snapshot on MANUAL close.
// ---------------------------------------------------------------------------
const finalFn = transportCode.slice(transportCode.indexOf("async function attemptFinalMetricsRead"), transportCode.indexOf("async function attemptFinalMetricsRead") + 2600);
check("6.1 a manual-close final refresh exists", /attemptFinalMetricsRead/.test(transportCode));
check("6.2 it skips the provider when this minute already has a snapshot", /poll_bucket/.test(finalFn) && /if \(existing\) return;/.test(finalFn));
check("6.3 it makes at most one official lookup", (finalFn.match(/lookupXPostMetrics/g) ?? []).length === 1);
check("6.4 it is fail-soft and cannot block the close", /catch\s*\{/.test(finalFn));
check("6.5 it reuses the existing snapshot RPC", /record_social_mission_metric_snapshot/.test(finalFn));
check("6.6 it runs only for a manual close, not the scheduled runner", /finalRefresh === true/.test(transportCode) && /internalSource === INTERNAL_SOURCE/.test(transportCode));
check("6.7 it runs before the completion card is rendered", transportCode.indexOf("attemptFinalMetricsRead(admin, workspaceId, mission)") < transportCode.lastIndexOf("renderAuthoritativeCard(admin, workspaceId, mission, transportKind)"));
check("6.8 close semantics stay deterministic and idempotent", /edit_client_request_id/.test(transportCode));
check("6.9 no scraper or second provider path was added", !/puppeteer|scrape|nitter|syndication/i.test(transportCode));

// ---------------------------------------------------------------------------
// 7. Requirement (F) — internal-only X read telemetry.
// ---------------------------------------------------------------------------
check("7.1 usage is recorded on the existing usage_ledger", /INSERT INTO public\.usage_ledger/.test(se6Sql));
check("7.2 the unit is a clearly named tracked-post read", /social_x_tracked_post_read/.test(se6Sql));
check("7.3 usage is written only when a NEW snapshot row was inserted", /IF v_snapshot_inserted AND _provider = 'x-official' THEN[\s\S]{0,600}usage_ledger/.test(se6Sql));
check(
  "7.3a the SQL telemetry gate matches the runtime X_PROVIDER constant exactly",
  new RegExp(`IF v_snapshot_inserted AND _provider = '${X_PROVIDER}' THEN`).test(se6Sql),
);
check("7.3b the runtime official provider constant is still x-official", X_PROVIDER === "x-official");
check("7.3c no stale bare 'x' provider telemetry gate remains", !/_provider = 'x'\s/.test(se6Sql) && !/_provider = 'x' THEN/.test(se6Sql));
check("7.3d telemetry is not broadened to arbitrary providers", !/_provider IS NOT NULL THEN|_provider LIKE/.test(se6Sql));
check(
  "7.3e the documented unit names the official provider constant",
  /x-official/.test(readFileSync(SE6_SQL, "utf8")),
);
check("7.4 a retry cannot multiply usage", /v_snapshot_inserted := v_rows = 1;/.test(se6Sql));
check("7.5 no dollar pricing is encoded", !/provider_cost\s*,|internal_cost\s*,/.test(se6Sql));
check("7.6 no billing, limit or entitlement is introduced", !/stripe|invoice|entitlement|quota|billing/i.test(se6Sql));
check("7.7 telemetry is documented as operational, not billable", /not billable usage/i.test(readFileSync(SE6_SQL, "utf8")));

// ---------------------------------------------------------------------------
// 8. Requirement 7 / (G) — customer history and summary, read-only.
// ---------------------------------------------------------------------------
check("8.1 the read layer performs no mutation", !/\.insert\(|\.update\(|\.upsert\(|\.delete\(|\.rpc\(|functions\.invoke/.test(missionsLibCode));
check("8.2 no browser polling was introduced", !/refetchInterval/.test(missionsLibCode) && !/refetchInterval/.test(missionsUiCode));
check("8.3 history reuses the already-loaded snapshots", /snapshotCount/.test(missionsLibCode) && (missionsLibCode.match(/from\("social_metric_snapshots"\)/g) ?? []).length === 1);
check("8.4 history rendering is bounded", MISSION_HISTORY_LIMIT > 0 && MISSION_HISTORY_LIMIT <= 25);
check("8.5 existing mission tables remain the only source", /social_mission_targets/.test(missionsLibCode) && /social_mission_schedule_events/.test(missionsLibCode));

const baseSnapshot = (observed: string, views: number | null, likes: number | null) =>
  ({
    id: observed,
    mission_id: "m",
    workspace_id: "w",
    provider: "x",
    observed_at: observed,
    poll_bucket: observed,
    views,
    likes,
    comments: null,
    shares: null,
    saves: null,
  }) as unknown as MissionView["snapshots"][number];

const completedView = {
  mission: {
    id: "m",
    status: "COMPLETED",
    started_at: "2026-01-01T10:00:00Z",
    ends_at: "2026-01-01T10:45:00Z",
    completed_at: "2026-01-01T10:45:00Z",
    accomplished_at: "2026-01-01T10:30:00Z",
  },
  canonicalUrl: null,
  authorHandle: null,
  targets: [],
  scheduleEvents: [],
  latestSnapshot: null,
  snapshots: [baseSnapshot("2026-01-01T10:44:00Z", 900, null), baseSnapshot("2026-01-01T10:01:00Z", 100, 4)],
  snapshotCount: 2,
} as unknown as MissionView;

const summary = missionSummary(completedView);
const viewsChange = summary.changes.find((c) => c.key === "views");
const likesChange = summary.changes.find((c) => c.key === "likes");
const sharesChange = summary.changes.find((c) => c.key === "shares");
check("8.6 baseline-to-final change is computed from stored readings", viewsChange?.change === 800);
check("8.7 the final value is the newest stored reading", viewsChange?.final === 900);
check("8.8 a half-known comparison stays unknown, never zero", likesChange?.change === null);
check("8.9 a never-observed metric stays unknown", sharesChange?.final === null && sharesChange?.change === null);
check("8.10 duration is derived from stored timestamps", summary.durationMinutes === 45);
check("8.11 accomplishment is reported without a database status", summary.accomplished === true);
check("8.12 completion is reported", summary.completed === true);
check("8.13 the honest stored reading count is surfaced", summary.storedReadings === 2);
check("8.14 an unknown change renders as a dash", formatMetricChange(null) === "—");
check("8.15 a positive change renders signed", formatMetricChange(800) === "+800");
check("8.16 the customer surface renders the history strip", /Stored metric history/.test(missionsUiCode));
check("8.17 the customer surface renders the final result", /Final result/.test(missionsUiCode));
check("8.18 the customer surface stays read-only", !/onClick=\{\(\) => *(start|close|send)/i.test(missionsUiCode));

// ---------------------------------------------------------------------------
// 9. Requirement (H) — preserved SE-5 safety behaviour.
// ---------------------------------------------------------------------------
check("9.1 the raw command is deleted only after a confirmed send", /record_social_mission_command_deleted/.test(webhookCode));
check("9.2 auto-pin defaults ON unless a persisted setting says otherwise", /auto_pin_mission"\] !== false/.test(webhookCode));
check("9.3 only a pin CARTEL HQ recorded can be unpinned", /record_social_mission_target_pin/.test(webhookCode) && /unpinChatMessage/.test(webhookCode));
check("9.4 the mission card is a branded PHOTO card with same-message edits", /editMessageCaption/.test(transportCode) && /sendPhoto/.test(transportCode));
check("9.5 milestone evaluation stays null-honest", /IF v_progress IS NOT NULL AND v_progress >= v_target_value THEN/.test(se6Sql));
check("9.6 the baseline is written exactly once", /baseline_observed_at = COALESCE\(baseline_observed_at/.test(se6Sql));
check("9.7 no reward, point, badge or payout is tied to engagement", !/reward|payout|points_awarded|badge/i.test(se6Sql + runnerCode + transportCode));

// ---------------------------------------------------------------------------
// 10. Rollout safety — prepared only, one scheduler, no secrets.
// ---------------------------------------------------------------------------
check("10.1 the reconciliation migration is transactional", /^BEGIN;/m.test(readFileSync(SE6_SQL, "utf8")) && /^COMMIT;/m.test(readFileSync(SE6_SQL, "utf8")));
check("10.2 it creates no new table", !/CREATE TABLE/i.test(se6Sql));
check("10.3 it creates no second scheduler", !/cron\.schedule/.test(se6Sql));
check("10.4 every new RPC is service-role only", (se6Sql.match(/GRANT EXECUTE ON FUNCTION/g) ?? []).length >= 3 && !/GRANT EXECUTE ON FUNCTION[^;]*TO authenticated/.test(se6Sql));
check("10.5 no secret value is embedded", !/eyJ|sb_secret_|Bearer /.test(se6Sql));
check("10.6 it drops no table and deletes no data", !/DROP TABLE|TRUNCATE|DELETE FROM/i.test(se6Sql));

// ---------------------------------------------------------------------------
// 11. FINAL HARDENING — true durable baseline, null-honest TOTAL_INTERACTIONS,
//     and Link Finder callback context binding.
// ---------------------------------------------------------------------------

// 11.a — the durable baseline, not the oldest DISPLAYED reading.
// This mission stored far more readings than the UI loads, so the oldest
// loaded snapshot (views 5000) is NOT the true baseline (views 100).
const longMissionView = {
  mission: {
    id: "m2",
    status: "COMPLETED",
    started_at: "2026-01-01T10:00:00Z",
    ends_at: "2026-01-01T11:00:00Z",
    completed_at: "2026-01-01T11:00:00Z",
    accomplished_at: null,
    baseline_observed_at: "2026-01-01T10:01:00Z",
    baseline_views: 100,
    baseline_likes: null,
    baseline_comments: null,
    baseline_shares: null,
    baseline_saves: null,
  },
  canonicalUrl: null,
  authorHandle: null,
  targets: [],
  scheduleEvents: [],
  latestSnapshot: null,
  snapshots: [
    baseSnapshot("2026-01-01T10:59:00Z", 9000, 320),
    baseSnapshot("2026-01-01T10:30:00Z", 5000, 180),
  ],
  snapshotCount: MISSION_HISTORY_LIMIT + 7,
} as unknown as MissionView;

const longSummary = missionSummary(longMissionView);
const longViews = longSummary.changes.find((c) => c.key === "views");
const longLikes = longSummary.changes.find((c) => c.key === "likes");
check("11.1 the truncated history is genuinely longer than what is displayed", longMissionView.snapshotCount > MISSION_HISTORY_LIMIT && longMissionView.snapshots.length <= MISSION_HISTORY_LIMIT);
check("11.2 the oldest DISPLAYED reading is not the true baseline", longMissionView.snapshots[longMissionView.snapshots.length - 1]!.views === 5000);
check("11.3 the summary baseline is the mission's durable baseline", longViews?.baseline === 100);
check("11.4 baseline-to-final change uses the durable baseline", longViews?.change === 8900);
check("11.5 the final value is still the newest stored reading", longViews?.final === 9000);
check("11.6 a NULL durable baseline metric stays unknown", longLikes?.baseline === null);
check("11.7 a NULL durable baseline is never filled from a later snapshot", longLikes?.change === null && longLikes?.final === 320);
check("11.8 the durable baseline columns are read from the mission row", /baseline_\$\{key\}|baseline_observed_at/.test(missionsLibCode));
check("11.9 the legacy fallback is documented and gated on a missing durable baseline", /LEGACY ONLY/.test(readFileSync(MISSIONS_LIB, "utf8")) && /hasDurableBaseline/.test(missionsLibCode));

// Legacy missions, with no durable baseline at all, still summarise.
check("11.10 a legacy mission without a durable baseline still summarises", missionSummary(completedView).changes.find((c) => c.key === "views")?.baseline === 100);

// 11.b — TOTAL_INTERACTIONS is null-honest.
const totalConfig = { milestone_type: "TOTAL_INTERACTIONS", milestone_target: 100 };
const allKnown = pulseMilestoneLine(
  { views: 10, likes: 30, comments: 20, shares: 10, saves: null } as never,
  totalConfig,
);
const missingReplies = pulseMilestoneLine(
  { views: 10, likes: 30, comments: null, shares: 10, saves: null } as never,
  totalConfig,
);
const missingLikes = pulseMilestoneLine(
  { views: 10, likes: null, comments: 20, shares: 10, saves: null } as never,
  totalConfig,
);
const missingShares = pulseMilestoneLine(
  { views: 10, likes: 30, comments: 20, shares: null, saves: null } as never,
  totalConfig,
);
check("11.11 all three known components sum correctly", allKnown !== null && /60 \/ 100 interactions/.test(allKnown));
check("11.12 a missing replies count yields no milestone progress", missingReplies === null);
check("11.13 a missing likes count yields no milestone progress", missingLikes === null);
check("11.14 a missing reposts count yields no milestone progress", missingShares === null);
check("11.15 VIEWS milestone behaviour is preserved", (pulseMilestoneLine({ views: 500, likes: null, comments: null, shares: null, saves: null } as never, { milestone_type: "VIEWS", milestone_target: 400 }) ?? "").includes("Milestone reached"));
check("11.16 an unknown single metric still yields no progress", pulseMilestoneLine({ views: null, likes: null, comments: null, shares: null, saves: null } as never, { milestone_type: "LIKES", milestone_target: 10 }) === null);
const pulseCopySrc = read("backend-source/edge-functions/_shared/mission-pulse-copy.ts");
check("11.17 the pulse total never coerces an unknown component to zero", !/\(metrics\.likes \?\? 0\)/.test(pulseCopySrc));
check("11.18 the pulse total requires ALL THREE components", /metrics\.likes === null \|\| metrics\.comments === null \|\| metrics\.shares === null/.test(pulseCopySrc));

// SQL side — both prepared migrations use the all-three gate, no COALESCE.
for (const [label, sql] of [["SE-5", se5Sql], ["SE-6", se6Sql]] as const) {
  const branch = sql.slice(sql.indexOf("WHEN 'TOTAL_INTERACTIONS' THEN"), sql.indexOf("WHEN 'TOTAL_INTERACTIONS' THEN") + 320);
  check(`11.19 ${label} gates the total on all three components being non-null`, /_likes IS NULL OR _comments IS NULL OR _shares IS NULL/.test(branch));
  check(`11.20 ${label} never coalesces an unknown interaction component to zero`, !/COALESCE\(_likes, 0\)/.test(branch));
  check(`11.21 ${label} cannot accomplish from a partial interaction set`, /THEN NULL/.test(branch) && /IF v_progress IS NOT NULL AND v_progress >= v_target_value THEN/.test(sql));
}

// 11.c — Link Finder callback context binding.
const lfBranch = webhookRaw.slice(
  webhookRaw.indexOf("const smStart = callbackData.match"),
  webhookRaw.indexOf('source: "telegram_link_finder"'),
);
const idxMismatch = lfBranch.indexOf("String(candidateChatId) !== String(callbackChatId)");
const idxGetMember = lfBranch.indexOf('"getChatMember"');
const idxResolve = lfBranch.indexOf("resolve_social_mission_link_candidate");
check("11.22 the callback context is bound to the candidate's own chat", idxMismatch > 0);
check("11.23 the mismatch guard runs BEFORE live admin verification", idxMismatch < idxGetMember);
check("11.24 the mismatch guard runs BEFORE the consuming resolver", idxMismatch < idxResolve);
check("11.25 a mismatched context returns without resolving", /String\(candidateChatId\) !== String\(callbackChatId\)[\s\S]{0,240}?return json\(\{ ok: true \}\);/.test(lfBranch));
check("11.26 live verification uses the candidate chat", /chat_id: candidateChatId,\s*\n\s*user_id: Number\(from\.id\)/.test(lfBranch));
check("11.27 the resolver still requires the verified chat id", /_verified_chat_id: candidateChatId/.test(lfBranch));
check("11.28 prompt cleanup targets the candidate chat", /deleteMessage"[\s\S]{0,200}?chat_id: candidateChatId/.test(lfBranch));
check("11.29 START launches into the candidate chat", /chatId: String\(candidateChatId\)/.test(webhookRaw));
check("11.30 no Link Finder action uses callbackChatId", !/chat_id: callbackChatId|chatId: callbackChatId/.test(lfBranch));

// 11.d — the runner header no longer claims zero metric reads of any kind.
check("11.31 the runner header says ZERO provider/X reads", /ZERO provider\/X reads/.test(runnerRaw));
check("11.32 the runner header no longer claims ZERO metric reads", !/ZERO metric reads/.test(runnerRaw));
check("11.33 the runner still performs zero provider calls in the lifecycle loop", !/lookupXPostMetrics/.test(runnerCode.slice(runnerCode.indexOf("PULSE"))) || !/api\.x\.com/.test(runnerCode));


// ---------------------------------------------------------------------------
// 12. Telegram CARD renderer milestone progress is NULL-HONEST.
// ---------------------------------------------------------------------------
const cardMetrics = (over: Partial<CanonicalMetrics>): CanonicalMetrics => ({
  ...EMPTY_METRICS,
  ...over,
});

const totalMilestone = { type: "TOTAL_INTERACTIONS", target: 100 } as const;

check(
  "12.1 card TOTAL_INTERACTIONS sums when all three components are known",
  milestoneProgressLine(totalMilestone, cardMetrics({ likes: 10, comments: 5, shares: 2 }), false) ===
    "Milestone: Likes + replies + reposts 17 / 100",
);
check(
  "12.2 card TOTAL_INTERACTIONS returns null when likes are unknown",
  milestoneProgressLine(totalMilestone, cardMetrics({ comments: 5, shares: 2 }), false) === null,
);
check(
  "12.3 card TOTAL_INTERACTIONS returns null when replies are unknown",
  milestoneProgressLine(totalMilestone, cardMetrics({ likes: 10, shares: 2 }), false) === null,
);
check(
  "12.4 card TOTAL_INTERACTIONS returns null when reposts are unknown",
  milestoneProgressLine(totalMilestone, cardMetrics({ likes: 10, comments: 5 }), false) === null,
);
check(
  "12.5 card TOTAL_INTERACTIONS never coerces a missing component to zero",
  milestoneProgressLine(totalMilestone, cardMetrics({ likes: 10, comments: 5 }), false) !==
    "Milestone: Likes + replies + reposts 15 / 100",
);
check(
  "12.6 a LIVE card with a partial interaction set renders no milestone line",
  !renderMissionCard({
    missionStatus: "LIVE",
    platform: "x",
    canonicalUrl: "https://x.com/PEPECARTELTOKEN/status/2098827349470961903",
    authorHandle: "PEPECARTELTOKEN",
    contentText: null,
    projectName: "PEPECARTEL",
    ticker: "PCART",
    baseline: EMPTY_METRICS,
    latest: cardMetrics({ likes: 10, comments: 5 }),
    milestone: totalMilestone,
    nowMs: 0,
  }).text.includes("Milestone:"),
);
check(
  "12.7 a LIVE card with all three components renders the milestone line",
  renderMissionCard({
    missionStatus: "LIVE",
    platform: "x",
    canonicalUrl: "https://x.com/PEPECARTELTOKEN/status/2098827349470961903",
    authorHandle: "PEPECARTELTOKEN",
    contentText: null,
    projectName: "PEPECARTEL",
    ticker: "PCART",
    baseline: EMPTY_METRICS,
    latest: cardMetrics({ likes: 10, comments: 5, shares: 2 }),
    milestone: totalMilestone,
    nowMs: 0,
  }).text.includes("Milestone: Likes + replies + reposts 17 / 100"),
);

// 12.b — single-metric milestone behavior is preserved exactly.
check(
  "12.8 card VIEWS milestone still reports known views",
  milestoneProgressLine({ type: "VIEWS", target: 1000 }, cardMetrics({ views: 250 }), false) ===
    "Milestone: Views 250 / 1000",
);
check(
  "12.9 card LIKES milestone still reports known likes",
  milestoneProgressLine({ type: "LIKES", target: 50 }, cardMetrics({ likes: 12 }), false) ===
    "Milestone: Likes 12 / 50",
);
check(
  "12.10 card REPLIES milestone still reports known replies",
  milestoneProgressLine({ type: "REPLIES", target: 20 }, cardMetrics({ comments: 4 }), false) ===
    "Milestone: Replies 4 / 20",
);
check(
  "12.11 card REPOSTS milestone still reports known reposts",
  milestoneProgressLine({ type: "REPOSTS", target: 20 }, cardMetrics({ shares: 6 }), false) ===
    "Milestone: Reposts 6 / 20",
);
check(
  "12.12 card single-metric milestones stay null when that metric is unknown",
  milestoneProgressLine({ type: "VIEWS", target: 1000 }, EMPTY_METRICS, false) === null &&
    milestoneProgressLine({ type: "LIKES", target: 50 }, EMPTY_METRICS, false) === null &&
    milestoneProgressLine({ type: "REPLIES", target: 20 }, EMPTY_METRICS, false) === null &&
    milestoneProgressLine({ type: "REPOSTS", target: 20 }, EMPTY_METRICS, false) === null,
);
check(
  "12.13 card milestone reached marker still appears once the target is met",
  milestoneProgressLine({ type: "LIKES", target: 10 }, cardMetrics({ likes: 10 }), false)?.endsWith("✅") === true,
);

// 12.c — source assertion: no partial-sum semantics may return.
check(
  "12.14 the card renderer cannot partial-sum TOTAL_INTERACTIONS",
  !/\[latest\.likes, latest\.comments, latest\.shares\]\s*\.filter\(isCount\)/.test(cardCode) &&
    !/filter\(isCount\)/.test(cardCode),
);
check(
  "12.15 the card renderer gates the total on all three known components",
  /isCount\(latest\.likes\)\s*&&\s*isCount\(latest\.comments\)\s*&&\s*isCount\(latest\.shares\)/.test(cardCode),
);
check(
  "12.16 the card renderer never coalesces milestone components to zero",
  !/latest\.(likes|comments|shares)\s*\?\?\s*0/.test(cardCode),
);


// ---------------------------------------------------------------------------
// 13. social_mission_effective_config is SERVICE-ONLY.
// ---------------------------------------------------------------------------
const effectiveConfigGrants = [se5Sql, se6Sql]
  .join("\n")
  .split("\n")
  .filter((line) => /social_mission_effective_config\(uuid\)/.test(line) && /GRANT|REVOKE/i.test(line));

check("13.1 the helper's grants are declared exactly once", effectiveConfigGrants.filter((l) => /^\s*GRANT/i.test(l)).length === 1);
check(
  "13.2 EXECUTE is revoked from PUBLIC, anon AND authenticated",
  /REVOKE ALL ON FUNCTION public\.social_mission_effective_config\(uuid\) FROM PUBLIC, anon, authenticated;/.test(se5Sql),
);
check(
  "13.3 EXECUTE is granted only to service_role and postgres",
  /GRANT EXECUTE ON FUNCTION public\.social_mission_effective_config\(uuid\) TO service_role, postgres;/.test(se5Sql),
);
check(
  "13.4 no prepared SQL grants the helper to authenticated or anon",
  !effectiveConfigGrants.some((line) => /^\s*GRANT/i.test(line) && /\b(authenticated|anon|PUBLIC)\b/.test(line)),
);
check(
  "13.5 the helper is still SECURITY DEFINER with an unchanged body contract",
  /CREATE OR REPLACE FUNCTION public\.social_mission_effective_config\(_mission_id uuid\)[\s\S]{0,600}SECURITY DEFINER/.test(se5Sql),
);
check(
  "13.6 only service-side code calls the helper from the app runtime",
  /admin\.rpc\("social_mission_effective_config"/.test(webhookRaw) &&
    !/supabase\.rpc\(\s*"social_mission_effective_config"/.test(missionsLibCode + missionsUiCode + settingsLibCode + settingsUiCode),
);
check(
  "13.7 Link Finder candidates stay service-only with RLS and no authenticated policy",
  /ALTER TABLE public\.social_mission_link_candidates ENABLE ROW LEVEL SECURITY/.test(se5Sql) &&
    !/CREATE POLICY[^;]*social_mission_link_candidates[^;]*TO authenticated/.test(se5Sql + se6Sql),
);

// ---------------------------------------------------------------------------
// 14. Link Finder anonymous-admin compatibility (executes production source)
// ---------------------------------------------------------------------------
const senderFnStart = webhookRaw.indexOf("const linkFinderSender = ((msg) => {");
const senderFnSrc = webhookRaw.slice(
  webhookRaw.indexOf("((msg) => {", senderFnStart),
  webhookRaw.indexOf(")({ from, sender_chat: senderChat, chat }", senderFnStart) + 1,
);
check("14.1 the sender predicate is extractable from the production webhook", senderFnStart > 0 && senderFnSrc.length > 50);
type SenderResult = { eligible: boolean; posterId: number | null };
const senderEligibility = new Function(`return ${senderFnSrc};`)() as (
  msg: unknown,
) => SenderResult;

const human = senderEligibility({ from: { id: 42, is_bot: false }, chat: { id: -100123 } });
check("14.2 an ordinary human post is still eligible with its own poster id", human.eligible && human.posterId === 42);

const anon = senderEligibility({
  from: { id: 1087968824, is_bot: true, username: "GroupAnonymousBot" },
  sender_chat: { id: -100123, type: "supergroup" },
  chat: { id: -100123, type: "supergroup" },
});
check("14.3 an anonymous admin post in the same group is eligible", anon.eligible);
check("14.4 the anonymous poster id is stored as unknown, never a bot id", anon.posterId === null);

const anonGroup = senderEligibility({
  from: { id: 1087968824, is_bot: true },
  sender_chat: { id: -55, type: "group" },
  chat: { id: -55, type: "group" },
});
check("14.5 a legacy group sender_chat is accepted the same way", anonGroup.eligible && anonGroup.posterId === null);

check(
  "14.6 an arbitrary bot post with no sender_chat is ignored",
  senderEligibility({ from: { id: 777, is_bot: true }, chat: { id: -100123 } }).eligible === false,
);
check(
  "14.7 a sender_chat from a different chat is ignored",
  senderEligibility({
    from: { id: 1087968824, is_bot: true },
    sender_chat: { id: -100999, type: "supergroup" },
    chat: { id: -100123, type: "supergroup" },
  }).eligible === false,
);
check(
  "14.8 a channel sender_chat is ignored",
  senderEligibility({
    from: { id: 136817688, is_bot: true },
    sender_chat: { id: -100123, type: "channel" },
    chat: { id: -100123, type: "supergroup" },
  }).eligible === false,
);
check(
  "14.9 a message with no sender at all is ignored",
  senderEligibility({ chat: { id: -100123 } }).eligible === false,
);
check(
  "14.10 the candidate RPC receives the derived poster id, never a raw bot id",
  /_telegram_user_id: posterId,/.test(webhookRaw) &&
    /await offerLinkFinderCandidate\(\s*\n?\s*parsedLink,\s*\n?\s*Number\(message\?\.message_id\),\s*\n?\s*linkFinderSender\.posterId,/
      .test(webhookRaw) &&
    !/create_social_mission_link_candidate[\s\S]{0,400}_telegram_user_id: Number\(from\.id\)/.test(webhookRaw),
);

check(
  "14.11 detection still requires a connected group chat and a non-command message",
  /linkFinderSender\.eligible && !text\.startsWith\("\/"\) && isGroupChat/.test(webhookRaw) &&
    /const isGroupChat = chat\?\.type === "group" \|\| chat\?\.type === "supergroup";/.test(webhookRaw),
);
check(
  "14.12 the member's own message is still never deleted by the finder",
  !/deleteMessage[\s\S]{0,200}message\?\.message_id/.test(
    webhookRaw.slice(senderFnStart, senderFnStart + 3000),
  ),
);
check(
  "14.13 the finder still never starts a mission on its own",
  !/linkFinderSender[\s\S]{0,2000}runMissionCommand\(/.test(webhookRaw.slice(senderFnStart, senderFnStart + 2200)),
);
check(
  "14.14 START/IGNORE authorization is unchanged: peek, live getChatMember, then resolve",
  idxMismatch >= 0 && idxMismatch < idxGetMember && idxGetMember < idxResolve,
);
check(
  "14.15 START still runs through runMissionCommand with live admin verification",
  /runMissionCommand\(\{[\s\S]{0,400}chatId: String\(candidateChatId\)/.test(lfBranch),
);

// ---------------------------------------------------------------------------
// 15. SE-7 — Link Finder reliability: real source message id, non-terminal
//     START, post-success finalization and source/prompt cleanup.
// ---------------------------------------------------------------------------
const SE7_SQL = "docs/sql/SE7_link_finder_start_finalization.sql";
check("15.1 the SE-7 migration is prepared in the repository", existsSync(SE7_SQL));
const se7Sql = read(SE7_SQL).replace(/^\s*--.*$/gm, "");

// 15.a — the (chat_id, 0) collision can never recur.
const lfFullBranch = webhookRaw.slice(
  webhookRaw.indexOf("const smStart = callbackData.match"),
  webhookRaw.indexOf("// C7.3 — Project Inbox console callbacks"),
);
check(
  "15.2 Link Finder START no longer passes a null message id",
  !/messageId: null/.test(lfFullBranch),
);
check(
  "15.3 START passes the candidate's real source message id",
  /messageId: sourceMessageId/.test(lfFullBranch),
);
check(
  "15.4 the source message id is read from the candidate row",
  /const sourceMessageId = Number\(decision\.telegram_message_id\)/.test(lfFullBranch),
);
check(
  "15.5 a missing or non-positive source message id refuses the START",
  /!Number\.isFinite\(sourceMessageId\) \|\| sourceMessageId <= 0[\s\S]{0,240}?return json\(\{ ok: true \}\);/.test(lfFullBranch),
);
check(
  "15.6 the launcher refuses a non-positive Telegram message id outright",
  /_telegram_message_id <= 0[\s\S]{0,200}invalid_telegram_identifiers/.test(se7Sql),
);
check(
  "15.7 the claim insert absorbs BOTH unique constraints",
  /ON CONFLICT DO NOTHING;\s*\n\s*GET DIAGNOSTICS v_claim_rows/.test(se7Sql),
);
check(
  "15.8 the claim insert no longer targets only the update id",
  !/ON CONFLICT \(telegram_update_id\) DO NOTHING/.test(se7Sql),
);
check(
  "15.9 an unknown update id after a collision falls through to the retry path",
  /IF COALESCE\(v_update_present, false\) THEN/.test(se7Sql) &&
    /retry path, and step 8 guarantees it cannot duplicate a mission/.test(read(SE7_SQL)),
);
// Two sequential Link Finder missions in ONE group: distinct source message
// ids mean distinct (chat, message) claims, so neither collides.
const claimKey = (chat: number, message: number) => `${chat}:${message}`;
const claims = new Set<string>();
const claimOnce = (chat: number, message: number) => {
  const key = claimKey(chat, message);
  if (claims.has(key)) return false;
  claims.add(key);
  return true;
};
check("15.10 the first Link Finder START in a group claims cleanly", claimOnce(-1003835963432, 4011));
check("15.11 a second, different Link Finder START in the SAME group also claims", claimOnce(-1003835963432, 4087));
check("15.12 the legacy null->0 shape would have collided", claimOnce(-1003835963432, 0) && !claimOnce(-1003835963432, 0));
check("15.13 a genuine replay of the same source message does not claim twice", !claimOnce(-1003835963432, 4011));

// 15.b — START authorizes but never consumes.
check(
  "15.14 the resolver leaves a START candidate PENDING",
  /IF v_decision = 'IGNORE' THEN[\s\S]{0,400}state = 'IGNORED'/.test(se7Sql),
);
check(
  "15.15 the resolver never writes STARTED",
  !/state = CASE WHEN v_decision = 'START' THEN 'STARTED'/.test(se7Sql),
);
check(
  "15.16 IGNORE is still consumed immediately",
  /state = 'IGNORED',\s*\n\s*resolved_at = now\(\)/.test(se7Sql),
);
check(
  "15.17 the resolver still requires the verified chat id and rejects a mismatch",
  /_verified_chat_id bigint/.test(se7Sql) && /'chat_mismatch'/.test(se7Sql),
);
check(
  "15.18 the resolver still revalidates linked actor and workspace operator",
  /actor_not_linked/.test(se7Sql) && /is_workspace_operator/.test(se7Sql),
);

// 15.c — finalization happens only after a confirmed, activated mission.
check(
  "15.19 a service-only finalizer exists",
  /CREATE OR REPLACE FUNCTION public\.finalize_social_mission_link_candidate_start/.test(se7Sql),
);
check(
  "15.20 the finalizer is revoked from PUBLIC, anon and authenticated",
  /REVOKE ALL ON FUNCTION public\.finalize_social_mission_link_candidate_start\(uuid, bigint, bigint, uuid\)\s*\n\s*FROM PUBLIC, anon, authenticated;/.test(se7Sql),
);
check(
  "15.21 the finalizer is the only writer of STARTED",
  /state = 'STARTED',/.test(se7Sql),
);
check(
  "15.22 a repeated finalize reports ALREADY_FINALIZED and changes nothing",
  /IF v_candidate\.state = 'STARTED' THEN[\s\S]{0,300}ALREADY_FINALIZED/.test(se7Sql),
);
check(
  "15.23 the finalizer refuses a mission not bound to this candidate",
  /mission_not_bound/.test(se7Sql),
);
check(
  "15.24 the finalizer revalidates chat, linked actor and operator authority",
  /finalize_social_mission_link_candidate_start[\s\S]{0,3000}chat_mismatch[\s\S]{0,2000}actor_not_linked[\s\S]{0,1500}is_workspace_operator/.test(se7Sql),
);

// 15.d — the webhook only finalizes/cleans up on a settled mission.
check(
  "15.25 the launcher exposes a settled callback",
  /onMissionSettled\?: \(settled: \{/.test(webhookRaw),
);
check(
  "15.26 the settled callback fires on a confirmed card plus active schedule",
  /kind: "ACTIVATED"/.test(webhookRaw),
);
check(
  "15.27 a retry finding the card already sent settles without sending again",
  /kind: "ALREADY_SENT"/.test(webhookRaw),
);
// RE-PINNED by the SE-7 hardening pass, not loosened: the order is now
// finalizer FIRST, prompt deletion only after the database agrees.
check(
  "15.28 Link Finder finalization then prompt cleanup run only inside that callback",
  /onMissionSettled: async \(settled\) => \{[\s\S]{0,900}finalize_social_mission_link_candidate_start[\s\S]{0,900}deleteLinkFinderPrompt\(\)/.test(lfFullBranch),
);

check(
  "15.29 the prompt is NOT deleted before the mission is attempted",
  lfFullBranch.indexOf("await runMissionCommand(") <
    lfFullBranch.indexOf("onMissionSettled: async (settled)") + 1 &&
    !/deleteLinkFinderPrompt\(\);\s*\n\s*await answerCallback\(TELEGRAM_BOT_TOKEN, callback\.id, "Starting the mission/.test(lfFullBranch),
);
check(
  "15.30 the candidate is finalized with the mission the launcher settled",
  /_mission_id: settled\.missionId/.test(lfFullBranch),
);

// 15.e — IGNORE never deletes the member's X post.
const ignoreBlock = lfFullBranch.slice(
  lfFullBranch.indexOf('if (decision.outcome === "IGNORE")'),
  lfFullBranch.indexOf("const sourceMessageId"),
);
check("15.31 IGNORE removes only the transient prompt", /deleteLinkFinderPrompt\(\);/.test(ignoreBlock));
check("15.32 IGNORE never deletes the source X-link message", !/sourceMessageId|telegram_message_id/.test(ignoreBlock));
check("15.33 IGNORE never launches a mission", !/runMissionCommand/.test(ignoreBlock));

// 15.f — source cleanup stays gated on confirmed send + activation, and the
// existing `/mission` command cleanup is untouched.
const cleanupBlock = webhookRaw.slice(
  webhookRaw.indexOf('const { data: activated, error: activateError } = await admin.rpc("activate_social_mission_schedule"'),
  webhookRaw.indexOf("// The branded card itself is the confirmation."),
);
check(
  "15.34 cleanup runs only after activation succeeded",
  cleanupBlock.indexOf("activationOutcome !== \"ACTIVATED\"") <
    cleanupBlock.indexOf('cfg["delete_command_after_send"]'),
);
check(
  "15.35 the trigger message is still deleted through the same gate",
  /cfg\["delete_command_after_send"\] !== false && messageId > 0/.test(cleanupBlock),
);
check(
  "15.36 deletion is still recorded durably",
  /record_social_mission_command_deleted/.test(cleanupBlock),
);
check(
  "15.37 a failed activation never reaches cleanup or the settled callback",
  /schedule could not be activated[\s\S]{0,120}return;/.test(cleanupBlock),
);

// 15.g — pin recording stays confirmation-only.
check(
  "15.38 auto-pin is still attempted after delivery (SE-8: through the idempotent helper)",
  /cfg\["auto_pin_mission"\] !== false/.test(cleanupBlock) &&
    /await ensureCanonicalMissionPin\(/.test(cleanupBlock),
);
check(
  "15.39 pinned_by_hq is recorded ONLY when Telegram confirms the pin",
  /if \(!pinned\) return false;\s*\n\s*const \{ error: recordError \} = await admin\.rpc\("record_social_mission_target_pin"/
    .test(webhookRaw),
);
check(
  "15.40 completion still unpins only a pin CARTEL HQ recorded",
  /pinned_by_hq === true/.test(webhookRaw),
);

// 15.h — both sender shapes still reach the same authorized START path.
check(
  "15.41 the ordinary human sender path is unchanged",
  /const linkFinderSender = /.test(webhookRaw),
);
check(
  "15.42 anonymous-admin sender_chat detection is still same-group only",
  /senderChat/.test(webhookRaw) && /14\.1 the sender predicate is extractable/.test(read("scripts/se6-step1-authoritative-regression.ts")),
);
check(
  "15.43 both sender shapes resolve through the SAME candidate row and START path",
  /create_social_mission_link_candidate/.test(webhookRaw) &&
    (lfFullBranch.match(/runMissionCommand\(/g) ?? []).length === 1,
);

// 15.i — no second engine, no production action prepared.
check("15.44 SE-7 creates no new table", !/CREATE TABLE/i.test(se7Sql));
check("15.45 SE-7 adds no scheduler", !/cron\.schedule/i.test(se7Sql));
check("15.46 SE-7 declares itself prepare-only", /PREPARE ONLY/.test(read(SE7_SQL)));
check("15.47 SE-7 is transactional", /^BEGIN;/m.test(se7Sql) && /COMMIT;\s*$/.test(se7Sql.trimEnd() + "\n"));

// ---------------------------------------------------------------------------
// 16. SE-7 HARDENING — cleanup/finalization ordering and database truth.
// ---------------------------------------------------------------------------
const missionFn = webhookRaw.slice(
  webhookRaw.indexOf("const runMissionCommand = async (args: {"),
  webhookRaw.indexOf("// ---- Launch Watch helpers"),
);

// 16.a — Link Finder source cleanup is MANDATORY and preference-independent.
//
//        SE-9 RE-PIN: the objective is unchanged and NOT relaxed — the original
//        X-link post must still be removed, must still ignore the workspace
//        command preference, and must still never be reported clean on an
//        unproven outcome. Only its POSITION moved: it now runs at detection,
//        immediately after the prompt is confirmed sent and attached, in the
//        dedicated `ensureLinkFinderSourceDeleted` helper.
const se9SourceHelper = webhookRaw.slice(
  webhookRaw.indexOf("const ensureLinkFinderSourceDeleted = async (params: {"),
  webhookRaw.indexOf("const runMissionCommand = async (args: {"),
);
check("16.1 a dedicated Link Finder source cleanup helper exists", se9SourceHelper.length > 200);
check(
  "16.2 the /mission launch path no longer performs Link Finder source cleanup",
  !/ensureLinkFinderSourceCleanup|ensureLinkFinderSourceDeleted/.test(missionFn),
);
check(
  "16.3 Link Finder cleanup does NOT consult delete_command_after_send",
  !/delete_command_after_send/.test(se9SourceHelper),
);
check(
  "16.4 the /mission command cleanup keeps the workspace preference",
  /if \(!isLinkFinder && cfg\["delete_command_after_send"\] !== false && messageId > 0\)/.test(missionFn),
);
check(
  "16.5 a durably recorded deletion costs no Telegram call at all",
  /if \(params\.alreadyDeletedAt\) return true;/.test(se9SourceHelper) &&
    se9SourceHelper.indexOf("params.alreadyDeletedAt") < se9SourceHelper.indexOf("deleteMessage"),
);
check(
  "16.6 a definitive Telegram 'already gone' satisfies the objective",
  /removed = \/message to delete not found\|message_id_invalid\/i\.test\(reason\);/.test(se9SourceHelper),
);
check(
  "16.7 a permission/transport failure does NOT count as clean",
  /if \(!removed\) \{[\s\S]{0,200}return false;/.test(se9SourceHelper),
);
check(
  "16.8 successful cleanup is recorded through the durable candidate RPC",
  /record_social_mission_link_candidate_source_cleanup/.test(se9SourceHelper),
);
check(
  "16.9 cleanup only reports clean when the recording persisted",
  /if \(recordError \|\| \(outcome !== "CLEAN" && outcome !== "ALREADY_CLEAN"\)\) \{[\s\S]{0,300}return false;/
    .test(se9SourceHelper),
);

// 16.b — fresh ACTIVATED path ordering: pin -> settled -> finalize -> prompt.
const idxActivate = missionFn.indexOf("activate_social_mission_schedule");
// lastIndexOf: the first `kind: "ACTIVATED"` is the callback's TYPE union.
const idxActivatedSettle = missionFn.lastIndexOf('kind: "ACTIVATED"');
const idxCleanupCall = missionFn.indexOf("const canonicalPinned = await ensureCanonicalMissionPin(");

check("16.10 the required objective runs after schedule activation", idxActivate > 0 && idxActivate < idxCleanupCall);
check("16.11 it runs BEFORE the settled callback", idxCleanupCall > 0 && idxCleanupCall < idxActivatedSettle);
check(
  "16.12 the settled callback fires only when the required pin is confirmed",
  /if \(canonicalPinned\) \{\s*\n\s*await args\.onMissionSettled\?\.\(\{\s*\n\s*kind: "ACTIVATED"/.test(missionFn),
);
check(
  "16.13 it sits OUTSIDE the best-effort housekeeping try/catch",
  idxCleanupCall > missionFn.indexOf("// Cosmetic housekeeping only; never surfaced and never retried."),
);

const settledCb = webhookRaw.slice(
  webhookRaw.indexOf("onMissionSettled: async (settled) => {"),
  webhookRaw.indexOf("return json({ ok: true });", webhookRaw.indexOf("onMissionSettled: async (settled) => {")),
);
check(
  "16.14 the finalizer is called BEFORE the prompt is deleted",
  settledCb.indexOf("finalize_social_mission_link_candidate_start") <
    settledCb.indexOf("await deleteLinkFinderPrompt();"),
);
check(
  "16.15 the finalizer RPC error is actually inspected",
  /const \{ data: finalized, error: finalizeError \} = await admin\.rpc\(/.test(settledCb),
);
check(
  "16.16 only FINALIZED or a same-mission ALREADY_FINALIZED counts",
  /finalOutcome === "FINALIZED"[\s\S]{0,200}finalOutcome === "ALREADY_FINALIZED"[\s\S]{0,200}String\(finalization\.mission_id \?\? ""\) === settled\.missionId/.test(settledCb),
);
check(
  "16.17 a failed or rejected finalization leaves the prompt in place",
  /if \(finalizeError \|\| !sameMission\) return;/.test(settledCb),
);

// 16.c — ALREADY_SENT retry: cleanup first, no second card.
const alreadySentBranch = missionFn.slice(
  missionFn.indexOf('if (deliveryState === "SENT") {'),
  missionFn.indexOf('if (deliveryState === "SENDING"'),
);
check(
  "16.18 the retry branch resolves the required pin before settling",
  alreadySentBranch.indexOf("ensureCanonicalMissionPin") > 0 &&
    alreadySentBranch.indexOf("ensureCanonicalMissionPin") <
      alreadySentBranch.indexOf('kind: "ALREADY_SENT"'),
);
check(
  "16.19 the retry only settles when the required pin succeeded",
  /if \(retryPinned\) \{/.test(alreadySentBranch) &&
    // SE-9 TRIPWIRE: the retry must never regain a source-deletion gate.
    !/ensureLinkFinderSourceCleanup|ensureLinkFinderSourceDeleted/.test(alreadySentBranch),
);
check(
  "16.20 the retry never sends a second card",
  !/send_mission/.test(alreadySentBranch) && !/social-mission-telegram/.test(alreadySentBranch),
);
check(
  "16.21 the retry never re-activates or re-pins",
  !/activate_social_mission_schedule|pinChatMessage/.test(alreadySentBranch),
);

// 16.d — finalizer enforces database truth.
const se7Raw = read(SE7_SQL);
const se7Hardened = se7Raw.replace(/^\s*--.*$/gm, "");
const finalizerSql = se7Hardened.slice(
  se7Hardened.indexOf("CREATE OR REPLACE FUNCTION public.finalize_social_mission_link_candidate_start"),
  se7Hardened.indexOf("REVOKE ALL ON FUNCTION public.finalize_social_mission_link_candidate_start"),
);
check(
  "16.22 ALREADY_FINALIZED requires the SAME mission id",
  /v_candidate\.mission_id IS DISTINCT FROM _mission_id[\s\S]{0,200}'mission_mismatch'/.test(finalizerSql),
);
check(
  "16.23 a first finalization requires the target to be SENT",
  /v_delivery_state IS DISTINCT FROM 'SENT'[\s\S]{0,200}'card_not_sent'/.test(finalizerSql),
);
check(
  "16.24 a first finalization requires a persisted ends_at",
  /v_ends_at IS NULL[\s\S]{0,200}'schedule_not_active'/.test(finalizerSql),
);
check(
  "16.25 schedule proof uses the durable COMPLETE event for this target",
  /social_mission_schedule_events[\s\S]{0,300}e\.event_type = 'COMPLETE'/.test(finalizerSql),
);
check(
  "16.26 the finalizer invents no new scheduler",
  !/cron\.schedule|pg_net/.test(finalizerSql),
);
check(
  "16.27 all existing actor/chat/operator/workspace checks survive",
  /chat_mismatch/.test(finalizerSql) && /actor_not_linked/.test(finalizerSql) &&
    /is_workspace_operator/.test(finalizerSql) && /mission_not_bound/.test(finalizerSql),
);
check(
  "16.28 the finalizer stays service-only",
  /REVOKE ALL ON FUNCTION public\.finalize_social_mission_link_candidate_start\(uuid, bigint, bigint, uuid\)\s*\n\s*FROM PUBLIC, anon, authenticated;/.test(se7Hardened) &&
    /GRANT EXECUTE ON FUNCTION public\.finalize_social_mission_link_candidate_start\(uuid, bigint, bigint, uuid\) TO service_role;/.test(se7Hardened),
);

// 16.e — concurrency: two simultaneous callbacks cannot make two missions.
check(
  "16.29 a transaction-scoped advisory lock serializes same (workspace, post, chat)",
  /PERFORM pg_advisory_xact_lock\(/.test(se7Hardened),
);
check(
  "16.30 the lock key is exactly the workspace, post and chat tuple",
  /hashtextextended\(v_workspace_id::text \|\| ':' \|\| v_post_external \|\| ':' \|\| _telegram_chat_id::text, 0\)/.test(se7Hardened),
);
check(
  "16.31 the lock is taken BEFORE the get-or-create post and mission lookup",
  se7Hardened.indexOf("pg_advisory_xact_lock") < se7Hardened.indexOf("INSERT INTO public.social_posts"),
);
check(
  "16.32 the loser still returns the winner's mission, never a duplicate",
  /'outcome', 'EXISTING',\s*\n\s*'reason', 'mission_already_exists'/.test(se7Hardened),
);
// Pure model of the serialized retry: one mission per (workspace, post, chat).
const missions = new Map<string, string>();
const getOrCreateMission = (key: string, id: string) => {
  if (!missions.has(key)) missions.set(key, id);
  return missions.get(key)!;
};
const tupleKey = "ws-1:2095597789229056360:-1003835963432";
check("16.33 the first serialized caller creates the mission", getOrCreateMission(tupleKey, "m-1") === "m-1");
check("16.34 a concurrent second caller reuses it", getOrCreateMission(tupleKey, "m-2") === "m-1");
check("16.35 exactly one mission exists for the tuple", missions.size === 1);

// 16.f — preserved invariants.
check(
  "16.36 IGNORE still never deletes the source X-link message",
  !/sourceMessageId|ensureLinkFinderSourceCleanup/.test(
    lfFullBranch.slice(
      lfFullBranch.indexOf('if (decision.outcome === "IGNORE")'),
      lfFullBranch.indexOf("const sourceMessageId"),
    ),
  ),
);
check(
  "16.37 pin recording is still confirmation-only",
  /if \(!pinned\) return false;\s*\n\s*const \{ error: recordError \} = await admin\.rpc\("record_social_mission_target_pin"/
    .test(missionFn),
);
check(
  "16.38 START still remains PENDING until finalization",
  !/state = CASE WHEN v_decision = 'START' THEN 'STARTED'/.test(se7Hardened),
);
check(
  "16.39 the detection comment no longer claims the member post is never deleted",
  !/never\s*\n?\s*\/\/ deletes the member's message/.test(webhookRaw),
);
check(
  "16.40 SE-7 still creates no table and adds no scheduler",
  !/CREATE TABLE/i.test(se7Hardened) && !/cron\.schedule/i.test(se7Hardened),
);

// ---------------------------------------------------------------------------
// 17. SE-8 — live bot permission preflight + idempotent canonical pin.
// ---------------------------------------------------------------------------

// 17.a — the preflight itself.
check(
  "17.1 a live bot permission reader exists",
  /async function readBotChatPermissions\(\s*\n\s*token: string,\s*\n\s*chatId: string \| number,\s*\n\): Promise<BotChatPermissions>/.test(webhookRaw),
);
check(
  "17.2 it resolves the bot's own id through getMe and caches it",
  /cachedBotUserId/.test(webhookRaw) && /telegramJson\(token, "getMe"\)/.test(webhookRaw),
);
check(
  "17.3 it reads the live membership with getChatMember for the bot",
  /telegramJson\(token, "getChatMember", \{ chat_id: chatId, user_id: botId \}\)/.test(webhookRaw),
);
check(
  "17.4 an unreachable Telegram is never treated as permission granted",
  /resolved: false,\s*\n\s*status: "",\s*\n\s*isAdmin: false,\s*\n\s*canDeleteMessages: false,\s*\n\s*canPinMessages: false,/.test(webhookRaw),
);
check(
  "17.5 a creator implicitly holds delete and pin rights",
  /canDeleteMessages: creator \|\| \(isAdmin && row\.can_delete_messages === true\)/.test(webhookRaw) &&
    /canPinMessages: creator \|\| \(isAdmin && row\.can_pin_messages === true\)/.test(webhookRaw),
);

// 17.b — the preflight runs BEFORE anything is created or recovered.
const idxPreflight = missionFn.indexOf("const botPermissions = await readBotChatPermissions(");
const idxCreateRpc = missionFn.indexOf('admin.rpc("create_social_mission_from_telegram_link"');
check("17.6 the preflight runs before the mission-creation RPC", idxPreflight > 0 && idxPreflight < idxCreateRpc);
check(
  "17.7 a missing right returns before any mission exists",
  /if \(missingRights\.length > 0\) \{[\s\S]{0,400}await blockLaunch\([\s\S]{0,300}return;/.test(missionFn),
);
check(
  "17.8 Link Finder ALWAYS requires delete, regardless of the preference",
  /const deletionRequired = isLinkFinder\s*\n\s*\? true\s*\n\s*: workspaceSettings\?\.delete_command_after_send !== false;/.test(missionFn),
);
check(
  "17.9 auto-pin defaults ON, so pin rights are required by default",
  /const autoPinRequired = workspaceSettings\?\.auto_pin_mission !== false;/.test(missionFn),
);
check(
  "17.10 pin rights are NOT required when auto-pin is disabled",
  /if \(autoPinRequired && !botPermissions\.canPinMessages\) missingRights\.push\("Pin Messages"\);/.test(missionFn),
);
check(
  "17.11 delete rights are NOT required when no cleanup is required",
  /if \(deletionRequired && !botPermissions\.canDeleteMessages\) missingRights\.push\("Delete Messages"\);/.test(missionFn),
);
check(
  "17.12 the workspace preferences come from social_mission_settings",
  /\.from\("social_mission_settings"\)\s*\n\s*\.select\("delete_command_after_send, auto_pin_mission"\)/.test(missionFn),
);
check(
  "17.13 a non-admin bot is refused with a precise message",
  /needs @\$\{BOT_USERNAME\} to be an administrator/.test(missionFn),
);
check(
  "17.14 the refusal names the exact missing Telegram rights",
  /CARTEL HQ needs \$\{missingRights\.join\(" and "\)\} enabled for @\$\{BOT_USERNAME\}/.test(missionFn),
);
check(
  "17.15 actor authorization is untouched — the operator and live admin checks remain",
  /is_workspace_operator|telegram_operator/.test(webhookRaw) && /getChatMember/.test(missionFn) === false
    ? true
    : /getChatMember/.test(webhookRaw),
);

// 17.c — only non-sensitive diagnostics are persisted.
const diagBlock = missionFn.slice(
  missionFn.indexOf("bot_permissions_checked_at"),
  missionFn.indexOf("const blockLaunch"),
);
check(
  "17.16 diagnostics persist into the existing group connection metadata",
  /\.from\("telegram_group_connections"\)\s*\n\s*\.update\(\{\s*\n\s*metadata: \{/.test(missionFn),
);
check(
  "17.17 diagnostics are only status, booleans and a timestamp",
  /bot_status: botPermissions\.status/.test(diagBlock) &&
    /bot_is_admin: botPermissions\.isAdmin/.test(diagBlock) &&
    /bot_can_delete_messages: botPermissions\.canDeleteMessages/.test(diagBlock) &&
    /bot_can_pin_messages: botPermissions\.canPinMessages/.test(diagBlock),
);
check(
  "17.18 no token, key, header or raw payload is ever persisted or logged",
  !/TELEGRAM_BOT_TOKEN|SERVICE_ROLE|apikey|Authorization/i.test(diagBlock),
);
check(
  "17.19 diagnostics never change or block the decision",
  /\} catch \{\s*\n\s*\/\/ Diagnostics are never allowed to block or alter the decision below\./.test(missionFn),
);
check(
  "17.20 diagnostic reasons are bounded and whitespace-normalized",
  /function boundedReason\(value: unknown\): string \{\s*\n\s*return String\(value \?\? ""\)\.replace\(\/\\s\+\/g, " "\)\.slice\(0, 200\);/.test(webhookRaw),
);

// 17.d — the idempotent canonical pin helper.
const pinHelper = missionFn.slice(
  missionFn.indexOf("const ensureCanonicalMissionPin = async ("),
  missionFn.indexOf("// SE-4B — `/mission close`"),
);
check(
  "17.21 an idempotent canonical pin helper exists",
  /const ensureCanonicalMissionPin = async \(/.test(missionFn),
);
check(
  "17.22 an auto-pin-disabled mission needs no pin at all",
  /if \(!autoPinEnabled\) return true;/.test(pinHelper),
);
check(
  "17.23 an already-pinned target costs no Telegram call",
  pinHelper.indexOf("if (target?.pinned_by_hq === true) return true;") <
    pinHelper.indexOf('telegramJson(TELEGRAM_BOT_TOKEN, "pinChatMessage"'),
);
check(
  "17.24 the pinned message is the stored canonical card id",
  /\.select\("pinned_by_hq, telegram_message_id"\)/.test(pinHelper) &&
    /message_id: cardMessageId/.test(pinHelper),
);
check(
  "17.25 the source post and the prompt are never pinned",
  !/sourceMessageId|promptMessageId/.test(pinHelper),
);
check(
  "17.26 only a definitive Telegram 'nothing changed' counts as already pinned",
  /message is not modified\|chat not modified\|chat_not_modified/.test(pinHelper),
);
check(
  "17.27 a refusal or transport failure is false, never success",
  /if \(!pinned\) return false;/.test(pinHelper),
);
check(
  "17.28 the pin is recorded only after confirmed Telegram success",
  pinHelper.indexOf("if (!pinned) return false;") <
    pinHelper.indexOf('record_social_mission_target_pin'),
);
check(
  "17.29 a pin that could not be persisted is reported as failed",
  /if \(recordError\) \{[\s\S]{0,300}return false;/.test(pinHelper),
);

// 17.e — fresh path settles only after BOTH objectives.
const idxPinCall = missionFn.indexOf("const canonicalPinned = await ensureCanonicalMissionPin(");
check("17.30 the canonical pin runs after schedule activation", idxActivate < idxPinCall);
check("17.31 the canonical pin runs before the settled callback", idxPinCall > 0 && idxPinCall < idxActivatedSettle);
check(
  "17.32 an unconfirmed required objective leaves the candidate PENDING and the prompt intact",
  /if \(canonicalPinned\) \{/.test(missionFn),
);
check(
  "17.33 a pin failure blocks settlement and is reported",
  /canonical lifecycle incomplete: pin=\$\{canonicalPinned\}/.test(missionFn),
);
check(
  "17.34 the required pin uses the mission's OWN immutable effective config",
  /const autoPinEnabled = cfg\["auto_pin_mission"\] !== false;/.test(missionFn),
);

// 17.f — ALREADY_SENT recovery retries both objectives, creates nothing new.
const retryBranch = missionFn.slice(
  missionFn.indexOf('if (deliveryState === "SENT") {'),
  missionFn.indexOf('if (deliveryState === "SENDING"'),
);
check(
  "17.35 the retry re-attempts nothing beyond the idempotent pin",
  !/ensureLinkFinderSourceCleanup|ensureLinkFinderSourceDeleted|deleteMessage/.test(retryBranch),
);
check(
  "17.36 the retry re-attempts the canonical pin idempotently",
  /const retryPinned = await ensureCanonicalMissionPin\(retryTargetId, retryAutoPin, null\);/.test(retryBranch),
);
check(
  "17.37 the retry never sends a second card",
  !/send_mission|social-mission-telegram/.test(retryBranch),
);
check(
  "17.38 the retry never re-activates the schedule or creates duplicate events",
  !/activate_social_mission_schedule|social_mission_schedule_events|create_social_mission_from_telegram_link/.test(retryBranch),
);
check(
  "17.39 the retry never issues a raw pin call of its own",
  !/pinChatMessage/.test(retryBranch),
);
check(
  "17.40 an incomplete recovery is reported, not silently swallowed",
  /already-sent recovery incomplete: pin=\$\{retryPinned\}/.test(retryBranch),
);

// 17.g — START latency UX without weakening the first real snapshot.
const startBranch = lfFullBranch.slice(lfFullBranch.indexOf("const sourceMessageId"));
check(
  "17.41 the blanket pre-acknowledgement is gone",
  !/Starting the mission…/.test(webhookRaw),
);
check(
  "17.42 START acknowledges the real live-metric latency, without claiming success",
  /"Starting mission… fetching live X metrics\."/.test(startBranch),
);
check(
  "17.43 the acknowledgement fires only AFTER the preflight passed",
  missionFn.indexOf("await args.onStartAccepted?.();") > idxPreflight &&
    missionFn.indexOf("await args.onStartAccepted?.();") < idxCreateRpc,
);
check(
  // SE-10 RE-PIN, NOT RELAXED: the callback is still answered with the exact
  // same precise reason text. The handler now also receives the structured
  // `detail` so the SAME prompt can render the missing right visibly first.
  "17.44 a blocked preflight answers the callback with the precise reason",
  /onPermissionBlocked: async \(text, detail\) => \{[\s\S]{0,300}await answerCallback\(TELEGRAM_BOT_TOKEN, callback\.id, text\);/.test(startBranch),
);
check(
  "17.45 feedback stays in the callback — no extra group message is posted",
  !/sendMessage\(TELEGRAM_BOT_TOKEN/.test(
    startBranch.slice(0, startBranch.indexOf("onMissionSettled:")),
  ),
);
check(
  "17.46 Link Finder detection still performs ZERO X reads",
  !/x-metrics|fetchXMetrics|social_read/i.test(
    webhookRaw.slice(webhookRaw.indexOf("create_social_mission_link_candidate") - 2000,
      webhookRaw.indexOf("create_social_mission_link_candidate") + 2000),
  ),
);
check(
  "17.47 the webhook still reads no X metric of its own — the card's real snapshot is server-side",
  !/api\.twitter\.com|api\.x\.com|x_metrics|fetchXMetrics/i.test(webhookRaw),
);
check(
  "17.48 exactly one runMissionCommand call still exists in the Link Finder branch",
  (lfFullBranch.match(/runMissionCommand\(/g) ?? []).length === 1,
);
check(
  "17.49 the prompt is still deleted only after same-mission finalization",
  settledCb.indexOf("finalize_social_mission_link_candidate_start") <
    settledCb.indexOf("await deleteLinkFinderPrompt();"),
);
check(
  "17.50 SE-8 adds no table, no scheduler and no new migration",
  !/CREATE TABLE/i.test(missionFn) && !/cron\.schedule/i.test(webhookRaw),
);

// ---------------------------------------------------------------------------
// 18. SE-8.1 — Link Finder recovery leaves no extra group text.
// ---------------------------------------------------------------------------
const alreadySentBranch81 = missionFn.slice(
  missionFn.indexOf('if (deliveryState === "SENT") {'),
  missionFn.indexOf('if (deliveryState === "SENDING"'),
);
check(
  "18.1 the already-exists group reply is gated on a non-Link-Finder source",
  /if \(!isLinkFinder\) \{\s*await reply\("This post already has a Social Mission in this community\."\);\s*\}/
    .test(alreadySentBranch81),
);
check(
  "18.2 the SENT recovery branch contains no ungated group reply",
  (alreadySentBranch81.match(/await reply\(/g) ?? []).length === 1,
);
check(
  "18.3 non-Link-Finder SENT retry may still receive the already-exists reply",
  alreadySentBranch81.includes("This post already has a Social Mission in this community."),
);
check(
  "18.4 the gate sits after the settle decision so recovery ordering is unchanged",
  alreadySentBranch81.indexOf('kind: "ALREADY_SENT"') < alreadySentBranch81.indexOf("if (!isLinkFinder)"),
);
check(
  "18.5 SE-8.1 does not alter the required pin in the recovery branch",
  /const retryPinned = await ensureCanonicalMissionPin\(retryTargetId, retryAutoPin, null\);/.test(
    alreadySentBranch81,
  ),
);
check(
  "18.6 the incomplete-recovery path stays diagnostic only, with no group message",
  /console\.warn\(\s*`\[SE-9\] already-sent recovery incomplete/.test(alreadySentBranch81),
);

// ---------------------------------------------------------------------------
// 19. SE-9 — LINK FINDER CANONICAL FLOW CORRECTION.
//
//     The original X-link post is deleted at DETECTION, immediately after the
//     transient prompt is confirmed sent AND attached. A later START posts a
//     genuinely NEW branded card at the current chat position whenever every
//     prior mission for the same (workspace, post, community) is terminal, and
//     still refuses to duplicate a non-terminal one.
// ---------------------------------------------------------------------------
const SE9_SQL = "docs/sql/SE9_link_finder_canonical_flow.sql";
check("19.0 the SE-9 migration is prepared in the repository", existsSync(SE9_SQL));
const se9Raw = read(SE9_SQL);
const se9Sql = se9Raw.replace(/^\s*--.*$/gm, "");

const detectionBranch = webhookRaw.slice(
  webhookRaw.indexOf("const { data: candidate } = await admin.rpc(\"create_social_mission_link_candidate\""),
  webhookRaw.indexOf("const isHelp = /^\\/help"),
);

// 19.1 — prompt success -> deletion attempted immediately, then recorded.
check(
  "19.1a the source deletion is attempted at detection, after the prompt is attached",
  detectionBranch.indexOf("attach_social_mission_link_prompt") <
    detectionBranch.indexOf("ensureLinkFinderSourceDeleted"),
);
check(
  "19.1b the Telegram deletion precedes the durable recording",
  se9SourceHelper.indexOf("deleteMessage") <
    se9SourceHelper.indexOf("record_social_mission_link_candidate_source_cleanup"),
);
check(
  "19.1c the durable record is written for BOTH outcomes, never skipped",
  /_deleted: removed,/.test(se9SourceHelper),
);

// 19.2 — prompt send/attach failure -> the member's post is untouched.
check(
  "19.2a attachment success is the actual RPC result, not an assumption",
  /promptAttached = !attachError && attached === true;/.test(detectionBranch),
);
check(
  "19.2b the deletion is gated on that confirmed attachment",
  /if \(promptAttached\) \{\s*\n\s*await ensureLinkFinderSourceDeleted\(\{/.test(detectionBranch),
);
check(
  "19.2c a failed prompt send leaves promptAttached false",
  /let promptAttached = false;/.test(detectionBranch) &&
    /const prompt = await telegramJson\([\s\S]{0,1200}\.catch\(\(\) => null\);/.test(detectionBranch),
);

// 19.3 — IGNORE removes the prompt only and never restores the source.
const ignoreBranch = lfFullBranch.slice(
  lfFullBranch.indexOf('if (decision.outcome === "IGNORE")'),
  lfFullBranch.indexOf("const sourceMessageId"),
);
check("19.3a IGNORE deletes the transient prompt", /deleteLinkFinderPrompt\(\)/.test(ignoreBranch));
check(
  "19.3b IGNORE never reposts, forwards or copies the original link",
  !/sendMessage|copyMessage|forwardMessage|sendPhoto/.test(ignoreBranch),
);
check(
  "19.3c IGNORE never launches a mission",
  !/runMissionCommand|create_social_mission_from_telegram_link/.test(ignoreBranch),
);

// 19.4 — deleted source + START -> new card, schedule, pin, finalize, prompt.
const startBranchSe9 = lfFullBranch.slice(lfFullBranch.indexOf("const sourceMessageId"));
check(
  "19.4a START consults the durable source state instead of blind-deleting",
  /alreadyDeletedAt: decision\.source_deleted_at \?\? null,/.test(startBranchSe9),
);
check(
  "19.4b the resolver exposes that durable state",
  /'source_deleted_at', v_candidate\.source_deleted_at,/.test(se9Raw),
);
check(
  "19.4c START still reuses the one authorized \\/mission pipeline",
  /await runMissionCommand\(\{/.test(startBranchSe9),
);
check(
  "19.4d the settled callback still finalizes before the prompt is deleted",
  settledCb.indexOf("finalize_social_mission_link_candidate_start") <
    settledCb.indexOf("deleteLinkFinderPrompt"),
);

// 19.5 / 19.6 — the duplicate rule.
const createSql = se9Sql.slice(
  se9Sql.indexOf("CREATE OR REPLACE FUNCTION public.create_social_mission_from_telegram_link"),
);
check(
  "19.5a terminal history no longer blocks a fresh mission",
  /AND m\.status IN \('DRAFT', 'LIVE'\)/.test(createSql),
);
check(
  "19.5b COMPLETED is NOT part of the blocking set",
  !/status IN \([^)]*'COMPLETED'/.test(createSql),
);
check(
  "19.5c historical mission rows are never deleted or mutated by the rule",
  !/DELETE FROM public\.social_missions|UPDATE public\.social_missions\s+SET status/.test(createSql),
);
check(
  "19.6a a LIVE mission still blocks a duplicate",
  /'LIVE'/.test(createSql.slice(createSql.indexOf("AND m.status IN"), createSql.indexOf("AND m.status IN") + 60)),
);
check(
  "19.6b ACCOMPLISHED is a derived state of LIVE, so it blocks too",
  !/ACCOMPLISHED/.test(createSql.slice(createSql.indexOf("AND m.status IN"), createSql.indexOf("AND m.status IN") + 60)) &&
    /accomplished_at/.test(se5Sql),
);
check(
  "19.6c social_posts uniqueness is untouched by SE-9",
  !/social_posts/.test(se9Raw.slice(0, se9Raw.indexOf("CREATE OR REPLACE FUNCTION public.resolve_social_mission_link_candidate"))) &&
    !/DROP\s+(?:INDEX|CONSTRAINT)/i.test(se9Sql),
);

// Pure duplicate-rule simulation: terminal history repeats, non-terminal never.
const TERMINAL = new Set(["COMPLETED", "CANCELLED", "FAILED"]);
const startFor = (history: string[]) =>
  history.some((status) => !TERMINAL.has(status)) ? "EXISTING" : "CREATED";
check("19.5d no history at all creates a mission", startFor([]) === "CREATED");
check("19.5e one COMPLETED mission allows a fresh one", startFor(["COMPLETED"]) === "CREATED");
check(
  "19.5f many COMPLETED missions still allow a fresh one",
  startFor(["COMPLETED", "COMPLETED", "COMPLETED"]) === "CREATED",
);
check("19.6d a LIVE mission refuses a second one", startFor(["COMPLETED", "LIVE"]) === "EXISTING");
check("19.6e a DRAFT mission refuses a second one", startFor(["DRAFT"]) === "EXISTING");

// 19.7 — double START / webhook retry.
check(
  "19.7a same (workspace, post, chat) taps are serialized by the advisory lock",
  /pg_advisory_xact_lock/.test(createSql),
);
check(
  "19.7b the loser takes the EXISTING path, which sends no second card",
  !/send_mission|social-mission-telegram/.test(retryBranch),
);
check(
  "19.7c the EXISTING path creates no second schedule or Pulse events",
  !/activate_social_mission_schedule|social_mission_schedule_events/.test(retryBranch),
);

// 19.8 — pin failure after send.
check(
  "19.8a a failed pin blocks finalization, keeping the candidate retryable",
  /if \(canonicalPinned\) \{/.test(missionFn),
);
check(
  "19.8b recovery re-pins the SAME stored card, never a new one",
  /const retryPinned = await ensureCanonicalMissionPin\(retryTargetId, retryAutoPin, null\);/.test(retryBranch),
);
check(
  "19.8c auto-pin disabled makes the pin a no-op success, not a blocker",
  /if \(!autoPinEnabled\) return true;/.test(webhookRaw),
);

// 19.9 — source-deletion failure at detection.
check(
  "19.9a the failure is persisted as a bounded, secret-free diagnostic",
  /left\(coalesce\(v_reason, 'source deletion failed'\), 200\)/.test(se9Raw) &&
    /boundedReason\(\(error as Error\)\?\.message\)/.test(se9SourceHelper),
);
check(
  "19.9b an already-clean candidate is immutable and never rewritten",
  /'ALREADY_CLEAN'/.test(se9Raw),
);
check(
  "19.9c START re-attempts the deletion BEFORE anything is created",
  startBranchSe9.indexOf("ensureLinkFinderSourceDeleted") <
    startBranchSe9.indexOf("await runMissionCommand({"),
);
check(
  "19.9d a still-failing deletion creates nothing and answers precisely",
  /if \(!sourceReady\) \{[\s\S]{0,900}Delete Messages admin right[\s\S]{0,200}return json\(\{ ok: true \}\);/
    .test(startBranchSe9),
);
check(
  "19.9e the cleanup recorder never resolves or consumes the candidate",
  !/state\s*=\s*'(?:STARTED|IGNORED|RESOLVED)'/.test(
    se9Raw.slice(
      se9Raw.indexOf("CREATE OR REPLACE FUNCTION public.record_social_mission_link_candidate_source_cleanup"),
      se9Raw.indexOf("REVOKE ALL ON FUNCTION public.record_social_mission_link_candidate_source_cleanup"),
    ),
  ),
);

// 19.10 — anonymous-admin Link Finder detection is untouched.
check(
  "19.10a the anonymous-admin sender_chat path still qualifies",
  /sender_chat/.test(webhookRaw) && /posterId/.test(webhookRaw),
);
check(
  "19.10b detection still requires a connected group chat type",
  /\(chat\?\.type === "group" \|\| chat\?\.type === "supergroup"\)/.test(detectionBranch) ||
    /\(chat\?\.type === "group" \|\| chat\?\.type === "supergroup"\)/.test(webhookRaw),
);
check(
  "19.10c START still requires a linked operator AND live Telegram admin status",
  /getChatMember/.test(lfFullBranch) &&
    /lfStatus !== "administrator" && lfStatus !== "creator"/.test(lfFullBranch),
);

// 19.11 — raw /mission behaviour unchanged.
check(
  "19.11a raw /mission cleanup still honours the workspace preference",
  /if \(!isLinkFinder && cfg\["delete_command_after_send"\] !== false && messageId > 0\)/.test(missionFn),
);
check(
  "19.11b raw /mission never runs Link Finder source cleanup",
  !/ensureLinkFinderSourceDeleted/.test(missionFn),
);
check(
  "19.11c a non-Link-Finder SENT retry still receives the already-exists reply",
  alreadySentBranch81.includes("This post already has a Social Mission in this community."),
);

// 19.12 — the prepared migration stays surgical.
check("19.12a SE-9 is transactional", /^BEGIN;/m.test(se9Raw) && /^COMMIT;/m.test(se9Raw));
check("19.12b SE-9 creates no table and no scheduler", !/CREATE TABLE/i.test(se9Sql) && !/cron\.schedule/i.test(se9Sql));
check(
  "19.12c the new candidate columns are additive and nullable",
  /ADD COLUMN IF NOT EXISTS source_deleted_at timestamptz;/.test(se9Raw) &&
    /ADD COLUMN IF NOT EXISTS source_cleanup_error text;/.test(se9Raw) &&
    !/NOT NULL/.test(se9Raw.slice(se9Raw.indexOf("ALTER TABLE public.social_mission_link_candidates"), se9Raw.indexOf("CREATE OR REPLACE FUNCTION public.record_social_mission_link_candidate_source_cleanup"))),
);
check(
  "19.12d the new recorder is service-role only",
  /REVOKE ALL ON FUNCTION public\.record_social_mission_link_candidate_source_cleanup\(uuid, boolean, text\)\s*\n\s*FROM PUBLIC, anon, authenticated;/
    .test(se9Raw),
);
check(
  "19.12e SE-9 does not redefine the SE-7 finalizer",
  !/CREATE OR REPLACE FUNCTION public\.finalize_social_mission_link_candidate_start/.test(se9Raw),
);
check(
  "19.12f the resolver keeps its SE-7 chat binding and authorization",
  /'chat_mismatch'/.test(se9Raw) && /_verified_chat_id/.test(se9Raw),
);

// ---------------------------------------------------------------------------
// 20. SE-10 — START FEEDBACK + PERMISSION UX.
//
//     Every new visible state EDITS the one existing transient prompt. No new
//     group message is created, no state claims success, the candidate stays
//     PENDING while a required right is missing, and the settled launch still
//     deletes the prompt exactly as SE-9 does.
// ---------------------------------------------------------------------------
const se10Branch = webhookRaw.slice(
  webhookRaw.indexOf("const smStart = callbackData.match"),
  webhookRaw.indexOf("// C7.3 — Project Inbox console callbacks"),
);
const se10StartCall = se10Branch.slice(se10Branch.indexOf("await runMissionCommand({"));

// 20.1 — the starting state is an in-place edit of the SAME prompt.
check(
  "20.1a a starting state is shown when the launch actually begins",
  /onStartAccepted: async \(\) => \{[\s\S]{0,200}showStartingPrompt\(\)/.test(se10StartCall),
);
check(
  "20.1b the starting state names permissions and live X metrics honestly",
  /Starting Social Mission…[\s\S]{0,160}Checking bot permissions and fetching live X metrics/.test(se10Branch),
);
check(
  "20.1c every prompt state is an edit of the existing prompt message",
  /const editLinkFinderPrompt = async \(text: string, startLabel: string\) => \{[\s\S]{0,400}editMessage\(/.test(se10Branch) &&
    /if \(promptMessageId === null\) return;/.test(se10Branch),
);
check(
  "20.1d no new group message is created for any SE-10 state",
  !/showStartingPrompt[\s\S]{0,400}sendMessage\(/.test(se10Branch) &&
    (se10Branch.match(/sendMessage/g) ?? []).length === 0,
);
check(
  "20.1e the starting state keeps inline controls with the same callback route",
  /callback_data: `sm_lf_start_\$\{candidateId\}`/.test(se10Branch) &&
    /callback_data: `sm_lf_ignore_\$\{candidateId\}`/.test(se10Branch),
);
check(
  "20.1f the starting state never claims the mission succeeded",
  !/started successfully|mission is live/i.test(se10Branch),
);

// 20.2 — the permission warning is visible, exact and retryable.
check(
  "20.2a a blocked preflight edits the same prompt before answering the tap",
  se10StartCall.indexOf("showPermissionPrompt(text, detail)") <
    se10StartCall.indexOf("await answerCallback(TELEGRAM_BOT_TOKEN, callback.id, text)"),
);
check(
  "20.2b the warning states the exact missing permission(s) dynamically",
  /Missing: \$\{escapeHtml\(missing\.join\(", "\)\)\}/.test(se10Branch),
);
check(
  "20.2c both missing rights are rendered when both are missing",
  /enable \$\{escapeHtml\(missing\.join\(" and "\)\)\}/.test(se10Branch),
);
check(
  "20.2d the missing rights are computed live from the real preflight",
  /missingRights\.push\("Delete Messages"\)/.test(missionFn) &&
    /missingRights\.push\("Pin Messages"\)/.test(missionFn) &&
    /\{ kind: "MISSING_RIGHTS", missing: missingRights \}/.test(missionFn),
);
check(
  "20.2e the warning carries a RETRY START control on the same prompt",
  (se10Branch.match(/"RETRY START"/g) ?? []).length >= 3,
);
check("20.2f IGNORE remains available in every state", /text: "IGNORE"/.test(se10Branch));
check(
  "20.2g the warning is never auto-deleted on a timer",
  !/setTimeout|sleep\(/.test(se10Branch),
);
check(
  "20.2h a blocked preflight creates no mission, card or schedule",
  missionFn.indexOf("await blockLaunch(") <
    missionFn.indexOf('admin.rpc("create_social_mission_from_telegram_link"') &&
    /await blockLaunch\([\s\S]{0,400}?\);\s*\n\s*return;/.test(missionFn),
);
check(
  "20.2i the candidate is never finalized on a blocked preflight",
  !/finalize_social_mission_link_candidate_start/.test(
    se10StartCall.slice(0, se10StartCall.indexOf("onMissionSettled")),
  ),
);
check(
  "20.2j a failed source cleanup also renders the missing right in place",
  /showPermissionPrompt\("", \{ kind: "MISSING_RIGHTS", missing: \["Delete Messages"\] \}\)/.test(se10Branch),
);

// 20.3 — a retry after the fix uses the SAME candidate and the normal path.
check(
  "20.3a RETRY START reuses the existing candidate id, not a new link post",
  /sm_lf_start_\$\{candidateId\}/.test(se10Branch),
);
check(
  "20.3b the retry still runs the single shared mission pipeline",
  (se10Branch.match(/await runMissionCommand\(\{/g) ?? []).length === 1,
);
check(
  "20.3c the retry still re-authorizes live admin rights before launching",
  se10Branch.indexOf('lfStatus !== "administrator"') < se10Branch.indexOf("await runMissionCommand({"),
);
check(
  "20.3d a settled retry finalizes exactly once through the bound mission",
  /_mission_id: settled\.missionId/.test(se10StartCall) &&
    /String\(finalization\.mission_id \?\? ""\) === settled\.missionId/.test(se10StartCall),
);

// 20.4 — success cleanup is unchanged.
check(
  "20.4a a settled launch still deletes the transient prompt",
  /missionSettled = true;[\s\S]{0,200}await deleteLinkFinderPrompt\(\);/.test(se10StartCall),
);
check(
  "20.4b the prompt is deleted only after a successful finalization",
  se10StartCall.indexOf("if (finalizeError || !sameMission) return;") <
    se10StartCall.indexOf("await deleteLinkFinderPrompt();"),
);

// 20.5 — a started-but-unsettled launch is never left stuck.
check(
  "20.5a an unsettled launch restores a retryable prompt state",
  /if \(startingShown && !missionSettled && !promptResolved\) \{\s*\n\s*await showRetryablePrompt\(/.test(se10Branch),
);
check(
  "20.5b the restore never fires after a settled launch",
  /let missionSettled = false;/.test(se10Branch) && /missionSettled = true;/.test(se10StartCall),
);
check(
  "20.5c the restore never fires after a permission state was already shown",
  /let promptResolved = false;/.test(se10Branch) &&
    /promptResolved = true;\s*\n\s*await showPermissionPrompt/.test(se10StartCall),
);
check(
  "20.5d the restore adds no chat message and creates nothing",
  /const showRetryablePrompt = \(note: string\) => editLinkFinderPrompt\(/.test(se10Branch),
);

// 20.6 — instrumentation is bounded, secret-free and non-behavioural.
const se10TimerHelper = webhookRaw.slice(
  webhookRaw.indexOf("function se10Timer()"),
  webhookRaw.indexOf("async function editMessage("),
);
check("20.6a a timing helper exists", se10TimerHelper.length > 100);
check(
  "20.6b it emits only a phase name and an integer duration",
  /slices\.push\(`\$\{name\}=\$\{now - mark\}ms`\)/.test(se10TimerHelper),
);
check(
  "20.6c the required START phases are each measured",
  /timing\.slice\("preflight"\)/.test(missionFn) &&
    /timing\.slice\("create_mission"\)/.test(missionFn) &&
    /timing\.slice\("transport_card"\)/.test(missionFn) &&
    /timing\.slice\("schedule_pin_finalize"\)/.test(missionFn),
);
check(
  "20.6d no secret, token, header, payload or identity is logged",
  !/TELEGRAM_BOT_TOKEN|SERVICE_KEY|Authorization|apikey|bearer/i.test(se10TimerHelper) &&
    !/timing\.log\([^)]*(token|key|user|chat)/i.test(webhookRaw),
);
check(
  "20.6e instrumentation never changes a decision or a return value",
  !/if \(timing\.|return timing\b/.test(webhookRaw),
);

// 20.7 — nothing else moved.
check(
  "20.7a SE-9 immediate source cleanup at detection is unchanged",
  detectionBranch.indexOf("attach_social_mission_link_prompt") <
    detectionBranch.indexOf("ensureLinkFinderSourceDeleted"),
);
check(
  "20.7b anonymous-admin Link Finder handling is untouched",
  /linkFinderSender/.test(webhookRaw) && /from\?\.is_bot !== true/.test(webhookCode),
);
check(
  "20.7c raw /mission keeps its reply-based feedback and no prompt states",
  !/showStartingPrompt|showPermissionPrompt|showRetryablePrompt/.test(missionFn) &&
    /if \(args\.onPermissionBlocked\) await args\.onPermissionBlocked\(text, detail\);\s*\n\s*else await reply\(text\);/.test(missionFn),
);
check(
  "20.7d no duplicate card, schedule or pulse path was introduced",
  (missionFn.match(/action: "send_mission"/g) ?? []).length === 1 &&
    (missionFn.match(/activate_social_mission_schedule/g) ?? []).length === 1,
);
check(
  "20.7e no new table, migration or scheduler is required by SE-10",
  !/CREATE TABLE|cron\.schedule/i.test(se10Branch),
);

// ---------------------------------------------------------------------------
// 21. SE-11 — anonymous-admin `/mission <X link>`.
//     Telegram hides the human behind an anonymous message, so the command is
//     routed into the EXISTING Link Finder candidate + START/IGNORE approval
//     path instead of direct mission creation. No second authorization system,
//     no second candidate/card/schedule system, and no silent ignore.
// ---------------------------------------------------------------------------
const se11CommandBranch = webhookRaw.slice(
  webhookRaw.indexOf("const missionMatch = text.match("),
  webhookRaw.indexOf("// SE-5 — X Link Finder."),
);
const se11AnonBranch = se11CommandBranch.slice(
  // The anonymous link branch is the one with the strict same-group condition
  // and no bare-command guard; the SE-11 comment before it contains the word
  // "runMissionCommand" and must not pollute this slice.
  se11CommandBranch.indexOf("if (missionMatch && isAnonymousGroupAdminSender && isGroupChat) {"),
);
const se11Helper = webhookRaw.slice(
  webhookRaw.indexOf("const offerLinkFinderCandidate = async ("),
  webhookRaw.indexOf("// SE-4A — `/mission <X link>`. Runs before every generic fallthrough"),
);

// 21.1 — identifiable humans are untouched: still direct through the command.
check(
  "21.1a an identifiable human /mission still runs the direct command path",
  /if \(missionMatch && from\?\.is_bot !== true\) \{\s*\n\s*await runMissionCommand\(\{/.test(
    se11CommandBranch,
  ),
);
check(
  "21.1b the direct human path still passes the real sender id as the actor",
  /telegramUserId: Number\(from\.id\),/.test(se11CommandBranch),
);

// 21.2 — same-group anonymous admins are handled, never silently ignored.
check(
  "21.2a an anonymous-admin /mission branch exists",
  se11AnonBranch.length > 100 &&
    /if \(missionMatch && isAnonymousGroupAdminSender && isGroupChat\)/.test(se11AnonBranch),
);
check(
  "21.2b anonymity is proven by sender_chat being THIS exact chat",
  /const isAnonymousGroupAdminSender =\s*\n?\s*linkFinderSender\.eligible && linkFinderSender\.posterId === null;/
    .test(webhookRaw) &&
    /String\(senderChatOf\.id\) === String\(chatOf\.id\)/.test(webhookRaw),
);
check(
  "21.2c foreign sender_chat, channels and ordinary bots stay ineligible",
  /\(t === "group" \|\| t === "supergroup"\)/.test(webhookRaw) &&
    /return \{ eligible: false, posterId: null \};/.test(webhookRaw),
);

// 21.3 — an anonymous command can never launch directly.
check(
  "21.3a the anonymous branch never calls runMissionCommand",
  !/runMissionCommand/.test(se11AnonBranch),
);
check(
  "21.3b the anonymous branch creates no mission, card or schedule itself",
  !/send_mission|activate_social_mission_schedule|create_social_mission_from_telegram_link/.test(
    se11AnonBranch,
  ),
);
check(
  "21.3c the anonymous branch routes into the shared candidate path with a NULL poster",
  /await offerLinkFinderCandidate\(anonParsed, Number\(message\?\.message_id\), null\);/.test(
    se11AnonBranch,
  ),
);

// 21.4 — visible feedback, never silence, for a malformed anonymous command.
check(
  "21.4a a malformed or missing anonymous link returns the visible usage message",
  /if \(!anonParsed\) \{[\s\S]{0,400}?MISSION_USAGE/.test(se11AnonBranch),
);
check(
  "21.4b the usage reply is sent before any candidate work happens",
  se11AnonBranch.indexOf("MISSION_USAGE") <
    se11AnonBranch.indexOf("offerLinkFinderCandidate"),
);
check(
  "21.4c an unofficial handle still fails closed inside the RPC, not in the branch",
  !/project_profiles|x_url/.test(se11AnonBranch) &&
    /create_social_mission_link_candidate/.test(se11Helper),
);

// 21.5 — ONE candidate + prompt + cleanup system, reused by both entry points.
check(
  "21.5a exactly one candidate creation call site exists",
  (webhookRaw.match(/rpc\("create_social_mission_link_candidate"/g) ?? []).length === 1,
);
check(
  "21.5b exactly one START/IGNORE prompt keyboard is constructed at detection",
  (webhookRaw.match(/callback_data: `sm_lf_start_\$\{created\.candidate_id\}`/g) ?? []).length === 1,
);
check(
  "21.5c both entry points call the one shared helper",
  (webhookRaw.match(/await offerLinkFinderCandidate\(/g) ?? []).length === 2,
);
check(
  "21.5d the shared prompt keeps the canonical official-post text",
  /text: "This is an official project post\. Admins can start a Social Mission for it\.",/.test(
    se11Helper,
  ),
);

// 21.6 — SE-9 source cleanup semantics survive for both entry points.
check(
  "21.6a cleanup runs only after the prompt is confirmed sent AND attached",
  se11Helper.indexOf("attach_social_mission_link_prompt") <
    se11Helper.indexOf("ensureLinkFinderSourceDeleted") &&
    /if \(promptAttached\) \{/.test(se11Helper),
);
check(
  "21.6b cleanup is persisted through the existing idempotent candidate mechanism",
  /ensureLinkFinderSourceDeleted\(\{\s*\n\s*candidateId: String\(created\.candidate_id\),/.test(
    se11Helper,
  ),
);
check(
  "21.6c a webhook retry or repost creates no second candidate or prompt",
  /if \(created\.outcome !== "CREATED" \|\| !created\.candidate_id\) return false;/.test(se11Helper),
);

// 21.7 — the callback keeps the full authorization chain.
check(
  "21.7a START still resolves the candidate through the authoritative RPC",
  /resolve_social_mission_link_candidate/.test(se10Branch),
);
check(
  "21.7b START still preflights live Telegram bot rights before creating anything",
  se10Branch.indexOf("readBotChatPermissions") < se10Branch.indexOf("await runMissionCommand({"),
);
check(
  "21.7c START still launches through the one existing mission command path",
  (se10Branch.match(/await runMissionCommand\(\{/g) ?? []).length === 1,
);

// 21.8 — nothing else moved.
check(
  "21.8a raw /mission for identifiable humans is still the first command branch",
  se11CommandBranch.indexOf("from?.is_bot !== true") <
    se11CommandBranch.indexOf("isAnonymousGroupAdminSender"),
);
check(
  "21.8b no new table, migration or scheduler is required by SE-11",
  !/CREATE TABLE|cron\.schedule/i.test(se11CommandBranch + se11Helper),
);

// ---------------------------------------------------------------------------
// 22. SE-12 — bare `/mission` launcher UX.
//     A bare `/mission` or `/mission@PepeCartelHQBot` with no argument shows
//     a friendly launcher instruction in groups, while `/mission <X link>`
//     keeps its existing direct or Link-Finder behavior and malformed non-empty
//     arguments still use the existing usage handling.
// ---------------------------------------------------------------------------
const se12HumanBareBranch = webhookRaw.slice(
  webhookRaw.indexOf("SE-12 — bare `/mission` launcher for identifiable humans"),
  // This exact if line appears only in the non-empty human branch; the bare
  // branch has extra guards, so this marker cleanly bounds the bare branch.
  webhookRaw.indexOf("if (missionMatch && from?.is_bot !== true) {"),
);
const se12AnonBareBranch = webhookRaw.slice(
  webhookRaw.indexOf("SE-12 — bare `/mission` launcher for anonymous group admins"),
  webhookRaw.indexOf("// SE-11 — anonymous-admin `/mission <X link>`."),
);
const se12LauncherHelper = webhookRaw.slice(
  webhookRaw.indexOf("function sendBareMissionLauncher("),
  webhookRaw.indexOf("function encodeChatId("),
);

check("22.1a a shared BARE_MISSION_LAUNCHER_TEXT constant exists", /const BARE_MISSION_LAUNCHER_TEXT = /.test(webhookRaw));
check("22.1b the launcher copy includes the friendly headline", webhookRaw.includes("🚀 <b>START A SOCIAL MISSION</b>"));
check("22.1c the launcher asks the user to paste the X link", webhookRaw.includes("<b>Paste the X link below.</b>"));
check(
  "22.1d the shared helper is declared at module scope and receives the bot token explicitly",
  /function sendBareMissionLauncher\(token: string, chatId: string\)/.test(se12LauncherHelper),
);
check(
  "22.1e the module-scope helper does not reach for the handler-local TELEGRAM_BOT_TOKEN",
  !/TELEGRAM_BOT_TOKEN/.test(se12LauncherHelper),
);
check(
  "22.1f both call sites pass TELEGRAM_BOT_TOKEN explicitly",
  (webhookRaw.match(/await sendBareMissionLauncherAndCleanup\(TELEGRAM_BOT_TOKEN, chatId, Number\(message\?\.message_id\)\);/g) ?? []).length === 2,
);

check(
  "22.2a human bare /mission is gated on group chat and an empty argument",
  /missionMatch && from\?\.is_bot !== true && isGroupChat && !missionMatch\[1\]/.test(se12HumanBareBranch),
);
check(
  "22.2b human bare /mission sends the launcher with the explicit bot token",
  /await sendBareMissionLauncherAndCleanup\(TELEGRAM_BOT_TOKEN, chatId, Number\(message\?\.message_id\)\);/.test(se12HumanBareBranch),
);
check(
  "22.2c human bare /mission never calls runMissionCommand",
  !/runMissionCommand/.test(se12HumanBareBranch),
);
check(
  "22.2d human bare /mission never creates a candidate",
  !/create_social_mission_link_candidate|offerLinkFinderCandidate/.test(se12HumanBareBranch),
);

check(
  "22.3a anonymous bare /mission is gated on same-group admin and an empty argument",
  /missionMatch && isAnonymousGroupAdminSender && isGroupChat && !missionMatch\[1\]/.test(se12AnonBareBranch),
);
check(
  "22.3b anonymous bare /mission sends the launcher with the explicit bot token",
  /await sendBareMissionLauncherAndCleanup\(TELEGRAM_BOT_TOKEN, chatId, Number\(message\?\.message_id\)\);/.test(se12AnonBareBranch),
);
check(
  "22.3c anonymous bare /mission never calls runMissionCommand",
  !/runMissionCommand/.test(se12AnonBareBranch),
);
check(
  "22.3d anonymous bare /mission never creates a candidate",
  !/create_social_mission_link_candidate|offerLinkFinderCandidate/.test(se12AnonBareBranch),
);

check(
  "22.4 non-empty human /mission still enters the direct command path",
  /if \(missionMatch && from\?\.is_bot !== true\) \{\s*\n\s*await runMissionCommand\(\{/.test(se11CommandBranch),
);
check(
  "22.5 non-empty anonymous /mission still routes into the candidate helper",
  /await offerLinkFinderCandidate\(anonParsed, Number\(message\?\.message_id\), null\);/.test(se11CommandBranch),
);

check(
  "22.6a /mission close is not intercepted by the bare branches",
  !/!missionMatch\[1\].*close|close.*!missionMatch\[1\]/i.test(se11CommandBranch),
);
check(
  "22.6b runMissionCommand still handles the close keyword",
  /const isClose = String\(argument \?\? ""\)\.trim\(\)\.toLowerCase\(\) === "close";/.test(webhookRaw),
);

check(
  "22.7a malformed human argument still reaches the usage reply",
  /if \(!isClose && !parsed\) \{\s*\n\s*await reply\(MISSION_USAGE\);/.test(webhookRaw),
);
check(
  "22.7b malformed anonymous argument still returns MISSION_USAGE",
  /if \(!anonParsed\) \{[\s\S]{0,400}?MISSION_USAGE/.test(se11AnonBranch),
);

check(
  "22.8 the bare branches require an identifiable human or a proven same-group admin",
  /from\?\.is_bot !== true/.test(se12HumanBareBranch) && /isAnonymousGroupAdminSender/.test(se12AnonBareBranch),
);

check(
  "22.9 no new table, session table or scheduler is required by SE-12",
  !/CREATE TABLE|cron\.schedule/i.test(se12HumanBareBranch + se12AnonBareBranch),
);

// ---------------------------------------------------------------------------
// 23. SE-12.2 — delete the bare `/mission` command only after Telegram
//     confirms the launcher message was delivered.
// ---------------------------------------------------------------------------
const se122Cleanup = webhookRaw.slice(
  webhookRaw.indexOf("async function sendBareMissionLauncherAndCleanup("),
  webhookRaw.indexOf("function encodeChatId("),
);

check("23.1a the shared cleanup helper exists", se122Cleanup.length > 0);
check(
  "23.1b the cleanup helper receives the bot token explicitly",
  /async function sendBareMissionLauncherAndCleanup\(\s*token: string,\s*chatId: string,\s*sourceMessageId: number \| null \| undefined,\s*\)/.test(se122Cleanup),
);
check(
  "23.1c the module-scope cleanup helper never reaches for the handler-local token",
  !/TELEGRAM_BOT_TOKEN/.test(se122Cleanup),
);
check(
  "23.2a the launcher is sent before anything is deleted",
  se122Cleanup.indexOf("await sendBareMissionLauncher(token, chatId)") <
    se122Cleanup.indexOf('"deleteMessage"'),
);
check(
  "23.2b a failed launcher send returns early and deletes nothing",
  /const sent = await sendBareMissionLauncher\(token, chatId\);\s*\n\s*if \(!sent\) return null;/.test(se122Cleanup),
);
check(
  "23.3a deletion targets the exact source message id in the same chat",
  /"deleteMessage", \{ chat_id: chatId, message_id: messageId \}/.test(se122Cleanup),
);
check(
  "23.3b the source message id is validated before deletion is attempted",
  /if \(!Number\.isFinite\(messageId\) \|\| messageId <= 0\) return sent;/.test(se122Cleanup),
);
check(
  "23.4a a failed deletion is swallowed into a bounded diagnostic log",
  /catch \(error\) \{[\s\S]{0,300}?console\.log\(`\[SE-12\.2\][\s\S]{0,200}?\.slice\(0, 200\)/.test(se122Cleanup),
);
check(
  "23.4b a failed deletion never sends a second chat message",
  !/sendMessage\(|telegramJson\(token, "sendMessage"/.test(se122Cleanup.slice(se122Cleanup.indexOf("catch (error)"))),
);
check(
  "23.4c the launcher message itself is never edited or deleted",
  !/editMessageText|deleteMessage", \{ chat_id: chatId, message_id: sent/.test(se122Cleanup),
);
check(
  "23.5a the human bare branch uses the shared cleanup path",
  /await sendBareMissionLauncherAndCleanup\(/.test(se12HumanBareBranch),
);
check(
  "23.5b the anonymous bare branch uses the same shared cleanup path",
  /await sendBareMissionLauncherAndCleanup\(/.test(se12AnonBareBranch),
);
check(
  "23.5c neither bare branch deletes messages inline",
  !/deleteMessage/.test(se12HumanBareBranch + se12AnonBareBranch),
);
check(
  "23.6a /mission <X link> for humans still never triggers bare cleanup",
  !/sendBareMissionLauncherAndCleanup/.test(se11AnonBranch),
);
check(
  "23.6b /mission close handling is untouched by SE-12.2",
  /const isClose = String\(argument \?\? ""\)\.trim\(\)\.toLowerCase\(\) === "close";/.test(webhookRaw)
    && !/isClose/.test(se122Cleanup),
);
check(
  "23.7 SE-12.2 introduces no table, session state or scheduler",
  !/CREATE TABLE|cron\.schedule|from\("/.test(se122Cleanup),
);


console.log(`Step 1 authoritative regression: ${passed} passed, ${failures.length} failed`);





if (failures.length > 0) {
  for (const failure of failures) console.log(`  FAIL ${failure}`);
  process.exit(1);
}
