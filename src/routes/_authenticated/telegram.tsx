import { createFileRoute } from "@tanstack/react-router";

import { PageHeader } from "@/components/cartel/PageHeader";
import { StatusBadge } from "@/components/cartel/StatusBadge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
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

  return (
    <div className="flex max-w-3xl flex-col gap-6">
      <PageHeader
        eyebrow="System"
        title="Telegram"
        description="The official CARTEL HQ bot publishes static sticker packs from Sticker Lab into a verified Telegram group or supergroup. Telegram's official group sticker set applies only to eligible supergroups; otherwise the pack link is posted in the group. The bot token lives server-side only."
        status={setup.botConfigured ? "Bot configured" : "Bot not configured"}
      />

      <TelegramConnectionCard setup={setup} />

      <TelegramGroupCard
        setup={groupSetup}
        personalConnected={setup.ownerConnected}
        botConfigured={setup.botConfigured}
      />


      <Card className="cartel-panel">
        <CardHeader className="flex-row items-center justify-between gap-3 space-y-0">
          <CardTitle className="text-base">Capabilities</CardTitle>
          <StatusBadge tone="gold">Sticker publishing active</StatusBadge>
        </CardHeader>
        <CardContent className="space-y-2 text-xs text-muted-foreground">
          <p>
            Static sticker pack publishing is active: publish, retry failed stickers, refresh set
            status and send a native test sticker from Sticker Lab Step 5. These work for any
            verified connected target — both <strong>basic Telegram groups</strong> and{" "}
            <strong>supergroups</strong> can receive pack announcements and native stickers.
          </p>
          <p>
            Assigning a pack as a group's <strong>official</strong> Telegram sticker set is a
            Telegram feature that exists only for <strong>supergroups</strong> that also meet
            Telegram's member minimum. In a basic group, or a supergroup that is not eligible yet,
            CARTEL HQ posts the pack link in the group instead — publishing and native sticker
            sending are unaffected, and converting the group is optional.
          </p>
          <p>
            Inline mode, the Telegram Mini App, channel posting and distribution automation remain
            future phases and are not part of this build.
          </p>
        </CardContent>
      </Card>
    </div>
  );
}
