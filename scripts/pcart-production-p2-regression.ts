/**
 * PCART P2 — production review / draft regression (deterministic, no network,
 * no wallet, no DB writes). Exercises the pure intent helper and inspects the
 * applied migration SQL, the read-only review server function, the draft
 * client, the UI panel and the generic canary entry point.
 */
import { readFileSync, readdirSync } from "node:fs";
import { keccak256 } from "viem";

import {
  PCART_PRODUCTION_REVIEW_TTL_MS,
  PCART_PRODUCTION_TREASURY_SAFE,
  buildPcartProductionInitCode,
  isAllowedPcartDeployer,
  isPcartReviewFresh,
  pcartProductionFingerprintPreimage,
  pcartProductionInitCodeHash,
  pcartProductionReviewFingerprint,
  predictPcartProductionAddress,
} from "../src/lib/pcart-production-intent";
import { PEPECARTEL_TOKEN_CREATION_BYTECODE } from "../src/lib/pepecartel-token.artifact";
import {
  derivePcartReadiness,
  isPcartLaunchScheduleExpired,
  pcartMainnetSummary,
} from "../src/lib/pcart-launch-readiness";
import { findPcartProductionAttempt, isUnsentPcartDraft } from "../src/lib/pcart-production-draft";

let pass = 0;
let fail = 0;
function check(id: string, ok: boolean, label: string) {
  if (ok) pass++;
  else fail++;
  console.log(`${ok ? "PASS" : "FAIL"} ${id} ${label}`);
}
const read = (p: string) => readFileSync(p, "utf8");
const noComments = (s: string) => s.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");

const P2_MIG_FILES = readdirSync("supabase/migrations")
  .filter((f) => read(`supabase/migrations/${f}`).includes("create_canonical_pcart_production_draft"))
  .sort();
const MIG_NAME = P2_MIG_FILES.at(-1);
const MIG = MIG_NAME ? read(`supabase/migrations/${MIG_NAME}`) : "";
const CREATE = MIG.slice(MIG.indexOf("FUNCTION public.create_canonical_pcart_production_draft"));
const ABANDON_NAME = P2_MIG_FILES.findLast((f) => read(`supabase/migrations/${f}`).includes("FUNCTION public.abandon_canonical_pcart_production_draft"));
const ABANDON = ABANDON_NAME
  ? read(`supabase/migrations/${ABANDON_NAME}`).slice(read(`supabase/migrations/${ABANDON_NAME}`).indexOf("FUNCTION public.abandon_canonical_pcart_production_draft"))
  : "";
const INTENT = read("src/lib/pcart-production-intent.ts");
const REVIEW = read("src/lib/pcart-production-review.functions.ts");
const DRAFT = read("src/lib/pcart-production-draft.ts");
const PANEL = read("src/components/cartel/PcartProductionReviewPanel.tsx");
const SUMMARY = read("src/components/cartel/PcartReviewLaunchSummary.tsx");
const LC = read("src/routes/_authenticated/launch-control.tsx");
const CANARY = read("src/lib/chain-mainnet-canary.functions.ts");

const SAFE = PCART_PRODUCTION_TREASURY_SAFE;
const SIGNERS = [
  "0x1111111111111111111111111111111111111111",
  "0x2222222222222222222222222222222222222222",
  "0x3333333333333333333333333333333333333333",
];
const PINNED_HASH = "0x3482c250d8500b20f731938be3cf2eab39e59b9fa7aff21ffb5085e1ceddd818";

// 1. recipient derived from approval Safe, never freeform
check("1a", MIG_NAME !== undefined && CREATE.includes(`c_safe constant text := '${SAFE}'`) &&
  /lower\(a\.safe_address\) IS DISTINCT FROM c_safe/.test(CREATE) && /c_supply, c_safe,/.test(CREATE),
  "RPC pins recipient to the approval Safe; no recipient parameter");
check("1b", !/_token_recipient|_recipient/.test(CREATE.slice(0, CREATE.indexOf("RETURNS"))), "RPC signature has no recipient input");
check("1c", !/recipient/i.test(noComments(PANEL).match(/<input[\s\S]*?\/>/g)?.join("") ?? "") && !/<Input/.test(PANEL),
  "UI has no recipient text input");
check("1d", /safe !== PCART_PRODUCTION_TREASURY_SAFE/.test(REVIEW), "review requires approval Safe = pinned Safe");
check("1e", !/token_total_supply_text/.test(noComments(CREATE)) && /token_total_supply,/.test(CREATE) && /c_supply, c_safe,/.test(CREATE),
  "RPC inserts exact numeric supply and never writes the generated text column");
check("1f", /c_supply constant numeric := 1000000000000000000000000000/.test(CREATE) &&
  /token_total_supply, token_recipient,/.test(noComments(CREATE)),
  "INSERT column list keeps exact numeric supply and omits the generated column");

// 2. deployer one of 3 signers and never Safe
check("2a", isAllowedPcartDeployer(SIGNERS[1]!, SIGNERS, SAFE), "signer accepted");
check("2b", !isAllowedPcartDeployer("0x4444444444444444444444444444444444444444", SIGNERS, SAFE), "non-signer refused");
check("2c", !isAllowedPcartDeployer(SAFE, [SAFE, SIGNERS[1]!, SIGNERS[2]!], SAFE), "Safe refused as deployer even if listed");
check("2d", /v_deployer = c_safe/.test(CREATE) && /v_deployer NOT IN \(lower\(s\.signer_1\), lower\(s\.signer_2\), lower\(s\.signer_3\)\)/.test(CREATE),
  "RPC enforces signer membership and deployer != Safe");
check("2e", /type="radio"/.test(PANEL) && /signers\.map/.test(PANEL), "UI offers only the three signer choices");

// 3. frozen fields + chain
check("3", /4663, 'PRODUCTION'/.test(CREATE) && /'FIXED_SUPPLY_ERC20', 'pepecartel-token-v1', 'PEPECARTEL', 'PCART', 18/.test(CREATE) &&
  /c_supply constant numeric := 1000000000000000000000000000/.test(CREATE), "exact PCART frozen fields and chain 4663");

// 4. readiness approval + fresh fingerprint
check("4", /Production readiness approval is required/.test(CREATE) &&
  /pcart_production_readiness_evidence\(_launch_id, false\)/.test(CREATE) &&
  /a\.readiness_fingerprint IS DISTINCT FROM ev->>'fingerprint'/.test(CREATE) &&
  /is_platform_owner\(auth\.uid\(\)\)/.test(CREATE), "owner + approval + fresh evidence fingerprint required");

// 5. execution locked
check("5", /execution_enabled IS DISTINCT FROM false OR k\.emergency_stop_engaged IS DISTINCT FROM true/.test(CREATE) &&
  /EXECUTION_NOT_LOCKED/.test(REVIEW), "draft and review require locked execution");

// 6. only one production attempt
check("6", /\(x\.network_environment = 'PRODUCTION' OR x\.chain_id = 4663\)[\s\S]*status IN \('DRAFT','SUBMITTED','PENDING','CONFIRMED'\)/.test(CREATE),
  "only one active/confirmed PCART production row per launch");

// 7. read-only RPC methods only
const reviewCode = noComments(REVIEW);
check("7", /getChainId|getTransactionCount|getCode|estimateGas|\.call\(/.test(reviewCode) &&
  !/sendTransaction|sendRawTransaction|writeContract|signTransaction|signMessage|signTypedData|walletClient|createWalletClient|privateKey|\.insert\(|\.update\(|\.delete\(|\.upsert\(/.test(reviewCode),
  "review uses only read RPC methods and writes nothing");
check("7b", !/return[\s\S]{0,40}endpoint/.test(reviewCode), "managed RPC URL never returned");

// 8. nonce latest = pending
check("8", /blockTag: "latest"/.test(REVIEW) && /blockTag: "pending"/.test(REVIEW) && /latest !== pending\) return fail\("NONCE_PENDING_MISMATCH"\)/.test(REVIEW),
  "latest nonce must equal pending");

// 9/10. predicted address no code, Safe has code
check("9", /PREDICTED_ADDRESS_HAS_CODE/.test(REVIEW), "predicted address must be empty");
check("10", /SAFE_HAS_NO_CODE/.test(REVIEW), "Safe must have code");

// 11. init code / hash / fingerprint binding
const init = buildPcartProductionInitCode(SAFE);
check("11a", init.startsWith(PEPECARTEL_TOKEN_CREATION_BYTECODE) && init.endsWith(SAFE.slice(2)) &&
  init.length === PEPECARTEL_TOKEN_CREATION_BYTECODE.length + 64, "init code = frozen bytecode + abi(Safe)");
check("11b", pcartProductionInitCodeHash(SAFE) === PINNED_HASH && keccak256(init) === PINNED_HASH &&
  CREATE.includes(`c_init_hash constant text := '${PINNED_HASH}'`), "init-code hash pinned identically in code and DB");
const fpIn = { launchId: "00000000-0000-0000-0000-000000000001", safeAddress: SAFE, deployer: SIGNERS[0]!, nonce: 5n, initCodeHash: PINNED_HASH, readinessFingerprint: "ab".repeat(32) };
const fp = pcartProductionReviewFingerprint(fpIn);
check("11c", fp !== pcartProductionReviewFingerprint({ ...fpIn, deployer: SIGNERS[1]! }) &&
  fp !== pcartProductionReviewFingerprint({ ...fpIn, nonce: 6n }) &&
  fp !== pcartProductionReviewFingerprint({ ...fpIn, safeAddress: SIGNERS[2]! }), "fingerprint binds Safe + deployer + nonce");
check("11d", pcartProductionFingerprintPreimage(fpIn).startsWith("pcart-production-review-v1|") &&
  /'pcart-production-review-v1', lower\(_launch_id::text\), 'pepecartel-token-v1', '4663', 'PRODUCTION'/.test(CREATE) &&
  /Review fingerprint does not match the canonical review inputs/.test(CREATE), "DB recomputes the same fingerprint preimage");
check("11e", predictPcartProductionAddress(SIGNERS[0]!, 0n) !== predictPcartProductionAddress(SIGNERS[0]!, 1n), "CREATE prediction depends on nonce");
check("11f", !/cartel-fixed-erc20/.test(noComments(INTENT)) && !/eth_|\.request\(|createPublicClient|createWalletClient|http\(|fetch\(/.test(noComments(INTENT)),
  "intent helper is pure and does not use generic token identity");

// 12. 90s freshness
check("12", PCART_PRODUCTION_REVIEW_TTL_MS === 90_000 && isPcartReviewFresh(1000, 90_999) && !isPcartReviewFresh(1000, 91_000) &&
  /isPcartReviewFresh\(review\.reviewedAt, Date\.now\(\)\)/.test(PANEL), "review expires after 90 seconds, rechecked at save");

// 13. abandon only unsent draft
check("13a", /v_row\.status <> 'DRAFT' OR v_row\.tx_hash IS NOT NULL OR v_row\.submitted_at IS NOT NULL OR v_row\.contract_address IS NOT NULL/.test(ABANDON) &&
  /A reason is required/.test(ABANDON) && /is_platform_owner/.test(ABANDON), "abandon: owner, reason, unsent DRAFT only");
const base = { network_environment: "PRODUCTION", chain_id: 4663, artifact_id: "pepecartel-token-v1", tx_hash: null, submitted_at: null, contract_address: null } as never;
check("13b", isUnsentPcartDraft({ ...(base as object), status: "DRAFT" } as never) &&
  !isUnsentPcartDraft({ ...(base as object), status: "DRAFT", tx_hash: "0x" + "1".repeat(64) } as never) &&
  !isUnsentPcartDraft({ ...(base as object), status: "SUBMITTED" } as never), "client mirrors unsent-only rule");
check("13c", /AlertDialog/.test(PANEL) && /reason\.trim\(\)\.length < PCART_PRODUCTION_ABANDON_REASON_MIN/.test(PANEL), "abandon requires explicit dialog + reason");

// 14. generic canary unchanged
check("14", /return attemptFail\("CANONICAL_PCART_PROTECTED"\)/.test(CANARY), "generic canary still returns CANONICAL_PCART_PROTECTED");
check("14b", findPcartProductionAttempt([
  { ...(base as object), artifact_id: "cartel-fixed-erc20-v1", status: "CONFIRMED" } as never,
]) === null, "historical generic production rows never count as PCART evidence");

// 15. no send/sign/presign/window/arm APIs in P2 files
const P2 = [INTENT, REVIEW, DRAFT, PANEL].map(noComments).join("\n");
check("15", !/eth_sendTransaction|wallet_sendTransaction|sendTransaction|writeContract|signTransaction|signTypedData|personal_sign|presign|send_window|sendWindow|arm_launch|canary_permit|appkit|walletconnect|useAccount|connect\(/i.test(P2),
  "no send/sign/presign/send-window/arm/wallet APIs in P2 files");
check("15b", !/presign|send_window|arm_|execution_controls\s+SET|UPDATE public\.launch_chain_production_execution_controls|official_contract_address\s*=|UPDATE public\.launches/i.test(MIG),
  "migration touches no presign, send window, control, registration or lifecycle");

// 16. auction does not block deployment review
const r = derivePcartReadiness({ treasurySignersRecorded: true, treasurySafeVerified: true, deploymentRows: [{ artifact_id: "pepecartel-token-v1", status: "CONFIRMED", network_environment: "TESTNET" }] });
check("16", r.buildReady && r.next === null && r.steps[1]!.status === "Auction — after token deployment" && /Not required for deployment review/.test(r.steps[1]!.detail),
  "auction is post-deployment and never blocks");

// 17. mainnet summary authoritative
check("17a", pcartMainnetSummary({ approved: false, executionLocked: true, draftSaved: false }) === "Locked — not ready" &&
  pcartMainnetSummary({ approved: true, executionLocked: true, draftSaved: false }) === "Approved — deployment review next" &&
  pcartMainnetSummary({ approved: true, executionLocked: true, draftSaved: true }) === "Reviewed draft saved — wallet preparation next",
  "mainnet summary states");
check("17b", /\["Mainnet", mainnetSummary\]/.test(SUMMARY) && !/readiness\.mainnetLocked \?/.test(SUMMARY) &&
  /mainnetSummary=\{pcartMainnetText\}/.test(LC) && /execution_locked/.test(LC), "card reads authoritative state, not a hard-coded lock");
check("17c", /disabled>\s*<ShieldCheck[\s\S]*Launch unavailable until setup is complete/.test(SUMMARY), "final Launch button stays disabled");

// 18. stale window warning only
const now = Date.parse("2026-10-05T09:42:00Z");
check("18a", isPcartLaunchScheduleExpired(null, "2026-09-18T12:40:00Z", now) && !isPcartLaunchScheduleExpired(null, "2026-12-01T00:00:00Z", now) &&
  !isPcartLaunchScheduleExpired(null, null, now), "expired window detected");
check("18b", /scheduleExpired=\{pcartScheduleExpired\}/.test(LC) && !/launch_window_end\s*[:=][^=]/.test(PANEL + SUMMARY),
  "expired window is a warning only; never mutated");

console.log(`\n${pass} passed, ${fail} failed`);
if (fail) process.exit(1);
