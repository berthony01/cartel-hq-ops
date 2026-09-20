/**
 * PCART-L1B — canonical Safe v1.4.1 treasury verification regression.
 *
 * PURE LOGIC + SOURCE assertions only. No network, no RPC, no wallet, no
 * database, no transaction, no environment value is read.
 */
import { readFileSync } from "node:fs";
import { keccak256, toFunctionSelector } from "viem";
import {
  MAINNET_DEPLOYMENT_TX_ENABLED,
  MAINNET_LIQUIDITY_TX_ENABLED,
  ROBINHOOD_MAINNET_CHAIN_ID,
} from "../src/lib/chain-mainnet-registry";
import {
  CANONICAL_SAFE_PROXY_RUNTIME_CODEHASH,
  CANONICAL_SAFE_VERSION,
  CANONICAL_SAFEL2_SINGLETON,
  decodeAddress,
  decodeAddressArray,
  decodeModulesPaginated,
  decodeStorageWord,
  decodeString,
  decodeUint256,
  encodeGetModulesPaginatedCall,
  evaluateSafeTreasury,
  hasContractCode,
  runtimeCodeHash,
  SAFE_GET_OWNERS_SELECTOR,
  SAFE_GET_THRESHOLD_SELECTOR,
  SAFE_GUARD_STORAGE_SLOT,
  SAFE_MASTER_COPY_SELECTOR,
  SAFE_NONCE_SELECTOR,
  SAFE_SENTINEL_MODULES,
  SAFE_VERSION_SELECTOR,
  treasurySafeReadFailure,
  type TreasurySafeReads,
} from "../src/lib/treasury-safe-verify";

const LOGIC = "src/lib/treasury-safe-verify.ts";
const FN = "src/lib/treasury-safe-verify.functions.ts";
const UI = "src/components/cartel/TreasurySafeVerificationPanel.tsx";
const PANEL = "src/components/cartel/ProductionDeploymentRequestPanel.tsx";
const REGISTRY = "src/lib/chain-mainnet-registry.ts";

const read = (p: string) => readFileSync(p, "utf8");
const stripComments = (s: string) =>
  s.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");

const logicCode = stripComments(read(LOGIC));
const fnCode = stripComments(read(FN));
const uiCode = stripComments(read(UI));
const panelCode = stripComments(read(PANEL));
const registrySrc = read(REGISTRY);

let failures = 0;
function check(id: string, ok: boolean, detail: string) {
  if (ok) console.log(`PASS ${id} — ${detail}`);
  else {
    failures += 1;
    console.error(`FAIL ${id} — ${detail}`);
  }
}

// ------------------------------------------------------------- ABI fixtures
const pad = (hex: string) => hex.replace(/^0x/, "").toLowerCase().padStart(64, "0");
const word = (n: number | bigint) => pad(BigInt(n).toString(16));
const ownersData = (addrs: string[]) =>
  `0x${word(32)}${word(addrs.length)}${addrs.map((a) => pad(a)).join("")}`;
const thresholdData = (n: number) => `0x${word(n)}`;
const nonceData = (n: number) => `0x${word(n)}`;
const versionData = (text: string) => {
  const bytes = Buffer.from(text, "utf8").toString("hex");
  return `0x${word(32)}${word(text.length)}${bytes.padEnd(64, "0")}`;
};
const addressWord = (a: string) => `0x${pad(a)}`;
const modulesData = (mods: string[], next: string) =>
  `0x${word(64)}${pad(next)}${word(mods.length)}${mods.map((m) => pad(m)).join("")}`;

const A = "0x1111111111111111111111111111111111111111";
const B = "0x2222222222222222222222222222222222222222";
const C = "0x3333333333333333333333333333333333333333";
const D = "0x4444444444444444444444444444444444444444";
const ZERO = "0x0000000000000000000000000000000000000000";
const ZERO_WORD = `0x${"0".repeat(64)}`;
const SAFE_ADDR = "0x9999999999999999999999999999999999999999";

/**
 * Official SafeProxy v1.4.x runtime bytecode (build artifact, not a live chain
 * read). Its keccak256 must equal the canonical pin — asserted below.
 */
const CANONICAL_PROXY_RUNTIME =
  "0x608060405273ffffffffffffffffffffffffffffffffffffffff600054167fa619486e0000000000000000000000000000000000000000000000000000000060003514156050578060005260206000f35b3660008037600080366000845af43d6000803e60008114156070573d6000fd5b3d6000f3fea264697066735822122003d1488ee65e08fa41e58e888a9865554c535f2c77126a82cb4c0f917f31441364736f6c63430007060033";
const SPOOF_CODE = "0x6080604052";

const base = (over: Partial<TreasurySafeReads> = {}): TreasurySafeReads => ({
  address: SAFE_ADDR,
  observedChainId: ROBINHOOD_MAINNET_CHAIN_ID,
  codeHex: CANONICAL_PROXY_RUNTIME,
  masterCopyData: addressWord(CANONICAL_SAFEL2_SINGLETON),
  ownersData: ownersData([A, B, C]),
  thresholdData: thresholdData(2),
  versionData: versionData("1.4.1"),
  nonceData: nonceData(7),
  modulesData: modulesData([], SAFE_SENTINEL_MODULES),
  guardStorageData: ZERO_WORD,
  ...over,
});

// ------------------------------------------------------- canonical identity
check(
  "L1B-0a",
  keccak256(CANONICAL_PROXY_RUNTIME as `0x${string}`).toLowerCase() ===
    CANONICAL_SAFE_PROXY_RUNTIME_CODEHASH.toLowerCase(),
  "official SafeProxy runtime bytecode hashes to the pinned canonical code hash",
);
check(
  "L1B-0b",
  CANONICAL_SAFEL2_SINGLETON.toLowerCase() === "0x29fcb43b46531bca003ddc8fcb67ffe91900c762" &&
    CANONICAL_SAFE_VERSION === "1.4.1" &&
    SAFE_SENTINEL_MODULES === "0x0000000000000000000000000000000000000001" &&
    SAFE_GUARD_STORAGE_SLOT ===
      "0x4a204f620c8c5ccdca3fd54d003badd85ba500436a431f0cbda4f558c93c34c8",
  "canonical singleton, version, sentinel and guard slot are pinned exactly",
);
check(
  "L1B-0c",
  SAFE_MASTER_COPY_SELECTOR === "0xa619486e" &&
    SAFE_NONCE_SELECTOR === toFunctionSelector("function nonce() view returns (uint256)") &&
    SAFE_VERSION_SELECTOR === toFunctionSelector("function VERSION() view returns (string)") &&
    SAFE_GET_OWNERS_SELECTOR === toFunctionSelector("function getOwners() view returns (address[])") &&
    SAFE_GET_THRESHOLD_SELECTOR ===
      toFunctionSelector("function getThreshold() view returns (uint256)"),
  "read selectors match their canonical signatures",
);
check(
  "L1B-0d",
  encodeGetModulesPaginatedCall() ===
    `${toFunctionSelector("function getModulesPaginated(address,uint256) view returns (address[],address)")}${pad(SAFE_SENTINEL_MODULES)}${word(1)}`,
  "getModulesPaginated is encoded with the sentinel and page size 1",
);

// ------------------------------------------------------------------- policy
const good = evaluateSafeTreasury(base());
check(
  "L1B-1",
  good.isCanonicalSafeV141 &&
    good.isTwoOfThreeSafeCompatible &&
    good.proxyCodeHashOk &&
    good.singletonOk &&
    good.versionOk &&
    good.nonceReadable &&
    good.modulesEmpty &&
    good.guardUnset &&
    good.ownerCount === 3 &&
    good.threshold === 2 &&
    good.version === "1.4.1" &&
    good.masterCopy === CANONICAL_SAFEL2_SINGLETON.toLowerCase() &&
    good.chainId === ROBINHOOD_MAINNET_CHAIN_ID &&
    good.failureCode === null,
  "canonical happy path: Safe v1.4.1 profile + 2-of-3 policy verified",
);
check(
  "L1B-1b",
  /not pinned by this check/i.test(good.message),
  "success message states the exact signer addresses are not pinned",
);

check(
  "L1B-2",
  evaluateSafeTreasury(base({ thresholdData: thresholdData(1) })).failureCode ===
    "THRESHOLD_NOT_TWO",
  "1-of-3 is unsuitable",
);

check(
  "L1B-3",
  evaluateSafeTreasury(base({ ownersData: ownersData([A, B, C, D]) })).failureCode ===
    "OWNER_COUNT_NOT_THREE",
  "2-of-4 is unsuitable under PCART 2-of-3 policy",
);

for (const [id, code] of [
  ["L1B-4a", "0x"],
  ["L1B-4b", null],
  ["L1B-4c", "0xzz"],
] as const) {
  const r = evaluateSafeTreasury(base({ codeHex: code }));
  check(id, r.failureCode === "NOT_A_CONTRACT" && !r.isCanonicalSafeV141, `EOA/empty code (${String(code)}) is unsuitable`);
}

check(
  "L1B-5",
  evaluateSafeTreasury(base({ ownersData: ownersData([A, A, C]) })).failureCode ===
    "OWNER_SET_INVALID",
  "duplicate owner is unsuitable",
);
check(
  "L1B-6",
  evaluateSafeTreasury(base({ ownersData: ownersData([A, ZERO, C]) })).failureCode ===
    "OWNER_SET_INVALID",
  "zero owner is unsuitable",
);

check(
  "L1B-7",
  evaluateSafeTreasury(base({ ownersData: null })).failureCode === "SAFE_INTERFACE_UNREADABLE" &&
    evaluateSafeTreasury(base({ thresholdData: "0xdead" })).failureCode ===
      "SAFE_INTERFACE_UNREADABLE" &&
    evaluateSafeTreasury(base({ ownersData: `0x${word(64)}${word(3)}` })).failureCode ===
      "SAFE_INTERFACE_UNREADABLE",
  "malformed/reverted owner or threshold data fails closed",
);

check(
  "L1B-8",
  evaluateSafeTreasury(base({ thresholdData: thresholdData(4) })).failureCode ===
    "SAFE_INTERFACE_UNREADABLE",
  "impossible threshold (> owners) fails closed",
);

check(
  "L1B-9",
  evaluateSafeTreasury(base({ observedChainId: 1 })).failureCode === "CHAIN_MISMATCH" &&
    evaluateSafeTreasury(base({ observedChainId: null })).failureCode === "CHAIN_MISMATCH",
  "wrong or unknown chain fails closed",
);

check(
  "L1B-10",
  evaluateSafeTreasury(base({ address: ZERO })).failureCode === "INVALID_ADDRESS" &&
    evaluateSafeTreasury(base({ address: "0x123" })).failureCode === "INVALID_ADDRESS",
  "invalid/zero candidate address fails closed",
);

// -------------------------------------------- canonical profile enforcement
const spoof = evaluateSafeTreasury(base({ codeHex: SPOOF_CODE }));
check(
  "L1B-23",
  spoof.failureCode === "PROXY_BYTECODE_MISMATCH" && !spoof.isCanonicalSafeV141,
  "ABI-compatible contract with non-Safe bytecode fails on code hash",
);
check(
  "L1B-24",
  evaluateSafeTreasury(base({ masterCopyData: addressWord(D) })).failureCode ===
    "SINGLETON_MISMATCH",
  "proxy pointing at a non-canonical singleton fails",
);
for (const [id, value] of [
  ["L1B-25a", null],
  ["L1B-25b", "0xdead"],
  ["L1B-25c", `0x${"ff".repeat(32)}`],
  ["L1B-25d", `0x${word(1)}${word(1)}`],
] as const) {
  check(
    id,
    evaluateSafeTreasury(base({ masterCopyData: value })).failureCode === "MASTERCOPY_UNREADABLE",
    `malformed/unreadable masterCopy (${String(value).slice(0, 12)}) fails closed`,
  );
}
check(
  "L1B-26a",
  evaluateSafeTreasury(base({ versionData: versionData("1.3.0") })).failureCode ===
    "VERSION_MISMATCH",
  "wrong Safe version fails",
);
for (const [id, value] of [
  ["L1B-26b", undefined],
  ["L1B-26c", null],
  ["L1B-26d", "0x"],
] as const) {
  check(
    id,
    evaluateSafeTreasury(base({ versionData: value })).failureCode === "VERSION_UNREADABLE",
    `unreadable VERSION() (${String(value)}) now fails closed`,
  );
}
for (const [id, value] of [
  ["L1B-27a", null],
  ["L1B-27b", undefined],
  ["L1B-27c", "0xdead"],
] as const) {
  check(
    id,
    evaluateSafeTreasury(base({ nonceData: value })).failureCode === "NONCE_UNREADABLE",
    `unreadable nonce (${String(value)}) fails closed`,
  );
}
check(
  "L1B-28",
  evaluateSafeTreasury(base({ nonceData: nonceData(0) })).isCanonicalSafeV141 &&
    evaluateSafeTreasury(base({ nonceData: nonceData(42) })).isCanonicalSafeV141 &&
    evaluateSafeTreasury(base({ nonceData: nonceData(42) })).nonce === "42",
  "zero and non-zero readable nonces both pass",
);
check(
  "L1B-29",
  evaluateSafeTreasury(base({ modulesData: modulesData([D], SAFE_SENTINEL_MODULES) }))
    .failureCode === "MODULES_PRESENT",
  "an installed module fails",
);
check(
  "L1B-30a",
  evaluateSafeTreasury(base({ modulesData: modulesData([], D) })).failureCode ===
    "MODULES_PRESENT",
  "a non-sentinel next pointer fails",
);
for (const [id, value] of [
  ["L1B-30b", null],
  ["L1B-30c", undefined],
  ["L1B-30d", "0xdead"],
  ["L1B-30e", `0x${word(32)}${pad(SAFE_SENTINEL_MODULES)}${word(0)}`],
  ["L1B-30f", `0x${word(64)}${pad(SAFE_SENTINEL_MODULES)}${word(2)}${pad(D)}`],
] as const) {
  check(
    id,
    evaluateSafeTreasury(base({ modulesData: value })).failureCode === "MODULES_UNREADABLE",
    `malformed modules tuple (${String(value).slice(0, 12)}) fails closed`,
  );
}
check(
  "L1B-31",
  evaluateSafeTreasury(base({ guardStorageData: addressWord(D) })).failureCode === "GUARD_PRESENT",
  "a configured transaction guard fails",
);
for (const [id, value] of [
  ["L1B-32a", null],
  ["L1B-32b", undefined],
  ["L1B-32c", "0xdead"],
  ["L1B-32d", ZERO_WORD.slice(0, 64)],
] as const) {
  check(
    id,
    evaluateSafeTreasury(base({ guardStorageData: value })).failureCode === "GUARD_UNREADABLE",
    `malformed guard storage (${String(value).slice(0, 12)}) fails closed`,
  );
}
check(
  "L1B-33",
  treasurySafeReadFailure(SAFE_ADDR, "PROVIDER_UNREACHABLE", "x").isCanonicalSafeV141 === false &&
    treasurySafeReadFailure(SAFE_ADDR, "PROVIDER_NOT_CONFIGURED", "x").isCanonicalSafeV141 ===
      false &&
    treasurySafeReadFailure(SAFE_ADDR, "PROVIDER_UNREACHABLE", "x").proxyCodeHashOk === false,
  "provider failures fail closed with no canonical claim",
);

check(
  "L1B-12",
  decodeUint256("0x") === null &&
    decodeAddressArray(`0x${word(32)}${word(1)}${"ff".repeat(32)}`) === null &&
    decodeString("0x") === null &&
    decodeAddress("0x") === null &&
    decodeModulesPaginated("0x") === null &&
    decodeStorageWord("0x1234") === null &&
    runtimeCodeHash("0x") === null &&
    hasContractCode("0x") === false,
  "strict decoders reject malformed data",
);

// -------------------------------------------------------- safety boundaries
const forbidden = /eth_sendTransaction|eth_sendRawTransaction|eth_sign|personal_sign|signTypedData|privateKey/i;
check("L1B-13", !forbidden.test(fnCode), "server verifier contains no signing or send method");
check("L1B-14", !forbidden.test(uiCode), "treasury UI contains no signing or send method");
check(
  "L1B-15",
  /requireSupabaseAuth/.test(fnCode) && /\.middleware\(\[requireSupabaseAuth\]\)/.test(fnCode),
  "verifier is authenticated server-side",
);
check(
  "L1B-16",
  !/VITE_/.test(fnCode) && !/RPC_URL\s*=\s*["']http/.test(fnCode) && !/http/.test(uiCode),
  "managed RPC URL is never exposed client-side",
);
check(
  "L1B-16b",
  (fnCode.match(/rpcCall\(endpoint,\s*"([a-zA-Z_]+)"/g) ?? []).every((m) =>
    /"(eth_chainId|eth_getCode|eth_call|eth_getStorageAt)"/.test(m),
  ) &&
    /process\.env\[ROBINHOOD_MAINNET_MANAGED_RPC_ENV\]/.test(fnCode) &&
    (fnCode.match(/process\.env/g) ?? []).length === 1 &&
    !/fallback|diagnostic|PUBLIC_RPC/i.test(fnCode),
  "only the managed RPC transport and the allowed read methods are used, with no public fallback",
);
check(
  "L1B-17",
  !/\.from\(|\.rpc\(|supabaseAdmin|insert\(|update\(|delete\(/.test(fnCode),
  "verifier performs no database read or write",
);
check(
  "L1B-18",
  /useEffect\(\(\) => \{\s*setResult\(null\);[\s\S]*?\}, \[normalized\]\);/.test(uiCode),
  "changing the recipient address clears a previously verified UI state",
);
check(
  "L1B-19",
  /<TreasurySafeVerificationPanel[\s\S]*?address=\{recipient\}/.test(panelCode) &&
    (panelCode.match(/id="production-recipient"/g) ?? []).length === 1,
  "treasury panel reuses the single existing recipient field",
);
check(
  "L1B-20",
  /const canSubmit =\s*!disabled &&\s*!submitting &&\s*isWorkspaceOwner &&\s*eligibility\.eligible &&\s*supply\.ok &&\s*recipientValid &&\s*manualConfirmed;/.test(
    panelCode,
  ) && !/isCanonicalSafeV141|isTwoOfThreeSafeCompatible/.test(panelCode),
  "no treasury gating was added to production request submission",
);
check(
  "L1B-21",
  /MAINNET_LIQUIDITY_TX_ENABLED = false as const/.test(registrySrc) &&
    MAINNET_LIQUIDITY_TX_ENABLED === false &&
    MAINNET_DEPLOYMENT_TX_ENABLED === true,
  "runtime mainnet control and liquidity switch untouched",
);
check(
  "L1B-22",
  !/migration|create table|alter table/i.test(fnCode + uiCode + logicCode),
  "no schema or persistence introduced",
);
check(
  "L1B-34",
  /isCanonicalSafeV141 === true/.test(uiCode) &&
    /Canonical Safe v1\.4\.1 profile verified/.test(uiCode) &&
    !/PCART treasury approved/i.test(uiCode),
  "UI success depends on the full canonical profile and claims no treasury approval",
);
check(
  "L1B-35",
  /have not been\s*\n?\s*chosen or pinned yet/.test(uiCode) &&
    /not a PEPECARTEL treasury approval/.test(uiCode) &&
    /did not\s*\n?\s*create the wallet/.test(uiCode),
  "UI states signer identities are unpinned and nothing was created or approved",
);

console.log(failures === 0 ? "\nALL CHECKS PASSED" : `\n${failures} CHECK(S) FAILED`);
process.exit(failures === 0 ? 0 : 1);
