/**
 * PCART rehearsal — exact return-row validation + mobile/desktop send path.
 * Mock providers only; no real wallet, no real transaction.
 */
import { readFileSync } from "node:fs";
import { supabase } from "../src/integrations/supabase/client";
import {
  broadcastTokenDeployment,
  isUserRejection,
  setLauncherProvider,
} from "../src/lib/chain-launcher";
import { buildPcartInitCode } from "../src/lib/launch-artifact-registry";
import { createPcartRehearsalAttempt, isExactPcartRehearsalRow } from "../src/lib/pcart-rehearsal";
import { readPreAttemptGate } from "../src/lib/pcart-draft-recovery";

let pass = 0;
let fail = 0;
function check(id: string, ok: boolean, label: string) {
  if (ok) pass++;
  else fail++;
  console.log(`${ok ? "PASS" : "FAIL"} ${id} ${label}`);
}
const D = "0xe5b2f446317d03de6e69fa697ab25d635f6dd617";
const OTHER = "0x2222222222222222222222222222222222222222";
const LAUNCH = "00000000-0000-0000-0000-000000000001";
const HASH = "0x" + "ab".repeat(32);

// PostgREST-shaped JSON: the NUMERIC column parses to a JS double.
const rowJson = (over: Record<string, unknown> = {}) => ({
  ...JSON.parse('{"id":"att-9","attempt_number":9,"artifact_id":"pepecartel-token-v1","deployment_kind":"FIXED_SUPPLY_ERC20","chain_id":46630,"network_environment":"TESTNET","token_name":"PEPECARTEL","token_symbol":"PCART","token_decimals":18,"token_total_supply":1000000000000000000000000000,"token_total_supply_text":"1000000000000000000000000000","token_recipient":"' + D + '","deployer_address":"' + D + '","status":"DRAFT","deployer_nonce_before":0}'),
  ...over,
});

// ---------- R. exact return row ----------
const r = rowJson();
check("R1", String(r.token_total_supply) === "1e+27", "PostgREST numeric supply really arrives as 1e+27");
let oldThrows = false;
try { BigInt(String(r.token_total_supply)); } catch { oldThrows = true; }
check("R2", oldThrows, "previous BigInt(String(numeric)) logic throws => old validator rejected every valid row");
check("R3", isExactPcartRehearsalRow(r, D), "fixed validator accepts exact row via text mirror");
check("R4", !isExactPcartRehearsalRow(rowJson({ token_total_supply_text: null }), D) &&
  !isExactPcartRehearsalRow(rowJson({ token_total_supply_text: "1e+27" }), D) &&
  !isExactPcartRehearsalRow(rowJson({ token_total_supply_text: "1000000000000000000000000001" }), D) &&
  !isExactPcartRehearsalRow(rowJson({ token_total_supply_text: undefined, token_total_supply: "1000000000000000000000000000" }), D),
  "missing/malformed/wrong mirror fails closed; never falls back to numeric");
check("R5", ["artifact_id", "deployment_kind", "chain_id", "network_environment", "token_name", "token_symbol", "token_decimals", "token_recipient", "status"]
  .every((k) => !isExactPcartRehearsalRow(rowJson({ [k]: "x" }), D)), "every other frozen field still enforced");
const src = readFileSync("src/lib/pcart-rehearsal.ts", "utf8");
check("R6", !/BigInt\(String\(row\.token_total_supply/.test(src) && /row\.token_total_supply_text/.test(src) &&
  /Number\(row\?\.deployer_nonce_before\) !== nonce/.test(src), "source uses mirror only; nonce check preserved");

// ---------- mock providers ----------
type Kind = "walletconnect" | "injected";
const log: string[] = [];
let sendParams: unknown[] = [];
function provider(kind: Kind, opts: { send?: "ok" | "reject" | "bad"; chain?: number; accounts?: string[] } = {}) {
  return {
    request: async ({ method, params }: { method: string; params?: unknown[] }) => {
      log.push(`${kind}:${method}`);
      if (method === "eth_chainId") {
        const c = opts.chain ?? 46630;
        return kind === "walletconnect" ? c : "0x" + c.toString(16);
      }
      if (method === "eth_accounts") return opts.accounts ?? [kind === "walletconnect" ? D : D.toUpperCase().replace("0X", "0x")];
      if (method === "eth_getTransactionCount") return "0x0";
      if (method === "eth_sendTransaction") {
        sendParams = params ?? [];
        if (opts.send === "reject") throw Object.assign(new Error("User rejected"), { code: 4001 });
        if (opts.send === "bad") return "nope";
        return HASH;
      }
      throw new Error("unexpected " + method);
    },
  };
}

// Mock RPC layer (supabase.rpc) to drive the panel's exact call order.
const rpcCalls: string[] = [];
let failSubmit = false;
(supabase as unknown as { rpc: unknown }).rpc = async (fn: string, args: Record<string, unknown>) => {
  rpcCalls.push(fn);
  if (fn === "create_launch_chain_pcart_rehearsal_attempt_v2") {
    return { data: rowJson({ deployer_nonce_before: args._deployer_nonce_before }), error: null };
  }
  if (fn === "submit_launch_chain_deployment_tx") {
    return failSubmit ? { data: null, error: { message: "db down" } } : { data: rowJson({ status: "SUBMITTED", tx_hash: HASH }), error: null };
  }
  if (fn === "abandon_launch_chain_deployment_attempt") return { data: rowJson({ status: "ABANDONED" }), error: null };
  return { data: null, error: { message: "unexpected rpc " + fn } };
};

const { submitDeploymentTx, abandonDeploymentAttempt } = await import("../src/lib/chain-launcher");
const init = buildPcartInitCode(D);

/** Mirrors PcartRehearsalPanel.runLocked order exactly. */
async function panelFlow(): Promise<{ outcome: string; recoveryHandoff: boolean }> {
  let attemptId: string | null = null;
  let txHash: string | null = null;
  let handoff = false;
  try {
    const gate = await readPreAttemptGate(D);
    if (!gate.ok) return { outcome: "gate:" + gate.reason, recoveryHandoff: false };
    const attempt = await createPcartRehearsalAttempt({
      launchId: LAUNCH, clientRequestId: "req-12345678", deployerAddress: D, rehearsalRecipient: D, deployerNonceBefore: gate.nonce,
    });
    attemptId = attempt.id;
    txHash = await broadcastTokenDeployment(D, init);
    try {
      await submitDeploymentTx(attempt.id, txHash);
    } catch (e) {
      handoff = true;
      throw e;
    }
    return { outcome: "recorded", recoveryHandoff: false };
  } catch (e) {
    if (attemptId && !txHash) {
      await abandonDeploymentAttempt(attemptId, isUserRejection(e) ? "Cancelled in wallet" : "Wallet request ended before broadcast");
      return { outcome: "abandoned", recoveryHandoff: handoff };
    }
    return { outcome: "error:" + (e as Error).message, recoveryHandoff: handoff };
  }
}

for (const kind of ["walletconnect", "injected"] as Kind[]) {
  const K = kind === "walletconnect" ? "M" : "W";
  const label = kind === "walletconnect" ? "mobile WalletConnect" : "desktop injected";

  log.length = 0; rpcCalls.length = 0; failSubmit = false; sendParams = [];
  setLauncherProvider(provider(kind) as never, D);
  const ok = await panelFlow();
  const sends = log.filter((l) => l.endsWith("eth_sendTransaction"));
  const tx = sendParams[0] as Record<string, unknown>;
  check(`${K}1`, ok.outcome === "recorded" && rpcCalls.join(",") === "create_launch_chain_pcart_rehearsal_attempt_v2,submit_launch_chain_deployment_tx",
    `${label}: valid row -> send -> submitDeploymentTx reached`);
  check(`${K}2`, log.every((l) => l.startsWith(kind + ":")), `${label}: SAME bound provider for account, chain, nonce and send`);
  const sendIdx = log.lastIndexOf(`${kind}:eth_sendTransaction`);
  check(`${K}3`, log[sendIdx - 1] === `${kind}:eth_accounts` && log[sendIdx - 2] === `${kind}:eth_chainId`,
    `${label}: chain then account re-read immediately before send`);
  check(`${K}4`, sends.length === 1 && tx.from === D && tx.data === init && tx.value === "0x0" && !("to" in tx) && Object.keys(tx).length === 3,
    `${label}: exactly one eth_sendTransaction {from, exact init code, value 0x0}, no to`);

  log.length = 0; rpcCalls.length = 0;
  setLauncherProvider(provider(kind, { send: "reject" }) as never, D);
  const rej = await panelFlow();
  check(`${K}5`, rej.outcome === "abandoned" && rpcCalls.includes("abandon_launch_chain_deployment_attempt") && !rpcCalls.includes("submit_launch_chain_deployment_tx"),
    `${label}: rejection with no hash -> abandon`);

  log.length = 0; rpcCalls.length = 0; failSubmit = true;
  setLauncherProvider(provider(kind) as never, D);
  const unrec = await panelFlow();
  check(`${K}6`, unrec.recoveryHandoff && !rpcCalls.includes("abandon_launch_chain_deployment_attempt"),
    `${label}: valid hash + DB write failure never abandons -> recovery handoff`);
  failSubmit = false;

  for (const [id, opts, why] of [["7a", { chain: 4663 }, "wrong chain"], ["7b", { accounts: [OTHER] }, "account changed"]] as const) {
    log.length = 0; rpcCalls.length = 0;
    setLauncherProvider(provider(kind, opts) as never, D);
    const g = await panelFlow();
    check(`${K}${id}`, g.outcome.startsWith("gate:") && rpcCalls.length === 0 && !log.some((l) => l.endsWith("eth_sendTransaction")),
      `${label}: ${why} -> no draft, no send`);
  }
}

// ---------- validator throw prevents broadcast (old behaviour) ----------
log.length = 0; rpcCalls.length = 0;
(supabase as unknown as { rpc: unknown }).rpc = async (fn: string) => {
  rpcCalls.push(fn);
  return { data: rowJson({ token_total_supply_text: null }), error: null };
};
setLauncherProvider(provider("walletconnect") as never, D);
const blocked = await panelFlow();
check("P1", /does not match the PCART intent/.test(blocked.outcome) && !log.some((l) => l.endsWith("eth_sendTransaction")) &&
  !rpcCalls.includes("abandon_launch_chain_deployment_attempt"),
  "validator rejection throws before broadcast; attemptId never set, so the draft is left DRAFT (the #8/#9 pattern)");

// ---------- panel structure ----------
const panel = readFileSync("src/components/chain/PcartRehearsalPanel.tsx", "utf8");
check("P2", /if \(inFlight\.current\) return;\s*inFlight\.current = true;/.test(panel) && /!busy &&/.test(panel),
  "synchronous duplicate-click guard prevents a second send");
check("P3", /PCART_BLOCKING_STATUSES = new Set\(\["DRAFT", "SUBMITTED", "PENDING", "CONFIRMED"\]\)/.test(panel) && /!blockedReason &&/.test(panel),
  "active DRAFT blocks a new attempt after any page reload (server guard also enforces)");
const run = panel.slice(panel.indexOf("async function runLocked"));
check("P4", run.indexOf("createPcartRehearsalAttempt({") < run.indexOf("broadcastTokenDeployment(") &&
  run.indexOf("broadcastTokenDeployment(") < run.indexOf("submitDeploymentTx(") && /else if \(attemptId && !txHash\)/.test(run) &&
  /props\.onBroadcastUnrecorded\(attempt, txHash\);/.test(run), "panel order and abandon/recovery rules match the harness");

console.log(`\n${pass} passed, ${fail} failed`);
if (fail) process.exit(1);
