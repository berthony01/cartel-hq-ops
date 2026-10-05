/**
 * PCART P2 — canonical production deployment INTENT (pure, no I/O).
 *
 * Builds the exact pepecartel-token-v1 creation init code with the verified
 * Treasury Safe as the single constructor argument, hashes it, predicts the
 * CREATE address for a pinned deployer + nonce, and derives a deterministic
 * review fingerprint that the database recomputes independently.
 *
 * This module has NO provider, wallet, signer or transport logic. It never
 * imports the generic cartel-fixed-erc20 intent for token identity.
 */
import { encodeAbiParameters, getContractAddress, keccak256, sha256, stringToBytes } from "viem";

import {
  PEPECARTEL_TOKEN_ARTIFACT_ID,
  PEPECARTEL_TOKEN_CREATION_BYTECODE,
  PEPECARTEL_TOKEN_DECIMALS,
  PEPECARTEL_TOKEN_NAME,
  PEPECARTEL_TOKEN_SYMBOL,
  PEPECARTEL_TOKEN_TOTAL_SUPPLY,
} from "@/lib/pepecartel-token.artifact";

export const PCART_PRODUCTION_CHAIN_ID = 4663 as const;
export const PCART_PRODUCTION_ENVIRONMENT = "PRODUCTION" as const;
export const PCART_PRODUCTION_REVIEW_TTL_MS = 90_000;
export const PCART_PRODUCTION_FINGERPRINT_DOMAIN = "pcart-production-review-v1" as const;

/** Pinned verified Treasury Safe (also pinned by the readiness approval and the DB RPC). */
export const PCART_PRODUCTION_TREASURY_SAFE = "0xe0d055b3e07c2d1d9c1762ca9e19b3062207ad03" as const;

const ADDRESS = /^0x[0-9a-f]{40}$/;
const ZERO = "0x0000000000000000000000000000000000000000";

export function normalizeAddress(value: unknown): string | null {
  const v = typeof value === "string" ? value.trim().toLowerCase() : "";
  return ADDRESS.test(v) && v !== ZERO ? v : null;
}

/** Exact creation init code: frozen bytecode ++ abi.encode(address treasury_). */
export function buildPcartProductionInitCode(safeAddress: string): `0x${string}` {
  const safe = normalizeAddress(safeAddress);
  if (!safe) throw new Error("Invalid Treasury Safe recipient");
  const args = encodeAbiParameters([{ type: "address" }], [safe as `0x${string}`]);
  return `${PEPECARTEL_TOKEN_CREATION_BYTECODE}${args.slice(2)}` as `0x${string}`;
}

export function pcartProductionInitCodeHash(safeAddress: string): `0x${string}` {
  return keccak256(buildPcartProductionInitCode(safeAddress));
}

export function predictPcartProductionAddress(deployer: string, nonce: bigint): string {
  const d = normalizeAddress(deployer);
  if (!d) throw new Error("Invalid deployer");
  if (nonce < 0n) throw new Error("Invalid nonce");
  return getContractAddress({ from: d as `0x${string}`, nonce }).toLowerCase();
}

export type PcartProductionFingerprintInput = {
  launchId: string;
  safeAddress: string;
  deployer: string;
  nonce: bigint;
  initCodeHash: string;
  readinessFingerprint: string;
};

/** Must stay byte-identical to the concat_ws in create_canonical_pcart_production_draft. */
export function pcartProductionFingerprintPreimage(i: PcartProductionFingerprintInput): string {
  return [
    PCART_PRODUCTION_FINGERPRINT_DOMAIN,
    i.launchId.toLowerCase(),
    PEPECARTEL_TOKEN_ARTIFACT_ID,
    String(PCART_PRODUCTION_CHAIN_ID),
    PCART_PRODUCTION_ENVIRONMENT,
    PEPECARTEL_TOKEN_NAME,
    PEPECARTEL_TOKEN_SYMBOL,
    String(PEPECARTEL_TOKEN_DECIMALS),
    PEPECARTEL_TOKEN_TOTAL_SUPPLY.toString(),
    i.safeAddress.toLowerCase(),
    i.deployer.toLowerCase(),
    i.nonce.toString(),
    i.initCodeHash.toLowerCase(),
    i.readinessFingerprint.toLowerCase(),
  ].join("|");
}

export function pcartProductionReviewFingerprint(i: PcartProductionFingerprintInput): `0x${string}` {
  return sha256(stringToBytes(pcartProductionFingerprintPreimage(i)));
}

/** Deployer must be one of the exact three saved signers and never the Safe. */
export function isAllowedPcartDeployer(deployer: string, signers: readonly string[], safe: string): boolean {
  const d = normalizeAddress(deployer);
  const s = normalizeAddress(safe);
  if (!d || !s || d === s) return false;
  const set = signers.map((x) => normalizeAddress(x)).filter((x): x is string => !!x);
  return set.length === 3 && new Set(set).size === 3 && set.includes(d);
}

export function isPcartReviewFresh(reviewedAtMs: number, nowMs: number): boolean {
  return Number.isFinite(reviewedAtMs) && nowMs >= reviewedAtMs && nowMs - reviewedAtMs < PCART_PRODUCTION_REVIEW_TTL_MS;
}

export function shortAddress(a: string): string {
  return a.length > 12 ? `${a.slice(0, 6)}…${a.slice(-4)}` : a;
}
