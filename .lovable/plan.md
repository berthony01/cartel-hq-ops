# Audit: phone shows "wallet chooser could not load" (REOWN_LIBRARY_LOAD_FAILED)

Read-only. HEAD `af5ee2d4c67b81e195f4a24dcb8964a600cf0fbe`, clean tree. No code, env, database, publish or transaction changes.

## Findings (most severe first)

**Critical: what the error means (confirmed).** It comes from one place only: `src/lib/reown-appkit-wallet.ts` lines 135-140. One `try` wraps both lazy loads, `import("@reown/appkit")` and `import("@reown/appkit-adapter-ethers")`. Any failure in either one becomes `REOWN_LIBRARY_LOAD_FAILED`. That includes a failed chunk download, a module that throws while it loads, and any failure in the adapter. The error is thrown away, so these cases can't be told apart today.

**Critical: Reown domain allowlisting is ruled OUT for this failure.** `createAppKit` only runs after both loads succeed. APKT002 is classified there and becomes `REOWN_ORIGIN_NOT_ALLOWED`. The screenshot shows the load-failed message, so the code never reached the domain check.

**High (likely cause, not yet proven): a stale page after a deployment.** Both libraries are loaded on demand, only when Connect is tapped. If the page was opened before a new deployment, its old code still points at the old hashed file names. Those files may no longer be served after the update, and the import then fails with "Failed to fetch dynamically imported module". Phones keep tabs open for days and restore them from memory, which fits "desktop works, phone fails". Neither `vite:preloadError` nor a reload-and-retry exists in `src/` (searched, none found).

**Medium: no service worker.** `src/`, `public/`, `package.json` and `vite.config.ts` contain no serviceWorker, registerSW, vite-plugin-pwa or workbox. Offline caching is ruled out as a cause.

**Medium: browser support.** `tsconfig` targets ES2022. No custom build target is set, so the defaults from Vite 8 and the Lovable config apply. AppKit 1.8.23 is aimed at modern evergreen browsers, and current Android Chrome supports them. This makes a syntax failure unlikely, but it is not proven for older Android WebViews or in-app browsers (Telegram, X, wallet in-app browsers).

**Medium: unable to inspect the build in this mode.** Plan mode blocks running a production build, even into a temp copy. There is no `.output` or `dist` folder in the project. Chunk file names, sizes and the lazy-loading graph still need to be confirmed. That is the first step in build mode.

**Low: putting AppKit in the first page load is NOT safe.** The `vite.config.ts` comment records that AppKit and lit share code paths with server code. That previously crashed server rendering (`class extends HTMLElement` at module load). Keep the lazy loads. A static import is not recommended.

**Confirmed: the previous fix is still in HEAD.** In `TreasurySafeCreatePanel.tsx`, the signer query is `enabled: !signerConfig`. `savedSignerConfig = signerConfig ?? signerQuery.data`, and both the status and review queries depend on `!!savedSignerConfig`. The query-gating fix is present. No transaction was sent.

## Smallest robust fix (not implemented)

1. **Sanitized sub-codes:** in `runCreateAppKit`, load the two libraries in separate `try` blocks. Classify only the error's type and name, never the URL or stack:
   - `REOWN_CHUNK_FETCH_FAILED`: TypeError whose message matches "dynamically imported module", "Importing a module script failed" or "Failed to fetch"
   - `REOWN_ADAPTER_LOAD_FAILED`: any other failure in the second load
   - `REOWN_MODULE_EVAL_FAILED`: any other failure in the first load
2. **Reload-and-retry, once:** when the chunk fetch fails, the Treasury card shows "The app was updated. Reload and retry". Tapping it reloads the page once, guarded by a sessionStorage flag so it can't loop. No auto-connect after the reload: the user taps Connect again, so no wallet session carries over.
3. **Optional warm-up:** after the page is loaded and hydrated, a `useEffect` in the Treasury card starts the two imports in the background (requestIdleCallback). It only loads files. It never calls `createAppKit`. This keeps the work in the browser only and makes a stale page much less likely by the time Connect is tapped.
4. **No changes** to wallet safety, chain checks, signer checks, the single-send rule, Safe logic or the server code split.

## Allowlist
- `src/lib/reown-appkit-wallet.ts`: split the loads and add the new notice codes
- `src/lib/wallet-connector.ts`: notice mapping only
- `src/components/cartel/TreasurySafeCreatePanel.tsx`: copy, the reload button and the warm-up
- `src/components/cartel/DeploymentWalletConnect.tsx`: copy for the new codes only
- `scripts/pcart-treasury-safe-create-regression.ts`, plus a wallet-connector regression only if new assertions are needed

Prohibited: Safe/chain/send logic, `vite.config.ts`, supabase, contracts, artifacts, deployment controls, publishing.

## Validation
1. Production build. List the client chunks that contain `createAppKit` and `EthersAdapter`, with their names and sizes. Confirm the first page load never references them and they load only on demand. Confirm no AppKit or lit code ends up in the server bundle.
2. Regression tests: separate load failures map to the three sub-codes; no URL or stack appears in any message; the reload guard fires at most once; no auto-connect after the reload; the warm-up never calls `createAppKit`.
3. The existing Safe, wallet-connector and PCART simplification regressions pass; typecheck passes.
4. Phone test after publishing: a fresh tab opens the chooser. A tab left open across a deployment shows "Reload and retry", and after reloading the chooser opens.

Stop point: audit only.
