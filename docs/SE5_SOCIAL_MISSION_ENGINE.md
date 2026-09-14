# SE-5 — CARTEL SOCIAL mission engine (Step 1 completion)

Repository implementation + prepared SQL only. Lovable did **not** apply the
migration, deploy any function, publish, send a Telegram message, call X, or
create a secret.

## What SE-5 adds

1. **Live official X metrics.** Exactly one endpoint is ever contacted:
   `GET https://api.x.com/2/tweets?ids=<=100&tweet.fields=public_metrics,created_at,author_id`.
   Mapping is exact — `impression_count→views`, `like_count→likes`,
   `reply_count→comments`, `retweet_count→shares`, `bookmark_count→saves`.
   `quote_count` is deliberately excluded. A metric the provider omits stays
   `NULL`; nothing is ever coerced to `0`.
2. **Mission Card 2.0.** The same branded PHOTO card, edited in place, now shows
   the results block (or "Live metrics updating…"), the milestone progress line,
   and `Status: LIVE · ~Nm remaining` / `Status: ACCOMPLISHED`.
3. **Command cleanup and auto-pin.** After a *confirmed* send the raw `/mission`
   command is deleted (setting-gated) and the card is pinned (default ON). Only
   a card HQ pinned is ever unpinned. A member's own post is never deleted.
4. **Pulse 2.0.** Reply-only `sendMessage`, built from the **latest stored
   snapshot**, never from a live fetch, with the existing 120-second cleanup.
5. **Milestones.** `NONE | VIEWS | LIKES | REPLIES | REPOSTS |
   TOTAL_INTERACTIONS` against a positive absolute target. First accomplishment
   only, recorded as `social_missions.accomplished_at`. No reward mechanic.
6. **Presets.** `STANDARD 45/[3,8,15,25,35]`, `QUICK 20/[2,5,10,15]`,
   `MAJOR_ANNOUNCEMENT 120/[5,15,30,60,90]`, `LAUNCH 60/[3,8,15,30,45]`.
7. **Workspace settings.** One table, member SELECT, owner/admin INSERT/UPDATE.
   The effective configuration is **snapshotted onto the mission at launch**, so
   changing settings never rewrites a mission in flight. Historical missions with
   no snapshot fall back to STANDARD.
8. **X Link Finder.** A human sharing one of the workspace's **own official**
   X posts in a connected group produces an expiring, idempotent candidate and a
   START / IGNORE prompt. It never starts a mission by itself; START reuses the
   existing authorized `/mission` path with `_source = telegram_link_finder`.
9. **HQ surface.** Missions stay READ-ONLY (ACCOMPLISHED badge added) plus an
   editable Mission defaults card. Creation and closing remain Telegram-only.

## Invariants preserved

* Database lifecycle stays `LIVE → COMPLETED`. ACCOMPLISHED is derived.
* One snapshot per `(mission, provider, poll_bucket)`; baseline written once.
* Telegram is edited **only** when the visible signature changes
  (`STATUS|A|v|l|c|s|sa`, `n` for unknown), so an unchanged minute costs zero
  Telegram calls.
* Existing one-minute `cartel-social-mission-runner` cron and the existing
  cleanup worker are reused. No second scheduler.
* No browser polling, no OAuth, no billing, no rewards, no contributor
  recognition, no service role in the browser.

## External prerequisites (NOT performed here)

* Secret `X_API_BEARER_TOKEN` must be added to the external Supabase project by
  someone with permission. Without it the metrics phase is fail-soft: no
  snapshot, no card edit, no user-visible error.
* Apply `docs/sql/SE5_social_mission_engine.sql`, then deploy
  `supabase/functions/_shared/x-metrics.ts` alongside `social-mission-runner`
  and `social-mission-telegram`, then redeploy `telegram-webhook`.

## Verification

`scripts/se5-social-mission-engine-regression.ts` — deterministic, zero network,
zero database, zero Telegram, zero X.
