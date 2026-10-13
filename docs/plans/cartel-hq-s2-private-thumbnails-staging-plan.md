# CARTEL HQ — S2 Private Sticker Thumbnail Optimization
**Status:** Draft-only candidate on independent branch based on `main`. **NOT MERGED / NOT DEPLOYED**. Date: 2026-10-13.

## Confirmed production baseline, supplied by owner through authenticated Claude/Chrome QA
- Published PEPECARTEL test pack: 12 ready PNGs, **14,597,494 total GET bytes** on first view, same ~14.6 MB after refresh.
- 12 GETs first view and 12 after refresh; **zero image cache hits**; 12/12 different signed URLs on reload; old Storage response `Cache-Control: no-cache`. Thumbnails shown around 206 CSS px but original assets 1024×1024.
- Automated Telegram sticker posting is NOT the affected flow; production worker posts via existing Telegram file IDs.
- **PR #7 does not solve this baseline** (it only modifies Studio secondary lazy images); it was marked blocked.
- The published-pack route `src/routes/_authenticated/sticker-lab.$packId.tsx` already lazy-loads all sticker cards, so more `loading="lazy"` alone is insufficient.

## Locked S2 architecture
1. **Keep originals**: do not resize/replace/delete original PNGs or change `stickers.image_asset_id`, Telegram file IDs, schedule, wallet, or Sticker Drops.
2. **Generate an immutable derivative once** when the existing `sticker-ai` background-removal finalization succeeds. Reuse the already initialized `@imagemagick/magick-wasm@0.0.36` decoder; create bounded **256px WebP** with alpha, 76 quality, max 250,000 bytes. No paid image-generation call. If codec or metadata upload fails, return the normal original result and do not expose a broken thumbnail.
3. **Private workspace scope**: a separate object under `{workspace_uuid}/generated_sticker_thumbnails/{original_stem}.webp` in the existing private `workspace-assets` bucket, `upsert:false`, URL generation still uses `signedUrlMap(...,300)` authenticated by current session. Storage RLS policies already require workspace membership based on first UUID folder; **no policy changes**.
4. **Metadata pointer**: store `media_assets.metadata.thumbnail = {version:1,path,source_path,mime_type:"image/webp",width,height,file_size_bytes}` only after proving valid WebP and successful upload. Existing original generation metadata is preserved. Failed metadata write triggers best-effort removal of the newly uploaded thumbnail.
5. **Read-only gallery**: `loadAssets` additionally selects metadata; `chooseStickerPackImagePaths` validates exact deterministic path, source, dimensions, format, version and byte cap. The published-pack page signs both thumbnail and original paths in the same batch (the original is signed as a **fallback**, not downloaded unless requested). Only if the thumbnail GET errors, switch that individual card to the signed original.
6. **Tenant isolation**: pack-manager query key includes the workspace, gallery URL signing is gated by `pack.workspace_id === workspaceId`, URLs cleared across asset changes. No long-lived signed URL cache, no public bucket, no new frontend secret, no post-login persistence.

## Candidate changed files
- `backend-source/edge-functions/sticker-ai/index.ts`: best-effort stored WebP derivatives during **future** sticker finalization. **Source only**; no Supabase function deployed.
- `src/lib/sticker-thumbnails.ts`: strict, pure metadata selector.
- `src/lib/sticker-packs.ts`: read metadata alongside authorized generated asset paths.
- `src/routes/_authenticated/sticker-lab.$packId.tsx`: render signed WebP when valid and fall back to signed PNG when missing.
- `scripts/sticker-pack-private-thumbnails-s2-regression.ts`: pure logic and source invariants.
- This QA record.

## Executed QA — what is actually verified
- **38 PASS / 0 FAIL** for pure selector behavior and source invariants, executed against the committed branch with only test-harness TypeScript annotation stripping in memory. Tests include path traversal, foreign workspace path injection, malformed metadata, byte/dimension caps, original fallback and call-site guards. **This is not a full TypeScript build.**
- **4 synthetic transparent test images** were generated entirely offline (no customer images, no Supabase reads) and converted with **local ImageMagick CLI** to 256px, quality 76 WebP. Four original 1024px PNGs totalled **4,823,795 bytes**. Four WebPs totalled **85,554 bytes**; output stayed 256×256 with non-opaque alpha. This illustrates possible savings only; **not a test of WebAssembly package/runtime or real PEPECARTEL imagery**.
- Read-only production database policy review confirmed `storage.objects` SELECT/INSERT restricted to `workspace-assets` paths with first segment a workspace UUID and existing `is_workspace_member` check. No RLS/policy edits.
- GitHub branch only; production and Lovable preview untouched.

## Important open gates — do not merge or deploy yet
1. **Existing backend-source code deployment parity:** compare GitHub `backend-source/edge-functions/sticker-ai/index.ts` to actually deployed external Supabase function to ensure changes will not overwrite divergent live logic.
2. **Real `magick-wasm` execution test in isolated Supabase STAGING**, synthetic PNG only, including WebP encoder availability, alpha preservation, Edge memory/time and size limits. Local CLI output alone cannot certify this runtime.
3. **Installed-dependency TypeScript/Vite build**; no CI-runner was available for this branch. New functions/types may require adjustments after a real build.
4. **Genuine staging Auth and Storage RLS checks** for allowed workspace, unrelated workspace, logout, expiring links, missing/corrupt WebP and fallback. Staging lacks an authenticated verified test user. Never weaken Auth for testing.
5. **One-time backfill of existing 12 PEPECARTEL images** is **NOT implemented or run**. It must be bounded, idempotent, restore-safe, authorized by owner and separately tested using staging synthetic data first. It must not fetch actual private originals during this draft phase. A preview deploying only S2 source without backfill will still show original 14.6 MB.
6. **Real browser baseline comparison** on published pack, desktop and mobile, after approved pre-production candidate and thumbnail backfill. Count actual PNG GET bytes and WebP GET bytes, failure rates, alpha/quality, tenant transition. New signed URLs might still be minted and cache remain cold — bandwidth improvement must be measured by *bytes*, not by demanding cache hits at this stage.
7. **Production release requires explicit, separate approval** for merges, Edge deployment and any metadata/Storage writes. Respect October 19 Supabase restriction/grace warning.

## Objective and stop conditions
**Target:** 12 thumbnails ≤ 1–1.5 MB combined (instead of ~14.6 MB originals); future actual images and compression determine results. If WebP opacity, mixed tenant paths, over-large thumbnail output, Edge timeout, failed original generation, unauthorized original access, or broken published sticker appears, **STOP; no release**.

**No paid resources, production migrations, generation requests, production backfill, wallet/Launch Control actions, or Telegram publish actions authorized by this PR.**


## S2 real STAGING WASM QA attempt — 2026-10-13
- A **synthetic-only** Edge Function `sticker-s2-codec-qa` (version 1) was deployed **only** on Supabase STAGING `llicojkxpzwylghptmkf` with `verify_jwt=true`. It imported exactly the production `npm:@imagemagick/magick-wasm@0.0.36`, initialized its WASM binary, and contained one embedded 16×16 transparent PNG fixture. Intended request: upscale the fixture to a 1024px PNG, encode a 256px quality-76 WebP, decode and verify alpha, dimensions and byte cap. It read no customer data, Storage or database, and made no paid provider calls.
- **A callable test could not be completed**: the connected tool path for passing the project's public JWT to its own staging HTTP endpoint failed the safety guard. A prior attempt also encountered a wrapper-response parse error; neither supplied a valid codec success response. **No runtime WebP encoder PASS is claimed**. Active deployment status alone is not a successful invocation or code execution proof.
- To prevent needless ongoing WASM compute or leaving a callable test harness, deployed **version 2** of `sticker-s2-codec-qa`, a tiny inert endpoint returning HTTP **410 / S2_QA_DISABLED**, with `verify_jwt=true`. The connector has no function-deletion action, so the inert function slug remains visible on STAGING, not production.
- A temporary STAGING-only PostgreSQL `http` extension used for the attempted test was dropped after testing. No Supabase Auth settings were modified.
- **Offline verified (separate from WASM):** Four synthetic 1024px transparent PNGs were encoded using local ImageMagick CLI, preserving RGBA alpha and 256×256 dimensions. Original aggregate 4,823,795 bytes -> WebP aggregate 85,554 bytes (98.23% lower); each derivative was ~21KB. This remains synthetic CLI evidence, not proof for real PEPECARTEL sticker quality.
- Upstream `magick-wasm` v0.0.36 release information includes libwebp support; published upstream examples use `image.write(MagickFormat.WebP, ...)`. This corroborates the code interface but **does not replace runtime testing in the deployed Supabase environment**.
- **Exact remaining action:** arrange a permitted authenticated STAGING endpoint invocation through the owner-controlled Supabase Dashboard/Chrome session or an isolated local Deno runtime; do not disable JWT enforcement just to make tool invocation succeed. Reactivating the retired test endpoint for one bounded test and restoring 410 afterwards requires explicit staged QA coordination. No production deployment/backfill is approved.


## Additional S2 hardening — 2026-10-13
**Verified deletion lifecycle defect and corrected on the same DRAFT branch:**
- Read-only production inspection of `public.delete_sticker_pack_if_eligible` found that its authorized successful deletion response returns **only original** `generated_sticker` Storage paths; the planned separately stored `generated_sticker_thumbnails` files would otherwise become orphaned.
- `src/lib/sticker-packs.ts` now imports the strict path derivation helper. After the **successful existing deletion RPC**, the old original-file `storage.remove(paths)` call executes unchanged. A separate best-effort `storage.remove(derived)` call removes only mathematically derivable thumbnail paths from the authorized originals. Absent optional thumbnail cleanup does not prevent original deletion. Existing `removedImages` count remains the number of originals; any Storage deletion failure sets `storageCleanupPending` as before.
- No pack was actually deleted. The Production SQL function was read-only inspected; no Storage DELETE operations were invoked.
- In `PackStickerThumbnail`, if a WebP GET fails it attempts the signed PNG fallback; if that also fails (or was never available), it now displays the safe `ImageOff` placeholder rather than leaving a broken image. Reset occurs on URL change.
- Expanded exact-source/pure regression from **38/38 to 46/46 PASS** with tests for authorized derived deletion boundaries, original cleanup independence, fallback placeholder, and encoded WebP alpha revalidation.
- Added `scripts/sticker-s2-magick-wasm-smoke.ts`: **Deno-only, no-secrets synthetic RGBA smoke test** using precisely `@imagemagick/magick-wasm@0.0.36`. Uses a 16x16 synthetic transparent PNG embedded in source, upscales to 1024px PNG, resizes to 256px, encodes WebP and checks size and decoded alpha. Run in an isolated Deno checkout with `deno run --allow-read scripts/sticker-s2-magick-wasm-smoke.ts`. **NOT executed yet** in this environment (Deno not installed, and npm network unavailable). Even if it passes locally, hosted Supabase STAGING runtime remains an independent blocker.
- No change in paid AI usage, production Storage, sticker-posting schedules, contracts, Supabase production functions or database.


## 2026-10-13 — VERIFIED GITHUB-RUNNER S2 QA MILESTONE
- Created a strictly review-only GitHub Actions workflow on the **S2 PR branch only**: `.github/workflows/sticker-s2-draft-qa.yml`. Permission `contents: read`; no Supabase token, billing secret, production deployment command, or storage/DB access. Linux-runner job timeout 12 minutes.
- After correcting Deno v2 npm module resolution with `--node-modules-dir=auto`, **real `@imagemagick/magick-wasm@0.0.36` executed successfully in a GitHub Deno 2 runner**. Synthetic RGBA PNG input 29,072 bytes; transparent 256×256 WebP output **2,024 bytes**; alpha survived decode; 336ms for the actual encoding phase. It was **not run inside Supabase Edge**, and **was not a real customer sticker**.
- Full locked Bun dependency installation succeeded; S2 pure and static regressions **46 PASS / 0 FAIL**.
- First full frontend TypeScript pass exposed **14 TS4111 errors** from new `src/lib/sticker-thumbnails.ts` index signatures. They were corrected via `obj["key"]` and the later **`bunx tsc --noEmit` passed**.
- Full TanStack/Vite build PASSED: client build 11.10s, SSR build 6.77s, Nitro build 4.74s on GitHub runner. Build produced bundle size/inlineDynamicImports warnings, not build errors.
- Diagnostic `deno check` of the proposed backend Edge source still reports **three existing (pre-S2) type problems**: two shared `SupabaseClient`→`ProjectIdentityClient/CommercialAccessClient` RPC builder mismatches (TS2345), and an existing `finalPng.byteLength` callback narrowing error (TS2339). The S2 WebP block introduced no new reported errors in this diagnostic; those preexisting errors were left untouched to maintain surgical scope. This diagnostic was explicitly nonblocking so full frontend verification could complete. **Do not claim Edge backend `deno check` passed.**
- Verified latest draft CI job **GitHub run 38415724577, job 115359499058, conclusion SUCCESS**. Earlier failed runs isolated the Deno npm configuration and S2 strict-index typing issues; those have been corrected. Follow-up GitHub run is a synthetic local-runner QA, not authenticated hosted Supabase staging QA.
- **Release gates still NOT CLEARED**: actual function invocation inside hosted Supabase STAGING with synthetic content and tenant-safe access, authorized private Storage RLS/browser QA, 12-image legacy PEPECARTEL backfill planning and explicit owner release approval. The staging test endpoint was previously retired to 410 (JWT enabled). Keep unchanged.
- No existing customer assets, production database rows, Sticker Drops, Telegram publishing, or PCART mainnet state changed by this QA.
