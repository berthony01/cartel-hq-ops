import { supabase } from "@/integrations/supabase/client";

/**
 * SP-B4 V1 — Service Partner community management (routine welcome settings).
 *
 * Reads go through the partner_* RPCs (scope-checked in the database). Saves and
 * welcome tests go through the EXISTING telegram-group save_welcome_settings /
 * send_welcome_test actions; the server authorizes the partner with
 * partner_authorize_community_action and keeps every Launch Watch setting at its
 * stored (owner-controlled) value. No chat ids, member data or tokens reach here.
 */

/** Owner-equal server-enforced limits. */
export const WELCOME_MESSAGE_MAX = 3500;
export const WELCOME_AUTO_DELETE_MIN = 10;
export const WELCOME_AUTO_DELETE_MAX = 120;

export const partnerCommunityKeys = {
  all: ["partner-community"] as const,
  groups: (workspaceId: string | null) => ["partner-community", "groups", workspaceId] as const,
  settings: (workspaceId: string | null, groupId: string | null) => ["partner-community", "settings", workspaceId, groupId] as const,
};

export type PartnerCommunityGroup = {
  group_connection_id: string;
  title: string;
  chat_type: string | null;
  bot_is_admin: boolean | null;
  operational: boolean;
  verified_at: string | null;
};

export type PartnerWelcomeSettings = {
  has_saved_settings: boolean;
  welcome_enabled: boolean;
  welcome_message: string;
  mention_member: boolean;
  auto_delete_enabled: boolean;
  auto_delete_seconds: number;
  launch_watch_cta_enabled: boolean;
  launch_watch_available: boolean;
  launch_watch_label: string | null;
  launch_watch_ticker: string | null;
};

export type PartnerWelcomeEdit = {
  welcomeEnabled: boolean;
  welcomeMessage: string;
  mentionMember: boolean;
  autoDeleteEnabled: boolean;
  autoDeleteSeconds: number;
};

type LooseRpc = (fn: string, args?: Record<string, unknown>) => Promise<{ data: unknown; error: { message?: string } | null }>;
const rpc: LooseRpc = (fn, args) => (supabase.rpc.bind(supabase) as unknown as LooseRpc)(fn, args);

export async function listPartnerCommunityGroups(workspaceId: string): Promise<PartnerCommunityGroup[]> {
  const { data, error } = await rpc("partner_list_community_groups", { _workspace_id: workspaceId });
  if (error) throw new Error(error.message ?? "error");
  return Array.isArray(data) ? (data as PartnerCommunityGroup[]) : [];
}

export async function getPartnerWelcomeSettings(workspaceId: string, groupConnectionId: string): Promise<PartnerWelcomeSettings> {
  const { data, error } = await rpc("partner_get_welcome_settings", { _workspace_id: workspaceId, _group_connection_id: groupConnectionId });
  if (error) throw new Error(error.message ?? "error");
  return data as PartnerWelcomeSettings;
}

async function invokeCommunity(body: Record<string, unknown>): Promise<Record<string, unknown>> {
  const { data, error } = await supabase.functions.invoke("telegram-group", { body });
  if (error) {
    let code = "";
    try {
      const ctx = (error as { context?: Response }).context;
      if (ctx && typeof ctx.json === "function") code = String(((await ctx.json()) as { error?: string })?.error ?? "");
    } catch { /* ignore */ }
    throw new Error(code || error.message || "error");
  }
  return (data ?? {}) as Record<string, unknown>;
}

/** Sends ONLY the five editable welcome fields. Launch Watch values are forced server-side. */
export function savePartnerWelcomeSettings(workspaceId: string, groupConnectionId: string, edit: PartnerWelcomeEdit) {
  return invokeCommunity({
    action: "save_welcome_settings",
    workspaceId,
    groupConnectionId,
    settings: {
      welcomeEnabled: edit.welcomeEnabled,
      welcomeMessage: edit.welcomeMessage,
      mentionMember: edit.mentionMember,
      autoDeleteEnabled: edit.autoDeleteEnabled,
      autoDeleteSeconds: edit.autoDeleteSeconds,
    },
  });
}

export function sendPartnerWelcomeTest(workspaceId: string, groupConnectionId: string) {
  return invokeCommunity({ action: "send_welcome_test", workspaceId, groupConnectionId }) as Promise<{
    sent?: boolean;
    groupTitle?: string;
    launchWatchCtaIncluded?: boolean;
  }>;
}

const ERRORS: Record<string, string> = {
  "Not authorized": "Your access to this project does not include community management.",
  "Group not found": "That Telegram community is no longer connected.",
  FORBIDDEN: "Your access to this project does not include community management.",
  GROUP_NOT_FOUND: "That Telegram community is no longer connected.",
  PROJECT_IDENTITY_REQUIRED: "The project owner needs to finish the Project Profile first.",
  FEATURE_NOT_INCLUDED: "Community tools are not included in this project's plan.",
  PLAN_LIMIT_REACHED: "This project's plan limit has been reached.",
  PLAN_ACCESS_INACTIVE: "This project's plan is not active.",
  COMMERCIAL_ACCESS_DENIED: "Community tools are not available for this project.",
  COMMERCIAL_ACCESS_UNAVAILABLE: "Plan access could not be checked. Try again.",
  INVALID_MESSAGE: "Enter a welcome message of up to 3500 characters.",
  INVALID_SECONDS: "Auto-delete must be between 10 and 120 seconds.",
  LAUNCH_NOT_ELIGIBLE: "The owner's Launch Watch button points to a launch that is no longer eligible. Ask the project owner to update it.",
  LAUNCH_REQUIRED: "The owner's Launch Watch button needs a launch. Ask the project owner to update it.",
};

export function partnerCommunityErrorMessage(e: unknown): string {
  const msg = (e as { message?: string })?.message ?? "";
  for (const [code, text] of Object.entries(ERRORS)) if (msg.includes(code)) return text;
  if (/function .* does not exist|PGRST202|schema cache/i.test(msg)) return "Community management is not available yet.";
  return "Something went wrong. Please try again.";
}
