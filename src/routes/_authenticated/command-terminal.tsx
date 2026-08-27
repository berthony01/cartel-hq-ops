import { createFileRoute } from "@tanstack/react-router";
import { TerminalSquare } from "lucide-react";
import { PlaceholderPage } from "@/components/cartel/PlaceholderPage";

export const Route = createFileRoute("/_authenticated/command-terminal")({
  head: () => ({
    meta: [
      { title: "Command Terminal — CARTEL HQ" },
      {
        name: "description",
        content: "Command Terminal will become an approved-project discovery and trading interface.",
      },
      { property: "og:title", content: "Command Terminal — CARTEL HQ" },
      { property: "og:description", content: "Future approved-project discovery and trading interface." },
    ],
  }),
  component: CommandTerminalPage,
});

function CommandTerminalPage() {
  return (
    <PlaceholderPage
      icon={TerminalSquare}
      eyebrow="Command"
      title="Command Terminal"
      description="Future discovery and trading interface for approved projects, routed through established third-party DEX/aggregation infrastructure when separately authorized."
      status="Planned — not active"
      highlight="No swaps, wallet execution, smart contracts, token routing, or aggregator integrations exist in this build."
      availableNow={["Route and navigation entry", "Roadmap placement in COMMAND"]}
      plannedLater={[
        "Approved-project discovery interface",
        "Embedded routing via third-party DEX/aggregator infrastructure",
        "Trading and wallet execution (requires separate authorization and security review)",
      ]}
    />
  );
}
