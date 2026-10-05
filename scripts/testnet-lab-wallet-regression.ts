/**
 * Testnet Lab mobile wallet regression (Robinhood Chain Testnet 46630).
 * Behavioural checks run the real chain-launcher functions against a mock
 * EIP-1193 provider; structural checks read the production sources.
 */
import { readFileSync } from "node:fs";
import { execSync } from "node:child_process";

let pass = 0;
let fail = 0;
function check(id: string, ok: boolean, label: string) {
  if (ok) pass++;
  else fail++;
  console.log(`${ok ? "PASS" : "FAIL"} ${id} ${label}`);
}
const read = (p: string) => readFileSync(p, "utf8");
const strip = (s: string) => s.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");

const connector = strip(read("src/lib/testnet-wallet-connector.ts"));
const launcher = strip(read("src/lib/chain-launcher.ts"));
const route = strip(read("src/routes/_authenticated/chain-launcher.tsx"));
const sim = strip(read("src/lib/chain-simulation.ts"));
const appkit = strip(read("src/lib/reown-appkit-wallet.ts"));
const mainnet = strip(read("src/lib/wallet-connector.ts"));

// 1 — mobile chooser path does not require window.ethereum
const chooserFn = connector.slice(connector.indexOf("export async function connectTestnetChooser"), connector.indexOf("export async function connectTestnetInjected"));
check("T1", chooserFn.length > 0 && !/window\.ethereum|getInjectedProvider|connectWallet\(/.test(chooserFn) && /openAppKitConnect/.test(chooserFn), "chooser connect uses AppKit/WalletConnect, never window.ethereum");
check("T1b", !/window\.ethereum/.test(route) && !/No browser wallet detected/.test(route), "Testnet Lab page has no window.ethereum dependency or 'No browser wallet detected' gate");

// 2 — testnet scoped to 46630; AppKit authorizes both official networks, mainnet default
check("T2", /ROBINHOOD_TESTNET_CHAIN_ID !==|!== ROBINHOOD_TESTNET_CHAIN_ID/.test(launcher) && !/4663\b(?!0)/.test(launcher.replace(/46630/g, "")), "launcher send gates compare against testnet chain only");
check("T2b", /caipNetworkId: `eip155:\$\{ROBINHOOD_TESTNET_CHAIN_ID\}`/.test(appkit) && (appkit.match(/networks: \[ROBINHOOD_APPKIT_NETWORK, ROBINHOOD_TESTNET_APPKIT_NETWORK\]/g) ?? []).length === 2 && /defaultNetwork: ROBINHOOD_APPKIT_NETWORK,/.test(appkit), "AppKit networks = [mainnet 4663, testnet 46630], mainnet default");
check("T2c", /enableNetworkSwitch: false/.test(appkit) && /enableReconnect: false/.test(appkit) && !/wallet_switchEthereumChain|wallet_addEthereumChain/.test(appkit), "AppKit never switches/adds networks and never reconnects");

// 3 — mainnet connector still requires 4663
check("T3", /sessionEvidence\.includes\(ROBINHOOD_MAINNET_CHAIN_ID_HEX_CANONICAL\)/.test(mainnet) && !/46630|TESTNET/.test(mainnet), "mainnet connector still requires live eip155:4663 evidence and knows nothing of testnet");

// 4 — explicit connect only (no connect/request on mount)
const effects = route.match(/useEffect\(\(\) => \{[\s\S]*?\}, \[[^\]]*\]\);/g) ?? [];
check("T4", effects.every((e) => !/connectTestnet|connectWallet|eth_requestAccounts|requestTestnet|broadcast/.test(e)), "no useEffect connects, switches, adds or sends");
check("T4b", !/eth_requestAccounts/.test(connector) && /onClick=\{[^}]*(handleConnect|connect)/i.test(route), "connect only from explicit click handlers");

// 5 — choose another wallet tears down first
const chooseFn = connector.slice(connector.indexOf("export async function chooseAnotherTestnetWallet"));
check("T5", /await disconnectTestnetWallet\(\);\s*return await connectTestnetChooser\(\);/.test(chooseFn), "choose another wallet disconnects before opening chooser");
check("T5b", /clearLocal\(\);[\s\S]*resetAppKitConnection\(\);\s*if \(!tornDown\)[\s\S]*return \{ ok: false/.test(chooserFn) && chooserFn.indexOf("resetAppKitConnection") < chooserFn.indexOf("openAppKitConnect"), "prior session teardown is proven before the chooser opens");

// 6 — explicit switch/add only
check("T6", (route.match(/requestTestnetSwitch\(\)|requestTestnetAdd\(\)/g) ?? []).length >= 2 && /async function handleAddNetwork/.test(route) && !/requestTestnet/.test(connector), "switch/add only from explicit handlers; connector never switches");

// Behavioural: mock provider through the real launcher
type Call = { method: string; params?: unknown[] };
function mock(state: { accounts: string[]; chain: string; balance: string }) {
  const calls: Call[] = [];
  return {
    calls,
    state,
    provider: {
      request: async ({ method, params }: Call) => {
        calls.push({ method, params });
        if (method === "eth_accounts") return state.accounts;
        if (method === "eth_chainId") return state.chain;
        if (method === "eth_getBalance") return state.balance;
        if (method === "eth_sendTransaction") return "0x" + "ab".repeat(32);
        if (method === "wallet_switchEthereumChain") return null;
        throw new Error("unexpected");
      },
    },
  };
}
const ACC = "0x1111111111111111111111111111111111111111";
const OTHER = "0x2222222222222222222222222222222222222222";
const L = await import("../src/lib/chain-launcher");
const code = "0x6000" as `0x${string}`;

// 7 — reads from active connector
{
  const m = mock({ accounts: [ACC], chain: "0xb626", balance: "0x10" });
  L.setLauncherProvider(m.provider, ACC);
  const a = await L.readAccount();
  const c = await L.readChainId();
  const b = await L.readBalanceWei(ACC);
  check("T7", a === ACC && c === 46630 && b === 16n && m.calls.map((x) => x.method).join() === "eth_accounts,eth_chainId,eth_getBalance", "account/network/balance read from the bound connector");
  L.setLauncherProvider(null, null);
  check("T7b", (await L.readAccount()) === null && (await L.readChainId()) === null, "no bound connector → no reads (no injected fallback)");
}

// 8 — wrong chain stays connected but cannot broadcast
{
  const m = mock({ accounts: [ACC], chain: "0x1237", balance: "0x0" }); // 4663
  L.setLauncherProvider(m.provider, ACC);
  let threw = false;
  try { await L.broadcastTokenDeployment(ACC, code); } catch { threw = true; }
  check("T8", threw && L.getLauncherAccount() === ACC && !m.calls.some((x) => x.method === "eth_sendTransaction"), "wrong chain (4663) refuses send, stays connected");
  threw = false;
  try { await L.broadcastTestDeployment(ACC); } catch { threw = true; }
  check("T8b", threw && !m.calls.some((x) => x.method === "eth_sendTransaction"), "test deployment also refuses on wrong chain");
}

// 9 — live account gate + same connector
{
  const m = mock({ accounts: [OTHER], chain: "0xb626", balance: "0x0" });
  L.setLauncherProvider(m.provider, ACC);
  let threw = false;
  try { await L.broadcastTokenDeployment(ACC, code); } catch { threw = true; }
  check("T9", threw && !m.calls.some((x) => x.method === "eth_sendTransaction"), "live account ≠ displayed deployer refuses send");
  m.state.accounts = [ACC];
  let threw2 = false;
  try { await L.broadcastTokenDeployment(OTHER, code); } catch { threw2 = true; }
  check("T9b", threw2 && !m.calls.some((x) => x.method === "eth_sendTransaction"), "displayed deployer ≠ selected account refuses send");
  const h = await L.broadcastTokenDeployment(ACC, code);
  const send = m.calls.find((x) => x.method === "eth_sendTransaction");
  check("T9c", h === "0x" + "ab".repeat(32) && !!send && (send.params?.[0] as { from: string }).from === ACC, "valid gate sends through the SAME bound provider");
  L.setLauncherProvider(null, null);
}
check("T9d", /const liveChainId = await readChainId\(\);[\s\S]*evaluatePreSignGate[\s\S]*createTokenDeploymentAttempt/.test(route), "PCART token path gates live chain+account before creating an attempt");
check("T9e", /preChain !== 46630[\s\S]*?return;[\s\S]*?createDeploymentAttempt/.test(route), "test path gates live chain+account before creating an attempt");
check("T9f", /from "\.\/chain-launcher"/.test(sim) && !/window\.ethereum/.test(sim), "simulation preflight uses the bound connector readers");

// 10 — prohibited surfaces untouched vs saved head
const changed = execSync("git diff --name-only HEAD; git ls-files --others --exclude-standard", { encoding: "utf8" }).split("\n").filter(Boolean);
const prohibited = changed.filter((f) => /^(contracts\/|artifacts\/|supabase\/)|treasury-safe|wallet-connector\.ts$|chain-mainnet|launch-artifact-registry|execution-control|liquidity|lifecycle|\.artifact\.ts$/.test(f));
check("T10", prohibited.length === 0, `no prohibited surfaces changed (${prohibited.join(", ") || "none"})`);
check("T10b", !/0xe5b2f446317d03de6e69fa697ab25d635f6dd617/i.test(connector + launcher + route), "no hard-coded acceptance wallet");

console.log(`\n${pass} passed, ${fail} failed`);
if (fail) process.exit(1);
