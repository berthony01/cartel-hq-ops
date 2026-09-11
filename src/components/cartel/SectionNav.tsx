import { useEffect, useState } from "react";
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
 */

export type SectionNavItem = {
  /** DOM id of the anchor wrapper (uncontrolled) or of the view (controlled). */
  id: string;
  label: string;
};

export function SectionNav({
  items,
  label,
  className,
  activeId,
  onChange,
}: {
  items: SectionNavItem[];
  label: string;
  className?: string;
  /** Controlled mode: id of the visible section. Requires `onChange`. */
  activeId?: string;
  /** Controlled mode: called with the chosen section id. */
  onChange?: (id: string) => void;
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
      onChange!(id);
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
        "sticky top-14 z-20 -mx-4 border-y border-border/60 bg-background/90 px-4 py-1.5 backdrop-blur sm:mx-0 sm:rounded-lg sm:border sm:px-1.5 lg:top-16",
        className,
      )}
    >
      <nav aria-label={label} className="no-scrollbar flex gap-1 overflow-x-auto">
        {items.map((item) => (
          <button
            key={item.id}
            type="button"
            onClick={() => go(item.id)}
            aria-current={active === item.id ? "true" : undefined}
            className={cn(
              "min-h-11 shrink-0 rounded-md px-3 text-xs font-semibold uppercase tracking-[0.12em] transition-colors sm:text-[13px]",
              active === item.id
                ? "bg-surface-raised text-gold"
                : "text-muted-foreground hover:text-foreground",
            )}
          >
            {item.label}
          </button>
        ))}
      </nav>
    </div>
  );
}
