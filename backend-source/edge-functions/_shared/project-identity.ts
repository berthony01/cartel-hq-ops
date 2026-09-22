/**
 * CARTEL HQ — Project Identity Gate A shared Edge authority.
 *
 * ONE reusable server-side check in front of paid provider work: does this
 * user have minimum Project Identity in this workspace?
 *
 * Invariants:
 *  - The decision is made by `public.can_use_project_tools` in the database.
 *    This module never re-implements the profile predicate, never inspects
 *    `project_profiles`, and never compares an email address.
 *  - Workspace-scoped, never user-global. Both the user and the workspace are
 *    always passed explicitly.
 *  - Platform owner / unrestricted bypass lives ONLY inside the RPC.
 *  - FAIL CLOSED: an RPC error, a null result or anything other than an
 *    explicit `true` denies access. Paid provider spend must never start on an
 *    undecided answer.
 *  - No plan, quota, price, subscription, entitlement or accounting logic of
 *    any kind, and no provider call, lives here.
 */

/** Minimal structural type of the service-role Supabase client. */
export interface ProjectIdentityClient {
  // deno-lint-ignore no-explicit-any
  rpc(fn: string, args: Record<string, unknown>): Promise<{ data: any; error: any }>;
}

/** Stable machine-readable denial code returned to the browser. */
export const PROJECT_IDENTITY_REQUIRED = "PROJECT_IDENTITY_REQUIRED";

/** Stable denial copy. Token launch is explicitly NOT a prerequisite. */
export const PROJECT_IDENTITY_REQUIRED_MESSAGE =
  "Create Project Identity first. Token launch is not required.";

export const PROJECT_IDENTITY_DENIAL_BODY = {
  error: PROJECT_IDENTITY_REQUIRED,
  code: PROJECT_IDENTITY_REQUIRED,
  message: PROJECT_IDENTITY_REQUIRED_MESSAGE,
} as const;

export type ProjectToolAccessResult =
  | { allowed: true }
  | { allowed: false; status: 403; body: typeof PROJECT_IDENTITY_DENIAL_BODY };

/**
 * Authoritative gate for any action that starts provider work or mutates
 * generated paid-tool state. Call AFTER authentication and the existing
 * membership check, and BEFORE the provider request or new job row.
 */
export async function requireProjectToolAccess(
  admin: ProjectIdentityClient,
  userId: string,
  workspaceId: string,
): Promise<ProjectToolAccessResult> {
  const denied: ProjectToolAccessResult = {
    allowed: false,
    status: 403,
    body: PROJECT_IDENTITY_DENIAL_BODY,
  };

  if (!userId || !workspaceId) return denied;

  try {
    const { data, error } = await admin.rpc("can_use_project_tools", {
      _workspace_id: workspaceId,
      _user_id: userId,
    });
    if (error) {
      console.error("can_use_project_tools failed; denying", error);
      return denied;
    }
    return data === true ? { allowed: true } : denied;
  } catch (err) {
    console.error("can_use_project_tools threw; denying", err);
    return denied;
  }
}
