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
let webhookConfiguredAt = 0;

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
/**
 * Result-aware send used only by the private Launch Watch deep-link confirmation.
 *
 * Classification is deliberately conservative: anything that is not a parsed
 * Telegram rejection or a parsed ok:true is `ambiguous`, because the message may
 * still have been delivered. Ambiguous outcomes are never auto-resent.
 */
type SendOutcome =
  | { status: "sent"; messageId: number | null }
  | { status: "failed"; errorClass: string; detail: string }
  | { status: "ambiguous"; errorClass: string; detail: string };

async function sendMessageWithOutcome(
  token: string,
  chatId: string,
  text: string,
  extra: Record<string, unknown> = {},
): Promise<SendOutcome> {
  const bound = (value: unknown) => String(value ?? "").slice(0, 300);
  let res: Response;
  try {
    res = await fetch(`${TG_BASE}/bot${token}/sendMessage`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ chat_id: chatId, text, disable_web_page_preview: true, ...extra }),
      signal: AbortSignal.timeout(TELEGRAM_TIMEOUT_MS),
    });
  } catch (error) {
    return { status: "ambiguous", errorClass: "uncertain_outcome", detail: bound((error as Error)?.message ?? "Telegram request did not complete.") };
  }
  const payload = await res.json().catch(() => null) as any;
  if (payload && payload.ok === true) {
    const messageId = Number(payload?.result?.message_id);
    return { status: "sent", messageId: Number.isFinite(messageId) ? messageId : null };
  }
  if (payload && payload.ok === false) {
    return { status: "failed", errorClass: "telegram_rejected", detail: bound(payload?.description ?? `Telegram rejected the message (${res.status}).`) };
  }
  return { status: "ambiguous", errorClass: "uncertain_outcome", detail: bound(`Unparseable Telegram response (${res.status}).`) };
}

async function answerCallback(token: string, callbackId: string, text: string) {
  try { await telegramJson(token, "answerCallbackQuery", { callback_query_id: callbackId, text, show_alert: false }); } catch { }
}

/**
 * SE-8 — LIVE BOT PERMISSION PREFLIGHT.
 *
 * The frozen Link Finder lifecycle REQUIRES the bot to delete the source post
 * and (unless auto-pin is disabled) to pin the canonical card. Those rights are
 * read live from Telegram BEFORE a mission is created, so a mission that could
 * never satisfy its own lifecycle is never created in the first place.
 *
 * Only non-sensitive facts are produced here: membership status and two
 * booleans. No token, header, key or raw payload ever leaves this helper.
 */
let cachedBotUserId: number | null = null;
async function resolveBotUserId(token: string): Promise<number | null> {
  if (cachedBotUserId !== null) return cachedBotUserId;
  try {
    const me = await telegramJson(token, "getMe");
    const id = Number((me as { id?: unknown } | null)?.id ?? NaN);
    if (Number.isFinite(id) && id > 0) cachedBotUserId = id;
  } catch {
    return null;
  }
  return cachedBotUserId;
}

type BotChatPermissions = {
  /** False whenever Telegram could not be asked; never treated as "allowed". */
  resolved: boolean;
  status: string;
  isAdmin: boolean;
  canDeleteMessages: boolean;
  canPinMessages: boolean;
  checkedAt: string;
};

async function readBotChatPermissions(
  token: string,
  chatId: string | number,
): Promise<BotChatPermissions> {
  const checkedAt = new Date().toISOString();
  const blank: BotChatPermissions = {
    resolved: false,
    status: "",
    isAdmin: false,
    canDeleteMessages: false,
    canPinMessages: false,
    checkedAt,
  };
  const botId = await resolveBotUserId(token);
  if (botId === null) return blank;
  try {
    const member = await telegramJson(token, "getChatMember", { chat_id: chatId, user_id: botId });
    const row = (member ?? {}) as {
      status?: unknown;
      can_delete_messages?: unknown;
      can_pin_messages?: unknown;
    };
    const status = String(row.status ?? "");
    const isAdmin = status === "administrator" || status === "creator";
    // A creator holds every right implicitly and Telegram omits the flags.
    const creator = status === "creator";
    return {
      resolved: true,
      status,
      isAdmin,
      canDeleteMessages: creator || (isAdmin && row.can_delete_messages === true),
      canPinMessages: creator || (isAdmin && row.can_pin_messages === true),
      checkedAt,
    };
  } catch {
    return blank;
  }
}

/** Bounded, secret-free diagnostic line for a required lifecycle objective. */
function boundedReason(value: unknown): string {
  return String(value ?? "").replace(/\s+/g, " ").slice(0, 200);
}

/**
 * SE-10 — BOUNDED, SECRET-FREE START LATENCY INSTRUMENTATION.
 *
 * Records elapsed milliseconds between named phases of the START path only.
 * It never touches a token, header, auth payload, Telegram body, user identity
 * or X bearer: every emitted value is a phase name and an integer duration.
 */
function se10Timer() {
  const slices: string[] = [];
  let mark = Date.now();
  return {
    slice(name: string) {
      const now = Date.now();
      slices.push(`${name}=${now - mark}ms`);
      mark = now;
    },
    log(label: string) {
      if (slices.length === 0) return;
      console.log(`[SE-10] ${label} ${slices.join(" ")}`);
    },
  };
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

/**
 * SE-4A — `/mission <X link>` zero-X-read launcher helpers.
 *
 * This command NEVER reads the X API. Everything the mission is created from is
 * derived from the exact link an authorized admin typed, and any link that is
 * not a plain public X/Twitter status URL is rejected outright.
 */
const MISSION_X_HOSTS = ["x.com", "www.x.com", "twitter.com", "www.twitter.com", "mobile.twitter.com"];

type ParsedXStatus = { handle: string; postId: string; canonicalUrl: string };

function parseXStatusUrl(raw: string): ParsedXStatus | null {
  const value = String(raw ?? "").trim();
  if (!value || value.length > 2048) return null;
  let url: URL;
  try { url = new URL(value); } catch { return null; }
  if (url.protocol !== "https:") return null;
  // No credentials and no explicit port: nothing that can smuggle another host.
  if (url.username || url.password || url.port) return null;
  if (!MISSION_X_HOSTS.includes(url.hostname.toLowerCase())) return null;
  // Trailing slash and query string are canonicalised away here.
  const segments = url.pathname.split("/").filter((segment) => segment.length > 0);
  if (segments.length !== 3) return null;
  const handle = String(segments[0]).toLowerCase();
  if (String(segments[1]).toLowerCase() !== "status") return null;
  // `i/web/status/...` and every other non-handle path shape fails here.
  if (!/^[a-z0-9_]{1,15}$/.test(handle) || handle === "i") return null;
  const postId = String(segments[2]);
  if (!/^[0-9]{1,32}$/.test(postId)) return null;
  return { handle, postId, canonicalUrl: `https://x.com/${handle}/status/${postId}` };
}

/** The workspace's official X handle, taken only from the canonical profile. */
function officialXHandle(xUrl: unknown): string | null {
  if (typeof xUrl !== "string") return null;
  const match = xUrl.trim().match(/^https?:\/\/(?:www\.|mobile\.)?(?:x|twitter)\.com\/@?([A-Za-z0-9_]{1,15})(?:[/?#].*)?$/i);
  return match ? String(match[1]).toLowerCase() : null;
}

/**
 * Deterministic RFC-4122-shaped request id derived from the Telegram update id.
 * A Telegram webhook retry of the SAME update therefore produces the SAME
 * clientRequestId, so the transport's own idempotency absorbs it instead of
 * producing a second mission card.
 */
async function missionRequestUuid(updateId: number) {
  const hex = await sha256Hex(`cartelhq-mission-send:${updateId}`);
  const chars = hex.slice(0, 32).split("");
  chars[12] = "5";
  chars[16] = ["8", "9", "a", "b"][parseInt(hex[16], 16) % 4];
  const h = chars.join("");
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20, 32)}`;
}

const MISSION_USAGE = "Usage: /mission https://x.com/&lt;official handle&gt;/status/&lt;id&gt;\n\nOnly a public X post link from this project's official X account can start a Social Mission, and only current group admins can run it.";
const BARE_MISSION_LAUNCHER_TEXT = "🚀 <b>START A SOCIAL MISSION</b>\n\nSend or paste the official X post you want this community to engage with.\n\nOnly posts from this project's verified X account can be used.\n\n<b>Paste the X link below.</b>";
function sendBareMissionLauncher(token: string, chatId: string) {
  return sendMessage(token, chatId, BARE_MISSION_LAUNCHER_TEXT, { parse_mode: "HTML" });
}
/**
 * SE-12.2 — send the bare `/mission` launcher, then delete ONLY the exact bare
 * command message, and only after Telegram confirms the launcher was sent.
 *
 * Ordering is the safety property: a failed launcher send (null result) leaves
 * the original command untouched, and a failed deletion never alters the
 * launcher and never produces a second chat message — only a bounded,
 * secret-free diagnostic log.
 */
async function sendBareMissionLauncherAndCleanup(
  token: string,
  chatId: string,
  sourceMessageId: number | null | undefined,
) {
  const sent = await sendBareMissionLauncher(token, chatId);
  if (!sent) return null;
  const messageId = Number(sourceMessageId);
  if (!Number.isFinite(messageId) || messageId <= 0) return sent;
  try {
    await telegramJson(token, "deleteMessage", { chat_id: chatId, message_id: messageId });
  } catch (error) {
    console.log(`[SE-12.2] bare mission command cleanup failed: ${String((error as Error)?.message ?? "unknown").slice(0, 200)}`);
  }
  return sent;
}

/**
 * SE-15 — `/mission manage` GROUP LAUNCHER.
 *
 * Mission Control is an ADMIN surface, so the group never receives a single
 * mutating control. The group only ever gets a short admin-oriented notice and
 * a deep link into the bot's private chat, where a real, identifiable Telegram
 * user identity exists. This is also what makes the command safe for Telegram
 * anonymous admins: the anonymous message can open the door, but only the
 * identifiable private-chat user can actually change anything.
 *
 * Cleanup mirrors SE-12.2 exactly: the raw command is deleted ONLY after
 * Telegram confirms the launcher was posted, only the exact source message id is
 * touched, and a failed deletion produces a bounded, secret-free log and no
 * second chat message.
 */
const MISSION_MANAGE_DEEP_LINK = `https://t.me/${BOT_USERNAME}?start=mission_manage`;
const MISSION_MANAGE_GROUP_TEXT =
  "🛠 <b>MISSION CONTROL</b>\n\nMission targets, timing, ending and cancelling are managed privately by this project's admins.\n\nTap below to open Mission Control in a private chat with the bot.";
async function sendMissionManageLauncherAndCleanup(
  token: string,
  chatId: string,
  sourceMessageId: number | null | undefined,
) {
  const sent = await sendMessage(token, chatId, MISSION_MANAGE_GROUP_TEXT, {
    parse_mode: "HTML",
    reply_markup: {
      inline_keyboard: [[{ text: "🛠 Open Mission Control", url: MISSION_MANAGE_DEEP_LINK }]],
    },
  });
  if (!sent) return null;
  const messageId = Number(sourceMessageId);
  if (!Number.isFinite(messageId) || messageId <= 0) return sent;
  try {
    await telegramJson(token, "deleteMessage", { chat_id: chatId, message_id: messageId });
  } catch (error) {
    console.log(
      `[SE-15] mission manage command cleanup failed: ${String((error as Error)?.message ?? "unknown").slice(0, 200)}`,
    );
  }
  return sent;
}

/** SE-15 — the supporting metrics an operator can target, and their labels. */
const MISSION_CONTROL_METRICS = ["views", "likes", "replies", "reposts", "bookmarks"] as const;
type MissionControlMetric = (typeof MISSION_CONTROL_METRICS)[number];
const MISSION_CONTROL_METRIC_LABELS: Record<MissionControlMetric, string> = {
  views: "👁 Views",
  likes: "❤️ Likes",
  replies: "💬 Replies",
  reposts: "🔁 Reposts",
  bookmarks: "🔖 Bookmarks",
};
/**
 * BOOKMARKS is deliberately absent: the Primary Goal enum does not support it,
 * and SE-15 does not widen accomplishment semantics.
 */
const MISSION_CONTROL_PRIMARY_TYPES = [
  "VIEWS",
  "LIKES",
  "REPLIES",
  "REPOSTS",
  "TOTAL_INTERACTIONS",
] as const;
type MissionControlPrimaryType = (typeof MISSION_CONTROL_PRIMARY_TYPES)[number];
const MISSION_CONTROL_PRIMARY_LABELS: Record<MissionControlPrimaryType, string> = {
  VIEWS: "Views",
  LIKES: "Likes",
  REPLIES: "Replies",
  REPOSTS: "Reposts",
  TOTAL_INTERACTIONS: "Total interactions",
};
/** The supporting metric a Primary Goal pins, or null for TOTAL_INTERACTIONS. */
export function primaryGoalMetric(type: string): MissionControlMetric | null {
  const upper = String(type ?? "").toUpperCase();
  if (upper === "VIEWS") return "views";
  if (upper === "LIKES") return "likes";
  if (upper === "REPLIES") return "replies";
  if (upper === "REPOSTS") return "reposts";
  return null;
}

/**
 * SE-15 — strict numeric input parsing for the pending-field DM prompt.
 *
 * Nothing is mutated on a rejected value. `off` is accepted ONLY for supporting
 * targets; a Primary Goal target and a duration always require a positive
 * integer, and duration is additionally bounded to 1..1440 minutes.
 *
 * PRECISION: outer whitespace is trimmed and thousands COMMAS are removed, so
 * `12,500` is honoured. Internal SPACES are NOT removed — `1 2` is two numbers
 * and is rejected rather than silently read as `12`.
 */
export type MissionControlInput =
  | { ok: true; value: number | null }
  | { ok: false; reason: string };
export function parseMissionControlInput(
  field: string,
  raw: string,
): MissionControlInput {
  const text = String(raw ?? "").trim().toLowerCase().replace(/,/g, "");
  const supporting = (MISSION_CONTROL_METRICS as readonly string[]).includes(
    String(field ?? "").toLowerCase(),
  );
  if (supporting && (text === "off" || text === "none")) return { ok: true, value: null };
  if (!/^[0-9]{1,9}$/.test(text)) {
    return {
      ok: false,
      reason: supporting
        ? "Send a whole number above zero, or send off to remove this target."
        : "Send a whole number above zero.",
    };
  }
  const value = Number(text);
  if (!Number.isInteger(value) || value <= 0) {
    return { ok: false, reason: "Send a whole number above zero." };
  }
  if (field === "DURATION_MINUTES" && value > 1440) {
    return { ok: false, reason: "Choose between 1 and 1440 minutes." };
  }
  return { ok: true, value };
}

/** SE-15 — compact "in about N minutes/hours" used by the private panel. */
export function missionControlRemaining(endsAt: unknown, nowMs: number): string {
  if (typeof endsAt !== "string") return "no end time recorded";
  const ms = new Date(endsAt).getTime();
  if (!Number.isFinite(ms)) return "no end time recorded";
  const diff = Math.round((ms - nowMs) / 60000);
  if (diff <= 0) return "ending now";
  if (diff < 60) return `about ${diff} min left`;
  const hours = Math.floor(diff / 60);
  const mins = diff % 60;
  return mins === 0 ? `about ${hours}h left` : `about ${hours}h ${mins}m left`;
}
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
function groupAcquisitionKeyboard(chatId: string, includeEarlyAccess = true) {
  const encoded = encodeChatId(chatId);
  return {
    inline_keyboard: [
      ...(includeEarlyAccess ? [[{ text: "🚀 Join Early Access", url: `https://t.me/${BOT_USERNAME}?start=beta_join_g_${encoded}` }]] : []),
      [
        { text: "💬 PEPECARTEL Community", url: PEPECARTEL_TELEGRAM },
        { text: "𝕏 Follow PEPECARTEL", url: PEPECARTEL_X },
      ],
      [
        { text: "🌐 PEPECARTEL Website", url: PEPECARTEL_WEBSITE },
        { text: "🗺 Cartel HQ Roadmap", url: `https://t.me/${BOT_USERNAME}?start=beta_roadmap_g_${encoded}` },
      ],
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
  return `<b>CARTEL HQ • ECOSYSTEM ROADMAP</b>

Cartel HQ is evolving from community tooling into an operating system for launching and running onchain projects.

<b>✅ BUILT FOUNDATION</b>

🎨 <b>Brand &amp; Creative</b>
• AI Sticker Lab
• Telegram sticker-pack publishing
• Native sticker delivery
• Multi-group distribution
• Brand Kit &amp; asset management
• Scheduled Sticker Drops
• Motion sticker workflow foundation

🏘 <b>Community Operations</b>
• Multi-community Telegram connections
• Welcome &amp; onboarding automation
• Launch Watch CTA in community onboarding
• Official Community Broadcast
• Two-way Project Inbox
• Team Bot Console
• Project-to-subscriber updates

🚀 <b>Launch Infrastructure</b>
• Project Identity &amp; Launch Control
• Launch Watch opt-in network
• 24h &amp; 1h countdown reminders
• Schedule-change communication
• Launch-live alerts
• Deployment evidence verification
• Official contract registration
• Official CA delivery to Launch Watch subscribers
• Official CA Telegram group broadcast
• Contract correction + immutable history
• Launch monitoring handoff

🌐 <b>Cartel Network</b>
• Public project discovery
• Public launch pages
• Upcoming launches
• Cartel Signals event feed

⛓ <b>Robinhood Chain Launcher Foundation</b>
• Wallet connection + network switching
• Robinhood Chain Testnet launch preflight
• Fixed-supply ERC-20 deployment
• Onchain deployment verification
• Launch receipt
• Official-contract + Launch Watch handoff

<b>🚧 CURRENT PRODUCTION WORK</b>

Robinhood Chain Mainnet readiness:
• Production wallet/gas safeguards
• Mainnet deployment verification
• Verified liquidity execution path
• Liquidity receipt/evidence
• Full real-money launch checklist

Testnet liquidity execution remains deferred until the required AMM infrastructure can be authoritatively verified. We will not invent contract addresses just to call it finished.

<b>🔜 NEXT PRODUCT LAYERS</b>
• Public Cartel Launchpad
• Cartel Verified Launch / Launch Passport experience
• My Watchlist
• Expanded analytics, reputation &amp; Cartel Shield
• Distribution and marketing expansion
• Operations &amp; Missions
• Cartel AI Operator
• Deeper ecosystem integrations

<b>THE VISION</b>
Before the launch. During the launch. After the launch.

One project. One operating system.

<b>CARTEL HQ.</b>

Launch Watch is opt-in and can be muted or stopped. Deployment verification confirms specific recorded onchain evidence. It is not a token/project safety audit, endorsement, guarantee or investment recommendation.`;
}
function helpText(isGroup: boolean) {
  return isGroup
    ? `<b>CARTEL HQ BOT • PRIVATE BETA</b>\n\nCurrent group capabilities include community join welcomes with optional auto-delete, Telegram sticker-pack distribution and native sticker delivery. Additional community tools are in development.\n\n<b>Commands</b>\n/roadmap — see what's live and what's coming\n/mission &lt;X link&gt; — start a Social Mission (admins only)\n/mission close — close the active Social Mission (admins only)\n/mission manage — open private Mission Control (admins only)\n/help — show this guide\n\nAdmins can follow PEPECARTEL and join Early Access through @${BOT_USERNAME}.`
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
        { command: "mission", description: "Start a Social Mission from an X post" },
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
/**
 * Conservative self-heal: Telegram only delivers `callback_query` updates when
 * the registered webhook explicitly allows them. Older registrations allowed
 * only message/my_chat_member, which silently broke every inline button.
 * Re-registers the SAME url + SAME derived secret, changing only allowed_updates.
 * Best-effort and throttled; never fails normal webhook processing.
 */
async function ensureWebhookUpdates(token: string, supabaseUrl: string) {
  if (Date.now() - webhookConfiguredAt < 6 * 60 * 60 * 1000) return;
  webhookConfiguredAt = Date.now();
  try {
    const secret = await webhookSecret(token);
    const info = await telegramJson(token, "getWebhookInfo").catch(() => null) as { url?: string } | null;
    const currentUrl = typeof info?.url === "string" && info.url ? info.url : "";
    const url = currentUrl || `${supabaseUrl.replace(/\/$/, "")}/functions/v1/telegram-webhook`;
    await telegramJson(token, "setWebhook", {
      url,
      secret_token: secret,
      allowed_updates: ["message", "my_chat_member", "callback_query"],
      drop_pending_updates: false,
    });
  } catch (err) {
    console.error("[telegram-webhook] ensureWebhookUpdates", err instanceof Error ? err.message : "unknown error");
  }
}


// --------------------------------------------------------------------------
// Phase 4 — Launch Watch (opt-in only).
// Reuses this one bot and this one webhook. Subscriptions live exclusively in
// public.launch_watch_subscriptions. Telegram identity is never enriched with
// username/name here: telegram_user_id is the only stored identifier.
// --------------------------------------------------------------------------
const LAUNCH_WATCH_OPEN_STATUSES = [
  "WATCHLIST_OPEN",
  "LAUNCH_APPROACHING",
  "CONTRACT_PENDING",
  "OFFICIAL_CONTRACT_REGISTERED",
];
const LAUNCH_STATUS_LABELS: Record<string, string> = {
  DRAFT: "Draft",
  ANNOUNCED: "Announced",
  WATCHLIST_OPEN: "Watchlist open",
  LAUNCH_APPROACHING: "Launch approaching",
  CONTRACT_PENDING: "Contract pending",
  OFFICIAL_CONTRACT_REGISTERED: "Official contract registered",
  LIVE: "Live",
  COMPLETED: "Completed",
};
/**
 * Launch Watch controls.
 * - Active watcher: stop watching, plus a countdown-reminder toggle.
 * - Inactive watcher: "Watch again" is offered ONLY when the launch currently
 *   accepts sign-ups, so the button is never a dead end.
 * - External links are the WATCHED PROJECT's official links only. This is a
 *   multi-project platform: never fall back to PEPECARTEL links here.
 */
function isHttpUrlValue(value: unknown): value is string {
  if (typeof value !== "string" || !value.trim()) return false;
  try {
    const url = new URL(value.trim());
    return url.protocol === "https:" || url.protocol === "http:";
  } catch {
    return false;
  }
}

function launchWatchKeyboard(
  token: string,
  watching: boolean,
  remindersEnabled: boolean,
  canRewatch: boolean,
  profile: { website_url?: unknown; telegram_url?: unknown; x_url?: unknown } | null | undefined,
  updatesEnabled: boolean,
) {
  const rows: Array<Array<Record<string, string>>> = [];
  if (watching) {
    rows.push([{ text: "🔕 Stop watching", callback_data: `lw_unwatch_${token}` }]);
    rows.push([
      remindersEnabled
        ? { text: "🔇 Mute countdowns", callback_data: `ln_reminders_off_${token}` }
        : { text: "⏳ Enable countdowns", callback_data: `ln_reminders_on_${token}` },
    ]);
    // Project updates are a SEPARATE preference from countdown reminders.
    rows.push([
      updatesEnabled
        ? { text: "🔇 Mute project updates", callback_data: `ln_updates_off_${token}` }
        : { text: "📣 Enable project updates", callback_data: `ln_updates_on_${token}` },
    ]);
  } else if (canRewatch) {
    rows.push([{ text: "🔔 Watch again", callback_data: `lw_rewatch_${token}` }]);
  }
  const links: Array<Record<string, string>> = [];
  if (isHttpUrlValue(profile?.website_url)) links.push({ text: "🌐 Website", url: String(profile?.website_url).trim() });
  if (isHttpUrlValue(profile?.telegram_url)) links.push({ text: "💬 Telegram", url: String(profile?.telegram_url).trim() });
  if (isHttpUrlValue(profile?.x_url)) links.push({ text: "𝕏 X", url: String(profile?.x_url).trim() });
  for (let i = 0; i < links.length; i += 2) rows.push(links.slice(i, i + 2));
  return { inline_keyboard: rows };
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
  void ensureWebhookUpdates(TELEGRAM_BOT_TOKEN, SUPABASE_URL);

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

  // ---- SE-4A: `/mission <X link>` zero-X-read launcher --------------------
  //
  // Cheapest possible launch path. Authorization is established in this order
  // so the only *live* Telegram round trip happens last, and only for a caller
  // that is already a linked current workspace owner/admin of a connected
  // community. Mission creation itself is ONE atomic service-only RPC that
  // independently re-checks every one of these facts server-side.
  //
  // No X API call, no metric read, no usage_ledger write, no polling, no
  // auto-retry and no duplicated card/photo logic: delivery is always the
  // existing `social-mission-telegram` transport.
  /**
   * SE-9 — LINK FINDER SOURCE CLEANUP, AT DETECTION TIME.
   *
   * The frozen SE-9 UX deletes the ORIGINAL X-link message as soon as the
   * transient START/IGNORE prompt is confirmed sent AND attached to the
   * candidate — no longer only after a successful START. The candidate row is
   * the durable record of that outcome, and its real `telegram_message_id`
   * survives deletion as provenance.
   *
   * Idempotent and honest:
   *   - a candidate already recorded clean costs no Telegram call;
   *   - Telegram definitively reporting the message as absent counts as clean;
   *   - ANY other failure (permission refusal, transport uncertainty) records a
   *     BOUNDED, secret-free diagnostic on the candidate and returns false, so
   *     the prompt and the PENDING candidate stay fully retryable instead of
   *     pretending success;
   *   - a Telegram deletion that the database refuses to persist is a failure.
   */
  const ensureLinkFinderSourceDeleted = async (params: {
    candidateId: string;
    chatId: string;
    sourceMessageId: number;
    alreadyDeletedAt?: string | null;
  }): Promise<boolean> => {
    if (params.alreadyDeletedAt) return true;
    if (!params.candidateId || !(params.sourceMessageId > 0)) return false;

    let removed = false;
    let reason = "";
    try {
      await telegramJson(TELEGRAM_BOT_TOKEN, "deleteMessage", {
        chat_id: params.chatId,
        message_id: params.sourceMessageId,
      });
      removed = true;
    } catch (error) {
      reason = boundedReason((error as Error)?.message);
      // ONLY a definitive "it is already gone" counts as clean.
      removed = /message to delete not found|message_id_invalid/i.test(reason);
    }

    const { data: recorded, error: recordError } = await admin.rpc(
      "record_social_mission_link_candidate_source_cleanup",
      {
        _candidate_id: params.candidateId,
        _deleted: removed,
        _reason: removed ? null : (reason || "source deletion failed"),
      },
    );

    if (!removed) {
      console.warn(`[SE-9] link finder source deletion failed: ${reason || "unresolved"}`);
      return false;
    }
    const outcome = String(((recorded ?? {}) as { outcome?: unknown })?.outcome ?? "");
    if (recordError || (outcome !== "CLEAN" && outcome !== "ALREADY_CLEAN")) {
      console.warn(
        `[SE-9] source deletion not persisted: ${boundedReason(recordError?.message ?? outcome)}`,
      );
      return false;
    }
    return true;
  };

  const runMissionCommand = async (args: {
    chatId: string;
    chatType: string;
    updateId: unknown;
    messageId: unknown;
    telegramUserId: number;
    argument: string;
    /** SE-5 provenance only. Authorization is identical for every source. */
    source?: "telegram_mission_command" | "telegram_link_finder";
    /**
     * SE-7 — invoked ONLY when this community now genuinely holds a delivered
     * mission card: either this call confirmed the send AND activated the
     * schedule (`ACTIVATED`), or a retry found the card already sent
     * (`ALREADY_SENT`) and must not send a second one. Every other path — a
     * rejection, a failed create, a failed/ambiguous delivery, a failed
     * activation — leaves it uncalled, so the caller's own state stays
     * retryable.
     */
    onMissionSettled?: (settled: {
      kind: "ACTIVATED" | "ALREADY_SENT";
      missionId: string;
      targetId: string;
    }) => Promise<void>;
    /**
     * SE-8 — the live bot permission preflight refused BEFORE any mission was
     * created or recovered. Nothing was mutated: the caller's candidate, its
     * prompt and the source post all stay exactly as they were.
     */
    onPermissionBlocked?: (
      text: string,
      /**
       * SE-10 — the exact, dynamic reason, so the caller can render a visible
       * ACTION REQUIRED state naming the precise missing right(s).
       */
      detail?: { kind: "UNRESOLVED" | "NOT_ADMIN" | "MISSING_RIGHTS"; missing: string[] },
    ) => Promise<void>;
    /**
     * SE-8 — preflight passed and the mission launch is now starting. Used for
     * immediate START feedback while the first real X snapshot is fetched. It
     * never claims success.
     */
    onStartAccepted?: () => Promise<void>;
  }) => {

    const { chatId, chatType, telegramUserId, argument } = args;
    const reply = (text: string) => sendMessage(TELEGRAM_BOT_TOKEN, chatId, text, { parse_mode: "HTML" });

    if (chatType !== "group" && chatType !== "supergroup") {
      await reply("Social Missions run inside a connected Cartel HQ community group.");
      return;
    }

    const updateId = Number(args.updateId);
    const messageId = Number(args.messageId);
    const numericChatId = Number(chatId);
    if (!Number.isFinite(updateId) || !Number.isFinite(messageId) || !Number.isFinite(numericChatId)) {
      await reply("This command could not be processed.");
      return;
    }

    const isLinkFinder = args.source === "telegram_link_finder";

    /**
     * SE-9 — Link Finder SOURCE CLEANUP MOVED TO DETECTION.
     *
     * The original X-link post is now deleted the moment the transient
     * START/IGNORE prompt is confirmed sent and attached to the candidate, and
     * the outcome is recorded durably on the candidate row itself. START
     * therefore no longer waits on, gates on, or re-runs source deletion here:
     * by the time this function runs the post is already gone (or the
     * candidate carries a bounded retryable diagnostic and the callback has
     * re-attempted the deletion before launching).
     *
     * Raw `/mission <link>` command cleanup is UNCHANGED and still governed by
     * the workspace `delete_command_after_send` preference further below.
     */

    /**
     * SE-8 — IDEMPOTENT CANONICAL PIN.
     *
     * Pins the EXACT canonical mission card — never the source X link and never
     * the transient START/IGNORE prompt. The stored target row is authoritative:
     *
     *   - a target already recorded as `pinned_by_hq` costs no Telegram call;
     *   - auto-pin disabled means the objective is not required at all;
     *   - `record_social_mission_target_pin(..., true)` is written ONLY after
     *     Telegram confirms the pin, and its failure to persist is a failure;
     *   - permission refusal or transport uncertainty is FALSE, never success.
     */
    const ensureCanonicalMissionPin = async (
      targetId: string,
      autoPinEnabled: boolean,
      fallbackMessageId: number | null,
    ): Promise<boolean> => {
      if (!autoPinEnabled) return true;
      if (!targetId) return false;

      const { data: pinRow, error: pinReadError } = await admin
        .from("social_mission_targets")
        .select("pinned_by_hq, telegram_message_id")
        .eq("id", targetId)
        .maybeSingle();
      if (pinReadError) return false;
      const target = pinRow as
        | { pinned_by_hq?: boolean | null; telegram_message_id?: number | null }
        | null;
      if (target?.pinned_by_hq === true) return true;

      const cardMessageId = Number(target?.telegram_message_id ?? fallbackMessageId ?? NaN);
      if (!Number.isFinite(cardMessageId) || cardMessageId <= 0) return false;

      let pinned = false;
      try {
        await telegramJson(TELEGRAM_BOT_TOKEN, "pinChatMessage", {
          chat_id: chatId,
          message_id: cardMessageId,
          disable_notification: true,
        });
        pinned = true;
      } catch (error) {
        // ONLY Telegram's definitive "nothing changed" counts as already-pinned.
        const detail = boundedReason((error as Error)?.message);
        pinned = /message is not modified|chat not modified|chat_not_modified/i.test(detail);
        if (!pinned) console.warn(`[SE-8] canonical pin refused: ${detail}`);
      }
      if (!pinned) return false;

      const { error: recordError } = await admin.rpc("record_social_mission_target_pin", {
        _target_id: targetId,
        _pinned: true,
      });
      if (recordError) {
        console.warn(`[SE-8] pin recorded in Telegram but not persisted: ${boundedReason(recordError.message)}`);
        return false;
      }
      return true;
    };





    // SE-4B — `/mission close` shares the exact same authorization chain and
    // reads no X link at all.
    const isClose = String(argument ?? "").trim().toLowerCase() === "close";

    const parsed = isClose ? null : parseXStatusUrl(argument);
    if (!isClose && !parsed) {
      await reply(MISSION_USAGE);
      return;
    }

    // 1. The exact chat must already be a connected community.
    const { data: connection } = await admin
      .from("telegram_group_connections")
      .select("id,workspace_id")
      .eq("telegram_chat_id", chatId)
      .maybeSingle();
    if (!connection?.workspace_id) {
      await reply("This community is not connected to Cartel HQ yet.");
      return;
    }

    // 2. The sender must be linked to a Cartel HQ account.
    const linked = await getLinkedUser(String(telegramUserId));
    if (!linked?.user_id) {
      await reply(`Connect your Telegram account to Cartel HQ through @${BOT_USERNAME} first.`);
      return;
    }

    // 3. …and be a current owner/admin of that workspace.
    const { data: isOperator, error: operatorError } = await admin.rpc("is_workspace_operator", {
      _workspace_id: connection.workspace_id,
      _user_id: linked.user_id,
    });
    if (operatorError || isOperator !== true) {
      await reply("Only this project's Cartel HQ owners and admins can start a Social Mission.");
      return;
    }

    // 4. …and be a CURRENT Telegram administrator/creator, verified live.
    let memberStatus = "";
    try {
      const member = await telegramJson(TELEGRAM_BOT_TOKEN, "getChatMember", { chat_id: chatId, user_id: telegramUserId });
      memberStatus = String((member as { status?: unknown })?.status ?? "");
    } catch {
      await reply("Telegram could not confirm your group role right now. Try again shortly.");
      return;
    }
    if (memberStatus !== "administrator" && memberStatus !== "creator") {
      await reply("Only current administrators of this group can start a Social Mission.");
      return;
    }

    // SE-4B — `/mission close`. Admin-only, zero X reads, no new mission and
    // no replacement message. The DATABASE lifecycle is authoritative: the
    // close RPC completes the mission and cancels remaining pulses first, and
    // the single same-message edit is attempted afterwards. A failed or
    // ambiguous edit never reverts the completion.
    if (isClose) {
      const { data: closed, error: closeError } = await admin.rpc("close_social_mission_from_telegram", {
        _telegram_chat_id: numericChatId,
        _telegram_user_id: telegramUserId,
      });
      const closeResult = (closed ?? null) as
        | {
          outcome?: string;
          reason?: string;
          event_state?: string;
          workspace_id?: string;
          mission_id?: string;
          target_id?: string;
          event_id?: string;
          client_request_id?: string;
          edit_revision?: number;
          actor_user_id?: string;
        }
        | null;
      if (closeError || !closeResult?.outcome) {
        await reply("This Social Mission could not be closed right now.");
        return;
      }
      if (closeResult.outcome === "NO_ACTIVE_MISSION") {
        await reply("There is no active Social Mission in this community.");
        return;
      }
      if (closeResult.outcome === "ALREADY_COMPLETED") {
        await reply("This Social Mission is already closed.");
        return;
      }
      if (closeResult.outcome === "UNRESOLVED") {
        // Another worker holds this completion right now. Never a second edit.
        await reply("This Social Mission is already being closed. Do not retry.");
        return;
      }
      if (closeResult.outcome === "COMPLETED_UNSYNCED") {
        // Terminal delivery-sync state: closed in Cartel HQ, card not updated.
        // Never retried and never replaced.
        await reply("This Social Mission is closed. Its mission card could not be updated in place; do not resend it.");
        return;
      }
      if (closeResult.outcome !== "CLOSED") {
        const reason = String(closeResult.reason ?? "");
        await reply(
          reason === "actor_not_operator"
            ? "Only this project's Cartel HQ owners and admins can close a Social Mission."
            : reason === "actor_not_linked"
              ? `Connect your Telegram account to Cartel HQ through @${BOT_USERNAME} first.`
              : reason === "group_not_connected"
                ? "This community is not connected to Cartel HQ yet."
                : "This Social Mission could not be closed right now.",
        );
        return;
      }

      // Exactly one same-message edit through the existing transport, using
      // the deterministic request id stored on the completion event.
      let closeTransport: { editState?: string } | null = null;
      try {
        const response = await fetch(`${SUPABASE_URL.replace(/\/$/, "")}/functions/v1/social-mission-telegram`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            apikey: SERVICE_KEY,
            Authorization: `Bearer ${SERVICE_KEY}`,
            "X-Cartel-Internal-Source": "telegram-webhook",
            "X-Cartel-Actor-User-Id": String(closeResult.actor_user_id ?? linked.user_id),
          },
          body: JSON.stringify({
            action: "edit_mission",
            workspaceId: closeResult.workspace_id,
            missionId: closeResult.mission_id,
            targetId: closeResult.target_id,
            clientRequestId: closeResult.client_request_id,
            revision: Number(closeResult.edit_revision ?? 0) + 1,
          }),
          signal: AbortSignal.timeout(30_000),
        });
        closeTransport = (await response.json().catch(() => null)) as typeof closeTransport;
      } catch {
        closeTransport = null;
      }

      // The manual close finalizes its OWN completion event exactly once, so
      // the runner never picks it up again five minutes later. A finalizer
      // failure never triggers a second Telegram attempt, never sends a
      // replacement and never reverts the completion already persisted.
      const closeEditState = String(closeTransport?.editState ?? "");
      const finalState = closeEditState === "EDITED" ? "SENT" : closeEditState === "FAILED" ? "FAILED" : "AMBIGUOUS";
      const { data: finalized, error: finalizeError } = await admin.rpc("finish_social_mission_schedule_event", {
        _event_id: closeResult.event_id,
        _state: finalState,
        _telegram_message_id: null,
        _last_error: finalState === "SENT" ? null : "The manual close edit was not confirmed.",
      });
      const finalizedOk = !finalizeError && finalized === true;

      // SE-5 — unpin ONLY a pin CARTEL HQ itself recorded. A pin the community
      // set by hand is never touched.
      try {
        const { data: pinRow } = await admin
          .from("social_mission_targets")
          .select("pinned_by_hq, telegram_message_id")
          .eq("id", closeResult.target_id as string)
          .maybeSingle();
        const pinned = pinRow as { pinned_by_hq?: boolean; telegram_message_id?: number } | null;
        if (pinned?.pinned_by_hq === true && typeof pinned.telegram_message_id === "number") {
          const unpinned = await telegramJson(TELEGRAM_BOT_TOKEN, "unpinChatMessage", {
            chat_id: chatId,
            message_id: pinned.telegram_message_id,
          }).then(() => true).catch(() => false);
          if (unpinned) {
            await admin.rpc("record_social_mission_target_pin", {
              _target_id: closeResult.target_id,
              _pinned: false,
            });
          }
        }
      } catch {
        // Cosmetic only. A pin left in place never blocks the close.
      }

      if (closeEditState === "EDITED") {
        await reply(
          finalizedOk
            ? "This Social Mission is closed. The mission card above has been updated."
            : "This Social Mission is closed and its card was updated, but the delivery record could not be saved. Do not resend it.",
        );
        return;
      }
      // Completion already persisted. Never resend, never revert.
      await reply("This Social Mission is closed. The mission card could not be updated in place; do not resend it.");
      return;
    }

    // ---- SE-8. LIVE BOT PERMISSION PREFLIGHT -------------------------------
    //
    // Runs BEFORE mission creation AND before an ALREADY_SENT recovery, so a
    // mission that cannot satisfy its frozen canonical lifecycle is never
    // created, and a retry after the rights are corrected can complete it.
    //
    // Actor authorization above is untouched: this checks only what the BOT
    // itself may do in this exact chat.
    const { data: settingsRow } = await admin
      .from("social_mission_settings")
      .select("delete_command_after_send, auto_pin_mission")
      .eq("workspace_id", connection.workspace_id)
      .maybeSingle();
    const workspaceSettings = (settingsRow ?? null) as
      | { delete_command_after_send?: boolean | null; auto_pin_mission?: boolean | null }
      | null;
    // Defaults ON, exactly as the frozen Step 1 experience specifies.
    const autoPinRequired = workspaceSettings?.auto_pin_mission !== false;
    // Link Finder source cleanup is MANDATORY and preference-independent; raw
    // `/mission <link>` cleanup stays governed by the workspace preference.
    const deletionRequired = isLinkFinder
      ? true
      : workspaceSettings?.delete_command_after_send !== false;

    // SE-10 — phase timing only. Started here so the preflight, the create
    // RPC, the real-metrics card send and the schedule/pin phase are each
    // attributable. No secret, payload or identity is ever recorded.
    const timing = se10Timer();
    const botPermissions = await readBotChatPermissions(TELEGRAM_BOT_TOKEN, chatId);
    timing.slice("preflight");
    // Non-sensitive diagnostics only: status, two booleans and a timestamp.
    try {
      const { data: metaRow } = await admin
        .from("telegram_group_connections")
        .select("metadata")
        .eq("id", connection.id)
        .maybeSingle();
      const existingMeta = ((metaRow as { metadata?: Record<string, unknown> } | null)?.metadata
        ?? {}) as Record<string, unknown>;
      await admin
        .from("telegram_group_connections")
        .update({
          metadata: {
            ...existingMeta,
            bot_permissions_checked_at: botPermissions.checkedAt,
            bot_status: botPermissions.status,
            bot_is_admin: botPermissions.isAdmin,
            bot_can_delete_messages: botPermissions.canDeleteMessages,
            bot_can_pin_messages: botPermissions.canPinMessages,
          },
        })
        .eq("id", connection.id);
    } catch {
      // Diagnostics are never allowed to block or alter the decision below.
    }

    const blockLaunch = async (
      text: string,
      detail: { kind: "UNRESOLVED" | "NOT_ADMIN" | "MISSING_RIGHTS"; missing: string[] },
    ) => {
      timing.log(isLinkFinder ? "link_finder_start_blocked" : "mission_command_blocked");
      if (args.onPermissionBlocked) await args.onPermissionBlocked(text, detail);
      else await reply(text);
    };

    if (!botPermissions.resolved) {
      await blockLaunch(
        `Telegram could not confirm @${BOT_USERNAME}'s permissions in this group right now. Try again shortly.`,
        { kind: "UNRESOLVED", missing: [] },
      );
      return;
    }
    if (!botPermissions.isAdmin) {
      await blockLaunch(
        `CARTEL HQ needs @${BOT_USERNAME} to be an administrator of this group before a Social Mission can start.`,
        { kind: "NOT_ADMIN", missing: [] },
      );
      return;
    }
    const missingRights: string[] = [];
    if (deletionRequired && !botPermissions.canDeleteMessages) missingRights.push("Delete Messages");
    if (autoPinRequired && !botPermissions.canPinMessages) missingRights.push("Pin Messages");
    if (missingRights.length > 0) {
      console.warn(`[SE-8] mission launch blocked: missing ${boundedReason(missingRights.join(", "))}`);
      await blockLaunch(
        `CARTEL HQ needs ${missingRights.join(" and ")} enabled for @${BOT_USERNAME} in this group before a Social Mission can start.`,
        { kind: "MISSING_RIGHTS", missing: missingRights },
      );
      return;
    }

    // Preflight passed. Acknowledge immediately — the first canonical card
    // still waits for a REAL official-X snapshot, which is never prefetched.
    await args.onStartAccepted?.();
    timing.slice("start_feedback");


    // 5. One atomic service-only RPC. It re-authorizes everything above and
    //    verifies the official X handle independently before creating rows.
    const { data: created, error: createError } = await admin.rpc("create_social_mission_from_telegram_link", {
      _telegram_update_id: updateId,
      _telegram_chat_id: numericChatId,
      _telegram_message_id: messageId,
      _telegram_user_id: telegramUserId,
      _canonical_url: parsed!.canonicalUrl,
      _external_post_id: parsed!.postId,
      _author_handle: parsed!.handle,
      // SE-5 provenance only. It never changes authorization or behaviour.
      _source: args.source === "telegram_link_finder" ? "telegram_link_finder" : "telegram_mission_command",
    });
    timing.slice("create_mission");
    const result = (created ?? null) as
      | {
        outcome?: string;
        reason?: string;
        actor_user_id?: string;
        workspace_id?: string;
        mission_id?: string;
        target_id?: string;
        delivery_state?: string;
      }
      | null;
    if (createError || !result?.outcome) {
      await reply("The Social Mission could not be created right now.");
      return;
    }

    if (result.outcome === "REJECTED") {
      const reason = String(result.reason ?? "");
      const message =
        reason === "handle_not_official"
          ? "That post is not from this project's official X account."
          : reason === "official_x_account_missing"
            ? "Add this project's official X account to its Cartel HQ Project Profile first."
            : reason === "actor_not_operator"
              ? "Only this project's Cartel HQ owners and admins can start a Social Mission."
              : reason === "actor_not_linked"
                ? `Connect your Telegram account to Cartel HQ through @${BOT_USERNAME} first.`
                : reason === "group_not_connected"
                  ? "This community is not connected to Cartel HQ yet."
                  : MISSION_USAGE;
      await reply(message);
      return;
    }

    if (result.outcome === "DUPLICATE_UPDATE") {
      // A repeated Telegram delivery of the same command. Never act twice.
      return;
    }

    if (result.outcome !== "CREATED" && result.outcome !== "EXISTING") {
      await reply("The Social Mission could not be resolved. Please do not retry immediately.");
      return;
    }

    const deliveryState = String(result.delivery_state ?? "");
    if (deliveryState === "SENT") {
      // SE-8/SE-9 RECOVERY. The card already exists, so NO second card is ever
      // sent, the schedule is never re-activated and no duplicate Pulse event
      // is ever created. The live permission preflight above has already
      // re-run; this path re-attempts only the REQUIRED pin idempotently. The
      // Link Finder source post was already removed at detection time, so it is
      // no longer part of this gate.
      const retryTargetId = String(result.target_id ?? "");
      const { data: retryConfig } = await admin.rpc("social_mission_effective_config", {
        _mission_id: result.mission_id,
      });
      const retryAutoPin = ((retryConfig ?? {}) as Record<string, unknown>)["auto_pin_mission"] !== false;
      const retryPinned = await ensureCanonicalMissionPin(retryTargetId, retryAutoPin, null);
      timing.slice("recover_pin");
      timing.log(isLinkFinder ? "link_finder_already_sent" : "mission_command_already_sent");
      if (retryPinned) {
        await args.onMissionSettled?.({
          kind: "ALREADY_SENT",
          missionId: String(result.mission_id ?? ""),
          targetId: retryTargetId,
        });
      } else {
        console.warn(
          `[SE-9] already-sent recovery incomplete: pin=${retryPinned}`,
        );
      }
      // SE-8.1 — Link Finder recovery leaves NO extra group text. The frozen UX
      // is: source link gone, transient prompt gone after finalization, branded
      // canonical card remaining. Tap feedback is delivered by the callback, and
      // an incomplete recovery stays diagnostic/retryable instead of chatty.
      // Raw `/mission <link>` retries keep the existing informative reply.
      if (!isLinkFinder) {
        await reply("This post already has a Social Mission in this community.");
      }

      return;
    }

    if (deliveryState === "SENDING" || deliveryState === "AMBIGUOUS") {
      await reply("This mission's delivery is unresolved. Please do not retry immediately.");
      return;
    }
    if (deliveryState !== "PENDING" && deliveryState !== "FAILED") {
      await reply("This mission is not in a sendable state.");
      return;
    }

    // 6. Delivery reuses the existing authenticated transport unchanged.
    //    The request id is derived from the Telegram update id, so a webhook
    //    retry is absorbed by the transport's own idempotency.
    const clientRequestId = await missionRequestUuid(updateId);
    let transport: { deliveryState?: string; message?: string; error?: string } | null = null;
    try {
      const response = await fetch(`${SUPABASE_URL.replace(/\/$/, "")}/functions/v1/social-mission-telegram`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          apikey: SERVICE_KEY,
          Authorization: `Bearer ${SERVICE_KEY}`,
          "X-Cartel-Internal-Source": "telegram-webhook",
          "X-Cartel-Actor-User-Id": String(result.actor_user_id ?? linked.user_id),
        },
        body: JSON.stringify({
          action: "send_mission",
          workspaceId: result.workspace_id,
          missionId: result.mission_id,
          targetId: result.target_id,
          clientRequestId,
        }),
        signal: AbortSignal.timeout(30_000),
      });
      transport = (await response.json().catch(() => null)) as typeof transport;
    } catch {
      transport = null;
    }
    timing.slice("transport_card");

    const transportState = String(transport?.deliveryState ?? "");
    if (transportState === "SENT") {
      // SE-4B — the mission clock starts from CONFIRMED delivery. One
      // activation call anchors ends_at to the card's own sent_at and seeds
      // the durable pulse/completion schedule idempotently. A failed
      // activation NEVER resends the card: the delivered card stays intact and
      // the admin gets a concise diagnostic instead.
      const { data: activated, error: activateError } = await admin.rpc("activate_social_mission_schedule", {
        _mission_id: result.mission_id,
        _target_id: result.target_id,
      });
      const activation = (activated ?? null) as { outcome?: string } | null;
      const activationOutcome = String(activation?.outcome ?? "");
      if (activateError || (activationOutcome !== "ACTIVATED" && activationOutcome !== "EXISTING")) {
        await reply("The mission card was delivered, but its 45-minute schedule could not be activated. Do not resend; close it with /mission close when you are done.");
        return;
      }
      // SE-8 — the mission's OWN immutable effective config decides whether the
      // canonical pin is a required objective for this mission.
      const { data: config } = await admin.rpc("social_mission_effective_config", {
        _mission_id: result.mission_id,
      });
      const cfg = (config ?? {}) as Record<string, unknown>;
      const autoPinEnabled = cfg["auto_pin_mission"] !== false;

      // SE-5 — raw `/mission <link>` command cleanup ONLY, governed by the
      // workspace preference exactly as before. It runs after the confirmed
      // send and active schedule and stays best-effort here; Link Finder source
      // cleanup is handled separately below because it is mandatory.
      try {
        if (!isLinkFinder && cfg["delete_command_after_send"] !== false && messageId > 0) {
          const deleted = await telegramJson(TELEGRAM_BOT_TOKEN, "deleteMessage", {
            chat_id: chatId,
            message_id: messageId,
          }).then(() => true).catch(() => false);
          if (deleted) {
            await admin.rpc("record_social_mission_command_deleted", {
              _target_id: result.target_id,
              _command_message_id: messageId,
            });
          }
        }
      } catch {
        // Cosmetic housekeeping only; never surfaced and never retried.
      }

      // SE-9 — the REQUIRED canonical objective runs here, AFTER the confirmed
      // send and active schedule and OUTSIDE the best-effort block, because its
      // result decides whether the caller may finalize. The Link Finder source
      // post is no longer part of this gate: it was deleted at detection time.
      const sentMessageId = Number(
        (transport as { telegramMessageId?: unknown } | null)?.telegramMessageId ?? NaN,
      );
      const canonicalPinned = await ensureCanonicalMissionPin(
        String(result.target_id ?? ""),
        autoPinEnabled,
        Number.isFinite(sentMessageId) ? sentMessageId : null,
      );

      // Confirmed card + active schedule + required pin. Only now may the
      // caller finalize its own transient state (Link Finder candidate, then
      // its prompt).
      if (canonicalPinned) {
        await args.onMissionSettled?.({
          kind: "ACTIVATED",
          missionId: String(result.mission_id ?? ""),
          targetId: String(result.target_id ?? ""),
        });
      } else {
        console.warn(
          `[SE-9] canonical lifecycle incomplete: pin=${canonicalPinned}`,
        );
      }
      timing.slice("schedule_pin_finalize");
      timing.log(isLinkFinder ? "link_finder_start" : "mission_command_start");



      // The branded card itself is the confirmation. No extra success text.
      return;

    }

    if (transportState === "FAILED") {
      await reply("The mission card could not be delivered to this community.");
      return;
    }
    await reply("The mission card delivery is unresolved. Please do not retry immediately.");
  };


  // ---- Launch Watch helpers (service role; opt-in state only) -------------
  // Every read/write checks its Supabase error. A backend failure must throw
  // so the bot never confirms a state change that did not persist, and never
  // reports a real outage as an invalid link.
  const resolveLaunchWatch = async (token: string) => {
    const { data: launch, error: launchError } = await admin
      .from("launches")
      .select(
        "id,status,token_name,ticker,chain,project_profile_id,launch_watch_token,launch_at,launch_window_start,launch_window_end,timezone,official_contract_address",
      )
      .eq("launch_watch_token", token)
      .maybeSingle();
    if (launchError) throw new Error("Could not load launch watch record.");
    if (!launch?.id) return null;
    const { data: profile, error: profileError } = await admin
      .from("project_profiles")
      .select("project_name,discovery_status,website_url,telegram_url,x_url")
      .eq("id", launch.project_profile_id)
      .maybeSingle();
    if (profileError) throw new Error("Could not load project profile.");
    return { launch, profile: profile ?? null };
  };

  const launchWatchIntro = (launch: any, profile: any) =>
    `<b>🔔 LAUNCH WATCH</b>\n\n<b>${escapeHtml(String(profile?.project_name ?? "Project"))}</b>\n${escapeHtml(String(launch.token_name ?? ""))} • ${escapeHtml(String(launch.ticker ?? ""))} • ${escapeHtml(String(launch.chain ?? ""))}\nStatus: ${escapeHtml(LAUNCH_STATUS_LABELS[String(launch.status)] ?? String(launch.status))}`;

  const launchWatchDisclaimer =
    `\n\nWhile you are watching, this bot can send you:\n• a controlled <b>24-hour</b> and <b>1-hour</b> countdown reminder\n• the <b>official-contract registration notice</b>\n• the <b>launch-live alert</b>\n• <b>project updates</b> sent by the authenticated project team\n\nYou can mute the countdowns, mute project updates, or stop watching at any time with the buttons below. Each of those is a separate choice.\n\nThis is not a safety check, audit, verification or endorsement of any token.`;

  const isHttpUrl = (value: unknown): value is string => {
    if (typeof value !== "string" || !value.trim()) return false;
    try {
      const url = new URL(value.trim());
      return url.protocol === "https:" || url.protocol === "http:";
    } catch {
      return false;
    }
  };

  const launchTimingLine = (launch: any): string => {
    const iso = (launch.launch_at ?? launch.launch_window_start) as string | null;
    if (!iso) return "";
    const date = new Date(String(iso));
    if (Number.isNaN(date.getTime())) return "";
    const zone = typeof launch.timezone === "string" && launch.timezone ? launch.timezone : "UTC";
    const render = (tz: string) => {
      const parts = new Intl.DateTimeFormat("en-GB", {
        timeZone: tz,
        year: "numeric",
        month: "short",
        day: "2-digit",
        hour: "2-digit",
        minute: "2-digit",
        hourCycle: "h23",
      }).formatToParts(date);
      const get = (type: string) => parts.find((p) => p.type === type)?.value ?? "";
      return `${get("day")} ${get("month")} ${get("year")} ${get("hour")}:${get("minute")} (${tz})`;
    };
    let label: string;
    try {
      label = render(zone);
    } catch {
      label = render("UTC");
    }
    const prefix = launch.launch_at ? "Announced launch time" : "Launch window starts";
    return `\n${prefix}: <b>${escapeHtml(label)}</b>`;
  };

  /**
   * Immediate official-contract notice for someone who joins after the official
   * contract has already been registered. This is a direct confirmation only —
   * it never creates a launch_notification_deliveries row.
   */
  const officialContractNotice = (launch: any, profile: any): string => {
    const lines: string[] = [
      `\n\n<b>📦 OFFICIAL CONTRACT REGISTERED</b>\n`,
      `<b>${escapeHtml(String(profile?.project_name ?? "Project"))}</b>`,
      `${escapeHtml(String(launch.token_name ?? ""))} • ${escapeHtml(String(launch.ticker ?? ""))} • ${escapeHtml(String(launch.chain ?? ""))}`,
    ];
    if (launch.official_contract_address) {
      lines.push(
        `\nThis is the project's registered official contract reference:\n<code>${escapeHtml(String(launch.official_contract_address))}</code>`,
      );
    }
    const timing = launchTimingLine(launch);
    if (timing) lines.push(timing.replace(/^\n/, ""));
    const links: string[] = [];
    if (isHttpUrl(profile?.website_url)) links.push(`Website: ${escapeHtml(profile.website_url.trim())}`);
    if (isHttpUrl(profile?.telegram_url)) links.push(`Telegram: ${escapeHtml(profile.telegram_url.trim())}`);
    if (isHttpUrl(profile?.x_url)) links.push(`X: ${escapeHtml(profile.x_url.trim())}`);
    if (links.length) lines.push(`\n<b>Official project links</b>\n${links.join("\n")}`);
    lines.push(
      `\n<b>What "verified" means:</b> Cartel verified the specific deployment evidence bound to this registration. It is <b>not</b> a token or project safety audit, guarantee, endorsement or investment recommendation. Always do your own research.`,
    );
    return lines.join("\n");
  };

  /** Returns a status string describing why a join/rewatch cannot be accepted. */
  const launchWatchGate = (launch: any, profile: any): string | null => {
    const status = String(launch.status ?? "");
    if (status === "DRAFT" || status === "ANNOUNCED") {
      return "Launch Watch is not open for this launch yet. Check back soon.";
    }
    if (!LAUNCH_WATCH_OPEN_STATUSES.includes(status)) {
      return "New Launch Watch sign-ups are closed for this launch.";
    }
    if (String(profile?.discovery_status ?? "") !== "published") {
      return "This launch is not accepting Launch Watch sign-ups right now.";
    }
    return null;
  };

  const canRewatchNow = (launch: any, profile: any) => launchWatchGate(launch, profile) === null;

  const isUniqueViolation = (error: any) => String(error?.code ?? "") === "23505";

  const readLaunchWatchRow = async (launchId: string, telegramUserId: number) => {
    const { data, error } = await admin
      .from("launch_watch_subscriptions")
      .select("id,is_active,reminders_enabled,updates_enabled")
      .eq("launch_id", launchId)
      .eq("telegram_user_id", telegramUserId)
      .maybeSingle();
    if (error) throw new Error("Could not load launch watch subscription.");
    return data ?? null;
  };

  const touchLaunchWatchRow = async (id: string, now: string) => {
    const { error } = await admin
      .from("launch_watch_subscriptions")
      .update({ last_interaction_at: now })
      .eq("id", id);
    if (error) throw new Error("Could not update launch watch subscription.");
  };

  /** Reactivation never resets reminders_enabled: the prior choice is kept. */
  const reactivateLaunchWatchRow = async (id: string, now: string) => {
    const { error } = await admin
      .from("launch_watch_subscriptions")
      .update({ is_active: true, subscribed_at: now, unsubscribed_at: null, last_interaction_at: now })
      .eq("id", id);
    if (error) throw new Error("Could not reactivate launch watch subscription.");
  };

  /** Explicit reminder-preference toggle for an already-active watcher. */
  const setLaunchWatchReminders = async (id: string, enabled: boolean, now: string) => {
    const { error } = await admin
      .from("launch_watch_subscriptions")
      .update({ reminders_enabled: enabled, last_interaction_at: now })
      .eq("id", id);
    if (error) throw new Error("Could not update countdown reminder preference.");
  };

  /** Explicit project-update preference toggle for an already-active watcher. */
  const setLaunchWatchUpdates = async (id: string, enabled: boolean, now: string) => {
    const { error } = await admin
      .from("launch_watch_subscriptions")
      .update({ updates_enabled: enabled, last_interaction_at: now })
      .eq("id", id);
    if (error) throw new Error("Could not update project update preference.");
  };

  type LaunchWatchOutcome = "subscribed" | "reactivated" | "already_active";

  /**
   * Idempotent subscribe / reactivate. Never creates a duplicate row: a lost
   * race against a simultaneous deep link surfaces as unique violation 23505,
   * which is resolved by refetching and applying the normal patch. New rows
   * take the database defaults reminders_enabled = true and
   * updates_enabled = true; neither is forced explicitly here.
   */
  const launchWatchSubscribe = async (
    launchId: string,
    telegramUserId: number,
  ): Promise<{
    outcome: LaunchWatchOutcome;
    remindersEnabled: boolean;
    updatesEnabled: boolean;
    subscriptionId: string | null;
  }> => {
    const now = new Date().toISOString();
    const existing = await readLaunchWatchRow(launchId, telegramUserId);
    if (existing?.id) {
      if (existing.is_active) {
        await touchLaunchWatchRow(existing.id, now);
        return { outcome: "already_active", remindersEnabled: existing.reminders_enabled !== false, updatesEnabled: existing.updates_enabled === true, subscriptionId: String(existing.id) };
      }
      await reactivateLaunchWatchRow(existing.id, now);
      return { outcome: "reactivated", remindersEnabled: existing.reminders_enabled !== false, updatesEnabled: existing.updates_enabled === true, subscriptionId: String(existing.id) };
    }

    const { data: inserted, error: insertError } = await admin.from("launch_watch_subscriptions").insert({
      launch_id: launchId,
      telegram_user_id: telegramUserId,
      is_active: true,
      subscribed_at: now,
      last_interaction_at: now,
      source: "telegram_deep_link",
    }).select("id").maybeSingle();
    if (insertError) {
      if (!isUniqueViolation(insertError)) {
        throw new Error("Could not save launch watch subscription.");
      }
      const raced = await readLaunchWatchRow(launchId, telegramUserId);
      if (!raced?.id) throw new Error("Could not save launch watch subscription.");
      if (raced.is_active) {
        await touchLaunchWatchRow(raced.id, now);
        return { outcome: "already_active", remindersEnabled: raced.reminders_enabled !== false, updatesEnabled: raced.updates_enabled === true, subscriptionId: String(raced.id) };
      }
      await reactivateLaunchWatchRow(raced.id, now);
      return { outcome: "reactivated", remindersEnabled: raced.reminders_enabled !== false, updatesEnabled: raced.updates_enabled === true, subscriptionId: String(raced.id) };
    }

    return { outcome: "subscribed", remindersEnabled: true, updatesEnabled: true, subscriptionId: inserted?.id ? String(inserted.id) : null };
  };

  /**
   * Persists the latest private-confirmation diagnostic for one explicit
   * deep-link attempt. Diagnostics are best-effort: a failure here must never
   * erase an already-persisted subscription and must never trigger a resend.
   */
  const recordLaunchWatchConfirmation = async (
    subscriptionId: string | null,
    attemptedAt: string,
    outcome: SendOutcome,
  ) => {
    if (!subscriptionId) return;
    try {
      // Single atomic statement server-side: the attempt counter and the latest
      // diagnostic state are updated together, so concurrent deep-link opens
      // cannot lose an increment.
      const { error } = await admin.rpc("record_launch_watch_confirmation", {
        _subscription_id: subscriptionId,
        _attempted_at: attemptedAt,
        _status: outcome.status,
        _message_id: outcome.status === "sent" ? outcome.messageId : null,
        _error_class: outcome.status === "sent" ? null : outcome.errorClass,
        _last_error: outcome.status === "sent" ? null : outcome.detail,
      } as any);
      if (error) {
        console.error("launch_watch_confirmation_persist_failed", outcome.status, error.message);
      }
    } catch (error) {
      // Telegram may already have delivered. Never resend on a persistence fault.
      console.error("launch_watch_confirmation_persist_exception", outcome.status, (error as Error)?.message);
    }
  };



  /** Soft unwatch. The row and its history are always preserved. */
  const launchWatchUnsubscribe = async (launchId: string, telegramUserId: number) => {
    const now = new Date().toISOString();
    const existing = await readLaunchWatchRow(launchId, telegramUserId);
    if (!existing?.id) return "not_found" as const;
    if (!existing.is_active) {
      // Preserve the original unsubscribed_at; only record the interaction.
      await touchLaunchWatchRow(existing.id, now);
      return "already_inactive" as const;
    }
    const { error } = await admin
      .from("launch_watch_subscriptions")
      .update({ is_active: false, unsubscribed_at: now, last_interaction_at: now })
      .eq("id", existing.id);
    if (error) throw new Error("Could not update launch watch subscription.");
    return "unsubscribed" as const;
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
      "<b>Stay connected with PEPECARTEL</b>",
      "Follow the ecosystem and see what Cartel HQ is building as new tools go live.",
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
    await sendMessage(TELEGRAM_BOT_TOKEN, chatId, await systemMessage("community_connected", String(groupRow.title ?? ""), communityConnectedText), { parse_mode: "HTML", reply_markup: groupAcquisitionKeyboard(chatId, false) });

    return { ok: true, groupRow };
  };

  /**
   * C7.3 — Team-side Project Inbox console.
   *
   * Every branch below is private-chat only and delegates ALL authorization to
   * service-only RPCs which resolve telegram_connections -> application user ->
   * CURRENT workspace_members membership. telegram_team_sessions is convenience
   * state only and is NEVER an authorization source. Member Telegram identities
   * are never exposed to the team; only the opaque member_ref is shown.
   */
  const INBOX_STATUS_DOT = (status: string) =>
    status === "RESOLVED" ? "⚪️" : status === "WAITING_ON_MEMBER" ? "🟡" : "🔴";

  /** Deterministic idempotency key so a Telegram retry cannot double-queue. */
  const replyRequestId = async (updateId: number) => {
    const hex = await sha256Hex(`pi-bot-reply:${updateId}`);
    const b = hex.slice(0, 32).split("");
    b[12] = "5";
    b[16] = "8";
    const s = b.join("");
    return `${s.slice(0, 8)}-${s.slice(8, 12)}-${s.slice(12, 16)}-${s.slice(16, 20)}-${s.slice(20, 32)}`;
  };

  const inboxListMarkup = (rows: any[]) => ({
    inline_keyboard: [
      ...rows.map((r: any) => [{
        text: `${INBOX_STATUS_DOT(String(r.conversation_status))} ${String(r.member_ref)}`,
        callback_data: `pi_c_${String(r.conversation_id)}`,
      }]),
      [{ text: "✖️ Close inbox", callback_data: "pi_x" }],
    ],
  });

  const renderInboxList = async (
    telegramUserId: number,
    chatId: string,
    workspaceId: string,
    workspaceName: string,
  ) => {
    const { data, error } = await admin.rpc("bot_inbox_list_conversations", {
      _telegram_user_id: telegramUserId,
      _workspace_id: workspaceId,
      _limit: 8,
    });
    if (error) {
      await sendMessage(TELEGRAM_BOT_TOKEN, chatId, "Project Inbox is unavailable right now. Try again shortly.");
      return;
    }
    const rows = Array.isArray(data) ? data : [];
    if (rows.length === 0) {
      await sendMessage(
        TELEGRAM_BOT_TOKEN,
        chatId,
        `<b>📥 PROJECT INBOX — ${escapeHtml(workspaceName)}</b>\n\nNo member conversations yet.`,
        { parse_mode: "HTML" },
      );
      return;
    }
    const lines = rows.map((r: any) =>
      `${INBOX_STATUS_DOT(String(r.conversation_status))} <b>${escapeHtml(String(r.member_ref))}</b> • ${escapeHtml(String(r.conversation_status))}\n<i>${escapeHtml(String(r.preview ?? ""))}</i>`
    );
    await sendMessage(
      TELEGRAM_BOT_TOKEN,
      chatId,
      `<b>📥 PROJECT INBOX — ${escapeHtml(workspaceName)}</b>\n\n${lines.join("\n\n")}\n\nPick a conversation to read and reply.`,
      { parse_mode: "HTML", reply_markup: inboxListMarkup(rows) },
    );
  };

  const openInboxCommand = async (telegramUserId: number, chatId: string) => {
    const { data, error } = await admin.rpc("bot_inbox_operator_workspaces", {
      _telegram_user_id: telegramUserId,
    });
    if (error) {
      await sendMessage(TELEGRAM_BOT_TOKEN, chatId, "Project Inbox is unavailable right now. Try again shortly.");
      return;
    }
    const workspaces = Array.isArray(data) ? data : [];
    if (workspaces.length === 0) {
      await sendMessage(
        TELEGRAM_BOT_TOKEN,
        chatId,
        "<b>Project Inbox</b>\n\nThis Telegram account is not connected to a Cartel HQ workspace you can manage.",
        { parse_mode: "HTML" },
      );
      return;
    }
    if (workspaces.length === 1) {
      const ws = workspaces[0];
      await admin.rpc("bot_inbox_set_session", {
        _telegram_user_id: telegramUserId,
        _mode: "INBOX",
        _workspace_id: String(ws.workspace_id),
      });
      await renderInboxList(telegramUserId, chatId, String(ws.workspace_id), String(ws.workspace_name ?? "Workspace"));
      return;
    }
    await sendMessage(
      TELEGRAM_BOT_TOKEN,
      chatId,
      "<b>📥 PROJECT INBOX</b>\n\nChoose a workspace.",
      {
        parse_mode: "HTML",
        reply_markup: {
          inline_keyboard: [
            ...workspaces.map((w: any) => [{
              text: `${String(w.workspace_name ?? "Workspace")} (${Number(w.waiting_count ?? 0)})`,
              callback_data: `pi_w_${String(w.workspace_id)}`,
            }]),
            [{ text: "✖️ Close inbox", callback_data: "pi_x" }],
          ],
        },
      },
    );
  };

  const openInboxConversation = async (telegramUserId: number, chatId: string, conversationId: string) => {
    const { data, error } = await admin.rpc("bot_inbox_open_conversation", {
      _telegram_user_id: telegramUserId,
      _conversation_id: conversationId,
    });
    const row = Array.isArray(data) ? data[0] : null;
    if (error || !row || String(row.outcome) !== "ok") {
      await sendMessage(TELEGRAM_BOT_TOKEN, chatId, "That conversation is not available to this account.");
      return;
    }
    const transcript = Array.isArray(row.transcript) ? [...row.transcript] : [];
    transcript.sort((a: any, b: any) => String(a.created_at).localeCompare(String(b.created_at)));
    const body = transcript.length === 0
      ? "<i>No messages yet.</i>"
      : transcript.map((m: any) => {
        const who = String(m.author_type) === "TEAM" ? "Team" : String(m.author_type) === "SYSTEM" ? "System" : "Member";
        return `<b>${who}</b>\n${escapeHtml(String(m.body ?? ""))}`;
      }).join("\n\n");
    await sendMessage(
      TELEGRAM_BOT_TOKEN,
      chatId,
      `<b>📥 ${escapeHtml(String(row.member_ref ?? "Member"))}</b> • ${escapeHtml(String(row.conversation_status ?? ""))}\n${escapeHtml(String(row.workspace_name ?? ""))}\n\n${body}\n\n<b>Reply mode is on for 30 minutes.</b> Send your reply as a normal message. It is delivered as an official project response. Use /cancel to exit.`,
      { parse_mode: "HTML", reply_markup: { inline_keyboard: [[{ text: "✖️ Exit reply mode", callback_data: "pi_x" }]] } },
    );
  };

  /**
   * C7.3 — team alert after a CONFIRMED member capture. Best effort only:
   * a failure here can never roll back or invalidate the captured message.
   * The member's Telegram identity is never included; only member_ref.
   */
  const notifyTeamOfCapture = async (updateId: number) => {
    try {
      const { data, error } = await admin.rpc("bot_inbox_capture_alert_targets", {
        _telegram_update_id: updateId,
      });
      if (error) return;
      const targets = Array.isArray(data) ? data : [];
      for (const target of targets) {
        const operatorId = Number(target.operator_telegram_user_id);
        if (!Number.isSafeInteger(operatorId) || operatorId <= 0) continue;
        const heading = target.is_new_conversation === true
          ? "🆕 NEW PROJECT INBOX MESSAGE"
          : "📥 PROJECT INBOX MESSAGE";
        await sendMessage(
          TELEGRAM_BOT_TOKEN,
          String(operatorId),
          `<b>${heading}</b>\n\nFrom <b>${escapeHtml(String(target.member_ref ?? "Member"))}</b>\n\n${escapeHtml(String(target.body ?? ""))}`,
          {
            parse_mode: "HTML",
            reply_markup: {
              inline_keyboard: [[{ text: "📖 Open conversation", callback_data: `pi_c_${String(target.conversation_id)}` }]],
            },
          },
        );
      }
    } catch (alertError) {
      console.error("[telegram-webhook] inbox alert", alertError instanceof Error ? alertError.message : "unknown error");
    }
  };

  /**
   * ==========================================================================
   * SE-15 — TELEGRAM MISSION CONTROL (private DM console)
   * ==========================================================================
   *
   * Every branch below is PRIVATE-CHAT ONLY and every mutation passes three
   * independent gates, in this order and with no shortcut:
   *
   *   1. the Telegram user is linked to a Cartel HQ user
   *      (enforced inside the service-only RPCs via telegram_connections)
   *   2. that user is a workspace owner/admin
   *      (enforced inside the service-only RPCs via is_workspace_operator)
   *   3. that user is CURRENTLY administrator/creator of the mission's own
   *      Telegram group, read LIVE from Telegram here and proven to the RPC by
   *      passing the verified chat id, which the RPC re-binds to the mission's
   *      own target row.
   *
   * Session state (telegram_team_sessions) is convenience only and is NEVER an
   * authorization source. Callback data, workspace ids, mission ids and chat
   * ids carried in a button are treated as untrusted input: the pickers below
   * only ever surface rows the caller can already operate, and every mutation
   * re-derives and re-verifies the binding from scratch.
   *
   * The mission's `metadata.effective_config` is never written here. Overrides
   * live in `metadata.mission_control` and are folded over the frozen snapshot
   * by the shared resolver.
   */

  /** Deterministic RFC-4122-shaped id so a Telegram retry reuses the same edit. */
  const mcRequestUuid = async (seed: string) => {
    const hex = await sha256Hex(`se15-mission-control-edit:${seed}`);
    const chars = hex.slice(0, 32).split("");
    chars[12] = "5";
    chars[16] = ["8", "9", "a", "b"][parseInt(hex[16], 16) % 4];
    const h = chars.join("");
    return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20, 32)}`;
  };

  /**
   * Idempotency key for a mutation. Derived from the Telegram update id and the
   * action, so a webhook retry of the SAME tap replays instead of mutating
   * twice or appending a duplicate audit entry.
   */
  const mcKey = async (updateId: unknown, action: string) =>
    (await sha256Hex(`se15-mission-control:${String(updateId ?? "")}:${action}`)).slice(0, 40);

  type MissionControlBinding = {
    workspaceId: string;
    workspaceName: string;
    chatId: string;
    missionId: string;
  };

  /**
   * Resolves a mission id to its workspace and target chat using ONLY
   * operator-scoped RPCs, so a non-operator can never learn that a mission id
   * exists. Bounded by the picker's own 20-workspace / 10-mission limits.
   */
  const mcResolveMission = async (
    telegramUserId: number,
    missionId: string,
  ): Promise<MissionControlBinding | null> => {
    const { data: workspaces, error } = await admin.rpc("social_mission_control_workspaces", {
      _telegram_user_id: telegramUserId,
    });
    if (error) return null;
    for (const workspace of Array.isArray(workspaces) ? workspaces : []) {
      const workspaceId = String((workspace as any).workspace_id ?? "");
      if (!workspaceId) continue;
      const { data: missions } = await admin.rpc("social_mission_control_missions", {
        _telegram_user_id: telegramUserId,
        _workspace_id: workspaceId,
      });
      const hit = (Array.isArray(missions) ? missions : []).find(
        (m: any) => String(m.mission_id) === missionId,
      );
      if (hit) {
        return {
          workspaceId,
          workspaceName: String((workspace as any).workspace_name ?? "Workspace"),
          chatId: String((hit as any).telegram_chat_id ?? ""),
          missionId,
        };
      }
    }
    return null;
  };

  /**
   * GATE 3 — live Telegram administrator/creator check in the mission's OWN
   * group. Read fresh from Telegram on EVERY mutation; a stale cached role, a
   * stale button or an anonymous sender can never satisfy it.
   */
  const mcVerifyGroupAdmin = async (chatId: string, telegramUserId: number) => {
    try {
      const member = await telegramJson(TELEGRAM_BOT_TOKEN, "getChatMember", {
        chat_id: chatId,
        user_id: telegramUserId,
      });
      const status = String((member as { status?: unknown } | null)?.status ?? "");
      return status === "administrator" || status === "creator";
    } catch {
      return false;
    }
  };

  /** Gates 1-3 in order. Returns the verified binding or a typed refusal. */
  const mcAuthorize = async (
    telegramUserId: number,
    missionId: string,
  ): Promise<{ ok: true; binding: MissionControlBinding } | { ok: false; reason: string }> => {
    const binding = await mcResolveMission(telegramUserId, missionId);
    if (!binding || !binding.chatId) {
      return { ok: false, reason: "That mission is not available to this account." };
    }
    const isAdmin = await mcVerifyGroupAdmin(binding.chatId, telegramUserId);
    if (!isAdmin) {
      return {
        ok: false,
        reason: "You must be a current admin of that community to change its mission.",
      };
    }
    return { ok: true, binding };
  };

  /** Human wording for the typed RPC outcomes. Never leaks internals. */
  const MC_OUTCOME_TEXT: Record<string, string> = {
    denied: "That action was refused.",
    not_linked: "Connect this Telegram account to Cartel HQ first.",
    not_found: "That mission is not available to this account.",
    not_operator: "Only a workspace owner or admin can do that.",
    chat_mismatch: "That mission does not belong to the community you administer.",
    not_live: "That mission is no longer live. Nothing was changed.",
    conflict: "The mission scheduler is mid-send right now. Try again in a moment.",
    invalid_mode: "That target mode is not valid.",
    invalid_primary_type: "That Primary Goal is not valid.",
    invalid_primary_target: "A Primary Goal needs a whole number above zero.",
    invalid_minutes: "Choose between 1 and 1440 minutes.",
    replayed: "That change was already applied.",
  };

  /**
   * Exactly ONE same-card edit through the existing transport, reusing its
   * revision + client-request idempotency. A target-only or end-time-only
   * change never triggers a provider read: the transport performs its final X
   * snapshot only for a COMPLETED mission.
   */
  const mcRefreshCard = async (args: {
    binding: MissionControlBinding;
    actorUserId: string | null;
    seed: string;
  }) => {
    const workspaceId = args.binding.workspaceId;
    const missionId = args.binding.missionId;
    // The EXACT verified target. Filtering on mission+workspace alone would
    // break (or edit the wrong card) the moment a mission has more than one
    // delivered target, so the verified Telegram chat is part of the binding.
    const { data: target } = await admin
      .from("social_mission_targets")
      .select("id, edit_revision")
      .eq("mission_id", missionId)
      .eq("workspace_id", workspaceId)
      .eq("telegram_chat_id", Number(args.binding.chatId))
      .order("created_at", { ascending: true })
      .limit(1)
      .maybeSingle();
    if (!target?.id) return null;
    try {
      const response = await fetch(
        `${SUPABASE_URL.replace(/\/$/, "")}/functions/v1/social-mission-telegram`,
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            apikey: SERVICE_KEY,
            Authorization: `Bearer ${SERVICE_KEY}`,
            "X-Cartel-Internal-Source": "telegram-webhook",
            ...(args.actorUserId ? { "X-Cartel-Actor-User-Id": args.actorUserId } : {}),
          },
          body: JSON.stringify({
            action: "edit_mission",
            workspaceId,
            missionId,
            targetId: String(target.id),
            clientRequestId: await mcRequestUuid(args.seed),
            revision: Number((target as any).edit_revision ?? 0) + 1,
          }),
          signal: AbortSignal.timeout(30_000),
        },
      );
      return (await response.json().catch(() => null)) as { editState?: string } | null;
    } catch {
      return null;
    }
  };

  /**
   * SE-15 — safe unpin. ONLY a pin Cartel HQ itself recorded is ever removed; a
   * pin the community set by hand is left untouched. Identical ownership guard
   * to the `/mission close` path.
   */
  const mcSafeUnpin = async (binding: MissionControlBinding) => {
    try {
      // Same exact binding as the card edit: mission + workspace + the verified
      // Telegram chat, never a loose mission-wide match.
      const { data: pinned } = await admin
        .from("social_mission_targets")
        .select("id, telegram_chat_id, telegram_message_id, pinned_by_hq")
        .eq("mission_id", binding.missionId)
        .eq("workspace_id", binding.workspaceId)
        .eq("telegram_chat_id", Number(binding.chatId))
        .order("created_at", { ascending: true })
        .limit(1)
        .maybeSingle();
      if (!pinned?.pinned_by_hq || !pinned.telegram_message_id) return;
      const unpinned = await telegramJson(TELEGRAM_BOT_TOKEN, "unpinChatMessage", {
        chat_id: String(pinned.telegram_chat_id),
        message_id: Number(pinned.telegram_message_id),
      }).then(() => true).catch(() => false);
      if (unpinned) {
        await admin.rpc("record_social_mission_target_pin", {
          _target_id: String(pinned.id),
          _pinned: false,
        });
      }
    } catch {
      // A pin problem never invalidates a completion or cancellation already
      // persisted, and never produces a second chat message.
    }
  };

  const mcNumber = (value: unknown) => {
    const n = Number(value);
    return Number.isInteger(n) && n > 0 ? n : null;
  };

  /** Reads the CURRENT resolved config so a single-field edit can be re-applied whole. */
  const mcResolvedConfig = async (missionId: string) => {
    const { data } = await admin.rpc("social_mission_effective_config_resolved", {
      _mission_id: missionId,
    });
    return (data ?? {}) as Record<string, unknown>;
  };

  /**
   * Applies ONE field change by re-sending the complete manual set. There is no
   * client-side draft to desynchronize: the current resolved config is the
   * draft, so every tap is atomic, fully validated server-side and audited.
   */
  const mcApplyTargets = async (args: {
    telegramUserId: number;
    binding: MissionControlBinding;
    updateId: unknown;
    patch: { primaryType?: string; primaryTarget?: number | null } & Partial<
      Record<MissionControlMetric, number | null>
    >;
  }) => {
    const config = await mcResolvedConfig(args.binding.missionId);
    const targets = (config["metric_targets"] ?? {}) as Record<string, unknown>;
    const currentType = String(config["milestone_type"] ?? "NONE").toUpperCase();
    const nextType = String(
      args.patch.primaryType ??
        ((MISSION_CONTROL_PRIMARY_TYPES as readonly string[]).includes(currentType)
          ? currentType
          : "VIEWS"),
    ).toUpperCase();

    const pinned = primaryGoalMetric(nextType);
    let primaryTarget =
      args.patch.primaryTarget !== undefined
        ? args.patch.primaryTarget
        : mcNumber(config["milestone_target"]);
    if (primaryTarget === null && pinned) primaryTarget = mcNumber(targets[pinned]);
    if (primaryTarget === null) {
      return { outcome: "needs_primary_target" as const, type: nextType };
    }

    const value = (metric: MissionControlMetric) =>
      args.patch[metric] !== undefined ? args.patch[metric]! : mcNumber(targets[metric]);

    const { data, error } = await admin.rpc("social_mission_apply_target_override", {
      _telegram_user_id: args.telegramUserId,
      _mission_id: args.binding.missionId,
      _verified_chat_id: Number(args.binding.chatId),
      _mode: "MANUAL",
      _primary_type: nextType,
      _primary_target: primaryTarget,
      _views: value("views"),
      _likes: value("likes"),
      _replies: value("replies"),
      _reposts: value("reposts"),
      _bookmarks: value("bookmarks"),
      _idempotency_key: await mcKey(args.updateId, `targets:${JSON.stringify(args.patch)}`),
    });
    if (error) return { outcome: "error" as const };
    return (data ?? {}) as { outcome?: string; target_id?: string };
  };

  const mcPanelKeyboard = (missionId: string) => ({
    inline_keyboard: [
      [{ text: "🎯 Edit targets", callback_data: `mc_t_${missionId}` }],
      [{ text: "⏱ Change end time", callback_data: `mc_d_${missionId}` }],
      [
        { text: "🏁 End mission now", callback_data: `mc_e_${missionId}` },
        { text: "🛑 Cancel mission", callback_data: `mc_c_${missionId}` },
      ],
      [{ text: "✖️ Exit", callback_data: "mc_x" }],
    ],
  });

  /** Renders the single-mission control panel. Never shown in a group. */
  const mcRenderPanel = async (
    telegramUserId: number,
    chatId: string,
    missionId: string,
    binding: MissionControlBinding,
    note?: string,
  ) => {
    const { data } = await admin.rpc("social_mission_control_panel", {
      _telegram_user_id: telegramUserId,
      _mission_id: missionId,
      _verified_chat_id: Number(binding.chatId),
    });
    const panel = (data ?? {}) as Record<string, unknown>;
    if (String(panel["outcome"] ?? "") !== "ok") {
      await sendMessage(
        TELEGRAM_BOT_TOKEN,
        chatId,
        MC_OUTCOME_TEXT[String(panel["outcome"] ?? "denied")] ?? "That mission is not available.",
      );
      return;
    }
    const config = (panel["resolved_config"] ?? {}) as Record<string, unknown>;
    const targets = (config["metric_targets"] ?? {}) as Record<string, unknown>;
    const mode = String(panel["control_mode"] ?? "AUTO");
    const primaryType = String(config["milestone_type"] ?? "NONE").toUpperCase();
    const primaryTarget = mcNumber(config["milestone_target"]);
    const handle = panel["author_handle"] ? `@${String(panel["author_handle"])}` : "Social mission";
    const url = typeof panel["canonical_url"] === "string" ? String(panel["canonical_url"]) : "";

    const lines = [
      "🛠 <b>MISSION CONTROL</b>",
      "",
      `<b>${escapeHtml(handle)}</b>${url ? `\n${escapeHtml(url)}` : ""}`,
      `Project: ${escapeHtml(binding.workspaceName)}`,
      "",
      `Status: <b>LIVE</b> · ${escapeHtml(missionControlRemaining(panel["ends_at"], Date.now()))}`,
      `Target mode: <b>${escapeHtml(mode)}</b>`,
      `Primary Goal: <b>${escapeHtml(
        (MISSION_CONTROL_PRIMARY_LABELS as Record<string, string>)[primaryType] ?? "Not set",
      )}</b>${primaryTarget ? ` · ${primaryTarget}` : ""}`,
      "",
      ...MISSION_CONTROL_METRICS.map((metric) => {
        const target = mcNumber(targets[metric]);
        return `${MISSION_CONTROL_METRIC_LABELS[metric]}: ${target ?? "off"}`;
      }),
    ];
    if (note) lines.push("", `<i>${escapeHtml(note)}</i>`);

    await sendMessage(TELEGRAM_BOT_TOKEN, chatId, lines.join("\n"), {
      parse_mode: "HTML",
      reply_markup: mcPanelKeyboard(missionId),
    });
  };

  /** Mission picker for one workspace. Only LIVE missions the caller operates. */
  const mcRenderMissionPicker = async (
    telegramUserId: number,
    chatId: string,
    workspaceId: string,
    workspaceName: string,
  ) => {
    const { data, error } = await admin.rpc("social_mission_control_missions", {
      _telegram_user_id: telegramUserId,
      _workspace_id: workspaceId,
    });
    const rows = Array.isArray(data) ? data : [];
    if (error) {
      await sendMessage(TELEGRAM_BOT_TOKEN, chatId, "Mission Control is unavailable right now.");
      return;
    }
    if (rows.length === 0) {
      await sendMessage(
        TELEGRAM_BOT_TOKEN,
        chatId,
        `<b>🛠 MISSION CONTROL — ${escapeHtml(workspaceName)}</b>\n\nThere is no live mission to manage right now.`,
        { parse_mode: "HTML" },
      );
      return;
    }
    if (rows.length === 1) {
      const only = rows[0] as any;
      const auth = await mcAuthorize(telegramUserId, String(only.mission_id));
      if (!auth.ok) {
        await sendMessage(TELEGRAM_BOT_TOKEN, chatId, auth.reason);
        return;
      }
      await admin.rpc("social_mission_control_set_session", {
        _telegram_user_id: telegramUserId,
        _workspace_id: workspaceId,
        _mission_id: String(only.mission_id),
        _pending_field: null,
        _clear: false,
      });
      await mcRenderPanel(telegramUserId, chatId, String(only.mission_id), auth.binding);
      return;
    }
    await sendMessage(
      TELEGRAM_BOT_TOKEN,
      chatId,
      `<b>🛠 MISSION CONTROL — ${escapeHtml(workspaceName)}</b>\n\nChoose the live mission to manage.`,
      {
        parse_mode: "HTML",
        reply_markup: {
          inline_keyboard: [
            ...rows.map((r: any) => [
              {
                text: `${r.author_handle ? `@${String(r.author_handle)}` : "Mission"} · ${missionControlRemaining(r.ends_at, Date.now())}`,
                callback_data: `mc_m_${String(r.mission_id)}`,
              },
            ]),
            [{ text: "✖️ Exit", callback_data: "mc_x" }],
          ],
        },
      },
    );
  };

  /** Entry point for `/mission manage` in DM and for `/start mission_manage`. */
  const mcOpenConsole = async (telegramUserId: number, chatId: string) => {
    const { data, error } = await admin.rpc("social_mission_control_workspaces", {
      _telegram_user_id: telegramUserId,
    });
    if (error) {
      await sendMessage(TELEGRAM_BOT_TOKEN, chatId, "Mission Control is unavailable right now.");
      return;
    }
    const workspaces = Array.isArray(data) ? data : [];
    if (workspaces.length === 0) {
      await sendMessage(
        TELEGRAM_BOT_TOKEN,
        chatId,
        "<b>🛠 Mission Control</b>\n\nThis Telegram account is not connected to a Cartel HQ workspace you can manage.",
        { parse_mode: "HTML" },
      );
      return;
    }
    if (workspaces.length === 1) {
      const only = workspaces[0] as any;
      await mcRenderMissionPicker(
        telegramUserId,
        chatId,
        String(only.workspace_id),
        String(only.workspace_name ?? "Workspace"),
      );
      return;
    }
    await sendMessage(TELEGRAM_BOT_TOKEN, chatId, "<b>🛠 MISSION CONTROL</b>\n\nChoose a project.", {
      parse_mode: "HTML",
      reply_markup: {
        inline_keyboard: [
          ...workspaces.map((w: any) => [
            {
              text: `${String(w.workspace_name ?? "Workspace")} (${Number(w.live_missions ?? 0)} live)`,
              callback_data: `mc_w_${String(w.workspace_id)}`,
            },
          ]),
          [{ text: "✖️ Exit", callback_data: "mc_x" }],
        ],
      },
    });
  };

  const mcTargetsKeyboard = (missionId: string) => ({
    inline_keyboard: [
      // `pg` picks WHICH metric is the Primary Goal; `pt` sets the NUMBER that
      // Primary Goal has to reach. Without `pt` the primary number could only
      // ever be inherited from the launch config.
      [{ text: "🏆 Primary Goal", callback_data: `mc_f_pg_${missionId}` }],
      [{ text: "🏆 Primary target", callback_data: `mc_f_pt_${missionId}` }],
      ...MISSION_CONTROL_METRICS.map((metric) => [
        {
          text: `${MISSION_CONTROL_METRIC_LABELS[metric]} target`,
          callback_data: `mc_f_${metric}_${missionId}`,
        },
      ]),
      [{ text: "♻️ Reset to automatic", callback_data: `mc_auto_${missionId}` }],
      [{ text: "⬅️ Back", callback_data: `mc_p_${missionId}` }],
    ],
  });

  const mcDurationKeyboard = (missionId: string) => ({
    inline_keyboard: [
      [
        { text: "+20 min", callback_data: `mc_dq_20_${missionId}` },
        { text: "+45 min", callback_data: `mc_dq_45_${missionId}` },
      ],
      [
        { text: "+60 min", callback_data: `mc_dq_60_${missionId}` },
        { text: "+120 min", callback_data: `mc_dq_120_${missionId}` },
      ],
      [{ text: "✏️ Custom minutes", callback_data: `mc_dc_${missionId}` }],
      [{ text: "⬅️ Back", callback_data: `mc_p_${missionId}` }],
    ],
  });

  try {


    const callback = update?.callback_query;
    if (callback?.id && callback?.from?.id) {
      const from = callback.from;
      const callbackData = String(callback.data ?? "");
      const callbackChat = callback.message?.chat;
      const callbackChatId = callbackChat?.id != null ? String(callbackChat.id) : String(from.id);
      const linked = await getLinkedUser(String(from.id));

      // SE-6 Step 1 — X Link Finder decision. STRICT SEQUENCING:
      //   1. READ-ONLY preflight (`peek_...`) — mutates nothing.
      //   2. LIVE Telegram administrator/creator verification in the
      //      candidate's OWN chat.
      //   3. Only then the consuming resolver, which revalidates every fact
      //      and requires the verified chat id.
      // A denied or non-admin tap therefore leaves the candidate PENDING for
      // an authorized admin. START still reuses the EXACT `/mission`
      // pipeline, so this button can never become a weaker launch path.
      const smStart = callbackData.match(/^sm_lf_start_([0-9a-f-]{36})$/i);
      const smIgnore = callbackData.match(/^sm_lf_ignore_([0-9a-f-]{36})$/i);
      if ((smStart || smIgnore) && (callbackChat?.type === "group" || callbackChat?.type === "supergroup")) {
        const candidateId = String((smStart ?? smIgnore)![1]);

        const { data: peeked } = await admin.rpc("peek_social_mission_link_candidate", {
          _candidate_id: candidateId,
          _telegram_user_id: Number(from.id),
        });
        const preflight = (peeked ?? {}) as {
          outcome?: string;
          reason?: string;
          telegram_chat_id?: number;
          prompt_message_id?: number;
        };

        if (preflight.outcome === "EXPIRED") {
          await answerCallback(TELEGRAM_BOT_TOKEN, callback.id, "This suggestion has expired.");
          return json({ ok: true });
        }
        if (preflight.outcome === "ALREADY_RESOLVED") {
          await answerCallback(TELEGRAM_BOT_TOKEN, callback.id, "This suggestion was already handled.");
          return json({ ok: true });
        }
        if (preflight.outcome !== "ELIGIBLE") {
          await answerCallback(
            TELEGRAM_BOT_TOKEN,
            callback.id,
            preflight.reason === "actor_not_operator"
              ? "Only this project's owners and admins can do this."
              : "This suggestion could not be handled.",
          );
          return json({ ok: true });
        }

        // The candidate's OWN chat, never the chat the tap claims to be in.
        const candidateChatId = Number(preflight.telegram_chat_id);
        if (!Number.isFinite(candidateChatId)) {
          await answerCallback(TELEGRAM_BOT_TOKEN, callback.id, "This suggestion could not be handled.");
          return json({ ok: true });
        }

        // CONTEXT BINDING, BEFORE live verification and BEFORE any resolve.
        // A tap delivered from any chat other than the candidate's own chat is
        // refused outright: nothing is verified, nothing is mutated, and the
        // candidate stays PENDING for an authorized admin in the right group.
        if (String(candidateChatId) !== String(callbackChatId)) {
          await answerCallback(TELEGRAM_BOT_TOKEN, callback.id, "This suggestion could not be handled.");
          return json({ ok: true });
        }


        let lfStatus = "";
        try {
          const member = await telegramJson(TELEGRAM_BOT_TOKEN, "getChatMember", {
            chat_id: candidateChatId,
            user_id: Number(from.id),
          });
          lfStatus = String((member as { status?: unknown })?.status ?? "");
        } catch {
          await answerCallback(TELEGRAM_BOT_TOKEN, callback.id, "Telegram could not confirm your group role. Try again shortly.");
          return json({ ok: true });
        }
        if (lfStatus !== "administrator" && lfStatus !== "creator") {
          // Nothing was mutated: the candidate stays PENDING.
          await answerCallback(TELEGRAM_BOT_TOKEN, callback.id, "Only current administrators of this group can do this.");
          return json({ ok: true });
        }

        // SE-7 — START is AUTHORIZED here but NOT consumed. The candidate only
        // becomes terminal STARTED after the branded card is confirmed SENT and
        // the schedule is activated, so a downstream failure leaves a fully
        // retryable candidate, prompt and source post in place.
        const { data: resolved } = await admin.rpc("resolve_social_mission_link_candidate", {
          _candidate_id: candidateId,
          _telegram_user_id: Number(from.id),
          _decision: smStart ? "START" : "IGNORE",
          _verified_chat_id: candidateChatId,
        });
        const decision = (resolved ?? {}) as {
          outcome?: string;
          reason?: string;
          canonical_url?: string;
          prompt_message_id?: number;
          telegram_message_id?: number;
          source_deleted_at?: string | null;
        };

        if (decision.outcome === "EXPIRED") {
          await answerCallback(TELEGRAM_BOT_TOKEN, callback.id, "This suggestion has expired.");
          return json({ ok: true });
        }
        if (decision.outcome === "ALREADY_RESOLVED") {
          await answerCallback(TELEGRAM_BOT_TOKEN, callback.id, "This suggestion was already handled.");
          return json({ ok: true });
        }
        if (decision.outcome !== "START" && decision.outcome !== "IGNORE") {
          await answerCallback(
            TELEGRAM_BOT_TOKEN,
            callback.id,
            decision.reason === "actor_not_operator"
              ? "Only this project's owners and admins can do this."
              : "This suggestion could not be handled.",
          );
          return json({ ok: true });
        }

        const promptMessageId = typeof decision.prompt_message_id === "number"
          ? decision.prompt_message_id
          : null;
        const deleteLinkFinderPrompt = async () => {
          if (promptMessageId === null) return;
          await telegramJson(TELEGRAM_BOT_TOKEN, "deleteMessage", {
            // The candidate's own chat, always. Never the callback chat.
            chat_id: candidateChatId,
            message_id: promptMessageId,
          }).catch(() => null);
        };

        /**
         * SE-10 — VISIBLE IN-PLACE PROMPT STATES.
         *
         * Every state below EDITS the one existing transient prompt message in
         * the candidate's own chat. No additional group message is ever created
         * and no state ever claims success: the branded canonical card remains
         * the only success signal. The inline controls stay attached in every
         * non-terminal state, with the SAME `sm_lf_start_` / `sm_lf_ignore_`
         * callback data, so a crash or a downstream failure can never leave an
         * invisible or unrecoverable PENDING candidate.
         */
        const linkFinderKeyboard = (startLabel: string) => ({
          inline_keyboard: [[
            { text: startLabel, callback_data: `sm_lf_start_${candidateId}` },
            { text: "IGNORE", callback_data: `sm_lf_ignore_${candidateId}` },
          ]],
        });
        const editLinkFinderPrompt = async (text: string, startLabel: string) => {
          if (promptMessageId === null) return;
          await editMessage(
            TELEGRAM_BOT_TOKEN,
            String(candidateChatId),
            promptMessageId,
            text,
            linkFinderKeyboard(startLabel),
          );
        };
        const LF_IDLE_TEXT = "This is an official project post. Admins can start a Social Mission for it.";
        const showStartingPrompt = () => editLinkFinderPrompt(
          "⏳ <b>Starting Social Mission…</b>\nChecking bot permissions and fetching live X metrics.\nThis usually takes a few seconds.",
          "RETRY START",
        );
        /** Names the EXACT missing right(s); both are shown when both are missing. */
        const showPermissionPrompt = async (
          text: string,
          detail?: { kind: "UNRESOLVED" | "NOT_ADMIN" | "MISSING_RIGHTS"; missing: string[] },
        ) => {
          const missing = detail?.missing ?? [];
          if (detail?.kind === "MISSING_RIGHTS" && missing.length > 0) {
            await editLinkFinderPrompt(
              `⚠️ <b>CARTEL HQ NEEDS ONE MORE PERMISSION</b>\nThe Social Mission has not started yet.\n\nMissing: ${escapeHtml(missing.join(", "))}\n\nFix it:\nGroup Settings → Administrators → @${escapeHtml(BOT_USERNAME)} → enable ${escapeHtml(missing.join(" and "))}\n\nThen tap RETRY START.`,
              "RETRY START",
            );
            return;
          }
          await editLinkFinderPrompt(
            `⚠️ <b>ACTION REQUIRED</b>\nThe Social Mission has not started yet.\n\n${escapeHtml(text)}\n\nThen tap RETRY START.`,
            "RETRY START",
          );
        };
        /** A recoverable downstream failure: never left stuck on "Starting…". */
        const showRetryablePrompt = (note: string) => editLinkFinderPrompt(
          `${LF_IDLE_TEXT}\n\n${escapeHtml(note)}`,
          "RETRY START",
        );

        if (decision.outcome === "IGNORE") {
          // IGNORE consumes the candidate and removes ONLY the transient
          // prompt. The member's original X post is never deleted here.
          await deleteLinkFinderPrompt();
          await answerCallback(TELEGRAM_BOT_TOKEN, callback.id, "Ignored.");
          return json({ ok: true });
        }

        // The candidate's REAL original message id is the provenance and
        // idempotency key. A null/0 id collided on
        // telegram_inbound_updates (chat_id, message_id) for every second
        // Link Finder START in the same group.
        const sourceMessageId = Number(decision.telegram_message_id);
        if (!Number.isFinite(sourceMessageId) || sourceMessageId <= 0) {
          await answerCallback(TELEGRAM_BOT_TOKEN, callback.id, "This suggestion could not be handled.");
          return json({ ok: true });
        }

        // SE-9 — the source post is normally already gone (deleted at
        // detection). This is the bounded retry for the case where detection
        // could not remove it: it runs BEFORE anything is created, costs no
        // Telegram call when the candidate is already recorded clean, and on
        // failure creates NOTHING, leaves the candidate PENDING and the prompt
        // in place, and returns a precise permission message.
        const sourceReady = await ensureLinkFinderSourceDeleted({
          candidateId,
          chatId: String(candidateChatId),
          sourceMessageId,
          alreadyDeletedAt: decision.source_deleted_at ?? null,
        });
        if (!sourceReady) {
          // SE-10 — the same missing right is also rendered IN PLACE on the
          // prompt, so it cannot be missed once the toast disappears. Nothing
          // was created and the candidate stays PENDING and retryable.
          await showPermissionPrompt("", { kind: "MISSING_RIGHTS", missing: ["Delete Messages"] });
          await answerCallback(
            TELEGRAM_BOT_TOKEN,
            callback.id,
            "I could not remove the original link post. Give @PepeCartelHQBot the Delete Messages admin right, then tap RETRY START.",
          );
          return json({ ok: true });
        }

        // SE-8 — the callback is answered from INSIDE the launch: a refused
        // permission preflight answers with the precise missing right and
        // nothing is created, while a passed preflight acknowledges the real
        // latency source (the first live official-X snapshot) without ever
        // claiming success. Exactly one answer is sent either way.
        // SE-10 — the transient prompt is the single visible surface for this
        // launch: it shows the starting state, any ACTION REQUIRED state and
        // any retryable failure, and it is deleted only on a settled launch.
        let startingShown = false;
        let promptResolved = false;
        let missionSettled = false;
        await runMissionCommand({
          // The mission is launched into the candidate's OWN chat, always.
          chatId: String(candidateChatId),
          chatType: String(callbackChat?.type ?? ""),
          updateId: update?.update_id,
          // The candidate's own source message: provenance and idempotency key
          // only. SE-9 already deleted the post itself at detection time.
          messageId: sourceMessageId,
          telegramUserId: Number(from.id),
          argument: String(decision.canonical_url ?? ""),
          source: "telegram_link_finder",
          // SE-8 — refused BEFORE anything was created. The candidate stays
          // PENDING, the prompt stays, the source post stays.
          // SE-10 — the exact missing right is ALSO rendered in place on that
          // same prompt, with a RETRY START control, so it survives the toast.
          onPermissionBlocked: async (text, detail) => {
            promptResolved = true;
            await showPermissionPrompt(text, detail);
            await answerCallback(TELEGRAM_BOT_TOKEN, callback.id, text);
          },
          // SE-8 — honest immediate feedback. No group message, no clutter, no
          // prefetched X read and no weakened first real snapshot.
          // SE-10 — the same existing prompt is edited in place to a visible
          // starting state; the inline controls remain attached.
          onStartAccepted: async () => {
            startingShown = true;
            await showStartingPrompt();
            await answerCallback(
              TELEGRAM_BOT_TOKEN,
              callback.id,
              "Starting mission… fetching live X metrics.",
            );
          },
          // Only a mission that actually reached a confirmed card + active
          // schedule (or a retry finding one already sent) removes the prompt
          // and finalizes the candidate. Anything else — create failure,
          // delivery failure, activation failure — never runs this, so the
          // prompt, the source post and the PENDING candidate all survive for
          // a clean retry.
          onMissionSettled: async (settled) => {
            // FINALIZE FIRST. The candidate is the durable record; the prompt
            // is only a transient button. Removing the prompt before the
            // database agrees would leave an invisible, unrecoverable
            // suggestion. A failed or rejected finalization therefore leaves
            // the prompt in place and the candidate PENDING for a clean retry.
            const { data: finalized, error: finalizeError } = await admin.rpc(
              "finalize_social_mission_link_candidate_start",
              {
                _candidate_id: candidateId,
                _telegram_user_id: Number(from.id),
                _verified_chat_id: candidateChatId,
                _mission_id: settled.missionId,
              },
            );
            const finalization = (finalized ?? {}) as { outcome?: string; mission_id?: string };
            const finalOutcome = String(finalization.outcome ?? "");
            const sameMission = finalOutcome === "FINALIZED"
              || (finalOutcome === "ALREADY_FINALIZED"
                && String(finalization.mission_id ?? "") === settled.missionId);
            if (finalizeError || !sameMission) return;

            missionSettled = true;
            promptResolved = true;
            await deleteLinkFinderPrompt();
          },

        });
        // SE-10 — a launch that began but did not settle must never leave the
        // prompt stuck on "Starting…". The prompt is restored to a retryable
        // state in place; nothing is created, deleted or finalized here and no
        // new chat message is sent.
        if (startingShown && !missionSettled && !promptResolved) {
          await showRetryablePrompt("The mission did not start. Tap RETRY START to try again.");
        }
        return json({ ok: true });


      }


      // C7.3 — Project Inbox console callbacks. Private chat only; every one
      // re-authorizes inside the service-only RPC before exposing anything.
      const piWorkspace = callbackData.match(/^pi_w_([0-9a-f-]{36})$/i);
      const piConversation = callbackData.match(/^pi_c_([0-9a-f-]{36})$/i);
      if ((piWorkspace || piConversation || callbackData === "pi_x") && callbackChat?.type === "private") {
        const operatorId = Number(from.id);
        if (callbackData === "pi_x") {
          await admin.rpc("bot_inbox_set_session", { _telegram_user_id: operatorId, _mode: "NONE", _workspace_id: null });
          await answerCallback(TELEGRAM_BOT_TOKEN, callback.id, "Inbox closed.");
          return json({ ok: true });
        }
        if (piWorkspace) {
          const workspaceId = String(piWorkspace[1]);
          const { data: wsData } = await admin.rpc("bot_inbox_operator_workspaces", { _telegram_user_id: operatorId });
          const match = (Array.isArray(wsData) ? wsData : []).find((w: any) => String(w.workspace_id) === workspaceId);
          if (!match) {
            await answerCallback(TELEGRAM_BOT_TOKEN, callback.id, "That workspace is not available.");
            return json({ ok: true });
          }
          await admin.rpc("bot_inbox_set_session", { _telegram_user_id: operatorId, _mode: "INBOX", _workspace_id: workspaceId });
          await answerCallback(TELEGRAM_BOT_TOKEN, callback.id, String(match.workspace_name ?? "Workspace"));
          await renderInboxList(operatorId, callbackChatId, workspaceId, String(match.workspace_name ?? "Workspace"));
          return json({ ok: true });
        }
        await answerCallback(TELEGRAM_BOT_TOKEN, callback.id, "Opening conversation…");
        await openInboxConversation(operatorId, callbackChatId, String(piConversation![1]));
        return json({ ok: true });
      }

      /**
       * SE-15 — Mission Control callbacks. PRIVATE CHAT ONLY. A tap forwarded
       * into a group can never reach a mutation: the guard below refuses any
       * `mc_*` data that did not arrive in a private chat, and every mutating
       * branch additionally re-runs gates 1-3 through `mcAuthorize`.
       */
      if (callbackData.startsWith("mc_")) {
        if (callbackChat?.type !== "private") {
          await answerCallback(TELEGRAM_BOT_TOKEN, callback.id, "Open Mission Control in a private chat.");
          return json({ ok: true });
        }
        const operatorId = Number(from.id);
        const updateId = update?.update_id;

        if (callbackData === "mc_x") {
          await admin.rpc("social_mission_control_set_session", {
            _telegram_user_id: operatorId,
            _workspace_id: null,
            _mission_id: null,
            _pending_field: null,
            _clear: true,
          });
          await answerCallback(TELEGRAM_BOT_TOKEN, callback.id, "Mission Control closed.");
          return json({ ok: true });
        }

        const mcWorkspace = callbackData.match(/^mc_w_([0-9a-f-]{36})$/i);
        if (mcWorkspace) {
          const workspaceId = String(mcWorkspace[1]);
          const { data: wsData } = await admin.rpc("social_mission_control_workspaces", {
            _telegram_user_id: operatorId,
          });
          const match = (Array.isArray(wsData) ? wsData : []).find(
            (w: any) => String(w.workspace_id) === workspaceId,
          );
          if (!match) {
            await answerCallback(TELEGRAM_BOT_TOKEN, callback.id, "That project is not available.");
            return json({ ok: true });
          }
          await answerCallback(TELEGRAM_BOT_TOKEN, callback.id, String((match as any).workspace_name ?? "Project"));
          await mcRenderMissionPicker(
            operatorId,
            callbackChatId,
            workspaceId,
            String((match as any).workspace_name ?? "Workspace"),
          );
          return json({ ok: true });
        }

        // Everything below addresses exactly one mission and is gated.
        const missionMatchId = callbackData.match(/([0-9a-f-]{36})$/i);
        if (!missionMatchId) {
          await answerCallback(TELEGRAM_BOT_TOKEN, callback.id, "That control is no longer valid.");
          return json({ ok: true });
        }
        const missionId = String(missionMatchId[1]);
        const auth = await mcAuthorize(operatorId, missionId);
        if (!auth.ok) {
          await answerCallback(TELEGRAM_BOT_TOKEN, callback.id, auth.reason);
          return json({ ok: true });
        }
        const binding = auth.binding;
        await admin.rpc("social_mission_control_set_session", {
          _telegram_user_id: operatorId,
          _workspace_id: binding.workspaceId,
          _mission_id: missionId,
          _pending_field: null,
          _clear: false,
        });

        // Open / refresh the panel.
        if (callbackData === `mc_m_${missionId}` || callbackData === `mc_p_${missionId}`) {
          await answerCallback(TELEGRAM_BOT_TOKEN, callback.id, "Mission Control");
          await mcRenderPanel(operatorId, callbackChatId, missionId, binding);
          return json({ ok: true });
        }

        // Targets menu.
        if (callbackData === `mc_t_${missionId}`) {
          await answerCallback(TELEGRAM_BOT_TOKEN, callback.id, "Edit targets");
          await sendMessage(
            TELEGRAM_BOT_TOKEN,
            callbackChatId,
            "<b>🎯 EDIT TARGETS</b>\n\nPick what to change. Send a whole number when asked, or send <b>off</b> to remove a supporting target.",
            { parse_mode: "HTML", reply_markup: mcTargetsKeyboard(missionId) },
          );
          return json({ ok: true });
        }

        // RESET TO AUTO. History is preserved; only the active override drops.
        if (callbackData === `mc_auto_${missionId}`) {
          const { data, error } = await admin.rpc("social_mission_apply_target_override", {
            _telegram_user_id: operatorId,
            _mission_id: missionId,
            _verified_chat_id: Number(binding.chatId),
            _mode: "AUTO",
            _primary_type: null,
            _primary_target: null,
            _views: null,
            _likes: null,
            _replies: null,
            _reposts: null,
            _bookmarks: null,
            _idempotency_key: await mcKey(updateId, "reset_auto"),
          });
          const outcome = String((data as any)?.outcome ?? (error ? "denied" : "denied"));
          if (outcome !== "ok" && outcome !== "replayed") {
            await answerCallback(TELEGRAM_BOT_TOKEN, callback.id, MC_OUTCOME_TEXT[outcome] ?? "That change was refused.");
            return json({ ok: true });
          }
          await answerCallback(TELEGRAM_BOT_TOKEN, callback.id, "Targets reset to automatic.");
          if (outcome === "ok") {
            await mcRefreshCard({
              workspaceId: binding.workspaceId,
              missionId,
              actorUserId: linked?.user_id ? String(linked.user_id) : null,
              seed: `${updateId}:reset_auto`,
            });
          }
          await mcRenderPanel(operatorId, callbackChatId, missionId, binding, "Targets are automatic again.");
          return json({ ok: true });
        }

        // Primary Goal type menu.
        if (callbackData === `mc_f_pg_${missionId}`) {
          await answerCallback(TELEGRAM_BOT_TOKEN, callback.id, "Primary Goal");
          await sendMessage(
            TELEGRAM_BOT_TOKEN,
            callbackChatId,
            "<b>🏆 PRIMARY GOAL</b>\n\nChoose the metric the mission is judged on. Bookmarks cannot be a Primary Goal.",
            {
              parse_mode: "HTML",
              reply_markup: {
                inline_keyboard: [
                  ...MISSION_CONTROL_PRIMARY_TYPES.map((type) => [
                    {
                      text: MISSION_CONTROL_PRIMARY_LABELS[type],
                      callback_data: `mc_g_${type}_${missionId}`,
                    },
                  ]),
                  [{ text: "⬅️ Back", callback_data: `mc_t_${missionId}` }],
                ],
              },
            },
          );
          return json({ ok: true });
        }

        const mcGoal = callbackData.match(/^mc_g_([A-Z_]+)_([0-9a-f-]{36})$/);
        if (mcGoal) {
          const type = String(mcGoal[1]) as MissionControlPrimaryType;
          if (!(MISSION_CONTROL_PRIMARY_TYPES as readonly string[]).includes(type)) {
            await answerCallback(TELEGRAM_BOT_TOKEN, callback.id, "That Primary Goal is not valid.");
            return json({ ok: true });
          }
          const applied = await mcApplyTargets({
            telegramUserId: operatorId,
            binding,
            updateId,
            patch: { primaryType: type },
          });
          if ((applied as any).outcome === "needs_primary_target") {
            await admin.rpc("social_mission_control_set_session", {
              _telegram_user_id: operatorId,
              _workspace_id: binding.workspaceId,
              _mission_id: missionId,
              _pending_field: "PRIMARY_TARGET",
              _clear: false,
            });
            await answerCallback(TELEGRAM_BOT_TOKEN, callback.id, "Send the target number.");
            await sendMessage(
              TELEGRAM_BOT_TOKEN,
              callbackChatId,
              `<b>${escapeHtml(MISSION_CONTROL_PRIMARY_LABELS[type])}</b> needs a target.\n\nSend a whole number above zero.`,
              { parse_mode: "HTML" },
            );
            return json({ ok: true });
          }
          const outcome = String((applied as any).outcome ?? "denied");
          if (outcome !== "ok" && outcome !== "replayed") {
            await answerCallback(TELEGRAM_BOT_TOKEN, callback.id, MC_OUTCOME_TEXT[outcome] ?? "That change was refused.");
            return json({ ok: true });
          }
          await answerCallback(TELEGRAM_BOT_TOKEN, callback.id, "Primary Goal updated.");
          if (outcome === "ok") {
            await mcRefreshCard({
              workspaceId: binding.workspaceId,
              missionId,
              actorUserId: linked?.user_id ? String(linked.user_id) : null,
              seed: `${updateId}:goal:${type}`,
            });
          }
          await mcRenderPanel(operatorId, callbackChatId, missionId, binding, "Primary Goal updated.");
          return json({ ok: true });
        }

        // A metric button only ARMS a short-lived pending numeric input state.
        const mcField = callbackData.match(/^mc_f_([a-z]+)_([0-9a-f-]{36})$/);
        if (mcField) {
          const metric = String(mcField[1]) as MissionControlMetric;
          if (!(MISSION_CONTROL_METRICS as readonly string[]).includes(metric)) {
            await answerCallback(TELEGRAM_BOT_TOKEN, callback.id, "That control is no longer valid.");
            return json({ ok: true });
          }
          await admin.rpc("social_mission_control_set_session", {
            _telegram_user_id: operatorId,
            _workspace_id: binding.workspaceId,
            _mission_id: missionId,
            _pending_field: metric.toUpperCase(),
            _clear: false,
          });
          await answerCallback(TELEGRAM_BOT_TOKEN, callback.id, "Send the number.");
          await sendMessage(
            TELEGRAM_BOT_TOKEN,
            callbackChatId,
            `<b>${escapeHtml(MISSION_CONTROL_METRIC_LABELS[metric])}</b>\n\nSend a whole number above zero, or send <b>off</b> to remove this target.`,
            { parse_mode: "HTML" },
          );
          return json({ ok: true });
        }

        // End time.
        if (callbackData === `mc_d_${missionId}`) {
          await answerCallback(TELEGRAM_BOT_TOKEN, callback.id, "Change end time");
          await sendMessage(
            TELEGRAM_BOT_TOKEN,
            callbackChatId,
            "<b>⏱ CHANGE END TIME</b>\n\nThe mission will end this long from now. Remaining pulses are rescheduled inside the new window; already-sent updates are never changed.",
            { parse_mode: "HTML", reply_markup: mcDurationKeyboard(missionId) },
          );
          return json({ ok: true });
        }
        if (callbackData === `mc_dc_${missionId}`) {
          await admin.rpc("social_mission_control_set_session", {
            _telegram_user_id: operatorId,
            _workspace_id: binding.workspaceId,
            _mission_id: missionId,
            _pending_field: "DURATION_MINUTES",
            _clear: false,
          });
          await answerCallback(TELEGRAM_BOT_TOKEN, callback.id, "Send the minutes.");
          await sendMessage(
            TELEGRAM_BOT_TOKEN,
            callbackChatId,
            "Send how many minutes from now the mission should end (1 to 1440).",
          );
          return json({ ok: true });
        }
        const mcQuick = callbackData.match(/^mc_dq_([0-9]{1,4})_([0-9a-f-]{36})$/);
        if (mcQuick) {
          const minutes = Number(mcQuick[1]);
          const { data, error } = await admin.rpc("social_mission_apply_duration_override", {
            _telegram_user_id: operatorId,
            _mission_id: missionId,
            _verified_chat_id: Number(binding.chatId),
            _minutes_from_now: minutes,
            _idempotency_key: await mcKey(updateId, `duration:${minutes}`),
          });
          const outcome = String((data as any)?.outcome ?? (error ? "denied" : "denied"));
          if (outcome !== "ok" && outcome !== "replayed") {
            await answerCallback(TELEGRAM_BOT_TOKEN, callback.id, MC_OUTCOME_TEXT[outcome] ?? "That change was refused.");
            return json({ ok: true });
          }
          await answerCallback(TELEGRAM_BOT_TOKEN, callback.id, "End time updated.");
          if (outcome === "ok") {
            await mcRefreshCard({
              workspaceId: binding.workspaceId,
              missionId,
              actorUserId: linked?.user_id ? String(linked.user_id) : null,
              seed: `${updateId}:duration:${minutes}`,
            });
          }
          await mcRenderPanel(operatorId, callbackChatId, missionId, binding, "End time updated.");
          return json({ ok: true });
        }

        // END MISSION NOW — confirmation first, then the mission-specific RPC.
        if (callbackData === `mc_e_${missionId}`) {
          await answerCallback(TELEGRAM_BOT_TOKEN, callback.id, "Confirm?");
          await sendMessage(
            TELEGRAM_BOT_TOKEN,
            callbackChatId,
            "<b>🏁 END MISSION NOW?</b>\n\nThe mission card is updated in place to COMPLETED with its final stored results. Remaining updates stop. This cannot be undone.",
            {
              parse_mode: "HTML",
              reply_markup: {
                inline_keyboard: [
                  [{ text: "✅ Yes, end it now", callback_data: `mc_ec_${missionId}` }],
                  [{ text: "⬅️ Keep it running", callback_data: `mc_p_${missionId}` }],
                ],
              },
            },
          );
          return json({ ok: true });
        }
        if (callbackData === `mc_ec_${missionId}`) {
          const { data, error } = await admin.rpc("end_social_mission_from_control", {
            _telegram_user_id: operatorId,
            _mission_id: missionId,
            _verified_chat_id: Number(binding.chatId),
            _idempotency_key: await mcKey(updateId, "end_now"),
          });
          const result = (data ?? {}) as Record<string, unknown>;
          const outcome = String(result["outcome"] ?? (error ? "denied" : "denied"));
          if (outcome !== "ok") {
            await answerCallback(TELEGRAM_BOT_TOKEN, callback.id, MC_OUTCOME_TEXT[outcome] ?? "That mission could not be ended.");
            return json({ ok: true });
          }
          await answerCallback(TELEGRAM_BOT_TOKEN, callback.id, "Ending the mission…");
          // The transport performs the existing best-effort FINAL official X
          // snapshot for a COMPLETED mission, guarded by its own current-minute
          // duplicate-read guard: at most one read, never retried here.
          const transport = await mcRefreshCard({
            workspaceId: binding.workspaceId,
            missionId,
            actorUserId: linked?.user_id ? String(linked.user_id) : null,
            seed: `${updateId}:end_now`,
          });
          const editState = String(transport?.editState ?? "");
          await admin.rpc("finish_social_mission_schedule_event", {
            _event_id: result["schedule_event_id"],
            _state: editState === "EDITED" ? "SENT" : editState === "FAILED" ? "FAILED" : "AMBIGUOUS",
            _telegram_message_id: null,
            _last_error: editState === "EDITED" ? null : "The manual end edit was not confirmed.",
          });
          await mcSafeUnpin(missionId, binding.workspaceId);
          await sendMessage(
            TELEGRAM_BOT_TOKEN,
            callbackChatId,
            editState === "EDITED"
              ? "This mission is complete. The mission card in the community has been updated."
              : "This mission is complete. Its card could not be updated in place; do not resend it.",
          );
          return json({ ok: true });
        }

        // CANCEL MISSION — zero provider reads.
        if (callbackData === `mc_c_${missionId}`) {
          await answerCallback(TELEGRAM_BOT_TOKEN, callback.id, "Confirm?");
          await sendMessage(
            TELEGRAM_BOT_TOKEN,
            callbackChatId,
            "<b>🛑 CANCEL MISSION?</b>\n\nThe mission card is updated in place to CANCELLED. No final results are claimed and remaining updates stop. This cannot be undone.",
            {
              parse_mode: "HTML",
              reply_markup: {
                inline_keyboard: [
                  [{ text: "✅ Yes, cancel it", callback_data: `mc_cc_${missionId}` }],
                  [{ text: "⬅️ Keep it running", callback_data: `mc_p_${missionId}` }],
                ],
              },
            },
          );
          return json({ ok: true });
        }
        if (callbackData === `mc_cc_${missionId}`) {
          const { data, error } = await admin.rpc("cancel_social_mission_from_control", {
            _telegram_user_id: operatorId,
            _mission_id: missionId,
            _verified_chat_id: Number(binding.chatId),
            _idempotency_key: await mcKey(updateId, "cancel"),
          });
          const result = (data ?? {}) as Record<string, unknown>;
          const outcome = String(result["outcome"] ?? (error ? "denied" : "denied"));
          if (outcome !== "ok") {
            await answerCallback(TELEGRAM_BOT_TOKEN, callback.id, MC_OUTCOME_TEXT[outcome] ?? "That mission could not be cancelled.");
            return json({ ok: true });
          }
          await answerCallback(TELEGRAM_BOT_TOKEN, callback.id, "Cancelling the mission…");
          const transport = await mcRefreshCard({
            workspaceId: binding.workspaceId,
            missionId,
            actorUserId: linked?.user_id ? String(linked.user_id) : null,
            seed: `${updateId}:cancel`,
          });
          await mcSafeUnpin(missionId, binding.workspaceId);
          await sendMessage(
            TELEGRAM_BOT_TOKEN,
            callbackChatId,
            String(transport?.editState ?? "") === "EDITED"
              ? "This mission is cancelled. The mission card in the community has been updated."
              : "This mission is cancelled. Its card could not be updated in place; do not resend it.",
          );
          return json({ ok: true });
        }

        await answerCallback(TELEGRAM_BOT_TOKEN, callback.id, "That control is no longer valid.");
        return json({ ok: true });
      }


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
      const lwUnwatch = callbackData.match(/^lw_unwatch_([a-f0-9]{24})$/);
      const lwRewatch = callbackData.match(/^lw_rewatch_([a-f0-9]{24})$/);
      const lnRemindersOff = callbackData.match(/^ln_reminders_off_([a-f0-9]{24})$/);
      const lnRemindersOn = callbackData.match(/^ln_reminders_on_([a-f0-9]{24})$/);
      const lnUpdatesOff = callbackData.match(/^ln_updates_off_([a-f0-9]{24})$/);
      const lnUpdatesOn = callbackData.match(/^ln_updates_on_([a-f0-9]{24})$/);
      if (lwUnwatch || lwRewatch || lnRemindersOff || lnRemindersOn || lnUpdatesOff || lnUpdatesOn) {
        const token = String(
          lwUnwatch?.[1] ??
            lwRewatch?.[1] ??
            lnRemindersOff?.[1] ??
            lnRemindersOn?.[1] ??
            lnUpdatesOff?.[1] ??
            lnUpdatesOn?.[1],
        );
        const resolved = await resolveLaunchWatch(token);
        if (!resolved) {
          await answerCallback(TELEGRAM_BOT_TOKEN, callback.id, "This Launch Watch link is no longer available.");
          return json({ ok: true });
        }
        const { launch, profile } = resolved;
        const telegramUserId = Number(from.id);
        const rewatchAllowed = canRewatchNow(launch, profile);

        const renderLaunchWatch = async (
          text: string,
          watching: boolean,
          remindersEnabled: boolean,
          updatesEnabled: boolean,
        ) => {
          const markup = launchWatchKeyboard(
            token,
            watching,
            remindersEnabled,
            rewatchAllowed,
            profile,
            updatesEnabled,
          );
          if (callback.message?.message_id) {
            await editMessage(TELEGRAM_BOT_TOKEN, callbackChatId, Number(callback.message.message_id), text, markup);
          } else {
            await sendMessage(TELEGRAM_BOT_TOKEN, callbackChatId, text, { parse_mode: "HTML", reply_markup: markup });
          }
        };

        if (lnUpdatesOff || lnUpdatesOn) {
          const enable = Boolean(lnUpdatesOn);
          const existing = await readLaunchWatchRow(launch.id, telegramUserId);
          if (!existing?.id || existing.is_active !== true) {
            await answerCallback(
              TELEGRAM_BOT_TOKEN,
              callback.id,
              "You are not currently watching this launch.",
            );
            return json({ ok: true });
          }
          await setLaunchWatchUpdates(existing.id, enable, new Date().toISOString());
          await answerCallback(
            TELEGRAM_BOT_TOKEN,
            callback.id,
            enable ? "Project updates enabled." : "Project updates muted.",
          );
          const body = enable
            ? "📣 Project updates are on. The project team can send you occasional updates about this launch."
            : "🔇 Project updates are muted. You will still get your countdown reminders (if enabled), the official-contract registration notice and the launch-live alert while you are watching.";
          await renderLaunchWatch(
            `${launchWatchIntro(launch, profile)}\n\n${body}`,
            true,
            existing.reminders_enabled !== false,
            enable,
          );
          return json({ ok: true });
        }

        if (lnRemindersOff || lnRemindersOn) {
          const enable = Boolean(lnRemindersOn);
          const existing = await readLaunchWatchRow(launch.id, telegramUserId);
          if (!existing?.id || existing.is_active !== true) {
            await answerCallback(
              TELEGRAM_BOT_TOKEN,
              callback.id,
              "You are not currently watching this launch.",
            );
            return json({ ok: true });
          }
          // Enabling countdowns only makes sense while the launch can still
          // produce them. Never claim success after that window has closed.
          if (enable && !rewatchAllowed) {
            await answerCallback(
              TELEGRAM_BOT_TOKEN,
              callback.id,
              "Countdown reminders have ended for this launch.",
            );
            const endedText = `${launchWatchIntro(launch, profile)}\n\n⏳ Countdown reminders can no longer be enabled for this launch. You are still watching it.`;
            await renderLaunchWatch(
              endedText,
              true,
              existing.reminders_enabled !== false,
              existing.updates_enabled === true,
            );
            return json({ ok: true });
          }
          await setLaunchWatchReminders(existing.id, enable, new Date().toISOString());
          await answerCallback(
            TELEGRAM_BOT_TOKEN,
            callback.id,
            enable ? "Countdown reminders enabled." : "Countdown reminders muted.",
          );
          const body = enable
            ? "⏳ Countdown reminders are on. You will get the 24-hour and 1-hour reminders, plus the official-contract packet and the launch-live alert."
            : "🔇 Countdown reminders are muted. You will still get the official-contract registration notice and the launch-live alert while you are watching.";
          await renderLaunchWatch(
            `${launchWatchIntro(launch, profile)}\n\n${body}`,
            true,
            enable,
            existing.updates_enabled === true,
          );
          return json({ ok: true });
        }

        if (lwUnwatch) {
          const priorRow = await readLaunchWatchRow(launch.id, telegramUserId);
          const outcome = await launchWatchUnsubscribe(launch.id, telegramUserId);
          const answer =
            outcome === "not_found"
              ? "You were not watching this launch."
              : outcome === "already_inactive"
                ? "You had already stopped watching this launch."
                : "You stopped watching this launch.";
          await answerCallback(TELEGRAM_BOT_TOKEN, callback.id, answer);
          const body =
            outcome === "not_found"
              ? "🔕 You are not currently watching this launch. No Launch Watch messages will be sent to you."
              : "🔕 You are no longer watching this launch. No further Launch Watch messages will be sent to you.";
          await renderLaunchWatch(
            `${launchWatchIntro(launch, profile)}\n\n${body}`,
            false,
            priorRow?.reminders_enabled !== false,
            priorRow?.updates_enabled === true,
          );
          return json({ ok: true });
        }

        const blocked = launchWatchGate(launch, profile);
        if (blocked) {
          await answerCallback(TELEGRAM_BOT_TOKEN, callback.id, blocked);
          return json({ ok: true });
        }
        const rewatched = await launchWatchSubscribe(launch.id, telegramUserId);
        await answerCallback(TELEGRAM_BOT_TOKEN, callback.id, "You're watching this launch again.");
        const packet =
          String(launch.status) === "OFFICIAL_CONTRACT_REGISTERED"
            ? officialContractNotice(launch, profile)
            : "";
        const text = `${launchWatchIntro(launch, profile)}\n\n🔔 You are watching this launch again.${launchWatchDisclaimer}${packet}`;
        await renderLaunchWatch(text, true, rewatched.remindersEnabled, rewatched.updatesEnabled);
        return json({ ok: true });
      }

      return json({ ok: true });
    }

    const memberUpdate = update?.my_chat_member;
    if (memberUpdate?.chat?.id != null) {
      const chatId = String(memberUpdate.chat.id), status = String(memberUpdate.new_chat_member?.status ?? ""), actor = memberUpdate.from;
      const { data: existing } = await admin.from("telegram_group_connections").select("id,title,metadata,connected_by").eq("telegram_chat_id", chatId).maybeSingle();
      if (existing?.id) {
        const prior = existing.metadata && typeof existing.metadata === "object" ? existing.metadata as Record<string, unknown> : {};
        const nowIso = new Date().toISOString();
        const botRemoved = status === "left" || status === "kicked";

        // Bot removal is an expected community lifecycle event, never an error.
        // The connection row, its settings and its history are always preserved.
        if (botRemoved) {
          const priorStatus = String(prior.last_member_status ?? "");
          const alreadyRemoved = (priorStatus === "left" || priorStatus === "kicked") && Boolean(prior.bot_removed_at);
          await admin.from("telegram_group_connections").update({
            bot_is_admin: false,
            can_set_sticker_set: false,
            verified_at: nowIso,
            metadata: {
              ...prior,
              last_member_status: status,
              bot_can_change_info: false,
              official_group_sticker_eligible: false,
              bot_removed_at: alreadyRemoved ? prior.bot_removed_at : nowIso,
              bot_removed_reason: status,
            },
          }).eq("id", existing.id);

          // Pause ONLY currently enabled drops for this community.
          try {
            await admin.from("sticker_drop_schedules")
              .update({ enabled: false, paused_reason: "bot_removed" })
              .eq("group_connection_id", existing.id)
              .eq("enabled", true);
          } catch (e) {
            console.error("[telegram-webhook] pause drops", e instanceof Error ? e.message : "unknown");
          }

          // Best-effort DM to the Cartel HQ user who connected the community.
          if (!alreadyRemoved && existing.connected_by) {
            try {
              const { data: conn } = await admin.from("telegram_connections").select("telegram_user_id").eq("user_id", existing.connected_by).maybeSingle();
              const dmChatId = conn?.telegram_user_id ? String(conn.telegram_user_id) : "";
              if (dmChatId) {
                const title = escapeHtml(String(existing.title ?? "your community"));
                await sendMessage(
                  TELEGRAM_BOT_TOKEN,
                  dmChatId,
                  `⚠️ <b>@${BOT_USERNAME} was removed from ${title}.</b>\n\n` +
                  `Community automations that need bot access (Sticker Drops, welcomes, native sticker delivery) are now <b>paused</b> for that community.\n\n` +
                  `Your CARTEL HQ account, workspace and saved settings remain active. Nothing was cancelled and no billing change occurred. You can keep using CARTEL HQ without the bot.\n\n` +
                  `Whenever you are ready, re-add the bot as an administrator and reconnect the community. Your paused settings resume from where they left off.`,
                  { parse_mode: "HTML", reply_markup: { inline_keyboard: [[{ text: "🏘️ Re-add bot to a community", url: GROUP_INSTALL_URL }]] } },
                );
              }
            } catch (e) {
              console.error("[telegram-webhook] removal DM", e instanceof Error ? e.message : "unknown");
            }
          }
          return json({ ok: true });
        }

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
        const officialReason = canSet ? null : resolvedChatType !== "supergroup" ? "requires_supergroup" : "not_reported";
        const restored = botIsAdmin && botCanChangeInfo;
        const nextMeta: Record<string, unknown> = { ...prior, last_member_status: status, bot_can_change_info: botCanChangeInfo, member_count: memberCount, official_group_sticker_min_members: null, official_group_sticker_eligible: canSet, official_group_sticker_reason: officialReason };
        if (restored) { nextMeta.bot_removed_at = null; nextMeta.bot_removed_reason = null; }
        await admin.from("telegram_group_connections").update({ chat_type: resolvedChatType || "group", bot_is_admin: botIsAdmin, can_set_sticker_set: canSet, verified_at: nowIso, metadata: nextMeta }).eq("id", existing.id);

        // Restore ONLY schedules this system paused. Manually disabled ones stay off.
        if (restored) {
          try {
            const { data: paused } = await admin.from("sticker_drop_schedules").select("id,interval_minutes").eq("group_connection_id", existing.id).eq("paused_reason", "bot_removed");
            for (const row of paused ?? []) {
              const minutes = Number((row as any).interval_minutes) > 0 ? Number((row as any).interval_minutes) : 60;
              await admin.from("sticker_drop_schedules").update({
                enabled: true,
                paused_reason: null,
                consecutive_failures: 0,
                next_run_at: new Date(Date.now() + minutes * 60_000).toISOString(),
              }).eq("id", (row as any).id);
            }
          } catch (e) {
            console.error("[telegram-webhook] restore drops", e instanceof Error ? e.message : "unknown");
          }
        }
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
            ? [await systemMessage("account_found", title, accountFoundText), groupAcquisitionKeyboard(chatId, false)]
            : [await systemMessage("bot_installed", title, botInstalledText), groupAcquisitionKeyboard(chatId, true)];

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
      const { data: settings } = await admin.from("telegram_community_settings").select("welcome_enabled,welcome_message,mention_member,auto_delete_enabled,auto_delete_seconds,launch_watch_cta_enabled,launch_watch_launch_id,launch_watch_show_website,launch_watch_show_telegram,launch_watch_show_x,launch_watch_cta_auto_delete_seconds,workspace_id,metadata").eq("group_connection_id", connection.id).maybeSingle();
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

      /**
       * Phase 5.2 — the Launch Watch CTA is a SEPARATE compact card sent after
       * the welcome, with its own lifetime. Public group buttons only open the
       * PRIVATE bot deep link; mute/stop controls stay in the DM. Any staleness
       * or failure here degrades to the normal welcome alone.
       */
      const LW_OPEN_STATUSES = ["WATCHLIST_OPEN", "LAUNCH_APPROACHING", "CONTRACT_PENDING", "OFFICIAL_CONTRACT_REGISTERED"];
      const LW_TOKEN_PATTERN = /^[0-9a-f]{24}$/;
      const LW_CTA_LIFETIMES = [300, 600, 900, 1800, 3600];
      const LW_CTA_LIFETIME_DEFAULT = 900;
      const isHttpUrl = (value: unknown) => {
        if (typeof value !== "string" || !value.trim()) return false;
        try { const u = new URL(value.trim()); return u.protocol === "https:" || u.protocol === "http:"; } catch { return false; }
      };
      let ctaKeyboard: any = null;
      let ctaText = "";
      let ctaResult = "disabled";
      if (settings.launch_watch_cta_enabled === true && settings.launch_watch_launch_id) {
        try {
          const { data: launchRow, error: launchError } = await admin.from("launches")
            .select("id,status,token_name,ticker,chain,launch_watch_token,workspace_id,project_profiles(workspace_id,project_name,discovery_status,website_url,telegram_url,x_url)")
            .eq("id", String(settings.launch_watch_launch_id))
            .eq("workspace_id", String(settings.workspace_id))
            .maybeSingle();
          if (launchError) throw launchError;
          const profile: any = Array.isArray((launchRow as any)?.project_profiles) ? (launchRow as any).project_profiles[0] : (launchRow as any)?.project_profiles;
          const eligible = Boolean(launchRow)
            && LW_OPEN_STATUSES.includes(String((launchRow as any).status))
            && LW_TOKEN_PATTERN.test(String((launchRow as any).launch_watch_token ?? ""))
            // The Project Profile must belong to the SAME workspace as this community.
            && String(profile?.workspace_id ?? "") === String(settings.workspace_id)
            && profile?.discovery_status === "published";

          if (eligible) {
            const rows: any[] = [[{ text: "🔔 Watch this launch", url: `https://t.me/${BOT_USERNAME}?start=lw_${String((launchRow as any).launch_watch_token)}` }]];
            const links: any[] = [];
            if (settings.launch_watch_show_website === true && isHttpUrl(profile?.website_url)) links.push({ text: "🌐 Website", url: String(profile.website_url).trim() });
            if (settings.launch_watch_show_telegram === true && isHttpUrl(profile?.telegram_url)) links.push({ text: "💬 Telegram", url: String(profile.telegram_url).trim() });
            if (settings.launch_watch_show_x === true && isHttpUrl(profile?.x_url)) links.push({ text: "𝕏 X", url: String(profile.x_url).trim() });
            for (let i = 0; i < links.length; i += 2) rows.push(links.slice(i, i + 2));
            ctaKeyboard = { inline_keyboard: rows };
            const projectName = escapeHtml(String(profile?.project_name ?? "Project")).toUpperCase();
            const meta = [String((launchRow as any).token_name ?? ""), (launchRow as any).ticker ? `$${String((launchRow as any).ticker)}` : "", String((launchRow as any).chain ?? "")]
              .filter((v) => v.trim().length > 0).map((v) => escapeHtml(v)).join(" • ");
            ctaText = `🚀 <b>${projectName} LAUNCH WATCH</b>\n${meta}\n\nGet official launch updates privately through @${BOT_USERNAME}.\nTap below to watch. Notifications are opt-in and can be muted or stopped anytime.\n\n<i>This is not a token safety audit or endorsement.</i>`;
            ctaResult = "eligible";
          } else {
            ctaResult = "skipped_ineligible";
          }
        } catch (e) {
          ctaResult = "error";
          console.error("[telegram-webhook] launch watch cta", e instanceof Error ? e.message : "unknown");
        }
      }

      // The welcome itself never carries the CTA keyboard.
      const sent = await sendMessage(TELEGRAM_BOT_TOKEN, chatId, rendered, { parse_mode: "HTML" });
      const sentId = (sent as any)?.message_id;

      const scheduleDelete = (targetId: number, delaySeconds: number, label: string) => {
        const cleanup = (async () => {
          await new Promise((resolve) => setTimeout(resolve, delaySeconds * 1000));
          try { await telegramJson(TELEGRAM_BOT_TOKEN, "deleteMessage", { chat_id: chatId, message_id: targetId }); }
          catch (e) { console.error(`[telegram-webhook] ${label} cleanup`, e instanceof Error ? e.message : "unknown"); }
        })();
        try { (globalThis as any).EdgeRuntime?.waitUntil?.(cleanup); } catch { }
      };

      /**
       * Only a delivered welcome may be followed by the separate CTA card. The
       * card's 5–60 minute lifetime is queued as a durable cleanup job — an Edge
       * Function cannot stay alive that long, so no long timer is used here.
       */
      let ctaMessageId: number | null = null;
      let ctaLifetime: number | null = null;
      let ctaCleanupScheduled = false;
      if (sentId && ctaKeyboard) {
        const rawLifetime = Number(settings.launch_watch_cta_auto_delete_seconds);
        ctaLifetime = LW_CTA_LIFETIMES.includes(rawLifetime) ? rawLifetime : LW_CTA_LIFETIME_DEFAULT;
        try {
          const ctaSent = await sendMessage(TELEGRAM_BOT_TOKEN, chatId, ctaText, { parse_mode: "HTML", reply_markup: ctaKeyboard });
          ctaMessageId = (ctaSent as any)?.message_id ?? null;
          if (!ctaMessageId) {
            ctaResult = "send_failed";
          } else {
            const deleteAfter = new Date(Date.now() + ctaLifetime * 1000).toISOString();
            const { error: cleanupError } = await admin.from("telegram_message_cleanup_jobs").insert({
              workspace_id: settings.workspace_id,
              group_connection_id: connection.id,
              telegram_chat_id: Number(chatId),
              telegram_message_id: ctaMessageId,
              cleanup_kind: "launch_watch_cta",
              delete_after: deleteAfter,
              next_attempt_at: deleteAfter,
            });
            if (cleanupError) throw cleanupError;
            ctaCleanupScheduled = true;
            ctaResult = "sent";
          }
        } catch (e) {
          ctaResult = ctaMessageId ? "cleanup_schedule_failed" : "send_failed";
          console.error("[telegram-webhook] launch watch card send", e instanceof Error ? e.message : "unknown");
        }
        // A card with no durable cleanup path is removed immediately.
        if (ctaMessageId && !ctaCleanupScheduled) {
          try {
            await telegramJson(TELEGRAM_BOT_TOKEN, "deleteMessage", { chat_id: chatId, message_id: ctaMessageId });
            ctaResult = "cleanup_schedule_failed_deleted";
          } catch (e) {
            console.error("[telegram-webhook] launch watch card rollback", e instanceof Error ? e.message : "unknown");
          }
          ctaMessageId = null;
        }
      } else if (!sentId && ctaKeyboard) {
        // Never post an orphan CTA when the welcome itself failed.
        ctaResult = "skipped_welcome_failed";
      }

      const ctaDiagnostics: Record<string, unknown> = {
        last_launch_watch_cta_result: ctaResult,
        ...(ctaCleanupScheduled ? { last_launch_watch_cta_message_id: ctaMessageId, last_launch_watch_cta_sent_at: new Date().toISOString(), last_launch_watch_cta_auto_delete_seconds: ctaLifetime } : {}),
      };
      if (sentId) await recordDiagnostic("sent", { last_welcome_sent_at: new Date().toISOString(), last_welcome_message_id: sentId, ...ctaDiagnostics });
      else await recordDiagnostic("send_failed", ctaDiagnostics);

      // The short welcome timer is safe inside one invocation and stays unchanged.
      if (settings.auto_delete_enabled && sentId) {
        scheduleDelete(sentId, Math.min(120, Math.max(10, Number(settings.auto_delete_seconds) || 45)), "welcome");
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

    // SE-5 / SE-9 / SE-10 sender resolution. Hoisted above the `/mission`
    // command branch so the anonymous-admin command can reuse the EXACT same
    // strict same-group proof and the EXACT same Link Finder candidate path.
    //
    // Anonymous group admins are delivered by Telegram as a bot-like sender
    // (`GroupAnonymousBot`) with `sender_chat` pointing at the group itself.
    // Those posts are eligible ONLY when Telegram proves the message is sent
    // on behalf of this exact connected group; the original poster id is then
    // unknown and stored as NULL. START authorization is unchanged: it still
    // authorizes the callback actor and re-verifies live Telegram admin.
    const senderChat = (message as { sender_chat?: { id?: unknown; type?: unknown } } | undefined)
      ?.sender_chat;
    const linkFinderSender = ((msg) => {
      const sender = msg?.from;
      const senderChatOf = msg?.sender_chat;
      const chatOf = msg?.chat;
      if (sender && sender.is_bot !== true && sender.id != null) {
        return { eligible: true, posterId: Number(sender.id) };
      }
      const t = senderChatOf?.type;
      if (
        senderChatOf &&
        (t === "group" || t === "supergroup") &&
        senderChatOf.id != null &&
        chatOf?.id != null &&
        String(senderChatOf.id) === String(chatOf.id)
      ) {
        return { eligible: true, posterId: null };
      }
      return { eligible: false, posterId: null };
    })({ from, sender_chat: senderChat, chat } as any);
    const isAnonymousGroupAdminSender =
      linkFinderSender.eligible && linkFinderSender.posterId === null;
    const isGroupChat = chat?.type === "group" || chat?.type === "supergroup";

    /**
     * SE-11 — the ONE Link Finder candidate + START/IGNORE prompt path. Both
     * plain official-link detection and the anonymous-admin `/mission <link>`
     * command funnel through here. It creates NO mission, NO card and NO
     * schedule: the RPC fails closed on every ownership fact (connected group,
     * link finder enabled, official handle), and only the identifiable human
     * who later taps START is authorized to launch.
     */
    const offerLinkFinderCandidate = async (
      parsedLink: ParsedXStatus,
      sourceMessageId: number,
      posterId: number | null,
    ): Promise<boolean> => {
      const { data: candidate } = await admin.rpc("create_social_mission_link_candidate", {
        _telegram_chat_id: Number(chatId),
        _telegram_message_id: Number(sourceMessageId),
        _telegram_user_id: posterId,
        _canonical_url: parsedLink.canonicalUrl,
        _external_post_id: parsedLink.postId,
        _author_handle: parsedLink.handle,
        _ttl_minutes: 15,
      });

      const created = (candidate ?? {}) as { outcome?: string; candidate_id?: string };
      // EXISTING = a webhook retry or a repost of the same message: silent.
      if (created.outcome !== "CREATED" || !created.candidate_id) return false;

      const prompt = await telegramJson(TELEGRAM_BOT_TOKEN, "sendMessage", {
        chat_id: chatId,
        text: "This is an official project post. Admins can start a Social Mission for it.",
        reply_to_message_id: Number(sourceMessageId),
        disable_notification: true,
        disable_web_page_preview: true,
        reply_markup: {
          inline_keyboard: [[
            { text: "START MISSION", callback_data: `sm_lf_start_${created.candidate_id}` },
            { text: "IGNORE", callback_data: `sm_lf_ignore_${created.candidate_id}` },
          ]],
        },
      }).catch(() => null);
      const promptId = (prompt as { message_id?: number } | null)?.message_id;
      let promptAttached = false;
      if (typeof promptId === "number") {
        const { data: attached, error: attachError } = await admin.rpc(
          "attach_social_mission_link_prompt",
          { _candidate_id: created.candidate_id, _prompt_message_id: promptId },
        );
        promptAttached = !attachError && attached === true;
      }

      // SE-9 — the ORIGINAL source message is removed here, immediately after
      // the prompt is CONFIRMED sent AND attached, and never before. A prompt
      // that failed to send or failed to attach leaves the member's post
      // completely untouched. A failed deletion records a bounded diagnostic
      // and leaves the PENDING candidate retryable; the START path re-attempts
      // it before launching.
      if (promptAttached) {
        await ensureLinkFinderSourceDeleted({
          candidateId: String(created.candidate_id),
          chatId: String(chatId),
          sourceMessageId: Number(sourceMessageId),
        });
      }
      return true;
    };

    // SE-4A — `/mission <X link>`. Runs before every generic fallthrough and
    // before the unknown-slash-command no-op, and touches no other command.
    const missionMatch = text.match(/^\/mission(?:@\w+)?(?:\s+(\S+))?\s*$/i);

    /**
     * SE-15 — `/mission manage`. Runs BEFORE every other `/mission` branch so
     * the word "manage" can never be treated as a post link or as a bare
     * launcher.
     *
     * In a group it only ever posts the admin notice + private deep link, for
     * an identifiable human AND for a Telegram anonymous admin: neither can
     * mutate anything from the group. In a private chat it opens the console,
     * where the three authorization gates apply to every action.
     */
    const isManageCommand =
      !!missionMatch && String(missionMatch[1] ?? "").toLowerCase() === "manage";
    if (isManageCommand && isGroupChat && (from?.is_bot !== true || isAnonymousGroupAdminSender)) {
      await sendMissionManageLauncherAndCleanup(
        TELEGRAM_BOT_TOKEN,
        chatId,
        Number(message?.message_id),
      );
      return json({ ok: true });
    }
    if (isManageCommand && chat?.type === "private" && from?.is_bot !== true) {
      await mcOpenConsole(Number(from.id), chatId);
      return json({ ok: true });
    }

    // SE-12 — bare `/mission` launcher for identifiable humans in groups.
    // The next pasted X URL is still handled by the existing Link Finder path.
    if (missionMatch && from?.is_bot !== true && isGroupChat && !missionMatch[1]) {
      await sendBareMissionLauncherAndCleanup(TELEGRAM_BOT_TOKEN, chatId, Number(message?.message_id));
      return json({ ok: true });
    }

    if (missionMatch && from?.is_bot !== true) {
      await runMissionCommand({
        chatId,
        chatType: String(chat?.type ?? ""),
        updateId: update?.update_id,
        messageId: message?.message_id,
        telegramUserId: Number(from.id),
        argument: String(missionMatch[1] ?? ""),
      });
      return json({ ok: true });
    }

    // SE-12 — bare `/mission` launcher for anonymous group admins.
    // The next pasted X URL is still handled by the existing Link Finder path.
    if (missionMatch && isAnonymousGroupAdminSender && isGroupChat && !missionMatch[1]) {
      await sendBareMissionLauncherAndCleanup(TELEGRAM_BOT_TOKEN, chatId, Number(message?.message_id));
      return json({ ok: true });
    }

    // SE-11 — anonymous-admin `/mission <X link>`. Telegram never reveals the
    // human behind an anonymous message, so this command can NEVER call
    // `runMissionCommand` directly: there is no linked user and no workspace
    // operator identity to authorize. It is instead routed into the existing
    // Link Finder candidate + START/IGNORE approval mechanism, where the human
    // who taps START is identifiable and must still pass the linked-user,
    // workspace-operator and live Telegram-admin checks. Ordinary bot senders,
    // channels and foreign `sender_chat` values are rejected: eligibility
    // requires Telegram to prove `sender_chat` is THIS exact group.
    if (missionMatch && isAnonymousGroupAdminSender && isGroupChat) {
      const anonArgument = String(missionMatch[1] ?? "");
      const anonParsed = anonArgument ? parseXStatusUrl(anonArgument) : null;
      if (!anonParsed) {
        // Never fail silently: malformed or missing link gets visible usage.
        await sendMessage(TELEGRAM_BOT_TOKEN, chatId, MISSION_USAGE, { parse_mode: "HTML" });
        return json({ ok: true });
      }
      await offerLinkFinderCandidate(anonParsed, Number(message?.message_id), null);
      return json({ ok: true });
    }

    // SE-5 — X Link Finder. A human posting a link to the project's OWN
    // official X account in a connected group gets a private-to-the-group
    // START / IGNORE prompt. It NEVER starts a mission by itself, nothing is
    // deleted at detection time, and the RPC fails closed on every
    // ownership fact (connected group, link finder enabled, official handle).
    // SE-7: if an admin later presses START and the mission reaches a
    // confirmed card plus an active schedule, THAT post is then deleted so the
    // branded card is what the group is left with. IGNORE never deletes it.
    if (linkFinderSender.eligible && !text.startsWith("/") && isGroupChat) {
      const linkMatch = text.match(
        /https:\/\/(?:www\.|mobile\.)?(?:x|twitter)\.com\/[A-Za-z0-9_]{1,15}\/status\/[0-9]{1,32}(?![0-9])/i,
      );
      const parsedLink = linkMatch ? parseXStatusUrl(String(linkMatch[0])) : null;
      if (parsedLink) {
        const handled = await offerLinkFinderCandidate(
          parsedLink,
          Number(message?.message_id),
          linkFinderSender.posterId,
        );
        if (handled) return json({ ok: true });
      }
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

    // SE-15 — the deep link posted by the group launcher. Private chat only.
    if (/^\/start(?:@\w+)?\s+mission_manage$/i.test(text)) {
      if (chat?.type !== "private" || from?.is_bot === true) return json({ ok: true });
      await mcOpenConsole(Number(from.id), chatId);
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

    // Launch Watch deep link: https://t.me/<bot>?start=lw_<24-hex-token>
    const launchWatchMatch = text.match(/^\/start(?:@\w+)?\s+lw_([a-f0-9]{24})$/i);
    if (launchWatchMatch) {
      const token = String(launchWatchMatch[1]).toLowerCase();
      const resolved = await resolveLaunchWatch(token);
      if (!resolved) {
        await sendMessage(TELEGRAM_BOT_TOKEN, chatId, "<b>Launch Watch link not available</b>\n\nThis Launch Watch link is invalid or no longer available.", { parse_mode: "HTML" });
        return json({ ok: true });
      }
      const { launch, profile } = resolved;
      const blocked = launchWatchGate(launch, profile);
      if (blocked) {
        await sendMessage(TELEGRAM_BOT_TOKEN, chatId, `${launchWatchIntro(launch, profile)}\n\n${escapeHtml(blocked)}`, { parse_mode: "HTML" });
        return json({ ok: true });
      }
      const result = await launchWatchSubscribe(launch.id, Number(from.id));
      const line =
        result.outcome === "already_active"
          ? "🔔 You are already watching this launch."
          : result.outcome === "reactivated"
            ? "🔔 You are watching this launch again."
            : "🔔 You are now watching this launch.";
      // Late joiners get the current packet directly. This is a confirmation
      // message only — no launch_notification_deliveries row is created.
      const packet =
        String(launch.status) === "OFFICIAL_CONTRACT_REGISTERED"
          ? officialContractNotice(launch, profile)
          : "";
      const confirmationAttemptedAt = new Date().toISOString();
      const confirmation = await sendMessageWithOutcome(
        TELEGRAM_BOT_TOKEN,
        chatId,
        `${launchWatchIntro(launch, profile)}\n\n${line}${launchWatchDisclaimer}${packet}`,
        {
          parse_mode: "HTML",
          reply_markup: launchWatchKeyboard(
            token,
            true,
            result.remindersEnabled,
            true,
            profile,
            result.updatesEnabled,
          ),
        },
      );
      await recordLaunchWatchConfirmation(result.subscriptionId, confirmationAttemptedAt, confirmation);
      return json({ ok: true });


    }

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

    /**
     * C7.3B — Project Inbox reply capture. This runs LAST, only after every
     * known command, deep link, linking and callback branch has already
     * returned above. Any remaining text starting with "/" stays the existing
     * no-op, so an unknown slash command can never become a project message.
     * Routing is decided entirely by ONE atomic service-only RPC, and this
     * path never sends any Telegram message.
     */
    // C7.3 — team console commands, private chat only. These run before the
    // unknown-slash-command no-op so they can never fall through to capture.
    if (chat?.type === "private" && from?.is_bot !== true && /^\/inbox(?:@\w+)?$/i.test(text)) {
      await openInboxCommand(Number(from.id), chatId);
      return json({ ok: true });
    }
    if (chat?.type === "private" && from?.is_bot !== true && /^\/cancel(?:@\w+)?$/i.test(text)) {
      const cleared = await admin.rpc("bot_inbox_set_session", { _telegram_user_id: Number(from.id), _mode: "NONE", _workspace_id: null });
      await sendMessage(
        TELEGRAM_BOT_TOKEN,
        chatId,
        cleared.error ? "Could not close the inbox right now." : "Reply mode closed. Use /inbox to open Project Inbox again.",
      );
      return json({ ok: true });
    }

    if (text.startsWith("/")) return json({ ok: true });

    /**
     * SE-15 — pending numeric input for Mission Control.
     *
     * Runs BEFORE the Project Inbox reply/capture paths so an armed control
     * field can never be misread as a project message. The session only says
     * WHICH field is being edited; it is never an authorization source, so the
     * three gates are re-run here in full before anything is written, and an
     * invalid value mutates nothing at all.
     */
    if (chat?.type === "private" && from?.is_bot !== true) {
      const { data: mcSessionData } = await admin.rpc("social_mission_control_active_session", {
        _telegram_user_id: Number(from.id),
      });
      const mcSession = Array.isArray(mcSessionData) ? mcSessionData[0] : null;
      const pendingField = String(mcSession?.pending_control_field ?? "");
      const pendingMission = String(mcSession?.mission_id ?? "");
      if (pendingField && pendingMission) {
        const parsed = parseMissionControlInput(pendingField, text);
        if (!parsed.ok) {
          await sendMessage(TELEGRAM_BOT_TOKEN, chatId, parsed.reason);
          return json({ ok: true });
        }
        const auth = await mcAuthorize(Number(from.id), pendingMission);
        if (!auth.ok) {
          await sendMessage(TELEGRAM_BOT_TOKEN, chatId, auth.reason);
          return json({ ok: true });
        }
        const binding = auth.binding;
        const actorUserId = (await getLinkedUser(String(from.id)))?.user_id ?? null;

        if (pendingField === "DURATION_MINUTES") {
          const { data, error } = await admin.rpc("social_mission_apply_duration_override", {
            _telegram_user_id: Number(from.id),
            _mission_id: pendingMission,
            _verified_chat_id: Number(binding.chatId),
            _minutes_from_now: parsed.value,
            _idempotency_key: await mcKey(update?.update_id, "duration_custom"),
          });
          const outcome = String((data as any)?.outcome ?? (error ? "denied" : "denied"));
          if (outcome !== "ok" && outcome !== "replayed") {
            await sendMessage(TELEGRAM_BOT_TOKEN, chatId, MC_OUTCOME_TEXT[outcome] ?? "That change was refused.");
            return json({ ok: true });
          }
          if (outcome === "ok") {
            await mcRefreshCard({
              workspaceId: binding.workspaceId,
              missionId: pendingMission,
              actorUserId: actorUserId ? String(actorUserId) : null,
              seed: `${update?.update_id}:duration_custom`,
            });
          }
          await admin.rpc("social_mission_control_set_session", {
            _telegram_user_id: Number(from.id),
            _workspace_id: binding.workspaceId,
            _mission_id: pendingMission,
            _pending_field: null,
            _clear: false,
          });
          await mcRenderPanel(Number(from.id), chatId, pendingMission, binding, "End time updated.");
          return json({ ok: true });
        }

        const patch: Record<string, number | null> = {};
        if (pendingField === "PRIMARY_TARGET") {
          patch["primaryTarget"] = parsed.value;
        } else {
          patch[pendingField.toLowerCase()] = parsed.value;
        }
        const applied = await mcApplyTargets({
          telegramUserId: Number(from.id),
          binding,
          updateId: update?.update_id,
          patch: patch as never,
        });
        const outcome = String((applied as any).outcome ?? "denied");
        if (outcome === "needs_primary_target") {
          await sendMessage(
            TELEGRAM_BOT_TOKEN,
            chatId,
            "Set a Primary Goal target first, then the supporting targets.",
          );
          return json({ ok: true });
        }
        if (outcome !== "ok" && outcome !== "replayed") {
          await sendMessage(TELEGRAM_BOT_TOKEN, chatId, MC_OUTCOME_TEXT[outcome] ?? "That change was refused.");
          return json({ ok: true });
        }
        if (outcome === "ok") {
          await mcRefreshCard({
            workspaceId: binding.workspaceId,
            missionId: pendingMission,
            actorUserId: actorUserId ? String(actorUserId) : null,
            seed: `${update?.update_id}:${pendingField}`,
          });
        }
        await admin.rpc("social_mission_control_set_session", {
          _telegram_user_id: Number(from.id),
          _workspace_id: binding.workspaceId,
          _mission_id: pendingMission,
          _pending_field: null,
          _clear: false,
        });
        await mcRenderPanel(Number(from.id), chatId, pendingMission, binding, "Targets updated.");
        return json({ ok: true });
      }
    }


    /**
     * C7.3 — TEAM reply from the bot console.
     *
     * A valid, unexpired REPLY session owned by a still-authorized operator
     * turns the next plain private message into a TEAM reply instead of a
     * member-initiated inbound DM. The RPC re-authorizes identity, membership
     * and conversation/workspace binding, and queues the reply through the
     * SAME durable project_inbox_deliveries ledger the web inbox uses. This
     * handler never contacts the member directly.
     */
    if (chat?.type === "private" && from?.is_bot !== true) {
      const { data: sessionData } = await admin.rpc("bot_inbox_active_reply_session", {
        _telegram_user_id: Number(from.id),
      });
      const session = Array.isArray(sessionData) ? sessionData[0] : null;
      if (session?.conversation_id) {
        const requestId = await replyRequestId(Number(update?.update_id));
        const { data: replyData, error: replyError } = await admin.rpc("bot_inbox_create_team_reply", {
          _telegram_user_id: Number(from.id),
          _body: text,
          _client_request_id: requestId,
        });
        const outcome = Array.isArray(replyData) ? replyData[0] : null;
        if (replyError || !outcome) {
          await sendMessage(TELEGRAM_BOT_TOKEN, chatId, "That reply could not be queued. Nothing was sent. Try again.");
          return json({ ok: true });
        }
        if (String(outcome.outcome) === "queued") {
          await sendMessage(
            TELEGRAM_BOT_TOKEN,
            chatId,
            `<b>Reply queued for ${escapeHtml(String(session.member_ref))}</b>\n\nIt is being delivered as an official project response. Delivery is confirmed by the delivery worker, not by this message.`,
            { parse_mode: "HTML" },
          );
          return json({ ok: true });
        }
        const reasonText: Record<string, string> = {
          conversation_resolved: "This conversation is resolved. Reopen it in Cartel HQ before replying.",
          contact_blocked: "This member is blocked, so no reply can be sent.",
          earlier_reply_unsettled: "An earlier reply in this conversation is not settled yet. Nothing was queued.",
          missing_project_name: "Save your Project Profile name in Cartel HQ before replying.",
          too_long_to_deliver: "That reply is too long to deliver.",
          invalid_length: "A reply must be between 1 and 3500 characters.",
          request_id_reused: "That reply was not queued.",
        };
        await sendMessage(
          TELEGRAM_BOT_TOKEN,
          chatId,
          reasonText[String(outcome.reason ?? "")] ?? "That reply could not be queued. Nothing was sent.",
        );
        return json({ ok: true });
      }
    }


    const inboundUpdateId = Number(update?.update_id);
    const inboundMessageId = Number(message?.message_id);
    const inboundReplyToId = Number(message?.reply_to_message?.message_id);
    const inboundSenderId = Number(from.id);
    const inboundChatId = Number(chat?.id);
    const capturable =
      chat?.type === "private" &&
      from?.is_bot !== true &&
      Number.isSafeInteger(inboundUpdateId) && inboundUpdateId > 0 &&
      Number.isSafeInteger(inboundMessageId) && inboundMessageId > 0 &&
      Number.isSafeInteger(inboundReplyToId) && inboundReplyToId > 0 &&
      Number.isSafeInteger(inboundSenderId) && inboundSenderId > 0 &&
      Number.isSafeInteger(inboundChatId) && inboundChatId === inboundSenderId;

    if (capturable) {
      const { data: captureData, error: captureError } = await admin.rpc("capture_project_inbox_launch_reply", {
        _telegram_update_id: inboundUpdateId,
        _telegram_user_id: inboundSenderId,
        _telegram_chat_id: inboundChatId,
        _telegram_message_id: inboundMessageId,
        _telegram_reply_to_message_id: inboundReplyToId,
        _body: text,
      });
      if (captureError) throw captureError;
      const captureRow = Array.isArray(captureData) ? captureData[0] : null;
      if (captureRow && String(captureRow.outcome) === "captured") {
        await notifyTeamOfCapture(inboundUpdateId);
      }
      return json({ ok: true });
    }


    /**
     * C7.3E — member-initiated Project Inbox capture.
     *
     * Runs strictly AFTER every command, deep link, linking and callback
     * branch, and strictly AFTER the C7.3B/D reply-to routing above, which
     * returns before this point whenever a reply target is present. This
     * handler therefore only ever sees a plain, unthreaded, private text DM.
     * It never sends a Telegram message and never guesses a project.
     *
     * Hardening: this path performs NO direct table access. The entire
     * decision (candidate workspaces, exactly-one requirement, settings gate,
     * dedupe, contact/conversation/message persistence) happens inside ONE
     * atomic service-only RPC, so an unexpected failure rolls the inbound
     * update back and a legitimate Telegram retry can retry.
     */
    const bareDmCapturable =
      chat?.type === "private" &&
      from?.is_bot !== true &&
      !Number.isSafeInteger(inboundReplyToId) &&
      Number.isSafeInteger(inboundUpdateId) && inboundUpdateId > 0 &&
      Number.isSafeInteger(inboundMessageId) && inboundMessageId > 0 &&
      Number.isSafeInteger(inboundSenderId) && inboundSenderId > 0 &&
      Number.isSafeInteger(inboundChatId) && inboundChatId === inboundSenderId &&
      text.length >= 1 && text.length <= 4096;

    if (bareDmCapturable) {
      const { data: memberCaptureData, error: memberCaptureError } = await admin.rpc(
        "capture_project_inbox_member_message",
        {
          _telegram_update_id: inboundUpdateId,
          _telegram_user_id: inboundSenderId,
          _telegram_chat_id: inboundChatId,
          _telegram_message_id: inboundMessageId,
          _body: text,
        },
      );
      if (memberCaptureError) throw memberCaptureError;
      if (String(memberCaptureData ?? "") === "captured") {
        await notifyTeamOfCapture(inboundUpdateId);
      }
      return json({ ok: true });
    }




    return json({ ok: true });
  } catch (err) {
    console.error("[telegram-webhook]", err instanceof Error ? err.message : "unknown error");
    return json({ ok: true });
  }
});
