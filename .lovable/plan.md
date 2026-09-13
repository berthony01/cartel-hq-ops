# Preview Failure Audit — Evidence and Proposed Repair Phase

Audit only. No files were edited, no backend, Telegram, secrets, or deployment touched.

## 1. Gate state

- HEAD: `14dee8c515f6b1441ea6abc0e83a6015f83acdc9` ("Added owner-only test control") — matches the authoritative SE-3.1 checkpoint exactly.
- `git status --porcelain`: empty. Diff vs the expected checkpoint: empty. No drift.
- Build log `/tmp/observability/build-errors.log`: latest entry `build OK`.
- `/tmp/observability/runtime-errors.log`, `console-logs.log`, `network-requests.log`: all empty for the message that reported the failure — the failing tab sent no app-level telemetry.

## 2. Reproduction attempts

Against the running dev runtime (`http://localhost:8080`):

- SSR `GET /` → 200, full app HTML. `GET /admin` → 200.
- Browser, signed out: `/` redirects to `/auth?redirect=%2F` and renders the sign-in screen; `/admin` and `/launch-control` redirect the same way. No error screen at any point over a 14s observation.
- The error screen did NOT reproduce at this commit in this environment.
- Preview host returns `401 Unauthorized` to unauthenticated requests, so the hosted preview cannot be probed from here.
- `LOVABLE_BROWSER_AUTH_STATUS=external_unmanaged` — the backend is your external Supabase, so no signed-in browser session can be minted here. The authenticated surfaces (where the failure is reported) cannot be exercised in this sandbox.

Observed in-browser, at every route, signed out:
- React `pageerror`: "Hydration failed because the server rendered HTML didn't match the client. As a result this tree will be regenerated on the client."
- `POST /__lovable/error-collector` → `net::ERR_ABORTED`.

## 3. Typecheck / build

Not re-run this turn: the platform build after the last commit already recorded `build OK`, and the prior phase reported `bunx tsgo --noEmit` clean plus a successful `bun run build` at this exact SHA. A green build does not prove preview runtime health, which is why this plan does not treat it as evidence either way.

## 4. Root-cause status — honest position

The failure is NOT yet attributable to a specific line, and the central reason is a diagnosability defect that must be fixed before any behavioral repair:

**The exact same user-visible text is produced by two completely different failure paths**, with no way for you or us to tell them apart from the screen:

1. Server emergency HTML — `src/lib/error-page.ts`, emitted by `src/server.ts` (SSR crash / h3-swallowed 500) and by the request `errorMiddleware` in `src/start.ts` (any request- or server-function-middleware throw). This document is outside the app bundle, so it produces **no Lovable telemetry** — consistent with the empty runtime/console logs.
2. Client React boundary — `errorComponent` in `src/routes/__root.tsx`, shown when a route loader/component throws after hydration. This one does report to Lovable.

Both render the headline "This page didn't load" and the body "Something went wrong on our end. You can try refreshing or head back home."

Ruled out / downgraded:
- The prior repair plan (`.lovable/plan/recurring-preview-failure-repair-2026-09-11.md`) blamed a 2s auth-init timeout. That repair is already in place — `AUTH_INIT_TIMEOUT_MS = 5000` in `src/routes/_authenticated/route.tsx`, and "Try again" already does a hard `location.reload()`. The failure recurs anyway, so the auth-timeout hypothesis is disproven as the sole cause.
- Invalid route tree, broken SSR, or a build-time fault: disproven — SSR returns full 200 HTML for `/` and `/admin`.
- Infrastructure-only fault: not supported either, because the app itself owns both screens with this exact wording.

Open, unverified candidates (in order of suspicion), each tied to a real observation:
- **A.** A throw inside a server-function or request middleware (`errorMiddleware`, `createCsrfMiddleware` on `serverFn` in `src/start.ts`) returning the emergency HTML for a request the app expected to be JSON, under the preview's cross-origin iframe host. Would leave zero telemetry.
- **B.** The universal **hydration mismatch** seen on every route. Today it only warns, but any component that throws during that client regeneration escalates straight to the root error boundary.
- **C.** An authenticated-only loader/provider failure (workspace context, Supabase session under preview storage) — unreachable in this sandbox, reachable only in your signed-in preview.

## 5. Proposed repair phase (NOT executed)

### Stage 1 — make the two failures distinguishable (required first)
Give each path a distinct, quietly visible marker so one screenshot from you identifies the path definitively, without changing behavior or weakening anything:
- Emergency server page keeps its copy but carries a visible short code (e.g. "Reference: server") and already-present `meta cartel-error-page`.
- Client boundary carries a different code (e.g. "Reference: app") plus the error name in a small line.
- Nothing about auth, routing, RLS, transport, or features changes.

### Stage 2 — fix the confirmed cause only
Executed as a separate authorized turn once Stage 1 produces the identifying evidence from the real preview (plus the hydration mismatch source if it turns out to be the escalation path).

### File allowlist for Stage 1
1. `src/lib/error-page.ts`
2. `src/routes/__root.tsx`
No other files.

### Prohibited
Supabase schema/RLS/RPC/types/Edge Functions/secrets/data; deployment or publish; Telegram, X, or any provider call; any change to `src/start.ts`, `src/server.ts`, `src/routes/_authenticated/route.tsx`, transport clients, SE-2/SE-3 sources or regressions; removing features; relaxing auth, CSRF, or fail-closed behavior; regenerating types.

### Verification
`bunx tsgo --noEmit`, `bun run build`, existing SE-3 and SE-3.1 regressions, signed-out routing still lands on `/auth`, clean tree, exact changed-file list, project remains unpublished.

### Rollback point
`14dee8c515f6b1441ea6abc0e83a6015f83acdc9`.

### Stop point
End of Stage 1. No behavioral repair until the marker identifies the real path in your live preview.
