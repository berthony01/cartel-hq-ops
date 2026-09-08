/**
 * P3C-G — WALLETCONNECT / ROBINHOOD WALLET MOBILE CONNECTOR regression.
 *
 * SOURCE/LOGIC-LEVEL ONLY. No network, no database, no wallet, no provider
 * call, no environment value, no transaction.
 */
import { readFileSync } from "node:fs";
import {
  MAINNET_DEPLOYMENT_TX_ENABLED,
  MAINNET_LIQUIDITY_TX_ENABLED,
  MAINNET_VERIFICATION_STATE_WRITES_ENABLED,
  ROBINHOOD_MAINNET_CHAIN_ID,
} from "../src/lib/chain-mainnet-registry";
import { LIQUIDITY_TX_ENABLED } from "../src/lib/chain-registry";

const CONNECTOR = "src/lib/wallet-connector.ts";
const WALLET = "src/lib/chain-mainnet-wallet.ts";
const PANEL = "src/components/cartel/DeploymentWalletConnect.tsx";
const ROUTE = "src/routes/_authenticated/mainnet-canary.tsx";
const REGISTRY = "src/lib/chain-mainnet-registry.ts";
const CHAIN_REGISTRY = "src/lib/chain-registry.ts";

const read = (p: string) => readFileSync(p, "utf8");
const stripComments = (s: string) =>
  s.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");

const connectorSrc = read(CONNECTOR);
const connectorCode = stripComments(connectorSrc);
const walletSrc = read(WALLET);
const walletCode = stripComments(walletSrc);
const panelCode = stripComments(read(PANEL));
const routeSrc = read(ROUTE);
const registrySrc = read(REGISTRY);
const chainRegistrySrc = read(CHAIN_REGISTRY);

let failures = 0;
function check(id: string, ok: boolean, detail: string) {
  if (ok) console.log(`PASS ${id} — ${detail}`);
  else {
    failures += 1;
    console.error(`FAIL ${id} — ${detail}`);
  }
}

/* A — no module-scope browser access in either module. */
function hasModuleScopeWindow(code: string): boolean {
  // Every `window` reference must sit inside a function/arrow body. A crude but
  // effective proxy: no `window` may appear before the first `function`/`=>`.
  const index = code.indexOf("window");
  if (index === -1) return false;
  const firstFn = Math.min(
    ...["function ", "=>", "export function", "async function"]
      .map((token) => {
        const at = code.indexOf(token);
        return at === -1 ? Number.MAX_SAFE_INTEGER : at;
      }),
  );
  return index < firstFn;
}

check("A1", !hasModuleScopeWindow(connectorCode), "connector reads `window` inside functions only");
check("A2", !/window/.test(walletCode), "mainnet wallet module no longer touches `window` at all");

/* B — WalletConnect init uses optionalChains including 4663, never `chains`. */
check(
  "B1",
  /optionalChains:\s*\[ROBINHOOD_MAINNET_CHAIN_ID as number\]/.test(connectorCode),
  "WalletConnect init declares optionalChains from the mainnet chain constant",
);
check(
  "B2",
  (ROBINHOOD_MAINNET_CHAIN_ID as number) === 4663,
  "ROBINHOOD_MAINNET_CHAIN_ID is 4663 (Robinhood Chain mainnet)",
);
check(
  "B3",
  !/(^|[^l])\bchains:\s*\[/.test(connectorCode),
  "deprecated `chains` init option is not used",
);

/* C — the WalletConnect package is loaded by dynamic import only. */
check(
  "C1",
  /await import\("@walletconnect\/ethereum-provider"\)/.test(connectorCode),
  "WalletConnect package is dynamically imported inside a browser-executed function",
);
check(
  "C2",
  !/^import .*@walletconnect\/ethereum-provider/m.test(connectorCode),
  "no static top-level import of the WalletConnect package",
);

/* D — public project id is read from env and never hardcoded. */
check(
  "D1",
  /VITE_WALLETCONNECT_PROJECT_ID/.test(connectorCode),
  "connector reads VITE_WALLETCONNECT_PROJECT_ID from client env",
);
check(
  "D2",
  !/projectId\s*[:=]\s*["'`][0-9a-zA-Z]{8,}["'`]/.test(connectorCode),
  "no literal WalletConnect project id is hardcoded",
);
check(
  "D3",
  /WALLETCONNECT_NOT_CONFIGURED/.test(connectorCode) &&
    /WALLETCONNECT_NOT_CONFIGURED/.test(panelCode),
  "missing project id fails closed with an explicit non-crashing UI state",
);

/* E — exactly one send call, no retry/rebroadcast anywhere on the mainnet path. */
const sendCalls = walletCode.match(/eth_sendTransaction/g) ?? [];
check("E1", sendCalls.length === 1, "mainnet wallet contains exactly one eth_sendTransaction call");
check(
  "E2",
  !/eth_sendRawTransaction/.test(walletCode) && !/for\s*\(|while\s*\(/.test(walletCode),
  "no raw-transaction path and no retry/rebroadcast loop in the mainnet send module",
);
check(
  "E3",
  !/eth_sendTransaction|eth_sign|personal_sign|eth_signTypedData/.test(panelCode),
  "the wallet panel never signs or sends",
);
check(
  "E4",
  /methods:\s*\["eth_sendTransaction"\]/.test(connectorCode),
  "connector requests only the eth_sendTransaction session method (no signing methods)",
);

/* F — no network switching or adding anywhere on the MAINNET connector path. */
for (const [id, code, label] of [
  ["F1", connectorCode, "connector"],
  ["F2", walletCode, "mainnet wallet"],
  ["F3", panelCode, "wallet panel"],
] as const) {
  check(
    id,
    !/wallet_switchEthereumChain|wallet_addEthereumChain/.test(code),
    `${label} never switches or adds a network`,
  );
}

/* G — capability literals unchanged. */
check(
  "G1",
  (MAINNET_DEPLOYMENT_TX_ENABLED as boolean) === true &&
    /export const MAINNET_DEPLOYMENT_TX_ENABLED = true as const;/.test(registrySrc),
  "MAINNET_DEPLOYMENT_TX_ENABLED is still literal `true as const`",
);
check(
  "G2",
  (MAINNET_LIQUIDITY_TX_ENABLED as boolean) === false &&
    /export const MAINNET_LIQUIDITY_TX_ENABLED = false as const;/.test(registrySrc),
  "MAINNET_LIQUIDITY_TX_ENABLED is still literal `false as const`",
);
check(
  "G3",
  (LIQUIDITY_TX_ENABLED as boolean) === false &&
    /export const LIQUIDITY_TX_ENABLED = false as const;/.test(chainRegistrySrc),
  "testnet LIQUIDITY_TX_ENABLED is still literal `false as const`",
);
check(
  "G4",
  (MAINNET_VERIFICATION_STATE_WRITES_ENABLED as boolean) === true &&
    /export const MAINNET_VERIFICATION_STATE_WRITES_ENABLED = true as const;/.test(registrySrc),
  "MAINNET_VERIFICATION_STATE_WRITES_ENABLED is still literal `true as const`",
);

/* H — canary sequence and ARM-before-CLAIM ordering unchanged. */
check(
  "H1",
  routeSrc.includes(
    "Intent → Attempt → Presign → Arm → Claim → Send Window → Send → Persist/Verify",
  ),
  "canary sequence cue is unchanged",
);
check(
  "H2",
  routeSrc.includes("C–E — Typed confirmation: ARM first, then CLAIM") &&
    routeSrc.indexOf("Arm this authorization") < routeSrc.indexOf("Claim authorization"),
  "ARM is still presented and rendered before CLAIM",
);
check(
  "H3",
  routeSrc.indexOf("<DeploymentWalletConnect") < routeSrc.indexOf("B — Managed pre-sign"),
  "the wallet panel is mounted before the transaction execution sections",
);
check(
  "H4",
  !/DeploymentWalletConnect[\s\S]{0,400}onConnected|autoAdvance/.test(routeSrc),
  "connecting a wallet cannot auto-advance the sequence",
);

/* I — no secret material is ever stored by the connector. */
check(
  "I1",
  !/localStorage|sessionStorage|privateKey|mnemonic|seedPhrase/.test(connectorCode),
  "connector stores no key material and writes no browser storage of its own",
);

console.log(failures === 0 ? "\nALL CHECKS PASSED" : `\n${failures} CHECK(S) FAILED`);
process.exit(failures === 0 ? 0 : 1);
