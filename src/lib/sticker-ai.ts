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

export type StickerAiStartResult = {
  aiJobId: string;
  status: StickerAiStatus;
  model: string;
};

export type StickerAiSyncResult = {
  status: StickerAiStatus;
  stage?: string;
  childJobId?: string | null;
  assetId?: string | null;
  transparencyValid?: boolean;
  error?: string | null;
};

async function invoke<T>(body: Record<string, unknown>): Promise<T> {
  const { data, error } = await supabase.functions.invoke("sticker-ai", { body });
  if (error) {
    // Surface a user-safe message; never echo headers or provider payloads.
    throw new Error(error.message || "The sticker generation service is unavailable.");
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

/** Polls an existing job. Read-only against the provider. */
export function syncStickerJob(aiJobId: string): Promise<StickerAiSyncResult> {
  return invoke<StickerAiSyncResult>({ action: "sync", aiJobId });
}
