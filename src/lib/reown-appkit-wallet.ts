import {
  ROBINHOOD_MAINNET_CHAIN_ID,
  ROBINHOOD_MAINNET_EXPLORER_URL,
  ROBINHOOD_MAINNET_PUBLIC_DIAGNOSTIC_RPC_URL,
} from "./chain-mainnet-registry";

/**
 * P3C-G — OFFICIAL REOWN APPKIT SINGLETON (browser only).
 *
 * This module owns the AppKit instance and NOTHING else. It never signs, never
 * sends, never estimates, never adds a network and never switches a network:
 * `enableNetworkSwitch` is disabled so the ONLY network change in the entire
 * client stays the explicit user-gesture `wallet_switchEthereumChain` helper in
 * `wallet-connector.ts`.
 *
 * Safety properties, by construction:
 *   - No module-scope browser access. `window` is read inside functions only,
 *     and every AppKit package is loaded through a DYNAMIC import inside a
 *     browser-executed function, so TanStack Start SSR never evaluates it.
 *   - `createAppKit` runs AT MOST ONCE per browser lifecycle, guarded by both a
 *     cached handle and a single in-flight promise.
 *   - `enableReconnect: false` — AppKit never silently restores a wallet
 *     session. A connection only ever begins from an explicit operator click.
 *   - The Reown project id is a PUBLIC client identifier read from
 *     `VITE_WALLETCONNECT_PROJECT_ID`. It is never hardcoded and never surfaced.
 *   - Diagnostics are SANITIZED CODES ONLY. No exception message, stack, URL,
 *     relay endpoint, project id or source path ever leaves this module.
 */

export type AppKitNotice =
  | "REOWN_NOT_CONFIGURED"
  | "REOWN_LIBRARY_LOAD_FAILED"
  | "REOWN_ORIGIN_NOT_ALLOWED"
  | "REOWN_PROJECT_ID_INVALID_OR_MISSING"
  | "REOWN_CONFIG_SERVER_ERROR"
  | "REOWN_RATE_LIMITED"
  | "REOWN_APPKIT_INIT_FAILED"
  | "REOWN_STALE_SESSION"
  | "REOWN_CONNECT_FAILED";

export type MinimalEip1193 = {
  request: (args: { method: string; params?: unknown[] }) => Promise<unknown>;
  on?: (event: string, listener: (...args: unknown[]) => void) => void;
  removeListener?: (event: string, listener: (...args: unknown[]) => void) => void;
};

/**
 * The REAL AppKit instance type, taken from the installed package through a
 * TYPE-ONLY import (erased at build time, so SSR still never evaluates AppKit).
 * A hand-written interface is deliberately avoided here: it can silently invent
 * a method name that does not exist at runtime.
 */
type AppKitHandle = import("@reown/appkit").AppKit;

/**
 * Robinhood Chain mainnet, declared with the project's own frozen constants and
 * typed against the installed `CaipNetwork` contract so a missing or misnamed
 * required property is a compile error rather than a runtime surprise.
 * Declaring the network does NOT imply any automatic switch: it only lets the
 * chooser describe the chain the operator must already be on.
 */
export const ROBINHOOD_APPKIT_NETWORK: import("@reown/appkit-common").CaipNetwork = {
  id: ROBINHOOD_MAINNET_CHAIN_ID as number,
  caipNetworkId: `eip155:${ROBINHOOD_MAINNET_CHAIN_ID}`,
  chainNamespace: "eip155",
  name: "Robinhood Chain",
  nativeCurrency: { name: "Ether", symbol: "ETH", decimals: 18 },
  rpcUrls: { default: { http: [ROBINHOOD_MAINNET_PUBLIC_DIAGNOSTIC_RPC_URL] } },
  blockExplorers: {
    default: { name: "Blockscout", url: ROBINHOOD_MAINNET_EXPLORER_URL },
  },
};

let appKitHandle: AppKitHandle | null = null;
let appKitInitPromise: Promise<{ appKit: AppKitHandle | null; notice: AppKitNotice | null }> | null =
  null;

export function getReownProjectId(): string | null {
  const raw = (import.meta.env as Record<string, string | undefined>)[
    "VITE_WALLETCONNECT_PROJECT_ID"
  ];
  if (typeof raw !== "string") return null;
  const value = raw.trim();
  return value.length > 0 ? value : null;
}

export function isReownConfigured(): boolean {
  return getReownProjectId() !== null;
}

/** Current browser origin, used for AppKit metadata and operator guidance. */
export function getCurrentOrigin(): string | null {
  if (typeof window === "undefined") return null;
  try {
    return window.location.origin;
  } catch {
    return null;
  }
}

/**
 * SANITIZED mapping of documented Reown APKT configuration errors. Only the
 * error CODE TOKEN is ever inspected; the message itself is discarded and never
 * returned, logged or rendered.
 */
export function classifyAppKitError(error: unknown): AppKitNotice {
  let token = "";
  try {
    const message = error instanceof Error ? error.message : String(error ?? "");
    const match = /APKT\d{3}/.exec(message);
    token = match ? match[0] : "";
  } catch {
    token = "";
  }
  switch (token) {
    case "APKT002":
      return "REOWN_ORIGIN_NOT_ALLOWED";
    case "APKT007":
    case "APKT008":
      return "REOWN_PROJECT_ID_INVALID_OR_MISSING";
    case "APKT009":
      return "REOWN_CONFIG_SERVER_ERROR";
    case "APKT010":
      return "REOWN_RATE_LIMITED";
    default:
      return "REOWN_APPKIT_INIT_FAILED";
  }
}

async function runCreateAppKit(
  projectId: string,
): Promise<{ appKit: AppKitHandle | null; notice: AppKitNotice | null }> {
  let createAppKit: typeof import("@reown/appkit").createAppKit;
  let EthersAdapter: typeof import("@reown/appkit-adapter-ethers").EthersAdapter;
  try {
    ({ createAppKit } = await import("@reown/appkit"));
    ({ EthersAdapter } = await import("@reown/appkit-adapter-ethers"));
  } catch {
    return { appKit: null, notice: "REOWN_LIBRARY_LOAD_FAILED" };
  }

  try {
    const origin = getCurrentOrigin() ?? "";
    // THE ONLY `createAppKit` CALL IN THE APPLICATION.
    const instance = createAppKit({
      adapters: [new EthersAdapter() as never],
      projectId,
      networks: [ROBINHOOD_APPKIT_NETWORK],
      defaultNetwork: ROBINHOOD_APPKIT_NETWORK,
      // Never restore a wallet on its own, and never move the network itself.
      enableReconnect: false,
      enableNetworkSwitch: false,
      allowUnsupportedChain: true,
      // Broad EVM wallet discovery stays on: MetaMask, Robinhood Wallet, Trust
      // and every other supported wallet must remain choosable.
      enableWalletConnect: true,
      enableInjected: true,
      enableEIP6963: true,
      enableCoinbase: true,
      showWallets: true,
      themeMode: "dark",
      // Non-wallet product surfaces are irrelevant to a deployment canary.
      features: {
        swaps: false,
        onramp: false,
        send: false,
        receive: false,
        history: false,
        email: false,
        socials: false,
        analytics: false,
        pay: false,
        allWallets: true,
      },
      metadata: {
        name: "CARTEL HQ",
        description: "CARTEL HQ deployment wallet connection",
        url: origin,
        icons: origin ? [`${origin}/favicon.ico`] : [],
      },
    });
    /**
     * PROVEN READINESS GAP. `createAppKit` returns before its internal
     * `initialize()` promise settles, and the installed `open()` awaits only
     * `injectModalUi()` — never that promise. The installed client exposes the
     * public `ready(): Promise<void>` which awaits it, so the chooser is only
     * ever opened after initialization has completed. This awaits readiness; it
     * connects nothing, opens nothing and touches no wallet.
     */
    await instance.ready();
    return { appKit: instance, notice: null };
  } catch (error) {
    return { appKit: null, notice: classifyAppKitError(error) };
  }
}

/**
 * At most one AppKit per browser lifecycle. A failed creation clears both the
 * cache and the in-flight promise so a later explicit click may retry.
 */
export async function ensureAppKit(): Promise<{
  appKit: AppKitHandle | null;
  notice: AppKitNotice | null;
}> {
  if (typeof window === "undefined") {
    return { appKit: null, notice: "REOWN_APPKIT_INIT_FAILED" };
  }
  const projectId = getReownProjectId();
  if (!projectId) return { appKit: null, notice: "REOWN_NOT_CONFIGURED" };
  if (appKitHandle) return { appKit: appKitHandle, notice: null };
  if (!appKitInitPromise) appKitInitPromise = runCreateAppKit(projectId);
  const outcome = await appKitInitPromise;
  if (outcome.appKit) {
    appKitHandle = outcome.appKit;
  } else {
    appKitHandle = null;
    appKitInitPromise = null;
  }
  return outcome;
}

export function getAppKitIfInitialized(): AppKitHandle | null {
  return appKitHandle;
}

/** Actual EIP-1193 provider AppKit resolved for the live connection. */
export function getAppKitWalletProvider(): MinimalEip1193 | null {
  const appKit = appKitHandle;
  if (!appKit) return null;
  const provider = appKit.getWalletProvider();
  if (!provider || typeof provider !== "object") return null;
  if (typeof (provider as { request?: unknown }).request !== "function") return null;
  return provider as MinimalEip1193;
}

/** AppKit-reported chain id, raw. Normalization happens in the connector. */
export function getAppKitChainId(): string | number | null {
  const appKit = appKitHandle;
  if (!appKit) return null;
  const value = appKit.getChainId();
  return value === undefined ? null : value;
}

export function getAppKitAddress(): string | null {
  const appKit = appKitHandle;
  if (!appKit) return null;
  const value = appKit.getAddress("eip155");
  return typeof value === "string" && value.length > 0 ? value : null;
}

export type AppKitConnectOutcome =
  | { status: "connected"; provider: MinimalEip1193 }
  | { status: "rejected" }
  | { status: "timeout" }
  | { status: "failed"; notice: AppKitNotice };

/**
 * Proven teardown of any existing AppKit `eip155` connection.
 *
 * Returns TRUE only when, after the official disconnect, AppKit reports no
 * connected state, no address and no wallet provider. A teardown that cannot be
 * PROVEN returns FALSE so the caller fails closed instead of letting an old
 * session stand in for a new operator choice. It never connects, never opens a
 * chooser, never signs and never sends.
 */
export async function resetAppKitConnection(): Promise<boolean> {
  const appKit = appKitHandle;
  // Never initialized in this browser lifecycle => there is nothing to inherit.
  if (!appKit) return true;
  try {
    await appKit.disconnect("eip155");
  } catch {
    // Teardown is PROVEN below, never assumed from the absence of an error.
  }
  try {
    return (
      appKit.getIsConnectedState() === false &&
      getAppKitAddress() === null &&
      getAppKitWalletProvider() === null
    );
  } catch {
    return false;
  }
}

/** True when AppKit currently holds ANY eip155 connection evidence. */
export function hasAppKitConnectionEvidence(): boolean {
  const appKit = appKitHandle;
  if (!appKit) return false;
  try {
    return (
      appKit.getIsConnectedState() === true ||
      getAppKitAddress() !== null ||
      getAppKitWalletProvider() !== null
    );
  } catch {
    return true;
  }
}

/**
 * EXPLICIT CLICK ONLY. Opens the official AppKit `Connect` view scoped to the
 * `eip155` namespace and waits — through AppKit's own subscriptions, with no
 * polling loop and no automatic retry — for a real provider, a modal close, or
 * the bounded timeout.
 *
 * FRESH-ATTEMPT GUARD. A previously connected provider/account can NEVER settle
 * this attempt: any pre-existing connection evidence fails closed with
 * `REOWN_STALE_SESSION`, and no connection evidence at all is accepted until
 * this attempt's chooser interaction has actually begun.
 */
export async function openAppKitConnect(timeoutMs: number): Promise<AppKitConnectOutcome> {
  const { appKit, notice } = await ensureAppKit();
  if (!appKit) return { status: "failed", notice: notice ?? "REOWN_APPKIT_INIT_FAILED" };
  if (hasAppKitConnectionEvidence()) return { status: "failed", notice: "REOWN_STALE_SESSION" };

  return await new Promise<AppKitConnectOutcome>((resolve) => {
    let settled = false;
    let sawOpen = false;
    /** Only evidence arising AFTER this attempt's chooser opened may settle it. */
    let chooserStarted = false;
    let modalClosed = false;
    let handoffObserved = false;
    const unsubscribers: Array<() => void> = [];
    let timeoutTimer: ReturnType<typeof setTimeout> | undefined;
    let rejectionTimer: ReturnType<typeof setTimeout> | undefined;
    let visibleBudgetMs = timeoutMs;
    let visibleStartedAt: number | null = null;

    const clearRejectionTimer = () => {
      if (rejectionTimer !== undefined) clearTimeout(rejectionTimer);
      rejectionTimer = undefined;
    };

    const pauseVisibleBudget = () => {
      if (timeoutTimer !== undefined) clearTimeout(timeoutTimer);
      timeoutTimer = undefined;
      if (visibleStartedAt !== null) {
        visibleBudgetMs = Math.max(0, visibleBudgetMs - (Date.now() - visibleStartedAt));
        visibleStartedAt = null;
      }
    };

    const startVisibleBudget = () => {
      if (settled || document.hidden || !document.hasFocus() || timeoutTimer !== undefined) return;
      if (visibleBudgetMs <= 0) {
        finish({ status: "timeout" });
        return;
      }
      visibleStartedAt = Date.now();
      timeoutTimer = setTimeout(() => finish({ status: "timeout" }), visibleBudgetMs);
    };

    const finish = (outcome: AppKitConnectOutcome) => {
      if (settled) return;
      settled = true;
      pauseVisibleBudget();
      clearRejectionTimer();
      document.removeEventListener("visibilitychange", handleVisibilityChange);
      window.removeEventListener("blur", handleBlur);
      window.removeEventListener("focus", handleFocus);
      for (const off of unsubscribers) {
        try {
          off();
        } catch {
          // Unsubscribe failures are never fatal and never surfaced.
        }
      }
      resolve(outcome);
    };

    const tryResolveConnected = () => {
      // Nothing that predates this attempt's chooser may satisfy it.
      if (!chooserStarted) return;
      const provider = getAppKitWalletProvider();
      if (provider && appKit.getIsConnectedState()) {
        finish({ status: "connected", provider });
      }
    };

    const scheduleVisibleRejection = () => {
      clearRejectionTimer();
      if (settled || !modalClosed || document.hidden || !document.hasFocus()) return;
      // A plain in-page dismissal rejects quickly. A wallet-app handoff gets a
      // longer return grace so AppKit can publish the approved provider/account.
      const graceMs = handoffObserved ? 5_000 : 1_000;
      rejectionTimer = setTimeout(() => {
        tryResolveConnected();
        if (!settled && !document.hidden && document.hasFocus()) {
          finish({ status: "rejected" });
        }
      }, graceMs);
    };

    const handleVisibilityChange = () => {
      if (document.hidden) {
        handoffObserved = true;
        clearRejectionTimer();
        pauseVisibleBudget();
        return;
      }
      tryResolveConnected();
      startVisibleBudget();
      scheduleVisibleRejection();
    };

    const handleBlur = () => {
      handoffObserved = true;
      clearRejectionTimer();
      pauseVisibleBudget();
    };

    const handleFocus = () => {
      tryResolveConnected();
      startVisibleBudget();
      scheduleVisibleRejection();
    };

    try {
      unsubscribers.push(appKit.subscribeProviders(() => tryResolveConnected()));
      unsubscribers.push(appKit.subscribeAccount(() => tryResolveConnected()));
      unsubscribers.push(
        appKit.subscribeState((state) => {
          if (state.open) {
            sawOpen = true;
            chooserStarted = true;
            return;
          }
          if (!sawOpen) return;
          modalClosed = true;
          tryResolveConnected();
          scheduleVisibleRejection();
        }),
      );
      document.addEventListener("visibilitychange", handleVisibilityChange);
      window.addEventListener("blur", handleBlur);
      window.addEventListener("focus", handleFocus);
    } catch {
      finish({ status: "failed", notice: "REOWN_CONNECT_FAILED" });
      return;
    }

    startVisibleBudget();

    void appKit
      .open({ view: "Connect", namespace: "eip155" })
      .then(() => tryResolveConnected())
      .catch(() => finish({ status: "failed", notice: "REOWN_CONNECT_FAILED" }));
  });
}

/**
 * Official AppKit disconnect. No storage key is ever read or deleted here, and
 * nothing reconnects afterwards (`enableReconnect: false`).
 */
export async function disconnectAppKit(): Promise<void> {
  const appKit = appKitHandle;
  if (!appKit) return;
  try {
    await appKit.disconnect("eip155");
  } catch {
    // Best-effort teardown. The connector clears its local state regardless.
  }
}

/** Best-effort close of the chooser after a failed or abandoned attempt. */
export async function closeAppKit(): Promise<void> {
  const appKit = appKitHandle;
  if (!appKit) return;
  try {
    await appKit.close();
  } catch {
    // Never fatal.
  }
}
