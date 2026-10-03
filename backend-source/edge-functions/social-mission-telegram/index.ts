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
 * Exactly three actions: `send_mission`, `edit_mission`, `resurface_mission`.
 *
 * SE-16.3R-2 adds `resurface_mission`: a rolling canonical replacement that
 * sends ONE new authoritative card, preserves an HQ-owned pin, swaps the
 * canonical message id through the service-only
 * `social_mission_finalize_resurface` RPC, and only then retires the old card.
 * It never reads a social provider, never resends after an uncertain outcome
 * and never deletes the old card before the database swap has committed.
 *
 * Hard boundaries:
 * - no X / social provider / Refetcher call
 * - no usage_ledger write, no cron, no scheduler, no background work
 * - no second bot, no connection mutation, no webhook change
 * - never logs or returns the bot token or a raw Telegram payload
 */

import { createClient } from "@supabase/supabase-js";
import { presentInlineKeyboard, presentTelegramPayload } from "../_shared/telegram-presentation.ts";

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
  type MissionGoal,
  type MissionMetricTargets,
} from "./card.ts";

/**
 * SE-5 — the launch-time official X read. Exactly ONE batch lookup of ONE post
 * id, performed BEFORE the branded card is sent so the first visible card can
 * carry real current metrics. Every failure is fail-soft: no snapshot is
 * written, the mission is neither duplicated nor lost, and the card renders
 * "Live metrics updating…" instead of fake zeroes.
 */
import {
  lookupXPostMetrics,
  minuteBucket,
  availabilityOf,
  X_PROVIDER,
} from "../_shared/x-metrics.ts";

/**
 * SE-15 — pure resolver that folds an active Mission Control manual override
 * over the mission's IMMUTABLE launch config. No network, no database.
 */
import { resolveMissionConfig } from "../_shared/mission-resolved-config.ts";

const MILESTONE_TYPES = ["VIEWS", "LIKES", "REPLIES", "REPOSTS", "TOTAL_INTERACTIONS"] as const;

/**
 * SE-5 launch read. Fail-soft by construction:
 * - returns void, so no caller can branch the mission on its outcome;
 * - never throws;
 * - performs at most ONE official lookup and never retries;
 * - writes at most ONE snapshot, through the same RPC the runner uses, so
 *   baseline capture and milestone evaluation stay in a single place.
 */
async function attemptLaunchMetricsRead(
  admin: ReturnType<typeof createClient>,
  workspaceId: string,
  mission: LoadedRow,
): Promise<void> {
  try {
    const bearer = Deno.env.get("X_API_BEARER_TOKEN") ?? "";
    if (!bearer) return;

    const postId = mission["social_post_id"];
    if (typeof postId !== "string") return;
    const { data: post } = await admin
      .from("social_posts")
      .select("platform, external_post_id")
      .eq("id", postId)
      .eq("workspace_id", workspaceId)
      .maybeSingle();
    if (!post) return;
    const row = post as LoadedRow;
    if (String(row["platform"] ?? "") !== "x") return;
    const externalId = row["external_post_id"];
    if (typeof externalId !== "string" || !/^[0-9]{1,32}$/.test(externalId)) return;

    const read = await lookupXPostMetrics(bearer, [externalId]);
    if (!read.ok) return;
    const found = read.posts.get(externalId);
    if (!found) return;

    await admin.rpc("record_social_mission_metric_snapshot", {
      _mission_id: mission["id"] as string,
      _provider: X_PROVIDER,
      _observed_at: read.observedAt,
      _poll_bucket: minuteBucket(Date.parse(read.observedAt)),
      _views: found.metrics.views,
      _likes: found.metrics.likes,
      _comments: found.metrics.comments,
      _shares: found.metrics.shares,
      _saves: found.metrics.saves,
      _availability: availabilityOf(found.metrics),
      _metadata: { phase: "SE-5", source: "mission_launch" },
    });
  } catch {
    // Fail-soft: a metrics problem must never prevent the mission card.
  }
}

/**
 * SE-6 Step 1 (E) — the FINAL official X read taken by a MANUAL
 * `/mission close`, before the completion card is rendered.
 *
 * Identical guarantees to the launch read: returns void, never throws, at most
 * ONE official lookup, no retry, no synthetic zeroes, and the close still
 * completes when X is unavailable.
 *
 * Duplicate-read guard: `social_metric_snapshots` is unique on
 * (mission_id, provider, poll_bucket). If this mission already has a snapshot
 * in the CURRENT MINUTE bucket — which is exactly what the one-minute runner
 * writes — no provider call is made at all.
 */
async function attemptFinalMetricsRead(
  admin: ReturnType<typeof createClient>,
  workspaceId: string,
  mission: LoadedRow,
): Promise<void> {
  try {
    const bearer = Deno.env.get("X_API_BEARER_TOKEN") ?? "";
    if (!bearer) return;

    const missionId = mission["id"];
    if (typeof missionId !== "string") return;

    const bucket = minuteBucket(Date.now());
    const { data: existing } = await admin
      .from("social_metric_snapshots")
      .select("id")
      .eq("mission_id", missionId)
      .eq("provider", X_PROVIDER)
      .eq("poll_bucket", bucket)
      .maybeSingle();
    if (existing) return; // Already read this minute: never pay twice.

    const postId = mission["social_post_id"];
    if (typeof postId !== "string") return;
    const { data: post } = await admin
      .from("social_posts")
      .select("platform, external_post_id")
      .eq("id", postId)
      .eq("workspace_id", workspaceId)
      .maybeSingle();
    if (!post) return;
    const row = post as LoadedRow;
    if (String(row["platform"] ?? "") !== "x") return;
    const externalId = row["external_post_id"];
    if (typeof externalId !== "string" || !/^[0-9]{1,32}$/.test(externalId)) return;

    const read = await lookupXPostMetrics(bearer, [externalId]);
    if (!read.ok) return;
    const found = read.posts.get(externalId);
    if (!found) return;

    await admin.rpc("record_social_mission_metric_snapshot", {
      _mission_id: missionId,
      _provider: X_PROVIDER,
      _observed_at: read.observedAt,
      _poll_bucket: minuteBucket(Date.parse(read.observedAt)),
      _views: found.metrics.views,
      _likes: found.metrics.likes,
      _comments: found.metrics.comments,
      _shares: found.metrics.shares,
      _saves: found.metrics.saves,
      _availability: availabilityOf(found.metrics),
      _metadata: { phase: "SE-6", source: "mission_close" },
    });
  } catch {
    // Fail-soft: the close must complete even when X is unavailable.
  }
}

/**
 * SE-13.1 — authoritative re-read of ONE mission row.
 *
 * `record_social_mission_metric_snapshot` can mutate the mission inside a
 * metric read: it writes the durable baseline, it can establish the AUTO
 * MISSION GOAL in `metadata.effective_config`, and it can set
 * `accomplished_at`. Any card rendered from the row loaded BEFORE that read is
 * therefore potentially stale. Callers that performed a metric read MUST
 * reload through this helper before rendering.
 *
 * Boundaries: ONE scoped database read by exact mission id AND workspace id.
 * ZERO provider calls, ZERO Telegram calls, ZERO writes. Returns null when the
 * row cannot be re-read, so the caller can fail safely instead of knowingly
 * sending a stale card.
 */
async function reloadMissionRow(
  admin: ReturnType<typeof createClient>,
  workspaceId: string,
  missionId: unknown,
): Promise<LoadedRow | null> {
  if (typeof missionId !== "string" || !missionId) return null;
  try {
    const { data, error } = await admin
      .from("social_missions")
      .select("*")
      .eq("id", missionId)
      .eq("workspace_id", workspaceId)
      .maybeSingle();
    if (error || !data) return null;
    return data as LoadedRow;
  } catch {
    return null;
  }
}




/**
 * SE-15 — the mission's RESOLVED config: its immutable launch snapshot, with an
 * active Mission Control manual override folded over it. The snapshot itself is
 * never rewritten, and a mission that was never controlled resolves to exactly
 * the same object the SE-13/SE-14 readers used before.
 */
function missionConfig(mission: LoadedRow): Record<string, unknown> | null {
  return resolveMissionConfig(mission["metadata"] ?? null);
}

/**
 * SE-13 — the MISSION GOAL, read ONLY from the mission's own config (SE-15:
 * resolved). `milestone_type` / `milestone_target` remain the stored keys;
 * `stretch_goal_target` and `goal_source` are the SE-13 additions and are both
 * optional, so a pre-SE-13 mission still renders its primary goal unchanged.
 */
function missionGoal(mission: LoadedRow): MissionGoal | null {
  const config = missionConfig(mission);
  if (!config) return null;
  const raw = config;
  const type = String(raw["milestone_type"] ?? "NONE").toUpperCase();
  const target = Number(raw["milestone_target"]);
  if (!(MILESTONE_TYPES as readonly string[]).includes(type)) return null;
  if (!Number.isInteger(target) || target <= 0) return null;
  const stretchRaw = Number(raw["stretch_goal_target"]);
  const stretchTarget =
    Number.isInteger(stretchRaw) && stretchRaw > target ? stretchRaw : null;
  const sourceRaw = String(raw["goal_source"] ?? "").toUpperCase();
  const source = sourceRaw === "AUTO" ? "AUTO" : sourceRaw === "EXPLICIT" ? "EXPLICIT" : null;
  return { type: type as MissionGoal["type"], target, stretchTarget, source };
}

/**
 * SE-14 — the supporting target set, read ONLY from the mission's own config
 * (SE-15: resolved). A client can never supply it: nothing in the webhook or
 * transport payload is consulted here. Unknown or invalid entries are dropped
 * rather than coerced.
 */
function missionMetricTargets(mission: LoadedRow): MissionMetricTargets | null {
  const config = missionConfig(mission);
  if (!config) return null;
  const raw = config["metric_targets"];
  if (!raw || typeof raw !== "object") return null;
  const source = raw as Record<string, unknown>;
  const out: MissionMetricTargets = {};
  let known = false;
  for (const key of ["views", "likes", "replies", "reposts", "bookmarks"] as const) {
    const value = Number(source[key]);
    if (Number.isInteger(value) && value > 0) {
      out[key] = value;
      known = true;
    }
  }
  return known ? out : null;
}

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
      body: multipart ? presentTelegramFormData(method, body, "platform") : JSON.stringify(presentTelegramPayload(method, body, "platform")),
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
    accomplished: typeof mission["accomplished_at"] === "string",
    endsAt: (mission["ends_at"] as string | null) ?? null,
    goal: missionGoal(mission),
    metricTargets: missionMetricTargets(mission),
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
  if (action !== "send_mission" && action !== "edit_mission" && action !== "resurface_mission") {
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

  // SE-16.3R-2. The rolling replacement owns its own durable revision lane, so
  // no caller-supplied `revision` is read or required on this path.
  if (action === "resurface_mission") {
    return await handleResurface({
      admin,
      botToken,
      workspaceId,
      mission: mission as LoadedRow,
      t,
      chatId,
      clientRequestId,
    });
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
    // SE-6 Step 1 (E) — a MANUAL `/mission close` takes a best-effort final
    // official X reading before the completion card is rendered. The runner's
    // scheduled completion already refreshed metrics earlier in the same
    // invocation and never asks for another read here.
    finalRefresh: internalSource === INTERNAL_SOURCE,
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

  // SE-5. ONE fail-soft official X read before the first card is rendered, so
  // the launch card can show real current numbers. A failure here NEVER blocks
  // the mission and NEVER writes a snapshot.
  await attemptLaunchMetricsRead(admin, workspaceId, mission);

  // SE-13.1. That read may have established the AUTO MISSION GOAL, the durable
  // baseline or accomplishment state ON THIS MISSION ROW. Re-read the row once
  // — no second X lookup, no extra Telegram call — so the FIRST card cannot be
  // rendered from pre-refresh state. A failed re-read is refused rather than
  // silently sending a card that would omit a goal the database now holds.
  const refreshedMission = await reloadMissionRow(admin, workspaceId, mission["id"]);
  if (!refreshedMission) {
    return fail("The mission could not be re-read after its metrics refresh; nothing was sent.", 409, {
      deliveryState: state,
    });
  }

  // 3c. Render authoritatively, then durably claim the intent BEFORE transport.
  const rendered = await renderAuthoritativeCard(
    admin,
    workspaceId,
    refreshedMission,
    desiredTransportKind,
  );
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
    if (rendered.replyMarkup) form.append("reply_markup", JSON.stringify(presentInlineKeyboard(rendered.replyMarkup)));
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
  finalRefresh?: boolean;
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

  // SE-6 Step 1 (E) — best-effort FINAL official X reading for a manual close,
  // taken BEFORE the completion card is rendered. Skipped entirely when this
  // mission already has a snapshot in the current minute bucket.
  let renderMission = mission;
  if (args.finalRefresh === true && String(mission["status"] ?? "") === "COMPLETED") {
    await attemptFinalMetricsRead(admin, workspaceId, mission);

    // SE-13.1. The final read can move goal / accomplishment state, so the
    // completion card is rendered from the re-read row. No metric refresh ran
    // on any other path, so those paths keep the already-loaded row unchanged.
    const refreshedMission = await reloadMissionRow(admin, workspaceId, mission["id"]);
    if (!refreshedMission) {
      return fail("The mission could not be re-read after its final metrics refresh; nothing was edited.", 409, {
        editState,
        editRevision: currentRevision,
      });
    }
    renderMission = refreshedMission;
  }

  const rendered = await renderAuthoritativeCard(admin, workspaceId, renderMission, transportKind);

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
          ...(rendered.replyMarkup ? { reply_markup: presentInlineKeyboard(rendered.replyMarkup) } : {}),
        })
      : await callTelegram(botToken, "editMessageText", {
          chat_id: chatId,
          message_id: messageId,
          text: rendered.text,
          disable_web_page_preview: true,
          ...(rendered.replyMarkup ? { reply_markup: presentInlineKeyboard(rendered.replyMarkup) } : {}),
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

// --------------------------------------------------------------------------
// resurface_mission — SE-16.3R-2 rolling canonical replacement
//
// One live mission target owns exactly ONE visible branded card. When the card
// has scrolled away, this action publishes a NEW authoritative card, carries an
// HQ-owned pin across to it, makes the new Telegram message id canonical inside
// a single database transaction, and only THEN retires the old card.
//
// Ordering is the whole safety argument:
//   claim -> live permission preflight -> re-read LIVE -> render -> ONE send
//   -> (pin new, only when HQ already owned the pin) -> atomic DB finalize
//   -> best-effort delete of the OLD card.
//
// The old card is never deleted before the swap commits, a newly sent card is
// cleaned up rather than left orphaned when a later step fails, and no step is
// ever retried automatically after an uncertain Telegram outcome.
// --------------------------------------------------------------------------

const UNRESOLVED_RESURFACE =
  "The replacement could not be resolved; this target is left unresolved and will not be retried.";

/** Telegram's way of saying the pin is already exactly what we asked for. */
function isPinAlreadySet(description: string): boolean {
  const text = description.toLowerCase();
  return text.includes("message is not modified") || text.includes("chat_not_modified");
}

/** Telegram's way of saying the message we wanted to delete is already gone. */
function isMessageAlreadyGone(description: string): boolean {
  const text = description.toLowerCase();
  return (
    text.includes("message to delete not found") ||
    text.includes("message_id_invalid") ||
    text.includes("message identifier is not specified")
  );
}

/**
 * Marks the CURRENT claim — and only the current claim — as FAILED or
 * AMBIGUOUS. It is bound to the exact target, workspace, the CLAIMED state and
 * this request id, so a stale attempt can never overwrite a newer claim. It
 * touches no canonical id and no send, edit or pin field.
 */
async function markResurfaceClaim(
  admin: ReturnType<typeof createClient>,
  targetId: string,
  workspaceId: string,
  clientRequestId: string,
  nextState: "FAILED" | "AMBIGUOUS",
  reason: string,
): Promise<boolean> {
  const { data, error } = await admin
    .from("social_mission_targets")
    .update({
      resurface_state: nextState,
      resurface_last_error: reason.slice(0, 1000),
    })
    .eq("id", targetId)
    .eq("workspace_id", workspaceId)
    .eq("resurface_state", "CLAIMED")
    .eq("resurface_client_request_id", clientRequestId)
    .select("id")
    .maybeSingle();
  return !error && !!data;
}

/**
 * Resurface-specific live verification. Deliberately a separate helper: the
 * existing `verifyGroup` contract is used unchanged by send and edit, and must
 * not be widened. Every resurface needs Delete Messages, because a replacement
 * that cannot retire its predecessor would leave two cards. Pin Messages is
 * required ONLY when HQ already owns this target's pin.
 */
async function verifyResurfacePermissions(
  token: string,
  chatId: number,
  requirePin: boolean,
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
  const result = member.result as { status?: unknown; can_delete_messages?: unknown; can_pin_messages?: unknown };
  const status = result.status;
  if (status !== "administrator" && status !== "creator") {
    return { ok: false, definite: true, message: "The bot must be an administrator of this community." };
  }

  // A creator holds every right implicitly and reports no per-right flags.
  if (status === "creator") return { ok: true };

  const canDelete = result.can_delete_messages;
  if (canDelete === false) {
    return {
      ok: false,
      definite: true,
      message: "The bot needs the Delete Messages permission to replace the mission card.",
    };
  }
  if (typeof canDelete !== "boolean") {
    return { ok: false, definite: false, message: "Delete permission could not be confirmed." };
  }

  if (requirePin) {
    const canPin = result.can_pin_messages;
    if (canPin === false) {
      return {
        ok: false,
        definite: true,
        message: "The bot needs the Pin Messages permission to carry the pinned mission card across.",
      };
    }
    if (typeof canPin !== "boolean") {
      return { ok: false, definite: false, message: "Pin permission could not be confirmed." };
    }
  }

  return { ok: true };
}

/**
 * Best-effort retirement of a single Telegram message. Exactly ONE call, never
 * retried. "Already gone" counts as retired, because the desired end state is
 * simply that the message is no longer visible.
 */
async function deleteOneMessage(
  token: string,
  chatId: number,
  messageId: number,
): Promise<{ retired: boolean; definite: boolean; message: string }> {
  const outcome = await callTelegram(token, "deleteMessage", { chat_id: chatId, message_id: messageId });
  if (outcome.kind === "ok") return { retired: true, definite: true, message: "Message removed." };
  if (outcome.kind === "rejected") {
    if (isMessageAlreadyGone(outcome.description)) {
      return { retired: true, definite: true, message: "Message was already gone." };
    }
    return { retired: false, definite: true, message: outcome.description };
  }
  return { retired: false, definite: false, message: outcome.description };
}

async function handleResurface(args: {
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
  const resurfaceState = String(t["resurface_state"] ?? "IDLE");
  const currentRevision =
    typeof t["resurface_revision"] === "number" ? (t["resurface_revision"] as number) : 0;
  const oldMessageId =
    typeof t["telegram_message_id"] === "number" ? (t["telegram_message_id"] as number) : null;
  const pinnedByHq = t["pinned_by_hq"] === true;

  // 1. Only a LIVE mission with a confirmed canonical card can be replaced.
  if (String(mission["status"] ?? "") !== "LIVE") {
    return fail("Only a live mission card can be replaced.", 409, { resurfaceState });
  }
  if (String(t["delivery_state"] ?? "") !== "SENT" || oldMessageId === null || oldMessageId <= 0) {
    return fail("Only a confirmed sent card can be replaced.", 409, { resurfaceState });
  }

  // 2. Idempotency resolved BEFORE any Telegram call. A replayed request id
  //    reports the recorded state and sends nothing.
  if (t["resurface_client_request_id"] === clientRequestId) {
    return json({
      resurfaceState,
      resurfaceRevision: currentRevision,
      duplicate: true,
      telegramMessageId: resurfaceState === "RESURFACED" ? oldMessageId : null,
      cleanupPending: false,
      message: "This replacement request was already recorded.",
    });
  }

  // 3. A fresh claim may only start from a settled lane. CLAIMED means another
  //    attempt owns the target; AMBIGUOUS means a previous attempt's real-world
  //    effect is unknown and must never be guessed at with a second card.
  if (resurfaceState !== "IDLE" && resurfaceState !== "RESURFACED" && resurfaceState !== "FAILED") {
    return fail("A previous replacement is unresolved; this card cannot be replaced again.", 409, {
      resurfaceState,
      resurfaceRevision: currentRevision,
    });
  }

  // 4. Compare-and-set on state, revision AND the canonical message id, so a
  //    concurrent replacement that already swapped the card cannot be raced.
  const { data: claimedRow, error: claimError } = await admin
    .from("social_mission_targets")
    .update({
      resurface_state: "CLAIMED",
      resurface_client_request_id: clientRequestId,
      resurface_revision: currentRevision + 1,
      last_resurface_attempt_at: new Date().toISOString(),
      resurface_last_error: null,
    })
    .eq("id", targetId)
    .eq("workspace_id", workspaceId)
    .eq("resurface_state", resurfaceState)
    .eq("resurface_revision", currentRevision)
    .eq("telegram_message_id", oldMessageId)
    .select("id")
    .maybeSingle();
  if (claimError || !claimedRow) {
    // Not claimed: stop BEFORE Telegram. Nothing was sent, nothing to undo.
    return fail("Could not claim this card for replacement.", 409, { resurfaceState });
  }

  const revision = currentRevision + 1;

  const settle = async (
    nextState: "FAILED" | "AMBIGUOUS",
    reason: string,
    status: number,
  ): Promise<Response> => {
    const persisted = await markResurfaceClaim(
      admin,
      targetId,
      workspaceId,
      clientRequestId,
      nextState,
      reason,
    );
    return json(
      {
        resurfaceState: persisted ? nextState : "CLAIMED",
        resurfaceRevision: revision,
        duplicate: false,
        cleanupPending: false,
        message: persisted ? reason : UNRESOLVED_RESURFACE,
      },
      persisted ? status : 202,
    );
  };

  // 5. Live permission preflight AFTER the claim and BEFORE any send.
  const permitted = await verifyResurfacePermissions(botToken, chatId, pinnedByHq);
  if (!permitted.ok) {
    return await settle(
      permitted.definite ? "FAILED" : "AMBIGUOUS",
      permitted.message,
      permitted.definite ? 409 : 202,
    );
  }

  // 6. Re-read the mission: it may have completed or been cancelled between the
  //    claim and this point. Nothing has been sent yet, so this is a clean stop.
  const refreshedMission = await reloadMissionRow(admin, workspaceId, mission["id"]);
  if (!refreshedMission) {
    return await settle("FAILED", "The mission could not be re-read; nothing was sent.", 409);
  }
  if (String(refreshedMission["status"] ?? "") !== "LIVE") {
    return await settle("FAILED", "This mission is no longer live; nothing was sent.", 409);
  }

  // 7. The replacement uses the target's DURABLE transport kind. A branded card
  //    stays branded: if the logo can no longer be resolved the claim fails
  //    before Telegram rather than silently degrading the card to plain text.
  const transportKind: TransportKind = t["transport_kind"] === "PHOTO" ? "PHOTO" : "TEXT";
  let logo: { bytes: Uint8Array; mimeType: string; fileName: string } | null = null;
  if (transportKind === "PHOTO") {
    logo = await resolveProjectLogo(admin, workspaceId);
    if (!logo) {
      return await settle(
        "FAILED",
        "The project logo for this branded card could not be resolved; nothing was sent.",
        409,
      );
    }
  }

  // 8. Authoritative render. ZERO social provider reads happen on this path.
  const rendered = await renderAuthoritativeCard(admin, workspaceId, refreshedMission, transportKind);
  if ("error" in rendered) {
    return await settle("FAILED", rendered.error, 409);
  }

  // 9. Exactly ONE new send. No companion message, no probe, no resend.
  let outcome: TelegramOutcome;
  if (logo) {
    const form = new FormData();
    form.append("chat_id", String(chatId));
    form.append("caption", rendered.text);
    if (rendered.replyMarkup) form.append("reply_markup", JSON.stringify(presentInlineKeyboard(rendered.replyMarkup)));
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

  if (outcome.kind === "rejected") {
    // Definitely not sent. The old card remains the canonical card, untouched.
    return await settle("FAILED", outcome.description, 409);
  }
  if (outcome.kind === "uncertain") {
    // The card may or may not exist. Never retried, never resent.
    return await settle("AMBIGUOUS", outcome.description, 202);
  }

  const newMessageIdRaw = (outcome.result as { message_id?: unknown }).message_id;
  if (typeof newMessageIdRaw !== "number" || !Number.isInteger(newMessageIdRaw) || newMessageIdRaw <= 0) {
    return await settle("AMBIGUOUS", "Telegram did not confirm a message id.", 202);
  }
  const newMessageId = newMessageIdRaw;

  /**
   * One best-effort cleanup of the card we just created, used when a LATER step
   * fails. The OLD card is never touched here: it is still the authoritative
   * canonical card until the database says otherwise.
   */
  const abandonNewCard = async (reason: string): Promise<Response> => {
    const removal = await deleteOneMessage(botToken, chatId, newMessageId);
    if (removal.retired) {
      return await settle("FAILED", reason, 409);
    }
    return await settle(
      "AMBIGUOUS",
      `${reason} The replacement card could not be removed.`.slice(0, 1000),
      202,
    );
  };

  // 10. Pin preservation — ONLY when HQ already owned this target's pin. A
  //     target that HQ never pinned never reaches a Telegram pin API here.
  if (pinnedByHq) {
    const pinned = await callTelegram(botToken, "pinChatMessage", {
      chat_id: chatId,
      message_id: newMessageId,
      disable_notification: true,
    });
    const pinConfirmed =
      pinned.kind === "ok" || (pinned.kind === "rejected" && isPinAlreadySet(pinned.description));
    if (!pinConfirmed) {
      return await abandonNewCard("The replacement card could not be pinned, so it was withdrawn.");
    }
  }

  // 11. Atomic canonical finalization. The RPC queues the OLD id for the
  //     existing cleanup worker and swaps the canonical id in one transaction.
  let finalizeOutcome = "";
  let previousMessageId: number | null = null;
  try {
    const { data: finalizeData, error: finalizeError } = await admin.rpc(
      "social_mission_finalize_resurface",
      {
        _target_id: targetId,
        _client_request_id: clientRequestId,
        _new_message_id: newMessageId,
        _message_text: rendered.text,
      },
    );
    if (finalizeError || !finalizeData || typeof finalizeData !== "object") {
      return await abandonNewCard("The replacement could not be recorded, so it was withdrawn.");
    }
    const payload = finalizeData as LoadedRow;
    finalizeOutcome = String(payload["outcome"] ?? "");
    const old = payload["old_message_id"];
    previousMessageId = typeof old === "number" && old > 0 ? old : null;
  } catch {
    return await abandonNewCard("The replacement could not be recorded, so it was withdrawn.");
  }

  if (finalizeOutcome !== "finalized" && finalizeOutcome !== "replayed") {
    // The old card is still the authoritative canonical card. Withdraw the new
    // one rather than leaving two visible cards.
    return await abandonNewCard("The replacement was not accepted, so it was withdrawn.");
  }

  // 12. Only now — after the swap has committed — may the OLD card be retired.
  //     Exactly one attempt. A failure is NOT rolled back and NOT resent: the
  //     cleanup job the finalizer already queued is the durable retry path.
  let cleanupPending = true;
  if (previousMessageId !== null) {
    const retired = await deleteOneMessage(botToken, chatId, previousMessageId);
    cleanupPending = !retired.retired;
  }

  return json({
    resurfaceState: "RESURFACED",
    resurfaceRevision: revision,
    duplicate: finalizeOutcome === "replayed",
    telegramMessageId: newMessageId,
    previousMessageId,
    cleanupPending,
    message: cleanupPending
      ? "The mission card was replaced; the previous card is queued for removal."
      : "The mission card was replaced.",
  });
}
