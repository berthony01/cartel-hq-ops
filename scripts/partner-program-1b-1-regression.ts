/**
 * PARTNER PROGRAM PHASE 1B-1 — static + pure-logic regression.
 * Zero network, zero database.
 */
import { readFileSync, readdirSync } from "node:fs";
import {
  activationConfirmPhrase, canActivatePolicy, findPlaceholders, policyContent,
  POLICY_DRAFTS, POLICY_TYPES, REQUIRED_PLACEHOLDERS,
} from "../src/lib/legal-policies";

let passed = 0, failed = 0;
const check = (id: string, ok: boolean, d = "") => { if (ok) passed++; else { failed++; console.error(`FAIL ${id}${d ? ` — ${d}` : ""}`); } };
const read = (p: string) => readFileSync(p, "utf8");

/* 1. Drafts & placeholders */
const all = POLICY_TYPES.map((t) => policyContent(POLICY_DRAFTS[t])).join("\n");
for (const p of REQUIRED_PLACEHOLDERS) check(`L-1 placeholder ${p} present`, all.includes(p));
for (const t of POLICY_TYPES) check(`L-2 ${t} activation blocked while placeholders remain`, !canActivatePolicy(policyContent(POLICY_DRAFTS[t])));
check("L-3 placeholder-free text activatable", canActivatePolicy("Clean text with no brackets."));
check("L-4 detects arbitrary placeholder", findPlaceholders("x [FOO BAR] y").length === 1);
check("L-5 confirm phrase exact", activationConfirmPhrase("terms", 2) === "ACTIVATE TERMS V2");
check("L-6 no Cartel HQ as legal entity", !/CARTEL HQ,? (LLC|Inc|Ltd|Corp)/i.test(all));
const refunds = policyContent(POLICY_DRAFTS.refunds);
check("L-7 refund rules", /duplicate/.test(refunds) && /unauthorized/.test(refunds) && /required by applicable law/.test(refunds) && /fails to provide the purchased access/.test(refunds) && /end of the current billing period/.test(refunds) && /no prorated refunds or credits/.test(refunds) && /precedent/.test(refunds));
const terms = policyContent(POLICY_DRAFTS.terms);
check("L-8 no advice/safety/uptime disclaimers", /financial, investment, legal, tax/.test(terms) && /safety/.test(terms) && /liquidity/.test(terms) && /uptime/.test(terms) && /private keys/.test(terms) && /own terms and data practices/.test(terms));
check("L-9 pricing unchanged $49", /USD \$49 per month per workspace/.test(terms));
const privacy = policyContent(POLICY_DRAFTS.privacy);
check("L-10 privacy: no unverified no-sell claim", !/we do not (sell|share)/i.test(privacy));
check("L-11 privacy covers required topics", ["Categories","Purposes","processors","International","local storage","Security","Retention","rights"].every((k) => privacy.toLowerCase().includes(k.toLowerCase())));
check("L-12 privacy: no IP for referral", /do not collect IP addresses/.test(privacy));
const pa = policyContent(POLICY_DRAFTS.partner_agreement);
for (const [k, re] of Object.entries({
  approval: /application and written approval/, firstValid: /first valid attribution wins/, window: /30 days/,
  rate: /20% of qualifying revenue/, cap: /first 12 successfully paid/, hold: /45 days/, min: /USD \$50/,
  manual: /reviewed and paid manually/, selfRef: /self-referral/, cookie: /cookie stuffing/, spam: /spam/,
  brand: /brand terms/, ftc: /FTC/, excl: /sales tax, discounts, credits, refunds, chargebacks\/disputes and setup or service fees/,
  procFees: /Processor fees do not reduce/, w9: /W-9/, noTin: /does not collect or store taxpayer identification/,
  negCarry: /negative balance that carries forward/, contractor: /independent contractor/, indemn: /indemnify/,
  svcZero: /earn no CARTEL HQ commission unless separately approved/, law: /\[GOVERNING LAW\]/,
})) check(`L-13 partner agreement: ${k}`, re.test(pa));

/* 2. Routes, footer, consent */
for (const f of ["legal.terms","legal.privacy","legal.refunds","legal.partner-agreement"]) {
  const src = read(`src/routes/${f}.tsx`);
  check(`R-1 ${f} route + head`, /createFileRoute\("\/legal\//.test(src) && /og:title/.test(src) && /twitter:card/.test(src));
}
const page = read("src/components/cartel/LegalDocumentPage.tsx");
check("R-2 draft banner fail-closed", /Draft — not effective/.test(page) && /!effective \|\| placeholders.length > 0/.test(page));
check("R-3 footer on home/auth/shell", ["src/routes/index.tsx","src/routes/auth.tsx","src/components/cartel/AppShell.tsx"].every((p) => read(p).includes("<LegalFooter")));
check("R-4 footer accessible nav", /aria-label="Legal"/.test(read("src/components/cartel/LegalFooter.tsx")));
const auth = read("src/routes/auth.tsx");
check("R-5 signup blocked without consent", /disabled=\{busy \|\| \(isSignup && !consent\)\}/.test(auth) && /if \(!consent\) throw/.test(auth));
check("R-6 auth ref capture preserved", /storeReferralCode\(search\.ref\)/.test(auth) && /safeRedirect/.test(auth));
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
