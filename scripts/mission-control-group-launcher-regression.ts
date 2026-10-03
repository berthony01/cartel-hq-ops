/**
 * MC-GL — `/missioncontrol` group launcher -> Mission Control Mini App.
 * Run: bun scripts/mission-control-group-launcher-regression.ts
 */
import { readFileSync } from "node:fs";
import {
  computeInitDataHash,
  buildDataCheckString,
  parseMissionControlStartParam,
  validateTelegramInitData,
} from "../src/lib/telegram-miniapp-auth.server";

let pass = 0;
let fail = 0;
const check = (name: string, ok: boolean) => {
  if (ok) pass++;
  else fail++;
  console.log(`${ok ? "PASS" : "FAIL"} ${name}`);
};

const hook = readFileSync("supabase/functions/telegram-webhook/index.ts", "utf8");
const mirror = readFileSync("backend-source/edge-functions/telegram-webhook/index.ts", "utf8");
const bridge = readFileSync("src/lib/telegram-miniapp-bridge.functions.ts", "utf8");
const home = readFileSync("src/routes/tg.index.tsx", "utf8");
const between = (src: string, a: string, b: string) => {
  const i = src.indexOf(a);
  const j = src.indexOf(b, i + a.length);
  return i >= 0 && j > i ? src.slice(i, j) : "";
};

// Webhook
const branch = between(hook, "const missionControlMatch", "// SE-4A");
check("1.1 mirror identical", hook === mirror);
check("1.2 canonical regex with optional @bot", hook.includes("text.match(/^\\/missioncontrol(?:@(\\w+))?\\s*$/i)"));
check("1.3 foreign @bot suffix ignored", /missionControlMatch\[1\]\.toLowerCase\(\) === BOT_USERNAME\.toLowerCase\(\)/.test(branch));
check("1.4 live getChatMember admin gate", /getChatMember[\s\S]*status === "administrator" \|\| status === "creator"/.test(branch));
check("1.5 non-admin refusal, no link", /administrators only\."[\s\S]*?return json/.test(branch));
check("1.6 exact chat connection, ambiguity fails closed", /\.eq\("telegram_chat_id", chatId\)[\s\S]*\.limit\(2\)/.test(branch) && /list\.length === 1 && missionControlConnectionOperational/.test(branch));
check("1.7 link from server env only", branch.includes('Deno.env.get("MISSION_CONTROL_MINIAPP_LINK")'));
check("1.8 unavailable copy when link missing", /if \(!directLink\)[\s\S]*MISSION_CONTROL_UNAVAILABLE_TEXT/.test(branch));
const launcher = between(hook, "async function sendMissionControlLauncherAndCleanup", "/** SE-15 — the supporting");
check("1.9 URL button, never web_app in group", /\{ text: "Open Mission Control", url: directLink \}/.test(launcher) && !launcher.includes("web_app"));
check("1.10 cleanup only after confirmed post", launcher.indexOf("if (!sent) return null") < launcher.indexOf("deleteMessage"));
check("1.11 private /missioncontrol opens console", /isMissionControlCommand && chat\?\.type === "private"[\s\S]*?mcOpenConsole/.test(branch));
check("1.12 legacy /mission manage retained", hook.includes("sendMissionManageLauncherAndCleanup(") && hook.includes("/^\\/start(?:@\\w+)?\\s+mission_manage$/i"));
check("1.13 legacy callbacks retained", hook.includes('callback_data: "mc_x"') && hook.includes("callbackData.match(/^pi_c_([0-9a-f-]{36})$/i)"));
check("1.14 help + command registration", hook.includes("/missioncontrol — open this community's Mission Control") && hook.includes('command: "missioncontrol"'));

// Pure link builder (extracted logic mirrored from source)
const builderSrc = between(hook, "export function buildMissionControlDirectLink", "export function missionControlConnectionOperational");
// eslint-disable-next-line @typescript-eslint/no-implied-eval
const build = new Function(
  "configured",
  "connectionId",
  `const BOT_USERNAME="PepeCartelHQBot";const MISSION_CONTROL_CONNECTION_UUID_RE=/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;` +
    builderSrc.replace(/^export function buildMissionControlDirectLink\([^)]*\): string \| null \{/, "").replace(/\}\s*$/, "").replace(/match\[1\]!/g, "match[1]"),
) as (c: string, id: string) => string | null;
const U = "11111111-2222-3333-4444-555555555555";
check("2.1 Main Mini App form", build("https://t.me/PepeCartelHQBot", U) === `https://t.me/PepeCartelHQBot?startapp=mc_${U}`);
check("2.2 named app form", build("https://t.me/PepeCartelHQBot/control", U) === `https://t.me/PepeCartelHQBot/control?startapp=mc_${U}`);
check("2.3 empty config -> null", build("", U) === null);
check("2.4 other bot -> null", build("https://t.me/OtherBot/app", U) === null);
check("2.5 non-https/query -> null", build("http://t.me/PepeCartelHQBot", U) === null && build("https://t.me/PepeCartelHQBot?x=1", U) === null);
check("2.6 bad id -> null", build("https://t.me/PepeCartelHQBot", "123") === null);

// Signed start_param
const TOKEN = "123456:TEST";
async function signed(fields: Record<string, string>) {
  const p = new URLSearchParams(fields);
  p.set("hash", await computeInitDataHash(buildDataCheckString(p), TOKEN));
  return p.toString();
}
const now = Math.floor(Date.now() / 1000).toString();
const user = JSON.stringify({ id: 42, first_name: "A" });
const good = await validateTelegramInitData(await signed({ auth_date: now, user, start_param: `mc_${U}` }), TOKEN);
check("3.1 verified start_param exposed", good.ok && good.startParam === `mc_${U}`);
const none = await validateTelegramInitData(await signed({ auth_date: now, user }), TOKEN);
check("3.2 absent -> null", none.ok && none.startParam === null);
const tampered = (await signed({ auth_date: now, user, start_param: `mc_${U}` })).replace(U, "99999999-2222-3333-4444-555555555555");
check("3.3 tampered start_param rejected", !(await validateTelegramInitData(tampered, TOKEN)).ok);
check("3.4 parser accepts mc_<uuid>", parseMissionControlStartParam(`mc_${U.toUpperCase()}`) === U);
check("3.5 parser rejects junk", parseMissionControlStartParam("mc_1") === null && parseMissionControlStartParam(U) === null);

// Bridge authority
const resolver = between(bridge, "async function resolveCommunityLaunch", "export const miniAppResolveCommunityLaunch");
check("4.1 operator RPC scope required", resolver.includes("admin.rpc(MINIAPP_RPC.workspaces") && resolver.includes("!authorized.has(workspaceId)"));
check("4.2 live admin check in resolved chat", resolver.includes("isCurrentChatAdmin(token, chatId, telegramUserId)"));
check("4.3 revoked connection refused", resolver.includes("bot_removed_at") && resolver.includes('row["bot_is_admin"] === true'));
check("4.4 single bounded refusal code", (resolver.match(/community_launch_unavailable/g) ?? []).length >= 2);
const resolveFn = between(bridge, "export const miniAppResolveCommunityLaunch", "export const miniAppListMissions");
check("4.5 hint read from verified start_param only", resolveFn.includes("auth.startParam") && !resolveFn.includes("data?.startParam"));
check("4.6 malformed mc_ -> refusal", resolveFn.includes('fail("community_launch_invalid")'));
const listFn = between(bridge, "export const miniAppListMissions", "const MINIAPP_LOGO_MAX_BYTES");
check("4.7 scoped list re-proves launch", listFn.includes("resolveCommunityLaunch(admin, token, auth.user.id"));
check("4.8 scoped list filters exact chat", listFn.includes('["telegram_chat_id"] ?? "") === scopedChatId'));
check("4.9 entitlement gate preserved", listFn.includes('miniAppFeatureAllowed(admin, data.workspaceId, "x_missions"'));

// Mini App
check("5.1 refusal does not pick another workspace", home.includes("if (!communityLaunch) return null;") && home.includes("if (launchRefused)"));
check("5.2 picker hidden in community mode", home.includes("workspaces.length > 1 && !communityLaunch"));
check("5.3 scoped list request", home.includes("groupConnectionId: communityLaunch?.connectionId ?? null"));
check("5.4 initDataUnsafe never read", !home.includes("initDataUnsafe"));

console.log(`\n${pass}/${pass + fail} passed`);
if (fail > 0) process.exit(1);
