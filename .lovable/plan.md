# Phase 1B-2 — Generation Failure Clarity & Review/Export

Frontend-only phase. No schema, no policy, no bucket, no Edge Function, no provider change. Existing packs, assets and `ai_jobs` history are read-only inputs; nothing is deleted or rewritten.

## Verified current behaviour (read before planning)

- `sticker-lab.new.tsx` Step 4 renders a red global notice `Could not reach the generation service. Try "Refresh status".` purely from `configQuery.isError` (line ~1111). That query is `retry: false`, `staleTime: 60_000`, `enabled: step === 4`. Once it errors (cold Edge Function start, transient network), `isError` stays true until a later `refetch()` succeeds — it is completely independent of whether stickers are ready. This matches the observed stale banner with 12/12 READY.
- Failure copy comes from `friendlyProviderError()` in `src/lib/sticker-packs.ts`. It only special-cases "busy"; every other Latin-script provider string is passed through verbatim — which is how the safety-filter sentence reaches the card. The card then shows only that sentence plus a bare `Retry` button, with no cause label and no "what to change".
- Step 4 primary controls are unconditional: `Generate first test sticker` (disabled once `generatedCount > 0`) and `Generate remaining (0)` (disabled at 0). Both remain visible in the completed state.
- Step 5 Review shows per-sticker thumb, transparency text, emoji/keyword inputs, and a Telegram summary. There is no ready count headline, no failure/retry history, and no download action.
- Downloads are feasible with no backend change: assets already resolve through `signedUrl()` / `signedUrlMap()` in `src/lib/media.ts` against the existing private `workspace-assets` bucket.

## Scope

### 1. Failure taxonomy and copy (`src/lib/sticker-packs.ts`)

Replace the pass-through in `friendlyProviderError` with a classifier returning `{ kind, title, body, action }`, matched on the raw provider/job message. Raw text stays available for the existing `title=` debug tooltip only.

Kinds and user-facing copy:

- **safety** (`flagged as sensitive`, `content policy`, `moderation`)
  Title: "Blocked by the image filter"
  Body: "The provider's safety filter rejected this sticker's reference image or wording. Try a milder action description (for example remove weapons, blood, or brand names), or pick a different reference image."
  Action: "Edit concept" (jumps to Step 3, that concept focused) + "Retry"
- **busy** (`服务繁忙`, `busy`, `queue`)
  Title: "Provider is busy"
  Body: "Kie is handling too many tasks right now. Nothing was lost — wait a minute and retry this sticker."
  Action: "Retry"
- **rate_limit** (`rate limit`, `429`, `too many requests`)
  Title: "Rate limit reached"
  Body: "Too many generations were sent in a short window. Wait about a minute, then retry. Stickers already finished are unaffected."
  Action: "Retry"
- **network** (`fetch failed`, `network`, `ECONNRESET`, `abort`)
  Title: "Connection interrupted"
  Body: "The request to the generation service did not complete. This is usually temporary — check your connection and retry."
  Action: "Retry"
- **service** (`503`, `502`, `unavailable`, `timeout`, function invoke failure)
  Title: "Generation service unavailable"
  Body: "The generation service did not respond. Your pack and finished stickers are safe. Try again shortly."
  Action: "Retry"
- **unknown** (fallback, and any non-Latin text)
  Title: "This sticker didn't finish"
  Body: "The last attempt failed before an image was stored. Nothing else in the pack was affected. Retry this sticker."
  Action: "Retry"

Card layout for a failed sticker: red status badge, bold title, one-sentence body, `Retry this sticker` button (explicit label, not bare "Retry"), and a small "Technical detail" disclosure holding the raw message.

### 2. Kill the stale global provider banner (`sticker-lab.new.tsx`)

- The red banner renders only when `configQuery.isError && generatedCount === 0 && !anyBusy` — i.e. only when it can actually explain a blocked user.
- When some stickers are ready, degrade to a neutral inline chip next to the Provider row: "Provider status unknown — finished stickers are unaffected."
- Add `retry: 1` and clear the error state on any successful `refreshStatus()`; refetch config when Step 4 is re-entered rather than trusting a 60s-stale failure.
- Never let a config probe failure imply the pack failed.

### 3. Step 4 completed state

When `generatedCount === draft.concepts.length && !anyBusy`:

- Hide `Generate first test sticker` and `Generate remaining (n)`.
- Show a green completion panel: "All {n} stickers ready · {t}/{n} transparency verified", plus `Continue to Review` (primary) and `Refresh status` (secondary).
- Per-card `Regenerate` stays available (with the existing credit-cost confirm, extended to single regenerate) so a user can redo one sticker without a bulk control.

When some are ready and some failed: keep a single primary `Retry failed ({k})` button in place of `Generate remaining`, plus a line "{k} of {n} need another attempt — retries only re-run the failed stickers."

### 4. Review step (Step 5)

Add above the grid:

- Readiness header: `12 / 12 ready` · `12 / 12 transparent` · `0 in progress` · `k failed` (each as a StatusBadge, derived from existing state).
- Attempt history: for each sticker with more than one `ai_jobs` row, a compact "2 attempts" note; a collapsible "Generation history" listing sticker label, attempt count, and last failure reason. Uses existing `loadLatestJobs()` — no new query surface, no new table.
- Blocking notice if any sticker is not ready or not transparency-verified, stating publishing will require all stickers ready.

Export controls (no backend change):

- Per sticker: `Download PNG` — fetch the existing signed URL, save as `{pack-slug}-{NN}-{label}.png`.
- Pack level: `Download all as ZIP` — client-side zip of the ready stickers built from the same signed URLs, named `{pack-slug}-stickers.zip`. This needs one small client dependency (`fflate`, ~10 kB, pure JS). If adding a dependency is not authorised, the fallback is `Download all` looping individual downloads, and the ZIP is dropped.
- Copy for both: only ready stickers are included; failed ones are listed by name and excluded.

## Backend changes needed

None. No migration, no policy, no grant, no bucket change, no Edge Function edit, no secret. All new state is derived from tables and jobs already read by `loadPackStickers`, `loadAssets` and `loadLatestJobs`.

Only external change requiring approval: adding `fflate` for the ZIP. Explicitly out of scope: Telegram publishing, motion stickers, payments, any new provider, any new table.

## Files touched

- `src/lib/sticker-packs.ts` — failure classifier, attempt-count helper.
- `src/routes/_authenticated/sticker-lab.new.tsx` — banner gating, Step 4 completed state, Step 5 readiness/history/export.
- `src/lib/media.ts` — small download helper (blob fetch + filename), if not inlined.
- `package.json` — only if ZIP is approved.

## Verification checklist

1. Typecheck and production build clean.
2. Load `/sticker-lab/new?pack=<the 12/12 pack>`: Step 4 shows the completed panel, no bulk generate buttons, no red banner, `12/12 transparency verified`.
3. Simulate a failed config probe with ready stickers present: red banner must not appear; neutral chip appears instead.
4. Simulate a failed sticker with a safety-filter message: card shows "Blocked by the image filter", the guidance sentence, `Retry this sticker`, and the raw text only under the disclosure.
5. Review step shows `12/12 ready`, `12/12 transparent`, attempt history reflecting the three real retries.
6. `Download PNG` yields a transparent PNG; ZIP (if approved) opens with 12 PNGs.
7. Confirm no generation call fires anywhere in this verification — zero Kie credits spent.
8. Confirm no rows in `stickers`, `media_assets`, `ai_jobs` or storage were created, altered or deleted.

Stop after this phase; report resulting commit, changed files, and verification results.
