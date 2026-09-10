import { createFileRoute } from "@tanstack/react-router";
import { Users } from "lucide-react";
import { PlaceholderPage } from "@/components/cartel/PlaceholderPage";

export const Route = createFileRoute("/_authenticated/operatives")({
  head: () => ({
    meta: [
      { title: "Operatives — CARTEL HQ" },
      {
        name: "description",
        content: "Operatives will become the future Cartel AI Operator and team operations layer.",
      },
      { property: "og:title", content: "Operatives — CARTEL HQ" },
      { property: "og:description", content: "Future Cartel AI Operator and team operations layer." },
    ],
  }),
  component: OperativesPage,
});

function OperativesPage() {
  return (
    <PlaceholderPage
      icon={Users}
      eyebrow="Module"
      title="Operatives"
      description="Future Cartel AI Operator and team operations layer: collaborators, assisted operations, and delegated work inside the workspace."
      status="Planned — not active"
      availableNow={["Reserved route and roadmap placement", "No team, roster, or AI Operator functionality is live"]}
      plannedLater={[
        "Operative profiles and roles",
        "Invites and workspace membership",
        "Reputation scoring",
        "Contribution history",
      ]}
    />
  );
}
