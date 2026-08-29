import { createFileRoute } from "@tanstack/react-router";

import { PageHeader } from "@/components/cartel/PageHeader";
import { Section } from "@/components/cartel/Section";
import { StatusBadge } from "@/components/cartel/StatusBadge";

import { useTelegramSetup } from "@/components/cartel/TelegramConnectionCard";
import {
  TelegramGroupCard,
  useTelegramGroupSetup,
} from "@/components/cartel/TelegramGroupCard";


export const Route = createFileRoute("/_authenticated/telegram")({
  head: () => ({
    meta: [
      { title: "Community Hub — CARTEL HQ" },
      {
        name: "description",
        content:
          "Manage connected Telegram communities, welcome new members automatically, distribute sticker packs, and run Sticker Drops from one place.",
      },
      { property: "og:title", content: "Community Hub — CARTEL HQ" },
      {
        property: "og:description",
        content: "Manage connected Telegram communities, welcomes, sticker distribution, and Sticker Drops.",
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

  const groupCount = groupSetup.connectedGroupCount;

  return (
    <div className="flex max-w-3xl flex-col gap-4 sm:gap-6">
      <PageHeader
        eyebrow="Telegram"
        title="Community Hub"
        description="Every connected Telegram community lives here. Choose a community below, then open its Community controls to manage Welcome and onboarding, Sticker Drops, sticker distribution, and future community tools."
        status={groupCount > 0 ? "Connected · Live Beta" : "Live Beta"}
      />

      <div className="flex flex-wrap items-center gap-2">
        <StatusBadge tone={setup.botConfigured ? "green" : "muted"}>
          {setup.botConfigured ? "Telegram service available" : "Telegram service unavailable"}
        </StatusBadge>
        <StatusBadge tone={groupCount > 0 ? "green" : "muted"}>
          {groupCount > 0
            ? `${groupCount} community${groupCount === 1 ? "" : "s"} connected`
            : "No communities connected"}
        </StatusBadge>
      </div>

      {groupCount > 0 ? (
        <div className="rounded-md border border-gold/30 bg-gold/5 p-3 text-xs leading-relaxed text-foreground">
          <p className="font-semibold text-gold">Welcome and onboarding is live.</p>
          <p className="mt-1 text-muted-foreground">
            Select a connected community, open Community controls, then choose Welcome and onboarding
            to set the join message, member mention, and auto-delete timer.
          </p>
        </div>
      ) : null}

      <TelegramGroupCard
        setup={groupSetup}
        personalConnected={setup.ownerConnected}
        botConfigured={setup.botConfigured}
      />

      <Section
        variant="surface"
        title="Capabilities"
        actions={<StatusBadge tone="gold">Stickers &amp; community controls active</StatusBadge>}
      >
        <p className="text-xs leading-relaxed text-muted-foreground">
          Each connected community has its own Community controls, starting with Welcome &amp;
          onboarding: a public welcome message for new members, optional member mention and optional
          auto-delete of the bot's own welcome. Publish, retry, refresh set status and send a native
          test sticker from Sticker Lab Step 5.
          Scheduled Sticker Drops are live: set them up per pack in Sticker Lab Review &amp;
          Telegram, and manage every community and schedule in the Distribution Center. Both basic
          Telegram groups and supergroups can receive pack announcements and native stickers.
        </p>
        <details className="mt-3 rounded-md border border-border/60 bg-background/40 p-3">
          <summary className="flex min-h-11 cursor-pointer list-none items-center text-xs font-semibold uppercase tracking-[0.14em] text-muted-foreground">
            Scope & limitations
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


