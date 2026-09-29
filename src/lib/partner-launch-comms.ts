import { supabase } from "@/integrations/supabase/client";
import { WATCHER_UPDATE_BODY_MAX, WATCHER_UPDATE_TITLE_MAX } from "@/lib/launch-control";

/**
 * SP-B2 V1 — Service Partner Launch Watcher messages (browser wrappers).
 *
 * Calls ONLY the partner_* launch comms RPCs
 * (docs/sql/SP_B2_partner_launch_watcher_comms.sql). The database is the only
 * authority: every RPC requires an accepted, active grant with the
 * launch_watcher_comms scope and checks the launch belongs to the client
 * workspace. Outputs are aggregate counts and update text only — never watcher
 * identities. If the RPCs are not deployed, calls fail closed with a clear message.
 */

export { WATCHER_UPDATE_BODY_MAX, WATCHER_UPDATE_TITLE_MAX };

type LooseRpc = (fn: string, args?: Record<string, unknown>) => Promise<{ data: unknown; error: { message?: string; code?: string } | null }>;
const rpc: LooseRpc = (fn, args) => (supabase.rpc.bind(supabase) as unknown as LooseRpc)(fn, args);

export type PartnerCommsLaunch = {
  launch_id: string;
  token_name: string;
  ticker: string | null;
  status: string;
  launch_at: string | null;
  can_send: boolean;
};

export type PartnerWatcherStats = {
  active_watchers: number;
  updates_enabled_watchers: number;
  updates_muted_watchers: number;
};

export type PartnerWatcherUpdate = {
  event_id: string;
  title: string | null;
  body: string;
  created_at: string;
  pending_count: number;
  sent_count: number;
  failed_count: number;
  ambiguous_count: number;
  skipped_count: number;
};

export const partnerLaunchCommsKeys = {
  all: ["partner-launch-comms"] as const,
  launches: (workspaceId: string | null) => ["partner-launch-comms", "launches", workspaceId] as const,
  stats: (workspaceId: string | null, launchId: string | null) => ["partner-launch-comms", "stats", workspaceId, launchId] as const,
  history: (workspaceId: string | null, launchId: string | null) => ["partner-launch-comms", "history", workspaceId, launchId] as const,
};

export function partnerLaunchCommsErrorMessage(e: unknown): string {
  const msg = (e as { message?: string })?.message ?? "";
  if (/function .* does not exist|PGRST202|schema cache/i.test(msg)) return "Launch Watch messages are not available yet.";
  if (/Not authorized/i.test(msg)) return "Your access to this project does not include Launch Watch messages.";
  const known = [
    "Watcher updates are not available at this lifecycle stage.",
    "Publish the Project Profile before sending watcher updates.",
    "Title must be 120 characters or fewer.",
    "Update text is required.",
    "Update text must be 2200 characters or fewer.",
    "No active watchers currently allow project updates.",
    "Please wait a minute between watcher updates.",
    "Daily watcher update limit reached for this launch.",
  ];
  const hit = known.find((k) => msg.includes(k));
  return hit ?? "Something went wrong. Please try again.";
}

function fail(error: { message?: string } | null): void {
  if (error) throw new Error(partnerLaunchCommsErrorMessage(error));
}

export async function listPartnerCommsLaunches(workspaceId: string): Promise<PartnerCommsLaunch[]> {
  const { data, error } = await rpc("partner_list_launches_for_comms", { _workspace_id: workspaceId });
  fail(error);
  return (Array.isArray(data) ? (data as Record<string, unknown>[]) : []).map((r) => ({
    launch_id: String(r["launch_id"] ?? ""),
    token_name: String(r["token_name"] ?? "Launch"),
    ticker: typeof r["ticker"] === "string" ? r["ticker"] : null,
    status: String(r["status"] ?? ""),
    launch_at: typeof r["launch_at"] === "string" ? r["launch_at"] : null,
    can_send: r["can_send"] === true,
  }));
}

export async function getPartnerWatcherStats(workspaceId: string, launchId: string): Promise<PartnerWatcherStats> {
  const { data, error } = await rpc("partner_launch_watcher_stats", { _workspace_id: workspaceId, _launch_id: launchId });
  fail(error);
  const row = (Array.isArray(data) ? data[0] : null) as Record<string, unknown> | null;
  return {
    active_watchers: Number(row?.["active_watchers"] ?? 0),
    updates_enabled_watchers: Number(row?.["updates_enabled_watchers"] ?? 0),
    updates_muted_watchers: Number(row?.["updates_muted_watchers"] ?? 0),
  };
}

export async function listPartnerWatcherUpdates(workspaceId: string, launchId: string, limit = 10): Promise<PartnerWatcherUpdate[]> {
  const { data, error } = await rpc("partner_list_launch_watcher_updates", { _workspace_id: workspaceId, _launch_id: launchId, _limit: limit });
  fail(error);
  return (Array.isArray(data) ? (data as Record<string, unknown>[]) : []).map((r) => ({
    event_id: String(r["event_id"] ?? ""),
    title: typeof r["title"] === "string" && r["title"].trim() ? r["title"] : null,
    body: String(r["body"] ?? ""),
    created_at: String(r["created_at"] ?? ""),
    pending_count: Number(r["pending_count"] ?? 0),
    sent_count: Number(r["sent_count"] ?? 0),
    failed_count: Number(r["failed_count"] ?? 0),
    ambiguous_count: Number(r["ambiguous_count"] ?? 0),
    skipped_count: Number(r["skipped_count"] ?? 0),
  }));
}

/** Idempotent: the same clientRequestId returns the original event with no second delivery set. */
export async function createPartnerWatcherUpdate(input: {
  workspaceId: string;
  launchId: string;
  clientRequestId: string;
  title: string | null;
  body: string;
}): Promise<string> {
  const { data, error } = await rpc("partner_create_launch_watcher_update", {
    _workspace_id: input.workspaceId,
    _launch_id: input.launchId,
    _client_request_id: input.clientRequestId,
    _title: input.title,
    _body: input.body,
  });
  fail(error);
  return String(data ?? "");
}
