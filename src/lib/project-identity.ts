import { supabase } from "@/integrations/supabase/client";

/**
 * Project Identity Gate A — browser authority.
 *
 * The browser never re-implements the minimum-identity predicate. It asks
 * `public.can_use_project_tools`, the single server-side authority, which also
 * owns the platform-owner / unrestricted bypass. This is a UX signal only:
 * every paid provider action is independently enforced server-side.
 */

export const PROJECT_IDENTITY_REQUIRED = "PROJECT_IDENTITY_REQUIRED";

export const projectToolAccessQueryKey = (workspaceId: string | null) =>
  ["project-tool-access", workspaceId] as const;

export async function fetchProjectToolAccess(workspaceId: string): Promise<boolean> {
  const { data, error } = await supabase.rpc("can_use_project_tools", {
    _workspace_id: workspaceId,
  });
  if (error) throw error;
  return data === true;
}

/**
 * Only an internal path is ever accepted as a return destination. Anything
 * external, protocol-relative, or otherwise not a single-slash path is
 * rejected outright rather than sanitized.
 */
export function isSafeInternalRedirect(value: unknown): value is string {
  if (typeof value !== "string") return false;
  if (!value.startsWith("/")) return false;
  if (value.startsWith("//")) return false;
  if (value.startsWith("/\\")) return false;
  if (/[\u0000-\u001f\s]/.test(value)) return false;
  if (/^\/[a-z0-9+.-]*:/i.test(value)) return false;
  return true;
}

/** Normalizes an unvalidated search value into a safe internal path or undefined. */
export function safeInternalRedirect(value: unknown): string | undefined {
  return isSafeInternalRedirect(value) ? value : undefined;
}
