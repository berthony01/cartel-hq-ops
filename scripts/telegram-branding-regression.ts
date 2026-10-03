import { readFileSync } from "node:fs";
import {
  CARTEL_CUSTOM_EMOJI,
  presentHtmlText,
  presentInlineKeyboard,
  presentTelegramPayload,
} from "../backend-source/edge-functions/_shared/telegram-presentation";
import { buildMissionControlDirectLink, runMissionControlGroupLauncher, type LauncherDeps } from "../backend-source/edge-functions/_shared/mission-control-launcher";
import { parseMissionControlCloseToken, parseMissionControlStartParam } from "../src/lib/telegram-miniapp-auth.server";

let passed = 0;
let failed = 0;
function check(name: string, ok: boolean) {
  console.log(`${ok ? "PASS" : "FAIL"} ${name}`);
  ok ? passed++ : failed++;
}

const callback = "lw_unwatch_abc";
const url = "https://example.com/path?a=1";
const keyboard = { inline_keyboard: [[
  { text: "📣 Enable updates", callback_data: callback },
  { text: "Stop watching", callback_data: "stop" },
  { text: "Website", url },
]] };
const styled = presentInlineKeyboard(keyboard, "platform") as typeof keyboard & { inline_keyboard: Array<Array<Record<string, unknown>>> };
check("normal action uses success style", styled.inline_keyboard[0]?.[0]?.style === "success");
check("destructive action uses danger style", styled.inline_keyboard[0]?.[1]?.style === "danger");
check("secondary action has default style", styled.inline_keyboard[0]?.[2]?.style === undefined);
check("callback and URL stay byte-identical", styled.inline_keyboard[0]?.[0]?.callback_data === callback && styled.inline_keyboard[0]?.[2]?.url === url);
check("real validated custom emoji id attached", styled.inline_keyboard[0]?.[0]?.icon_custom_emoji_id === CARTEL_CUSTOM_EMOJI.announce.id);
const html = presentHtmlText("<b>✅ SENT</b> &amp; safe", "platform");
check("generated header keeps escaping and authored body byte-identical", html.includes("<tg-emoji") && html.endsWith("<b>✅ SENT</b> &amp; safe"));
check("platform HTML presentation is idempotent", presentHtmlText(html, "platform") === html);
const attributeHtml = '<a href="https://example.com/🔥?x=✅">🔥 authored</a>';
check("authored emoji in attributes URLs and body is never replaced", presentHtmlText(attributeHtml, "authored") === attributeHtml);
const platformAttributeHtml = presentHtmlText(attributeHtml, "platform");
check("platform header never rewrites emoji inside an href or authored body", platformAttributeHtml === `<tg-emoji emoji-id="${CARTEL_CUSTOM_EMOJI.energy.id}">🔥</tg-emoji> <b>PEPECARTEL · CARTEL HQ</b>\n\n${attributeHtml}`);
const frozen = "Official project response: <not markup>";
const frozenPayload = presentTelegramPayload("sendMessage", { text: frozen });
check("plain/frozen authored body remains byte-identical", frozenPayload.text === frozen);
const stickerPayload = presentTelegramPayload("sendSticker", { reply_markup: keyboard }, "platform") as any;
check("sticker keyboards receive platform presentation", stickerPayload.reply_markup.inline_keyboard[0][0].style === "success");
const markupPayload = presentTelegramPayload("editMessageReplyMarkup", { reply_markup: keyboard }, "platform") as any;
check("reply-markup edits receive platform presentation", markupPayload.reply_markup.inline_keyboard[0][1].style === "danger");
const preserved = presentInlineKeyboard({ inline_keyboard: [[{ text: "Open", style: "primary", icon_custom_emoji_id: "existing" }]] }, "platform") as any;
check("existing button style and custom icon are preserved", preserved.inline_keyboard[0][0].style === "primary" && preserved.inline_keyboard[0][0].icon_custom_emoji_id === "existing");
const primaryOpen = presentInlineKeyboard({ inline_keyboard: [[{ text: "Open", style: "primary" }]] }, "platform") as any;
check("existing primary Open style is not overwritten with success", primaryOpen.inline_keyboard[0][0].style === "primary");

const connection = "11111111-2222-4333-8444-555555555555";
const closeToken = "AbCdEf0123456789_-abcdef";
const direct = buildMissionControlDirectLink("https://t.me/PepeCartelHQBot", connection, "PepeCartelHQBot", closeToken);
check("close-bound startapp retains legacy connection routing", parseMissionControlStartParam(`mc_${connection}_${closeToken}`) === connection);
check("opaque close token parsed only from valid route", parseMissionControlCloseToken(`mc_${connection}_${closeToken}`) === closeToken);
check("direct link contains no chat/message id", direct?.includes(closeToken) === true && !direct.includes("-100") && !direct.includes("message"));
check("invalid close token fails closed", buildMissionControlDirectLink("https://t.me/PepeCartelHQBot", connection, "PepeCartelHQBot", "short") === null);

const log: string[] = [];
const deps: LauncherDeps = {
  botUsername: "PepeCartelHQBot",
  configuredLink: "https://t.me/PepeCartelHQBot",
  anonymousAdmin: true,
  getSenderStatus: async () => "member",
  findConnections: async () => ({ rows: [{ id: connection, bot_is_admin: true, metadata: {} }], error: null }),
  prepareCloseBinding: async () => ({ token: closeToken, bindingId: "binding" }),
  confirmCloseBinding: async (id, messageId) => { log.push(`confirm:${id}:${messageId}`); return true; },
  abandonCloseBinding: async (id) => { log.push(`abandon:${id}`); },
  sendText: async () => true,
  sendLauncher: async (_text, link) => { log.push(`send:${link}`); return { message_id: 88 }; },
  deleteCommand: async (id) => { log.push(`delete:${id}`); },
  sourceMessageId: 77,
};
check("confirmed exact launcher binds before source command cleanup", await runMissionControlGroupLauncher(deps) === "launcher_sent" && log.join("|").includes("confirm:binding:88|delete:77"));
const failedLog: string[] = [];
check("failed launcher abandons token and never deletes source", await runMissionControlGroupLauncher({ ...deps, sendLauncher: async () => null, abandonCloseBinding: async (id) => { failedLog.push(`abandon:${id}`); }, deleteCommand: async () => { failedLog.push("delete"); } }) === "launcher_failed" && failedLog.join("|") === "abandon:binding");
const thrownLog: string[] = [];
check("thrown launcher send abandons token without fallback resend", await runMissionControlGroupLauncher({ ...deps, sendLauncher: async () => { throw new Error("uncertain"); }, abandonCloseBinding: async (id) => { thrownLog.push(`abandon:${id}`); }, deleteCommand: async () => { thrownLog.push("delete"); } }) === "launcher_failed" && thrownLog.join("|") === "abandon:binding");
const invalidLinkLog: string[] = [];
check("prepared binding is abandoned when configured link is invalid", await runMissionControlGroupLauncher({ ...deps, configuredLink: "", abandonCloseBinding: async (id) => { invalidLinkLog.push(`abandon:${id}`); } }) === "link_unavailable" && invalidLinkLog.join("|") === "abandon:binding");

const backendHelper = readFileSync("backend-source/edge-functions/_shared/telegram-presentation.ts", "utf8");
const deployedHelper = readFileSync("supabase/functions/_shared/telegram-presentation.ts", "utf8");
check("shared presentation mirrors are byte-identical", backendHelper === deployedHelper);
for (const path of ["telegram-webhook", "social-mission-telegram", "social-mission-runner"]) {
  check(`${path} source mirror is byte-identical`, readFileSync(`backend-source/edge-functions/${path}/index.ts`, "utf8") === readFileSync(`supabase/functions/${path}/index.ts`, "utf8"));
}
for (const path of ["telegram-webhook", "social-mission-telegram", "social-mission-runner", "telegram-group", "launch-notifications", "project-inbox-delivery", "sticker-drops", "telegram-stickers"]) {
  check(`${path} imports presentation helper`, readFileSync(`backend-source/edge-functions/${path}/index.ts`, "utf8").includes("telegram-presentation.ts"));
}
const sql = readFileSync("docs/sql/MC_BRANDING_LAUNCHER_CLEANUP.sql", "utf8");
check("staged binding stores immutable original scope", sql.includes("telegram_chat_id bigint not null") && sql.includes("cleanup_job_id uuid"));
check("staged SQL qualifies pgcrypto digest", sql.includes("extensions.digest(_close_token"));
check("all staged security-definer routines use fixed pg_catalog search paths", (sql.match(/security definer set search_path = pg_catalog/g) ?? []).length === 5 && !sql.includes("search_path = public"));
check("staged SQL revokes binding table from browser roles", sql.includes("revoke all on table public.mission_control_launcher_bindings from public, anon, authenticated"));
check("cleanup queue remains service-only", sql.includes("revoke all on table public.telegram_message_cleanup_jobs from public, anon, authenticated") && sql.includes("grant all on table public.telegram_message_cleanup_jobs to service_role"));
check("fast worker path is service-only, delayed, and exact-job claimed", readFileSync("backend-source/edge-functions/telegram-message-cleanup/index.ts", "utf8").includes("Bearer ${SUPABASE_SERVICE_ROLE_KEY}") && readFileSync("backend-source/edge-functions/telegram-message-cleanup/index.ts", "utf8").includes("setTimeout(resolve, 5_000)") && sql.includes("claim_mission_control_launcher_cleanup_job"));
const tgRoute = readFileSync("src/routes/tg.index.tsx", "utf8");
check("Mini App closes only after queued acknowledgement", tgRoute.includes('result.ok && result.cleanup === "queued"'));
check("Mini App reports cleanup failure and permits normal close", tgRoute.includes("Launcher post was not cleared") && tgRoute.includes("close Mission Control normally"));

console.log(`\n${passed}/${passed + failed} passed`);
if (failed) process.exit(1);