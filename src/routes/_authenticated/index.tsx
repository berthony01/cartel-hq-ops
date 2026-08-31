import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import {
  Sticker,
  Palette,
  FolderLock,
  MessageSquare,
  PackageOpen,
  Sparkles,
  ChevronRight,
  type LucideIcon,
} from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useWorkspace } from "@/lib/workspace-context";

import { PageHeader } from "@/components/cartel/PageHeader";
import { Section } from "@/components/cartel/Section";
import { InlineRow } from "@/components/cartel/InlineRow";
import { StatusBadge } from "@/components/cartel/StatusBadge";
import { EmptyState } from "@/components/cartel/EmptyState";
import { LaunchReadinessPanel } from "@/components/cartel/LaunchReadiness";


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

const QUICK_ACTIONS: { label: string; icon: LucideIcon; note: string; to: string }[] = [
  { label: "Sticker Lab", icon: Sticker, note: "Create a pack", to: "/sticker-lab" },
  { label: "Brand Kit", icon: Palette, note: "Colours & marks", to: "/brand-kit" },
  { label: "Assets", icon: FolderLock, note: "Private vault", to: "/assets" },
  { label: "Telegram", icon: MessageSquare, note: "Communities & publishing", to: "/telegram" },
];


function Metric({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-lg border border-border/60 bg-surface-raised/40 px-3 py-2.5">
      <p className="truncate text-[10px] uppercase tracking-[0.18em] text-muted-foreground">
        {label}
      </p>
      <p className="mt-1 truncate font-display text-lg uppercase text-gold sm:text-xl">{value}</p>
    </div>
  );
}

function HqDashboard() {
  const { workspace, workspaceId, loading: workspaceLoading } = useWorkspace();

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
    queryKey: ["telegram-group-connections", workspaceId],
    enabled: !!workspaceId,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("telegram_group_connections")
        .select("id,title,connected_at")
        .eq("workspace_id", workspaceId!)
        .order("connected_at", { ascending: false });
      if (error) throw error;
      return data ?? [];
    },
  });

  const packs = packsQuery.data ?? [];
  const groups = telegramQuery.data ?? [];
  const groupCount = groups.length;
  const newestGroupTitle = groups[0]?.title ?? null;
  const publishedRecent = packs.filter((pack) =>
    String(pack.status ?? "").toLowerCase().includes("publish"),
  ).length;

  return (
    <div className="space-y-5 sm:space-y-8">
      <PageHeader
        eyebrow="Command Center"
        title="CARTEL HQ"
        description="The operating layer for PEPECARTEL creative tools, campaigns, creators, and distribution."
        status="Private Beta"
      />

      <LaunchReadinessPanel workspaceId={workspaceId} workspaceName={workspace?.name ?? null} />



      {/* Compact workspace summary */}
      <Section
        variant="surface"
        className="rise-in"
        title={workspaceLoading ? "Loading…" : (workspace?.name ?? "No workspace")}
        description={
          workspace
            ? "Brand Kit, Asset Vault, and Sticker Lab all read and write against this workspace."
            : "Create a workspace from the switcher in the header to start using CARTEL HQ."
        }
        actions={
          workspace ? (
            <StatusBadge tone="green">Connected</StatusBadge>
          ) : (
            <StatusBadge tone="gold">Setup required</StatusBadge>
          )
        }
        headerClassName="mb-0"
      />

      {/* Live metrics */}
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4 [&>*]:min-w-0">
        <Metric label="Recent packs" value={packsQuery.isPending ? "—" : String(packs.length)} />
        <Metric
          label="Published (recent)"
          value={packsQuery.isPending ? "—" : String(publishedRecent)}
        />
        <Metric label="AI jobs" value={usageQuery.isPending ? "—" : String(usageQuery.data ?? 0)} />
        <Metric
          label="Telegram"
          value={telegramQuery.isPending ? "—" : String(groupCount)}
        />
      </div>

      {/* Quick actions — 2 columns on mobile */}
      <section aria-labelledby="quick-actions-heading" className="space-y-3">
        <h2
          id="quick-actions-heading"
          className="font-display text-base uppercase tracking-widest text-foreground sm:text-lg"
        >
          Quick actions
        </h2>
        <div className="grid grid-cols-2 gap-3 lg:grid-cols-4 [&>*]:min-w-0">
          {QUICK_ACTIONS.map((action) => (
            <Link
              key={action.label}
              to={action.to}
              className="touch-target hover-lift flex flex-col gap-2 rounded-lg border border-border/70 bg-surface-raised/50 p-3 transition-colors hover:border-gold/40 hover:bg-gold/5 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-gold/50"
            >
              <span className="flex size-9 items-center justify-center rounded-md border border-border bg-surface-raised text-gold">
                <action.icon className="size-4.5" aria-hidden="true" />
              </span>
              <span className="min-w-0">
                <span className="block truncate text-sm font-semibold text-foreground">
                  {action.label}
                </span>
                <span className="block truncate text-xs text-muted-foreground">{action.note}</span>
              </span>
            </Link>
          ))}
        </div>
      </section>

      <div className="grid gap-4 lg:grid-cols-3 [&>*]:min-w-0">
        {/* Recent packs as compact rows */}
        <Section
          variant="surface"
          className="rise-in self-start lg:col-span-2"
          title="Recent packs"
          actions={
            <Link
              to="/sticker-lab"
              className="text-xs uppercase tracking-[0.14em] text-gold hover:underline"
            >
              Open Lab
            </Link>
          }
          contentClassName="space-y-2"
        >
          {packs.length === 0 ? (
            <EmptyState
              icon={PackageOpen}
              title="No packs yet"
              description="Sticker packs saved from Sticker Lab appear here for this workspace."
            />
          ) : (
            packs.map((pack) => (
              <InlineRow
                key={pack.id}
                leading={<Sticker className="size-4" aria-hidden="true" />}
                title={pack.title}
                subtitle={`${pack.pack_size} stickers · ${pack.theme}`}
                trailing={
                  <span className="flex items-center gap-2">
                    <StatusBadge
                      tone={
                        String(pack.status ?? "").toLowerCase().includes("publish")
                          ? "green"
                          : "muted"
                      }
                    >
                      {pack.status}
                    </StatusBadge>
                    <ChevronRight className="size-4 text-muted-foreground" aria-hidden="true" />
                  </span>
                }
              />
            ))
          )}
        </Section>

        <div className="space-y-4">
          <Section
            variant="surface"
            className="rise-in"
            title="AI usage"
            actions={
              <StatusBadge tone="muted">
                {usageQuery.data ? `${usageQuery.data} jobs` : "No jobs"}
              </StatusBadge>
            }
          >
            <EmptyState
              compact
              icon={Sparkles}
              title="Generation activity"
              description="Sticker Lab generation jobs for this workspace are counted here."
            />
          </Section>

          <Section
            variant="surface"
            className="rise-in"
            title="Telegram"
            actions={
              groupCount > 0 ? (
                <StatusBadge tone="green">
                  {groupCount} connected
                </StatusBadge>
              ) : (
                <StatusBadge tone="gold">No community connected</StatusBadge>
              )
            }
            contentClassName="space-y-2"
          >
            <InlineRow
              leading={<MessageSquare className="size-4" aria-hidden="true" />}
              title={
                groupCount > 0
                  ? `${groupCount} communit${groupCount === 1 ? "y" : "ies"} connected`
                  : "No community connected"
              }
              subtitle={
                groupCount > 0
                  ? newestGroupTitle
                    ? `Newest: ${newestGroupTitle}. Publish sticker packs and send them to your communities.`
                    : "Publish sticker packs and send them to your communities."
                  : "Connect a Telegram community to publish packs from Sticker Lab."
              }
            />
            <Link
              to="/telegram"
              className="inline-flex text-xs uppercase tracking-[0.14em] text-gold hover:underline"
            >
              {groupCount > 0 ? "Manage communities" : "Connect a community"}
            </Link>
          </Section>
        </div>
      </div>

    </div>
  );
}
