import { AlertTriangle, ExternalLink, Loader2, Radar, Target } from "lucide-react";
import { Section } from "@/components/cartel/Section";
import { StatusBadge } from "@/components/cartel/StatusBadge";
import { EmptyState } from "@/components/cartel/EmptyState";
import { Button } from "@/components/ui/button";
import {
  MISSION_OPERATOR_GUIDANCE,
  deliveryTone,
  eventStateTone,
  formatMetric,
  formatMissionTime,
  isMissionActive,
  missionStatusTone,
  missionTimeRemaining,
  rollupMissions,
  useWorkspaceMissions,
  type MissionView,
} from "@/lib/social-missions";

/**
 * Step 1C — customer-facing, STRICTLY READ-ONLY Social Mission surface.
 *
 * This panel renders stored state only. It has no send, edit, close, create,
 * retry or cancel control, performs no mutation, no provider call, no Telegram
 * call and no polling, and it reuses none of the Owner Console fixture
 * controls. Missions are started and closed with `/mission` in Telegram.
 */

function GuidanceCard() {
  return (
    <div className="rounded-lg border border-dashed border-border/70 bg-background/40 p-3.5">
      <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">
        How missions are run
      </p>
      <ul className="mt-2 space-y-1.5 text-xs leading-relaxed text-muted-foreground">
        <li>
          <code className="rounded-sm border border-border/60 bg-surface-overlay/40 px-1.5 py-0.5 text-[11px] text-foreground">
            {MISSION_OPERATOR_GUIDANCE.start}
          </code>
        </li>
        <li>
          <code className="rounded-sm border border-border/60 bg-surface-overlay/40 px-1.5 py-0.5 text-[11px] text-foreground">
            {MISSION_OPERATOR_GUIDANCE.close}
          </code>
        </li>
        <li>{MISSION_OPERATOR_GUIDANCE.where}</li>
      </ul>
    </div>
  );
}

function TimelineRow({ label, state, due }: { label: string; state: string; due: string }) {
  return (
    <li className="flex min-w-0 items-center justify-between gap-2 rounded-md border border-border/50 bg-background/30 px-2.5 py-1.5">
      <span className="min-w-0 truncate text-xs text-foreground">{label}</span>
      <span className="flex shrink-0 items-center gap-1.5">
        <span className="text-[11px] text-muted-foreground">{due}</span>
        <StatusBadge tone={eventStateTone(state)}>
          <span>{state}</span>
        </StatusBadge>
      </span>
    </li>
  );
}

function MissionCard({ view }: { view: MissionView }) {
  const { mission, canonicalUrl, authorHandle, targets, scheduleEvents, latestSnapshot } = view;
  const remaining = missionTimeRemaining(mission);
  const active = isMissionActive(mission);
  // SE-5 product state. ACCOMPLISHED is derived, not a database status, and the
  // column is newer than the committed generated types.
  const accomplishedAt = (mission as unknown as Record<string, unknown>)["accomplished_at"];
  const accomplished = typeof accomplishedAt === "string";

  return (
    <article className="min-w-0 rounded-lg border border-border/70 bg-surface-elevated p-3.5 sm:p-4">
      <div className="flex min-w-0 flex-wrap items-start justify-between gap-2">
        <div className="min-w-0">
          <p className="truncate font-display text-sm uppercase leading-tight text-foreground">
            {authorHandle ? `@${authorHandle}` : "Social mission"}
          </p>
          {canonicalUrl ? (
            <a
              href={canonicalUrl}
              target="_blank"
              rel="noreferrer noopener"
              className="mt-1 inline-flex min-w-0 max-w-full items-center gap-1 text-xs text-gold underline-offset-2 hover:underline"
            >
              <span className="truncate">{canonicalUrl}</span>
              <ExternalLink className="size-3 shrink-0" aria-hidden="true" />
            </a>
          ) : (
            <p className="mt-1 text-xs text-muted-foreground">Source post link unavailable.</p>
          )}
        </div>
        <div className="flex shrink-0 flex-wrap items-center gap-1.5">
          <StatusBadge tone={missionStatusTone(mission.status)}>
            <span>{mission.status}</span>
          </StatusBadge>
          <StatusBadge tone={active && !remaining.expired ? "gold" : "muted"}>
            <span>{remaining.label}</span>
          </StatusBadge>
        </div>
      </div>

      <dl className="mt-3 grid min-w-0 grid-cols-2 gap-2 sm:grid-cols-3">
        <div className="surface-quiet min-w-0 rounded-md p-2.5">
          <dt className="type-eyebrow text-muted-foreground">Started</dt>
          <dd className="mt-1 truncate text-xs text-foreground">
            {formatMissionTime(mission.started_at)}
          </dd>
        </div>
        <div className="surface-quiet min-w-0 rounded-md p-2.5">
          <dt className="type-eyebrow text-muted-foreground">Ends</dt>
          <dd className="mt-1 truncate text-xs text-foreground">
            {formatMissionTime(mission.ends_at)}
          </dd>
        </div>
        <div className="surface-quiet min-w-0 rounded-md p-2.5">
          <dt className="type-eyebrow text-muted-foreground">Completed</dt>
          <dd className="mt-1 truncate text-xs text-foreground">
            {formatMissionTime(mission.completed_at)}
          </dd>
        </div>
      </dl>

      <div className="mt-3 space-y-2">
        <p className="type-eyebrow text-muted-foreground">Community target</p>
        {targets.length === 0 ? (
          <p className="text-xs text-muted-foreground">No target recorded for this mission.</p>
        ) : (
          targets.map((target) => (
            <div
              key={target.id}
              className="flex min-w-0 flex-wrap items-center justify-between gap-2 rounded-md border border-border/50 bg-background/30 px-2.5 py-2"
            >
              <span className="min-w-0 truncate text-xs text-foreground">
                {target.groupTitle ?? `Chat ${target.telegram_chat_id}`}
              </span>
              <span className="flex shrink-0 items-center gap-1.5">
                <StatusBadge tone={deliveryTone(target.delivery_state)}>
                  <span>Delivery {target.delivery_state}</span>
                </StatusBadge>
                <StatusBadge tone={deliveryTone(target.edit_state)}>
                  <span>Edit {target.edit_state}</span>
                </StatusBadge>
              </span>
            </div>
          ))
        )}
      </div>

      {scheduleEvents.length > 0 ? (
        <div className="mt-3 space-y-2">
          <p className="type-eyebrow text-muted-foreground">Schedule timeline</p>
          <ul className="space-y-1.5">
            {scheduleEvents.map((event) => (
              <TimelineRow
                key={event.id}
                label={`${event.event_type} · #${event.sequence_no}`}
                state={event.state}
                due={formatMissionTime(event.due_at)}
              />
            ))}
          </ul>
        </div>
      ) : null}

      {latestSnapshot ? (
        <div className="mt-3">
          <p className="type-eyebrow text-muted-foreground">
            Last stored metrics · {formatMissionTime(latestSnapshot.observed_at)}
          </p>
          <dl className="mt-1.5 grid grid-cols-3 gap-2 sm:grid-cols-5">
            {(
              [
                ["Views", latestSnapshot.views],
                ["Likes", latestSnapshot.likes],
                ["Comments", latestSnapshot.comments],
                ["Shares", latestSnapshot.shares],
                ["Saves", latestSnapshot.saves],
              ] as const
            ).map(([label, value]) => (
              <div key={label} className="surface-quiet min-w-0 rounded-md p-2">
                <dt className="type-eyebrow text-muted-foreground">{label}</dt>
                <dd className="mt-1 truncate text-xs text-foreground">{formatMetric(value)}</dd>
              </div>
            ))}
          </dl>
          <p className="mt-1.5 text-[11px] leading-relaxed text-muted-foreground">
            Stored values only. A dash means the metric is unknown, not zero.
          </p>
        </div>
      ) : null}
    </article>
  );
}

export function SocialMissionsPanel({ workspaceId }: { workspaceId: string | null }) {
  const query = useWorkspaceMissions(workspaceId);
  const views = query.data ?? [];

  return (
    <div className="flex min-w-0 flex-col gap-4 sm:gap-6">
      <Section
        variant="primary"
        title="Social Missions"
        leading={<Radar className="size-4" aria-hidden="true" />}
        description="Live and past missions for this workspace, reported from stored state. This view is read-only."
        actions={<StatusBadge tone="muted">Read-only</StatusBadge>}
      >
        <GuidanceCard />
      </Section>

      <Section variant="surface" title="Missions">
        {query.isPending ? (
          <p className="flex items-center gap-2 text-xs text-muted-foreground">
            <Loader2 className="size-4 animate-spin text-gold" aria-hidden="true" />
            Loading missions…
          </p>
        ) : query.isError ? (
          <div className="space-y-2">
            <p className="flex items-center gap-2 text-xs text-muted-foreground">
              <AlertTriangle className="size-4 text-signal" aria-hidden="true" />
              Missions could not be loaded. This is not a confirmation that there are none.
            </p>
            <Button variant="outline" size="sm" className="min-h-11" onClick={() => void query.refetch()}>
              Retry
            </Button>
          </div>
        ) : views.length === 0 ? (
          <EmptyState
            icon={Target}
            title="No missions yet"
            description="Start one from your connected Telegram community with /mission followed by the X post link."
            compact
          />
        ) : (
          <div className="flex min-w-0 flex-col gap-3">
            {views.map((view) => (
              <MissionCard key={view.mission.id} view={view} />
            ))}
          </div>
        )}
      </Section>
    </div>
  );
}

/** Compact Overview strip. Same read-only query, no controls. */
export function SocialMissionsSummary({
  workspaceId,
  onOpenMissions,
}: {
  workspaceId: string | null;
  onOpenMissions: () => void;
}) {
  const query = useWorkspaceMissions(workspaceId);
  const views = query.data ?? [];
  const rollup = rollupMissions(views);
  const activeView = views.find((v) => isMissionActive(v.mission)) ?? null;
  const remaining = activeView ? missionTimeRemaining(activeView.mission) : null;

  const description = query.isPending
    ? "Loading mission state…"
    : query.isError
      ? "Mission state could not be loaded right now."
      : rollup.total === 0
        ? "No missions have been started in this workspace yet."
        : activeView
          ? `One mission is live · ${remaining?.label ?? ""}`.trim()
          : `${rollup.completed} completed · no mission is live right now.`;

  return (
    <Section
      variant="surface"
      title="Social Missions"
      leading={<Radar className="size-4" aria-hidden="true" />}
      description={description}
      actions={
        <StatusBadge tone={activeView ? "green" : "muted"}>
          <span>{activeView ? "Live" : "Idle"}</span>
        </StatusBadge>
      }
    >
      <div className="flex flex-wrap items-center gap-2">
        <Button size="sm" variant="outline" className="min-h-11" onClick={onOpenMissions}>
          Open Missions
        </Button>
        <span className="text-xs text-muted-foreground">
          Start with <code className="text-foreground">/mission &lt;X link&gt;</code> in Telegram.
        </span>
      </div>
    </Section>
  );
}
