import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2";
import {
  CARTEL_APP,
  getStripeWebhookConfigs,
  isCartelMetadata,
  PRO_PLAN_CODE,
  PRO_PLAN_VERSION,
  PRO_STATUSES,
  stripeCryptoProvider,
  type Stripe,
} from "../_shared/stripe-billing.ts";

/**
 * CARTEL HQ stripe-billing-webhook (verify_jwt=false).
 *
 *  - Raw body + Stripe-Signature verified with the official SDK BEFORE any processing.
 *  - Signature is verified against each configured environment (test/live);
 *    the environment that verifies it is used, and event.livemode must match.
 *  - Shared Stripe account: events whose subscription/session lacks app=cartel_hq
 *    are acknowledged and ignored with NO Cartel database mutation.
 *  - Stripe's current subscription object (retrieved) is the source of truth;
 *    the checkout success URL never grants anything.
 *  - Idempotent via commercial_billing_events. No raw payload is stored.
 */

const RELEVANT_EVENTS = new Set([
  "checkout.session.completed",
  "customer.subscription.created",
  "customer.subscription.updated",
  "customer.subscription.deleted",
  "customer.subscription.paused",
  "customer.subscription.resumed",
  "invoice.paid",
  "invoice.payment_failed",
  "invoice.payment_action_required",
]);

const PAYMENT_FAILURE_EVENTS = new Set(["invoice.payment_failed", "invoice.payment_action_required"]);
const STALE_PROCESSING_MS = 5 * 60 * 1000;
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function text(body: string, status: number) {
  return new Response(body, { status, headers: { "Content-Type": "text/plain" } });
}

function refOf(value: unknown): string | null {
  if (typeof value === "string" && value) return value;
  if (value && typeof value === "object" && typeof (value as { id?: unknown }).id === "string") return (value as { id: string }).id;
  return null;
}

function tsOrNull(value: unknown): string | null {
  return typeof value === "number" && Number.isFinite(value) ? new Date(value * 1000).toISOString() : null;
}

Deno.serve(async (req: Request) => {
  if (req.method !== "POST") return text("method not allowed", 405);

  const configs = getStripeWebhookConfigs();
  if (configs.length === 0) return text("billing not configured", 503);

  const signature = req.headers.get("Stripe-Signature") ?? "";
  if (!signature) return text("missing signature", 400);
  const rawBody = await req.text();

  let event: Stripe.Event | null = null;
  let stripe: Stripe | null = null;
  let environment: "test" | "live" | null = null;
  for (const c of configs) {
    const webhookSecret = c.webhookSecret;
    try {
      event = await c.stripe.webhooks.constructEventAsync(rawBody, signature, webhookSecret, undefined, stripeCryptoProvider);
      stripe = c.stripe;
      environment = c.environment;
      break;
    } catch {
      // try next configured environment
    }
  }
  if (!event || !stripe || !environment) return text("invalid signature", 400);

  const eventEnv = event.livemode ? "live" : "test";
  if (eventEnv !== environment) return text("environment mismatch", 400);
  if (!RELEVANT_EVENTS.has(event.type)) return text("ignored", 200);

  // deno-lint-ignore no-explicit-any
  const obj = event.data.object as any;
  let subscriptionRef: string | null = null;
  let sessionWorkspace: string | null = null;
  if (event.type === "checkout.session.completed") {
    // Shared-account filter first; non-Cartel sessions are never touched.
    if (!isCartelMetadata(obj?.metadata) || obj?.mode !== "subscription") return text("ignored", 200);
    subscriptionRef = refOf(obj.subscription);
    sessionWorkspace = typeof obj.metadata?.workspace_id === "string" ? obj.metadata.workspace_id : null;
  } else if (event.type.startsWith("customer.subscription.")) {
    subscriptionRef = refOf(obj?.id);
  } else {
    subscriptionRef = refOf(obj?.subscription) ?? refOf(obj?.parent?.subscription_details?.subscription);
  }
  if (!subscriptionRef) return text("ignored", 200);

  // Stripe's current subscription state is authoritative.
  let sub: Stripe.Subscription;
  try {
    sub = await stripe.subscriptions.retrieve(subscriptionRef);
  } catch {
    return text("subscription lookup failed", 502);
  }
  const md = (sub.metadata ?? {}) as Record<string, string>;
  if (!isCartelMetadata(md)) return text("ignored", 200); // unrelated shared-account subscription: no DB mutation

  const SUPABASE_URL = Deno.env.get("SUPABASE_URL") ?? "";
  const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
  const admin = createClient(SUPABASE_URL, SERVICE_KEY, { auth: { persistSession: false, autoRefreshToken: false } });

  const workspaceId = md.workspace_id ?? "";
  const billingOwner = md.billing_owner_user_id ?? "";

  // Idempotency claim.
  const nowIso = new Date().toISOString();
  const baseRow = {
    provider: "stripe",
    environment,
    event_ref: event.id,
    event_type: event.type,
    livemode: event.livemode,
    object_ref: refOf(obj?.id),
    workspace_id: UUID_RE.test(workspaceId) ? workspaceId : null,
    subscription_ref: subscriptionRef,
  };
  const { error: claimErr } = await admin.from("commercial_billing_events").insert({ ...baseRow, processing_status: "processing" });
  if (claimErr) {
    const { data: existing } = await admin
      .from("commercial_billing_events")
      .select("id,processing_status,attempt_count,updated_at")
      .eq("provider", "stripe").eq("environment", environment).eq("event_ref", event.id)
      .maybeSingle();
    if (!existing) return text("event claim failed", 500);
    if (existing.processing_status === "processed" || existing.processing_status === "ignored") return text("duplicate", 200);
    const stale = Date.now() - new Date(existing.updated_at).getTime() > STALE_PROCESSING_MS;
    if (existing.processing_status === "processing" && !stale) return text("in progress", 409);
    const { data: reclaimed } = await admin
      .from("commercial_billing_events")
      .update({ processing_status: "processing", attempt_count: (existing.attempt_count ?? 1) + 1, last_error: null })
      .eq("id", existing.id).eq("updated_at", existing.updated_at)
      .select("id").maybeSingle();
    if (!reclaimed) return text("in progress", 409);
  }

  const finish = async (status: "processed" | "ignored" | "failed", lastError: string | null) => {
    await admin.from("commercial_billing_events")
      .update({ processing_status: status, last_error: lastError, processed_at: status === "failed" ? null : nowIso })
      .eq("provider", "stripe").eq("environment", environment).eq("event_ref", event.id);
  };

  // Exact metadata + price verification.
  const items = sub.items?.data ?? [];
  const priceRef = items.length === 1 ? refOf(items[0]?.price) : null;
  const customerRef = refOf(sub.customer);
  if (
    md.app !== CARTEL_APP || !UUID_RE.test(workspaceId) || !UUID_RE.test(billingOwner) ||
    md.plan_code !== PRO_PLAN_CODE || md.plan_version !== String(PRO_PLAN_VERSION) ||
    !priceRef || !customerRef ||
    (sessionWorkspace !== null && sessionWorkspace !== workspaceId)
  ) {
    await finish("ignored", "METADATA_OR_PRICE_MISMATCH");
    return text("ignored", 200);
  }

  const { data: plan } = await admin.from("commercial_plans").select("id").eq("code", PRO_PLAN_CODE).eq("version", PRO_PLAN_VERSION).maybeSingle();
  const { data: mapped } = plan
    ? await admin.from("commercial_plan_provider_refs").select("id")
        .eq("plan_id", plan.id).eq("provider", "stripe").eq("environment", environment).eq("price_ref", priceRef).eq("active", true)
        .maybeSingle()
    : { data: null };
  if (!mapped) {
    await finish("ignored", "PRICE_NOT_MAPPED");
    return text("ignored", 200);
  }

  // deno-lint-ignore no-explicit-any
  const s = sub as any;
  const periodEnd = s.current_period_end ?? items[0]?.current_period_end;
  // Scheduled cancellation: flag or a cancel_at scheduled exactly at period end.
  const cancelAtPeriodEnd = sub.cancel_at_period_end === true ||
    (typeof s.cancel_at === "number" && typeof periodEnd === "number" && s.cancel_at === periodEnd && PRO_STATUSES.includes(sub.status as typeof PRO_STATUSES[number]));
  const { error: applyErr } = await admin.rpc("apply_stripe_subscription_state", {
    _environment: environment,
    _workspace_id: workspaceId,
    _billing_owner_user_id: billingOwner,
    _customer_ref: customerRef,
    _subscription_ref: sub.id,
    _price_ref: priceRef,
    _stripe_status: sub.status,
    _cancel_at_period_end: cancelAtPeriodEnd,
    _current_period_start: tsOrNull(s.current_period_start ?? items[0]?.current_period_start),
    _current_period_end: tsOrNull(s.current_period_end ?? items[0]?.current_period_end),
    _payment_failed_at: PAYMENT_FAILURE_EVENTS.has(event.type) ? tsOrNull(event.created) : null,
    _plan_code: PRO_PLAN_CODE,
    _plan_version: PRO_PLAN_VERSION,
  });
  if (applyErr) {
    await finish("failed", String(applyErr.message ?? "APPLY_FAILED").slice(0, 200));
    return text("processing failed", 500);
  }
  await finish("processed", null);
  return text("ok", 200);
});
