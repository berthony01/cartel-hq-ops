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
function sim(o: { persisted?: boolean; cachedLive?: boolean; appKitDisconnectWorks?: boolean; wcDisconnectWorks?: boolean; lagChecks?: number; ensureOk?: boolean }) {
  const log: string[] = [];
  const st = { initialized: !!o.cachedLive, appConnected: !!o.cachedLive, wcSession: !!o.cachedLive, lag: o.lagChecks ?? 0, opened: false };
  const deps: FreshResetDeps = {
    ensure: async () => { log.push("ensure"); if (o.ensureOk === false) return false; if (!st.initialized) { st.initialized = true; if (o.persisted) { st.appConnected = true; st.wcSession = true; } } return true; },
    closeModal: async () => { log.push("close"); },
    disconnectAppKit: async () => { log.push("appkit.disconnect"); if (o.appKitDisconnectWorks !== false) st.appConnected = false; },
    hasWalletConnectSession: () => st.wcSession,
    disconnectWalletConnect: async () => { log.push("wc.disconnect"); if (o.wcDisconnectWorks !== false) st.wcSession = false; },
    cleanupPendingPairings: async () => { log.push("wc.cleanupPairings"); },
    isFresh: () => { log.push("isFresh"); if (st.lag > 0) { st.lag--; return false; } return st.initialized && !st.appConnected && !st.wcSession; },
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
