import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2";

const TG_BASE = "https://api.telegram.org";
const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

function respond(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { ...cors, "Content-Type": "application/json" } });
}
class TelegramApiError extends Error { technical?: string; constructor(message: string, technical?: string) { super(message); this.technical = technical; } }
/** Hard timeout around every api.telegram.org call so a hung request cannot stall the function. */
const TELEGRAM_TIMEOUT_MS = 10_000;
async function telegramJson(token: string, method: string, body: Record<string, unknown> = {}) {
  let res: Response;
  try { res = await fetch(`${TG_BASE}/bot${token}/${method}`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body), signal: AbortSignal.timeout(TELEGRAM_TIMEOUT_MS) }); }
  catch { throw new TelegramApiError("Could not reach Telegram. Try again shortly."); }
  const payload = await res.json().catch(() => null) as any;
  if (!res.ok || !payload?.ok) { const raw = String(payload?.description ?? `Telegram request failed (${res.status}).`); throw new TelegramApiError(raw, raw); }
  return payload.result;
}
async function sha256Hex(value: string) { const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value)); return Array.from(new Uint8Array(digest)).map((b) => b.toString(16).padStart(2, "0")).join(""); }
function randomHex(bytes = 16) { const a = new Uint8Array(bytes); crypto.getRandomValues(a); return Array.from(a).map((b) => b.toString(16).padStart(2, "0")).join(""); }
async function webhookSecret(token: string) { return (await sha256Hex(`cartelhq-webhook:${token}`)).slice(0, 48); }
function edgeFunctionUrls(supabaseUrl: string) { const host = new URL(supabaseUrl).hostname; const ref = host.split(".")[0] ?? ""; return Array.from(new Set([ref ? `https://${ref}.functions.supabase.co/telegram-webhook` : "", `${supabaseUrl.replace(/\/$/, "")}/functions/v1/telegram-webhook`].filter(Boolean))); }
async function ensureWebhook(token: string, supabaseUrl: string) {
  const secret = await webhookSecret(token); const urls = edgeFunctionUrls(supabaseUrl); const info = await telegramJson(token, "getWebhookInfo").catch(() => null) as any;
  const ordered = info?.url && urls.includes(String(info.url)) ? [String(info.url), ...urls.filter((u) => u !== String(info.url))] : urls;
  let lastError: unknown = null;
  for (const url of ordered) { try { await telegramJson(token, "setWebhook", { url, secret_token: secret, allowed_updates: ["message", "my_chat_member"], drop_pending_updates: false }); return { url }; } catch (err) { lastError = err; } }
  throw lastError instanceof Error ? lastError : new Error("Telegram webhook could not be configured.");
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  if (req.method !== "POST") return respond({ error: "METHOD_NOT_ALLOWED" }, 405);
  const SUPABASE_URL = Deno.env.get("SUPABASE_URL") ?? "";
  const ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY") ?? "";
  const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
  const TELEGRAM_BOT_TOKEN = Deno.env.get("TELEGRAM_BOT_TOKEN") ?? "";
  if (!TELEGRAM_BOT_TOKEN) return respond({ error: "TELEGRAM_NOT_CONFIGURED", message: "Telegram bot is not configured." }, 503);
  const authHeader = req.headers.get("Authorization") ?? "";
  if (!authHeader.startsWith("Bearer ")) return respond({ error: "UNAUTHENTICATED", message: "Sign in to CARTEL HQ first." }, 401);
  const userClient = createClient(SUPABASE_URL, ANON_KEY, { global: { headers: { Authorization: authHeader } }, auth: { persistSession: false, autoRefreshToken: false } });
  const { data: authData, error: authError } = await userClient.auth.getUser();
  if (authError || !authData.user) return respond({ error: "UNAUTHENTICATED", message: "Your session expired. Sign in again." }, 401);
  const user = authData.user;
  const admin = createClient(SUPABASE_URL, SERVICE_KEY, { auth: { persistSession: false, autoRefreshToken: false } });
  let body: Record<string, unknown> = {}; try { body = await req.json(); } catch { return respond({ error: "INVALID_BODY", message: "Invalid request." }, 400); }
  const action = String(body.action ?? "");
  try {
    const me = await telegramJson(TELEGRAM_BOT_TOKEN, "getMe");
    const bot = { id: String(me.id), username: String(me.username ?? ""), firstName: String(me.first_name ?? "") };
    if (!bot.username) return respond({ error: "BOT_USERNAME_MISSING", message: "The Telegram bot does not have a username." }, 500);

    const createRequest = async (metadata: Record<string, unknown>) => {
      await admin.from("telegram_link_requests").update({ status: "cancelled" }).eq("user_id", user.id).eq("status", "pending");
      const nonce = randomHex(16), tokenHash = await sha256Hex(nonce), expiresAt = new Date(Date.now() + 10 * 60 * 1000).toISOString();
      const { data: link, error } = await admin.from("telegram_link_requests").insert({ user_id: user.id, token_hash: tokenHash, status: "pending", expires_at: expiresAt, metadata: { bot_username: bot.username, ...metadata } }).select("id,status,expires_at").single();
      if (error || !link) throw new Error(error?.message ?? "Could not create Telegram link request.");
      return { link, nonce };
    };

    if (action === "create_link") {
      const { link, nonce } = await createRequest({ link_type: "user" });
      try {
        const webhook = await ensureWebhook(TELEGRAM_BOT_TOKEN, SUPABASE_URL); const startParam = `cartelhq_${nonce}`;
        return respond({ requestId: link.id, status: link.status, expiresAt: link.expires_at, bot, startParam, botStartUrl: `https://t.me/${bot.username}?start=${startParam}`, botAppUrl: `tg://resolve?domain=${encodeURIComponent(bot.username)}&start=${encodeURIComponent(startParam)}`, webhookUrl: webhook.url });
      } catch (err) { await admin.from("telegram_link_requests").update({ status: "cancelled" }).eq("id", link.id); const technical = err instanceof TelegramApiError ? err.technical : undefined; return respond({ error: "WEBHOOK_SETUP_FAILED", message: "Telegram could not prepare the secure connection. Try again shortly.", ...(technical ? { technical } : {}) }, 502); }
    }

    if (action === "create_group_link") {
      const workspaceId = String(body.workspaceId ?? "");
      if (!workspaceId) return respond({ error: "WORKSPACE_REQUIRED", message: "Choose a CARTEL HQ workspace first." }, 400);
      const { data: membership } = await admin.from("workspace_members").select("user_id").eq("workspace_id", workspaceId).eq("user_id", user.id).maybeSingle();
      if (!membership) return respond({ error: "FORBIDDEN", message: "You do not have access to this workspace." }, 403);
      const { data: personal } = await admin.from("telegram_connections").select("telegram_user_id").eq("user_id", user.id).maybeSingle();
      if (!personal?.telegram_user_id) return respond({ error: "TELEGRAM_ACCOUNT_REQUIRED", message: "Connect your personal Telegram account before connecting a group." }, 400);
      const { link, nonce } = await createRequest({ link_type: "group", workspace_id: workspaceId });
      try {
        const webhook = await ensureWebhook(TELEGRAM_BOT_TOKEN, SUPABASE_URL); const startParam = `cartelhq_group_${nonce}`; const adminRights = "change_info";
        return respond({ requestId: link.id, status: link.status, expiresAt: link.expires_at, bot, startParam, groupStartUrl: `https://t.me/${bot.username}?startgroup=${startParam}&admin=${adminRights}`, groupAppUrl: `tg://resolve?domain=${encodeURIComponent(bot.username)}&startgroup=${encodeURIComponent(startParam)}&admin=${encodeURIComponent(adminRights)}`, webhookUrl: webhook.url });
      } catch (err) { await admin.from("telegram_link_requests").update({ status: "cancelled" }).eq("id", link.id); const technical = err instanceof TelegramApiError ? err.technical : undefined; return respond({ error: "WEBHOOK_SETUP_FAILED", message: "Telegram could not prepare group connection. Try again shortly.", ...(technical ? { technical } : {}) }, 502); }
    }

    if (action === "link_status") {
      const requestId = body.requestId ? String(body.requestId) : ""; let q = admin.from("telegram_link_requests").select("id,status,expires_at,consumed_at,telegram_user_id,metadata").eq("user_id", user.id).order("created_at", { ascending: false }).limit(1); if (requestId) q = q.eq("id", requestId);
      const { data: rows, error } = await q; if (error) throw error; const link = rows?.[0] ?? null;
      if (link?.status === "pending" && new Date(link.expires_at).getTime() <= Date.now()) { await admin.from("telegram_link_requests").update({ status: "expired" }).eq("id", link.id); link.status = "expired"; }
      const { data: connection } = await admin.from("telegram_connections").select("user_id,telegram_user_id,telegram_username,first_name,last_name,connected_at").eq("user_id", user.id).maybeSingle();
      return respond({ bot, request: link, connected: Boolean(connection?.telegram_user_id), connection: connection ?? null });
    }

    if (action === "group_status") {
      const workspaceId = String(body.workspaceId ?? ""), requestId = body.requestId ? String(body.requestId) : "";
      if (!workspaceId) return respond({ error: "WORKSPACE_REQUIRED", message: "Workspace is required." }, 400);
      const { data: membership } = await admin.from("workspace_members").select("user_id").eq("workspace_id", workspaceId).eq("user_id", user.id).maybeSingle();
      if (!membership) return respond({ error: "FORBIDDEN", message: "You do not have access to this workspace." }, 403);
      let link: any = null;
      if (requestId) { const { data } = await admin.from("telegram_link_requests").select("id,status,expires_at,consumed_at,metadata").eq("id", requestId).eq("user_id", user.id).maybeSingle(); link = data; if (link?.status === "pending" && new Date(link.expires_at).getTime() <= Date.now()) { await admin.from("telegram_link_requests").update({ status: "expired" }).eq("id", link.id); link.status = "expired"; } }
      const { data: groups } = await admin.from("telegram_group_connections").select("id,workspace_id,telegram_chat_id,title,username,chat_type,bot_is_admin,can_set_sticker_set,connected_at,verified_at,metadata").eq("workspace_id", workspaceId).order("connected_at", { ascending: false });
      return respond({ bot, request: link, connected: Boolean(groups?.length), group: groups?.[0] ?? null, groups: groups ?? [] });
    }

    return respond({ error: "UNKNOWN_ACTION", message: "Unknown Telegram link action." }, 400);
  } catch (err) { console.error("[telegram-link]", err instanceof Error ? err.message : "unknown error"); const technical = err instanceof TelegramApiError ? err.technical : undefined; return respond({ error: "TELEGRAM_LINK_ERROR", message: err instanceof Error ? err.message : "Telegram link failed.", ...(technical ? { technical } : {}) }, 500); }
});
