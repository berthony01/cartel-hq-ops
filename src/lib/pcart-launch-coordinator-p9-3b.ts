/**
 * PCART P9.3B — Treasury Safe 2-of-3 signatures + permit-bound pre-auction execution (pure, no I/O).
 *
 * Reuses the P8B builder (buildPreAuctionSafeTx + safeTxHash) to reconstruct the exact bound SafeTx.
 * Signature policy:
 *  - plain EOA owners (eth_getCode = 0x): standard 65-byte ECDSA (v 27/28) over the exact safeTxHash only;
 *  - EIP-7702 delegated EOA owners (code = 0xef0100 ‖ delegate): accepted ONLY with the same standard ECDSA
 *    signature recovering exactly that owner, and only after the Safe's own checkSignatures accepts the set;
 *  - any other contract owner, ERC-1271 / ERC-6492 / wrapped smart-account signature: rejected.
 * No wallet, RPC, DB or signing here.
 */
import { concat, hashTypedData, keccak256, recoverAddress, stringToHex, toEventSelector, type Hex } from "viem";

import { P8A_MANIFEST_FINGERPRINT, P8A_MANIFEST_VERSION } from "@/lib/pcart-auction-liquidity-plan";
import {
  buildPreAuctionSafeTx, P8B_ALLOWED_PRE_AUCTION_LAUNCH_STATUS, P8B_CODE_HASH_ATTESTATIONS, P8B_DURATION_BLOCKS, P8B_MANIFEST_FINGERPRINT,
  P8B_MANIFEST_VERSION, P8B_REAL_TREASURY_SAFE, p8bCanonicalJson, safeTxHash, type P8bSafeTx,
} from "@/lib/pcart-auction-execution-p8b";
import { callBatchFingerprint, P9_3_CHAIN_ID } from "@/lib/pcart-launch-coordinator-p9-3";
import { P8A_MAINNET_DEPENDENCIES } from "@/lib/pcart-auction-liquidity-plan";

export const P9_3B_BINDING_VERSION = "pcart-p9-3b-action-permit-v1" as const;
export const P9_3B_ACTION_TYPE = "PREAUCTION_SAFE_EXECUTE" as const;
/** Reuses the P4/P9.2 30-second permit precedent. */
export const P9_3B_PERMIT_TTL_MS = 30_000;
/** No signing/execution once the start block is closer than this (wall-clock, converted with fresh cadence). */
export const P9_3B_MIN_START_MARGIN_MS = 2 * 60 * 60 * 1000;
export const P9_3B_SIGNATURE_FORMAT = "SAFE_ECDSA_EIP712_V4" as const;
export const P9_3B_SMART_ACCOUNT_COPY = "This wallet returned a smart-account signature that P9.3B does not support. Use another Treasury signer." as const;

const low = (s: string | null | undefined) => String(s ?? "").trim().toLowerCase();
export const CANONICAL_OWNERS: readonly string[] = P8B_REAL_TREASURY_SAFE.owners.map(low);
const isCanonicalOwner = (a: string) => CANONICAL_OWNERS.includes(low(a));

// ------------------------------------------------------------ owner account kind
export type OwnerCodeKind = "EOA" | "EIP7702_DELEGATED" | "CONTRACT" | "UNKNOWN";
/** EIP-7702 designator is exactly 0xef0100 followed by a 20-byte delegate address (23 bytes). */
export function classifyOwnerCode(code: string | null | undefined): OwnerCodeKind {
  if (code == null) return "UNKNOWN";
  const c = low(code);
  if (c === "0x" || c === "") return "EOA";
  if (/^0xef0100[0-9a-f]{40}$/.test(c)) return "EIP7702_DELEGATED";
  return "CONTRACT";
}

// ------------------------------------------------------------ exact bound SafeTx (rebuilt via P8B)
export type BoundPreAuction = {
  officialTokenAddress: string; safeNonce: number; authoritativeStartBlock: string; endBlock: string; permit2Expiration: string;
  promotionStartAt: string; intendedAuctionStartAt: string; p8aManifestVersion?: string; p8bManifestVersion?: string;
  p8aManifestFingerprint: string; p8bManifestFingerprint: string;
  callBatchFingerprint: string; safeTxDataKeccak: string; safeTxHash: string; safeTxTarget: string; safeTxOperation: number;
};
export type RebuiltSafeTx = { ok: true; safe: `0x${string}`; tx: P8bSafeTx; safeTxHash: `0x${string}` } | { ok: false; reason: string };

/**
 * Deterministically reconstructs the bound pre-auction SafeTx with the reviewed P8B builder from the bound
 * values only (live facts are re-attested separately on the server). Fails closed unless the rebuilt
 * safeTxHash, calldata keccak, target, operation and batch fingerprint equal the stored binding.
 */
export function rebuildBoundPreAuction(a: BoundPreAuction): RebuiltSafeTx {
  if (low(a.p8aManifestFingerprint) !== low(P8A_MANIFEST_FINGERPRINT) || low(a.p8bManifestFingerprint) !== low(P8B_MANIFEST_FINGERPRINT)) return { ok: false, reason: "MANIFEST_CHANGED" };
  if (BigInt(a.endBlock) - BigInt(a.authoritativeStartBlock) !== BigInt(P8B_DURATION_BLOCKS)) return { ok: false, reason: "DURATION_MISMATCH" };
  const built = buildPreAuctionSafeTx({
    mode: "LIVE", tokenAddress: a.officialTokenAddress, safeAddress: P8B_REAL_TREASURY_SAFE.address, safeNonce: a.safeNonce,
    startBlock: BigInt(a.authoritativeStartBlock), permit2Expiration: BigInt(a.permit2Expiration),
    live: {
      chainId: P9_3_CHAIN_ID, nowMs: 0, launchStatus: P8B_ALLOWED_PRE_AUCTION_LAUNCH_STATUS, officialTokenAddress: low(a.officialTokenAddress), officialRegistered: true, deploymentFinalized: true,
      p8aReview: { manifestVersion: P8A_MANIFEST_VERSION, manifestFingerprint: P8A_MANIFEST_FINGERPRINT, expiresAtMs: Number.MAX_SAFE_INTEGER },
      p8bReview: { manifestVersion: P8B_MANIFEST_VERSION, manifestFingerprint: P8B_MANIFEST_FINGERPRINT, expiresAtMs: Number.MAX_SAFE_INTEGER },
      observedCodeHashes: Object.fromEntries(P8B_CODE_HASH_ATTESTATIONS.map((x) => [x.key, x.codeHash])),
      safe: { address: P8B_REAL_TREASURY_SAFE.address, version: "1.4.1", threshold: 2, owners: [...P8B_REAL_TREASURY_SAFE.owners], nonce: a.safeNonce, codeHash: P8B_REAL_TREASURY_SAFE.proxyCodeHash },
    },
    schedule: { promotionStartMs: Date.parse(a.promotionStartAt), intendedStartMs: Date.parse(a.intendedAuctionStartAt), ownerConfirmed: true },
  });
  if (!built.ok || !built.prepared.safeTx || !built.prepared.safeTxHash) return { ok: false, reason: built.ok ? "NO_SAFE_TX" : built.blocks.join(",") };
  const p = built.prepared;
  if (low(p.safeTxHash) !== low(a.safeTxHash)) return { ok: false, reason: "SAFE_TX_HASH_MISMATCH" };
  if (low(p.call.dataKeccak) !== low(a.safeTxDataKeccak) || low(p.call.target) !== low(a.safeTxTarget) || p.safeTx!.operation !== a.safeTxOperation) return { ok: false, reason: "CALL_MISMATCH" };
  if (low(callBatchFingerprint(p)) !== low(a.callBatchFingerprint)) return { ok: false, reason: "BATCH_MISMATCH" };
  return { ok: true, safe: low(P8B_REAL_TREASURY_SAFE.address) as `0x${string}`, tx: p.safeTx!, safeTxHash: p.safeTxHash! };
}

// ------------------------------------------------------------ Safe 1.4.1 EIP-712 typed data
export const SAFE_EIP712_TYPES = {
  EIP712Domain: [{ name: "chainId", type: "uint256" }, { name: "verifyingContract", type: "address" }],
  SafeTx: [
    { name: "to", type: "address" }, { name: "value", type: "uint256" }, { name: "data", type: "bytes" }, { name: "operation", type: "uint8" },
    { name: "safeTxGas", type: "uint256" }, { name: "baseGas", type: "uint256" }, { name: "gasPrice", type: "uint256" },
    { name: "gasToken", type: "address" }, { name: "refundReceiver", type: "address" }, { name: "nonce", type: "uint256" },
  ],
} as const;

export function safeTypedDataHash(safe: `0x${string}`, tx: P8bSafeTx, chainId = P9_3_CHAIN_ID): `0x${string}` {
  return hashTypedData({ domain: { chainId, verifyingContract: safe }, types: { SafeTx: SAFE_EIP712_TYPES.SafeTx }, primaryType: "SafeTx", message: tx });
}
/** JSON payload for eth_signTypedData_v4 (all integers as decimal strings). */
export function safeTypedDataV4Json(safe: `0x${string}`, tx: P8bSafeTx, chainId = P9_3_CHAIN_ID): string {
  return JSON.stringify({
    domain: { chainId, verifyingContract: safe }, types: SAFE_EIP712_TYPES, primaryType: "SafeTx",
    message: { to: tx.to, value: tx.value.toString(), data: tx.data, operation: tx.operation, safeTxGas: tx.safeTxGas.toString(), baseGas: tx.baseGas.toString(),
      gasPrice: tx.gasPrice.toString(), gasToken: tx.gasToken, refundReceiver: tx.refundReceiver, nonce: tx.nonce.toString() },
  });
}
export const typedDataParity = (safe: `0x${string}`, tx: P8bSafeTx) => safeTypedDataHash(safe, tx) === safeTxHash(safe, tx);

// ------------------------------------------------------------ signature validation
export type SigReject = "MALFORMED" | "SMART_ACCOUNT_SIGNATURE" | "ETH_SIGN_NOT_SUPPORTED" | "NOT_OWNER" | "SIGNER_MISMATCH" | "CONTRACT_OWNER_NOT_SUPPORTED" | "OWNER_CODE_UNKNOWN" | "WRONG_HASH";
export type SigCheck = { ok: true; recovered: string; normalized: Hex; ownerKind: "EOA" | "EIP7702_DELEGATED" } | { ok: false; reason: SigReject };

export async function validateOwnerSignature(i: { safeTxHash: string; expectedSafeTxHash: string; signature: string; claimedSigner: string; ownerCode: string | null | undefined }): Promise<SigCheck> {
  if (low(i.safeTxHash) !== low(i.expectedSafeTxHash) || !/^0x[0-9a-f]{64}$/.test(low(i.safeTxHash))) return { ok: false, reason: "WRONG_HASH" };
  if (!isCanonicalOwner(i.claimedSigner)) return { ok: false, reason: "NOT_OWNER" };
  const kind = classifyOwnerCode(i.ownerCode);
  if (kind === "UNKNOWN") return { ok: false, reason: "OWNER_CODE_UNKNOWN" };
  if (kind === "CONTRACT") return { ok: false, reason: "CONTRACT_OWNER_NOT_SUPPORTED" };
  const s = low(i.signature);
  if (!/^0x[0-9a-f]*$/.test(s)) return { ok: false, reason: "MALFORMED" };
  // Anything that is not exactly r(32)‖s(32)‖v(1) is a wrapped/contract-style (ERC-1271 / ERC-6492 / smart account) signature.
  if (s.length !== 132) return { ok: false, reason: s.length > 132 ? "SMART_ACCOUNT_SIGNATURE" : "MALFORMED" };
  let v = parseInt(s.slice(130, 132), 16);
  if (v === 0 || v === 1) v += 27;
  if (v > 30) return { ok: false, reason: "ETH_SIGN_NOT_SUPPORTED" };
  if (v !== 27 && v !== 28) return { ok: false, reason: "SMART_ACCOUNT_SIGNATURE" };
  const normalized = (s.slice(0, 130) + v.toString(16).padStart(2, "0")) as Hex;
  let recovered: string;
  try { recovered = low(await recoverAddress({ hash: low(i.safeTxHash) as Hex, signature: normalized })); } catch { return { ok: false, reason: "MALFORMED" }; }
  if (recovered !== low(i.claimedSigner)) return { ok: false, reason: "SIGNER_MISMATCH" };
  return { ok: true, recovered, normalized, ownerKind: kind };
}

export type StoredSig = { signerAddress: string; signature: string; safeTxHash: string; status: string; controlRevision: number; ownerKind: string };

/** Safe requires signatures concatenated in strictly ascending owner-address order. Exactly 2 distinct owners. */
export function assembleSafeSignatures(sigs: Pick<StoredSig, "signerAddress" | "signature">[]): { ok: true; signatures: Hex; signers: string[] } | { ok: false; reason: "NEED_TWO" | "DUPLICATE_SIGNER" | "NOT_OWNER" } {
  if (sigs.length !== 2) return { ok: false, reason: "NEED_TWO" };
  const s = [...sigs].map((x) => ({ a: low(x.signerAddress), sig: low(x.signature) as Hex })).sort((x, y) => (BigInt(x.a) < BigInt(y.a) ? -1 : 1));
  if (s[0].a === s[1].a) return { ok: false, reason: "DUPLICATE_SIGNER" };
  if (!s.every((x) => isCanonicalOwner(x.a))) return { ok: false, reason: "NOT_OWNER" };
  return { ok: true, signatures: concat(s.map((x) => x.sig)), signers: s.map((x) => x.a) };
}
export const signatureSetFingerprint = (sigs: Pick<StoredSig, "signerAddress" | "signature">[]) =>
  keccak256(stringToHex(`pcart-p9-3b-sigset|${[...sigs].map((x) => `${low(x.signerAddress)}=${low(x.signature)}`).sort().join("|")}`));

/** Signatures usable only if VALID, for this exact hash, and at the current control revision. */
export function usableSignatures(sigs: StoredSig[], i: { safeTxHash: string; controlRevision: number | null }): StoredSig[] {
  if (i.controlRevision == null) return [];
  return sigs.filter((x) => x.status === "VALID" && low(x.safeTxHash) === low(i.safeTxHash) && x.controlRevision === i.controlRevision);
}

// ------------------------------------------------------------ gates (fail closed)
export type P93bLive = {
  nowMs: number; headBlock: bigint | null; msPerBlock: number | null;
  control: { executionEnabled: boolean; emergencyStopEngaged: boolean; revision: number } | null;
  safeNonce: number | null; staleReasons: string[]; uncertainTransaction: boolean;
};
export type P93bGateBlock =
  | "ACTION_NOT_SIGNABLE" | "ACTION_NOT_READY" | "ACTION_STALE" | "CONTROLS_NOT_PROTECTED" | "CONTROL_REVISION_CHANGED" | "SAFE_NONCE_CHANGED"
  | "START_BLOCK_TOO_CLOSE" | "NO_FRESH_HEAD" | "UNCERTAIN_TRANSACTION" | "SIGNATURES_INCOMPLETE" | "SAFE_VALIDATION_FAILED" | "TX_ALREADY_EXISTS"
  | "NO_PERMIT" | "PERMIT_EXPIRED" | "PERMIT_USED";

export function startSafelyInFuture(startBlock: string, headBlock: bigint | null, msPerBlock: number | null): boolean {
  if (headBlock == null || !msPerBlock || msPerBlock <= 0) return false;
  const margin = BigInt(Math.ceil(P9_3B_MIN_START_MARGIN_MS / msPerBlock));
  return headBlock + margin < BigInt(startBlock);
}
function common(a: { status: string; safeNonce: number; authoritativeStartBlock: string }, l: P93bLive, expectedRevision: number | null): P93bGateBlock[] {
  const b: P93bGateBlock[] = [];
  if (!l.control || l.control.executionEnabled !== false || l.control.emergencyStopEngaged !== true) b.push("CONTROLS_NOT_PROTECTED");
  if (l.control && expectedRevision != null && l.control.revision !== expectedRevision) b.push("CONTROL_REVISION_CHANGED");
  if (l.staleReasons.length) b.push("ACTION_STALE");
  if (l.safeNonce === null || l.safeNonce !== a.safeNonce) b.push("SAFE_NONCE_CHANGED");
  if (l.uncertainTransaction) b.push("UNCERTAIN_TRANSACTION");
  if (l.headBlock == null || !l.msPerBlock) b.push("NO_FRESH_HEAD");
  else if (!startSafelyInFuture(a.authoritativeStartBlock, l.headBlock, l.msPerBlock)) b.push("START_BLOCK_TOO_CLOSE");
  return b;
}
export function signingGate(a: { status: string; safeNonce: number; authoritativeStartBlock: string }, l: P93bLive, usable: StoredSig[]): P93bGateBlock[] {
  const b = common(a, l, usable[0]?.controlRevision ?? null);
  if (a.status !== "PREPARED" && a.status !== "AWAITING_SIGNATURES") b.push("ACTION_NOT_SIGNABLE");
  return [...new Set(b)];
}
export function executionGate(
  a: { status: string; safeNonce: number; authoritativeStartBlock: string; executionTxHash: string | null },
  l: P93bLive, usable: StoredSig[], safeValidated: boolean | null,
  permit: { expiresAtMs: number; consumed: boolean; cancelled: boolean; controlRevision: number } | null,
): P93bGateBlock[] {
  const b = common(a, l, usable[0]?.controlRevision ?? null);
  if (a.status !== "READY") b.push("ACTION_NOT_READY");
  if (a.executionTxHash) b.push("TX_ALREADY_EXISTS");
  if (usable.length !== 2 || !assembleSafeSignatures(usable).ok) b.push("SIGNATURES_INCOMPLETE");
  if (safeValidated !== true) b.push("SAFE_VALIDATION_FAILED");
  if (!permit) b.push("NO_PERMIT");
  else {
    if (permit.consumed || permit.cancelled) b.push("PERMIT_USED");
    if (permit.expiresAtMs <= l.nowMs) b.push("PERMIT_EXPIRED");
    if (l.control && permit.controlRevision !== l.control.revision) b.push("CONTROL_REVISION_CHANGED");
  }
  return [...new Set(b)];
}

// ------------------------------------------------------------ permit binding
export type P93bPermitBinding = {
  bindingVersion: typeof P9_3B_BINDING_VERSION; actionType: typeof P9_3B_ACTION_TYPE; actionId: string; launchId: string; chainId: number;
  officialTokenAddress: string; officialTokenCodeHash: string; p8aReviewId: string; p8aManifestFingerprint: string; p8bReviewId: string; p8bManifestFingerprint: string;
  dependencyAttestationFingerprint: string; safeAddress: string; safeOwnersFingerprint: string; safeThreshold: 2; safeNonce: number;
  safeTxHash: string; callBatchFingerprint: string; signer1: string; signer2: string; signatureSetFingerprint: string; controlRevision: number;
};
export const permitBindingFingerprint = (b: P93bPermitBinding) => keccak256(stringToHex(`pcart-p9-3b-permit|${p8bCanonicalJson(b)}`));

// ------------------------------------------------------------ on-chain confirmation (receipt evidence only)
export const SAFE_EXECUTION_SUCCESS_TOPIC = toEventSelector("ExecutionSuccess(bytes32,uint256)");
export const SAFE_EXECUTION_FAILURE_TOPIC = toEventSelector("ExecutionFailure(bytes32,uint256)");
export const LBP_INITIALIZER_CREATED_TOPIC = toEventSelector(
  "InitializerCreated(address,(address,address,uint64,uint128,address,address,(uint24,int24,address),bytes,bytes))",
);
export const LBP_STRATEGY_ADDRESS = low(P8A_MAINNET_DEPENDENCIES.find((d) => d.key === "LBP_STRATEGY")!.address);

export type ReceiptEvidence = { status: "success" | "reverted"; to: string | null; blockNumber: bigint; logs: { address: string; topics: string[]; data: string }[] };
export type AuctionEvidence = { ok: true; endBlock: bigint; tokensRecipient: string; fundsRecipient: string } | { ok: false };
export type ConfirmResult = { ok: true; auctionAddress: string; block: bigint } | { ok: false; reasons: string[]; reverted?: boolean };

export function verifyPreAuctionExecution(i: {
  receipt: ReceiptEvidence | null; boundSafeTxHash: string; boundNonce: number; nonceAfter: number | null;
  boundStartBlock: string; boundEndBlock: string; auction: AuctionEvidence | null;
}): ConfirmResult {
  const r: string[] = [];
  const rc = i.receipt;
  if (!rc) return { ok: false, reasons: ["RECEIPT_UNAVAILABLE"] };
  if (rc.status !== "success") return { ok: false, reasons: ["TX_REVERTED"], reverted: true };
  const safe = low(P8B_REAL_TREASURY_SAFE.address);
  if (low(rc.to) !== safe) r.push("TX_NOT_TO_SAFE");
  const h = low(i.boundSafeTxHash);
  const succ = rc.logs.filter((l) => low(l.address) === safe && low(l.topics[0]) === low(SAFE_EXECUTION_SUCCESS_TOPIC) && low(l.data).slice(0, 66) === h);
  const fail = rc.logs.some((l) => low(l.address) === safe && low(l.topics[0]) === low(SAFE_EXECUTION_FAILURE_TOPIC));
  if (succ.length !== 1) r.push("SAFE_EXECUTION_EVENT_MISSING");
  if (fail) r.push("SAFE_EXECUTION_FAILURE_EVENT");
  if (i.nonceAfter === null || i.nonceAfter !== i.boundNonce + 1) r.push("SAFE_NONCE_NOT_ADVANCED_EXACTLY_ONCE");
  const created = rc.logs.filter((l) => low(l.address) === LBP_STRATEGY_ADDRESS && low(l.topics[0]) === low(LBP_INITIALIZER_CREATED_TOPIC));
  if (created.length !== 1 || !created[0].topics[1]) r.push("AUCTION_CREATION_EVENT_MISSING");
  const auctionAddress = created[0]?.topics[1] ? `0x${low(created[0].topics[1]).slice(26)}` : "";
  const a = i.auction;
  if (!a || !a.ok) r.push("AUCTION_UNREADABLE");
  else {
    if (a.endBlock.toString() !== i.boundEndBlock || BigInt(i.boundEndBlock) - BigInt(i.boundStartBlock) !== BigInt(P8B_DURATION_BLOCKS)) r.push("AUCTION_END_BLOCK_MISMATCH");
    if (low(a.tokensRecipient) !== safe) r.push("AUCTION_TOKENS_RECIPIENT_MISMATCH");
    if (low(a.fundsRecipient) !== LBP_STRATEGY_ADDRESS) r.push("AUCTION_FUNDS_RECIPIENT_MISMATCH");
  }
  return r.length ? { ok: false, reasons: r } : { ok: true, auctionAddress, block: rc.blockNumber };
}

/** Wallet outcome classification for the single execTransaction handoff. Closing the modal is not failure. */
export type HandoffOutcome = "HASH" | "REJECTED_BEFORE_SEND" | "AMBIGUOUS";
export function classifyHandoff(result: unknown, error: unknown): HandoffOutcome {
  if (!error && typeof result === "string" && /^0x[0-9a-fA-F]{64}$/.test(result)) return "HASH";
  const code = (error as { code?: number } | null)?.code;
  if (code === 4001) return "REJECTED_BEFORE_SEND"; // explicit user rejection → nothing broadcast; still never auto-retried
  return "AMBIGUOUS";
}
