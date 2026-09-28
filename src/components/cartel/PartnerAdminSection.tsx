import { useState, type ReactNode } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Handshake } from "lucide-react";
import { Section } from "@/components/cartel/Section";
import { StatusBadge } from "@/components/cartel/StatusBadge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import { usePlatformAccess } from "@/hooks/usePlatformAccess";
import {
  fetchAllTerms,
  formatBps,
  formatDate,
  formatDays,
  formatMoney,
  ownerActivateTerms,
  ownerAddLedgerAdjustment,
  ownerListApplications,
  ownerListLedger,
  ownerListPartners,
  ownerListPayouts,
  ownerListReferrals,
  ownerMarkPayoutPaid,
  ownerRejectReferralForFraud,
  ownerRetireTerms,
  ownerReviewApplication,
  ownerReviewPayout,
  ownerSaveTermsDraft,
  ownerSetPartnerStatus,
  partnerErrorMessage,
  partnerKeys,
  type PartnerTerms,
} from "@/lib/partners";

const WRAP = "[overflow-wrap:anywhere]";
const short = (id: string | null | undefined) => (id ? id.slice(0, 8) : "—");

function Confirm({ trigger, title, body, onConfirm }: { trigger: ReactNode; title: string; body: string; onConfirm: () => void }) {
  return (
    <AlertDialog>
      <AlertDialogTrigger asChild>{trigger}</AlertDialogTrigger>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>{title}</AlertDialogTitle>
          <AlertDialogDescription>{body}</AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel>Cancel</AlertDialogCancel>
          <AlertDialogAction onClick={onConfirm}>Confirm</AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}

function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <label className="flex min-w-0 flex-col gap-1 text-xs font-semibold uppercase tracking-[0.1em] text-muted-foreground">
      {label}
      {children}
    </label>
  );
}

const intOrNaN = (v: string) => (v.trim() === "" ? NaN : Number(v));

/**
 * Owner-only Partner Program controls. Visibility uses the server-verified
 * usePlatformAccess gate; every mutation is independently enforced by
 * partner_require_owner() in the database.
 */
export function PartnerAdminSection() {
  const { isPlatformOwner, loading } = usePlatformAccess();
  if (loading || !isPlatformOwner) return null;
  return <PartnerAdminInner />;
}

function PartnerAdminInner() {
  const qc = useQueryClient();
  const refresh = () => qc.invalidateQueries({ queryKey: partnerKeys.all });
  const run = <A,>(fn: (a: A) => Promise<unknown>, ok: string) =>
    ({ mutationFn: fn, onSuccess: () => { toast.success(ok); refresh(); }, onError: (e: unknown) => toast.error(partnerErrorMessage(e)) });

  const terms = useQuery({ queryKey: partnerKeys.allTerms(), queryFn: fetchAllTerms });
  const apps = useQuery({ queryKey: partnerKeys.owner("applications"), queryFn: ownerListApplications });
  const partners = useQuery({ queryKey: partnerKeys.owner("partners"), queryFn: ownerListPartners });
  const referrals = useQuery({ queryKey: partnerKeys.owner("referrals"), queryFn: ownerListReferrals });
  const ledger = useQuery({ queryKey: partnerKeys.owner("ledger"), queryFn: ownerListLedger });
  const payouts = useQuery({ queryKey: partnerKeys.owner("payouts"), queryFn: ownerListPayouts });

  const allTerms = terms.data ?? [];
  const draft = allTerms.find((t) => t.status === "draft") ?? null;
  const active = allTerms.find((t) => t.status === "active") ?? null;
  const nextVersion = draft ? draft.version : (allTerms.reduce((m, t) => Math.max(m, t.version), 0) + 1);

  // Terms form: blank unless a draft already exists. No invented defaults.
  const [f, setF] = useState<Record<string, string>>({});
  const seeded = draft ? {
    commission: draft.commission_bps?.toString() ?? "", window: draft.attribution_window_days?.toString() ?? "",
    hold: draft.hold_days?.toString() ?? "", min: draft.min_payout_cents?.toString() ?? "",
    currency: draft.currency ?? "", agreement: draft.agreement_text ?? "", disclosure: draft.disclosure_text ?? "",
  } : { commission: "", window: "", hold: "", min: "", currency: "", agreement: "", disclosure: "" };
  const val = (k: keyof typeof seeded) => f[k] ?? seeded[k];
  const set = (k: string) => (e: { target: { value: string } }) => setF((p) => ({ ...p, [k]: e.target.value }));
  const termsComplete = [intOrNaN(val("commission")), intOrNaN(val("window")), intOrNaN(val("hold")), intOrNaN(val("min"))].every(Number.isFinite)
    && /^[a-z]{3}$/.test(val("currency").trim().toLowerCase()) && val("agreement").trim() !== "" && val("disclosure").trim() !== "";

  const saveDraft = useMutation(run(() => ownerSaveTermsDraft({
    version: nextVersion,
    commissionBps: intOrNaN(val("commission")),
    attributionWindowDays: intOrNaN(val("window")),
    holdDays: intOrNaN(val("hold")),
    minPayoutCents: intOrNaN(val("min")),
    currency: val("currency").trim().toLowerCase(),
    agreementText: val("agreement"),
    disclosureText: val("disclosure"),
  }).then((r) => { setF({}); return r; }), "Draft saved"));
  const activate = useMutation(run((v: number) => ownerActivateTerms(v), "Terms activated — program open"));
  const retire = useMutation(run((v: number) => ownerRetireTerms(v), "Terms retired — program closed"));
  const reviewApp = useMutation(run((a: { id: string; approve: boolean; note?: string | undefined }) => ownerReviewApplication(a.id, a.approve, a.note), "Application reviewed"));
  const setStatus = useMutation(run((a: { id: string; status: string; tax?: string }) => ownerSetPartnerStatus(a.id, a.status, a.tax), "Partner updated"));
  const addAdj = useMutation(run((a: Parameters<typeof ownerAddLedgerAdjustment>[0]) => ownerAddLedgerAdjustment(a), "Ledger adjustment added"));
  const fraud = useMutation(run((a: { id: string; reason: string }) => ownerRejectReferralForFraud(a.id, a.reason), "Referral rejected for fraud"));
  const reviewPay = useMutation(run((a: { id: string; approve: boolean; note?: string | undefined }) => ownerReviewPayout(a.id, a.approve, a.note), "Payout reviewed"));
  const markPaid = useMutation(run((a: { id: string; ref: string }) => ownerMarkPayoutPaid(a.id, a.ref), "Payout marked paid"));

  const [notes, setNotes] = useState<Record<string, string>>({});
  const note = (id: string) => notes[id] ?? "";
  const setNote = (id: string) => (e: { target: { value: string } }) => setNotes((p) => ({ ...p, [id]: e.target.value }));
  const [adj, setAdj] = useState({ partnerId: "", amount: "", currency: "", note: "", referralId: "", availableAt: "" });

  const affiliates = (partners.data ?? []).filter((p) => p.is_affiliate);

  return (
    <Section variant="primary" leading={<Handshake className="size-4" aria-hidden="true" />} title="Partner Program"
      description="Owner-only write controls. Each action is enforced server-side. No tax identifiers, documents, bank or card data are collected here. Stripe accrual is Phase 1B and not enabled."
      actions={<StatusBadge tone={active ? "green" : "muted"}>{active ? `Open · v${active.version}` : "Closed"}</StatusBadge>}>
      <div className="flex min-w-0 flex-col gap-6">
        {/* Terms */}
        <div className="flex min-w-0 flex-col gap-3">
          <h3 className="type-eyebrow text-gold">Terms</h3>
          {allTerms.length > 0 ? (
            <ul className="divide-y divide-border-subtle text-sm">
              {allTerms.map((t: PartnerTerms) => (
                <li key={t.id} className="flex min-w-0 flex-wrap items-center justify-between gap-2 py-2">
                  <span className={WRAP}>v{t.version} · {formatBps(t.commission_bps)} · {formatDays(t.attribution_window_days)} attribution · {formatDays(t.hold_days)} hold · min {formatMoney(t.min_payout_cents, t.currency)}</span>
                  <span className="flex flex-wrap gap-2">
                    <StatusBadge tone={t.status === "active" ? "green" : t.status === "draft" ? "gold" : "muted"}>{t.status}</StatusBadge>
                    {t.status === "active" ? (
                      <Confirm trigger={<Button size="sm" variant="outline" className="min-h-11" disabled={retire.isPending}>Retire</Button>}
                        title={`Retire terms v${t.version}?`} body="Retiring is permanent and closes the program to new applications, referrals and payout requests until another version is activated."
                        onConfirm={() => retire.mutate(t.version)} />
                    ) : null}
                  </span>
                </li>
              ))}
            </ul>
          ) : <p className="text-sm text-muted-foreground">No terms exist. The program is closed.</p>}
          <p className="text-xs text-muted-foreground">{draft ? `Editing draft v${draft.version}.` : `New draft will be v${nextVersion}.`} All fields are blank until you enter them.</p>
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
            <Field label="Commission (bps)"><Input className="min-h-11" inputMode="numeric" value={val("commission")} onChange={set("commission")} /></Field>
            <Field label="Attribution days"><Input className="min-h-11" inputMode="numeric" value={val("window")} onChange={set("window")} /></Field>
            <Field label="Hold days"><Input className="min-h-11" inputMode="numeric" value={val("hold")} onChange={set("hold")} /></Field>
            <Field label="Min payout (cents)"><Input className="min-h-11" inputMode="numeric" value={val("min")} onChange={set("min")} /></Field>
            <Field label="Currency (ISO)"><Input className="min-h-11" maxLength={3} value={val("currency")} onChange={set("currency")} /></Field>
          </div>
          <Field label="Agreement"><Textarea rows={3} value={val("agreement")} onChange={set("agreement")} /></Field>
          <Field label="Disclosure"><Textarea rows={2} value={val("disclosure")} onChange={set("disclosure")} /></Field>
          <div className="flex flex-wrap gap-2">
            <Button className="min-h-11" variant="outline" disabled={saveDraft.isPending} onClick={() => saveDraft.mutate(undefined)}>Save draft v{nextVersion}</Button>
            {draft ? (
              <Confirm trigger={<Button className="min-h-11" disabled={activate.isPending || !termsComplete || Object.keys(f).length > 0}>Activate v{draft.version}</Button>}
                title={`Activate terms v${draft.version}?`}
                body={`Activation opens the Partner Program: applications, referrals and payout requests become available under these terms.${active ? ` Active v${active.version} will be retired.` : ""} Active terms are frozen and cannot be edited.`}
                onConfirm={() => activate.mutate(draft.version)} />
            ) : null}
          </div>
          {draft && Object.keys(f).length > 0 ? <p className="text-xs text-muted-foreground">Save the draft before activating.</p> : null}
        </div>

        {/* Applications */}
        <div className="flex min-w-0 flex-col gap-2">
          <h3 className="type-eyebrow text-gold">Applications</h3>
          {(apps.data ?? []).length === 0 ? <p className="text-sm text-muted-foreground">No applications.</p> : (
            <ul className="divide-y divide-border-subtle text-sm">
              {(apps.data ?? []).map((a) => (
                <li key={a.id} className="flex min-w-0 flex-col gap-2 py-3">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="font-mono text-xs">user {short(a.user_id)}</span>
                    {a.wants_affiliate ? <StatusBadge tone="gold">Affiliate</StatusBadge> : null}
                    {a.wants_service_partner ? <StatusBadge tone="gold">Service</StatusBadge> : null}
                    <StatusBadge tone={a.status === "approved" ? "green" : a.status === "rejected" ? "red" : "muted"}>{a.status}</StatusBadge>
                    <span className="text-xs text-muted-foreground">{formatDate(a.submitted_at)} · terms v{a.terms_version}</span>
                  </div>
                  <p className={`text-muted-foreground ${WRAP}`}>{a.pitch}</p>
                  {a.status === "pending" ? (
                    <div className="flex min-w-0 flex-wrap gap-2">
                      <Input className="min-h-11 min-w-0 flex-1" placeholder="Review note (visible to applicant)" value={note(a.id)} onChange={setNote(a.id)} />
                      <Button className="min-h-11" disabled={reviewApp.isPending} onClick={() => reviewApp.mutate({ id: a.id, approve: true, note: note(a.id) || undefined })}>Approve</Button>
                      <Button className="min-h-11" variant="outline" disabled={reviewApp.isPending} onClick={() => reviewApp.mutate({ id: a.id, approve: false, note: note(a.id) || undefined })}>Reject</Button>
                    </div>
                  ) : a.review_note ? <p className="text-xs text-muted-foreground">Review note: {a.review_note}</p> : null}
                </li>
              ))}
            </ul>
          )}
        </div>

        {/* Partners */}
        <div className="flex min-w-0 flex-col gap-2">
          <h3 className="type-eyebrow text-gold">Partners</h3>
          {(partners.data ?? []).length === 0 ? <p className="text-sm text-muted-foreground">No partners.</p> : (
            <ul className="divide-y divide-border-subtle text-sm">
              {(partners.data ?? []).map((p) => (
                <li key={p.id} className="flex min-w-0 flex-wrap items-center gap-2 py-3">
                  <span className="font-mono text-xs">{short(p.id)}</span>
                  {p.is_affiliate ? <StatusBadge tone="gold">Affiliate</StatusBadge> : null}
                  {p.is_service_partner ? <StatusBadge tone="gold">Service</StatusBadge> : null}
                  <StatusBadge tone={p.status === "approved" ? "green" : "red"}>{p.status}</StatusBadge>
                  <span className="text-xs text-muted-foreground">tax: {p.tax_doc_status}</span>
                  {p.referral_code ? <span className="font-mono text-xs">code {p.referral_code}</span> : null}
                  <select aria-label="Partner status" className="min-h-11 rounded-md border border-border-subtle bg-background px-2 text-sm" value={p.status}
                    onChange={(e) => setStatus.mutate({ id: p.id, status: e.target.value })}>
                    {["approved", "suspended", "terminated"].concat(["approved", "suspended", "terminated"].includes(p.status) ? [] : [p.status]).map((s) => <option key={s} value={s}>{s}</option>)}
                  </select>
                  <select aria-label="Tax readiness" className="min-h-11 rounded-md border border-border-subtle bg-background px-2 text-sm" value={p.tax_doc_status}
                    onChange={(e) => setStatus.mutate({ id: p.id, status: p.status, tax: e.target.value })}>
                    {["not_submitted", "submitted", "verified", "rejected"].map((s) => <option key={s} value={s}>{s}</option>)}
                  </select>
                </li>
              ))}
            </ul>
          )}
        </div>

        {/* Manual ledger */}
        <div className="flex min-w-0 flex-col gap-2">
          <h3 className="type-eyebrow text-gold">Manual ledger adjustment (affiliates only)</h3>
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            <Field label="Affiliate">
              <select className="min-h-11 rounded-md border border-border-subtle bg-background px-2 text-sm" value={adj.partnerId} onChange={(e) => setAdj({ ...adj, partnerId: e.target.value })}>
                <option value="">Select…</option>
                {affiliates.map((p) => <option key={p.id} value={p.id}>{short(p.id)}{p.referral_code ? ` · ${p.referral_code}` : ""}</option>)}
              </select>
            </Field>
            <Field label="Amount (cents, ±)"><Input className="min-h-11" inputMode="numeric" value={adj.amount} onChange={(e) => setAdj({ ...adj, amount: e.target.value })} /></Field>
            <Field label="Currency (ISO)"><Input className="min-h-11" maxLength={3} value={adj.currency} onChange={(e) => setAdj({ ...adj, currency: e.target.value })} /></Field>
            <Field label="Referral ID (optional)"><Input className="min-h-11" value={adj.referralId} onChange={(e) => setAdj({ ...adj, referralId: e.target.value })} /></Field>
            <Field label="Available at (optional)"><Input className="min-h-11" type="datetime-local" value={adj.availableAt} onChange={(e) => setAdj({ ...adj, availableAt: e.target.value })} /></Field>
            <Field label="Note (required)"><Input className="min-h-11" value={adj.note} onChange={(e) => setAdj({ ...adj, note: e.target.value })} /></Field>
          </div>
          <Button className="min-h-11 self-start" disabled={addAdj.isPending || !adj.partnerId || !Number.isInteger(Number(adj.amount)) || Number(adj.amount) === 0 || !/^[a-zA-Z]{3}$/.test(adj.currency) || !adj.note.trim()}
            onClick={() => addAdj.mutate({
              partnerId: adj.partnerId, amountCents: Number(adj.amount), currency: adj.currency.toLowerCase(), note: adj.note.trim(),
              referralId: adj.referralId.trim() || undefined,
              availableAt: adj.availableAt ? new Date(adj.availableAt).toISOString() : undefined,
            }, { onSuccess: () => setAdj({ partnerId: "", amount: "", currency: "", note: "", referralId: "", availableAt: "" }) })}>
            Add adjustment
          </Button>
          {(ledger.data ?? []).length > 0 ? (
            <ul className="divide-y divide-border-subtle text-sm">
              {(ledger.data ?? []).map((l) => (
                <li key={l.id} className="flex min-w-0 flex-wrap justify-between gap-2 py-2">
                  <span className={WRAP}>{short(l.partner_id)} · {l.entry_type} · {formatDate(l.created_at)}{l.note ? ` · ${l.note}` : ""}</span>
                  <span className="font-mono">{formatMoney(l.amount_cents, l.currency)}</span>
                </li>
              ))}
            </ul>
          ) : <p className="text-sm text-muted-foreground">No ledger entries.</p>}
        </div>

        {/* Referrals */}
        <div className="flex min-w-0 flex-col gap-2">
          <h3 className="type-eyebrow text-gold">Referrals</h3>
          {(referrals.data ?? []).length === 0 ? <p className="text-sm text-muted-foreground">No referrals.</p> : (
            <ul className="divide-y divide-border-subtle text-sm">
              {(referrals.data ?? []).map((r) => (
                <li key={r.id} className="flex min-w-0 flex-col gap-2 py-3">
                  <div className="flex flex-wrap items-center gap-2 text-xs">
                    <span className="font-mono">ref {short(r.id)} · partner {short(r.partner_id)} · user {short(r.referred_user_id)} · workspace {short(r.workspace_id)}</span>
                    <StatusBadge tone={r.status === "qualified" ? "green" : r.status === "pending" ? "gold" : "red"}>{r.status}</StatusBadge>
                    <span className="text-muted-foreground">{formatDate(r.attributed_at)}{r.reason ? ` · ${r.reason}` : ""}</span>
                  </div>
                  {r.status === "pending" || r.status === "qualified" ? (
                    <div className="flex min-w-0 flex-wrap gap-2">
                      <Input className="min-h-11 min-w-0 flex-1" placeholder="Fraud reason (required)" value={note(r.id)} onChange={setNote(r.id)} />
                      <Confirm trigger={<Button variant="outline" className="min-h-11" disabled={fraud.isPending || !note(r.id).trim()}>Reject for fraud</Button>}
                        title="Reject referral for fraud?" body="This is permanent. Existing ledger entries are not reversed automatically; add a manual adjustment if needed."
                        onConfirm={() => fraud.mutate({ id: r.id, reason: note(r.id).trim() })} />
                    </div>
                  ) : null}
                </li>
              ))}
            </ul>
          )}
        </div>

        {/* Payouts */}
        <div className="flex min-w-0 flex-col gap-2">
          <h3 className="type-eyebrow text-gold">Payouts</h3>
          {(payouts.data ?? []).length === 0 ? <p className="text-sm text-muted-foreground">No payout requests.</p> : (
            <ul className="divide-y divide-border-subtle text-sm">
              {(payouts.data ?? []).map((p) => (
                <li key={p.id} className="flex min-w-0 flex-col gap-2 py-3">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="font-mono text-xs">partner {short(p.partner_id)}</span>
                    <span className="font-mono">{formatMoney(p.amount_cents, p.currency)}</span>
                    <StatusBadge tone={p.status === "paid" ? "green" : p.status === "rejected" ? "red" : "gold"}>{p.status}</StatusBadge>
                    <span className="text-xs text-muted-foreground">{formatDate(p.requested_at)}{p.paid_reference ? ` · ref ${p.paid_reference}` : ""}</span>
                  </div>
                  {p.status === "requested" ? (
                    <div className="flex min-w-0 flex-wrap gap-2">
                      <Input className="min-h-11 min-w-0 flex-1" placeholder="Review note" value={note(p.id)} onChange={setNote(p.id)} />
                      <Button className="min-h-11" disabled={reviewPay.isPending} onClick={() => reviewPay.mutate({ id: p.id, approve: true, note: note(p.id) || undefined })}>Approve</Button>
                      <Button className="min-h-11" variant="outline" disabled={reviewPay.isPending} onClick={() => reviewPay.mutate({ id: p.id, approve: false, note: note(p.id) || undefined })}>Reject</Button>
                    </div>
                  ) : p.status === "approved" ? (
                    <div className="flex min-w-0 flex-wrap gap-2">
                      <Input className="min-h-11 min-w-0 flex-1" placeholder="External payment reference (required)" value={note(p.id)} onChange={setNote(p.id)} />
                      <Button className="min-h-11" disabled={markPaid.isPending || !note(p.id).trim()} onClick={() => markPaid.mutate({ id: p.id, ref: note(p.id).trim() })}>Mark paid</Button>
                    </div>
                  ) : null}
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>
    </Section>
  );
}
