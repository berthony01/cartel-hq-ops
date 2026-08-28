import { useState, type ReactNode } from "react";
import { Menu, Search, Bell } from "lucide-react";
import { Sheet, SheetContent, SheetTitle, SheetTrigger } from "@/components/ui/sheet";
import { Button } from "@/components/ui/button";
import { CartelMark, SidebarNav } from "@/components/cartel/SidebarNav";
import { WorkspaceSwitcher } from "@/components/cartel/WorkspaceSwitcher";
import { UserMenu } from "@/components/cartel/UserMenu";
import { MobileTabBar } from "@/components/cartel/MobileTabBar";

function TopBar({ onOpenMobileNav }: { onOpenMobileNav: () => void }) {
  return (
    <header className="app-gutter sticky top-0 z-30 flex h-14 items-center gap-2 border-b border-border bg-background/85 backdrop-blur lg:h-16">
      <Button
        variant="ghost"
        size="icon"
        className="-ml-1 shrink-0 lg:hidden"
        aria-label="Open navigation"
        onClick={onOpenMobileNav}
      >
        <Menu className="size-5" />
      </Button>

      <div className="hidden sm:block lg:hidden">
        <CartelMark />
      </div>

      <div className="flex min-w-0 flex-1 items-center">
        <WorkspaceSwitcher />
      </div>

      <div className="flex shrink-0 items-center gap-1 sm:gap-2">
        <div className="hidden items-center gap-2 rounded-md border border-border bg-surface px-3 py-2 text-sm text-muted-foreground lg:flex">
          <Search className="size-4" aria-hidden="true" />
          <input
            disabled
            aria-label="Search (not available yet)"
            placeholder="Search HQ…"
            className="w-32 bg-transparent text-sm outline-none placeholder:text-muted-foreground/70 xl:w-56"
          />
        </div>
        <Button variant="ghost" size="icon" disabled aria-label="Notifications (not available yet)">
          <Bell className="size-5" />
        </Button>
        <UserMenu />
      </div>
    </header>
  );
}

export function AppShell({ children }: { children: ReactNode }) {
  const [mobileOpen, setMobileOpen] = useState(false);

  return (
    <div className="min-h-screen bg-background">
      <aside className="fixed inset-y-0 left-0 z-40 hidden w-64 flex-col border-r border-border bg-sidebar px-3 py-4 lg:flex">
        <div className="px-1">
          <CartelMark />
        </div>
        <div className="mt-6 flex-1 overflow-y-auto">
          <SidebarNav />
        </div>
        <p className="px-2 pt-4 text-[10px] leading-relaxed text-muted-foreground/70">
          CARTEL HQ — Private Beta
        </p>
      </aside>

      <Sheet open={mobileOpen} onOpenChange={setMobileOpen}>
        <SheetTrigger className="sr-only">Open navigation</SheetTrigger>
        <SheetContent
          side="left"
          className="safe-bottom w-72 overflow-y-auto border-border bg-sidebar px-3 py-4"
        >
          <SheetTitle className="sr-only">CARTEL HQ navigation</SheetTitle>
          <div className="px-1">
            <CartelMark />
          </div>
          <div className="mt-6">
            <SidebarNav onNavigate={() => setMobileOpen(false)} />
          </div>
        </SheetContent>
      </Sheet>

      <div className="lg:pl-64">
        <TopBar onOpenMobileNav={() => setMobileOpen(true)} />
        <main className="app-gutter app-scroll-pad mx-auto w-full max-w-6xl py-6 lg:py-10">
          {children}
        </main>
      </div>

      <MobileTabBar onOpenMore={() => setMobileOpen(true)} />
    </div>
  );
}
