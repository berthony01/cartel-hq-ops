/**
 * PARTNER PROGRAM PHASE 1B-1 — static + pure-logic regression.
 * Zero network, zero database.
 */
import { readFileSync, readdirSync } from "node:fs";
import {
  activationConfirmPhrase, canActivatePolicy, findPlaceholders, policyContent,
  POLICY_DRAFTS, POLICY_TYPES, REQUIRED_PLACEHOLDERS,
  DORMANT_AFFILIATE_AGREEMENT_DRAFT,
} from "../src/lib/legal-policies";

let passed = 0, failed = 0;
const check = (id: string, ok: boolean, d = "") => { if (ok) passed++; else { failed++; console.error(`FAIL ${id}${d ? ` — ${d}` : ""}`); } };
const read = (p: string) => readFileSync(p, "utf8");

/* 1. Drafts, confirmed identity and policy terms */
const all = POLICY_TYPES.map((t) => policyContent(POLICY_DRAFTS[t])).join("\n");
check("L-1 known placeholder list cleared", REQUIRED_PLACEHOLDERS.length === 0);
for (const t of POLICY_TYPES) check(`L-2 ${t} has no unresolved placeholders`, canActivatePolicy(policyContent(POLICY_DRAFTS[t])) && findPlaceholders(policyContent(POLICY_DRAFTS[t])).length === 0);
check("L-3 activation remains fail closed", !canActivatePolicy("Unresolved [LEGAL FIELD].") && canActivatePolicy("Clean text with no brackets."));
check("L-4 detects arbitrary placeholder", findPlaceholders("x [FOO BAR] y").length === 1);
check("L-5 confirm phrase exact", activationConfirmPhrase("terms", 2) === "ACTIVATE TERMS V2");
check("L-6 exact operator + Texas sole proprietor", /Berthony Petit Frere/.test(all) && /individual operating as a Texas sole proprietor/.test(all));
check("L-6a brands are not legal entities or registered DBAs", /Pepe Cartel and CARTEL HQ are brand and product names/.test(all) && /not separate legal entities or registered DBAs/.test(all));
check("L-6b no LLC/corporation claim", !/Berthony Petit Frere[^\n]*(LLC|Inc\.?|Ltd\.?|Corporation)|(?:Pepe Cartel|CARTEL HQ)[^\n]*(LLC|Inc\.?|Ltd\.?|Corporation)/i.test(all));
check("L-6c limited U.S. beta", /limited United States beta/.test(all) && !/worldwide availability/i.test(all));
check("L-6d exact support and legal contacts", /support@pepecartelhq\.com/.test(all) && /legal@pepecartelhq\.com/.test(all));
check("L-6e no mailing address", !/mailing address|postal address/i.test(all));
check("L-6f Texas dispute process", /laws of the State of Texas/.test(all) && /30 days for a good-faith informal resolution process/.test(all) && /court of competent jurisdiction in Texas/.test(all) && !/mandatory arbitration|class-action waiver/i.test(all));
const refunds = policyContent(POLICY_DRAFTS.refunds);
check("L-7 refund rules", /duplicate/.test(refunds) && /unauthorized/.test(refunds) && /required by applicable law/.test(refunds) && /fails to provide the purchased access after notice and a reasonable opportunity to cure/.test(refunds) && /end of the current billing period/.test(refunds) && /no prorated refunds or credits/.test(refunds) && /precedent/.test(refunds) && /support@pepecartelhq\.com/.test(refunds));
const terms = policyContent(POLICY_DRAFTS.terms);
check("L-8 no advice/safety/uptime disclaimers", /financial, investment, legal, tax/.test(terms) && /safety/.test(terms) && /liquidity/.test(terms) && /uptime/.test(terms) && /private keys/.test(terms) && /own terms and data practices/.test(terms));
check("L-9 pricing unchanged $49", /USD \$49 per month per workspace/.test(terms));
check("L-9a 12-month liability lookback + non-waivable limits", /during the 12 months before the claim/.test(terms) && /where applicable law does not permit them/.test(terms));
const privacy = policyContent(POLICY_DRAFTS.privacy);
check("L-10 privacy: no unverified no-sell claim", !/we do not (sell|share)/i.test(privacy));
check("L-11 privacy covers required topics", ["Categories","Purposes","processors","International","local storage","Security","Retention","rights","Supabase","Lovable","Resend","Stripe","Telegram","X","AI providers"].every((k) => privacy.toLowerCase().includes(k.toLowerCase())));
check("L-12 privacy: no IP for referral", /do not collect IP addresses/.test(privacy));
check("L-12a privacy makes no unenforced deletion deadline", /do not promise a fixed deletion deadline/.test(privacy));
const pa = policyContent(DORMANT_AFFILIATE_AGREEMENT_DRAFT); // dormant Affiliate terms preserved (not published)
const spa = policyContent(POLICY_DRAFTS.partner_agreement);
for (const [k, re] of Object.entries({
  operator: /Berthony Petit Frere/, soleProp: /Texas sole proprietor/, brand: /brand and product names/, usBeta: /United States beta/,
  noFee: /no fee to apply or to be approved/i, noPurchase: /no CARTEL HQ purchase is required for approval/, independent: /independent business/,
  noEmployment: /employment, agency, legal partnership, joint venture, franchise or fiduciary/, noPay: /does not pay Service Partners/,
  noLeads: /lead, client, sales territory or earnings guarantee/, direct: /pays the Operator directly/, noResell: /may not resell, sublicense, bundle, mark up/,
  claims: /investment returns, token safety, token price, guaranteed results or earnings/, disclosure: /Independent CARTEL HQ Service Partner\. Services are provided by/,
  seed: /seed phrases or private keys/, noAccess: /grants no access to any client workspace/, brandStop: /stop using CARTEL HQ brand assets/,
  indemn: /indemnify/, law: /laws of the State of Texas/, notice: /30 days/, versions: /specific agreement version/, jurisdiction: /not a promise that every jurisdiction permits every service/,
})) check(`L-16 service partner agreement: ${k}`, re.test(spa));
check("L-17 service agreement has no affiliate economics", !/20%|commission is|held for 45|minimum payout|referral link/i.test(spa));
for (const [k, re] of Object.entries({
  approval: /application and written approval/, firstValid: /first valid attribution wins/, window: /30 days/,
  rate: /20% of qualifying revenue/, cap: /first 12 successfully paid/, hold: /45 days/, min: /USD \$50/,
  manual: /reviewed and paid manually/, selfRef: /self-referral/, cookie: /cookie stuffing/, spam: /spam/,
  brand: /brand terms/, ftc: /FTC/, excl: /sales tax, discounts, credits, refunds, chargebacks\/disputes and setup or service fees/,
  procFees: /Processor fees do not reduce/, w9: /W-9/, noTin: /does not collect or store taxpayer identification/,
  negCarry: /negative balance that carries forward/, contractor: /independent contractor/, indemn: /indemnify/,
  svcZero: /earn no CARTEL HQ commission unless separately approved/, law: /laws of the State of Texas/,
})) check(`L-13 partner agreement: ${k}`, re.test(pa));
check("L-14 exact partner economics", /20% of qualifying revenue/.test(pa) && /first 12 successfully paid monthly invoices/.test(pa) && /attribution window of 30 days/.test(pa) && /held for 45 days/.test(pa) && /minimum payout is USD \$50/.test(pa) && /paid manually/.test(pa));
check("L-15 source drafts make no effective/active claim", !/these documents are effective|these terms are active|status:\s*active/i.test(all));

/* 2. Routes, footer, consent */
for (const f of ["legal.terms","legal.privacy","legal.refunds","legal.partner-agreement"]) {
  const src = read(`src/routes/${f}.tsx`);
  check(`R-1 ${f} route + head`, /createFileRoute\("\/legal\//.test(src) && /og:title/.test(src) && /twitter:card/.test(src));
}
const page = read("src/components/cartel/LegalDocumentPage.tsx");
check("R-2 draft banner fail-closed", /Draft — not effective/.test(page) && /!effective \|\| placeholders.length > 0/.test(page));
check("R-3 footer on home/auth/shell", ["src/routes/index.tsx","src/routes/auth.tsx","src/components/cartel/AppShell.tsx"].every((p) => read(p).includes("<LegalFooter")));
const LF = read("src/components/cartel/LegalFooter.tsx");
check("R-4 footer accessible nav + public discovery links", /aria-label="CARTEL HQ information and legal"/.test(LF) && ["/legal/terms","/legal/privacy","/legal/refunds","/legal/partner-agreement","/docs","/partner-program"].every((to) => LF.includes(`to: "${to}"`)));
const auth = read("src/routes/auth.tsx");
check("R-5 signup blocked without consent", /disabled=\{busy \|\| \(isSignup && !consent\)\}/.test(auth) && /if \(!consent\) throw/.test(auth));
check("R-6 auth ref capture preserved (1B-2 token exchange)", /captureReferralCode\(search\.ref\)/.test(auth) && /safeRedirect/.test(auth));
const bill = read("src/components/cartel/BillingSection.tsx");
check("R-7 checkout blocked without consent", /disabled=\{busy !== null \|\| !checkoutConsent\}/.test(bill) && /if \(!checkoutConsent\) return/.test(bill));
check("R-8 checkout records effective acceptance fail-closed", /recordAcceptances\(await fetchActivePolicies\(\), "checkout"\)/.test(bill) && /return;\s*\}\s*await invoke/.test(bill));
check("R-9 owner billing unchanged", /Platform Owner — Unrestricted/.test(bill));
const acc = read("src/lib/policy-acceptance.ts");
check("R-10 acceptance fields only; no IP", /document_type/.test(acc) && /content_hash/.test(acc) && /_source/.test(acc) && !/\bip\b|user_agent|fingerprint/i.test(acc.replace(/Never IP/, "")));
check("R-11 reads fail closed to []", (acc.match(/return error \? \[\] :/g) ?? []).length === 2);
const admin = read("src/components/cartel/PolicyAdminSection.tsx");
check("R-12 activation disabled in preview + owner gate", /<Button disabled/.test(admin) && /isPlatformOwner !== true\) return null/.test(admin));
check("R-13 admin mounted", read("src/routes/_authenticated/admin.tsx").includes("<PolicyAdminSection />"));

/* 3. Stripe consent flag */
const co = read("backend-source/edge-functions/billing-checkout/index.ts");
check("S-1 consent flag default off", /Deno\.env\.get\("CARTEL_HQ_STRIPE_TERMS_CONSENT_ENABLED"\) === "true"/.test(co) && /tosConsent \? \{ consent_collection/.test(co));
check("S-2 idempotency key varies with flag", /\$\{tosConsent \? ":tos" : ""\}/.test(co));
check("S-3 checkout owner bypass intact", /UNRESTRICTED_NO_BILLING/.test(co) && /\$49|PRO_PLAN_CODE/.test(co));

/* 4. Staged SQL */
const RAW = read("docs/sql/PARTNER_1B_1_policy_acceptance.sql");
const SQL = RAW.replace(/^\s*--.*$/gm, "");
check("Q-1 staged not applied", /STAGED FOR REVIEW ONLY\. NOT APPLIED/.test(RAW));
check("Q-2 not in migrations dir", !readdirSync("supabase/migrations").some((f) => /policy/i.test(f)));
check("Q-3 no DROP/TRUNCATE/DELETE FROM", !/\bDROP\b|\bTRUNCATE\b|\bDELETE\s+FROM\b/i.test(SQL));
check("Q-4 no seed/active insert", (SQL.match(/INSERT INTO public\.policy_documents/g) ?? []).length === 1 && !/'active'\s*\)/.test(SQL.split("INSERT INTO public.policy_documents")[1]!.slice(0, 200)));
check("Q-5 grants precede RLS", SQL.indexOf("GRANT SELECT ON public.policy_documents") < SQL.indexOf("ENABLE ROW LEVEL SECURITY"));
check("Q-6 RLS on both tables", (SQL.match(/ENABLE ROW LEVEL SECURITY/g) ?? []).length === 2);
check("Q-7 no IP column", !/\bip\b|inet|user_agent|fingerprint/i.test(SQL));
check("Q-8 activation checks owner, phrase, placeholders", /owner_activate_policy_version[\s\S]*PLATFORM_OWNER_REQUIRED[\s\S]*CONFIRMATION_MISMATCH[\s\S]*POLICY_PLACEHOLDERS_REMAIN/.test(SQL));
check("Q-9 security definer fns pin search_path", (SQL.match(/SECURITY DEFINER/g) ?? []).length === (SQL.match(/SECURITY DEFINER SET search_path = public/g) ?? []).length);
check("Q-10 acceptance uses auth.uid + effective version only", /record_policy_acceptances[\s\S]*auth\.uid\(\)[\s\S]*POLICY_VERSION_NOT_EFFECTIVE/.test(SQL));
check("Q-11 acceptances immutable", /POLICY_ACCEPTANCE_IMMUTABLE/.test(SQL) && /policy_acceptances_immutable BEFORE UPDATE OR DELETE/.test(SQL));
check("Q-12 one active per type", /policy_documents_one_active[\s\S]*WHERE status = 'active'/.test(SQL));
check("Q-13 PUBLIC/anon revoked on writes", /REVOKE ALL ON FUNCTION public\.record_policy_acceptances\(jsonb, text\) FROM PUBLIC, anon/.test(SQL) && /REVOKE ALL ON FUNCTION public\.owner_activate_policy_version\(text, integer, text\) FROM PUBLIC, anon/.test(SQL));
check("Q-14 owner authority reused", /public\.is_platform_owner\(/.test(SQL) && !/berthonyxyz/i.test(SQL));

/* 5. Acceptance versioning simulation (mirrors get_my_pending_policy_acceptances) */
type V = { t: string; v: number };
const pending = (active: V[], accepted: V[]) => active.filter((a) => !accepted.some((x) => x.t === a.t && x.v === a.v));
check("V-1 no active => no prompt", pending([], []).length === 0);
check("V-2 accepted v1 => no prompt", pending([{ t: "terms", v: 1 }], [{ t: "terms", v: 1 }]).length === 0);
check("V-3 new v2 => prompt", pending([{ t: "terms", v: 2 }], [{ t: "terms", v: 1 }]).length === 1);

console.log(`Partner 1B-1 regression: ${passed} passed, ${failed} failed`);
if (failed) process.exit(1);
