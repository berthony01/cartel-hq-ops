/**
 * CARTEL HQ Partner Program Stage 1B-4 — pure webhook commission helpers.
 * No Stripe SDK, no network, no Deno APIs: deterministic and unit-testable.
 * The database (Stage 1B-3 RPCs) revalidates every eligibility rule and
 * computes commission itself; these helpers only route events and derive the
 * eligible subscription revenue base from a Stripe-retrieved invoice.
 *
 * Eligible base assumptions (documented, conservative):
 *  - Only invoice lines that are subscription lines for the exact mapped
 *    Cartel price ref (and the invoice currency) count.
 *  - Proration lines are excluded entirely (conservative: never pays
 *    commission on mid-cycle plan-change adjustments).
 *  - One-time, setup, service, invoice-item and non-Cartel lines are excluded.
 *  - Per-line discounts (discount_amounts, incl. allocated invoice discounts)
 *    and tax-inclusive tax amounts are subtracted; exclusive tax is never in
 *    line.amount.
 *  - Customer credit balance is reflected by capping at amount_paid minus
 *    total invoice tax. Result is an integer >= 0 and <= that cap.
 *  - If the invoice line list is truncated (has_more) the base is 0
 *    (fail closed; the database then records NO_ELIGIBLE_BASE).
 */

export type CommissionRoute = "subscription" | "invoice_paid" | "refund" | "dispute" | "ignore";

export const SUBSCRIPTION_EVENTS = [
  "checkout.session.completed",
  "customer.subscription.created",
  "customer.subscription.updated",
  "customer.subscription.deleted",
  "customer.subscription.paused",
  "customer.subscription.resumed",
  "invoice.payment_failed",
  "invoice.payment_action_required",
] as const;
export const REFUND_EVENTS = ["refund.created", "refund.updated", "refund.failed"] as const;
export const DISPUTE_EVENTS = ["charge.dispute.created", "charge.dispute.updated", "charge.dispute.closed"] as const;

/** checkout.session.completed is a subscription-state event only; it never accrues commission. */
export function routeEvent(type: string): CommissionRoute {
  if (type === "invoice.paid") return "invoice_paid";
  if ((SUBSCRIPTION_EVENTS as readonly string[]).includes(type)) return "subscription";
  if ((REFUND_EVENTS as readonly string[]).includes(type)) return "refund";
  if ((DISPUTE_EVENTS as readonly string[]).includes(type)) return "dispute";
  return "ignore";
}

export const REFUND_STATUSES = ["pending", "requires_action", "succeeded", "failed", "canceled"] as const;
export const DISPUTE_STATUSES = [
  "warning_needs_response", "warning_under_review", "warning_closed",
  "needs_response", "under_review", "won", "lost",
] as const;
export const isRefundStatus = (s: unknown): s is string => typeof s === "string" && (REFUND_STATUSES as readonly string[]).includes(s);
export const isDisputeStatus = (s: unknown): s is string => typeof s === "string" && (DISPUTE_STATUSES as readonly string[]).includes(s);

export function refOf(value: unknown): string | null {
  if (typeof value === "string" && value) return value;
  if (value && typeof value === "object" && typeof (value as { id?: unknown }).id === "string") return (value as { id: string }).id;
  return null;
}

const int = (v: unknown): number | null => (typeof v === "number" && Number.isInteger(v) ? v : null);
const sumAmounts = (arr: unknown, filter: (x: Record<string, unknown>) => boolean = () => true): number => {
  if (!Array.isArray(arr)) return 0;
  let t = 0;
  for (const x of arr) if (x && typeof x === "object" && filter(x as Record<string, unknown>)) t += int((x as { amount?: unknown }).amount) ?? 0;
  return t;
};

/** Invoice's subscription ref across Stripe API versions. */
export function invoiceSubscriptionRef(inv: Record<string, unknown> | null | undefined): string | null {
  if (!inv) return null;
  // deno-lint-ignore no-explicit-any
  const i = inv as any;
  return refOf(i.subscription) ?? refOf(i.parent?.subscription_details?.subscription) ?? null;
}

function linePriceRef(line: Record<string, unknown>): string | null {
  // deno-lint-ignore no-explicit-any
  const l = line as any;
  return refOf(l.price) ?? refOf(l.pricing?.price_details?.price) ?? null;
}

export type EligibleBase = { base: number; amountPaid: number; paidExTax: number; reason: string | null };

export function eligibleBaseCents(inv: Record<string, unknown>, mappedPriceRef: string): EligibleBase {
  // deno-lint-ignore no-explicit-any
  const i = inv as any;
  const amountPaid = Math.max(0, int(i.amount_paid) ?? 0);
  const tax = int(i.tax) ?? sumAmounts(i.total_tax_amounts);
  const paidExTax = Math.max(0, amountPaid - Math.max(0, tax));
  if (i.lines?.has_more === true) return { base: 0, amountPaid, paidExTax, reason: "LINES_TRUNCATED" };
  const lines: unknown[] = Array.isArray(i.lines?.data) ? i.lines.data : [];
  let sum = 0;
  for (const raw of lines) {
    if (!raw || typeof raw !== "object") continue;
    // deno-lint-ignore no-explicit-any
    const l = raw as any;
    const isSub = l.type === "subscription" || l.parent?.type === "subscription_item_details";
    const proration = l.proration === true || l.parent?.subscription_item_details?.proration === true;
    if (!isSub || proration) continue;
    if (linePriceRef(l) !== mappedPriceRef) continue;
    if (typeof l.currency === "string" && typeof i.currency === "string" && l.currency !== i.currency) continue;
    const amount = int(l.amount);
    if (amount === null) continue;
    const discounts = sumAmounts(l.discount_amounts);
    const inclusiveTax = sumAmounts(l.tax_amounts, (x) => x["inclusive"] === true);
    sum += Math.max(0, amount - discounts - inclusiveTax);
  }
  const base = Math.max(0, Math.min(sum, paidExTax));
  return { base, amountPaid, paidExTax, reason: base > 0 ? null : "NO_ELIGIBLE_LINES" };
}

/** Supabase/PostgREST "function does not exist" — staged contract not applied yet. */
export function isMissingContract(err: { code?: unknown; message?: unknown } | null | undefined): boolean {
  if (!err) return false;
  return err.code === "PGRST202" || err.code === "42883" || /Could not find the function/i.test(String(err.message ?? ""));
}

export const tsOrNull = (value: unknown): string | null =>
  typeof value === "number" && Number.isFinite(value) ? new Date(value * 1000).toISOString() : null;
