/**
 * BROWSER-ONLY AppKit bridge. Never statically import this module from any
 * SSR-reachable file: it is loaded exclusively through ONE dynamic import in
 * `reown-appkit-wallet.ts`, so the full AppKit 1.8.24 runtime and the official
 * WagmiAdapter ship together in a single lazy chunk.
 * Runtime values only — no initialization and no wallet action happens here.
 */
export { createAppKit } from "@reown/appkit";
export { WagmiAdapter } from "@reown/appkit-adapter-wagmi";
