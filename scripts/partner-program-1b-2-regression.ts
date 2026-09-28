/**
 * PARTNER PROGRAM PHASE 1B-2 — referral click token integrity regression.
 * Zero network, zero database. Static SQL/source checks + a deterministic
 * in-memory model mirroring partner_issue_referral_click / claim_referral_click.
 */
import { readFileSync, readdirSync } from "node:fs";
import { createHash } from "node:crypto";
import {
  ALLOWED_ORIGINS, captureCorsHeaders, isValidReferralCode, newReferralToken, REFERRAL_TOKEN_RE, sha256Hex,
} from "../backend-source/edge-functions/partner-referral-capture/logic";

let passed = 0, failed = 0;
const check = (id: string, ok: boolean, d = "") => { if (ok) passed++; else { failed++; console.error(`FAIL ${id}${d ? ` — ${d}` : ""}`); } };
const read = (p: string) => readFileSync(p, "utf8");

const RAW = read("docs/sql/PARTNER_1B_2_referral_click_tokens.sql");
const SQL = RAW.replace(/^\s*--.*$/gm, "");
const N = SQL.replace(/\s+/g, " ");
const fn = (name: string) => { const i = N.indexOf(`FUNCTION public.${name}(`); const j = N.indexOf("END $$;", i); return i < 0 ? "" : N.slice(i, j); };
const table = N.slice(N.indexOf("CREATE TABLE IF NOT EXISTS public.partner_referral_clicks"), N.indexOf(");", N.indexOf("CREATE TABLE IF NOT EXISTS public.partner_referral_clicks")) + 2);

/* 1. Staging & schema */
check("S-1 staged not applied", /STAGED FOR REVIEW ONLY\. NOT APPLIED/.test(RAW));
check("S-2 not in supabase/migrations", !readdirSync("supabase/migrations").some((f) => /referral_click/i.test(f)));
check("S-3 no DROP/TRUNCATE", !/\bDROP\b|\bTRUNCATE\b/i.test(SQL));
check("S-4 only DELETE is scoped purge", (N.match(/DELETE FROM/g) ?? []).length === 1 && /DELETE FROM public\.partner_referral_clicks WHERE status = 'issued' AND expires_at < now\(\)/.test(N));
check("S-5 hash-only: token_hash 64-hex, no raw token column", /token_hash text NOT NULL UNIQUE CHECK \(token_hash ~ '\^\[0-9a-f\]\{64\}\$'\)/.test(table) && !/\btoken text\b|raw_token/.test(table));
check("S-6 no PII columns", !/\bip\b|inet|user_agent|fingerprint|email|device/i.test(table));
check("S-7 partner + snapshotted terms FKs", /partner_id uuid NOT NULL REFERENCES public\.partners\(id\)/.test(table) && /terms_version integer NOT NULL REFERENCES public\.partner_program_terms\(version\)/.test(table));
check("S-8 server timestamps + expiry constraint", /created_at timestamptz NOT NULL DEFAULT now\(\)/.test(table) && /expires_at > created_at/.test(table));
check("S-9 claim shape constraint", /status = 'issued' AND claimed_by IS NULL AND claimed_at IS NULL/.test(table));
check("S-10 cleanup + rate-limit indexes", /unclaimed_expiry_idx ON public\.partner_referral_clicks \(expires_at\) WHERE status = 'issued'/.test(N) && /\(partner_id, created_at\)/.test(N));
check("S-11 RLS on, zero policies", /partner_referral_clicks ENABLE ROW LEVEL SECURITY/.test(N) && !/CREATE POLICY/.test(N));
check("S-12 table revoked from clients, service_role only", /REVOKE ALL ON public\.partner_referral_clicks FROM PUBLIC, anon, authenticated/.test(N) && /GRANT ALL ON public\.partner_referral_clicks TO service_role/.test(N) && !/GRANT [A-Z, ]+ ON public\.partner_referral_clicks TO (anon|authenticated)/.test(N));

/* 2. Functions */
const issue = fn("partner_issue_referral_click"), claim = fn("claim_referral_click"), purge = fn("partner_purge_expired_referral_clicks");
for (const [n, b] of [["issue", issue], ["claim", claim], ["purge", purge]] as const) check(`F-1 ${n} SECURITY DEFINER pinned search_path`, /SECURITY DEFINER SET search_path = ''/.test(b));
check("F-2 issuance service_role only (grant + runtime check)", /auth\.role\(\), ''\) <> 'service_role'/.test(issue) && /REVOKE ALL ON FUNCTION public\.partner_issue_referral_click\(text, text\) FROM PUBLIC, anon, authenticated/.test(N) && /GRANT EXECUTE ON FUNCTION public\.partner_issue_referral_click\(text, text\) TO service_role/.test(N));
check("F-3 issuance requires approved affiliate + active terms", /status = 'approved' AND is_affiliate AND approved_at IS NOT NULL/.test(issue) && /partner_active_terms\(\)/.test(issue));
check("F-4 issuance returns uniform shape (no reason leak)", !/'reason'/.test(issue));
check("F-5 per-code bucket, no IP", /count\(\*\)[^;]*partner_id = v_p\.id AND created_at > now\(\) - interval '1 hour'/.test(issue) && /v_recent >= 300/.test(issue));
check("F-6 expiry from snapshotted window, server time", /v_exp := now\(\) \+ make_interval\(days => v_t\.attribution_window_days\)/.test(issue));
check("F-7 claim uses auth.uid() + server hash", /v_uid uuid := auth\.uid\(\)/.test(claim) && /sha256\(convert_to\(_token, 'UTF8'\)\)/.test(claim) && !/_captured|_timestamp|_attributed_at/.test(claim));
check("F-8 claim atomic single-use", /UPDATE public\.partner_referral_clicks SET status = 'claimed', claimed_by = v_uid, claimed_at = now\(\) WHERE token_hash = v_hash AND status = 'issued' AND expires_at > now\(\) RETURNING/.test(claim));
check("F-9 claim generic TOKEN_INVALID for bad/expired/claimed", (claim.match(/'TOKEN_INVALID'/g) ?? []).length === 2);
check("F-10 claim rejects self + inactive/non-affiliate", /v_p\.user_id = v_uid/.test(claim) && /'SELF_REFERRAL'/.test(claim) && /v_p\.status <> 'approved' OR NOT v_p\.is_affiliate/.test(claim));
check("F-11 attributed_at = server click time", /attributed_at\) VALUES \(v_p\.id, v_uid, v_c\.terms_version, 'link', v_c\.created_at\)/.test(claim));
check("F-12 first-valid-wins pre-check + conflict", claim.indexOf("already_attributed', true") < claim.indexOf("UPDATE public.partner_referral_clicks") && /ON CONFLICT \(referred_user_id\) WHERE status IN \('pending','qualified'\) DO NOTHING/.test(claim));
check("F-13 claim executable only by authenticated", /REVOKE ALL ON FUNCTION public\.claim_referral_click\(text\) FROM PUBLIC, anon/.test(N) && /GRANT EXECUTE ON FUNCTION public\.claim_referral_click\(text\) TO authenticated/.test(N));
check("F-14 legacy record_referral_attribution fully revoked", /REVOKE ALL ON FUNCTION public\.record_referral_attribution\(text, text\) FROM PUBLIC, anon, authenticated/.test(N) && !/GRANT EXECUTE ON FUNCTION public\.record_referral_attribution/.test(N));
check("F-15 bind_referral_to_workspace untouched", !/bind_referral_to_workspace\(/.test(SQL));
check("F-16 no commercial/owner gate changes", !/is_platform_owner|has_platform_unrestricted_access|commercial_|workspace_members/.test(SQL));

/* 3. Capture edge source */
const EDGE = read("backend-source/edge-functions/partner-referral-capture/index.ts");
check("E-1 source only, documented pre-auth", /NOT DEPLOYED/.test(EDGE) && /verify_jwt=false ONLY because/.test(EDGE));
check("E-2 not added to supabase/config.toml", !/partner-referral-capture/.test(read("supabase/config.toml")));
check("E-3 uniform response for any valid-format code", (EDGE.match(/return json\(\{ token, expiresAt \}\)/g) ?? []).length === 1 && !/issued === false|not found|inactive/i.test(EDGE.replace(/\/\*[\s\S]*?\*\//, "")));
check("E-4 no token/code/IP in logs", !/console\.\w+\([^)]*(token|code|x-forwarded|cf-connecting)/i.test(EDGE) && !/x-forwarded-for|cf-connecting-ip|user-agent/i.test(EDGE));
check("E-5 body size bounded", /raw\.length > 256/.test(EDGE));
check("E-6 persists only hash", /_token_hash: await sha256Hex\(token\)/.test(EDGE) && !/_token:/.test(EDGE));
check("E-7 no secrets in source", !/sk_live|sk_test|eyJhbGci/.test(EDGE));

check("C-1 allowlist exactly two origins", ALLOWED_ORIGINS.length === 2 && ALLOWED_ORIGINS.includes("https://pepecartelhq.com") && ALLOWED_ORIGINS.every((o) => o.startsWith("https://")));
check("C-2 allowed origin echoed", captureCorsHeaders("https://pepecartelhq.com")["Access-Control-Allow-Origin"] === "https://pepecartelhq.com");
for (const bad of ["https://evil.com", "http://pepecartelhq.com", "https://pepecartelhq.com.evil.com", "null", ""]) check(`C-3 rejects origin ${bad || "(empty)"}`, !captureCorsHeaders(bad || null)["Access-Control-Allow-Origin"]);
check("C-4 never wildcard", !/Allow-Origin": "\*"/.test(read("backend-source/edge-functions/partner-referral-capture/logic.ts")));

/* 4. Code normalization & token entropy */
check("N-1 valid lower", isValidReferralCode("abcd123456"));
check("N-2 valid upper normalized", isValidReferralCode("ABCD123456"));
for (const bad of ["abc", "abcd1234567", "abcd-12345", "abcd 12345x", 42, null, "ábcd123456"]) check(`N-3 rejects ${String(bad)}`, !isValidReferralCode(bad));
const toks = Array.from({ length: 2000 }, () => newReferralToken());
check("T-1 token format 43 base64url", toks.every((t) => REFERRAL_TOKEN_RE.test(t)));
check("T-2 no collisions in 2000", new Set(toks).size === toks.length);
check("T-3 256-bit source", /new Uint8Array\(32\)/.test(read("backend-source/edge-functions/partner-referral-capture/logic.ts")) && /crypto\.getRandomValues/.test(read("backend-source/edge-functions/partner-referral-capture/logic.ts")));
const t0 = toks[0]!;
check("T-4 edge hash == SQL sha256(utf8) hex", (await sha256Hex(t0)) === createHash("sha256").update(t0, "utf8").digest("hex"));

/* 5. Browser flow */
const LIB = read("src/lib/partners.ts");
const refSec = LIB.slice(LIB.indexOf("/* ---------------- Referral capture (Phase 1B-2)"), LIB.indexOf("export type BindResult"));
const refCode = refSec.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*$/gm, "");
check("B-1 stores only {token, expiresAt}", /JSON\.stringify\(\{ token: parsed\.token, expiresAt: parsed\.expiresAt \}\)/.test(refCode));
check("B-2 no client capturedAt authority", !/capturedAt|new Date\(\)\.toISOString/.test(refCode));
check("B-3 no PII in storage", !/partner_id|\bip\b|fingerprint|userAgent|email/i.test(refCode));
check("B-4 legacy code key purged", /LEGACY_REFERRAL_STORAGE_KEY = "cartel-hq:referral"/.test(refSec) && (refCode.match(/purgeLegacyReferral\(\)/g) ?? []).length >= 3);
check("B-5 expired/malformed tokens discarded", /exp <= now\) return null/.test(refCode) && /store\.removeItem\(REFERRAL_TOKEN_STORAGE_KEY\)/.test(refCode));
check("B-6 claim uses claim_referral_click, not legacy", /"claim_referral_click", \{ _token: stored\.token \}/.test(refCode) && !/record_referral_attribution/.test(LIB));
check("B-7 keep on error, clear on definitive", /if \(!res \|\| res\.error\) return "keep"/.test(refCode) && /data\.ok === true \? "claimed" : "cleared"/.test(refCode) && /if \(outcome !== "keep"\) clearStoredReferralToken\(\)/.test(refCode));
check("B-8 existing token kept (local first-valid)", /if \(readStoredReferralToken\(\)\) return false;/.test(refCode));
const AUTH = read("src/routes/auth.tsx");
check("B-9 auth exchanges code for token", /captureReferralCode\(search\.ref\)/.test(AUTH) && !/storeReferralCode/.test(AUTH) && /normalizeReferralCode\(search\['ref'\]\)/.test(AUTH));
check("B-10 redirect safety preserved", /function safeRedirect/.test(AUTH) && /value\.startsWith\("\/\/"\)/.test(AUTH));
const BR = read("src/components/cartel/ReferralAttributionBridge.tsx");
check("B-11 bridge claims token then binds only owned workspace", /await claimStoredReferralToken\(\)/.test(BR) && /workspace\.owner_id !== userId/.test(BR) && /bindReferralToWorkspace\(workspace\.id\)/.test(BR));
check("B-12 bridge in authenticated layout (callback + later sign-in)", read("src/routes/_authenticated/route.tsx").includes("ReferralAttributionBridge"));

/* 6. Deterministic model of the SQL semantics */
type Click = { hash: string; partner: string; terms: number; status: "issued" | "claimed" | "rejected"; created: number; expires: number; claimedBy?: string };
type Partner = { id: string; user: string; code: string; approved: boolean; affiliate: boolean };
function makeDb(partners: Partner[], termsActive = true, windowDays = 30) {
  const clicks = new Map<string, Click>(); const referrals: { user: string; partner: string; at: number }[] = [];
  const hash = (t: string) => createHash("sha256").update(t, "utf8").digest("hex");
  return {
    clicks, referrals,
    issue(code: string, token: string, now: number) {
      const c = code.trim().toLowerCase(); if (!/^[a-z0-9]{10}$/.test(c) || !termsActive) return { issued: false };
      const p = partners.find((x) => x.code === c && x.approved && x.affiliate); if (!p) return { issued: false };
      const recent = [...clicks.values()].filter((k) => k.partner === p.id && k.created > now - 3600e3).length; if (recent >= 300) return { issued: false };
      const h = hash(token); if (clicks.has(h)) return { issued: false };
      clicks.set(h, { hash: h, partner: p.id, terms: 1, status: "issued", created: now, expires: now + windowDays * 864e5 });
      return { issued: true };
    },
    claim(uid: string, token: string, now: number, clientTs?: number) {
      void clientTs; // never used: server time only
      if (!/^[A-Za-z0-9_-]{43}$/.test(token)) return { ok: false, reason: "TOKEN_INVALID" };
      if (referrals.some((r) => r.user === uid)) return { ok: true, already: true };
      const k = clicks.get(hash(token)); if (!k || k.status !== "issued" || k.expires <= now) return { ok: false, reason: "TOKEN_INVALID" };
      k.status = "claimed"; k.claimedBy = uid;
      const p = partners.find((x) => x.id === k.partner)!;
      if (!p.approved || !p.affiliate) { k.status = "rejected"; return { ok: false, reason: "REFERRAL_NOT_ACTIVE" }; }
      if (p.user === uid) { k.status = "rejected"; return { ok: false, reason: "SELF_REFERRAL" }; }
      if (referrals.some((r) => r.user === uid)) { k.status = "rejected"; return { ok: true, already: true }; }
      referrals.push({ user: uid, partner: p.id, at: k.created });
      return { ok: true, already: false };
    },
  };
}
const P1: Partner = { id: "p1", user: "u-p1", code: "aaaaa11111", approved: true, affiliate: true };
const P2: Partner = { id: "p2", user: "u-p2", code: "bbbbb22222", approved: true, affiliate: true };
const SVC: Partner = { id: "p3", user: "u-p3", code: "ccccc33333", approved: true, affiliate: false };
const now = 1_800_000_000_000;
{
  const db = makeDb([P1, P2, SVC]); const t = newReferralToken();
  check("M-1 issue valid", db.issue("AAAAA11111", t, now).issued);
  check("M-2 stored value is hash only", [...db.clicks.keys()].every((k) => /^[0-9a-f]{64}$/.test(k) && k !== t));
  check("M-3 unknown code: same uniform shape", JSON.stringify(Object.keys(db.issue("zzzzz99999", newReferralToken(), now))) === JSON.stringify(Object.keys(db.issue("aaaaa11111", newReferralToken(), now))));
  check("M-4 service-only partner cannot issue", !db.issue("ccccc33333", newReferralToken(), now).issued);
  const r = db.claim("u-new", t, now + 1000, now - 999e9);
  check("M-5 claim ok", r.ok && r.already === false);
  check("M-6 attribution time = server click time, not client", db.referrals[0]!.at === now);
  check("M-7 token single-use (claimed)", db.claim("u-other", t, now + 2000).reason === "TOKEN_INVALID");
  const t2 = newReferralToken(); db.issue("bbbbb22222", t2, now);
  check("M-8 first-valid-wins: second partner never overwrites", db.claim("u-new", t2, now + 3000).already === true && db.referrals.length === 1 && db.referrals[0]!.partner === "p1");
  check("M-9 losing token stays unclaimed", db.clicks.get(createHash("sha256").update(t2).digest("hex"))!.status === "issued");
}
{
  const db = makeDb([P1]); const t = newReferralToken(); db.issue("aaaaa11111", t, now);
  check("M-10 stale token rejected", db.claim("u-x", t, now + 31 * 864e5).reason === "TOKEN_INVALID");
  const t2 = newReferralToken(); db.issue("aaaaa11111", t2, now);
  check("M-11 self-referral rejected", db.claim("u-p1", t2, now + 1).reason === "SELF_REFERRAL" && db.referrals.length === 0);
  check("M-12 malformed token generic", db.claim("u-x", "short", now).reason === "TOKEN_INVALID");
}
{
  const p = { ...P1 }; const db = makeDb([p]); const t = newReferralToken(); db.issue("aaaaa11111", t, now);
  p.approved = false;
  check("M-13 partner suspended after click: rejected", db.claim("u-x", t, now + 1).reason === "REFERRAL_NOT_ACTIVE");
  check("M-14 program closed: no issuance", !makeDb([P1], false).issue("aaaaa11111", newReferralToken(), now).issued);
}
{
  const db = makeDb([P1]); const t = newReferralToken(); db.issue("aaaaa11111", t, now);
  const results = [db.claim("u-a", t, now + 1), db.claim("u-b", t, now + 1)];
  check("M-15 concurrent claim: exactly one winner", results.filter((r) => r.ok && r.already === false).length === 1 && db.referrals.length === 1);
}
{
  const db = makeDb([P1]); let issued = 0;
  for (let i = 0; i < 305; i++) if (db.issue("aaaaa11111", newReferralToken(), now + i).issued) issued++;
  check("M-16 per-code bucket caps at 300/hour", issued === 300);
  check("M-17 bucket resets after window", db.issue("aaaaa11111", newReferralToken(), now + 3601e3).issued);
}

/* 7. Preserved invariants */
const BIND = read(readdirSync("supabase/migrations").filter((f) => f.startsWith("20260928170917")).map((f) => `supabase/migrations/${f}`)[0]!);
check("I-1 applied bind still has new-workspace guard", /WORKSPACE_PREDATES_REFERRAL/.test(BIND));
check("I-2 owner bypass untouched in checkout", /UNRESTRICTED_NO_BILLING/.test(read("backend-source/edge-functions/billing-checkout/index.ts")));
check("I-3 owner access helper untouched", /isPlatformOwner/.test(read("src/hooks/usePlatformAccess.ts")));
check("I-4 no stripe/webhook change in this stage", !/claim_referral_click|referral_click/.test(read("backend-source/edge-functions/stripe-billing-webhook/index.ts")));

console.log(`Partner 1B-2 regression: ${passed} passed, ${failed} failed`);
if (failed) process.exit(1);
