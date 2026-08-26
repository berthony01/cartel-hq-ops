import { createFileRoute } from "@tanstack/react-router";
import { Radio } from "lucide-react";
import { PlaceholderPage } from "@/components/cartel/PlaceholderPage";

export const Route = createFileRoute("/operations")({
  head: () => ({
    meta: [
      { title: "Operations — CARTEL HQ" },
      {
        name: "description",
        content: "Operations will coordinate PEPECARTEL campaigns and distribution runs.",
      },
      { property: "og:title", content: "Operations — CARTEL HQ" },
      { property: "og:description", content: "Campaign and distribution coordination for PEPECARTEL." },
    ],
  }),
  component: OperationsPage,
});

function OperationsPage() {
  return (
    <PlaceholderPage
      icon={Radio}
      eyebrow="Module"
      title="Operations"
      description="Plan and run campaigns, drops, and distribution pushes across PEPECARTEL channels."
      status="Placeholder"
      availableNow={["Route and navigation entry", "Positioning within the module roadmap"]}
      plannedLater={[
        "Campaign records and scheduling",
        "Channel distribution runs",
        "Operational status tracking",
        "Result reporting into Analytics",
      ]}
    />
  );
}
