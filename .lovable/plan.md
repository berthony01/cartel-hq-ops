# Production Diff Audit — telegram-group v10 / telegram-webhook v29

Read-only. No files, functions, schema, data, or settings were changed.

## BLOCKER — live Edge Function source cannot be read from this environment

Steps 2-7 of the requested audit all depend on step 1 (reading the exact live deployed source). That read is not possible here:

- No tool in the available Supabase toolset returns Edge Function source. The set is: `deploy_edge_functions`, `delete_edge_functions`, `curl_edge_functions` (invoke only), `edge_function_logs`, `test_edge_functions`, `analytics_query`, `read_query`, `run_sql`, `migration`, `linter`, `slow_queries`, storage/bucket tools, `rebind_secrets`. None exposes deployed source, version, or deployment hash.
- The Supabase Management API path is unavailable: `SUPABASE_ACCESS_TOKEN` is not present in this sandbox (`NO_MGMT_TOKEN`).
- `curl_edge_functions` only invokes; it cannot return a source body, and invoking `telegram-webhook` would exercise production side effects. Not attempted.

Therefore I cannot state whether live v10 / v29 are semantically equal to the repo snapshots, cannot enumerate behavioral differences, cannot confirm the per-feature checklists in items 4 and 5 against live, and cannot certify item 7 either way. I will not infer equality from the supplied hashes: the Supabase deployment hash is computed over the deployed bundle, not over this repository file, so it is not comparable to a local `sha256sum`.

## What was verified locally (authoritative repo facts)

Requested ref `37579f8b59b02efd399e3aa47fd2f0c9c7a67bcd` is content-identical to current HEAD `cc9872d70dae416ec54e7a2c17d17902a746e98a` (`git diff 37579f8..HEAD` returns zero changed files), so the snapshots below are the ref's content.

| File | Lines | sha256 (raw file bytes) |
| --- | ---: | --- |
| `backend-source/edge-functions/telegram-group/index.ts` | — | `03c449bc02062133531942f1b271b390484eb14eae1d1287b43450c2dd57a911` |
| `backend-source/edge-functions/telegram-webhook/index.ts` | 863 | `33b2cc3905033059ce838687a7635c65b80fe6ecf4b351f527059179d6038d3a` |
| `supabase/functions/telegram-webhook/index.ts` (staging copy) | 785 | `f2cd308ae42e6754829eb8ddc0605b3b806f373f666cb9111b78a1e8846e0350` |

Working tree is clean.

## Material finding — the staging copy is stale by 78 lines

`supabase/functions/telegram-webhook/index.ts` is the path the Lovable deploy pipeline uses. It is NOT byte-identical to the authoritative snapshot. The staged copy predates the bot-removal lifecycle work and is missing, in the `my_chat_member` existing-connection branch:

- the `left`/`kicked` removal branch entirely (row preservation, `bot_is_admin=false`, `can_set_sticker_set=false`, `verified_at`, and metadata `last_member_status` / `bot_can_change_info` / `official_group_sticker_eligible` / `bot_removed_at` / `bot_removed_reason`);
- pausing only currently-enabled `sticker_drop_schedules` with `paused_reason='bot_removed'`;
- the idempotent best-effort removal DM to `connected_by` (including the `Re-add bot to a community` inline button) — the staged copy does not even select `title` or `connected_by`;
- on restore to administrator/creator: clearing `bot_removed_at` / `bot_removed_reason` and re-enabling only `paused_reason='bot_removed'` schedules with reset `consecutive_failures` and future `next_run_at`.

There is no `supabase/functions/telegram-group/` staging directory at all.

## Answer to item 7

Do not synchronize repository snapshots to live source, and do not treat this as verified-in-sync. The correct order is:

1. Obtain live v10 / v29 source out of band (Supabase dashboard function editor, or `supabase functions download` with a management token) and diff it against the two `backend-source` snapshots.
2. If live matches the snapshots semantically, only bookkeeping is needed.
3. If live is behind, deploy from the `backend-source` snapshots (they are the reviewed source of truth), preserving `telegram-group` `verify_jwt=true` and `telegram-webhook` `verify_jwt=false`.
4. Independently, before any future deploy from this repo, reconcile `supabase/functions/telegram-webhook/index.ts` to byte-identity with the snapshot — deploying the current staging copy would silently regress the entire bot-removal lifecycle.

## Stop

No edits, deploys, migrations, or data writes were performed. Awaiting either live source pasted in, or authorization for a specific corrective action.
