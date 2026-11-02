# CARTEL HQ — Sticker Lab Media Egress Protection S1
**Audit completed:** 2026-10-13 UTC | **Release:** draft GitHub PR only, no merge/deploy | **Production DB:** READ-ONLY

## Critical production findings (historical read-only Supabase observations)

- Supabase PEPECARTEL organization **Free**. User's Billing Usage screenshot: **previous billing cycle 5.784 GB / 5 GB egress**, plus **October 19, 2026** grace-period warning; **current cycle 0.711 GB / 5 GB** at the screenshot timestamp. The October 19 restriction risk is unresolved, regardless of this PR.
- Production DB `ocoinbnjgstkmnwwvnhi` reported healthy at audit time. No schema, Storage, logging, job schedule, function, credential or billing settings were edited.
- On **2026-09-01 UTC**, production gateway logs report about **1.579 GB of Storage response Content-Length**: **1,219,024,424 bytes** generated sticker images in **1,113** requests; **194,049,064 bytes** motion files; **125,304,450 bytes** mascots; **32,667,722 bytes** reference image; and other assets. These are **HTTP response header estimates**, not a reconciled billing-system egress measurement; overlapping metrics, accounting and cache classification must not be assumed.
- **1,110 / 1,113** generated-sticker image requests carried a Lovable editor/preview-class Referer. User-agent was browser-class in 1,112 requests. File details and signed token values were not exported.
- The busiest hashed sticker paths were each accessed roughly **86–102 times**, often with **78–90 distinct signed query strings**; e.g. one sticker image received **95 requests / 87 unique signed queries / 86 CDN MISS responses / zero CDN HIT**. This is strong evidence of newly minted signed URLs reducing practical cache reuse on repetitive browser previews. It **does not show** whether the editor automatically reloaded, a human refreshed, or a component refetched; browser instrumentation is required for that.
- The current `src/lib/media.ts` creates short-lived private signed URLs (usually **60 seconds**); `src/hooks/useStickerGenerationRuntime.ts` re-mints batch URLs when reconciling persisted state, while other route/page and history views also generate signed URLs. This is a plausible source of URL churn; code inspection alone cannot identify the exact re-render trigger.
- The production automatic posting Edge function `sticker-drops` uses the existing **Telegram `telegram_file_id` with `sendSticker`**. It does **not** normally fetch sticker image bytes from Supabase to deliver each scheduled post. There was **one enabled 30-minute schedule** and **24 posted records on Sep 1**, versus **1,113 image requests** that day. This weighs strongly **against** automatic Telegram sticker posting being the primary source of the Sep 1 storage spike.
- Five cron jobs remain unchanged: four once per minute, sticker scheduler every five minutes. They do produce API/Edge logs but route-level response sizes were small compared with the sticker-image response estimates. Do not slow them without a separate evidence-led audit.

## S1: minimal lowest-risk UI mitigation — draft only
**Allowlist:** `src/routes/_authenticated/sticker-lab.new.tsx` only for runtime behavior changes.

- Keep the user-selected **primary uploaded reference** image immediately available (existing eager behavior).
- Add browser-native `loading="lazy"` and `decoding="async"` to **nine** previously eager non-primary Sticker Studio image thumbnails (references, generated stickers, history, candidates, variations, review). One static-sticker thumbnail was already lazy; add only `decoding="async"` to it. This yields **ten** deferred secondary images.
- Preserve image `src`/`alt`/`className` exactly. No request/auth/query logic changed, no new image transform or third-party service, no longer-lived private URLs, no client token persistence or caching of confidential assets, no AI provider call, no Telegram/cron/Sticker Drop changes.
- Browser-native lazy loading **can avoid initial downloads for out-of-viewport images**. This **does not solve** a visible image being fetched with a fresh signed URL after every reload, does not guarantee egress reduction, and must be measured before production rollout.

## Verified source checks
- Diff preflight: **11 original `<img>` tags retained**, primary reference exactly unchanged, **10** secondary images lazy and async decoding, all source/alt/classes unchanged, text outside image nodes byte-for-byte unchanged.
- Repo `scripts/sticker-lab-media-egress-s1-regression.ts`: **18/18** assertions passed running committed source tests in an isolated JavaScript evaluation after in-memory TypeScript signature stripping. Existing Pack Manager already uses lazy thumbnail loading.
- **Not yet run:** full `bun install` + TypeScript/Vite build; authenticated desktop/mobile browser test; DevTools network-waterfall/bytes; Supabase before/after comparisons; validation of thumbnails in all Studio steps. This is **not** production-certified.

## Next gated test (owner's browser extension — audit only)
1. Authenticate in the existing Lovable preview on a **non-PCART** test workspace. Do **not** open Mainnet/Launcher or trigger new paid AI sticker generation.
2. On current baseline, visit saved Sticker Lab pack and Studio steps 1, 3, 4 and 5 using existing assets. In browser network DevTools record **GET** count, total transferred bytes, distinct anonymized signed-URL count, initiator and cache status for `/storage/v1/object/sign/` assets (don't export URL query tokens).
3. Test one cold page load, three normal navigations, one refresh, and scrolling to reveal previously offscreen thumbnails. Check any 401/403/image errors, project switching and log-out; do not capture private tokens.
4. When a safe branch preview with PR S1 code exists (do not merge to production just to test), repeat identical steps at desktop and mobile widths; check the first primary reference remains visible promptly, all intended thumbnails appear after scroll, no unexpected blank images, and image verification/Telegram publishing are unchanged.
5. Compare actual request count, GB/MB and cache behavior; if benefit is small, **stop** and design a second review-only scoped in-memory signed-URL reuse strategy with explicit auth/workspace invalidation and no token persistence. Never implement persistent signed-token caching or widen URL lifetimes without separate security/expiry review.
6. No automatic production release. Only after build, isolated browser QA, and owner approval may S1 be proposed to merge.

## Explicit STOP / no-go
If private workspace media leaks across login/project switch; preview images fail to appear; any Telegram or sticker generation regression occurs; or screenshot/image load fails in a signed-in session: **do not merge**. Keep existing public preview live and report the defect.

## Branch stacking / isolation
This PR is based on **main** and is independent of G2A.1/G2A.2/G2B draft AI Guide branches. Zero protected `pcart-*` files or launch logic were changed.
