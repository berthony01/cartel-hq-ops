import {
  connectWallet,
  getInjectedProvider,
  getLauncherAccount,
  getLauncherProvider,
  setLauncherProvider,
  type Eip1193Provider,
} from "./chain-launcher";

/**
 * TESTNET LAB WALLET CONNECTOR (browser only, Robinhood Chain Testnet 46630).
 *
 * Reuses the existing Reown AppKit chooser singleton (`reown-appkit-wallet.ts`)
 * WITHOUT modifying it, so the mainnet connector's 4663 configuration and
 * every mainnet gate in `wallet-connector.ts` stay byte-identical. The mainnet
 * connector already proves teardown of any prior AppKit session before each of
 * its own connects, so a testnet session can never stand in for a mainnet one.
 *
 * Properties:
 *   - EXPLICIT CLICK ONLY. Nothing here runs on mount; AppKit is created with
 *     `enableReconnect: false`, so no session is restored silently.
 *   - Fresh handshake: any earlier AppKit session is torn down and the
 *     teardown PROVEN before the chooser opens ("Choose another wallet").
 *   - The connected provider + selected account are bound into the launcher
 *     (`setLauncherProvider`), which is the ONLY provider used for reads,
 *     switch/add and broadcast. No `window.ethereum` guessing.
 *   - Never switches or adds a network, never signs, never sends.
 */

export type TestnetConnectorKind = "chooser" | "injected";

export type TestnetConnectResult =
  | { ok: true; account: string; kind: TestnetConnectorKind }
  | { ok: false; reason: string };

export const TESTNET_CHOOSER_TIMEOUT_MS = 45_000;

let activeKind: TestnetConnectorKind | null = null;
let appKitUnsub: (() => void) | null = null;
const listeners = new Set<() => void>();

export function subscribeTestnetWallet(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
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

export function getTestnetConnectorKind(): TestnetConnectorKind | null {
  return getLauncherProvider() ? activeKind : null;
}

export function isChooserConfigured(): boolean {
  const raw = (import.meta.env as Record<string, string | undefined>)["VITE_WALLETCONNECT_PROJECT_ID"];
  return typeof raw === "string" && raw.trim().length > 0;
}

export function isInjectedAvailable(): boolean {
  return typeof window !== "undefined" && getInjectedProvider() !== null;
}

/**
 * Pure selection rule: AppKit's CURRENT account wins, else an unambiguous
 * single approved account. The chosen account must be in the approved set.
 */
export function selectConnectedAccount(
  appKitCurrent: string | null,
  approved: readonly string[],
): string | null {
  const set = approved.map((a) => a.toLowerCase());
  const current = appKitCurrent ? appKitCurrent.toLowerCase() : null;
  const picked = current ?? (set.length === 1 ? (set[0] as string) : null);
  if (!picked || !/^0x[0-9a-f]{40}$/.test(picked) || !set.includes(picked)) return null;
  return picked;
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
  setLauncherProvider(null, null);
  activeKind = null;
}

async function readApproved(provider: Eip1193Provider): Promise<string[]> {
  try {
    const raw = (await provider.request({ method: "eth_accounts" })) as unknown;
    return Array.isArray(raw) ? raw.filter((a): a is string => typeof a === "string") : [];
  } catch {
    return [];
  }
}

/** EXPLICIT CLICK. Opens the mobile-capable wallet chooser (WalletConnect / MetaMask mobile etc.). */
export async function connectTestnetChooser(): Promise<TestnetConnectResult> {
  if (typeof window === "undefined") return { ok: false, reason: "Not in a browser." };
  if (!isChooserConfigured()) return { ok: false, reason: "The wallet chooser is not configured." };
  const appKit = await import("./reown-appkit-wallet");

  clearLocal();
  emit();
  const tornDown = await appKit.resetAppKitConnection();
  if (!tornDown) {
    await appKit.closeAppKit();
    return { ok: false, reason: "The previous wallet session could not be closed. Reload and try again." };
  }

  const outcome = await appKit.openAppKitConnect(TESTNET_CHOOSER_TIMEOUT_MS);
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
  const approved = await readApproved(provider);
  const snapshot = appKit.getAppKitAccountSnapshot();
  const account = selectConnectedAccount(snapshot?.address ?? null, approved);
  if (!account) {
    await appKit.disconnectAppKit();
    await appKit.closeAppKit();
    emit();
    return { ok: false, reason: "The wallet did not confirm one clear account. Try again." };
  }

  setLauncherProvider(provider, account);
  activeKind = "chooser";
  // If the AppKit session moves to another account or ends (e.g. a mainnet
  // connect elsewhere tore it down), invalidate instead of rebinding.
  appKitUnsub = appKit.subscribeAppKitAccount(() => {
    const snap = appKit.getAppKitAccountSnapshot();
    const live = snap?.address ? snap.address.toLowerCase() : null;
    if (!snap?.isConnected || live !== getLauncherAccount()) {
      clearLocal();
      emit();
    }
  });
  emit();
  return { ok: true, account, kind: "chooser" };
}

/** EXPLICIT CLICK. Desktop-extension fallback when the chooser is unavailable. */
export async function connectTestnetInjected(): Promise<TestnetConnectResult> {
  await disconnectTestnetWallet();
  try {
    const account = await connectWallet();
    activeKind = "injected";
    emit();
    return { ok: true, account, kind: "injected" };
  } catch (e) {
    clearLocal();
    emit();
    const code = (e as { code?: unknown } | null)?.code;
    return { ok: false, reason: code === 4001 ? "Wallet connection cancelled." : "Could not connect the browser wallet." };
  }
}

/** Tears down any session, then local state. Never reconnects. */
export async function disconnectTestnetWallet(): Promise<void> {
  const wasChooser = activeKind === "chooser";
  clearLocal();
  if (wasChooser && typeof window !== "undefined") {
    const appKit = await import("./reown-appkit-wallet");
    await appKit.disconnectAppKit();
  }
  emit();
}

/** "Choose another wallet": full teardown first, then a fresh chooser. */
export async function chooseAnotherTestnetWallet(): Promise<TestnetConnectResult> {
  await disconnectTestnetWallet();
  return await connectTestnetChooser();
}
