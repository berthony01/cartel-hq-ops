/**
 * PCART-L1B — Safe treasury verification regression.
 *
 * PURE LOGIC + SOURCE assertions only. No network, no RPC, no wallet, no
 * database, no transaction, no environment value is read.
 */
import { readFileSync } from "node:fs";
import {
  MAINNET_DEPLOYMENT_TX_ENABLED,
  MAINNET_LIQUIDITY_TX_ENABLED,
  ROBINHOOD_MAINNET_CHAIN_ID,
} from "../src/lib/chain-mainnet-registry";
import {
  decodeAddressArray,
  decodeString,
  decodeUint256,
  evaluateSafeTreasury,
  hasContractCode,
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
const versionData = (text: string) => {
  const bytes = Buffer.from(text, "utf8").toString("hex");
  return `0x${word(32)}${word(text.length)}${bytes.padEnd(64, "0")}`;
};

const A = "0x1111111111111111111111111111111111111111";
const B = "0x2222222222222222222222222222222222222222";
const C = "0x3333333333333333333333333333333333333333";
const D = "0x4444444444444444444444444444444444444444";
const ZERO = "0x0000000000000000000000000000000000000000";
const SAFE_ADDR = "0x9999999999999999999999999999999999999999";
const CODE = "0x6080604052";

const base = (over: Partial<TreasurySafeReads> = {}): TreasurySafeReads => ({
  address: SAFE_ADDR,
  observedChainId: ROBINHOOD_MAINNET_CHAIN_ID,
  codeHex: CODE,
  ownersData: ownersData([A, B, C]),
  thresholdData: thresholdData(2),
  versionData: versionData("1.4.1"),
  ...over,
});

// ------------------------------------------------------------------- policy
const good = evaluateSafeTreasury(base());
check(
  "L1B-1",
  good.isTwoOfThreeSafeCompatible &&
    good.ownerCount === 3 &&
    good.threshold === 2 &&
    good.version === "1.4.1" &&
    good.chainId === ROBINHOOD_MAINNET_CHAIN_ID &&
    good.failureCode === null,
  "2-of-3 with 3 unique non-zero owners is suitable",
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
  check(id, r.failureCode === "NOT_A_CONTRACT" && !r.isTwoOfThreeSafeCompatible, `EOA/empty code (${String(code)}) is unsuitable`);
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
  "malformed/reverted RPC data fails closed",
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

const noVersion = evaluateSafeTreasury(base({ versionData: undefined }));
check(
  "L1B-11",
  noVersion.isTwoOfThreeSafeCompatible && noVersion.version === null,
  "unreadable VERSION() alone does not fail a valid 2-of-3",
);

check(
  "L1B-12",
  decodeUint256("0x") === null &&
    decodeAddressArray(`0x${word(32)}${word(1)}${"ff".repeat(32)}`) === null &&
    decodeString("0x") === null &&
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
  "L1B-17",
  !/supabase|from\(|rpc\(/.test(fnCode.replace(/auth-middleware|requireSupabaseAuth/g, "")),
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
    (panelCode.match(/production-recipient"/g) ?? []).length === 1,
  "treasury panel reuses the single existing recipient field",
);
check(
  "L1B-20",
  /const canSubmit =\s*!disabled &&\s*!submitting &&\s*isWorkspaceOwner &&\s*eligibility\.eligible &&\s*supply\.ok &&\s*recipientValid &&\s*manualConfirmed;/.test(
    panelCode,
  ),
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
  !/migration|create table|alter table/i.test(fnCode + uiCode + stripComments(read(LOGIC))),
  "no schema or persistence introduced",
);

console.log(failures === 0 ? "\nALL CHECKS PASSED" : `\n${failures} CHECK(S) FAILED`);
process.exit(failures === 0 ? 0 : 1);
