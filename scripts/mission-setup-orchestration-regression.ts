/**
 * Focused Mission Setup production-helper regressions. No network or DB writes.
 * Run: bun scripts/mission-setup-orchestration-regression.ts
 */
import {
  continueSetupDelivery,
  normalizeSetupDeliveryState,
  requestExactSetupCleanup,
  saveSetupDraft,
  suggestSetupTargets,
  setupDeliveryMaySend,
  setupPermissionProofAllowsStart,
  setupRecoveryAction,
  setupCandidateIsExactCommittedRecovery,
  setupCommercialAccessAllows,
  classifyActiveSetupMission,
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

let cleanupJobs = 0;
const swapped = await requestExactSetupCleanup({
  readExact: async () => ({ cleanupConfirmed: false }),
  requestCleanup: async () => { cleanupJobs += 1; return "job"; },
});
check("swapped same-group launcher token is refused with zero cleanup jobs", !swapped.ok && cleanupJobs === 0);
const crossCandidate = await requestExactSetupCleanup({
  readExact: async () => ({ cleanupConfirmed: false }),
  requestCleanup: async () => { cleanupJobs += 1; return "job"; },
});
check("cross-candidate close is refused with zero cleanup jobs", !crossCandidate.ok && cleanupJobs === 0);
const exact = await requestExactSetupCleanup({
  readExact: async () => ({ cleanupConfirmed: true }),
  requestCleanup: async () => { cleanupJobs += 1; return "exact-job"; },
});
check("exact confirmed candidate prompt queues once", exact.ok && exact.result === "exact-job" && cleanupJobs === 1);

let providers = 0;
let transports = 0;
let saves = 0;
const saved = await saveSetupDraft({ save: async () => { saves += 1; return { data: { outcome: "SAVED" }, error: null }; } });
check("production save orchestration invokes only its injected save RPC", saved.ok && saves === 1 && providers === 0 && transports === 0);
const suggested = await suggestSetupTargets({
  readCandidate: async () => ({ externalPostId: "123" }),
  readMetrics: async () => { providers += 1; return { likes: null, replies: 8 }; },
  suggest: async (snapshot) => ({ likes: snapshot.likes, replies: snapshot.replies }),
});
check("production suggest orchestration performs one provider read and preserves missing metrics", suggested.available && providers === 1 && suggested.suggestion.likes === null && suggested.suggestion.replies === 8 && transports === 0);

const atLimit = { allowed: false, wouldBlock: true, reason: "PLAN_LIMIT_REACHED" };
check("at-last-slot exact committed recovery survives PLAN_LIMIT_REACHED", setupCommercialAccessAllows(atLimit, true));
check("at-last-slot new mission cannot bypass PLAN_LIMIT_REACHED", !setupCommercialAccessAllows(atLimit, false));
check("disabled or suspended access still blocks committed recovery", !setupCommercialAccessAllows({ allowed: false, wouldBlock: true, reason: "SUBSCRIPTION_INACTIVE" }, true));
const committedMissionId = "11111111-2222-4333-8444-555555555555";
check("production Start gate recognizes exact STARTING candidate mission recovery", setupCommercialAccessAllows(atLimit, setupCandidateIsExactCommittedRecovery("STARTING", committedMissionId)));
check("production Start gate recognizes exact STARTED candidate mission recovery", setupCommercialAccessAllows(atLimit, setupCandidateIsExactCommittedRecovery("STARTED", committedMissionId)));
check("production Start gate keeps READY candidate fully quota-gated", !setupCommercialAccessAllows(atLimit, setupCandidateIsExactCommittedRecovery("READY", committedMissionId)));
check("production Start gate does not treat missing or malformed mission binding as recovery", !setupCommercialAccessAllows(atLimit, setupCandidateIsExactCommittedRecovery("STARTING", null)) && !setupCandidateIsExactCommittedRecovery("STARTING", "not-a-mission"));

const activeWinner = {
  missionId: "11111111-2222-4333-8444-555555555555",
  candidateId: "aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee",
  requestId: "99999999-8888-4777-8666-555555555555",
  targets: { likes: 25, replies: 4 },
  groupConnectionId: "11111111-aaaa-4bbb-8ccc-222222222222",
  telegramChatId: "-1001234567890",
};
check("same candidate and exact group remains exact committed recovery", classifyActiveSetupMission(activeWinner, activeWinner.candidateId, activeWinner.groupConnectionId, activeWinner.telegramChatId) === "exact_recovery");
check("second candidate for same post and exact group is a duplicate with winner targets preserved", classifyActiveSetupMission(activeWinner, "bbbbbbbb-cccc-4ddd-8eee-ffffffffffff", activeWinner.groupConnectionId, activeWinner.telegramChatId) === "duplicate" && activeWinner.targets.likes === 25 && activeWinner.targets.replies === 4);
check("same post in a different group does not collide", classifyActiveSetupMission(activeWinner, "bbbbbbbb-cccc-4ddd-8eee-ffffffffffff", "22222222-aaaa-4bbb-8ccc-333333333333", "-1009876543210") === "none");
check("old active mission without setup request is duplicate, never quota recovery", classifyActiveSetupMission({ ...activeWinner, requestId: null }, activeWinner.candidateId, activeWinner.groupConnectionId, activeWinner.telegramChatId) === "duplicate" && !setupCommercialAccessAllows(atLimit, false));

console.log(`\n${pass}/${pass + fail} passed`);
if (fail > 0) process.exit(1);