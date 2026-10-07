/**
 * PCART P5 — one-time mainnet send regression (deterministic; no network, no wallet, no DB writes).
 */
import { readFileSync, readdirSync } from "node:fs";
import { keccak256 } from "viem";

import {
  buildVerifiedPcartSendEnvelope,
  classifyPcartWalletResult,
  isPcartSendConfirmed,
  pcartMarkerBlocksSend,
  pcartP5SummaryText,
  pcartSendBlocked,
  pcartSendWindowState,
  PCART_CLAIM_MIN_PERMIT_LIFETIME_MS,
  PCART_SEND_CONFIRM_PHRASE,
  type PcartPermitForSend,
  type PcartSendMarker,
} from "../src/lib/pcart-production-send";
import { pcartUnsignedTxFingerprint, PCART_EXECUTION_PERMIT_MAX_TTL_MS } from "../src/lib/pcart-production-execution";
import { pcartProductionInitCodeHash, predictPcartProductionAddress, PCART_PRODUCTION_TREASURY_SAFE } from "../src/lib/pcart-production-intent";

let pass = 0, fail = 0;
const check = (id: string, ok: boolean, label: string) => { ok ? pass++ : fail++; console.log(`${ok ? "PASS" : "FAIL"} ${id} ${label}`); };
const read = (p: string) => readFileSync(p, "utf8");
const strip = (s: string) => s.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "").replace(/^\s*\*.*$/gm, "");

const MIG_FILE = readdirSync("supabase/migrations").filter((f) => read(`supabase/migrations/${f}`).includes("FUNCTION public.claim_canonical_pcart_mainnet_send") && !read(`supabase/migrations/${f}`).includes("P9.2: bind the EXISTING canonical PCART execution permit")).sort().at(-1)!;
const MIG = read(`supabase/migrations/${MIG_FILE}`);
const sect = (a: string, b: string) => MIG.slice(MIG.indexOf(a), b ? MIG.indexOf(b) : undefined);
const CLAIM = sect("FUNCTION public.claim_canonical_pcart_mainnet_send", "FUNCTION public.record_canonical_pcart_mainnet_tx_hash");
const RECORD = sect("FUNCTION public.record_canonical_pcart_mainnet_tx_hash", "FUNCTION public.mark_canonical_pcart_send_ambiguous");
const AMBIG = sect("FUNCTION public.mark_canonical_pcart_send_ambiguous", "FUNCTION public.note_canonical_pcart_send_recovery_check");
const RELEASE = sect("FUNCTION public.release_canonical_pcart_mainnet_send_claim", "REVOKE ALL ON FUNCTION private.enforce_pcart_send_claim_rules");
const TRIG = sect("FUNCTION private.enforce_pcart_send_claim_rules", "CREATE TRIGGER pcart_send_claim_rules");
const PERMIT_TRIG = sect("FUNCTION private.enforce_pcart_execution_permit_immutable", "DO $do$");
const PURE = read("src/lib/pcart-production-send.ts");
const WALLET = read("src/lib/pcart-production-send-wallet.ts");
const FNS = read("src/lib/pcart-production-send.functions.ts");
const PANEL = read("src/components/cartel/PcartMainnetSendPanel.tsx");
const LC = read("src/routes/_authenticated/launch-control.tsx");
const CANARY = read("src/lib/chain-mainnet-canary.functions.ts");
const OWNER = /auth\.uid\(\) IS NULL OR NOT public\.is_platform_owner\(auth\.uid\(\)\)/;

// 1 owner-only
check("1a", OWNER.test(CLAIM) && OWNER.test(RECORD) && OWNER.test(AMBIG), "claim/record/ambiguous are owner-only");
check("1b", /is_platform_owner\(_operator_user_id\)/.test(RELEASE) && /release_canonical_pcart_mainnet_send_claim\(uuid, uuid, text\) FROM PUBLIC, anon, authenticated/.test(MIG) && /release_canonical_pcart_mainnet_send_claim\(uuid, uuid, text\) TO service_role/.test(MIG), "release is service-only + owner operator");
check("1c", /is_platform_owner/.test(FNS) && /requireSupabaseAuth/.test(FNS), "recovery server fn verifies owner");
check("1d", /FOR SELECT TO authenticated\s+USING \(public\.is_platform_owner\(auth\.uid\(\)\)\)/.test(MIG) && !/GRANT (INSERT|UPDATE|DELETE|ALL)[^;]*send_claims TO authenticated/.test(MIG), "claims table: owner read only, no direct writes");

// 2/3 window + lifecycle
check("2a", /now\(\) < l\.launch_window_start OR now\(\) > l\.launch_window_end/.test(CLAIM) && /launch_window_start IS NULL OR l\.launch_window_end IS NULL OR l\.launch_window_start >= l\.launch_window_end/.test(CLAIM), "DB claim window-gated, window must be valid");
const S = "2026-10-25T12:40:00Z", E = "2026-10-31T14:40:00Z";
check("2b", pcartSendWindowState(S, E, "LAUNCH_APPROACHING", Date.parse("2026-10-05T15:00:00Z")) === "BEFORE", "today is BEFORE");
check("2c", pcartSendWindowState(S, E, "LAUNCH_APPROACHING", Date.parse("2026-11-01T00:00:00Z")) === "AFTER", "after window");
check("2d", pcartSendWindowState(S, E, "LAUNCH_APPROACHING", Date.parse("2026-10-26T00:00:00Z")) === "OPEN", "inside window");
check("2e", pcartSendWindowState(E, S, "LAUNCH_APPROACHING", Date.parse("2026-10-26T00:00:00Z")) === "NO_WINDOW" && pcartSendWindowState(null, E, "LAUNCH_APPROACHING", 0) === "NO_WINDOW", "invalid window refused");
check("3a", /l\.status IS DISTINCT FROM 'LAUNCH_APPROACHING'/.test(CLAIM) && pcartSendWindowState(S, E, "LIVE", Date.parse("2026-10-26T00:00:00Z")) === "WRONG_LIFECYCLE", "lifecycle must be LAUNCH_APPROACHING");

// 4 exact intent
check("4", ["c_safe", "c_init_hash", "c_supply", "'PEPECARTEL'", "'PCART'", "token_decimals IS DISTINCT FROM 18", "chain_id IS DISTINCT FROM 4663", "'PRODUCTION'", "'pepecartel-token-v1'", "signer_1", "lower(d.deployer_address) = c_safe", "deployer_nonce_before", "readiness_fingerprint IS DISTINCT FROM ev->>'fingerprint'", "pcart_unsigned_tx_fingerprint"].every((t) => CLAIM.includes(t)), "exact draft/intent/Safe/signer/nonce/fingerprints");
// 5 P3 + P4
check("5", /p\.cancelled_at IS NOT NULL OR p\.expires_at <= now\(\)/.test(CLAIM) && /e\.cancelled_at IS NOT NULL OR e\.consumed_at IS NOT NULL OR e\.expires_at < now\(\) \+ interval '10 seconds'/.test(CLAIM) && PCART_CLAIM_MIN_PERMIT_LIFETIME_MS === 10_000, "active P3 + unexpired unconsumed P4 (>=10s) required");
// 6 atomic consume
check("6", /UPDATE public\.pcart_production_execution_permits SET consumed_at = now\(\) WHERE id = e\.id;\s+INSERT INTO public\.pcart_production_send_claims/.test(CLAIM) && /NEW\.consumed_at IS NOT NULL AND NEW\.cancelled_at IS NULL/.test(PERMIT_TRIG), "permit consumed atomically with claim insert; trigger allows one consumption only");
check("6b", PCART_EXECUTION_PERMIT_MAX_TTL_MS === 30_000 && !/consumed_at_check CHECK/.test(MIG.replace("DROP CONSTRAINT pcart_production_execution_permits_consumed_at_check", "")), "permit TTL still 30s");
// 7 one claim per draft/permit
check("7", /permit_id uuid NOT NULL UNIQUE/.test(MIG) && /UNIQUE INDEX pcart_production_send_claims_one_live_per_deployment\s+ON public\.pcart_production_send_claims \(deployment_id\) WHERE claim_status <> 'RELEASED'/.test(MIG) && /claim_status <> 'RELEASED'\) THEN\s+RAISE EXCEPTION 'A PCART send claim already exists/.test(CLAIM), "one live claim per draft, one claim per permit");
check("7b", /c\.claim_status = ''RELEASED''/.test(MIG) && /P5 patch anchor not found/.test(MIG), "new permit only after a RELEASED claim (guarded patch)");
// 8 global lock
check("8", /execution_enabled IS DISTINCT FROM false OR k\.emergency_stop_engaged IS DISTINCT FROM true/.test(CLAIM) && !/execution_enabled\s*=\s*true|emergency_stop_engaged\s*=\s*false/i.test(MIG + FNS + PANEL + WALLET), "global lock required, never changed");
// 9 exactly one send primitive in the whole app (outside the generic, untouched paths)
const SEND_FILES = ["src/lib/pcart-production-send-wallet.ts", "src/lib/pcart-production-send.ts", "src/lib/pcart-production-send.functions.ts", "src/components/cartel/PcartMainnetSendPanel.tsx", "src/lib/pcart-production-wallet.ts", "src/components/cartel/PcartFinalSendReviewPanel.tsx", "src/lib/pcart-production-execution.ts", "src/lib/pcart-production-execution.functions.ts"];
const count = (re: RegExp) => SEND_FILES.reduce((n, f) => n + (strip(read(f)).match(re)?.length ?? 0), 0);
check("9a", count(/eth_sendTransaction/g) === 1 && (strip(WALLET).match(/eth_sendTransaction/g)?.length ?? 0) === 1, "exactly one eth_sendTransaction, only in the send helper");
check("9b", count(/wallet_sendTransaction|sendRawTransaction|signTransaction|signTypedData|personal_sign|eth_sign\b|writeContract|sendTransaction\(/g) === 0, "no other sign/send primitives");
check("9c", /onClick=\{\(\) => deployMutation\.mutate\(\)\}/.test(PANEL) && !/useEffect\([^)]*deployMutation/.test(PANEL) && !/useEffect\([^)]*sendCanonicalPcartDeploymentOnce/.test(PANEL), "send only from explicit click");
// 10 envelope
const SAFE = PCART_PRODUCTION_TREASURY_SAFE;
const DEP = "0xa068b94e6f11a7e2daef086c5190dc265a523f67";
const INIT = pcartProductionInitCodeHash(SAFE);
const PRED = predictPcartProductionAddress(DEP, 1n).toLowerCase();
const base = { deploymentId: "b3b44748-d2ad-4456-8d56-5cebba10e774", launchId: "11111111-1111-1111-1111-111111111111", from: DEP, nonce: 1n, initCodeHash: INIT, gasLimit: 2_000_000n, maxFeePerGas: 20_000_000n, maxPriorityFeePerGas: 0n, safe: SAFE, predicted: PRED, reviewFingerprint: "0x" + "a".repeat(64), readinessFingerprint: "0x" + "b".repeat(64) };
const permit: PcartPermitForSend = {
  id: "p", deployment_id: base.deploymentId, launch_id: base.launchId, wallet_account: DEP, deployer_nonce: 1, safe_recipient: SAFE,
  predicted_contract_address: PRED, init_code_hash: INIT, review_fingerprint: base.reviewFingerprint, readiness_fingerprint: base.readinessFingerprint,
  unsigned_tx_fingerprint: pcartUnsignedTxFingerprint(base), gas_limit: 2000000, max_fee_per_gas: 20000000, max_priority_fee_per_gas: 0,
  issued_at: "", expires_at: "", cancelled_at: null, consumed_at: null,
};
const env = buildVerifiedPcartSendEnvelope(permit, { deployer: DEP, nonce: 1n, initCodeHash: INIT });
check("10a", env.ok && env.envelope.from === DEP && env.envelope.value === "0x0" && env.envelope.gas === "0x1e8480" && !("to" in env.envelope) && keccak256(env.envelope.data) === INIT, "exact envelope from/data/value/gas, no to");
check("10b", env.ok && env.maxCostWei === 2_000_000n * 20_000_000n, "max cost = gas × maxFee");
check("10c", !buildVerifiedPcartSendEnvelope({ ...permit, unsigned_tx_fingerprint: "0x" + "c".repeat(64) }, { deployer: DEP, nonce: 1n, initCodeHash: INIT }).ok
  && !buildVerifiedPcartSendEnvelope(permit, { deployer: DEP, nonce: 2n, initCodeHash: INIT }).ok
  && !buildVerifiedPcartSendEnvelope({ ...permit, wallet_account: "0x" + "1".repeat(40) }, { deployer: DEP, nonce: 1n, initCodeHash: INIT }).ok
  && !buildVerifiedPcartSendEnvelope({ ...permit, gas_limit: 2000001 }, { deployer: DEP, nonce: 1n, initCodeHash: INIT }).ok, "fingerprint/nonce/account/gas mismatch refused");
check("10d", /const tx = \{ from: envelope\.from, data: envelope\.data, value: envelope\.value, gas: envelope\.gas \}/.test(WALLET), "wallet receives only the rebuilt envelope fields");
// 11 no second send
check("11a", /sentClaims\.has\(claimId\)/.test(WALLET) && /sentClaims\.add\(claimId\)/.test(WALLET), "in-memory once-per-claim guard");
const m = (status: PcartSendMarker["status"], txHash: string | null = null): PcartSendMarker => ({ claimId: "c", permitId: "p", deploymentId: "d", deployer: DEP, nonce: "1", predicted: PRED, unsignedTxFingerprint: "x", status, txHash });
check("11b", pcartSendBlocked({ claim_status: "CLAIMED", tx_hash: null }, null, null) && pcartSendBlocked({ claim_status: "AMBIGUOUS", tx_hash: null }, null, null) && pcartSendBlocked({ claim_status: "BROADCAST", tx_hash: "0x" }, null, null) && pcartSendBlocked(null, m("HASH_RETURNED", "0x" + "1".repeat(64)), null) && pcartSendBlocked(null, null, "0xabc"), "claim/hash/marker block a second send");
check("11c", !pcartSendBlocked({ claim_status: "RELEASED", tx_hash: null }, m("REJECTED"), null), "released claim + rejected marker allow a fresh P3/P4 cycle");
// 12 rejection
check("12a", classifyPcartWalletResult(undefined, { code: 4001 }) === "REJECTED" && classifyPcartWalletResult(undefined, { code: 4100 }) === "AMBIGUOUS" && classifyPcartWalletResult(undefined, new Error("timeout")) === "AMBIGUOUS", "only 4001 is a rejection");
check("12b", /c\.claim_status <> 'CLAIMED'/.test(RELEASE) && /BigInt\(pending\) !== saved \|\| hasCode\) return \{ ok: true, state: "POSSIBLE_BROADCAST" \}/.test(FNS) && FNS.indexOf("release_canonical_pcart_mainnet_send_claim") > FNS.indexOf("POSSIBLE_BROADCAST"), "rejection release only after nonce/code proof");
// 13 ambiguous never auto-releases
check("13a", classifyPcartWalletResult("not-a-hash", null) === "AMBIGUOUS" && /mark_canonical_pcart_send_ambiguous/.test(PANEL), "unknown results are marked AMBIGUOUS");
check("13b", /c\.claimed_at > now\(\) - interval '120 seconds'/.test(RELEASE) && /last_recovery_checked_at > now\(\) - interval '30 seconds'/.test(RELEASE) && !/RELEASE_AMBIGUOUS[\s\S]{0,80}useEffect/.test(PANEL), "ambiguous release needs delay + prior clean check + explicit click");
// 14 persistence failure
check("14", /Retry recording transaction/.test(PANEL) && /recordHash\(marker\.claimId, marker\.txHash\)/.test(PANEL) && !/retryRecordMutation[\s\S]{0,400}sendCanonicalPcartDeploymentOnce/.test(PANEL), "record retry never resends");
check("14b", PANEL.indexOf('status: "HASH_RETURNED"') < PANEL.indexOf("await recordHash(c.claimId"), "hash saved locally before any server call");
// 15 immutable hash + atomic submit
check("15a", /OLD\.tx_hash IS NOT NULL AND NEW\.tx_hash IS DISTINCT FROM OLD\.tx_hash/.test(TRIG) && /tx_hash text UNIQUE/.test(MIG), "claim tx hash immutable + unique");
check("15b", /SET claim_status = 'BROADCAST', tx_hash = v_hash, broadcast_at = now\(\)[\s\S]*SET status = 'SUBMITTED', tx_hash = v_hash, submitted_at = now\(\)/.test(RECORD) && /d\.status IS DISTINCT FROM 'DRAFT' OR d\.tx_hash IS NOT NULL/.test(RECORD), "DRAFT→SUBMITTED + claim BROADCAST in one RPC");
// 16 reload marker
check("16", PANEL.indexOf("saveMarker(base)") < PANEL.indexOf("sendCanonicalPcartDeploymentOnce(c.claimId") && pcartMarkerBlocksSend(m("SEND_IN_PROGRESS")) && /readPcartSendMarker\(attempt\.id\)/.test(PANEL), "marker written before wallet call and blocks after reload");
// 17 moved nonce / code
check("17", /BigInt\(latest\) > saved/.test(FNS) && /hasCode/.test(FNS) && /A transaction is recorded; claim cannot be released/.test(RELEASE), "moved nonce / predicted code never releases");
// 18 recovery attach
check("18", /tx\.to === null && tx\.value === 0n/.test(FNS) && /keccak256\(tx\.input\)\.toLowerCase\(\) === String\(d\.init_code_hash\)/.test(FNS) && /BigInt\(t\.nonce\) === saved/.test(FNS) && /record_canonical_pcart_mainnet_tx_hash/.test(FNS), "recovery attaches only a proven matching CREATE tx");
// 19 outside window UI
const outside = PANEL.slice(PANEL.indexOf('if (windowState !== "OPEN") {'), PANEL.indexOf("const confirmed = isPcartSendConfirmed"));
check("19", outside.length > 0 && !/<Button/.test(outside) && /Scheduled — send available/.test(outside), "outside window: no send button");
// 20 confirmation
check("20", PCART_SEND_CONFIRM_PHRASE === "DEPLOY PCART" && isPcartSendConfirmed(true, "DEPLOY PCART") && !isPcartSendConfirmed(false, "DEPLOY PCART") && !isPcartSendConfirmed(true, "deploy pcart") && /disabled=\{busy \|\| !confirmed \|\| blocked\}/.test(PANEL), "checkbox + exact DEPLOY PCART required");
// 21 canary
check("21", /CANONICAL_PCART_PROTECTED/.test(CANARY), "generic canary still CANONICAL_PCART_PROTECTED");
// 22 no side effects
check("22", !/register_verified_launch_contract|apply_launch_chain_production|notify_launch_watchers|liquidity|auction|send_window_issuance|canary_execution|presign_authorization\(/i.test(strip(FNS + PANEL + WALLET + PURE)) &&
  !/register_verified_launch_contract|apply_launch_chain|notify_launch_watchers|INSERT INTO public\.launch_chain_production_|UPDATE public\.launches|official_contract_address =/i.test(MIG), "no verification/registration/liquidity/auction/generic send-stage side effects");
// summary
check("23", pcartP5SummaryText({ window: "BEFORE", readyToSend: true, claimStatus: null, submitted: false }) === "Mainnet deployment scheduled — not yet available"
  && pcartP5SummaryText({ window: "OPEN", readyToSend: false, claimStatus: null, submitted: false }) === "Mainnet deployment window open — fresh review required"
  && pcartP5SummaryText({ window: "OPEN", readyToSend: true, claimStatus: "CLAIMED", submitted: false }) === "Deployment claimed — awaiting wallet decision"
  && pcartP5SummaryText({ window: "OPEN", readyToSend: false, claimStatus: "AMBIGUOUS", submitted: false }) === "Deployment result unknown — do not retry"
  && pcartP5SummaryText({ window: "AFTER", readyToSend: false, claimStatus: null, submitted: true }) === "Mainnet transaction broadcast — verification required", "Review & Launch summary states");
check("24", /PcartMainnetSendPanel/.test(LC) && /pcartP5Text \?\? pcartMainnetBaseText/.test(LC), "P5 panel + summary wired into Launch Control");

console.log(`\n${pass} passed, ${fail} failed`);
if (fail) process.exit(1);
