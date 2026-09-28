/**
 * PARTNER PROGRAM PHASE 1A — static regression for the staged DB contract.
 * Zero network, zero database. Reads files from disk only.
 */
import { readFileSync } from "node:fs";
import { createHash } from "node:crypto";

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

const RAW = read("docs/sql/PARTNER_1A_foundation.sql");
const CODE = RAW.replace(/^\s*--.*$/gm, "");
const N = CODE.replace(/\s+/g, " ");
function fnBody(name: string): string {
  const i = N.indexOf(`CREATE OR REPLACE FUNCTION public.${name}(`);
  if (i < 0) return "";
  const j = N.indexOf(" END $$;", i);
  return N.slice(i, j < 0 ? N.length : j);
}

/* 1. Staged / additive only */
check("P-1.1 staged not applied", /STAGED FOR REVIEW ONLY/.test(RAW));
check("P-1.2 no DROP", !/\bDROP\b/i.test(CODE));
check("P-1.3 no TRUNCATE/DELETE FROM", !/\bTRUNCATE\b|\bDELETE\s+FROM\b/i.test(CODE));
check("P-1.4 no ALTER TABLE except ENABLE RLS", (N.match(/ALTER TABLE [^;]+;/g) ?? []).every((s) => /ENABLE ROW LEVEL SECURITY;$/.test(s)));
check("P-1.5 no plan/price/entitlement/provider mutation",
  !/(INSERT INTO|UPDATE)\s+public\.(commercial_plans|commercial_plan_entitlements|commercial_plan_provider_refs|commercial_billing_\w+)/i.test(CODE));
check("P-1.6 no INSERT into partner_program_terms (no seed)", !/INSERT INTO public\.partner_program_terms/i.test(CODE));
const stmtStarts = (CODE.match(/^(?:[A-Z][A-Z ]+)/gm) ?? []).map((s) => s.trim().split(" ").slice(0, 2).join(" "));
const allowedStarts = /^(CREATE TABLE|CREATE UNIQUE|CREATE INDEX|CREATE OR|ALTER TABLE|GRANT |GRANT EXECUTE|GRANT SELECT|GRANT ALL|REVOKE ALL|COMMENT ON|DO \$policies\$|BEGIN|END|DECLARE|RETURNS|IF |ELSE|RETURN|UPDATE|INSERT|SELECT|VALUES|WHERE|FROM|SET|ON |FOR |USING|RAISE|CREATE POLICY|AND |OR |LANGUAGE|PRIMARY|CONSTRAINT|CHECK)/;
check("P-1.7 only additive statement kinds at column 0", stmtStarts.filter((s) => /^(CREATE|ALTER|GRANT|REVOKE|COMMENT|DROP|TRUNCATE|DELETE)/.test(s)).every((s) => allowedStarts.test(s)));

/* 2. Tables, RLS, grants */
const TABLES = ["partner_program_terms", "partners", "partner_applications", "partner_agreement_acceptances",
  "partner_referrals", "partner_payout_requests", "partner_commission_ledger"];
for (const t of TABLES) {
  check(`P-2 ${t} created idempotently`, N.includes(`CREATE TABLE IF NOT EXISTS public.${t} (`));
  check(`P-2 ${t} RLS enabled`, N.includes(`ALTER TABLE public.${t} ENABLE ROW LEVEL SECURITY;`));
  check(`P-2 ${t} authenticated SELECT only`, N.includes(`GRANT SELECT ON public.${t} TO authenticated;`)
    && !new RegExp(`GRANT (INSERT|UPDATE|DELETE|ALL)[^;]*ON public\\.${t}[^;]*TO [^;]*authenticated`).test(N));
  check(`P-2 ${t} no anon grant`, !new RegExp(`GRANT [^;]*public\\.${t}[^;]*TO [^;]*anon`).test(N));
  check(`P-2 ${t} service_role grant`, new RegExp(`GRANT ALL ON [^;]*public\\.${t}[^;]*TO service_role;`).test(N));
}
check("P-2.1 anon/PUBLIC revoked on all partner tables", /REVOKE ALL ON public\.partner_program_terms, [^;]+ FROM PUBLIC, anon, authenticated;/.test(N));
check("P-2.2 only SELECT policies", (N.match(/CREATE POLICY \w+ ON public\.\w+ FOR (\w+)/g) ?? []).every((p) => p.endsWith("FOR SELECT")) && (N.match(/CREATE POLICY/g) ?? []).length === 7);
check("P-2.3 policies scoped to own or platform owner", (N.match(/CREATE POLICY[^;]+;/g) ?? []).every((p) => p.includes("public.is_platform_owner(auth.uid())") && (p.includes("auth.uid()"))));
check("P-2.4 status checks", N.includes("status IN ('draft','active','retired')") && N.includes("status IN ('applied','approved','suspended','rejected','terminated')")
  && N.includes("tax_doc_status IN ('not_submitted','submitted','verified','rejected')") && N.includes("status IN ('pending','qualified','rejected_self','rejected_fraud','expired')")
  && N.includes("status IN ('requested','approved','rejected','paid','cancelled')") && N.includes("entry_type IN ('accrual','reversal','adjustment','payout')")
  && N.includes("source_kind IN ('manual','stripe_event')") && N.includes("source IN ('link','code')"));
check("P-2.5 one partner per user", N.includes("user_id uuid NOT NULL UNIQUE,"));
check("P-2.6 one active terms", N.includes("CREATE UNIQUE INDEX IF NOT EXISTS partner_program_terms_one_active ON public.partner_program_terms ((true)) WHERE status = 'active';"));
check("P-2.7 one pending application; reapply allowed", N.includes("partner_applications_one_pending ON public.partner_applications (user_id) WHERE status = 'pending';"));
check("P-2.8 referral code unique + only when approved", N.includes("referral_code text NULL UNIQUE") && N.includes("CHECK (referral_code IS NULL OR approved_at IS NOT NULL)"));

/* 3. No hardcoded terms/thresholds */
const termsTable = N.slice(N.indexOf("CREATE TABLE IF NOT EXISTS public.partner_program_terms ("), N.indexOf("CREATE UNIQUE INDEX IF NOT EXISTS partner_program_terms_one_active"));
check("P-3.1 term columns nullable with no DEFAULT", ["commission_bps integer NULL", "attribution_window_days integer NULL", "hold_days integer NULL", "min_payout_cents integer NULL", "currency text NULL", "agreement_text text NULL", "disclosure_text text NULL"].every((c) => termsTable.includes(c))
  && !/(commission_bps|attribution_window_days|hold_days|min_payout_cents|currency)[^,]*DEFAULT/.test(termsTable));
check("P-3.2 no tax threshold", !/threshold|1099|\b600\b|w-?9|w-?8/i.test(CODE));
check("P-3.3 activation validator rejects incomplete terms", fnBody("partner_terms_validate").includes("PARTNER_TERMS_INCOMPLETE") && fnBody("partner_terms_validate").includes("NEW.commission_bps IS NULL"));
check("P-3.4 activated terms frozen", fnBody("partner_terms_validate").includes("PARTNER_TERMS_FROZEN"));

/* 4. No prohibited PII */
check("P-4.1 no tax/bank/IP/document columns", !/\b(ssn|ein|tin|tax_id|iban|routing|account_number|bank_\w+|swift|card_\w+|ip_address|ip_hash|user_agent|fingerprint|document_url|document_image|w9|w8)\b/i.test(CODE));

/* 5. Ledger immutability + owner-only writes */
check("P-5.1 append-only trigger on ledger", N.includes("CREATE OR REPLACE TRIGGER partner_commission_ledger_append_only BEFORE UPDATE OR DELETE ON public.partner_commission_ledger"));
check("P-5.2 append-only trigger on acceptances", N.includes("CREATE OR REPLACE TRIGGER partner_agreement_acceptances_append_only BEFORE UPDATE OR DELETE ON public.partner_agreement_acceptances"));
check("P-5.3 no UPDATE of ledger anywhere", !/UPDATE public\.partner_commission_ledger/.test(N));
check("P-5.4 ledger no mutable status column", !/partner_commission_ledger \([^;]*\bstatus\b/.test(N.slice(N.indexOf("public.partner_commission_ledger ("), N.indexOf("CREATE UNIQUE INDEX IF NOT EXISTS partner_commission_ledger_source_ref"))));
check("P-5.5 sign rules by entry type", N.includes("(entry_type = 'payout' AND amount_cents < 0 AND payout_request_id IS NOT NULL)"));
check("P-5.6 unique source_event_ref + one payout entry", N.includes("partner_commission_ledger_source_ref ON public.partner_commission_ledger (entry_type, source_event_ref) WHERE source_event_ref IS NOT NULL")
  && N.includes("partner_commission_ledger_one_payout ON public.partner_commission_ledger (payout_request_id) WHERE entry_type = 'payout'"));
const ledgerInserts = (N.match(/INSERT INTO public\.partner_commission_ledger[^;]+;/g) ?? []);
check("P-5.7 ledger inserted only by owner adjustment + mark paid", ledgerInserts.length === 2 && ledgerInserts.every((s) => /'manual'/.test(s)) && !ledgerInserts.some((s) => /'accrual'|'reversal'|'stripe_event'/.test(s))
  && fnBody("owner_add_partner_ledger_adjustment").includes("public.partner_require_owner()") && fnBody("owner_mark_partner_payout_paid").includes("public.partner_require_owner()"));
check("P-5.8 mark paid idempotent", fnBody("owner_mark_partner_payout_paid").includes("already_paid") && fnBody("owner_mark_partner_payout_paid").includes("ON CONFLICT (payout_request_id) WHERE entry_type = 'payout' DO NOTHING"));
const owner = fnBody("partner_require_owner");
check("P-5.9 owner authority is is_platform_owner, no email/metadata", owner.includes("public.is_platform_owner(v)") && !/email|user_metadata|raw_user_meta|app_metadata/i.test(CODE));
for (const f of ["owner_activate_partner_terms", "owner_retire_partner_terms", "owner_review_partner_application", "owner_set_partner_status", "owner_add_partner_ledger_adjustment", "owner_review_partner_payout", "owner_mark_partner_payout_paid"]) {
  check(`P-5 ${f} owner-gated`, fnBody(f).includes("v_owner uuid := public.partner_require_owner()"));
}

/* 6. Payout rules */
const pay = fnBody("request_partner_payout");
check("P-6.1 approved + tax verified + active terms + minimum", pay.includes("v_p.status <> 'approved'") && pay.includes("v_p.tax_doc_status <> 'verified'") && pay.includes("PROGRAM_NOT_OPEN") && pay.includes("_amount_cents < v_t.min_payout_cents"));
check("P-6.2 balance minus open reservations, same currency", pay.includes("public.partner_available_balance(v_p.id, v_t.currency)") && pay.includes("status IN ('requested','approved')") && pay.includes("_amount_cents > v_available - v_reserved"));
check("P-6.3 serialized per partner", pay.includes("FOR UPDATE"));
check("P-6.4 availability derived from available_at", fnBody("partner_available_balance").includes("l.available_at <= now() OR l.amount_cents < 0"));

/* 7. Attribution */
const rec = fnBody("record_referral_attribution");
check("P-7.1 auth + sanitized code + no partner id param", rec.includes("AUTH_REQUIRED") && rec.includes("'^[a-z0-9]{10}$'") && /record_referral_attribution\(_code text, _source text/.test(N) && !/record_referral_attribution\([^)]*partner/.test(N));
check("P-7.2 approved affiliate + active terms", rec.includes("status = 'approved' AND is_affiliate") && rec.includes("PROGRAM_NOT_OPEN"));
check("P-7.3 first attribution wins", N.includes("partner_referrals_first_attribution ON public.partner_referrals (referred_user_id)") && rec.includes("ON CONFLICT (referred_user_id) DO NOTHING") && rec.includes("already_attributed"));
check("P-7.4 self-referral same user", rec.includes("v_p.user_id = v_uid") && rec.includes("SELF_REFERRAL"));
const bind = fnBody("bind_referral_to_workspace");
check("P-7.5 bind requires workspace owner", bind.includes("public.is_workspace_owner(_workspace_id, v_uid)") && bind.includes("WORKSPACE_OWNER_REQUIRED"));
check("P-7.6 bind rejects partner membership conflict", bind.includes("public.is_workspace_member(_workspace_id, v_p.user_id)") && bind.includes("'rejected_self'"));

/* 8. Assignment marker cannot overwrite authority */
const upd = (bind.match(/UPDATE public\.workspace_commercial_assignments[^;]+;/) ?? [""])[0];
check("P-8.1 marker only on Free/direct/internal/active", ["pl.code = 'cartel_free'", "a.channel = 'direct'", "a.channel_partner_ref IS NULL", "a.assignment_source = 'internal'", "a.status = 'active'"].every((c) => upd.includes(c)));
check("P-8.2 single assignment update site", (N.match(/UPDATE public\.workspace_commercial_assignments/g) ?? []).length === 1);

/* 9. No workspace access grant */
check("P-9.1 no workspace_members mutation", !/(INSERT INTO|UPDATE|DELETE FROM)\s+public\.workspace_members/i.test(CODE));
check("P-9.2 no service-partner access table/RPC", !/workspace_partner_access|invite_service_partner|accept_workspace_partner|revoke_workspace_partner/i.test(CODE));

/* 10. Function privileges */
const USER_FNS = ["submit_partner_application", "accept_partner_agreement", "record_referral_attribution", "bind_referral_to_workspace", "request_partner_payout", "get_my_partner_summary"];
const fnDefs = N.match(/CREATE OR REPLACE FUNCTION public\.\w+\(.*?\$\$/g) ?? [];
check("P-10.1 every function pins search_path", fnDefs.length >= 20 && fnDefs.every((d) => d.includes("SET search_path = ''")));
for (const f of USER_FNS) check(`P-10 ${f} revoked PUBLIC/anon + authenticated grant`, new RegExp(`REVOKE ALL ON FUNCTION public\\.${f}\\([^)]*\\) FROM PUBLIC, anon;`).test(N) && new RegExp(`GRANT EXECUTE ON FUNCTION public\\.${f}\\([^)]*\\) TO authenticated;`).test(N));
check("P-10.2 internal helpers not callable by authenticated", ["partner_require_owner()", "partner_active_terms()", "partner_available_balance(uuid, text)"].every((s) => N.includes(`REVOKE ALL ON FUNCTION public.${s} FROM PUBLIC, anon, authenticated;`)));
check("P-10.3 applications require active terms", fnBody("submit_partner_application").includes("PROGRAM_NOT_OPEN"));

/* 11. Protected files untouched (hashes at start HEAD 2cbfd253) */
const PROTECTED: Record<string, string> = {
  "backend-source/edge-functions/stripe-billing-webhook/index.ts": "a0121c8a0712f3616b65201b22b3117d01d87e1521829780d7e1063b5c1d04a1",
  "backend-source/edge-functions/billing-checkout/index.ts": "d158c1fc6facf9dac7ec1d6c141d91e486662387ac15e421ec85ba5cd946ccc0",
  "backend-source/edge-functions/billing-portal/index.ts": "034834158d539e57397ef895ea954e53e67ce1eae3e1e255f7a53baa48c087ff",
  "backend-source/edge-functions/_shared/stripe-billing.ts": "f35274bc36f859af804adaa7ae15441260eca6ac6bb07511b5a0d7888888c23d",
  "backend-source/edge-functions/_shared/commercial-access.ts": "99ee49c8290b80329691705d7db7ec87deebb9b3f721636dd70a39d60f827716",
  "supabase/functions/telegram-webhook/index.ts": "a848a52168c0814974df55bb1d3fc2fed694d1cd714411c0a27608147921da2b",
  "src/components/cartel/BillingSection.tsx": "e1053cb09c2a1899bdb7b0e3be52fb1258baac9a334c67307bd42bb8b4218d5a",
  "src/lib/pcart-rehearsal.ts": "ecfd944c44b722b86cba96104ab181f78e1b985f4632f1860d2609ebd70878b7",
  "src/lib/liquidity-plan.ts": "c5b8234aaeb41330a5f821883279cee58c574f922683500217009a374b8df7e3",
  "src/lib/chain-launcher.ts": "a6b49c39317b5e0c30113843541c9a5a6b01a333930115f7671919108800be80",
  "src/lib/chain-mainnet-registry.ts": "43d50eae583f7cf677331863c581086b520124dc209cd2571b0ec7c4564d2690",
  "supabase/migrations/20260924021801_e48c0c41-9053-4f77-a267-04fbba8d206d.sql": "b943d99ddb1fe76b611ec61f5275824d1fed8f3dc4e3a4e56c9adc84d571a183",
  "supabase/migrations/20260927170206_commercial_c1_pro_provider_safety_ceilings.sql": "a7984ec9719077ce61fea3045562432be9cd22375dcb830a99477783eb966d59",
  "supabase/migrations/20260927173127_commercial_c3a_usage_free_record_fix.sql": "bec2390ffb20a53e1051ec6dc56370a3764113d0501125b130f5e6316c23cee2",
};
for (const [p, h] of Object.entries(PROTECTED)) check(`P-11 ${p} unchanged`, sha(p) === h);

/* 12. Owner bypass ordering unchanged + untouched by staged SQL */
const billing = read("supabase/migrations/20260924021801_e48c0c41-9053-4f77-a267-04fbba8d206d.sql");
const iB = billing.indexOf("IF public.has_platform_unrestricted_access(v_effective) THEN");
const iM = billing.indexOf("IF NOT public.is_workspace_member(", iB - 2000);
check("P-12.1 unrestricted bypass precedes member check", iB > 0 && iM > iB);
check("P-12.2 staged SQL does not redefine commercial authority", !/FUNCTION public\.(evaluate_commercial_access|has_platform_unrestricted_access|is_platform_owner|handle_new_workspace|apply_stripe_subscription_state)\(/.test(N));
check("P-12.3 no migration file for partner program yet", !read("scripts/commercial-billing-regression.ts").includes("partner_program"));

console.log(`partner-program-1a-regression: ${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
