import { Link } from "@tanstack/react-router";
import { MoreHorizontal } from "lucide-react";
import { MOBILE_PRIMARY_ITEMS } from "@/lib/nav";

const TAB_BASE =
  "touch-target flex flex-1 min-w-0 flex-col items-center justify-center gap-1 rounded-md px-0.5 py-1.5 text-[10px] font-semibold uppercase tracking-[0.02em] transition-colors duration-200";

/**
 * Fixed mobile application navigation. Visible below lg only; the desktop
 * sidebar remains the primary navigation at lg+. Destinations are derived
 * from the single nav source (src/lib/nav.ts) — no duplicated list.
 */
export function MobileTabBar({ onOpenMore }: { onOpenMore: () => void }) {
  return (
    <nav
      aria-label="Primary mobile"
      className="safe-bottom fixed inset-x-0 bottom-0 z-40 border-t border-border bg-sidebar/95 backdrop-blur lg:hidden"
    >
      <ul className="mx-auto flex w-full max-w-lg items-stretch gap-1 px-2 py-1.5">
        {MOBILE_PRIMARY_ITEMS.map((item) => (
          <li key={item.to} className="flex min-w-0 flex-1">
            <Link
              to={item.to}
              activeOptions={{ exact: item.to === "/" }}
              activeProps={{
                className: "bg-gold/10 text-gold",
                "aria-current": "page",
              }}
              inactiveProps={{ className: "text-muted-foreground" }}
              className={TAB_BASE}
            >
              <item.icon className="size-5 shrink-0" aria-hidden="true" />
              <span className="w-full truncate text-center">
                {item.mobileLabel ?? item.label}
              </span>
            </Link>
          </li>
        ))}
        <li className="flex min-w-0 flex-1">
          <button
            type="button"
            onClick={onOpenMore}
            aria-label="Open full navigation"
            className={`${TAB_BASE} text-muted-foreground`}
          >
            <MoreHorizontal className="size-5 shrink-0" aria-hidden="true" />
            <span className="w-full truncate text-center">More</span>
          </button>
        </li>
      </ul>
    </nav>
  );
}
