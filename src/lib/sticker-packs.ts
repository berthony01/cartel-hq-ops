import { supabase } from "@/integrations/supabase/client";
import {
  PACK_SIZES,
  PACK_THEMES,
  emptyDraft,
  type BuilderDraft,
  type Concept,
  type PackSize,
} from "@/lib/sticker-lab";

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
  archived_at: string | null;
  archived_by: string | null;
};

const PACK_COLUMNS =
  "id,workspace_id,title,theme,pack_size,status,updated_at,character_name,brief,style_notes,reference_asset_id,archived_at,archived_by";
const STICKER_COLUMNS =
  "id,pack_id,sort_order,label,action_description,emoji_list,keyword_list,status,image_asset_id,updated_at";

export type PackSummary = PackRow & { total: number; ready: number; active: number };

async function summarizePacks(packs: PackRow[]): Promise<PackSummary[]> {
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
      // A published sticker is still a finished, exportable sticker.
      ready: rows.filter((s) => s.status === "ready" || s.status === "published").length,
      active: rows.filter((s) => s.status === "generating" || s.status === "queued").length,
    };
  });
}

/** Active (non-archived) workspace packs for the Sticker Lab home list. */
export async function listWorkspacePacks(workspaceId: string): Promise<PackSummary[]> {
  const { data, error } = await supabase
    .from("sticker_packs")
    .select(PACK_COLUMNS)
    .eq("workspace_id", workspaceId)
    .is("archived_at", null)
    .order("updated_at", { ascending: false })
    .limit(20);
  if (error) throw error;
  return summarizePacks((data ?? []) as PackRow[]);
}

/** Archived packs, newest archive first. Kept out of the active list. */
export async function listArchivedPacks(workspaceId: string): Promise<PackSummary[]> {
  const { data, error } = await supabase
    .from("sticker_packs")
    .select(PACK_COLUMNS)
    .eq("workspace_id", workspaceId)
    .not("archived_at", "is", null)
    .order("archived_at", { ascending: false })
    .limit(50);
  if (error) throw error;
  return summarizePacks((data ?? []) as PackRow[]);
}

/* ---------------------------------------------------------------------------
 * Pack lifecycle (archive / restore / permanent delete)
 *
 * Every rule is enforced by SECURITY DEFINER RPCs in the database: operator
 * role, eligibility, atomic Sticker Drop pausing, and which media rows may be
 * removed. The client only relays the outcome, so nothing here can be bypassed
 * by editing the UI.
 * ------------------------------------------------------------------------ */

export type PackLifecycleBlockingReason =
  | "telegram_published"
  | "telegram_stickers_exist"
  | "community_delivery_history"
  | "sticker_drop_schedules"
  | "sticker_drop_history"
  | "active_ai_jobs"
  | (string & {});

export type PackLifecycleState = {
  pack_id: string;
  title: string;
  status: string;
  archived: boolean;
  archived_at: string | null;
  can_manage: boolean;
  can_delete: boolean;
  can_archive: boolean;
  can_restore: boolean;
  blocking_reasons: PackLifecycleBlockingReason[];
};

export const PACK_BLOCKING_REASON_LABELS: Record<string, string> = {
  telegram_published: "Published as a Telegram sticker set",
  telegram_stickers_exist: "Stickers already live on Telegram",
  community_delivery_history: "Already sent to communities",
  sticker_drop_schedules: "Used by Sticker Drops",
  sticker_drop_history: "Has Sticker Drop history",
  active_ai_jobs: "Generation is still running",
  pack_status_published: "Pack is published",
  pack_status_publishing: "Pack is publishing right now",
  pack_status_generating: "Pack is generating right now",
};

export function describeBlockingReasons(reasons: PackLifecycleBlockingReason[]): string[] {
  return reasons.map((r) => PACK_BLOCKING_REASON_LABELS[r] ?? "Has durable history");
}

export async function inspectPackLifecycle(packId: string): Promise<PackLifecycleState> {
  const { data, error } = await supabase.rpc("sticker_pack_lifecycle_state", { _pack_id: packId });
  if (error) throw error;
  return data as unknown as PackLifecycleState;
}

export async function archivePack(packId: string): Promise<void> {
  const { error } = await supabase.rpc("archive_sticker_pack", { _pack_id: packId });
  if (error) throw error;
}

export async function restorePack(packId: string): Promise<void> {
  const { error } = await supabase.rpc("restore_sticker_pack", { _pack_id: packId });
  if (error) throw error;
}

export type PackDeleteResult = {
  deleted: boolean;
  archiveRequired: boolean;
  blockingReasons: PackLifecycleBlockingReason[];
  removedImages: number;
  storageCleanupPending: boolean;
};

/**
 * Permanent delete. The RPC validates eligibility and commits the database
 * removal atomically, then returns the storage paths of generated sticker
 * images that belonged only to this pack. Shared Brand Kit / reference /
 * project-profile assets are never included. Storage cleanup runs after the
 * commit: a leftover private object is safer than a half-deleted pack.
 */
export async function deletePackPermanently(packId: string): Promise<PackDeleteResult> {
  const { data, error } = await supabase.rpc("delete_sticker_pack_if_eligible", { _pack_id: packId });
  if (error) throw error;

  const result = (data ?? {}) as {
    deleted?: boolean;
    archive_required?: boolean;
    blocking_reasons?: string[];
    storage_paths?: string[];
  };

  if (!result.deleted) {
    return {
      deleted: false,
      archiveRequired: true,
      blockingReasons: result.blocking_reasons ?? [],
      removedImages: 0,
      storageCleanupPending: false,
    };
  }

  const paths = (result.storage_paths ?? []).filter((p) => typeof p === "string" && p.length > 0);
  let storageCleanupPending = false;
  if (paths.length > 0) {
    const { error: storageError } = await supabase.storage.from(ASSETS_BUCKET).remove(paths);
    if (storageError) storageCleanupPending = true;
  }

  return {
    deleted: true,
    archiveRequired: false,
    blockingReasons: [],
    removedImages: paths.length,
    storageCleanupPending,
  };
}


export type AiJobRow = {
  id: string;
  sticker_id: string | null;
  job_type: string;
  status: string;
  error_message: string | null;
  created_at: string;
};

/**
 * Latest ai_jobs rows per sticker, newest first. Read-only; never touches the
 * provider. Used to derive durable card state after a browser refresh.
 */
export async function loadLatestJobs(
  stickerIds: string[],
): Promise<Record<string, AiJobRow[]>> {
  const out: Record<string, AiJobRow[]> = {};
  const unique = Array.from(new Set(stickerIds.filter(Boolean)));
  if (unique.length === 0) return out;
  const { data, error } = await supabase
    .from("ai_jobs")
    .select("id,sticker_id,job_type,status,error_message,created_at")
    .in("sticker_id", unique)
    .order("created_at", { ascending: false })
    .limit(500);
  if (error) throw error;
  for (const row of (data ?? []) as AiJobRow[]) {
    if (!row.sticker_id) continue;
    (out[row.sticker_id] ??= []).push(row);
  }
  return out;
}

export type FailureKind =
  | "safety"
  | "busy"
  | "rate_limit"
  | "network"
  | "service"
  | "unknown";

export type ProviderFailure = {
  kind: FailureKind;
  title: string;
  body: string;
  /** Raw provider text — technical-detail disclosure only, never the primary message. */
  raw: string | null;
};

/**
 * Maps a raw provider/job error to a structured, plain-English failure the UI
 * can render with a clear title, explanation and next action. The raw text is
 * preserved separately for a technical-detail surface only.
 */
export function classifyProviderError(
  raw: string | null | undefined,
  jobType?: string | null,
): ProviderFailure {
  const text = (raw ?? "").trim();
  const lower = text.toLowerCase();
  const background = (jobType ?? "").toLowerCase().includes("background");
  const detail = text || null;

  const has = (...needles: string[]) => needles.some((n) => lower.includes(n));

  if (has("sensitive", "flagged", "content policy", "moderation", "safety", "nsfw", "prohibited")) {
    return {
      kind: "safety",
      title: "Blocked by the image filter",
      body: "The provider's safety filter rejected this sticker's wording or reference image. Try a milder action description — for example remove weapons, blood, gore or brand names — or pick a different reference image, then retry.",
      raw: detail,
    };
  }

  if (text.includes("服务繁忙") || has("busy", "queue", "queued", "capacity", "overloaded")) {
    const queued = text.match(/(\d+)/)?.[1];
    return {
      kind: "busy",
      title: "Provider is busy",
      body: queued
        ? `Kie is handling too many tasks right now (${queued} were queued). Nothing was lost — wait a minute and retry this sticker.`
        : "Kie is handling too many tasks right now. Nothing was lost — wait a minute and retry this sticker.",
      raw: detail,
    };
  }

  if (has("rate limit", "rate-limit", "ratelimit", "429", "too many requests")) {
    return {
      kind: "rate_limit",
      title: "Rate limit reached",
      body: "Too many generations were sent in a short window. Wait about a minute, then retry. Stickers that already finished are unaffected.",
      raw: detail,
    };
  }

  if (has("fetch failed", "network", "econnreset", "enotfound", "socket", "abort", "connection")) {
    return {
      kind: "network",
      title: "Connection interrupted",
      body: "The request to the generation service did not complete. This is usually temporary — check your connection and retry this sticker.",
      raw: detail,
    };
  }

  if (has("503", "502", "504", "unavailable", "timeout", "timed out", "gateway", "internal server")) {
    return {
      kind: "service",
      title: "Generation service unavailable",
      body: "The generation service did not respond in time. Your pack and every finished sticker are safe. Try again shortly.",
      raw: detail,
    };
  }

  return {
    kind: "unknown",
    title: background ? "Background removal didn't finish" : "This sticker didn't finish",
    body: background
      ? "The image was generated but the background could not be removed, so no transparent PNG was stored. Nothing else in the pack was affected. Retry this sticker."
      : "The last attempt failed before an image was stored. Nothing else in the pack was affected. Retry this sticker.",
    raw: detail,
  };
}

/** Attempt count and last failure reason per sticker, derived from ai_jobs rows. */
export function summarizeAttempts(jobs: AiJobRow[] | undefined): {
  attempts: number;
  failed: number;
  lastFailure: string | null;
} {
  const rows = jobs ?? [];
  // One user attempt spawns a generation job (and possibly a background child).
  const attempts = rows.filter((j) => !j.job_type.toLowerCase().includes("background")).length;
  const failedRows = rows.filter((j) => j.status === "failed");
  const last = failedRows[0];
  return {
    attempts: attempts || rows.length,
    failed: failedRows.length,
    lastFailure: last ? classifyProviderError(last.error_message, last.job_type).title : null,
  };
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

/**
 * Rebuilds a builder draft from persisted Supabase rows so `/sticker-lab/new?pack=<id>`
 * is a durable, resumable identity independent of sessionStorage.
 * Read-only: never inserts, updates or deletes rows.
 */
export async function hydrateDraftFromPack(params: {
  packId: string;
  workspaceId: string;
}): Promise<BuilderDraft | null> {
  const { packId, workspaceId } = params;
  const pack = await loadPack(packId);
  if (!pack || pack.workspace_id !== workspaceId) return null;

  const rows = await loadPackStickers(packId);
  const base = emptyDraft();

  const theme =
    PACK_THEMES.find((t) => t.toLowerCase() === (pack.theme ?? "").toLowerCase()) ??
    base.theme;
  const size = (PACK_SIZES as readonly number[]).includes(pack.pack_size)
    ? (pack.pack_size as PackSize)
    : base.size;

  const concepts: Concept[] = rows.map((row, i) => ({
    id: `c${i + 1}`,
    label: row.label,
    action: row.action_description ?? "",
    emoji: row.emoji_list?.[0] ?? "",
  }));
  const keywords: Record<string, string> = {};
  const stickerIds: Record<string, string> = {};
  rows.forEach((row, i) => {
    const localId = `c${i + 1}`;
    stickerIds[localId] = row.id;
    keywords[localId] = (row.keyword_list ?? []).join(", ");
  });

  return {
    ...base,
    characterName: pack.character_name ?? "",
    referenceAssetId: pack.reference_asset_id,
    referenceAssetIds: pack.reference_asset_id ? [pack.reference_asset_id] : [],
    packName: pack.title,
    theme,
    size,
    brief: pack.brief ?? "",
    styleNotes: pack.style_notes ?? "",
    concepts: concepts.length > 0 ? concepts : base.concepts,
    keywords,
    packId: pack.id,
    stickerIds,
  };
}
