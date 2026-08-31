import { supabase } from "@/integrations/supabase/client";
import type { Database } from "@/integrations/supabase/types";

/**
 * Phase 8A — Project Verification / layered trust signals.
 *
 * Every read and write goes through explicit SECURITY DEFINER RPCs. There are
 * NO direct reads or writes of `project_platform_reviews`: the table is
 * service-private and reviewer identity (`reviewed_by`) is never returned to
 * the browser by any of these RPCs.
 */

type Fns = Database["public"]["Functions"];

export type ProjectVerificationState =
  Fns["get_project_verification_state"]["Returns"][number];
export type PlatformProjectVerificationRow =
  Fns["get_platform_project_verifications"]["Returns"][number];

export const projectVerificationKeys = {
  state: (projectProfileId: string | null | undefined) =>
    ["project-verification", "state", projectProfileId ?? "none"] as const,
  platformDirectory: () => ["project-verification", "platform-directory"] as const,
};

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

export async function setPlatformProjectReview(
  projectProfileId: string,
  reviewed: boolean,
): Promise<{ platform_reviewed: boolean; platform_reviewed_at: string | null }> {
  const { data, error } = await supabase.rpc("set_project_platform_review", {
    _project_profile_id: projectProfileId,
    _reviewed: reviewed,
  });
  if (error) throw error;
  const row = data?.[0];
  return {
    platform_reviewed: row?.platform_reviewed ?? reviewed,
    platform_reviewed_at: row?.platform_reviewed_at ?? null,
  };
}
