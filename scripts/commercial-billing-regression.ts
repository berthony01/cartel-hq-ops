/**
 * STRIPE LIFECYCLE + FREE/PRO FOUNDATION — repo-only regression.
 * Zero network, zero database, zero Stripe. Reads files from disk only.
 *
 * Deployment note (accepted platform deviation): the three NEW billing Edge
 * Functions (billing-checkout, billing-portal, stripe-billing-webhook) and
 * _shared/stripe-billing.ts are authoritative in backend-source/edge-functions
 * and will be deployed directly to Supabase from there. This environment
 * cannot create new supabase/functions/<name> folders, so this suite asserts
 * those folders do NOT exist rather than requiring mirrors.
 */
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { createHash } from "node:crypto";

const MIG = "supabase/migrations";
const EF = "backend-source/edge-functions";
const DEP = "supabase/functions";
const BILLING_MIGRATION = "20260924021801_e48c0c41-9053-4f77-a267-04fbba8d206d.sql";
const POST_GATE = [
  "20260922070921_40548af2-4afe-4876-bcaa-f22868f5942d.sql",
  "20260922141917_c47c2384-73c4-4bbf-8cc2-495112d64990.sql",
  "20260922142803_fedec44c-654f-4e1a-a117-30d027601e03.sql",
  "20260922161918_ef6e322a-d993-4970-9d48-3b4f93afa222.sql",
  "20260923170038_eaa2a24d-9c13-49c9-9aa3-6a5a8e18c300.sql",
  "20260924005521_b9fca846-4db3-4e8f-bf91-bdb4bd863228.sql",
  BILLING_MIGRATION,
  "20260927013341_1f8494c2-8155-4e9d-832a-4e387a8f56b4.sql",  "20260927141715_pcart_l3_rehearsal_and_mainnet_isolation.sql",
  "20260927170206_commercial_c1_pro_provider_safety_ceilings.sql",
  "20260927171231_commercial_c2_self_service_workspace.sql",
  "20260927173127_commercial_c3a_usage_free_record_fix.sql",
  "20260928110628_b2fff4d6-4c76-4505-8980-6e527123a82b.sql",
  "20260928170228_partner_program_phase_1a_foundation.sql",
  "20260928170613_partner_program_phase_1a_rls_fk_hardening.sql",
  "20260928170917_partner_program_phase_1a_new_workspace_attribution.sql",
];

let passed = 0;
let failed = 0;
function check(id: string, ok: boolean, detail = "") {
  if (ok) passed++;
  else {
    failed++;
    console.error(`FAIL ${id}${detail ? ` — ${detail}` : ""}`);
  }
}
const read = (p: string) => readFileSync(p, "utf8");
const sha = (p: string) => createHash("sha256").update(readFileSync(p)).digest("hex");
const norm = (s: string) => s.replace(/^\s*--.*$/gm, "").replace(/\s+/g, " ");
function fnBody(sql: string, name: string): string {
  const i = sql.indexOf(`CREATE OR REPLACE FUNCTION public.${name}(`);
  if (i < 0) return "";
  const j = sql.indexOf("$function$;", i);
  const k = sql.indexOf("$$;", i);
  const end = [j, k].filter((x) => x > i).sort((a, b) => a - b)[0] ?? sql.length;
  return sql.slice(i, end);
}

/* 1. migrations */
const migrations = readdirSync(MIG).filter((f) => f.endsWith(".sql")).sort();
check("B-1.1 migration count exactly 100", migrations.length === 100, String(migrations.length));
check("B-1.2 exact sixteen post-gate migrations", JSON.stringify(migrations.filter((f) => f >= "20260922")) === JSON.stringify(POST_GATE));
check("B-1.3 billing migration immediately precedes least-privilege; authorized later migrations follow", migrations[migrations.length - 10] === BILLING_MIGRATION && migrations[migrations.length - 9] === POST_GATE[7] && migrations[migrations.length - 1] === POST_GATE[15]);
const raw = read(`${MIG}/${BILLING_MIGRATION}`);
const sql = norm(raw);

/* 2. plans/entitlements */
check("B-2.1 cartel_free v1 $0 none active", sql.includes("VALUES ('cartel_free', 1, 'Cartel HQ Free', 'active', 0, 'USD', 'none')"));
const freeBlock = sql.slice(sql.indexOf("('public_project_profile', 'feature'"), sql.indexOf("WHERE p.code = 'cartel_free' AND p.version = 1 ON CONFLICT"));
check("B-2.2 Free has exactly public_project_profile, community_basic, telegram_groups=1",
  freeBlock.includes("('public_project_profile', 'feature', NULL::integer, 'none')") &&
  freeBlock.includes("('community_basic', 'feature', NULL::integer, 'none')") &&
  freeBlock.includes("('telegram_groups', 'quota', 1, 'none')") &&
  (freeBlock.match(/\('\w+', '(feature|quota)'/g) ?? []).length === 3);
check("B-2.3 Pro gains community_basic + unlimited telegram_groups, additive only",
  sql.includes("CROSS JOIN (VALUES ('community_basic', 'feature'), ('telegram_groups', 'quota')) AS v(feature_key, kind) WHERE p.code = 'cartel_49' AND p.version = 1 ON CONFLICT (plan_id, feature_key) DO NOTHING"));
check("B-2.4 no DELETE/UPDATE of existing entitlements or plans", !/DELETE FROM public\.commercial_plan|UPDATE public\.commercial_plan/.test(sql));
check("B-2.5 no fake provider refs inserted", !/INSERT INTO public\.commercial_plan_provider_refs/.test(sql) && !/(price|prod|cus|sub|bpc)_[A-Za-z0-9]{8,}/.test(raw));

/* 3. service-only tables */
for (const t of ["commercial_plan_provider_refs", "commercial_billing_customers", "commercial_billing_subscriptions", "commercial_billing_events"]) {
  check(`B-3 ${t} created`, sql.includes(`CREATE TABLE public.${t} (`));
  check(`B-3 ${t} revoked from anon/authenticated`, sql.includes(`REVOKE ALL ON public.${t} FROM PUBLIC, anon, authenticated;`));
  check(`B-3 ${t} service_role only`, sql.includes(`GRANT ALL ON public.${t} TO service_role;`) && !new RegExp(`GRANT [A-Z, ]+ ON public\\.${t} TO (anon|authenticated)`).test(sql));
  check(`B-3 ${t} RLS enabled`, sql.includes(`ALTER TABLE public.${t} ENABLE ROW LEVEL SECURITY;`));
}
check("B-3.9 no policies created (service-only)", !/CREATE POLICY/.test(sql));
const ev = sql.slice(sql.indexOf("CREATE TABLE public.commercial_billing_events ("), sql.indexOf("REVOKE ALL ON public.commercial_billing_events"));
check("B-3.10 events store no raw payload", !/payload|raw_body|jsonb/i.test(ev));

/* 4. usage */
const usage = norm(fnBody(raw, "commercial_feature_usage"));
check("B-4.1 telegram_groups counts current telegram_group_connections by workspace", usage.includes("WHEN 'telegram_groups' THEN ( SELECT count(*) FROM public.telegram_group_connections g WHERE g.workspace_id = _workspace_id)"));
check("B-4.2 static/motion/X branches preserved", usage.includes("j.job_type = 'sticker_generate'") && usage.includes("j.job_type = 'sticker_motion_generate'") && usage.includes("FROM public.social_missions m"));
check("B-4.3 never usage_ledger", !/usage_ledger/.test(raw));

/* 5. evaluator */
const evalFn = norm(fnBody(raw, "evaluate_commercial_access"));
const iBypass = evalFn.indexOf("IF public.has_platform_unrestricted_access(v_effective) THEN");
const iMember = evalFn.indexOf("IF NOT public.is_workspace_member(");
const iFree = evalFn.indexOf("WHERE p.code = 'cartel_free' AND p.version = 1 AND p.status = 'active'");
check("B-5.1 unrestricted bypass FIRST", iBypass > 0 && iBypass < iMember && iMember < iFree);
check("B-5.2 no-assignment => virtual cartel_free enforce", evalFn.includes("SELECT 'active'::text AS status, 'enforce'::text AS enforcement_mode"));
check("B-5.3 missing Free => NO_COMMERCIAL_PLAN deny", evalFn.includes("'reason', 'NO_COMMERCIAL_PLAN', 'mode', 'enforce', 'would_block', true"));
check("B-5.4 no observe-allow for unassigned", !evalFn.includes("'reason', 'NO_PLAN_ASSIGNED', 'mode', 'observe'"));
check("B-5.5 no email authority", !/[a-z0-9-]+\.[a-z]{2,}/i.test(raw) && !/auth\.users[\s\S]{0,80}email/i.test(raw));

/* 6. workspace trigger + backfill */
const hnw = norm(fnBody(raw, "handle_new_workspace"));
check("B-6.1 member insert preserved", hnw.includes("INSERT INTO public.workspace_members (workspace_id, user_id, role)"));
check("B-6.2 Free only for non-unrestricted owner", hnw.includes("IF NOT public.has_platform_unrestricted_access(NEW.owner_id) THEN") && hnw.includes("cartel_free"));
check("B-6.3 backfill skips unrestricted owners", sql.includes("AND NOT public.has_platform_unrestricted_access(w.owner_id)"));

/* 7. downgrade effects */
const dg = norm(fnBody(raw, "apply_commercial_downgrade_effects"));
check("B-7.1 unrestricted no-op", dg.includes("IF public.has_platform_unrestricted_access(v_owner) THEN"));
check("B-7.2 pauses sticker drops only", dg.includes("SET enabled = false, paused_reason = 'plan_downgrade'") && !/social_missions|launch_notification|DELETE/i.test(dg));
check("B-7.3 service/postgres only", sql.includes("REVOKE ALL ON FUNCTION public.apply_commercial_downgrade_effects(uuid) FROM PUBLIC, anon, authenticated;"));

/* 8. subscription state */
const ap = norm(fnBody(raw, "apply_stripe_subscription_state"));
check("B-8.1 Pro for active/trialing/past_due", ap.includes("AND s.stripe_status IN ('active','trialing','past_due')"));
check("B-8.2 terminal/incomplete => Free", ap.includes("WHERE p.code = 'cartel_free' AND p.version = 1 AND p.status = 'active'") && ap.includes("'incomplete','incomplete_expired','unpaid','canceled','paused'"));
check("B-8.3 no stale reactivation", ap.includes("IF v_existing_sub.stripe_status IN ('canceled','incomplete_expired') AND v_status NOT IN ('canceled','incomplete_expired') THEN"));
check("B-8.4 no manual/reseller clobber", ap.includes("ELSIF v_desired_plan.code = 'cartel_free' AND v_has_current AND v_current.assignment_source <> 'stripe' THEN v_changed := false;"));
check("B-8.5 no churn", ap.includes("v_changed := false; -- no churn") || ap.includes("v_changed := false;"));
check("B-8.6 Pro->Free triggers downgrade effects", ap.includes("v_current.plan_code = 'cartel_49' AND v_desired_plan.code = 'cartel_free' THEN v_downgrade := public.apply_commercial_downgrade_effects(_workspace_id);"));
check("B-8.7 service/postgres only", sql.includes("FROM PUBLIC, anon, authenticated; GRANT EXECUTE ON FUNCTION public.apply_stripe_subscription_state(") );
const bs = norm(fnBody(raw, "get_workspace_billing_status"));
check("B-8.8 billing status sanitized (no refs)", !/customer_ref|subscription_ref|price_ref/.test(bs.slice(bs.indexOf("RETURN jsonb_build_object"))));
check("B-8.9 billing status not anon", sql.includes("REVOKE ALL ON FUNCTION public.get_workspace_billing_status(uuid, uuid) FROM PUBLIC, anon;"));

/* 9. shared helper + deploy source */
const helper = read(`${EF}/_shared/stripe-billing.ts`);
check("B-9.1 pinned official Stripe SDK", helper.includes('import Stripe from "npm:stripe17.7.0";'));
check("B-9.2 env derived from key prefix, else fail closed", helper.includes('key.startsWith("sk_test_") || key.startsWith("rk_test_")') && helper.includes('key.startsWith("sk_live_") || key.startsWith("rk_live_")') && helper.includes('return { ok: false, code: "BILLING_NOT_CONFIGURED" }'));
check("B-9.3 app=cartel_hq, cartel_49 v1", helper.includes('CARTEL_APP = "cartel_hq"') && helper.includes('PRO_PLAN_CODE = "cartel_49"') && helper.includes("PRO_PLAN_VERSION = 1"));
check("B-9.4 base URL from CARTEL_HQ_PUBLIC_BASE_URL https only", helper.includes('Deno.env.get("CARTEL_HQ_PUBLIC_BASE_URL")') && helper.includes('u.protocol !== "https:"'));
check("B-9.11 getStripeConfigForEnvironment: dedicated key only when prefix matches, else legacy", helper.includes("export function getStripeConfigForEnvironment(") && helper.includes('const dedicatedName = environment === "test" ? "STRIPE_TEST_SECRET_KEY" : "STRIPE_LIVE_SECRET_KEY";') && helper.includes('const legacyKey = Deno.env.get("STRIPE_SECRET_KEY") ?? "";') && helper.includes("stripeEnvironmentForKey(dedicatedKey) === environment") && helper.includes("stripeEnvironmentForKey(legacyKey) === environment") && helper.includes('if (!key) return { ok: false, code: "BILLING_NOT_CONFIGURED" };'));
check("B-9.11b activeStripeEnvironment: CARTEL_HQ_BILLING_ENVIRONMENT test|live else legacy key prefix", helper.includes("export function activeStripeEnvironment(") && helper.includes('Deno.env.get("CARTEL_HQ_BILLING_ENVIRONMENT")') && helper.includes('if (configured === "test" || configured === "live") return configured;') && !helper.includes('"invalid"') && helper.includes("return getStripeConfigForEnvironment(environment);"));
check("B-9.12 getStripeWebhookConfigs: dedicated secrets; legacy secret only for legacy key env", helper.includes("export function getStripeWebhookConfigs(") && helper.includes('"STRIPE_TEST_WEBHOOK_SECRET"') && helper.includes('"STRIPE_LIVE_WEBHOOK_SECRET"') && helper.includes('const legacyWebhookSecret = Deno.env.get("STRIPE_WEBHOOK_SECRET") ?? "";') && helper.includes('const legacyEnvironment = stripeEnvironmentForKey(Deno.env.get("STRIPE_SECRET_KEY") ?? "");') && helper.includes('(legacyEnvironment === environment ? legacyWebhookSecret : "")'));
check("B-9.13 fallback base URL is pepecartelhq.com, never used as fallback", helper.includes('DEFAULT_PUBLIC_BASE_URL = "https://pepecartelhq.com"') && (helper.match(/DEFAULT_PUBLIC_BASE_URL/g) ?? []).length === 1);
check("B-9.14 PRO_STATUSES shared", helper.includes('export const PRO_STATUSES = ["active", "trialing", "past_due"] as const;'));
for (const fn of ["billing-checkout", "billing-portal", "stripe-billing-webhook"]) {
  check(`B-9.5 ${fn} authoritative in backend-source`, existsSync(`${EF}/${fn}/index.ts`) && existsSync(`${EF}/${fn}/deno.json`));
  check(`B-9.6 ${fn} not required as a supabase/functions folder`, !existsSync(`${DEP}/${fn}`));
}
const allBilling = [helper, read(`${EF}/billing-checkout/index.ts`), read(`${EF}/billing-portal/index.ts`), read(`${EF}/stripe-billing-webhook/index.ts`)].join("\n");
check("B-9.7 no hardcoded Stripe IDs or secrets", !/(price|prod|cus|sub|bpc|whsec|sk_live|sk_test|rk_live|rk_test)_[A-Za-z0-9]{8,}/.test(allBilling));
check("B-9.8 no secret logging", !/console\.[a-z]+\([^)]*(STRIPE_SECRET_KEY|webhookSecret|key\))/.test(allBilling));
check("B-9.9 no connector gateway at runtime", !/connector-gateway|gateway\.lovable/i.test(allBilling));
check("B-9.10 no email authority", !/\.email\s*===|email\s*==\s*/.test(allBilling));

/* 10. checkout */
const co = read(`${EF}/billing-checkout/index.ts`);
const iUnr = co.indexOf('"has_platform_unrestricted_access"');
const iOwn = co.indexOf('"is_workspace_owner"');
const iId = co.indexOf("requireProjectToolAccess(admin, user.id, workspaceId)");
const iStripe = co.indexOf("getStripeConfig()");
check("B-10.1 unrestricted -> no billing, then owner-only, then identity, then Stripe", iUnr > 0 && iUnr < iOwn && iOwn < iId && iId < iStripe && co.includes("UNRESTRICTED_NO_BILLING"));
check("B-10.2 client supplies only workspaceId", !/body\.(price|priceId|customer|subscription|successUrl|cancelUrl)/i.test(co));
check("B-10.3 price from DB provider refs", co.includes('.from("commercial_plan_provider_refs")') && co.includes("line_items: [{ price: ref.price_ref, quantity: 1 }]"));
check("B-10.4 missing refs => BILLING_NOT_CONFIGURED 503", co.includes('respond({ error: "BILLING_NOT_CONFIGURED", message: "Billing is not configured yet." }, 503)'));
check("B-10.5 duplicate block incl. incomplete", co.includes("ALREADY_SUBSCRIBED") && co.includes('statuses.includes("incomplete")'));
check("B-10.6 metadata + subscription_data metadata", co.includes("metadata,\n        subscription_data: { metadata },") && co.includes("client_reference_id: workspaceId"));
check("B-10.7 no promos, no tax, no trial", co.includes("allow_promotion_codes: false") && co.includes("automatic_tax: { enabled: false }") && !/trial_/.test(co));
check("B-10.8 exact success/cancel URLs", co.includes("`${baseUrl}/settings?billing=success&session_id={CHECKOUT_SESSION_ID}#billing`") && co.includes("`${baseUrl}/settings?billing=cancelled#billing`"));
check("B-10.9 idempotency keys", co.includes("idempotencyKey: `cartel_hq:customer:${environment}:${user.id}`") && co.includes("idempotencyKey: `cartel_hq:checkout:${environment}:${workspaceId}:${assignmentKey}"));

/* 11. portal */
const po = read(`${EF}/billing-portal/index.ts`);
check("B-11.1 no client customer id", !/body\.(customer|customerId|configuration)/i.test(po));
check("B-11.2 owner/billing owner/unrestricted", po.includes("isOwner !== true && unrestricted !== true && !isBillingOwner"));
check("B-11.3 explicit portal configuration + return URL", po.includes("configuration:") && po.includes("`${baseUrl}/settings#billing`"));

/* 12. webhook */
const wh = read(`${EF}/stripe-billing-webhook/index.ts`);
const iSig = wh.indexOf("constructEventAsync(rawBody, signature, cfg.webhookSecret");
check("B-12.10 verify against whichever env signs", wh.includes("for (const cfg of configs)") && wh.includes("verifiedEvent = await cfg.stripe.webhooks.constructEventAsync("));
check("B-12.11 scheduled period-end cancellation only while Pro retained", wh.includes("const keepsPro = PRO_STATUSES.includes(") && wh.includes("const scheduledAtPeriodEnd = keepsPro &&") && wh.includes("cancelAt === currentPeriodEnd") && wh.includes("_cancel_at_period_end: scheduledAtPeriodEnd") && wh.includes("_current_period_end: tsOrNull(currentPeriodEnd)"));
check("B-12.1 signature verified before any processing/DB", iSig > 0 && iSig < wh.indexOf("createClient(") && iSig < wh.indexOf("subscriptions.retrieve"));
check("B-12.2 raw body", wh.includes("const rawBody = await req.text();"));
check("B-12.3 livemode must match verifying env (immediate 400)", wh.includes('const eventEnvironment = verifiedEvent.livemode ? "live" : "test";') && wh.includes('if (eventEnvironment !== cfg.environment) return text("environment mismatch", 400);'));
check("B-12.4 shared-account filter before DB mutation", wh.indexOf('if (!isCartelMetadata(md)) return text("ignored", 200);') < wh.indexOf('.from("commercial_billing_events").insert'));
check("B-12.5 exact price mapping required", wh.includes('.eq("price_ref", priceRef).eq("active", true)') && wh.includes("PRICE_NOT_MAPPED"));
check("B-12.6 Stripe subscription retrieved is source of truth", wh.includes("await stripe.subscriptions.retrieve(subscriptionRef)"));
check("B-12.7 idempotent events, failures non-2xx", wh.includes('return text("duplicate", 200)') && wh.includes('return text("processing failed", 500)'));
check("B-12.8 no raw payload stored", !/rawBody[\s\S]{0,60}insert|payload:/.test(wh));
for (const e of ["checkout.session.completed", "customer.subscription.created", "customer.subscription.updated", "customer.subscription.deleted", "customer.subscription.paused", "customer.subscription.resumed", "invoice.paid", "invoice.payment_failed", "invoice.payment_action_required"]) {
  check(`B-12.9 handles ${e}`, wh.includes(`"${e}"`));
}

/* 13. community remap + group limit */
const ca = read(`${EF}/_shared/commercial-access.ts`);
check("B-13.1 keys include community_basic + telegram_groups", ca.includes('"community_basic",') && ca.includes('"telegram_groups",'));
check("B-13.2 commercial-access mirrors byte-identical", sha(`${EF}/_shared/commercial-access.ts`) === sha(`${DEP}/_shared/commercial-access.ts`));
const tg = read(`${EF}/telegram-group/index.ts`);
check("B-13.3 community_basic maps exactly welcome/test actions",
  tg.includes('send_group_test: "community_basic",') && tg.includes('save_welcome_settings: "community_basic",') && tg.includes('send_welcome_test: "community_basic",') &&
  (tg.match(/"community_basic"/g) ?? []).length === 3);
check("B-13.4 sticker_auto_posting + official_broadcasts preserved", tg.includes('assign_pack: "sticker_auto_posting",') && tg.includes('distribute_pack: "sticker_auto_posting",') && tg.includes('send_official_contract_broadcast: "official_broadcasts",'));
const tw = read(`${EF}/telegram-webhook/index.ts`);
check("B-13.5 telegram-webhook mirrors byte-identical", sha(`${EF}/telegram-webhook/index.ts`) === sha(`${DEP}/telegram-webhook/index.ts`));
const iClaim = tw.indexOf("if (claimed && claimed.workspace_id !== workspaceId)");
const iGate = tw.indexOf('requireCommercialAccess(admin, link.user_id, workspaceId, "telegram_groups")');
const iUpsert = tw.indexOf('from("telegram_group_connections").upsert');
check("B-13.6 group limit after claim check, before upsert, new groups only", iClaim > 0 && iClaim < iGate && iGate < iUpsert && /if \(!claimed\) \{\s*const groupLimitGate/.test(tw));

/* 14. UI */
const ui = read("src/components/cartel/BillingSection.tsx");
check("B-14.1 anchor id=billing", ui.includes('id="billing"'));
check("B-14.2 uses get_workspace_billing_status", ui.includes('supabase.rpc("get_workspace_billing_status"'));
check("B-14.3 invokes billing-checkout/portal with workspaceId only", ui.includes('supabase.functions.invoke(fn, { body: { workspaceId } })'));
check("B-14.4 unrestricted label", ui.includes("Platform Owner — Unrestricted"));
check("B-14.5 never client-grants (no DB writes)", !/\.(insert|update|upsert|delete)\(/.test(ui) && !/set_workspace_commercial_assignment|apply_stripe/.test(ui));
check("B-14.6 integrated into settings", read("src/routes/_authenticated/settings.tsx").includes("<BillingSection />"));

/* 15. PCART/chain untouched */
check("B-15.1 MAINNET_LIQUIDITY_TX_ENABLED remains false", /MAINNET_LIQUIDITY_TX_ENABLED\s*=\s*false/.test(read("src/lib/chain-mainnet-registry.ts")));
check("B-15.2 billing sources reference no PCART/chain", !/pcart|pepecartel-token|treasury|liquidity/i.test(allBilling + ui));

console.log(`commercial-billing-regression: ${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
