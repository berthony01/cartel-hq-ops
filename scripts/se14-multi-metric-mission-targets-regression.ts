/**
 * SE-14 regression — Multi-Metric Mission Targets + Overall Momentum.
 *
 * ZERO network, ZERO database, ZERO secrets, ZERO Telegram and ZERO X calls.
 * Every assertion is a static source/SQL check or a pure computation over the
 * frozen SE-14 rules.
 *
 * Run: bun scripts/se14-multi-metric-mission-targets-regression.ts
 */

import { readFileSync } from "node:fs";
import {
  SUPPORT_FLOOR_ADD,
  computeMetricTargets,
  computeSupportTarget,
  supportTargetStep,
} from "../backend-source/edge-functions/_shared/mission-metric-targets";
import {
  EMPTY_METRICS,
  GOAL_BAR_CELLS,
  MOMENTUM_LABEL,
  PRIMARY_GOAL_LABEL,
  PRIMARY_GOAL_REACHED,
  STRETCH_GOAL_HEADING,
  TARGETS_HEADING,
  TELEGRAM_CAPTION_MAX,
  momentumBar,
  overallMomentum,
  renderMissionCard,
  renderTargetLines,
  targetProgress,
  type CanonicalMetrics,
  type MissionGoal,
  type MissionMetricTargets,
} from "../backend-source/edge-functions/social-mission-telegram/card";
import {
  buildPulseText,
  pulseMomentumLine,
  pulseTargetsLine,
} from "../backend-source/edge-functions/_shared/mission-pulse-copy";

let passed = 0;
const failures: string[] = [];
function check(name: string, condition: boolean): void {
  if (condition) passed += 1;
  else failures.push(name);
}

const read = (p: string): string => readFileSync(p, "utf8");
/** Copy assertions run on EXECUTABLE source only; explanatory prose in
 *  comments legitimately names the mechanics SE-14 forbids. */
const stripComments = (src: string): string =>
  src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|\s)--.*$/gm, "$1").replace(/^\s*\/\/.*$/gm, "");

const SQL = read("docs/sql/SE14_multi_metric_mission_targets.sql");
const CARD = read("backend-source/edge-functions/social-mission-telegram/card.ts");
const TRANSPORT = read("backend-source/edge-functions/social-mission-telegram/index.ts");
const PULSE = read("backend-source/edge-functions/_shared/mission-pulse-copy.ts");
const RUNNER = read("backend-source/edge-functions/social-mission-runner/index.ts");
const SETTINGS_UI = read("src/components/cartel/MissionSettingsCard.tsx");
const TARGETS_MODULE = read("backend-source/edge-functions/_shared/mission-metric-targets.ts");

const m = (over: Partial<CanonicalMetrics>): CanonicalMetrics => ({ ...EMPTY_METRICS, ...over });

// ---------------------------------------------------------------------------
// 1. Rounding step and supporting-target derivation.
// ---------------------------------------------------------------------------
check("1.1 step is 1 below 20", supportTargetStep(0) === 1 && supportTargetStep(19) === 1);
check("1.2 step is 5 below 100", supportTargetStep(20) === 5 && supportTargetStep(99) === 5);
check("1.3 step is 10 below 500", supportTargetStep(100) === 10 && supportTargetStep(499) === 10);
check("1.4 step is 25 at and above 500", supportTargetStep(500) === 25 && supportTargetStep(50_000) === 25);
check("1.5 floor adds are frozen", SUPPORT_FLOOR_ADD.likes === 3 && SUPPORT_FLOOR_ADD.replies === 2 && SUPPORT_FLOOR_ADD.reposts === 2 && SUPPORT_FLOOR_ADD.bookmarks === 1);
check("1.6 a null baseline yields no target", computeSupportTarget(null, 3) === null);
check("1.7 a negative baseline yields no target", computeSupportTarget(-1, 3) === null);
check("1.8 unknown is never coerced to zero", computeSupportTarget(null, 1) !== 0);
check("1.9 likes 4 -> 7", computeSupportTarget(4, 3) === 7);
check("1.10 replies 0 -> 2", computeSupportTarget(0, 2) === 2);
check("1.11 reposts 1 -> 3", computeSupportTarget(1, 2) === 3);
check("1.12 bookmarks 0 -> 1", computeSupportTarget(0, 1) === 1);
check("1.13 a large baseline rounds up to the 25 step", computeSupportTarget(500, 3) === 750);
check("1.14 every target strictly exceeds its own baseline", [0, 1, 4, 19, 20, 99, 100, 499, 500, 5000].every((b) => (computeSupportTarget(b, 1) as number) > b));

// ---------------------------------------------------------------------------
// 2. The PEPE worked example: 56 / 4 / 0 / 1 / 0 with Primary Views = 90.
// ---------------------------------------------------------------------------
const pepe = computeMetricTargets(
  { views: 56, likes: 4, comments: 0, shares: 1, saves: 0 },
  "VIEWS",
  90,
);
check("2.1 views pin to the explicit primary target", pepe?.views === 90);
check("2.2 likes 4 -> 7", pepe?.likes === 7);
check("2.3 replies 0 -> 2", pepe?.replies === 2);
check("2.4 reposts 1 -> 3", pepe?.reposts === 3);
check("2.5 bookmarks 0 -> 1", pepe?.bookmarks === 1);

// ---------------------------------------------------------------------------
// 3. Primary Goal precedence and null honesty.
// ---------------------------------------------------------------------------
const likesPrimary = computeMetricTargets({ views: 56, likes: 4, comments: 0, shares: 1, saves: 0 }, "LIKES", 40);
check("3.1 an explicit LIKES primary overrides the auto likes target", likesPrimary?.likes === 40);
check("3.2 views still derive automatically when the primary is not VIEWS", typeof likesPrimary?.views === "number" && likesPrimary.views !== 40);
const totalPrimary = computeMetricTargets({ views: 56, likes: 4, comments: 0, shares: 1, saves: 0 }, "TOTAL_INTERACTIONS", 100);
check("3.3 TOTAL_INTERACTIONS never becomes a sixth metric target", !("total" in (totalPrimary ?? {})) && !("interactions" in (totalPrimary ?? {})));
check("3.4 TOTAL_INTERACTIONS never pins any individual metric to its target", totalPrimary?.likes === 7 && totalPrimary?.replies === 2 && totalPrimary?.reposts === 3);
const partial = computeMetricTargets({ views: null, likes: 4, comments: null, shares: null, saves: null }, "NONE", null);
check("3.5 unknown metrics are omitted, not zeroed", partial?.likes === 7 && partial?.views === undefined && partial?.replies === undefined && partial?.bookmarks === undefined);
check("3.6 a fully unknown first snapshot yields no target set", computeMetricTargets({ views: null, likes: null, comments: null, shares: null, saves: null }, "NONE", null) === null);
check("3.7 a missing first snapshot yields no target set", computeMetricTargets(null, "VIEWS", 90) === null);
check("3.8 bookmarks are supporting only and never a primary type", !/'BOOKMARKS'/.test(TARGETS_MODULE) && !/BOOKMARKS/.test(stripComments(CARD)));

// ---------------------------------------------------------------------------
// 4. Card scorecard and Overall Momentum.
// ---------------------------------------------------------------------------
const targets: MissionMetricTargets = { views: 90, likes: 7, replies: 2, reposts: 3, bookmarks: 1 };
const latest = m({ views: 45, likes: 7, comments: 1, shares: 0, saves: 0 });
const rows = targetProgress(targets, latest);
check("4.1 every known target and metric pair renders", rows.length === 5);
check("4.2 percentages are floored", rows.find((r) => r.key === "views")?.percent === 50);
check("4.3 each metric percent is capped at 100", targetProgress({ likes: 5 }, m({ likes: 500 }))[0].percent === 100);
check("4.4 momentum is the equal-weight mean of available metrics", overallMomentum(targets, latest) === Math.floor((50 + 100 + 50 + 0 + 0) / 5));
check("4.5 views are not weighted more heavily", overallMomentum({ views: 100, likes: 100 }, m({ views: 100, likes: 0 })) === 50);
check("4.6 unavailable metrics are excluded from the denominator", overallMomentum({ views: 100, likes: 100 }, m({ views: 50, likes: null })) === 50);
check("4.7 momentum is omitted when nothing is computable", overallMomentum(targets, m({})) === null && overallMomentum(null, latest) === null);
check("4.8 the momentum bar has exactly ten cells", [...momentumBar(37)].length === GOAL_BAR_CELLS);
check("4.9 the bar fills proportionally", momentumBar(100) !== momentumBar(0) && momentumBar(0) === momentumBar(9));

const goal: MissionGoal = { type: "VIEWS", target: 90, stretchTarget: 140, source: "EXPLICIT" };
const lines = renderTargetLines(targets, latest, goal, false);
check("4.10 the scorecard heading is used", lines[0] === TARGETS_HEADING);
check("4.11 each metric line shows current / target and a percent", lines.some((l) => /^👁 Views: 45 \/ 90 · 50%$/.test(l)) && lines.some((l) => l.startsWith("❤️ Likes:")) && lines.some((l) => l.startsWith("💬 Replies:")) && lines.some((l) => l.startsWith("🔁 Reposts:")) && lines.some((l) => l.startsWith("🔖 Bookmarks:")));
check("4.12 overall momentum is shown", lines.some((l) => l.startsWith(`${MOMENTUM_LABEL}: `)));
check("4.13 the primary metric stays identified", lines.some((l) => l === `${PRIMARY_GOAL_LABEL}: Views`));
check("4.14 an unknown metric line is omitted rather than zeroed", !renderTargetLines({ views: 90, likes: 7 }, m({ views: 45 }), null, false).some((l) => l.startsWith("❤️ Likes")));
check("4.15 no scorecard renders when nothing is computable", renderTargetLines(targets, m({}), goal, false).length === 0);
check("4.16 the primary reached marker is absent before the primary target", !lines.includes(PRIMARY_GOAL_REACHED));
check("4.17 the stretch goal is hidden before the primary is reached", !lines.includes(STRETCH_GOAL_HEADING));
const reachedLines = renderTargetLines(targets, m({ views: 120, likes: 1, comments: 1, shares: 1, saves: 1 }), goal, false);
check("4.18 the primary reached marker appears once the primary target is met", reachedLines.includes(PRIMARY_GOAL_REACHED));
check("4.19 the stretch goal appears only after the primary is reached", reachedLines.includes(STRETCH_GOAL_HEADING));
check("4.20 supporting targets alone never mark the primary as reached", !renderTargetLines(targets, m({ views: 1, likes: 999, comments: 999, shares: 999, saves: 999 }), goal, false).includes(PRIMARY_GOAL_REACHED));
check("4.21 supporting targets get no stretch goals of their own", (reachedLines.join("\n").match(new RegExp(STRETCH_GOAL_HEADING, "g")) ?? []).length === 1);
check("4.22 the scorecard is plain text with no markup", !/[*_`<>]/.test(lines.join("\n")));

// ---------------------------------------------------------------------------
// 5. Caption budget in the worst useful case.
// ---------------------------------------------------------------------------
const worstCard = renderMissionCard({
  platform: "x",
  missionStatus: "LIVE",
  projectName: "PEPECARTEL COMMAND NETWORK OPERATIONS",
  ticker: "PCART",
  authorHandle: "pepecartelofficial",
  contentText:
    "PEPECARTEL COMMAND NETWORK is live on X with the longest realistic official post body we would ever attach to a branded mission card, repeated to push the caption budget as far as it can plausibly go in production.",
  canonicalUrl: "https://x.com/pepecartelofficial/status/1234567890123456789",
  baseline: m({ views: 56, likes: 4, comments: 0, shares: 1, saves: 0 }),
  latest: m({ views: 123456, likes: 12345, comments: 1234, shares: 1234, saves: 1234 }),
  goal: { type: "VIEWS", target: 200000, stretchTarget: 300000, source: "AUTO" },
  metricTargets: { views: 200000, likes: 20000, replies: 2000, reposts: 2000, bookmarks: 2000 },
  maxLength: TELEGRAM_CAPTION_MAX,
});
check("5.1 the worst useful caption stays inside the Telegram limit", worstCard.text.length <= TELEGRAM_CAPTION_MAX);
check("5.2 the caption budget constant is unchanged", TELEGRAM_CAPTION_MAX === 1024);
check("5.3 the card still carries the OPEN ON X action", /OPEN ON X/.test(JSON.stringify(worstCard)));
check("5.4 no parse mode is introduced", !/parse_mode/.test(stripComments(CARD)));

// ---------------------------------------------------------------------------
// 6. Pulses — stored state only, informational language only.
// ---------------------------------------------------------------------------
const pulseConfig = { metric_targets: { views: 90, likes: 7, replies: 2, reposts: 3, bookmarks: 1 } };
check("6.1 a pulse reports momentum from stored config", pulseMomentumLine(latest, pulseConfig) === "Mission Momentum: 40%.");
check("6.2 a pulse summarises the known target ratios", (pulseTargetsLine(latest, pulseConfig) ?? "").startsWith("Targets: 45/90 views"));
check("6.3 unknown metrics are omitted from the pulse summary", !(pulseTargetsLine(m({ views: 45 }), pulseConfig) ?? "").includes("likes"));
check("6.4 no target set means no momentum line", pulseMomentumLine(latest, {}) === null && pulseTargetsLine(latest, {}) === null);
check("6.5 unknown metrics never produce a zero pulse line", pulseMomentumLine(m({}), pulseConfig) === null);
const pulseText = buildPulseText(latest, false, { config: pulseConfig, endsAt: null });
check("6.6 the pulse keeps natural participation language", /join the conversation naturally/.test(pulseText));
check("6.7 the pulse carries momentum", /Mission Momentum: /.test(pulseText));
check("6.8 the pulse module performs no provider or database access", !/fetch\(/.test(PULSE) && !/supabase|createClient/i.test(stripComments(PULSE)));
check("6.9 the runner still forwards the mission's own stored config", /buildPulseText\(/.test(RUNNER));
check("6.10 no pulse copy demands mechanical engagement", !/(go like|need \d+ more|everyone repost|must like|quota|reward|points|badge)/i.test(stripComments(PULSE)));

// ---------------------------------------------------------------------------
// 7. Transport — config-only, client can never supply a target set.
// ---------------------------------------------------------------------------
check("7.1 the transport parses the target set from the mission config", /function missionMetricTargets\(/.test(TRANSPORT));
check("7.2 the target set is read from the immutable effective config", /missionMetricTargets[\s\S]{0,900}effective_config/.test(TRANSPORT));
check("7.3 the target set is passed to the card renderer", /metricTargets: missionMetricTargets\(mission\)/.test(TRANSPORT));
check("7.4 only positive integer targets are accepted", /Number\.isInteger\(value\) && value > 0/.test(TRANSPORT));
check("7.5 the SE-13 authoritative reload still precedes the first render", TRANSPORT.indexOf("reloadMissionRow(") < TRANSPORT.indexOf("metricTargets: missionMetricTargets(mission)"));
check("7.6 no client-supplied metric target object is accepted", !/payload[\s\S]{0,80}metric_targets/.test(TRANSPORT) && !/body[\s\S]{0,80}metric_targets/.test(TRANSPORT));
check("7.7 the card renders the scorecard in place of the single-goal block", /targetLines\.length > 0 \? targetLines : renderGoalLines\(/.test(CARD));

// ---------------------------------------------------------------------------
// 8. Prepared migration — establishment gate, immutability, safety.
// ---------------------------------------------------------------------------
check("8.1 the migration is prepared and not applied", /PREPARED ONLY/.test(SQL) && /NOT APPLIED/.test(SQL));
check("8.2 a pure supporting-target helper exists", /CREATE OR REPLACE FUNCTION public\.social_mission_support_target\(/.test(SQL) && /IMMUTABLE/.test(SQL));
check("8.3 a pure target-set helper exists", /CREATE OR REPLACE FUNCTION public\.social_mission_metric_targets\(/.test(SQL));
const targetGate = SQL.slice(SQL.indexOf("IF _provider = 'x-official'\n     AND v_snapshot_inserted"), SQL.indexOf("v_targets_established := v_rows = 1;"));
check("8.4 establishment requires the official X provider", /_provider = 'x-official'/.test(targetGate));
check("8.5 establishment requires a durably inserted snapshot", /AND v_snapshot_inserted/.test(targetGate));
check("8.6 establishment happens only when no target set exists", /metric_targets' IS NULL/.test(targetGate));
check("8.7 the update itself re-asserts immutability", /AND metadata -> 'effective_config' -> 'metric_targets' IS NULL/.test(SQL));
check("8.8 the target set is stored inside the existing effective config", /'\{effective_config\}'/.test(SQL) && /'metric_targets', v_metric_targets/.test(SQL));
check("8.9 provenance is recorded", /'metric_targets_source', 'AUTO'/.test(SQL));
check("8.10 the target set is resolved after the Primary Goal", SQL.indexOf("SE-13 — establish the MISSION GOAL") < SQL.indexOf("SE-14 — establish the SUPPORTING METRIC TARGET SET"));
check("8.11 the target set is resolved before accomplishment is evaluated", SQL.indexOf("SE-14 — establish the SUPPORTING METRIC TARGET SET") < SQL.indexOf("Goal accomplishment."));
check("8.12 supporting targets never set accomplished_at", !/metric_targets[\s\S]{0,400}accomplished_at =/.test(SQL));
check("8.13 accomplishment is still driven only by the primary goal", /v_progress >= v_target_value/.test(SQL));
check("8.14 the explicit primary goal still wins", /EXPLICIT workspace goal ALWAYS wins/.test(SQL) && SQL.indexOf("EXPLICIT workspace goal ALWAYS wins") < SQL.indexOf("ELSIF v_goal_source IS NULL"));
check("8.15 the SE-13.2 auto-goal gate is preserved verbatim", /ELSIF v_goal_source IS NULL\n        AND _provider = 'x-official'\n        AND v_snapshot_inserted\n        AND _views IS NOT NULL AND _views >= 0 THEN/.test(SQL));
// SE-14 REUSES the SE-13 primary-goal helper and never redefines it, so the
// SE-13 rounding authority is asserted in its own prepared migration.
check(
  "8.16 the SE-13 primary-goal rounding is untouched and never redefined by SE-14",
  /GREATEST\(_baseline \+ 25, ceil\(_baseline \* 1\.30\)::bigint\)/.test(
    read("docs/sql/SE13_social_mission_goal_experience.sql"),
  ) && !/FUNCTION public\.social_mission_auto_goal/.test(SQL),
);
check("8.17 the supporting formula matches the frozen multiplier", /GREATEST\(_baseline \+ _floor_add, ceil\(_baseline \* 1\.50\)::bigint\)/.test(SQL));
check("8.18 the rounding steps are frozen in SQL", /WHEN _baseline < 20 THEN 1/.test(SQL) && /WHEN _baseline < 100 THEN 5/.test(SQL) && /WHEN _baseline < 500 THEN 10/.test(SQL) && /ELSE 25/.test(SQL));
check("8.19 a NULL baseline yields no SQL target", /IF _baseline IS NULL OR _baseline < 0 OR _floor_add IS NULL THEN\n    RETURN NULL;/.test(SQL));
check("8.20 the config reader ACL stays service-role only", /GRANT EXECUTE ON FUNCTION public\.social_mission_effective_config\(uuid\) TO service_role, postgres;/.test(SQL));
check("8.21 the new helpers are not exposed to anon or authenticated", /REVOKE ALL ON FUNCTION public\.social_mission_support_target\(bigint, bigint\) FROM PUBLIC, anon, authenticated;/.test(SQL));
check("8.22 no new table is created", !/CREATE TABLE/i.test(SQL));
check("8.23 no destructive DDL is present", !/DROP TABLE|DROP COLUMN|TRUNCATE|DELETE FROM/i.test(SQL));
check("8.24 the backfill touches LIVE missions only", /WHERE sm\.status = 'LIVE'/.test(SQL));
check("8.25 the backfill never rewrites an existing target set", /AND sm\.metadata -> 'effective_config' -> 'metric_targets' IS NULL/.test(SQL));
check("8.26 the backfill uses stored baseline columns only", /sm\.baseline_views, sm\.baseline_likes, sm\.baseline_comments/.test(SQL));
check("8.27 the snapshot idempotency contract is preserved", /ON CONFLICT \(mission_id, provider, poll_bucket\) DO NOTHING/.test(SQL));
check("8.28 usage telemetry is unchanged", /'social_x_tracked_post_read', 1/.test(SQL));
check("8.29 the baseline is still written exactly once", /v_baseline_written := v_rows = 1;/.test(SQL));
check("8.30 the migration introduces no reward machinery", !/(reward|points|badge|payout|token_grant)/i.test(stripComments(SQL)));

// ---------------------------------------------------------------------------
// 9. Product safety — no raid checklist, no per-user requirement.
// ---------------------------------------------------------------------------
const CARD_CODE = stripComments(CARD);
check("9.1 the card never instructs a member to like or repost", !/(you must|please like|everyone like|go repost|required to)/i.test(CARD_CODE));
check("9.2 the card carries no reward or points language", !/(reward|points|badge|payout|streak|quota)/i.test(CARD_CODE));
check("9.3 no per-user engagement identity enters the target calculation", !/(user_id|telegram_user_id|member)/i.test(stripComments(TARGETS_MODULE)));
check("9.4 the pure target module performs no network or database access", !/fetch\(|createClient|supabase/i.test(stripComments(TARGETS_MODULE)));
check("9.5 no second goal table or settings system is introduced", !/CREATE TABLE/i.test(SQL) && !/metric_targets/i.test(read("src/lib/social-mission-settings.ts")));
check("9.6 HQ settings gains only an explanatory note", /Supporting Targets are generated automatically/.test(SETTINGS_UI));
check("9.7 HQ settings adds no manual supporting-target fields", !/Likes target|Replies target|Reposts target|Bookmarks target/.test(SETTINGS_UI));
check("9.8 the Primary Goal setting is unchanged", /Primary Goal/.test(SETTINGS_UI));

// ---------------------------------------------------------------------------
if (failures.length > 0) {
  console.error(`SE-14 FAILURES (${failures.length}):`);
  for (const f of failures) console.error(` - ${f}`);
  console.error(`passed: ${passed}`);
  process.exit(1);
}
console.log(`SE-14 multi-metric mission targets regression: ${passed}/${passed} checks passed.`);
