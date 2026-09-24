import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2";
import {
  billingCors,
  billingRespond as respond,
  getStripeConfig,
  PRO_PLAN_CODE,
  PRO_PLAN_VERSION,
  publicBaseUrl,
} from "../_shared/stripe-billing.ts";

/**
 * CARTEL HQ billing-portal (verify_jwt=true).
 * Workspace owner, current billing owner, or unrestricted. The client never
 * supplies a customer id; it is resolved server-side from the database and
 * the explicit Cartel HQ portal configuration is always used.
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

  const [{ data: isOwner }, { data: unrestricted }, { data: assignment }] = await Promise.all([
    admin.rpc("is_workspace_owner", { _workspace_id: workspaceId, _user_id: user.id }),
    admin.rpc("has_platform_unrestricted_access", { _user_id: user.id }),
    admin.from("workspace_commercial_assignments").select("billing_owner_user_id").eq("workspace_id", workspaceId).is("ends_at", null).maybeSingle(),
  ]);
  const isBillingOwner = !!assignment?.billing_owner_user_id && assignment.billing_owner_user_id === user.id;
  if (isOwner !== true && unrestricted !== true && !isBillingOwner) {
    return respond({ error: "FORBIDDEN", message: "Only the workspace owner or billing owner can manage billing." }, 403);
  }

  const cfg = getStripeConfig();
  const baseUrl = publicBaseUrl();
  if (!cfg.ok || !baseUrl) return respond({ error: "BILLING_NOT_CONFIGURED", message: "Billing is not configured yet." }, 503);
  const { stripe, environment } = cfg;

  // Resolve the workspace's subscription customer server-side.
  const { data: sub } = await admin
    .from("commercial_billing_subscriptions")
    .select("customer_ref")
    .eq("workspace_id", workspaceId).eq("environment", environment).eq("provider", "stripe")
    .order("updated_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (!sub?.customer_ref) return respond({ error: "NO_BILLING_ACCOUNT", message: "No billing account exists for this workspace yet." }, 404);

  const { data: plan } = await admin.from("commercial_plans").select("id").eq("code", PRO_PLAN_CODE).eq("version", PRO_PLAN_VERSION).maybeSingle();
  const { data: ref } = plan
    ? await admin
        .from("commercial_plan_provider_refs")
        .select("portal_configuration_ref")
        .eq("plan_id", plan.id).eq("provider", "stripe").eq("environment", environment).eq("active", true)
        .maybeSingle()
    : { data: null };
  if (!ref?.portal_configuration_ref) return respond({ error: "BILLING_PORTAL_NOT_CONFIGURED", message: "Billing management is not configured yet." }, 503);

  try {
    const session = await stripe.billingPortal.sessions.create({
      customer: sub.customer_ref,
      configuration: ref.portal_configuration_ref,
      return_url: `${baseUrl}/settings#billing`,
    });
    return respond({ url: session.url });
  } catch (err) {
    console.error("billing-portal stripe error", (err as { type?: string })?.type ?? "unknown");
    return respond({ error: "BILLING_UNAVAILABLE", message: "Billing management could not be opened. Try again." }, 502);
  }
});
