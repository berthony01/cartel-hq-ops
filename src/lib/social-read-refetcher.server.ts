/**
 * SE-2 — Refetcher READ adapter (SERVER ONLY).
 *
 * This file is blocked from client bundles by its `.server.ts` name and must be
 * reached only from a server function handler.
 *
 * PROVISIONAL V1 provider. Everything vendor-specific lives in this file; the
 * rest of the system speaks only `SocialReadProvider`. Replacing Refetcher with
 * an official-API adapter means adding a sibling file, not touching callers or
 * schema.
 *
 * Hard boundaries:
 * - READ only: post, one page of a public source's recent posts, post metrics.
 * - No publish, OAuth, engagement, DM, follow or bookmark capability exists.
 * - No retry, no polling, no scheduling, no persistence, no Supabase access.
 * - The upstream host is a fixed constant; caller input can never redirect it.
 * - `REFETCHER_API_KEY` is read inside the call path only, never returned,
 *   logged, or embedded in an error.
 * - No provider price is encoded anywhere. Pricing is commercial, not architecture.
 */

import {
  buildMetrics,
  emptyMetrics,
  isSocialPlatform,
  providerFailure,
  providerSuccess,
  unknownAvailability,
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

export const REFETCHER_PROVIDER_ID = "refetcher";
/** Fixed upstream. Never derived from user input. */
export const REFETCHER_ENDPOINT = "https://api.refetcher.com/";
export const REFETCHER_API_KEY_ENV = "REFETCHER_API_KEY";
/**
 * 10s. Slightly above the 8s chain-RPC precedent because a scrape round-trip is
 * slower than a JSON-RPC read, and a premature abort would risk a charged-but-
 * discarded provider unit.
 */
export const REFETCHER_TIMEOUT_MS = 10_000;

/** Host allowlist per platform. Anything else is INVALID_URL / UNSUPPORTED_PLATFORM. */
const PLATFORM_HOSTS: Record<SocialPlatform, readonly string[]> = {
  x: ["x.com", "twitter.com", "mobile.twitter.com"],
  instagram: ["instagram.com"],
  tiktok: ["tiktok.com", "vm.tiktok.com"],
  youtube: ["youtube.com", "m.youtube.com", "youtu.be"],
  facebook: ["facebook.com", "m.facebook.com", "fb.watch"],
};

export type UrlResolution =
  | { ok: true; platform: SocialPlatform; canonicalUrl: string }
  | { ok: false; code: Extract<ProviderErrorCode, "INVALID_URL" | "UNSUPPORTED_PLATFORM"> };

/**
 * Parse and classify a public social URL locally, before any network call.
 * Only https/http are admitted; credentials, ports and unknown hosts are rejected.
 */
export function resolvePublicSocialUrl(raw: unknown): UrlResolution {
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
  for (const platform of Object.keys(PLATFORM_HOSTS) as SocialPlatform[]) {
    const hosts = PLATFORM_HOSTS[platform];
    if (hosts.includes(host)) {
      const canonicalUrl = `https://${host}${parsed.pathname}${parsed.search}`.replace(/\/$/, "");
      return { ok: true, platform, canonicalUrl: canonicalUrl || `https://${host}` };
    }
  }

  return { ok: false, code: "UNSUPPORTED_PLATFORM" };
}

/* ---------------------------------------------------------------------------
 * Error mapping (pure)
 * ------------------------------------------------------------------------- */

const MESSAGES: Record<ProviderErrorCode, string> = {
  PROVIDER_NOT_CONFIGURED: "The social data provider is not configured, so nothing was read.",
  UNSUPPORTED_PLATFORM: "That link is not one of the supported social platforms.",
  INVALID_URL: "That is not a usable public social link.",
  NOT_FOUND: "That post could not be found.",
  PRIVATE_OR_BLOCKED: "That content is private, removed, or not publicly readable.",
  MINIMUM_AGE_REQUIRED: "That content is age restricted and cannot be read publicly.",
  MISSING_METRICS: "The provider returned no public metrics for that content.",
  UNAUTHORIZED: "The social data provider rejected the configured credentials.",
  INSUFFICIENT_BALANCE: "The social data provider account has no remaining balance.",
  BILLING_UNAVAILABLE: "The social data provider's billing service is temporarily unavailable.",
  RATE_LIMITED: "The social data provider is rate limiting requests. Try again shortly.",
  PROVIDER_UNAVAILABLE: "The social data provider is temporarily unavailable.",
  TIMEOUT: "The social data provider did not respond in time.",
  MALFORMED_RESPONSE: "The social data provider returned an unreadable response.",
  UNKNOWN: "The social data provider returned an unexpected error.",
};

export function messageFor(code: ProviderErrorCode): string {
  return MESSAGES[code];
}

/** Request-level HTTP status → canonical code. */
export function mapHttpStatus(status: number): ProviderErrorCode {
  if (status === 400) return "INVALID_URL";
  if (status === 401 || status === 403) return "UNAUTHORIZED";
  if (status === 402) return "INSUFFICIENT_BALANCE";
  if (status === 404) return "NOT_FOUND";
  if (status === 408) return "TIMEOUT";
  if (status === 429) return "RATE_LIMITED";
  if (status === 503) return "BILLING_UNAVAILABLE";
  if (status >= 500) return "PROVIDER_UNAVAILABLE";
  return "UNKNOWN";
}

/** Per-result error category → canonical code. */
export function mapResultCategory(raw: unknown): ProviderErrorCode {
  const token = typeof raw === "string" ? raw.trim().toLowerCase() : "";
  switch (token) {
    case "bad_url":
      return "INVALID_URL";
    case "unsupported_platform":
      return "UNSUPPORTED_PLATFORM";
    case "private_or_removed":
      return "PRIVATE_OR_BLOCKED";
    case "minimum_age_required":
      return "MINIMUM_AGE_REQUIRED";
    case "missing_metrics":
      return "MISSING_METRICS";
    case "not_found":
      return "NOT_FOUND";
    case "rate_limited":
      return "RATE_LIMITED";
    case "timeout":
      return "TIMEOUT";
    default:
      return "UNKNOWN";
  }
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
  if (!trimmed) return null;
  return trimmed.slice(0, max);
}

function asTimestamp(value: unknown): string | null {
  const text = asText(value, 64);
  if (!text) return null;
  const parsed = Date.parse(text);
  return Number.isFinite(parsed) ? new Date(parsed).toISOString() : null;
}

/**
 * Pull `results[0]` out of a Refetcher body. SE-2 never batches, so anything
 * other than exactly one result entry is a malformed response for our purposes.
 */
export function firstResult(body: unknown): Rec | null {
  const record = asRecord(body);
  if (!record) return null;
  const results = record["results"];
  if (!Array.isArray(results) || results.length !== 1) return null;
  return asRecord(results[0]);
}

/** Per-result failure, if any. Returns `null` when the result succeeded. */
export function resultFailureCode(result: Rec): ProviderErrorCode | null {
  if (result["success"] === true) return null;
  const error = asRecord(result["error"]);
  const category = error?.["category"] ?? error?.["code"] ?? result["error"] ?? result["category"];
  return mapResultCategory(category);
}

function platformOf(result: Rec, fallback: SocialPlatform): SocialPlatform {
  const raw = result["platform"];
  return isSocialPlatform(raw) ? raw : fallback;
}

/**
 * Identifier derived from a canonical link, used ONLY as a last-resort id for a
 * links-only recent reference. A YouTube watch link carries its id in `?v=`;
 * everything else uses the last path segment.
 */
function idFromUrl(url: string): string | null {
  try {
    const parsed = new URL(url);
    const videoParam = parsed.searchParams.get("v");
    if (videoParam) return videoParam.slice(0, 512);
    const segments = parsed.pathname.split("/").filter(Boolean);
    const last = segments[segments.length - 1];
    return last ? last.slice(0, 512) : null;
  } catch {
    return null;
  }
}

/**
 * Map one successful Refetcher post result into a canonical post.
 * Returns `null` when the payload lacks the identity fields we require.
 */
export function mapPost(
  result: Rec,
  fallbackPlatform: SocialPlatform,
  fallbackUrl: string,
): NormalizedPost | null {
  const post = asRecord(result["post"]) ?? result;
  const author = asRecord(result["author"]) ?? asRecord(post["author"]);

  // Documented canonical link is `normalizedUrl`; `url` is only a fallback.
  const canonicalUrl =
    asText(post["normalizedUrl"], 2048) ??
    asText(post["url"], 2048) ??
    asText(result["normalizedUrl"], 2048) ??
    asText(result["url"], 2048) ??
    fallbackUrl;

  const externalPostId =
    asText(post["id"], 512) ??
    asText(post["postId"], 512) ??
    asText(post["videoId"], 512) ??
    asText(post["shortcode"], 512) ??
    asText(post["externalId"], 512) ??
    asText(result["id"], 512) ??
    // Links-only recent references carry no id field; derive it from the
    // canonical link rather than dropping a real item or inventing a value.
    idFromUrl(canonicalUrl);
  if (!externalPostId) return null;

  const { metrics, availability } = buildMetrics(
    result["metrics"] ?? post["metrics"],
    result["metricAvailability"] ?? post["metricAvailability"],
  );

  return {
    platform: platformOf(result, fallbackPlatform),
    externalPostId,
    canonicalUrl,
    authorHandle: asText(author?.["handle"] ?? author?.["username"], 255),
    authorDisplayName: asText(author?.["displayName"] ?? author?.["name"], 512),
    // Documented post content field is `caption`.
    contentText: asText(post["caption"] ?? post["text"] ?? post["title"], 20000),
    mediaType: asText(post["mediaType"] ?? post["type"], 64),
    publishedAt: asTimestamp(post["publishedAt"] ?? post["createdAt"] ?? post["timestamp"]),
    metrics,
    availability,
  };
}

/** Map one successful Refetcher result into a metrics-only observation. */
export function mapMetricsObservation(
  result: Rec,
  fallbackPlatform: SocialPlatform,
  fallbackUrl: string,
): NormalizedMetricsObservation {
  const post = asRecord(result["post"]) ?? {};
  const { metrics, availability } = buildMetrics(
    result["metrics"] ?? post["metrics"],
    result["metricAvailability"] ?? post["metricAvailability"],
  );
  return {
    platform: platformOf(result, fallbackPlatform),
    externalPostId:
      asText(post["id"], 512) ??
      asText(post["postId"], 512) ??
      asText(post["videoId"], 512) ??
      asText(result["id"], 512),
    canonicalUrl: asText(post["normalizedUrl"], 2048) ?? asText(post["url"], 2048) ?? fallbackUrl,
    metrics,
    availability,
  };
}

/**
 * Map one successful Refetcher source result into a canonical source plus a
 * SINGLE page of recent items.
 *
 * Two documented response shapes are accepted and normalized to one contract:
 * - Instagram / TikTok / Facebook / X: `profile` + `recentPosts`, paging under
 *   `pageInfo.recentPosts`.
 * - YouTube: `channel` + `recentVideos`, paging under `pageInfo.recentVideos`.
 *
 * Lightweight recent references often carry no metrics. Those stay all-null
 * with `unknown` availability; nothing is invented and no second call is made.
 */
export function mapSourceRecentPosts(
  result: Rec,
  fallbackPlatform: SocialPlatform,
  fallbackUrl: string,
  limit: number,
): NormalizedSourceRecentPosts | null {
  const channel = asRecord(result["channel"]);
  const profile = asRecord(result["profile"]) ?? channel;
  if (!profile) return null;
  const platform = platformOf(result, fallbackPlatform);

  const source: NormalizedSource = {
    platform,
    canonicalUrl:
      asText(profile["normalizedUrl"], 2048) ?? asText(profile["url"], 2048) ?? fallbackUrl,
    handle: asText(profile["handle"] ?? profile["username"], 255),
    externalAccountId: asText(profile["id"] ?? profile["channelId"] ?? profile["accountId"], 512),
    displayName: asText(profile["name"] ?? profile["displayName"], 512),
  };

  const rawItems =
    result["recentPosts"] ??
    result["recentVideos"] ??
    profile["recentPosts"] ??
    profile["recentVideos"];

  const posts: NormalizedPost[] = [];
  if (Array.isArray(rawItems)) {
    for (const entry of rawItems) {
      const record = asRecord(entry);
      if (!record) continue;
      const mapped = mapPost(
        { platform, post: record, metrics: record["metrics"] },
        platform,
        source.canonicalUrl,
      );
      if (mapped) posts.push(mapped);
      if (posts.length >= limit) break;
    }
  }

  const pageInfo = asRecord(result["pageInfo"]);
  const postsPage = asRecord(pageInfo?.["recentPosts"]);
  const videosPage = asRecord(pageInfo?.["recentVideos"]);
  const pagination = asRecord(result["pagination"]);
  const hasMore =
    postsPage?.["hasNextPage"] === true ||
    videosPage?.["hasNextPage"] === true ||
    pagination?.["hasMore"] === true ||
    typeof pagination?.["nextCursor"] === "string" ||
    (Array.isArray(rawItems) && rawItems.length > posts.length);

  return { source, posts, hasMore };
}

/* ---------------------------------------------------------------------------
 * Transport
 * ------------------------------------------------------------------------- */

export const MAX_RECENT_POSTS = 25;

/** Clamp a caller limit into safe single-page semantics. */
export function clampLimit(raw: unknown): number {
  const value = typeof raw === "number" && Number.isFinite(raw) ? Math.floor(raw) : 10;
  return Math.min(Math.max(value, 1), MAX_RECENT_POSTS);
}

type Transport =
  | { ok: true; body: unknown }
  | { ok: false; code: ProviderErrorCode };

async function callRefetcher(apiKey: string, payload: Rec): Promise<Transport> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), REFETCHER_TIMEOUT_MS);
  try {
    const response = await fetch(REFETCHER_ENDPOINT, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        // Header auth only. The key never appears in a URL, a log or an error.
        "X-API-Key": apiKey,
      },
      body: JSON.stringify(payload),
      signal: controller.signal,
    });

    if (!response.ok) return { ok: false, code: mapHttpStatus(response.status) };

    let body: unknown;
    try {
      body = await response.json();
    } catch {
      return { ok: false, code: "MALFORMED_RESPONSE" };
    }
    return { ok: true, body };
  } catch (cause) {
    const aborted = cause instanceof Error && cause.name === "AbortError";
    // Never surface the endpoint or the underlying error text.
    return { ok: false, code: aborted ? "TIMEOUT" : "PROVIDER_UNAVAILABLE" };
  } finally {
    clearTimeout(timer);
  }
}

function readApiKey(): string | null {
  const key = process.env[REFETCHER_API_KEY_ENV]?.trim();
  return key ? key : null;
}

function fail<T>(code: ProviderErrorCode): ProviderResult<T> {
  return providerFailure<T>(REFETCHER_PROVIDER_ID, code, messageFor(code));
}

/* ---------------------------------------------------------------------------
 * Request bodies (pure) — mirror the documented Refetcher request contract.
 *
 * Exactly ONE target per call. Single-target semantics are expressed by a
 * SINGULAR target field (`url`, `profileUrl` or `channelUrl`); there is no
 * `targets` array and SE-2 never batches.
 * ------------------------------------------------------------------------- */

/** Post / video / metrics read, all five platforms. */
export function buildPostRequestBody(canonicalUrl: string): Rec {
  return { url: canonicalUrl };
}

/**
 * Profile read.
 * - Instagram / TikTok / Facebook / X: `profileUrl` + `includeRecentPosts`.
 *   X additionally takes `sort: "latest"`.
 * - YouTube: a channel read with `channelUrl` + `includeRecentVideos`.
 */
export function buildSourceRequestBody(
  platform: SocialPlatform,
  canonicalUrl: string,
  safeLimit: number,
): Rec {
  if (platform === "youtube") {
    return {
      type: "channel",
      platform: "youtube",
      channelUrl: canonicalUrl,
      includeRecentVideos: true,
      recentVideosLimit: safeLimit,
    };
  }
  return {
    profileUrl: canonicalUrl,
    includeRecentPosts: true,
    pages: 1,
    recentPostsLimit: safeLimit,
    ...(platform === "x" ? { sort: "latest" } : {}),
  };
}

async function readOne<T>(
  url: unknown,
  buildBody: (platform: SocialPlatform, canonicalUrl: string) => Rec,
  map: (result: Rec, platform: SocialPlatform, canonicalUrl: string) => T | null,
  units: number | null,
): Promise<ProviderResult<T>> {
  const resolved = resolvePublicSocialUrl(url);
  if (!resolved.ok) return fail<T>(resolved.code);

  // Missing credentials short-circuit BEFORE any fetch is constructed.
  const apiKey = readApiKey();
  if (!apiKey) return fail<T>("PROVIDER_NOT_CONFIGURED");

  const transport = await callRefetcher(apiKey, buildBody(resolved.platform, resolved.canonicalUrl));
  if (!transport.ok) return fail<T>(transport.code);

  const result = firstResult(transport.body);
  if (!result) return fail<T>("MALFORMED_RESPONSE");

  const failure = resultFailureCode(result);
  if (failure) return fail<T>(failure);

  const mapped = map(result, resolved.platform, resolved.canonicalUrl);
  if (mapped === null) return fail<T>("MALFORMED_RESPONSE");

  const observedAt = asTimestamp(result["scrapedAt"]) ?? new Date().toISOString();
  return providerSuccess<T>(REFETCHER_PROVIDER_ID, mapped, {
    billable: true,
    units,
    observedAt,
  });
}

export const refetcherReadProvider: SocialReadProvider = {
  id: REFETCHER_PROVIDER_ID,

  supports(platform: SocialPlatform, capability: SocialReadCapability): boolean {
    return isSocialPlatform(platform) && ["post", "source_recent_posts", "metrics"].includes(capability);
  },

  fetchPostByUrl({ url }) {
    return readOne<NormalizedPost>(
      url,
      (_platform, canonicalUrl) => buildPostRequestBody(canonicalUrl),
      (result, platform, canonicalUrl) => mapPost(result, platform, canonicalUrl),
      1,
    );
  },

  fetchPostMetrics({ url }) {
    return readOne<NormalizedMetricsObservation>(
      url,
      (_platform, canonicalUrl) => buildPostRequestBody(canonicalUrl),
      (result, platform, canonicalUrl) => mapMetricsObservation(result, platform, canonicalUrl),
      1,
    );
  },

  fetchSourceRecentPosts({ url, limit }) {
    const safeLimit = clampLimit(limit);
    return readOne<NormalizedSourceRecentPosts>(
      url,
      (platform, canonicalUrl) => buildSourceRequestBody(platform, canonicalUrl, safeLimit),
      (result, platform, canonicalUrl) =>
        mapSourceRecentPosts(result, platform, canonicalUrl, safeLimit),
      // Profile page billing can vary by platform, so units stay unasserted.
      null,
    );
  },
};

/** Re-exported for fixture tests that assert the sanitized failure envelope. */
export function sanitizedFailure(code: ProviderErrorCode): ProviderError {
  const result = fail<never>(code);
  return (result as Extract<typeof result, { ok: false }>).error;
}

export const EMPTY_METRICS_FOR_TESTS = { metrics: emptyMetrics(), availability: unknownAvailability() };
