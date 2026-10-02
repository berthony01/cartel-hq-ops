# Mobile Wallet Connector Regression — Read-Only Audit Result

Status: audit only. No edits, no publish, no transaction. Current HEAD 27665a6e (clean).

## What was confirmed from the installed code

- Installed: @reown/appkit 1.8.23, @reown/appkit-adapter-ethers 1.8.23, ethers 6.17.0, @ethersproject/sha2 5.8.0, viem 2.56.3, @coinbase/wallet-sdk 4.3.6, @safe-global/safe-apps-provider 0.18.6 / sdk 9.1.0.
- Not installed: @reown/appkit-adapter-wagmi, wagmi, @wagmi/core.
- The Ethers adapter package has no `exports` map and no narrower entry point. Importing EthersAdapter always loads: WalletConnect universal provider, full `ethers`, the `@reown/appkit` root (WcConstantsUtil), and `@reown/appkit-utils/ethers` (Safe provider → Safe Apps SDK, Coinbase provider, injected provider). There is no documented lighter subpath.
- `@reown/appkit-polyfills` writes `window.Buffer`, `window.global`, `window.process` at load time (guarded by `typeof window`), so it is browser-safe but has load-time side effects.
- Our bridge loads the full `@reown/appkit` root (all chooser screens) plus the adapter in one chunk.
- The last build output is no longer on disk, so the actual phone chunk could not be inspected in this audit.

## Findings (ranked)

**Critical — the error label is not proof of a module crash.**
`isLazyChunkFetchFailure` only recognises a `TypeError`. Any other rejection of the bridge import is reported as REOWN_MODULE_EVAL_FAILED. That includes Vite's own "Unable to preload CSS" `Error` (a stale-file case) as well as a real crash while the code loads. So "the bridge failed to evaluate" is plausible but unconfirmed. Without the error's type and origin, any change to adapter or version is a guess.

**High — the chooser bundle is much bigger and has more side effects than in core mode.**
Core mode (76 KB core + modal) loaded fine on the same phone. The adapter build adds ethers, the Safe Apps SDK, Coinbase and injected providers, and the full AppKit root to one lazy chunk. The likely triggers are in this added code. The top suspects, all unconfirmed: a duplicate custom-element registration between the root build and pieces it shares with core, Safe/Coinbase helpers that touch browser features at load time, or a cached stale file.

**High — Base was missing in core mode, as expected.**
With `adapters: []`, AppKit registers no injected, EIP-6963 or Coinbase connector. Base/Coinbase can then only appear through the WalletConnect directory, filtered by chain support. A working Ethers adapter with `enableCoinbase` and `coinbasePreference: "all"` is what lists Base on Android Chrome.

**Medium — MetaMask's fast failure is most likely a chain issue, not a connector issue (unconfirmed).**
Over WalletConnect, AppKit asks for `eip155:4663` because it is our only network. A mobile wallet that does not know the chain can reject the request right away. We must not auto-add the network. Whether MetaMask mobile accepts 4663 has to be tested with a real phone session.

**Medium — signer set risk.**
Phantom's EVM support covers a fixed list of chains. Robinhood Chain 4663 is unlikely to be on it (not verified against current Phantom docs). If Phantom cannot sign on 4663, the 2-of-3 Safe depends on both Base and MetaMask working. Recommendation: replace signer #1 (Phantom) with a wallet proven to sign on 4663 before creating the Safe. Signers are not changed by this audit.

**Options check:** `allowUnsupportedChain`, `enableInjected`, `enableEIP6963`, `enableCoinbase`, `enableWalletConnect` and `coinbasePreference: "all"` are valid options for the 1.8.23 adapter path. None of them can, alone, explain a load-time failure.

## Recommended architecture

Stay on the official **EthersAdapter** (already installed, the same official path, no new dependency family). Do not switch to Wagmi now: it needs three new packages, brings a bigger graph, and is not proven safer on Android. Do not build a custom WalletConnect path.

**Upgrade to 1.8.24:** recommended, not proven required. The 1.8.24 changelog was not re-verified in this audit. If you upgrade, upgrade all @reown packages together (package.json + bun.lock only).

## Proposed next build (needs approval)

1. **Diagnose first.** Report a sanitized load-failure detail: error constructor name plus a fixed category (CSS preload, chunk fetch, custom-element already defined, other). No message, URL or stack. Split the bridge into two steps (AppKit root, then adapter), each classified separately, so a phone shows exactly which part fails. Fix the classifier so a CSS preload error counts as a stale file, not a load crash.
2. Rebuild and inspect the bridge chunk locally. Find duplicate `customElements.define` across the core and root builds. Confirm nothing from AppKit, lit or the adapter runs during server rendering.
3. After the real category is known from a phone: apply the smallest fix for it (one AppKit entry so elements register once, a 1.8.24 upgrade, or stale-file handling).
4. Re-check the live database before any Safe step: 3 signers unchanged, `safe_address` NULL, no creation transaction, mainnet execution disabled. This audit did not run that check.

**Allowlist:** `src/lib/reown-appkit-wallet.ts`, `src/lib/reown-appkit-browser.ts`, `src/lib/wallet-connector.ts` (notice mapping only), `src/components/cartel/TreasurySafeCreatePanel.tsx` (copy only), the wallet-connector and PCART Safe regression scripts, and `package.json`/`bun.lock` only if the 1.8.24 upgrade is approved.

**Tests:** classifier unit cases (TypeError fetch, CSS preload Error, custom-element `DOMException`/`NotSupportedError`, generic Error). Bridge-stage split. No adapter import outside the bridge. No `customElements.define` duplicate across client chunks. Server bundle contains no top-level `extends HTMLElement`. Existing regressions still pass: chooser-first, query gating, explicit switch only, exactly one `eth_sendTransaction`. Typecheck and production build pass.

Stop point: this audit. Nothing is implemented until you approve.
