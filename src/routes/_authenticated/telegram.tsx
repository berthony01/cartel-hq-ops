import { createFileRoute } from "@tanstack/react-router";

import { PageHeader } from "@/components/cartel/PageHeader";
import { StatusBadge } from "@/components/cartel/StatusBadge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  TelegramConnectionCard,
  useTelegramSetup,
} from "@/components/cartel/TelegramConnectionCard";

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

  return (
    <div className="flex max-w-3xl flex-col gap-6">
      <PageHeader
        eyebrow="System"
        title="Telegram"
        description="The official CARTEL HQ bot publishes static sticker packs from Sticker Lab. The bot token lives server-side only."
        status={setup.botConfigured ? "Bot configured" : "Bot not configured"}
      />

      <TelegramConnectionCard setup={setup} />

      <Card className="cartel-panel">
        <CardHeader className="flex-row items-center justify-between gap-3 space-y-0">
          <CardTitle className="text-base">Capabilities</CardTitle>
          <StatusBadge tone="gold">Sticker publishing active</StatusBadge>
        </CardHeader>
        <CardContent className="space-y-2 text-xs text-muted-foreground">
          <p>
            Static sticker pack publishing is active: publish, retry failed stickers, refresh set
            status and send a native test sticker from Sticker Lab Step 5.
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
