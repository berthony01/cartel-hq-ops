/**
 * CARTEL HQ — self-managed Stripe billing shared helper.
 *
 * Invariants:
 *  - Official Stripe SDK, pinned Deno npm import. No package.json change.
 *  - Stripe keys are read server-side only and never logged.
 *  - CARTEL_HQ_BILLING_ENVIRONMENT (exactly test|live) selects the environment,
 *    otherwise it is derived from the legacy STRIPE_SECRET_KEY prefix.
 *  - A key is used only when its prefix matches the environment.
 *  - No hardcoded Stripe price/product/customer IDs: refs come from the DB.
 *  - Every Cartel runtime Stripe object carries app=cartel_hq metadata.
 *  - Email is never an authority; at most a receipt/prefill value.
 */
import Stripe from "npm:stripe@17.7.0";

export const CARTEL_APP = "cartel_hq";
export const PRO_PLAN_CODE = "cartel_49";
export const PRO_PLAN_VERSION = 1;
export const STRIPE_API_VERSION = "2025-02-24.acacia";
export const DEFAULT_PUBLIC_BASE_URL = "https://pepecartelhq.com";

export type StripeEnvironment = "test" | "live";

export type StripeConfig =
  | { ok: true; stripe: Stripe; environment: StripeEnvironment }
  | { ok: false; code: "BILLING_NOT_CONFIGURED" };

export function stripeEnvironmentForKey(key: string): StripeEnvironment | null {
  if (key.startsWith("sk_test_") || key.startsWith("rk_test_")) return "test";
  if (key.startsWith("sk_live_") || key.startsWith("rk_live_")) return "live";
  return null;
}

function stripeClient(key: string): Stripe {
  return new Stripe(key, {
    apiVersion: STRIPE_API_VERSION as Stripe.LatestApiVersion,
    httpClient: Stripe.createFetchHttpClient(),
  });
}

/**
 * Dedicated STRIPE_{TEST,LIVE}_SECRET_KEY is used only when its prefix matches the
 * requested environment; otherwise legacy STRIPE_SECRET_KEY is used if it matches.
 * A wrong-mode dedicated key never blocks a correct legacy fallback.
 */
export function getStripeConfigForEnvironment(environment: StripeEnvironment): StripeConfig {
  const dedicated = (Deno.env.get(environment === "live" ? "STRIPE_LIVE_SECRET_KEY" : "STRIPE_TEST_SECRET_KEY") ?? "").trim();
  const legacy = (Deno.env.get("STRIPE_SECRET_KEY") ?? "").trim();
  if (dedicated && stripeEnvironmentForKey(dedicated) === environment) {
    return { ok: true, stripe: stripeClient(dedicated), environment };
  }
  if (legacy && stripeEnvironmentForKey(legacy) === environment) {
    return { ok: true, stripe: stripeClient(legacy), environment };
  }
  return { ok: false, code: "BILLING_NOT_CONFIGURED" };
}

/** CARTEL_HQ_BILLING_ENVIRONMENT if exactly test/live; otherwise derived from STRIPE_SECRET_KEY. */
export function activeStripeEnvironment(): StripeEnvironment | null {
  const configured = (Deno.env.get("CARTEL_HQ_BILLING_ENVIRONMENT") ?? "").trim().toLowerCase();
  if (configured === "test" || configured === "live") return configured;
  return stripeEnvironmentForKey((Deno.env.get("STRIPE_SECRET_KEY") ?? "").trim());
}

export function getStripeConfig(): StripeConfig {
  const environment = activeStripeEnvironment();
  if (!environment) return { ok: false, code: "BILLING_NOT_CONFIGURED" };
  return getStripeConfigForEnvironment(environment);
}

export type StripeWebhookConfig = { stripe: Stripe; environment: StripeEnvironment; webhookSecret: string };

/**
 * Fully configured webhook environments. Dedicated STRIPE_{TEST,LIVE}_WEBHOOK_SECRET
 * first; legacy STRIPE_WEBHOOK_SECRET applies only to the environment of the legacy
 * STRIPE_SECRET_KEY prefix (never assigned via CARTEL_HQ_BILLING_ENVIRONMENT).
 */
export function getStripeWebhookConfigs(): StripeWebhookConfig[] {
  const legacyEnvironment = stripeEnvironmentForKey((Deno.env.get("STRIPE_SECRET_KEY") ?? "").trim());
  const legacySecret = (Deno.env.get("STRIPE_WEBHOOK_SECRET") ?? "").trim();
  const out: StripeWebhookConfig[] = [];
  for (const environment of ["test", "live"] as const) {
    const cfg = getStripeConfigForEnvironment(environment);
    if (!cfg.ok) continue;
    const dedicatedSecret = (Deno.env.get(environment === "live" ? "STRIPE_LIVE_WEBHOOK_SECRET" : "STRIPE_TEST_WEBHOOK_SECRET") ?? "").trim();
    const webhookSecret = dedicatedSecret || (legacyEnvironment === environment ? legacySecret : "");
    if (!webhookSecret) continue;
    out.push({ stripe: cfg.stripe, environment, webhookSecret });
  }
  return out;
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
