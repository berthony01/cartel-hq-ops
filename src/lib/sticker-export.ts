import { zipSync } from "fflate";

/**
 * Client-side export helpers for finished stickers.
 * Read-only: fetches existing private signed URLs and saves files locally.
 * Never writes to Supabase tables or storage.
 */

export function slugify(value: string, fallback = "pack"): string {
  const slug = value
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 48);
  return slug || fallback;
}

/** Deterministic per-sticker filename: {pack-slug}-{NN}-{label}.png */
export function stickerFileName(packName: string, index: number, label: string): string {
  const nn = String(index + 1).padStart(2, "0");
  return `${slugify(packName)}-${nn}-${slugify(label, "sticker")}.png`;
}

export function packZipName(packName: string): string {
  return `${slugify(packName)}-stickers.zip`;
}

function saveBlob(blob: Blob, filename: string) {
  const href = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = href;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  // Give the browser a tick to start the download before revoking.
  setTimeout(() => URL.revokeObjectURL(href), 10_000);
}

async function fetchBytes(url: string): Promise<Uint8Array> {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Could not download the sticker image (${res.status}).`);
  return new Uint8Array(await res.arrayBuffer());
}

export type AlphaCheck = { ok: boolean; reason?: string };

/** True when the PNG header declares an alpha-capable colour type (4 or 6) or a tRNS chunk. */
function pngDeclaresAlpha(bytes: Uint8Array): boolean {
  if (bytes.length < 26) return false;
  const sig = [137, 80, 78, 71, 13, 10, 26, 10];
  for (let i = 0; i < sig.length; i += 1) if (bytes[i] !== sig[i]) return false;
  const colorType = bytes[25];
  if (colorType === 4 || colorType === 6) return true;
  // Scan a bounded window for a tRNS chunk (palette transparency).
  const window = bytes.subarray(0, Math.min(bytes.length, 4096));
  for (let i = 0; i < window.length - 3; i += 1) {
    if (window[i] === 0x74 && window[i + 1] === 0x52 && window[i + 2] === 0x4e && window[i + 3] === 0x53) {
      return true;
    }
  }
  return false;
}

/**
 * Secondary, client-side transparency guard. Decodes the fetched PNG and looks for at
 * least one non-opaque pixel. Never modifies or re-encodes the image.
 * The backend media_assets.transparency_valid remains authoritative.
 */
export async function verifyAlpha(bytes: Uint8Array): Promise<AlphaCheck> {
  if (!pngDeclaresAlpha(bytes)) {
    return { ok: false, reason: "the PNG has no alpha channel" };
  }
  if (typeof document === "undefined" || typeof createImageBitmap !== "function") {
    return { ok: false, reason: "this browser cannot verify transparency" };
  }
  let bitmap: ImageBitmap;
  try {
    bitmap = await createImageBitmap(new Blob([bytes as BlobPart], { type: "image/png" }));
  } catch {
    return { ok: false, reason: "the image could not be decoded for verification" };
  }
  try {
    const canvas = document.createElement("canvas");
    canvas.width = bitmap.width;
    canvas.height = bitmap.height;
    const ctx = canvas.getContext("2d", { willReadFrequently: true });
    if (!ctx) return { ok: false, reason: "this browser cannot verify transparency" };
    ctx.drawImage(bitmap, 0, 0);
    const { data } = ctx.getImageData(0, 0, canvas.width, canvas.height);
    for (let i = 3; i < data.length; i += 4) {
      if ((data[i] ?? 255) < 255) return { ok: true };
    }
    return { ok: false, reason: "every pixel is fully opaque" };
  } catch {
    return { ok: false, reason: "transparency could not be checked in this browser" };
  } finally {
    bitmap.close?.();
  }
}

/**
 * Downloads one already-generated sticker PNG after verifying real alpha.
 * The original bytes are saved unchanged.
 */
export async function downloadStickerPng(url: string, filename: string): Promise<void> {
  const bytes = await fetchBytes(url);
  const check = await verifyAlpha(bytes);
  if (!check.ok) {
    throw new Error(
      `Transparency check failed for ${filename} — ${check.reason}. The file was not saved. Regenerate this sticker, then try again.`,
    );
  }
  saveBlob(new Blob([bytes as BlobPart], { type: "image/png" }), filename);
}

export type ZipEntry = { filename: string; url: string; label: string };
export type ZipResult = { exported: number; omitted: { label: string; reason: string }[] };

/**
 * Builds and saves a ZIP of the supplied stickers, entirely in the browser.
 * Each PNG is alpha-verified first; failures are omitted rather than aborting the export.
 */
export async function downloadStickersZip(
  entries: ZipEntry[],
  zipName: string,
): Promise<ZipResult> {
  if (entries.length === 0) throw new Error("There are no ready stickers to export yet.");
  const files: Record<string, Uint8Array> = {};
  const omitted: { label: string; reason: string }[] = [];
  for (const entry of entries) {
    try {
      // eslint-disable-next-line no-await-in-loop
      const bytes = await fetchBytes(entry.url);
      // eslint-disable-next-line no-await-in-loop
      const check = await verifyAlpha(bytes);
      if (!check.ok) {
        omitted.push({ label: entry.label, reason: check.reason ?? "transparency check failed" });
        continue;
      }
      files[entry.filename] = bytes;
    } catch (err) {
      omitted.push({
        label: entry.label,
        reason: err instanceof Error ? err.message : "download failed",
      });
    }
  }
  const exported = Object.keys(files).length;
  if (exported === 0) {
    throw new Error(
      "No sticker passed the transparency check, so no ZIP was created. Regenerate the affected stickers and try again.",
    );
  }
  const zipped = zipSync(files, { level: 6 });
  saveBlob(new Blob([zipped as BlobPart], { type: "application/zip" }), zipName);
  return { exported, omitted };
}

