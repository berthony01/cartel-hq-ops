import { CheckCircle2, Circle, Clock, Lock } from "lucide-react";
import {
  PCART_AUCTION_DEFAULTS,
  type PcartReadiness,
  type PcartStepState,
} from "@/lib/pcart-launch-readiness";

const STATE_ICON: Record<PcartStepState, typeof Circle> = {
  ready: CheckCircle2,
  needs_setup: Circle,
  pending_build: Clock,
  locked: Lock,
};

const STATE_TONE: Record<PcartStepState, string> = {
  ready: "text-success",
  needs_setup: "text-gold",
  pending_build: "text-muted-foreground",
  locked: "text-muted-foreground",
};

/** L-S1 — read-only PEPECARTEL launch setup guide. No inputs, no actions. */
export function PcartLaunchSetupGuide({ readiness }: { readiness: PcartReadiness }) {
  const ready = readiness.overall === "Ready";
  return (
    <section
      aria-label="PEPECARTEL launch setup"
      className="min-w-0 rounded-lg border border-border bg-card/60 p-4"
    >
      <div className="flex min-w-0 flex-wrap items-center justify-between gap-2">
        <p className="type-eyebrow text-gold">PEPECARTEL launch setup</p>
        <span
          className={`rounded-sm border px-2 py-1 text-xs font-semibold uppercase tracking-wide ${
            ready ? "border-success/50 text-success" : "border-gold/50 text-gold"
          }`}
        >
          {readiness.overall}
        </span>
      </div>
      {readiness.next ? (
        <p className="mt-2 text-sm text-foreground">
          <span className="font-semibold text-gold">Next: </span>
          {readiness.next.action}
        </p>
      ) : null}
      <ol className="mt-3 flex min-w-0 flex-col gap-2">
        {readiness.steps.map((step, i) => {
          const Icon = STATE_ICON[step.state];
          return (
            <li key={step.id} className="min-w-0 rounded-md border border-border-subtle p-3">
              <div className="flex min-w-0 flex-wrap items-center justify-between gap-2">
                <span className="flex items-center gap-2 text-sm font-semibold text-foreground">
                  <Icon className={`size-4 shrink-0 ${STATE_TONE[step.state]}`} aria-hidden="true" />
                  {i + 1}. {step.label}
                </span>
                <span className={`text-xs ${STATE_TONE[step.state]}`}>{step.status}</span>
              </div>
              <p className="mt-1 text-xs leading-relaxed text-muted-foreground">{step.detail}</p>
              {step.id === "auction" && step.state !== "ready" ? (
                <ul className="mt-2 list-disc space-y-0.5 pl-5 text-xs text-muted-foreground">
                  {PCART_AUCTION_DEFAULTS.map((d) => (
                    <li key={d}>{d}</li>
                  ))}
                </ul>
              ) : null}
            </li>
          );
        })}
      </ol>
      <p className="mt-3 flex items-start gap-2 text-xs leading-relaxed text-muted-foreground">
        <Lock className="mt-0.5 size-3.5 shrink-0" aria-hidden="true" />
        Mainnet stays safely locked until launch day. This lock is a safety setting, not an error.
      </p>
    </section>
  );
}
