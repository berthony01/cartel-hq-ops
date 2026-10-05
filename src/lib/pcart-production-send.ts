/**
 * PCART P5 — pure helpers for the one-time mainnet send (no I/O, no wallet).
 *
 * Window gate, envelope integrity, error classification, local recovery marker
 * shape and summary state. The single wallet send lives ONLY in
 * pcart-production-send-wallet.ts.
 */
import { keccak256 } from "viem";

import { normalizeAddress } from "@/lib/pcart-production-intent";
import { buildPcartUnsignedEnvelope, pcartMaxCostWei, pcartUnsignedTxFingerprint, type PcartUnsignedEnvelope } from "@/lib/pcart-production-execution";

export const PCART_SEND_CONFIRM_PHRASE = "DEPLOY PCART" as const;
export const PCART_SEND_ACK_TEXT =
  "I am authorizing the one-time deployment of the real PEPECARTEL contract on Robinhood Chain mainnet." as const;
/** Mirrors the DB claim rule: a permit needs at least this much life left to be claimed. */
export const PCART_CLAIM_MIN_PERMIT_LIFETIME_MS = 10_000;
export const PCART_SEND_MARKER_PREFIX = "pcart-p5-send:" as const;
export const PCART_REQUIRED_LIFECYCLE = "LAUNCH_APPROACHING" as const;

export type PcartSendWindowState = "NO_WINDOW" | "WRONG_LIFECYCLE" | "BEFORE" | "OPEN" | "AFTER";

/** Mirrors the DB claim gate. Display only; the database re-checks with now(). */
export function pcartSendWindowState(
  start: string | null | undefined,
  end: string | null | undefined,
  lifecycle: string | null | undefined,
  nowMs: number,
): PcartSendWindowState {
  const s = start ? Date.parse(start) : NaN;
  const e = end ? Date.parse(end) : NaN;
  if (!Number.isFinite(s) || !Number.isFinite(e) || s >= e) return "NO_WINDOW";
  if (lifecycle !== PCART_REQUIRED_LIFECYCLE) return "WRONG_LIFECYCLE";
  if (nowMs < s) return "BEFORE";
  if (nowMs > e) return "AFTER";
  return "OPEN";
}

export function isPcartSendConfirmed(ack: boolean, typed: string): boolean {
  return ack === true && typed === PCART_SEND_CONFIRM_PHRASE;
}

export type PcartPermitForSend = {
  id: string;
  deployment_id: string;
  launch_id: string;
  wallet_account: string;
  deployer_nonce: number | string;
  safe_recipient: string;
  predicted_contract_address: string;
  init_code_hash: string;
  review_fingerprint: string;
  readiness_fingerprint: string;
  unsigned_tx_fingerprint: string;
  gas_limit: number | string;
  max_fee_per_gas: number | string;
  max_priority_fee_per_gas: number | string;
  issued_at: string;
  expires_at: string;
  cancelled_at: string | null;
  consumed_at: string | null;
};

function toBig(v: number | string): bigint {
  const s = typeof v === "number" ? (Number.isSafeInteger(v) ? String(v) : "") : String(v);
  if (!/^\d+$/.test(s)) throw new Error("Non-integer permit value");
  return BigInt(s);
}

/**
 * Rebuild the EXACT envelope from the frozen artifact + permit fields and prove it
 * matches the permit's init-code hash and unsigned fingerprint. Nothing is user-supplied.
 */
export function buildVerifiedPcartSendEnvelope(
  p: PcartPermitForSend,
  draft: { deployer: string; nonce: bigint; initCodeHash: string },
): { ok: true; envelope: PcartUnsignedEnvelope; maxCostWei: bigint } | { ok: false; reason: string } {
  try {
    const from = normalizeAddress(p.wallet_account);
    if (!from || from !== normalizeAddress(draft.deployer)) return { ok: false, reason: "WRONG_ACCOUNT" };
    const nonce = toBig(p.deployer_nonce);
    if (nonce !== draft.nonce) return { ok: false, reason: "NONCE_CHANGED" };
    const gas = toBig(p.gas_limit);
    const maxFee = toBig(p.max_fee_per_gas);
    const maxPriority = toBig(p.max_priority_fee_per_gas);
    const envelope = buildPcartUnsignedEnvelope(from, p.safe_recipient, gas);
    const hash = keccak256(envelope.data);
    if (hash !== p.init_code_hash.toLowerCase() || hash !== draft.initCodeHash.toLowerCase()) return { ok: false, reason: "INIT_CODE_MISMATCH" };
    const fp = pcartUnsignedTxFingerprint({
      deploymentId: p.deployment_id,
      launchId: p.launch_id,
      from,
      nonce,
      initCodeHash: hash,
      gasLimit: gas,
      maxFeePerGas: maxFee,
      maxPriorityFeePerGas: maxPriority,
      safe: p.safe_recipient,
      predicted: p.predicted_contract_address,
      reviewFingerprint: p.review_fingerprint,
      readinessFingerprint: p.readiness_fingerprint,
    });
    if (fp !== p.unsigned_tx_fingerprint.toLowerCase()) return { ok: false, reason: "FINGERPRINT_MISMATCH" };
    if ("to" in envelope || envelope.value !== "0x0") return { ok: false, reason: "ENVELOPE_INVALID" };
    return { ok: true, envelope, maxCostWei: pcartMaxCostWei(gas, maxFee) };
  } catch {
    return { ok: false, reason: "ENVELOPE_INVALID" };
  }
}

export function isPcartTxHash(v: unknown): v is string {
  return typeof v === "string" && /^0x[0-9a-fA-F]{64}$/.test(v);
}

export type PcartWalletOutcome = "HASH" | "REJECTED" | "AMBIGUOUS";

/** Only EIP-1193 4001 counts as a clean rejection. Everything else is ambiguous. */
export function classifyPcartWalletResult(result: unknown, error: unknown): PcartWalletOutcome {
  if (error === undefined || error === null) return isPcartTxHash(result) ? "HASH" : "AMBIGUOUS";
  const code = (error as { code?: unknown })?.code;
  return code === 4001 ? "REJECTED" : "AMBIGUOUS";
}

export type PcartSendMarker = {
  claimId: string;
  permitId: string;
  deploymentId: string;
  deployer: string;
  nonce: string;
  predicted: string;
  unsignedTxFingerprint: string;
  status: "SEND_IN_PROGRESS" | "HASH_RETURNED" | "REJECTED" | "AMBIGUOUS" | "RECORDED";
  txHash: string | null;
};

export const pcartSendMarkerKey = (deploymentId: string) => `${PCART_SEND_MARKER_PREFIX}${deploymentId.toLowerCase()}`;

export function readPcartSendMarker(deploymentId: string): PcartSendMarker | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = window.localStorage.getItem(pcartSendMarkerKey(deploymentId));
    if (!raw) return null;
    const m = JSON.parse(raw) as PcartSendMarker;
    return m && m.deploymentId?.toLowerCase() === deploymentId.toLowerCase() ? m : null;
  } catch {
    return null;
  }
}

export function writePcartSendMarker(m: PcartSendMarker): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(pcartSendMarkerKey(m.deploymentId), JSON.stringify(m));
  } catch {
    /* storage unavailable; server claim still blocks a second send */
  }
}

/** A marker that may represent a broadcast blocks every new send until reconciled. */
export function pcartMarkerBlocksSend(m: PcartSendMarker | null): boolean {
  return !!m && m.status !== "REJECTED";
}

export type PcartClaimLike = { claim_status: string; tx_hash: string | null } | null | undefined;

/** True while any claim/hash exists that forbids a new wallet send. */
export function pcartSendBlocked(claim: PcartClaimLike, marker: PcartSendMarker | null, deploymentTxHash: string | null | undefined): boolean {
  if (deploymentTxHash) return true;
  if (claim && claim.claim_status !== "RELEASED") return true;
  return pcartMarkerBlocksSend(marker);
}

export type PcartP5SummaryInput = {
  window: PcartSendWindowState;
  readyToSend: boolean;
  claimStatus: string | null;
  submitted: boolean;
};

/** Review & Launch line for P5. Never says "ready" with an expired permit (caller passes live state). */
export function pcartP5SummaryText(i: PcartP5SummaryInput): string | null {
  if (i.submitted || i.claimStatus === "BROADCAST") return "Mainnet transaction broadcast — verification required";
  if (i.claimStatus === "AMBIGUOUS") return "Deployment result unknown — do not retry";
  if (i.claimStatus === "CLAIMED") return "Deployment claimed — awaiting wallet decision";
  if (i.window === "BEFORE") return "Mainnet deployment scheduled — not yet available";
  if (i.window === "OPEN") return i.readyToSend ? "Mainnet deployment window open — ready to deploy" : "Mainnet deployment window open — fresh review required";
  if (i.window === "AFTER") return "Launch window closed — mainnet deployment unavailable";
  return null;
}
