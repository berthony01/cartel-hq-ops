/**
 * PCART-L1B — Safe treasury verification, PURE LOGIC ONLY.
 *
 * WHAT THIS IS: decoding and policy evaluation for a READ-ONLY check that a
 * candidate address on Robinhood Chain mainnet (4663) behaves like a
 * Safe-compatible 2-of-3 multisig, based on live interface reads.
 *
 * WHAT THIS IS NOT: it is NOT cryptographic proof of a specific Safe proxy or
 * singleton version, it never creates a Safe, never signs, never broadcasts,
 * never moves value, never persists anything and holds no authority over any
 * launch, request or runtime control.
 *
 * Everything here fails CLOSED: any malformed, ambiguous or unexpected input
 * yields "not verified" rather than a guess.
 */

import { ROBINHOOD_MAINNET_CHAIN_ID } from "./chain-mainnet-registry";

/** Standard Safe read selectors (no state-changing selector exists here). */
export const SAFE_GET_OWNERS_SELECTOR = "0xa0e67e2b" as const;
export const SAFE_GET_THRESHOLD_SELECTOR = "0xe75235b8" as const;
export const SAFE_VERSION_SELECTOR = "0xffa1ad74" as const;

/** PCART foundation policy for this slice. */
export const PCART_REQUIRED_OWNER_COUNT = 3 as const;
export const PCART_REQUIRED_THRESHOLD = 2 as const;

const EVM_ADDRESS_RE = /^0x[0-9a-fA-F]{40}$/;
const ZERO_ADDRESS = "0x0000000000000000000000000000000000000000";

export type TreasurySafeFailureCode =
  | "INVALID_ADDRESS"
  | "PROVIDER_NOT_CONFIGURED"
  | "PROVIDER_UNREACHABLE"
  | "RPC_ERROR"
  | "MALFORMED_RESPONSE"
  | "CHAIN_MISMATCH"
  | "NOT_A_CONTRACT"
  | "SAFE_INTERFACE_UNREADABLE"
  | "OWNER_SET_INVALID"
  | "OWNER_COUNT_NOT_THREE"
  | "THRESHOLD_NOT_TWO";

export type TreasurySafeVerification = {
  address: string;
  chainId: number;
  chainOk: boolean;
  isContract: boolean;
  owners: string[];
  ownerCount: number;
  threshold: number | null;
  version: string | null;
  isTwoOfThreeSafeCompatible: boolean;
  failureCode: TreasurySafeFailureCode | null;
  message: string;
};

export function isCandidateTreasuryAddress(raw: string): boolean {
  const text = (raw ?? "").trim();
  return EVM_ADDRESS_RE.test(text) && text.toLowerCase() !== ZERO_ADDRESS;
}

export function normalizeTreasuryAddress(raw: string): string {
  return (raw ?? "").trim().toLowerCase();
}

function isHexData(value: unknown): value is string {
  return typeof value === "string" && /^0x([0-9a-fA-F]{2})*$/.test(value);
}

/** True only for a definite, well-formed, NON-empty code response. */
export function hasContractCode(codeHex: unknown): boolean {
  if (!isHexData(codeHex)) return false;
  return codeHex.length > 2;
}

function words(data: string): string[] {
  const body = data.slice(2);
  if (body.length % 64 !== 0) return [];
  const out: string[] = [];
  for (let i = 0; i < body.length; i += 64) out.push(body.slice(i, i + 64));
  return out;
}

/** Strict uint256 decode. Returns null on any ambiguity. */
export function decodeUint256(data: unknown): bigint | null {
  if (!isHexData(data)) return null;
  const w = words(data);
  if (w.length !== 1) return null;
  try {
    return BigInt(`0x${w[0]}`);
  } catch {
    return null;
  }
}

/**
 * Strict dynamic address[] decode. Rejects wrong offsets, wrong lengths,
 * dirty upper bytes and any trailing/short data.
 */
export function decodeAddressArray(data: unknown): string[] | null {
  if (!isHexData(data)) return null;
  const w = words(data);
  if (w.length < 2) return null;
  let offset: bigint;
  let length: bigint;
  try {
    offset = BigInt(`0x${w[0]}`);
    length = BigInt(`0x${w[1]}`);
  } catch {
    return null;
  }
  if (offset !== 32n) return null;
  if (length > 256n) return null;
  const count = Number(length);
  if (w.length !== 2 + count) return null;
  const out: string[] = [];
  for (let i = 0; i < count; i += 1) {
    const word = w[2 + i];
    if (!/^0{24}[0-9a-fA-F]{40}$/.test(word)) return null;
    out.push(`0x${word.slice(24).toLowerCase()}`);
  }
  return out;
}

/** Strict ABI string decode, used only for the optional VERSION() read. */
export function decodeString(data: unknown): string | null {
  if (!isHexData(data)) return null;
  const w = words(data);
  if (w.length < 2) return null;
  let offset: bigint;
  let length: bigint;
  try {
    offset = BigInt(`0x${w[0]}`);
    length = BigInt(`0x${w[1]}`);
  } catch {
    return null;
  }
  if (offset !== 32n) return null;
  if (length === 0n || length > 64n) return null;
  const bytes = data.slice(2 + 128, 2 + 128 + Number(length) * 2);
  if (bytes.length !== Number(length) * 2) return null;
  let text = "";
  for (let i = 0; i < bytes.length; i += 2) {
    const code = Number.parseInt(bytes.slice(i, i + 2), 16);
    if (!Number.isFinite(code) || code < 0x20 || code > 0x7e) return null;
    text += String.fromCharCode(code);
  }
  return text;
}

export type TreasurySafeReads = {
  address: string;
  observedChainId: number | null;
  /** Raw hex from eth_getCode, or null when the read failed. */
  codeHex: unknown;
  /** Raw hex from eth_call getOwners(), or null when the read failed. */
  ownersData: unknown;
  /** Raw hex from eth_call getThreshold(), or null when the read failed. */
  thresholdData: unknown;
  /** Optional; a failed VERSION() read never fails an otherwise valid Safe. */
  versionData?: unknown;
};

function fail(
  address: string,
  observedChainId: number | null,
  code: TreasurySafeFailureCode,
  message: string,
  partial?: Partial<TreasurySafeVerification>,
): TreasurySafeVerification {
  return {
    address,
    chainId: observedChainId ?? ROBINHOOD_MAINNET_CHAIN_ID,
    chainOk: observedChainId === ROBINHOOD_MAINNET_CHAIN_ID,
    isContract: false,
    owners: [],
    ownerCount: 0,
    threshold: null,
    version: null,
    isTwoOfThreeSafeCompatible: false,
    failureCode: code,
    message,
    ...partial,
  };
}

/** Failure produced before any network read (or when the provider failed). */
export function treasurySafeReadFailure(
  address: string,
  code: TreasurySafeFailureCode,
  message: string,
): TreasurySafeVerification {
  return fail(normalizeTreasuryAddress(address), null, code, message);
}

/**
 * Evaluates live reads against the PCART 2-of-3 foundation policy.
 * Every branch that cannot be proven returns a non-compatible result.
 */
export function evaluateSafeTreasury(reads: TreasurySafeReads): TreasurySafeVerification {
  const address = normalizeTreasuryAddress(reads.address);
  if (!isCandidateTreasuryAddress(address)) {
    return fail(address, reads.observedChainId, "INVALID_ADDRESS", "That is not a usable wallet address.");
  }
  if (reads.observedChainId !== ROBINHOOD_MAINNET_CHAIN_ID) {
    return fail(
      address,
      reads.observedChainId,
      "CHAIN_MISMATCH",
      "The network did not identify itself as Robinhood Chain mainnet, so nothing was verified.",
    );
  }
  if (!hasContractCode(reads.codeHex)) {
    return fail(
      address,
      reads.observedChainId,
      "NOT_A_CONTRACT",
      "No contract was found at this address. It looks like an ordinary wallet, not a multisig.",
    );
  }

  const owners = decodeAddressArray(reads.ownersData);
  const thresholdRaw = decodeUint256(reads.thresholdData);
  if (owners === null || thresholdRaw === null) {
    return fail(
      address,
      reads.observedChainId,
      "SAFE_INTERFACE_UNREADABLE",
      "This contract did not answer the standard multisig questions, so it cannot be confirmed as a Safe.",
      { isContract: true },
    );
  }

  const unique = new Set(owners);
  const anyZero = owners.some((o) => o === ZERO_ADDRESS);
  if (owners.length === 0 || anyZero || unique.size !== owners.length) {
    return fail(
      address,
      reads.observedChainId,
      "OWNER_SET_INVALID",
      "The owner list is not valid: it contains an empty or repeated owner.",
      { isContract: true },
    );
  }

  const threshold = thresholdRaw > 256n ? null : Number(thresholdRaw);
  if (threshold === null || threshold < 1 || threshold > owners.length) {
    return fail(
      address,
      reads.observedChainId,
      "SAFE_INTERFACE_UNREADABLE",
      "The required-signature setting is impossible for this owner list, so nothing was confirmed.",
      { isContract: true, owners, ownerCount: owners.length },
    );
  }

  const version = reads.versionData === undefined ? null : decodeString(reads.versionData);
  const base: TreasurySafeVerification = {
    address,
    chainId: reads.observedChainId,
    chainOk: true,
    isContract: true,
    owners,
    ownerCount: owners.length,
    threshold,
    version,
    isTwoOfThreeSafeCompatible: false,
    failureCode: null,
    message: "",
  };

  if (owners.length !== PCART_REQUIRED_OWNER_COUNT) {
    return {
      ...base,
      failureCode: "OWNER_COUNT_NOT_THREE",
      message: `This multisig has ${owners.length} owners. The PEPECARTEL treasury policy expects exactly 3.`,
    };
  }
  if (threshold !== PCART_REQUIRED_THRESHOLD) {
    return {
      ...base,
      failureCode: "THRESHOLD_NOT_TWO",
      message: `This multisig requires ${threshold} signature(s). The PEPECARTEL treasury policy expects exactly 2.`,
    };
  }

  return {
    ...base,
    isTwoOfThreeSafeCompatible: true,
    message: "Safe-compatible 2-of-3 multisig confirmed by live reads on Robinhood Chain mainnet.",
  };
}
