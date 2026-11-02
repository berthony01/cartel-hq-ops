/**
 * S2 isolated WebAssembly encoder test. Run in a clean dev environment:
 *
 *   deno run --allow-read scripts/sticker-s2-magick-wasm-smoke.ts
 *
 * No Supabase, secrets, Storage, paid AI, external input, or filesystem writes.
 * A PASS here verifies Deno + magick-wasm v0.0.36 locally ONLY.
 * Hosted Supabase Edge, real storage/tenant handling and 1024px originals
 * still need their own isolated staging verification.
 */
import {
  ImageMagick, initializeImageMagick, MagickFormat,
} from "npm:@imagemagick/magick-wasm@0.0.36";

const fixtureBase64 =
  "iVBORw0KGgoAAAANSUhEUgAAABAAAAAQCAYAAAAf8/9hAAAALElEQVR42mNgGPKAEZljVrHqBAcDgzkHA8NJfHRTRxhcHxOlLhg1YNSAYQIAilAIFO5wjPsAAAAASUVORK5CYII=";
// 16x16 synthetic RGBA pattern; known alpha extrema [0,255].
const fixture = Uint8Array.from(atob(fixtureBase64), char => char.charCodeAt(0));
const wasmPath = new URL(
  "magick.wasm",
  import.meta.resolve("npm:@imagemagick/magick-wasm@0.0.36"),
);
await initializeImageMagick(await Deno.readFile(wasmPath));

let sourcePng: Uint8Array | null = null;
ImageMagick.read(fixture, image => {
  image.resize(1024, 1024);
  image.write(MagickFormat.Png, data => { sourcePng = Uint8Array.from(data); });
});
if (!sourcePng) throw new Error("Synthetic input PNG conversion failed.");
let thumb: Uint8Array | null = null;
let tw = 0, th = 0, sourceAlpha = false;
const started = performance.now();
ImageMagick.read(sourcePng, image => {
  sourceAlpha = image.hasAlpha === true && image.isOpaque === false;
  image.resize(256, 256);
  image.quality = 76;
  tw = image.width; th = image.height;
  if (sourceAlpha) image.write(MagickFormat.WebP, bytes => { thumb = Uint8Array.from(bytes); });
});
if (!thumb) throw new Error("WebP encoder missing or alpha was lost before encoding.");
const prefix = new TextDecoder().decode(thumb.subarray(0, 4));
const magic = new TextDecoder().decode(thumb.subarray(8, 12));
let alpha = false, width = 0, height = 0;
ImageMagick.read(thumb, image => {
  width = image.width; height = image.height;
  alpha = image.hasAlpha === true && image.isOpaque === false;
});
if (prefix !== "RIFF" || magic !== "WEBP" || tw !== 256 || th !== 256 ||
    width !== 256 || height !== 256 || !alpha || thumb.length > 250_000) {
  throw new Error("WebP encoding, 256px dimensions, alpha, or file-size validation failed.");
}
console.log(JSON.stringify({
  test: "S2_LOCAL_MAGICK_WASM_CODEC", pass: true,
  sourcePngBytes: sourcePng.length, thumbnailWebpBytes: thumb.length,
  width, height, transparencyPreserved: alpha,
  elapsedMs: Math.round(performance.now()-started),
}));
