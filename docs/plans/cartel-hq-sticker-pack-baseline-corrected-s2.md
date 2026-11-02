# CARTEL HQ — Sticker Pack Baseline and Corrected Egress Work Plan
**Evidence received:** 2026-10-13 | **Mode:** read-only diagnosis, review-only proposal

## Browser-proven baseline (owner-provided independent QA)
- Existing Lovable standalone preview, authenticated **PEPECARTEL** project, published saved pack with 12 sticker PNGs.
- **First view:** 12 GETs to Supabase private Storage; approximately **14,597,494 bytes** across all full-resolution 1024×1024 PNGs; 0 cache hits; ~0.9–1.7 sec per image.
- **Refresh:** same 12 full PNGs transferred again, approximately 14.6 MB, 0 cache hits; 12/12 newly minted signed URLs, ~0.8–1.1 sec per image; around 3-second placeholder gap for the grid.
- Preview display size about 206 CSS pixels wide; files average ~1.2 MB. Observed Storage responses: `Cache-Control: no-cache` and no ETag.
- No failed image GETs, generation, uploads, Telegram publishing or database writes during the baseline. The recorded HEAD-only probes sometimes appeared as 503 in the extension capture; **do not treat that as actual image GET failure** (images returned 200).
- Studio steps and draft pack **not tested**. No before/after optimized candidate preview exists yet.

## Verified root cause and why existing PR #7 cannot pass this QA
- The **published pack page** is `src/routes/_authenticated/sticker-lab.$packId.tsx`, not `sticker-lab.new.tsx`.
- It already renders sticker-grid `<img loading="lazy">` elements. On pack load it calls `signedUrlMap(paths, 300)` in a React effect, which creates new URLs on each remount/refresh.
- Private originals are hosted in `workspace-assets`; `loadAssets` returns original paths directly, with no thumbnail derivative. The route embeds full originals even when displaying them as small cards.
- PR #7 **only adds lazy loading/async decode to secondary images on `sticker-lab.new.tsx`**, so deploying it will **not** change the signed-URL churn, private Storage response cache headers, full PNG dimensions or the measured 14.6 MB behavior on the published pack page.
- This discrepancy is a **stop condition**: do not deploy PR #7 solely to test the published pack's bandwidth savings; don't claim the QA acceptance targets would pass.

## Supabase Free plan constraints
- Dynamic **Storage Image Transformations are unavailable on Free**, so `createSignedUrl(path, 300, {transform:{width:256}})` is **not a deployable Free-plan solution**.
- Smart CDN is automatically available Pro and above; do not upgrade simply to test this.
- Supabase recommends **pre-generating common image variants**, smaller optimized assets and appropriate cache headers when feasible.
- Reference: https://supabase.com/docs/guides/platform/billing-on-supabase and https://supabase.com/docs/guides/storage/production/scaling

## Preferred S2 strategy (design only; no changes approved)
1. Generate a **separate 256×256 (or appropriately bounded 256px) WebP thumbnail**, ideally transparency-preserving, **once per generated sticker**, while preserving the original PNG unmodified for downloads/publishing.
2. Store the thumbnail as a distinct immutable object in the existing **private** workspace-scoped Storage bucket and record its path/size with the media asset (e.g. structured metadata field if compatible). Do NOT grant public bucket access.
3. In published pack gallery, sign/use the **thumbnail path** when present; continue to use the original for full-resolution actions. Missing/stale derivative must fail safely to authorized original behavior; log the fallback count in QA.
4. Existing PEPECARTEL images need a **separately approved, bounded, idempotent one-time backfill** using authenticated server tools and **only after validation in isolated Supabase staging**. Never generate a thumbnail during every page view. Avoid paid providers and bulk production test reads.
5. Evaluate upload `cacheControl` for **new immutable derivatives**, but do **not** assume browser-cache reuse with freshly minted signed URLs; cache controls and URL stability are separate. Tokens must not go to logs, long-lived browser storage or third-party CDN, and must not cross accounts/workspaces.
6. Retain a 300-second or shorter authorization-reviewed signed URL TTL; do not lengthen indiscriminately. Provide safe invalidation on logout, tenant switching, delete/archive and account access changes.
7. Before release: budget target ideally **12 thumbnails <= 1–1.5 MB total** (versus 14.6 MB full originals), verified visually and via real GET bytes; 12 image GETs on refresh may persist until a separately reviewed secure cache-key strategy exists. Don't incorrectly require zero requests or stable signed URLs to validate a thumbnail-only saving.
8. Check Free-plan CPU/function/storage constraints and runtime image encoder compatibility before writing a generation job. If server image tooling incurs any unavoidable billing, stop for owner approval. No production SQL/Storage/Edge changes without separate approval.

## QA plan
- **First:** inspect existing asset generation and storage RLS rules read-only. Develop/deploy thumbnail prototype to STAGING only, using synthetic images not copied private customer content.
- **Second:** source/type/build tests in isolated branch, authenticated desktop/mobile candidate QA, alpha/transparency and visual quality, failed/missing thumbnail fallback, cross-project and signed-URL expiry safeguards.
- **Third:** once fully tested, separately authorize production migration/backfill and merge. Then repeat **exact PEPECARTEL pack** baseline: 12 GET total bytes, number of full originals fetched, thumbnails size, cache header, visible load latency, correct published state, no Telegram/mission impact.
- **Stop:** no production updates, PR merges, new paid service, unsigned public access, automatic sticker generation, increased schedule cadence or network logging of signed tokens.

## Explicit current state
- PR #7 remains **DRAFT** and should be treated as a **Studio-only offscreen mitigation**. It is **not the pack-page fix**.
- Production remains unchanged. This document contains no user email, object paths, signed tokens, private keys, or customer data.
