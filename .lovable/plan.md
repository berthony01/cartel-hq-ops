# Hosted Preview Server Failure — Root Cause Audit (read-only)

## Start gate

- HEAD: `dce534b1b3732888bb93aa02b011798da98828b6`, working tree clean, no drift.
- Hosted preview confirmed failing: worker logs show repeated `GET / → 500` with body containing `cartel-error-page content="server"`.
- No files were changed in this audit. Only a local read-only production build and a local request simulation were run.

## Root cause — PROVEN (branch A)

The hosted preview logs show, for every request:

```text
[error] ReferenceError: HTMLElement is not defined
    at _libs/lit__reactive-element.mjs:93:11
[request] GET https://id-preview--…lovable.app/ → 500
```

Reproduced locally against the production build, with the exact failing frame:

```text
ReferenceError: HTMLElement is not defined
    at dist/server/_libs/lit__reactive-element.mjs:93:11
    at async getServerEntry (dist/server/_ssr/ssr.mjs:124:10)
    at async Object.fetch (dist/server/_ssr/ssr.mjs:154:56)
status 500  → renderErrorPage() ("Reference: server")
```

So the failing branch is **A: the `getServerEntry()` dynamic import rejects**. It is not h3 swallowing, not a middleware return, not a route loader, not a runtime incompatibility of the wrapper itself.

Why the import rejects — the bundling chain in `dist/server`:

- `_libs/lit__reactive-element.mjs:93` evaluates `class extends HTMLElement` at module scope. Cloudflare Workers (and Node) have no `HTMLElement`, so module evaluation throws.
- `_libs/@reown/appkit.mjs` **statically** imports that lit chunk.
- `_libs/@tanstack/router-core+[...].mjs` and `_libs/supabase__realtime-js.mjs` **statically** import `@reown/appkit.mjs` — only to reuse a shared `globalthis` polyfill (`globalthis_default`, `init_globalthis`) that the bundler happened to place inside the appkit chunk.

Application code is correct: every `@reown/appkit` import in `src/lib/reown-appkit-wallet.ts` and `src/lib/wallet-connector.ts` is already a lazy `await import(...)`. The lazy boundary is defeated purely by chunk merging — router-core is unavoidably in the SSR entry graph, so the browser-only wallet/lit code is dragged into server module evaluation and the whole SSR entry dies before any route runs.

## Is the custom `src/server.ts` wrapper implicated?

No. The wrapper behaved exactly as designed: it caught the rejected entry import and served the emergency page with the `server` marker, which is what made this diagnosable. It is not the cause and should be kept. Its only shortcoming is that the captured exception reached the platform log without file/line context in earlier turns; the worker log did in fact carry the stack, so no extra instrumentation is needed.

## Proposed repair (not executed)

Keep the wallet feature and the lazy import boundary; stop the browser-only chunk from entering server module evaluation. In preference order:

1. Force chunk isolation in the SSR/worker build so the shared `globalthis` polyfill is not co-located with `@reown/appkit`/lit — i.e. an explicit `manualChunks` rule in the server build that gives `@reown/*`, `lit*`, `@phosphor-icons/webcomponents` their own chunk and keeps shared polyfills separate. Verified by re-inspecting `dist/server/_libs/@tanstack/router-core+*.mjs` for any static import of the appkit chunk.
2. If chunk isolation cannot be expressed cleanly, add a narrowly scoped, server-only DOM base-class shim loaded before the entry import in `src/server.ts`, so lit's module scope evaluates harmlessly on the server while the wallet remains client-only at runtime.

Option 1 is the correct structural fix; option 2 is the fallback and would be documented as a compatibility shim, not a feature change.

Never use `ssr.external` / `resolve.external` for this — it hard-fails the worker build.

## Repair allowlist

- `vite.config.ts` (option 1)
- `src/server.ts` (only if option 2 is needed)
- optionally one new regression script under `scripts/` asserting the server bundle has no static lit/appkit import from the entry graph

## Prohibited

Supabase (schema, RLS, RPC, data, types, Edge Functions), Telegram, X/providers, secrets, wallet/chain execution, publish/deploy, `src/lib/reown-appkit-wallet.ts`, `src/lib/wallet-connector.ts`, routes, components, `src/integrations/supabase/*`, package.json/lockfile.

## Verification for the repair

1. `bunx tsgo --noEmit` clean; `bun run build` success.
2. `dist/server`: no static import of the appkit/lit chunks from the router-core, supabase-realtime or SSR entry chunks.
3. Local built-worker request simulation for `/` returns 200 HTML, not the `Reference: server` page.
4. Dev runtime: `/`, `/auth`, `/network` signed out render normally.
5. SE-3 (187) and SE-3.1 (59) regressions still pass.
6. Hosted preview re-checked after rebuild: no `Reference: server`, worker log free of `HTMLElement is not defined`.
7. `git status --porcelain` empty.

## Rollback

`dce534b1b3732888bb93aa02b011798da98828b6`.

## Stop point

Audit only. No repair performed this turn.
