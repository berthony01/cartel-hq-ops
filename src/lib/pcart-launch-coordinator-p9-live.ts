/**
 * PCART P9.1 — pure, deterministic interpretation of live read-only chain observations.
 * No RPC, no wallet, no signing, no writes. Server readers feed raw observations in; the browser
 * only ever receives these typed results (never RPC URLs or secrets).
 */
import { P8A_MAINNET_DEPENDENCIES } from "@/lib/pcart-auction-liquidity-plan";
import { P8B_DURATION_BLOCKS, P8B_REAL_TREASURY_SAFE } from "@/lib/pcart-auction-execution-p8b";
import { P9_PROMOTION_MIN_DAYS } from "@/lib/pcart-launch-coordinator-p9";

export const P9_1_STOP_COPY = "No live action is enabled in P9.1." as const;
export const P9_CHAIN_ID = 4663;
export const P9_CADENCE_SAMPLE_BLOCKS = 2000n;
/** Chain head older than this (vs server clock) is STALE and never produces estimates. */
export const P9_HEAD_MAX_AGE_MS = 120_000;
export const P9_MIN_RAISE_WEI = 5_000_000_000_000_000_000n;
const DAY_MS = 86_400_000;
const low = (s: string | null | undefined) => String(s ?? "").trim().toLowerCase();

// ------------------------------------------------------------ chain
export type P9ChainObservation =
  | { ok: false; error: string; capturedAt: string }
  | { ok: true; chainId: number; latestBlock: bigint; latestTimestampSec: number; sampleBlock: bigint; sampleTimestampSec: number; gasPriceWei: bigint | null; capturedAt: string };

export type P9ChainSnapshot =
  | { status: "UNAVAILABLE" | "WRONG_CHAIN"; reason: string; capturedAt: string }
  | { status: "LIVE" | "STALE"; chainId: number; latestBlock: string; latestBlockAt: string; headAgeMs: number; msPerBlock: number | null; sampleBlocks: number; gasPriceWei: string | null; capturedAt: string };

export function observedMsPerBlock(latestBlock: bigint, latestTsSec: number, sampleBlock: bigint, sampleTsSec: number): number | null {
  const blocks = latestBlock - sampleBlock;
  const ms = (latestTsSec - sampleTsSec) * 1000;
  if (blocks <= 0n || ms <= 0) return null;
  return Math.round((ms / Number(blocks)) * 1000) / 1000;
}

export function interpretChain(o: P9ChainObservation): P9ChainSnapshot {
  if (!o.ok) return { status: "UNAVAILABLE", reason: o.error, capturedAt: o.capturedAt };
  if (o.chainId !== P9_CHAIN_ID) return { status: "WRONG_CHAIN", reason: `Expected chain ${P9_CHAIN_ID}, got ${o.chainId}`, capturedAt: o.capturedAt };
  const headAgeMs = Date.parse(o.capturedAt) - o.latestTimestampSec * 1000;
  return {
    status: headAgeMs <= P9_HEAD_MAX_AGE_MS && headAgeMs > -P9_HEAD_MAX_AGE_MS ? "LIVE" : "STALE",
    chainId: o.chainId,
    latestBlock: o.latestBlock.toString(),
    latestBlockAt: new Date(o.latestTimestampSec * 1000).toISOString(),
    headAgeMs,
    msPerBlock: observedMsPerBlock(o.latestBlock, o.latestTimestampSec, o.sampleBlock, o.sampleTimestampSec),
    sampleBlocks: Number(o.latestBlock - o.sampleBlock),
    gasPriceWei: o.gasPriceWei?.toString() ?? null,
    capturedAt: o.capturedAt,
  };
}

// ------------------------------------------------------------ Treasury Safe
export type P9SafeObservation = { codePresent: boolean | null; codeHash: string | null; version: string | null; threshold: number | null; owners: string[]; nonce: number | null; chainId: number | null; capturedAt: string };
export type P9SafeSnapshot = { status: "READY" | "BLOCKED" | "UNAVAILABLE"; reasons: string[]; address: string; storedAddress: string | null; version: string | null; threshold: number | null; owners: string[]; nonce: number | null; capturedAt: string };

export function interpretSafe(o: P9SafeObservation | null, storedSafeAddress: string | null, configuredSigners: string[]): P9SafeSnapshot {
  const base = { address: P8B_REAL_TREASURY_SAFE.address, storedAddress: storedSafeAddress, version: o?.version ?? null, threshold: o?.threshold ?? null, owners: o?.owners ?? [], nonce: o?.nonce ?? null, capturedAt: o?.capturedAt ?? new Date(0).toISOString() };
  if (!o || o.codePresent === null) return { ...base, status: "UNAVAILABLE", reasons: ["CHAIN_READ_FAILED"] };
  const r: string[] = [];
  if (o.chainId !== P9_CHAIN_ID) r.push("WRONG_CHAIN");
  if (!storedSafeAddress) r.push("NO_STORED_SAFE_ADDRESS");
  else if (low(storedSafeAddress) !== low(P8B_REAL_TREASURY_SAFE.address)) r.push("STORED_SAFE_ADDRESS_MISMATCH");
  if (!o.codePresent) r.push("SAFE_CODE_MISSING");
  else if (low(o.codeHash) !== low(P8B_REAL_TREASURY_SAFE.proxyCodeHash)) r.push("SAFE_PROXY_CODE_HASH_MISMATCH");
  if (o.version !== P8B_REAL_TREASURY_SAFE.version) r.push("SAFE_VERSION_MISMATCH");
  if (o.threshold !== 2) r.push("THRESHOLD_NOT_2");
  const owners = o.owners.map(low).sort().join(",");
  if (o.owners.length !== 3 || owners !== P8B_REAL_TREASURY_SAFE.owners.map(low).sort().join(",")) r.push("OWNERS_NOT_PINNED_SET");
  if (configuredSigners.length !== 3 || owners !== configuredSigners.map(low).sort().join(",")) r.push("OWNERS_NOT_CONFIGURED_SIGNERS");
  if (o.nonce === null || !Number.isInteger(o.nonce)) r.push("NONCE_UNREADABLE");
  return { ...base, status: r.length ? "BLOCKED" : "READY", reasons: r };
}

// ------------------------------------------------------------ dependencies (reuses P8A pinned constants)
export type P9DepStatus = "MATCH" | "HASH_MISMATCH" | "MISSING" | "UNAVAILABLE";
export type P9DepResult = { key: string; label: string; address: string; status: P9DepStatus; observedHash: string | null };
/** observed: undefined = read failed; null/"0x" = no code; otherwise keccak of runtime code. */
export function interpretDependencies(observed: Record<string, string | null | undefined>): { status: "VERIFIED" | "BLOCKED" | "UNAVAILABLE"; items: P9DepResult[] } {
  const items = P8A_MAINNET_DEPENDENCIES.map((d) => {
    const h = observed[d.key];
    const status: P9DepStatus = h === undefined ? "UNAVAILABLE" : !h || h === "0x" ? "MISSING" : low(h) === low(d.codeHash) ? "MATCH" : "HASH_MISMATCH";
    return { key: d.key, label: d.label, address: d.address, status, observedHash: h ?? null };
  });
  const status = items.every((i) => i.status === "MATCH") ? "VERIFIED" : items.some((i) => i.status === "HASH_MISMATCH" || i.status === "MISSING") ? "BLOCKED" : "UNAVAILABLE";
  return { status, items };
}

// ------------------------------------------------------------ auction read model
export type P9AuctionObservation = { startBlock: bigint; endBlock: bigint; currencyRaisedWei: bigint | null; graduated: boolean | null; migrated: boolean | null; unsoldSwept: boolean | null };
export type P9AuctionModel =
  | { status: "NOT_CREATED"; requiredRaiseWei: string }
  | { status: "SCHEDULED" | "OPEN" | "ENDED"; startBlock: string; endBlock: string; currentBlock: string | null; blocksUntilStart: string | null; blocksUntilEnd: string | null; amountRaisedWei: string | null; requiredRaiseWei: string; outcome: "SUCCESS" | "REFUND" | "UNDETERMINED"; migrated: boolean | null; unsoldSwept: boolean | null };

export function auctionReadModel(auctionAddress: string | null, o: P9AuctionObservation | null, currentBlock: string | null): P9AuctionModel {
  const requiredRaiseWei = P9_MIN_RAISE_WEI.toString();
  if (!auctionAddress || !o) return { status: "NOT_CREATED", requiredRaiseWei };
  const cur = currentBlock ? BigInt(currentBlock) : null;
  const status = cur === null ? "SCHEDULED" : cur < o.startBlock ? "SCHEDULED" : cur < o.endBlock ? "OPEN" : "ENDED";
  // Success/refund only from authoritative on-chain graduation state after the auction ended.
  const outcome = status === "ENDED" && o.graduated !== null ? (o.graduated ? "SUCCESS" : "REFUND") : "UNDETERMINED";
  return {
    status, startBlock: o.startBlock.toString(), endBlock: o.endBlock.toString(), currentBlock,
    blocksUntilStart: cur !== null && cur < o.startBlock ? (o.startBlock - cur).toString() : null,
    blocksUntilEnd: cur !== null && cur < o.endBlock ? (o.endBlock - cur).toString() : null,
    amountRaisedWei: o.currencyRaisedWei?.toString() ?? null, requiredRaiseWei, outcome, migrated: o.migrated, unsoldSwept: o.unsoldSwept,
  };
}

// ------------------------------------------------------------ plan validation + block estimation
export type P9PlanValidation = { ok: boolean; error: null | "INVALID_DATE" | "RUNWAY_TOO_SHORT" };
export function validatePlanInput(promotionStartAt: string | null, intendedAuctionStartAt: string | null): P9PlanValidation {
  const p = promotionStartAt ? Date.parse(promotionStartAt) : null;
  const a = intendedAuctionStartAt ? Date.parse(intendedAuctionStartAt) : null;
  if ((p !== null && !Number.isFinite(p)) || (a !== null && !Number.isFinite(a))) return { ok: false, error: "INVALID_DATE" };
  if (p !== null && a !== null && a < p + P9_PROMOTION_MIN_DAYS * DAY_MS) return { ok: false, error: "RUNWAY_TOO_SHORT" };
  return { ok: true, error: null };
}

export type P9BlockEstimate =
  | { available: false; reason: "NO_AUCTION_DATE" | "CHAIN_NOT_LIVE" | "NO_CADENCE" | "START_IN_PAST" }
  | { available: true; label: "ESTIMATED"; estimatedStartBlock: string; estimatedEndBlock: string; estimatedStartAt: string; estimatedEndAt: string; msPerBlock: number; basedOnBlock: string };

export function estimateAuctionBlocks(intendedAuctionStartAt: string | null, chain: P9ChainSnapshot): P9BlockEstimate {
  if (!intendedAuctionStartAt) return { available: false, reason: "NO_AUCTION_DATE" };
  if (chain.status !== "LIVE") return { available: false, reason: "CHAIN_NOT_LIVE" };
  if (!chain.msPerBlock) return { available: false, reason: "NO_CADENCE" };
  const target = Date.parse(intendedAuctionStartAt);
  const headMs = Date.parse(chain.latestBlockAt);
  if (!Number.isFinite(target) || target <= headMs) return { available: false, reason: "START_IN_PAST" };
  const start = BigInt(chain.latestBlock) + BigInt(Math.ceil((target - headMs) / chain.msPerBlock));
  const end = start + BigInt(P8B_DURATION_BLOCKS);
  return {
    available: true, label: "ESTIMATED", estimatedStartBlock: start.toString(), estimatedEndBlock: end.toString(),
    estimatedStartAt: new Date(target).toISOString(), estimatedEndAt: new Date(target + Math.round(P8B_DURATION_BLOCKS * chain.msPerBlock)).toISOString(),
    msPerBlock: chain.msPerBlock, basedOnBlock: chain.latestBlock,
  };
}
