/**
 * PCART P4 — final send review helpers (pure, no I/O).
 *
 * Builds the EXACT unsigned CREATE envelope from authoritative fields only,
 * derives the unsigned-transaction fingerprint that the database recomputes
 * byte-for-byte, and evaluates permit liveness. This module has NO provider,
 * wallet, signing or broadcast capability.
 */
import { sha256, stringToBytes } from "viem";

import { PEPECARTEL_TOKEN_ARTIFACT_ID } from "@/lib/pepecartel-token.artifact";
import { buildPcartProductionInitCode, normalizeAddress, PCART_PRODUCTION_CHAIN_ID } from "@/lib/pcart-production-intent";

export const PCART_EXECUTION_PERMIT_MAX_TTL_MS = 30_000;
export const PCART_FINAL_REVIEW_TTL_MS = 60_000;
export const PCART_UNSIGNED_TX_DOMAIN = "pcart-unsigned-tx-v1" as const;
/** Objective gas headroom over the live eth_estimateGas result (20%). */
export const PCART_GAS_LIMIT_NUMERATOR = 120n;
export const PCART_GAS_LIMIT_DENOMINATOR = 100n;
export const PCART_GAS_LIMIT_CAP = 30_000_000n;

export type PcartUnsignedTxInput = {
  deploymentId: string;
  launchId: string;
  from: string;
  nonce: bigint;
  initCodeHash: string;
  gasLimit: bigint;
  maxFeePerGas: bigint;
  maxPriorityFeePerGas: bigint;
  safe: string;
  predicted: string;
  reviewFingerprint: string;
  readinessFingerprint: string;
};

/** Must stay byte-identical to private.pcart_unsigned_tx_fingerprint. */
export function pcartUnsignedTxFingerprintPreimage(i: PcartUnsignedTxInput): string {
  return [
    PCART_UNSIGNED_TX_DOMAIN,
    i.deploymentId.toLowerCase(),
    i.launchId.toLowerCase(),
    PEPECARTEL_TOKEN_ARTIFACT_ID,
    String(PCART_PRODUCTION_CHAIN_ID),
    i.from.toLowerCase(),
    "CREATE",
    "0",
    i.nonce.toString(),
    i.initCodeHash.toLowerCase(),
    i.gasLimit.toString(),
    i.maxFeePerGas.toString(),
    i.maxPriorityFeePerGas.toString(),
    i.safe.toLowerCase(),
    i.predicted.toLowerCase(),
    i.reviewFingerprint.toLowerCase(),
    i.readinessFingerprint.toLowerCase(),
  ].join("|");
}

export function pcartUnsignedTxFingerprint(i: PcartUnsignedTxInput): `0x${string}` {
  return sha256(stringToBytes(pcartUnsignedTxFingerprintPreimage(i)));
}

export function pcartGasLimitFromEstimate(estimate: bigint): bigint {
  if (estimate <= 0n) throw new Error("Invalid gas estimate");
  const limit = (estimate * PCART_GAS_LIMIT_NUMERATOR + PCART_GAS_LIMIT_DENOMINATOR - 1n) / PCART_GAS_LIMIT_DENOMINATOR;
  if (limit > PCART_GAS_LIMIT_CAP) throw new Error("Gas limit above cap");
  return limit;
}

/** Objective worst-case cost: gas limit × max fee per gas (value is always 0). */
export function pcartMaxCostWei(gasLimit: bigint, maxFeePerGas: bigint): bigint {
  return gasLimit * maxFeePerGas;
}

export type PcartUnsignedEnvelope = {
  from: string;
  data: `0x${string}`;
  value: "0x0";
  gas: `0x${string}`;
};

/**
 * Exact unsigned CREATE envelope. No `to`, no nonce override, no user data:
 * `data` is always rebuilt from the frozen artifact + pinned Safe.
 */
export function buildPcartUnsignedEnvelope(from: string, safe: string, gasLimit: bigint): PcartUnsignedEnvelope {
  const f = normalizeAddress(from);
  if (!f) throw new Error("Invalid deployer");
  if (gasLimit <= 0n || gasLimit > PCART_GAS_LIMIT_CAP) throw new Error("Invalid gas limit");
  return { from: f, data: buildPcartProductionInitCode(safe), value: "0x0", gas: `0x${gasLimit.toString(16)}` };
}

/** Typed confirmation: must equal the predicted address (case-insensitive). */
export function isPcartAddressConfirmation(typed: string, predicted: string): boolean {
  const t = normalizeAddress(typed);
  const p = normalizeAddress(predicted);
  return !!t && !!p && t === p;
}

export type PcartExecutionPermitLike = { issued_at: string; expires_at: string; cancelled_at: string | null; consumed_at?: string | null };

/** READY TO SEND evidence only while not cancelled/consumed, unexpired, within the 30s cap. */
export function isPcartExecutionPermitActive(p: PcartExecutionPermitLike | null | undefined, nowMs: number): boolean {
  if (!p || p.cancelled_at || p.consumed_at) return false;
  const issued = Date.parse(p.issued_at);
  const expires = Date.parse(p.expires_at);
  if (!Number.isFinite(issued) || !Number.isFinite(expires)) return false;
  if (expires <= issued || expires - issued > PCART_EXECUTION_PERMIT_MAX_TTL_MS) return false;
  return nowMs < expires;
}
