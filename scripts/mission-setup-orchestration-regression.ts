/**
 * Focused Mission Setup production-helper regressions. No network or DB writes.
 * Run: bun scripts/mission-setup-orchestration-regression.ts
 */
import {
  continueSetupDelivery,
  normalizeSetupDeliveryState,
  setupDeliveryMaySend,
  setupPermissionProofAllowsStart,
  setupRecoveryAction,
} from "../src/lib/mission-setup-orchestration";
import { setupSuggestionTargets, setupTargets } from "../src/lib/telegram-miniapp-bridge.functions";

let pass = 0;
let fail = 0;
function check(name: string, ok: boolean) {
  if (ok) pass += 1;
  else fail += 1;
  console.log(`${ok ? "PASS" : "FAIL"} ${name}`);
}

check("partial reviewed targets omit absent keys without nulls", JSON.stringify(setupTargets({ likes: 12, replies: null, reposts: undefined, bookmarks: "" })) === '{"likes":12}');
check("invalid partial target fails closed", setupTargets({ likes: 12.5 }) === null);
check("auto-select omits unavailable metrics rather than inventing zero", JSON.stringify(setupSuggestionTargets({ likes: 20, replies: null, reposts: 0, bookmarks: undefined })) === '{"likes":20}');

const base = { resolved: true, isAdmin: true, canDelete: true, canPin: true };
check("missing required pin right blocks before mutation", !setupPermissionProofAllowsStart({ ...base, canPin: false }, { sourceCleanupRequired: true, autoPinMission: true }));
check("pin-disabled mission is not blocked by missing pin right", setupPermissionProofAllowsStart({ ...base, canPin: false }, { sourceCleanupRequired: true, autoPinMission: false }));
check("command cleanup disabled is not blocked by missing delete right", setupPermissionProofAllowsStart({ ...base, canDelete: false }, { sourceCleanupRequired: false, autoPinMission: false }));
check("NULL-equivalent unresolved proof fails closed", !setupPermissionProofAllowsStart({ ...base, resolved: false }, { sourceCleanupRequired: false, autoPinMission: false }));

for (const state of ["PENDING", "FAILED", "SENT"] as const) {
  check(`STARTING ${state} exposes committed-config continuation`, setupRecoveryAction("STARTING", state) === "continue");
}
for (const state of ["SENDING", "AMBIGUOUS", "UNKNOWN"] as const) {
  check(`STARTING ${state} exposes refresh only`, setupRecoveryAction("STARTING", state) === "refresh");
}
check("READY exposes first start", setupRecoveryAction("READY", "PENDING") === "start");
check("STARTED exposes no start action", setupRecoveryAction("STARTED", "SENT") === "complete");
check("only durable PENDING/FAILED delivery may invoke sender", setupDeliveryMaySend(normalizeSetupDeliveryState("PENDING")) && setupDeliveryMaySend(normalizeSetupDeliveryState("FAILED")) && !setupDeliveryMaySend(normalizeSetupDeliveryState("SENDING")) && !setupDeliveryMaySend(normalizeSetupDeliveryState("AMBIGUOUS")) && !setupDeliveryMaySend(normalizeSetupDeliveryState("SENT")));

let sends = 0;
const sender = async () => { sends += 1; return "sent" as const; };
const ambiguous = await continueSetupDelivery("AMBIGUOUS", sender);
const sending = await continueSetupDelivery("SENDING", sender);
const sent = await continueSetupDelivery("SENT", sender);
check("ambiguous/sending/sent retries perform zero sends", sends === 0 && !ambiguous.sent && ambiguous.reason === "ambiguous" && !sending.sent && sending.reason === "ambiguous" && !sent.sent && sent.reason === "already_sent");
const failed = await continueSetupDelivery("FAILED", sender);
check("durable FAILED recovery performs exactly one existing transport call", sends === 1 && failed.sent && failed.result === "sent");

console.log(`\n${pass}/${pass + fail} passed`);
if (fail > 0) process.exit(1);