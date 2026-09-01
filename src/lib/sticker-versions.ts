import { supabase } from "@/integrations/supabase/client";
import { loadAssets } from "@/lib/sticker-packs";
import { signedUrlMap } from "@/lib/media";

/**
 * Read-only sticker image history.
 *
 * `stickers.image_asset_id` remains the ONLY authoritative current image.
 * Rows here are a preserved historical record captured server-side; this
 * module never inserts, updates or deletes anything.
 */

/** Preview links for this read-only surface live about an hour. */
const HISTORY_URL_TTL = 3600;

export type StickerVersionOrigin =
  | "generation"
  | "backfill"
  /** Phase 4D — image generated for review while the live sticker stays live. */
  | "candidate_generation"
  /** A/B/C Variations — deliberate review-only alternate take. */
  | "variation_generation"
  | string;

/** True for a Phase 4D candidate history row. Presentation helper only. */
export const isCandidateVersionOrigin = (origin: StickerVersionOrigin) =>
  origin === "candidate_generation";

/** True for an A/B/C variation history row. Presentation helper only. */
export const isVariationVersionOrigin = (origin: StickerVersionOrigin) =>
  origin === "variation_generation";

export type StickerVariationLabel = "A" | "B" | "C";

export type StickerVersion = {
  id: string;
  stickerId: string;
  packId: string;
  versionNumber: number;
  origin: StickerVersionOrigin;
  createdAt: string;
  /** Null when the historical asset no longer exists. */
  assetId: string | null;
  /** Null when the asset is missing or no signed link could be created. */
  storagePath: string | null;
  previewUrl: string | null;
  /** True when the image behind this history row can no longer be shown. */
  unavailable: boolean;
  /** A/B/C round this row belongs to; null for non-variation rows. */
  variationGroupId: string | null;
  /** "A" | "B" | "C" for a variation row, otherwise null. */
  variationLabel: StickerVariationLabel | null;
};

export type StickerVersionsBySticker = Record<string, StickerVersion[]>;

/**
 * Loads version history for the supplied saved sticker ids, grouped by
 * sticker id and ordered newest version first. Rows whose asset was removed
 * are preserved and flagged `unavailable` rather than dropped.
 */
export async function loadStickerVersions(
  stickerIds: string[],
): Promise<StickerVersionsBySticker> {
  const unique = Array.from(new Set(stickerIds.filter(Boolean)));
  const grouped: StickerVersionsBySticker = {};
  if (unique.length === 0) return grouped;

  const { data, error } = await supabase
    .from("sticker_versions")
    .select("id,sticker_id,pack_id,asset_id,version_number,origin,created_at")
    .in("sticker_id", unique)
    .order("version_number", { ascending: false });
  if (error) throw error;

  const rows = data ?? [];
  if (rows.length === 0) return grouped;

  const assetIds = rows.map((r) => r.asset_id).filter((v): v is string => !!v);

  let assets: Awaited<ReturnType<typeof loadAssets>> = {};
  try {
    assets = await loadAssets(assetIds);
  } catch {
    /* history stays visible even if asset lookup fails */
  }

  const paths = Object.values(assets).map((a) => a.storage_path);
  let urls: Record<string, string> = {};
  if (paths.length > 0) {
    try {
      urls = await signedUrlMap(paths, HISTORY_URL_TTL);
    } catch {
      /* rows degrade to "unavailable" rather than disappearing */
    }
  }

  for (const row of rows) {
    const asset = row.asset_id ? assets[row.asset_id] : undefined;
    const storagePath = asset?.storage_path ?? null;
    const previewUrl = storagePath ? (urls[storagePath] ?? null) : null;
    const entry: StickerVersion = {
      id: row.id,
      stickerId: row.sticker_id,
      packId: row.pack_id,
      versionNumber: row.version_number,
      origin: row.origin,
      createdAt: row.created_at,
      assetId: row.asset_id,
      storagePath,
      previewUrl,
      unavailable: !previewUrl,
    };
    (grouped[row.sticker_id] ??= []).push(entry);
  }

  for (const list of Object.values(grouped)) {
    list.sort((a, b) => b.versionNumber - a.versionNumber);
  }

  return grouped;
}

/* ------------------------------------------------------------------ */
/* Set current version — server-authoritative RPC only                  */
/* ------------------------------------------------------------------ */

/**
 * Narrow status union for `public.set_sticker_current_version`.
 *
 * The browser NEVER updates `stickers.image_asset_id` directly. The RPC owns
 * membership, version ownership, asset readiness, active-job and
 * Telegram-state validation, and this wrapper only normalises its JSON.
 */
export type SetCurrentVersionStatus =
  | "switched"
  | "unchanged"
  | "telegram_required"
  | "active_generation"
  | "version_unavailable"
  | "asset_not_ready"
  | "forbidden"
  | "sticker_not_found"
  | "unauthenticated"
  | "unknown";

export type SetCurrentVersionResult = {
  status: SetCurrentVersionStatus;
  /** Server-supplied detail, when present. Never rendered raw as a headline. */
  message: string | null;
  /** Raw payload, kept for diagnostics only. */
  raw: unknown;
};

const KNOWN_STATUSES = new Set<SetCurrentVersionStatus>([
  "switched",
  "unchanged",
  "telegram_required",
  "active_generation",
  "version_unavailable",
  "asset_not_ready",
  "forbidden",
  "sticker_not_found",
  "unauthenticated",
]);

function normalizeStatus(value: unknown): SetCurrentVersionStatus {
  const s = typeof value === "string" ? value.trim().toLowerCase() : "";
  return KNOWN_STATUSES.has(s as SetCurrentVersionStatus)
    ? (s as SetCurrentVersionStatus)
    : "unknown";
}

/**
 * Asks the server to make an existing history row the current sticker image.
 * Read-only history loading above is unaffected. This performs no write of its
 * own — the RPC is the single authority.
 */
export async function setCurrentStickerVersion(params: {
  stickerId: string;
  versionId: string;
}): Promise<SetCurrentVersionResult> {
  const { data, error } = await supabase.rpc("set_sticker_current_version", {
    _sticker_id: params.stickerId,
    _version_id: params.versionId,
  });
  if (error) throw error;

  const payload = (data ?? null) as { status?: unknown; message?: unknown } | null;
  const message =
    payload && typeof payload.message === "string" && payload.message.trim()
      ? payload.message.trim()
      : null;
  return { status: normalizeStatus(payload?.status), message, raw: data };
}


/* ------------------------------------------------------------------ */
/* Read-only summary count                                             */
/* ------------------------------------------------------------------ */

/**
 * Counts preserved history rows for the supplied sticker ids without
 * loading assets or signed URLs. Read-only; used for orientation summaries.
 */
export async function countStickerVersions(stickerIds: string[]): Promise<number> {
  const unique = Array.from(new Set(stickerIds.filter(Boolean)));
  if (unique.length === 0) return 0;
  const { count, error } = await supabase
    .from("sticker_versions")
    .select("id", { count: "exact", head: true })
    .in("sticker_id", unique);
  if (error) throw error;
  return count ?? 0;
}
