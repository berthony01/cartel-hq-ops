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

/** Downloads one already-generated sticker PNG from its signed URL. */
export async function downloadStickerPng(url: string, filename: string): Promise<void> {
  const bytes = await fetchBytes(url);
  saveBlob(new Blob([bytes as BlobPart], { type: "image/png" }), filename);
}

export type ZipEntry = { filename: string; url: string };

/** Builds and saves a ZIP of the supplied ready stickers, entirely in the browser. */
export async function downloadStickersZip(
  entries: ZipEntry[],
  zipName: string,
): Promise<number> {
  if (entries.length === 0) throw new Error("There are no ready stickers to export yet.");
  const files: Record<string, Uint8Array> = {};
  for (const entry of entries) {
    // eslint-disable-next-line no-await-in-loop
    files[entry.filename] = await fetchBytes(entry.url);
  }
  const zipped = zipSync(files, { level: 6 });
  saveBlob(new Blob([zipped as BlobPart], { type: "application/zip" }), zipName);
  return entries.length;
}
