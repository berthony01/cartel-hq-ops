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
import { ScrollRail } from "@/components/cartel/ScrollRail";
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
      { title: "Distribution Center — CARTEL HQ" },
      {
        name: "description",
        content:
          "Admin-controlled branded sticker delivery to your connected Telegram communities, with caps, quiet hours and an emergency pause.",
      },
      { property: "og:title", content: "Distribution Center — CARTEL HQ" },
      {
        property: "og:description",
        content:
          "Schedule, monitor and pause branded Telegram sticker drops from one operational console.",
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

function SummaryTile({
  label,
  value,
  hint,
}: {
  label: string;
  value: string;
  hint?: string | undefined;
}) {
  return (
    <div className="min-w-[9.5rem] rounded-lg border border-border/70 bg-surface-raised/60 px-3 py-2.5">
      <p className="text-[10px] font-semibold uppercase tracking-[0.16em] text-muted-foreground">
        {label}
      </p>
      <p className="mt-1 truncate font-display text-xl leading-none text-gold">{value}</p>
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

  const activeCount = killSwitch ? 0 : schedules.filter((s) => s.enabled).length;
  const todayCount = sentToday(events);
  const next = nextRunAt(schedules, killSwitch);

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

  return (
    <div className="flex min-w-0 flex-col gap-6 sm:gap-8">
      <PageHeader
        eyebrow="Operations"
        title="Distribution"
        description="Admin-controlled delivery of your own branded sticker packs into Telegram communities you have connected. Every drop is scheduled, capped and logged — this is not engagement farming, raiding or automated human activity."
        status="Live Beta"
      />

      {filteredPackTitle ? (
        <p className="min-w-0 rounded-lg border border-gold/30 bg-gold/5 px-3 py-2 text-xs text-muted-foreground [overflow-wrap:anywhere]">
          Arrived from pack <span className="text-gold">{filteredPackTitle}</span>. Choose a group
          below to configure or edit its drop schedule.
        </p>
      ) : null}

      {statusQuery.isError ? (
        <Section variant="primary" title="Distribution unavailable">
          <p className="text-sm text-muted-foreground">
            {dropErrorMessage(statusQuery.error)}
          </p>
          <Button
            variant="outline"
            size="sm"
            className="mt-3 min-h-10"
            onClick={() => void statusQuery.refetch()}
          >
            Try again
          </Button>
        </Section>
      ) : null}

      <ScrollRail
        aria-label="Distribution summary"
        desktopClassName="lg:grid lg:grid-cols-4 lg:overflow-visible lg:mx-0 lg:px-0"
      >
        <SummaryTile label="Connected groups" value={String(groups.length)} />
        <SummaryTile
          label="Active schedules"
          value={String(activeCount)}
          hint={killSwitch ? "Emergency pause on" : undefined}
        />
        <SummaryTile label="Sent today" value={String(todayCount)} hint="Your local day" />
        <SummaryTile
          label="Next drop"
          value={
            next
              ? next.isDue
                ? "Due now"
                : formatClock(next.at)
              : killSwitch
                ? "Paused"
                : "Not scheduled"
          }
        />
      </ScrollRail>

      <Section
        variant="primary"
        title="Safety controls"
        leading={<OctagonAlert className="size-4" aria-hidden="true" />}
        actions={
          <StatusBadge tone={killSwitch ? "red" : "green"}>
            {killSwitch ? "Emergency pause ON" : "Normal operation"}
          </StatusBadge>
        }
        contentClassName="space-y-3"
      >
        <p className="text-xs leading-relaxed text-muted-foreground sm:text-sm">
          Emergency pause immediately stops every automated sticker drop in this workspace. Your
          schedules and settings are kept exactly as they are — nothing is deleted, and you can
          resume at any time.
        </p>
        {killSwitch ? (
          <div className="flex min-w-0 items-start gap-2 rounded-lg border border-signal/40 bg-signal/10 px-3 py-2.5">
            <TriangleAlert className="mt-0.5 size-4 shrink-0 text-signal" aria-hidden="true" />
            <p className="min-w-0 text-xs leading-relaxed text-foreground">
              All automated drops are stopped. Every schedule below shows as paused until you turn
              emergency pause off.
            </p>
          </div>
        ) : null}
        {canManage ? (
          confirmKill ? (
            <div className="flex flex-wrap items-center gap-2">
              <span className="min-w-0 flex-1 text-xs text-muted-foreground">
                {killSwitch
                  ? "Resume automated drops for this workspace?"
                  : "Stop all automated drops now?"}
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

      <Section
        variant="primary"
        title="Connected communities"
        leading={<Users className="size-4" aria-hidden="true" />}
        actions={
          <StatusBadge tone={groups.length > 0 ? "gold" : "muted"}>
            {statusQuery.isLoading ? "Loading" : `${groups.length} connected`}
          </StatusBadge>
        }
      >
        {statusQuery.isLoading ? (
          <p className="text-sm text-muted-foreground">Loading distribution state…</p>
        ) : groups.length === 0 ? (
          <EmptyState
            compact
            icon={Send}
            title="No Telegram groups connected"
            description="Connect a Telegram group first — connected communities appear here and can receive scheduled sticker drops."
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
                    {...(state === "active" && schedule?.next_run_at
                      ? { meta: `Next ${formatClock(new Date(schedule.next_run_at))}` }
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
                  {schedule?.paused_reason && !killSwitch ? (
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
            You have read-only access to distribution. Ask a workspace owner or admin to change
            drop schedules.
          </p>
        ) : null}
      </Section>

      <Section
        variant="primary"
        title="Activity"
        leading={<Activity className="size-4" aria-hidden="true" />}
        actions={
          <StatusBadge tone={events.length > 0 ? "gold" : "muted"}>
            {`${events.length} recent`}
          </StatusBadge>
        }
      >
        {events.length === 0 ? (
          <EmptyState
            compact
            icon={Activity}
            title="No drop activity yet"
            description="Once a schedule is enabled, every send and every failure is logged here."
          />
        ) : (
          <ul className="space-y-2">
            {events.slice(0, 25).map((event) => {
              const failed = event.status !== "sent";
              return (
                <li key={event.id}>
                  <InlineRow
                    {...(failed ? { className: "border-signal/40 bg-signal/5" } : {})}
                    title={groupTitle[event.group_connection_id] ?? "Group"}
                    subtitle={
                      failed
                        ? (event.error_message ?? "Delivery failed")
                        : (event.sticker_id
                            ? (stickerLabel[event.sticker_id] ?? "Sticker")
                            : "Sticker") + " sent"
                    }
                    trailing={
                      <StatusBadge tone={failed ? "red" : "green"}>
                        {failed ? event.status : "sent"}
                      </StatusBadge>
                    }
                    meta={relativeTime(event.created_at)}
                  />
                </li>
              );
            })}
          </ul>
        )}
      </Section>

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
