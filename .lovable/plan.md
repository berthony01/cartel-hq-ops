# READ-ONLY DIAGNOSIS — Android preview "This page didn't load"

## Start state
- Actual HEAD: `5d34c72239de9ea6af0ffb9658bdc586b1268b69` ("Split Gate 1/2 WC flow").
- `git status --porcelain`: empty (clean tree).
- Disclosure: HEAD differs from the previously reported `491d4bae...`. `git show --stat HEAD` contains exactly the three allowlisted Gate 1/Gate 2 files (`src/lib/wallet-connector.ts`, `src/components/cartel/DeploymentWalletConnect.tsx`, `scripts/wallet-connector-regression.ts`) — platform re-commit of the same work, no new surfaces.
- No files were edited, no commands changed state, no DB/secrets/wallet/transaction/publish actions.

## 1. Root cause (as far as provable)
Not project code. The evidence supports a preview host / editor session-lifecycle failure in front of the app, not an SSR, cold-start, build or runtime defect in this project.

The one thing that is *not* fully provable from inside the sandbox is which layer painted the exact white page, because the failing response was produced by the hosted preview edge/worker and its server log is not readable from here. Everything observable locally is healthy.

## 2. Evidence
- Build: `/tmp/observability/build-errors.log` newest entry `2026-09-09T14:08:57Z build OK`.
- Local SSR is healthy and fast, no error page in the body:
  - `/` → 200 in 0.023s, `/auth` → 200 in 0.012s, `/mainnet-canary` → 200 in 0.012s; zero occurrences of the error-page string in any body.
- No SSR failure anywhere in the dev-server log: a grep over the last 800 daemon log lines for `error|500|unhandled|HTTPError|crash|exit` returns nothing. Only `createServerFn().inputValidator()` deprecation warnings. If the SSR wrapper (`src/server.ts`) had rendered its 500 page, it would have `console.error`-ed into that log. It never did.
- User-session telemetry captured with this message is completely empty: `console-logs.log`, `runtime-errors.log`, `network-requests.log` all contain nothing. A page that rendered the app and then failed would leave console/runtime traces. Nothing ran — the failure is upstream of the app boot.
- The preview origin is session-gated at the edge: 5 unauthenticated requests to `https://id-preview--<project>.lovable.app/` returned **HTTP 401**, 12-byte `text/plain` body, `server: cloudflare`, with a `__cf_bm` cookie set. So the preview host itself decides whether a request ever reaches the app, based on an editor session cookie on the `lovable.app` domain.
- The failure pattern the user describes maps exactly onto that gate: first open of the editor on Android (cookie/session not yet attached to the framed third-party origin) fails; repeated refresh succeeds once the session is established; Android backgrounding evicts the editor page, so return-to-app reloads and replays the same race.
- Secondary, also platform-side: sandbox cold start. The dev server reported `ready in 4242 ms`, but the client dependency optimizer then ran for ~50s and finished with `optimized dependencies changed. reloading`. Requests landing in that window can be served slow/failed by the proxy before the app is warm.
- Text-origin note: the string "This page didn't load / Something went wrong on our end…" also exists in this project (`src/lib/error-page.ts`, and the themed variant in `src/routes/__root.tsx`). The project copy of that page is white/system-font, so it looks identical to a host error page. But the project's copy is only reachable via `src/server.ts`, which always `console.error`s first — and no such log exists. The themed `__root` variant would render dark (brand `#070707`), not white.

## 3. Is a project-code fix appropriate?
No. There is no reproducible cold-start SSR failure, no first-request throw, no build error and no route-level error to fix. Changing project code here would be treating a symptom owned by the Lovable preview host/editor session lifecycle, and would add risk to a launcher codebase that is currently clean and green.

Standalone vs embedded: the embedded `id-preview--…` origin is the one carrying the editor-session gate and the iframe/third-party-cookie constraints. The equivalent standalone preview surface is not subject to the iframe lifecycle (no parent reload on Android app switch), which is why it behaves more reliably.

## 4. Recommended handling (no code change)
- Treat as a Lovable preview/editor platform issue and report it as such: Android editor preview intermittently returns the host error page on first load and after app-resume, while project status is ready and the app is healthy.
- Safe project-side workarounds, none requiring edits:
  - Open the standalone preview URL directly in the Android browser instead of the embedded editor preview, especially for wallet/canary work where an app-switch handoff is unavoidable.
  - On first open after a cold sandbox, allow ~60s before judging the preview; refresh once rather than repeatedly.
  - Do not start a presign/ARM sequence from an embedded preview that has just recovered from an error page — start from a freshly loaded standalone preview so the ~60s presign TTL is not spent on a host reload.
- Existing project-side resilience is already in place and needs no change: `localStorage` launch persistence, existing-attempt awareness with fail-closed gating, and the presign-time runtime-state refresh all survive a preview reload.

## STOP
Diagnosis only. No fix proposed, no files to change.
