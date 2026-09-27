import { supabase } from "@/integrations/supabase/client";

/** Mirrors the workspace slug contract enforced by create_self_service_workspace. */
export function slugifyWorkspaceName(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 48)
    .replace(/-+$/g, "");
}

export class SelfServiceWorkspaceError extends Error {
  constructor(
    public code: string,
    message: string,
  ) {
    super(message);
  }
}

const FRIENDLY: Record<string, string> = {
  FREE_PROJECT_LIMIT_REACHED:
    "Your Free account already has a project. Free includes 1 project — multi-project plans are coming later.",
  INVALID_PROJECT_NAME: "Enter a project name up to 80 characters.",
  INVALID_PROJECT_SLUG: "Use letters and numbers in the project name.",
  PROJECT_SLUG_TAKEN: "A project with that name already exists. Try a different name.",
  AUTH_REQUIRED: "Sign in again to create a project.",
};

/**
 * Creates a workspace through the authenticated self-service RPC. Direct
 * inserts into public.workspaces are intentionally not used.
 */
export async function createSelfServiceWorkspace(name: string): Promise<string> {
  const trimmed = name.trim();
  const slug = slugifyWorkspaceName(trimmed);
  // RPC applied as migration 20260927171231; fail closed if it is missing or drifted.
  const { data, error } = await supabase.rpc("create_self_service_workspace", {
    _name: trimmed,
    _slug: slug || null,
  });
  if (error) {
    const raw = error.message ?? "";
    if (error.code === "PGRST202" || error.code === "42883") {
      throw new SelfServiceWorkspaceError(
        "UNAVAILABLE",
        "Project creation isn't enabled yet. Please try again later.",
      );
    }
    const code = Object.keys(FRIENDLY).find((k) => raw.includes(k));
    throw new SelfServiceWorkspaceError(code ?? "UNKNOWN", code ? FRIENDLY[code]! : "Could not create the project.");
  }
  if (typeof data !== "string") throw new SelfServiceWorkspaceError("UNKNOWN", "Could not create the project.");
  return data;
}
