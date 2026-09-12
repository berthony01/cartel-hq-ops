/**
 * SE-2.1 — Official X API READ adapter (SERVER ONLY).
 *
 * Direct-first: this is the PRIMARY reader for the `x` platform. Refetcher is
 * not consulted and is not imported here.
 *
 * Hard boundaries:
 * - READ only: one post, one post's metrics, one page of a public profile's
 *   recent posts. No publish, OAuth, engagement, DM, follow or bookmark path.
 * - No retry, no pagination loop, no polling, no scheduling.
 * - No persistence, no Supabase access, no usage_ledger write.
 * - The upstream host is a fixed constant; caller input can never redirect it.
 * - `X_API_BEARER_TOKEN` is read inside the call path only, with no default and
 *   no fallback, and never returned, logged or embedded in an error.
 * - No provider price is encoded anywhere.
 */

import {
  buildMetrics,
  providerFailure,
  providerSuccess,
  type NormalizedMetricsObservation,
  type NormalizedPost,
  type NormalizedSource,
  type NormalizedSourceRecentPosts,
  type ProviderError,
  type ProviderErrorCode,
  type ProviderResult,
  type SocialPlatform,
  type SocialReadCapability,
  type SocialReadProvider,
} from "./social-read-provider";

export const X_PROVIDER_ID = "x-official";
/** Fixed official upstream. Never derived from user input. */
export const X_API_BASE = "https://api.x.com/2";
export const X_BEARER_TOKEN_ENV = "X_API_BEARER_TOKEN";
export const X_TIMEOUT_MS = 10_000;

/** Provider minimum for `/2/users/{id}/tweets`. Fewer are trimmed locally. */
export const X_MIN_MAX_RESULTS = 5;
/** Conservative SE-2.1 ceiling on returned posts. One page only. */
export const X_MAX_RETURNED_POSTS = 10;

const X_HOSTS = ["x.com", "twitter.com", "mobile.twitter.com"];
/** Path roots that are never a username. */
const X_RESERVED = new Set([
  "i",
  "home",
  "search",
  "explore",
  "notifications",
  "messages",
  "settings",
  "compose",
  "intent",
  "share",
  "login",
  "signup",
]);

const USERNAME_RE = /^[A-Za-z0-9_]{1,15}$/;
const POST_ID_RE = /^[0-9]{1,32}$/;

export type XTarget =
  | { kind: "post"; postId: string; canonicalUrl: string }
  | { kind: "profile"; username: string; canonicalUrl: string };

export type XResolution =
  | { ok: true; target: XTarget }
  | { ok: false; code: Extract<ProviderErrorCode, "INVALID_URL" | "UNSUPPORTED_PLATFORM"> };

/**
 * Parse an X/Twitter public URL locally, before any network call.
 * Only https/http are admitted; credentials, ports and foreign hosts are rejected.
 */
export function resolveXUrl(raw: unknown): XResolution {
  if (typeof raw !== "string" || raw.trim().length === 0 || raw.length > 2048) {
    return { ok: false, code: "INVALID_URL" };
  }
  let parsed: URL;
  try {
    parsed = new URL(raw.trim());
  } catch {
    return { ok: false, code: "INVALID_URL" };
  }
  if (parsed.protocol !== "https:" && parsed.protocol !== "http:") {
    return { ok: false, code: "INVALID_URL" };
  }
  if (parsed.username || parsed.password || parsed.port) {
    return { ok: false, code: "INVALID_URL" };
  }
  const host = parsed.hostname.toLowerCase().replace(/^www\./, "");
  if (!X_HOSTS.includes(host)) return { ok: false, code: "UNSUPPORTED_PLATFORM" };

  const segments = parsed.pathname.split("/").filter(Boolean);

  // /i/web/status/{id}
  if (segments[0] === "i" && segments[1] === "web" && segments[2] === "status" && segments[3]) {
    const postId = segments[3];
    if (!POST_ID_RE.test(postId)) return { ok: false, code: "INVALID_URL" };
    return { ok: true, target: { kind: "post", postId, canonicalUrl: postUrl(postId) } };
  }

  const first = segments[0];
  if (!first || X_RESERVED.has(first.toLowerCase()) || !USERNAME_RE.test(first)) {
    return { ok: false, code: "INVALID_URL" };
  }

  // /{username}/status/{id}
  if ((segments[1] === "status" || segments[1] === "statuses") && segments[2]) {
    const postId = segments[2];
    if (!POST_ID_RE.test(postId)) return { ok: false, code: "INVALID_URL" };
    return {
      ok: true,
      target: { kind: "post", postId, canonicalUrl: `https://x.com/${first}/status/${postId}` },
    };
  }

  if (segments.length === 1) {
    return {
      ok: true,
      target: { kind: "profile", username: first, canonicalUrl: `https://x.com/${first}` },
    };
  }

  return { ok: false, code: "INVALID_URL" };
}

function postUrl(postId: string): string {
  return `https://x.com/i/web/status/${postId}`;
}

/* ---------------------------------------------------------------------------
 * Request builders (pure). Credentials are NEVER part of a URL.
 * ------------------------------------------------------------------------- */

export const X_TWEET_FIELDS = "created_at,author_id,public_metrics";
export const X_USER_FIELDS = "id,name,username";

export function buildTweetLookupUrl(postId: string): string {
  const params = new URLSearchParams({
    "tweet.fields": X_TWEET_FIELDS,
    expansions: "author_id",
    "user.fields": X_USER_FIELDS,
  });
  return `${X_API_BASE}/tweets/${encodeURIComponent(postId)}?${params.toString()}`;
}

export function buildUserByUsernameUrl(username: string): string {
  const params = new URLSearchParams({ "user.fields": X_USER_FIELDS });
  return `${X_API_BASE}/users/by/username/${encodeURIComponent(username)}?${params.toString()}`;
}

/** One page only. `max_results` respects the provider minimum; extras are trimmed locally. */
export function buildUserTweetsUrl(userId: string, limit: unknown): string {
  const params = new URLSearchParams({
    max_results: String(xMaxResults(limit)),
    "tweet.fields": X_TWEET_FIELDS,
    expansions: "author_id",
    "user.fields": X_USER_FIELDS,
  });
  return `${X_API_BASE}/users/${encodeURIComponent(userId)}/tweets?${params.toString()}`;
}

/** Requested page size sent upstream. */
export function xMaxResults(limit: unknown): number {
  const requested = typeof limit === "number" && Number.isFinite(limit) ? Math.floor(limit) : X_MAX_RETURNED_POSTS;
  const clamped = Math.min(Math.max(requested, 1), X_MAX_RETURNED_POSTS);
  return Math.max(clamped, X_MIN_MAX_RESULTS);
}

/** How many posts the caller actually receives after local trimming. */
export function xReturnLimit(limit: unknown): number {
  const requested = typeof limit === "number" && Number.isFinite(limit) ? Math.floor(limit) : X_MAX_RETURNED_POSTS;
  return Math.min(Math.max(requested, 1), X_MAX_RETURNED_POSTS);
}

/* ---------------------------------------------------------------------------
 * Response mapping (pure)
 * ------------------------------------------------------------------------- */

type Rec = Record<string, unknown>;

function asRecord(value: unknown): Rec | null {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as Rec) : null;
}

function asText(value: unknown, max: number): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed ? trimmed.slice(0, max) : null;
}

function asTimestamp(value: unknown): string | null {
  const text = asText(value, 64);
  if (!text) return null;
  const parsed = Date.parse(text);
  return Number.isFinite(parsed) ? new Date(parsed).toISOString() : null;
}

/**
 * Canonical V1 mapping of X `public_metrics`.
 *
 * views = impression_count, likes = like_count, comments = reply_count,
 * shares = retweet_count ONLY, saves = bookmark_count.
 *
 * `quote_count` is deliberately NOT represented: canonical V1 `shares` means
 * reposts, and quotes are not silently merged into it.
 */
export function mapXMetrics(rawPublicMetrics: unknown) {
  const m = asRecord(rawPublicMetrics) ?? {};
  return buildMetrics(
    {
      views: m["impression_count"],
      likes: m["like_count"],
      comments: m["reply_count"],
      shares: m["retweet_count"],
      saves: m["bookmark_count"],
    },
    null,
  );
}

type XUser = { id: string; name: string | null; username: string | null };

export function indexXUsers(includes: unknown): Map<string, XUser> {
  const map = new Map<string, XUser>();
  const users = asRecord(includes)?.["users"];
  if (!Array.isArray(users)) return map;
  for (const entry of users) {
    const record = asRecord(entry);
    const id = asText(record?.["id"], 64);
    if (!id) continue;
    map.set(id, {
      id,
      name: asText(record?.["name"], 512),
      username: asText(record?.["username"], 255),
    });
  }
  return map;
}

export function mapXPost(rawTweet: unknown, users: Map<string, XUser>): NormalizedPost | null {
  const tweet = asRecord(rawTweet);
  if (!tweet) return null;
  // Post IDs are STRINGS, always. A numeric id would lose precision.
  const externalPostId = asText(tweet["id"], 512);
  if (!externalPostId) return null;

  const authorId = asText(tweet["author_id"], 64);
  const author = authorId ? (users.get(authorId) ?? null) : null;
  const { metrics, availability } = mapXMetrics(tweet["public_metrics"]);

  return {
    platform: "x",
    externalPostId,
    canonicalUrl: author?.username
      ? `https://x.com/${author.username}/status/${externalPostId}`
      : postUrl(externalPostId),
    authorHandle: author?.username ?? null,
    authorDisplayName: author?.name ?? null,
    contentText: asText(tweet["text"], 20000),
    mediaType: null,
    publishedAt: asTimestamp(tweet["created_at"]),
    metrics,
    availability,
  };
}

export function mapXMetricsObservation(
  rawTweet: unknown,
  fallbackUrl: string,
): NormalizedMetricsObservation | null {
  const tweet = asRecord(rawTweet);
  if (!tweet) return null;
  const externalPostId = asText(tweet["id"], 512);
  const { metrics, availability } = mapXMetrics(tweet["public_metrics"]);
  return {
    platform: "x",
    externalPostId,
    canonicalUrl: externalPostId ? postUrl(externalPostId) : fallbackUrl,
    metrics,
    availability,
  };
}

export function mapXSource(rawUser: unknown): NormalizedSource | null {
  const user = asRecord(rawUser);
  const id = asText(user?.["id"], 64);
  const username = asText(user?.["username"], 255);
  if (!id || !username) return null;
  return {
    platform: "x",
    canonicalUrl: `https://x.com/${username}`,
    handle: username,
    externalAccountId: id,
    displayName: asText(user?.["name"], 512),
  };
}

/* ---------------------------------------------------------------------------
 * Errors
 * ------------------------------------------------------------------------- */

const MESSAGES: Partial<Record<ProviderErrorCode, string>> = {
  PROVIDER_NOT_CONFIGURED: "The X connection is not configured, so nothing was read.",
  UNSUPPORTED_PLATFORM: "That link is not an X link.",
  INVALID_URL: "That is not a usable public X link.",
  NOT_FOUND: "That post could not be found.",
  PRIVATE_OR_BLOCKED: "That content is private, removed, or not publicly readable.",
  UNAUTHORIZED: "X rejected the configured credentials.",
  RATE_LIMITED: "X is rate limiting requests. Try again shortly.",
  PROVIDER_UNAVAILABLE: "X is temporarily unavailable.",
  TIMEOUT: "X did not respond in time.",
  MALFORMED_RESPONSE: "X returned an unreadable response.",
  UNKNOWN: "X returned an unexpected error.",
};

export function xMessageFor(code: ProviderErrorCode): string {
  return MESSAGES[code] ?? "X returned an unexpected error.";
}

export function mapXHttpStatus(status: number): ProviderErrorCode {
  if (status === 400) return "INVALID_URL";
  if (status === 401) return "UNAUTHORIZED";
  if (status === 403) return "PRIVATE_OR_BLOCKED";
  if (status === 404) return "NOT_FOUND";
  if (status === 429) return "RATE_LIMITED";
  if (status >= 500) return "PROVIDER_UNAVAILABLE";
  return "UNKNOWN";
}

function fail<T>(code: ProviderErrorCode): ProviderResult<T> {
  return providerFailure<T>(X_PROVIDER_ID, code, xMessageFor(code));
}

/** Re-exported for fixture tests that assert the sanitized failure envelope. */
export function xSanitizedFailure(code: ProviderErrorCode): ProviderError {
  const result = fail<never>(code);
  return (result as Extract<typeof result, { ok: false }>).error;
}

/* ---------------------------------------------------------------------------
 * Transport
 * ------------------------------------------------------------------------- */

function readBearerToken(): string | null {
  const token = process.env[X_BEARER_TOKEN_ENV]?.trim();
  return token ? token : null;
}

type Transport = { ok: true; body: unknown } | { ok: false; code: ProviderErrorCode };

/** Single GET. Bearer in a header only; no retry, ever. */
async function getJson(url: string, bearerToken: string): Promise<Transport> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), X_TIMEOUT_MS);
  try {
    const response = await fetch(url, {
      method: "GET",
      headers: { Authorization: `Bearer ${bearerToken}`, Accept: "application/json" },
      signal: controller.signal,
    });
    if (!response.ok) return { ok: false, code: mapXHttpStatus(response.status) };
    try {
      return { ok: true, body: await response.json() };
    } catch {
      return { ok: false, code: "MALFORMED_RESPONSE" };
    }
  } catch (cause) {
    const aborted = cause instanceof Error && cause.name === "AbortError";
    return { ok: false, code: aborted ? "TIMEOUT" : "PROVIDER_UNAVAILABLE" };
  } finally {
    clearTimeout(timer);
  }
}

/* ---------------------------------------------------------------------------
 * Provider
 * ------------------------------------------------------------------------- */

async function readPostPayload(
  url: unknown,
): Promise<{ ok: true; body: Rec; canonicalUrl: string } | { ok: false; code: ProviderErrorCode }> {
  const resolved = resolveXUrl(url);
  if (!resolved.ok) return { ok: false, code: resolved.code };
  if (resolved.target.kind !== "post") return { ok: false, code: "INVALID_URL" };

  // Missing credentials short-circuit BEFORE any fetch is constructed.
  const token = readBearerToken();
  if (!token) return { ok: false, code: "PROVIDER_NOT_CONFIGURED" };

  const transport = await getJson(buildTweetLookupUrl(resolved.target.postId), token);
  if (!transport.ok) return { ok: false, code: transport.code };
  const body = asRecord(transport.body);
  if (!body || !asRecord(body["data"])) return { ok: false, code: "MALFORMED_RESPONSE" };
  return { ok: true, body, canonicalUrl: resolved.target.canonicalUrl };
}

export const xReadProvider: SocialReadProvider = {
  id: X_PROVIDER_ID,

  supports(platform: SocialPlatform, capability: SocialReadCapability): boolean {
    return (
      platform === "x" && ["post", "source_recent_posts", "metrics"].includes(capability)
    );
  },

  async fetchPostByUrl({ url }) {
    const payload = await readPostPayload(url);
    if (!payload.ok) return fail<NormalizedPost>(payload.code);
    const mapped = mapXPost(payload.body["data"], indexXUsers(payload.body["includes"]));
    if (!mapped) return fail<NormalizedPost>("MALFORMED_RESPONSE");
    return providerSuccess<NormalizedPost>(X_PROVIDER_ID, mapped, { billable: true, units: 1 });
  },

  async fetchPostMetrics({ url }) {
    const payload = await readPostPayload(url);
    if (!payload.ok) return fail<NormalizedMetricsObservation>(payload.code);
    const mapped = mapXMetricsObservation(payload.body["data"], payload.canonicalUrl);
    if (!mapped) return fail<NormalizedMetricsObservation>("MALFORMED_RESPONSE");
    return providerSuccess<NormalizedMetricsObservation>(X_PROVIDER_ID, mapped, {
      billable: true,
      units: 1,
    });
  },

  async fetchSourceRecentPosts({ url, limit }) {
    const resolved = resolveXUrl(url);
    if (!resolved.ok) return fail<NormalizedSourceRecentPosts>(resolved.code);
    if (resolved.target.kind !== "profile") {
      return fail<NormalizedSourceRecentPosts>("INVALID_URL");
    }

    const token = readBearerToken();
    if (!token) return fail<NormalizedSourceRecentPosts>("PROVIDER_NOT_CONFIGURED");

    const userResponse = await getJson(buildUserByUsernameUrl(resolved.target.username), token);
    if (!userResponse.ok) return fail<NormalizedSourceRecentPosts>(userResponse.code);
    const source = mapXSource(asRecord(userResponse.body)?.["data"]);
    if (!source || !source.externalAccountId) {
      return fail<NormalizedSourceRecentPosts>("MALFORMED_RESPONSE");
    }

    // Exactly one page. No pagination token is ever followed.
    const tweetsResponse = await getJson(
      buildUserTweetsUrl(source.externalAccountId, limit),
      token,
    );
    if (!tweetsResponse.ok) return fail<NormalizedSourceRecentPosts>(tweetsResponse.code);

    const body = asRecord(tweetsResponse.body);
    const rawPosts = Array.isArray(body?.["data"]) ? (body?.["data"] as unknown[]) : [];
    const users = indexXUsers(body?.["includes"]);
    const posts = rawPosts
      .map((entry) => mapXPost(entry, users))
      .filter((post): post is NormalizedPost => post !== null)
      .slice(0, xReturnLimit(limit));

    const nextToken = asText(asRecord(body?.["meta"])?.["next_token"], 512);

    return providerSuccess<NormalizedSourceRecentPosts>(
      X_PROVIDER_ID,
      { source, posts, hasMore: nextToken !== null },
      // A source read mixes user and post resources, so a single unit count
      // would be an assertion we cannot make honestly.
      { billable: true, units: null },
    );
  },
};
