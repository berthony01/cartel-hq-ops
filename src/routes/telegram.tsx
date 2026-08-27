import { createFileRoute } from "@tanstack/react-router";
import { MessageSquare } from "lucide-react";
import { PlaceholderPage } from "@/components/cartel/PlaceholderPage";

export const Route = createFileRoute("/telegram")({
  head: () => ({
    meta: [
      { title: "Telegram — CARTEL HQ" },
      {
        name: "description",
        content: "Telegram tools will power sticker pack publishing, inline mode, and the CARTEL HQ Mini App.",
      },
      { property: "og:title", content: "Telegram — CARTEL HQ" },
      { property: "og:description", content: "Future CARTEL HQ Telegram bot and Mini App tooling." },
    ],
  }),
  component: TelegramPage,
});

function TelegramPage() {
  return (
    <PlaceholderPage
      icon={MessageSquare}
      eyebrow="System"
      title="Telegram"
      description="The future home of the official CARTEL HQ bot: sticker pack publishing first, then inline mode and the Telegram Mini App."
      status="Planned — not active"
      highlight="No bot is connected and no Telegram functionality is live in this build."
      availableNow={["Route and navigation entry", "Roadmap placement in SYSTEM"]}
      plannedLater={[
        "Sticker pack publishing via the official CARTEL HQ bot",
        "Pack management and notifications",
        "Inline sticker retrieval",
        "Telegram Mini App launch",
      ]}
    />
  );
}
