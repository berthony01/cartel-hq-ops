import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2";
import { PNG } from "npm:pngjs@7.0.0";
import { Buffer } from "node:buffer";

const BUCKET = "workspace-assets";
const TG_BASE = "https://api.telegram.org";
const MAX_STATIC_BYTES = 512 * 1024;
const OUTSIDE_ALPHA = 24;
const HALO_MIN_CHANNEL = 200;
const HALO_MAX_SPREAD = 90;
const MAX_HALO_RATIO = 0.15;

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

function respond(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { ...cors, "Content-Type": "application/json" } });
}

class TelegramError extends Error {
  technical?: string;
  telegramCode?: number;
  constructor(message: string, technical?: string, telegramCode?: number) {
    super(message);
    this.technical = technical;
    this.telegramCode = telegramCode;
  }
}

function friendlyTelegramError(description: string, code?: number) {
  const d = description.toLowerCase();
  if (d.includes("bot was blocked") || d.includes("chat not found") || d.includes("user is deactivated")) return "Telegram could not reach this account. Open the bot in Telegram, tap Start, then try again.";
  if (d.includes("stickerset_invalid") || d.includes("sticker set name is already occupied")) return "Telegram could not use that sticker-set name. Refresh the Telegram status and try publishing again.";
  if (d.includes("sticker_png_dimensions") || d.includes("sticker dimensions") || d.includes("image dimensions")) return "Telegram rejected the sticker dimensions. CARTEL HQ could not prepare this image as a 512px static sticker.";
  if (d.includes("file is too big") || d.includes("file too large")) return "Telegram rejected this sticker because the prepared file is too large.";
  if (d.includes("emoji") && d.includes("invalid")) return "Telegram rejected the sticker emoji. Choose a standard emoji and retry this sticker.";
  if (code === 429 || d.includes("too many requests")) return "Telegram is rate limiting sticker publishing. Wait a moment and retry the failed stickers.";
  return description || "Telegram returned an unexpected error.";
}

/** Hard timeout around every api.telegram.org call so a hung request cannot stall the function. */
const TELEGRAM_TIMEOUT_MS = 10_000;
/** Multipart sticker uploads legitimately take longer than JSON calls. */
const TELEGRAM_UPLOAD_TIMEOUT_MS = 30_000;
async function tgFetch(url: string, init: RequestInit, timeoutMs = TELEGRAM_TIMEOUT_MS) {
  return await fetch(url, { ...init, signal: AbortSignal.timeout(timeoutMs) });
}

async function telegramJson(token: string, method: string, body?: Record<string, unknown>) {
  let res: Response;
  try {
    res = await tgFetch(`${TG_BASE}/bot${token}/${method}`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body ?? {}) });
  } catch {
    throw new TelegramError("Could not reach Telegram. Try again shortly.");
  }
  let payload: any = null;
  try { payload = await res.json(); } catch { payload = null; }
  if (!res.ok || !payload?.ok) {
    const raw = String(payload?.description ?? `Telegram request failed (${res.status}).`);
    throw new TelegramError(friendlyTelegramError(raw, payload?.error_code ?? res.status), raw, payload?.error_code ?? res.status);
  }
  return payload.result;
}

async function maybeGetStickerSet(token: string, name: string): Promise<any | null> {
  try {
    return await telegramJson(token, "getStickerSet", { name });
  } catch (err) {
    if (err instanceof TelegramError) {
      const raw = (err.technical ?? "").toLowerCase();
      if (raw.includes("stickerset_invalid") || raw.includes("sticker set name is invalid")) return null;
    }
    throw err;
  }
}

async function uploadStickerFile(token: string, userId: string, pngBytes: Uint8Array) {
  const form = new FormData();
  form.append("user_id", userId);
  form.append("sticker_format", "static");
  form.append("sticker", new Blob([pngBytes as BlobPart], { type: "image/png" }), "sticker.png");
  let res: Response;
  try { res = await tgFetch(`${TG_BASE}/bot${token}/uploadStickerFile`, { method: "POST", body: form }, TELEGRAM_UPLOAD_TIMEOUT_MS); }
  catch { throw new TelegramError("Could not upload the sticker to Telegram. Try again shortly."); }
  let payload: any = null;
  try { payload = await res.json(); } catch { payload = null; }
  if (!res.ok || !payload?.ok || !payload?.result?.file_id) {
    const raw = String(payload?.description ?? `Telegram upload failed (${res.status}).`);
    throw new TelegramError(friendlyTelegramError(raw, payload?.error_code ?? res.status), raw, payload?.error_code ?? res.status);
  }
  return String(payload.result.file_id);
}

function normalizeStringArray(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((v): v is string => typeof v === "string" && v.trim().length > 0) : [];
}

function normalizeEmoji(value: unknown): string[] {
  const clean = normalizeStringArray(value).map((v) => v.trim()).slice(0, 20);
  return clean.length ? clean : ["🐸"];
}

function normalizeKeywords(value: unknown): string[] {
  const out: string[] = [];
  let total = 0;
  for (const raw of normalizeStringArray(value)) {
    const s = raw.trim().replace(/\s+/g, " ");
    if (!s || out.length >= 20) continue;
    const extra = s.length + (out.length ? 1 : 0);
    if (total + extra > 64) break;
    out.push(s);
    total += extra;
  }
  return out;
}

function makeSetName(title: string, packId: string, botUsername: string) {
  const safeBot = botUsername.replace(/[^A-Za-z0-9_]/g, "_").replace(/_+/g, "_");
  const suffix = `_by_${safeBot}`;
  let base = title.toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/_+/g, "_").replace(/^_+|_+$/g, "");
  if (!/^[a-z]/.test(base)) base = `pack_${base}`;
  const unique = packId.replace(/-/g, "").slice(0, 8);
  const maxBase = Math.max(1, 64 - suffix.length - unique.length - 1);
  base = base.slice(0, maxBase).replace(/_+$/g, "") || "pack";
  let name = `${base}_${unique}${suffix}`.replace(/__+/g, "_");
  if (name.length > 64) name = name.slice(0, 64 - suffix.length).replace(/_+$/g, "") + suffix;
  return name;
}

function removeOuterLightHalo(src: PNG): { removedPixels: number; removedRatio: number } {
  const { width: w, height: h, data } = src;
  const total = w * h;
  const candidate = new Uint8Array(total);
  const outside = new Uint8Array(total);
  for (let p = 0; p < total; p++) {
    const i = p * 4;
    const a = data[i + 3] ?? 0;
    if (a <= OUTSIDE_ALPHA) { outside[p] = 1; continue; }
    const r = data[i] ?? 0, g = data[i + 1] ?? 0, b = data[i + 2] ?? 0;
    const min = Math.min(r, g, b), max = Math.max(r, g, b);
    if (min >= HALO_MIN_CHANNEL && max - min <= HALO_MAX_SPREAD) candidate[p] = 1;
  }
  const visited = new Uint8Array(total);
  const stack: number[] = [];
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const p = y * w + x;
    if (!candidate[p]) continue;
    let touches = false;
    for (let dy = -1; dy <= 1 && !touches; dy++) for (let dx = -1; dx <= 1; dx++) {
      if (!dx && !dy) continue;
      const nx = x + dx, ny = y + dy;
      if (nx < 0 || ny < 0 || nx >= w || ny >= h || outside[ny * w + nx]) { touches = true; break; }
    }
    if (touches) { visited[p] = 1; stack.push(p); }
  }
  const removal: number[] = [];
  while (stack.length) {
    const p = stack.pop() as number;
    removal.push(p);
    const x = p % w, y = (p - x) / w;
    for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
      if (!dx && !dy) continue;
      const nx = x + dx, ny = y + dy;
      if (nx < 0 || ny < 0 || nx >= w || ny >= h) continue;
      const np = ny * w + nx;
      if (visited[np] || !candidate[np]) continue;
      visited[np] = 1; stack.push(np);
    }
  }
  const removedPixels = removal.length;
  const removedRatio = total ? removedPixels / total : 0;
  if (removedRatio > MAX_HALO_RATIO) throw new Error(`Telegram cutout needs review: the connected light halo covers ${(removedRatio * 100).toFixed(1)}% of the image, above the safe cleanup limit.`);
  for (const p of removal) data[p * 4 + 3] = 0;
  return { removedPixels, removedRatio };
}

function resizePngNearest(src: PNG, dstW: number, dstH: number): PNG {
  const dst = new PNG({ width: dstW, height: dstH, colorType: 6 });
  const sxScale = src.width / dstW, syScale = src.height / dstH;
  for (let y = 0; y < dstH; y++) {
    const sy = Math.min(src.height - 1, Math.floor((y + 0.5) * syScale));
    for (let x = 0; x < dstW; x++) {
      const sx = Math.min(src.width - 1, Math.floor((x + 0.5) * sxScale));
      const si = (sy * src.width + sx) * 4, di = (y * dstW + x) * 4;
      dst.data[di] = src.data[si]; dst.data[di + 1] = src.data[si + 1]; dst.data[di + 2] = src.data[si + 2]; dst.data[di + 3] = src.data[si + 3];
    }
  }
  return dst;
}

function prepareForTelegram(bytes: Uint8Array): { bytes: Uint8Array; removedPixels: number } {
  let src: PNG;
  try { src = PNG.sync.read(Buffer.from(bytes)); } catch { throw new Error("The stored sticker PNG could not be decoded."); }
  let hasAlpha = false;
  for (let i = 3; i < src.data.length; i += 4) if (src.data[i] < 255) { hasAlpha = true; break; }
  if (!hasAlpha) throw new Error("This sticker has no transparent pixels and cannot be published as a static Telegram sticker.");
  const cutout = removeOuterLightHalo(src);
  const maxDim = Math.max(src.width, src.height);
  const scale = 512 / maxDim;
  const dstW = Math.max(1, Math.round(src.width * scale)), dstH = Math.max(1, Math.round(src.height * scale));
  const prepared = src.width === dstW && src.height === dstH ? src : resizePngNearest(src, dstW, dstH);
  let finalHasAlpha = false;
  for (let i = 3; i < prepared.data.length; i += 4) if (prepared.data[i] < 255) { finalHasAlpha = true; break; }
  if (!finalHasAlpha) throw new Error("Telegram cutout validation failed because the prepared sticker lost its transparency.");
  const encoded = PNG.sync.write(prepared, { colorType: 6, inputColorType: 6, bitDepth: 8, deflateLevel: 9, filterType: -1 });
  if (encoded.byteLength > MAX_STATIC_BYTES) throw new Error(`The prepared Telegram sticker is ${(encoded.byteLength / 1024).toFixed(0)} KB, above Telegram's 512 KB static-sticker limit.`);
  return { bytes: new Uint8Array(encoded), removedPixels: cutout.removedPixels };
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  if (req.method !== "POST") return respond({ error: "METHOD_NOT_ALLOWED", message: "Use POST for Telegram actions." }, 405);
  const SUPABASE_URL = Deno.env.get("SUPABASE_URL") ?? "";
  const ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY") ?? "";
  const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
  const TELEGRAM_BOT_TOKEN = Deno.env.get("TELEGRAM_BOT_TOKEN") ?? "";
  const authHeader = req.headers.get("Authorization") ?? "";
  if (!authHeader.startsWith("Bearer ")) return respond({ error: "UNAUTHENTICATED", message: "Sign in to CARTEL HQ first." }, 401);
  const userClient = createClient(SUPABASE_URL, ANON_KEY, { global: { headers: { Authorization: authHeader } }, auth: { persistSession: false, autoRefreshToken: false } });
  const { data: authData, error: authError } = await userClient.auth.getUser();
  if (authError || !authData.user) return respond({ error: "UNAUTHENTICATED", message: "Your session expired. Sign in again." }, 401);
  const user = authData.user;
  const admin = createClient(SUPABASE_URL, SERVICE_KEY, { auth: { persistSession: false, autoRefreshToken: false } });
  let body: Record<string, unknown> = {};
  try { body = (await req.json()) as Record<string, unknown>; } catch { return respond({ error: "INVALID_BODY", message: "The Telegram request was malformed." }, 400); }
  const action = String(body.action ?? "");
  const member = async (workspaceId: string) => Boolean((await admin.from("workspace_members").select("user_id").eq("workspace_id", workspaceId).eq("user_id", user.id).maybeSingle()).data);
  const getBot = async () => {
    if (!TELEGRAM_BOT_TOKEN) return null;
    const me = await telegramJson(TELEGRAM_BOT_TOKEN, "getMe");
    return { id: String(me.id), username: String(me.username ?? ""), firstName: String(me.first_name ?? "") };
  };

  try {
    if (action === "config") {
      if (!TELEGRAM_BOT_TOKEN) return respond({ configured: false, reason: "TELEGRAM_BOT_TOKEN is not configured." });
      const bot = await getBot();
      if (!bot?.username) return respond({ configured: false, reason: "The Telegram bot does not have a username." });
      return respond({ configured: true, bot, botStartUrl: `https://t.me/${bot.username}?start=cartelhq` });
    }
    if (!TELEGRAM_BOT_TOKEN) return respond({ error: "TELEGRAM_NOT_CONFIGURED", message: "Telegram bot is not connected. Add TELEGRAM_BOT_TOKEN to Supabase Edge Function secrets." }, 503);
    const bot = await getBot();
    if (!bot?.username) return respond({ error: "BOT_USERNAME_MISSING", message: "The connected Telegram bot does not have a username." }, 500);

    if (action === "publish") {
      const workspaceId = String(body.workspaceId ?? ""), packId = String(body.packId ?? "");
      const requestedIds = new Set(normalizeStringArray(body.stickerIds));
      if (!workspaceId || !packId) return respond({ error: "INVALID_INPUT", message: "Pack information is missing." }, 400);
      if (!(await member(workspaceId))) return respond({ error: "FORBIDDEN", message: "You do not have access to this workspace." }, 403);
      const { data: connection } = await admin.from("telegram_connections").select("*").eq("user_id", user.id).maybeSingle();
      if (!connection?.telegram_user_id) return respond({ error: "OWNER_ID_REQUIRED", message: "Telegram owner user ID is required before publishing." }, 400);
      const ownerId = String(connection.telegram_user_id);
      const { data: pack } = await admin.from("sticker_packs").select("*").eq("id", packId).eq("workspace_id", workspaceId).maybeSingle();
      if (!pack) return respond({ error: "PACK_NOT_FOUND", message: "This sticker pack could not be found." }, 404);
      const { data: allRows } = await admin.from("stickers").select("*").eq("pack_id", packId).order("sort_order", { ascending: true });
      const allStickers = allRows ?? [];
      if (!allStickers.length) return respond({ error: "NO_STICKERS", message: "This pack has no stickers to publish." }, 400);
      const stickers = requestedIds.size ? allStickers.filter((s) => requestedIds.has(String(s.id))) : allStickers;
      if (!stickers.length) return respond({ error: "NO_SELECTED_STICKERS", message: "No reviewed stickers were selected for publishing." }, 400);
      const assetIds = stickers.map((s) => s.image_asset_id).filter(Boolean);
      const { data: assetsRaw } = assetIds.length ? await admin.from("media_assets").select("id,storage_path,mime_type,transparency_valid").in("id", assetIds) : { data: [] as any[] };
      const assets = new Map((assetsRaw ?? []).map((a) => [a.id, a]));
      const setName = pack.telegram_set_name || makeSetName(pack.title, pack.id, bot.username);
      const setUrl = `https://t.me/addstickers/${setName}`;
      await admin.from("sticker_packs").update({ status: "publishing", telegram_set_name: setName, telegram_set_url: setUrl, telegram_publish_error: null }).eq("id", packId);
      const existingSet = await maybeGetStickerSet(TELEGRAM_BOT_TOKEN, setName);
      const setExists = Boolean(existingSet);
      const failures: Array<{ stickerId: string; label: string; message: string; technical?: string }> = [];
      const readyForSet: Array<{ sticker: any; fileId: string; input: any }> = [];
      for (const sticker of stickers) {
        if (sticker.status === "published" && sticker.telegram_file_id && sticker.telegram_published_at) continue;
        const asset = assets.get(sticker.image_asset_id);
        if (!asset?.storage_path || asset.transparency_valid !== true) {
          const message = "Sticker is not backed by a transparency-verified image asset.";
          await admin.from("stickers").update({ status: "failed", telegram_publish_error: message }).eq("id", sticker.id);
          failures.push({ stickerId: sticker.id, label: sticker.label, message });
          continue;
        }
        let fileId = sticker.telegram_file_id ? String(sticker.telegram_file_id) : "";
        try {
          if (!fileId) {
            const { data: blob, error } = await admin.storage.from(BUCKET).download(asset.storage_path);
            if (error || !blob) throw new Error("Could not read this sticker from private storage.");
            const prepared = prepareForTelegram(new Uint8Array(await blob.arrayBuffer()));
            fileId = await uploadStickerFile(TELEGRAM_BOT_TOKEN, ownerId, prepared.bytes);
            await admin.from("stickers").update({ telegram_file_id: fileId, telegram_publish_error: null }).eq("id", sticker.id);
          }
          const keywords = normalizeKeywords(sticker.keyword_list);
          readyForSet.push({ sticker, fileId, input: { sticker: fileId, format: "static", emoji_list: normalizeEmoji(sticker.emoji_list), ...(keywords.length ? { keywords } : {}) } });
        } catch (err) {
          const message = err instanceof Error ? err.message : "Sticker preparation/upload failed.";
          const technical = err instanceof TelegramError ? err.technical : undefined;
          await admin.from("stickers").update({ status: "failed", telegram_publish_error: message }).eq("id", sticker.id);
          failures.push({ stickerId: sticker.id, label: sticker.label, message, ...(technical ? { technical } : {}) });
        }
      }
      const publishedIds: string[] = [];
      if (!setExists) {
        if (!readyForSet.length) {
          const message = "No reviewed sticker was ready for Telegram publishing.";
          await admin.from("sticker_packs").update({ status: "failed", telegram_publish_error: message }).eq("id", packId);
          return respond({ status: "failed", setName, setUrl, published: 0, total: allStickers.length, failed: allStickers.length, failures, message });
        }
        try {
          await telegramJson(TELEGRAM_BOT_TOKEN, "createNewStickerSet", { user_id: ownerId, name: setName, title: String(pack.title).slice(0, 64), stickers: readyForSet.slice(0, 50).map((x) => x.input), sticker_type: "regular" });
          for (const item of readyForSet.slice(0, 50)) publishedIds.push(item.sticker.id);
          for (const item of readyForSet.slice(50)) {
            try { await telegramJson(TELEGRAM_BOT_TOKEN, "addStickerToSet", { user_id: ownerId, name: setName, sticker: item.input }); publishedIds.push(item.sticker.id); }
            catch (err) { const message = err instanceof Error ? err.message : "Telegram could not add this sticker."; const technical = err instanceof TelegramError ? err.technical : undefined; failures.push({ stickerId: item.sticker.id, label: item.sticker.label, message, ...(technical ? { technical } : {}) }); }
          }
        } catch (err) {
          const message = err instanceof Error ? err.message : "Telegram could not create the sticker set.";
          const technical = err instanceof TelegramError ? err.technical : undefined;
          await admin.from("sticker_packs").update({ status: "failed", telegram_publish_error: message }).eq("id", packId);
          return respond({ status: "failed", setName, setUrl, published: 0, total: allStickers.length, failed: allStickers.length, failures, message, ...(technical ? { technical } : {}) });
        }
      } else {
        for (const item of readyForSet) {
          try { await telegramJson(TELEGRAM_BOT_TOKEN, "addStickerToSet", { user_id: ownerId, name: setName, sticker: item.input }); publishedIds.push(item.sticker.id); }
          catch (err) { const message = err instanceof Error ? err.message : "Telegram could not add this sticker."; const technical = err instanceof TelegramError ? err.technical : undefined; failures.push({ stickerId: item.sticker.id, label: item.sticker.label, message, ...(technical ? { technical } : {}) }); }
        }
      }
      const now = new Date().toISOString();
      if (publishedIds.length) await admin.from("stickers").update({ status: "published", telegram_publish_error: null, telegram_published_at: now }).in("id", publishedIds);
      for (const failure of failures) if (!publishedIds.includes(failure.stickerId)) await admin.from("stickers").update({ status: "failed", telegram_publish_error: failure.message }).eq("id", failure.stickerId);
      const { data: finalRows } = await admin.from("stickers").select("id,status,telegram_published_at").eq("pack_id", packId);
      const total = finalRows?.length ?? allStickers.length;
      const published = (finalRows ?? []).filter((s) => s.status === "published" && s.telegram_published_at).length;
      const allPublished = total > 0 && published === total;
      await admin.from("sticker_packs").update({ status: allPublished ? "published" : "failed", telegram_set_name: setName, telegram_set_url: setUrl, telegram_publish_error: allPublished ? null : `${Math.max(0, total - published)} of ${total} stickers still need publishing.`, ...(allPublished ? { telegram_published_at: now } : {}) }).eq("id", packId);
      return respond({ status: allPublished ? "published" : "partial", setName, setUrl, published, total, failed: total - published, failures, bot });
    }

    if (action === "refresh") {
      const workspaceId = String(body.workspaceId ?? ""), packId = String(body.packId ?? "");
      if (!workspaceId || !packId) return respond({ error: "INVALID_INPUT", message: "Pack information is missing." }, 400);
      if (!(await member(workspaceId))) return respond({ error: "FORBIDDEN", message: "You do not have access to this workspace." }, 403);
      const { data: pack } = await admin.from("sticker_packs").select("*").eq("id", packId).eq("workspace_id", workspaceId).maybeSingle();
      if (!pack) return respond({ error: "PACK_NOT_FOUND", message: "This sticker pack could not be found." }, 404);
      if (!pack.telegram_set_name) return respond({ exists: false, bot, packStatus: pack.status });
      const set = await maybeGetStickerSet(TELEGRAM_BOT_TOKEN, pack.telegram_set_name);
      if (!set) return respond({ exists: false, bot, packStatus: pack.status, setName: pack.telegram_set_name, setUrl: pack.telegram_set_url });
      return respond({ exists: true, bot, packStatus: pack.status, setName: set.name, title: set.title, stickerCount: Array.isArray(set.stickers) ? set.stickers.length : null, setUrl: pack.telegram_set_url });
    }

    if (action === "send_test") {
      const workspaceId = String(body.workspaceId ?? ""), packId = String(body.packId ?? ""), stickerId = body.stickerId ? String(body.stickerId) : null;
      if (!workspaceId || !packId) return respond({ error: "INVALID_INPUT", message: "Pack information is missing." }, 400);
      if (!(await member(workspaceId))) return respond({ error: "FORBIDDEN", message: "You do not have access to this workspace." }, 403);
      const { data: connection } = await admin.from("telegram_connections").select("*").eq("user_id", user.id).maybeSingle();
      if (!connection?.telegram_user_id) return respond({ error: "OWNER_ID_REQUIRED", message: "Telegram owner user ID is required before sending a test sticker." }, 400);
      let query = admin.from("stickers").select("id,label,telegram_file_id,status").eq("pack_id", packId).eq("status", "published").not("telegram_file_id", "is", null).order("sort_order", { ascending: true });
      if (stickerId) query = query.eq("id", stickerId);
      const { data: rows } = await query.limit(1);
      const sticker = rows?.[0];
      if (!sticker?.telegram_file_id) return respond({ error: "NO_PUBLISHED_STICKER", message: "Publish at least one sticker before sending a native Telegram test." }, 400);
      try {
        const message = await telegramJson(TELEGRAM_BOT_TOKEN, "sendSticker", { chat_id: String(connection.telegram_user_id), sticker: sticker.telegram_file_id });
        const at = new Date().toISOString();
        const metadata = connection.metadata && typeof connection.metadata === "object" ? connection.metadata : {};
        await admin.from("telegram_connections").update({ metadata: { ...metadata, last_test_result: "success", last_test_at: at, last_test_sticker_id: sticker.id } }).eq("id", connection.id);
        return respond({ sent: true, bot, stickerId: sticker.id, label: sticker.label, messageId: message?.message_id ?? null, sentAt: at });
      } catch (err) {
        const at = new Date().toISOString();
        const message = err instanceof Error ? err.message : "Telegram test send failed.";
        const metadata = connection.metadata && typeof connection.metadata === "object" ? connection.metadata : {};
        await admin.from("telegram_connections").update({ metadata: { ...metadata, last_test_result: "failed", last_test_at: at, last_test_error: message } }).eq("id", connection.id);
        const technical = err instanceof TelegramError ? err.technical : undefined;
        return respond({ sent: false, bot, message, ...(technical ? { technical } : {}), botStartUrl: `https://t.me/${bot.username}?start=cartelhq` });
      }
    }
    /**
     * Phase 4B — restore an earlier successful image version for a sticker that
     * is (or may be) live on Telegram. Replaces the sticker IN PLACE inside the
     * SAME set via replaceStickerInSet. Never creates a set, never adds a
     * sticker, never redistributes, never calls an image provider.
     */
    if (action === "replace_version") {
      const workspaceId = String(body.workspaceId ?? "");
      const packId = String(body.packId ?? "");
      const stickerId = String(body.stickerId ?? "");
      const versionId = String(body.versionId ?? "");
      if (!workspaceId || !packId || !stickerId || !versionId) {
        return respond({ error: "INVALID_INPUT", message: "Version restore information is missing." }, 400);
      }
      if (!(await member(workspaceId))) return respond({ error: "FORBIDDEN", message: "You do not have access to this workspace." }, 403);

      const { data: pack } = await admin.from("sticker_packs").select("*").eq("id", packId).eq("workspace_id", workspaceId).maybeSingle();
      if (!pack) return respond({ error: "PACK_NOT_FOUND", message: "This sticker pack could not be found." }, 404);
      const { data: sticker } = await admin.from("stickers").select("*").eq("id", stickerId).eq("pack_id", packId).maybeSingle();
      if (!sticker) return respond({ error: "STICKER_NOT_FOUND", message: "This sticker could not be found in the pack." }, 404);
      const { data: version } = await admin.from("sticker_versions").select("id,sticker_id,pack_id,asset_id,version_number").eq("id", versionId).eq("sticker_id", stickerId).eq("pack_id", packId).maybeSingle();
      if (!version?.asset_id) return respond({ error: "VERSION_UNAVAILABLE", message: "That version is no longer available for this sticker." }, 404);

      const { data: targetAsset } = await admin.from("media_assets").select("id,workspace_id,asset_type,storage_path,transparency_valid").eq("id", version.asset_id).maybeSingle();
      if (!targetAsset || targetAsset.workspace_id !== workspaceId || targetAsset.asset_type !== "generated_sticker" || targetAsset.transparency_valid !== true || !targetAsset.storage_path) {
        return respond({ error: "ASSET_NOT_READY", message: "That version's image is not a transparency-verified sticker image." }, 409);
      }


      const { data: activeJobs } = await admin.from("ai_jobs").select("id").eq("sticker_id", stickerId).in("status", ["queued", "running"]).limit(1);
      if ((activeJobs ?? []).length) {
        return respond({ error: "ACTIVE_GENERATION", message: "This sticker is still generating. Wait for it to finish before restoring a version." }, 409);
      }

      if (sticker.image_asset_id === targetAsset.id) {
        return respond({ status: "unchanged", telegramReplaced: false, stickerId, versionId, setName: pack.telegram_set_name ?? undefined, setUrl: pack.telegram_set_url ?? undefined, message: "That version is already the current sticker image." });
      }

      // Expected old state. Every later write is guarded against exactly these
      // two pointers so a concurrent change can never be silently overwritten.
      const expectedOldAssetId = sticker.image_asset_id ? String(sticker.image_asset_id) : null;
      const oldFileId = sticker.telegram_file_id ? String(sticker.telegram_file_id) : "";
      const expectedOldFileId = sticker.telegram_file_id ? String(sticker.telegram_file_id) : null;
      const setName = pack.telegram_set_name ? String(pack.telegram_set_name) : "";
      const dbClaimsPublished = sticker.status === "published" || !!sticker.telegram_published_at;

      let liveInSet = false;
      if (setName && oldFileId) {
        const existingSet = await maybeGetStickerSet(TELEGRAM_BOT_TOKEN, setName);
        const setStickers = Array.isArray(existingSet?.stickers) ? existingSet.stickers : [];
        liveInSet = setStickers.some((s: any) => String(s?.file_id ?? "") === oldFileId);
      }

      if (!liveInSet) {
        if (dbClaimsPublished) {
          return respond({ error: "TELEGRAM_STATE_MISMATCH", message: "CARTEL HQ could not confirm this sticker inside its Telegram set. Refresh the Telegram status before restoring a version." }, 409);
        }
        // Only stale, non-published upload state exists. Safe to repoint locally.
        const { error: updateError } = await admin.from("stickers").update({ image_asset_id: targetAsset.id, status: "ready", telegram_file_id: null, telegram_publish_error: null, telegram_published_at: null, updated_at: new Date().toISOString() }).eq("id", stickerId);
        if (updateError) return respond({ error: "UPDATE_FAILED", message: "The sticker image could not be updated. Nothing was changed on Telegram." }, 500);
        return respond({ status: "switched", telegramReplaced: false, stickerId, versionId, setName: setName || undefined, setUrl: pack.telegram_set_url ?? undefined });
      }

      const { data: connection } = await admin.from("telegram_connections").select("*").eq("user_id", user.id).maybeSingle();
      if (!connection?.telegram_user_id) return respond({ error: "OWNER_ID_REQUIRED", message: "Telegram owner user ID is required before replacing a published sticker." }, 400);
      const ownerId = String(connection.telegram_user_id);

      const emojiList = normalizeEmoji(sticker.emoji_list);
      const keywords = normalizeKeywords(sticker.keyword_list);
      const inputFor = (fileId: string) => ({ sticker: fileId, format: "static", emoji_list: emojiList, ...(keywords.length ? { keywords } : {}) });

      let newFileId = "";
      try {
        const { data: blob, error: downloadError } = await admin.storage.from(BUCKET).download(targetAsset.storage_path);
        if (downloadError || !blob) throw new Error("Could not read that version's image from private storage.");
        const prepared = prepareForTelegram(new Uint8Array(await blob.arrayBuffer()));
        newFileId = await uploadStickerFile(TELEGRAM_BOT_TOKEN, ownerId, prepared.bytes);
      } catch (err) {
        const message = err instanceof Error ? err.message : "Telegram could not accept this version's image.";
        const technical = err instanceof TelegramError ? err.technical : undefined;
        return respond({ error: "TELEGRAM_REPLACE_FAILED", message, ...(technical ? { technical } : {}) }, 502);
      }

      // Last check before the only destructive Telegram call. Preparation and
      // upload take time, so re-confirm nothing changed underneath us. An unused
      // uploaded file is strictly safer than mutating the live set on stale state.
      const { data: recheckSticker } = await admin.from("stickers").select("image_asset_id,telegram_file_id").eq("id", stickerId).maybeSingle();
      const { data: recheckJobs } = await admin.from("ai_jobs").select("id").eq("sticker_id", stickerId).in("status", ["queued", "running"]).limit(1);
      const recheckAssetId = recheckSticker?.image_asset_id ? String(recheckSticker.image_asset_id) : null;
      const recheckFileId = recheckSticker?.telegram_file_id ? String(recheckSticker.telegram_file_id) : null;
      if (
        !recheckSticker ||
        (recheckJobs ?? []).length ||
        recheckAssetId !== expectedOldAssetId ||
        recheckFileId !== expectedOldFileId
      ) {
        return respond({ error: "RESTORE_STATE_CHANGED", message: "This sticker changed while the restore was being prepared. Nothing was changed on Telegram. Refresh this pack and try the restore again." }, 409);
      }

      try {
        await telegramJson(TELEGRAM_BOT_TOKEN, "replaceStickerInSet", { user_id: ownerId, name: setName, old_sticker: oldFileId, sticker: inputFor(newFileId) });
      } catch (err) {
        const message = err instanceof Error ? err.message : "Telegram could not replace this sticker.";
        const technical = err instanceof TelegramError ? err.technical : undefined;
        return respond({ error: "TELEGRAM_REPLACE_FAILED", message, ...(technical ? { technical } : {}) }, 502);
      }

      const now = new Date().toISOString();
      // Guarded write: only the exact pre-restore row may be advanced. Zero
      // matched rows means someone else moved the sticker, which is a failure.
      let guardedUpdate = admin.from("stickers").update({ image_asset_id: targetAsset.id, telegram_file_id: newFileId, status: "published", telegram_publish_error: null, telegram_published_at: now, updated_at: now }).eq("id", stickerId);
      guardedUpdate = expectedOldAssetId === null ? guardedUpdate.is("image_asset_id", null) : guardedUpdate.eq("image_asset_id", expectedOldAssetId);
      guardedUpdate = expectedOldFileId === null ? guardedUpdate.is("telegram_file_id", null) : guardedUpdate.eq("telegram_file_id", expectedOldFileId);
      const { data: updatedRow, error: updateError } = await guardedUpdate.select("id").maybeSingle();
      if (updateError || !updatedRow) {
        // Cross-system guard: Telegram already changed, CARTEL HQ did not.
        const dbReason = updateError ? updateError.message : "guarded update matched zero rows";
        try {
          await telegramJson(TELEGRAM_BOT_TOKEN, "replaceStickerInSet", { user_id: ownerId, name: setName, old_sticker: newFileId, sticker: inputFor(oldFileId) });
          return respond({ error: "RESTORE_ROLLED_BACK", message: "CARTEL HQ could not save the change, so the Telegram sticker was restored to its previous image. Nothing was changed." }, 500);
        } catch (compensationError) {
          console.error("[telegram-stickers] replace_version reconciliation required", { stickerId, setName, oldFileId, newFileId, dbError: dbReason, compensationError: compensationError instanceof Error ? compensationError.message : "unknown error" });
          return respond({ error: "RECONCILIATION_REQUIRED", message: "The Telegram sticker was replaced but CARTEL HQ could not save the change and could not undo it. Refresh the Telegram status and review this sticker before publishing again." }, 500);
        }
      }

      return respond({ status: "switched", telegramReplaced: true, stickerId, versionId, setName, setUrl: pack.telegram_set_url ?? undefined, bot });
    }

    return respond({ error: "UNKNOWN_ACTION", message: "Unknown Telegram action." }, 400);

  } catch (err) {
    console.error("[telegram-stickers]", err instanceof Error ? err.message : "unknown error");
    const message = err instanceof Error ? err.message : "Unexpected Telegram publishing error.";
    const technical = err instanceof TelegramError ? err.technical : undefined;
    return respond({ error: "INTERNAL_ERROR", message, ...(technical ? { technical } : {}) }, 500);
  }
});
