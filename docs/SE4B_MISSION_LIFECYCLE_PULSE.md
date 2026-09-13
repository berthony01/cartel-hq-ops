# SE-4B — Social Mission lifecycle + Mission Pulse

Community Command Center Phase 1B. Repository implementation only: no SQL was
applied, no function was deployed, no Vault secret was created, no cron job was
scheduled, no Telegram message was sent and no X API call was made.
`docs/sql/SE4B_mission_lifecycle_pulse.sql` is PREPARE ONLY and is applied
externally after diff review.

## What this phase adds

1. A durable 45-minute mission window anchored to **confirmed** delivery of the
   canonical branded card.
2. Five lightweight, ephemeral Mission Pulses.
3. Automatic completion at 45 minutes, plus an admin-only `/mission close`.

## Authoritative lifecycle rule (database-first)

The database lifecycle is authoritative. On automatic expiry or `/mission close`
the mission is transitioned to `COMPLETED` (with `completed_at`) **first**, and
exactly one idempotent same-message Telegram edit is attempted afterwards.

If that edit fails or is ambiguous, the completion is **not** reverted and no
replacement message is ever sent. The delivery-sync state is surfaced durably on
the completion event (`state` = `SENT`, `FAILED` or `AMBIGUOUS`, plus a bounded
`last_error`). This is intentional: the renderer builds the card from the
authoritative mission status, so mission status must lead, not follow.

## Timing

| Event | When |
| --- | --- |
| Mission start | `social_mission_targets.sent_at` (confirmed card delivery) |
| `ends_at` | `sent_at + 45 minutes` |
| Pulses 1–5 | `sent_at` + 3, 8, 15, 25, 35 minutes |
| Completion | `sent_at + 45 minutes` |

`started_at` is preserved if it was already set; `ends_at` is only written when
it is still null, so re-activation is a safe no-op.

## Schedule table

`public.social_mission_schedule_events` — one table for both event kinds.

* `event_type` ∈ `PULSE` | `COMPLETE`; `sequence_no` 1–5 for pulses, 1 for
  completion; unique on `(target_id, event_type, sequence_no)`.
* `state` ∈ `PENDING` | `CLAIMED` | `SENT` | `FAILED` | `AMBIGUOUS` |
  `CANCELLED`.
* `client_request_id` is generated once at seeding and reused by the completion
  edit, so a reclaimed stale completion produces a duplicate the transport
  absorbs instead of a second edit.
* Composite workspace FKs to both the mission and the target, RLS enabled and
  forced, workspace members may `SELECT` only. No browser write path exists.

## RPCs (service-role only)

| Function | Purpose |
| --- | --- |
| `activate_social_mission_schedule(_mission_id, _target_id)` | Re-checks binding, `SENT` delivery and LIVE status; sets `ends_at`; seeds 5 pulses + 1 completion idempotently. |
| `claim_due_social_mission_schedule_events(_limit)` | Retires stale CLAIMED pulses as `AMBIGUOUS`; claims due completions by completing the mission and cancelling remaining pulses; claims due pulses only while LIVE/SENT; returns authoritative binding data. |
| `finish_social_mission_schedule_event(...)` | Narrow finalizer: only `CLAIMED` → `SENT`/`FAILED`/`AMBIGUOUS`. `AMBIGUOUS` is terminal. |
| `close_social_mission_from_telegram(chat_id, user_id)` | Re-authorizes chat binding, linked account and workspace operator; completes at most one LIVE mission for that exact community; cancels pending pulses; returns the single completion event. |

### Concurrency and terminal states

`claim_due_social_mission_schedule_events` returns only the event ids that the
calling invocation itself claimed, collected from the `RETURNING` clause of its
own claiming updates. Ownership is never inferred from a timestamp window, so
two overlapping runner invocations can never process the same pulse or
completion. A stale `CLAIMED` completion may be reclaimed after five minutes
solely because the downstream edit is idempotent by the SAME stored
`client_request_id`; no event is created and no request id is rewritten.

`/mission close` never reopens a terminal event. Outcomes:

| Completion event state | Close outcome |
| --- | --- |
| missing | created `PENDING`, then claimed |
| `PENDING` | claimed |
| `SENT` | `ALREADY_COMPLETED` (already synced) |
| `CLAIMED` | `UNRESOLVED` — another worker holds it; no state change, no retry |
| `FAILED`, `AMBIGUOUS`, `CANCELLED` | `COMPLETED_UNSYNCED` — terminal; no state change, no retry |

Manual close is attributed to the **current** authorized closer, who just passed
both the Cartel HQ operator check and the live Telegram administrator check.
Automatic completion continues to use `mission.created_by` and fails closed if
that account no longer qualifies.

After its single edit attempt, the manual close finalizes its own completion
event exactly once (`EDITED` → `SENT`, explicit `FAILED` → `FAILED`, anything
else → `AMBIGUOUS`), so the runner never picks it up again. If the finalizer
itself fails, the mission stays closed, nothing is retried and nothing is
replaced; the admin gets a sync diagnostic.

## Pulse

`sendMessage` only, replying to the canonical card's `message_id`, with a single
`OPEN ON X` button built from the authoritative `social_posts.canonical_url`.
Never `sendPhoto`, never a resend of the branded card, no metrics, no quotas,
points, rewards or mandatory engagement. A confirmed pulse is queued into the
existing `telegram_message_cleanup_jobs` table with
`cleanup_kind = 'social_mission_pulse'` and `delete_after = sent_at + 120s`; the
existing cleanup worker is unmodified and only its `cleanup_kind` CHECK was
widened. Because that worker runs once per minute, a pulse disappears roughly
120–180 seconds after it is posted.

Pulses are never retried. An ambiguous send is recorded `AMBIGUOUS`, a definite
rejection `FAILED`. Losing an ephemeral pulse is safer than duplicate spam. If
the cleanup job cannot be queued after a confirmed send, the runner makes one
immediate delete attempt and nothing else.

## Runner

`backend-source/edge-functions/social-mission-runner/index.ts`, deployed
externally with `verify_jwt=false`. It is cron-only and authenticates through
the `x-cartel-social-mission-scheduler-secret` header, compared solely inside
the database by `social_mission_scheduler_secret_matches`. The secret is never
logged or returned. Invocation follows the established Vault +
`net.http_post` + `pg_cron` one-minute pattern.

## Transport auth

`social-mission-telegram` now recognises an exact allowlist of two internal
callers: `telegram-webhook` and `social-mission-runner`. Both still require the
exact service-role bearer token and a UUID actor, and both still pass every
existing owner/admin, workspace-binding and live-group check. The JWT path and
all action semantics are unchanged.

## Deploy order (external, yours)

1. Diff-review and apply `docs/sql/SE4B_mission_lifecycle_pulse.sql`.
2. Deploy `social-mission-runner` (`verify_jwt=false`).
3. Redeploy `social-mission-telegram` and `telegram-webhook`.
4. Confirm the Vault secret and the `cartel-social-mission-runner` cron entry.
5. Run one controlled live mission as end-to-end proof.

## Out of scope (Phase 2)

No `ACCOMPLISHED` status, no milestone automation, no `/mission refresh` or
`/mission latest`, no X OAuth or X Activity, no contributor recognition, no
billing and no polling.
