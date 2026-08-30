import { createFileRoute } from "@tanstack/react-router";

import { PageHeader } from "@/components/cartel/PageHeader";
import { Section } from "@/components/cartel/Section";
import { StatusBadge } from "@/components/cartel/StatusBadge";
import { LaunchReadinessCallout } from "@/components/cartel/LaunchReadiness";
import { useWorkspace } from "@/lib/workspace-context";


import { useTelegramSetup } from "@/components/cartel/TelegramConnectionCard";
import {
  TelegramGroupCard,
  useTelegramGroupSetup,
} from "@/components/cartel/TelegramGroupCard";


export const Route = createFileRoute("/_authenticated/telegram")({
  head: () => ({
    meta: [
      { title: "Community Command — CARTEL HQ" },
      {
        name: "description",
        content:
          "Operator control center for connected Telegram communities. Manage onboarding, Sticker Drops, sticker distribution, and connection health from one place.",
      },
      { property: "og:title", content: "Community Command — CARTEL HQ" },
      {
        property: "og:description",
        content: "Operator control center for Telegram communities, onboarding, Sticker Drops, sticker distribution, and connection health.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: TelegramPage,
});

function TelegramPage() {
  const setup = useTelegramSetup();
  const groupSetup = useTelegramGroupSetup();
  const { workspaceId } = useWorkspace();

  const groupCount = groupSetup.connectedGroupCount;


  return (
    <div className="flex max-w-4xl flex-col gap-4 sm:gap-6">
      <PageHeader
        eyebrow="Community Operations"
        title="Community Command"
        description="The operator control center for every connected Telegram community. Manage connection health, welcome and onboarding, Sticker Drops, and sticker distribution from one place."
        status={groupCount > 0 ? "Connected · Live Beta" : "Live Beta"}
      />

      <div className="flex flex-wrap items-center gap-2">
        <StatusBadge
          tone={
            setup.configQuery.isPending
              ? "muted"
              : setup.botConfigured
                ? "green"
                : "red"
          }
        >
          {setup.configQuery.isPending
            ? "Checking Telegram service…"
            : setup.configQuery.isError
              ? "Telegram service status unavailable"
              : setup.botConfigured
                ? "Telegram service available"
                : "Telegram service unavailable"}
        </StatusBadge>
        <StatusBadge tone={groupCount > 0 ? "green" : "muted"}>
          {groupCount > 0
            ? `${groupCount} community${groupCount === 1 ? "" : "s"} connected`
            : "No communities connected"}
        </StatusBadge>
      </div>

      {groupCount > 0 ? (
        <div className="rounded-md border border-gold/30 bg-gold/5 p-3 text-xs leading-relaxed text-foreground">
          <p className="font-semibold text-gold">Welcome & onboarding controls are available.</p>
          <p className="mt-1 text-muted-foreground">
            Select a connected community and open Community controls to set the join message,
            member mention, and auto-delete timer. Each community must explicitly enable its real
            join welcome before new members receive it.
          </p>
        </div>
      ) : null}

      <Section
        variant="surface"
        title="Command overview"
        actions={<StatusBadge tone="gold">Live Beta</StatusBadge>}
      >
        <div className="grid gap-3 sm:grid-cols-2">
          <div className="min-w-0 rounded-md border border-border/60 bg-background/40 p-3">
            <div className="flex flex-wrap items-center gap-2">
              <StatusBadge tone="green">Active</StatusBadge>
              <span className="text-sm font-medium text-foreground">Connection health</span>
            </div>
            <p className="mt-1.5 text-xs leading-relaxed text-muted-foreground">
              Monitor connected communities and reconnect when the bot is removed or permissions change.
            </p>
          </div>

          <div className="min-w-0 rounded-md border border-border/60 bg-background/40 p-3">
            <div className="flex flex-wrap items-center gap-2">
              <StatusBadge tone="green">Active</StatusBadge>
              <span className="text-sm font-medium text-foreground">Welcome & onboarding</span>
            </div>
            <p className="mt-1.5 text-xs leading-relaxed text-muted-foreground">
              Set per-community join messages, optional member mention, and auto-delete timers.
            </p>
          </div>

          <div className="min-w-0 rounded-md border border-border/60 bg-background/40 p-3">
            <div className="flex flex-wrap items-center gap-2">
              <StatusBadge tone="green">Active</StatusBadge>
              <span className="text-sm font-medium text-foreground">Sticker Drops</span>
            </div>
            <p className="mt-1.5 text-xs leading-relaxed text-muted-foreground">
              Schedule and send native sticker announcements to connected communities.
            </p>
          </div>

          <div className="min-w-0 rounded-md border border-border/60 bg-background/40 p-3">
            <div className="flex flex-wrap items-center gap-2">
              <StatusBadge tone="green">Active</StatusBadge>
              <span className="text-sm font-medium text-foreground">Sticker distribution</span>
            </div>
            <p className="mt-1.5 text-xs leading-relaxed text-muted-foreground">
              Push published packs and test stickers to selected communities from Sticker Lab.
            </p>
          </div>

          <div className="min-w-0 rounded-md border border-border/60 bg-background/40 p-3 opacity-80">
            <div className="flex flex-wrap items-center gap-2">
              <StatusBadge tone="muted">Planned</StatusBadge>
              <span className="text-sm font-medium text-foreground">Announcements</span>
            </div>
            <p className="mt-1.5 text-xs leading-relaxed text-muted-foreground">
              Broadcast text updates to connected communities.
            </p>
          </div>

          <div className="min-w-0 rounded-md border border-border/60 bg-background/40 p-3 opacity-80">
            <div className="flex flex-wrap items-center gap-2">
              <StatusBadge tone="muted">Planned</StatusBadge>
              <span className="text-sm font-medium text-foreground">Launch Distribution</span>
            </div>
            <p className="mt-1.5 text-xs leading-relaxed text-muted-foreground">
              Distribute launch alerts and verified signals through connected communities.
            </p>
          </div>

          <div className="min-w-0 rounded-md border border-border/60 bg-background/40 p-3 opacity-80 sm:col-span-2">
            <div className="flex flex-wrap items-center gap-2">
              <StatusBadge tone="muted">Planned</StatusBadge>
              <span className="text-sm font-medium text-foreground">Community Analytics</span>
            </div>
            <p className="mt-1.5 text-xs leading-relaxed text-muted-foreground">
              Track growth, engagement, and Sticker Drop outcomes across communities.
            </p>
          </div>
        </div>
      </Section>

      <TelegramGroupCard
        setup={groupSetup}
        personalConnected={setup.ownerConnected}
        botConfigured={setup.botConfigured}
      />

      <Section
        variant="surface"
        title="Community Command modules"
        actions={<StatusBadge tone="gold">Stickers &amp; community controls active</StatusBadge>}
      >
        <div className="grid gap-3 sm:grid-cols-2">
          <div className="min-w-0 rounded-md border border-border/60 bg-background/40 p-3">
            <div className="flex flex-wrap items-center gap-2">
              <StatusBadge tone="green">Live now</StatusBadge>
              <span className="text-sm font-medium text-foreground">Welcome &amp; onboarding</span>
            </div>
            <p className="mt-1.5 text-xs leading-relaxed text-muted-foreground">
              Each community has its own Community controls for join messages, member mention, and
              optional auto-delete of the bot's own welcome.
            </p>
          </div>

          <div className="min-w-0 rounded-md border border-border/60 bg-background/40 p-3">
            <div className="flex flex-wrap items-center gap-2">
              <StatusBadge tone="green">Live now</StatusBadge>
              <span className="text-sm font-medium text-foreground">Sticker Drops</span>
            </div>
            <p className="mt-1.5 text-xs leading-relaxed text-muted-foreground">
              Set up schedules per pack in Sticker Lab Review &amp; Telegram, then manage every
              community and schedule in the Distribution Center.
            </p>
          </div>

          <div className="min-w-0 rounded-md border border-border/60 bg-background/40 p-3">
            <div className="flex flex-wrap items-center gap-2">
              <StatusBadge tone="green">Live now</StatusBadge>
              <span className="text-sm font-medium text-foreground">Sticker distribution</span>
            </div>
            <p className="mt-1.5 text-xs leading-relaxed text-muted-foreground">
              Publish, retry, refresh set status, and send native test stickers from Sticker Lab Step 5.
              Both basic Telegram groups and supergroups can receive pack announcements and native stickers.
            </p>
          </div>

          <div className="min-w-0 rounded-md border border-border/60 bg-background/40 p-3">
            <div className="flex flex-wrap items-center gap-2">
              <StatusBadge tone="green">Live now</StatusBadge>
              <span className="text-sm font-medium text-foreground">Connection &amp; reconnect health</span>
            </div>
            <p className="mt-1.5 text-xs leading-relaxed text-muted-foreground">
              Detect bot removal, pause active schedules, and restore service when an administrator
              re-adds the bot.
            </p>
          </div>

          <div className="min-w-0 rounded-md border border-border/60 bg-background/40 p-3 opacity-80">
            <div className="flex flex-wrap items-center gap-2">
              <StatusBadge tone="muted">Planned</StatusBadge>
              <span className="text-sm font-medium text-foreground">Announcements</span>
            </div>
            <p className="mt-1.5 text-xs leading-relaxed text-muted-foreground">
              General community broadcasts beyond Sticker Drops.
            </p>
          </div>

          <div className="min-w-0 rounded-md border border-border/60 bg-background/40 p-3 opacity-80">
            <div className="flex flex-wrap items-center gap-2">
              <StatusBadge tone="muted">Planned</StatusBadge>
              <span className="text-sm font-medium text-foreground">Launch Distribution</span>
            </div>
            <p className="mt-1.5 text-xs leading-relaxed text-muted-foreground">
              Launch alerts and verified project signals through connected communities.
            </p>
          </div>

          <div className="min-w-0 rounded-md border border-border/60 bg-background/40 p-3 opacity-80 sm:col-span-2">
            <div className="flex flex-wrap items-center gap-2">
              <StatusBadge tone="muted">Planned</StatusBadge>
              <span className="text-sm font-medium text-foreground">Community Analytics</span>
            </div>
            <p className="mt-1.5 text-xs leading-relaxed text-muted-foreground">
              Growth, engagement, and Sticker Drop outcome reporting across communities.
            </p>
          </div>
        </div>

        <details className="mt-4 rounded-md border border-border/60 bg-background/40 p-3">
          <summary className="flex min-h-11 cursor-pointer list-none items-center text-xs font-semibold uppercase tracking-[0.14em] text-muted-foreground">
            Scope &amp; limitations
          </summary>
          <div className="mt-2 space-y-2 text-xs leading-relaxed text-muted-foreground">
            <p>
              Assigning a pack as a community’s <strong>official</strong> Telegram sticker set is an
              optional Telegram capability that exists only for <strong>supergroups</strong>, and
              Telegram decides when it is available for a given group. Otherwise CARTEL HQ posts the
              pack link in the community instead — publishing and native sticker sending are
              unaffected.
            </p>
            <p>
              Telegram allows one community per add-bot flow, so connect them one at a time.
            </p>
            <p>
              Inline mode, the Telegram Mini App, channel posting and distribution automation beyond
              Sticker Drops remain future phases.
            </p>
          </div>
        </details>
      </Section>
    </div>
  );
}
