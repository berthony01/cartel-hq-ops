import { createFileRoute, Link } from "@tanstack/react-router";
import { SERVICE_PARTNER_DISCLOSURE } from "@/lib/legal-policies";
import { useQuery } from "@tanstack/react-query";
import { ArrowRight, BriefcaseBusiness, Check, Clock, ShieldAlert, X } from "lucide-react";
import { buttonVariants } from "@/components/ui/button";
import { LegalFooter } from "@/components/cartel/LegalFooter";
import { fetchPartnerProgramStatus, partnerKeys } from "@/lib/partners";
import { cn } from "@/lib/utils";

const TITLE = "Service Partner Program — Offer Services with CARTEL HQ";
const DESCRIPTION =
  "Independent businesses can offer setup, configuration, creative, training and operational services to CARTEL HQ customers. No fee to apply. No earnings guaranteed. Affiliate Program not open.";

const FACTS = [
  "No fee to apply or to be approved.",
  "No CARTEL HQ purchase is required for approval.",
  "You find your own clients and set and collect your own service fees.",
  "CARTEL HQ provides no leads, employment, wages, commissions or guaranteed earnings.",
  "You, not CARTEL HQ, contract with and support your client for your independent service.",
  "Every client controls its own account and pays CARTEL HQ directly for any CARTEL HQ plan.",
  "Service Partner status alone grants no access to any client account or workspace.",
  "Never share or request credentials, wallet private keys, seed phrases or payment-card data.",
] as const;

const SERVICES = [
  ["Setup", "Creating the client's project, completing Project Identity and connecting its Telegram community."],
  ["Configuration", "Configuring welcome onboarding, Launch Control stages and Launch Watch for the client."],
  ["Creative", "Producing brand-consistent stickers and visual assets with the client's own plan features."],
  ["Training", "Teaching the client's team to run Community Command, launches and missions themselves."],
  ["Operations", "Helping operate day-to-day workflows the client authorizes inside the product."],
] as const;

const STEPS = [
  ["01", "Create or sign in", "Use a free CARTEL HQ account. No purchase is needed to apply."],
  ["02", "Apply", "Describe your services, experience, intended customers and promotion channels."],
  ["03", "Owner review", "CARTEL HQ reviews every application and approves or declines in writing."],
  ["04", "Accept the agreement", "Approved partners accept the current Service Partner Agreement version."],
  ["05", "Serve your clients", "Work under your own client agreements, with the required disclosure on your promotions."],
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
        <Link to="/docs" hash="partner-program" className="inline-flex min-h-11 items-center px-3 text-xs font-semibold text-muted-foreground hover:text-gold">Guide</Link>
        <Link to="/auth" search={{ redirect: "/partners" }} className={cn(buttonVariants({ size: "sm" }), "min-h-11")}>Sign in</Link>
      </nav>
    </header>
  );
}

/** Database-backed track status (public read of two booleans). Fails closed. */
function useProgramStatus() {
  return useQuery({ queryKey: partnerKeys.status(), queryFn: fetchPartnerProgramStatus, staleTime: 60_000 });
}

function ServiceStatusBadge() {
  const status = useProgramStatus();
  const open = status.data?.service_partner_applications_open === true;
  const label = status.isPending ? "Checking status" : open ? "Applications open" : "Applications not open yet";
  return (
    <p className={cn("inline-flex min-h-8 items-center rounded-sm border px-3 text-[10px] font-bold uppercase tracking-[0.16em]", open ? "border-pepe/50 bg-pepe/10 text-pepe" : "border-gold/40 bg-gold/8 text-gold")} aria-live="polite">
      Service Partner · {label}
    </p>
  );
}

function PrimaryCta() {
  const status = useProgramStatus();
  const open = status.data?.service_partner_applications_open === true;
  return (
    <div className="mt-8 flex flex-col gap-3 sm:flex-row">
      <Link to="/auth" search={{ mode: "signup", redirect: "/partners" }} className={cn(buttonVariants({ size: "lg" }), "min-h-11 gap-2")}>
        {open ? "Apply as a Service Partner" : "Create a free account"} <ArrowRight className="size-4" aria-hidden="true" />
      </Link>
      <Link to="/auth" search={{ redirect: "/partners" }} className={cn(buttonVariants({ variant: "outline", size: "lg" }), "min-h-11")}>Already have an account? Sign in</Link>
    </div>
  );
}

function PartnerProgramPage() {
  return (
    <div className="min-h-screen bg-background text-foreground">
      <PublicHeader />
      <main>
        <section className="app-gutter mx-auto max-w-6xl py-14 sm:py-20">
          <div className="max-w-4xl">
            <ServiceStatusBadge />
            <h1 className="mt-5 font-display text-5xl uppercase leading-[0.95] text-foreground sm:text-7xl">CARTEL HQ Service Partner Program</h1>
            <p className="mt-6 max-w-3xl text-base leading-7 text-muted-foreground sm:text-lg">
              Approved Service Partners can build an independent service business by charging their own clients for legitimate setup, configuration, creative, training or operational work using features available in CARTEL HQ.
            </p>
            <p className="mt-3 max-w-3xl text-sm leading-6 text-muted-foreground">
              Results and earnings are not guaranteed. CARTEL HQ pays Service Partners nothing under this program.
            </p>
            <PrimaryCta />
          </div>
        </section>

        <section className="border-y border-border-subtle bg-surface/50">
          <div className="app-gutter mx-auto max-w-6xl py-12">
            <h2 className="font-display text-4xl uppercase text-foreground">What to know first</h2>
            <ul className="mt-6 grid gap-3 md:grid-cols-2">
              {FACTS.map((fact) => (
                <li key={fact} className="flex gap-3 rounded-md border border-border-subtle bg-surface-raised p-4 text-sm leading-6 text-foreground">
                  <Check className="mt-1 size-4 shrink-0 text-gold" aria-hidden="true" />{fact}
                </li>
              ))}
            </ul>
          </div>
        </section>

        <section className="app-gutter mx-auto max-w-6xl py-14 sm:py-20">
          <div className="flex items-center gap-3"><BriefcaseBusiness className="size-6 text-gold" aria-hidden="true" /><h2 className="font-display text-4xl uppercase text-foreground">Example services</h2></div>
          <p className="mt-3 max-w-3xl text-sm leading-6 text-muted-foreground">Examples only, tied to features available today. You decide what you offer and what you charge.</p>
          <dl className="mt-7 grid gap-px overflow-hidden rounded-lg border border-border-subtle bg-border-subtle sm:grid-cols-2 lg:grid-cols-5">
            {SERVICES.map(([term, body]) => (
              <div key={term} className="bg-surface-raised p-5">
                <dt className="type-eyebrow text-gold">{term}</dt>
                <dd className="mt-2 text-sm leading-6 text-muted-foreground">{body}</dd>
              </div>
            ))}
          </dl>
        </section>

        <section className="border-y border-gold/25 bg-surface">
          <div className="app-gutter mx-auto max-w-6xl py-14">
            <p className="type-eyebrow text-gold">The review path</p>
            <h2 className="mt-3 font-display text-4xl uppercase text-foreground">How joining works</h2>
            <ol className="mt-8 grid gap-3 lg:grid-cols-5">
              {STEPS.map(([number, title, body]) => (
                <li key={number} className="border-t border-gold/35 pt-4">
                  <span className="font-mono text-xs text-gold">{number}</span>
                  <h3 className="mt-2 text-sm font-semibold text-foreground">{title}</h3>
                  <p className="mt-2 text-xs leading-5 text-muted-foreground">{body}</p>
                </li>
              ))}
            </ol>
            <div className="mt-8 rounded-md border border-gold/30 bg-gold/5 p-4">
              <p className="type-eyebrow text-gold">Required disclosure near your promotions</p>
              <p className="mt-2 text-sm leading-6 text-foreground">"{SERVICE_PARTNER_DISCLOSURE}"</p>
            </div>
          </div>
        </section>

        <section className="app-gutter mx-auto max-w-6xl py-14">
          <div className="grid gap-5 md:grid-cols-2">
            <article className="cartel-panel rounded-lg p-6">
              <ShieldAlert className="size-6 text-gold" aria-hidden="true" />
              <h2 className="mt-4 font-display text-3xl uppercase text-foreground">Security rules</h2>
              <p className="mt-3 text-sm leading-6 text-muted-foreground">Partner status is not access. Work only through permissions your client grants inside the product, keep client information confidential, and never handle seed phrases, private keys, CARTEL HQ passwords or payment cards.</p>
            </article>
            <article className="rounded-lg border border-border-subtle bg-surface/50 p-6" aria-labelledby="affiliate-heading">
              <Clock className="size-6 text-muted-foreground" aria-hidden="true" />
              <p className="type-eyebrow mt-4 text-muted-foreground">Not open · planned later</p>
              <h2 id="affiliate-heading" className="mt-2 font-display text-3xl uppercase text-muted-foreground">Affiliate Program</h2>
              <p className="mt-3 text-sm leading-6 text-muted-foreground">The Affiliate Program is not open. There is no active commission or referral offer and no Affiliate application. Any future Affiliate Program will have separate terms and will be announced separately.</p>
              <p className="mt-3 inline-flex items-center gap-2 text-xs text-muted-foreground"><X className="size-3.5" aria-hidden="true" />No application available</p>
            </article>
          </div>
        </section>

        <section className="app-gutter mx-auto max-w-4xl pb-16 text-center">
          <h2 className="font-display text-4xl uppercase text-foreground">Read before you apply</h2>
          <p className="mx-auto mt-3 max-w-2xl text-sm leading-6 text-muted-foreground">The Service Partner Agreement and guide explain responsibilities, brand rules, security and termination.</p>
          <div className="mt-6 flex flex-col justify-center gap-3 sm:flex-row">
            <Link to="/legal/partner-agreement" className={cn(buttonVariants({ variant: "outline", size: "lg" }), "min-h-11")}>Read the draft Service Partner Agreement</Link>
            <Link to="/docs" hash="partner-program" className={cn(buttonVariants({ variant: "outline", size: "lg" }), "min-h-11")}>Service Partner guide</Link>
          </div>
        </section>
      </main>
      <footer className="app-gutter border-t border-border-subtle py-6"><LegalFooter /></footer>
    </div>
  );
}
