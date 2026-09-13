import { BarChart3 } from "lucide-react";
import { Section } from "@/components/cartel/Section";
import { StatusBadge } from "@/components/cartel/StatusBadge";
import { rollupMissions, useWorkspaceMissions } from "@/lib/social-missions";

/**
 * Step 1C — compact, read-only Analytics summary for the Community Command
 * Center. It renders ONLY counts derived from data the route already reads:
 * connected-community state and the read-only mission query. No new backend
 * object, no provider call, no polling, no mutation.
 */

function Metric({ label, value, hint }: { label: string; value: string; hint?: string }) {
  return (
    <div className="surface-quiet min-w-0 rounded-lg p-3">
      <dt className="type-eyebrow text-muted-foreground">{label}</dt>
      <dd className="mt-1.5 min-w-0 truncate font-display text-xl leading-none text-foreground">
        {value}
      </dd>
      {hint ? <p className="mt-1 truncate text-[11px] text-muted-foreground">{hint}</p> : null}
    </div>
  );
}

export function CommunityAnalyticsPanel({
  workspaceId,
  connectedGroupCount,
  readyGroupCount,
  groupsUnavailable,
}: {
  workspaceId: string | null;
  connectedGroupCount: number;
  readyGroupCount: number;
  groupsUnavailable: boolean;
}) {
  const query = useWorkspaceMissions(workspaceId);
  const rollup = rollupMissions(query.data ?? []);
  const missionsUnavailable = query.isError;
  const missionValue = (value: number) =>
    query.isPending ? "—" : missionsUnavailable ? "Unavailable" : String(value);
  const groupValue = (value: number) => (groupsUnavailable ? "Unavailable" : String(value));

  return (
    <div className="flex min-w-0 flex-col gap-4 sm:gap-6">
      <Section
        variant="primary"
        title="Analytics"
        leading={<BarChart3 className="size-4" aria-hidden="true" />}
        description="A read-only summary of current community and mission state. No historical reporting yet."
        actions={<StatusBadge tone="muted">Summary</StatusBadge>}
      >
        <dl className="grid min-w-0 grid-cols-2 gap-2.5 sm:grid-cols-4">
          <Metric label="Communities" value={groupValue(connectedGroupCount)} hint="Connected" />
          <Metric label="Ready" value={groupValue(readyGroupCount)} hint="Bot operational" />
          <Metric label="Missions live" value={missionValue(rollup.active)} />
          <Metric label="Missions completed" value={missionValue(rollup.completed)} />
        </dl>
      </Section>

      <Section
        variant="surface"
        title="Mission delivery health"
        description="Per-community card outcomes across the missions loaded above. An uncertain Telegram result is never reported as delivered."
      >
        <dl className="grid min-w-0 grid-cols-2 gap-2.5 sm:grid-cols-4">
          <Metric label="Sent" value={missionValue(rollup.deliverySent)} />
          <Metric label="Pending" value={missionValue(rollup.deliveryPending)} />
          <Metric label="Uncertain" value={missionValue(rollup.deliveryAmbiguous)} />
          <Metric label="Failed" value={missionValue(rollup.deliveryFailed)} />
        </dl>
        {missionsUnavailable ? (
          <p className="mt-2 text-xs leading-relaxed text-muted-foreground">
            Mission counts could not be loaded. This is not a confirmation that there are none.
          </p>
        ) : null}
      </Section>

      <p className="text-[11px] leading-relaxed text-muted-foreground">
        Launch Watch watcher aggregates stay in the Launch Watch tab, which owns the per-launch
        selection. Deeper reporting arrives in a later controlled phase.
      </p>
    </div>
  );
}
