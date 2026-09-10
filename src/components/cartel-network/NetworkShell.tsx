import { useState, type ReactNode } from "react";
import { Link } from "@tanstack/react-router";
import { Menu, X } from "lucide-react";
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
    <Link to="/network" className="flex min-w-0 items-center gap-2">
      <span className="flex size-8 shrink-0 items-center justify-center rounded-md border border-gold/40 bg-gold/10 font-display text-sm text-gold">
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
      <header className="sticky top-0 z-30 border-b border-border bg-background/90 backdrop-blur">
        <div className="mx-auto flex w-full max-w-6xl items-center gap-3 px-4 py-3 sm:px-6">
          <Wordmark />
          <nav className="ml-auto hidden items-center gap-1 md:flex">
            {NAV.map((item) => (
              <Link
                key={item.to}
                to={item.to}
                activeOptions={{ exact: item.to === "/network" }}
                activeProps={{ className: "text-gold" }}
                className="rounded-md px-3 py-2 text-sm text-muted-foreground transition-colors hover:text-foreground"
              >
                {item.label}
              </Link>
            ))}
            <Button asChild size="sm" className="ml-2">
              <Link to="/">Back to CARTEL HQ</Link>
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
          <div className="border-t border-border bg-surface md:hidden">
            <nav className="mx-auto flex w-full max-w-6xl flex-col gap-1 px-4 py-3 sm:px-6">
              {NAV.map((item) => (
                <Link
                  key={item.to}
                  to={item.to}
                  activeOptions={{ exact: item.to === "/network" }}
                  activeProps={{ className: "text-gold" }}
                  onClick={() => setOpen(false)}
                  className="rounded-md px-2 py-2 text-sm text-muted-foreground"
                >
                  {item.label}
                </Link>
              ))}
              <Button asChild size="sm" className="mt-2 w-full">
                <Link to="/" onClick={() => setOpen(false)}>
                  Back to CARTEL HQ
                </Link>
              </Button>
            </nav>
          </div>
        ) : null}
      </header>

      <main className="mx-auto w-full max-w-6xl flex-1 px-4 py-8 sm:px-6 lg:py-12">
        {children}
      </main>

      <footer className="border-t border-border bg-surface/60">
        <div className="mx-auto flex w-full max-w-6xl flex-col gap-3 px-4 py-8 sm:px-6">
          <p className="font-display text-sm uppercase tracking-wide text-foreground">
            Cartel Network
          </p>
          <p className="max-w-3xl text-xs leading-relaxed text-muted-foreground">
            Information shown here is supplied by authenticated project accounts in CARTEL HQ.
            Listing a project or launch is not a safety audit, token-safety verification,
            rug-proof guarantee or investment endorsement. Always do your own research.
          </p>
          <a
            href="/"
            className="text-xs font-semibold uppercase tracking-[0.14em] text-gold hover:underline"
          >
            Open CARTEL HQ →
          </a>
        </div>
      </footer>
    </div>
  );
}
