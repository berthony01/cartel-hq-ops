/**
 * SE-2 — Cartel Social Engine provider-neutral READ contract.
 *
 * PURE MODULE. Zero I/O: no fetch, no Supabase, no Deno/process env, no secret
 * name, no provider host. It is safe to import from anywhere, including browser
 * bundles, and it must stay that way.
 *
 * Architecture authority: docs/SE0_SOCIAL_ENGINE_ARCHITECTURE_LOCK.md.
 * The interface deliberately exposes READ capability only. There is no publish,
 * schedule, delete, OAuth, like, repost, comment, follow, bookmark or DM method,
 * so a future vendor adapter cannot introduce one without changing this contract.
 */

/** Exactly the platforms admitted by the SE-1 `social_sources_platform_ck` CHECK. */
export const SOCIAL_PLATFORMS = ["x", "instagram", "tiktok", "youtube", "facebook"] as const;
export type SocialPlatform = (typeof SOCIAL_PLATFORMS)[number];

/** The only three read capabilities SE-2 admits. */
export const SOCIAL_READ_CAPABILITIES = ["post", "source_recent_posts", "metrics"] as const;
export type SocialReadCapability = (typeof SOCIAL_READ_CAPABILITIES)[number];

/** Canonical metric keys frozen by SE-0 section 6. */
export const SOCIAL_METRIC_KEYS = ["views", "likes", "comments", "shares", "saves"] as const;
export type SocialMetricKey = (typeof SOCIAL_METRIC_KEYS)[number];

/**
 * `null` means unavailable / unsupported / unknown. It is NEVER coerced to zero.
 */
export type NormalizedMetrics = Record<SocialMetricKey, number | null>;

/**
 * Why a metric holds the value it holds.
 * - `available`     — the provider returned a real value for this platform.
 * - `unavailable`   — the platform/provider supports it but did not return it.
 * - `not_applicable`— the metric does not exist on this platform.
 * - `unknown`       — the provider said nothing about availability.
 */
export type MetricAvailabilityState = "available" | "unavailable" | "not_applicable" | "unknown";
export type MetricAvailability = Record<SocialMetricKey, MetricAvailabilityState>;

export type NormalizedSource = {
  platform: SocialPlatform;
  canonicalUrl: string;
  handle: string | null;
  externalAccountId: string | null;
  displayName: string | null;
};

export type NormalizedPost = {
  platform: SocialPlatform;
  externalPostId: string;
  canonicalUrl: string;
  authorHandle: string | null;
  authorDisplayName: string | null;
  contentText: string | null;
  mediaType: string | null;
  publishedAt: string | null;
  metrics: NormalizedMetrics;
  availability: MetricAvailability;
};

/** A public source plus one page of its recent public posts. */
export type NormalizedSourceRecentPosts = {
  source: NormalizedSource;
  posts: NormalizedPost[];
  /** True when the provider indicates more pages exist. SE-2 never fetches them. */
  hasMore: boolean;
};

/** Metrics-only observation for a post already known to the caller. */
export type NormalizedMetricsObservation = {
  platform: SocialPlatform;
  externalPostId: string | null;
  canonicalUrl: string;
  metrics: NormalizedMetrics;
  availability: MetricAvailability;
};

export type ProviderErrorCode =
  | "PROVIDER_NOT_CONFIGURED"
  | "UNSUPPORTED_PLATFORM"
  | "INVALID_URL"
  | "NOT_FOUND"
  | "PRIVATE_OR_BLOCKED"
  | "MINIMUM_AGE_REQUIRED"
  | "MISSING_METRICS"
  | "UNAUTHORIZED"
  | "INSUFFICIENT_BALANCE"
  | "BILLING_UNAVAILABLE"
  | "RATE_LIMITED"
  | "PROVIDER_UNAVAILABLE"
  | "TIMEOUT"
  | "MALFORMED_RESPONSE"
  | "UNKNOWN";

/** Only transient conditions are retryable. SE-2 never retries automatically. */
export const RETRYABLE_PROVIDER_ERROR_CODES: readonly ProviderErrorCode[] = [
  "RATE_LIMITED",
  "PROVIDER_UNAVAILABLE",
  "BILLING_UNAVAILABLE",
  "TIMEOUT",
] as const;

export type ProviderError = {
  code: ProviderErrorCode;
  retryable: boolean;
  /** Short, sanitized, user-safe. Never a raw payload, URL, key or stack. */
  message: string;
};

export type ProviderResult<T> =
  | {
      ok: true;
      provider: string;
      observedAt: string;
      /** True only when the provider actually charged for a successful target. */
      billable: boolean;
      /** Billable units when unambiguous; `null` when the provider is unclear. */
      units: number | null;
      data: T;
    }
  | {
      ok: false;
      provider: string;
      observedAt: string;
      /** A failure is never recorded as provider cost. */
      billable: false;
      units: 0;
      error: ProviderError;
    };

/**
 * The complete SE-2 provider surface. Three read operations, nothing else.
 */
export interface SocialReadProvider {
  readonly id: string;
  supports(platform: SocialPlatform, capability: SocialReadCapability): boolean;
  fetchPostByUrl(input: { url: string }): Promise<ProviderResult<NormalizedPost>>;
  fetchSourceRecentPosts(input: {
    url: string;
    limit?: number;
  }): Promise<ProviderResult<NormalizedSourceRecentPosts>>;
  fetchPostMetrics(input: { url: string }): Promise<ProviderResult<NormalizedMetricsObservation>>;
}

/* ---------------------------------------------------------------------------
 * Pure helpers
 * ------------------------------------------------------------------------- */

export function isSocialPlatform(value: unknown): value is SocialPlatform {
  return typeof value === "string" && (SOCIAL_PLATFORMS as readonly string[]).includes(value);
}

/** Finite non-negative numbers only. Everything else, including `0`-like strings, is null. */
export function toMetricValue(raw: unknown): number | null {
  if (typeof raw !== "number") return null;
  if (!Number.isFinite(raw) || raw < 0) return null;
  return raw;
}

export function emptyMetrics(): NormalizedMetrics {
  return { views: null, likes: null, comments: null, shares: null, saves: null };
}

export function unknownAvailability(): MetricAvailability {
  return {
    views: "unknown",
    likes: "unknown",
    comments: "unknown",
    shares: "unknown",
    saves: "unknown",
  };
}

/**
 * Normalize one provider availability token.
 * Unrecognized tokens become `unknown` — never `available`, never a zero.
 */
export function normalizeAvailabilityState(raw: unknown): MetricAvailabilityState {
  if (typeof raw !== "string") return "unknown";
  const token = raw.trim().toLowerCase();
  if (token === "available") return "available";
  if (token === "unavailable" || token === "unsupported") return "unavailable";
  if (token === "not_applicable" || token === "not-applicable" || token === "n/a") {
    return "not_applicable";
  }
  return "unknown";
}

/**
 * Build canonical metrics + availability from a raw provider metrics object and
 * an optional provider availability object.
 *
 * When the provider omits availability entirely (YouTube currently does), a real
 * finite number is inferred as `available` and anything else stays `unknown`.
 * A missing value is NEVER inferred as `not_applicable` or `unavailable`.
 */
export function buildMetrics(
  rawMetrics: unknown,
  rawAvailability: unknown,
): { metrics: NormalizedMetrics; availability: MetricAvailability } {
  const metricsObject =
    rawMetrics && typeof rawMetrics === "object" ? (rawMetrics as Record<string, unknown>) : {};
  const availabilityObject =
    rawAvailability && typeof rawAvailability === "object"
      ? (rawAvailability as Record<string, unknown>)
      : null;

  const metrics = emptyMetrics();
  const availability = unknownAvailability();

  for (const key of SOCIAL_METRIC_KEYS) {
    const value = toMetricValue(metricsObject[key]);
    metrics[key] = value;

    if (availabilityObject && key in availabilityObject) {
      availability[key] = normalizeAvailabilityState(availabilityObject[key]);
      continue;
    }
    availability[key] = value === null ? "unknown" : "available";
  }

  return { metrics, availability };
}

export function providerFailure<T>(
  provider: string,
  code: ProviderErrorCode,
  message: string,
  observedAt: string = new Date().toISOString(),
): ProviderResult<T> {
  return {
    ok: false,
    provider,
    observedAt,
    billable: false,
    units: 0,
    error: {
      code,
      retryable: RETRYABLE_PROVIDER_ERROR_CODES.includes(code),
      message,
    },
  };
}

export function providerSuccess<T>(
  provider: string,
  data: T,
  options: { billable: boolean; units: number | null; observedAt?: string },
): ProviderResult<T> {
  return {
    ok: true,
    provider,
    observedAt: options.observedAt ?? new Date().toISOString(),
    billable: options.billable,
    units: options.units,
    data,
  };
}
