# Phase 2B — X resource accounting + runaway mission expiry (READ-ONLY AUDIT)

## A. Start gate — PASS

HEAD `8f083821323a280b2ea4a72ff259a6f542553e37`, working tree clean, migration count 85. No file was edited, no DB write, no deploy, no migration, no secret touched. All findings below come from repository reads and read-only SQL.

## B. Current X path

1. **Requests per tick, not per mission.** `runMetricsRefresh` (`backend-source/edge-functions/social-mission-runner/index.ts`) calls `list_active_social_missions_for_metrics(_limit 300)`, collects every LIVE mission's `external_post_id`, de-duplicates them (`batchPostIds`) and issues **at most 3 HTTP requests of up to 100 ids each** per minute. Today, with one LIVE mission, that is exactly **one HTTP request per minute**.
2. **Endpoint.** `GET https://api.x.com/2/tweets?ids=<csv>&tweet.fields=public_metrics,created_at,author_id` (`_shared/x-metrics.ts`, `X_API_BASE` + `buildLookupUrl`). No `expansions`, no `user.fields`, no second endpoint anywhere in the repo.
3. **Resources actually returned.** Only **Post** resources — one per id present in `data[]`. `author_id` is a scalar field on the Post, not an expanded User object, so **no User resource is returned and none is billable today**. Nothing else is returned.
4. **Response ids in code.** `lookupXPostMetrics` builds `posts: Map<postId, XPostMetrics>` keyed by the returned `row.id`; the runner reads it as `found`. The set of returned ids — the truthful billable set — is available and is currently discarded after mapping.
5. **One request returning both Post and User:** no. It would only happen if `expansions=author_id` were added, which it is not.
6. **`social_x_tracked_post_read` today.** Written in exactly one place: `record_social_mission_metric_snapshot` (SE-5 → SE-13 → SE-14), inserting `(workspace_id, NULL, 'social_x_tracked_post_read', 1)` **only when a new snapshot row was actually inserted** and provider is `x-official`. Operationally it means "a new per-mission, per-minute snapshot was stored" — a *poll* counter, not a resource counter. Live: 13,649 rows, first 2026-09-14, last 2026-09-22 14:11 (still growing every minute).
7. **Snapshot dedupe vs billing dedupe — they are different and currently conflated.** Snapshot dedupe is `ON CONFLICT (mission_id, provider, poll_bucket)`: one row per mission per minute. X bills per resource returned, deduplicated per resource per UTC day. Two divergences follow: (a) *N missions tracking the same post* produce N ledger rows from **one** billable resource; (b) *1440 minutes of polling the same post* produce ~1440 ledger rows for **one** billable resource-day.
8. **Partial data / errors.** `lookupXPostMetrics` returns `{ok:false, reason}` on timeout, non-2xx, unreadable body, or a 200 with zero readable rows. The runner then `continue`s — no snapshot, no synthetic zeroes, no retry, no ledger row. A partial batch (some ids missing from `data[]`) is handled correctly: missing ids simply have no entry in `found` and are skipped. This already matches "failed requests returning no data are not billed".

## C. Current mission lifecycle — runaway confirmed

- **Creation sets LIVE immediately** with `started_at = now()` and **`ends_at` left NULL**: `create_social_mission_from_telegram_link` / `finalize_social_mission_link_candidate_start` / the SE-4A launcher (SE-9 l.487, SE-7 l.558, SE-5 l.1110, SE-4A l.250).
- **`ends_at` is written only later**, by `activate_social_mission_schedule(mission, target)`, which requires a confirmed `delivery_state='SENT'` target and sets `ends_at = target.sent_at + duration_minutes`. Duration comes from the mission's own snapshotted preset: STANDARD **45**, QUICK 20, LAUNCH 60, MAJOR_ANNOUNCEMENT 120, clamped 1–1440. **45 minutes is the existing product default**, so the 45-minute working target matches shipped behaviour.
- **Activation has exactly one caller**: `telegram-webhook/index.ts:1407`, after the transport reports SENT. If that single call never lands, the mission stays LIVE with `ends_at` NULL forever.
- **Selection per tick** (`list_active_social_missions_for_metrics`) filters on `status='LIVE' AND completed_at IS NULL AND delivery_state='SENT' AND telegram_message_id IS NOT NULL` plus the metrics toggles. **`ends_at` is never consulted**, so expiry cannot stop polling.
- **Auto-completion is event-driven only.** `claim_due_social_mission_schedule_events` completes a mission when its seeded `COMPLETE` event comes due. No sweeper exists for missions that have no COMPLETE event.
- **The live stale mission** `a0166972-…`: status LIVE, `started_at = created_at = 2026-09-13 03:43:52Z`, `ends_at` NULL, `completed_at` NULL. Its target `1d1821f8-…` **is** SENT (`sent_at 2026-09-13 12:25:48Z`, message 2451), yet `social_mission_schedule_events` for this mission is **empty** — activation never ran. It therefore satisfies every selection filter and will poll forever. Root cause proven, not assumed.
- **Manual creation paths** that can leave `ends_at` NULL: all three LIVE-creating RPCs above, every time, until activation runs.
- **Safe termination exists already.** SE-15 `end_social_mission_from_control` sets COMPLETED/`ends_at=now()`, and the SE-4B claim path sets `status='COMPLETED', completed_at=COALESCE(...,now()), ends_at=COALESCE(...,now())` and cancels PENDING pulses. Neither touches `social_posts`, targets' `delivery_state`, `telegram_message_id`, or SENT history — so a server-side sweep can reuse exactly this shape without corrupting post/card state.

## D. Accounting design (Phase 2B-A)

Keep `social_x_tracked_post_read` **exactly as is** — SE-6/SE-13/SE-14 regressions assert its literal insert, and it remains honest poll telemetry. Add new, separate resource events written from the **runner**, only from the ids X actually returned.

| | Post event |
|---|---|
| action_type | `social_x_post_resource_read` |
| provider | `x` |
| provider_model | `GET /2/tweets` (endpoint descriptor, no invented model) |
| unit_type | `resource_read` |
| units | `1` |
| event identity | resource type + X post id + UTC billing date |
| idempotency_key | `x:social_x_post_resource_read:<post_id>:<YYYY-MM-DD>` |

A `social_x_user_resource_read` counterpart is specified but **not wired**, because no code path returns a User resource. It should only be added in the same commit that adds `expansions=author_id`, if ever.

**Metadata:** `x_resource_type`, `x_resource_id`, `x_billing_utc_date`, `endpoint`, `mission_id`, `social_post_id`, `poll_bucket`, `observed_at`.
`provider_cost`, `internal_cost`, `currency`, all `pricing_*` stay NULL. No rate card, no dollars, no backfill. This is our best raw billing-identity ledger matching X's documented soft dedupe — it is explicitly not X's invoice.

### App-global vs workspace-scoped key — this matters

X bills **per app**, not per workspace. If the key included `workspace_id`, two workspaces tracking the same post on the same day would produce two rows for **one** billable resource — systematic over-count. **Recommendation: the idempotency key is APP-GLOBAL** (no workspace segment), exactly as tabled above.

Consequence to accept explicitly: `usage_ledger.workspace_id` is `NOT NULL`, so the single global row must be attributed to one workspace — the first workspace whose mission caused the resource to be fetched that day. Metadata records `mission_id`/`social_post_id` so the attribution is inspectable, and a later co-tracking workspace is deliberately **not** charged a second time. Cross-workspace apportionment would require a schema change and is out of scope; **no migration is needed for Phase 2B** — `provider`, `provider_model`, `unit_type`, `idempotency_key`, `metadata` and the non-partial unique index from Phase 1 cover this design. Migration count stays 85.

Writer: the existing `_shared/usage-accounting.ts` `recordProviderUsage` is already sufficient (nullable `aiJobId`, generic `unitType`, duplicate-safe upsert, errors logged and swallowed). Only a small extension is needed so the key can omit the `<job>` segment shape, or the existing `no-job` segment is accepted as-is — preference is a dedicated `buildXResourceIdempotencyKey` helper so the Phase 1 key shape stays byte-identical.

## E. Expiry design (Phase 2B-B)

1. **Hard server-side cap, evaluated before any X fetch.** Add expiry to the selection RPC itself so an expired mission can never reach `lookupXPostMetrics`:
   - exclude `ends_at IS NOT NULL AND ends_at <= now()`
   - exclude `ends_at IS NULL AND started_at < now() - interval '45 minutes'` (legacy-data backstop; the constant mirrors the shipped STANDARD preset)
   - plus an absolute ceiling `started_at < now() - interval '24 hours'` regardless of any override, so a long preset still cannot run unbounded.
2. **Sweeper, same transaction shape as the existing completion path**: a SECURITY DEFINER function that marks such missions `COMPLETED` with `completed_at = now()`, `ends_at = COALESCE(ends_at, now())`, cancels PENDING schedule events, and touches nothing else. Called by the runner **before** the metrics phase, or folded into the selection RPC's preamble. `COMPLETED` is the right terminus: the status CHECK allows only `DRAFT/LIVE/COMPLETED/CANCELLED/FAILED`, `CANCELLED` implies a human decision, and no `EXPIRED` value exists — **do not add one**; record `expired_by_safety: true` in mission metadata / control history instead.
3. **Missions that never activated get `ends_at` on the spot** — the sweep sets it from `COALESCE(ends_at, started_at + 45 min, now())`, respecting `social_missions_time_order_ck`.
4. **No owner bypass.** The sweep and the selection filter are unconditional; `is_platform_owner` / `has_platform_unrestricted_access` are not consulted anywhere in this design. Cost/safety automation applies to everyone.
5. **Stale mission `a0166972-…`** — recommended handling: leave it untouched now; when the sweep ships it will self-resolve to `COMPLETED` with `ends_at = started_at + 45 min`. If you prefer an immediate one-off before deployment, `COMPLETED` (not CANCELLED, not a new status) via the same field set, leaving the target, card, message id and `social_posts` row untouched. Its card will simply stop refreshing; no Telegram edit is required because the runner only edits on a signature change.

## F. Plan-usage separation

"One mission consumed" is authoritatively a **row in `public.social_missions` that reached `status='LIVE'` with a non-null `started_at`** — written once, at creation, by the three LIVE-creating RPCs. A future monthly 100-mission limit should count `social_missions` rows per `workspace_id` where `started_at >= <period start>` (equivalently `created_at`, since they are set together), and must **never** count `usage_ledger` rows — X resource reads and poll telemetry are provider-cost signals, not plan units. Owner: enforcement checks `has_platform_unrestricted_access` first and bypasses the limit, while the mission row and every ledger row are still written, so observability is unaffected. No entitlement code in this phase.

## G. Owner invariant

Nothing in this design references an email address, `is_platform_owner`, plan, quota or entitlement. Usage and cost recording apply to the owner identically. The expiry safeguard applies to the owner identically, because it is automation safety, not a commercial gate.

## H. Minimal allowlist and migration impact

**Migration: one is required** — for the selection RPC + sweeper (section E). The accounting half (section D) needs **no** schema change.

1. one migration: `list_active_social_missions_for_metrics` (expiry filters) + new `expire_stale_social_missions()` sweeper + grants (service_role/postgres only). Count 85 → 86.
2. `backend-source/edge-functions/_shared/usage-accounting.ts` — add `buildXResourceIdempotencyKey` + X resource recorder; Phase 1/2A behaviour byte-identical.
3. `backend-source/edge-functions/social-mission-runner/index.ts` — record one resource event per returned id; call the sweeper before the metrics phase.
4. `scripts/cost-accounting-phase2b-regression.ts` [NEW].
5. re-pin the migration-count assertions in the four historical regressions (`pcart-l2-frozen-artifact`, `pcart-l1-closure`, `pcart-l2-draft-artifact`, `pcart-treasury-signers`) from 85 → 86 with the new file as the sole additional post-gate migration.
6. `src/integrations/supabase/types.ts` will be auto-regenerated by the platform on migration apply — unavoidable, flagged, not hand-edited.

No other file. No Stripe/plan/entitlement/quota, no Sticker Drops, no Project Identity, no PCART/launcher/wallet/Safe/treasury/chain/liquidity.

## I. Verification and deployment plan

New Phase 2B regression asserts: exact action_type/provider/provider_model/unit_type tuple; `units` always 1 per returned resource; key is app-global (contains no workspace id) and carries resource type + resource id + `YYYY-MM-DD`; a row is written only for ids present in the X response; no row on `!read.ok`; no dollar/rate literal; `social_x_tracked_post_read` insert unchanged in SQL; no User-resource event while no expansion is requested; expiry filter present in the selection RPC and evaluated before any `lookupXPostMetrics` call; sweeper uses only COMPLETED and never invents a status; no owner/entitlement branch; Phase 1 + 2A key shapes unchanged; migration count exactly 86 with the new file the only addition.

Then the full standing set: cost-accounting-phase2b, -phase2a, -phase1, pcart-l2-frozen-artifact, pcart-l1-closure, pcart-l2-draft-artifact, pcart-l1b-treasury-safe-verify, pcart-treasury-signers, hardening-b, se1, se4b, se5/se6, se13, se14, se15, social-mission-deploy-parity, p1a, p2c2, p3c-f/f1/f2, launcher-b-handoff, launcher-b3, verifier-state-write-activation, wallet-connector, `bunx tsgo --noEmit`, `bun run build`.

Deployment order, each its own authorized turn: (1) apply the expiry migration and confirm live that the stale mission is excluded and swept; (2) repository-only runner + helper changes with full verification; (3) deploy `social-mission-runner`; (4) confirm live that per-minute `social_x_post_resource_read` rows collapse to one per post per UTC day and that polling has stopped for expired missions.

## J. Stop point

Audit ends here. Nothing was written to the project, the database, or any deployment.
