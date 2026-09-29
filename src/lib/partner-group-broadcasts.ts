import { supabase } from "@/integrations/supabase/client";

/**
 * SP-B3 V1 — Service Partner community group broadcasts (plain text only).
 *
 * Reads go through the partner_* RPCs (scope-checked in the database). The send
 * goes through the EXISTING telegram-group send_group_announcement action; the
 * server authorizes the partner with partner_authorize_group_broadcast and forces
 * plain text. No chat ids, member data or requester ids ever reach the browser.
 */

/** Owner-equal server-enforced plain-text limit. */
export const PARTNER_BROADCAST_MAX = 3500;

export const partnerBroadcastKeys = {
  all: ["partner-group-broadcasts"] as const,
  groups: (workspaceId: string | null) => ["partner-group-broadcasts", "groups", workspaceId] as const,
  history: (workspaceId: string | null) => ["partner-group-broadcasts", "history", workspaceId] as const,
};

export type PartnerBroadcastGroup = {
  group_connection_id: string;
  title: string;
  chat_type: string | null;
  bot_is_admin: boolean | null;
  operational: boolean;
  verified_at: string | null;
};

export type PartnerBroadcastHistoryRow = {
  announcement_id: string;
  group_title: string;
  message_text: string;
  status: "SENT" | "FAILED" | "AMBIGUOUS" | string;
  delivery_kind: string;
  requested_at: string;
  sent_at: string | null;
  actor_kind: "you" | "project_team" | "service_partner" | string;
};

export type PartnerBroadcastResult = {
  status?: "SENT" | "FAILED" | "AMBIGUOUS";
  duplicate?: boolean;
  groupTitle?: string;
  message?: string;
  error?: string;
};

type LooseRpc = (fn: string, args?: Record<string, unknown>) => Promise<{ data: unknown; error: { message?: string } | null }>;
const rpc: LooseRpc = (fn, args) => (supabase.rpc.bind(supabase) as unknown as LooseRpc)(fn, args);

export async function listPartnerBroadcastGroups(workspaceId: string): Promise<PartnerBroadcastGroup[]> {
  const { data, error } = await rpc("partner_list_broadcast_groups", { _workspace_id: workspaceId });
  if (error) throw new Error(error.message ?? "error");
  return Array.isArray(data) ? (data as PartnerBroadcastGroup[]) : [];
}

export async function listPartnerGroupBroadcasts(workspaceId: string, limit = 10): Promise<PartnerBroadcastHistoryRow[]> {
  const { data, error } = await rpc("partner_list_group_broadcasts", { _workspace_id: workspaceId, _limit: limit });
  if (error) throw new Error(error.message ?? "error");
  return Array.isArray(data) ? (data as PartnerBroadcastHistoryRow[]) : [];
}

/** Plain text only. Never sends branding, Launch Watch CTA or launch fields. */
export async function sendPartnerGroupBroadcast(params: {
  workspaceId: string;
  groupConnectionId: string;
  message: string;
  clientRequestId: string;
}): Promise<PartnerBroadcastResult> {
  const { data, error } = await supabase.functions.invoke("telegram-group", {
    body: {
      action: "send_group_announcement",
      workspaceId: params.workspaceId,
      groupConnectionId: params.groupConnectionId,
      message: params.message,
      clientRequestId: params.clientRequestId,
      brandingEnabled: false,
      ctaEnabled: false,
    },
  });
  if (error) {
    let code = "";
    try {
      const ctx = (error as { context?: Response }).context;
      if (ctx && typeof ctx.json === "function") code = String(((await ctx.json()) as { error?: string })?.error ?? "");
    } catch { /* ignore */ }
    throw new Error(code || error.message || "error");
  }
  return (data ?? {}) as PartnerBroadcastResult;
}

const ERRORS: Record<string, string> = {
  "Not authorized": "Your access to this project does not include broadcasts.",
  FORBIDDEN: "Your access to this project does not include broadcasts.",
  GROUP_NOT_FOUND: "That Telegram community is no longer connected.",
  PROJECT_IDENTITY_REQUIRED: "The project owner needs to finish the Project Profile first.",
  FEATURE_NOT_INCLUDED: "Broadcasts are not included in this project's plan.",
  PLAN_LIMIT_REACHED: "This project's monthly broadcast limit has been reached.",
  PLAN_ACCESS_INACTIVE: "This project's plan is not active.",
  COMMERCIAL_ACCESS_DENIED: "Broadcasts are not available for this project.",
  COMMERCIAL_ACCESS_UNAVAILABLE: "Plan access could not be checked. Try again.",
  IDEMPOTENCY_CONFLICT: "This draft was already used for a different message. Start a new broadcast.",
  INVALID_MESSAGE: "Enter a message of up to 3500 characters.",
};

export function partnerBroadcastErrorMessage(e: unknown): string {
  const msg = (e as { message?: string })?.message ?? "";
  for (const [code, text] of Object.entries(ERRORS)) if (msg.includes(code)) return text;
  if (/function .* does not exist|PGRST202|schema cache/i.test(msg)) return "Partner broadcasts are not available yet.";
  return "Something went wrong. Please try again.";
}
