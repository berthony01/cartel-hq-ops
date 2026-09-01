import { supabase } from "@/integrations/supabase/client";
import type { MotionMode } from "@/lib/sticker-motion";

/**
 * Thin client for the external Supabase Edge Function `sticker-motion-ai`.
 *
 * Phase B1 backend contract only — nothing in the UI calls the billable
 * `startStickerMotionGeneration` yet. The function owns the Kie API key and all
 * privileged writes; no secret is ever read client-side.
 *
 * Motion generation is REVIEW-ONLY: it never changes the static current image,
 * `release_variant`, the current motion pointer, Telegram state or Sticker
 * Drops. The 5-second result is a creative source clip, NOT a Telegram-ready
 * animated sticker.
 */

export type StickerMotionAiConfig = {
  configured: boolean;
  model: string;
  durationSeconds: number;
  /** Always false in Phase B1 — no transcoding or Telegram compliance yet. */
  telegramReady: boolean;
};

export type StickerMotionAiStatus = "queued" | "running" | "succeeded" | "failed";

export type StickerMotionStartResult = {
  aiJobId: string;
  status: StickerMotionAiStatus;
  model: string;
  /** True when an already-live job for this sticker was returned instead of a new spend. */
  reused?: boolean;
};

export type StickerMotionSyncResult = {
  aiJobId?: string;
  status: StickerMotionAiStatus;
  stage?: string;
  motionAssetId?: string | null;
  motionVersionId?: string | null;
  telegramReady?: boolean;
  providerMessage?: string;
  error?: string | null;
};

async function invoke<T>(body: Record<string, unknown>): Promise<T> {
  const { data, error } = await supabase.functions.invoke("sticker-motion-ai", { body });
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
      throw new Error(`${safeCode}: ${safeMessage || "The motion generation service is unavailable."}`);
    }
    throw new Error(safeMessage || "The motion generation service is unavailable.");
  }
  const payload = data as (T & { error?: string; code?: string }) | null;
  if (!payload) throw new Error("Empty response from the motion generation service.");
  if (payload.code === "KIE_NOT_CONFIGURED") {
    throw new Error("Motion generation provider is not configured.");
  }
  if (payload.error) throw new Error(payload.error);
  return payload as T;
}

/** Free status probe — creates no provider task and spends no credits. */
export function fetchStickerMotionAiConfig(): Promise<StickerMotionAiConfig> {
  return invoke<StickerMotionAiConfig>({ action: "config" });
}

/**
 * Creates ONE review-only motion task from the sticker's current static image.
 * Billable: only ever call from an explicit confirmed user action.
 */
export function startStickerMotionGeneration(params: {
  workspaceId: string;
  packId: string;
  stickerId: string;
  motionMode: MotionMode;
  motionPreset?: string;
  motionInstruction?: string;
}): Promise<StickerMotionStartResult> {
  return invoke<StickerMotionStartResult>({
    action: "start_motion",
    workspaceId: params.workspaceId,
    packId: params.packId,
    stickerId: params.stickerId,
    motionMode: params.motionMode,
    ...(params.motionPreset ? { motionPreset: params.motionPreset } : {}),
    ...(params.motionInstruction ? { motionInstruction: params.motionInstruction } : {}),
  });
}

/** Polls an existing motion job. Read-only against the provider. */
export function syncStickerMotionJob(aiJobId: string): Promise<StickerMotionSyncResult> {
  return invoke<StickerMotionSyncResult>({ action: "sync_motion", aiJobId });
}
