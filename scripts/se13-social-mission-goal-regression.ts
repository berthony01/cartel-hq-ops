/**
 * SE-13 regression — Social Mission Goal Experience.
 *
 * ZERO network, ZERO database, ZERO secrets, ZERO Telegram and ZERO X calls.
 * Every assertion is a static source/SQL check or a pure computation over the
 * frozen SE-13 rules.
 *
 * Run: bun scripts/se13-social-mission-goal-regression.ts
 */

import { readFileSync } from "node:fs";
import {
  autoGoalStep,
  computeAutoViewsGoal,
} from "../backend-source/edge-functions/_shared/mission-goal";
import {
  EMPTY_METRICS,
  GOAL_BAR_CELLS,
  GOAL_HEADING,
  PRIMARY_GOAL_REACHED,
  STRETCH_GOAL_HEADING,
  TELEGRAM_CAPTION_MAX,
  goalBar,
  goalPercent,
  goalProgressValue,
  renderGoalLines,
  renderMissionCard,
  type CanonicalMetrics,
  type MissionGoal,
} from "../backend-source/edge-functions/social-mission-telegram/card";
import {
  buildPulseText,
  pulseGoalLine,
  pulseStretchGoalLine,
} from "../backend-source/edge-functions/_shared/mission-pulse-copy";

let passed = 0;
const failures: string[] = [];
function check(name: string, condition: boolean): void {
  if (condition) passed += 1;
  else failures.push(name);
}

const read = (p: string): string => readFileSync(p, "utf8");
/** Copy assertions run on EXECUTABLE source only; explanatory prose in
 *  comments legitimately names the mechanics SE-13 forbids. */
const stripComments = (src: string): string =>
  src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|\s)--.*$/gm, "$1").replace(/^\s*\/\/.*$/gm, "");
const SQL = read("docs/sql/SE13_social_mission_goal_experience.sql");
const CARD = read("backend-source/edge-functions/social-mission-telegram/card.ts");
const TRANSPORT = read("backend-source/edge-functions/social-mission-telegram/index.ts");
const PULSE = read("backend-source/edge-functions/_shared/mission-pulse-copy.ts");
const RUNNER = read("backend-source/edge-functions/social-mission-runner/index.ts");
const SETTINGS_UI = read("src/components/cartel/MissionSettingsCard.tsx");
const SETTINGS_LIB = read("src/lib/social-mission-settings.ts");

const m = (over: Partial<CanonicalMetrics>): CanonicalMetrics => ({ ...EMPTY_METRICS, ...over });

// ---------------------------------------------------------------------------
// 1. Automatic goal — deterministic, bounded, project-scale aware.
// ---------------------------------------------------------------------------
check("1.1 step ladder is exactly the frozen ladder", autoGoalStep(0) === 10 && autoGoalStep(99) === 10 && autoGoalStep(100) === 25 && autoGoalStep(499) === 25 && autoGoalStep(500) === 50 && autoGoalStep(999) === 50 && autoGoalStep(1000) === 100 && autoGoalStep(4999) === 100 && autoGoalStep(5000) === 250 && autoGoalStep(9999) === 250 && autoGoalStep(10000) === 500 && autoGoalStep(49999) === 500 && autoGoalStep(50000) === 1000);

const g0 = computeAutoViewsGoal(0);
const g69 = computeAutoViewsGoal(69);
const g271 = computeAutoViewsGoal(271);
const g999 = computeAutoViewsGoal(999);
const g5000 = computeAutoViewsGoal(5000);
const g50000 = computeAutoViewsGoal(50000);

check("1.2 baseline 0 rounds to 30 / 50", g0?.primaryTarget === 30 && g0?.stretchTarget === 50);
check("1.3 baseline 69 rounds to 100 / 150", g69?.primaryTarget === 100 && g69?.stretchTarget === 150);
check("1.4 baseline 271 rounds to 375 / 575", g271?.primaryTarget === 375 && g271?.stretchTarget === 575);
check("1.5 baseline 999 rounds to 1300 / 1950", g999?.primaryTarget === 1300 && g999?.stretchTarget === 1950);
check("1.6 baseline 5000 rounds to 6500 / 9750", g5000?.primaryTarget === 6500 && g5000?.stretchTarget === 9750);
check("1.7 baseline 50000 rounds to 65000 / 98000", g50000?.primaryTarget === 65000 && g50000?.stretchTarget === 98000);
check("1.8 the stretch target is always strictly above the primary", [g0, g69, g271, g999, g5000, g50000].every((g) => g !== null && g.stretchTarget > g.primaryTarget));
check("1.9 the primary target is always above its own baseline", (computeAutoViewsGoal(271)?.primaryTarget ?? 0) > 271 && (computeAutoViewsGoal(0)?.primaryTarget ?? 0) > 0);
check("1.10 an unknown views baseline never fabricates a goal", computeAutoViewsGoal(null) === null);
check("1.11 a negative baseline never fabricates a goal", computeAutoViewsGoal(-1) === null);
check("1.12 the algorithm is deterministic", JSON.stringify(computeAutoViewsGoal(271)) === JSON.stringify(computeAutoViewsGoal(271)));
check("1.13 the reference mirror performs no network or database access", !/fetch\(|createClient|Deno\.env/.test(read("backend-source/edge-functions/_shared/mission-goal.ts")));

// ---------------------------------------------------------------------------
// 2. SQL — explicit wins, auto is established once, no new table.
// ---------------------------------------------------------------------------
check("2.1 the migration defines the pure auto-goal helper", /CREATE OR REPLACE FUNCTION public\.social_mission_auto_goal\(_baseline bigint\)/.test(SQL) && /IMMUTABLE/.test(SQL));
check("2.2 the SQL step ladder matches the frozen ladder", /_baseline < 100 THEN 10/.test(SQL) && /_baseline < 500 THEN 25/.test(SQL) && /_baseline < 1000 THEN 50/.test(SQL) && /_baseline < 5000 THEN 100/.test(SQL) && /_baseline < 10000 THEN 250/.test(SQL) && /_baseline < 50000 THEN 500/.test(SQL) && /ELSE 1000/.test(SQL));
check("2.3 the SQL primary formula matches the frozen formula", /GREATEST\(_baseline \+ 25, ceil\(_baseline \* 1\.30\)::bigint\)/.test(SQL) && /ceil\(v_raw::numeric \/ v_step\)/.test(SQL));
check("2.4 the SQL stretch formula matches the frozen formula", /ceil\(\(v_primary \* 1\.50\) \/ v_step\)/.test(SQL) && /v_stretch <= v_primary/.test(SQL));
check("2.5 a NULL or negative baseline returns NULL in SQL too", /IF _baseline IS NULL OR _baseline < 0 THEN\s*\n\s*RETURN NULL;/.test(SQL));
check("2.6 an explicit goal always wins and is never rewritten", /EXPLICIT workspace goal ALWAYS wins/.test(SQL) && /jsonb_build_object\('goal_source', 'EXPLICIT'\)/.test(SQL));
check("2.7 an automatic goal is only derived when no goal exists", /ELSIF v_goal_source IS NULL AND _views IS NOT NULL AND _views >= 0 THEN/.test(SQL));
check("2.8 goal establishment is guarded so a retry cannot change it", /AND COALESCE\(metadata -> 'effective_config' ->> 'goal_source', ''\) = ''/.test(SQL) && /IDEMPOTENT: only the FIRST valid snapshot/.test(SQL));
check("2.9 the goal is established before accomplishment is evaluated", SQL.indexOf("social_mission_auto_goal(_views)") < SQL.indexOf("v_progress := CASE v_type"));
check("2.10 provenance and stretch ride in the existing effective_config JSON", /'\{effective_config\}'/.test(SQL) && /'stretch_goal_target'/.test(SQL) && /'goal_source', 'AUTO'/.test(SQL));
check("2.11 the migration creates no new table and no reward machinery", !/CREATE TABLE/i.test(SQL) && !/points|reward|badge|payout/i.test(stripComments(SQL)));
check("2.12 accomplishment stays null-honest for TOTAL_INTERACTIONS", /WHEN _likes IS NULL OR _comments IS NULL OR _shares IS NULL THEN NULL/.test(SQL));
check("2.13 the stretch goal never sets accomplished_at", /Stretch Goal is display-only and NEVER sets accomplished_at/.test(SQL) && SQL.split("accomplished_at = COALESCE").length === 2);
check("2.14 the effective-config reader stays service-role and postgres only", /REVOKE ALL ON FUNCTION public\.social_mission_effective_config\(uuid\) FROM PUBLIC, anon, authenticated;/.test(SQL) && /GRANT EXECUTE ON FUNCTION public\.social_mission_effective_config\(uuid\) TO service_role, postgres;/.test(SQL));
check("2.15 the auto-goal helper is not exposed to anon or authenticated", /REVOKE ALL ON FUNCTION public\.social_mission_auto_goal\(bigint\) FROM PUBLIC, anon, authenticated;/.test(SQL));
check("2.16 the migration is explicitly prepared-only", /PREPARED ONLY/.test(SQL));

// ---------------------------------------------------------------------------
// 3. Card — truthful progress, capped bar, null-honest.
// ---------------------------------------------------------------------------
check("3.1 percent is floored and never exceeds 100", goalPercent(271, 375) === 72 && goalPercent(500, 375) === 100 && goalPercent(0, 375) === 0);
check("3.2 the bar has exactly ten cells", goalBar(0, 100).split(" ")[0].length === GOAL_BAR_CELLS && goalBar(1000, 100).split(" ")[0].length === GOAL_BAR_CELLS && GOAL_BAR_CELLS === 10);
check("3.3 the bar is capped at full", goalBar(1000, 100) === "██████████ 100%");
check("3.4 the bar matches the frozen example shape", goalBar(72, 100) === "███████░░░ 72%");
check("3.5 the bar is plain text with no Markdown or HTML", !/[<>*_`]/.test(goalBar(72, 100)));

const viewsGoal: MissionGoal = { type: "VIEWS", target: 375, stretchTarget: 575, source: "AUTO" };
const liveGoalLines = renderGoalLines(viewsGoal, m({ views: 271 }), false);
check("3.6 the goal block is headed MISSION GOAL", liveGoalLines[0] === GOAL_HEADING && GOAL_HEADING === "🎯 MISSION GOAL");
check("3.7 the goal value line is truthful and labelled", liveGoalLines.includes("Views: 271 / 375"));
check("3.8 the goal renders its progress bar", liveGoalLines.includes("███████░░░ 72%"));
check("3.9 an unknown metric renders no goal at all", renderGoalLines(viewsGoal, EMPTY_METRICS, false).length === 0);
check("3.10 an unknown metric is never coerced to zero", !renderGoalLines(viewsGoal, EMPTY_METRICS, false).join("\n").includes("0 / 375"));
check("3.11 no goal configured renders nothing", renderGoalLines(null, m({ views: 271 }), false).length === 0);
check("3.12 a non-positive target renders nothing", renderGoalLines({ type: "VIEWS", target: 0 }, m({ views: 271 }), false).length === 0);

// Primary reached / stretch visibility.
const beforeReached = renderGoalLines(viewsGoal, m({ views: 374 }), false).join("\n");
const afterReached = renderGoalLines(viewsGoal, m({ views: 400 }), false).join("\n");
check("3.13 the stretch goal is hidden before the primary is reached", !beforeReached.includes(STRETCH_GOAL_HEADING));
check("3.14 the primary reached marker appears once the target is met", afterReached.includes(PRIMARY_GOAL_REACHED) && PRIMARY_GOAL_REACHED === "✅ PRIMARY GOAL REACHED");
check("3.15 the stretch goal appears once the primary is reached", afterReached.includes(STRETCH_GOAL_HEADING) && afterReached.includes("Views: 400 / 575"));
check("3.16 the stretch goal uses the same metric as the primary", afterReached.split(STRETCH_GOAL_HEADING)[1].includes("Views:"));
check("3.17 an accomplished mission shows the reached state", renderGoalLines(viewsGoal, m({ views: 10 }), true).join("\n").includes(PRIMARY_GOAL_REACHED));
check("3.18 a stretch target at or below the primary is ignored", !renderGoalLines({ type: "VIEWS", target: 375, stretchTarget: 375 }, m({ views: 400 }), false).join("\n").includes(STRETCH_GOAL_HEADING));

// TOTAL_INTERACTIONS null-honesty.
const total: MissionGoal = { type: "TOTAL_INTERACTIONS", target: 100 };
check("3.19 the total sums only when likes, replies and reposts are all known", goalProgressValue("TOTAL_INTERACTIONS", m({ likes: 10, comments: 5, shares: 2 })) === 17);
check("3.20 the total is unknown when any one component is unknown", goalProgressValue("TOTAL_INTERACTIONS", m({ likes: 10, comments: 5 })) === null && goalProgressValue("TOTAL_INTERACTIONS", m({ likes: 10, shares: 2 })) === null && goalProgressValue("TOTAL_INTERACTIONS", m({ comments: 5, shares: 2 })) === null);
check("3.21 the total excludes views and bookmarks", goalProgressValue("TOTAL_INTERACTIONS", m({ views: 9999, saves: 9999, likes: 1, comments: 1, shares: 1 })) === 3);
check("3.22 an unknown total renders no goal block", renderGoalLines(total, m({ likes: 10, comments: 5 }), false).length === 0);

// Card integration + copy safety.
const liveCard = renderMissionCard({
  missionStatus: "LIVE",
  platform: "x",
  canonicalUrl: "https://x.com/PEPECARTELTOKEN/status/2098827349470961903",
  authorHandle: "PEPECARTELTOKEN",
  contentText: "Official post",
  projectName: "PEPECARTEL",
  ticker: "PCART",
  baseline: m({ views: 100 }),
  latest: m({ views: 271 }),
  goal: viewsGoal,
  endsAt: "2026-01-01T11:00:00Z",
  nowMs: Date.parse("2026-01-01T10:00:00Z"),
});
check("3.23 a LIVE card carries the goal block", liveCard.text.includes(GOAL_HEADING) && liveCard.text.includes("Views: 271 / 375"));
check("3.24 a LIVE card keeps its real observed metrics", liveCard.text.includes("Views: 271 (+171)"));
check("3.25 a LIVE card keeps natural-participation copy", liveCard.text.includes("join the conversation") && liveCard.text.includes("optional"));
check("3.26 the card stays plain text with a single post button", liveCard.replyMarkup?.inline_keyboard.length === 1 && liveCard.replyMarkup?.inline_keyboard[0]?.length === 1);

const completedCard = renderMissionCard({
  missionStatus: "COMPLETED",
  platform: "x",
  canonicalUrl: "https://x.com/PEPECARTELTOKEN/status/2098827349470961903",
  authorHandle: "PEPECARTELTOKEN",
  contentText: null,
  projectName: "PEPECARTEL",
  ticker: "PCART",
  baseline: m({ views: 100 }),
  latest: m({ views: 400 }),
  goal: viewsGoal,
  accomplished: true,
  nowMs: 0,
});
check("3.27 a completed card keeps the observed-window phrase", completedCard.text.includes("Observed during the mission window"));
check("3.28 a completed card keeps the causation caveat", completedCard.text.includes("not proof that Telegram caused the growth"));
check("3.29 a completed card reports the final primary goal result", completedCard.text.includes("Views: 400 / 375") && completedCard.text.includes(PRIMARY_GOAL_REACHED));
check("3.30 a completed card reports the final stretch progress", completedCard.text.includes(STRETCH_GOAL_HEADING) && completedCard.text.includes("Views: 400 / 575"));

const unreachedCompleted = renderMissionCard({
  missionStatus: "COMPLETED",
  platform: "x",
  canonicalUrl: "https://x.com/PEPECARTELTOKEN/status/2098827349470961903",
  authorHandle: "PEPECARTELTOKEN",
  contentText: null,
  projectName: "PEPECARTEL",
  ticker: "PCART",
  baseline: EMPTY_METRICS,
  latest: m({ views: 120 }),
  goal: viewsGoal,
  nowMs: 0,
});
check("3.31 an unreached completed goal shows truthful final progress", unreachedCompleted.text.includes("Views: 120 / 375") && !unreachedCompleted.text.includes(PRIMARY_GOAL_REACHED));
check("3.32 an unreached completed goal hides the stretch goal", !unreachedCompleted.text.includes(STRETCH_GOAL_HEADING));

// Photo caption budget.
const longCaption = renderMissionCard({
  missionStatus: "LIVE",
  platform: "x",
  canonicalUrl: "https://x.com/PEPECARTELTOKEN/status/2098827349470961903",
  authorHandle: "PEPECARTELTOKEN",
  contentText: "x".repeat(4000),
  projectName: "PEPECARTEL",
  ticker: "PCART",
  baseline: EMPTY_METRICS,
  latest: m({ views: 271 }),
  goal: viewsGoal,
  maxLength: TELEGRAM_CAPTION_MAX,
  nowMs: 0,
});
check("3.33 the branded caption budget is still respected", longCaption.text.length <= TELEGRAM_CAPTION_MAX && TELEGRAM_CAPTION_MAX === 1024);
check("3.34 the goal block survives caption truncation", longCaption.text.includes(GOAL_HEADING));

// ---------------------------------------------------------------------------
// 4. Pulses — stored metrics only, goal language.
// ---------------------------------------------------------------------------
const pulseMetrics = { views: 271, likes: null, comments: null, shares: null, saves: null };
const pulseConfig = { milestone_type: "VIEWS", milestone_target: 375, stretch_goal_target: 575 };
check("4.1 a pulse states goal progress with a percentage", pulseGoalLine(pulseMetrics as never, pulseConfig) === "Goal progress: 271 / 375 views (72%).");
check("4.2 a reached pulse goal says Primary Goal reached", (pulseGoalLine({ ...pulseMetrics, views: 400 } as never, pulseConfig) ?? "").startsWith("Primary Goal reached"));
check("4.3 a pulse hides the stretch goal before the primary is reached", pulseStretchGoalLine(pulseMetrics as never, pulseConfig) === null);
check("4.4 a pulse shows the stretch goal once the primary is reached", (pulseStretchGoalLine({ ...pulseMetrics, views: 400 } as never, pulseConfig) ?? "").includes("400 / 575"));
check("4.5 an unknown metric never fabricates pulse goal progress", pulseGoalLine({ ...pulseMetrics, views: null } as never, pulseConfig) === null);
check("4.6 a mission without a goal pulses without goal copy", pulseGoalLine(pulseMetrics as never, { milestone_type: "NONE" }) === null);
check("4.7 the pulse total stays null-honest", pulseGoalLine({ views: 1, likes: 10, comments: null, shares: 1, saves: null } as never, { milestone_type: "TOTAL_INTERACTIONS", milestone_target: 5 }) === null);
const pulseText = buildPulseText(pulseMetrics as never, false, { config: pulseConfig, endsAt: "2026-01-01T10:30:00Z", nowMs: Date.parse("2026-01-01T10:00:00Z") });
check("4.8 a pulse combines stored metrics, goal progress and timing", pulseText.includes("271 views") && pulseText.includes("Goal progress: 271 / 375 views (72%).") && pulseText.includes("30 minutes left"));
check("4.9 the pulse module performs zero provider and zero database reads", !/fetch\(|createClient|Deno\.env|supabase/i.test(PULSE));
check("4.10 the runner pulse path reads only stored snapshots", /buildPulseText/.test(RUNNER) && /from "\.\.\/_shared\/mission-pulse-copy\.ts"/.test(RUNNER));

// ---------------------------------------------------------------------------
// 5. Copy safety — no rewards, no per-member tracking.
// ---------------------------------------------------------------------------
const copySurfaces = stripComments([CARD, PULSE, SETTINGS_UI, SETTINGS_LIB].join("\n"));
check("5.1 no points, rewards, badges, payouts or airdrops anywhere in goal copy", !/\b(points?|rewards?|badges?|payouts?|airdrops?)\b/i.test(copySurfaces));
check("5.2 no quota or mandatory-engagement language", !/\b(quota|you must like|required engagement|mandatory)\b/i.test(copySurfaces));
check("5.3 no per-member engagement tracking is introduced", !/per[_-]?user_engagement|member_engagement|engagement_tracking/i.test([CARD, PULSE, TRANSPORT, RUNNER, SQL].join("\n")));
check("5.1b goal copy constants carry no reward language", !/points?|rewards?|badges?|payouts?/i.test([GOAL_HEADING, STRETCH_GOAL_HEADING, PRIMARY_GOAL_REACHED, pulseText].join("\n")));
check("5.4 the goal is documented as a project-level aggregate", /PROJECT-level/.test(CARD) || /PROJECT-level/.test(PULSE));

// ---------------------------------------------------------------------------
// 6. Transport + settings UI.
// ---------------------------------------------------------------------------
check("6.1 the transport reads the goal from the mission's own immutable config", /effective_config/.test(TRANSPORT) && /missionGoal/.test(TRANSPORT));
check("6.2 the transport reads the stretch target and provenance", /stretch_goal_target/.test(TRANSPORT) && /goal_source/.test(TRANSPORT));
check("6.3 a pre-SE-13 mission without a stretch target still renders", /stretchTarget/.test(TRANSPORT) && /null/.test(TRANSPORT));
check("6.4 the existing settings screen was relabelled, not duplicated", /Primary Goal/.test(SETTINGS_UI) && /Goal target/.test(SETTINGS_UI));
check("6.5 the stored settings keys are unchanged for DB compatibility", /milestone_type/.test(SETTINGS_UI) && /milestone_target/.test(SETTINGS_UI) && /milestone_type: MissionMilestoneType/.test(SETTINGS_LIB));
check("6.6 the settings validation speaks goal language", /A Primary Goal needs a whole target number above zero/.test(SETTINGS_LIB));

// ---------------------------------------------------------------------------
// 7. SE-13.1 — no card may be rendered from a pre-refresh mission row.
// ---------------------------------------------------------------------------
const sendBody = TRANSPORT.slice(TRANSPORT.indexOf("async function handleSend("), TRANSPORT.indexOf("async function handleEdit("));
const editBody = TRANSPORT.slice(TRANSPORT.indexOf("async function handleEdit("));
const reloadBody = TRANSPORT.slice(
  TRANSPORT.indexOf("async function reloadMissionRow("),
  TRANSPORT.indexOf("function missionGoal("),
);

check("7.1 an authoritative mission reload helper exists", /async function reloadMissionRow\(/.test(TRANSPORT));
check("7.2 the reload is scoped to the exact mission id AND workspace id", /\.from\("social_missions"\)[\s\S]*?\.eq\("id", missionId\)[\s\S]*?\.eq\("workspace_id", workspaceId\)/.test(reloadBody));
check("7.3 the reload performs zero provider calls", !/fetch\(|lookupXPostMetrics|X_API_BEARER_TOKEN/.test(reloadBody));
check("7.4 the reload performs zero Telegram calls", !/telegramCall|sendMessage|sendPhoto|editMessage/i.test(reloadBody));
check("7.5 the reload writes nothing", !/\.insert\(|\.update\(|\.upsert\(|\.rpc\(/.test(reloadBody));
check("7.6 the reload returns null instead of guessing", /return null;/.test(reloadBody));

check("7.7 send reloads the mission after the launch metrics read", sendBody.indexOf("attemptLaunchMetricsRead(") < sendBody.indexOf("reloadMissionRow("));
check("7.8 send reloads the mission before the card is rendered", sendBody.indexOf("reloadMissionRow(") < sendBody.indexOf("renderAuthoritativeCard("));
check("7.9 send renders from the refreshed row", /renderAuthoritativeCard\(\s*admin,\s*workspaceId,\s*refreshedMission,/.test(sendBody));
check("7.10 a failed reload refuses to send a stale first card", /could not be re-read after its metrics refresh; nothing was sent/.test(sendBody));
check("7.11 send still performs at most one launch metrics read", sendBody.split("attemptLaunchMetricsRead(").length === 2);
check("7.12 send adds no second X lookup", !/lookupXPostMetrics/.test(sendBody));

check("7.13 a manual final refresh reloads after the final metrics read", editBody.indexOf("attemptFinalMetricsRead(") < editBody.indexOf("reloadMissionRow("));
check("7.14 the completion card is rendered after that reload", editBody.indexOf("reloadMissionRow(") < editBody.indexOf("renderAuthoritativeCard("));
check("7.15 edit still performs at most one final metrics read", editBody.split("attemptFinalMetricsRead(").length === 2);
check("7.16 a failed final reload refuses to edit with stale state", /could not be re-read after its final metrics refresh; nothing was edited/.test(editBody));
check("7.17 the reload only runs when a metric refresh ran", /let renderMission = mission;/.test(editBody) && /renderAuthoritativeCard\(admin, workspaceId, renderMission, transportKind\)/.test(editBody));
check("7.18 the reload is confined to the refresh branch", editBody.indexOf("reloadMissionRow(") > editBody.indexOf("args.finalRefresh === true"));
check("7.19 no new Telegram call is introduced by the reload", TRANSPORT.split("telegramCall(").length === read("backend-source/edge-functions/social-mission-telegram/index.ts").split("telegramCall(").length);
check("7.20 the auto-goal formula is untouched by this hardening", /GREATEST\(_baseline \+ 25, ceil\(_baseline \* 1\.30\)::bigint\)/.test(SQL));

// ---------------------------------------------------------------------------
if (failures.length > 0) {
  console.error(`SE-13 FAILURES (${failures.length}):`);
  for (const f of failures) console.error(` - ${f}`);
  console.error(`passed: ${passed}`);
  process.exit(1);
}
console.log(`SE-13 social mission goal regression: ${passed}/${passed} checks passed.`);
