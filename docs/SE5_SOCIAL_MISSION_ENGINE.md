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

---

# SE-6 — tiers, crossing pulses, saved presets (reconciliation)

Repository implementation + prepared SQL only. No migration applied, no
function deployed, no publish, no Telegram send, no X call, no secret, no cron
change, no pinning.

1. **Real X metrics** — unchanged official-only path (`_shared/x-metrics.ts`):
   views/impressions, likes, reposts, replies (saves also stored). Unknown
   stays `NULL`.
2. **Central 5-minute refresh** — `refreshBucket()` floors to 5 minutes and
   `list_social_missions_due_for_metrics(_bucket, _limit)` skips any mission
   already snapshotted in that bucket. One read per mission per window,
   regardless of cron cadence or viewer count. HQ never calls a provider.
3. **One canonical card** — same PHOTO card, edited in place, gated on the
   visible signature; stable shared footer legend (`MISSION_FOOTER_LEGEND`).
4. **Pulse defaults** — +100 views, +10 likes, +5 reposts, +5 replies.
   `evaluate_social_mission_pulse` advances marks atomically (`FOR UPDATE`);
   first observation only seeds, partial gains carry forward, simultaneous
   crossings combine into ONE reply-only `sendMessage` cleaned up after 120s.
5. **Idempotent milestones** — `MISSION_ACTIVE`, `TIER_1..TIER_10`,
   `PROJECT_TRENDING`, `MISSION_CLOSING_SOON`, `MISSION_COMPLETED`, unique per
   `(mission_id, milestone_key)`.
6. **Admin presets** — `social_mission_presets`: named, reusable Tier 1-10
   target bundles with optional mission code, layered on the existing
   STANDARD/QUICK/MAJOR_ANNOUNCEMENT/LAUNCH shapes (adapted, not replaced).
   HQ gains a Saved Preset dropdown, tier editor, summary chips and Saved
   badge. Wallet targets deliberately absent.
7. **Performance history** — `finalize_social_mission_performance` writes one
   idempotent row per mission at completion, from stored snapshots only.
8. **X link status** — `OK | UNAVAILABLE | UNKNOWN`. A post the official API
   no longer returns is marked UNAVAILABLE and shown as "X link unavailable" in
   HQ; the mission lifecycle keeps running. A provider outage never marks it.

Auto-pin is now OFF unless a workspace opts in.

## Verification

`scripts/se6-mission-tiers-pulse-presets-regression.ts` — deterministic, zero
network, zero database, zero Telegram, zero X.

## External operations still pending (separate approval gate)

1. Secret `X_API_BEARER_TOKEN`.
2. Apply `docs/sql/SE5_social_mission_engine.sql`, then
   `docs/sql/SE6_mission_tiers_pulse_presets.sql`.
3. Deploy `_shared/x-metrics.ts` **and** `_shared/mission-progress.ts`
   alongside `social-mission-runner` and `social-mission-telegram`, then
   redeploy `telegram-webhook`.
