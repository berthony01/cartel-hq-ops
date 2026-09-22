/**
 * Deployment path parity regression (repo-only, zero network, zero database).
 *
 * Asserts byte-for-byte equality between each deployable Edge Function file
 * under `supabase/functions/` and its authoritative source snapshot under
 * `backend-source/edge-functions/`, and pins the two verify_jwt values in
 * `supabase/config.toml`.
 */

import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";

let passed = 0;
const failures: string[] = [];

function check(name: string, condition: boolean, detail = ""): void {
  if (condition) {
    passed += 1;
  } else {
    failures.push(`${name}${detail ? ` — ${detail}` : ""}`);
  }
}

const PARITY_FILES = [
  "social-mission-telegram/index.ts",
  "social-mission-telegram/card.ts",
  "social-mission-telegram/deno.json",
  "social-mission-runner/index.ts",
  "social-mission-runner/deno.json",
  "_shared/x-metrics.ts",
  "_shared/mission-pulse-copy.ts",
  // SE-15 — the shared resolved-config module both deployable functions import.
  "_shared/mission-resolved-config.ts",
  // Phase 2B — the shared usage-accounting writer the runner now imports.
  "_shared/usage-accounting.ts",
] as const;

function readOrNull(path: string): Buffer | null {
  try {
    return readFileSync(path);
  } catch {
    return null;
  }
}

function sha256(buf: Buffer): string {
  return createHash("sha256").update(buf).digest("hex");
}

for (const rel of PARITY_FILES) {
  const source = readOrNull(`backend-source/edge-functions/${rel}`);
  const deployable = readOrNull(`supabase/functions/${rel}`);

  check(`1.a source exists: ${rel}`, source !== null);
  check(`1.b deployable exists: ${rel}`, deployable !== null);
  if (!source || !deployable) continue;

  const a = sha256(source);
  const b = sha256(deployable);
  check(`1.c byte-for-byte parity: ${rel}`, a === b, `${a} != ${b}`);
  check(`1.d non-empty: ${rel}`, deployable.length > 0);
}

// 2 — supabase/config.toml verify_jwt pinning.
const config = readFileSync("supabase/config.toml", "utf8");

function verifyJwtFor(fn: string): string | null {
  const match = config.match(
    new RegExp(`\\[functions\\.${fn}\\][^\\[]*verify_jwt\\s*=\\s*(true|false)`),
  );
  return match ? match[1] : null;
}

check("2.1 social-mission-telegram verify_jwt = true", verifyJwtFor("social-mission-telegram") === "true");
check("2.2 social-mission-runner verify_jwt = false", verifyJwtFor("social-mission-runner") === "false");
check("2.3 project_id unchanged", config.includes('project_id = "ocoinbnjgstkmnwwvnhi"'));

// 3 — the deployable copies must keep their existing relative dependency graph.
const runnerIndex = readFileSync("supabase/functions/social-mission-runner/index.ts", "utf8");
const telegramIndex = readFileSync("supabase/functions/social-mission-telegram/index.ts", "utf8");

check("3.1 runner imports shared x-metrics", runnerIndex.includes('from "../_shared/x-metrics.ts"'));
check("3.2 runner imports shared pulse copy", runnerIndex.includes('from "../_shared/mission-pulse-copy.ts"'));
check("3.3 telegram imports local card", telegramIndex.includes('from "./card.ts"'));
check("3.4 telegram imports shared x-metrics", telegramIndex.includes('from "../_shared/x-metrics.ts"'));
check(
  "3.5 telegram imports shared resolved config",
  telegramIndex.includes('from "../_shared/mission-resolved-config.ts"'),
);
check(
  "3.6 runner imports shared resolved config",
  runnerIndex.includes('from "../_shared/mission-resolved-config.ts"'),
);

// 4 — this suite must never touch the network or a database.
const self = readFileSync("scripts/social-mission-deploy-parity-regression.ts", "utf8");
check("4.1 no fetch calls", !/\bfetch\s*\(/.test(self));
check("4.2 no supabase client usage", !/createClient\s*\(/.test(self));

if (failures.length > 0) {
  console.error(`FAIL — ${failures.length} failed, ${passed} passed`);
  for (const failure of failures) console.error(`  - ${failure}`);
  process.exit(1);
}

console.log(`PASS — ${passed}/${passed} deployment parity checks passed`);
