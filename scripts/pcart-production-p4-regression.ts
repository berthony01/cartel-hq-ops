/**
 * PCART P4 — READY TO SEND regression (deterministic; no network, no wallet, no DB writes).
 */
import { readFileSync, readdirSync } from "node:fs";
import { keccak256 } from "viem";

import {
  buildPcartUnsignedEnvelope,
  isPcartAddressConfirmation,
  isPcartExecutionPermitActive,
  pcartGasLimitFromEstimate,
  pcartMaxCostWei,
  pcartUnsignedTxFingerprint,
  pcartUnsignedTxFingerprintPreimage,
  PCART_EXECUTION_PERMIT_MAX_TTL_MS,
} from "../src/lib/pcart-production-execution";
import { pcartProductionInitCodeHash, predictPcartProductionAddress } from "../src/lib/pcart-production-intent";
import { pcartMainnetSummary } from "../src/lib/pcart-launch-readiness";
import { evaluatePcartWalletBinding } from "../src/lib/pcart-production-wallet";

let pass = 0, fail = 0;
const check = (id: string, ok: boolean, label: string) => { ok ? pass++ : fail++; console.log(`${ok ? "PASS" : "FAIL"} ${id} ${label}`); };
const read = (p: string) => readFileSync(p, "utf8");
const strip = (s: string) => s.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "").replace(/^\s*\*.*$/gm, "");

const MIG_FILE = readdirSync("supabase/migrations").filter((f) => read(`supabase/migrations/${f}`).includes("FUNCTION public.issue_canonical_pcart_execution_permit")).sort().at(-1)!;
const MIG = read(`supabase/migrations/${MIG_FILE}`);
const ISSUE = MIG.slice(MIG.indexOf("FUNCTION public.issue_canonical_pcart_execution_permit"), MIG.indexOf("FUNCTION public.cancel_canonical_pcart_execution_permit"));
const CANCEL = MIG.slice(MIG.indexOf("FUNCTION public.cancel_canonical_pcart_execution_permit"));
const PURE = read("src/lib/pcart-production-execution.ts");
const FNS = read("src/lib/pcart-production-execution.functions.ts");
const CLIENT = read("src/lib/pcart-production-execution-permit.ts");
const PANEL = read("src/components/cartel/PcartFinalSendReviewPanel.tsx");
const LC = read("src/routes/_authenticated/launch-control.tsx");
const CANARY = read("src/lib/chain-mainnet-canary.functions.ts");
const OWNER = /auth\.uid\(\) IS NULL OR NOT public\.is_platform_owner\(auth\.uid\(\)\)/;

const DEP = "0xa068b94e6f11a7e2daef086c5190dc265a523f67";
const SAFE = "0xe0d055b3e07c2d1d9c1762ca9e19b3062207ad03";
const PRED = predictPcartProductionAddress(DEP, 1n);

// 1
check("1a", OWNER.test(ISSUE) && OWNER.test(CANCEL), "issue + cancel owner-only");
check("1b", /USING \(public\.is_platform_owner\(auth\.uid\(\)\)\)/.test(MIG) && /FROM PUBLIC, anon/.test(MIG) && !/GRANT (INSERT|UPDATE|DELETE|ALL)[^;]*TO authenticated/.test(MIG), "owner-only read; no anon; no direct writes");
// 2
check("2", /is_canonical_pcart_launch\(d\.launch_id\)/.test(ISSUE) && /d\.chain_id IS DISTINCT FROM 4663 OR d\.network_environment IS DISTINCT FROM 'PRODUCTION'/.test(ISSUE) && /d\.status IS DISTINCT FROM 'DRAFT' OR d\.tx_hash IS NOT NULL OR d\.submitted_at IS NOT NULL OR d\.contract_address IS NOT NULL/.test(ISSUE), "only unsent canonical PCART DRAFT on PRODUCTION/4663");
// 3
check("3a", /p\.deployment_id IS DISTINCT FROM d\.id/.test(ISSUE) && /p\.wallet_account IS DISTINCT FROM lower\(d\.deployer_address\)/.test(ISSUE) && /p\.review_fingerprint IS DISTINCT FROM/.test(ISSUE) && /p\.readiness_fingerprint IS DISTINCT FROM/.test(ISSUE), "P3 authorization bound to same draft/wallet/fingerprints");
check("3b", /p\.cancelled_at IS NOT NULL OR p\.expires_at <= now\(\) OR p\.issued_at < now\(\) - interval '90 seconds'/.test(ISSUE), "P3 authorization active and <=90s old");
check("3c", /fail\("PREPARATION_NOT_ACTIVE"\)/.test(FNS), "server review requires active P3 authorization");
// 4
check("4", /lower\(d\.token_recipient\) IS DISTINCT FROM c_safe/.test(ISSUE) && /NOT IN \(lower\(s\.signer_1\), lower\(s\.signer_2\), lower\(s\.signer_3\)\)/.test(ISSUE) && /lower\(d\.deployer_address\) = c_safe/.test(ISSUE) &&
  /token_total_supply IS DISTINCT FROM c_supply/.test(ISSUE) && /lower\(d\.init_code_hash\) IS DISTINCT FROM c_init_hash/.test(ISSUE) && /lower\(d\.review_fingerprint\) IS DISTINCT FROM v_expected_review/.test(ISSUE) &&
  /a\.readiness_fingerprint IS DISTINCT FROM ev->>'fingerprint'/.test(ISSUE), "deployer/signers/Safe/intent/init hash/review + readiness fingerprints enforced");
// 5/6/7 (server reuses P3 revalidation)
check("5", /await revalidate\(ctx, deploymentId, wallet\)/.test(FNS) && /export async function revalidate/.test(read("src/lib/pcart-production-preparation.functions.ts")), "server review reuses P3 nonce/code/chain revalidation");
check("5b", (evaluatePcartWalletBinding({ account: DEP, chainId: 4663, latestNonce: 1n, pendingNonce: 2n, balanceWei: 1n }, { deployer: DEP, nonce: 1n }) as any).reason === "NONCE_PENDING", "latest != pending fails closed");
// 8
check("8a", /if \(balance < maxCost\) return fail\("INSUFFICIENT_BALANCE"\)/.test(FNS) && pcartMaxCostWei(720_000n, 10n) === 7_200_000n, "balance must cover gas limit × max fee");
check("8b", pcartGasLimitFromEstimate(600_897n) === 721_077n, "gas limit = ceil(estimate × 1.2)");
// 9
check("9", /k\.execution_enabled IS DISTINCT FROM false OR k\.emergency_stop_engaged IS DISTINCT FROM true/.test(ISSUE), "global execution off + emergency stop on required");
// 10
check("10", /launch_chain_production_send_window_issuances w WHERE w\.deployment_id = d\.id/.test(ISSUE) && /canary_permits c WHERE c\.deployment_id = d\.id/.test(ISSUE) && /presign_authorizations g WHERE g\.deployment_id = d\.id/.test(ISSUE), "no generic send window/canary permit/presign association");
// 11
check("11", /c_ttl constant interval := interval '30 seconds'/.test(ISSUE) && /expires_at <= issued_at \+ interval '30 seconds'/.test(MIG) && PCART_EXECUTION_PERMIT_MAX_TTL_MS === 30_000, "permit TTL <= 30s");
// 12
check("12", /unsigned_tx_fingerprint = v_fp AND v_row\.preparation_authorization_id = p\.id/.test(ISSUE) && /A final send permit is already active/.test(ISSUE) && /FOR UPDATE/.test(ISSUE), "idempotent identical issue; collisions refused");
// 13
check("13", /UPDATE public\.pcart_production_execution_permits\s+SET cancelled_at = now\(\), cancelled_by = auth\.uid\(\)/.test(CANCEL) && !/launch_chain_deployments/.test(CANCEL) && /cannot be deleted/.test(MIG) && /CHECK \(consumed_at IS NULL\)/.test(MIG), "cancel touches permit only; never deleted; never consumed in P4");
// 14
const t0 = Date.parse("2026-10-05T11:00:00Z");
const pm = { issued_at: new Date(t0).toISOString(), expires_at: new Date(t0 + 30_000).toISOString(), cancelled_at: null };
check("14", isPcartExecutionPermitActive(pm, t0 + 1) && !isPcartExecutionPermitActive(pm, t0 + 30_000) && !isPcartExecutionPermitActive({ ...pm, cancelled_at: pm.issued_at }, t0 + 1) &&
  !isPcartExecutionPermitActive({ ...pm, expires_at: new Date(t0 + 60_000).toISOString() }, t0 + 1), "expired/cancelled/over-long permit is not ready evidence");
// 15
const env = buildPcartUnsignedEnvelope(DEP.toUpperCase().replace("0X", "0x"), SAFE, 721_077n);
check("15", Object.keys(env).sort().join(",") === "data,from,gas,value" && env.value === "0x0" && env.from === DEP && env.gas === "0xb00b5" && keccak256(env.data) === pcartProductionInitCodeHash(SAFE), "envelope is exactly from/data/value/gas, no to, frozen init code");
// 16
const fpIn = { deploymentId: "B3B44748-d2ad-4456-8d56-5cebba10e774", launchId: "b3b44748-d2ad-4456-8d56-5cebba10e774", from: "0xA068b94e6f11a7e2daef086c5190dc265a523f67", nonce: 1n, initCodeHash: "0xab", gasLimit: 720000n, maxFeePerGas: 100000000n, maxPriorityFeePerGas: 1000n, safe: SAFE, predicted: "0x1111111111111111111111111111111111111111", reviewFingerprint: "0xcd", readinessFingerprint: "0xef" };
check("16a", pcartUnsignedTxFingerprint(fpIn) === "0x5d7757b2a76fa925a05f82c7cdeceb0cf79531438d778a788a96dfe68a321f99", "TS fingerprint byte-identical to the live DB recomputation");
check("16b", pcartUnsignedTxFingerprint({ ...fpIn, gasLimit: 720001n }) !== pcartUnsignedTxFingerprint(fpIn) && pcartUnsignedTxFingerprintPreimage(fpIn).includes("|CREATE|0|"), "fingerprint binds gas/fees/no-to/value 0");
check("16c", /v_fp IS DISTINCT FROM v_expected_fp/.test(ISSUE) && /r\.unsignedTxFingerprint !== data\.reviewedUnsignedTxFingerprint/.test(FNS), "fingerprint recomputed server-side and in DB");
// 17
check("17", /readPcartWalletEvidence/.test(PANEL) && !/eth_requestAccounts|getInjectedProvider|appKit/i.test(strip(PANEL)), "P4 reuses the P3 bound provider; no new connector");
// 18
check("18a", isPcartAddressConfirmation(PRED.toUpperCase().replace("0X", "0x"), PRED) && !isPcartAddressConfirmation(DEP, PRED) && !isPcartAddressConfirmation("", PRED), "typed predicted-address confirmation");
check("18b", !/onPaste/.test(PANEL) && !/preventDefault/.test(PANEL) && /ADDRESS_CONFIRMATION_MISMATCH/.test(FNS) && /isPcartAddressConfirmation\(data\.typedPredictedAddress/.test(FNS), "paste allowed; server still re-checks exact confirmation");
check("18c", /navigator\.clipboard\.writeText\(review\.predictedAddress\)/.test(PANEL) && (PANEL.match(/clipboard\.writeText\(/g) ?? []).length === 1 && /onClick=\{\(\) => void copyPredicted\(\)\}>Copy predicted address</.test(PANEL), "copy button copies only reviewed predicted address on click");
check("18d", /disabled=\{!reviewFresh \|\| !ack \|\| !isPcartAddressConfirmation\(typed, review\.predictedAddress\)/.test(PANEL) && /Review expired\. Run final send review again\./.test(PANEL) && /Prepare is disabled because the review expired/.test(PANEL), "checkbox + exact match + freshness required; expiry reason shown");
check("18e", /PCART_FINAL_REVIEW_TTL_MS = 60_000/.test(PURE) && PCART_EXECUTION_PERMIT_MAX_TTL_MS === 30_000, "final-review TTL 60s; permit TTL stays 30s");
check("18f", /review\.predictedAddress\.toLowerCase\(\) !== r\.predictedAddress\.toLowerCase\(\)\) \{ setTyped\(""\)/.test(PANEL) && !/onMutate: \(\) => \{[^}]*setTyped/.test(PANEL) && /subscribePcartWallet\(\(\) => \{[^}]*setTyped\(""\)/.test(PANEL), "rerun keeps typed address if unchanged; wallet change clears");
// 19/20
check("19", !/>\s*(Send|Deploy|Launch)( token| now| PCART| transaction)?\s*</.test(PANEL), "no Send/Deploy/Launch button");
const FORBIDDEN = /eth_sendTransaction|wallet_sendTransaction|sendTransaction|writeContract|signTransaction|signTypedData|personal_sign|eth_sign\b|sendRawTransaction|authorize_launch_chain_production_send_window_issuance|authorizeMainnetSendWindow|issue_launch_chain_production_presign|presignMainnetTokenDeployment|armCanary|arm_launch|persistMainnetDeploymentTxHash|submit_launch_chain_production_deployment_tx|register_verified_launch_contract|notify|telegram|claimMainnetDeploymentHandoff|sendClaimedMainnetDeployment|execution_enabled\s*[:=]\s*true|emergency_stop_engaged\s*[:=]\s*false/i;
for (const [k, v] of Object.entries({ PURE, FNS, CLIENT, PANEL, MIG: MIG.replace(/--.*$/gm, "") })) {
  const body = k === "MIG" ? v : strip(v);
  const hit = body.match(FORBIDDEN);
  const writes = k !== "MIG" && /\.(insert|update|upsert|delete)\(/.test(body);
  const migWrites = k === "MIG" && /UPDATE public\.(launch_chain_deployments|launches|launch_chain_production_execution_controls)|INSERT INTO public\.launch_chain/.test(body);
  check(`20-${k}`, !hit && !writes && !migWrites, `${k} has no send/sign/arm/window/registration/control primitive${hit ? ` (found ${hit[0]})` : ""}`);
}
// 21
check("21", /return attemptFail\("CANONICAL_PCART_PROTECTED"\)/.test(CANARY), "generic canary still CANONICAL_PCART_PROTECTED");
// 22/E summary
check("22", pcartMainnetSummary({ approved: true, executionLocked: true, draftSaved: true }) === "Reviewed draft saved — wallet preparation next" &&
  pcartMainnetSummary({ approved: true, executionLocked: true, draftSaved: true, walletReady: true }) === "Wallet ready — final send review next" &&
  pcartMainnetSummary({ approved: true, executionLocked: true, draftSaved: true, walletReady: true, readyToSend: true }) === "Ready to send — no transaction sent" &&
  pcartMainnetSummary({ approved: true, executionLocked: false, draftSaved: true, readyToSend: true }) === "Execution control not locked — review required", "summary states");
check("23", /<PcartFinalSendReviewPanel attempt=\{pcartUnsentDraft\} \/>/.test(LC) && /readyToSend: isPcartExecutionPermitActive\(pcartPermitQuery\.data, Date\.now\(\)\)/.test(LC), "Launch Control wires P4 panel + summary to authoritative permit state");

console.log(`\npcart-production-p4: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
