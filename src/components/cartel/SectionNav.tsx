import { useEffect, useState } from "react";
import { cn } from "@/lib/utils";

/**
 * Sticky in-page section navigator.
 *
 * Presentation-only: it scrolls to existing sections that are already rendered
 * on the page. It does not mount/unmount content, so no workflow, query,
 * mutation or gating behaviour changes. Chosen over real tabs because the
 * Launch Control sections live inside a shared form and a two-column grid;
 * tabbing them would require restructuring behavioural code.
 */

export type SectionNavItem = {
  /** DOM id of the anchor wrapper for this section. */
  id: string;
  label: string;
};

export function SectionNav({
  items,
  label,
  className,
}: {
  items: SectionNavItem[];
  label: string;
  className?: string;
}) {
  const [active, setActive] = useState<string | null>(items[0]?.id ?? null);

  useEffect(() => {
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
        if (visible?.target.id) setActive(visible.target.id);
      },
      { rootMargin: "-96px 0px -60% 0px", threshold: 0 },
    );
    nodes.forEach((node) => observer.observe(node));
    return () => observer.disconnect();
  }, [items]);

  const go = (id: string) => {
    const node = document.getElementById(id);
    if (!node) return;
    setActive(id);
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
