# SE-2.1 — Direct-First Provider Architecture Correction

Status: BUILT, source-only/fixture verified. NO live API call has ever been performed against X, YouTube, TikTok, Meta or Refetcher.
Phase: SE-2.1 (provider strategy correction only). Supersedes the provider-selection decision recorded in `docs/SE2_SOCIAL_READ_PROVIDER.md`; that document remains valid as the historical SE-2 record.

- Start gate / start HEAD: `22e47e4d67127657cfae64ddd04478c89748fbf9` (verified clean tree, no drift).
- Final HEAD: recorded at checkpoint after this turn.
- Authority: `docs/SE0_SOCIAL_ENGINE_ARCHITECTURE_LOCK.md` (frozen), `docs/SE1_SOCIAL_ENGINE_SCHEMA_FOUNDATION.md` (frozen).

## Why provider priority changed

SE-2 selected Refetcher — a public-scraping vendor — as the provisional V1 reader. That carried avoidable terms-of-service exposure and continuity risk (blocking, breakage, vendor shutdown) for platforms that publish usable official read APIs. The corrected standing rule is **official/direct APIs first whenever practical**. Refetcher is no longer the primary provider and is no longer reachable from runtime.

The provider-neutral `SocialReadProvider` contract from SE-2 was preserved unchanged, which is exactly what made this correction a surgical swap rather than a rebuild.

## Provider policy (frozen for SE-2.1)

| Platform | V1 reader | Status |
| --- | --- | --- |
| X | Official X API v2 (`https://api.x.com/2`) | PRIMARY, implemented |
| YouTube | Official YouTube Data API v3 (`https://www.googleapis.com/youtube/v3`) | PRIMARY, implemented |
| TikTok | Official Display API, requires an authorized user's OAuth token | DEFERRED — no OAuth built in this phase |
| Instagram | Official Meta account connection | DEFERRED — pending dedicated Meta permissions audit |
| Facebook | Official Meta account connection | DEFERRED — pending dedicated Meta permissions audit |
| Refetcher | Scraping vendor | DORMANT fallback only. Not primary, not automatically used, not reachable from the router or the server boundary. Reinstating it requires an explicit later authorization, not an env flag. |

A link on a deferred platform returns a typed `PROVIDER_NOT_CONFIGURED` refusal with `billable: false, units: 0`. It is never silently rerouted to a scraper.

## Files

| File | Role |
| --- | --- |
| `src/lib/social-read-x.server.ts` | NEW. Official X adapter: URL parsing, pure request builders, response mappers, transport. |
| `src/lib/social-read-youtube.server.ts` | NEW. Official YouTube Data API adapter, same shape. |
| `src/lib/social-read-router.server.ts` | NEW. Pure direct-first routing decision plus a provider-neutral façade. |
| `src/lib/social-read.functions.ts` | Minimal edit: dynamically imports the router instead of the Refetcher adapter. Auth and operator gate unchanged. |
| `scripts/se21-direct-first-provider-regression.ts` | NEW. 139 source-only, fixture-driven checks. |
| `scripts/se2-social-read-provider-regression.ts` | Two boundary assertions re-pinned from the Refetcher adapter to the router, plus one NEW negative assertion that the boundary no longer reaches Refetcher. No safety assertion was weakened or removed. |
| `src/lib/social-read-provider.ts` | UNCHANGED. |
| `src/lib/social-read-refetcher.server.ts` | UNCHANGED, dormant. |

## X mapping (canonical V1)

Post lookup `GET /2/tweets/{id}` with `tweet.fields=created_at,author_id,public_metrics`, `expansions=author_id`, `user.fields=id,name,username`.

| Canonical | X `public_metrics` |
| --- | --- |
| views | `impression_count` |
| likes | `like_count` |
| comments | `reply_count` |
| shares | `retweet_count` **only** |
| saves | `bookmark_count` |

`quote_count` is deliberately **not** represented in the canonical V1 schema. It is not merged into `shares`, and no field is invented for it. A regression check enforces this.

Source read: `GET /2/users/by/username/{username}` to resolve the account, then exactly one page of `GET /2/users/{id}/tweets`. `max_results` respects the provider minimum (5) and any smaller caller request is trimmed locally; returned posts are capped at 10. A `meta.next_token` only sets `hasMore` — it is never followed.

Billing: a single post or metrics read returns `billable: true, units: 1`. A source read mixes user and post resources, so it returns `units: null` rather than asserting a count. Every failure returns `billable: false, units: 0`.

## YouTube mapping

Video/metrics: `videos.list` with `part=snippet,statistics`, `id={videoId}`.

| Canonical | YouTube |
| --- | --- |
| views | `statistics.viewCount` |
| likes | `statistics.likeCount` |
| comments | `statistics.commentCount` |
| shares | `null`, availability `unavailable` (no public share count in the Data API) |
| saves | `null`, availability `not_applicable` |

Count fields arrive as decimal strings and are converted only when they are a finite non-negative integer string. A hidden like count stays `null` with `unknown` availability — never zero.

Source read: `channels.list` (`id` / `forHandle` / `forUsername` depending on URL form) → `contentDetails.relatedPlaylists.uploads` → one page of `playlistItems.list` → one `videos.list` enrichment for public statistics. **`search.list` is never used.** No pagination loop; `nextPageToken` only sets `hasMore`. Un-enriched items keep all-null metrics rather than inventing values.

Billing: YouTube consumes API quota, not a direct monetary charge, so reads return `billable: false` with `units` expressing quota units — 1 for a video read, and the actual known total (2 or 3) for a source read.

## Security boundary (unchanged from SE-2)

- `createServerFn` + `requireSupabaseAuth`, plus `is_workspace_operator` for the named workspace. Authorization runs **before** any provider module is loaded.
- Secret names only, never values: `X_API_BEARER_TOKEN` and `YOUTUBE_API_KEY`. Neither exists in the project yet.
- Each key is read inside its adapter's call path with no default and no fallback. A missing key returns `PROVIDER_NOT_CONFIGURED` before any fetch is constructed.
- The X token travels in an `Authorization` header only. The YouTube key is appended in the transport function alone; pure request builders never contain it. No key appears in a log, response or error message.
- Upstream hosts are fixed constants. Caller input is validated locally and can never redirect a request; foreign hosts, non-http(s) schemes, credentials and ports are rejected.
- 10s `AbortController` timeout per request. No automatic retry anywhere.
- Only normalized `ProviderResult` values cross the boundary.

## What SE-2.1 does NOT do

No Supabase access of any kind: no migration, DDL, insert/update/delete, `usage_ledger` write or social-table write. The five SE-1 social tables remain at 0 rows and `usage_ledger` remains 9 columns. No secret was created. No live X, YouTube, TikTok, Meta or Refetcher call was made. No UI, route or component. No dependency added — native `fetch` only. No cron, scheduler or background polling. No Telegram change. No Edge Function. No OAuth, publishing, like, repost, comment, follow, DM or bookmark capability. No dollar pricing encoded.

## Verification

- `bun scripts/se21-direct-first-provider-regression.ts` — **139 checks, all passing.**
- `bun scripts/se2-social-read-provider-regression.ts` — **155 checks, all passing** (154 previously, plus the new no-Refetcher-at-runtime assertion).
- `bunx tsgo --noEmit` — clean. One initial failure was found and corrected truthfully: `buildUserTweetsUrl` typed its limit parameter as `number` while the interface passes `number | undefined`; the parameter was widened to `unknown`, which the clamping helper already handled.
- `bun run build` — success.

## Production enablement gate

Before any real read:

1. The owner adds `X_API_BEARER_TOKEN` and/or `YOUTUBE_API_KEY` in Project Settings → Secrets.
2. A separately authorized turn performs **one** controlled live read per platform against a single known public item and reports the normalized result.

Until then every call returns `PROVIDER_NOT_CONFIGURED`.

## Stop point

**STOP POINT = SE-2.1 direct-first provider architecture only.** Do not proceed to SE-3 (Telegram mission send/edit lifecycle) without a separate start gate. No TikTok OAuth, no Meta connection, no Refetcher reactivation, no persistence, no metering and no polling is authorized by this phase.
