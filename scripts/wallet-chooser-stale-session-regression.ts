/**
 * Mobile wallet chooser stale-session regression: every explicit Connect /
 * Choose another wallet must start from a PROVEN fresh AppKit/WalletConnect
 * state, including after a cold page load that rehydrates a persisted session.
 */
import { readFileSync, existsSync } from "node:fs";
import { execSync } from "node:child_process";
import { performFreshReset, type FreshResetDeps } from "../src/lib/reown-appkit-wallet";

let pass = 0, fail = 0;
const check = (id: string, ok: boolean, label: string) => { ok ? pass++ : fail++; console.log(`${ok ? "PASS" : "FAIL"} ${id} ${label}`); };
const strip = (s: string) => s.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
const appkit = strip(readFileSync("src/lib/reown-appkit-wallet.ts", "utf8"));
const testnet = strip(readFileSync("src/lib/testnet-wallet-connector.ts", "utf8"));
const mainnet = strip(readFileSync("src/lib/wallet-connector.ts", "utf8"));
const route = strip(readFileSync("src/routes/_authenticated/chain-launcher.tsx", "utf8"));

/** Simulated AppKit + UniversalProvider. `persisted` = session in WC storage before init. */
function sim(o: { persisted?: boolean; cachedLive?: boolean; appKitDisconnectWorks?: boolean; wcDisconnectWorks?: boolean; lagChecks?: number; ensureOk?: boolean; ctrlWc?: boolean; ctrlClearWorks?: boolean; ctrlClearThrows?: boolean; ctrlUnreadable?: boolean; externalDirtyAfterFirst?: boolean }) {
  const log: string[] = [];
  const st = { initialized: !!o.cachedLive, appConnected: !!o.cachedLive, wcSession: !!o.cachedLive, lag: o.lagChecks ?? 0, opened: false, ctrlWc: !!o.ctrlWc, clears: 0, freshCalls: 0 };
  const deps: FreshResetDeps = {
    ensure: async () => { log.push("ensure"); if (o.ensureOk === false) return false; if (!st.initialized) { st.initialized = true; if (o.persisted) { st.appConnected = true; st.wcSession = true; } } return true; },
    closeModal: async () => { log.push("close"); },
    disconnectAppKit: async () => { log.push("appkit.disconnect"); if (o.appKitDisconnectWorks !== false) st.appConnected = false; },
    hasWalletConnectSession: () => st.wcSession,
    disconnectWalletConnect: async () => { log.push("wc.disconnect"); if (o.wcDisconnectWorks !== false) st.wcSession = false; },
    cleanupPendingPairings: async () => { log.push("wc.cleanupPairings"); },
    isFresh: () => { log.push("isFresh"); st.freshCalls++; if (o.externalDirtyAfterFirst && st.freshCalls > 1) return false; if (st.lag > 0) { st.lag--; return false; } return st.initialized && !st.appConnected && !st.wcSession; },
    hasControllerWalletConnect: () => { log.push("ctrl.has"); if (o.ctrlUnreadable) throw new Error("x"); return st.ctrlWc; },
    clearControllerConnections: () => { log.push("ctrl.clear"); st.clears++; if (o.ctrlClearThrows) throw new Error("x"); if (o.ctrlClearWorks !== false) st.ctrlWc = false; },
    settle: async () => { log.push("settle"); },
  };
  // Mirrors the connector contract: chooser opens only if reset returned true.
  const connect = async () => { const ok = await performFreshReset(deps); if (ok) { st.opened = true; log.push("open"); } return ok; };
  return { log, st, connect };
}

{ const s = sim({}); const ok = await s.connect();
  check("A", ok && s.log[0] === "ensure" && s.log.indexOf("isFresh") > 0, "cold start: initialize is called before teardown is judged"); }
{ const s = sim({ persisted: true }); const ok = await s.connect();
  const iD = s.log.indexOf("wc.disconnect"), iO = s.log.indexOf("open");
  check("B", ok && s.log.indexOf("appkit.disconnect") > s.log.indexOf("ensure") && iD > 0 && iD < iO, "persisted session revealed by init is disconnected (AppKit + UniversalProvider) before open"); }
{ const s = sim({ persisted: true, wcDisconnectWorks: false }); const ok = await s.connect();
  check("C", !ok && !s.st.opened && !s.log.includes("open"), "chooser never opens while a stale WalletConnect session survives"); }
{ const s = sim({ cachedLive: true }); const ok = await s.connect();
  check("D", ok && s.log.indexOf("appkit.disconnect") < s.log.indexOf("open") && !s.st.appConnected, "cached live connection is disconnected before the fresh chooser"); }
{ const s1 = sim({ persisted: true, appKitDisconnectWorks: false }); const r1 = await s1.connect();
  const s2 = sim({ ensureOk: false }); const r2 = await s2.connect();
  check("E", !r1 && !s1.st.opened && !r2 && !s2.st.opened && !s2.log.includes("appkit.disconnect"), "unproven teardown or failed init fails closed, chooser stays shut"); }
{ const s = sim({ persisted: true, lagChecks: 2 }); const ok = await s.connect();
  const settles = s.log.filter((x) => x === "settle").length;
  const s2 = sim({ persisted: true, lagChecks: 999 }); const r2 = await s2.connect();
  check("E2", ok && settles === 2 && !r2 && s2.log.filter((x) => x === "settle").length <= 6, "async settle is bounded (max 6 checks) and never unbounded"); }
{ const s = sim({ persisted: true }); await s.connect();
  check("E3", s.log.indexOf("close") > 0 && s.log.indexOf("close") < s.log.indexOf("open"), "stale modal is closed before a new Connect view"); }

// ---- Controller (chooser-disabling) state ----
{ const s = sim({ persisted: true, ctrlWc: true }); const ok = await s.connect();
  const iC = s.log.indexOf("ctrl.clear"), iO = s.log.indexOf("open");
  const lastFreshBeforeClear = s.log.slice(0, iC).lastIndexOf("isFresh");
  check("K", ok && s.st.clears === 1 && !s.st.ctrlWc && iC > s.log.indexOf("wc.cleanupPairings") && iC < iO && lastFreshBeforeClear > s.log.indexOf("ctrl.has"), "cold-start stale controller WalletConnect entry with clean external evidence is cleared (after re-proof), then chooser may open"); }
{ const s1 = sim({ persisted: true, ctrlWc: true, wcDisconnectWorks: false }); const r1 = await s1.connect();
  const s2 = sim({ persisted: true, ctrlWc: true, appKitDisconnectWorks: false }); const r2 = await s2.connect();
  const s3 = sim({ persisted: true, ctrlWc: true, externalDirtyAfterFirst: true }); const r3 = await s3.connect();
  check("L", !r1 && !r2 && !r3 && s1.st.clears + s2.st.clears + s3.st.clears === 0 && !s1.st.opened && !s2.st.opened && !s3.st.opened, "external evidence not clean => controller is NEVER cleared; fail closed"); }
{ const s1 = sim({ persisted: true, ctrlWc: true, ctrlClearWorks: false }); const r1 = await s1.connect();
  const s2 = sim({ persisted: true, ctrlWc: true, ctrlClearThrows: true }); const r2 = await s2.connect();
  const s3 = sim({ persisted: true, ctrlUnreadable: true }); const r3 = await s3.connect();
  check("M", !r1 && !r2 && !r3 && !s1.st.opened && !s2.st.opened && !s3.st.opened && s1.log.filter((x) => x === "settle").length <= 6 && s3.st.clears === 0, "uncleared / throwing / unreadable controller state fails closed (bounded)"); }
{ const s = sim({ persisted: true }); const ok = await s.connect();
  check("N", ok && s.st.clears === 0 && s.log.includes("ctrl.has"), "normal fresh state: controller inspected, never mutated"); }

// ---- Exact installed AppKit 1.8.24 source condition ----
const NM = "node_modules/@reown";
const ver = (pkg: string) => JSON.parse(readFileSync(`${NM}/${pkg}/package.json`, "utf8")).version;
const list = readFileSync(`${NM}/appkit-scaffold-ui/dist/esm/src/partials/w3m-connector-list/index.js`, "utf8");
const widget = readFileSync(`${NM}/appkit-scaffold-ui/dist/esm/src/partials/w3m-all-wallets-widget/index.js`, "utf8");
const wuiStyles = readFileSync(`${NM}/appkit-ui/dist/esm/src/composites/wui-list-wallet/styles.js`, "utf8");
const commonConst = readFileSync(`${NM}/appkit-common/dist/esm/src/utils/ConstantsUtil.js`, "utf8");
check("S1", ["appkit", "appkit-controllers", "appkit-scaffold-ui", "appkit-ui", "appkit-common"].every((p) => ver(p) === "1.8.24") && JSON.parse(readFileSync("package.json", "utf8")).dependencies["@reown/appkit-controllers"] === "1.8.24", "installed AppKit packages are 1.8.24; controllers pinned exactly");
check("S2", /const hasWcConnection = ConnectionController\.hasAnyConnection\(CommonConstantsUtil\.CONNECTOR_ID\.WALLET_CONNECT\);\s*const disabled = hasWcConnection;/.test(list) && /item\.subtype === 'walletConnect' \|\| item\.subtype === 'external' \? hasWcConnection : false/.test(list) && /\?disabled=\$\{disabled\}/.test(list), "wallet tiles are disabled exactly when hasAnyConnection(WALLET_CONNECT) is true");
check("S3", /hasAnyConnection\(CommonConstantsUtil\.CONNECTOR_ID\.WALLET_CONNECT\)/.test(widget) && /\?disabled=\$\{hasWcConnection\}/.test(widget) && /button:disabled \{[\s\S]{0,200}?opacity: 0\.5;/.test(wuiStyles), "Search Wallet uses the same flag; disabled button renders at 0.5 opacity");
check("S4", /WALLET_CONNECT: 'walletConnect'/.test(commonConst) && /APPKIT_WALLET_CONNECT_CONNECTOR_ID = "walletConnect"/.test(appkit), "connector id constant matches installed appkit-common");
const bridge = strip(readFileSync("src/lib/reown-appkit-browser.ts", "utf8"));
check("S5", /export \{ ConnectionController \} from "@reown\/appkit-controllers";/.test(bridge) && /hasAnyConnection\(APPKIT_WALLET_CONNECT_CONNECTOR_ID\)/.test(resetBodyFull()) && /setConnections\(\[\], "eip155"\)/.test(resetBodyFull()) && !/from "@reown\/appkit-controllers"/.test(appkit) && !/export (let|const) connectionControllerHandle/.test(appkit), "controller comes only from the lazy browser bridge, module-private, exact public APIs");
function resetBodyFull() { return /export async function resetAppKitConnection\([\s\S]*?\n\}\n/.exec(appkit)?.[0] ?? ""; }

const resetBody = /export async function resetAppKitConnection\([\s\S]*?\n\}\n/.exec(appkit)?.[0] ?? "";
check("A2", !/if \(!appKit\) return true;/.test(resetBody) && /ensureAppKit\(\)/.test(resetBody), "production reset initializes AppKit; empty handle is not freshness proof");
check("B2", /universalProviderHandle\?\.session == null/.test(resetBody) && /await up\.disconnect\(\)/.test(resetBody) && /cleanupPendingPairings\(\)/.test(resetBody) && /universalProviderHandle = universalProvider;/.test(appkit), "production reset uses official UniversalProvider disconnect + pairing cleanup and proves session gone");
check("B3", !/export (let|const) universalProviderHandle/.test(appkit) && (appkit.match(/createAppKit\(\{/g) ?? []).length === 1, "UniversalProvider handle stays module-private; still exactly one createAppKit");
const effects = (route.match(/useEffect\(\(\) => \{[\s\S]*?\}, \[[^\]]*\]\);/g) ?? []);
check("F", effects.every((e) => !/connectTestnet|resetAppKit|ensureAppKit|openAppKit|request\(/.test(e)) && !/^(?!.*function).*ensureAppKit\(\)/m.test(appkit.split("export async function ensureAppKit")[0] ?? ""), "no wallet/provider request or AppKit init on mount");
check("G", !/localStorage|sessionStorage|indexedDB|removeItem|deleteDatabase|wc@2/.test(appkit + testnet + mainnet), "no manual storage / WalletConnect key deletion");
check("H", /const tornDown = await appKit\.resetAppKitConnection\(\);\s*if \(!tornDown\)/.test(testnet) && testnet.indexOf("resetAppKitConnection") < testnet.indexOf("openAppKitConnect"), "testnet connector still fails closed before opening on unproven teardown");
check("I", /sessionEvidence\.includes\(ROBINHOOD_MAINNET_CHAIN_ID_HEX_CANONICAL\)/.test(mainnet) && /notice: "STALE_SESSION_TEARDOWN_FAILED"/.test(mainnet), "mainnet 4663 evidence gate and fail-closed teardown intact");
const changed = execSync("git diff --name-only HEAD; git ls-files --others --exclude-standard", { encoding: "utf8" }).split("\n").filter(Boolean);
const bad = changed.filter((f) => /^(contracts\/|artifacts\/|supabase\/)|treasury-safe|chain-mainnet|launch-artifact-registry|execution-control|liquidity|lifecycle|wallet-connector\.ts$/.test(f));
check("J", bad.length === 0 && existsSync("src/lib/reown-appkit-wallet.ts"), `no prohibited surface changed (${bad.join(", ") || "none"})`);
console.log(`\n${pass} passed, ${fail} failed`);
if (fail) process.exit(1);
