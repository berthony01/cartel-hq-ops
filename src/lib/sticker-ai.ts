import { supabase } from "@/integrations/supabase/client";

/**
 * Thin client for the external Supabase Edge Function `sticker-ai`.
 * The function owns the Kie API key, generation, background removal,
 * transparency validation and all privileged writes. Nothing here calls a
 * provider directly and no secret is ever read client-side.
 */

export type StickerAiConfig = {
  configured: boolean;
  model: string;
  backgroundModel: string;
};

export type StickerAiStatus = "queued" | "running" | "succeeded" | "failed";

/** Review-only generation modes; absent means ordinary current-image work. */
export type StickerAiMode = "candidate" | "variation";

/** Server-controlled A/B/C variation slot. */
export type StickerVariationLabel = "A" | "B" | "C";

export type StickerAiStartResult = {
  /** Absent only when the server short-circuits an already finished variation. */
  aiJobId?: string;
  status: StickerAiStatus;
  model: string;
  /** Present only for review-only generation. */
  mode?: StickerAiMode;
  variationGroupId?: string | null;
  variationLabel?: StickerVariationLabel | null;
  /** Present when a finished variation slot was reused instead of regenerated. */
  versionId?: string | null;
};

export type StickerAiSyncResult = {
  status: StickerAiStatus;
  stage?: string;
  childJobId?: string | null;
  assetId?: string | null;
  transparencyValid?: boolean;
  error?: string | null;
  /** Present only for review-only generation. */
  mode?: StickerAiMode;
  /** `sticker_versions.id` of the durable review-only record, when finished. */
  versionId?: string | null;
  variationGroupId?: string | null;
  variationLabel?: StickerVariationLabel | null;
};


async function invoke<T>(body: Record<string, unknown>): Promise<T> {
  const { data, error } = await supabase.functions.invoke("sticker-ai", { body });
  if (error) {
    // Supabase may surface a non-2xx Edge Function response as a FunctionsHttpError
    // whose `.context` is the underlying Response. Inspect only safe JSON fields
    // (error, code, message) and never echo headers, auth data, or provider payloads.
    const context = (error as { context?: Response }).context;
    let safeCode: string | undefined;
    let safeMessage = error.message;
    if (context) {
      try {
        const body = await context.clone().json();
        if (body && typeof body === "object") {
          const maybeCode =
            typeof (body as { code?: unknown }).code === "string"
              ? (body as { code: string }).code
              : undefined;
          const maybeError =
            typeof (body as { error?: unknown }).error === "string"
              ? (body as { error: string }).error
              : undefined;
          const maybeMessage =
            typeof (body as { message?: unknown }).message === "string"
              ? (body as { message: string }).message
              : undefined;
          safeCode = maybeCode || maybeError;
          if (maybeMessage) safeMessage = maybeMessage;
        }
      } catch {
        // Parsing failure must not mask the original error; fall through to safe fallback.
      }
    }
    if (safeCode) {
      throw new Error(`${safeCode}: ${safeMessage || "The sticker generation service is unavailable."}`);
    }
    // Surface a user-safe message; never echo headers or provider payloads.
    throw new Error(safeMessage || "The sticker generation service is unavailable.");
  }
  const payload = data as (T & { error?: string; code?: string }) | null;
  if (!payload) throw new Error("Empty response from the sticker generation service.");
  if (payload.code === "KIE_NOT_CONFIGURED") {
    throw new Error("Generation provider is not configured.");
  }
  if (payload.error) throw new Error(payload.error);
  return payload as T;
}

/** Free status probe — does not create a provider task and spends no credits. */
export function fetchStickerAiConfig(): Promise<StickerAiConfig> {
  return invoke<StickerAiConfig>({ action: "config" });
}

/** Creates ONE generation task. Only ever call from an explicit user action. */
export function startStickerGeneration(params: {
  workspaceId: string;
  packId: string;
  stickerId: string;
  referenceAssetIds?: string[];
}): Promise<StickerAiStartResult> {
  return invoke<StickerAiStartResult>({
    action: "start",
    workspaceId: params.workspaceId,
    packId: params.packId,
    stickerId: params.stickerId,
    ...(params.referenceAssetIds?.length
      ? { referenceAssetIds: params.referenceAssetIds }
      : {}),
  });
}

/**
 * Phase 4D — creates ONE candidate generation task for a sticker that is
 * already connected to Telegram. The live sticker, its current image and the
 * published Telegram set are never touched; the result lands in version
 * history only. Billable: only ever call from an explicit confirmed action.
 */
export function startStickerCandidateGeneration(params: {
  workspaceId: string;
  packId: string;
  stickerId: string;
  referenceAssetIds?: string[];
}): Promise<StickerAiStartResult> {
  return invoke<StickerAiStartResult>({
    action: "start_candidate",
    workspaceId: params.workspaceId,
    packId: params.packId,
    stickerId: params.stickerId,
    ...(params.referenceAssetIds?.length
      ? { referenceAssetIds: params.referenceAssetIds }
      : {}),
  });
}

/** Polls an existing job. Read-only against the provider. */
export function syncStickerJob(aiJobId: string): Promise<StickerAiSyncResult> {
  return invoke<StickerAiSyncResult>({ action: "sync", aiJobId });
}


/**
 * A/B/C Variations — creates ONE review-only alternate take for a sticker that
 * already has a current image. The current image, sticker status and any
 * published Telegram set are never touched; the result lands in version
 * history only. Billable: only ever call from an explicit confirmed action.
 *
 * `variationGroupId` identifies one A/B/C round; the server treats a finished
 * (sticker, group, label) slot as idempotent and will not charge twice.
 */
export function startStickerVariationGeneration(params: {
  workspaceId: string;
  packId: string;
  stickerId: string;
  variationGroupId: string;
  variationLabel: StickerVariationLabel;
  referenceAssetIds?: string[];
}): Promise<StickerAiStartResult> {
  return invoke<StickerAiStartResult>({
    action: "start_variation",
    workspaceId: params.workspaceId,
    packId: params.packId,
    stickerId: params.stickerId,
    variationGroupId: params.variationGroupId,
    variationLabel: params.variationLabel,
    ...(params.referenceAssetIds?.length
      ? { referenceAssetIds: params.referenceAssetIds }
      : {}),
  });
}
