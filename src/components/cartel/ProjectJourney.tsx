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
      className="h-1.5 w-full overflow-hidden rounded-full border border-border-subtle bg-surface-quiet"
    >
      <div
        className={cn("h-full rounded-full transition-all", value === total ? "bg-pepe" : "bg-gold")}
        style={{ width: `${pct}%` }}
      />
    </div>
  );
}

type LaunchControlSection =
  | "lc-overview"
  | "lc-details"
  | "lc-schedule"
  | "lc-watch"
  | "lc-comms"
  | "lc-contract";

const LAUNCH_SECTION_BY_STAGE: Partial<Record<JourneyStage["key"], LaunchControlSection>> = {
  launch_created: "lc-overview",
  launch_announced: "lc-overview",
  launch_schedule: "lc-schedule",
  launch_watch_open: "lc-watch",
  audience: "lc-watch",
  deployment: "lc-contract",
  official_contract: "lc-contract",
  launch_live: "lc-overview",
};

const TELEGRAM_TAB_BY_STAGE: Partial<
  Record<JourneyStage["key"], "communities" | "inbox">
> = {
  telegram_community: "communities",
  launch_welcome: "communities",
  communications: "inbox",
};

function JourneyLink({
  stage,
  primaryLaunchId,
  label,
}: {
  stage: JourneyStage;
  primaryLaunchId: string | null;
  label: string;
}) {
  const section = LAUNCH_SECTION_BY_STAGE[stage.key];
  if (stage.to === "/launch-control" && section) {
    const search = primaryLaunchId ? { launch: primaryLaunchId, section } : { section };
    return (
      <Link
        to="/launch-control"
        search={search}
        aria-label={`${label}: ${stage.title}`}
      >
        {label}
        <ArrowRight className="size-4" aria-hidden="true" />
      </Link>
    );
  }

  const tab = TELEGRAM_TAB_BY_STAGE[stage.key];
  if (stage.to === "/telegram" && tab) {
    return (
      <Link to="/telegram" search={{ tab }} aria-label={`${label}: ${stage.title}`}>
        {label}
        <ArrowRight className="size-4" aria-hidden="true" />
      </Link>
    );
  }

  return (
    <Link to={stage.to} aria-label={`${label}: ${stage.title}`}>
      {label}
      <ArrowRight className="size-4" aria-hidden="true" />
    </Link>
  );
}

function blockedGuidance(stage: JourneyStage): string {
  if (stage.detail) return stage.detail;
  if (stage.status === "unavailable") {
    return "Current state could not be verified. Review the destination before continuing.";
  }
  return "Complete the required earlier stage before this becomes available.";
}

function NextActionBlock({
  journey,
  compact,
}: {
  journey: ProjectJourney;
  compact?: boolean;
}) {
  const { nextAction, allComplete } = journey;
  const blockedStage = journey.stages.find((stage) => stage.status !== "complete") ?? null;
  const activeStage = nextAction.stage ?? blockedStage;
  const blocked = !allComplete && nextAction.stage === null && blockedStage !== null;
  return (
    <div
      className={cn(
        "min-w-0 rounded-md border p-3.5 sm:p-4",
        allComplete
          ? "border-pepe/40 bg-pepe/5"
          : blocked
            ? "border-border-strong bg-surface-raised/60"
            : "border-gold/40 bg-gold/5",
      )}
    >
      <div className="grid min-w-0 gap-3 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-center">
        <div className="min-w-0">
          <p
            className={cn(
              "type-eyebrow",
              allComplete ? "text-pepe" : blocked ? "text-muted-foreground" : "text-gold",
            )}
          >
            {allComplete ? "Status" : blocked ? "Blocked dependency" : "Continue setup"}
          </p>
          <p className="mt-1 text-sm font-semibold text-foreground [overflow-wrap:anywhere]">
            {blocked && blockedStage ? blockedStage.title : nextAction.headline}
          </p>
          {compact ? null : (
            <p className="mt-1 max-w-prose text-xs leading-relaxed text-muted-foreground sm:text-sm">
              {blocked && blockedStage ? blockedGuidance(blockedStage) : nextAction.explanation}
            </p>
          )}
        </div>
        {activeStage ? (
          <Button
            asChild
            size="sm"
            variant={blocked ? "outline" : "default"}
            className="min-h-11 w-full shrink-0 sm:w-auto"
          >
            <JourneyLink
              stage={activeStage}
              primaryLaunchId={journey.primaryLaunchId}
              label={blocked ? `Review ${activeStage.title}` : activeStage.actionLabel}
            />
          </Button>
        ) : null}
      </div>
      {compact ? (
        <p className="mt-2 text-xs leading-relaxed text-muted-foreground">
          {blocked && blockedStage ? blockedGuidance(blockedStage) : nextAction.explanation}
        </p>
      ) : null}
    </div>
  );
}

function StageRow({
  stage,
  isNext,
  primaryLaunchId,
}: {
  stage: JourneyStage;
  isNext: boolean;
  primaryLaunchId: string | null;
}) {
  const complete = stage.status === "complete";
  const blocked = stage.status === "waiting" || stage.status === "unavailable";
  const later = stage.status === "action" && !isNext;
  const Icon = complete ? Check : blocked ? HelpCircle : isNext ? CircleDot : Circle;
  const secondaryLabel = stage.key === "deployment" ? "Review evidence" : "View";
  return (
    <li
      className={cn(
        "grid min-w-0 grid-cols-[auto_minmax(0,1fr)] items-start gap-x-2.5 gap-y-2 rounded-md border px-3 py-3 sm:grid-cols-[auto_minmax(0,1fr)_auto]",
        complete
          ? "border-pepe/30 bg-pepe/5"
          : isNext
            ? "border-gold/55 bg-gold/10 shadow-[var(--glow-gold)]"
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
          {blocked ? blockedGuidance(stage) : stage.detail ?? stage.description}
        </span>
      </span>
      <span className="col-start-2 flex min-w-0 flex-col items-start gap-2 sm:col-start-3 sm:row-start-1 sm:items-end">
        {complete ? (
          <StatusBadge tone="green">
            <span>DONE</span>
          </StatusBadge>
        ) : blocked ? (
          <StatusBadge tone="muted">
            <span>BLOCKED</span>
          </StatusBadge>
        ) : isNext ? (
          <StatusBadge tone="gold">
            <span>NEXT</span>
          </StatusBadge>
        ) : (
          <StatusBadge tone="muted">
            <span>LATER</span>
          </StatusBadge>
        )}
        {!complete ? (
          <Button
            asChild
            size="sm"
            variant={isNext ? "default" : "outline"}
            className={cn("min-h-11 w-full sm:w-auto", later || blocked ? "text-xs" : "")}
          >
            <JourneyLink
              stage={stage}
              primaryLaunchId={primaryLaunchId}
              label={isNext ? stage.actionLabel : secondaryLabel}
            />
          </Button>
        ) : null}
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
       className="rise-in min-w-0 border-gold/20"
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
      contentClassName="space-y-5"
    >
      <ProgressBar value={journey.completedCount} total={journey.totalCount} />
      <NextActionBlock journey={journey} />
      <ul className="grid gap-2 sm:grid-cols-2 [&>*]:min-w-0">
        {journey.stages.map((stage) => (
          <StageRow
            key={stage.key}
            stage={stage}
            isNext={stage.key === nextKey}
            primaryLaunchId={journey.primaryLaunchId}
          />
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
