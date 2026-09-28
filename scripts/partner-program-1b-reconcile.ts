/**
 * Local-only G12a operator CLI. Default is dry-run. Output is deliberately
 * limited to redacted ReconcileResult fields from the pure core.
 */
import { createClient } from "@supabase/supabase-js";
import {
  parseCliArgs, reconcileBatch, selectStripeKey,
  type Environment, type IntendedRpc, type ReconciliationStore, type StripeAdapter,
} from "./partner-program-1b-reconcile-core.ts";

const API_VERSION = "2025-02-24.acacia";

function stripeRestAdapter(key: string): StripeAdapter {
  const get = async (path: string) => {
    const response = await fetch(`https://api.stripe.com/v1/${path}`, {
      headers: { Authorization: `Bearer ${key}`, "Stripe-Version": API_VERSION },
    });
    if (!response.ok) throw new Error("STRIPE_LOOKUP_FAILED");
    return await response.json() as Record<string, unknown>;
  };
  const encoded = (id: string) => encodeURIComponent(id);
  return {
    retrieveEvent: (id) => get(`events/${encoded(id)}`),
    retrieveInvoice: (id) => get(`invoices/${encoded(id)}?expand[]=lines.data.price`),
    retrieveSubscription: (id) => get(`subscriptions/${encoded(id)}?expand[]=items.data.price`),
    retrieveRefund: (id) => get(`refunds/${encoded(id)}`),
    retrieveDispute: (id) => get(`disputes/${encoded(id)}`),
    retrieveCharge: (id) => get(`charges/${encoded(id)}`),
    retrievePaymentIntent: (id) => get(`payment_intents/${encoded(id)}`),
  };
}

function supabaseStore(url: string, serviceKey: string): ReconciliationStore {
  const client = createClient(url, serviceKey, { auth: { persistSession: false, autoRefreshToken: false } });
  const exists = async (table: string, filters: Record<string, string>) => {
    let query = client.from(table).select("*").limit(1);
    for (const [column, value] of Object.entries(filters)) query = query.eq(column, value);
    const { data, error } = await query.maybeSingle();
    if (error) throw new Error("DATABASE_LOOKUP_FAILED");
    return data !== null;
  };
  return {
    async getBillingEventStatus(environment, eventRef) {
      const { data, error } = await client.from("commercial_billing_events").select("processing_status")
        .eq("provider", "stripe").eq("environment", environment).eq("event_ref", eventRef).maybeSingle();
      if (error) throw new Error("DATABASE_LOOKUP_FAILED");
      return data?.processing_status ?? null;
    },
    hasPartnerEvent: (environment, event_ref) => exists("partner_commission_events", { environment, event_ref }),
    hasInvoiceState: (environment, invoice_ref) => exists("partner_invoice_commissions", { environment, invoice_ref }),
    hasRefundState: (environment, refund_ref) => exists("partner_refund_states", { environment, refund_ref }),
    hasDisputeState: (environment, dispute_ref) => exists("partner_dispute_states", { environment, dispute_ref }),
    async hasActivePriceMapping(environment, priceRef, planCode, planVersion) {
      const { data: plan, error: planError } = await client.from("commercial_plans").select("id")
        .eq("code", planCode).eq("version", planVersion).maybeSingle();
      if (planError || !plan) return false;
      return exists("commercial_plan_provider_refs", {
        plan_id: plan.id, provider: "stripe", environment, price_ref: priceRef, active: "true",
      });
    },
    async invokeIngestion(rpc: IntendedRpc, args) {
      const { error } = await client.rpc(rpc, args);
      if (error) throw new Error("INGESTION_RPC_FAILED");
    },
  };
}

async function main() {
  try {
    const options = parseCliArgs(process.argv.slice(2));
    const key = selectStripeKey(options.environment, process.env);
    if (!key) throw new Error("STRIPE_KEY_ENVIRONMENT_MISMATCH");
    const url = process.env["SUPABASE_URL"] ?? "";
    const serviceKey = process.env["SUPABASE_SERVICE_ROLE_KEY"] ?? "";
    if (!url || !serviceKey) throw new Error("SUPABASE_CONFIGURATION_REQUIRED");
    const results = await reconcileBatch(options, stripeRestAdapter(key), supabaseStore(url, serviceKey));
    for (const item of results) console.log(JSON.stringify(item));
    if (results.some((item) => item.status === "rejected")) process.exitCode = 1;
  } catch (error) {
    const reason = error instanceof Error ? error.message : "UNEXPECTED_ERROR";
    console.error(JSON.stringify({ status: "rejected", reason_code: reason }));
    process.exitCode = 1;
  }
}

if (import.meta.main) await main();