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
 *
 * MOBILE HARDENING (this revision):
 *   - Chain ids are normalized through a single strict helper: installed
 *     `@walletconnect/ethereum-provider@2.24.0` answers `eth_chainId` with a
 *     NUMBER, while injected wallets answer with a hex string. Both are
 *     accepted; anything else is refused.
 *   - The WalletConnect chain is decided from real SESSION EVIDENCE (CAIP-10
 *     accounts under `session.namespaces.eip155.accounts`), never from the
 *     provider's default chain value. A session without `eip155:4663` fails
 *     closed with a distinct notice and the provider is NOT activated.
 *   - WALLET-AGNOSTIC DISCOVERY. Robinhood Chain mainnet is proposed as an
 *     OPTIONAL namespace (`optionalChains: [4663]`) so the WalletConnect modal
 *     starts and every EVM wallet stays discoverable. `eth_sendTransaction`
 *     and the account/chain events are still negotiated: the installed 2.24
 *     provider merges the requested `methods` / `events` into the optional
 *     namespace. Robinhood Wallet is RECOMMENDED, never required — strictness
 *     lives entirely in the post-connect evidence gate below, which refuses any
 *     session that does not actually include `eip155:4663`.
 *   - A persisted session restored by `init()` is torn down before a fresh
 *     explicit connect, so a canary connection can never silently inherit
 *     stale approval state. WalletConnect storage keys are never touched
 *     directly.
 *   - Failure diagnostics are SANITIZED CODES ONLY. A dynamic-import failure
 *     and a provider-init failure are reported as two distinct notices so a
 *     mobile test can tell a broken browser bundle apart from a provider /
 *     relay initialization problem. No exception message, stack, URL, endpoint
 *     or project id ever reaches the UI.
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
  | "WALLETCONNECT_LIBRARY_LOAD_FAILED"
  | "WALLETCONNECT_INIT_FAILED"
  | "WALLETCONNECT_TIMEOUT"
  | "WRONG_CHAIN_APPROVED"
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
/** Canonical hex chain ids proven by the active WalletConnect session. */
let sessionChainEvidence: string[] | null = null;

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
/* Strict chain-id normalization — the single accepted parser          */
/* ------------------------------------------------------------------ */

const CANONICAL_HEX = /^0x(0|[1-9a-f][0-9a-f]*)$/;

/**
 * Accepts either a hex quantity string (`0x1237`, any case, tolerant of
 * leading zeros) or a safe non-negative integer NUMBER (WalletConnect 2.24
 * answers `eth_chainId` with a number). Everything else — floats, negatives,
 * unsafe integers, decimal strings, bigints, objects — is refused rather than
 * repaired, so a malformed value can never satisfy a chain guard.
 */
export function normalizeChainId(raw: unknown): string | null {
  if (typeof raw === "number") {
    if (!Number.isSafeInteger(raw) || raw < 0) return null;
    return `0x${raw.toString(16)}`;
  }
  if (typeof raw !== "string") return null;
  const text = raw.trim().toLowerCase();
  if (!/^0x[0-9a-f]+$/.test(text)) return null;
  if (CANONICAL_HEX.test(text)) return text;
  try {
    return `0x${BigInt(text).toString(16)}`;
  } catch {
    return null;
  }
}

/** Canonical hex form of the required Robinhood Chain mainnet id. */
export const ROBINHOOD_MAINNET_CHAIN_ID_HEX_CANONICAL = `0x${(
  ROBINHOOD_MAINNET_CHAIN_ID as number
).toString(16)}`;

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

/**
 * Canonical hex chain ids proven by the ACTIVE WalletConnect session, or null
 * when the active connector is injected (an injected wallet has no session
 * namespace to inspect and is checked live through `eth_chainId`). The mainnet
 * wallet helper reads this so the connector and the pre-send guard cannot
 * disagree about what the wallet actually approved.
 */
export function getActiveSessionChainEvidence(): string[] | null {
  if (activeKind !== "walletconnect") return null;
  return sessionChainEvidence;
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
    chainId = normalizeChainId(raw);
  } catch {
    chainId = null;
  }
  return { account, chainId };
}

/* ------------------------------------------------------------------ */
/* Event listeners — named handlers, never accumulated                 */
/* ------------------------------------------------------------------ */

type AttachedHandlers = {
  provider: Eip1193Provider;
  accountsChanged: () => void;
  chainChanged: () => void;
  disconnected: () => void;
};

let attachedHandlers: AttachedHandlers | null = null;

function detachEvents(): void {
  const attached = attachedHandlers;
  attachedHandlers = null;
  if (!attached) return;
  const { provider } = attached;
  if (typeof provider.removeListener !== "function") return;
  provider.removeListener("accountsChanged", attached.accountsChanged);
  provider.removeListener("chainChanged", attached.chainChanged);
  provider.removeListener("disconnect", attached.disconnected);
}

function attachEvents(provider: Eip1193Provider): void {
  // Always detach first: a fresh connect must never accumulate listeners.
  detachEvents();
  if (typeof provider.on !== "function") return;
  const handlers: AttachedHandlers = {
    provider,
    accountsChanged: () => emit(),
    chainChanged: () => emit(),
    disconnected: () => {
      clearLocalConnectionState();
      emit();
    },
  };
  provider.on("accountsChanged", handlers.accountsChanged);
  provider.on("chainChanged", handlers.chainChanged);
  provider.on("disconnect", handlers.disconnected);
  attachedHandlers = handlers;
}

/**
 * Drops every local handle and every piece of session evidence. Safe to call
 * repeatedly and safe to call when module state is already partially stale.
 */
function clearLocalConnectionState(): void {
  detachEvents();
  walletConnectProvider = null;
  activeProvider = null;
  activeKind = null;
  walletName = null;
  sessionChainEvidence = null;
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
  sessionChainEvidence = null;
  attachEvents(provider);
  const state = await readWalletConnectorState();
  emit();
  return { ok: state.connected, notice: state.notice, state };
}

/**
 * CAIP-10 session evidence. Only accounts of the exact form
 * `eip155:<decimal chain>:<0x address>` count, and the chain id is normalized
 * through the same strict parser used everywhere else.
 */
function readSessionChainEvidence(provider: Eip1193Provider): string[] {
  const session = (
    provider as unknown as {
      session?: { namespaces?: Record<string, { accounts?: unknown }> };
    }
  ).session;
  const accounts = session?.namespaces?.["eip155"]?.accounts;
  if (!Array.isArray(accounts)) return [];
  const found: string[] = [];
  for (const entry of accounts) {
    if (typeof entry !== "string") continue;
    const parts = entry.split(":");
    if (parts.length !== 3) continue;
    if (parts[0] !== "eip155") continue;
    if (!/^(0|[1-9][0-9]*)$/.test(parts[1] ?? "")) continue;
    if (!/^0x[0-9a-fA-F]{40}$/.test(parts[2] ?? "")) continue;
    const hex = normalizeChainId(Number(parts[1]));
    if (hex !== null && !found.includes(hex)) found.push(hex);
  }
  return found;
}

function hasPersistedSession(provider: Eip1193Provider): boolean {
  return Boolean((provider as unknown as { session?: unknown }).session);
}

async function tearDownWalletConnect(provider: Eip1193Provider): Promise<void> {
  try {
    await (provider as unknown as { disconnect: () => Promise<void> }).disconnect();
  } catch {
    // Best-effort teardown only. Local state is cleared regardless.
  }
}

/**
 * Robinhood Wallet, MetaMask and any other EVM wallet connect over
 * WalletConnect.
 *
 * Chain 4663 is proposed as an OPTIONAL namespace so wallet discovery is not
 * hard-gated on a custom chain: the modal opens for every EVM wallet, and the
 * installed 2.24 provider still negotiates the requested `eth_sendTransaction`
 * method and the account/chain events through the optional namespace. The
 * strict requirement is enforced AFTER connection by the CAIP-10 evidence gate
 * below: a session that does not actually include `eip155:4663` is torn down
 * and never activated. The connector still never asks a wallet to add or
 * switch a network.
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

  // STAGE 1 — browser bundle load only. A failure here means the WalletConnect
  // / modal chunk could not be loaded or evaluated in this browser, which is a
  // different defect from a provider that fails to initialize. Only a
  // sanitized code is produced: the caught error is never read, formatted,
  // logged or returned.
  let EthereumProvider: typeof import("@walletconnect/ethereum-provider").EthereumProvider;
  try {
    ({ EthereumProvider } = await import("@walletconnect/ethereum-provider"));
  } catch {
    return {
      ok: false,
      notice: "WALLETCONNECT_LIBRARY_LOAD_FAILED",
      state: emptyState("WALLETCONNECT_LIBRARY_LOAD_FAILED"),
    };
  }

  // STAGE 2 — provider initialization (config, storage, relay/modal setup).
  let provider: Eip1193Provider;
  try {
    // MODAL BASELINE RESTORE (rollback of init OPTIONS only). These are the
    // exact options from the last revision where the wallet chooser modal was
    // observed to open (pre mobile-hardening). The later-added `rpcMap`,
    // `qrModalOptions.enableMobileFullScreen` and favicon metadata icon are
    // intentionally NOT present here. Every later connection-correctness fix
    // (optional 4663 proposal, post-connect CAIP-10 evidence, stale-session
    // teardown, bounded handshake, listener cleanup, split diagnostics) is
    // preserved outside this option set.
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

  // STALE SESSION HARDENING. `init()` restores any persisted pairing. A canary
  // connection must be explicit and fresh, so an inherited session is torn
  // down before the handshake instead of being silently trusted.
  if (hasPersistedSession(provider)) {
    await tearDownWalletConnect(provider);
    clearLocalConnectionState();
  }

  // Bounded handshake. On timeout the connector fails closed and stays
  // disconnected: it never re-attempts, never re-establishes, never sends.
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
    clearLocalConnectionState();
    await tearDownWalletConnect(provider);
    emit();
    const notice: WalletConnectorNotice = timedOut
      ? "WALLETCONNECT_TIMEOUT"
      : "CONNECTION_REJECTED_OR_FAILED";
    return { ok: false, notice, state: emptyState(notice) };
  } finally {
    if (timer !== undefined) clearTimeout(timer);
  }

  // CHAIN EVIDENCE GATE. The provider's default chain value is not trusted:
  // only real CAIP-10 accounts in the negotiated session count.
  const evidence = readSessionChainEvidence(provider);
  if (!evidence.includes(ROBINHOOD_MAINNET_CHAIN_ID_HEX_CANONICAL)) {
    clearLocalConnectionState();
    await tearDownWalletConnect(provider);
    emit();
    return {
      ok: false,
      notice: "WRONG_CHAIN_APPROVED",
      state: emptyState("WRONG_CHAIN_APPROVED"),
    };
  }

  walletConnectProvider = provider;
  activeProvider = provider;
  activeKind = "walletconnect";
  sessionChainEvidence = evidence;
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
  clearLocalConnectionState();
  if (provider) {
    // A failed teardown must never leave the UI claiming a live session, so
    // local state was already cleared above.
    await tearDownWalletConnect(provider);
  }
  emit();
}

export async function disconnect(): Promise<void> {
  if (activeKind === "walletconnect") {
    await disconnectWalletConnect();
    return;
  }
  // Injected wallets cannot be revoked from a dapp; drop the local handle only.
  clearLocalConnectionState();
  emit();
}
