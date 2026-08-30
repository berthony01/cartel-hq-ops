import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2";

const TG_BASE = "https://api.telegram.org";
const BOT_USERNAME = "PepeCartelHQBot";
const PEPECARTEL_TELEGRAM = "https://t.me/PEPECARTELPORTAL";
const PEPECARTEL_X = "https://x.com/PEPECARTELTOKEN";
const PEPECARTEL_WEBSITE = "https://pepecartelcommunity.com/?utm_source=telegram&utm_medium=bot&utm_campaign=cartel_hq_private_beta";
const GROUP_INSTALL_URL = `https://t.me/${BOT_USERNAME}?startgroup&admin=change_info`;
const WELCOME_COOLDOWN_MS = 7 * 24 * 60 * 60 * 1000;
const BOT_PROFILE_DESCRIPTION = "🐸 Welcome to CARTEL HQ\n\nThe Telegram command bot for the growing PEPECARTEL ecosystem.\n\nCreate and publish community stickers, connect Telegram groups, access Cartel HQ tools, and get early access to new features being built for crypto communities.\n\nTap Start to choose what you want to do.";
const BOT_SHORT_DESCRIPTION = "PEPECARTEL's Cartel HQ bot for stickers, community tools, group connections and Private Beta access.";
let commandsConfiguredAt = 0;
let profileConfiguredAt = 0;

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
}
async function sha256Hex(value: string) {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
  return Array.from(new Uint8Array(digest)).map((b) => b.toString(16).padStart(2, "0")).join("");
}
async function webhookSecret(token: string) {
  return (await sha256Hex(`cartelhq-webhook:${token}`)).slice(0, 48);
}
/** Hard timeout around every api.telegram.org call so a hung request cannot stall the function. */
const TELEGRAM_TIMEOUT_MS = 10_000;
async function telegramJson(token: string, method: string, body: Record<string, unknown> = {}) {
  let res: Response;
  try {
    res = await fetch(`${TG_BASE}/bot${token}/${method}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(TELEGRAM_TIMEOUT_MS),
    });
  } catch {
    throw new Error("Could not reach Telegram. Try again shortly.");
  }
  const payload = await res.json().catch(() => null) as any;
  if (!res.ok || !payload?.ok) throw new Error(String(payload?.description ?? `Telegram request failed (${res.status}).`));
  return payload.result;
}
async function sendMessage(token: string, chatId: string, text: string, extra: Record<string, unknown> = {}) {
  try {
    return await telegramJson(token, "sendMessage", { chat_id: chatId, text, disable_web_page_preview: true, ...extra });
  } catch {
    return null;
  }
}
async function answerCallback(token: string, callbackId: string, text: string) {
  try { await telegramJson(token, "answerCallbackQuery", { callback_query_id: callbackId, text, show_alert: false }); } catch { }
}
async function editMessage(token: string, chatId: string, messageId: number, text: string, replyMarkup?: unknown) {
  try {
    await telegramJson(token, "editMessageText", {
      chat_id: chatId,
      message_id: messageId,
      text,
      parse_mode: "HTML",
      disable_web_page_preview: true,
      ...(replyMarkup ? { reply_markup: replyMarkup } : {}),
    });
  } catch { }
}
function escapeHtml(value: string) { return value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;"); }
function encodeChatId(chatId: string) { return chatId.startsWith("-") ? `n${chatId.slice(1)}` : chatId; }
function decodeChatId(encoded: string) { return encoded.startsWith("n") ? `-${encoded.slice(1)}` : encoded; }
function shouldSendWelcome(value: string | null | undefined) {
  if (!value) return true;
  const ms = new Date(value).getTime();
  return !Number.isFinite(ms) || Date.now() - ms > WELCOME_COOLDOWN_MS;
}
function betaKeyboard(joinCallback = true) {
  return {
    inline_keyboard: [
      ...(joinCallback ? [[{ text: "🟡 Join Early Access", callback_data: "beta_join" }]] : []),
      [
        { text: "💬 PEPECARTEL Community", url: PEPECARTEL_TELEGRAM },
        { text: "𝕏 Follow on X", url: PEPECARTEL_X },
      ],
      [
        { text: "🌐 Visit Website", url: PEPECARTEL_WEBSITE },
        { text: "🗺 What's Coming", callback_data: "beta_roadmap" },
      ],
    ],
  };
}
function startMenuKeyboard(linked: boolean) {
  return {
    inline_keyboard: [
      [{ text: "🏘️ Add CARTEL HQ to my community", url: GROUP_INSTALL_URL }],
      [
        { text: "🎨 Sticker Tools", callback_data: "start_stickers" },
        ...(linked ? [] : [{ text: "🚀 Join Early Access", callback_data: "beta_join" }]),
      ],
      [{ text: "🗺️ Explore the Roadmap", callback_data: "beta_roadmap" }],
      [
        { text: "💬 PEPECARTEL Community", url: PEPECARTEL_TELEGRAM },
        { text: "𝕏 Follow PEPECARTEL", url: PEPECARTEL_X },
      ],
      [{ text: "🌐 Visit Website", url: PEPECARTEL_WEBSITE }],
    ],
  };
}
function groupAcquisitionKeyboard(chatId: string) {
  const encoded = encodeChatId(chatId);
  return {
    inline_keyboard: [
      [{ text: "🚀 Join Early Access", url: `https://t.me/${BOT_USERNAME}?start=beta_join_g_${encoded}` }],
      [
        { text: "💬 PEPECARTEL Community", url: PEPECARTEL_TELEGRAM },
        { text: "𝕏 Follow on X", url: PEPECARTEL_X },
      ],
      [{ text: "🌐 Visit Website", url: PEPECARTEL_WEBSITE }],
    ],
  };
}
function betaWelcomeText() {
  return `<b>WELCOME TO PEPECARTEL HQ 🐸</b>\n\n@${BOT_USERNAME} is the Telegram extension of the growing PEPECARTEL ecosystem.\n\n<b>Private Beta is active.</b>\n\nSticker creation, Telegram sticker-pack publishing, native sticker delivery and multi-group distribution are among the first live Cartel HQ capabilities. More tools for crypto communities, projects, creators and operators are being developed progressively.\n\nWant early access as new capabilities roll out?`;
}
function startMenuText(linked: boolean) {
  return linked
    ? `<b>WELCOME BACK TO CARTEL HQ 🐸</b>\n\nYour Telegram account is connected to Cartel HQ.\n\n<b>What would you like to do?</b>\n\nSticker tools are live in Private Beta, and more community tools are being added progressively.`
    : `<b>WELCOME TO CARTEL HQ 🐸</b>\n\nThe Telegram command bot for the growing PEPECARTEL ecosystem.\n\nSticker creation, Telegram sticker-pack publishing, native sticker delivery and multi-group distribution are live in <b>Private Beta</b>. More community tools are on the way.\n\n<b>What would you like to do?</b>`;
}
function roadmapText() {
  return `<b>CARTEL HQ BOT • PRIVATE BETA ROADMAP</b>\n\n<b>LIVE NOW</b>\n✅ AI Sticker Lab\n✅ Telegram sticker-pack publishing\n✅ Native Telegram sticker delivery\n✅ Multi-group sticker distribution\n✅ Community join welcomes with optional auto-delete\n\n<b>IN DEVELOPMENT</b>\n🚧 <b>Telegram Community Tools</b>\n• Sticker Pack Manager\n• Cartel Sticker Drops — scheduled branded sticker posts\n• Scheduled announcements, polls & giveaways\n• Community analytics\n\n🚧 <b>Cartel Launch Network</b>\n• Launch watchlists & countdowns\n• Official launch alerts & Verified Launch Packets\n\n🚧 Operations & Missions\n🚧 Project Verification\n🚧 Distribution expansion\n🚧 Cartel Shield\n🚧 Reputation & analytics\n\nCartel Sticker Drops will be admin-controlled with scheduling, quiet hours and post limits. More capabilities will roll out progressively through Cartel HQ. Public Cartel HQ web access will be added here when it is ready.\n\n<b>Want early access to what's coming next?</b>`;
}
function helpText(isGroup: boolean) {
  return isGroup
    ? `<b>CARTEL HQ BOT • PRIVATE BETA</b>\n\nCurrent group capabilities include community join welcomes with optional auto-delete, Telegram sticker-pack distribution and native sticker delivery. Additional community tools are in development.\n\n<b>Commands</b>\n/roadmap — see what's live and what's coming\n/help — show this guide\n\nAdmins can follow PEPECARTEL and join Early Access through @${BOT_USERNAME}.`
    : `<b>CARTEL HQ BOT • HELP</b>\n\n/start — open the Cartel HQ menu\n/roadmap — what's live and what's coming\n/help — show this guide\n\nSticker creation and workspace management currently happen through Cartel HQ beta workspaces. Public Cartel HQ web access will be added when ready.`;
}
async function ensureCommands(token: string) {
  if (Date.now() - commandsConfiguredAt < 6 * 60 * 60 * 1000) return;
  commandsConfiguredAt = Date.now();
  try {
    await telegramJson(token, "setMyCommands", {
      commands: [
        { command: "start", description: "Open Cartel HQ menu" },
        { command: "help", description: "How to use the bot" },
        { command: "roadmap", description: "What's live and what's coming" },
      ],
    });
  } catch { }
}
async function ensureBotProfile(token: string) {
  if (Date.now() - profileConfiguredAt < 24 * 60 * 60 * 1000) return;
  profileConfiguredAt = Date.now();
  try {
    await Promise.all([
      telegramJson(token, "setMyDescription", { description: BOT_PROFILE_DESCRIPTION }),
      telegramJson(token, "setMyShortDescription", { short_description: BOT_SHORT_DESCRIPTION }),
    ]);
  } catch { }
}

Deno.serve(async (req: Request) => {
  if (req.method !== "POST") return json({ ok: true });
  const SUPABASE_URL = Deno.env.get("SUPABASE_URL") ?? "";
  const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
  const TELEGRAM_BOT_TOKEN = Deno.env.get("TELEGRAM_BOT_TOKEN") ?? "";
  if (!SUPABASE_URL || !SERVICE_KEY || !TELEGRAM_BOT_TOKEN) return json({ ok: false }, 503);
  const expected = await webhookSecret(TELEGRAM_BOT_TOKEN);
  const supplied = req.headers.get("X-Telegram-Bot-Api-Secret-Token") ?? "";
  if (!supplied || supplied !== expected) return json({ ok: false }, 403);
  let update: any;
  try { update = await req.json(); } catch { return json({ ok: true }); }
  const admin = createClient(SUPABASE_URL, SERVICE_KEY, { auth: { persistSession: false, autoRefreshToken: false } });
  void ensureCommands(TELEGRAM_BOT_TOKEN);
  void ensureBotProfile(TELEGRAM_BOT_TOKEN);

  const getLinkedUser = async (telegramUserId: string) => {
    const { data } = await admin.from("telegram_connections").select("user_id").eq("telegram_user_id", telegramUserId).maybeSingle();
    return data ?? null;
  };
  const getUserBetaContact = async (telegramUserId: string) => {
    const { data } = await admin.from("telegram_beta_contacts").select("*").eq("subject_type", "user").eq("telegram_user_id", telegramUserId).maybeSingle();
    return data ?? null;
  };
  const getGroupBetaContact = async (telegramChatId: string) => {
    const { data } = await admin.from("telegram_beta_contacts").select("*").eq("subject_type", "group").eq("telegram_chat_id", telegramChatId).maybeSingle();
    return data ?? null;
  };
  const getSourceGroupContext = async (telegramChatId: string) => {
    const beta = await getGroupBetaContact(telegramChatId);
    if (beta) return { title: beta.chat_title ?? null, type: beta.chat_type ?? null };
    const { data: connected } = await admin.from("telegram_group_connections").select("title,chat_type").eq("telegram_chat_id", telegramChatId).maybeSingle();
    return { title: connected?.title ?? null, type: connected?.chat_type ?? null };
  };
  const touchUserContact = async (from: any, opts: {
    source: string;
    sourceChatId?: string | null;
    sourceChatTitle?: string | null;
    sourceChatType?: string | null;
    optedIn?: boolean;
    isLinkedUser?: boolean;
    welcomeSent?: boolean;
    cta?: string | null;
  }) => {
    const telegramUserId = String(from.id);
    const now = new Date().toISOString();
    const existing = await getUserBetaContact(telegramUserId);
    const priorMeta = existing?.metadata && typeof existing.metadata === "object" ? existing.metadata : {};
    const counts = priorMeta?.cta_counts && typeof priorMeta.cta_counts === "object" ? { ...priorMeta.cta_counts } : {};
    if (opts.cta) counts[opts.cta] = Number(counts[opts.cta] ?? 0) + 1;
    const metadata = {
      ...priorMeta,
      ...(opts.cta ? { cta_counts: counts, last_cta: opts.cta, last_cta_at: now } : {}),
    };
    const patch: Record<string, unknown> = {
      telegram_username: typeof from.username === "string" ? from.username : null,
      first_name: typeof from.first_name === "string" ? from.first_name : null,
      last_name: typeof from.last_name === "string" ? from.last_name : null,
      last_seen_at: now,
      metadata,
      is_linked_user: opts.isLinkedUser === true || existing?.is_linked_user === true,
    };
    if (!existing) {
      Object.assign(patch, {
        subject_type: "user",
        telegram_user_id: telegramUserId,
        source: opts.source,
        source_chat_id: opts.sourceChatId ?? null,
        source_chat_title: opts.sourceChatTitle ?? null,
        source_chat_type: opts.sourceChatType ?? null,
        opted_in: opts.optedIn === true,
        opted_in_at: opts.optedIn ? now : null,
        welcome_sent_at: opts.welcomeSent ? now : null,
      });
      const { data, error } = await admin.from("telegram_beta_contacts").insert(patch).select("*").single();
      if (error) {
        const retry = await getUserBetaContact(telegramUserId);
        if (retry) return retry;
        throw error;
      }
      return data;
    }
    if (opts.optedIn === true) {
      patch.opted_in = true;
      patch.opted_in_at = existing.opted_in_at ?? now;
    }
    if (opts.welcomeSent === true) patch.welcome_sent_at = now;
    if (!existing.source_chat_id && opts.sourceChatId) {
      patch.source_chat_id = opts.sourceChatId;
      patch.source_chat_title = opts.sourceChatTitle ?? null;
      patch.source_chat_type = opts.sourceChatType ?? null;
    }
    const { data, error } = await admin.from("telegram_beta_contacts").update(patch).eq("id", existing.id).select("*").single();
    if (error) throw error;
    return data;
  };
  const touchGroupContact = async (chat: any, actor: any, opts: { welcomeSent?: boolean; status?: string | null }) => {
    const chatId = String(chat.id);
    const now = new Date().toISOString();
    const existing = await getGroupBetaContact(chatId);
    const priorMeta = existing?.metadata && typeof existing.metadata === "object" ? existing.metadata : {};
    const patch: Record<string, unknown> = {
      chat_title: String(chat.title ?? existing?.chat_title ?? "Telegram Group"),
      chat_type: String(chat.type ?? existing?.chat_type ?? "group"),
      installer_telegram_user_id: actor?.id != null ? String(actor.id) : existing?.installer_telegram_user_id ?? null,
      last_seen_at: now,
      metadata: { ...priorMeta, last_member_status: opts.status ?? priorMeta?.last_member_status ?? null },
    };
    if (!existing) {
      Object.assign(patch, {
        subject_type: "group",
        telegram_chat_id: chatId,
        source: "group_install",
        welcome_sent_at: opts.welcomeSent ? now : null,
      });
      const { data, error } = await admin.from("telegram_beta_contacts").insert(patch).select("*").single();
      if (error) {
        const retry = await getGroupBetaContact(chatId);
        if (retry) return retry;
        throw error;
      }
      return data;
    }
    if (opts.welcomeSent === true) patch.welcome_sent_at = now;
    const { data, error } = await admin.from("telegram_beta_contacts").update(patch).eq("id", existing.id).select("*").single();
    if (error) throw error;
    return data;
  };
  const markGroupLinked = async (chatId: string, workspaceId: string) => {
    const existing = await getGroupBetaContact(chatId);
    if (!existing) return;
    const prior = existing.metadata && typeof existing.metadata === "object" ? existing.metadata : {};
    await admin.from("telegram_beta_contacts").update({ metadata: { ...prior, linked_workspace: true, workspace_id: workspaceId, linked_at: new Date().toISOString() } }).eq("id", existing.id);
  };

  const findPendingGroupLink = async (telegramUserId: string) => {
    const { data: personal } = await admin.from("telegram_connections").select("user_id").eq("telegram_user_id", telegramUserId).maybeSingle();
    if (!personal?.user_id) return null;
    const { data: pending } = await admin.from("telegram_link_requests").select("id,user_id,status,expires_at,metadata").eq("user_id", personal.user_id).eq("status", "pending").order("created_at", { ascending: false }).limit(5);
    return (pending ?? []).find((r: any) => r?.metadata?.link_type === "group" && new Date(r.expires_at).getTime() > Date.now()) ?? null;
  };

  const communityConnectedText = (groupTitle: string) => {
    const title = escapeHtml(groupTitle && groupTitle.trim() ? groupTitle : "This community");
    return [
      "<b>✅ CARTEL HQ CONNECTED</b>",
      "",
      `<b>${title}</b> is now connected to Cartel HQ.`,
      "",
      "🐸 <b>@PepeCartelHQBot is active in this community.</b>",
      "",
      "Community owners configure tools and automations inside <b>Cartel HQ</b>, and the bot carries them out here in Telegram.",
      "",
      "<b>Available now</b>",
      "👋 Welcome &amp; onboarding",
      "🎨 Telegram sticker packs",
      "🤖 Native Sticker Drops",
      "",
      "<b>Coming through Cartel HQ</b>",
      "📢 Community automations",
      "📊 Polls, milestones &amp; community intelligence",
      "🚀 Launch Watch &amp; official launch alerts",
      "🛡 Project verification",
      "⚡ More community &amp; launch tools",
      "",
      "Return to Cartel HQ to configure this community.",
    ].join("\n");
  };
  const botInstalledText = (groupTitle: string) => {
    const title = escapeHtml(groupTitle && groupTitle.trim() ? groupTitle : "This community");
    return [
      "<b>🐸 PEPECARTEL HQ BOT INSTALLED</b>",
      "",
      `<b>${title}</b> has added @${BOT_USERNAME}.`,
      "",
      "This community is <b>not connected to a Cartel HQ workspace yet.</b>",
      "",
      "Cartel HQ is the command center where community owners configure tools and automations. The bot carries approved actions out here in Telegram.",
      "",
      "<b>Available through Cartel HQ</b>",
      "👋 Welcome &amp; onboarding",
      "🎨 Telegram sticker packs",
      "🤖 Native Sticker Drops",
      "",
      "<b>Coming next</b>",
      "📢 Community automations",
      "🚀 Launch Watch &amp; official launch alerts",
      "🛡 Project verification",
      "",
      "New to Cartel HQ? Join Early Access below. Already have an account? Connect your Telegram account in Cartel HQ, then connect this community from your workspace.",
    ].join("\n");
  };
  const accountFoundText = (groupTitle: string) => {
    const title = escapeHtml(groupTitle && groupTitle.trim() ? groupTitle : "This community");
    return [
      "<b>🐸 CARTEL HQ ACCOUNT FOUND</b>",
      "",
      `We recognize the Cartel HQ account linked to the Telegram user who added @${BOT_USERNAME} to <b>${title}</b>.`,
      "",
      "This community is <b>not connected to a Cartel HQ workspace yet.</b>",
      "",
      "Return to Cartel HQ and use <b>Connect Community</b> from the workspace that should control this group. Once verified, the bot will activate that workspace's approved community tools here.",
    ].join("\n");
  };

  // Platform-owner published overrides for the three system messages.
  // Reads published content only; drafts are never read here. Any failure falls
  // back silently to the hardcoded copy above.
  let publishedTemplates: Record<string, string> | null = null;
  const loadPublishedTemplates = async (): Promise<Record<string, string>> => {
    if (publishedTemplates) return publishedTemplates;
    const loaded: Record<string, string> = {};
    try {
      const { data } = await admin.from("platform_message_templates").select("key,published_body");
      for (const row of (data ?? []) as Array<Record<string, unknown>>) {
        const key = typeof row?.key === "string" ? row.key : "";
        const value = typeof row?.published_body === "string" ? row.published_body : "";
        if (key && value.trim()) loaded[key] = value;
      }
    } catch (_err) {
      // ignore: fall back to hardcoded copy
    }
    publishedTemplates = loaded;
    return loaded;
  };
  const systemMessage = async (
    key: string,
    groupTitle: string,
    fallback: (groupTitle: string) => string,
  ): Promise<string> => {
    try {
      const templates = await loadPublishedTemplates();
      const published = templates[key];
      if (published && published.trim()) {
        const title = escapeHtml(groupTitle && groupTitle.trim() ? groupTitle : "This community");
        return published.split("{group_title}").join(title);
      }
    } catch (_err) {
      // ignore: fall back to hardcoded copy
    }
    return fallback(groupTitle);
  };



  const bindGroup = async (params: { chat: any; actor: any; link: any }) => {
    const { chat, actor, link } = params;
    const chatId = String(chat?.id ?? ""), actorId = String(actor?.id ?? ""), now = new Date().toISOString();
    const workspaceId = typeof link?.metadata?.workspace_id === "string" ? link.metadata.workspace_id : "";
    if (!chatId || !actorId || !workspaceId) return { ok: false, reason: "missing_context" };
    const chatType = String(chat?.type ?? "");
    if (chatType !== "group" && chatType !== "supergroup") {
      await admin.from("telegram_link_requests").update({ status: "cancelled", consumed_at: now }).eq("id", link.id);
      await sendMessage(TELEGRAM_BOT_TOKEN, chatId, "CARTEL HQ can connect Telegram groups and supergroups. Choose a group chat and try again.");
      return { ok: false, reason: "unsupported_chat_type" };
    }
    const { data: personal } = await admin.from("telegram_connections").select("telegram_user_id").eq("user_id", link.user_id).maybeSingle();
    if (!personal?.telegram_user_id || String(personal.telegram_user_id) !== actorId) {
      await admin.from("telegram_link_requests").update({ status: "cancelled", consumed_at: now }).eq("id", link.id);
      await sendMessage(TELEGRAM_BOT_TOKEN, chatId, "This group-link request belongs to a different Telegram account. Start the connection again from CARTEL HQ.");
      return { ok: false, reason: "wrong_actor" };
    }
    const { data: membership } = await admin.from("workspace_members").select("user_id").eq("workspace_id", workspaceId).eq("user_id", link.user_id).maybeSingle();
    if (!membership) {
      await admin.from("telegram_link_requests").update({ status: "cancelled", consumed_at: now }).eq("id", link.id);
      return { ok: false, reason: "no_workspace_access" };
    }

    const me = await telegramJson(TELEGRAM_BOT_TOKEN, "getMe"), fullChat = await telegramJson(TELEGRAM_BOT_TOKEN, "getChat", { chat_id: chatId });
    const [botMember, userMember, memberCountRaw] = await Promise.all([
      telegramJson(TELEGRAM_BOT_TOKEN, "getChatMember", { chat_id: chatId, user_id: me.id }),
      telegramJson(TELEGRAM_BOT_TOKEN, "getChatMember", { chat_id: chatId, user_id: actorId }),
      telegramJson(TELEGRAM_BOT_TOKEN, "getChatMemberCount", { chat_id: chatId }).catch(() => null),
    ]);
    const memberCount = typeof memberCountRaw === "number" ? memberCountRaw : null;
    const resolvedChatType = String(fullChat?.type ?? chatType);
    const botIsAdmin = botMember?.status === "administrator" || botMember?.status === "creator";
    const userIsAdmin = userMember?.status === "administrator" || userMember?.status === "creator";
    const botCanChangeInfo = botMember?.status === "creator" || botMember?.can_change_info === true;
    const canSetStickerSet = resolvedChatType === "supergroup" && fullChat?.can_set_sticker_set === true;
    const officialReason = canSetStickerSet ? null : resolvedChatType !== "supergroup" ? "requires_supergroup" : "not_reported";
    const diagnostic = {
      checked_at: now,
      telegram_chat_id: chatId,
      group_title: String(fullChat?.title ?? chat?.title ?? "Telegram Group"),
      chat_type: resolvedChatType,
      actor_status: String(userMember?.status ?? "unknown"),
      user_is_admin: userIsAdmin,
      bot_status: String(botMember?.status ?? "unknown"),
      bot_is_admin: botIsAdmin,
      bot_can_change_info: botCanChangeInfo,
      can_set_sticker_set: fullChat?.can_set_sticker_set === true ? true : (fullChat?.can_set_sticker_set === false ? false : null),
      member_count: memberCount,
      official_group_sticker_min_members: null,
      official_group_sticker_eligible: canSetStickerSet,
      official_group_sticker_reason: officialReason,
    };

    if (!userIsAdmin || !botIsAdmin || !botCanChangeInfo) {
      await admin.from("telegram_link_requests").update({ metadata: { ...(link.metadata ?? {}), last_group_check: diagnostic } }).eq("id", link.id);
      let reason = "Telegram still reports that this group is not ready.";
      if (!userIsAdmin) reason = "Your connected Telegram account is not an administrator in this group.";
      else if (!botIsAdmin) reason = `@${BOT_USERNAME} is not an administrator in this group.`;
      else if (!botCanChangeInfo) reason = `@${BOT_USERNAME} is an admin, but Change Group Info is not enabled for the bot.`;
      await sendMessage(TELEGRAM_BOT_TOKEN, chatId, `CARTEL HQ group check failed: ${reason}\n\nThe connection link is still active. Fix the permission, then send /cartelhq again before the link expires.`);
      return { ok: false, reason: "permissions", diagnostic };
    }

    const { data: claimed } = await admin.from("telegram_group_connections").select("id,workspace_id").eq("telegram_chat_id", chatId).maybeSingle();
    if (claimed && claimed.workspace_id !== workspaceId) {
      await admin.from("telegram_link_requests").update({ status: "cancelled", consumed_at: now }).eq("id", link.id);
      await sendMessage(TELEGRAM_BOT_TOKEN, chatId, "This Telegram group is already connected to another CARTEL HQ workspace.");
      return { ok: false, reason: "claimed" };
    }
    const row = {
      workspace_id: workspaceId,
      connected_by: link.user_id,
      telegram_chat_id: chatId,
      title: String(fullChat?.title ?? chat?.title ?? "Telegram Group"),
      username: typeof fullChat?.username === "string" ? fullChat.username : null,
      chat_type: resolvedChatType,
      bot_is_admin: true,
      can_set_sticker_set: canSetStickerSet,
      connected_at: now,
      verified_at: now,
      metadata: {
        added_by_telegram_user_id: actorId,
        bot_status: String(botMember?.status ?? "administrator"),
        bot_can_change_info: botCanChangeInfo,
        member_count: memberCount,
        official_group_sticker_min_members: null,
        official_group_sticker_eligible: canSetStickerSet,
        official_group_sticker_reason: officialReason,
      },
    };
    const { data: groupRow, error: groupError } = await admin.from("telegram_group_connections").upsert(row, { onConflict: "telegram_chat_id" }).select("id,title,username,telegram_chat_id,chat_type,bot_is_admin,can_set_sticker_set,metadata").single();
    if (groupError || !groupRow) throw new Error(groupError?.message ?? "Could not save Telegram group connection.");
    await admin.from("telegram_link_requests").update({ status: "connected", consumed_at: now, telegram_user_id: actorId, metadata: { ...(link.metadata ?? {}), group_connection_id: groupRow.id, telegram_chat_id: chatId, group_title: groupRow.title, last_group_check: diagnostic } }).eq("id", link.id);
    await markGroupLinked(chatId, workspaceId);
    await sendMessage(TELEGRAM_BOT_TOKEN, chatId, await systemMessage("community_connected", String(groupRow.title ?? ""), communityConnectedText), { parse_mode: "HTML" });

    return { ok: true, groupRow };
  };

  try {
    const callback = update?.callback_query;
    if (callback?.id && callback?.from?.id) {
      const from = callback.from;
      const callbackData = String(callback.data ?? "");
      const callbackChat = callback.message?.chat;
      const callbackChatId = callbackChat?.id != null ? String(callbackChat.id) : String(from.id);
      const linked = await getLinkedUser(String(from.id));
      if (callbackData === "beta_join") {
        if (linked?.user_id) {
          const existing = await getUserBetaContact(String(from.id));
          if (existing) await touchUserContact(from, { source: existing.source ?? "private_start", isLinkedUser: true, cta: "early_access_clicked" });
          await answerCallback(TELEGRAM_BOT_TOKEN, callback.id, "Your Telegram is already connected to Cartel HQ.");
          return json({ ok: true });
        }
        await touchUserContact(from, { source: "private_start", optedIn: true, cta: "early_access_clicked" });
        await answerCallback(TELEGRAM_BOT_TOKEN, callback.id, "You're on the Cartel HQ Early Access list ✅");
        if (callback.message?.message_id) {
          await editMessage(TELEGRAM_BOT_TOKEN, callbackChatId, Number(callback.message.message_id), `<b>You're on the Cartel HQ Early Access list ✅</b>\n\nWe'll let you know through @${BOT_USERNAME} as new Private Beta capabilities become available.\n\nFollow the PEPECARTEL ecosystem below while we build.`, betaKeyboard(false));
        }
        return json({ ok: true });
      }
      if (callbackData === "beta_roadmap") {
        if (!linked?.user_id) await touchUserContact(from, { source: "roadmap", cta: "roadmap_clicked" });
        await answerCallback(TELEGRAM_BOT_TOKEN, callback.id, "Cartel HQ roadmap");
        await sendMessage(TELEGRAM_BOT_TOKEN, callbackChatId, roadmapText(), { parse_mode: "HTML", reply_markup: betaKeyboard(!linked?.user_id) });
        return json({ ok: true });
      }
      if (callbackData === "start_stickers") {
        if (!linked?.user_id) await touchUserContact(from, { source: "private_start", cta: "sticker_tools_clicked" });
        await answerCallback(TELEGRAM_BOT_TOKEN, callback.id, "Cartel HQ Sticker Tools");
        const messageText = linked?.user_id
          ? `<b>🎨 CARTEL HQ STICKER TOOLS</b>\n\nSticker Lab is live in your Cartel HQ beta workspace. You can create branded static sticker packs, publish them to Telegram, distribute one pack across multiple connected groups, and send native Telegram stickers.\n\nMore sticker and community tools are being added progressively.`
          : `<b>🎨 CARTEL HQ STICKER TOOLS</b>\n\nAI Sticker Lab, Telegram sticker-pack publishing, native sticker delivery and multi-group distribution are live in Private Beta.\n\nPublic Cartel HQ access is not open yet. Join Early Access to be notified as access and new tools roll out.`;
        await sendMessage(TELEGRAM_BOT_TOKEN, callbackChatId, messageText, { parse_mode: "HTML", reply_markup: betaKeyboard(!linked?.user_id) });
        return json({ ok: true });
      }
      return json({ ok: true });
    }

    const memberUpdate = update?.my_chat_member;
    if (memberUpdate?.chat?.id != null) {
      const chatId = String(memberUpdate.chat.id), status = String(memberUpdate.new_chat_member?.status ?? ""), actor = memberUpdate.from;
      const { data: existing } = await admin.from("telegram_group_connections").select("id,metadata").eq("telegram_chat_id", chatId).maybeSingle();
      if (existing?.id) {
        let botIsAdmin = status === "administrator" || status === "creator", canSet = false, botCanChangeInfo = false, memberCount: number | null = null, resolvedChatType = String(memberUpdate.chat?.type ?? "");
        if (botIsAdmin) {
          try {
            const [chatInfo, me, countRaw] = await Promise.all([
              telegramJson(TELEGRAM_BOT_TOKEN, "getChat", { chat_id: chatId }),
              telegramJson(TELEGRAM_BOT_TOKEN, "getMe"),
              telegramJson(TELEGRAM_BOT_TOKEN, "getChatMemberCount", { chat_id: chatId }).catch(() => null),
            ]);
            resolvedChatType = String(chatInfo?.type ?? resolvedChatType);
            const member = await telegramJson(TELEGRAM_BOT_TOKEN, "getChatMember", { chat_id: chatId, user_id: me.id });
            canSet = resolvedChatType === "supergroup" && chatInfo?.can_set_sticker_set === true;
            botCanChangeInfo = member?.status === "creator" || member?.can_change_info === true;
            memberCount = typeof countRaw === "number" ? countRaw : null;
          } catch { canSet = false; }
        }
        const prior = existing.metadata && typeof existing.metadata === "object" ? existing.metadata : {};
        const officialReason = canSet ? null : resolvedChatType !== "supergroup" ? "requires_supergroup" : "not_reported";
        await admin.from("telegram_group_connections").update({ chat_type: resolvedChatType || "group", bot_is_admin: botIsAdmin, can_set_sticker_set: canSet, verified_at: new Date().toISOString(), metadata: { ...prior, last_member_status: status, bot_can_change_info: botCanChangeInfo, member_count: memberCount, official_group_sticker_min_members: null, official_group_sticker_eligible: canSet, official_group_sticker_reason: officialReason } }).eq("id", existing.id);
        return json({ ok: true });
      }

      const link = actor?.id ? await findPendingGroupLink(String(actor.id)) : null;
      const becameAdmin = status === "administrator" || status === "creator";
      const becameMember = status === "member" || becameAdmin;
      if (link) {
        if (becameAdmin && actor?.id) await bindGroup({ chat: memberUpdate.chat, actor, link });
        return json({ ok: true });
      }

      if (becameMember) {
        const existingGroupContact = await getGroupBetaContact(chatId);
        const shouldWelcome = shouldSendWelcome(existingGroupContact?.welcome_sent_at);
        await touchGroupContact(memberUpdate.chat, actor, { status, welcomeSent: false });
        const installerLinked = actor?.id ? await getLinkedUser(String(actor.id)) : null;
        if (actor?.id && !installerLinked?.user_id) {
          await touchUserContact(actor, { source: "group_install", sourceChatId: chatId, sourceChatTitle: String(memberUpdate.chat?.title ?? "Telegram Group"), sourceChatType: String(memberUpdate.chat?.type ?? "group") });
        }
        if (shouldWelcome) {
          const title = String(memberUpdate.chat?.title ?? "This community");
          const [welcomeText, welcomeKeyboard] = installerLinked?.user_id
            ? [await systemMessage("account_found", title, accountFoundText), undefined]
            : [await systemMessage("bot_installed", title, botInstalledText), groupAcquisitionKeyboard(chatId)];

          const sent = await sendMessage(TELEGRAM_BOT_TOKEN, chatId, welcomeText, { parse_mode: "HTML", ...(welcomeKeyboard ? { reply_markup: welcomeKeyboard } : {}) });
          if (sent) await touchGroupContact(memberUpdate.chat, actor, { status, welcomeSent: true });
        }

      }
      return json({ ok: true });
    }

    const message = update?.message, text = typeof message?.text === "string" ? message.text.trim() : "", from = message?.from, chat = message?.chat;
    const chatId = chat?.id != null ? String(chat.id) : "";
    // Community welcome for real joins — handled BEFORE the text-only early return.
    const newMembers = Array.isArray(message?.new_chat_members) ? message.new_chat_members : [];
    if (newMembers.length > 0 && chatId && (chat?.type === "group" || chat?.type === "supergroup")) {
      const humans = newMembers.filter((m: any) => m && m.is_bot !== true && m.id != null);
      if (humans.length === 0) return json({ ok: true });
      const { data: connection } = await admin.from("telegram_group_connections").select("id,title").eq("telegram_chat_id", chatId).maybeSingle();
      if (!connection?.id) return json({ ok: true });
      const { data: settings } = await admin.from("telegram_community_settings").select("welcome_enabled,welcome_message,mention_member,auto_delete_enabled,auto_delete_seconds,metadata").eq("group_connection_id", connection.id).maybeSingle();
      if (!settings) return json({ ok: true });

      // Diagnostics only. No joining member identity is ever stored here.
      const detectedAt = new Date().toISOString();
      const priorMeta = settings.metadata && typeof settings.metadata === "object" ? settings.metadata as Record<string, unknown> : {};
      const recordDiagnostic = async (result: string, extra: Record<string, unknown> = {}) => {
        try {
          await admin.from("telegram_community_settings")
            .update({ metadata: { ...priorMeta, last_join_detected_at: detectedAt, last_welcome_result: result, ...extra } })
            .eq("group_connection_id", connection.id);
        } catch (e) {
          console.error("[telegram-webhook] welcome diagnostic", e instanceof Error ? e.message : "unknown");
        }
      };

      if (!settings.welcome_enabled) { await recordDiagnostic("skipped_disabled"); return json({ ok: true }); }
      if (typeof settings.welcome_message !== "string" || !settings.welcome_message.trim()) { await recordDiagnostic("skipped_no_message"); return json({ ok: true }); }

      const communityName = escapeHtml(String(chat?.title ?? connection.title ?? "this community"));
      const single = humans.length === 1 ? humans[0] : null;
      const displayName = (m: any) => escapeHtml(String(m?.first_name ?? m?.username ?? "New Member"));
      const mention = (m: any) => `<a href="tg://user?id=${String(m.id)}">${displayName(m)}</a>`;
      const firstNameToken = single ? displayName(single) : escapeHtml("everyone");
      const usernameToken = single && typeof single.username === "string" && single.username ? `@${escapeHtml(single.username)}` : firstNameToken;
      const memberToken = settings.mention_member
        ? humans.slice(0, 5).map(mention).join(", ")
        : (single ? displayName(single) : escapeHtml("everyone"));

      const rendered = escapeHtml(settings.welcome_message)
        .replaceAll("{first_name}", firstNameToken)
        .replaceAll("{username}", usernameToken)
        .replaceAll("{member}", memberToken)
        .replaceAll("{community_name}", communityName);

      const sent = await sendMessage(TELEGRAM_BOT_TOKEN, chatId, rendered, { parse_mode: "HTML" });
      const sentId = (sent as any)?.message_id;
      if (sentId) await recordDiagnostic("sent", { last_welcome_sent_at: new Date().toISOString(), last_welcome_message_id: sentId });
      else await recordDiagnostic("send_failed");
      if (settings.auto_delete_enabled && sentId) {
        const delayMs = Math.min(120, Math.max(10, Number(settings.auto_delete_seconds) || 45)) * 1000;
        const cleanup = (async () => {
          await new Promise((resolve) => setTimeout(resolve, delayMs));
          try { await telegramJson(TELEGRAM_BOT_TOKEN, "deleteMessage", { chat_id: chatId, message_id: sentId }); }
          catch (e) { console.error("[telegram-webhook] welcome cleanup", e instanceof Error ? e.message : "unknown"); }
        })();
        try { (globalThis as any).EdgeRuntime?.waitUntil?.(cleanup); } catch { }
      }
      return json({ ok: true });
    }

    if (!text || !from?.id || !chatId) return json({ ok: true });

    if ((chat?.type === "group" || chat?.type === "supergroup") && /^\/(?:cartelhq|connect)(?:@\w+)?$/i.test(text)) {
      const link = await findPendingGroupLink(String(from.id));
      if (!link) {
        const { data: existingConnection } = await admin.from("telegram_group_connections").select("id,title").eq("telegram_chat_id", chatId).maybeSingle();
        if (existingConnection) {
          const connectedTitle = escapeHtml(String(existingConnection.title ?? chat?.title ?? "This community"));
          await sendMessage(TELEGRAM_BOT_TOKEN, chatId, `<b>✅ ${connectedTitle} is already connected to Cartel HQ.</b>\n\nReturn to Cartel HQ to manage its community tools and automations.`, { parse_mode: "HTML" });
          return json({ ok: true });
        }
        await sendMessage(TELEGRAM_BOT_TOKEN, chatId, "No active CARTEL HQ group-link request was found. Return to CARTEL HQ, press Connect Telegram group / Reconnect, then send /cartelhq here within 10 minutes.");
        return json({ ok: true });
      }
      await bindGroup({ chat, actor: from, link });
      return json({ ok: true });
    }


    const isHelp = /^\/help(?:@\w+)?$/i.test(text);
    const isRoadmap = /^\/roadmap(?:@\w+)?$/i.test(text);
    if (isHelp || isRoadmap) {
      const isGroup = chat?.type === "group" || chat?.type === "supergroup";
      if (!isGroup) {
        const linked = await getLinkedUser(String(from.id));
        if (!linked?.user_id) await touchUserContact(from, { source: isHelp ? "help" : "roadmap", cta: isRoadmap ? "roadmap_command" : "help_command" });
      }
      let replyMarkup: unknown = undefined;
      if (isGroup && isRoadmap) replyMarkup = groupAcquisitionKeyboard(chatId);
      if (!isGroup) replyMarkup = betaKeyboard(!(await getLinkedUser(String(from.id)))?.user_id);
      await sendMessage(TELEGRAM_BOT_TOKEN, chatId, isRoadmap ? roadmapText() : helpText(isGroup), { parse_mode: "HTML", ...(replyMarkup ? { reply_markup: replyMarkup } : {}) });
      return json({ ok: true });
    }

    const groupMatch = text.match(/^\/start(?:@\w+)?\s+cartelhq_group_([a-f0-9]{32})$/i);
    const userMatch = text.match(/^\/start(?:@\w+)?\s+cartelhq_([a-f0-9]{32})$/i);
    const nonce = (groupMatch?.[1] ?? userMatch?.[1] ?? "").toLowerCase();
    if (nonce) {
      const tokenHash = await sha256Hex(nonce), now = new Date().toISOString();
      const { data: link } = await admin.from("telegram_link_requests").select("id,user_id,status,expires_at,metadata").eq("token_hash", tokenHash).maybeSingle();
      if (groupMatch) {
        const linkChatId = typeof link?.metadata?.telegram_chat_id === "string" ? link.metadata.telegram_chat_id : "";
        if (link?.status === "connected" && linkChatId && linkChatId === chatId) return json({ ok: true });
        const usable = link && link.status === "pending" && new Date(link.expires_at).getTime() > Date.now();
        if (usable) { await bindGroup({ chat, actor: from, link }); return json({ ok: true }); }
        const linkWorkspaceId = typeof link?.metadata?.workspace_id === "string" ? link.metadata.workspace_id : "";
        if (linkWorkspaceId) {
          const { data: alreadyConnected } = await admin.from("telegram_group_connections").select("id,workspace_id").eq("telegram_chat_id", chatId).maybeSingle();
          if (alreadyConnected && alreadyConnected.workspace_id === linkWorkspaceId) {
            await sendMessage(TELEGRAM_BOT_TOKEN, chatId, "<b>✅ This community is already connected to Cartel HQ.</b>\n\nReturn to Cartel HQ to manage its community tools and automations.", { parse_mode: "HTML" });
            return json({ ok: true });
          }
        }
        if (link?.id && link.status === "pending") await admin.from("telegram_link_requests").update({ status: "expired" }).eq("id", link.id);
        await sendMessage(TELEGRAM_BOT_TOKEN, chatId, "This CARTEL HQ connection link expired. Return to CARTEL HQ and try again.");
        return json({ ok: true });
      }
      if (!link || link.status !== "pending" || new Date(link.expires_at).getTime() <= Date.now()) {
        if (link?.id && link.status === "pending") await admin.from("telegram_link_requests").update({ status: "expired" }).eq("id", link.id);
        await sendMessage(TELEGRAM_BOT_TOKEN, chatId, "This CARTEL HQ connection link expired. Return to CARTEL HQ and try again.");
        return json({ ok: true });
      }

      if (chat?.type !== "private") return json({ ok: true });
      const telegramUserId = String(from.id);
      const { data: claimedByOther } = await admin.from("telegram_connections").select("id,user_id").eq("telegram_user_id", telegramUserId).maybeSingle();
      if (claimedByOther && claimedByOther.user_id !== link.user_id) {
        await admin.from("telegram_link_requests").update({ status: "cancelled", consumed_at: now, telegram_user_id: telegramUserId }).eq("id", link.id);
        await sendMessage(TELEGRAM_BOT_TOKEN, chatId, "This Telegram account is already connected to another CARTEL HQ account.");
        return json({ ok: true });
      }
      const { data: existing } = await admin.from("telegram_connections").select("id,metadata").eq("user_id", link.user_id).maybeSingle();
      const priorMetadata = existing?.metadata && typeof existing.metadata === "object" ? existing.metadata : {};
      const connectionRow = { user_id: link.user_id, telegram_user_id: telegramUserId, telegram_username: typeof from.username === "string" ? from.username : null, first_name: typeof from.first_name === "string" ? from.first_name : null, last_name: typeof from.last_name === "string" ? from.last_name : null, connected_at: now, metadata: { ...priorMetadata, link_source: "bot_start", last_linked_at: now } };
      const { error: upsertError } = await admin.from("telegram_connections").upsert(connectionRow, { onConflict: "user_id" });
      if (upsertError) throw upsertError;
      await admin.from("telegram_link_requests").update({ status: "connected", consumed_at: now, telegram_user_id: telegramUserId, metadata: { ...(link.metadata ?? {}), telegram_username: from.username ?? null } }).eq("id", link.id);
      const betaExisting = await getUserBetaContact(telegramUserId);
      if (betaExisting) await touchUserContact(from, { source: betaExisting.source ?? "private_start", isLinkedUser: true });
      await sendMessage(TELEGRAM_BOT_TOKEN, chatId, "✅ Telegram connected to CARTEL HQ. You can return to CARTEL HQ now.");
      return json({ ok: true });
    }

    if (chat?.type !== "private") return json({ ok: true });

    const betaJoinMatch = text.match(/^\/start(?:@\w+)?\s+beta_join_g_([n0-9]+)$/i);
    const betaRoadmapMatch = text.match(/^\/start(?:@\w+)?\s+beta_roadmap_g_([n0-9]+)$/i);
    if (betaJoinMatch || betaRoadmapMatch) {
      const encoded = String(betaJoinMatch?.[1] ?? betaRoadmapMatch?.[1] ?? "");
      const sourceChatId = decodeChatId(encoded);
      const sourceContext = await getSourceGroupContext(sourceChatId);
      const linked = await getLinkedUser(String(from.id));
      if (betaJoinMatch) {
        if (linked?.user_id) {
          const prior = await getUserBetaContact(String(from.id));
          if (prior) await touchUserContact(from, { source: prior.source ?? "group_button", sourceChatId, sourceChatTitle: sourceContext.title, sourceChatType: sourceContext.type, isLinkedUser: true, cta: "early_access_group_clicked" });
          await sendMessage(TELEGRAM_BOT_TOKEN, chatId, `<b>Your Telegram is already connected to Cartel HQ ✅</b>\n\nYou're already inside the Cartel HQ ecosystem. Use /roadmap to see what is coming next.`, { parse_mode: "HTML", reply_markup: betaKeyboard(false) });
          return json({ ok: true });
        }
        await touchUserContact(from, { source: "group_roadmap", sourceChatId, sourceChatTitle: sourceContext.title, sourceChatType: sourceContext.type, optedIn: true, welcomeSent: true, cta: "early_access_group_clicked" });
        await sendMessage(TELEGRAM_BOT_TOKEN, chatId, `<b>You're on the Cartel HQ Early Access list ✅</b>\n\nWe'll let you know through @${BOT_USERNAME} as new Private Beta capabilities become available.\n\nFollow the PEPECARTEL ecosystem below while we build.`, { parse_mode: "HTML", reply_markup: betaKeyboard(false) });
        return json({ ok: true });
      }
      if (!linked?.user_id) await touchUserContact(from, { source: "roadmap", sourceChatId, sourceChatTitle: sourceContext.title, sourceChatType: sourceContext.type, welcomeSent: true, cta: "roadmap_group_clicked" });
      await sendMessage(TELEGRAM_BOT_TOKEN, chatId, roadmapText(), { parse_mode: "HTML", reply_markup: betaKeyboard(!linked?.user_id) });
      return json({ ok: true });
    }

    if (/^\/start(?:@\w+)?$/i.test(text)) {
      const telegramUserId = String(from.id);
      const linked = await getLinkedUser(telegramUserId);
      if (linked?.user_id) {
        const betaExisting = await getUserBetaContact(telegramUserId);
        if (betaExisting) await touchUserContact(from, { source: betaExisting.source ?? "private_start", isLinkedUser: true, cta: "start_menu_opened" });
        await sendMessage(TELEGRAM_BOT_TOKEN, chatId, startMenuText(true), { parse_mode: "HTML", reply_markup: startMenuKeyboard(true) });
        return json({ ok: true });
      }
      const existing = await getUserBetaContact(telegramUserId);
      await touchUserContact(from, { source: existing?.source ?? "private_start", welcomeSent: shouldSendWelcome(existing?.welcome_sent_at), cta: "start_menu_opened" });
      await sendMessage(TELEGRAM_BOT_TOKEN, chatId, startMenuText(false), { parse_mode: "HTML", reply_markup: startMenuKeyboard(false) });
      return json({ ok: true });
    }

    return json({ ok: true });
  } catch (err) {
    console.error("[telegram-webhook]", err instanceof Error ? err.message : "unknown error");
    return json({ ok: true });
  }
});
