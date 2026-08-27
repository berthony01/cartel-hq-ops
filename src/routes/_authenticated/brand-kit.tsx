import { createFileRoute } from "@tanstack/react-router";
import { Palette } from "lucide-react";
import { PlaceholderPage } from "@/components/cartel/PlaceholderPage";

export const Route = createFileRoute("/_authenticated/brand-kit")({
  head: () => ({
    meta: [
      { title: "Brand Kit — CARTEL HQ" },
      {
        name: "description",
        content: "Brand Kit will hold the PEPECARTEL palette, type, logos, and usage rules.",
      },
      { property: "og:title", content: "Brand Kit — CARTEL HQ" },
      {
        property: "og:description",
        content: "Central brand system for PEPECARTEL creative output.",
      },
    ],
  }),
  component: BrandKitPage,
});

function BrandKitPage() {
  return (
    <PlaceholderPage
      icon={Palette}
      eyebrow="Module"
      title="Brand Kit"
      description="A single source of truth for PEPECARTEL colour, type, marks, and usage rules."
      status="Placeholder"
      availableNow={["Route and navigation entry", "Applied CARTEL HQ design tokens"]}
      plannedLater={[
        "Palette and typography management",
        "Logo and mark library",
        "Usage rules and do/don't guidance",
        "Brand presets consumed by Sticker Lab",
      ]}
    />
  );
}
