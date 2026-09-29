import { createContext, useContext, useEffect, useMemo, type ReactNode } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useSession } from "@/hooks/useSession";
import {
  fetchManagedWorkspaces,
  partnerClientKeys,
  type PartnerClientScope,
} from "@/lib/partner-client-access";

export type Workspace = {
  id: string;
  name: string;
  slug: string | null;
  owner_id: string;
  created_at: string;
  /** "member" = owned/joined via workspace_members (unchanged). "managed" = SP-A partner access. */
  access?: "member" | "managed";
  /** Only for managed projects: owner-granted Service Partner scopes. */
  scopes?: PartnerClientScope[];
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
  /** True when the active project is a Service Partner managed client project. */
  isManaged: boolean;
  loading: boolean;
  error: Error | null;
  selectWorkspace: (id: string) => void;
  refresh: () => void;
};

const WorkspaceContext = createContext<WorkspaceContextValue | null>(null);

export function WorkspaceProvider({ children }: { children: ReactNode }) {
  const queryClient = useQueryClient();
  const { user } = useSession();
  const userId = user?.id ?? null;
  const { data, isLoading, error, refetch } = useWorkspacesQuery();
  // SP-A: fails closed to [] when the RPC is absent or errors.
  const managedQuery = useQuery({
    queryKey: partnerClientKeys.managed(userId),
    queryFn: fetchManagedWorkspaces,
    enabled: !!userId,
    staleTime: 30_000,
  });

  const workspaces = useMemo(() => {
    const own: Workspace[] = (data ?? []).map((w) => ({ ...w, access: "member" as const }));
    const ownIds = new Set(own.map((w) => w.id));
    // A workspace the user already belongs to keeps its normal membership behavior.
    const managed: Workspace[] = (managedQuery.data ?? [])
      .filter((m) => !ownIds.has(m.workspace_id))
      .map((m) => ({
        id: m.workspace_id,
        name: m.workspace_name,
        slug: null,
        owner_id: "",
        created_at: m.created_at,
        access: "managed" as const,
        scopes: m.scopes,
      }));
    return [...own, ...managed];
  }, [data, managedQuery.data]);

  // Validate the persisted selection against what the user can actually access.
  const stored = typeof window === "undefined" ? null : readStoredWorkspaceId();
  const workspace =
    workspaces.find((w) => w.id === stored) ?? workspaces[0] ?? null;

  useEffect(() => {
    if (managedQuery.isPending && !!userId) return; // don't discard a managed selection mid-load
    if (workspace && workspace.id !== stored) writeStoredWorkspaceId(workspace.id);
    if (!workspace && stored) writeStoredWorkspaceId(null);
  }, [workspace, stored, managedQuery.isPending, userId]);

  const value: WorkspaceContextValue = {
    workspaces,
    workspace,
    workspaceId: workspace?.id ?? null,
    isManaged: workspace?.access === "managed",
    loading: isLoading || (!!userId && managedQuery.isPending),
    error: (error as Error | null) ?? null,
    selectWorkspace: (id: string) => {
      if (!workspaces.some((w) => w.id === id)) return;
      writeStoredWorkspaceId(id);
      queryClient.invalidateQueries();
    },
    refresh: () => {
      void refetch();
      void managedQuery.refetch();
    },
  };

  return <WorkspaceContext.Provider value={value}>{children}</WorkspaceContext.Provider>;
}

export function useWorkspace(): WorkspaceContextValue {
  const ctx = useContext(WorkspaceContext);
  if (!ctx) throw new Error("useWorkspace must be used inside WorkspaceProvider");
  return ctx;
}
