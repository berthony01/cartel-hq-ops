/**
 * SE-5 — Official X API v2 metrics module (shared by `social-mission-runner`
 * and `social-mission-telegram`).
 *
 * DEPLOYMENT NOTE: this file is the standard Supabase `_shared` module. It must
 * be deployed alongside both functions (`supabase/functions/_shared/x-metrics.ts`).
 *
 * Hard boundaries, frozen for SE-5:
 * - OFFICIAL X API ONLY. Exactly one endpoint is ever contacted:
 *   `GET https://api.x.com/2/tweets?ids=...`. There is no scraping path, no
 *   Refetcher fallback, no unofficial host and no write/publish scope.
 * - The bearer token is read from `X_API_BEARER_TOKEN` by the caller and is
 *   never logged, never returned, and never placed in a URL or an error string.
 * - Metric mapping is exact and quote_count is DELIBERATELY EXCLUDED:
 *     impression_count -> views
 *     like_count       -> likes
 *     reply_count      -> comments
 *     retweet_count    -> shares
 *     bookmark_count   -> saves
 * - A metric the provider does not return stays `null`. Nothing is ever
 *   defaulted to 0.
 * - Batch lookup is capped at 100 ids per request, after de-duplication.
 */

/** The only host this module will ever contact. */
export const X_API_BASE = "https://api.x.com/2/tweets";
export const X_BATCH_MAX = 100;
export const X_PROVIDER = "x-official";
export const X_TIMEOUT_MS = 12_000;

export type XCanonicalMetrics = {
  views: number | null;
  likes: number | null;
  comments: number | null;
  shares: number | null;
  saves: number | null;
};

export type XMetricAvailability = {
  views: boolean;
  likes: boolean;
  comments: boolean;
  shares: boolean;
  saves: boolean;
};

export type XPostMetrics = {
  externalPostId: string;
  metrics: XCanonicalMetrics;
  availability: XMetricAvailability;
};

export const X_EMPTY_METRICS: XCanonicalMetrics = {
  views: null,
  likes: null,
  comments: null,
  shares: null,
  saves: null,
};

function count(value: unknown): number | null {
  if (typeof value !== "number" || !Number.isFinite(value)) return null;
  if (!Number.isInteger(value) || value < 0) return null;
  return value;
}

/**
 * Exact public_metrics mapping. `quote_count` is intentionally never merged
 * into `shares`: a quote is not a repost, and conflating them would overstate
 * the number.
 */
export function mapPublicMetrics(publicMetrics: unknown): XCanonicalMetrics {
  const pm = (publicMetrics ?? {}) as Record<string, unknown>;
  return {
    views: count(pm["impression_count"]),
    likes: count(pm["like_count"]),
    comments: count(pm["reply_count"]),
    shares: count(pm["retweet_count"]),
    saves: count(pm["bookmark_count"]),
  };
}

export function availabilityOf(metrics: XCanonicalMetrics): XMetricAvailability {
  return {
    views: metrics.views !== null,
    likes: metrics.likes !== null,
    comments: metrics.comments !== null,
    shares: metrics.shares !== null,
    saves: metrics.saves !== null,
  };
}

/** Valid public X status ids only. Anything else can never reach the API. */
export function isXPostId(value: unknown): value is string {
  return typeof value === "string" && /^[0-9]{1,32}$/.test(value);
}

/** De-duplicate, then split into batches of at most 100 ids. */
export function batchPostIds(ids: readonly unknown[], size: number = X_BATCH_MAX): string[][] {
  const limit = Math.max(1, Math.min(Math.floor(size) || X_BATCH_MAX, X_BATCH_MAX));
  const unique: string[] = [];
  const seen = new Set<string>();
  for (const id of ids) {
    if (!isXPostId(id) || seen.has(id)) continue;
    seen.add(id);
    unique.push(id);
  }
  const batches: string[][] = [];
  for (let i = 0; i < unique.length; i += limit) {
    batches.push(unique.slice(i, i + limit));
  }
  return batches;
}

export function buildLookupUrl(ids: readonly string[]): string {
  const params = new URLSearchParams({
    ids: ids.join(","),
    "tweet.fields": "public_metrics,created_at,author_id",
  });
  return `${X_API_BASE}?${params.toString()}`;
}

/** Deterministic minute bucket, so a retry inside one minute is idempotent. */
export function minuteBucket(atMs: number = Date.now()): string {
  return new Date(Math.floor(atMs / 60_000) * 60_000).toISOString();
}

/**
 * The visible-metric fingerprint of a card. The runner edits Telegram ONLY when
 * this string changes, so an unchanged minute performs zero Telegram calls.
 */
export function metricSignature(
  metrics: XCanonicalMetrics,
  state: { accomplished: boolean; missionStatus: string },
): string {
  const part = (value: number | null) => (value === null ? "n" : String(value));
  return [
    state.missionStatus.toUpperCase(),
    state.accomplished ? "A" : "-",
    part(metrics.views),
    part(metrics.likes),
    part(metrics.comments),
    part(metrics.shares),
    part(metrics.saves),
  ].join("|");
}

export type XLookupResult =
  | { ok: true; posts: Map<string, XPostMetrics>; observedAt: string }
  | { ok: false; reason: string };

/**
 * ONE official batch lookup. On any failure the caller must treat the result as
 * "metrics unavailable right now": no snapshot is written, no metric is faked,
 * and nothing is retried inside this call.
 *
 * The returned `reason` never contains the bearer token or the request URL.
 */
export async function lookupXPostMetrics(
  bearerToken: string,
  ids: readonly string[],
  fetchImpl: typeof fetch = fetch,
): Promise<XLookupResult> {
  if (!bearerToken) return { ok: false, reason: "X credentials are not configured." };
  const batch = ids.filter(isXPostId).slice(0, X_BATCH_MAX);
  if (batch.length === 0) return { ok: false, reason: "No valid X post ids were supplied." };

  let response: Response;
  try {
    response = await fetchImpl(buildLookupUrl(batch), {
      method: "GET",
      headers: { Authorization: `Bearer ${bearerToken}`, Accept: "application/json" },
      signal: AbortSignal.timeout(X_TIMEOUT_MS),
    });
  } catch {
    return { ok: false, reason: "The official X API did not respond in time." };
  }

  if (!response.ok) {
    // The status is diagnostic; the body may echo the request and is not used.
    return { ok: false, reason: `The official X API returned ${response.status}.` };
  }

  let payload: unknown = null;
  try {
    payload = await response.json();
  } catch {
    return { ok: false, reason: "The official X API returned an unreadable response." };
  }

  const data = payload && typeof payload === "object" ? (payload as Record<string, unknown>)["data"] : null;
  const rows = Array.isArray(data) ? (data as Record<string, unknown>[]) : [];
  const posts = new Map<string, XPostMetrics>();
  for (const row of rows) {
    const id = row?.["id"];
    if (!isXPostId(id)) continue;
    const metrics = mapPublicMetrics(row["public_metrics"]);
    posts.set(id, { externalPostId: id, metrics, availability: availabilityOf(metrics) });
  }

  // A 200 with no usable rows is still "unavailable", never zeroes.
  if (posts.size === 0) {
    return { ok: false, reason: "The official X API returned no readable post metrics." };
  }

  return { ok: true, posts, observedAt: new Date().toISOString() };
}
