/** G12a regression: pure mocks only. Zero Stripe/Supabase/network calls. */
import { readFileSync } from "node:fs";
import {
  parseCliArgs, reconcileBatch, reconcileEvent, selectStripeKey,
  type ReconciliationStore, type StripeAdapter,
} from "./partner-program-1b-reconcile-core.ts";

let passed = 0, failed = 0;
const check = (id: string, ok: boolean) => { if (ok) passed++; else { failed++; console.error(`FAIL ${id}`); } };
const throws = (fn: () => unknown, code: string) => { try { fn(); return false; } catch (e) { return e instanceof Error && e.message === code; } };
const WS = "11111111-1111-4111-8111-111111111111", OWNER = "22222222-2222-4222-8222-222222222222";
const eventObj = { id: "in_1", status: "paid", livemode: false, currency: "usd", subscription: "sub_1", amount_paid: 4900, tax: 0, charge: "ch_1", status_transitions: { paid_at: 1000 }, lines: { data: [{ type: "subscription", price: { id: "price_1" }, currency: "usd", amount: 4900 }], has_more: false } };
const subscription = { id: "sub_1", livemode: false, metadata: { app: "cartel_hq", workspace_id: WS, billing_owner_user_id: OWNER, plan_code: "cartel_49", plan_version: "1" }, items: { data: [{ price: { id: "price_1" } }] } };
const baseEvent = { id: "evt_1", type: "invoice.paid", livemode: false, created: 1001, data: { object: eventObj } };

function fixtures(overrides: Record<string, any> = {}) {
  let rpcCalls = 0;
  const stripe: StripeAdapter = {
    retrieveEvent: async () => overrides.event ?? baseEvent,
    retrieveInvoice: async () => overrides.invoice ?? eventObj,
    retrieveSubscription: async () => overrides.subscription ?? subscription,
    retrieveRefund: async () => overrides.refund,
    retrieveDispute: async () => overrides.dispute,
    retrieveCharge: async () => overrides.charge,
    retrievePaymentIntent: async () => overrides.paymentIntent,
  };
  const seen = new Set<string>();
  const db: ReconciliationStore = {
    getBillingEventStatus: async () => Object.prototype.hasOwnProperty.call(overrides, "billingStatus") ? overrides.billingStatus : "processed",
    hasPartnerEvent: async () => overrides.partnerEvent ?? false,
    hasInvoiceState: async () => overrides.invoiceState ?? false,
    hasRefundState: async () => overrides.refundState ?? false,
    hasDisputeState: async () => overrides.disputeState ?? false,
    hasActivePriceMapping: async () => overrides.mapped ?? true,
    invokeIngestion: async (_rpc, args) => { rpcCalls++; seen.add(String(args._event_ref)); },
  };
  return { stripe, db, calls: () => rpcCalls, unique: () => seen.size };
}

const dryArgs = parseCliArgs(["--environment", "test", "--event", "evt_1"]);
check("G-1 dry-run default", !dryArgs.execute);
const dry = fixtures();
const dryResult = await reconcileBatch(dryArgs, dry.stripe, dry.db);
check("G-2 dry-run zero RPC", dryResult[0]?.status === "dry_run" && dry.calls() === 0);
check("G-3 exact test confirmation", throws(() => parseCliArgs(["--environment", "test", "--event", "evt_1", "--execute", "--confirm", "wrong"]), "CONFIRMATION_REQUIRED") && parseCliArgs(["--environment", "test", "--event", "evt_1", "--execute", "--confirm", "EXECUTE PARTNER RECONCILIATION TEST"]).execute);
check("G-4 live all three gates", throws(() => parseCliArgs(["--environment", "live", "--event", "evt_1", "--execute", "--confirm", "EXECUTE PARTNER RECONCILIATION LIVE"]), "ALLOW_LIVE_REQUIRED") && parseCliArgs(["--environment", "live", "--event", "evt_1", "--execute", "--allow-live", "--confirm", "EXECUTE PARTNER RECONCILIATION LIVE"]).allowLive);
check("G-5 key environment", selectStripeKey("test", { STRIPE_TEST_SECRET_KEY: "sk_test_x" }) === "sk_test_x" && selectStripeKey("live", { STRIPE_LIVE_SECRET_KEY: "sk_test_x" }) === null && selectStripeKey("live", { STRIPE_LIVE_SECRET_KEY: "sk_test_x", STRIPE_SECRET_KEY: "sk_live_y" }) === "sk_live_y");
check("G-6 args limits", throws(() => parseCliArgs(["--environment", "test", "--event", "evt_1", "--event", "evt_1"]), "DUPLICATE_EVENT_ID") && throws(() => parseCliArgs(["--environment", "test", ...Array.from({ length: 101 }, (_, i) => ["--event", `evt_${i}`]).flat()]), "TOO_MANY_EVENTS"));
const badType = fixtures({ event: { ...baseEvent, type: "checkout.session.completed" } });
check("G-7 event allowlist", (await reconcileEvent({ environment: "test", eventId: "evt_1", execute: false }, badType.stripe, badType.db)).reason_code === "EVENT_TYPE_NOT_ALLOWED");
for (const status of [null, "failed", "processing"]) {
  const f = fixtures({ billingStatus: status });
  const r = await reconcileEvent({ environment: "test", eventId: "evt_1", execute: false }, f.stripe, f.db);
  check(`G-8 ${status ?? "absent"} is not gap`, r.reason_code === "NOT_ROLLBACK_GAP" && f.calls() === 0);
}
check("G-9 processed missing proposes invoice RPC", dryResult[0]?.intended_rpc === "partner_ingest_invoice_paid");
const ignored = fixtures({ billingStatus: "ignored" });
check("G-10 ignored missing reaches RPC", (await reconcileEvent({ environment: "test", eventId: "evt_1", execute: false }, ignored.stripe, ignored.db)).intended_rpc === "partner_ingest_invoice_paid");
const existing = fixtures({ partnerEvent: true });
check("G-11 existing partner state", (await reconcileEvent({ environment: "test", eventId: "evt_1", execute: true }, existing.stripe, existing.db)).status === "already_reconciled" && existing.calls() === 0);
for (const [name, change] of [
  ["metadata", { subscription: { ...subscription, metadata: { ...subscription.metadata, app: "other" } } }],
  ["uuid", { subscription: { ...subscription, metadata: { ...subscription.metadata, workspace_id: "bad" } } }],
  ["plan", { subscription: { ...subscription, metadata: { ...subscription.metadata, plan_code: "other" } } }],
  ["version", { subscription: { ...subscription, metadata: { ...subscription.metadata, plan_version: "2" } } }],
  ["one-price", { subscription: { ...subscription, items: { data: [{ price: { id: "price_1" } }, { price: { id: "price_2" } }] } } }],
  ["mapping", { mapped: false }],
] as const) {
  const f = fixtures(change);
  check(`G-12 fail closed ${name}`, (await reconcileEvent({ environment: "test", eventId: "evt_1", execute: false }, f.stripe, f.db)).status === "rejected");
}
check("G-13 invoice shared math", (dryResult[0]?.status === "dry_run") && readFileSync("scripts/partner-program-1b-reconcile-core.ts", "utf8").includes("eligibleBaseCents(inv, valid.priceRef)"));
const unpaid = fixtures({ invoice: { ...eventObj, status: "open" } });
check("G-14 invalid invoice rejected", (await reconcileEvent({ environment: "test", eventId: "evt_1", execute: false }, unpaid.stripe, unpaid.db)).reason_code === "INVOICE_INVALID");

function moneyFixture(kind: "refund" | "dispute", changes: Record<string, any> = {}) {
  const isRefund = kind === "refund";
  const object = { id: isRefund ? "re_1" : "dp_1", livemode: false, status: isRefund ? "succeeded" : "won", amount: 1000, currency: "usd", charge: "ch_1", ...changes.object };
  return fixtures({ event: { id: "evt_1", type: isRefund ? "refund.created" : "charge.dispute.closed", livemode: false, created: 1002, data: { object } }, [kind]: { ...object, ...changes.current }, charge: { id: "ch_1", livemode: false, invoice: "in_1" }, ...changes });
}
for (const kind of ["refund", "dispute"] as const) {
  const f = moneyFixture(kind);
  const r = await reconcileEvent({ environment: "test", eventId: "evt_1", execute: false }, f.stripe, f.db);
  check(`G-15 ${kind} intended RPC`, r.intended_rpc === `partner_ingest_${kind}_state`);
  const bad = moneyFixture(kind, { current: { currency: "eur" } });
  check(`G-16 ${kind} current checks`, (await reconcileEvent({ environment: "test", eventId: "evt_1", execute: false }, bad.stripe, bad.db)).status === "rejected");
}
const executed = fixtures();
const executionOptions = parseCliArgs(["--environment", "test", "--event", "evt_1", "--event", "evt_2", "--execute", "--confirm", "EXECUTE PARTNER RECONCILIATION TEST"]);
executed.stripe.retrieveEvent = async (id) => ({ ...baseEvent, id });
await reconcileBatch(executionOptions, executed.stripe, executed.db);
check("G-17 one ingestion call per event", executed.calls() === 2 && executed.unique() === 2);
const idempotent = fixtures({ partnerEvent: true });
await reconcileEvent({ environment: "test", eventId: "evt_1", execute: true }, idempotent.stripe, idempotent.db);
check("G-18 idempotent replay no duplicate", idempotent.calls() === 0);
const core = readFileSync("scripts/partner-program-1b-reconcile-core.ts", "utf8");
const cli = readFileSync("scripts/partner-program-1b-reconcile.ts", "utf8");
check("G-19 no direct mutation methods", !/insert\(|update\(|delete\(/.test(core + cli) && !/from\("partner_commission_ledger"\)/.test(core + cli));
check("G-20 redacted output only", cli.includes("JSON.stringify(item)") && !/console\.(log|error)\([^\n]*(event|key|payload|metadata|email)/i.test(cli));
const regressionSource = readFileSync(import.meta.path, "utf8").replace(/check\("G-21[\s\S]*?;\n\nconsole\.log/, "console.log");
check("G-21 mocks only zero external calls", !/fetch\(|createClient|api\.stripe|supabase\.co/.test(regressionSource));

console.log(`partner-program-1b-reconcile-regression: ${passed} passed, ${failed} failed; mocks only, 0 external calls`);
if (failed) process.exit(1);