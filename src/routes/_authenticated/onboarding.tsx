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
import {
  ONBOARDING_STEPS,
  useOnboardingProgress,
} from "@/lib/onboarding";
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
          "Four guided steps to get a Cartel HQ project running: identity, community, launch, review.",
      },
    ],
  }),
  component: OnboardingWizard,
});

function StepRail({
  activeIndex,
  onSelect,
  doneCount,
}: {
  activeIndex: number;
  onSelect: (index: number) => void;
  doneCount: number;
}) {
  return (
    <ol className="grid grid-cols-2 gap-2 sm:grid-cols-4" aria-label="Setup steps">
      {ONBOARDING_STEPS.map((step, index) => {
        const done = index < doneCount;
        const current = index === activeIndex;
        return (
          <li key={step.key}>
            <button
              type="button"
              onClick={() => onSelect(index)}
              disabled={!done && !current}
              className={cn(
                "flex w-full min-h-16 items-center gap-3 border px-4 py-3 text-left transition-colors",
                current
                  ? "border-gold/50 bg-gold/5"
                  : done
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
                  Step {index + 1} of {ONBOARDING_STEPS.length}
                </span>
              </span>
            </button>
          </li>
        );
      })}
    </ol>
  );
}

function OnboardingWizard() {
  const { workspaceId, loading: workspaceLoading } = useWorkspace();
  const progress = useOnboardingProgress(workspaceId);
  const [activeIndex, setActiveIndex] = useState<number | null>(null);

  useEffect(() => {
    if (!progress.isPending && activeIndex === null) {
      setActiveIndex(progress.currentIndex);
    }
  }, [progress.isPending, progress.currentIndex, activeIndex]);

  const doneCount = progress.steps.filter(
    (step) => step.key !== "review" && step.complete,
  ).length;
  const active = activeIndex ?? progress.currentIndex;
  // activeIndex is always clamped to a valid step (0..3) and the step lists
  // are fixed length, so these lookups are total at runtime.
  const stepDef = ONBOARDING_STEPS[active]!;
  const stepState = progress.steps[active]!;
  const isReview = stepDef.key === "review";

  return (
    <div className="space-y-7 sm:space-y-9">
      <PageHeader
        eyebrow="Guided setup"
        title="Get your project running"
        description="Four steps, about ten minutes. Each step opens where the work happens — this guide tracks your progress live and picks up where you left off."
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
      ) : progress.isPending || activeIndex === null ? (
        <Section variant="surface">
          <div className="flex items-center gap-3 py-8 text-sm text-muted-foreground">
            <Loader2 className="size-4 animate-spin text-gold" aria-hidden="true" />
            <span>Checking your setup progress…</span>
          </div>
        </Section>
      ) : progress.isError ? (
        <Section
          variant="surface"
          title="Progress unavailable"
          description="Your setup state could not be loaded right now. You can still work through the steps directly."
          actions={
            <Button
              variant="outline"
              className="min-h-11"
              onClick={() => window.location.reload()}
            >
              <RefreshCw className="size-4" aria-hidden="true" />
              Retry
            </Button>
          }
        />
      ) : (
        <>
          <StepRail
            activeIndex={active}
            doneCount={doneCount}
            onSelect={setActiveIndex}
          />

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
                  Step {active + 1} of {ONBOARDING_STEPS.length}
                </StatusBadge>
              )
            }
          >
            {isReview ? (
              <div className="space-y-4">
                <ul className="divide-y divide-border-subtle">
                  {ONBOARDING_STEPS.slice(0, 3).map((s, i) => {
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
                {progress.allComplete ? (
                  <div className="flex flex-col items-start gap-3 border border-gold/30 bg-gold/5 px-5 py-4">
                    <p className="flex items-center gap-2 text-sm font-semibold text-foreground">
                      <Rocket className="size-4 text-gold" aria-hidden="true" />
                      You&apos;re set. Time to operate.
                    </p>
                    <p className="text-xs leading-relaxed text-muted-foreground">
                      Your project identity is live, your community is connected and your
                      launch is scheduled. The dashboard keeps guiding whatever comes next.
                    </p>
                  </div>
                ) : (
                  <p className="text-xs leading-relaxed text-muted-foreground">
                    Finish the remaining steps above — select any incomplete step to jump
                    back to it. Skipped steps stay visible on your dashboard as the next
                    action until they&apos;re done.
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
                    <Button className="min-h-11" onClick={() => setActiveIndex(Math.min(active + 1, ONBOARDING_STEPS.length - 1))}>
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
                      <Button
                        variant="ghost"
                        className="min-h-11"
                        onClick={() => setActiveIndex(Math.min(active + 1, ONBOARDING_STEPS.length - 1))}
                      >
                        Skip for now
                      </Button>
                    </>
                  )}
                </div>
              </div>
            )}
          </Section>
        </>
      )}
    </div>
  );
}
