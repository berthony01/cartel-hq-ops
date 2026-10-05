/**
 * PCART P6 — pure post-broadcast verification classification.
 *
 * No I/O, no wallet, no signing, no RPC. The server function gathers managed
 * provider observations and this module decides the single outcome. Provider
 * uncertainty is always RETRYABLE and never FAILED.
 */
import { keccak256 } from "viem";

import { PEPECARTEL_TOKEN_RUNTIME_BYTECODE_KECCAK256 } from "./pepecartel-token.artifact";
import { predictPcartProductionAddress } from "./pcart-production-intent";

export const PCART_P6_SUPPLY = "1000000000000000000000000000";
export const PCART_P6_ACTIVE_STATUSES = ["SUBMITTED", "PENDING", "CONFIRMED"] as const;

export type PcartP6Intent = {
  status: string;
  txHash: string;
  deployer: string;
  nonce: bigint;
  initCodeHash: string;
  safe: string;
  claimPredictedAddress: string;
};

export type PcartP6Tx = { hash: string; from: string; to: string | null; nonce: bigint; value: bigint; input: string } | null;
export type PcartP6Receipt = { transactionHash: string; status: "success" | "reverted"; contractAddress: string | null; blockNumber: bigint; blockHash: string } | null;
export type PcartP6Contract = {
  runtimeCode: string;
  name: string;
  symbol: string;
  decimals: number;
  totalSupply: bigint;
  safeBalance: bigint;
  deployerBalance: bigint;
};

/** Observation slots: `undefined` = provider read failed (retryable). */
export type PcartP6Observation = {
  tx: PcartP6Tx | undefined;
  receipt: PcartP6Receipt | undefined;
  latestNonce: bigint | undefined;
  /** Tx found at the saved nonce by the bounded recovery scan (null = not found). */
  replacementTx?: PcartP6Tx | undefined;
  contract?: PcartP6Contract | undefined;
  latestBlock?: bigint | undefined;
};

export type PcartP6FailureCode =
  | "REVERTED" | "REPLACED_OR_DROPPED" | "MISMATCH_SENDER" | "MISMATCH_TO" | "MISMATCH_NONCE" | "MISMATCH_VALUE"
  | "MISMATCH_INIT_CODE" | "MISMATCH_TX_HASH" | "MISMATCH_CONTRACT_ADDRESS" | "MISMATCH_RUNTIME"
  | "MISMATCH_TOKEN_METADATA" | "MISMATCH_SAFE_BALANCE" | "MISMATCH_DEPLOYER_BALANCE";

export type PcartP6Outcome =
  | { kind: "REFUSED"; reason: string }
  | { kind: "RETRYABLE"; reason: string }
  | { kind: "PENDING" }
  | { kind: "FAILED"; code: PcartP6FailureCode }
  | {
      kind: "CONFIRMED";
      contractAddress: string;
      blockNumber: bigint;
      blockHash: string;
      runtimeHash: string;
      confirmations: number;
    };

const l = (v: string | null | undefined) => (v ?? "").toLowerCase();

export function isPcartP6Active(status: string | null | undefined): boolean {
  return (PCART_P6_ACTIVE_STATUSES as readonly string[]).includes(String(status));
}

function txMismatch(i: PcartP6Intent, tx: NonNullable<PcartP6Tx>): PcartP6FailureCode | null {
  if (l(tx.from) !== l(i.deployer)) return "MISMATCH_SENDER";
  if (tx.to !== null) return "MISMATCH_TO";
  if (tx.nonce !== i.nonce) return "MISMATCH_NONCE";
  if (tx.value !== 0n) return "MISMATCH_VALUE";
  if (l(keccak256(tx.input as `0x${string}`)) !== l(i.initCodeHash)) return "MISMATCH_INIT_CODE";
  return null;
}

export function classifyPcartP6(i: PcartP6Intent, o: PcartP6Observation): PcartP6Outcome {
  if (!isPcartP6Active(i.status)) return { kind: "REFUSED", reason: "STATUS_NOT_VERIFIABLE" };
  const predicted = l(predictPcartProductionAddress(i.deployer, i.nonce));
  if (predicted !== l(i.claimPredictedAddress)) return { kind: "REFUSED", reason: "CLAIM_PREDICTION_MISMATCH" };

  if (o.tx === undefined || o.receipt === undefined) return { kind: "RETRYABLE", reason: "PROVIDER_UNAVAILABLE" };

  if (o.tx === null) {
    if (o.latestNonce === undefined) return { kind: "RETRYABLE", reason: "PROVIDER_UNAVAILABLE" };
    if (o.latestNonce <= i.nonce) return { kind: "RETRYABLE", reason: "TX_NOT_VISIBLE" };
    // Nonce moved past the saved nonce without our tx: identify what used it.
    if (o.replacementTx === undefined) return { kind: "RETRYABLE", reason: "RECOVERY_SCAN_UNAVAILABLE" };
    if (o.replacementTx === null) return { kind: "RETRYABLE", reason: "RECOVERY_SCAN_INCONCLUSIVE" };
    if (l(o.replacementTx.hash) !== l(i.txHash)) return { kind: "FAILED", code: "REPLACED_OR_DROPPED" };
    return { kind: "RETRYABLE", reason: "TX_FOUND_BY_SCAN_RECHECK" };
  }

  if (l(o.tx.hash) !== l(i.txHash)) return { kind: "FAILED", code: "MISMATCH_TX_HASH" };
  const mm = txMismatch(i, o.tx);
  if (mm) return { kind: "FAILED", code: mm };

  if (o.receipt === null) return { kind: "PENDING" };
  if (l(o.receipt.transactionHash) !== l(i.txHash)) return { kind: "FAILED", code: "MISMATCH_TX_HASH" };
  if (o.receipt.status !== "success") return { kind: "FAILED", code: "REVERTED" };
  const addr = l(o.receipt.contractAddress);
  if (!addr || addr !== predicted || addr !== l(i.claimPredictedAddress)) return { kind: "FAILED", code: "MISMATCH_CONTRACT_ADDRESS" };

  const c = o.contract;
  if (c === undefined) return { kind: "RETRYABLE", reason: "CONTRACT_READ_UNAVAILABLE" };
  const runtimeHash = !c.runtimeCode || c.runtimeCode === "0x" ? "" : l(keccak256(c.runtimeCode as `0x${string}`));
  if (runtimeHash !== l(PEPECARTEL_TOKEN_RUNTIME_BYTECODE_KECCAK256)) return { kind: "FAILED", code: "MISMATCH_RUNTIME" };
  if (c.name !== "PEPECARTEL" || c.symbol !== "PCART" || c.decimals !== 18 || c.totalSupply.toString() !== PCART_P6_SUPPLY) {
    return { kind: "FAILED", code: "MISMATCH_TOKEN_METADATA" };
  }
  if (c.safeBalance.toString() !== PCART_P6_SUPPLY) return { kind: "FAILED", code: "MISMATCH_SAFE_BALANCE" };
  if (c.deployerBalance !== 0n) return { kind: "FAILED", code: "MISMATCH_DEPLOYER_BALANCE" };

  const depth = o.latestBlock !== undefined && o.latestBlock >= o.receipt.blockNumber ? o.latestBlock - o.receipt.blockNumber + 1n : 0n;
  return {
    kind: "CONFIRMED",
    contractAddress: addr,
    blockNumber: o.receipt.blockNumber,
    blockHash: l(o.receipt.blockHash),
    runtimeHash,
    confirmations: Number(depth > 2_000_000_000n ? 2_000_000_000n : depth),
  };
}

/** For a CONFIRMED row: transient failures never downgrade; contradictions are surfaced only. */
export function pcartP6ConfirmedRecheck(outcome: PcartP6Outcome): "UNCHANGED" | "INCIDENT" {
  return outcome.kind === "FAILED" ? "INCIDENT" : "UNCHANGED";
}

export type PcartP6FinalityOutcome =
  | { kind: "RETRYABLE" }
  | { kind: "FINALITY_PENDING"; head: bigint }
  | { kind: "FINALIZED"; head: bigint; rereadHash: string }
  | { kind: "PROVIDER_INCONSISTENT"; head: bigint | null; reason: string };

export function classifyPcartP6Finality(i: {
  blockNumber: bigint;
  blockHash: string;
  storedHead: bigint | null;
  finalizedHead: bigint | undefined;
  rereadHash: string | undefined | null;
}): PcartP6FinalityOutcome {
  if (i.finalizedHead === undefined || i.rereadHash === undefined) return { kind: "RETRYABLE" };
  if (i.storedHead !== null && i.finalizedHead < i.storedHead) {
    return { kind: "PROVIDER_INCONSISTENT", head: i.finalizedHead, reason: "FINALIZED_HEAD_RETREATED" };
  }
  if (i.rereadHash === null || l(i.rereadHash) !== l(i.blockHash)) {
    return { kind: "PROVIDER_INCONSISTENT", head: i.finalizedHead, reason: "DEPLOYMENT_BLOCK_HASH_CHANGED" };
  }
  if (i.finalizedHead < i.blockNumber) return { kind: "FINALITY_PENDING", head: i.finalizedHead };
  return { kind: "FINALIZED", head: i.finalizedHead, rereadHash: l(i.rereadHash) };
}

export type PcartP6SummaryInput = { status: string | null | undefined; finalityState: string | null | undefined };

/** Review & Launch summary for post-broadcast states; null = defer to P5/base text. */
export function pcartP6SummaryText(i: PcartP6SummaryInput): string | null {
  if (i.status === "FAILED") return "Deployment verification failed — stop";
  if (i.status === "SUBMITTED" || i.status === "PENDING") return "Mainnet transaction broadcast — verification required";
  if (i.status === "CONFIRMED") {
    return i.finalityState === "FINALIZED"
      ? "Contract verified & finalized — official registration next"
      : "Contract verified — finality pending";
  }
  return null;
}

export const PCART_P6_NOT_OFFICIAL_COPY =
  "Verification does not register this address as the official PCART contract. Official registration is the next phase.";
