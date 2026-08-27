import { createFileRoute } from "@tanstack/react-router";
import { ShieldCheck } from "lucide-react";
import { PlaceholderPage } from "@/components/cartel/PlaceholderPage";

export const Route = createFileRoute("/clearance")({
  head: () => ({
    meta: [
      { title: "Cartel Clearance — CARTEL HQ" },
      {
        name: "description",
        content: "Cartel Clearance will handle PEPECARTEL project onboarding, review, and status tracking.",
      },
      { property: "og:title", content: "Cartel Clearance — CARTEL HQ" },
      { property: "og:description", content: "Project onboarding and review layer for the PEPECARTEL ecosystem." },
    ],
  }),
  component: ClearancePage,
});

function ClearancePage() {
  return (
    <PlaceholderPage
      icon={ShieldCheck}
      eyebrow="Command"
      title="Cartel Clearance"
      description="Project onboarding, due-diligence inputs, and review/status tracking for the PEPECARTEL ecosystem."
      status="Planned — not active"
      highlight="Clearance will record review status only. It will not certify, endorse, or guarantee that any project is safe."
      availableNow={["Route and navigation entry", "Roadmap placement in COMMAND"]}
      plannedLater={[
        "Project identity and submission intake",
        "Due-diligence inputs and review status",
        "Approval and listing status tracking",
        "Reputation and endorsement signals (later phase)",
      ]}
    />
  );
}
