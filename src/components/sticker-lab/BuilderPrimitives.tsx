import { Check, Info, Pencil, TriangleAlert, ArrowRight } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { BUILDER_STEPS } from "@/lib/sticker-lab";
import type { ProviderFailure } from "@/lib/sticker-packs";

export function Stepper({
  current,
  onSelect,
}: {
  current: number;
  onSelect: (n: number) => void;
}) {
  const active = BUILDER_STEPS[current - 1];
  return (
    <div className="surface-command rise-in rounded-lg p-3 sm:p-4">
      {/* Mobile: compact numbered rail + explicit current-step label (never truncated). */}
      <div className="lg:hidden">
        <p className="font-display text-base uppercase leading-snug text-foreground">
          <span className="type-eyebrow mr-1 text-gold">
            Step {current} of {BUILDER_STEPS.length}
          </span>{" "}
          · {active?.title}
        </p>
        <ol className="no-scrollbar mt-3 flex items-center gap-1.5" aria-label="Builder steps">
          {BUILDER_STEPS.map((s) => {
            const state = s.id === current ? "current" : s.id < current ? "done" : "todo";
            return (
              <li key={s.id} className="flex-1">
                <button
                  type="button"
                  onClick={() => onSelect(s.id)}
                  aria-current={state === "current" ? "step" : undefined}
                  aria-label={`Step ${s.id}: ${s.title}`}
                  className={`flex min-h-11 w-full items-center justify-center rounded-md border text-xs font-bold transition-[border-color,background-color,color] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring ${
                    state === "current"
                      ? "border-gold bg-gold/10 text-gold"
                      : state === "done"
                        ? "border-pepe/40 bg-surface-raised text-pepe"
                        : "border-border bg-surface-raised text-muted-foreground"
                  }`}
                >
                  {state === "done" ? <Check className="size-4" aria-hidden="true" /> : s.id}
                </button>
              </li>
            );
          })}
        </ol>
      </div>

      {/* Desktop: full step labels, no truncation. */}
      <ol className="hidden gap-2 lg:flex" aria-label="Builder steps">
        {BUILDER_STEPS.map((s) => {
          const state = s.id === current ? "current" : s.id < current ? "done" : "todo";
          return (
            <li key={s.id} className="min-w-0 flex-1">
              <button
                type="button"
                onClick={() => onSelect(s.id)}
                aria-current={state === "current" ? "step" : undefined}
                className={`hover-lift flex min-h-14 w-full items-center gap-2 rounded-md border px-3 py-2.5 text-left text-xs transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background ${
                  state === "current"
                    ? "border-gold bg-gold/10 text-gold"
                    : state === "done"
                      ? "border-pepe/40 bg-surface-raised text-pepe"
                      : "border-border bg-surface-raised text-muted-foreground hover:border-gold/40"
                }`}
              >
                <span className="flex size-5 shrink-0 items-center justify-center rounded-full border border-current text-[10px] font-bold">
                  {state === "done" ? <Check className="size-3" aria-hidden="true" /> : s.id}
                </span>
                <span className="font-semibold uppercase tracking-[0.12em]">{s.title}</span>
              </button>
            </li>
          );
        })}
      </ol>
    </div>
  );
}

export function StepCard({
  title,
  hint,
  action,
  children,
}: {
  title: string;
  hint: string;
  action?: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <Card className="surface-elevated rise-in overflow-hidden">
      <CardHeader className="gap-3 p-4 sm:flex-row sm:items-start sm:justify-between sm:space-y-0 sm:p-6">
        <div className="min-w-0">
          <CardTitle className="font-display text-xl uppercase leading-none sm:text-2xl">{title}</CardTitle>
          <p className="mt-2 max-w-4xl text-xs leading-relaxed text-muted-foreground">{hint}</p>
        </div>
        {action}
      </CardHeader>
      <CardContent className="p-4 pt-0 sm:p-6 sm:pt-0">{children}</CardContent>
    </Card>
  );
}

export function Notice({ tone, children }: { tone: "muted" | "warn"; children: React.ReactNode }) {
  const Icon = tone === "warn" ? TriangleAlert : Info;
  return (
    <p
      className={`flex gap-2 rounded-md border p-3 text-xs leading-relaxed ${
        tone === "warn"
          ? "border-signal/40 bg-signal/5 text-signal"
          : "surface-quiet text-muted-foreground"
      }`}
    >
      <Icon className="mt-0.5 size-4 shrink-0" aria-hidden="true" />
      <span>{children}</span>
    </p>
  );
}

export function Pipeline() {
  const stages = ["Generate", "Background Removal", "Transparency Check", "Ready"];
  return (
    <ol className="mt-6 flex flex-wrap items-center gap-2" aria-label="Generation pipeline">
      {stages.map((s, i) => (
        <li key={s} className="flex items-center gap-2">
            <span className="surface-quiet rounded-md px-3 py-2 text-[11px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">
            {s}
          </span>
          {i < stages.length - 1 ? (
            <ArrowRight className="size-3.5 shrink-0 text-muted-foreground" aria-hidden="true" />
          ) : null}
        </li>
      ))}
    </ol>
  );
}

export function SummaryRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="surface-quiet min-w-0 rounded-md p-3">
      <dt className="type-eyebrow text-muted-foreground">
        {label}
      </dt>
      <dd className="mt-1.5 truncate text-sm font-semibold text-foreground">{value}</dd>
    </div>
  );
}

export function SummaryStat({
  label,
  value,
  tone,
}: {
  label: string;
  value: string;
  tone: "green" | "red" | "muted";
}) {
  return (
    <div
      className={`min-w-0 rounded-md border p-3 ${
        tone === "green"
          ? "border-pepe/40 bg-pepe/5"
          : tone === "red"
            ? "border-signal/40 bg-signal/5"
            : "surface-quiet"
      }`}
    >
      <p className="type-eyebrow text-muted-foreground">
        {label}
      </p>
      <p
        className={`mt-1.5 font-display text-xl leading-none ${
          tone === "green" ? "text-pepe" : tone === "red" ? "text-signal" : "text-foreground"
        }`}
      >
        {value}
      </p>
    </div>
  );
}

/** Plain-English failure explanation plus the one action that actually helps. */
export function FailureBlock({
  failure,
  replacement,
  onEditConcept,
}: {
  failure: ProviderFailure;
  replacement: boolean;
  onEditConcept: () => void;
}) {
  return (
    <div
      role="alert"
      className="mt-3 rounded-md border border-signal/40 bg-signal/5 p-3 text-[11px] leading-relaxed"
    >
      <p className="font-semibold text-signal">{failure.title}</p>
      <p className="mt-1 text-muted-foreground">{failure.body}</p>
      {replacement ? (
        <p className="mt-1 text-muted-foreground">
          Your previous sticker is still saved and unchanged.
        </p>
      ) : null}
      {failure.kind === "safety" ? (
        <Button
          type="button"
          size="sm"
          variant="outline"
          className="mt-2 min-h-9"
          onClick={onEditConcept}
        >
          <Pencil className="size-3.5" aria-hidden="true" />
          Edit concept wording
        </Button>
      ) : null}
      {failure.raw ? (
        <details className="mt-2">
          <summary className="cursor-pointer text-[11px] text-muted-foreground">
            Technical detail
          </summary>
          <p className="mt-1 break-words font-mono text-[10px] leading-relaxed text-muted-foreground">
            {failure.raw}
          </p>
        </details>
      ) : null}
    </div>
  );
}
