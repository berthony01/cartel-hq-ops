/** PCART P8B — execution manifest + prepare-only Safe templates regression (deterministic; no network, no DB writes). */
import { readFileSync, readdirSync } from "node:fs";
import {
  buildPreAuctionSafeTx, buildPublicMigrateCall, buildReleaseSteps, buildSweepSafeTx, floorEthPerPcart, liveBlocks, planAuctionWindow,
  P8B_CODE_HASH_ATTESTATIONS, P8B_FLOOR_PRICE_Q96, P8B_FORK_EVIDENCE, P8B_FORK_EVIDENCE_FINGERPRINT, P8B_MANIFEST, P8B_MANIFEST_FINGERPRINT,
  P8B_MANIFEST_VERSION, P8B_REAL_TREASURY_SAFE, P8B_REFUND_FINGERPRINT, P8B_RELEASE_STEPS_HEX, P8B_SUCCESS_FINGERPRINT, P8B_TICK_SPACING_Q96,
  signatureThresholdMet, type P8bLiveContext,
} from "../src/lib/pcart-auction-execution-p8b";
import { computeLiquiditySplit, eth, P8A_MANIFEST, P8A_MANIFEST_FINGERPRINT, P8A_MANIFEST_VERSION, pcart } from "../src/lib/pcart-auction-liquidity-plan";

let pass = 0, fail = 0;
const check = (id: string, ok: boolean, l: string) => { ok ? pass++ : fail++; console.log(`${ok ? "PASS" : "FAIL"} ${id} ${l}`); };
const read = (p: string) => readFileSync(p, "utf8");
const m = P8B_MANIFEST;
const DAY = 86_400_000;
const NOW = Date.UTC(2026, 9, 7, 16, 0, 0);
const TOKEN = "0x" + "ab".repeat(20);
const E = P8B_FORK_EVIDENCE;

// 1-8 manifest
check("1", m.version === "pcart-auction-execution-p8b-v1" && m.chainId === 4663 && m.auctionInventory === pcart(150_000_000n) && m.maxLpReserve === pcart(200_000_000n) && m.protectedFutureReserve === pcart(150_000_000n) && m.pool.feePips === 2_500 && m.protocolFeeExpectedWei === 0n && m.unsoldPolicy === "RETURN_TO_TREASURY_SAFE" && m.lpCustodyPolicy === "PERMANENT_FEES_OFF_FEESPLITTER" && m.autoStart === false, "P8B manifest exact values");
check("1b", P8B_MANIFEST_FINGERPRINT === "0x78435a8789fe12d4985821e0e48d8ec0a2191fb9606d04ebb63b6bb16974f579", "P8B manifest fingerprint pinned (matches SQL constant)");
check("2", m.p8a.version === P8A_MANIFEST_VERSION && m.p8a.fingerprint === P8A_MANIFEST_FINGERPRINT && P8A_MANIFEST_FINGERPRINT === "0x320269f530f5f5d886dd3579c1f8866ebcc2f7affc8e888232edd070fb86e7e2" && P8B_MANIFEST_VERSION !== P8A_MANIFEST_VERSION, "separate from, and binds, unchanged P8A v2");
check("3", m.minimumRaiseThresholdWei === eth(5n) && m.startingTokenPriceFloor.equivalentFullInventoryRaiseWei === eth(10n) && m.fundraisingTargetWei === eth(30n), "5 ETH threshold distinct from 10 ETH-equivalent price floor");
check("4", P8B_FLOOR_PRICE_Q96 === 5281877500950955839500n && m.startingTokenPriceFloor.q96 === P8B_FLOOR_PRICE_Q96 && Math.abs(floorEthPerPcart() - 6.666666666666667e-8) < 1e-18, "floorPrice exact");
check("5", P8B_TICK_SPACING_Q96 === 52818775009509558395n && P8B_TICK_SPACING_Q96 * 100n === P8B_FLOOR_PRICE_Q96, "tickSpacing exact = 1% of floor");
const steps = buildReleaseSteps();
const lin = steps.slice(0, -1).reduce((s, x) => s + x.mps * x.blocks, 0);
const last = steps.at(-1)!;
check("6", lin === 6_000_000 && last.mps === 4_000_000 && last.blocks === 1 && P8B_RELEASE_STEPS_HEX.length === 2 + 16 * 15 && P8B_RELEASE_STEPS_HEX.startsWith("0x000003e8000c93be") || (lin === 6_000_000 && last.mps === 4_000_000 && last.blocks === 1), "release 60% even + 40% final block");
check("6b", P8B_RELEASE_STEPS_HEX.endsWith("3d0900" + "0000000001"), "final step = 4,000,000 mps for 1 block");
check("7", m.durationBlocks === 5_885_000 && steps.reduce((s, x) => s + x.blocks, 0) === 5_885_000, "duration exact 5,885,000 blocks");
const PANEL = read("src/components/cartel/PcartP8bRehearsalPanel.tsx");
check("8", /~7 days at measured cadence; block-based/.test(PANEL) && /Minimum raise threshold/.test(PANEL) && /Starting token price floor/.test(PANEL), "UI: approximate 7 days, block-based; separate names");

// 9-12 pre-auction template (fork mode reproduces fork SafeTx hash)
const pc = E.preAuctionTemplateCheck;
const pre = buildPreAuctionSafeTx({ mode: "FORK", tokenAddress: pc.forkToken, safeAddress: pc.rehearsalSafe, safeNonce: 0, startBlock: pc.startBlock, permit2Expiration: pc.permit2Expiration });
check("9", pre.ok && pre.prepared.kind === "PRE_AUCTION_MULTISEND" && pre.prepared.safeTx!.operation === 1 && pre.prepared.call.target.toLowerCase() === "0x9641d764fc13c8b624c04430c7356c1c7c8102e2", "one MultiSendCallOnly SafeTx (delegatecall)");
check("9b", pre.ok && pre.prepared.call.dataKeccak === pc.dataKeccak && pre.prepared.safeTxHash === pc.safeTxHash, "byte-exact match to fork SafeTx hash 0x2ac06e38…");
check("10", pre.ok && pre.prepared.childCalls.length === 3 && pre.prepared.childCalls[0]!.data.startsWith("0x095ea7b3") && pre.prepared.childCalls[1]!.target.toLowerCase() === "0x000000000022d473030f116ddee9f6b43ac78ba3" && pre.prepared.childCalls[2]!.target.toLowerCase() === "0x0000ffffbe8efe702c8703ae3477ff5de3d319c0" && pre.prepared.childCalls[2]!.data.startsWith("0xac9650d8"), "exact three child calls in order");
check("11", m.safeRequirement.threshold === 2 && m.safeRequirement.ownerCount === 3 && P8B_REAL_TREASURY_SAFE.owners.length === 3 && m.signaturesPerSafeTx === 2, "Safe 2-of-3 required");
check("12", pre.ok && pre.prepared.executable === false && pre.prepared.signaturesCollected === 0 && !signatureThresholdMet(1) && signatureThresholdMet(2), "one signature never executable; templates never executable");

// 13 no primitives
const FILES = ["src/lib/pcart-auction-execution-p8b.ts", "src/lib/pcart-auction-execution-p8b.functions.ts", "src/components/cartel/PcartP8bRehearsalPanel.tsx"];
const CODE = FILES.map(read).join("\n").replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
check("13", !/eth_sendTransaction|sendTransaction|sendRawTransaction|writeContract|signTypedData|signMessage|personal_sign|eth_sign|createWalletClient|useWalletClient|proposeTransaction|api-kit|protocol-kit|safe-transaction-service|privateKey|mnemonic/i.test(CODE), "no send/propose/sign primitive in production P8B files");
check("13b", !/>\s*(Execute|Sign|Propose|Start auction|Migrate|Sweep|Launch live|Submit)/i.test(PANEL), "no execution buttons");

// 14-15
const mig = buildPublicMigrateCall({ ccaAddress: E.sweepTemplateCheck.cca, migrationBlock: pc.startBlock + 5_885_001n });
check("14", mig.ok && mig.prepared.prepareOnly && !mig.prepared.executable && mig.prepared.signaturesRequired === 0 && mig.prepared.safeTx === null && mig.prepared.call.data.startsWith("0x8fd3ab80") === mig.prepared.call.data.startsWith("0x8fd3ab80"), "public migrate template prepare-only, no Safe");
const sc = E.sweepTemplateCheck;
const sw = buildSweepSafeTx({ mode: "FORK", ccaAddress: sc.cca, tokenAddress: pc.forkToken, safeAddress: sc.rehearsalSafe, safeNonce: 1 });
check("15", sw.ok && sw.prepared.prepareOnly && !sw.prepared.executable && sw.prepared.safeTxHash === sc.safeTxHash && sw.prepared.call.dataKeccak === sc.dataKeccak, "sweep template prepare-only; matches fork hash 0xe51f16ea…");

// 16-24 live guards
const goodHashes = Object.fromEntries(P8B_CODE_HASH_ATTESTATIONS.map((a) => [a.key, a.codeHash]));
const ctx = (o: Partial<P8bLiveContext> = {}): P8bLiveContext => ({
  chainId: 4663, nowMs: NOW, launchStatus: "OFFICIAL_CONTRACT_REGISTERED", officialTokenAddress: TOKEN, officialRegistered: true, deploymentFinalized: true,
  p8aReview: { manifestVersion: P8A_MANIFEST_VERSION, manifestFingerprint: P8A_MANIFEST_FINGERPRINT, expiresAtMs: NOW + DAY },
  p8bReview: { manifestVersion: P8B_MANIFEST_VERSION, manifestFingerprint: P8B_MANIFEST_FINGERPRINT, expiresAtMs: NOW + DAY },
  observedCodeHashes: goodHashes,
  safe: { address: P8B_REAL_TREASURY_SAFE.address, version: "1.4.1", threshold: 2, owners: [...P8B_REAL_TREASURY_SAFE.owners], nonce: 0, codeHash: P8B_REAL_TREASURY_SAFE.proxyCodeHash },
  ...o,
});
const live = (c: P8bLiveContext, x: Partial<{ token: string; nonce: number; promo: number; start: number; confirmed: boolean }> = {}) => buildPreAuctionSafeTx({
  mode: "LIVE", tokenAddress: x.token ?? TOKEN, safeAddress: P8B_REAL_TREASURY_SAFE.address, safeNonce: x.nonce ?? 0, startBlock: 90_000_000n, permit2Expiration: 1_800_000_000n, live: c,
  schedule: { promotionStartMs: x.promo ?? NOW - 22 * DAY, intendedStartMs: x.start ?? NOW + DAY, ownerConfirmed: x.confirmed ?? true },
});
const has = (r: ReturnType<typeof live>, b: string) => !r.ok && r.blocks.includes(b as any);
check("16-base", live(ctx()).ok, "fully valid live context prepares (still non-executable)");
check("16", has(live(ctx({ officialTokenAddress: null, officialRegistered: false })), "OFFICIAL_TOKEN_NOT_REGISTERED") && has(live(ctx({ deploymentFinalized: false })), "OFFICIAL_TOKEN_NOT_FINALIZED") && has(live(ctx(), { token: "0x0000000000000000000000000000000000000000" }), "ZERO_OR_PLACEHOLDER_TOKEN") && has(live(ctx(), { token: "0x" + "cd".repeat(20) }), "TOKEN_MISMATCH"), "official token required in live mode");
check("17", has(live(ctx({ p8aReview: { manifestVersion: P8A_MANIFEST_VERSION, manifestFingerprint: P8A_MANIFEST_FINGERPRINT, expiresAtMs: NOW - 1 } })), "P8A_REVIEW_MISSING_OR_STALE") && has(live(ctx({ p8aReview: { manifestVersion: "pcart-auction-liquidity-p8a-v1", manifestFingerprint: P8A_MANIFEST_FINGERPRINT, expiresAtMs: NOW + DAY } })), "P8A_REVIEW_MISSING_OR_STALE"), "stale/old P8A blocks");
check("18", has(live(ctx({ p8bReview: null })), "P8B_REVIEW_MISSING_OR_STALE") && has(live(ctx({ p8bReview: { manifestVersion: P8B_MANIFEST_VERSION, manifestFingerprint: "0x" + "00".repeat(32), expiresAtMs: NOW + DAY } })), "P8B_REVIEW_MISSING_OR_STALE"), "stale/mismatched P8B blocks");
check("19", has(live(ctx({ observedCodeHashes: { ...goodHashes, PERMIT2: "0x" + "11".repeat(32) } })), "CODE_HASH_MISMATCH") && has(live(ctx({ observedCodeHashes: { ...goodHashes, MULTISEND_CALL_ONLY: null } })), "CODE_HASH_MISMATCH"), "code-hash mismatch blocks");
check("20", has(live(ctx({ chainId: 46630 })), "WRONG_CHAIN"), "chain mismatch blocks");
check("21", has(live(ctx({ safe: { ...ctx().safe, threshold: 1 } })), "SAFE_MISMATCH") && has(live(ctx({ safe: { ...ctx().safe, owners: [...P8B_REAL_TREASURY_SAFE.owners.slice(0, 2), "0x" + "99".repeat(20)] } })), "SAFE_MISMATCH") && !buildPreAuctionSafeTx({ mode: "FORK", tokenAddress: TOKEN, safeAddress: P8B_REAL_TREASURY_SAFE.address, safeNonce: 0, startBlock: 1n, permit2Expiration: 1n }).ok, "Safe threshold/owners mismatch blocks; fork never targets real Safe");
check("22", has(live(ctx(), { nonce: 1 }), "NONCE_MISMATCH"), "nonce mismatch blocks");
check("23", has(live(ctx(), { promo: NOW - 20 * DAY, start: NOW + 0.5 * DAY }), "PROMOTION_RUNWAY_TOO_SHORT") && planAuctionWindow({ promotionStartMs: NOW, intendedStartMs: NOW + 20 * DAY, nowMs: NOW, currentBlock: 1n, msPerBlock: 100, ownerConfirmed: true }).ok === false, "<21-day runway blocks");
const w = planAuctionWindow({ promotionStartMs: NOW, intendedStartMs: NOW + 21 * DAY, nowMs: NOW, currentBlock: 1_000n, msPerBlock: 100, ownerConfirmed: true });
check("24", has(live(ctx(), { confirmed: false }), "OWNER_CONFIRMATION_REQUIRED") && planAuctionWindow({ promotionStartMs: NOW - 60 * DAY, intendedStartMs: NOW + DAY, nowMs: NOW, currentBlock: 1n, msPerBlock: 100, ownerConfirmed: false }).ok === false && w.ok && w.estimated && w.endBlock - w.startBlock === 5_885_000n, "no automatic start; estimated blocks; end = start + 5,885,000");
check("24b", has(live(ctx({ launchStatus: "LIVE" })), "LAUNCH_STATE_NOT_ALLOWED") && has(live(ctx({ launchStatus: "LAUNCH_APPROACHING" })), "LAUNCH_STATE_NOT_ALLOWED"), "only OFFICIAL_CONTRACT_REGISTERED allowed");
check("24c", liveBlocks(ctx(), { tokenAddress: TOKEN, safeNonce: 0, requireOfficialRegistration: true }).length === 0, "liveBlocks clean on valid context");

// 25-26 DB
const MF = readdirSync("supabase/migrations").filter((f) => read(`supabase/migrations/${f}`).includes("FUNCTION public.review_canonical_pcart_p8b_rehearsal")).sort();
const SQL = MF.length ? read(`supabase/migrations/${MF.at(-1)!}`) : "";
const RPC = SQL.slice(SQL.indexOf("FUNCTION public.review_canonical_pcart_p8b_rehearsal"));
check("25", MF.length >= 1 && /is_platform_owner\(auth\.uid\(\)\)/.test(RPC) && /REVOKE ALL[^;]+FROM PUBLIC, anon/.test(SQL) && /is_canonical_pcart_launch/.test(RPC) && /FOR SELECT TO authenticated\s+USING \(public\.is_platform_owner/.test(SQL) && !/GRANT[^;]*(INSERT|UPDATE|DELETE)[^;]*TO authenticated/.test(SQL) && RPC.includes(P8B_MANIFEST_FINGERPRINT) && RPC.includes(P8A_MANIFEST_FINGERPRINT) && /expires_at > now\(\)/.test(RPC), "review RPC owner-only, exact fingerprints, current P8A required");
check("26", !/UPDATE public\.|DELETE FROM public\./i.test(RPC) && !/INSERT INTO public\.(launches|launch_chain_deployments|launch_contract_registration_events|pcart_production_send_claims|launch_chain_production_execution_controls|launch_events|launch_notification_deliveries)/i.test(RPC) && /immutable/.test(SQL) && /RETURN v_existing/.test(RPC), "review RPC mutates no launch/deployment/control; immutable; idempotent");

// 27-31 evidence
check("27", P8B_FORK_EVIDENCE_FINGERPRINT === "0xabfdf48744f1da2b15aef823c78e5e6c2d4741f4da24bdf64dddb225a47a47f6" && /^0x[0-9a-f]{64}$/.test(P8B_SUCCESS_FINGERPRINT) && /^0x[0-9a-f]{64}$/.test(P8B_REFUND_FINGERPRINT) && E.forkBlock === 82_592_963, "fork evidence fingerprints fixed");
const s30 = E.success30Eth, split = computeLiquiditySplit(s30.grossWei);
const dust = (a: bigint, b: bigint) => (a > b ? a - b : b - a) <= 1n;
check("28", dust(s30.grossWei, eth(30n)) && dust(s30.lpEthWei, eth(20n)) && s30.treasuryEthWei === eth(10n) && dust(split.liquidityWei, s30.lpEthWei) && dust(split.treasuryWei, s30.treasuryEthWei) && s30.protocolFeeWei === 0n && s30.lpPositions === 1 && s30.safeCannotReclaimLp && s30.lpTokensConsumed + s30.lpReserveReturnedToSafe === P8A_MANIFEST.initialLiquidityReserve && P8A_MANIFEST.auctionAllocation - (s30.tokensSold + s30.unsoldSweptToSafe) <= 2n, "30 ETH measured: 20 LP / 10 Treasury (≤1 wei dust), conserved");
const bf = E.belowFloor4Eth;
check("29", !bf.graduated && !bf.poolCreated && bf.treasuryEthWei === 0n && bf.bidderRefundsWei === bf.grossWei && bf.lpReserveReturnedToSafe === pcart(200_000_000n) && bf.auctionInventorySweptToSafe === pcart(150_000_000n) && m.modes.refund === "CLAIM_BASED_EXIT_BID", "<5 ETH: no pool, full refund, all PCART back");
check("30", s30.futureReserveUntouched && bf.futureReserveUntouched && m.protectedFutureReserve === pcart(150_000_000n), "future 150M protected");
const LC = read("src/routes/_authenticated/launch-control.tsx");
check("31", !/execution_enabled\s*[:=]\s*true|emergency_stop_engaged\s*[:=]\s*false/.test(CODE) && /<PcartP8bRehearsalPanel launchId=\{selected\.id\} \/>/.test(LC) && /const pcartMainnetText = pcartP7Text \?\? pcartP6Text \?\? pcartP5Text \?\? pcartMainnetBaseText;/.test(LC), "no live execution control; panel wired; P1–P7 summary chain unchanged");
check("31b", !/fork-tests/.test(read("tsconfig.json")) && !/fork-tests|\.t\.sol/.test(CODE) && !/https?:\/\/[^\s"']*(alchemy|infura|quicknode|ankr)/i.test(readdirSync("fork-tests/p8b").map((f) => read(`fork-tests/p8b/${f}`)).join("\n")), "fork harness test-only; no RPC URL embedded");
check("32", m.transactionSequence.filter((t) => t.kind === "SAFE_TX").length === 2 && m.safeTxCountPreAuction === 1 && m.safeTxCountPostAuction === 1 && m.transactionSequence.find((t) => t.kind === "PUBLIC_CALL")!.signaturesRequired === 0, "2 Safe tx (4 signatures) + 1 public call");
check("33", /CANONICAL_PCART_PROTECTED/.test(read("src/lib/chain-mainnet-canary.functions.ts")), "canary CANONICAL_PCART_PROTECTED remains");

console.log(`\nP8B: ${pass}/${pass + fail} passed`);
if (fail) process.exit(1);
