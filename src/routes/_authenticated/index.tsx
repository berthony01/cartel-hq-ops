import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import {
  Sticker,
  PackageOpen,
  AlertTriangle,
  ChevronRight,
} from "lucide-react";

import { supabase } from "@/integrations/supabase/client";
import { useWorkspace } from "@/lib/workspace-context";
import {
  listLaunches,
  toLaunchStatus,
  hasSchedule,
  nextLaunchStatus,
  getLaunchWatchSummary,
  formatTimestamp,
  LAUNCH_STATUS_LABELS,
  LAUNCH_STATUS_HELP,
  type LaunchStatus,
  type LaunchRow,
} from "@/lib/launch-control";
import {
  fetchDropStatus,
  sentToday,
  nextRunAt,
  formatClock,
  scheduleState,
  dropErrorMessage,
} from "@/lib/sticker-drops";
import { groupIsOperational } from "@/lib/launch-readiness";

import { PageHeader } from "@/components/cartel/PageHeader";
import { Section } from "@/components/cartel/Section";
import { InlineRow } from "@/components/cartel/InlineRow";
import { StatusBadge } from "@/components/cartel/StatusBadge";
import { EmptyState } from "@/components/cartel/EmptyState";
import { ProjectJourneyPanel, useProjectJourney } from "@/components/cartel/ProjectJourney";

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

const STATUS_TONE: Record<LaunchStatus, "gold" | "green" | "muted"> = {
  DRAFT: "muted",
  ANNOUNCED: "gold",
  WATCHLIST_OPEN: "gold",
  LAUNCH_APPROACHING: "gold",
  CONTRACT_PENDING: "gold",
  OFFICIAL_CONTRACT_REGISTERED: "green",
  LIVE: "green",
  COMPLETED: "muted",
};

/** Newest non-COMPLETED launch, otherwise newest. `listLaunches` is newest-first. */
function selectPrimary(launches: LaunchRow[]): LaunchRow | null {
  if (launches.length === 0) return null;
  return launches.find((l) => toLaunchStatus(l.status) !== "COMPLETED") ?? launches[0]!;
}

function scheduleSummary(row: LaunchRow): string {
  if (row.launch_at) return formatTimestamp(row.launch_at);
  if (row.launch_window_start && row.launch_window_end) {
    return `${formatTimestamp(row.launch_window_start)} → ${formatTimestamp(row.launch_window_end)}`;
  }
  return "Not set";
}

function Fact({ label, value }: { label: string; value: string }) {
  return (
    <div className="min-w-0">
      <dt className="type-meta text-muted-foreground">{label}</dt>
      <dd className="mt-1 text-xs leading-relaxed text-foreground [overflow-wrap:anywhere]">
        {value}
      </dd>
    </div>
  );
}

function SnapshotCard({
  title,
  badge,
  primary,
  secondary,
  to,
  linkLabel,
}: {
  title: string;
  badge: React.ReactNode;
  primary: string;
  secondary: string;
  to: string;
  linkLabel: string;
}) {
  return (
    <Section
      variant="surface"
      className="rise-in flex min-w-0 flex-col"
      title={title}
      actions={badge}
      contentClassName="flex flex-1 flex-col gap-2"
    >
      <p className="min-w-0 text-sm font-medium text-foreground [overflow-wrap:anywhere]">
        {primary}
      </p>
      <p className="min-w-0 text-xs leading-relaxed text-muted-foreground [overflow-wrap:anywhere]">
        {secondary}
      </p>
      <Link
        to={to}
        className="mt-auto inline-flex w-fit text-xs uppercase tracking-[0.14em] text-gold hover:underline"
      >
        {linkLabel}
      </Link>
    </Section>
  );
}

function HqDashboard() {
  const { workspace, workspaceId, loading: workspaceLoading } = useWorkspace();





  const packsQuery = useQuery({
    queryKey: ["recent-packs", workspaceId],
    enabled: !!workspaceId,
    queryFn: async () => {
      const { data, error, count } = await supabase
        .from("sticker_packs")
        .select("id,title,theme,pack_size,status,created_at", { count: "exact" })
        .eq("workspace_id", workspaceId!)
        .order("created_at", { ascending: false })
        .limit(5);
      if (error) throw error;
      return { rows: data ?? [], total: count ?? 0 };
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
        .select("id,title,connected_at,bot_is_admin,metadata")
        .eq("workspace_id", workspaceId!)
        .order("connected_at", { ascending: false });
      if (error) throw error;
      return data ?? [];
    },
  });

  const launchesQuery = useQuery({
    queryKey: ["hq-launches", workspaceId],
    enabled: !!workspaceId,
    queryFn: () => listLaunches(workspaceId!),
  });

  const primaryLaunch = selectPrimary(launchesQuery.data ?? []);
  const watchToken = primaryLaunch?.launch_watch_token ?? null;

  const watchQuery = useQuery({
    queryKey: ["hq-launch-watch", primaryLaunch?.id],
    enabled: !!primaryLaunch?.id && !!watchToken,
    queryFn: () => getLaunchWatchSummary(primaryLaunch!.id),
  });

  const dropsQuery = useQuery({
    queryKey: ["hq-drop-status", workspaceId],
    enabled: !!workspaceId,
    queryFn: () => fetchDropStatus(workspaceId!),
  });

  const packs = packsQuery.data?.rows ?? [];
  const recentPacks = packs.slice(0, 4);
  const packTotal = packsQuery.data?.total ?? 0;
  const latestPack = packs[0] ?? null;

  const groups = telegramQuery.data ?? [];
  const groupCount = groups.length;
  const healthyGroups = groups.filter((g) =>
    groupIsOperational({ id: g.id, bot_is_admin: g.bot_is_admin, metadata: g.metadata }),
  ).length;

  const drops = dropsQuery.data ?? null;
  const killSwitch = drops?.control?.kill_switch === true;
  const schedules = drops?.schedules ?? [];
  const events = drops?.events ?? [];
  /** Presentation-only: nothing is effectively active while the kill switch is on. */
  const activeSchedules = killSwitch ? 0 : schedules.filter((s) => s.enabled).length;

  const autoPaused = schedules.filter((s) => scheduleState(s, killSwitch) === "auto_paused").length;
  const failedEvents = events.filter((e) => e.status !== "sent").length;
  const dropsSentToday = drops ? sentToday(events) : 0;
  const nextRun = drops ? nextRunAt(schedules, killSwitch) : null;

  const status = primaryLaunch ? toLaunchStatus(primaryLaunch.status) : null;
  const next = status ? nextLaunchStatus(status) : null;
  const contractRegistered = Boolean(primaryLaunch?.official_contract_address);
  const scheduleSet = primaryLaunch ? hasSchedule(primaryLaunch) : false;

  let nextLine = "Lifecycle complete";
  if (next === "LAUNCH_APPROACHING" && !scheduleSet) {
    nextLine = "Next: Set launch schedule";
  } else if (next === "OFFICIAL_CONTRACT_REGISTERED" && !contractRegistered) {
    nextLine = "Next: Register official contract";
  } else if (next) {
    nextLine = `Next: Advance to ${LAUNCH_STATUS_LABELS[next]}`;
  }

  const attention: { id: string; text: string; to: string; action: string }[] = [];
  if (killSwitch) {
    attention.push({
      id: "kill",
      text: "Sticker Drops emergency pause is ON. No drops are being sent.",
      to: "/distribution",
      action: "Open Sticker Drops",
    });
  }
  if (autoPaused > 0) {
    attention.push({
      id: "auto-paused",
      text: `${autoPaused} drop schedule${autoPaused === 1 ? " was" : "s were"} auto-paused after repeated failures.`,
      to: "/distribution",
      action: "Review schedules",
    });
  }
  if (failedEvents > 0) {
    attention.push({
      id: "failed",
      text: `${failedEvents} recent drop event${failedEvents === 1 ? "" : "s"} did not send successfully.`,
      to: "/distribution",
      action: "Review activity",
    });
  }
  if (primaryLaunch && next === "LAUNCH_APPROACHING" && !scheduleSet) {
    attention.push({
      id: "schedule",
      text: "The launch cannot advance to Launch Approaching until a schedule is set.",
      to: "/launch-control",
      action: "Set schedule",
    });
  }
  if (primaryLaunch && status === "CONTRACT_PENDING" && !contractRegistered) {
    attention.push({
      id: "contract",
      text: "The launch is at Contract Pending and no official contract address is registered.",
      to: "/launch-control",
      action: "Register contract",
    });
  }

  const communitiesPrimary =
    telegramQuery.isPending
      ? "Loading…"
      : telegramQuery.isError
        ? "Unavailable"
        : groupCount === 0
          ? "No community connected"
          : `${groupCount} connected · ${healthyGroups} healthy`;

  const packsUnavailable = packsQuery.isError;
  const launchesUnavailable = launchesQuery.isError;
  const aiJobsClause = usageQuery.isError
    ? "AI usage unavailable"
    : `${usageQuery.isPending ? "—" : (usageQuery.data ?? 0)} AI jobs run`;


  const dropsBadge = dropsQuery.isError ? (
    <StatusBadge tone="muted">Unavailable</StatusBadge>
  ) : killSwitch ? (
    <StatusBadge tone="red">Emergency pause</StatusBadge>
  ) : activeSchedules > 0 ? (
    <StatusBadge tone="green">{activeSchedules} active</StatusBadge>
  ) : (
    <StatusBadge tone="muted">Not scheduled</StatusBadge>
  );

  const dropsSecondary = dropsQuery.isError
    ? dropErrorMessage(dropsQuery.error)
    : killSwitch
      ? "Emergency pause is on. Nothing will send until it is cleared."
      : nextRun
        ? `Next drop ${nextRun.isDue ? "due now" : formatClock(nextRun.at)}${failedEvents > 0 ? ` · ${failedEvents} recent failure${failedEvents === 1 ? "" : "s"}` : ""}`
        : activeSchedules > 0
          ? "Active schedules have no upcoming run time yet."
          : "No active drop schedule for this project.";

  return (
    <div className="space-y-5 sm:space-y-8">
      <PageHeader
        eyebrow="Command Center"
        title="CARTEL HQ"
        description="The operating layer for PEPECARTEL creative tools, campaigns, creators, and distribution."
        status="Private Beta"
      />

      <ProjectJourneyPanel workspaceId={workspaceId} workspaceName={workspace?.name ?? null} />


      {!workspaceId ? (
        <Section
          variant="surface"
          className="rise-in"
          title={workspaceLoading ? "Loading…" : "No project"}
          description={
            workspaceLoading
              ? "Reading your project context."
              : "Add a project from the switcher in the header to start using CARTEL HQ."
          }
          actions={<StatusBadge tone="gold">Setup required</StatusBadge>}
          headerClassName="mb-0"
        />
      ) : (
        <>
          {/* One operational hero */}
          <Section variant="hero" className="min-w-0">
            {launchesQuery.isPending ? (
              <p className="text-sm text-muted-foreground">Loading launch state…</p>
            ) : launchesUnavailable ? (
              <div className="min-w-0 space-y-3">
                <p className="type-meta text-muted-foreground">Launch status</p>
                <h2 className="font-display text-2xl uppercase leading-tight text-muted-foreground sm:text-3xl">
                  Launch state unavailable
                </h2>
                <p className="max-w-xl text-xs leading-relaxed text-muted-foreground">
                  Launch data could not be loaded right now. This does not change your launch —
                  open Launch Control to view the authoritative state.
                </p>
                <Link
                  to="/launch-control"
                  className="touch-target inline-flex w-fit items-center gap-1.5 rounded-md border border-gold/50 bg-gold/10 px-3 py-2 text-xs font-semibold uppercase tracking-[0.14em] text-gold transition-colors hover:bg-gold/20"
                >
                  Open Launch Control <ChevronRight className="size-4" aria-hidden="true" />
                </Link>
              </div>
            ) : !primaryLaunch ? (
              <div className="min-w-0 space-y-3">
                <p className="type-meta text-gold">Launch status</p>
                <h2 className="font-display text-2xl uppercase leading-tight text-foreground sm:text-3xl">
                  No launch created yet
                </h2>
                <p className="max-w-xl text-xs leading-relaxed text-muted-foreground">
                  Launch Control is where you create the launch, open Launch Watch, register the
                  official contract and drive the lifecycle.
                </p>
                <Link
                  to="/launch-control"
                  className="touch-target inline-flex w-fit items-center gap-1.5 rounded-md border border-gold/50 bg-gold/10 px-3 py-2 text-xs font-semibold uppercase tracking-[0.14em] text-gold transition-colors hover:bg-gold/20"
                >
                  Create launch <ChevronRight className="size-4" aria-hidden="true" />
                </Link>
              </div>
            ) : (

              <div className="grid min-w-0 gap-4 lg:grid-cols-[minmax(0,1.35fr)_minmax(0,1fr)]">
                <div className="min-w-0 space-y-3">
                  <div className="grid grid-cols-[minmax(0,1fr)_auto] items-start gap-3">
                    <div className="min-w-0">
                      <p className="type-meta text-gold">
                        {status === "COMPLETED" ? "Latest launch" : "Active launch"}
                      </p>
                      <h2 className="mt-1 min-w-0 font-display text-2xl uppercase leading-tight text-foreground [overflow-wrap:anywhere] sm:text-3xl">
                        {primaryLaunch.token_name}
                      </h2>
                      <p className="mt-1 text-xs text-muted-foreground [overflow-wrap:anywhere]">
                        {primaryLaunch.ticker} · {primaryLaunch.chain}
                      </p>
                    </div>
                    <StatusBadge tone={STATUS_TONE[status!]}>
                      <span>{LAUNCH_STATUS_LABELS[status!]}</span>
                    </StatusBadge>
                  </div>
                  <p className="max-w-xl text-xs leading-relaxed text-muted-foreground">
                    {LAUNCH_STATUS_HELP[status!]}
                  </p>
                  <dl className="grid gap-3 sm:grid-cols-3">
                    <Fact label="Schedule" value={scheduleSummary(primaryLaunch)} />
                    <Fact
                      label="Launch Watch"
                      value={
                        !watchToken
                          ? "Not opened yet"
                          : watchQuery.isPending
                            ? "Loading…"
                            : watchQuery.isError
                              ? "Unavailable"
                              : `${watchQuery.data?.active_count ?? 0} active watchers`
                      }
                    />
                    <Fact
                      label="Official contract"
                      value={
                        contractRegistered
                          ? "Registered"
                          : status === "CONTRACT_PENDING"
                            ? "Pending registration"
                            : "Not yet available"
                      }
                    />
                  </dl>
                </div>

                <div className="min-w-0 space-y-3">
                  <dl className="grid gap-3 sm:grid-cols-2 lg:grid-cols-1">
                    <Fact
                      label="Communities"
                      value={
                        telegramQuery.isPending
                          ? "Loading…"
                          : telegramQuery.isError
                            ? "Unavailable"
                            : groupCount === 0
                              ? "None connected"
                              : `${groupCount} connected · ${healthyGroups} healthy`
                      }
                    />
                    <Fact
                      label="Sticker Drops"
                      value={
                        dropsQuery.isPending
                          ? "Loading…"
                          : dropsQuery.isError
                            ? "Unavailable"
                            : killSwitch
                              ? "Emergency pause on"
                              : `${activeSchedules} active · ${dropsSentToday} sent today`
                      }
                    />
                  </dl>
                  <p className="min-w-0 rounded-md border border-gold/30 bg-gold/5 px-3 py-2 text-xs font-semibold uppercase tracking-[0.12em] text-gold [overflow-wrap:anywhere]">
                    {nextLine}
                  </p>
                  <Link
                    to="/launch-control"
                    className="touch-target inline-flex w-fit items-center gap-1.5 rounded-md border border-gold/50 bg-gold/10 px-3 py-2 text-xs font-semibold uppercase tracking-[0.14em] text-gold transition-colors hover:bg-gold/20"
                  >
                    Open Launch Control <ChevronRight className="size-4" aria-hidden="true" />
                  </Link>
                </div>
              </div>
            )}
          </Section>

          {/* Attention required — only when real issues exist */}
          {attention.length > 0 ? (
            <Section
              variant="surface"
              className="rise-in border-signal/40"
              title="Attention required"
              actions={<StatusBadge tone="red">{attention.length}</StatusBadge>}
              contentClassName="space-y-2"
            >
              {attention.map((item) => (
                <InlineRow
                  key={item.id}
                  leading={<AlertTriangle className="size-4" aria-hidden="true" />}
                  title={item.text}
                  trailing={
                    <Link
                      to={item.to}
                      className="whitespace-nowrap text-xs uppercase tracking-[0.14em] text-gold hover:underline"
                    >
                      {item.action}
                    </Link>
                  }
                />
              ))}
            </Section>
          ) : null}

          {/* Operational snapshot */}
          <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4 [&>*]:min-w-0">
            <SnapshotCard
              title="Launch"
              badge={
                launchesUnavailable ? (
                  <StatusBadge tone="muted">Unavailable</StatusBadge>
                ) : status ? (
                  <StatusBadge tone={STATUS_TONE[status]}>
                    <span>{LAUNCH_STATUS_LABELS[status]}</span>
                  </StatusBadge>
                ) : (
                  <StatusBadge tone="muted">No launch</StatusBadge>
                )
              }
              primary={
                launchesUnavailable
                  ? "Unavailable"
                  : primaryLaunch
                    ? primaryLaunch.token_name
                    : "No launch created"
              }
              secondary={
                launchesUnavailable
                  ? "Launch state could not be loaded. Open Launch Control for the authoritative state."
                  : primaryLaunch
                    ? nextLine
                    : "Create a launch to start the lifecycle."
              }
              to="/launch-control"
              linkLabel="Launch Control"
            />
            <SnapshotCard
              title="Communities"
              badge={
                telegramQuery.isError ? (
                  <StatusBadge tone="muted">Unavailable</StatusBadge>
                ) : groupCount > 0 ? (
                  <StatusBadge tone={healthyGroups === groupCount ? "green" : "gold"}>
                    {healthyGroups}/{groupCount} healthy
                  </StatusBadge>
                ) : (
                  <StatusBadge tone="gold">None</StatusBadge>
                )
              }
              primary={communitiesPrimary}
              secondary={
                telegramQuery.isError
                  ? "Community state could not be loaded right now."
                  : groupCount > 0
                    ? "Welcome, onboarding and publishing run against these communities."
                    : "Connect a Telegram community to publish packs and welcome new members."
              }
              to="/telegram"
              linkLabel={
                telegramQuery.isError || groupCount > 0 ? "Community Command" : "Connect a community"
              }
            />
            <SnapshotCard
              title="Sticker Lab"
              badge={
                packsUnavailable ? (
                  <StatusBadge tone="muted">Unavailable</StatusBadge>
                ) : (
                  <StatusBadge tone={packTotal > 0 ? "green" : "muted"}>
                    {packsQuery.isPending ? "—" : `${packTotal} packs`}
                  </StatusBadge>
                )
              }
              primary={
                packsUnavailable
                  ? "Unavailable"
                  : packsQuery.isPending
                    ? "Loading…"
                    : latestPack
                      ? `Latest: ${latestPack.title}`
                      : "No packs yet"
              }
              secondary={
                packsUnavailable
                  ? "Sticker pack state could not be loaded right now."
                  : latestPack
                    ? `${latestPack.status} · ${aiJobsClause}`
                    : "Create your first sticker pack in Sticker Lab."
              }
              to="/sticker-lab"
              linkLabel="Open Lab"
            />

            <SnapshotCard
              title="Sticker Drops"
              badge={dropsBadge}
              primary={
                dropsQuery.isPending
                  ? "Loading…"
                  : dropsQuery.isError
                    ? "Unavailable"
                    : `${activeSchedules} active · ${dropsSentToday} sent today`
              }
              secondary={dropsSecondary}
              to="/distribution"
              linkLabel="Sticker Drops"
            />
          </div>

          {/* Recent content */}
          <Section
            variant="surface"
            className="rise-in"
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
            {packsQuery.isPending ? (
              <p className="text-xs text-muted-foreground">Loading packs…</p>
            ) : packsUnavailable ? (
              <p className="text-xs text-muted-foreground">
                Recent packs are unavailable right now.
              </p>
            ) : recentPacks.length === 0 ? (

              <EmptyState
                icon={PackageOpen}
                title="No packs yet"
                description="Sticker packs saved from Sticker Lab appear here for this project."
              />
            ) : (
              recentPacks.map((pack) => (
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
        </>
      )}
    </div>
  );
}
