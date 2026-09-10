import { Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { ArrowRight, Check, CircleDot, Circle, Loader2, RefreshCw, ShieldCheck } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Section } from "@/components/cartel/Section";
import { StatusBadge } from "@/components/cartel/StatusBadge";
import {
  fetchLaunchReadiness,
  launchReadinessQueryKey,
  type LaunchReadiness,
} from "@/lib/launch-readiness";
import { cn } from "@/lib/utils";

/**
 * Phase 5.5 — shared guided-setup UI.
 *
 * One query, one derived model. Every surface renders the same next action so
 * the operator never sees two different interpretations of "what's next".
 * This is a recommended path, not a locked wizard: nothing here blocks
 * navigation or any existing control.
 */

export function useLaunchReadiness(workspaceId: string | null | undefined) {
  return useQuery({
    queryKey: launchReadinessQueryKey(workspaceId),
    enabled: !!workspaceId,
    queryFn: () => fetchLaunchReadiness(workspaceId!),
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
      aria-label={`Launch readiness: ${value} of ${total} steps complete`}
      className="h-2 w-full overflow-hidden rounded-full border border-border/70 bg-surface-raised"
    >
      <div
        className={cn(
          "h-full rounded-full transition-all",
          value === total ? "bg-pepe" : "bg-gold",
        )}
        style={{ width: `${pct}%` }}
      />
    </div>
  );
}

function NextStepBlock({
  readiness,
  compact,
}: {
  readiness: LaunchReadiness;
  compact?: boolean;
}) {
  const { nextAction, allComplete } = readiness;
  return (
    <div
      className={cn(
        "min-w-0 rounded-lg border p-3 sm:p-4",
        allComplete ? "border-pepe/40 bg-pepe/5" : "border-gold/40 bg-gold/5",
      )}
    >
      <div className="flex min-w-0 flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="min-w-0">
          <p
            className={cn(
              "text-[10px] font-semibold uppercase tracking-[0.2em]",
              allComplete ? "text-pepe" : "text-gold",
            )}
          >
            {allComplete ? "Ready" : "Next step"}
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

function StepRow({
  step,
  isNext,
}: {
  step: LaunchReadiness["steps"][number];
  isNext: boolean;
}) {
  const Icon = step.complete ? Check : isNext ? CircleDot : Circle;
  return (
    <li
      className={cn(
        "flex min-w-0 items-start gap-2.5 rounded-md border px-3 py-2.5",
        step.complete
          ? "border-pepe/30 bg-pepe/5"
          : isNext
            ? "border-gold/40 bg-gold/5"
            : "border-border/60 bg-surface-raised/40",
      )}
    >
      <span
        className={cn(
          "mt-0.5 flex size-5 shrink-0 items-center justify-center rounded-full border",
          step.complete
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
          {step.order}. {step.title}
        </span>
        <span className="mt-0.5 block text-xs leading-relaxed text-muted-foreground [overflow-wrap:anywhere]">
          {step.description}
        </span>
      </span>
      <span className="shrink-0">
        {step.complete ? (
          <StatusBadge tone="green">
            <span>Done</span>
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
    <Section
      variant="surface"
      title={compact ? undefined : "Launch readiness"}
      className="min-w-0"
    >
      <div className="flex min-w-0 flex-wrap items-center gap-3">
        <p className="min-w-0 flex-1 text-xs leading-relaxed text-muted-foreground sm:text-sm">
          Could not load your setup progress. {message}
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

/** Full guided panel for the HQ dashboard. */
export function LaunchReadinessPanel({ workspaceId, workspaceName }: SharedProps) {
  const query = useLaunchReadiness(workspaceId);

  if (!workspaceId) return null;

  if (query.isPending) {
    return (
      <Section variant="primary" title="Launch readiness" className="rise-in min-w-0">
        <p className="flex items-center gap-2 text-sm text-muted-foreground">
          <Loader2 className="size-4 animate-spin" aria-hidden="true" />
          Checking your setup…
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

  const readiness = query.data!;
  const nextKey = readiness.nextAction.step?.key ?? null;
  const heading = readiness.projectName
    ? `Get ${readiness.projectName} launch-ready`
    : workspaceName
      ? `Get ${workspaceName} launch-ready`
      : "Get launch-ready";

  if (readiness.allComplete) {
    return (
      <Section
        variant="surface"
        className="rise-in min-w-0"
        title="Launch foundation ready"
        leading={<Check className="size-5 text-pepe" aria-hidden="true" />}
        actions={
          <StatusBadge tone="green">
            <span>
              {readiness.completedCount} of {readiness.totalCount} complete
            </span>
          </StatusBadge>
        }
        contentClassName="space-y-3"
      >
        <p className="text-sm text-muted-foreground">
          Project, launch, Launch Watch and community welcome are ready.
        </p>
        <Button asChild size="sm" className="min-h-11">
          <Link to={readiness.nextAction.to}>
            {readiness.nextAction.label}
            <ArrowRight className="size-4" aria-hidden="true" />
          </Link>
        </Button>
      </Section>
    );
  }

  return (
    <Section
      variant="primary"
      className="rise-in min-w-0"
      title={heading}
      description="A recommended path, not a locked wizard. You can use any part of CARTEL HQ at any time."
      leading={<ShieldCheck className="size-5" aria-hidden="true" />}
      actions={
        <StatusBadge tone="gold">
          <span>
            {readiness.completedCount} of {readiness.totalCount} complete
          </span>
        </StatusBadge>
      }
      contentClassName="space-y-4"
    >
      <ProgressBar value={readiness.completedCount} total={readiness.totalCount} />
      <NextStepBlock readiness={readiness} />
      <ul className="grid gap-2 sm:grid-cols-2 [&>*]:min-w-0">
        {readiness.steps.map((step) => (
          <StepRow key={step.key} step={step} isNext={step.key === nextKey} />
        ))}
      </ul>
    </Section>
  );
}

/**
 * Compact callout for Project Profile, Launch Control and Community Command.
 *
 * P1-A: this now renders the unified project journey model so every surface
 * shows the same next action as the HQ dashboard. The wrapper is kept so the
 * existing call sites and their props stay untouched.
 */
export function LaunchReadinessCallout({
  workspaceId,
  workspaceName,
  title = "Guided setup",
}: SharedProps & { title?: string }) {
  return (
    <ProjectJourneyCallout
      workspaceId={workspaceId}
      workspaceName={workspaceName}
      title={title}
    />
  );
}

