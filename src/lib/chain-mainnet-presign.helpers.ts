import { encodeAbiParameters } from "viem";
import {
  CARTEL_FIXED_ERC20_ARTIFACT_ID,
  CARTEL_FIXED_ERC20_CREATION_BYTECODE,
  CARTEL_FIXED_ERC20_DECIMALS,
  CARTEL_FIXED_ERC20_RUNTIME_BYTECODE_HASH,
} from "./cartel-fixed-erc20.artifact";
import { ROBINHOOD_MAINNET_CHAIN_ID, ROBINHOOD_MAINNET_ENVIRONMENT } from "./chain-mainnet-registry";

/**
 * P3C-B presign support module — deterministic constants, pure helpers and the
 * READ-ONLY managed JSON-RPC transport extracted verbatim from
 * `chain-mainnet-presign.functions.ts` for file-size hygiene only.
 *
 * Behaviour, ordering, error codes and endpoint secrecy are unchanged. Nothing
 * here signs, broadcasts, mutates database state, or reads a secret by value:
 * the endpoint is always passed in by the caller and never logged or returned.
 */

/* ------------------------------------------------------------------ */
/* Deterministic, non-leaking result codes                             */
/* ------------------------------------------------------------------ */

export type PresignNotice =
  | "NOT_AUTHORIZED"
  | "UNSUPPORTED_DEPLOYMENT"
  | "INVALID_REQUEST_ID"
  | "MANAGED_RPC_UNCONFIGURED"
  | "MANAGED_RPC_UNREACHABLE"
  | "MANAGED_RPC_TIMEOUT"
  | "RPC_ERROR"
  | "MALFORMED_RESPONSE"
  | "MANAGED_RPC_CHAIN_MISMATCH"
  | "CREATION_SIMULATION_REVERTED"
  | "GAS_ESTIMATION_FAILED"
  | "FEE_DATA_UNAVAILABLE"
  | "BALANCE_UNAVAILABLE"
  | "INIT_CODE_HASH_MISMATCH"
  | "INTENT_FINGERPRINT_MISMATCH"
  | "GAS_LIMIT_EXCEEDS_BLOCK_LIMIT"
  | "INSUFFICIENT_BALANCE_FOR_MAX_COST"
  | "QUOTE_BUILD_TOO_OLD"
  | "PRESIGN_REQUEST_CONFLICT"
  | "PRESIGN_ALREADY_CLAIMED"
  | "PRESIGN_REQUEST_TERMINAL_REUSE"
  | "PRESIGN_UNRESOLVED_AUTHORIZATION_EXISTS"
  | "PRESIGN_ISSUE_FAILED";

export type MainnetPresignResult = {
  ok: boolean;
  notice: PresignNotice | null;
  chainId: typeof ROBINHOOD_MAINNET_CHAIN_ID;
  deploymentId: string;
  authorizationId: string | null;
  status: string | null;
  recoveredExisting: boolean;
  expiresAt: string | null;
  feeModel: "EIP1559" | "LEGACY" | null;
  gasEstimate: string | null;
  gasLimit: string | null;
  observedFeePerGasWei: string | null;
  maxFeePerGasWei: string | null;
  maxPriorityFeePerGasWei: string | null;
  estimatedCostWei: string | null;
  maxTotalCostWei: string | null;
  balanceWei: string | null;
};

/* ------------------------------------------------------------------ */
/* Frozen policy constants                                             */
/* ------------------------------------------------------------------ */

/** Authoritative server-derived quote lifetime. Inside the A2 30..300 range. */
export const PRESIGN_TTL_SECONDS = 60;

/** Managed JSON-RPC per-call timeout. */
export const RPC_TIMEOUT_MS = 8_000;

/**
 * Hard ceiling on how long the managed observation window may take. Beyond
 * this the observations are treated as stale and no authorization is issued
 * with a fresh expiry.
 */
export const PRESIGN_MAX_QUOTE_BUILD_MS = 15_000;

/**
 * Gas-limit margin: ceil(gasEstimate * 125 / 100). A 25% buffer absorbs
 * state drift between the quote and a later send while staying far below a
 * production block limit, and can never understate the reserved gas.
 */
export const PRESIGN_GAS_LIMIT_NUMERATOR = 125n;
export const PRESIGN_GAS_LIMIT_DENOMINATOR = 100n;

/**
 * Base-fee headroom: maxFee = baseFee * 2 + priority. Mirrors the P2 review
 * convention and covers several consecutive maximal base-fee increases.
 */
export const PRESIGN_BASE_FEE_HEADROOM_MULTIPLIER = 2n;

/** Canonical production fingerprint domain and separator (P2 contract). */
const FINGERPRINT_DOMAIN = "cartel-mainnet-sim-v1";
const FIELD_SEPARATOR = "\u001f";

export const ZERO_ADDRESS = "0x0000000000000000000000000000000000000000";
export const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export const ADDRESS = /^0x[0-9a-f]{40}$/;
export const HASH32 = /^0x[0-9a-f]{64}$/;
export const DIGITS = /^(0|[1-9][0-9]*)$/;
export const REQUEST_ID = /^[A-Za-z0-9_-]+$/;
export const TOKEN_NAME = /^[\x20-\x7e]{1,32}$/;
export const TOKEN_SYMBOL = /^[A-Z0-9]{2,11}$/;

export const BASE_UNIT_SCALE = 10n ** BigInt(CARTEL_FIXED_ERC20_DECIMALS);

/* ------------------------------------------------------------------ */
/* Small pure helpers                                                  */
/* ------------------------------------------------------------------ */

export function lower(value: string): string {
  return value.trim().toLowerCase();
}

export function baseResult(deploymentId: string): MainnetPresignResult {
  return {
    ok: false,
    notice: null,
    chainId: ROBINHOOD_MAINNET_CHAIN_ID,
    deploymentId,
    authorizationId: null,
    status: null,
    recoveredExisting: false,
    expiresAt: null,
    feeModel: null,
    gasEstimate: null,
    gasLimit: null,
    observedFeePerGasWei: null,
    maxFeePerGasWei: null,
    maxPriorityFeePerGasWei: null,
    estimatedCostWei: null,
    maxTotalCostWei: null,
    balanceWei: null,
  };
}

export function fail(
  deploymentId: string,
  notice: PresignNotice,
  partial: Partial<MainnetPresignResult> = {},
): MainnetPresignResult {
  return { ...baseResult(deploymentId), ...partial, ok: false, notice };
}

/** Strict canonical hex-quantity parser. Anything malformed fails closed. */
export function parseHexQuantity(value: unknown): bigint | null {
  if (typeof value !== "string") return null;
  if (!/^0x(0|[1-9a-fA-F][0-9a-fA-F]*)$/.test(value)) return null;
  try {
    return BigInt(value);
  } catch {
    return null;
  }
}

/** Integer ceiling division. bigint only. */
export function ceilDiv(value: bigint, numerator: bigint, denominator: bigint): bigint {
  const scaled = value * numerator;
  return (scaled + denominator - 1n) / denominator;
}

/** Canonical P2 fingerprint pre-image, reproduced independently. */
export function fingerprintPreimage(fields: {
  deployer: string;
  recipient: string;
  name: string;
  symbol: string;
  supplyWhole: string;
  totalSupplyBaseUnits: string;
  initCodeHash: string;
}): string {
  return [
    FINGERPRINT_DOMAIN,
    ROBINHOOD_MAINNET_ENVIRONMENT,
    String(ROBINHOOD_MAINNET_CHAIN_ID),
    CARTEL_FIXED_ERC20_ARTIFACT_ID,
    CARTEL_FIXED_ERC20_RUNTIME_BYTECODE_HASH.toLowerCase(),
    fields.deployer.toLowerCase(),
    fields.recipient.toLowerCase(),
    fields.name.normalize("NFC"),
    fields.symbol.normalize("NFC"),
    String(CARTEL_FIXED_ERC20_DECIMALS),
    fields.supplyWhole,
    fields.totalSupplyBaseUnits,
    fields.initCodeHash.toLowerCase(),
    "0",
  ].join(FIELD_SEPARATOR);
}

/** Frozen creation bytecode + ABI-encoded constructor args. */
export function buildInitCode(intent: {
  name: string;
  symbol: string;
  totalSupply: bigint;
  recipient: string;
}): `0x${string}` {
  const args = encodeAbiParameters(
    [{ type: "string" }, { type: "string" }, { type: "uint256" }, { type: "address" }],
    [intent.name, intent.symbol, intent.totalSupply, intent.recipient as `0x${string}`],
  );
  return `${CARTEL_FIXED_ERC20_CREATION_BYTECODE}${args.slice(2)}` as `0x${string}`;
}

/* ------------------------------------------------------------------ */
/* Managed JSON-RPC transport (read-only)                              */
/* ------------------------------------------------------------------ */

export type RpcOutcome<T> =
  | { ok: true; value: T }
  | { ok: false; notice: Extract<
      PresignNotice,
      "MANAGED_RPC_UNREACHABLE" | "MANAGED_RPC_TIMEOUT" | "RPC_ERROR" | "MALFORMED_RESPONSE"
    > };

export async function rpcCall<T>(
  endpoint: string,
  method: string,
  params: unknown[],
): Promise<RpcOutcome<T>> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), RPC_TIMEOUT_MS);
  try {
    const response = await fetch(endpoint, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }),
      signal: controller.signal,
    });
    if (!response.ok) return { ok: false, notice: "RPC_ERROR" };
    const payload = (await response.json()) as { result?: unknown; error?: unknown };
    // Provider error text is never surfaced — only the deterministic code.
    if (payload.error !== undefined && payload.error !== null) {
      return { ok: false, notice: "RPC_ERROR" };
    }
    if (payload.result === undefined) return { ok: false, notice: "MALFORMED_RESPONSE" };
    return { ok: true, value: payload.result as T };
  } catch (error) {
    const aborted = error instanceof Error && error.name === "AbortError";
    return { ok: false, notice: aborted ? "MANAGED_RPC_TIMEOUT" : "MANAGED_RPC_UNREACHABLE" };
  } finally {
    clearTimeout(timer);
  }
}
