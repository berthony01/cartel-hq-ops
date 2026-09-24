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
  /**
   * SE-16.2P — reused (NOT newly defined) service-only authorization RPC. It is
   * the authoritative source of `actor_user_id` and `target_id` for the card
   * refresh: neither value may ever come from the client.
   */
  authorize: "social_mission_control_authorize",
} as const;

/* --------------------------------------- SE-16.3R-3 ROLLING-CARD PARITY */

/**
 * SE-16.3R-3 — a committed LIVE target / end-time change now REPLACES the
 * canonical community card at the bottom of the chat instead of editing it in
 * place far above the current conversation. The Mini App uses exactly the same
 * service-only transport and the same `resurface_mission` action as the bot
 * console, so there is one rolling-card path and no second finalization path.
 *
 * END NOW / CANCEL and every other final-state update remain the bot's
 * in-place `edit_mission` lane; `resurface_mission` requires a LIVE mission.
 *
 * This bridge never renders a card and never calls the Telegram Bot API.
 */
export const MINIAPP_TRANSPORT_FUNCTION = "social-mission-telegram";
export const MINIAPP_TRANSPORT_ACTION = "resurface_mission";
/** Existing accepted internal-source value; no new transport source is added. */
export const MINIAPP_TRANSPORT_INTERNAL_SOURCE = "telegram-webhook";
export const MINIAPP_TRANSPORT_TIMEOUT_MS = 15_000;

/**
 * Bounded, non-secret refresh states. Raw transport payloads, headers, status
 * codes and errors never reach the client.
 *  - `edited`           a new canonical card is live and the old one is gone
 *  - `replayed`         the transport recognised this exact request already
 *  - `cleanup_pending`  the new card is live; the old one is queued for removal
 *  - `ambiguous`        outcome unknown (timeout / unresolved) — never resent
 *  - `failed`           the card did not change; the DB mutation still stands
 */
export const MINIAPP_REFRESH_STATES = [
  "edited",
  "replayed",
  "cleanup_pending",
  "ambiguous",
  "failed",
] as const;
export type MiniAppRefreshState = (typeof MINIAPP_REFRESH_STATES)[number];

/** Mutation outcomes that are committed and therefore warrant a card refresh. */
export const MINIAPP_REFRESHABLE_OUTCOMES = ["ok", "replayed"] as const;

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

export type MiniAppWorkspace = {
  workspaceId: string;
  workspaceName: string;
  liveMissions: number;
};
export type MiniAppOperatorHome = {
  ok: true;
  identity: {
    projectName: string;
    ticker: string | null;
    logoDataUrl: string | null;
    source: "profile" | "workspace";
  };
  community: {
    connectedGroups: number;
    adminReadyGroups: number;
  };
};
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

type AdminClient = {
  rpc: (name: string, args: Record<string, unknown>) => Promise<{ data: unknown; error: unknown }>;
  from: (table: string) => any;
  storage: { from: (bucket: string) => any };
};

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

function hexDigest(buffer: ArrayBuffer): string {
  return Array.from(new Uint8Array(buffer))
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}

/**
 * SE-16.3R-3 — deterministic UUID for the card-replacement request.
 *
 * The transport requires a UUID-shaped `clientRequestId` (a 40-char hash would
 * be rejected). Deriving it from the VALIDATED Telegram user id + the mutation
 * action + the client request id means a retry of the SAME mutation re-uses the
 * SAME transport id, so the transport duplicate short-circuits instead of
 * posting a second card, while a target edit and a duration edit can never
 * collide on one id.
 *
 * `recoveryRevision` is supplied ONLY after a durable FAILED lane, which proves
 * the previous replacement card did not remain. It is stable for that one
 * resurface revision, so even the recovery attempt cannot duplicate a card.
 */
export async function miniAppRefreshRequestUuid(
  telegramUserId: number,
  action: string,
  requestId: string,
  recoveryRevision?: number | null,
): Promise<string> {
  const seed =
    recoveryRevision === undefined || recoveryRevision === null
      ? `se16-miniapp-refresh:${telegramUserId}:${action}:${requestId}`
      : `se16-miniapp-refresh-recovery:${telegramUserId}:${action}:${requestId}:${recoveryRevision}`;
  const hex = hexDigest(
    await crypto.subtle.digest("SHA-256", new TextEncoder().encode(seed)),
  );
  const chars = hex.slice(0, 32).split("");
  chars[12] = "5";
  chars[16] = ["8", "9", "a", "b"][parseInt(hex[16] ?? "0", 16) % 4] ?? "8";
  const h = chars.join("");
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20, 32)}`;
}

/** Maps the transport's bounded reply to an allowlisted, non-secret state. */
function refreshStateFrom(status: number, payload: Record<string, unknown> | null): MiniAppRefreshState {
  const state = String(payload?.["resurfaceState"] ?? "").toUpperCase();
  if (state === "RESURFACED") {
    if (payload?.["duplicate"] === true) return "replayed";
    return payload?.["cleanupPending"] === true ? "cleanup_pending" : "edited";
  }
  if (state === "AMBIGUOUS" || state === "CLAIMED") return "ambiguous";
  if (state === "FAILED") return "failed";
  return status >= 200 && status < 300 ? "ambiguous" : "failed";
}

/**
 * SE-16.3R-3 — replace the canonical Telegram mission card through the EXISTING
 * transport. Every binding input is server-derived:
 *   - the Telegram user id comes from the verified initData signature,
 *   - workspace / mission / chat come from the operator-scoped binding,
 *   - `actor_user_id` and `target_id` come from the reused service-only
 *     `social_mission_control_authorize` RPC,
 *   - the resurface lane is read from the EXACT target row (target id + mission
 *     + workspace + verified chat), never a loose mission-only lookup.
 *
 * Correlation is entirely server-side. The client keeps the SAME mutation
 * payload and request id on retry; only this bridge may derive a new transport
 * id, and only after a DURABLE FAILED lane.
 *
 * Failure here never rolls back the committed mutation; it is reported
 * separately so the caller can honestly say "saved, card refresh needs retry".
 */
async function miniAppRefreshCard(args: {
  admin: AdminClient;
  telegramUserId: number;
  binding: Binding;
  action: string;
  requestId: string;
}): Promise<MiniAppRefreshState> {
  const { admin, telegramUserId, binding } = args;

  const { data: authRows, error: authError } = await admin.rpc(MINIAPP_RPC.authorize, {
    _telegram_user_id: telegramUserId,
    _mission_id: binding.missionId,
    _verified_chat_id: Number(binding.chatId),
  });
  if (authError) return "failed";
  const authRow = (Array.isArray(authRows) ? authRows[0] : authRows) as
    | Record<string, unknown>
    | null
    | undefined;
  if (!authRow || String(authRow["outcome"] ?? "") !== "ok") return "failed";
  const actorUserId = String(authRow["actor_user_id"] ?? "");
  const targetId = String(authRow["target_id"] ?? "");
  const workspaceId = String(authRow["workspace_id"] ?? "");
  if (!isUuid(actorUserId) || !isUuid(targetId) || workspaceId !== binding.workspaceId) {
    return "failed";
  }

  // EXACT target row. Mission+workspace alone could match a second delivered
  // target and replace the wrong card, so the verified chat and the
  // authoritative target id are both part of the lookup.
  const { data: target } = await admin
    .from("social_mission_targets")
    .select("id, resurface_state, resurface_client_request_id, resurface_revision")
    .eq("id", targetId)
    .eq("mission_id", binding.missionId)
    .eq("workspace_id", binding.workspaceId)
    .eq("telegram_chat_id", Number(binding.chatId))
    .maybeSingle();
  const targetRow = (target ?? null) as Record<string, unknown> | null;
  if (!targetRow?.["id"]) return "failed";

  const baseRequestId = await miniAppRefreshRequestUuid(
    telegramUserId,
    args.action,
    args.requestId,
  );
  const lane = String(targetRow["resurface_state"] ?? "IDLE").toUpperCase();
  const recordedRequestId = String(targetRow["resurface_client_request_id"] ?? "");
  const resurfaceRevision = Number(targetRow["resurface_revision"] ?? 0);

  let clientRequestId = baseRequestId;
  if (recordedRequestId && recordedRequestId === baseRequestId) {
    // The transport already recorded THIS exact request and duplicate
    // short-circuits every lane, so the truthful answer is local.
    if (lane === "RESURFACED") return "replayed";
    // CLAIMED / AMBIGUOUS: the real-world effect is unknown. Never mint a new
    // id and never send a second card.
    if (lane === "CLAIMED" || lane === "AMBIGUOUS") return "ambiguous";
    if (lane === "FAILED") {
      // A durable FAILED proves the replacement card did not remain, so one
      // deterministic recovery attempt per revision is safe.
      clientRequestId = await miniAppRefreshRequestUuid(
        telegramUserId,
        args.action,
        args.requestId,
        resurfaceRevision,
      );
    }
  }

  // Service credentials are read per-request, used only as request headers, and
  // never returned or logged.
  const supabaseUrl = process.env["SUPABASE_URL"] ?? "";
  const serviceKey = process.env["SUPABASE_SERVICE_ROLE_KEY"] ?? "";
  if (!supabaseUrl || !serviceKey) return "failed";

  try {
    const response = await fetch(
      `${supabaseUrl.replace(/\/$/, "")}/functions/v1/${MINIAPP_TRANSPORT_FUNCTION}`,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          apikey: serviceKey,
          Authorization: `Bearer ${serviceKey}`,
          "X-Cartel-Internal-Source": MINIAPP_TRANSPORT_INTERNAL_SOURCE,
          "X-Cartel-Actor-User-Id": actorUserId,
        },
        body: JSON.stringify({
          action: MINIAPP_TRANSPORT_ACTION,
          workspaceId: binding.workspaceId,
          missionId: binding.missionId,
          targetId,
          clientRequestId,
        }),
        signal: AbortSignal.timeout(MINIAPP_TRANSPORT_TIMEOUT_MS),
      },
    );
    const payload = (await response.json().catch(() => null)) as Record<string, unknown> | null;
    return refreshStateFrom(response.status, payload);
  } catch {
    // Timeout or transport error: the replacement may or may not have landed.
    return "ambiguous";
  }
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

const MINIAPP_LOGO_MAX_BYTES = 2 * 1024 * 1024;
const MINIAPP_LOGO_MIME_TYPES = new Set(["image/png", "image/jpeg", "image/webp", "image/gif"]);

function bytesToBase64(bytes: Uint8Array): string {
  let binary = "";
  for (let offset = 0; offset < bytes.length; offset += 0x8000) {
    binary += String.fromCharCode(...bytes.subarray(offset, offset + 0x8000));
  }
  return btoa(binary);
}

/**
 * MINI-HQ-1A — bounded operator-home read.
 *
 * Workspace authorization still comes exclusively from the existing operator
 * RPC. The selected workspace must be in that returned set before any profile,
 * asset or community row is read. No provider identifiers leave the server.
 */
export const miniAppOperatorHome = createServerFn({ method: "POST" })
  .inputValidator((input: { initData: string; workspaceId: string }) => input)
  .handler(async ({ data }): Promise<MiniAppOperatorHome | MiniAppFailure> => {
    const auth = await validateTelegramInitData(data?.initData, botToken());
    if (!auth.ok) return fail(auth.reason);
    if (!isUuid(data?.workspaceId)) return fail("invalid_workspace_id");

    const admin = await adminClient();
    const { data: workspaceRows, error: workspaceError } = await admin.rpc(
      MINIAPP_RPC.workspaces,
      { _telegram_user_id: auth.user.id },
    );
    if (workspaceError) return fail("unavailable");
    const authorizedWorkspace = (Array.isArray(workspaceRows) ? workspaceRows : []).find(
      (row) => String((row as Record<string, unknown>)["workspace_id"] ?? "") === data.workspaceId,
    ) as Record<string, unknown> | undefined;
    if (!authorizedWorkspace) return fail("not_found");

    const workspaceName = String(authorizedWorkspace["workspace_name"] ?? "Workspace");
    const [{ data: profileData, error: profileError }, { data: communityData, error: communityError }] =
      await Promise.all([
        admin
          .from("project_profiles")
          .select("project_name, ticker, logo_asset_id")
          .eq("workspace_id", data.workspaceId)
          .maybeSingle(),
        admin
          .from("telegram_group_connections")
          .select("bot_is_admin")
          .eq("workspace_id", data.workspaceId),
      ]);
    if (profileError || communityError) return fail("unavailable");

    const profile = (profileData ?? null) as Record<string, unknown> | null;
    const projectName = String(profile?.["project_name"] ?? "").trim() || workspaceName;
    const tickerText = String(profile?.["ticker"] ?? "").trim();
    const logoAssetId = String(profile?.["logo_asset_id"] ?? "").trim();
    let logoDataUrl: string | null = null;

    if (logoAssetId) {
      const { data: assetData } = await admin
        .from("media_assets")
        .select("storage_path, mime_type, file_size_bytes")
        .eq("id", logoAssetId)
        .eq("workspace_id", data.workspaceId)
        .maybeSingle();
      const asset = (assetData ?? null) as Record<string, unknown> | null;
      const mimeType = String(asset?.["mime_type"] ?? "");
      const byteCount = Number(asset?.["file_size_bytes"] ?? 0);
      const storagePath = String(asset?.["storage_path"] ?? "");
      if (
        storagePath &&
        MINIAPP_LOGO_MIME_TYPES.has(mimeType) &&
        Number.isFinite(byteCount) &&
        byteCount > 0 &&
        byteCount <= MINIAPP_LOGO_MAX_BYTES
      ) {
        const { data: logoBlob, error: logoError } = await admin.storage
          .from("workspace-assets")
          .download(storagePath);
        if (!logoError && logoBlob && logoBlob.size <= MINIAPP_LOGO_MAX_BYTES) {
          logoDataUrl = `data:${mimeType};base64,${bytesToBase64(
            new Uint8Array(await logoBlob.arrayBuffer()),
          )}`;
        }
      }
    }

    const communities = Array.isArray(communityData)
      ? (communityData as Record<string, unknown>[])
      : [];
    return {
      ok: true,
      identity: {
        projectName,
        ticker: tickerText || null,
        logoDataUrl,
        source: profile ? "profile" : "workspace",
      },
      community: {
        connectedGroups: communities.length,
        adminReadyGroups: communities.filter((row) => row["bot_is_admin"] === true).length,
      },
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
      status: panelStatus(panel["status"]),
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

/**
 * Mutation truthfulness: the DB outcome and the Telegram card refresh are two
 * separate facts. `refresh` is present only when a refresh was attempted (that
 * is, for a committed `ok` / `replayed` outcome) so future UI can say "saved,
 * card refresh needs retry" instead of claiming total success.
 */
export type MiniAppMutationResult =
  | { ok: true; outcome: string; refresh?: MiniAppRefreshState }
  | MiniAppFailure;

/**
 * A committed mutation ALWAYS attempts exactly one card refresh — including on
 * `replayed`, so a client retry self-heals when the DB write landed but the
 * first refresh result was lost. Refused/unchanged outcomes (denied, not_live,
 * conflict, invalid_*) never touch the card.
 */
async function withCardRefresh(
  outcome: string,
  args: { admin: AdminClient; telegramUserId: number; binding: Binding; action: string; requestId: string },
): Promise<MiniAppMutationResult> {
  if (!(MINIAPP_REFRESHABLE_OUTCOMES as readonly string[]).includes(outcome)) {
    return { ok: true, outcome };
  }
  return { ok: true, outcome, refresh: await miniAppRefreshCard(args) };
}

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
    const outcome = String((result as Record<string, unknown> | null)?.["outcome"] ?? "denied");
    return await withCardRefresh(outcome, {
      admin,
      telegramUserId,
      binding,
      action: "apply_targets",
      requestId: data.requestId,
    });
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
    const outcome = String((result as Record<string, unknown> | null)?.["outcome"] ?? "denied");
    return await withCardRefresh(outcome, {
      admin,
      telegramUserId,
      binding,
      action: "apply_duration",
      requestId: data.requestId,
    });
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
