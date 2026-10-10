import { useEffect, useState } from "react";
import { createFileRoute, Link } from "@tanstack/react-router";
import {
  ArrowRight,
  Check,
  ChevronLeft,
  Loader2,
  RefreshCw,
  Rocket,
} from "lucide-react";

import { useWorkspace } from "@/lib/workspace-context";
import { useSession } from "@/hooks/useSession";
import {
  useOnboardingProgress,
  type OnboardingProgress,
} from "@/lib/onboarding";
import {
  PROJECT_GOAL_OPTIONS,
  useSetWorkspaceGoal,
  useWorkspaceGoal,
  type ProjectGoal,
} from "@/lib/workspace-goal";
import { PageHeader } from "@/components/cartel/PageHeader";
import { Section } from "@/components/cartel/Section";
import { StatusBadge } from "@/components/cartel/StatusBadge";
import { Button, buttonVariants } from "@/components/ui/button";
import { cn } from "@/lib/utils";

export const Route = createFileRoute("/_authenticated/onboarding")({
  head: () => ({
    meta: [
      { title: "Guided setup — CARTEL HQ" },
      {
        name: "description",
        content:
          "Guided setup for a Cartel HQ project: choose your goal, then follow identity, community and launch steps that fit it.",
      },
    ],
  }),
  component: OnboardingPage,
});

function StepRail({
  progress,
  activeIndex,
  onSelect,
}: {
  progress: OnboardingProgress;
  activeIndex: number;
  onSelect: (index: number) => void;
}) {
  const total = progress.stepDefs.length;
  return (
    <ol
      className={cn("grid grid-cols-2 gap-2", total === 4 ? "sm:grid-cols-4" : "sm:grid-cols-3")}
      aria-label="Setup steps"
    >
      {progress.stepDefs.map((step, index) => {
        // Done is per step, never inferred from a count of out-of-order steps.
        const done = step.key !== "review" && progress.steps[index]?.complete === true;
        const current = index === activeIndex;
        const reachable = done || current || index < activeIndex;
        return (
          <li key={step.key}>
            <button
              type="button"
              onClick={() => onSelect(index)}
              disabled={!reachable}
              className={cn(
                "flex w-full min-h-16 items-center gap-3 border px-4 py-3 text-left transition-colors",
                current
                  ? "border-gold/50 bg-gold/5"
                  : reachable
                    ? "border-border-subtle bg-surface hover:border-gold/30"
                    : "cursor-not-allowed border-border-subtle bg-surface opacity-50",
              )}
              aria-current={current ? "step" : undefined}
            >
              <span
                className={cn(
                  "flex size-8 shrink-0 items-center justify-center rounded-full border text-sm font-semibold",
                  done
                    ? "border-pepe/50 text-pepe"
                    : current
                      ? "border-gold/60 text-gold"
                      : "border-border-strong text-muted-foreground",
                )}
              >
                {done ? (
                  <Check className="size-4" aria-hidden="true" />
                ) : (
                  <span aria-hidden="true">{index + 1}</span>
                )}
              </span>
              <span className="min-w-0">
                <span className="block truncate text-sm font-semibold text-foreground">
                  {step.title}
                </span>
                <span className="type-meta block text-muted-foreground">
                  Step {index + 1} of {total}
                </span>
              </span>
            </button>
          </li>
        );
      })}
    </ol>
  );
}

function GoalChooser({
  workspaceId,
  isOwner,
  current,
  onCancel,
  onUseStandard,
}: {
  workspaceId: string;
  isOwner: boolean;
  current: ProjectGoal | null;
  onCancel?: () => void;
  onUseStandard?: () => void;
}) {
  const setGoal = useSetWorkspaceGoal(workspaceId);
  return (
    <Section
      variant="surface"
      className="rise-in border-gold/40"
      title="What do you want to do with this project?"
      description="This only changes which setup steps the guide shows. It does not unlock or launch anything, and you can change it later."
    >
      <div className="space-y-4">
        <div className="grid gap-2 sm:grid-cols-3">
          {PROJECT_GOAL_OPTIONS.map((option) => (
            <button
              key={option.value}
              type="button"
              disabled={!isOwner || setGoal.isPending}
              onClick={() => setGoal.mutate(option.value, { onSuccess: () => onCancel?.() })}
              className={cn(
                "flex min-h-24 flex-col items-start gap-1 border px-4 py-3 text-left transition-colors disabled:cursor-not-allowed disabled:opacity-60",
                current === option.value
                  ? "border-gold/60 bg-gold/5"
                  : "border-border-subtle bg-surface hover:border-gold/30",
              )}
              aria-pressed={current === option.value}
            >
              <span className="text-sm font-semibold text-foreground">{option.label}</span>
              <span className="text-xs leading-relaxed text-muted-foreground">
                {option.description}
              </span>
            </button>
          ))}
        </div>
        {!isOwner ? (
          <p className="text-xs leading-relaxed text-muted-foreground">
            Only the project owner can choose the project goal.
          </p>
        ) : null}
        {setGoal.isError ? (
          <p className="text-xs leading-relaxed text-signal" role="alert">
            {setGoal.error instanceof Error ? setGoal.error.message : "The goal could not be saved."}
          </p>
        ) : null}
        <div className="flex flex-wrap items-center gap-2">
          {setGoal.isPending ? (
            <span className="flex items-center gap-2 text-xs text-muted-foreground">
              <Loader2 className="size-4 animate-spin text-gold" aria-hidden="true" />
              Saving…
            </span>
          ) : null}
          {onCancel ? (
            <Button variant="outline" className="min-h-11" onClick={onCancel}>
              Keep current goal
            </Button>
          ) : null}
          {onUseStandard ? (
            <Button variant="ghost" className="min-h-11" onClick={onUseStandard}>
              Continue with the standard guide for now
            </Button>
          ) : null}
        </div>
      </div>
    </Section>
  );
}

function OnboardingPage() {
  const { workspace, workspaceId, loading: workspaceLoading } = useWorkspace();
  const { user } = useSession();
  const goalQuery = useWorkspaceGoal(workspaceId);
  const goal = goalQuery.data ?? null;
  const isOwner =
    !!workspace && workspace.access !== "managed" && !!user && workspace.owner_id === user.id;

  // Session-only: viewing the standard guide never records a choice.
  const [standardFor, setStandardFor] = useState<string | null>(null);
  const [changing, setChanging] = useState(false);
  useEffect(() => setChanging(false), [workspaceId]);

  return (
    <div className="space-y-7 sm:space-y-9">
      <PageHeader
        eyebrow="Guided setup"
        title="Get your project running"
        description="Choose your goal, then follow the steps that fit it. Each step opens where the work happens — this guide tracks your progress live."
        status="Private Beta"
      />

      {!workspaceId ? (
        <Section
          variant="surface"
          title={workspaceLoading ? "Loading…" : "No project yet"}
          description={
            workspaceLoading
              ? "Reading your project context."
              : "Create your free project first — the guided setup starts right after."
          }
          actions={
            workspaceLoading ? undefined : (
              <Button asChild className="min-h-11">
                <Link to="/dashboard">Go to dashboard</Link>
              </Button>
            )
          }
        />
      ) : goalQuery.isPending ? (
        <Section variant="surface">
          <div className="flex items-center gap-3 py-8 text-sm text-muted-foreground">
            <Loader2 className="size-4 animate-spin text-gold" aria-hidden="true" />
            <span>Checking your project goal…</span>
          </div>
        </Section>
      ) : goalQuery.isError ? (
        <Section
          variant="surface"
          title="Project goal unavailable"
          description="Your project goal could not be loaded right now."
          actions={
            <Button variant="outline" className="min-h-11" onClick={() => void goalQuery.refetch()}>
              <RefreshCw className="size-4" aria-hidden="true" />
              Retry
            </Button>
          }
        />
      ) : changing || (goal === null && standardFor !== workspaceId) ? (
        <GoalChooser
          workspaceId={workspaceId}
          isOwner={isOwner}
          current={goal}
          onCancel={changing ? () => setChanging(false) : undefined}
          onUseStandard={goal === null ? () => { setChanging(false); setStandardFor(workspaceId); } : undefined}
        />
      ) : (
        <OnboardingWizard
          key={`${workspaceId}:${goal ?? "legacy"}`}
          workspaceId={workspaceId}
          goal={goal}
          canChangeGoal={isOwner}
          onChangeGoal={() => setChanging(true)}
        />
      )}
    </div>
  );
}

function OnboardingWizard({
  workspaceId,
  goal,
  canChangeGoal,
  onChangeGoal,
}: {
  workspaceId: string;
  goal: ProjectGoal | null;
  canChangeGoal: boolean;
  onChangeGoal: () => void;
}) {
  const progress = useOnboardingProgress(workspaceId, goal);
  const [activeIndex, setActiveIndex] = useState<number | null>(null);

  useEffect(() => {
    if (!progress.isPending && activeIndex === null) {
      setActiveIndex(progress.currentIndex);
    }
  }, [progress.isPending, progress.currentIndex, activeIndex]);

  const total = progress.stepDefs.length;
  const active = Math.min(activeIndex ?? progress.currentIndex, total - 1);
  const stepDef = progress.stepDefs[active]!;
  const stepState = progress.steps[active]!;
  const isReview = stepDef.key === "review";
  const goalLabel = PROJECT_GOAL_OPTIONS.find((o) => o.value === goal)?.label ?? null;

  const goalBar = (
    <div className="flex flex-wrap items-center justify-between gap-2 text-xs text-muted-foreground">
      <span>
        Goal: <span className="font-semibold text-foreground">{goalLabel ?? "Not chosen — standard guide"}</span>
      </span>
      {canChangeGoal ? (
        <Button variant="ghost" size="sm" className="min-h-11" onClick={onChangeGoal}>
          {goal ? "Change goal" : "Choose goal"}
        </Button>
      ) : null}
    </div>
  );

  if (progress.isPending || activeIndex === null) {
    return (
      <Section variant="surface">
        <div className="flex items-center gap-3 py-8 text-sm text-muted-foreground">
          <Loader2 className="size-4 animate-spin text-gold" aria-hidden="true" />
          <span>Checking your setup progress…</span>
        </div>
      </Section>
    );
  }

  if (progress.isError) {
    return (
      <Section
        variant="surface"
        title="Progress unavailable"
        description="Your setup state could not be loaded right now. You can still work through the steps directly."
        actions={
          <Button variant="outline" className="min-h-11" onClick={() => window.location.reload()}>
            <RefreshCw className="size-4" aria-hidden="true" />
            Retry
          </Button>
        }
      />
    );
  }

  const next = () => setActiveIndex(Math.min(active + 1, total - 1));

  return (
    <>
      {goalBar}
      <StepRail progress={progress} activeIndex={active} onSelect={setActiveIndex} />

      <Section
        variant="surface"
        className="rise-in border-gold/40"
        title={stepDef.title}
        description={stepDef.description}
        actions={
          stepState.complete ? (
            <StatusBadge tone="green">Completed</StatusBadge>
          ) : (
            <StatusBadge tone="gold">
              Step {active + 1} of {total}
            </StatusBadge>
          )
        }
      >
        {isReview ? (
          <div className="space-y-4">
            <ul className="divide-y divide-border-subtle">
              {progress.stepDefs.map((s, i) => {
                if (s.key === "review") return null;
                const st = progress.steps[i]!;
                return (
                  <li key={s.key} className="flex items-center justify-between gap-3 py-3">
                    <div className="min-w-0">
                      <p className="text-sm font-semibold text-foreground">{s.title}</p>
                      {st.detail ? (
                        <p className="mt-0.5 truncate text-xs text-muted-foreground">{st.detail}</p>
                      ) : null}
                    </div>
                    <StatusBadge tone={st.complete ? "green" : "muted"}>
                      {st.complete ? "Done" : "To do"}
                    </StatusBadge>
                  </li>
                );
              })}
            </ul>
            {goal === "launch" ? (
              <p className="text-xs leading-relaxed text-muted-foreground">
                Optional: connecting a Telegram community lets watchers get welcome messages and
                Launch Watch invites.{" "}
                <Link to="/telegram" className="text-gold underline-offset-4 hover:underline">
                  Connect Telegram
                </Link>
              </p>
            ) : null}
            {progress.allComplete ? (
              <div className="flex flex-col items-start gap-3 border border-gold/30 bg-gold/5 px-5 py-4">
                <p className="flex items-center gap-2 text-sm font-semibold text-foreground">
                  <Rocket className="size-4 text-gold" aria-hidden="true" />
                  Setup steps on record.
                </p>
                <p className="text-xs leading-relaxed text-muted-foreground">
                  The steps above are done. The dashboard keeps guiding whatever comes next.
                </p>
              </div>
            ) : (
              <p className="text-xs leading-relaxed text-muted-foreground">
                Finish the remaining steps above — select any earlier step to jump back to it.
                Skipped steps stay visible on your dashboard until they&apos;re done.
              </p>
            )}
            <div className="flex flex-wrap items-center gap-2">
              {active > 0 ? (
                <Button variant="outline" className="min-h-11" onClick={() => setActiveIndex(active - 1)}>
                  <ChevronLeft className="size-4" aria-hidden="true" />
                  Back
                </Button>
              ) : null}
              <Button asChild className="min-h-11">
                <Link to="/dashboard">
                  Open dashboard
                  <ArrowRight className="size-4" aria-hidden="true" />
                </Link>
              </Button>
            </div>
          </div>
        ) : (
          <div className="space-y-4">
            {stepState.complete && stepState.detail ? (
              <p className="flex items-center gap-2 text-sm text-foreground">
                <Check className="size-4 text-pepe" aria-hidden="true" />
                <span>
                  Done — <span className="font-semibold">{stepState.detail}</span>
                </span>
              </p>
            ) : null}
            {!stepState.complete ? (
              <p className="text-xs leading-relaxed text-muted-foreground">
                {stepDef.key === "identity"
                  ? "After saving, you'll return straight back here."
                  : "Complete it there, then return to this guide — your progress is detected automatically."}
              </p>
            ) : null}
            <div className="flex flex-wrap items-center gap-2">
              {active > 0 ? (
                <Button variant="outline" className="min-h-11" onClick={() => setActiveIndex(active - 1)}>
                  <ChevronLeft className="size-4" aria-hidden="true" />
                  Back
                </Button>
              ) : null}
              {stepState.complete ? (
                <Button className="min-h-11" onClick={next}>
                  Continue
                  <ArrowRight className="size-4" aria-hidden="true" />
                </Button>
              ) : (
                <>
                  {stepDef.key === "identity" ? (
                    <Link
                      to="/project-profile"
                      search={{ redirect: "/onboarding" }}
                      className={cn(buttonVariants(), "min-h-11")}
                    >
                      {stepDef.ctaLabel}
                      <ArrowRight className="size-4" aria-hidden="true" />
                    </Link>
                  ) : (
                    <Button asChild className="min-h-11">
                      <Link to={stepDef.to}>
                        {stepDef.ctaLabel}
                        <ArrowRight className="size-4" aria-hidden="true" />
                      </Link>
                    </Button>
                  )}
                  <Button variant="ghost" className="min-h-11" onClick={next}>
                    Skip for now
                  </Button>
                </>
              )}
            </div>
          </div>
        )}
      </Section>
    </>
  );
}
