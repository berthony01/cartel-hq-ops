/**
 * S2: strict, pure metadata selector for PRIVATE pre-generated sticker previews.
 * Never constructs or exports a public URL. Every link is still signed with
 * the current Supabase session's workspace-scoped Storage SELECT permission.
 *
 * Original PNG paths are immutable. Thumbnails are a separate stored object,
 * never a transformation request (Storage transformations require Pro).
 */
export const STICKER_THUMBNAIL_VERSION = 1;
export const STICKER_THUMBNAIL_EDGE = 256;
export const STICKER_THUMBNAIL_MAX_BYTES = 250_000;

export type StickerThumbnailChoice = {
  originalPath: string;
  displayPath: string;
  usingThumbnail: boolean;
};

const ORIGINAL_PATH = /^([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})\/generated_sticker\/([a-z0-9-]{1,110})\.png$/i;

/** Derived from an immutable original; no user-controlled folder traversal. */
export function expectedStickerThumbnailPath(originalPath: string): string | null {
  const matched = ORIGINAL_PATH.exec(originalPath);
  if (!matched) return null;
  return `${matched[1]}/generated_sticker_thumbnails/${matched[2]}.webp`;
}

function record(input: unknown): Record<string, unknown> | null {
  return !!input && typeof input === "object" && !Array.isArray(input)
    ? input as Record<string, unknown>
    : null;
}

/** Fail closed to authorized originals when metadata is missing or malformed. */
export function chooseStickerPackImagePaths(
  originalPath: string,
  rawMetadata: unknown,
): StickerThumbnailChoice {
  const fallback = { originalPath, displayPath: originalPath, usingThumbnail: false };
  const expected = expectedStickerThumbnailPath(originalPath);
  const metadata = record(rawMetadata);
  const thumb = record(metadata?.thumbnail);
  if (
    !expected || !thumb ||
    thumb.version !== STICKER_THUMBNAIL_VERSION ||
    thumb.path !== expected ||
    thumb.source_path !== originalPath ||
    thumb.mime_type !== "image/webp" ||
    !Number.isInteger(thumb.width) || !(Number(thumb.width) > 0 && Number(thumb.width) <= STICKER_THUMBNAIL_EDGE) ||
    !Number.isInteger(thumb.height) || !(Number(thumb.height) > 0 && Number(thumb.height) <= STICKER_THUMBNAIL_EDGE) ||
    !Number.isInteger(thumb.file_size_bytes) ||
    !(Number(thumb.file_size_bytes) > 0 && Number(thumb.file_size_bytes) <= STICKER_THUMBNAIL_MAX_BYTES)
  ) return fallback;
  return { originalPath, displayPath: expected, usingThumbnail: true };
}
