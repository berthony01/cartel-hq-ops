/**
 * SE-2.1 — Official YouTube Data API v3 READ adapter (SERVER ONLY).
 *
 * Direct-first: this is the PRIMARY reader for the `youtube` platform.
 * Refetcher is not consulted and is not imported here.
 *
 * Hard boundaries:
 * - READ only: one video, one video's metrics, one page of a channel's recent
 *   uploads. No publish, OAuth, engagement, DM, follow or bookmark path.
 * - `search.list` is never used. No pagination loop. No retry. No polling.
 * - No persistence, no Supabase access, no usage_ledger write.
 * - The upstream host is a fixed constant; caller input can never redirect it.
 * - `YOUTUBE_API_KEY` is read inside the call path only, with no default and no
 *   fallback, and never returned, logged or embedded in an error. Request
 *   builders are pure and never contain the key.
 * - No provider price is encoded anywhere. Units express API quota only.
 */

import {
  buildMetrics,
  emptyMetrics,
  providerFailure,
  providerSuccess,
  toMetricValue,
  type MetricAvailability,
  type NormalizedMetrics,
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

export const YOUTUBE_PROVIDER_ID = "youtube-official";
/** Fixed official upstream. Never derived from user input. */
export const YOUTUBE_API_BASE = "https://www.googleapis.com/youtube/v3";
export const YOUTUBE_API_KEY_ENV = "YOUTUBE_API_KEY";
export const YOUTUBE_TIMEOUT_MS = 10_000;
/** Conservative SE-2.1 ceiling. One page only. */
export const YOUTUBE_MAX_RETURNED_VIDEOS = 10;

const YOUTUBE_HOSTS = ["youtube.com", "m.youtube.com", "youtu.be", "music.youtube.com"];
const VIDEO_ID_RE = /^[A-Za-z0-9_-]{11}$/;
const CHANNEL_ID_RE = /^UC[A-Za-z0-9_-]{22}$/;
const HANDLE_RE = /^[A-Za-z0-9._-]{3,30}$/;
const LEGACY_USER_RE = /^[A-Za-z0-9._-]{1,64}$/;

export type YouTubeTarget =
  | { kind: "video"; videoId: string; canonicalUrl: string }
  | { kind: "channel"; selector: "id"; value: string; canonicalUrl: string }
  | { kind: "channel"; selector: "handle"; value: string; canonicalUrl: string }
  | { kind: "channel"; selector: "username"; value: string; canonicalUrl: string };

export type YouTubeResolution =
  | { ok: true; target: YouTubeTarget }
  | { ok: false; code: Extract<ProviderErrorCode, "INVALID_URL" | "UNSUPPORTED_PLATFORM"> };

/** Parse a public YouTube URL locally, before any network call. */
export function resolveYouTubeUrl(raw: unknown): YouTubeResolution {
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
  if (!YOUTUBE_HOSTS.includes(host)) return { ok: false, code: "UNSUPPORTED_PLATFORM" };

  const segments = parsed.pathname.split("/").filter(Boolean);

  if (host === "youtu.be") {
    const videoId = segments[0];
    return videoId && VIDEO_ID_RE.test(videoId)
      ? { ok: true, target: video(videoId) }
      : { ok: false, code: "INVALID_URL" };
  }

  if (segments[0] === "watch") {
    const videoId = parsed.searchParams.get("v");
    return videoId && VIDEO_ID_RE.test(videoId)
      ? { ok: true, target: video(videoId) }
      : { ok: false, code: "INVALID_URL" };
  }

  if ((segments[0] === "shorts" || segments[0] === "embed" || segments[0] === "v") && segments[1]) {
    return VIDEO_ID_RE.test(segments[1])
      ? { ok: true, target: video(segments[1]) }
      : { ok: false, code: "INVALID_URL" };
  }

  if (segments[0] === "channel" && segments[1]) {
    return CHANNEL_ID_RE.test(segments[1])
      ? {
          ok: true,
          target: {
            kind: "channel",
            selector: "id",
            value: segments[1],
            canonicalUrl: `https://youtube.com/channel/${segments[1]}`,
          },
        }
      : { ok: false, code: "INVALID_URL" };
  }

  if (segments[0] === "user" && segments[1]) {
    return LEGACY_USER_RE.test(segments[1])
      ? {
          ok: true,
          target: {
            kind: "channel",
            selector: "username",
            value: segments[1],
            canonicalUrl: `https://youtube.com/user/${segments[1]}`,
          },
        }
      : { ok: false, code: "INVALID_URL" };
  }

  const first = segments[0];
  if (first && first.startsWith("@")) {
    const handle = first.slice(1);
    return HANDLE_RE.test(handle)
      ? {
          ok: true,
          target: {
            kind: "channel",
            selector: "handle",
            value: handle,
            canonicalUrl: `https://youtube.com/@${handle}`,
          },
        }
      : { ok: false, code: "INVALID_URL" };
  }

  return { ok: false, code: "INVALID_URL" };
}

function video(videoId: string): YouTubeTarget {
  return { kind: "video", videoId, canonicalUrl: `https://youtube.com/watch?v=${videoId}` };
}

/* ---------------------------------------------------------------------------
 * Request builders (pure). The API key is NEVER part of a builder's output.
 * ------------------------------------------------------------------------- */

export function buildVideosListUrl(videoIds: readonly string[]): string {
  const params = new URLSearchParams({
    part: "snippet,statistics",
    id: videoIds.join(","),
  });
  return `${YOUTUBE_API_BASE}/videos?${params.toString()}`;
}

export function buildChannelsListUrl(
  selector: "id" | "handle" | "username",
  value: string,
): string {
  const params = new URLSearchParams({ part: "snippet,contentDetails" });
  if (selector === "id") params.set("id", value);
  else if (selector === "handle") params.set("forHandle", `@${value}`);
  else params.set("forUsername", value);
  return `${YOUTUBE_API_BASE}/channels?${params.toString()}`;
}

export function buildPlaylistItemsUrl(playlistId: string, limit: unknown): string {
  const params = new URLSearchParams({
    part: "snippet,contentDetails",
    playlistId,
    maxResults: String(youtubeLimit(limit)),
  });
  return `${YOUTUBE_API_BASE}/playlistItems?${params.toString()}`;
}

export function youtubeLimit(limit: unknown): number {
  const requested =
    typeof limit === "number" && Number.isFinite(limit)
      ? Math.floor(limit)
      : YOUTUBE_MAX_RETURNED_VIDEOS;
  return Math.min(Math.max(requested, 1), YOUTUBE_MAX_RETURNED_VIDEOS);
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
 * YouTube count fields arrive as decimal STRINGS. Convert safely; anything that
 * is not a finite non-negative integer string stays `null` — never zero.
 */
export function youtubeCount(raw: unknown): number | null {
  if (typeof raw === "number") return toMetricValue(raw);
  if (typeof raw !== "string") return null;
  const trimmed = raw.trim();
  if (!/^\d{1,19}$/.test(trimmed)) return null;
  return toMetricValue(Number(trimmed));
}

/**
 * Canonical mapping of YouTube public statistics.
 * shares: the Data API exposes no public share count → null / `unavailable`.
 * saves:  no equivalent concept here → null / `not_applicable`.
 */
export function mapYouTubeMetrics(rawStatistics: unknown): {
  metrics: NormalizedMetrics;
  availability: MetricAvailability;
} {
  const stats = asRecord(rawStatistics);
  const views = youtubeCount(stats?.["viewCount"]);
  const likes = youtubeCount(stats?.["likeCount"]);
  const comments = youtubeCount(stats?.["commentCount"]);
  const built = buildMetrics({ views, likes, comments }, null);
  return {
    metrics: { ...built.metrics, shares: null, saves: null },
    availability: { ...built.availability, shares: "unavailable", saves: "not_applicable" },
  };
}

export function mapYouTubeVideo(rawItem: unknown): NormalizedPost | null {
  const item = asRecord(rawItem);
  const externalPostId = asText(item?.["id"], 512);
  if (!item || !externalPostId) return null;
  const snippet = asRecord(item["snippet"]);
  const { metrics, availability } = mapYouTubeMetrics(item["statistics"]);
  return {
    platform: "youtube",
    externalPostId,
    canonicalUrl: `https://youtube.com/watch?v=${externalPostId}`,
    authorHandle: asText(snippet?.["customUrl"], 255),
    authorDisplayName: asText(snippet?.["channelTitle"], 512),
    contentText: asText(snippet?.["title"], 20000),
    mediaType: "video",
    publishedAt: asTimestamp(snippet?.["publishedAt"]),
    metrics,
    availability,
  };
}

export function mapYouTubeMetricsObservation(
  rawItem: unknown,
  fallbackUrl: string,
): NormalizedMetricsObservation | null {
  const item = asRecord(rawItem);
  if (!item) return null;
  const externalPostId = asText(item["id"], 512);
  const { metrics, availability } = mapYouTubeMetrics(item["statistics"]);
  return {
    platform: "youtube",
    externalPostId,
    canonicalUrl: externalPostId ? `https://youtube.com/watch?v=${externalPostId}` : fallbackUrl,
    metrics,
    availability,
  };
}

export function mapYouTubeChannel(rawItem: unknown): {
  source: NormalizedSource;
  uploadsPlaylistId: string | null;
} | null {
  const item = asRecord(rawItem);
  const channelId = asText(item?.["id"], 512);
  if (!item || !channelId) return null;
  const snippet = asRecord(item["snippet"]);
  const uploads = asRecord(asRecord(item["contentDetails"])?.["relatedPlaylists"])?.["uploads"];
  return {
    source: {
      platform: "youtube",
      canonicalUrl: `https://youtube.com/channel/${channelId}`,
      handle: asText(snippet?.["customUrl"], 255),
      externalAccountId: channelId,
      displayName: asText(snippet?.["title"], 512),
    },
    uploadsPlaylistId: asText(uploads, 512),
  };
}

/** Ordered video ids from one page of playlistItems. */
export function playlistVideoIds(body: unknown): string[] {
  const items = asRecord(body)?.["items"];
  if (!Array.isArray(items)) return [];
  const ids: string[] = [];
  for (const entry of items) {
    const item = asRecord(entry);
    const id =
      asText(asRecord(item?.["contentDetails"])?.["videoId"], 512) ??
      asText(asRecord(asRecord(item?.["snippet"])?.["resourceId"])?.["videoId"], 512);
    if (id && !ids.includes(id)) ids.push(id);
  }
  return ids;
}

/** Fallback post built from a playlist item when statistics enrichment is absent. */
export function mapPlaylistItemFallback(videoId: string, rawItem: unknown): NormalizedPost {
  const snippet = asRecord(asRecord(rawItem)?.["snippet"]);
  return {
    platform: "youtube",
    externalPostId: videoId,
    canonicalUrl: `https://youtube.com/watch?v=${videoId}`,
    authorHandle: null,
    authorDisplayName: asText(snippet?.["channelTitle"], 512),
    contentText: asText(snippet?.["title"], 20000),
    mediaType: "video",
    publishedAt: asTimestamp(snippet?.["publishedAt"]),
    metrics: emptyMetrics(),
    availability: {
      views: "unknown",
      likes: "unknown",
      comments: "unknown",
      shares: "unavailable",
      saves: "not_applicable",
    },
  };
}

/* ---------------------------------------------------------------------------
 * Errors
 * ------------------------------------------------------------------------- */

const MESSAGES: Partial<Record<ProviderErrorCode, string>> = {
  PROVIDER_NOT_CONFIGURED: "The YouTube connection is not configured, so nothing was read.",
  UNSUPPORTED_PLATFORM: "That link is not a YouTube link.",
  INVALID_URL: "That is not a usable public YouTube link.",
  NOT_FOUND: "That video or channel could not be found.",
  PRIVATE_OR_BLOCKED: "That content is private, removed, or not publicly readable.",
  UNAUTHORIZED: "YouTube rejected the configured credentials.",
  RATE_LIMITED: "The YouTube daily quota or rate limit has been reached.",
  PROVIDER_UNAVAILABLE: "YouTube is temporarily unavailable.",
  TIMEOUT: "YouTube did not respond in time.",
  MALFORMED_RESPONSE: "YouTube returned an unreadable response.",
  UNKNOWN: "YouTube returned an unexpected error.",
};

export function youtubeMessageFor(code: ProviderErrorCode): string {
  return MESSAGES[code] ?? "YouTube returned an unexpected error.";
}

export function mapYouTubeHttpStatus(status: number): ProviderErrorCode {
  if (status === 400) return "INVALID_URL";
  if (status === 401) return "UNAUTHORIZED";
  if (status === 403) return "RATE_LIMITED";
  if (status === 404) return "NOT_FOUND";
  if (status === 429) return "RATE_LIMITED";
  if (status >= 500) return "PROVIDER_UNAVAILABLE";
  return "UNKNOWN";
}

function fail<T>(code: ProviderErrorCode): ProviderResult<T> {
  return providerFailure<T>(YOUTUBE_PROVIDER_ID, code, youtubeMessageFor(code));
}

export function youtubeSanitizedFailure(code: ProviderErrorCode): ProviderError {
  const result = fail<never>(code);
  return (result as Extract<typeof result, { ok: false }>).error;
}

/* ---------------------------------------------------------------------------
 * Transport
 * ------------------------------------------------------------------------- */

function readApiKey(): string | null {
  const key = process.env[YOUTUBE_API_KEY_ENV]?.trim();
  return key ? key : null;
}

type Transport = { ok: true; body: unknown } | { ok: false; code: ProviderErrorCode };

/** Single GET. The key is appended here and nowhere else. No retry, ever. */
async function getJson(builtUrl: string, apiKey: string): Promise<Transport> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), YOUTUBE_TIMEOUT_MS);
  try {
    const url = `${builtUrl}&key=${encodeURIComponent(apiKey)}`;
    const response = await fetch(url, {
      method: "GET",
      headers: { Accept: "application/json" },
      signal: controller.signal,
    });
    if (!response.ok) return { ok: false, code: mapYouTubeHttpStatus(response.status) };
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

function firstItem(body: unknown): Rec | null {
  const items = asRecord(body)?.["items"];
  if (!Array.isArray(items) || items.length === 0) return null;
  return asRecord(items[0]);
}

async function readVideoItem(
  url: unknown,
): Promise<{ ok: true; item: Rec; canonicalUrl: string } | { ok: false; code: ProviderErrorCode }> {
  const resolved = resolveYouTubeUrl(url);
  if (!resolved.ok) return { ok: false, code: resolved.code };
  if (resolved.target.kind !== "video") return { ok: false, code: "INVALID_URL" };

  // Missing credentials short-circuit BEFORE any fetch is constructed.
  const apiKey = readApiKey();
  if (!apiKey) return { ok: false, code: "PROVIDER_NOT_CONFIGURED" };

  const response = await getJson(buildVideosListUrl([resolved.target.videoId]), apiKey);
  if (!response.ok) return { ok: false, code: response.code };
  const item = firstItem(response.body);
  if (!item) return { ok: false, code: "NOT_FOUND" };
  return { ok: true, item, canonicalUrl: resolved.target.canonicalUrl };
}

/* ---------------------------------------------------------------------------
 * Provider
 * ------------------------------------------------------------------------- */

export const youtubeReadProvider: SocialReadProvider = {
  id: YOUTUBE_PROVIDER_ID,

  supports(platform: SocialPlatform, capability: SocialReadCapability): boolean {
    return platform === "youtube" && ["post", "source_recent_posts", "metrics"].includes(capability);
  },

  async fetchPostByUrl({ url }) {
    const payload = await readVideoItem(url);
    if (!payload.ok) return fail<NormalizedPost>(payload.code);
    const mapped = mapYouTubeVideo(payload.item);
    if (!mapped) return fail<NormalizedPost>("MALFORMED_RESPONSE");
    // Quota consumption, not a monetary charge.
    return providerSuccess<NormalizedPost>(YOUTUBE_PROVIDER_ID, mapped, {
      billable: false,
      units: 1,
    });
  },

  async fetchPostMetrics({ url }) {
    const payload = await readVideoItem(url);
    if (!payload.ok) return fail<NormalizedMetricsObservation>(payload.code);
    const mapped = mapYouTubeMetricsObservation(payload.item, payload.canonicalUrl);
    if (!mapped) return fail<NormalizedMetricsObservation>("MALFORMED_RESPONSE");
    return providerSuccess<NormalizedMetricsObservation>(YOUTUBE_PROVIDER_ID, mapped, {
      billable: false,
      units: 1,
    });
  },

  async fetchSourceRecentPosts({ url, limit }) {
    const resolved = resolveYouTubeUrl(url);
    if (!resolved.ok) return fail<NormalizedSourceRecentPosts>(resolved.code);
    if (resolved.target.kind !== "channel") {
      return fail<NormalizedSourceRecentPosts>("INVALID_URL");
    }

    const apiKey = readApiKey();
    if (!apiKey) return fail<NormalizedSourceRecentPosts>("PROVIDER_NOT_CONFIGURED");

    // 1. channels.list (quota 1)
    const channelResponse = await getJson(
      buildChannelsListUrl(resolved.target.selector, resolved.target.value),
      apiKey,
    );
    if (!channelResponse.ok) return fail<NormalizedSourceRecentPosts>(channelResponse.code);
    const channel = mapYouTubeChannel(firstItem(channelResponse.body));
    if (!channel) return fail<NormalizedSourceRecentPosts>("NOT_FOUND");
    let quotaUnits = 1;

    // 2. uploads playlist id → 3. playlistItems.list, one page (quota 1)
    if (!channel.uploadsPlaylistId) {
      return providerSuccess<NormalizedSourceRecentPosts>(
        YOUTUBE_PROVIDER_ID,
        { source: channel.source, posts: [], hasMore: false },
        { billable: false, units: quotaUnits },
      );
    }
    const playlistResponse = await getJson(
      buildPlaylistItemsUrl(channel.uploadsPlaylistId, limit),
      apiKey,
    );
    if (!playlistResponse.ok) return fail<NormalizedSourceRecentPosts>(playlistResponse.code);
    quotaUnits += 1;

    const videoIds = playlistVideoIds(playlistResponse.body).slice(0, youtubeLimit(limit));
    const playlistItems = Array.isArray(asRecord(playlistResponse.body)?.["items"])
      ? (asRecord(playlistResponse.body)?.["items"] as unknown[])
      : [];

    // 4. one videos.list enrichment for public statistics (quota 1). No search.
    const enriched = new Map<string, NormalizedPost>();
    if (videoIds.length > 0) {
      const videosResponse = await getJson(buildVideosListUrl(videoIds), apiKey);
      if (videosResponse.ok) {
        quotaUnits += 1;
        const items = asRecord(videosResponse.body)?.["items"];
        if (Array.isArray(items)) {
          for (const entry of items) {
            const mapped = mapYouTubeVideo(entry);
            if (mapped) enriched.set(mapped.externalPostId, mapped);
          }
        }
      }
    }

    const posts = videoIds.map((videoId, index) => {
      const hit = enriched.get(videoId);
      return hit ?? mapPlaylistItemFallback(videoId, playlistItems[index]);
    });

    const nextPageToken = asText(asRecord(playlistResponse.body)?.["nextPageToken"], 512);

    return providerSuccess<NormalizedSourceRecentPosts>(
      YOUTUBE_PROVIDER_ID,
      { source: channel.source, posts, hasMore: nextPageToken !== null },
      { billable: false, units: quotaUnits },
    );
  },
};
