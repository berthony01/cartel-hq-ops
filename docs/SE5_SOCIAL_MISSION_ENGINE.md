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
   a card HQ pinned is ever unpinned. SE-7 supersedes the original "a member's
   own post is never deleted" rule for Link Finder only: after an authorized
   START reaches a confirmed card plus an active schedule, the original X-link
   post is deleted (mandatory, not setting-gated). IGNORE never deletes it.

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

## Step 1 authoritative reconciliation (supersedes the withdrawn SE-6 tier direction)

The tier/threshold/5-minute SE-6 direction was **withdrawn**. Its surfaces are
deleted from the repository: `_shared/mission-progress.ts`,
`docs/sql/SE6_mission_tiers_pulse_presets.sql`, the tier regression script,
`social_mission_presets`, pulse-mark and tier-milestone machinery, and the
separate performance-history table. Nothing in the mission cone references
them. The frozen Step 1 contract below is authoritative.

### Contract as implemented

1. **Official X metrics.** One fail-soft read before the first canonical card,
   then centralized refresh by the existing ONE-MINUTE runner. Batches of at
   most 100 post ids. One snapshot per mission per minute bucket
   (`social_metric_snapshots` unique on mission/provider/bucket). Unknown stays
   NULL, never a false zero. Pulses never cause a paid read.
2. **Canonical card.** Branded PHOTO card, same-message edits only, edited only
   when the stored metric/state signature actually changed. Raw `/mission` is
   deleted only after a confirmed send; only a pin CARTEL HQ recorded is
   unpinned. Auto-pin defaults ON unless a persisted setting says otherwise.
3. **Pulse 2.0 — preset time cadence, kept.** STANDARD 45m at 3/8/15/25/35;
   QUICK 20m at 2/5/10/15; MAJOR_ANNOUNCEMENT 120m at 5/15/30/60/90; LAUNCH 60m
   at 3/8/15/30/45. Each pulse is one reply-only `sendMessage`, auto-deleted
   after 120s, built from the LATEST STORED snapshot plus optional milestone
   progress and an approximate remaining time — with ZERO provider reads. The
   copy lives in the pure `_shared/mission-pulse-copy.ts` module.
4. **State.** ACTIVE -> ACCOMPLISHED -> COMPLETED. The milestone is optional and
   project-defined; a missing milestone is not a failure. No points, badges,
   rewards or payouts are tied to engagement.
5. **X Link Finder sequencing (fixed).** READ-ONLY
   `peek_social_mission_link_candidate` -> live Telegram `getChatMember`
   verification in the candidate's OWN chat -> only then the consuming
   `resolve_social_mission_link_candidate`, which now REQUIRES the verified chat
   id and revalidates operator authority itself. A denied or non-admin tap
   mutates nothing and leaves the candidate PENDING.
6. **Settings.** One workspace-scoped system with the four presets. The
   effective config is snapshotted into the mission at launch and is immutable
   afterwards; pulses and the due-list read that frozen snapshot.
7. **History/Summary.** Built from the EXISTING mission, target, schedule and
   snapshot tables — no duplicate subsystem. The customer surface shows a
   bounded stored-metric history and, for completed missions, final values,
   baseline-to-final change where both ends are known, and duration.
8. **Manual close final reading.** `/mission close` takes a best-effort final
   official read BEFORE the completion card renders, skipped entirely when the
   current minute bucket already has a snapshot, and fail-soft so the close
   always completes.

### Internal usage telemetry

`record_social_mission_metric_snapshot` writes one `usage_ledger` row
(`action_type = 'social_x_tracked_post_read'`, `units = 1`) ONLY when a new
snapshot row was actually inserted, so retries cannot multiply it. This is
**operational telemetry, not billable usage and not an exact invoice cost** —
the official batch endpoint reads up to 100 posts per HTTP call and that cost
cannot be truthfully split per workspace. No dollar pricing is encoded.

### Rollout sequence (requires explicit approval; nothing was applied)

1. Set the server secret `X_API_BEARER_TOKEN`.
2. Apply `docs/sql/SE5_social_mission_engine.sql`.
3. Apply `docs/sql/SE6_step1_reconciliation.sql`.
4. Deploy `_shared/x-metrics.ts` and `_shared/mission-pulse-copy.ts` with
   `social-mission-runner` and `social-mission-telegram`.
5. Redeploy `telegram-webhook`.

Until step 5 completes, the Link Finder buttons must not be exposed against the
new resolver signature: the webhook and the SQL change together.
