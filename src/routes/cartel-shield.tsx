import { createFileRoute } from "@tanstack/react-router";
import { Radar } from "lucide-react";
import { PlaceholderPage } from "@/components/cartel/PlaceholderPage";

export const Route = createFileRoute("/cartel-shield")({
  head: () => ({
    meta: [
      { title: "Cartel Shield — CARTEL HQ" },
      {
        name: "description",
        content: "Cartel Shield will provide evidence-based project and creator intelligence and risk signals.",
      },
      { property: "og:title", content: "Cartel Shield — CARTEL HQ" },
      { property: "og:description", content: "Future intelligence and risk-signals layer." },
    ],
  }),
  component: CartelShieldPage,
});

function CartelShieldPage() {
  return (
    <PlaceholderPage
      icon={Radar}
      eyebrow="Intelligence"
      title="Cartel Shield"
      description="Future project and creator intelligence layer: review history, risk indicators, warnings, disputes, and status changes."
      status="Planned — not active"
      highlight="Shield will use evidence-based, non-defamatory wording and clearly distinguish reports and signals from verified facts."
      availableNow={["Route and navigation entry", "Roadmap placement in INTELLIGENCE"]}
      plannedLater={[
        "Review history and risk indicators",
        "Suspicious behavior signals and warnings",
        "Disputes and status changes",
        "Curated blacklist/watchlist functionality (later phase)",
      ]}
    />
  );
}
