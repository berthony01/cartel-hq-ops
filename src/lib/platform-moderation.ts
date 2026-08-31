import { supabase } from "@/integrations/supabase/client";
import type { Database } from "@/integrations/supabase/types";

/**
 * Phase 9B — platform-owner Cartel Network moderation data layer.
 *
 * Browser access is RPC-only. There are NO direct reads or writes of
 * `public.project_network_moderation`: the table is service-private, and the
 * owner-gated SECURITY DEFINER RPCs from Phase 9A are the only entry points.
 *
 * The moderation hold is a reversible platform visibility override. It never
 * changes the project's own `discovery_status`, verification state, launch
 * lifecycle, Launch Watch subscriptions or stored history.
 */

type Fns = Database["public"]["Functions"];

export type PlatformNetworkModerationRow =
  Fns["get_platform_network_moderation"]["Returns"][number];
export type SetProjectNetworkModerationResult =
  Fns["set_project_network_moderation"]["Returns"][number];

/** Max internal reason length accepted by the server (trimmed server-side). */
export const MODERATION_REASON_MAX = 500;

export const platformModerationKeys = {
  all: () => ["platform-network-moderation"] as const,
  directory: () => ["platform-network-moderation", "directory"] as const,
};

export async function fetchPlatformNetworkModeration(): Promise<
  PlatformNetworkModerationRow[]
> {
  const { data, error } = await supabase.rpc("get_platform_network_moderation");
  if (error) throw error;
  return data ?? [];
}

/**
 * Platform-owner-only visibility override.
 *
 * When restoring, omitting the reason preserves the previously recorded
 * internal reason server-side.
 */
export async function setProjectNetworkModeration(
  projectProfileId: string,
  hidden: boolean,
  internalReason?: string | null,
): Promise<SetProjectNetworkModerationResult | null> {
  const reason = (internalReason ?? "").trim().slice(0, MODERATION_REASON_MAX);
  const { data, error } = await supabase.rpc("set_project_network_moderation", {
    _project_profile_id: projectProfileId,
    _hidden: hidden,
    ...(reason ? { _internal_reason: reason } : {}),
  });
  if (error) throw error;
  return data?.[0] ?? null;
}
