import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import type { Database } from "@/integrations/supabase/types";

/**
 * Step 1C — Community Command Center: READ-ONLY Social Mission read layer.
 *
 * Hard scope guarantees for this module:
 * - Every statement is a `select`. There is NO insert, update, upsert, delete,
 *   rpc or functions.invoke anywhere in this file.
 * - Every read is explicitly filtered to the caller's active workspace id, in
 *   addition to the workspace-member RLS policies already installed on these
 *   tables.
 * - No provider call, no Telegram call, no polling interval, no service role.
 *   Missions are STARTED and CLOSED with `/mission` in Telegram; HQ observes.
 * - Unknown metrics stay `null`. Nothing is coerced to zero.
 */

type Tables = Database["public"]["Tables"];

export type MissionRow = Tables["social_missions"]["Row"];
export type MissionTargetRow = Tables["social_mission_targets"]["Row"];
export type MissionScheduleEventRow = Tables["social_mission_schedule_events"]["Row"];
export type MissionMetricSnapshotRow = Tables["social_metric_snapshots"]["Row"];

/** How many missions the panel reads at once. Bounded, not paginated. */
export const MISSION_READ_LIMIT = 25;

export type MissionTargetView = MissionTargetRow & {
  /** Connected community title when the group is still connected, else null. */
  groupTitle: string | null;
};

export type MissionView = {
  mission: MissionRow;
  /** Canonical X URL of the source post, when the post row is readable. */
  canonicalUrl: string | null;
  authorHandle: string | null;
  targets: MissionTargetView[];
  scheduleEvents: MissionScheduleEventRow[];
  /** Most recent stored snapshot only. Never fetched from a provider here. */
  latestSnapshot: MissionMetricSnapshotRow | null;
};

export const socialMissionKeys = {
  all: ["social-missions"] as const,
  workspaceOverview: (workspaceId: string | null) =>
    ["social-missions", "workspace-overview", workspaceId ?? "none"] as const,
};

/**
 * One bounded, read-only snapshot of the workspace's mission state assembled
 * from the existing tables. No new backend object is required.
 */
export async function fetchWorkspaceMissionOverview(
  workspaceId: string,
): Promise<MissionView[]> {
  const { data: missions, error: missionsError } = await supabase
    .from("social_missions")
    .select("*")
    .eq("workspace_id", workspaceId)
    .order("created_at", { ascending: false })
    .limit(MISSION_READ_LIMIT);
  if (missionsError) throw missionsError;
  const missionRows = missions ?? [];
  if (missionRows.length === 0) return [];

  const missionIds = missionRows.map((m) => m.id);
  const postIds = Array.from(new Set(missionRows.map((m) => m.social_post_id).filter(Boolean)));

  const [targetsRes, eventsRes, postsRes, groupsRes, snapshotsRes] = await Promise.all([
    supabase
      .from("social_mission_targets")
      .select("*")
      .eq("workspace_id", workspaceId)
      .in("mission_id", missionIds),
    supabase
      .from("social_mission_schedule_events")
      .select("*")
      .eq("workspace_id", workspaceId)
      .in("mission_id", missionIds)
      .order("sequence_no", { ascending: true }),
    postIds.length > 0
      ? supabase
          .from("social_posts")
          .select("id,canonical_url,author_handle")
          .eq("workspace_id", workspaceId)
          .in("id", postIds)
      : Promise.resolve({ data: [], error: null } as const),
    supabase
      .from("telegram_group_connections")
      .select("telegram_chat_id,title")
      .eq("workspace_id", workspaceId),
    supabase
      .from("social_metric_snapshots")
      .select("*")
      .eq("workspace_id", workspaceId)
      .in("mission_id", missionIds)
      .order("observed_at", { ascending: false }),
  ]);

  if (targetsRes.error) throw targetsRes.error;
  if (eventsRes.error) throw eventsRes.error;
  if (postsRes.error) throw postsRes.error;
  if (groupsRes.error) throw groupsRes.error;
  if (snapshotsRes.error) throw snapshotsRes.error;

  const postById = new Map(
    (postsRes.data ?? []).map((p) => [p.id, { url: p.canonical_url, handle: p.author_handle }]),
  );
  const groupTitleByChatId = new Map(
    (groupsRes.data ?? []).map((g) => [String(g.telegram_chat_id), g.title]),
  );

  return missionRows.map((mission) => {
    const post = postById.get(mission.social_post_id) ?? null;
    const targets = (targetsRes.data ?? [])
      .filter((t) => t.mission_id === mission.id)
      .map((t) => ({
        ...t,
        groupTitle: groupTitleByChatId.get(String(t.telegram_chat_id)) ?? null,
      }));
    const scheduleEvents = (eventsRes.data ?? []).filter((e) => e.mission_id === mission.id);
    // Already ordered newest-first by the query; take the first match.
    const latestSnapshot =
      (snapshotsRes.data ?? []).find((s) => s.mission_id === mission.id) ?? null;
    return {
      mission,
      canonicalUrl: post?.url ?? null,
      authorHandle: post?.handle ?? null,
      targets,
      scheduleEvents,
      latestSnapshot,
    };
  });
}

/**
 * Read-only mission state for the active workspace. There is deliberately no
 * `refetchInterval`: this phase does not poll.
 */
export function useWorkspaceMissions(workspaceId: string | null) {
  return useQuery({
    queryKey: socialMissionKeys.workspaceOverview(workspaceId),
    enabled: !!workspaceId,
    queryFn: () => fetchWorkspaceMissionOverview(workspaceId!),
    staleTime: 30_000,
  });
}

/* -------------------------------------------------------------------------- */
/* Pure presentation helpers (no I/O)                                          */
/* -------------------------------------------------------------------------- */

export const MISSION_OPERATOR_GUIDANCE = {
  start: "Start: /mission <X link>",
  close: "Close: /mission close",
  where: "Run both in your connected Telegram community. CARTEL HQ only reports state here.",
} as const;

export type MissionTone = "gold" | "green" | "red" | "muted";

export function missionStatusTone(status: string): MissionTone {
  switch (status.toUpperCase()) {
    case "LIVE":
      return "green";
    case "COMPLETED":
      return "muted";
    case "COMPLETED_UNSYNCED":
    case "UNRESOLVED":
    case "FAILED":
      return "red";
    default:
      return "gold";
  }
}

export function deliveryTone(state: string): MissionTone {
  switch (state.toUpperCase()) {
    case "SENT":
    case "EDITED":
      return "green";
    case "FAILED":
      return "red";
    case "AMBIGUOUS":
      return "gold";
    default:
      return "muted";
  }
}

export function eventStateTone(state: string): MissionTone {
  switch (state.toUpperCase()) {
    case "SENT":
    case "DONE":
      return "green";
    case "FAILED":
      return "red";
    case "AMBIGUOUS":
      return "gold";
    case "CANCELLED":
      return "muted";
    default:
      return "muted";
  }
}

export function isMissionActive(mission: MissionRow): boolean {
  return mission.status.toUpperCase() === "LIVE" && !mission.completed_at;
}

/** Derived purely from stored timestamps and the current clock. No I/O. */
export function missionTimeRemaining(
  mission: MissionRow,
  now: number = Date.now(),
): { label: string; expired: boolean } {
  if (mission.completed_at) return { label: "Completed", expired: true };
  if (!mission.ends_at) return { label: "Not started", expired: false };
  const endsAt = new Date(mission.ends_at).getTime();
  if (Number.isNaN(endsAt)) return { label: "Unknown", expired: false };
  const remainingMs = endsAt - now;
  if (remainingMs <= 0) return { label: "Window ended", expired: true };
  const minutes = Math.floor(remainingMs / 60_000);
  const seconds = Math.floor((remainingMs % 60_000) / 1000);
  return { label: `${minutes}m ${String(seconds).padStart(2, "0")}s left`, expired: false };
}

export function formatMissionTime(value: string | null): string {
  if (!value) return "—";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "—";
  return date.toLocaleString(undefined, {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

/** Unknown stays unknown: null is rendered as an em dash, never as 0. */
export function formatMetric(value: number | null | undefined): string {
  return typeof value === "number" ? value.toLocaleString() : "—";
}

export type MissionRollup = {
  total: number;
  active: number;
  completed: number;
  other: number;
  deliverySent: number;
  deliveryFailed: number;
  deliveryAmbiguous: number;
  deliveryPending: number;
};

export function rollupMissions(views: MissionView[]): MissionRollup {
  const rollup: MissionRollup = {
    total: views.length,
    active: 0,
    completed: 0,
    other: 0,
    deliverySent: 0,
    deliveryFailed: 0,
    deliveryAmbiguous: 0,
    deliveryPending: 0,
  };
  for (const view of views) {
    const status = view.mission.status.toUpperCase();
    if (isMissionActive(view.mission)) rollup.active += 1;
    else if (status === "COMPLETED") rollup.completed += 1;
    else rollup.other += 1;

    for (const target of view.targets) {
      switch (target.delivery_state.toUpperCase()) {
        case "SENT":
          rollup.deliverySent += 1;
          break;
        case "FAILED":
          rollup.deliveryFailed += 1;
          break;
        case "AMBIGUOUS":
          rollup.deliveryAmbiguous += 1;
          break;
        default:
          rollup.deliveryPending += 1;
      }
    }
  }
  return rollup;
}
