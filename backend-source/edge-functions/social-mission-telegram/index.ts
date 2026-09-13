/**
 * SE-3 — `social-mission-telegram` (authenticated Edge Function, verify_jwt=true).
 *
 * Repository parity copy. Deployment is performed externally against the
 * authoritative Supabase project; Lovable never deploys or writes the DB.
 *
 * Narrow transport for Cartel Social Missions. Deliberately NOT an extension of
 * the mature `telegram-group` function: it reuses that function's proven
 * patterns (auth + owner/admin gate, live group verification, fixed API host,
 * 10s timeout, SENT / FAILED / AMBIGUOUS honesty) without touching any existing
 * Telegram behaviour, connection metadata, bot or ledger.
 *
 * Exactly two actions: `send_mission`, `edit_mission`.
 *
 * Hard boundaries:
 * - no X / social provider / Refetcher call
 * - no usage_ledger write, no cron, no scheduler, no background work
 * - no second bot, no connection mutation, no webhook change
 * - never logs or returns the bot token or a raw Telegram payload
 */

import { createClient } from "@supabase/supabase-js";

const TG_BASE = "https://api.telegram.org";
const TELEGRAM_TIMEOUT_MS = 10_000;
const TELEGRAM_UPLOAD_TIMEOUT_MS = 20_000;
const TELEGRAM_TEXT_LIMIT = 4096;

/**
 * SE-3.3 branded identity transport.
 *
 * The private workspace asset bucket is fixed server-side. A logo is only ever
 * resolved profile -> media_assets inside the SAME workspace, downloaded with
 * the service-role storage client, and attached as binary bytes. No signed URL,
 * no public URL and no asset identifier ever reaches the browser, and the
 * browser can never supply a media path, asset id or transport kind.
 */
const WORKSPACE_ASSET_BUCKET = "workspace-assets";
const LOGO_ASSET_TYPE = "logo";
const LOGO_ALLOWED_MIME = ["image/jpeg", "image/jpg", "image/png", "image/webp"];
const LOGO_MAX_BYTES = 5_000_000;

type TransportKind = "TEXT" | "PHOTO";

/**
 * SE-4A / SE-4B — the exact allowlist of server-only internal callers. Each is
 * paired with an exact service-role bearer token; neither half is sufficient
 * alone, and no value here ever reaches the browser. Every internal call still
 * passes the full owner/admin, workspace-binding and live-group checks below.
 */
const INTERNAL_SOURCE = "telegram-webhook";
const INTERNAL_SOURCE_RUNNER = "social-mission-runner";
const INTERNAL_SOURCES: readonly string[] = [INTERNAL_SOURCE, INTERNAL_SOURCE_RUNNER];

import {
  renderMissionCard,
  EMPTY_METRICS,
  TELEGRAM_CAPTION_MAX,
  type CanonicalMetrics,
  type MissionCardPlatform,
  type MissionCardStatus,
} from "./card.ts";

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

type Json = Record<string, unknown>;

function json(payload: Json, status = 200): Response {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { ...CORS, "Content-Type": "application/json" },
  });
}

function fail(message: string, status: number, extra: Json = {}): Response {
  return json({ error: message, ...extra }, status);
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function uuid(value: unknown): string | null {
  return typeof value === "string" && UUID_RE.test(value.trim()) ? value.trim() : null;
}

// --------------------------------------------------------------------------
// Telegram transport. One fixed host, one bounded call, no token in output.
// --------------------------------------------------------------------------

type TelegramOutcome =
  | { kind: "ok"; result: Json }
  | { kind: "rejected"; description: string; code: number }
  | { kind: "uncertain"; description: string };

async function callTelegram(
  token: string,
  method: string,
  body: Json | FormData,
  timeoutMs: number = TELEGRAM_TIMEOUT_MS,
): Promise<TelegramOutcome> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  const multipart = body instanceof FormData;
  try {
    const response = await fetch(`${TG_BASE}/bot${token}/${method}`, {
      method: "POST",
      // multipart/form-data sets its own boundary header; JSON keeps the old one.
      ...(multipart ? {} : { headers: { "Content-Type": "application/json" } }),
      body: multipart ? body : JSON.stringify(body),
      signal: controller.signal,
    });

    // 429 and 5xx are transport-uncertain: the message may still have been sent.
    if (response.status === 429 || response.status >= 500) {
      return { kind: "uncertain", description: `Telegram returned ${response.status}.` };
    }

    let payload: { ok?: boolean; result?: unknown; description?: unknown; error_code?: unknown };
    try {
      payload = (await response.json()) as typeof payload;
    } catch {
      return { kind: "uncertain", description: "Telegram returned an unreadable response." };
    }

    if (payload && payload.ok === true && payload.result && typeof payload.result === "object") {
      return { kind: "ok", result: payload.result as Json };
    }
    if (payload && payload.ok === false) {
      const description =
        typeof payload.description === "string" ? payload.description : "Telegram rejected the request.";
      const code = typeof payload.error_code === "number" ? payload.error_code : response.status;
      return { kind: "rejected", description, code };
    }
    return { kind: "uncertain", description: "Telegram returned an inconclusive response." };
  } catch (_error) {
    // Abort (timeout) and network failure are both uncertain, never "failed".
    return { kind: "uncertain", description: "Telegram did not respond in time." };
  } finally {
    clearTimeout(timer);
  }
}

function isNotModified(description: string): boolean {
  return description.toLowerCase().includes("message is not modified");
}

/** Live verification at execution time: getMe + getChat + getChatMember. */
async function verifyGroup(
  token: string,
  chatId: number,
): Promise<{ ok: true } | { ok: false; definite: boolean; message: string }> {
  const me = await callTelegram(token, "getMe", {});
  if (me.kind === "uncertain") return { ok: false, definite: false, message: me.description };
  if (me.kind === "rejected") return { ok: false, definite: true, message: "Bot credentials rejected." };
  const botId = (me.result as { id?: unknown }).id;
  if (typeof botId !== "number") {
    return { ok: false, definite: false, message: "Bot identity unavailable." };
  }

  const chat = await callTelegram(token, "getChat", { chat_id: chatId });
  if (chat.kind === "uncertain") return { ok: false, definite: false, message: chat.description };
  if (chat.kind === "rejected") {
    return { ok: false, definite: true, message: "The Telegram community is not reachable." };
  }
  const chatType = (chat.result as { type?: unknown }).type;
  if (chatType !== "group" && chatType !== "supergroup") {
    return { ok: false, definite: true, message: "The target chat is not a group or supergroup." };
  }

  const member = await callTelegram(token, "getChatMember", { chat_id: chatId, user_id: botId });
  if (member.kind === "uncertain") return { ok: false, definite: false, message: member.description };
  if (member.kind === "rejected") {
    return { ok: false, definite: true, message: "The bot is no longer in this community." };
  }
  const status = (member.result as { status?: unknown }).status;
  if (status !== "administrator" && status !== "creator") {
    return { ok: false, definite: true, message: "The bot must be an administrator of this community." };
  }
  return { ok: true };
}

// --------------------------------------------------------------------------
// Authoritative render load
// --------------------------------------------------------------------------

type LoadedRow = Record<string, unknown>;

function metricsFrom(row: LoadedRow | null, prefix: string): CanonicalMetrics {
  if (!row) return { ...EMPTY_METRICS };
  const read = (key: string): number | null => {
    const value = row[`${prefix}${key}`];
    return typeof value === "number" && Number.isFinite(value) ? value : null;
  };
  return {
    views: read("views"),
    likes: read("likes"),
    comments: read("comments"),
    shares: read("shares"),
    saves: read("saves"),
  };
}

function cardStatus(missionStatus: string): MissionCardStatus | null {
  if (missionStatus === "LIVE") return "LIVE";
  if (missionStatus === "COMPLETED") return "COMPLETED";
  if (missionStatus === "CANCELLED") return "CANCELLED";
  if (missionStatus === "FAILED") return "FAILED";
  return null; // DRAFT (or anything unknown) is never rendered.
}

/**
 * SE-3.3 — canonical project logo resolution.
 *
 * Strictly workspace-bound: the profile is loaded by workspace, and the asset
 * is loaded by (asset id AND the SAME workspace id AND asset_type 'logo'), so a
 * cross-workspace `logo_asset_id` can never resolve to another project's asset.
 * Any miss, wrong mime, empty path, oversize object or download failure simply
 * yields null, which the caller treats as "send the plain text card" — never as
 * a send failure. This runs BEFORE the transport claim, so a fallback to TEXT
 * is always a pre-Telegram decision.
 */
async function resolveProjectLogo(
  admin: ReturnType<typeof createClient>,
  workspaceId: string,
): Promise<{ bytes: Uint8Array; mimeType: string; fileName: string } | null> {
  try {
    const { data: profile } = await admin
      .from("project_profiles")
      .select("workspace_id, logo_asset_id")
      .eq("workspace_id", workspaceId)
      .maybeSingle();
    const logoAssetId = profile ? ((profile as LoadedRow)["logo_asset_id"] as string | null) : null;
    if (!logoAssetId) return null;

    const { data: asset } = await admin
      .from("media_assets")
      .select("id, workspace_id, asset_type, storage_path, mime_type")
      .eq("id", logoAssetId)
      .eq("workspace_id", workspaceId)
      .eq("asset_type", LOGO_ASSET_TYPE)
      .maybeSingle();
    if (!asset) return null;

    const a = asset as LoadedRow;
    // Defence in depth: never trust the join alone.
    if (a["workspace_id"] !== workspaceId) return null;

    const storagePath = typeof a["storage_path"] === "string" ? a["storage_path"].trim() : "";
    if (!storagePath) return null;

    const mimeType = typeof a["mime_type"] === "string" ? a["mime_type"].toLowerCase() : "";
    if (!LOGO_ALLOWED_MIME.includes(mimeType)) return null;

    const { data: blob, error: downloadError } = await admin.storage
      .from(WORKSPACE_ASSET_BUCKET)
      .download(storagePath);
    if (downloadError || !blob) return null;

    const bytes = new Uint8Array(await blob.arrayBuffer());
    if (bytes.byteLength === 0 || bytes.byteLength > LOGO_MAX_BYTES) return null;

    const extension = mimeType === "image/png" ? "png" : mimeType === "image/webp" ? "webp" : "jpg";
    return { bytes, mimeType, fileName: `logo.${extension}` };
  } catch {
    // A logo problem is never a transport failure.
    return null;
  }
}

async function renderAuthoritativeCard(
  admin: ReturnType<typeof createClient>,
  workspaceId: string,
  mission: LoadedRow,
  transportKind: TransportKind,
): Promise<{ text: string; replyMarkup: unknown } | { error: string }> {
  const status = cardStatus(String(mission["status"] ?? ""));
  if (!status) return { error: "This mission is not in a sendable state." };

  const postId = mission["social_post_id"];
  if (typeof postId !== "string") return { error: "This mission has no bound social post." };

  const { data: post } = await admin
    .from("social_posts")
    .select("id, workspace_id, platform, canonical_url, author_handle, content_text")
    .eq("id", postId)
    .eq("workspace_id", workspaceId)
    .maybeSingle();
  if (!post) return { error: "The mission post is not available." };

  const { data: snapshot } = await admin
    .from("social_metric_snapshots")
    .select("views, likes, comments, shares, saves, observed_at")
    .eq("mission_id", mission["id"] as string)
    .eq("workspace_id", workspaceId)
    .order("observed_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  const { data: profile } = await admin
    .from("project_profiles")
    .select("project_name, ticker")
    .eq("workspace_id", workspaceId)
    .maybeSingle();

  const card = renderMissionCard({
    missionStatus: status,
    platform: String((post as LoadedRow)["platform"] ?? "x") as MissionCardPlatform,
    canonicalUrl: String((post as LoadedRow)["canonical_url"] ?? ""),
    authorHandle: ((post as LoadedRow)["author_handle"] as string | null) ?? null,
    contentText: ((post as LoadedRow)["content_text"] as string | null) ?? null,
    projectName: profile ? ((profile as LoadedRow)["project_name"] as string | null) ?? null : null,
    ticker: profile ? ((profile as LoadedRow)["ticker"] as string | null) ?? null : null,
    baseline: metricsFrom(mission, "baseline_"),
    latest: snapshot ? metricsFrom(snapshot as LoadedRow, "") : null,
    // A photo caption is hard-limited by Telegram; the renderer refits instead
    // of risking a rejected transport.
    maxLength: transportKind === "PHOTO" ? TELEGRAM_CAPTION_MAX : TELEGRAM_TEXT_LIMIT,
  });

  const limit = transportKind === "PHOTO" ? TELEGRAM_CAPTION_MAX : TELEGRAM_TEXT_LIMIT;
  if (!card.text.trim() || card.text.length > limit) {
    return { error: "The mission card could not be rendered safely." };
  }
  return { text: card.text, replyMarkup: card.replyMarkup };
}

// --------------------------------------------------------------------------
// Durable state persistence.
//
// Supabase returns no error when an UPDATE matches ZERO rows. Every state write
// therefore returns the affected row and is only treated as persisted when
// exactly one row comes back. A write that cannot be proven is never reported
// to the caller as a durable terminal state.
// --------------------------------------------------------------------------

async function updateTargetState(
  admin: ReturnType<typeof createClient>,
  targetId: string,
  workspaceId: string,
  patch: Record<string, unknown>,
): Promise<boolean> {
  const { data, error } = await admin
    .from("social_mission_targets")
    .update(patch)
    .eq("id", targetId)
    .eq("workspace_id", workspaceId)
    .select("id")
    .maybeSingle();
  return !error && !!data;
}

const UNRESOLVED_SEND = "The send could not be resolved; this target is left unresolved and will not be retried.";
const UNRESOLVED_EDIT = "The edit could not be resolved; this target is left unresolved and will not be retried.";

// --------------------------------------------------------------------------
// Entry point
// --------------------------------------------------------------------------

Deno.serve(async (request: Request): Promise<Response> => {
  if (request.method === "OPTIONS") return new Response("ok", { headers: CORS });
  if (request.method !== "POST") return fail("Method not allowed.", 405);

  const supabaseUrl = Deno.env.get("SUPABASE_URL");
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  const anonKey = Deno.env.get("SUPABASE_ANON_KEY");
  const botToken = Deno.env.get("TELEGRAM_BOT_TOKEN");
  if (!supabaseUrl || !serviceKey || !anonKey) return fail("Server configuration error.", 500);
  if (!botToken) return fail("Telegram is not configured.", 500);

  // 1. Authenticated caller ------------------------------------------------
  //
  // Two mutually exclusive caller shapes. The end-user path is unchanged: a
  // real Supabase user JWT resolved through the anon client.
  //
  // SE-4A adds ONE server-only internal path for the Telegram webhook. It is
  // recognised only when BOTH the bearer token is exactly the service-role key
  // AND the internal source header names the webhook, and it still requires an
  // explicit UUID actor. That actor is a claim, never an authorization: every
  // existing gate below (owner/admin membership, mission/target/connection row
  // binding, idempotency, live group verification) runs identically.
  const authHeader = request.headers.get("Authorization") ?? "";
  if (!authHeader.startsWith("Bearer ")) return fail("Authentication required.", 401);
  const bearerToken = authHeader.slice("Bearer ".length).trim();

  const internalSource = request.headers.get("X-Cartel-Internal-Source") ?? "";
  const isInternalCaller = INTERNAL_SOURCES.includes(internalSource) && bearerToken === serviceKey;

  let actorUserId: string;
  if (isInternalCaller) {
    const internalActor = uuid(request.headers.get("X-Cartel-Actor-User-Id"));
    if (!internalActor) return fail("Authentication required.", 401);
    actorUserId = internalActor;
  } else {
    const authClient = createClient(supabaseUrl, anonKey, {
      global: { headers: { Authorization: authHeader } },
      auth: { persistSession: false },
    });
    const { data: userData, error: userError } = await authClient.auth.getUser();
    const user = userData?.user;
    if (userError || !user) return fail("Authentication required.", 401);
    actorUserId = user.id;
  }

  let body: Json;
  try {
    body = (await request.json()) as Json;
  } catch {
    return fail("Invalid request body.", 400);
  }

  const action = typeof body["action"] === "string" ? body["action"] : "";
  if (action !== "send_mission" && action !== "edit_mission") {
    return fail("Unsupported action.", 400);
  }

  const workspaceId = uuid(body["workspaceId"]);
  const missionId = uuid(body["missionId"]);
  const targetId = uuid(body["targetId"]);
  const clientRequestId = uuid(body["clientRequestId"]);
  if (!workspaceId || !missionId || !targetId || !clientRequestId) {
    return fail("Invalid request parameters.", 400);
  }

  const admin = createClient(supabaseUrl, serviceKey, { auth: { persistSession: false } });

  // 2. Owner/admin membership gate — ordinary members cannot run transport.
  const { data: membership } = await admin
    .from("workspace_members")
    .select("role")
    .eq("workspace_id", workspaceId)
    .eq("user_id", actorUserId)
    .maybeSingle();
  const role = membership ? String((membership as LoadedRow)["role"] ?? "") : "";
  if (role !== "owner" && role !== "admin") {
    return fail("Only workspace owners and admins can run mission transport.", 403);
  }

  // 3. Authoritative rows, rechecked server-side ---------------------------
  const { data: mission } = await admin
    .from("social_missions")
    .select("*")
    .eq("id", missionId)
    .eq("workspace_id", workspaceId)
    .maybeSingle();
  if (!mission) return fail("Mission not found.", 404);
  if (String((mission as LoadedRow)["status"] ?? "") === "DRAFT") {
    return fail("A draft mission cannot be sent or edited.", 409);
  }

  const { data: target } = await admin
    .from("social_mission_targets")
    .select("*")
    .eq("id", targetId)
    .eq("workspace_id", workspaceId)
    .eq("mission_id", missionId)
    .maybeSingle();
  if (!target) return fail("Mission target not found.", 404);
  const t = target as LoadedRow;

  const chatId = typeof t["telegram_chat_id"] === "number" ? (t["telegram_chat_id"] as number) : null;
  const connectionId = typeof t["group_connection_id"] === "string" ? (t["group_connection_id"] as string) : null;
  if (chatId === null || !connectionId) {
    return fail("This target is no longer bound to a Telegram community.", 409);
  }

  const { data: connection } = await admin
    .from("telegram_group_connections")
    .select("id, workspace_id, telegram_chat_id")
    .eq("id", connectionId)
    .eq("workspace_id", workspaceId)
    .eq("telegram_chat_id", chatId)
    .maybeSingle();
  if (!connection) {
    return fail("The Telegram community connection for this target no longer matches.", 409);
  }

  if (action === "send_mission") {
    return await handleSend({ admin, botToken, workspaceId, mission: mission as LoadedRow, t, chatId, clientRequestId });
  }

  const revision = body["revision"];
  if (typeof revision !== "number" || !Number.isInteger(revision) || revision < 1) {
    return fail("Invalid revision.", 400);
  }
  return await handleEdit({
    admin,
    botToken,
    workspaceId,
    mission: mission as LoadedRow,
    t,
    chatId,
    clientRequestId,
    revision,
  });
});

// --------------------------------------------------------------------------
// send_mission
// --------------------------------------------------------------------------

async function handleSend(args: {
  admin: ReturnType<typeof createClient>;
  botToken: string;
  workspaceId: string;
  mission: LoadedRow;
  t: LoadedRow;
  chatId: number;
  clientRequestId: string;
}): Promise<Response> {
  const { admin, botToken, workspaceId, mission, t, chatId, clientRequestId } = args;
  const targetId = String(t["id"]);
  const state = String(t["delivery_state"] ?? "");

  // 3a. Idempotency resolved BEFORE live verification and BEFORE Telegram.
  if (t["send_client_request_id"] === clientRequestId) {
    return json({
      deliveryState: state,
      duplicate: true,
      telegramMessageId: (t["telegram_message_id"] as number | null) ?? null,
      sentAt: (t["sent_at"] as string | null) ?? null,
      message: "This send request was already recorded.",
    });
  }

  // A fresh request may only claim PENDING, or retry a definitively FAILED
  // target (FAILED proves nothing was delivered). SENDING/AMBIGUOUS/SENT are
  // refused so a duplicate message can never be produced.
  if (state !== "PENDING" && state !== "FAILED") {
    return fail(
      state === "SENT"
        ? "This target was already sent."
        : "A previous send attempt is unresolved; this target cannot be sent again.",
      409,
      { deliveryState: state },
    );
  }

  // 3b. Resolve the branded identity BEFORE anything is claimed or sent. A
  // missing or unusable logo is a normal outcome: it simply selects the plain
  // text transport. This is the ONLY point at which TEXT fallback is allowed.
  const logo = await resolveProjectLogo(admin, workspaceId);
  const desiredTransportKind: TransportKind = logo ? "PHOTO" : "TEXT";

  // 3c. Render authoritatively, then durably claim the intent BEFORE transport.
  const rendered = await renderAuthoritativeCard(admin, workspaceId, mission, desiredTransportKind);
  if ("error" in rendered) return fail(rendered.error, 409);

  // Compare-and-set. The claim must return exactly one row: a zero-row update
  // reports no error, and treating that as success would let a second
  // concurrent request continue to Telegram and duplicate the send.
  //
  // transport_kind is claimed together with the send intent so that even an
  // ambiguous outcome durably remembers which Telegram edit method applies.
  const { data: claimedRow, error: claimError } = await admin
    .from("social_mission_targets")
    .update({
      delivery_state: "SENDING",
      transport_kind: desiredTransportKind,
      send_client_request_id: clientRequestId,
      send_text_intent: rendered.text,
      telegram_message_id: null,
      sent_at: null,
      message_text_snapshot: null,
      last_error: null,
    })
    .eq("id", targetId)
    .eq("workspace_id", workspaceId)
    .eq("delivery_state", state)
    .select("id")
    .maybeSingle();
  if (claimError || !claimedRow) {
    // Not claimed: another request owns this target. Stop before verification
    // and before Telegram. No retry.
    return fail("Could not claim this target for sending.", 409);
  }

  // 3c. Live verification after the claim.
  const verified = await verifyGroup(botToken, chatId);
  if (!verified.ok) {
    const nextState = verified.definite ? "FAILED" : "AMBIGUOUS";
    const persisted = await updateTargetState(admin, targetId, workspaceId, {
      delivery_state: nextState,
      last_error: verified.message.slice(0, 1000),
    });
    if (!persisted) {
      // The durable SENDING claim remains and keeps blocking fresh sends. That
      // is safer than advertising a terminal state we could not record.
      return json({ deliveryState: "AMBIGUOUS", message: UNRESOLVED_SEND }, 202);
    }
    return json({ deliveryState: nextState, message: verified.message }, verified.definite ? 409 : 202);
  }

  // 3e. Exactly ONE transport call. A branded target sends one sendPhoto with
  // the logo bytes as multipart body and the card as caption; a plain target
  // sends one sendMessage. There is no companion message and, once a call has
  // been attempted, no text retry: a rejection or ambiguity is recorded as-is.
  let outcome: TelegramOutcome;
  if (logo) {
    const form = new FormData();
    form.append("chat_id", String(chatId));
    form.append("caption", rendered.text);
    if (rendered.replyMarkup) form.append("reply_markup", JSON.stringify(rendered.replyMarkup));
    form.append("photo", new Blob([logo.bytes as BlobPart], { type: logo.mimeType }), logo.fileName);
    outcome = await callTelegram(botToken, "sendPhoto", form, TELEGRAM_UPLOAD_TIMEOUT_MS);
  } else {
    outcome = await callTelegram(botToken, "sendMessage", {
      chat_id: chatId,
      text: rendered.text,
      disable_web_page_preview: true,
      ...(rendered.replyMarkup ? { reply_markup: rendered.replyMarkup } : {}),
    });
  }

  if (outcome.kind === "ok") {
    const messageId = (outcome.result as { message_id?: unknown }).message_id;
    if (typeof messageId !== "number") {
      const persisted = await updateTargetState(admin, targetId, workspaceId, {
        delivery_state: "AMBIGUOUS",
        last_error: "Telegram did not confirm a message id.",
      });
      return json(
        {
          deliveryState: "AMBIGUOUS",
          message: persisted ? "Telegram did not confirm a message id." : UNRESOLVED_SEND,
        },
        202,
      );
    }

    const sentAt = new Date().toISOString();
    const finalized = await updateTargetState(admin, targetId, workspaceId, {
      delivery_state: "SENT",
      telegram_message_id: messageId,
      sent_at: sentAt,
      message_text_snapshot: rendered.text,
      last_error: null,
    });

    if (!finalized) {
      // Message exists but the durable row could not be finalized. The row keeps
      // its SENDING claim, so no attempt can ever resend it. No second call.
      return json(
        {
          deliveryState: "AMBIGUOUS",
          message: "The message was sent but its state could not be recorded.",
        },
        202,
      );
    }
    return json({ deliveryState: "SENT", telegramMessageId: messageId, sentAt });
  }

  if (outcome.kind === "rejected") {
    const persisted = await updateTargetState(admin, targetId, workspaceId, {
      delivery_state: "FAILED",
      last_error: outcome.description.slice(0, 1000),
    });
    if (!persisted) {
      return json({ deliveryState: "AMBIGUOUS", message: UNRESOLVED_SEND }, 202);
    }
    return json({ deliveryState: "FAILED", message: outcome.description }, 409);
  }

  const persisted = await updateTargetState(admin, targetId, workspaceId, {
    delivery_state: "AMBIGUOUS",
    last_error: outcome.description.slice(0, 1000),
  });
  return json({ deliveryState: "AMBIGUOUS", message: persisted ? outcome.description : UNRESOLVED_SEND }, 202);
}

// --------------------------------------------------------------------------
// edit_mission
// --------------------------------------------------------------------------

async function handleEdit(args: {
  admin: ReturnType<typeof createClient>;
  botToken: string;
  workspaceId: string;
  mission: LoadedRow;
  t: LoadedRow;
  chatId: number;
  clientRequestId: string;
  revision: number;
}): Promise<Response> {
  const { admin, botToken, workspaceId, mission, t, chatId, clientRequestId, revision } = args;
  const targetId = String(t["id"]);
  const editState = String(t["edit_state"] ?? "IDLE");
  const currentRevision = typeof t["edit_revision"] === "number" ? (t["edit_revision"] as number) : 0;
  const messageId = typeof t["telegram_message_id"] === "number" ? (t["telegram_message_id"] as number) : null;

  if (String(t["delivery_state"] ?? "") !== "SENT" || messageId === null) {
    return fail("Only a confirmed sent target can be edited.", 409);
  }

  // Idempotency BEFORE live verification and BEFORE Telegram.
  if (t["edit_client_request_id"] === clientRequestId) {
    if (currentRevision !== revision) {
      return fail("This edit request id is already bound to a different revision.", 409, {
        editState,
        editRevision: currentRevision,
      });
    }
    return json({
      editState,
      duplicate: true,
      editRevision: currentRevision,
      lastEditAt: (t["last_edit_at"] as string | null) ?? null,
      message: "This edit request was already recorded.",
    });
  }

  // An unresolved edit blocks the next revision so updates cannot reorder.
  if (editState === "EDITING" || editState === "AMBIGUOUS") {
    return fail("A previous edit is unresolved; this target cannot be edited again.", 409, {
      editState,
      editRevision: currentRevision,
    });
  }

  if (revision !== currentRevision + 1) {
    return fail("Stale or conflicting edit revision.", 409, { editState, editRevision: currentRevision });
  }

  // The Telegram edit method is decided by the DURABLE transport kind recorded
  // when the message was claimed and sent. Historical rows default to TEXT, so
  // pre-SE-3.3 messages keep using editMessageText. There is no probing.
  const transportKind: TransportKind = t["transport_kind"] === "PHOTO" ? "PHOTO" : "TEXT";

  const rendered = await renderAuthoritativeCard(admin, workspaceId, mission, transportKind);
  if ("error" in rendered) return fail(rendered.error, 409);

  // Compare-and-set on revision + edit state. A zero-row update returns no
  // error, so the claim must return exactly one row before any transport.
  const { data: claimedRow, error: claimError } = await admin
    .from("social_mission_targets")
    .update({
      edit_state: "EDITING",
      edit_client_request_id: clientRequestId,
      edit_revision: revision,
      edit_text_snapshot: rendered.text,
      edit_last_error: null,
      last_edit_at: null,
    })
    .eq("id", targetId)
    .eq("workspace_id", workspaceId)
    .eq("edit_revision", currentRevision)
    .eq("edit_state", editState)
    .select("id")
    .maybeSingle();
  if (claimError || !claimedRow) {
    // Not claimed: stop before verification and before Telegram. No retry.
    return fail("Could not claim this target for editing.", 409);
  }

  const verified = await verifyGroup(botToken, chatId);
  if (!verified.ok) {
    const nextState = verified.definite ? "FAILED" : "AMBIGUOUS";
    const persisted = await updateTargetState(admin, targetId, workspaceId, {
      edit_state: nextState,
      edit_last_error: verified.message.slice(0, 1000),
    });
    if (!persisted) {
      // The EDITING claim remains and blocks future revisions.
      return json({ editState: "AMBIGUOUS", message: UNRESOLVED_EDIT }, 202);
    }
    return json({ editState: nextState, message: verified.message }, verified.definite ? 409 : 202);
  }

  // Exactly ONE edit call on the SAME message: editMessageCaption for a branded
  // photo card, editMessageText for a text card. Never both, never a probe of
  // one followed by the other, and never a replacement send.
  const outcome =
    transportKind === "PHOTO"
      ? await callTelegram(botToken, "editMessageCaption", {
          chat_id: chatId,
          message_id: messageId,
          caption: rendered.text,
          ...(rendered.replyMarkup ? { reply_markup: rendered.replyMarkup } : {}),
        })
      : await callTelegram(botToken, "editMessageText", {
          chat_id: chatId,
          message_id: messageId,
          text: rendered.text,
          disable_web_page_preview: true,
          ...(rendered.replyMarkup ? { reply_markup: rendered.replyMarkup } : {}),
        });

  const confirmed =
    outcome.kind === "ok" || (outcome.kind === "rejected" && isNotModified(outcome.description));

  if (confirmed) {
    const editedAt = new Date().toISOString();
    const finalized = await updateTargetState(admin, targetId, workspaceId, {
      edit_state: "EDITED",
      message_text_snapshot: rendered.text,
      edit_last_error: null,
      last_edit_at: editedAt,
    });
    if (!finalized) {
      // Row stays EDITING: future revisions are blocked, and nothing is resent.
      return json(
        { editState: "AMBIGUOUS", message: "The edit was applied but its state could not be recorded." },
        202,
      );
    }
    return json({ editState: "EDITED", editRevision: revision, lastEditAt: editedAt });
  }

  if (outcome.kind === "rejected") {
    // Definite rejection: confirmed snapshot is untouched, no replacement sent.
    const persisted = await updateTargetState(admin, targetId, workspaceId, {
      edit_state: "FAILED",
      edit_last_error: outcome.description.slice(0, 1000),
    });
    if (!persisted) {
      return json({ editState: "AMBIGUOUS", message: UNRESOLVED_EDIT }, 202);
    }
    return json({ editState: "FAILED", message: outcome.description }, 409);
  }

  const persisted = await updateTargetState(admin, targetId, workspaceId, {
    edit_state: "AMBIGUOUS",
    edit_last_error: outcome.description.slice(0, 1000),
  });
  return json({ editState: "AMBIGUOUS", message: persisted ? outcome.description : UNRESOLVED_EDIT }, 202);
}
