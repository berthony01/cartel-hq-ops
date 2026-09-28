import { useState } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Handshake, Info, Loader2 } from "lucide-react";
import { PageHeader } from "@/components/cartel/PageHeader";
import { Section } from "@/components/cartel/Section";
import { StatusBadge } from "@/components/cartel/StatusBadge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { useSession } from "@/hooks/useSession";
import {
  acceptPartnerAgreement,
  fetchActiveTerms,
  fetchMyPartnerData,
  fetchMyPartnerSummary,
  formatBps,
  formatDate,
  formatDays,
  formatMoney,
  partnerErrorMessage,
  partnerKeys,
  DRAFT_ECONOMICS,
  LEDGER_ENTRY_LABELS,
  ledgerBreakdown,
  requestPartnerPayout,
  submitPartnerApplication,
  type PartnerTerms,
} from "@/lib/partners";

export const Route = createFileRoute("/_authenticated/partners")({
  head: () => ({
    meta: [
      { title: "Partner Program — CARTEL HQ" },
      { name: "description", content: "Apply to the CARTEL HQ Affiliate and Service Partner program and track your status." },
      { property: "og:title", content: "Partner Program — CARTEL HQ" },
      { property: "og:description", content: "Affiliate and Service Partner program for CARTEL HQ." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: PartnersPage,
});

const WRAP = "[overflow-wrap:anywhere]";

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="surface-quiet min-w-0 rounded-md p-3">
      <p className="type-eyebrow text-muted-foreground">{label}</p>
      <p className={`mt-1 font-display text-xl text-foreground ${WRAP}`}>{value}</p>
    </div>
  );
}

function DraftEconomicsPanel() {
  const d = DRAFT_ECONOMICS;
  return (
    <Section title="Draft economics · not effective" leading={<Info className="size-4" aria-hidden="true" />}
      actions={<StatusBadge tone="muted">Draft</StatusBadge>}
      description="Proposed terms under review. Nothing is earned or payable until the platform owner activates a terms version.">
      <div className="grid gap-3 sm:grid-cols-3 lg:grid-cols-4">
        <Stat label="Commission" value={d.commissionLabel} />
        <Stat label="Duration" value={d.durationLabel} />
        <Stat label="Attribution" value={d.attributionLabel} />
        <Stat label="Hold" value={d.holdLabel} />
        <Stat label="Minimum payout" value={d.minimumLabel} />
        <Stat label="Currency" value={d.currencyLabel} />
        <Stat label="Payout" value={d.payoutLabel} />
      </div>
      <p className="mt-3 text-xs text-muted-foreground">Applies only to eligible collected subscription revenue. Tax, discounts, credits, refunds, disputes, setup and service fees are excluded.</p>
    </Section>
  );
}

function TermsPanel({ terms }: { terms: PartnerTerms }) {
  const duration = (terms as PartnerTerms & { commission_duration_invoices?: number | null }).commission_duration_invoices;
  return (
    <Section title={`Active terms · v${terms.version}`} leading={<Info className="size-4" aria-hidden="true" />}>
      <div className="grid gap-3 sm:grid-cols-3 lg:grid-cols-4">
        <Stat label="Commission" value={formatBps(terms.commission_bps)} />
        <Stat label="Duration" value={typeof duration === "number" ? `First ${duration} paid invoices` : "—"} />
        <Stat label="Attribution" value={formatDays(terms.attribution_window_days)} />
        <Stat label="Hold" value={formatDays(terms.hold_days)} />
        <Stat label="Minimum payout" value={formatMoney(terms.min_payout_cents, terms.currency)} />
        <Stat label="Currency" value={terms.currency ? terms.currency.toUpperCase() : "—"} />
        <Stat label="Payout" value="Monthly, manual" />
      </div>
      {terms.agreement_text ? (
        <div className="mt-4">
          <p className="type-eyebrow text-gold">Agreement</p>
          <p className={`mt-1 whitespace-pre-wrap text-sm leading-relaxed text-muted-foreground ${WRAP}`}>{terms.agreement_text}</p>
        </div>
      ) : null}
      {terms.disclosure_text ? (
        <div className="mt-4">
          <p className="type-eyebrow text-gold">Disclosure</p>
          <p className={`mt-1 whitespace-pre-wrap text-sm leading-relaxed text-muted-foreground ${WRAP}`}>{terms.disclosure_text}</p>
        </div>
      ) : null}
    </Section>
  );
}

function PartnersPage() {
  const { user } = useSession();
  const userId = user?.id ?? null;
  const qc = useQueryClient();
  const invalidate = () => qc.invalidateQueries({ queryKey: partnerKeys.all });

  const terms = useQuery({ queryKey: partnerKeys.activeTerms(), queryFn: fetchActiveTerms });
  const summary = useQuery({ queryKey: partnerKeys.summary(userId), queryFn: fetchMyPartnerSummary, enabled: !!userId });
  const mine = useQuery({ queryKey: partnerKeys.mine(userId), queryFn: () => fetchMyPartnerData(userId!), enabled: !!userId });

  const [wantsAffiliate, setWantsAffiliate] = useState(false);
  const [wantsService, setWantsService] = useState(false);
  const [pitch, setPitch] = useState("");
  const [payoutAmount, setPayoutAmount] = useState("");

  const apply = useMutation({
    mutationFn: () => submitPartnerApplication({ wantsAffiliate, wantsServicePartner: wantsService, pitch: pitch.trim() }),
    onSuccess: () => { toast.success("Application submitted"); setPitch(""); invalidate(); },
    onError: (e) => toast.error(partnerErrorMessage(e)),
  });
  const accept = useMutation({
    mutationFn: (v: number) => acceptPartnerAgreement(v),
    onSuccess: () => { toast.success("Agreement accepted"); invalidate(); },
    onError: (e) => toast.error(partnerErrorMessage(e)),
  });
  const payout = useMutation({
    mutationFn: (cents: number) => requestPartnerPayout(cents),
    onSuccess: () => { toast.success("Payout requested for owner review"); setPayoutAmount(""); invalidate(); },
    onError: (e) => toast.error(partnerErrorMessage(e)),
  });

  const loading = terms.isPending || summary.isPending || mine.isPending;
  const loadError = terms.error || summary.error || mine.error;
  const activeTerms = terms.data ?? null;
  const programOpen = activeTerms !== null;
  const s = summary.data;
  const data = mine.data;
  const partner = data?.partner ?? null;
  const latestApp = data?.applications[0] ?? null;
  const pendingApp = data?.applications.find((a) => a.status === "pending") ?? null;
  const currency = s?.currency ?? null;
  const isAffiliate = partner?.is_affiliate === true;
  const approved = partner?.status === "approved";
  const accepted = s?.agreement_accepted === true;
  const payoutCents = Math.round(Number(payoutAmount) * 100);
  const canRequestPayout = isAffiliate && approved && partner?.tax_doc_status === "verified" && accepted && programOpen;
  const reservedCents = (data?.payouts ?? []).filter((p) => p.status === "requested" || p.status === "approved").reduce((t, p) => t + p.amount_cents, 0);
  const bd = ledgerBreakdown(data?.ledger ?? [], reservedCents);
  const referralLink = partner?.referral_code && typeof window !== "undefined"
    ? `${window.location.origin}/auth?mode=signup&ref=${partner.referral_code}` : null;

  return (
    <div className="flex min-w-0 flex-col gap-5 sm:gap-6">
      <PageHeader
        eyebrow="Network"
        title="Partner Program"
        description="Affiliates refer customers. Service Partners run setup and management for their own clients. CARTEL HQ always bills the customer directly."
        status={programOpen ? "Open" : "Closed"}
      />

      <div role="note" className="rounded-md border border-gold/35 bg-gold/5 px-4 py-3 text-xs leading-relaxed text-foreground sm:text-sm">
        Automated Stripe commission accrual, refund and dispute handling is staged and not active yet.
        Until it is enabled, ledger adjustments and payouts are owner-reviewed and manual. No commission is shown
        unless a ledger entry exists.
      </div>

      {loading ? (
        <div className="flex items-center gap-2 text-sm text-muted-foreground"><Loader2 className="size-4 animate-spin text-gold" aria-hidden="true" />Loading partner status…</div>
      ) : loadError ? (
        <Section variant="quiet" title="Partner status unavailable" description={partnerErrorMessage(loadError)} />
      ) : (
        <>
          {!programOpen ? (
            <>
              <DraftEconomicsPanel />
              <Section variant="primary" title="Applications are not open" description="There are no active program terms yet, so new applications cannot be submitted. Existing partners can still review their status and history below." />
            </>
          ) : (
            <TermsPanel terms={activeTerms} />
          )}

          {!partner ? (
            pendingApp ? (
              <Section title="Application pending" actions={<StatusBadge tone="gold">Pending</StatusBadge>}
                description={`Submitted ${formatDate(pendingApp.submitted_at)}. The platform owner reviews every application.`} />
            ) : (
              <>
                {latestApp ? (
                  <Section variant="quiet" title="Previous application"
                    actions={<StatusBadge tone={latestApp.status === "rejected" ? "red" : "muted"}>{latestApp.status}</StatusBadge>}
                    description={latestApp.review_note ? `Review note: ${latestApp.review_note}` : `Reviewed ${formatDate(latestApp.reviewed_at)}`} />
                ) : null}
                {programOpen ? (
                  <Section variant="primary" title="Apply" leading={<Handshake className="size-4" aria-hidden="true" />}>
                    <form className="flex min-w-0 flex-col gap-4" onSubmit={(e) => { e.preventDefault(); apply.mutate(); }}>
                      <label className="flex min-h-11 items-start gap-3 text-sm">
                        <input type="checkbox" className="mt-1 size-4 accent-[var(--gold)]" checked={wantsAffiliate} onChange={(e) => setWantsAffiliate(e.target.checked)} />
                        <span><strong className="text-foreground">Affiliate</strong> — refer customers. CARTEL HQ bills the customer; commission applies only to eligible collected subscription revenue, once Phase 1B is enabled.</span>
                      </label>
                      <label className="flex min-h-11 items-start gap-3 text-sm">
                        <input type="checkbox" className="mt-1 size-4 accent-[var(--gold)]" checked={wantsService} onChange={(e) => setWantsService(e.target.checked)} />
                        <span><strong className="text-foreground">Service Partner</strong> — charge your client separately for setup/management. The client still pays CARTEL HQ directly. Service Partner identity grants zero workspace access.</span>
                      </label>
                      <div>
                        <label htmlFor="partner-pitch" className="text-sm font-semibold">Pitch (required)</label>
                        <Textarea id="partner-pitch" required className="mt-2" rows={4} maxLength={1000} value={pitch} onChange={(e) => setPitch(e.target.value)} placeholder="Who you work with and how you would refer or serve projects." />
                      </div>
                      <Button type="submit" className="min-h-11 self-start" disabled={apply.isPending || !pitch.trim() || (!wantsAffiliate && !wantsService)}>
                        {apply.isPending ? <Loader2 className="size-4 animate-spin" aria-hidden="true" /> : null}Submit application
                      </Button>
                    </form>
                  </Section>
                ) : null}
              </>
            )
          ) : (
            <>
              <Section variant="primary" title="Your partner account"
                actions={<>
                  {partner.is_affiliate ? <StatusBadge tone="gold">Affiliate</StatusBadge> : null}
                  {partner.is_service_partner ? <StatusBadge tone="gold">Service Partner</StatusBadge> : null}
                  <StatusBadge tone={approved ? "green" : "red"}>{partner.status}</StatusBadge>
                </>}>
                <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
                  <Stat label="Tax readiness" value={partner.tax_doc_status.replace(/_/g, " ")} />
                  <Stat label="Agreement" value={programOpen ? (accepted ? `Accepted v${activeTerms.version}` : "Not accepted") : "No active terms"} />
                  <Stat label="Referrals" value={String(s?.referrals_total ?? data?.referrals.length ?? 0)} />
                  <Stat label="Currency" value={currency ? currency.toUpperCase() : "—"} />
                </div>
                {partner.is_service_partner ? (
                  <p className="mt-3 text-xs text-muted-foreground">Service Partner identity grants no access to any client workspace.</p>
                ) : null}
                {isAffiliate && partner.referral_code ? (
                  <div className="mt-4 min-w-0">
                    <p className="type-eyebrow text-gold">Referral code</p>
                    <p className="mt-1 font-mono text-sm">{partner.referral_code}</p>
                    {referralLink ? (
                      <div className="mt-2 flex min-w-0 flex-wrap gap-2">
                        <Input readOnly value={referralLink} className="min-h-11 min-w-0 flex-1 font-mono text-xs" aria-label="Referral link" />
                        <Button type="button" variant="outline" className="min-h-11" onClick={() => { void navigator.clipboard?.writeText(referralLink); toast.success("Link copied"); }}>Copy</Button>
                      </div>
                    ) : null}
                    <p className="mt-2 text-xs text-muted-foreground">Share the code-based link. Visitors receive a short-lived server-issued token; no code or timestamp is trusted from the browser. Referral link capture is staged and not active in this preview.</p>
                  </div>
                ) : null}
                {programOpen && !accepted ? (
                  <Button className="mt-4 min-h-11" disabled={accept.isPending} onClick={() => accept.mutate(activeTerms.version)}>
                    Accept agreement v{activeTerms.version}
                  </Button>
                ) : null}
              </Section>

              {!isAffiliate ? (
                <Section variant="quiet" title="No Cartel commission"
                  description="Service Partner only: you earn no CARTEL HQ commission. You bill your own clients separately for setup/management, and they pay CARTEL HQ directly. Commission requires separate approval as an Affiliate." />
              ) : null}

              <Section title="Balances">
                <div className="grid gap-3 sm:grid-cols-3 lg:grid-cols-4">
                  <Stat label="Held (in hold period)" value={formatMoney(bd.held, currency)} />
                  <Stat label="Available" value={formatMoney(bd.available, currency)} />
                  <Stat label="Paid" value={formatMoney(bd.paid, currency)} />
                  <Stat label="Reversed" value={formatMoney(bd.reversed, currency)} />
                  <Stat label="Restored" value={formatMoney(bd.restored, currency)} />
                  <Stat label="Reserved for requests" value={formatMoney(bd.reservedForPayouts, currency)} />
                  <Stat label="Net payable" value={formatMoney(bd.netPayable, currency)} />
                  <Stat label="Server available" value={formatMoney(s?.available_cents ?? 0, currency)} />
                </div>
                <p className="mt-3 text-xs leading-relaxed text-muted-foreground">
                  Balances above are shown from your ledger for transparency; the server validates every payout request.
                  If refunds or disputes reverse commission already paid, the available balance can go negative. A negative
                  balance is carried forward and offset against future commission; nothing is deleted.
                  {bd.carryForward < 0 ? ` Current carry-forward: ${formatMoney(bd.carryForward, currency)}.` : ""}
                </p>
                {canRequestPayout ? (
                  <form className="mt-4 flex min-w-0 flex-wrap items-end gap-2" onSubmit={(e) => { e.preventDefault(); if (payoutCents > 0) payout.mutate(payoutCents); }}>
                    <div className="min-w-0">
                      <label htmlFor="payout-amount" className="text-sm font-semibold">Request payout ({activeTerms?.currency?.toUpperCase()})</label>
                      <Input id="payout-amount" type="number" min="0" step="0.01" inputMode="decimal" className="mt-2 min-h-11 w-40" value={payoutAmount} onChange={(e) => setPayoutAmount(e.target.value)} />
                    </div>
                    <Button type="submit" className="min-h-11" disabled={payout.isPending || !(payoutCents > 0)}>Request payout</Button>
                  </form>
                ) : isAffiliate ? (
                  <p className="mt-3 text-xs text-muted-foreground">Payout requests need approved affiliate status, verified tax readiness, accepted current terms and an open program.</p>
                ) : null}
              </Section>

              <Section title="Ledger">
                {data && data.ledger.length > 0 ? (
                  <ul className="divide-y divide-border-subtle text-sm">
                    {data.ledger.map((l) => (
                      <li key={l.id} className="flex min-w-0 flex-wrap justify-between gap-2 py-2">
                        <span className={WRAP}>
                          {LEDGER_ENTRY_LABELS[l.entry_type] ?? l.entry_type} · {formatDate(l.created_at)}
                          {l.amount_cents > 0 && new Date(l.available_at).getTime() > Date.now() ? ` · held until ${formatDate(l.available_at)}` : ""}
                          {l.terms_version ? ` · terms v${l.terms_version}` : ""}
                        </span>
                        <span className="font-mono">{formatMoney(l.amount_cents, l.currency)}</span>
                      </li>
                    ))}
                  </ul>
                ) : <p className="text-sm text-muted-foreground">No ledger entries yet.</p>}
              </Section>

              <Section title="Payout history">
                {data && data.payouts.length > 0 ? (
                  <ul className="divide-y divide-border-subtle text-sm">
                    {data.payouts.map((p) => (
                      <li key={p.id} className="flex min-w-0 flex-wrap justify-between gap-2 py-2">
                        <span className={WRAP}>{formatDate(p.requested_at)} · {p.status}{p.review_note ? ` · ${p.review_note}` : ""}</span>
                        <span className="font-mono">{formatMoney(p.amount_cents, p.currency)}</span>
                      </li>
                    ))}
                  </ul>
                ) : <p className="text-sm text-muted-foreground">No payout requests yet.</p>}
              </Section>
            </>
          )}
        </>
      )}
    </div>
  );
}
