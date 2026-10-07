/**
 * PCART P8A — canonical auction + liquidity plan (declarative config + pure math).
 *
 * REVIEW / SIMULATION ONLY. This module has no wallet, provider, signer or
 * Safe-proposal capability. Intents built here are inert data structures for
 * review and fingerprinting; nothing here can move tokens or ETH.
 *
 * Source of truth: docs/PCART_MASTER_LAUNCH_PLAN.md section 00 (L-S5 lock) and
 * docs/PCART_L1_CHAIN_COMPATIBILITY_MANIFEST.md section 9 (pinned code hashes).
 */
import { encodeAbiParameters, encodeFunctionData, keccak256, parseAbi, stringToHex } from "viem";

export const P8A_MANIFEST_VERSION = "pcart-auction-liquidity-p8a-v1" as const;
export const P8A_STOP_COPY = "AUCTION & LIQUIDITY PLAN REVIEWED — NO TRANSACTION" as const;

const UNIT = 10n ** 18n;
export const pcart = (whole: bigint) => whole * UNIT;
export const eth = (whole: bigint) => whole * UNIT;
/** Parse a decimal ETH string into wei with integer math only (max 18 decimals). */
export function ethToWei(text: string): bigint {
  const m = /^(\d+)(?:\.(\d{1,18}))?$/.exec(text.trim());
  if (!m) throw new Error("INVALID_ETH_AMOUNT");
  return BigInt(m[1]) * UNIT + BigInt((m[2] ?? "").padEnd(18, "0") || "0");
}

export type P8aDependencyKey =
  | "LIQUIDITY_LAUNCHER"
  | "LBP_STRATEGY"
  | "INITIALIZER_HOOK"
  | "CCA_FACTORY"
  | "FEE_SPLITTER_FEES_OFF"
  | "COMPOUNDING_CLAIM_RECIPIENT"
  | "PERMIT2"
  | "V4_POSITION_MANAGER"
  | "V4_POOL_MANAGER";

export type P8aDependency = { key: P8aDependencyKey; label: string; address: `0x${string}`; codeHash: `0x${string}`; bytes: number };

/** Robinhood Chain mainnet 4663. Hashes: manifest §9 (block 77,685,829); v4 managers observed 2026-10-07 (block 82,491,106). */
export const P8A_MAINNET_DEPENDENCIES: readonly P8aDependency[] = [
  { key: "LIQUIDITY_LAUNCHER", label: "Liquidity Launcher", address: "0x0000FffFBE8efE702c8703aE3477FF5dE3d319C0", codeHash: "0x4a586d925c9d59ece13ce2239ebd7dea9ee725f9d33c6667e0fd16ae8d977d80", bytes: 4127 },
  { key: "LBP_STRATEGY", label: "LBPStrategy v3.3.0", address: "0xbf1aB81f7d534b2CC0Da76fcf4d541322bB0e000", codeHash: "0x52b5ff6eb222744bfe04beab33c12d3d0126ab731d8bb0737d58b63b12e35d2c", bytes: 21241 },
  { key: "INITIALIZER_HOOK", label: "InitializerHook v3.3.0", address: "0x5fB5229FBA341dFE5a7e6A14d4809D6Cf887a000", codeHash: "0xb427c9117931c9139aa652ab6098bd9ffe6d2cc2c48ea47c75e8f52cebe24fff", bytes: 3104 },
  { key: "CCA_FACTORY", label: "CCA factory v2.1.0", address: "0x000000001F26a0044BaA66024e7b6599c61963F8", codeHash: "0xa1d2a90564f4f63580b25de42efaff92505c254b00fc666f65ab38126cce5cfa", bytes: 24214 },
  { key: "FEE_SPLITTER_FEES_OFF", label: "FeeSplitter (fees-off)", address: "0x882Ae5e2095435A62Fd1BBDEfcb637f5CeAFc0ee", codeHash: "0x8238e5106b3a895514083110d1f3b4e51be61148604f35113719af56ae325f42", bytes: 7260 },
  { key: "COMPOUNDING_CLAIM_RECIPIENT", label: "CompoundingClaimRecipient", address: "0xf585b5D728A8fdE743027307BF5F3556E3B9C58D", codeHash: "0xd2fa4e20bd2f18107b33b38cd3115be9f8d11b9d03767a462c2fe224c67a7fe2", bytes: 3598 },
  { key: "PERMIT2", label: "Permit2", address: "0x000000000022D473030F116dDEE9F6B43aC78BA3", codeHash: "0x5208783f52488f7d3493e5e38311ab707c1d75457fe472a19b0b4d57d66a7fca", bytes: 9152 },
  { key: "V4_POSITION_MANAGER", label: "v4 PositionManager", address: "0x58daec3116aae6D93017bAAea7749052E8a04fA7", codeHash: "0xc873e135dc9aaec88489cfbad146b4cb49d6a32e0d80326377784b7ba17670b2", bytes: 23877 },
  { key: "V4_POOL_MANAGER", label: "v4 PoolManager", address: "0x8366a39CC670B4001A1121B8F6A443A643e40951", codeHash: "0xbd3881180b547f5fe817545743cfb4343e96b1bc6640dcd70c106b0066e95626", bytes: 24009 },
] as const;

export const dep = (k: P8aDependencyKey) => P8A_MAINNET_DEPENDENCIES.find((d) => d.key === k)!;

export const P8A_MANIFEST = {
  version: P8A_MANIFEST_VERSION,
  chainId: 4663,
  mechanism: "UNISWAP_CCA_LBP_STRATEGY",
  quoteAsset: "NATIVE_ETH",
  auctionAllocation: pcart(150_000_000n),
  initialLiquidityReserve: pcart(200_000_000n),
  futureLiquidityReserve: pcart(150_000_000n),
  futureLiquidityReserveInFirstLaunch: false,
  publicLaunchBucket: pcart(500_000_000n),
  totalSupply: pcart(1_000_000_000n),
  floorWei: eth(5n),
  targetWei: eth(30n),
  maxRaiseWei: null as bigint | null,
  targetIsGate: false,
  durationHours: 96,
  durationIsApproximate: true,
  whitelist: false,
  presale: false,
  extension: false,
  /** Liquidity share of raised ETH, in basis points, by lower bound (wei). */
  liquidityBrackets: [
    { minWei: eth(5n), liquidityBps: 10_000 },
    { minWei: eth(15n), liquidityBps: 9_000 },
    { minWei: eth(30n), liquidityBps: 8_000 },
  ],
  pool: { version: "UNISWAP_V4", feePips: 2_500, feeLabel: "0.25%", dynamicFee: false },
  lpCustody: "PERMANENT_FEES_OFF_FEESPLITTER",
  lpCustodyLabel: "Permanent LP custody (functionally burned)",
  unsoldPolicy: "RETURN_TO_TREASURY_SAFE",
  unsoldPolicyRequiresLiveReconfirmation: true,
  treasuryDependency: "VERIFIED_2_OF_3_TREASURY_SAFE",
  officialTokenDependency: "P7_OFFICIAL_CONTRACT_REGISTRATION",
  dependencies: P8A_MAINNET_DEPENDENCIES,
} as const;

// ------------------------------------------------------------ fingerprints
function canon(v: unknown): unknown {
  if (typeof v === "bigint") return `${v.toString()}n`;
  if (Array.isArray(v)) return v.map(canon);
  if (v && typeof v === "object") {
    return Object.fromEntries(Object.keys(v as object).sort().map((k) => [k, canon((v as any)[k])]));
  }
  return v;
}
export const canonicalJson = (v: unknown) => JSON.stringify(canon(v));
export const p8aFingerprint = (domain: string, v: unknown) => keccak256(stringToHex(`${domain}|${canonicalJson(v)}`));
export const P8A_MANIFEST_FINGERPRINT = p8aFingerprint("pcart-p8a-manifest", P8A_MANIFEST);

// ------------------------------------------------------------ liquidity math (wei only)
export type P8aSplit = { refund: boolean; pool: boolean; liquidityBps: number; liquidityWei: bigint; treasuryWei: bigint };

export function computeLiquiditySplit(raisedWei: bigint): P8aSplit {
  if (typeof raisedWei !== "bigint" || raisedWei < 0n) throw new Error("INVALID_RAISE");
  if (raisedWei < P8A_MANIFEST.floorWei) return { refund: true, pool: false, liquidityBps: 0, liquidityWei: 0n, treasuryWei: 0n };
  let bps = 0;
  for (const b of P8A_MANIFEST.liquidityBrackets) if (raisedWei >= b.minWei) bps = b.liquidityBps;
  const liquidityWei = (raisedWei * BigInt(bps)) / 10_000n;
  return { refund: false, pool: true, liquidityBps: bps, liquidityWei, treasuryWei: raisedWei - liquidityWei };
}

// ------------------------------------------------------------ auction accounting simulator
/** SDK/auction-owned outcome treated as input; P8A does not do price discovery. */
export type P8aAuctionOutcome = { raisedWei: bigint; soldTokens: bigint; lpTokensUsed: bigint };

export type P8aAccounting = {
  split: P8aSplit;
  soldTokens: bigint;
  unsoldTokens: bigint;
  unsoldDestination: "TREASURY_SAFE";
  lpTokensUsed: bigint;
  lpReserveReturned: bigint;
  tokensFromSafe: bigint;
  tokensReturnedToSafe: bigint;
  futureReserveConsumed: bigint;
  invariantsOk: boolean;
  violations: string[];
};

export function simulateAuctionAccounting(o: P8aAuctionOutcome): P8aAccounting {
  const m = P8A_MANIFEST;
  const violations: string[] = [];
  if (o.soldTokens < 0n || o.soldTokens > m.auctionAllocation) violations.push("SOLD_EXCEEDS_AUCTION_INVENTORY");
  if (o.lpTokensUsed < 0n || o.lpTokensUsed > m.initialLiquidityReserve) violations.push("LP_EXCEEDS_INITIAL_RESERVE");
  const split = computeLiquiditySplit(o.raisedWei);
  // Below floor: auction does not graduate; bidders refund; all tokens come back; no pool.
  const sold = split.refund ? 0n : o.soldTokens;
  const lpUsed = split.refund ? 0n : o.lpTokensUsed;
  if (split.refund && o.lpTokensUsed !== 0n) violations.push("REFUND_PATH_CANNOT_USE_LP_TOKENS");
  const unsold = m.auctionAllocation - (sold > m.auctionAllocation ? m.auctionAllocation : sold);
  const lpReturned = m.initialLiquidityReserve - (lpUsed > m.initialLiquidityReserve ? m.initialLiquidityReserve : lpUsed);
  const tokensFromSafe = m.auctionAllocation + m.initialLiquidityReserve;
  const futureReserveConsumed = 0n;
  if (tokensFromSafe + m.futureLiquidityReserve > m.publicLaunchBucket) violations.push("PUBLIC_BUCKET_EXCEEDED");
  if (tokensFromSafe + m.futureLiquidityReserve > m.totalSupply) violations.push("TOTAL_SUPPLY_EXCEEDED");
  if (sold + unsold !== m.auctionAllocation) violations.push("AUCTION_INVENTORY_NOT_CONSERVED");
  if (lpUsed + lpReturned !== m.initialLiquidityReserve) violations.push("LP_RESERVE_NOT_CONSERVED");
  return {
    split, soldTokens: sold, unsoldTokens: unsold, unsoldDestination: "TREASURY_SAFE",
    lpTokensUsed: lpUsed, lpReserveReturned: lpReturned, tokensFromSafe,
    tokensReturnedToSafe: unsold + lpReturned, futureReserveConsumed,
    invariantsOk: violations.length === 0, violations,
  };
}

// ------------------------------------------------------------ inert intent builders (no send)
export const P8A_MOCK_FORK_TOKEN = "0x00000000000000000000000000000000000fa4e1" as const;
const ADDR = /^0x[0-9a-fA-F]{40}$/;
const ZERO = "0x0000000000000000000000000000000000000000";

export type P8aTokenRef = { address: string; simulation: boolean };

export function assertTokenAddress(t: P8aTokenRef): `0x${string}` {
  const a = String(t?.address ?? "").trim().toLowerCase();
  if (!ADDR.test(a) || a === ZERO) throw new Error("OFFICIAL_TOKEN_ADDRESS_REQUIRED");
  if (a === P8A_MOCK_FORK_TOKEN && !t.simulation) throw new Error("MOCK_TOKEN_OUTSIDE_SIMULATION");
  if (a !== P8A_MOCK_FORK_TOKEN && t.simulation) throw new Error("SIMULATION_REQUIRES_MOCK_TOKEN");
  return a as `0x${string}`;
}

export type P8aIntent = {
  step: "SAFE_TOKEN_APPROVAL_DEPOSIT" | "AUCTION_CREATION" | "POST_AUCTION_LIQUIDITY" | "PERMANENT_LP_CUSTODY";
  executable: false;
  simulation: boolean;
  chainId: 4663;
  from: "TREASURY_SAFE";
  calls: { target: `0x${string}`; value: bigint; calldataHash: `0x${string}`; description: string }[];
  params: Record<string, unknown>;
  manifestVersion: typeof P8A_MANIFEST_VERSION;
  fingerprint: `0x${string}`;
};

const ERC20 = parseAbi(["function approve(address spender, uint256 amount) returns (bool)"]);
const PERMIT2 = parseAbi(["function approve(address token, address spender, uint160 amount, uint48 expiration)"]);

function seal(i: Omit<P8aIntent, "fingerprint" | "manifestVersion" | "executable" | "chainId" | "from">, tokenAddress: string): P8aIntent {
  const base = { ...i, executable: false as const, chainId: 4663 as const, from: "TREASURY_SAFE" as const, manifestVersion: P8A_MANIFEST_VERSION };
  return { ...base, fingerprint: p8aFingerprint("pcart-p8a-intent-v1", { ...base, tokenAddress }) };
}
/** Plan payload hash for steps whose exact protocol calldata is produced by the Uniswap SDK in P8B. */
const planHash = (label: string, payload: unknown) => keccak256(stringToHex(`P8A_PLAN_PAYLOAD|${label}|${canonicalJson(payload)}`));

export function buildSafeApprovalDepositIntent(t: P8aTokenRef): P8aIntent {
  const token = assertTokenAddress(t);
  const amount = P8A_MANIFEST.auctionAllocation + P8A_MANIFEST.initialLiquidityReserve;
  const permit2 = dep("PERMIT2").address;
  const launcher = dep("LIQUIDITY_LAUNCHER").address;
  const approve = encodeFunctionData({ abi: ERC20, functionName: "approve", args: [permit2, amount] });
  const p2 = encodeFunctionData({ abi: PERMIT2, functionName: "approve", args: [token, launcher, amount, 0] });
  return seal({
    step: "SAFE_TOKEN_APPROVAL_DEPOSIT", simulation: t.simulation,
    calls: [
      { target: token, value: 0n, calldataHash: keccak256(approve), description: "ERC-20 approve Permit2 for exactly 350M PCART" },
      { target: permit2, value: 0n, calldataHash: keccak256(p2), description: "Permit2 allowance to Liquidity Launcher (expiration set in P8B)" },
      { target: launcher, value: 0n, calldataHash: planHash("depositToken+distributeToken multicall", { token, amount }), description: "depositToken + distributeToken in ONE multicall (P8B SDK calldata)" },
    ],
    params: { token, amount, spender: launcher },
  }, token);
}

export function buildAuctionCreationIntent(t: P8aTokenRef): P8aIntent {
  const token = assertTokenAddress(t);
  const m = P8A_MANIFEST;
  const config = { token, currency: ZERO, auctionAmount: m.auctionAllocation, requiredCurrencyRaised: m.floorWei, durationHours: m.durationHours, whitelist: false, extension: false, factory: dep("CCA_FACTORY").address };
  const encoded = encodeAbiParameters(
    [{ type: "address" }, { type: "address" }, { type: "uint256" }, { type: "uint256" }, { type: "uint256" }],
    [token, ZERO, m.auctionAllocation, m.floorWei, BigInt(m.durationHours)],
  );
  return seal({
    step: "AUCTION_CREATION", simulation: t.simulation,
    calls: [{ target: dep("LBP_STRATEGY").address, value: 0n, calldataHash: keccak256(encoded), description: "CCA via LBPStrategy (blocks derived from current SDK clock in P8B)" }],
    params: config,
  }, token);
}

export function buildPostAuctionLiquidityIntent(t: P8aTokenRef, o: P8aAuctionOutcome): P8aIntent {
  const token = assertTokenAddress(t);
  const acc = simulateAuctionAccounting(o);
  if (!acc.invariantsOk) throw new Error(`ACCOUNTING_INVALID:${acc.violations.join(",")}`);
  if (acc.split.refund || !acc.split.pool) throw new Error("BELOW_FLOOR_NO_LIQUIDITY");
  const params = { token, liquidityWei: acc.split.liquidityWei, treasuryWei: acc.split.treasuryWei, lpTokens: acc.lpTokensUsed, feePips: P8A_MANIFEST.pool.feePips, poolManager: dep("V4_POOL_MANAGER").address };
  return seal({
    step: "POST_AUCTION_LIQUIDITY", simulation: t.simulation,
    calls: [{ target: dep("LBP_STRATEGY").address, value: 0n, calldataHash: planHash("LBPStrategy.migrate", params), description: "Migrate auction proceeds into Uniswap v4 0.25% pool" }],
    params,
  }, token);
}

export function buildPermanentLpCustodyIntent(t: P8aTokenRef, o: P8aAuctionOutcome): P8aIntent {
  const token = assertTokenAddress(t);
  if (computeLiquiditySplit(o.raisedWei).refund) throw new Error("BELOW_FLOOR_NO_LIQUIDITY");
  const params = { token, positionRecipient: dep("FEE_SPLITTER_FEES_OFF").address, custody: P8A_MANIFEST.lpCustody, recoverable: false };
  return seal({
    step: "PERMANENT_LP_CUSTODY", simulation: t.simulation,
    calls: [{ target: dep("LBP_STRATEGY").address, value: 0n, calldataHash: planHash("positionRecipient", params), description: "LP position recipient = fees-off FeeSplitter (permanent, unrecoverable)" }],
    params,
  }, token);
}

// ------------------------------------------------------------ deterministic simulation
export type P8aSimulation = {
  mode: "TESTNET" | "FORKED_MAINNET";
  dependenciesOk: boolean;
  success: { ok: boolean; accounting: P8aAccounting | null; intents: string[]; reason?: string };
  failure: { ok: boolean; refund: boolean; liquidityIntentRefused: boolean };
  fingerprint: `0x${string}`;
};

/** Reference outcomes for the review simulation (inputs, not predictions). */
export const P8A_SIM_SUCCESS: P8aAuctionOutcome = { raisedWei: eth(20n), soldTokens: pcart(120_000_000n), lpTokensUsed: pcart(180_000_000n) };
export const P8A_SIM_FAILURE: P8aAuctionOutcome = { raisedWei: ethToWei("4.99"), soldTokens: 0n, lpTokensUsed: 0n };

export function runP8aSimulation(mode: "TESTNET" | "FORKED_MAINNET", mainnetDependenciesOk: boolean): P8aSimulation {
  const token = { address: P8A_MOCK_FORK_TOKEN, simulation: true };
  let success: P8aSimulation["success"];
  if (!mainnetDependenciesOk) {
    success = { ok: false, accounting: null, intents: [], reason: "DEPENDENCY_ATTESTATION_FAILED" };
  } else {
    const accounting = simulateAuctionAccounting(P8A_SIM_SUCCESS);
    const intents = [
      buildSafeApprovalDepositIntent(token), buildAuctionCreationIntent(token),
      buildPostAuctionLiquidityIntent(token, P8A_SIM_SUCCESS), buildPermanentLpCustodyIntent(token, P8A_SIM_SUCCESS),
    ].map((i) => i.fingerprint);
    success = { ok: accounting.invariantsOk, accounting, intents };
  }
  let refused = false;
  try { buildPostAuctionLiquidityIntent(token, P8A_SIM_FAILURE); } catch { refused = true; }
  const failAcc = simulateAuctionAccounting(P8A_SIM_FAILURE);
  const failure = { ok: failAcc.split.refund && refused && failAcc.unsoldTokens === P8A_MANIFEST.auctionAllocation, refund: failAcc.split.refund, liquidityIntentRefused: refused };
  const body = { mode, dependenciesOk: mainnetDependenciesOk, success, failure, manifest: P8A_MANIFEST_FINGERPRINT };
  return { mode, dependenciesOk: mainnetDependenciesOk, success, failure, fingerprint: p8aFingerprint("pcart-p8a-simulation", body) };
}

export const formatPcart = (wei: bigint) => `${(wei / UNIT).toLocaleString("en-US")} PCART`;
export function formatEth(wei: bigint): string {
  const whole = wei / UNIT;
  const frac = (wei % UNIT).toString().padStart(18, "0").replace(/0+$/, "").slice(0, 4);
  return `${whole.toString()}${frac ? "." + frac : ""} ETH`;
}

export function p8aSummaryText(i: { officialContractAddress: string | null | undefined; latestReviewActive: boolean }): string {
  if (i.latestReviewActive) return "Auction & liquidity plan reviewed — execution not enabled";
  if (!i.officialContractAddress) return "Auction & liquidity plan can be reviewed now; execution waits for official contract";
  return "Auction & liquidity plan ready for re-review after registration — execution not enabled";
}
