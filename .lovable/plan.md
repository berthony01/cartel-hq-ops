# Sticker Drops regression: authoritative findings

Read-only investigation. No code, schema, data, or deployment changed.

## Verdict

Sticker Drops did not break. The schedule hit its **daily cap of 12 sends** at 15:15 UTC today and the scheduler has been correctly skipping ever since. The Community Welcome system is not implicated by any evidence.

## Evidence

Schedule `4db4261b-fe24-474c-bccd-eaae6b7fafd7` (workspace `311dfe4c…`, PEPE CARTEL COMMUNITY):

- `enabled = true`, `paused_reason = null`, `consecutive_failures = 0`
- `interval_minutes = 15`, `daily_cap = 12`, `active_start/end = 07:00:00 / 23:00:00`, `timezone = America/Chicago`
- `last_sent_at = 2026-08-29 15:15:04+00`
- `next_run_at = 2026-08-29 20:40:04+00`, `updated_at = 2026-08-29 19:40:05+00`

Events for `local_date = 2026-08-29`: **12 rows, all `status = sent`**, zero failed, zero skipped rows persisted. Newest send `telegram_message_id = 446` at 15:15:04 UTC. No `error_message` anywhere.

`sticker_drop_events` count = daily_cap = 12, so the worker takes this branch (`sticker-drops` snapshot, lines 179-191):

```text
count(sent events for group_connection_id + local_date) >= daily_cap
  -> update next_run_at = now + 60 minutes
  -> skipped, reason "daily_cap"   (no event row is written)
```

That explains the exact observed pattern: the row keeps being touched hourly (`updated_at` 19:40, `next_run_at` 20:40) while nothing posts and no error is recorded.

Everything else is healthy:

- `cron.job` id 1 `cartel-sticker-drops-runner`, `*/5 * * * *`, `active = true`, command `select public.invoke_sticker_drop_scheduler();`
- Last 12 `cron.job_run_details` entries (19:30 through 20:25 UTC) all `succeeded`
- `sticker_drop_workspace_controls` is **empty**, so no kill switch
- Group `7848baa3…` PEPE CARTEL COMMUNITY: supergroup, `bot_is_admin = true`, `verified_at = 2026-08-29 15:52 UTC` (verified *after* the last send, so the bot link is fine)
- Pack `68865971…`: `status = published`, `telegram_set_name = pepecartel_test_pack_68865971_by_PepeCartelHQBot`

## Why the Welcome work is not the cause

The welcome system added actions to `telegram-group` and a join handler to `telegram-webhook`. Neither writes `sticker_drop_*` tables, the cron job, `invoke_sticker_drop_scheduler`, or the vault secret, and the scheduler's own cron runs are all succeeding. The observed stop is fully explained by the cap branch, which is reached before any Telegram call is made.

## Smallest safe fix (choose one, requires your authorization)

1. **Do nothing.** Sending resumes automatically at the next local calendar day (`local_date` rolls over in America/Chicago), i.e. after 05:00 UTC tomorrow, within the 07:00-23:00 window.
2. **Raise the cap** if 12/day is simply too low. With `interval_minutes = 15` and a 16-hour window the schedule is theoretically capable of ~64 sends/day, so the cap is the real governor, not the interval. Raise `daily_cap` toward the desired volume (server bound is 24) via the existing Distribution Center schedule dialog — no SQL, no migration, no deployment.

## Optional follow-up (not required to restore posting)

The cap skip is invisible in the product: no event row and no UI signal, so it reads as "drops broke." A future presentation-only change could surface "daily cap reached, resumes tomorrow" in the Distribution Center by comparing today's sent count against `daily_cap`, which the status payload already returns. Out of scope for this investigation.

## Checks I could not make

None of the requested checks were blocked. `psql` env vars are absent in this sandbox, but the Supabase read-query tool answered items 1-5 directly; item 7 was answered from the committed `sticker-drops` snapshot rather than re-reading the deployed bundle.
