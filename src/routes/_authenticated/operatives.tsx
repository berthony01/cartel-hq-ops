import { createFileRoute } from "@tanstack/react-router";
import { Users } from "lucide-react";
import { PlaceholderPage } from "@/components/cartel/PlaceholderPage";

export const Route = createFileRoute("/_authenticated/operatives")({
  head: () => ({
    meta: [
      { title: "Operatives — CARTEL HQ" },
      {
        name: "description",
        content: "Operatives will manage PEPECARTEL creators, roles, and reputation.",
      },
      { property: "og:title", content: "Operatives — CARTEL HQ" },
      { property: "og:description", content: "Creator roster and reputation for PEPECARTEL." },
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
      description="The roster of creators and collaborators working inside the PEPECARTEL ecosystem."
      status="Placeholder"
      availableNow={["Route and navigation entry", "Roadmap placement after Missions"]}
      plannedLater={[
        "Operative profiles and roles",
        "Invites and workspace membership",
        "Reputation scoring",
        "Contribution history",
      ]}
    />
  );
}
