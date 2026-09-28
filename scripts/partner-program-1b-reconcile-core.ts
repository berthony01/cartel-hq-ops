/**
 * Partner Program G12a rollback-gap reconciliation core.
 * Pure and network-free: callers supply Stripe and database adapters.
 */
import {
  eligibleBaseCents,
  invoiceSubscriptionRef,
  isDisputeStatus,
  isRefundStatus,
  refOf,
  tsOrNull,
} from "../backend-source/edge-functions/stripe-billing-webhook/commission.ts";

export type Environment = "test" | "live";
export type AllowedEventType =
  | "invoice.paid"
  | "refund.created" | "refund.updated" | "refund.failed"
  | "charge.dispute.created" | "charge.dispute.updated" | "charge.dispute.closed";
export type IntendedRpc = "partner_ingest_invoice_paid" | "partner_ingest_refund_state" | "partner_ingest_dispute_state";
export type ReconcileStatus = "dry_run" | "executed" | "already_reconciled" | "rejected";

export type StripeObject = Record<string, any>;
export interface StripeAdapter {
  retrieveEvent(id: string): Promise<StripeObject>;
  retrieveInvoice(id: string): Promise<StripeObject>;
  retrieveSubscription(id: string): Promise<StripeObject>;
  retrieveRefund(id: string): Promise<StripeObject>;
  retrieveDispute(id: string): Promise<StripeObject>;
  retrieveCharge(id: string): Promise<StripeObject>;
  retrievePaymentIntent(id: string): Promise<StripeObject>;
}

export interface ReconciliationStore {
  getBillingEventStatus(environment: Environment, eventRef: string): Promise<string | null>;
  hasPartnerEvent(environment: Environment, eventRef: string): Promise<boolean>;
  hasInvoiceState(environment: Environment, invoiceRef: string): Promise<boolean>;
  hasRefundState(environment: Environment, refundRef: string): Promise<boolean>;
  hasDisputeState(environment: Environment, disputeRef: string): Promise<boolean>;
  hasActivePriceMapping(environment: Environment, priceRef: string, planCode: "cartel_49", planVersion: 1): Promise<boolean>;
  invokeIngestion(rpc: IntendedRpc, args: Record<string, unknown>): Promise<void>;
}

export interface ReconcileRequest {
  environment: Environment;
  eventId: string;
  execute: boolean;
}

export interface ReconcileResult {
  environment: Environment;
  event_id: string;
  event_type: string | null;
  status: ReconcileStatus;
  reason_code: string;
  intended_rpc: IntendedRpc | null;
}

export interface CliOptions {
  environment: Environment;
  eventIds: string[];
  execute: boolean;
  allowLive: boolean;
  confirm: string | null;
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const EVENT_RE = /^evt_[A-Za-z0-9]{1,250}$/;
export const ALLOWED_EVENT_TYPES = new Set<AllowedEventType>([
  "invoice.paid", "refund.created", "refund.updated", "refund.failed",
  "charge.dispute.created", "charge.dispute.updated", "charge.dispute.closed",
]);

function result(req: ReconcileRequest, eventType: string | null, status: ReconcileStatus, reason: string, rpc: IntendedRpc | null = null): ReconcileResult {
  return { environment: req.environment, event_id: req.eventId, event_type: eventType, status, reason_code: reason, intended_rpc: rpc };
}

export function stripeEnvironmentForKey(key: string): Environment | null {
  if (key.startsWith("sk_test_") || key.startsWith("rk_test_")) return "test";
  if (key.startsWith("sk_live_") || key.startsWith("rk_live_")) return "live";
  return null;
}

/** Dedicated key first; wrong-mode dedicated key permits a matching legacy fallback. */
export function selectStripeKey(environment: Environment, env: Record<string, string | undefined>): string | null {
  const dedicated = env[environment === "test" ? "STRIPE_TEST_SECRET_KEY" : "STRIPE_LIVE_SECRET_KEY"] ?? "";
  const legacy = env["STRIPE_SECRET_KEY"] ?? "";
  if (stripeEnvironmentForKey(dedicated) === environment) return dedicated;
  if (stripeEnvironmentForKey(legacy) === environment) return legacy;
  return null;
}

export function parseCliArgs(argv: string[]): CliOptions {
  let environment: Environment | null = null;
  const eventIds: string[] = [];
  let execute = false, allowLive = false, confirm: string | null = null;
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === "--environment") {
      const value = argv[++i];
      if (value !== "test" && value !== "live") throw new Error("INVALID_ENVIRONMENT");
      environment = value;
    } else if (arg === "--event") {
      const value = argv[++i];
      if (!value || !EVENT_RE.test(value)) throw new Error("INVALID_EVENT_ID");
      eventIds.push(value);
    } else if (arg === "--execute") execute = true;
    else if (arg === "--allow-live") allowLive = true;
    else if (arg === "--confirm") confirm = argv[++i] ?? null;
    else throw new Error("UNKNOWN_ARGUMENT");
  }
  if (!environment) throw new Error("ENVIRONMENT_REQUIRED");
  if (eventIds.length === 0) throw new Error("EVENT_REQUIRED");
  if (eventIds.length > 100) throw new Error("TOO_MANY_EVENTS");
  if (new Set(eventIds).size !== eventIds.length) throw new Error("DUPLICATE_EVENT_ID");
  const phrase = `EXECUTE PARTNER RECONCILIATION ${environment.toUpperCase()}`;
  if (execute && confirm !== phrase) throw new Error("CONFIRMATION_REQUIRED");
  if (execute && environment === "live" && !allowLive) throw new Error("ALLOW_LIVE_REQUIRED");
  return { environment, eventIds, execute, allowLive, confirm };
}

function sameScalar(a: unknown, b: unknown): boolean {
  return typeof a === typeof b && a === b;
}

async function validateSubscription(
  req: ReconcileRequest,
  eventType: string,
  sub: StripeObject,
  db: ReconciliationStore,
): Promise<{ ok: true; priceRef: string; workspaceId: string } | { ok: false; value: ReconcileResult }> {
  const md = sub.metadata;
  const items = Array.isArray(sub.items?.data) ? sub.items.data : [];
  const priceRef = items.length === 1 ? refOf(items[0]?.price) : null;
  const workspaceId = typeof md?.workspace_id === "string" ? md.workspace_id : "";
  const ownerId = typeof md?.billing_owner_user_id === "string" ? md.billing_owner_user_id : "";
  if (md?.app !== "cartel_hq" || !UUID_RE.test(workspaceId) || !UUID_RE.test(ownerId) ||
      md?.plan_code !== "cartel_49" || md?.plan_version !== "1" || !priceRef) {
    return { ok: false, value: result(req, eventType, "rejected", "CARTEL_SUBSCRIPTION_INVALID") };
  }
  if (!await db.hasActivePriceMapping(req.environment, priceRef, "cartel_49", 1)) {
    return { ok: false, value: result(req, eventType, "rejected", "PRICE_NOT_MAPPED") };
  }
  return { ok: true, priceRef, workspaceId };
}

async function gateRollbackGap(
  req: ReconcileRequest,
  eventType: string,
  rpc: IntendedRpc,
  stateExists: boolean,
  db: ReconciliationStore,
): Promise<ReconcileResult | null> {
  const billingStatus = await db.getBillingEventStatus(req.environment, req.eventId);
  if (billingStatus !== "processed" && billingStatus !== "ignored") {
    return result(req, eventType, "rejected", "NOT_ROLLBACK_GAP", rpc);
  }
  if (await db.hasPartnerEvent(req.environment, req.eventId) || stateExists) {
    return result(req, eventType, "already_reconciled", "ALREADY_RECONCILED", rpc);
  }
  return null;
}

async function finish(req: ReconcileRequest, eventType: string, rpc: IntendedRpc, args: Record<string, unknown>, db: ReconciliationStore): Promise<ReconcileResult> {
  if (!req.execute) return result(req, eventType, "dry_run", "READY", rpc);
  await db.invokeIngestion(rpc, args);
  return result(req, eventType, "executed", "EXECUTED", rpc);
}

export async function reconcileEvent(req: ReconcileRequest, stripe: StripeAdapter, db: ReconciliationStore): Promise<ReconcileResult> {
  let event: StripeObject;
  try { event = await stripe.retrieveEvent(req.eventId); }
  catch { return result(req, null, "rejected", "EVENT_RETRIEVAL_FAILED"); }
  const eventType = typeof event.type === "string" ? event.type : null;
  if (!eventType || !ALLOWED_EVENT_TYPES.has(eventType as AllowedEventType)) return result(req, eventType, "rejected", "EVENT_TYPE_NOT_ALLOWED");
  if (event.id !== req.eventId || event.livemode !== (req.environment === "live")) return result(req, eventType, "rejected", "ENVIRONMENT_MISMATCH");
  const obj = event.data?.object;
  const objectRef = refOf(obj?.id);
  if (!objectRef) return result(req, eventType, "rejected", "EVENT_OBJECT_INVALID");

  try {
    if (eventType === "invoice.paid") {
      const inv = await stripe.retrieveInvoice(objectRef);
      const eventSubRef = invoiceSubscriptionRef(obj);
      const subRef = invoiceSubscriptionRef(inv);
      const eventPaidAt = obj?.status_transitions?.paid_at;
      const paidAt = inv?.status_transitions?.paid_at;
      if (inv.id !== objectRef || inv.status !== "paid" || inv.livemode !== event.livemode || !subRef ||
          eventSubRef !== subRef || !sameScalar(obj?.currency, inv.currency) || !sameScalar(eventPaidAt, paidAt) || !tsOrNull(paidAt)) {
        return result(req, eventType, "rejected", "INVOICE_INVALID");
      }
      const sub = await stripe.retrieveSubscription(subRef);
      if (sub.id !== subRef || sub.livemode !== event.livemode) return result(req, eventType, "rejected", "SUBSCRIPTION_INVALID");
      const valid = await validateSubscription(req, eventType, sub, db);
      if (!valid.ok) return valid.value;
      const rpc: IntendedRpc = "partner_ingest_invoice_paid";
      const gated = await gateRollbackGap(req, eventType, rpc, await db.hasInvoiceState(req.environment, inv.id), db);
      if (gated) return gated;
      const eligible = eligibleBaseCents(inv, valid.priceRef);
      if (eligible.base <= 0 || typeof inv.currency !== "string") return result(req, eventType, "rejected", "INVOICE_NO_ELIGIBLE_BASE", rpc);
      return finish(req, eventType, rpc, {
        _environment: req.environment, _event_ref: req.eventId, _event_created: tsOrNull(event.created),
        _invoice_ref: inv.id, _charge_ref: refOf(inv.charge), _subscription_ref: sub.id,
        _price_ref: valid.priceRef, _workspace_id: valid.workspaceId, _currency: inv.currency.toLowerCase(),
        _amount_paid_cents: eligible.amountPaid, _eligible_base_cents: eligible.base, _paid_at: tsOrNull(paidAt),
      }, db);
    }

    const isRefund = eventType.startsWith("refund.");
    const current = isRefund ? await stripe.retrieveRefund(objectRef) : await stripe.retrieveDispute(objectRef);
    const statusValid = isRefund ? isRefundStatus(current.status) : isDisputeStatus(current.status);
    if (current.id !== objectRef || current.livemode !== event.livemode || !statusValid || !(current.amount > 0) ||
        !sameScalar(obj?.status, current.status) || !sameScalar(obj?.currency, current.currency) || !sameScalar(obj?.amount, current.amount)) {
      return result(req, eventType, "rejected", "MONEY_OBJECT_INVALID");
    }
    let chargeRef = refOf(current.charge);
    if (!chargeRef) {
      const paymentIntentRef = refOf(current.payment_intent);
      if (paymentIntentRef) chargeRef = refOf((await stripe.retrievePaymentIntent(paymentIntentRef)).latest_charge);
    }
    if (!chargeRef) return result(req, eventType, "rejected", "CHARGE_NOT_FOUND");
    const charge = await stripe.retrieveCharge(chargeRef);
    const invoiceRef = refOf(charge.invoice);
    if (charge.id !== chargeRef || charge.livemode !== event.livemode || !invoiceRef) return result(req, eventType, "rejected", "CHARGE_INVALID");
    const inv = await stripe.retrieveInvoice(invoiceRef);
    const subRef = invoiceSubscriptionRef(inv);
    if (inv.id !== invoiceRef || inv.livemode !== event.livemode || !subRef || String(inv.currency ?? "").toLowerCase() !== String(current.currency).toLowerCase()) {
      return result(req, eventType, "rejected", "INVOICE_INVALID");
    }
    const sub = await stripe.retrieveSubscription(subRef);
    if (sub.id !== subRef || sub.livemode !== event.livemode) return result(req, eventType, "rejected", "SUBSCRIPTION_INVALID");
    const valid = await validateSubscription(req, eventType, sub, db);
    if (!valid.ok) return valid.value;
    const rpc: IntendedRpc = isRefund ? "partner_ingest_refund_state" : "partner_ingest_dispute_state";
    const stateExists = isRefund
      ? await db.hasRefundState(req.environment, objectRef)
      : await db.hasDisputeState(req.environment, objectRef);
    const gated = await gateRollbackGap(req, eventType, rpc, stateExists, db);
    if (gated) return gated;
    const args: Record<string, unknown> = {
      _environment: req.environment, _event_ref: req.eventId, _event_created: tsOrNull(event.created),
      _invoice_ref: inv.id, _charge_ref: chargeRef, _amount_cents: current.amount,
      _status: current.status,
      [isRefund ? "_refund_ref" : "_dispute_ref"]: objectRef,
    };
    return finish(req, eventType, rpc, args, db);
  } catch {
    return result(req, eventType, "rejected", "AUTHORITATIVE_LOOKUP_FAILED");
  }
}

export async function reconcileBatch(options: CliOptions, stripe: StripeAdapter, db: ReconciliationStore): Promise<ReconcileResult[]> {
  const results: ReconcileResult[] = [];
  for (const eventId of options.eventIds) {
    const current = await reconcileEvent({ environment: options.environment, eventId, execute: options.execute }, stripe, db);
    results.push(current);
    if (options.execute && current.status === "rejected") break;
  }
  return results;
}