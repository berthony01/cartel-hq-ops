/**
 * Partner Program Phase 1A client helpers.
 * The database (RLS + SECURITY DEFINER RPCs) is the only authority; these
 * helpers never decide eligibility, owner status, balances or commissions.
 */
import { supabase } from "@/integrations/supabase/client";
import type { Tables } from "@/integrations/supabase/types";

export type PartnerTerms = Tables<"partner_program_terms">;
export type Partner = Tables<"partners">;
export type PartnerApplication = Tables<"partner_applications">;
export type PartnerReferral = Tables<"partner_referrals">;
export type PartnerLedgerEntry = Tables<"partner_commission_ledger">;
export type PartnerPayout = Tables<"partner_payout_requests">;
export type PartnerAcceptance = Tables<"partner_agreement_acceptances">;

export type PartnerSummary = {
  ok: boolean;
  is_partner: boolean;
  program_open: boolean;
  /** Service-only track switch (staged track-separation contract). Absent => closed. */
  service_partner_applications_open?: boolean;
  /** Affiliate track switch. Deferred: absent/false => closed. */
  affiliate_applications_open?: boolean;
  status?: string;
  is_affiliate?: boolean;
  is_service_partner?: boolean;
  referral_code?: string | null;
  tax_doc_status?: string;
  currency?: string | null;
  agreement_accepted?: boolean;
  available_cents?: number;
  pending_cents?: number;
  reserved_cents?: number;
  ytd_earned_cents?: number;
  ytd_paid_cents?: number;
  referrals_total?: number;
};

export const partnerKeys = {
  all: ["partners"] as const,
  status: () => ["partners", "status"] as const,
  activeTerms: () => ["partners", "terms", "active"] as const,
  allTerms: () => ["partners", "terms", "all"] as const,
  summary: (userId: string | null) => ["partners", "summary", userId ?? "anon"] as const,
  mine: (userId: string | null) => ["partners", "mine", userId ?? "anon"] as const,
  owner: (kind: "applications" | "partners" | "referrals" | "ledger" | "payouts") =>
    ["partners", "owner", kind] as const,
};

function unwrap<T>(res: { data: T | null; error: { message: string } | null }): T {
  if (res.error) throw new Error(res.error.message);
  return res.data as T;
}

/* ---------------- Terms ---------------- */
export async function fetchActiveTerms(): Promise<PartnerTerms | null> {
  const res = await supabase.from("partner_program_terms").select("*").eq("status", "active").maybeSingle();
  return unwrap(res);
}
/** Owner sees all versions via RLS; others see only the active row. */
export async function fetchAllTerms(): Promise<PartnerTerms[]> {
  const res = await supabase.from("partner_program_terms").select("*").order("version", { ascending: false });
  return unwrap(res) ?? [];
}

/* ---------------- Track status (database authority) ---------------- */
export type PartnerProgramStatus = {
  service_partner_applications_open: boolean;
  affiliate_applications_open: boolean;
  active_version: number | null;
  /** false when the staged track-separation contract is not applied yet. */
  contract_available: boolean;
};
export const CLOSED_PROGRAM_STATUS: PartnerProgramStatus = {
  service_partner_applications_open: false, affiliate_applications_open: false, active_version: null, contract_available: false,
};
type LooseRpcCall = (fn: string, args?: Record<string, unknown>) => Promise<{ data: unknown; error: { message: string; code?: string } | null }>;
/**
 * Public, read-only track status via get_partner_program_status (staged).
 * Fails closed: any error or missing contract reports both tracks closed.
 */
export async function fetchPartnerProgramStatus(): Promise<PartnerProgramStatus> {
  try {
    const res = await (supabase.rpc.bind(supabase) as unknown as LooseRpcCall)("get_partner_program_status");
    if (res.error || !res.data || typeof res.data !== "object") return CLOSED_PROGRAM_STATUS;
    const d = res.data as Record<string, unknown>;
    return {
      service_partner_applications_open: d.service_partner_applications_open === true,
      affiliate_applications_open: d.affiliate_applications_open === true,
      active_version: typeof d.active_version === "number" ? d.active_version : null,
      contract_available: true,
    };
  } catch {
    return CLOSED_PROGRAM_STATUS;
  }
}
/** Track flags from an active terms row; missing columns => closed (fail closed). */
export function termsTrackFlags(t: PartnerTerms | null | undefined): { service: boolean; affiliate: boolean } {
  const r = (t ?? {}) as { service_partner_applications_open?: unknown; affiliate_applications_open?: unknown };
  return { service: r.service_partner_applications_open === true, affiliate: r.affiliate_applications_open === true };
}

/* ---------------- Current user ---------------- */
export async function fetchMyPartnerSummary(): Promise<PartnerSummary> {
  const res = await supabase.rpc("get_my_partner_summary");
  return unwrap(res) as unknown as PartnerSummary;
}

export type MyPartnerData = {
  applications: PartnerApplication[];
  partner: Partner | null;
  referrals: PartnerReferral[];
  ledger: PartnerLedgerEntry[];
  payouts: PartnerPayout[];
  acceptances: PartnerAcceptance[];
};

/** RLS scopes every table to the caller's own rows (owner also sees all, so filter by user). */
export async function fetchMyPartnerData(userId: string): Promise<MyPartnerData> {
  const [apps, partner] = await Promise.all([
    supabase.from("partner_applications").select("*").eq("user_id", userId).order("submitted_at", { ascending: false }),
    supabase.from("partners").select("*").eq("user_id", userId).maybeSingle(),
  ]);
  const p = unwrap(partner);
  if (!p) return { applications: unwrap(apps) ?? [], partner: null, referrals: [], ledger: [], payouts: [], acceptances: [] };
  const [refs, ledger, payouts, acc] = await Promise.all([
    supabase.from("partner_referrals").select("*").eq("partner_id", p.id).order("attributed_at", { ascending: false }),
    supabase.from("partner_commission_ledger").select("*").eq("partner_id", p.id).order("created_at", { ascending: false }),
    supabase.from("partner_payout_requests").select("*").eq("partner_id", p.id).order("requested_at", { ascending: false }),
    supabase.from("partner_agreement_acceptances").select("*").eq("partner_id", p.id),
  ]);
  return {
    applications: unwrap(apps) ?? [],
    partner: p,
    referrals: unwrap(refs) ?? [],
    ledger: unwrap(ledger) ?? [],
    payouts: unwrap(payouts) ?? [],
    acceptances: unwrap(acc) ?? [],
  };
}

export async function submitPartnerApplication(input: { wantsAffiliate: boolean; wantsServicePartner: boolean; pitch: string }) {
  return unwrap(await supabase.rpc("submit_partner_application", {
    _wants_affiliate: input.wantsAffiliate,
    _wants_service_partner: input.wantsServicePartner,
    _pitch: input.pitch,
  }));
}
export async function acceptPartnerAgreement(termsVersion: number) {
  return unwrap(await supabase.rpc("accept_partner_agreement", { _terms_version: termsVersion }));
}
export async function requestPartnerPayout(amountCents: number) {
  return unwrap(await supabase.rpc("request_partner_payout", { _amount_cents: amountCents }));
}

/* ---------------- Owner directories (RLS: platform owner only sees all) ---------------- */
export async function ownerListApplications(): Promise<PartnerApplication[]> {
  return unwrap(await supabase.from("partner_applications").select("*").order("submitted_at", { ascending: false }).limit(200)) ?? [];
}
export async function ownerListPartners(): Promise<Partner[]> {
  return unwrap(await supabase.from("partners").select("*").order("created_at", { ascending: false }).limit(200)) ?? [];
}
export async function ownerListReferrals(): Promise<PartnerReferral[]> {
  return unwrap(await supabase.from("partner_referrals").select("*").order("attributed_at", { ascending: false }).limit(200)) ?? [];
}
export async function ownerListLedger(): Promise<PartnerLedgerEntry[]> {
  return unwrap(await supabase.from("partner_commission_ledger").select("*").order("created_at", { ascending: false }).limit(200)) ?? [];
}
export async function ownerListPayouts(): Promise<PartnerPayout[]> {
  return unwrap(await supabase.from("partner_payout_requests").select("*").order("requested_at", { ascending: false }).limit(200)) ?? [];
}

/* ---------------- Owner mutations (server-gated by partner_require_owner) ---------------- */
export type TermsDraftInput = {
  version: number;
  commissionBps: number;
  attributionWindowDays: number;
  holdDays: number;
  minPayoutCents: number;
  currency: string;
  agreementText: string;
  disclosureText: string;
  commissionDurationInvoices: number;
};
export const COMMISSION_CONTRACT_UNAVAILABLE = "COMMISSION_CONTRACT_UNAVAILABLE";
/**
 * Stage 1B-3 staged 9-argument draft save (commission_duration_invoices).
 * Untyped until the staged SQL is applied and types regenerate. Fails closed:
 * if the staged contract is missing, nothing is written and a clear error is shown.
 */
export async function ownerSaveTermsDraft(t: TermsDraftInput) {
  const rpc = supabase.rpc as unknown as (fn: string, args: Record<string, unknown>) => Promise<{ data: unknown; error: { message: string; code?: string } | null }>;
  const res = await rpc("owner_save_partner_terms_draft", {
    _version: t.version,
    _commission_bps: t.commissionBps,
    _attribution_window_days: t.attributionWindowDays,
    _hold_days: t.holdDays,
    _min_payout_cents: t.minPayoutCents,
    _currency: t.currency,
    _agreement_text: t.agreementText,
    _disclosure_text: t.disclosureText,
    _commission_duration_invoices: t.commissionDurationInvoices,
  });
  if (res.error && (res.error.code === "PGRST202" || /Could not find the function/i.test(res.error.message))) {
    throw new Error(COMMISSION_CONTRACT_UNAVAILABLE);
  }
  return unwrap(res);
}
/**
 * Service-only draft (staged owner_save_service_partner_terms_draft). The
 * database forces affiliate_applications_open=false and every affiliate
 * financial field NULL. Fails closed while the contract is unapplied.
 */
export async function ownerSaveServiceTermsDraft(t: { version: number; agreementText: string; disclosureText: string }) {
  const res = await (supabase.rpc.bind(supabase) as unknown as LooseRpcCall)("owner_save_service_partner_terms_draft", {
    _version: t.version, _agreement_text: t.agreementText, _disclosure_text: t.disclosureText,
  });
  if (res.error && (res.error.code === "PGRST202" || /Could not find the function/i.test(res.error.message))) {
    throw new Error(TRACK_CONTRACT_UNAVAILABLE);
  }
  return unwrap(res as { data: unknown; error: { message: string } | null });
}
export const TRACK_CONTRACT_UNAVAILABLE = "TRACK_CONTRACT_UNAVAILABLE";
export async function ownerActivateTerms(version: number) {
  return unwrap(await supabase.rpc("owner_activate_partner_terms", { _version: version }));
}
export async function ownerRetireTerms(version: number) {
  return unwrap(await supabase.rpc("owner_retire_partner_terms", { _version: version }));
}
export async function ownerReviewApplication(applicationId: string, approve: boolean, note?: string) {
  return unwrap(await supabase.rpc("owner_review_partner_application", {
    _application_id: applicationId, _approve: approve, ...(note ? { _note: note } : {}),
  }));
}
export async function ownerSetPartnerStatus(partnerId: string, status: string, taxDocStatus?: string) {
  return unwrap(await supabase.rpc("owner_set_partner_status", {
    _partner_id: partnerId, _status: status, ...(taxDocStatus ? { _tax_doc_status: taxDocStatus } : {}),
  }));
}
export async function ownerAddLedgerAdjustment(input: {
  partnerId: string; amountCents: number; currency: string; note: string; referralId?: string | undefined; availableAt?: string | undefined;
}) {
  return unwrap(await supabase.rpc("owner_add_partner_ledger_adjustment", {
    _partner_id: input.partnerId,
    _amount_cents: input.amountCents,
    _currency: input.currency,
    _note: input.note,
    ...(input.referralId ? { _referral_id: input.referralId } : {}),
    ...(input.availableAt ? { _available_at: input.availableAt } : {}),
  }));
}
export async function ownerRejectReferralForFraud(referralId: string, reason: string) {
  return unwrap(await supabase.rpc("owner_reject_partner_referral_for_fraud", { _referral_id: referralId, _reason: reason }));
}
export async function ownerReviewPayout(payoutId: string, approve: boolean, note?: string) {
  return unwrap(await supabase.rpc("owner_review_partner_payout", {
    _payout_id: payoutId, _approve: approve, ...(note ? { _note: note } : {}),
  }));
}
export async function ownerMarkPayoutPaid(payoutId: string, paidReference: string) {
  return unwrap(await supabase.rpc("owner_mark_partner_payout_paid", { _payout_id: payoutId, _paid_reference: paidReference }));
}

/* ---------------- Referral capture (Phase 1B-2) ----------------
 * The browser exchanges ?ref=CODE for a SERVER-ISSUED opaque token and stores
 * ONLY { token, expiresAt }. There is no client capture timestamp: the server
 * click time is the sole attribution authority. expiresAt is advisory (local
 * cleanup only); the database re-checks expiry at claim time.
 * No partner id, code, tax data, credentials, IP or fingerprint is stored. */
export const REFERRAL_TOKEN_STORAGE_KEY = "cartel-hq:referral-token";
/** Pre-1B-2 key that held a raw code + client timestamp; purged, never trusted. */
export const LEGACY_REFERRAL_STORAGE_KEY = "cartel-hq:referral";
export const REFERRAL_CAPTURE_FUNCTION = "partner-referral-capture";
const CODE_RE = /^[a-z0-9]{10}$/;
const TOKEN_RE = /^[A-Za-z0-9_-]{43}$/;

export function normalizeReferralCode(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const code = value.trim().toLowerCase();
  return CODE_RE.test(code) ? code : null;
}
export type StoredReferralToken = { token: string; expiresAt: string };

function safeStorage(): Storage | null {
  if (typeof window === "undefined") return null;
  try {
    return window.localStorage;
  } catch {
    return null;
  }
}

export function purgeLegacyReferral() {
  try {
    safeStorage()?.removeItem(LEGACY_REFERRAL_STORAGE_KEY);
  } catch {
    /* storage unavailable */
  }
}

export function parseReferralToken(value: unknown, now: number = Date.now()): StoredReferralToken | null {
  if (!value || typeof value !== "object") return null;
  const { token, expiresAt } = value as Partial<StoredReferralToken>;
  if (typeof token !== "string" || !TOKEN_RE.test(token) || typeof expiresAt !== "string") return null;
  const exp = Date.parse(expiresAt);
  if (!Number.isFinite(exp) || exp <= now) return null;
  return { token, expiresAt };
}

export function storeReferralToken(value: unknown): boolean {
  const parsed = parseReferralToken(value);
  const store = safeStorage();
  if (!parsed || !store) return false;
  try {
    store.setItem(REFERRAL_TOKEN_STORAGE_KEY, JSON.stringify({ token: parsed.token, expiresAt: parsed.expiresAt }));
    return true;
  } catch {
    return false;
  }
}

export function readStoredReferralToken(): StoredReferralToken | null {
  const store = safeStorage();
  if (!store) return null;
  try {
    const raw = store.getItem(REFERRAL_TOKEN_STORAGE_KEY);
    if (!raw) return null;
    const parsed = parseReferralToken(JSON.parse(raw));
    if (!parsed) store.removeItem(REFERRAL_TOKEN_STORAGE_KEY);
    return parsed;
  } catch {
    return null;
  }
}

export function clearStoredReferralToken() {
  try {
    safeStorage()?.removeItem(REFERRAL_TOKEN_STORAGE_KEY);
  } catch {
    /* storage unavailable */
  }
}

/**
 * Exchanges a referral code for an opaque server token. The capture endpoint
 * answers uniformly for real and unknown codes; a non-issued token simply
 * never claims. Keeps an existing unexpired token (first valid wins locally).
 */
export async function captureReferralCode(value: unknown): Promise<boolean> {
  purgeLegacyReferral();
  const code = normalizeReferralCode(value);
  if (!code) return false;
  if (readStoredReferralToken()) return false;
  try {
    const { data, error } = await supabase.functions.invoke(REFERRAL_CAPTURE_FUNCTION, { body: { code } });
    if (error) return false;
    return storeReferralToken(data);
  } catch {
    return false;
  }
}

export type ClaimOutcome = "claimed" | "keep" | "cleared" | "none";
type LooseRpc = (fn: string, args?: Record<string, unknown>) => Promise<{ data: unknown; error: unknown }>;

/** Maps a claim_referral_click result to a local storage action. */
export function claimOutcomeFor(res: { data: unknown; error: unknown } | null): ClaimOutcome {
  if (!res || res.error) return "keep"; // transient or not yet deployed: retry later
  const data = (res.data ?? {}) as { ok?: boolean };
  return data.ok === true ? "claimed" : "cleared"; // any definitive rejection is terminal
}

/** Idempotent atomic claim via claim_referral_click (auth.uid(), server time). */
export async function claimStoredReferralToken(): Promise<ClaimOutcome> {
  purgeLegacyReferral();
  const stored = readStoredReferralToken();
  if (!stored) return "none";
  let res: { data: unknown; error: unknown } | null = null;
  try {
    res = await (supabase.rpc.bind(supabase) as unknown as LooseRpc)("claim_referral_click", { _token: stored.token });
  } catch {
    return "keep";
  }
  const outcome = claimOutcomeFor(res);
  if (outcome !== "keep") clearStoredReferralToken();
  return outcome;
}

export type BindResult = { ok?: boolean; bound?: boolean; reason?: string; assignment_marked?: boolean };
/** Database rejects non-owned, pre-existing, ineligible, self, expired and inactive cases. */
export async function bindReferralToWorkspace(workspaceId: string): Promise<BindResult | null> {
  const res = await supabase.rpc("bind_referral_to_workspace", { _workspace_id: workspaceId });
  if (res.error) return null;
  return (res.data ?? null) as BindResult | null;
}

/* ---------------- Formatting (no program defaults) ---------------- */
export function formatMoney(cents: number | null | undefined, currency: string | null | undefined): string {
  if (cents === null || cents === undefined || !currency) return "—";
  try {
    return new Intl.NumberFormat(undefined, { style: "currency", currency: currency.toUpperCase() }).format(cents / 100);
  } catch {
    return `${(cents / 100).toFixed(2)} ${currency.toUpperCase()}`;
  }
}
export function formatBps(bps: number | null | undefined): string {
  if (bps === null || bps === undefined) return "—";
  return `${(bps / 100).toLocaleString(undefined, { maximumFractionDigits: 2 })}%`;
}
export function formatDays(days: number | null | undefined): string {
  if (days === null || days === undefined) return "—";
  return `${days} day${days === 1 ? "" : "s"}`;
}
export function formatDate(value: string | null | undefined): string {
  if (!value) return "—";
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? "—" : d.toLocaleDateString();
}
export function partnerErrorMessage(err: unknown): string {
  const msg = err instanceof Error ? err.message : String(err ?? "");
  const map: Record<string, string> = {
    SERVICE_PARTNER_APPLICATIONS_CLOSED: "Service Partner applications are closed right now.",
    AFFILIATE_APPLICATIONS_CLOSED: "The Affiliate Program is not open. Only the Service Partner track can be selected.",
    AFFILIATE_PROGRAM_DEFERRED: "The Affiliate Program is deferred and cannot be opened in this release.",
    AFFILIATE_PROGRAM_CLOSED: "The Affiliate Program is not open, so payouts are unavailable.",
    PARTNER_TERMS_NO_TRACK_OPEN: "Terms must open the Service Partner track before activation.",
    PARTNER_NOT_AFFILIATE: "Service Partners do not receive payouts from CARTEL HQ.",
    partner_applications_one_pending: "You already have a pending application.",
    ALREADY_PARTNER: "You already have a partner record.",
    AUTH_REQUIRED: "Sign in to continue.",
    ROLE_REQUIRED: "Choose a program track.",
    [TRACK_CONTRACT_UNAVAILABLE]: "Service Partner track controls are staged and not applied yet. Nothing was saved.",
    PROGRAM_NOT_OPEN: "The partner program is not open.",
    PLATFORM_OWNER_REQUIRED: "Owner access required.",
    TAX_DOCS_NOT_VERIFIED: "Tax readiness must be verified first.",
    AGREEMENT_NOT_ACCEPTED: "Accept the current partner agreement first.",
    BELOW_MINIMUM: "Amount is below the minimum payout.",
    INSUFFICIENT_AVAILABLE_BALANCE: "Amount exceeds your available balance.",
    PARTNER_TERMS_INCOMPLETE: "All terms fields are required before activation.",
    PARTNER_TERMS_PLACEHOLDERS_REMAIN: "Legal placeholders remain in the agreement. Activation is blocked.",
    PAID_REFERENCE_REQUIRED: "External payment reference is required.",
    REASON_REQUIRED: "A reason is required.",
    [COMMISSION_CONTRACT_UNAVAILABLE]: "Commission terms contract is staged and not applied yet.",
  };
  for (const [k, v] of Object.entries(map)) if (msg.includes(k)) return v;
  return msg || "Request failed.";
}

/* ---------------- Stage 1B-4: draft economics, balances, confirmations ---------------- */
/**
 * Draft economics shown ONLY while no active terms exist. Display-only copy;
 * never sent to the database and never used to compute any amount.
 */
export const DRAFT_ECONOMICS = {
  commissionLabel: "20%",
  durationLabel: "First 12 paid monthly invoices",
  attributionLabel: "30 days",
  holdLabel: "45 days",
  minimumLabel: "$50",
  currencyLabel: "USD (US dollars)",
  payoutLabel: "Monthly, manual",
} as const;

export const LEDGER_ENTRY_LABELS: Record<string, string> = {
  accrual: "Commission accrued",
  reversal: "Reversed (refund/dispute)",
  restoration: "Restored (refund failed / dispute won)",
  adjustment: "Owner adjustment",
  payout: "Paid out",
};

export type LedgerBreakdown = {
  held: number; available: number; accrued: number; reversed: number; restored: number;
  adjustments: number; paid: number; net: number; reservedForPayouts: number; netPayable: number; carryForward: number;
};

/**
 * Display-only mirror of the staged partner_balance_breakdown SQL, computed
 * from the caller's own RLS-scoped ledger rows. Never authoritative: payout
 * requests are validated by the database.
 */
export function ledgerBreakdown(
  entries: Array<Pick<PartnerLedgerEntry, "entry_type" | "amount_cents" | "available_at">>,
  reservedPayoutCents: number,
  now: number = Date.now(),
): LedgerBreakdown {
  const b: LedgerBreakdown = { held: 0, available: 0, accrued: 0, reversed: 0, restored: 0, adjustments: 0, paid: 0, net: 0, reservedForPayouts: reservedPayoutCents, netPayable: 0, carryForward: 0 };
  for (const e of entries) {
    const a = e.amount_cents;
    const matured = new Date(e.available_at).getTime() <= now;
    if (a > 0 && !matured) b.held += a;
    if (matured || a < 0) b.available += a;
    if (e.entry_type === "accrual") b.accrued += a;
    if (e.entry_type === "reversal") b.reversed -= a;
    if (e.entry_type === "restoration") b.restored += a;
    if (e.entry_type === "adjustment") b.adjustments += a;
    if (e.entry_type === "payout") b.paid -= a;
    b.net += a;
  }
  b.netPayable = b.available - reservedPayoutCents;
  b.carryForward = Math.min(b.available, 0);
  return b;
}

/** Exact, case-sensitive typed confirmation (trimmed). */
export function typedConfirmationMatches(input: string, expected: string): boolean {
  return expected.length > 0 && input.trim() === expected;
}
export const serviceActivationPhrase = (version: number) => `OPEN SERVICE PARTNER APPLICATIONS V${version}`;
export const activationPhrase = (version: number) => `ACTIVATE TERMS V${version}`;
export const markPaidPhrase = (reference: string) => `MARK PAID ${reference.trim()}`;

