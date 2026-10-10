import { useState } from "react";
import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import {
  Activity,
  AlertTriangle,
  ArrowRight,
  CircleDot,
  Clock3,
  Loader2,
  PackageOpen,
  Radio,
  RefreshCw,
  Send,
  ShieldAlert,
  Sparkles,
  Sticker,
  Users,
  CreditCard,
} from "lucide-react";

import { supabase } from "@/integrations/supabase/client";
import { useWorkspace } from "@/lib/workspace-context";
import {
  formatTimestamp,
  getLaunchWatchSummary,
  hasSchedule,
  LAUNCH_STATUS_HELP,
  LAUNCH_STATUS_LABELS,
  listLaunches,
  listPendingScheduleCommunications,
  nextLaunchStatus,
  selectPrimaryProjectLaunch,
  toLaunchStatus,
  type LaunchRow,
  type LaunchStatus,
} from "@/lib/launch-control";
import { getProjectProfile } from "@/lib/project-profile";
import {
  dropErrorMessage,
  fetchDropStatus,
  formatClock,
  nextRunAt,
  scheduleState,
  sentToday,
} from "@/lib/sticker-drops";
import { groupIsOperational } from "@/lib/launch-readiness";

import { DashboardJourney as ProjectJourneyPanel } from "@/components/cartel/DashboardJourney";
import {
  JourneyLink,
  ProjectJourneyProgress,
  journeyStageGuidance,
  useProjectJourney,
} from "@/components/cartel/ProjectJourney";
import { EmptyState } from "@/components/cartel/EmptyState";
import { InlineRow } from "@/components/cartel/InlineRow";
import { PageHeader } from "@/components/cartel/PageHeader";
import { Section } from "@/components/cartel/Section";
import { StatusBadge } from "@/components/cartel/StatusBadge";
import { CreateWorkspaceDialog } from "@/components/cartel/WorkspaceSwitcher";
import { Button, buttonVariants } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { useWorkspaceGoal } from "@/lib/workspace-goal";

export const Route = createFileRoute("/_authenticated/dashboard")({
  head: () => ({
    meta: [
      { title: "Dashboard — CARTEL HQ" },
      {
        name: "description",
        content: "CARTEL HQ brings project launch readiness, community operations, and creative deployment into one private command center.",
      },
      { property: "og:title", content: "Dashboard — CARTEL HQ" },
      {
        property: "og:description",
        content: "The private project command center for launch readiness, community operations, and creative deployment.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
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

function selectPrimary(launches: LaunchRow[]): LaunchRow | null {
  return selectPrimaryProjectLaunch(launches);
}

function scheduleSummary(row: LaunchRow): string {
  if (row.launch_at) return formatTimestamp(row.launch_at);
  if (row.launch_window_start && row.launch_window_end) {
    return `${formatTimestamp(row.launch_window_start)} → ${formatTimestamp(row.launch_window_end)}`;
  }
  return "Not set";
}

function MetricSurface({
  icon: Icon,
  label,
  value,
  detail,
  status,
  tone = "muted",
  to,
}: {
  icon: typeof Activity;
  label: string;
  value: string;
  detail: string;
  status: string;
  tone?: "gold" | "green" | "red" | "muted";
  to: "/launch-control" | "/telegram" | "/distribution";
}) {
  return (
    <Link
      to={to}
      className="group grid min-h-36 min-w-0 grid-cols-[auto_minmax(0,1fr)] gap-x-3 gap-y-3 border border-border-subtle bg-surface px-4 py-4 shadow-[var(--shadow-cartel-soft)] transition-[border-color,transform] hover:-translate-y-0.5 hover:border-gold/35 sm:px-5"
    >
      <span className="flex size-9 shrink-0 items-center justify-center rounded-md border border-gold/20 bg-gold/5 text-gold">
        <Icon className="size-4" aria-hidden="true" />
      </span>
      <span className="min-w-0">
        <span className="type-meta block text-muted-foreground">{label}</span>
        <span className="mt-2 block text-xl font-semibold text-foreground [overflow-wrap:anywhere]">{value}</span>
        <span className="mt-1 block text-xs leading-relaxed text-muted-foreground [overflow-wrap:anywhere]">{detail}</span>
      </span>
      <span className="col-span-2 flex min-w-0 items-center justify-between gap-3 border-t border-border-subtle pt-3">
        <StatusBadge tone={tone}>{status}</StatusBadge>
        <ArrowRight className="size-4 text-muted-foreground transition-transform group-hover:translate-x-0.5 group-hover:text-gold" aria-hidden="true" />
      </span>
    </Link>
  );
}

function Fact({ label, value }: { label: string; value: string }) {
  return (
    <div className="min-w-0">
      <dt className="type-meta text-muted-foreground">{label}</dt>
      <dd className="mt-1 text-xs leading-relaxed text-foreground [overflow-wrap:anywhere]">{value}</dd>
    </div>
  );
}

function HqDashboard() {
  const { workspace, workspaceId, loading: workspaceLoading } = useWorkspace();
  const [createOpen, setCreateOpen] = useState(false);
  const journeyQuery = useProjectJourney(workspaceId);
  const goalQuery = useWorkspaceGoal(workspaceId);

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

  const profileQuery = useQuery({
    queryKey: ["project-profile", workspaceId],
    enabled: !!workspaceId,
    queryFn: () => getProjectProfile(workspaceId!),
  });
  const profileId = profileQuery.data?.id ?? null;

  const launchesQuery = useQuery({
    queryKey: ["hq-launches", workspaceId, profileId],
    enabled: !!workspaceId && !!profileId,
    queryFn: () => listLaunches(workspaceId!, profileId!),
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

  const scheduleCommsQuery = useQuery({
    queryKey: ["hq-schedule-comms", workspaceId],
    enabled: !!workspaceId,
    queryFn: () => listPendingScheduleCommunications(workspaceId!),
  });
  const pendingComms = scheduleCommsQuery.data ?? [];

  const packs = packsQuery.data?.rows ?? [];
  const recentPacks = packs.slice(0, 4);
  const packTotal = packsQuery.data?.total ?? 0;
  const groups = telegramQuery.data ?? [];
  const groupCount = groups.length;
  const healthyGroups = groups.filter((group) =>
    groupIsOperational({ id: group.id, bot_is_admin: group.bot_is_admin, metadata: group.metadata }),
  ).length;

  const drops = dropsQuery.data ?? null;
  const killSwitch = drops?.control?.kill_switch === true;
  const schedules = drops?.schedules ?? [];
  const events = drops?.events ?? [];
  const activeSchedules = killSwitch ? 0 : schedules.filter((schedule) => schedule.enabled).length;
  const autoPaused = schedules.filter((schedule) => scheduleState(schedule, killSwitch) === "auto_paused").length;
  const failedEvents = events.filter((event) => event.status !== "sent").length;
  const dropsSentToday = drops ? sentToday(events) : 0;
  const nextRun = drops ? nextRunAt(schedules, killSwitch) : null;

  const status = primaryLaunch ? toLaunchStatus(primaryLaunch.status) : null;
  const nextStatus = status ? nextLaunchStatus(status) : null;
  const contractRegistered = Boolean(primaryLaunch?.official_contract_address);
  const scheduleSet = primaryLaunch ? hasSchedule(primaryLaunch) : false;
  const journey = journeyQuery.data ?? null;
  // Display-only: community goal with no real launch uses community wording; any
  // real primary launch, unset goal, or unavailable goal keeps legacy launch copy.
  const communityOnly = goalQuery.data === "community" && !!journey && !journey.primaryLaunchId;
  const nextStage = journey?.nextAction.stage ?? null;
  const blockedStage = journey?.stages.find((stage) => stage.status !== "complete") ?? null;
  const dominantStage = nextStage ?? blockedStage;
  const journeyBlocked = !!journey && !journey.allComplete && nextStage === null && blockedStage !== null;

  type AttentionSeverity = "critical" | "warning";
  const attention: { id: string; text: string; to: "/distribution" | "/launch-control"; action: string; severity: AttentionSeverity }[] = [];
  if (killSwitch) attention.push({ id: "kill", text: "Sticker Drops emergency pause is ON. No drops are being sent.", to: "/distribution", action: "Open Sticker Drops", severity: "critical" });
  if (pendingComms.length > 0) attention.push({ id: "schedule-comms", text: `${pendingComms.length} launch schedule change${pendingComms.length === 1 ? " has" : "s have"} not been communicated to watchers yet.`, to: "/launch-control", action: "Review & notify", severity: "critical" });
  if (autoPaused > 0) attention.push({ id: "auto-paused", text: `${autoPaused} drop schedule${autoPaused === 1 ? " was" : "s were"} auto-paused after repeated failures.`, to: "/distribution", action: "Review schedules", severity: "warning" });
  if (failedEvents > 0) attention.push({ id: "failed", text: `${failedEvents} recent drop event${failedEvents === 1 ? "" : "s"} did not send successfully.`, to: "/distribution", action: "Review activity", severity: "warning" });
  if (primaryLaunch && nextStatus === "LAUNCH_APPROACHING" && !scheduleSet) attention.push({ id: "schedule", text: "The launch cannot advance to Launch Approaching until a schedule is set.", to: "/launch-control", action: "Set schedule", severity: "warning" });
  if (primaryLaunch && status === "CONTRACT_PENDING" && !contractRegistered) attention.push({ id: "contract", text: "The launch is at Contract Pending and no official contract address is registered.", to: "/launch-control", action: "Register contract", severity: "warning" });
  const criticalAttention = attention.filter((item) => item.severity === "critical");
  const criticalCount = criticalAttention.length;
  const sortedAttention = [...attention].sort((a, b) => (a.severity === b.severity ? 0 : a.severity === "critical" ? -1 : 1));

  // Guided-setup entry point: nudge workspaces that haven't finished project
  // identity toward the 4-step onboarding flow. Dismissal is sticky.
  const identityStage = journey?.stages.find((stage) => stage.key === "project_profile");
  const [onboardingDismissed, setOnboardingDismissed] = useState(() => {
    try {
      return window.localStorage.getItem("hq-onboarding-banner-dismissed") === "1";
    } catch {
      return false;
    }
  });
  const showOnboardingBanner =
    !!workspaceId && !!journey && identityStage?.status !== "complete" && !onboardingDismissed;
  const dismissOnboardingBanner = () => {
    try {
      window.localStorage.setItem("hq-onboarding-banner-dismissed", "1");
    } catch {
      /* storage unavailable — dismissal just won't persist */
    }
    setOnboardingDismissed(true);
  };

  const launchLoading = profileQuery.isPending || (!!profileId && launchesQuery.isPending);
  const launchUnavailable = profileQuery.isError || launchesQuery.isError;
  const watchPending = launchLoading || (!!watchToken && watchQuery.isPending);
  const watchUnavailable = launchUnavailable || (!!watchToken && watchQuery.isError);
  const watchValue = watchPending
    ? "Loading…"
    : watchUnavailable
      ? "Unavailable"
      : !watchToken
        ? "Not open"
        : `${watchQuery.data?.active_count ?? 0}`;
  const watchDetail = watchPending
    ? "Reading the active launch and Launch Watch state."
    : watchUnavailable
      ? "Launch Watch state could not be loaded."
      : !watchToken
        ? "Open Launch Watch from the project journey when available."
        : "Active watchers receiving private launch updates.";
  const watchStatus = watchPending ? "Loading" : watchUnavailable ? "Unavailable" : !watchToken ? "Closed" : "Active";
  const communityValue = telegramQuery.isPending ? "Loading…" : telegramQuery.isError ? "Unavailable" : `${healthyGroups}/${groupCount}`;
  const communityDetail = telegramQuery.isPending
    ? "Reading connected community state."
    : telegramQuery.isError
      ? "Community state could not be loaded."
      : groupCount === 0
        ? "No Telegram community connected."
        : `${healthyGroups} operational of ${groupCount} connected.`;
  const communityStatus = telegramQuery.isPending ? "Loading" : telegramQuery.isError ? "Unavailable" : groupCount === 0 ? "Not connected" : healthyGroups === groupCount ? "Operational" : "Review";
  const dropValue = dropsQuery.isPending ? "Loading…" : dropsQuery.isError ? "Unavailable" : killSwitch ? "Paused" : `${activeSchedules}`;
  const dropDetail = dropsQuery.isPending
    ? "Reading Sticker Drops operations."
    : dropsQuery.isError
      ? dropErrorMessage(dropsQuery.error)
      : killSwitch
        ? "Emergency pause is on. Nothing will send."
        : nextRun
          ? `Next ${nextRun.isDue ? "due now" : formatClock(nextRun.at)} · ${dropsSentToday} sent today`
          : `${dropsSentToday} sent today · no upcoming run`;
  const dropStatus = dropsQuery.isPending ? "Loading" : dropsQuery.isError ? "Unavailable" : killSwitch ? "Emergency pause" : activeSchedules > 0 ? "Running" : "Not scheduled";

  return (
    <div className="space-y-7 sm:space-y-9">
      <CreateWorkspaceDialog open={createOpen} onOpenChange={setCreateOpen} />
      <PageHeader
        eyebrow="Command Center"
        title={workspace?.name ? `${workspace.name} HQ` : "Cartel HQ"}
        description={workspace?.name ? "Launch readiness, community operations and creative deployment in one private operating view." : "Select or add a project to begin operating from CARTEL HQ."}
        status="Private Beta"
      />

      {showOnboardingBanner ? (
        <div className="rise-in flex flex-col gap-3 border border-gold/40 bg-gold/5 px-5 py-4 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex min-w-0 items-start gap-3">
            <Sparkles className="mt-0.5 size-5 shrink-0 text-gold" aria-hidden="true" />
            <div className="min-w-0">
              <p className="text-sm font-semibold text-foreground">New here? Take the guided setup.</p>
              <p className="mt-0.5 text-xs leading-relaxed text-muted-foreground">Four steps, about ten minutes — identity, community, launch, review.</p>
            </div>
          </div>
          <div className="flex shrink-0 items-center gap-2">
            <Button variant="ghost" size="sm" className="min-h-11" onClick={dismissOnboardingBanner}>
              Dismiss
            </Button>
            <Button asChild size="sm" className="min-h-11">
              <Link to="/onboarding">
                Start guided setup
                <ArrowRight className="size-4" aria-hidden="true" />
              </Link>
            </Button>
          </div>
        </div>
      ) : null}

      {!workspaceId ? (
        <Section
          variant="surface"
          className="rise-in"
          title={workspaceLoading ? "Loading…" : "No project"}
          description={workspaceLoading ? "Reading your project context." : "Create your free project to start using CARTEL HQ. Free includes 1 project and 1 Telegram community — no credit card required. Upgrading to Pro becomes available once your project is created and Project Identity is completed."}
          actions={workspaceLoading ? <StatusBadge tone="gold">Setup required</StatusBadge> : <Button className="min-h-11" onClick={() => setCreateOpen(true)}>Create free project</Button>}
          headerClassName="mb-0"
        />
      ) : (
        <>
          <div className="flex justify-end">
            <Button asChild variant="outline" className="min-h-11">
              <Link to="/settings" hash="billing">
                <CreditCard className="size-4" aria-hidden="true" />
                Plan &amp; Billing
              </Link>
            </Button>
          </div>
          {criticalCount > 0 ? (
            <div className="space-y-3" role="alert" aria-label="Critical items needing immediate action">
              {criticalAttention.map((item) => (
                <div key={item.id} className="rise-in flex flex-col gap-3 border border-signal/50 bg-signal/10 px-5 py-4 sm:flex-row sm:items-center sm:justify-between">
                  <div className="flex min-w-0 items-start gap-3">
                    <ShieldAlert className="mt-0.5 size-5 shrink-0 text-signal" aria-hidden="true" />
                    <p className="text-sm font-semibold leading-relaxed text-foreground [overflow-wrap:anywhere]">{item.text}</p>
                  </div>
                  <Button asChild className="min-h-11 shrink-0">
                    <Link to={item.to}>{item.action}<ArrowRight className="size-4" aria-hidden="true" /></Link>
                  </Button>
                </div>
              ))}
            </div>
          ) : null}
          <section className="rise-in overflow-hidden border border-gold/40 bg-surface shadow-[var(--shadow-cartel),var(--glow-gold)]" aria-labelledby="active-launch-heading">
            {launchLoading ? (
              <div className="flex min-h-64 items-center gap-2 px-5 py-8 text-sm text-muted-foreground sm:px-7">
                <Loader2 className="size-4 animate-spin" aria-hidden="true" />
                Loading command state…
              </div>
            ) : launchUnavailable ? (
              <div className="grid min-h-64 gap-4 px-5 py-7 sm:px-7 lg:grid-cols-[minmax(0,1fr)_auto] lg:items-center">
                <div className="min-w-0">
                  <p className="type-eyebrow text-muted-foreground">Launch status</p>
                  <h2 id="active-launch-heading" className="mt-2 font-display text-3xl uppercase text-foreground">Launch state unavailable</h2>
                  <p className="mt-2 max-w-xl text-sm leading-relaxed text-muted-foreground">This does not change your launch. Review the authoritative state in Launch Control.</p>
                </div>
                <Button asChild variant="outline" className="min-h-11 w-full sm:w-auto"><Link to="/launch-control">Open Launch Control<ArrowRight className="size-4" aria-hidden="true" /></Link></Button>
              </div>
            ) : !profileId ? (
              <div className="grid min-h-64 gap-4 px-5 py-7 sm:px-7 lg:grid-cols-[minmax(0,1fr)_auto] lg:items-center">
                <div className="min-w-0">
                  <p className="type-eyebrow text-gold">Project identity required</p>
                  <h2 id="active-launch-heading" className="mt-2 font-display text-3xl uppercase text-foreground">Create your Project Profile</h2>
                  <p className="mt-2 max-w-xl text-sm leading-relaxed text-muted-foreground">Your profile is the identity the launch journey, community tools and creative work build on.</p>
                </div>
                {dominantStage ? <JourneyLink stage={dominantStage} primaryLaunchId={journey?.primaryLaunchId ?? null} label={dominantStage.actionLabel} linkClassName={cn(buttonVariants(), "h-auto min-h-11 w-full min-w-0 whitespace-normal text-center sm:w-auto")} /> : null}
              </div>
            ) : !primaryLaunch ? (
              <div className="grid min-h-64 gap-5 px-5 py-7 sm:px-7 lg:grid-cols-[minmax(0,1fr)_minmax(17rem,0.55fr)] lg:items-center">
                <div className="min-w-0">
                  <p className="type-eyebrow text-gold">Launch status</p>
                  <h2 id="active-launch-heading" className="mt-2 font-display text-3xl uppercase text-foreground">No launch created yet</h2>
                  <p className="mt-2 max-w-xl text-sm leading-relaxed text-muted-foreground">The project journey shows the first available requirement and preserves every dependency before launch creation.</p>
                </div>
                <div className="border border-gold/25 bg-surface-raised/55 p-4">
                  <p className="type-meta text-gold">Next required action</p>
                  <p className="mt-2 text-base font-semibold text-foreground [overflow-wrap:anywhere]">{journeyQuery.isPending ? "Checking project journey…" : journey?.nextAction.headline ?? "Review your project journey"}</p>
                  {dominantStage ? <JourneyLink stage={dominantStage} primaryLaunchId={journey?.primaryLaunchId ?? null} label={journeyBlocked ? (dominantStage.reviewLabel ?? `Review ${dominantStage.title}`) : dominantStage.actionLabel} linkClassName={cn(buttonVariants({ variant: journeyBlocked ? "outline" : "default" }), "mt-4 h-auto min-h-11 w-full min-w-0 whitespace-normal text-center")} /> : null}
                </div>
              </div>
            ) : (
              <div className="grid min-w-0 lg:grid-cols-[minmax(0,1.55fr)_minmax(18rem,0.75fr)]">
                <div className="min-w-0 px-5 py-6 sm:px-7 sm:py-7">
                  <div className="grid grid-cols-[minmax(0,1fr)_auto] items-start gap-3">
                    <div className="min-w-0">
                      <p className="type-eyebrow text-gold">{status === "COMPLETED" ? "Latest launch" : "Active launch"}</p>
                      <h2 id="active-launch-heading" className="mt-2 font-display text-4xl uppercase leading-none text-foreground [overflow-wrap:anywhere] sm:text-5xl">{primaryLaunch.token_name}</h2>
                      <p className="mt-2 text-sm text-muted-foreground [overflow-wrap:anywhere]">{primaryLaunch.ticker} · {primaryLaunch.chain}</p>
                    </div>
                    <StatusBadge tone={STATUS_TONE[status!]}><span>{LAUNCH_STATUS_LABELS[status!]}</span></StatusBadge>
                  </div>
                  <p className="mt-4 max-w-2xl text-sm leading-relaxed text-muted-foreground">{LAUNCH_STATUS_HELP[status!]}</p>
                  <dl className="mt-6 grid gap-4 border-t border-border-subtle pt-4 sm:grid-cols-3">
                    <Fact label="Schedule" value={scheduleSummary(primaryLaunch)} />
                     <Fact label="Launch Watch" value={watchPending || watchUnavailable || !watchToken ? watchValue : `${watchValue} active`} />
                    <Fact label="Official contract" value={contractRegistered ? "Registered" : status === "CONTRACT_PENDING" ? "Pending registration" : "Not yet available"} />
                  </dl>
                  {journey ? <div className="mt-6"><div className="mb-2 flex items-center justify-between gap-3"><span className="type-meta text-muted-foreground">Project journey</span><span className="text-xs font-semibold text-foreground">{journey.completedCount}/{journey.totalCount}</span></div><ProjectJourneyProgress value={journey.completedCount} total={journey.totalCount} /></div> : null}
                </div>
                <div className="border-t border-gold/25 bg-surface-raised/55 p-5 sm:p-6 lg:border-l lg:border-t-0">
                  <div className="flex items-center gap-2 text-gold"><CircleDot className="size-4" aria-hidden="true" /><p className="type-meta">Next required action</p></div>
                   {journeyQuery.isPending ? <p className="mt-4 text-sm text-muted-foreground">Checking project journey…</p> : journeyQuery.isError ? <div className="mt-4"><p className="text-sm text-muted-foreground">The next action is unavailable right now.</p><Button size="sm" variant="outline" className="mt-3 min-h-11" onClick={() => void journeyQuery.refetch()}><RefreshCw className="size-4" aria-hidden="true" />Retry</Button></div> : journey ? <><h3 className="mt-4 text-xl font-semibold leading-snug text-foreground [overflow-wrap:anywhere]">{journeyBlocked && blockedStage ? blockedStage.title : journey.nextAction.headline}</h3><p className="mt-2 text-xs leading-relaxed text-muted-foreground">{journeyBlocked && blockedStage ? journeyStageGuidance(blockedStage) : journey.nextAction.explanation}</p>{dominantStage ? <JourneyLink stage={dominantStage} primaryLaunchId={journey.primaryLaunchId} label={journeyBlocked ? (dominantStage.reviewLabel ?? `Review ${dominantStage.title}`) : dominantStage.actionLabel} linkClassName={cn(buttonVariants({ variant: journeyBlocked ? "outline" : "default" }), "mt-5 h-auto min-h-11 w-full min-w-0 whitespace-normal text-center")} /> : journey.allComplete ? <Button asChild variant="outline" className="mt-5 min-h-11 w-full"><Link to={communityOnly ? "/telegram" : "/launch-control"}>{communityOnly ? "Open Community Command" : "Review Launch Control"}<ArrowRight className="size-4" aria-hidden="true" /></Link></Button> : null}</> : null}
                </div>
              </div>
            )}
          </section>

          <section aria-label="Live project metrics" className="grid gap-3 md:grid-cols-3 [&>*]:min-w-0">
             <MetricSurface icon={Radio} label="Launch Watch" value={watchValue} detail={watchDetail} status={watchStatus} tone={watchPending || watchUnavailable || !watchToken ? "muted" : "green"} to="/launch-control" />
             <MetricSurface icon={Users} label="Communities" value={communityValue} detail={communityDetail} status={communityStatus} tone={telegramQuery.isPending || telegramQuery.isError || groupCount === 0 ? "muted" : healthyGroups === groupCount ? "green" : "gold"} to="/telegram" />
             <MetricSurface icon={Send} label="Sticker Drops" value={dropValue} detail={dropDetail} status={dropStatus} tone={dropsQuery.isPending || dropsQuery.isError ? "muted" : killSwitch ? "red" : activeSchedules > 0 ? "green" : "muted"} to="/distribution" />
          </section>

          <div className="grid min-w-0 gap-4 xl:grid-cols-[minmax(0,2fr)_minmax(18rem,1fr)]">
             <Section variant="surface" title={communityOnly ? "Community readiness" : "Launch readiness"} description={communityOnly ? "Your project setup checklist, in order — the prioritized next action above is what matters most right now." : "The full checklist, in dependency order — the prioritized next action above is what matters most right now."} actions={journey ? <StatusBadge tone={journey.allComplete ? "green" : "gold"}>{journey.completedCount}/{journey.totalCount}</StatusBadge> : undefined} className="min-w-0" contentClassName="min-w-0">
              <ProjectJourneyPanel workspaceId={workspaceId} />
            </Section>
            <div className="grid content-start gap-4">
              <Section variant="surface" title="Operator focus" leading={<Activity className="size-4" aria-hidden="true" />} contentClassName="space-y-3">
                <p className="text-sm font-semibold leading-snug text-foreground [overflow-wrap:anywhere]">{criticalCount > 0 ? `${criticalCount} critical ${criticalCount === 1 ? "item needs" : "items need"} immediate action.` : attention.length > 0 ? `${attention.length} operational ${attention.length === 1 ? "item needs" : "items need"} review.` : journey?.allComplete ? (communityOnly ? "Community foundation is ready." : "Launch foundation is ready.") : dominantStage ? dominantStage.title : "Keep the project journey moving."}</p>
                 <p className="text-xs leading-relaxed text-muted-foreground">{criticalCount > 0 ? "Critical items affect your watchers or live operations — resolve them first, then follow the prioritized next action." : attention.length > 0 ? "Resolve operational warnings before routine work. The prioritized action is the authoritative next project step." : journeyBlocked && blockedStage ? journeyStageGuidance(blockedStage) : journey?.nextAction.explanation ?? "Live project state will guide the next action when available."}</p>
              </Section>
              <Section variant="surface" title="Live operations" leading={<Clock3 className="size-4" aria-hidden="true" />} contentClassName="divide-y divide-border-subtle">
                 <InlineRow leading={<Users className="size-4" aria-hidden="true" />} title="Communities" subtitle={communityDetail} trailing={<StatusBadge tone={!telegramQuery.isPending && !telegramQuery.isError && healthyGroups > 0 ? "green" : "muted"}>{communityValue}</StatusBadge>} />
                 <InlineRow leading={<Send className="size-4" aria-hidden="true" />} title="Sticker Drops" subtitle={dropDetail} trailing={<StatusBadge tone={dropsQuery.isPending || dropsQuery.isError ? "muted" : killSwitch ? "red" : activeSchedules > 0 ? "green" : "muted"}>{dropValue}</StatusBadge>} />
                <InlineRow leading={<Sticker className="size-4" aria-hidden="true" />} title="Sticker packs" subtitle={packsQuery.isError ? "Pack state unavailable." : packTotal === 0 ? "No packs created yet." : `${packTotal} pack${packTotal === 1 ? "" : "s"} in this project.`} trailing={<StatusBadge tone={packTotal > 0 ? "green" : "muted"}>{packsQuery.isPending ? "—" : packsQuery.isError ? "Unavailable" : packTotal}</StatusBadge>} />
              </Section>
            </div>
          </div>

          {attention.length > 0 ? (
            <Section variant="surface" className="rise-in border-signal/40" title="Needs attention" leading={<ShieldAlert className="size-4 text-signal" aria-hidden="true" />} actions={<StatusBadge tone="red">{attention.length}</StatusBadge>} contentClassName="space-y-1">
              {sortedAttention.map((item) => <InlineRow key={item.id} leading={<AlertTriangle className="size-4 text-signal" aria-hidden="true" />} title={item.text} trailing={<Button asChild size="sm" variant="outline" className="min-h-11 shrink-0"><Link to={item.to}>{item.action}</Link></Button>} />)}
            </Section>
          ) : null}

          <Section variant="surface" title="Recent packs" actions={<Button asChild size="sm" variant="outline" className="min-h-11"><Link to="/sticker-lab">Open Lab</Link></Button>} contentClassName="space-y-1">
             {packsQuery.isPending ? <p className="flex items-center gap-2 text-xs text-muted-foreground"><Loader2 className="size-4 animate-spin" aria-hidden="true" />Loading packs…</p> : packsQuery.isError ? <p className="text-xs text-muted-foreground">Recent packs are unavailable right now.</p> : recentPacks.length === 0 ? <EmptyState icon={PackageOpen} title="No packs yet" description="Sticker packs saved from Sticker Lab appear here for this project." action={<Button asChild size="sm" variant="outline" className="min-h-11"><Link to="/sticker-lab">Open Sticker Lab</Link></Button>} /> : recentPacks.map((pack) => <InlineRow key={pack.id} leading={<Sticker className="size-4" aria-hidden="true" />} title={pack.title} subtitle={`${pack.pack_size} stickers · ${pack.theme}`} trailing={<StatusBadge tone={String(pack.status ?? "").toLowerCase().includes("publish") ? "green" : "muted"}>{pack.status}</StatusBadge>} />)}
          </Section>
        </>
      )}
    </div>
  );
}
