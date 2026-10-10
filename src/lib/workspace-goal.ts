import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import { supabase } from "@/integrations/supabase/client";

/**
 * Owner-chosen project goal (presentation / onboarding preference only).
 * Persisted on `workspaces.project_goal`; NULL means "not chosen" and keeps
 * the legacy journey. Never an entitlement or launch/mainnet authorization.
 * Writes rely on the existing owner-only `workspaces_update_owner` RLS policy.
 */
export type ProjectGoal = "community" | "launch" | "both";

export const PROJECT_GOAL_OPTIONS: { value: ProjectGoal; label: string; description: string }[] = [
  {
    value: "community",
    label: "Manage My Community",
    description: "Project identity and your Telegram community. No token launch needed.",
  },
  {
    value: "launch",
    label: "Prepare a Token Launch",
    description: "Project identity and launch basics. A Telegram community is suggested, not required.",
  },
  {
    value: "both",
    label: "Both",
    description: "Project identity, your Telegram community and launch basics.",
  },
];

export function parseProjectGoal(value: unknown): ProjectGoal | null {
  return value === "community" || value === "launch" || value === "both" ? value : null;
}

export function workspaceGoalQueryKey(workspaceId: string | null | undefined) {
  return ["workspace-goal", workspaceId ?? null] as const;
}

/** Throws on transport error; returns null when unset or not readable. */
export async function fetchWorkspaceGoal(workspaceId: string): Promise<ProjectGoal | null> {
  const { data, error } = await supabase
    .from("workspaces")
    .select("project_goal")
    .eq("id", workspaceId)
    .maybeSingle();
  if (error) throw error;
  return parseProjectGoal(data?.project_goal);
}

export function useWorkspaceGoal(workspaceId: string | null | undefined) {
  return useQuery({
    queryKey: workspaceGoalQueryKey(workspaceId),
    enabled: !!workspaceId,
    queryFn: () => fetchWorkspaceGoal(workspaceId!),
  });
}

export function useSetWorkspaceGoal(workspaceId: string | null | undefined) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (goal: ProjectGoal) => {
      if (!workspaceId) throw new Error("No active project.");
      const { data, error } = await supabase
        .from("workspaces")
        .update({ project_goal: goal })
        .eq("id", workspaceId)
        .select("project_goal")
        .maybeSingle();
      if (error) throw error;
      // RLS filters non-owner updates to zero rows rather than erroring.
      if (!data) throw new Error("Only the project owner can change the project goal.");
      return parseProjectGoal(data.project_goal);
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: workspaceGoalQueryKey(workspaceId) });
      void queryClient.invalidateQueries({ queryKey: ["launch-readiness", workspaceId] });
    },
  });
}
