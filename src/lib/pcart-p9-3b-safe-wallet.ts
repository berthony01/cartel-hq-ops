/**
 * PCART P9.3B — browser helpers for Treasury Safe signing and the single execTransaction handoff.
 * Uses ONLY the existing hardened connector (getActiveProvider / getActiveAccount). No new provider stack,
 * no window.ethereum fallback, no Safe Transaction Service. Called only from explicit button clicks.
 */
import { getActiveAccount, getActiveProvider } from "@/lib/wallet-connector";
import { classifyHandoff, type HandoffOutcome } from "@/lib/pcart-launch-coordinator-p9-3b";

export type WalletCheck = { ok: true; account: string } | { ok: false; reason: "NO_WALLET" | "WRONG_WALLET" | "WRONG_CHAIN" | "READ_FAILED" };

/** `eligible` = the server-derived Option 1 signer set (two plain-EOA owners). */
export async function checkTreasuryOwnerWallet(eligible: readonly string[]): Promise<WalletCheck> {
  const p = getActiveProvider();
  const acct = getActiveAccount()?.toLowerCase() ?? null;
  if (!p || !acct) return { ok: false, reason: "NO_WALLET" };
  if (eligible.length !== 2 || !eligible.map((e) => e.toLowerCase()).includes(acct)) return { ok: false, reason: "WRONG_WALLET" };
  try {
    const chain = (await p.request({ method: "eth_chainId" })) as string;
    if (typeof chain !== "string" || Number(BigInt(chain)) !== 4663) return { ok: false, reason: "WRONG_CHAIN" };
  } catch { return { ok: false, reason: "READ_FAILED" }; }
  return { ok: true, account: acct };
}

/** One eth_signTypedData_v4 request for the exact Safe typed data. Closing the wallet returns null (not a failure). */
export async function signSafeTypedData(account: string, typedDataJson: string): Promise<{ signature: string | null; closed: boolean }> {
  const p = getActiveProvider();
  if (!p) return { signature: null, closed: true };
  try {
    const sig = await p.request({ method: "eth_signTypedData_v4", params: [account, typedDataJson] });
    return typeof sig === "string" ? { signature: sig, closed: false } : { signature: null, closed: true };
  } catch { return { signature: null, closed: true }; }
}

const sentActions = new Set<string>();
/** Exactly one eth_sendTransaction per action per page; a second call never reaches the wallet. */
export async function sendSafeExecutionOnce(actionId: string, tx: { from: string; to: string; data: string; value: string }): Promise<{ outcome: HandoffOutcome; txHash: string | null }> {
  if (sentActions.has(actionId)) return { outcome: "AMBIGUOUS", txHash: null };
  sentActions.add(actionId);
  const p = getActiveProvider();
  if (!p || getActiveAccount()?.toLowerCase() !== tx.from.toLowerCase()) return { outcome: "AMBIGUOUS", txHash: null };
  let result: unknown, error: unknown = null;
  try { result = await p.request({ method: "eth_sendTransaction", params: [tx] }); } catch (e) { error = e ?? new Error("unknown"); }
  const outcome = classifyHandoff(result, error);
  return { outcome, txHash: outcome === "HASH" ? String(result).toLowerCase() : null };
}
