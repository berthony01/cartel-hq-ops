import { createFileRoute, Link } from "@tanstack/react-router";
import { ArrowRight, BookOpen, CheckCircle2, CircleAlert } from "lucide-react";
import { LegalFooter } from "@/components/cartel/LegalFooter";

const TITLE = "CARTEL HQ Documentation — Product Guide";
const DESCRIPTION =
  "Learn how to set up CARTEL HQ, manage project identity and launches, connect Telegram, create stickers, run X Missions, and understand plans and verification states.";

const SECTIONS = [
  { id: "getting-started", label: "Getting Started" },
  { id: "project-identity", label: "Project Identity" },
  { id: "launch-control", label: "Launch Control" },
  { id: "launch-watch", label: "Launch Watch" },
  { id: "community-command", label: "Community Command" },
  { id: "sticker-lab", label: "Sticker Lab" },
  { id: "sticker-drops", label: "Sticker Drops" },
  { id: "x-missions", label: "X Missions" },
  { id: "cartel-network", label: "Cartel Network" },
  { id: "plans-billing", label: "Plans & Billing" },
  { id: "partner-program", label: "Partner Program" },
  { id: "safety", label: "Safety & verification" },
] as const;

function DocSection({ id, title, what, how, availability, children }: { id: string; title: string; what: string; how: string; availability: string; children?: React.ReactNode }) {
  return (
    <section id={id} className="scroll-mt-24 border-t border-border-subtle py-9 first:border-t-0 first:pt-0">
      <h2 className="font-display text-3xl uppercase text-foreground sm:text-4xl">{title}</h2>
      <div className="mt-5 grid gap-5 lg:grid-cols-3">
        <div><h3 className="type-eyebrow text-gold">What it is</h3><p className="mt-2 text-sm leading-6 text-muted-foreground">{what}</p></div>
        <div><h3 className="type-eyebrow text-gold">How to use it</h3><p className="mt-2 text-sm leading-6 text-muted-foreground">{how}</p></div>
        <div><h3 className="type-eyebrow text-gold">Availability</h3><p className="mt-2 text-sm leading-6 text-muted-foreground">{availability}</p></div>
      </div>
      {children}
    </section>
  );
}

export const Route = createFileRoute("/docs")({
  head: () => ({
    meta: [
      { title: TITLE },
      { name: "description", content: DESCRIPTION },
      { property: "og:title", content: TITLE },
      { property: "og:description", content: DESCRIPTION },
      { property: "og:type", content: "website" },
      { property: "og:url", content: "https://pepecartelhq.com/docs" },
      { name: "twitter:card", content: "summary_large_image" },
      { name: "twitter:title", content: TITLE },
      { name: "twitter:description", content: DESCRIPTION },
    ],
    links: [{ rel: "canonical", href: "https://pepecartelhq.com/docs" }],
  }),
  component: DocsPage,
});

function DocsPage() {
  return (
    <div className="min-h-screen bg-background text-foreground">
      <header className="app-gutter sticky top-0 z-30 flex min-h-14 items-center justify-between gap-3 border-b border-border-subtle bg-background/88 py-2 backdrop-blur-xl">
        <Link to="/" className="flex min-w-0 items-center gap-2"><span className="flex size-8 shrink-0 items-center justify-center rounded-md border border-gold/40 bg-surface-raised font-display text-sm text-gold">C</span><span className="truncate font-display text-lg uppercase tracking-widest text-gold">CARTEL HQ</span></Link>
        <nav aria-label="Public" className="flex items-center gap-3 text-xs font-semibold"><Link to="/partner-program" className="hidden min-h-11 items-center text-muted-foreground hover:text-gold sm:inline-flex">Partner Program</Link><Link to="/auth" className="inline-flex min-h-11 items-center text-gold hover:underline">Create account / Sign in</Link></nav>
      </header>
      <main className="app-gutter mx-auto max-w-7xl py-12 sm:py-16">
        <div className="max-w-4xl">
          <p className="type-eyebrow text-gold">Product documentation</p>
          <h1 className="mt-4 font-display text-5xl uppercase leading-none text-foreground sm:text-7xl">Run CARTEL HQ with confidence</h1>
          <p className="mt-5 max-w-3xl text-base leading-7 text-muted-foreground">A practical guide to the tools currently shipped for project identity, launches, community operations, creative work, social missions, and public discovery.</p>
        </div>

        <div className="mt-12 grid gap-10 lg:grid-cols-[15rem_minmax(0,1fr)]">
          <nav aria-label="Documentation sections" className="lg:sticky lg:top-24 lg:self-start">
            <p className="type-eyebrow text-muted-foreground">On this page</p>
            <ul className="mt-3 grid grid-cols-2 gap-x-3 sm:grid-cols-3 lg:grid-cols-1">
              {SECTIONS.map((section) => <li key={section.id}><a href={`#${section.id}`} className="inline-flex min-h-11 items-center text-xs text-muted-foreground hover:text-gold">{section.label}</a></li>)}
            </ul>
          </nav>

          <article className="min-w-0">
            <DocSection id="getting-started" title="Getting Started" what="The recommended sequence for establishing one project and its operating foundation." how="Create a free account, create one project, complete Project Identity, connect Telegram and install @PepeCartelHQBot, then follow the project journey shown in HQ." availability="Free to begin. No card is required.">
              <ol className="mt-5 grid gap-2 sm:grid-cols-5">{["Create free account", "Create one project", "Complete identity", "Connect Telegram", "Follow the journey"].map((step, index) => <li key={step} className="surface-quiet rounded-md p-3 text-xs text-foreground"><span className="mr-2 text-gold">{index + 1}.</span>{step}</li>)}</ol>
            </DocSection>
            <DocSection id="project-identity" title="Project Identity and Public Profile" what="The canonical project name, ticker, chain, description, logo, website, Telegram, and X links for a workspace." how="Complete and publish the profile from Project Profile. Saved identity is reused across eligible HQ and public Network surfaces." availability="Identity and profile are included on Free."><Link to="/project-profile" className="mt-4 inline-flex min-h-11 items-center gap-2 text-sm font-semibold text-gold hover:underline">Open Project Profile <ArrowRight className="size-4" aria-hidden="true" /></Link></DocSection>
            <DocSection id="launch-control" title="Launch Control" what="A guided lifecycle from draft through announced, watchlist, official contract registration, live, and completed." how="Create a launch, follow the next action, announce it, open Launch Watch, register the official contract when available, and move live when ready." availability="Available in signed-in HQ for projects with a profile."><Link to="/launch-control" className="mt-4 inline-flex min-h-11 items-center gap-2 text-sm font-semibold text-gold hover:underline">Open Launch Control <ArrowRight className="size-4" aria-hidden="true" /></Link></DocSection>
            <DocSection id="launch-watch" title="Launch Watch" what="Private Telegram alerts that people choose to receive for a launch." how="Open Launch Watch from Launch Control and share the official bot link. Watchers can receive 24-hour and 1-hour reminders, the official contract packet, and the live alert." availability="Included with Pro. New joins close when a launch is live or completed." />
            <DocSection id="community-command" title="Community Command Center and Telegram bot" what="The control surface for connected Telegram communities, welcome onboarding, and official project actions." how="Add @PepeCartelHQBot to a group, complete the connection in Community Command, verify required bot permissions, and configure the welcome experience." availability="One Telegram community and welcome setup, testing, and delivery are included on Free."><a href="https://t.me/PepeCartelHQBot" target="_blank" rel="noopener noreferrer" className="mt-4 inline-flex min-h-11 items-center text-sm font-semibold text-gold hover:underline">Open @PepeCartelHQBot</a></DocSection>
            <DocSection id="sticker-lab" title="Sticker Lab" what="A workspace for creating, reviewing, and publishing branded static and motion stickers." how="Start from the project Brand Kit, generate candidates, review variations, and publish approved assets." availability="AI sticker generation is a Pro feature. Pro includes 100 static AI stickers and 10 motion AI stickers per month."><Link to="/sticker-lab" className="mt-4 inline-flex min-h-11 items-center gap-2 text-sm font-semibold text-gold hover:underline">Open Sticker Lab <ArrowRight className="size-4" aria-hidden="true" /></Link></DocSection>
            <DocSection id="sticker-drops" title="Sticker Drops" what="Admin-controlled sticker distribution into connected Telegram communities." how="Choose approved content, select connected groups, and configure the delivery from Sticker Drops." availability="Included with Pro. This is controlled distribution, not simulated engagement."><Link to="/distribution" className="mt-4 inline-flex min-h-11 items-center gap-2 text-sm font-semibold text-gold hover:underline">Open Sticker Drops <ArrowRight className="size-4" aria-hidden="true" /></Link></DocSection>
            <DocSection id="x-missions" title="X Missions" what="Social missions with measurable goals based on real X activity." how="Create and manage eligible missions from HQ, then monitor the mission lifecycle and measured targets." availability="Included with Pro, with 100 X Missions per month." />
            <DocSection id="cartel-network" title="Cartel Network" what="Public discovery pages for profiles and launch information published by authenticated project accounts." how="Publish an eligible Project Profile and launch, or browse public projects, launches, and official event signals." availability="Public to browse. Publication depends on the project and launch state."><Link to="/network" className="mt-4 inline-flex min-h-11 items-center gap-2 text-sm font-semibold text-gold hover:underline">Explore Cartel Network <ArrowRight className="size-4" aria-hidden="true" /></Link></DocSection>
            <DocSection id="plans-billing" title="Plans and Billing" what="Free supports the operating foundation; Pro adds the current creative, distribution, mission, inbox, and launch-alert tools." how="Start on Free, then signed-in workspace owners can manage the plan from Settings & Billing." availability="Free: $0, no card, 1 project, 1 Telegram community, identity/profile, and welcome setup, testing, and delivery. Pro: $49/month with AI stickers, motion, concepts, X Missions, Sticker Drops, auto-posting, official broadcasts, Project Inbox, and Launch Watch; 100 static AI stickers, 10 motion AI stickers, and 100 X Missions per month."><Link to="/settings" className="mt-4 inline-flex min-h-11 items-center gap-2 text-sm font-semibold text-gold hover:underline">Open Settings & Billing <ArrowRight className="size-4" aria-hidden="true" /></Link></DocSection>
            <DocSection id="partner-program" title="Partner Program" what="A preparing-to-open program with separate Affiliate and Service Partner tracks." how="Review the public program explanation and draft agreement now. Applications will be announced separately when ready." availability="Not active. Applications are not open and no commission is currently earned or owed."><Link to="/partner-program" className="mt-4 inline-flex min-h-11 items-center gap-2 text-sm font-semibold text-gold hover:underline">Read about the Partner Program <ArrowRight className="size-4" aria-hidden="true" /></Link></DocSection>
            <DocSection id="safety" title="Safety and verification language" what="CARTEL HQ uses literal states so visitors can understand what a project has supplied or connected." how="Read each state narrowly: authenticated, connected, and official contract registered describe specific platform records." availability="These states are not audits, safety guarantees, or endorsements.">
              <div className="mt-5 grid gap-3 sm:grid-cols-2"><div className="surface-quiet rounded-md p-4"><CheckCircle2 className="size-5 text-pepe" aria-hidden="true" /><p className="mt-2 text-sm font-semibold text-foreground">Literal project states</p></div><div className="surface-quiet rounded-md p-4"><CircleAlert className="size-5 text-gold" aria-hidden="true" /><p className="mt-2 text-sm font-semibold text-foreground">Do your own independent review</p></div></div>
              <p className="mt-5 text-xs leading-5 text-muted-foreground">Mainnet execution, liquidity operations, and a Cartel AI Operator are not available public product features and are not documented here as live.</p>
            </DocSection>
          </article>
        </div>
      </main>
      <footer className="app-gutter border-t border-border-subtle py-6"><LegalFooter /></footer>
    </div>
  );
}