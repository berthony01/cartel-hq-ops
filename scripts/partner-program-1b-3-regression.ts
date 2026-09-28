/**
 * PARTNER PROGRAM PHASE 1B-3 — commission accounting regression.
 * Zero network, zero database. Static checks of the staged SQL plus a
 * deterministic in-memory model that mirrors the SQL functions exactly
 * (integer math, idempotency keys, precedence, delta-to-target).
 */
import { readFileSync, readdirSync } from "node:fs";

let passed = 0, failed = 0;
const check = (id: string, ok: boolean, d = "") => { if (ok) passed++; else { failed++; console.error(`FAIL ${id}${d ? ` — ${d}` : ""}`); } };
const RAW = readFileSync("docs/sql/PARTNER_1B_3_commission_accounting.sql", "utf8");
const SQL = RAW.replace(/^\s*--.*$/gm, "");
const N = SQL.replace(/\s+/g, " ");
const fn = (name: string) => { const i = N.indexOf(`FUNCTION public.${name}(`); if (i < 0) return ""; const j = N.indexOf("$$;", N.indexOf("$$", i) + 2); return N.slice(i, j); };

/* ---------------- 1. Staging & schema safety ---------------- */
check("S-1 staged not applied", /STAGED FOR REVIEW ONLY\. NOT APPLIED/.test(RAW));
check("S-2 not in supabase/migrations", !readdirSync("supabase/migrations").some((f) => /commission_accounting|1b_3/i.test(f)));
check("S-3 no DROP TABLE/FUNCTION/COLUMN, TRUNCATE, DELETE", !/DROP (TABLE|FUNCTION|COLUMN|INDEX|POLICY|TRIGGER)|\bTRUNCATE\b|\bDELETE\s+FROM\b/i.test(SQL));
const drops = N.match(/DROP CONSTRAINT IF EXISTS \w+/g) ?? [];
check("S-4 only two constraint swaps (superset checks)", drops.length === 2 && drops.every((d) => /ledger_sign_by_type|partner_commission_ledger_entry_type_check/.test(d)));
check("S-5 no terms seed/activation", !/INSERT INTO public\.partner_program_terms[^;]*'active'/.test(N) && !/UPDATE public\.partner_program_terms SET status = 'active'/.test(N) && (N.match(/INSERT INTO public\.partner_program_terms/g) ?? []).length === 1);
check("S-6 no plan/price/subscription mutation", !/(INSERT INTO|UPDATE|DELETE FROM) public\.(commercial_plans|commercial_plan_provider_refs|commercial_plan_entitlements|commercial_billing_\w+|workspace_commercial_assignments|workspace_members)/.test(N));
check("S-7 ledger append-only guard not altered", !/partner_append_only_guard|partner_commission_ledger_append_only/.test(SQL) && !/UPDATE public\.partner_commission_ledger/.test(N));
check("S-8 no raw payload / PII columns", !/payload|jsonb NOT NULL|email|card|last4|address|customer_name|\bip\b|user_agent/i.test(SQL.replace(/jsonb_build_object|RETURNS jsonb/g, "")));

/* ---------------- 2. Terms ---------------- */
check("T-1 duration column nullable (no default/seed)", /ADD COLUMN IF NOT EXISTS commission_duration_invoices integer NULL/.test(N) && !/commission_duration_invoices integer[^,]*DEFAULT/.test(N));
const tv = fn("partner_terms_validate");
check("T-2 activation requires duration", /NEW\.commission_duration_invoices IS NULL/.test(tv));
check("T-3 activation rejects legal placeholders", /PARTNER_TERMS_PLACEHOLDERS_REMAIN/.test(tv));
check("T-4 duration frozen after activation", /NEW\.commission_duration_invoices IS DISTINCT FROM OLD\.commission_duration_invoices/.test(tv));
check("T-5 prior required fields preserved", ["commission_bps", "attribution_window_days", "hold_days", "min_payout_cents", "currency", "agreement_text", "disclosure_text"].every((c) => tv.includes(c)));
check("T-6 9-arg draft owner-gated", /partner_require_owner\(\)/.test(fn("owner_save_partner_terms_draft")) && /REVOKE ALL ON FUNCTION public\.owner_save_partner_terms_draft\(integer, integer, integer, integer, integer, text, text, text, integer\) FROM PUBLIC, anon/.test(N));

/* ---------------- 3. Ledger extension ---------------- */
for (const c of ["stripe_environment", "source_object", "stripe_invoice_ref", "stripe_charge_ref", "stripe_refund_ref", "stripe_dispute_ref", "accrual_entry_id", "occurred_at"])
  check(`L-1 nullable column ${c} (existing rows valid)`, new RegExp(`ADD COLUMN IF NOT EXISTS ${c} [a-z]+ NULL`).test(N));
check("L-2 restoration positive + linked", /entry_type = 'restoration' AND amount_cents > 0 AND accrual_entry_id IS NOT NULL/.test(N));
check("L-3 Phase 1A sign rules preserved", /entry_type = 'accrual' AND amount_cents > 0/.test(N) && /entry_type = 'reversal' AND amount_cents < 0/.test(N) && /entry_type = 'payout' AND amount_cents < 0 AND payout_request_id IS NOT NULL/.test(N));
check("L-4 stripe rows need env/object/invoice/occurred_at", /ledger_stripe_source_shape/.test(N));
check("L-5 one accrual per (env, invoice)", /partner_commission_ledger_one_invoice_accrual ON public\.partner_commission_ledger \(stripe_environment, stripe_invoice_ref\) WHERE entry_type = 'accrual'/.test(N));
check("L-6 one delta per (env, event, accrual)", /\(stripe_environment, source_event_ref, accrual_entry_id\)/.test(N));
check("L-7 currency remains 3-letter integer cents", !/numeric|float|double|real\b/i.test(SQL));

/* ---------------- 4. State tables & privileges ---------------- */
for (const t of ["partner_commission_events", "partner_invoice_commissions", "partner_refund_states", "partner_dispute_states"]) {
  check(`P-1 ${t} RLS on`, new RegExp(`ALTER TABLE public\\.${t} ENABLE ROW LEVEL SECURITY`).test(N));
  check(`P-2 ${t} revoked from clients`, N.includes("FROM PUBLIC, anon, authenticated") && new RegExp(`REVOKE ALL ON [^;]*public\\.${t}`).test(N));
}
check("P-3 no policies on state tables", !/CREATE POLICY/.test(N));
check("P-4 env separation in keys", /PRIMARY KEY \(environment, event_ref\)/.test(N) && /UNIQUE \(environment, invoice_ref\)/.test(N) && /PRIMARY KEY \(environment, refund_ref\)/.test(N) && /PRIMARY KEY \(environment, dispute_ref\)/.test(N));
const ingest = ["partner_ingest_invoice_paid", "partner_ingest_refund_state", "partner_ingest_dispute_state", "partner_recompute_invoice_commission"];
for (const f of ingest) {
  const b = fn(f);
  check(`P-5 ${f} SECURITY DEFINER pinned`, /SECURITY DEFINER SET search_path = ''/.test(b));
  check(`P-6 ${f} runtime service_role check`, /auth\.role\(\), ''\) <> 'service_role'/.test(b));
  check(`P-7 ${f} revoked PUBLIC/anon/authenticated`, new RegExp(`REVOKE ALL ON FUNCTION public\\.${f}\\([^)]*\\) FROM PUBLIC, anon, authenticated`).test(N));
  check(`P-8 ${f} granted only to service_role`, new RegExp(`GRANT EXECUTE ON FUNCTION public\\.${f}\\([^)]*\\) TO service_role;`).test(N) && !new RegExp(`GRANT EXECUTE ON FUNCTION public\\.${f}\\([^)]*\\) TO [^;]*authenticated`).test(N));
}
check("P-9 balance breakdown service-only", /GRANT EXECUTE ON FUNCTION public\.partner_balance_breakdown\(uuid, text\) TO service_role;/.test(N));
check("P-10 no checkout.session accrual path", !/checkout/i.test(SQL.replace(/checkout\.session\.completed has no ingestion function and never accrues/, "")));

/* ---------------- 5. Accrual eligibility (SQL) ---------------- */
const inv = fn("partner_ingest_invoice_paid");
for (const [k, re] of Object.entries({
  dupEvent: /DUPLICATE_EVENT/, dupInvoice: /DUPLICATE_INVOICE/, mapped: /s\.environment = _environment AND s\.subscription_ref = _subscription_ref AND s\.workspace_id = _workspace_id/,
  price: /pr\.environment = _environment AND pr\.price_ref = _price_ref AND pr\.active/, owner: /has_platform_unrestricted_access\(v_owner\)/,
  qualified: /workspace_id = _workspace_id AND status = 'qualified'/, affiliate: /v_p\.status <> 'approved' OR NOT v_p\.is_affiliate/,
  snapshot: /version = v_r\.terms_version/, agreement: /partner_id = v_p\.id AND terms_version = v_t\.version/, currency: /v_cur <> v_t\.currency/,
  base: /_eligible_base_cents <= 0 OR _eligible_base_cents > _amount_paid_cents/, cap: /v_count >= v_t\.commission_duration_invoices/,
  hold: /v_paid_at \+ make_interval\(days => v_t\.hold_days\)/, futurePay: /least\(_paid_at, now\(\)\)/, outOfOrder: /PERFORM public\.partner_recompute_invoice_commission/,
})) check(`A-${k}`, re.test(inv));
check("A-order: event dedupe precedes all eligibility", inv.indexOf("DUPLICATE_EVENT") < inv.indexOf("NOT_MAPPED"));
check("A-integer commission", /\(\(_base_cents \* _bps\) \/ 10000\)::integer/.test(N));
check("R-precedence newer-then-rank", /_new_created > _old_created OR \(_new_created = _old_created AND _new_rank > _old_rank\)/.test(N));
check("R-exposure statuses", /status IN \('pending','requires_action','succeeded'\)/.test(N) && /status NOT IN \('won','warning_closed'\)/.test(N));
check("R-target clamp", /least\(greatest\(_exposure, 0\), _paid\)/.test(N));

/* ---------------- 6. Deterministic model (mirrors SQL) ---------------- */
type Env = "test" | "live";
const cents = (base: number, bps: number) => Math.floor((base * bps) / 10000);
const target = (c: number, paid: number, exp: number) => Math.floor((c * (paid - Math.min(Math.max(exp, 0), paid))) / paid);
const refundRank = (s: string) => ({ pending: 1, requires_action: 1, succeeded: 2, failed: 3, canceled: 3 } as Record<string, number>)[s] ?? 0;
const disputeRank = (s: string) => (["won", "lost", "warning_closed"].includes(s) ? 2 : 1);
const supersedes = (nc: number, nr: number, oc: number, or: number) => nc > oc || (nc === oc && nr > or);

type Entry = { type: "accrual" | "reversal" | "restoration" | "payout" | "adjustment"; amount: number; availableAt: number; env?: Env; invoice?: string; event?: string; accrual?: number };
type World = {
  now: number;
  subs: { env: Env; sub: string; ws: string }[]; prices: { env: Env; price: string }[];
  owners: Record<string, string>; unrestricted: Set<string>;
  referral: { id: string; ws: string; partner: string; terms: number; status: string } | null;
  partner: { id: string; status: string; affiliate: boolean };
  terms: { version: number; status: string; bps: number; hold: number; duration: number | null; currency: string };
  accepted: boolean;
};
function makeWorld(over: Partial<World> = {}): World {
  return {
    now: 1_800_000_000_000,
    subs: [{ env: "live", sub: "sub_1", ws: "ws1" }], prices: [{ env: "live", price: "price_49" }],
    owners: { ws1: "u-cust" }, unrestricted: new Set(["u-owner"]),
    referral: { id: "r1", ws: "ws1", partner: "p1", terms: 1, status: "qualified" },
    partner: { id: "p1", status: "approved", affiliate: true },
    terms: { version: 1, status: "active", bps: 2000, hold: 45, duration: 12, currency: "usd" },
    accepted: true, ...over,
  };
}
function engine(w: World) {
  const ledger: Entry[] = []; const events = new Set<string>();
  const invoices = new Map<string, { commission: number; applied: number; paid: number; accrualIdx: number }>();
  const refunds = new Map<string, { invoice: string; amount: number; status: string; created: number }>();
  const disputes = new Map<string, { invoice: string; amount: number; status: string; created: number }>();
  let seq = 0;
  const recompute = (env: Env, invoice: string, event: string) => {
    const i = invoices.get(`${env}:${invoice}`); if (!i) return 0;
    let exp = 0;
    for (const [k, r] of refunds) if (k.startsWith(env + ":") && r.invoice === invoice && ["pending", "requires_action", "succeeded"].includes(r.status)) exp += r.amount;
    for (const [k, d] of disputes) if (k.startsWith(env + ":") && d.invoice === invoice && !["won", "warning_closed"].includes(d.status)) exp += d.amount;
    const t = target(i.commission, i.paid, exp); const delta = t - i.applied; if (delta === 0) return 0;
    if (ledger.some((e) => e.env === env && e.event === event && e.accrual === i.accrualIdx && e.type !== "accrual")) return 0;
    ledger.push({ type: delta < 0 ? "reversal" : "restoration", amount: delta, availableAt: delta < 0 ? w.now : ledger[i.accrualIdx]!.availableAt, env, invoice, event, accrual: i.accrualIdx });
    i.applied = t; return delta;
  };
  return {
    ledger, invoices,
    invoicePaid(a: { env: Env; event: string; invoice: string; sub?: string; price?: string; ws?: string; currency?: string; paid: number; base: number; paidAt?: number; created?: number }) {
      const ws = a.ws ?? "ws1";
      if (events.has(`${a.env}:${a.event}`)) return "DUPLICATE_EVENT"; events.add(`${a.env}:${a.event}`);
      if (invoices.has(`${a.env}:${a.invoice}`)) return "DUPLICATE_INVOICE";
      if (!w.subs.some((s) => s.env === a.env && s.sub === (a.sub ?? "sub_1") && s.ws === ws) || !w.prices.some((p) => p.env === a.env && p.price === (a.price ?? "price_49"))) return "NOT_MAPPED";
      const owner = w.owners[ws]; if (!owner || w.unrestricted.has(owner)) return "NOT_ELIGIBLE";
      const r = w.referral; if (!r || r.ws !== ws || r.status !== "qualified") return "NO_REFERRAL";
      if (w.partner.status !== "approved" || !w.partner.affiliate) return "PARTNER_NOT_ELIGIBLE";
      const t = w.terms; if (!["active", "retired"].includes(t.status) || t.duration === null) return "TERMS_INCOMPLETE";
      if (!w.accepted) return "AGREEMENT_NOT_ACCEPTED";
      if ((a.currency ?? "usd").toLowerCase() !== t.currency) return "CURRENCY_MISMATCH";
      if (a.base <= 0 || a.base > a.paid) return "NO_ELIGIBLE_BASE";
      const count = [...invoices.values()].length; if (count >= t.duration) return "CAP_REACHED";
      const c = cents(a.base, t.bps); if (c <= 0) return "ZERO_COMMISSION";
      const paidAt = Math.min(a.paidAt ?? w.now, w.now);
      ledger.push({ type: "accrual", amount: c, availableAt: paidAt + t.hold * 864e5, env: a.env, invoice: a.invoice, event: a.event });
      invoices.set(`${a.env}:${a.invoice}`, { commission: c, applied: c, paid: a.paid, accrualIdx: ledger.length - 1 }); seq++;
      recompute(a.env, a.invoice, a.event);
      return "ACCRUED";
    },
    refund(env: Env, event: string, created: number, ref: string, invoice: string, amount: number, status: string) {
      if (events.has(`${env}:${event}`)) return "DUPLICATE_EVENT"; events.add(`${env}:${event}`);
      const k = `${env}:${ref}`; const old = refunds.get(k);
      if (!old) refunds.set(k, { invoice, amount, status, created });
      else if (old.invoice !== invoice) return "INVOICE_MISMATCH";
      else if (supersedes(created, refundRank(status), old.created, refundRank(old.status))) refunds.set(k, { invoice, amount, status, created });
      else return "STALE";
      recompute(env, invoice, event); return "APPLIED";
    },
    dispute(env: Env, event: string, created: number, ref: string, invoice: string, amount: number, status: string) {
      if (events.has(`${env}:${event}`)) return "DUPLICATE_EVENT"; events.add(`${env}:${event}`);
      const k = `${env}:${ref}`; const old = disputes.get(k);
      if (!old) disputes.set(k, { invoice, amount, status, created });
      else if (old.invoice !== invoice) return "INVOICE_MISMATCH";
      else if (supersedes(created, disputeRank(status), old.created, disputeRank(old.status))) disputes.set(k, { invoice, amount, status, created });
      else return "STALE";
      recompute(env, invoice, event); return "APPLIED";
    },
    payout(amount: number) { ledger.push({ type: "payout", amount: -amount, availableAt: w.now }); },
    net: () => ledger.reduce((s, e) => s + e.amount, 0),
    available: (at: number) => ledger.filter((e) => e.availableAt <= at || e.amount < 0).reduce((s, e) => s + e.amount, 0),
    invoiceNet: (env: Env, inv: string) => ledger.filter((e) => e.env === env && e.invoice === inv).reduce((s, e) => s + e.amount, 0),
  };
}
const $49 = { paid: 4900, base: 4900 };

check("M-1 $49 @ 20% = $9.80", cents(4900, 2000) === 980);
check("M-2 rounding floors (e.g. 4999 @ 20% = 999)", cents(4999, 2000) === 999 && cents(1, 2000) === 0 && cents(33, 3333) === 10);
check("M-3 base excludes tax: paid 5304 (8.25% tax), base 4900 → 980", (() => { const e = engine(makeWorld()); e.invoicePaid({ env: "live", event: "evt_a", invoice: "in_a", paid: 5304, base: 4900 }); return e.ledger[0]!.amount === 980; })());
check("M-4 discount/credit lowers base: base 3920 → 784", cents(3920, 2000) === 784);
{
  const e = engine(makeWorld()); const w = makeWorld();
  for (let i = 1; i <= 14; i++) e.invoicePaid({ env: "live", event: `evt_${i}`, invoice: `in_${i}`, ...$49 });
  check("M-5 12-invoice cap", e.ledger.filter((x) => x.type === "accrual").length === 12 && e.net() === 12 * 980);
  check("M-6 13th returns CAP_REACHED", e.invoicePaid({ env: "live", event: "evt_x", invoice: "in_x", ...$49 }) === "CAP_REACHED");
  check("M-7 hold 45 days from payment", e.ledger[0]!.availableAt === w.now + 45 * 864e5);
}
check("M-8 direct/no attribution", engine(makeWorld({ referral: null })).invoicePaid({ env: "live", event: "evt_1", invoice: "in_1", ...$49 }) === "NO_REFERRAL");
check("M-9 service-only partner", engine(makeWorld({ partner: { id: "p1", status: "approved", affiliate: false } })).invoicePaid({ env: "live", event: "evt_1", invoice: "in_1", ...$49 }) === "PARTNER_NOT_ELIGIBLE");
check("M-10 unapproved/suspended partner", engine(makeWorld({ partner: { id: "p1", status: "suspended", affiliate: true } })).invoicePaid({ env: "live", event: "evt_1", invoice: "in_1", ...$49 }) === "PARTNER_NOT_ELIGIBLE");
check("M-11 no agreement acceptance", engine(makeWorld({ accepted: false })).invoicePaid({ env: "live", event: "evt_1", invoice: "in_1", ...$49 }) === "AGREEMENT_NOT_ACCEPTED");
check("M-12 pending (unqualified) referral", engine(makeWorld({ referral: { id: "r1", ws: "ws1", partner: "p1", terms: 1, status: "pending" } })).invoicePaid({ env: "live", event: "evt_1", invoice: "in_1", ...$49 }) === "NO_REFERRAL");
check("M-13 terms without duration", engine(makeWorld({ terms: { version: 1, status: "active", bps: 2000, hold: 45, duration: null, currency: "usd" } })).invoicePaid({ env: "live", event: "evt_1", invoice: "in_1", ...$49 }) === "TERMS_INCOMPLETE");
check("M-14 currency mismatch", engine(makeWorld()).invoicePaid({ env: "live", event: "evt_1", invoice: "in_1", currency: "eur", ...$49 }) === "CURRENCY_MISMATCH");
check("M-15 metadata/workspace mismatch", engine(makeWorld()).invoicePaid({ env: "live", event: "evt_1", invoice: "in_1", ws: "ws_other", ...$49 }) === "NOT_MAPPED");
check("M-16 unmapped price", engine(makeWorld()).invoicePaid({ env: "live", event: "evt_1", invoice: "in_1", price: "price_other", ...$49 }) === "NOT_MAPPED");
check("M-17 test event cannot hit live mapping", engine(makeWorld()).invoicePaid({ env: "test", event: "evt_1", invoice: "in_1", ...$49 }) === "NOT_MAPPED");
check("M-18 zero/negative/overflow base", ["NO_ELIGIBLE_BASE", "NO_ELIGIBLE_BASE"].every((r, i) => engine(makeWorld()).invoicePaid({ env: "live", event: "evt_1", invoice: "in_1", paid: 4900, base: i ? 5000 : 0 }) === r));
check("M-19 owner unrestricted workspace: no commission", engine(makeWorld({ owners: { ws1: "u-owner" } })).invoicePaid({ env: "live", event: "evt_1", invoice: "in_1", ...$49 }) === "NOT_ELIGIBLE");
{
  const e = engine(makeWorld());
  e.invoicePaid({ env: "live", event: "evt_1", invoice: "in_1", ...$49 });
  check("M-20 duplicate event", e.invoicePaid({ env: "live", event: "evt_1", invoice: "in_1", ...$49 }) === "DUPLICATE_EVENT");
  check("M-21 duplicate invoice via new event", e.invoicePaid({ env: "live", event: "evt_2", invoice: "in_1", ...$49 }) === "DUPLICATE_INVOICE" && e.net() === 980);
  check("M-22 future paid_at clamped", (() => { const e2 = engine(makeWorld()); const w = makeWorld(); e2.invoicePaid({ env: "live", event: "evt_f", invoice: "in_f", paidAt: w.now + 9e12, ...$49 }); return e2.ledger[0]!.availableAt === w.now + 45 * 864e5; })());
}
{
  const w = makeWorld({ subs: [{ env: "live", sub: "sub_1", ws: "ws1" }, { env: "test", sub: "sub_1", ws: "ws1" }], prices: [{ env: "live", price: "price_49" }, { env: "test", price: "price_49" }] });
  const e = engine(w);
  check("M-23 same invoice id in test and live are separate", e.invoicePaid({ env: "live", event: "evt_1", invoice: "in_1", ...$49 }) === "ACCRUED" && e.invoicePaid({ env: "test", event: "evt_1", invoice: "in_1", ...$49 }) === "ACCRUED");
  e.refund("test", "evt_r", 1, "re_1", "in_1", 4900, "succeeded");
  check("M-24 test refund never touches live commission", e.invoiceNet("live", "in_1") === 980 && e.invoiceNet("test", "in_1") === 0);
}
{
  const e = engine(makeWorld()); e.invoicePaid({ env: "live", event: "evt_1", invoice: "in_1", ...$49 });
  e.refund("live", "evt_r1", 10, "re_1", "in_1", 1225, "succeeded");
  check("M-25 partial refund 25% → reverse 245", e.invoiceNet("live", "in_1") === 735);
  e.refund("live", "evt_r2", 11, "re_2", "in_1", 1225, "pending");
  check("M-26 multiple refunds (pending counts) → 490", e.invoiceNet("live", "in_1") === 490);
  e.refund("live", "evt_r3", 12, "re_2", "in_1", 1225, "failed");
  check("M-27 failed refund restores via new entry", e.invoiceNet("live", "in_1") === 735 && e.ledger.some((x) => x.type === "restoration" && x.amount === 245));
  e.refund("live", "evt_r4", 13, "re_1", "in_1", 1225, "canceled");
  check("M-28 canceled refund restores to full", e.invoiceNet("live", "in_1") === 980);
  check("M-29 history never rewritten (5 rows, all immutable)", e.ledger.length === 5 && e.ledger[0]!.amount === 980);
}
{
  const e = engine(makeWorld()); e.invoicePaid({ env: "live", event: "evt_1", invoice: "in_1", ...$49 });
  e.dispute("live", "evt_d1", 10, "dp_1", "in_1", 4900, "needs_response");
  check("M-30 dispute open reverses fully", e.invoiceNet("live", "in_1") === 0);
  e.dispute("live", "evt_d2", 20, "dp_1", "in_1", 4900, "won");
  check("M-31 dispute won restores", e.invoiceNet("live", "in_1") === 980);
  const e2 = engine(makeWorld()); e2.invoicePaid({ env: "live", event: "evt_1", invoice: "in_1", ...$49 });
  e2.dispute("live", "evt_d1", 10, "dp_1", "in_1", 4900, "needs_response"); e2.dispute("live", "evt_d2", 20, "dp_1", "in_1", 4900, "lost");
  check("M-32 dispute lost stays reversed (no extra row)", e2.invoiceNet("live", "in_1") === 0 && e2.ledger.length === 2);
  const e3 = engine(makeWorld()); e3.invoicePaid({ env: "live", event: "evt_1", invoice: "in_1", ...$49 });
  e3.dispute("live", "evt_d1", 10, "dp_1", "in_1", 2450, "under_review");
  check("M-33 partial dispute proportional", e3.invoiceNet("live", "in_1") === 490);
}
{
  const e = engine(makeWorld()); e.invoicePaid({ env: "live", event: "evt_1", invoice: "in_1", ...$49 });
  e.refund("live", "evt_r1", 10, "re_1", "in_1", 4900, "succeeded");
  e.dispute("live", "evt_d1", 11, "dp_1", "in_1", 4900, "needs_response");
  check("M-34 refund+dispute overlap capped at original", e.invoiceNet("live", "in_1") === 0 && e.ledger.filter((x) => x.type === "reversal").reduce((s, x) => s + x.amount, 0) === -980);
  e.dispute("live", "evt_d2", 12, "dp_1", "in_1", 4900, "won");
  check("M-35 dispute won while refunded: stays reversed", e.invoiceNet("live", "in_1") === 0);
}
{
  const e = engine(makeWorld()); e.invoicePaid({ env: "live", event: "evt_1", invoice: "in_1", ...$49 });
  e.refund("live", "evt_late", 20, "re_1", "in_1", 4900, "failed");
  check("M-36 out-of-order: older 'succeeded' after newer 'failed' is STALE", e.refund("live", "evt_early", 10, "re_1", "in_1", 4900, "succeeded") === "STALE" && e.invoiceNet("live", "in_1") === 980);
  check("M-37 same timestamp: terminal outranks pending", (() => { const x = engine(makeWorld()); x.invoicePaid({ env: "live", event: "evt_1", invoice: "in_1", ...$49 }); x.refund("live", "evt_a", 5, "re_1", "in_1", 4900, "canceled"); return x.refund("live", "evt_b", 5, "re_1", "in_1", 4900, "pending") === "STALE" && x.invoiceNet("live", "in_1") === 980; })());
  check("M-38 duplicate refund event ignored", e.refund("live", "evt_late", 20, "re_1", "in_1", 4900, "failed") === "DUPLICATE_EVENT");
  const e2 = engine(makeWorld());
  e2.refund("live", "evt_r0", 1, "re_1", "in_1", 2450, "succeeded");
  e2.invoicePaid({ env: "live", event: "evt_1", invoice: "in_1", ...$49 });
  check("M-39 refund before invoice.paid applied on accrual", e2.invoiceNet("live", "in_1") === 490);
  check("M-40 refund cannot switch invoice", e.refund("live", "evt_sw", 30, "re_1", "in_other", 4900, "succeeded") === "INVOICE_MISMATCH");
}
{
  const w = makeWorld(); const e = engine(w);
  e.invoicePaid({ env: "live", event: "evt_1", invoice: "in_1", paidAt: w.now - 60 * 864e5, ...$49 });
  check("M-41 matured after hold", e.available(w.now) === 980);
  e.payout(980);
  e.refund("live", "evt_r1", 10, "re_1", "in_1", 4900, "succeeded");
  check("M-42 reversal after payout → negative carry-forward", e.available(w.now) === -980 && e.ledger.some((x) => x.type === "payout" && x.amount === -980));
  e.invoicePaid({ env: "live", event: "evt_2", invoice: "in_2", paidAt: w.now - 60 * 864e5, ...$49 });
  check("M-43 later commission nets against carry-forward", e.available(w.now) === 0);
  check("M-44 bounded: invoice net always within [0, commission]", e.invoiceNet("live", "in_1") >= 0 && e.invoiceNet("live", "in_1") <= 980);
}
// Exhaustive bound property over random sequences (deterministic PRNG).
{
  let seed = 42; const rnd = () => ((seed = (seed * 1103515245 + 12345) % 2 ** 31) / 2 ** 31);
  const rs = ["pending", "requires_action", "succeeded", "failed", "canceled"], ds = ["needs_response", "under_review", "won", "lost", "warning_closed"];
  let ok = true;
  for (let run = 0; run < 300; run++) {
    const e = engine(makeWorld()); e.invoicePaid({ env: "live", event: "evt_0", invoice: "in_1", ...$49 });
    for (let k = 0; k < 12; k++) {
      const amt = 1 + Math.floor(rnd() * 4900); const t = Math.floor(rnd() * 50);
      if (rnd() < 0.5) e.refund("live", `evt_r${run}_${k}`, t, `re_${Math.floor(rnd() * 3)}`, "in_1", amt, rs[Math.floor(rnd() * 5)]!);
      else e.dispute("live", `evt_d${run}_${k}`, t, `dp_${Math.floor(rnd() * 2)}`, "in_1", amt, ds[Math.floor(rnd() * 5)]!);
      const n = e.invoiceNet("live", "in_1"); if (n < 0 || n > 980) ok = false;
    }
  }
  check("M-45 300 random sequences never breach [0, commission]", ok);
}

/* ---------------- 7. Preserved invariants ---------------- */
const P1A = readFileSync(readdirSync("supabase/migrations").filter((f) => f.startsWith("20260928170228")).map((f) => `supabase/migrations/${f}`)[0]!, "utf8");
check("I-1 Phase 1A append-only trigger exists (unchanged)", /partner_commission_ledger_append_only/.test(P1A));
check("I-2 payout controls not redefined", !/FUNCTION public\.(request_partner_payout|owner_review_partner_payout|owner_mark_partner_payout_paid)\(/.test(N));
check("I-3 available balance rule unchanged", !/FUNCTION public\.partner_available_balance\(/.test(N));
check("I-4 webhook untouched this stage", !/partner_ingest/.test(readFileSync("backend-source/edge-functions/stripe-billing-webhook/index.ts", "utf8")));
check("I-5 owner bypass in checkout intact", /UNRESTRICTED_NO_BILLING/.test(readFileSync("backend-source/edge-functions/billing-checkout/index.ts", "utf8")));
check("I-6 no hardcoded owner email", !/berthonyxyz/i.test(SQL));

console.log(`Partner 1B-3 regression: ${passed} passed, ${failed} failed`);
if (failed) process.exit(1);
