/**
 * Read-only Mission Setup Auto-select boundary.
 *
 * Deployment inputs must include this directory, ../_shared/x-metrics.ts, and
 * ../../../src/lib/telegram-miniapp-auth.server.ts. The canonical app auth
 * module is intentionally imported directly; there is no second HMAC engine.
 */
import { createClient } from "@supabase/supabase-js";
import { isCurrentChatAdmin } from "../../../src/lib/telegram-miniapp-auth.server.ts";
import { lookupXPostMetrics } from "../_shared/x-metrics.ts";
import {
  handleSetupAutoSelect,
  type SetupAutoSelectDeps,
  type SetupAutoSelectSnapshot,
} from "./handler.ts";

type Row = Record<string, unknown>;

const supabaseUrl = Deno.env.get("SUPABASE_URL") ?? "";
const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
const botToken = Deno.env.get("TELEGRAM_BOT_TOKEN") ?? "";
const xBearer = Deno.env.get("X_API_BEARER_TOKEN") ?? "";
const admin = createClient(supabaseUrl, serviceRoleKey, {
  auth: { persistSession: false, autoRefreshToken: false },
});

function uuid(value: unknown): string | null {
  const normalized = String(value ?? "").toLowerCase();
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(normalized)
    ? normalized
    : null;
}

function commercialAllowed(value: unknown): boolean {
  const row = value && typeof value === "object" ? value as Row : {};
  return row["allowed"] === true && row["would_block"] !== true;
}

const deps: SetupAutoSelectDeps = {
  serviceRoleKey,
  botToken,
  authorizeReadySetup: async ({ candidateId, connectionId, closeToken, telegramUserId }) => {
    const { data: connections, error: connectionError } = await admin
      .from("telegram_group_connections")
      .select("id,workspace_id,telegram_chat_id,bot_is_admin,metadata")
      .eq("id", connectionId)
      .limit(2);
    const rows = Array.isArray(connections) ? connections as Row[] : [];
    if (connectionError || rows.length !== 1) return { ok: false, reason: "mission_setup_unavailable" };
    const connection = rows[0] ?? {};
    const workspaceId = uuid(connection["workspace_id"]);
    const chatId = String(connection["telegram_chat_id"] ?? "");
    const metadata = (connection["metadata"] ?? {}) as Row;
    if (
      !workspaceId ||
      uuid(connection["id"]) !== connectionId ||
      !/^-[0-9]+$/.test(chatId) ||
      connection["bot_is_admin"] !== true ||
      Boolean(metadata["bot_removed_at"])
    ) {
      return { ok: false, reason: "mission_setup_unavailable" };
    }

    const { data: workspaceRows, error: workspaceError } = await admin.rpc(
      "social_mission_control_workspaces",
      { _telegram_user_id: telegramUserId },
    );
    const operator = !workspaceError && (Array.isArray(workspaceRows) ? workspaceRows : []).some(
      (row) => uuid((row as Row)["workspace_id"]) === workspaceId,
    );
    if (!operator) return { ok: false, reason: "mission_setup_unavailable" };
    if (!await isCurrentChatAdmin(botToken, chatId, telegramUserId)) {
      return { ok: false, reason: "mission_setup_unavailable" };
    }

    const { data: linked, error: linkedError } = await admin
      .from("telegram_connections")
      .select("user_id")
      .eq("telegram_user_id", telegramUserId)
      .maybeSingle();
    const actorUserId = uuid((linked as Row | null)?.["user_id"]);
    if (linkedError || !actorUserId) return { ok: false, reason: "mission_setup_unavailable" };

    const { data: identity, error: identityError } = await admin.rpc("can_use_project_tools", {
      _workspace_id: workspaceId,
      _user_id: actorUserId,
    });
    if (identityError || identity !== true) return { ok: false, reason: "project_identity_required" };

    const { data: access, error: accessError } = await admin.rpc("evaluate_commercial_access", {
      _workspace_id: workspaceId,
      _feature_key: "x_missions",
      _user_id: actorUserId,
    });
    if (accessError || !commercialAllowed(access)) {
      return { ok: false, reason: "missions_plan_required" };
    }

    const { data: setup, error: setupError } = await admin.rpc(
      "read_social_mission_candidate_setup",
      {
        _candidate_id: candidateId,
        _group_connection_id: connectionId,
        _telegram_user_id: telegramUserId,
        _verified_chat_id: Number(chatId),
        _close_token: closeToken,
      },
    );
    const setupRow = (setup ?? {}) as Row;
    const externalPostId = String(setupRow["external_post_id"] ?? "");
    if (
      setupError ||
      String(setupRow["outcome"] ?? "") !== "READY" ||
      uuid(setupRow["workspace_id"]) !== workspaceId ||
      uuid(setupRow["group_connection_id"]) !== connectionId ||
      !/^[0-9]{1,32}$/.test(externalPostId)
    ) {
      return { ok: false, reason: "mission_setup_unavailable" };
    }
    return { ok: true, externalPostId };
  },
  readMetrics: async (externalPostId): Promise<SetupAutoSelectSnapshot | null> => {
    const result = await lookupXPostMetrics(xBearer, [externalPostId]);
    if (!result.ok) return null;
    const post = result.posts.get(externalPostId);
    return post ? { observedAt: result.observedAt, metrics: post.metrics } : null;
  },
  suggestTargets: async (snapshot) => {
    const { data, error } = await admin.rpc("social_mission_metric_targets", {
      _views: snapshot.metrics.views,
      _likes: snapshot.metrics.likes,
      _comments: snapshot.metrics.comments,
      _shares: snapshot.metrics.shares,
      _saves: snapshot.metrics.saves,
      _primary_type: "NONE",
      _primary_target: null,
    });
    return error || !data || typeof data !== "object" ? null : data as Row;
  },
};

Deno.serve((request: Request) => handleSetupAutoSelect(request, deps));