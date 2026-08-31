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

export type StickerVersionOrigin = "generation" | "backfill" | string;

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
