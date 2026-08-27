import { createFileRoute } from "@tanstack/react-router";
import {
  Sticker,
  Palette,
  FolderLock,
  Send,
  PackageOpen,
  Sparkles,
  Radio,
  Target,
  Users,
  BarChart3,
  ShieldCheck,
  TerminalSquare,
  Radar,
  Award,
  MessageSquare,
  type LucideIcon,
} from "lucide-react";
import { PageHeader } from "@/components/cartel/PageHeader";
import { EmptyState } from "@/components/cartel/EmptyState";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";

export const Route = createFileRoute("/_authenticated/")({
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

const ROADMAP_GROUPS: {
  label: string;
  modules: { label: string; icon: LucideIcon; state: "Active build" | "Planned" }[];
}[] = [
  {
    label: "Command",
    modules: [
      { label: "Cartel Clearance", icon: ShieldCheck, state: "Planned" },
      { label: "Command Terminal", icon: TerminalSquare, state: "Planned" },
    ],
  },
  {
    label: "Create",
    modules: [
      { label: "Sticker Lab", icon: Sticker, state: "Active build" },
      { label: "Brand Kit", icon: Palette, state: "Planned" },
      { label: "Assets", icon: FolderLock, state: "Planned" },
    ],
  },
  {
    label: "Operations",
    modules: [
      { label: "Operations", icon: Radio, state: "Planned" },
      { label: "Missions", icon: Target, state: "Planned" },
      { label: "Operatives", icon: Users, state: "Planned" },
      { label: "Distribution", icon: Send, state: "Planned" },
    ],
  },
  {
    label: "Intelligence",
    modules: [
      { label: "Cartel Shield", icon: Radar, state: "Planned" },
      { label: "Reputation", icon: Award, state: "Planned" },
      { label: "Analytics", icon: BarChart3, state: "Planned" },
    ],
  },
  {
    label: "System",
    modules: [{ label: "Telegram", icon: MessageSquare, state: "Planned" }],
  },
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
        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
          {ROADMAP_GROUPS.map((group) => (
            <Card key={group.label} className="cartel-panel rise-in">
              <CardHeader className="pb-2">
                <CardTitle className="text-xs uppercase tracking-[0.22em] text-muted-foreground">
                  {group.label}
                </CardTitle>
              </CardHeader>
              <CardContent className="pt-0">
                <ul className="space-y-1.5">
                  {group.modules.map((item) => (
                    <li key={item.label} className="flex items-center gap-2.5 text-sm">
                      <item.icon
                        className={`size-4 shrink-0 ${
                          item.state === "Active build" ? "text-gold" : "text-muted-foreground"
                        }`}
                        aria-hidden="true"
                      />
                      <span className="min-w-0 flex-1 truncate text-foreground">{item.label}</span>
                      {item.state === "Active build" ? (
                        <span className="shrink-0 rounded-sm border border-gold/40 px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wider text-gold">
                          Active build
                        </span>
                      ) : (
                        <span className="shrink-0 text-[10px] uppercase tracking-wider text-muted-foreground/70">
                          Planned
                        </span>
                      )}
                    </li>
                  ))}
                </ul>
              </CardContent>
            </Card>
          ))}
        </div>
      </section>
    </div>
  );
}
