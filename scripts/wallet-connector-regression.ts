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
import {
  normalizeChainId,
  ROBINHOOD_MAINNET_CHAIN_ID_HEX_CANONICAL,
  ROBINHOOD_MAINNET_SWITCH_CHAIN_ID_HEX,
} from "../src/lib/wallet-connector";

const CONNECTOR = "src/lib/wallet-connector.ts";
const WALLET = "src/lib/chain-mainnet-wallet.ts";
const PANEL = "src/components/cartel/DeploymentWalletConnect.tsx";
const FORM = "src/components/cartel/CanaryIntentForm.tsx";
const ROUTE = "src/routes/_authenticated/mainnet-canary.tsx";
const REGISTRY = "src/lib/chain-mainnet-registry.ts";
const CHAIN_REGISTRY = "src/lib/chain-registry.ts";
const VERIFY_APPLY = "src/lib/chain-mainnet-verify-apply.ts";
const APPKIT = "src/lib/reown-appkit-wallet.ts";
const PKG = "package.json";


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
const appkitSrc = read(APPKIT);
const appkitCode = stripComments(appkitSrc);
const pkgSrc = read(PKG);

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

/* B — the OFFICIAL AppKit singleton owns wallet discovery. 4663 is the only
   declared network, but the strict runtime requirement still lives in the
   post-connect CAIP-10 / live-chain evidence gate (L3/L4), never in the modal. */
check(
  "B1",
  /caipNetworkId: `eip155:\$\{ROBINHOOD_MAINNET_CHAIN_ID\}`/.test(appkitCode) &&
    /id: ROBINHOOD_MAINNET_CHAIN_ID as number/.test(appkitCode) &&
    /networks: \[ROBINHOOD_APPKIT_NETWORK\]/.test(appkitCode),
  "AppKit declares exactly one custom network, built from the mainnet chain constant",
);
check(
  "B2",
  (ROBINHOOD_MAINNET_CHAIN_ID as number) === 4663,
  "ROBINHOOD_MAINNET_CHAIN_ID is 4663 (Robinhood Chain mainnet)",
);
check(
  "B3",
  /enableNetworkSwitch: false/.test(appkitCode) && !/wallet_switchEthereumChain/.test(appkitCode),
  "AppKit never switches networks: the only switch stays the explicit connector helper",
);

check(
  "C1",
  /await import\("@reown\/appkit"\)/.test(appkitCode) &&
    /await import\("@reown\/appkit-adapter-ethers"\)/.test(appkitCode),
  "AppKit packages are dynamically imported inside a browser-executed function",
);
check(
  "C2",
  !/^import .*@reown\/appkit/m.test(appkitCode) &&
    !/@walletconnect\/ethereum-provider/.test(appkitCode + connectorCode) &&
    !/"@walletconnect\/ethereum-provider"/.test(pkgSrc),
  "no static AppKit import and no direct low-level WalletConnect provider dependency remains",
);

check(
  "D1",
  /VITE_WALLETCONNECT_PROJECT_ID/.test(appkitCode) &&
    !/VITE_WALLETCONNECT_PROJECT_ID/.test(connectorCode),
  "the public project id is read from client env in the AppKit module only",
);
check(
  "D2",
  !/projectId\s*[:=]\s*["'`][0-9a-zA-Z]{8,}["'`]/.test(appkitCode + connectorCode),
  "no literal project id is hardcoded",
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
  !/eth_sign|personal_sign|eth_signTypedData|eth_sendTransaction/.test(
    connectorCode + appkitCode,
  ),
  "neither the connector nor the AppKit module ever signs or sends",
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
    (appkitCode.match(/createAppKit\(\{/g) ?? []).length === 1 &&
    /async function runCreateAppKit\([\s\S]*?createAppKit\(\{/.test(appkitCode) &&
    !/createAppKit/.test(connectorCode) &&
    (connectorCode.match(/openAppKitConnect\(/g) ?? []).length === 1 &&
    /openAppKitConnect\(/.test(connectWcBody),
  "createAppKit runs exactly once inside the singleton helper; the chooser opens only from the explicit connect handler",
);
const panelEffect = /useEffect\(\(\) => \{[\s\S]*?\}, \[[^\]]*\]\);/.exec(panelCode)?.[0];
check(
  "J5",
  panelEffect !== undefined &&
    !/inspectMainnetWalletForHandoff/.test(panelEffect) &&
    // Availability detection first; the read-only inspection runs ONLY when a
    // connector is already explicitly active (which is also what refreshes a
    // changed expectedDeployer verdict). An unconnected mount still touches no
    // provider.
    /const active = refreshAvailability\(\);\s*if \(active\) void refresh\(\);\s*return subscribeWalletConnector/.test(
      panelEffect,
    ),
  "panel mount effect detects availability and inspects only an already-active connector",
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
  /export const WALLETCONNECT_CONNECT_TIMEOUT_MS = 45_000;/.test(connectorCode) &&
    /openAppKitConnect\(WALLETCONNECT_CONNECT_TIMEOUT_MS\)/.test(connectorCode) &&
    /timer = setTimeout\(\(\) => finish\(\{ status: "timeout" \}\), timeoutMs\);/.test(appkitCode),
  "the AppKit connect handshake is bounded by the same fixed client timeout",
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
    (connectorCode.match(/openAppKitConnect\(/g) ?? []).length === 1 &&
    /enableReconnect: false/.test(appkitCode) &&
    !/setInterval|retry|reconnect(?!: false)/i.test(connectorCode),
  "timeout path never retries, never reconnects, and AppKit never restores a session on its own",
);
check(
  "K7",
  (panelCode.match(/setBusy\(null\);/g) ?? []).length >= 4 &&
    (panelCode.match(/\} finally \{/g) ?? []).length >= 4,
  "every panel handler clears its busy state in a finally block",
);
check(
  "K8",
  /clearLocalConnectionState\(\);[\s\S]{0,200}disconnectAppKit\(\)/.test(wcBody) &&
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
    /sessionEvidence\.includes\(ROBINHOOD_MAINNET_CHAIN_ID_HEX_CANONICAL\)/.test(wcBody),
  "WalletConnect chain evidence still comes from CAIP-10 session accounts and must include eip155:4663",
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
  /const liveChain = normalizeChainId\(liveRaw\);/.test(wcBody) &&
    /appKitChain === ROBINHOOD_MAINNET_CHAIN_ID_HEX_CANONICAL &&/.test(wcBody) &&
    /liveChain === ROBINHOOD_MAINNET_CHAIN_ID_HEX_CANONICAL/.test(wcBody),
  "an injected AppKit connection records chain evidence only when AppKit and a live eth_chainId both prove 4663",
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
  !/qrModalOptions/.test(appkitCode) &&
    /features: \{/.test(appkitCode) &&
    /swaps: false/.test(appkitCode) &&
    /onramp: false/.test(appkitCode) &&
    /send: false/.test(appkitCode) &&
    /email: false/.test(appkitCode) &&
    /socials: false/.test(appkitCode),
  "no low-level modal options remain and every non-wallet AppKit feature is disabled",
);
check(
  "L8",
  (panelCode.match(/\|\| embedded\}/g) ?? []).length >= 2,
  "both connect buttons are disabled in an embedded preview / in-app browser",
);
check(
  "L9",
  /enableReconnect: false/.test(appkitCode) &&
    !/localStorage|sessionStorage|wc@2/.test(appkitCode),
  "no silent session restoration, and the AppKit module never reads or deletes storage keys itself",
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
  /Connect wallet on Robinhood Chain/.test(panelCode) &&
    !/Robinhood Wallet \/ WalletConnect|MetaMask \/ WalletConnect/.test(panelCode),
  "the WalletConnect button names the required network, never a single wallet brand",
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
  /REOWN_LIBRARY_LOAD_FAILED/.test(appkitCode) &&
    /REOWN_APPKIT_INIT_FAILED/.test(appkitCode) &&
    /REOWN_LIBRARY_LOAD_FAILED/.test(panelCode) &&
    /REOWN_APPKIT_INIT_FAILED/.test(panelCode) &&
    /REOWN_CONNECT_FAILED/.test(panelCode),
  "chunk-load, init and connect failures have distinct sanitized codes with distinct UI copy",
);
const importCatch =
  /await import\("@reown\/appkit-adapter-ethers"\)[\s\S]{0,200}?\} catch \{([\s\S]{0,240}?)\n  \}/.exec(
    appkitCode,
  )?.[1];
check(
  "M5",
  importCatch !== undefined &&
    /REOWN_LIBRARY_LOAD_FAILED/.test(importCatch) &&
    !/REOWN_APPKIT_INIT_FAILED/.test(importCatch),
  "a failed dynamic import returns the library-load code, not the init code",
);
check(
  "M6",
  /APKT002/.test(appkitCode) &&
    /REOWN_ORIGIN_NOT_ALLOWED/.test(appkitCode) &&
    /REOWN_PROJECT_ID_INVALID_OR_MISSING/.test(appkitCode) &&
    /REOWN_RATE_LIMITED/.test(appkitCode) &&
    /return "REOWN_APPKIT_INIT_FAILED";/.test(appkitCode),
  "AppKit error tokens map onto sanitized codes with an init-failure default",
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
  (appkitCode.match(/createAppKit\(\{/g) ?? []).length === 1 &&
    !/\.message|\.stack|console\./.test(appkitCode.replace(/error instanceof Error \? error\.message : String\(error \?\? ""\)/, "")),
  "one init path only, and no raw exception text leaves the AppKit module",
);

/* R — official AppKit configuration baseline. */
check(
  "R1",
  /enableReconnect: false/.test(appkitCode) &&
    /enableNetworkSwitch: false/.test(appkitCode) &&
    /enableWalletConnect: true/.test(appkitCode) &&
    /enableInjected: true/.test(appkitCode) &&
    /enableEIP6963: true/.test(appkitCode) &&
    /enableCoinbase: true/.test(appkitCode) &&
    /allWallets: true/.test(appkitCode),
  "AppKit is configured for broad explicit wallet discovery with no auto-reconnect and no network switching",
);
check(
  "R2",
  /open\(\{ view: "Connect", namespace: "eip155" \}\)/.test(appkitCode) &&
    /"@reown\/appkit": "\^?1\.8\.23"/.test(pkgSrc) &&
    /"@reown\/appkit-adapter-ethers": "\^?1\.8\.23"/.test(pkgSrc),
  "the chooser opens scoped to eip155 through the pinned official AppKit 1.8.23 packages",
);

/* N — explicit Robinhood Chain switch + safe deployer binding. */
const formCode = stripComments(read(FORM));
const switchBody = /export async function requestRobinhoodChainSwitch\(\)[\s\S]*?\n\}/.exec(
  connectorCode,
)?.[0];

check(
  "N1",
  ROBINHOOD_MAINNET_CHAIN_ID_HEX_CANONICAL === "0x1237" &&
    ROBINHOOD_MAINNET_SWITCH_CHAIN_ID_HEX === "0x1237" &&
    normalizeChainId(ROBINHOOD_MAINNET_CHAIN_ID as number) === "0x1237" &&
    !/["']0x1237["']/.test(connectorCode),
  "the switch parameter is the derived canonical hex 0x1237, never a hardcoded literal",
);
check(
  "N2",
  switchBody !== undefined &&
    (switchBody.match(/wallet_switchEthereumChain/g) ?? []).length === 1 &&
    (connectorCode.match(/wallet_switchEthereumChain/g) ?? []).length === 1,
  "exactly one wallet_switchEthereumChain call exists, inside requestRobinhoodChainSwitch",
);
const sameClickBody =
  /export async function connectWalletConnectOnRobinhoodChain\(\)[\s\S]*?\n\}\n/.exec(
    connectorCode,
  )?.[0];
check(
  "N3",
  /requestRobinhoodChainSwitch\(\)/.test(panelCode) &&
    /setBusy\("switch"\)/.test(panelCode) &&
    /Switch to Robinhood Chain/.test(panelCode) &&
    !/(useEffect|attachEvents|refreshAvailability|subscribeWalletConnector)[\s\S]{0,300}requestRobinhoodChainSwitch/.test(
      panelCode,
    ) &&
    // Exactly two call sites in the connector: the definition, and the single
    // same-explicit-click alignment inside connectWalletConnectOnRobinhoodChain.
    sameClickBody !== undefined &&
    (sameClickBody.match(/requestRobinhoodChainSwitch\(\)/g) ?? []).length === 1 &&
    !/requestRobinhoodChainSwitch/.test(
      connectorCode.replace(switchBody ?? "", "").replace(sameClickBody, ""),
    ),
  "the switch is reachable only from the explicit Switch button handler or the same explicit connect click, never mount/re-check/events",
);
check(
  "N4",
  !/wallet_addEthereumChain/.test(connectorCode) &&
    !/wallet_addEthereumChain/.test(panelCode) &&
    !/wallet_addEthereumChain/.test(walletCode) &&
    !/wallet_addEthereumChain/.test(formCode),
  "no wallet_addEthereumChain exists anywhere on the wallet path",
);
check(
  "N5",
  switchBody !== undefined &&
    !/while\s*\(|for\s*\(|setTimeout|setInterval|retry|again/i.test(switchBody) &&
    (switchBody.match(/provider\.request/g) ?? []).length === 1,
  "the switch helper performs a single request with no retry, loop or timer",
);
check(
  "N6",
  switchBody !== undefined &&
    /code === 4001[\s\S]{0,80}NETWORK_SWITCH_REJECTED/.test(switchBody) &&
    /code === 4902[\s\S]{0,120}NETWORK_UNKNOWN_TO_WALLET/.test(switchBody) &&
    /NETWORK_SWITCH_UNSUPPORTED/.test(switchBody) &&
    /NETWORK_SWITCH_FAILED/.test(switchBody) &&
    !/\.message|\.stack|String\(error\)/.test(switchBody) &&
    ["NETWORK_SWITCH_REJECTED", "NETWORK_UNKNOWN_TO_WALLET", "NETWORK_SWITCH_UNSUPPORTED", "NETWORK_SWITCH_FAILED", "NO_ACTIVE_CONNECTOR"].every(
      (code) => panelCode.includes(code),
    ),
  "rejection / unknown-chain / unsupported / failure fail closed with distinct sanitized notices and UI copy",
);
check(
  "N7",
  /if \(result\.ok\) await refresh\(\);/.test(panelCode) &&
    !/presign|arm|claim|sendWindow|eth_sendTransaction/i.test(panelCode),
  "an approved switch re-reads account+chain exactly once and no sequence stage can auto-run",
);
check(
  "N8",
  /const provider = getActiveProvider\(\);/.test(switchBody ?? "") &&
    /NO_ACTIVE_CONNECTOR/.test(switchBody ?? ""),
  "the switch uses the shared active EIP-1193 provider abstraction (WalletConnect or injected)",
);
check(
  "N9",
  /state\.chainId === ROBINHOOD_MAINNET_CHAIN_ID_HEX_CANONICAL/.test(formCode) &&
    /state\.account !== null/.test(formCode) &&
    /getActiveConnectorKind\(\) === null/.test(formCode),
  "deployer auto-binds only when a connector is active and the chain is exactly 4663",
);
check(
  "N10",
  /readOnly=\{deployerLocked\}/.test(formCode) &&
    /if \(deployerLocked\) return;/.test(formCode) &&
    /Source: Connected wallet on Robinhood Chain/.test(formCode),
  "the deployer field is read-only while safely bound and labels its source",
);
check(
  "N11",
  /latest\.recipient\.trim\(\) === ""/.test(formCode) &&
    // Editability before attempt creation is still protected: the ONLY thing
    // that can lock the recipient is an immutable attempt-bound value.
    /const recipientLocked = attemptRecipient !== null;/.test(formCode) &&
    /const attemptRecipient = props\.attemptBoundRecipient\?\.trim\(\) \|\| null;/.test(formCode) &&
    /id="canary-recipient"[\s\S]{0,240}readOnly=\{recipientLocked\}/.test(formCode) &&
    /id="canary-recipient"[\s\S]{0,320}if \(recipientLocked\) return;\s*props\.onRecipient\(event\.target\.value\);/.test(
      formCode,
    ) &&
    // No unconditional lock may ever be reintroduced.
    !/id="canary-recipient"[\s\S]{0,240}readOnly(?!=\{recipientLocked\})/.test(formCode),
  "the recipient defaults only when empty and stays editable unless attempt-bound",
);
check(
  "N12",
  /if \(current\.deployer\.trim\(\)\.toLowerCase\(\) === previous\) current\.onDeployer\(""\);/.test(
    formCode,
  ) && /if \(previous === null\) return;/.test(formCode),
  "disconnect / wrong chain clears only the provisional binding this component set",
);
check(
  "N13",
  /attemptBoundDeployer/.test(formCode) &&
    /const attemptDeployer = props\.attemptBoundDeployer\?\.trim\(\) \|\| null;/.test(formCode) &&
    /const deployerValue = attemptDeployer \?\? props\.deployer;/.test(formCode) &&
    /if \(attemptDeployer\) \{[\s\S]{0,200}return;/.test(formCode),
  "an immutable attempt-bound deployer wins over any connected-wallet default",
);
check(
  "N14",
  (walletCode.match(/eth_sendTransaction/g) ?? []).length === 1 &&
    !/eth_sendTransaction|eth_sign|personal_sign/.test(formCode),
  "still exactly one eth_sendTransaction, and the intent form signs and sends nothing",
);
check(
  "N15",
  !/supabase|createServerFn|useServerFn|\.rpc\(/i.test(formCode) &&
    !/supabase|createServerFn|useServerFn|\.rpc\(/i.test(panelCode) &&
    !/supabase|import\.meta\.env\[/i.test(
      connectorCode.replace(/VITE_WALLETCONNECT_PROJECT_ID/g, "X"),
    ),
  "no database, server function or extra environment access was introduced by the binding",
);
check(
  "N16",
  routeSrc.includes("Intent → Attempt → Presign → Arm → Claim → Send Window → Send → Persist/Verify") &&
    !/wallet_switchEthereumChain|wallet_addEthereumChain/.test(routeSrc),
  "the canary route is unchanged and contains no network-switching call",
);

/* S — reconnect reliability: stable storage namespace + cached single init. */
const disconnectWcBody = /export async function disconnectWalletConnect\(\)[\s\S]*?\n\}/.exec(
  connectorCode,
)?.[0];
const ensureBody = /async function ensureWalletConnectProvider\([\s\S]*?\n\}/.exec(
  connectorCode,
)?.[0];

check(
  "S1",
  /let appKitHandle: AppKitHandle \| null = null;/.test(appkitCode) &&
    /let appKitInitPromise/.test(appkitCode),
  "the AppKit singleton keeps both a cached handle and a single in-flight init promise",
);
check(
  "S2",
  !/localStorage|sessionStorage|indexedDB|removeItem|deleteDatabase|wc@2/.test(connectorCode),
  "no manual localStorage / IndexedDB / WalletConnect key deletion exists",
);
check(
  "S3",
  /if \(appKitHandle\) return \{ appKit: appKitHandle, notice: null \};/.test(appkitCode) &&
    /if \(!appKitInitPromise\) appKitInitPromise = runCreateAppKit\(projectId\);/.test(appkitCode),
  "a repeated connect reuses the cached AppKit instance instead of re-initializing",
);
check(
  "S4",
  /if \(typeof window === "undefined"\)/.test(appkitCode) &&
    !/^\s*(const|let)\s+\w+\s*=\s*window/m.test(appkitCode),
  "AppKit initialization is browser-only and never runs during SSR",
);
check(
  "S5",
  /appKitHandle = null;\s*appKitInitPromise = null;/.test(appkitCode),
  "a failed initialization clears the cache and the in-flight promise so an explicit retry is possible",
);
check(
  "S6",
  disconnectWcBody !== undefined &&
    /clearLocalConnectionState\(\);/.test(disconnectWcBody) &&
    !/initializedWalletConnectProvider|walletConnectInitPromise/.test(disconnectWcBody) &&
    !/initializedWalletConnectProvider|walletConnectInitPromise/.test(
      /function clearLocalConnectionState\(\)[\s\S]*?\n\}/.exec(connectorCode)?.[0] ?? "",
    ),
  "disconnect clears active session state and never destroys the initialized provider cache",
);
check(
  "S7",
  connectWcBody !== undefined &&
    /WALLETCONNECT_TIMEOUT/.test(connectWcBody) &&
    /WRONG_CHAIN_APPROVED/.test(connectWcBody) &&
    !/initializedWalletConnectProvider|walletConnectInitPromise/.test(connectWcBody),
  "rejection, timeout and wrong-chain teardown leave the initialized provider cache intact",
);
check(
  "S8",
  /export async function disconnectAppKit\(\)[\s\S]{0,400}appKit\.disconnect\("eip155"\)/.test(
    appkitCode,
  ) && !/appKitHandle = null/.test(/export async function disconnectAppKit\(\)[\s\S]*?\n\}/.exec(appkitCode)?.[0] ?? ""),
  "disconnect is the official AppKit disconnect and never destroys the singleton",
);
check(
  "S9",
  /REOWN_NOT_CONFIGURED/.test(appkitCode) &&
    /WALLETCONNECT_NOT_CONFIGURED/.test(connectorCode) &&
    /isReownConfigured\(\)/.test(connectorCode),
  "a missing project id still fails closed through the connector notice union",
);
check(
  "S10",
  /getAppKitWalletProvider\(\)/.test(appkitCode) &&
    /appKit\.getIsConnectedState\(\)/.test(appkitCode),
  "connection is confirmed from the real AppKit provider and connection state, never assumed",
);
check(
  "S11",
  /subscribeProviders\(/.test(appkitCode) &&
    /subscribeAccount\(/.test(appkitCode) &&
    /subscribeState\(/.test(appkitCode) &&
    /for \(const off of unsubscribers\)/.test(appkitCode),
  "AppKit subscriptions drive the bounded wait and are all unsubscribed on settle",
);
const createBody = /async function runCreateAppKit\([\s\S]*?\n\}/.exec(appkitCode)?.[0] ?? "";
check(
  "S12",
  createBody.length > 0 && !/\.stack|console\./.test(createBody),
  "the initialization helper never surfaces a stack or logs to the console",
);
check(
  "S13",
  !/supabase|createServerFn|useServerFn|process\.env|VITE_(?!WALLETCONNECT_PROJECT_ID)/.test(
    connectorCode + appkitCode,
  ),
  "no database, server function, secret or extra environment access was introduced",
);

/* T — RUNTIME-API COMPATIBILITY. Every AppKit instance method this app invokes
   must be a real public member of the INSTALLED @reown/appkit 1.8.23 client
   declaration. A hand-written interface can invent a name that only fails in
   the browser, so the names are proven against the package itself. */
const APPKIT_CLIENT_DTS = "node_modules/@reown/appkit/dist/types/src/client/appkit-base-client.d.ts";
const appKitClientDts = read(APPKIT_CLIENT_DTS);
const declaresMember = (name: string) =>
  new RegExp(`^\\s{4}(?!private |protected )${name}\\s*[(:<]`, "m").test(appKitClientDts);

const invokedAppKitMethods = Array.from(
  appkitCode.matchAll(/\b(?:appKit|instance)\.([A-Za-z0-9_]+)\s*\(/g),
  (m) => m[1] as string,
);
check(
  "T1",
  invokedAppKitMethods.length >= 8 && invokedAppKitMethods.every((name) => declaresMember(name)),
  `every invoked AppKit method is declared public in the installed client (${Array.from(new Set(invokedAppKitMethods)).sort().join(", ")})`,
);
check(
  "T2",
  declaresMember("getIsConnectedState") &&
    !/getIsConnected\s*[(:<]/.test(appKitClientDts.replace(/getIsConnectedState/g, "")) &&
    /getIsConnectedState\(\)/.test(appkitCode) &&
    !/\bgetIsConnected\(/.test(appkitCode),
  "connection state is read with the installed getIsConnectedState(); the documented-but-absent getIsConnected() can never be reintroduced",
);
check(
  "T3",
  /type AppKitHandle = import\("@reown\/appkit"\)\.AppKit;/.test(appkitCode) &&
    !/type AppKitHandle = \{/.test(appkitCode),
  "the AppKit instance is typed from the installed package, not from a hand-written interface",
);
check(
  "T4",
  declaresMember("ready") &&
    /await instance\.ready\(\);/.test(appkitCode) &&
    appkitCode.indexOf("await instance.ready()") < appkitCode.indexOf('.open({ view: "Connect"'),
  "the chooser is opened only after the installed public ready() readiness promise resolves",
);
check(
  "T5",
  !/as never/.test(appkitCode.replace(/new EthersAdapter\(\) as never/, "")) &&
    /ROBINHOOD_APPKIT_NETWORK: import\("@reown\/appkit-common"\)\.CaipNetwork/.test(appkitCode) &&
    /networks: \[ROBINHOOD_APPKIT_NETWORK\]/.test(appkitCode),
  "the custom network is typed against the installed CaipNetwork contract with no unsafe cast hiding a required property",
);
check(
  "T6",
  /disconnect\(chainNamespace\?: ChainNamespace\): Promise<void>;/.test(appKitClientDts) &&
    /appKit\.disconnect\("eip155"\)/.test(appkitCode),
  "disconnect uses the installed namespace-scoped signature",
);

/* U — mobile UX correction: one-click connect+align, non-stale account check,
   and launch-selection survival across a wallet hand-off. */
const routeCode = stripComments(routeSrc);

check(
  "U1",
  /const expectedDeployerValid = \/\^0x\[0-9a-fA-F\]\{40\}\$\/\.test/.test(panelCode) &&
    /!account \|\| !expectedDeployerValid \? "—" : accountMatches \? "MATCH" : "MISMATCH"/.test(
      panelCode,
    ),
  "Account check reads — with no valid expected deployer, and only claims MISMATCH against a real expectation",
);
check(
  "U2",
  /const refresh = useCallback\([\s\S]*?\}, \[[^\]]*expectedDeployer[^\]]*\]\);/.test(panelCode) &&
    /if \(active\) void refresh\(\);/.test(panelCode) &&
    /inspectMainnetWalletForHandoff\(expectedDeployer \?\? ""\)/.test(panelCode),
  "the read-only inspection depends on expectedDeployer, so a changed expectation cannot show a stale verdict",
);
check(
  "U3",
  sameClickBody !== undefined &&
    /const connect = await connectWalletConnect\(\);/.test(sameClickBody) &&
    /if \(!connect\.ok\) return \{ connect, switched: null \};/.test(sameClickBody) &&
    /ROBINHOOD_MAINNET_CHAIN_ID_HEX_CANONICAL\) \{\s*return \{ connect, switched: null \};/.test(
      sameClickBody,
    ) &&
    !/wallet_addEthereumChain|setTimeout|while |for \(/.test(sameClickBody) &&
    (sameClickBody.match(/requestRobinhoodChainSwitch\(\)/g) ?? []).length === 1,
  "the same-click alignment connects first, switches at most once, never adds a network and never retries",
);
check(
  "U4",
  /connectWalletConnectOnRobinhoodChain\(\)/.test(panelCode) &&
    /Connect wallet on Robinhood Chain/.test(panelCode) &&
    !/(useEffect|subscribeWalletConnector|refreshAvailability)[\s\S]{0,300}connectWalletConnectOnRobinhoodChain/.test(
      panelCode,
    ),
  "the combined connect+align runs only from the explicit connect button, never on mount, subscription or re-check",
);
const restoreEffect = /useEffect\(\(\) => \{\s*if \(launchId\) return;[\s\S]*?\}, \[launches\.data, launchId\]\);/.exec(
  routeCode,
)?.[0];
check(
  "U5",
  restoreEffect !== undefined &&
    /sessionStorage\.getItem\(LAUNCH_SELECTION_STORAGE_KEY\)/.test(restoreEffect) &&
    /rows\.find\(\(item\) => item\.id === stored\)/.test(restoreEffect) &&
    /if \(!row\)[\s\S]{0,160}removeItem\(LAUNCH_SELECTION_STORAGE_KEY\)/.test(restoreEffect),
  "the restored launch id is accepted only when it still exists in the operator's current launch list, else cleared",
);
check(
  "U6",
  restoreEffect !== undefined &&
    !/createAttempt|presign|claim|arm\(|sendWindow|persist|verify|reconcile|setDeploymentId|setAuthorizationId|connect|switch/i.test(
      restoreEffect,
    ),
  "restoring a launch selection never resumes, creates, presigns, arms, claims, sends, persists, verifies, connects or switches",
);
check(
  "U7",
  (routeCode.match(/sessionStorage\.setItem\(/g) ?? []).length === 1 &&
    /window\.sessionStorage\.setItem\(LAUNCH_SELECTION_STORAGE_KEY, id\)/.test(routeCode) &&
    !/localStorage/.test(routeCode) &&
    !/deployer|recipient|envelope|authorizationId|txHash/.test(
      /const selectLaunch = \(id: string\) => \{[\s\S]*?\n  \};/.exec(routeCode)?.[0] ?? "x",
    ),
  "only the launch id is persisted, in sessionStorage, never an address, envelope, authorization or hash",
);

console.log(failures === 0 ? "\nALL CHECKS PASSED" : `\n${failures} CHECK(S) FAILED`);
process.exit(failures === 0 ? 0 : 1);
