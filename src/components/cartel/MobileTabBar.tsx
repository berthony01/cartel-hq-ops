import { Link } from "@tanstack/react-router";
import { MoreHorizontal } from "lucide-react";
import { MOBILE_PRIMARY_ITEMS } from "@/lib/nav";
import { Button } from "@/components/ui/button";

const TAB_BASE =
  "touch-target flex flex-1 min-w-0 flex-col items-center justify-center gap-1 rounded-md border border-transparent px-0.5 py-1.5 text-[9px] font-semibold uppercase tracking-[0.04em] transition-colors duration-200";

/**
 * Fixed mobile application navigation. Visible below lg only; the desktop
 * sidebar remains the primary navigation at lg+. Destinations are derived
 * from the single nav source (src/lib/nav.ts) — no duplicated list.
 */
export function MobileTabBar({ onOpenMore }: { onOpenMore: () => void }) {
  return (
    <nav
      aria-label="Primary mobile"
      className="safe-bottom fixed inset-x-0 bottom-0 z-40 border-t border-sidebar-border bg-sidebar/96 shadow-[0_-16px_36px_-30px_var(--gold)] backdrop-blur-xl lg:hidden"
    >
        className="mx-auto flex w-full max-w-lg items-stretch gap-1 px-2 py-1.5">
        {MOBILE_PRIMARY_ITEMS.map((item) => (
          <li key={item.to} className="flex min-w-0 flex-1">
            <Link
              to={item.to}
              activeOptions={{ exact: item.to === "/" }}
              activeProps={{
                className: "border-gold/20 bg-gold/8 text-gold",
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
          <Button
            type="button"
            variant="ghost"
            onClick={onOpenMore}
            aria-label="Open full navigation"
            className={`${TAB_BASE} h-auto text-muted-foreground hover:bg-sidebar-accent hover:text-foreground`}
          >
            <MoreHorizontal className="size-5 shrink-0" aria-hidden="true" />
            <span className="w-full truncate text-center">More</span>
          </Button>
        </li>
      </ul>
    </nav>
  );
}
