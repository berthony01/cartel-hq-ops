/**
 * CARTEL HQ — self-managed Stripe billing shared helper.
 *
 * Invariants:
 *  - Official Stripe SDK, pinned Deno npm import. No package.json change.
 *  - STRIPE_SECRET_KEY is read server-side only and never logged.
 *  - Environment is derived from the key prefix; anything else fails closed.
 *  - No hardcoded Stripe price/product/customer IDs: refs come from the DB.
 *  - Every Cartel runtime Stripe object carries app=cartel_hq metadata.
 *  - Email is never an authority; at most a receipt/prefill value.
 */
import Stripe from "npm:stripe@17.7.0";

export const CARTEL_APP = "cartel_hq";
export const PRO_PLAN_CODE = "cartel_49";
export const PRO_PLAN_VERSION = 1;
export const STRIPE_API_VERSION = "2025-02-24.acacia";
export const DEFAULT_PUBLIC_BASE_URL = "https://cartel-hq-ops.lovable.app";

export type StripeEnvironment = "test" | "live";

export type StripeConfig =
  | { ok: true; stripe: Stripe; environment: StripeEnvironment }
  | { ok: false; code: "BILLING_NOT_CONFIGURED" };

export function stripeEnvironmentForKey(key: string): StripeEnvironment | null {
  if (key.startsWith("sk_test_") || key.startsWith("rk_test_")) return "test";
  if (key.startsWith("sk_live_") || key.startsWith("rk_live_")) return "live";
  return null;
}

export function getStripeConfig(): StripeConfig {
  const key = Deno.env.get("STRIPE_SECRET_KEY") ?? "";
  const environment = stripeEnvironmentForKey(key);
  if (!environment) return { ok: false, code: "BILLING_NOT_CONFIGURED" };
  const stripe = new Stripe(key, {
    apiVersion: STRIPE_API_VERSION as Stripe.LatestApiVersion,
    httpClient: Stripe.createFetchHttpClient(),
  });
  return { ok: true, stripe, environment };
}

export const stripeCryptoProvider = Stripe.createSubtleCryptoProvider();

export function publicBaseUrl(): string | null {
  const raw = (Deno.env.get("CARTEL_HQ_PUBLIC_BASE_URL") ?? "").trim().replace(/\/+$/, "");
  if (!raw) return null;
  try {
    const u = new URL(raw);
    if (u.protocol !== "https:") return null;
    return u.origin;
  } catch {
    return null;
  }
}

export const billingCors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

export function billingRespond(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...billingCors, "Content-Type": "application/json" },
  });
}

/** Subscription statuses that keep Pro. past_due keeps Pro (no custom grace timer). */
export const PRO_STATUSES = ["active", "trialing", "past_due"] as const;

export function isCartelMetadata(md: Record<string, string> | null | undefined): boolean {
  return !!md && md.app === CARTEL_APP;
}

export type { Stripe };
