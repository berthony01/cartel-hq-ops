/**
 * SE-2.1 — Direct-first provider architecture regression.
 *
 * PURE LOGIC + FIXTURES + SOURCE assertions only. No network call, no provider
 * call, no database, no secret is read. Fixtures are hand-written shapes that
 * mirror the documented official X and YouTube response contracts.
 */
import { readFileSync } from "node:fs";
import {
  X_API_BASE,
  X_MIN_MAX_RESULTS,
  buildTweetLookupUrl,
  buildUserByUsernameUrl,
  buildUserTweetsUrl,
  indexXUsers,
  mapXMetrics,
  mapXMetricsObservation,
  mapXPost,
  mapXSource,
  resolveXUrl,
  xMaxResults,
  xReturnLimit,
  xSanitizedFailure,
} from "../src/lib/social-read-x.server";
import {
  YOUTUBE_API_BASE,
  buildChannelsListUrl,
  buildPlaylistItemsUrl,
  buildVideosListUrl,
  mapPlaylistItemFallback,
  mapYouTubeChannel,
  mapYouTubeMetrics,
  mapYouTubeMetricsObservation,
  mapYouTubeVideo,
  playlistVideoIds,
  resolveYouTubeUrl,
  youtubeCount,
  youtubeLimit,
} from "../src/lib/social-read-youtube.server";
import { routeSocialUrl, socialReadRouter } from "../src/lib/social-read-router.server";

const X_ADAPTER = "src/lib/social-read-x.server.ts";
const YT_ADAPTER = "src/lib/social-read-youtube.server.ts";
const ROUTER = "src/lib/social-read-router.server.ts";
const BOUNDARY = "src/lib/social-read.functions.ts";
const CONTRACT = "src/lib/social-read-provider.ts";

const read = (p: string) => readFileSync(p, "utf8");
const stripComments = (s: string) =>
  s.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");

const xSrc = stripComments(read(X_ADAPTER));
const ytSrc = stripComments(read(YT_ADAPTER));
const routerSrc = stripComments(read(ROUTER));
const boundarySrc = stripComments(read(BOUNDARY));
const contractSrc = stripComments(read(CONTRACT));
const newSrc = xSrc + ytSrc + routerSrc;
const allSrc = newSrc + boundarySrc + contractSrc;

let failures = 0;
function check(id: string, ok: boolean, detail: string) {
  if (ok) console.log(`PASS ${id} — ${detail}`);
  else {
    failures += 1;
    console.error(`FAIL ${id} — ${detail}`);
  }
}

/* =========================================================================
 * 1. Refetcher is dormant and unreachable from runtime
 * ====================================================================== */

check("dormant-router", !routerSrc.includes("refetcher"), "router never imports or names Refetcher");
check("dormant-boundary", !boundarySrc.toLowerCase().includes("refetcher"), "boundary never references Refetcher");
check("dormant-x", !xSrc.toLowerCase().includes("refetcher"), "X adapter never references Refetcher");
check("dormant-youtube", !ytSrc.toLowerCase().includes("refetcher"), "YouTube adapter never references Refetcher");
check(
  "dormant-no-flag",
  !/REFETCHER_ENABLED|ENABLE_REFETCHER|USE_REFETCHER/.test(allSrc),
  "no env flag can re-enable Refetcher",
);
check(
  "boundary-uses-router",
  boundarySrc.includes('await import("./social-read-router.server")'),
  "boundary dynamically imports the direct-first router",
);
check(
  "boundary-auth-first",
  boundarySrc.indexOf("is_workspace_operator") < boundarySrc.indexOf("social-read-router.server"),
  "operator authorization precedes any provider load",
);
check("boundary-auth", boundarySrc.includes("requireSupabaseAuth"), "boundary still requires authentication");

/* =========================================================================
 * 2. X URL parsing
 * ====================================================================== */

const xPost = resolveXUrl("https://x.com/pepecartel/status/1799999999999999999");
check(
  "x-url-post",
  xPost.ok && xPost.target.kind === "post" && xPost.target.postId === "1799999999999999999",
  "x.com post URL resolves to a post target",
);
check(
  "x-url-post-id-string",
  xPost.ok && xPost.target.kind === "post" && typeof xPost.target.postId === "string",
  "post id stays a string, never a number",
);
const twitterPost = resolveXUrl("https://twitter.com/pepecartel/status/1799999999999999999");
check("x-url-twitter-host", twitterPost.ok, "twitter.com post URL is accepted");
const iWebPost = resolveXUrl("https://x.com/i/web/status/1799999999999999999");
check("x-url-i-web", iWebPost.ok && iWebPost.target.kind === "post", "/i/web/status form is accepted");
const xProfile = resolveXUrl("https://x.com/pepecartel");
check(
  "x-url-profile",
  xProfile.ok && xProfile.target.kind === "profile" && xProfile.target.username === "pepecartel",
  "profile URL resolves to a profile target",
);
check("x-url-www", resolveXUrl("https://www.x.com/pepecartel").ok, "www prefix is tolerated");

for (const [id, url, expected] of [
  ["foreign-host", "https://evil.com/pepecartel/status/1", "UNSUPPORTED_PLATFORM"],
  ["lookalike-host", "https://x.com.evil.com/pepecartel", "UNSUPPORTED_PLATFORM"],
  ["scheme", "javascript:alert(1)", "INVALID_URL"],
  ["ftp-scheme", "ftp://x.com/pepecartel", "INVALID_URL"],
  ["credentials", "https://user:pass@x.com/pepecartel", "INVALID_URL"],
  ["port", "https://x.com:8443/pepecartel", "INVALID_URL"],
  ["reserved", "https://x.com/i", "INVALID_URL"],
  ["non-numeric-id", "https://x.com/pepecartel/status/abc", "INVALID_URL"],
  ["empty", "", "INVALID_URL"],
] as const) {
  const result = resolveXUrl(url);
  check(`x-url-reject-${id}`, !result.ok && result.code === expected, `${id} rejected as ${expected}`);
}

/* =========================================================================
 * 3. X request builders — official endpoints only
 * ====================================================================== */

check("x-base-official", X_API_BASE === "https://api.x.com/2", "X base host is the fixed official API");
const tweetUrl = buildTweetLookupUrl("1799999999999999999");
check(
  "x-post-endpoint",
  tweetUrl.startsWith("https://api.x.com/2/tweets/1799999999999999999?"),
  "post lookup targets GET /2/tweets/{id}",
);
check(
  "x-post-fields",
  tweetUrl.includes("tweet.fields=created_at%2Cauthor_id%2Cpublic_metrics"),
  "post lookup requests created_at, author_id and public_metrics",
);
check("x-post-expansions", tweetUrl.includes("expansions=author_id"), "post lookup expands the author");
check("x-post-no-key", !/key=|api_key/i.test(tweetUrl), "no credential is ever placed in a URL");

const userUrl = buildUserByUsernameUrl("pepecartel");
check(
  "x-user-endpoint",
  userUrl.startsWith("https://api.x.com/2/users/by/username/pepecartel?"),
  "username resolution uses GET /2/users/by/username/{username}",
);
const tweetsUrl = buildUserTweetsUrl("12345", 10);
check(
  "x-source-endpoint",
  tweetsUrl.startsWith("https://api.x.com/2/users/12345/tweets?"),
  "source read uses GET /2/users/{id}/tweets",
);
check("x-source-fields", tweetsUrl.includes("public_metrics"), "source read requests public metrics");
check("x-source-no-search", !xSrc.includes("/tweets/search"), "no search endpoint is used");
check(
  "x-source-min-max-results",
  xMaxResults(2) === X_MIN_MAX_RESULTS && xReturnLimit(2) === 2,
  "below-minimum requests fetch the provider minimum and trim locally",
);
check("x-source-cap", xMaxResults(500) === 10 && xReturnLimit(500) === 10, "returned posts are capped at 10");
check(
  "x-no-pagination-loop",
  !/while\s*\(|for\s*\(\s*;;|next_token.*getJson|pagination_token/.test(xSrc),
  "no pagination loop and no page token is ever followed",
);
check("x-no-retry", !/retry|attempt\s*<|backoff/i.test(xSrc), "no automatic retry exists");
check("x-timeout", xSrc.includes("X_TIMEOUT_MS = 10_000"), "a 10s abort timeout is enforced");

/* =========================================================================
 * 4. X metric mapping
 * ====================================================================== */

const xFixture = {
  data: {
    id: "1799999999999999999",
    text: "gm cartel",
    author_id: "42",
    created_at: "2026-09-01T10:00:00.000Z",
    public_metrics: {
      retweet_count: 12,
      reply_count: 5,
      like_count: 300,
      quote_count: 9,
      bookmark_count: 7,
      impression_count: 45000,
    },
  },
  includes: { users: [{ id: "42", name: "Pepe Cartel", username: "pepecartel" }] },
};

const xMapped = mapXPost(xFixture.data, indexXUsers(xFixture.includes));
check("x-map-post", xMapped !== null, "a documented tweet payload maps to a canonical post");
check("x-map-id-string", typeof xMapped?.externalPostId === "string", "mapped post id is a string");
check("x-map-views", xMapped?.metrics.views === 45000, "views = impression_count");
check("x-map-likes", xMapped?.metrics.likes === 300, "likes = like_count");
check("x-map-comments", xMapped?.metrics.comments === 5, "comments = reply_count");
check("x-map-shares", xMapped?.metrics.shares === 12, "shares = retweet_count only");
check("x-map-saves", xMapped?.metrics.saves === 7, "saves = bookmark_count");
check(
  "x-quote-not-merged",
  xMapped?.metrics.shares !== 21 && !xSrc.includes("quote_count +") && !/shares:\s*[^,]*quote_count/.test(xSrc),
  "quote_count is never silently merged into shares",
);
check("x-author", xMapped?.authorHandle === "pepecartel", "author handle comes from the user expansion");
check(
  "x-canonical-url",
  xMapped?.canonicalUrl === "https://x.com/pepecartel/status/1799999999999999999",
  "canonical URL is rebuilt from handle and id",
);

const sparse = mapXMetrics({ like_count: 4 });
check("x-null-metrics", sparse.metrics.views === null && sparse.metrics.saves === null, "absent metrics stay null");
check(
  "x-null-availability",
  sparse.availability.views === "unknown" && sparse.availability.likes === "available",
  "absent metrics stay unknown, never zero or unavailable",
);
const xObs = mapXMetricsObservation(xFixture.data, "https://x.com/pepecartel/status/1");
check("x-metrics-observation", xObs?.metrics.views === 45000 && xObs.platform === "x", "metrics-only mapping works");
const xSource = mapXSource({ id: "42", name: "Pepe Cartel", username: "pepecartel" });
check(
  "x-source-map",
  xSource?.externalAccountId === "42" && xSource.handle === "pepecartel",
  "source mapping keeps the account id and handle",
);
const xFailure = xSanitizedFailure("UNAUTHORIZED");
check(
  "x-sanitized-error",
  !xFailure.message.includes("api.x.com") && !/token|bearer/i.test(xFailure.message),
  "failure messages never leak the host or the credential",
);

/* =========================================================================
 * 5. X credentials
 * ====================================================================== */

check("x-secret-name", xSrc.includes('X_BEARER_TOKEN_ENV = "X_API_BEARER_TOKEN"'), "the X secret name is fixed");
check(
  "x-secret-no-default",
  !/X_API_BEARER_TOKEN.*(\?\?|\|\|)\s*["'`]/.test(xSrc),
  "the X token has no default or fallback value",
);
check(
  "x-secret-before-fetch",
  xSrc.indexOf("PROVIDER_NOT_CONFIGURED") < xSrc.indexOf("await fetch("),
  "a missing token short-circuits before any fetch is constructed",
);
check(
  "x-header-auth",
  xSrc.includes("Authorization: `Bearer ${bearerToken}`"),
  "the token travels in a header only, never a query string",
);

/* =========================================================================
 * 6. YouTube URL parsing
 * ====================================================================== */

const ytWatch = resolveYouTubeUrl("https://www.youtube.com/watch?v=dQw4w9WgXcQ");
check("yt-url-watch", ytWatch.ok && ytWatch.target.kind === "video", "watch URL resolves to a video");
const ytShort = resolveYouTubeUrl("https://youtu.be/dQw4w9WgXcQ");
check(
  "yt-url-youtu-be",
  ytShort.ok && ytShort.target.kind === "video" && ytShort.target.videoId === "dQw4w9WgXcQ",
  "youtu.be URL resolves to a video",
);
check("yt-url-shorts", resolveYouTubeUrl("https://youtube.com/shorts/dQw4w9WgXcQ").ok, "shorts URL is accepted");
const ytChannel = resolveYouTubeUrl("https://youtube.com/channel/UCuAXFkgsw1L7xaCfnd5JJOw");
check(
  "yt-url-channel",
  ytChannel.ok && ytChannel.target.kind === "channel" && ytChannel.target.selector === "id",
  "/channel/{id} resolves to an id selector",
);
const ytHandle = resolveYouTubeUrl("https://youtube.com/@pepecartel");
check(
  "yt-url-handle",
  ytHandle.ok && ytHandle.target.kind === "channel" && ytHandle.target.selector === "handle",
  "/@handle resolves to a handle selector",
);
const ytUser = resolveYouTubeUrl("https://youtube.com/user/legacyname");
check(
  "yt-url-user",
  ytUser.ok && ytUser.target.kind === "channel" && ytUser.target.selector === "username",
  "/user/{username} resolves to a legacy username selector",
);

for (const [id, url, expected] of [
  ["foreign-host", "https://evil.com/watch?v=dQw4w9WgXcQ", "UNSUPPORTED_PLATFORM"],
  ["credentials", "https://user:pass@youtube.com/watch?v=dQw4w9WgXcQ", "INVALID_URL"],
  ["port", "https://youtube.com:8443/watch?v=dQw4w9WgXcQ", "INVALID_URL"],
  ["scheme", "javascript:alert(1)", "INVALID_URL"],
  ["bad-video-id", "https://youtube.com/watch?v=short", "INVALID_URL"],
  ["bad-channel-id", "https://youtube.com/channel/nope", "INVALID_URL"],
] as const) {
  const result = resolveYouTubeUrl(url);
  check(`yt-url-reject-${id}`, !result.ok && result.code === expected, `${id} rejected as ${expected}`);
}

/* =========================================================================
 * 7. YouTube request builders — official endpoints, no search
 * ====================================================================== */

check(
  "yt-base-official",
  YOUTUBE_API_BASE === "https://www.googleapis.com/youtube/v3",
  "YouTube base host is the fixed official API",
);
const videosUrl = buildVideosListUrl(["dQw4w9WgXcQ"]);
check(
  "yt-videos-endpoint",
  videosUrl.startsWith("https://www.googleapis.com/youtube/v3/videos?"),
  "video reads use videos.list",
);
check("yt-videos-part", videosUrl.includes("part=snippet%2Cstatistics"), "videos.list requests snippet,statistics");
check("yt-videos-no-key", !/[?&]key=/.test(videosUrl), "the API key is never in a pure builder's output");
check(
  "yt-channels-handle",
  buildChannelsListUrl("handle", "pepecartel").includes("forHandle=%40pepecartel"),
  "handle channel lookup uses forHandle",
);
check(
  "yt-channels-username",
  buildChannelsListUrl("username", "legacyname").includes("forUsername=legacyname"),
  "legacy channel lookup uses forUsername",
);
check(
  "yt-channels-part",
  buildChannelsListUrl("id", "UCuAXFkgsw1L7xaCfnd5JJOw").includes("part=snippet%2CcontentDetails"),
  "channels.list requests snippet,contentDetails for the uploads playlist",
);
const playlistUrl = buildPlaylistItemsUrl("UUuAXFkgsw1L7xaCfnd5JJOw", 5);
check(
  "yt-playlist-endpoint",
  playlistUrl.startsWith("https://www.googleapis.com/youtube/v3/playlistItems?") &&
    playlistUrl.includes("maxResults=5"),
  "recent uploads use playlistItems.list with a clamped page size",
);
check("yt-no-search", !ytSrc.includes("search.list") && !ytSrc.includes("/search?"), "search.list is never used");
check(
  "yt-no-pagination-loop",
  !/while\s*\(|nextPageToken.*getJson/.test(ytSrc),
  "no pagination loop; nextPageToken only sets hasMore",
);
check("yt-no-retry", !/retry|backoff/i.test(ytSrc), "no automatic retry exists");
check("yt-limit-clamp", youtubeLimit(999) === 10 && youtubeLimit(3) === 3, "page size is clamped to 10");
check("yt-timeout", ytSrc.includes("YOUTUBE_TIMEOUT_MS = 10_000"), "a 10s abort timeout is enforced");
check(
  "yt-source-order",
  ytSrc.indexOf("buildChannelsListUrl") < ytSrc.indexOf("buildPlaylistItemsUrl"),
  "the source path is channels → uploads playlist → playlistItems → videos enrichment",
);

/* -------------------------------------------------------------------------
 * 7b. Conservative enrichment metering (SE-2.1 final QA hardening)
 *
 * If the optional third videos.list enrichment request is ATTEMPTED but does
 * not succeed cleanly, quota may still have been consumed and the transport
 * cannot prove otherwise. The call still succeeds on playlist fallback data,
 * but must report units: null (unknown) instead of understating usage as 2.
 * ---------------------------------------------------------------------- */

check(
  "yt-enrich-attempt-tracked",
  ytSrc.includes("enrichmentAttempted") && ytSrc.includes("enrichmentSucceeded"),
  "enrichment attempt and clean success are tracked separately",
);
check(
  "yt-enrich-units-unknown-rule",
  ytSrc.includes("enrichmentAttempted && !enrichmentSucceeded ? null : quotaUnits"),
  "attempted-but-failed enrichment reports units: null, never a known 2",
);
check(
  "yt-enrich-units-reported",
  ytSrc.includes("units: reportedUnits") && !/units: quotaUnits,\s*\},\s*\);\s*\},\s*\};/.test(ytSrc),
  "the source result reports the conservative unit value, not the raw counter",
);
check(
  "yt-enrich-increment-guarded",
  /if \(videosResponse\.ok\) \{\s*\n\s*enrichmentSucceeded = true;\s*\n\s*quotaUnits \+= 1;/.test(ytSrc),
  "the third quota unit is only counted on a clean enrichment success",
);
check(
  "yt-enrich-fallback-preserved",
  ytSrc.includes("hit ?? mapPlaylistItemFallback(videoId, playlistItems[index])"),
  "fallback-success behaviour on failed enrichment is preserved",
);

// Pure replication of the documented rule, exercised across all three cases.
const reportedUnitsRule = (attempted: boolean, succeeded: boolean, quotaUnits: number) =>
  attempted && !succeeded ? null : quotaUnits;
check(
  "yt-enrich-units-no-videos",
  reportedUnitsRule(false, false, 2) === 2,
  "zero video ids means no enrichment request and a known 2 units",
);
check(
  "yt-enrich-units-success",
  reportedUnitsRule(true, true, 3) === 3,
  "a clean enrichment success keeps the known 3 units",
);
check(
  "yt-enrich-units-failure",
  reportedUnitsRule(true, false, 2) === null,
  "an attempted-but-failed enrichment reports unknown units",
);


/* =========================================================================
 * 8. YouTube metric mapping (string counts)
 * ====================================================================== */

check("yt-count-string", youtubeCount("45000") === 45000, "string counts convert to numbers");
check("yt-count-zero", youtubeCount("0") === 0, "a real zero is preserved");
check(
  "yt-count-garbage",
  youtubeCount("abc") === null && youtubeCount(undefined) === null && youtubeCount("-5") === null,
  "unusable counts stay null, never zero",
);

const ytVideoFixture = {
  id: "dQw4w9WgXcQ",
  snippet: {
    title: "Cartel launch",
    channelTitle: "Pepe Cartel",
    publishedAt: "2026-09-01T10:00:00Z",
  },
  statistics: { viewCount: "45000", likeCount: "300", commentCount: "12" },
};
const ytMapped = mapYouTubeVideo(ytVideoFixture);
check("yt-map-video", ytMapped !== null, "a documented video payload maps to a canonical post");
check("yt-map-views", ytMapped?.metrics.views === 45000, "views = viewCount");
check("yt-map-likes", ytMapped?.metrics.likes === 300, "likes = likeCount");
check("yt-map-comments", ytMapped?.metrics.comments === 12, "comments = commentCount");
check(
  "yt-map-shares",
  ytMapped?.metrics.shares === null && ytMapped.availability.shares === "unavailable",
  "shares are null and unavailable",
);
check(
  "yt-map-saves",
  ytMapped?.metrics.saves === null && ytMapped.availability.saves === "not_applicable",
  "saves are null and not_applicable",
);
const hiddenLikes = mapYouTubeMetrics({ viewCount: "10" });
check(
  "yt-hidden-likes",
  hiddenLikes.metrics.likes === null && hiddenLikes.availability.likes === "unknown",
  "a hidden like count stays null and unknown, never zero",
);
const ytObs = mapYouTubeMetricsObservation(ytVideoFixture, "https://youtube.com/watch?v=x");
check("yt-metrics-observation", ytObs?.metrics.views === 45000, "metrics-only mapping works");

const ytChannelFixture = {
  id: "UCuAXFkgsw1L7xaCfnd5JJOw",
  snippet: { title: "Pepe Cartel", customUrl: "@pepecartel" },
  contentDetails: { relatedPlaylists: { uploads: "UUuAXFkgsw1L7xaCfnd5JJOw" } },
};
const ytChannelMapped = mapYouTubeChannel(ytChannelFixture);
check(
  "yt-channel-map",
  ytChannelMapped?.uploadsPlaylistId === "UUuAXFkgsw1L7xaCfnd5JJOw" &&
    ytChannelMapped.source.externalAccountId === "UCuAXFkgsw1L7xaCfnd5JJOw",
  "channel mapping extracts the uploads playlist id",
);
const ids = playlistVideoIds({
  items: [
    { contentDetails: { videoId: "dQw4w9WgXcQ" } },
    { snippet: { resourceId: { videoId: "aQw4w9WgXcQ" } } },
    { contentDetails: { videoId: "dQw4w9WgXcQ" } },
  ],
});
check("yt-playlist-ids", ids.length === 2 && ids[0] === "dQw4w9WgXcQ", "playlist ids are extracted and de-duplicated");
const fallback = mapPlaylistItemFallback("dQw4w9WgXcQ", { snippet: { title: "No stats yet" } });
check(
  "yt-fallback-null",
  fallback.metrics.views === null && fallback.availability.views === "unknown",
  "an un-enriched playlist item carries null metrics, never invented values",
);

/* =========================================================================
 * 9. YouTube credentials
 * ====================================================================== */

check("yt-secret-name", ytSrc.includes('YOUTUBE_API_KEY_ENV = "YOUTUBE_API_KEY"'), "the YouTube secret name is fixed");
check(
  "yt-secret-no-default",
  !/YOUTUBE_API_KEY.*(\?\?|\|\|)\s*["'`]/.test(ytSrc),
  "the YouTube key has no default or fallback value",
);
check(
  "yt-secret-before-fetch",
  ytSrc.indexOf("PROVIDER_NOT_CONFIGURED") < ytSrc.indexOf("await fetch("),
  "a missing key short-circuits before any fetch is constructed",
);

/* =========================================================================
 * 10. Router: direct-first, no scraping fallback
 * ====================================================================== */

const routeX = routeSocialUrl("https://x.com/pepecartel/status/1799999999999999999");
check(
  "route-x",
  routeX.kind === "direct" && routeX.platform === "x" && routeX.providerId === "x-official",
  "an X link routes to the official X adapter",
);
const routeYt = routeSocialUrl("https://youtube.com/watch?v=dQw4w9WgXcQ");
check(
  "route-youtube",
  routeYt.kind === "direct" && routeYt.platform === "youtube" && routeYt.providerId === "youtube-official",
  "a YouTube link routes to the official YouTube adapter",
);
for (const [platform, url] of [
  ["instagram", "https://instagram.com/p/Cabcdef1234/"],
  ["tiktok", "https://tiktok.com/@pepecartel/video/7300000000000000000"],
  ["facebook", "https://facebook.com/pepecartel/posts/123"],
] as const) {
  const decision = routeSocialUrl(url);
  check(
    `route-deferred-${platform}`,
    decision.kind === "deferred" && decision.platform === platform,
    `${platform} is deferred, not routed to any scraping vendor`,
  );
}
check(
  "route-foreign",
  routeSocialUrl("https://evil.com/anything").kind === "unroutable",
  "a foreign host is unroutable",
);

const deferredResult = await socialReadRouter.fetchPostByUrl({
  url: "https://instagram.com/p/Cabcdef1234/",
});
check(
  "route-deferred-typed-refusal",
  deferredResult.ok === false &&
    deferredResult.error.code === "PROVIDER_NOT_CONFIGURED" &&
    deferredResult.billable === false &&
    deferredResult.units === 0,
  "a deferred platform returns a typed, non-billable refusal",
);
const foreignResult = await socialReadRouter.fetchPostMetrics({ url: "https://evil.com/x" });
check(
  "route-foreign-refusal",
  foreignResult.ok === false && foreignResult.billable === false && foreignResult.units === 0,
  "an unroutable link returns a non-billable refusal",
);
check(
  "route-supports",
  socialReadRouter.supports("x", "post") &&
    socialReadRouter.supports("youtube", "metrics") &&
    !socialReadRouter.supports("tiktok", "post") &&
    !socialReadRouter.supports("instagram", "post") &&
    !socialReadRouter.supports("facebook", "post"),
  "the router advertises only the two direct platforms",
);
check(
  "route-three-ops",
  ["fetchPostByUrl", "fetchPostMetrics", "fetchSourceRecentPosts"].every((m) => m in socialReadRouter),
  "the router exposes exactly the provider-neutral read operations",
);

/* =========================================================================
 * 11. Scope locks
 * ====================================================================== */

const FORBIDDEN_CAPABILITIES = [
  "publishPost",
  "createPost",
  "deletePost",
  "schedule",
  "oauth",
  "OAuth",
  "access_token",
  "refresh_token",
  "repost(",
  "follow(",
  "unfollow",
  "sendDm",
  "bookmarkPost",
  "likePost",
];
for (const token of FORBIDDEN_CAPABILITIES) {
  check(`scope-no-${token}`, !newSrc.includes(token), `no ${token} capability exists in SE-2.1 source`);
}

for (const [id, token] of [
  ["insert", ".insert("],
  ["update", ".update("],
  ["delete", ".delete("],
  ["upsert", ".upsert("],
  ["ledger", "usage_ledger"],
  ["posts-table", "social_posts"],
  ["sources-table", "social_sources"],
  ["metrics-table", "social_post_metrics"],
  ["cron", "cron.schedule"],
  ["edge-function", "functions.invoke"],
  ["telegram", "telegram"],
  ["supabase-client", "createClient"],
] as const) {
  check(`scope-no-${id}`, !newSrc.includes(token), `SE-2.1 source contains no ${id}`);
}

check(
  "scope-no-pricing",
  !/\$\s?\d|USD|usd_|price_per|cost_per/.test(newSrc),
  "no dollar amount or provider price is encoded in source",
);
check(
  "scope-no-ui",
  !newSrc.includes("react") && !newSrc.includes("tsx") && !newSrc.includes("createFileRoute"),
  "no UI, route or component code exists in SE-2.1 source",
);
check(
  "scope-server-only-filenames",
  [X_ADAPTER, YT_ADAPTER, ROUTER].every((p) => p.endsWith(".server.ts")),
  "every adapter and the router are server-only by filename",
);
check(
  "scope-contract-unchanged-shape",
  contractSrc.includes("fetchPostByUrl") &&
    contractSrc.includes("fetchSourceRecentPosts") &&
    contractSrc.includes("fetchPostMetrics"),
  "the provider-neutral contract still declares exactly the three read operations",
);

console.log(`\n${failures === 0 ? "ALL CHECKS PASSED" : `${failures} CHECK(S) FAILED`}`);
if (failures > 0) process.exit(1);
