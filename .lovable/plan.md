# C3 Read-Only Architecture Inspection — Animated Motion Release into the existing Telegram set

Start gate verified: HEAD = `66ec87d5f5f5e56ba25537a5fd2cc27870f73449`. No files edited, no migrations, no deploys, no provider or Telegram calls.

## 1. Where `telegram_file_id` is read/written

Backend (service-role writes):
- `backend-source/edge-functions/telegram-stickers/index.ts`
  - L275 publish loop skip: treats `status === 'published' && telegram_file_id && telegram_published_at` as "already live".
  - L283/L289-290: reuse existing uploaded file id, else `uploadStickerFile` (static PNG) and write `telegram_file_id`.
  - L356-362 (`sendSticker` owner DM test): selects published stickers with non-null `telegram_file_id`, sends that id.
  - L417-418, L462-465, L486-488 (version restore / `replaceStickerInSet`): old file id is the `old_sticker` handle, used as an optimistic-concurrency guard (`.eq('telegram_file_id', expectedOld)`), and the new upload id is written back. L434 clears it when the sticker was never truly live in the set.
- `backend-source/edge-functions/telegram-group/index.ts`
  - L114-132 `reconcileNativeStickerIds`: pulls `getStickerSet`, matches published rows to native set entries by ordinal index (+ first-emoji sanity check) and rewrites `telegram_file_id` to the live native id.
  - L219-220: group test send via `sendSticker` using that id.
- `backend-source/edge-functions/sticker-drops/index.ts`
  - L69-97: identical ordinal reconciliation and rewrite.
  - L215: scheduled drop `sendSticker` with `sticker.telegram_file_id`.
- `backend-source/edge-functions/sticker-drop-config/index.ts` L80-83: lists drop-eligible stickers (non-null `telegram_file_id`).
- `backend-source/edge-functions/sticker-ai/index.ts` L545: `telegram_file_id != null || telegram_published_at != null` = the "Telegram-touched, block paid regeneration" guard.
- `supabase/migrations/20260831021833_...sql` L202: pack delete eligibility blocks when any sticker has a non-null `telegram_file_id`.

Client (read-only):
- `src/lib/sticker-packs.ts` L27/L52 (row type + select list), `src/lib/telegram-stickers.ts` L224/L243 (status polling), `src/lib/sticker-drops.ts` L53 (type), `src/hooks/useStickerGenerationRuntime.ts` L122 (Telegram-touched lock), `src/routes/_authenticated/sticker-lab.$packId.tsx` L512 (`isPublished` badge).

No client code writes `telegram_file_id`.

## 2. Where `release_variant` is read/written

- Written: only `supabase/migrations/20260901032740_...sql` (column add, default `'static'`, CHECK `('static','motion')`). No runtime code writes it.
- Read: `src/lib/sticker-motion.ts` L71-78 (select + `releaseVariant` mapping), `backend-source/edge-functions/sticker-motion-ai/index.ts` L395/L434/L445-456 (selected and echoed back, never mutated).
- Everywhere else it appears only in "never touches release_variant" comments (`sticker-motion-telegram`, `sticker-motion-ai`, the two motion hooks, `MotionStudioPanel.tsx`, `sticker-lab.new.tsx`).

So `release_variant` is today a declared-but-inert column: no writer, no behavioral consumer.

## 3. Does anything assume `telegram_file_id` is a static PNG?

Only the publish/replace write path does, and only at upload time:
- `uploadStickerFile` hardcodes `sticker_format: 'static'` and `image/png` (telegram-stickers L81-95).
- Sticker inputs hardcode `format: 'static'` (L293 create/add, L445 replace).
- `prepareForTelegram` produces 512px PNG bytes.

Consumers do not: `sendSticker` (owner test, group test, drops) passes the id opaquely, and reconciliation copies whatever `file_id` Telegram reports. So the assumption is confined to *producing* the id, not to *using* it.

## 4. Can Drops and group test sends keep using `telegram_file_id` as the current-live id?

Yes. `sendSticker` accepts any file id in the set regardless of static/video/animated. The reconciliation loops re-derive the id from `getStickerSet` positionally, so after a static→video `replaceStickerInSet` in the same set the id self-heals on the next reconcile. Two caveats, both pre-existing:
- Reconciliation matches by **ordinal index** and count equality (`local.length !== native.length` → hard fail). A motion release must not change set membership count or ordering, or drops/group distribution throw `NATIVE_SYNC_ERROR`.
- The emoji sanity check compares first emoji; a motion replace must carry the same `emoji_list`.

## 5. Would nullable `telegram_static_file_id` + `telegram_motion_file_id` alongside `telegram_file_id` be additive/backward-compatible?

Yes, based on current code. Every existing read of `telegram_file_id` means "current live id in the set", and every writer sets it to the id it just made live. Adding two nullable columns that record *which format that id came from* changes no existing predicate: publish skip, drop eligibility, the sticker-ai Telegram-touched guard, the pack-delete guard and the restore concurrency guard all continue to key on `telegram_file_id` alone. Nothing enumerates `stickers` columns exhaustively (all selects are explicit column lists), so untouched code paths never see the new columns.

Risk is not schema-shaped but semantic: the restore path in `telegram-stickers` rewrites `telegram_file_id` with `format: 'static'`, so restoring a static version while motion is live would silently revert the format unless the new columns are consulted there.

## 6. Migration conventions and the additive boundary

Convention: `supabase/migrations/<UTC timestamp>_<uuid>.sql`, tool-generated, latest `20260901043908_5d5ad207-...`. Pattern in the motion migration: `ALTER TABLE ... ADD COLUMN` grouped in one statement, named CHECK constraints added separately, explicit `GRANT SELECT ... TO authenticated` / `GRANT ALL ... TO service_role`, RLS policies using `public.is_workspace_member`.

Best boundary: one additive migration on `public.stickers` adding `telegram_static_file_id text NULL`, `telegram_motion_file_id text NULL`, plus (optionally) a `telegram_release_format text NULL CHECK (... IN ('static','video'))`, with **no** backfill, no default, no constraint touching `telegram_file_id`, no change to `release_variant` semantics. Existing grants on `stickers` already cover new columns, so no grant changes are required.

## 7. Hidden coupling / blockers for switching a published sticker static↔video via `replaceStickerInSet`

1. **Telegram itself**: a `regular` sticker set is format-homogeneous in practice — a set created via `createNewStickerSet` with `format: 'static'` will reject a `video` sticker in `replaceStickerInSet`/`addStickerToSet`. This is the single largest unresolved external blocker and must be probed against the live API (or a throwaway set) before C3 design is finalized, not assumed.
2. `uploadStickerFile` is hardcoded to `sticker_format: 'static'` + PNG blob; a video upload needs a WEBM branch (`sticker_format: 'video'`, `video/webm`).
3. `inputFor()` (L445) and the create/add input (L293) hardcode `format: 'static'`.
4. `prepareForTelegram` is PNG-only; the C1 `sticker-motion-telegram` function already produces the validated VP9/WEBM derivative into `sticker_motion_versions.telegram_asset_id`, so C3 should consume that asset rather than re-normalize.
5. The restore flow's guarded update sets `status: 'published'` and rewrites `telegram_file_id` unconditionally as static — it is a format-reverting path that must become format-aware.
6. Ordinal reconciliation in both `telegram-group` and `sticker-drops` (see §4) — a replace-in-place is safe; add/remove is not.
7. Pack delete eligibility (`20260831021833` L202) and the `sticker-ai` regeneration guard both trip once *any* Telegram file id exists — motion publishing will extend, not change, that lock.
8. `stickers.status` has no motion-aware value; `status === 'published'` is the sole gate for drops and group distribution, so a motion release must keep the row `published` rather than introduce a new status.

## 8. Recommended smallest C3 boundary

Phase C3 should be split, with the Telegram format-compatibility probe first:

- **C3-0 (investigation, no code)**: verify against Telegram whether a set created as static accepts a video replacement. Outcome decides whether C3 is "replace in place" or "separate motion set", which is a materially different architecture. Do not commit to C3-1 before this answer.
- **C3-1 (schema, one additive migration)**: nullable `telegram_static_file_id`, `telegram_motion_file_id` on `public.stickers`; no backfill, no writers yet.
- **C3-2 (backend only, `telegram-stickers`)**: format-aware `uploadStickerFile`/sticker input, a new `release_motion` action that consumes `sticker_motion_versions.telegram_asset_id` for the approved Current Motion, calls `replaceStickerInSet` in the existing set, and writes `telegram_file_id` + `telegram_motion_file_id` + `release_variant='motion'` under the same expected-old-id guarded-update and rollback pattern already used by restore. Preserve set membership count and emoji list exactly.
- **C3-3 (UI)**: a "Release motion to Telegram" action in `MotionStudioPanel`, enabled only when `telegramAssetId` exists, with billable/irreversible confirmation copy.

Drops, group distribution, and drop config need **no** changes under this boundary.

STOP — inspection only.
