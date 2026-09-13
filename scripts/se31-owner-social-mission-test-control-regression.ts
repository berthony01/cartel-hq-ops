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
check(
  "4.3 editMissionCard is invoked exactly once, only for the SE-3.2A in-place update",
  (controlCode.match(/editMissionCard\(/g) ?? []).length === 1,
);
check("4.4 no direct functions.invoke", !controlSrc.includes("functions.invoke"));
check(
  "4.5 the four documented transport arguments are passed",
  /workspaceId: fixture\.workspaceId/.test(controlCode) &&
    /missionId: fixture\.missionId/.test(controlCode) &&
    /targetId: fixture\.targetId/.test(controlCode) &&
    /clientRequestId: crypto\.randomUUID\(\)/.test(controlCode),
);
check(
  "4.6 one request id per confirmed handler, generated only inside those handlers",
  (controlCode.match(/crypto\.randomUUID\(\)/g) ?? []).length === 2 &&
    /async function confirmedSend\(\)[\s\S]{0,1400}crypto\.randomUUID\(\)/.test(controlCode) &&
    /async function confirmedUpdate\(\)[\s\S]{0,1600}crypto\.randomUUID\(\)/.test(controlCode),
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



// ---------------------------------------------------------------------------
// 9. SE-3.2A — owner-only metric capture + in-place edit of the SAME message
// ---------------------------------------------------------------------------

const CAPTURE_PATH = "src/lib/social-mission-metrics.functions.ts";
const captureSrc = readFileSync(CAPTURE_PATH, "utf8");
const captureCode = stripComments(captureSrc);

check(
  "9.1 capture runs as an authenticated server function",
  captureCode.includes('import { createServerFn } from "@tanstack/react-start"') &&
    captureCode.includes(".middleware([requireSupabaseAuth])"),
);
check(
  "9.2 the client supplies no input at all to the capture function",
  !captureCode.includes(".inputValidator("),
);
check(
  "9.3 the fixture marker, URL, group title, mission status and delivery state are hard-pinned server-side",
  captureCode.includes('export const METRIC_CAPTURE_MARKER = "pepe_cartel_community_v1"') &&
    captureCode.includes(
      'export const METRIC_CAPTURE_CANONICAL_URL =\n  "https://x.com/PEPECARTELTOKEN/status/2098827349470961903"',
    ) &&
    captureCode.includes('export const METRIC_CAPTURE_GROUP_TITLE = "PEPE CARTEL COMMUNITY"') &&
    captureCode.includes('export const METRIC_CAPTURE_MISSION_STATUS = "LIVE"') &&
    captureCode.includes('export const METRIC_CAPTURE_DELIVERY_STATE = "SENT"'),
);
check(
  "9.4 every pin is enforced by strict equality on the loaded fixture",
  captureCode.includes("mission.status !== METRIC_CAPTURE_MISSION_STATUS") &&
    captureCode.includes("post.data.canonical_url !== METRIC_CAPTURE_CANONICAL_URL") &&
    captureCode.includes("target.delivery_state !== METRIC_CAPTURE_DELIVERY_STATE") &&
    captureCode.includes("group.data.title !== METRIC_CAPTURE_GROUP_TITLE"),
);
check(
  "9.5 the provider read uses the pinned URL, never a client-supplied one",
  /fetchPostMetrics\(\{ url: METRIC_CAPTURE_CANONICAL_URL \}\)/.test(captureCode),
);
check(
  "9.6 exactly one provider read through the existing direct-first router",
  (captureCode.match(/socialReadRouter\./g) ?? []).length === 1 &&
    captureCode.includes('await import("./social-read-router.server")') &&
    !captureCode.includes("social-read-refetcher"),
);
check(
  "9.7 operator authorization runs before the provider call and before the write",
  captureCode.indexOf('rpc(\n      "is_workspace_operator"') > -1 &&
    captureCode.indexOf('rpc(\n      "is_workspace_operator"') <
      captureCode.indexOf("socialReadRouter.fetchPostMetrics") &&
    captureCode.indexOf('rpc(\n      "is_workspace_operator"') <
      captureCode.indexOf("supabaseAdmin"),
);
check(
  "9.8 the workspace checked is the fixture's own workspace and the caller's verified id",
  captureCode.includes("{ _workspace_id: mission.workspace_id, _user_id: context.userId }"),
);
check(
  "9.9 a failed read returns a sanitized failure and writes nothing",
  /if \(!read\.ok\) \{[\s\S]{0,200}return failure\(/.test(captureCode) &&
    captureCode.indexOf("if (!read.ok)") < captureCode.indexOf("supabaseAdmin"),
);
check(
  "9.10 exactly one snapshot insert, into the existing snapshot table only",
  (captureCode.match(/\.insert\(/g) ?? []).length === 1 &&
    captureCode.includes('.from("social_metric_snapshots")'),
);
check(
  "9.11 the snapshot uses the live column set and never coerces null to zero",
  /views: read\.data\.metrics\.views/.test(captureCode) &&
    /likes: read\.data\.metrics\.likes/.test(captureCode) &&
    /comments: read\.data\.metrics\.comments/.test(captureCode) &&
    /shares: read\.data\.metrics\.shares/.test(captureCode) &&
    /saves: read\.data\.metrics\.saves/.test(captureCode) &&
    !/\?\?\s*0/.test(captureCode),
);
check("9.12 no usage_ledger write in the new path", !captureSrc.includes("usage_ledger"));
check(
  "9.13 no update, upsert or delete anywhere in the new path",
  !/\.update\(/.test(captureCode) &&
    !/\.upsert\(/.test(captureCode) &&
    !/\.delete\(/.test(captureCode),
);
check(
  "9.14 no retry, no polling and no timers in the new path",
  !/for \(|while \(/.test(captureCode) &&
    !captureCode.includes("setInterval") &&
    !captureCode.includes("setTimeout") &&
    !captureCode.includes("refetchInterval"),
);
check(
  "9.15 the capture path never calls Telegram",
  !captureSrc.includes("api.telegram.org") &&
    !captureCode.includes("sendMessage") &&
    !captureCode.includes("editMessageText") &&
    !captureCode.includes("sendPhoto") &&
    !captureCode.includes("social-mission-telegram"),
);
check(
  "9.16 the admin client is imported inside the handler, after authorization",
  captureCode.includes('await import("@/integrations/supabase/client.server")') &&
    !/^import .*client\.server/m.test(captureCode),
);

// Client side of SE-3.2A

check(
  "9.17 the control calls the capture server function through useServerFn",
  controlCode.includes('import { useServerFn } from "@tanstack/react-start"') &&
    controlCode.includes("useServerFn(captureMissionMetrics)") &&
    (controlCode.match(/runCapture\(\)/g) ?? []).length === 1,
);
check(
  "9.18 the browser passes no social inputs to the capture call",
  /const captured = await runCapture\(\);/.test(controlCode),
);
check(
  "9.19 the edit uses only server-returned identifiers and the server-returned revision",
  /workspaceId: captured\.workspaceId/.test(controlCode) &&
    /missionId: captured\.missionId/.test(controlCode) &&
    /targetId: captured\.targetId/.test(controlCode) &&
    /revision: captured\.editRevision \+ 1/.test(controlCode),
);
check(
  "9.20 a failed capture blocks the edit",
  /if \(!captured\.ok\) \{[\s\S]{0,160}return;/.test(controlCode) &&
    controlCode.indexOf("if (!captured.ok)") < controlCode.indexOf("editMissionCard("),
);
check(
  "9.21 the update is gated on SENT with a confirmed Telegram message id",
  controlCode.includes('const REQUIRED_UPDATE_DELIVERY_STATE = "SENT"') &&
    controlCode.includes("fixture.deliveryState === REQUIRED_UPDATE_DELIVERY_STATE") &&
    controlCode.includes("fixture.telegramMessageId !== null") &&
    controlCode.includes("allUpdateGatesPass = updateGates.length > 0 && updateGates.every((g) => g.ok)"),
);
check(
  "9.22 the update runs at most once per session and is disabled while in flight",
  /const canUpdate = !!fixture && allUpdateGatesPass && !updating && !updateAttempted/.test(
    controlCode,
  ) &&
    /if \(!fixture \|\| !allUpdateGatesPass \|\| updating \|\| updateAttempted\) return;/.test(
      controlCode,
    ) &&
    controlCode.includes("setUpdateAttempted(true)") &&
    controlCode.includes("disabled={!canUpdate}"),
);
check(
  "9.23 the update runs only from its own confirmation dialog action",
  /AlertDialogAction onClick=\{confirmedUpdate\}/.test(controlCode) &&
    /onClick=\{\(\) => setUpdateConfirmOpen\(true\)\}/.test(controlCode),
);
check(
  "9.24 the update confirmation states in-place edit, no replacement and no retry",
  controlSrc.includes("edits " + "\n" === "never" ? false : true) &&
    /in place/.test(controlSrc) &&
    /No replacement message is sent/.test(controlSrc) &&
    /there is\n  "is no automatic retry|is no automatic retry/.test(controlSrc),
);
check(
  "9.25 the send path is unchanged: still PENDING-gated and still one send",
  controlCode.includes("fixture.deliveryState === REQUIRED_DELIVERY_STATE") &&
    controlCode.includes('const REQUIRED_DELIVERY_STATE = "PENDING"') &&
    (controlCode.match(/sendMissionCard\(/g) ?? []).length === 1,
);
check(
  "9.26 the control still performs no database write of its own",
  !/\.insert\(/.test(controlCode) &&
    !/\.update\(/.test(controlCode) &&
    !/\.upsert\(/.test(controlCode) &&
    !/\.delete\(/.test(controlCode) &&
    !controlCode.includes("social_metric_snapshots"),
);
check(
  "9.27 authoritative fixture state is refetched after the update attempt",
  /finally \{[\s\S]{0,200}setUpdating\(false\);[\s\S]{0,120}await query\.refetch\(\)/.test(
    controlCode,
  ),
);
console.log(`SE-3.1 regression: ${passed} passed, ${failures.length} failed`);
if (failures.length > 0) {
  for (const failure of failures) console.log(`  FAIL ${failure}`);
  process.exit(1);
}
