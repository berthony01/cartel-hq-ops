/**
 * SE-3.1 regression — source/static only.
 *
 * ZERO network, ZERO database, ZERO secrets, ZERO Telegram. Every assertion is
 * a static check over the owner-only Social Mission live-test control and its
 * single render site in the Owner Console.
 *
 * Run: bun scripts/se31-owner-social-mission-test-control-regression.ts
 */

import { readFileSync } from "node:fs";

let passed = 0;
const failures: string[] = [];

function check(name: string, condition: boolean): void {
  if (condition) passed += 1;
  else failures.push(name);
}

const CONTROL_PATH = "src/components/cartel/SocialMissionTestControl.tsx";
const ADMIN_PATH = "src/routes/_authenticated/admin.tsx";
const CLIENT_PATH = "src/lib/social-mission-telegram.ts";

const controlSrc = readFileSync(CONTROL_PATH, "utf8");
const adminSrc = readFileSync(ADMIN_PATH, "utf8");
const clientSrc = readFileSync(CLIENT_PATH, "utf8");

/** Behavioural assertions must read CODE, not doc comments that legitimately
 *  name the things this phase excludes. */
function stripComments(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
}
const controlCode = stripComments(controlSrc);

// ---------------------------------------------------------------------------
// 1. Hard-pinned fixture identity
// ---------------------------------------------------------------------------

check(
  "1.1 metadata marker is the exact pinned value",
  controlCode.includes('const OWNER_TEST_CONTROL_MARKER = "pepe_cartel_community_v1"'),
);
check(
  "1.2 marker is used as a metadata containment filter on social_missions",
  /\.contains\("metadata",\s*\{\s*owner_test_control:\s*OWNER_TEST_CONTROL_MARKER\s*\}\)/.test(
    controlCode,
  ),
);
check(
  "1.3 group title gate is the exact production group",
  controlCode.includes('const REQUIRED_GROUP_TITLE = "PEPE CARTEL COMMUNITY"'),
);
check(
  "1.4 canonical URL gate is the exact pinned X post",
  controlCode.includes(
    'const REQUIRED_CANONICAL_URL = "https://x.com/PEPECARTELTOKEN/status/2098827349470961903"',
  ),
);
check(
  "1.5 mission status gate is LIVE",
  controlCode.includes('const REQUIRED_MISSION_STATUS = "LIVE"'),
);
check(
  "1.6 delivery state gate is PENDING",
  controlCode.includes('const REQUIRED_DELIVERY_STATE = "PENDING"'),
);

// ---------------------------------------------------------------------------
// 2. Gates are enforced by equality, and all must pass to arm the send
// ---------------------------------------------------------------------------

check(
  "2.1 mission status compared by strict equality to the gate",
  controlCode.includes("fixture.missionStatus === REQUIRED_MISSION_STATUS"),
);
check(
  "2.2 delivery state compared by strict equality to the gate",
  controlCode.includes("fixture.deliveryState === REQUIRED_DELIVERY_STATE"),
);
check(
  "2.3 group title compared by strict equality to the gate",
  controlCode.includes("fixture.groupTitle === REQUIRED_GROUP_TITLE"),
);
check(
  "2.4 canonical URL compared by strict equality to the gate",
  controlCode.includes("fixture.canonicalUrl === REQUIRED_CANONICAL_URL"),
);
check(
  "2.5 non-null group_connection_id is required",
  controlCode.includes("ok: !!fixture.groupConnectionId"),
);
check(
  "2.6 every gate must pass before the control can be armed",
  controlCode.includes("gates.length > 0 && gates.every((g) => g.ok)") &&
    /const canSend = !!fixture && allGatesPass && !sending && !attempted/.test(controlCode),
);
check(
  "2.7 send button is disabled whenever the control is not armed",
  controlCode.includes("disabled={!canSend}"),
);
check(
  "2.8 the confirmed submit handler re-checks the gates before invoking",
  /if \(!fixture \|\| !allGatesPass \|\| sending \|\| attempted\) return;/.test(controlCode),
);

// ---------------------------------------------------------------------------
// 3. Single-fixture discovery: zero or multiple rows must disable
// ---------------------------------------------------------------------------

check(
  "3.1 zero matching missions disables with a reported reason",
  /missionRows\.length === 0[\s\S]{0,200}ok: false/.test(controlCode),
);
check(
  "3.2 multiple matching missions disable with a reported reason",
  /missionRows\.length > 1[\s\S]{0,200}ok: false/.test(controlCode),
);
check(
  "3.3 zero targets disables",
  /targetRows\.length === 0[\s\S]{0,200}ok: false/.test(controlCode),
);
check(
  "3.4 multiple targets disable",
  /targetRows\.length > 1[\s\S]{0,200}ok: false/.test(controlCode),
);
check(
  "3.5 the bound post and bound group connection are both loaded",
  controlCode.includes('.from("social_posts")') &&
    controlCode.includes('.from("telegram_group_connections")'),
);

// ---------------------------------------------------------------------------
// 4. Transport: sendMissionCard only
// ---------------------------------------------------------------------------

check(
  "4.1 the only transport import is the existing thin client",
  /import \{ sendMissionCard, type SendMissionCardResult \} from "@\/lib\/social-mission-telegram"/.test(
    controlSrc,
  ),
);
check("4.2 sendMissionCard is invoked exactly once in source", (controlCode.match(/sendMissionCard\(/g) ?? []).length === 1);
check("4.3 no editMissionCard reference", !controlSrc.includes("editMissionCard"));
check("4.4 no direct functions.invoke", !controlSrc.includes("functions.invoke"));
check(
  "4.5 the four documented transport arguments are passed",
  /workspaceId: fixture\.workspaceId/.test(controlCode) &&
    /missionId: fixture\.missionId/.test(controlCode) &&
    /targetId: fixture\.targetId/.test(controlCode) &&
    /clientRequestId: crypto\.randomUUID\(\)/.test(controlCode),
);
check(
  "4.6 the request id is generated only inside the confirmed submit handler",
  (controlCode.match(/crypto\.randomUUID\(\)/g) ?? []).length === 1 &&
    /async function confirmedSend\(\)[\s\S]{0,1400}crypto\.randomUUID\(\)/.test(controlCode),
);
check(
  "4.7 the thin client itself still exposes send and edit unchanged",
  clientSrc.includes("export function sendMissionCard") &&
    clientSrc.includes("export function editMissionCard"),
);

// ---------------------------------------------------------------------------
// 5. No writes, no timers, no polling, no retry, no provider calls
// ---------------------------------------------------------------------------

check("5.1 no insert against any table", !/\.insert\(/.test(controlCode));
check("5.2 no update against any table", !/\.update\(/.test(controlCode));
check("5.3 no upsert against any table", !/\.upsert\(/.test(controlCode));
check("5.4 no delete against any table", !/\.delete\(/.test(controlCode));
check("5.5 no rpc call", !/\.rpc\(/.test(controlCode));
check("5.6 no setInterval", !controlCode.includes("setInterval"));
check("5.7 no setTimeout", !controlCode.includes("setTimeout"));
check("5.8 no react-query polling interval", !controlCode.includes("refetchInterval"));
check("5.9 fixture query does not retry", controlCode.includes("retry: false"));
check(
  "5.10 no retry/resend loop around the transport call",
  !/for \(|while \(/.test(controlCode),
);
check(
  "5.11 a send is attempted at most once per session",
  controlCode.includes("setAttempted(true)") && controlCode.includes("!attempted"),
);
check(
  "5.12 no social provider or metrics API surface is touched",
  !/social-read|socialRead|impression_count|refetcher/i.test(controlCode),
);
check(
  "5.13 no transport-state column is written from the browser",
  !/delivery_state:\s/.test(controlCode) &&
    !/telegram_message_id:\s/.test(controlCode) &&
    !/send_client_request_id/.test(controlCode),
);
check(
  "5.14 no auto-send on mount: the transport call is not reachable from an effect",
  !controlCode.includes("useEffect"),
);
check(
  "5.15 no generic destination or post selector",
  !/<Select/.test(controlSrc) && !controlCode.includes("setGroupId"),
);

// ---------------------------------------------------------------------------
// 6. Confirmation dialog wording
// ---------------------------------------------------------------------------

check(
  "6.1 confirmation states exactly one visible Telegram message",
  /ONE visible Telegram message/.test(controlSrc),
);
check(
  "6.2 confirmation names the pinned production group",
  controlSrc.includes("${REQUIRED_GROUP_TITLE}"),
);
check(
  "6.3 confirmation names the existing bot",
  controlSrc.includes("the existing @PepeCartelHQBot bot"),
);
check(
  "6.4 confirmation states there is no automatic retry",
  /there is no automatic retry/.test(controlSrc),
);
check(
  "6.5 the confirmation body is rendered in the dialog",
  controlCode.includes("{CONFIRM_BODY}") && controlCode.includes("{CONFIRM_TITLE}"),
);
check(
  "6.6 the send action runs only from the dialog confirm action",
  /AlertDialogAction onClick=\{confirmedSend\}/.test(controlCode) &&
    /onClick=\{\(\) => setConfirmOpen\(true\)\}/.test(controlCode),
);

// ---------------------------------------------------------------------------
// 7. Post-response authoritative refetch and state display
// ---------------------------------------------------------------------------

check(
  "7.1 authoritative fixture data is refetched after the response",
  /finally \{[\s\S]{0,200}await query\.refetch\(\)/.test(controlCode),
);
check(
  "7.2 authoritative delivery state, message id and sent_at are displayed",
  controlCode.includes("Authoritative delivery state") &&
    controlCode.includes("fixture.telegramMessageId") &&
    controlCode.includes("formatWhen(fixture.sentAt)"),
);
check(
  "7.3 sanitized result and error copy are surfaced",
  controlCode.includes("result.deliveryState") && controlCode.includes("{sendError}"),
);
check(
  "7.4 the action is disabled while in flight",
  controlCode.includes("setSending(true)") && controlCode.includes("!sending"),
);

// ---------------------------------------------------------------------------
// 8. Render site: owner-only, after the platform-owner restriction branch
// ---------------------------------------------------------------------------

const importIdx = adminSrc.indexOf(
  'import { SocialMissionTestControl } from "@/components/cartel/SocialMissionTestControl"',
);
const ownerGuardIdx = adminSrc.indexOf("if (!isPlatformOwner) {");
const renderIdx = adminSrc.indexOf("<SocialMissionTestControl />");

check("8.1 the control is imported in the Owner Console", importIdx > -1);
check("8.2 the owner restriction branch exists", ownerGuardIdx > -1);
check("8.3 the control is rendered exactly once", (adminSrc.match(/<SocialMissionTestControl \/>/g) ?? []).length === 1);
check(
  "8.4 the control renders only after the !isPlatformOwner early return",
  renderIdx > -1 && renderIdx > ownerGuardIdx,
);
check(
  "8.5 the restricted branch does not render the control",
  !adminSrc
    .slice(ownerGuardIdx, adminSrc.indexOf("const m = metrics ??"))
    .includes("SocialMissionTestControl"),
);
check(
  "8.6 no separate auth mechanism was introduced in the control",
  !controlCode.includes("isPlatformOwner") &&
    !controlCode.includes("usePlatformAccess") &&
    !controlCode.includes("auth.getUser"),
);
check(
  "8.7 the Owner Console copy no longer claims all operational data is read-only",
  !adminSrc.includes("Operational data in this console is read-only") &&
    adminSrc.includes("Operational listings in this console are read-only"),
);
check(
  "8.8 the page description acknowledges the live-test action",
  adminSrc.includes("the single pinned Social Mission live test"),
);

// ---------------------------------------------------------------------------

console.log(`SE-3.1 regression: ${passed} passed, ${failures.length} failed`);
if (failures.length > 0) {
  for (const failure of failures) console.log(`  FAIL ${failure}`);
  process.exit(1);
}
