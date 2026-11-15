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

/**
 * How this project uses token-launch tools. This is self-reported guidance only,
 * NOT evidence of on-chain launch, verified contract or deployment permission.
 */
export type LaunchPath =
  | "external_planned"
  | "external_live"
  | "cartel_supported"
  | "management_only";

export const LAUNCH_PATH_OPTIONS: ReadonlyArray<{ value: LaunchPath; label: string; description: string }> = [
  { value: "external_planned", label: "Launching somewhere else", description: "Use a launchpad or independent contract. No Cartel HQ launch draft is required." },
  { value: "external_live", label: "Already launched elsewhere", description: "Manage an existing token. This is self-reported and is not contract verification." },
  { value: "cartel_supported", label: "Use Cartel HQ's supported launch workflow", description: "Prepare a Cartel HQ launch using supported deployment permissions and evidence." },
  { value: "management_only", label: "Project management only", description: "Run your project and community without a token-launch checklist." },
];

export function parseLaunchPath(value: unknown): LaunchPath | null {
  return value === "external_planned" ||
    value === "external_live" ||
    value === "cartel_supported" ||
    value === "management_only"
    ? value : null;
}

export function isNonCartelLaunchPath(value: LaunchPath | null | undefined): boolean {
  return value === "external_planned" || value === "external_live" || value === "management_only";
}

export type WorkspaceSetup = { goal: ProjectGoal | null; launchPath: LaunchPath | null };

export function workspaceSetupQueryKey(workspaceId: string | null | undefined) {
  return ["workspace-setup", workspaceId ?? null] as const;
}

export async function fetchWorkspaceSetup(workspaceId: string): Promise<WorkspaceSetup> {
  const { data, error } = await supabase
    .from("workspaces")
    .select("project_goal,launch_path")
    .eq("id", workspaceId)
    .maybeSingle();
  if (error) throw error;
  return { goal: parseProjectGoal(data?.project_goal), launchPath: parseLaunchPath(data?.launch_path) };
}

export function useWorkspaceSetup(workspaceId: string | null | undefined) {
  return useQuery({
    queryKey: workspaceSetupQueryKey(workspaceId),
    enabled: !!workspaceId,
    queryFn: () => fetchWorkspaceSetup(workspaceId!),
  });
}

export function useSetWorkspaceLaunchPath(workspaceId: string | null | undefined) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (launchPath: LaunchPath) => {
      if (!workspaceId) throw new Error("No active project.");
      const { data, error } = await supabase
        .from("workspaces")
        .update({ launch_path: launchPath })
        .eq("id", workspaceId)
        .select("launch_path")
        .maybeSingle();
      if (error) throw error;
      if (!data) throw new Error("Only the project owner can choose the launch path.");
      return parseLaunchPath(data.launch_path);
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: workspaceSetupQueryKey(workspaceId) });
      void queryClient.invalidateQueries({ queryKey: ["launch-readiness", workspaceId] });
    },
  });
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
      void queryClient.invalidateQueries({ queryKey: workspaceSetupQueryKey(workspaceId) });
      void queryClient.invalidateQueries({ queryKey: ["launch-readiness", workspaceId] });
    },
  });
}
