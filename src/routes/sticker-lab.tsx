import { createFileRoute } from "@tanstack/react-router";
import { Sticker } from "lucide-react";
import { PlaceholderPage } from "@/components/cartel/PlaceholderPage";

export const Route = createFileRoute("/sticker-lab")({
  head: () => ({
    meta: [
      { title: "Sticker Lab — CARTEL HQ" },
      {
        name: "description",
        content:
          "Sticker Lab is the first production module of CARTEL HQ, currently in foundation stage.",
      },
      { property: "og:title", content: "Sticker Lab — CARTEL HQ" },
      {
        property: "og:description",
        content: "The first production module of the PEPECARTEL operating layer.",
      },
    ],
  }),
  component: StickerLabPage,
});

function StickerLabPage() {
  return (
    <PlaceholderPage
      icon={Sticker}
      eyebrow="Module 01"
      title="Sticker Lab"
      description="Design, generate, and ship PEPECARTEL sticker packs from one workspace."
      status="First production module · Coming next"
      highlight="Sticker Lab is the next module to be built. Nothing here generates, stores, or publishes anything yet."
      availableNow={[
        "Navigation entry and route scaffolding",
        "Module positioning inside CARTEL HQ",
        "Design tokens and layout primitives it will reuse",
      ]}
      plannedLater={[
        "Pack creation and editing workflow",
        "AI-assisted sticker generation",
        "Asset uploads and storage",
        "Telegram pack publishing",
        "Pack versioning and history",
      ]}
    />
  );
}
