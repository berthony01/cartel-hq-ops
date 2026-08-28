import { createFileRoute } from "@tanstack/react-router";

import { PageHeader } from "@/components/cartel/PageHeader";
import { Section } from "@/components/cartel/Section";
import { StatusBadge } from "@/components/cartel/StatusBadge";

import {
  TelegramConnectionCard,
  useTelegramSetup,
} from "@/components/cartel/TelegramConnectionCard";
import {
  TelegramGroupCard,
  useTelegramGroupSetup,
} from "@/components/cartel/TelegramGroupCard";


export const Route = createFileRoute("/_authenticated/telegram")({
  head: () => ({
    meta: [
      { title: "Telegram — CARTEL HQ" },
      {
        name: "description",
        content:
          "CARTEL HQ Telegram system status: bot configuration and the owner account used to publish sticker packs.",
      },
      { property: "og:title", content: "Telegram — CARTEL HQ" },
      {
        property: "og:description",
        content: "Bot status and sticker-set owner connection for CARTEL HQ.",
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

  const connected = setup.ownerConnected;
  const groupCount = groupSetup.connectedGroupCount;

  return (
    <div className="flex max-w-3xl flex-col gap-4 sm:gap-6">
      <PageHeader
        eyebrow="System"
        title="Telegram"
        description="Publish static sticker packs from Sticker Lab and distribute them to the Telegram groups connected to this workspace."
        status={connected ? "Connected · Live Beta" : "Live Beta"}
      />

      <div className="flex flex-wrap items-center gap-2">
        <StatusBadge tone={setup.botConfigured ? "green" : "red"}>
          {setup.botConfigured ? "Bot configured" : "Bot not configured"}
        </StatusBadge>
        <StatusBadge tone={connected ? "green" : "muted"}>
          {connected ? "Account linked" : "Account not linked"}
        </StatusBadge>
        <StatusBadge tone={groupCount > 0 ? "green" : "muted"}>
          {groupCount > 0
            ? `${groupCount} group${groupCount === 1 ? "" : "s"} connected`
            : "No groups connected"}
        </StatusBadge>
      </div>

      <TelegramConnectionCard setup={setup} />

      <TelegramGroupCard
        setup={groupSetup}
        personalConnected={setup.ownerConnected}
        botConfigured={setup.botConfigured}
      />

      <Section
        variant="surface"
        title="Capabilities"
        actions={<StatusBadge tone="gold">Sticker publishing active</StatusBadge>}
      >
        <p className="text-xs leading-relaxed text-muted-foreground">
          Publish, retry, refresh set status and send a native test sticker from Sticker Lab Step 5.
          Both basic Telegram groups and supergroups can receive pack announcements and native
          stickers.
        </p>
        <details className="mt-3 rounded-md border border-border/60 bg-background/40 p-3">
          <summary className="flex min-h-11 cursor-pointer list-none items-center text-xs font-semibold uppercase tracking-[0.14em] text-muted-foreground">
            Scope & limitations
          </summary>
          <div className="mt-2 space-y-2 text-xs leading-relaxed text-muted-foreground">
            <p>
              Assigning a pack as a group’s <strong>official</strong> Telegram sticker set is an
              optional Telegram capability that exists only for <strong>supergroups</strong>, and
              Telegram decides when it is available for a given group. Otherwise CARTEL HQ posts the
              pack link in the group instead — publishing and native sticker sending are unaffected.
            </p>
            <p>
              Telegram allows one group per add-bot flow, so connect groups one at a time. The bot
              token lives server-side only.
            </p>
            <p>
              Inline mode, the Telegram Mini App, channel posting and distribution automation remain
              future phases and are not part of this build.
            </p>
          </div>
        </details>
      </Section>
    </div>
  );
}

