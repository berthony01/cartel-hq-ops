/** MINI-HQ-1A focused repository regression. No network or database access. */
import { existsSync, readFileSync } from "node:fs";

let passed = 0;
const failures: string[] = [];
function check(name: string, condition: boolean): void {
  if (condition) passed += 1;
  else failures.push(name);
}

const files = {
  home: "src/routes/tg.index.tsx",
  mission: "src/routes/tg.mission.$missionId.tsx",
  pieces: "src/components/telegram-miniapp/MiniAppPieces.tsx",
  bridge: "src/lib/telegram-miniapp-bridge.functions.ts",
  auth: "src/lib/telegram-miniapp-auth.server.ts",
  doc: "docs/MINI_HQ_OPERATOR_CONSOLE_ARCHITECTURE_LOCK.md",
};
for (const [name, path] of Object.entries(files)) check(`file exists: ${name}`, existsSync(path));

const home = readFileSync(files.home, "utf8");
const mission = readFileSync(files.mission, "utf8");
const pieces = readFileSync(files.pieces, "utf8");
const bridge = readFileSync(files.bridge, "utf8");
const doc = readFileSync(files.doc, "utf8");
const changedSurface = [home, pieces, bridge, doc].join("\n");

check("operator navigation is complete", ["Home", "Missions", "Inbox", "Brand", "More"].every((label) => pieces.includes(`label: "${label}"`)));
check("Home and Missions are functional tabs", /activeTab === "home"/.test(home) && /activeTab === "missions"/.test(home));
check("Brand/More route into existing full-app surfaces (MINI-HQ-1C)", /Saved project identity/.test(home) && /to="\/project-profile"/.test(home) && /to="\/launch-control"/.test(home) && /to="\/settings"/.test(home) && /Opens CARTEL HQ/.test(home) && !/coming next/.test(home));
check("Home includes required operational hierarchy", /Needs attention/.test(home) && /Community status/.test(home) && /Quick actions/.test(home));
check("zero mission state remains useful", /No mission is live/.test(home) && /Post an X link as an admin/.test(home));
check("mission detail route is unchanged in purpose", /createFileRoute\("\/tg\/mission\/\$missionId"\)/.test(mission));
check("mission list still links to detail", /to="\/tg\/mission\/\$missionId"/.test(home));
check("identity read validates initData first", /miniAppOperatorHome[\s\S]*validateTelegramInitData/.test(bridge));
check("identity workspace is operator-authorized", /authorizedWorkspace[\s\S]*if \(!authorizedWorkspace\) return fail\("not_found"\)/.test(bridge));
check("identity comes from existing profile source", /from\("project_profiles"\)/.test(bridge) && /project_name, ticker, logo_asset_id/.test(bridge));
check("logo is same-workspace and bounded", /from\("media_assets"\)[\s\S]*eq\("workspace_id", data\.workspaceId\)/.test(bridge) && /MINIAPP_LOGO_MAX_BYTES/.test(bridge));
check("community status exposes counts only", /connectedGroups/.test(bridge) && /adminReadyGroups/.test(bridge) && !/telegram_chat_id/.test(home));
check("no customer brand is hard-coded", !/PEPECARTEL|PepeCartel|pepecartel/.test(changedSurface));
check("no parallel backend calls", !/functions\.invoke|createClient\(/.test(home + pieces));
check("no forbidden finalization controls", !/miniAppEndMission|miniAppCancelMission|End Mission|Cancel Mission/.test(home + pieces));
check("safe-area frame remains intact", /tg-content-safe-area-inset/.test(pieces) && /navigation \? "5\.5rem"/.test(pieces));
check("architecture sequence is durable", ["MINI-HQ-1A", "MINI-HQ-1B", "MINI-HQ-1C", "MINI-HQ-1D", "MINI-HQ-2"].every((phase) => doc.includes(phase)));
check("surface separation is recorded", /Telegram bot\/chat/.test(doc) && /Owner Mini App/.test(doc) && /Full CARTEL HQ web app/.test(doc) && /Future member Mini App/.test(doc));
const root = readFileSync("src/routes/__root.tsx", "utf8");
check("root html suppresses Telegram SDK hydration mismatch", /<html lang="en" suppressHydrationWarning>/.test(root));

if (failures.length > 0) {
  console.error(`FAIL — ${failures.length} failed, ${passed} passed`);
  failures.forEach((failure) => console.error(`  - ${failure}`));
  process.exit(1);
}
console.log(`PASS — ${passed}/${passed} MINI-HQ-1A checks passed`);