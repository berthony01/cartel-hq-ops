# Audit result: "WalletConnectConnector not found" and the off-center phone popup

Read-only audit. Nothing was edited, published or sent. Below are the findings and the smallest fix proposed for approval.

## Findings, most severe first

### 1. CRITICAL: the WalletConnect step can fail without any error, and our code still reports the chooser as ready
Proven from the installed AppKit 1.8.24 code:
- `createAppKit` runs `initialize()`, which runs `initChainAdapters()` → `initChainAdapter("eip155")` → `adapter.syncConnectors()`, then `createUniversalProviderForAdapter()`.
- `createUniversalProviderForAdapter` first calls `getUniversalProvider()`. That function wraps `UniversalProvider.init(...)` in try/catch. If init throws, it only logs `AppKit:getUniversalProvider - Cannot create provider` to the console and returns `undefined`.
- `adapter.setUniversalProvider(...)` only runs when the provider exists. That is the only place the `walletConnect` connector gets added (to both wagmi and AdapterBlueprint).
- So `instance.ready()`, which just waits for `readyPromise = initialize()`, resolves successfully even when no WalletConnect connector was registered.
- Tapping a featured wallet tile then calls `WagmiAdapter.connectWalletConnect()` → `getWalletConnectConnector()`, which throws exactly `WalletConnectConnector not found` (ChainAdapterBlueprint.js:242).

Conclusion: `ready()` waits for setUniversalProvider only when provider init succeeds. When init fails, there is no public readiness signal for it. Our wrapper needs to check for the connector itself after `ready()`.

Still unproven: why `UniversalProvider.init` fails on the user's Android Chrome. Likely causes are local storage or IndexedDB init, the relay or project-id/origin check for the live domain, or a polyfill problem. The silent catch hides which one. The fix below makes this visible as a safe code instead of a broken tap.

### 2. HIGH: some optional wallet libraries are missing or on the wrong version
`@wagmi/connectors` 8.2.0 lists these optional peers:
- `@walletconnect/ethereum-provider` ^2.21.1: **MISSING**. AppKit's own WalletConnect connector does not need it, so this is not proven to be the root cause of finding 1. It does mean wagmi's stock `walletConnect` connector cannot load if anything reaches for it.
- `@metamask/connect-evm` ^2.1.0: **MISSING**. The MetaMask SDK connector cannot load, so MetaMask can only connect through the injected wallet or WalletConnect.
- `@base-org/account` ^2.5.1: **installed 2.4.0, which is below the required range**. The Base Account connector (`getBaseAccountConnector`) may fail to load. That fits Base not showing up.
- `@coinbase/wallet-sdk` 4.3.6 and the Safe SDK are present and fine.

### 3. Duplicate or split Reown packages: ruled out
- Every `@reown/*` package is exactly 1.8.24, with no nested copies. The adapter depends on the same 1.8.24 controllers, common and utils packages.
- `@walletconnect/universal-provider` 2.23.7 matches what the adapter pins. Only one `@wagmi/core` (3.6.5) and one `@wagmi/connectors` (8.2.0) are installed. viem is 2.56.3.
- The adapter wants `@wagmi/core` >=2.21.2, `wagmi` >=2.19.5 and `viem` >=2.55.13. wagmi 3.7.7 with core 3.6.5 meets all of these, and connectors 8.2.0 pins core 3.6.5 exactly.
- Nothing is splitting the shared AppKit state. This is **not** the root cause.

### 4. MEDIUM: Base is not in the main list
- The current code uses `coinbasePreference: "eoaOnly"` (line 253), not `"all"`.
- Base comes from two places: the featured directory tile (ID `fd20dc42…`) and the Base or Coinbase connector tile, which needs `@base-org/account` (see finding 2).
- The featured tile still goes through WalletConnect, so finding 1 breaks it as well.
- Before deciding whether this needs its own fix, re-check on a phone after findings 1 and 2 are fixed.

### 5. The `as never` cast is harmless at runtime
At runtime, `WagmiAdapter` sets `namespace = "eip155"`. AppKit reads `adapter.namespace` in `getChainNamespacesSet`, and `syncConnectors` already ran, so the injected wallets appear. The cast only silences a type warning.

### 6. Our options do not stop the WalletConnect provider from being created
- `enableReconnect:false` only disconnects an existing session after init.
- `features.email:false` and `enableWalletConnect:true` are not consulted before `createUniversalProvider`.
- The provider is created only when `projectId` is set and the code runs in the browser. Both are true.

### 7. MEDIUM: the popup sits off-center on phones
- The page has the correct `width=device-width, initial-scale=1` viewport tag.
- No global transform, zoom or filter on the page root traps the popup. AppKit attaches it to the page body with `position:fixed; inset:0`, and with `enableMobileFullScreen` it uses `height:100dvh`.
- A fixed popup shifts sideways when the page itself is wider than the phone screen. Chrome then widens the layout area and the popup centers on that wider area, which forces panning.
- Most likely cause: a wide row in Launch Control or the Treasury panel. Long unbroken text such as addresses, hashes or code chips can do this. Many rows already have `min-w-0` and `break-all`, but not every one was checked on a real phone width.
- Still unproven: the exact element. A 360px authenticated screenshot isn't possible here, because a browser sign-in can't be created for this project.

### 8. Environment and history
- `VITE_WALLETCONNECT_PROJECT_ID` is set in `.env`. The value was not printed.
- The earlier generic token deployment tests are deployment records only. They used the older injected-wallet and earlier AppKit paths, so they do not show that the current WalletConnect connector registers.

### 9. Safety re-check
This turn did not re-run the database check. The last read-only check showed 3 signers unchanged, `safe_address` NULL, no creation transaction, mainnet execution off and emergency stop on. The build gate below repeats this check first.

## Proposed fix (needs approval)

**A. Fail closed when WalletConnect is missing** (`reown-appkit-wallet.ts`)
- After `await instance.ready()`, check that the WagmiAdapter has a connector with `id === "walletConnect"`.
- If it doesn't, call `getUniversalProvider()` once more as a single explicit retry inside the same click. This is not a loop.
- If it is still missing, return a new sanitized code, `REOWN_WALLETCONNECT_UNAVAILABLE`, clear the cached instance so a later click can retry, and never open a chooser with tiles that cannot work.
- Map the code in `wallet-connector.ts`, `DeploymentWalletConnect.tsx` and `TreasurySafeCreatePanel.tsx`. The user sees: "Wallet connection service could not start. Reload and try again." The code shows only under Technical details.

**B. Fix the optional wallet libraries** (`package.json`, `bun.lock`)
- Add exact `@walletconnect/ethereum-provider` 2.23.7, aligned with universal-provider.
- Raise `@base-org/account` to an exact version inside ^2.5.1.
- Add exact `@metamask/connect-evm` at a ^2.1.x version.
- No other upgrades.

**C. Center the popup on phones** (`src/styles.css`, plus the one offending row once found)
- Add `overflow-x: clip` to `html, body` so the page can never grow wider than the screen and pull the fixed popup off-center.
- Keep `enableMobileFullScreen:true`.
- Do not change AppKit's own styles.

## Allowlist
`package.json`, `bun.lock`, `src/lib/reown-appkit-wallet.ts`, `src/lib/wallet-connector.ts` (notice map), `src/components/cartel/DeploymentWalletConnect.tsx` (notice map), `src/components/cartel/TreasurySafeCreatePanel.tsx` (copy), `src/styles.css` (html/body overflow only), `scripts/wallet-connector-regression.ts`, `scripts/pcart-treasury-safe-create-regression.ts`.

**Prohibited:** `treasury-safe-*`, `launch-control.tsx`, Supabase or SQL, signer data, chain or mainnet controls, contracts and artifacts, `vite.config.ts`, any transaction, any automatic network add or switch, publishing.

## Tests (must fail before the fix and pass after)
1. A mocked AppKit whose `ready()` resolves without a `walletConnect` connector: today the wrapper reports ready. After the fix it returns `REOWN_WALLETCONNECT_UNAVAILABLE` and the chooser does not open.
2. When the retry does register the connector, it proceeds normally. The retry runs at most once per click.
3. After a failure the cached instance is cleared, so the next click can retry.
4. Package check: `@walletconnect/ethereum-provider`, `@metamask/connect-evm` and `@base-org/account` satisfy the `@wagmi/connectors` 8.2.0 peer ranges. All `@reown/*` packages stay at 1.8.24 with exactly one copy each.
5. CSS check: `html, body` have `overflow-x: clip`.
6. All existing tests still pass: wallet-connector, PCART Safe and simplification regressions, exactly one `eth_sendTransaction`, no `wallet_addEthereumChain`, chooser-first order, ≥5s grace. Typecheck and production build also pass, and the server bundle stays free of AppKit code.
7. A read-only database check before and after confirms the signers are unchanged, no Safe exists, and emergency stop is on.

## Remaining uncertainty
- Only a real phone test after publishing will show the exact Android reason the WalletConnect provider fails to start. After the fix it shows up as a clear code instead of the toast.
- Whether MetaMask and Robinhood Wallet accept a Robinhood Chain (4663) request is still a separate, wallet-side question.
