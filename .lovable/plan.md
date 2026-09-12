# SE-2 Start Gate — Read-Only Audit and Proposed Build Contract

No files were edited, no commit made, no migration run, no provider or Telegram call, no secret created, no dependency added. This document is the audit artifact only and should be deleted at the start of the next build turn, as SE-1's was.

## 1. HEAD and drift resolution

- Current HEAD: `915e24c781e8243a7cd8856c4b1505be276877fd`. Tree clean.
- The prior SE-1 report cited `f7acbce8b28fa40f315b545643db3542b5437ef8`. That is still an ancestor. `915e24c` is a **merge commit created by the platform's plan-mode sync**, titled "Update plan", merging `ea3fbb8` (the plan-mode branch that had added `.lovable/plan.md`) with `f7acbce` (the SE-1 work).
- Its diff is exactly: `.lovable/plan.md` **deleted** (81 lines) plus the five SE-1 files added. No SE-1 content was altered by the merge. `ls .lovable` confirms only `project.json` and the `plan/` archive directory remain.
- Conclusion: the drift is platform bookkeeping, not lost or extra work. `915e24c` is the correct SE-2 start gate.

## 2. SE-0 / SE-1 artifacts present, no social runtime added

- `docs/SE0_SOCIAL_ENGINE_ARCHITECTURE_LOCK.md` — present, unmodified.
- `docs/SE1_SOCIAL_ENGINE_SCHEMA_FOUNDATION.md`, both `docs/sql/2026091222*` parity copies, `scripts/se1-social-engine-schema-regression.ts` — all present.
- Repo-wide search for `refetcher|Refetcher|REFETCHER|SocialReadProvider|social_sources` across `src`, `backend-source`, `supabase`, `scripts`: only the SE-1 regression script and the generated types. **No provider adapter, no Edge Function, no secret reference, no UI.**
- No `REFETCHER*` variable exists in the environment.

## 3. Existing provider patterns — reuse vs. avoid

Authoritative reference: `backend-source/edge-functions/sticker-ai/index.ts` (1246 lines, KIE provider) and `src/lib/sticker-ai.ts` (thin client).

**Reuse:**
- Provider secret read via `Deno.env.get("KIE_API_KEY")` inside the handler; never returned, logged, or sent to the browser.
- Two-client split: an anon client carrying the caller's `Authorization` header used only for `auth.getUser()`, then a separate service-role client for privileged work. Unauthenticated callers are rejected before any provider call.
- `cors` constant + `respond(body, status)` JSON envelope.
- `kieRequest()` normalization: network failure → `{ ok:false, status:0 }`; HTTP status mapped to a short, non-leaking user-facing message (401 key rejected, 403 denied, 429 rate limited, 5xx unavailable); provider payload never echoed raw.
- `creditsFrom()` — read billable units from the provider response rather than assuming them.
- `logCredits()` — ledger write is skipped entirely when the provider reported no credits, and guarded by an existence check before insert.
- `src/lib/treasury-safe-verify.functions.ts` is the better model for a **read-only, zero-persistence** call: `createServerFn` + `requireSupabaseAuth`, `AbortController` with an 8s timeout, an explicit allowlist of permitted upstream operations, and errors that never carry the endpoint.

**Do NOT reuse:**
- The `ai_jobs` async task/poll/child-job machinery. SE-2 reads are synchronous and ephemeral; a job row would imply persistence SE-2 is not authorized to create.
- Storage/bucket writes, signed URLs, image processing.
- `supabase.functions.invoke` from the browser as the default call path — this stack prefers `createServerFn`, and the treasury verifier already set that precedent.
- `Access-Control-Allow-Origin: "*"` if the boundary ends up as a server function rather than an Edge Function; a server fn needs no CORS at all.
- Any retry loop. SE-2 must not retry automatically — a retryable classification is returned to the caller instead.

## 4. Minimal SE-2 runtime surface from the SE-1 types

- All five tables are typed with composite relationships intact, including `social_mission_targets_group_workspace_chat_fkey` over `(group_connection_id, workspace_id, telegram_chat_id)`.
- `social_posts` and `social_metric_snapshots` are observation tables: authenticated SELECT only, writes structurally service-role.
- `usage_ledger` columns: `id, workspace_id, user_id, action_type, units, provider_cost, internal_cost, ai_job_id, created_at`. Its only reference column is `ai_job_id` → `ai_jobs`. No generic reference column, no idempotency key.
- Therefore **SE-2 needs no table writes at all.** The adapter can be proven end-to-end returning normalized values to an authenticated operator, with persistence deferred to SE-3/SE-4.

## 5. Proposed provider-neutral contract (design, not built)

New pure module `src/lib/social-read-provider.ts` — types and normalizers only, zero I/O:

- `SocialPlatform = 'x' | 'instagram' | 'tiktok' | 'youtube' | 'facebook'` (mirrors the SE-1 CHECK exactly).
- `NormalizedMetrics` — `views/likes/comments/shares/saves`, each `number | null`. `null` is preserved; never coerced to `0`.
- `MetricAvailability` — per-metric `'available' | 'unsupported' | 'unknown'`, so a missing value's reason survives into SE-5 reporting.
- `NormalizedSource` — platform, canonical URL, handle, external account id, display name.
- `NormalizedPost` — platform, external post id, canonical URL, author handle/display name, text, media type, published at, metrics, availability.
- `ProviderResult<T>` — `{ ok: true, data: T, provider, billable: boolean, units: number | null, observedAt }` or `{ ok: false, provider, error: ProviderError, billable: false }`.
- `SocialReadProvider` interface — `id`, `supports(platform, capability)`, `fetchPostByUrl`, `fetchSourceRecentPosts`, `fetchPostMetrics`. Nothing else. No publish, OAuth, engagement or monitoring method exists on the type, so a future vendor cannot smuggle one in.
- Adapter `src/lib/social-read-refetcher.server.ts` — maps the single normalized Refetcher endpoint onto the three read operations and onto the shapes above. Kept behind the interface; swapping vendors touches this file only.

## 6. Execution boundary

**Recommendation: a `createServerFn` with `requireSupabaseAuth`, not a new Edge Function.** Reasons: this stack's standing rule is server functions for app-internal logic; the treasury verifier is the working precedent; it needs no CORS, no deploy step, no `verify_jwt` config, and no second secret surface. The Telegram Edge Functions stay untouched.

- Authorization: authenticated **and** `is_workspace_operator` for the workspace in the request, matching the SE-1 write boundary.
- The provider key is read from `process.env` inside the handler only, with no fallback; missing key returns a typed `PROVIDER_NOT_CONFIGURED` failure rather than an unverified pass.
- Capability: source read, post read, metrics read. No writes of any kind in SE-2 — not even to the social tables.
- `AbortController` timeout, no automatic retry, no cron, no scheduler, no background job.

## 7. `usage_ledger` — no schema change needed in SE-2

SE-2 performs no persistence, so there is nothing to meter durably yet. Deferring is safe because the adapter already returns `billable` and `units` on every result; SE-3/SE-4 can record them when missions actually run. When that turn arrives the decision is between (a) a minimal `usage_ledger` extension adding a nullable reference + idempotency key, or (b) reusing `ai_jobs` as the provider-job anchor via the existing `ai_job_id` FK. That choice needs the real snapshot/poll-bucket flow in front of it, and forcing it now would add an unused column.

## 8. Allowed adapter operations (exhaustive)

1. `fetchPostByUrl(canonicalUrl)` — one public post.
2. `fetchSourceRecentPosts(source, limit)` — recent public posts for a configured public profile, operator-triggered only.
3. `fetchPostMetrics(post)` — public metrics for a known post.

Forbidden and absent from the interface: publishing, scheduling, deleting, OAuth, comments, DMs, likes, reposts, follows, bookmarks, follower/member enumeration, per-user engagement attribution, and any automatic or scheduled invocation.

## 9. Error and cost semantics

`ProviderError = { code, retryable, message }` with codes `PROVIDER_NOT_CONFIGURED`, `UNSUPPORTED_PLATFORM`, `INVALID_URL`, `NOT_FOUND`, `PRIVATE_OR_BLOCKED`, `RATE_LIMITED`, `PROVIDER_UNAVAILABLE`, `TIMEOUT`, `MALFORMED_RESPONSE`, `UNKNOWN`.

- Retryable: `RATE_LIMITED`, `PROVIDER_UNAVAILABLE`, `TIMEOUT`. Permanent: everything else.
- `billable` is `true` only when the provider explicitly reports a successful, charged scrape unit. Every failure path returns `billable: false`. Ambiguity is treated as non-billable and flagged, never silently charged.
- Error messages are short and sanitized: no endpoint, no key, no raw provider payload.

## 10. Tests

`scripts/se2-social-read-provider-regression.ts`, source-only plus fixture-driven, no network:

- Interface shape lock: the provider type exposes exactly the three read operations, and the file contains no publish/engagement identifier.
- Fixture mapping per platform: a captured-shape JSON fixture maps to the expected `NormalizedPost`, including that unsupported metrics stay `null` with availability `'unsupported'` and are never `0`.
- Error mapping: each upstream status/shape maps to the intended code and retryable flag.
- Billable semantics: failure fixtures all yield `billable: false`.
- Scope lock: no cron, no write to any `social_*` table, no `usage_ledger` write, no secret in client-reachable code, no `.server` import at module scope in a client-reachable file.

Plus `bunx tsgo --noEmit` and `bun run build`.

## 11. Policy / ToS risk

Refetcher is a **scraping** vendor. Public scraping sits against several platforms' automation terms regardless of the vendor's own compliance claims, and the dependency carries continuity risk (blocking, breakage, vendor shutdown). Official APIs — X's pay-per-use tier, YouTube Data API — are lower-risk for the platforms that offer them.

Recommendation for SE-2 V1: adopt Refetcher as the single adapter **because the interface makes it replaceable**, and treat it as provisional. Do not hardcode Refetcher anywhere outside the adapter file; route platform → provider through config so an official-API adapter can take over X or YouTube in SE-2.1 without a schema or call-site change. A fresh platform-policy review remains a prerequisite before any production-facing use, as SE-0 section 15 requires. Published pricing ($0.90/1000 successful scrapes, $10 starting credit, no minimum) is a non-authoritative snapshot to reverify before procurement.

## 12. Blockers requiring your action

1. **Refetcher API key** — none exists in the environment. SE-2 cannot be verified against the live provider until you add it in Project Settings → Secrets. Not requested or stored in this turn. The adapter should be built so that a missing key yields `PROVIDER_NOT_CONFIGURED` and the fixture tests still pass without it.
2. **Provider approval** — SE-0 leaves read-provider selection unapproved. Explicit approval of Refetcher as the V1 adapter is needed before the build turn.
3. **Boundary confirmation** — confirm the server-function boundary (section 6) rather than a new Edge Function.

## Next-turn build contract (for authorization)

Allowlist: `src/lib/social-read-provider.ts` (pure types/normalizers), `src/lib/social-read-refetcher.server.ts` (adapter), `src/lib/social-read.functions.ts` (auth + operator-gated server fn), `scripts/se2-social-read-provider-regression.ts` and its fixtures, `docs/SE2_SOCIAL_READ_PROVIDER.md`, and deletion of `.lovable/plan.md`.

Prohibited: migrations, `usage_ledger` change, writes to any `social_*` table, cron, Edge Function deploy, Telegram, UI/routes, dependencies, publishing, OAuth, engagement actions, automatic polling, and any live provider call until the key and approval exist.

Stop point: SE-2 only. Do not proceed to SE-3.
