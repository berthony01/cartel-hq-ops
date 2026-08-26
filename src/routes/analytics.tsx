import { createFileRoute } from "@tanstack/react-router";
import { BarChart3 } from "lucide-react";
import { PlaceholderPage } from "@/components/cartel/PlaceholderPage";

export const Route = createFileRoute("/analytics")({
  head: () => ({
    meta: [
      { title: "Analytics — CARTEL HQ" },
      {
        name: "description",
        content: "Analytics will report on PEPECARTEL packs, campaigns, and distribution reach.",
      },
      { property: "og:title", content: "Analytics — CARTEL HQ" },
      { property: "og:description", content: "Performance reporting for the PEPECARTEL ecosystem." },
    ],
  }),
  component: AnalyticsPage,
});

function AnalyticsPage() {
  return (
    <PlaceholderPage
      icon={BarChart3}
      eyebrow="Module"
      title="Analytics"
      description="Reach, adoption, and creative performance across packs, campaigns, and channels."
      status="Placeholder"
      availableNow={["Route and navigation entry", "Roadmap placement after Operatives"]}
      plannedLater={[
        "Pack and campaign performance metrics",
        "Channel and distribution reporting",
        "AI usage and cost breakdowns",
        "Exportable reports",
      ]}
    />
  );
}
