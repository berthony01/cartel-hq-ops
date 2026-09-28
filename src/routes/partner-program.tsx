import { createFileRoute, Link } from "@tanstack/react-router";
import { ArrowRight, BriefcaseBusiness, Check, Handshake, Users } from "lucide-react";
import { buttonVariants } from "@/components/ui/button";
import { LegalFooter } from "@/components/cartel/LegalFooter";
import { cn } from "@/lib/utils";

const TITLE = "Partner Program — Affiliates & Service Partners | CARTEL HQ";
const DESCRIPTION =
  "Learn how the CARTEL HQ Partner Program will distinguish approved Affiliates from Service Partners, including draft economics and eligibility requirements.";

const ECONOMICS = [
  ["Commission", "20%"],
  ["Duration", "First 12 paid monthly invoices"],
  ["Attribution", "30 days"],
  ["Hold", "45 days"],
  ["Minimum", "$50 USD"],
  ["Payouts", "Monthly, manual"],
] as const;

const STEPS = [
  ["01", "Application", "Apply for the Affiliate track, Service Partner track, or both when applications open."],
  ["02", "Owner review", "CARTEL HQ reviews the applicant, intended services, and program fit."],
  ["03", "Agreement and tax readiness", "Approved applicants must accept the active agreement and complete required tax readiness."],
  ["04", "Approved activity", "Affiliates use an approved referral link. Service Partners provide client services independently."],
  ["05", "Owner-reviewed payout", "Eligible Affiliate ledger entries follow the hold period and monthly manual payout process."],
] as const;

export const Route = createFileRoute("/partner-program")({
  head: () => ({
    meta: [
      { title: TITLE },
      { name: "description", content: DESCRIPTION },
      { property: "og:title", content: TITLE },
      { property: "og:description", content: DESCRIPTION },
      { property: "og:type", content: "website" },
      { property: "og:url", content: "https://pepecartelhq.com/partner-program" },
      { name: "twitter:card", content: "summary_large_image" },
      { name: "twitter:title", content: TITLE },
      { name: "twitter:description", content: DESCRIPTION },
    ],
    links: [{ rel: "canonical", href: "https://pepecartelhq.com/partner-program" }],
  }),
  component: PartnerProgramPage,
});

function PublicHeader() {
  return (
    <header className="app-gutter sticky top-0 z-30 flex min-h-14 items-center justify-between gap-3 border-b border-border-subtle bg-background/88 py-2 backdrop-blur-xl lg:min-h-16">
      <Link to="/" className="flex min-w-0 items-center gap-2">
        <span className="flex size-8 shrink-0 items-center justify-center rounded-md border border-gold/40 bg-surface-raised font-display text-sm text-gold">C</span>
        <span className="truncate font-display text-lg uppercase tracking-widest text-gold">CARTEL HQ</span>
      </Link>
      <nav aria-label="Public" className="flex items-center gap-1">
        <Link to="/docs" className="inline-flex min-h-11 items-center px-3 text-xs font-semibold text-muted-foreground hover:text-gold">Documentation</Link>
        <Link to="/auth" className={cn(buttonVariants({ size: "sm" }), "min-h-11")}>Create account / Sign in</Link>
      </nav>
    </header>
  );
}

function PartnerProgramPage() {
  return (
    <div className="min-h-screen bg-background text-foreground">
      <PublicHeader />
      <main>
        <section className="app-gutter mx-auto max-w-6xl py-14 sm:py-20">
          <div className="max-w-4xl">
            <p className="inline-flex min-h-8 items-center rounded-sm border border-gold/40 bg-gold/8 px-3 text-[10px] font-bold uppercase tracking-[0.16em] text-gold">Preparing to open</p>
            <h1 className="mt-5 font-display text-5xl uppercase leading-[0.95] text-foreground sm:text-7xl">CARTEL HQ Partner Program</h1>
            <p className="mt-6 max-w-3xl text-base leading-7 text-muted-foreground sm:text-lg">
              One program, two distinct tracks for people who refer customers or help project teams operate CARTEL HQ. Applications are not open yet.
            </p>
          </div>
        </section>

        <section className="border-y border-border-subtle bg-surface/50">
          <div className="app-gutter mx-auto grid max-w-6xl gap-5 py-12 md:grid-cols-2">
            <article className="cartel-panel rounded-lg p-6">
              <Users className="size-6 text-gold" aria-hidden="true" />
              <h2 className="mt-4 font-display text-3xl uppercase text-foreground">Affiliate</h2>
              <p className="mt-3 text-sm leading-6 text-muted-foreground">
                Refers customers through an approved referral link. CARTEL HQ bills the customer directly. Commission applies only to eligible collected subscription revenue after Affiliate approval and active terms.
              </p>
            </article>
            <article className="cartel-panel rounded-lg p-6">
              <BriefcaseBusiness className="size-6 text-pepe" aria-hidden="true" />
              <h2 className="mt-4 font-display text-3xl uppercase text-foreground">Service Partner</h2>
              <p className="mt-3 text-sm leading-6 text-muted-foreground">
                Charges clients separately for setup or management while the client pays CARTEL HQ directly. Service Partner status alone grants zero client workspace access and earns no CARTEL HQ commission unless the partner is separately approved as an Affiliate.
              </p>
            </article>
          </div>
        </section>

        <section className="app-gutter mx-auto max-w-6xl py-14 sm:py-20">
          <p className="type-eyebrow text-gold">The review path</p>
          <h2 className="mt-3 font-display text-4xl uppercase text-foreground">How joining will work</h2>
          <ol className="mt-8 grid gap-3 lg:grid-cols-5">
            {STEPS.map(([number, title, body]) => (
              <li key={number} className="border-t border-gold/35 pt-4">
                <span className="font-mono text-xs text-gold">{number}</span>
                <h3 className="mt-2 text-sm font-semibold text-foreground">{title}</h3>
                <p className="mt-2 text-xs leading-5 text-muted-foreground">{body}</p>
              </li>
            ))}
          </ol>
        </section>

        <section className="border-y border-gold/25 bg-surface">
          <div className="app-gutter mx-auto max-w-6xl py-14">
            <div className="flex flex-wrap items-center gap-3">
              <Handshake className="size-6 text-gold" aria-hidden="true" />
              <h2 className="font-display text-4xl uppercase text-foreground">Draft economics, not active</h2>
            </div>
            <dl className="mt-7 grid gap-px overflow-hidden rounded-lg border border-border-subtle bg-border-subtle sm:grid-cols-2 lg:grid-cols-3">
              {ECONOMICS.map(([term, value]) => (
                <div key={term} className="bg-surface-raised p-5">
                  <dt className="type-eyebrow text-muted-foreground">{term}</dt>
                  <dd className="mt-2 text-base font-semibold text-foreground">{value}</dd>
                </div>
              ))}
            </dl>
            <p className="mt-6 max-w-4xl text-sm leading-6 text-muted-foreground">
              Taxes, discounts, credits, refunds, disputes, setup or service fees, and high-cost usage purchases are excluded. No one earns or is owed commission until active terms exist, the applicant is approved, the current agreement is accepted, tax readiness is verified, and an eligible ledger entry exists.
            </p>
          </div>
        </section>

        <section className="app-gutter mx-auto max-w-4xl py-16 text-center">
          <Check className="mx-auto size-6 text-pepe" aria-hidden="true" />
          <h2 className="mt-4 font-display text-4xl uppercase text-foreground">Build your CARTEL HQ foundation</h2>
          <p className="mx-auto mt-3 max-w-2xl text-sm leading-6 text-muted-foreground">Create a free account or sign in today. Partner applications will be announced separately when the program is ready.</p>
          <div className="mt-6 flex flex-col justify-center gap-3 sm:flex-row">
            <Link to="/auth" search={{ mode: "signup" }} className={cn(buttonVariants({ size: "lg" }), "min-h-11 gap-2")}>Create account / Sign in <ArrowRight className="size-4" aria-hidden="true" /></Link>
            <Link to="/legal/partner-agreement" className={cn(buttonVariants({ variant: "outline", size: "lg" }), "min-h-11")}>Read the draft Partner Agreement</Link>
          </div>
        </section>
      </main>
      <footer className="app-gutter border-t border-border-subtle py-6"><LegalFooter /></footer>
    </div>
  );
}