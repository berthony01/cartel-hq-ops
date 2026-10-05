import {
  ROBINHOOD_MAINNET_CHAIN_ID,
  ROBINHOOD_MAINNET_EXPLORER_URL,
  ROBINHOOD_MAINNET_PUBLIC_DIAGNOSTIC_RPC_URL,
} from "./chain-mainnet-registry";
import {
  ROBINHOOD_TESTNET_CHAIN_ID,
  ROBINHOOD_TESTNET_EXPLORER_URL,
  ROBINHOOD_TESTNET_RPC_URL,
} from "./chain-registry";

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
  | "REOWN_CHUNK_FETCH_FAILED"
  | "REOWN_MODULE_EVAL_FAILED"
  | "REOWN_CUSTOM_ELEMENT_CONFLICT"
  /** Legacy only: the single-bridge path never emits this. */
  | "REOWN_ADAPTER_LOAD_FAILED"
  | "REOWN_ORIGIN_NOT_ALLOWED"
  | "REOWN_PROJECT_ID_INVALID_OR_MISSING"
  | "REOWN_CONFIG_SERVER_ERROR"
  | "REOWN_RATE_LIMITED"
  | "REOWN_APPKIT_INIT_FAILED"
  | "REOWN_STALE_SESSION"
  | "REOWN_WALLETCONNECT_UNAVAILABLE"
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

/**
 * Robinhood Chain TESTNET (46630), declared ONLY so a WalletConnect session can
 * authorize it for the Testnet Lab's explicit switch. Declaring it grants no
 * mainnet capability: the mainnet connector still requires live `eip155:4663`
 * evidence, and the Testnet Lab still requires live 46630 before any send.
 * Mainnet remains the default network.
 */
export const ROBINHOOD_TESTNET_APPKIT_NETWORK: import("@reown/appkit-common").CaipNetwork = {
  id: ROBINHOOD_TESTNET_CHAIN_ID as number,
  caipNetworkId: `eip155:${ROBINHOOD_TESTNET_CHAIN_ID}`,
  chainNamespace: "eip155",
  name: "Robinhood Chain Testnet",
  nativeCurrency: { name: "Ether", symbol: "ETH", decimals: 18 },
  rpcUrls: { default: { http: [ROBINHOOD_TESTNET_RPC_URL] } },
  blockExplorers: {
    default: { name: "Blockscout", url: ROBINHOOD_TESTNET_EXPLORER_URL },
  },
  testnet: true,
};

let appKitHandle: AppKitHandle | null = null;
let appKitInitPromise: Promise<{ appKit: AppKitHandle | null; notice: AppKitNotice | null }> | null =
  null;
/**
 * Browser-lifecycle WagmiAdapter handle, retained ONLY for WalletConnect
 * readiness checks. Module-private; never exported.
 */
let wagmiAdapterHandle: InstanceType<AppKitBridge["WagmiAdapter"]> | null = null;
/**
 * Browser-lifecycle UniversalProvider handle, retained ONLY so an explicit
 * reset can use its official `disconnect()` / `cleanupPendingPairings()` when a
 * rehydrated WalletConnect session survives AppKit's own disconnect. Module-private.
 */
let universalProviderHandle: {
  session?: unknown;
  disconnect: () => Promise<void>;
  cleanupPendingPairings: () => Promise<void>;
} | null = null;

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

/**
 * SANITIZED lazy-module failure classifier. The error text is inspected
 * locally and discarded; it is never returned, logged, stored or rendered.
 *
 *  - REOWN_CHUNK_FETCH_FAILED: dynamic-module fetch TypeErrors AND Vite's
 *    generic preload Errors (stale hashed files after a deployment).
 *  - REOWN_CUSTOM_ELEMENT_CONFLICT: duplicate custom-element registration
 *    (DOMException / NotSupportedError "already been defined/used").
 *  - REOWN_MODULE_EVAL_FAILED: any other bridge evaluation failure.
 */
const CHUNK_FETCH_PATTERNS: readonly RegExp[] = [
  /failed to fetch dynamically imported module/i,
  /error loading dynamically imported module/i,
  /importing a module script failed/i,
  /unable to preload css/i,
  /failed to preload/i,
  /failed to fetch/i,
  /load failed/i,
];

const CUSTOM_ELEMENT_PATTERNS: readonly RegExp[] = [
  /has already been (defined|used)/i,
  /already been used with this registry/i,
  /customelementregistry/i,
];

function safeErrorText(error: unknown): string {
  try {
    return String(error ?? "");
  } catch {
    return "";
  }
}

function safeErrorName(error: unknown): string {
  try {
    const name = (error as { name?: unknown } | null)?.name;
    return typeof name === "string" ? name : "";
  } catch {
    return "";
  }
}

export function isLazyChunkFetchFailure(error: unknown): boolean {
  const text = safeErrorText(error);
  if (error instanceof TypeError || error instanceof Error) {
    return CHUNK_FETCH_PATTERNS.some((pattern) => pattern.test(text));
  }
  return false;
}

export function isCustomElementConflict(error: unknown): boolean {
  const name = safeErrorName(error);
  const text = safeErrorText(error);
  const domish = name === "NotSupportedError" || name === "DOMException" ||
    (typeof DOMException !== "undefined" && error instanceof DOMException);
  return domish && CUSTOM_ELEMENT_PATTERNS.some((pattern) => pattern.test(text));
}

export function classifyLazyLoadFailure(error: unknown): AppKitNotice {
  if (isCustomElementConflict(error)) return "REOWN_CUSTOM_ELEMENT_CONFLICT";
  if (isLazyChunkFetchFailure(error)) return "REOWN_CHUNK_FETCH_FAILED";
  return "REOWN_MODULE_EVAL_FAILED";
}

type AppKitBridge = typeof import("./reown-appkit-browser");

/**
 * The SINGLE lazy import: the local browser-only bridge that bundles the full
 * AppKit 1.8.24 runtime and the official WagmiAdapter together.
 */
async function loadAppKitLibraries(): Promise<
  { ok: true; libs: AppKitBridge } | { ok: false; notice: AppKitNotice }
> {
  let bridge: AppKitBridge;
  try {
    bridge = await import("./reown-appkit-browser");
  } catch (error) {
    return { ok: false, notice: classifyLazyLoadFailure(error) };
  }
  return { ok: true, libs: bridge };
}

/**
 * FILE PRELOAD ONLY. Downloads/evaluates the AppKit core library so a later
 * explicit Connect click does not depend on fetching them. It never creates
 * AppKit, never opens anything and never touches a wallet, storage or network.
 */
export async function preloadAppKitLibraries(): Promise<
  { ok: true } | { ok: false; notice: AppKitNotice }
> {
  if (typeof window === "undefined") return { ok: false, notice: "REOWN_MODULE_EVAL_FAILED" };
  const result = await loadAppKitLibraries();
  return result.ok ? { ok: true } : { ok: false, notice: result.notice };
}

async function runCreateAppKit(
  projectId: string,
): Promise<{ appKit: AppKitHandle | null; notice: AppKitNotice | null }> {
  const loaded = await loadAppKitLibraries();
  if (!loaded.ok) return { appKit: null, notice: loaded.notice };
  const { createAppKit, WagmiAdapter, UniversalProvider } = loaded.libs;

  try {
    const origin = getCurrentOrigin() ?? "";
    const metadata = {
      name: "CARTEL HQ",
      description: "CARTEL HQ deployment wallet connection",
      url: origin,
      icons: origin ? [`${origin}/favicon.ico`] : [],
    };
    /**
     * EXPLICIT ISOLATED WALLETCONNECT PROVIDER. AppKit 1.8.24 swallows its own
     * UniversalProvider init failures and keeps a rejected promise, so we init
     * the provider ourselves exactly ONCE per explicit attempt, in a CARTEL HQ
     * storage namespace (isolation only — old keys are never touched), and pass
     * the proven provider to AppKit. Init only: no session, chains or connect.
     */
    let universalProvider: Awaited<ReturnType<typeof UniversalProvider.init>>;
    try {
      universalProvider = await UniversalProvider.init({
        projectId,
        metadata,
        customStoragePrefix: "cartel-hq-appkit-v1",
        storageOptions: { database: "cartel-hq-walletconnect-v1" },
      });
    } catch {
      wagmiAdapterHandle = null;
      return { appKit: null, notice: "REOWN_WALLETCONNECT_UNAVAILABLE" };
    }
    // Official Reown EVM adapter (WagmiAdapter 1.8.24): injected / EIP-6963 /
    // Coinbase-Base / WalletConnect connectors. Browser-only, so ssr: false.
    const wagmiAdapter = new WagmiAdapter({
      projectId,
      networks: [ROBINHOOD_APPKIT_NETWORK, ROBINHOOD_TESTNET_APPKIT_NETWORK],
      ssr: false,
    });
    // THE ONLY `createAppKit` CALL IN THE APPLICATION.
    const instance = createAppKit({
      // Documented cast: Reown 1.8.24 types adapter `namespace` optional, which
      // exactOptionalPropertyTypes rejects. Runtime value is the real adapter.
      adapters: [wagmiAdapter as never],
      // Saved signers are EOAs: never surface a Base smart-account address.
      coinbasePreference: "eoaOnly",
      defaultAccountTypes: { eip155: "eoa" },
      // The Reown directory does not tag these wallets with eip155:4663, so the
      // chain-filtered list hides them. Featured IDs are fetched unfiltered.
      // Order: MetaMask, Base (formerly Coinbase Wallet), Robinhood Wallet,
      // Coinbase Wallet (legacy id). On mobile AppKit drops wallets without a
      // mobile/web link (_filterWalletsByPlatform) unless the id is one of its
      // CUSTOM_DEEPLINK_WALLETS; the Base id has no mobile link and is hidden,
      // the legacy Coinbase id is AppKit's built-in Coinbase/Base app path
      // (opens CARTEL HQ in the Base app via AppKit's own deeplink).
      featuredWalletIds: [
        "c57ca95b47569778a828d19178114f4db188b89b763c899ba0be274e97267d96",
        "fd20dc426fb37566d803205b19bbc1d4096b248ac04548e3cfb6b3a38bd033aa",
        "8837dd9413b1d9b585ee937d27a816590248386d9dbf59f5cd3422dbbb65683e",
        "d0ca99ff52b99abc48743dad0f7fc891e041be73574f7fac4afe5d4bb83845c8",
      ],
      allWallets: "SHOW",
      enableMobileFullScreen: true,
      // Our own proven provider — AppKit never runs its silent internal init.
      universalProvider,
      projectId,
      networks: [ROBINHOOD_APPKIT_NETWORK, ROBINHOOD_TESTNET_APPKIT_NETWORK],
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
      metadata,
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
    /**
     * WALLETCONNECT READINESS PROOF. The chooser is never returned — and so
     * never opened — until BOTH connector lists contain "walletConnect".
     */
    const proven = await proveWalletConnectReady(universalProvider, wagmiAdapter);
    if (!proven) {
      wagmiAdapterHandle = null;
      return { appKit: null, notice: "REOWN_WALLETCONNECT_UNAVAILABLE" };
    }
    wagmiAdapterHandle = wagmiAdapter;
    universalProviderHandle = universalProvider;
    return { appKit: instance, notice: null };
  } catch (error) {
    wagmiAdapterHandle = null;
    return { appKit: null, notice: classifyAppKitError(error) };
  }
}

type WalletConnectProbe = {
  connectors?: ReadonlyArray<{ id?: unknown }> | null;
  wagmiConfig?: { connectors?: ReadonlyArray<{ id?: unknown }> | null } | null;
};

/**
 * TRUE only when BOTH the AppKit AdapterBlueprint connector list AND the wagmi
 * config connector list contain id === "walletConnect".
 */
export function hasWalletConnectConnector(adapter: WalletConnectProbe | null | undefined): boolean {
  try {
    const blueprint = adapter?.connectors ?? [];
    const wagmi = adapter?.wagmiConfig?.connectors ?? [];
    return (
      blueprint.some((c) => c?.id === "walletConnect") &&
      wagmi.some((c) => c?.id === "walletConnect")
    );
  } catch {
    return false;
  }
}

/**
 * Exactly ONE recovery, only when a connector is missing: hand our already
 * initialized provider to WagmiAdapter's public `setUniversalProvider()` once,
 * then re-prove both lists. No loop, no timer, no AppKit internal getter.
 */
export async function proveWalletConnectReady<P>(
  universalProvider: P,
  adapter: WalletConnectProbe & { setUniversalProvider: (provider: P) => Promise<void> },
): Promise<boolean> {
  if (hasWalletConnectConnector(adapter)) return true;
  try {
    await adapter.setUniversalProvider(universalProvider);
  } catch {
    return false;
  }
  return hasWalletConnectConnector(adapter);
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
  if (appKitHandle) {
    // Re-prove on every explicit click: a cached chooser is never reopened
    // with dead WalletConnect tiles.
    if (!hasWalletConnectConnector(wagmiAdapterHandle)) {
      return { appKit: null, notice: "REOWN_WALLETCONNECT_UNAVAILABLE" };
    }
    return { appKit: appKitHandle, notice: null };
  }
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

/**
 * CURRENT-ACCOUNT SNAPSHOT, taken from the installed AppKit public API
 * `getAccount("eip155")` (`@reown/appkit@1.8.23`). `address` / `caipAddress` are
 * AppKit's CURRENT (operator-selected) account for the namespace — NOT an
 * arbitrary first entry — and `allAccounts` is the namespace's full account
 * list. Read-only: it connects nothing, opens nothing and touches no wallet.
 */
export type AppKitAccountSnapshot = {
  address: string | null;
  caipAddress: string | null;
  allAccounts: string[];
  isConnected: boolean;
};

export function getAppKitAccountSnapshot(): AppKitAccountSnapshot | null {
  const appKit = appKitHandle;
  if (!appKit) return null;
  let account: ReturnType<AppKitHandle["getAccount"]>;
  try {
    account = appKit.getAccount("eip155");
  } catch {
    return null;
  }
  if (!account) return null;
  const allAccounts: string[] = [];
  for (const entry of account.allAccounts ?? []) {
    if (entry && typeof entry.address === "string" && entry.address.length > 0) {
      allAccounts.push(entry.address);
    }
  }
  return {
    address: typeof account.address === "string" && account.address.length > 0
      ? account.address
      : null,
    caipAddress:
      typeof account.caipAddress === "string" && account.caipAddress.length > 0
        ? account.caipAddress
        : null,
    allAccounts,
    isConnected: account.isConnected === true,
  };
}

/**
 * AppKit CURRENT-ACCOUNT SUBSCRIPTION (`subscribeAccount`, namespace-scoped).
 * Used only to observe an operator account change; it never rebinds anything by
 * itself — the connector invalidates instead.
 */
export function subscribeAppKitAccount(listener: () => void): () => void {
  const appKit = appKitHandle;
  if (!appKit) return () => {};
  try {
    return appKit.subscribeAccount(() => listener(), "eip155");
  } catch {
    return () => {};
  }
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
  /*
   * COLD-START SAFE. An empty module handle is NOT proof that nothing persisted:
   * after a mobile reload the WalletConnect session/pairing lives in the
   * CARTEL HQ storage namespace and is rehydrated by initialization. So this
   * explicit reset initializes AppKit FIRST, then tears down and proves.
   */
  return await performFreshReset({
    ensure: async () => (await ensureAppKit()).appKit !== null,
    disconnectAppKit: async () => {
      const appKit = appKitHandle;
      if (!appKit) throw new Error("no appkit");
      await appKit.disconnect("eip155");
    },
    hasWalletConnectSession: () => universalProviderHandle?.session != null,
    disconnectWalletConnect: async () => {
      const up = universalProviderHandle;
      if (up?.session) await up.disconnect();
    },
    cleanupPendingPairings: async () => {
      await universalProviderHandle?.cleanupPendingPairings();
    },
    closeModal: async () => {
      await appKitHandle?.close();
    },
    isFresh: () => {
      const appKit = appKitHandle;
      if (!appKit) return false;
      return (
        appKit.getIsConnectedState() === false &&
        getAppKitAddress() === null &&
        getAppKitWalletProvider() === null &&
        universalProviderHandle?.session == null
      );
    },
    settle: () => new Promise<void>((r) => setTimeout(r, RESET_SETTLE_STEP_MS)),
  });
}

export const RESET_SETTLE_STEP_MS = 150;
export const RESET_SETTLE_MAX_CHECKS = 6;

export type FreshResetDeps = {
  ensure: () => Promise<boolean>;
  disconnectAppKit: () => Promise<void>;
  hasWalletConnectSession: () => boolean;
  disconnectWalletConnect: () => Promise<void>;
  cleanupPendingPairings: () => Promise<void>;
  closeModal: () => Promise<void>;
  isFresh: () => boolean;
  settle: () => Promise<void>;
};

/**
 * Pure, dependency-injected teardown core (deterministically testable).
 * Order: initialize -> close stale view -> official AppKit disconnect ->
 * official UniversalProvider disconnect if a session survives -> pending
 * pairing cleanup -> bounded settle proving freshness. Never touches storage
 * keys, never opens the chooser. Unprovable => false (caller fails closed).
 */
export async function performFreshReset(d: FreshResetDeps): Promise<boolean> {
  try {
    if (!(await d.ensure())) return false;
  } catch {
    return false;
  }
  const bestEffort = async (fn: () => Promise<void>) => {
    try {
      await fn();
    } catch {
      // Teardown is PROVEN below, never assumed from the absence of an error.
    }
  };
  await bestEffort(d.closeModal);
  await bestEffort(d.disconnectAppKit);
  let wcSession = true;
  try {
    wcSession = d.hasWalletConnectSession();
  } catch {
    wcSession = true;
  }
  if (wcSession) await bestEffort(d.disconnectWalletConnect);
  await bestEffort(d.cleanupPendingPairings);
  for (let i = 0; i < RESET_SETTLE_MAX_CHECKS; i++) {
    try {
      if (d.isFresh()) return true;
    } catch {
      return false;
    }
    await d.settle();
  }
  try {
    return d.isFresh();
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
      // Android can close the chooser before blur/visibilitychange fires on a
      // wallet-app handoff, so EVERY visible close gets the same 5s grace.
      const graceMs = 5_000;
      rejectionTimer = setTimeout(() => {
        tryResolveConnected();
        if (!settled && !document.hidden && document.hasFocus()) {
          finish({ status: "rejected" });
        }
      }, graceMs);
    };

    const handleVisibilityChange = () => {
      if (document.hidden) {
        clearRejectionTimer();
        pauseVisibleBudget();
        return;
      }
      tryResolveConnected();
      startVisibleBudget();
      scheduleVisibleRejection();
    };

    const handleBlur = () => {
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
      .open({ view: "Connect" })
      .then(() => {
        // The chooser for THIS attempt is now open: evidence from here on is
        // the operator's current choice.
        chooserStarted = true;
        tryResolveConnected();
      })
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
