import { supabase } from "@/integrations/supabase/client";
import type { TelegramBot } from "@/lib/telegram-stickers";
import type { OfficialStickerReason } from "@/lib/telegram-link";

/**
 * Thin client for the authenticated Edge Function `telegram-group`.
 * The bot token stays server-side; the browser never calls api.telegram.org
 * and never writes `telegram_group_connections` (the webhook is authoritative).
 */

export type TelegramGroupConnectionMetadata = {
  bot_can_change_info?: boolean | null;
  can_set_sticker_set?: boolean | null;
  member_count?: number | null;
  official_group_sticker_min_members?: number | null;
  official_group_sticker_eligible?: boolean | null;
  official_group_sticker_reason?: OfficialStickerReason;
  checked_at?: string | null;
  [key: string]: unknown;
};

export type TelegramGroupConnection = {
  id: string;
  workspace_id: string;
  telegram_chat_id: number;
  title: string;
  username: string | null;
  chat_type: string;
  bot_is_admin: boolean;
  can_set_sticker_set: boolean;
  connected_at: string;
  verified_at: string | null;
  /** Stored verification details written by the webhook / group verification. */
  metadata?: TelegramGroupConnectionMetadata | null;
};


export type TelegramGroupStatusResult = {
  bot?: TelegramBot;
  group?: TelegramGroupConnection | null;
  /** Basic operational readiness: supergroup + bot admin + Change Group Info. */
  ready?: boolean;
  botIsAdmin?: boolean;
  botCanChangeInfo?: boolean;
  canSetStickerSet?: boolean;
  /** `group` (basic group) and `supergroup` are both valid CARTEL HQ targets. */
  chatType?: "group" | "supergroup" | (string & {});
  memberCount?: number | null;
  minMembers?: number;
  officialStickerEligible?: boolean;
  officialStickerReason?: OfficialStickerReason;
  currentStickerSetName?: string | null;
  message?: string;
  technical?: string;
};

export type TelegramAssignPackResult = {
  assigned: boolean;
  /** Server posted the pack link into the group instead of assigning it. */
  announced?: boolean;
  reason?:
    | "GROUP_STICKER_MIN_MEMBERS"
    | "GROUP_STICKER_REQUIRES_SUPERGROUP"
    | "GROUP_STICKER_NOT_AVAILABLE"
    | string;
  memberCount?: number | null;
  minMembers?: number;
  group?: TelegramGroupConnection | null;
  setName?: string;
  setUrl?: string;
  message?: string;
  technical?: string;
};

export type TelegramGroupTestResult = {
  sent: boolean;
  message?: string;
  technical?: string;
};

async function readServerMessage(error: unknown): Promise<string | null> {
  const ctx = (error as { context?: { json?: () => Promise<unknown> } } | null)?.context;
  if (!ctx || typeof ctx.json !== "function") return null;
  try {
    const body = (await ctx.json()) as { message?: unknown; error?: unknown } | null;
    const msg = body?.message ?? body?.error;
    return typeof msg === "string" && msg.trim() ? msg.trim() : null;
  } catch {
    return null;
  }
}

async function invoke<T>(body: Record<string, unknown>): Promise<T> {
  const { data, error } = await supabase.functions.invoke("telegram-group", { body });
  if (error) {
    const serverMessage = await readServerMessage(error);
    throw new Error(
      serverMessage || error.message || "The Telegram group service is unavailable right now.",
    );
  }
  const payload = data as (T & { error?: string }) | null;
  if (!payload) throw new Error("Empty response from the Telegram group service.");
  if (payload.error) throw new Error(payload.error);
  return payload as T;
}

/** Live verification + current group sticker-set state. Read-only. */
export function fetchTelegramGroupStatus(params: {
  workspaceId: string;
  groupConnectionId: string;
}): Promise<TelegramGroupStatusResult> {
  return invoke<TelegramGroupStatusResult>({
    action: "status",
    workspaceId: params.workspaceId,
    groupConnectionId: params.groupConnectionId,
  });
}

/** Assigns an already-published pack as the supergroup's group sticker set. */
export function assignPackToGroup(params: {
  workspaceId: string;
  packId: string;
  groupConnectionId: string;
}): Promise<TelegramAssignPackResult> {
  return invoke<TelegramAssignPackResult>({
    action: "assign_pack",
    workspaceId: params.workspaceId,
    packId: params.packId,
    groupConnectionId: params.groupConnectionId,
  });
}

/** Sends one published sticker as a native sticker into the connected group. */
export function sendGroupTestSticker(params: {
  workspaceId: string;
  packId: string;
  groupConnectionId: string;
  stickerId?: string;
}): Promise<TelegramGroupTestResult> {
  return invoke<TelegramGroupTestResult>({
    action: "send_group_test",
    workspaceId: params.workspaceId,
    packId: params.packId,
    groupConnectionId: params.groupConnectionId,
    ...(params.stickerId ? { stickerId: params.stickerId } : {}),
  });
}

/* ------------------------------------------------------------------ */
/* Multi-group distribution (telegram-group v4)                        */
/* ------------------------------------------------------------------ */

export type TelegramDistributionStatus = "assigned" | "announced" | "failed";

export type TelegramDistributeResultRow = {
  groupConnectionId: string;
  title: string;
  chatType?: string;
  status: TelegramDistributionStatus;
  assigned: boolean;
  announced: boolean;
  reason?: string;
  memberCount?: number | null;
  minMembers?: number;
  message?: string;
};

export type TelegramDistributePackResult = {
  status: "complete" | "partial" | "failed";
  total: number;
  assigned: number;
  announced: number;
  failed: number;
  results: TelegramDistributeResultRow[];
  setName?: string;
  setUrl?: string;
};

/** Durable per-group distribution row persisted server-side. */
export type TelegramPackGroupTarget = {
  id: string;
  workspace_id: string;
  pack_id: string;
  group_connection_id: string;
  status: string;
  last_error: string | null;
  announced_at: string | null;
  assigned_at: string | null;
  last_attempt_at: string | null;
  created_at: string;
  updated_at: string;
};

/** Max group IDs accepted by the server in one distribute call. */
export const MAX_DISTRIBUTION_TARGETS = 50;

/**
 * Distributes an already-published pack to many connected groups in one call.
 * The Telegram sticker set itself is never re-created here.
 */
export function distributePackToGroups(params: {
  workspaceId: string;
  packId: string;
  groupConnectionIds: string[];
}): Promise<TelegramDistributePackResult> {
  const ids = Array.from(new Set(params.groupConnectionIds)).slice(0, MAX_DISTRIBUTION_TARGETS);
  return invoke<TelegramDistributePackResult>({
    action: "distribute_pack",
    workspaceId: params.workspaceId,
    packId: params.packId,
    groupConnectionIds: ids,
  });
}

/** Reads the persisted per-group distribution state for a pack. */
export function fetchPackGroupDistribution(params: {
  workspaceId: string;
  packId: string;
}): Promise<{ targets: TelegramPackGroupTarget[] }> {
  return invoke<{ targets: TelegramPackGroupTarget[] }>({
    action: "distribution_status",
    workspaceId: params.workspaceId,
    packId: params.packId,
  });
}
