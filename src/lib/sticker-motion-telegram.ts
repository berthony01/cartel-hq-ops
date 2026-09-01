import { supabase } from "@/integrations/supabase/client";

/**
 * Thin client for the external Supabase Edge Function `sticker-motion-telegram`
 * (Phase C1 contract, live version 2).
 *
 * MEDIA PREPARATION ONLY. This never publishes to Telegram, never touches
 * `release_variant`, the static current image, the Current Motion pointer,
 * Sticker Drops or any Telegram Bot API surface. The C1 function always
 * reports `telegram_accepted: false`.
 *
 * Cost truth:
 *  - `config` is FREE and starts no provider work.
 *  - `start` MAY start paid external media processing (background removal +
 *    normalization) through the providers configured server-side.
 *  - `sync` is recovery/polling only and never starts provider work.
 *
 * No secret, provider endpoint, model contract or price is authored here.
 */

export type StickerMotionTelegramConfig = {
  configured: boolean;
  falConfigured: boolean;
  cloudConvertConfigured: boolean;
  falModel: string;
  normalizeContractVersion: string | number;
  prepContractVersion: string | number;
  telegram: {
    format?: string;
    mimeType?: string;
    codec?: string;
    maxDurationSeconds?: number;
    maxFps?: number;
    maxBytes?: number;
    maxDimension?: number;
  };
  /** Always false in the C1 contract. */
  publishesToTelegram: boolean;
};

export type StickerMotionTelegramStatus = "queued" | "running" | "succeeded" | "failed" | "ready";

export type StickerMotionTelegramStartResult = {
  aiJobId?: string;
  status: StickerMotionTelegramStatus;
  stage?: string;
  /** True when an existing live job or an already-prepared asset was returned. */
  reused?: boolean;
  billable?: boolean;
  telegramMotionAssetId?: string | null;
  motionVersionId?: string | null;
  telegramReady?: boolean;
  /** Always false: C1 never publishes. */
  telegramAccepted?: boolean;
  telegramChanged?: boolean;
  releaseChanged?: boolean;
  /** R3 — present only for a normalization-only recovery job. */
  retryKind?: "normalization_only";
};


export type StickerMotionTelegramSyncResult = {
  aiJobId?: string;
  jobType?: string;
  status: StickerMotionTelegramStatus;
  stage?: string;
  telegramMotionAssetId?: string | null;
  motionVersionId?: string | null;
  providerMessage?: string;
  validation?: unknown;
  error?: string | null;
  message?: string;
};

async function invoke<T>(body: Record<string, unknown>): Promise<T> {
  const { data, error } = await supabase.functions.invoke("sticker-motion-telegram", { body });
  if (error) {
    // A non-2xx Edge Function response surfaces as FunctionsHttpError whose
    // `.context` is the underlying Response. Only safe JSON fields are read.
    const context = (error as { context?: Response }).context;
    let safeCode: string | undefined;
    let safeMessage = error.message;
    if (context) {
      try {
        const parsed = await context.clone().json();
        if (parsed && typeof parsed === "object") {
          const maybeCode =
            typeof (parsed as { code?: unknown }).code === "string"
              ? (parsed as { code: string }).code
              : undefined;
          const maybeError =
            typeof (parsed as { error?: unknown }).error === "string"
              ? (parsed as { error: string }).error
              : undefined;
          const maybeMessage =
            typeof (parsed as { message?: unknown }).message === "string"
              ? (parsed as { message: string }).message
              : undefined;
          safeCode = maybeCode || maybeError;
          if (maybeMessage) safeMessage = maybeMessage;
        }
      } catch {
        // Parsing failure must not mask the original error.
      }
    }
    if (safeCode) {
      throw new Error(
        `${safeCode}: ${safeMessage || "The Telegram preparation service is unavailable."}`,
      );
    }
    throw new Error(safeMessage || "The Telegram preparation service is unavailable.");
  }
  const payload = data as (T & { error?: string; code?: string; message?: string }) | null;
  if (!payload) throw new Error("Empty response from the Telegram preparation service.");
  if (payload.error) {
    throw new Error(payload.message ? `${payload.error}: ${payload.message}` : payload.error);
  }
  return payload as T;
}

/** FREE status probe. Creates no provider task and spends nothing. */
export function fetchStickerMotionTelegramConfig(): Promise<StickerMotionTelegramConfig> {
  return invoke<StickerMotionTelegramConfig>({ action: "config" });
}

/**
 * MAY BE BILLABLE. Prepares a Telegram-formatted derivative of the APPROVED
 * Current Motion. Only ever call from an explicit, confirmed user action.
 * Nothing is published to Telegram by this call.
 */
export function startStickerMotionTelegramPrepare(params: {
  workspaceId: string;
  packId: string;
  stickerId: string;
  motionVersionId: string;
}): Promise<StickerMotionTelegramStartResult> {
  return invoke<StickerMotionTelegramStartResult>({ action: "start", ...params });
}

/** Recovery/polling only. Never starts provider work. */
export function syncStickerMotionTelegramPrepare(
  aiJobId: string,
): Promise<StickerMotionTelegramSyncResult> {
  return invoke<StickerMotionTelegramSyncResult>({ action: "sync", aiJobId });
}
