/**
 * S2 legacy sticker thumbnail backfill — PURE, read-only planning.
 *
 * There are NO Supabase SDK calls, network requests, file reads, or writes here.
 * An independently approved server-side execution procedure must validate
 * owner authorization, workspace scope and inventory before any mutations.
 */
import {
  chooseStickerPackImagePaths,
  expectedStickerThumbnailPath,
} from "./sticker-thumbnails";

export type ExistingStickerAsset = {
  id: string;
  workspace_id: string;
  asset_type: string;
  storage_path: string;
  mime_type: string | null;
  file_size_bytes: number | null;
  metadata: unknown;
};

export type PlannedStickerThumbnail = {
  assetId: string;
  sourcePath: string;
  targetPath: string;
  sourceBytes: number;
};

export type StickerBackfillPlan = {
  workspaceId: string;
  inventoryCount: number;
  previouslyCompleted: number;
  toCreateCount: number;
  originalTotalBytes: number;
  // Never log these paths: they identify private customer Storage objects.
  planned: PlannedStickerThumbnail[];
};

const UUID = /^[a-f\d]{8}-[a-f\d]{4}-[a-f\d]{4}-[a-f\d]{4}-[a-f\d]{12}$/i;
const MAX_ORIGINAL_BYTES = 25 * 1024 * 1024;

/**
 * Fail CLOSED on unexpected rows, partial inventory, unexpected thumbnail
 * metadata, duplicate paths, or a workspace other than the explicitly named
 * workspace. No project ID, owner identity, auth or permissions are inferred
 * from the inventory: those must be independently checked at execution time.
 */
export function planLegacyStickerThumbnailBackfill(
  assets: readonly ExistingStickerAsset[],
  options: { workspaceId: string; expectedCount: number; maxCount: number },
): StickerBackfillPlan {
  const { workspaceId, expectedCount, maxCount } = options;
  if (!UUID.test(workspaceId)) throw new Error("INVALID_WORKSPACE");
  if (!Number.isSafeInteger(expectedCount) || expectedCount < 1 ||
      !Number.isSafeInteger(maxCount) || maxCount < 1 ||
      expectedCount > maxCount || maxCount > 12) {
    throw new Error("INVALID_LIMITS");
  }
  if (assets.length !== expectedCount || assets.length > maxCount) {
    throw new Error("INVENTORY_COUNT_MISMATCH");
  }

  const seenAssets = new Set<string>();
  const seenPaths = new Set<string>();
  const planned: PlannedStickerThumbnail[] = [];
  let previouslyCompleted = 0;
  let originalTotalBytes = 0;
  for (const asset of assets) {
    if (!UUID.test(asset.id) || seenAssets.has(asset.id)) {
      throw new Error("INVALID_OR_DUPLICATE_ASSET");
    }
    if (asset.workspace_id !== workspaceId) throw new Error("WRONG_WORKSPACE");
    if (asset.asset_type !== "generated_sticker" || asset.mime_type !== "image/png") {
      throw new Error("UNSUPPORTED_ASSET");
    }
    if (!Number.isSafeInteger(asset.file_size_bytes) ||
        !(Number(asset.file_size_bytes) > 0 && Number(asset.file_size_bytes) <= MAX_ORIGINAL_BYTES)) {
      throw new Error("INVALID_FILE_SIZE");
    }
    const thumbnailPath = expectedStickerThumbnailPath(asset.storage_path);
    if (!thumbnailPath || !thumbnailPath.startsWith(`${workspaceId}/`) ||
        seenPaths.has(asset.storage_path) || seenPaths.has(thumbnailPath)) {
      throw new Error("INVALID_OR_DUPLICATE_PATH");
    }
    seenAssets.add(asset.id);
    seenPaths.add(asset.storage_path);
    seenPaths.add(thumbnailPath);
    originalTotalBytes += Number(asset.file_size_bytes);

    const metadata = asset.metadata;
    const thumb = metadata && typeof metadata === "object" && !Array.isArray(metadata)
      ? (metadata as Record<string, unknown>)["thumbnail"]
      : undefined;
    const choice = chooseStickerPackImagePaths(asset.storage_path, metadata);
    if (thumb !== undefined && !choice.usingThumbnail) {
      // Invalid or stale pointers require manual reconciliation, not overwrite.
      throw new Error("UNRECONCILED_THUMBNAIL_METADATA");
    }
    if (choice.usingThumbnail) {
      previouslyCompleted++;
      continue;
    }
    planned.push({
      assetId: asset.id,
      sourcePath: asset.storage_path,
      targetPath: thumbnailPath,
      sourceBytes: Number(asset.file_size_bytes),
    });
  }

  return {
    workspaceId, inventoryCount: assets.length, previouslyCompleted,
    toCreateCount: planned.length, originalTotalBytes, planned,
  };
}

/** Safe summary — deliberately omits customer IDs and Storage object paths. */
export function summarizeStickerBackfillPlan(plan: StickerBackfillPlan) {
  return {
    inventoryCount: plan.inventoryCount,
    previouslyCompleted: plan.previouslyCompleted,
    toCreateCount: plan.toCreateCount,
    originalTotalBytes: plan.originalTotalBytes,
  };
}
