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
  botStartUrl?: string;
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
