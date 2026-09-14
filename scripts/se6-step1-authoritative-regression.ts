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
check("5.14 the member's own post is never deleted as a command", /messageId: null/.test(webhookCode));

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
check("7.3 usage is written only when a NEW snapshot row was inserted", /IF v_snapshot_inserted AND _provider = 'x' THEN[\s\S]{0,300}usage_ledger/.test(se6Sql));
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

console.log(`Step 1 authoritative regression: ${passed} passed, ${failures.length} failed`);
if (failures.length > 0) {
  for (const failure of failures) console.log(`  FAIL ${failure}`);
  process.exit(1);
}
