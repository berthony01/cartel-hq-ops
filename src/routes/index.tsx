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
  type LucideIcon,
} from "lucide-react";
import { buttonVariants } from "@/components/ui/button";
import { cn } from "@/lib/utils";

/**
 * PUBLIC landing page. Deliberately free of Supabase, workspace, and session
 * imports: this route must render for anonymous visitors with zero private
 * data. All copy describes only currently shipped surfaces.
 */
export const Route = createFileRoute("/")({
  head: () => ({
    meta: [
      { title: "CARTEL HQ — The operating layer for crypto project teams" },
      {
        name: "description",
        content:
          "CARTEL HQ is the private operating layer for crypto project teams: project identity, launch control, Telegram community operations, launch watch alerts, and sticker creation in one command center.",
      },
      { property: "og:title", content: "CARTEL HQ — The operating layer for crypto project teams" },
      {
        property: "og:description",
        content:
          "Project identity, launch control, Telegram community operations, launch watch alerts, and sticker creation — one private command center for crypto project teams.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
  }),
  component: LandingPage,
});

type Feature = { icon: LucideIcon; title: string; body: string };

const FEATURES: Feature[] = [
  {
    icon: IdCard,
    title: "Project Profile",
    body: "One canonical identity per project: name, ticker, chain, logo, official links, and discovery status — published to the Cartel Network when you choose.",
  },
  {
    icon: Rocket,
    title: "Launch Control",
    body: "Run your launch lifecycle from draft to live: announce, open the watchlist, register the official contract, and go live — with a clear next step at every stage.",
  },
  {
    icon: BellRing,
    title: "Launch Watch",
    body: "Community members join a private watch list through Telegram and get 24-hour and 1-hour reminders, the official contract packet, and the launch-live alert.",
  },
  {
    icon: MessageSquare,
    title: "Community Command",
    body: "Connect your Telegram group, automate welcome messages with a Launch Watch call-to-action, and manage onboarding from one place.",
  },
  {
    icon: Sticker,
    title: "Sticker Lab",
    body: "Create branded static and motion stickers with AI, review variations, and publish packs your community can actually use.",
  },
  {
    icon: Send,
    title: "Sticker Drops",
    body: "Schedule admin-controlled sticker drops into your connected Telegram groups to keep launches visible.",
  },
  {
    icon: Target,
    title: "X Missions",
    body: "Set social missions with measurable targets and track progress against real X metrics.",
  },
  {
    icon: Globe,
    title: "Cartel Network",
    body: "Published projects and launches are discoverable on the public network — the shop window for everything built in HQ.",
  },
];

function LandingPage() {
  return (
    <div className="min-h-screen bg-background text-foreground">
      <header className="app-gutter sticky top-0 z-30 flex h-14 items-center justify-between gap-3 border-b border-border-subtle bg-background/88 backdrop-blur-xl lg:h-16">
        <Link to="/" className="flex min-w-0 items-center gap-2">
          <span className="flex size-8 shrink-0 items-center justify-center rounded-md border border-gold/40 bg-surface-raised font-display text-sm text-gold">
            C
          </span>
          <span className="truncate font-display text-lg uppercase tracking-widest text-gold">
            CARTEL HQ
          </span>
        </Link>
        <nav className="flex shrink-0 items-center gap-2">
          <Link
            to="/network"
            className={cn(buttonVariants({ variant: "ghost", size: "sm" }), "min-h-11")}
          >
            Explore the network
          </Link>
          <Link
            to="/auth"
            className={cn(buttonVariants({ variant: "default", size: "sm" }), "min-h-11")}
          >
            Sign in
          </Link>
        </nav>
      </header>

      <main>
        <section className="app-gutter mx-auto max-w-5xl py-16 text-center sm:py-24">
          <p className="type-eyebrow text-muted-foreground">Private operating layer</p>
          <h1 className="mt-4 font-display text-5xl uppercase leading-none tracking-wide text-foreground sm:text-7xl">
            Run your project like a <span className="text-gold">cartel</span>
          </h1>
          <p className="mx-auto mt-6 max-w-2xl text-base leading-relaxed text-muted-foreground sm:text-lg">
            CARTEL HQ is the operating layer for crypto project teams: identity, launch
            control, Telegram community operations, launch alerts, and creative tooling —
            in one private command center. Project teams sign in to run it.
          </p>
          <p className="mx-auto mt-3 max-w-2xl text-sm leading-relaxed text-muted-foreground">
            CARTEL HQ is a utility and operations platform. It is separate from the
            PEPECARTEL token and community website.
          </p>
          <div className="mt-8 flex flex-wrap items-center justify-center gap-3">
            <Link
              to="/auth"
              className={cn(buttonVariants({ size: "lg" }), "min-h-11 gap-2")}
            >
              Sign in to CARTEL HQ <ArrowRight className="size-4" aria-hidden="true" />
            </Link>
            <Link
              to="/network"
              className={cn(buttonVariants({ variant: "outline", size: "lg" }), "min-h-11")}
            >
              Explore Cartel Network
            </Link>
          </div>
        </section>

        <section className="app-gutter mx-auto max-w-7xl py-12">
          <h2 className="font-display text-3xl uppercase tracking-wide text-foreground sm:text-4xl">
            One command center
          </h2>
          <p className="mt-3 max-w-2xl text-sm leading-relaxed text-muted-foreground">
            Everything a project team runs day to day, built as connected surfaces instead
            of scattered tools.
          </p>
          <div className="mt-8 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            {FEATURES.map((feature) => (
              <article
                key={feature.title}
                className="cartel-panel min-w-0 rounded-xl p-5 shadow-elevated"
              >
                <feature.icon className="size-5 text-gold" aria-hidden="true" />
                <h3 className="mt-3 text-sm font-semibold text-foreground">{feature.title}</h3>
                <p className="mt-2 text-xs leading-relaxed text-muted-foreground">
                  {feature.body}
                </p>
              </article>
            ))}
          </div>
        </section>

        <section className="app-gutter mx-auto max-w-5xl py-12">
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
              </div>
            </div>
          </div>
        </section>

        <section className="app-gutter mx-auto max-w-5xl py-12">
          <h2 className="font-display text-3xl uppercase tracking-wide text-foreground sm:text-4xl">
            Pricing
          </h2>
          <div className="mt-8 grid gap-4 sm:grid-cols-2">
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
            <article className="cartel-panel min-w-0 rounded-xl border-gold/40 p-6 shadow-elevated">
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
            Private beta — sign in to manage your plan.
          </p>
        </section>

        <section className="app-gutter mx-auto max-w-5xl py-16 text-center">
          <h2 className="font-display text-3xl uppercase tracking-wide text-foreground sm:text-4xl">
            Ready when you are
          </h2>
          <div className="mt-6 flex flex-wrap items-center justify-center gap-3">
            <Link to="/auth" className={cn(buttonVariants({ size: "lg" }), "min-h-11")}>
              Sign in
            </Link>
            <Link
              to="/network"
              className={cn(buttonVariants({ variant: "outline", size: "lg" }), "min-h-11")}
            >
              Explore the network
            </Link>
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
