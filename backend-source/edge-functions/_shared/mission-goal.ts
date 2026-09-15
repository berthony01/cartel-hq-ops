/**
 * SE-13 — PURE reference mirror of the automatic MISSION GOAL algorithm.
 *
 * AUTHORITY: the database function
 * `public.social_mission_auto_goal(bigint)` in
 * `docs/sql/SE13_social_mission_goal_experience.sql` is the ONLY place an
 * automatic goal is ever established. This module performs ZERO network,
 * ZERO database and ZERO provider access; it exists so the algorithm can be
 * asserted deterministically in regression without touching production.
 *
 * A goal is a PROJECT-level aggregate public-metric target. It is never a
 * per-member requirement and never carries points, rewards, badges or payouts.
 */

/** Rounding step, chosen from the project's own observed scale. */
export function autoGoalStep(baseline: number): number {
  if (baseline < 100) return 10;
  if (baseline < 500) return 25;
  if (baseline < 1_000) return 50;
  if (baseline < 5_000) return 100;
  if (baseline < 10_000) return 250;
  if (baseline < 50_000) return 500;
  return 1_000;
}

export type AutoGoal = { primaryTarget: number; stretchTarget: number; step: number };

/**
 * Deterministic and bounded. Returns null when the baseline is unknown or
 * negative — an unknown views count never becomes 0 and never invents a goal.
 */
export function computeAutoViewsGoal(baseline: number | null): AutoGoal | null {
  if (baseline === null || !Number.isFinite(baseline) || baseline < 0) return null;
  const base = Math.floor(baseline);
  const rawPrimary = Math.max(base + 25, Math.ceil(base * 1.3));
  const step = autoGoalStep(base);
  const primaryTarget = Math.ceil(rawPrimary / step) * step;
  let stretchTarget = Math.ceil((primaryTarget * 1.5) / step) * step;
  if (stretchTarget <= primaryTarget) stretchTarget = primaryTarget + step;
  return { primaryTarget, stretchTarget, step };
}
