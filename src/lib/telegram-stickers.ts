import { supabase } from "@/integrations/supabase/client";

/**
 * Thin client for the external Supabase Edge Function `telegram-stickers`.
 * The function owns TELEGRAM_BOT_TOKEN, all Telegram API calls, the 512px
 * static preparation step and every privileged write. Nothing here talks to
 * api.telegram.org and no bot token is ever read, stored or accepted client-side.
 */

export type TelegramBot = { id?: string; username?: string; firstName?: string };

export type TelegramConfig = {
  configured: boolean;
  reason?: string;
  bot?: TelegramBot;
  botStartUrl?: string;
};

export type TelegramPublishFailure = {
  stickerId?: string;
  label?: string;
  message?: string;
  technical?: string;
};

export type TelegramPublishResult = {
  status: "published" | "partial" | "failed";
  setName?: string;
  setUrl?: string;
  published: number;
  total: number;
  failed: number;
  failures?: TelegramPublishFailure[];
  bot?: TelegramBot;
};

export type TelegramRefreshResult = {
  exists: boolean;
  bot?: TelegramBot;
  packStatus?: string;
  setName?: string;
  setUrl?: string;
  stickerCount?: number;
};

export type TelegramSendTestResult = {
  sent: boolean;
  bot?: TelegramBot;
  message?: string;
  technical?: string;
  botStartUrl?: string;
};

/** Best-effort read of the server's JSON `message` from a non-2xx FunctionsHttpError. */
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
  const { data, error } = await supabase.functions.invoke("telegram-stickers", { body });
  if (error) {
    const serverMessage = await readServerMessage(error);
    throw new Error(
      serverMessage || error.message || "The Telegram service is unavailable right now.",
    );
  }
  const payload = data as (T & { error?: string; code?: string }) | null;
  if (!payload) throw new Error("Empty response from the Telegram service.");
  if (payload.error) throw new Error(payload.error);
  return payload as T;
}


/** Free probe. Reports whether the bot secret is configured server-side. */
export function fetchTelegramConfig(): Promise<TelegramConfig> {
  return invoke<TelegramConfig>({ action: "config" });
}

/** Publishes (or retries) a pack. Only ever call from an explicit user click. */
export function publishPack(params: {
  workspaceId: string;
  packId: string;
  /** Review/export-approved sticker row IDs. The server attempts only these. */
  stickerIds: string[];
}): Promise<TelegramPublishResult> {
  return invoke<TelegramPublishResult>({
    action: "publish",
    workspaceId: params.workspaceId,
    packId: params.packId,
    stickerIds: params.stickerIds,
  });
}

/** Read-only Telegram set status for a pack. */
export function refreshPackStatus(params: {
  workspaceId: string;
  packId: string;
}): Promise<TelegramRefreshResult> {
  return invoke<TelegramRefreshResult>({
    action: "refresh",
    workspaceId: params.workspaceId,
    packId: params.packId,
  });
}

/** Sends one published sticker as a native Telegram sticker to the connected user. */
export function sendTestSticker(params: {
  workspaceId: string;
  packId: string;
  stickerId?: string;
}): Promise<TelegramSendTestResult> {
  return invoke<TelegramSendTestResult>({
    action: "send_test",
    workspaceId: params.workspaceId,
    packId: params.packId,
    ...(params.stickerId ? { stickerId: params.stickerId } : {}),
  });
}

/* ------------------------------------------------------------------ */
/* telegram_connections — own-row RLS, read/upsert only                */
/* ------------------------------------------------------------------ */

export type TelegramConnection = {
  user_id: string;
  telegram_user_id: number;
  telegram_username: string | null;
  first_name: string | null;
  last_name: string | null;
  connected_at: string;
};

const CONNECTION_COLUMNS =
  "user_id,telegram_user_id,telegram_username,first_name,last_name,connected_at";

export async function loadTelegramConnection(userId: string): Promise<TelegramConnection | null> {
  const { data, error } = await supabase
    .from("telegram_connections")
    .select(CONNECTION_COLUMNS)
    .eq("user_id", userId)
    .maybeSingle();
  if (error) throw error;
  return (data as TelegramConnection | null) ?? null;
}

export async function saveTelegramConnection(params: {
  userId: string;
  telegramUserId: number;
  telegramUsername?: string | null;
}): Promise<TelegramConnection> {
  const username = (params.telegramUsername ?? "").trim().replace(/^@/, "");
  const { data, error } = await supabase
    .from("telegram_connections")
    .upsert(
      {
        user_id: params.userId,
        telegram_user_id: params.telegramUserId,
        telegram_username: username || null,
      },
      { onConflict: "user_id" },
    )
    .select(CONNECTION_COLUMNS)
    .single();
  if (error) throw error;
  return data as TelegramConnection;
}

/* ------------------------------------------------------------------ */
/* Read-only Telegram publish state straight from the existing tables  */
/* ------------------------------------------------------------------ */

export type PackTelegramState = {
  status: string;
  telegram_set_name: string | null;
  telegram_set_url: string | null;
  telegram_publish_error: string | null;
  telegram_published_at: string | null;
};

export type StickerTelegramState = {
  id: string;
  status: string;
  telegram_file_id: string | null;
  telegram_publish_error: string | null;
  telegram_published_at: string | null;
};

export async function loadPackTelegramState(packId: string): Promise<{
  pack: PackTelegramState | null;
  stickers: Record<string, StickerTelegramState>;
}> {
  const [packRes, stickerRes] = await Promise.all([
    supabase
      .from("sticker_packs")
      .select(
        "status,telegram_set_name,telegram_set_url,telegram_publish_error,telegram_published_at",
      )
      .eq("id", packId)
      .maybeSingle(),
    supabase
      .from("stickers")
      .select("id,status,telegram_file_id,telegram_publish_error,telegram_published_at")
      .eq("pack_id", packId),
  ]);
  if (packRes.error) throw packRes.error;
  if (stickerRes.error) throw stickerRes.error;
  const stickers: Record<string, StickerTelegramState> = {};
  for (const row of (stickerRes.data ?? []) as StickerTelegramState[]) stickers[row.id] = row;
  return { pack: (packRes.data as PackTelegramState | null) ?? null, stickers };
}

/**
 * Preview only. The authoritative set name always comes back from the server.
 * Telegram short names: letters/digits/underscore, must end in `_by_<bot>`.
 */
export function previewShortName(
  title: string,
  packId: string,
  botUsername?: string,
): string | null {
  if (!botUsername) return null;
  const base = (title || "cartel_pack")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, 24);
  const suffix = packId.replace(/-/g, "").slice(0, 8);
  return `${base || "cartel_pack"}_${suffix}_by_${botUsername}`;
}

/** Turns any thrown error into a short, user-safe line. */
export function telegramErrorMessage(err: unknown): string {
  const raw = err instanceof Error ? err.message : "";
  if (!raw) return "Telegram request failed. Try again in a moment.";
  return raw.length > 220 ? `${raw.slice(0, 217)}…` : raw;
}
