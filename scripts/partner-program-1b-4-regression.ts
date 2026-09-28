/**
 * PARTNER PROGRAM PHASE 1B-4 — webhook commission routing + partner/owner UI.
 * Zero network, zero database, zero Stripe. Pure logic + static source checks.
 */
import { readFileSync, readdirSync } from "node:fs";
import {
  eligibleBaseCents, invoiceSubscriptionRef, isDisputeStatus, isMissingContract, isRefundStatus, routeEvent,
} from "../backend-source/edge-functions/stripe-billing-webhook/commission.ts";

let passed = 0, failed = 0;
const check = (id: string, ok: boolean, d = "") => { if (ok) passed++; else { failed++; console.error(`FAIL ${id}${d ? ` — ${d}` : ""}`); } };
const read = (p: string) => readFileSync(p, "utf8");
const WH = read("backend-source/edge-functions/stripe-billing-webhook/index.ts").replace(/^\s*(\*|\/\*\*|\/\/).*$/gm, "");
const CM = read("backend-source/edge-functions/stripe-billing-webhook/commission.ts");
const SQL = read("docs/sql/PARTNER_1B_3_commission_accounting.sql").replace(/\s+/g, " ");
const LIB = read("src/lib/partners.ts");
const PAGE = read("src/routes/_authenticated/partners.tsx");
const ADMIN = read("src/components/cartel/PartnerAdminSection.tsx");

/* 1. Routing */
check("R-1 invoice.paid -> commission", routeEvent("invoice.paid") === "invoice_paid");
check("R-2 checkout never commission", routeEvent("checkout.session.completed") === "subscription");
for (const e of ["refund.created", "refund.updated", "refund.failed"]) check(`R-3 ${e}`, routeEvent(e) === "refund");
for (const e of ["charge.dispute.created", "charge.dispute.updated", "charge.dispute.closed"]) check(`R-4 ${e}`, routeEvent(e) === "dispute");
for (const e of ["customer.subscription.updated", "invoice.payment_failed"]) check(`R-5 ${e} subscription`, routeEvent(e) === "subscription");
check("R-6 unrelated ignored", routeEvent("payment_intent.succeeded") === "ignore" && routeEvent("charge.refunded") === "ignore");
for (const e of ["refund.created", "refund.updated", "refund.failed", "charge.dispute.created", "charge.dispute.updated", "charge.dispute.closed"]) check(`R-7 relevant ${e}`, WH.includes(`"${e}",`));

/* 2. Signature / env / shared account ordering */
const iSig = WH.indexOf("constructEventAsync(rawBody, signature");
check("W-1 signature before any Stripe retrieval", iSig > 0 && ["refunds.retrieve", "disputes.retrieve", "charges.retrieve", "invoices.retrieve", "subscriptions.retrieve", "createClient("].every((k) => WH.indexOf(k) > iSig));
check("W-2 livemode/env immediate 400", WH.includes('if (eventEnvironment !== cfg.environment) return text("environment mismatch", 400);'));
const iFilter = WH.indexOf('if (!isCartelMetadata(md)) return text("ignored", 200);');
check("W-3 Cartel filter before any DB write", iFilter > 0 && iFilter < WH.indexOf('.from("commercial_billing_events").insert') && iFilter < WH.indexOf("partner_ingest_"));
check("W-4 non-invoice charge ignored", WH.includes('if (!invoiceRef) return text("ignored", 200);'));
check("W-5 refund/dispute via current Stripe objects", /stripe\.refunds\.retrieve\(objRef\)/.test(WH) && /stripe\.disputes\.retrieve\(objRef\)/.test(WH) && /stripe\.charges\.retrieve\(chargeRef\)/.test(WH) && /stripe\.invoices\.retrieve\(invoiceRef\)/.test(WH));
check("W-6 price mapping precedes accounting", WH.indexOf("PRICE_NOT_MAPPED") < WH.indexOf("partner_ingest_refund_state") && WH.indexOf("PRICE_NOT_MAPPED") < WH.indexOf("partner_ingest_invoice_paid"));
check("W-7 invoice commission after entitlement apply", WH.indexOf('admin.rpc("apply_stripe_subscription_state"') < WH.indexOf('admin.rpc("partner_ingest_invoice_paid"'));
check("W-8 commission only on invoice_paid route", /if \(route === "invoice_paid"\) \{/.test(WH) && (WH.match(/partner_ingest_invoice_paid/g) ?? []).length === 1);
check("W-9 refund/dispute never touch entitlement", WH.indexOf("if (money) {") < WH.indexOf('admin.rpc("apply_stripe_subscription_state"'));
check("W-10 accounting failure -> 500 retry", (WH.match(/finish\("failed", "COMMISSION_FAILED"\);\s*return text\("processing failed", 500\);/g) ?? []).length === 2);
check("W-11 unapplied contract never blocks billing", (WH.match(/COMMISSION_CONTRACT_UNAVAILABLE/g) ?? []).length === 2);
check("W-12 idempotency claim/reclaim preserved", WH.includes('return text("duplicate", 200)') && WH.includes('return text("in progress", 409)') && WH.includes("STALE_PROCESSING_MS"));
check("W-13 invoice must be paid, same subscription, same mode", WH.includes('inv.status !== "paid"') && WH.includes("invoiceSubscriptionRef(inv) !== sub.id") && WH.includes("inv.livemode !== event.livemode"));
check("W-14 refund/dispute currency + status validation", WH.includes("COMMISSION_OBJECT_MISMATCH") && WH.includes("isRefundStatus(money.status)") && WH.includes("isDisputeStatus(money.status)"));
check("W-15 no raw payload stored / no secret logging", !/payload:|console\.(log|error)/.test(WH + CM));
check("W-16 no hardcoded Stripe ids", !/(price|prod|cus|sub|in|ch)_[A-Za-z0-9]{8,}/.test(WH.replace(/price_ref|price_details|sub\.id|subscription_ref/g, "")));

/* 3. RPC signature alignment with staged SQL */
const argNames = (fn: string) => { const m = SQL.match(new RegExp(`FUNCTION public\\.${fn}\\(([^)]*)\\)`)); return (m?.[1] ?? "").split(",").map((s) => s.trim().split(" ")[0]).filter(Boolean).sort(); };
const whArgs = (block: RegExp) => { const m = WH.match(block); return m ? [...m[0].matchAll(/(_[a-z_]+):/g)].map((x) => x[1]!).sort() : []; };
const inv = whArgs(/partner_ingest_invoice_paid", \{[\s\S]*?\}\);/);
check("A-1 invoice RPC args match SQL", JSON.stringify(inv) === JSON.stringify(argNames("partner_ingest_invoice_paid")), inv.join(","));
const common = whArgs(/const args = \{[\s\S]*?\};/);
check("A-2 refund RPC args match SQL", JSON.stringify([...common, "_refund_ref"].sort()) === JSON.stringify(argNames("partner_ingest_refund_state")));
check("A-3 dispute RPC args match SQL", JSON.stringify([...common, "_dispute_ref"].sort()) === JSON.stringify(argNames("partner_ingest_dispute_state")));
check("A-4 draft 9-arg matches staged SQL", LIB.includes("_commission_duration_invoices: t.commissionDurationInvoices") && SQL.includes("_commission_duration_invoices integer)"));

/* 4. Eligible base */
const P = "price_cartel";
const line = (o: Record<string, unknown>) => ({ type: "subscription", price: { id: P }, currency: "usd", amount: 4900, ...o });
const invoice = (lines: unknown[], o: Record<string, unknown> = {}) => ({ currency: "usd", amount_paid: 4900, tax: 0, lines: { data: lines, has_more: false }, ...o });
check("E-1 simple $49", eligibleBaseCents(invoice([line({})]), P).base === 4900);
check("E-2 discount subtracted", eligibleBaseCents(invoice([line({ discount_amounts: [{ amount: 900 }] })], { amount_paid: 4000 }), P).base === 4000);
check("E-3 exclusive tax excluded", eligibleBaseCents(invoice([line({ tax_amounts: [{ amount: 400, inclusive: false }] })], { amount_paid: 5300, tax: 400 }), P).base === 4900);
check("E-4 inclusive tax excluded", eligibleBaseCents(invoice([line({ tax_amounts: [{ amount: 400, inclusive: true }] })], { amount_paid: 4900, tax: 400 }), P).base === 4500);
check("E-5 credit caps base to paid", eligibleBaseCents(invoice([line({})], { amount_paid: 1000 }), P).base === 1000);
check("E-6 fully credited -> 0", eligibleBaseCents(invoice([line({})], { amount_paid: 0 }), P).base === 0);
check("E-7 proration excluded", eligibleBaseCents(invoice([line({ proration: true })]), P).base === 0);
check("E-8 new-API proration excluded", eligibleBaseCents(invoice([{ parent: { type: "subscription_item_details", subscription_item_details: { proration: true } }, pricing: { price_details: { price: P } }, amount: 4900, currency: "usd" }]), P).base === 0);
check("E-9 new-API mapped line counted", eligibleBaseCents(invoice([{ parent: { type: "subscription_item_details" }, pricing: { price_details: { price: P } }, amount: 4900, currency: "usd" }]), P).base === 4900);
check("E-10 setup/one-time line excluded", eligibleBaseCents(invoice([line({}), { type: "invoiceitem", price: { id: "price_setup" }, amount: 20000, currency: "usd" }], { amount_paid: 24900 }), P).base === 4900);
check("E-11 non-Cartel price excluded", eligibleBaseCents(invoice([line({ price: { id: "price_other" } })]), P).base === 0);
check("E-12 truncated lines fail closed", eligibleBaseCents(invoice([line({})], { lines: { data: [line({})], has_more: true } }), P).base === 0);
check("E-13 currency mismatch line excluded", eligibleBaseCents(invoice([line({ currency: "eur" })]), P).base === 0);
check("E-14 never negative / never > paid ex tax", (() => { for (let i = 0; i < 500; i++) { const amt = (i * 37) % 9000; const paid = (i * 53) % 7000; const tax = (i * 11) % 800; const disc = (i * 7) % 6000; const r = eligibleBaseCents(invoice([line({ amount: amt, discount_amounts: [{ amount: disc }] })], { amount_paid: paid, tax }), P); if (r.base < 0 || r.base > Math.max(0, paid - tax) || !Number.isInteger(r.base)) return false; } return true; })());
check("E-15 subscription ref resolver", invoiceSubscriptionRef({ subscription: "sub_a" }) === "sub_a" && invoiceSubscriptionRef({ parent: { subscription_details: { subscription: "sub_b" } } }) === "sub_b" && invoiceSubscriptionRef({}) === null);
check("E-16 status sets match SQL", isRefundStatus("succeeded") && !isRefundStatus("bogus") && isDisputeStatus("won") && isDisputeStatus("lost") && !isDisputeStatus("charge_refunded"));
check("E-17 missing contract detection", isMissingContract({ code: "PGRST202" }) && isMissingContract({ code: "42883" }) && !isMissingContract({ code: "23505" }) && !isMissingContract(null));

/* 5. UI */
check("U-1 draft economics only when no active terms", PAGE.includes("<DraftEconomicsPanel />") && /!programOpen \? \(\s*<>\s*<DraftEconomicsPanel \/>/.test(PAGE));
for (const s of ['"20%"', "First 12 paid monthly invoices", '"30 days"', '"45 days"', '"$50"', '"USD (US dollars)"', "Monthly, manual"]) check(`U-2 draft value ${s}`, LIB.includes(s));
check("U-3 active version shown", PAGE.includes("Active terms · v${terms.version}") && PAGE.includes("First ${duration} paid invoices"));
for (const s of ["Held (in hold period)", "Available", "Paid", "Reversed", "Restored", "Net payable"]) check(`U-4 balance ${s}`, PAGE.includes(`"${s}"`));
check("U-5 negative carry-forward explained", /carried forward/.test(PAGE));
check("U-6 service-only no commission", PAGE.includes('title="No Cartel commission"') && PAGE.includes("{!isAffiliate ? ("));
check("U-7 referral link stays code-based, staged note", PAGE.includes("ref=${partner.referral_code}") && /staged and not active/.test(PAGE) && !/referral_token|claim_referral_click/.test(PAGE));
check("U-8 ledger labels transparent, no PII fields", LIB.includes("LEDGER_ENTRY_LABELS") && !/workspace_id|stripe_invoice_ref|stripe_charge_ref|email/.test(PAGE));
check("U-9 no writes on page load", !/useEffect/.test(PAGE) && !/useEffect/.test(ADMIN));
check("U-10 owner draft duration field", ADMIN.includes('label="Paid invoices"') && ADMIN.includes('commissionDurationInvoices: intOrNaN(val("duration"))'));
check("U-11 typed confirm activation + mark paid", ADMIN.includes("phrase={activationPhrase(draft.version)}") && ADMIN.includes("phrase={markPaidPhrase(note(p.id))}") && !/onClick=\{\(\) => markPaid\.mutate/.test(ADMIN));
check("U-12 owner gate preserved", ADMIN.includes("if (loading || !isPlatformOwner) return null;"));
check("U-13 payout gates preserved", PAGE.includes('isAffiliate && approved && partner?.tax_doc_status === "verified" && accepted && programOpen'));
check("U-14 contract-missing fails closed", LIB.includes("throw new Error(COMMISSION_CONTRACT_UNAVAILABLE)"));

/* 6. Pure UI helpers (mirrors SQL breakdown) */
const lib = await import("../src/lib/partners.ts").catch(() => null);
if (lib) {
  const now = Date.parse("2026-09-28T00:00:00Z");
  const past = "2026-01-01T00:00:00Z", fut = "2026-12-01T00:00:00Z";
  const b = lib.ledgerBreakdown([
    { entry_type: "accrual", amount_cents: 980, available_at: past },
    { entry_type: "accrual", amount_cents: 980, available_at: fut },
    { entry_type: "payout", amount_cents: -980, available_at: past },
    { entry_type: "reversal", amount_cents: -980, available_at: fut },
  ], 0, now);
  check("H-1 held", b.held === 980);
  check("H-2 negative available after payout+reversal", b.available === -980 && b.carryForward === -980);
  check("H-3 paid/reversed", b.paid === 980 && b.reversed === 980 && b.net === 0);
  check("H-4 typed confirmation exact", lib.typedConfirmationMatches(" ACTIVATE TERMS V2 ", "ACTIVATE TERMS V2") && !lib.typedConfirmationMatches("activate terms v2", "ACTIVATE TERMS V2") && !lib.typedConfirmationMatches("", ""));
} else {
  // Supabase client needs browser env; mirror statically instead.
  check("H-0 breakdown mirrors SQL filters", LIB.includes("if (a > 0 && !matured) b.held += a;") && LIB.includes("if (matured || a < 0) b.available += a;") && LIB.includes("b.carryForward = Math.min(b.available, 0);"));
  check("H-4 typed confirmation exact", LIB.includes("return expected.length > 0 && input.trim() === expected;"));
}

/* 7. Scope / safety */
check("X-1 no staged SQL added to migrations", !readdirSync("supabase/migrations").some((f) => /partner_1b|commission_accounting|referral_click/i.test(f)));
check("X-2 checkout function untouched by commission", !/partner_ingest/.test(read("backend-source/edge-functions/billing-checkout/index.ts")));
check("X-3 owner bypass stays server-side", SQL.includes("public.has_platform_unrestricted_access(v_owner)") && !/berthonyxyz/i.test(WH + LIB + PAGE + ADMIN));
check("X-4 no PCART/chain refs", !/pcart|liquidity|treasury/i.test(WH + CM));
check("X-5 no secret literals", !/sk_(live|test)_[A-Za-z0-9]|whsec_[A-Za-z0-9]/.test(WH + CM + LIB));

console.log(`partner-program-1b-4-regression: ${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
