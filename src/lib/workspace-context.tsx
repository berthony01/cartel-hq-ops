import { createContext, useContext, useEffect, useMemo, type ReactNode } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";

export type Workspace = {
  id: string;
  name: string;
  slug: string | null;
  owner_id: string;
  created_at: string;
};

const STORAGE_KEY = "cartel-hq:active-workspace";

export function readStoredWorkspaceId(): string | null {
  if (typeof window === "undefined") return null;
  try {
    return window.localStorage.getItem(STORAGE_KEY);
  } catch {
    return null;
  }
}

export function writeStoredWorkspaceId(id: string | null) {
  if (typeof window === "undefined") return;
  try {
    if (id) window.localStorage.setItem(STORAGE_KEY, id);
    else window.localStorage.removeItem(STORAGE_KEY);
  } catch {
    /* storage unavailable */
  }
}

export const workspacesQueryKey = ["workspaces"] as const;

export function useWorkspacesQuery() {
  return useQuery({
    queryKey: workspacesQueryKey,
    queryFn: async (): Promise<Workspace[]> => {
      const { data, error } = await supabase
        .from("workspaces")
        .select("id,name,slug,owner_id,created_at")
        .order("created_at", { ascending: true });
      if (error) throw error;
      return data ?? [];
    },
  });
}

type WorkspaceContextValue = {
  workspaces: Workspace[];
  workspace: Workspace | null;
  workspaceId: string | null;
  loading: boolean;
  error: Error | null;
  selectWorkspace: (id: string) => void;
  refresh: () => void;
};

const WorkspaceContext = createContext<WorkspaceContextValue | null>(null);

export function WorkspaceProvider({ children }: { children: ReactNode }) {
  const queryClient = useQueryClient();
  const { data, isLoading, error, refetch } = useWorkspacesQuery();
  const workspaces = useMemo(() => data ?? [], [data]);

  // Validate the persisted selection against what the user can actually access.
  const stored = typeof window === "undefined" ? null : readStoredWorkspaceId();
  const workspace =
    workspaces.find((w) => w.id === stored) ?? workspaces[0] ?? null;

  useEffect(() => {
    if (workspace && workspace.id !== stored) writeStoredWorkspaceId(workspace.id);
    if (!workspace && stored) writeStoredWorkspaceId(null);
  }, [workspace, stored]);

  const value: WorkspaceContextValue = {
    workspaces,
    workspace,
    workspaceId: workspace?.id ?? null,
    loading: isLoading,
    error: (error as Error | null) ?? null,
    selectWorkspace: (id: string) => {
      if (!workspaces.some((w) => w.id === id)) return;
      writeStoredWorkspaceId(id);
      queryClient.invalidateQueries();
    },
    refresh: () => void refetch(),
  };

  return <WorkspaceContext.Provider value={value}>{children}</WorkspaceContext.Provider>;
}

export function useWorkspace(): WorkspaceContextValue {
  const ctx = useContext(WorkspaceContext);
  if (!ctx) throw new Error("useWorkspace must be used inside WorkspaceProvider");
  return ctx;
}
