# Audit: mobile wallet chooser (Phantom/Base missing, MetaMask fails fast)

Read-only. Nothing changed, nothing published, no transactions sent.

## Short answer
The recent switch to "no adapter" mode was the wrong fix. It got the chooser to open, but now the chooser can only connect through the WalletConnect relay. It no longer has a real way to connect browser or injected wallets, or the Coinbase/Base wallet. That accounts for most of what you saw on the phone.

## Findings (most severe first)

1. CRITICAL: `adapters: []` makes AppKit fall back to a stub adapter (proven from the installed 1.8.23 code).
   - `appkit-base-client.js` `createAdapters()`: when a namespace has no adapter, it creates `new UniversalAdapter(...)`.
   - `universal-adapter/client.js`: `syncConnectors()` returns `Promise.resolve()` and does nothing. So no injected, EIP-6963 or Coinbase connectors are ever registered. `enableInjected`, `enableEIP6963` and `enableCoinbase` stay on but have no effect.
   - `connect()` always returns `{ id:'WALLET_CONNECT', address:'' }`. `sendTransaction()` returns `{ hash:'' }` and `estimateGas()` returns 0. The only real path left is `connectWalletConnect` through the universal provider.
   - Bottom line: core mode can show the wallet list and run a WalletConnect session. It cannot do adapter-backed EVM connect for injected wallets or Coinbase. Our Safe send uses the raw EIP-1193 provider, so it does not depend on the stubbed `sendTransaction`. But every path except the relay is gone.

2. HIGH: Base/Coinbase wallet is missing because of our setup, not because of what the wallet can do. The Coinbase connector is registered by an adapter (EthersAdapter/WagmiAdapter). With the stub adapter it never appears.
   - Phantom (EVM) normally shows up as an injected/EIP-6963 or catalogue wallet. Two causes are possible: (a) no injected connectors (proven, see 1), and (b) the wallet catalogue may filter out wallets that don't list chain eip155:4663 (not proven, needs a check). Robinhood Chain support and WalletConnect/dApp connection support are separate things. I haven't confirmed either for Phantom or Base, and it has to be tested with the real wallets.

3. HIGH: MetaMask fails fast. Where it can fail, in tap order:
   - a. MetaMask's catalogue entry opens a WalletConnect deep link. The session request lists `eip155:4663` as a required chain. If MetaMask mobile doesn't know chain 4663, it can reject right away (not proven; most likely cause).
   - b. On Android, AppKit can close the chooser before the browser fires `blur`/`visibilitychange`. When that happens, our `scheduleVisibleRejection` waits only 1 s (`handoffObserved=false`), then returns `rejected`. That gives the "rejected or failed" flash. This can wrongly reject a real hand-off (proven from the code at reown-appkit-wallet.ts ~505).
   - c. A stale-session or identity check in `connectWalletConnect` (stale session, ambiguous account, account mismatch) fails closed. That only happens after a session exists, so it's less likely to be the instant flash.
   - The message the wrapper most likely returns is `CONNECTION_REJECTED_OR_FAILED` (generic). It doesn't say which step failed.

4. MEDIUM: Errors aren't readable. The warning is generic, and on a fast close it can be replaced or cleared by the chooser/state update before you can read it. There's no category code to report.

5. LOW: Version. Installed `@reown/appkit` is 1.8.23, pinned. I haven't checked the 1.8.24 changelog yet (it needs a web lookup). No upgrade is needed to fix finding 1.

6. Chain state: going by the last saved state, the PCART launch has 3 saved signers, `safe_address` is NULL and no transaction was sent. Nothing in this audit changed that. I didn't re-query the live database this turn; re-checking it is step 1 of the build below.

## Which workaround was wrong
Switching to adapter-free core (commit 650932a9). The original failure, the Ethers adapter not loading on phones, was a file-loading problem. It should have been fixed at the loading step, not by removing the adapter.

## Recommended architecture
Go back to an official EVM adapter. Recommended: **WagmiAdapter** (`@reown/appkit-adapter-wagmi` with wagmi and viem; viem is already installed). It's Reown's main supported path, with the best mobile deep-link and Coinbase/Base and EIP-6963 coverage. EthersAdapter is an acceptable alternative (already installed, smaller change) if we fix its file loading instead of dropping it. Either way, keep:
- reading the raw EIP-1193 provider for the single `eth_sendTransaction`;
- the identity, chain and signer-membership checks;
- the explicit "Switch to Robinhood Chain" button only.

Smallest-change option: put EthersAdapter back, but load both libraries in one combined file. That removes the separate adapter chunk that failed on the phone.

## Smallest safe build allowlist (for a later, separately approved build)
- `src/lib/reown-appkit-wallet.ts`: restore the adapter (Ethers in a combined load, or Wagmi). Raise the rejection grace to 5 s after any close, or until focus returns. Return precise sanitized notices (`WALLET_REJECTED_IN_APP`, `MODAL_CLOSED_NO_HANDOFF`, `CHAIN_NOT_SUPPORTED_BY_WALLET`).
- `src/lib/wallet-connector.ts`: map only the new notices.
- `src/components/cartel/TreasurySafeCreatePanel.tsx`: keep the warning visible until dismissed, and show the category code.
- `package.json`: only if WagmiAdapter is chosen (adds wagmi and the adapter, pinned to 1.8.23).
- The two regression scripts.
- Not allowed: SQL/Supabase, Reown dashboard, Vite config, contracts, publish, transactions.

## Required tests
- The adapter is present and is not UniversalAdapter. Injected, EIP-6963 and Coinbase connectors register (unit test with mocked controllers).
- The adapter loads as part of one combined file, so there's no separate adapter chunk. Server rendering never runs AppKit or lit code.
- Rejection timer: closing the chooser without blur/visibilitychange does not reject in under 5 s. A real dismissal still rejects.
- A fast failure shows a lasting notice with a category code.
- Existing checks still pass: chooser-first connect, query gating, explicit switch only, exactly one `eth_sendTransaction`, signer membership, wallet-connector, Safe creation and simplification regressions, typecheck and build. Then a build inspection.
- Live check: a read-only query confirms `safe_address` is NULL. Then a phone test with MetaMask, Phantom and Base to see which wallets actually accept chain 4663.

## Open questions
- Does MetaMask/Phantom/Base mobile accept `eip155:4663` over WalletConnect? This can only be proven with a phone test.
- 1.8.24 fixes are unchecked.
- Wallet-catalogue filtering by chain is unconfirmed.

STOP: no edits until a build is separately approved.
