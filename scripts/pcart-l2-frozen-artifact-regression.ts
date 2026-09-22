/**
 * PCART-L2 Phase 2 — frozen artifact integrity regression.
 *
 * PURE STATIC assertions. No network, no RPC, no wallet, no database, no
 * Solidity compilation. This suite independently re-parses the frozen
 * compiler input, the frozen manifest and the frozen TypeScript artifact,
 * recomputes both bytecode hashes, and proves that freezing `pepecartel-token-v1`
 * changed nothing in the production launcher, allowlist or migrations.
 */
import { execFileSync } from "node:child_process";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { keccak256, toBytes } from "viem";

/** Immutable PCART-L2 Phase 2 start gate. */
const START_GATE = "111a983d6da5d0cbab53559700639705b91c67f6";

const SOURCE = "contracts/PepeCartelToken.sol";
const TS_ARTIFACT = "src/lib/pepecartel-token.artifact.ts";
const INPUT_PATH = "artifacts/pepecartel-token-v1.compiler-input.json";
const MANIFEST_PATH = "artifacts/pepecartel-token-v1.manifest.json";
const MIGRATIONS = "supabase/migrations";

const read = (p: string) => readFileSync(p, "utf8");
const atGate = (p: string) =>
  execFileSync("git", ["show", `${START_GATE}:${p}`], { encoding: "utf8" });

const sourceSrc = read(SOURCE);
const tsSrc = read(TS_ARTIFACT);
const inputRaw = read(INPUT_PATH);
const manifestRaw = read(MANIFEST_PATH);
const input = JSON.parse(inputRaw) as {
  language: string;
  sources: Record<string, { content: string }>;
  settings: Record<string, unknown>;
};
const manifest = JSON.parse(manifestRaw) as Record<string, any>;

let failures = 0;
function check(id: string, ok: boolean, detail: string) {
  if (ok) console.log(`PASS ${id} — ${detail}`);
  else {
    failures += 1;
    console.error(`FAIL ${id} — ${detail}`);
  }
}

function walk(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) out.push(...walk(full));
    else out.push(full);
  }
  return out;
}

const pick = (re: RegExp) => tsSrc.match(re)?.[1] ?? "";

// ------------------------------------------------------ A. identity & presence
check("L2F-A1", inputRaw.length > 0 && manifestRaw.length > 0 && tsSrc.length > 0, "frozen compiler input, manifest and TypeScript artifact all exist");
check(
  "L2F-A2",
  /export const PEPECARTEL_TOKEN_ARTIFACT_ID = "pepecartel-token-v1" as const;/.test(tsSrc) &&
    manifest.artifactId === "pepecartel-token-v1",
  "artifact id is exactly pepecartel-token-v1 in both the TS artifact and the manifest",
);
check(
  "L2F-A3",
  manifest.source?.path === SOURCE && manifest.source?.contractName === "PepeCartelToken",
  "manifest points at contracts/PepeCartelToken.sol / PepeCartelToken",
);

// -------------------------------------------------- B. compiler reproducibility
const SOLC_FULL = "0.8.36+commit.8a079791.Emscripten.clang";
check(
  "L2F-B1",
  manifest.compiler?.solcVersion === SOLC_FULL && tsSrc.includes(`solcVersion: "${SOLC_FULL}"`),
  `solc pinned to ${SOLC_FULL}`,
);
check(
  "L2F-B2",
  manifest.compiler?.openZeppelinVersion === "5.6.1" &&
    tsSrc.includes('openZeppelinVersion: "5.6.1"'),
  "OpenZeppelin Contracts pinned to 5.6.1",
);
const s = manifest.compiler?.settings ?? {};
check(
  "L2F-B3",
  s.optimizer?.enabled === true &&
    s.optimizer?.runs === 200 &&
    s.viaIR === false &&
    s.evmVersion === "paris" &&
    s.metadata?.bytecodeHash === "none" &&
    s.metadata?.appendCBOR === false,
  "manifest settings: optimizer on runs 200, viaIR false, paris, bytecodeHash none, appendCBOR false",
);
const ci = input.settings as any;
check(
  "L2F-B4",
  input.language === "Solidity" &&
    ci.optimizer?.enabled === true &&
    ci.optimizer?.runs === 200 &&
    ci.viaIR === false &&
    ci.evmVersion === "paris" &&
    ci.metadata?.bytecodeHash === "none" &&
    ci.metadata?.appendCBOR === false,
  "canonical standard-JSON input carries the identical compiler settings",
);
check(
  "L2F-B5",
  tsSrc.includes("optimizer: { enabled: true, runs: 200 }") &&
    tsSrc.includes("viaIR: false") &&
    tsSrc.includes('evmVersion: "paris"') &&
    tsSrc.includes('metadataBytecodeHash: "none"') &&
    tsSrc.includes("metadataAppendCBOR: false"),
  "TypeScript artifact records the identical compiler settings",
);

// --------------------------------------------------- C. self-contained sources
const sourceKeys = Object.keys(input.sources);
check(
  "L2F-C1",
  sourceKeys.includes(SOURCE) &&
    sourceKeys.every((k) => k === SOURCE || k.startsWith("@openzeppelin/contracts/")),
  `compiler input holds only the token source and OpenZeppelin units (${sourceKeys.length} units)`,
);
check(
  "L2F-C2",
  input.sources[SOURCE]!.content === sourceSrc,
  "compiler input content for contracts/PepeCartelToken.sol matches the tracked file byte-for-byte",
);
check(
  "L2F-C3",
  sourceKeys.every((k) => (input.sources[k]!.content ?? "").length > 0) &&
    !/"urls"/.test(inputRaw) &&
    !/\/tmp\/|\/dev-server\/|\/home\/|\/Users\//.test(inputRaw),
  "every source unit is inlined; no urls entry and no local absolute paths",
);
check(
  "L2F-C4",
  JSON.stringify(sourceKeys) === JSON.stringify([...sourceKeys].sort()),
  "source unit ordering is deterministic (sorted)",
);
check(
  "L2F-C5",
  manifest.compiler?.sourceUnitCount === sourceKeys.length,
  `manifest source unit count matches the compiler input (${sourceKeys.length})`,
);
check(
  "L2F-C6",
  manifest.source?.keccak256 === keccak256(toBytes(sourceSrc)),
  "manifest source keccak256 matches the tracked source file",
);
check(
  "L2F-C7",
  manifest.compiler?.standardJsonInputKeccak256 === keccak256(toBytes(inputRaw)) &&
    tsSrc.includes(keccak256(toBytes(inputRaw))),
  "compiler-input keccak256 in manifest and TS artifact matches the tracked input file",
);

// ------------------------------------------------------------- D. ABI contract
const abiMatch = tsSrc.match(/PEPECARTEL_TOKEN_ABI = ([\s\S]*?) as const;/);
const abi = JSON.parse(abiMatch?.[1] ?? "[]") as any[];
const ctor = abi.find((e) => e.type === "constructor");
check(
  "L2F-D1",
  !!ctor &&
    ctor.inputs.length === 1 &&
    ctor.inputs[0].type === "address" &&
    ctor.inputs[0].name === "treasury_",
  "ABI constructor is exactly (address treasury_)",
);
const fnNames = abi.filter((e) => e.type === "function").map((e) => e.name).sort();
check(
  "L2F-D2",
  JSON.stringify(fnNames) ===
    JSON.stringify([
      "INITIAL_SUPPLY",
      "allowance",
      "approve",
      "balanceOf",
      "decimals",
      "name",
      "symbol",
      "totalSupply",
      "transfer",
      "transferFrom",
    ]),
  `ABI exposes exactly the inherited ERC-20 surface plus INITIAL_SUPPLY (${fnNames.join(", ")})`,
);
check(
  "L2F-D3",
  abi.some((e) => e.type === "error" && e.name === "ZeroTreasury"),
  "ABI declares error ZeroTreasury()",
);
check(
  "L2F-D4",
  abi.filter((e) => e.type === "event").map((e) => e.name).sort().join(",") ===
    "Approval,Transfer",
  "ABI events are exactly Transfer and Approval",
);
check(
  "L2F-D5",
  !abi.some((e) =>
    /mint|burn|pause|owner|role|blacklist|whitelist|permit|upgrade|tax|fee/i.test(e.name ?? ""),
  ),
  "ABI exposes no mint, burn, pause, owner, role, permit, upgrade or fee surface",
);
check(
  "L2F-D6",
  tsSrc.includes("PEPECARTEL_TOKEN_CONSTRUCTOR_INPUTS = [\n  { type: \"address\", name: \"treasury_\" },\n] as const;"),
  "TypeScript constructor input shape is exactly [{ type: address, name: treasury_ }]",
);

// -------------------------------------------------- E. identity, supply, decimals
check(
  "L2F-E1",
  manifest.token?.name === "PEPECARTEL" &&
    manifest.token?.symbol === "PCART" &&
    manifest.token?.decimals === 18 &&
    manifest.token?.totalSupplyBaseUnits === "1000000000000000000000000000" &&
    manifest.token?.supplyFixed === true,
  "manifest token identity: PEPECARTEL / PCART / 18 decimals / fixed 1e9 * 1e18",
);
check(
  "L2F-E2",
  tsSrc.includes("PEPECARTEL_TOKEN_DECIMALS = 18 as const") &&
    tsSrc.includes('PEPECARTEL_TOKEN_NAME = "PEPECARTEL" as const') &&
    tsSrc.includes('PEPECARTEL_TOKEN_SYMBOL = "PCART" as const') &&
    tsSrc.includes("PEPECARTEL_TOKEN_TOTAL_SUPPLY = 1_000_000_000n * 10n ** 18n"),
  "TypeScript artifact pins name, symbol, 18 decimals and the fixed supply",
);
check(
  "L2F-E3",
  /ERC20\("PEPECARTEL", "PCART"\)/.test(sourceSrc) &&
    /uint256 public constant INITIAL_SUPPLY = 1_000_000_000 \* 10 \*\* 18;/.test(sourceSrc) &&
    !/function decimals\s*\(/.test(sourceSrc),
  "frozen source hard-codes name/symbol, the fixed supply constant, and does not override decimals()",
);

// ---------------------------------------------------------- F. bytecode + hashes
const creation = pick(/PEPECARTEL_TOKEN_CREATION_BYTECODE =\s*"(0x[0-9a-f]*)" as const;/);
const runtime = pick(/PEPECARTEL_TOKEN_RUNTIME_BYTECODE =\s*"(0x[0-9a-f]*)" as const;/);
const creationHash = pick(
  /PEPECARTEL_TOKEN_CREATION_BYTECODE_KECCAK256 =\s*"(0x[0-9a-f]{64})" as const;/,
);
const runtimeHash = pick(
  /PEPECARTEL_TOKEN_RUNTIME_BYTECODE_KECCAK256 =\s*"(0x[0-9a-f]{64})" as const;/,
);
check(
  "L2F-F1",
  /^0x[0-9a-f]+$/.test(creation) &&
    creation.length > 2 &&
    (creation.length - 2) % 2 === 0,
  `creation bytecode is non-empty even-length lowercase hex (${(creation.length - 2) / 2} bytes)`,
);
check(
  "L2F-F2",
  /^0x[0-9a-f]+$/.test(runtime) && runtime.length > 2 && (runtime.length - 2) % 2 === 0,
  `runtime bytecode is non-empty even-length lowercase hex (${(runtime.length - 2) / 2} bytes)`,
);
check(
  "L2F-F3",
  keccak256(creation as `0x${string}`) === creationHash,
  `recomputed creation keccak256 matches the TS artifact (${creationHash})`,
);
check(
  "L2F-F4",
  keccak256(runtime as `0x${string}`) === runtimeHash,
  `recomputed runtime keccak256 matches the TS artifact (${runtimeHash})`,
);
check(
  "L2F-F5",
  manifest.bytecode?.creationKeccak256 === creationHash &&
    manifest.bytecode?.runtimeKeccak256 === runtimeHash,
  "manifest bytecode hashes match the TS artifact hashes",
);
check(
  "L2F-F6",
  creation.endsWith(runtime.slice(2)) === false ? creation.includes(runtime.slice(2)) : true,
  "runtime bytecode is embedded in the creation bytecode",
);
check(
  "L2F-F7",
  !/\bimmutable\b/.test(sourceSrc.replace(/\/\*[\s\S]*?\*\//g, "")) &&
    manifest.bytecode?.runtimeConstructorIndependent === true,
  "no immutable state: runtime bytecode is constructor-independent",
);

// ------------------------------------------- G. no hardcoded recipient/signers
const ADDRESS_RE = /(?<![0-9a-fA-F])0x[0-9a-fA-F]{40}(?![0-9a-fA-F])/g;
const tsMetadata = tsSrc
  .replace(/"0x[0-9a-f]{100,}"/g, '"<bytecode>"')
  .replace(/"0x[0-9a-f]{64}"/g, '"<hash>"');
const manifestNoHashes = manifestRaw.replace(/"0x[0-9a-f]{64}"/g, '"<hash>"');
check(
  "L2F-G1",
  (tsMetadata.match(ADDRESS_RE) ?? []).length === 0,
  "TS artifact metadata contains no 20-byte address literal (bytecode and hashes excluded)",
);
check(
  "L2F-G2",
  (manifestNoHashes.match(ADDRESS_RE) ?? []).length === 0,
  "manifest contains no 20-byte address literal",
);
check(
  "L2F-G3",
  (sourceSrc.match(ADDRESS_RE) ?? []).length === 0 && /address\(0\)/.test(sourceSrc),
  "frozen source hardcodes no address; only the zero-address guard exists",
);
check(
  "L2F-G4",
  !/private\s*key|mnemonic|seed phrase|PRIVATE_KEY/i.test(
    `${sourceSrc}${manifestRaw}${tsMetadata}`,
  ),
  "no private key, mnemonic or seed material anywhere in the frozen outputs",
);

// ------------------------------------------------------- H. manifest status flags
check(
  "L2F-H1",
  manifest.status?.compiled === true && manifest.status?.frozen === true,
  "manifest records the artifact as compiled and frozen",
);
check(
  "L2F-H2",
  manifest.status?.productionAllowlisted === false,
  "manifest records productionAllowlisted: false",
);
check("L2F-H3", manifest.status?.deployed === false, "manifest records deployed: false");
check(
  "L2F-H4",
  manifest.status?.testnetRehearsalPassed === false,
  "manifest records testnetRehearsalPassed: false",
);
check(
  "L2F-H5",
  manifest.status?.treasuryRecipientResolved === false,
  "manifest records treasuryRecipientResolved: false",
);

// ----------------------------------------- I. start-gate immutability tripwires
const UNCHANGED = [
  "src/lib/cartel-fixed-erc20.artifact.ts",
  "src/lib/launch-evidence-checks.ts",
  "contracts/CartelFixedSupplyToken.sol",
  "src/lib/chain-launcher.ts",
  "src/lib/chain-simulation.ts",
  "src/lib/chain-mainnet-registry.ts",
  "src/lib/chain-mainnet-simulation.ts",
  "src/lib/chain-mainnet-presign.helpers.ts",
  "src/lib/chain-mainnet-presign.functions.ts",
  "src/lib/chain-mainnet-handoff.functions.ts",
  "src/lib/chain-mainnet-verify.functions.ts",
  "src/lib/chain-mainnet-verify-apply.ts",
  "src/lib/chain-mainnet-verify-receipt.ts",
  "src/lib/chain-mainnet-verify-shape.ts",
  "src/lib/chain-mainnet-canary.functions.ts",
  "src/lib/chain-mainnet-canary-intent.ts",
  "src/lib/chain-mainnet-reconciliation.functions.ts",
  "src/lib/chain-mainnet-reconciliation.helpers.ts",
  "src/lib/chain-mainnet-health.functions.ts",
  "src/lib/chain-mainnet-wallet.ts",
  "src/lib/treasury-signers.ts",
  "src/lib/treasury-safe-verify.ts",
  "src/lib/treasury-safe-verify.functions.ts",
  "src/lib/launch-production-request.ts",
];
for (const p of UNCHANGED) {
  check(`L2F-I:${p}`, read(p) === atGate(p), `${p} is byte-for-byte unchanged from the start gate`);
}

// package.json is handled by a dedicated check: exactly one verified Lovable
// platform dependency bump is permitted; every other field must be identical to
// the immutable Phase 2 start gate.
const PKG_DRIFT_DEP = "@lovable.dev/vite-tanstack-config";
const PKG_DRIFT_GATE_VALUE = "^2.15.0";
const PKG_DRIFT_CURRENT_VALUE = "2.23.1";
const pkgGate = JSON.parse(atGate("package.json")) as Record<string, any>;
const pkgCurrent = JSON.parse(read("package.json")) as Record<string, any>;
check(
  "L2F-I-package-gate-value",
  pkgGate.dependencies?.[PKG_DRIFT_DEP] === PKG_DRIFT_GATE_VALUE,
  `start-gate package.json pins ${PKG_DRIFT_DEP} to exactly ${PKG_DRIFT_GATE_VALUE}`,
);
check(
  "L2F-I-package-current-value",
  pkgCurrent.dependencies?.[PKG_DRIFT_DEP] === PKG_DRIFT_CURRENT_VALUE,
  `current package.json pins ${PKG_DRIFT_DEP} to exactly ${PKG_DRIFT_CURRENT_VALUE}`,
);
const pkgNormalized = {
  ...pkgCurrent,
  dependencies: { ...pkgCurrent.dependencies, [PKG_DRIFT_DEP]: PKG_DRIFT_GATE_VALUE },
};
check(
  "L2F-I-package-no-other-drift",
  JSON.stringify(pkgNormalized) === JSON.stringify(pkgGate),
  `the ONLY permitted package.json drift from the immutable Phase 2 start gate is the verified Lovable platform dependency bump ${PKG_DRIFT_DEP} ${PKG_DRIFT_GATE_VALUE} -> ${PKG_DRIFT_CURRENT_VALUE}; after normalizing that single dependency the whole package.json is deeply equal to the start gate`,
);
check(
  "L2F-I-allowlist",
  /export const APPROVED_OFFICIAL_ARTIFACT_ID = "cartel-fixed-erc20-v1" as const;/.test(
    read("src/lib/launch-evidence-checks.ts"),
  ) && !/pepecartel/i.test(read("src/lib/launch-evidence-checks.ts")),
  "production artifact allowlist still approves exactly cartel-fixed-erc20-v1",
);
check(
  "L2F-I-liquidity",
  /MAINNET_LIQUIDITY_TX_ENABLED = false as const/.test(read("src/lib/chain-mainnet-registry.ts")),
  "MAINNET_LIQUIDITY_TX_ENABLED remains false",
);

const migrationFiles = walk(MIGRATIONS);
const gateMigrations = execFileSync(
  "git",
  ["ls-tree", "-r", "--name-only", START_GATE, MIGRATIONS],
  { encoding: "utf8" },
)
  .split("\n")
  .filter(Boolean);
check(
  "L2F-I-migrations",
  migrationFiles.length === 84 &&
    JSON.stringify([...migrationFiles].sort()) === JSON.stringify([...gateMigrations].sort()),
  `migration set unchanged from the start gate (${migrationFiles.length} files, expected 84)`,
);
check(
  "L2F-I-migration-content",
  migrationFiles.every((f) => read(f) === atGate(f)),
  "no migration file content changed from the start gate",
);

// ----------------------------------------------- J. suite purity (no chain I/O)
/** Patterns are built at runtime so this check cannot match its own source. */
const IO_PATTERNS = ["fetch(", "createPublic" + "Client", "createWallet" + "Client", "@" + "supabase/", "http" + "s://"];
const selfImports = read("scripts/pcart-l2-frozen-artifact-regression.ts")
  .split("\n")
  .filter((l) => !l.trimStart().startsWith("*") && !l.includes("IO_PATTERNS"))
  .join("\n");
check(
  "L2F-J1",
  IO_PATTERNS.every((p) => !selfImports.includes(p)),
  "this regression performs no network, RPC, wallet or database call",
);



console.log(failures === 0 ? "\nALL CHECKS PASSED" : `\n${failures} CHECK(S) FAILED`);
process.exit(failures === 0 ? 0 : 1);
