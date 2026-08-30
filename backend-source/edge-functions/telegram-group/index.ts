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

  const verifyGroup = async (group: any) => {
    if (!group) throw new Error("Connect a Telegram group before publishing.");
    const removedStatus = storedRemovedStatus(group);
    if (removedStatus) throw new BotRemovedError(group, removedStatus);

    const me = await telegramJson(TELEGRAM_BOT_TOKEN, "getMe");
    const [chat, botMember, memberCountRaw] = await Promise.all([
      telegramJson(TELEGRAM_BOT_TOKEN, "getChat", { chat_id: String(group.telegram_chat_id) }),
      telegramJson(TELEGRAM_BOT_TOKEN, "getChatMember", { chat_id: String(group.telegram_chat_id), user_id: me.id }),
      telegramJson(TELEGRAM_BOT_TOKEN, "getChatMemberCount", { chat_id: String(group.telegram_chat_id) }).catch(() => null),
    ]);
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

  const distributeOne = async (pack: any, rawGroup: any) => {
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
        results.push(await distributeOne(pack, group));
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
      const loadSettings = async () => {
        const { data } = await admin.from("telegram_community_settings").select("*").eq("group_connection_id", group.id).maybeSingle();
        return data ?? { group_connection_id: group.id, workspace_id: workspaceId, welcome_enabled: false, welcome_message: DEFAULT_WELCOME_MESSAGE, mention_member: true, auto_delete_enabled: true, auto_delete_seconds: 45, metadata: {}, created_at: null, updated_at: null };
      };

      if (action === "welcome_settings") return respond({ settings: await loadSettings(), canManage: canManageCommunity });
      if (!canManageCommunity) return respond({ error: "FORBIDDEN", message: "Only workspace owners and admins can change community welcome settings." }, 403);

      if (action === "save_welcome_settings") {
        const raw = (body.settings && typeof body.settings === "object" ? body.settings : {}) as Record<string, unknown>;
        const welcomeMessage = typeof raw.welcomeMessage === "string" ? raw.welcomeMessage.trim() : "";
        if (!welcomeMessage) return respond({ error: "INVALID_MESSAGE", message: "Enter a welcome message." }, 400);
        if (welcomeMessage.length > 3500) return respond({ error: "INVALID_MESSAGE", message: "Welcome messages are limited to 3500 characters." }, 400);
        if (typeof raw.welcomeEnabled !== "boolean" || typeof raw.mentionMember !== "boolean" || typeof raw.autoDeleteEnabled !== "boolean") {
          return respond({ error: "INVALID_SETTINGS", message: "Invalid welcome settings." }, 400);
        }
        const seconds = Number(raw.autoDeleteSeconds);
        if (!Number.isInteger(seconds) || seconds < 10 || seconds > 120) return respond({ error: "INVALID_SECONDS", message: "Auto-delete must be between 10 and 120 seconds." }, 400);
        const now = new Date().toISOString();
        const { data: saved, error } = await admin.from("telegram_community_settings").upsert({
          group_connection_id: group.id, workspace_id: workspaceId, welcome_enabled: raw.welcomeEnabled, welcome_message: welcomeMessage,
          mention_member: raw.mentionMember, auto_delete_enabled: raw.autoDeleteEnabled, auto_delete_seconds: seconds, updated_at: now,
        }, { onConflict: "group_connection_id" }).select("*").maybeSingle();
        if (error) throw error;
        return respond({ saved: true, settings: saved ?? (await loadSettings()), canManage: true });
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
      const sent = await telegramJson(TELEGRAM_BOT_TOKEN, "sendMessage", { chat_id: String(group.telegram_chat_id), text: `${rendered}\n\n<i>(CARTEL HQ welcome preview)</i>`, parse_mode: "HTML", disable_web_page_preview: true });
      const messageId = sent?.message_id ?? null;
      if (settings.auto_delete_enabled && messageId) {
        const delayMs = Math.min(120, Math.max(10, Number(settings.auto_delete_seconds) || 45)) * 1000;
        const cleanup = (async () => {
          await new Promise((resolve) => setTimeout(resolve, delayMs));
          try { await telegramJson(TELEGRAM_BOT_TOKEN, "deleteMessage", { chat_id: String(group.telegram_chat_id), message_id: messageId }); }
          catch (e) { console.error("[telegram-group] welcome test cleanup", e instanceof Error ? e.message : "unknown"); }
        })();
        try { (globalThis as any).EdgeRuntime?.waitUntil?.(cleanup); } catch { }
      }
      return respond({ sent: true, messageId, autoDeleteSeconds: settings.auto_delete_enabled ? settings.auto_delete_seconds : null, groupTitle: group.title });
    }

    return respond({ error: "UNKNOWN_ACTION", message: "Unknown Telegram group action." }, 400);
  } catch (err) { console.error("[telegram-group]", err instanceof Error ? err.message : "unknown error"); return respond({ error: "TELEGRAM_GROUP_ERROR", message: err instanceof Error ? err.message : "Telegram group action failed." }, 400); }
});
