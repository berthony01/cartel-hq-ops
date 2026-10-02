# Audit result + patch plan: phone chooser shows only "My Wallet"

## Root cause (verified)
1. Installed `@reown/appkit-controllers` is 1.8.24. In `ApiController.js`:
   - `fetchRecommendedWallets` (line 254) and `fetchWalletsByPage` (lines 280, 304) send `chains=eip155:4663`, and `fetchWalletsByPage` also drops any wallet whose `chains` list doesn't include 4663.
   - `fetchFeaturedWallets` (lines 232–247) fetches by `include=featuredWalletIds` with **no** chain filter. It sets `featured` and `allFeatured`.
   - **Correction to the premise:** `setFilterByNamespace(ns)` (lines 402–411) filters `featured` from `allFeatured` by requested chains again. `ModalController.open` (line 49) calls it with `options.namespace`. Our wrapper calls `open({ view: "Connect", namespace: "eip155" })`, so featured wallets would also be dropped unless we stop passing `namespace`.
2. Live Reown directory (read-only, project id never printed). The server returns 93 rows for `chains=eip155:4663`, but only 3 actually list 4663: **My Wallet** (`26a58206…75b3b8`, no rdns, chains `[eip155:4663]`), **Safe** and **Dfns**. Safe and Dfns are dropped as custodial/extension-type entries. So "My Wallet" is just the only phone wallet in the directory that lists Robinhood Chain. It is a third-party listing, not one of our signers.
3. None of these list `eip155:4663` in the directory (whatever their own docs say):
   - MetaMask `c57ca95b47569778a828d19178114f4db188b89b763c899ba0be274e97267d96` (io.metamask, has a mobile link, 9 chains)
   - Base (formerly Coinbase Wallet) `fd20dc426fb37566d803205b19bbc1d4096b248ac04548e3cfb6b3a38bd033aa` (com.coinbase.wallet, no mobile link, 11 chains)
   - Coinbase Wallet (legacy) `d0ca99ff52b99abc48743dad0f7fc891e041be73574f7fac4afe5d4bb83845c8`
   - Robinhood Wallet `8837dd9413b1d9b585ee937d27a816590248386d9dbf59f5cd3422dbbb65683e` (com.robinhood.wallet, has a mobile link, 6 chains)
   - Phantom `a797aa35…3c393` (also no 4663)

## Is featuring the smallest durable fix?
Featuring is needed, but it only works together with dropping `namespace` from `open()`. Only an eip155 adapter is configured, so dropping the namespace changes nothing about which wallet family is used.

Featuring fixes what the chooser shows. It does **not** prove a wallet will accept the request. Picking MetaMask or Robinhood through WalletConnect still sends a proposal for the only configured network, `eip155:4663`, which goes through the existing `UniversalProvider` path. The fast MetaMask failure seen earlier is consistent with a wallet rejecting a chain it doesn't know. Only a phone test can settle that. None of the signer checks (one of the 3 saved signers, chain check, stale-session check, one `eth_sendTransaction`) depend on the chooser list, so none are bypassed.

## Patch plan (allowlist)
- `src/lib/reown-appkit-wallet.ts`:
  - `featuredWalletIds: [MetaMask, Base fd20…, Robinhood Wallet]`. Phantom stays out: the directory has no 4663 for it and we don't guess.
  - Top-level `allWallets: "SHOW"`. The "All wallets" list stays chain-filtered by design.
  - `enableMobileFullScreen: true`.
  - `defaultAccountTypes: { eip155: "eoa" }`. This only affects AppKit's own account type. Harmless, and it keeps Safe owners as plain addresses.
  - Change `open({ view: "Connect", namespace: "eip155" })` to `open({ view: "Connect" })`.
  - `coinbasePreference`: keep `"all"` by default. **Owner decision:** if signer #2 (`0xa068…3f67`) is the Base app's regular address rather than a smart-wallet address, switch to `"eoaOnly"` so Base can't offer an unrelated smart-account address. The signer-match check would reject a wrong address either way.
- `scripts/wallet-connector-regression.ts`, `scripts/pcart-treasury-safe-create-regression.ts`: assert the 3 exact IDs, no Phantom ID, no `namespace` in `open()`, `allWallets:"SHOW"`, `enableMobileFullScreen:true`, `defaultAccountTypes.eip155==="eoa"`, Robinhood is still the only network, no `wallet_addEthereumChain`, no auto-switch, one `eth_sendTransaction` in the untouched treasury-safe-wallet.ts.
- Prohibited: dependencies, vite config, treasury-safe-*, Supabase, signers, contracts and artifacts.
- QA: both regressions, the simplification regression, typecheck, build. Then a phone test after an authorized publish.

## Live safety (read-only, now)
The signer config for launch 9f9af215 is unchanged: signers 0xc23b…9245, 0xa068…3f67, 0xe5b2…d617, threshold 2. `safe_address`, `safe_creation_tx_hash` and `safe_verified_at` are all NULL. No Safe exists and no transaction was sent.

## Remaining uncertainty
- Whether MetaMask and Robinhood Wallet will approve a WalletConnect request for 4663. This is decided by each wallet, not by the chooser.
- Base has no mobile link in the directory, so on Android it goes through the Coinbase connector.
- Phantom (signer #1) is not in the directory for 4663. Consider replacing signer #1 before creating the Safe.
