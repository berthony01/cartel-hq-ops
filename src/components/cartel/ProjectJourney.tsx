import { useState } from "react";
import { Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import {
  ArrowRight,
  Check,
  Circle,
  CircleDot,
  Loader2,
  Lock,
  RefreshCw,
  ShieldCheck,
  Target,
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

export function ProjectJourneyProgress({ value, total }: { value: number; total: number }) {
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

export function JourneyLink({
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

export function journeyStageGuidance(stage: JourneyStage): string {
  if (stage.status === "unavailable") {
    const state = stage.detail ?? "Current state could not be verified. Review the destination before continuing.";
    return stage.dependency && stage.dependency !== state ? `${state} ${stage.dependency}` : state;
  }
  if (stage.status === "waiting") {
    if (stage.dependency && stage.detail && stage.dependency !== stage.detail) {
      return `${stage.dependency} ${stage.detail}`;
    }
    return stage.dependency ?? stage.detail ?? "Complete the required earlier stage before this becomes available.";
  }
  if (stage.detail) return stage.detail;
  if (stage.dependency) return stage.dependency;
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
  const StateIcon = allComplete ? Check : blocked ? Lock : Target;
  const explanation =
    blocked && blockedStage ? journeyStageGuidance(blockedStage) : nextAction.explanation;
  return (
    <div
      className={cn(
        "min-w-0 rounded-lg border p-4 sm:p-5",
        allComplete
          ? "border-pepe/45 bg-pepe/5"
          : blocked
            ? "border-border-strong bg-surface-raised/60"
            : "border-gold/55 bg-gold/10 shadow-[var(--glow-gold)]",
      )}
    >
      <div className="grid min-w-0 gap-4 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-center">
        <div className="flex min-w-0 items-start gap-3">
          <span
            className={cn(
              "flex size-9 shrink-0 items-center justify-center rounded-md border",
              allComplete
                ? "border-pepe/45 bg-pepe/10 text-pepe"
                : blocked
                  ? "border-border-strong bg-background/50 text-muted-foreground"
                  : "border-gold/45 bg-gold/10 text-gold",
            )}
          >
            <StateIcon className="size-5" aria-hidden="true" />
          </span>
          <div className="min-w-0">
            <p
              className={cn(
                "text-[11px] font-bold uppercase tracking-[0.18em]",
                allComplete ? "text-pepe" : blocked ? "text-muted-foreground" : "text-gold",
              )}
            >
              {allComplete ? "Status" : blocked ? "Blocked dependency" : "Next action"}
            </p>
            <p className="mt-1 text-base font-semibold leading-snug text-foreground [overflow-wrap:anywhere] sm:text-lg">
              {blocked && blockedStage ? blockedStage.title : nextAction.headline}
            </p>
            {compact ? null : (
              <p className="mt-1.5 max-w-prose text-xs leading-relaxed text-muted-foreground sm:text-sm">
                {explanation}
              </p>
            )}
          </div>
        </div>
        {activeStage ? (
          <Button
            asChild
            variant={blocked ? "outline" : "default"}
            className="min-h-11 w-full shrink-0 sm:w-auto"
          >
            <JourneyLink
              stage={activeStage}
              primaryLaunchId={journey.primaryLaunchId}
              label={blocked ? reviewLabel(activeStage) : activeStage.actionLabel}
            />
          </Button>
        ) : null}
      </div>
      {compact ? (
        <p className="mt-2.5 text-xs leading-relaxed text-muted-foreground">{explanation}</p>
      ) : null}
    </div>
  );
}

/** Truthful review wording. A blocked stage is never described as doable now. */
function reviewLabel(stage: JourneyStage): string {
  if (stage.reviewLabel) return stage.reviewLabel;
  if (stage.key === "deployment") return "Review deployment evidence";
  return `Review ${stage.title}`;
}

function isLockedLaunchMilestone(stage: JourneyStage): boolean {
  return (
    (stage.status === "waiting" || stage.status === "unavailable") &&
    (stage.key === "official_contract" || stage.key === "launch_live")
  );
}

/** Dedicated presentation for the two locked final launch milestones. */
function LockedLaunchMilestoneCard({
  stage,
  primaryLaunchId,
}: {
  stage: JourneyStage;
  primaryLaunchId: string | null;
}) {
  return (
    <li className="w-full min-w-0 overflow-hidden rounded-lg border border-border-strong bg-surface-raised/80 shadow-sm">
      <div className="grid min-w-0 grid-cols-[auto_minmax(0,1fr)] items-start gap-4 px-4 py-5 sm:gap-5 sm:px-5 sm:py-6">
        <span className="flex size-12 shrink-0 items-center justify-center rounded-md border border-border-strong bg-surface-overlay text-foreground/80 shadow-sm">
          <Lock className="size-5" aria-hidden="true" />
        </span>
        <div className="min-w-0">
          <p className="text-[11px] font-bold uppercase tracking-[0.18em] text-muted-foreground">
            Launch milestone {stage.order}
          </p>
          <p className="mt-1 text-lg font-semibold leading-snug text-foreground [overflow-wrap:anywhere] sm:text-xl">
            {stage.order}. {stage.title}
          </p>
          <div className="mt-4 border-l-2 border-border-strong pl-3 sm:pl-4">
            <p className="max-w-2xl text-sm leading-relaxed text-muted-foreground [overflow-wrap:anywhere]">
              {journeyStageGuidance(stage)}
            </p>
          </div>
        </div>
      </div>
      <div className="grid min-w-0 gap-3 border-t border-border bg-surface-overlay/45 px-4 py-4 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-center sm:px-5">
        <div className="min-w-0">
          <StatusBadge tone="muted">
            <span>{stage.lockedLabel ?? "BLOCKED"}</span>
          </StatusBadge>
        </div>
        <Button
          asChild
          size="sm"
          variant="outline"
          className="min-h-11 w-full justify-center sm:w-auto"
        >
          <JourneyLink
            stage={stage}
            primaryLaunchId={primaryLaunchId}
            label={reviewLabel(stage)}
          />
        </Button>
      </div>
    </li>
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
  const Icon = complete ? Check : blocked ? Lock : isNext ? CircleDot : Circle;
  return (
    <li
      className={cn(
        "grid min-w-0 grid-cols-[auto_minmax(0,1fr)] items-start gap-x-3 gap-y-2.5 rounded-lg border transition-colors sm:grid-cols-[auto_minmax(0,1fr)_auto]",
        complete
          ? "border-pepe/25 bg-pepe/[0.04] px-3 py-2.5"
          : isNext
            ? "border-gold/55 bg-gold/10 px-3.5 py-4 shadow-[var(--glow-gold)] sm:col-span-2"
            : blocked
              ? "border-border/60 bg-surface-raised/30 px-3 py-3"
              : "border-border/50 bg-surface-raised/20 px-3 py-3",
      )}
    >
      <span
        className={cn(
          "mt-0.5 flex shrink-0 items-center justify-center border",
          isNext ? "size-7" : "size-5",
          "rounded-full",
          complete
            ? "border-pepe/50 text-pepe"
            : isNext
              ? "border-gold/60 bg-gold/10 text-gold"
              : "border-border text-muted-foreground",
        )}
      >
        <Icon
          className={isNext ? "size-4" : "size-3"}
          aria-hidden="true"
        />
      </span>
      <span className="min-w-0 flex-1">
        <span
          className={cn(
            "block font-medium text-foreground [overflow-wrap:anywhere]",
            isNext ? "text-base font-semibold" : "text-sm",
            complete ? "text-foreground/85" : undefined,
          )}
        >
          {stage.order}. {stage.title}
        </span>
        {complete ? null : (
          <span
            className={cn(
              "mt-1 block text-xs leading-relaxed text-muted-foreground [overflow-wrap:anywhere]",
            )}
          >
            {blocked ? journeyStageGuidance(stage) : stage.detail ?? stage.description}
          </span>
        )}
      </span>
      <span
        className={cn(
          "col-start-2 flex min-w-0 flex-col items-start gap-2 sm:col-start-3 sm:row-start-1 sm:items-end",
        )}
      >
        {complete ? (
          <StatusBadge tone="green">
            <span>DONE</span>
          </StatusBadge>
        ) : blocked ? (
          <StatusBadge tone="muted">
            <span>{stage.lockedLabel ?? "BLOCKED"}</span>
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
        {complete ? null : (
          <Button
            asChild
            size={isNext ? "default" : "sm"}
            variant={isNext ? "default" : blocked ? "outline" : "secondary"}
            className={cn(
              "min-h-11",
              blocked ? "w-auto self-start sm:self-end" : "w-full sm:w-auto",
            )}
          >
            <JourneyLink
              stage={stage}
              primaryLaunchId={primaryLaunchId}
              label={isNext ? stage.actionLabel : blocked ? reviewLabel(stage) : "Open"}
            />
          </Button>
        )}
      </span>
    </li>
  );
}


/**
 * Completed stages collapse into one summary row. Nothing about their status,
 * counts or routes changes — only how much of the page they occupy.
 */
function CompletedStages({
  stages,
  primaryLaunchId,
}: {
  stages: JourneyStage[];
  primaryLaunchId: string | null;
}) {
  const [open, setOpen] = useState(false);
  if (stages.length === 0) return null;
  return (
    <div className="min-w-0 rounded-lg border border-pepe/25 bg-pepe/[0.04]">
      <div className="grid min-w-0 grid-cols-[auto_minmax(0,1fr)_auto] items-center gap-3 px-3 py-2.5">
        <span className="flex size-6 shrink-0 items-center justify-center rounded-full border border-pepe/50 text-pepe">
          <Check className="size-3.5" aria-hidden="true" />
        </span>
        <p className="min-w-0 text-sm font-medium text-foreground/85 [overflow-wrap:anywhere]">
          {stages.length} setup and community {stages.length === 1 ? "stage" : "stages"} completed
        </p>
        <Button
          type="button"
          size="sm"
          variant="ghost"
          className="min-h-11 shrink-0"
          aria-expanded={open}
          aria-controls="journey-completed-stages"
          onClick={() => setOpen((prev) => !prev)}
        >
          {open ? "Hide completed steps" : "View completed steps"}
        </Button>
      </div>
      {open ? (
        <ul
          id="journey-completed-stages"
          className="grid gap-2 border-t border-pepe/20 p-3 sm:grid-cols-2 [&>*]:min-w-0"
        >
          {stages.map((stage) => (
            <StageRow
              key={stage.key}
              stage={stage}
              isNext={false}
              primaryLaunchId={primaryLaunchId}
            />
          ))}
        </ul>
      ) : null}
    </div>
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
  const completedStages = journey.stages.filter((stage) => stage.status === "complete");
  const remainingStages = journey.stages.filter((stage) => stage.status !== "complete");
  const remainingPhases = remainingStages
    .map((stage) => stage.phase)
    .filter((phase, index, all) => all.indexOf(phase) === index);
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
      <ProjectJourneyProgress value={journey.completedCount} total={journey.totalCount} />
      <NextActionBlock journey={journey} />
      <CompletedStages
        stages={completedStages}
        primaryLaunchId={journey.primaryLaunchId}
      />
      {remainingStages.length > 0 ? (
        <div className="space-y-3">
          {remainingPhases.map((phase) => (
            <div key={phase} className="space-y-2">
              <p className="text-[11px] font-bold uppercase tracking-[0.18em] text-muted-foreground">
                {phase === "Contract" ? "Contract & launch" : phase} phase
              </p>
              <ul className="grid gap-2 [&>*]:min-w-0">
                {remainingStages
                  .filter((stage) => stage.phase === phase)
                  .map((stage) =>
                    isLockedLaunchMilestone(stage) ? (
                      <LockedLaunchMilestoneCard
                        key={stage.key}
                        stage={stage}
                        primaryLaunchId={journey.primaryLaunchId}
                      />
                    ) : (
                      <StageRow
                        key={stage.key}
                        stage={stage}
                        isNext={stage.key === nextKey}
                        primaryLaunchId={journey.primaryLaunchId}
                      />
                    ),
                  )}
              </ul>
            </div>
          ))}
        </div>
      ) : null}
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
      <ProjectJourneyProgress value={journey.completedCount} total={journey.totalCount} />
      <NextActionBlock journey={journey} compact />
    </Section>
  );
}
