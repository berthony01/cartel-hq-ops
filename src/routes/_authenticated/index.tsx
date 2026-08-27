import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
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
import { supabase } from "@/integrations/supabase/client";
import { useSession } from "@/hooks/useSession";
import { useWorkspace } from "@/lib/workspace-context";
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

const QUICK_ACTIONS: {
  label: string;
  icon: LucideIcon;
  note: string;
  to: string;
}[] = [
  {
    label: "Create Sticker Pack",
    icon: Sticker,
    note: "Sticker Lab — first production module",
    to: "/sticker-lab",
  },
  { label: "Manage Brand Kit", icon: Palette, note: "Colours, type, marks, AI rules", to: "/brand-kit" },
  { label: "Open Asset Vault", icon: FolderLock, note: "Private workspace storage", to: "/assets" },
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
  const { workspace, workspaceId, loading: workspaceLoading } = useWorkspace();
  const { user } = useSession();

  const packsQuery = useQuery({
    queryKey: ["recent-packs", workspaceId],
    enabled: !!workspaceId,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("sticker_packs")
        .select("id,title,theme,pack_size,status,created_at")
        .eq("workspace_id", workspaceId!)
        .order("created_at", { ascending: false })
        .limit(5);
      if (error) throw error;
      return data ?? [];
    },
  });

  const usageQuery = useQuery({
    queryKey: ["ai-usage", workspaceId],
    enabled: !!workspaceId,
    queryFn: async () => {
      const { count, error } = await supabase
        .from("ai_jobs")
        .select("id", { count: "exact", head: true })
        .eq("workspace_id", workspaceId!);
      if (error) throw error;
      return count ?? 0;
    },
  });

  const telegramQuery = useQuery({
    queryKey: ["telegram-connection", user?.id],
    enabled: !!user?.id,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("telegram_connections")
        .select("id,telegram_username,connected_at")
        .eq("user_id", user!.id)
        .maybeSingle();
      if (error) throw error;
      return data;
    },
  });

  const packs = packsQuery.data ?? [];
  const telegram = telegramQuery.data;

  return (
    <div className="space-y-8">
      <PageHeader
        eyebrow="Command Center"
        title="CARTEL HQ"
        description="The operating layer for PEPECARTEL creative tools, campaigns, creators, and distribution."
        status="Phase 1A · Foundation live"
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
              {workspaceLoading ? "Loading…" : (workspace?.name ?? "No workspace")}
            </h2>
            <p className="mt-2 max-w-xl text-sm text-muted-foreground">
              {workspace
                ? "Brand Kit, Asset Vault, and Sticker Lab all read and write against this workspace."
                : "Create a workspace from the switcher in the header to start using CARTEL HQ."}
            </p>
          </div>
          {workspace ? (
            <Badge variant="outline" className="w-fit border-pepe/45 text-pepe">
              Connected
            </Badge>
          ) : (
            <Badge variant="outline" className="w-fit border-gold/40 text-gold">
              Setup required
            </Badge>
          )}
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
                  <Button asChild size="sm" variant="outline" className="mt-3 min-h-9 text-xs">
                    <Link to={action.to}>Open</Link>
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
            {packs.length === 0 ? (
              <EmptyState
                icon={PackageOpen}
                title="No packs yet"
                description="Sticker packs saved from Sticker Lab appear here for this workspace."
              />
            ) : (
              <ul className="divide-y divide-border">
                {packs.map((pack) => (
                  <li key={pack.id} className="flex items-center gap-3 py-3 text-sm">
                    <span className="min-w-0 flex-1 truncate text-foreground">{pack.title}</span>
                    <span className="shrink-0 text-xs text-muted-foreground">
                      {pack.pack_size} · {pack.theme}
                    </span>
                    <Badge variant="outline" className="shrink-0 border-border text-[10px] uppercase">
                      {pack.status}
                    </Badge>
                  </li>
                ))}
              </ul>
            )}
          </CardContent>
        </Card>

        <div className="space-y-4">
          <Card className="cartel-panel rise-in">
            <CardHeader className="flex-row items-center justify-between space-y-0">
              <CardTitle className="text-sm uppercase tracking-widest">AI usage</CardTitle>
              <Badge variant="outline" className="border-border text-[10px] uppercase">
                {usageQuery.data ? `${usageQuery.data} jobs` : "No jobs"}
              </Badge>
            </CardHeader>
            <CardContent>
              <EmptyState
                compact
                icon={Sparkles}
                title="No AI providers connected"
                description="Generation credits and usage metering arrive with the Sticker Lab generation backend."
              />
            </CardContent>
          </Card>

          <Card className="cartel-panel rise-in">
            <CardHeader className="flex-row items-center justify-between space-y-0">
              <CardTitle className="text-sm uppercase tracking-widest">Telegram status</CardTitle>
              <Badge
                variant="outline"
                className={
                  telegram
                    ? "border-pepe/45 text-pepe text-[10px] uppercase"
                    : "border-signal/45 text-signal text-[10px] uppercase"
                }
              >
                {telegram ? "Linked" : "Disconnected"}
              </Badge>
            </CardHeader>
            <CardContent>
              <EmptyState
                compact
                icon={Send}
                title={telegram ? `@${telegram.telegram_username ?? "account"}` : "No bot linked"}
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
