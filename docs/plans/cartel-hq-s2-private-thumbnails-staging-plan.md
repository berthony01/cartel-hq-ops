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
