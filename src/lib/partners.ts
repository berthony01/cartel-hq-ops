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
};
export async function ownerSaveTermsDraft(t: TermsDraftInput) {
  return unwrap(await supabase.rpc("owner_save_partner_terms_draft", {
    _version: t.version,
    _commission_bps: t.commissionBps,
    _attribution_window_days: t.attributionWindowDays,
    _hold_days: t.holdDays,
    _min_payout_cents: t.minPayoutCents,
    _currency: t.currency,
    _agreement_text: t.agreementText,
    _disclosure_text: t.disclosureText,
  }));
}
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
  partnerId: string; amountCents: number; currency: string; note: string; referralId?: string; availableAt?: string;
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

/* ---------------- Referral capture ----------------
 * Local storage holds ONLY the normalized 10-char code and capture timestamp.
 * No partner id, tax data, credentials, IP or fingerprint. */
export const REFERRAL_STORAGE_KEY = "cartel-hq:referral";
const CODE_RE = /^[a-z0-9]{10}$/;

export function normalizeReferralCode(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const code = value.trim().toLowerCase();
  return CODE_RE.test(code) ? code : null;
}
export type StoredReferral = { code: string; capturedAt: string };
export function storeReferralCode(value: unknown): boolean {
  const code = normalizeReferralCode(value);
  if (!code || typeof window === "undefined") return false;
  try {
    const payload: StoredReferral = { code, capturedAt: new Date().toISOString() };
    window.localStorage.setItem(REFERRAL_STORAGE_KEY, JSON.stringify(payload));
    return true;
  } catch {
    return false;
  }
}
export function readStoredReferral(): StoredReferral | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = window.localStorage.getItem(REFERRAL_STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<StoredReferral>;
    const code = normalizeReferralCode(parsed.code);
    if (!code) {
      window.localStorage.removeItem(REFERRAL_STORAGE_KEY);
      return null;
    }
    return { code, capturedAt: typeof parsed.capturedAt === "string" ? parsed.capturedAt : "" };
  } catch {
    return null;
  }
}
export function clearStoredReferral() {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.removeItem(REFERRAL_STORAGE_KEY);
  } catch {
    /* storage unavailable */
  }
}

export type ClaimOutcome = "claimed" | "keep" | "cleared" | "none";
/** Reasons after which retrying can never succeed for this code. */
const TERMINAL_CLAIM_REASONS = new Set(["INVALID_CODE", "INVALID_SOURCE", "CODE_NOT_ACTIVE", "SELF_REFERRAL"]);

/** Idempotent. Keeps the code only if the program is closed or the request failed transiently. */
export async function claimStoredReferral(): Promise<ClaimOutcome> {
  const stored = readStoredReferral();
  if (!stored) return "none";
  let res;
  try {
    res = await supabase.rpc("record_referral_attribution", { _code: stored.code, _source: "link" });
  } catch {
    return "keep";
  }
  if (res.error) return "keep";
  const data = (res.data ?? {}) as { ok?: boolean; reason?: string };
  if (data.ok === true) {
    clearStoredReferral();
    return "claimed";
  }
  if (data.reason === "PROGRAM_NOT_OPEN") return "keep";
  if (data.reason && TERMINAL_CLAIM_REASONS.has(data.reason)) {
    clearStoredReferral();
    return "cleared";
  }
  return "keep";
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
    PROGRAM_NOT_OPEN: "The partner program is not open.",
    PLATFORM_OWNER_REQUIRED: "Owner access required.",
    TAX_DOCS_NOT_VERIFIED: "Tax readiness must be verified first.",
    AGREEMENT_NOT_ACCEPTED: "Accept the current partner agreement first.",
    BELOW_MINIMUM: "Amount is below the minimum payout.",
    INSUFFICIENT_AVAILABLE_BALANCE: "Amount exceeds your available balance.",
    PARTNER_TERMS_INCOMPLETE: "All terms fields are required before activation.",
    PAID_REFERENCE_REQUIRED: "External payment reference is required.",
    REASON_REQUIRED: "A reason is required.",
  };
  for (const [k, v] of Object.entries(map)) if (msg.includes(k)) return v;
  return msg || "Request failed.";
}
