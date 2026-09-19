/**
 * SE-16.0 — Telegram Mini App bridge (server functions, admin-only V1).
 *
 * Every endpoint here runs WITHOUT a Supabase JWT, because a Telegram Mini App
 * user has none. Telegram `initData` verification is therefore the mandatory
 * first gate on EVERY call, followed by the same three-gate chain the SE-15
 * bot path uses:
 *   1. validated Telegram user id (from the signature only),
 *   2. operator eligibility + authoritative chat binding through the existing
 *      service-only Mission Control RPCs — the client NEVER supplies a chat id,
 *   3. a LIVE `getChatMember` administrator/creator check in that exact chat.
 *
 * Valid, fresh initData is treated as a short-lived signed session credential:
 * it may back several calls. Replay safety for mutations comes from a bounded
 * deterministic idempotency key handed to the existing SE-15 RPCs, not from a
 * global one-use cache.
 *
 * No new table, no new RPC, no schema change, no provider/X read, and no
 * second Telegram finalization path: END NOW and CANCEL stay disabled here.
 */

import { createServerFn } from "@tanstack/react-start";
import {
  isCurrentChatAdmin,
  isRequestId,
  isUuid,
  miniAppIdempotencyKey,
  validateTelegramInitData,
} from "./telegram-miniapp-auth.server";

/** Existing SE-15 service-only RPCs. This bridge reuses them; it defines none. */
export const MINIAPP_RPC = {
  workspaces: "social_mission_control_workspaces",
  missions: "social_mission_control_missions",
  panel: "social_mission_control_panel",
  applyTargets: "social_mission_apply_target_override",
  applyDuration: "social_mission_apply_duration_override",
} as const;

/**
 * END NOW / CANCEL are intentionally NOT implemented in bridge V1: the bot
 * path also edits the mission card, takes the final snapshot and safely unpins
 * it. Duplicating that would create a second finalization path.
 */
export const MINIAPP_DISABLED_ACTIONS = {
  end_now: "bot_finalize_required",
  cancel: "bot_finalize_required",
} as const;

export const MINIAPP_BRIDGE_VERSION = "v1";
export const MINIAPP_NOT_ENABLED = "not_enabled_in_bridge_v1";

export const MINIAPP_METRICS = ["views", "likes", "replies", "reposts", "bookmarks"] as const;
export type MiniAppMetric = (typeof MINIAPP_METRICS)[number];

/** Snapshot column -> Mission Control metric name. */
export const MINIAPP_METRIC_COLUMNS: Record<MiniAppMetric, string> = {
  views: "views",
  likes: "likes",
  replies: "comments",
  reposts: "shares",
  bookmarks: "saves",
};

export const MINIAPP_PRIMARY_TYPES = [
  "VIEWS",
  "LIKES",
  "REPLIES",
  "REPOSTS",
  "TOTAL_INTERACTIONS",
] as const;

export type MiniAppFailure = { ok: false; reason: string };

export type MiniAppWorkspace = { workspaceId: string; workspaceName: string; liveMissions: number };
export type MiniAppMission = {
  missionId: string;
  authorHandle: string | null;
  endsAt: string | null;
  status: string;
};
export type MiniAppPanel = {
  ok: true;
  missionId: string;
  workspaceName: string;
  authorHandle: string | null;
  canonicalUrl: string | null;
  status: string;
  endsAt: string | null;
  controlMode: string;
  primaryType: string;
  primaryTarget: number | null;
  targets: Record<MiniAppMetric, number | null>;
  /** Latest STORED snapshot. `null` means unavailable — never coerced to 0. */
  results: Record<MiniAppMetric, number | null>;
  capabilities: { endNow: string; cancel: string };
};

function fail(reason: string): MiniAppFailure {
  return { ok: false, reason };
}

/** Positive whole numbers only; anything else is "not set". */
function positiveInt(value: unknown): number | null {
  const n = Number(value);
  return Number.isSafeInteger(n) && n > 0 ? n : null;
}

/** Null-honest snapshot read: a missing row or null column stays null. */
function snapshotValue(row: Record<string, unknown> | null, column: string): number | null {
  if (!row) return null;
  const raw = row[column];
  if (raw === null || raw === undefined) return null;
  const n = Number(raw);
  return Number.isFinite(n) ? Math.trunc(n) : null;
}

/**
 * SE-16.1H2 — Mission status fidelity. The panel status comes from the RPC
 * result (public.social_mission_control_panel returns v_m.status) and is
 * passed through unchanged. A missing/unusable value falls back to a neutral
 * "UNKNOWN" — LIVE is never fabricated here. The mission-LIST mapping keeps
 * its "LIVE" fallback because that RPC is filtered to m.status = 'LIVE'.
 */
function panelStatus(raw: unknown): string {
  const value = String(raw ?? "").trim().toUpperCase();
  return value.length > 0 ? value : "UNKNOWN";
}

/** Bot token is read per-request from server env only, never at module scope. */
function botToken(): string {
  return process.env["TELEGRAM_BOT_TOKEN"] ?? "";
}

type AdminClient = { rpc: (name: string, args: Record<string, unknown>) => Promise<{ data: unknown; error: unknown }>; from: (table: string) => any };

async function adminClient(): Promise<AdminClient> {
  // Loaded inside the handler: a top-level import of the service-role client
  // from a *.functions.ts module would enter the client graph.
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  return supabaseAdmin as unknown as AdminClient;
}

type Binding = {
  workspaceId: string;
  workspaceName: string;
  chatId: string;
  missionId: string;
};

/**
 * Resolves mission -> workspace + authoritative Telegram chat using ONLY the
 * operator-scoped RPCs, so a non-operator can never learn a mission exists and
 * a client-sent chat id can never be honoured.
 */
async function resolveBinding(
  admin: AdminClient,
  telegramUserId: number,
  missionId: string,
): Promise<Binding | null> {
  const { data: workspaces, error } = await admin.rpc(MINIAPP_RPC.workspaces, {
    _telegram_user_id: telegramUserId,
  });
  if (error) return null;
  for (const workspace of Array.isArray(workspaces) ? workspaces : []) {
    const ws = workspace as Record<string, unknown>;
    const workspaceId = String(ws["workspace_id"] ?? "");
    if (!workspaceId) continue;
    const { data: missions } = await admin.rpc(MINIAPP_RPC.missions, {
      _telegram_user_id: telegramUserId,
      _workspace_id: workspaceId,
    });
    const hit = (Array.isArray(missions) ? missions : []).find(
      (m) => String((m as Record<string, unknown>)["mission_id"]) === missionId,
    ) as Record<string, unknown> | undefined;
    if (hit) {
      return {
        workspaceId,
        workspaceName: String(ws["workspace_name"] ?? "Workspace"),
        chatId: String(hit["telegram_chat_id"] ?? ""),
        missionId,
      };
    }
  }
  return null;
}

/** Gates 1-3. Returns the verified binding or a bounded refusal reason. */
async function authorizeMission(
  initData: unknown,
  missionId: unknown,
): Promise<
  | { ok: true; admin: AdminClient; telegramUserId: number; binding: Binding }
  | MiniAppFailure
> {
  const token = botToken();
  const auth = await validateTelegramInitData(initData, token);
  if (!auth.ok) return fail(auth.reason);
  if (!isUuid(missionId)) return fail("invalid_mission_id");

  const admin = await adminClient();
  const binding = await resolveBinding(admin, auth.user.id, missionId);
  if (!binding || !binding.chatId) return fail("not_found");

  // Fresh live admin check in the mission's OWN chat. Fails closed.
  const isAdmin = await isCurrentChatAdmin(token, binding.chatId, auth.user.id);
  if (!isAdmin) return fail("not_group_admin");

  return { ok: true, admin, telegramUserId: auth.user.id, binding };
}

/* ------------------------------------------------------------------ READS */

export const miniAppListMissionWorkspaces = createServerFn({ method: "POST" })
  .inputValidator((input: { initData: string }) => input)
  .handler(async ({ data }): Promise<{ ok: true; workspaces: MiniAppWorkspace[] } | MiniAppFailure> => {
    const auth = await validateTelegramInitData(data?.initData, botToken());
    if (!auth.ok) return fail(auth.reason);

    const admin = await adminClient();
    const { data: rows, error } = await admin.rpc(MINIAPP_RPC.workspaces, {
      _telegram_user_id: auth.user.id,
    });
    if (error) return fail("unavailable");

    return {
      ok: true,
      workspaces: (Array.isArray(rows) ? rows : []).map((row) => {
        const r = row as Record<string, unknown>;
        return {
          workspaceId: String(r["workspace_id"] ?? ""),
          workspaceName: String(r["workspace_name"] ?? "Workspace"),
          liveMissions: positiveInt(r["live_missions"]) ?? 0,
        };
      }),
    };
  });

export const miniAppListMissions = createServerFn({ method: "POST" })
  .inputValidator((input: { initData: string; workspaceId: string }) => input)
  .handler(async ({ data }): Promise<{ ok: true; missions: MiniAppMission[] } | MiniAppFailure> => {
    const auth = await validateTelegramInitData(data?.initData, botToken());
    if (!auth.ok) return fail(auth.reason);
    if (!isUuid(data?.workspaceId)) return fail("invalid_workspace_id");

    const admin = await adminClient();
    const { data: rows, error } = await admin.rpc(MINIAPP_RPC.missions, {
      _telegram_user_id: auth.user.id,
      _workspace_id: data.workspaceId,
    });
    if (error) return fail("unavailable");

    return {
      ok: true,
      missions: (Array.isArray(rows) ? rows : []).map((row) => {
        const r = row as Record<string, unknown>;
        return {
          missionId: String(r["mission_id"] ?? ""),
          authorHandle: r["author_handle"] ? String(r["author_handle"]) : null,
          endsAt: r["ends_at"] ? String(r["ends_at"]) : null,
          status: String(r["status"] ?? "LIVE"),
        };
      }),
    };
  });

export const miniAppMissionPanel = createServerFn({ method: "POST" })
  .inputValidator((input: { initData: string; missionId: string }) => input)
  .handler(async ({ data }): Promise<MiniAppPanel | MiniAppFailure> => {
    const gate = await authorizeMission(data?.initData, data?.missionId);
    if (!gate.ok) return gate;
    const { admin, telegramUserId, binding } = gate;

    const { data: panelData } = await admin.rpc(MINIAPP_RPC.panel, {
      _telegram_user_id: telegramUserId,
      _mission_id: binding.missionId,
      _verified_chat_id: Number(binding.chatId),
    });
    const panel = (panelData ?? {}) as Record<string, unknown>;
    if (String(panel["outcome"] ?? "") !== "ok") {
      return fail(String(panel["outcome"] ?? "denied"));
    }

    const config = (panel["resolved_config"] ?? {}) as Record<string, unknown>;
    const rawTargets = (config["metric_targets"] ?? {}) as Record<string, unknown>;

    // Latest DURABLE stored snapshot only. ZERO provider / X reads here.
    const { data: snapshot } = await admin
      .from("social_metric_snapshots")
      .select("views, likes, comments, shares, saves, observed_at, created_at")
      .eq("mission_id", binding.missionId)
      .eq("workspace_id", binding.workspaceId)
      .order("observed_at", { ascending: false })
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    const row = (snapshot ?? null) as Record<string, unknown> | null;

    const targets = {} as Record<MiniAppMetric, number | null>;
    const results = {} as Record<MiniAppMetric, number | null>;
    for (const metric of MINIAPP_METRICS) {
      targets[metric] = positiveInt(rawTargets[metric]);
      results[metric] = snapshotValue(row, MINIAPP_METRIC_COLUMNS[metric]);
    }

    return {
      ok: true,
      missionId: binding.missionId,
      workspaceName: binding.workspaceName,
      authorHandle: panel["author_handle"] ? String(panel["author_handle"]) : null,
      canonicalUrl: typeof panel["canonical_url"] === "string" ? panel["canonical_url"] : null,
      status: "LIVE",
      endsAt: panel["ends_at"] ? String(panel["ends_at"]) : null,
      controlMode: String(panel["control_mode"] ?? "AUTO"),
      primaryType: String(config["milestone_type"] ?? "NONE").toUpperCase(),
      primaryTarget: positiveInt(config["milestone_target"]),
      targets,
      results,
      capabilities: {
        endNow: MINIAPP_DISABLED_ACTIONS.end_now,
        cancel: MINIAPP_DISABLED_ACTIONS.cancel,
      },
    };
  });

/* -------------------------------------------------------------- MUTATIONS */

export type MiniAppMutationResult = { ok: true; outcome: string } | MiniAppFailure;

export const miniAppApplyTargets = createServerFn({ method: "POST" })
  .inputValidator(
    (input: {
      initData: string;
      missionId: string;
      requestId: string;
      primaryType: string;
      primaryTarget: number;
      views?: number | null;
      likes?: number | null;
      replies?: number | null;
      reposts?: number | null;
      bookmarks?: number | null;
    }) => input,
  )
  .handler(async ({ data }): Promise<MiniAppMutationResult> => {
    if (!isRequestId(data?.requestId)) return fail("invalid_request_id");
    const primaryType = String(data?.primaryType ?? "").toUpperCase();
    if (!(MINIAPP_PRIMARY_TYPES as readonly string[]).includes(primaryType)) {
      return fail("invalid_primary_type");
    }
    const primaryTarget = positiveInt(data?.primaryTarget);
    if (primaryTarget === null) return fail("invalid_primary_target");

    const supporting = {} as Record<MiniAppMetric, number | null>;
    for (const metric of MINIAPP_METRICS) {
      const raw = data?.[metric];
      if (raw === null || raw === undefined) {
        supporting[metric] = null;
        continue;
      }
      const value = positiveInt(raw);
      if (value === null) return fail("invalid_target");
      supporting[metric] = value;
    }

    const gate = await authorizeMission(data?.initData, data?.missionId);
    if (!gate.ok) return gate;
    const { admin, telegramUserId, binding } = gate;

    const { data: result, error } = await admin.rpc(MINIAPP_RPC.applyTargets, {
      _telegram_user_id: telegramUserId,
      _mission_id: binding.missionId,
      _verified_chat_id: Number(binding.chatId),
      _mode: "MANUAL",
      _primary_type: primaryType,
      _primary_target: primaryTarget,
      _views: supporting.views,
      _likes: supporting.likes,
      _replies: supporting.replies,
      _reposts: supporting.reposts,
      _bookmarks: supporting.bookmarks,
      _idempotency_key: await miniAppIdempotencyKey(
        telegramUserId,
        "apply_targets",
        data.requestId,
      ),
    });
    if (error) return fail("unavailable");
    return { ok: true, outcome: String((result as Record<string, unknown> | null)?.["outcome"] ?? "denied") };
  });

export const miniAppApplyDuration = createServerFn({ method: "POST" })
  .inputValidator((input: { initData: string; missionId: string; requestId: string; minutes: number }) => input)
  .handler(async ({ data }): Promise<MiniAppMutationResult> => {
    if (!isRequestId(data?.requestId)) return fail("invalid_request_id");
    const minutes = positiveInt(data?.minutes);
    if (minutes === null || minutes > 1440) return fail("invalid_minutes");

    const gate = await authorizeMission(data?.initData, data?.missionId);
    if (!gate.ok) return gate;
    const { admin, telegramUserId, binding } = gate;

    const { data: result, error } = await admin.rpc(MINIAPP_RPC.applyDuration, {
      _telegram_user_id: telegramUserId,
      _mission_id: binding.missionId,
      _verified_chat_id: Number(binding.chatId),
      _minutes_from_now: minutes,
      _idempotency_key: await miniAppIdempotencyKey(
        telegramUserId,
        "apply_duration",
        data.requestId,
      ),
    });
    if (error) return fail("unavailable");
    return { ok: true, outcome: String((result as Record<string, unknown> | null)?.["outcome"] ?? "denied") };
  });

/**
 * Capability probe for the future Mini App UI. END NOW and CANCEL are reported
 * as handled by the bot, so the UI never renders a second finalization path.
 */
export const miniAppCapabilities = createServerFn({ method: "POST" })
  .inputValidator((input: { initData: string }) => input)
  .handler(async ({ data }) => {
    const auth = await validateTelegramInitData(data?.initData, botToken());
    if (!auth.ok) return fail(auth.reason);
    return {
      ok: true as const,
      version: MINIAPP_BRIDGE_VERSION,
      reads: ["list_workspaces", "list_missions", "mission_panel"],
      mutations: ["apply_targets", "apply_duration"],
      disabled: {
        end_now: MINIAPP_DISABLED_ACTIONS.end_now,
        cancel: MINIAPP_DISABLED_ACTIONS.cancel,
        note: MINIAPP_NOT_ENABLED,
      },
    };
  });
