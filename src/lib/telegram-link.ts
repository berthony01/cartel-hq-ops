import { supabase } from "@/integrations/supabase/client";
import type { TelegramBot, TelegramConnection } from "@/lib/telegram-stickers";

/**
 * Thin client for the authenticated Edge Function `telegram-link`.
 * The bot token stays server-side; the browser never calls api.telegram.org
 * and never writes `telegram_connections` for this flow — the Telegram
 * webhook is the authoritative writer.
 */

export type TelegramLinkStatus = "pending" | "connected" | "expired" | "cancelled";

export type TelegramLinkRequest = {
  id?: string;
  requestId?: string;
  status: TelegramLinkStatus;
  expiresAt?: string;
  expires_at?: string;
};

export type TelegramCreateLinkResult = {
  requestId: string;
  status: TelegramLinkStatus;
  expiresAt?: string;
  bot?: TelegramBot;
  startParam?: string;
  botStartUrl?: string;
  botAppUrl?: string;
  webhookUrl?: string;
};

export type TelegramLinkStatusResult = {
  bot?: TelegramBot;
  request?: TelegramLinkRequest | null;
  connected: boolean;
  connection?: TelegramConnection | null;
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
  const { data, error } = await supabase.functions.invoke("telegram-link", { body });
  if (error) {
    const serverMessage = await readServerMessage(error);
    throw new Error(
      serverMessage || error.message || "The Telegram link service is unavailable right now.",
    );
  }
  const payload = data as (T & { error?: string }) | null;
  if (!payload) throw new Error("Empty response from the Telegram link service.");
  if (payload.error) throw new Error(payload.error);
  return payload as T;
}

/** Creates a one-time link request and returns the deep link into the bot. */
export function createTelegramLink(): Promise<TelegramCreateLinkResult> {
  return invoke<TelegramCreateLinkResult>({ action: "create_link" });
}

/** Polls the state of a link request (or the latest one when omitted). */
export function fetchTelegramLinkStatus(requestId?: string): Promise<TelegramLinkStatusResult> {
  return invoke<TelegramLinkStatusResult>({
    action: "link_status",
    ...(requestId ? { requestId } : {}),
  });
}

/* ------------------------------------------------------------------ */
/* Target supergroup linking (telegram-link v3)                        */
/* ------------------------------------------------------------------ */

export type TelegramCreateGroupLinkResult = {
  requestId: string;
  status: TelegramLinkStatus;
  expiresAt?: string;
  bot?: TelegramBot;
  startParam?: string;
  /** Official https t.me `startgroup` flow requesting the change_info admin right. */
  groupStartUrl?: string;
  /** `tg://resolve?...&startgroup=...` deep link for installed Telegram apps. */
  groupAppUrl?: string;
  webhookUrl?: string;
};

export type TelegramGroupLinkStatusResult = {
  bot?: TelegramBot;
  request?: TelegramLinkRequest | null;
  connected: boolean;
  group?: TelegramGroupConnection | null;
  groups?: TelegramGroupConnection[];
};

/** Starts a one-time supergroup link request for the given workspace. */
export function createTelegramGroupLink(
  workspaceId: string,
): Promise<TelegramCreateGroupLinkResult> {
  return invoke<TelegramCreateGroupLinkResult>({ action: "create_group_link", workspaceId });
}

/** Polls the state of a supergroup link request and the workspace's groups. */
export function fetchTelegramGroupLinkStatus(
  workspaceId: string,
  requestId?: string,
): Promise<TelegramGroupLinkStatusResult> {
  return invoke<TelegramGroupLinkStatusResult>({
    action: "group_status",
    workspaceId,
    ...(requestId ? { requestId } : {}),
  });
}

