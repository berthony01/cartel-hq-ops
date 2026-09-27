import { createFileRoute, Link } from "@tanstack/react-router";
import {
  IdCard,
  Rocket,
  BellRing,
  MessageSquare,
  Sticker,
  Send,
  Target,
  Globe,
  ShieldCheck,
  ArrowRight,
  ArrowUpRight,
  Check,
  Lock,
  type LucideIcon,
} from "lucide-react";
import { buttonVariants } from "@/components/ui/button";
import { cn } from "@/lib/utils";

/**
 * PUBLIC landing page. Deliberately free of Supabase, workspace, and session
 * imports: this route must render for anonymous visitors with zero private
 * data. All copy describes only currently shipped surfaces.
 */
const BETA_URL = "https://t.me/PepeCartelHQBot";
const TITLE = "CARTEL HQ — Launch command center for crypto project teams";
const DESC =
  "One private operating layer for crypto project teams: project identity, launch control, Telegram community operations, launch alerts, branded stickers, social missions and public discovery. Invite-only private beta.";

export const Route = createFileRoute("/")({
  head: () => ({
    meta: [
      { title: TITLE },
      { name: "description", content: DESC },
      { property: "og:title", content: TITLE },
      { property: "og:description", content: DESC },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
      { name: "twitter:title", content: TITLE },
      { name: "twitter:description", content: DESC },
    ],
  }),
  component: LandingPage,
});

function BetaCta({ size = "lg", className }: { size?: "lg" | "sm"; className?: string }) {
  return (
    <a
      href={BETA_URL}
      target="_blank"
      rel="noopener noreferrer"
      className={cn(buttonVariants({ size }), "min-h-11 gap-2", className)}
    >
      Join private beta
      <ArrowUpRight className="size-4" aria-hidden="true" />
      <span className="sr-only">(opens Telegram in a new tab)</span>
    </a>
  );
}

const FLOW: { icon: LucideIcon; step: string; title: string; body: string }[] = [
  { icon: IdCard, step: "01", title: "Identity", body: "One canonical project profile: name, ticker, chain, logo and official links." },
  { icon: Rocket, step: "02", title: "Launch", body: "Draft → announced → watchlist → official contract → live, with one next step at each stage." },
  { icon: MessageSquare, step: "03", title: "Community", body: "Connected Telegram groups with welcome onboarding and a Launch Watch call-to-action." },
  { icon: BellRing, step: "04", title: "Alerts", body: "Watchers get 24h and 1h reminders, the official contract packet and the live alert." },
  { icon: Globe, step: "05", title: "Discovery", body: "Published projects and launches appear on the public Cartel Network." },
];

const PILLARS: { outcome: string; title: string; body: string; items: { icon: LucideIcon; label: string }[] }[] = [
  {
    outcome: "Command the launch",
    title: "Launch Control + Launch Watch",
    body: "Run the lifecycle from one screen and let your community opt in to private Telegram alerts — no spreadsheets, no manual DMs.",
    items: [
      { icon: Rocket, label: "Lifecycle from draft to live" },
      { icon: BellRing, label: "Reminders, contract packet, live alert" },
    ],
  },
  {
    outcome: "Activate the community",
    title: "Community Command",
    body: "Connect Telegram groups, automate welcomes, and schedule admin-controlled sticker drops into the groups you run.",
    items: [
      { icon: MessageSquare, label: "Welcome onboarding + Launch Watch CTA" },
      { icon: Send, label: "Scheduled Sticker Drops" },
    ],
  },
  {
    outcome: "Keep the brand consistent",
    title: "Sticker Lab",
    body: "Generate branded static and motion stickers with AI, review variations, and publish packs your community actually uses.",
    items: [
      { icon: Sticker, label: "Static + motion AI stickers" },
      { icon: IdCard, label: "Brand-consistent project identity" },
    ],
  },
  {
    outcome: "Distribute from one place",
    title: "X Missions + Cartel Network",
    body: "Set social missions with measurable targets tracked against real X metrics, and surface published launches publicly.",
    items: [
      { icon: Target, label: "Missions with real metric targets" },
      { icon: Globe, label: "Public project + launch pages" },
    ],
  },
];

const PROOF = [
  "Project Profile",
  "Launch Control",
  "Launch Watch",
  "Community Command",
  "Sticker Lab",
  "Sticker Drops",
  "X Missions",
  "Cartel Network",
];

function LandingPage() {
  return (
    <div className="min-h-screen overflow-x-hidden bg-background text-foreground">
      <header className="app-gutter sticky top-0 z-30 flex h-14 items-center justify-between gap-3 border-b border-border-subtle bg-background/88 backdrop-blur-xl lg:h-16">
        <Link to="/" className="flex min-w-0 items-center gap-2">
          <span className="flex size-8 shrink-0 items-center justify-center rounded-md border border-gold/40 bg-surface-raised font-display text-sm text-gold">
            C
          </span>
          <span className="truncate font-display text-lg uppercase tracking-widest text-gold">
            CARTEL HQ
          </span>
        </Link>
        <nav className="flex shrink-0 items-center gap-1 sm:gap-2" aria-label="Primary">
          <Link
            to="/network"
            className={cn(buttonVariants({ variant: "ghost", size: "sm" }), "hidden min-h-11 md:inline-flex")}
          >
            Cartel Network
          </Link>
          <Link
            to="/auth"
            className={cn(buttonVariants({ variant: "ghost", size: "sm" }), "min-h-11")}
          >
            Operator sign in
          </Link>
          <BetaCta size="sm" className="hidden sm:inline-flex" />
        </nav>
      </header>

      <main>
        {/* Hero */}
        <section className="app-gutter mx-auto grid max-w-7xl gap-10 py-14 sm:py-20 lg:grid-cols-[minmax(0,1.15fr)_minmax(0,0.85fr)] lg:items-center lg:gap-14">
          <div className="min-w-0">
            <p className="inline-flex items-center gap-2 rounded-full border border-gold/35 bg-gold/5 px-3 py-1 text-[10px] font-semibold uppercase tracking-[0.2em] text-gold">
              <Lock className="size-3" aria-hidden="true" />
              Invite-only private beta
            </p>
            <h1 className="mt-5 font-display text-5xl uppercase leading-[0.95] tracking-wide text-foreground sm:text-7xl">
              The command center for your <span className="text-gold">crypto launch</span>
            </h1>
            <p className="mt-6 max-w-xl text-base leading-relaxed text-muted-foreground sm:text-lg">
              Project identity, launch execution, Telegram community operations, launch
              alerts, branded stickers, social missions and public discovery — one
              operating layer instead of ten scattered tools.
            </p>
            <div className="mt-8 flex flex-col gap-3 sm:flex-row sm:flex-wrap sm:items-center">
              <BetaCta />
              <Link
                to="/auth"
                className={cn(buttonVariants({ variant: "outline", size: "lg" }), "min-h-11 border-gold/40")}
              >
                Operator sign in
              </Link>
            </div>
            <p className="mt-4 max-w-xl text-xs leading-relaxed text-muted-foreground">
              Access is granted to approved operators. Request a spot through our official
              Telegram bot, @PepeCartelHQBot. CARTEL HQ is a utility platform, separate from
              the PEPECARTEL token and community website.
            </p>
          </div>

          {/* Code-native operating flow visual */}
          <div
            className="cartel-panel min-w-0 rounded-xl border border-gold/35 p-4 shadow-[var(--shadow-cartel),var(--glow-gold)] sm:p-5"
            aria-label="CARTEL HQ operating flow"
          >
            <div className="flex items-center justify-between gap-3 border-b border-border-subtle pb-3">
              <p className="type-eyebrow text-muted-foreground">Operating flow</p>
              <span className="rounded-full border border-pepe/35 bg-pepe/5 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-[0.16em] text-pepe">
                Connected
              </span>
            </div>
            <ol className="mt-3 space-y-2">
              {FLOW.map((f, i) => (
                <li
                  key={f.step}
                  className={cn(
                    "flex min-w-0 items-start gap-3 rounded-lg border p-3",
                    i === 1 ? "border-gold/40 bg-gold/5" : "border-border-subtle bg-surface-raised/40",
                  )}
                >
                  <span className="flex size-9 shrink-0 items-center justify-center rounded-md border border-gold/30 bg-background text-gold">
                    <f.icon className="size-4" aria-hidden="true" />
                  </span>
                  <div className="min-w-0">
                    <p className="flex items-baseline gap-2 text-sm font-semibold text-foreground">
                      <span className="font-mono text-[10px] text-gold">{f.step}</span>
                      {f.title}
                    </p>
                    <p className="mt-0.5 text-xs leading-relaxed text-muted-foreground">{f.body}</p>
                  </div>
                </li>
              ))}
            </ol>
          </div>
        </section>

        {/* Proof strip */}
        <section className="border-y border-border-subtle bg-surface/50" aria-label="Shipped surfaces">
          <div className="app-gutter mx-auto flex max-w-7xl flex-wrap items-center gap-x-5 gap-y-2 py-4">
            <p className="type-eyebrow text-gold">Live in HQ</p>
            {PROOF.map((p) => (
              <span key={p} className="inline-flex items-center gap-1.5 text-xs text-muted-foreground">
                <Check className="size-3 text-pepe" aria-hidden="true" />
                {p}
              </span>
            ))}
          </div>
        </section>

        {/* Problem */}
        <section className="app-gutter mx-auto max-w-5xl py-16 sm:py-20">
          <p className="type-eyebrow text-gold">The operator problem</p>
          <h2 className="mt-3 font-display text-3xl uppercase tracking-wide text-foreground sm:text-5xl">
            Launches break in the gaps between tools
          </h2>
          <p className="mt-4 max-w-3xl text-sm leading-relaxed text-muted-foreground sm:text-base">
            Profile in one doc, schedule in another, the contract pasted into five chats,
            reminders sent by hand, stickers made somewhere else. CARTEL HQ connects each
            step so the same official information flows from identity to launch to
            community — with a clear next action at every stage.
          </p>
        </section>

        {/* Pillars */}
        <section className="app-gutter mx-auto max-w-7xl pb-16">
          <div className="grid gap-4 md:grid-cols-2">
            {PILLARS.map((p) => (
              <article key={p.title} className="cartel-panel min-w-0 rounded-xl p-6 shadow-elevated">
                <p className="type-eyebrow text-gold">{p.outcome}</p>
                <h3 className="mt-2 font-display text-2xl uppercase tracking-wide text-foreground">
                  {p.title}
                </h3>
                <p className="mt-2 text-sm leading-relaxed text-muted-foreground">{p.body}</p>
                <ul className="mt-4 space-y-2">
                  {p.items.map((it) => (
                    <li key={it.label} className="flex items-center gap-2 text-xs text-foreground">
                      <it.icon className="size-4 shrink-0 text-gold" aria-hidden="true" />
                      {it.label}
                    </li>
                  ))}
                </ul>
              </article>
            ))}
          </div>
        </section>

        {/* Trust */}
        <section className="app-gutter mx-auto max-w-5xl pb-16">
          <div className="cartel-panel rounded-xl p-6 shadow-elevated sm:p-8">
            <div className="flex items-start gap-3">
              <ShieldCheck className="mt-0.5 size-5 shrink-0 text-gold" aria-hidden="true" />
              <div className="min-w-0">
                <h2 className="font-display text-2xl uppercase tracking-wide text-foreground">
                  Trust, stated precisely
                </h2>
                <p className="mt-3 text-sm leading-relaxed text-muted-foreground">
                  CARTEL HQ keeps verification terms separate and literal: a project can be
                  authenticated, its official Telegram connected, and its official contract
                  registered by the authenticated project. None of these is an audit, a
                  safety guarantee, or an endorsement — and the platform never presents
                  them as one.
                </p>
                <Link
                  to="/network"
                  className="mt-4 inline-flex min-h-11 items-center gap-1.5 text-sm font-medium text-gold hover:underline"
                >
                  Explore Cartel Network <ArrowRight className="size-4" aria-hidden="true" />
                </Link>
              </div>
            </div>
          </div>
        </section>

        {/* Pricing */}
        <section className="app-gutter mx-auto max-w-5xl pb-16">
          <h2 className="font-display text-3xl uppercase tracking-wide text-foreground sm:text-4xl">
            Pricing
          </h2>
          <div className="mt-6 grid gap-4 sm:grid-cols-2">
            <article className="cartel-panel min-w-0 rounded-xl p-6 shadow-elevated">
              <div className="flex items-center justify-between gap-3">
                <h3 className="text-sm font-semibold text-foreground">Cartel HQ Free</h3>
                <span className="rounded-md border border-border-subtle px-2 py-1 text-xs font-semibold text-muted-foreground">
                  $0
                </span>
              </div>
              <p className="mt-3 text-xs leading-relaxed text-muted-foreground">
                Project Identity and profile, 1 Telegram group, and welcome setup, testing
                and delivery.
              </p>
            </article>
            <article className="cartel-panel min-w-0 rounded-xl border border-gold/40 p-6 shadow-elevated">
              <div className="flex items-center justify-between gap-3">
                <h3 className="text-sm font-semibold text-foreground">Cartel HQ Pro</h3>
                <span className="rounded-md border border-gold/40 bg-gold/10 px-2 py-1 text-xs font-semibold text-gold">
                  $49/month
                </span>
              </div>
              <p className="mt-3 text-xs leading-relaxed text-muted-foreground">
                Everything in Free plus AI stickers, motion, concepts, X reads and
                Missions, Sticker Drops, auto-posting, official broadcasts, Project Inbox
                and Launch Watch. Includes 100 static AI stickers, 10 motion AI stickers
                and 100 X Missions per month.
              </p>
            </article>
          </div>
          <p className="mt-4 text-xs text-muted-foreground">
            Private beta — approved operators sign in to manage their plan.
          </p>
        </section>

        {/* Final CTA */}
        <section className="app-gutter mx-auto max-w-5xl pb-20">
          <div className="rounded-xl border border-gold/40 bg-surface p-8 text-center shadow-[var(--shadow-cartel),var(--glow-gold)] sm:p-12">
            <h2 className="font-display text-3xl uppercase tracking-wide text-foreground sm:text-5xl">
              Run your next launch from HQ
            </h2>
            <p className="mx-auto mt-3 max-w-xl text-sm leading-relaxed text-muted-foreground">
              Request access through @PepeCartelHQBot. Approved operators receive sign-in
              access — there is no instant account creation.
            </p>
            <div className="mt-6 flex flex-col items-center justify-center gap-3 sm:flex-row">
              <BetaCta />
              <Link
                to="/auth"
                className={cn(buttonVariants({ variant: "outline", size: "lg" }), "min-h-11")}
              >
                Operator sign in
              </Link>
            </div>
          </div>
        </section>
      </main>

      <footer className="app-gutter border-t border-border-subtle py-6">
        <p className="text-center text-[11px] text-muted-foreground/80">
          CARTEL HQ — private beta. Access is limited to approved operators.
        </p>
      </footer>
    </div>
  );
}
