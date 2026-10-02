# Audit: connecting the treasury wallet on a phone (read-only)

HEAD: `2fdcdcd900bff238549c3e5d9771ae2f1df9ceaf`. The tree is clean and has no file changes since `3230a581`. Nothing was edited, sent or deployed during this audit.

## Root causes, ranked

### Critical: Create treasury Safe can never turn on (applies on every device)
- The route passes `signerConfig={pcartSignerQuery.data}`, which makes the panel's `signerQuery` run with `enabled: !signerConfig` set to false.
- `statusQuery` still has `enabled: !!signerQuery.data`, so it never runs.
- `reviewQuery` (the preflight) still has `enabled: !!signerQuery.data && ...`, so it never runs either. Its query key also uses `signerQuery.data?.updatedAt`.
- What this causes:
  - `review` stays undefined and `predicted` stays null.
  - `canCreate` needs `review?.preflight.ok === true && !!predicted`, so **Create treasury Safe stays disabled even after a wallet connects.** This is true on desktop as well as phone.
  - The "Verify existing Safe" branch can never appear.
  - `ready` can never become true, so after creation the verified Safe address would not show and the Safe step would not complete.
- This bug came from the earlier fix that passes `signerConfig` from the parent. It is not a mobile-specific problem, but it blocks the whole flow.

### High: the treasury panel tries the browser wallet first; the mature flow does the opposite
- `TreasurySafeCreatePanel.connect()`: if `isInjectedWalletAvailable()`, it runs `connectInjected()` and **returns**. Reown/AppKit is used only when no injected wallet exists.
- `DeploymentWalletConnect` runs `connectWalletConnect()` (AppKit chooser) first. It falls back to injected only on chooser-level failures (`REOWN_LIBRARY_LOAD_FAILED`, `REOWN_APPKIT_INIT_FAILED`, `REOWN_CONNECT_FAILED`).
- Why desktop works and phone does not:
  - Desktop with an extension: injected `eth_requestAccounts` shows the extension popup, which looks like "wallet options".
  - Phone in normal Safari or Chrome: there is no injected wallet, so the panel goes down the AppKit path. Some mobile browsers expose a stub `window.ethereum`; there, `eth_requestAccounts` either hangs or fails quietly, and no chooser ever opens.
- There is no busy state and no spinner on Connect, so a hang or a slow AppKit load (a dynamic import on a phone network) looks like "nothing happens". The connect call also has no try/catch, so an exception would produce no message.
- The difference in order plausibly explains the phone failure. It is not proven, because no phone test was possible.

### High: every failure shows the same generic message
- Both branches show only "The wallet could not be connected." and drop the `notice`.
- The specific codes are never shown: `REOWN_ORIGIN_NOT_ALLOWED`, `REOWN_LIBRARY_LOAD_FAILED`, `REOWN_RATE_LIMITED`, `STALE_SESSION_TEARDOWN_FAILED`, rejected or timed out, `WALLET_ACCOUNT_AMBIGUOUS`. `DeploymentWalletConnect` already has clean, plain-language text for each of these.

### Medium: no guidance for in-app browsers
- The panel never calls `isEmbeddedBrowserContext()` or `getStandaloneAppUrl()`. It shows no "open in Safari/Chrome" hint, while `DeploymentWalletConnect` does.
- Opening the link from Telegram, X or another in-app browser (likely on a phone) gives no explanation.
- The detection only covers iframes and Android webviews. It does not detect iOS in-app browsers.

### Medium: the network switch is bundled into connect
- The panel calls `connectWalletConnectOnRobinhoodChain()`, which fires `wallet_switchEthereumChain` right after connecting.
- On a phone this sends the user back to the wallet app a second time. If the switch is declined it is ignored. Connect itself still succeeds, so it is not a safety risk, but it adds a confusing second wallet handoff.
- Recommendation: connect only. The send-time gate (`evaluateSafeSendGate`) already blocks a wrong network with `WRONG_CHAIN`. Add a separate explicit "Switch to Robinhood Chain" button, using the existing `requestRobinhoodChainSwitch`, shown only when the connected network is not 4663. This matches the two-step design in `DeploymentWalletConnect`.

### Config checks
- `VITE_WALLETCONNECT_PROJECT_ID` is present in `.env` (presence only; the value was not printed). Vite builds it into the client, so production builds include it, provided the published build used this `.env`.
- Whether the origin is allowed **cannot be proven from code**. `pepecartelhq.com`, `www.pepecartelhq.com` and `cartel-hq-ops.lovable.app` must each be listed under Project Domains in the Reown dashboard, which is external configuration. If one is missing, AppKit raises `APKT002` → `REOWN_ORIGIN_NOT_ALLOWED`, which the treasury panel currently hides behind the generic message.

## Smallest safe patch (for a later build, not authorised now)

Only `TreasurySafeCreatePanel.tsx` changes:
1. Query gates: use `savedSignerConfig` (`signerConfig ?? signerQuery.data`) for `statusQuery.enabled`, `reviewQuery.enabled` and the `reviewQuery` key (`savedSignerConfig?.updatedAt`).
2. `connect()` follows the `DeploymentWalletConnect` order:
   - Run `connectWalletConnect()` first when configured.
   - Fall back to `connectInjected()` only on the three chooser-level failures, or when WalletConnect is not configured.
   - Wrap the whole thing in try/catch and add a `connecting` busy state with a spinner on the button.
3. Map `notice` to short plain-language messages, reusing the same codes. Show the current origin only for `REOWN_ORIGIN_NOT_ALLOWED`. Never show the project id.
4. If `isEmbeddedBrowserContext()` is true, show "Open this page in Safari or Chrome to connect your wallet", with a copyable `getStandaloneAppUrl()`.
5. Remove the automatic switch. Add an explicit "Switch to Robinhood Chain" button that appears only when the connected network is not 4663, using the existing `requestRobinhoodChainSwitch`.

These stay exactly as they are: the single `eth_sendTransaction` path, `evaluateSafeSendGate`, the preflight, salt and prediction, the signer-membership check, the no-resend rule, and every `src/lib/**` file.

### Allowlist
- `src/components/cartel/TreasurySafeCreatePanel.tsx`
- `scripts/pcart-treasury-safe-create-regression.ts` (new assertions)
- `scripts/pcart-launch-simplification-regression.ts` (only if a label assertion changes)

### Prohibited
`src/lib/**` (including `wallet-connector.ts`, `reown-appkit-wallet.ts`, `treasury-safe-*`), `launch-control.tsx`, `DeploymentWalletConnect.tsx`, `supabase/**`, `docs/sql/**`, `contracts/**`, `artifacts/**`, env vars, Reown config, publishing, and any transaction.

### Tests to run
- `bun scripts/pcart-treasury-safe-create-regression.ts`, with new checks that:
  - the query gates use the saved config, not `signerQuery.data`;
  - connect tries WalletConnect first and falls back only on the three chooser codes;
  - the panel no longer calls `connectWalletConnectOnRobinhoodChain`;
  - there is still exactly one `eth_sendTransaction`.
- `bun scripts/wallet-connector-regression.ts` (unchanged library; must still pass)
- `bun scripts/pcart-launch-simplification-regression.ts`
- `bunx tsgo --noEmit` and `bun run build`
- Manual check on a phone: open the page in Safari or Chrome (not an in-app browser), tap Connect wallet, confirm the chooser opens, approve in the signer wallet, confirm the preflight loads, and confirm Create treasury Safe turns on. Stop before confirming the transaction.

## Address state
The saved signers are unchanged (three wallets, 2 of 3) and no Safe has been created. The predicted address is still a future contract address, not a signer. This audit did not query the live database; the signer state comes from the last confirmed read.
