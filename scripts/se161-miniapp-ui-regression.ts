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

/* ------------------------- 5. SE-16.2 bounded mutation scope (narrowed) */

/**
 * END NOW and CANCEL stay permanently bot-owned. These are still absolute
 * prohibitions: no import, no RPC name, no actionable control anywhere in the
 * Mini App UI.
 */
const FORBIDDEN_FNS = [
  "end_social_mission_from_control",
  "cancel_social_mission_from_control",
  "miniAppEndMission",
  "miniAppCancelMission",
];
for (const fn of FORBIDDEN_FNS) {
  check(`5.${fn} is not referenced by the Mini App UI`, !uiCode.includes(fn));
}
const missionOnlyMutations = ["miniAppApplyTargets", "miniAppApplyDuration"];
for (const fn of missionOnlyMutations) {
  check(
    `5.scope ${fn} is imported by the mission route only`,
    code.mission.includes(fn) &&
      !code.home.includes(fn) &&
      !code.layout.includes(fn) &&
      !code.pieces.includes(fn) &&
      !code.client.includes(fn),
  );
}
check(
  "5.5 the read bridge functions are still the only read imports",
  /miniAppListMissionWorkspaces/.test(code.home) &&
    /miniAppListMissions/.test(code.home) &&
    /miniAppMissionPanel/.test(code.mission),
);
check(
  "5.6 exactly the two authorized mutation controls are rendered",
  /Edit targets/.test(code.mission) &&
    /Change end time/.test(code.mission) &&
    !/End now|End Now|End mission|End Mission|Cancel mission|Cancel Mission/.test(code.mission) &&
    !/Edit targets|Change end time/.test(code.home),
);
check(
  "5.7 end/cancel are explicitly attributed to the bot, without a read-only claim",
  /Ending or cancelling the mission is still handled/.test(code.mission) &&
    /Telegram bot\./.test(code.mission) &&
    !/This view is read-only/.test(code.mission),
);
check(
  "5.8 no reset-to-auto control exists (the bridge does not expose it)",
  !/Reset to auto|reset_to_auto|resetToAuto/i.test(uiCode),
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
  "9.1 padding is applied on all four edges",
  /paddingTop:/.test(code.pieces) &&
    /paddingBottom:/.test(code.pieces) &&
    /paddingLeft:/.test(code.pieces) &&
    /paddingRight:/.test(code.pieces) &&
    /"top"/.test(code.pieces) &&
    /"bottom"/.test(code.pieces) &&
    /"left"/.test(code.pieces) &&
    /"right"/.test(code.pieces),
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

/* ----------------------------- 12. SE-16.1H bounded Telegram bridge readiness */

check(
  "12.1 a bounded readiness wait exists for the Telegram bridge",
  /export async function waitForTelegramWebApp/.test(code.client) &&
    /TELEGRAM_BRIDGE_TIMEOUT_MS/.test(code.client) &&
    /TELEGRAM_BRIDGE_POLL_MS/.test(code.client),
);
check(
  "12.2 the readiness wait is deadline-bounded, never unbounded",
  /const deadline = Date\.now\(\) \+ Math\.max\(0, timeoutMs\)/.test(code.client) &&
    /if \(Date\.now\(\) >= deadline\) return/.test(code.client),
);
check(
  "12.3 an already-present bridge is recognised immediately",
  /const app = webApp\(\);[\s\S]{0,200}?if \(app && typeof app\.initData === "string"/.test(
    code.client,
  ),
);
check(
  "12.4 a single session resolver awaits readiness, boots, then reads the credential",
  /export async function resolveTelegramSession[\s\S]*?await waitForTelegramWebApp\(timeoutMs\);[\s\S]*?telegramBoot\(\);[\s\S]*?return readRawInitData\(\);/.test(
    code.client,
  ),
);
check(
  "12.5 neither screen performs a one-shot synchronous credential read",
  !/setInitData\(readRawInitData\(\)\)/.test(code.home + code.mission) &&
    /resolveTelegramSession\(\)/.test(code.home) &&
    /resolveTelegramSession\(\)/.test(code.mission),
);
check(
  "12.6 the Telegram script is not deferred behind async loading",
  /telegram-web-app\.js/.test(code.layout) && !/async: true/.test(code.layout),
);
check(
  "12.7 boot effects are cancellation-safe",
  /cancelled = true/.test(code.home) && /cancelled = true/.test(code.mission),
);

/* ------------------------- 13. Telegram safe area with browser fallback */

for (const edge of ["top", "right", "bottom", "left"] as const) {
  check(
    `13.${edge} Telegram content-safe, Telegram safe and browser env fallback chain`,
    new RegExp(
      `--tg-content-safe-area-inset-\\$\\{edge\\}[\\s\\S]*?--tg-safe-area-inset-\\$\\{edge\\}[\\s\\S]*?env\\(safe-area-inset-\\$\\{edge\\}`,
    ).test(code.pieces) &&
      new RegExp(`"${edge}", "[0-9.]+rem"`).test(code.pieces),
  );
}
check(
  "13.5 a usable minimum padding is preserved on every edge",
  (code.pieces.match(/inset\("(top|right|bottom|left)", "[0-9.]+rem"\)/g) ?? []).length === 4,
);
check(
  "13.6 the frame still uses max() so insets never shrink below the minimum",
  /max\(var\(--tg-content-safe-area-inset-/.test(code.pieces),
);

/* --------------------------- 14. deterministic workspace selection contract */

check(
  "14.1 exactly one authorized workspace is auto-selected",
  /workspaces\.length === 1/.test(code.home),
);
check(
  "14.2 two or more workspaces select none until the operator chooses",
  !/workspaces\.length > 0\)\s*setWorkspaceId/.test(code.home) &&
    !/setWorkspaceId\(workspaces\[0\]\.workspaceId\)/.test(code.home) &&
    /return null;/.test(code.home),
);
check(
  "14.3 an existing valid selection survives a refetch",
  /workspaces\.some\(\(workspace\) => workspace\.workspaceId === current\)/.test(code.home),
);
check(
  "14.4 the multi-workspace selector is still rendered with explicit guidance",
  /workspaces\.length > 1/.test(code.home) && /Choose a project/.test(code.home),
);
check(
  "14.5 no unsafe non-null assertion is used for workspace selection",
  !/workspaces\[0\]!/.test(code.home) && !/\bas any\b/.test(code.home),
);

/* ------------------------- 15. failure contract matches the real SE-16.0 */

const VALIDATOR_REASONS = [
  "missing_bot_token",
  "missing_init_data",
  "init_data_too_large",
  "malformed_init_data",
  "duplicate_field",
  "missing_hash",
  "missing_auth_date",
  "invalid_auth_date",
  "missing_user",
  "malformed_user",
  "invalid_user_id",
  "stale_auth_date",
  "future_auth_date",
  "bad_signature",
];
const BRIDGE_REASONS = [
  "invalid_mission_id",
  "invalid_workspace_id",
  "not_found",
  "not_group_admin",
  "unavailable",
];
for (const reason of [...VALIDATOR_REASONS, ...BRIDGE_REASONS]) {
  check(`15.${reason} has explicit user-safe copy`, code.client.includes(`case "${reason}":`));
}
check(
  "15.a obsolete reason names are removed",
  !/expired_init_data|future_init_data|invalid_hash/.test(code.client),
);
check(
  "15.b the declared validator reasons are exactly the ones the UI maps",
  VALIDATOR_REASONS.every((reason) =>
    stripComments(readFileSync("src/lib/telegram-miniapp-auth.server.ts", "utf8")).includes(
      `"${reason}"`,
    ),
  ),
);
check(
  "15.c signed-session failures route to reopen-from-bot guidance",
  /case "bad_signature":\s*\n?\s*return "Your Telegram session expired\./.test(code.client),
);
check(
  "15.d infrastructure failures route to temporary-unavailable guidance",
  /case "missing_bot_token":[\s\S]{0,80}?case "unavailable":\s*\n?\s*return "Mission Control is temporarily unavailable\./.test(
    code.client,
  ),
);
check(
  "15.e permission failure copy stays specific and safe",
  /case "not_group_admin":\s*\n?\s*return "You are not currently an admin/.test(code.client),
);
check(
  "15.f no internal reason name is ever rendered in a screen",
  !VALIDATOR_REASONS.some((reason) => code.home.includes(reason) || code.mission.includes(reason)),
);

/* --------------------------------------------- 16. retry / recovery UX */

check(
  "16.1 a retry affordance primitive exists",
  /export function MiniAppRetryButton/.test(code.pieces) && /onRetry/.test(code.pieces),
);
check(
  "16.2 workspace and mission-list failures offer retry",
  (code.home.match(/MiniAppRetryButton/g) ?? []).length >= 2 &&
    /workspacesQuery\.refetch\(\)/.test(code.home) &&
    /missionsQuery\.refetch\(\)/.test(code.home),
);
check(
  "16.3 mission panel failure offers retry",
  /MiniAppRetryButton/.test(code.mission) && /panelQuery\.refetch\(\)/.test(code.mission),
);
check(
  "16.4 read-failure retry stays read-only; mutations live only in explicit handlers",
  // The read-recovery primitive and the home screen never mutate.
  !/miniAppApply|useMutation/.test(code.home + code.pieces) &&
    // The mission screen's only mutation entry points are the two named
    // mutations, invoked from explicit submit/retry handlers.
    /panelQuery\.refetch\(\)/.test(code.mission) &&
    (code.mission.match(/useMutation\(/g) ?? []).length === 2 &&
    (code.mission.match(/\.mutate\(/g) ?? []).length === 4 &&
    /function submitTargets\(\)/.test(code.mission) &&
    /function submitDuration\(/.test(code.mission) &&
    /function retryPending\(\)/.test(code.mission),
);

check(
  "16.5 retry surfaces pending state instead of silently re-firing",
  /pending=\{workspacesQuery\.isFetching\}/.test(code.home) &&
    /pending=\{panelQuery\.isFetching\}/.test(code.mission),
);

/* --------------------------------- 17. authoritative status presentation */

check(
  "17.1 the mission screen renders the server-returned status, not a constant",
  /<StatusBadge tone=\{missionStatusTone\(panel\.status\)\}>\{panel\.status\}<\/StatusBadge>/.test(
    code.mission,
  ) && !/tone="green">\{panel\.status\}/.test(code.mission),
);
check(
  "17.2 the picker derives its badge tone from the returned status",
  /missionStatusTone\(mission\.status\)/.test(code.home) &&
    !/mission\.status === "LIVE" \? "green" : "muted"/.test(code.home),
);
check(
  "17.3 the status tone helper covers live, completed and cancelled",
  /case "LIVE":/.test(code.client) &&
    /case "COMPLETED":/.test(code.client) &&
    /case "CANCELLED":/.test(code.client),
);

/* -------------------------------- 18. SE-16.1H4 route-scoped response headers */

const headerBlock = (code.layout.match(/headers:\s*\(\)\s*=>\s*\(\{[\s\S]*?\}\),/) ?? [""])[0];
const cspBlock = (code.layout.match(/CONTENT_SECURITY_POLICY = \[[\s\S]*?\]\.join/) ?? [""])[0];
const permBlock = (code.layout.match(/PERMISSIONS_POLICY = \[[\s\S]*?\]\.join/) ?? [""])[0];

check("18.1 /tg defines route-scoped headers", headerBlock.length > 0);
check("18.2 Cache-Control is no-store", /"Cache-Control":\s*"no-store"/.test(headerBlock));
check("18.3 Referrer-Policy is no-referrer", /"Referrer-Policy":\s*"no-referrer"/.test(headerBlock));
check(
  "18.4 X-Content-Type-Options is nosniff",
  /"X-Content-Type-Options":\s*"nosniff"/.test(headerBlock),
);
check(
  "18.5 CSP header is wired to the policy constant",
  /"Content-Security-Policy":\s*CONTENT_SECURITY_POLICY/.test(headerBlock) && cspBlock.length > 0,
);
check(
  "18.6 CSP pins default-src, object-src, base-uri and form-action",
  /"default-src 'self'"/.test(cspBlock) &&
    /"object-src 'none'"/.test(cspBlock) &&
    /"base-uri 'self'"/.test(cspBlock) &&
    /"form-action 'self'"/.test(cspBlock),
);
check(
  "18.7 CSP permits the official Telegram WebApp script origin",
  /script-src[^"]*https:\/\/telegram\.org/.test(cspBlock),
);
check(
  "18.8 CSP permits Telegram Web framing",
  /frame-ancestors[^"]*https:\/\/web\.telegram\.org/.test(cspBlock),
);
check(
  "18.9 framing is not blocked by X-Frame-Options",
  !/X-Frame-Options/i.test(code.layout),
);
check(
  "18.10 Permissions-Policy disables camera, microphone, geolocation, payment and usb",
  /"Permissions-Policy":\s*PERMISSIONS_POLICY/.test(headerBlock) &&
    /"camera=\(\)"/.test(permBlock) &&
    /"microphone=\(\)"/.test(permBlock) &&
    /"geolocation=\(\)"/.test(permBlock) &&
    /"payment=\(\)"/.test(permBlock) &&
    /"usb=\(\)"/.test(permBlock),
);
check("18.11 no wildcard source appears anywhere in the CSP", !/\*/.test(cspBlock));
check(
  "18.12 connect-src is bounded to same-origin plus the known Supabase project",
  /connect-src 'self' \$\{SUPABASE_ORIGIN\} \$\{SUPABASE_WS_ORIGIN\}/.test(cspBlock) &&
    /SUPABASE_ORIGIN = "https:\/\/[a-z0-9]+\.supabase\.co"/.test(code.layout),
);
check(
  "18.13 the official Telegram script tag is unchanged",
  /https:\/\/telegram\.org\/js\/telegram-web-app\.js/.test(code.layout),
);
check("18.14 /tg stays noindex", /"robots", content: "noindex"/.test(code.layout));

/* ------------------- 19. SE-16.2 target + end-time mutation UI contract */

check(
  "19.1 mutation controls render only for authoritative LIVE status",
  /panel\.status\.toUpperCase\(\) === "LIVE"/.test(code.mission) &&
    /isLive \? \(/.test(code.mission) &&
    /isLive && editor === "targets"/.test(code.mission) &&
    /isLive && editor === "duration"/.test(code.mission),
);
check(
  "19.2 no client-supplied identity is sent with a mutation",
  !/chatId|chat_id|workspaceId|workspace_id|telegramUserId|telegram_user_id|targetId|target_id|actorUserId|actor_user_id|editRevision|edit_revision/.test(
    code.mission,
  ),
);
check(
  "19.3 mutation payloads carry only credential + mission hint + request id + bounded values",
  /type TargetsPayload = \{\s*initData: string;\s*missionId: string;\s*requestId: string;\s*primaryType: string;\s*primaryTarget: number;/.test(
    code.mission,
  ) &&
    /type DurationPayload = \{\s*initData: string;\s*missionId: string;\s*requestId: string;\s*minutes: number;\s*\};/.test(
      code.mission,
    ),
);
check(
  "19.4 a new submit mints a fresh crypto.randomUUID request id",
  /source\.randomUUID\(\)/.test(code.client) &&
    /globalThis\.crypto/.test(code.client) &&
    (code.mission.match(/newRequestId\(\)/g) ?? []).length === 2,
);
check(
  "19.5 newRequestId fails safely instead of fabricating an id",
  /typeof source\.randomUUID !== "function"\) return null/.test(code.client) &&
    /if \(!requestId\) \{/.test(code.mission),
);
check(
  "19.6 retry resends the SAME stored payload and request id",
  /function retryPending\(\)/.test(code.mission) &&
    /targetsMutation\.mutate\(pendingTargets\)/.test(code.mission) &&
    /durationMutation\.mutate\(pendingDuration\)/.test(code.mission) &&
    !/retryPending[\s\S]{0,240}newRequestId\(\)/.test(code.mission),
);
check(
  "19.7 primary goal choices are exactly the bridge allowlist",
  /MINI_APP_PRIMARY_TYPES = \[\s*"VIEWS",\s*"LIKES",\s*"REPLIES",\s*"REPOSTS",\s*"TOTAL_INTERACTIONS",\s*\]/.test(
    code.client,
  ),
);
check(
  "19.8 supporting metric fields are exactly the bridge metric set",
  /MINI_APP_SUPPORTING_METRICS = \[\s*"views",\s*"likes",\s*"replies",\s*"reposts",\s*"bookmarks",\s*\]/.test(
    code.client,
  ),
);
check(
  "19.9 blank supporting target means Off (null), never zero",
  /if \(trimmed\.length === 0\) return \{ ok: true, value: null \}/.test(code.client) &&
    !/\?\?\s*0\b/.test(code.mission) &&
    /placeholder="Off"/.test(code.mission),
);
check(
  "19.10 client-side validation rejects non-integer, zero and unsafe values",
  /!\/\^\[0-9\]\+\$\/\.test\(trimmed\)/.test(code.client) &&
    /!Number\.isSafeInteger\(parsed\) \|\| parsed <= 0/.test(code.client),
);
check(
  "19.11 a pinned supporting metric is disclosed, not silently overridden",
  /MINI_APP_PINNED_SUPPORT/.test(code.client) &&
    /pinned to the\s+primary target by the server/.test(code.mission),
);
check(
  "19.12 AUTO missions are told that saving switches to MANUAL control",
  /AUTO/.test(code.mission) && /switches this mission to MANUAL target control/.test(code.mission),
);
check(
  "19.13 duration bounds match the bridge/RPC exactly",
  /MINI_APP_MIN_MINUTES = 1;/.test(code.client) &&
    /MINI_APP_MAX_MINUTES = 1440;/.test(code.client) &&
    /minutes >= MINI_APP_MIN_MINUTES &&\s*minutes <= MINI_APP_MAX_MINUTES/.test(code.client) &&
    /isMinutesInBounds\(minutes\)/.test(code.mission),
);
check(
  "19.14 duration quick choices are exactly 30m/1h/2h/4h/12h/24h",
  /\{ label: "30m", minutes: 30 \}/.test(code.client) &&
    /\{ label: "1h", minutes: 60 \}/.test(code.client) &&
    /\{ label: "2h", minutes: 120 \}/.test(code.client) &&
    /\{ label: "4h", minutes: 240 \}/.test(code.client) &&
    /\{ label: "12h", minutes: 720 \}/.test(code.client) &&
    /\{ label: "24h", minutes: 1440 \}/.test(code.client),
);
check(
  "19.15 the end time is described as minutes from now, never fabricated",
  /minutes from now/i.test(code.mission) && !/new Date\(/.test(code.mission),
);
check(
  "19.16 only ok and replayed count as committed",
  /outcome === "ok" \|\| outcome === "replayed"/.test(code.client) &&
    /MINI_APP_COMMITTED_OUTCOMES = \["ok", "replayed"\]/.test(code.client),
);
check(
  "19.17 committed outcomes refetch the authoritative panel and close the editor",
  /if \(classified\.committed\) \{[\s\S]{0,200}setEditor\(null\);[\s\S]{0,200}panelQuery\.refetch\(\)/.test(
    code.mission,
  ),
);
check(
  "19.18 a committed mutation with unconfirmed refresh is not reported as full success",
  /message: "Saved, but the Telegram card could not be confirmed\. Retry card refresh\."/.test(
    code.client,
  ) &&
    /committed: true,\s*retry: true/.test(code.client) &&
    /refresh === "edited" \|\| result\.refresh === "replayed"/.test(code.client),
);
check(
  "19.19 network uncertainty never claims a save and keeps a safe retry",
  /Could not confirm whether the change was saved\. Retry safely\./.test(code.client) &&
    /networkUncertaintyNotice\(\)/.test(code.mission) &&
    /committed: false,\s*retry: true/.test(code.client),
);
check(
  "19.20 not_live and conflict get bounded explanatory copy",
  /case "not_live":/.test(code.client) &&
    /no longer live/.test(code.client) &&
    /case "conflict":/.test(code.client) &&
    /Try again in a few seconds/.test(code.client),
);
check(
  "19.21 raw reasons, errors, payloads, request ids and initData are never rendered",
  !/\{reason\}|\{error|String\(error\)|error\.message|JSON\.stringify\(|\{requestId\}|\{initData\}/.test(
    code.mission,
  ),
);
check(
  "19.22 double-submit is prevented while a mutation is pending",
  /mutationPending = targetsMutation\.isPending \|\| durationMutation\.isPending/.test(
    code.mission,
  ) && /disabled=\{mutationPending\}/.test(code.mission),
);
check(
  "19.23 target and duration mutations stay independent",
  /const targetsMutation = useMutation\(/.test(code.mission) &&
    /const durationMutation = useMutation\(/.test(code.mission) &&
    /kind: "targets"/.test(code.mission) &&
    /kind: "duration"/.test(code.mission),
);

check(
  "19.24 pending state is visible to the user",
  /pendingLabel="Saving…"/.test(code.mission) && /pendingLabel="Updating…"/.test(code.mission),
);
check(
  "19.25 editors are inline; no browser prompt/alert/confirm and no navigation away",
  !/window\.prompt|window\.alert|window\.confirm|\bprompt\(|\balert\(|\bconfirm\(/.test(
    code.mission,
  ) && /MiniAppEditorShell/.test(code.mission),
);
check(
  "19.26 presentation primitives hold no data call, credential or mutation",
  !/useServerFn|useMutation|useQuery|initData|supabase|process\.env/.test(code.pieces),
);
check(
  "19.27 the client helper module imports no server-only module",
  !/\.server|bridge\.functions|process\.env|SERVICE_ROLE/.test(code.client),
);
check(
  "19.28 no direct Telegram API call or provider/X read exists in the UI",
  !/api\.telegram\.org|x\.com\/i\/api|twitter\.com\/i\/api|X_API|BOT_TOKEN/.test(uiCode),
);



if (failures.length > 0) {

  console.error(`FAIL — ${failures.length} failed, ${passed} passed`);
  for (const failure of failures) console.error(`  - ${failure}`);
  process.exit(1);
}
console.log(`PASS — ${passed}/${passed} SE-16.1 mini app UI checks passed`);
