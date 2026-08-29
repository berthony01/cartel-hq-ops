import { useQuery } from "@tanstack/react-query";
import {
  fetchPlatformStatus,
  platformErrorMessage,
  type PlatformMetrics,
  type PlatformRole,
} from "@/lib/platform";

export const platformStatusQueryKey = ["platform-status"] as const;

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
export function usePlatformAccess(): PlatformAccess {
  const query = useQuery({
    queryKey: platformStatusQueryKey,
    queryFn: fetchPlatformStatus,
    staleTime: 60_000,
    retry: false,
  });

  const data = query.data;
  const ok = !query.isError && !!data;

  return {
    loading: query.isPending,
    error: query.isError ? platformErrorMessage(query.error) : null,
    isPlatformOwner: ok && data.isPlatformOwner === true,
    hasUnrestrictedAccess: ok && data.hasUnrestrictedAccess === true,
    role: ok ? data.role : null,
    capabilities: ok ? data.capabilities : [],
    metrics: ok && data.isPlatformOwner ? data.metrics : null,
  };
}
