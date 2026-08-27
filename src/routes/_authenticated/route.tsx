import { createFileRoute, Outlet, redirect } from "@tanstack/react-router";
import { Loader2 } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { AppShell } from "@/components/cartel/AppShell";
import { WorkspaceProvider } from "@/lib/workspace-context";

/** Never let a hung auth call leave the whole app rendering nothing. */
const AUTH_TIMEOUT_MS = 8000;

export const Route = createFileRoute("/_authenticated")({
  ssr: false,
  beforeLoad: async ({ location }) => {
    const timeout = new Promise<never>((_, reject) => {
      setTimeout(
        () => reject(new Error("Session check timed out. Check your connection and try again.")),
        AUTH_TIMEOUT_MS,
      );
    });
    const { data, error } = await Promise.race([supabase.auth.getUser(), timeout]);
    if (error || !data.user) {
      throw redirect({ to: "/auth", search: { redirect: location.href } });
    }
    return { user: data.user };
  },
  // Without this the pathless layout renders literally nothing while
  // beforeLoad is in flight, which reads as a blank black screen.
  pendingMs: 0,
  pendingComponent: AuthPending,
  component: AuthenticatedLayout,
});

function AuthPending() {
  return (
    <div className="flex min-h-screen items-center justify-center bg-background">
      <div className="flex items-center gap-3 text-sm text-muted-foreground">
        <Loader2 className="size-4 animate-spin text-gold" aria-hidden="true" />
        <span>Loading CARTEL HQ…</span>
      </div>
    </div>
  );
}


function AuthenticatedLayout() {
  return (
    <WorkspaceProvider>
      <AppShell>
        <Outlet />
      </AppShell>
    </WorkspaceProvider>
  );
}
