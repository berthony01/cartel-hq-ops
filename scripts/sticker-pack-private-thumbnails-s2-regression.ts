/**
 * S2 — regression contract for nonpublic, immutable, per-sticker thumbnails.
 * Run: bun scripts/sticker-pack-private-thumbnails-s2-regression.ts
 * Pure TS checks + source invariants; does NOT replace WASM, browser, RLS, or build QA.
 */
import { readFileSync } from "node:fs";
import {
  STICKER_THUMBNAIL_MAX_BYTES,
  chooseStickerPackImagePaths, expectedStickerThumbnailPath,
} from "../src/lib/sticker-thumbnails";

let passed = 0, failed = 0;
function check(label: string, ok: boolean) {
  if (ok) passed++; else { failed++; console.error("FAIL", label); }
}
const workspace = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const other = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const uuid = "11111111-1111-4111-8111-111111111111";
const original = `${workspace}/generated_sticker/${uuid}.png`;
const thumb = `${workspace}/generated_sticker_thumbnails/${uuid}.webp`;
const validMeta = {
  thumbnail: { version: 1, path: thumb, source_path: original,
    mime_type: "image/webp", width: 256, height: 256, file_size_bytes: 55_000 },
};
const fallback = (meta: unknown) => chooseStickerPackImagePaths(original, meta);
check("deterministic safe path", expectedStickerThumbnailPath(original) === thumb);
check("candidate path compatible", expectedStickerThumbnailPath(`${workspace}/generated_sticker/candidate-${uuid}.png`) === `${workspace}/generated_sticker_thumbnails/candidate-${uuid}.webp`);
check("variation path compatible", expectedStickerThumbnailPath(`${workspace}/generated_sticker/variation-${uuid}.png`) === `${workspace}/generated_sticker_thumbnails/variation-${uuid}.webp`);
check("reject path traversal", expectedStickerThumbnailPath(`${workspace}/generated_sticker/../../secret.png`) === null);
check("reject foreign folder", expectedStickerThumbnailPath(`${workspace}/reference/${uuid}.png`) === null);
check("reject unsupported originals", expectedStickerThumbnailPath(`${workspace}/generated_sticker/${uuid}.jpg`) === null);
check("reject prefix manipulation", expectedStickerThumbnailPath(`${other}/generated_sticker/${uuid}.png/child`) === null);
check("no metadata falls back", !fallback(null).usingThumbnail && fallback(null).displayPath === original);
check("valid metadata selects private thumbnail", fallback(validMeta).usingThumbnail && fallback(validMeta).displayPath === thumb);
check("original path retained for fallback", fallback(validMeta).originalPath === original);
check("invalid version falls back", !fallback({thumbnail:{...validMeta.thumbnail,version:2}}).usingThumbnail);
check("foreign thumbnail path rejected", !fallback({thumbnail:{...validMeta.thumbnail,path:`${other}/generated_sticker_thumbnails/${uuid}.webp`}}).usingThumbnail);
check("wrong source rejected", !fallback({thumbnail:{...validMeta.thumbnail,source_path:`${other}/generated_sticker/${uuid}.png`}}).usingThumbnail);
check("public URL rejected", !fallback({thumbnail:{...validMeta.thumbnail,path:"https://example.org/x.webp"}}).usingThumbnail);
check("wrong MIME rejected", !fallback({thumbnail:{...validMeta.thumbnail,mime_type:"image/png"}}).usingThumbnail);
check("width oversized rejected", !fallback({thumbnail:{...validMeta.thumbnail,width:1024}}).usingThumbnail);
check("zero height rejected", !fallback({thumbnail:{...validMeta.thumbnail,height:0}}).usingThumbnail);
check("byte cap enforced", !fallback({thumbnail:{...validMeta.thumbnail,file_size_bytes:STICKER_THUMBNAIL_MAX_BYTES+1}}).usingThumbnail);
check("malformed metadata rejects", !fallback({thumbnail:[]}).usingThumbnail);
check("unexpected string metadata rejects", !fallback("foo").usingThumbnail);
const page = readFileSync("src/routes/_authenticated/sticker-lab.$packId.tsx","utf8");
const packs = readFileSync("src/lib/sticker-packs.ts","utf8");
const producer = readFileSync("backend-source/edge-functions/sticker-ai/index.ts","utf8");
check("gallery uses vetted thumbnail selector", page.includes("chooseStickerPackImagePaths(asset.storage_path, asset.metadata)"));
check("pack queries keyed per workspace", page.includes('queryKey: ["pack-manager", workspaceId, packId]'));
check("only signs when same workspace", page.includes("if (!sameWorkspace) return;"));
check("gallery signed URL TTL preserved", page.includes("signedUrlMap(paths, 300)"));
check("fallback images stay private", page.includes("fallbackUrl={originalUrl}"));
check("broken derived GET recovers original", page.includes("onError={() => {") && page.includes("setUseOriginal(true)"));
check("gallery images are lazy", page.includes('loading="lazy"'));
check("only metadata query changed", packs.includes('select("id,storage_path,transparency_valid,width,height,metadata")'));
check("PNG original upload preserved", producer.includes('upload(path, finalPng, { contentType: "image/png", upsert: false })'));
check("reuses existing ImageMagick, no provider", producer.includes("ImageMagick.read(finalPng, (image) => {") && producer.includes("MagickFormat.WebP"));
check("private deterministic thumbnail directory", producer.includes("generated_sticker_thumbnails/"));
check("thumbnail upload immutable", producer.includes('cacheControl: "3600"') && producer.includes("upsert: false"));
check("thumbnail metadata carries original linkage", producer.includes("source_path: path") && producer.includes("file_size_bytes: webp.byteLength"));
check("failed metadata writes clean derivative", producer.includes("if (metadataError)") && producer.includes("remove([thumbnailPath])"));
check("thumb errors do not block sticker finalization", producer.includes("Thumbnail work is best effort"));
check("no new API route exposed", !page.includes("https://api.kie.ai") && !page.includes("service_role"));
check("not public unsigned storage", !page.includes("getPublicUrl("));
check("no persistent signed URLs added", !/localStorage\.setItem\([^)]*signed|sessionStorage\.setItem\([^)]*signed/.test(page));
console.log(`S2 thumbnail pure/source QA: ${passed} PASS, ${failed} FAIL — full build, WebP WASM, real browser and Storage QA pending`);
if (failed) process.exitCode = 1;
