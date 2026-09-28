import { useEffect, useRef } from "react";
import { toast } from "sonner";
import { useSession } from "@/hooks/useSession";
import { useWorkspace } from "@/lib/workspace-context";
import { bindReferralToWorkspace, claimStoredReferralToken } from "@/lib/partners";

/**
 * Invisible. Atomically claims a locally stored server-issued referral token
 * once per signed-in user (covers email-confirmation callback and later
 * sign-in on the same browser), then asks the database to bind the referral
 * to the active workspace only when the current user owns it. The database is
 * the security boundary; this never grants workspace permissions/memberships.
 */
export function ReferralAttributionBridge() {
  const { user } = useSession();
  const { workspace } = useWorkspace();
  const userId = user?.id ?? null;
  const claimedFor = useRef<string | null>(null);
  const boundKey = useRef<string | null>(null);

  useEffect(() => {
    if (!userId) return;
    let cancelled = false;
    (async () => {
      if (claimedFor.current !== userId) {
        claimedFor.current = userId;
        await claimStoredReferralToken();
      }
      if (cancelled || !workspace || workspace.owner_id !== userId) return;
      const key = `${userId}:${workspace.id}`;
      if (boundKey.current === key) return;
      boundKey.current = key;
      const result = await bindReferralToWorkspace(workspace.id);
      if (!cancelled && result?.bound === true && result.assignment_marked === true) {
        toast.success("Referral linked to your project");
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [userId, workspace]);

  return null;
}
