/**
 * P1-A — PROJECT JOURNEY MODEL regression.
 *
 * PURE. No network, no database, no wallet, no provider, no transaction.
 * Exercises only the pure journey derivation plus repository source text.
 */
import { readFileSync } from "node:fs";
import {
  computeLaunchReadiness,
  selectPrimaryLaunch,
  type ReadinessInput,
} from "../src/lib/launch-readiness";
import {
  computeProjectJourney,
  deriveJourneyDeploymentEvidenceFacts,
  JOURNEY_STAGE_KEYS,
  type JourneyInput,
  type JourneyLaunchFacts,
  type JourneyStageKey,
} from "../src/lib/project-journey";
import {
  evaluateLaunchDeploymentEvidence,
  type DeploymentEvidenceInput,
  type LaunchEvidenceContext,
} from "../src/lib/launch-verified-eligibility";

const read = (p: string) => readFileSync(p, "utf8");

let failures = 0;
function check(id: string, ok: boolean, detail: string) {
  if (ok) console.log(`PASS ${id} — ${detail}`);
  else {
    failures += 1;
    console.error(`FAIL ${id} — ${detail}`);
  }
}

const emptyReadiness: ReadinessInput = {
  profile: null,
  launches: [],
  groups: [],
  settings: [],
};

const fullReadiness: ReadinessInput = {
  profile: { id: "p1", project_name: "PEPECARTEL", discovery_status: "published" },
  launches: [
    {
      id: "l1",
      token_name: "PEPECARTEL",
      status: "LIVE",
      announced_at: "2026-01-01T00:00:00Z",
      watchlist_opened_at: "2026-01-02T00:00:00Z",
      launch_watch_token: "a".repeat(24),
      created_at: "2026-01-01T00:00:00Z",
      updated_at: "2026-01-03T00:00:00Z",
    },
  ],
  groups: [{ id: "g1", bot_is_admin: true, metadata: null }],
  settings: [
    {
      group_connection_id: "g1",
      welcome_enabled: true,
      launch_watch_cta_enabled: true,
      launch_watch_launch_id: "l1",
    },
  ],
};

function journey(input: Partial<JourneyInput> & { readiness: JourneyInput["readiness"] }) {
  return computeProjectJourney({
    launch: null,
    activeWatchers: null,
    watchUnavailable: false,
    deploymentEvidence: null,
    deploymentUnavailable: false,
    brandKit: null,
    brandKitUnavailable: false,
    creativeAssets: null,
    creativeAssetsUnavailable: false,
    stickerPacks: null,
    stickerPacksUnavailable: false,
    inbox: null,
    inboxUnavailable: false,
    ...input,
  });
}

const launchFacts = (
  status: string,
  registration: "none" | "partial" | "complete" = "none",
): JourneyLaunchFacts => ({
  id: "l1",
  status,
  scheduleSet: true,
  officialContractAddress:
    registration === "none" ? null : `0x${"b".repeat(40)}`,
  officialContractDeploymentId:
    registration === "complete" ? "deployment-1" : null,
  contractRegisteredAt:
    registration === "complete" ? "2026-09-07T00:03:00.000Z" : null,
});

const noDeploymentEvidence = {
  productionDeploymentCount: 0,
  verifiedProductionCount: 0,
  managedFinalizedVerifiedCount: 0,
  deploymentAmbiguous: false,
  registrationEligibleCount: 0,
  registrationAmbiguous: false,
};

const finalizedDeploymentEvidence = {
  productionDeploymentCount: 1,
  verifiedProductionCount: 1,
  managedFinalizedVerifiedCount: 1,
  deploymentAmbiguous: false,
  registrationEligibleCount: 1,
  registrationAmbiguous: false,
};

/** P1-B — every Brand & Creative + Communications stage satisfied. */
const completeCreative = {
  brandKit: { brandName: "PROJECT" },
  brandKitUnavailable: false,
  creativeAssets: { brandAssetCount: 1, generatedStickerCount: 0, otherAssetCount: 0 },
  creativeAssetsUnavailable: false,
  stickerPacks: { activeCount: 1, publishedCount: 1 },
  stickerPacksUnavailable: false,
  inbox: { repliesEnabled: true, newConversationsEnabled: true, waitingOnTeamCount: 0 },
  inboxUnavailable: false,
} satisfies Partial<JourneyInput>;


const statusOf = (j: ReturnType<typeof journey>, key: JourneyStageKey) =>
  j.stages.find((s) => s.key === key)!.status;

// J1 — empty project: first action is creating the Project Profile.
{
  const j = journey({ readiness: computeLaunchReadiness(emptyReadiness) });
  check(
    "J1",
    j.nextAction.stage?.key === "project_profile" && j.nextAction.to === "/project-profile",
    `empty project next action is ${j.nextAction.stage?.key}`,
  );
  check("J1b", j.completedCount === 0, `completedCount=${j.completedCount}`);
  check("J1c", j.totalCount === JOURNEY_STAGE_KEYS.length, `totalCount=${j.totalCount}`);
}

// J2 — no launch: launch-scoped stages wait, they never claim completion.
{
  const j = journey({ readiness: computeLaunchReadiness(emptyReadiness) });
  const waiting: JourneyStageKey[] = [
    "launch_schedule",
    "deployment",
    "official_contract",
    "launch_live",
  ];
  check(
    "J2",
    waiting.every((k) => statusOf(j, k) === "waiting"),
    "launch-scoped stages wait without a launch",
  );
  check(
    "J2b",
    waiting.every((k) => j.stages.find((s) => s.key === k)!.actionable === false),
    "launch-scoped stages are not actionable without a launch",
  );
}

// J3 — missing schedule becomes the next action once the launch exists.
{
  const r = computeLaunchReadiness({
    ...fullReadiness,
    launches: [{ ...fullReadiness.launches[0]!, status: "ANNOUNCED" }],
  });
  const j = journey({
    readiness: r,
    launch: { ...launchFacts("ANNOUNCED"), scheduleSet: false },
    activeWatchers: 3,
    ...completeCreative,

  });
  check("J3", j.nextAction.stage?.key === "launch_schedule", `next=${j.nextAction.stage?.key}`);
}

// J4 — managed-finalized production evidence gates deployment and registration.
{
  const r = computeLaunchReadiness(fullReadiness);
  const without = journey({
    readiness: r,
    launch: launchFacts("CONTRACT_PENDING"),
    activeWatchers: 5,
    deploymentEvidence: noDeploymentEvidence,
  });
  const withProd = journey({
    readiness: r,
    launch: launchFacts("CONTRACT_PENDING"),
    activeWatchers: 5,
    deploymentEvidence: finalizedDeploymentEvidence,
    ...completeCreative,

  });
  check(
    "J4",
    statusOf(without, "official_contract") === "waiting",
    "no verified production deployment keeps registration waiting",
  );
  check(
    "J4b",
    statusOf(withProd, "official_contract") === "action" &&
      withProd.nextAction.stage?.key === "official_contract",
    "one eligible finalized production deployment makes registration the next action",
  );
  check(
    "J4c",
    statusOf(without, "deployment") === "waiting" &&
      statusOf(withProd, "deployment") === "complete",
    "deployment stage requires one verified managed-finalized production deployment",
  );
}

// J5 — deployment is reported, never proposed as a next action.
{
  const j = journey({
    readiness: computeLaunchReadiness(fullReadiness),
    launch: launchFacts("CONTRACT_PENDING"),
    activeWatchers: 5,
    deploymentEvidence: noDeploymentEvidence,
  });
  check(
    "J5",
    j.stages.find((s) => s.key === "deployment")!.actionable === false &&
      j.nextAction.stage?.key !== "deployment",
    "deployment stage is never an actionable next step",
  );
}

// J6 — unreadable inputs become `unavailable`, never `complete`.
{
  const j = journey({
    readiness: computeLaunchReadiness(fullReadiness),
    launch: launchFacts("LIVE", "complete"),
    activeWatchers: null,
    watchUnavailable: true,
    deploymentEvidence: null,
    deploymentUnavailable: true,
  });
  check(
    "J6",
    statusOf(j, "audience") === "unavailable" && statusOf(j, "deployment") === "unavailable",
    "unreadable inputs are reported as unknown",
  );
  check(
    "J6b",
    j.allComplete === false,
    "unknown state never counts toward completion",
  );
}

// J7 — fully complete journey exposes no next stage.
{
  const j = journey({
    readiness: computeLaunchReadiness(fullReadiness),
    launch: launchFacts("LIVE", "complete"),
    activeWatchers: 12,
    deploymentEvidence: finalizedDeploymentEvidence,
    ...completeCreative,

  });
  check("J7", j.allComplete === true, `completed ${j.completedCount}/${j.totalCount}`);
  check("J7b", j.nextAction.stage === null, "no next stage when everything is complete");
}

// J8 — deterministic: identical input yields identical output.
{
  const input: JourneyInput = {
    readiness: computeLaunchReadiness(fullReadiness),
    launch: launchFacts("ANNOUNCED"),
    activeWatchers: 0,
    watchUnavailable: false,
    deploymentEvidence: noDeploymentEvidence,
    deploymentUnavailable: false,
  };
  const a = JSON.stringify(computeProjectJourney(input));
  const b = JSON.stringify(computeProjectJourney(input));
  check("J8", a === b, "derivation is deterministic");
}

// J9 — the model persists nothing and performs no writes.
{
  const src = read("src/lib/project-journey.ts");
  const forbidden = [".insert(", ".update(", ".upsert(", ".delete(", "localStorage", "sessionStorage"];
  check(
    "J9",
    forbidden.every((token) => !src.includes(token)),
    "journey model contains no write or persistence call",
  );
}

// J10 — every surface consumes the same model.
{
  const hq = read("src/routes/_authenticated/index.tsx");
  const callout = read("src/components/cartel/LaunchReadiness.tsx");
  check(
    "J10",
    hq.includes("ProjectJourneyPanel") && !hq.includes("LaunchReadinessPanel"),
    "HQ renders the unified journey panel",
  );
  check(
    "J10b",
    callout.includes("ProjectJourneyCallout"),
    "the shared callout renders the unified journey model",
  );
}

// J11 — query key stays under the readiness prefix so existing invalidation works.
{
  const src = read("src/lib/project-journey.ts");
  check(
    "J11",
    src.includes('["launch-readiness", workspaceId ?? null, "project-journey"]'),
    "journey query key is prefixed with the readiness key",
  );
}

// J12 — primary launch selection prefers a genuinely active lifecycle launch.
{
  const row = (
    id: string,
    status: string,
    updated_at: string,
  ): ReadinessInput["launches"][number] => ({
    id,
    token_name: id,
    status,
    announced_at: null,
    watchlist_opened_at: null,
    launch_watch_token: null,
    created_at: updated_at,
    updated_at,
  });

  const active = row("active", "WATCHLIST_OPEN", "2026-09-07T13:57:38Z");
  const newDraft = row("newdraft", "DRAFT", "2026-09-10T06:03:31Z");
  const olderDraft = row("olddraft", "DRAFT", "2026-09-08T04:05:17Z");
  const completedOld = row("done1", "COMPLETED", "2026-09-01T00:00:00Z");
  const completedNew = row("done2", "COMPLETED", "2026-09-05T00:00:00Z");

  check(
    "J12",
    selectPrimaryLaunch([newDraft, olderDraft, active])?.id === "active",
    "older active-lifecycle launch beats newer DRAFT launches",
  );
  check(
    "J12b",
    selectPrimaryLaunch([olderDraft, newDraft])?.id === "newdraft",
    "newest DRAFT is chosen when no active lifecycle launch exists",
  );
  check(
    "J12c",
    selectPrimaryLaunch([completedOld, completedNew])?.id === "done2",
    "newest COMPLETED is the final fallback",
  );
  check(
    "J12d",
    selectPrimaryLaunch([completedNew, newDraft])?.id === "newdraft",
    "DRAFT is preferred over a newer COMPLETED launch",
  );
  const tieA = row("aaa", "LIVE", "2026-09-09T00:00:00Z");
  const tieB = row("bbb", "LIVE", "2026-09-09T00:00:00Z");
  check(
    "J12e",
    selectPrimaryLaunch([tieB, tieA])?.id === "aaa",
    "equal timestamps break deterministically on ascending id",
  );
  check("J12f", selectPrimaryLaunch([]) === null, "empty launch list yields no primary launch");
}

// ---------------------------------------------------------------------------
// P1-B — Brand & Creative + Communications readiness
// ---------------------------------------------------------------------------

const publishedProfile: ReadinessInput = {
  profile: { id: "p1", project_name: "PROJECT", discovery_status: "published" },
  launches: [],
  groups: [],
  settings: [],
};

// J13 — a published profile with no Brand Kit points at the Brand Kit next.
{
  const j = journey({ readiness: computeLaunchReadiness(publishedProfile) });
  check(
    "J13",
    j.nextAction.stage?.key === "brand_kit" && j.nextAction.to === "/brand-kit",
    `next after publication is ${j.nextAction.stage?.key}`,
  );
  check(
    "J13b",
    statusOf(j, "brand_kit") === "action",
    "missing Brand Kit is actionable, never complete",
  );
}

// J14 — a saved Brand Kit advances the path to creative assets.
{
  const j = journey({
    readiness: computeLaunchReadiness(publishedProfile),
    brandKit: { brandName: "PROJECT" },
    creativeAssets: { brandAssetCount: 0, generatedStickerCount: 0, otherAssetCount: 0 },
  });
  check("J14", statusOf(j, "brand_kit") === "complete", "named Brand Kit is complete");
  check(
    "J14b",
    j.nextAction.stage?.key === "creative_assets" && j.nextAction.to === "/assets",
    `next after Brand Kit is ${j.nextAction.stage?.key}`,
  );
  const blank = journey({
    readiness: computeLaunchReadiness(publishedProfile),
    brandKit: { brandName: "   " },
  });
  check(
    "J14c",
    statusOf(blank, "brand_kit") === "action",
    "a Brand Kit row without a brand name is not complete",
  );
  const unreadable = journey({
    readiness: computeLaunchReadiness(publishedProfile),
    brandKitUnavailable: true,
    brandKit: null,
  });
  check(
    "J14d",
    statusOf(unreadable, "brand_kit") === "unavailable",
    "unreadable Brand Kit is unknown, never complete",
  );
}

// J15 — creative assets: generated stickers alone never prove brand setup.
{
  const none = journey({
    readiness: computeLaunchReadiness(publishedProfile),
    brandKit: { brandName: "PROJECT" },
    creativeAssets: { brandAssetCount: 0, generatedStickerCount: 12, otherAssetCount: 0 },
  });
  check(
    "J15",
    statusOf(none, "creative_assets") === "action",
    "generated stickers alone leave creative assets actionable",
  );
  const some = journey({
    readiness: computeLaunchReadiness(publishedProfile),
    brandKit: { brandName: "PROJECT" },
    creativeAssets: { brandAssetCount: 2, generatedStickerCount: 12, otherAssetCount: 0 },
  });
  check(
    "J15b",
    statusOf(some, "creative_assets") === "complete",
    "logo/mascot/reference assets complete the stage",
  );
  check(
    "J15c",
    (some.stages.find((s) => s.key === "creative_assets")!.detail ?? "").includes("2 brand assets"),
    "asset detail is an honest count",
  );
  const unreadable = journey({
    readiness: computeLaunchReadiness(publishedProfile),
    brandKit: { brandName: "PROJECT" },
    creativeAssetsUnavailable: true,
    creativeAssets: null,
  });
  check(
    "J15d",
    statusOf(unreadable, "creative_assets") === "unavailable",
    "unreadable assets are unknown, never complete",
  );
}

// J16 — sticker pack lifecycle uses real pack status vocabulary.
{
  const base = {
    readiness: computeLaunchReadiness(publishedProfile),
    brandKit: { brandName: "PROJECT" },
    creativeAssets: { brandAssetCount: 1, generatedStickerCount: 0, otherAssetCount: 0 },
  };
  const zero = journey({ ...base, stickerPacks: { activeCount: 0, publishedCount: 0 } });
  check(
    "J16",
    statusOf(zero, "sticker_pack") === "action" &&
      zero.nextAction.stage?.key === "sticker_pack" &&
      zero.nextAction.to === "/sticker-lab",
    "no packs routes to Sticker Lab",
  );
  const draft = journey({ ...base, stickerPacks: { activeCount: 2, publishedCount: 0 } });
  check(
    "J16b",
    statusOf(draft, "sticker_pack") === "action",
    "in-progress packs are not complete",
  );
  check(
    "J16c",
    (draft.stages.find((s) => s.key === "sticker_pack")!.detail ?? "").includes("in progress"),
    "in-progress packs are described honestly",
  );
  const published = journey({ ...base, stickerPacks: { activeCount: 2, publishedCount: 1 } });
  check(
    "J16d",
    statusOf(published, "sticker_pack") === "complete",
    "a published active pack completes the stage",
  );
  const unreadable = journey({ ...base, stickerPacksUnavailable: true, stickerPacks: null });
  check(
    "J16e",
    statusOf(unreadable, "sticker_pack") === "unavailable",
    "unreadable packs are unknown, never complete",
  );
}

// J17 — communications readiness comes only from inbox settings.
{
  const base = { readiness: computeLaunchReadiness(fullReadiness) };
  const on = journey({
    ...base,
    inbox: { repliesEnabled: true, newConversationsEnabled: true, waitingOnTeamCount: 0 },
  });
  check("J17", statusOf(on, "communications") === "complete", "both directions enabled is complete");

  const partial = journey({
    ...base,
    inbox: { repliesEnabled: true, newConversationsEnabled: false, waitingOnTeamCount: null },
  });
  check(
    "J17b",
    statusOf(partial, "communications") === "action" &&
      partial.stages.find((s) => s.key === "communications")!.to === "/telegram",
    "a disabled direction is actionable on the existing inbox surface",
  );

  const unreadable = journey({ ...base, inboxUnavailable: true, inbox: null });
  check(
    "J17c",
    statusOf(unreadable, "communications") === "unavailable",
    "unreadable inbox settings are unknown, never complete",
  );

  const busy = journey({
    ...base,
    inbox: { repliesEnabled: true, newConversationsEnabled: true, waitingOnTeamCount: 2 },
  });
  const detail = busy.stages.find((s) => s.key === "communications")!.detail ?? "";
  check(
    "J17d",
    statusOf(busy, "communications") === "complete" && detail === "Inbox ready · 2 need reply",
    `waiting workload stays operational detail: "${detail}"`,
  );
}

// J18 — the journey model still performs no writes of any kind.
{
  const src = read("src/lib/project-journey.ts");
  const forbidden = [
    ".insert(",
    ".update(",
    ".upsert(",
    ".delete(",
    "localStorage",
    "sessionStorage",
    "setProjectInbox",
    "sendProjectInboxTeamReply",
    "updateProjectConversationStatus",
  ];
  check(
    "J18",
    forbidden.every((token) => !src.includes(token)),
    "journey model contains no persistence or mutation call",
  );
  check(
    "J18b",
    !src.includes("project_conversations") && !src.includes("project_inbox_"),
    "private inbox tables are never queried directly",
  );
}

// ---------------------------------------------------------------------------
// P1-C — Verification, finality, official contract and go-live visibility
// ---------------------------------------------------------------------------

const evidenceContext = (
  launchId = "l1",
  status = "CONTRACT_PENDING",
): LaunchEvidenceContext => ({
  launchId,
  workspaceId: "workspace-1",
  declaredChain: "Robinhood Chain",
  launchStatus: status,
  officialContractAddress: null,
  officialContractDeploymentId: null,
  contractRegisteredAt: null,
});

const evidenceRow = (
  overrides: Partial<DeploymentEvidenceInput> = {},
): DeploymentEvidenceInput => ({
  id: "deployment-1",
  attempt_number: 1,
  launch_id: "l1",
  workspace_id: "workspace-1",
  deployment_kind: "FIXED_SUPPLY_ERC20",
  network_environment: "PRODUCTION",
  chain_id: 4663,
  status: "CONFIRMED",
  tx_hash: `0x${"a".repeat(64)}`,
  contract_address: `0x${"b".repeat(40)}`,
  confirmations: 0,
  block_number: 900,
  submitted_at: "2026-09-07T00:00:00.000Z",
  verified_at: "2026-09-07T00:01:00.000Z",
  created_at: "2026-09-07T00:00:00.000Z",
  artifact_id: "cartel-fixed-erc20-v1",
  failure_code: null,
  failure_detail: null,
  token_name: "PROJECT",
  token_symbol: "PROJECT",
  token_decimals: 18,
  token_total_supply_text: "1000000000000000000000",
  verified_token_name: "PROJECT",
  verified_token_symbol: "PROJECT",
  verified_token_decimals: 18,
  verified_total_supply_text: "1000000000000000000000",
  verified_recipient_balance_text: "1000000000000000000000",
  finality_state: "FINALIZED",
  finalized_block_hash_confirmed: true,
  finality_provider_kind: "MANAGED",
  finalized_at: "2026-09-07T00:02:00.000Z",
  finalized_block_number: 900,
  finalized_head_block_number: 901,
  ...overrides,
});

const deriveEvidence = (
  rows: DeploymentEvidenceInput[],
  context = evidenceContext(),
) => deriveJourneyDeploymentEvidenceFacts(
  evaluateLaunchDeploymentEvidence(context, rows),
  rows,
);

const contractJourney = (
  deploymentEvidence: JourneyInput["deploymentEvidence"],
  launch = launchFacts("CONTRACT_PENDING"),
) => journey({
  readiness: computeLaunchReadiness(fullReadiness),
  launch,
  activeWatchers: 1,
  deploymentEvidence,
  ...completeCreative,
});

// J19 — the stage contract remains exactly 16 ordered stages.
{
  const expected = [
    "project_profile", "profile_published", "brand_kit", "creative_assets",
    "sticker_pack", "launch_created", "launch_announced", "launch_schedule",
    "launch_watch_open", "telegram_community", "launch_welcome", "audience",
    "communications", "deployment", "official_contract", "launch_live",
  ];
  check(
    "J19",
    JOURNEY_STAGE_KEYS.length === 16 && JSON.stringify(JOURNEY_STAGE_KEYS) === JSON.stringify(expected),
    "the exact 16-stage order is unchanged",
  );
}

// J20 — testnet and incomplete production evidence never satisfy deployment.
{
  const testnet = evidenceRow({
    network_environment: "TESTNET",
    chain_id: 46630,
    confirmations: 5,
  });
  const testnetFacts = deriveEvidence(
    [testnet],
    { ...evidenceContext(), declaredChain: "Robinhood Chain Testnet" },
  );
  check(
    "J20",
    statusOf(contractJourney(testnetFacts), "deployment") === "waiting" &&
      testnetFacts.productionDeploymentCount === 0,
    "verified testnet evidence never satisfies production deployment",
  );

  const unverifiedFacts = deriveEvidence([evidenceRow({ verified_at: null })]);
  check(
    "J20b",
    statusOf(contractJourney(unverifiedFacts), "deployment") === "waiting" &&
      unverifiedFacts.verifiedProductionCount === 0,
    "unverified production evidence remains waiting",
  );
}

// J21 — managed finality is authoritative; confirmations are not.
{
  const finalized = deriveEvidence([evidenceRow({ confirmations: 0 })]);
  check(
    "J21",
    statusOf(contractJourney(finalized), "deployment") === "complete" &&
      finalized.managedFinalizedVerifiedCount === 1,
    "managed FINALIZED evidence completes deployment even with zero confirmations",
  );

  for (const [label, row] of [
    ["pending", evidenceRow({ finality_state: "FINALITY_PENDING" })],
    ["unmanaged", evidenceRow({ finality_provider_kind: "SELF" })],
    ["mismatched", evidenceRow({ finalized_block_number: 899 })],
    ["incomplete", evidenceRow({ finalized_at: null })],
  ] as const) {
    const facts = deriveEvidence([row]);
    check(
      `J21-${label}`,
      statusOf(contractJourney(facts), "deployment") === "waiting" &&
        facts.managedFinalizedVerifiedCount === 0,
      `${label} finality does not complete deployment`,
    );
  }
}

// J22 — competing verified production records fail closed for deployment and registration.
{
  const facts = deriveEvidence([
    evidenceRow(),
    evidenceRow({ id: "deployment-2", attempt_number: 2 }),
  ]);
  const j = contractJourney(facts);
  check(
    "J22",
    facts.deploymentAmbiguous && statusOf(j, "deployment") === "waiting",
    "multiple verified production candidates require review",
  );
  check(
    "J22b",
    statusOf(j, "official_contract") === "waiting" &&
      j.stages.find((stage) => stage.key === "official_contract")?.actionable === false,
    "ambiguous registration candidates are never actionable",
  );
  check(
    "J22c",
    j.stages.find((stage) => stage.key === "deployment")?.actionable === false,
    "deployment remains informational in every state",
  );
}

// J23 — registration needs exactly one eligible candidate or all three recorded fields.
{
  const eligible = contractJourney(deriveEvidence([evidenceRow()]));
  const zero = contractJourney(noDeploymentEvidence);
  const partial = contractJourney(finalizedDeploymentEvidence, launchFacts("CONTRACT_PENDING", "partial"));
  const registered = contractJourney(finalizedDeploymentEvidence, launchFacts("CONTRACT_PENDING", "complete"));
  check(
    "J23",
    statusOf(eligible, "official_contract") === "action" &&
      eligible.stages.find((stage) => stage.key === "official_contract")?.to === "/launch-control",
    "exactly one eligible candidate routes registration review to Launch Control",
  );
  check("J23b", statusOf(zero, "official_contract") === "waiting", "zero eligible candidates wait");
  check(
    "J23c",
    statusOf(partial, "official_contract") === "unavailable",
    "partial registration fields fail closed",
  );
  check(
    "J23d",
    statusOf(registered, "official_contract") === "complete",
    "all three registration binding fields complete registration",
  );
}

// J24 — go-live visibility follows normalized lifecycle and strengthened registration.
{
  const earlier = contractJourney(finalizedDeploymentEvidence, launchFacts("OFFICIAL_CONTRACT_REGISTERED", "complete"));
  const live = contractJourney(finalizedDeploymentEvidence, launchFacts("LIVE", "complete"));
  const completed = contractJourney(finalizedDeploymentEvidence, launchFacts("COMPLETED", "complete"));
  check(
    "J24",
    statusOf(earlier, "launch_live") === "action" &&
      statusOf(live, "launch_live") === "complete" &&
      statusOf(completed, "launch_live") === "complete",
    "only LIVE and COMPLETED satisfy go-live",
  );
}

// J25 — evidence remains scoped to the selected launch.
{
  const foreign = evidenceRow({ launch_id: "canary-launch" });
  const facts = deriveEvidence([foreign], evidenceContext("l1"));
  check(
    "J25",
    facts.productionDeploymentCount === 0 &&
      statusOf(contractJourney(facts), "deployment") === "waiting",
    "finalized production evidence from another launch cannot satisfy the primary launch",
  );
}

// J26 — no liquidity, wallet, execution or mutation boundary enters the journey.
{
  const src = read("src/lib/project-journey.ts");
  const forbidden = [
    "liquidity-plan",
    "MAINNET_LIQUIDITY_TX_ENABLED",
    "wallet-connector",
    "/chain-launcher",
    "/mainnet-canary",
    "registerVerifiedLaunchContract",
    "transitionLaunchStatus",
    "verifyMainnetChainDeployment",
    "applyProductionDeploymentVerification",
    "applyProductionFinality",
    "presignMainnetTokenDeployment",
    "armCanaryExecution",
    "claimMainnetDeploymentHandoff",
    "authorizeMainnetSendWindow",
    "sendClaimedMainnetDeployment",
    "persistMainnetDeploymentTxHash",
  ];
  check(
    "J26",
    forbidden.every((token) => !src.includes(token)),
    "journey imports no liquidity, wallet, execution, verifier-write or mutation path",
  );
}

if (failures > 0) {

  console.error(`\n${failures} check(s) failed.`);
  process.exit(1);
}
console.log("\nP1-A project journey regression: all checks passed.");
