/**
 * SE-2.1 — Direct-first social read router (SERVER ONLY).
 *
 * Routing policy (frozen for SE-2.1):
 * - `x`        → official X API adapter.
 * - `youtube`  → official YouTube Data API adapter.
 * - `instagram`, `facebook`, `tiktok` → typed PROVIDER_NOT_CONFIGURED refusal.
 *
 * There is NO Refetcher fallback. The Refetcher adapter stays in the repository
 * as a dormant historical/fallback implementation and is deliberately not
 * imported here, so it is unreachable from the runtime boundary. Reintroducing
 * it requires an explicit later authorization, not an env flag.
 *
 * TikTok direct reads need an authorized user's OAuth token (Display API) and
 * Meta direct reads need a connected account plus a permissions review; both are
 * deferred to dedicated later phases rather than silently scraped.
 */

import {
  providerFailure,
  type NormalizedMetricsObservation,
  type NormalizedPost,
  type NormalizedSourceRecentPosts,
  type ProviderResult,
  type SocialPlatform,
  type SocialReadProvider,
} from "./social-read-provider";
import { resolveXUrl, xReadProvider } from "./social-read-x.server";
import { resolveYouTubeUrl, youtubeReadProvider } from "./social-read-youtube.server";

export const ROUTER_PROVIDER_ID = "cartel-direct-router";
export const DEFERRED_PLATFORMS: readonly SocialPlatform[] = ["instagram", "tiktok", "facebook"];

export type RouteDecision =
  | { kind: "direct"; platform: SocialPlatform; providerId: string }
  | { kind: "deferred"; platform: SocialPlatform }
  | { kind: "unroutable"; code: "INVALID_URL" | "UNSUPPORTED_PLATFORM" };

const DEFERRED_MESSAGE =
  "Official reading for that platform is not connected yet, so nothing was read.";

/** Host allowlist for the platforms whose official integration is deferred. */
const DEFERRED_HOSTS: Record<"instagram" | "tiktok" | "facebook", readonly string[]> = {
  instagram: ["instagram.com"],
  tiktok: ["tiktok.com", "vm.tiktok.com"],
  facebook: ["facebook.com", "m.facebook.com", "fb.watch"],
};

/** Pure routing decision from a validated public URL. No I/O. */
export function routeSocialUrl(raw: unknown): RouteDecision {
  const asX = resolveXUrl(raw);
  if (asX.ok) return { kind: "direct", platform: "x", providerId: xReadProvider.id };

  const asYouTube = resolveYouTubeUrl(raw);
  if (asYouTube.ok) {
    return { kind: "direct", platform: "youtube", providerId: youtubeReadProvider.id };
  }

  // A well-formed link on a supported-but-deferred platform is refused by policy,
  // never routed to a scraping vendor.
  const host = hostOf(raw);
  if (host) {
    for (const platform of Object.keys(DEFERRED_HOSTS) as (keyof typeof DEFERRED_HOSTS)[]) {
      if (DEFERRED_HOSTS[platform].includes(host)) return { kind: "deferred", platform };
    }
  }

  // Both direct resolvers rejected it. A recognised-host-but-bad-path answer from
  // either resolver stays INVALID_URL; anything else is an unsupported platform.
  const code =
    asX.code === "INVALID_URL" || asYouTube.code === "INVALID_URL"
      ? "INVALID_URL"
      : "UNSUPPORTED_PLATFORM";
  return { kind: "unroutable", code };
}

function hostOf(raw: unknown): string | null {
  if (typeof raw !== "string" || !raw.trim()) return null;
  try {
    const parsed = new URL(raw.trim());
    if (parsed.protocol !== "https:" && parsed.protocol !== "http:") return null;
    if (parsed.username || parsed.password || parsed.port) return null;
    return parsed.hostname.toLowerCase().replace(/^www\./, "");
  } catch {
    return null;
  }
}

function refuse<T>(decision: Exclude<RouteDecision, { kind: "direct" }>): ProviderResult<T> {
  if (decision.kind === "deferred") {
    return providerFailure<T>(ROUTER_PROVIDER_ID, "PROVIDER_NOT_CONFIGURED", DEFERRED_MESSAGE);
  }
  return providerFailure<T>(
    ROUTER_PROVIDER_ID,
    decision.code,
    decision.code === "INVALID_URL"
      ? "That is not a usable public social link."
      : "That link is not one of the supported social platforms.",
  );
}

function adapterFor(platform: SocialPlatform): SocialReadProvider | null {
  if (platform === "x") return xReadProvider;
  if (platform === "youtube") return youtubeReadProvider;
  return null;
}

/**
 * Provider-neutral façade. Exposes exactly the same three read operations, so
 * `social-read.functions.ts` never learns which adapter served a request.
 */
export const socialReadRouter: SocialReadProvider = {
  id: ROUTER_PROVIDER_ID,

  supports(platform, capability) {
    const adapter = adapterFor(platform);
    return adapter ? adapter.supports(platform, capability) : false;
  },

  fetchPostByUrl({ url }) {
    const decision = routeSocialUrl(url);
    if (decision.kind !== "direct") return Promise.resolve(refuse<NormalizedPost>(decision));
    return adapterFor(decision.platform)!.fetchPostByUrl({ url });
  },

  fetchPostMetrics({ url }) {
    const decision = routeSocialUrl(url);
    if (decision.kind !== "direct") {
      return Promise.resolve(refuse<NormalizedMetricsObservation>(decision));
    }
    return adapterFor(decision.platform)!.fetchPostMetrics({ url });
  },

  fetchSourceRecentPosts({ url, limit }) {
    const decision = routeSocialUrl(url);
    if (decision.kind !== "direct") {
      return Promise.resolve(refuse<NormalizedSourceRecentPosts>(decision));
    }
    return adapterFor(decision.platform)!.fetchSourceRecentPosts({
      url,
      ...(limit === undefined ? {} : { limit }),
    });
  },
};
