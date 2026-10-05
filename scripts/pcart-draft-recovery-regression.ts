/**
 * PCART testnet rehearsal — unsent DRAFT recovery regression.
 * Behavioural checks run the real recovery module against a mock EIP-1193
 * provider bound through the launcher; structural checks read sources.
 */
import { readFileSync, readdirSync } from "node:fs";
import { execSync } from "node:child_process";
import { getContractAddress } from "viem";
import { setLauncherProvider } from "../src/lib/chain-launcher";
import {
  RECOVERY_ABANDON_REASON,
  checkDraftRecovery,
  classifyDraft,
  evaluatePreAttemptGate,
  isResolvableDraft,
  readPreAttemptGate,
} from "../src/lib/pcart-draft-recovery";

let pass = 0;
let fail = 0;
function check(id: string, ok: boolean, label: string) {
  if (ok) pass++;
  else fail++;
  console.log(`${ok ? "PASS" : "FAIL"} ${id} ${label}`);
}
const read = (p: string) => readFileSync(p, "utf8");

const D = "0xe5b2f446317d03de6e69fa697ab25d635f6dd617";
const OTHER = "0x1111111111111111111111111111111111111111";
const draft = (over: Record<string, unknown> = {}) => ({
  status: "DRAFT", tx_hash: null, submitted_at: null, contract_address: null,
  deployer_address: D, deployer_nonce_before: null as number | null, ...over,
});

type Mock = { chain?: string; accounts?: string[]; latest?: string; pending?: string; code?: string; throwOn?: string };
const calls: string[] = [];
function bind(m: Mock) {
  calls.length = 0;
  setLauncherProvider({
    request: async ({ method, params }: { method: string; params?: unknown[] }) => {
      calls.push(method + (params ? ":" + JSON.stringify(params) : ""));
      if (m.throwOn === method) throw new Error("rpc down");
      if (method === "eth_chainId") return m.chain ?? "0xb626";
      if (method === "eth_accounts") return m.accounts ?? [D];
      if (method === "eth_getTransactionCount") return (params?.[1] === "pending" ? m.pending : m.latest) ?? "0x0";
      if (method === "eth_getCode") return m.code ?? "0x";
      if (/send|sign/i.test(method)) throw new Error("FORBIDDEN " + method);
      return null;
    },
  } as never, D);
}

// ---------- 1. migration / v2 RPC ----------
const migDir = "supabase/migrations";
const mig = readdirSync(migDir).map((f) => read(`${migDir}/${f}`)).find((s) => s.includes("create_launch_chain_pcart_rehearsal_attempt_v2")) ?? "";
check("1a", /ADD COLUMN IF NOT EXISTS deployer_nonce_before bigint/.test(mig), "nullable bigint column deployer_nonce_before added");
check("1b", /_deployer_nonce_before IS NULL OR _deployer_nonce_before < 0[\s\S]*Invalid deployer nonce/.test(mig) && /token_recipient, deployer_nonce_before\s*\)/.test(mig), "v2 validates nonce >= 0 and stores it");
check("1c", ["authorize_launch_chain_deployment(_launch_id)", "private.is_canonical_pcart_launch", "'pepecartel-launch'", "46630, 'TESTNET'",
  "'pepecartel-token-v1'", "b.status IN ('DRAFT', 'SUBMITTED', 'PENDING', 'CONFIRMED')", "Idempotency key conflict"].every((t) => mig.includes(t)),
  "v2 preserves auth, canonical launch, exact artifact, testnet-only and duplicate guards");
check("1d", /REVOKE ALL ON FUNCTION public\.create_launch_chain_pcart_rehearsal_attempt_v2[^;]*FROM PUBLIC, anon/.test(mig) &&
  !/DROP FUNCTION/.test(mig) && !/CREATE OR REPLACE FUNCTION public\.create_launch_chain_pcart_rehearsal_attempt\(/.test(mig),
  "old RPC untouched; v2 not callable by anon");
const client = read("src/lib/pcart-rehearsal.ts");
check("1e", /PCART_REHEARSAL_RPC = "create_launch_chain_pcart_rehearsal_attempt_v2"/.test(client) && /_deployer_nonce_before: nonce/.test(client) &&
  /Number\(row\?\.deployer_nonce_before\) !== nonce/.test(client), "client calls v2 and verifies the stored nonce");

// ---------- 2/3. pre-create gate ----------
check("2a", !evaluatePreAttemptGate({ expectedAccount: D, liveAccount: D, chainId: 46630, nonces: { latest: 3n, pending: 4n } }).ok, "latest != pending => no draft");
check("2b", evaluatePreAttemptGate({ expectedAccount: D, liveAccount: D, chainId: 46630, nonces: { latest: 0n, pending: 0n } }).ok, "clean wallet passes with nonce");
check("2c", !evaluatePreAttemptGate({ expectedAccount: D, liveAccount: OTHER, chainId: 46630, nonces: { latest: 0n, pending: 0n } }).ok &&
  !evaluatePreAttemptGate({ expectedAccount: D, liveAccount: D, chainId: 4663, nonces: { latest: 0n, pending: 0n } }).ok &&
  !evaluatePreAttemptGate({ expectedAccount: D, liveAccount: D, chainId: 46630, nonces: null }).ok, "wrong account/chain/read failure => no draft");
const panel = read("src/components/chain/PcartRehearsalPanel.tsx");
const run = panel.slice(panel.indexOf("async function runLocked"));
check("3a", run.indexOf("readPreAttemptGate(props.account)") > 0 && run.indexOf("readPreAttemptGate(") < run.indexOf("createPcartRehearsalAttempt({") &&
  /if \(!gate\.ok\) \{[\s\S]*?return;\s*\}/.test(run) && /deployerNonceBefore: gate\.nonce/.test(run), "gate re-read immediately before create; fail returns before draft");
const recSrc = read("src/lib/pcart-draft-recovery.ts");
check("3b", /getLauncherProvider\(\)/.test(recSrc) && !/window\.ethereum|getInjectedProvider|reown|appkit/i.test(recSrc), "reads use the SAME bound launcher provider only");
await (async () => {
  bind({ latest: "0x2", pending: "0x2" });
  const g = await readPreAttemptGate(D);
  check("3c", g.ok && g.nonce === 2n && calls.some((c) => c.startsWith("eth_chainId")) && calls.some((c) => c.startsWith("eth_accounts")) &&
    calls.some((c) => c.includes('"latest"')) && calls.some((c) => c.includes('"pending"')), "live account+chain+both nonces read from bound provider");
})();

// ---------- 4. visibility ----------
check("4a", isResolvableDraft(draft()), "DRAFT with no tx evidence is resolvable");
check("4b", !isResolvableDraft(draft({ tx_hash: "0xab" })) && !isResolvableDraft(draft({ submitted_at: "x" })) &&
  !isResolvableDraft(draft({ contract_address: OTHER })) && !isResolvableDraft(draft({ status: "SUBMITTED" })), "any tx evidence or non-DRAFT hides Resolve");
check("4c", /resolvableDraft =\s*activePcartAttempt && isResolvableDraft\(activePcartAttempt\)/.test(panel) && /\{resolvableDraft \? \(/.test(panel), "button rendered only for resolvable draft");

// ---------- 5/6. provable ----------
const base = { liveAccount: D, chainId: 46630 };
const c5 = classifyDraft({ ...base, row: draft({ deployer_nonce_before: 7 }), nonces: { latest: 7n, pending: 7n }, code: "0x" });
check("5", c5.kind === "PROVEN_UNBROADCAST" && c5.kind === "PROVEN_UNBROADCAST" &&
  c5.createAddress === getContractAddress({ from: D, nonce: 7n }).toLowerCase(), "stored nonce match + empty CREATE code => proven");
const c6 = classifyDraft({ ...base, row: draft(), nonces: { latest: 0n, pending: 0n }, code: "0x" });
check("6", c6.kind === "PROVEN_UNBROADCAST" && c6.createAddress === getContractAddress({ from: D, nonce: 0n }).toLowerCase(), "legacy null + 0/0 + empty nonce-0 code => proven");
await (async () => {
  bind({});
  const r = await checkDraftRecovery(draft());
  const codeCall = calls.find((c) => c.startsWith("eth_getCode")) ?? "";
  check("6b", r.kind === "PROVEN_UNBROADCAST" && codeCall.includes(getContractAddress({ from: D, nonce: 0n }).toLowerCase()) &&
    !calls.some((c) => /send|sign/i.test(c)), "live legacy check (attempt #7 shape) proves via nonce-0 CREATE address, no send/sign");
})();

// ---------- 7. fail closed ----------
const unk = (x: ReturnType<typeof classifyDraft>) => x.kind === "UNKNOWN";
check("7a", unk(classifyDraft({ ...base, row: draft({ deployer_nonce_before: 7 }), nonces: { latest: 8n, pending: 8n }, code: "0x" })), "nonce moved => unknown");
check("7b", unk(classifyDraft({ ...base, row: draft({ deployer_nonce_before: 7 }), nonces: { latest: 7n, pending: 8n }, code: "0x" })), "pending mismatch => unknown");
check("7c", unk(classifyDraft({ ...base, row: draft({ deployer_nonce_before: 7 }), nonces: { latest: 7n, pending: 7n }, code: "0x60" })), "code present => unknown");
check("7d", unk(classifyDraft({ ...base, liveAccount: OTHER, row: draft(), nonces: { latest: 0n, pending: 0n }, code: "0x" })), "wrong account => unknown");
check("7e", unk(classifyDraft({ ...base, chainId: 4663, row: draft(), nonces: { latest: 0n, pending: 0n }, code: "0x" })), "wrong chain => unknown");
check("7f", unk(classifyDraft({ ...base, row: draft(), nonces: null, code: "0x" })) && unk(classifyDraft({ ...base, row: draft(), nonces: { latest: 0n, pending: 0n }, code: null })), "read failure => unknown");
check("7g", unk(classifyDraft({ ...base, row: draft(), nonces: { latest: 3n, pending: 3n }, code: "0x" })), "legacy null with nonce > 0 => unknown");
await (async () => {
  bind({ throwOn: "eth_getTransactionCount" });
  check("7h", unk(await checkDraftRecovery(draft())), "live RPC failure => unknown");
  bind({ code: "0x6080" });
  check("7i", unk(await checkDraftRecovery(draft())), "live code present => unknown");
})();
const resolve = panel.slice(panel.indexOf("async function resolveDraft"), panel.indexOf("async function confirmAbandon"));
check("7j", !/abandonDeploymentAttempt/.test(resolve) && /result\.kind === "PROVEN_UNBROADCAST"/.test(resolve) && /setNotProvable\(true\)/.test(resolve),
  "check never abandons; unknown shows warning");

// ---------- 8/9. confirmation + reason ----------
const confirm = panel.slice(panel.indexOf("async function confirmAbandon"), panel.indexOf("const canRun"));
check("8a", /if \(!resolvableDraft \|\| !walletClear \|\| abandoning\) return;/.test(confirm) && /disabled=\{!walletClear \|\| abandoning\}/.test(panel) &&
  /setWalletClear\(false\);\s*setConfirmOpen\(true\)/.test(resolve), "abandon requires explicit wallet-pending confirmation, reset each check");
check("8b", (panel.match(/abandonDeploymentAttempt\(/g) ?? []).length === 2 && !/useEffect\([^)]*(resolveDraft|confirmAbandon|checkDraftRecovery)/.test(panel) &&
  !/visibilitychange|setInterval|setTimeout/.test(panel), "no auto-abandon on mount/visibility/timer/reconnect");
check("9", RECOVERY_ABANDON_REASON === "Confirmed unbroadcast after recovery check" &&
  /abandonDeploymentAttempt\(resolvableDraft\.id, RECOVERY_ABANDON_REASON\)/.test(confirm) && /await props\.onChanged\(\)/.test(confirm) &&
  /pcartAttempts\.map/.test(panel), "reason recorded via existing RPC, list refreshed, history kept");
check("9b", /setRecipient\(\(r\) => \(r\.trim\(\) \? r : props\.account!\)\)/.test(panel), "recipient prefill never overwrites input");

// ---------- 10. protected paths ----------
let changed = "";
try { changed = execSync("git diff --name-only HEAD; git ls-files --others --exclude-standard", { encoding: "utf8" }); } catch { /* */ }
const FORBIDDEN = ["contracts/", "artifacts/", "src/lib/launch-artifact-registry.ts", "src/lib/chain-mainnet", "src/lib/treasury-safe",
  "src/lib/wallet-connector.ts", "src/lib/reown-appkit", "src/lib/testnet-wallet-connector.ts", "src/lib/chain-registry.ts", "src/components/cartel/Treasury", "src/components/chain/LiquidityPlanCard.tsx"];
const bad = changed.split("\n").filter((f) => f && FORBIDDEN.some((p) => f.startsWith(p)));
check("10a", bad.length === 0, `mainnet/Treasury Safe/liquidity/wallet connector untouched${bad.length ? ": " + bad.join(", ") : ""}`);
check("10b", !/official_contract_address|lifecycle|LIQUIDITY|4663\b/.test(recSrc.replace(/46630/g, "")) && !/official_contract_address/.test(mig),
  "recovery never touches official contract, lifecycle or liquidity");

console.log(`\n${pass} passed, ${fail} failed`);
if (fail) process.exit(1);
