import { createFileRoute } from "@tanstack/react-router";
import { Settings } from "lucide-react";
import { PlaceholderPage } from "@/components/cartel/PlaceholderPage";

export const Route = createFileRoute("/_authenticated/settings")({
  head: () => ({
    meta: [
      { title: "Settings — CARTEL HQ" },
      {
        name: "description",
        content: "Workspace, account, and integration settings for CARTEL HQ.",
      },
      { property: "og:title", content: "Settings — CARTEL HQ" },
      { property: "og:description", content: "Workspace and integration configuration for CARTEL HQ." },
    ],
  }),
  component: SettingsPage,
});

function SettingsPage() {
  return (
    <PlaceholderPage
      icon={Settings}
      eyebrow="System"
      title="Settings"
      description="Workspace configuration, access, and integrations for the PEPECARTEL operating layer."
      status="Placeholder"
      availableNow={["Route and navigation entry", "Shell-level appearance tokens"]}
      plannedLater={[
        "Workspace profile and members",
        "Authentication and session controls",
        "Telegram and AI provider integrations",
        "Billing and usage limits",
      ]}
    />
  );
}
