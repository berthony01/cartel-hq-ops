import type { ReactNode } from "react";
import { Link, useRouterState } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { IdCard, Loader2 } from "lucide-react";
import { useWorkspace } from "@/lib/workspace-context";
import { Button } from "@/components/ui/button";
import { Section } from "@/components/cartel/Section";
import {
  fetchProjectToolAccess,
  projectToolAccessQueryKey,
  safeInternalRedirect,
} from "@/lib/project-identity";

/**
 * Project Identity Gate A — guided UI gate.
 *
 * Renders a guided "Create your Project Identity" state instead of the wrapped
 * tool when the active workspace has no minimum project identity. The decision
 * comes from `public.can_use_project_tools`, so the platform owner never sees
 * this state. This is UX only — every paid provider action is independently
 * enforced server-side.
 */
export function ProjectIdentityGate({ children }: { children: ReactNode }) {
  const { workspaceId, loading: workspaceLoading } = useWorkspace();
  const pathname = useRouterState({ select: (s) => s.location.pathname });

  const accessQuery = useQuery({
    queryKey: projectToolAccessQueryKey(workspaceId),
    queryFn: () => fetchProjectToolAccess(workspaceId!),
    enabled: !!workspaceId,
    staleTime: 30_000,
  });

  // No active workspace: keep the route's own workspace-required experience.
  // Never pretend an identity exists and never claim one is missing.
  if (!workspaceId) return <>{children}</>;

  if (workspaceLoading || accessQuery.isPending) {
    return (
      <Section variant="surface">
        <div className="flex items-center gap-3 py-8 text-sm text-muted-foreground">
          <Loader2 className="size-4 animate-spin text-gold" aria-hidden="true" />
          <span>Checking your project…</span>
        </div>
      </Section>
    );
  }

  // Fail open for the UI only on a transport error: the server-side gate on
  // every paid action remains authoritative and fails closed.
  if (accessQuery.isError || accessQuery.data === true) return <>{children}</>;

  const redirect = safeInternalRedirect(pathname);

  return (
    <Section variant="surface">
      <div className="flex flex-col items-start gap-4 py-6">
        <span className="flex size-11 items-center justify-center rounded-md border border-gold/25 bg-gold/5 text-gold shadow-[0_8px_24px_-18px_var(--gold)]">
          <IdCard className="size-5" aria-hidden="true" />
        </span>
        <div className="space-y-2">
          <h2 className="text-lg font-semibold text-foreground">
            Create your Project Identity first
          </h2>
          <p className="max-w-xl text-sm leading-relaxed text-muted-foreground">
            This connects your stickers and project tools to the right project. A token
            launch is optional and is not required.
          </p>
        </div>
        <Button asChild>
          <Link
            to="/project-profile"
            search={redirect ? { redirect } : {}}
          >
            Create Project Identity
          </Link>
        </Button>
        <p className="text-xs leading-relaxed text-muted-foreground">
          What is required: <span className="text-foreground">Project name</span> and a{" "}
          <span className="text-foreground">project URL slug</span> only. No ticker, chain,
          contract, launch or links needed.
        </p>
      </div>
    </Section>
  );
}
