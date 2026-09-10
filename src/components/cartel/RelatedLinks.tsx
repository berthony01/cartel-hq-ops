import type { ReactNode } from "react";
import { cn } from "@/lib/utils";

/**
 * Presentation-only cross-surface handoff row.
 * Renders a compact strip of related destinations so each module points at the
 * neighbouring parts of the product instead of being a dead end. Navigation
 * only — it never triggers workflow, backend or send behaviour.
 */

export const relatedLinkClass =
  "touch-target inline-flex min-h-11 items-center gap-1.5 rounded-full border border-border/70 bg-surface-raised/50 px-3 py-2 text-xs font-medium text-muted-foreground transition-colors hover:border-gold/40 hover:text-foreground";

export function RelatedLinks({
  label = "Related",
  children,
  className,
}: {
  label?: string;
  children: ReactNode;
  className?: string;
}) {
  return (
    <nav
      aria-label={label}
      className={cn(
        "flex min-w-0 flex-wrap items-center gap-2 rounded-lg border border-border/60 bg-background/20 px-3 py-2.5",
        className,
      )}
    >
      <span className="shrink-0 text-[10px] font-semibold uppercase tracking-[0.18em] text-muted-foreground/70">
        {label}
      </span>
      {children}
    </nav>
  );
}
