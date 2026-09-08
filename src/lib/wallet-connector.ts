import { ROBINHOOD_MAINNET_CHAIN_ID } from "./chain-mainnet-registry";

/**
 * P3C-G — DEPLOYMENT WALLET CONNECTOR ABSTRACTION (browser only).
 *
 * Purpose: let a phone-only operator reach the existing Robinhood Chain
 * MAINNET canary flow through WalletConnect (Robinhood Wallet supports dapp
 * connections over WalletConnect) without changing any mainnet safety gate.
 *
 * Safety properties, by construction rather than by flag:
 *   - NO module-scope browser access. `window` is only read inside functions.
 *   - The WalletConnect package is loaded by DYNAMIC import inside a
 *     browser-executed function, so SSR never evaluates it.
 *   - This module NEVER signs, never sends, never estimates, never switches or
 *     adds a network. It resolves an EIP-1193 provider and nothing else.
 *     `wallet_switchEthereumChain` / `wallet_addEthereumChain` are absent on
 *     purpose: a wrong network fails closed and the operator fixes it in the
 *     wallet.
 *   - No key material, seed, password, signed payload, transaction envelope or
 *     server authorization is ever stored here or anywhere else in the client.
 *   - The WalletConnect project id is a PUBLIC client identifier read from the
 *     environment. It is never hardcoded. When it is absent the connector fails
 *     closed with a explicit notice instead of throwing.
 */

/* ------------------------------------------------------------------ */
/* Types                                                               */
/* ------------------------------------------------------------------ */

export type Eip1193Provider = {
  request: (args: { method: string; params?: unknown[] }) => Promise<unknown>;
  on?: (event: string, listener: (...args: unknown[]) => void) => void;
  removeListener?: (event: string, listener: (...args: unknown[]) => void) => void;
};

export type WalletConnectorKind = "injected" | "walletconnect";

export type WalletConnectorNotice =
  | "NO_INJECTED_PROVIDER"
  | "WALLETCONNECT_NOT_CONFIGURED"
  | "WALLETCONNECT_INIT_FAILED"
  | "WALLETCONNECT_TIMEOUT"
  | "CONNECTION_REJECTED_OR_FAILED"
  | "NO_ACCOUNT";

export type WalletConnectorState = {
  kind: WalletConnectorKind | null;
  connected: boolean;
  account: string | null;
  chainId: string | null;
  /** Wallet-reported metadata, only when the peer actually supplies it. */
  walletName: string | null;
  notice: WalletConnectorNotice | null;
};

export type WalletConnectorResult = {
  ok: boolean;
  notice: WalletConnectorNotice | null;
  state: WalletConnectorState;
};

/* ------------------------------------------------------------------ */
/* Module state — provider handles only, never secrets                 */
/* ------------------------------------------------------------------ */

let activeKind: WalletConnectorKind | null = null;
let activeProvider: Eip1193Provider | null = null;
let walletConnectProvider: Eip1193Provider | null = null;
let walletName: string | null = null;

const listeners = new Set<() => void>();

function emit(): void {
  for (const listener of listeners) listener();
}

export function subscribeWalletConnector(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

/* ------------------------------------------------------------------ */
/* Environment / availability                                          */
/* ------------------------------------------------------------------ */

/** PUBLIC client identifier. Absent => WalletConnect stays unavailable. */
export function getWalletConnectProjectId(): string | null {
  const raw = (import.meta.env as Record<string, string | undefined>)[
    "VITE_WALLETCONNECT_PROJECT_ID"
  ];
  if (typeof raw !== "string") return null;
  const value = raw.trim();
  return value.length > 0 ? value : null;
}

export function isWalletConnectConfigured(): boolean {
  return getWalletConnectProjectId() !== null;
}

/** Reads `window.ethereum` inside a function call only. Never at module scope. */
function readInjectedProvider(): Eip1193Provider | null {
  if (typeof window === "undefined") return null;
  const injected = (window as unknown as { ethereum?: unknown }).ethereum;
  if (!injected || typeof injected !== "object") return null;
  if (typeof (injected as { request?: unknown }).request !== "function") return null;
  return injected as Eip1193Provider;
}

export function isInjectedWalletAvailable(): boolean {
  return readInjectedProvider() !== null;
}

/**
 * Conservative embedded-context detection. Browser-only, presence checks
 * exclusively: no provider request, no navigation, no host identification
 * claim beyond "this is very likely an iframe or an in-app browser".
 */
export function isEmbeddedBrowserContext(): boolean {
  if (typeof window === "undefined") return false;
  try {
    if (window.self !== window.top) return true;
  } catch {
    // Cross-origin access to window.top throwing is itself iframe evidence.
    return true;
  }
  const ua = typeof navigator === "undefined" ? "" : String(navigator.userAgent ?? "");
  if (!/Android/i.test(ua)) return false;
  // Well-known Android in-app WebView markers. Deliberately not exhaustive.
  return /\bwv\b|FBAN|FBAV|Instagram|Line\/|Twitter|TikTok|GSA\//.test(ua);
}

/** Current top-level app URL, for an explicit user-initiated standalone open. */
export function getStandaloneAppUrl(): string | null {
  if (typeof window === "undefined") return null;
  try {
    return window.location.href;
  } catch {
    return null;
  }
}

/**
 * Bounded wait for the WalletConnect handshake. A mobile deep-link that never
 * returns must fail closed instead of spinning forever.
 */
export const WALLETCONNECT_CONNECT_TIMEOUT_MS = 45_000;

/* ------------------------------------------------------------------ */
/* Active provider resolution                                          */
/* ------------------------------------------------------------------ */

/**
 * EXPLICIT OPT-IN ONLY. The single resolution point used by the mainnet wallet
 * adapter returns a provider ONLY after the operator explicitly connected one
 * through `connectInjected()` or `connectWalletConnect()`.
 *
 * There is deliberately NO fallback to `window.ethereum`: merely rendering a
 * page must never make an injected wallet (Phantom, MetaMask, ...) the active
 * provider, and must never cause a provider request. Injected wallets stay
 * fully supported through `connectInjected()`.
 */
export function getActiveProvider(): Eip1193Provider | null {
  return activeProvider;
}

export function getActiveConnectorKind(): WalletConnectorKind | null {
  return activeKind;
}


function lower(value: string): string {
  return value.trim().toLowerCase();
}

async function readAccountAndChain(
  provider: Eip1193Provider,
): Promise<{ account: string | null; chainId: string | null }> {
  let account: string | null = null;
  let chainId: string | null = null;
  try {
    const accounts = (await provider.request({ method: "eth_accounts" })) as unknown;
    if (Array.isArray(accounts) && typeof accounts[0] === "string") account = lower(accounts[0]);
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

function attachEvents(provider: Eip1193Provider): void {
  if (typeof provider.on !== "function") return;
  provider.on("accountsChanged", () => emit());
  provider.on("chainChanged", () => emit());
  provider.on("disconnect", () => {
    if (activeKind === "walletconnect") {
      walletConnectProvider = null;
      walletName = null;
    }
    activeProvider = null;
    activeKind = null;
    emit();
  });
}

/* ------------------------------------------------------------------ */
/* State reads                                                         */
/* ------------------------------------------------------------------ */

function emptyState(notice: WalletConnectorNotice | null): WalletConnectorState {
  return {
    kind: null,
    connected: false,
    account: null,
    chainId: null,
    walletName: null,
    notice,
  };
}

export async function readWalletConnectorState(): Promise<WalletConnectorState> {
  const provider = getActiveProvider();
  if (!provider) return emptyState(null);
  const { account, chainId } = await readAccountAndChain(provider);
  return {
    kind: getActiveConnectorKind(),
    connected: account !== null,
    account,
    chainId,
    walletName: activeKind === "walletconnect" ? walletName : null,
    notice: account === null ? "NO_ACCOUNT" : null,
  };
}

/* ------------------------------------------------------------------ */
/* Connect / disconnect                                                */
/* ------------------------------------------------------------------ */

export async function connectInjected(): Promise<WalletConnectorResult> {
  const provider = readInjectedProvider();
  if (!provider) {
    return { ok: false, notice: "NO_INJECTED_PROVIDER", state: emptyState("NO_INJECTED_PROVIDER") };
  }
  try {
    await provider.request({ method: "eth_requestAccounts" });
  } catch {
    return {
      ok: false,
      notice: "CONNECTION_REJECTED_OR_FAILED",
      state: emptyState("CONNECTION_REJECTED_OR_FAILED"),
    };
  }
  activeProvider = provider;
  activeKind = "injected";
  walletName = null;
  attachEvents(provider);
  const state = await readWalletConnectorState();
  emit();
  return { ok: state.connected, notice: state.notice, state };
}

/**
 * Robinhood Wallet and other mobile wallets connect over WalletConnect. Chain
 * 4663 is declared as an OPTIONAL chain (the deprecated `chains` option is
 * deliberately not used) so an unsupported-chain wallet fails closed instead of
 * being pushed into a network switch.
 */
export async function connectWalletConnect(): Promise<WalletConnectorResult> {
  if (typeof window === "undefined") {
    return {
      ok: false,
      notice: "WALLETCONNECT_INIT_FAILED",
      state: emptyState("WALLETCONNECT_INIT_FAILED"),
    };
  }
  const projectId = getWalletConnectProjectId();
  if (!projectId) {
    return {
      ok: false,
      notice: "WALLETCONNECT_NOT_CONFIGURED",
      state: emptyState("WALLETCONNECT_NOT_CONFIGURED"),
    };
  }

  let provider: Eip1193Provider;
  try {
    const { EthereumProvider } = await import("@walletconnect/ethereum-provider");
    const initialized = await EthereumProvider.init({
      projectId,
      optionalChains: [ROBINHOOD_MAINNET_CHAIN_ID as number],
      showQrModal: true,
      methods: ["eth_sendTransaction"],
      events: ["accountsChanged", "chainChanged"],
      metadata: {
        name: "CARTEL HQ",
        description: "CARTEL HQ deployment wallet connection",
        url: window.location.origin,
        icons: [],
      },
    });
    provider = initialized as unknown as Eip1193Provider;
  } catch {
    return {
      ok: false,
      notice: "WALLETCONNECT_INIT_FAILED",
      state: emptyState("WALLETCONNECT_INIT_FAILED"),
    };
  }

  // Bounded handshake. On timeout the connector fails closed and stays
  // disconnected: it never re-attempts, never reconnects, never sends.
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    // Opens the WalletConnect QR / mobile deep-link surface. Connection only.
    const handshake = (provider as unknown as { connect: () => Promise<void> }).connect();
    const timeout = new Promise<never>((_resolve, reject) => {
      timer = setTimeout(() => reject(new Error("WALLETCONNECT_TIMEOUT")), WALLETCONNECT_CONNECT_TIMEOUT_MS);
    });
    await Promise.race([handshake, timeout]);
  } catch (error) {
    const timedOut = error instanceof Error && error.message === "WALLETCONNECT_TIMEOUT";
    walletConnectProvider = null;
    activeProvider = null;
    activeKind = null;
    walletName = null;
    try {
      await (provider as unknown as { disconnect: () => Promise<void> }).disconnect();
    } catch {
      // Best-effort teardown only.
    }
    emit();
    const notice: WalletConnectorNotice = timedOut
      ? "WALLETCONNECT_TIMEOUT"
      : "CONNECTION_REJECTED_OR_FAILED";
    return { ok: false, notice, state: emptyState(notice) };
  } finally {
    if (timer !== undefined) clearTimeout(timer);
  }

  walletConnectProvider = provider;
  activeProvider = provider;
  activeKind = "walletconnect";
  walletName = readPeerWalletName(provider);
  attachEvents(provider);
  const state = await readWalletConnectorState();
  emit();
  return { ok: state.connected, notice: state.notice, state };
}

/**
 * Only trust wallet metadata the peer actually supplied. If the session does
 * not identify the wallet, the connector stays generically "WalletConnect" —
 * we never assert that Robinhood Wallet is connected without evidence.
 */
function readPeerWalletName(provider: Eip1193Provider): string | null {
  const session = (provider as unknown as { session?: { peer?: { metadata?: { name?: unknown } } } })
    .session;
  const name = session?.peer?.metadata?.name;
  return typeof name === "string" && name.trim().length > 0 ? name.trim() : null;
}

export async function disconnectWalletConnect(): Promise<void> {
  const provider = walletConnectProvider;
  walletConnectProvider = null;
  if (activeKind === "walletconnect") {
    activeProvider = null;
    activeKind = null;
  }
  walletName = null;
  if (provider) {
    try {
      await (provider as unknown as { disconnect: () => Promise<void> }).disconnect();
    } catch {
      // A failed teardown must never leave the UI claiming a live session.
    }
  }
  emit();
}

export async function disconnect(): Promise<void> {
  if (activeKind === "walletconnect") {
    await disconnectWalletConnect();
    return;
  }
  // Injected wallets cannot be revoked from a dapp; drop the local handle only.
  activeProvider = null;
  activeKind = null;
  walletName = null;
  emit();
}
