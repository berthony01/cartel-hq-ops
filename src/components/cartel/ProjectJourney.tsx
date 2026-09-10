import { Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import {
  ArrowRight,
  Check,
  Circle,
  CircleDot,
  HelpCircle,
  Loader2,
  RefreshCw,
  ShieldCheck,
} from "lucide-react";

import { Button } from "@/components/ui/button";
import { Section } from "@/components/cartel/Section";
import { StatusBadge } from "@/components/cartel/StatusBadge";
import {
  fetchProjectJourney,
  projectJourneyQueryKey,
  type JourneyStage,
  type ProjectJourney,
} from "@/lib/project-journey";
import { cn } from "@/lib/utils";

/**
 * P1-A — one journey model, rendered everywhere.
 *
 * Presentation only. Nothing here writes, transitions, deploys, registers or
 * sends. Every surface reads the same derived model, so HQ and Launch Control
 * can never disagree about "what's next".
 */

export function useProjectJourney(workspaceId: string | null | undefined) {
  return useQuery({
    queryKey: projectJourneyQueryKey(workspaceId),
    enabled: !!workspaceId,
    queryFn: () => fetchProjectJourney(workspaceId!),
  });
}

function ProgressBar({ value, total }: { value: number; total: number }) {
  const pct = total > 0 ? Math.round((value / total) * 100) : 0;
  return (
    <div
      role="progressbar"
      aria-valuemin={0}
      aria-valuemax={total}
      aria-valuenow={value}
      aria-label={`Project journey: ${value} of ${total} stages complete`}
      className="h-2 w-full overflow-hidden rounded-full border border-border/70 bg-surface-raised"
    >
      <div
        className={cn("h-full rounded-full transition-all", value === total ? "bg-pepe" : "bg-gold")}
        style={{ width: `${pct}%` }}
      />
    </div>
  );
}

function NextActionBlock({
  journey,
  compact,
}: {
  journey: ProjectJourney;
  compact?: boolean;
}) {
  const { nextAction, allComplete } = journey;
  const done = allComplete || nextAction.stage === null;
  return (
    <div
      className={cn(
        "min-w-0 rounded-lg border p-3 sm:p-4",
        done ? "border-pepe/40 bg-pepe/5" : "border-gold/40 bg-gold/5",
      )}
    >
      <div className="flex min-w-0 flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="min-w-0">
          <p
            className={cn(
              "text-[10px] font-semibold uppercase tracking-[0.2em]",
              done ? "text-pepe" : "text-gold",
            )}
          >
            {done ? "Status" : "Next step"}
          </p>
          <p className="mt-1 text-sm font-semibold text-foreground [overflow-wrap:anywhere]">
            {nextAction.headline}
          </p>
          {compact ? null : (
            <p className="mt-1 max-w-prose text-xs leading-relaxed text-muted-foreground sm:text-sm">
              {nextAction.explanation}
            </p>
          )}
        </div>
        <Button asChild size="sm" className="min-h-11 shrink-0">
          <Link to={nextAction.to}>
            {nextAction.label}
            <ArrowRight className="size-4" aria-hidden="true" />
          </Link>
        </Button>
      </div>
      {compact ? (
        <p className="mt-2 text-xs leading-relaxed text-muted-foreground">
          {nextAction.explanation}
        </p>
      ) : null}
    </div>
  );
}

function StageRow({ stage, isNext }: { stage: JourneyStage; isNext: boolean }) {
  const complete = stage.status === "complete";
  const unavailable = stage.status === "unavailable";
  const Icon = complete ? Check : unavailable ? HelpCircle : isNext ? CircleDot : Circle;
  return (
    <li
      className={cn(
        "flex min-w-0 items-start gap-2.5 rounded-md border px-3 py-2.5",
        complete
          ? "border-pepe/30 bg-pepe/5"
          : isNext
            ? "border-gold/40 bg-gold/5"
            : "border-border/60 bg-surface-raised/40",
      )}
    >
      <span
        className={cn(
          "mt-0.5 flex size-5 shrink-0 items-center justify-center rounded-full border",
          complete
            ? "border-pepe/50 text-pepe"
            : isNext
              ? "border-gold/50 text-gold"
              : "border-border text-muted-foreground",
        )}
      >
        <Icon className="size-3" aria-hidden="true" />
      </span>
      <span className="min-w-0 flex-1">
        <span className="block text-sm font-medium text-foreground [overflow-wrap:anywhere]">
          {stage.order}. {stage.title}
        </span>
        <span className="mt-0.5 block text-xs leading-relaxed text-muted-foreground [overflow-wrap:anywhere]">
          {stage.detail ?? stage.description}
        </span>
      </span>
      <span className="shrink-0">
        {complete ? (
          <StatusBadge tone="green">
            <span>Done</span>
          </StatusBadge>
        ) : unavailable ? (
          <StatusBadge tone="muted">
            <span>Unknown</span>
          </StatusBadge>
        ) : isNext ? (
          <StatusBadge tone="gold">
            <span>Now</span>
          </StatusBadge>
        ) : (
          <StatusBadge tone="muted">
            <span>Later</span>
          </StatusBadge>
        )}
      </span>
    </li>
  );
}

function ErrorState({
  message,
  onRetry,
  compact,
}: {
  message: string;
  onRetry: () => void;
  compact?: boolean;
}) {
  return (
    <Section variant="surface" title={compact ? undefined : "Project journey"} className="min-w-0">
      <div className="flex min-w-0 flex-wrap items-center gap-3">
        <p className="min-w-0 flex-1 text-xs leading-relaxed text-muted-foreground sm:text-sm">
          Could not load your project journey. {message}
        </p>
        <Button size="sm" variant="outline" className="min-h-11 shrink-0" onClick={onRetry}>
          <RefreshCw className="size-4" aria-hidden="true" />
          Retry
        </Button>
      </div>
    </Section>
  );
}

type SharedProps = {
  workspaceId: string | null | undefined;
  workspaceName?: string | null;
};

/** Full journey card for the HQ dashboard. */
export function ProjectJourneyPanel({ workspaceId, workspaceName }: SharedProps) {
  const query = useProjectJourney(workspaceId);

  if (!workspaceId) return null;

  if (query.isPending) {
    return (
      <Section variant="primary" title="Project journey" className="rise-in min-w-0">
        <p className="flex items-center gap-2 text-sm text-muted-foreground">
          <Loader2 className="size-4 animate-spin" aria-hidden="true" />
          Checking your project…
        </p>
      </Section>
    );
  }

  if (query.isError) {
    return (
      <ErrorState
        message={(query.error as Error)?.message ?? "Unexpected error."}
        onRetry={() => void query.refetch()}
      />
    );
  }

  const journey = query.data!;
  const nextKey = journey.nextAction.stage?.key ?? null;
  const heading = journey.projectName
    ? `${journey.projectName} launch journey`
    : workspaceName
      ? `${workspaceName} launch journey`
      : "Project journey";

  return (
    <Section
      variant="primary"
      className="rise-in min-w-0"
      title={heading}
      description="Every stage is read from your real project state. It is a recommended path, not a locked wizard."
      leading={<ShieldCheck className="size-5" aria-hidden="true" />}
      actions={
        <StatusBadge tone={journey.allComplete ? "green" : "gold"}>
          <span>
            {journey.completedCount} of {journey.totalCount} complete
          </span>
        </StatusBadge>
      }
      contentClassName="space-y-4"
    >
      <ProgressBar value={journey.completedCount} total={journey.totalCount} />
      <NextActionBlock journey={journey} />
      <ul className="grid gap-2 sm:grid-cols-2 [&>*]:min-w-0">
        {journey.stages.map((stage) => (
          <StageRow key={stage.key} stage={stage} isNext={stage.key === nextKey} />
        ))}
      </ul>
    </Section>
  );
}

/** Compact callout for Project Profile, Launch Control and Community Command. */
export function ProjectJourneyCallout({
  workspaceId,
  title = "Guided setup",
}: SharedProps & { title?: string }) {
  const query = useProjectJourney(workspaceId);

  if (!workspaceId) return null;
  if (query.isPending) return null;

  if (query.isError) {
    return (
      <ErrorState
        compact
        message={(query.error as Error)?.message ?? "Unexpected error."}
        onRetry={() => void query.refetch()}
      />
    );
  }

  const journey = query.data!;
  if (journey.allComplete || journey.nextAction.stage === null) return null;

  return (
    <Section
      variant="surface"
      className="rise-in min-w-0"
      title={title}
      actions={
        <StatusBadge tone="gold">
          <span>
            {journey.completedCount} of {journey.totalCount} complete
          </span>
        </StatusBadge>
      }
      contentClassName="space-y-3"
    >
      <ProgressBar value={journey.completedCount} total={journey.totalCount} />
      <NextActionBlock journey={journey} compact />
    </Section>
  );
}
