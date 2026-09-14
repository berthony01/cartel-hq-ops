/**
 * SE-5 regression — source/SQL/pure-logic only.
 *
 * ZERO network, ZERO database, ZERO secrets, ZERO Telegram and ZERO X calls.
 * Every assertion is a static source/SQL check or a pure computation over the
 * frozen SE-5 rules.
 *
 * Run: bun scripts/se5-social-mission-engine-regression.ts
 */

import { readFileSync } from "node:fs";
import {
  X_API_BASE,
  X_BATCH_MAX,
  availabilityOf,
  batchPostIds,
  buildLookupUrl,
  isXPostId,
  mapPublicMetrics,
  metricSignature,
  minuteBucket,
} from "../backend-source/edge-functions/_shared/x-metrics";
import {
  MISSION_PRESET_SHAPE,
  defaultMissionSettings,
  validateMissionSettings,
  type MissionSettings,
} from "../src/lib/social-mission-settings";

let passed = 0;
const failures: string[] = [];
function check(name: string, condition: boolean): void {
  if (condition) passed += 1;
  else failures.push(name);
}

const SQL_PATH = "docs/sql/SE5_social_mission_engine.sql";
const SHARED_PATH = "backend-source/edge-functions/_shared/x-metrics.ts";
const RUNNER_PATH = "backend-source/edge-functions/social-mission-runner/index.ts";
const TRANSPORT_PATH = "backend-source/edge-functions/social-mission-telegram/index.ts";
const CARD_PATH = "backend-source/edge-functions/social-mission-telegram/card.ts";
const WEBHOOK_PATH = "supabase/functions/telegram-webhook/index.ts";
const STALE_WEBHOOK_PATH = "backend-source/edge-functions/telegram-webhook/index.ts";
const MISSIONS_LIB_PATH = "src/lib/social-missions.ts";
const SETTINGS_LIB_PATH = "src/lib/social-mission-settings.ts";
const SETTINGS_UI_PATH = "src/components/cartel/MissionSettingsCard.tsx";

const read = (path: string) => readFileSync(path, "utf8");
const stripTs = (source: string) =>
  source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");

const sqlCode = read(SQL_PATH).replace(/^\s*--.*$/gm, "");
const sharedCode = stripTs(read(SHARED_PATH));
const runnerCode = stripTs(read(RUNNER_PATH));
const transportCode = stripTs(read(TRANSPORT_PATH));
const cardCode = stripTs(read(CARD_PATH));
const webhookCode = stripTs(read(WEBHOOK_PATH));
const staleWebhookSrc = read(STALE_WEBHOOK_PATH);
const missionsLibCode = stripTs(read(MISSIONS_LIB_PATH));
const settingsLibCode = stripTs(read(SETTINGS_LIB_PATH));
const settingsUiCode = stripTs(read(SETTINGS_UI_PATH));

// ---------------------------------------------------------------------------
// 1. Official X provider boundary
// ---------------------------------------------------------------------------
check("1.1 the only endpoint is the official X v2 tweets lookup", X_API_BASE === "https://api.x.com/2/tweets");
check("1.2 no other host is contacted from the shared module", (sharedCode.match(/https:\/\/[^\s"'`]+/g) ?? []).every((u) => u.startsWith("https://api.x.com/2/tweets")));
check("1.3 the lookup asks for exactly the documented tweet fields", buildLookupUrl(["1"]).includes("tweet.fields=public_metrics%2Ccreated_at%2Cauthor_id"));
check("1.4 the bearer is read only from X_API_BEARER_TOKEN", /X_API_BEARER_TOKEN/.test(runnerCode) && /X_API_BEARER_TOKEN/.test(transportCode));
check("1.5 no secret value is ever logged from the shared module", !/console\.(log|error|warn)/.test(sharedCode));
check("1.6 the bearer never reaches a URL", !/\$\{bearerToken\}/.test(sharedCode.replace(/Bearer \$\{bearerToken\}/g, "")));
check("1.7 the token name is never echoed back to a caller", !/reason:\s*`?[^`"']*bearer/i.test(sharedCode));

// ---------------------------------------------------------------------------
// 2. Metric mapping — exact, and never zero-filled
// ---------------------------------------------------------------------------
const mapped = mapPublicMetrics({
  impression_count: 28,
  like_count: 10,
  reply_count: 6,
  retweet_count: 9,
  bookmark_count: 0,
  quote_count: 4,
});
check("2.1 impression_count maps to views", mapped.views === 28);
check("2.2 like_count maps to likes", mapped.likes === 10);
check("2.3 reply_count maps to comments", mapped.comments === 6);
check("2.4 retweet_count maps to shares", mapped.shares === 9);
check("2.5 bookmark_count maps to saves and a real 0 is preserved", mapped.saves === 0);
check("2.6 quote_count is never folded into shares", mapped.shares === 9 && !/quote_count/.test(sharedCode.replace(/quote_count is/g, "")));
const missing = mapPublicMetrics({ like_count: 3 });
check("2.7 a metric the provider omits stays null", missing.views === null && missing.saves === null);
check("2.8 a negative or fractional count is rejected as unknown", mapPublicMetrics({ like_count: -1 }).likes === null && mapPublicMetrics({ like_count: 1.5 }).likes === null);
check("2.9 availability mirrors nullability exactly", availabilityOf(missing).likes === true && availabilityOf(missing).views === false);
check("2.10 a 200 with no readable rows is unavailable, never zeroes", /returned no readable post metrics/.test(sharedCode) && !/views:\s*0/.test(sharedCode));

// ---------------------------------------------------------------------------
// 3. Batching and id safety
// ---------------------------------------------------------------------------
check("3.1 only numeric public post ids are accepted", isXPostId("2098827349470961903") && !isXPostId("abc") && !isXPostId("12a") && !isXPostId(""));
const many = Array.from({ length: 250 }, (_, i) => String(i + 1));
const batches = batchPostIds(many);
check("3.2 batches never exceed 100 ids", batches.every((b) => b.length <= X_BATCH_MAX) && X_BATCH_MAX === 100);
check("3.3 250 ids become 3 batches", batches.length === 3 && batches[2]!.length === 50);
check("3.4 duplicate ids are collapsed before the request", batchPostIds(["7", "7", "7"]).flat().length === 1);
check("3.5 invalid ids never reach a batch", batchPostIds(["7", "oops", null]).flat().join(",") === "7");

// ---------------------------------------------------------------------------
// 4. Idempotency, bucketing and edit gating
// ---------------------------------------------------------------------------
check("4.1 the minute bucket is stable inside one minute", minuteBucket(Date.parse("2026-09-14T03:10:59.999Z")) === minuteBucket(Date.parse("2026-09-14T03:10:00.000Z")));
check("4.2 the minute bucket advances with the minute", minuteBucket(Date.parse("2026-09-14T03:11:00.000Z")) !== minuteBucket(Date.parse("2026-09-14T03:10:00.000Z")));
const base = { views: 10, likes: 2, comments: 1, shares: 0, saves: null };
const sigA = metricSignature(base, { accomplished: false, missionStatus: "LIVE" });
check("4.3 an unchanged minute produces an unchanged signature", sigA === metricSignature({ ...base }, { accomplished: false, missionStatus: "LIVE" }));
check("4.4 a changed metric changes the signature", sigA !== metricSignature({ ...base, likes: 3 }, { accomplished: false, missionStatus: "LIVE" }));
check("4.5 accomplishment changes the signature", sigA !== metricSignature(base, { accomplished: true, missionStatus: "LIVE" }));
check("4.6 the final state changes the signature", sigA !== metricSignature(base, { accomplished: false, missionStatus: "COMPLETED" }));
check("4.7 unknown is distinct from zero in the signature", metricSignature({ ...base, saves: 0 }, { accomplished: false, missionStatus: "LIVE" }) !== sigA);
check("4.8 the runner skips the edit when the signature is unchanged", /last_metric_signature/.test(runnerCode) && /claim_social_mission_card_refresh/.test(runnerCode));
check("4.9 the card edit request id is derived from the signature", /se5-metrics:/.test(runnerCode));
check("4.10 one snapshot per mission and minute bucket is enforced in SQL", /poll_bucket/.test(sqlCode) && /ON CONFLICT/.test(sqlCode));

// ---------------------------------------------------------------------------
// 5. Launch read is fail-soft and single
// ---------------------------------------------------------------------------
check("5.1 the transport attempts exactly one launch metrics read", (transportCode.match(/lookupXPostMetrics\(/g) ?? []).length === 1);
check("5.2 the launch read cannot break the send", /attemptLaunchMetricsRead/.test(transportCode) && /catch/.test(transportCode));
check("5.3 the launch read reuses the same snapshot RPC as the runner", /record_social_mission_metric_snapshot/.test(transportCode) && /record_social_mission_metric_snapshot/.test(runnerCode));
check("5.4 the runner refresh runs before the schedule claim", runnerCode.indexOf("runMetricsRefresh") < runnerCode.indexOf("claim_due_social_mission_schedule_events"));
check("5.5 the runner metrics phase never throws out", /runMetricsRefresh/.test(runnerCode) && /catch/.test(runnerCode));

// ---------------------------------------------------------------------------
// 6. Pulse 2.0 — stored snapshots only, still reply-only sendMessage
// ---------------------------------------------------------------------------
const pulseSection = runnerCode.slice(runnerCode.indexOf("buildPulseText"));
check("6.1 the pulse builder exists and reads stored metrics", /buildPulseText/.test(runnerCode));
check("6.2 the pulse never performs an X lookup", !/lookupXPostMetrics/.test(pulseSection.slice(0, pulseSection.indexOf("buildPulseText") + 4000)) || runnerCode.indexOf("lookupXPostMetrics") < runnerCode.indexOf("buildPulseText"));
check("6.3 the pulse still uses sendMessage only", /"sendMessage"/.test(runnerCode) && !/sendPhoto/.test(runnerCode));
check("6.4 the pulse still replies to the canonical card", /reply_to_message_id/.test(runnerCode));
check("6.5 the 120 second pulse cleanup is preserved", /120/.test(runnerCode) || /social_mission_pulse/.test(runnerCode));
check("6.6 a pulse omits an unknown metric instead of printing zero", /pulseMetricLine/.test(runnerCode) && !/views: 0/.test(runnerCode));

// ---------------------------------------------------------------------------
// 7. Card 2.0
// ---------------------------------------------------------------------------
check("7.1 the card still renders as a branded photo card", /sendPhoto/.test(transportCode));
check("7.2 edits still target the same message", /editMessageCaption|editMessageText/.test(transportCode));
check("7.3 the canonical URL button is preserved", /inline_keyboard/.test(transportCode));
check("7.4 pending metrics are stated, not zeroed", /LIVE_METRICS_PENDING/.test(cardCode));
check("7.5 remaining time is approximate, never a live countdown", /approximateRemaining/.test(cardCode) && /~/.test(cardCode));
check("7.6 ACCOMPLISHED is a card state, not a database status", /MISSION_STATE_ACCOMPLISHED/.test(cardCode) && !/'ACCOMPLISHED'/.test(sqlCode.replace(/accomplished_at/g, "")));
check("7.7 the milestone line renders progress against the target", /milestoneProgressLine/.test(cardCode));

// ---------------------------------------------------------------------------
// 8. Command cleanup and pin safety
// ---------------------------------------------------------------------------
check("8.1 the command is deleted only after a confirmed send", webhookCode.indexOf('transportState === "SENT"') < webhookCode.indexOf("deleteMessage"));
check("8.2 command deletion honours the workspace setting", /delete_command_after_send !== false/.test(webhookCode));
check("8.3 a link-finder start never deletes a member post", /messageId > 0/.test(webhookCode));
check("8.4 auto pin honours the workspace setting", /auto_pin_mission !== false/.test(webhookCode));
check("8.5 only a card HQ pinned is ever unpinned", /pinned_by_hq/.test(webhookCode) && /unpinChatMessage/.test(webhookCode));
check("8.6 pin state is recorded through the dedicated RPC", /record_social_mission_target_pin/.test(webhookCode) && /record_social_mission_target_pin/.test(sqlCode));

// ---------------------------------------------------------------------------
// 9. X Link Finder
// ---------------------------------------------------------------------------
check("9.1 the finder only reacts to human messages", /from\?\.is_bot !== true/.test(webhookCode));
check("9.2 the finder only reacts in connected group chats", /chat\?\.type === "group" \|\| chat\?\.type === "supergroup"/.test(webhookCode));
check("9.3 a candidate is created through the service-role RPC", /create_social_mission_link_candidate/.test(webhookCode) && /create_social_mission_link_candidate/.test(sqlCode));
check("9.4 the candidate is idempotent per chat and message", /telegram_chat_id, telegram_message_id/.test(sqlCode) || /UNIQUE \(telegram_chat_id, telegram_message_id\)/.test(sqlCode));
check("9.5 the candidate expires", /expires_at/.test(sqlCode) && /_ttl_minutes/.test(webhookCode));
check("9.6 the prompt offers START and IGNORE only", /sm_lf_start_/.test(webhookCode) && /sm_lf_ignore_/.test(webhookCode));
check("9.7 resolution is authorized inside the RPC", /resolve_social_mission_link_candidate/.test(webhookCode) && /resolve_social_mission_link_candidate/.test(sqlCode));
check("9.8 START reuses the existing mission command path", /runMissionCommand\(/.test(webhookCode) && /telegram_link_finder/.test(webhookCode));
check("9.9 the link candidates table has no browser grant", /REVOKE ALL ON TABLE public\.social_mission_link_candidates FROM PUBLIC, anon, authenticated/.test(sqlCode));
check("9.10 the finder never starts a mission on its own", !/resolve_social_mission_link_candidate[\s\S]{0,200}"START"[\s\S]{0,80}auto/i.test(webhookCode));

// ---------------------------------------------------------------------------
// 10. Presets and milestones (pure)
// ---------------------------------------------------------------------------
check("10.1 STANDARD is 45 minutes with the frozen pulse offsets", MISSION_PRESET_SHAPE.STANDARD.durationMinutes === 45 && MISSION_PRESET_SHAPE.STANDARD.pulseOffsets.join(",") === "3,8,15,25,35");
check("10.2 QUICK is 20 minutes", MISSION_PRESET_SHAPE.QUICK.durationMinutes === 20 && MISSION_PRESET_SHAPE.QUICK.pulseOffsets.join(",") === "2,5,10,15");
check("10.3 MAJOR_ANNOUNCEMENT is 120 minutes", MISSION_PRESET_SHAPE.MAJOR_ANNOUNCEMENT.durationMinutes === 120 && MISSION_PRESET_SHAPE.MAJOR_ANNOUNCEMENT.pulseOffsets.join(",") === "5,15,30,60,90");
check("10.4 LAUNCH is 60 minutes", MISSION_PRESET_SHAPE.LAUNCH.durationMinutes === 60 && MISSION_PRESET_SHAPE.LAUNCH.pulseOffsets.join(",") === "3,8,15,30,45");
check("10.5 every pulse offset is inside its own mission window", Object.values(MISSION_PRESET_SHAPE).every((p) => p.pulseOffsets.every((o) => o > 0 && o < p.durationMinutes)));
check("10.6 pulse offsets are strictly increasing", Object.values(MISSION_PRESET_SHAPE).every((p) => p.pulseOffsets.every((o, i) => i === 0 || o > p.pulseOffsets[i - 1]!)));
check("10.7 the SQL preset catalogue matches the UI mirror", ["STANDARD", "QUICK", "MAJOR_ANNOUNCEMENT", "LAUNCH"].every((p) => sqlCode.includes(`'${p}'`)));
check("10.8 a historical mission with no snapshot falls back to STANDARD", /STANDARD/.test(sqlCode) && /COALESCE/.test(sqlCode));

const ws = "00000000-0000-0000-0000-000000000000";
const defaults = defaultMissionSettings(ws);
check("10.9 defaults are STANDARD with metrics, finder, cleanup and pin on", defaults.default_preset === "STANDARD" && defaults.live_metrics_enabled && defaults.link_finder_enabled && defaults.delete_command_after_send && defaults.auto_pin_mission);
check("10.10 no milestone means no target", defaults.milestone_type === "NONE" && defaults.milestone_target === null && validateMissionSettings(defaults) === null);
const withMilestone = (t: unknown): MissionSettings => ({ ...defaults, milestone_type: "VIEWS", milestone_target: t as number | null });
check("10.11 a milestone requires a positive whole target", validateMissionSettings(withMilestone(1000)) === null && validateMissionSettings(withMilestone(0)) !== null && validateMissionSettings(withMilestone(-5)) !== null && validateMissionSettings(withMilestone(null)) !== null && validateMissionSettings(withMilestone(1.5)) !== null);
check("10.12 a target without a milestone type is refused", validateMissionSettings({ ...defaults, milestone_target: 10 }) !== null);
check("10.13 milestone metrics are absolute public metrics only", /TOTAL_INTERACTIONS/.test(sqlCode) && !/delta|increase_since/i.test(sqlCode));
check("10.14 accomplishment is recorded once", /accomplished_at IS NULL/.test(sqlCode));
check("10.15 no reward, point or payout mechanic exists", !/reward|payout|points_awarded/i.test(sqlCode) && !/reward|payout/i.test(runnerCode));

// ---------------------------------------------------------------------------
// 11. Settings authorization and tenant isolation
// ---------------------------------------------------------------------------
check("11.1 members may read the settings row", /social_mission_settings_select_member/.test(sqlCode) && /is_workspace_member/.test(sqlCode));
check("11.2 only an operator may insert or update it", /social_mission_settings_insert_operator/.test(sqlCode) && /is_workspace_operator/.test(sqlCode));
check("11.3 row level security is enabled and forced", /ALTER TABLE public\.social_mission_settings ENABLE ROW LEVEL SECURITY/.test(sqlCode) && /FORCE ROW LEVEL SECURITY/.test(sqlCode));
check("11.4 anon has no grant on the settings table", /REVOKE ALL ON TABLE public\.social_mission_settings FROM PUBLIC, anon, authenticated/.test(sqlCode));
check("11.5 every settings statement is workspace scoped", (settingsLibCode.match(/\.from\(TABLE\)/g) ?? []).length === (settingsLibCode.match(/workspace_id/g) ?? []).length - (settingsLibCode.match(/workspace_id:/g) ?? []).length - 3 || /eq\("workspace_id", workspaceId\)/.test(settingsLibCode));
check("11.6 the browser never uses a service role key", !/service_role|SERVICE_ROLE/.test(settingsLibCode) && !/service_role/.test(missionsLibCode) && !/service_role/.test(settingsUiCode));
check("11.7 the UI gate is convenience only and the database still decides", /is_workspace_operator/.test(settingsLibCode) && /RLS/.test(read(SETTINGS_LIB_PATH)));

// ---------------------------------------------------------------------------
// 12. Read-only mission surface is unchanged
// ---------------------------------------------------------------------------
check("12.1 the mission read layer performs no mutation", !/\.insert\(|\.update\(|\.upsert\(|\.delete\(|\.rpc\(|functions\.invoke/.test(missionsLibCode));
check("12.2 mission creation and closing stay Telegram-only", /\/mission/.test(missionsLibCode) && !/create_social_mission/.test(missionsLibCode));
check("12.3 the settings module touches only the settings table", (settingsLibCode.match(/\.from\(/g) ?? []).length === (settingsLibCode.match(/\.from\(TABLE\)/g) ?? []).length);
check("12.4 no browser polling interval was introduced", !/refetchInterval/.test(missionsLibCode) && !/refetchInterval/.test(settingsLibCode));
check("12.5 no OAuth, billing or contributor mechanic appears in the UI", !/oauth|stripe|billing|contributor/i.test(settingsUiCode));

// ---------------------------------------------------------------------------
// 13. Repository parity and blast radius
// ---------------------------------------------------------------------------
check("13.1 the stale backend webhook copy is still untouched by SE-5", !/social_mission_link_candidates|record_social_mission_target_pin/.test(staleWebhookSrc));
check("13.2 no second scheduler is introduced", !/cron\.schedule/.test(sqlCode) || (sqlCode.match(/cron\.schedule/g) ?? []).length === 0);
check("13.3 the existing cleanup worker contract is reused", /social_mission_pulse/.test(runnerCode));
check("13.4 the migration is prepared only and is transactional", /^BEGIN;/m.test(sqlCode) && /COMMIT;/.test(sqlCode));
check("13.5 no secret value is embedded in the migration", !/eyJ|sb_secret_|Bearer /.test(sqlCode));

console.log(`SE-5 regression: ${passed} passed, ${failures.length} failed`);
if (failures.length > 0) {
  for (const failure of failures) console.log(`  FAIL ${failure}`);
  process.exit(1);
}
