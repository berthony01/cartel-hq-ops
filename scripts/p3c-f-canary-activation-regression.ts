/**
 * P3C-F — CANARY ACTIVATION PREPARATION regression.
 *
 * SOURCE/LOGIC-LEVEL ONLY. No network, no database, no wallet, no provider
 * call, no environment value, no transaction. Reads repository source text and
 * pure registry constants.
 */
import { readFileSync } from "node:fs";
import {
  MAINNET_DEPLOYMENT_TX_ENABLED,
  MAINNET_LIQUIDITY_TX_ENABLED,
} from "../src/lib/chain-mainnet-registry";
import { LIQUIDITY_TX_ENABLED } from "../src/lib/chain-registry";

const REGISTRY = "src/lib/chain-mainnet-registry.ts";
const SIM = "src/lib/chain-mainnet-simulation.ts";
const WALLET = "src/lib/chain-mainnet-wallet.ts";
const HANDOFF = "src/lib/chain-mainnet-handoff.functions.ts";
const APPLY = "src/lib/chain-mainnet-verify-apply.ts";
const CANARY = "src/lib/chain-mainnet-canary.functions.ts";
const ROUTE = "src/routes/_authenticated/mainnet-canary.tsx";

const read = (p: string) => readFileSync(p, "utf8");
const registrySrc = read(REGISTRY);
const simSrc = read(SIM);
const walletSrc = read(WALLET);
const handoffSrc = read(HANDOFF);
const applySrc = read(APPLY);
const canarySrc = read(CANARY);
const routeSrc = read(ROUTE);

const stripComments = (s: string) =>
  s.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");

let failures = 0;
function check(id: string, ok: boolean, detail: string) {
  if (ok) console.log(`PASS ${id} — ${detail}`);
  else {
    failures += 1;
    console.error(`FAIL ${id} — ${detail}`);
  }
}

/* A — deployment capability ON, as literal. */
check(
  "A",
  (MAINNET_DEPLOYMENT_TX_ENABLED as boolean) === true &&
    /export const MAINNET_DEPLOYMENT_TX_ENABLED = true as const;/.test(registrySrc),
  "MAINNET_DEPLOYMENT_TX_ENABLED is literal `true as const`",
);

/* B — liquidity stays OFF on both networks. */
check(
  "B1",
  (MAINNET_LIQUIDITY_TX_ENABLED as boolean) === false &&
    /export const MAINNET_LIQUIDITY_TX_ENABLED = false as const;/.test(registrySrc),
  "MAINNET_LIQUIDITY_TX_ENABLED is literal `false as const`",
);
check(
  "B2",
  (LIQUIDITY_TX_ENABLED as boolean) === false &&
    /export const LIQUIDITY_TX_ENABLED = false as const;/.test(read("src/lib/chain-registry.ts")),
  "testnet LIQUIDITY_TX_ENABLED is literal `false as const`",
);

/* C — verifier state writes remain ON. */
check(
  "C",
  /export const MAINNET_VERIFICATION_STATE_WRITES_ENABLED = true as const;/.test(applySrc),
  "MAINNET_VERIFICATION_STATE_WRITES_ENABLED is literal `true as const`",
);

/* D — simulation: correctness only, never authorization. */
check(
  "D1",
  !/deploymentKillSwitchOff/.test(simSrc),
  "stale kill-switch pass condition removed from the simulation",
);
check(
  "D2",
  /result\.sufficientBalance === true;/.test(simSrc) &&
    !/simulationPassed[\s\S]{0,600}MAINNET_DEPLOYMENT_TX_ENABLED/.test(simSrc),
  "simulationPassed no longer depends on the deployment switch",
);
check(
  "D3",
  /deploymentAuthorized: false;/.test(simSrc) && /deploymentAuthorized: false,/.test(simSrc),
  "simulation still authorizes nothing (deploymentAuthorized literal false)",
);
check(
  "D4",
  /authorizationBlockedBy: "RUNTIME_EXECUTION_CONTROL_AND_SEND_WINDOW"/.test(simSrc),
  "authorizationBlockedBy names the real remaining runtime gates",
);
check(
  "D5",
  !/eth_sendTransaction|eth_sendRawTransaction|signTransaction/.test(stripComments(simSrc)),
  "simulation contains no send or signing path",
);

/* E — exactly one executable send call site, no retry, no raw send. */
const walletCode = stripComments(walletSrc);
const sendSites = walletCode.match(/eth_sendTransaction/g) ?? [];
check("E1", sendSites.length === 1, "exactly one executable `eth_sendTransaction` site");
check(
  "E2",
  !/eth_sendRawTransaction|signTransaction|createWalletClient|privateKey/.test(walletCode),
  "no raw-send, signing helper or key material in the wallet helper",
);
check(
  "E3",
  !/(for|while)\s*\([^)]*\)[\s\S]{0,200}eth_sendTransaction/.test(walletCode) &&
    !/retry|rebroadcast|resend/i.test(walletCode),
  "no retry/rebroadcast loop around the send",
);
check(
  "E4",
  !/wallet_switchEthereumChain|wallet_addEthereumChain/.test(walletCode),
  "helper never switches or adds a network",
);

/* F — claim and send-window still read the runtime gate and controls. */
check(
  "F1",
  /claimMainnetDeploymentHandoff[\s\S]{0,2000}readRuntimeExecutionGate\(\)/.test(handoffSrc),
  "CLAIM still consults the server-authoritative runtime gate",
);
check(
  "F2",
  /authorizeMainnetSendWindow[\s\S]{0,2000}readRuntimeExecutionGate\(\)/.test(handoffSrc),
  "SEND WINDOW still consults the server-authoritative runtime gate",
);
check(
  "F3",
  /authorize_launch_chain_production_send_window_issuance/.test(handoffSrc) &&
    /PRODUCTION_SEND_ENABLED !== true/.test(handoffSrc),
  "permit/revision/send-window issuance RPC and compile gate both intact",
);

/* G — arm wrapper: single RPC, expected revision, exact binding, no re-arm. */
const canaryCode = stripComments(canarySrc);
const armRpcs = canaryCode.match(/arm_launch_chain_production_canary_execution/g) ?? [];
check("G1", armRpcs.length === 1, "arm wrapper references exactly one arm RPC");
check(
  "G2",
  /_expected_control_revision: data\.expectedControlRevision/.test(canaryCode) &&
    /_authorization_id: data\.authorizationId/.test(canaryCode) &&
    /_deployment_id: data\.deploymentId/.test(canaryCode),
  "arm is bound to the exact authorization, deployment and expected revision",
);
check(
  "G3",
  !/disengage|clear_emergency|set_execution_enabled|enable_production|re_?arm|reset/i.test(
    canaryCode,
  ),
  "no generic enable / clear-stop / re-arm / reset path exists",
);

/* H — emergency stop is one-way. */
const stopRpcs = canaryCode.match(/engage_launch_chain_production_emergency_stop/g) ?? [];
check("H1", stopRpcs.length === 1, "stop wrapper references exactly one stop RPC");
check(
  "H2",
  /emergency_stop_engaged: false/.test(canaryCode) === false,
  "nothing in the wrapper can set the stop back to false",
);

/* I — server-side owner authorization on every wrapper. */
const ownerChecks = canaryCode.match(/isPlatformOwner\(context\.supabase/g) ?? [];
check("I1", ownerChecks.length === 4, "all four wrappers re-check ownership server-side");
check(
  "I2",
  /is_platform_owner/.test(canaryCode) && /return !error && data === true;/.test(canaryCode),
  "ownership check is server-authoritative and fails closed",
);
check(
  "I3",
  /requireSupabaseAuth/.test(canaryCode),
  "every wrapper is behind authenticated middleware",
);

/* J — the diff adds no liquidity, registration, telegram, migration or secret path. */
const added = [canaryCode, stripComments(routeSrc)].join("\n");
for (const term of [
  "add_?liquidity",
  "liquidity_?(tx|pool|position|attempt)",
  "MAINNET_LIQUIDITY_TX_ENABLED\\s*===\\s*true",
  "register_official_contract",
  "set_launch_contract_address",
  "telegram",
  "client\\.server",
  "SERVICE_ROLE",
  "process\\.env",
  "migration",
]) {
  check(`J:${term}`, !new RegExp(term, "i").test(added), `no \`${term}\` path added`);
}

/* K — nothing state-changing runs on render or import. */
check("K1", !/useEffect/.test(routeSrc), "no effect can trigger an action on render");
check(
  "K2",
  !/setInterval|setTimeout|refetchInterval/.test(routeSrc),
  "no polling or timer-driven invocation",
);
const guarded = [
  "createCanaryDeploymentAttempt",
  "presignMainnetTokenDeployment",
  "claimMainnetDeploymentHandoff",
  "armCanaryExecution",
  "authorizeMainnetSendWindow",
  "persistMainnetDeploymentTxHash",
  "engageCanaryEmergencyStop",
];
for (const fn of guarded) {
  check(
    `K3:${fn}`,
    new RegExp(`useServerFn\\(${fn}\\)`).test(routeSrc),
    `${fn} is only reachable through an explicit handler binding`,
  );
}
check(
  "K4",
  /const sendReady =\s*\n?\s*sendPhrase === SEND_PHRASE/.test(routeSrc) &&
    /windowResult\?\.ok === true/.test(routeSrc),
  "send requires the exact typed phrase AND a valid server send window",
);
check(
  "K5",
  /const armReady = armPhrase === ARM_PHRASE;/.test(routeSrc),
  "claim/arm require the exact typed arm phrase",
);
check(
  "K6",
  /ARM_PHRASE = "ARM MAINNET CANARY"/.test(routeSrc) &&
    /SEND_PHRASE = "SEND ONE MAINNET DEPLOYMENT"/.test(routeSrc),
  "both confirmation phrases are exact",
);

console.log(failures === 0 ? "\nALL CHECKS PASSED" : `\n${failures} CHECK(S) FAILED`);
process.exit(failures === 0 ? 0 : 1);
