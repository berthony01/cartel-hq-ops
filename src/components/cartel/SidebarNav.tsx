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
        <div key={section.label} className="flex flex-col gap-1">
          <p className="px-3 pb-1 text-[10px] font-semibold uppercase tracking-[0.22em] text-muted-foreground/60">
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
                  "border-gold/45 bg-gold/10 text-foreground shadow-[inset_2px_0_0_0_var(--gold)]",
              }}
              inactiveProps={{ className: "border-transparent text-muted-foreground" }}
              className="group flex min-h-11 items-center gap-3 rounded-md border px-3 py-2 text-sm transition-colors duration-200 hover:border-border hover:bg-surface-raised hover:text-foreground"
            >
              <item.icon className="size-4 shrink-0" aria-hidden="true" />
              <span className="truncate">{item.label}</span>
              {item.status === "next" ? (
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
    <Link to="/" className="flex items-center gap-3 rounded-md px-1 py-1">
      <span className="flex size-9 items-center justify-center rounded-md border border-gold/45 bg-[image:var(--gradient-gold)] font-display text-lg text-[oklch(0.145_0_0)]">
        PC
      </span>
      <span className="leading-tight">
        <span className="block font-display text-lg uppercase text-foreground">Cartel HQ</span>
        <span className="block text-[10px] uppercase tracking-[0.22em] text-muted-foreground">
          Pepecartel
        </span>
      </span>
    </Link>
  );
}
