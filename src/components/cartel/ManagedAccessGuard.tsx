import type { ReactNode } from "react";
import { Link, useRouterState } from "@tanstack/react-router";
import { ShieldAlert } from "lucide-react";
import { useWorkspace } from "@/lib/workspace-context";
import { isManagedAllowedPath, PARTNER_DENIED_AREAS } from "@/lib/partner-client-access";
import { Section } from "@/components/cartel/Section";
import { Button } from "@/components/ui/button";

/**
 * SP-A presentation guard. When the active project is a Service Partner managed
 * client project, only SP-A-supported routes render; everything else shows a
 * clear no-access state instead of empty or broken screens. The database (RLS +
 * SP-A RPCs) remains the security boundary: partners are never workspace members.
 */
export function ManagedAccessGuard({ children }: { children: ReactNode }) {
  const { isManaged, workspace } = useWorkspace();
  const pathname = useRouterState({ select: (s) => s.location.pathname });

  if (!isManaged || isManagedAllowedPath(pathname)) return <>{children}</>;

  return (
    <Section
      variant="primary"
      title="Not included in your access"
      leading={<ShieldAlert className="size-4" aria-hidden="true" />}
      description={`You are working in ${workspace?.name ?? "a client project"} as a Service Partner. Your access to this project doesn't include this area.`}
    >
      <div className="space-y-4">
        <div className="flex flex-wrap gap-2">
          <Button asChild className="min-h-11">
            <Link to="/project-profile">Open Project Profile</Link>
          </Button>
          <Button asChild variant="outline" className="min-h-11">
            <Link to="/partners">Managed projects</Link>
          </Button>
        </div>
        <div>
          <p className="type-eyebrow text-muted-foreground">Never available to Service Partners</p>
          <ul className="mt-2 list-disc space-y-1 pl-5 text-sm text-muted-foreground">
            {PARTNER_DENIED_AREAS.map((a) => (
              <li key={a}>{a}</li>
            ))}
          </ul>
        </div>
      </div>
    </Section>
  );
}
