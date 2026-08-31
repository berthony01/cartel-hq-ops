import { supabase } from "@/integrations/supabase/client";
import type { Database } from "@/integrations/supabase/types";

/**
 * Phase 8A — Project Verification / layered trust signals.
 *
 * Every read and write goes through explicit SECURITY DEFINER RPCs. There are
 * NO direct reads or writes of `project_platform_reviews`: the table is
 * service-private, and reviewer identity (`reviewed_by`) plus the owner-only
 * `internal_note` are never returned to the browser by any of these RPCs.
 *
 * Canonical states: `unverified` (no record), `pending`, `verified`,
 * `rejected`, `revoked`. Only the platform owner can reach `verified`.
 */

type Fns = Database["public"]["Functions"];

export type VerificationStatus =
  | "unverified"
  | "pending"
  | "verified"
  | "rejected"
  | "revoked";

export type ProjectVerificationState =
  Fns["get_project_verification_state"]["Returns"][number];
export type PlatformProjectVerificationRow =
  Fns["get_platform_project_verifications"]["Returns"][number];

export type ReviewAction = "verify" | "reject" | "revoke";

export const projectVerificationKeys = {
  state: (projectProfileId: string | null | undefined) =>
    ["project-verification", "state", projectProfileId ?? "none"] as const,
  platformDirectory: () => ["project-verification", "platform-directory"] as const,
};

export function verificationStatusOf(
  value: string | null | undefined,
): VerificationStatus {
  switch (value) {
    case "pending":
    case "verified":
    case "rejected":
    case "revoked":
      return value;
    default:
      return "unverified";
  }
}

export const VERIFICATION_STATUS_LABEL: Record<VerificationStatus, string> = {
  unverified: "Not reviewed",
  pending: "Review requested",
  verified: "Platform Reviewed",
  rejected: "Review declined",
  revoked: "Review revoked",
};

/** Operator-facing, factual explanation of each state. Never implies safety. */
export const VERIFICATION_STATUS_DESCRIPTION: Record<VerificationStatus, string> = {
  unverified:
    "CARTEL HQ has not reviewed this project profile. You can request a review once the profile is published with official links.",
  pending:
    "Your review request is queued. CARTEL HQ reviews the current project profile and listed official links only.",
  verified:
    "CARTEL HQ manually reviewed the current project profile and listed official links. Material profile changes clear this status until reviewed again.",
  rejected:
    "CARTEL HQ declined the last review request. You can update the profile and request a review again.",
  revoked:
    "CARTEL HQ revoked a previous review. You can update the profile and request a review again.",
};

export function canRequestVerification(status: VerificationStatus): boolean {
  return status === "unverified" || status === "rejected" || status === "revoked";
}

export async function fetchProjectVerificationState(
  projectProfileId: string,
): Promise<ProjectVerificationState | null> {
  const { data, error } = await supabase.rpc("get_project_verification_state", {
    _project_profile_id: projectProfileId,
  });
  if (error) throw error;
  return data?.[0] ?? null;
}

export async function fetchPlatformProjectVerifications(): Promise<
  PlatformProjectVerificationRow[]
> {
  const { data, error } = await supabase.rpc("get_platform_project_verifications");
  if (error) throw error;
  return data ?? [];
}

/**
 * Operator request. Server-side authorization + eligibility only; this can
 * never set `verified`.
 */
export async function requestProjectVerification(
  projectProfileId: string,
): Promise<{ verification_status: VerificationStatus; requested_at: string | null }> {
  const { data, error } = await supabase.rpc("request_project_verification", {
    _project_profile_id: projectProfileId,
  });
  if (error) throw error;
  const row = data?.[0];
  return {
    verification_status: verificationStatusOf(row?.verification_status),
    requested_at: row?.requested_at ?? null,
  };
}

/** Platform-owner-only review decision. */
export async function reviewProjectVerification(
  projectProfileId: string,
  action: ReviewAction,
  internalNote?: string | null,
): Promise<{
  verification_status: VerificationStatus;
  verified_at: string | null;
  reviewed_at: string | null;
}> {
  const note = (internalNote ?? "").trim();
  const { data, error } = await supabase.rpc("review_project_verification", {
    _project_profile_id: projectProfileId,
    _action: action,
    ...(note ? { _internal_note: note } : {}),
  });
  if (error) throw error;
  const row = data?.[0];
  return {
    verification_status: verificationStatusOf(row?.verification_status),
    verified_at: row?.verified_at ?? null,
    reviewed_at: row?.reviewed_at ?? null,
  };
}
