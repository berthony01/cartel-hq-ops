/**
 * PCART P9.3A — auction-side coordinator (pure, deterministic, no I/O).
 * Reuses the reviewed P8B builders (buildPreAuctionSafeTx / buildSweepSafeTx / buildPublicMigrateCall /
 * safeTxHash / liveBlocks) and the P8A/P8B manifests. Contains NO wallet, signing, Safe proposal,
 * Safe execution, migrate or sweep submission capability. P9.3A can only PREPARE a bound record.
 */
import { keccak256, stringToHex } from "viem";

import { P8A_MANIFEST, P8A_MANIFEST_FINGERPRINT, P8A_MANIFEST_VERSION } from "@/lib/pcart-auction-liquidity-plan";
import {
  buildPreAuctionSafeTx, P8B_CODE_HASH_ATTESTATIONS, P8B_DURATION_BLOCKS, P8B_FORK_EVIDENCE, P8B_MANIFEST, P8B_MANIFEST_FINGERPRINT,
  P8B_MANIFEST_VERSION, P8B_REAL_TREASURY_SAFE, p8bCanonicalJson, type P8bBlock, type P8bLiveContext, type P8bPrepared,
} from "@/lib/pcart-auction-execution-p8b";

export const P9_3A_STOP_COPY = "No signing, sending, migrate or sweep is enabled in P9.3A." as const;
export const P9_3_BINDING_VERSION = "pcart-p9-3-action-binding-v1" as const;
export const P9_3_CHAIN_ID = 4663;
const DAY_MS = 86_400_000;
/** Chain head used for authoritative blocks must be at most this old at preparation. */
export const P9_3_FRESH_HEAD_MAX_AGE_MS = 60_000;
/**
 * Minimum lead between preparation and the authoritative start block.
 * Basis: 2 of 3 owners in different time zones must each open the wallet, review and sign (P9.3B), then one
 * owner executes on chain and the coordinator re-attests before the start block. 24h covers one full day
 * cycle for signer availability plus execution and margin. Never moves the date — fails closed.
 */
export const P9_3_MIN_SIGNING_LEAD_MS = 24 * 60 * 60 * 1000;
/** Preparation opens at most this long before the intended start (matches P9.0 runway handoff). */
export const P9_3_PREPARATION_OPENS_BEFORE_MS = 2 * DAY_MS;
/** Owner-confirmed start block may differ from a fresh recomputation by at most this many blocks (~1 min). */
export const P9_3_CONFIRM_TOLERANCE_BLOCKS = 600n;
/** Frozen artifact runtime keccak (pepecartel-token-v1 declares no immutables → deployed runtime is identical). */
export const P9_3_EXPECTED_TOKEN_RUNTIME_KECCAK = P8B_FORK_EVIDENCE.forkTokenArtifact.runtimeKeccak;

const low = (s: string | null | undefined) => String(s ?? "").trim().toLowerCase();

export const ownersFingerprint = (owners: string[]) => keccak256(stringToHex(`pcart-p9-3-owners|${[...owners].map(low).sort().join(",")}`));
export const P9_3_CANONICAL_OWNERS_FINGERPRINT = ownersFingerprint([...P8B_REAL_TREASURY_SAFE.owners]);

/** Fingerprint over every pinned P8B code hash as observed live. Null unless every key is present. */
export function dependencyFingerprintP93(observed: Record<string, string | null | undefined>): `0x${string}` | null {
  const parts: string[] = [];
  for (const a of P8B_CODE_HASH_ATTESTATIONS) {
    const h = low(observed[a.key]);
    if (!/^0x[0-9a-f]{64}$/.test(h)) return null;
    parts.push(`${a.key}=${h}`);
  }
  return keccak256(stringToHex(`pcart-p9-3-deps|${parts.join("|")}`));
}
export const P9_3_PINNED_DEPENDENCY_FINGERPRINT = dependencyFingerprintP93(Object.fromEntries(P8B_CODE_HASH_ATTESTATIONS.map((a) => [a.key, a.codeHash])))!;

/** Ordered call batch fingerprint (target/value/data/operation per child + outer Safe call). */
export function callBatchFingerprint(p: P8bPrepared): `0x${string}` {
  const children = p.childCalls.map((c) => ({ order: c.order, target: low(c.target), value: c.value.toString(), data: low(c.data), operation: 0 }));
  const outer = { target: low(p.call.target), value: p.call.value.toString(), dataKeccak: low(p.call.dataKeccak), operation: p.safeTx?.operation ?? 0 };
  return keccak256(stringToHex(`pcart-p9-3-batch|${p8bCanonicalJson({ children, outer })}`));
}

// ------------------------------------------------------------ authoritative block selection
export type FreshHead = { chainId: number; block: bigint; timestampSec: number; capturedAtMs: number; msPerBlock: number | null };
export type AuthoritativeBlocks =
  | { ok: true; startBlock: bigint; endBlock: bigint; headBlock: bigint; headCapturedAtMs: number; estimatedStartMs: number }
  | { ok: false; reason: "WRONG_CHAIN" | "HEAD_NOT_FRESH" | "NO_CADENCE" | "NO_PLAN" | "START_TOO_SOON_FOR_SIGNING" | "PREPARATION_NOT_OPEN" | "RUNWAY_TOO_SHORT" };

/** Exact start/end only from a FRESH head read. Estimates are never accepted as input. */
export function computeAuthoritativeBlocks(i: { head: FreshHead | null; nowMs: number; promotionStartAt: string | null; intendedAuctionStartAt: string | null }): AuthoritativeBlocks {
  if (!i.promotionStartAt || !i.intendedAuctionStartAt) return { ok: false, reason: "NO_PLAN" };
  const p = Date.parse(i.promotionStartAt), a = Date.parse(i.intendedAuctionStartAt);
  if (!Number.isFinite(p) || !Number.isFinite(a) || a < p + P8A_MANIFEST.timeline.promotionMinDays * DAY_MS) return { ok: false, reason: "RUNWAY_TOO_SHORT" };
  const h = i.head;
  if (!h) return { ok: false, reason: "HEAD_NOT_FRESH" };
  if (h.chainId !== P9_3_CHAIN_ID) return { ok: false, reason: "WRONG_CHAIN" };
  if (i.nowMs - h.capturedAtMs > P9_3_FRESH_HEAD_MAX_AGE_MS || i.nowMs - h.timestampSec * 1000 > P9_3_FRESH_HEAD_MAX_AGE_MS * 2) return { ok: false, reason: "HEAD_NOT_FRESH" };
  if (!h.msPerBlock || !Number.isFinite(h.msPerBlock) || h.msPerBlock <= 0) return { ok: false, reason: "NO_CADENCE" };
  if (a - i.nowMs > P9_3_PREPARATION_OPENS_BEFORE_MS) return { ok: false, reason: "PREPARATION_NOT_OPEN" };
  if (a - i.nowMs < P9_3_MIN_SIGNING_LEAD_MS) return { ok: false, reason: "START_TOO_SOON_FOR_SIGNING" };
  const startBlock = h.block + BigInt(Math.ceil((a - h.timestampSec * 1000) / h.msPerBlock));
  return { ok: true, startBlock, endBlock: startBlock + BigInt(P8B_DURATION_BLOCKS), headBlock: h.block, headCapturedAtMs: h.capturedAtMs, estimatedStartMs: a };
}

// ------------------------------------------------------------ preparation gate (fail closed)
export type P93PolicyRef = { status: "CURRENT" | string; reviewId: string | null; manifestVersion: string | null; manifestFingerprint: string | null };
export type P93PrepareFacts = {
  nowMs: number;
  launchId: string;
  launchStatus: string | null;
  officialTokenAddress: string | null;
  deploymentFinalized: boolean;
  tokenRuntimeKeccak: string | null;
  plan: { promotionStartAt: string | null; intendedAuctionStartAt: string | null } | null;
  p8a: P93PolicyRef;
  p8b: P93PolicyRef;
  observedCodeHashes: Record<string, string | null | undefined>;
  safe: { address: string; version: string | null; threshold: number | null; owners: string[]; nonce: number | null; codeHash: string | null } | null;
  control: { executionEnabled: boolean; emergencyStopEngaged: boolean } | null;
  head: FreshHead | null;
  uncertainTransaction: boolean;
  existingOpenAction: boolean;
  /** Owner explicitly reviewed these exact blocks (from a preview). */
  ownerConfirmedStartBlock: string | null;
};

export type P93PrepareBlock =
  | "CONTROLS_NOT_PROTECTED" | "UNCERTAIN_TRANSACTION" | "OFFICIAL_TOKEN_MISSING" | "TOKEN_RUNTIME_MISMATCH" | "PLAN_INVALID"
  | "P8A_NOT_CURRENT" | "P8B_NOT_CURRENT" | "DEPENDENCY_MISMATCH" | "SAFE_MISMATCH" | "SAFE_THRESHOLD_NOT_2" | "SAFE_NONCE_UNAVAILABLE"
  | "OWNER_CONFIRMATION_REQUIRED" | "CONFIRMED_BLOCK_DRIFTED" | "ACTION_ALREADY_OPEN"
  | Exclude<AuthoritativeBlocks, { ok: true }>["reason"] | P8bBlock;

export type P93PrepareResult =
  | { ok: true; blocks: Extract<AuthoritativeBlocks, { ok: true }>; prepared: P8bPrepared; binding: P93Binding; bindingFingerprint: `0x${string}` }
  | { ok: false; blocks: P93PrepareBlock[]; preview: Extract<AuthoritativeBlocks, { ok: true }> | null };

export type P93Binding = {
  bindingVersion: typeof P9_3_BINDING_VERSION; actionKind: "PREAUCTION_SETUP"; launchId: string; chainId: number;
  officialTokenAddress: string; officialTokenCodeHash: string;
  p8aReviewId: string; p8aManifestVersion: string; p8aManifestFingerprint: string;
  p8bReviewId: string; p8bManifestVersion: string; p8bManifestFingerprint: string;
  dependencyAttestationFingerprint: string; safeAddress: string; safeOwnersFingerprint: string; safeThreshold: 2; safeNonce: number;
  promotionStartAt: string; intendedAuctionStartAt: string; authoritativeStartBlock: string; endBlock: string; permit2Expiration: string;
  callBatchFingerprint: string; safeTxTarget: string; safeTxOperation: 0 | 1; safeTxDataKeccak: string; safeTxHash: string;
  chainHeadBlock: string; chainHeadCapturedAt: string;
};
export const bindingFingerprint = (b: P93Binding) => keccak256(stringToHex(`pcart-p9-3-binding|${p8bCanonicalJson(b)}`));

export function preparePreAuction(f: P93PrepareFacts): P93PrepareResult {
  const b: P93PrepareBlock[] = [];
  if (!f.control || f.control.executionEnabled !== false || f.control.emergencyStopEngaged !== true) b.push("CONTROLS_NOT_PROTECTED");
  if (f.uncertainTransaction) b.push("UNCERTAIN_TRANSACTION");
  if (f.existingOpenAction) b.push("ACTION_ALREADY_OPEN");
  const tok = low(f.officialTokenAddress);
  if (!/^0x[0-9a-f]{40}$/.test(tok)) b.push("OFFICIAL_TOKEN_MISSING");
  else if (low(f.tokenRuntimeKeccak) !== low(P9_3_EXPECTED_TOKEN_RUNTIME_KECCAK)) b.push("TOKEN_RUNTIME_MISMATCH");
  const pa = f.p8a, pb = f.p8b;
  if (pa.status !== "CURRENT" || !pa.reviewId || pa.manifestVersion !== P8A_MANIFEST_VERSION || low(pa.manifestFingerprint) !== low(P8A_MANIFEST_FINGERPRINT)) b.push("P8A_NOT_CURRENT");
  if (pb.status !== "CURRENT" || !pb.reviewId || pb.manifestVersion !== P8B_MANIFEST_VERSION || low(pb.manifestFingerprint) !== low(P8B_MANIFEST_FINGERPRINT)) b.push("P8B_NOT_CURRENT");
  const depFp = dependencyFingerprintP93(f.observedCodeHashes);
  if (!depFp || depFp !== P9_3_PINNED_DEPENDENCY_FINGERPRINT) b.push("DEPENDENCY_MISMATCH");
  const s = f.safe;
  if (!s || low(s.address) !== low(P8B_REAL_TREASURY_SAFE.address) || s.version !== "1.4.1" || ownersFingerprint(s.owners) !== P9_3_CANONICAL_OWNERS_FINGERPRINT || s.owners.length !== 3) b.push("SAFE_MISMATCH");
  if (!s || s.threshold !== 2) b.push("SAFE_THRESHOLD_NOT_2");
  if (!s || s.nonce === null || !Number.isInteger(s.nonce) || s.nonce < 0) b.push("SAFE_NONCE_UNAVAILABLE");
  const plan = f.plan;
  if (!plan?.promotionStartAt || !plan.intendedAuctionStartAt) b.push("PLAN_INVALID");
  const ab = computeAuthoritativeBlocks({ head: f.head, nowMs: f.nowMs, promotionStartAt: plan?.promotionStartAt ?? null, intendedAuctionStartAt: plan?.intendedAuctionStartAt ?? null });
  if (!ab.ok) b.push(ab.reason);
  const preview = ab.ok ? ab : null;
  if (ab.ok) {
    if (!f.ownerConfirmedStartBlock || !/^\d+$/.test(f.ownerConfirmedStartBlock)) b.push("OWNER_CONFIRMATION_REQUIRED");
    else {
      const d = BigInt(f.ownerConfirmedStartBlock) - ab.startBlock;
      if ((d < 0n ? -d : d) > P9_3_CONFIRM_TOLERANCE_BLOCKS) b.push("CONFIRMED_BLOCK_DRIFTED");
    }
  }
  if (b.length) return { ok: false, blocks: [...new Set(b)], preview };
  const ok = ab as Extract<AuthoritativeBlocks, { ok: true }>;
  // The owner-confirmed block is authoritative (within tolerance of a fresh recomputation); end derives from P8B duration.
  const startBlock = BigInt(f.ownerConfirmedStartBlock!);
  const endBlock = startBlock + BigInt(P8B_DURATION_BLOCKS);
  const permit2Expiration = BigInt(Math.floor(Date.parse(plan!.intendedAuctionStartAt!) / 1000));
  const live: P8bLiveContext = {
    chainId: f.head!.chainId, nowMs: f.nowMs, launchStatus: f.launchStatus, officialTokenAddress: tok, officialRegistered: !!tok, deploymentFinalized: f.deploymentFinalized,
    // Policy freshness is manifest-based (P9.0); attestation-expiry fields are not a gate.
    p8aReview: { manifestVersion: pa.manifestVersion!, manifestFingerprint: pa.manifestFingerprint!, expiresAtMs: Number.MAX_SAFE_INTEGER },
    p8bReview: { manifestVersion: pb.manifestVersion!, manifestFingerprint: pb.manifestFingerprint!, expiresAtMs: Number.MAX_SAFE_INTEGER },
    observedCodeHashes: f.observedCodeHashes,
    safe: { address: s!.address, version: s!.version!, threshold: s!.threshold!, owners: s!.owners, nonce: s!.nonce!, codeHash: s!.codeHash ?? "" },
  };
  const built = buildPreAuctionSafeTx({
    mode: "LIVE", tokenAddress: tok, safeAddress: P8B_REAL_TREASURY_SAFE.address, safeNonce: s!.nonce!, startBlock, permit2Expiration, live,
    schedule: { promotionStartMs: Date.parse(plan!.promotionStartAt!), intendedStartMs: Date.parse(plan!.intendedAuctionStartAt!), ownerConfirmed: true },
  });
  if (!built.ok) return { ok: false, blocks: built.blocks, preview };
  const p = built.prepared;
  const binding: P93Binding = {
    bindingVersion: P9_3_BINDING_VERSION, actionKind: "PREAUCTION_SETUP", launchId: f.launchId, chainId: P9_3_CHAIN_ID,
    officialTokenAddress: tok, officialTokenCodeHash: low(f.tokenRuntimeKeccak),
    p8aReviewId: pa.reviewId!, p8aManifestVersion: pa.manifestVersion!, p8aManifestFingerprint: low(pa.manifestFingerprint),
    p8bReviewId: pb.reviewId!, p8bManifestVersion: pb.manifestVersion!, p8bManifestFingerprint: low(pb.manifestFingerprint),
    dependencyAttestationFingerprint: depFp!, safeAddress: low(P8B_REAL_TREASURY_SAFE.address), safeOwnersFingerprint: P9_3_CANONICAL_OWNERS_FINGERPRINT, safeThreshold: 2, safeNonce: s!.nonce!,
    promotionStartAt: new Date(plan!.promotionStartAt!).toISOString(), intendedAuctionStartAt: new Date(plan!.intendedAuctionStartAt!).toISOString(),
    authoritativeStartBlock: startBlock.toString(), endBlock: endBlock.toString(), permit2Expiration: permit2Expiration.toString(),
    callBatchFingerprint: callBatchFingerprint(p), safeTxTarget: low(p.call.target), safeTxOperation: (p.safeTx?.operation ?? 1) as 0 | 1,
    safeTxDataKeccak: low(p.call.dataKeccak), safeTxHash: low(p.safeTxHash),
    chainHeadBlock: ok.headBlock.toString(), chainHeadCapturedAt: new Date(ok.headCapturedAtMs).toISOString(),
  };
  return { ok: true, blocks: { ...ok, startBlock, endBlock }, prepared: p, binding, bindingFingerprint: bindingFingerprint(binding) };
}

// ------------------------------------------------------------ staleness (derived; never auto re-prepared)
export type P93StoredAction = {
  id: string; actionKind: "PREAUCTION_SETUP" | "POST_AUCTION_SWEEP"; status: string; statusReason: string | null;
  officialTokenAddress: string; officialTokenCodeHash: string; p8aReviewId: string; p8aManifestFingerprint: string; p8bReviewId: string; p8bManifestFingerprint: string;
  dependencyAttestationFingerprint: string; safeOwnersFingerprint: string; safeThreshold: number; safeNonce: number;
  promotionStartAt: string | null; intendedAuctionStartAt: string | null; authoritativeStartBlock: string | null; endBlock: string | null;
  safeTxHash: string; preparedAt: string;
};
export type P93CurrentFacts = {
  officialTokenAddress: string | null; tokenRuntimeKeccak: string | null; p8a: P93PolicyRef; p8b: P93PolicyRef;
  dependencyFingerprint: string | null; safeOwnersFingerprint: string | null; safeThreshold: number | null; safeNonce: number | null;
  plan: { promotionStartAt: string | null; intendedAuctionStartAt: string | null } | null;
};
export type P93StaleReason = "TOKEN_CHANGED" | "TOKEN_RUNTIME_CHANGED" | "P8A_CHANGED" | "P8B_CHANGED" | "DEPENDENCY_CHANGED" | "SAFE_OWNERS_CHANGED" | "SAFE_THRESHOLD_CHANGED" | "SAFE_NONCE_CHANGED" | "PLAN_CHANGED" | "FACTS_UNAVAILABLE";

const sameTime = (a: string | null | undefined, b: string | null | undefined) => (a == null && b == null) || (a != null && b != null && Date.parse(a) === Date.parse(b));

export function staleReasons(a: P93StoredAction, c: P93CurrentFacts): P93StaleReason[] {
  const r: P93StaleReason[] = [];
  if (low(c.officialTokenAddress) !== low(a.officialTokenAddress)) r.push("TOKEN_CHANGED");
  if (c.tokenRuntimeKeccak == null) r.push("FACTS_UNAVAILABLE");
  else if (low(c.tokenRuntimeKeccak) !== low(a.officialTokenCodeHash)) r.push("TOKEN_RUNTIME_CHANGED");
  if (c.p8a.status !== "CURRENT" || c.p8a.reviewId !== a.p8aReviewId || low(c.p8a.manifestFingerprint) !== low(a.p8aManifestFingerprint)) r.push("P8A_CHANGED");
  if (c.p8b.status !== "CURRENT" || c.p8b.reviewId !== a.p8bReviewId || low(c.p8b.manifestFingerprint) !== low(a.p8bManifestFingerprint)) r.push("P8B_CHANGED");
  if (c.dependencyFingerprint == null) { if (!r.includes("FACTS_UNAVAILABLE")) r.push("FACTS_UNAVAILABLE"); }
  else if (low(c.dependencyFingerprint) !== low(a.dependencyAttestationFingerprint)) r.push("DEPENDENCY_CHANGED");
  if (c.safeOwnersFingerprint !== null && low(c.safeOwnersFingerprint) !== low(a.safeOwnersFingerprint)) r.push("SAFE_OWNERS_CHANGED");
  if (c.safeThreshold !== null && c.safeThreshold !== a.safeThreshold) r.push("SAFE_THRESHOLD_CHANGED");
  if (c.safeNonce === null) { if (!r.includes("FACTS_UNAVAILABLE")) r.push("FACTS_UNAVAILABLE"); }
  else if (c.safeNonce !== a.safeNonce) r.push("SAFE_NONCE_CHANGED");
  if (a.actionKind === "PREAUCTION_SETUP" && (!sameTime(c.plan?.promotionStartAt, a.promotionStartAt) || !sameTime(c.plan?.intendedAuctionStartAt, a.intendedAuctionStartAt))) r.push("PLAN_CHANGED");
  return r;
}

/** Effective status: a stored PREPARED action with any mismatch is shown STALE (DB triggers also persist plan/policy/token stales). */
export function effectiveActionStatus(a: P93StoredAction, c: P93CurrentFacts): { status: string; reasons: P93StaleReason[] } {
  // P9.3B: every pre-execution status (PREPARED / AWAITING_SIGNATURES / READY) is staled by any binding change.
  if (a.status !== "PREPARED" && a.status !== "AWAITING_SIGNATURES" && a.status !== "READY") return { status: a.status, reasons: [] };
  const r = staleReasons(a, c);
  return r.length ? { status: "STALE", reasons: r } : { status: a.status, reasons: [] };
}

// ------------------------------------------------------------ sweep disposition (P8B: explicit Safe sweep)
/** P8B proves unsold PCART is NOT returned automatically: Auction.sweepUnsoldTokens() is Safe-only (modes.unsold). */
export const P9_3_SWEEP_DISPOSITION: "SAFE_SWEEP_REQUIRED" | "NO_MANUAL_SWEEP_REQUIRED" =
  P8B_MANIFEST.modes.unsold === "SAFE_SWEEP_UNSOLD_TOKENS" ? "SAFE_SWEEP_REQUIRED" : "NO_MANUAL_SWEEP_REQUIRED";

export type P93SweepGate =
  | { ok: true; unsoldAmount: bigint }
  | { ok: false; reason: "NO_MANUAL_SWEEP_REQUIRED" | "AUCTION_NOT_CREATED" | "AUCTION_NOT_ENDED" | "OUTCOME_UNDETERMINED" | "MIGRATION_NOT_CONFIRMED" | "UNSOLD_AMOUNT_UNAVAILABLE" | "UNCERTAIN_TRANSACTION" };

/**
 * Exact unsold amount is derived only from authoritative chain reads:
 *   graduated → auctionInventory − totalCleared;  not graduated → full auctionInventory.
 * Never an estimate. Success additionally requires migration confirmed (P8B: settlement happens in migrate()).
 */
export function sweepGate(i: { disposition?: typeof P9_3_SWEEP_DISPOSITION; auction: P93AuctionModel; migrationConfirmed: boolean | null; totalClearedWei: bigint | null; uncertainTransaction: boolean }): P93SweepGate {
  if ((i.disposition ?? P9_3_SWEEP_DISPOSITION) === "NO_MANUAL_SWEEP_REQUIRED") return { ok: false, reason: "NO_MANUAL_SWEEP_REQUIRED" };
  if (i.uncertainTransaction) return { ok: false, reason: "UNCERTAIN_TRANSACTION" };
  if (i.auction.status === "NOT_CREATED" || i.auction.status === "UNAVAILABLE") return { ok: false, reason: "AUCTION_NOT_CREATED" };
  if (i.auction.status !== "ENDED") return { ok: false, reason: "AUCTION_NOT_ENDED" };
  if (i.auction.outcome === "UNDETERMINED") return { ok: false, reason: "OUTCOME_UNDETERMINED" };
  if (i.migrationConfirmed !== true) return { ok: false, reason: "MIGRATION_NOT_CONFIRMED" };
  if (i.auction.outcome === "REFUND") return { ok: true, unsoldAmount: P8A_MANIFEST.auctionAllocation };
  if (i.totalClearedWei == null || i.totalClearedWei < 0n || i.totalClearedWei > P8A_MANIFEST.auctionAllocation) return { ok: false, reason: "UNSOLD_AMOUNT_UNAVAILABLE" };
  return { ok: true, unsoldAmount: P8A_MANIFEST.auctionAllocation - i.totalClearedWei };
}

// ------------------------------------------------------------ auction read model (P8B-rehearsed views only)
export type P93AuctionObservation = {
  ok: true; endBlock: bigint; currencyRaisedWei: bigint; isGraduated: boolean; totalClearedWei: bigint; clearingPriceQ96: bigint;
  tokensRecipient: string; fundsRecipient: string; capturedAt: string;
} | { ok: false; capturedAt: string };
export type P93AuctionModel =
  | { status: "NOT_CREATED" }
  | { status: "UNAVAILABLE"; reason: string }
  | { status: "NOT_STARTED" | "OPEN" | "ENDED"; startBlock: string; endBlock: string; currentBlock: string; amountRaisedWei: string; meetsMinimumRaise: boolean;
      soldWei: string | null; remainingWei: string | null; outcome: "SUCCESS" | "REFUND" | "UNDETERMINED"; migrateEligible: boolean; refundEligible: boolean; capturedAt: string };

/**
 * Authoritative auction model. Start block comes from the bound (confirmed) action; end block must match the
 * contract's endBlock(). Outcome only after the end block, from isGraduated(); never from elapsed time.
 */
export function auctionModel(i: { auctionAddress: string | null; boundStartBlock: string | null; boundEndBlock: string | null; currentBlock: string | null; obs: P93AuctionObservation | null }): P93AuctionModel {
  if (!i.auctionAddress) return { status: "NOT_CREATED" };
  if (!i.obs || !i.obs.ok) return { status: "UNAVAILABLE", reason: "AUCTION_READ_FAILED" };
  if (!i.currentBlock || !i.boundStartBlock || !i.boundEndBlock) return { status: "UNAVAILABLE", reason: "BLOCK_CONTEXT_MISSING" };
  const o = i.obs;
  if (o.endBlock.toString() !== i.boundEndBlock || BigInt(i.boundEndBlock) - BigInt(i.boundStartBlock) !== BigInt(P8B_DURATION_BLOCKS)) return { status: "UNAVAILABLE", reason: "END_BLOCK_MISMATCH" };
  if (low(o.tokensRecipient) !== low(P8B_REAL_TREASURY_SAFE.address)) return { status: "UNAVAILABLE", reason: "TOKENS_RECIPIENT_MISMATCH" };
  const cur = BigInt(i.currentBlock), start = BigInt(i.boundStartBlock), end = o.endBlock;
  const status = cur < start ? "NOT_STARTED" : cur < end ? "OPEN" : "ENDED";
  const meets = o.currencyRaisedWei >= P8A_MANIFEST.floorWei;
  const outcome = status === "ENDED" ? (o.isGraduated ? "SUCCESS" : "REFUND") : "UNDETERMINED";
  const sold = o.isGraduated ? o.totalClearedWei : null;
  return {
    status, startBlock: start.toString(), endBlock: end.toString(), currentBlock: cur.toString(), amountRaisedWei: o.currencyRaisedWei.toString(), meetsMinimumRaise: meets,
    soldWei: sold?.toString() ?? null, remainingWei: sold !== null ? (P8A_MANIFEST.auctionAllocation - sold).toString() : null,
    outcome, migrateEligible: status === "ENDED" && cur >= end + 1n, refundEligible: outcome === "REFUND", capturedAt: o.capturedAt,
  };
}

// ------------------------------------------------------------ auction-segment state (exactly one)
export const P93_STATES = [
  "BLOCKED_UNCERTAIN_TRANSACTION", "BLOCKED_POLICY_STALE", "BLOCKED_DEPENDENCY_MISMATCH", "BLOCKED_SAFE_MISMATCH", "BLOCKED_STALE_NONCE",
  "BLOCKED_PLAN_INVALID", "BLOCKED_OFFICIAL_TOKEN_MISSING", "BLOCKED_AUCTION_UNREADABLE",
  "OFFICIAL_CONTRACT_REQUIRED", "PROMOTION_PLAN_REQUIRED", "PROMOTION_RUNWAY_PENDING", "READY_FOR_PREAUCTION_REVIEW", "READY_FOR_PREAUCTION_SAFE_PREP",
  "PREAUCTION_SAFE_PREPARED", "PREAUCTION_SAFE_STALE",
  "PREAUCTION_SAFE_AWAITING_SIGNATURES", "PREAUCTION_SAFE_READY_TO_EXECUTE", "PREAUCTION_SAFE_EXECUTION_SUBMITTED", "PREAUCTION_SAFE_EXECUTION_UNCERTAIN",
  "WAITING_FOR_AUCTION_START", "AUCTION_OPEN", "AUCTION_ENDED_PENDING_OUTCOME", "AUCTION_FAILED_REFUND_AVAILABLE", "AUCTION_SUCCEEDED_READY_TO_MIGRATE",
  "MIGRATION_CONFIRMED", "READY_FOR_SWEEP_SAFE_PREP", "SWEEP_SAFE_PREPARED", "SWEEP_CONFIRMED", "LAUNCH_COMPLETE",
] as const;
export type P93State = (typeof P93_STATES)[number];

export type P93SegmentInput = {
  nowMs: number;
  officialRegistered: boolean;
  plan: { promotionStartAt: string | null; intendedAuctionStartAt: string | null } | null;
  p8aCurrent: boolean; p8bCurrent: boolean; dependenciesVerified: boolean; safeReady: boolean;
  uncertainTransaction: boolean;
  preAuction: { status: string; reasons: P93StaleReason[] } | null;
  /** Chain-verified facts (all null/false until P9.3B/C evidence exists). */
  preAuctionConfirmed: boolean;
  auction: P93AuctionModel;
  migrationConfirmed: boolean | null;
  sweepAction: { status: string } | null;
  sweepConfirmed: boolean;
};
export type P93Segment = { state: P93State; nextStep: string; blockers: string[]; canPrepare: boolean; liveActionEnabled: false };

const NEXT3: Record<P93State, string> = {
  BLOCKED_UNCERTAIN_TRANSACTION: "A transaction outcome is uncertain. Resolve it from chain evidence before anything else — never resend.",
  BLOCKED_POLICY_STALE: "A P8A/P8B approval no longer matches the pinned plan. Re-review it.",
  BLOCKED_DEPENDENCY_MISMATCH: "A pinned auction contract no longer matches. Stop and investigate.",
  BLOCKED_SAFE_MISMATCH: "Treasury Safe owners/threshold/version do not match the verified Safe. Stop and investigate.",
  BLOCKED_STALE_NONCE: "The Treasury Safe nonce moved since preparation. Cancel and prepare again.",
  BLOCKED_PLAN_INVALID: "The launch plan is invalid (needs ≥21 days between promotion and auction).",
  BLOCKED_OFFICIAL_TOKEN_MISSING: "Official PCART is missing or its code does not match the frozen artifact.",
  BLOCKED_AUCTION_UNREADABLE: "Auction state could not be read or does not match the bound action. Nothing is assumed.",
  OFFICIAL_CONTRACT_REQUIRED: "Auction phase not ready yet. Finish official PCART deployment and registration first.",
  PROMOTION_PLAN_REQUIRED: "Set the promotion start and an auction start at least 21 days later.",
  PROMOTION_RUNWAY_PENDING: "Promote the launch. Pre-auction preparation opens 48 hours before the intended start.",
  READY_FOR_PREAUCTION_REVIEW: "Review the exact authoritative auction start and end blocks from a fresh chain read.",
  READY_FOR_PREAUCTION_SAFE_PREP: "Prepare the pre-auction Safe transaction (record only — nothing is signed or sent).",
  PREAUCTION_SAFE_PREPARED: "Prepared. Owner signing arrives in P9.3B.",
  PREAUCTION_SAFE_STALE: "The prepared transaction is stale. Cancel it and prepare again.",
  PREAUCTION_SAFE_AWAITING_SIGNATURES: "Collect 2 of 3 owner signatures (P9.3B).",
  PREAUCTION_SAFE_READY_TO_EXECUTE: "Execute the Safe transaction from an owner wallet (P9.3B).",
  PREAUCTION_SAFE_EXECUTION_SUBMITTED: "Wait for on-chain confirmation.",
  PREAUCTION_SAFE_EXECUTION_UNCERTAIN: "Execution outcome uncertain. Reconcile from chain — never resend.",
  WAITING_FOR_AUCTION_START: "Waiting for the auction start block. It starts on-chain by itself.",
  AUCTION_OPEN: "Auction is open. Nothing to sign — monitor progress.",
  AUCTION_ENDED_PENDING_OUTCOME: "Auction ended. Waiting for authoritative outcome.",
  AUCTION_FAILED_REFUND_AVAILABLE: "Minimum raise not met. Bidders claim refunds themselves; then sweep PCART back to the Treasury Safe.",
  AUCTION_SUCCEEDED_READY_TO_MIGRATE: "Auction succeeded. Public migrate() is next (P9.3C).",
  MIGRATION_CONFIRMED: "Migration confirmed. Verify pool, liquidity and Treasury amounts.",
  READY_FOR_SWEEP_SAFE_PREP: "Prepare the unsold-token sweep (exact amount from chain; P9.3C).",
  SWEEP_SAFE_PREPARED: "Sweep prepared. Owner signing arrives in P9.3C.",
  SWEEP_CONFIRMED: "Sweep confirmed. Final verification.",
  LAUNCH_COMPLETE: "Launch complete.",
};

export function deriveAuctionSegment(s: P93SegmentInput): P93Segment {
  const blockers: string[] = [];
  const out = (state: P93State, canPrepare = false): P93Segment => ({ state, nextStep: NEXT3[state], blockers, canPrepare, liveActionEnabled: false });
  if (s.uncertainTransaction || s.preAuction?.status === "UNCERTAIN") { blockers.push("UNCERTAIN_TRANSACTION"); return out(s.preAuction?.status === "UNCERTAIN" ? "PREAUCTION_SAFE_EXECUTION_UNCERTAIN" : "BLOCKED_UNCERTAIN_TRANSACTION"); }
  if (!s.officialRegistered) return out("OFFICIAL_CONTRACT_REQUIRED");
  if (!s.p8aCurrent || !s.p8bCurrent) { blockers.push("POLICY_STALE"); return out("BLOCKED_POLICY_STALE"); }
  if (!s.dependenciesVerified) { blockers.push("DEPENDENCY_MISMATCH"); return out("BLOCKED_DEPENDENCY_MISMATCH"); }
  if (!s.safeReady) { blockers.push("SAFE_MISMATCH"); return out("BLOCKED_SAFE_MISMATCH"); }

  if (s.preAuctionConfirmed) {
    const a = s.auction;
    if (a.status === "NOT_CREATED" || a.status === "UNAVAILABLE") { blockers.push("AUCTION_UNREADABLE"); return out("BLOCKED_AUCTION_UNREADABLE"); }
    if (a.status === "NOT_STARTED") return out("WAITING_FOR_AUCTION_START");
    if (a.status === "OPEN") return out("AUCTION_OPEN");
    if (a.outcome === "UNDETERMINED") return out("AUCTION_ENDED_PENDING_OUTCOME");
    if (a.outcome === "SUCCESS" && s.migrationConfirmed !== true) return out("AUCTION_SUCCEEDED_READY_TO_MIGRATE");
    if (s.sweepConfirmed) return out(s.migrationConfirmed === true ? "LAUNCH_COMPLETE" : "SWEEP_CONFIRMED");
    if (s.sweepAction?.status === "PREPARED") return out("SWEEP_SAFE_PREPARED");
    if (a.outcome === "REFUND" && s.migrationConfirmed !== true) return out("AUCTION_FAILED_REFUND_AVAILABLE");
    return out(a.outcome === "SUCCESS" ? "MIGRATION_CONFIRMED" : "READY_FOR_SWEEP_SAFE_PREP");
  }

  const pa = s.preAuction;
  if (pa) {
    if (pa.status === "STALE") return out(pa.reasons.includes("SAFE_NONCE_CHANGED") ? "BLOCKED_STALE_NONCE" : "PREAUCTION_SAFE_STALE");
    if (pa.status === "PREPARED") return out("PREAUCTION_SAFE_PREPARED");
    if (pa.status === "AWAITING_SIGNATURES") return out("PREAUCTION_SAFE_AWAITING_SIGNATURES");
    if (pa.status === "READY") return out("PREAUCTION_SAFE_READY_TO_EXECUTE");
    if (pa.status === "SUBMITTED") return out("PREAUCTION_SAFE_EXECUTION_SUBMITTED");
  }
  const p = s.plan;
  if (!p?.promotionStartAt || !p.intendedAuctionStartAt) return out("PROMOTION_PLAN_REQUIRED");
  const ps = Date.parse(p.promotionStartAt), as = Date.parse(p.intendedAuctionStartAt);
  if (!Number.isFinite(ps) || !Number.isFinite(as) || as < ps + P8A_MANIFEST.timeline.promotionMinDays * DAY_MS) { blockers.push("PLAN_INVALID"); return out("BLOCKED_PLAN_INVALID"); }
  if (as - s.nowMs > P9_3_PREPARATION_OPENS_BEFORE_MS) return out("PROMOTION_RUNWAY_PENDING");
  if (as - s.nowMs < P9_3_MIN_SIGNING_LEAD_MS) { blockers.push("START_TOO_SOON_FOR_SIGNING"); return out("BLOCKED_PLAN_INVALID"); }
  return out("READY_FOR_PREAUCTION_REVIEW", true);
}

export type P93Step = { key: string; label: string; status: "DONE" | "CURRENT" | "LATER" | "BLOCKED" };
export function auctionSteps(seg: P93Segment): P93Step[] {
  const order = ["Promotion runway", "Pre-auction Safe", "Auction", "Migration / refunds", "Final Treasury cleanup"];
  const idx: Partial<Record<P93State, number>> = {
    OFFICIAL_CONTRACT_REQUIRED: 0, PROMOTION_PLAN_REQUIRED: 0, PROMOTION_RUNWAY_PENDING: 0, BLOCKED_PLAN_INVALID: 0,
    READY_FOR_PREAUCTION_REVIEW: 1, READY_FOR_PREAUCTION_SAFE_PREP: 1, PREAUCTION_SAFE_PREPARED: 1, PREAUCTION_SAFE_STALE: 1, BLOCKED_STALE_NONCE: 1,
    PREAUCTION_SAFE_AWAITING_SIGNATURES: 1, PREAUCTION_SAFE_READY_TO_EXECUTE: 1, PREAUCTION_SAFE_EXECUTION_SUBMITTED: 1, PREAUCTION_SAFE_EXECUTION_UNCERTAIN: 1,
    WAITING_FOR_AUCTION_START: 2, AUCTION_OPEN: 2, AUCTION_ENDED_PENDING_OUTCOME: 2, BLOCKED_AUCTION_UNREADABLE: 2,
    AUCTION_SUCCEEDED_READY_TO_MIGRATE: 3, AUCTION_FAILED_REFUND_AVAILABLE: 3, MIGRATION_CONFIRMED: 3,
    READY_FOR_SWEEP_SAFE_PREP: 4, SWEEP_SAFE_PREPARED: 4, SWEEP_CONFIRMED: 4, LAUNCH_COMPLETE: 5,
  };
  const cur = idx[seg.state] ?? 0;
  const blocked = seg.state.startsWith("BLOCKED");
  return order.map((label, i) => ({ key: String(i), label, status: i < cur ? "DONE" : i === cur ? (blocked ? "BLOCKED" : "CURRENT") : "LATER" }));
}
