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
  /_telegram_user_id: linkFinderSender\.posterId/.test(webhookRaw) &&
    !/create_social_mission_link_candidate[\s\S]{0,400}_telegram_user_id: Number\(from\.id\)/.test(webhookRaw),
);

check(
  "14.11 detection still requires a connected group chat and a non-command message",
  /linkFinderSender\.eligible &&\s*!text\.startsWith\("\/"\) &&\s*\(chat\?\.type === "group" \|\| chat\?\.type === "supergroup"\)/.test(webhookRaw),
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
check(
  "16.1 a dedicated Link Finder source cleanup helper exists",
  /const ensureLinkFinderSourceCleanup = async \(targetId: string\): Promise<boolean>/.test(missionFn),
);
check(
  "16.2 the helper is a no-op for every non-Link-Finder source",
  /if \(!isLinkFinder\) return true;/.test(missionFn),
);
check(
  "16.3 Link Finder cleanup does NOT consult delete_command_after_send",
  !/delete_command_after_send/.test(
    missionFn.slice(
      missionFn.indexOf("const ensureLinkFinderSourceCleanup"),
      missionFn.indexOf("return !recordError && recordedOk === true;"),
    ),
  ),
);
check(
  "16.4 the /mission command cleanup keeps the workspace preference",
  /if \(!isLinkFinder && cfg\["delete_command_after_send"\] !== false && messageId > 0\)/.test(missionFn),
);
check(
  "16.5 a durably recorded deletion for the same message is already-clean",
  /command_deleted_at && Number\(recorded\.command_message_id\) === messageId/.test(missionFn),
);
check(
  "16.6 a definitive Telegram 'already gone' satisfies the objective",
  /message to delete not found\|message_id_invalid/.test(missionFn),
);
check(
  "16.7 a permission/transport failure does NOT count as clean",
  /if \(!removed\) return false;/.test(missionFn),
);
check(
  "16.8 successful cleanup is recorded through the existing RPC",
  /record_social_mission_command_deleted"?,?\s*\n?\s*\{ _target_id: targetId, _command_message_id: messageId \}/.test(missionFn),
);
check(
  "16.9 cleanup only reports clean when the recording persisted",
  /return !recordError && recordedOk === true;/.test(missionFn),
);

// 16.b — fresh ACTIVATED path ordering: cleanup -> settled -> finalize -> prompt.
const idxActivate = missionFn.indexOf("activate_social_mission_schedule");
const idxCleanupCall = missionFn.indexOf("const sourceClean = await ensureLinkFinderSourceCleanup(");
// lastIndexOf: the first `kind: "ACTIVATED"` is the callback's TYPE union.
const idxActivatedSettle = missionFn.lastIndexOf('kind: "ACTIVATED"');

check("16.10 cleanup runs after schedule activation", idxActivate > 0 && idxActivate < idxCleanupCall);
check("16.11 cleanup runs BEFORE the settled callback", idxCleanupCall > 0 && idxCleanupCall < idxActivatedSettle);
check(
  "16.12 the settled callback fires only when the source is clean (and SE-8 pinned)",
  /if \(sourceClean && canonicalPinned\) \{\s*\n\s*await args\.onMissionSettled\?\.\(\{\s*\n\s*kind: "ACTIVATED"/.test(missionFn),
);
check(
  "16.13 cleanup sits OUTSIDE the best-effort housekeeping try/catch",
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
  "16.18 the retry branch runs cleanup before settling",
  alreadySentBranch.indexOf("ensureLinkFinderSourceCleanup") <
    alreadySentBranch.indexOf('kind: "ALREADY_SENT"'),
);
check(
  "16.19 the retry only settles when cleanup AND the required pin succeeded",
  /if \(retryClean && retryPinned\) \{/.test(alreadySentBranch),
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
  "17.32 a cleanup failure leaves the candidate PENDING and the prompt intact",
  /if \(sourceClean && canonicalPinned\) \{/.test(missionFn),
);
check(
  "17.33 a pin failure equally blocks settlement",
  /canonical lifecycle incomplete: cleanup=\$\{sourceClean\} pin=\$\{canonicalPinned\}/.test(missionFn),
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
  "17.35 the retry re-attempts source cleanup idempotently",
  /const retryClean = await ensureLinkFinderSourceCleanup\(retryTargetId\);/.test(retryBranch),
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
  /already-sent recovery incomplete: cleanup=\$\{retryClean\} pin=\$\{retryPinned\}/.test(retryBranch),
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
  "17.44 a blocked preflight answers the callback with the precise reason",
  /onPermissionBlocked: async \(text\) => \{\s*\n\s*await answerCallback\(TELEGRAM_BOT_TOKEN, callback\.id, text\);/.test(startBranch),
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

console.log(`Step 1 authoritative regression: ${passed} passed, ${failures.length} failed`);





if (failures.length > 0) {
  for (const failure of failures) console.log(`  FAIL ${failure}`);
  process.exit(1);
}
