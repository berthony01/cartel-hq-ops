// PCART environment-scoped uniqueness regression (deterministic, static + pure).
import { readFileSync, readdirSync } from "node:fs";
import { mapPcartProductionDraftError, PCART_PRODUCTION_DUPLICATE_MESSAGE } from "../src/lib/pcart-production-draft";
let p = 0, f = 0;
const check = (id: string, ok: boolean, d: string) => { ok ? p++ : f++; console.log(`${ok ? "PASS" : "FAIL"} ${id} ${d}`); };
const MIG_FILE = "20261005101321_54225f07-be67-4257-aea1-f36aa287405a.sql";
const SQL = readFileSync(`supabase/migrations/${MIG_FILE}`, "utf8");
const P2FIX = readFileSync("supabase/migrations/20261005100833_46ee6d47-1dcf-47d3-aa02-5e08af696cf0.sql", "utf8");
const ACTIVE = ["DRAFT", "SUBMITTED", "PENDING", "CONFIRMED"];
type Row = { launch: string; env: string; chain: number; status: string; artifact: string };
// Model both index predicates exactly as written in the migration.
function parseIndex(name: string) {
  const m = SQL.match(new RegExp(`CREATE UNIQUE INDEX ${name}\\s+ON public\\.launch_chain_deployments \\(launch_id\\)\\s+WHERE artifact_id = 'pepecartel-token-v1'\\s+AND network_environment = '(\\w+)'\\s+AND chain_id = (\\d+)\\s+AND status IN \\('DRAFT', 'SUBMITTED', 'PENDING', 'CONFIRMED'\\);`));
  return m ? { env: m[1], chain: Number(m[2]) } : null;
}
const T = parseIndex("launch_chain_deployments_one_active_pcart_rehearsal");
const P = parseIndex("launch_chain_deployments_one_active_pcart_production");
check("U1", T?.env === "TESTNET" && T?.chain === 46630, "rehearsal index pinned to TESTNET/46630");
check("U2", P?.env === "PRODUCTION" && P?.chain === 4663, "production index pinned to PRODUCTION/4663");
check("U3", /DROP INDEX IF EXISTS public\.launch_chain_deployments_one_active_pcart_rehearsal;/.test(SQL) &&
  !/INSERT |UPDATE |DELETE |CREATE OR REPLACE FUNCTION|ALTER TABLE|CREATE POLICY|GRANT /.test(SQL), "migration only drops/recreates indexes; no row/function/policy changes");
const idx = [T!, P!];
function insertOk(existing: Row[], r: Row): boolean {
  return !idx.some((i) => [...existing, r].filter((x) => x.launch === r.launch && x.artifact === "pepecartel-token-v1" && x.env === i.env && x.chain === i.chain && ACTIVE.includes(x.status)).length > 1);
}
const L = "pcart"; const a = "pepecartel-token-v1";
const r10: Row = { launch: L, env: "TESTNET", chain: 46630, status: "CONFIRMED", artifact: a };
check("U4", insertOk([r10], { launch: L, env: "PRODUCTION", chain: 4663, status: "DRAFT", artifact: a }), "confirmed TESTNET rehearsal does not conflict with PRODUCTION DRAFT");
check("U5", !insertOk([r10], { launch: L, env: "TESTNET", chain: 46630, status: "DRAFT", artifact: a }), "second active TESTNET row rejected");
const pd: Row = { launch: L, env: "PRODUCTION", chain: 4663, status: "DRAFT", artifact: a };
check("U6", !insertOk([r10, pd], { ...pd, status: "SUBMITTED" }), "second active PRODUCTION row rejected");
check("U7", insertOk([{ ...r10, status: "ABANDONED" }, { ...r10, status: "FAILED" }], { ...r10, status: "DRAFT" }) &&
  insertOk([r10, { ...pd, status: "ABANDONED" }, { ...pd, status: "FAILED" }], pd), "ABANDONED/FAILED history does not block new attempts");
check("U8", /network_environment = 'PRODUCTION' OR x\.chain_id = 4663\)\s*AND x\.status IN \('DRAFT','SUBMITTED','PENDING','CONFIRMED'\)\) THEN\s*RAISE EXCEPTION 'A PCART production attempt already exists/.test(P2FIX), "production draft RPC keeps its own duplicate guard");
const raw = { code: "23505", message: 'duplicate key value violates unique constraint "launch_chain_deployments_one_active_pcart_production"' };
const out = mapPcartProductionDraftError(raw);
check("U9", out === PCART_PRODUCTION_DUPLICATE_MESSAGE && !/launch_chain_deployments/.test(out), "duplicate error mapped to plain message without constraint name");
check("U10", mapPcartProductionDraftError({ message: "Mainnet execution must remain locked to prepare a draft" }) === "Mainnet execution must remain locked to prepare a draft", "other errors pass through");
const canary = readdirSync("src/lib").filter((n) => n.endsWith(".ts")).map((n) => readFileSync(`src/lib/${n}`, "utf8")).join("\n");
check("U11", /CANONICAL_PCART_PROTECTED/.test(canary), "generic canary still CANONICAL_PCART_PROTECTED");
const DRAFT = readFileSync("src/lib/pcart-production-draft.ts", "utf8");
check("U12", !/eth_sendTransaction|sendTransaction|signTypedData|personal_sign|presign|send_window|arm_launch|walletconnect|appkit/i.test(DRAFT + SQL), "no send/sign/presign/window/arming code added");
console.log(`\n${p} passed, ${f} failed`); process.exit(f ? 1 : 0);
