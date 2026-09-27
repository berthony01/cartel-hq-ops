/**
 * PCART-L3 — narrow launch artifact registry.
 *
 * Centralises artifact identity, init-code building, runtime hash, fixed token
 * intent and the per-environment allowlist so the launcher, verifier and UI
 * never duplicate them.
 *
 * ENVIRONMENT ALLOWLIST (mirrors the staged database constraint):
 *   - cartel-fixed-erc20-v1 : TESTNET + PRODUCTION (unchanged).
 *   - pepecartel-token-v1   : TESTNET rehearsal evidence ONLY. It is NOT
 *     production-allowlisted. Production allowlisting requires a separately
 *     reviewed migration after rehearsal, the real 2-of-3 signer configuration
 *     and canonical Safe verification.
 *
 * Nothing here signs, broadcasts, writes state or touches a network.
 */
import { encodeAbiParameters } from "viem";
import {
  CARTEL_FIXED_ERC20_ARTIFACT_ID,
  CARTEL_FIXED_ERC20_RUNTIME_BYTECODE_HASH,
} from "./cartel-fixed-erc20.artifact";
import {
  PEPECARTEL_TOKEN_ABI,
  PEPECARTEL_TOKEN_ARTIFACT_ID,
  PEPECARTEL_TOKEN_CREATION_BYTECODE,
  PEPECARTEL_TOKEN_CREATION_BYTECODE_KECCAK256,
  PEPECARTEL_TOKEN_DECIMALS,
  PEPECARTEL_TOKEN_NAME,
  PEPECARTEL_TOKEN_RUNTIME_BYTECODE_KECCAK256,
  PEPECARTEL_TOKEN_SYMBOL,
  PEPECARTEL_TOKEN_TOTAL_SUPPLY,
} from "./pepecartel-token.artifact";

export type LaunchNetworkEnvironment = "TESTNET" | "PRODUCTION";

export const ARTIFACT_ENVIRONMENT_ALLOWLIST = {
  [CARTEL_FIXED_ERC20_ARTIFACT_ID]: ["TESTNET", "PRODUCTION"],
  [PEPECARTEL_TOKEN_ARTIFACT_ID]: ["TESTNET"],
} as const satisfies Record<string, readonly LaunchNetworkEnvironment[]>;

export type RegisteredArtifactId = keyof typeof ARTIFACT_ENVIRONMENT_ALLOWLIST;

export function isArtifactAllowedIn(
  artifactId: string | null | undefined,
  environment: LaunchNetworkEnvironment,
): boolean {
  if (!artifactId || !(artifactId in ARTIFACT_ENVIRONMENT_ALLOWLIST)) return false;
  return (ARTIFACT_ENVIRONMENT_ALLOWLIST[artifactId as RegisteredArtifactId] as readonly string[]).includes(
    environment,
  );
}

export function runtimeHashForArtifact(artifactId: string | null | undefined): string | null {
  if (artifactId === CARTEL_FIXED_ERC20_ARTIFACT_ID) return CARTEL_FIXED_ERC20_RUNTIME_BYTECODE_HASH;
  if (artifactId === PEPECARTEL_TOKEN_ARTIFACT_ID) return PEPECARTEL_TOKEN_RUNTIME_BYTECODE_KECCAK256;
  return null;
}

/* ------------------------------------------------------------------ */
/* Canonical PEPECARTEL launch identity                                */
/* ------------------------------------------------------------------ */

/** Stable slug of the canonical PEPECARTEL PROJECT launch. */
export const CANONICAL_PCART_LAUNCH_SLUG = "pepecartel-launch" as const;
/** Pinned id of that launch (verified live, read-only). */
export const CANONICAL_PCART_LAUNCH_ID = "9f9af215-66ee-4a10-92db-617b61fb7fd3" as const;

export type LaunchIdentityHint = {
  id?: string | null;
  public_slug?: string | null;
  launch_kind?: string | null;
};

/**
 * UX isolation only. True when EITHER the pinned id or the canonical slug
 * matches, so the UI fails closed toward the blocked PCART path. The database
 * remains authoritative.
 */
export function isCanonicalPcartLaunch(launch: LaunchIdentityHint | null | undefined): boolean {
  if (!launch) return false;
  return (
    launch.id === CANONICAL_PCART_LAUNCH_ID ||
    (launch.public_slug ?? "").trim().toLowerCase() === CANONICAL_PCART_LAUNCH_SLUG
  );
}

/* ------------------------------------------------------------------ */
/* PCART fixed intent + init code                                      */
/* ------------------------------------------------------------------ */

export const PCART_FIXED_INTENT = {
  artifactId: PEPECARTEL_TOKEN_ARTIFACT_ID,
  name: PEPECARTEL_TOKEN_NAME,
  symbol: PEPECARTEL_TOKEN_SYMBOL,
  decimals: PEPECARTEL_TOKEN_DECIMALS,
  totalSupply: PEPECARTEL_TOKEN_TOTAL_SUPPLY,
  totalSupplyWhole: 1_000_000_000n,
  creationHash: PEPECARTEL_TOKEN_CREATION_BYTECODE_KECCAK256,
  runtimeHash: PEPECARTEL_TOKEN_RUNTIME_BYTECODE_KECCAK256,
} as const;

export const PCART_ABI = PEPECARTEL_TOKEN_ABI;

const ZERO = "0x0000000000000000000000000000000000000000";

/** Validates a TESTNET rehearsal recipient. Never the production treasury. */
export function normalizePcartRehearsalRecipient(value: string): `0x${string}` {
  const v = (value ?? "").trim().toLowerCase();
  if (!/^0x[0-9a-f]{40}$/.test(v)) throw new Error("Rehearsal recipient must be a valid EVM address.");
  if (v === ZERO) throw new Error("Rehearsal recipient cannot be the zero address.");
  return v as `0x${string}`;
}

/** Frozen pepecartel-token-v1 creation bytecode + ABI-encoded constructor(address). */
export function buildPcartInitCode(recipient: string): `0x${string}` {
  const r = normalizePcartRehearsalRecipient(recipient);
  const args = encodeAbiParameters([{ type: "address" }], [r]);
  return `${PEPECARTEL_TOKEN_CREATION_BYTECODE}${args.slice(2)}` as `0x${string}`;
}
