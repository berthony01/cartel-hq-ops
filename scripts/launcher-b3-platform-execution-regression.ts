/**
 * Launcher-B3 regression — static contract coverage only.
 *
 * Nothing here touches Supabase, the network, a wallet, Telegram or the chain.
 * It pins the safety-relevant shape of the platform execution handoff: which
 * status targets are reachable from the client, that execution can only begin
 * through the atomic begin RPC, that COMPLETED is never set by hand, that the
 * request queue is PROJECT-only, and that the legacy canary path keeps its
 * recipient-must-match-deployer guard.
 *
 * Run: bunx tsx scripts/launcher-b3-platform-execution-regression.ts
 */
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";

let passed = 0;
const failures: string[] = [];

function check(name: string, condition: boolean) {
  if (condition) passed += 1;
  else failures.push(name);
}

const read = (path: string) => readFileSync(new URL(path, import.meta.url), "utf8");

/** Comment text is documentation, not behaviour: strip it before scanning. */
const stripComments = (source: string) =>
  source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");

const platform = stripComments(
  read("../src/lib/launch-production-request-platform.functions.ts"),
);
const queue = read("../src/components/cartel/ProductionRequestQueuePanel.tsx");
const route = read("../src/routes/_authenticated/mainnet-canary.tsx");
const canary = read("../src/lib/chain-mainnet-canary.functions.ts");

/* -------------------------------------------------------------- */
/* 1 — Status targets: never EXECUTING, never COMPLETED            */
/* -------------------------------------------------------------- */

check(
  "targets: exactly IN_REVIEW / APPROVED / DECLINED",
  /PLATFORM_REQUEST_STATUS_TARGETS = \["IN_REVIEW", "APPROVED", "DECLINED"\] as const/.test(
    platform,
  ),
);
check(
  "targets: EXECUTING is never a client status target",
  !/_target_status[\s\S]{0,200}"EXECUTING"/.test(platform) &&
    !/"EXECUTING"/.test(queue.replace(/request\.status === "EXECUTING"/g, "")),
);
check(
  "targets: COMPLETED is never written by the client",
  !/targetStatus[^\n]*COMPLETED/.test(platform) && !/setStatus[^\n]*COMPLETED/.test(route),
);
check(
  "status wrapper calls only the B1 status RPC",
  /rpc\(\s*\n?\s*"set_launch_production_deployment_request_status"/.test(platform),
);
check(
  "decline requires an explicit reason",
  /targetStatus === "DECLINED" && data\.note\.length < 8/.test(platform) &&
    /notice: "REASON_REQUIRED"/.test(platform),
);

/* -------------------------------------------------------------- */
/* 2 — Begin: single atomic RPC, no token intent accepted          */
/* -------------------------------------------------------------- */

check(
  "begin calls only begin_launch_production_request_execution",
  /rpc\(\s*\n?\s*"begin_launch_production_request_execution"/.test(platform),
);
check(
  "begin input is exactly requestId/deployer/fingerprint/initCodeHash",
  /type BeginInput = \{\s*requestId: string;\s*deployerAddress: string;\s*reviewFingerprint: string;\s*initCodeHash: string;\s*\}/.test(
    platform,
  ),
);
check(
  "begin never accepts token name, symbol, supply or recipient",
  !/type BeginInput = \{[^}]*token/i.test(platform),
);
check(
  "begin validates address and 32-byte hashes and rejects the zero address",
  /ADDRESS\.test\(data\.deployerAddress\)/.test(platform) &&
    /data\.deployerAddress === ZERO_ADDRESS/.test(platform) &&
    /HASH32\.test\(data\.reviewFingerprint\)/.test(platform) &&
    /HASH32\.test\(data\.initCodeHash\)/.test(platform),
);
check(
  "begin is gated on APPROVED and unbound only",
  /request\.status === "APPROVED" && !request\.executionDeploymentId/.test(platform),
);

/* -------------------------------------------------------------- */
/* 3 — Authorization and isolation                                 */
/* -------------------------------------------------------------- */

check(
  "every wrapper uses requireSupabaseAuth",
  (platform.match(/\.middleware\(\[requireSupabaseAuth\]\)/g) ?? []).length === 3,
);
check(
  "ownership is re-checked server-side and fails closed",
  /is_platform_owner/.test(platform) && /return !error && data === true/.test(platform),
);
check(
  "no service-role client is reachable from the platform wrappers",
  !/client\.server/.test(platform) && !/SERVICE_ROLE/.test(platform),
);
check(
  "queue is PROJECT-only",
  /launchKind === "PROJECT"/.test(platform) &&
    /request\.launchKind !== "PROJECT"/.test(platform),
);

/* -------------------------------------------------------------- */
/* 4 — No prohibited side effects from review or begin             */
/* -------------------------------------------------------------- */

for (const forbidden of [
  "sendTransaction",
  "eth_sendTransaction",
  "arm_launch_chain_production_canary_execution",
  "issue_launch_chain_production_presign_authorization",
  "authorize_launch_chain_production_send_window_issuance",
  "correct_verified_launch_contract",
  "telegram",
  "liquidity",
]) {
  check(
    `platform wrappers never reference ${forbidden}`,
    !platform.toLowerCase().includes(forbidden.toLowerCase()),
  );
}

/* -------------------------------------------------------------- */
/* 5 — Route wiring                                                */
/* -------------------------------------------------------------- */

check(
  "route validates the request id in the URL",
  /validateSearch: \(search: Record<string, unknown>\)/.test(route) &&
    /REQUEST_ID_PATTERN\.test\(raw\)/.test(route),
);
check(
  "request mode hides the legacy free-form intent form",
  /\{requestMode \? null : \(/.test(route),
);
check(
  "begin requires the literal confirmation phrase",
  /BEGIN_EXECUTION_PHRASE = "BEGIN PROTECTED EXECUTION"/.test(route) &&
    /beginPhrase\.trim\(\) === BEGIN_EXECUTION_PHRASE/.test(route),
);
check(
  "begin fails closed on any mismatch with the immutable request row",
  /intent\.totalSupplyBaseUnits === selectedRequest\.tokenTotalSupplyBaseUnits/.test(route) &&
    /intent\.recipient === selectedRequest\.tokenRecipient/.test(route),
);
check(
  "request hydration copies identity read-only from the request row",
  /setRecipient\(selectedRequest\.tokenRecipient\)/.test(route) &&
    /setSupply\(selectedRequest\.tokenSupplyWhole\)/.test(route) &&
    /setDeploymentId\(selectedRequest\.executionDeploymentId\)/.test(route),
);
check(
  "production capability switches are untouched",
  /MAINNET_DEPLOYMENT_TX_ENABLED/.test(route) && /MAINNET_LIQUIDITY_TX_ENABLED/.test(route),
);

/* -------------------------------------------------------------- */
/* 6 — Legacy canary path is unchanged                             */
/* -------------------------------------------------------------- */

check(
  "legacy canary keeps RECIPIENT_MUST_MATCH_DEPLOYER",
  /data\.tokenRecipient !== data\.deployerAddress[\s\S]{0,80}RECIPIENT_MUST_MATCH_DEPLOYER/.test(
    canary,
  ),
);
check(
  "request-bound execution does not go through the legacy attempt creator",
  !/createCanaryDeploymentAttempt/.test(platform),
);

/* -------------------------------------------------------------- */
/* 7 — B3.1 authority parity (repository parity migration)         */
/* -------------------------------------------------------------- */

const B31_PATH = "../supabase/migrations/20260911224113_launcher_b3_1_preserve_legacy_canary_authority.sql";
const b31Raw = readFileSync(new URL(B31_PATH, import.meta.url));
const b31 = b31Raw.toString("utf8");

check("B3.1 parity migration is byte-exact (3795 bytes)", b31Raw.byteLength === 3795);
check(
  "B3.1 parity migration checksum matches the applied statement",
  createHash("md5").update(b31Raw).digest("hex") === "d1a097db83f30fee716424b02bb96120",
);

const B31_TARGETS = [
  "arm_launch_chain_production_canary_execution",
  "authorize_launch_chain_production_send_window_issuance",
  "cancel_claimed_launch_chain_production_presign_authorization",
  "get_launch_chain_production_reconciliation_snapshot",
  "submit_launch_chain_production_deployment_tx",
  "enforce_launch_chain_production_presign",
] as const;

for (const fn of B31_TARGETS) {
  check(`B3.1 targets ${fn}`, b31.includes(fn));
}

/**
 * Every rewritten predicate must keep BOTH authorities: the legacy
 * workspace-operator path and the exact request-scoped path. A replacement
 * that drops either one is the defect B3.1 exists to correct.
 */
const replacements = [
  ...b31.matchAll(/'\(public\.is_workspace_operator\([^']*\)'/g),
];
check(
  "B3.1 rewrites exactly six authority predicates",
  replacements.length === B31_TARGETS.length,
);
for (const [replacement] of replacements) {
  check(
    `replacement preserves legacy authority: ${replacement.slice(0, 48)}`,
    replacement.includes("public.is_workspace_operator("),
  );
  check(
    `replacement preserves request-scoped authority: ${replacement.slice(0, 48)}`,
    replacement.includes("private.can_operate_launch_production_request("),
  );
  check(
    `replacement keeps the two authorities as an OR: ${replacement.slice(0, 48)}`,
    / or /.test(replacement),
  );
}

/** The post-condition block re-asserts both predicates on all six functions. */
check(
  "B3.1 asserts both predicates survive in every targeted function",
  b31.includes("position('public.is_workspace_operator' in rec.definition) = 0") &&
    b31.includes(
      "position('private.can_operate_launch_production_request' in rec.definition) = 0",
    ) &&
    b31.includes("Authority parity missing in %"),
);

/** The correction must not widen authorization anywhere else. */
for (const forbidden of [
  "grant ",
  "revoke ",
  "create policy",
  "alter policy",
  "drop policy",
  "alter table",
  "create role",
  "alter role",
  "security definer",
  "is_platform_owner",
]) {
  check(
    `B3.1 does not change authorization via "${forbidden.trim()}"`,
    !b31.toLowerCase().includes(forbidden),
  );
}
check(
  "B3.1 only touches the six intended production functions",
  (b31.match(/public\.[a-z_]+\(/g) ?? [])
    .map((m) => m.slice("public.".length, -1))
    .every(
      (name) =>
        (B31_TARGETS as readonly string[]).includes(name) || name === "is_workspace_operator",
    ),
);


if (failures.length > 0) {
  console.error(`FAILED ${failures.length} check(s):`);
  for (const f of failures) console.error(`  - ${f}`);
  process.exit(1);
}
console.log(`Launcher-B3 platform execution regression: ${passed} checks passed.`);
