// Static, offline-only fail-closed harness guard; no network and no provider calls.
import { readFileSync } from "node:fs";
import { strict as assert } from "node:assert";
const read = p => readFileSync(new URL("../" + p, import.meta.url), "utf8");
const vite = read("vite.config.ts");
const gate = read("src/lib/cartel-guide-ui-gate.ts");
const client = read("src/integrations/supabase/staging-test-client.ts");
const original = read("src/integrations/supabase/client.ts");
assert.match(vite, /CARTEL_GUIDE_STAGING_HARNESS_ACK/);
assert.match(vite, /stagingClient/);
assert.match(vite, /guideHarness \? \[/);
assert.match(gate, /MODE === "guide-staging-harness"/);
assert.match(client, /llicojkxpzwylghptmkf/);
assert.match(client, /window\.sessionStorage/);
assert.match(client, /Wrong Supabase project key/);
assert.doesNotMatch(client, /ocoinbnjgstkmnwwvnhi/);
assert.match(original, /ocoinbnjgstkmnwwvnhi/);
console.log("Cartel Guide staging harness static isolation: 9 PASS, 0 FAIL");
