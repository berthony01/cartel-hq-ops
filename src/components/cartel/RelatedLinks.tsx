import type { ReactNode } from "react";
import { cn } from "@/lib/utils";

/**
 * Presentation-only cross-surface handoff row.
 * Renders a compact strip of related destinations so each module points at the
 * neighbouring parts of the product instead of being a dead end. Navigation
 * only — it never triggers workflow, backend or send behaviour.
 */

export const relatedLinkClass =
  "touch-target inline-flex min-h-11 items-center gap-1.5 rounded-md border border-border-subtle bg-surface-overlay/35 px-3 py-2 text-xs font-medium text-muted-foreground transition-[border-color,background-color,color,transform] hover:-translate-y-px hover:border-gold/35 hover:bg-gold/5 hover:text-foreground";

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
        "surface-quiet flex min-w-0 flex-wrap items-center gap-2 rounded-lg px-3 py-2.5",
        className,
      )}
    >
      <span className="type-eyebrow shrink-0 text-muted-foreground/70">
        {label}
      </span>
      {children}
    </nav>
  );
}
