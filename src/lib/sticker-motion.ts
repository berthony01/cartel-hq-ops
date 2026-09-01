import { supabase } from "@/integrations/supabase/client";
import { signedUrlMap } from "@/lib/media";

/**
 * Read-only motion (animated sticker) state.
 *
 * This module NEVER inserts, updates or deletes anything, never calls an RPC,
 * an Edge Function or a provider, and never touches Telegram, `ai_jobs` or
 * storage objects. It only performs SELECTs plus short-lived signed URLs for
 * private preview playback. `stickers.image_asset_id` remains the authoritative
 * Static Current; `sticker_versions` remains static-only history.
 */

export type MotionMode = "quick" | "ai" | "custom";
export type ReleaseVariant = "static" | "motion";

/** Preview links are short-lived on purpose — private bucket, no caching. */
const MOTION_URL_TTL = 600;

export type StickerMotionVersion = {
  id: string;
  stickerId: string;
  sourceStaticVersionId: string | null;
  sourceStaticAssetId: string | null;
  motionAssetId: string | null;
  telegramAssetId: string | null;
  versionNumber: number;
  motionMode: MotionMode | null;
  motionPreset: string | null;
  motionInstruction: string | null;
  createdAt: string;
  /** Short-lived signed playback URL, or null when no preview is available. */
  previewUrl: string | null;
  mimeType: string | null;
  fileSizeBytes: number | null;
};

export type StickerMotionState = {
  /** Durable pointer from `stickers.current_motion_version_id`. */
  currentMotionVersionId: string | null;
  /** Durable `stickers.release_variant`. */
  releaseVariant: ReleaseVariant;
  /** Durable `stickers.image_asset_id` — the authoritative Static Current. */
  currentStaticAssetId: string | null;
  /** Durable `stickers.telegram_motion_version_id` — the motion version currently released. */
  releasedMotionVersionId: string | null;

  /** Newest motion version first. */
  versions: StickerMotionVersion[];
};

export type StickerMotionStateBySticker = Record<string, StickerMotionState>;

const asReleaseVariant = (value: string | null): ReleaseVariant =>
  value === "motion" ? "motion" : "static";

const asMotionMode = (value: string | null): MotionMode | null =>
  value === "quick" || value === "ai" || value === "custom" ? value : null;

/**
 * Loads durable motion state for the supplied saved sticker ids, enriched with
 * short-lived previews. Plain SELECTs against RLS-protected tables plus signed
 * URLs — no writes of any kind.
 */
export async function loadStickerMotionState(
  stickerIds: string[],
): Promise<StickerMotionStateBySticker> {
  const ids = Array.from(new Set(stickerIds.filter(Boolean)));
  const out: StickerMotionStateBySticker = {};
  if (ids.length === 0) return out;

  const { data: stickerRows, error: stickerError } = await supabase
    .from("stickers")
    .select("id,current_motion_version_id,release_variant,image_asset_id,telegram_motion_version_id")
    .in("id", ids);
  if (stickerError) throw stickerError;

  for (const row of stickerRows ?? []) {
    out[row.id] = {
      currentMotionVersionId: row.current_motion_version_id ?? null,
      releaseVariant: asReleaseVariant(row.release_variant ?? null),
      currentStaticAssetId: row.image_asset_id ?? null,
      releasedMotionVersionId: row.telegram_motion_version_id ?? null,
      versions: [],
    };
  }


  const { data: motionRows, error: motionError } = await supabase
    .from("sticker_motion_versions")
    .select(
      "id,sticker_id,source_static_version_id,source_static_asset_id,motion_asset_id,telegram_asset_id,version_number,motion_mode,motion_preset,motion_instruction,created_at",
    )
    .in("sticker_id", ids)
    .order("version_number", { ascending: false });
  if (motionError) throw motionError;

  const rows = motionRows ?? [];

  /* Only a real `generated_motion` asset may be presented as a preview. A
     missing or wrongly typed asset degrades to "preview unavailable". */
  type AssetInfo = { storagePath: string; mimeType: string | null; fileSizeBytes: number | null };
  const assetById: Record<string, AssetInfo> = {};
  const assetIds = Array.from(
    new Set(rows.map((r) => r.motion_asset_id).filter((v): v is string => !!v)),
  );
  if (assetIds.length > 0) {
    const { data: assets, error: assetError } = await supabase
      .from("media_assets")
      .select("id,storage_path,mime_type,file_size_bytes,asset_type")
      .in("id", assetIds);
    if (assetError) throw assetError;
    for (const asset of assets ?? []) {
      if (asset.asset_type !== "generated_motion") continue;
      assetById[asset.id] = {
        storagePath: asset.storage_path,
        mimeType: asset.mime_type ?? null,
        fileSizeBytes: asset.file_size_bytes ?? null,
      };
    }
  }

  const paths = Object.values(assetById).map((a) => a.storagePath);
  let urls: Record<string, string> = {};
  if (paths.length > 0) {
    try {
      urls = await signedUrlMap(paths, MOTION_URL_TTL);
    } catch {
      // A signing failure must never hide durable motion history.
      urls = {};
    }
  }

  for (const row of rows) {
    const bucket = out[row.sticker_id];
    if (!bucket) continue;
    const asset = row.motion_asset_id ? assetById[row.motion_asset_id] : undefined;
    bucket.versions.push({
      id: row.id,
      stickerId: row.sticker_id,
      sourceStaticVersionId: row.source_static_version_id ?? null,
      sourceStaticAssetId: row.source_static_asset_id ?? null,
      motionAssetId: row.motion_asset_id ?? null,
      telegramAssetId: row.telegram_asset_id ?? null,
      versionNumber: row.version_number,
      motionMode: asMotionMode(row.motion_mode ?? null),
      motionPreset: row.motion_preset ?? null,
      motionInstruction: row.motion_instruction ?? null,
      createdAt: row.created_at,
      previewUrl: asset ? (urls[asset.storagePath] ?? null) : null,
      mimeType: asset?.mimeType ?? null,
      fileSizeBytes: asset?.fileSizeBytes ?? null,
    });
  }

  return out;
}

/**
 * The motion version the durable pointer refers to, or null when there is no
 * pointer or the referenced row was not loaded. Never guesses a "latest".
 */
export function currentMotionVersion(
  state: StickerMotionState | undefined,
): StickerMotionVersion | null {
  if (!state?.currentMotionVersionId) return null;
  return state.versions.find((v) => v.id === state.currentMotionVersionId) ?? null;
}

/**
 * True only when this motion take was generated from the exact static asset the
 * sticker currently uses. Anything else is an earlier-static take and can never
 * be approved as Current Motion.
 */
export function sourceIsCurrentStatic(
  version: StickerMotionVersion,
  currentStaticAssetId: string | null | undefined,
): boolean {
  return (
    !!version.sourceStaticAssetId &&
    !!currentStaticAssetId &&
    version.sourceStaticAssetId === currentStaticAssetId
  );
}


/** The three future motion creation modes, described factually. */
export const MOTION_MODE_CHOICES: ReadonlyArray<{
  mode: MotionMode;
  title: string;
  description: string;
}> = [
  {
    mode: "quick",
    title: "Quick Motion",
    description: "Presets such as blink, nod, eye glow or money rain.",
  },
  {
    mode: "ai",
    title: "AI Motion",
    description: "CARTEL HQ proposes motion from the concept and Blueprint.",
  },
  {
    mode: "custom",
    title: "Custom Motion",
    description: "You write the motion instruction yourself.",
  },
];

export const MOTION_UNAVAILABLE_NOTE = "Motion generation is not connected yet.";

export const MOTION_SAFETY_NOTE =
  "Your static sticker remains the source of truth until you explicitly approve a motion version.";
