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
    ? `<b>CARTEL HQ BOT • PRIVATE BETA</b>\n\nCurrent group capabilities include community join welcomes with optional auto-delete, Telegram sticker-pack distribution and native sticker delivery. Additional community tools are in development.\n\n<b>Commands</b>\n/roadmap — see what's live and what's coming\n/mission &lt;X link&gt; — start a Social Mission (admins only)\n/help — show this guide\n\nAdmins can follow PEPECARTEL and join Early Access through @${BOT_USERNAME}.`
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

  try {


    const callback = update?.callback_query;
    if (callback?.id && callback?.from?.id) {
      const from = callback.from;
      const callbackData = String(callback.data ?? "");
      const callbackChat = callback.message?.chat;
      const callbackChatId = callbackChat?.id != null ? String(callbackChat.id) : String(from.id);
      const linked = await getLinkedUser(String(from.id));

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
