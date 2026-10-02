/**
 * BROWSER-ONLY AppKit bridge. Never statically import this module from any
 * SSR-reachable file: it is loaded exclusively through ONE dynamic import in
 * `reown-appkit-wallet.ts`, so AppKit and the official Ethers EVM adapter ship
 * together in a single lazy chunk (no separate adapter import to fail).
 * Runtime values only — no wallet action happens here.
 */
export { createAppKit } from "@reown/appkit";
export { EthersAdapter } from "@reown/appkit-adapter-ethers";
