// Run after `bun run build`. Fails if the production CLIENT bundle swaps
// `events` for Vite's empty browser-external stub (the root cause of
// "WalletConnect could not start" in production).
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { pathToFileURL } from "node:url";

const dir = "dist/client/assets";
const files = readdirSync(dir).filter((f) => f.endsWith(".js"));
let pass = 0, fail = 0;
const check = (name: string, ok: boolean) => { ok ? pass++ : (fail++, console.error("FAIL:", name)); };

const pkg = JSON.parse(readFileSync("package.json", "utf8"));
check("events is an exact direct dependency 3.3.0", pkg.dependencies?.events === "3.3.0");

// Real EventEmitter implementation must be bundled and actually construct.
const eventsChunk = files.find((f) => readFileSync(join(dir, f), "utf8").includes("defaultMaxListeners"));
check("real npm events implementation is in the client bundle", !!eventsChunk);

// The WalletConnect chunk (UniversalProvider/SignClient) must not import the stub.
const wcChunks = files.filter((f) => /wc_sessionRequest|relay\.walletconnect/.test(readFileSync(join(dir, f), "utf8")));
check("WalletConnect client chunk found", wcChunks.length > 0);
for (const f of wcChunks) {
  check(`${f} does not import __vite-browser-external`, !readFileSync(join(dir, f), "utf8").includes("__vite-browser-external"));
}

// Behavioral: load the built events chunk and construct an EventEmitter from it.
if (eventsChunk) {
  try {
    const mod: Record<string, unknown> = await import(pathToFileURL(join(process.cwd(), dir, eventsChunk)).href);
    let built = false;
    for (const v of Object.values(mod)) {
      const cand = typeof v === "function" ? v : null;
      for (const fn of [cand, ...(cand ? [] : [])]) {
        try {
          const out = (fn as () => unknown)();
          const C = (out as { EventEmitter?: unknown })?.EventEmitter ?? out;
          if (typeof C === "function") {
            const e = new (C as new () => { on: Function; emit: Function })();
            let got = false; e.on("x", () => { got = true; }); e.emit("x");
            if (got) built = true;
          }
        } catch { /* not the factory */ }
      }
    }
    check("built events chunk constructs a working EventEmitter", built);
  } catch {
    check("built events chunk loads", false);
  }
}

console.log(`wallet-production-bundle regression: ${pass} passed, ${fail} failed`);
if (fail) process.exit(1);
