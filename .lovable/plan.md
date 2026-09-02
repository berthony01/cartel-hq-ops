# Phase 1 — Community Command Architectural Audit (read-only)

No files, schema, rows, functions, secrets or settings were changed. Inspection used file reads plus read-only SQL.

## A. Executive summary

Exists today:
- Telegram community connection, health, onboarding/welcome, Launch Watch CTA card, Sticker Drops scheduling, one-off sticker sends.
- Launch Watch opt-in via bot deep link, per-watcher preferences (watch on/off, countdowns, project updates), aggregate-only counts in the browser.
- A durable DM pipeline: `launch_events` -> `launch_notification_deliveries` -> `launch-notifications` worker, with claim/retry/ambiguous semantics.
- Manual operator DM broadcast ("Watcher Updates") — already live in DB and UI (1 `WATCHER_UPDATE` event exists in production).

Does not exist today:
- Any launch date/time change notification (no trigger, no event type).
- Any custom **group** broadcast composer (group posting is limited to welcome, sticker sends, and Sticker Drops).
- Scheduled/queued or draft messages, audience segmentation beyond the two preference flags, per-recipient delivery detail UI, or a subscriber management surface.
- A unified "Community Command" dashboard: messaging is split across `/telegram` (group) and `/launch-control` (DM), with no shared history view.

## B. Frontend flow map

- `src/routes/_authenticated/telegram.tsx` — "Community Command". Connection health tiles only; delegates everything to `TelegramGroupCard`.
- `src/components/cartel/TelegramGroupCard.tsx` (1181 lines) — per-community rows, readiness, pack assignment/distribution, test send, entry to welcome settings.
- `src/components/cartel/CommunityWelcomeDialog.tsx` (698 lines) — welcome message, auto-delete, Launch Watch CTA selection + link toggles + CTA lifetime.
- `src/routes/_authenticated/distribution.tsx` + `StickerDropScheduleDialog.tsx` — recurring sticker posting.
- `src/routes/_authenticated/launch-control.tsx` (2186 lines) — lifecycle transitions, schedule fields, contract registration, Launch Watch section, and the **Watcher Updates** composer + aggregate history.
- `src/routes/_authenticated/watchlist.tsx`, `src/lib/watchlist.ts` — the end-user's own watch list (read-only, aggregate/private-safe).
- Client libs: `src/lib/launch-control.ts`, `src/lib/telegram-group.ts`, `src/lib/telegram-link.ts`, `src/lib/sticker-drops.ts`.
- Nav (`src/lib/nav.ts`) puts Community Command and Sticker Drops under "Community" and Launch Control under "Command" — the DM channel is therefore not discoverable from Community Command.

## C. Backend / system-of-record map

Tables: `telegram_group_connections`, `telegram_community_settings`, `telegram_connections`, `telegram_link_requests`, `telegram_beta_contacts`, `telegram_message_cleanup_jobs`, `launches`, `launch_events`, `launch_watch_subscriptions`, `launch_notification_deliveries`, `sticker_drop_schedules` / `_events` / `_workspace_controls`, `project_profiles`.

Edge functions: `telegram-webhook` (public), `telegram-link`, `telegram-group`, `launch-notifications` (public, secret-header), `telegram-message-cleanup` (public, secret-header), `sticker-drops`, `sticker-drop-config`, `platform-admin`. Config in `supabase/config.toml`.

Key DB functions (verified live): `enqueue_launch_lifecycle_notification_events` (trigger `launches_enqueue_notification_events`), `enqueue_launch_event_deliveries`, `enqueue_due_launch_reminder_events`, `claim_launch_notification_deliveries`, `mark_stale_launch_notification_claims`, `create_launch_watcher_update`, `get_launch_watcher_update_stats`, `list_launch_watcher_updates`, `get_launch_watch_summary`, `get_launch_watch_confirmation_summary`, `get_launch_notification_summary`, `transition_launch_status`, `set_launch_contract_address`, `enforce_launch_update_rules`.

Schedulers: `cartel-launch-notifications-runner` (1 min), `cartel-telegram-message-cleanup-runner` (1 min), Sticker Drops runner (5 min).

## D. Watcher lifecycle

1. Token: immutable 24-hex `launches.launch_watch_token` minted only on ANNOUNCED -> WATCHLIST_OPEN (enforced in `enforce_launch_update_rules`).
2. Opt-in: `https://t.me/PepeCartelHQBot?start=lw_<token>` handled in `telegram-webhook/index.ts` (~line 1519). Requires published profile + open lifecycle status.
3. Stored identity: only `telegram_user_id` (bigint) + `launch_id`, unique per pair; no username, no app user id. RLS: **zero policies**, all client access denied — browser sees aggregates only.
4. Preferences: `is_active`, `reminders_enabled`, `updates_enabled`. Inline keyboard callbacks `lw_unwatch_`, `lw_rewatch_`, `ln_reminders_off/on_`, `ln_updates_off/on_`.
5. Opt-out is soft (`is_active=false`, `unsubscribed_at`), history preserved; rewatch does not backfill past events.
6. DM reachability: not tracked as a first-class field. It is inferred only from `launch_notification_deliveries.status`/`error_class` (`telegram_rejected`) and from confirmation columns (`confirmation_status`, `confirmation_error_class`) surfaced by `get_launch_watch_confirmation_summary`.

## E. Launch-update lifecycle — what happens if the date changes

**Nothing is sent.** `launches_enqueue_notification_events` fires only on `status` change and only for `OFFICIAL_CONTRACT_REGISTERED` and `LIVE`. Schedule columns (`launch_at`, `launch_window_start/end`, `timezone`) have no notification trigger.

Secondary effect only: `launch-notifications` revalidates reminders against current schedule and **skips** with `schedule_changed` when the queued reminder drifts >60s from the new anchor; `enqueue_due_launch_reminder_events` then re-derives 24h/1h reminders from the new time inside a 15-minute due window. So a date change silently re-times countdowns and never informs watchers. The only way to tell watchers today is for the operator to hand-write a Watcher Update.

## F. Custom messaging capability — exact state

- Private DM broadcast: **exists**. `src/routes/_authenticated/launch-control.tsx` "Watcher Updates" -> `createLaunchWatcherUpdate` (`src/lib/launch-control.ts:494`) -> RPC `create_launch_watcher_update` -> `launch_events(event_type='WATCHER_UPDATE', source='operator')` -> fan-out trigger -> worker `WATCHER_UPDATE` branch (`backend-source/edge-functions/launch-notifications/index.ts`). Title <=120, body <=2200, HTML-escaped, idempotent per `client_request_id`, 60s anti-spam + 20/24h cap, row-locked on the launch.
- Group broadcast: **does not exist**. Group posting is only welcome messages, `send_group_test`, `distribute_pack`, and Sticker Drops.

## G. History and observability

- Watcher Updates: `list_launch_watcher_updates` returns title/body/created_at + aggregate pending/sent/failed/ambiguous/skipped counts, rendered in Launch Control. No per-recipient view (by design).
- Reminder/lifecycle DMs: no history UI at all; only `get_launch_notification_summary` aggregates.
- Group messages: no history table or UI; `telegram_message_cleanup_jobs` tracks only scheduled deletions.
- No scheduled/draft messages, no send-time preview archive, no export.

## H. Authorization

- Watcher update send: `is_workspace_operator` inside SECURITY DEFINER RPC; also requires open lifecycle + published profile.
- Aggregate reads: `is_workspace_member`.
- Group actions: JWT-verified `telegram-group` / `sticker-drop-config` with workspace checks; `telegram_group_connections` and `telegram_community_settings` are select-only from the browser.
- Public functions (`telegram-webhook`, `launch-notifications`, `telegram-message-cleanup`) use `verify_jwt=false` + secret/derived-token checks; queue tables are service-role only.
- Platform owner surfaces gated by `is_platform_owner` / `has_platform_unrestricted_access` and the `platform-admin` function.

## I. Gaps (ranked)

Critical
1. No date/time-change notification path — the single highest-value missing watcher signal.
2. Messaging is architecturally split with no Community Command home; operators cannot see "what did we send, where, to whom, when" in one place.

High
3. No group broadcast/announcement composer; group and DM channels share no message abstraction.
4. No unified message history/observability across DM + group + drops.
5. `updates_enabled` is backfilled FALSE for pre-L2A watchers, so the DM audience is silently smaller than "active watchers" with no operator-facing remediation flow.

Medium
6. No scheduling/drafts, no audience segmentation beyond two boolean flags, no subscriber management surface.
7. No explicit DM-reachability field; blocked users are only discoverable by reading delivery error text.
8. Naming drift: "Community Command" (groups) vs "Watcher Updates" (DMs) vs "Launch Watch" vs "Sticker Drops" — four vocabularies for one communications domain.

Low
9. Duplicated webhook source (`backend-source/edge-functions/telegram-webhook` and `supabase/functions/telegram-webhook`) kept byte-identical by hand.
10. `telegram_beta_contacts` is a legacy/parallel contact store not used by the launch pipeline.

## J. Reuse recommendations for Phase 2+

Preserve and build on, do not replace: the `launch_events -> enqueue_launch_event_deliveries -> launch_notification_deliveries -> launch-notifications` queue (claim/skip/retry/ambiguous semantics are the hard-won part); the event-type + payload-JSON extension point (a date-change event is a new `event_type`, not a new pipeline); `create_launch_watcher_update`'s idempotency/anti-spam/lock pattern as the template for any new operator send; `telegram_message_cleanup_jobs` for any timed group post; the aggregate-only RPC pattern for every new count; `TelegramGroupCard` / `CommunityWelcomeDialog` as the per-community control surface a dashboard should embed rather than duplicate.

## K. Could not verify

- Deployed Edge Function versions, their exact deployed source, and live `verify_jwt` values (the deploy tool exposes no read-back; repo source is the only side I can hash).
- Live cron job definitions/schedules (`cron.job` not inspected in this turn).
- Actual Telegram-side behaviour (no invocation performed).
- Whether the deployed `launch-notifications` build contains the `WATCHER_UPDATE` branch — production has 1 `WATCHER_UPDATE` event and 1 delivery row, which is consistent with it, but not proof of delivery.
- Runtime rendering/UX of any screen (no browser session run).
