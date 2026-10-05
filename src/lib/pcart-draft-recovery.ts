/**
 * PCART testnet rehearsal — unsent DRAFT recovery (read-only proofs).
 *
 * A DRAFT row is created BEFORE the wallet broadcast. On mobile the page can
 * be frozen/killed during the wallet handoff, so the in-page abandon never
 * runs. This module proves, from chain state read through the SAME bound
 * Testnet Lab provider, whether such a draft was never broadcast.
 *
 * Fail closed: anything not provable is UNKNOWN and must never be abandoned
 * (it may be broadcast-but-unrecorded and must go through recovery instead).
 * Nothing here signs, sends, switches networks or writes data.
 */
import { getContractAddress } from "viem";
import { getLauncherProvider, readAccount, readChainId } from "./chain-launcher";
import { ROBINHOOD_TESTNET_CHAIN_ID } from "./chain-registry";

export type NoncePair = { latest: bigint; pending: bigint };

export type DraftRecoveryRow = {
  status: string;
  tx_hash: string | null;
  submitted_at: string | null;
  contract_address: string | null;
  deployer_address: string;
  deployer_nonce_before?: number | string | null;
};

/** Only an unsent DRAFT with no broadcast evidence may be inspected. */
export function isResolvableDraft(row: DraftRecoveryRow): boolean {
  return (
    row.status === "DRAFT" && !row.tx_hash && !row.submitted_at && !row.contract_address
  );
}

/** Read-only: latest + pending transaction counts on the bound provider. */
export async function readNoncePair(address: string): Promise<NoncePair | null> {
  const provider = getLauncherProvider();
  if (!provider) return null;
  try {
    const [l, p] = await Promise.all([
      provider.request({ method: "eth_getTransactionCount", params: [address, "latest"] }),
      provider.request({ method: "eth_getTransactionCount", params: [address, "pending"] }),
    ]);
    if (typeof l !== "string" || typeof p !== "string") return null;
    if (!/^0x[0-9a-f]+$/i.test(l) || !/^0x[0-9a-f]+$/i.test(p)) return null;
    return { latest: BigInt(l), pending: BigInt(p) };
  } catch {
    return null;
  }
}

/** Read-only: deployed code at an address on the bound provider. */
export async function readCodeAt(address: string): Promise<string | null> {
  const provider = getLauncherProvider();
  if (!provider) return null;
  try {
    const code = await provider.request({ method: "eth_getCode", params: [address, "latest"] });
    return typeof code === "string" ? code.toLowerCase() : null;
  } catch {
    return null;
  }
}

export type PreAttemptGate =
  | { ok: true; nonce: bigint }
  | { ok: false; reason: "WALLET_CHANGED" | "READ_FAILED" | "IN_FLIGHT" };

/** Pure pre-create gate (exported for regression tests). */
export function evaluatePreAttemptGate(input: {
  expectedAccount: string;
  liveAccount: string | null;
  chainId: number | null;
  nonces: NoncePair | null;
}): PreAttemptGate {
  if (
    input.chainId !== ROBINHOOD_TESTNET_CHAIN_ID ||
    !input.liveAccount ||
    input.liveAccount.toLowerCase() !== input.expectedAccount.toLowerCase()
  ) {
    return { ok: false, reason: "WALLET_CHANGED" };
  }
  if (!input.nonces) return { ok: false, reason: "READ_FAILED" };
  if (input.nonces.latest !== input.nonces.pending) return { ok: false, reason: "IN_FLIGHT" };
  return { ok: true, nonce: input.nonces.latest };
}

/** Live pre-create read on the SAME bound connector, immediately before the draft. */
export async function readPreAttemptGate(expectedAccount: string): Promise<PreAttemptGate> {
  const chainId = await readChainId();
  const liveAccount = await readAccount();
  const nonces = liveAccount ? await readNoncePair(liveAccount) : null;
  return evaluatePreAttemptGate({ expectedAccount, liveAccount, chainId, nonces });
}

export type DraftClassification =
  | { kind: "PROVEN_UNBROADCAST"; nonce: bigint; createAddress: string }
  | {
      kind: "UNKNOWN";
      reason:
        | "NOT_RESOLVABLE"
        | "WALLET_MISMATCH"
        | "WRONG_CHAIN"
        | "READ_FAILED"
        | "NONCE_MOVED"
        | "IN_FLIGHT"
        | "LEGACY_NOT_PROVABLE"
        | "CODE_PRESENT";
    };

function storedNonce(row: DraftRecoveryRow): bigint | null {
  const v = row.deployer_nonce_before;
  if (v === null || v === undefined) return null;
  try {
    const n = BigInt(v);
    return n >= 0n ? n : null;
  } catch {
    return null;
  }
}

/** Which nonce/CREATE address must be checked, or null if no proof is possible. */
export function recoveryProbe(
  row: DraftRecoveryRow,
  nonces: NoncePair,
): { nonce: bigint; createAddress: string } | DraftClassification {
  if (nonces.latest !== nonces.pending) return { kind: "UNKNOWN", reason: "IN_FLIGHT" };
  const stored = storedNonce(row);
  const target = stored ?? 0n;
  if (stored === null && row.deployer_nonce_before !== null && row.deployer_nonce_before !== undefined) {
    return { kind: "UNKNOWN", reason: "LEGACY_NOT_PROVABLE" };
  }
  if (nonces.latest !== target) {
    return { kind: "UNKNOWN", reason: stored === null ? "LEGACY_NOT_PROVABLE" : "NONCE_MOVED" };
  }
  const createAddress = getContractAddress({
    from: row.deployer_address as `0x${string}`,
    nonce: target,
  }).toLowerCase();
  return { nonce: target, createAddress };
}

/** Pure classifier (exported for regression tests). */
export function classifyDraft(input: {
  row: DraftRecoveryRow;
  liveAccount: string | null;
  chainId: number | null;
  nonces: NoncePair | null;
  code: string | null;
}): DraftClassification {
  const { row } = input;
  if (!isResolvableDraft(row)) return { kind: "UNKNOWN", reason: "NOT_RESOLVABLE" };
  if (!input.liveAccount || input.liveAccount.toLowerCase() !== row.deployer_address.toLowerCase()) {
    return { kind: "UNKNOWN", reason: "WALLET_MISMATCH" };
  }
  if (input.chainId !== ROBINHOOD_TESTNET_CHAIN_ID) return { kind: "UNKNOWN", reason: "WRONG_CHAIN" };
  if (!input.nonces) return { kind: "UNKNOWN", reason: "READ_FAILED" };
  const probe = recoveryProbe(row, input.nonces);
  if ("kind" in probe) return probe;
  if (input.code === null) return { kind: "UNKNOWN", reason: "READ_FAILED" };
  if (input.code !== "0x") return { kind: "UNKNOWN", reason: "CODE_PRESENT" };
  return { kind: "PROVEN_UNBROADCAST", nonce: probe.nonce, createAddress: probe.createAddress };
}

/** Live recovery check on the SAME bound connector. Explicit click only. */
export async function checkDraftRecovery(row: DraftRecoveryRow): Promise<DraftClassification> {
  if (!isResolvableDraft(row)) return { kind: "UNKNOWN", reason: "NOT_RESOLVABLE" };
  const chainId = await readChainId();
  const liveAccount = await readAccount();
  const nonces = liveAccount ? await readNoncePair(liveAccount) : null;
  let code: string | null = null;
  if (nonces && liveAccount && liveAccount === row.deployer_address.toLowerCase()) {
    const probe = recoveryProbe(row, nonces);
    if (!("kind" in probe)) code = await readCodeAt(probe.createAddress);
  }
  return classifyDraft({ row, liveAccount, chainId, nonces, code });
}

export const RECOVERY_ABANDON_REASON = "Confirmed unbroadcast after recovery check" as const;
