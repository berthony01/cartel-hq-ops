/**
 * PCART P5 — the ONLY place in the app that asks a wallet to send the PCART
 * mainnet deployment. Exactly one eth_sendTransaction per claim, explicit click
 * only, through the SAME explicitly bound provider used for evidence reads.
 */
import { getPcartBoundProviderForSend, PCART_MAINNET_CHAIN_ID } from "@/lib/pcart-production-wallet";
import { normalizeAddress } from "@/lib/pcart-production-intent";
import type { PcartUnsignedEnvelope } from "@/lib/pcart-production-execution";
import { classifyPcartWalletResult, type PcartWalletOutcome } from "@/lib/pcart-production-send";

const sentClaims = new Set<string>();

export type PcartPreSendCheck =
  | { ok: true }
  | { ok: false; reason: "NO_WALLET" | "WRONG_ACCOUNT" | "WRONG_CHAIN" | "NONCE_PENDING" | "NONCE_CHANGED" | "INSUFFICIENT_BALANCE" | "PREDICTED_ADDRESS_HAS_CODE" | "READ_FAILED" };

const hex = (v: unknown) => (typeof v === "string" && /^0x[0-9a-fA-F]*$/.test(v) ? v : null);

/** Fresh read-only checks on the bound provider immediately before the wallet request. */
export async function pcartPreSendCheck(args: { deployer: string; nonce: bigint; predicted: string; maxCostWei: bigint }): Promise<PcartPreSendCheck> {
  const b = getPcartBoundProviderForSend();
  if (!b) return { ok: false, reason: "NO_WALLET" };
  try {
    const p = b.provider;
    const accounts = (await p.request({ method: "eth_accounts" })) as unknown;
    const list = Array.isArray(accounts) ? accounts.map((a) => normalizeAddress(a)) : [];
    const dep = normalizeAddress(args.deployer);
    if (!dep || b.account !== dep || !list.includes(dep)) return { ok: false, reason: "WRONG_ACCOUNT" };
    const chain = hex(await p.request({ method: "eth_chainId" }));
    if (!chain || Number(BigInt(chain)) !== PCART_MAINNET_CHAIN_ID) return { ok: false, reason: "WRONG_CHAIN" };
    const [latest, pending, bal, code] = await Promise.all([
      p.request({ method: "eth_getTransactionCount", params: [dep, "latest"] }),
      p.request({ method: "eth_getTransactionCount", params: [dep, "pending"] }),
      p.request({ method: "eth_getBalance", params: [dep, "latest"] }),
      p.request({ method: "eth_getCode", params: [args.predicted, "latest"] }),
    ]);
    const l = hex(latest), pe = hex(pending), bb = hex(bal), c = hex(code);
    if (!l || !pe || !bb || c === null) return { ok: false, reason: "READ_FAILED" };
    if (BigInt(l) !== BigInt(pe)) return { ok: false, reason: "NONCE_PENDING" };
    if (BigInt(l) !== args.nonce) return { ok: false, reason: "NONCE_CHANGED" };
    if (BigInt(bb) < args.maxCostWei) return { ok: false, reason: "INSUFFICIENT_BALANCE" };
    if (c !== "0x" && c !== "0x0") return { ok: false, reason: "PREDICTED_ADDRESS_HAS_CODE" };
    return { ok: true };
  } catch {
    return { ok: false, reason: "READ_FAILED" };
  }
}

/**
 * Sends the exact reviewed CREATE envelope ONCE for this claim. A second call for the
 * same claim (re-render, double click, retry) never reaches the wallet.
 */
export async function sendCanonicalPcartDeploymentOnce(
  claimId: string,
  envelope: PcartUnsignedEnvelope,
): Promise<{ outcome: PcartWalletOutcome; txHash: string | null }> {
  if (sentClaims.has(claimId)) return { outcome: "AMBIGUOUS", txHash: null };
  sentClaims.add(claimId);
  const b = getPcartBoundProviderForSend();
  if (!b || b.account !== normalizeAddress(envelope.from)) return { outcome: "AMBIGUOUS", txHash: null };
  const tx = { from: envelope.from, data: envelope.data, value: envelope.value, gas: envelope.gas };
  let result: unknown;
  let error: unknown = null;
  try {
    result = await b.provider.request({ method: "eth_sendTransaction", params: [tx] });
  } catch (e) {
    error = e ?? new Error("unknown");
  }
  const outcome = classifyPcartWalletResult(result, error);
  return { outcome, txHash: outcome === "HASH" ? String(result).toLowerCase() : null };
}
