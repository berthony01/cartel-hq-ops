/** PCART P9.3A — auction preparation regression (deterministic; no network, no DB writes, nothing prepared live). */
import { readFileSync, readdirSync } from "node:fs";
import { P8A_MANIFEST, P8A_MANIFEST_FINGERPRINT, P8A_MANIFEST_VERSION } from "../src/lib/pcart-auction-liquidity-plan";
import { buildPreAuctionSafeTx, P8B_CODE_HASH_ATTESTATIONS, P8B_DURATION_BLOCKS, P8B_MANIFEST, P8B_MANIFEST_FINGERPRINT, P8B_MANIFEST_VERSION, P8B_REAL_TREASURY_SAFE } from "../src/lib/pcart-auction-execution-p8b";
import {
  auctionModel, computeAuthoritativeBlocks, deriveAuctionSegment, effectiveActionStatus, preparePreAuction, staleReasons, sweepGate, callBatchFingerprint,
  P9_3_EXPECTED_TOKEN_RUNTIME_KECCAK, P9_3_MIN_SIGNING_LEAD_MS, P9_3_PINNED_DEPENDENCY_FINGERPRINT, P9_3_SWEEP_DISPOSITION, P9_3_CANONICAL_OWNERS_FINGERPRINT,
  type P93PrepareFacts, type P93StoredAction, type P93CurrentFacts, type P93SegmentInput,
} from "../src/lib/pcart-launch-coordinator-p9-3";

let pass = 0, fail = 0;
const check = (id: string, ok: boolean, l: string) => { ok ? pass++ : fail++; console.log(`${ok ? "PASS" : "FAIL"} ${id} ${l}`); };
const read = (p: string) => readFileSync(p, "utf8");
const MIGF = readdirSync("supabase/migrations").find((f) => read(`supabase/migrations/${f}`).includes("P9.3A: canonical prepared-action model"));
const MIG = MIGF ? read(`supabase/migrations/${MIGF}`) : "";
const PURE = read("src/lib/pcart-launch-coordinator-p9-3.ts");
const FNS = read("src/lib/pcart-launch-coordinator-p9-3.functions.ts");
const RD = read("src/lib/pcart-launch-coordinator-p9-readers.server.ts");
const UI = read("src/components/cartel/PcartAuctionSegmentPanel.tsx");
const P92BIND = read("src/lib/pcart-p9-2-permit-binding.ts");
const ATT = read("src/lib/pcart-p9-2-attestation.server.ts");

const DAY = 86_400_000;
const NOW = Date.UTC(2026, 10, 20, 12);
const TOKEN = "0x" + "1".repeat(40);
const obs = Object.fromEntries(P8B_CODE_HASH_ATTESTATIONS.map((a) => [a.key, a.codeHash])) as Record<string, string>;
const head = { chainId: 4663, block: 90_000_000n, timestampSec: Math.floor(NOW / 1000) - 1, capturedAtMs: NOW - 1000, msPerBlock: 100 };
const plan = { promotionStartAt: new Date(NOW - 20 * DAY).toISOString(), intendedAuctionStartAt: new Date(NOW + 1.5 * DAY).toISOString() };
const pref = (v: string, fp: string, id: string) => ({ status: "CURRENT", reviewId: id, manifestVersion: v, manifestFingerprint: fp });
const auth = computeAuthoritativeBlocks({ head, nowMs: NOW, ...plan });
const facts = (o: Partial<P93PrepareFacts> = {}): P93PrepareFacts => ({
  nowMs: NOW, launchId: "L", launchStatus: "OFFICIAL_CONTRACT_REGISTERED", officialTokenAddress: TOKEN, deploymentFinalized: true, tokenRuntimeKeccak: P9_3_EXPECTED_TOKEN_RUNTIME_KECCAK,
  plan, p8a: pref(P8A_MANIFEST_VERSION, P8A_MANIFEST_FINGERPRINT, "ra"), p8b: pref(P8B_MANIFEST_VERSION, P8B_MANIFEST_FINGERPRINT, "rb"), observedCodeHashes: obs,
  safe: { address: P8B_REAL_TREASURY_SAFE.address, version: "1.4.1", threshold: 2, owners: [...P8B_REAL_TREASURY_SAFE.owners], nonce: 3, codeHash: P8B_REAL_TREASURY_SAFE.proxyCodeHash },
  control: { executionEnabled: false, emergencyStopEngaged: true }, head, uncertainTransaction: false, existingOpenAction: false,
  ownerConfirmedStartBlock: auth.ok ? auth.startBlock.toString() : null, ...o,
});
const blocked = (f: P93PrepareFacts, b: string) => { const r = preparePreAuction(f); return !r.ok && (r.blocks as string[]).includes(b); };
const ok = preparePreAuction(facts());

// 1-3 passive / no auto
check("1", !/useEffect\([^)]*(prepare|preview)/.test(UI) && /refetchOnWindowFocus: false/.test(UI) && !/rpc\(|\.insert\(|\.update\(/.test(FNS.slice(FNS.indexOf("getPcartP9_3Segment"), FNS.indexOf("previewPcartPreAuction"))), "passive segment load is read-only");
check("2", !/pcart_launch_day_plans"?\)?\.(insert|upsert)/.test(FNS) && !/set_canonical_pcart_launch_day_plan/.test(FNS), "no plan auto-created");
check("3", !/new Date\(\)\.setDate|Date\.now\(\)\s*\+\s*21/.test(FNS + PURE) && /NO_PLAN/.test(PURE), "no dates auto-selected");
// 4-9 prerequisites / blocks
check("4", blocked(facts({ officialTokenAddress: null }), "OFFICIAL_TOKEN_MISSING"), "official token required");
check("5", blocked(facts({ plan: null }), "PLAN_INVALID"), "valid plan required");
check("6", blocked(facts({ plan: { promotionStartAt: new Date(NOW - 10 * DAY).toISOString(), intendedAuctionStartAt: plan.intendedAuctionStartAt } }), "RUNWAY_TOO_SHORT") && /interval '21 days'/.test(MIG), "≥21-day rule (TS + SQL)");
check("7", blocked(facts({ ownerConfirmedStartBlock: (BigInt(auth.ok ? auth.startBlock : 0n) + 5000n).toString() }), "CONFIRMED_BLOCK_DRIFTED"), "stale estimated block cannot become authoritative");
check("8", blocked(facts({ head: { ...head, capturedAtMs: NOW - 5 * 60_000 } }), "HEAD_NOT_FRESH") && blocked(facts({ head: null }), "HEAD_NOT_FRESH"), "authoritative blocks need fresh live read");
check("9", ok.ok && BigInt(ok.binding.endBlock) - BigInt(ok.binding.authoritativeStartBlock) === BigInt(P8B_DURATION_BLOCKS) && /authoritative_start_block \+ 5885000/.test(MIG), "end = start + P8B duration");
check("10", blocked(facts({ p8a: pref(P8A_MANIFEST_VERSION, "0x" + "0".repeat(64), "ra") }), "P8A_NOT_CURRENT"), "P8A mismatch blocks");
check("11", blocked(facts({ p8b: { ...pref(P8B_MANIFEST_VERSION, P8B_MANIFEST_FINGERPRINT, "rb"), status: "REVOKED" } }), "P8B_NOT_CURRENT"), "P8B mismatch blocks");
check("12", blocked(facts({ observedCodeHashes: { ...obs, PERMIT2: "0x" + "e".repeat(64) } }), "DEPENDENCY_MISMATCH"), "dependency mismatch blocks");
check("13", blocked(facts({ tokenRuntimeKeccak: "0x" + "d".repeat(64) }), "TOKEN_RUNTIME_MISMATCH"), "token runtime mismatch blocks");
check("14", blocked(facts({ safe: { ...facts().safe!, owners: [P8B_REAL_TREASURY_SAFE.owners[0], P8B_REAL_TREASURY_SAFE.owners[1], "0x" + "7".repeat(40)] } }), "SAFE_MISMATCH"), "Safe owner mismatch blocks");
check("15", blocked(facts({ safe: { ...facts().safe!, threshold: 1 } }), "SAFE_THRESHOLD_NOT_2") && /safe_threshold integer NOT NULL CHECK \(safe_threshold = 2\)/.test(MIG), "threshold ≠ 2 blocks");
check("16", blocked(facts({ safe: { ...facts().safe!, nonce: null } }), "SAFE_NONCE_UNAVAILABLE"), "unavailable/stale Safe nonce blocks");
// 17-19 binding
const viaBuilder = buildPreAuctionSafeTx({ mode: "LIVE", tokenAddress: TOKEN, safeAddress: P8B_REAL_TREASURY_SAFE.address, safeNonce: 3, startBlock: BigInt(ok.ok ? ok.binding.authoritativeStartBlock : "1"), permit2Expiration: BigInt(Math.floor(Date.parse(plan.intendedAuctionStartAt) / 1000)),
  live: { chainId: 4663, nowMs: NOW, launchStatus: "OFFICIAL_CONTRACT_REGISTERED", officialTokenAddress: TOKEN, officialRegistered: true, deploymentFinalized: true, p8aReview: { manifestVersion: P8A_MANIFEST_VERSION, manifestFingerprint: P8A_MANIFEST_FINGERPRINT, expiresAtMs: Infinity }, p8bReview: { manifestVersion: P8B_MANIFEST_VERSION, manifestFingerprint: P8B_MANIFEST_FINGERPRINT, expiresAtMs: Infinity }, observedCodeHashes: obs, safe: { ...facts().safe!, nonce: 3, version: "1.4.1", threshold: 2, codeHash: P8B_REAL_TREASURY_SAFE.proxyCodeHash } },
  schedule: { promotionStartMs: Date.parse(plan.promotionStartAt), intendedStartMs: Date.parse(plan.intendedAuctionStartAt), ownerConfirmed: true } });
check("17", ok.ok && ok.binding.safeNonce === 3 && /safe_nonce bigint NOT NULL/.test(MIG), "binds exact Safe nonce");
check("18", ok.ok && viaBuilder.ok && ok.binding.callBatchFingerprint === callBatchFingerprint(viaBuilder.prepared) && ok.binding.safeTxHash === viaBuilder.prepared.safeTxHash.toLowerCase() && /buildPreAuctionSafeTx\(/.test(PURE), "binds exact ordered P8B batch (byte parity with reused builder)");
check("19", ok.ok && ok.binding.authoritativeStartBlock === (auth.ok ? auth.startBlock.toString() : "") && /authoritative_start_block bigint/.test(MIG), "binds exact start/end blocks");
// 20-23 staleness
const stored: P93StoredAction = ok.ok ? { id: "A", actionKind: "PREAUCTION_SETUP", status: "PREPARED", statusReason: null, officialTokenAddress: TOKEN, officialTokenCodeHash: ok.binding.officialTokenCodeHash,
  p8aReviewId: "ra", p8aManifestFingerprint: P8A_MANIFEST_FINGERPRINT, p8bReviewId: "rb", p8bManifestFingerprint: P8B_MANIFEST_FINGERPRINT, dependencyAttestationFingerprint: P9_3_PINNED_DEPENDENCY_FINGERPRINT,
  safeOwnersFingerprint: P9_3_CANONICAL_OWNERS_FINGERPRINT, safeThreshold: 2, safeNonce: 3, promotionStartAt: plan.promotionStartAt, intendedAuctionStartAt: plan.intendedAuctionStartAt,
  authoritativeStartBlock: ok.binding.authoritativeStartBlock, endBlock: ok.binding.endBlock, safeTxHash: ok.binding.safeTxHash, preparedAt: "x" } as P93StoredAction : ({} as P93StoredAction);
const cur: P93CurrentFacts = { officialTokenAddress: TOKEN, tokenRuntimeKeccak: P9_3_EXPECTED_TOKEN_RUNTIME_KECCAK, p8a: pref(P8A_MANIFEST_VERSION, P8A_MANIFEST_FINGERPRINT, "ra"), p8b: pref(P8B_MANIFEST_VERSION, P8B_MANIFEST_FINGERPRINT, "rb"),
  dependencyFingerprint: P9_3_PINNED_DEPENDENCY_FINGERPRINT, safeOwnersFingerprint: P9_3_CANONICAL_OWNERS_FINGERPRINT, safeThreshold: 2, safeNonce: 3, plan };
check("20", staleReasons(stored, { ...cur, plan: { ...plan, intendedAuctionStartAt: new Date(NOW + 3 * DAY).toISOString() } }).includes("PLAN_CHANGED") && /pcart_p93_plan_change/.test(MIG) && effectiveActionStatus(stored, cur).status === "PREPARED", "plan change stales (TS + DB trigger)");
check("21", staleReasons(stored, { ...cur, p8b: pref(P8B_MANIFEST_VERSION, P8B_MANIFEST_FINGERPRINT, "rb2") }).includes("P8B_CHANGED") && /pcart_p93_revocation/.test(MIG), "policy change stales");
check("22", staleReasons(stored, { ...cur, dependencyFingerprint: "0x" + "c".repeat(64) }).includes("DEPENDENCY_CHANGED"), "dependency change stales");
check("23", staleReasons(stored, { ...cur, tokenRuntimeKeccak: "0x" + "c".repeat(64) }).includes("TOKEN_RUNTIME_CHANGED") && staleReasons(stored, { ...cur, officialTokenAddress: "0x" + "2".repeat(40) }).includes("TOKEN_CHANGED") && /pcart_p93_official_change/.test(MIG) && staleReasons(stored, { ...cur, safeNonce: 4 }).includes("SAFE_NONCE_CHANGED"), "token/runtime/nonce change stales");
// 24-27 no signing/sending
check("24", !/signature/i.test(MIG.replace(/--.*$/gm, "")) && /status <> 'PREPARED' THEN RAISE/.test(MIG) && /not allowed in P9.3A/.test(MIG), "no signature table; insert PREPARED-only; signing statuses blocked");
const PROD = PURE + FNS + RD + UI;
check("25", !/api\.safe\.global|safe-transaction|proposeTransaction/.test(PROD), "no Safe proposal");
check("26", !/execTransaction|sendTransaction|writeContract|eth_sendRawTransaction|signTypedData|signMessage|createWalletClient/.test(PROD), "no Safe execution / signing / wallet client");
check("27", !/useAccount|useWalletClient|connect\(|ethereum\.request|DeploymentWalletConnect/.test(UI), "no wallet prompt in auction segment UI");
// 28-30 auction reader
check("28", auctionModel({ auctionAddress: null, boundStartBlock: null, boundEndBlock: null, currentBlock: "1", obs: null }).status === "NOT_CREATED", "NOT_CREATED normal");
check("29", auctionModel({ auctionAddress: TOKEN, boundStartBlock: "10", boundEndBlock: String(10 + P8B_DURATION_BLOCKS), currentBlock: "20", obs: { ok: false, capturedAt: "t" } }).status === "UNAVAILABLE"
  && auctionModel({ auctionAddress: TOKEN, boundStartBlock: "10", boundEndBlock: String(10 + P8B_DURATION_BLOCKS), currentBlock: "20", obs: { ok: true, endBlock: 999n, currencyRaisedWei: 0n, isGraduated: false, totalClearedWei: 0n, clearingPriceQ96: 0n, tokensRecipient: P8B_REAL_TREASURY_SAFE.address, fundsRecipient: "0x1", capturedAt: "t" } }).status === "UNAVAILABLE", "fail-closed on unavailable/mismatched");
const endB = 10 + P8B_DURATION_BLOCKS;
const o = (g: boolean, raised: bigint) => ({ ok: true as const, endBlock: BigInt(endB), currencyRaisedWei: raised, isGraduated: g, totalClearedWei: g ? P8A_MANIFEST.auctionAllocation - 1155n : 0n, clearingPriceQ96: 1n, tokensRecipient: P8B_REAL_TREASURY_SAFE.address, fundsRecipient: "0x1", capturedAt: "t" });
const openM = auctionModel({ auctionAddress: TOKEN, boundStartBlock: "10", boundEndBlock: String(endB), currentBlock: "100", obs: o(true, 40n * 10n ** 18n) });
const refundM = auctionModel({ auctionAddress: TOKEN, boundStartBlock: "10", boundEndBlock: String(endB), currentBlock: String(endB + 5), obs: o(false, 4n * 10n ** 18n) });
check("30", openM.status === "OPEN" && (openM as any).outcome === "UNDETERMINED" && refundM.status === "ENDED" && (refundM as any).outcome === "REFUND" && (refundM as any).refundEligible === true, "no fake success/refund; outcome only after end from isGraduated");
// 31-33 sweep / completion
const succM = auctionModel({ auctionAddress: TOKEN, boundStartBlock: "10", boundEndBlock: String(endB), currentBlock: String(endB + 5), obs: o(true, 30n * 10n ** 18n) });
const sg = sweepGate({ auction: succM, migrationConfirmed: true, totalClearedWei: P8A_MANIFEST.auctionAllocation - 1155n, uncertainTransaction: false });
check("31", P9_3_SWEEP_DISPOSITION === "SAFE_SWEEP_REQUIRED" && sg.ok && sg.unsoldAmount === 1155n && !sweepGate({ auction: succM, migrationConfirmed: false, totalClearedWei: 0n, uncertainTransaction: false }).ok && !sweepGate({ auction: openM, migrationConfirmed: true, totalClearedWei: 0n, uncertainTransaction: false }).ok && !sweepGate({ auction: succM, migrationConfirmed: true, totalClearedWei: null, uncertainTransaction: false }).ok, "sweep amount from chain only, gated");
check("32", P8B_MANIFEST.modes.unsold === "SAFE_SWEEP_UNSOLD_TOKENS" && sweepGate({ disposition: "NO_MANUAL_SWEEP_REQUIRED", auction: succM, migrationConfirmed: true, totalClearedWei: 0n, uncertainTransaction: false }).ok === false, "no sweep action when disposition automatic");
const seg = (o2: Partial<P93SegmentInput>) => deriveAuctionSegment({ nowMs: NOW, officialRegistered: true, plan, p8aCurrent: true, p8bCurrent: true, dependenciesVerified: true, safeReady: true, uncertainTransaction: false, preAuction: null, preAuctionConfirmed: false, auction: { status: "NOT_CREATED" }, migrationConfirmed: null, sweepAction: null, sweepConfirmed: false, ...o2 });
check("33", seg({ preAuctionConfirmed: true, auction: succM, nowMs: NOW + 30 * DAY }).state !== "LAUNCH_COMPLETE" && seg({ preAuctionConfirmed: true, auction: succM, migrationConfirmed: true, sweepConfirmed: true }).state === "LAUNCH_COMPLETE", "launch complete from evidence, not elapsed time");
// 34-40 protected invariants
check("34", blocked(facts({ control: { executionEnabled: true, emergencyStopEngaged: true } }), "CONTROLS_NOT_PROTECTED") && /execution_enabled IS DISTINCT FROM false/.test(MIG), "execution must stay OFF");
check("35", blocked(facts({ control: { executionEnabled: false, emergencyStopEngaged: false } }), "CONTROLS_NOT_PROTECTED") && /emergency_stop_engaged IS DISTINCT FROM true/.test(MIG), "emergency stop must stay ON");
check("36", !/UPDATE public\.launch_chain_production_execution_controls|INSERT INTO public\.launch_chain_production_execution_control/.test(MIG) && !/execution_controls"?\)?\.(update|insert|upsert)/.test(FNS), "no control mutation");
check("37", !/UPDATE public\.launches/.test(MIG) && !/launches"\)\.(update|insert)/.test(FNS), "no official-contract/lifecycle mutation");
check("38", !/pcart-auction-liquidity-plan\.ts|pcart-auction-execution-p8b\.ts/.test(MIG) && P8B_MANIFEST.durationBlocks === 5_885_000 && P8A_MANIFEST.floorWei === 5n * 10n ** 18n, "no P8 economics mutation");
check("39", !/launch_events|launch_notification|telegram/i.test(MIG + FNS), "no notifications");
check("40", /issuanceBlockers|permitBindingFailures/.test(P92BIND) && /attestP9_2Live/.test(ATT), "P9.2 permit binding intact");
check("41", /record_canonical_pcart_preauction_prepared\(uuid, jsonb\) FROM PUBLIC, anon, authenticated/.test(MIG) && /TO service_role/.test(MIG) && /requireSupabaseAuth/.test(FNS) && /isOwner/.test(FNS), "prepare RPC service-role only after owner-verified server re-attestation");
check("42", /CANONICAL_PCART_PROTECTED/.test(MIG), "canary remains CANONICAL_PCART_PROTECTED");
// extras
check("43", blocked(facts({ plan: { ...plan, intendedAuctionStartAt: new Date(NOW + P9_3_MIN_SIGNING_LEAD_MS - 60_000).toISOString() } }), "START_TOO_SOON_FOR_SIGNING"), "too-near start fails closed (24h signing lead)");
check("44", seg({ officialRegistered: false, plan: null }).state === "OFFICIAL_CONTRACT_REQUIRED" && seg({ plan: null }).state === "PROMOTION_PLAN_REQUIRED", "today's state → official contract required");
check("45", blocked(facts({ existingOpenAction: true }), "ACTION_ALREADY_OPEN") && /pcart_p93_one_prepared_per_kind/.test(MIG), "no duplicate / no automatic re-preparation");

console.log(`\nP9.3A auction preparation regression: ${pass}/${pass + fail} passed`);
if (fail) process.exit(1);
