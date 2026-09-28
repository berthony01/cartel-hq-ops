import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2";
import { requireProjectToolAccess } from "../_shared/project-identity.ts";
import {
  billingCors,
  billingRespond as respond,
  CARTEL_APP,
  getStripeConfig,
  PRO_PLAN_CODE,
  PRO_PLAN_VERSION,
  publicBaseUrl,
} from "../_shared/stripe-billing.ts";

/**
 * CARTEL HQ billing-checkout (verify_jwt=true).
 * Workspace OWNER only. The client supplies only workspaceId; every Stripe
 * ref (price, customer) is selected server-side from the database.
 */
Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: billingCors });
  if (req.method !== "POST") return respond({ error: "METHOD_NOT_ALLOWED" }, 405);

  const SUPABASE_URL = Deno.env.get("SUPABASE_URL") ?? "";
  const ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY") ?? "";
  const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
  const authHeader = req.headers.get("Authorization") ?? "";
  if (!authHeader.startsWith("Bearer ")) return respond({ error: "UNAUTHENTICATED", message: "Sign in to CARTEL HQ first." }, 401);

  const userClient = createClient(SUPABASE_URL, ANON_KEY, {
    global: { headers: { Authorization: authHeader } },
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const { data: authData, error: authError } = await userClient.auth.getUser();
  if (authError || !authData.user) return respond({ error: "UNAUTHENTICATED", message: "Your session expired. Sign in again." }, 401);
  const user = authData.user;

  let body: Record<string, unknown> = {};
  try { body = await req.json(); } catch { return respond({ error: "INVALID_BODY", message: "Invalid request." }, 400); }
  const workspaceId = typeof body.workspaceId === "string" ? body.workspaceId : "";
  if (!/^[0-9a-f-]{36}$/i.test(workspaceId)) return respond({ error: "WORKSPACE_REQUIRED", message: "Workspace is required." }, 400);

  const admin = createClient(SUPABASE_URL, SERVICE_KEY, { auth: { persistSession: false, autoRefreshToken: false } });

  // Unrestricted platform owner never enters billing.
  const { data: unrestricted, error: unrErr } = await admin.rpc("has_platform_unrestricted_access", { _user_id: user.id });
  if (unrErr) return respond({ error: "BILLING_UNAVAILABLE", message: "Billing could not be verified. Try again." }, 503);
  if (unrestricted === true) return respond({ error: "UNRESTRICTED_NO_BILLING", message: "Platform owner access is unrestricted. No billing is required." }, 409);

  // Workspace OWNER only.
  const { data: isOwner, error: ownerErr } = await admin.rpc("is_workspace_owner", { _workspace_id: workspaceId, _user_id: user.id });
  if (ownerErr) return respond({ error: "BILLING_UNAVAILABLE", message: "Billing could not be verified. Try again." }, 503);
  if (isOwner !== true) return respond({ error: "FORBIDDEN", message: "Only the workspace owner can upgrade." }, 403);

  // Project Identity before billing.
  const identity = await requireProjectToolAccess(admin, user.id, workspaceId);
  if (!identity.allowed) return respond(identity.body, identity.status);

  const cfg = getStripeConfig();
  const baseUrl = publicBaseUrl();
  if (!cfg.ok || !baseUrl) return respond({ error: "BILLING_NOT_CONFIGURED", message: "Billing is not configured yet." }, 503);
  const { stripe, environment } = cfg;

  const { data: plan } = await admin.from("commercial_plans").select("id").eq("code", PRO_PLAN_CODE).eq("version", PRO_PLAN_VERSION).maybeSingle();
  if (!plan) return respond({ error: "BILLING_NOT_CONFIGURED", message: "Billing is not configured yet." }, 503);
  const { data: ref } = await admin
    .from("commercial_plan_provider_refs")
    .select("price_ref")
    .eq("plan_id", plan.id).eq("provider", "stripe").eq("environment", environment).eq("active", true)
    .maybeSingle();
  if (!ref?.price_ref) return respond({ error: "BILLING_NOT_CONFIGURED", message: "Billing is not configured yet." }, 503);

  // Block duplicates: active/trialing/past_due => already subscribed; incomplete => resolve first.
  const { data: subs, error: subsErr } = await admin
    .from("commercial_billing_subscriptions")
    .select("stripe_status")
    .eq("workspace_id", workspaceId).eq("environment", environment);
  if (subsErr) return respond({ error: "BILLING_UNAVAILABLE", message: "Billing could not be verified. Try again." }, 503);
  const statuses = (subs ?? []).map((s) => s.stripe_status);
  if (statuses.some((s) => s === "active" || s === "trialing" || s === "past_due")) {
    return respond({ error: "ALREADY_SUBSCRIBED", message: "This workspace already has Cartel HQ Pro." }, 409);
  }
  if (statuses.includes("incomplete")) {
    return respond({ error: "SUBSCRIPTION_INCOMPLETE", message: "A previous checkout is still being confirmed. Try again shortly." }, 409);
  }

  // Current assignment identity for a stable checkout idempotency key.
  const { data: assignment } = await admin
    .from("workspace_commercial_assignments")
    .select("id")
    .eq("workspace_id", workspaceId)
    .is("ends_at", null)
    .maybeSingle();
  const assignmentKey = assignment?.id ?? "none";

  try {
    // One Stripe Customer per billing owner/environment.
    const { data: existingCustomer } = await admin
      .from("commercial_billing_customers")
      .select("customer_ref")
      .eq("provider", "stripe").eq("environment", environment).eq("billing_owner_user_id", user.id)
      .maybeSingle();
    let customerRef = existingCustomer?.customer_ref ?? "";
    if (!customerRef) {
      const customer = await stripe.customers.create(
        {
          email: user.email ?? undefined, // receipt/prefill only, never authority
          metadata: { app: CARTEL_APP, billing_owner_user_id: user.id },
        },
        { idempotencyKey: `cartel_hq:customer:${environment}:${user.id}` },
      );
      customerRef = customer.id;
      const { error: insErr } = await admin.from("commercial_billing_customers").insert({
        provider: "stripe", environment, billing_owner_user_id: user.id, customer_ref: customerRef,
      });
      if (insErr) {
        const { data: raced } = await admin
          .from("commercial_billing_customers")
          .select("customer_ref")
          .eq("provider", "stripe").eq("environment", environment).eq("billing_owner_user_id", user.id)
          .maybeSingle();
        if (!raced?.customer_ref) throw new Error("customer persist failed");
        customerRef = raced.customer_ref;
      }
    }

    const metadata = {
      app: CARTEL_APP,
      workspace_id: workspaceId,
      billing_owner_user_id: user.id,
      plan_code: PRO_PLAN_CODE,
      plan_version: String(PRO_PLAN_VERSION),
      channel: "direct",
    };
    // Stripe-hosted Terms consent: server flag, DEFAULT OFF. Enable only after
    // the Stripe Dashboard public Terms URL is independently confirmed; Stripe
    // rejects consent_collection when no Terms URL is configured. The flag is
    // folded into the idempotency key so toggling never replays mismatched params.
    const tosConsent = Deno.env.get("CARTEL_HQ_STRIPE_TERMS_CONSENT_ENABLED") === "true";
    const session = await stripe.checkout.sessions.create(
      {
        mode: "subscription",
        customer: customerRef,
        client_reference_id: workspaceId,
        line_items: [{ price: ref.price_ref, quantity: 1 }],
        metadata,
        subscription_data: { metadata },
        allow_promotion_codes: false,
        automatic_tax: { enabled: false },
        billing_address_collection: "auto",
        ...(tosConsent ? { consent_collection: { terms_of_service: "required" as const } } : {}),
        success_url: `${baseUrl}/settings?billing=success&session_id={CHECKOUT_SESSION_ID}#billing`,
        cancel_url: `${baseUrl}/settings?billing=cancelled#billing`,
      },
      { idempotencyKey: `cartel_hq:checkout:${environment}:${workspaceId}:${assignmentKey}:${PRO_PLAN_CODE}:v${PRO_PLAN_VERSION}${tosConsent ? ":tos" : ""}` },
    );
    if (!session.url) return respond({ error: "BILLING_UNAVAILABLE", message: "Checkout could not be started. Try again." }, 502);
    return respond({ url: session.url });
  } catch (err) {
    console.error("billing-checkout stripe error", (err as { type?: string })?.type ?? "unknown");
    return respond({ error: "BILLING_UNAVAILABLE", message: "Checkout could not be started. Try again." }, 502);
  }
});
