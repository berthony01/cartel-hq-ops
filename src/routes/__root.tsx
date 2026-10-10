import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
  Outlet,
  Link,
  createRootRouteWithContext,
  useRouter,
  HeadContent,
  Scripts,
  type ErrorComponentProps,
} from "@tanstack/react-router";
import { useEffect, type ReactNode } from "react";

import appCss from "../styles.css?url";
import { reportLovableError } from "../lib/lovable-error-reporting";
import { Toaster } from "@/components/ui/sonner";
import { supabase } from "@/integrations/supabase/client";
import { setAuthSession } from "@/hooks/useSession";

function NotFoundComponent() {
  return (
    <div className="flex min-h-screen items-center justify-center bg-background px-4">
      <div className="max-w-md text-center">
        <h1 className="text-7xl font-bold text-foreground">404</h1>
        <h2 className="mt-4 text-xl font-semibold text-foreground">Page not found</h2>
        <p className="mt-2 text-sm text-muted-foreground">
          The page you're looking for doesn't exist or has been moved.
        </p>
        <div className="mt-6">
          <Link
            to="/"
            className="inline-flex items-center justify-center rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary/90"
          >
            Go home
          </Link>
        </div>
      </div>
    </div>
  );
}

function ErrorComponent({ error, reset }: ErrorComponentProps) {
  console.error(error);
  useEffect(() => {
    reportLovableError(error, { boundary: "tanstack_root_error_component" });
  }, [error]);

  useEffect(() => {
    const hot = import.meta.hot;
    if (!hot) return;

    const recoverAfterUpdate = () => window.location.reload();
    hot.on("vite:afterUpdate", recoverAfterUpdate);
    return () => hot.off("vite:afterUpdate", recoverAfterUpdate);
  }, []);

  return (
    <div className="flex min-h-screen items-center justify-center bg-background px-4">
      <div className="max-w-md text-center">
        <h1 className="text-xl font-semibold tracking-tight text-foreground">
          This page didn't load
        </h1>
        <p className="mt-2 text-sm text-muted-foreground">
          Something went wrong on our end. You can try refreshing or head back home.
        </p>
        <p className="mt-1 text-xs text-muted-foreground">Reference: app</p>
        <div className="mt-6 flex flex-wrap justify-center gap-2">
          <button
            onClick={() => window.location.reload()}
            className="inline-flex items-center justify-center rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary/90"
          >
            Try again
          </button>
          <a
            href="/"
            className="inline-flex items-center justify-center rounded-md border border-input bg-background px-4 py-2 text-sm font-medium text-foreground transition-colors hover:bg-accent"
          >
            Go home
          </a>
        </div>
      </div>
    </div>
  );
}

export const Route = createRootRouteWithContext<{ queryClient: QueryClient }>()({
  head: () => ({
    meta: [
      { charSet: "utf-8" },
      { name: "viewport", content: "width=device-width, initial-scale=1" },
      { title: "CARTEL HQ" },
      {
        name: "description",
        content:
          "CARTEL HQ is the launch command center for project identity, Telegram community operations, branded creative tools, X Missions, Launch Watch, and public discovery.",
      },
      { property: "og:title", content: "CARTEL HQ" },
      {
        property: "og:description",
        content: "The launch command center for project identity, community operations, creative tools, X Missions, Launch Watch, and public discovery.",
      },
      { property: "og:type", content: "website" },
      { property: "og:site_name", content: "CARTEL HQ" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
    links: [
      {
        rel: "stylesheet",
        href: appCss,
      },
      { rel: "preconnect", href: "https://fonts.googleapis.com" },
      { rel: "preconnect", href: "https://fonts.gstatic.com", crossOrigin: "anonymous" },
      {
        rel: "stylesheet",
        href: "https://fonts.googleapis.com/css2?family=Bebas+Neue&family=Sora:wght@400;500;600;700&display=swap",
      },
      { rel: "icon", href: "/favicon.svg?v=2", type: "image/svg+xml" },
      { rel: "icon", href: "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAABAAAAAQBAMAAADt3eJSAAAAMFBMVEW1kCTWqCi7lCZMaXG6kyYHBwfTpykgGwuFaRxnUheSdB4TEAk1Kw6uiiNOPxNpVBjvFO0ZAAAABXRSTlPfLMAAwV7mmtkAAAAJcEhZcwAACxMAAAsTAQCanBgAAABaSURBVAiZYzB0YGBgYGARZhAoDQ0NDQ1nZHAPjX75PDS0iIE19FtaWndoAANrRFpaWj6IcSz3aFUriNGWDlIdwMB6bSk6Ay4FVwzXDjNQHWYF3FJDBZAzmIQBTjAri4paDsEAAAAASUVORK5CYII=", type: "image/png", sizes: "16x16" },
    ],
  }),

  shellComponent: RootShell,
  component: RootComponent,
  notFoundComponent: NotFoundComponent,
  errorComponent: ErrorComponent,
});

function RootShell({ children }: { children: ReactNode }) {
  return (
    <html lang="en" suppressHydrationWarning>
      <head>
        <HeadContent />
      </head>
      <body>
        {children}
        <Scripts />
      </body>
    </html>
  );
}

function RootComponent() {
  const { queryClient } = Route.useRouteContext();
  const router = useRouter();

  // Single global auth listener. The AppShell lives in the authenticated
  // layout so public routes such as /auth render standalone.
  useEffect(() => {
    const { data } = supabase.auth.onAuthStateChange((event, session) => {
      setAuthSession(session);

      if (event !== "SIGNED_OUT") return;
      void queryClient.cancelQueries().then(() => {
        queryClient.clear();
        void router.invalidate();
      });
    });
    return () => data.subscription.unsubscribe();
  }, [router, queryClient]);

  return (
    <QueryClientProvider client={queryClient}>
      {/* Required: nested routes render here. Removing <Outlet /> breaks all child routes. */}
      <Outlet />
      <Toaster />
    </QueryClientProvider>
  );
}
