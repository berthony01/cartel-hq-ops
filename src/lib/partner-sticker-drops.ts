import { supabase } from "@/integrations/supabase/client";

/**
 * SP-B5 V1 — Service Partner Sticker Drops management.
 *
 * Reads go through the partner_* RPCs (scope-checked in the database). Writes go
 * through the EXISTING sticker-drop-config save_schedule / set_schedule_enabled /
 * delete_schedule actions; the server authorizes the partner with
 * partner_authorize_sticker_drop_action. No chat ids, Telegram file ids, set
 * names, storage paths or image URLs reach here. No AI generation, pack
 * publishing, test sends or kill switch are exposed.
 */

/** Owner-equal server-enforced limits. */
export const DROP_INTERVAL_MIN = 15;
export const DROP_INTERVAL_MAX = 720;
export const DROP_DAILY_CAP_MIN = 1;
export const DROP_DAILY_CAP_MAX = 24;

export const partnerStickerDropKeys = {
  all: ["partner-sticker-drops"] as const,
  packs: (workspaceId: string | null) => ["partner-sticker-drops", "packs", workspaceId] as const,
  state: (workspaceId: string | null) => ["partner-sticker-drops", "state", workspaceId] as const,
};

export type PartnerDropSticker = { sticker_id: string; label: string | null; emoji_list: string[] | null; sort_order: number };
export type PartnerDropPack = {
  pack_id: string;
  title: string;
  theme: string | null;
  published_at: string | null;
  sticker_count: number;
  stickers: PartnerDropSticker[];
};
export type PartnerDropGroup = { group_connection_id: string; title: string | null; chat_type: string | null; bot_is_admin: boolean | null; operational: boolean };
export type PartnerDropSchedule = {
  id: string;
  group_connection_id: string;
  pack_id: string;
  interval_minutes: number;
  timezone: string;
  active_start: string;
  active_end: string;
  daily_cap: number;
  silent: boolean;
  no_immediate_repeat: boolean;
  selected_sticker_ids: string[];
  enabled: boolean;
  paused_reason: string | null;
  next_run_at: string | null;
  last_run_at: string | null;
};
export type PartnerDropEvent = {
  status: "sent" | "failed" | string;
  local_date: string | null;
  created_at: string;
  group_title: string | null;
  sticker_label: string | null;
  error_message: string | null;
};
export type PartnerDropState = { groups: PartnerDropGroup[]; schedules: PartnerDropSchedule[]; kill_switch: boolean; events: PartnerDropEvent[] };

export type PartnerDropScheduleInput = {
  scheduleId?: string | null;
  groupConnectionId: string;
  packId: string;
  intervalMinutes: number;
  timezone: string;
  activeStart: string;
  activeEnd: string;
  dailyCap: number;
  silent: boolean;
  noImmediateRepeat: boolean;
  selectedStickerIds: string[];
};

type LooseRpc = (fn: string, args?: Record<string, unknown>) => Promise<{ data: unknown; error: { message?: string } | null }>;
const rpc: LooseRpc = (fn, args) => (supabase.rpc.bind(supabase) as unknown as LooseRpc)(fn, args);

export async function listPartnerDropPacks(workspaceId: string): Promise<PartnerDropPack[]> {
  const { data, error } = await rpc("partner_list_sticker_drop_packs", { _workspace_id: workspaceId });
  if (error) throw new Error(error.message ?? "error");
  return Array.isArray(data) ? (data as PartnerDropPack[]) : [];
}

export async function getPartnerDropState(workspaceId: string): Promise<PartnerDropState> {
  const { data, error } = await rpc("partner_list_sticker_drop_state", { _workspace_id: workspaceId });
  if (error) throw new Error(error.message ?? "error");
  const d = (data ?? {}) as Partial<PartnerDropState>;
  return { groups: d.groups ?? [], schedules: d.schedules ?? [], kill_switch: d.kill_switch === true, events: d.events ?? [] };
}

async function invokeDrops(body: Record<string, unknown>): Promise<Record<string, unknown>> {
  const { data, error } = await supabase.functions.invoke("sticker-drop-config", { body });
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

export function savePartnerDropSchedule(workspaceId: string, input: PartnerDropScheduleInput) {
  return invokeDrops({ action: "save_schedule", workspaceId, ...input, scheduleId: input.scheduleId ?? undefined });
}

export function setPartnerDropScheduleEnabled(workspaceId: string, scheduleId: string, enabled: boolean) {
  return invokeDrops({ action: "set_schedule_enabled", workspaceId, scheduleId, enabled });
}

export function deletePartnerDropSchedule(workspaceId: string, scheduleId: string) {
  return invokeDrops({ action: "delete_schedule", workspaceId, scheduleId });
}

const ERRORS: Record<string, string> = {
  "Not authorized": "Your access to this project does not include sticker tools.",
  FORBIDDEN: "Your access to this project does not include sticker tools.",
  GROUP_NOT_FOUND: "That Telegram community is no longer connected.",
  PACK_NOT_FOUND: "That sticker pack is not available in this project.",
  SCHEDULE_NOT_FOUND: "That Sticker Drop schedule no longer exists.",
  PACK_NOT_PUBLISHED: "Choose a sticker pack that is already published to Telegram.",
  GROUP_AND_PACK_REQUIRED: "Choose a connected group and a published sticker pack.",
  PROJECT_IDENTITY_REQUIRED: "The project owner needs to finish the Project Profile first.",
  FEATURE_NOT_INCLUDED: "Sticker Drops are not included in this project's plan.",
  PLAN_LIMIT_REACHED: "This project's plan limit has been reached.",
  PLAN_ACCESS_INACTIVE: "This project's plan is not active.",
  COMMERCIAL_ACCESS_DENIED: "Sticker Drops are not available for this project.",
  COMMERCIAL_ACCESS_UNAVAILABLE: "Plan access could not be checked. Try again.",
  INVALID_INTERVAL: "Sticker Drops must be between 15 and 720 minutes apart.",
  INVALID_DAILY_CAP: "Daily cap must be between 1 and 24 stickers.",
  INVALID_TIMEZONE: "Choose a valid timezone.",
  INVALID_ACTIVE_HOURS: "Active hours must use a valid 24-hour time.",
  STICKER_DROP_CONFIG_ERROR: "The schedule could not be saved. Check the pack and selected stickers.",
};

export function partnerStickerDropErrorMessage(e: unknown): string {
  const msg = (e as { message?: string })?.message ?? "";
  for (const [code, text] of Object.entries(ERRORS)) if (msg.includes(code)) return text;
  if (/function .* does not exist|PGRST202|schema cache/i.test(msg)) return "Sticker Drops management is not available yet.";
  return "Something went wrong. Please try again.";
}
