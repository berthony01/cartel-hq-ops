import { useState } from "react";
import { Check, ChevronDown, Circle, CircleDot, Loader2, Lock, RefreshCw } from "lucide-react";

import { Button, buttonVariants } from "@/components/ui/button";
import {
  JourneyLink,
  journeyStageGuidance,
  useProjectJourney,
} from "@/components/cartel/ProjectJourney";
import { StatusBadge } from "@/components/cartel/StatusBadge";
import type { JourneyStage } from "@/lib/project-journey";
import { cn } from "@/lib/utils";

function reviewLabel(stage: JourneyStage) {
  return stage.reviewLabel ?? `Review ${stage.title}`;
}

function JourneyRow({
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
        "grid min-w-0 grid-cols-[auto_minmax(0,1fr)] gap-x-3 gap-y-2 border-b border-border-subtle py-3 last:border-b-0 sm:grid-cols-[auto_minmax(0,1fr)_auto]",
        isNext && "border-gold/30 bg-gold/5 px-3",
      )}
    >
      <span
        className={cn(
          "mt-0.5 flex size-6 shrink-0 items-center justify-center rounded-full border",
          complete
            ? "border-pepe/45 text-pepe"
            : isNext
              ? "border-gold/55 text-gold"
              : "border-border-strong text-muted-foreground",
        )}
      >
        <Icon className="size-3.5" aria-hidden="true" />
      </span>
      <span className="min-w-0">
        <span className="block text-sm font-semibold text-foreground [overflow-wrap:anywhere]">
          {stage.order}. {stage.title}
        </span>
        {!complete ? (
          <span className="mt-1 block text-xs leading-relaxed text-muted-foreground [overflow-wrap:anywhere]">
             {blocked ? journeyStageGuidance(stage) : stage.detail ?? stage.description}
          </span>
        ) : null}
      </span>
      <span className="col-start-2 flex min-w-0 flex-col items-start gap-2 sm:col-start-3 sm:row-start-1 sm:items-end">
        <StatusBadge tone={complete ? "green" : isNext ? "gold" : "muted"}>
          {complete
            ? "Done"
            : stage.status === "unavailable"
              ? "Unavailable"
              : stage.status === "waiting"
                ? "Blocked"
                : isNext
                  ? "Next"
                  : "Later"}
        </StatusBadge>
        {!complete && !isNext ? (
          <JourneyLink
            stage={stage}
            primaryLaunchId={primaryLaunchId}
            label={blocked ? reviewLabel(stage) : "Open"}
            linkClassName={cn(
              buttonVariants({ variant: "ghost", size: "sm" }),
              "min-h-11 max-w-full min-w-0 justify-start whitespace-normal text-left text-muted-foreground [overflow-wrap:anywhere] sm:justify-center",
            )}
          />
        ) : null}
      </span>
    </li>
  );
}

export function DashboardJourney({
  workspaceId,
}: {
  workspaceId: string;
}) {
  const query = useProjectJourney(workspaceId);
  const [showCompleted, setShowCompleted] = useState(false);

  if (query.isPending) {
    return (
      <div className="flex min-h-40 items-center gap-2 text-sm text-muted-foreground">
        <Loader2 className="size-4 animate-spin" aria-hidden="true" />
        Checking project journey…
      </div>
    );
  }

  if (query.isError) {
    return (
      <div className="flex min-h-40 flex-col items-start justify-center gap-3">
        <p className="text-sm text-muted-foreground">Project journey is unavailable right now.</p>
        <Button size="sm" variant="outline" className="min-h-11" onClick={() => void query.refetch()}>
          <RefreshCw className="size-4" aria-hidden="true" />
          Retry
        </Button>
      </div>
    );
  }

  const journey = query.data;
  const complete = journey.stages.filter((stage) => stage.status === "complete");
  const remaining = journey.stages.filter((stage) => stage.status !== "complete");
  const nextKey = journey.nextAction.stage?.key ?? null;

  return (
    <div className="min-w-0">
      {complete.length > 0 ? (
        <div className="mb-2 border-b border-border-subtle pb-2">
          <Button
            type="button"
            variant="ghost"
            className="min-h-11 w-full justify-between px-1 text-muted-foreground"
            aria-expanded={showCompleted}
            aria-controls="dashboard-completed-stages"
            onClick={() => setShowCompleted((value) => !value)}
          >
            <span>{complete.length} completed {complete.length === 1 ? "stage" : "stages"}</span>
            <ChevronDown className={cn("size-4 transition-transform", showCompleted && "rotate-180")} aria-hidden="true" />
          </Button>
          {showCompleted ? (
            <ul id="dashboard-completed-stages" className="mt-1">
              {complete.map((stage) => (
                <JourneyRow key={stage.key} stage={stage} isNext={false} primaryLaunchId={journey.primaryLaunchId} />
              ))}
            </ul>
          ) : null}
        </div>
      ) : null}
      {remaining.length > 0 ? (
        <ul>
          {remaining.map((stage) => (
            <JourneyRow
              key={stage.key}
              stage={stage}
              isNext={stage.key === nextKey}
              primaryLaunchId={journey.primaryLaunchId}
            />
          ))}
        </ul>
      ) : (
        <div className="flex min-h-40 items-center gap-3 text-sm text-foreground">
          <Check className="size-5 text-pepe" aria-hidden="true" />
          Every project journey stage is complete.
        </div>
      )}
    </div>
  );
}