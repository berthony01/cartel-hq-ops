// @lovable.dev/vite-tanstack-config already includes the following — do NOT add them manually
// or the app will break with duplicate plugins:
//   - TanStack devtools (dev-only, first), tanstackStart, viteReact, tailwindcss, tsConfigPaths,
//     nitro (build-only using cloudflare as a default target), VITE_* env injection, @ path alias,
//     React/TanStack dedupe, error logger plugins, and sandbox detection (port/host/strictPort).
// You can pass additional config via defineConfig({ vite: { ... }, etc... }) if needed.
import { defineConfig } from "@lovable.dev/vite-tanstack-config";
import { mcpPlugin } from "@lovable.dev/mcp-js/stacks/tanstack/vite";
import { fileURLToPath } from "node:url";

const EVENTS_NPM = fileURLToPath(new URL("./node_modules/events/events.js", import.meta.url));

// unenv injects a shared `globalthis` polyfill that router-core and
// supabase-realtime also use. Nitro's default per-package grouping let that
// polyfill land inside the browser-only @reown/appkit chunk, so those
// server-side modules statically imported that chunk — and `lit` evaluates
// `class extends HTMLElement` at module scope, which throws on Cloudflare
// Workers and killed SSR module evaluation before any route ran.
// Give the unenv runtime its own chunk with the highest priority so it can
// never be co-located with browser-only code again.
const UNENV_RUNTIME = /node_modules[\\/]unenv[\\/]/;

const serverChunkIsolation = {
  build: {
    rolldownOptions: {
      output: {
        codeSplitting: {
          groups: [
            {
              name: "_libs/unenv-runtime",
              test: UNENV_RUNTIME,
              priority: 100,
            },
          ],
        },
      },
    },
  },
};


export default defineConfig({
  tanstackStart: {
    // Redirect TanStack Start's bundled server entry to src/server.ts (our SSR error wrapper).
    // nitro/vite builds from this
    server: { entry: "server" },
  },
  vite: {
    plugins: [mcpPlugin()],
    // WalletConnect imports `events` (EventEmitter). The production client build
    // replaced it with Vite's empty browser-external stub, so UniversalProvider
    // threw "x.default is not a constructor" on start. Force the real npm package
    // by absolute file path so builtin detection cannot intercept it.
    resolve: {
      alias: [{ find: /^(?:node:)?events$/, replacement: EVENTS_NPM }],
    },
    environments: {
      nitro: serverChunkIsolation,
      ssr: serverChunkIsolation,
    },
  },
});
