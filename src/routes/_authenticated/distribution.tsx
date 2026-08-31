import { useMemo, useState } from "react";
import { createFileRoute, Link } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import {
  Activity,
  Loader2,
  OctagonAlert,
  Send,
  Settings2,
  TriangleAlert,
  Users,
} from "lucide-react";
import { PageHeader } from "@/components/cartel/PageHeader";
import { Section } from "@/components/cartel/Section";
import { InlineRow } from "@/components/cartel/InlineRow";
import { StatusBadge } from "@/components/cartel/StatusBadge";
import { EmptyState } from "@/components/cartel/EmptyState";
import { StickerDropScheduleDialog } from "@/components/cartel/StickerDropScheduleDialog";
import { Button } from "@/components/ui/button";
import { useWorkspace } from "@/lib/workspace-context";
import {
  SCHEDULE_STATE_LABEL,
  dropErrorMessage,
  fetchDropStatus,
  formatCadence,
  formatClock,
  formatNextRun,
  nextRunAt,
  relativeTime,
  scheduleState,
  sentToday,
  setDropKillSwitch,
  type DropGroup,
  type DropSchedule,
  type ScheduleState,
} from "@/lib/sticker-drops";

export const Route = createFileRoute("/_authenticated/distribution")({
  validateSearch: (search: Record<string, unknown>): { pack?: string } => {
    const raw = search["pack"];
    return typeof raw === "string" && raw ? { pack: raw } : {};
  },
  head: () => ({
    meta: [
      { title: "Sticker Drops — CARTEL HQ" },
      {
        name: "description",
        content:
          "Schedule and monitor recurring automated sticker posts across your connected Telegram communities, with caps, quiet hours and an emergency pause.",
      },
      { property: "og:title", content: "Sticker Drops — CARTEL HQ" },
      {
        property: "og:description",
        content:
          "Community automation console for recurring Telegram sticker drops: schedules, delivery health and emergency control.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
  }),
  component: DistributionPage,
});

const STATE_TONE: Record<ScheduleState, "gold" | "green" | "red" | "muted"> = {
  active: "green",
  paused: "muted",
  auto_paused: "red",
  killed: "red",
  unconfigured: "muted",
};

function HeroStat({ label, value, hint }: { label: string; value: string; hint?: string }) {
  return (
    <div className="min-w-0">
      <p className="type-meta text-muted-foreground">{label}</p>
      <p className="mt-1 truncate font-display text-2xl leading-none text-gold">{value}</p>
      {hint ? <p className="mt-1 truncate text-[11px] text-muted-foreground">{hint}</p> : null}
    </div>
  );
}

function DistributionPage() {
  const { pack: packFilter } = Route.useSearch();
  const { workspaceId } = useWorkspace();
  const queryClient = useQueryClient();
  const [dialogGroup, setDialogGroup] = useState<DropGroup | null>(null);
  const [dialogSchedule, setDialogSchedule] = useState<DropSchedule | null>(null);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [confirmKill, setConfirmKill] = useState(false);

  const statusQuery = useQuery({
    queryKey: ["sticker-drops", workspaceId],
    enabled: !!workspaceId,
    queryFn: () => fetchDropStatus(workspaceId!),
    refetchInterval: 60_000,
  });

  const status = statusQuery.data;
  const killSwitch = status?.control?.kill_switch === true;
  const canManage = status?.canManage === true;
  const groups = status?.groups ?? [];
  const schedules = status?.schedules ?? [];
  const packs = status?.packs ?? [];
  const events = status?.events ?? [];

  const scheduleByGroup = useMemo(() => {
    const map: Record<string, DropSchedule> = {};
    for (const s of schedules) map[s.group_connection_id] = s;
    return map;
  }, [schedules]);

  const packTitle = useMemo(() => {
    const map: Record<string, string> = {};
    for (const p of packs) map[p.id] = p.title;
    return map;
  }, [packs]);

  const groupTitle = useMemo(() => {
    const map: Record<string, string> = {};
    for (const g of groups) map[g.id] = g.title;
    return map;
  }, [groups]);

  const stickerLabel = useMemo(() => {
    const map: Record<string, string> = {};
    for (const s of status?.stickers ?? []) map[s.id] = s.label;
    return map;
  }, [status?.stickers]);

  /** Presentation-only: nothing is effectively active while the kill switch is on. */
  const activeCount = killSwitch ? 0 : schedules.filter((s) => s.enabled).length;
  const todayCount = sentToday(events);
  const next = nextRunAt(schedules, killSwitch);

  const failedEvents = useMemo(() => events.filter((e) => e.status !== "sent"), [events]);
  const successEvents = useMemo(() => events.filter((e) => e.status === "sent"), [events]);
  const autoPausedCount = useMemo(
    () => schedules.filter((s) => scheduleState(s, killSwitch) === "auto_paused").length,
    [schedules, killSwitch],
  );
  const hasIssues = killSwitch || autoPausedCount > 0 || failedEvents.length > 0;

  const killMutation = useMutation({
    mutationFn: (nextValue: boolean) => setDropKillSwitch(workspaceId!, nextValue),
    onSuccess: (_r, nextValue) => {
      setConfirmKill(false);
      void queryClient.invalidateQueries({ queryKey: ["sticker-drops", workspaceId] });
      toast.success(
        nextValue ? "Emergency pause is ON. All drops stopped." : "Emergency pause cleared.",
      );
    },
    onError: (err) => toast.error(dropErrorMessage(err)),
  });

  const filteredPackTitle = packFilter ? packTitle[packFilter] : undefined;

  function openEditor(group: DropGroup) {
    setDialogGroup(group);
    setDialogSchedule(scheduleByGroup[group.id] ?? null);
    setDialogOpen(true);
  }

  const nextLabel = next
    ? next.isDue
      ? "Due now"
      : formatClock(next.at)
    : killSwitch
      ? "Paused"
      : "Not scheduled";

  const hasStatus = !!status && !statusQuery.isError;

  return (
    <div className="flex min-w-0 flex-col gap-6 sm:gap-8">
      <PageHeader
        eyebrow="Community Automation"
        title="Sticker Drops"
        description="Schedule and monitor recurring automated sticker posts across your connected Telegram communities. Pack publishing and one-time sends stay in Sticker Lab."
        status="Live Beta"
      />

      {filteredPackTitle ? (
        <p className="min-w-0 rounded-lg border border-gold/30 bg-gold/5 px-3 py-2 text-xs text-muted-foreground [overflow-wrap:anywhere]">
          Configuring Sticker Drops for <span className="text-gold">{filteredPackTitle}</span>.
          Choose a community schedule below.
        </p>
      ) : null}

      {statusQuery.isError ? (
        <Section variant="primary" title="Sticker Drops unavailable">
          <p className="text-sm text-muted-foreground">{dropErrorMessage(statusQuery.error)}</p>
          <Button
            variant="outline"
            size="sm"
            className="mt-3 min-h-10"
            onClick={() => void statusQuery.refetch()}
          >
            Retry
          </Button>
        </Section>
      ) : !hasStatus ? (
        <Section variant="primary" title="Loading Sticker Drops">
          <p className="flex items-center gap-2 text-sm text-muted-foreground">
            <Loader2 className="size-4 animate-spin" aria-hidden="true" />
            Loading automation state…
          </p>
        </Section>
      ) : (
        <>
          <Section
            variant="hero"
            title="Automation state"
            actions={
              <StatusBadge tone={killSwitch ? "red" : "green"}>
                {killSwitch ? "Emergency pause ON" : "Normal operation"}
              </StatusBadge>
            }
            contentClassName="space-y-4"
          >
            <div className="grid min-w-0 grid-cols-2 gap-4 lg:grid-cols-4">
              <HeroStat label="Connected communities" value={String(groups.length)} />
              <HeroStat
                label="Active schedules"
                value={String(activeCount)}
                {...(killSwitch ? { hint: "Emergency pause on" } : {})}
              />
              <HeroStat label="Sent today" value={String(todayCount)} hint="Your local day" />
              <HeroStat label="Next drop" value={nextLabel} />
            </div>
            {!canManage ? (
              <p className="text-xs text-muted-foreground">
                Read-only access — a workspace owner or admin manages schedules and the emergency
                control.
              </p>
            ) : null}
          </Section>

          {hasIssues ? (
            <Section
              variant="primary"
              title="Attention required"
              leading={<TriangleAlert className="size-4" aria-hidden="true" />}
              contentClassName="space-y-2"
            >
              {killSwitch ? (
                <p className="text-xs leading-relaxed text-signal sm:text-sm">
                  Emergency pause is ON — every automated Sticker Drop is stopped until it is
                  turned off.
                </p>
              ) : null}
              {autoPausedCount > 0 ? (
                <p className="text-xs leading-relaxed text-signal sm:text-sm">
                  {autoPausedCount} schedule{autoPausedCount === 1 ? " is" : "s are"} auto-paused
                  and will not run until reviewed.
                </p>
              ) : null}
              {failedEvents.length > 0 ? (
                <p className="text-xs leading-relaxed text-signal sm:text-sm">
                  {failedEvents.length} recent deliver{failedEvents.length === 1 ? "y" : "ies"} did
                  not send — see Delivery health below.
                </p>
              ) : null}
            </Section>
          ) : null}

          <Section
            variant="primary"
            title="Community schedules"
            leading={<Users className="size-4" aria-hidden="true" />}
            actions={
              <StatusBadge tone={groups.length > 0 ? "gold" : "muted"}>
                {`${groups.length} connected`}
              </StatusBadge>
            }
          >
            {groups.length === 0 ? (
              <EmptyState
                compact
                icon={Send}
                title="No Telegram communities connected"
                description="Connect a Telegram community first — connected communities appear here and can run Sticker Drops."
                action={
                  <Button asChild variant="outline" size="sm" className="mt-1 min-h-10">
                    <Link to="/telegram">Open Telegram setup</Link>
                  </Button>
                }
              />
            ) : (
              <ul className="space-y-2">
                {groups.map((group) => {
                  const schedule = scheduleByGroup[group.id];
                  const state = scheduleState(schedule, killSwitch);
                  const detail = schedule
                    ? [
                        packTitle[schedule.pack_id] ?? "Pack",
                        formatCadence(schedule.interval_minutes),
                        `${schedule.active_start.slice(0, 5)}–${schedule.active_end.slice(0, 5)}`,
                        `max ${schedule.daily_cap}/day`,
                        schedule.silent ? "silent" : "with sound",
                      ].join(" · ")
                    : group.username
                      ? `@${group.username}`
                      : (group.chat_type ?? "group");
                  return (
                    <li key={group.id}>
                      <InlineRow
                        title={group.title}
                        subtitle={detail}
                        {...(state === "active" && formatNextRun(schedule?.next_run_at)
                          ? { meta: formatNextRun(schedule?.next_run_at) as string }
                          : {})}
                        trailing={
                          <>
                            <StatusBadge tone={STATE_TONE[state]}>
                              {SCHEDULE_STATE_LABEL[state]}
                            </StatusBadge>
                            <Button
                              variant="outline"
                              size="sm"
                              className="min-h-9"
                              onClick={() => openEditor(group)}
                            >
                              <Settings2 className="size-4" aria-hidden="true" />
                              {schedule ? "Edit" : canManage ? "Configure" : "View"}
                            </Button>
                          </>
                        }
                      />
                      {state === "auto_paused" && schedule?.paused_reason ? (
                        <p className="mt-1 px-3 text-[11px] leading-relaxed text-signal [overflow-wrap:anywhere]">
                          Auto-paused: {schedule.paused_reason}
                        </p>
                      ) : null}
                    </li>
                  );
                })}
              </ul>
            )}
            {!canManage && groups.length > 0 ? (
              <p className="mt-3 text-xs text-muted-foreground">
                You have read-only access to Sticker Drops. Ask a workspace owner or admin to
                change schedules.
              </p>
            ) : null}
          </Section>

          <Section
            variant="surface"
            title="Delivery health"
            leading={<Activity className="size-4" aria-hidden="true" />}
            actions={
              <StatusBadge tone={failedEvents.length > 0 ? "red" : "green"}>
                {failedEvents.length > 0
                  ? `${failedEvents.length} recent failure${failedEvents.length === 1 ? "" : "s"}`
                  : "No recent failures"}
              </StatusBadge>
            }
            contentClassName="space-y-3"
          >
            <p className="text-xs text-muted-foreground sm:text-sm">
              {todayCount} sent today · {successEvents.length} recent successful send
              {successEvents.length === 1 ? "" : "s"} · {failedEvents.length} recent failure
              {failedEvents.length === 1 ? "" : "s"}
            </p>

            {failedEvents.length > 0 ? (
              <ul className="space-y-2">
                {failedEvents.slice(0, 10).map((event) => (
                  <li key={event.id}>
                    <InlineRow
                      className="border-signal/40 bg-signal/5"
                      title={groupTitle[event.group_connection_id] ?? "Community"}
                      subtitle={event.error_message ?? "Delivery failed"}
                      trailing={<StatusBadge tone="red">{event.status}</StatusBadge>}
                      meta={relativeTime(event.created_at)}
                    />
                  </li>
                ))}
              </ul>
            ) : null}

            {events.length === 0 ? (
              <p className="text-xs text-muted-foreground">
                No delivery telemetry yet. Once a schedule is enabled, sends and failures are
                recorded here.
              </p>
            ) : null}

            {successEvents.length > 0 ? (
              <details className="min-w-0 rounded-md bg-surface-raised/25 p-2.5 sm:p-3.5">
                <summary className="cursor-pointer text-xs font-semibold uppercase tracking-[0.14em] text-muted-foreground">
                  Delivery history — view recent successful sends
                </summary>
                <ul className="mt-3 space-y-1.5">
                  {successEvents.slice(0, 8).map((event) => (
                    <li
                      key={event.id}
                      className="flex min-w-0 flex-wrap items-baseline justify-between gap-x-3 gap-y-0.5 text-[11px] text-muted-foreground"
                    >
                      <span className="min-w-0 [overflow-wrap:anywhere]">
                        {groupTitle[event.group_connection_id] ?? "Community"} ·{" "}
                        {event.sticker_id
                          ? (stickerLabel[event.sticker_id] ?? "Sticker")
                          : "Sticker"}
                      </span>
                      <span className="shrink-0">{relativeTime(event.created_at)}</span>
                    </li>
                  ))}
                </ul>
              </details>
            ) : null}
          </Section>

          <Section
            variant="surface"
            title="Emergency control"
            leading={<OctagonAlert className="size-4" aria-hidden="true" />}
            actions={
              <StatusBadge tone={killSwitch ? "red" : "green"}>
                {killSwitch ? "Emergency pause ON" : "Normal operation"}
              </StatusBadge>
            }
            contentClassName="space-y-3"
          >
            <p className="text-xs leading-relaxed text-muted-foreground sm:text-sm">
              Emergency pause immediately stops all automated Sticker Drops in this workspace. Your
              schedules and settings are preserved — nothing is deleted, and resuming restores
              normal operation.
            </p>
            {killSwitch ? (
              <div className="flex min-w-0 items-start gap-2 rounded-lg border border-signal/40 bg-signal/10 px-3 py-2.5">
                <TriangleAlert className="mt-0.5 size-4 shrink-0 text-signal" aria-hidden="true" />
                <p className="min-w-0 text-xs leading-relaxed text-foreground">
                  All automated Sticker Drops are stopped. Every schedule shows as paused until you
                  turn emergency pause off.
                </p>
              </div>
            ) : null}
            {canManage ? (
              confirmKill ? (
                <div className="flex flex-wrap items-center gap-2">
                  <span className="min-w-0 flex-1 text-xs text-muted-foreground">
                    {killSwitch
                      ? "Resume automated Sticker Drops for this workspace?"
                      : "Stop all automated Sticker Drops now?"}
                  </span>
                  <Button
                    variant="outline"
                    size="sm"
                    className="min-h-10"
                    onClick={() => setConfirmKill(false)}
                  >
                    Cancel
                  </Button>
                  <Button
                    variant={killSwitch ? "default" : "destructive"}
                    size="sm"
                    className="min-h-10"
                    disabled={killMutation.isPending}
                    onClick={() => killMutation.mutate(!killSwitch)}
                  >
                    {killMutation.isPending ? (
                      <Loader2 className="size-4 animate-spin" aria-hidden="true" />
                    ) : null}
                    {killSwitch ? "Resume drops" : "Pause everything"}
                  </Button>
                </div>
              ) : (
                <Button
                  variant={killSwitch ? "default" : "outline"}
                  size="sm"
                  className="min-h-11 w-full sm:w-auto"
                  onClick={() => setConfirmKill(true)}
                >
                  {killSwitch ? "Turn emergency pause off" : "Turn emergency pause on"}
                </Button>
              )
            ) : (
              <p className="text-xs text-muted-foreground">
                Only a workspace owner or admin can change this control.
              </p>
            )}
          </Section>
        </>
      )}

      {workspaceId ? (
        <StickerDropScheduleDialog
          open={dialogOpen}
          onOpenChange={(next) => {
            setDialogOpen(next);
            if (!next) {
              setDialogGroup(null);
              setDialogSchedule(null);
            }
          }}
          workspaceId={workspaceId}
          group={dialogGroup}
          groups={groups}
          schedule={dialogSchedule}
          packs={packs}
          stickers={status?.stickers ?? []}
          canManage={canManage}
          onChanged={() => {
            void queryClient.invalidateQueries({ queryKey: ["sticker-drops", workspaceId] });
          }}
        />
      ) : null}
    </div>
  );
}
