/**
 * PCART-L1B — Safe treasury verification, PURE LOGIC ONLY.
 *
 * WHAT THIS IS: decoding and policy evaluation for a READ-ONLY check that a
 * candidate address on Robinhood Chain mainnet (4663) matches the CANONICAL
 * Safe v1.4.1 profile (SafeProxy runtime code hash, SafeL2 v1.4.1 masterCopy,
 * VERSION 1.4.1, no modules, no transaction guard, readable nonce) AND the
 * PCART 3-owner / threshold-2 policy.
 *
 * WHAT THIS IS NOT: it never creates a Safe, never selects or pins the actual
 * PEPECARTEL signer addresses, never signs, never broadcasts, never moves
 * value, never persists anything and holds no authority over any launch,
 * request or runtime control. A canonical pass is NOT "PCART treasury
 * approved" — the real signer set has not been selected yet.
 *
 * Everything here fails CLOSED: any malformed, ambiguous or unexpected input
 * yields "not verified" rather than a guess.
 */

import { encodeFunctionData, keccak256 } from "viem";

import { ROBINHOOD_MAINNET_CHAIN_ID } from "./chain-mainnet-registry";

/** Standard Safe read selectors (no state-changing selector exists here). */
export const SAFE_GET_OWNERS_SELECTOR = "0xa0e67e2b" as const;
export const SAFE_GET_THRESHOLD_SELECTOR = "0xe75235b8" as const;
export const SAFE_VERSION_SELECTOR = "0xffa1ad74" as const;
export const SAFE_MASTER_COPY_SELECTOR = "0xa619486e" as const;
export const SAFE_NONCE_SELECTOR = "0xaffed0e0" as const;

/**
 * Canonical Safe v1.4.1 identity pins. These are the ONLY external Safe
 * constants permitted inside src/** (closure regression L1C-6 narrow
 * exception) and they exist purely for read-only comparison.
 */
export const CANONICAL_SAFE_VERSION = "1.4.1" as const;
export const CANONICAL_SAFEL2_SINGLETON =
  "0x29fcB43b46531BcA003ddC8FCB67FFE91900C762" as const;
export const CANONICAL_SAFE_PROXY_RUNTIME_CODEHASH =
  "0xd7d408ebcd99b2b70be43e20253d6d92a8ea8fab29bd3be7f55b10032331fb4c" as const;
/** GuardManager (v1.4.1) transaction-guard storage slot. */
export const SAFE_GUARD_STORAGE_SLOT =
  "0x4a204f620c8c5ccdca3fd54d003badd85ba500436a431f0cbda4f558c93c34c8" as const;
/** SENTINEL_MODULES; an empty module list decodes as [] with next === sentinel. */
export const SAFE_SENTINEL_MODULES =
  "0x0000000000000000000000000000000000000001" as const;
export const SAFE_MODULES_PAGE_SIZE = 1n;

/** PCART foundation policy for this slice. */
export const PCART_REQUIRED_OWNER_COUNT = 3 as const;
export const PCART_REQUIRED_THRESHOLD = 2 as const;

const EVM_ADDRESS_RE = /^0x[0-9a-fA-F]{40}$/;
const ZERO_ADDRESS = "0x0000000000000000000000000000000000000000";
const ZERO_WORD = `0x${"0".repeat(64)}`;

const GET_MODULES_PAGINATED_ABI = [
  {
    name: "getModulesPaginated",
    type: "function",
    stateMutability: "view",
    inputs: [
      { name: "start", type: "address" },
      { name: "pageSize", type: "uint256" },
    ],
    outputs: [
      { name: "array", type: "address[]" },
      { name: "next", type: "address" },
    ],
  },
] as const;

/** Read-only calldata for getModulesPaginated(SENTINEL_MODULES, 1). */
export function encodeGetModulesPaginatedCall(): string {
  return encodeFunctionData({
    abi: GET_MODULES_PAGINATED_ABI,
    functionName: "getModulesPaginated",
    args: [SAFE_SENTINEL_MODULES, SAFE_MODULES_PAGE_SIZE],
  });
}

export type TreasurySafeFailureCode =
  | "INVALID_ADDRESS"
  | "PROVIDER_NOT_CONFIGURED"
  | "PROVIDER_UNREACHABLE"
  | "RPC_ERROR"
  | "MALFORMED_RESPONSE"
  | "CHAIN_MISMATCH"
  | "NOT_A_CONTRACT"
  | "PROXY_BYTECODE_MISMATCH"
  | "MASTERCOPY_UNREADABLE"
  | "SINGLETON_MISMATCH"
  | "VERSION_UNREADABLE"
  | "VERSION_MISMATCH"
  | "NONCE_UNREADABLE"
  | "MODULES_UNREADABLE"
  | "MODULES_PRESENT"
  | "GUARD_UNREADABLE"
  | "GUARD_PRESENT"
  | "SAFE_INTERFACE_UNREADABLE"
  | "OWNER_SET_INVALID"
  | "OWNER_COUNT_NOT_THREE"
  | "THRESHOLD_NOT_TWO";

export type TreasurySafeVerification = {
  address: string;
  chainId: number;
  chainOk: boolean;
  isContract: boolean;
  /** keccak256 of the deployed runtime code, when readable. */
  codeHash: string | null;
  proxyCodeHashOk: boolean;
  masterCopy: string | null;
  singletonOk: boolean;
  owners: string[];
  ownerCount: number;
  threshold: number | null;
  version: string | null;
  versionOk: boolean;
  nonce: string | null;
  nonceReadable: boolean;
  modulesEmpty: boolean;
  guardUnset: boolean;
  /** Full canonical Safe v1.4.1 profile + PCART 3-owner/threshold-2 policy. */
  isCanonicalSafeV141: boolean;
  /** Owner/threshold policy only. Never a standalone success signal. */
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

/** keccak256 of runtime bytecode, or null when the code read is unusable. */
export function runtimeCodeHash(codeHex: unknown): string | null {
  if (!hasContractCode(codeHex)) return null;
  try {
    return keccak256(codeHex as `0x${string}`).toLowerCase();
  } catch {
    return null;
  }
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

/** Strict single-word address decode (dirty upper bytes are rejected). */
export function decodeAddress(data: unknown): string | null {
  if (!isHexData(data)) return null;
  const w = words(data);
  if (w.length !== 1) return null;
  const word0 = w[0];
  if (word0 === undefined || !/^0{24}[0-9a-fA-F]{40}$/.test(word0)) return null;
  return `0x${word0.slice(24).toLowerCase()}`;
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
    if (word === undefined || !/^0{24}[0-9a-fA-F]{40}$/.test(word)) return null;
    out.push(`0x${word.slice(24).toLowerCase()}`);
  }

  return out;
}

/**
 * Strict decode of getModulesPaginated -> (address[] array, address next).
 * Head is [offset-to-array, next]; the array tail must be exactly sized.
 */
export function decodeModulesPaginated(
  data: unknown,
): { modules: string[]; next: string } | null {
  if (!isHexData(data)) return null;
  const w = words(data);
  if (w.length < 3) return null;
  let offset: bigint;
  let length: bigint;
  try {
    offset = BigInt(`0x${w[0]}`);
    length = BigInt(`0x${w[2]}`);
  } catch {
    return null;
  }
  if (offset !== 64n) return null;
  const nextWord = w[1];
  if (nextWord === undefined || !/^0{24}[0-9a-fA-F]{40}$/.test(nextWord)) return null;
  const next = `0x${nextWord.slice(24).toLowerCase()}`;
  if (length > 256n) return null;
  const count = Number(length);
  if (w.length !== 3 + count) return null;
  const modules: string[] = [];
  for (let i = 0; i < count; i += 1) {
    const word = w[3 + i];
    if (word === undefined || !/^0{24}[0-9a-fA-F]{40}$/.test(word)) return null;
    modules.push(`0x${word.slice(24).toLowerCase()}`);
  }
  return { modules, next };
}

/** Strict 32-byte storage word decode used for the transaction guard slot. */
export function decodeStorageWord(data: unknown): string | null {
  if (typeof data !== "string" || !/^0x[0-9a-fA-F]{64}$/.test(data)) return null;
  return data.toLowerCase();
}

/** Strict ABI string decode, used for the mandatory VERSION() read. */
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
  /** Raw hex from eth_call masterCopy(), or null when the read failed. */
  masterCopyData?: unknown;
  /** Raw hex from eth_call getOwners(), or null when the read failed. */
  ownersData: unknown;
  /** Raw hex from eth_call getThreshold(), or null when the read failed. */
  thresholdData: unknown;
  /** Raw hex from eth_call VERSION(); MANDATORY — unreadable now fails closed. */
  versionData?: unknown;
  /** Raw hex from eth_call nonce(), or null when the read failed. */
  nonceData?: unknown;
  /** Raw hex from eth_call getModulesPaginated(sentinel, 1). */
  modulesData?: unknown;
  /** Raw 32-byte word from eth_getStorageAt(guard slot). */
  guardStorageData?: unknown;
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
    codeHash: null,
    proxyCodeHashOk: false,
    masterCopy: null,
    singletonOk: false,
    owners: [],
    ownerCount: 0,
    threshold: null,
    version: null,
    versionOk: false,
    nonce: null,
    nonceReadable: false,
    modulesEmpty: false,
    guardUnset: false,
    isCanonicalSafeV141: false,
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
 * Evaluates live reads against the canonical Safe v1.4.1 profile AND the PCART
 * 3-owner / threshold-2 foundation policy. Every branch that cannot be proven
 * returns a non-verified result.
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

  const codeHash = runtimeCodeHash(reads.codeHex);
  if (codeHash === null || codeHash !== CANONICAL_SAFE_PROXY_RUNTIME_CODEHASH.toLowerCase()) {
    return fail(
      address,
      reads.observedChainId,
      "PROXY_BYTECODE_MISMATCH",
      "The code at this address is not the official Safe wallet code, so it was not accepted.",
      { isContract: true, codeHash },
    );
  }

  const masterCopy = decodeAddress(reads.masterCopyData);
  if (masterCopy === null) {
    return fail(
      address,
      reads.observedChainId,
      "MASTERCOPY_UNREADABLE",
      "This contract did not report which Safe implementation it uses, so nothing was confirmed.",
      { isContract: true, codeHash, proxyCodeHashOk: true },
    );
  }
  if (masterCopy !== CANONICAL_SAFEL2_SINGLETON.toLowerCase()) {
    return fail(
      address,
      reads.observedChainId,
      "SINGLETON_MISMATCH",
      "This wallet points at a non-official Safe implementation, so it was not accepted.",
      { isContract: true, codeHash, proxyCodeHashOk: true, masterCopy },
    );
  }

  const partialBase: Partial<TreasurySafeVerification> = {
    isContract: true,
    codeHash,
    proxyCodeHashOk: true,
    masterCopy,
    singletonOk: true,
  };

  const version = decodeString(reads.versionData);
  if (version === null) {
    return fail(
      address,
      reads.observedChainId,
      "VERSION_UNREADABLE",
      "The Safe version could not be read, so nothing was confirmed.",
      partialBase,
    );
  }
  if (version !== CANONICAL_SAFE_VERSION) {
    return fail(
      address,
      reads.observedChainId,
      "VERSION_MISMATCH",
      `This wallet reports version ${version}. The required version is ${CANONICAL_SAFE_VERSION}.`,
      { ...partialBase, version },
    );
  }

  const nonceRaw = decodeUint256(reads.nonceData);
  if (nonceRaw === null) {
    return fail(
      address,
      reads.observedChainId,
      "NONCE_UNREADABLE",
      "The Safe transaction counter could not be read, so nothing was confirmed.",
      { ...partialBase, version, versionOk: true },
    );
  }
  const nonce = nonceRaw.toString();

  const versionedBase: Partial<TreasurySafeVerification> = {
    ...partialBase,
    version,
    versionOk: true,
    nonce,
    nonceReadable: true,
  };

  const modules = decodeModulesPaginated(reads.modulesData);
  if (modules === null) {
    return fail(
      address,
      reads.observedChainId,
      "MODULES_UNREADABLE",
      "The Safe module list could not be read, so nothing was confirmed.",
      versionedBase,
    );
  }
  if (modules.modules.length !== 0 || modules.next.toLowerCase() !== SAFE_SENTINEL_MODULES) {
    return fail(
      address,
      reads.observedChainId,
      "MODULES_PRESENT",
      "This wallet has extra modules installed, which can bypass the owners. It was not accepted.",
      versionedBase,
    );
  }

  const guardWord = decodeStorageWord(reads.guardStorageData);
  if (guardWord === null) {
    return fail(
      address,
      reads.observedChainId,
      "GUARD_UNREADABLE",
      "The Safe guard setting could not be read, so nothing was confirmed.",
      { ...versionedBase, modulesEmpty: true },
    );
  }
  if (guardWord !== ZERO_WORD) {
    return fail(
      address,
      reads.observedChainId,
      "GUARD_PRESENT",
      "This wallet has a transaction guard installed, which can block or alter spending. It was not accepted.",
      { ...versionedBase, modulesEmpty: true },
    );
  }

  const canonicalBase: Partial<TreasurySafeVerification> = {
    ...versionedBase,
    modulesEmpty: true,
    guardUnset: true,
  };

  const owners = decodeAddressArray(reads.ownersData);
  const thresholdRaw = decodeUint256(reads.thresholdData);
  if (owners === null || thresholdRaw === null) {
    return fail(
      address,
      reads.observedChainId,
      "SAFE_INTERFACE_UNREADABLE",
      "This contract did not answer the standard multisig questions, so it cannot be confirmed as a Safe.",
      canonicalBase,
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
      canonicalBase,
    );
  }

  const threshold = thresholdRaw > 256n ? null : Number(thresholdRaw);
  if (threshold === null || threshold < 1 || threshold > owners.length) {
    return fail(
      address,
      reads.observedChainId,
      "SAFE_INTERFACE_UNREADABLE",
      "The required-signature setting is impossible for this owner list, so nothing was confirmed.",
      { ...canonicalBase, owners, ownerCount: owners.length },
    );
  }

  const base: TreasurySafeVerification = {
    address,
    chainId: reads.observedChainId,
    chainOk: true,
    isContract: true,
    codeHash,
    proxyCodeHashOk: true,
    masterCopy,
    singletonOk: true,
    owners,
    ownerCount: owners.length,
    threshold,
    version,
    versionOk: true,
    nonce,
    nonceReadable: true,
    modulesEmpty: true,
    guardUnset: true,
    isCanonicalSafeV141: false,
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
    isCanonicalSafeV141: true,
    message:
      "Canonical Safe v1.4.1 profile verified by live reads on Robinhood Chain mainnet. The exact PEPECARTEL signer addresses are not pinned by this check.",
  };
}
