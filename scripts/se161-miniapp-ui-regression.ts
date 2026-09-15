/**
 * SE-16.1 — Telegram Mini App UI regression (repo-only, static).
 *
 * Proves the read-only Mini App UI cannot weaken or bypass the SE-16.0
 * authorization boundary. Zero network, zero database, zero Telegram access.
 */

import { readFileSync, existsSync } from "node:fs";
import { execSync } from "node:child_process";

let passed = 0;
const failures: string[] = [];
function check(name: string, condition: boolean, detail = ""): void {
  if (condition) passed += 1;
  else failures.push(`${name}${detail ? ` — ${detail}` : ""}`);
}

/** Comments must never satisfy or break a structural assertion. */
function stripComments(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/.*$/gm, "$1");
}

const FILES = {
  layout: "src/routes/tg.tsx",
  home: "src/routes/tg.index.tsx",
  mission: "src/routes/tg.mission.$missionId.tsx",
  pieces: "src/components/telegram-miniapp/MiniAppPieces.tsx",
  client: "src/lib/telegram-miniapp-client.ts",
} as const;

/* ------------------------------------------------ 1. files and route tree */

for (const [key, path] of Object.entries(FILES)) {
  check(`1.${key} ${path} exists`, existsSync(path));
}

const src: Record<keyof typeof FILES, string> = {
  layout: readFileSync(FILES.layout, "utf8"),
  home: readFileSync(FILES.home, "utf8"),
  mission: readFileSync(FILES.mission, "utf8"),
  pieces: readFileSync(FILES.pieces, "utf8"),
  client: readFileSync(FILES.client, "utf8"),
};
const code = Object.fromEntries(
  Object.entries(src).map(([k, v]) => [k, stripComments(v)]),
) as Record<keyof typeof FILES, string>;

const uiFiles = [FILES.layout, FILES.home, FILES.mission, FILES.pieces, FILES.client];
const uiCode = uiFiles.map((f) => stripComments(readFileSync(f, "utf8"))).join("\n");

check("2.1 layout route id is /tg", /createFileRoute\("\/tg"\)/.test(code.layout));
check("2.2 home route id is /tg/", /createFileRoute\("\/tg\/"\)/.test(code.home));
check(
  "2.3 mission route id is /tg/mission/$missionId",
  /createFileRoute\("\/tg\/mission\/\$missionId"\)/.test(code.mission),
);
check("2.4 layout renders an Outlet", /<Outlet \/>/.test(code.layout));
check(
  "2.5 no Mini App route lives under _authenticated",
  !existsSync("src/routes/_authenticated/tg.tsx") &&
    !existsSync("src/routes/_authenticated/tg.index.tsx"),
);

/* ---------------------------------------------- 3. no operator shell/session */

check("3.1 no AppShell import in Mini App UI", !/AppShell/.test(uiCode));
check("3.2 no sidebar or operator nav import", !/@\/lib\/nav|AppSidebar|MobileTabBar/.test(uiCode));
check(
  "3.3 no Supabase browser session usage in Mini App UI",
  !/@\/integrations\/supabase|supabase\.auth/.test(uiCode),
);
check("3.4 no workspace operator context import", !/workspace-context/.test(uiCode));

/* ------------------------------------------------- 4. credential boundary */

check(
  "4.1 the server-only validator is never imported by UI",
  !/telegram-miniapp-auth\.server/.test(uiCode),
);
check(
  "4.2 only the bridge functions module is imported for data",
  /telegram-miniapp-bridge\.functions/.test(code.home) &&
    /telegram-miniapp-bridge\.functions/.test(code.mission),
);
check(
  "4.3 raw WebApp.initData is the only credential read",
  /WebApp\?\.initData|app\?\.initData/.test(code.client) &&
    /initData\.trim\(\)/.test(code.client),
);
check("4.4 initDataUnsafe is never referenced anywhere in the UI", !/initDataUnsafe/.test(uiCode));
check(
  "4.5 every bridge call passes initData",
  (code.home.match(/\{ data: \{ initData/g) ?? []).length >= 2 &&
    /\{ data: \{ initData: initData as string, missionId \} \}/.test(code.mission),
);
check(
  "4.6 no chat id is accepted, sent or rendered",
  !/chatId|chat_id|verifiedChatId|telegram_chat_id/.test(uiCode),
);

/* ----------------------------------------------- 5. read-only scope in V1 */

const FORBIDDEN_FNS = [
  "miniAppApplyTargets",
  "miniAppApplyDuration",
  "end_social_mission_from_control",
  "cancel_social_mission_from_control",
];
for (const fn of FORBIDDEN_FNS) {
  check(`5.${fn} is not referenced by SE-16.1 UI`, !uiCode.includes(fn));
}
check(
  "5.5 only read bridge functions are imported",
  /miniAppListMissionWorkspaces/.test(code.home) &&
    /miniAppListMissions/.test(code.home) &&
    /miniAppMissionPanel/.test(code.mission),
);
check(
  "5.6 no mutation-intent controls are rendered",
  !/Edit targets|Change end time|End now|End Now|Cancel mission/i.test(
    code.home + code.mission.replace(/cancelling a mission/gi, ""),
  ),
);
check(
  "5.7 end/cancel are explicitly attributed to the bot",
  /read-only/i.test(code.mission) && /Telegram bot\./.test(code.mission),
);

/* --------------------------------------------- 6. results vs targets split */

check(
  "6.1 results section is labelled distinctly",
  /heading="Live X results"/.test(code.mission),
);
check("6.2 targets section is labelled distinctly", /heading=\{`Targets · /.test(code.mission));
check(
  "6.3 snapshot copy does not claim real-time metrics",
  /Latest stored mission snapshot/.test(code.mission) && !/real-?time/i.test(uiCode),
);
check(
  "6.4 results render from panel.results and targets from panel.targets",
  /formatMetricValue\(panel\.results\[metric\]\)/.test(code.mission) &&
    /formatTargetValue\(panel\.targets\[metric\]\)/.test(code.mission),
);

/* ------------------------------------------------------- 7. null honesty */

check(
  "7.1 unavailable metric renders an em dash, never 0",
  /export function formatMetricValue[\s\S]*?value === null \|\| value === undefined \? "—"/.test(
    code.client,
  ),
);
check(
  "7.2 unset target reads Off, never 0",
  /export function formatTargetValue[\s\S]*?value === null \|\| value === undefined \? "Off"/.test(
    code.client,
  ),
);
check(
  "7.3 no null-to-zero coercion helpers in the UI",
  !/\?\?\s*0\b/.test(uiCode) && !/Number\(.*\)\s*\|\|\s*0/.test(uiCode),
);
check(
  "7.4 missing end time is not fabricated",
  /if \(!endsAt\) return "End time not set"/.test(code.client),
);

/* ------------------------------------------- 8. Telegram boot and fallback */

check(
  "8.1 outside-Telegram fallback state exists on both screens",
  /Open Mission Control from Telegram/.test(code.home) &&
    /Open Mission Control from Telegram/.test(code.mission),
);
check(
  "8.2 no privileged call runs without initData",
  /enabled: Boolean\(initData\)/.test(code.home) && /enabled: Boolean\(initData\)/.test(code.mission),
);
check(
  "8.3 non-destructive Telegram boot only",
  /app\?\.ready\?\.\(\)/.test(code.client) &&
    /app\?\.expand\?\.\(\)/.test(code.client) &&
    !/requestWriteAccess|requestContact|sendData|openInvoice/.test(uiCode),
);
check(
  "8.4 the official Telegram WebApp script is loaded from the route head",
  /https:\/\/telegram\.org\/js\/telegram-web-app\.js/.test(code.layout),
);
check(
  "8.5 no Telegram npm dependency was added",
  !/telegram-web-app"/.test(
    readFileSync("package.json", "utf8"),
  ),
);

/* ----------------------------------------------------- 9. mobile/safe area */

check(
  "9.1 safe-area insets are applied on all four edges",
  /safe-area-inset-top/.test(code.pieces) &&
    /safe-area-inset-bottom/.test(code.pieces) &&
    /safe-area-inset-left/.test(code.pieces) &&
    /safe-area-inset-right/.test(code.pieces),
);
check("9.2 mobile-first bounded width container", /max-w-md/.test(code.pieces));
check(
  "9.3 overflow-safe text treatment is used",
  /truncate/.test(code.pieces) && /min-w-0/.test(code.pieces),
);
check(
  "9.4 touch targets keep a minimum height",
  /min-h-9/.test(code.pieces) || /min-h-9/.test(code.home),
);

/* --------------------------------------------- 10. secrets and error safety */

check(
  "10.1 no secret/env references in Mini App UI",
  !/process\.env|SERVICE_ROLE|BOT_TOKEN|import\.meta\.env/.test(uiCode),
);
check(
  "10.2 internal RPC names are never rendered",
  !/social_mission_control_|social_mission_apply_|social_metric_snapshots/.test(uiCode),
);
check(
  "10.3 bounded failure reasons are mapped to user-safe copy",
  /export function miniAppFailureMessage/.test(code.client) &&
    /not_group_admin/.test(code.client) &&
    /Mission Control could not load this right now\./.test(code.client),
);
check(
  "10.4 raw errors, hashes or initData are never rendered",
  !/String\(error\)|error\.message|JSON\.stringify\(/.test(
    code.home + code.mission + code.pieces,
  ),
);

/* ----------------------------------------------- 11. bridge left unchanged */

const gitStatus = execSync("git status --porcelain", { encoding: "utf8" });
check(
  "11.1 the SE-16.0 bridge modules are untouched by this phase",
  !/telegram-miniapp-auth\.server\.ts|telegram-miniapp-bridge\.functions\.ts/.test(gitStatus),
);
check(
  "11.2 no SQL, supabase config or env file is modified",
  !/docs\/sql\/|supabase\/|\.env|package\.json/.test(gitStatus),
);

if (failures.length > 0) {
  console.error(`FAIL — ${failures.length} failed, ${passed} passed`);
  for (const failure of failures) console.error(`  - ${failure}`);
  process.exit(1);
}
console.log(`PASS — ${passed}/${passed} SE-16.1 mini app UI checks passed`);
