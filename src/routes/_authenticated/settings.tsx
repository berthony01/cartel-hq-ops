import { createFileRoute, Link } from "@tanstack/react-router";
import {
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

      <Section
        variant="surface"
        className="rise-in"
        title="Configured here today"
        description="These are real, working areas of CARTEL HQ."
        contentClassName="grid gap-2 sm:grid-cols-2 [&>*]:min-w-0"
      >
        {LIVE_ENTRIES.map((entry) => (
          <Link
            key={entry.to}
            to={entry.to}
            className="group flex items-start gap-3 rounded-lg border border-border/70 bg-surface-raised/50 px-3 py-3 transition-colors hover:border-gold/40 hover:bg-surface-raised sm:px-4"
          >
            <span className="mt-0.5 flex size-8 shrink-0 items-center justify-center rounded-md border border-border/70 bg-surface text-gold">
              <entry.icon className="size-4" aria-hidden="true" />
            </span>
            <span className="min-w-0 flex-1">
              <span className="block text-sm font-medium text-foreground">{entry.label}</span>
              <span className="mt-0.5 block text-[13px] leading-relaxed text-muted-foreground">
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
            className="flex items-start gap-3 rounded-lg border border-border/60 bg-surface-raised/25 px-3 py-3 sm:px-4"
          >
            <span className="mt-0.5 flex size-8 shrink-0 items-center justify-center rounded-md border border-border/60 bg-surface text-muted-foreground">
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
