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
 * Read-only convenience wrapper: fetches an existing signed PNG URL and runs the
 * same client-side alpha verification used before export. Never writes anything.
 */
export async function verifyAlphaAtUrl(url: string): Promise<AlphaCheck> {
  try {
    const bytes = await fetchBytes(url);
    return await verifyAlpha(bytes);
  } catch (err) {
    return { ok: false, reason: err instanceof Error ? err.message : "the image could not be fetched" };
  }
}

/* ------------------------------------------------------------------ *
 * Telegram cutout preparation (in-memory only)
 * ------------------------------------------------------------------ */

/** Light-neutral family: white / cream / very light grey. */
const HALO_MIN_CHANNEL = 200;
/** Maximum channel spread allowed for a "neutral" light pixel. */
const HALO_MAX_SPREAD = 90;
/** Pixels at or below this alpha count as the transparent outside. */
const OUTSIDE_ALPHA = 24;
/** Safety guard: never auto-remove more than this share of the canvas. */
const MAX_REMOVED_RATIO = 0.15;

export type CutoutResult = {
  ok: boolean;
  /** True when the source PNG already had a real alpha channel. */
  alphaOk: boolean;
  cleaned: boolean;
  bytes?: Uint8Array;
  removedPixels: number;
  removedRatio: number;
  reason?: string;
};

async function decodeToImageData(bytes: Uint8Array): Promise<ImageData> {
  if (typeof document === "undefined" || typeof createImageBitmap !== "function") {
    throw new Error("this browser cannot analyse the image");
  }
  const bitmap = await createImageBitmap(new Blob([bytes as BlobPart], { type: "image/png" }));
  try {
    const canvas = document.createElement("canvas");
    canvas.width = bitmap.width;
    canvas.height = bitmap.height;
    const ctx = canvas.getContext("2d", { willReadFrequently: true });
    if (!ctx) throw new Error("this browser cannot analyse the image");
    ctx.drawImage(bitmap, 0, 0);
    return ctx.getImageData(0, 0, canvas.width, canvas.height);
  } finally {
    bitmap.close?.();
  }
}

async function encodePng(data: ImageData): Promise<Uint8Array> {
  const canvas = document.createElement("canvas");
  canvas.width = data.width;
  canvas.height = data.height;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("this browser cannot re-encode the image");
  ctx.putImageData(data, 0, 0);
  const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, "image/png"));
  if (!blob) throw new Error("the cleaned image could not be encoded");
  return new Uint8Array(await blob.arrayBuffer());
}

/**
 * Deterministic, in-memory "Telegram cutout" preparation.
 *
 * Finds only the OUTER light halo — light-neutral pixels that are connected,
 * through other light-neutral pixels, to the truly transparent outside — and
 * makes them transparent. Interior whites (shirts, teeth, eyes, highlights,
 * lettering interiors) are never touched because they are not reachable from
 * the transparent edge through the candidate mask.
 *
 * Nothing is uploaded and the stored original is never modified.
 */
export async function prepareTelegramCutout(bytes: Uint8Array): Promise<CutoutResult> {
  const base = await verifyAlpha(bytes);
  if (!base.ok) {
    return {
      ok: false,
      alphaOk: false,
      cleaned: false,
      removedPixels: 0,
      removedRatio: 0,
      reason: base.reason,
    };
  }

  let img: ImageData;
  try {
    img = await decodeToImageData(bytes);
  } catch (err) {
    return {
      ok: false,
      alphaOk: true,
      cleaned: false,
      removedPixels: 0,
      removedRatio: 0,
      reason: err instanceof Error ? err.message : "the image could not be analysed",
    };
  }

  const { width: w, height: h, data } = img;
  const total = w * h;
  const isCandidate = new Uint8Array(total);
  const isOutside = new Uint8Array(total);

  for (let p = 0; p < total; p += 1) {
    const i = p * 4;
    const a = data[i + 3] ?? 0;
    if (a <= OUTSIDE_ALPHA) {
      isOutside[p] = 1;
      continue;
    }
    const r = data[i] ?? 0;
    const g = data[i + 1] ?? 0;
    const b = data[i + 2] ?? 0;
    const min = Math.min(r, g, b);
    const max = Math.max(r, g, b);
    if (min >= HALO_MIN_CHANNEL && max - min <= HALO_MAX_SPREAD) isCandidate[p] = 1;
  }

  // Seed: candidate pixels 8-neighbour adjacent to the transparent outside.
  const visited = new Uint8Array(total);
  const stack: number[] = [];
  for (let y = 0; y < h; y += 1) {
    for (let x = 0; x < w; x += 1) {
      const p = y * w + x;
      if (!isCandidate[p]) continue;
      let touchesOutside = false;
      for (let dy = -1; dy <= 1 && !touchesOutside; dy += 1) {
        for (let dx = -1; dx <= 1; dx += 1) {
          if (dx === 0 && dy === 0) continue;
          const nx = x + dx;
          const ny = y + dy;
          if (nx < 0 || ny < 0 || nx >= w || ny >= h) {
            // Canvas border counts as the outside.
            touchesOutside = true;
            break;
          }
          if (isOutside[ny * w + nx]) {
            touchesOutside = true;
            break;
          }
        }
      }
      if (touchesOutside) {
        visited[p] = 1;
        stack.push(p);
      }
    }
  }

  // Flood fill through candidate pixels only.
  const removal: number[] = [];
  while (stack.length > 0) {
    const p = stack.pop() as number;
    removal.push(p);
    const x = p % w;
    const y = (p - x) / w;
    for (let dy = -1; dy <= 1; dy += 1) {
      for (let dx = -1; dx <= 1; dx += 1) {
        if (dx === 0 && dy === 0) continue;
        const nx = x + dx;
        const ny = y + dy;
        if (nx < 0 || ny < 0 || nx >= w || ny >= h) continue;
        const np = ny * w + nx;
        if (visited[np] || !isCandidate[np]) continue;
        visited[np] = 1;
        stack.push(np);
      }
    }
  }

  const removedPixels = removal.length;
  const removedRatio = total > 0 ? removedPixels / total : 0;

  if (removedPixels === 0) {
    return {
      ok: true,
      alphaOk: true,
      cleaned: false, bytes, removedPixels: 0, removedRatio: 0 };
  }

  if (removedRatio > MAX_REMOVED_RATIO) {
    return {
      ok: false,
      alphaOk: true,
      cleaned: false,
      removedPixels,
      removedRatio,
      reason: `the light halo covers ${(removedRatio * 100).toFixed(1)}% of the image, which is too much to remove safely — needs manual review or regeneration`,
    };
  }

  for (const p of removal) data[p * 4 + 3] = 0;

  let cleanedBytes: Uint8Array;
  try {
    cleanedBytes = await encodePng(img);
  } catch (err) {
    return {
      ok: false,
      alphaOk: true,
      cleaned: false,
      removedPixels,
      removedRatio,
      reason: err instanceof Error ? err.message : "the cleaned image could not be encoded",
    };
  }

  const recheck = await verifyAlpha(cleanedBytes);
  if (!recheck.ok) {
    return {
      ok: false,
      alphaOk: true,
      cleaned: false,
      removedPixels,
      removedRatio,
      reason: recheck.reason ?? "the cleaned image failed the transparency re-check",
    };
  }

  return {
      ok: true,
      alphaOk: true,
      cleaned: true, bytes: cleanedBytes, removedPixels, removedRatio };
}

/** Read-only: fetches a signed PNG URL and runs the cutout preparation on its bytes. */
export async function prepareTelegramCutoutAtUrl(url: string): Promise<CutoutResult> {
  try {
    const bytes = await fetchBytes(url);
    return await prepareTelegramCutout(bytes);
  } catch (err) {
    return {
      ok: false,
      alphaOk: false,
      cleaned: false,
      removedPixels: 0,
      removedRatio: 0,
      reason: err instanceof Error ? err.message : "the image could not be fetched",
    };
  }
}

export type DownloadResult = { cleaned: boolean; removedPixels: number };

/**
 * Downloads one sticker PNG after alpha verification AND Telegram-cutout preparation.
 * The saved bytes are the cleaned bytes when an outer halo was removed.
 */
export async function downloadStickerPng(url: string, filename: string): Promise<DownloadResult> {
  const bytes = await fetchBytes(url);
  const prepared = await prepareTelegramCutout(bytes);
  if (!prepared.ok || !prepared.bytes) {
    throw new Error(
      `Telegram cutout check failed for ${filename} — ${prepared.reason ?? "unknown reason"}. The file was not saved.`,
    );
  }
  saveBlob(new Blob([prepared.bytes as BlobPart], { type: "image/png" }), filename);
  return { cleaned: prepared.cleaned, removedPixels: prepared.removedPixels };
}

export type ZipEntry = { filename: string; url: string; label: string };
export type ZipResult = {
  exported: number;
  cleanedCount: number;
  omitted: { label: string; reason: string }[];
};

/**
 * Builds and saves a ZIP of the supplied stickers, entirely in the browser.
 * Every entry goes through the same Telegram-cutout preparation; the ZIP holds
 * the cleaned bytes. Failures are omitted rather than aborting the export.
 */
export async function downloadStickersZip(
  entries: ZipEntry[],
  zipName: string,
): Promise<ZipResult> {
  if (entries.length === 0) throw new Error("There are no ready stickers to export yet.");
  const files: Record<string, Uint8Array> = {};
  const omitted: { label: string; reason: string }[] = [];
  let cleanedCount = 0;
  for (const entry of entries) {
    try {
      // eslint-disable-next-line no-await-in-loop
      const bytes = await fetchBytes(entry.url);
      // eslint-disable-next-line no-await-in-loop
      const prepared = await prepareTelegramCutout(bytes);
      if (!prepared.ok || !prepared.bytes) {
        omitted.push({
          label: entry.label,
          reason: prepared.reason ?? "Telegram cutout check failed",
        });
        continue;
      }
      if (prepared.cleaned) cleanedCount += 1;
      files[entry.filename] = prepared.bytes;
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
      "No sticker passed the Telegram cutout check, so no ZIP was created. Regenerate the affected stickers and try again.",
    );
  }
  const zipped = zipSync(files, { level: 6 });
  saveBlob(new Blob([zipped as BlobPart], { type: "application/zip" }), zipName);
  return { exported, cleanedCount, omitted };
}


