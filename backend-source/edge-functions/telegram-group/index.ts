import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2";

const TG_BASE = "https://api.telegram.org";
const MAX_BATCH_GROUPS = 50;
const NATIVE_SYNC_ERROR = "Published Telegram sticker set is out of sync with this Cartel HQ pack. Refresh or republish before native delivery.";
const cors = { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type", "Access-Control-Allow-Methods": "POST, OPTIONS" };
function respond(body: unknown, status = 200) { return new Response(JSON.stringify(body), { status, headers: { ...cors, "Content-Type": "application/json" } }); }
async function telegramJson(token: string, method: string, body: Record<string, unknown> = {}) { const res = await fetch(`${TG_BASE}/bot${token}/${method}`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) }); const payload = await res.json().catch(() => null) as any; if (!res.ok || !payload?.ok) throw new Error(String(payload?.description ?? `Telegram request failed (${res.status}).`)); return payload.result; }
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
  const { data: membership } = await admin.from("workspace_members").select("user_id").eq("workspace_id", workspaceId).eq("user_id", user.id).maybeSingle(); if (!membership) return respond({ error: "FORBIDDEN", message: "You do not have access to this workspace." }, 403);

  const getGroup = async (id = groupConnectionId) => { if (!id) return null; const { data } = await admin.from("telegram_group_connections").select("*").eq("id", id).eq("workspace_id", workspaceId).maybeSingle(); return data; };
  const verifyGroup = async (group: any) => {
    if (!group) throw new Error("Connect a Telegram group before publishing.");
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
    return respond({ error: "UNKNOWN_ACTION", message: "Unknown Telegram group action." }, 400);
  } catch (err) { console.error("[telegram-group]", err instanceof Error ? err.message : "unknown error"); return respond({ error: "TELEGRAM_GROUP_ERROR", message: err instanceof Error ? err.message : "Telegram group action failed." }, 400); }
});
