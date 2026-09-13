/**
 * SE-3.3L regression — source/static only.
 *
 * ZERO network, ZERO database, ZERO secrets, ZERO Telegram, ZERO X. Every
 * assertion is a static check over the owner-only BRANDED Social Mission
 * live-test control and its single render site in the Owner Console.
 *
 * Run: bun scripts/se33l-branded-social-mission-test-control-regression.ts
 */

import { readFileSync } from "node:fs";

let passed = 0;
const failures: string[] = [];

function check(name: string, condition: boolean): void {
  if (condition) passed += 1;
  else failures.push(name);
}

const CONTROL_PATH = "src/components/cartel/BrandedSocialMissionTestControl.tsx";
const LEGACY_CONTROL_PATH = "src/components/cartel/SocialMissionTestControl.tsx";
const ADMIN_PATH = "src/routes/_authenticated/admin.tsx";
const CLIENT_PATH = "src/lib/social-mission-telegram.ts";

const controlSrc = readFileSync(CONTROL_PATH, "utf8");
const legacySrc = readFileSync(LEGACY_CONTROL_PATH, "utf8");
const adminSrc = readFileSync(ADMIN_PATH, "utf8");
const clientSrc = readFileSync(CLIENT_PATH, "utf8");

function stripComments(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
}
const controlCode = stripComments(controlSrc);
const legacyCode = stripComments(legacySrc);

// ---------------------------------------------------------------------------
// 1. Hard-pinned fixture identity
// ---------------------------------------------------------------------------

check(
  "1.1 branded marker is the exact pinned value",
  controlCode.includes('const BRANDED_TEST_CONTROL_MARKER = "pepe_cartel_branded_v1"'),
);
check(
  "1.2 marker is used as a metadata containment filter on social_missions",
  /\.contains\("metadata",\s*\{\s*owner_test_control:\s*BRANDED_TEST_CONTROL_MARKER\s*\}\)/.test(
    controlCode,
  ),
);
check(
  "1.3 expected workspace id is hard-pinned",
  controlCode.includes(
    'const REQUIRED_WORKSPACE_ID = "311dfe4c-24f8-47b6-8af3-48b73e4dbfaa"',
  ),
);
check(
  "1.4 group title gate is the exact production group",
  controlCode.includes('const REQUIRED_GROUP_TITLE = "PEPE CARTEL COMMUNITY"'),
);
check(
  "1.5 canonical URL gate is the exact pinned X post",
  controlCode.includes(
    'const REQUIRED_CANONICAL_URL = "https://x.com/PEPECARTELTOKEN/status/2098827349470961903"',
  ),
);
check(
  "1.6 mission status gate is LIVE",
  controlCode.includes('const REQUIRED_MISSION_STATUS = "LIVE"'),
);
check(
  "1.7 delivery state gate is PENDING",
  controlCode.includes('const REQUIRED_DELIVERY_STATE = "PENDING"'),
);

// ---------------------------------------------------------------------------
// 2. Gate enforcement
// ---------------------------------------------------------------------------

check(
  "2.1 workspace equality is gated",
  controlCode.includes("fixture.workspaceId === REQUIRED_WORKSPACE_ID"),
);
check(
  "2.2 mission status equality is gated",
  controlCode.includes("fixture.missionStatus === REQUIRED_MISSION_STATUS"),
);
check(
  "2.3 delivery state equality is gated",
  controlCode.includes("fixture.deliveryState === REQUIRED_DELIVERY_STATE"),
);
check(
  "2.4 group connection binding is gated",
  controlCode.includes("ok: !!fixture.groupConnectionId"),
);
check(
  "2.5 group title equality is gated",
  controlCode.includes("fixture.groupTitle === REQUIRED_GROUP_TITLE"),
);
check(
  "2.6 canonical URL equality is gated",
  controlCode.includes("fixture.canonicalUrl === REQUIRED_CANONICAL_URL"),
);
check(
  "2.7 a null Telegram message id before send is gated",
  controlCode.includes("fixture.telegramMessageId === null"),
);
check(
  "2.8 exactly one fixture row must be proven for mission and target",
  controlCode.includes("missionRows.length > 1") &&
    controlCode.includes("missionRows.length === 0") &&
    controlCode.includes("targetRows.length > 1") &&
    controlCode.includes("targetRows.length === 0"),
);
check(
  "2.9 send is enabled only when every gate passes",
  controlCode.includes("const allGatesPass = gates.length > 0 && gates.every((g) => g.ok)") &&
    controlCode.includes("const canSend = !!fixture && allGatesPass && !sending && !attempted"),
);
check("2.10 the CTA is disabled unless armed", controlCode.includes("disabled={!canSend}"));

// ---------------------------------------------------------------------------
// 3. Exactly one send path, one session attempt
// ---------------------------------------------------------------------------

check(
  "3.1 exactly one sendMissionCard call site",
  (controlCode.match(/sendMissionCard\(/g) ?? []).length === 1,
);
check(
  "3.2 the send is made only from the confirmation dialog action",
  /AlertDialogAction onClick=\{confirmedSend\}/.test(controlCode) &&
    /onClick=\{\(\) => setConfirmOpen\(true\)\}/.test(controlCode),
);
check(
  "3.3 the confirmed handler re-checks every gate before sending",
  /if \(!fixture \|\| !allGatesPass \|\| sending \|\| attempted\) return;/.test(controlCode),
);
check(
  "3.4 one attempt per session is latched before the call",
  /setAttempted\(true\);[\s\S]{0,120}try \{/.test(controlCode),
);
check("3.5 no edit path exists in this control", !controlCode.includes("editMissionCard"));
check(
  "3.6 no retry/resend affordance",
  !/retry\(/i.test(controlCode) && !/setAttempted\(false\)/.test(controlCode),
);
check(
  "3.7 no timers or polling",
  !controlCode.includes("setInterval") &&
    !controlCode.includes("setTimeout") &&
    !controlCode.includes("refetchInterval") &&
    !controlCode.includes("useEffect"),
);
check(
  "3.8 one client-generated request id inside the confirmed handler",
  (controlCode.match(/crypto\.randomUUID\(\)/g) ?? []).length === 1,
);

// ---------------------------------------------------------------------------
// 4. No arbitrary input, no generic selector, no forged transport parameters
// ---------------------------------------------------------------------------

check(
  "4.1 no free-text or form inputs",
  !/<input/i.test(controlCode) &&
    !/<textarea/i.test(controlCode) &&
    !/<select/i.test(controlCode) &&
    !controlCode.includes("Input") &&
    !controlCode.includes("Textarea"),
);
check(
  "4.2 no generic fixture selector state",
  !/onValueChange/.test(controlCode) && !/\bSelect\b/.test(controlCode),
);
check(
  "4.3 the browser submits only the authoritative ids and one request id",
  /sendMissionCard\(\{\s*workspaceId: fixture\.workspaceId,\s*missionId: fixture\.missionId,\s*targetId: fixture\.targetId,\s*clientRequestId: crypto\.randomUUID\(\),\s*\}\)/.test(
    controlCode,
  ),
);
check(
  "4.4 the control never submits chat id, caption, transport kind or logo reference",
  !/chatId|chat_id|caption|logoAssetId|logo_asset_id|transport_kind:|assetPath|asset_id/.test(controlCode),
);
check(
  "4.5 no direct Telegram API call and no bot token",
  !controlCode.includes("api.telegram.org") &&
    !controlCode.includes("sendPhoto") &&
    !controlCode.includes("sendMessage") &&
    !/BOT_TOKEN/i.test(controlCode),
);
check(
  "4.6 no direct edge function invoke and no rpc from the control",
  !controlCode.includes("functions.invoke") && !controlCode.includes(".rpc("),
);
check(
  "4.7 no service role key usage",
  !/service_role|SERVICE_ROLE/.test(controlCode),
);
check(
  "4.8 the control performs no database write of its own",
  !/\.insert\(/.test(controlCode) &&
    !/\.update\(/.test(controlCode) &&
    !/\.upsert\(/.test(controlCode) &&
    !/\.delete\(/.test(controlCode),
);
check(
  "4.9 no X / social provider call from the browser",
  !controlCode.includes("api.twitter.com") &&
    !controlCode.includes("api.x.com") &&
    !controlCode.includes("captureMissionMetrics"),
);

// ---------------------------------------------------------------------------
// 5. Confirmation wording and honest reporting
// ---------------------------------------------------------------------------

check(
  "5.1 CTA label is exactly the required label",
  controlSrc.includes('const SEND_LABEL = "Send branded test card"'),
);
check(
  "5.2 confirmation states ONE new branded message into the exact group",
  controlSrc.includes("ONE new branded Social Mission message into") &&
    controlSrc.includes("${REQUIRED_GROUP_TITLE}"),
);
check(
  "5.3 confirmation states it will not resend automatically",
  controlSrc.includes("will not resend automatically"),
);
check(
  "5.4 the one-time branded transport note is present",
  controlSrc.includes("one-time branded transport test") &&
    controlSrc.includes("Project Profile logo") &&
    controlSrc.includes("No logo is uploaded"),
);
check(
  "5.5 authoritative state after the attempt shows delivery state, message id and transport kind",
  controlCode.includes("Transport kind: ${fixture.transportKind}") &&
    controlCode.includes("fixture.telegramMessageId ?? \"—\"") &&
    controlCode.includes("{fixture.deliveryState}"),
);
check(
  "5.6 SENT + PHOTO is the only branded pass signal",
  controlCode.includes(
    'const brandedProven = fixture?.deliveryState === "SENT" && fixture?.transportKind === "PHOTO"',
  ),
);
check(
  "5.7 SENT without PHOTO is reported honestly as a fallback, not a pass",
  controlCode.includes(
    'const textFallback = fixture?.deliveryState === "SENT" && fixture?.transportKind !== "PHOTO"',
  ) && controlSrc.includes("branded photo path is NOT proven"),
);
check(
  "5.8 authoritative fixture state is refetched after the attempt",
  /finally \{[\s\S]{0,160}setSending\(false\);[\s\S]{0,120}await query\.refetch\(\)/.test(
    controlCode,
  ),
);

// ---------------------------------------------------------------------------
// 6. Mount site and untouched legacy control
// ---------------------------------------------------------------------------

check(
  "6.1 the Owner Console references the branded control only as one import and one render",
  (adminSrc.match(/BrandedSocialMissionTestControl/g) ?? []).length === 3,
);
check(
  "6.2 the branded control is rendered in the Owner Console",
  adminSrc.includes("<BrandedSocialMissionTestControl />"),
);
check(
  "6.3 the existing text test control is still mounted",
  adminSrc.includes("<SocialMissionTestControl />"),
);
check(
  "6.4 the legacy control still pins its own separate marker",
  legacyCode.includes('const OWNER_TEST_CONTROL_MARKER = "pepe_cartel_community_v1"'),
);
check(
  "6.5 the legacy control still allows exactly one send and no resend",
  (legacyCode.match(/sendMissionCard\(/g) ?? []).length === 1 &&
    legacyCode.includes("!attempted") &&
    !legacyCode.includes("setAttempted(false)"),
);
check(
  "6.6 the branded control does not reuse the legacy marker",
  !controlCode.includes("pepe_cartel_community_v1"),
);

// ---------------------------------------------------------------------------
// 7. Transport client unchanged and server-owned
// ---------------------------------------------------------------------------

check(
  "7.1 sendMissionCard still posts the send_mission action only",
  clientSrc.includes('action: "send_mission"'),
);
check(
  "7.2 the transport client accepts no caption, chat or media parameters",
  !/caption|chatId|photo|logo/i.test(clientSrc),
);
check(
  "7.3 the control imports the transport only from the existing thin client",
  controlCode.includes('from "@/lib/social-mission-telegram"'),
);

console.log(`SE-3.3L regression: ${passed} passed, ${failures.length} failed`);
if (failures.length > 0) {
  for (const failure of failures) console.log(`  FAIL ${failure}`);
  process.exit(1);
}
