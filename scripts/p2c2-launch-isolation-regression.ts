/**
 * P2-C2 — LAUNCH KIND ISOLATION + LAUNCH CONTROL WORKING VIEWS regression.
 *
 * PURE. No network, no database, no wallet, no provider, no transaction.
 * Exercises pure selection/classification logic plus repository source text.
 */
import { readFileSync } from "node:fs";
import {
  isInternalTestLaunch,
  isProjectLaunch,
  selectPrimaryProjectLaunch,
  toLaunchKind,
  type LaunchPrioritySource,
} from "../src/lib/launch-control";
import { computeLaunchReadiness, type ReadinessInput } from "../src/lib/launch-readiness";

const read = (p: string) => readFileSync(p, "utf8");

let failures = 0;
function check(id: string, ok: boolean, detail: string) {
  if (ok) console.log(`PASS ${id} — ${detail}`);
  else {
    failures += 1;
    console.error(`FAIL ${id} — ${detail}`);
  }
}

// ---------------------------------------------------------------- selection
const activeProject: LaunchPrioritySource = {
  id: "l-project",
  status: "WATCHLIST_OPEN",
  launch_kind: "PROJECT",
  created_at: "2026-01-01T00:00:00Z",
  updated_at: "2026-01-01T00:00:00Z",
};
const newerInternalA: LaunchPrioritySource = {
  id: "l-internal-a",
  status: "DRAFT",
  launch_kind: "INTERNAL_TEST",
  created_at: "2026-09-01T00:00:00Z",
  updated_at: "2026-09-09T00:00:00Z",
};
const newerInternalB: LaunchPrioritySource = {
  id: "l-internal-b",
  status: "DRAFT",
  launch_kind: "INTERNAL_TEST",
  created_at: "2026-09-02T00:00:00Z",
  updated_at: "2026-09-10T00:00:00Z",
};
const olderProjectDraft: LaunchPrioritySource = {
  id: "l-draft",
  status: "DRAFT",
  launch_kind: "PROJECT",
  created_at: "2025-12-01T00:00:00Z",
  updated_at: "2025-12-01T00:00:00Z",
};

check(
  "C2-1",
  selectPrimaryProjectLaunch([newerInternalB, newerInternalA, activeProject])?.id ===
    "l-project",
  "newer INTERNAL_TEST drafts cannot outrank an active PROJECT launch",
);
check(
  "C2-2",
  selectPrimaryProjectLaunch([newerInternalB, olderProjectDraft])?.id === "l-draft",
  "with no active PROJECT launch, the newest PROJECT draft wins over INTERNAL_TEST",
);
check(
  "C2-3",
  selectPrimaryProjectLaunch([newerInternalA, newerInternalB]) === null,
  "an INTERNAL_TEST-only workspace has no PROJECT primary launch",
);
check(
  "C2-4",
  toLaunchKind(null) === "PROJECT" &&
    toLaunchKind(undefined) === "PROJECT" &&
    toLaunchKind("INTERNAL_TEST") === "INTERNAL_TEST",
  "missing classification defaults to PROJECT",
);
check(
  "C2-5",
  isProjectLaunch(activeProject) &&
    !isProjectLaunch(newerInternalA) &&
    isInternalTestLaunch(newerInternalA),
  "classification predicates agree",
);

// ---------------------------------------------------------------- readiness
const readinessInput: ReadinessInput = {
  profile: { id: "p1", project_name: "Example", discovery_status: "published" },
  launches: [
    {
      id: "internal-1",
      token_name: "Internal canary",
      status: "DRAFT",
      announced_at: null,
      watchlist_opened_at: null,
      launch_watch_token: null,
      launch_kind: "INTERNAL_TEST",
      created_at: "2026-09-10T00:00:00Z",
      updated_at: "2026-09-10T00:00:00Z",
    },
    {
      id: "project-1",
      token_name: "Real launch",
      status: "WATCHLIST_OPEN",
      announced_at: "2026-01-01T00:00:00Z",
      watchlist_opened_at: "2026-01-02T00:00:00Z",
      launch_watch_token: "a".repeat(24),
      launch_kind: "PROJECT",
      created_at: "2026-01-01T00:00:00Z",
      updated_at: "2026-01-02T00:00:00Z",
    },
  ],
  groups: [],
  settings: [],
};
const readiness = computeLaunchReadiness(readinessInput);
check(
  "C2-6",
  readiness.primaryLaunch?.id === "project-1",
  "launch readiness ignores INTERNAL_TEST and selects the PROJECT launch",
);

// ------------------------------------------------------------- source rules
const launchControlLib = read("src/lib/launch-control.ts");
check(
  "C2-7",
  /\.eq\("workspace_id", workspaceId\)[\s\S]{0,120}\.eq\("project_profile_id", projectProfileId\)/.test(
    launchControlLib,
  ),
  "listLaunches filters both workspace_id and project_profile_id",
);

const journey = read("src/lib/project-journey.ts");
check(
  "C2-8",
  journey.includes("isProjectLaunch"),
  "Project Journey filters launches to PROJECT",
);

const readinessSrc = read("src/lib/launch-readiness.ts");
check(
  "C2-9",
  readinessSrc.includes("isProjectLaunch") &&
    readinessSrc.includes("selectPrimaryProjectLaunch"),
  "readiness uses the shared PROJECT-only primary rule",
);

const nav = read("src/components/cartel/SectionNav.tsx");
const controlledPath = nav.slice(nav.indexOf("const go ="));
check(
  "C2-10",
  !controlledPath.includes("scrollIntoView(") ||
    /if \(controlled\) \{\s*onChange!\(id\);\s*return;/.test(controlledPath),
  "controlled SectionNav returns before any scrollIntoView call",
);
check(
  "C2-11",
  /if \(controlled\) return;/.test(nav),
  "controlled SectionNav creates no IntersectionObserver",
);

const page = read("src/routes/_authenticated/launch-control.tsx");
check(
  "C2-12",
  page.includes("const projectLaunches = useMemo(() => launches.filter(isProjectLaunch)") &&
    page.includes("launches.filter(isInternalTestLaunch)"),
  "Launch Control separates PROJECT and INTERNAL_TEST lists generically",
);
check(
  "C2-13",
  page.includes('listLaunches(workspaceId!, profile!.id)') &&
    page.includes('queryKey: ["launches", workspaceId, profile?.id ?? null]'),
  "Launch Control queries launches scoped to workspace + project profile",
);

const internalBranchStart = page.indexOf("{selected && selectedIsInternalTest ? (");
const internalBranchEnd = page.indexOf("{selected && !selectedIsInternalTest ? (");
check(
  "C2-14",
  internalBranchStart > -1 && internalBranchEnd > internalBranchStart,
  "an isolated INTERNAL_TEST rendering branch exists before the PROJECT branch",
);
const internalBranch = page.slice(internalBranchStart, internalBranchEnd);
const forbiddenInInternal = [
  "transitionMutation.mutate",
  "VerifiedContractRegistrationPanel",
  "OfficialContractNotifyPanel",
  "OfficialContractGroupBroadcastPanel",
  "OfficialContractCorrectionPanel",
  "launch-editor-form",
  "SectionNav",
  "watchLink",
];
check(
  "C2-15",
  forbiddenInInternal.every((token) => !internalBranch.includes(token)),
  "INTERNAL_TEST branch renders no lifecycle, schedule, watch, comms or contract actions",
);
check(
  "C2-16",
  page.includes("{selected && !selectedIsInternalTest && saveButton ? ("),
  "the sticky mobile save bar never renders for an INTERNAL_TEST record",
);

for (const id of [
  "lc-overview",
  "lc-details",
  "lc-schedule",
  "lc-watch",
  "lc-comms",
  "lc-contract",
]) {
  check(
    `C2-17:${id}`,
    page.includes(`<WorkingView id="${id}" active={activeSection === "${id}"}>`),
    `working view ${id} is mounted and controlled`,
  );
}
check(
  "C2-18",
  page.includes('id="launch-editor-form"'),
  "the launch editor form id is preserved",
);
check(
  "C2-19",
  page.includes("hidden={!active}"),
  "inactive working views stay mounted and are hidden with markup semantics only",
);

const selectionRegion = page.slice(
  page.indexOf("const [selectedId, setSelectedId]"),
  page.indexOf("const [form, setForm]"),
);
check(
  "C2-20",
  !/PEPECARTEL|pepecartel|canary/i.test(selectionRegion),
  "selection logic hardcodes no project name, ticker or canary identifier",
);

if (failures > 0) {
  console.error(`\n${failures} check(s) failed.`);
  process.exit(1);
}
console.log("\nP2-C2 launch isolation regression: all checks passed.");
