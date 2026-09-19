/**
 * SE-16.1H — Telegram Mini App presentation primitives (read-only).
 *
 * Pure presentation. No server call, no credential handling, no mutation
 * control. Results and targets are always rendered as two separate, labelled
 * sections so a target can never be mistaken for an observed result.
 *
 * Padding prefers Telegram's own content-safe-area variables, falls back to
 * Telegram's safe-area variables, then to the browser `env()` insets, so the
 * frame stays clear of the Telegram header and controls on every edge.
 */

import type { ReactNode } from "react";
import { RotateCw } from "lucide-react";
import { cn } from "@/lib/utils";

/** Telegram content-safe area -> Telegram safe area -> browser env() -> minimum. */
function inset(edge: "top" | "right" | "bottom" | "left", minimum: string): string {
  return `max(var(--tg-content-safe-area-inset-${edge}, var(--tg-safe-area-inset-${edge}, env(safe-area-inset-${edge}, 0px))), ${minimum})`;
}

export function MiniAppFrame({ children }: { children: ReactNode }) {
  return (
    <div
      className="min-h-screen w-full bg-background text-foreground"
      style={{
        paddingTop: inset("top", "0.75rem"),
        paddingBottom: inset("bottom", "1.25rem"),
        paddingLeft: inset("left", "0.875rem"),
        paddingRight: inset("right", "0.875rem"),
      }}
    >
      <div className="mx-auto flex w-full min-w-0 max-w-md flex-col gap-4">{children}</div>
    </div>
  );
}

export function MiniAppIdentity({ subtitle }: { subtitle?: string | undefined }) {
  return (
    <div className="flex min-w-0 items-center justify-between gap-3 border-b border-border-subtle pb-3">
      <div className="min-w-0">
        <p className="type-eyebrow text-gold">Cartel HQ</p>
        <p className="mt-1 truncate font-display text-lg uppercase leading-none text-foreground">
          Mission Control
        </p>
      </div>
      {subtitle ? (
        <span className="max-w-[45%] truncate text-right text-[11px] uppercase tracking-[0.12em] text-muted-foreground">
          {subtitle}
        </span>
      ) : null}
    </div>
  );
}

export function MiniAppPanel({
  heading,
  note,
  children,
  className,
}: {
  heading: string;
  note?: string | undefined;
  children: ReactNode;
  className?: string;
}) {
  return (
    <section
      className={cn(
        "min-w-0 rounded-lg border border-border/70 bg-surface-raised/40 px-3.5 py-3.5",
        className,
      )}
    >
      <p className="type-eyebrow text-gold">{heading}</p>
      {note ? <p className="mt-1 text-[11px] leading-4 text-muted-foreground">{note}</p> : null}
      <div className="mt-3 min-w-0">{children}</div>
    </section>
  );
}

/** A labelled value line. `value` is already formatted null-honestly. */
export function MiniAppStatLine({
  label,
  value,
  emphasis,
}: {
  label: string;
  value: string;
  emphasis?: boolean;
}) {
  return (
    <div className="flex min-h-9 min-w-0 items-center justify-between gap-3 border-b border-border/40 py-1.5 last:border-b-0">
      <span className="min-w-0 truncate text-[13px] text-muted-foreground">{label}</span>
      <span
        className={cn(
          "shrink-0 text-sm font-semibold tabular-nums",
          emphasis ? "text-gold" : "text-foreground",
        )}
      >
        {value}
      </span>
    </div>
  );
}

/**
 * Recovery affordance for a recoverable read failure. It only re-runs the same
 * validated read; it never carries a mutation or weakens authorization.
 */
export function MiniAppRetryButton({
  onRetry,
  pending,
  label = "Try again",
}: {
  onRetry: () => void;
  pending?: boolean;
  label?: string;
}) {
  return (
    <button
      type="button"
      onClick={onRetry}
      disabled={pending}
      className="mt-1 inline-flex min-h-9 items-center gap-2 rounded-md border border-gold/40 bg-gold/10 px-3 py-2 text-xs font-semibold text-gold transition-colors hover:bg-gold/15 disabled:opacity-60"
    >
      <RotateCw className={cn("size-3.5", pending ? "animate-spin" : null)} aria-hidden="true" />
      {pending ? "Retrying…" : label}
    </button>
  );
}

export function MiniAppMessage({
  title,
  description,
  action,
}: {
  title: string;
  description: string;
  action?: ReactNode;
}) {
  return (
    <div className="surface-quiet flex min-w-0 flex-col items-center gap-2 rounded-lg border border-dashed border-border/70 px-4 py-8 text-center">
      <p className="text-sm font-semibold text-foreground">{title}</p>
      <p className="max-w-xs text-xs leading-relaxed text-muted-foreground">{description}</p>
      {action}
    </div>
  );
}

export function MiniAppSkeleton({ label }: { label: string }) {
  return (
    <div className="flex min-h-40 items-center justify-center rounded-lg border border-border/60 bg-surface-raised/30">
      <p className="animate-pulse text-xs uppercase tracking-[0.18em] text-muted-foreground">
        {label}
      </p>
    </div>
  );
}
