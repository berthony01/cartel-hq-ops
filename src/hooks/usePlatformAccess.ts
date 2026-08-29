import { useQuery } from "@tanstack/react-query";
import { useSession } from "@/hooks/useSession";
import {
  fetchPlatformStatus,
  platformErrorMessage,
  type PlatformMetrics,
  type PlatformRole,
} from "@/lib/platform";

export const platformStatusQueryKey = (userId: string | null | undefined) =>
  ["platform-status", userId ?? "anonymous"] as const;

export type PlatformAccess = {
  loading: boolean;
  error: string | null;
  isPlatformOwner: boolean;
  hasUnrestrictedAccess: boolean;
  role: PlatformRole | null;
  capabilities: string[];
  metrics: PlatformMetrics | null;
};

/**
 * Cached, server-verified platform access. Fails CLOSED: any error, any
 * pending state and any unexpected payload resolve to "not an owner".
 */
export function usePlatformAccess(options?: { fresh?: boolean }): PlatformAccess {
  const fresh = options?.fresh === true;
  const { user, loading: sessionLoading } = useSession();
  const userId = user?.id ?? null;
  const enabled = !sessionLoading && !!userId;

  const query = useQuery({
    queryKey: platformStatusQueryKey(userId),
    queryFn: fetchPlatformStatus,
    enabled,
    staleTime: fresh ? 0 : 60_000,
    refetchOnMount: fresh ? "always" : true,
    retry: false,
  });

  const data = query.data;
  const ok = enabled && !query.isError && data !== undefined;
  const loading =
    sessionLoading || !userId || query.isPending || (fresh && query.isFetching);

  if (loading) {
    return {
      loading: true,
      error: null,
      isPlatformOwner: false,
      hasUnrestrictedAccess: false,
      role: null,
      capabilities: [],
      metrics: null,
    };
  }

  return {
    loading: false,
    error: query.isError ? platformErrorMessage(query.error) : null,
    isPlatformOwner: ok ? data.isPlatformOwner === true : false,
    hasUnrestrictedAccess: ok ? data.hasUnrestrictedAccess === true : false,
    role: ok ? data.role : null,
    capabilities: ok ? data.capabilities : [],
    metrics: ok && data.isPlatformOwner ? data.metrics : null,
  };
}
