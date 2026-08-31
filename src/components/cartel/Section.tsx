import type { ReactNode } from "react";
import { cn } from "@/lib/utils";

export type SectionVariant = "hero" | "primary" | "surface" | "quiet" | "plain";

const VARIANTS: Record<SectionVariant, string> = {
  hero: "cartel-hero rounded-xl p-4 sm:p-6",
  primary: "cartel-panel rounded-xl p-4 sm:p-6",
  surface: "rounded-lg border border-border/70 bg-surface-raised/60 p-3 sm:p-5",
  quiet: "rounded-md bg-surface-raised/25 p-2.5 sm:p-3.5",
  plain: "p-0",
};

type SectionProps = {
  /** Visual weight of the surface. */
  variant?: SectionVariant;
  title?: ReactNode;
  /** Short supporting line under the title. */
  description?: ReactNode;
  /** Leading icon or badge rendered next to the title. */
  leading?: ReactNode;
  /** Trailing controls rendered on the title row. */
  actions?: ReactNode;
  className?: string;
  headerClassName?: string;
  contentClassName?: string;
  children?: ReactNode;
  /** Renders as <section> by default; set to false for a plain div. */
  asSection?: boolean;
};

export function Section({
  variant = "surface",
  title,
  description,
  leading,
  actions,
  className,
  headerClassName,
  contentClassName,
  children,
  asSection = true,
}: SectionProps) {
  const Tag = asSection ? "section" : "div";
  const hasHeader = Boolean(title || description || actions || leading);

  return (
    <Tag className={cn(VARIANTS[variant], className)}>
      {hasHeader ? (
        <div
          className={cn(
            "grid grid-cols-[minmax(0,1fr)_auto] items-start gap-3 sm:flex sm:items-center sm:justify-between",
            children ? "mb-3 sm:mb-4" : undefined,
            headerClassName,
          )}
        >
          <div className="flex min-w-0 items-start gap-2.5">
            {leading ? <span className="mt-0.5 shrink-0 text-gold">{leading}</span> : null}
            <div className="min-w-0">
              {title ? (
                <h2 className="min-w-0 text-sm font-semibold uppercase tracking-[0.14em] text-foreground [overflow-wrap:anywhere]">
                  {title}
                </h2>
              ) : null}
              {description ? (
                <p className="mt-1 max-w-prose text-xs leading-relaxed text-muted-foreground [overflow-wrap:anywhere] sm:text-sm">
                  {description}
                </p>
              ) : null}
            </div>
          </div>
          {actions ? (
            <div className="flex min-w-0 max-w-full shrink-0 flex-wrap items-center justify-end gap-2">
              {actions}
            </div>
          ) : null}
        </div>
      ) : null}
      {children ? <div className={cn("min-w-0", contentClassName)}>{children}</div> : null}
    </Tag>
  );
}
