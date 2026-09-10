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
  JOURNEY_STAGE_KEYS,
  type JourneyInput,
  type JourneyStageKey,
} from "../src/lib/project-journey";

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
    verifiedProductionDeployments: null,
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
    launch: { id: "l1", status: "ANNOUNCED", scheduleSet: false, officialContractRegistered: false },
    activeWatchers: 3,
  });
  check("J3", j.nextAction.stage?.key === "launch_schedule", `next=${j.nextAction.stage?.key}`);
}

// J4 — verified PRODUCTION deployments gate contract registration.
{
  const r = computeLaunchReadiness(fullReadiness);
  const without = journey({
    readiness: r,
    launch: { id: "l1", status: "LIVE", scheduleSet: true, officialContractRegistered: false },
    activeWatchers: 5,
    verifiedProductionDeployments: 0,
  });
  const withProd = journey({
    readiness: r,
    launch: { id: "l1", status: "LIVE", scheduleSet: true, officialContractRegistered: false },
    activeWatchers: 5,
    verifiedProductionDeployments: 1,
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
    "verified production deployment makes registration the next action",
  );
  check(
    "J4c",
    statusOf(without, "deployment") === "waiting" &&
      statusOf(withProd, "deployment") === "complete",
    "deployment stage reflects verified production count only",
  );
}

// J5 — deployment is reported, never proposed as a next action.
{
  const j = journey({
    readiness: computeLaunchReadiness(fullReadiness),
    launch: { id: "l1", status: "LIVE", scheduleSet: true, officialContractRegistered: false },
    activeWatchers: 5,
    verifiedProductionDeployments: 0,
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
    launch: { id: "l1", status: "LIVE", scheduleSet: true, officialContractRegistered: true },
    activeWatchers: null,
    watchUnavailable: true,
    verifiedProductionDeployments: null,
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
    launch: { id: "l1", status: "LIVE", scheduleSet: true, officialContractRegistered: true },
    activeWatchers: 12,
    verifiedProductionDeployments: 1,
    ...completeCreative,

  });
  check("J7", j.allComplete === true, `completed ${j.completedCount}/${j.totalCount}`);
  check("J7b", j.nextAction.stage === null, "no next stage when everything is complete");
}

// J8 — deterministic: identical input yields identical output.
{
  const input: JourneyInput = {
    readiness: computeLaunchReadiness(fullReadiness),
    launch: { id: "l1", status: "ANNOUNCED", scheduleSet: true, officialContractRegistered: false },
    activeWatchers: 0,
    watchUnavailable: false,
    verifiedProductionDeployments: 0,
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

if (failures > 0) {
  console.error(`\n${failures} check(s) failed.`);
  process.exit(1);
}
console.log("\nP1-A project journey regression: all checks passed.");
