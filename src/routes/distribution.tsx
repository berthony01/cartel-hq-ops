import { createFileRoute } from "@tanstack/react-router";
import { Send } from "lucide-react";
import { PlaceholderPage } from "@/components/cartel/PlaceholderPage";

export const Route = createFileRoute("/distribution")({
  head: () => ({
    meta: [
      { title: "Distribution — CARTEL HQ" },
      {
        name: "description",
        content: "Distribution will connect campaign assets, creators, channels, and measurable outcomes.",
      },
      { property: "og:title", content: "Distribution — CARTEL HQ" },
      { property: "og:description", content: "Legitimate campaign and content distribution tooling." },
    ],
  }),
  component: DistributionPage,
});

function DistributionPage() {
  return (
    <PlaceholderPage
      icon={Send}
      eyebrow="Operations"
      title="Distribution"
      description="Tools and workflows connecting campaign assets, creators, channels, referrals, and measurable distribution outcomes."
      status="Planned — not active"
      highlight="Distribution is legitimate content and campaign distribution — not spam, raid automation, or artificial engagement."
      availableNow={["Route and navigation entry", "Roadmap placement in OPERATIONS"]}
      plannedLater={[
        "Campaign asset and channel workflows",
        "Creator and referral distribution",
        "Measurable outcome tracking",
      ]}
    />
  );
}
