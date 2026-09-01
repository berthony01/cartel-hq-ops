# Sticker Lab V2A — Published Candidate Generation (Phase 4D) Preflight Audit

Read-only. No files, migrations, functions, secrets or database state were changed. Git HEAD verified as `8720799acdfc97b8da35885ce469090b2cf8275c` (matches the authoritative start SHA).

## 1. What breaks if ordinary `runGeneration` is reused for a published sticker

Confirmed in source, in order of severity:

1. **Hard server block (by design).** `sticker-ai` action `start` returns HTTP 409 `STICKER_PUBLISHED` before any reference resolution or Kie call when `telegram_file_id` or `telegram_published_at` is set. A candidate flow cannot go through `start` unchanged.
2. **Current pointer is overwritten on success.** In the `remove_background` branch, `sticker-ai` does `stickers.update({ image_asset_id: asset.id, status: 'ready' })` unconditionally. That alone would silently repoint the live sticker and desynchronise CARTEL HQ from the Telegram set.
3. **Status is mutated at start and on failure.** `start` sets `stickers.status = 'generating'` and `sticker_packs.status = 'generating'`; `failSticker` sets sticker status to `ready`/`failed`. Both would downgrade a `published` sticker — violating requirement 8.
4. **Pack rollup rewrites pack status.** After background removal the function recomputes pack status to `review`/`draft`, which would demote a released pack.
5. **Client reconciliation mislabels the current sticker.** `useStickerGenerationRuntime.loadExisting` keys purely on `stickers.id` + the newest `ai_jobs` row, so an in-flight or failed candidate job renders the *current* sticker as `generating` / `failed` / `replacement_failed`, and `runGeneration` writes those same stages into `stages[stickerId]` (requirement A).
6. **Version history would not record the candidate at all.** `public.sticker_versions` rows are written **only** by trigger function `public.capture_sticker_version()`, which fires on `stickers` when `image_asset_id` actually changes. A candidate that deliberately does not move the pointer produces **zero** history rows under today's mechanics.
7. **Restore is blocked while any job runs.** Both `public.set_sticker_current_version` and `telegram-stickers` `replace_version` reject when any `ai_jobs` row for the sticker is `queued`/`running`. Correct and safe, but it means approval is only possible after the candidate job reaches a terminal state.

## 2. Smallest safe architecture

Candidate generation is a **third mode of the existing pipeline**, not a new pipeline. Reuse the same prompt compiler, blueprint parsing, reference precedence, Kie models and the same two provider tasks; change only what is written on completion.

Server (`backend-source/edge-functions/sticker-ai/index.ts`):
- New action `start_candidate`. Same membership check, same `parseBlueprint` / reference precedence / `buildPrompt` / signed URLs — literally the existing code path, with the published guard inverted: **require** Telegram footprint (else 409 `NOT_PUBLISHED`, pointing the user at ordinary Regenerate). Requirement E.
- Keep `job_type = 'sticker_generate'` and mark the job with `input_json.mode = 'candidate'` (see §4). Do **not** invent a new job_type — see §3/§B.
- Skip the `stickers.status = 'generating'` and `sticker_packs.status = 'generating'` writes when `mode = 'candidate'`.
- Propagate `mode` into the `remove_background` child `input_json` (the existing child-creation block already copies `prior_image_asset_id`).
- In the `remove_background` completion branch, branch on candidate mode: insert the `media_assets` row exactly as today (`generated_sticker`, transparency-validated), then **insert a `sticker_versions` row directly** instead of updating `stickers`, and skip the pack-status rollup.
- In `failSticker`, skip the `stickers.status` write when the job is a candidate job.

Client:
- `src/lib/sticker-ai.ts` — add `startStickerCandidate()` next to `startStickerGeneration()`, same `invoke` error normalisation.
- `src/hooks/useStickerGenerationRuntime.ts` — add a **separate** candidate state map (`candidateStages` / `candidateFailures` keyed by sticker id) and a `runCandidateGeneration()` that never writes into `stages`/`failures`; and make `loadExisting` ignore `ai_jobs` rows whose `input_json.mode = 'candidate'` when deriving the current sticker's stage.
- `src/lib/sticker-packs.ts` — `loadLatestJobs` currently selects `id,sticker_id,job_type,status,error_message,created_at`; it must also select `input_json` (or a derived flag) so candidate jobs can be partitioned rather than treated as the newest attempt on the current image.
- `src/lib/sticker-versions.ts` — surface `origin` (already returned) so the UI can badge candidate rows.
- `src/routes/_authenticated/sticker-lab.new.tsx` — candidate button, cost confirmation dialog, candidate preview panel, and reuse of the **existing** `confirmTelegramRestore` / `confirmRestore` handlers for approval. No new Telegram mutation path.

`backend-source/edge-functions/telegram-stickers/index.ts` needs **no change**: `replace_version` already revalidates the asset (workspace, `generated_sticker`, `transparency_valid`), re-confirms the file lives in the set, re-checks active jobs, guards the write on the exact old `image_asset_id` + `telegram_file_id`, and rolls Telegram back if the DB write loses the race. That satisfies requirement G.

## 3. Is a migration necessary? Yes — one, and it is unavoidable

Live constraint on the external project:

```text
sticker_versions_origin_check  CHECK (origin = ANY (ARRAY['generation','backfill']))
```

Writing `origin = 'candidate_generation'` fails today. Options:
- **(preferred)** one narrow migration widening the CHECK to include `'candidate_generation'`. Nothing else changes: `unique(sticker_id, asset_id)` and `unique(sticker_id, version_number)` already give the idempotency and ordering guarantees needed.
- reusing `origin = 'generation'` avoids the migration but makes candidates indistinguishable from promoted history — rejected, it destroys the audit trail the phase exists to create.

No new table, column, index or RPC is required. `sticker_versions` is service-role written and already readable by members.

## 4. Distinguishing candidate jobs without breaking history

Use `ai_jobs.input_json.mode = 'candidate'` on both the generation job and its `remove_background` child, and keep `job_type` unchanged.

Why not a new `job_type`:
- `ai_jobs_active_sticker_generate_uniq` is `UNIQUE (sticker_id) WHERE job_type = 'sticker_generate' AND status IN ('queued','running')`. Keeping the job_type means a candidate and an ordinary generation **cannot both be active** for one sticker, across tabs, at the database level — requirement B is satisfied with zero new code. A new job_type would silently escape this index and allow two billable tasks.
- `ai_jobs_remove_background_parent_uniq` is keyed on `input_json->>'parent_job_id'` and is job_type-agnostic in the way that matters, so child duplicate protection (requirement C) also carries over unchanged.

The consequence is that reconciliation must filter on `mode`, not on `job_type` — which is exactly the `loadLatestJobs` / `loadExisting` change in §2 (requirement A).

## 5. Exactly one version row per candidate, pointer untouched

The `remove_background` branch is already effectively single-winner: the child job's own row is flipped to `succeeded` with the asset id in `output_json`, and the asset is only created once because concurrent pollers race on the child insert, not the completion. For candidates, write:

```sql
insert into public.sticker_versions (workspace_id, pack_id, sticker_id, asset_id, version_number, origin)
values (..., coalesce(max(version_number),0)+1 for this sticker, 'candidate_generation')
on conflict (sticker_id, asset_id) do nothing
```

- `unique(sticker_id, asset_id)` + `ON CONFLICT DO NOTHING` makes a duplicated completion a no-op (requirement D).
- `unique(sticker_id, version_number)` may throw `23505` if two pollers compute the same next number; retry the number computation once and treat a second `23505` as "already recorded", then re-read the row. Same pattern the existing trigger relies on.
- No `stickers` update at all on this path, so `image_asset_id`, `status`, `telegram_file_id`, `telegram_published_at`, pack Telegram state, distribution and Sticker Drops are untouched by construction (requirement 4).

Note: because the *trigger* only fires on pointer change, a later approval of that candidate through `replace_version` will not double-insert — `capture_sticker_version` short-circuits on the existing `(sticker_id, asset_id)` row and leaves the `candidate_generation` origin intact.

## 6. UI shape

In Step 4 (Sticker Studio), on a Telegram-locked card:
- Primary state stays "Live on Telegram" with the current image labelled **Current — live on Telegram**.
- `Generate candidate` opens an `AlertDialog` stating: exactly 2 Kie tasks (generation + background removal), the current CARTEL HQ image and the live Telegram sticker stay unchanged during generation, and nothing is promoted automatically.
- Candidate progress renders in its own row using the separate candidate stage map; the current image never changes stage, never shows `failed`/`replacement_failed`.
- On success the candidate appears as a new **Candidate** badged row in the existing Version history panel with a side-by-side thumbnail against the current image.
- `Set as live` on that row calls the existing published path — `confirmTelegramRestore` → `telegram-stickers` `replace_version` — with no new mutation. For a non-published sticker the existing `set_sticker_current_version` path still applies.
- Reject is simply "do nothing"; the candidate stays in history. Requirement 7.
- Refresh recovery (requirement F): completed candidates reappear because they are durable `sticker_versions` rows. An *in-flight* candidate can be recognised without a new provider task by reading the existing active `sticker_generate` job with `mode = 'candidate'` and resuming polling with `syncStickerJob` — no additional Kie call, so economics stay at 2 tasks (requirement H).

## 7. Blockers and recommended phasing — split into 4D.1 / 4D.2

There is no hard blocker, but two independent risk surfaces argue against one atomic phase:

- **4D.1 — backend + durable candidate record (higher risk).** Origin CHECK migration; `start_candidate`; candidate-aware status/pointer suppression; candidate version insert; `loadLatestJobs`/`loadExisting` mode filtering so existing reconciliation cannot regress. This is where a mistake can corrupt a *live published* sticker, and it must be verified against the live database and a real Telegram set before any UI encourages use.
- **4D.2 — candidate UI + approval wiring (presentation).** Candidate button, cost dialog, candidate stage rendering, history badge, side-by-side compare, reuse of the existing restore/replace handlers.

Secondary reasons for the split: `loadExisting` mode filtering touches the reconciliation logic every existing Sticker Studio state depends on, so it wants its own verification pass; and the `sticker-ai` Edge Function redeploy (currently v7) plus the migration are separate external-system mutations that should each be confirmed against `ocoinbnjgstkmnwwvnhi` before UI lands.

One more thing to decide before 4D.1: while a candidate job is `queued`/`running`, **all** restores for that sticker are blocked by the existing `active_generation` guards. That is safe and I recommend keeping it, but the UI copy in 4D.2 must say so rather than surfacing a confusing rejection.

## Status

Report only. No implementation performed, nothing published, no database or Edge Function changes made.
