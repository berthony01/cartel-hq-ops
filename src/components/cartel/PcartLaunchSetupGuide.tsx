import { CheckCircle2, Circle, Clock, Lock } from "lucide-react";
import {
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
  ready: "text-pepe",
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
      className="min-w-0 overflow-hidden rounded-lg border border-gold/35 bg-card/60"
    >
      <div className="flex min-w-0 flex-wrap items-center justify-between gap-2 border-b border-border-subtle px-4 py-3">
        <div className="min-w-0">
          <p className="type-eyebrow text-gold">PEPECARTEL</p>
          <h2 className="mt-1 text-base font-semibold text-foreground">Launch setup</h2>
        </div>
        <span
          className={`rounded-sm border px-2 py-1 text-xs font-semibold uppercase tracking-wide ${
            ready ? "border-pepe/50 text-pepe" : "border-gold/50 text-gold"
          }`}
        >
          {readiness.overall}
        </span>
      </div>
      {readiness.next ? (
        <div className="border-b border-gold/20 bg-gold/8 px-4 py-3">
          <p className="type-eyebrow text-gold">Current next action</p>
          <p className="mt-1 text-sm font-semibold leading-snug text-foreground">
            {readiness.next.action}
          </p>
        </div>
      ) : null}
      <ol className="grid min-w-0 gap-px bg-border-subtle sm:grid-cols-5">
        {readiness.steps.map((step, i) => {
          const Icon = STATE_ICON[step.state];
          return (
            <li key={step.id} className="min-w-0 bg-card px-3 py-3">
              <div className="flex min-w-0 items-start gap-2">
                <span className="mt-0.5 flex shrink-0 items-center text-foreground">
                  <Icon className={`size-4 shrink-0 ${STATE_TONE[step.state]}`} aria-hidden="true" />
                </span>
                <div className="min-w-0">
                  <p className="text-sm font-semibold text-foreground">{i + 1}. {step.label}</p>
                  <p className={`mt-0.5 text-xs leading-snug ${STATE_TONE[step.state]}`}>{step.status}</p>
                </div>
              </div>
            </li>
          );
        })}
      </ol>
      <p className="flex items-start gap-2 px-4 py-3 text-xs leading-relaxed text-muted-foreground">
        <Lock className="mt-0.5 size-3.5 shrink-0" aria-hidden="true" />
        Mainnet stays safely locked until launch day. This lock is a safety setting, not an error.
      </p>
    </section>
  );
}
