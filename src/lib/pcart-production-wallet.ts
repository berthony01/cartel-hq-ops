/**
 * PCART P3 — mainnet deployer WALLET BINDING (browser only, read-only).
 *
 * Holds ONE explicitly bound EIP-1193 provider + account, private to this
 * module (never the generic launcher or generic mainnet connector provider).
 * Every account / chain / nonce / balance read uses that same bound object.
 *
 * Read methods only: eth_accounts, eth_requestAccounts, eth_chainId,
 * eth_getTransactionCount, eth_getBalance. The only state-changing wallet
 * request is an explicit-click network switch (wallet_switchEthereumChain).
 * This module has NO transaction, signature or broadcast capability.
 */
import { getInjectedProvider, type Eip1193Provider } from "./chain-launcher";
import { normalizeAddress } from "./pcart-production-intent";

export const PCART_MAINNET_CHAIN_ID = 4663;
export const PCART_MAINNET_CHAIN_HEX = "0x1237";
export const PCART_CHOOSER_TIMEOUT_MS = 45_000;

export type PcartWalletKind = "chooser" | "injected";
export type PcartConnectResult = { ok: true; account: string; kind: PcartWalletKind } | { ok: false; reason: string };

export type PcartWalletEvidence = {
  account: string;
  chainId: number | null;
  latestNonce: bigint | null;
  pendingNonce: bigint | null;
  balanceWei: bigint | null;
};

export type PcartBindingCheck =
  | { ok: true }
  | { ok: false; reason: "NO_WALLET" | "WRONG_ACCOUNT" | "WRONG_CHAIN" | "NONCE_UNREADABLE" | "NONCE_PENDING" | "NONCE_CHANGED" };

/** Pure gate: exact deployer, chain 4663, latest == pending == saved nonce. */
export function evaluatePcartWalletBinding(
  evidence: PcartWalletEvidence | null,
  draft: { deployer: string; nonce: bigint },
): PcartBindingCheck {
  if (!evidence) return { ok: false, reason: "NO_WALLET" };
  const acct = normalizeAddress(evidence.account);
  const dep = normalizeAddress(draft.deployer);
  if (!acct || !dep || acct !== dep) return { ok: false, reason: "WRONG_ACCOUNT" };
  if (evidence.chainId !== PCART_MAINNET_CHAIN_ID) return { ok: false, reason: "WRONG_CHAIN" };
  if (evidence.latestNonce === null || evidence.pendingNonce === null) return { ok: false, reason: "NONCE_UNREADABLE" };
  if (evidence.latestNonce !== evidence.pendingNonce) return { ok: false, reason: "NONCE_PENDING" };
  if (evidence.latestNonce !== draft.nonce) return { ok: false, reason: "NONCE_CHANGED" };
  return { ok: true };
}

let bound: { provider: Eip1193Provider; account: string; kind: PcartWalletKind } | null = null;
let appKitUnsub: (() => void) | null = null;
const listeners = new Set<() => void>();

export function subscribePcartWallet(l: () => void): () => void {
  listeners.add(l);
  return () => listeners.delete(l);
}
function emit() {
  for (const l of listeners) {
    try {
      l();
    } catch {
      /* never fatal */
    }
  }
}
export function getPcartBoundWallet(): { account: string; kind: PcartWalletKind } | null {
  return bound ? { account: bound.account, kind: bound.kind } : null;
}
export function isPcartChooserConfigured(): boolean {
  const raw = (import.meta.env as Record<string, string | undefined>)["VITE_WALLETCONNECT_PROJECT_ID"];
  return typeof raw === "string" && raw.trim().length > 0;
}
export function isPcartInjectedAvailable(): boolean {
  return typeof window !== "undefined" && getInjectedProvider() !== null;
}

function clearLocal() {
  if (appKitUnsub) {
    try {
      appKitUnsub();
    } catch {
      /* ignore */
    }
    appKitUnsub = null;
  }
  bound = null;
}

function pickAccount(current: string | null, approved: readonly string[]): string | null {
  const set = approved.map((a) => normalizeAddress(a)).filter((a): a is string => !!a);
  const cur = normalizeAddress(current);
  const picked = cur ?? (set.length === 1 ? set[0]! : null);
  return picked && set.includes(picked) ? picked : null;
}

async function readAccounts(p: Eip1193Provider): Promise<string[]> {
  try {
    const raw = (await p.request({ method: "eth_accounts" })) as unknown;
    return Array.isArray(raw) ? raw.filter((a): a is string => typeof a === "string") : [];
  } catch {
    return [];
  }
}

/** EXPLICIT CLICK. Mobile-capable chooser; any stale session is torn down and proven gone first. */
export async function connectPcartChooser(): Promise<PcartConnectResult> {
  if (typeof window === "undefined") return { ok: false, reason: "Not in a browser." };
  if (!isPcartChooserConfigured()) return { ok: false, reason: "The wallet chooser is not configured." };
  const appKit = await import("./reown-appkit-wallet");
  clearLocal();
  emit();
  const tornDown = await appKit.resetAppKitConnection();
  if (!tornDown) {
    await appKit.closeAppKit();
    return { ok: false, reason: "The previous wallet session could not be closed. Reload and try again." };
  }
  const outcome = await appKit.openAppKitConnect(PCART_CHOOSER_TIMEOUT_MS);
  if (outcome.status !== "connected") {
    await appKit.disconnectAppKit();
    await appKit.closeAppKit();
    emit();
    return {
      ok: false,
      reason:
        outcome.status === "timeout"
          ? "The wallet did not respond in time."
          : outcome.status === "rejected"
            ? "Wallet connection cancelled."
            : "Could not open the wallet chooser.",
    };
  }
  const provider = outcome.provider as Eip1193Provider;
  const account = pickAccount(appKit.getAppKitAccountSnapshot()?.address ?? null, await readAccounts(provider));
  if (!account) {
    await appKit.disconnectAppKit();
    await appKit.closeAppKit();
    emit();
    return { ok: false, reason: "The wallet did not confirm one clear account. Try again." };
  }
  bound = { provider, account, kind: "chooser" };
  appKitUnsub = appKit.subscribeAppKitAccount(() => {
    const snap = appKit.getAppKitAccountSnapshot();
    if (!snap?.isConnected || normalizeAddress(snap.address) !== bound?.account) {
      clearLocal();
      emit();
    }
  });
  emit();
  return { ok: true, account, kind: "chooser" };
}

/** EXPLICIT CLICK. Desktop browser-extension path. */
export async function connectPcartInjected(): Promise<PcartConnectResult> {
  await disconnectPcartWallet();
  const provider = getInjectedProvider();
  if (!provider) return { ok: false, reason: "No browser wallet found." };
  try {
    const raw = (await provider.request({ method: "eth_requestAccounts" })) as unknown;
    const approved = Array.isArray(raw) ? raw.filter((a): a is string => typeof a === "string") : [];
    const account = pickAccount(approved[0] ?? null, approved);
    if (!account) return { ok: false, reason: "The wallet did not confirm one clear account." };
    bound = { provider, account, kind: "injected" };
    emit();
    return { ok: true, account, kind: "injected" };
  } catch (e) {
    clearLocal();
    emit();
    const code = (e as { code?: unknown } | null)?.code;
    return { ok: false, reason: code === 4001 ? "Wallet connection cancelled." : "Could not connect the browser wallet." };
  }
}

export async function disconnectPcartWallet(): Promise<void> {
  const wasChooser = bound?.kind === "chooser";
  clearLocal();
  if (wasChooser && typeof window !== "undefined") {
    const appKit = await import("./reown-appkit-wallet");
    await appKit.disconnectAppKit();
  }
  emit();
}

/** "Choose another wallet": full teardown, then a fresh chooser. */
export async function chooseAnotherPcartWallet(): Promise<PcartConnectResult> {
  await disconnectPcartWallet();
  return connectPcartChooser();
}

function hexToBigInt(v: unknown): bigint | null {
  return typeof v === "string" && /^0x[0-9a-fA-F]+$/.test(v) ? BigInt(v) : null;
}

/** All reads through the SAME bound provider. */
export async function readPcartWalletEvidence(): Promise<PcartWalletEvidence | null> {
  const b = bound;
  if (!b) return null;
  const p = b.provider;
  const safe = async (method: string, params?: unknown[]) => {
    try {
      return await p.request(params ? { method, params } : { method });
    } catch {
      return null;
    }
  };
  const accounts = await readAccounts(p);
  const lower = accounts.map((a) => a.toLowerCase());
  // If the wallet no longer exposes the bound account, report what it does expose (fails the gate).
  const account = lower.includes(b.account) ? b.account : (normalizeAddress(lower[0] ?? null) ?? "");
  const [chainRaw, latestRaw, pendingRaw, balRaw] = await Promise.all([
    safe("eth_chainId"),
    safe("eth_getTransactionCount", [b.account, "latest"]),
    safe("eth_getTransactionCount", [b.account, "pending"]),
    safe("eth_getBalance", [b.account, "latest"]),
  ]);
  const chain = hexToBigInt(chainRaw);
  return {
    account,
    chainId: chain === null ? null : Number(chain),
    latestNonce: hexToBigInt(latestRaw),
    pendingNonce: hexToBigInt(pendingRaw),
    balanceWei: hexToBigInt(balRaw),
  };
}

/** EXPLICIT CLICK only. Asks the bound wallet to switch to Robinhood Chain mainnet. */
export async function requestPcartMainnetSwitch(): Promise<boolean> {
  if (!bound) return false;
  try {
    await bound.provider.request({ method: "wallet_switchEthereumChain", params: [{ chainId: PCART_MAINNET_CHAIN_HEX }] });
    return true;
  } catch {
    return false;
  }
}
