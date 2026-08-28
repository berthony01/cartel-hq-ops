import type { ReactNode } from "react";
import { cn } from "@/lib/utils";

type InlineRowProps = {
  /** Leading icon, avatar, or index marker. */
  leading?: ReactNode;
  title: ReactNode;
  subtitle?: ReactNode;
  /** Small supporting metadata (counts, timestamps). */
  meta?: ReactNode;
  /** Trailing status badge or action control. */
  trailing?: ReactNode;
  className?: string;
  /** Render as a button row for tappable list items. */
  onClick?: () => void;
  disabled?: boolean;
  /** Marks the row as the current selection when interactive. */
  active?: boolean;
};

export function InlineRow({
  leading,
  title,
  subtitle,
  meta,
  trailing,
  className,
  onClick,
  disabled,
  active,
}: InlineRowProps) {
  const body = (
    <>
      {leading ? (
        <span className="flex size-8 shrink-0 items-center justify-center rounded-md border border-border/70 bg-surface-raised/70 text-gold">
          {leading}
        </span>
      ) : null}
      <span className="min-w-0 flex-1 text-left">
        <span className="block truncate text-sm font-medium text-foreground">{title}</span>
        {subtitle ? (
          <span className="mt-0.5 block truncate text-xs text-muted-foreground">{subtitle}</span>
        ) : null}
      </span>
      {meta ? (
        <span className="shrink-0 text-[11px] uppercase tracking-[0.12em] text-muted-foreground">
          {meta}
        </span>
      ) : null}
      {trailing ? <span className="shrink-0">{trailing}</span> : null}
    </>
  );

  const base = cn(
    "touch-target flex w-full items-center gap-3 rounded-lg border border-border/60 bg-surface-raised/40 px-3 py-2.5",
    active && "border-gold/50 bg-gold/10",
    className,
  );

  if (onClick) {
    return (
      <button
        type="button"
        onClick={onClick}
        disabled={disabled}
        aria-current={active ? "true" : undefined}
        className={cn(
          base,
          "text-left transition-colors hover:border-gold/40 hover:bg-gold/5 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-gold/50 disabled:pointer-events-none disabled:opacity-50",
        )}
      >
        {body}
      </button>
    );
  }

  return <div className={base}>{body}</div>;
}
