/**
 * CARTEL HQ — Commercial Foundation B shared Edge commercial guard.
 *
 * Invariants:
 *  - The decision is made ONLY by `public.evaluate_commercial_access`.
 *  - Platform owner / unrestricted bypass lives ONLY inside that RPC.
 *  - No assignment => the RPC returns allowed (observe). Observe-mode
 *    would_block=true is still allowed here.
 *  - FAIL CLOSED: RPC error, null or malformed result denies.
 *  - No billing, pricing, email or accounting logic lives here.
 *  - Call AFTER auth, membership/operator and Project Identity, BEFORE the
 *    paid or mutating side effect.
 */

/** Minimal structural type of the service-role Supabase client. */
export interface CommercialAccessClient {
  // deno-lint-ignore no-explicit-any
  rpc(fn: string, args: Record<string, unknown>): Promise<{ data: any; error: any }>;
}

export const COMMERCIAL_FEATURE_KEYS = [
  "static_ai_generations",
  "motion_ai_generations",
  "x_missions",
  "static_ai_tools",
  "concept_generation",
  "telegram_motion_prep",
  "sticker_drops",
  "sticker_auto_posting",
  "community_tools",
  "official_broadcasts",
  "project_inbox",
  "launch_watch",
  "x_reads",
] as const;

export type CommercialFeatureKey = (typeof COMMERCIAL_FEATURE_KEYS)[number];

export type CommercialDenialBody = { error: string; code: string; message: string };

export type CommercialAccessResult =
  | { allowed: true }
  | { allowed: false; status: 403 | 429 | 503; body: CommercialDenialBody };

function deny(status: 403 | 429 | 503, code: string, message: string): CommercialAccessResult {
  return { allowed: false, status, body: { error: code, code, message } };
}

export function commercialDenialFor(reason: unknown): CommercialAccessResult {
  const r = typeof reason === "string" ? reason : "";
  if (r === "PLAN_LIMIT_REACHED") return deny(429, "PLAN_LIMIT_REACHED", "Monthly plan limit reached.");
  if (r === "FEATURE_NOT_INCLUDED") {
    return deny(403, "FEATURE_NOT_INCLUDED", "This feature is not included in the current plan.");
  }
  if (r.startsWith("ASSIGNMENT_")) return deny(403, "PLAN_ACCESS_INACTIVE", "Plan access is not active.");
  return deny(403, "COMMERCIAL_ACCESS_DENIED", "This action is not available for this workspace.");
}

const UNAVAILABLE = () =>
  deny(503, "COMMERCIAL_ACCESS_UNAVAILABLE", "Plan access could not be verified. Try again.");

export async function requireCommercialAccess(
  admin: CommercialAccessClient,
  userId: string,
  workspaceId: string,
  featureKey: CommercialFeatureKey,
): Promise<CommercialAccessResult> {
  if (!userId || !workspaceId || !(COMMERCIAL_FEATURE_KEYS as readonly string[]).includes(featureKey)) {
    return deny(403, "COMMERCIAL_ACCESS_DENIED", "This action is not available for this workspace.");
  }
  try {
    const { data, error } = await admin.rpc("evaluate_commercial_access", {
      _workspace_id: workspaceId,
      _feature_key: featureKey,
      _user_id: userId,
    });
    if (error) {
      console.error("evaluate_commercial_access failed; denying", error);
      return UNAVAILABLE();
    }
    if (!data || typeof data !== "object" || typeof data.allowed !== "boolean") {
      console.error("evaluate_commercial_access malformed; denying");
      return UNAVAILABLE();
    }
    if (data.allowed === true) {
      if (data.would_block === true) {
        console.log("commercial observe would_block", { featureKey, reason: data.reason });
      }
      return { allowed: true };
    }
    return commercialDenialFor(data.reason);
  } catch (err) {
    console.error("evaluate_commercial_access threw; denying", err);
    return UNAVAILABLE();
  }
}
