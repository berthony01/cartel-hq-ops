/**
 * BROWSER-ONLY AppKit bridge. Never statically import this module from any
 * SSR-reachable file: it is loaded exclusively through ONE dynamic import in
 * `reown-appkit-wallet.ts`, so the full AppKit 1.8.24 runtime and the official
 * WagmiAdapter (plus the WalletConnect UniversalProvider) ship together in a single lazy chunk.
 * Runtime values only — no initialization and no wallet action happens here.
 */
export { createAppKit } from "@reown/appkit";
export { WagmiAdapter } from "@reown/appkit-adapter-wagmi";
export { UniversalProvider } from "@walletconnect/universal-provider";
/**
 * The SAME `ConnectionController` singleton AppKit's chooser reads (installed
 * `@reown/appkit-controllers` 1.8.24, pinned to the AppKit version). Used only by
 * the explicit fresh-reset proof: `hasAnyConnection("walletConnect")` is the exact
 * condition that disables every chooser row, and `setConnections([], "eip155")`
 * clears stale UI residue ONLY after all external evidence is proven gone.
 */
export { ConnectionController } from "@reown/appkit-controllers";
