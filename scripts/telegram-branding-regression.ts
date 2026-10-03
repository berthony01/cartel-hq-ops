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
const styled = presentInlineKeyboard(keyboard) as typeof keyboard & { inline_keyboard: Array<Array<Record<string, unknown>>> };
check("normal action uses success style", styled.inline_keyboard[0]?.[0]?.style === "success");
check("destructive action uses danger style", styled.inline_keyboard[0]?.[1]?.style === "danger");
check("secondary action has default style", styled.inline_keyboard[0]?.[2]?.style === undefined);
check("callback and URL stay byte-identical", styled.inline_keyboard[0]?.[0]?.callback_data === callback && styled.inline_keyboard[0]?.[2]?.url === url);
check("real validated custom emoji id attached", styled.inline_keyboard[0]?.[0]?.icon_custom_emoji_id === CARTEL_CUSTOM_EMOJI.announce.id);
const html = presentHtmlText("<b>✅ SENT</b> &amp; safe");
check("HTML keeps escaping and visible emoji fallback", html.includes("<tg-emoji") && html.includes("✅") && html.includes("&amp; safe"));
check("HTML presentation is idempotent", presentHtmlText(html) === html);
const frozen = "Official project response: <not markup>";
const frozenPayload = presentTelegramPayload("sendMessage", { text: frozen });
check("plain/frozen authored body remains byte-identical", frozenPayload.text === frozen);
check("unsupported sticker transport remains byte-identical", presentTelegramPayload("sendSticker", keyboard) === keyboard);

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

const backendHelper = readFileSync("backend-source/edge-functions/_shared/telegram-presentation.ts", "utf8");
const deployedHelper = readFileSync("supabase/functions/_shared/telegram-presentation.ts", "utf8");
check("shared presentation mirrors are byte-identical", backendHelper === deployedHelper);
for (const path of ["telegram-webhook", "social-mission-telegram", "social-mission-runner"]) {
  check(`${path} source mirror is byte-identical`, readFileSync(`backend-source/edge-functions/${path}/index.ts`, "utf8") === readFileSync(`supabase/functions/${path}/index.ts`, "utf8"));
}
for (const path of ["telegram-webhook", "social-mission-telegram", "social-mission-runner", "telegram-group", "launch-notifications", "project-inbox-delivery", "sticker-drops", "telegram-stickers"]) {
  check(`${path} imports presentation helper`, readFileSync(`backend-source/edge-functions/${path}/index.ts`, "utf8").includes("telegram-presentation.ts"));
}

console.log(`\n${passed}/${passed + failed} passed`);
if (failed) process.exit(1);