# SE-0 — Cartel Social Engine Architecture Lock

Status: **FROZEN (documentation only)**
Phase: SE-0
Start gate commit: `f0d1d53638faebdf36d818fbe8255c620dcf23e0`
Scope of this turn: this file only. No schema, no runtime, no provider, no Telegram, no dependency change.

This document freezes the provider-neutral foundation for **Cartel Social Engine** and
**Cartel Missions** so later work can proceed in small controlled slices without
duplicating existing CARTEL HQ infrastructure and without locking the product to a
single external vendor.

External Supabase `ocoinbnjgstkmnwwvnhi` remains the ONLY backend system of record.
Existing Telegram bot/community infrastructure remains authoritative.

---

## 1. Current-state reuse map (REUSE, do not rebuild)

The following already exist and are authoritative. Any later SE phase must reuse them:

- **Workspace multi-tenant isolation** — `workspaces`, `workspace_members`.
- **Canonical project identity** — `project_profiles`.
- **Official Telegram community connections** — `telegram_group_connections`.
- **Telegram community settings and bot/admin verification** — existing verification of
  bot presence, admin rights and group operability.
- **Official Community Broadcast architecture** — including the
  `telegram_group_announcements` durability/idempotency pattern.
- **Server-side Telegram bot token** and the single official bot `@PepeCartelHQBot`.
- **Delivery semantics** — existing SENT / FAILED / AMBIGUOUS outcome handling.
- **Telegram `message_id` persistence pattern** for later edit addressing.
- **`ai_jobs` provider/job pattern** for asynchronous provider-backed work.
- **`usage_ledger`** with `provider_cost` and `internal_cost`.
- **Server-side provider-secret pattern** established by the Sticker AI / KIE integrations.

### New dependency cone (does NOT exist yet)

- social sources / account-monitoring model
- normalized social-post model
- provider-neutral social-read adapter layer
- Cartel Mission lifecycle
- social metric snapshots / history
- mission-to-Telegram target and edit lifecycle
- live Telegram mission-message editing

Everything in that list is new construction and must be introduced only through the
phased roadmap in section 11.

---

## 2. Product scope — V1 IN SCOPE

- Public social **monitoring / read** capability only.
- Target public networks: **X, Instagram, TikTok, YouTube, Facebook**.
- Detect / import public posts from configured project social sources.
- Normalize posts into one internal shape.
- Start **Cartel Missions** for selected posts.
- Send one mission card to one or more **existing** connected Telegram communities.
- Track available public post metrics during a mission.
- Update the **same** Telegram mission message where possible, rather than posting
  repeated new messages.
- Finalize the same card into a mission-complete report.
- Persist mission history and metric snapshots in CARTEL HQ (later implementation phases).
- Meter actual external-provider usage and cost from day one.

## 3. Product scope — V1 OUT OF SCOPE / FORBIDDEN

- No social OAuth or account publishing.
- No posting to X / Instagram / TikTok / YouTube / Facebook from CARTEL HQ.
- No automated likes, reposts, comments, replies, follows, bookmarks, or any other
  automated social engagement action.
- No customer rewards, points or tokens for social engagement.
- No per-user proof that a specific person liked / reposted / commented.
- No engagement quotas required to complete a mission.
- No second Telegram bot.
- No new Telegram group-connection system.
- No customer billing / Stripe work in SE-0 or the V1 foundation.
- No claim that Telegram caused metric growth. Reports present **observed deltas during
  the mission window** unless attribution is independently proven.

---

## 4. Provider-neutral architecture

Two **conceptually distinct** capability interfaces are frozen here. No implementation
code is written in this phase.

### 4.1 `SocialReadProvider`

Responsibilities:

- capability / platform support discovery
- normalize a configured public source
- fetch recent posts for a public source
- fetch a specific post by canonical URL or external id
- fetch public metrics for a post
- return normalized provider-result metadata, including billable / success status where known

### 4.2 Future `SocialPublishProvider` (reserved, later phase)

Responsibilities (NOT built in V1):

- OAuth / account connection
- publish, schedule or delete where the platform permits
- authenticated account analytics and actions

### 4.3 Security boundary invariant

**NEVER combine public-read/scraping capability and authenticated write capability into
one security boundary merely because a single vendor offers both.** Read adapters and
publish adapters remain separate interfaces, separate credentials, and separate
authorization surfaces, even if one vendor is eventually used for both.

---

## 5. Provider posture

The architecture must support **provider routing by platform and capability**, and
**provider replacement without schema rewrite**. Provider identity is data, not structure.

Initial candidate posture:

- **X** — prefer the direct official X API for X public reads where practical, because the
  current pricing model is usage-based and it avoids an unnecessary aggregator dependency.
- **Instagram / TikTok / YouTube / Facebook public monitoring** — **Refetcher** is the
  leading V1 candidate because its published model is pay-as-you-go with no monthly
  subscription or minimum. It is a public scraping provider and **must remain replaceable**.
  Production approval requires a fresh provider and platform-policy review.
- **Future authenticated publishing / OAuth** — bundle.social, native platform APIs, or
  another provider remain future options. **No publishing provider is selected or
  integrated in SE-0.**
- **Ayrshare / Unified.to** are not the preferred pre-launch foundation, because fixed
  monthly commitments conflict with CARTEL HQ's desired usage-based cost posture.

### Pricing posture caveat

Today's prices are **not** permanent architecture. Any rate or pricing tier recorded in
research notes is a **non-authoritative snapshot** and must be **reverified before
procurement or integration**. No pricing figure in any SE document constitutes a frozen
commercial decision.

---

## 6. Normalized metrics contract

Canonical metrics, all **nullable**:

- `views`
- `likes`
- `comments`
- `shares`
- `saves`

Rules:

- `null` means unavailable / unsupported / unknown. **Never convert unavailable data to zero.**
- Preserve provider and platform specific availability metadata alongside the values.
- Mission reports show only metrics actually available for that platform/provider.
- Baseline and final values must both be stored so deltas are reproducible.

---

## 7. Mission lifecycle

Conceptual lifecycle:

```text
DRAFT -> LIVE -> COMPLETED
```

Terminal / exception states: `CANCELLED`, `FAILED`.

Required flow:

1. Discover or import a public post.
2. Create / review the mission.
3. Fetch baseline metrics.
4. Select existing Telegram community target(s).
5. Create one durable target / send intent per community.
6. Send one mission card and record the Telegram `message_id`.
7. Poll metrics while LIVE, under cost and rate guardrails.
8. Update the **same** Telegram message using durable, idempotent edit semantics.
9. Take a final snapshot at mission end.
10. Finalize the same card into the completed report.
11. Preserve mission history in CARTEL HQ.

**No individual-member engagement tracking at any step.**

---

## 8. Proposed future data model — DESIGN ONLY, DO NOT MIGRATE

These are architecture proposals for SE-1. They are **not** live schema and must not be
applied in SE-0.

### `social_sources`

- `id` uuid
- `workspace_id` uuid FK
- `platform` enum/text constrained to supported platforms
- `source_type` — `public_profile` first; future `oauth_account`
- `canonical_url`
- `handle` nullable
- `external_account_id` nullable
- `provider_preference` nullable / config-driven
- `auto_detect_enabled` boolean
- `polling_interval_seconds` / polling policy
- `last_checked_at` nullable
- `provider_cursor` / `last_external_post_id` nullable
- `metadata` jsonb
- `created_at` / `updated_at`
- tenant-safe unique constraint preventing duplicate registration of the same source

### `social_posts`

- `id`
- `workspace_id`
- `social_source_id`
- `platform`
- `external_post_id`
- `canonical_url`
- author / display identity snapshot
- text / title / caption snapshot, as permitted
- `media_type`
- `published_at`
- `metadata`
- unique `(workspace_id, platform, external_post_id)`

### `social_missions`

- `id`
- `workspace_id`
- `social_post_id`
- `status`
- `baseline_metrics` jsonb or explicit normalized nullable fields
- `started_at`
- `ends_at`
- `completed_at`
- mission copy / prompt fields
- `created_by`
- timestamps

### `social_mission_targets`

- `id`
- `workspace_id`
- `mission_id`
- `group_connection_id` FK to the EXISTING `telegram_group_connections`
- Telegram `message_id`
- delivery / edit state
- `last_error`
- `sent_at` / `updated_at`
- unique `(mission_id, group_connection_id)`

### `social_metric_snapshots`

- `id`
- `workspace_id`
- `mission_id`
- `provider`
- `observed_at`
- nullable `views` / `likes` / `comments` / `shares` / `saves`
- platform / provider availability metadata
- minimal raw metadata only where genuinely needed for audit/debug
- idempotency / bucket constraint preventing duplicate **charged** snapshots for the same
  mission + provider + poll bucket

### Usage ledger reuse

Do **not** create a separate generic cost ledger unless a later SE-1 audit proves it
necessary. Prefer extending the existing `usage_ledger` minimally (for example
provider / reference metadata / idempotency fields).

Frozen accounting semantics:

- `provider_cost` = actual vendor/API cost CARTEL HQ incurred.
- `internal_cost` = CARTEL HQ's own compute/processing cost, if measured.
- **Neither field is a customer price or revenue figure.**
- Any future customer charge, credit or markup is a separate monetization concern, so
  accounting truth is preserved.

---

## 9. Roles / privilege matrix

- **Workspace owner / admin** — manage sources, manage auto-detect settings, create /
  start / cancel missions, select connected Telegram targets.
- **Ordinary workspace member** — read-only mission and social dashboard by default. No
  writes that trigger external-provider calls unless a future role explicitly grants it.
- **Service role / worker only** — provider API calls, provider secrets, metric writes,
  cost-ledger writes, polling jobs, Telegram send/edit transport.
- **Browser** — must never receive provider secrets, the Telegram bot token, the
  service-role secret, or any internal provider credential.

---

## 10. Telegram reuse boundary

Reuse current community authorization/verification and durable delivery principles in full.

New capability required later: a controlled `editMessageText` / `editMessageCaption`
equivalent for existing mission messages.

Frozen invariants:

- Do **not** silently create a replacement Telegram message when an edit outcome is ambiguous.
- Durable edit intent and idempotency must prevent duplicate or reordered updates.
- One mission target maps to exactly one primary Telegram mission message.
- The target community must belong to the same workspace as the mission.
- The bot must still be live and authorized at execution time.
- The mission subsystem must not weaken current Official Community Broadcast behavior.

### Deferred transport decision (SE-3 criterion)

SE-0 does **not** decide whether the implementation extends `telegram-group` or uses a
narrowly separate mission worker/function.

**SE-3 decision criterion:** reuse the existing transport engine if it can be done
without making the mature broadcast function dangerously complex; otherwise build a
narrow mission transport function that **reuses its auth, verification and idempotency
patterns** rather than reinventing them.

---

## 11. Polling and cost guardrails

- Conservative source-discovery polling; default target approximately **15 minutes**,
  configurable within safe bounds later.
- Active mission metric polling may run more frequently than source discovery, but never
  faster than required, and always subject to per-provider/platform limits and cost caps.
- Cache and dedupe by canonical post and poll bucket.
- One provider fetch may fan out to multiple Telegram target groups.
- Stop active polling once a mission reaches a terminal state, except for an explicit
  manual refresh.
- Exponential / adaptive backoff after provider failure or rate limiting.
- Per-workspace request and cost ceilings before multi-tenant scale.
- **No external provider call from normal page rendering.**
- Provider usage ledger entries must be idempotently linked to the operation or snapshot
  that incurred them.
- A provider failure that is not billable must **not** be recorded as provider cost.

---

## 12. Safety / platform policy lock

Cartel Missions are legitimate community activation, **not** an engagement-exchange system.

- Encourage users to read the post and add their own perspective.
- No copy-paste spam orchestration.
- No automated engagement actions.
- No rewards in exchange for engagement.
- No completion quota based on likes / reposts / comments.
- No fake engagement and no metric-manipulation claims.
- AI-generated prompts, when added later, must promote original discussion rather than
  templated spam.
- Reverify X and every provider/platform's current API and automation rules before
  enabling any production behavior.

---

## 13. Phased roadmap

- **SE-0** — Architecture Lock. This document only.
- **SE-1** — Schema / RLS foundation only. No external provider calls. No Telegram send/edit.
- **SE-2** — `SocialReadProvider` foundation plus ONE approved read-provider adapter. No
  automatic polling unless separately authorized.
- **SE-3** — Telegram mission send/edit lifecycle, reusing existing Telegram boundaries.
- **SE-4** — Automatic source polling, mission automation, hard cost/rate guardrails.
- **SE-5** — Social / Mission dashboard, mission history and analytics presentation.
- **SE-6** — Optional AI classification / discussion-copy layer using existing AI job and
  cost patterns.
- **SE-7** — Future OAuth / social publishing adapters, only after a separate security and
  policy audit.

---

## 14. SE-1 execution contract preview (DO NOT EXECUTE)

Expected SE-1 start gate:

- Re-audit current live Supabase schema, RLS, functions, and current HEAD.
- Verify no equivalent social tables were introduced in the meantime.
- Design exact migrations, RLS policies and indexes from the model locked in section 8.
- Owner/admin write permissions; tenant-safe reads; worker/service-role write boundary for
  provider observations and costs.
- No provider secrets and no provider calls.
- No cron.
- No Edge Function deployment.
- No Telegram behavior change.
- Generate/update Supabase types **if and only if** an SE-1 migration is authorized and applied.

---

## 15. Unresolved items carried out of SE-0

- Final read-provider selection per platform is **not** approved; Refetcher is a candidate
  pending a fresh provider and platform-policy review.
- Exact pricing, cost ceilings and per-workspace quotas are unset.
- SE-3 transport decision (extend `telegram-group` vs. narrow mission function) is deferred
  to code inspection at SE-3.
- Exact `usage_ledger` extension fields, if any, await the SE-1 audit.
- Mission card copy, formatting and report layout are unspecified.
- No publishing provider, OAuth scope or authenticated-write boundary is designed.

**STOP POINT:** SE-0 architecture lock only. Do not proceed into SE-1.
