/**
 * PCART P8B v1 — auction execution-parameter manifest, fork evidence and
 * PREPARE-ONLY Safe transaction templates.
 *
 * NO EXECUTION CAPABILITY. This module is pure: no wallet, provider, signer,
 * Safe Transaction Service, or network access. Every template it returns has
 * `executable: false` and zero collected signatures. Nothing here can propose,
 * sign or submit a transaction.
 *
 * P8A v2 (economics/timeline) is bound by version + fingerprint and is NOT mutated.
 * Fork evidence: fork-tests/p8b (local in-memory Robinhood Chain fork, block 82,592,963).
 */
import { encodeAbiParameters, encodeFunctionData, encodePacked, hashTypedData, keccak256, parseAbi, stringToHex } from "viem";

import {
  canonicalJson,
  dep,
  encodeLpAllocationSchedule,
  P8A_MAINNET_DEPENDENCIES,
  P8A_MANIFEST,
  P8A_MANIFEST_FINGERPRINT,
  P8A_MANIFEST_VERSION,
  p8aFingerprint,
  type P8aDependencyKey,
} from "@/lib/pcart-auction-liquidity-plan";

export const P8B_MANIFEST_VERSION = "pcart-auction-execution-p8b-v1" as const;
export const P8B_STOP_COPY = "P8B REHEARSAL REVIEWED — LIVE EXECUTION STILL DISABLED" as const;
export const P8B_SUMMARY_REVIEWED = "Auction execution path rehearsed and reviewed — live execution still disabled" as const;
export const P8B_FORK_BANNER = "FORK REHEARSAL ONLY — NO REAL PCART OR ETH" as const;

const UNIT = 10n ** 18n;
const Q96 = 1n << 96n;
const ZERO = "0x0000000000000000000000000000000000000000" as const;
const ADDR = /^0x[0-9a-fA-F]{40}$/;
const DAY_MS = 86_400_000;

// ------------------------------------------------------------ Safe + helper contracts (chain 4663)
export const P8B_REAL_TREASURY_SAFE = {
  address: "0xE0d055B3E07c2D1d9C1762Ca9e19b3062207ad03",
  version: "1.4.1",
  threshold: 2,
  owners: [
    "0xC23BD6148A29318cC19264E096623fFCdAc19245",
    "0xA068B94e6F11a7E2daEf086C5190Dc265A523F67",
    "0xe5B2F446317D03de6E69fA697AB25D635F6dD617",
  ],
  proxyCodeHash: "0xd7d408ebcd99b2b70be43e20253d6d92a8ea8fab29bd3be7f55b10032331fb4c",
  singleton: "0x29fcB43b46531BcA003ddC8FCB67FFE91900C762",
  singletonCodeHash: "0xb1f926978a0f44a2c0ec8fe822418ae969bd8c3f18d61e5103100339894f81ff",
} as const;

export const P8B_MULTISEND_CALL_ONLY = {
  address: "0x9641d764fc13c8B624c04430C7356C1C7C8102e2",
  codeHash: "0xecd5bd14a08c5d2122379900b2f272bdf107a7e92423c10dd5fe3254386c9939",
  version: "1.4.1",
} as const;

/** All runtime code hashes a live preparation must re-observe and match exactly. */
export const P8B_CODE_HASH_ATTESTATIONS: readonly { key: string; address: string; codeHash: string }[] = [
  ...P8A_MAINNET_DEPENDENCIES.map((d) => ({ key: d.key, address: d.address, codeHash: d.codeHash })),
  { key: "MULTISEND_CALL_ONLY", address: P8B_MULTISEND_CALL_ONLY.address, codeHash: P8B_MULTISEND_CALL_ONLY.codeHash },
  { key: "SAFE_SINGLETON_L2_1_4_1", address: P8B_REAL_TREASURY_SAFE.singleton, codeHash: P8B_REAL_TREASURY_SAFE.singletonCodeHash },
  { key: "TREASURY_SAFE_PROXY", address: P8B_REAL_TREASURY_SAFE.address, codeHash: P8B_REAL_TREASURY_SAFE.proxyCodeHash },
];

// ------------------------------------------------------------ release schedule (CCA auctionStepsData)
export const P8B_DURATION_BLOCKS = 5_885_000;
export const P8B_MEASURED_MS_PER_BLOCK = 102.77; // measured cadence; block-based duration is authoritative
const MPS_TOTAL = 10_000_000;

export type P8bStep = { mps: number; blocks: number };

function mixSteps(blocks: number, mps: number): P8bStep[] {
  const a = Math.floor(mps / blocks);
  const y = mps - a * blocks;
  const x = blocks - y;
  return [{ mps: a, blocks: x }, { mps: a + 1, blocks: y }].filter((s) => s.blocks > 0);
}

/** 60% evenly over the first DURATION-1 blocks (balanced per ~day), then 40% in the final block. */
export function buildReleaseSteps(): P8bStep[] {
  const linearBlocks = P8B_DURATION_BLOCKS - 1;
  const day = Math.floor(P8B_DURATION_BLOCKS / 7);
  const dayBlocks = [day, day, day, day, day, day, day];
  dayBlocks[6] = P8B_DURATION_BLOCKS - day * 6 - 1;
  const linearMps = 6_000_000;
  const perDay = Math.floor(linearMps / 7);
  const dayMps = [perDay, perDay, perDay, perDay, perDay, perDay, linearMps - perDay * 6];
  const out: P8bStep[] = [];
  for (let i = 0; i < 7; i++) out.push(...mixSteps(dayBlocks[i]!, dayMps[i]!));
  out.push({ mps: 4_000_000, blocks: 1 });
  if (out.reduce((s, x) => s + x.blocks, 0) !== P8B_DURATION_BLOCKS || linearBlocks + 1 !== P8B_DURATION_BLOCKS) throw new Error("STEP_BLOCKS");
  if (out.reduce((s, x) => s + x.mps * x.blocks, 0) !== MPS_TOTAL) throw new Error("STEP_MPS");
  return out;
}

export function encodeReleaseSteps(steps: P8bStep[] = buildReleaseSteps()): `0x${string}` {
  return ("0x" + steps.map((s) => ((BigInt(s.mps) << 40n) | BigInt(s.blocks)).toString(16).padStart(16, "0")).join("")) as `0x${string}`;
}

/** Exact bytes used in the fork rehearsal (fork-tests/p8b/P8BForkRehearsal.t.sol RELEASE_60LIN_40FINAL). */
export const P8B_RELEASE_STEPS_HEX = encodeReleaseSteps();

// ------------------------------------------------------------ execution-parameter manifest
const STARTING_FLOOR_EQUIV_RAISE = 10n * UNIT;
export const P8B_TICK_SPACING_Q96 = 52818775009509558395n;
export const P8B_FLOOR_PRICE_Q96 = 5281877500950955839500n;

/** Measured on fork with the locked P8B v1 parameters (block 82,592,963). */
export const P8B_FORK_EVIDENCE = {
  version: "pcart-p8b-fork-evidence-v1",
  chainId: 4663,
  forkBlock: 82_592_963,
  sources: {
    liquidityLauncher: { tag: "v3.3.0", commit: "e428c3f8fc7b76a2c75abf6e4a7b5a193a89319b" },
    continuousClearingAuction: { tag: "v2.1.0", commit: "a56d42231e7bf048136d9d88fa61e8518c10c5ff" },
    bytecodeMatch: "RUNTIME_EXACT_EXCEPT_IMMUTABLES_DECODED_TO_PINNED_ADDRESSES",
  },
  protocolFeeController: ZERO,
  protocolFeeWei: 0n,
  forkTokenArtifact: { artifact: "frozen-pcart-token-v1", creationKeccak: "0x2edebe9de5877c0775dc87644ca9051a54034f4eee8bd9662c7657d0fd3c2196", runtimeKeccak: "0x69ef7ad36b6c4b900d390bc4977eb61a518e9d35e506a6f83712192c7e7d03e4", forkOnly: true },
  rehearsalSafe: { version: "1.4.1", threshold: 2, owners: 3, oneSignatureRejected: true, twoSignaturesAccepted: true },
  success30Eth: {
    grossWei: 29_999_999_999_999_999_999n,
    protocolFeeWei: 0n,
    lpEthWei: 19_999_999_999_999_999_999n,
    treasuryEthWei: 10_000_000_000_000_000_000n,
    tokensSold: 149_999_999_999_999_999_999_998_844n,
    unsoldSweptToSafe: 1_155n,
    lpTokensConsumed: 99_448_658_224_035_998_281_312_224n,
    lpReserveReturnedToSafe: 100_551_341_775_964_001_718_687_776n,
    clearingPriceQ96: 15_933_480_436_866_365_233_275n,
    futureReserveUntouched: true,
    poolFeePips: 2_500,
    lpPositions: 1,
    lpOwner: "FEE_SPLITTER_FEES_OFF",
    safeCannotReclaimLp: true,
    ccaEthDustWei: 1n,
  },
  belowFloor4Eth: {
    grossWei: 4n * UNIT,
    graduated: false,
    poolCreated: false,
    treasuryEthWei: 0n,
    lpReserveReturnedToSafe: 200_000_000n * UNIT,
    auctionInventorySweptToSafe: 150_000_000n * UNIT,
    bidderRefundsWei: 4n * UNIT,
    claimTokensRefused: true,
    futureReserveUntouched: true,
  },
  preAuctionTemplateCheck: {
    rehearsalSafe: "0x37bD0FF7c2DcFFb9058b667E080130690c13c09D",
    forkToken: "0x2e234DAe75C793f67A35089C9d99245E1C58470b",
    nonce: 0,
    startBlock: 82_592_973n,
    permit2Expiration: 1_791_474_806n,
    dataKeccak: "0xbefd12daef2defea576ac9c13f63c4b7be2022eb1346a58f9520bd792a12b1dd",
    safeTxHash: "0x2ac06e3839249bd42860f42cfdf02bf21802ddb2922c0126038c51cee0a4d63f",
  },
  sweepTemplateCheck: {
    rehearsalSafe: "0x37bD0FF7c2DcFFb9058b667E080130690c13c09D",
    cca: "0x028cE0dF96A52Ac567836f21ac93d916970ec049",
    nonce: 1,
    dataKeccak: "0x52da2ec72a42db73768fe15ec937463904ad4f4ecafaaa758bada0457ac787bc",
    safeTxHash: "0xe51f16eae88c30c977ef7eac7a99ee248d39f31564f740f2f87cbb8a30c454ce",
  },
} as const;
export const P8B_FORK_EVIDENCE_FINGERPRINT = p8aFingerprint("pcart-p8b-fork-evidence", P8B_FORK_EVIDENCE);
export const P8B_SUCCESS_FINGERPRINT = p8aFingerprint("pcart-p8b-success-30eth", P8B_FORK_EVIDENCE.success30Eth);
export const P8B_REFUND_FINGERPRINT = p8aFingerprint("pcart-p8b-below-floor", P8B_FORK_EVIDENCE.belowFloor4Eth);
export const P8B_SOURCE_ATTESTATION_FINGERPRINT = p8aFingerprint("pcart-p8b-source-attestation", { sources: P8B_FORK_EVIDENCE.sources, codeHashes: P8B_CODE_HASH_ATTESTATIONS });
export const P8B_RELEASE_SCHEDULE_FINGERPRINT = keccak256(P8B_RELEASE_STEPS_HEX);

export const P8B_TRANSACTION_SEQUENCE = [
  { order: 1, phase: "PRE_AUCTION", kind: "SAFE_TX", signaturesRequired: 2, label: "MultiSendCallOnly: PCART approve Permit2 → Permit2 approve Liquidity Launcher → Launcher multicall(depositToken, distributeToken)" },
  { order: 2, phase: "DURING_AUCTION", kind: "NONE", signaturesRequired: 0, label: "No owner action; bids clear block by block" },
  { order: 3, phase: "POST_AUCTION", kind: "PUBLIC_CALL", signaturesRequired: 0, label: "LBPStrategy.migrate(auction) — permissionless; settles, creates the v4 pool and LP" },
  { order: 4, phase: "POST_AUCTION", kind: "SAFE_TX", signaturesRequired: 2, label: "Auction.sweepUnsoldTokens() — only the Treasury Safe may call" },
] as const;

export const P8B_MANIFEST = {
  version: P8B_MANIFEST_VERSION,
  chainId: 4663,
  p8a: { version: P8A_MANIFEST_VERSION, fingerprint: P8A_MANIFEST_FINGERPRINT },
  minimumRaiseThresholdWei: P8A_MANIFEST.floorWei, // requiredCurrencyRaised: decides success vs refund
  fundraisingTargetWei: P8A_MANIFEST.targetWei, // not a gate, not a cap
  startingTokenPriceFloor: {
    q96: P8B_FLOOR_PRICE_Q96,
    equivalentFullInventoryRaiseWei: STARTING_FLOOR_EQUIV_RAISE,
    approxEthPerPcartText: "0.00000006666666667",
  },
  tickSpacingQ96: P8B_TICK_SPACING_Q96,
  tickSpacingPercentOfFloor: 1,
  releaseSchedule: { label: "60% evenly through the auction + 40% in the final block", stepsHex: P8B_RELEASE_STEPS_HEX, fingerprint: P8B_RELEASE_SCHEDULE_FINGERPRINT },
  durationBlocks: P8B_DURATION_BLOCKS,
  durationApproxLabel: "~7 days at measured block cadence (block-based; wall-clock end may drift)",
  auctionInventory: P8A_MANIFEST.auctionAllocation,
  maxLpReserve: P8A_MANIFEST.initialLiquidityReserve,
  protectedFutureReserve: P8A_MANIFEST.futureLiquidityReserve,
  lpAllocationScheduleHash: keccak256(encodeLpAllocationSchedule()),
  pool: { feePips: 2_500, tickSpacing: 50, hook: dep("INITIALIZER_HOOK").address },
  protocolFeeExpectedWei: 0n,
  codeHashes: P8B_CODE_HASH_ATTESTATIONS,
  safeRequirement: { version: "1.4.1", threshold: 2, ownerCount: 3, address: P8B_REAL_TREASURY_SAFE.address, owners: P8B_REAL_TREASURY_SAFE.owners },
  transactionSequence: P8B_TRANSACTION_SEQUENCE,
  safeTxCountPreAuction: 1,
  safeTxCountPostAuction: 1,
  signaturesPerSafeTx: 2,
  modes: { settlement: "AUTOMATIC_IN_MIGRATE", migration: "EXPLICIT_PERMISSIONLESS_MIGRATE", refund: "CLAIM_BASED_EXIT_BID", unsold: "SAFE_SWEEP_UNSOLD_TOKENS", lpCustody: "AUTOMATIC_PERMANENT_FEES_OFF_FEESPLITTER" },
  unsoldPolicy: "RETURN_TO_TREASURY_SAFE",
  unusedLpReserve: "TREASURY_SAFE",
  lpCustodyPolicy: "PERMANENT_FEES_OFF_FEESPLITTER",
  promotionMinDays: P8A_MANIFEST.timeline.promotionMinDays,
  autoStart: false,
  forkEvidence: { version: P8B_FORK_EVIDENCE.version, fingerprint: P8B_FORK_EVIDENCE_FINGERPRINT, forkBlock: P8B_FORK_EVIDENCE.forkBlock },
  launchStartSalt: keccak256(stringToHex("PCART-LAUNCH")),
} as const;
export const P8B_MANIFEST_FINGERPRINT = p8aFingerprint("pcart-p8b-manifest", P8B_MANIFEST);

/** Exact ETH-per-PCART floor = floorQ96 / 2^96 (both 18 decimals). */
export const floorEthPerPcart = () => Number(P8B_FLOOR_PRICE_Q96) / Number(Q96);

// ------------------------------------------------------------ time / block model (estimates only)
export type P8bWindowPlan =
  | { ok: true; estimated: true; startBlock: bigint; endBlock: bigint; migrationBlock: bigint; estimatedStartMs: number; estimatedEndMs: number; msPerBlock: number }
  | { ok: false; reason: "OWNER_CONFIRMATION_REQUIRED" | "PROMOTION_RUNWAY_TOO_SHORT" | "START_IN_PAST" | "INVALID_INPUT" };

export function planAuctionWindow(i: { promotionStartMs: number; intendedStartMs: number; nowMs: number; currentBlock: bigint; msPerBlock: number; ownerConfirmed: boolean }): P8bWindowPlan {
  if (![i.promotionStartMs, i.intendedStartMs, i.nowMs, i.msPerBlock].every(Number.isFinite) || i.msPerBlock <= 0 || typeof i.currentBlock !== "bigint") return { ok: false, reason: "INVALID_INPUT" };
  if (!i.ownerConfirmed) return { ok: false, reason: "OWNER_CONFIRMATION_REQUIRED" };
  if (i.intendedStartMs < i.promotionStartMs + P8A_MANIFEST.timeline.promotionMinDays * DAY_MS) return { ok: false, reason: "PROMOTION_RUNWAY_TOO_SHORT" };
  if (i.intendedStartMs <= i.nowMs) return { ok: false, reason: "START_IN_PAST" };
  const startBlock = i.currentBlock + BigInt(Math.ceil((i.intendedStartMs - i.nowMs) / i.msPerBlock));
  const endBlock = startBlock + BigInt(P8B_DURATION_BLOCKS);
  return { ok: true, estimated: true, startBlock, endBlock, migrationBlock: endBlock + 1n, estimatedStartMs: i.intendedStartMs, estimatedEndMs: i.intendedStartMs + Math.round(P8B_DURATION_BLOCKS * i.msPerBlock), msPerBlock: i.msPerBlock };
}

// ------------------------------------------------------------ live preparation guard (fail closed)
export const P8B_ALLOWED_PRE_AUCTION_LAUNCH_STATUS = "OFFICIAL_CONTRACT_REGISTERED" as const;

export type P8bReviewRef = { manifestVersion: string; manifestFingerprint: string; expiresAtMs: number } | null;
export type P8bLiveContext = {
  chainId: number;
  nowMs: number;
  launchStatus: string | null;
  officialTokenAddress: string | null;
  officialRegistered: boolean;
  deploymentFinalized: boolean;
  p8aReview: P8bReviewRef;
  p8bReview: P8bReviewRef;
  observedCodeHashes: Record<string, string | null | undefined>;
  safe: { address: string; version: string; threshold: number; owners: string[]; nonce: number; codeHash: string };
};

export type P8bBlock =
  | "WRONG_CHAIN" | "LAUNCH_STATE_NOT_ALLOWED" | "OFFICIAL_TOKEN_NOT_REGISTERED" | "OFFICIAL_TOKEN_NOT_FINALIZED" | "ZERO_OR_PLACEHOLDER_TOKEN"
  | "TOKEN_MISMATCH" | "P8A_REVIEW_MISSING_OR_STALE" | "P8B_REVIEW_MISSING_OR_STALE" | "CODE_HASH_MISMATCH" | "SAFE_MISMATCH" | "NONCE_MISMATCH"
  | "PROMOTION_RUNWAY_TOO_SHORT" | "OWNER_CONFIRMATION_REQUIRED" | "INVALID_INPUT" | "START_IN_PAST" | "EXECUTION_PARAMETERS_MISMATCH";

const low = (s: string | null | undefined) => String(s ?? "").trim().toLowerCase();
const reviewCurrent = (r: P8bReviewRef, version: string, fp: string, nowMs: number) =>
  !!r && r.manifestVersion === version && low(r.manifestFingerprint) === low(fp) && r.expiresAtMs > nowMs;

export function liveBlocks(ctx: P8bLiveContext, i: { tokenAddress: string; safeNonce: number; requireOfficialRegistration: boolean }): P8bBlock[] {
  const b: P8bBlock[] = [];
  if (ctx.chainId !== 4663) b.push("WRONG_CHAIN");
  const tok = low(i.tokenAddress);
  if (!ADDR.test(tok) || tok === ZERO || /^0x0{30,}/.test(tok)) b.push("ZERO_OR_PLACEHOLDER_TOKEN");
  if (i.requireOfficialRegistration) {
    if (ctx.launchStatus !== P8B_ALLOWED_PRE_AUCTION_LAUNCH_STATUS) b.push("LAUNCH_STATE_NOT_ALLOWED");
    if (!ctx.officialRegistered || !ctx.officialTokenAddress) b.push("OFFICIAL_TOKEN_NOT_REGISTERED");
    if (!ctx.deploymentFinalized) b.push("OFFICIAL_TOKEN_NOT_FINALIZED");
  }
  if (ctx.officialTokenAddress && low(ctx.officialTokenAddress) !== tok) b.push("TOKEN_MISMATCH");
  if (!ctx.officialTokenAddress) { if (!b.includes("OFFICIAL_TOKEN_NOT_REGISTERED")) b.push("OFFICIAL_TOKEN_NOT_REGISTERED"); }
  if (!reviewCurrent(ctx.p8aReview, P8A_MANIFEST_VERSION, P8A_MANIFEST_FINGERPRINT, ctx.nowMs)) b.push("P8A_REVIEW_MISSING_OR_STALE");
  if (!reviewCurrent(ctx.p8bReview, P8B_MANIFEST_VERSION, P8B_MANIFEST_FINGERPRINT, ctx.nowMs)) b.push("P8B_REVIEW_MISSING_OR_STALE");
  if (P8B_CODE_HASH_ATTESTATIONS.some((a) => low(ctx.observedCodeHashes[a.key]) !== low(a.codeHash))) b.push("CODE_HASH_MISMATCH");
  const s = ctx.safe;
  const ownersOk = s.owners.length === 3 && P8B_REAL_TREASURY_SAFE.owners.every((o) => s.owners.map(low).includes(low(o)));
  if (low(s.address) !== low(P8B_REAL_TREASURY_SAFE.address) || s.version !== "1.4.1" || s.threshold !== 2 || !ownersOk || low(s.codeHash) !== low(P8B_REAL_TREASURY_SAFE.proxyCodeHash)) b.push("SAFE_MISMATCH");
  if (!Number.isInteger(i.safeNonce) || i.safeNonce !== s.nonce) b.push("NONCE_MISMATCH");
  return b;
}

// ------------------------------------------------------------ SafeTx hashing (Safe 1.4.1 EIP-712)
export type P8bSafeTx = {
  to: `0x${string}`; value: bigint; data: `0x${string}`; operation: 0 | 1;
  safeTxGas: bigint; baseGas: bigint; gasPrice: bigint; gasToken: `0x${string}`; refundReceiver: `0x${string}`; nonce: bigint;
};
const SAFE_TX_TYPES = {
  SafeTx: [
    { name: "to", type: "address" }, { name: "value", type: "uint256" }, { name: "data", type: "bytes" }, { name: "operation", type: "uint8" },
    { name: "safeTxGas", type: "uint256" }, { name: "baseGas", type: "uint256" }, { name: "gasPrice", type: "uint256" },
    { name: "gasToken", type: "address" }, { name: "refundReceiver", type: "address" }, { name: "nonce", type: "uint256" },
  ],
} as const;

export function safeTxHash(safe: `0x${string}`, tx: P8bSafeTx, chainId = 4663): `0x${string}` {
  return hashTypedData({ domain: { chainId, verifyingContract: safe }, types: SAFE_TX_TYPES, primaryType: "SafeTx", message: tx });
}
const safeTx = (to: `0x${string}`, data: `0x${string}`, operation: 0 | 1, nonce: number): P8bSafeTx =>
  ({ to, value: 0n, data, operation, safeTxGas: 0n, baseGas: 0n, gasPrice: 0n, gasToken: ZERO, refundReceiver: ZERO, nonce: BigInt(nonce) });

/** A prepared template is never executable by itself; the Safe contract enforces 2-of-3 on chain. */
export const signatureThresholdMet = (validOwnerSignatures: number) => Number.isInteger(validOwnerSignatures) && validOwnerSignatures >= P8B_REAL_TREASURY_SAFE.threshold;

// ------------------------------------------------------------ calldata builders
const ERC20 = parseAbi(["function approve(address spender, uint256 amount) returns (bool)"]);
const PERMIT2 = parseAbi(["function approve(address token, address spender, uint160 amount, uint48 expiration)"]);
const LAUNCHER = parseAbi([
  "function multicall(bytes[] data) payable returns (bytes[])",
  "function depositToken(address token, uint160 amount) payable",
  "function distributeToken(address tokenAddress, (address strategy, uint128 amount, bytes configData) distribution, bytes32 salt) payable",
]);
const MULTISEND = parseAbi(["function multiSend(bytes transactions) payable"]);
const CCA = parseAbi(["function sweepUnsoldTokens()"]);
const LBP = parseAbi(["function migrate(address initializer)"]);

const AUCTION_PARAMS = [{ type: "tuple", components: [
  { name: "currency", type: "address" }, { name: "tokensRecipient", type: "address" }, { name: "fundsRecipient", type: "address" },
  { name: "startBlock", type: "uint64" }, { name: "endBlock", type: "uint64" }, { name: "claimBlock", type: "uint64" },
  { name: "tickSpacing", type: "uint256" }, { name: "validationHook", type: "address" }, { name: "floorPrice", type: "uint256" },
  { name: "requiredCurrencyRaised", type: "uint128" }, { name: "auctionStepsData", type: "bytes" },
] }] as const;
const MIGRATOR_PARAMS = { type: "tuple", components: [
  { name: "token", type: "address" }, { name: "currency", type: "address" }, { name: "migrationBlock", type: "uint64" },
  { name: "reservedTokenAmountForLP", type: "uint128" }, { name: "recipient", type: "address" }, { name: "positionRecipient", type: "address" },
  { name: "poolParameters", type: "tuple", components: [{ name: "fee", type: "uint24" }, { name: "tickSpacing", type: "int24" }, { name: "hook", type: "address" }] },
  { name: "positionDefinitions", type: "bytes" }, { name: "lpAllocationSchedule", type: "bytes" },
] } as const;
const EMPTY_POSITION_DEFINITIONS = encodeAbiParameters(
  [{ type: "tuple[]", components: [{ name: "offsetLower", type: "int24" }, { name: "offsetUpper", type: "int24" }, { name: "weight", type: "uint24" }, { name: "overridePositionRecipient", type: "address" }] }],
  [[]],
);
/** CCA sentinel: fundsRecipient = MSG_SENDER (address(1)) → LBPStrategy receives proceeds. */
const MSG_SENDER_SENTINEL = "0x0000000000000000000000000000000000000001" as const;

export function encodeDistributionConfig(token: `0x${string}`, safe: `0x${string}`, startBlock: bigint): `0x${string}` {
  const endBlock = startBlock + BigInt(P8B_DURATION_BLOCKS);
  const ap = encodeAbiParameters(AUCTION_PARAMS, [{
    currency: ZERO, tokensRecipient: safe, fundsRecipient: MSG_SENDER_SENTINEL, startBlock, endBlock, claimBlock: endBlock,
    tickSpacing: P8B_TICK_SPACING_Q96, validationHook: ZERO, floorPrice: P8B_FLOOR_PRICE_Q96,
    requiredCurrencyRaised: P8A_MANIFEST.floorWei, auctionStepsData: P8B_RELEASE_STEPS_HEX,
  }]);
  return encodeAbiParameters([MIGRATOR_PARAMS, { type: "bytes" }], [{
    token, currency: ZERO, migrationBlock: endBlock + 1n, reservedTokenAmountForLP: P8A_MANIFEST.initialLiquidityReserve,
    recipient: safe, positionRecipient: dep("FEE_SPLITTER_FEES_OFF").address,
    poolParameters: { fee: 2_500, tickSpacing: 50, hook: dep("INITIALIZER_HOOK").address },
    positionDefinitions: EMPTY_POSITION_DEFINITIONS, lpAllocationSchedule: encodeLpAllocationSchedule(),
  }, ap]);
}

export type P8bChildCall = { order: number; target: `0x${string}`; value: bigint; data: `0x${string}`; description: string };
export type P8bPrepared = {
  kind: "PRE_AUCTION_MULTISEND" | "POST_AUCTION_SWEEP" | "PUBLIC_MIGRATE";
  mode: "FORK" | "LIVE";
  prepareOnly: true;
  executable: false;
  signaturesCollected: 0;
  signaturesRequired: 0 | 2;
  safe: `0x${string}` | null;
  childCalls: P8bChildCall[];
  safeTx: P8bSafeTx | null;
  safeTxHash: `0x${string}` | null;
  call: { target: `0x${string}`; value: bigint; data: `0x${string}`; dataKeccak: `0x${string}` };
  prerequisites: string[];
  summary: string;
  manifestFingerprint: `0x${string}`;
  fingerprint: `0x${string}`;
};
export type P8bBuildResult = { ok: true; prepared: P8bPrepared } | { ok: false; blocks: P8bBlock[] };

function finalize(p: Omit<P8bPrepared, "fingerprint" | "manifestFingerprint" | "prepareOnly" | "executable" | "signaturesCollected">): P8bPrepared {
  const base = { ...p, prepareOnly: true as const, executable: false as const, signaturesCollected: 0 as const, manifestFingerprint: P8B_MANIFEST_FINGERPRINT };
  return { ...base, fingerprint: p8aFingerprint("pcart-p8b-prepared", base) };
}

const checksumLike = (a: string) => low(a) as `0x${string}`;

export type P8bPreAuctionInput = {
  mode: "FORK" | "LIVE";
  tokenAddress: string;
  safeAddress: string;
  safeNonce: number;
  startBlock: bigint;
  permit2Expiration: bigint;
  /** LIVE only. */
  live?: P8bLiveContext;
  schedule?: { promotionStartMs: number; intendedStartMs: number; ownerConfirmed: boolean };
};

export function buildPreAuctionSafeTx(i: P8bPreAuctionInput): P8bBuildResult {
  const blocks: P8bBlock[] = [];
  const tok = low(i.tokenAddress);
  if (!ADDR.test(tok) || tok === ZERO || !ADDR.test(low(i.safeAddress)) || typeof i.startBlock !== "bigint" || i.startBlock <= 0n || typeof i.permit2Expiration !== "bigint" || i.permit2Expiration <= 0n || !Number.isInteger(i.safeNonce) || i.safeNonce < 0) blocks.push("INVALID_INPUT");
  if (i.mode === "LIVE") {
    if (!i.live) return { ok: false, blocks: [...blocks, "INVALID_INPUT"] };
    blocks.push(...liveBlocks(i.live, { tokenAddress: tok, safeNonce: i.safeNonce, requireOfficialRegistration: true }));
    if (low(i.safeAddress) !== low(P8B_REAL_TREASURY_SAFE.address)) blocks.push("SAFE_MISMATCH");
    const sc = i.schedule;
    if (!sc || !sc.ownerConfirmed) blocks.push("OWNER_CONFIRMATION_REQUIRED");
    else if (sc.intendedStartMs < sc.promotionStartMs + P8A_MANIFEST.timeline.promotionMinDays * DAY_MS) blocks.push("PROMOTION_RUNWAY_TOO_SHORT");
  } else if (low(i.safeAddress) === low(P8B_REAL_TREASURY_SAFE.address)) {
    blocks.push("SAFE_MISMATCH"); // fork mode never targets the real Treasury Safe
  }
  if (blocks.length) return { ok: false, blocks: [...new Set(blocks)] };

  const token = checksumLike(tok);
  const safe = checksumLike(i.safeAddress);
  const amount = P8A_MANIFEST.auctionAllocation + P8A_MANIFEST.initialLiquidityReserve;
  const permit2 = dep("PERMIT2").address;
  const launcher = dep("LIQUIDITY_LAUNCHER").address;
  const c1 = encodeFunctionData({ abi: ERC20, functionName: "approve", args: [permit2, amount] });
  const c2 = encodeFunctionData({ abi: PERMIT2, functionName: "approve", args: [token, launcher, amount, Number(i.permit2Expiration)] });
  const deposit = encodeFunctionData({ abi: LAUNCHER, functionName: "depositToken", args: [token, amount] });
  const distribute = encodeFunctionData({ abi: LAUNCHER, functionName: "distributeToken", args: [token, { strategy: dep("LBP_STRATEGY").address, amount, configData: encodeDistributionConfig(token, safe, i.startBlock) }, P8B_MANIFEST.launchStartSalt] });
  const c3 = encodeFunctionData({ abi: LAUNCHER, functionName: "multicall", args: [[deposit, distribute]] });
  const children: P8bChildCall[] = [
    { order: 1, target: token, value: 0n, data: c1, description: "PCART approve Permit2 for exactly 350M PCART" },
    { order: 2, target: permit2, value: 0n, data: c2, description: "Permit2 approve Liquidity Launcher for exactly 350M PCART" },
    { order: 3, target: launcher, value: 0n, data: c3, description: "Liquidity Launcher multicall: depositToken + distributeToken (creates auction, 150M inventory, 200M LP reserve, 80/60/50 schedule)" },
  ];
  const packed = encodePacked(
    children.flatMap(() => ["uint8", "address", "uint256", "uint256", "bytes"] as const),
    children.flatMap((c) => [0, c.target, c.value, BigInt((c.data.length - 2) / 2), c.data] as const),
  );
  const data = encodeFunctionData({ abi: MULTISEND, functionName: "multiSend", args: [packed] });
  const tx = safeTx(P8B_MULTISEND_CALL_ONLY.address, data, 1, i.safeNonce);
  const endBlock = i.startBlock + BigInt(P8B_DURATION_BLOCKS);
  return { ok: true, prepared: finalize({
    kind: "PRE_AUCTION_MULTISEND", mode: i.mode, signaturesRequired: 2, safe, childCalls: children, safeTx: tx, safeTxHash: safeTxHash(safe, tx),
    call: { target: P8B_MULTISEND_CALL_ONLY.address, value: 0n, data, dataKeccak: keccak256(data) },
    prerequisites: ["Official PCART registered + finalized (P6/P7)", "Current P8A v2 + P8B v1 reviews", "Exact code hashes re-attested", "Safe 1.4.1, 2-of-3, nonce unchanged", ">=21-day promotion runway and owner-confirmed start"],
    summary: `ONE Safe transaction (DELEGATECALL MultiSendCallOnly), 2 of 3 owner signatures. Auction blocks ${i.startBlock}→${endBlock} (block-based, ~7 days estimated). PREPARE ONLY — never submitted from Cartel HQ.`,
  }) };
}

export function buildSweepSafeTx(i: { mode: "FORK" | "LIVE"; ccaAddress: string; tokenAddress: string; safeAddress: string; safeNonce: number; live?: P8bLiveContext }): P8bBuildResult {
  const blocks: P8bBlock[] = [];
  const cca = low(i.ccaAddress);
  if (!ADDR.test(cca) || cca === ZERO || !ADDR.test(low(i.safeAddress)) || !Number.isInteger(i.safeNonce) || i.safeNonce < 0) blocks.push("INVALID_INPUT");
  if (i.mode === "LIVE") {
    if (!i.live) return { ok: false, blocks: [...blocks, "INVALID_INPUT"] };
    blocks.push(...liveBlocks(i.live, { tokenAddress: i.tokenAddress, safeNonce: i.safeNonce, requireOfficialRegistration: false }));
    if (low(i.safeAddress) !== low(P8B_REAL_TREASURY_SAFE.address)) blocks.push("SAFE_MISMATCH");
  } else if (low(i.safeAddress) === low(P8B_REAL_TREASURY_SAFE.address)) blocks.push("SAFE_MISMATCH");
  if (blocks.length) return { ok: false, blocks: [...new Set(blocks)] };
  const safe = checksumLike(i.safeAddress);
  const data = encodeFunctionData({ abi: CCA, functionName: "sweepUnsoldTokens" });
  const tx = safeTx(checksumLike(cca), data, 0, i.safeNonce);
  return { ok: true, prepared: finalize({
    kind: "POST_AUCTION_SWEEP", mode: i.mode, signaturesRequired: 2, safe, childCalls: [], safeTx: tx, safeTxHash: safeTxHash(safe, tx),
    call: { target: checksumLike(cca), value: 0n, data, dataKeccak: keccak256(data) },
    prerequisites: ["Auction ended (block >= endBlock)", "Auction address discovered from InitializerCreated event", "Safe nonce unchanged"],
    summary: "ONE Safe transaction (CALL auction.sweepUnsoldTokens), 2 of 3 owner signatures; returns unsold PCART to the Treasury Safe. PREPARE ONLY.",
  }) };
}

export function buildPublicMigrateCall(i: { ccaAddress: string; migrationBlock: bigint }): P8bBuildResult {
  const cca = low(i.ccaAddress);
  if (!ADDR.test(cca) || cca === ZERO || typeof i.migrationBlock !== "bigint" || i.migrationBlock <= 0n) return { ok: false, blocks: ["INVALID_INPUT"] };
  const data = encodeFunctionData({ abi: LBP, functionName: "migrate", args: [checksumLike(cca)] });
  return { ok: true, prepared: finalize({
    kind: "PUBLIC_MIGRATE", mode: "FORK", signaturesRequired: 0, safe: null, childCalls: [], safeTx: null, safeTxHash: null,
    call: { target: dep("LBP_STRATEGY").address, value: 0n, data, dataKeccak: keccak256(data) },
    prerequisites: [`block.number >= ${i.migrationBlock} (endBlock + 1)`, "Anyone may call; no Safe signature", ">=5 ETH: settles, creates v4 pool 0.25%, LP to fees-off FeeSplitter; <5 ETH: returns reserve, no pool"],
    summary: "Permissionless public call LBPStrategy.migrate(auction). No Safe signature. PREPARE ONLY.",
  }) };
}

// ------------------------------------------------------------ display helpers
export const p8bSummaryText = (reviewCurrent: boolean) =>
  reviewCurrent ? P8B_SUMMARY_REVIEWED : "Auction execution path rehearsed on a fork — owner review pending; live execution disabled";

export const P8B_DEPENDENCY_KEYS: readonly P8aDependencyKey[] = P8A_MAINNET_DEPENDENCIES.map((d) => d.key);
export const p8bCanonicalJson = canonicalJson;
