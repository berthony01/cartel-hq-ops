import { supabase } from "@/integrations/supabase/client";
import type { MotionMode } from "@/lib/sticker-motion";

/**
 * Thin client for the external Supabase Edge Function `sticker-motion-ai`.
 *
 * Phase B1 backend contract only — nothing in the UI calls the billable
 * `startStickerMotionGeneration` yet. The function owns the Kie API key, the
 * prompt compiler, the Quick Motion preset allowlist and all privileged writes;
 * no secret and no prompt text is ever authored client-side.
 *
 * Motion generation is REVIEW-ONLY: it never changes the static current image,
 * `release_variant`, the current motion pointer, Telegram state or Sticker
 * Drops. The 5-second result is a creative source clip, NOT a Telegram-ready
 * animated sticker.
 */

/** The eight server-supported Quick Motion presets. The UI cannot invent others. */
export const STICKER_MOTION_PRESETS = [
  "blink",
  "head_nod",
  "eye_glow",
  "money_rain",
  "angry_shake",
  "laugh",
  "bounce",
  "raise_cigar",
] as const;

export type StickerMotionPreset = (typeof STICKER_MOTION_PRESETS)[number];

/** Human labels for the eight server presets. Display only — the key is sent. */
export const MOTION_PRESET_LABELS: Record<StickerMotionPreset, string> = {
  blink: "Blink",
  head_nod: "Head nod",
  eye_glow: "Eye glow",
  money_rain: "Money rain",
  angry_shake: "Angry shake",
  laugh: "Laugh",
  bounce: "Bounce",
  raise_cigar: "Raise cigar",
};

/** Server-enforced cap on a Custom Motion instruction. */
export const MAX_MOTION_INSTRUCTION_LENGTH = 500;


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
  /** True when the identical live job for this sticker was returned instead of a new spend. */
  reused?: boolean;
};

export type StickerMotionSyncResult = {
  aiJobId?: string;
  status: StickerMotionAiStatus;
  stage?: string;
  motionAssetId?: string | null;
  motionVersionId?: string | null;
  /** Normalized video MIME of the stored source clip. */
  mimeType?: string | null;
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
 * Quick Motion requires a supported preset; Custom Motion requires an
 * instruction (capped server-side); AI Motion is derived deterministically from
 * the sticker's own concept. Billable: only ever call from an explicit
 * confirmed user action.
 */
export function startStickerMotionGeneration(params: {
  workspaceId: string;
  packId: string;
  stickerId: string;
  motionMode: MotionMode;
  motionPreset?: StickerMotionPreset;
  motionInstruction?: string;
}): Promise<StickerMotionStartResult> {
  return invoke<StickerMotionStartResult>({
    action: "start",
    workspaceId: params.workspaceId,
    packId: params.packId,
    stickerId: params.stickerId,
    motionMode: params.motionMode,
    ...(params.motionPreset ? { motionPreset: params.motionPreset } : {}),
    ...(params.motionInstruction
      ? { motionInstruction: params.motionInstruction.slice(0, MAX_MOTION_INSTRUCTION_LENGTH) }
      : {}),
  });
}

/** Polls an existing motion job. Read-only against the provider. */
export function syncStickerMotionJob(aiJobId: string): Promise<StickerMotionSyncResult> {
  return invoke<StickerMotionSyncResult>({ action: "sync", aiJobId });
}

export type StickerMotionSetCurrentResult = {
  alreadyCurrent?: boolean;
  currentMotionVersionId: string | null;
  /** Echoed only — this action never changes it. */
  releaseVariant: string;
  telegramChanged: boolean;
  billable: boolean;
};

/**
 * NON-BILLABLE. Approves an existing motion version as Current Motion by
 * setting `stickers.current_motion_version_id` only. It creates no provider
 * task, and never changes `release_variant`, the static current image, sticker
 * or pack status, Telegram state or Sticker Drops. The server rejects a take
 * whose source static image is no longer the sticker's current static image
 * with `MOTION_SOURCE_STALE`.
 */
export function setCurrentStickerMotion(params: {
  workspaceId: string;
  packId: string;
  stickerId: string;
  motionVersionId: string;
}): Promise<StickerMotionSetCurrentResult> {
  return invoke<StickerMotionSetCurrentResult>({ action: "set_current", ...params });
}
