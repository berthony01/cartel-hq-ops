import { createFileRoute } from "@tanstack/react-router";
import { Award } from "lucide-react";
import { PlaceholderPage } from "@/components/cartel/PlaceholderPage";

export const Route = createFileRoute("/reputation")({
  head: () => ({
    meta: [
      { title: "Reputation — CARTEL HQ" },
      {
        name: "description",
        content: "Reputation will track performance-based standing for creators and projects.",
      },
      { property: "og:title", content: "Reputation — CARTEL HQ" },
      { property: "og:description", content: "Future performance-based creator and project reputation." },
    ],
  }),
  component: ReputationPage,
});

function ReputationPage() {
  return (
    <PlaceholderPage
      icon={Award}
      eyebrow="Intelligence"
      title="Reputation"
      description="Future performance-based reputation for creators and projects, built on verified outcomes rather than self-reported claims."
      status="Planned — not active"
      highlight="No reputation scores, ratings, or rankings exist in this build."
      availableNow={["Route and navigation entry", "Roadmap placement in INTELLIGENCE"]}
      plannedLater={[
        "Completion rate and verified performance inputs",
        "Project ratings and conversion quality",
        "Dispute and suspicious-engagement history",
        "Historical outcome tracking",
      ]}
    />
  );
}
