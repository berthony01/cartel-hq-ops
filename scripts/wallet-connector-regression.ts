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
/** The panel's ONLY mount/subscription effect, extracted once and reused. */
const panelMountEffect = /useEffect\(\(\) => \{[\s\S]*?\}, \[refresh, refreshAvailability\]\);/.exec(
  panelCode,
)?.[0];

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
    /VITE_WALLETCONNECT_PROJECT_ID/.test(connectorCode) &&
    /await import\("\.\/reown-appkit-wallet"\)/.test(connectorCode),
  "the public project id stays client-visible while AppKit runtime code remains dynamically isolated",
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
    /let visibleBudgetMs = timeoutMs;/.test(appkitCode) &&
    /timeoutTimer = setTimeout\(\(\) => finish\(\{ status: "timeout" \}\), visibleBudgetMs\);/.test(
      appkitCode,
    ),
  "the AppKit connect handshake is bounded by the same fixed visible-time budget",
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
check(
  "L4",
  !/WRONG_CHAIN_APPROVED/.test(connectorCode) &&
    !/WRONG_CHAIN_APPROVED/.test(panelCode) &&
    /evidence = sessionEvidence\.includes\(ROBINHOOD_MAINNET_CHAIN_ID_HEX_CANONICAL\)/.test(wcBody),
  "a session without Robinhood Chain stays connected (Gate 1) and simply records no chain evidence",
);
check(
  "L5",
  // RE-PINNED: the live chain read is now hoisted once for the whole
  // post-connect proof block; it is still a real `eth_chainId` provider read.
  // RE-PINNED: the live chain read is hoisted into `readLiveChainId`, which is
  // still a real `eth_chainId` provider read and nothing weaker.
  /const liveChain = await readLiveChainId\(provider\);/.test(wcBody) &&
    /async function readLiveChainId[\s\S]{0,200}method: "eth_chainId"/.test(connectorCode) &&
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
  /Connect Wallet/.test(panelCode) &&
    !/Connect wallet on Robinhood Chain/.test(panelCode) &&
    !/Robinhood Wallet \/ WalletConnect|MetaMask \/ WalletConnect/.test(panelCode),
  "one neutral Connect Wallet button: connection is not named after a network or a single wallet brand",
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
    // RE-PINNED to an exact structural proof: the panel's ONLY switch call site
    // is the explicit runSwitch handler, and the mount/subscription effect
    // cannot reach it.
    (panelCode.match(/requestRobinhoodChainSwitch\(\)/g) ?? []).length === 1 &&
    /const runSwitch = useCallback\(async \(\) => \{[\s\S]*?requestRobinhoodChainSwitch\(\)/.test(
      panelCode,
    ) &&
    panelMountEffect !== undefined &&
    !/requestRobinhoodChainSwitch|runSwitch\(/.test(panelMountEffect) &&
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
  // CANARY SAFETY CONTRACT (superseding the old "editable recipient" rule):
  // a matched connected wallet on Robinhood Chain 4663 forces the recipient to
  // the SAME address as the deployer and locks it.
  /if \(!latest\.attemptBoundRecipient\?\.trim\(\) && latest\.recipient\.trim\(\)\.toLowerCase\(\) !== matched\) \{\s*\n\s*latest\.onRecipient\(matched\);/.test(
    formCode,
  ) &&
    /const recipientLocked = attemptRecipient !== null \|\| boundWallet !== null;/.test(formCode) &&
    /const attemptRecipient = props\.attemptBoundRecipient\?\.trim\(\) \|\| null;/.test(formCode) &&
    /const recipientValue = attemptRecipient \?\? props\.recipient;/.test(formCode) &&
    /id="canary-recipient"[\s\S]{0,240}readOnly=\{recipientLocked\}/.test(formCode) &&
    /id="canary-recipient"[\s\S]{0,320}if \(recipientLocked\) return;\s*props\.onRecipient\(event\.target\.value\);/.test(
      formCode,
    ) &&
    // The lock must stay derived from state; no unconditional lock may appear.
    !/id="canary-recipient"[\s\S]{0,240}readOnly(?!=\{recipientLocked\})/.test(formCode) &&
    // NEGATIVE TRIPWIRE: the superseded "empty-only default" rule must not return.
    !/latest\.recipient\.trim\(\) === ""/.test(formCode),
  "a matched 4663 wallet forces recipient == deployer and locks it; attempt-bound recipient still wins",
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
    !/initializedWalletConnectProvider|walletConnectInitPromise/.test(connectWcBody),
  "rejection and timeout leave the initialized provider cache intact",
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
    /export function isWalletConnectConfigured\(\)[\s\S]{0,300}VITE_WALLETCONNECT_PROJECT_ID/.test(
      connectorCode,
    ),
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

/* V — mobile deep-link handoff remains one explicit pending attempt. */
const openConnectBody = /export async function openAppKitConnect\([\s\S]*?\n\}/.exec(appkitCode)?.[0] ?? "";
check(
  "V1",
  /modalClosed = true;[\s\S]{0,120}tryResolveConnected\(\);[\s\S]{0,120}scheduleVisibleRejection\(\);/.test(
    openConnectBody,
  ) && !/250/.test(openConnectBody),
  "modal close re-checks connection and no longer rejects after the brittle 250ms delay",
);
check(
  "V2",
  /if \(settled \|\| !modalClosed \|\| document\.hidden \|\| !document\.hasFocus\(\)\) return;/.test(
    openConnectBody,
  ) && /if \(!settled && !document\.hidden && document\.hasFocus\(\)\)/.test(openConnectBody),
  "a hidden or backgrounded modal close cannot resolve as rejection",
);
check(
  "V3",
  /const graceMs = handoffObserved \? 5_000 : 1_000;/.test(openConnectBody) &&
    /rejectionTimer = setTimeout/.test(openConnectBody) &&
    /finish\(\{ status: "rejected" \}\)/.test(openConnectBody),
  "a visible manual dismissal still rejects after a bounded one-second grace",
);
check(
  "V4",
  /const handleVisibilityChange = \(\) => \{[\s\S]{0,240}pauseVisibleBudget\(\)/.test(
    openConnectBody,
  ) &&
    /const handleBlur = \(\) => \{[\s\S]{0,160}pauseVisibleBudget\(\)/.test(openConnectBody) &&
    /visibleBudgetMs = Math\.max\(0, visibleBudgetMs - \(Date\.now\(\) - visibleStartedAt\)\)/.test(
      openConnectBody,
    ),
  "the 45-second timeout budget pauses while hidden or handed off to the wallet app",
);
check(
  "V5",
  /visibilitychange/.test(openConnectBody) &&
    /window\.addEventListener\("focus", handleFocus\)/.test(openConnectBody) &&
    /const handleFocus = \(\) => \{\s*tryResolveConnected\(\);/.test(openConnectBody) &&
    /subscribeProviders\(\(\) => tryResolveConnected\(\)\)/.test(openConnectBody) &&
    /subscribeAccount\(\(\) => tryResolveConnected\(\)\)/.test(openConnectBody),
  "visibility, focus, provider and account evidence can settle the original pending attempt",
);
check(
  "V6",
  !/setInterval|requestAnimationFrame|while\s*\(/.test(openConnectBody) &&
    /enableReconnect: false/.test(appkitCode) &&
    !/\bsubscribeProvider\(/.test(appkitCode),
  "handoff awareness adds no polling or auto-reconnect and uses only installed AppKit subscriptions",
);
check(
  "V7",
  /document\.removeEventListener\("visibilitychange", handleVisibilityChange\)/.test(
    openConnectBody,
  ) &&
    /window\.removeEventListener\("blur", handleBlur\)/.test(openConnectBody) &&
    /window\.removeEventListener\("focus", handleFocus\)/.test(openConnectBody),
  "all document lifecycle listeners are removed when the attempt settles",
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
  // RE-PINNED: the panel now compares the connector's canonical validated
  // account with `expectedDeployer` itself, so the dependency is still real.
  /const refresh = useCallback\([\s\S]*?\}, \[[^\]]*expectedDeployer[^\]]*\]\);/.test(panelCode) &&
    /if \(active\) void refresh\(\);/.test(panelCode) &&
    /setAccountMatches\(state\.account !== null && expected !== null && state\.account === expected\);/.test(
      panelCode,
    ),
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
  !/connectWalletConnectOnRobinhoodChain/.test(panelCode) &&
    /connectWalletConnect\(\)/.test(panelCode) &&
    // RE-PINNED structurally: connecting is reachable only from explicit
    // operator handlers (the Connect button and the teardown-first
    // "Choose another wallet"), never from the mount/subscription effect.
    panelMountEffect !== undefined &&
    !/runConnect|runChooseAnotherWallet|connectWalletConnect|connectInjected/.test(
      panelMountEffect,
    ) &&
    (panelCode.match(/void runConnect\(\);/g) ?? []).length === 1 &&
    /await runConnect\(\);\s*\n\s*\}, \[clearInspection, refreshAvailability, runConnect\]\);/.test(
      panelCode,
    ),
  "the panel connects through Gate 1 only, from the explicit button or the teardown-first chooser, never on mount, subscription or re-check",
);
const restoreEffect = /useEffect\(\(\) => \{\s*if \(launchId\) return;[\s\S]*?\}, \[launches\.data, launchId\]\);/.exec(
  routeCode,
)?.[0];
check(
  "U5",
  restoreEffect !== undefined &&
    /localStorage\.getItem\(LAUNCH_SELECTION_STORAGE_KEY\)/.test(restoreEffect) &&
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
  (routeCode.match(/localStorage\.setItem\(/g) ?? []).length === 1 &&
    /window\.localStorage\.setItem\(LAUNCH_SELECTION_STORAGE_KEY, id\)/.test(routeCode) &&
    !/sessionStorage/.test(routeCode) &&
    !/deployer|recipient|envelope|authorizationId|txHash/.test(
      /const selectLaunch = \(id: string\) => \{[\s\S]*?\n  \};/.exec(routeCode)?.[0] ?? "x",
    ),
  "only the launch id is persisted, in localStorage, never an address, envelope, authorization or hash",
);

/* X — Gate 1 / Gate 2 separation (A–G). */
const classifyBody = /export function classifyWalletConnection\([\s\S]*?\n\}\n/.exec(
  connectorCode,
)?.[0];
const postConnectBody = wcBody?.slice(wcBody.indexOf("const provider = outcome.provider"));
check(
  "X1",
  classifyBody !== undefined &&
    /DISCONNECTED/.test(classifyBody) &&
    /CONNECTED_WRONG_CHAIN/.test(classifyBody) &&
    /CONNECTED_CHAIN_UNAVAILABLE/.test(classifyBody) &&
    /CONNECTED_READY/.test(classifyBody),
  "A — the four wallet states are classified explicitly and never collapsed",
);
check(
  "X2",
  classifyBody !== undefined &&
    /normalizeChainId\(input\.liveChainId\) === ROBINHOOD_MAINNET_CHAIN_ID_HEX_CANONICAL/.test(
      classifyBody,
    ),
  "B — CONNECTED_READY requires a live 4663 chain read, never session approval alone",
);
check(
  "X3",
  classifyBody !== undefined &&
    !/request\(|eth_chainId|switchEthereum|disconnect|await /.test(classifyBody),
  "C — classification is pure: no provider request, no switch, no teardown, no side effect",
);
check(
  "X4",
  postConnectBody !== undefined &&
    postConnectBody.length > 0 &&
    // RE-PINNED: teardown after connect now exists for IDENTITY failures only
    // (no account, or conflicting account evidence). The chain-evidence block
    // itself still never disconnects and never approves a wrong chain.
    !/WRONG_CHAIN_APPROVED/.test(postConnectBody) &&
    !/disconnectAppKit|clearLocalConnectionState/.test(
      postConnectBody.slice(postConnectBody.indexOf("let evidence")),
    ) &&
    (
      postConnectBody.match(
        /failClosed\("(NO_ACCOUNT|WALLET_ACCOUNT_MISMATCH|WALLET_ACCOUNT_AMBIGUOUS)"\)/g,
      ) ?? []
    ).length === 5,
  "D — Gate 1 connect tears down only for a failed current-session identity proof, never for being on another EVM network",
);

check(
  "X5",
  (panelCode.match(/requestRobinhoodChainSwitch\(\)/g) ?? []).length === 1 &&
    /status === "CONNECTED_WRONG_CHAIN"/.test(panelCode) &&
    !/wallet_addEthereumChain/.test(panelCode),
  "E — exactly one explicit switch call site, only from the wrong-chain branch, never adding a network",
);
check(
  "X6",
  /status === "CONNECTED_CHAIN_UNAVAILABLE"/.test(panelCode) &&
    /Robinhood Chain is unavailable in this wallet/.test(panelCode) &&
    /isChainUnavailableSwitchNotice/.test(panelCode),
  "F — a proven unavailable chain shows the connected-but-unavailable branch instead of disconnecting",
);
check(
  "X7",
  /NETWORK_SWITCH_REJECTED[\s\S]{0,200}stays connected/.test(panelCode) &&
    /independent expected-deployer, live chain-id/.test(panelCode),
  "G — a declined switch keeps the wallet connected, and downstream guards are stated as authoritative",
);


/* W — WALLET-ID CORRECTION. Every explicit Connect is a FRESH handshake, and a
   previously connected AppKit account/provider can never satisfy it. */
const openBody =
  /export async function openAppKitConnect\([\s\S]*?\n\}\n/.exec(appkitCode)?.[0] ?? "";
const resetBody =
  /export async function resetAppKitConnection\([\s\S]*?\n\}\n/.exec(appkitCode)?.[0] ?? "";

check(
  "W1",
  resetBody.length > 0 &&
    /await appKit\.disconnect\("eip155"\);/.test(resetBody) &&
    /appKit\.getIsConnectedState\(\) === false &&\s*\n\s*getAppKitAddress\(\) === null &&\s*\n\s*getAppKitWalletProvider\(\) === null/.test(
      resetBody,
    ) &&
    /catch \{\s*\n\s*return false;/.test(resetBody),
  "teardown is PROVEN from AppKit state, and an unprovable teardown returns false",
);
check(
  "W2",
  openBody.length > 0 &&
    /if \(hasAppKitConnectionEvidence\(\)\) return \{ status: "failed", notice: "REOWN_STALE_SESSION" \};/.test(
      openBody,
    ) &&
    openBody.indexOf("hasAppKitConnectionEvidence()") < openBody.indexOf("new Promise"),
  "a pre-existing AppKit connection fails the connect attempt closed before any chooser opens",
);
check(
  "W3",
  /let chooserStarted = false;/.test(openBody) &&
    /const tryResolveConnected = \(\) => \{\s*\n(?:\s*\/\/.*\n)*\s*if \(!chooserStarted\) return;/.test(
      openBody,
    ) &&
    (openBody.match(/chooserStarted = true;/g) ?? []).length === 2,
  "only evidence arising after THIS attempt's chooser opened can settle the connection",
);
{
  const freshBlock = wcBody.slice(0, wcBody.indexOf("openAppKitConnect("));
  check(
    "W4",
    freshBlock.includes("clearLocalConnectionState();") &&
      /const tornDown = await appKit\.resetAppKitConnection\(\);/.test(freshBlock) &&
      /if \(!tornDown\) \{[\s\S]{0,320}notice: "STALE_SESSION_TEARDOWN_FAILED"/.test(freshBlock),
    "the connector clears local handles and proves AppKit teardown BEFORE opening the chooser, else fails closed",
  );
}
check(
  "W5",
  // RE-PINNED to the STRONGER contract: the live approved-account list is read
  // as a membership set, an empty list fails closed, and the AppKit current
  // account (plus its CAIP-10 form) must agree with the selected account.
  /const approvedAccounts = await readApprovedAccounts\(provider\);/.test(wcBody) &&
    /if \(approvedAccounts\.length === 0\) return await failClosed\("NO_ACCOUNT"\);/.test(wcBody) &&
    /const snapshot = appKit\.getAppKitAccountSnapshot\(\);/.test(wcBody) &&
    /if \(!approvedAccounts\.includes\(selectedAccount\)\) \{\s*\n\s*return await failClosed\("WALLET_ACCOUNT_MISMATCH"\);/.test(
      wcBody,
    ),
  "the live provider account is cross-checked against AppKit's address and disagreement fails closed",
);
check(
  "W6",
  /const forLiveChain = sessionAccounts\.filter\(\(entry\) => entry\.chainId === liveChain\);/.test(
    wcBody,
  ) &&
    /forLiveChain\.length > 0 && !forLiveChain\.some\(\(e\) => e\.address === selectedAccount\)/.test(
      wcBody,
    ) &&
    /return await failClosed\("WALLET_ACCOUNT_MISMATCH"\);/.test(wcBody),
  "CAIP-10 accounts for the LIVE active chain must contain the live account, else fail closed",
);
{
  const failClosedBody =
    /const failClosed = async \([\s\S]*?\n  \};/.exec(wcBody)?.[0] ?? "";
  check(
    "W7",
    /clearLocalConnectionState\(\);/.test(failClosedBody) &&
      /await appKit\.disconnectAppKit\(\);/.test(failClosedBody) &&
      /state: emptyState\(notice\)/.test(failClosedBody) &&
      !/account:/.test(failClosedBody),
    "every identity failure disconnects, clears state and exposes an EMPTY state — never the stale address",
  );
}
check(
  "W8",
  wcBody.indexOf("walletConnectProvider = provider;") > wcBody.indexOf('failClosed("NO_ACCOUNT")') &&
    wcBody.indexOf("activeProvider = provider;") >
      wcBody.indexOf('failClosed("WALLET_ACCOUNT_MISMATCH")'),
  "the provider becomes active only AFTER the current-session identity proofs pass",
);
check(
  "W9",
  /const runChooseAnotherWallet = useCallback\(async \(\) => \{[\s\S]*?await disconnect\(\);[\s\S]*?clearInspection\(\);[\s\S]*?await runConnect\(\);/.test(
    panelCode,
  ) && /void runChooseAnotherWallet\(\);[\s\S]{0,120}Choose another wallet/.test(panelCode),
  "Choose another wallet tears the current wallet down and clears the readout before the chooser opens",
);
check(
  "W10",
  /setWalletLabel\(null\);\s*\n\s*clearInspection\(\);\s*\n\s*try \{\s*\n\s*let result = await connectWalletConnect\(\)/.test(
    panelCode,
  ),
  "a new Connect click clears any previously displayed wallet address first",
);
check(
  "W11",
  /STALE_SESSION_TEARDOWN_FAILED:/.test(panelCode) &&
    /STALE_SESSION_REUSE_REFUSED:/.test(panelCode) &&
    /WALLET_ACCOUNT_MISMATCH:/.test(panelCode) &&
    /case "REOWN_STALE_SESSION":\s*\n\s*return "STALE_SESSION_REUSE_REFUSED";/.test(connectorCode),
  "the three new fail-closed outcomes are sanitized codes with operator copy",
);
check(
  "W12",
  // NEGATIVE TRIPWIRE: reconnecting the SAME wallet stays possible — nothing
  // pins, remembers or bans a previously used address anywhere.
  !/lastConnectedAddress|previousAccount|bannedAddress|!== previousAddress/.test(
    connectorCode + appkitCode + panelCode,
  ) && /enableReconnect: false/.test(appkitCode),
  "no remembered/blocked address exists: the same wallet may reconnect after a clean teardown",
);
check(
  "W13",
  !/eth_sendTransaction|eth_sendRawTransaction|signTransaction|personal_sign|eth_sign|wallet_addEthereumChain/.test(
    [openBody, resetBody, wcBody, panelCode].join("\n"),
  ) &&
    !/presign|armCanary|claim|sendWindow|createCanaryDeploymentAttempt/i.test(
      [openBody, resetBody, wcBody].join("\n"),
    ),
  "this correction introduces no sign, send, add-chain, presign, ARM, CLAIM or send-window path",
);
check(
  "W14",
  // Gate separation preserved: no chain requirement gates the connection itself.
  !/CONNECTED_WRONG_CHAIN|requestRobinhoodChainSwitch|wallet_switchEthereumChain/.test(
    wcBody.slice(0, wcBody.indexOf("let evidence")),
  ),
  "a wrong-chain wallet still stays connected: identity proofs never switch or require 4663",
);


/* ------------------------------------------------------------------ */
/* A1–A10 — CURRENT-ACCOUNT IDENTITY (never array order)               */
/* ------------------------------------------------------------------ */

check(
  "A1",
  /getAppKitAccountSnapshot\(\)/.test(appkitCode) &&
    /appKit\.getAccount\("eip155"\)/.test(appkitCode) &&
    /appKit\.subscribeAccount\(\(\) => listener\(\), "eip155"\)/.test(appkitCode),
  "the current account is read from AppKit's real namespace-scoped getAccount/subscribeAccount API",
);
check(
  "A2",
  // NEGATIVE TRIPWIRE: no index-zero identity anywhere in the wallet stack.
  !/accounts\[0\]|liveAccountRaw\[0\]|eth_accounts"\s*\}\)\s*\)\[0\]/.test(
    connectorCode + walletCode,
  ),
  "no connector or pre-send path derives the account identity from array index 0",
);
check(
  "A3",
  /let activeAccount: string \| null = null;/.test(connectorCode) &&
    /export function getActiveAccount\(\): string \| null \{\s*return activeAccount;/.test(
      connectorCode,
    ),
  "a single canonical validated active account exists in connector state",
);
check(
  "A4",
  /let selectedAccount: string \| null = appKitCurrent;/.test(connectorCode) &&
    /if \(approvedAccounts\.length !== 1\) return await failClosed\("WALLET_ACCOUNT_AMBIGUOUS"\);/.test(
      connectorCode,
    ),
  "the AppKit current account wins; with no current-account signal only a single approved account is accepted",
);
check(
  "A5",
  /if \(!approvedAccounts\.includes\(selectedAccount\)\) \{\s*return await failClosed\("WALLET_ACCOUNT_MISMATCH"\);/.test(
    connectorCode,
  ),
  "a selected account absent from the wallet's approved accounts fails closed",
);
check(
  "A6",
  /if \(appKitCaip !== null && appKitCaip !== selectedAccount\) \{\s*return await failClosed\("WALLET_ACCOUNT_MISMATCH"\);/.test(
    connectorCode,
  ) &&
    /forLiveChain\.length > 0 && !forLiveChain\.some\(\(e\) => e\.address === selectedAccount\)/.test(
      connectorCode,
    ),
  "CAIP-10 current-account and live-chain session-account disagreement both fail closed",
);
check(
  "A7",
  connectorCode.indexOf("activeAccount = selectedAccount;") >
    connectorCode.indexOf('failClosed("WALLET_ACCOUNT_MISMATCH")') &&
    /activeAccount = selectedAccount;\s*\n\s*activeAccountVerified = true;/.test(connectorCode),
  "the canonical account is written only after every identity proof passed",
);
check(
  "A8",
  /accountsChanged: \(\) => \{\s*\n\s*void revalidateActiveAccount\(\)/.test(connectorCode) &&
    /if \(notice !== null\) invalidateAccountIdentity\(notice\);/.test(connectorCode) &&
    /return "ACTIVE_ACCOUNT_CHANGED";/.test(connectorCode) &&
    /function invalidateAccountIdentity[\s\S]{0,200}clearLocalConnectionState\(\);/.test(
      connectorCode,
    ),
  "accountsChanged invalidates the connection instead of silently switching deployment identity",
);
check(
  "A9",
  /const state = await readWalletConnectorState\(\);[\s\S]{0,400}setAccountVerified\(state\.accountVerified\);/.test(
    panelCode,
  ) &&
    /accountVerified \? "VERIFIED CURRENT SESSION" : "UNVERIFIED"/.test(panelCode) &&
    !/inspectMainnetWalletForHandoff/.test(panelCode),
  "the panel displays the connector's validated account plus a visible current-session proof marker",
);
check(
  "A10",
  /let account: string \| null = getActiveAccount\(\);/.test(walletCode) &&
    /!approved\.includes\(account\)\) account = null;/.test(walletCode),
  "the pre-send handoff inspection uses the canonical account and fails closed if it is no longer approved",
);
check(
  "A11",
  // Canary rule unchanged: deployer and recipient both come from the connector
  // state account, which is now the validated canonical account.
  /readWalletConnectorState\(\)/.test(stripComments(read(FORM))) &&
    !/accounts\[0\]/.test(stripComments(read(FORM))),
  "deployer = recipient is still bound only from the validated connector account",
);
check(
  "A12",
  !/eth_sendTransaction|eth_sendRawTransaction|wallet_addEthereumChain|personal_sign/.test(
    [connectorCode.slice(connectorCode.indexOf("function revalidateActiveAccount")), panelCode].join(
      "\n",
    ),
  ),
  "no account-identity path introduces a sign, send or add-chain call",
);


/* ------------------------------------------------------------------ */
/* B1–B8 — FAIL-CLOSED RE-PROOF HARDENING                              */
/* ------------------------------------------------------------------ */

check(
  "B1",
  /if \(approved\.length === 0\) return "ACTIVE_ACCOUNT_CHANGED";/.test(connectorCode) &&
    /if \(!approved\.includes\(canonical\)\) return "ACTIVE_ACCOUNT_CHANGED";/.test(
      connectorCode,
    ) &&
    // NEGATIVE TRIPWIRE: the old "only check when non-empty" loophole is gone.
    !/approved\.length > 0 && !approved\.includes/.test(connectorCode + walletCode),
  "an empty or unreadable approved-account list invalidates the connection instead of passing",
);
check(
  "B2",
  // `readApprovedAccounts` returns [] for a throw, a non-array and an empty
  // list alike, and [] is now an invalidation — so a read failure fails closed.
  /async function readApprovedAccounts[\s\S]{0,400}\} catch \{\s*\n\s*return \[\];/.test(
    connectorCode,
  ) && /if \(approved\.length === 0\) return "ACTIVE_ACCOUNT_CHANGED";/.test(connectorCode),
  "an approved-account read failure is indistinguishable from empty and fails closed",
);
check(
  "B3",
  /const proofNotice = await proveCanonicalAccount\(provider, canonical\);/.test(connectorCode) &&
    /if \(proofNotice !== null\) \{\s*\n\s*invalidateAccountIdentity\(proofNotice\);/.test(
      connectorCode,
    ),
  "every state re-check runs the full canonical proof and invalidates on failure",
);
check(
  "B4",
  /if \(current !== null && current !== canonical\) return "ACTIVE_ACCOUNT_CHANGED";/.test(
    connectorCode,
  ) &&
    /if \(currentCaip !== null && currentCaip !== canonical\) return "ACTIVE_ACCOUNT_CHANGED";/.test(
      connectorCode,
    ),
  "a changed AppKit CURRENT account invalidates even while the old account remains approved",
);
check(
  "B5",
  /return approved\.length === 1 \? null : "WALLET_ACCOUNT_AMBIGUOUS";/.test(connectorCode),
  "no AppKit current-account signal with multiple approved accounts fails closed as ambiguous",
);
check(
  "B6",
  /appKitAccountUnsubscribe = subscribeAppKitAccount\(\(\) => \{\s*\n\s*void revalidateActiveAccount\(\)/.test(
    connectorCode,
  ) &&
    /async function attachAppKitAccountWatch\(\): Promise<void> \{\s*\n\s*detachAppKitAccountWatch\(\);/.test(
      connectorCode,
    ) &&
    (connectorCode.match(/await attachAppKitAccountWatch\(\);/g) ?? []).length === 1 &&
    /function clearLocalConnectionState\(\): void \{\s*\n\s*detachEvents\(\);\s*\n\s*detachAppKitAccountWatch\(\);/.test(
      connectorCode,
    ),
  "exactly one AppKit account watch is installed for WalletConnect and removed on every clear/disconnect",
);
check(
  "B7",
  /if \(account === null \|\| approved\.length === 0 \|\| !approved\.includes\(account\)\) account = null;/.test(
    walletCode,
  ),
  "the pre-send handoff refuses an account unless a non-empty approved list contains the canonical one",
);
check(
  "B8",
  // NEGATIVE TRIPWIRE: invalidation never substitutes another account, and this
  // hardening adds no execution surface. The ONLY two canonical assignments are
  // the injected single-approved-account case (unambiguous by construction) and
  // the WalletConnect account proven from AppKit's current-account signal.
  (connectorCode.match(/activeAccount = [^n][^;]*;/g) ?? []).join("|") ===
    "activeAccount = approved[0] as string;|activeAccount = selectedAccount;" &&
    !/activeAccount = current|activeAccount = accounts\[/.test(connectorCode) &&
    !/eth_sendTransaction|eth_sendRawTransaction|wallet_addEthereumChain|personal_sign/.test(
      connectorCode.slice(
        connectorCode.indexOf("async function proveCanonicalAccount"),
        connectorCode.indexOf("function attachEvents("),
      ),
    ),
  "re-proof never selects a replacement account and introduces no sign, send or add-chain path",
);

console.log(failures === 0 ? "\nALL CHECKS PASSED" : `\n${failures} CHECK(S) FAILED`);
process.exit(failures === 0 ? 0 : 1);
