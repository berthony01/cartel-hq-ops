# Mobile WalletConnect — Read-Only Root-Cause Audit (no fixes applied)

## Start gate

- Actual HEAD: `2bbe0b18038304a3d80f0ce271a3153cccf63f9a`
- `git status --porcelain`: empty (clean)
- SHA drift disclosure: the last reported HEAD was `971a96086d952f27ed3f3cd994daf484b0df481f`. HEAD has since advanced by platform auto-commit. No prompt-declared expected SHA was supplied for this turn, so the audit proceeded on the clean tree.

## Verification run (source-only, no wallet/relay contact)

- `git diff --check` — PASS
- `bunx tsgo --noEmit` — PASS
- `bun run build` — PASS (client + server emitted)
- `bun scripts/wallet-connector-regression.ts` — PASS (all checks, incl. J1–J7, K1–K8)
- No wallet, provider, relay, modal, DB, secret, Telegram or transaction action occurred.

## Installed package facts (read from node_modules, not memory)

- `@walletconnect/ethereum-provider` declared `^2.24.0`, lockfile pins `2.24.0`, dependencies include `@reown/appkit@1.8.19` and `@walletconnect/universal-provider@2.24.0`.
- `getRpcConfig`: `methods` / `events` are applied **only when required `chains` is non-empty**. With `optionalChains` only, they resolve to `[]`.
- `buildNamespaces`: with no required chains, `required` is `undefined` and the optional namespace gets the **full default OPTIONAL_METHODS / OPTIONAL_EVENTS sets**, not ours.
- Omitted `rpcMap` → `buildRpcMap` assigns `https://rpc.walletconnect.org/v1/?chainId=eip155:4663&projectId=...` for 4663.
- Request routing (`universal-provider` eip155): `eth_accounts` / `eth_requestAccounts` are answered **locally from session accounts**; `eth_chainId` returns `parseInt(getDefaultChain())`; only unhandled, non-namespace methods reach the HTTP RPC.
- `disableProviderPing` defaults to `false`.
- `showQrModal:true` path: `convertWCMToAppKitOptions` synthesizes a network for any CAIP id via `defineChain` — chain 4663 does **not** throw, but is created with `id: "4663"` (string), empty `name`, empty `nativeCurrency` and the generic `https://rpc.walletconnect.org/v1` RPC. Modal is created with `manualWCControl: true`, `enableInjected:false`, `enableEIP6963:false`, `enableMobileFullScreen` only when explicitly `true`.
- `loadPersistedSession()` runs inside `init()`, before any `connect()` call.

## Findings, severity-ranked

### CONFIRMED root causes (code-level, provable from installed source)

1. **`eth_chainId` type mismatch breaks the WalletConnect path.** `src/lib/wallet-connector.ts` and `src/lib/chain-mainnet-wallet.ts` both accept the chain id only when `typeof raw === "string"`. Injected wallets return a hex string; the installed WalletConnect provider returns a **number**. Result: `chainId` is `null` after a *successful* WalletConnect session, `chainMatches` is false, the panel shows a wrong/unknown network, and `sendClaimedMainnetDeployment` would fail closed on the chain guard. This alone makes the mobile path look broken even when the wallet connected correctly.
2. **Reported chain id is not evidence of the negotiated chain.** The provider defaults `chainId` to `optionalChains[0]` (4663) and only overwrites it from session accounts. A wallet approving a different chain can still surface as 4663 once finding 1 is fixed, unless the chain is derived from the session namespace/accounts.
3. **Our `methods` / `events` init options are silently ignored** (optional-chains-only configuration). The negotiated proposal is the provider's full default optional set. Not a break today, but the current code comment implies a narrower proposal than is actually requested.
4. **Optional-only namespace with no required chain.** Nothing forces `eip155:4663`. Wallets may approve a session containing none of the requested chain, producing a "connected but useless" state that the current UI cannot explain.

### HIGH-probability issues supported by installed behavior

5. **Empty `metadata.icons: []` and an unregistered origin.** WalletConnect/Reown Verify surfaces app metadata to the wallet; an empty icon array and an unverified domain commonly produce a "cannot verify" or degraded prompt that mobile wallets (Robinhood included) may refuse or that the operator abandons.
6. **Synthetic chain descriptor for 4663.** Blank network name, blank native currency and the generic relay RPC mean AppKit's network chip and any chain-scoped wallet filtering degrade; wallet lists filtered on `eip155:4663` may exclude or mis-handle Robinhood Wallet.
7. **Persisted-session load during `init()`.** Every explicit click runs `init()`, which restores a stale WC session before we call `connect()`. A previously paired wrong wallet/chain can therefore appear "active" after one click, and our `disconnect()` only tears down when a live session object exists.
8. **No `qrModalOptions` at all.** `enableMobileFullScreen`, featured/explorer wallet ids and mobile link handling are entirely default; Robinhood Wallet is not featured, so same-device Android handoff depends on the operator finding it in the generic list.
9. **Embedded preview remains the dominant environmental failure.** Detection and copy exist (K1–K3) but the connect buttons stay enabled inside an embedded context, so the hang is still reachable from the Lovable preview iframe.

### EXTERNAL configuration that cannot be confirmed from this repo

- WalletConnect/Reown Cloud project `4c1936…` — allowlisted domains must include the current preview origin `https://id-preview--469fb83c-0f27-4aa7-bb99-c4125279c565.lovable.app` (and any standalone/published origin). Not inspectable here.
- Whether Robinhood Wallet's WalletConnect build advertises `eip155:4663` support in the Reown explorer entry.
- Robinhood Wallet's own domain-verification policy for unverified origins.

### Environment / build correctness (all clear)

- `.env` contains `VITE_WALLETCONNECT_PROJECT_ID` (value not printed here).
- Bracket access on `import.meta.env` **is** statically resolved by this build: the literal project id appears in the emitted client chunks `assets/mainnet-canary-*.js` and `assets/chain-launcher-*.js`. It is not `undefined` and not an unresolved key. No unrelated secret was inspected or printed.
- Not an env defect.

## Minimal fix plan (for a separate, approved build phase)

1. Accept both `string` and `number` chain-id replies in `readAccountAndChain` (both modules), normalising to a hex quantity; keep every existing guard.
2. Derive the connected chain from the WalletConnect session accounts, not the provider default, and expose a distinct `WRONG_CHAIN_APPROVED` notice.
3. Pass `rpcMap: { 4663: ROBINHOOD_MAINNET_PUBLIC_DIAGNOSTIC_RPC_URL }`, a real `metadata.icons` entry, and `qrModalOptions: { enableMobileFullScreen: true }`.
4. Disable (not merely warn on) both connect buttons in an embedded context, keeping the manual standalone-open action.
5. Make `disconnect()` unconditional teardown so stale persisted sessions cannot survive a reload.
6. Correct the now-inaccurate comment about proposed `methods` / `events`.

**File allowlist:** `src/lib/wallet-connector.ts`, `src/lib/chain-mainnet-wallet.ts`, `src/components/cartel/DeploymentWalletConnect.tsx`, `scripts/wallet-connector-regression.ts`.

**Regressions to add:** numeric-chain-id normalisation; session-derived chain; rpcMap/icons/qrModalOptions present; embedded context disables connect; unconditional disconnect teardown; unchanged single `eth_sendTransaction`, unchanged canary sequence, unchanged safety literals.

**Database/Supabase:** none required. No schema, RLS, RPC, grant, migration or data change is implicated.

## Final state

HEAD `2bbe0b18038304a3d80f0ce271a3153cccf63f9a`, `git status --porcelain` empty. No file was created or modified in the project source. STOP.
