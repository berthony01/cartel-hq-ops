import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2";

const TG_BASE = "https://api.telegram.org";
const MAX_BATCH_GROUPS = 50;
const NATIVE_SYNC_ERROR = "Published Telegram sticker set is out of sync with this Cartel HQ pack. Refresh or republish before native delivery.";
const DEFAULT_WELCOME_MESSAGE = "\u{1F44B} Welcome {first_name} to {community_name}!\n\nPlease check the pinned messages and official links before getting started.";
function escapeHtml(value: string) { return value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;"); }
const cors = { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type", "Access-Control-Allow-Methods": "POST, OPTIONS" };
function respond(body: unknown, status = 200) { return new Response(JSON.stringify(body), { status, headers: { ...cors, "Content-Type": "application/json" } }); }
/** Hard timeout around every api.telegram.org call so a hung request cannot stall the function. */
const TELEGRAM_TIMEOUT_MS = 10_000;
async function telegramJson(token: string, method: string, body: Record<string, unknown> = {}) { let res: Response; try { res = await fetch(`${TG_BASE}/bot${token}/${method}`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body), signal: AbortSignal.timeout(TELEGRAM_TIMEOUT_MS) }); } catch { throw new Error("Could not reach Telegram. Try again shortly."); } const payload = await res.json().catch(() => null) as any; if (!res.ok || !payload?.ok) throw new Error(String(payload?.description ?? `Telegram request failed (${res.status}).`)); return payload.result; }
function firstEmoji(value: unknown) { return Array.isArray(value) && typeof value[0] === "string" ? value[0] : ""; }

/* C7.2 — Official Community Broadcast branding (`telegram_photo_v1`). */
const ASSETS_BUCKET = "workspace-assets";
const BRANDED_TEMPLATE_VERSION = "telegram_photo_v1";
/** Telegram's hard photo-caption limit, applied to the FULL final caption. */
const BRANDED_CAPTION_MAX = 1024;
/** Hard byte ceiling for the logo actually uploaded to Telegram. */
const BRANDED_LOGO_MAX_BYTES = 10 * 1024 * 1024;
/**
 * Locked V1 caption template. Trim only — the saved ticker is used exactly as
 * stored (no `$` is added and none is removed). The browser renders the same
 * preview from the same inputs, but this server copy is the only one ever posted.
 */
function buildBrandedCaption(projectName: string, ticker: string | null, message: string): string {
  const name = projectName.trim();
  const tick = (ticker ?? "").trim();
  return `${name}${tick ? " · " + tick : ""}\nOFFICIAL PROJECT UPDATE\n\n${message.trim()}\n\nOfficial communication through @PepeCartelHQBot`;
}



Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  if (req.method !== "POST") return respond({ error: "METHOD_NOT_ALLOWED" }, 405);
  const SUPABASE_URL = Deno.env.get("SUPABASE_URL") ?? "", ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY") ?? "", SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "", TELEGRAM_BOT_TOKEN = Deno.env.get("TELEGRAM_BOT_TOKEN") ?? "";
  if (!TELEGRAM_BOT_TOKEN) return respond({ error: "TELEGRAM_NOT_CONFIGURED", message: "Telegram bot is not configured." }, 503);
  const authHeader = req.headers.get("Authorization") ?? ""; if (!authHeader.startsWith("Bearer ")) return respond({ error: "UNAUTHENTICATED", message: "Sign in to CARTEL HQ first." }, 401);
  const userClient = createClient(SUPABASE_URL, ANON_KEY, { global: { headers: { Authorization: authHeader } }, auth: { persistSession: false, autoRefreshToken: false } });
  const { data: authData, error: authError } = await userClient.auth.getUser(); if (authError || !authData.user) return respond({ error: "UNAUTHENTICATED", message: "Your session expired. Sign in again." }, 401);
  const user = authData.user, admin = createClient(SUPABASE_URL, SERVICE_KEY, { auth: { persistSession: false, autoRefreshToken: false } });
  let body: Record<string, unknown> = {}; try { body = await req.json(); } catch { return respond({ error: "INVALID_BODY", message: "Invalid request." }, 400); }
  const action = String(body.action ?? ""), workspaceId = String(body.workspaceId ?? ""), groupConnectionId = String(body.groupConnectionId ?? "");
  if (!workspaceId) return respond({ error: "WORKSPACE_REQUIRED", message: "Workspace is required." }, 400);
  const { data: membership } = await admin.from("workspace_members").select("user_id,role").eq("workspace_id", workspaceId).eq("user_id", user.id).maybeSingle(); if (!membership) return respond({ error: "FORBIDDEN", message: "You do not have access to this workspace." }, 403);
  const canManageCommunity = membership.role === "owner" || membership.role === "admin";

  const getGroup = async (id = groupConnectionId) => { if (!id) return null; const { data } = await admin.from("telegram_group_connections").select("*").eq("id", id).eq("workspace_id", workspaceId).maybeSingle(); return data; };

  /**
   * Bot removal is an expected community lifecycle state, not an application
   * failure. Only these narrow Telegram descriptions are treated as removal.
   */
  const BOT_REMOVED_MESSAGE = "@PepeCartelHQBot is no longer in this Telegram community. Re-add the bot as an administrator, then re-check the community.";
  const isBotRemovedMessage = (message: string) => {
    const m = String(message ?? "").toLowerCase();
    return m.includes("bot was kicked") || m.includes("bot is not a member") || m.includes("bot was removed") || m.includes("bot is not a member of the");
  };
  class BotRemovedError extends Error {
    group: any;
    memberStatus: string;
    constructor(group: any, memberStatus = "kicked") { super(BOT_REMOVED_MESSAGE); this.group = group; this.memberStatus = memberStatus; }
  }
  /** Persists the removed lifecycle state and pauses only enabled Sticker Drops. */
  const markGroupRemoved = async (group: any, memberStatus: string) => {
    const now = new Date().toISOString();
    const prior = group?.metadata && typeof group.metadata === "object" ? group.metadata : {};
    if (!group?.id) return group;
    await admin.from("telegram_group_connections").update({
      bot_is_admin: false,
      can_set_sticker_set: false,
      verified_at: now,
      metadata: { ...prior, last_member_status: memberStatus, bot_can_change_info: false, official_group_sticker_eligible: false, bot_removed_at: prior?.bot_removed_at ?? now, bot_removed_reason: memberStatus },
    }).eq("id", group.id);
    try {
      await admin.from("sticker_drop_schedules").update({ enabled: false, paused_reason: "bot_removed" }).eq("group_connection_id", group.id).eq("enabled", true);
    } catch (e) { console.error("[telegram-group] pause drops", e instanceof Error ? e.message : "unknown"); }
    return { ...group, bot_is_admin: false, can_set_sticker_set: false, verified_at: now, metadata: { ...prior, last_member_status: memberStatus, bot_can_change_info: false, official_group_sticker_eligible: false, bot_removed_at: prior?.bot_removed_at ?? now, bot_removed_reason: memberStatus } };
  };
  const storedRemovedStatus = (group: any) => {
    const meta = group?.metadata && typeof group.metadata === "object" ? group.metadata : {};
    const last = String(meta?.last_member_status ?? "");
    return group?.bot_is_admin === false && (last === "left" || last === "kicked") ? last : null;
  };

  /**
   * Launch Watch CTA eligibility — ONE shared definition for both the welcome
   * card (Phase 5.1/5.2) and the Official Community Broadcast CTA. The private
   * `launch_watch_token` is read here and used ONLY to build a Telegram deep
   * link server-side; it is never returned to the browser.
   */
  const LW_OPEN_STATUSES = ["WATCHLIST_OPEN", "LAUNCH_APPROACHING", "CONTRACT_PENDING", "OFFICIAL_CONTRACT_REGISTERED"];
  const LW_TOKEN_PATTERN = /^[0-9a-f]{24}$/;
  const isHttpUrl = (value: unknown) => {
    if (typeof value !== "string" || !value.trim()) return false;
    try { const u = new URL(value.trim()); return u.protocol === "https:" || u.protocol === "http:"; } catch { return false; }
  };
  const loadEligibleLaunchRows = async (launchId?: string) => {
    let query = admin.from("launches")
      .select("id,token_name,ticker,chain,status,launch_watch_token,project_profile_id,project_profiles(workspace_id,project_name,discovery_status,website_url,telegram_url,x_url)")
      .eq("workspace_id", workspaceId)
      .in("status", LW_OPEN_STATUSES);
    if (launchId) query = query.eq("id", launchId);
    const { data, error } = await query;
    if (error) throw error;
    return (data ?? []).filter((row: any) => {
      const profile = Array.isArray(row?.project_profiles) ? row.project_profiles[0] : row?.project_profiles;
      // The Project Profile must belong to the SAME workspace as the launch.
      return String(profile?.workspace_id ?? "") === String(workspaceId)
        && profile?.discovery_status === "published"
        && LW_TOKEN_PATTERN.test(String(row?.launch_watch_token ?? ""));
    });
  };
  /** Safe browser-facing option shape. Never includes the Launch Watch token. */
  const toOption = (row: any) => {
    const profile = Array.isArray(row?.project_profiles) ? row.project_profiles[0] : row?.project_profiles;
    return {
      launchId: String(row.id),
      projectName: String(profile?.project_name ?? "Project"),
      tokenName: String(row.token_name ?? ""),
      ticker: String(row.ticker ?? ""),
      chain: String(row.chain ?? ""),
      status: String(row.status ?? ""),
      hasWebsite: isHttpUrl(profile?.website_url),
      hasTelegram: isHttpUrl(profile?.telegram_url),
      hasX: isHttpUrl(profile?.x_url),
    };
  };
  /** The one canonical Launch Watch deep link. Token stays server-side. */
  const launchWatchDeepLink = (row: any) => `https://t.me/PepeCartelHQBot?start=lw_${String(row.launch_watch_token)}`;



  const verifyGroup = async (group: any) => {
    if (!group) throw new Error("Connect a Telegram group before publishing.");
    const removedStatus = storedRemovedStatus(group);
    if (removedStatus) {
      const updated = await markGroupRemoved(group, removedStatus);
      throw new BotRemovedError(updated, removedStatus);
    }


    let chat: any, botMember: any, memberCountRaw: any;
    try {
      const me = await telegramJson(TELEGRAM_BOT_TOKEN, "getMe");
      [chat, botMember, memberCountRaw] = await Promise.all([
        telegramJson(TELEGRAM_BOT_TOKEN, "getChat", { chat_id: String(group.telegram_chat_id) }),
        telegramJson(TELEGRAM_BOT_TOKEN, "getChatMember", { chat_id: String(group.telegram_chat_id), user_id: me.id }),
        telegramJson(TELEGRAM_BOT_TOKEN, "getChatMemberCount", { chat_id: String(group.telegram_chat_id) }).catch(() => null),
      ]);
    } catch (err) {
      const message = err instanceof Error ? err.message : "";
      if (!isBotRemovedMessage(message)) throw err;
      const updated = await markGroupRemoved(group, message.toLowerCase().includes("kicked") ? "kicked" : "left");
      throw new BotRemovedError(updated, message.toLowerCase().includes("kicked") ? "kicked" : "left");
    }
    if (botMember?.status === "left" || botMember?.status === "kicked") {
      const updated = await markGroupRemoved(group, String(botMember.status));
      throw new BotRemovedError(updated, String(botMember.status));
    }

    const chatType = String(chat?.type ?? group.chat_type ?? "");
    if (chatType !== "group" && chatType !== "supergroup") throw new Error("The connected Telegram chat is not a group.");
    const memberCount = typeof memberCountRaw === "number" ? memberCountRaw : null;
    const botIsAdmin = botMember?.status === "administrator" || botMember?.status === "creator";
    const botCanChangeInfo = botMember?.status === "creator" || botMember?.can_change_info === true;
    const canSet = chatType === "supergroup" && chat?.can_set_sticker_set === true;
    const reason = canSet ? null : chatType !== "supergroup" ? "requires_supergroup" : "not_reported";
    const prior = group.metadata && typeof group.metadata === "object" ? group.metadata : {};
    await admin.from("telegram_group_connections").update({ title: String(chat?.title ?? group.title), username: typeof chat?.username === "string" ? chat.username : group.username, chat_type: chatType, bot_is_admin: botIsAdmin, can_set_sticker_set: canSet, verified_at: new Date().toISOString(), metadata: { ...prior, bot_can_change_info: botCanChangeInfo, member_count: memberCount, official_group_sticker_min_members: null, official_group_sticker_eligible: canSet, official_group_sticker_reason: reason } }).eq("id", group.id);
    if (!botIsAdmin) throw new Error("@PepeCartelHQBot must be an administrator in this Telegram group.");
    if (!botCanChangeInfo) throw new Error("@PepeCartelHQBot needs Change Group Info permission in this Telegram group.");
    return { ...group, title: String(chat?.title ?? group.title), username: typeof chat?.username === "string" ? chat.username : group.username, chat_type: chatType, bot_is_admin: botIsAdmin, can_set_sticker_set: canSet, current_sticker_set_name: chat?.sticker_set_name ?? null, member_count: memberCount, min_members: null, official_sticker_eligible: canSet, official_sticker_reason: reason, bot_can_change_info: botCanChangeInfo, metadata: prior };
  };

  const loadPublishedPack = async (packId: string) => { const { data: pack } = await admin.from("sticker_packs").select("id,title,status,telegram_set_name,telegram_set_url,telegram_group_connection_id").eq("id", packId).eq("workspace_id", workspaceId).maybeSingle(); if (!pack?.telegram_set_name || !pack?.telegram_set_url || pack.status !== "published") throw new Error("Publish all stickers successfully before distributing the pack to groups."); await telegramJson(TELEGRAM_BOT_TOKEN, "getStickerSet", { name: pack.telegram_set_name }); return pack; };
  const reconcileNativeStickerIds = async (packId: string, setName: string) => {
    const [{ data: localRows, error: localError }, set] = await Promise.all([
      admin.from("stickers").select("id,label,telegram_file_id,sort_order,emoji_list,status").eq("pack_id", packId).eq("status", "published").order("sort_order", { ascending: true }),
      telegramJson(TELEGRAM_BOT_TOKEN, "getStickerSet", { name: setName }),
    ]);
    if (localError) throw localError;
    const local = localRows ?? [];
    const native = Array.isArray(set?.stickers) ? set.stickers : [];
    if (local.length === 0 || local.length !== native.length) throw new Error(NATIVE_SYNC_ERROR);
    const reconciled: any[] = [];
    for (let i = 0; i < local.length; i++) {
      const row: any = local[i], tg: any = native[i];
      const nativeId = typeof tg?.file_id === "string" ? tg.file_id : "";
      if (!nativeId) throw new Error(NATIVE_SYNC_ERROR);
      const localEmoji = firstEmoji(row.emoji_list), telegramEmoji = typeof tg?.emoji === "string" ? tg.emoji : "";
      if (localEmoji && telegramEmoji && localEmoji !== telegramEmoji) throw new Error(NATIVE_SYNC_ERROR);
      if (row.telegram_file_id !== nativeId) {
        const { error: updateError } = await admin.from("stickers").update({ telegram_file_id: nativeId }).eq("id", row.id).eq("pack_id", packId);
        if (updateError) throw updateError;
      }
      reconciled.push({ ...row, telegram_file_id: nativeId });
    }
    return reconciled;
  };
  const saveTarget = async (packId: string, groupId: string, patch: Record<string, unknown>) => { const now = new Date().toISOString(); const { error } = await admin.from("sticker_pack_group_targets").upsert({ workspace_id: workspaceId, pack_id: packId, group_connection_id: groupId, last_attempt_at: now, updated_at: now, ...patch }, { onConflict: "pack_id,group_connection_id" }); if (error) throw error; };

  const distributeOne = async (pack: any, rawGroup: any, batch = false) => {
    const now = new Date().toISOString();
    try {
      await saveTarget(pack.id, rawGroup.id, { status: "selected", last_error: null });
      const group = await verifyGroup(rawGroup);
      const prior = group.metadata && typeof group.metadata === "object" ? group.metadata : {};
      if (!group.can_set_sticker_set) {
        const alreadyAnnounced = prior?.last_announced_pack_id === pack.id;
        if (!alreadyAnnounced) {
          const optionalNote = group.official_sticker_reason === "requires_supergroup" ? "\n\nOptional: assigning a pack as the group's official sticker set requires a Telegram supergroup." : "";
          await telegramJson(TELEGRAM_BOT_TOKEN, "sendMessage", { chat_id: String(group.telegram_chat_id), text: `✅ ${pack.title} is published and ready to use.\n${pack.telegram_set_url}\n\nOpen the pack link to add it to your Telegram stickers. CARTEL HQ can also send native stickers directly in this group.${optionalNote}` });
          await admin.from("telegram_group_connections").update({ metadata: { ...prior, last_announced_pack_id: pack.id, last_announced_set_name: pack.telegram_set_name, last_announced_at: now }, verified_at: now }).eq("id", group.id);
        }
        await saveTarget(pack.id, group.id, { status: "announced", last_error: null, announced_at: now });
        const reasonCode = group.official_sticker_reason === "requires_supergroup" ? "GROUP_STICKER_REQUIRES_SUPERGROUP" : "GROUP_STICKER_NOT_AVAILABLE";
        return { groupConnectionId: group.id, title: group.title, chatType: group.chat_type, status: "announced", assigned: false, announced: true, reason: reasonCode, memberCount: group.member_count, minMembers: null };
      }
      await telegramJson(TELEGRAM_BOT_TOKEN, "setChatStickerSet", { chat_id: String(group.telegram_chat_id), sticker_set_name: pack.telegram_set_name });
      await admin.from("telegram_group_connections").update({ metadata: { ...prior, current_sticker_set_name: pack.telegram_set_name, current_pack_id: pack.id, assigned_at: now }, verified_at: now }).eq("id", group.id);
      try { await telegramJson(TELEGRAM_BOT_TOKEN, "sendMessage", { chat_id: String(group.telegram_chat_id), text: `✅ ${pack.title} is now this group's official sticker set.\n${pack.telegram_set_url}` }); } catch { }
      await saveTarget(pack.id, group.id, { status: "assigned", last_error: null, assigned_at: now, announced_at: now });
      return { groupConnectionId: group.id, title: group.title, chatType: group.chat_type, status: "assigned", assigned: true, announced: true, memberCount: group.member_count, minMembers: null };
    } catch (err) {
      const message = err instanceof Error ? err.message : "Telegram group distribution failed.";
      await saveTarget(pack.id, rawGroup.id, { status: "failed", last_error: message }).catch(() => undefined);
      // Batch runs keep a failed row; single actions surface the recoverable state.
      if (err instanceof BotRemovedError && !batch) throw err;
      return { groupConnectionId: rawGroup.id, title: rawGroup.title ?? "Telegram group", status: "failed", assigned: false, announced: false, message };

    }
  };

  try {
    if (action === "status") {
      const group = await getGroup();
      if (!group) { const { data: groups } = await admin.from("telegram_group_connections").select("*").eq("workspace_id", workspaceId).order("connected_at", { ascending: false }); return respond({ connected: Boolean(groups?.length), group: groups?.[0] ?? null, groups: groups ?? [] }); }
      const verified = await verifyGroup(group);
      return respond({ connected: true, ready: true, group: verified, botIsAdmin: verified.bot_is_admin, botCanChangeInfo: verified.bot_can_change_info, canSetStickerSet: verified.can_set_sticker_set, chatType: verified.chat_type, memberCount: verified.member_count, minMembers: null, officialStickerEligible: verified.official_sticker_eligible, officialStickerReason: verified.official_sticker_reason, stickerSetActive: Boolean(verified.current_sticker_set_name), currentStickerSetName: verified.current_sticker_set_name });
    }

    if (action === "assign_pack") {
      const packId = String(body.packId ?? ""); if (!packId || !groupConnectionId) return respond({ error: "GROUP_AND_PACK_REQUIRED", message: "Connect a target Telegram group before publishing." }, 400);
      const pack = await loadPublishedPack(packId); const group = await getGroup(); if (!group) return respond({ error: "GROUP_NOT_FOUND", message: "That Telegram group is no longer connected." }, 404);
      const result = await distributeOne(pack, group);
      if (result.status === "failed") return respond({ assigned: false, announced: false, group, message: result.message }, 400);
      if (result.assigned) await admin.from("sticker_packs").update({ telegram_group_connection_id: group.id }).eq("id", pack.id);
      return respond({ ...result, group: { id: group.id, title: result.title, username: group.username, telegramChatId: String(group.telegram_chat_id), chatType: result.chatType }, setName: pack.telegram_set_name, setUrl: pack.telegram_set_url, message: result.status === "assigned" ? `Official group sticker set active in ${result.title}.` : `Pack published and announced in ${result.title}.` });
    }

    if (action === "distribute_pack") {
      const packId = String(body.packId ?? ""); const rawIds = Array.isArray(body.groupConnectionIds) ? body.groupConnectionIds.map((v) => String(v)).filter(Boolean) : [];
      const ids = Array.from(new Set(rawIds));
      if (!packId || ids.length === 0) return respond({ error: "GROUPS_AND_PACK_REQUIRED", message: "Choose at least one connected Telegram group." }, 400);
      if (ids.length > MAX_BATCH_GROUPS) return respond({ error: "TOO_MANY_GROUPS", message: `Choose up to ${MAX_BATCH_GROUPS} groups at a time.` }, 400);
      const pack = await loadPublishedPack(packId);
      const { data: groups } = await admin.from("telegram_group_connections").select("*").eq("workspace_id", workspaceId).in("id", ids);
      const found = new Map((groups ?? []).map((g: any) => [String(g.id), g]));
      const results: any[] = [];
      for (const id of ids) {
        const group = found.get(id);
        if (!group) { results.push({ groupConnectionId: id, title: "Unknown group", status: "failed", assigned: false, announced: false, message: "This group is not connected to the current workspace." }); continue; }
        results.push(await distributeOne(pack, group, true));
      }
      const failed = results.filter((r) => r.status === "failed").length;
      const assigned = results.filter((r) => r.status === "assigned").length;
      const announced = results.filter((r) => r.status === "announced").length;
      return respond({ status: failed === 0 ? "complete" : failed === results.length ? "failed" : "partial", total: results.length, assigned, announced, failed, results, setName: pack.telegram_set_name, setUrl: pack.telegram_set_url });
    }

    if (action === "distribution_status") {
      const packId = String(body.packId ?? ""); if (!packId) return respond({ error: "PACK_REQUIRED", message: "Pack is required." }, 400);
      const { data: targets, error } = await admin.from("sticker_pack_group_targets").select("id,workspace_id,pack_id,group_connection_id,status,last_error,announced_at,assigned_at,last_attempt_at,created_at,updated_at").eq("workspace_id", workspaceId).eq("pack_id", packId).order("updated_at", { ascending: false }); if (error) throw error;
      return respond({ targets: targets ?? [] });
    }

    if (action === "send_group_test") {
      const packId = String(body.packId ?? ""), stickerId = body.stickerId ? String(body.stickerId) : ""; if (!packId || !groupConnectionId) return respond({ error: "GROUP_AND_PACK_REQUIRED", message: "A published Telegram sticker pack and connected group are required." }, 400);
      const group = await verifyGroup(await getGroup());
      const { data: pack } = await admin.from("sticker_packs").select("id,status,telegram_set_name").eq("id", packId).eq("workspace_id", workspaceId).maybeSingle(); if (!pack || pack.status !== "published" || !pack.telegram_set_name) return respond({ error: "PACK_NOT_PUBLISHED", message: "Publish the Telegram sticker pack before sending a group test." }, 400);
      const rows = await reconcileNativeStickerIds(packId, String(pack.telegram_set_name));
      const sticker = stickerId ? rows.find((s: any) => String(s.id) === stickerId) : rows[0];
      if (!sticker?.telegram_file_id) return respond({ error: "NO_PUBLISHED_STICKER", message: "No published native Telegram sticker is available for a group test." }, 400);
      const msg = await telegramJson(TELEGRAM_BOT_TOKEN, "sendSticker", { chat_id: String(group.telegram_chat_id), sticker: sticker.telegram_file_id });
      if (!msg?.sticker?.file_id) throw new Error("Telegram did not return a native sticker message. Native group test delivery was not confirmed.");
      return respond({ sent: true, nativeStickerConfirmed: true, stickerId: sticker.id, label: sticker.label, messageId: msg?.message_id ?? null, groupTitle: group.title });
    }
    if (action === "welcome_settings" || action === "save_welcome_settings" || action === "send_welcome_test") {
      const group = await getGroup();
      if (!group) return respond({ error: "GROUP_NOT_FOUND", message: "That Telegram community is no longer connected." }, 404);
      // Phase 5.2 — the Launch Watch card is a SEPARATE message with its own lifetime.
      const LW_CTA_LIFETIMES = [300, 600, 900, 1800, 3600];
      const LW_CTA_LIFETIME_DEFAULT = 900;
      const loadSettings = async () => {
        const { data } = await admin.from("telegram_community_settings").select("*").eq("group_connection_id", group.id).maybeSingle();
        return data ?? { group_connection_id: group.id, workspace_id: workspaceId, welcome_enabled: false, welcome_message: DEFAULT_WELCOME_MESSAGE, mention_member: true, auto_delete_enabled: true, auto_delete_seconds: 45, launch_watch_cta_enabled: false, launch_watch_launch_id: null, launch_watch_show_website: true, launch_watch_show_telegram: false, launch_watch_show_x: true, launch_watch_cta_auto_delete_seconds: LW_CTA_LIFETIME_DEFAULT, metadata: {}, created_at: null, updated_at: null };
      };


      /** Shared Launch Watch eligibility lives at request scope (see above). */

      const buildCtaKeyboard = (row: any, settings: any) => {
        const profile = Array.isArray(row?.project_profiles) ? row.project_profiles[0] : row?.project_profiles;
        const rows: any[] = [[{ text: "🔔 Watch this launch", url: `https://t.me/PepeCartelHQBot?start=lw_${String(row.launch_watch_token)}` }]];
        const links: any[] = [];
        if (settings?.launch_watch_show_website !== false && isHttpUrl(profile?.website_url)) links.push({ text: "🌐 Website", url: String(profile.website_url).trim() });
        if (settings?.launch_watch_show_telegram === true && isHttpUrl(profile?.telegram_url)) links.push({ text: "💬 Telegram", url: String(profile.telegram_url).trim() });
        if (settings?.launch_watch_show_x !== false && isHttpUrl(profile?.x_url)) links.push({ text: "𝕏 X", url: String(profile.x_url).trim() });
        for (let i = 0; i < links.length; i += 2) rows.push(links.slice(i, i + 2));
        return { inline_keyboard: rows };
      };
      /**
       * Compact, project-specific Launch Watch card. Public group text only —
       * mute/stop controls remain private DM controls.
       */
      const buildCtaText = (row: any) => {
        const profile = Array.isArray(row?.project_profiles) ? row.project_profiles[0] : row?.project_profiles;
        const projectName = escapeHtml(String(profile?.project_name ?? "Project")).toUpperCase();
        const meta = [String(row?.token_name ?? ""), row?.ticker ? `$${String(row.ticker)}` : "", String(row?.chain ?? "")]
          .filter((v) => v.trim().length > 0).map((v) => escapeHtml(v)).join(" • ");
        return `🚀 <b>${projectName} LAUNCH WATCH</b>\n${meta}\n\nGet official launch updates privately through @PepeCartelHQBot.\nTap below to watch. Notifications are opt-in and can be muted or stopped anytime.\n\n<i>This is not a token safety audit or endorsement.</i>`;
      };
      /** Best-effort: any failure means "send the welcome without the CTA card". */
      const resolveCta = async (settings: any): Promise<{ text: string; keyboard: any } | null> => {
        if (settings?.launch_watch_cta_enabled !== true) return null;
        const launchId = settings?.launch_watch_launch_id ? String(settings.launch_watch_launch_id) : "";
        if (!launchId) return null;
        try {
          const rows = await loadEligibleLaunchRows(launchId);
          if (rows.length === 0) return null;
          return { text: buildCtaText(rows[0]), keyboard: buildCtaKeyboard(rows[0], settings) };
        } catch (e) {
          console.error("[telegram-group] launch watch cta", e instanceof Error ? e.message : "unknown");
          return null;
        }
      };


      if (action === "welcome_settings") {
        let eligibleLaunches: any[] = [];
        try { eligibleLaunches = (await loadEligibleLaunchRows()).map(toOption); }
        catch (e) { console.error("[telegram-group] eligible launches", e instanceof Error ? e.message : "unknown"); }
        return respond({ settings: await loadSettings(), canManage: canManageCommunity, eligibleLaunches });
      }
      if (!canManageCommunity) return respond({ error: "FORBIDDEN", message: "Only workspace owners and admins can change community welcome settings." }, 403);

      if (action === "save_welcome_settings") {
        const raw = (body.settings && typeof body.settings === "object" ? body.settings : {}) as Record<string, unknown>;
        const welcomeMessage = typeof raw.welcomeMessage === "string" ? raw.welcomeMessage.trim() : "";
        if (!welcomeMessage) return respond({ error: "INVALID_MESSAGE", message: "Enter a welcome message." }, 400);
        if (welcomeMessage.length > 3500) return respond({ error: "INVALID_MESSAGE", message: "Welcome messages are limited to 3500 characters." }, 400);
        if (typeof raw.welcomeEnabled !== "boolean" || typeof raw.mentionMember !== "boolean" || typeof raw.autoDeleteEnabled !== "boolean") {
          return respond({ error: "INVALID_SETTINGS", message: "Invalid welcome settings." }, 400);
        }
        if (typeof raw.launchWatchCtaEnabled !== "boolean" || typeof raw.launchWatchShowWebsite !== "boolean" || typeof raw.launchWatchShowTelegram !== "boolean" || typeof raw.launchWatchShowX !== "boolean") {
          return respond({ error: "INVALID_SETTINGS", message: "Invalid Launch Watch CTA settings." }, 400);
        }
        const seconds = Number(raw.autoDeleteSeconds);
        if (!Number.isInteger(seconds) || seconds < 10 || seconds > 120) return respond({ error: "INVALID_SECONDS", message: "Auto-delete must be between 10 and 120 seconds." }, 400);
        // Phase 5.2 — Launch Watch card lifetime. Exact allowed values only.
        const ctaSeconds = Number(raw.launchWatchCtaAutoDeleteSeconds);
        if (!Number.isInteger(ctaSeconds) || !LW_CTA_LIFETIMES.includes(ctaSeconds)) {
          return respond({ error: "INVALID_CTA_SECONDS", message: "Launch Watch card lifetime must be 5, 10, 15, 30 or 60 minutes." }, 400);
        }


        let launchWatchLaunchId: string | null = null;
        if (raw.launchWatchCtaEnabled === true) {
          const requested = typeof raw.launchWatchLaunchId === "string" ? raw.launchWatchLaunchId.trim() : "";
          if (!requested) return respond({ error: "LAUNCH_REQUIRED", message: "Select an eligible launch before enabling the Launch Watch button." }, 400);
          const rows = await loadEligibleLaunchRows(requested);
          if (rows.length === 0) {
            return respond({ error: "LAUNCH_NOT_ELIGIBLE", message: "That launch is not eligible. It must belong to this workspace, have a published Project Profile, and have its watchlist open." }, 400);
          }
          launchWatchLaunchId = String(rows[0].id);
        }

        const now = new Date().toISOString();
        const { data: saved, error } = await admin.from("telegram_community_settings").upsert({
          group_connection_id: group.id, workspace_id: workspaceId, welcome_enabled: raw.welcomeEnabled, welcome_message: welcomeMessage,
          mention_member: raw.mentionMember, auto_delete_enabled: raw.autoDeleteEnabled, auto_delete_seconds: seconds,
          launch_watch_cta_enabled: raw.launchWatchCtaEnabled, launch_watch_launch_id: launchWatchLaunchId,
          launch_watch_show_website: raw.launchWatchShowWebsite, launch_watch_show_telegram: raw.launchWatchShowTelegram, launch_watch_show_x: raw.launchWatchShowX,
          launch_watch_cta_auto_delete_seconds: ctaSeconds,

          updated_at: now,
        }, { onConflict: "group_connection_id" }).select("*").maybeSingle();
        if (error) throw error;
        let eligibleLaunches: any[] = [];
        try { eligibleLaunches = (await loadEligibleLaunchRows()).map(toOption); }
        catch (e) { console.error("[telegram-group] eligible launches", e instanceof Error ? e.message : "unknown"); }
        return respond({ saved: true, settings: saved ?? (await loadSettings()), canManage: true, eligibleLaunches });
      }

      const settings: any = await loadSettings();
      const communityName = escapeHtml(String(group.title ?? "this community"));
      const sampleName = escapeHtml("New Member");
      // Synthetic test: there is no real joining user, and a group chat id is NOT a
      // user id. Always render {member} as escaped plain text here. Real tg://user
      // mentions are created only by the join webhook, which has actual user ids.
      const memberToken = sampleName;
      const rendered = escapeHtml(String(settings.welcome_message ?? DEFAULT_WELCOME_MESSAGE))
        .replaceAll("{first_name}", sampleName)
        .replaceAll("{username}", "@newmember")
        .replaceAll("{member}", memberToken)
        .replaceAll("{community_name}", communityName);
      const cta = await resolveCta(settings);
      // Phase 5.2 — the welcome preview NEVER carries CTA reply_markup.
      const sent = await telegramJson(TELEGRAM_BOT_TOKEN, "sendMessage", { chat_id: String(group.telegram_chat_id), text: `${rendered}\n\n<i>(CARTEL HQ welcome preview)</i>`, parse_mode: "HTML", disable_web_page_preview: true });
      const messageId = sent?.message_id ?? null;
      const scheduleDelete = (targetId: number, delaySeconds: number, label: string) => {
        const cleanup = (async () => {
          await new Promise((resolve) => setTimeout(resolve, delaySeconds * 1000));
          try { await telegramJson(TELEGRAM_BOT_TOKEN, "deleteMessage", { chat_id: String(group.telegram_chat_id), message_id: targetId }); }
          catch (e) { console.error(`[telegram-group] ${label} cleanup`, e instanceof Error ? e.message : "unknown"); }
        })();
        try { (globalThis as any).EdgeRuntime?.waitUntil?.(cleanup); } catch { }
      };
      if (settings.auto_delete_enabled && messageId) {
        scheduleDelete(messageId, Math.min(120, Math.max(10, Number(settings.auto_delete_seconds) || 45)), "welcome test");
      }

      /**
       * Separate compact Launch Watch card. Its 5–60 minute lifetime CANNOT be a
       * setTimeout: hosted Edge Functions are killed long before that. Deletion is
       * queued as a durable cleanup job handled by the telegram-message-cleanup worker.
       */
      let ctaMessageId: number | null = null;
      let ctaLifetime: number | null = null;
      let ctaCleanupScheduled = false;
      if (messageId && cta) {
        const raw = Number(settings.launch_watch_cta_auto_delete_seconds);
        ctaLifetime = LW_CTA_LIFETIMES.includes(raw) ? raw : LW_CTA_LIFETIME_DEFAULT;
        try {
          const ctaSent = await telegramJson(TELEGRAM_BOT_TOKEN, "sendMessage", { chat_id: String(group.telegram_chat_id), text: cta.text, parse_mode: "HTML", disable_web_page_preview: true, reply_markup: cta.keyboard });
          ctaMessageId = ctaSent?.message_id ?? null;
          if (ctaMessageId) {
            const deleteAfter = new Date(Date.now() + ctaLifetime * 1000).toISOString();
            const { error: cleanupError } = await admin.from("telegram_message_cleanup_jobs").insert({
              workspace_id: workspaceId,
              group_connection_id: group.id,
              telegram_chat_id: group.telegram_chat_id,
              telegram_message_id: ctaMessageId,
              cleanup_kind: "launch_watch_cta",
              delete_after: deleteAfter,
              next_attempt_at: deleteAfter,
            });
            if (cleanupError) throw cleanupError;
            ctaCleanupScheduled = true;
          }
        } catch (e) {
          console.error("[telegram-group] launch watch card send", e instanceof Error ? e.message : "unknown");
        }
        // Never leave a card behind that has no durable cleanup path.
        if (ctaMessageId && !ctaCleanupScheduled) {
          try { await telegramJson(TELEGRAM_BOT_TOKEN, "deleteMessage", { chat_id: String(group.telegram_chat_id), message_id: ctaMessageId }); }
          catch (e) { console.error("[telegram-group] launch watch card rollback", e instanceof Error ? e.message : "unknown"); }
          ctaMessageId = null;
        }
      }
      return respond({ sent: true, messageId, autoDeleteSeconds: settings.auto_delete_enabled ? settings.auto_delete_seconds : null, groupTitle: group.title, launchWatchCtaIncluded: ctaCleanupScheduled, launchWatchCtaMessageId: ctaCleanupScheduled ? ctaMessageId : null, launchWatchCtaAutoDeleteSeconds: ctaCleanupScheduled ? ctaLifetime : null });


    }

    /**
     * C7 — post ONE plain-text announcement to ONE connected community.
     *
     * Order is deliberate: authorize, validate, resolve the target group inside
     * the workspace, resolve idempotency, CLAIM the durable ledger row, and only
     * then live-verify and send. The ledger row exists before any Telegram call
     * so an interrupted run can never look like "nothing happened", and a
     * verification failure is durably recorded as a definite no-send.
     *
     * Idempotency key is (workspace_id, client_request_id) and binds ONE exact
     * intent: same target community AND same exact trimmed text. A repeated
     * request id NEVER re-sends for any prior state — including FAILED. A
     * deliberate retry must arrive with a fresh client request id.
     *
     * Outcome vocabulary:
     *   SENT      Telegram confirmed a message id.
     *   FAILED    Definitively not delivered — nothing was posted.
     *   AMBIGUOUS Transport uncertainty — delivery is unknown. Never auto-resent.
     */
    if (action === "send_group_announcement") {
      if (!canManageCommunity) return respond({ error: "FORBIDDEN", message: "Only workspace owners and admins can post official community broadcasts." }, 403);
      if (!groupConnectionId) return respond({ error: "GROUP_REQUIRED", message: "Choose a connected Telegram community." }, 400);

      const clientRequestId = String(body.clientRequestId ?? "").trim();
      if (!/^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/.test(clientRequestId)) {
        return respond({ error: "INVALID_REQUEST_ID", message: "Invalid official broadcast request id." }, 400);
      }
      const messageText = typeof body.message === "string" ? body.message.trim() : "";
      if (!messageText) return respond({ error: "INVALID_MESSAGE", message: "Enter an official broadcast message." }, 400);
      if (messageText.length > 3500) return respond({ error: "INVALID_MESSAGE", message: "Official broadcasts are limited to 3500 characters." }, 400);

      /**
       * C7.2 — optional branded delivery. The plain-text path stays the default
       * and is completely unchanged when `brandingEnabled` is not explicitly true.
       *
       * Only the REQUESTED intent is parsed here. The saved Project Profile and
       * media asset are deliberately NOT read yet: an exact retry of an existing
       * request id must return its recorded outcome even if the project's saved
       * branding changed afterwards.
       */
      const brandingEnabled = body.brandingEnabled === true;
      const reviewedProjectName = typeof body.reviewedProjectName === "string" ? body.reviewedProjectName.trim() : "";
      const reviewedTicker = typeof body.reviewedTicker === "string" ? body.reviewedTicker.trim() : "";
      const reviewedLogoAssetId = typeof body.reviewedLogoAssetId === "string" ? body.reviewedLogoAssetId.trim() : "";
      const reviewedTemplateVersion = typeof body.reviewedTemplateVersion === "string" ? body.reviewedTemplateVersion.trim() : "";

      const deliveryKind: "TEXT" | "BRANDED_PHOTO" = brandingEnabled ? "BRANDED_PHOTO" : "TEXT";
      /** Caption implied by the REVIEWED identity — used only for intent comparison. */
      const reviewedCaption = brandingEnabled
        ? buildBrandedCaption(reviewedProjectName, reviewedTicker || null, messageText)
        : messageText;

      const rawGroup = await getGroup();
      if (!rawGroup) return respond({ error: "GROUP_NOT_FOUND", message: "That Telegram community is no longer connected." }, 404);

      const ledgerSelect = "id,status,telegram_message_id,message_text,group_title,group_connection_id,telegram_chat_id,last_error,requested_at,sent_at,delivery_kind,delivered_text_snapshot,branding_template_version,branding_project_name,branding_ticker,branding_logo_asset_id";
      let brandingSnapshot:
        | { projectName: string; ticker: string | null; logoAssetId: string; storagePath: string; mimeType: string }
        | null = null;
      let deliveredText = reviewedCaption;
      const outcomeMessage = (status: string, title: string) =>
        status === "SENT"
          ? `Official broadcast posted to ${title}.`
          : status === "FAILED"
            ? `The official broadcast was not posted to ${title}.`
            : `Delivery to ${title} could not be confirmed. Check the community before posting again — CARTEL HQ will not resend this automatically.`;
      const ledgerResponse = (row: any, duplicate: boolean) => {
        const status = row.status === "SENDING" ? "AMBIGUOUS" : row.status;
        return respond({
          status,
          duplicate,
          announcementId: row.id,
          groupConnectionId: row.group_connection_id ?? rawGroup.id,
          groupTitle: row.group_title ?? rawGroup.title,
          messageId: row.telegram_message_id ?? null,
          sentAt: row.sent_at ?? null,
          technical: row.last_error ?? null,
          deliveryKind: row.delivery_kind ?? deliveryKind,
          deliveredText: row.delivered_text_snapshot ?? deliveredText,
          message: outcomeMessage(status, String(row.group_title ?? rawGroup.title)),
        });
      };
      /**
       * A request id represents ONE exact intent. A stored row whose target
       * connection is NULL (the connection was deleted) can never be proven to
       * match this target, so reuse is rejected instead of guessed.
       *
       * C7.2 — the delivery kind, the branding identity that was reviewed, and
       * the exact delivered caption are all part of that intent.
       */
      const sameIntent = (row: any) => {
        if (String(row?.message_text ?? "") !== messageText) return false;
        if (!row?.group_connection_id || String(row.group_connection_id) !== String(rawGroup.id)) return false;
        const storedKind = String(row?.delivery_kind ?? "TEXT");
        if (storedKind !== deliveryKind) return false;
        if (deliveryKind === "TEXT") {
          return String(row?.delivered_text_snapshot ?? "") === messageText;
        }
        if (String(row?.branding_template_version ?? "") !== reviewedTemplateVersion) return false;
        if (String(row?.branding_project_name ?? "") !== reviewedProjectName) return false;
        if (String(row?.branding_ticker ?? "") !== reviewedTicker) return false;
        /*
         * Fail-safe: `branding_logo_asset_id` is `ON DELETE SET NULL`, so an
         * already-recorded branded broadcast can end up with a NULL logo FK while
         * its immutable branding snapshots stay intact. A NULL stored id therefore
         * means "the historical asset may have been deleted", not "different
         * intent": the reused request id is resolved toward the recorded outcome
         * (no current media/profile validation, no send) rather than risking a
         * duplicate Telegram post. A non-null id that differs is still a conflict.
         */
        if (row?.branding_logo_asset_id && String(row.branding_logo_asset_id) !== reviewedLogoAssetId) return false;
        return String(row?.delivered_text_snapshot ?? "") === reviewedCaption;
      };

      const conflictResponse = () => respond({
        error: "IDEMPOTENCY_CONFLICT",
        message: "This broadcast id was already used for a different community, message, or branding. Start a new official broadcast.",
      }, 409);

      /**
       * Idempotency resolution happens BEFORE any Project Profile / media asset
       * read, before live group verification, before any storage download, and
       * before any Telegram call.
       */
      const { data: existing } = await admin.from("telegram_group_announcements").select(ledgerSelect)
        .eq("workspace_id", workspaceId).eq("client_request_id", clientRequestId).maybeSingle();
      if (existing) {
        if (!sameIntent(existing)) return conflictResponse();
        // SENT / SENDING / AMBIGUOUS / FAILED all return the recorded outcome.
        // The same request id never sends a second Telegram message.
        return ledgerResponse(existing, true);
      }

      /**
       * NEW branded request only. Branding is NEVER taken from the request: the
       * server re-reads the saved Project Profile and the media asset and refuses
       * to post when they disagree with what the operator reviewed.
       */
      if (brandingEnabled) {
        if (reviewedTemplateVersion !== BRANDED_TEMPLATE_VERSION) {
          return respond({ error: "BRANDING_TEMPLATE_UNSUPPORTED", message: "This branded broadcast format is no longer supported. Reload CARTEL HQ and review the broadcast again." }, 400);
        }
        if (!reviewedProjectName || !reviewedLogoAssetId) {
          return respond({ error: "BRANDING_UNAVAILABLE", message: "Add a project name and select a project logo before posting a branded broadcast." }, 400);
        }
        const { data: profileRow, error: profileError } = await admin.from("project_profiles")
          .select("project_name,ticker,logo_asset_id").eq("workspace_id", workspaceId).maybeSingle();
        if (profileError) throw profileError;
        if (!profileRow) {
          return respond({ error: "BRANDING_UNAVAILABLE", message: "Save a Project Profile before posting a branded broadcast." }, 400);
        }
        const currentProjectName = String(profileRow.project_name ?? "").trim();
        const currentTicker = String(profileRow.ticker ?? "").trim();
        const currentLogoAssetId = String(profileRow.logo_asset_id ?? "").trim();
        if (!currentProjectName || !currentLogoAssetId) {
          return respond({ error: "BRANDING_UNAVAILABLE", message: "Add a project name and select a project logo before posting a branded broadcast." }, 400);
        }
        if (
          reviewedProjectName !== currentProjectName ||
          reviewedTicker !== currentTicker ||
          reviewedLogoAssetId !== currentLogoAssetId
        ) {
          return respond({
            error: "BRANDING_CHANGED",
            message: "The project branding changed since you reviewed this broadcast. Review it again before posting.",
          }, 409);
        }

        const { data: assetRow, error: assetError } = await admin.from("media_assets")
          .select("id,workspace_id,asset_type,storage_path,mime_type,file_size_bytes,width,height")
          .eq("id", currentLogoAssetId).eq("workspace_id", workspaceId).maybeSingle();
        if (assetError) throw assetError;
        const storagePath = String(assetRow?.storage_path ?? "").trim();
        if (!assetRow || !storagePath) {
          return respond({ error: "BRANDING_UNAVAILABLE", message: "The selected project logo is no longer available. Choose a logo in Project Profile." }, 400);
        }
        if (String(assetRow.asset_type ?? "") !== "logo") {
          return respond({ error: "BRANDING_LOGO_UNSUPPORTED", message: "The selected asset is not a project logo. Choose a logo in Project Profile." }, 400);
        }
        const mimeType = String(assetRow.mime_type ?? "").toLowerCase();
        if (mimeType !== "image/png" && mimeType !== "image/jpeg") {
          return respond({ error: "BRANDING_LOGO_UNSUPPORTED", message: "Branded broadcasts need a PNG or JPEG project logo. Upload one in Project Profile." }, 400);
        }
        const sizeBytes = typeof assetRow.file_size_bytes === "number" ? assetRow.file_size_bytes : null;
        if (sizeBytes !== null && (sizeBytes <= 0 || sizeBytes > BRANDED_LOGO_MAX_BYTES)) {
          return respond({ error: "BRANDING_LOGO_UNSUPPORTED", message: "Branded broadcasts need a project logo of 10MB or less. Upload a smaller PNG or JPEG in Project Profile." }, 400);
        }
        const w = typeof assetRow.width === "number" ? assetRow.width : null;
        const h = typeof assetRow.height === "number" ? assetRow.height : null;
        const dimsBad =
          (w !== null && w <= 0) ||
          (h !== null && h <= 0) ||
          (w !== null && h !== null && (w + h > 10000 || Math.max(w, h) / Math.max(1, Math.min(w, h)) > 20));
        if (dimsBad) {
          return respond({ error: "BRANDING_LOGO_UNSUPPORTED", message: "Telegram cannot post this logo's dimensions. Upload a more standard PNG or JPEG logo in Project Profile." }, 400);
        }


        deliveredText = buildBrandedCaption(currentProjectName, currentTicker || null, messageText);
        if (deliveredText.length > BRANDED_CAPTION_MAX) {
          return respond({
            error: "INVALID_MESSAGE",
            message: `Branded broadcasts are limited to ${BRANDED_CAPTION_MAX} characters including the branding header and footer. Shorten the message or post it as plain text.`,
          }, 400);
        }
        brandingSnapshot = {
          projectName: currentProjectName,
          ticker: currentTicker || null,
          logoAssetId: currentLogoAssetId,
          storagePath,
          mimeType,
        };
      }


      // Claim the durable ledger row BEFORE live verification and before sending.
      let announcementId: string | null = null;
      {
        const { data: inserted, error: insertError } = await admin.from("telegram_group_announcements").insert({
          workspace_id: workspaceId,
          group_connection_id: rawGroup.id,
          telegram_chat_id: rawGroup.telegram_chat_id,
          group_title: String(rawGroup.title ?? "Telegram community").slice(0, 512),
          requested_by: user.id,
          client_request_id: clientRequestId,
          message_text: messageText,
          status: "SENDING",
          delivery_kind: deliveryKind,
          delivered_text_snapshot: deliveredText,
          branding_template_version: brandingSnapshot ? BRANDED_TEMPLATE_VERSION : null,
          branding_project_name: brandingSnapshot?.projectName ?? null,
          branding_ticker: brandingSnapshot?.ticker ?? null,
          branding_logo_asset_id: brandingSnapshot?.logoAssetId ?? null,
          branding_logo_storage_path: brandingSnapshot?.storagePath ?? null,
          branding_logo_mime_type: brandingSnapshot?.mimeType ?? null,
        }).select(ledgerSelect).maybeSingle();
        if (insertError) {
          // Concurrent duplicate submit — never send twice, and still prove intent.
          if (String((insertError as any).code) === "23505") {
            const { data: raced } = await admin.from("telegram_group_announcements").select(ledgerSelect)
              .eq("workspace_id", workspaceId).eq("client_request_id", clientRequestId).maybeSingle();
            if (raced) {
              if (!sameIntent(raced)) return conflictResponse();
              return ledgerResponse(raced, true);
            }
          }
          throw insertError;
        }
        announcementId = inserted?.id ?? null;
      }
      if (!announcementId) throw new Error("Could not record this official broadcast. Nothing was posted.");

      /** Records a definite no-send against the claimed ledger row. */
      const markFailed = async (reason: string) => {
        const { error } = await admin.from("telegram_group_announcements")
          .update({ status: "FAILED", last_error: reason.slice(0, 1000) })
          .eq("id", announcementId).eq("status", "SENDING");
        if (error) {
          console.error("[telegram-group] announcement failure record", error.message);
        }
      };

      // Live verification. A definite verification failure means nothing was sent.
      let group: any;
      try {
        group = await verifyGroup(rawGroup);
      } catch (verifyError) {
        const reason = verifyError instanceof Error ? verifyError.message : "Community verification failed.";
        await markFailed(reason);
        // Bot removal keeps its recoverable lifecycle response.
        if (verifyError instanceof BotRemovedError) throw verifyError;
        if (verifyError instanceof Error && isBotRemovedMessage(verifyError.message)) throw verifyError;
        return ledgerResponse({
          id: announcementId,
          status: "FAILED",
          telegram_message_id: null,
          group_title: rawGroup.title,
          group_connection_id: rawGroup.id,
          last_error: reason,
          sent_at: null,
        }, false);
      }

      // Keep the ledger's stored target label current with live verification.
      if (String(group.title ?? "") && String(group.title) !== String(rawGroup.title ?? "")) {
        try {
          await admin.from("telegram_group_announcements")
            .update({ group_title: String(group.title).slice(0, 512) })
            .eq("id", announcementId);
        } catch (e) { console.error("[telegram-group] announcement title sync", e instanceof Error ? e.message : "unknown"); }
      }

      /**
       * C7.2 — for a branded post the logo bytes are fetched BEFORE the single
       * Telegram call. A download failure is a definite no-send: nothing is
       * posted and no plain-text fallback is silently substituted.
       */
      let logoBytes: Blob | null = null;
      if (brandingSnapshot) {
        try {
          const { data: fileData, error: fileError } = await admin.storage
            .from(ASSETS_BUCKET).download(brandingSnapshot.storagePath);
          if (fileError || !fileData) throw new Error(fileError?.message ?? "Logo download returned no data.");
          // Definite pre-send gate: never hand Telegram an empty or oversize file.
          if (fileData.size <= 0) throw new Error("The stored project logo file is empty.");
          if (fileData.size > BRANDED_LOGO_MAX_BYTES) {
            throw new Error("The project logo is larger than 10MB and cannot be posted to Telegram.");
          }
          logoBytes = fileData;
        } catch (e) {
          const reason = `Could not read the project logo: ${e instanceof Error ? e.message : "unknown error"}`;
          await markFailed(reason);
          return ledgerResponse({
            id: announcementId,
            status: "FAILED",
            telegram_message_id: null,
            group_title: group.title ?? rawGroup.title,
            group_connection_id: rawGroup.id,
            last_error: reason,
            sent_at: null,
            delivery_kind: deliveryKind,
            delivered_text_snapshot: deliveredText,
          }, false);
        }
      }

      /**
       * Plain text only: no parse_mode, so operator text is never re-interpreted
       * as markup — the branded path posts the same unformatted words as a photo
       * caption. Outcome is classified into definite failure vs transport
       * uncertainty — an uncertain send is NEVER retried automatically.
       *
       * Exactly ONE Telegram transport call is made per claimed ledger row.
       */
      let outcome: "SENT" | "FAILED" | "AMBIGUOUS" = "AMBIGUOUS";
      let telegramMessageId: number | null = null;
      let lastError: string | null = null;
      try {
        let endpoint: string;
        let init: RequestInit;
        if (logoBytes) {
          const form = new FormData();
          form.append("chat_id", String(group.telegram_chat_id));
          form.append("caption", deliveredText);
          form.append(
            "photo",
            logoBytes,
            brandingSnapshot?.mimeType === "image/jpeg" ? "logo.jpg" : "logo.png",
          );
          endpoint = "sendPhoto";
          init = { method: "POST", body: form };
        } else {
          endpoint = "sendMessage";
          init = {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ chat_id: String(group.telegram_chat_id), text: deliveredText, disable_web_page_preview: true }),
          };
        }
        const res = await fetch(`${TG_BASE}/bot${TELEGRAM_BOT_TOKEN}/${endpoint}`, {
          ...init,
          signal: AbortSignal.timeout(TELEGRAM_TIMEOUT_MS),
        });
        const payload = await res.json().catch(() => null) as any;
        if (payload?.ok === true && typeof payload?.result?.message_id === "number") {
          outcome = "SENT";
          telegramMessageId = payload.result.message_id;
        } else if (res.status >= 500 || !payload) {
          outcome = "AMBIGUOUS";
          lastError = `Telegram response was inconclusive (${res.status}).`;
        } else if (payload?.ok === false) {
          outcome = "FAILED";
          lastError = String(payload?.description ?? `Telegram rejected the official broadcast (${res.status}).`);
        } else {
          outcome = "AMBIGUOUS";
          lastError = "Telegram did not confirm a message id.";
        }
      } catch (e) {
        // Network error / timeout: the message may or may not have been delivered.
        outcome = "AMBIGUOUS";
        lastError = e instanceof Error && e.name === "TimeoutError"
          ? "Telegram did not respond in time."
          : "Could not reach Telegram.";
      }

      const patch: Record<string, unknown> = outcome === "SENT"
        ? { status: "SENT", telegram_message_id: telegramMessageId, sent_at: new Date().toISOString(), last_error: null }
        : { status: outcome, last_error: lastError ? lastError.slice(0, 1000) : null };
      const { data: finalRow, error: finalError } = await admin.from("telegram_group_announcements")
        .update(patch).eq("id", announcementId).select(ledgerSelect).maybeSingle();

      if (finalError || !finalRow) {
        console.error("[telegram-group] announcement ledger update", finalError?.message ?? "no row returned");
        /**
         * The durable row is still SENDING. This request id can only ever return
         * an uncertain outcome and can never trigger a second Telegram send.
         * The confirmed Telegram message id, if any, is preserved internally
         * but the status is NOT claimed as SENT.
         */
        return respond({
          status: "AMBIGUOUS",
          duplicate: false,
          announcementId,
          groupConnectionId: rawGroup.id,
          groupTitle: group.title,
          messageId: telegramMessageId ?? null,
          sentAt: null,
          technical: "Telegram outcome was obtained, but CARTEL HQ could not finalize the durable delivery record. Check the Telegram community before taking any action.",
          message: `Delivery to ${group.title} could not be confirmed. Check the community before posting again — CARTEL HQ will not resend this automatically.`,
        });
      }

      return ledgerResponse(finalRow, false);
    }


    return respond({ error: "UNKNOWN_ACTION", message: "Unknown Telegram group action." }, 400);

  } catch (err) {
    // Bot removal is a recoverable lifecycle state: always HTTP 200, never an
    // `error` field, so the app renders a reconnect prompt instead of a crash.
    const removed = err instanceof BotRemovedError
      ? err
      : (err instanceof Error && isBotRemovedMessage(err.message)
        ? new BotRemovedError(await markGroupRemoved(await getGroup(), "kicked"), "kicked")
        : null);
    if (removed) {
      return respond({
        connected: true,
        ready: false,
        reconnectRequired: true,
        connectionState: "bot_removed",
        botIsAdmin: false,
        botCanChangeInfo: false,
        canSetStickerSet: false,
        assigned: false,
        announced: false,
        sent: false,
        saved: false,
        group: removed.group ?? null,
        memberStatus: removed.memberStatus,
        message: removed.message,
      });
    }

    console.error("[telegram-group]", err instanceof Error ? err.message : "unknown error"); return respond({ error: "TELEGRAM_GROUP_ERROR", message: err instanceof Error ? err.message : "Telegram group action failed." }, 400);
  }

});
