/**
 * Launcher-B2 regression — pure frontend/state coverage only.
 *
 * Nothing here touches Supabase, the network, wallets, Telegram or the chain.
 * It pins the client-side contract: status mapping, eligibility hints, journey
 * behaviour across the request lifecycle, exact BigInt supply parsing, manual
 * recipient confirmation and INTERNAL_TEST exclusion.
 *
 * Run: bunx tsx scripts/launcher-b-handoff-regression.ts  (or `bun run`)
 */
import {
  canWithdrawProductionRequest,
  evaluateProductionRequestEligibility,
  groupDigits,
  isClosedProductionRequest,
  isCompletedProductionRequest,
  isOpenProductionRequest,
  isValidRecipientAddress,
  parseWholeSupply,
  productionRequestCopy,
  sameAddress,
  toBaseUnits,
  toProductionDeploymentRequest,
  type ProductionDeploymentRequest,
  type ProductionRequestEligibilityHints,
} from "../src/lib/launch-production-request";
import {
  computeProjectJourney,
  type JourneyInput,
  type JourneyStage,
} from "../src/lib/project-journey";
import { previewOnChainSymbol } from "../src/components/cartel/ProductionDeploymentRequestPanel";

let passed = 0;
const failures: string[] = [];

function check(name: string, condition: boolean) {
  if (condition) {
    passed += 1;
  } else {
    failures.push(name);
  }
}

function eq<T>(name: string, actual: T, expected: T) {
  check(`${name} (got ${String(actual)}, expected ${String(expected)})`, actual === expected);
}

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

function makeRequest(
  overrides: Partial<ProductionDeploymentRequest> = {},
): ProductionDeploymentRequest {
  return {
    ...toProductionDeploymentRequest({
      id: "req-1",
      workspace_id: "ws-1",
      project_profile_id: "pp-1",
      launch_id: "lc-1",
      status: "REQUESTED",
      effective_status: "REQUESTED",
      chain_id: 4663,
      network_environment: "PRODUCTION",
      declared_chain: "robinhood",
      token_name: "PEPECARTEL",
      token_symbol: "PEPE",
      token_decimals: 18,
      token_supply_whole: "1000000000",
      token_total_supply_base_units: "1000000000000000000000000000",
      token_recipient: "0x1111111111111111111111111111111111111111",
      requested_by: "user-1",
      requested_at: "2026-01-01T00:00:00Z",
      assigned_operator_id: null,
      decision_note: null,
      execution_deployment_id: null,
      status_changed_at: "2026-01-01T00:00:00Z",
      updated_at: "2026-01-01T00:00:00Z",
    }),
    ...overrides,
  };
}

const eligibleHints: ProductionRequestEligibilityHints = {
  isProjectLaunch: true,
  profilePublished: true,
  scheduleSet: true,
  launchStatus: "WATCHLIST_OPEN",
  registrationRecorded: false,
  hasProductionDeploymentEvidence: false,
};

function readinessFixture(published: boolean) {
  const keys = [
    "project_profile",
    "profile_published",
    "launch_created",
    "launch_announced",
    "launch_watch_open",
    "telegram_community",
    "launch_welcome",
  ];
  return {
    steps: keys.map((key) => ({
      key,
      title: key,
      description: "",
      complete: key === "profile_published" ? published : true,
      detail: null,
    })),
    completedCount: keys.length,
    totalCount: keys.length,
    allComplete: true,
    nextStep: null,
    projectName: "PEPECARTEL",
    projectProfileId: "pp-1",
    primaryLaunchId: "lc-1",
    primaryLaunchName: "PEPECARTEL",
  } as unknown as JourneyInput["readiness"];
}

function journeyInput(overrides: Partial<JourneyInput> = {}): JourneyInput {
  return {
    readiness: readinessFixture(true),
    launch: {
      id: "lc-1",
      status: "WATCHLIST_OPEN",
      scheduleSet: true,
      officialContractAddress: null,
      officialContractDeploymentId: null,
      contractRegisteredAt: null,
    },
    activeWatchers: 4,
    watchUnavailable: false,
    deploymentEvidence: {
      productionDeploymentCount: 0,
      verifiedProductionCount: 0,
      managedFinalizedVerifiedCount: 0,
      deploymentAmbiguous: false,
      registrationEligibleCount: 0,
      registrationAmbiguous: false,
    },
    deploymentUnavailable: false,
    productionRequest: null,
    productionRequestUnavailable: false,
    brandKit: { brandName: "PEPECARTEL" },
    brandKitUnavailable: false,
    creativeAssets: { brandAssetCount: 2, generatedStickerCount: 0, otherAssetCount: 0 },
    creativeAssetsUnavailable: false,
    stickerPacks: { activeCount: 1, publishedCount: 1 },
    stickerPacksUnavailable: false,
    inbox: { repliesEnabled: true, newConversationsEnabled: true, waitingOnTeamCount: 0 },
    inboxUnavailable: false,
    ...overrides,
  };
}

function deploymentStage(input: JourneyInput): JourneyStage {
  const stage = computeProjectJourney(input).stages.find((s) => s.key === "deployment");
  if (!stage) throw new Error("deployment stage missing");
  return stage;
}

// ---------------------------------------------------------------------------
// 1. Exact supply parsing (BigInt only)
// ---------------------------------------------------------------------------

check("supply: empty is rejected", parseWholeSupply("").ok === false);
check("supply: decimals rejected", parseWholeSupply("100.5").ok === false);
check("supply: commas rejected", parseWholeSupply("1,000").ok === false);
check("supply: leading zero rejected", parseWholeSupply("0100").ok === false);
check("supply: zero rejected", parseWholeSupply("0").ok === false);
check("supply: negative rejected", parseWholeSupply("-5").ok === false);
check("supply: min accepted", parseWholeSupply("1").ok === true);
check("supply: max accepted", parseWholeSupply("1000000000000").ok === true);
check("supply: above max rejected", parseWholeSupply("1000000000001").ok === false);

const parsed = parseWholeSupply(" 1000000000 ");
check("supply: trims whitespace", parsed.ok === true);
if (parsed.ok) {
  eq("supply: exact whole value", parsed.whole.toString(), "1000000000");
  eq(
    "supply: exact base units at 18 decimals",
    parsed.baseUnits.toString(),
    "1000000000000000000000000000",
  );
}

const huge = parseWholeSupply("999999999999");
check("supply: large value keeps every digit", huge.ok === true);
if (huge.ok) {
  eq(
    "supply: large value base units are exact (no float loss)",
    huge.baseUnits.toString(),
    "999999999999000000000000000000",
  );
  eq(
    "supply: toBaseUnits agrees",
    toBaseUnits(huge.whole).toString(),
    huge.baseUnits.toString(),
  );
}

eq("digits: grouping", groupDigits("1000000000"), "1,000,000,000");

// ---------------------------------------------------------------------------
// 2. Recipient validation + manual confirmation
// ---------------------------------------------------------------------------

check(
  "recipient: valid address accepted",
  isValidRecipientAddress("0x1111111111111111111111111111111111111111"),
);
check("recipient: short address rejected", !isValidRecipientAddress("0x1111"));
check("recipient: missing prefix rejected", !isValidRecipientAddress("1".repeat(40)));
check(
  "recipient: zero address rejected",
  !isValidRecipientAddress("0x0000000000000000000000000000000000000000"),
);
check(
  "recipient: confirmation matches case-insensitively",
  sameAddress("0xAbC1111111111111111111111111111111111111", "0xabc1111111111111111111111111111111111111"),
);
check(
  "recipient: different confirmation rejected",
  !sameAddress(
    "0x1111111111111111111111111111111111111111",
    "0x2222222222222222222222222222222222222222",
  ),
);
check("recipient: empty confirmation rejected", !sameAddress("0x11", ""));

// ---------------------------------------------------------------------------
// 3. Symbol preview mirrors the server derivation
// ---------------------------------------------------------------------------

eq("symbol: plain ticker", previewOnChainSymbol("PEPE"), "PEPE");
eq("symbol: dollar-prefixed ticker", previewOnChainSymbol("$PEPE"), "PEPE");
eq("symbol: lowercase ticker unusable", previewOnChainSymbol("pepe"), null);
eq("symbol: too long unusable", previewOnChainSymbol("ABCDEFGHIJKL"), null);

// ---------------------------------------------------------------------------
// 4. Status mapping
// ---------------------------------------------------------------------------

for (const status of ["REQUESTED", "IN_REVIEW", "APPROVED", "EXECUTING"] as const) {
  const r = makeRequest({ status, effectiveStatus: status });
  check(`status: ${status} is open`, isOpenProductionRequest(r));
  check(`status: ${status} is not closed`, !isClosedProductionRequest(r));
  check(`status: ${status} is not completed`, !isCompletedProductionRequest(r));
  const copy = productionRequestCopy(status);
  check(`copy: ${status} never promises timing`, !/hour|day|minute|soon|shortly/i.test(copy.detail));
  check(`copy: ${status} has no percentage`, !/%/.test(copy.detail));
}

for (const status of ["DECLINED", "WITHDRAWN"] as const) {
  const r = makeRequest({ status, effectiveStatus: status });
  check(`status: ${status} is closed`, isClosedProductionRequest(r));
  check(`status: ${status} is not open`, !isOpenProductionRequest(r));
}

const completed = makeRequest({ status: "EXECUTING", effectiveStatus: "COMPLETED" });
check("status: COMPLETED is completed", isCompletedProductionRequest(completed));
check("status: COMPLETED is not open", !isOpenProductionRequest(completed));
check("status: COMPLETED cannot be withdrawn", !canWithdrawProductionRequest(completed));

check("withdraw: REQUESTED allowed", canWithdrawProductionRequest(makeRequest()));
check(
  "withdraw: IN_REVIEW allowed",
  canWithdrawProductionRequest(makeRequest({ status: "IN_REVIEW", effectiveStatus: "IN_REVIEW" })),
);
check(
  "withdraw: APPROVED allowed",
  canWithdrawProductionRequest(makeRequest({ status: "APPROVED", effectiveStatus: "APPROVED" })),
);
check(
  "withdraw: EXECUTING refused",
  !canWithdrawProductionRequest(makeRequest({ status: "EXECUTING", effectiveStatus: "EXECUTING" })),
);
check(
  "withdraw: execution-bound request refused",
  !canWithdrawProductionRequest(makeRequest({ executionDeploymentId: "dep-1" })),
);
check("withdraw: no request refused", !canWithdrawProductionRequest(null));

// ---------------------------------------------------------------------------
// 5. Eligibility hints
// ---------------------------------------------------------------------------

check("eligibility: fully eligible", evaluateProductionRequestEligibility(eligibleHints).eligible);
check(
  "eligibility: INTERNAL_TEST excluded",
  !evaluateProductionRequestEligibility({ ...eligibleHints, isProjectLaunch: false }).eligible,
);
check(
  "eligibility: unpublished profile blocked",
  !evaluateProductionRequestEligibility({ ...eligibleHints, profilePublished: false }).eligible,
);
check(
  "eligibility: missing schedule blocked",
  !evaluateProductionRequestEligibility({ ...eligibleHints, scheduleSet: false }).eligible,
);
check(
  "eligibility: DRAFT lifecycle blocked",
  !evaluateProductionRequestEligibility({ ...eligibleHints, launchStatus: "DRAFT" }).eligible,
);
check(
  "eligibility: ANNOUNCED lifecycle blocked",
  !evaluateProductionRequestEligibility({ ...eligibleHints, launchStatus: "ANNOUNCED" }).eligible,
);
check(
  "eligibility: LIVE lifecycle blocked",
  !evaluateProductionRequestEligibility({ ...eligibleHints, launchStatus: "LIVE" }).eligible,
);
for (const status of ["WATCHLIST_OPEN", "LAUNCH_APPROACHING", "CONTRACT_PENDING"]) {
  check(
    `eligibility: ${status} allowed`,
    evaluateProductionRequestEligibility({ ...eligibleHints, launchStatus: status }).eligible,
  );
}
check(
  "eligibility: registered contract blocked",
  !evaluateProductionRequestEligibility({ ...eligibleHints, registrationRecorded: true }).eligible,
);
check(
  "eligibility: existing production deployment blocked",
  !evaluateProductionRequestEligibility({
    ...eligibleHints,
    hasProductionDeploymentEvidence: true,
  }).eligible,
);

// ---------------------------------------------------------------------------
// 6. Journey behaviour across the lifecycle
// ---------------------------------------------------------------------------

const noRequest = deploymentStage(journeyInput());
eq("journey: no request → action", noRequest.status, "action");
check("journey: no request → actionable", noRequest.actionable);
eq(
  "journey: action label",
  noRequest.actionLabel,
  "Request production deployment",
);
eq("journey: action deep-links to Launch Control", noRequest.to, "/launch-control");

for (const status of ["REQUESTED", "IN_REVIEW", "APPROVED", "EXECUTING"] as const) {
  const stage = deploymentStage(
    journeyInput({ productionRequest: { status, effectiveStatus: status } }),
  );
  eq(`journey: ${status} → waiting`, stage.status, "waiting");
  check(`journey: ${status} is not actionable (no duplicate submit)`, !stage.actionable);
  check(`journey: ${status} states a truthful detail`, typeof stage.detail === "string");
}

const completedStage = deploymentStage(
  journeyInput({ productionRequest: { status: "EXECUTING", effectiveStatus: "COMPLETED" } }),
);
eq("journey: effective COMPLETED → complete", completedStage.status, "complete");
check("journey: completed is not actionable", !completedStage.actionable);

for (const status of ["DECLINED", "WITHDRAWN"] as const) {
  const stage = deploymentStage(
    journeyInput({ productionRequest: { status, effectiveStatus: status } }),
  );
  eq(`journey: ${status} → action again`, stage.status, "action");
  check(`journey: ${status} is actionable again`, stage.actionable);
}

const evidenceComplete = deploymentStage(
  journeyInput({
    deploymentEvidence: {
      productionDeploymentCount: 1,
      verifiedProductionCount: 1,
      managedFinalizedVerifiedCount: 1,
      deploymentAmbiguous: false,
      registrationEligibleCount: 1,
      registrationAmbiguous: false,
    },
  }),
);
eq("journey: verified evidence alone → complete", evidenceComplete.status, "complete");
check("journey: verified evidence is not actionable", !evidenceComplete.actionable);

const evidenceInProgress = deploymentStage(
  journeyInput({
    deploymentEvidence: {
      productionDeploymentCount: 1,
      verifiedProductionCount: 0,
      managedFinalizedVerifiedCount: 0,
      deploymentAmbiguous: false,
      registrationEligibleCount: 0,
      registrationAmbiguous: false,
    },
  }),
);
check(
  "journey: existing production evidence blocks a duplicate request action",
  !evidenceInProgress.actionable,
);

check(
  "journey: unpublished profile is not actionable",
  !deploymentStage(journeyInput({ readiness: readinessFixture(false) })).actionable,
);
check(
  "journey: DRAFT lifecycle is not actionable",
  !deploymentStage(
    journeyInput({
      launch: {
        id: "lc-1",
        status: "DRAFT",
        scheduleSet: true,
        officialContractAddress: null,
        officialContractDeploymentId: null,
        contractRegisteredAt: null,
      },
    }),
  ).actionable,
);
check(
  "journey: missing schedule is not actionable",
  !deploymentStage(
    journeyInput({
      launch: {
        id: "lc-1",
        status: "WATCHLIST_OPEN",
        scheduleSet: false,
        officialContractAddress: null,
        officialContractDeploymentId: null,
        contractRegisteredAt: null,
      },
    }),
  ).actionable,
);
check(
  "journey: no launch is not actionable",
  !deploymentStage(journeyInput({ launch: null, deploymentEvidence: null })).actionable,
);
check(
  "journey: unreadable request state is not actionable",
  !deploymentStage(journeyInput({ productionRequestUnavailable: true })).actionable,
);

// ---------------------------------------------------------------------------

if (failures.length > 0) {
  console.error(`FAILED ${failures.length} check(s):`);
  for (const f of failures) console.error(`  - ${f}`);
  process.exit(1);
}
console.log(`Launcher-B handoff regression: ${passed} checks passed.`);
