import { createFileRoute } from "@tanstack/react-router";
import {
  Sticker,
  Palette,
  Send,
  PackageOpen,
  Sparkles,
  Radio,
  Target,
  Users,
  BarChart3,
} from "lucide-react";
import { PageHeader } from "@/components/cartel/PageHeader";
import { EmptyState } from "@/components/cartel/EmptyState";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";

export const Route = createFileRoute("/")({
  head: () => ({
    meta: [
      { title: "CARTEL HQ — PEPECARTEL Operating Layer" },
      {
        name: "description",
        content:
          "CARTEL HQ is the operating layer for PEPECARTEL creative tools, campaigns, creators, and distribution.",
      },
      { property: "og:title", content: "CARTEL HQ — PEPECARTEL Operating Layer" },
      {
        property: "og:description",
        content:
          "The command center for PEPECARTEL creative tools, campaigns, creators, and distribution.",
      },
    ],
  }),
  component: HqDashboard,
});

const QUICK_ACTIONS = [
  { label: "Create Sticker Pack", icon: Sticker, note: "Sticker Lab — next module" },
  { label: "Manage Brand Kit", icon: Palette, note: "Brand Kit — not built yet" },
  { label: "Connect Telegram", icon: Send, note: "Distribution — not built yet" },
];

const ROADMAP = [
  { label: "Sticker Lab", icon: Sticker, state: "Next up", tone: "gold" as const },
  { label: "Operations", icon: Radio, state: "Planned", tone: "muted" as const },
  { label: "Missions", icon: Target, state: "Planned", tone: "muted" as const },
  { label: "Operatives", icon: Users, state: "Planned", tone: "muted" as const },
  { label: "Analytics", icon: BarChart3, state: "Planned", tone: "muted" as const },
];

function HqDashboard() {
  return (
    <div className="space-y-8">
      <PageHeader
        eyebrow="Command Center"
        title="CARTEL HQ"
        description="The operating layer for PEPECARTEL creative tools, campaigns, creators, and distribution."
        status="Phase 0 · Foundation"
      />

      <section
        aria-labelledby="workspace-heading"
        className="rise-in cartel-panel relative overflow-hidden rounded-xl p-6"
      >
        <div
          className="pointer-events-none absolute inset-0"
          style={{ background: "var(--gradient-hq)" }}
          aria-hidden="true"
        />
        <div className="relative flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <p className="text-[11px] uppercase tracking-[0.24em] text-muted-foreground">
              Active workspace
            </p>
            <h2 id="workspace-heading" className="mt-1 font-display text-2xl uppercase text-gold">
              PEPECARTEL
            </h2>
            <p className="mt-2 max-w-xl text-sm text-muted-foreground">
              Placeholder workspace. Multi-workspace switching, membership, and roles are not
              implemented in this phase.
            </p>
          </div>
          <Badge variant="outline" className="w-fit border-gold/40 text-gold">
            Placeholder
          </Badge>
        </div>
      </section>

      <section aria-labelledby="quick-actions-heading" className="space-y-3">
        <h2
          id="quick-actions-heading"
          className="font-display text-lg uppercase tracking-widest text-foreground"
        >
          Quick actions
        </h2>
        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
          {QUICK_ACTIONS.map((action) => (
            <Card key={action.label} className="cartel-panel rise-in hover-lift">
              <CardContent className="flex items-start gap-3 p-5">
                <span className="flex size-10 shrink-0 items-center justify-center rounded-md border border-border bg-surface-raised text-gold">
                  <action.icon className="size-5" aria-hidden="true" />
                </span>
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-semibold text-foreground">{action.label}</p>
                  <p className="mt-1 text-xs text-muted-foreground">{action.note}</p>
                  <Button
                    disabled
                    size="sm"
                    variant="outline"
                    className="mt-3 border-border text-xs"
                  >
                    Unavailable
                  </Button>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      </section>

      <div className="grid gap-4 lg:grid-cols-3">
        <Card className="cartel-panel rise-in self-start lg:col-span-2">
          <CardHeader>
            <CardTitle className="text-sm uppercase tracking-widest">Recent packs</CardTitle>
          </CardHeader>
          <CardContent>
            <EmptyState
              icon={PackageOpen}
              title="No packs yet"
              description="Sticker packs will appear here once Sticker Lab is built. Nothing is stored today."
            />
          </CardContent>
        </Card>

        <div className="space-y-4">
          <Card className="cartel-panel rise-in">
            <CardHeader className="flex-row items-center justify-between space-y-0">
              <CardTitle className="text-sm uppercase tracking-widest">AI usage</CardTitle>
              <Badge variant="outline" className="border-border text-[10px] uppercase">
                Not tracked
              </Badge>
            </CardHeader>
            <CardContent>
              <EmptyState
                compact
                icon={Sparkles}
                title="No AI providers connected"
                description="Generation credits and usage metering arrive with the Sticker Lab backend."
              />
            </CardContent>
          </Card>

          <Card className="cartel-panel rise-in">
            <CardHeader className="flex-row items-center justify-between space-y-0">
              <CardTitle className="text-sm uppercase tracking-widest">Telegram status</CardTitle>
              <Badge variant="outline" className="border-signal/45 text-signal text-[10px] uppercase">
                Disconnected
              </Badge>
            </CardHeader>
            <CardContent>
              <EmptyState
                compact
                icon={Send}
                title="No bot linked"
                description="Telegram publishing is not configured in this phase."
              />
            </CardContent>
          </Card>
        </div>
      </div>

      <section aria-labelledby="roadmap-heading" className="space-y-3">
        <h2
          id="roadmap-heading"
          className="font-display text-lg uppercase tracking-widest text-foreground"
        >
          Upcoming modules
        </h2>
        <ol className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3 2xl:grid-cols-5">
          {ROADMAP.map((item, index) => (
            <li
              key={item.label}
              className={`rise-in flex items-center gap-3 rounded-lg border px-3 py-3 ${
                item.tone === "gold" ? "border-gold/40 bg-gold/5" : "border-border bg-surface"
              }`}
            >
              <span className="font-display text-sm text-muted-foreground">
                {String(index + 1).padStart(2, "0")}
              </span>
              <item.icon
                className={`size-4 ${item.tone === "gold" ? "text-gold" : "text-muted-foreground"}`}
                aria-hidden="true"
              />
              <span className="min-w-0 flex-1 text-sm text-foreground">{item.label}</span>
              <span
                className={`text-[10px] uppercase tracking-wider ${
                  item.tone === "gold" ? "text-gold" : "text-muted-foreground/70"
                }`}
              >
                {item.state}
              </span>
            </li>
          ))}
        </ol>
      </section>
    </div>
  );
}
