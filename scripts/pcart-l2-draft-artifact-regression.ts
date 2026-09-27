/**
 * PCART-L2 Phase 2 — frozen source status + non-activation regression.
 *
 * PURE SOURCE/STATIC assertions only. No network, no RPC, no wallet, no
 * database, no Solidity compilation, no environment value is read. This suite
 * proves two things:
 *   1. the frozen PepeCartelToken source and its specification match the
 *      frozen PCART token behavior exactly; and
 *   2. freezing activated nothing — the generic `cartel-fixed-erc20-v1`
 *      artifact and every production allowlist/runtime safety value are
 *      untouched, and `pepecartel-token-v1` appears only in its dedicated
 *      artifact file, artifacts/**, docs and regression scripts.
 */
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";

const DRAFT = "contracts/PepeCartelToken.sol";
const GENERIC_SOL = "contracts/CartelFixedSupplyToken.sol";
const SPEC = "docs/PCART_L2_TOKEN_SPECIFICATION.md";
const PLAN = "docs/PCART_MASTER_LAUNCH_PLAN.md";
const EVIDENCE = "src/lib/launch-evidence-checks.ts";
const ARTIFACT = "src/lib/cartel-fixed-erc20.artifact.ts";
const FROZEN_TS = "src/lib/pepecartel-token.artifact.ts";
const FROZEN_INPUT = "artifacts/pepecartel-token-v1.compiler-input.json";
const FROZEN_MANIFEST = "artifacts/pepecartel-token-v1.manifest.json";
const REGISTRY = "src/lib/chain-mainnet-registry.ts";
const MIGRATIONS = "supabase/migrations";
const SRC = "src";

const read = (p: string) => readFileSync(p, "utf8");
const stripSolComments = (s: string) =>
  s.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");

const draftRaw = read(DRAFT);
const draft = stripSolComments(draftRaw);
const specSrc = read(SPEC);
const planSrc = read(PLAN);
const evidenceSrc = read(EVIDENCE);
const artifactSrc = read(ARTIFACT);
const registrySrc = read(REGISTRY);


function walk(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) out.push(...walk(full));
    else out.push(full);
  }
  return out;
}

let failures = 0;
function check(id: string, ok: boolean, detail: string) {
  if (ok) console.log(`PASS ${id} — ${detail}`);
  else {
    failures += 1;
    console.error(`FAIL ${id} — ${detail}`);
  }
}

// ------------------------------------------- A. existence and status markers
check("L2D-A1", draftRaw.length > 0, "frozen PepeCartelToken.sol exists");
check("L2D-A2", specSrc.length > 0, "PCART-L2 token specification exists");
check(
  "L2D-A3",
  /PCART-L2 FROZEN SOURCE/.test(draftRaw) &&
    /COMPILED AND FROZEN AS/.test(draftRaw) &&
    /NOT YET PRODUCTION-ALLOWLISTED/.test(draftRaw) &&
    /NOT YET DEPLOYED/.test(draftRaw) &&
    /PCART-L2 Phase 3/.test(draftRaw) &&
    !/NOT COMPILED/.test(draftRaw) &&
    !/NOT DEPLOYABLE WHILE PCART-L1 IS OPEN/.test(draftRaw),
  "frozen header carries FROZEN / COMPILED / NOT ALLOWLISTED / NOT DEPLOYED / Phase 3 markers and no stale DRAFT-open wording",
);
check(
  "L2D-A4",
  /COMPILED \+ FROZEN REPOSITORY ARTIFACT/.test(specSrc) &&
    /NOT PRODUCTION-ALLOWLISTED/.test(specSrc) &&
    /NOT DEPLOYED/.test(specSrc) &&
    /PCART-L1 is \*\*POLICY CLOSED\*\*/.test(specSrc) &&
    !/PCART-L1 OPEN/.test(specSrc),
  "specification declares COMPILED + FROZEN / NOT ALLOWLISTED / NOT DEPLOYED with L1 policy closed",
);
check(
  "L2D-A5",
  /POLICY CLOSED \/ EXECUTION PREREQUISITES PENDING/.test(planSrc) &&
    /PCART-L2 Phase 2 — reproducible compile \+ frozen artifact \(COMPLETE, repo-only\)/.test(
      planSrc,
    ) &&
    /PCART-L2 Phase 3 — exact-artifact testnet rehearsal/.test(planSrc),
  "master plan records L1 policy closed, L2 Phase 2 complete and Phase 3 rehearsal next",
);
check(
  "L2D-A6",
  read(FROZEN_TS).length > 0 &&
    read(FROZEN_INPUT).length > 0 &&
    read(FROZEN_MANIFEST).length > 0,
  "frozen artifact, canonical compiler input and manifest all exist",
);


// --------------------------------------------- B/C. pragma, imports, base
check("L2D-B1", /^pragma solidity 0\.8\.36;$/m.test(draft), "exact pragma solidity 0.8.36");
const imports = draft.match(/^\s*import .*$/gm) ?? [];
check(
  "L2D-B2",
  imports.length === 1 &&
    /@openzeppelin\/contracts\/token\/ERC20\/ERC20\.sol/.test(imports[0]!),
  "sole import is the OpenZeppelin ERC20 reference implementation",
);
check("L2D-B3", /^\/\/ SPDX-License-Identifier: MIT$/m.test(draftRaw), "SPDX MIT header present");
check(
  "L2D-C1",
  /contract PepeCartelToken is ERC20 \{/.test(draft) &&
    (draft.match(/\bis\s+[A-Za-z0-9_,\s]+\{/g) ?? []).length === 1,
  "contract PepeCartelToken extends ERC20 and nothing else",
);

// --------------------------------------------------- D/E/F. identity & supply
check(
  "L2D-D1",
  /ERC20\("PEPECARTEL", "PCART"\)/.test(draft),
  'name/symbol hard-coded as "PEPECARTEL" / "PCART"',
);
check(
  "L2D-D2",
  !/string memory name_|string memory symbol_/.test(draft),
  "name and symbol are not constructor-supplied",
);
check(
  "L2D-E1",
  /uint256 public constant INITIAL_SUPPLY = 1_000_000_000 \* 10 \*\* 18;/.test(draft),
  "INITIAL_SUPPLY is exactly 1_000_000_000 * 10 ** 18",
);
check(
  "L2D-F1",
  !/function decimals\s*\(/.test(draft),
  "decimals() is not overridden — inherited ERC20 default of 18",
);

// ------------------------------------------------------- G. constructor shape
const ctor = draft.match(/constructor\s*\(([^)]*)\)([\s\S]*?)\n\}/);
check("L2D-G1", ctor !== null, "constructor is present and parseable");
check(
  "L2D-G2",
  (ctor?.[1] ?? "").trim() === "address treasury_",
  "constructor takes exactly one argument: address treasury_",
);
check(
  "L2D-G3",
  /error ZeroTreasury\(\);/.test(draft) &&
    /if \(treasury_ == address\(0\)\) revert ZeroTreasury\(\);/.test(draft),
  "zero-address treasury reverts with ZeroTreasury()",
);
const mints = draft.match(/_mint\s*\(/g) ?? [];
check(
  "L2D-G4",
  mints.length === 1 && /_mint\(treasury_, INITIAL_SUPPLY\);/.test(ctor?.[2] ?? ""),
  "exactly one _mint call, inside the constructor, to treasury_ for INITIAL_SUPPLY",
);
const fns = draft.match(/^\s*function\s+/gm) ?? [];
check("L2D-G5", fns.length === 0, "no functions beyond inherited standard ERC-20 behavior");

// ------------------------------------------------ H. forbidden capability scan
const FORBIDDEN: Array<[string, RegExp]> = [
  ["Ownable", /\bOwnable\b/],
  ["AccessControl", /\bAccessControl\b/],
  ["onlyOwner", /\bonlyOwner\b/],
  ["roles/admin", /\b(_?grantRole|hasRole|DEFAULT_ADMIN_ROLE|owner\(\)|transferOwnership)\b/],
  ["post-construction mint API", /\bfunction\s+\w*[Mm]int\w*\s*\(/],
  ["custom burn path", /\b(_burn|function\s+\w*[Bb]urn\w*\s*\()/],
  ["pause", /\b(Pausable|_pause|whenNotPaused|paused\(\))\b/],
  ["tax/fee", /\b(tax|fee|Fee|Tax)\w*\b/],
  ["blacklist/freeze/whitelist", /\b(blacklist|blackList|whitelist|whiteList|freeze|frozen)\w*\b/i],
  ["trading toggle/cooldown", /\b(tradingEnabled|enableTrading|cooldown)\w*\b/i],
  ["maxWallet/maxTx", /\b(maxWallet|maxTx|maxTransaction)\w*\b/i],
  ["permit", /\b(ERC20Permit|permit\s*\()/],
  ["initializer/upgrade/proxy", /\b(initializer|initialize\s*\(|UUPS|Upgradeable|Proxy|_authorizeUpgrade)\b/],
  ["delegatecall", /\bdelegatecall\b/],
  ["selfdestruct", /\bselfdestruct\b/],
  ["immutable state", /\bimmutable\b/],
  ["transfer-hook override", /\bfunction\s+(_update|_beforeTokenTransfer|_afterTokenTransfer)\s*\(/],
];
for (const [label, re] of FORBIDDEN) {
  check(`L2D-H:${label}`, !re.test(draft), `draft contains no ${label}`);
}

// ------------------------------------------------- I. non-activation tripwires
const srcFiles = walk(SRC);
const migrationFiles = walk(MIGRATIONS);
/**
 * PCART-L3 superseded the Phase 2 "referenced nowhere" isolation: the frozen
 * artifact is now consumed by an exact, closed set of TESTNET-rehearsal files.
 * Any new reference outside this set still fails.
 */
const PCART_L3_CONSUMERS = [
  FROZEN_TS,
  "src/lib/launch-artifact-registry.ts",
  "src/lib/pcart-rehearsal.ts",
  "src/lib/chain-verify.functions.ts",
  "src/routes/_authenticated/chain-launcher.tsx",
].map((p) => join(p));
const srcHits = srcFiles.filter((f) => /pepecartel-token-v1/.test(readFileSync(f, "utf8")));
const migHits = migrationFiles.filter((f) => /pepecartel-token-v1/.test(readFileSync(f, "utf8")));
check(
  "L2D-I1",
  srcHits.length > 0 && srcHits.every((f) => PCART_L3_CONSUMERS.includes(f)),
  `pepecartel-token-v1 appears only in the closed PCART-L3 consumer set (${srcFiles.length} scanned, hits: ${srcHits.join(", ") || "none"})`,
);
check(
  "L2D-I2",
  migHits.length === 0,
  `pepecartel-token-v1 appears in no applied supabase/migrations/** file (${migrationFiles.length} scanned)`,
);
const nameHits = srcFiles.filter(
  (f) => f !== FROZEN_TS && /PepeCartelToken/.test(readFileSync(f, "utf8")),
);
check(
  "L2D-I3",
  nameHits.length === 0,
  "no src/** file outside the frozen artifact references PepeCartelToken",
);

check(
  "L2D-I3b",
  srcFiles
    .filter((f) => !PCART_L3_CONSUMERS.includes(f))
    .every((f) => !/pepecartel[-_]token|PEPECARTEL_TOKEN_/i.test(readFileSync(f, "utf8"))),
  "only the closed PCART-L3 consumer set imports or references the frozen PCART artifact",
);

check(
  "L2D-I4",
  /export const APPROVED_OFFICIAL_ARTIFACT_ID = "cartel-fixed-erc20-v1" as const;/.test(
    evidenceSrc,
  ) && !/pepecartel/i.test(evidenceSrc),
  "official artifact allowlist still approves exactly cartel-fixed-erc20-v1",
);
check(
  "L2D-I5",
  /export const CARTEL_FIXED_ERC20_ARTIFACT_ID = "cartel-fixed-erc20-v1" as const;/.test(
    artifactSrc,
  ),
  "generic artifact id constant unchanged",
);
check(
  "L2D-I6",
  artifactSrc.includes(
    '"0xa51f9b78b76d822256b9c3ca3028e508ea61a8630d54c889e4d638fae33e8337" as const',
  ) &&
    artifactSrc.includes(
      '"0xcac530c4300d48804d9707b87f0ab52e91ba7b2ced97bc84e5a377ae702c10c0" as const',
    ),
  "generic creation and runtime bytecode hashes unchanged",
);
/** Exactly THREE post-gate migrations are authorized (Phase 1 + Phase 2B x2). */
const L2D_LAST_GATE_MIGRATION = "20260920054150_5dcb8ca1-aba1-4c9b-995e-cd9ff00da488.sql";
const L2D_PHASE1_MIGRATION = "20260922070921_40548af2-4afe-4876-bcaa-f22868f5942d.sql";
/** Second authorized post-gate migration: Phase 2B mission safety. */
const L2D_PHASE2B_MIGRATION = "20260922141917_c47c2384-73c4-4bbf-8cc2-495112d64990.sql";
/** Third and last: the Phase 2B corrective duration-resolution migration. */
const L2D_PHASE2B_DURATION_MIGRATION = "20260922142803_fedec44c-654f-4e1a-a117-30d027601e03.sql";
/** Fourth and last: the Project Identity Gate A function-only migration. */
const L2D_IDENTITY_GATE_MIGRATION = "20260922161918_ef6e322a-d993-4970-9d48-3b4f93afa222.sql";
/** Fifth and last: the Commercial Foundation A migration. */
const L2D_COMMERCIAL_A_MIGRATION = "20260923170038_eaa2a24d-9c13-49c9-9aa3-6a5a8e18c300.sql";
/** Sixth and last: the Commercial Foundation B function-only guard migration. */
const L2D_COMMERCIAL_B_MIGRATION = "20260924005521_b9fca846-4db3-4e8f-bf91-bdb4bd863228.sql";
const l2dMigrationNames = migrationFiles
  .map((f) => f.replace(/\\/g, "/").split("/").pop() ?? f)
  .sort();
const l2dPostGate = l2dMigrationNames.filter((f) => f > L2D_LAST_GATE_MIGRATION);
check(
  "L2D-I7",
  migrationFiles.length === 91 &&
    l2dMigrationNames.includes("20260920053942_42259f41-35d1-4b5c-9e6a-78127867cddd.sql") &&
    l2dMigrationNames.includes(L2D_LAST_GATE_MIGRATION) &&
    l2dPostGate.length === 7 &&
    l2dPostGate[0] === L2D_PHASE1_MIGRATION &&
    l2dPostGate[1] === L2D_PHASE2B_MIGRATION &&
    l2dPostGate[2] === L2D_PHASE2B_DURATION_MIGRATION &&
    l2dPostGate[3] === L2D_IDENTITY_GATE_MIGRATION &&
    l2dPostGate[4] === L2D_COMMERCIAL_A_MIGRATION &&
    l2dPostGate[5] === L2D_COMMERCIAL_B_MIGRATION &&
    l2dPostGate[6] === "20260924021801_e48c0c41-9053-4f77-a267-04fbba8d206d.sql" &&
    migrationFiles.every((f) => !/PepeCartelToken/.test(readFileSync(f, "utf8"))) &&
    !migrationFiles.some((f) => /pepecartel[-_]?token|pcart[-_]?artifact/i.test(f)),
  `migration set re-pinned (91 files) with exactly seven authorized post-gate migrations, the Cost Accounting Phase 1, Phase 2B safety, Phase 2B corrective duration, Project Identity Gate A, Commercial Foundation A, Commercial Foundation B and Stripe/Free billing files; none reference the draft PCART token artifact (post-gate: ${l2dPostGate.join(", ") || "none"})`,
);
check(
  "L2D-I8",
  /MAINNET_LIQUIDITY_TX_ENABLED = false as const/.test(registrySrc),
  "MAINNET_LIQUIDITY_TX_ENABLED remains false",
);
check(
  "L2D-I9",
  read("src/lib/chain-mainnet-simulation.ts").includes("CARTEL_FIXED_ERC20_ARTIFACT_ID") &&
    read("src/lib/chain-mainnet-presign.helpers.ts").includes("CARTEL_FIXED_ERC20_ARTIFACT_ID") &&
    read("src/lib/chain-mainnet-handoff.functions.ts").includes("CARTEL_FIXED_ERC20_ARTIFACT_ID"),
  "mainnet deployment path still binds the cartel-fixed-erc20-v1 artifact",
);
check(
  "L2D-I10",
  read(GENERIC_SOL).includes("contract CartelFixedSupplyToken is ERC20"),
  "generic testnet contract source untouched",
);

// --------------------------------------------- J. Phase 3 gate / spec wording
check(
  "L2D-J1",
  /Phase 3 — exact-artifact testnet rehearsal — is mandatory next/.test(specSrc) &&
    !/Phase 2 is blocked until PCART-L1 is explicitly closed/.test(specSrc),
  "specification states Phase 3 exact-artifact testnet rehearsal is mandatory next",
);
check(
  "L2D-J2",
  /\*\*`pepecartel-token-v1`\*\*/.test(specSrc) &&
    /NOT production-allowlisted, NOT deployed/.test(specSrc),
  "specification names the frozen artifact id while declaring it not allowlisted and not deployed",
);

check(
  "L2D-J3",
  /solc \| `0\.8\.36\+commit\.8a079791`/.test(specSrc) &&
    /`5\.6\.1`/.test(specSrc) &&
    /runs 200/.test(specSrc) &&
    /viaIR \| false/.test(specSrc) &&
    /`paris`/.test(specSrc) &&
    /bytecodeHash \| `none`/.test(specSrc) &&
    /appendCBOR \| false/.test(specSrc),
  "specification pins the intended Phase 2 reproducible compiler settings",
);
check(
  "L2D-J4",
  /deliberately undetermined/.test(specSrc) && /2-of-3 Safe/.test(specSrc),
  "specification records the treasury recipient as intentionally unresolved",
);

console.log(failures === 0 ? "\nALL CHECKS PASSED" : `\n${failures} CHECK(S) FAILED`);
process.exit(failures === 0 ? 0 : 1);
