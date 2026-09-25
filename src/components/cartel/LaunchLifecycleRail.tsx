import { Check, ChevronDown, CircleDot } from "lucide-react";

import { StatusBadge } from "@/components/cartel/StatusBadge";
import { cn } from "@/lib/utils";

type LifecycleStep = {
  id: string;
  label: string;
  description: string;
};

export function LaunchLifecycleRail({
  steps,
  currentId,
}: {
  steps: LifecycleStep[];
  currentId: string;
}) {
  const currentIndex = Math.max(steps.findIndex((step) => step.id === currentId), 0);
  const current = steps[currentIndex];

  return (
    <section className="min-w-0 border-t border-gold/20 pt-4" aria-labelledby="launch-lifecycle-heading">
      <div className="flex min-w-0 flex-wrap items-center justify-between gap-2">
        <div className="min-w-0">
          <p id="launch-lifecycle-heading" className="type-eyebrow text-muted-foreground">
            Launch lifecycle
          </p>
          <p className="mt-1 text-xs leading-relaxed text-muted-foreground">
            Informational only. Lifecycle changes happen from the single action above.
          </p>
        </div>
        <StatusBadge tone="gold">
          {currentIndex + 1} of {steps.length} · {current?.label ?? "Current"}
        </StatusBadge>
      </div>

      <ol className="mt-5 hidden min-w-0 grid-cols-8 lg:grid" aria-label="Launch lifecycle states">
        {steps.map((step, index) => {
          const complete = index < currentIndex;
          const active = index === currentIndex;
          return (
            <li key={step.id} className="relative min-w-0 px-1 first:pl-0 last:pr-0">
              {index > 0 ? (
                <span
                  className={cn(
                    "absolute left-0 right-1/2 top-3 h-px",
                    complete || active ? "bg-gold/55" : "bg-border-subtle",
                  )}
                  aria-hidden="true"
                />
              ) : null}
              {index < steps.length - 1 ? (
                <span
                  className={cn(
                    "absolute left-1/2 right-0 top-3 h-px",
                    complete ? "bg-gold/55" : "bg-border-subtle",
                  )}
                  aria-hidden="true"
                />
              ) : null}
              <div className="relative z-10 flex flex-col items-center text-center">
                <span
                  className={cn(
                    "flex size-6 items-center justify-center rounded-full border bg-background text-[11px] font-bold",
                    complete
                      ? "border-pepe/55 text-pepe"
                      : active
                        ? "border-gold bg-gold/15 text-gold shadow-[var(--glow-gold)]"
                        : "border-border-strong text-muted-foreground",
                  )}
                >
                  {complete ? <Check className="size-3.5" aria-hidden="true" /> : index + 1}
                </span>
                <span
                  className={cn(
                    "mt-2 min-w-0 text-[11px] font-semibold uppercase leading-tight [overflow-wrap:anywhere]",
                    active ? "text-gold" : complete ? "text-foreground" : "text-muted-foreground",
                  )}
                >
                  {step.label}
                </span>
                <span className="sr-only">
                  {complete ? "Complete" : active ? "Current" : "Future"}
                </span>
              </div>
            </li>
          );
        })}
      </ol>

      <details className="mt-3 min-w-0 rounded-md border border-border-subtle bg-background/35 lg:hidden">
        <summary className="flex min-h-11 cursor-pointer list-none items-center justify-between gap-3 px-3.5 text-sm font-semibold text-foreground">
          <span className="min-w-0 [overflow-wrap:anywhere]">View all lifecycle states</span>
          <ChevronDown className="size-4 shrink-0 text-muted-foreground transition-transform [[open]_&]:rotate-180" aria-hidden="true" />
        </summary>
        <ol className="border-t border-border-subtle px-3.5 py-3" aria-label="Launch lifecycle states">
          {steps.map((step, index) => {
            const complete = index < currentIndex;
            const active = index === currentIndex;
            return (
              <li key={step.id} className="grid min-w-0 grid-cols-[auto_minmax(0,1fr)] gap-3 pb-4 last:pb-0">
                <span
                  className={cn(
                    "mt-0.5 flex size-6 items-center justify-center rounded-full border",
                    complete
                      ? "border-pepe/55 text-pepe"
                      : active
                        ? "border-gold bg-gold/10 text-gold"
                        : "border-border-strong text-muted-foreground",
                  )}
                >
                  {complete ? <Check className="size-3.5" aria-hidden="true" /> : active ? <CircleDot className="size-3.5" aria-hidden="true" /> : <span className="text-[11px] font-bold">{index + 1}</span>}
                </span>
                <span className="min-w-0">
                  <span className={cn("block text-sm font-semibold", active ? "text-gold" : "text-foreground")}>{step.label}</span>
                  <span className="mt-1 block text-xs leading-relaxed text-muted-foreground">{step.description}</span>
                  <span className="mt-1 block type-eyebrow text-muted-foreground">
                    {complete ? "Complete" : active ? "Current" : "Future"}
                  </span>
                </span>
              </li>
            );
          })}
        </ol>
      </details>
    </section>
  );
}