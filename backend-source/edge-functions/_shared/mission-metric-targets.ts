/**
 * SE-14 — PURE reference mirror of the automatic SUPPORTING METRIC TARGET set.
 *
 * AUTHORITY: the database functions `public.social_mission_support_target`
 * and `public.social_mission_metric_targets` in
 * `docs/sql/SE14_multi_metric_mission_targets.sql` are the ONLY place a target
 * set is ever established. This module performs ZERO network, ZERO database
 * and ZERO provider access; it exists so the algorithm can be asserted
 * deterministically in regression without touching production.
 *
 * A target is a PROJECT-level aggregate public-metric target. It is never a
 * per-member requirement and never carries points, rewards, badges or payouts.
 * Supporting targets are informational only and can NEVER accomplish a mission.
 */

import { computeAutoViewsGoal } from "./mission-goal.ts";

export type MissionMetricTargetSet = {
  views?: number;
  likes?: number;
  replies?: number;
  reposts?: number;
  bookmarks?: number;
};

/** Clean rounding step chosen from the project's own observed scale. */
export function supportTargetStep(baseline: number): number {
  if (baseline < 20) return 1;
  if (baseline < 100) return 5;
  if (baseline < 500) return 10;
  return 25;
}

/**
 * Deterministic supporting target. `floorAdd` is the frozen minimum absolute
 * increase for the metric (likes 3, replies 2, reposts 2, bookmarks 1).
 * Returns null for an unknown or negative baseline — unknown never becomes 0.
 */
export function computeSupportTarget(baseline: number | null, floorAdd: number): number | null {
  if (baseline === null || !Number.isFinite(baseline) || baseline < 0) return null;
  const base = Math.floor(baseline);
  const raw = Math.max(base + floorAdd, Math.ceil(base * 1.5));
  const step = supportTargetStep(base);
  return Math.ceil(raw / step) * step;
}

export const SUPPORT_FLOOR_ADD = {
  likes: 3,
  replies: 2,
  reposts: 2,
  bookmarks: 1,
} as const;

export type FirstSnapshot = {
  views: number | null;
  likes: number | null;
  comments: number | null;
  shares: number | null;
  saves: number | null;
};

/**
 * The full target set derived from the FIRST official snapshot.
 *
 * The existing Primary Goal ALWAYS wins for its own metric: when the primary
 * type maps to one of the four countable metrics, that metric's target is the
 * existing `milestone_target`, never a conflicting auto value.
 * `TOTAL_INTERACTIONS` stays a valid Primary Goal and never becomes a sixth
 * supporting target. Unknown inputs are omitted entirely.
 */
export function computeMetricTargets(
  first: FirstSnapshot | null,
  primaryType: string | null,
  primaryTarget: number | null,
): MissionMetricTargetSet | null {
  if (first === null || first === undefined) return null;
  const type = (primaryType ?? "NONE").toUpperCase();
  const explicit =
    Number.isInteger(primaryTarget) && (primaryTarget as number) > 0 ? (primaryTarget as number) : null;
  const pin = (metric: string): number | null => (explicit !== null && type === metric ? explicit : null);

  const out: MissionMetricTargetSet = {};

  const viewsPinned = pin("VIEWS");
  const views = viewsPinned ?? computeAutoViewsGoal(first.views)?.primaryTarget ?? null;
  if (views !== null) out.views = views;

  const likes = pin("LIKES") ?? computeSupportTarget(first.likes, SUPPORT_FLOOR_ADD.likes);
  if (likes !== null) out.likes = likes;

  const replies = pin("REPLIES") ?? computeSupportTarget(first.comments, SUPPORT_FLOOR_ADD.replies);
  if (replies !== null) out.replies = replies;

  const reposts = pin("REPOSTS") ?? computeSupportTarget(first.shares, SUPPORT_FLOOR_ADD.reposts);
  if (reposts !== null) out.reposts = reposts;

  const bookmarks = computeSupportTarget(first.saves, SUPPORT_FLOOR_ADD.bookmarks);
  if (bookmarks !== null) out.bookmarks = bookmarks;

  // A fully unknown first snapshot establishes NOTHING: an empty set is null,
  // never `{}`, matching the SQL helper which returns NULL for an empty object.
  return Object.keys(out).length === 0 ? null : out;
}
