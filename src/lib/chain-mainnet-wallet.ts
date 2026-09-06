import { MAINNET_DEPLOYMENT_TX_ENABLED, ROBINHOOD_MAINNET_CHAIN_ID } from "./chain-mainnet-registry";
import type { MainnetWalletEnvelope } from "./chain-mainnet-handoff.functions";

/**
 * P3C-C2 — Robinhood Chain PRODUCTION (4663) WALLET HELPER (browser side).
 *
 * DISABLED BY CONSTRUCTION
 * ------------------------
 * `sendClaimedMainnetDeployment` refuses before it ever touches a provider
 * while `MAINNET_DEPLOYMENT_TX_ENABLED` is false. The refusal is the first
 * executable statement after argument-presence validation, so importing this
 * module, calling it directly from a console, or wiring it into future UI
 * cannot reach `window.ethereum`, let alone a send.
 *
 * Deliberate omissions — absence, not a flag, is the safety property:
 *   - no `wallet_switchEthereumChain`, no `wallet_addEthereumChain`. A wrong
 *     network fails closed and the operator switches manually. Silently
 *     changing networks during a production send is never acceptable.
 *   - no `eth_sendRawTransaction`, no signing method of any kind.
 *   - no retry, no backoff, no queue. Ever.
 *   - no persistence call: the caller passes a known hash to
 *     `persistMainnetDeploymentTxHash` itself.
 *   - no storage. Nothing here is security-authoritative, and no local marker
 *     is ever treated as proof of what a wallet did.
 *   - no cancellation path. C2 has none by design.
 *
 * RECOVERY SEMANTICS
 * ------------------
 *   - PRE_SEND failures (switch off, no provider, account or chain mismatch,
 *     malformed envelope) are the only outcomes where the send is provably
 *     never invoked. Even these do not authorize cancellation in C2 — a CLAIMED
 *     authorization freezes for later operator reconciliation.
 *   - Once the single `eth_sendTransaction` call begins, ANY exception, user
 *     rejection code, or timeout is reported as `AMBIGUOUS_SEND_OUTCOME`.
 *     Provider error codes are not proof that nothing was broadcast.
 *   - Never rebroadcast. If a hash is known but persistence failed, retry only
 *     the persistence, with the same hash, attempt and authorization.
 *   - A different hash for the same attempt is a conflict and freezes.
 */

/* ------------------------------------------------------------------ */
/* Deterministic, non-leaking result codes                             */
/* ------------------------------------------------------------------ */

export type MainnetWalletNotice =
  | "PRODUCTION_TX_DISABLED"
  | "NO_PROVIDER"
  | "ACCOUNT_MISMATCH"
  | "CHAIN_MISMATCH"
  | "INVALID_ENVELOPE"
  | "AMBIGUOUS_SEND_OUTCOME"
  | "INVALID_TX_HASH";

/** Where the attempt stopped. Only `PRE_SEND` proves nothing was invoked. */
export type MainnetSendPhase = "PRE_SEND" | "SEND_INVOKED" | "HASH_KNOWN";

export type MainnetWalletInspection = {
  ok: boolean;
  notice: MainnetWalletNotice | null;
  account: string | null;
  chainId: string | null;
  accountMatches: boolean;
  chainMatches: boolean;
};

export type MainnetSendResult = {
  ok: boolean;
  notice: MainnetWalletNotice | null;
  phase: MainnetSendPhase;
  /** True only when `eth_sendTransaction` was actually invoked. */
  sendInvoked: boolean;
  txHash: string | null;
};

/* ------------------------------------------------------------------ */
/* Frozen constants                                                    */
/* ------------------------------------------------------------------ */

/**
 * Widened deliberately: the registry literal is `false as const`, and comparing
 * a `false` literal to `true` is a type error. Widening keeps the guard a real
 * runtime check and keeps the guarded path type-checked.
 */
const PRODUCTION_SEND_ENABLED: boolean = Boolean(MAINNET_DEPLOYMENT_TX_ENABLED as boolean);

const ADDRESS = /^0x[0-9a-f]{40}$/;
const HASH32 = /^0x[0-9a-f]{64}$/;
const HEX_QUANTITY = /^0x(0|[1-9a-f][0-9a-f]*)$/;
const HEX_DATA = /^0x[0-9a-f]+$/;

/* ------------------------------------------------------------------ */
/* Minimal EIP-1193 access — never at module scope                     */
/* ------------------------------------------------------------------ */

type Eip1193Provider = {
  request: (args: { method: string; params?: unknown[] }) => Promise<unknown>;
};

/**
 * Read `window.ethereum` only inside a function call. Module evaluation must
 * stay side-effect free and SSR-safe.
 */
function getProvider(): Eip1193Provider | null {
  if (typeof window === "undefined") return null;
  const injected = (window as unknown as { ethereum?: unknown }).ethereum;
  if (!injected || typeof injected !== "object") return null;
  const candidate = injected as { request?: unknown };
  if (typeof candidate.request !== "function") return null;
  return injected as Eip1193Provider;
}

/* ------------------------------------------------------------------ */
/* Pure helpers — bigint only, never Number for chain quantities       */
/* ------------------------------------------------------------------ */

function lower(value: string): string {
  return value.trim().toLowerCase();
}

/** Canonical unsigned decimal string -> minimal RPC hex quantity, or null. */
export function decimalToHexQuantity(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const text = value.trim();
  if (!/^(0|[1-9][0-9]*)$/.test(text)) return null;
  try {
    return `0x${BigInt(text).toString(16)}`;
  } catch {
    return null;
  }
}

/** Strict minimal hex quantity -> bigint, or null. No `Number` anywhere. */
export function hexQuantityToBigInt(value: unknown): bigint | null {
  if (typeof value !== "string") return null;
  if (!HEX_QUANTITY.test(lower(value))) return null;
  try {
    return BigInt(lower(value));
  } catch {
    return null;
  }
}

/**
 * Exact contract-creation shape check. Nothing is repaired or widened here —
 * a non-conforming envelope is refused, never normalized into a sendable one.
 */
export function validateMainnetEnvelope(envelope: unknown): envelope is MainnetWalletEnvelope {
  if (!envelope || typeof envelope !== "object" || Array.isArray(envelope)) return false;
  const candidate = envelope as Record<string, unknown>;

  // Contract creation: the recipient key must be absent entirely.
  if ("to" in candidate) return false;
  // No raw-transaction or signature smuggling through extra members.
  if ("nonce" in candidate || "chainId" in candidate || "input" in candidate) return false;

  if (typeof candidate['from'] !== "string" || !ADDRESS.test(lower(candidate['from']))) return false;
  if (candidate['value'] !== "0x0") return false;
  if (typeof candidate['data'] !== "string" || !HEX_DATA.test(lower(candidate['data']))) return false;

  const gas = hexQuantityToBigInt(candidate['gas']);
  if (gas === null || gas <= 0n) return false;

  const hasEip1559 = "maxFeePerGas" in candidate || "maxPriorityFeePerGas" in candidate;
  const hasLegacy = "gasPrice" in candidate;
  if (hasEip1559 === hasLegacy) return false; // exactly one fee model, never both

  if (hasEip1559) {
    const maxFee = hexQuantityToBigInt(candidate['maxFeePerGas']);
    const priority = hexQuantityToBigInt(candidate['maxPriorityFeePerGas']);
    if (maxFee === null || priority === null) return false;
    if (priority > maxFee) return false;
  } else {
    const gasPrice = hexQuantityToBigInt(candidate['gasPrice']);
    if (gasPrice === null) return false;
  }

  return true;
}

/* ------------------------------------------------------------------ */
/* Read-only wallet inspection                                         */
/* ------------------------------------------------------------------ */

function inspectionBase(): MainnetWalletInspection {
  return {
    ok: false,
    notice: null,
    account: null,
    chainId: null,
    accountMatches: false,
    chainMatches: false,
  };
}

async function readAccountAndChain(
  provider: Eip1193Provider,
): Promise<{ account: string | null; chainId: string | null }> {
  let account: string | null = null;
  let chainId: string | null = null;
  try {
    const accounts = (await provider.request({ method: "eth_accounts" })) as unknown;
    if (Array.isArray(accounts) && typeof accounts[0] === "string") {
      account = lower(accounts[0]);
    }
  } catch {
    account = null;
  }
  try {
    const raw = (await provider.request({ method: "eth_chainId" })) as unknown;
    if (typeof raw === "string") chainId = lower(raw);
  } catch {
    chainId = null;
  }
  return { account, chainId };
}

/**
 * READ ONLY. Calls exactly `eth_accounts` and `eth_chainId`. Never prompts,
 * never connects, never switches or adds a network.
 */
export async function inspectMainnetWalletForHandoff(
  expectedDeployer: string,
): Promise<MainnetWalletInspection> {
  const provider = getProvider();
  if (!provider) return { ...inspectionBase(), notice: "NO_PROVIDER" };

  const expected =
    typeof expectedDeployer === "string" && ADDRESS.test(lower(expectedDeployer))
      ? lower(expectedDeployer)
      : null;

  const { account, chainId } = await readAccountAndChain(provider);
  const chainMatches = hexQuantityToBigInt(chainId) === BigInt(ROBINHOOD_MAINNET_CHAIN_ID);
  const accountMatches = expected !== null && account !== null && account === expected;

  return {
    ok: accountMatches && chainMatches,
    notice: !accountMatches ? "ACCOUNT_MISMATCH" : !chainMatches ? "CHAIN_MISMATCH" : null,
    account,
    chainId,
    accountMatches,
    chainMatches,
  };
}

/* ------------------------------------------------------------------ */
/* Guarded send helper — unreachable while the switch is false         */
/* ------------------------------------------------------------------ */

function sendFail(notice: MainnetWalletNotice, phase: MainnetSendPhase): MainnetSendResult {
  return { ok: false, notice, phase, sendInvoked: phase !== "PRE_SEND", txHash: null };
}

/**
 * Sends the server-issued envelope verbatim. Exactly one `eth_sendTransaction`
 * call, no retry, no field recomputation, no chain switching.
 *
 * The caller is responsible for handing any returned hash to
 * `persistMainnetDeploymentTxHash`. On `AMBIGUOUS_SEND_OUTCOME` the caller must
 * freeze the attempt for reconciliation: it must not resend and must not treat
 * the failure as proof that nothing was broadcast.
 */
export async function sendClaimedMainnetDeployment(
  envelope: MainnetWalletEnvelope,
): Promise<MainnetSendResult> {
  // Argument presence/type only — nothing that could touch a provider.
  if (!envelope || typeof envelope !== "object") {
    return sendFail("INVALID_ENVELOPE", "PRE_SEND");
  }

  // HARD GATE. First executable check. Before provider access, before any
  // provider request, before any validation that could probe the environment.
  if (PRODUCTION_SEND_ENABLED !== true) {
    return sendFail("PRODUCTION_TX_DISABLED", "PRE_SEND");
  }

  if (!validateMainnetEnvelope(envelope)) {
    return sendFail("INVALID_ENVELOPE", "PRE_SEND");
  }

  const provider = getProvider();
  if (!provider) return sendFail("NO_PROVIDER", "PRE_SEND");

  // Immediate revalidation against the live wallet, right before the send.
  const { account, chainId } = await readAccountAndChain(provider);
  if (account === null || account !== lower(envelope.from)) {
    return sendFail("ACCOUNT_MISMATCH", "PRE_SEND");
  }
  if (hexQuantityToBigInt(chainId) !== BigInt(ROBINHOOD_MAINNET_CHAIN_ID)) {
    // Fail closed. The operator switches networks manually; this helper never
    // calls wallet_switchEthereumChain or wallet_addEthereumChain.
    return sendFail("CHAIN_MISMATCH", "PRE_SEND");
  }

  // ---- SEND_INVOKED boundary. Everything past this point is ambiguous. ----
  let raw: unknown;
  try {
    raw = await provider.request({ method: "eth_sendTransaction", params: [envelope] });
  } catch {
    // Includes user rejection. A provider error code is NOT proof that nothing
    // was broadcast, so this is never reported as a rejection or a cancel.
    return sendFail("AMBIGUOUS_SEND_OUTCOME", "SEND_INVOKED");
  }

  if (typeof raw !== "string" || !HASH32.test(lower(raw))) {
    // A send happened; we simply cannot read the hash. Freeze, never retry.
    return { ...sendFail("INVALID_TX_HASH", "SEND_INVOKED"), sendInvoked: true };
  }

  return {
    ok: true,
    notice: null,
    phase: "HASH_KNOWN",
    sendInvoked: true,
    txHash: lower(raw),
  };
}
