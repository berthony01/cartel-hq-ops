import { supabase } from "@/integrations/supabase/client";

/**
 * Thin client for the external Supabase Edge Function `sticker-concepts`.
 *
 * TEXT ONLY. This module never starts image generation, never touches
 * `sticker-ai`, and never reads a provider secret client-side. It returns
 * editable concept suggestions the user must explicitly apply.
 */

export type StickerConceptConfig = {
  configured: boolean;
  model: string;
};

export type SuggestedConcept = {
  label: string;
  action: string;
  emoji: string;
};

export type StickerConceptUsage = {
  promptTokens: number;
  completionTokens: number;
  totalTokens: number;
};

export type StickerConceptSuggestion = {
  concepts: SuggestedConcept[];
  model: string;
  usage: StickerConceptUsage | null;
};

export type SuggestStickerConceptsInput = {
  workspaceId: string;
  size: number;
  characterName?: string;
  theme?: string;
  brief?: string;
  styleNotes?: string;
  creativeBlueprint?: unknown;
  concepts?: Array<{ label: string; action: string }>;
};

async function invoke<T>(body: Record<string, unknown>): Promise<T> {
  const { data, error } = await supabase.functions.invoke("sticker-concepts", { body });
  if (error) {
    throw new Error(error.message || "The concept service is unavailable.");
  }
  const payload = data as (T & { error?: string; message?: string }) | null;
  if (!payload) throw new Error("Empty response from the concept service.");
  if (payload.error) {
    throw new Error(payload.message || "The concept service could not complete this request.");
  }
  return payload as T;
}

/** Free status probe — never contacts the language model and spends nothing. */
export function fetchStickerConceptConfig(): Promise<StickerConceptConfig> {
  return invoke<StickerConceptConfig>({ action: "config" });
}

/**
 * Requests ONE set of concept suggestions. Consumes language-model usage.
 * Only ever call from an explicit, confirmed user action.
 */
export function suggestStickerConcepts(
  params: SuggestStickerConceptsInput,
): Promise<StickerConceptSuggestion> {
  return invoke<StickerConceptSuggestion>({
    action: "suggest",
    workspaceId: params.workspaceId,
    size: params.size,
    characterName: params.characterName ?? "",
    theme: params.theme ?? "",
    brief: params.brief ?? "",
    styleNotes: params.styleNotes ?? "",
    creativeBlueprint: params.creativeBlueprint ?? null,
    concepts: params.concepts ?? [],
  });
}
