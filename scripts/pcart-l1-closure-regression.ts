/**
 * PCART-L1 Closure Pack regression.
 *
 * PURE SOURCE/STATIC assertions only. No network, no RPC, no wallet, no
 * database, no compilation, no environment value is read. This suite proves:
 *   1. the L1 closure pack, compatibility manifest and comms policy record the
 *      authorized policy decisions exactly; and
 *   2. closing L1 POLICY activated nothing — no external address leaked into
 *      runtime code, no artifact allowlist widened, no Safe/treasury address
 *      was invented, and every existing production safety value is untouched.
 */
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";

const PACK = "docs/PCART_L1_CLOSURE_PACK.md";
const MANIFEST = "docs/PCART_L1_CHAIN_COMPATIBILITY_MANIFEST.md";
const COMMS = "docs/PCART_L1_COMMS_RULES.md";
const PLAN = "docs/PCART_MASTER_LAUNCH_PLAN.md";
const EVIDENCE = "src/lib/launch-evidence-checks.ts";
const ARTIFACT = "src/lib/cartel-fixed-erc20.artifact.ts";
const REGISTRY = "src/lib/chain-mainnet-registry.ts";
const MIGRATIONS = "supabase/migrations";

const read = (p: string) => readFileSync(p, "utf8");

const packSrc = read(PACK);
const manifestSrc = read(MANIFEST);
const commsSrc = read(COMMS);
const planSrc = read(PLAN);
const evidenceSrc = read(EVIDENCE);
const artifactSrc = read(ARTIFACT);
const registrySrc = read(REGISTRY);
const docsSrc = packSrc + manifestSrc + commsSrc;

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

// ------------------------------------- 1. existence, version, status markers
check("L1C-1a", packSrc.length > 0, "L1 closure pack exists");
check("L1C-1b", manifestSrc.length > 0, "chain compatibility manifest exists");
check("L1C-1c", commsSrc.length > 0, "internal comms rules exist");
check(
  "L1C-1d",
  /PCART-L1 POLICY CLOSED \/ EXECUTION PREREQUISITES PENDING/.test(packSrc) &&
    /Version: \*\*v1\*\*/.test(packSrc) &&
    /Date: \*\*2026-09-20\*\*/.test(packSrc),
  "closure pack declares v1 / 2026-09-20 / POLICY CLOSED + EXECUTION PREREQUISITES PENDING",
);
check(
  "L1C-1e",
  /Manifest version: \*\*v1\*\*/.test(manifestSrc) &&
    /Manifest date: \*\*2026-09-20\*\*/.test(manifestSrc) &&
    /NOT TRANSACTION AUTHORIZATION/.test(manifestSrc),
  "manifest declares v1 / 2026-09-20 / not transaction authorization",
);
check(
  "L1C-1f",
  /Version: \*\*v1\*\*/.test(commsSrc) && /POLICY CLOSED \(internal communications policy only\)/.test(commsSrc),
  "comms policy declares v1 and internal-only POLICY CLOSED status",
);
check(
  "L1C-1g",
  /launch-ready/.test(packSrc) &&
    /does \*\*not\*\* mean PCART is launch-ready, execution-ready, or mainnet-ready/.test(packSrc),
  "closure pack explicitly denies launch/execution/mainnet readiness",
);

// ------------------------------------------------- 2. operational ETH policy
check(
  "L1C-2a",
  /Frozen operational gas reserve: 0\.10 ETH/.test(packSrc) &&
    /\*\*separate from liquidity \/ CCA auction funding\*\*/.test(packSrc),
  "0.10 ETH operational gas reserve is frozen and separate from liquidity/CCA funding",
);
check(
  "L1C-2b",
  /at least 0\.05 ETH immediately available/.test(packSrc) &&
    /before any mainnet PCART deployment or launch execution action/.test(packSrc),
  "0.05 ETH execution-wallet floor is required before mainnet execution",
);
check(
  "L1C-2c",
  /budget guardrails, NOT gas-price predictions and NOT authorization to spend/.test(packSrc),
  "reserve figures are stated as budget guardrails, not predictions or spend authority",
);
check(
  "L1C-2d",
  /Live gas estimation remains mandatory at execution time/.test(packSrc) &&
    /plus a substantial safety margin/.test(packSrc) &&
    /necessary, never sufficient/.test(packSrc),
  "live gas estimation plus safety margin remains mandatory; floor is not sufficient",
);
check(
  "L1C-2e",
  /No runtime balance gate is added/.test(packSrc),
  "reserve policy is documentation-only; no runtime balance gate introduced",
);

// ----------------------------------------------- 3. Safe architecture policy
const SAFE_SINGLETON = "0x29fcB43b46531BcA003ddC8FCB67FFE91900C762";
const SAFE_SINGLETON_CODEHASH =
  "0xb1f926978a0f44a2c0ec8fe822418ae969bd8c3f18d61e5103100339894f81ff";
const SAFE_FACTORY = "0x4e1DCf7AD4e460CfD30791CCC4F9c8a4f820ec67";
const SAFE_FACTORY_CODEHASH =
  "0x50c3cdc4074750a7a974204a716c999edd37482f907608d960b2b025ee0b3317";

check(
  "L1C-3a",
  /Safe v1\.4\.1 SafeL2 \+ SafeProxyFactory\*\* on Robinhood Chain \*\*4663\*\*/.test(packSrc) &&
    /exactly 3 unique non-zero owners\*\* and \*\*threshold 2\*\*/.test(packSrc),
  "frozen treasury implementation is Safe v1.4.1 SafeL2 + SafeProxyFactory, 3 owners, threshold 2",
);
check(
  "L1C-3b",
  [SAFE_SINGLETON, SAFE_SINGLETON_CODEHASH, SAFE_FACTORY, SAFE_FACTORY_CODEHASH].every(
    (v) => packSrc.includes(v) && manifestSrc.includes(v),
  ),
  "canonical SafeL2 + SafeProxyFactory addresses and code hashes recorded in documentation",
);
check(
  "L1C-3c",
  /The actual PEPECARTEL Safe does not exist/.test(packSrc) &&
    /Signer addresses are unresolved, the Safe address is unresolved, and no PCART treasury recipient is fixed/.test(
      packSrc,
    ),
  "pack states no Safe, no signers and no PCART recipient exist",
);
check(
  "L1C-3d",
  /the verifier was not modified in that earlier closure unit/.test(packSrc) &&
    /### 2\.2 Hardening status update/.test(packSrc),
  "historical closure snapshot preserved alongside the later hardening status update",
);

// -------------------- 4. stronger Safe verification: BUILT vs still PENDING
const builtSafeChecks: Array<[string, RegExp]> = [
  ["singleton", /\*\*BUILT\*\* — singleton \/ masterCopy must equal the canonical SafeL2/],
  ["proxy code hash", /\*\*BUILT\*\* — proxy runtime code hash must match/],
  ["strict VERSION", /\*\*BUILT\*\* — `VERSION\(\)` must be readable and exactly `1\.4\.1`/],
  ["no modules", /\*\*BUILT\*\* — modules must be empty/],
  ["zero guard", /\*\*BUILT\*\* — guard must be zero \/ unset/],
  ["readable nonce", /\*\*BUILT\*\* — `nonce\(\)` must be readable/],
  ["threshold 2", /\*\*BUILT\*\* — threshold must be exactly 2/],
];
for (const [label, re] of builtSafeChecks) {
  check(`L1C-4 ${label}`, re.test(packSrc), `stronger Safe verification item is BUILT: ${label}`);
}
check(
  "L1C-4 exact owners",
  /\*\*PENDING\*\* — owners must exactly match the selected 3 signer addresses/.test(packSrc),
  "exact selected owner-address match remains PENDING",
);
check(
  "L1C-4y",
  /Still PENDING:\*\* live validation against the future actual PEPECARTEL Safe/.test(packSrc) &&
    /remains non-gating/.test(packSrc) &&
    /not\*\* a PEPECARTEL treasury approval/.test(packSrc),
  "live validation stays PENDING and the hardened verifier stays non-gating and non-approving",
);
check(
  "L1C-4z",
  /Fail closed on any ambiguity, unreadable read, or mismatch/.test(packSrc),
  "stronger Safe verification fails closed on ambiguity",
);


// ------------------------------------------------- 5. compatibility manifest
const EXTERNAL_ADDRESSES = [
  "0x0000FffFBE8efE702c8703aE3477FF5dE3d319C0",
  "0xbf1aB81f7d534b2CC0Da76fcf4d541322bB0e000",
  "0x000000001F26a0044BaA66024e7b6599c61963F8",
  "0x4F5E3FBb9745358A92Da5674305FAb8D2B8a73cE",
  "0x000000000022D473030F116dDEE9F6B43aC78BA3",
  "0x1242c9439d589cAE85E121B1f79f2aF51e91DCEE",
];
check(
  "L1C-5a",
  EXTERNAL_ADDRESSES.every((a) => manifestSrc.includes(a)),
  "manifest records LiquidityLauncher, LBPStrategy, CCA factory, TokenSplitter, Permit2 and UniversalRouterStrategy",
);
check(
  "L1C-5b",
  /chain ID \| `4663`/.test(manifestSrc) && /testnet chain ID \| `46630`/.test(manifestSrc),
  "manifest records mainnet 4663 and testnet 46630",
);
check(
  "L1C-5c",
  (manifestSrc.match(/RESEARCHED \/ NOT ON-CHAIN VERIFIED BY CARTEL HQ IN THIS UNIT/g) ?? []).length >= 3,
  "every external address block is labelled RESEARCHED / NOT ON-CHAIN VERIFIED",
);
check(
  "L1C-5d",
  /Mandatory pre-L5 revalidation/.test(manifestSrc) &&
    /Any mismatch — address, code hash, version, or ownership — blocks execution\. Fail closed/.test(
      manifestSrc,
    ),
  "manifest requires pre-L5 revalidation and fails closed on mismatch",
);
check(
  "L1C-5e",
  /changed multiple times during 2026/.test(manifestSrc),
  "manifest records that addresses changed during 2026",
);
check(
  "L1C-5f",
  /Fee-on-transfer and rebasing tokens are unsupported by LiquidityLauncher/.test(manifestSrc) &&
    /Permit2 \+ `depositToken` \+ `distributeToken` within one LiquidityLauncher multicall/.test(
      manifestSrc,
    ),
  "manifest records existing-token flow and fee-on-transfer incompatibility",
);

// -------------------------------- 6. no external address leaks into the code
const PROTECTED_ROOTS = ["src", "supabase", "contracts", "docs/sql"];
const LEAK_CANDIDATES = [
  SAFE_SINGLETON,
  SAFE_SINGLETON_CODEHASH,
  SAFE_FACTORY,
  SAFE_FACTORY_CODEHASH,
  ...EXTERNAL_ADDRESSES,
];
/**
 * NARROW, EXPLICITLY AUTHORIZED EXCEPTION. The read-only canonical Safe v1.4.1
 * verifier must pin Safe identity constants to compare against. Exactly ONE
 * runtime file may carry exactly these values. Every other candidate value,
 * and every other file, stays forbidden.
 */
const SAFE_PIN_EXCEPTION_FILE = "src/lib/treasury-safe-verify.ts";
const SAFE_PIN_EXCEPTION_VALUES = new Set(
  [SAFE_SINGLETON, SAFE_SINGLETON_CODEHASH].map((v) => v.toLowerCase()),
);
const protectedFiles = PROTECTED_ROOTS.flatMap((root) => walk(root));
const leaks: string[] = [];
for (const file of protectedFiles) {
  const body = readFileSync(file, "utf8").toLowerCase();
  const normalized = file.replace(/\\/g, "/");
  for (const value of LEAK_CANDIDATES) {
    if (!body.includes(value.toLowerCase())) continue;
    const excepted =
      normalized === SAFE_PIN_EXCEPTION_FILE && SAFE_PIN_EXCEPTION_VALUES.has(value.toLowerCase());
    if (!excepted) leaks.push(`${file}:${value}`);
  }
}
check(
  "L1C-6",
  leaks.length === 0,
  `no Safe/Uniswap manifest address appears under src/**, supabase/**, contracts/** or docs/sql/** outside the single verifier pin exception (${leaks.join(", ") || "none"})`,
);
const verifierSrc = readFileSync(SAFE_PIN_EXCEPTION_FILE, "utf8");
check(
  "L1C-6b",
  verifierSrc.includes(SAFE_SINGLETON) &&
    verifierSrc.includes(
      "0xd7d408ebcd99b2b70be43e20253d6d92a8ea8fab29bd3be7f55b10032331fb4c",
    ) &&
    !verifierSrc.toLowerCase().includes(SAFE_FACTORY.toLowerCase()) &&
    !EXTERNAL_ADDRESSES.some((a) => verifierSrc.toLowerCase().includes(a.toLowerCase())),
  "the single excepted verifier pins the canonical singleton and SafeProxy code hash and nothing else",
);


// -------------------------------------------------- 7. internal comms policy
check(
  "L1C-7a",
  /public onchain token sale\/auction/.test(commsSrc) &&
    /\*\*Do not claim it is a "no sale"\*\*/.test(commsSrc),
  "comms policy forbids the 'no sale' framing",
);
check(
  "L1C-7b",
  /No guaranteed return, profit, price, valuation, yield, or fundraising-success claims/.test(commsSrc),
  "comms policy forbids guaranteed return/profit/price claims",
);
check(
  "L1C-7c",
  /Do not imply Robinhood approved, endorsed, listed, sponsored, or partnered with PCART/.test(
    commsSrc,
  ) && /Deploying on Robinhood Chain is not a listing/.test(commsSrc),
  "comms policy forbids Robinhood endorsement/listing implication",
);
check(
  "L1C-7d",
  /Do not announce PCART as LIVE\*\*/.test(commsSrc) &&
    /verified mainnet deployment/.test(commsSrc) &&
    /managed finality/.test(commsSrc) &&
    /source verification/.test(commsSrc) &&
    /official contract registration/i.test(commsSrc) &&
    /independently verified liquidity\/trading readiness/.test(commsSrc),
  "comms policy blocks a LIVE claim until every readiness evidence item is complete",
);

// ------------------------------------------------ 8. no legal-approval claim
const LEGAL_CLAIM =
  /(legal (counsel|compliance)? ?(approval|approved|sign-?off) (obtained|complete|received)|reviewed by (legal )?counsel|legally compliant|compliance approved)/i;
check(
  "L1C-8a",
  !LEGAL_CLAIM.test(docsSrc),
  "pack, manifest and comms policy claim no legal counsel or compliance approval",
);
check(
  "L1C-8b",
  /NOT legal advice and NOT legal or compliance approval/.test(commsSrc) &&
    /External legal review, if the owner requires it, remains a separate owner-side prerequisite/.test(
      commsSrc,
    ),
  "comms policy names external legal review as a separate owner-side prerequisite",
);

// ------------------------------------------------- 9. L1-e1 / L1-e2 sequencing
check(
  "L1C-9a",
  /L1-e1/.test(packSrc) && /L1-e2/.test(packSrc) && /L1-e1/.test(planSrc) && /L1-e2/.test(planSrc),
  "L1-e1 / L1-e2 split recorded in both the closure pack and the master plan",
);
check(
  "L1C-9b",
  /MUST pass on Robinhood testnet 46630 before any PCART mainnet deployment/.test(packSrc) &&
    /Relocated, not waived/.test(packSrc),
  "exact-artifact rehearsal remains mandatory before mainnet and is relocated, not waived",
);
check(
  "L1C-9c",
  /POLICY CLOSED \/ EXECUTION PREREQUISITES PENDING/.test(planSrc),
  "master plan records POLICY CLOSED / EXECUTION PREREQUISITES PENDING",
);

// ------------------------------------------- 10-14. non-activation tripwires
const srcFiles = walk("src");
const migrationFiles = walk(MIGRATIONS);
const FROZEN_PCART_ARTIFACT = "src/lib/pepecartel-token.artifact.ts";
check(
  "L1C-10",
  srcFiles.every(
    (f) =>
      f.replace(/\\/g, "/") === FROZEN_PCART_ARTIFACT ||
      !/pepecartel-token-v1/.test(readFileSync(f, "utf8")),
  ) &&
    readFileSync(FROZEN_PCART_ARTIFACT, "utf8").includes("pepecartel-token-v1") &&
    migrationFiles.every((f) => !/pepecartel-token-v1/.test(readFileSync(f, "utf8"))),
  "`pepecartel-token-v1` appears only in the dedicated frozen artifact src/lib/pepecartel-token.artifact.ts — it remains non-integrated, absent from every other src/** file and from supabase/migrations/**",
);

check(
  "L1C-11",
  /export const APPROVED_OFFICIAL_ARTIFACT_ID = "cartel-fixed-erc20-v1" as const;/.test(
    evidenceSrc,
  ),
  "APPROVED_OFFICIAL_ARTIFACT_ID remains exactly cartel-fixed-erc20-v1",
);
check(
  "L1C-12",
  artifactSrc.includes(
    '"0xa51f9b78b76d822256b9c3ca3028e508ea61a8630d54c889e4d638fae33e8337" as const',
  ) &&
    artifactSrc.includes(
      '"0xcac530c4300d48804d9707b87f0ab52e91ba7b2ced97bc84e5a377ae702c10c0" as const',
    ) &&
    /export const CARTEL_FIXED_ERC20_ARTIFACT_ID = "cartel-fixed-erc20-v1" as const;/.test(
      artifactSrc,
    ),
  "generic artifact id and creation/runtime bytecode hashes unchanged",
);
check(
  "L1C-13",
  /MAINNET_LIQUIDITY_TX_ENABLED = false as const/.test(registrySrc),
  "MAINNET_LIQUIDITY_TX_ENABLED remains false",
);
/**
 * Gate-era migration set ends at the treasury signer policy completion file.
 * Exactly THREE post-gate migrations are authorized: Cost Accounting
 * Phase 1, Phase 2B mission safety and the Phase 2B corrective duration fix.
 */
const L1C_LAST_GATE_MIGRATION = "20260920054150_5dcb8ca1-aba1-4c9b-995e-cd9ff00da488.sql";
const L1C_PHASE1_MIGRATION = "20260922070921_40548af2-4afe-4876-bcaa-f22868f5942d.sql";
/** Second authorized post-gate migration: Phase 2B mission safety. */
const L1C_PHASE2B_MIGRATION = "20260922141917_c47c2384-73c4-4bbf-8cc2-495112d64990.sql";
/** Third and last: the Phase 2B corrective duration-resolution migration. */
const L1C_PHASE2B_DURATION_MIGRATION = "20260922142803_fedec44c-654f-4e1a-a117-30d027601e03.sql";
/** Fourth and last: the Project Identity Gate A function-only migration. */
const L1C_IDENTITY_GATE_MIGRATION = "20260922161918_ef6e322a-d993-4970-9d48-3b4f93afa222.sql";
const l1cMigrationNames = migrationFiles
  .map((f) => f.replace(/\\/g, "/").split("/").pop() ?? f)
  .sort();
const l1cPostGate = l1cMigrationNames.filter((f) => f > L1C_LAST_GATE_MIGRATION);
check(
  "L1C-14",
  migrationFiles.length === 87 &&
    l1cMigrationNames.includes("20260920053942_42259f41-35d1-4b5c-9e6a-78127867cddd.sql") &&
    l1cMigrationNames.includes(L1C_LAST_GATE_MIGRATION) &&
    l1cPostGate.length === 3 &&
    l1cPostGate[0] === L1C_PHASE1_MIGRATION &&
    l1cPostGate[1] === L1C_PHASE2B_MIGRATION &&
    l1cPostGate[2] === L1C_PHASE2B_DURATION_MIGRATION,
  `migration set re-pinned for the treasury signer config plus exactly three authorized post-gate migrations, the Cost Accounting Phase 1, Phase 2B safety and Phase 2B corrective duration files (${migrationFiles.length} files, expected 87; post-gate: ${l1cPostGate.join(", ") || "none"})`,
);

// ----------------------------- 15. no invented treasury / Safe / recipient
/** 20-byte address only: a 32-byte code hash must not match a 40-hex prefix. */
const ADDRESS_RE = /(?<![0-9a-fA-F])0x[0-9a-fA-F]{40}(?![0-9a-fA-F])/g;
/** SENTINEL_MODULES is a Safe protocol constant, never a treasury address. */
const SAFE_SENTINEL_MODULES_DOC = "0x0000000000000000000000000000000000000001";
const KNOWN_DOC_ADDRESSES = new Set(
  [SAFE_SINGLETON, SAFE_FACTORY, SAFE_SENTINEL_MODULES_DOC, ...EXTERNAL_ADDRESSES].map((a) =>
    a.toLowerCase(),
  ),
);
const unexpected = [...docsSrc.matchAll(ADDRESS_RE)]
  .map((m) => m[0].toLowerCase())
  .filter((a) => !KNOWN_DOC_ADDRESSES.has(a));
check(
  "L1C-15",
  unexpected.length === 0,
  `no PCART treasury/Safe/recipient address is recorded (${[...new Set(unexpected)].join(", ") || "none"})`,
);

// ------------------------------------ 16. Phase 2 still separately authorized
check(
  "L1C-16",
  /Phase 2 \(reproducible compilation and freezing of `pepecartel-token-v1`\) still requires separate authorization after this pack/.test(
    packSrc,
  ) && /It is not started here/.test(packSrc),
  "Phase 2 compilation still requires separate authorization and is not started",
);

console.log(failures === 0 ? "\nALL CHECKS PASSED" : `\n${failures} CHECK(S) FAILED`);
process.exit(failures === 0 ? 0 : 1);
