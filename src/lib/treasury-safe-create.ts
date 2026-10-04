/**
 * PCART treasury Safe creation — PURE LOGIC ONLY.
 *
 * Builds the exact canonical Safe v1.4.1 creation plan for the three SAVED
 * PEPECARTEL signer wallets: setup initializer, deterministic saltNonce,
 * SafeProxyFactory.createProxyWithNonce calldata and CREATE2 address
 * prediction, plus pure evaluation of the server-side managed-RPC preflight.
 *
 * WHAT THIS IS NOT: it never touches a wallet, never sends, never signs,
 * never reads the network and never persists anything. It is treasury setup
 * only and is completely separate from PCART token deployment controls
 * (ROBINHOOD_MAINNET_DEPLOYMENT / presign / canary / send-window), which it
 * neither reads nor changes.
 *
 * NARROW PIN EXCEPTION (closure regression L1C-6): this is the second and
 * only other file permitted to carry Safe identity constants, because the
 * creation transaction target and CREATE2 prediction must be pinned.
 */
import {
  concat,
  encodeAbiParameters,
  encodeFunctionData,
  encodePacked,
  getContractAddress,
  keccak256,
  pad,
} from "viem";

import { ROBINHOOD_MAINNET_CHAIN_ID } from "./chain-mainnet-registry";
import {
  CANONICAL_COMPATIBILITY_FALLBACK_HANDLER,
  isCandidateTreasuryAddress,
  normalizeTreasuryAddress,
  PCART_REQUIRED_THRESHOLD,
} from "./treasury-safe-verify";

/* ------------------------------------------------------------------ */
/* Canonical pins (verified on chain 4663 at block 77,725,506)          */
/* ------------------------------------------------------------------ */

export const SAFE_CREATE_SINGLETON = "0x29fcB43b46531BcA003ddC8FCB67FFE91900C762" as const;
export const SAFE_CREATE_SINGLETON_CODEHASH =
  "0xb1f926978a0f44a2c0ec8fe822418ae969bd8c3f18d61e5103100339894f81ff" as const;
export const SAFE_PROXY_FACTORY = "0x4e1DCf7AD4e460CfD30791CCC4F9c8a4f820ec67" as const;
export const SAFE_PROXY_FACTORY_CODEHASH =
  "0x50c3cdc4074750a7a974204a716c999edd37482f907608d960b2b025ee0b3317" as const;
export const SAFE_FALLBACK_HANDLER = CANONICAL_COMPATIBILITY_FALLBACK_HANDLER;
export const SAFE_FALLBACK_HANDLER_CODEHASH =
  "0x7c6007a5d711cea8dfd5d91f5940ec29c7f200fe511eb1fc1397b367af3c42f9" as const;
export const SAFE_PROXY_CREATION_CODE_HASH =
  "0x1856e0ee08399d74e0ea0b03adca210aeade6f748969ac023cdcb4dd62dcaf5f" as const;

export const ZERO_ADDRESS = "0x0000000000000000000000000000000000000000" as const;

/** Versioned salt domain. Changing it changes every predicted address. */
export const SAFE_SALT_DOMAIN = "cartel-hq/pcart-treasury-safe/v1" as const;

/* ------------------------------------------------------------------ */
/* Official ABI fragments (Safe v1.4.1 / SafeProxyFactory v1.4.1)        */
/* ------------------------------------------------------------------ */

export const SAFE_SETUP_ABI = [
  {
    name: "setup",
    type: "function",
    stateMutability: "nonpayable",
    inputs: [
      { name: "_owners", type: "address[]" },
      { name: "_threshold", type: "uint256" },
      { name: "to", type: "address" },
      { name: "data", type: "bytes" },
      { name: "fallbackHandler", type: "address" },
      { name: "paymentToken", type: "address" },
      { name: "payment", type: "uint256" },
      { name: "paymentReceiver", type: "address" },
    ],
    outputs: [],
  },
] as const;

export const SAFE_PROXY_FACTORY_ABI = [
  {
    name: "createProxyWithNonce",
    type: "function",
    stateMutability: "nonpayable",
    inputs: [
      { name: "_singleton", type: "address" },
      { name: "initializer", type: "bytes" },
      { name: "saltNonce", type: "uint256" },
    ],
    outputs: [{ name: "proxy", type: "address" }],
  },
  {
    name: "proxyCreationCode",
    type: "function",
    stateMutability: "pure",
    inputs: [],
    outputs: [{ name: "", type: "bytes" }],
  },
  {
    name: "getChainId",
    type: "function",
    stateMutability: "view",
    inputs: [],
    outputs: [{ name: "", type: "uint256" }],
  },
] as const;

export const FACTORY_PROXY_CREATION_CODE_CALL = encodeFunctionData({
  abi: SAFE_PROXY_FACTORY_ABI,
  functionName: "proxyCreationCode",
});
export const FACTORY_GET_CHAIN_ID_CALL = encodeFunctionData({
  abi: SAFE_PROXY_FACTORY_ABI,
  functionName: "getChainId",
});

/* ------------------------------------------------------------------ */
/* Plan construction                                                   */
/* ------------------------------------------------------------------ */

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

function normalizeOwners(signers: readonly string[]): `0x${string}`[] | null {
  if (!Array.isArray(signers) || signers.length !== 3) return null;
  const out = signers.map((s) => normalizeTreasuryAddress(String(s ?? "")));
  if (out.some((s) => !isCandidateTreasuryAddress(s))) return null;
  if (new Set(out).size !== 3) return null;
  return out as `0x${string}`[];
}

/** Exact Safe.setup initializer for a plain 2-of-3 with the canonical handler. */
export function encodeSafeSetupInitializer(signers: readonly string[]): `0x${string}` {
  const owners = normalizeOwners(signers);
  if (!owners) throw new Error("Exactly three distinct valid signer wallets are required.");
  return encodeFunctionData({
    abi: SAFE_SETUP_ABI,
    functionName: "setup",
    args: [
      owners,
      BigInt(PCART_REQUIRED_THRESHOLD),
      ZERO_ADDRESS,
      "0x",
      SAFE_FALLBACK_HANDLER,
      ZERO_ADDRESS,
      0n,
      ZERO_ADDRESS,
    ],
  });
}

/**
 * Deterministic uint256 saltNonce: keccak256(abi.encode(domain, launchId,
 * owner_1, owner_2, owner_3, threshold)). Same launch + same saved signers
 * always yields the same salt and therefore the same predicted Safe.
 */
export function deriveSafeSaltNonce(launchId: string, signers: readonly string[]): bigint {
  const id = String(launchId ?? "").trim().toLowerCase();
  if (!UUID_RE.test(id)) throw new Error("A valid launch id is required.");
  const owners = normalizeOwners(signers);
  if (!owners) throw new Error("Exactly three distinct valid signer wallets are required.");
  const encoded = encodeAbiParameters(
    [
      { type: "string" },
      { type: "string" },
      { type: "address" },
      { type: "address" },
      { type: "address" },
      { type: "uint256" },
    ],
    [SAFE_SALT_DOMAIN, id, owners[0]!, owners[1]!, owners[2]!, BigInt(PCART_REQUIRED_THRESHOLD)],
  );
  return BigInt(keccak256(encoded));
}

export function encodeCreateProxyWithNonce(
  initializer: `0x${string}`,
  saltNonce: bigint,
): `0x${string}` {
  return encodeFunctionData({
    abi: SAFE_PROXY_FACTORY_ABI,
    functionName: "createProxyWithNonce",
    args: [SAFE_CREATE_SINGLETON, initializer, saltNonce],
  });
}

/**
 * CREATE2 prediction exactly as SafeProxyFactory v1.4.1 deploys:
 * salt = keccak256(keccak256(initializer) ++ saltNonce),
 * initCode = proxyCreationCode ++ uint256(singleton).
 * Fails closed unless proxyCreationCode hashes to the pinned value.
 */
export function predictSafeAddress(
  initializer: `0x${string}`,
  saltNonce: bigint,
  proxyCreationCode: string,
): `0x${string}` | null {
  if (typeof proxyCreationCode !== "string" || !/^0x([0-9a-fA-F]{2})+$/.test(proxyCreationCode)) {
    return null;
  }
  if (keccak256(proxyCreationCode as `0x${string}`).toLowerCase() !== SAFE_PROXY_CREATION_CODE_HASH) {
    return null;
  }
  const salt = keccak256(
    encodePacked(["bytes32", "uint256"], [keccak256(initializer), saltNonce]),
  );
  const bytecode = concat([
    proxyCreationCode as `0x${string}`,
    pad(SAFE_CREATE_SINGLETON, { size: 32 }),
  ]);
  return getContractAddress({
    opcode: "CREATE2",
    from: SAFE_PROXY_FACTORY,
    salt,
    bytecode,
  }).toLowerCase() as `0x${string}`;
}

export type SafeCreationPlan = {
  launchId: string;
  owners: [string, string, string];
  threshold: 2;
  initializer: `0x${string}`;
  saltNonce: string; // decimal
  to: string; // SafeProxyFactory, lowercase
  value: "0x0";
  data: `0x${string}`;
};

/** Full deterministic plan from the saved signer row (no network). */
export function buildSafeCreationPlan(
  launchId: string,
  signers: readonly string[],
): SafeCreationPlan {
  const owners = normalizeOwners(signers);
  if (!owners) throw new Error("Exactly three distinct valid signer wallets are required.");
  const initializer = encodeSafeSetupInitializer(owners);
  const salt = deriveSafeSaltNonce(launchId, owners);
  return {
    launchId: launchId.trim().toLowerCase(),
    owners: [owners[0]!, owners[1]!, owners[2]!],
    threshold: 2,
    initializer,
    saltNonce: salt.toString(10),
    to: SAFE_PROXY_FACTORY.toLowerCase(),
    value: "0x0",
    data: encodeCreateProxyWithNonce(initializer, salt),
  };
}

/* ------------------------------------------------------------------ */
/* Preflight evaluation (pure; reads are performed server-side)         */
/* ------------------------------------------------------------------ */

export type SafePreflightReads = {
  observedChainId: number | null;
  blockNumber: string | null; // decimal
  singletonCode: unknown;
  factoryCode: unknown;
  fallbackHandlerCode: unknown;
  factoryGetChainIdData: unknown;
  proxyCreationCodeData: unknown; // ABI-encoded bytes return
  predictedAddressCode: unknown | ((predicted: string) => unknown);
};

export type SafePreflightBlocker =
  | "CHAIN_MISMATCH"
  | "SINGLETON_CODE_MISMATCH"
  | "FACTORY_CODE_MISMATCH"
  | "FALLBACK_HANDLER_CODE_MISMATCH"
  | "FACTORY_CHAIN_ID_MISMATCH"
  | "PROXY_CREATION_CODE_MISMATCH"
  | "PREDICTED_CODE_UNREADABLE"
  | "SAFE_ALREADY_DEPLOYED";

export type SafePreflightResult = {
  ok: boolean;
  /** true only when the predicted address already holds code: verify, never send. */
  alreadyDeployed: boolean;
  predictedAddress: string | null;
  blockNumber: string | null;
  blocker: SafePreflightBlocker | null;
  message: string;
};

function codeHashOf(code: unknown): string | null {
  if (typeof code !== "string" || !/^0x([0-9a-fA-F]{2})+$/.test(code)) return null;
  return keccak256(code as `0x${string}`).toLowerCase();
}

export function decodeAbiBytes(data: unknown): `0x${string}` | null {
  if (typeof data !== "string" || !/^0x([0-9a-fA-F]{2})*$/.test(data)) return null;
  const body = data.slice(2);
  if (body.length < 128 || body.length % 64 !== 0) return null;
  const offset = BigInt(`0x${body.slice(0, 64)}`);
  if (offset !== 32n) return null;
  const len = BigInt(`0x${body.slice(64, 128)}`);
  if (len === 0n || len > 24576n) return null;
  const n = Number(len) * 2;
  const bytes = body.slice(128, 128 + n);
  if (bytes.length !== n) return null;
  const paddedLen = Math.ceil(n / 64) * 64;
  if (body.length !== 128 + paddedLen) return null;
  if (!/^0*$/.test(body.slice(128 + n))) return null;
  return `0x${bytes}`;
}

function decodeUintWord(data: unknown): bigint | null {
  if (typeof data !== "string" || !/^0x[0-9a-fA-F]{64}$/.test(data)) return null;
  return BigInt(data);
}

const block = (r: SafePreflightReads, blocker: SafePreflightBlocker, message: string, predicted: string | null = null): SafePreflightResult => ({
  ok: false,
  alreadyDeployed: false,
  predictedAddress: predicted,
  blockNumber: r.blockNumber,
  blocker,
  message,
});

/**
 * Every check must pass for `ok`. An already-deployed predicted address is
 * NEVER sendable: it is reported as `alreadyDeployed` so the UI verifies it.
 */
export type SafePreflightPins = {
  singletonCodeHash: string;
  factoryCodeHash: string;
  fallbackHandlerCodeHash: string;
};

export const CANONICAL_SAFE_PREFLIGHT_PINS: SafePreflightPins = {
  singletonCodeHash: SAFE_CREATE_SINGLETON_CODEHASH,
  factoryCodeHash: SAFE_PROXY_FACTORY_CODEHASH,
  fallbackHandlerCodeHash: SAFE_FALLBACK_HANDLER_CODEHASH,
};

export function evaluateSafePreflight(
  plan: SafeCreationPlan,
  reads: SafePreflightReads,
): SafePreflightResult {
  return evaluateSafePreflightWithPins(plan, reads, CANONICAL_SAFE_PREFLIGHT_PINS);
}

/** Pin-parameterised core; production always uses CANONICAL_SAFE_PREFLIGHT_PINS. */
export function evaluateSafePreflightWithPins(
  plan: SafeCreationPlan,
  reads: SafePreflightReads,
  pins: SafePreflightPins,
): SafePreflightResult {
  if (reads.observedChainId !== ROBINHOOD_MAINNET_CHAIN_ID) {
    return block(reads, "CHAIN_MISMATCH", "The network is not Robinhood Chain mainnet.");
  }
  if (codeHashOf(reads.singletonCode) !== pins.singletonCodeHash.toLowerCase()) {
    return block(reads, "SINGLETON_CODE_MISMATCH", "The official Safe v1.4.1 contract could not be confirmed.");
  }
  if (codeHashOf(reads.factoryCode) !== pins.factoryCodeHash.toLowerCase()) {
    return block(reads, "FACTORY_CODE_MISMATCH", "The official Safe factory could not be confirmed.");
  }
  if (codeHashOf(reads.fallbackHandlerCode) !== pins.fallbackHandlerCodeHash.toLowerCase()) {
    return block(reads, "FALLBACK_HANDLER_CODE_MISMATCH", "The official Safe fallback handler could not be confirmed.");
  }
  if (decodeUintWord(reads.factoryGetChainIdData) !== BigInt(ROBINHOOD_MAINNET_CHAIN_ID)) {
    return block(reads, "FACTORY_CHAIN_ID_MISMATCH", "The Safe factory did not report Robinhood Chain.");
  }
  const pcc = decodeAbiBytes(reads.proxyCreationCodeData);
  const predicted = pcc ? predictSafeAddress(plan.initializer, BigInt(plan.saltNonce), pcc) : null;
  if (!predicted) {
    return block(reads, "PROXY_CREATION_CODE_MISMATCH", "The Safe factory's creation code did not match the official version.");
  }
  const predictedCode =
    typeof reads.predictedAddressCode === "function"
      ? reads.predictedAddressCode(predicted)
      : reads.predictedAddressCode;
  if (typeof predictedCode !== "string" || !/^0x([0-9a-fA-F]{2})*$/.test(predictedCode)) {
    return block(reads, "PREDICTED_CODE_UNREADABLE", "The predicted Safe address could not be checked.", predicted);
  }
  if (predictedCode.length > 2) {
    return {
      ok: false,
      alreadyDeployed: true,
      predictedAddress: predicted,
      blockNumber: reads.blockNumber,
      blocker: "SAFE_ALREADY_DEPLOYED",
      message: "A contract already exists at the predicted Safe address. It will be verified instead; nothing will be sent.",
    };
  }
  return {
    ok: true,
    alreadyDeployed: false,
    predictedAddress: predicted,
    blockNumber: reads.blockNumber,
    blocker: null,
    message: "Preflight passed. The Safe can be created.",
  };
}

/** Exposed for tests: decimal salt sanity. */
export function isDecimalSalt(value: string): boolean {
  return /^(0|[1-9][0-9]{0,77})$/.test(value) && BigInt(value) < 2n ** 256n;
}


/* ------------------------------------------------------------------ */
/* Creation receipt provenance (direct OR relayed / smart-wallet)        */
/* ------------------------------------------------------------------ */

/** keccak256("ProxyCreation(address,address)") — SafeProxyFactory v1.4.1. */
export const SAFE_PROXY_CREATION_EVENT_TOPIC =
  "0x4f51faf6c4561ff95f067657e43439f0f856d97c04d9ec9070a6199ad418e235" as const;

export type SafeReceiptProvenance =
  | { ok: true; path: "DIRECT_FACTORY" | "FACTORY_EVENT" }
  | { ok: false; reason: "RECEIPT_REVERTED" | "CREATION_PROOF_MISSING" };

export type SafeReceiptPins = { factory: string; singleton: string; topic: string };

export const CANONICAL_SAFE_RECEIPT_PINS: SafeReceiptPins = {
  factory: SAFE_PROXY_FACTORY,
  singleton: SAFE_CREATE_SINGLETON,
  topic: SAFE_PROXY_CREATION_EVENT_TOPIC,
};

const lc = (v: unknown) => (typeof v === "string" ? v.toLowerCase() : "");
const topicAddress = (t: unknown) => {
  const s = lc(t);
  return /^0x0{24}[0-9a-f]{40}$/.test(s) ? `0x${s.slice(26)}` : null;
};

/**
 * Pure provenance check. Success requires status 0x1 AND either the receipt
 * targets the pinned factory directly, or the receipt carries the pinned
 * factory's ProxyCreation log for exactly the predicted Safe with the pinned
 * singleton. tx.to, relay identity, signer type or code presence alone never
 * count. The fresh canonical Safe verifier must still run afterwards.
 */
export function evaluateSafeCreationReceipt(
  receipt: unknown,
  predictedSafe: string,
  pins: SafeReceiptPins = CANONICAL_SAFE_RECEIPT_PINS,
): SafeReceiptProvenance {
  const r = (receipt ?? {}) as { status?: unknown; to?: unknown; logs?: unknown };
  if (r.status !== "0x1") return { ok: false, reason: "RECEIPT_REVERTED" };
  const factory = lc(pins.factory);
  const predicted = lc(predictedSafe);
  const logs = Array.isArray(r.logs) ? r.logs : [];
  const eventProof = logs.some((raw) => {
    const l = (raw ?? {}) as { address?: unknown; topics?: unknown; data?: unknown; removed?: unknown };
    if (l.removed === true || lc(l.address) !== factory) return false;
    const topics = Array.isArray(l.topics) ? l.topics : [];
    if (topics.length !== 2 || lc(topics[0]) !== lc(pins.topic)) return false;
    if (topicAddress(topics[1]) !== predicted) return false;
    const data = lc(l.data);
    return data.length === 66 && topicAddress(data) === lc(pins.singleton);
  });
  if (lc(r.to) === factory) {
    // Direct path: preserved behaviour (status + exact factory target).
    return { ok: true, path: "DIRECT_FACTORY" };
  }
  return eventProof ? { ok: true, path: "FACTORY_EVENT" } : { ok: false, reason: "CREATION_PROOF_MISSING" };
}
