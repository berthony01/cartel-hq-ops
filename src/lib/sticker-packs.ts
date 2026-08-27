import { supabase } from "@/integrations/supabase/client";
import type { BuilderDraft, Concept } from "@/lib/sticker-lab";

export type StickerRow = {
  id: string;
  pack_id: string;
  sort_order: number;
  label: string;
  action_description: string | null;
  emoji_list: string[];
  keyword_list: string[];
  status: string;
  image_asset_id: string | null;
  updated_at: string;
};

export type PackRow = {
  id: string;
  workspace_id: string;
  title: string;
  theme: string;
  pack_size: number;
  status: string;
  updated_at: string;
  character_name: string | null;
  brief: string | null;
  style_notes: string | null;
  reference_asset_id: string | null;
};

const PACK_COLUMNS =
  "id,workspace_id,title,theme,pack_size,status,updated_at,character_name,brief,style_notes,reference_asset_id";
const STICKER_COLUMNS =
  "id,pack_id,sort_order,label,action_description,emoji_list,keyword_list,status,image_asset_id,updated_at";

export type PackSummary = PackRow & { total: number; ready: number };

/** Real workspace packs for the Sticker Lab home list. */
export async function listWorkspacePacks(workspaceId: string): Promise<PackSummary[]> {
  const { data, error } = await supabase
    .from("sticker_packs")
    .select(PACK_COLUMNS)
    .eq("workspace_id", workspaceId)
    .order("updated_at", { ascending: false })
    .limit(20);
  if (error) throw error;
  const packs = (data ?? []) as PackRow[];
  if (packs.length === 0) return [];

  const { data: stickerRows, error: stickerError } = await supabase
    .from("stickers")
    .select("id,pack_id,status")
    .in(
      "pack_id",
      packs.map((p) => p.id),
    );
  if (stickerError) throw stickerError;

  return packs.map((p) => {
    const rows = (stickerRows ?? []).filter((s) => s.pack_id === p.id);
    return {
      ...p,
      total: rows.length,
      ready: rows.filter((s) => s.status === "ready").length,
    };
  });
}

export async function loadPackStickers(packId: string): Promise<StickerRow[]> {
  const { data, error } = await supabase
    .from("stickers")
    .select(STICKER_COLUMNS)
    .eq("pack_id", packId)
    .order("sort_order", { ascending: true });
  if (error) throw error;
  return (data ?? []) as StickerRow[];
}

export async function loadPack(packId: string): Promise<PackRow | null> {
  const { data, error } = await supabase
    .from("sticker_packs")
    .select(PACK_COLUMNS)
    .eq("id", packId)
    .maybeSingle();
  if (error) throw error;
  return (data as PackRow | null) ?? null;
}

function keywordsFor(draft: BuilderDraft, concept: Concept): string[] {
  return (draft.keywords[concept.id] ?? "")
    .split(",")
    .map((k) => k.trim())
    .filter(Boolean);
}

export type PersistResult = {
  packId: string;
  stickerIds: Record<string, string>;
  stickers: StickerRow[];
};

/**
 * Idempotently persists the builder draft into the existing sticker_packs /
 * stickers tables. Reuses the pack id stored in the draft so refresh, retry
 * and repeated generation never create duplicate rows.
 */
export async function persistDraft(params: {
  workspaceId: string;
  userId: string;
  draft: BuilderDraft;
}): Promise<PersistResult> {
  const { workspaceId, userId, draft } = params;
  const concepts = draft.concepts;

  const packPayload = {
    title: draft.packName.trim() || "Untitled pack",
    theme: draft.theme.toLowerCase(),
    pack_size: draft.size,
    character_name: draft.characterName.trim() || null,
    brief: draft.brief.trim() || null,
    style_notes: draft.styleNotes.trim() || null,
    reference_asset_id: draft.referenceAssetIds[0] ?? draft.referenceAssetId ?? null,
  };

  let packId = draft.packId;
  if (packId) {
    const existing = await loadPack(packId);
    if (!existing || existing.workspace_id !== workspaceId) packId = null;
  }

  if (packId) {
    const { error } = await supabase
      .from("sticker_packs")
      .update(packPayload)
      .eq("id", packId);
    if (error) throw error;
  } else {
    const { data, error } = await supabase
      .from("sticker_packs")
      .insert({
        workspace_id: workspaceId,
        created_by: userId,
        status: "draft",
        ...packPayload,
      })
      .select("id")
      .single();
    if (error) throw error;
    packId = data.id as string;
  }

  const existingStickers = await loadPackStickers(packId);
  const mapped = { ...draft.stickerIds };
  const keptIds = new Set<string>();
  const stickerIds: Record<string, string> = {};

  for (let i = 0; i < concepts.length; i += 1) {
    const concept = concepts[i]!;
    const payload = {
      sort_order: i,
      label: concept.label.trim() || `Concept ${i + 1}`,
      action_description: concept.action.trim() || null,
      emoji_list: concept.emoji.trim() ? [concept.emoji.trim()] : [],
      keyword_list: keywordsFor(draft, concept),
    };

    const candidateId = mapped[concept.id];
    const match =
      existingStickers.find((s) => s.id === candidateId) ??
      (candidateId
        ? undefined
        : existingStickers.find((s) => s.sort_order === i && !keptIds.has(s.id)));

    if (match) {
      keptIds.add(match.id);
      stickerIds[concept.id] = match.id;
      const { error } = await supabase.from("stickers").update(payload).eq("id", match.id);
      if (error) throw error;
    } else {
      const { data, error } = await supabase
        .from("stickers")
        .insert({ pack_id: packId, status: "draft", ...payload })
        .select("id")
        .single();
      if (error) throw error;
      keptIds.add(data.id as string);
      stickerIds[concept.id] = data.id as string;
    }
  }

  // Remove sticker rows for concepts the user deleted from the draft.
  const orphans = existingStickers.filter((s) => !keptIds.has(s.id)).map((s) => s.id);
  if (orphans.length > 0) {
    const { error } = await supabase.from("stickers").delete().in("id", orphans);
    if (error) throw error;
  }

  const stickers = await loadPackStickers(packId);
  return { packId, stickerIds, stickers };
}

export type GeneratedAsset = {
  id: string;
  storage_path: string;
  transparency_valid: boolean | null;
  width: number | null;
  height: number | null;
};

export async function loadAssets(ids: string[]): Promise<Record<string, GeneratedAsset>> {
  const out: Record<string, GeneratedAsset> = {};
  const unique = Array.from(new Set(ids.filter(Boolean)));
  if (unique.length === 0) return out;
  const { data, error } = await supabase
    .from("media_assets")
    .select("id,storage_path,transparency_valid,width,height")
    .in("id", unique);
  if (error) throw error;
  for (const row of (data ?? []) as GeneratedAsset[]) out[row.id] = row;
  return out;
}
