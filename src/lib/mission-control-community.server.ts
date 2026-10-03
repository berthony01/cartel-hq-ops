/**
 * MC-GL — community-scoped Mission Control launch logic (server-only).
 *
 * Pure orchestration over injected dependencies so the exact production logic
 * can be exercised with controlled DB/Telegram doubles. The bridge wires the
 * real service-role client, the existing operator RPC and the live
 * `getChatMember` check into these functions; it adds no authority of its own.
 */
import { parseMissionControlStartParam, type StartParamState } from "./telegram-miniapp-auth.server";

export type CommunityLaunch = {
  connectionId: string;
  workspaceId: string;
  workspaceName: string;
  communityTitle: string;
};

/**
 * Uniform refusal for missing / foreign / revoked / non-admin / failed-admin-API.
 * "unavailable" is reserved for a genuine backend outage (RPC/DB error).
 */
export type CommunityRefusal =
  | { ok: false; reason: "community_launch_invalid" }
  | { ok: false; reason: "community_launch_unavailable" }
  | { ok: false; reason: "unavailable" };

export type StartParamRoute =
  | { kind: "ordinary" }
  | { kind: "community"; connectionId: string }
  | { kind: "invalid" };

const MC_PREFIX = /^mc_/i;

/**
 * absent -> ordinary launch. Present-but-invalid (duplicate/oversized/illegal)
 * -> refusal. Any `mc_` prefix (case-insensitive) must parse to a UUID or it is
 * a refusal. A different well-formed payload is not a Mission Control launch.
 */
export function routeStartParam(startParam: StartParamState): StartParamRoute {
  if (startParam.state === "absent") return { kind: "ordinary" };
  if (startParam.state === "invalid") return { kind: "invalid" };
  if (!MC_PREFIX.test(startParam.value)) return { kind: "ordinary" };
  const connectionId = parseMissionControlStartParam(startParam.value);
  return connectionId ? { kind: "community", connectionId } : { kind: "invalid" };
}

/**
 * Mission Control access needs the bot present and admin in the group (missions
 * are posted/pinned there). `bot_can_change_info` is a chat-title/photo
 * permission used by community branding readiness, NOT by Mission Control —
 * the existing mission authorization paths never required it.
 */
export function communityConnectionOperational(row: Record<string, unknown>): boolean {
  const meta = (row["metadata"] ?? {}) as Record<string, unknown>;
  return (
    row["bot_is_admin"] === true &&
    !meta["bot_removed_at"] &&
    /^-\d+$/.test(String(row["telegram_chat_id"] ?? ""))
  );
}

export type CommunityDeps = {
  /** Existing operator RPC rows for the verified Telegram user. */
  listOperatorWorkspaces: (telegramUserId: number) => Promise<{ rows: unknown[]; error: boolean }>;
  /** telegram_group_connections rows by id (caller limits to 2). */
  findConnection: (connectionId: string) => Promise<{ rows: Record<string, unknown>[]; error: boolean }>;
  /** Live getChatMember administrator/creator check; false on any failure. */
  isChatAdmin: (chatId: string, telegramUserId: number) => Promise<boolean>;
};

const unavailable = (): CommunityRefusal => ({ ok: false, reason: "community_launch_unavailable" });

export async function resolveCommunityLaunchCore(
  deps: CommunityDeps,
  telegramUserId: number,
  connectionId: string,
): Promise<{ ok: true; launch: CommunityLaunch; chatId: string } | CommunityRefusal> {
  const workspaces = await deps.listOperatorWorkspaces(telegramUserId);
  if (workspaces.error) return { ok: false, reason: "unavailable" };
  const authorized = new Map<string, string>();
  for (const raw of workspaces.rows) {
    const r = (raw ?? {}) as Record<string, unknown>;
    const id = String(r["workspace_id"] ?? "").toLowerCase();
    if (/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(id)) {
      authorized.set(id, String(r["workspace_name"] ?? "Workspace"));
    }
  }
  if (authorized.size === 0) return unavailable();

  const found = await deps.findConnection(connectionId);
  if (found.error) return { ok: false, reason: "unavailable" };
  if (found.rows.length !== 1) return unavailable();
  const row = found.rows[0]!;
  const workspaceId = String(row["workspace_id"] ?? "").toLowerCase();
  const chatId = String(row["telegram_chat_id"] ?? "");
  if (!communityConnectionOperational(row) || !authorized.has(workspaceId)) return unavailable();

  // Non-admin and a failed admin API are indistinguishable from foreign/revoked.
  if (!(await deps.isChatAdmin(chatId, telegramUserId))) return unavailable();

  return {
    ok: true,
    chatId,
    launch: {
      connectionId: String(row["id"]),
      workspaceId,
      workspaceName: authorized.get(workspaceId)!,
      communityTitle: String(row["title"] ?? "Community"),
    },
  };
}

export const COMMUNITY_MISSION_LIMIT = 10;

/** Minimal query-builder surface used by the scoped mission read. */
type QueryLike = {
  select: (columns: string) => QueryLike;
  eq: (column: string, value: unknown) => QueryLike;
  order: (column: string, options: { ascending: boolean; nullsFirst: boolean }) => QueryLike;
  limit: (count: number) => PromiseLike<{ data: unknown; error: unknown }>;
};

/**
 * Exact-community LIVE missions: the target chat filter is applied by the
 * database BEFORE ordering/limit (inner join on social_mission_targets), so
 * newer missions in sibling groups of the same workspace cannot crowd it out.
 * Same columns/semantics as social_mission_control_missions, chat-scoped.
 * Callers MUST have already proven launch authority + entitlement.
 */
export async function fetchCommunityLiveMissions(
  from: (table: string) => QueryLike,
  workspaceId: string,
  chatId: string,
): Promise<{ ok: true; rows: Record<string, unknown>[] } | { ok: false }> {
  const { data, error } = await from("social_missions")
    .select("id, started_at, ends_at, social_posts(author_handle), social_mission_targets!inner(telegram_chat_id)")
    .eq("workspace_id", workspaceId)
    .eq("status", "LIVE")
    .eq("social_mission_targets.telegram_chat_id", chatId)
    .order("started_at", { ascending: false, nullsFirst: false })
    .limit(COMMUNITY_MISSION_LIMIT);
  if (error) return { ok: false };
  const rows = (Array.isArray(data) ? data : []).map((raw) => {
    const r = raw as Record<string, unknown>;
    const post = (Array.isArray(r["social_posts"]) ? r["social_posts"][0] : r["social_posts"]) as
      | Record<string, unknown>
      | null
      | undefined;
    return {
      mission_id: r["id"],
      telegram_chat_id: chatId,
      author_handle: post?.["author_handle"] ?? null,
      ends_at: r["ends_at"] ?? null,
      status: "LIVE",
    } as Record<string, unknown>;
  });
  return { ok: true, rows };
}

/* --------------------------------------- exact-mission community binding */

export type CommunityMissionDeps = CommunityDeps & {
  /** social_missions row (id, workspace_id, status) restricted to one workspace. */
  readMission: (
    missionId: string,
    workspaceId: string,
  ) => Promise<{ row: Record<string, unknown> | null; error: boolean }>;
  /** Distinct delivered target chat ids for the mission inside that workspace. */
  readTargetChats: (missionId: string, workspaceId: string) => Promise<{ chats: string[]; error: boolean }>;
};

export type CommunityMissionBinding = {
  workspaceId: string;
  workspaceName: string;
  chatId: string;
  missionId: string;
  missionStatus: string;
};

/**
 * Binds ONE mission to the community of a direct `/missioncontrol` session.
 * The chat comes only from the re-proven launch (verified start_param ->
 * operational connection -> operator workspace -> live admin), never from the
 * mission's other targets, so a mission delivered to several groups can never
 * bind another group's target. A direct mission + target read replaces the
 * workspace-wide LIVE list (limit 10), so newer sibling missions cannot hide it.
 * `requireLive` keeps the existing LIVE-only panel/edit rule; lifecycle passes
 * false so a completed/cancelled replay still reaches the authoritative RPC.
 */
export async function resolveCommunityMissionBindingCore(
  deps: CommunityMissionDeps,
  telegramUserId: number,
  connectionId: string,
  missionId: string,
  options: { requireLive: boolean },
): Promise<{ ok: true; binding: CommunityMissionBinding } | CommunityRefusal | { ok: false; reason: "not_found" }> {
  const launch = await resolveCommunityLaunchCore(deps, telegramUserId, connectionId);
  if (!launch.ok) return launch;
  const workspaceId = launch.launch.workspaceId;
  const mission = await deps.readMission(missionId, workspaceId);
  if (mission.error) return { ok: false, reason: "unavailable" };
  const row = mission.row;
  if (!row || String(row["workspace_id"] ?? "").toLowerCase() !== workspaceId) {
    return { ok: false, reason: "not_found" };
  }
  const status = String(row["status"] ?? "").toUpperCase();
  if (!status || (options.requireLive && status !== "LIVE")) return { ok: false, reason: "not_found" };
  const targets = await deps.readTargetChats(missionId, workspaceId);
  if (targets.error) return { ok: false, reason: "unavailable" };
  if (!targets.chats.includes(launch.chatId)) return { ok: false, reason: "not_found" };
  return {
    ok: true,
    binding: {
      workspaceId,
      workspaceName: launch.launch.workspaceName,
      chatId: launch.chatId,
      missionId,
      missionStatus: status,
    },
  };
}
