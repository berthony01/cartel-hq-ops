import { useState, type ReactNode } from "react";
import { useRouterState } from "@tanstack/react-router";
import { Menu } from "lucide-react";
import { ProjectIdentityGate } from "@/components/cartel/ProjectIdentityGate";
import { Sheet, SheetContent, SheetTitle, SheetTrigger } from "@/components/ui/sheet";
import { Button } from "@/components/ui/button";
import { CartelMark, SidebarNav } from "@/components/cartel/SidebarNav";
import { WorkspaceSwitcher } from "@/components/cartel/WorkspaceSwitcher";
import { UserMenu } from "@/components/cartel/UserMenu";
import { MobileTabBar } from "@/components/cartel/MobileTabBar";
import { LegalFooter } from "@/components/cartel/LegalFooter";
import { PolicyAcceptancePrompt } from "@/components/cartel/PolicyAcceptancePrompt";
import { ManagedAccessGuard } from "@/components/cartel/ManagedAccessGuard";
import { SetupHelpHeaderButton, SetupHelpProvider } from "@/components/cartel/SetupHelp";

function TopBar({ onOpenMobileNav, dashboard }: { onOpenMobileNav: () => void; dashboard: boolean }) {
  return (
    <header className="app-gutter sticky top-0 z-30 grid h-14 grid-cols-[auto_minmax(0,1fr)_auto] items-center gap-2 border-b border-border-subtle bg-background/88 backdrop-blur-xl lg:h-16 lg:grid-cols-[minmax(0,1fr)_auto]">
      <Button
        variant="ghost"
        size="icon"
        className="-ml-1 shrink-0 lg:hidden"
        aria-label="Open navigation"
        onClick={onOpenMobileNav}
      >
        <Menu className="size-5" />
      </Button>

      <div className="hidden min-w-0 sm:block lg:hidden">
        <CartelMark />
      </div>

      <div className={`min-w-0 items-center ${dashboard ? "flex lg:hidden" : "flex"}`}>
        <WorkspaceSwitcher />
      </div>

      <div className="flex shrink-0 items-center gap-1 sm:gap-2 lg:col-start-2 lg:justify-self-end">
        <SetupHelpHeaderButton />
        <UserMenu />
      </div>
    </header>
  );
}


/**
 * Project Identity Gate A: Sticker Lab and its descendants.
 * Gate B: Community Command (/telegram) and Sticker Drops (/distribution).
 * Launch Control / Watchlist are structurally bound to a profile and stay ungated.
 */
function isProjectIdentityGatedPath(pathname: string): boolean {
  return (
    pathname === "/sticker-lab" ||
    pathname.startsWith("/sticker-lab/") ||
    pathname === "/telegram" ||
    pathname === "/distribution"
  );
}

export function AppShell({ children }: { children: ReactNode }) {
  const [mobileOpen, setMobileOpen] = useState(false);
  const pathname = useRouterState({ select: (s) => s.location.pathname });
  const gated = isProjectIdentityGatedPath(pathname);
  const dashboard = pathname === "/dashboard";

  return (
    <div className="min-h-screen bg-background/75">
      <aside className="fixed inset-y-0 left-0 z-40 hidden w-64 flex-col border-r border-sidebar-border bg-sidebar/96 px-3 py-4 shadow-[16px_0_44px_-38px_var(--gold)] backdrop-blur lg:flex">
        <div className="border-b border-sidebar-border px-1 pb-4">
          <CartelMark />
        </div>
        <div className="mt-6 flex-1 min-h-0 overflow-y-auto pr-1">
          {dashboard ? (
            <div className="mb-6 border-b border-sidebar-border px-1 pb-5">
              <p className="type-eyebrow mb-2 px-2 text-muted-foreground/55">Active project</p>
              <WorkspaceSwitcher fullWidth />
            </div>
          ) : null}
          <SidebarNav />
        </div>
        <p className="border-t border-sidebar-border px-2 pt-4 text-[10px] font-semibold uppercase leading-relaxed tracking-[0.14em] text-muted-foreground/60">
          Private operating layer
        </p>
      </aside>

      <Sheet open={mobileOpen} onOpenChange={setMobileOpen}>
        <SheetTrigger className="sr-only">Open navigation</SheetTrigger>
        <SheetContent
          side="left"
          className="safe-bottom w-[min(18rem,88vw)] overflow-y-auto border-sidebar-border bg-sidebar px-3 py-4"
        >
          <SheetTitle className="sr-only">CARTEL HQ navigation</SheetTitle>
          <div className="border-b border-sidebar-border px-1 pb-4">
            <CartelMark />
          </div>
          <div className="mt-6">
            <SidebarNav onNavigate={() => setMobileOpen(false)} />
          </div>
        </SheetContent>
      </Sheet>

      <div className="lg:pl-64">
        <TopBar dashboard={dashboard} onOpenMobileNav={() => setMobileOpen(true)} />
        <main className="app-gutter app-scroll-pad mx-auto w-full max-w-7xl py-6 lg:py-9">
          <PolicyAcceptancePrompt />
          <ManagedAccessGuard>
            {gated ? <ProjectIdentityGate>{children}</ProjectIdentityGate> : children}
          </ManagedAccessGuard>
          <footer className="mt-12 border-t border-border-subtle pt-4">
            <LegalFooter />
          </footer>
        </main>
      </div>

      <MobileTabBar onOpenMore={() => setMobileOpen(true)} />
    </div>
  );
}
