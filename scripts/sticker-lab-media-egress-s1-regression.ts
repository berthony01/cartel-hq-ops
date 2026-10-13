/**
 * Sticker Lab Media Egress S1 — SOURCE SAFETY assertions only.
 * Run: bun scripts/sticker-lab-media-egress-s1-regression.ts
 *
 * Do NOT interpret as proof of lower billed GB, correct browser behavior,
 * successful Vite build, or a production release.
 */
import { readFileSync } from "node:fs";

const studio = readFileSync("src/routes/_authenticated/sticker-lab.new.tsx", "utf8");
const packManager = readFileSync("src/routes/_authenticated/sticker-lab.$packId.tsx", "utf8");
const media = readFileSync("src/lib/media.ts", "utf8");
const jobRuntime = readFileSync("src/hooks/useStickerGenerationRuntime.ts", "utf8");

const images = Array.from(studio.matchAll(/<img\b[\s\S]*?\/>/g), (match) => match[0]);
let passed = 0;
let failed = 0;
function check(name: string, ok: boolean) {
  if (ok) passed++;
  else { failed++; console.error("FAIL:", name); }
}

check("exactly eleven existing Studio image elements", images.length === 11);
check("primary uploaded reference remains immediate", images[0]?.includes("src={previewUrl}") && !images[0].includes('loading="lazy"'));
check("ten secondary Studio images defer below-viewport loads", images.slice(1).length === 10 && images.slice(1).every((tag) => tag.includes('loading="lazy"')));
check("secondary image decoding asynchronous", images.slice(1).every((tag) => tag.includes('decoding="async"')));
check("all thumbnails have alt text", images.every((tag) => /\balt=/.test(tag)));
check("no fake srcset or transformed images", images.every((tag) => !/\bsrcSet=|\bsizes=/.test(tag)));
check("reference gallery images are lazy", images.some((tag) => tag.includes("src={url}") && tag.includes('loading="lazy"')));
check("version-history thumbnails are lazy", images.some((tag) => tag.includes("src={v.previewUrl}") && tag.includes('loading="lazy"')));
check("candidate image lazy", images.some((tag) => tag.includes("src={pendingCandidate.previewUrl}") && tag.includes('loading="lazy"')));
check("variation image lazy", images.some((tag) => tag.includes("src={take.version.previewUrl}") && tag.includes('loading="lazy"')));
check("review step previews lazy", images.some((tag) => tag.includes("Generated sticker ${c.label}") && tag.includes('loading="lazy"')));
check("pack manager already lazily loads sticker cards", packManager.includes('loading="lazy"'));
check("private signed URLs retained, not replaced with public links", media.includes(".createSignedUrl(path, expiresIn)") && media.includes(".createSignedUrls(paths, expiresIn)"));
check("no persistence of signed media tokens introduced", !/\bsessionStorage\b|\blocalStorage\b|\bindexedDB\b/.test(media));
check("studio still uses stored private assets", studio.includes("signedUrlMap(") && studio.includes("signedUrl("));
check("sticker generation remains explicit, not automatic", jobRuntime.includes("startStickerGeneration({"));
check("no change to sticker drops runtime in this S1 scope", !studio.includes("invoke_sticker_drop_scheduler") && !media.includes("invoke_sticker_drop_scheduler"));
check("no new service role key on frontend", !/SUPABASE_SERVICE_ROLE_KEY|service_role_key|supabase_service_key/.test(studio + media));
console.log(`Sticker media egress S1 source invariants: ${passed} PASS, ${failed} FAIL; browser/build/bandwidth not certified`);
if (failed) process.exitCode = 1;
