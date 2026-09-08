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
import { normalizeChainId } from "../src/lib/wallet-connector";

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

/* B — WalletConnect PROPOSES 4663 as OPTIONAL so wallet discovery stays broad
   across EVM wallets. The strict 4663 requirement lives in the post-connect
   CAIP-10 evidence gate (checks L3/L4), never in modal discovery. */
check(
  "B1",
  /optionalChains:\s*\[ROBINHOOD_MAINNET_CHAIN_ID as number\]/.test(connectorCode),
  "WalletConnect init declares `optionalChains` from the mainnet chain constant",
);
check(
  "B2",
  (ROBINHOOD_MAINNET_CHAIN_ID as number) === 4663,
  "ROBINHOOD_MAINNET_CHAIN_ID is 4663 (Robinhood Chain mainnet)",
);
check(
  "B3",
  !/(^|[^l])chains:\s*\[/.test(connectorCode),
  "no required `chains` namespace: wallet discovery is not hard-gated on chain 4663",
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

/* F — network ADDING is absent everywhere; switching exists ONLY in the single
   explicit connector helper and never in the wallet/send module or the panel. */
check(
  "F1",
  !/wallet_addEthereumChain/.test(connectorCode) &&
    (connectorCode.match(/wallet_switchEthereumChain/g) ?? []).length === 1,
  "connector never adds a network and contains exactly one wallet_switchEthereumChain call",
);
for (const [id, code, label] of [
  ["F2", walletCode, "mainnet wallet"],
  ["F3", panelCode, "wallet panel"],
] as const) {
  check(
    id,
    !/wallet_switchEthereumChain|wallet_addEthereumChain/.test(code),
    `${label} never switches or adds a network itself`,
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
    !/connectWalletConnect\(\)/.test(wcBody.slice(wcBody.indexOf("{"))) &&
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
  /clearLocalConnectionState\(\);[\s\S]{0,200}tearDownWalletConnect\(provider\)/.test(wcBody) &&
    /function clearLocalConnectionState\(\)[\s\S]{0,400}activeProvider = null;[\s\S]{0,200}activeKind = null;[\s\S]{0,200}sessionChainEvidence = null;/.test(
      connectorCode,
    ),
  "timeout/failure clears the local active provider, kind, name and session evidence",
);

/* L — mobile WalletConnect hardening (chain evidence, config, teardown). */
check(
  "L1",
  normalizeChainId(4663) === "0x1237" &&
    normalizeChainId("0x1237") === "0x1237" &&
    normalizeChainId("0X01237") === "0x1237" &&
    normalizeChainId(0) === "0x0",
  "numeric and hex-string chain ids both normalize to canonical lowercase hex",
);
check(
  "L2",
  [4663.5, -1, Number.MAX_SAFE_INTEGER + 1, "4663", "abc", "0x", "", null, undefined, {}].every(
    (value) => normalizeChainId(value) === null,
  ),
  "malformed, negative, unsafe, decimal-string and non-scalar chain ids fail closed",
);
check(
  "L3",
  /session\?\.namespaces\?\.\["eip155"\]\?\.accounts/.test(connectorCode) &&
    /readSessionChainEvidence\(provider\)/.test(wcBody) &&
    /evidence\.includes\(ROBINHOOD_MAINNET_CHAIN_ID_HEX_CANONICAL\)/.test(wcBody),
  "WalletConnect chain evidence comes from CAIP-10 session accounts and must include eip155:4663",
);
const wrongChainAt = wcBody.indexOf("WRONG_CHAIN_APPROVED");
check(
  "L4",
  wrongChainAt > -1 &&
    wrongChainAt < wcBody.indexOf("activeProvider = provider;") &&
    /WRONG_CHAIN_APPROVED/.test(panelCode),
  "a session without Robinhood Chain returns the distinct WRONG_CHAIN_APPROVED notice without activating the provider",
);
check(
  "L5",
  /methods:\s*\["eth_sendTransaction"\]/.test(connectorCode) &&
    /events:\s*\["accountsChanged", "chainChanged"\]/.test(connectorCode),
  "the session still negotiates eth_sendTransaction plus account/chain events",
);
check(
  "L6",
  !/rpcMap:/.test(connectorCode) &&
    !/ROBINHOOD_MAINNET_PUBLIC_DIAGNOSTIC_RPC_URL/.test(connectorCode) &&
    !/ROBINHOOD_MAINNET_MANAGED_RPC_ENV|ROBINHOOD_MAINNET_RPC_URL/.test(connectorCode),
  "modal baseline restore: no rpcMap at all, and no diagnostic or managed RPC reference in the connector",
);
check(
  "L7",
  !/qrModalOptions/.test(connectorCode) &&
    !/favicon\.ico/.test(connectorCode) &&
    /icons:\s*\[\]/.test(connectorCode),
  "modal baseline restore: no qrModalOptions and an empty metadata icons array, exactly as in the last-known-working modal revision",
);
check(
  "L8",
  (panelCode.match(/\|\| embedded\}/g) ?? []).length >= 2,
  "both connect buttons are disabled in an embedded preview / in-app browser",
);
check(
  "L9",
  wcBody.indexOf("hasPersistedSession(provider)") > -1 &&
    wcBody.indexOf("hasPersistedSession(provider)") < wcBody.indexOf(".connect()"),
  "a persisted WalletConnect session is torn down before a fresh explicit connect",
);
check(
  "L10",
  !/localStorage|sessionStorage|wc@2/.test(connectorCode) &&
    /export async function disconnectWalletConnect\(\)[\s\S]{0,400}clearLocalConnectionState\(\);/.test(
      connectorCode,
    ),
  "explicit disconnect clears local state without touching WalletConnect storage keys directly",
);
const attachBody = /function attachEvents\(provider: Eip1193Provider\): void \{([\s\S]*?)\n\}/.exec(
  connectorCode,
)?.[1];
check(
  "L11",
  attachBody !== undefined &&
    /detachEvents\(\);/.test(attachBody) &&
    /removeListener\("accountsChanged"/.test(connectorCode),
  "listeners are named and detached before re-attachment, so they cannot accumulate",
);
check(
  "L12",
  /chainId = normalizeChainId\(raw\);/.test(walletCode) &&
    /getActiveSessionChainEvidence\(\)/.test(walletCode) &&
    /evidence\.includes\(chainId\)/.test(walletCode),
  "the mainnet pre-send guard accepts numeric chain ids and cross-checks them against session evidence",
);


/* M — multi-wallet correction: neutral naming, sanitized split diagnostics. */
check(
  "M1",
  /Mobile wallet \/ WalletConnect/.test(panelCode) &&
    !/Robinhood Wallet \/ WalletConnect/.test(panelCode),
  "the WalletConnect button uses generic multi-wallet naming",
);
check(
  "M2",
  /Browser wallet/.test(panelCode),
  "the injected connector is still offered as 'Browser wallet'",
);
check(
  "M3",
  /Robinhood Wallet is recommended/.test(panelCode) &&
    /not required/.test(panelCode) &&
    /MetaMask and other EVM wallets/.test(panelCode),
  "panel copy recommends Robinhood Wallet rather than requiring it and names other EVM wallets",
);
check(
  "M4",
  /WALLETCONNECT_LIBRARY_LOAD_FAILED/.test(connectorCode) &&
    /WALLETCONNECT_INIT_FAILED/.test(connectorCode) &&
    /WALLETCONNECT_LIBRARY_LOAD_FAILED/.test(panelCode) &&
    /WALLETCONNECT_INIT_FAILED/.test(panelCode),
  "library-load and provider-init failures have distinct notice codes with distinct UI copy",
);
const importCatch =
  /await import\("@walletconnect\/ethereum-provider"\)[\s\S]{0,200}?\} catch \{([\s\S]{0,240}?)\n  \}/.exec(
    connectorCode,
  )?.[1];
check(
  "M5",
  importCatch !== undefined &&
    /WALLETCONNECT_LIBRARY_LOAD_FAILED/.test(importCatch) &&
    !/WALLETCONNECT_INIT_FAILED/.test(importCatch),
  "a failed dynamic import returns the library-load code, not the init code",
);
const initCatch =
  /EthereumProvider\.init\(\{[\s\S]*?\} catch \{([\s\S]{0,240}?)\n  \}/.exec(connectorCode)?.[1];
check(
  "M6",
  initCatch !== undefined &&
    /WALLETCONNECT_INIT_FAILED/.test(initCatch) &&
    !/WALLETCONNECT_LIBRARY_LOAD_FAILED/.test(initCatch),
  "a failed EthereumProvider.init returns the init code, not the library-load code",
);
check(
  "M7",
  !/catch\s*\(\s*[A-Za-z_$][\w$]*\s*\)\s*\{[\s\S]{0,400}?(\.message|\.stack|String\(\s*[A-Za-z_$][\w$]*\s*\))/.test(
    connectorCode.replace(
      /const timedOut = error instanceof Error && error\.message === "WALLETCONNECT_TIMEOUT";/,
      "",
    ),
  ) && !/console\.(log|error|warn|debug)/.test(connectorCode),
  "no raw exception message, stack or console output leaves the connector",
);
check(
  "M8",
  !/http(s)?:\/\//.test(stripComments(read(PANEL))) &&
    !/projectId|VITE_WALLETCONNECT_PROJECT_ID|relay/i.test(panelCode),
  "the panel surfaces no URL, relay endpoint or project id",
);
check(
  "M9",
  /notice: "WALLETCONNECT_LIBRARY_LOAD_FAILED"/.test(connectorCode) &&
    (connectorCode.match(/EthereumProvider\.init/g) ?? []).length === 1,
  "the split diagnostics did not introduce a second init path",
);

/* R — rollback to the last-known-working modal init baseline. */
const initBlock = /EthereumProvider\.init\(\{([\s\S]*?)\n    \}\);/.exec(connectorCode)?.[1];
const initKeys = (initBlock ?? "")
  .split("\n")
  .map((line) => /^\s{6}([A-Za-z]+)[,:]/.exec(line)?.[1])
  .filter((key): key is string => key !== undefined);
check(
  "R1",
  initBlock !== undefined &&
    initKeys.join(",") === "projectId,optionalChains,showQrModal,methods,events,metadata",
  "init options exactly match the last-known-working modal baseline option set, in order",
);
check(
  "R2",
  initBlock !== undefined &&
    /showQrModal:\s*true/.test(initBlock) &&
    /optionalChains:\s*\[ROBINHOOD_MAINNET_CHAIN_ID as number\]/.test(initBlock) &&
    !/\bchains:/.test(initBlock),
  "the chooser modal stays enabled and 4663 is proposed as optional, never as a required chain",
);


console.log(failures === 0 ? "\nALL CHECKS PASSED" : `\n${failures} CHECK(S) FAILED`);
process.exit(failures === 0 ? 0 : 1);
