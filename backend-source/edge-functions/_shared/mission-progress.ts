/**
 * SE-6 — pure mission progress logic shared by `social-mission-runner` and
 * `social-mission-telegram`.
 *
 * DEPLOYMENT NOTE: deploy as `supabase/functions/_shared/mission-progress.ts`
 * alongside both functions, exactly like `_shared/x-metrics.ts`.
 *
 * Hard boundaries, frozen for SE-6:
 * - ZERO network access. This module is arithmetic and string building only.
 * - Metric refresh resolution is FIVE MINUTES. A viewer never triggers a read:
 *   the only reader is the centralized cron worker.
 * - Pulses fire on THRESHOLD CROSSINGS since the last pulse, never on a timer
 *   and never twice for the same crossing. Simultaneous crossings are combined
 *   into ONE message.
 * - Milestones are idempotent keys. First entry only, never re-announced.
 * - Unknown metrics stay unknown. Nothing is ever coerced to 0.
 */

import type { XCanonicalMetrics } from "./x-metrics.ts";

/** Centralized refresh cadence. Requirement 2 / requirement 3. */
export const REFRESH_INTERVAL_MINUTES = 5;
export const REFRESH_INTERVAL_MS = REFRESH_INTERVAL_MINUTES * 60_000;

/**
 * Five-minute snapshot bucket. Two invocations inside the same window collapse
 * onto one bucket, so the unique `(mission, provider, poll_bucket)` index makes
 * a duplicate X read pointless and a duplicate snapshot impossible.
 */
export function refreshBucket(atMs: number = Date.now()): string {
  return new Date(Math.floor(atMs / REFRESH_INTERVAL_MS) * REFRESH_INTERVAL_MS).toISOString();
}

/** Requirement 4 — frozen pulse defaults. */
export type PulseDeltas = {
  views: number;
  likes: number;
  shares: number;
  comments: number;
};

export const DEFAULT_PULSE_DELTAS: PulseDeltas = {
  views: 100,
  likes: 10,
  shares: 5,
  comments: 5,
};

export type PulseCrossing = {
  metric: "views" | "likes" | "shares" | "comments";
  label: string;
  step: number;
  gained: number;
  total: number;
};

const METRIC_LABEL: Record<PulseCrossing["metric"], string> = {
  views: "views",
  likes: "likes",
  shares: "reposts",
  comments: "replies",
};

export function normalizePulseDeltas(raw: unknown): PulseDeltas {
  const source = (raw ?? {}) as Record<string, unknown>;
  const pick = (key: keyof PulseDeltas): number => {
    const value = source[key];
    if (typeof value !== "number" || !Number.isFinite(value)) return DEFAULT_PULSE_DELTAS[key];
    const step = Math.floor(value);
    return step > 0 ? step : DEFAULT_PULSE_DELTAS[key];
  };
  return { views: pick("views"), likes: pick("likes"), shares: pick("shares"), comments: pick("comments") };
}

/**
 * Threshold crossings since the LAST PULSED marks. A metric only contributes
 * when its own step was fully crossed; a partial gain carries forward because
 * the mark is only advanced by whole steps.
 */
export function evaluatePulseCrossings(
  marks: Partial<XCanonicalMetrics> | null,
  current: XCanonicalMetrics,
  deltas: PulseDeltas = DEFAULT_PULSE_DELTAS,
): { crossings: PulseCrossing[]; nextMarks: Record<PulseCrossing["metric"], number | null> } {
  const nextMarks: Record<PulseCrossing["metric"], number | null> = {
    views: null,
    likes: null,
    shares: null,
    comments: null,
  };
  const crossings: PulseCrossing[] = [];

  for (const metric of ["views", "likes", "shares", "comments"] as const) {
    const now = current[metric];
    const mark = marks ? (marks[metric] ?? null) : null;
    if (typeof now !== "number") {
      nextMarks[metric] = typeof mark === "number" ? mark : null;
      continue;
    }
    if (typeof mark !== "number") {
      // First observation establishes the baseline mark. It never pulses.
      nextMarks[metric] = now;
      continue;
    }
    const step = deltas[metric];
    const gained = now - mark;
    if (gained < step) {
      // Includes a decreasing metric: the mark never moves backwards.
      nextMarks[metric] = mark;
      continue;
    }
    const steps = Math.floor(gained / step);
    nextMarks[metric] = mark + steps * step;
    crossings.push({
      metric,
      label: METRIC_LABEL[metric],
      step,
      gained: steps * step,
      total: now,
    });
  }

  return { crossings, nextMarks };
}

/** ONE combined message for all crossings observed in the same refresh. */
export function buildCrossingPulseText(crossings: readonly PulseCrossing[]): string | null {
  if (crossings.length === 0) return null;
  const parts = crossings.map((c) => `+${c.gained} ${c.label} (${c.total} total)`);
  return `Mission momentum: ${parts.join(" · ")}.`;
}

/** Requirement 5 — idempotent milestone keys. */
export const MILESTONE_ACTIVE = "MISSION_ACTIVE";
export const MILESTONE_TRENDING = "PROJECT_TRENDING";
export const MILESTONE_CLOSING_SOON = "MISSION_CLOSING_SOON";
export const MILESTONE_COMPLETED = "MISSION_COMPLETED";
export const TIER_COUNT = 10;

export function tierKey(tier: number): string {
  return `TIER_${tier}`;
}

export const MILESTONE_KEYS: readonly string[] = [
  MILESTONE_ACTIVE,
  ...Array.from({ length: TIER_COUNT }, (_, i) => tierKey(i + 1)),
  MILESTONE_TRENDING,
  MILESTONE_CLOSING_SOON,
  MILESTONE_COMPLETED,
];

export const MILESTONE_COPY: Record<string, string> = {
  [MILESTONE_ACTIVE]: "Mission active.",
  [MILESTONE_TRENDING]: "Project now trending.",
  [MILESTONE_CLOSING_SOON]: "Mission closing soon.",
  [MILESTONE_COMPLETED]: "Mission completed.",
};

export type TierTarget = { tier: number; views: number | null; likes: number | null; shares: number | null; comments: number | null };

/** Tier 1 -> Tier 10 default bundle. Admins may override per preset. */
export const DEFAULT_TIER_TARGETS: readonly TierTarget[] = [
  { tier: 1, views: 250, likes: 10, shares: 3, comments: 3 },
  { tier: 2, views: 500, likes: 25, shares: 8, comments: 6 },
  { tier: 3, views: 1_000, likes: 50, shares: 15, comments: 10 },
  { tier: 4, views: 2_500, likes: 100, shares: 30, comments: 20 },
  { tier: 5, views: 5_000, likes: 200, shares: 60, comments: 35 },
  { tier: 6, views: 10_000, likes: 400, shares: 120, comments: 60 },
  { tier: 7, views: 25_000, likes: 800, shares: 250, comments: 100 },
  { tier: 8, views: 50_000, likes: 1_500, shares: 500, comments: 175 },
  { tier: 9, views: 100_000, likes: 3_000, shares: 1_000, comments: 300 },
  { tier: 10, views: 250_000, likes: 6_000, shares: 2_000, comments: 500 },
];

export function normalizeTierTargets(raw: unknown): TierTarget[] {
  const rows = Array.isArray(raw) ? (raw as Record<string, unknown>[]) : [];
  const byTier = new Map<number, Record<string, unknown>>();
  for (const row of rows) {
    const tier = Number(row?.["tier"]);
    if (Number.isInteger(tier) && tier >= 1 && tier <= TIER_COUNT) byTier.set(tier, row);
  }
  return DEFAULT_TIER_TARGETS.map((fallback) => {
    const row = byTier.get(fallback.tier);
    if (!row) return { ...fallback };
    const num = (key: keyof TierTarget): number | null => {
      const value = row[key];
      if (value === null) return null;
      if (typeof value !== "number" || !Number.isFinite(value)) return fallback[key] as number | null;
      const int = Math.floor(value);
      return int > 0 ? int : null;
    };
    return { tier: fallback.tier, views: num("views"), likes: num("likes"), shares: num("shares"), comments: num("comments") };
  });
}

/** A tier is entered when EVERY target it defines is met. Unknown metrics block it. */
export function tierIsMet(metrics: XCanonicalMetrics, target: TierTarget): boolean {
  for (const metric of ["views", "likes", "shares", "comments"] as const) {
    const need = target[metric];
    if (need === null) continue;
    const have = metrics[metric];
    if (typeof have !== "number" || have < need) return false;
  }
  return true;
}

/** Highest tier currently met, 0 when none. Tiers are monotonically ordered. */
export function highestTierMet(
  metrics: XCanonicalMetrics,
  targets: readonly TierTarget[] = DEFAULT_TIER_TARGETS,
): number {
  let highest = 0;
  for (const target of targets) {
    if (tierIsMet(metrics, target)) highest = Math.max(highest, target.tier);
  }
  return highest;
}

/** Requirement 5 — "Project now trending" is tier 5 or above. */
export const TRENDING_TIER = 5;

/** Requirement 5 — "Mission closing soon" fires inside the last refresh window. */
export const CLOSING_SOON_MS = REFRESH_INTERVAL_MS;

export function isClosingSoon(endsAt: unknown, nowMs: number = Date.now()): boolean {
  if (typeof endsAt !== "string") return false;
  const ends = Date.parse(endsAt);
  if (!Number.isFinite(ends)) return false;
  const remaining = ends - nowMs;
  return remaining > 0 && remaining <= CLOSING_SOON_MS;
}

/** Requirement 3 — one stable footer/legend, identical on every refresh. */
export const MISSION_FOOTER_LEGEND =
  "Legend: views · likes · replies · reposts. Official X numbers, refreshed about every 5 minutes. A blank number is not yet available.";

/** Requirement 8 — the post could not be resolved; the mission stays alive. */
export const X_LINK_UNAVAILABLE_LABEL = "X link unavailable";
export const X_LINK_UNAVAILABLE_LINE =
  "X link unavailable — the original post could not be read just now. Mission tracking continues.";

export type XLinkStatus = "OK" | "UNAVAILABLE" | "UNKNOWN";

export function isXLinkStatus(value: unknown): value is XLinkStatus {
  return value === "OK" || value === "UNAVAILABLE" || value === "UNKNOWN";
}
