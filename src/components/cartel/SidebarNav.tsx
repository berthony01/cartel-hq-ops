import { Link } from "@tanstack/react-router";
import { NAV_SECTIONS } from "@/lib/nav";
import { usePlatformAccess } from "@/hooks/usePlatformAccess";

export function SidebarNav({ onNavigate }: { onNavigate?: () => void }) {
  // Presentation-only gate. Route + Edge Function remain the security boundary.
  const { isPlatformOwner } = usePlatformAccess();

  return (
    <nav aria-label="Primary" className="flex flex-col gap-5">
      {NAV_SECTIONS.map((section) => {
        const items = section.items.filter((item) => !item.ownerOnly || isPlatformOwner);
        if (items.length === 0) return null;
        return (
        <div
          key={section.label}
          className={`flex flex-col gap-1 ${section.label === "Owner Tools" ? "mt-1 border-t border-sidebar-border pt-5" : ""}`}
        >
          <p className="type-eyebrow px-3 pb-1 text-muted-foreground/55">
            {section.label}
          </p>
          {items.map((item) => (

            <Link
              key={item.to}
              to={item.to}
              onClick={onNavigate}
              activeOptions={{ exact: item.to === "/" }}
              activeProps={{
                className:
                   "border-gold/35 bg-gold/8 text-foreground shadow-[inset_2px_0_0_0_var(--gold),0_10px_24px_-22px_var(--gold)]",
                 "aria-current": "page",
              }}
              inactiveProps={{ className: "border-transparent text-muted-foreground" }}
               className={`group flex min-h-11 items-center gap-3 rounded-md border px-3 py-2 text-sm transition-[border-color,background-color,color,transform] duration-200 hover:translate-x-0.5 hover:border-sidebar-border hover:bg-sidebar-accent hover:text-foreground ${
                item.subordinate ? "ml-3 border-l border-l-border/60 pl-4" : ""
              }`}
            >
              <item.icon className="size-4 shrink-0" aria-hidden="true" />
              <span className="min-w-0 flex-1 truncate">{item.label}</span>
              {item.external ? (
                <span className="ml-auto shrink-0 rounded-sm border border-gold/25 bg-gold/5 px-1.5 py-0.5 text-[9px] font-semibold uppercase tracking-wider text-gold">
                  Public
                </span>
              ) : item.status === "next" ? (
                <span className="ml-auto rounded-sm border border-gold/40 px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wider text-gold">
                  Next
                </span>
              ) : item.status === "planned" ? (
                <span className="ml-auto text-[10px] uppercase tracking-wider text-muted-foreground/70">
                  Soon
                </span>
              ) : null}
            </Link>
          ))}

        </div>
        );
      })}

    </nav>
  );
}

export function CartelMark() {
  return (
    <Link to="/" className="group flex min-w-0 items-center gap-3 rounded-md px-1 py-1">
      <span className="flex size-10 shrink-0 items-center justify-center rounded-md border border-gold/40 bg-[image:var(--gradient-gold)] font-display text-xl text-primary-foreground shadow-[0_10px_28px_-18px_var(--gold)] transition-transform group-hover:-translate-y-px">
        PC
      </span>
      <span className="min-w-0 leading-tight">
        <span className="block truncate font-display text-xl uppercase text-foreground">Cartel HQ</span>
        <span className="block truncate text-[9px] font-semibold uppercase tracking-[0.2em] text-muted-foreground">
          Command system
        </span>
      </span>
    </Link>
  );
}
