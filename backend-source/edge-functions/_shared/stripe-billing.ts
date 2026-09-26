/**
 * CARTEL HQ — self-managed Stripe billing shared helper.
 *
 * Invariants:
 *  - Official Stripe SDK, pinned Deno npm import. No package.json change.
 *  - Stripe keys are read server-side only and never logged.
 *  - CARTEL_HQ_BILLING_ENVIRONMENT (test|live) selects STRIPE_TEST_SECRET_KEY /
 *    STRIPE_LIVE_SECRET_KEY; legacy STRIPE_SECRET_KEY is the fallback.
 *  - The key prefix must match the selected environment; otherwise fail closed.
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

function envValue(name: string): string {
  return (Deno.env.get(name) ?? "").trim();
}

/** Explicit environment selection; null when unset (legacy mode) or invalid. */
export function selectedBillingEnvironment(): StripeEnvironment | "invalid" | null {
  const raw = envValue("CARTEL_HQ_BILLING_ENVIRONMENT").toLowerCase();
  if (!raw) return null;
  if (raw === "test" || raw === "live") return raw;
  return "invalid";
}

function stripeClient(key: string): Stripe {
  return new Stripe(key, {
    apiVersion: STRIPE_API_VERSION as Stripe.LatestApiVersion,
    httpClient: Stripe.createFetchHttpClient(),
  });
}

/** Resolve the Stripe key for one environment: dedicated key first, legacy fallback. */
function keyForEnvironment(env: StripeEnvironment): string | null {
  const dedicated = envValue(env === "live" ? "STRIPE_LIVE_SECRET_KEY" : "STRIPE_TEST_SECRET_KEY");
  if (dedicated && stripeEnvironmentForKey(dedicated) === env) return dedicated;
  if (dedicated) return null; // dedicated key present but wrong mode: fail closed
  const legacy = envValue("STRIPE_SECRET_KEY");
  if (legacy && stripeEnvironmentForKey(legacy) === env) return legacy;
  return null;
}

export function getStripeConfig(): StripeConfig {
  const selected = selectedBillingEnvironment();
  if (selected === "invalid") return { ok: false, code: "BILLING_NOT_CONFIGURED" };
  if (selected) {
    const key = keyForEnvironment(selected);
    if (!key) return { ok: false, code: "BILLING_NOT_CONFIGURED" };
    return { ok: true, stripe: stripeClient(key), environment: selected };
  }
  // Legacy single-key mode: environment derived from STRIPE_SECRET_KEY prefix.
  const key = envValue("STRIPE_SECRET_KEY");
  const environment = stripeEnvironmentForKey(key);
  if (!environment) return { ok: false, code: "BILLING_NOT_CONFIGURED" };
  return { ok: true, stripe: stripeClient(key), environment };
}

export type StripeWebhookConfig = { stripe: Stripe; environment: StripeEnvironment; webhookSecret: string };

/**
 * All webhook configurations that are fully configured (key + signing secret).
 * Dedicated STRIPE_{TEST,LIVE}_WEBHOOK_SECRET first; legacy STRIPE_WEBHOOK_SECRET
 * applies only to the legacy/selected environment.
 */
export function getStripeWebhookConfigs(): StripeWebhookConfig[] {
  const selected = selectedBillingEnvironment();
  if (selected === "invalid") return [];
  const legacyEnv: StripeEnvironment | null = selected ?? stripeEnvironmentForKey(envValue("STRIPE_SECRET_KEY"));
  const legacySecret = envValue("STRIPE_WEBHOOK_SECRET");
  const out: StripeWebhookConfig[] = [];
  for (const env of ["test", "live"] as const) {
    const key = keyForEnvironment(env);
    if (!key) continue;
    const dedicated = envValue(env === "live" ? "STRIPE_LIVE_WEBHOOK_SECRET" : "STRIPE_TEST_WEBHOOK_SECRET");
    const webhookSecret = dedicated || (legacyEnv === env ? legacySecret : "");
    if (!webhookSecret) continue;
    out.push({ stripe: stripeClient(key), environment: env, webhookSecret });
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
