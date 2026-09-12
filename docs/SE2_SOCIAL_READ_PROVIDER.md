# SE-2 — SocialReadProvider Foundation + Provisional Refetcher Adapter

Status: BUILT and CONTRACT-CORRECTED, source-only/fixture verified. NOT validated against the live provider — no live call has ever been performed.
Phase: SE-2 (foundation only). Start gate: `915e24c781e8243a7cd8856c4b1505be276877fd` (audit artifact commit `2d15db0e...` removed in this turn).
Authority: `docs/SE0_SOCIAL_ENGINE_ARCHITECTURE_LOCK.md` (frozen), `docs/SE1_SOCIAL_ENGINE_SCHEMA_FOUNDATION.md` (frozen).

## What was built

Three files, plus a regression script and this document.

| File | Role |
| --- | --- |
| `src/lib/social-read-provider.ts` | Pure, provider-neutral contract. Zero I/O, no secret name, no provider host. Safe in any bundle. |
| `src/lib/social-read-refetcher.server.ts` | Server-only Refetcher adapter. All vendor specifics live here and nowhere else. |
| `src/lib/social-read.functions.ts` | Authenticated, operator-gated server-function boundary. The only path app code may use. |
| `scripts/se2-social-read-provider-regression.ts` | 154 source-only, fixture-driven checks. No network, no database, no secret. |

## Provider selection

Refetcher is the **provisional** V1 read adapter, chosen for pay-as-you-go economics with no monthly minimum. It is deliberately replaceable: the rest of the system speaks only `SocialReadProvider`, so an official-API adapter (X pay-per-use, YouTube Data API) can be added as a sibling file without touching callers, the server boundary, or the SE-1 schema.

No pricing is encoded anywhere in the code. Cost figures are commercial inputs to reverify before procurement, not architecture. A regression check fails the build if a currency amount appears in SE-2 source.

## Exactly three operations

1. `fetchPostByUrl` — one public post.
2. `fetchSourceRecentPosts` — one page of a public profile's recent posts.
3. `fetchPostMetrics` — public metrics for a known post.

The `SocialReadProvider` type declares nothing else. There is no publish, schedule, delete, OAuth, like, repost, comment, follow, bookmark or DM method, and the regression asserts none of those tokens exist in SE-2 source. A future vendor adapter cannot introduce one without amending this contract.

## Security boundary

- `createServerFn` + `requireSupabaseAuth`, following the PCART-L1B treasury-verification precedent. No new Edge Function, no CORS surface, no `verify_jwt` config.
- Every external read requires an authenticated caller **and** `is_workspace_operator` for the named workspace — the same boundary SE-1 uses for writes. Authorization runs before the adapter module is even loaded.
- `REFETCHER_API_KEY` is read inside the adapter only, with no default and no fallback. A missing key returns `PROVIDER_NOT_CONFIGURED` before any fetch is constructed.
- Header auth only (`X-API-Key`). The key never appears in a URL, a log, a response or an error.
- The upstream host is a fixed constant. Caller input is validated locally against a per-platform host allowlist (five SE-1 platforms only) and can never redirect the request; credentials, ports and non-http(s) schemes are rejected.
- 10s `AbortController` timeout — above the 8s chain-RPC precedent because a scrape round-trip is slower and a premature abort risks a charged-but-discarded unit.
- No automatic retry. Failures are classified retryable or permanent and returned to the caller.
- Only a normalized `ProviderResult` crosses the boundary; raw provider payloads never do.

## Data semantics

Canonical metrics `views / likes / comments / shares / saves` are `number | null`. `null` is never coerced to zero, and the regression rejects any `?? 0` in SE-2 source. Availability per metric is preserved as `available | unavailable | not_applicable | unknown`. When a provider omits availability (YouTube currently does), a finite number infers `available` and anything else stays `unknown` — never `unavailable`, never zero.

For X, provider replies map to canonical `comments` and reposts to canonical `shares`. Bookmarks are not exposed separately; a bookmark count is adopted only if the provider returns it in the canonical `metrics.saves` field.

Exactly one target per call, expressed as a SINGULAR target field — never a batch.

## Request contract (corrected 2026-09-12 after independent official-doc review)

The initial SE-2 build sent an undocumented `{ targets: [...], pages: 1 }` envelope and read `post.url`. An independent review of Refetcher's current official documentation found this did not match the published contract. The adapter was corrected in the same phase, before any live call; nothing had been validated against the provider, so no live behaviour changed.

| Operation | Request body |
| --- | --- |
| Post / video / metrics (all five platforms) | `{ url }` |
| Source recent posts — Instagram, TikTok, Facebook | `{ profileUrl, includeRecentPosts: true, pages: 1, recentPostsLimit }` |
| Source recent posts — X | as above plus `sort: "latest"` |
| Source recent posts — YouTube channel | `{ type: "channel", platform: "youtube", channelUrl, includeRecentVideos: true, recentVideosLimit }` |

Response mapping follows the documented shape: canonical link from `post.normalizedUrl` (falling back to `post.url`), content from `post.caption`, profile name from `profile.name`. Two source shapes normalize to one contract — `profile` + `recentPosts` for the four networks, `channel` + `recentVideos` for YouTube. `hasMore` reads `pageInfo.recentPosts.hasNextPage` or `pageInfo.recentVideos.hasNextPage`, with the earlier `pagination` shape kept as a fallback, and never triggers another call. Lightweight links-only references carry no metrics; those stay all-null with `unknown` availability rather than inventing values, and their id is derived from the canonical link only as a last resort.

The result envelope rule is unchanged: inspect `results[0]`, require exactly one result entry, and honour `results[0].success`.

## Billing semantics

Success returns `billable: true` with `units: 1` for a single post/metrics target. Profile-page billing can vary by platform, so a successful source read returns `units: null` rather than asserting a number. **Every failure path returns `billable: false, units: 0`** — deliberately conservative, so a failed or ambiguous request can never be recorded as provider cost.

## What SE-2 does NOT do

No database write of any kind: no social table write, no `usage_ledger` write, no schema change. No persistence, no caching, no cron, no scheduler, no background job, no automatic polling, no provider call during page rendering. No Telegram code. No UI, routes or components. No dependency added. No live provider call was made in this turn.

`usage_ledger` needs no SE-2 extension because SE-2 persists nothing. The adapter already returns `billable` and `units` on every result, so durable metering can be added in SE-3/SE-4 when missions actually run.

## Policy and continuity risk

Refetcher is a public-scraping vendor. Scraping sits against several platforms' automation terms regardless of the vendor's own compliance posture, and the dependency carries continuity risk (blocking, breakage, vendor shutdown). Official APIs are lower-risk where available. Treat Refetcher as provisional, run a fresh platform-policy review before any production-facing use, and prefer migrating X and YouTube to official-API adapters behind the same interface.

## Verification

- `bun scripts/se2-social-read-provider-regression.ts` — 154 checks, all passing. Covers interface shape and absence of write capability; URL acceptance for all five platforms and rejection of foreign hosts, schemes, credentials and ports; success fixtures for Instagram, TikTok, X, YouTube and Facebook; null/availability preservation including the YouTube missing-availability case; exact request-body builders for post, the four-network profile read, X sort, and the YouTube channel read; `normalizedUrl`/`caption` preference; `pageInfo.*.hasNextPage`; the YouTube channel + recentVideos shape including a links-only reference; single-page clamping; HTTP status and per-result category error mapping; retryable classification; `billable:false, units:0` on every failure; credential handling; authorization ordering; and scope locks (no cost fields, no pricing, no table writes, no cron, no Telegram).
- `bunx tsgo --noEmit` — clean.
- `bun run build` — success.

## Production enablement gate

SE-2 is unproven against the live provider by design. Before any real read:

1. The owner adds `REFETCHER_API_KEY` as a server secret in Project Settings → Secrets.
2. A separately authorized turn performs **one** controlled live read against a single known public post and reports the normalized result.

Until both happen, every call returns `PROVIDER_NOT_CONFIGURED`.

## Stop point

SE-2 foundation only. Do not proceed to SE-3 (Telegram mission send/edit lifecycle) without a separate start gate. No provider approval beyond provisional, no cost ceiling, no polling behavior and no persistence is authorized by this phase.
