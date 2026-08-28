import type { ReactNode } from "react";
import { cn } from "@/lib/utils";

type StickyActionBarProps = {
  /** Left side content, typically a Back control. */
  start?: ReactNode;
  /** Right side content, typically the primary Continue control. */
  end?: ReactNode;
  /** Optional compact status line above the controls. */
  hint?: ReactNode;
  children?: ReactNode;
  className?: string;
  /**
   * Desktop behaviour at lg+:
   * - "static": renders inline (default)
   * - "hidden": hides the bar entirely
   */
  desktop?: "static" | "hidden";
};

/**
 * Fixed mobile workflow action bar. Sits directly above the mobile tab bar
 * (`--bottom-nav-h`) and respects the safe-area inset. Consumers should add
 * `app-scroll-pad-actions` to the scroll container so content is not covered.
 */
export function StickyActionBar({
  start,
  end,
  hint,
  children,
  className,
  desktop = "static",
}: StickyActionBarProps) {
  return (
    <div
      className={cn(
        "action-bar-fixed z-30 border-t border-border bg-sidebar/95 px-4 py-3 backdrop-blur",
        desktop === "hidden"
          ? "lg:hidden"
          : "lg:static lg:inset-x-auto lg:bottom-auto lg:rounded-lg lg:border lg:bg-surface-raised/60 lg:px-4 lg:backdrop-blur-none",
        className,
      )}
    >
      {hint ? (
        <p className="mb-2 truncate text-[11px] uppercase tracking-[0.14em] text-muted-foreground">
          {hint}
        </p>
      ) : null}
      {children ?? (
        <div className="flex items-center justify-between gap-3">
          <div className="flex min-w-0 items-center gap-2">{start}</div>
          <div className="flex shrink-0 items-center gap-2">{end}</div>
        </div>
      )}
    </div>
  );
}
