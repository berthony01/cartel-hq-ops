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
 * No new table, no new RPC, no schema change, and no provider/X read in this
 * bridge. MINI-HQ-1C: END NOW and CANCEL reuse the EXISTING lifecycle RPCs and
 * the EXISTING in-place `edit_mission` transport lane (which alone owns the
 * single best-effort final X read for a COMPLETED card), plus the same
 * pinned_by_hq-guarded safe unpin the bot uses.
 */

import { createServerFn } from "@tanstack/react-start";
import {
  CUSTOM_MEDIA_ASSET_TYPE,
  CUSTOM_MEDIA_FEATURE_KEY,
  CUSTOM_MEDIA_MAX_BYTES,
  CUSTOM_MEDIA_PURPOSE,
  customMediaEntitled,
  customMediaStoragePath,
  inspectCustomMedia,
  isCustomMediaSlot,
  isWorkspaceCustomMediaPath,
  type CustomMediaSlot,
} from "./custom-message-media";
import {
  isCurrentChatAdmin,
  isRequestId,
  isUuid,
  miniAppIdempotencyKey,
  validateTelegramInitData,
} from "./telegram-miniapp-auth.server";
import {
  fetchCommunityLiveMissions,
  resolveCommunityLaunchCore,
  resolveCommunityMissionBindingCore,
  routeStartParam,
  type CommunityDeps,
  type CommunityMissionDeps,
} from "./mission-control-community.server";

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
  /** MINI-HQ-1C — reused (NOT newly defined) lifecycle RPCs. */
  endNow: "end_social_mission_from_control",
  cancel: "cancel_social_mission_from_control",
  finishScheduleEvent: "finish_social_mission_schedule_event",
  recordPin: "record_social_mission_target_pin",
  closeLauncher: "request_mission_control_launcher_cleanup",
} as const;

/** MINI-HQ-1C — the in-place final-state transport action (same as the bot). */
export const MINIAPP_FINAL_TRANSPORT_ACTION = "edit_mission";

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
 * MINI-HQ-1C — every Mission Control mutation the Mini App really supports.
 * END NOW / CANCEL are now at parity with the bot: same RPCs, same in-place
 * final card edit, same schedule-event ownership rule, same safe unpin.
 */
export const MINIAPP_SUPPORTED_ACTIONS = [
  "apply_targets",
  "apply_duration",
  "end_now",
  "cancel",
] as const;

export const MINIAPP_BRIDGE_VERSION = "v2";

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
  capabilities: { endNow: "supported"; cancel: "supported" };
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

  // MC-GL — direct community session: chat derived from the HMAC-verified
  // start_param, launch authority + live admin re-proven, exact mission read
  // (no workspace-wide limited list). Private sessions keep resolveBinding.
  const route = routeStartParam(auth.startParam);
  if (route.kind === "invalid") return fail("community_launch_invalid");
  if (route.kind === "community") {
    const bound = await resolveCommunityMissionBindingCore(
      communityMissionDeps(admin, token),
      auth.user.id,
      route.connectionId,
      missionId,
      { requireLive: true },
    );
    if (!bound.ok) return fail(bound.reason);
    const { workspaceId, workspaceName, chatId } = bound.binding;
    return { ok: true, admin, telegramUserId: auth.user.id, binding: { workspaceId, workspaceName, chatId, missionId } };
  }

  const binding = await resolveBinding(admin, auth.user.id, missionId);
  if (!binding || !binding.chatId) return fail("not_found");

  // Fresh live admin check in the mission's OWN chat. Fails closed.
  const isAdmin = await isCurrentChatAdmin(token, binding.chatId, auth.user.id);
  if (!isAdmin) return fail("not_group_admin");

  return { ok: true, admin, telegramUserId: auth.user.id, binding };
}

/**
 * MINI-HQ-1C lifecycle resolver — NOT LIVE-only. A same-request End/Cancel
 * retry must still reach the lifecycle RPC after the mission is already
 * COMPLETED/CANCELLED, so the LIVE-filtered list RPC cannot be used here.
 * Nothing client-supplied is trusted except the mission routing hint: the
 * workspace set comes from the operator-scoped workspaces RPC for the
 * VALIDATED Telegram user, and the mission + its delivered target chats are
 * read server-side restricted to that set. Normal list-missions behaviour is
 * unchanged (still LIVE-only).
 */
async function resolveLifecycleCandidates(
  admin: AdminClient,
  telegramUserId: number,
  missionId: string,
): Promise<{ workspaceId: string; workspaceName: string; chatIds: string[] } | null> {
  const { data: workspaces, error } = await admin.rpc(MINIAPP_RPC.workspaces, {
    _telegram_user_id: telegramUserId,
  });
  if (error) return null;
  const names = new Map<string, string>();
  for (const workspace of Array.isArray(workspaces) ? workspaces : []) {
    const ws = workspace as Record<string, unknown>;
    const id = String(ws["workspace_id"] ?? "");
    if (isUuid(id)) names.set(id, String(ws["workspace_name"] ?? "Workspace"));
  }
  if (names.size === 0) return null;
  const { data: mission } = await admin
    .from("social_missions")
    .select("id, workspace_id")
    .eq("id", missionId)
    .in("workspace_id", [...names.keys()])
    .maybeSingle();
  const m = (mission ?? null) as Record<string, unknown> | null;
  const workspaceId = String(m?.["workspace_id"] ?? "");
  if (!m || !names.has(workspaceId)) return null;
  const { data: targets } = await admin
    .from("social_mission_targets")
    .select("telegram_chat_id")
    .eq("mission_id", missionId)
    .eq("workspace_id", workspaceId)
    .order("created_at", { ascending: true });
  const chatIds = [
    ...new Set(
      (Array.isArray(targets) ? targets : [])
        .map((t) => String((t as Record<string, unknown>)["telegram_chat_id"] ?? ""))
        .filter((c) => /^-?\d+$/.test(c)),
    ),
  ];
  if (chatIds.length === 0) return null;
  return { workspaceId, workspaceName: names.get(workspaceId)!, chatIds };
}

type LifecycleAuthority = {
  admin: AdminClient;
  telegramUserId: number;
  binding: Binding;
  actorUserId: string;
  targetId: string;
  missionStatus: string;
};

/**
 * Lifecycle gate: initData -> non-LIVE-capable server binding -> fresh
 * getChatMember admin check in the mission's own chat -> authoritative
 * social_mission_control_authorize (which does NOT filter on status). The
 * returned actor/target/workspace/status are validated before any mutation.
 */
async function authorizeLifecycle(
  initData: unknown,
  missionId: unknown,
): Promise<({ ok: true } & LifecycleAuthority) | MiniAppFailure> {
  const token = botToken();
  const auth = await validateTelegramInitData(initData, token);
  if (!auth.ok) return fail(auth.reason);
  if (!isUuid(missionId)) return fail("invalid_mission_id");
  const admin = await adminClient();

  // MC-GL — a direct community session is pinned to its own group's target.
  // Not LIVE-only, so completed/cancelled replays still reach the RPC.
  const route = routeStartParam(auth.startParam);
  if (route.kind === "invalid") return fail("community_launch_invalid");
  let candidates: { workspaceId: string; workspaceName: string; chatIds: string[] } | null;
  let chatId = "";
  if (route.kind === "community") {
    const bound = await resolveCommunityMissionBindingCore(
      communityMissionDeps(admin, token),
      auth.user.id,
      route.connectionId,
      missionId,
      { requireLive: false },
    );
    if (!bound.ok) return fail(bound.reason);
    candidates = {
      workspaceId: bound.binding.workspaceId,
      workspaceName: bound.binding.workspaceName,
      chatIds: [bound.binding.chatId],
    };
    chatId = bound.binding.chatId;
  } else {
    candidates = await resolveLifecycleCandidates(admin, auth.user.id, missionId);
    if (!candidates) return fail("not_found");
    for (const candidate of candidates.chatIds) {
      if (await isCurrentChatAdmin(token, candidate, auth.user.id)) {
        chatId = candidate;
        break;
      }
    }
  }
  if (!chatId) return fail("not_group_admin");

  const { data: authRows, error } = await admin.rpc(MINIAPP_RPC.authorize, {
    _telegram_user_id: auth.user.id,
    _mission_id: missionId,
    _verified_chat_id: Number(chatId),
  });
  if (error) return fail("unavailable");
  const authRow = (Array.isArray(authRows) ? authRows[0] : authRows) as
    | Record<string, unknown>
    | null
    | undefined;
  if (String(authRow?.["outcome"] ?? "") !== "ok") return fail("not_found");
  const actorUserId = String(authRow?.["actor_user_id"] ?? "");
  const targetId = String(authRow?.["target_id"] ?? "");
  const workspaceId = String(authRow?.["workspace_id"] ?? "");
  const missionStatus = String(authRow?.["mission_status"] ?? "").toUpperCase();
  if (
    !isUuid(actorUserId) ||
    !isUuid(targetId) ||
    workspaceId !== candidates.workspaceId ||
    missionStatus.length === 0
  ) {
    return fail("not_found");
  }
  return {
    ok: true,
    admin,
    telegramUserId: auth.user.id,
    binding: {
      workspaceId,
      workspaceName: candidates.workspaceName,
      chatId,
      missionId,
    },
    actorUserId,
    targetId,
    missionStatus,
  };
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

/* ------------------------------------------- COMMUNITY LAUNCH (/missioncontrol) */

export type MiniAppCommunityLaunch = {
  connectionId: string;
  workspaceId: string;
  workspaceName: string;
  communityTitle: string;
};

/**
 * Resolves a `/missioncontrol` direct-link launch. The `mc_<connection>` hint
 * comes ONLY from the HMAC-verified `start_param`; it grants nothing. Access
 * requires ALL of: an existing, still-operational group connection; its
 * workspace in the verified user's operator set (existing RPC — owner/admin/
 * authorized partner exactly as today); and a LIVE administrator/creator check
 * in that exact chat. Missing, foreign and revoked collapse into one bounded
 * refusal so nothing about another community is disclosed.
 */
async function resolveCommunityLaunch(
  admin: AdminClient,
  token: string,
  telegramUserId: number,
  connectionId: string,
): Promise<{ ok: true; launch: MiniAppCommunityLaunch; chatId: string } | MiniAppFailure> {
  const result = await resolveCommunityLaunchCore(communityDeps(admin, token), telegramUserId, connectionId);
  return result.ok ? result : fail(result.reason);
}

function communityDeps(admin: AdminClient, token: string): CommunityDeps {
  return {
    listOperatorWorkspaces: async (telegramUserId) => {
      const { data, error } = await admin.rpc(MINIAPP_RPC.workspaces, { _telegram_user_id: telegramUserId });
      return { rows: Array.isArray(data) ? data : [], error: Boolean(error) };
    },
    findConnection: async (connectionId) => {
      const { data, error } = await admin
        .from("telegram_group_connections")
        .select("id, workspace_id, telegram_chat_id, title, bot_is_admin, metadata")
        .eq("id", connectionId)
        .limit(2);
      return { rows: Array.isArray(data) ? (data as Record<string, unknown>[]) : [], error: Boolean(error) };
    },
    isChatAdmin: (chatId, telegramUserId) => isCurrentChatAdmin(token, chatId, telegramUserId),
  };
}

/** Production wiring for the exact-mission community binding (direct reads, no list RPC). */
function communityMissionDeps(admin: AdminClient, token: string): CommunityMissionDeps {
  return {
    ...communityDeps(admin, token),
    readMission: async (missionId, workspaceId) => {
      const { data, error } = await admin
        .from("social_missions")
        .select("id, workspace_id, status")
        .eq("id", missionId)
        .eq("workspace_id", workspaceId)
        .maybeSingle();
      return { row: (data ?? null) as Record<string, unknown> | null, error: Boolean(error) };
    },
    readTargetChats: async (missionId, workspaceId) => {
      const { data, error } = await admin
        .from("social_mission_targets")
        .select("telegram_chat_id")
        .eq("mission_id", missionId)
        .eq("workspace_id", workspaceId);
      const chats = [
        ...new Set(
          (Array.isArray(data) ? data : [])
            .map((t) => String((t as Record<string, unknown>)["telegram_chat_id"] ?? ""))
            .filter((c) => /^-?\d+$/.test(c)),
        ),
      ];
      return { chats, error: Boolean(error) };
    },
  };
}

/**
 * Returns `launch: null` for an ordinary open (no `mc_` start_param). A present
 * but malformed / foreign / revoked hint is a refusal — the caller must NOT
 * fall back to another workspace.
 */
export const miniAppResolveCommunityLaunch = createServerFn({ method: "POST" })
  .inputValidator((input: { initData: string }) => input)
  .handler(async ({ data }): Promise<{ ok: true; launch: MiniAppCommunityLaunch | null } | MiniAppFailure> => {
    const token = botToken();
    const auth = await validateTelegramInitData(data?.initData, token);
    if (!auth.ok) return fail(auth.reason);
    const route = routeStartParam(auth.startParam);
    if (route.kind === "ordinary") return { ok: true, launch: null };
    if (route.kind === "invalid") return fail("community_launch_invalid");
    const admin = await adminClient();
    const resolved = await resolveCommunityLaunch(admin, token, auth.user.id, route.connectionId);
    if (!resolved.ok) return resolved;
    return { ok: true, launch: resolved.launch };
  });

/**
 * Explicit Close & clear acknowledgement. The browser supplies only signed
 * initData; the database resolves its opaque token to the exact confirmed
 * launcher post and queues deletion. The same operator + live group-admin
 * authority is re-proven here before cleanup is requested.
 */
export const miniAppCloseCommunityLaunch = createServerFn({ method: "POST" })
  .inputValidator((input: { initData: string }) => input)
  .handler(async ({ data }): Promise<{ ok: true; cleanup: "queued" | "unavailable" } | MiniAppFailure> => {
    const token = botToken();
    const auth = await validateTelegramInitData(data?.initData, token);
    if (!auth.ok) return fail(auth.reason);
    const route = routeStartParam(auth.startParam);
    if (route.kind !== "community") return fail("community_launch_invalid");
    const admin = await adminClient();
    const resolved = await resolveCommunityLaunch(admin, token, auth.user.id, route.connectionId);
    if (!resolved.ok) return resolved;
    if (!route.closeToken) return { ok: true, cleanup: "unavailable" };
    if (!(await isCurrentChatAdmin(token, resolved.chatId, auth.user.id))) return fail("community_launch_unavailable");
    const { data: result, error } = await admin.rpc(MINIAPP_RPC.closeLauncher, {
      _telegram_user_id: auth.user.id,
      _group_connection_id: route.connectionId,
      _close_token: route.closeToken,
    });
    const jobId = typeof result === "string" ? result : null;
    if (error || !jobId) return fail("unavailable");
    const supabaseUrl = process.env["SUPABASE_URL"] ?? "";
    const serviceKey = process.env["SUPABASE_SERVICE_ROLE_KEY"] ?? "";
    if (supabaseUrl.startsWith("https://") && serviceKey) {
      const fastResponse = await fetch(`${supabaseUrl}/functions/v1/telegram-message-cleanup`, {
        method: "POST",
        headers: { Authorization: `Bearer ${serviceKey}`, "x-cartel-cleanup-job-id": jobId },
      }).catch(() => null);
      if (!fastResponse?.ok) return fail("unavailable");
    } else {
      return fail("unavailable");
    }
    return { ok: true, cleanup: "queued" };
  });

export const miniAppListMissions = createServerFn({ method: "POST" })
  .inputValidator((input: { initData: string; workspaceId: string; groupConnectionId?: string | null }) => input)
  .handler(async ({ data }): Promise<{ ok: true; missions: MiniAppMission[] } | MiniAppFailure> => {
    const token = botToken();
    const auth = await validateTelegramInitData(data?.initData, token);
    if (!auth.ok) return fail(auth.reason);
    if (!isUuid(data?.workspaceId)) return fail("invalid_workspace_id");
    const scopedConnection = data?.groupConnectionId ?? null;
    if (scopedConnection !== null && !isUuid(scopedConnection)) return fail("community_launch_invalid");

    const admin = await adminClient();
    // Community scope re-proves the full launch authority on every read: the
    // client-held connection id is only a hint.
    let scopedChatId: string | null = null;
    if (scopedConnection !== null) {
      const resolved = await resolveCommunityLaunch(admin, token, auth.user.id, scopedConnection.toLowerCase());
      if (!resolved.ok) return resolved;
      if (resolved.launch.workspaceId !== data.workspaceId.toLowerCase()) {
        return fail("community_launch_unavailable");
      }
      scopedChatId = resolved.chatId;
    }
    // C3A — server-side x_missions entitlement, same derived actor + authority
    // as the commercial status read. Fails closed; lifecycle paths untouched.
    const gate = await miniAppCommercialActor(admin, auth.user.id, data.workspaceId);
    if (!gate.ok) return gate;
    const entitled = await miniAppFeatureAllowed(admin, data.workspaceId, "x_missions", gate.actorUserId);
    if (entitled === null) return fail("unavailable");
    if (!entitled) return fail("missions_plan_required");
    let rows: unknown[];
    if (scopedChatId === null) {
      // Private/ordinary path: unchanged workspace-wide RPC.
      const { data: rpcRows, error } = await admin.rpc(MINIAPP_RPC.missions, {
        _telegram_user_id: auth.user.id,
        _workspace_id: data.workspaceId,
      });
      if (error) return fail("unavailable");
      rows = Array.isArray(rpcRows) ? rpcRows : [];
    } else {
      // Community path: chat filter applied in the database before the limit.
      const scoped = await fetchCommunityLiveMissions(
        (table) => admin.from(table as never) as never,
        data.workspaceId.toLowerCase(),
        scopedChatId,
      );
      if (!scoped.ok) return fail("unavailable");
      rows = scoped.rows;
    }

    return {
      ok: true,
      missions: rows
        .map((row) => {
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
      capabilities: { endNow: "supported", cancel: "supported" },
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

/* ------------------------------------------ MINI-HQ-1C LIFECYCLE PARITY */

export type MiniAppFinalRefreshState = "edited" | "replayed" | "ambiguous" | "failed";
export type MiniAppLifecycleResult =
  | { ok: true; outcome: string; refresh?: MiniAppFinalRefreshState }
  | MiniAppFailure;

/**
 * FINAL-STATE in-place card edit through the EXISTING `edit_mission` lane.
 * The transport id is deterministic in (validated user, action, request id);
 * if the exact target row already recorded that id, the SAME revision is sent
 * so the transport's duplicate short-circuit answers truthfully and nothing is
 * edited — or read from X — a second time. Any other lane sends the next
 * revision exactly once. The transport alone performs the best-effort final
 * official X read (with its own current-minute duplicate-read guard) for a
 * COMPLETED card; CANCELLED cards take no read. This bridge never reads X.
 */
async function miniAppFinalCardEdit(args: {
  admin: AdminClient;
  telegramUserId: number;
  binding: Binding;
  actorUserId: string;
  targetId: string;
  action: "end_now" | "cancel";
  requestId: string;
}): Promise<MiniAppFinalRefreshState> {
  const { admin, telegramUserId, binding, actorUserId, targetId } = args;
  // Actor + target come ONLY from the validated authorize row (which does not
  // filter on status). No first-target fallback; no edit without an actor.
  if (!isUuid(actorUserId) || !isUuid(targetId)) return "failed";

  const { data: target } = await admin
    .from("social_mission_targets")
    .select("id, edit_revision, edit_state, edit_client_request_id")
    .eq("id", targetId)
    .eq("mission_id", binding.missionId)
    .eq("workspace_id", binding.workspaceId)
    .eq("telegram_chat_id", Number(binding.chatId))
    .maybeSingle();
  const row = (target ?? null) as Record<string, unknown> | null;
  if (!row?.["id"]) return "failed";

  const clientRequestId = await miniAppRefreshRequestUuid(
    telegramUserId,
    args.action,
    args.requestId,
  );
  const currentRevision = Number(row["edit_revision"] ?? 0);
  const alreadyBound = String(row["edit_client_request_id"] ?? "") === clientRequestId;
  const revision = alreadyBound ? currentRevision : currentRevision + 1;

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
          action: MINIAPP_FINAL_TRANSPORT_ACTION,
          workspaceId: binding.workspaceId,
          missionId: binding.missionId,
          targetId,
          clientRequestId,
          revision,
        }),
        signal: AbortSignal.timeout(30_000),
      },
    );
    const payload = (await response.json().catch(() => null)) as Record<string, unknown> | null;
    const state = String(payload?.["editState"] ?? "").toUpperCase();
    if (state === "EDITED") return payload?.["duplicate"] === true ? "replayed" : "edited";
    if (state === "FAILED") return "failed";
    return "ambiguous";
  } catch {
    return "ambiguous";
  }
}

/**
 * Safe unpin — identical guard to the bot: ONLY a pin CARTEL HQ itself
 * recorded (`pinned_by_hq`) on the exact verified target is removed. Idempotent
 * on retry (a cleared flag short-circuits) and never fails a finalization.
 */
async function miniAppSafeUnpin(
  admin: AdminClient,
  binding: Binding,
  targetId: string,
): Promise<void> {
  if (!isUuid(targetId)) return;
  try {
    const { data: pinned } = await admin
      .from("social_mission_targets")
      .select("id, telegram_chat_id, telegram_message_id, pinned_by_hq")
      .eq("id", targetId)
      .eq("mission_id", binding.missionId)
      .eq("workspace_id", binding.workspaceId)
      .eq("telegram_chat_id", Number(binding.chatId))
      .maybeSingle();
    const row = (pinned ?? null) as Record<string, unknown> | null;
    if (!row?.["pinned_by_hq"] || !row["telegram_message_id"]) return;
    const token = botToken();
    if (!token) return;
    const res = await fetch(`https://api.telegram.org/bot${token}/unpinChatMessage`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        chat_id: String(row["telegram_chat_id"]),
        message_id: Number(row["telegram_message_id"]),
      }),
      signal: AbortSignal.timeout(10_000),
    });
    const body = (await res.json().catch(() => null)) as { ok?: unknown } | null;
    if (res.ok && body?.ok === true) {
      await admin.rpc(MINIAPP_RPC.recordPin, { _target_id: String(row["id"]), _pinned: false });
    }
  } catch {
    // A pin problem never invalidates a persisted completion/cancellation.
  }
}

/**
 * Shared END NOW / CANCEL flow. Every binding is server-derived; the client
 * supplies only the signed credential, the mission routing hint and an opaque
 * request id. `ok` and `replayed` both run the (deterministic, duplicate-safe)
 * final card edit and the idempotent safe unpin, so a retry after network
 * ambiguity self-heals without a second edit, X read, or audit entry. The
 * schedule event is finished ONLY when the RPC reports it owns it.
 */
async function miniAppFinalize(
  data: { initData: string; missionId: string; requestId: string } | undefined,
  action: "end_now" | "cancel",
): Promise<MiniAppLifecycleResult> {
  if (!isRequestId(data?.requestId)) return fail("invalid_request_id");
  // Lifecycle gate is NOT LIVE-only, so a same-request retry after the mission
  // is already COMPLETED/CANCELLED still reaches the RPC's `replayed` outcome.
  const gate = await authorizeLifecycle(data?.initData, data?.missionId);
  if (!gate.ok) return gate;
  const { admin, telegramUserId, binding, actorUserId, targetId } = gate;

  const { data: result, error } = await admin.rpc(
    action === "end_now" ? MINIAPP_RPC.endNow : MINIAPP_RPC.cancel,
    {
      _telegram_user_id: telegramUserId,
      _mission_id: binding.missionId,
      _verified_chat_id: Number(binding.chatId),
      _idempotency_key: await miniAppIdempotencyKey(telegramUserId, action, data!.requestId),
    },
  );
  if (error) return fail("unavailable");
  const row = (result ?? {}) as Record<string, unknown>;
  const outcome = String(row["outcome"] ?? "denied");
  if (outcome !== "ok" && outcome !== "replayed") return { ok: true, outcome };

  const refresh = await miniAppFinalCardEdit({
    admin,
    telegramUserId,
    binding,
    actorUserId,
    targetId,
    action,
    requestId: data!.requestId,
  });

  if (action === "end_now" && outcome === "ok" && row["event_owned"] === true && row["schedule_event_id"]) {
    await admin.rpc(MINIAPP_RPC.finishScheduleEvent, {
      _event_id: row["schedule_event_id"],
      _state: refresh === "edited" ? "SENT" : refresh === "failed" ? "FAILED" : "AMBIGUOUS",
      _telegram_message_id: null,
      _last_error: refresh === "edited" ? null : "The manual end edit was not confirmed.",
    });
  }

  await miniAppSafeUnpin(admin, binding, targetId);
  return { ok: true, outcome, refresh };
}

export const miniAppEndMission = createServerFn({ method: "POST" })
  .inputValidator((input: { initData: string; missionId: string; requestId: string }) => input)
  .handler(async ({ data }): Promise<MiniAppLifecycleResult> => miniAppFinalize(data, "end_now"));

export const miniAppCancelMission = createServerFn({ method: "POST" })
  .inputValidator((input: { initData: string; missionId: string; requestId: string }) => input)
  .handler(async ({ data }): Promise<MiniAppLifecycleResult> => miniAppFinalize(data, "cancel"));

/** Capability probe: reports exactly the mutations this bridge supports. */
/* ------------------------------------------- C3 COMMERCIAL STATUS (READ-ONLY) */

/**
 * COMMERCIAL C3 — read-only plan visibility for the Mini App.
 *
 * Order of gates: validated initData -> UUID workspace -> workspace must be in
 * the operator-scoped social_mission_control_workspaces set for the VALIDATED
 * Telegram user -> linked platform user resolved server-side from
 * telegram_connections (never from the client). Only then are the EXISTING
 * authoritative DB functions called with that explicit actor; the service
 * client has no auth.uid(), so their ACTOR_MISMATCH guard does not apply and
 * their owner/unrestricted bypass and membership checks run unchanged.
 * Returns bounded UI state only — no Stripe/provider identifiers. Any error
 * fails closed. No provider API call, no write.
 */
export const MINIAPP_COMMERCIAL_RPC = {
  billingStatus: "get_workspace_billing_status",
  access: "evaluate_commercial_access",
} as const;
export const MINIAPP_COMMERCIAL_FEATURES = ["x_missions", "project_inbox", "sticker_drops"] as const;
export type MiniAppCommercialFeature = (typeof MINIAPP_COMMERCIAL_FEATURES)[number];
export type MiniAppCommercialStatus = {
  ok: true;
  plan: { code: string; name: string };
  unrestricted: boolean;
  canUpgrade: boolean;
  features: Record<MiniAppCommercialFeature, boolean>;
};

/**
 * Workspace must be in the operator-scoped set for the VALIDATED Telegram user
 * before the linked platform user is resolved server-side. Never client input.
 */
async function miniAppCommercialActor(
  admin: AdminClient,
  telegramUserId: number,
  workspaceId: string,
): Promise<{ ok: true; actorUserId: string } | MiniAppFailure> {
  const { data: workspaceRows, error: workspaceError } = await admin.rpc(MINIAPP_RPC.workspaces, {
    _telegram_user_id: telegramUserId,
  });
  if (workspaceError) return fail("unavailable");
  const authorized = (Array.isArray(workspaceRows) ? workspaceRows : []).some(
    (row) => String((row as Record<string, unknown>)["workspace_id"] ?? "") === workspaceId,
  );
  if (!authorized) return fail("not_found");
  const { data: link, error: linkError } = await admin
    .from("telegram_connections")
    .select("user_id")
    .eq("telegram_user_id", telegramUserId)
    .maybeSingle();
  const actorUserId = String((link as Record<string, unknown> | null)?.["user_id"] ?? "");
  if (linkError || !isUuid(actorUserId)) return fail("unavailable");
  return { ok: true, actorUserId };
}

/** true/false from evaluate_commercial_access; null on any error (fail closed). */
async function miniAppFeatureAllowed(
  admin: AdminClient,
  workspaceId: string,
  feature: string,
  actorUserId: string,
): Promise<boolean | null> {
  const { data, error } = await admin.rpc(MINIAPP_COMMERCIAL_RPC.access, {
    _workspace_id: workspaceId,
    _feature_key: feature,
    _user_id: actorUserId,
  });
  if (error || !data || typeof data !== "object") return null;
  return (data as Record<string, unknown>)["allowed"] === true;
}

export const miniAppCommercialStatus = createServerFn({ method: "POST" })
  .inputValidator((input: { initData: string; workspaceId: string }) => input)
  .handler(async ({ data }): Promise<MiniAppCommercialStatus | MiniAppFailure> => {
    const auth = await validateTelegramInitData(data?.initData, botToken());
    if (!auth.ok) return fail(auth.reason);
    if (!isUuid(data?.workspaceId)) return fail("invalid_workspace_id");

    const admin = await adminClient();
    const gate = await miniAppCommercialActor(admin, auth.user.id, data.workspaceId);
    if (!gate.ok) return gate;
    const actorUserId = gate.actorUserId;

    const { data: statusData, error: statusError } = await admin.rpc(MINIAPP_COMMERCIAL_RPC.billingStatus, {
      _workspace_id: data.workspaceId,
      _user_id: actorUserId,
    });
    const status = (statusData ?? null) as Record<string, unknown> | null;
    if (statusError || !status || status["ok"] !== true) return fail("unavailable");
    const plan = (status["plan"] ?? null) as Record<string, unknown> | null;
    const planCode = String(plan?.["code"] ?? "").trim();
    if (!planCode) return fail("unavailable");

    const features = {} as Record<MiniAppCommercialFeature, boolean>;
    for (const feature of MINIAPP_COMMERCIAL_FEATURES) {
      const allowed = await miniAppFeatureAllowed(admin, data.workspaceId, feature, actorUserId);
      if (allowed === null) return fail("unavailable");
      features[feature] = allowed;
    }

    return {
      ok: true,
      plan: { code: planCode, name: String(plan?.["name"] ?? planCode) },
      unrestricted: status["unrestricted"] === true,
      canUpgrade: status["can_upgrade"] === true,
      features,
    };
  });

export const miniAppCapabilities = createServerFn({ method: "POST" })
  .inputValidator((input: { initData: string }) => input)
  .handler(async ({ data }) => {
    const auth = await validateTelegramInitData(data?.initData, botToken());
    if (!auth.ok) return fail(auth.reason);
    return {
      ok: true as const,
      version: MINIAPP_BRIDGE_VERSION,
      reads: ["list_workspaces", "list_missions", "mission_panel"],
      mutations: [...MINIAPP_SUPPORTED_ACTIONS],
    };
  });

/* ------------------------------------------------ MINI-HQ-1B PROJECT INBOX */

/**
 * MINI-HQ-1B — service-only Project Inbox wrappers (staged SQL:
 * docs/sql/MINI_HQ_1B_miniapp_inbox_wrappers.sql). Each wrapper maps the
 * signature-derived Telegram user id to its linked platform user, verifies
 * owner/admin on the claimed workspace (and conversation membership), sets a
 * transaction-local auth subject, then delegates to the UNCHANGED existing
 * Project Inbox RPC. This bridge copies no reply/commercial/idempotency/lock/
 * delivery logic: it validates initData, bounds inputs, and projects only the
 * privacy-safe fields below. Until the SQL is applied every call fails closed
 * with "unavailable".
 */
export const MINIAPP_INBOX_RPC = {
  summary: "miniapp_inbox_summary",
  list: "miniapp_inbox_list_conversations",
  detail: "miniapp_inbox_get_conversation",
  messages: "miniapp_inbox_list_messages",
  status: "miniapp_inbox_update_status",
  block: "miniapp_inbox_set_blocked",
  reply: "miniapp_inbox_create_team_reply",
  ack: "miniapp_inbox_ack_uncertainty",
} as const;

export const MINIAPP_INBOX_STATUSES = [
  "OPEN",
  "WAITING_ON_TEAM",
  "WAITING_ON_MEMBER",
  "RESOLVED",
] as const;
export type MiniAppInboxStatus = (typeof MINIAPP_INBOX_STATUSES)[number];
export const MINIAPP_REPLY_MAX_CHARS = 3500;

export type MiniAppInboxSummary = {
  open: number;
  waitingOnTeam: number;
  waitingOnMember: number;
  resolved: number;
  blockedContacts: number;
};
export type MiniAppInboxConversation = {
  conversationId: string;
  memberRef: string;
  contactStatus: string;
  category: string;
  status: string;
  priority: string;
  originType: string;
  originTitle: string | null;
  preview: string | null;
  lastMessageAt: string;
};
export type MiniAppInboxDetail = MiniAppInboxConversation & {
  originText: string | null;
  resolvedAt: string | null;
};
export type MiniAppInboxMessage = {
  messageId: string;
  authorType: string;
  body: string;
  teamDisplayName: string | null;
  createdAt: string;
  deliveryStatus: string | null;
  deliverySentAt: string | null;
  uncertaintyAcknowledgedAt: string | null;
};

/** Known existing-RPC user copy that is safe to surface verbatim. */
const MINIAPP_INBOX_SAFE_ERRORS = [
  "Reply must be between 1 and 3500 characters",
  "This request id was already used for a different reply",
  "This conversation is resolved. Reopen it before replying.",
  "This member is blocked",
  "An earlier reply in this conversation is not settled yet",
  "Save your Project Profile name before replying",
  "This reply is too long to deliver",
  "Only an uncertain delivery can be acknowledged",
];

/** Maps any RPC error to a bounded reason; never leaks internals/existence. */
function inboxFailure(error: unknown): MiniAppFailure {
  const message = String((error as { message?: unknown })?.message ?? "");
  if (message.startsWith("COMMERCIAL_ACCESS_DENIED")) return fail("inbox_plan_required");
  const safe = MINIAPP_INBOX_SAFE_ERRORS.find((text) => message.includes(text));
  if (safe) return fail(`inbox:${safe}`);
  if (/not_found|Not authorized/.test(message)) return fail("not_found");
  return fail("unavailable");
}

function str(value: unknown): string {
  return value === null || value === undefined ? "" : String(value);
}
function strOrNull(value: unknown): string | null {
  return value === null || value === undefined || value === "" ? null : String(value);
}
function count(value: unknown): number {
  const n = Number(value);
  return Number.isSafeInteger(n) && n >= 0 ? n : 0;
}
function firstRow(data: unknown): Record<string, unknown> | null {
  const row = Array.isArray(data) ? data[0] : data;
  return row && typeof row === "object" ? (row as Record<string, unknown>) : null;
}
function projectConversation(r: Record<string, unknown>): MiniAppInboxConversation {
  return {
    conversationId: str(r["conversation_id"]),
    memberRef: str(r["member_ref"]),
    contactStatus: str(r["contact_status"]),
    category: str(r["category"]),
    status: str(r["status"]),
    priority: str(r["priority"]),
    originType: str(r["origin_type"]),
    originTitle: strOrNull(r["origin_title_snapshot"]),
    preview: strOrNull(r["latest_message_preview"]),
    lastMessageAt: str(r["last_message_at"]),
  };
}
function isInboxStatus(value: unknown): value is MiniAppInboxStatus {
  return (MINIAPP_INBOX_STATUSES as readonly unknown[]).includes(value);
}

/** Gate: initData first, then UUID-bounded workspace. */
async function inboxGate(
  initData: unknown,
  workspaceId: unknown,
): Promise<{ ok: true; telegramUserId: number; admin: AdminClient } | MiniAppFailure> {
  const auth = await validateTelegramInitData(initData, botToken());
  if (!auth.ok) return fail(auth.reason);
  if (!isUuid(workspaceId)) return fail("invalid_workspace_id");
  return { ok: true, telegramUserId: auth.user.id, admin: await adminClient() };
}

export const miniAppInboxSummary = createServerFn({ method: "POST" })
  .inputValidator((input: { initData: string; workspaceId: string }) => input)
  .handler(async ({ data }): Promise<{ ok: true; summary: MiniAppInboxSummary } | MiniAppFailure> => {
    const gate = await inboxGate(data?.initData, data?.workspaceId);
    if (!gate.ok) return gate;
    const telegramUserId = gate.telegramUserId;
    const { data: rows, error } = await gate.admin.rpc(MINIAPP_INBOX_RPC.summary, {
      _telegram_user_id: telegramUserId,
      _workspace_id: data.workspaceId,
    });
    if (error) return inboxFailure(error);
    const r = firstRow(rows) ?? {};
    return {
      ok: true,
      summary: {
        open: count(r["open_count"]),
        waitingOnTeam: count(r["waiting_on_team_count"]),
        waitingOnMember: count(r["waiting_on_member_count"]),
        resolved: count(r["resolved_count"]),
        blockedContacts: count(r["blocked_contact_count"]),
      },
    };
  });

export const miniAppInboxList = createServerFn({ method: "POST" })
  .inputValidator((input: { initData: string; workspaceId: string; status: string | null }) => input)
  .handler(
    async ({ data }): Promise<{ ok: true; conversations: MiniAppInboxConversation[] } | MiniAppFailure> => {
      const gate = await inboxGate(data?.initData, data?.workspaceId);
      if (!gate.ok) return gate;
    const telegramUserId = gate.telegramUserId;
      if (data.status !== null && !isInboxStatus(data.status)) return fail("invalid_status");
      const args: Record<string, unknown> = {
        _telegram_user_id: telegramUserId,
        _workspace_id: data.workspaceId,
        _limit: 50,
      };
      if (data.status) args["_status"] = data.status;
      const { data: rows, error } = await gate.admin.rpc(MINIAPP_INBOX_RPC.list, args);
      if (error) return inboxFailure(error);
      return {
        ok: true,
        conversations: (Array.isArray(rows) ? rows : []).map((row) =>
          projectConversation(row as Record<string, unknown>),
        ),
      };
    },
  );

export const miniAppInboxThread = createServerFn({ method: "POST" })
  .inputValidator((input: { initData: string; workspaceId: string; conversationId: string }) => input)
  .handler(
    async ({
      data,
    }): Promise<
      { ok: true; conversation: MiniAppInboxDetail; messages: MiniAppInboxMessage[] } | MiniAppFailure
    > => {
      const gate = await inboxGate(data?.initData, data?.workspaceId);
      if (!gate.ok) return gate;
    const telegramUserId = gate.telegramUserId;
      if (!isUuid(data?.conversationId)) return fail("not_found");
      const base = {
        _telegram_user_id: telegramUserId,
        _workspace_id: data.workspaceId,
        _conversation_id: data.conversationId,
      };
      const { data: detailRows, error: detailError } = await gate.admin.rpc(MINIAPP_INBOX_RPC.detail, base);
      if (detailError) return inboxFailure(detailError);
      const d = firstRow(detailRows);
      if (!d) return fail("not_found");
      const { data: messageRows, error: messageError } = await gate.admin.rpc(MINIAPP_INBOX_RPC.messages, {
        ...base,
        _limit: 200,
      });
      if (messageError) return inboxFailure(messageError);
      return {
        ok: true,
        conversation: {
          ...projectConversation(d),
          originText: strOrNull(d["origin_text_snapshot"]),
          resolvedAt: strOrNull(d["resolved_at"]),
        },
        messages: (Array.isArray(messageRows) ? messageRows : []).map((row) => {
          const m = row as Record<string, unknown>;
          return {
            messageId: str(m["message_id"]),
            authorType: str(m["author_type"]),
            body: str(m["body"]),
            teamDisplayName: strOrNull(m["team_display_name"]),
            createdAt: str(m["created_at"]),
            deliveryStatus: strOrNull(m["delivery_status"]),
            deliverySentAt: strOrNull(m["delivery_sent_at"]),
            uncertaintyAcknowledgedAt: strOrNull(m["delivery_uncertainty_acknowledged_at"]),
          };
        }),
      };
    },
  );

export const miniAppInboxSetStatus = createServerFn({ method: "POST" })
  .inputValidator(
    (input: { initData: string; workspaceId: string; conversationId: string; status: string }) => input,
  )
  .handler(async ({ data }): Promise<{ ok: true; status: string } | MiniAppFailure> => {
    const gate = await inboxGate(data?.initData, data?.workspaceId);
    if (!gate.ok) return gate;
    const telegramUserId = gate.telegramUserId;
    if (!isUuid(data?.conversationId)) return fail("not_found");
    if (!isInboxStatus(data?.status)) return fail("invalid_status");
    const { data: rows, error } = await gate.admin.rpc(MINIAPP_INBOX_RPC.status, {
      _telegram_user_id: telegramUserId,
      _workspace_id: data.workspaceId,
      _conversation_id: data.conversationId,
      _status: data.status,
    });
    if (error) return inboxFailure(error);
    return { ok: true, status: str(firstRow(rows)?.["status"]) };
  });

export const miniAppInboxSetBlocked = createServerFn({ method: "POST" })
  .inputValidator(
    (input: { initData: string; workspaceId: string; conversationId: string; blocked: boolean }) => input,
  )
  .handler(async ({ data }): Promise<{ ok: true; contactStatus: string } | MiniAppFailure> => {
    const gate = await inboxGate(data?.initData, data?.workspaceId);
    if (!gate.ok) return gate;
    const telegramUserId = gate.telegramUserId;
    if (!isUuid(data?.conversationId)) return fail("not_found");
    if (typeof data?.blocked !== "boolean") return fail("invalid_request");
    const { data: rows, error } = await gate.admin.rpc(MINIAPP_INBOX_RPC.block, {
      _telegram_user_id: telegramUserId,
      _workspace_id: data.workspaceId,
      _conversation_id: data.conversationId,
      _blocked: data.blocked,
    });
    if (error) return inboxFailure(error);
    return { ok: true, contactStatus: str(firstRow(rows)?.["contact_status"]) };
  });

/**
 * Queues ONE team reply through the existing idempotent RPC. Success means
 * QUEUED, not delivered. The same clientRequestId + exact body replays the
 * original message instead of sending twice.
 */
export const miniAppInboxReply = createServerFn({ method: "POST" })
  .inputValidator(
    (input: {
      initData: string;
      workspaceId: string;
      conversationId: string;
      body: string;
      clientRequestId: string;
    }) => input,
  )
  .handler(
    async ({
      data,
    }): Promise<
      { ok: true; messageId: string; deliveryStatus: string | null; idempotentReplay: boolean } | MiniAppFailure
    > => {
      const gate = await inboxGate(data?.initData, data?.workspaceId);
      if (!gate.ok) return gate;
    const telegramUserId = gate.telegramUserId;
      if (!isUuid(data?.conversationId)) return fail("not_found");
      if (!isUuid(data?.clientRequestId)) return fail("invalid_request");
      const body = typeof data?.body === "string" ? data.body : "";
      if (body.trim().length < 1 || body.length > MINIAPP_REPLY_MAX_CHARS) {
        return fail("inbox:Reply must be between 1 and 3500 characters");
      }
      const { data: rows, error } = await gate.admin.rpc(MINIAPP_INBOX_RPC.reply, {
        _telegram_user_id: telegramUserId,
        _workspace_id: data.workspaceId,
        _conversation_id: data.conversationId,
        _body: body,
        _client_request_id: data.clientRequestId,
      });
      if (error) return inboxFailure(error);
      const r = firstRow(rows);
      if (!r) return fail("unavailable");
      return {
        ok: true,
        messageId: str(r["message_id"]),
        deliveryStatus: strOrNull(r["delivery_status"]),
        idempotentReplay: r["idempotent_replay"] === true,
      };
    },
  );

/** Acknowledges an UNCERTAIN delivery. Bookkeeping only — nothing is resent. */
export const miniAppInboxAckUncertainty = createServerFn({ method: "POST" })
  .inputValidator(
    (input: { initData: string; workspaceId: string; conversationId: string; messageId: string }) => input,
  )
  .handler(async ({ data }): Promise<{ ok: true } | MiniAppFailure> => {
    const gate = await inboxGate(data?.initData, data?.workspaceId);
    if (!gate.ok) return gate;
    const telegramUserId = gate.telegramUserId;
    if (!isUuid(data?.conversationId) || !isUuid(data?.messageId)) return fail("not_found");
    const { error } = await gate.admin.rpc(MINIAPP_INBOX_RPC.ack, {
      _telegram_user_id: telegramUserId,
      _workspace_id: data.workspaceId,
      _conversation_id: data.conversationId,
      _message_id: data.messageId,
    });
    if (error) return inboxFailure(error);
    return { ok: true };
  });

/* ==========================================================================
 * MINI-HQ B1 — prepared custom message media (Brand tab). Same signed
 * initData -> operator workspace -> linked user authority as above. Upload and
 * select require Pro or platform-owner unrestricted access (fail closed).
 * Nothing here sends a Telegram message; no sender reads these selections yet.
 * ========================================================================== */

export const CUSTOM_MEDIA_SELECT_RPC = "set_workspace_custom_message_media";
const CUSTOM_MEDIA_BUCKET = "workspace-assets";
const CUSTOM_MEDIA_LIST_LIMIT = 12;

export type MiniAppCustomMediaAsset = {
  id: string;
  mimeType: string;
  animated: boolean;
  width: number | null;
  height: number | null;
  bytes: number;
  previewDataUrl: string | null;
};
export type MiniAppCustomMediaState = {
  ok: true;
  entitled: boolean;
  assets: MiniAppCustomMediaAsset[];
  selection: Record<CustomMediaSlot, string | null>;
  brandKitReady: boolean;
};

async function customMediaGate(
  initData: unknown,
  workspaceId: unknown,
): Promise<{ ok: true; admin: AdminClient; actorUserId: string; workspaceId: string; entitled: boolean } | MiniAppFailure> {
  const auth = await validateTelegramInitData(initData as string, botToken());
  if (!auth.ok) return fail(auth.reason);
  if (!isUuid(workspaceId)) return fail("invalid_workspace_id");
  const admin = await adminClient();
  const actor = await miniAppCommercialActor(admin, auth.user.id, workspaceId);
  if (!actor.ok) return actor;
  const { data, error } = await admin.rpc("evaluate_commercial_access", {
    _workspace_id: workspaceId,
    _feature_key: CUSTOM_MEDIA_FEATURE_KEY,
    _user_id: actor.actorUserId,
  });
  const entitled = !error && customMediaEntitled(data);
  return { ok: true, admin, actorUserId: actor.actorUserId, workspaceId, entitled };
}

function customMediaToBase64(bytes: Uint8Array): string {
  let s = "";
  for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(s);
}
function customMediaFromBase64(value: string): Uint8Array | null {
  try {
    if (!/^[A-Za-z0-9+/]+={0,2}$/.test(value)) return null;
    const bin = atob(value);
    const out = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i += 1) out[i] = bin.charCodeAt(i);
    return out;
  } catch {
    return null;
  }
}

export const miniAppCustomMediaState = createServerFn({ method: "POST" })
  .inputValidator((input: { initData: string; workspaceId: string }) => input)
  .handler(async ({ data }): Promise<MiniAppCustomMediaState | MiniAppFailure> => {
    const g = await customMediaGate(data?.initData, data?.workspaceId);
    if (!g.ok) return g;
    const { data: kit, error: kitError } = await g.admin
      .from("brand_kits")
      .select("metadata")
      .eq("workspace_id", g.workspaceId)
      .maybeSingle();
    if (kitError) return fail("unavailable");
    const media = (((kit as Record<string, unknown> | null)?.["metadata"] ?? {}) as Record<string, unknown>)[
      "custom_message_media"
    ] as Record<string, { asset_id?: unknown }> | undefined;
    const pick = (slot: CustomMediaSlot) => {
      const id = String(media?.[slot]?.asset_id ?? "");
      return isUuid(id) ? id : null;
    };
    const selection = { mission: pick("mission"), broadcast: pick("broadcast") };
    const base = () =>
      g.admin
        .from("media_assets")
        .select("id, storage_path, mime_type, width, height, file_size_bytes, metadata")
        .eq("workspace_id", g.workspaceId)
        .eq("asset_type", CUSTOM_MEDIA_ASSET_TYPE)
        .eq("metadata->>purpose", CUSTOM_MEDIA_PURPOSE);
    const { data: recent, error: assetError } = await base().order("created_at", { ascending: false }).limit(CUSTOM_MEDIA_LIST_LIMIT);
    if (assetError) return fail("unavailable");
    const recentRows = (Array.isArray(recent) ? recent : []) as Record<string, unknown>[];
    // Selected assets are ALWAYS included even when older than the recent window.
    const missing = [selection.mission, selection.broadcast].filter(
      (id): id is string => id !== null && !recentRows.some((r) => String(r["id"]) === id),
    );
    let selectedRows: Record<string, unknown>[] = [];
    if (missing.length > 0) {
      const { data: extra, error: extraError } = await base().in("id", Array.from(new Set(missing)));
      if (extraError) return fail("unavailable");
      selectedRows = (Array.isArray(extra) ? extra : []) as Record<string, unknown>[];
    }
    const rows = [...selectedRows, ...recentRows];
    const assets: MiniAppCustomMediaAsset[] = [];
    for (const row of rows) {
      const path = String(row["storage_path"] ?? "");
      const bytes = Number(row["file_size_bytes"] ?? 0);
      if (!isWorkspaceCustomMediaPath(g.workspaceId, path) || !(bytes > 0 && bytes <= CUSTOM_MEDIA_MAX_BYTES)) continue;
      let previewDataUrl: string | null = null;
      const { data: blob } = await g.admin.storage.from(CUSTOM_MEDIA_BUCKET).download(path);
      if (blob && blob.size <= CUSTOM_MEDIA_MAX_BYTES) {
        const buf = new Uint8Array(await blob.arrayBuffer());
        const check = inspectCustomMedia(buf);
        if (check.ok) previewDataUrl = `data:${check.mimeType};base64,${customMediaToBase64(buf)}`;
      }
      const meta = (row["metadata"] ?? {}) as Record<string, unknown>;
      assets.push({
        id: String(row["id"]),
        mimeType: String(row["mime_type"] ?? ""),
        animated: meta["animated"] === true,
        width: typeof row["width"] === "number" ? (row["width"] as number) : null,
        height: typeof row["height"] === "number" ? (row["height"] as number) : null,
        bytes,
        previewDataUrl,
      });
    }
    return {
      ok: true,
      entitled: g.entitled,
      assets,
      selection,
      brandKitReady: Boolean(kit),
    };
  });

export const miniAppCustomMediaUpload = createServerFn({ method: "POST" })
  .inputValidator((input: { initData: string; workspaceId: string; fileBase64: string }) => input)
  .handler(async ({ data }): Promise<{ ok: true; assetId: string } | MiniAppFailure> => {
    const raw = typeof data?.fileBase64 === "string" ? data.fileBase64 : "";
    if (raw.length === 0 || raw.length > Math.ceil((CUSTOM_MEDIA_MAX_BYTES * 4) / 3) + 4) return fail("too_large");
    const g = await customMediaGate(data?.initData, data?.workspaceId);
    if (!g.ok) return g;
    if (!g.entitled) return fail("pro_required");
    const bytes = customMediaFromBase64(raw);
    if (!bytes) return fail("corrupt");
    const check = inspectCustomMedia(bytes);
    if (!check.ok) return fail(check.reason);
    const assetId = crypto.randomUUID();
    const path = customMediaStoragePath(g.workspaceId, assetId, check.kind);
    const { error: upErr } = await g.admin.storage
      .from(CUSTOM_MEDIA_BUCKET)
      .upload(path, bytes, { contentType: check.mimeType, upsert: false });
    if (upErr) return fail("unavailable");
    const { error: insErr } = await g.admin.from("media_assets").insert({
      id: assetId,
      workspace_id: g.workspaceId,
      uploaded_by: g.actorUserId,
      storage_path: path,
      asset_type: CUSTOM_MEDIA_ASSET_TYPE,
      mime_type: check.mimeType,
      width: check.width,
      height: check.height,
      file_size_bytes: check.bytes,
      metadata: { purpose: CUSTOM_MEDIA_PURPOSE, animated: check.animated, source: "mini_app" },
    });
    if (insErr) {
      await g.admin.storage.from(CUSTOM_MEDIA_BUCKET).remove([path]);
      return fail("unavailable");
    }
    return { ok: true, assetId };
  });

export const miniAppCustomMediaSelect = createServerFn({ method: "POST" })
  .inputValidator((input: { initData: string; workspaceId: string; slot: string; assetId: string | null }) => input)
  .handler(async ({ data }): Promise<{ ok: true } | MiniAppFailure> => {
    if (!isCustomMediaSlot(data?.slot)) return fail("invalid_slot");
    const assetId = data?.assetId ?? null;
    if (assetId !== null && !isUuid(assetId)) return fail("invalid_asset");
    const g = await customMediaGate(data?.initData, data?.workspaceId);
    if (!g.ok) return g;
    if (assetId !== null && !g.entitled) return fail("pro_required");
    const { data: result, error } = await g.admin.rpc(CUSTOM_MEDIA_SELECT_RPC, {
      _workspace_id: g.workspaceId,
      _actor_user_id: g.actorUserId,
      _slot: data.slot,
      _asset_id: assetId,
    });
    if (error || !result || typeof result !== "object") return fail("unavailable");
    const r = result as Record<string, unknown>;
    if (r["ok"] !== true) {
      const reason = String(r["reason"] ?? "unavailable");
      return fail(reason === "PRO_REQUIRED" ? "pro_required" : reason === "BRAND_KIT_REQUIRED" ? "brand_kit_required" : reason === "ASSET_NOT_FOUND" ? "invalid_asset" : "unavailable");
    }
    return { ok: true };
  });
