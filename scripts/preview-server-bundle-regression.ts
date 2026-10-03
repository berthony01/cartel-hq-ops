/**
 * Preview server bundle regression.
 *
 * Guards the hosted-preview SSR failure where the production worker threw
 * `ReferenceError: HTMLElement is not defined` from
 * `dist/server/_libs/lit__reactive-element.mjs` during `getServerEntry()`.
 *
 * Root cause: nitro/unenv's shared `globalthis` polyfill was co-located with
 * the browser-only `@reown/appkit` chunk, so `@tanstack/router-core` and
 * `@supabase/realtime-js` statically imported that chunk and `lit` evaluated
 * `class extends HTMLElement` at server module scope.
 *
 * This script performs NO network, provider, database or Telegram calls.
 * It only reads the built server bundle and renders one local request.
 *
 * Usage: bun run build && bun scripts/preview-server-bundle-regression.ts
 */
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative, resolve } from "node:path";

const SERVER_DIR = resolve(process.cwd(), "dist/server");
const BROWSER_ONLY_CHUNK = /(@reown[\\/]appkit|reown__appkit|lit__reactive-element|@phosphor-icons)/;
const STATIC_IMPORT = /^\s*(?:import|export)[^;]*?\sfrom\s*["']([^"']+)["']/gm;

let passed = 0;
const failures: string[] = [];

function check(name: string, ok: boolean, detail = "") {
  if (ok) {
    passed++;
    return;
  }
  failures.push(`${name}${detail ? ` — ${detail}` : ""}`);
}

function listMjs(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) out.push(...listMjs(full));
    else if (entry.endsWith(".mjs")) out.push(full);
  }
  return out;
}

function staticImportsOf(file: string): string[] {
  const source = readFileSync(file, "utf8");
  const specifiers: string[] = [];
  for (const match of source.matchAll(STATIC_IMPORT)) {
    if (match[1]) specifiers.push(match[1]);
  }
  return specifiers;
}

try {
  statSync(SERVER_DIR);
} catch {
  console.error("dist/server is missing. Run `bun run build` first.");
  process.exit(1);
}

const files = listMjs(SERVER_DIR);
check("server bundle emitted chunks", files.length > 0, `${files.length} files`);

// 1. Eager-reachability: following ONLY static imports from the server
//    entries must never reach a browser-only chunk. The lazy wallet bridge
//    (src/lib/reown-appkit-browser.ts) and the wallet libraries it pulls in
//    (AppKit, wagmi connectors, Safe Apps provider) are browser-only and may
//    statically import each other; they are legitimate only behind a
//    dynamic import().
const LAZY_WALLET_CHUNK = /(reown-appkit-browser-|wagmi__connectors|@safe-global[\\/]safe-apps-provider)/;
const isBrowserOnly = (rel: string) => BROWSER_ONLY_CHUNK.test(rel) || LAZY_WALLET_CHUNK.test(rel);
const resolveSpec = (from: string, spec: string) =>
  spec.startsWith(".") ? resolve(join(from, ".."), spec) : null;

const entries = [join(SERVER_DIR, "index.mjs"), join(SERVER_DIR, "_ssr/ssr.mjs")].filter((f) => {
  try { statSync(f); return true; } catch { return false; }
});
check("server entries found (index.mjs, _ssr/ssr.mjs)", entries.length === 2, `${entries.length}`);
const seen = new Set<string>();
const eagerBrowserOnly: string[] = [];
const stack = [...entries];
while (stack.length) {
  const file = stack.pop()!;
  if (seen.has(file)) continue;
  seen.add(file);
  const rel = relative(SERVER_DIR, file);
  if (isBrowserOnly(rel)) { eagerBrowserOnly.push(rel); continue; }
  for (const spec of staticImportsOf(file)) {
    const target = resolveSpec(file, spec);
    if (target) stack.push(target);
  }
}
check("static graph from server entries visited modules", seen.size > 10, `${seen.size}`);
check(
  "no browser-only chunk eagerly reachable from server entries",
  eagerBrowserOnly.length === 0,
  eagerBrowserOnly.join(", "),
);

// 1b. Non-browser-only chunks must not statically import browser-only chunks.
for (const file of files) {
  const rel = relative(SERVER_DIR, file);
  if (isBrowserOnly(rel)) continue;
  const offending = staticImportsOf(file).filter((spec) => isBrowserOnly(spec));
  check(`no static browser-only import in ${rel}`, offending.length === 0, offending.join(", "));
}

// 1c. The lazy bridge exists and every reference to it is a dynamic import().
const bridgeFiles = files.filter((f) => /reown-appkit-browser-/.test(relative(SERVER_DIR, f)));
check("lazy wallet bridge chunk emitted", bridgeFiles.length === 1, `${bridgeFiles.length}`);
for (const file of files) {
  const src = readFileSync(file, "utf8");
  if (!/reown-appkit-browser-/.test(src) || bridgeFiles.includes(file)) continue;
  const staticRef = staticImportsOf(file).some((s) => /reown-appkit-browser-/.test(s));
  check(`bridge referenced only via import() in ${relative(SERVER_DIR, file)}`, !staticRef && /import\(\s*["'][^"']*reown-appkit-browser-/.test(src));
}

// 2. The two modules proven to have dragged the browser chunk into SSR.
for (const marker of ["router-core", "supabase__realtime-js"]) {
  const matches = files.filter((file) => relative(SERVER_DIR, file).includes(marker));
  check(`${marker} chunk present`, matches.length > 0);
  for (const file of matches) {
    const offending = staticImportsOf(file).filter((spec) => BROWSER_ONLY_CHUNK.test(spec));
    check(
      `${marker} does not statically import a browser-only chunk`,
      offending.length === 0,
      offending.join(", "),
    );
  }
}

// 3. The unenv runtime polyfill must live in its own chunk, never inside a
//    browser-only chunk.
const unenvHosts = files.filter((file) =>
  readFileSync(file, "utf8").includes("node_modules/unenv/dist/runtime/polyfill/globalthis.mjs"),
);
check("unenv globalthis polyfill is emitted", unenvHosts.length > 0);
for (const host of unenvHosts) {
  const rel = relative(SERVER_DIR, host);
  check(
    `unenv globalthis polyfill is not inside a browser-only chunk (${rel})`,
    !BROWSER_ONLY_CHUNK.test(rel),
  );
}

// 4. A real render of "/" against the built server must not be the emergency page.
const ssrEntry = join(SERVER_DIR, "_ssr/ssr.mjs");
try {
  statSync(ssrEntry);
  const mod = (await import(ssrEntry)) as {
    default?: { fetch: (req: Request) => Promise<Response> };
    fetch?: (req: Request) => Promise<Response>;
  };
  const handler = mod.default ?? mod;
  const response = await handler.fetch!(new Request("http://localhost/"));
  const body = await response.text();
  check("built server responds 200 for /", response.status === 200, `status ${response.status}`);
  check("built server does not serve the emergency page", !body.includes("cartel-error-page"));
  check("built server does not serve the server marker", !body.includes("Reference: server"));
} catch (error) {
  check(
    "built server renders / without throwing",
    false,
    error instanceof Error ? error.message : String(error),
  );
}

console.log(`preview-server-bundle regression: ${passed} passed, ${failures.length} failed`);
for (const failure of failures) console.error(`FAIL: ${failure}`);
process.exit(failures.length === 0 ? 0 : 1);
