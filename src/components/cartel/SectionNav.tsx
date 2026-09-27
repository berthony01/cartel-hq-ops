import { useEffect, useState } from "react";
import { Check, CircleDot, Lock } from "lucide-react";
import { cn } from "@/lib/utils";

/**
 * Sticky section navigator, presentation-only in both modes.
 *
 * Uncontrolled (default, unchanged): scroll-spy over sections already rendered
 * on the page — an IntersectionObserver tracks the visible section and a click
 * calls `scrollIntoView`.
 *
 * Controlled (`activeId` + `onChange`, P2-C2): the parent owns which working
 * view is visible. In this mode the component NEVER calls `scrollIntoView` and
 * NEVER creates an IntersectionObserver; pressing a button only reports the
 * chosen id. The parent keeps every section mounted and toggles visibility with
 * CSS, so form state, queries, mutations, permissions and idempotency state are
 * untouched by navigation.
 *
 * UX-A: an item may carry a presentation-only `state` derived by the parent
 * from state it already reads. The indicator never asserts a new fact and never
 * triggers work — it only mirrors what the parent already renders inside the
 * section.
 */

export type SectionNavState = "complete" | "attention" | "blocked" | "neutral";


export type SectionNavItem = {
  /** DOM id of the anchor wrapper (uncontrolled) or of the view (controlled). */
  id: string;
  label: string;
  /** Presentation-only attention hint supplied by the parent. */
  state?: SectionNavState;
  /** Accessible sentence describing the hint, e.g. "Needs attention". */
  stateLabel?: string;
};


export function SectionNav({
  items,
  label,
  className,
  activeId,
  onChange,
  variant = "default",
}: {
  items: SectionNavItem[];
  label: string;
  className?: string;
  /** Controlled mode: id of the visible section. Requires `onChange`. */
  activeId?: string;
  /** Controlled mode: called with the chosen section id. */
  onChange?: (id: string) => void;
  /** Studio mode becomes a numbered vertical workflow rail on wide screens. */
  variant?: "default" | "studio";
}) {
  const controlled = activeId !== undefined && !!onChange;
  const [scrollActive, setScrollActive] = useState<string | null>(items[0]?.id ?? null);

  useEffect(() => {
    if (controlled) return; // controlled mode does no scroll-spy at all
    if (typeof window === "undefined" || !("IntersectionObserver" in window)) return;
    const nodes = items
      .map((item) => document.getElementById(item.id))
      .filter((node): node is HTMLElement => !!node);
    if (nodes.length === 0) return;

    const observer = new IntersectionObserver(
      (entries) => {
        const visible = entries
          .filter((entry) => entry.isIntersecting)
          .sort((a, b) => a.boundingClientRect.top - b.boundingClientRect.top)[0];
        if (visible?.target.id) setScrollActive(visible.target.id);
      },
      { rootMargin: "-96px 0px -60% 0px", threshold: 0 },
    );
    nodes.forEach((node) => observer.observe(node));
    return () => observer.disconnect();
  }, [items, controlled]);

  const active = controlled ? activeId : scrollActive;

  const go = (id: string) => {
    if (controlled) {
      onChange?.(id);
      return;
    }
    const node = document.getElementById(id);
    if (!node) return;
    setScrollActive(id);
    node.scrollIntoView({ behavior: "smooth", block: "start" });
  };

  return (
    <div
      className={cn(
        variant === "studio"
          ? "sticky top-14 z-20 -mx-4 border-y border-border/60 bg-background/95 px-4 py-2 backdrop-blur sm:mx-0 sm:border sm:px-2 xl:top-20 xl:self-start xl:border-gold/20 xl:bg-surface/90 xl:p-2.5 xl:shadow-[var(--shadow-cartel-soft)]"
          : "sticky top-14 z-20 -mx-4 border-y border-border/60 bg-background/90 px-4 py-1.5 backdrop-blur sm:mx-0 sm:rounded-lg sm:border sm:px-1.5 lg:top-16",
        className,
      )}
    >
      {variant === "studio" ? (
        <p className="type-meta mb-2 hidden border-b border-border-subtle px-2 pb-2 text-muted-foreground xl:block">
          Profile studio
        </p>
      ) : null}
      <nav
        aria-label={label}
        className={cn(
          "no-scrollbar flex gap-1 overflow-x-auto",
          variant === "studio" && "xl:grid xl:overflow-visible",
        )}
      >
        {items.map((item, index) => {
          const isActive = active === item.id;
          const state = item.state ?? "neutral";
          const StateIcon =
            state === "complete" ? Check : state === "attention" ? CircleDot : state === "blocked" ? Lock : null;
          return (
            <button
              key={item.id}
              type="button"
              onClick={() => go(item.id)}
              aria-current={isActive ? "true" : undefined}
              className={cn(
                "flex min-h-11 shrink-0 items-center gap-1.5 rounded-md px-3 text-xs font-semibold uppercase tracking-[0.12em] transition-colors sm:text-[13px]",
                "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-gold/60",
                variant === "studio" && "xl:w-full xl:justify-start xl:rounded-none xl:border-l-2 xl:px-3",
                isActive
                  ? variant === "studio"
                    ? "bg-surface-raised text-gold shadow-[inset_0_-2px_0_0_var(--gold)] xl:border-gold xl:shadow-none"
                    : "bg-surface-raised text-gold shadow-[inset_0_-2px_0_0_var(--gold)]"
                  : variant === "studio"
                    ? "border-transparent text-muted-foreground hover:border-border-strong hover:bg-surface-raised/50 hover:text-foreground"
                    : "text-muted-foreground hover:bg-surface-raised/50 hover:text-foreground",
              )}
            >
              {variant === "studio" ? (
                <span className="type-technical text-[10px] text-muted-foreground" aria-hidden="true">
                  {String(index + 1).padStart(2, "0")}
                </span>
              ) : null}
              {StateIcon ? (
                <StateIcon
                  className={cn(
                    "size-3.5 shrink-0",
                    state === "complete"
                      ? "text-pepe"
                      : state === "attention"
                        ? "text-gold"
                        : "text-muted-foreground",
                  )}
                  aria-hidden="true"
                />
              ) : null}
              <span>{item.label}</span>
              {item.stateLabel ? <span className="sr-only">{item.stateLabel}</span> : null}
            </button>
          );
        })}
      </nav>

    </div>
  );
}
