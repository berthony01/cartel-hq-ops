/** PCART P9.0 — Launch Day coordinator foundation regression (deterministic; no network, no DB writes). */
import { readFileSync } from "node:fs";
import { deriveCoordinatorState, planStatus, policyApproval, P9_STATES, P9_STOP_COPY, type P9Snapshot } from "../src/lib/pcart-launch-coordinator-p9";
import { P8A_MANIFEST_FINGERPRINT, P8A_MANIFEST_VERSION } from "../src/lib/pcart-auction-liquidity-plan";
import { P8B_MANIFEST_FINGERPRINT, P8B_MANIFEST_VERSION } from "../src/lib/pcart-auction-execution-p8b";

let pass = 0, fail = 0;
const check = (id: string, ok: boolean, l: string) => { ok ? pass++ : fail++; console.log(`${ok ? "PASS" : "FAIL"} ${id} ${l}`); };
const read = (p: string) => readFileSync(p, "utf8");
const DAY = 86_400_000;
const NOW = Date.UTC(2026, 9, 7, 17, 0, 0);
const iso = (ms: number) => new Date(ms).toISOString();

const P9_FILES = ["src/lib/pcart-launch-coordinator-p9.ts", "src/lib/pcart-launch-coordinator-p9.functions.ts", "src/components/cartel/PcartLaunchDayCoordinatorPanel.tsx"];
const CODE = P9_FILES.map(read).join("\n");
const SQL = read("supabase/migrations/20261007164806_b08013bf-213b-4c7a-809e-dbbc56f0ebf3.sql");

// 1 no live execution primitives
check("1", !/eth_sendTransaction|sendTransaction|signTypedData|signMessage|writeContract|walletClient|createWalletClient|proposeTransaction|execTransaction|buildPreAuctionSafeTx|buildSweepSafeTx|buildPublicMigrateCall|\.insert\(|\.update\(|\.upsert\(|\.delete\(|\.rpc\("(?!is_platform_owner)/.test(CODE), "no send/sign/propose/migrate/sweep or write primitive in P9 files");
check("1b", !/<Button|onClick/.test(read(P9_FILES[2])) && read(P9_FILES[2]).includes("P9_STOP_COPY") && P9_STOP_COPY === "No live action is enabled in P9.0.", "panel has no action buttons and shows exact stop copy");

// 2-4 policy approval
const rA = (o: Partial<any> = {}) => ({ id: "a1", manifestVersion: P8A_MANIFEST_VERSION, manifestFingerprint: P8A_MANIFEST_FINGERPRINT, reviewedAt: iso(NOW - 30 * DAY), expiresAt: iso(NOW - 29 * DAY), ...o });
const rB = (o: Partial<any> = {}) => ({ id: "b1", manifestVersion: P8B_MANIFEST_VERSION, manifestFingerprint: P8B_MANIFEST_FINGERPRINT, overallResult: "PASS", reviewedAt: iso(NOW - 25 * DAY), expiresAt: iso(NOW - 24 * DAY), ...o });
check("2", policyApproval("P8A", [rA()], []).status === "CURRENT" && policyApproval("P8B", [rB()], []).status === "CURRENT", "policy current despite 24h attestation expiry long past (manifest-based)");
check("3", policyApproval("P8B", [rB({ manifestFingerprint: "0x" + "00".repeat(32) })], []).status === "MANIFEST_MISMATCH" && policyApproval("P8A", [], []).status === "MISSING", "manifest mismatch / missing invalidates");
check("4", policyApproval("P8B", [rB()], ["b1"]).status === "REVOKED" && policyApproval("P8B", [rB(), rB({ id: "b2", manifestFingerprint: "0x" + "11".repeat(32), reviewedAt: iso(NOW) })], []).status === "SUPERSEDED", "revoke and supersede invalidate");

// 5-7 planning
check("5", planStatus(null).reason === "NOT_SET" && planStatus({ promotionStartAt: null, intendedAuctionStartAt: null, authoritativeStartBlock: null, endBlock: null }).reason === "NOT_SET" && /promotion_start_at timestamptz,/.test(SQL) && /intended_auction_start_at timestamptz,/.test(SQL), "planning dates nullable");
const P = NOW + DAY;
check("6", planStatus({ promotionStartAt: iso(P), intendedAuctionStartAt: iso(P + 20 * DAY), authoritativeStartBlock: null, endBlock: null }).reason === "RUNWAY_TOO_SHORT" && planStatus({ promotionStartAt: iso(P), intendedAuctionStartAt: iso(P + 21 * DAY), authoritativeStartBlock: null, endBlock: null }).ok && /interval '21 days'/.test(SQL), "≥21-day rule in TS and DB trigger");
check("7", /auto_start boolean NOT NULL DEFAULT false CHECK \(auto_start = false\)/.test(SQL) && /NEW\.auto_start := false/.test(SQL), "no auto-start possible");

// 8-11 state machine
const base: P9Snapshot = {
  nowMs: NOW, control: { executionEnabled: false, emergencyStopEngaged: true },
  deployment: { status: "DRAFT", txHash: null, contractAddress: null, finalityState: "NOT_APPLICABLE" }, sendClaims: [],
  launch: { status: "LAUNCH_APPROACHING", officialContractAddress: null }, p8a: "CURRENT", p8b: "CURRENT", plan: null,
  observed: { preAuctionSafeTxExecuted: null, currentBlock: null, migrated: null, graduated: null, unsoldSwept: null },
};
const today = deriveCoordinatorState(base);
check("8", today.state === "AWAITING_DEPLOYMENT" && today.blockers.includes("EMERGENCY_STOP_ENGAGED") && today.blockers.includes("EXECUTION_DISABLED") && today.liveActionEnabled === false, "today's DRAFT #11 → AWAITING_DEPLOYMENT, blocked by stop + execution off");
const TOK = "0x" + "ab".repeat(20);
const fin = { ...base, deployment: { status: "CONFIRMED", txHash: "0x1", contractAddress: TOK, finalityState: "FINALIZED" } };
const seq: [P9Snapshot, string][] = [
  [{ ...base, deployment: { ...base.deployment!, status: "PENDING", txHash: "0x1" } }, "DEPLOYMENT_PENDING"],
  [{ ...base, deployment: { status: "CONFIRMED", txHash: "0x1", contractAddress: TOK, finalityState: "PENDING" } }, "AWAITING_FINALIZATION"],
  [fin, "AWAITING_REGISTRATION"],
  [{ ...fin, launch: { status: "OFFICIAL_CONTRACT_REGISTERED", officialContractAddress: TOK } }, "AWAITING_PROMOTION_PLAN"],
];
const reg = { ...fin, launch: { status: "OFFICIAL_CONTRACT_REGISTERED", officialContractAddress: TOK } };
const plan = { promotionStartAt: iso(P), intendedAuctionStartAt: iso(P + 21 * DAY), authoritativeStartBlock: "1000", endBlock: String(1000 + 5_885_000) };
seq.push([{ ...reg, plan }, "PROMOTION_RUNWAY"]);
seq.push([{ ...reg, plan, nowMs: P + 20 * DAY }, "AWAITING_PRE_AUCTION_SAFE_TX"]);
seq.push([{ ...reg, plan, observed: { ...base.observed, preAuctionSafeTxExecuted: true, currentBlock: "999" } }, "AUCTION_SCHEDULED"]);
seq.push([{ ...reg, plan, observed: { ...base.observed, preAuctionSafeTxExecuted: true, currentBlock: "2000" } }, "AUCTION_OPEN"]);
seq.push([{ ...reg, plan, observed: { ...base.observed, preAuctionSafeTxExecuted: true, currentBlock: String(1000 + 5_885_000) } }, "AUCTION_ENDED_AWAITING_MIGRATE"]);
seq.push([{ ...reg, plan, observed: { ...base.observed, preAuctionSafeTxExecuted: true, migrated: true, graduated: true } }, "AWAITING_UNSOLD_SWEEP"]);
seq.push([{ ...reg, plan, observed: { ...base.observed, preAuctionSafeTxExecuted: true, graduated: false } }, "REFUND_PATH"]);
seq.push([{ ...reg, plan, observed: { ...base.observed, preAuctionSafeTxExecuted: true, migrated: true, graduated: true, unsoldSwept: true } }, "LAUNCH_COMPLETE"]);
const results = seq.map(([s, want]) => { const r = deriveCoordinatorState(s); return r.state === want && P9_STATES.includes(r.state); });
check("9", results.every(Boolean), `full path derives exactly one expected state each (${results.filter(Boolean).length}/${results.length})`);
check("10", deriveCoordinatorState({ ...reg, plan, sendClaims: [{ claimStatus: "AMBIGUOUS" }] }).state === "BLOCKED_UNCERTAIN_TRANSACTION" && deriveCoordinatorState({ ...base, deployment: { ...base.deployment!, status: "SUBMITTED", txHash: null } }).state === "BLOCKED_UNCERTAIN_TRANSACTION", "uncertain transaction blocks progression");
check("11", deriveCoordinatorState({ ...reg, p8b: "REVOKED" }).state === "BLOCKED_STALE_DEPENDENCY" && deriveCoordinatorState({ ...reg, control: null }).blockers.includes("EMERGENCY_STOP_ENGAGED") && deriveCoordinatorState({ ...reg, plan, control: { executionEnabled: true, emergencyStopEngaged: false } }).liveActionEnabled === false, "stale dependency blocks; missing control = stop; never live");

// 12 read-only load
const FN = read(P9_FILES[1]);
check("12", !/supabaseAdmin|client\.server/.test(FN) && (FN.match(/\.from\(/g) ?? []).length >= 8 && !/\.(insert|update|upsert|delete)\(/.test(FN), "snapshot load is SELECT-only as the signed-in owner");
const RPCS = SQL.slice(SQL.indexOf("FUNCTION public.set_canonical_pcart_launch_day_plan"));
check("13", !/(UPDATE|INSERT INTO|DELETE FROM) public\.(launches|launch_chain_deployments|launch_contract_registration_events|pcart_production_send_claims|launch_chain_production_execution_controls|launch_events|launch_notification_deliveries)/i.test(SQL) && (RPCS.match(/is_platform_owner\(auth\.uid\(\)\)/g) ?? []).length === 2 && /FROM PUBLIC, anon/.test(SQL) && /append-only/.test(SQL), "DB: owner-only, append-only, no lifecycle/control/contract/notification mutation");
check("14", /CANONICAL_PCART_PROTECTED/.test(read("src/lib/chain-mainnet-canary.functions.ts")) && /<PcartLaunchDayCoordinatorPanel launchId=\{selected\.id\} \/>/.test(read("src/routes/_authenticated/launch-control.tsx")), "canary protection intact; panel wired owner-only");

console.log(`\nP9: ${pass}/${pass + fail} passed`);
if (fail) process.exit(1);
