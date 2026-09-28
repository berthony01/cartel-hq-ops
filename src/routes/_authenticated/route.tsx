import { createFileRoute, Outlet, redirect } from "@tanstack/react-router";
import { Loader2 } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { AppShell } from "@/components/cartel/AppShell";
import { WorkspaceProvider } from "@/lib/workspace-context";
import { ReferralAttributionBridge } from "@/components/cartel/ReferralAttributionBridge";

/** Fail-safe against Supabase auth storage lock hangs. getSession() is local,
 *  so this should resolve almost instantly; the timeout guards pathological
 *  lock contention, not normal network latency. */
const AUTH_INIT_TIMEOUT_MS = 5000;

export const Route = createFileRoute("/_authenticated")({
  ssr: false,
  beforeLoad: async ({ location }) => {
    let timeoutId: ReturnType<typeof setTimeout> | undefined;
    const timeout = new Promise<{ data: { session: null }; error: Error }>((resolve) => {
      timeoutId = setTimeout(() => {
          resolve({
            data: { session: null },
            error: new Error(
              "Auth storage is taking too long to initialize. Please refresh the page.",
            ),
          });
      }, AUTH_INIT_TIMEOUT_MS);
    });

    const { data, error } = await Promise.race([supabase.auth.getSession(), timeout]).finally(
      () => {
        if (timeoutId !== undefined) clearTimeout(timeoutId);
      },
    );

    const session = data?.session;
    if (error || !session?.user) {
      throw redirect({ to: "/auth", search: { redirect: location.href } });
    }
    return { user: session.user };
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
      <ReferralAttributionBridge />
      <AppShell>
        <Outlet />
      </AppShell>
    </WorkspaceProvider>
  );
}
