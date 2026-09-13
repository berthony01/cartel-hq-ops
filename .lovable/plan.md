# Phase 1B — Durable Mission Lifecycle + Mission Pulse (audit result + implementation plan)

## Gate result — DRIFT FOUND (disclosure, no edits made)

Expected checkpoint `6e911e9ec6d3cd26b5d9ab2fb2814d5f16521228`. Actual HEAD `3b308077d38120de5bd1f87a80d37c7e7b79e5f0` ("Work in progress"), tree clean.

Sole diff vs the expected checkpoint: `src/integrations/supabase/types.ts` (+12/-0), adding the `create_social_mission_from_telegram_link` RPC signature. This is platform regeneration reflecting the launcher RPC you applied live. No hand-written source drift. Zero files were edited in this audit. Confirm you accept this drift before any build turn.

## Audit findings

1. **Scheduler pattern.** No cron/Vault/pg_net SQL exists in the repo — those live only in the authoritative database (Vault secret + SECURITY DEFINER `invoke_*` function + `pg_net`, one-minute cadence). The repo pattern to copy is the worker function itself: `backend-source/edge-functions/telegram-message-cleanup/index.ts` — `verify_jwt=false`, custom secret header compared only inside the DB via a `*_scheduler_secret_matches` RPC, claim RPC with `FOR UPDATE SKIP LOCKED`, per-job confirmed state writes, bounded attempts and backoff, idempotent outcomes.
2. **`/mission` flow.** Dispatch is `supabase/functions/telegram-webhook/index.ts:1992`, regex `/^\/mission(?:@\w+)?(?:\s+(\S+))?\s*$/i`, delegating to `runMissionCommand({ argument })` (helpers at ~line 471). `/mission close` already matches this regex with `argument = "close"` — it needs **no dispatch change**, only a branch at the top of `runMissionCommand` before URL parsing.
3. **Repo parity gap (blocker-class).** `supabase/functions/telegram-webhook/index.ts` (2326 lines) is the SE-4A-updated authoritative source; `backend-source/edge-functions/telegram-webhook/index.ts` (1692 lines) is a stale pre-SE-4A copy. Phase 1B must not deepen this split — pick one file as authoritative for webhook edits (recommend `supabase/functions/...`, the one SE-4A already edited) and state the other is knowingly stale.
4. **Schema already sufficient for lifecycle.** `social_missions` already has `started_at`, `ends_at`, `completed_at`, `created_by`, and `status` CHECK already includes `COMPLETED`. **No new mission column and no new status value are needed.** The live launcher RPC currently inserts `status='LIVE', started_at=now()` and leaves `ends_at` NULL — that is the one gap.
5. **Cleanup reuse is safe.** `telegram_message_cleanup_jobs` is generic by `(chat_id, message_id)`; the worker never reads `cleanup_kind`. Widening the CHECK to `('launch_watch_cta','social_mission_pulse')` is additive and cannot affect Launch Watch rows. `group_connection_id` is NOT NULL and mission targets always carry it. Caveat: the worker runs once per minute, so a 120 s lifetime deletes at 120–180 s — acceptable, must be documented, not "exactly 120".
6. **Runner → `edit_mission` without weakening auth.** The transport already has exactly one internal path: `X-Cartel-Internal-Source: telegram-webhook` + service-role bearer + `X-Cartel-Actor-User-Id`, and the actor still passes the full owner/admin membership gate. **Do not add a new bypass.** The runner reuses the same internal shape with a second allowed source value, passing `social_missions.created_by` as the actor. If `created_by` is no longer an owner/admin, the transport correctly 403s and the mission is left LIVE-expired with an unresolved marker — fail-closed, no weakening.

## Recommended minimal design

- **No new mission-status value; no `ACCOMPLISHED`.**
- `ends_at = now() + interval '45 minutes'` set by the launcher RPC at creation (durable, not derived).
- **One new table `social_mission_pulses`** as the durable pulse ledger: `(id, workspace_id, mission_id, target_id, offset_minutes, due_at, status, telegram_message_id, attempt_count, next_attempt_at, claimed_at, last_error, error_class, timestamps)`; unique `(mission_id, offset_minutes)` is the idempotency key; composite FKs to `(mission_id, workspace_id)` and `(target_id, workspace_id)`; forced RLS, no `anon`/`authenticated` write grants, service-role only. Rows for offsets 3/8/15/25/35 are inserted once, by the same transaction that confirms the mission card was sent.
- **One new worker Edge Function `social-mission-runner`** (`verify_jwt=false`, scheduler-secret header, own Vault secret, one-minute cron). Each tick it claims due work through two SECURITY DEFINER claim RPCs:
  - `claim_social_mission_pulses(_limit)` — due, unsent, mission still LIVE, target SENT; `FOR UPDATE SKIP LOCKED`, stale reclaim, max attempts. Worker sends one small `sendMessage` reply with `reply_to_message_id` = the canonical card, never a photo, then queues a `social_mission_pulse` cleanup job at +120 s. If the cleanup job cannot be queued, the pulse is deleted immediately (same defence as Launch Watch CTA).
  - `claim_social_mission_expirations(_limit)` — missions LIVE with `ends_at <= now()`; returns mission/target/actor. Worker calls `social-mission-telegram` `edit_mission` with the internal header shape, actor `created_by`, `revision = edit_revision + 1`, deterministic `clientRequestId`. Status flips to `COMPLETED` **only after** a confirmed edit; AMBIGUOUS leaves the mission claimable-but-unresolved and never re-sends.
- **`/mission close`** — admin-only, inside `runMissionCommand`: resolve the caller's active LIVE mission for this chat through a new service-role-only RPC `close_social_mission_from_telegram` that re-authorizes exactly like the launcher (linked user → `is_workspace_operator` → exact chat binding), sets `ends_at = now()`, and lets the same runner path perform the single final edit. Zero X reads, zero duplicate posts, no second code path for completion.
- Pulse copy: short, natural-participation only ("The mission card is above — read it and add your own take if it resonates."). No points, quotas, mandatory likes/reposts, or counts.

## Allowlist (build phase)

Prepared SQL (not applied by Lovable):
- `docs/sql/SE4B_mission_lifecycle_pulse.sql` — NEW: `ends_at` default in the launcher RPC, `cleanup_kind` CHECK widening, `social_mission_pulses` table + RLS + grants, pulse seeding RPC, two claim RPCs, `close_social_mission_from_telegram`, Vault secret + `invoke_social_mission_runner` + cron entry.

Source:
- `backend-source/edge-functions/social-mission-runner/index.ts`, `deno.json` — NEW.
- `supabase/functions/telegram-webhook/index.ts` — EDIT: `/mission close` branch inside `runMissionCommand`, pulse seeding after confirmed send, `/help` line.
- `backend-source/edge-functions/social-mission-telegram/index.ts` — EDIT: accept the second internal source value only (one constant), nothing else.
- `scripts/se4b-mission-lifecycle-pulse-regression.ts` — NEW, fixture-only.
- `docs/SE4B_MISSION_LIFECYCLE_PULSE.md` — NEW.

## Prohibited

Applying any migration; deploying or publishing; any Telegram send; any X/provider read; `src/integrations/supabase/types.ts`; `package.json`/lockfile; any change to Launch Watch, Project Inbox, stickers, welcome/group-link, launch notification or cleanup-worker logic; new mission status values; any new auth bypass in the transport; broad refactors; touching the stale `backend-source/edge-functions/telegram-webhook/index.ts`.

## Order

1. Repo implementation + all regressions green (Lovable stop point).
2. You diff-review, then apply `SE4B_...sql` externally.
3. You deploy `social-mission-runner` and redeploy `social-mission-telegram` and `telegram-webhook`.
4. Create the Vault secret and the one-minute cron entry.
5. One controlled live mission as end-to-end proof.

## Tests to add

Fixture-only, zero network: pulse offsets exactly [3,8,15,25,35] and derived from `started_at`; unique `(mission_id, offset_minutes)` idempotency; pulse never uses `sendPhoto` and always sets `reply_to_message_id`; pulse cleanup job uses `cleanup_kind: 'social_mission_pulse'` at +120 s with immediate-delete fallback; `ends_at` default is 45 minutes; expiry path calls `edit_mission` exactly once with revision+1 and a deterministic request id, and never `send_mission`; COMPLETED written only after a confirmed edit; `/mission close` requires operator + exact chat binding and performs no X read; no `ACCOMPLISHED` string anywhere; widened CHECK still permits `launch_watch_cta`; plus existing SE-4A 127, SE-3 258, SE-3.1 86, SE-3.3L 51, tsgo, build.

## Blockers

1. **Checkpoint drift** above — needs your acceptance.
2. **Webhook parity split** — needs your ruling on which webhook file is authoritative.
3. Cron/Vault SQL has no repo precedent to copy; the new SQL will be written from the live pattern you described and must be diff-reviewed carefully before you apply it.
