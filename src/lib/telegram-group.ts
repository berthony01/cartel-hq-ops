import { supabase } from "@/integrations/supabase/client";
import type { TelegramBot } from "@/lib/telegram-stickers";

/**
 * Thin client for the authenticated Edge Function `telegram-group`.
 * The bot token stays server-side; the browser never calls api.telegram.org
 * and never writes `telegram_group_connections` (the webhook is authoritative).
 */

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
};

export type TelegramGroupStatusResult = {
  bot?: TelegramBot;
  group?: TelegramGroupConnection | null;
  ready?: boolean;
  botIsAdmin?: boolean;
  canSetStickerSet?: boolean;
  chatType?: string;
  currentStickerSetName?: string | null;
  message?: string;
  technical?: string;
};

export type TelegramAssignPackResult = {
  assigned: boolean;
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
