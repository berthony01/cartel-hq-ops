import { ROBINHOOD_MAINNET_CHAIN_ID } from "./chain-mainnet-registry";
import {
  closeAppKit,
  disconnectAppKit,
  getAppKitChainId,
  getCurrentOrigin,
  isReownConfigured,
  openAppKitConnect,
  type AppKitNotice,
} from "./reown-appkit-wallet";

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
 *   - This module NEVER signs, never sends, never estimates and never ADDS a
 *     network. It resolves an EIP-1193 provider, and exposes exactly one
 *     explicit, user-gesture-only `wallet_switchEthereumChain` helper
 *     (`requestRobinhoodChainSwitch`) that is never called on mount, connect,
 *     re-check or any provider event. `wallet_addEthereumChain` is absent on
 *     purpose: an unknown network fails closed and the operator adds it in the
 *     wallet itself.

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
  | "REOWN_LIBRARY_LOAD_FAILED"
  | "REOWN_ORIGIN_NOT_ALLOWED"
  | "REOWN_PROJECT_ID_INVALID_OR_MISSING"
  | "REOWN_CONFIG_SERVER_ERROR"
  | "REOWN_RATE_LIMITED"
  | "REOWN_APPKIT_INIT_FAILED"
  | "REOWN_CONNECT_FAILED"
  | "WALLETCONNECT_TIMEOUT"
  | "CHAIN_NOT_APPROVED_IN_SESSION"
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

/**
 * RECONNECT INFRASTRUCTURE.
 *
 * The low-level `@walletconnect/ethereum-provider` initialization path — the
 * one that repeatedly produced `WALLETCONNECT_INIT_FAILED` on mobile — has been
 * REMOVED. All multi-wallet connection infrastructure now lives in the official
 * Reown AppKit singleton (`reown-appkit-wallet.ts`), which is created at most
 * once per browser lifecycle and reused across disconnect/reconnect cycles.
 * This module keeps SESSION state only.
 */

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

/**
 * PUBLIC client identifier, owned by the AppKit module. Absent => the mobile /
 * multi-wallet chooser stays unavailable and fails closed.
 */
export function isWalletConnectConfigured(): boolean {
  return isReownConfigured();
}

/**
 * Current browser origin, exposed so the panel can name the exact origin that
 * must be allow-listed in the Reown dashboard. Derived from
 * `window.location.origin` only — never a secret and never a hardcoded domain.
 */
export function getConnectorOrigin(): string | null {
  return getCurrentOrigin();
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

/** True only when the resolved provider really carries a WalletConnect session. */
function hasWalletConnectSession(provider: Eip1193Provider): boolean {
  return Boolean((provider as unknown as { session?: unknown }).session);
}

/** Maps a sanitized AppKit code onto the connector's notice union. */
function mapAppKitNotice(notice: AppKitNotice): WalletConnectorNotice {
  switch (notice) {
    case "REOWN_NOT_CONFIGURED":
      return "WALLETCONNECT_NOT_CONFIGURED";
    case "REOWN_LIBRARY_LOAD_FAILED":
      return "REOWN_LIBRARY_LOAD_FAILED";
    case "REOWN_ORIGIN_NOT_ALLOWED":
      return "REOWN_ORIGIN_NOT_ALLOWED";
    case "REOWN_PROJECT_ID_INVALID_OR_MISSING":
      return "REOWN_PROJECT_ID_INVALID_OR_MISSING";
    case "REOWN_CONFIG_SERVER_ERROR":
      return "REOWN_CONFIG_SERVER_ERROR";
    case "REOWN_RATE_LIMITED":
      return "REOWN_RATE_LIMITED";
    case "REOWN_CONNECT_FAILED":
      return "REOWN_CONNECT_FAILED";
    default:
      return "REOWN_APPKIT_INIT_FAILED";
  }
}

/**
 * OFFICIAL REOWN APPKIT CONNECT — GATE 1 (CONNECTION) ONLY.
 *
 * Robinhood Wallet, MetaMask, Trust and every other supported EVM wallet stay
 * discoverable. Explicit click only: the AppKit `Connect` view is opened scoped
 * to the `eip155` namespace, and the connector waits through AppKit's own
 * subscriptions with a bounded timeout, no polling and no automatic retry.
 *
 * Connection success is INDEPENDENT of Robinhood Chain eligibility. A session
 * that carries no `eip155:4663` evidence, or a wallet sitting on another EVM
 * network, stays connected and is reported through the separate Gate 2
 * classification (`classifyWalletConnection`) so the operator can make an
 * explicit switch decision. This function never switches, never adds a network
 * and never signs or sends.
 *
 * The pre-send chain requirement is NOT weakened: session chain evidence is
 * recorded only when 4663 is actually proven, and every downstream deployment
 * guard keeps performing its own independent live chain check.
 */

export async function connectWalletConnect(): Promise<WalletConnectorResult> {
  if (typeof window === "undefined") {
    return {
      ok: false,
      notice: "REOWN_APPKIT_INIT_FAILED",
      state: emptyState("REOWN_APPKIT_INIT_FAILED"),
    };
  }
  if (!isWalletConnectConfigured()) {
    return {
      ok: false,
      notice: "WALLETCONNECT_NOT_CONFIGURED",
      state: emptyState("WALLETCONNECT_NOT_CONFIGURED"),
    };
  }

  const outcome = await openAppKitConnect(WALLETCONNECT_CONNECT_TIMEOUT_MS);
  if (outcome.status !== "connected") {
    clearLocalConnectionState();
    await disconnectAppKit();
    await closeAppKit();
    emit();
    const notice: WalletConnectorNotice =
      outcome.status === "timeout"
        ? "WALLETCONNECT_TIMEOUT"
        : outcome.status === "rejected"
          ? "CONNECTION_REJECTED_OR_FAILED"
          : mapAppKitNotice(outcome.notice);
    return { ok: false, notice, state: emptyState(notice) };
  }

  const provider = outcome.provider as Eip1193Provider;

  /*
   * GATE 1 ONLY — CONNECTION. A wallet that connects on another EVM network
   * STAYS CONNECTED: chain eligibility is Gate 2 and is classified separately
   * (`classifyWalletConnection`) from the live provider chain. Nothing here
   * tears down a session for being on the wrong network, and nothing here
   * requests a network change.
   *
   * The chain EVIDENCE recorded for the pre-send guard is unchanged and
   * unweakened: it is set only when Robinhood Chain 4663 is actually proven,
   * by CAIP-10 session accounts or by AppKit + a live `eth_chainId` agreeing.
   * Absent proof it stays null, so the canary send path still fails closed.
   */
  let evidence: string[] | null = null;
  if (hasWalletConnectSession(provider)) {
    const sessionEvidence = readSessionChainEvidence(provider);
    evidence = sessionEvidence.includes(ROBINHOOD_MAINNET_CHAIN_ID_HEX_CANONICAL)
      ? sessionEvidence
      : null;
  } else {
    const appKitChain = normalizeChainId(getAppKitChainId());
    const liveRaw = await provider.request({ method: "eth_chainId" }).catch(() => null);
    const liveChain = normalizeChainId(liveRaw);
    evidence =
      appKitChain === ROBINHOOD_MAINNET_CHAIN_ID_HEX_CANONICAL &&
      liveChain === ROBINHOOD_MAINNET_CHAIN_ID_HEX_CANONICAL
        ? [ROBINHOOD_MAINNET_CHAIN_ID_HEX_CANONICAL]
        : null;
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

/**
 * SESSION teardown through the OFFICIAL AppKit disconnect. The AppKit singleton
 * itself stays alive so a later explicit reconnect on the same page reuses it
 * instead of re-initializing, and nothing reconnects on its own
 * (`enableReconnect: false`). No storage key is ever read or deleted.
 */
export async function disconnectWalletConnect(): Promise<void> {
  clearLocalConnectionState();
  // A failed teardown must never leave the UI claiming a live session, so
  // local state was already cleared above.
  await disconnectAppKit();
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

/* ------------------------------------------------------------------ */
/* Explicit, user-gesture-only network switch                          */
/* ------------------------------------------------------------------ */

export type WalletSwitchNotice =
  | "NO_ACTIVE_CONNECTOR"
  | "NETWORK_SWITCH_REJECTED"
  | "NETWORK_SWITCH_UNSUPPORTED"
  | "NETWORK_UNKNOWN_TO_WALLET"
  | "NETWORK_SWITCH_FAILED";

export type WalletSwitchResult = { ok: boolean; notice: WalletSwitchNotice | null };

/**
 * The single canonical switch parameter. Derived from the frozen chain id, so
 * it can never drift from `ROBINHOOD_MAINNET_CHAIN_ID` (4663 => `0x1237`).
 */
export const ROBINHOOD_MAINNET_SWITCH_CHAIN_ID_HEX = ROBINHOOD_MAINNET_CHAIN_ID_HEX_CANONICAL;

function readProviderErrorCode(error: unknown): number | null {
  if (!error || typeof error !== "object") return null;
  const code = (error as { code?: unknown }).code;
  return typeof code === "number" ? code : null;
}

/**
 * EXPLICIT USER GESTURE ONLY. This is the ONLY place in the entire client that
 * may call `wallet_switchEthereumChain`, and it is invoked exclusively from the
 * operator's click on the "Switch to Robinhood Chain" button. It is never
 * called on mount, on connect, on re-check, or from any provider event handler.
 *
 * It NEVER calls `wallet_addEthereumChain`: a wallet that does not already know
 * Robinhood Chain fails closed with `NETWORK_UNKNOWN_TO_WALLET`. There is no
 * retry, no loop and no fallback. Only sanitized codes are produced — the
 * caught error's message, data and stack are never read, logged or returned.
 */
export async function requestRobinhoodChainSwitch(): Promise<WalletSwitchResult> {
  const provider = getActiveProvider();
  if (!provider) return { ok: false, notice: "NO_ACTIVE_CONNECTOR" };
  try {
    await provider.request({
      method: "wallet_switchEthereumChain",
      params: [{ chainId: ROBINHOOD_MAINNET_SWITCH_CHAIN_ID_HEX }],
    });
  } catch (error) {
    const code = readProviderErrorCode(error);
    const notice: WalletSwitchNotice =
      code === 4001
        ? "NETWORK_SWITCH_REJECTED"
        : code === 4902
          ? "NETWORK_UNKNOWN_TO_WALLET"
          : code === 4200 || code === -32601
            ? "NETWORK_SWITCH_UNSUPPORTED"
            : "NETWORK_SWITCH_FAILED";
    return { ok: false, notice };
  }
  emit();
  return { ok: true, notice: null };
}

/**
 * ONE EXPLICIT OPERATOR CLICK. This helper exists only so the phone operator
 * does not have to press a second CARTEL HQ button after the wallet returns on
 * the wrong network. It is invoked EXCLUSIVELY from the panel's explicit
 * "Connect wallet on Robinhood Chain" click handler — never on mount, never on
 * a provider event, never from a subscription and never from re-check.
 *
 * It performs at most:
 *   1. the normal explicit connect, and
 *   2. if that connect succeeded but the live chain is not 4663, exactly ONE
 *      `wallet_switchEthereumChain` request through the single canonical helper.
 *
 * There is no retry, no loop, no `wallet_addEthereumChain`, and no weakening of
 * any chain evidence or pre-send guard: a declined or failed switch simply
 * returns its sanitized notice and the wallet stays on its own network.
 */
export async function connectWalletConnectOnRobinhoodChain(): Promise<{
  connect: WalletConnectorResult;
  switched: WalletSwitchResult | null;
}> {
  const connect = await connectWalletConnect();
  if (!connect.ok) return { connect, switched: null };
  if (connect.state.chainId === ROBINHOOD_MAINNET_CHAIN_ID_HEX_CANONICAL) {
    return { connect, switched: null };
  }
  if (getActiveProvider() === null) return { connect, switched: null };
  const switched = await requestRobinhoodChainSwitch();
  return { connect, switched };
}

