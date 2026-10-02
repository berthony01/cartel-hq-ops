/**
 * PCART treasury Safe creation regression.
 * Run: bun scripts/pcart-treasury-safe-create-regression.ts
 *
 * PURE LOGIC + SOURCE assertions only. No network, no wallet, no database,
 * no transaction, no environment value is read.
 */
import { readFileSync } from "node:fs";
import { execSync } from "node:child_process";
import { concat, keccak256, toFunctionSelector } from "viem";

import {
  buildSafeCreationPlan,
  deriveSafeSaltNonce,
  encodeSafeSetupInitializer,
  CANONICAL_SAFE_PREFLIGHT_PINS,
  evaluateSafePreflight,
  evaluateSafePreflightWithPins,
  isDecimalSalt,
  predictSafeAddress,
  SAFE_CREATE_SINGLETON,
  SAFE_CREATE_SINGLETON_CODEHASH,
  SAFE_FALLBACK_HANDLER,
  SAFE_FALLBACK_HANDLER_CODEHASH,
  SAFE_PROXY_CREATION_CODE_HASH,
  SAFE_PROXY_FACTORY,
  SAFE_PROXY_FACTORY_CODEHASH,
  type SafePreflightReads,
} from "../src/lib/treasury-safe-create";
import { evaluateSafeSendGate } from "../src/lib/treasury-safe-wallet";
import { derivePcartReadiness, isPcartTreasurySafeReady } from "../src/lib/pcart-launch-readiness";
import {
  MAINNET_DEPLOYMENT_TX_ENABLED,
  MAINNET_LIQUIDITY_TX_ENABLED,
} from "../src/lib/chain-mainnet-registry";

let failures = 0;
function check(id: string, ok: boolean, detail: string) {
  if (ok) console.log(`PASS ${id} — ${detail}`);
  else {
    failures += 1;
    console.error(`FAIL ${id} — ${detail}`);
  }
}
const read = (p: string) => readFileSync(p, "utf8");
const strip = (s: string) => s.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");

// Current saved PEPECARTEL signer row (public addresses only).
const LAUNCH = "9f9af215-66ee-4a10-92db-617b61fb7fd3";
const S1 = "0xc23bd6148a29318cc19264e096623ffcdac19245";
const S2 = "0xa068b94e6f11a7e2daef086c5190dc265a523f67";
const S3 = "0xe5b2f446317d03de6e69fa697ab25d635f6dd617";
const SIGNERS = [S1, S2, S3];
const OTHER = "0x4444444444444444444444444444444444444444";

// Public SafeProxyFactory v1.4.1 proxyCreationCode read from chain 4663.
const PCC = "0x608060405234801561001057600080fd5b506040516101e63803806101e68339818101604052602081101561003357600080fd5b8101908080519060200190929190505050600073ffffffffffffffffffffffffffffffffffffffff168173ffffffffffffffffffffffffffffffffffffffff1614156100ca576040517f08c379a00000000000000000000000000000000000000000000000000000000081526004018080602001828103825260228152602001806101c46022913960400191505060405180910390fd5b806000806101000a81548173ffffffffffffffffffffffffffffffffffffffff021916908373ffffffffffffffffffffffffffffffffffffffff1602179055505060ab806101196000396000f3fe608060405273ffffffffffffffffffffffffffffffffffffffff600054167fa619486e0000000000000000000000000000000000000000000000000000000060003514156050578060005260206000f35b3660008037600080366000845af43d6000803e60008114156070573d6000fd5b3d6000f3fea264697066735822122003d1488ee65e08fa41e58e888a9865554c535f2c77126a82cb4c0f917f31441364736f6c63430007060033496e76616c69642073696e676c65746f6e20616464726573732070726f7669646564" as `0x${string}`;

const pad = (hex: string) => hex.replace(/^0x/, "").toLowerCase().padStart(64, "0");
const word = (n: number | bigint) => pad(BigInt(n).toString(16));

// ---------------------------------------------------------- pins
check(
  "SC-0",
  keccak256(PCC).toLowerCase() === SAFE_PROXY_CREATION_CODE_HASH &&
    SAFE_CREATE_SINGLETON === "0x29fcB43b46531BcA003ddC8FCB67FFE91900C762" &&
    SAFE_PROXY_FACTORY === "0x4e1DCf7AD4e460CfD30791CCC4F9c8a4f820ec67" &&
    SAFE_FALLBACK_HANDLER === "0xfd0732Dc9E303f09fCEf3a7388Ad10A83459Ec99" &&
    SAFE_CREATE_SINGLETON_CODEHASH === "0xb1f926978a0f44a2c0ec8fe822418ae969bd8c3f18d61e5103100339894f81ff" &&
    SAFE_PROXY_FACTORY_CODEHASH === "0x50c3cdc4074750a7a974204a716c999edd37482f907608d960b2b025ee0b3317" &&
    SAFE_FALLBACK_HANDLER_CODEHASH === "0x7c6007a5d711cea8dfd5d91f5940ec29c7f200fe511eb1fc1397b367af3c42f9",
  "canonical Safe v1.4.1 pins and proxyCreationCode hash are exact",
);

// ---------------------------------------------------------- initializer vector
{
  const sel = toFunctionSelector("function setup(address[],uint256,address,bytes,address,address,uint256,address)");
  // Independent hand-built ABI encoding.
  const head = [
    word(0x100), // owners offset
    word(2), // threshold
    pad("0x0"), // to
    word(0x180), // data offset
    pad(SAFE_FALLBACK_HANDLER), // fallbackHandler
    pad("0x0"), // paymentToken
    word(0), // payment
    pad("0x0"), // paymentReceiver
  ].join("");
  const owners = word(3) + SIGNERS.map(pad).join("");
  const data = word(0);
  const expected = `${sel}${head}${owners}${data}`;
  const actual = encodeSafeSetupInitializer(SIGNERS);
  check("SC-1", sel === "0xb63e800d" && actual === expected, "setup initializer matches the hand-built vector for the three current signers");
  check(
    "SC-1b",
    (() => {
      try {
        encodeSafeSetupInitializer([S1, S1, S2]);
        return false;
      } catch {
        return true;
      }
    })(),
    "duplicate signers are rejected",
  );
}

// ---------------------------------------------------------- deterministic salt
const salt = deriveSafeSaltNonce(LAUNCH, SIGNERS);
check(
  "SC-2",
  salt === deriveSafeSaltNonce(LAUNCH.toUpperCase(), SIGNERS.map((s) => s.toUpperCase().replace("0X", "0x"))) &&
    salt !== deriveSafeSaltNonce(LAUNCH, [S2, S1, S3]) &&
    salt !== deriveSafeSaltNonce("00000000-0000-0000-0000-000000000000", SIGNERS) &&
    isDecimalSalt(salt.toString(10)),
  "salt is deterministic for the same launch/signers, changes with launch or owner order, and is decimal uint256",
);

// ---------------------------------------------------------- prediction
const plan = buildSafeCreationPlan(LAUNCH, SIGNERS);
const predicted = predictSafeAddress(plan.initializer, BigInt(plan.saltNonce), PCC);
{
  const innerSalt = keccak256(concat([keccak256(plan.initializer), `0x${word(BigInt(plan.saltNonce))}`]));
  const initCode = concat([PCC, `0x${pad(SAFE_CREATE_SINGLETON)}`]);
  const manual = `0x${keccak256(concat(["0xff", SAFE_PROXY_FACTORY, innerSalt, keccak256(initCode)])).slice(26)}`;
  check(
    "SC-3",
    !!predicted && /^0x[0-9a-f]{40}$/.test(predicted) && predicted === manual &&
      predicted === predictSafeAddress(plan.initializer, BigInt(plan.saltNonce), PCC),
    `predicted Safe address is stable and matches an independent CREATE2 computation (${predicted})`,
  );
  check(
    "SC-3b",
    predictSafeAddress(plan.initializer, BigInt(plan.saltNonce), `${PCC}00`) === null,
    "a wrong proxyCreationCode never yields a prediction",
  );
  check(
    "SC-3c",
    plan.to === SAFE_PROXY_FACTORY.toLowerCase() && plan.value === "0x0" &&
      plan.data.startsWith(toFunctionSelector("function createProxyWithNonce(address,bytes,uint256)")) &&
      plan.data.slice(10, 74) === pad(SAFE_CREATE_SINGLETON),
    "transaction targets the factory with value 0 and createProxyWithNonce(singleton, initializer, salt)",
  );
}

// ---------------------------------------------------------- preflight
const abiBytes = (hex: string) => {
  const body = hex.slice(2);
  return `0x${word(32)}${word(body.length / 2)}${body.padEnd(Math.ceil(body.length / 64) * 64, "0")}`;
};
const CODE_S = "0x6001";
const CODE_F = "0x6002";
const CODE_H = "0x6003";
const PINS = {
  singletonCodeHash: keccak256(CODE_S),
  factoryCodeHash: keccak256(CODE_F),
  fallbackHandlerCodeHash: keccak256(CODE_H),
};
const reads = (over: Partial<SafePreflightReads> = {}): SafePreflightReads => ({
  observedChainId: 4663,
  blockNumber: "77725506",
  singletonCode: CODE_S,
  factoryCode: CODE_F,
  fallbackHandlerCode: CODE_H,
  factoryGetChainIdData: `0x${word(4663)}`,
  proxyCreationCodeData: abiBytes(PCC),
  predictedAddressCode: "0x",
  ...over,
});
const pf = (over: Partial<SafePreflightReads> = {}) => evaluateSafePreflightWithPins(plan, reads(over), PINS);
{
  const ok = pf();
  check("SC-4", ok.ok && !ok.alreadyDeployed && ok.predictedAddress === predicted, "all-good preflight passes and returns the predicted address");
  check("SC-4a", pf({ observedChainId: 1 }).blocker === "CHAIN_MISMATCH", "wrong RPC chain blocks preflight");
  check("SC-4b", pf({ singletonCode: CODE_F }).blocker === "SINGLETON_CODE_MISMATCH", "wrong singleton code hash blocks");
  check("SC-4c", pf({ factoryCode: CODE_S }).blocker === "FACTORY_CODE_MISMATCH", "wrong factory code hash blocks");
  check("SC-4d", pf({ fallbackHandlerCode: CODE_S }).blocker === "FALLBACK_HANDLER_CODE_MISMATCH", "wrong fallback handler code hash blocks");
  check("SC-4e", pf({ factoryGetChainIdData: `0x${word(1)}` }).blocker === "FACTORY_CHAIN_ID_MISMATCH", "factory getChainId != 4663 blocks");
  check("SC-4f", pf({ proxyCreationCodeData: abiBytes(`${PCC}00`) }).blocker === "PROXY_CREATION_CODE_MISMATCH", "wrong proxyCreationCode hash blocks");
  const dep = pf({ predictedAddressCode: "0x6080" });
  check("SC-4g", !dep.ok && dep.alreadyDeployed && dep.blocker === "SAFE_ALREADY_DEPLOYED", "existing code at predicted address blocks send (verify instead)");
  check("SC-4h", pf({ predictedAddressCode: null }).blocker === "PREDICTED_CODE_UNREADABLE", "unreadable predicted code fails closed");
  check(
    "SC-4i",
    CANONICAL_SAFE_PREFLIGHT_PINS.singletonCodeHash === SAFE_CREATE_SINGLETON_CODEHASH &&
      CANONICAL_SAFE_PREFLIGHT_PINS.factoryCodeHash === SAFE_PROXY_FACTORY_CODEHASH &&
      CANONICAL_SAFE_PREFLIGHT_PINS.fallbackHandlerCodeHash === SAFE_FALLBACK_HANDLER_CODEHASH &&
      evaluateSafePreflight(plan, reads()).blocker === "SINGLETON_CODE_MISMATCH",
    "production preflight uses canonical pins (fixture code is rejected)",
  );
}

// ---------------------------------------------------------- send gate
const gate = (over: Partial<Parameters<typeof evaluateSafeSendGate>[0]> = {}) =>
  evaluateSafeSendGate({
    plan,
    launchId: LAUNCH,
    savedSigners: SIGNERS,
    preflightOk: true,
    account: S2,
    accountVerified: true,
    chainId: "0x1237",
    ...over,
  });
check("SC-5", gate() === null, "signer wallet on chain 4663 with the exact plan passes the gate");
check("SC-5a", gate({ account: OTHER }) === "NOT_A_SIGNER", "connected wallet not among signers blocks send");
check("SC-5b", gate({ chainId: "0x1" }) === "WRONG_CHAIN" && gate({ chainId: null }) === "WRONG_CHAIN", "wrong or unknown chain blocks send");
check("SC-5c", gate({ preflightOk: false }) === "PREFLIGHT_NOT_PASSED", "failed preflight blocks send");
check("SC-5d", gate({ account: null }) === "NO_WALLET" && gate({ accountVerified: false }) === "ACCOUNT_UNVERIFIED", "no or unverified wallet blocks send");
check(
  "SC-5e",
  gate({ plan: { ...plan, data: `${plan.data.slice(0, -2)}ff` as `0x${string}` } }) === "PLAN_MISMATCH" &&
    gate({ plan: { ...plan, to: OTHER } }) === "PLAN_MISMATCH" &&
    gate({ plan: { ...plan, saltNonce: "1" } }) === "PLAN_MISMATCH",
  "tampered calldata, target or salt blocks send",
);

// ---------------------------------------------------------- wallet source
{
  const w = strip(read("src/lib/treasury-safe-wallet.ts"));
  const sends = w.match(/eth_sendTransaction/g) ?? [];
  check(
    "SC-6",
    sends.length === 1 &&
      !/for\s*\(|while\s*\(|setTimeout|setInterval|retry/i.test(w) &&
      !/wallet_switchEthereumChain|wallet_addEthereumChain|eth_sendRawTransaction|eth_sign|personal_sign|signTypedData/.test(w),
    "wallet module has exactly one eth_sendTransaction path, no loop/retry, no chain switching or signing",
  );
  check(
    "SC-6b",
    !/chain-mainnet-wallet|chain-mainnet-handoff|presign|canary|send-window|PRODUCTION_SEND_ENABLED|emergency/i.test(w),
    "Safe creation never touches PCART token deployment send controls",
  );
  const panel = strip(read("src/components/cartel/TreasurySafeCreatePanel.tsx"));
  check(
    "SC-6c",
    /setSendAttempted\(true\)/.test(panel) && /!sendAttempted/.test(panel) && /Check Safe status/.test(panel) &&
      !/calldata/i.test(panel),
    "after a send attempt the UI only offers read-only status checks, never a second send or raw calldata",
  );
  const fn = strip(read("src/lib/treasury-safe-create.functions.ts"));
  check(
    "SC-6d",
    !/eth_sendTransaction|eth_sendRawTransaction|supabaseAdmin|VITE_/.test(fn) &&
      (fn.match(/process\.env/g) ?? []).length === 1 &&
      /\.middleware\(\[requireSupabaseAuth\]\)/.test(fn) &&
      /ownersMatchIntended === true/.test(fn) &&
      /save_launch_treasury_safe_evidence/.test(fn),
    "server side is authenticated, read-only on chain, and saves evidence only after exact-owner verification",
  );
}

// ---------------------------------------------------------- readiness
{
  const SAFE = predicted ?? "0x9999999999999999999999999999999999999999";
  const goodFresh = { isCanonicalSafeV141: true, ownersMatchIntended: true as boolean | null, address: SAFE };
  check(
    "SC-7",
    isPcartTreasurySafeReady({ persistedSafeAddress: SAFE, fresh: null }) === false &&
      isPcartTreasurySafeReady({ persistedSafeAddress: SAFE, fresh: undefined }) === false,
    "persisted Safe alone never makes Treasury ready",
  );
  check(
    "SC-7b",
    isPcartTreasurySafeReady({ persistedSafeAddress: SAFE, fresh: { ...goodFresh, ownersMatchIntended: null } }) === false &&
      isPcartTreasurySafeReady({ persistedSafeAddress: SAFE, fresh: { ...goodFresh, ownersMatchIntended: false } }) === false &&
      isPcartTreasurySafeReady({ persistedSafeAddress: SAFE, fresh: { ...goodFresh, isCanonicalSafeV141: false } }) === false &&
      isPcartTreasurySafeReady({ persistedSafeAddress: SAFE, fresh: { ...goodFresh, address: OTHER } }) === false &&
      isPcartTreasurySafeReady({ persistedSafeAddress: null, fresh: goodFresh }) === false,
    "non-exact, non-canonical, mismatched or unpersisted verification never makes Treasury ready",
  );
  const ready = isPcartTreasurySafeReady({ persistedSafeAddress: SAFE, fresh: goodFresh });
  const r = derivePcartReadiness({
    treasurySignersRecorded: true,
    treasurySafeVerified: ready,
    deploymentRows: [],
    mainnetLocked: true,
  });
  const treasury = r.steps.find((s) => s.id === "treasury");
  const launch = r.steps.find((s) => s.id === "launch");
  check(
    "SC-7c",
    ready && treasury?.state === "ready" && launch?.state === "locked" &&
      MAINNET_LIQUIDITY_TX_ENABLED === false &&
      typeof MAINNET_DEPLOYMENT_TX_ENABLED === "boolean",
    "fresh exact verification makes Treasury Ready while mainnet token execution stays locked",
  );
  const lc = read("src/routes/_authenticated/launch-control.tsx");
  check(
    "SC-7d",
    /treasurySafeVerified: pcartSafeReady/.test(lc) && /isPcartTreasurySafeReady\(\{/.test(lc) &&
      !/treasurySafeVerified: true/.test(lc),
    "Launch Control derives Treasury readiness only from fresh verification",
  );
}

// ---------------------------------------------------------- staged SQL
{
  const sql = read("docs/sql/PCART_TREASURY_SAFE_EVIDENCE.sql");
  check(
    "SC-8",
    /SECURITY DEFINER/.test(sql) && /is_workspace_owner\(v_row\.workspace_id, v_uid\)/.test(sql) &&
      /Save the treasury signer wallets first/.test(sql) &&
      !/DELETE FROM/i.test(sql) && /REVOKE ALL ON FUNCTION public\.save_launch_treasury_safe_evidence[\s\S]*FROM PUBLIC, anon/.test(sql) &&
      /Signer wallets are locked because the treasury Safe already exists/.test(sql) &&
      /cartel\.treasury_safe_evidence_write/.test(sql) &&
      !/SET signer_1|SET signer_2|SET signer_3/.test(sql.split("save_launch_treasury_safe_evidence(")[1] ?? ""),
    "staged SQL: owner-only definer RPC, requires signer row, never changes signers, no delete, direct writes blocked",
  );
}

// ---------------------------------------------------------- protected paths
{
  let changed = "";
  try {
    changed = execSync("git diff --name-only 517a5797", { encoding: "utf8" });
  } catch {
    changed = "";
  }
  const forbidden = changed
    .split("\n")
    .filter(Boolean)
    .filter((f) =>
      /^(contracts|artifacts)\//.test(f) ||
      /chain-mainnet-(wallet|handoff|registry)|production-deployment|ProductionDeploymentRequestPanel|canary|presign|liquidity|auction|telegram|pcart-token|frozen/i.test(f),
    );
  check("SC-9", forbidden.length === 0, `no deployment-control / token / liquidity / Telegram files changed (${forbidden.join(", ") || "none"})`);
}

// ---- MW: mobile treasury wallet connection ----
{
  const p = strip(read("src/components/cartel/TreasurySafeCreatePanel.tsx"));
  const connectBody = p.slice(p.indexOf("async function connect()"), p.indexOf("async function switchNetwork()"));
  check("MW-1", /enabled:\s*!!savedSignerConfig,/.test(p) && /enabled:\s*!!savedSignerConfig && isWorkspaceOwner/.test(p) && /savedSignerConfig\?\.updatedAt/.test(p) && !/enabled:\s*!!signerQuery\.data/.test(p), "status/preflight query gates use savedSignerConfig");
  check("MW-1b", (p.match(/const savedSignerConfig =/g) ?? []).length === 1, "savedSignerConfig declared once");
  check("MW-2", !/connectWalletConnectOnRobinhoodChain/.test(p), "panel no longer uses the bundled connect+switch helper");
  const wcIdx = connectBody.indexOf("connectWalletConnect()");
  const injIdx = connectBody.indexOf("connectInjected()");
  check("MW-3", wcIdx > 0 && injIdx > wcIdx && /CHOOSER_UNAVAILABLE\.includes\(result\.notice\)\s*&&\s*isInjectedWalletAvailable\(\)/.test(connectBody), "chooser first, limited injected fallback");
  check("MW-3b", ["WALLETCONNECT_NOT_CONFIGURED", "REOWN_LIBRARY_LOAD_FAILED", "REOWN_APPKIT_INIT_FAILED", "REOWN_CONNECT_FAILED"].every((n) => p.slice(p.indexOf("CHOOSER_UNAVAILABLE"), p.indexOf("CONNECT_NOTICE_COPY")).includes(`"${n}"`)), "fallback limited to the four chooser-unavailable notices");
  check("MW-4", !/requestRobinhoodChainSwitch|wallet_switchEthereumChain/.test(connectBody) && /onClick=\{\(\) => void switchNetwork\(\)\}/.test(p) && /Switch to Robinhood Chain/.test(p), "switch only via explicit button, never from connect()");
  check("MW-4b", /!!predicted &&\s*onRobinhood/.test(p), "Create requires Robinhood Chain");
  check("MW-5", /isEmbeddedBrowserContext\(\)/.test(p) && /Safari or Chrome, or in your wallet’s dapp browser/.test(p) && /Open standalone/.test(p), "embedded guidance present");
  const notices = ["WALLETCONNECT_NOT_CONFIGURED","REOWN_LIBRARY_LOAD_FAILED","REOWN_ORIGIN_NOT_ALLOWED","REOWN_PROJECT_ID_INVALID_OR_MISSING","REOWN_CONFIG_SERVER_ERROR","REOWN_RATE_LIMITED","REOWN_APPKIT_INIT_FAILED","REOWN_CONNECT_FAILED","STALE_SESSION_TEARDOWN_FAILED","STALE_SESSION_REUSE_REFUSED","WALLET_ACCOUNT_MISMATCH","WALLET_ACCOUNT_AMBIGUOUS","ACTIVE_ACCOUNT_CHANGED","WALLETCONNECT_TIMEOUT","CONNECTION_REJECTED_OR_FAILED","NO_ACCOUNT","NO_INJECTED_PROVIDER"];
  check("MW-6", notices.every((n) => new RegExp(`${n}:\\s*"`).test(p)) && /REOWN_ORIGIN_NOT_ALLOWED" && getConnectorOrigin\(\)/.test(p) && !/getReownProjectId|VITE_WALLETCONNECT/.test(p) && !/The wallet could not be connected/.test(p), "sanitized notice mapping; origin only for origin error; no project id");
  check("MW-7", !/eth_sendTransaction/.test(p) && /finally\s*\{\s*setConnecting\(false\)/.test(p), "no send in panel; connect guarded by busy state");
}

// ---- ML: mobile wallet library load-failure recovery ----
{
  const r = strip(read("src/lib/reown-appkit-wallet.ts"));
  const wc = strip(read("src/lib/wallet-connector.ts"));
  const p = strip(read("src/components/cartel/TreasurySafeCreatePanel.tsx"));
  const loader = r.slice(r.indexOf("async function loadAppKitLibraries"), r.indexOf("export async function preloadAppKitLibraries"));
  const i1 = loader.indexOf('await import("./reown-appkit-browser")');
  check("ML-1", i1 > 0 && !/appkit-adapter-ethers|REOWN_ADAPTER_LOAD_FAILED/.test(loader) && /classifyLazyLoadFailure\(error\)/.test(loader) && /return "REOWN_CHUNK_FETCH_FAILED"/.test(r) && /return "REOWN_MODULE_EVAL_FAILED"/.test(r) && /return "REOWN_CUSTOM_ELEMENT_CONFLICT"/.test(r) && (loader.match(/await import\(/g) ?? []).length === 1 && (r.match(/await import\(/g) ?? []).length === 1, "single bridge import, chunk / custom-element / eval classified, no separate adapter import");
  check("AC-1", !/EthersAdapter|appkit-adapter-ethers/.test(r) && /adapters: \[wagmiAdapter as never\]/.test(r) && !/adapters: \[\]/.test(r) && (r.match(/new WagmiAdapter\(\{/g) ?? []).length === 1 && /ssr: false/.test(r) && /coinbasePreference: "eoaOnly"/.test(r) && /type AppKitHandle = import\("@reown\/appkit"\)\.AppKit/.test(r), "one WagmiAdapter via the bridge, coinbasePreference all, no EthersAdapter");
  {
    const pkg = JSON.parse(read("package.json")) as { dependencies: Record<string, string> };
    const d = pkg.dependencies;
    check("WG-1", d["@reown/appkit"] === "1.8.24" && d["@reown/appkit-adapter-wagmi"] === "1.8.24" && !d["@reown/appkit-adapter-ethers"] && /^\d+\.\d+\.\d+$/.test(d["wagmi"] ?? "") && /^\d+\.\d+\.\d+$/.test(d["@wagmi/core"] ?? ""), "aligned exact stable Reown 1.8.24 + exact wagmi; EthersAdapter dependency removed");
    const bridge = strip(read("src/lib/reown-appkit-browser.ts"));
    check("WG-2", /export \{ createAppKit \} from "@reown\/appkit";/.test(bridge) && /export \{ WagmiAdapter \} from "@reown\/appkit-adapter-wagmi";/.test(bridge) && !/new |createAppKit\(|window|document|ethers/i.test(bridge.replace(/export \{[^}]*\} from "[^"]*";/g, "")), "bridge statically re-exports AppKit + WagmiAdapter only, no module-scope action");
    check("WG-3", /open\(\{ view: "Connect" \}\)/.test(r) && (r.match(/networks: \[ROBINHOOD_APPKIT_NETWORK\]/g) ?? []).length === 2, "Robinhood-only networks for adapter + AppKit; eip155 Connect view");
    check("WG-4", /reloadAndRetry/.test(p) && /connectNotice === "REOWN_CHUNK_FETCH_FAILED" \|\| connectNotice === "REOWN_CUSTOM_ELEMENT_CONFLICT"/.test(p) && /REOWN_CUSTOM_ELEMENT_CONFLICT: "The wallet interface did not initialize cleanly\. Reload this page once and try again\."/.test(p) && !/"REOWN_CUSTOM_ELEMENT_CONFLICT",?\s*\n?\s*"REOWN_APPKIT/.test(p), "custom-element conflict gets one-time reload recovery and exact copy");
  }
  {
    const panel = readFileSync("src/components/cartel/TreasurySafeCreatePanel.tsx", "utf8");
    const nulls = (panel.match(/setConnectNotice\(null\)/g) ?? []).length;
    check("PN-1", nulls === 1 && /Wallet connection did not finish\. If your wallet app opened/.test(panel) && /Connection code: \{connectNotice\}/.test(panel) && !/error\.message|String\(err/.test(panel), "warning persists until the next explicit attempt; sanitized code only in Technical details");
  }
  check("AC-2", /const graceMs = 5_000;/.test(r) && !/1_000/.test(r), "every modal close gets >=5s grace");
  check("ML-2", !/console\.|\.stack|return[^;]*error\.message|localStorage|sessionStorage/.test(r.slice(r.indexOf("CHUNK_FETCH_PATTERNS"), r.indexOf("async function runCreateAppKit"))), "classifier/loader never logs, stores or returns raw error text");
  const pre = r.slice(r.indexOf("export async function preloadAppKitLibraries"), r.indexOf("async function runCreateAppKit"));
  check("ML-3", pre.length > 0 && !/createAppKit\(|\.ready\(|\.open\(|connect|getWalletProvider|Storage|request\(/.test(pre), "preload helper is file-load only");
  const wpre = wc.slice(wc.indexOf("export async function preloadWalletChooserLibraries"));
  check("ML-4", /typeof window === "undefined"/.test(wpre) && !/ensureAppKit|openAppKitConnect|connect\w*\(/.test(wpre.replace("preloadWalletChooserLibraries", "")), "connector preload wrapper browser-only, no connect");
  check("ML-5", ["REOWN_CHUNK_FETCH_FAILED","REOWN_MODULE_EVAL_FAILED"].every((n) => new RegExp(`case "${n}":\\s*return "${n}"`).test(wc) && new RegExp(`${n}:\\s*"`).test(p)), "new notices mapped and copied");
  check("ML-6", /useEffect\(\(\) => \{\s*if \(!isWalletConnectConfigured\(\)\) return;/.test(p) && /requestIdleCallback/.test(p) && /preloadWalletChooserLibraries\(\)/.test(p), "treasury warmup in useEffect, configured only, idle-scheduled");
  check("ML-7", /connectNotice === "REOWN_CHUNK_FETCH_FAILED"/.test(p) && /Reload and retry/.test(p) && /Reload already tried/.test(p), "chunk failure shows Reload and retry");
  const rr = p.slice(p.indexOf("function reloadAndRetry()"), p.indexOf("function reloadAndRetry()") + 400);
  check("ML-8", /if \(readReloadRecoveryFlag\(\)\)/.test(rr) && (p.match(/window\.location\.reload\(\)/g) ?? []).length === 1 && !/connect/i.test(rr), "reload at most once per flag, no auto-connect");
  const cb = p.slice(p.indexOf("async function connect()"), p.indexOf("async function switchNetwork()"));
  check("ML-9", /clearReloadRecoveryFlag\(\);\s*setReloadAlreadyTried\(false\);\s*await refreshWalletState\(\)/.test(cb), "successful connect clears recovery flag");
  check("ML-10", !p.slice(p.indexOf("CHOOSER_UNAVAILABLE"), p.indexOf("RELOAD_RECOVERY_KEY")).includes('"REOWN_CHUNK_FETCH_FAILED"'), "chunk fetch failure never triggers silent injected fallback");
}

if (failures > 0) {
  console.error(`\n${failures} CHECK(S) FAILED`);
  process.exit(1);
}
{
  const p = readFileSync("src/components/cartel/TreasurySafeCreatePanel.tsx", "utf8");
  check("WR-7b", /REOWN_WALLETCONNECT_UNAVAILABLE: "WalletConnect could not start on this device\. Reload the page and try again\. If it still fails, open CARTEL HQ in your wallet's browser or Chrome\."/.test(p) && !/CHOOSER_UNAVAILABLE[^\]]*REOWN_WALLETCONNECT_UNAVAILABLE/.test(p) && /Connection code: \{connectNotice\}/.test(p), "persistent copy, no injected fallback, sanitized code only");
}
console.log("\nALL CHECKS PASSED");
