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
  "This Social Mission has hit its milestone and is still open. Read the official post above and join the conversation naturally if you have something to add.";

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
 * Optional milestone progress, read ONLY from the mission's own immutable
 * effective config and the latest STORED snapshot. A missing milestone is not
 * a failure and simply prints nothing. An unknown metric prints nothing —
 * never 0, and never a fabricated percentage.
 */
export const PULSE_MILESTONE_METRIC: Record<string, keyof XCanonicalMetrics | "total"> = {
  VIEWS: "views",
  LIKES: "likes",
  REPLIES: "comments",
  REPOSTS: "shares",
  TOTAL_INTERACTIONS: "total",
};

export function pulseMilestoneLine(
  metrics: XCanonicalMetrics | null,
  config: Record<string, unknown> | null,
): string | null {
  if (!config) return null;
  const type = String(config["milestone_type"] ?? "NONE").toUpperCase();
  const target = Number(config["milestone_target"]);
  const key = PULSE_MILESTONE_METRIC[type];
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

  const label = type === "TOTAL_INTERACTIONS" ? "interactions" : type.toLowerCase();
  if (progress >= target) return `Milestone reached: ${progress} / ${target} ${label}.`;
  return `Milestone progress: ${progress} / ${target} ${label}.`;
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

export function buildPulseText(
  metrics: XCanonicalMetrics | null,
  accomplished: boolean,
  options: { endsAt?: unknown; config?: Record<string, unknown> | null; nowMs?: number } = {},
): string {
  const head = accomplished ? PULSE_ACCOMPLISHED_TEXT : PULSE_TEXT;
  const lines = [
    pulseMetricLine(metrics),
    pulseMilestoneLine(metrics, options.config ?? null),
    pulseRemainingLine(options.endsAt, options.nowMs ?? Date.now()),
  ].filter((line): line is string => typeof line === "string" && line.length > 0);
  return lines.length === 0 ? head : `${head}\n\n${lines.join("\n")}`;
}
