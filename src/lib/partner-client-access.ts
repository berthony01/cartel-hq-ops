import { supabase } from "@/integrations/supabase/client";

/**
 * SP-A Managed Client Access — browser wrappers.
 *
 * The database (docs/sql/SP_A_partner_client_access.sql) is the only authority.
 * These helpers are UX only and FAIL CLOSED: if the SP-A RPCs are not deployed or
 * return an error, the partner sees no managed projects and no invitations, and
 * owner/member behavior is exactly as before.
 */

export const PARTNER_CLIENT_SCOPES = [
  "project_identity",
  "community_management",
  "broadcasts",
  "launch_watcher_comms",
  "sticker_tools",
  "missions",
  "project_inbox",
] as const;
export type PartnerClientScope = (typeof PARTNER_CLIENT_SCOPES)[number];

/** Only scopes listed here are enforced end-to-end. Others grant nothing yet (later SP-B phases). */
export const ACTIVE_PARTNER_SCOPES: readonly PartnerClientScope[] = ["project_identity", "project_inbox"];

export const PARTNER_SCOPE_LABELS: Record<PartnerClientScope, string> = {
  project_identity: "Project identity",
  community_management: "Community management",
  broadcasts: "Broadcasts",
  launch_watcher_comms: "Launch Watch communications",
  sticker_tools: "Sticker tools",
  missions: "Missions",
  project_inbox: "Project inbox",
};

/** Always denied to Service Partners regardless of scope. */
export const PARTNER_DENIED_AREAS = [
  "Billing and subscription ownership",
  "Project ownership transfer",
  "Wallet, private-key and treasury controls",
  "Production chain deployment and launch execution",
  "Platform owner and admin controls",
] as const;

/** Routes a managed (partner) project may always open. Everything else shows no-access. */
export const MANAGED_ALLOWED_PATHS = ["/project-profile", "/partners"] as const;
/** SP-B1: routes unlocked only when the owner granted the matching ACTIVE scope. */
const MANAGED_SCOPED_PATHS: ReadonlyArray<{ path: string; scope: PartnerClientScope }> = [
  { path: "/telegram", scope: "project_inbox" },
];
const matchesPath = (pathname: string, p: string) => pathname === p || pathname.startsWith(`${p}/`);
export function isManagedAllowedPath(pathname: string, scopes: readonly PartnerClientScope[] = []): boolean {
  if (MANAGED_ALLOWED_PATHS.some((p) => matchesPath(pathname, p))) return true;
  return MANAGED_SCOPED_PATHS.some(
    (r) => matchesPath(pathname, r.path) && scopes.includes(r.scope) && ACTIVE_PARTNER_SCOPES.includes(r.scope),
  );
}

export const partnerClientKeys = {
  all: ["partner-client-access"] as const,
  managed: (userId: string | null) => ["partner-client-access", "managed", userId] as const,
  invites: (userId: string | null) => ["partner-client-access", "invites", userId] as const,
  ownerList: (workspaceId: string | null) => ["partner-client-access", "owner", workspaceId] as const,
  profile: (workspaceId: string | null) => ["partner-client-access", "profile", workspaceId] as const,
};

type LooseRpc = (fn: string, args?: Record<string, unknown>) => Promise<{ data: unknown; error: { message?: string; code?: string } | null }>;
const rpc: LooseRpc = (fn, args) =>
  (supabase.rpc.bind(supabase) as unknown as LooseRpc)(fn, args);

export type ManagedWorkspace = {
  access_id: string;
  workspace_id: string;
  workspace_name: string;
  scopes: PartnerClientScope[];
  created_at: string;
};

export type PartnerInvite = {
  access_id: string;
  workspace_name: string;
  scopes: PartnerClientScope[];
  invited_at: string;
};

export type OwnerPartnerAccess = {
  access_id: string;
  partner_reference: string;
  status: "pending" | "active" | "declined" | "revoked";
  scopes: PartnerClientScope[];
  invited_at: string;
  responded_at: string | null;
  revoked_at: string | null;
};

export type ManagedProfile = {
  project_name: string;
  ticker: string | null;
  primary_chain: string | null;
  tagline: string | null;
  description: string | null;
  website_url: string | null;
  telegram_url: string | null;
  x_url: string | null;
  discovery_status: string;
  updated_at: string;
};

function cleanScopes(v: unknown): PartnerClientScope[] {
  if (!Array.isArray(v)) return [];
  return v.filter((s): s is PartnerClientScope => (PARTNER_CLIENT_SCOPES as readonly string[]).includes(String(s)));
}

/** Fails closed to [] on any error, including the RPC not being deployed. */
export async function fetchManagedWorkspaces(): Promise<ManagedWorkspace[]> {
  try {
    const { data, error } = await rpc("list_my_managed_workspaces");
    if (error || !Array.isArray(data)) return [];
    return (data as Record<string, unknown>[])
      .filter((r) => typeof r["workspace_id"] === "string")
      .map((r) => ({
        access_id: String(r["access_id"]),
        workspace_id: String(r["workspace_id"]),
        workspace_name: String(r["workspace_name"] ?? "Client project"),
        scopes: cleanScopes(r["scopes"]),
        created_at: String(r["created_at"] ?? ""),
      }));
  } catch {
    return [];
  }
}

/** Fails closed to [] on any error. */
export async function fetchMyPartnerInvites(): Promise<PartnerInvite[]> {
  try {
    const { data, error } = await rpc("list_my_partner_invites");
    if (error || !Array.isArray(data)) return [];
    return (data as Record<string, unknown>[]).map((r) => ({
      access_id: String(r["access_id"]),
      workspace_name: String(r["workspace_name"] ?? "Client project"),
      scopes: cleanScopes(r["scopes"]),
      invited_at: String(r["invited_at"] ?? ""),
    }));
  } catch {
    return [];
  }
}

export async function fetchOwnerPartnerAccess(workspaceId: string): Promise<OwnerPartnerAccess[] | null> {
  const { data, error } = await rpc("owner_list_partner_access", { _workspace_id: workspaceId });
  if (error) return null; // unavailable (not deployed / not owner): panel shows unavailable state
  if (!Array.isArray(data)) return [];
  return (data as Record<string, unknown>[]).map((r) => ({
    access_id: String(r["access_id"]),
    partner_reference: String(r["partner_reference"] ?? "Service Partner"),
    status: String(r["status"]) as OwnerPartnerAccess["status"],
    scopes: cleanScopes(r["scopes"]),
    invited_at: String(r["invited_at"] ?? ""),
    responded_at: (r["responded_at"] as string | null) ?? null,
    revoked_at: (r["revoked_at"] as string | null) ?? null,
  }));
}

function throwIf(error: { message?: string } | null) {
  if (error) throw new Error(partnerClientErrorMessage(error));
}

export async function invitePartner(workspaceId: string, email: string, scopes: PartnerClientScope[]) {
  const { error } = await rpc("owner_invite_service_partner", { _workspace_id: workspaceId, _partner_email: email.trim(), _scopes: scopes });
  throwIf(error);
}
export async function respondToInvite(accessId: string, accept: boolean) {
  const { error } = await rpc("partner_respond_client_invite", { _access_id: accessId, _accept: accept });
  throwIf(error);
}
export async function revokePartner(accessId: string) {
  const { error } = await rpc("owner_revoke_service_partner", { _access_id: accessId });
  throwIf(error);
}
export async function updatePartnerScopes(accessId: string, scopes: PartnerClientScope[]) {
  const { error } = await rpc("owner_update_partner_scopes", { _access_id: accessId, _scopes: scopes });
  throwIf(error);
}

export async function fetchManagedProfile(workspaceId: string): Promise<ManagedProfile | null> {
  const { data, error } = await rpc("partner_get_project_profile", { _workspace_id: workspaceId });
  throwIf(error);
  return (data as ManagedProfile | null) ?? null;
}

export type ManagedProfileInput = Omit<ManagedProfile, "discovery_status" | "updated_at">;
export async function saveManagedProfile(workspaceId: string, v: ManagedProfileInput) {
  const { error } = await rpc("partner_update_project_profile", {
    _workspace_id: workspaceId,
    _project_name: v.project_name,
    _ticker: v.ticker ?? "",
    _primary_chain: v.primary_chain ?? "",
    _tagline: v.tagline ?? "",
    _description: v.description ?? "",
    _website_url: v.website_url ?? "",
    _telegram_url: v.telegram_url ?? "",
    _x_url: v.x_url ?? "",
  });
  throwIf(error);
}

const ERRORS: Record<string, string> = {
  AUTH_REQUIRED: "Please sign in again.",
  WORKSPACE_OWNER_REQUIRED: "Only the project owner can manage Service Partner access.",
  INVALID_SCOPES: "Choose valid permissions.",
  SERVICE_PARTNER_NOT_AVAILABLE: "No active Service Partner is available for that email.",
  ACCESS_ALREADY_EXISTS: "This Service Partner already has a pending or active invitation for this project.",
  INVITE_NOT_FOUND: "This invitation is no longer available.",
  ACCESS_NOT_FOUND: "This access grant is no longer open.",
  PARTNER_SCOPE_REQUIRED: "Your access to this project does not include this area.",
  PROJECT_PROFILE_NOT_FOUND: "The project owner has not created a Project Profile yet.",
  INVALID_URL: "Links must start with http:// or https://.",
};

export function partnerClientErrorMessage(e: { message?: string; code?: string } | unknown): string {
  const msg = (e as { message?: string })?.message ?? "";
  for (const [code, text] of Object.entries(ERRORS)) if (msg.includes(code)) return text;
  if (/function .* does not exist|PGRST202|schema cache/i.test(msg)) return "Managed client access is not available yet.";
  if (/check constraint/i.test(msg)) return "One of the values is too long or invalid.";
  return "Something went wrong. Please try again.";
}
