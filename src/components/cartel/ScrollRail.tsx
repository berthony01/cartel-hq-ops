import type { ReactNode } from "react";
import { cn } from "@/lib/utils";

type ScrollRailProps = {
  children: ReactNode;
  className?: string;
  /** Item wrapper class applied to the rail's direct-child spacing. */
  itemClassName?: string;
  /** Class applied from lg+ when the rail should stop scrolling (e.g. a grid). */
  desktopClassName?: string;
  /** Enable scroll snapping on touch devices. */
  snap?: boolean;
  "aria-label"?: string;
};

/**
 * Horizontally scrollable, snap-able rail for mobile.
 * Pass `desktopClassName` (e.g. "lg:grid lg:grid-cols-3 lg:overflow-visible")
 * to fall back to normal grid/block behaviour at larger breakpoints.
 */
export function ScrollRail({
  children,
  className,
  itemClassName,
  desktopClassName,
  snap = true,
  ...rest
}: ScrollRailProps) {
  return (
    <div
      role="group"
      aria-label={rest["aria-label"]}
      className={cn(
        "no-scrollbar -mx-4 flex gap-3 overflow-x-auto px-4 pb-1 sm:mx-0 sm:px-0",
        snap && "snap-x snap-mandatory",
        "[&>*]:shrink-0",
        snap && "[&>*]:snap-start",
        itemClassName && `[&>*]:${itemClassName}`,
        desktopClassName,
        className,
      )}
    >
      {children}
    </div>
  );
}
