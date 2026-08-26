import { createFileRoute } from "@tanstack/react-router";
import { Target } from "lucide-react";
import { PlaceholderPage } from "@/components/cartel/PlaceholderPage";

export const Route = createFileRoute("/missions")({
  head: () => ({
    meta: [
      { title: "Missions — CARTEL HQ" },
      {
        name: "description",
        content: "Missions will define tasks and bounties for PEPECARTEL contributors.",
      },
      { property: "og:title", content: "Missions — CARTEL HQ" },
      { property: "og:description", content: "Task and bounty coordination for PEPECARTEL." },
    ],
  }),
  component: MissionsPage,
});

function MissionsPage() {
  return (
    <PlaceholderPage
      icon={Target}
      eyebrow="Module"
      title="Missions"
      description="Structured tasks, bounties, and creative briefs assigned across the cartel."
      status="Placeholder"
      availableNow={["Route and navigation entry", "Roadmap placement after Operations"]}
      plannedLater={[
        "Mission briefs and requirements",
        "Assignment and submission flow",
        "Review and approval states",
        "Rewards and reputation impact",
      ]}
    />
  );
}
