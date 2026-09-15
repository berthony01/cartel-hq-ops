/**
 * SE-15 — RESOLVED MISSION CONFIG.
 *
 * `social_missions.metadata.effective_config` is the IMMUTABLE snapshot taken at
 * launch and is never rewritten by anything, including Mission Control. When an
 * operator applies a manual override from the private Mission Control panel,
 * that override is stored separately under
 * `social_missions.metadata.mission_control.override_config` together with a
 * `mode` of `AUTO` or `MANUAL`.
 *
 * This module is the single pure resolver both the transport and the runner use
 * so every rendered surface agrees on one answer:
 *
 *   mode MANUAL + object override  ->  effective_config merged with the override
 *   anything else                  ->  effective_config exactly as today
 *
 * It performs ZERO network access, ZERO database access and holds no state, and
 * it mirrors `public.social_mission_resolve_config(jsonb)` exactly.
 */

export type MissionConfig = Record<string, unknown>;

function asObject(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  return value as Record<string, unknown>;
}

/** The Mission Control state object, or null when the mission has never been controlled. */
export function missionControlState(metadata: unknown): Record<string, unknown> | null {
  const meta = asObject(metadata);
  if (!meta) return null;
  return asObject(meta["mission_control"]);
}

/** `AUTO` unless a stored Mission Control state explicitly says `MANUAL`. */
export function missionControlMode(metadata: unknown): "AUTO" | "MANUAL" {
  const control = missionControlState(metadata);
  if (!control) return "AUTO";
  return String(control["mode"] ?? "AUTO").toUpperCase() === "MANUAL" ? "MANUAL" : "AUTO";
}

/**
 * Folds an active manual override over the immutable launch config.
 *
 * A mission with no `mission_control` state returns its `effective_config`
 * unchanged, so every pre-SE-15 mission behaves exactly as it does today.
 */
export function resolveMissionConfig(metadata: unknown): MissionConfig | null {
  const meta = asObject(metadata);
  if (!meta) return null;
  const base = asObject(meta["effective_config"]);
  if (missionControlMode(metadata) !== "MANUAL") return base;
  const control = missionControlState(metadata);
  const override = control ? asObject(control["override_config"]) : null;
  if (!override) return base;
  return { ...(base ?? {}), ...override };
}
