/**
 * PCART P6 — post-broadcast verification + finality regression
 * (deterministic; no network, no wallet, no DB writes).
 */
import { readFileSync, readdirSync } from "node:fs";
import { keccak256 } from "viem";

import {
  classifyPcartP6,
  classifyPcartP6Finality,
  isPcartP6Active,
  pcartP6ConfirmedRecheck,
  pcartP6SummaryText,
  PCART_P6_NOT_OFFICIAL_COPY,
  type PcartP6Intent,
  type PcartP6Observation,
} from "../src/lib/pcart-production-verify";
import { buildPcartProductionInitCode, pcartProductionInitCodeHash, predictPcartProductionAddress, PCART_PRODUCTION_TREASURY_SAFE } from "../src/lib/pcart-production-intent";
import { PEPECARTEL_TOKEN_RUNTIME_BYTECODE } from "../src/lib/pepecartel-token.artifact";

let pass = 0, fail = 0;
const check = (id: string, ok: boolean, label: string) => { ok ? pass++ : fail++; console.log(`${ok ? "PASS" : "FAIL"} ${id} ${label}`); };
const read = (p: string) => readFileSync(p, "utf8");
const strip = (s: string) => s.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "").replace(/^\s*\*.*$/gm, "");

const MIG_FILE = readdirSync("supabase/migrations").filter((f) => read(`supabase/migrations/${f}`).includes("FUNCTION public.apply_canonical_pcart_production_verification")).sort().at(-1)!;
const MIG = read(`supabase/migrations/${MIG_FILE}`);
const sect = (a: string, b?: string) => MIG.slice(MIG.indexOf(a), b ? MIG.indexOf(b) : undefined);
const ASSERT = sect("FUNCTION private.pcart_p6_assert_row", "FUNCTION public.apply_canonical_pcart_production_verification");
const VERIFY = sect("FUNCTION public.apply_canonical_pcart_production_verification", "FUNCTION public.apply_canonical_pcart_production_finality");
const FINAL = sect("FUNCTION public.apply_canonical_pcart_production_finality");
const TRIG = sect("FUNCTION public.enforce_launch_chain_deployment_update", "FUNCTION private.pcart_p6_assert_row");
const PURE = read("src/lib/pcart-production-verify.ts");
const FNS = read("src/lib/pcart-production-verify.functions.ts");
const PANEL = read("src/components/cartel/PcartVerificationPanel.tsx");
const LC = read("src/routes/_authenticated/launch-control.tsx");
const GENERIC = read("src/lib/chain-mainnet-verify.functions.ts");
const CANARY = read("src/lib/chain-mainnet-canary.functions.ts");

const DEP = "0xa068b94e6f11a7e2daef086c5190dc265a523f67";
const SAFE = PCART_PRODUCTION_TREASURY_SAFE;
const INPUT = buildPcartProductionInitCode(SAFE);
const PRED = predictPcartProductionAddress(DEP, 1n).toLowerCase();
const HASH = "0x" + "ab".repeat(32);
const SUPPLY = 10n ** 27n;
const intent = (status = "SUBMITTED"): PcartP6Intent => ({ status, txHash: HASH, deployer: DEP, nonce: 1n, initCodeHash: pcartProductionInitCodeHash(SAFE), safe: SAFE, claimPredictedAddress: PRED });
const tx = (o: Partial<{ hash: string; from: string; to: string | null; nonce: bigint; value: bigint; input: string }> = {}) => ({ hash: HASH, from: DEP, to: null, nonce: 1n, value: 0n, input: INPUT, ...o });
const receipt = (o: Partial<{ status: "success" | "reverted"; contractAddress: string | null }> = {}) => ({ transactionHash: HASH, status: "success" as const, contractAddress: PRED, blockNumber: 100n, blockHash: "0x" + "cd".repeat(32), ...o });
const contract = (o: Partial<{ runtimeCode: string; name: string; symbol: string; decimals: number; totalSupply: bigint; safeBalance: bigint; deployerBalance: bigint }> = {}) => ({ runtimeCode: PEPECARTEL_TOKEN_RUNTIME_BYTECODE, name: "PEPECARTEL", symbol: "PCART", decimals: 18, totalSupply: SUPPLY, safeBalance: SUPPLY, deployerBalance: 0n, ...o });
const good = (): PcartP6Observation => ({ tx: tx(), receipt: receipt(), latestNonce: 2n, contract: contract(), latestBlock: 104n });
const OWNER = /auth\.uid\(\) IS NULL OR NOT public\.is_platform_owner\(auth\.uid\(\)\)/;

// 1 inert for DRAFT/FAILED/ABANDONED
check("1a", ["DRAFT", "FAILED", "ABANDONED"].every((s) => classifyPcartP6(intent(s), good()).kind === "REFUSED") && !isPcartP6Active("DRAFT"), "pure classifier refuses DRAFT/FAILED/ABANDONED");
check("1b", /d\.status NOT IN \('SUBMITTED','PENDING','CONFIRMED'\)/.test(ASSERT), "DB refuses non-SUBMITTED/PENDING/CONFIRMED");
check("1c", /tx_hash IS NULL OR d\.submitted_at IS NULL/.test(ASSERT), "DB requires tx_hash + submitted_at");
// 2 owner-only
check("2a", OWNER.test(ASSERT) && /pcart_p6_assert_row\(_deployment_id, true\)/.test(VERIFY) && /pcart_p6_assert_row\(_deployment_id, true\)/.test(FINAL), "both apply RPCs owner-gated via shared assert");
check("2b", /FROM PUBLIC, anon;/.test(VERIFY + FINAL) && /pcart_p6_assert_row\(uuid, boolean\) FROM PUBLIC, anon, authenticated/.test(MIG), "anon revoked; assert helper not callable");
check("2c", /is_platform_owner/.test(FNS) && /requireSupabaseAuth/.test(FNS), "server fns owner-checked");
// 3 exact canonical
check("3a", /is_canonical_pcart_launch/.test(ASSERT) && /chain_id IS DISTINCT FROM 4663/.test(ASSERT) && /'pepecartel-token-v1'/.test(ASSERT) && /1000000000000000000000000000::numeric/.test(ASSERT), "exact canonical PCART/PRODUCTION/4663 intent");
check("3b", /official_contract_address IS NOT NULL/.test(ASSERT) && /pcart_production_readiness_evidence\(d\.launch_id, false\)/.test(ASSERT), "no official contract + readiness evidence (non-zero-rows mode)");
// 4 broadcast claim
check("4a", /claim_status = 'BROADCAST' AND tx_hash = d\.tx_hash/.test(ASSERT) && /v_hash IS DISTINCT FROM d\.tx_hash/.test(VERIFY), "BROADCAST claim with identical tx hash required");
check("4b", !/SET[^;]*\b(tx_hash|deployer_address|deployer_nonce_before|token_recipient|init_code_hash|review_fingerprint)\s*=/.test(VERIFY + FINAL), "apply RPCs never write identity/intent columns");
// 5 tx fields
check("5a", classifyPcartP6(intent(), { ...good(), tx: tx({ from: "0x" + "11".repeat(20) }) }).kind === "FAILED", "wrong sender fails");
const code = (o: PcartP6Observation) => { const r = classifyPcartP6(intent(), o); return r.kind === "FAILED" ? r.code : r.kind; };
check("5b", code({ ...good(), tx: tx({ to: "0x" + "22".repeat(20) }) }) === "MISMATCH_TO", "to != null fails");
check("5c", code({ ...good(), tx: tx({ nonce: 2n }) }) === "MISMATCH_NONCE", "nonce mismatch fails");
check("5d", code({ ...good(), tx: tx({ value: 1n }) }) === "MISMATCH_VALUE", "value != 0 fails");
check("5e", code({ ...good(), tx: tx({ input: INPUT + "00" }) }) === "MISMATCH_INIT_CODE", "init code hash mismatch fails");
// 6 receipt success
check("6", code({ ...good(), receipt: receipt({ status: "reverted" }) }) === "REVERTED", "reverted => FAILED REVERTED");
// 7 predicted address
check("7a", code({ ...good(), receipt: receipt({ contractAddress: "0x" + "33".repeat(20) }) }) === "MISMATCH_CONTRACT_ADDRESS", "receipt address must equal predicted CREATE");
check("7b", classifyPcartP6({ ...intent(), claimPredictedAddress: "0x" + "44".repeat(20) }, good()).kind === "REFUSED", "claim prediction must equal CREATE derivation");
check("7c", /v_addr IS DISTINCT FROM lower\(c\.predicted_contract_address\)/.test(VERIFY), "DB requires claim predicted address");
// 8 runtime
check("8a", code({ ...good(), contract: contract({ runtimeCode: "0x6000" }) }) === "MISMATCH_RUNTIME" && code({ ...good(), contract: contract({ runtimeCode: "0x" }) }) === "MISMATCH_RUNTIME", "runtime hash exact; empty code fails");
check("8b", VERIFY.includes(keccak256(PEPECARTEL_TOKEN_RUNTIME_BYTECODE).toLowerCase()), "DB pins the frozen runtime hash");
// 9 metadata
check("9", ["name", "symbol"].every((k) => code({ ...good(), contract: contract({ [k]: "X" }) }) === "MISMATCH_TOKEN_METADATA") && code({ ...good(), contract: contract({ decimals: 6 }) }) === "MISMATCH_TOKEN_METADATA" && code({ ...good(), contract: contract({ totalSupply: SUPPLY - 1n }) }) === "MISMATCH_TOKEN_METADATA", "name/symbol/decimals/supply exact");
// 10/11 balances at deployment block
check("10a", code({ ...good(), contract: contract({ safeBalance: SUPPLY - 1n }) }) === "MISMATCH_SAFE_BALANCE", "Safe must hold full supply");
check("10b", /blockNumber\s*\}/.test(FNS) && /getCode\(\{ address, blockNumber \}\)/.test(FNS) && /readContractAt\(client, [^)]*obs\.receipt\.blockNumber/.test(FNS), "contract reads pinned to deployment block");
check("11", code({ ...good(), contract: contract({ deployerBalance: 1n }) }) === "MISMATCH_DEPLOYER_BALANCE" && /_deployer_balance_text IS DISTINCT FROM '0'/.test(VERIFY), "deployer balance 0");
// 12 transient
check("12a", code({ ...good(), tx: undefined }) === "RETRYABLE" && code({ ...good(), receipt: undefined }) === "RETRYABLE" && code({ ...good(), contract: undefined }) === "RETRYABLE", "provider/metadata failures retryable");
check("12b", code({ tx: null, receipt: null, latestNonce: 1n }) === "RETRYABLE" && code({ tx: null, receipt: null, latestNonce: undefined }) === "RETRYABLE", "not visible + nonce unmoved => retryable");
// 13 pending
check("13", code({ tx: tx(), receipt: null, latestNonce: 1n }) === "PENDING", "known unmined tx => PENDING");
// 14 replacement
check("14a", code({ tx: null, receipt: null, latestNonce: 2n, replacementTx: tx({ hash: "0x" + "ef".repeat(32) }) }) === "REPLACED_OR_DROPPED", "different tx at nonce => REPLACED_OR_DROPPED");
check("14b", code({ tx: null, receipt: null, latestNonce: 2n, replacementTx: undefined }) === "RETRYABLE" && code({ tx: null, receipt: null, latestNonce: 2n, replacementTx: null }) === "RETRYABLE", "scan failure/inconclusive never fails");
// 15/16 terminal
check("15", /'REVERTED','REPLACED_OR_DROPPED'/.test(VERIFY), "DB accepts only enumerated terminal codes");
check("16", code(good()) === "CONFIRMED", "all checks pass => CONFIRMED");
// 17 confirmed not downgraded
check("17a", /IF d\.status = 'CONFIRMED' THEN RETURN d; END IF; -- never downgrade/.test(VERIFY) && /Confirmed PCART evidence contradicted/.test(VERIFY), "DB: PENDING no-op, FAILED refused on CONFIRMED");
check("17b", pcartP6ConfirmedRecheck({ kind: "RETRYABLE", reason: "x" }) === "UNCHANGED" && pcartP6ConfirmedRecheck({ kind: "FAILED", code: "MISMATCH_RUNTIME" }) === "INCIDENT", "pure confirmed recheck");
check("17c", /d\.status === "CONFIRMED" && out\.kind !== "CONFIRMED"/.test(FNS), "server never applies non-CONFIRMED over CONFIRMED");
// 18 finality
const F = (o: Partial<Parameters<typeof classifyPcartP6Finality>[0]>) => classifyPcartP6Finality({ blockNumber: 100n, blockHash: "0x" + "cd".repeat(32), storedHead: null, finalizedHead: 120n, rereadHash: "0x" + "cd".repeat(32), ...o }).kind;
check("18a", F({}) === "FINALIZED" && F({ finalizedHead: 99n }) === "FINALITY_PENDING", "finalized head >= block required");
check("18b", F({ rereadHash: "0x" + "00".repeat(32) }) === "PROVIDER_INCONSISTENT" && F({ storedHead: 130n }) === "PROVIDER_INCONSISTENT" && F({ finalizedHead: undefined }) === "RETRYABLE", "block-hash re-read + head retreat + transient");
check("18c", /v_reread IS DISTINCT FROM d\.block_hash/.test(FINAL) && /_finalized_head_block_number < d\.block_number/.test(FINAL) && /blockTag: "finalized"/.test(FNS), "DB/server finality evidence checks");
check("18d", /d\.status IS DISTINCT FROM 'CONFIRMED'/.test(FINAL), "finality only on CONFIRMED");
// 19 idempotent
check("19", /IF d\.finality_state = 'FINALIZED' THEN RETURN d; END IF;/.test(FINAL), "FINALIZED immutable/idempotent");
// trigger narrowness
check("19b", /current_setting\('cartel\.pcart_p6_finality', true\) = 'on'/.test(TRIG) && /OLD\.artifact_id = 'pepecartel-token-v1'/.test(TRIG) && /to_jsonb\(NEW\) - ARRAY/.test(TRIG) && /set_config\('cartel\.pcart_p6_finality', 'on', true\)/.test(FINAL), "trigger exemption: finality columns only, PCART only, txn-local flag");
// 20 no side effects
const P6 = strip(VERIFY + FINAL + ASSERT);
check("20", !/register_verified_launch_contract|UPDATE public\.launches|official_contract_address\s*=|production_execution_controls|liquidity|telegram|launch_events|notification/i.test(P6) && !/register_verified_launch_contract|launch_events|telegram|liquidity/i.test(strip(FNS)), "no registration/lifecycle/liquidity/notification side effects");
// 21 generic still refuses PCART
check("21", /row\.artifact_id !== CARTEL_FIXED_ERC20_ARTIFACT_ID/.test(GENERIC), "generic production verifier still refuses non-generic artifacts");
// 22 canary
check("22", /CANONICAL_PCART_PROTECTED/.test(CANARY), "generic canary still CANONICAL_PCART_PROTECTED");
// 23 no send/sign
const ALL = strip(PURE + FNS + PANEL);
check("23", !/eth_sendTransaction|wallet_sendTransaction|sendTransaction|signTransaction|signMessage|personal_sign|eth_sign|privateKey|claim_canonical_pcart_mainnet_send|sendCanonicalPcartDeploymentOnce/.test(ALL), "no send/sign/claim primitives in P6 files");
// 24 UI inert for DRAFT
check("24a", /attempt\.status === "DRAFT"/.test(PANEL) && /Verification becomes available after mainnet broadcast\./.test(PANEL), "DRAFT shows inert text only");
check("24b", /attempt\.status === "SUBMITTED" \|\| attempt\.status === "PENDING"/.test(PANEL) && /confirmed && !finalized/.test(PANEL), "buttons only for broadcast/confirmed states");
check("24c", PANEL.includes("PCART_P6_NOT_OFFICIAL_COPY") && PCART_P6_NOT_OFFICIAL_COPY.startsWith("Verification does not register"), "not-official copy shown");
check("24d", /PcartVerificationPanel/.test(LC) && /pcartP6Text \?\? pcartP5Text \?\? pcartMainnetBaseText/.test(LC), "Launch Control wired");
// summary mapping
check("25", pcartP6SummaryText({ status: "DRAFT", finalityState: null }) === null &&
  pcartP6SummaryText({ status: "SUBMITTED", finalityState: null }) === "Mainnet transaction broadcast — verification required" &&
  pcartP6SummaryText({ status: "CONFIRMED", finalityState: "FINALITY_PENDING" }) === "Contract verified — finality pending" &&
  pcartP6SummaryText({ status: "CONFIRMED", finalityState: "FINALIZED" }) === "Contract verified & finalized — official registration next" &&
  pcartP6SummaryText({ status: "FAILED", finalityState: null }) === "Deployment verification failed — stop", "truthful summary mapping");

console.log(`\n${pass} passed, ${fail} failed`);
if (fail) process.exit(1);
