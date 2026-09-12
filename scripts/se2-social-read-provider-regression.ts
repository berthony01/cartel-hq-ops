/**
 * SE-2 — Social read provider regression.
 *
 * PURE LOGIC + FIXTURES + SOURCE assertions only. No network call, no provider
 * call, no database, no secret is read. Fixtures are hand-written shapes that
 * mirror the documented Refetcher response contract; no live payload is used.
 */
import { readFileSync } from "node:fs";
import {
  RETRYABLE_PROVIDER_ERROR_CODES,
  SOCIAL_METRIC_KEYS,
  buildMetrics,
  isSocialPlatform,
  providerFailure,
  toMetricValue,
  type ProviderErrorCode,
} from "../src/lib/social-read-provider";
import {
  clampLimit,
  firstResult,
  mapHttpStatus,
  mapMetricsObservation,
  mapPost,
  mapResultCategory,
  mapSourceRecentPosts,
  resolvePublicSocialUrl,
  resultFailureCode,
  sanitizedFailure,
} from "../src/lib/social-read-refetcher.server";

const CONTRACT = "src/lib/social-read-provider.ts";
const ADAPTER = "src/lib/social-read-refetcher.server.ts";
const BOUNDARY = "src/lib/social-read.functions.ts";

const read = (p: string) => readFileSync(p, "utf8");
const stripComments = (s: string) =>
  s.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");

const contractSrc = stripComments(read(CONTRACT));
const adapterSrc = stripComments(read(ADAPTER));
const boundarySrc = stripComments(read(BOUNDARY));
const allSrc = contractSrc + adapterSrc + boundarySrc;

let failures = 0;
function check(id: string, ok: boolean, detail: string) {
  if (ok) console.log(`PASS ${id} — ${detail}`);
  else {
    failures += 1;
    console.error(`FAIL ${id} — ${detail}`);
  }
}

/* -------------------------------------------------------------------------
 * 1. Interface shape: exactly three read capabilities, no write capability
 * ---------------------------------------------------------------------- */

check(
  "iface-three-methods",
  ["fetchPostByUrl", "fetchSourceRecentPosts", "fetchPostMetrics"].every((m) =>
    contractSrc.includes(`${m}(`),
  ),
  "SocialReadProvider declares the three read operations",
);

const FORBIDDEN = [
  "publishPost",
  "publishTo",
  "createPost",
  "schedule",
  "deletePost",
  "oauth",
  "OAuth",
  "like(",
  "repost",
  "retweet",
  "follow(",
  "unfollow",
  "sendDm",
  "directMessage",
  "bookmark",
  "comment(",
];
for (const token of FORBIDDEN) {
  check(
    `iface-no-${token.replace(/[^a-z]/gi, "")}`,
    !allSrc.includes(token),
    `no "${token}" capability anywhere in SE-2 source`,
  );
}

check(
  "iface-capabilities-frozen",
  contractSrc.includes(`["post", "source_recent_posts", "metrics"] as const`),
  "capability union is exactly post / source_recent_posts / metrics",
);

/* -------------------------------------------------------------------------
 * 2. URL resolution
 * ---------------------------------------------------------------------- */

const ACCEPTED: Array<[string, string]> = [
  ["https://x.com/pepecartel/status/1234567890", "x"],
  ["https://twitter.com/pepecartel/status/1234567890", "x"],
  ["https://www.instagram.com/p/ABC123/", "instagram"],
  ["https://www.tiktok.com/@pepecartel/video/7300000000000000000", "tiktok"],
  ["https://www.youtube.com/watch?v=dQw4w9WgXcQ", "youtube"],
  ["https://youtu.be/dQw4w9WgXcQ", "youtube"],
  ["https://www.facebook.com/pepecartel/posts/123", "facebook"],
];
for (const [url, platform] of ACCEPTED) {
  const resolved = resolvePublicSocialUrl(url);
  check(
    `url-accept-${platform}-${url.slice(8, 22)}`,
    resolved.ok && resolved.platform === platform,
    `${url} resolves to ${platform}`,
  );
}

const REJECTED: Array<[string, ProviderErrorCode]> = [
  ["https://evil.example.com/x.com/status/1", "UNSUPPORTED_PLATFORM"],
  ["https://linkedin.com/feed/update/1", "UNSUPPORTED_PLATFORM"],
  ["javascript:alert(1)", "INVALID_URL"],
  ["file:///etc/passwd", "INVALID_URL"],
  ["http://user:pass@x.com/a/status/1", "INVALID_URL"],
  ["https://x.com:8443/a/status/1", "INVALID_URL"],
  ["not a url", "INVALID_URL"],
  ["", "INVALID_URL"],
];
for (const [url, code] of REJECTED) {
  const resolved = resolvePublicSocialUrl(url);
  check(
    `url-reject-${url.slice(0, 24) || "empty"}`,
    !resolved.ok && resolved.code === code,
    `${url || "(empty)"} rejected as ${code}`,
  );
}

check("url-host-fixed", adapterSrc.includes(`"https://api.refetcher.com/"`), "upstream host is a constant");
check(
  "url-host-not-derived",
  !/fetch\(\s*[^)]*resolved\.canonicalUrl/.test(adapterSrc),
  "caller input is never used as the fetch target",
);

/* -------------------------------------------------------------------------
 * 3. Successful post fixtures per platform
 * ---------------------------------------------------------------------- */

function successBody(result: Record<string, unknown>) {
  return { results: [{ success: true, ...result }] };
}

const igResult = {
  platform: "instagram",
  scrapedAt: "2026-09-12T22:00:00.000Z",
  post: {
    id: "IG_ABC123",
    url: "https://instagram.com/p/ABC123",
    caption: "gm cartel",
    mediaType: "image",
    publishedAt: "2026-09-11T10:00:00.000Z",
  },
  author: { handle: "pepecartel", displayName: "PEPECARTEL" },
  metrics: { views: 4200, likes: 310, comments: 22, shares: null, saves: 17 },
  metricAvailability: {
    views: "available",
    likes: "available",
    comments: "available",
    shares: "unavailable",
    saves: "available",
  },
};
const igPost = mapPost(firstResult(successBody(igResult))!, "instagram", "https://instagram.com/p/ABC123");
check("map-ig-identity", igPost?.externalPostId === "IG_ABC123", "instagram post id mapped");
check("map-ig-author", igPost?.authorHandle === "pepecartel", "instagram author handle mapped");
check("map-ig-text", igPost?.contentText === "gm cartel", "instagram caption mapped to contentText");
check("map-ig-metrics", igPost?.metrics.likes === 310 && igPost?.metrics.saves === 17, "instagram metrics mapped");
check(
  "map-ig-unavailable-null",
  igPost?.metrics.shares === null && igPost?.availability.shares === "unavailable",
  "unavailable metric stays null and keeps its availability",
);

const tiktokResult = {
  platform: "tiktok",
  post: { id: "TT_777", url: "https://tiktok.com/@a/video/777", text: "clip" },
  metrics: { views: 91000, likes: 1200, comments: 45, shares: 88, saves: 300 },
  metricAvailability: {
    views: "available",
    likes: "available",
    comments: "available",
    shares: "available",
    saves: "available",
  },
};
const ttPost = mapPost(firstResult(successBody(tiktokResult))!, "tiktok", "https://tiktok.com/@a/video/777");
check(
  "map-tiktok",
  ttPost?.platform === "tiktok" && ttPost?.metrics.views === 91000 && ttPost?.metrics.shares === 88,
  "tiktok metrics mapped",
);

const xResult = {
  platform: "x",
  post: { id: "X_555", url: "https://x.com/a/status/555", text: "cartel" },
  metrics: { views: 10500, likes: 240, comments: 31, shares: 57, saves: null },
  metricAvailability: {
    views: "available",
    likes: "available",
    comments: "available",
    shares: "available",
    saves: "not_applicable",
  },
};
const xPost = mapPost(firstResult(successBody(xResult))!, "x", "https://x.com/a/status/555");
check("map-x-comments", xPost?.metrics.comments === 31, "X replies map to canonical comments");
check("map-x-shares", xPost?.metrics.shares === 57, "X reposts map to canonical shares");
check(
  "map-x-saves-na",
  xPost?.metrics.saves === null && xPost?.availability.saves === "not_applicable",
  "X saves stay null with not_applicable, never zero",
);
check(
  "map-x-no-bookmark-field",
  !JSON.stringify(xPost).includes("bookmark"),
  "no invented bookmark field on the canonical post",
);

const ytResult = {
  platform: "youtube",
  post: { id: "YT_999", url: "https://youtube.com/watch?v=999", title: "launch recap" },
  // YouTube currently omits metricAvailability entirely.
  metrics: { views: 15000, likes: 400, comments: 12, shares: null, saves: null },
};
const ytPost = mapPost(firstResult(successBody(ytResult))!, "youtube", "https://youtube.com/watch?v=999");
check(
  "map-yt-inferred-available",
  ytPost?.availability.views === "available" && ytPost?.availability.likes === "available",
  "missing availability + finite number infers available",
);
check(
  "map-yt-inferred-unknown",
  ytPost?.metrics.shares === null &&
    ytPost?.availability.shares === "unknown" &&
    ytPost?.availability.saves === "unknown",
  "missing availability + null metric stays unknown, not unavailable and not zero",
);

const fbResult = {
  platform: "facebook",
  post: { id: "FB_111", url: "https://facebook.com/a/posts/111", text: "announcement" },
  metrics: { views: null, likes: 90, comments: 8, shares: 4, saves: null },
  metricAvailability: {
    views: "unavailable",
    likes: "available",
    comments: "available",
    shares: "available",
    saves: "not_applicable",
  },
};
const fbPost = mapPost(firstResult(successBody(fbResult))!, "facebook", "https://facebook.com/a/posts/111");
check(
  "map-facebook",
  fbPost?.metrics.likes === 90 && fbPost?.metrics.views === null && fbPost?.availability.views === "unavailable",
  "facebook metrics mapped with unavailable views preserved",
);

const metricsObservation = mapMetricsObservation(
  firstResult(successBody(xResult))!,
  "x",
  "https://x.com/a/status/555",
);
check(
  "map-metrics-observation",
  metricsObservation.externalPostId === "X_555" && metricsObservation.metrics.likes === 240,
  "metrics-only observation maps id and metrics",
);

/* -------------------------------------------------------------------------
 * 4. Numeric / availability purity
 * ---------------------------------------------------------------------- */

check("num-null", toMetricValue(null) === null, "null metric stays null");
check("num-string", toMetricValue("120") === null, "string metric is not coerced");
check("num-negative", toMetricValue(-5) === null, "negative metric rejected");
check("num-nan", toMetricValue(Number.NaN) === null, "NaN metric rejected");
check("num-zero", toMetricValue(0) === 0, "a real zero is preserved as zero");

const emptyBuilt = buildMetrics(undefined, undefined);
check(
  "build-empty-all-null",
  SOCIAL_METRIC_KEYS.every((k) => emptyBuilt.metrics[k] === null && emptyBuilt.availability[k] === "unknown"),
  "absent metrics object yields all-null metrics and unknown availability",
);
check(
  "build-no-zero-coercion",
  !contractSrc.includes("?? 0") && !adapterSrc.includes("?? 0"),
  "no null-to-zero coercion in SE-2 source",
);

/* -------------------------------------------------------------------------
 * 5. Source / profile fixture, single page only
 * ---------------------------------------------------------------------- */

const profileResult = {
  platform: "instagram",
  profile: {
    id: "IG_ACCT_1",
    url: "https://instagram.com/pepecartel",
    handle: "pepecartel",
    displayName: "PEPECARTEL",
  },
  recentPosts: [
    { id: "P1", url: "https://instagram.com/p/P1", metrics: { likes: 10 } },
    { id: "P2", url: "https://instagram.com/p/P2", metrics: { likes: 20 } },
    { id: "P3", url: "https://instagram.com/p/P3", metrics: { likes: 30 } },
  ],
  pagination: { hasMore: true, nextCursor: "abc" },
};
const source = mapSourceRecentPosts(
  firstResult(successBody(profileResult))!,
  "instagram",
  "https://instagram.com/pepecartel",
  10,
);
check("map-source-identity", source?.source.handle === "pepecartel", "profile handle mapped");
check("map-source-posts", source?.posts.length === 3, "recent posts mapped");
check("map-source-post-metrics", source?.posts[0]?.metrics.likes === 10, "recent post metrics mapped");
check("map-source-hasmore", source?.hasMore === true, "pagination hasMore preserved without fetching it");

const clamped = mapSourceRecentPosts(
  firstResult(successBody(profileResult))!,
  "instagram",
  "https://instagram.com/pepecartel",
  2,
);
check("map-source-limit", clamped?.posts.length === 2, "caller limit clamps the mapped page");
check("clamp-low", clampLimit(0) === 1, "limit clamps up to 1");
check("clamp-high", clampLimit(9999) === 25, "limit clamps down to the single-page maximum");
check("clamp-default", clampLimit(undefined) === 10, "default limit is 10");
check("single-page", adapterSrc.includes("pages: 1"), "provider request forces a single page");
check(
  "single-target",
  adapterSrc.includes("targets: [{ url: resolved.canonicalUrl, type: target }]"),
  "exactly one target per call, never a batch",
);
check(
  "first-result-strict",
  firstResult({ results: [{}, {}] }) === null && firstResult({ results: [] }) === null,
  "anything other than exactly one result entry is malformed",
);

/* -------------------------------------------------------------------------
 * 6. Error mapping and billable semantics
 * ---------------------------------------------------------------------- */

const STATUS_CASES: Array<[number, ProviderErrorCode]> = [
  [400, "INVALID_URL"],
  [401, "UNAUTHORIZED"],
  [402, "INSUFFICIENT_BALANCE"],
  [404, "NOT_FOUND"],
  [429, "RATE_LIMITED"],
  [500, "PROVIDER_UNAVAILABLE"],
  [502, "PROVIDER_UNAVAILABLE"],
  [503, "BILLING_UNAVAILABLE"],
];
for (const [status, code] of STATUS_CASES) {
  check(`err-http-${status}`, mapHttpStatus(status) === code, `HTTP ${status} → ${code}`);
}

const CATEGORY_CASES: Array<[string, ProviderErrorCode]> = [
  ["bad_url", "INVALID_URL"],
  ["unsupported_platform", "UNSUPPORTED_PLATFORM"],
  ["private_or_removed", "PRIVATE_OR_BLOCKED"],
  ["minimum_age_required", "MINIMUM_AGE_REQUIRED"],
  ["missing_metrics", "MISSING_METRICS"],
  ["timeout", "TIMEOUT"],
  ["something_new", "UNKNOWN"],
];
for (const [category, code] of CATEGORY_CASES) {
  check(`err-cat-${category}`, mapResultCategory(category) === code, `${category} → ${code}`);
}

check(
  "err-result-failure",
  resultFailureCode({ success: false, error: { category: "private_or_removed" } }) === "PRIVATE_OR_BLOCKED",
  "per-result failure is detected even on a 200 body",
);
check("err-result-success", resultFailureCode({ success: true }) === null, "successful result has no failure code");

check(
  "err-malformed-shape",
  firstResult({ nonsense: true }) === null && firstResult("not json") === null,
  "malformed body yields no result",
);

const RETRYABLE: ProviderErrorCode[] = ["RATE_LIMITED", "PROVIDER_UNAVAILABLE", "TIMEOUT", "BILLING_UNAVAILABLE"];
const PERMANENT: ProviderErrorCode[] = [
  "PROVIDER_NOT_CONFIGURED",
  "UNSUPPORTED_PLATFORM",
  "INVALID_URL",
  "NOT_FOUND",
  "PRIVATE_OR_BLOCKED",
  "UNAUTHORIZED",
  "INSUFFICIENT_BALANCE",
  "MALFORMED_RESPONSE",
  "UNKNOWN",
];
for (const code of RETRYABLE) {
  check(`retry-yes-${code}`, sanitizedFailure(code).retryable === true, `${code} is retryable`);
}
for (const code of PERMANENT) {
  check(`retry-no-${code}`, sanitizedFailure(code).retryable === false, `${code} is not retryable`);
}
check(
  "retry-list",
  RETRYABLE_PROVIDER_ERROR_CODES.length === 4,
  "exactly four transient conditions are retryable",
);

for (const code of [...RETRYABLE, ...PERMANENT]) {
  const result = providerFailure<never>("refetcher", code, "x");
  check(
    `billing-${code}`,
    result.ok === false && result.billable === false && result.units === 0,
    `${code} is never recorded as provider cost`,
  );
}

check(
  "err-sanitized",
  [...RETRYABLE, ...PERMANENT].every((code) => {
    const message = sanitizedFailure(code).message;
    return (
      !message.includes("api.refetcher.com") &&
      !message.includes("X-API-Key") &&
      !message.includes("REFETCHER_API_KEY") &&
      message.length < 200
    );
  }),
  "no error message leaks the endpoint, the header or the secret name",
);
check(
  "err-no-raw-payload",
  /return MESSAGES\[code\];/.test(adapterSrc) &&
    !/message:\s*(String\(|`|\w+\.message)/.test(adapterSrc),
  "failure messages come only from the fixed table; no provider text is echoed back",
);

/* -------------------------------------------------------------------------
 * 7. Credential handling
 * ---------------------------------------------------------------------- */

check(
  "key-server-only",
  adapterSrc.includes("process.env[REFETCHER_API_KEY_ENV]") && !contractSrc.includes("REFETCHER"),
  "the secret is read only in the server adapter, never in the pure contract",
);
check(
  "key-no-fallback",
  !/REFETCHER_API_KEY_ENV\]\s*\?\?\s*["']/.test(adapterSrc),
  "no default or fallback key value",
);
check(
  "key-missing-short-circuits",
  /const apiKey = readApiKey\(\);\s*if \(!apiKey\) return fail<T>\("PROVIDER_NOT_CONFIGURED"\);/.test(
    adapterSrc,
  ),
  "a missing key returns PROVIDER_NOT_CONFIGURED before any fetch is constructed",
);
check(
  "key-not-in-boundary",
  !boundarySrc.includes("REFETCHER") && !boundarySrc.includes("api.refetcher"),
  "the server-function boundary holds no secret name or host",
);
check(
  "key-header-auth",
  adapterSrc.includes('"X-API-Key": apiKey') && !adapterSrc.includes("Bearer"),
  "X-API-Key header auth only",
);

/* -------------------------------------------------------------------------
 * 8. Authorization and persistence boundary
 * ---------------------------------------------------------------------- */

check("fn-auth", boundarySrc.includes("requireSupabaseAuth"), "server function requires authentication");
check(
  "fn-operator",
  boundarySrc.includes(`rpc("is_workspace_operator"`),
  "server function requires workspace operator authorization",
);
check(
  "fn-auth-before-provider",
  boundarySrc.indexOf("is_workspace_operator") < boundarySrc.indexOf("social-read-refetcher.server"),
  "authorization is checked before the provider adapter is even loaded",
);
check(
  "fn-dynamic-server-import",
  boundarySrc.includes('await import("./social-read-refetcher.server")'),
  "the adapter is loaded dynamically inside the handler",
);

for (const [id, token] of [
  ["insert", ".insert("],
  ["update", ".update("],
  ["delete", ".delete("],
  ["upsert", ".upsert("],
  ["ledger", "usage_ledger"],
  ["posts-table", "social_posts"],
  ["snapshots-table", "social_metric_snapshots"],
  ["missions-table", "social_missions"],
  ["cron", "cron"],
  ["setInterval", "setInterval"],
  ["telegram", "telegram"],
  ["edge-invoke", "functions.invoke"],
] as const) {
  check(`scope-no-${id}`, !allSrc.includes(token), `SE-2 source contains no "${token}"`);
}

check(
  "scope-no-retry-loop",
  !/for\s*\([^)]*attempt/i.test(adapterSrc) && !adapterSrc.includes("retryCount"),
  "no automatic retry loop",
);
check("scope-timeout", adapterSrc.includes("AbortController"), "requests are bounded by an AbortController timeout");

/* -------------------------------------------------------------------------
 * 9. No hardcoded pricing
 * ---------------------------------------------------------------------- */

check(
  "no-price",
  !/\$\s?\d/.test(allSrc) && !allSrc.includes("0.90") && !/\busd\b/i.test(allSrc),
  "no dollar amount or currency is encoded in SE-2 source",
);
check(
  "no-cost-field",
  !allSrc.includes("provider_cost") && !allSrc.includes("internal_cost"),
  "SE-2 writes no cost fields",
);

/* -------------------------------------------------------------------------
 * 10. Platform set parity with SE-1
 * ---------------------------------------------------------------------- */

check(
  "platforms-match-se1",
  ["x", "instagram", "tiktok", "youtube", "facebook"].every(isSocialPlatform) &&
    !isSocialPlatform("linkedin"),
  "platform union matches the SE-1 CHECK constraint exactly",
);

console.log(failures === 0 ? "\nSE-2 regression: ALL CHECKS PASSED" : `\nSE-2 regression: ${failures} FAILURE(S)`);
process.exit(failures === 0 ? 0 : 1);
