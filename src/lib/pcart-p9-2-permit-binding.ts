/**
 * PCART P9.2 — pure binding rules for the EXISTING canonical PCART send permit.
 *
 * Deterministic live-attestation fingerprints (fed by the server-only P9.1 readers) and the exact
 * invalidation rules mirrored by the DB RPCs `issue_canonical_pcart_execution_permit_v2` and
 * `claim_canonical_pcart_mainnet_send_v2`. Canonical PCART stays CANONICAL_PCART_PROTECTED: the
 * permit is only valid while global execution is OFF and the emergency stop is ON at the bound
 * control revision. No RPC, wallet, signing or writes here.
 */
import { sha256, stringToBytes } from "viem";

import { P8A_MAINNET_DEPENDENCIES, P8A_MANIFEST_FINGERPRINT, P8A_MANIFEST_VERSION } from "@/lib/pcart-auction-liquidity-plan";
import { P8B_MANIFEST_FINGERPRINT, P8B_MANIFEST_VERSION, P8B_REAL_TREASURY_SAFE } from "@/lib/pcart-auction-execution-p8b";
import type { P9SafeSnapshot } from "@/lib/pcart-launch-coordinator-p9-live";

export const P9_2_BINDING_VERSION = "P9_2_DEPLOY_V1" as const;
export const P9_2_ACTION_TYPE = "DEPLOY_OFFICIAL_PCART" as const;
export const P9_2_CHAIN_ID = 4663 as const;
const low = (s: string | null | undefined) => String(s ?? "").trim().toLowerCase();

/** Preimage must stay byte-identical to the SQL pin in the P9.2 permit-binding migration. */
export function dependencyAttestationPreimage(observed: Record<string, string | null | undefined>): string | null {
  const parts: string[] = [];
  for (const d of [...P8A_MAINNET_DEPENDENCIES].sort((a, b) => (a.key < b.key ? -1 : a.key > b.key ? 1 : 0))) {
    const h = observed[d.key];
    if (!h || h === "0x" || low(h) !== low(d.codeHash)) return null; // fail closed: every pinned hash must match
    parts.push(`${d.key}=${low(d.address)}=${low(h)}`);
  }
  return ["pcart-p9-2-dep-attest-v1", "4663", ...parts].join("|");
}
export function dependencyAttestationFingerprint(observed: Record<string, string | null | undefined>): string | null {
  const pre = dependencyAttestationPreimage(observed);
  return pre ? sha256(stringToBytes(pre)) : null;
}

/** Safe attestation: pinned address/proxy hash/version, threshold 2, exact owner set, live nonce. */
export function safeAttestationPreimage(safe: Pick<P9SafeSnapshot, "status" | "owners" | "nonce" | "threshold" | "version">): string | null {
  if (safe.status !== "READY" || safe.nonce === null || safe.threshold !== 2) return null;
  const owners = safe.owners.map(low).sort().join(",");
  return ["pcart-p9-2-safe-attest-v1", "4663", low(P8B_REAL_TREASURY_SAFE.address), low(P8B_REAL_TREASURY_SAFE.proxyCodeHash), String(safe.version), "2", owners, String(safe.nonce)].join("|");
}
export function safeAttestationFingerprint(safe: Pick<P9SafeSnapshot, "status" | "owners" | "nonce" | "threshold" | "version">): string | null {
  const pre = safeAttestationPreimage(safe);
  return pre ? sha256(stringToBytes(pre)) : null;
}

// ------------------------------------------------------------ binding model (mirrors SQL checks)
export type BoundPermit = {
  bindingVersion: string | null;
  actionType: string | null;
  launchId: string;
  deploymentId: string;
  chainId: number;
  walletAccount: string;
  deployerNonce: string;
  predictedContractAddress: string;
  unsignedTxFingerprint: string;
  reviewFingerprint: string;
  p8aManifestVersion: string | null;
  p8aManifestFingerprint: string | null;
  p8aReviewId: string | null;
  p8bManifestVersion: string | null;
  p8bManifestFingerprint: string | null;
  p8bReviewId: string | null;
  dependencyAttestationFingerprint: string | null;
  safeAttestationFingerprint: string | null;
  executionControlRevision: string | null;
  expiresAt: string;
  consumedAt: string | null;
  cancelledAt: string | null;
};

export type CurrentFacts = {
  nowMs: number;
  launchId: string;
  deploymentId: string;
  attemptStatus: string;
  attemptTxHash: string | null;
  attemptSubmittedAt: string | null;
  attemptContractAddress: string | null;
  officialContractAddress: string | null;
  activeSendClaim: boolean;
  chainId: number;
  deployer: string;
  deployerNonce: string;
  predictedContractAddress: string;
  unsignedTxFingerprint: string;
  reviewFingerprint: string;
  p8aCurrentReview: { id: string; manifestVersion: string; manifestFingerprint: string } | null;
  p8bCurrentReview: { id: string; manifestVersion: string; manifestFingerprint: string } | null;
  liveDependencyAttestationFingerprint: string | null;
  liveSafeAttestationFingerprint: string | null;
  executionEnabled: boolean;
  emergencyStopEngaged: boolean;
  executionControlRevision: string;
};

export type BindingFailure =
  | "LEGACY_UNBOUND_PERMIT" | "WRONG_ACTION" | "PERMIT_EXPIRED" | "PERMIT_CONSUMED" | "PERMIT_CANCELLED"
  | "LAUNCH_MISMATCH" | "ATTEMPT_MISMATCH" | "ATTEMPT_NOT_DRAFT" | "TX_OR_CLAIM_EXISTS" | "OFFICIAL_CONTRACT_EXISTS"
  | "CHAIN_MISMATCH" | "DEPLOYER_MISMATCH" | "NONCE_MISMATCH" | "PREDICTED_ADDRESS_MISMATCH" | "UNSIGNED_TX_MISMATCH" | "REVIEW_MISMATCH"
  | "P8A_NOT_CURRENT" | "P8B_NOT_CURRENT" | "DEPENDENCY_ATTESTATION_MISMATCH" | "SAFE_ATTESTATION_MISMATCH"
  | "EXECUTION_NOT_PROTECTED" | "CONTROL_REVISION_CHANGED";

const policyCurrent = (r: CurrentFacts["p8aCurrentReview"], v: string, fp: string, boundId: string | null, boundV: string | null, boundFp: string | null) =>
  !!r && r.manifestVersion === v && low(r.manifestFingerprint) === low(fp) && r.id === boundId && boundV === v && low(boundFp) === low(fp);

/** Every failure that would make the DB claim reject. Empty array = permit still authorizes the claim. */
export function permitBindingFailures(p: BoundPermit, c: CurrentFacts): BindingFailure[] {
  const f: BindingFailure[] = [];
  if (p.bindingVersion !== P9_2_BINDING_VERSION) return ["LEGACY_UNBOUND_PERMIT"];
  if (p.actionType !== P9_2_ACTION_TYPE) f.push("WRONG_ACTION");
  if (p.cancelledAt) f.push("PERMIT_CANCELLED");
  if (p.consumedAt) f.push("PERMIT_CONSUMED");
  if (Date.parse(p.expiresAt) <= c.nowMs) f.push("PERMIT_EXPIRED");
  if (p.launchId !== c.launchId) f.push("LAUNCH_MISMATCH");
  if (p.deploymentId !== c.deploymentId) f.push("ATTEMPT_MISMATCH");
  if (c.attemptStatus !== "DRAFT") f.push("ATTEMPT_NOT_DRAFT");
  if (c.attemptTxHash || c.attemptSubmittedAt || c.attemptContractAddress || c.activeSendClaim) f.push("TX_OR_CLAIM_EXISTS");
  if (c.officialContractAddress) f.push("OFFICIAL_CONTRACT_EXISTS");
  if (p.chainId !== P9_2_CHAIN_ID || c.chainId !== P9_2_CHAIN_ID) f.push("CHAIN_MISMATCH");
  if (low(p.walletAccount) !== low(c.deployer)) f.push("DEPLOYER_MISMATCH");
  if (p.deployerNonce !== c.deployerNonce) f.push("NONCE_MISMATCH");
  if (low(p.predictedContractAddress) !== low(c.predictedContractAddress)) f.push("PREDICTED_ADDRESS_MISMATCH");
  if (low(p.unsignedTxFingerprint) !== low(c.unsignedTxFingerprint)) f.push("UNSIGNED_TX_MISMATCH");
  if (low(p.reviewFingerprint) !== low(c.reviewFingerprint)) f.push("REVIEW_MISMATCH");
  if (!policyCurrent(c.p8aCurrentReview, P8A_MANIFEST_VERSION, P8A_MANIFEST_FINGERPRINT, p.p8aReviewId, p.p8aManifestVersion, p.p8aManifestFingerprint)) f.push("P8A_NOT_CURRENT");
  if (!policyCurrent(c.p8bCurrentReview, P8B_MANIFEST_VERSION, P8B_MANIFEST_FINGERPRINT, p.p8bReviewId, p.p8bManifestVersion, p.p8bManifestFingerprint)) f.push("P8B_NOT_CURRENT");
  if (!c.liveDependencyAttestationFingerprint || low(c.liveDependencyAttestationFingerprint) !== low(p.dependencyAttestationFingerprint)) f.push("DEPENDENCY_ATTESTATION_MISMATCH");
  if (!c.liveSafeAttestationFingerprint || low(c.liveSafeAttestationFingerprint) !== low(p.safeAttestationFingerprint)) f.push("SAFE_ATTESTATION_MISMATCH");
  if (c.executionEnabled !== false || c.emergencyStopEngaged !== true) f.push("EXECUTION_NOT_PROTECTED");
  if (p.executionControlRevision !== c.executionControlRevision) f.push("CONTROL_REVISION_CHANGED");
  return f;
}

/** Issuance gate (pre-insert). Same protected-control semantics: OFF + stop ON, never the reverse. */
export function issuanceBlockers(c: Omit<CurrentFacts, "nowMs" | "unsignedTxFingerprint" | "reviewFingerprint" | "predictedContractAddress" | "deployer" | "deployerNonce"> & { activePermit: boolean }): BindingFailure[] {
  const f: BindingFailure[] = [];
  if (c.attemptStatus !== "DRAFT") f.push("ATTEMPT_NOT_DRAFT");
  if (c.attemptTxHash || c.attemptSubmittedAt || c.attemptContractAddress || c.activeSendClaim || c.activePermit) f.push("TX_OR_CLAIM_EXISTS");
  if (c.officialContractAddress) f.push("OFFICIAL_CONTRACT_EXISTS");
  if (c.chainId !== P9_2_CHAIN_ID) f.push("CHAIN_MISMATCH");
  if (!c.p8aCurrentReview || c.p8aCurrentReview.manifestVersion !== P8A_MANIFEST_VERSION || low(c.p8aCurrentReview.manifestFingerprint) !== low(P8A_MANIFEST_FINGERPRINT)) f.push("P8A_NOT_CURRENT");
  if (!c.p8bCurrentReview || c.p8bCurrentReview.manifestVersion !== P8B_MANIFEST_VERSION || low(c.p8bCurrentReview.manifestFingerprint) !== low(P8B_MANIFEST_FINGERPRINT)) f.push("P8B_NOT_CURRENT");
  if (!c.liveDependencyAttestationFingerprint) f.push("DEPENDENCY_ATTESTATION_MISMATCH");
  if (!c.liveSafeAttestationFingerprint) f.push("SAFE_ATTESTATION_MISMATCH");
  if (c.executionEnabled !== false || c.emergencyStopEngaged !== true) f.push("EXECUTION_NOT_PROTECTED");
  return f;
}
