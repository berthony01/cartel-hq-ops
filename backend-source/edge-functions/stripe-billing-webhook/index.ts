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
import {
  eligibleBaseCents,
  invoiceSubscriptionRef,
  isDisputeStatus,
  isMissingContract,
  isRefundStatus,
  refOf,
  routeEvent,
  tsOrNull,
} from "./commission.ts";

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
 *
 * Stage 1B-4 (source only, NOT deployed): partner commission ingestion.
 *  - invoice.paid: entitlement apply first (unchanged), then eligible base from the
 *    Stripe-retrieved invoice -> partner_ingest_invoice_paid.
 *  - refund.* / charge.dispute.*: current refund/dispute retrieved, resolved through
 *    charge -> invoice -> subscription, Cartel-validated, then the state RPC.
 *  - checkout.session.completed NEVER creates a commission.
 *  - Accounting failures return 500 so Stripe retries; the entitlement re-apply on
 *    retry is idempotent state sync (never a double grant). An unapplied staged
 *    contract (function missing) is recorded and never blocks billing.
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
  "refund.created",
  "refund.updated",
  "refund.failed",
  "charge.dispute.created",
  "charge.dispute.updated",
  "charge.dispute.closed",
]);

const PAYMENT_FAILURE_EVENTS = new Set(["invoice.payment_failed", "invoice.payment_action_required"]);
const STALE_PROCESSING_MS = 5 * 60 * 1000;
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function text(body: string, status: number) {
  return new Response(body, { status, headers: { "Content-Type": "text/plain" } });
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
  for (const cfg of configs) {
    let verifiedEvent: Stripe.Event;
    try {
      verifiedEvent = await cfg.stripe.webhooks.constructEventAsync(rawBody, signature, cfg.webhookSecret, undefined, stripeCryptoProvider);
    } catch {
      continue; // try next configured environment
    }
    const eventEnvironment = verifiedEvent.livemode ? "live" : "test";
    if (eventEnvironment !== cfg.environment) return text("environment mismatch", 400);
    event = verifiedEvent;
    stripe = cfg.stripe;
    environment = cfg.environment;
    break;
  }
  if (!event || !stripe || !environment) return text("invalid signature", 400);
  if (!RELEVANT_EVENTS.has(event.type)) return text("ignored", 200);
  const route = routeEvent(event.type);
  if (route === "ignore") return text("ignored", 200);

  // deno-lint-ignore no-explicit-any
  const obj = event.data.object as any;
  let subscriptionRef: string | null = null;
  let sessionWorkspace: string | null = null;
  // Refund/dispute context, resolved from CURRENT Stripe objects (never event metadata alone).
  // deno-lint-ignore no-explicit-any
  let money: { kind: "refund" | "dispute"; ref: string; status: string; amount: number; currency: string; chargeRef: string; invoice: any } | null = null;

  if (event.type === "checkout.session.completed") {
    // Shared-account filter first; non-Cartel sessions are never touched.
    if (!isCartelMetadata(obj?.metadata) || obj?.mode !== "subscription") return text("ignored", 200);
    subscriptionRef = refOf(obj.subscription);
    sessionWorkspace = typeof obj.metadata?.workspace_id === "string" ? obj.metadata.workspace_id : null;
  } else if (event.type.startsWith("customer.subscription.")) {
    subscriptionRef = refOf(obj?.id);
  } else if (route === "refund" || route === "dispute") {
    const objRef = refOf(obj?.id);
    if (!objRef) return text("ignored", 200);
    try {
      // deno-lint-ignore no-explicit-any
      const current: any = route === "refund" ? await stripe.refunds.retrieve(objRef) : await stripe.disputes.retrieve(objRef);
      let chargeRef = refOf(current?.charge);
      if (!chargeRef && refOf(current?.payment_intent)) {
        // deno-lint-ignore no-explicit-any
        const pi: any = await stripe.paymentIntents.retrieve(refOf(current.payment_intent)!);
        chargeRef = refOf(pi?.latest_charge);
      }
      if (!chargeRef) return text("ignored", 200);
      // deno-lint-ignore no-explicit-any
      const charge: any = await stripe.charges.retrieve(chargeRef);
      const invoiceRef = refOf(charge?.invoice);
      if (!invoiceRef) return text("ignored", 200); // not an invoice charge: unrelated
      // deno-lint-ignore no-explicit-any
      const invoice: any = await stripe.invoices.retrieve(invoiceRef);
      subscriptionRef = invoiceSubscriptionRef(invoice);
      money = {
        kind: route,
        ref: objRef,
        status: String(current?.status ?? ""),
        amount: typeof current?.amount === "number" ? current.amount : 0,
        currency: String(current?.currency ?? "").toLowerCase(),
        chargeRef,
        invoice,
      };
    } catch {
      return text("object lookup failed", 502);
    }
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

  // Refund / dispute: accounting only (no entitlement change).
  if (money) {
    const inv = money.invoice;
    if (
      inv?.livemode !== event.livemode || invoiceSubscriptionRef(inv) !== sub.id ||
      String(inv?.currency ?? "").toLowerCase() !== money.currency || !(money.amount > 0) ||
      (money.kind === "refund" ? !isRefundStatus(money.status) : !isDisputeStatus(money.status))
    ) {
      await finish("ignored", "COMMISSION_OBJECT_MISMATCH");
      return text("ignored", 200);
    }
    const args = {
      _environment: environment,
      _event_ref: event.id,
      _event_created: tsOrNull(event.created),
      _invoice_ref: refOf(inv.id),
      _charge_ref: money.chargeRef,
      _amount_cents: money.amount,
      _status: money.status,
    };
    const { error: accErr } = money.kind === "refund"
      ? await admin.rpc("partner_ingest_refund_state", { ...args, _refund_ref: money.ref })
      : await admin.rpc("partner_ingest_dispute_state", { ...args, _dispute_ref: money.ref });
    if (accErr) {
      if (isMissingContract(accErr)) {
        await finish("processed", "COMMISSION_CONTRACT_UNAVAILABLE");
        return text("ok", 200);
      }
      await finish("failed", "COMMISSION_FAILED");
      return text("processing failed", 500);
    }
    await finish("processed", null);
    return text("ok", 200);
  }

  // deno-lint-ignore no-explicit-any
  const s = sub as any;
  const currentPeriodEnd = s.current_period_end ?? items[0]?.current_period_end;
  const cancelAt = typeof s.cancel_at === "number" ? s.cancel_at : null;
  const keepsPro = PRO_STATUSES.includes(sub.status as typeof PRO_STATUSES[number]);
  // Scheduled cancellation only while Pro is retained: flag, or cancel_at exactly at period end.
  const scheduledAtPeriodEnd = keepsPro &&
    (sub.cancel_at_period_end === true ||
      (cancelAt !== null && typeof currentPeriodEnd === "number" && cancelAt === currentPeriodEnd));
  const { error: applyErr } = await admin.rpc("apply_stripe_subscription_state", {
    _environment: environment,
    _workspace_id: workspaceId,
    _billing_owner_user_id: billingOwner,
    _customer_ref: customerRef,
    _subscription_ref: sub.id,
    _price_ref: priceRef,
    _stripe_status: sub.status,
    _cancel_at_period_end: scheduledAtPeriodEnd,
    _current_period_start: tsOrNull(s.current_period_start ?? items[0]?.current_period_start),
    _current_period_end: tsOrNull(currentPeriodEnd),
    _payment_failed_at: PAYMENT_FAILURE_EVENTS.has(event.type) ? tsOrNull(event.created) : null,
    _plan_code: PRO_PLAN_CODE,
    _plan_version: PRO_PLAN_VERSION,
  });
  if (applyErr) {
    await finish("failed", String(applyErr.message ?? "APPLY_FAILED").slice(0, 200));
    return text("processing failed", 500);
  }

  // Commission: invoice.paid ONLY (never checkout.session.completed), after entitlement apply.
  if (route === "invoice_paid") {
    const invoiceRef = refOf(obj?.id);
    // deno-lint-ignore no-explicit-any
    let inv: any = null;
    try {
      inv = invoiceRef ? await stripe.invoices.retrieve(invoiceRef) : null;
    } catch {
      await finish("failed", "INVOICE_LOOKUP_FAILED");
      return text("processing failed", 500);
    }
    const paidAt = tsOrNull(inv?.status_transitions?.paid_at);
    if (
      !inv || inv.status !== "paid" || inv.livemode !== event.livemode ||
      invoiceSubscriptionRef(inv) !== sub.id || !paidAt || typeof inv.currency !== "string"
    ) {
      await finish("processed", "COMMISSION_INVOICE_INELIGIBLE");
      return text("ok", 200);
    }
    const eligible = eligibleBaseCents(inv, priceRef);
    const { error: accErr } = await admin.rpc("partner_ingest_invoice_paid", {
      _environment: environment,
      _event_ref: event.id,
      _event_created: tsOrNull(event.created),
      _invoice_ref: inv.id,
      _charge_ref: refOf(inv.charge),
      _subscription_ref: sub.id,
      _price_ref: priceRef,
      _workspace_id: workspaceId,
      _currency: inv.currency.toLowerCase(),
      _amount_paid_cents: eligible.amountPaid,
      _eligible_base_cents: eligible.base,
      _paid_at: paidAt,
    });
    if (accErr) {
      if (isMissingContract(accErr)) {
        await finish("processed", "COMMISSION_CONTRACT_UNAVAILABLE");
        return text("ok", 200);
      }
      // Retry: entitlement re-apply on retry is idempotent state sync; the RPC is
      // event- and invoice-idempotent, so no double grant or double accrual.
      await finish("failed", "COMMISSION_FAILED");
      return text("processing failed", 500);
    }
  }

  await finish("processed", null);
  return text("ok", 200);
});
