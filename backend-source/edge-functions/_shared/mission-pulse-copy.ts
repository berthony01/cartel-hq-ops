/**
 * Step 1 - PURE Social Mission pulse copy shared by the runner.
 *
 * DEPLOYMENT NOTE: deploy this module in the functions _shared folder
 * alongside `social-mission-runner`, exactly like `_shared/x-metrics.ts`.
 *
 * Hard boundaries: ZERO network access, ZERO database access. This module is
 * string building over values the caller already read from STORED state, so a
 * pulse can never cause a paid X read. Unknown metrics stay unknown and are
 * never coerced to 0.
 */

import type { XCanonicalMetrics } from "./x-metrics.ts";

/**
 * Pulse copy. Short, factual, and about natural participation only. No
 * quotas, points, rewards, streaks, counts or mandatory likes/reposts, and no
 * claim about what the post will do.
 */
export const PULSE_TEXT =
  "This Social Mission is still active. Read the official post above and join the conversation naturally if you have something to add.";

export const PULSE_ACCOMPLISHED_TEXT =
  "This Social Mission has reached its Primary Goal and is still open. Read the official post above and join the conversation naturally if you have something to add.";

/**
 * SE-5 / SE-6 Step 1 Pulse 2.0 — the pulse may quote the LATEST STORED
 * snapshot, but it performs ZERO provider reads of its own. Unknown metrics
 * are omitted, never printed as 0, and the line is dropped entirely when
 * nothing is known.
 */
export function pulseMetricLine(metrics: XCanonicalMetrics | null): string | null {
  if (!metrics) return null;
  const parts: string[] = [];
  if (metrics.views !== null) parts.push(`${metrics.views} views`);
  if (metrics.likes !== null) parts.push(`${metrics.likes} likes`);
  if (metrics.comments !== null) parts.push(`${metrics.comments} replies`);
  if (metrics.shares !== null) parts.push(`${metrics.shares} reposts`);
  if (parts.length === 0) return null;
  return `Last observed: ${parts.join(" · ")}.`;
}

/**
 * SE-13 — optional MISSION GOAL progress, read ONLY from the mission's own
 * immutable effective config and the latest STORED snapshot. A missing goal is
 * not a failure and simply prints nothing. An unknown metric prints nothing —
 * never 0, and never a fabricated percentage. The goal is a PROJECT-level
 * aggregate target: no reward, no quota, no per-member requirement.
 */
export const PULSE_GOAL_METRIC: Record<string, keyof XCanonicalMetrics | "total"> = {
  VIEWS: "views",
  LIKES: "likes",
  REPLIES: "comments",
  REPOSTS: "shares",
  TOTAL_INTERACTIONS: "total",
};

/** Pre-SE-13 alias kept so nothing that imports the old name breaks. */
export const PULSE_MILESTONE_METRIC = PULSE_GOAL_METRIC;

const PULSE_GOAL_LABELS: Record<string, string> = {
  VIEWS: "views",
  LIKES: "likes",
  REPLIES: "replies",
  REPOSTS: "reposts",
  TOTAL_INTERACTIONS: "interactions",
};

type PulseGoal = {
  type: string;
  label: string;
  target: number;
  stretchTarget: number | null;
  progress: number;
};

/** Integer percentage, floored and capped at 100 for display. */
export function pulseGoalPercent(progress: number, target: number): number {
  if (!Number.isFinite(target) || target <= 0) return 0;
  return Math.max(0, Math.min(100, Math.floor((progress / target) * 100)));
}

function resolvePulseGoal(
  metrics: XCanonicalMetrics | null,
  config: Record<string, unknown> | null,
): PulseGoal | null {
  if (!config) return null;
  const type = String(config["milestone_type"] ?? "NONE").toUpperCase();
  const target = Number(config["milestone_target"]);
  const key = PULSE_GOAL_METRIC[type];
  if (!key || !Number.isInteger(target) || target <= 0) return null;
  if (!metrics) return null;

  let progress: number | null;
  if (key === "total") {
    // NULL-HONEST: TOTAL_INTERACTIONS is computable ONLY when ALL THREE
    // components are known. If any one of likes / replies / reposts is
    // unknown, the total is unknown — an unknown component is never 0.
    progress =
      metrics.likes === null || metrics.comments === null || metrics.shares === null
        ? null
        : metrics.likes + metrics.comments + metrics.shares;
  } else {
    progress = metrics[key];
  }
  if (progress === null) return null;

  const stretchRaw = Number(config["stretch_goal_target"]);
  const stretchTarget = Number.isInteger(stretchRaw) && stretchRaw > target ? stretchRaw : null;
  return {
    type,
    label: PULSE_GOAL_LABELS[type] ?? type.toLowerCase(),
    target,
    stretchTarget,
    progress,
  };
}

/**
 * Primary Goal line. Returns null when there is no computable goal.
 * Reached: `Primary Goal reached: 120 / 100 views.`
 * Otherwise: `Goal progress: 40 / 100 views (40%).`
 */
export function pulseGoalLine(
  metrics: XCanonicalMetrics | null,
  config: Record<string, unknown> | null,
): string | null {
  const goal = resolvePulseGoal(metrics, config);
  if (!goal) return null;
  if (goal.progress >= goal.target) {
    return `Primary Goal reached: ${goal.progress} / ${goal.target} ${goal.label}.`;
  }
  const percent = pulseGoalPercent(goal.progress, goal.target);
  return `Goal progress: ${goal.progress} / ${goal.target} ${goal.label} (${percent}%).`;
}

/** Pre-SE-13 alias kept so nothing that imports the old name breaks. */
export const pulseMilestoneLine = pulseGoalLine;

/**
 * Stretch Goal line. Motivational display only, same metric as the primary,
 * and shown ONLY once the primary goal has been reached.
 */
export function pulseStretchGoalLine(
  metrics: XCanonicalMetrics | null,
  config: Record<string, unknown> | null,
): string | null {
  const goal = resolvePulseGoal(metrics, config);
  if (!goal || goal.stretchTarget === null) return null;
  if (goal.progress < goal.target) return null;
  const percent = pulseGoalPercent(goal.progress, goal.stretchTarget);
  return `Stretch Goal: ${goal.progress} / ${goal.stretchTarget} ${goal.label} (${percent}%).`;
}

/**
 * Useful, deliberately approximate remaining time from the mission's own
 * `ends_at`. Never a countdown to the second, and omitted when `ends_at` is
 * unknown or already in the past.
 */
export function pulseRemainingLine(endsAt: unknown, nowMs: number = Date.now()): string | null {
  if (typeof endsAt !== "string") return null;
  const ends = Date.parse(endsAt);
  if (!Number.isFinite(ends)) return null;
  const remainingMs = ends - nowMs;
  if (remainingMs <= 0) return null;
  const minutes = Math.round(remainingMs / 60_000);
  if (minutes <= 0) return "Less than a minute left.";
  if (minutes === 1) return "About 1 minute left.";
  if (minutes < 60) return `About ${minutes} minutes left.`;
  const hours = Math.round(minutes / 60);
  return hours === 1 ? "About 1 hour left." : `About ${hours} hours left.`;
}

/**
 * SE-14 — the immutable supporting target set, read ONLY from the mission's own
 * stored effective config. Zero provider access, zero database access.
 */
const PULSE_TARGET_METRIC: Record<string, keyof XCanonicalMetrics> = {
  views: "views",
  likes: "likes",
  replies: "comments",
  reposts: "shares",
  bookmarks: "saves",
};

const PULSE_TARGET_LABELS: Record<string, string> = {
  views: "views",
  likes: "likes",
  replies: "replies",
  reposts: "reposts",
  bookmarks: "bookmarks",
};

type PulseTargetRow = { label: string; progress: number; target: number; percent: number };

function pulseTargetRows(
  metrics: XCanonicalMetrics | null,
  config: Record<string, unknown> | null,
): PulseTargetRow[] {
  if (!metrics || !config) return [];
  const raw = config["metric_targets"];
  if (!raw || typeof raw !== "object") return [];
  const targets = raw as Record<string, unknown>;
  const rows: PulseTargetRow[] = [];
  for (const key of Object.keys(PULSE_TARGET_METRIC)) {
    const target = Number(targets[key]);
    if (!Number.isInteger(target) || target <= 0) continue;
    const progress = metrics[PULSE_TARGET_METRIC[key]];
    if (progress === null) continue; // unknown is never 0
    rows.push({
      label: PULSE_TARGET_LABELS[key],
      progress,
      target,
      percent: pulseGoalPercent(progress, target),
    });
  }
  return rows;
}

/**
 * Equal-weight mean of each AVAILABLE metric's capped percent, floored.
 * Informational only — no quota, no reward, no call for mechanical engagement.
 */
export function pulseMomentumLine(
  metrics: XCanonicalMetrics | null,
  config: Record<string, unknown> | null,
): string | null {
  const rows = pulseTargetRows(metrics, config);
  if (rows.length === 0) return null;
  const sum = rows.reduce((acc, row) => acc + row.percent, 0);
  const momentum = Math.max(0, Math.min(100, Math.floor(sum / rows.length)));
  return `Mission Momentum: ${momentum}%.`;
}

/** One concise summary of the known target ratios. */
export function pulseTargetsLine(
  metrics: XCanonicalMetrics | null,
  config: Record<string, unknown> | null,
): string | null {
  const rows = pulseTargetRows(metrics, config);
  if (rows.length === 0) return null;
  return `Targets: ${rows.map((r) => `${r.progress}/${r.target} ${r.label}`).join(" · ")}.`;
}

export function buildPulseText(
  metrics: XCanonicalMetrics | null,
  accomplished: boolean,
  options: { endsAt?: unknown; config?: Record<string, unknown> | null; nowMs?: number } = {},
): string {
  const head = accomplished ? PULSE_ACCOMPLISHED_TEXT : PULSE_TEXT;
  const config = options.config ?? null;
  const lines = [
    pulseMetricLine(metrics),
    pulseGoalLine(metrics, config),
    pulseStretchGoalLine(metrics, config),
    pulseMomentumLine(metrics, config),
    pulseTargetsLine(metrics, config),
    pulseRemainingLine(options.endsAt, options.nowMs ?? Date.now()),
  ].filter((line): line is string => typeof line === "string" && line.length > 0);
  return lines.length === 0 ? head : `${head}\n\n${lines.join("\n")}`;
}
