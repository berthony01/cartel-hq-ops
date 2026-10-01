/**
 * PCART treasury Safe creation — browser wallet send.
 *
 * Exactly ONE user-triggered `eth_sendTransaction` to the canonical
 * SafeProxyFactory, value 0, with calldata re-derived locally from the saved
 * signers and launch id and compared byte-for-byte with the server plan.
 * No retry, no rebroadcast, no chain switching, no fallback to raw calldata.
 * An unclear wallet outcome is AMBIGUOUS: the caller must check the predicted
 * Safe address read-only and must never offer another send.
 *
 * This is treasury setup only. It does not import, read or change any PCART
 * token deployment control (send-window, presign, canary, emergency stop).
 */
import { ROBINHOOD_MAINNET_CHAIN_ID } from "./chain-mainnet-registry";
import { buildSafeCreationPlan, SAFE_PROXY_FACTORY, type SafeCreationPlan } from "./treasury-safe-create";
import { getActiveAccount, getActiveProvider, isActiveAccountVerified, normalizeChainId } from "./wallet-connector";

export type SafeSendNotice =
  | "NO_WALLET"
  | "ACCOUNT_UNVERIFIED"
  | "NOT_A_SIGNER"
  | "WRONG_CHAIN"
  | "PLAN_MISMATCH"
  | "PREFLIGHT_NOT_PASSED"
  | "AMBIGUOUS_SEND_OUTCOME"
  | "INVALID_TX_HASH";

export type SafeSendResult = {
  ok: boolean;
  notice: SafeSendNotice | null;
  /** True once eth_sendTransaction was invoked. Never resend after this. */
  sendInvoked: boolean;
  txHash: string | null;
};

const HASH32 = /^0x[0-9a-f]{64}$/;
const pre = (notice: SafeSendNotice): SafeSendResult => ({ ok: false, notice, sendInvoked: false, txHash: null });

/** Pure pre-send gate, exported for regression tests. */
export function evaluateSafeSendGate(input: {
  plan: SafeCreationPlan;
  launchId: string;
  savedSigners: readonly string[];
  preflightOk: boolean;
  account: string | null;
  accountVerified: boolean;
  chainId: string | null;
}): SafeSendNotice | null {
  if (!input.preflightOk) return "PREFLIGHT_NOT_PASSED";
  if (!input.account) return "NO_WALLET";
  if (!input.accountVerified) return "ACCOUNT_UNVERIFIED";
  const account = input.account.toLowerCase();
  const signers = input.savedSigners.map((s) => s.toLowerCase());
  if (!signers.includes(account)) return "NOT_A_SIGNER";
  if (input.chainId === null || BigInt(input.chainId) !== BigInt(ROBINHOOD_MAINNET_CHAIN_ID)) return "WRONG_CHAIN";
  let expected: SafeCreationPlan;
  try {
    expected = buildSafeCreationPlan(input.launchId, input.savedSigners);
  } catch {
    return "PLAN_MISMATCH";
  }
  const p = input.plan;
  if (
    p.to !== SAFE_PROXY_FACTORY.toLowerCase() ||
    p.value !== "0x0" ||
    p.data !== expected.data ||
    p.saltNonce !== expected.saltNonce ||
    p.initializer !== expected.initializer
  ) {
    return "PLAN_MISMATCH";
  }
  return null;
}

export async function sendTreasurySafeCreation(input: {
  plan: SafeCreationPlan;
  launchId: string;
  savedSigners: readonly string[];
  preflightOk: boolean;
}): Promise<SafeSendResult> {
  const provider = getActiveProvider();
  if (!provider) return pre("NO_WALLET");

  // Live re-read immediately before the send.
  let chainId: string | null = null;
  try {
    chainId = normalizeChainId(await provider.request({ method: "eth_chainId" }));
  } catch {
    chainId = null;
  }
  const account = getActiveAccount();
  const gate = evaluateSafeSendGate({
    plan: input.plan,
    launchId: input.launchId,
    savedSigners: input.savedSigners,
    preflightOk: input.preflightOk,
    account,
    accountVerified: isActiveAccountVerified(),
    chainId,
  });
  if (gate !== null) return pre(gate);

  const tx = {
    from: account!.toLowerCase(),
    to: SAFE_PROXY_FACTORY.toLowerCase(),
    value: "0x0",
    data: input.plan.data,
  };

  // ---- SEND boundary. Everything past this point is ambiguous. ----
  let raw: unknown;
  try {
    raw = await provider.request({ method: "eth_sendTransaction", params: [tx] });
  } catch {
    // A wallet error is not proof that nothing was broadcast.
    return { ok: false, notice: "AMBIGUOUS_SEND_OUTCOME", sendInvoked: true, txHash: null };
  }
  const hash = typeof raw === "string" ? raw.toLowerCase() : "";
  if (!HASH32.test(hash)) {
    return { ok: false, notice: "INVALID_TX_HASH", sendInvoked: true, txHash: null };
  }
  return { ok: true, notice: null, sendInvoked: true, txHash: hash };
}
