# Phase 6.5K-B — Pack Lifecycle (Archive + Safe Delete)

Start gate assumed: `0aabfb064237b3a42dd67d37dea1297ccf54cab2`. Plan only — no edits, migrations, deploys, or data writes performed.

## A. Schema change (single additive migration)

On `public.sticker_packs`:

- `archived_at timestamptz null`
- `archived_by uuid null references public.profiles(id)`
- partial index `on sticker_packs (workspace_id, updated_at desc) where archived_at is null`

Deliberately NOT adding `archived` to the existing `status` CHECK (`draft, generating, review, ready, publishing, published, failed`). Archive is orthogonal to lifecycle status: a pack must keep `published` so Telegram set identity and history stay truthful. Archive is a visibility/retirement flag only.

RLS change (server enforcement, requirement 10): drop the member-level DELETE policy on `sticker_packs` so no client can hard-delete directly. Deletion happens only through the SECURITY DEFINER path below. Archive/restore is also gated in the function, not by a broad UPDATE policy — the existing member UPDATE policy stays, but the migration adds a BEFORE UPDATE trigger that rejects direct changes to `archived_at`/`archived_by` unless performed by the definer function (guard via a session-local flag set inside the function).

No renames. No changes to any other table.

## B. Server operation design

Two SECURITY DEFINER RPCs plus one Edge Function, split by capability:

1. `public.archive_sticker_pack(_pack_id uuid)` — RPC. Pure SQL work: verify `is_workspace_operator(workspace_id, auth.uid())`, set `archived_at/archived_by`, disable every `sticker_drop_schedules` row for the pack (`enabled=false`, `next_run_at=null`, `paused_reason='pack_archived'`). Atomic in one transaction. No storage involved, so an RPC is correct and cheapest.
2. `public.restore_sticker_pack(_pack_id uuid)` — RPC. Operator check, clear `archived_at/archived_by`. Schedules stay disabled with `paused_reason='pack_archived'` retained until a human re-enables them (no silent resumption of recurring posting).
3. `sticker-pack-delete` — Edge Function (`verify_jwt=true`). Hard delete needs storage-object removal, which SQL cannot do. Flow: authenticate caller → call a definer RPC `delete_sticker_pack_prepare(_pack_id)` that re-validates eligibility and returns the pack's owned `media_assets` rows (ids + storage paths) → remove those storage objects with the service-role client → call `delete_sticker_pack_commit(_pack_id, _asset_ids)` which deletes the `media_assets` rows and the pack row inside one transaction. Eligibility is re-checked in both RPCs so the UI can never bypass it.

Canonical source under `backend-source/edge-functions/sticker-pack-delete/`, deployment mirror under `supabase/functions/sticker-pack-delete/`. Not deployed in the implementation run unless separately authorized.

## C. Eligibility rules

Permanent delete allowed only when ALL are true:
- caller is workspace owner/admin (`is_workspace_operator`)
- `sticker_packs.telegram_set_name is null` and `telegram_published_at is null`
- `status not in ('published','publishing','generating')`
- no `stickers` row with `telegram_file_id is not null`
- zero rows in `sticker_pack_group_targets` for the pack
- zero rows in `sticker_drop_schedules` for the pack
- zero rows in `sticker_drop_events` for the pack
- `archived_at is null` (archived packs are restored first, then deleted, if still eligible)

Anything failing the above is archive-only. Archive requires operator role and `archived_at is null`. Restore requires operator role and `archived_at is not null`.

## D. Media/storage cleanup boundary

Only assets exclusively owned by the pack are removed:
- `media_assets` rows referenced by `stickers.image_asset_id` for stickers of this pack, restricted to `asset_type = 'generated_sticker'` and same `workspace_id`.

Explicitly excluded: `sticker_packs.reference_asset_id`, any Brand Kit logo/mascot/reference asset, `project_profiles.logo_asset_id`, and any asset referenced by a sticker outside this pack (checked with a NOT EXISTS guard). Storage objects are removed by exact `storage_path` returned from the DB — never by prefix listing.

## E. Sticker Drops on archive/restore

Archive: all schedules for the pack are set `enabled=false`, `next_run_at=null`, `paused_reason='pack_archived'` in the same transaction as the archive flag. The existing `validate_sticker_drop_schedule` trigger already nulls `next_run_at` when disabled, so the runner cannot pick them up. `sticker_drop_events` history is untouched.

Restore: schedules stay disabled with the reason preserved; the UI shows "Sticker Drops for this pack were paused when it was archived — re-enable them in Sticker Drops." No automatic resumption.

Optional guard (recommended, additive): extend `validate_sticker_drop_schedule` to raise when enabling a schedule whose pack is archived.

## F. UI changes

`sticker-lab.index.tsx`
- "Your packs" list filters `archived_at is null`.
- New compact collapsed "Archived packs" section (count + list, restore action, view link), only rendered when archived packs exist.
- Per-pack overflow action: "Archive pack" or "Delete pack permanently" depending on eligibility; hidden entirely for non-operators.

`sticker-lab.$packId.tsx`
- Archived packs render a quiet banner: archived state, who/when, that Sticker Drops were paused, and that the Telegram sticker set still exists on Telegram and is unchanged.
- Lifecycle actions (publish, send to communities) disabled while archived; primary action becomes "Restore pack".
- Delete path uses a typed-confirmation dialog (type the pack title) and states exactly what is destroyed: sticker rows, generated sticker images, the draft itself; and that AI job/usage history is retained without pack attribution.
- Ineligible packs show the archive dialog instead, with the reason ("published to Telegram", "delivered to communities", "used by Sticker Drops").

`src/lib/sticker-packs.ts`
- `listWorkspacePacks` gains an archived filter; add `listArchivedPacks`, `archivePack`, `restorePack`, `deletePackPermanently` (invokes the Edge Function), plus a pure `packDeleteEligibility()` helper for the UI hint (server remains authoritative).

Copy rule enforced everywhere: archiving in CARTEL HQ never deletes the Telegram sticker set.

## G. Expected files / objects

- migration: `sticker_packs.archived_at/archived_by`, index, DELETE-policy removal, archive-column guard trigger, 5 functions (`archive_sticker_pack`, `restore_sticker_pack`, `delete_sticker_pack_prepare`, `delete_sticker_pack_commit`, schedule-enable guard), grants to `authenticated`
- `backend-source/edge-functions/sticker-pack-delete/index.ts` (+ deployment mirror)
- `src/lib/sticker-packs.ts`
- `src/routes/_authenticated/sticker-lab.index.tsx`
- `src/routes/_authenticated/sticker-lab.$packId.tsx`
- regenerated Supabase types (platform-generated)

Nothing else. Distribution/Telegram/Community routes untouched.

## H. Rollback and partial-failure behavior

- Archive/restore are single transactions — all-or-nothing, no partial state.
- Delete is ordered prepare → storage → commit. If storage removal fails, commit is never called and the pack remains fully intact (safe failure, zero orphaned DB state).
- If commit fails after storage removal, the pack row survives with dangling image references; the UI surfaces "Cleanup incomplete — retry delete", and a retry is idempotent because prepare re-derives current assets and missing storage objects are ignored.
- Every failure returns a generic user-facing error plus a precise server-side reason; no partial success is ever reported as success.
- Rollback of the feature itself: drop the two columns and functions; nothing existing depends on them.

## I. Test matrix

| Case | Expected |
|---|---|
| Draft pack, no stickers, member role | actions hidden; RPC/function rejects |
| Draft pack, no dependencies, operator | permanent delete succeeds; sticker rows + generated assets + storage objects gone |
| Draft pack whose reference asset is a Brand Kit logo | logo asset and storage object survive |
| Pack with `telegram_set_name` set | delete rejected server-side even if forced; archive offered |
| Pack with group targets only | delete rejected; archive succeeds; targets preserved |
| Pack with enabled Sticker Drop schedule | archive disables it, `next_run_at` null, `paused_reason='pack_archived'`; runner skips |
| Archived pack | absent from Your packs, present in Archived, publish/send disabled |
| Restore | reappears in Your packs; schedules remain disabled |
| Re-enable schedule for archived pack | rejected by trigger guard |
| Direct client `delete from sticker_packs` | denied by RLS |
| Direct client update of `archived_at` | denied by trigger |
| Storage failure mid-delete | pack intact, truthful error |
| `ai_jobs` / `usage_ledger` after delete | rows retained, pack attribution nulled |

## J. Ambiguity / risk

- The archive-column trigger guard relies on a session-local setting set inside the definer functions; if that pattern is rejected by the platform linter, the fallback is a narrower column-level revoke on `archived_at/archived_by` for `authenticated`. Decide at implementation time.
- Exact current RLS policy text on `sticker_packs` and `sticker_drop_schedules` should be read (read-only) immediately before writing the migration; the audit confirmed member delete is possible but the policy names must be quoted exactly.
- Whether operator-only is desired for archive as well as delete — this plan applies operator-only to both, per requirement 8.
- Edge Function deployment is out of scope here; without deployment, permanent delete is inert in preview. Confirm whether the implementation run may deploy `sticker-pack-delete`.
- Whether a stale `sticker_pack_group_targets` row with status `failed`/never-announced should still block deletion — this plan blocks it (conservative). Say if you want failed-only or never-announced-only behavior.
