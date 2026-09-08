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
  ROBINHOOD_MAINNET_CHAIN_ID,
} from "../src/lib/chain-mainnet-registry";
import { MAINNET_VERIFICATION_STATE_WRITES_ENABLED } from "../src/lib/chain-mainnet-verify-apply";
import { LIQUIDITY_TX_ENABLED } from "../src/lib/chain-registry";

const CONNECTOR = "src/lib/wallet-connector.ts";
const WALLET = "src/lib/chain-mainnet-wallet.ts";
const PANEL = "src/components/cartel/DeploymentWalletConnect.tsx";
const ROUTE = "src/routes/_authenticated/mainnet-canary.tsx";
const REGISTRY = "src/lib/chain-mainnet-registry.ts";
const CHAIN_REGISTRY = "src/lib/chain-registry.ts";
const VERIFY_APPLY = "src/lib/chain-mainnet-verify-apply.ts";

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
const verifyApplySrc = read(VERIFY_APPLY);

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
const sendRegion = walletCode.slice(walletCode.indexOf("eth_sendTransaction") - 400);
check(
  "E2",
  !/eth_sendRawTransaction/.test(walletCode) &&
    !/while\s*\(/.test(walletCode) &&
    !/for\s*\(/.test(sendRegion) &&
    !/setTimeout|setInterval|retr(y|ies)\s*[({=]/.test(walletCode),
  "no raw-transaction path, no loop around the send, no timer or retry in the mainnet send module",
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
    /export const MAINNET_VERIFICATION_STATE_WRITES_ENABLED = true as const;/.test(verifyApplySrc),
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
check(
  "H5",
  routeSrc.indexOf("<DeploymentWalletConnect") < routeSrc.indexOf("A — Exact production intent"),
  "the wallet panel renders before section A — Exact production intent",
);
check(
  "H6",
  /title="Connect Deployment Wallet"/.test(panelCode),
  "the panel is titled 'Connect Deployment Wallet'",
);

/* I — no secret material is ever stored by the connector. */
check(
  "I1",
  !/localStorage|sessionStorage|privateKey|mnemonic|seedPhrase/.test(connectorCode),
  "connector stores no key material and writes no browser storage of its own",
);

/* J — EXPLICIT CONNECT ONLY. Rendering must never touch a provider. */
const activeProviderBody = /export function getActiveProvider\(\)[^{]*\{([\s\S]*?)\n\}/.exec(
  connectorCode,
)?.[1];
check(
  "J1",
  activeProviderBody !== undefined &&
    !/readInjectedProvider|window/.test(activeProviderBody) &&
    /return activeProvider;/.test(activeProviderBody),
  "getActiveProvider returns only an explicitly activated provider (no window.ethereum fallback)",
);
const activeKindBody = /export function getActiveConnectorKind\(\)[^{]*\{([\s\S]*?)\n\}/.exec(
  connectorCode,
)?.[1];
check(
  "J2",
  activeKindBody !== undefined &&
    !/readInjectedProvider|injected"/.test(activeKindBody) &&
    /return activeKind;/.test(activeKindBody),
  "getActiveConnectorKind never infers 'injected' from mere provider presence",
);
const requestAccounts = connectorCode.match(/eth_requestAccounts/g) ?? [];
const connectInjectedBody = /export async function connectInjected\(\)[\s\S]*?\n\}/.exec(
  connectorCode,
)?.[0];
check(
  "J3",
  requestAccounts.length === 1 &&
    connectInjectedBody !== undefined &&
    /eth_requestAccounts/.test(connectInjectedBody),
  "eth_requestAccounts exists only inside the explicit connectInjected path",
);
const connectWcBody = /export async function connectWalletConnect\(\)[\s\S]*?\n\}/.exec(
  connectorCode,
)?.[0];
check(
  "J4",
  connectWcBody !== undefined &&
    /EthereumProvider\.init/.test(connectWcBody) &&
    (connectorCode.match(/EthereumProvider\.init/g) ?? []).length === 1 &&
    (connectorCode.match(/\.connect\(\)/g) ?? []).length === 1,
  "EthereumProvider.init and WalletConnect connect() are reachable only via explicit connectWalletConnect",
);
const panelEffect = /useEffect\(\(\) => \{[\s\S]*?\}, \[[^\]]*\]\);/.exec(panelCode)?.[0];
check(
  "J5",
  panelEffect !== undefined &&
    !/inspectMainnetWalletForHandoff/.test(panelEffect) &&
    /^[\s\S]*?refreshAvailability\(\);\s*return subscribeWalletConnector/.test(panelEffect) &&
    !/refresh\(\)/.test(panelEffect.slice(0, panelEffect.indexOf("return subscribeWalletConnector"))),
  "panel mount effect performs availability detection only, never an inspection call",
);

check(
  "J6",
  /const active = refreshAvailability\(\);[\s\S]{0,120}if \(!active\)/.test(panelCode),
  "panel inspection is gated on an explicitly active connector",
);
check(
  "J7",
  !/eth_accounts|eth_chainId|eth_requestAccounts/.test(panelCode),
  "the panel itself issues no provider request",
);

/* K — mobile reliability: embedded-context warning + bounded handshake. */
check(
  "K1",
  /export function isEmbeddedBrowserContext\(\)/.test(connectorCode) &&
    /window\.self !== window\.top/.test(connectorCode),
  "connector exposes a presence-only embedded-context detector",
);
check(
  "K2",
  /isEmbeddedBrowserContext/.test(panelCode) && /embedded \?/.test(panelCode),
  "panel warns about embedded preview / in-app browser before connection",
);
check(
  "K3",
  /Open standalone preview/.test(panelCode) &&
    /onClick=\{\(\) => \{\s*window\.open\(standaloneUrl/.test(panelCode) &&
    !/location\.(href|replace|assign)\s*=/.test(panelCode),
  "standalone open is an explicit manual action and never an automatic redirect",
);
const wcBody = connectWcBody ?? "";
check(
  "K4",
  /WALLETCONNECT_CONNECT_TIMEOUT_MS/.test(connectorCode) &&
    /export const WALLETCONNECT_CONNECT_TIMEOUT_MS = 45_000;/.test(connectorCode) &&
    /Promise\.race\(\[handshake, timeout\]\)/.test(connectorCode),
  "WalletConnect handshake is bounded by a fixed client timeout",
);
check(
  "K5",
  /WALLETCONNECT_TIMEOUT/.test(connectorCode) && /WALLETCONNECT_TIMEOUT/.test(panelCode),
  "a distinct WALLETCONNECT_TIMEOUT notice exists with user-facing copy",
);
check(
  "K6",
  wcBody.length > 0 &&
    !/connectWalletConnect\(\)/.test(wcBody.slice(1)) &&
    (connectorCode.match(/\.connect\(\)/g) ?? []).length === 1 &&
    !/setInterval|retry|reconnect/i.test(connectorCode),
  "timeout path never retries, never reconnects, never re-invokes connect()",
);
check(
  "K7",
  (panelCode.match(/setBusy\(null\);/g) ?? []).length >= 4 &&
    (panelCode.match(/\} finally \{/g) ?? []).length >= 4,
  "every panel handler clears its busy state in a finally block",
);
check(
  "K8",
  /walletConnectProvider = null;[\s\S]{0,120}activeProvider = null;[\s\S]{0,80}activeKind = null;/.test(
    wcBody,
  ),
  "timeout/failure clears the local active provider, kind and session references",
);


console.log(failures === 0 ? "\nALL CHECKS PASSED" : `\n${failures} CHECK(S) FAILED`);
process.exit(failures === 0 ? 0 : 1);
