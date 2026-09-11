import { useState, type ReactNode } from "react";
import { Link } from "@tanstack/react-router";
import { ArrowLeft, Globe2, Menu, ShieldCheck, X } from "lucide-react";
import { Button } from "@/components/ui/button";

/**
 * Standalone public shell for the Cartel Network. Deliberately NOT the
 * authenticated AppShell: no workspace switcher, no auth redirect, no
 * private data.
 */

const NAV = [
  { label: "Overview", to: "/network" as const },
  { label: "Projects", to: "/network/projects" as const },
  { label: "Upcoming Launches", to: "/network/launches" as const },
  { label: "Signals", to: "/network/signals" as const },

];

function Wordmark() {
  return (
    <Link to="/network" className="group flex min-w-0 items-center gap-2.5">
      <span className="flex size-9 shrink-0 items-center justify-center rounded-md border border-gold/40 bg-gold/10 font-display text-sm text-gold shadow-glow transition-colors group-hover:bg-gold/15">
        PC
      </span>
      <span className="min-w-0 leading-tight">
        <span className="block truncate font-display text-base uppercase tracking-wide text-foreground">
          Cartel Network
        </span>
        <span className="block text-[10px] uppercase tracking-[0.22em] text-muted-foreground">
          by CARTEL HQ
        </span>
      </span>
    </Link>
  );
}

export function NetworkShell({ children }: { children: ReactNode }) {
  const [open, setOpen] = useState(false);

  return (
    <div className="flex min-h-screen flex-col bg-background">
      <header className="sticky top-0 z-30 border-b border-border/80 bg-background/90 shadow-inset backdrop-blur-xl">
        <div className="mx-auto flex w-full max-w-7xl items-center gap-3 px-4 py-3 sm:px-6">
          <Wordmark />
          <span className="hidden shrink-0 items-center gap-1.5 rounded-full border border-pepe/30 bg-pepe/5 px-2.5 py-1 text-[10px] font-semibold uppercase tracking-[0.16em] text-pepe sm:inline-flex">
            <Globe2 className="size-3" aria-hidden="true" />
            Public Network
          </span>
          <nav className="ml-auto hidden items-center gap-1 md:flex">
            {NAV.map((item) => (
              <Link
                key={item.to}
                to={item.to}
                activeOptions={{ exact: item.to === "/network" }}
                activeProps={{ className: "text-gold" }}
                className="min-h-11 rounded-md border border-transparent px-3 py-3 text-sm text-muted-foreground transition-colors hover:border-border/70 hover:bg-surface-raised/50 hover:text-foreground"
              >
                {item.label}
              </Link>
            ))}
            <Button asChild size="sm" variant="outline" className="ml-2 min-h-11 border-gold/40">
              <Link to="/"><ArrowLeft className="size-4" aria-hidden="true" />Back to CARTEL HQ</Link>
            </Button>
          </nav>
          <Button
            variant="ghost"
            size="icon"
            className="ml-auto md:hidden"
            aria-label={open ? "Close navigation" : "Open navigation"}
            aria-expanded={open}
            onClick={() => setOpen((v) => !v)}
          >
            {open ? <X className="size-5" /> : <Menu className="size-5" />}
          </Button>
        </div>
        {open ? (
          <div className="border-t border-border bg-surface-elevated shadow-elevated md:hidden">
            <nav className="mx-auto flex w-full max-w-7xl flex-col gap-1 px-4 py-3 sm:px-6">
              {NAV.map((item) => (
                <Link
                  key={item.to}
                  to={item.to}
                  activeOptions={{ exact: item.to === "/network" }}
                  activeProps={{ className: "text-gold" }}
                  onClick={() => setOpen(false)}
                  className="min-h-11 rounded-md border border-transparent px-3 py-3 text-sm text-muted-foreground transition-colors hover:border-border/70 hover:bg-surface-raised"
                >
                  {item.label}
                </Link>
              ))}
              <Button asChild size="sm" className="mt-2 w-full">
                <Link to="/" onClick={() => setOpen(false)}>
                  <ArrowLeft className="size-4" aria-hidden="true" />Back to CARTEL HQ
                </Link>
              </Button>
            </nav>
          </div>
        ) : null}
      </header>

      <main className="mx-auto w-full max-w-7xl flex-1 px-4 py-8 sm:px-6 lg:py-12">
        {children}
      </main>

      <footer className="border-t border-border/80 bg-surface/60">
        <div className="mx-auto grid w-full max-w-7xl gap-5 px-4 py-8 sm:px-6 md:grid-cols-[minmax(0,1fr)_auto] md:items-end">
          <div className="min-w-0">
            <p className="flex items-center gap-2 font-display text-sm uppercase tracking-wide text-foreground">
              <ShieldCheck className="size-4 text-gold" aria-hidden="true" />Cartel Network
            </p>
            <p className="mt-2 max-w-3xl text-xs leading-relaxed text-muted-foreground">
              Information shown here is supplied by authenticated project accounts in CARTEL HQ.
              Listing a project or launch is not a safety audit, token-safety verification,
              rug-proof guarantee or investment endorsement. Always do your own research.
            </p>
          </div>
          <Button asChild variant="outline" size="sm" className="w-full border-gold/30 sm:w-auto">
            <Link to="/"><ArrowLeft className="size-4" aria-hidden="true" />Back to CARTEL HQ</Link>
          </Button>
        </div>
      </footer>
    </div>
  );
}
