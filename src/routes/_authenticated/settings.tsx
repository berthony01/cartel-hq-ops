import { createFileRoute, Link } from "@tanstack/react-router";
import {
  CheckCircle2,
  IdCard,
  MessageSquare,
  Palette,
  FolderLock,
  KeyRound,
  Users,
  ChevronRight,
} from "lucide-react";
import type { LucideIcon } from "lucide-react";
import { PageHeader } from "@/components/cartel/PageHeader";
import { Section } from "@/components/cartel/Section";
import { StatusBadge } from "@/components/cartel/StatusBadge";
import { BillingSection } from "@/components/cartel/BillingSection";
import { ServicePartnerAccessPanel } from "@/components/cartel/ServicePartnerAccessPanel";

export const Route = createFileRoute("/_authenticated/settings")({
  head: () => ({
    meta: [
      { title: "Settings — CARTEL HQ" },
      {
        name: "description",
        content:
          "Central hub for CARTEL HQ project identity, community connection, brand assets, and planned access controls.",
      },
      { property: "og:title", content: "Settings — CARTEL HQ" },
      {
        property: "og:description",
        content: "Project, community, and brand configuration hub for CARTEL HQ.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: SettingsPage,
});

type LiveEntry = {
  label: string;
  to: string;
  icon: LucideIcon;
  description: string;
};

const LIVE_ENTRIES: LiveEntry[] = [
  {
    label: "Project Identity",
    to: "/project-profile",
    icon: IdCard,
    description: "Name, ticker, chain, description, logo, official links, and discovery status.",
  },
  {
    label: "Community & Telegram",
    to: "/telegram",
    icon: MessageSquare,
    description: "Connected groups, welcome onboarding, broadcasts, audience, and inbox.",
  },
  {
    label: "Brand",
    to: "/brand-kit",
    icon: Palette,
    description: "Brand colours, typography, and creative direction reused across the workspace.",
  },
  {
    label: "Assets",
    to: "/assets",
    icon: FolderLock,
    description: "Stored artwork and files available to Sticker Lab and community surfaces.",
  },
];

const PLANNED_ENTRIES = [
  {
    label: "Access & Permissions",
    icon: KeyRound,
    description:
      "Invitations and per-surface permission controls are not built yet. Workspace membership and owner/admin roles already exist behind the scenes, but there is no screen to manage them here.",
  },
  {
    label: "Team & Cartel AI Operator",
    icon: Users,
    description:
      "Future collaborator roster and the Cartel AI Operator layer for assisted project operations.",
  },
];

function SettingsPage() {
  return (
    <div className="space-y-5 sm:space-y-8">
      <PageHeader
        eyebrow="System"
        title="Settings"
        description="Everything that configures your project inside CARTEL HQ. Live areas link straight to where the settings actually live; planned areas are marked and do nothing yet."
        status="Hub"
      />

      <div className="relative overflow-hidden rounded-lg border border-gold/30 bg-surface-elevated px-4 py-5 shadow-elevated sm:px-6 sm:py-7">
        <div className="pointer-events-none absolute inset-y-0 left-0 w-1 bg-gold" aria-hidden="true" />
        <div className="grid gap-5 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-end">
          <div className="min-w-0">
            <p className="type-eyebrow text-gold">Project control center</p>
            <h2 className="mt-2 font-display text-2xl uppercase leading-tight text-foreground sm:text-3xl">
              One project. One source of truth.
            </h2>
            <p className="mt-2 max-w-2xl text-sm leading-relaxed text-muted-foreground">
              Move between the live identity, community, brand, and asset controls that shape this
              workspace. Future access controls remain clearly separated until they are available.
            </p>
          </div>
          <div className="grid grid-cols-2 gap-2 sm:w-56">
            <div className="rounded-md border border-pepe/30 bg-pepe/5 px-3 py-3">
              <p className="type-eyebrow text-muted-foreground">Live areas</p>
              <p className="mt-1 font-display text-2xl text-pepe">{LIVE_ENTRIES.length}</p>
            </div>
            <div className="rounded-md border border-border/70 bg-surface-raised/60 px-3 py-3">
              <p className="type-eyebrow text-muted-foreground">Planned</p>
              <p className="mt-1 font-display text-2xl text-foreground">{PLANNED_ENTRIES.length}</p>
            </div>
          </div>
        </div>
      </div>

      <BillingSection />

      <ServicePartnerAccessPanel />

      <Section
        variant="primary"
        className="rise-in"
        title="Configured here today"
        description="These are real, working areas of CARTEL HQ."
        contentClassName="grid gap-3 sm:grid-cols-2 [&>*]:min-w-0"
      >
        {LIVE_ENTRIES.map((entry) => (
          <Link
            key={entry.to}
            to={entry.to}
            className="group relative flex min-h-32 items-start gap-3 overflow-hidden rounded-lg border border-border/70 bg-surface-raised/50 px-4 py-4 shadow-inset transition-[border-color,background-color,transform,box-shadow] hover:-translate-y-0.5 hover:border-gold/50 hover:bg-surface-raised hover:shadow-elevated focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-gold/50"
          >
            <span className="mt-0.5 flex size-10 shrink-0 items-center justify-center rounded-md border border-gold/25 bg-gold/5 text-gold transition-colors group-hover:border-gold/50 group-hover:bg-gold/10">
              <entry.icon className="size-4" aria-hidden="true" />
            </span>
            <span className="min-w-0 flex-1">
              <span className="flex items-center gap-1.5 text-sm font-semibold text-foreground">
                <CheckCircle2 className="size-3.5 text-pepe" aria-hidden="true" />
                {entry.label}
              </span>
              <span className="mt-1.5 block text-[13px] leading-relaxed text-muted-foreground">
                {entry.description}
              </span>
            </span>
            <ChevronRight
              className="mt-1 size-4 shrink-0 text-muted-foreground/60 transition-transform group-hover:translate-x-0.5"
              aria-hidden="true"
            />
          </Link>
        ))}
      </Section>


      <Section
        variant="surface"
        className="rise-in"
        title="Planned"
        description="Named so the structure is honest. None of these controls exist yet."
        contentClassName="space-y-2"
      >
        {PLANNED_ENTRIES.map((entry) => (
          <div
            key={entry.label}
            className="flex items-start gap-3 rounded-lg border border-dashed border-border/70 bg-surface-raised/20 px-4 py-4"
          >
            <span className="mt-0.5 flex size-10 shrink-0 items-center justify-center rounded-md border border-border/60 bg-background/30 text-muted-foreground">
              <entry.icon className="size-4" aria-hidden="true" />
            </span>
            <span className="min-w-0 flex-1">
              <span className="flex flex-wrap items-center gap-2">
                <span className="text-sm font-medium text-foreground">{entry.label}</span>
                <StatusBadge tone="muted">Planned</StatusBadge>
              </span>
              <span className="mt-0.5 block text-[13px] leading-relaxed text-muted-foreground">
                {entry.description}
              </span>
            </span>
          </div>
        ))}
      </Section>
    </div>
  );
}
