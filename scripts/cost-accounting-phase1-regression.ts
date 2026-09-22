/**
 * Cost Accounting Foundation — Phase 1 regression.
 *
 * PURE STATIC assertions. No network, no database, no RPC, no wallet, no
 * Edge Function invocation. Proves that Phase 1 added truthful, idempotent
 * provider-credit accounting and activated nothing else.
 */
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";

const MIGRATIONS = "supabase/migrations";
const PHASE1_MIGRATION = "20260922070921_40548af2-4afe-4876-bcaa-f22868f5942d.sql";
const LAST_GATE_MIGRATION = "20260920054150_5dcb8ca1-aba1-4c9b-995e-cd9ff00da488.sql";
const HELPER = "backend-source/edge-functions/_shared/usage-accounting.ts";
const HELPER_MIRROR = "supabase/functions/_shared/usage-accounting.ts";
const STICKER_AI = "backend-source/edge-functions/sticker-ai/index.ts";
const MOTION_AI = "backend-source/edge-functions/sticker-motion-ai/index.ts";
const EVIDENCE = "src/lib/launch-evidence-checks.ts";
const REGISTRY = "src/lib/chain-mainnet-registry.ts";

const read = (p: string) => readFileSync(p, "utf8");

let failures = 0;
function check(id: string, ok: boolean, detail: string) {
  if (ok) console.log(`PASS ${id} — ${detail}`);
  else {
    failures += 1;
    console.error(`FAIL ${id} — ${detail}`);
  }
}

function walk(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) out.push(...walk(full));
    else out.push(full.replace(/\\/g, "/"));
  }
  return out;
}

const migrationFiles = walk(MIGRATIONS);
const migrationNames = migrationFiles.map((f) => f.split("/").pop() ?? f).sort();
const migrationSrc = read(join(MIGRATIONS, PHASE1_MIGRATION));
/** Comment-stripped views: prose about prices/owners must not satisfy or fail a code assertion. */
const migrationCode = migrationSrc
  .replace(/^\s*--.*$/gm, "")
  .replace(/COMMENT ON[\s\S]*?;/g, "");
const helperSrc = read(HELPER);
const helperCode = helperSrc
  .replace(/\/\*[\s\S]*?\*\//g, "")
  .replace(/^\s*\/\/.*$/gm, "");
const stickerSrc = read(STICKER_AI);
const motionSrc = read(MOTION_AI);

// ------------------------------------------------------------ 1. migration set
const postGate = migrationNames.filter((f) => f > LAST_GATE_MIGRATION);
check(
  "CA1-1",
  migrationNames.length === 88 &&
    postGate.length === 4 &&
    postGate[0] === PHASE1_MIGRATION &&
    postGate[1] === "20260922141917_c47c2384-73c4-4bbf-8cc2-495112d64990.sql" &&
    postGate[2] === "20260922142803_fedec44c-654f-4e1a-a117-30d027601e03.sql" &&
    postGate[3] === "20260922161918_ef6e322a-d993-4970-9d48-3b4f93afa222.sql",
  `migration count is exactly 88 and the only post-gate migrations are ${PHASE1_MIGRATION}, the two Phase 2B mission-safety migrations and the Project Identity Gate A function-only migration (found: ${postGate.join(", ") || "none"})`,
);

// -------------------------------------------------------- 2. migration content
const NEW_COLUMNS = [
  "provider text NULL",
  "provider_model text NULL",
  "unit_type text NULL",
  "currency text NULL",
  "pricing_source text NULL",
  "pricing_version text NULL",
  "pricing_effective_at timestamptz NULL",
  "idempotency_key text NULL",
  "metadata jsonb NOT NULL DEFAULT '{}'::jsonb",
];
check(
  "CA1-2a",
  NEW_COLUMNS.every((c) => migrationSrc.includes(`ADD COLUMN IF NOT EXISTS ${c}`)),
  `all 9 cost-accounting columns are added to public.usage_ledger with the exact declared types/nullability`,
);
check(
  "CA1-2b",
  /metadata jsonb NOT NULL DEFAULT '\{\}'::jsonb/.test(migrationSrc),
  "metadata is NOT NULL with default '{}'::jsonb",
);
check(
  "CA1-2c",
  /ALTER TABLE public\.usage_ledger/.test(migrationSrc) &&
    !/ALTER TABLE(?!\s+public\.usage_ledger)/.test(migrationSrc) &&
    !/CREATE TABLE|DROP TABLE|DROP COLUMN/i.test(migrationSrc),
  "the migration is additive and touches only public.usage_ledger",
);
check(
  "CA1-2d",
  !/\bUPDATE\b|\bDELETE\b|\bINSERT\b|\bTRUNCATE\b/i.test(migrationSrc),
  "no backfill and no UPDATE/DELETE/INSERT of existing rows",
);
check(
  "CA1-2e",
  !/provider_cost|internal_cost/.test(migrationSrc) &&
    !/CREATE POLICY|ALTER POLICY|DROP POLICY|GRANT |REVOKE |ROW LEVEL SECURITY/i.test(migrationSrc) &&
    !/CREATE (OR REPLACE )?FUNCTION|CREATE TRIGGER/i.test(migrationSrc),
  "provider_cost/internal_cost, RLS, grants, functions and triggers are untouched",
);
check(
  "CA1-2f",
  !/\$\s?\d|usd|price|rate_card|cost_per|dollar/i.test(
    migrationCode.replace(/provider_cost|internal_cost|pricing_source|pricing_version|pricing_effective_at/g, ""),
  ),
  "no hardcoded dollar price or provider rate card in the migration",
);

// --------------------------------------------------------- 3. unique index
const indexLine = migrationSrc.match(/CREATE UNIQUE INDEX[\s\S]*?;/)?.[0] ?? "";
check(
  "CA1-3",
  /usage_ledger_idempotency_key_uniq/.test(indexLine) &&
    /ON public\.usage_ledger \(idempotency_key\)/.test(indexLine) &&
    !/WHERE/i.test(indexLine),
  "the idempotency index is a NON-PARTIAL unique index targeting exactly usage_ledger(idempotency_key)",
);

// --------------------------------------------------------------- 4. helper
// Phase 2B deployment-parity re-pin: the authoritative source stays in
// backend-source, and exactly ONE deployable mirror now exists under
// supabase/functions so the runner can import it. The two must be identical.
const helperCopies = walk("backend-source/edge-functions")
  .concat(walk("src"))
  .concat(walk("supabase/functions"))
  .filter((f) => /usage-accounting\.ts$/.test(f))
  .sort();
check(
  "CA1-4a",
  helperCopies.length === 2 &&
    helperCopies.includes(HELPER) &&
    helperCopies.includes(HELPER_MIRROR) &&
    readFileSync(HELPER).equals(readFileSync(HELPER_MIRROR)),
  `the shared accounting helper exists at exactly ${HELPER} (authoritative) plus exactly one byte-for-byte identical deployable mirror at ${HELPER_MIRROR}, and nowhere else`,
);
check(
  "CA1-4b",
  /\.upsert\(\s*row,\s*\{\s*onConflict:\s*"idempotency_key",\s*ignoreDuplicates:\s*true\s*\}\s*\)/.test(
    helperSrc,
  ) && !/\.onConflict\(/.test(helperSrc),
  "the helper uses Supabase duplicate-safe upsert/onConflict/ignoreDuplicates semantics, never ORM-style .onConflict().ignore()",
);
check(
  "CA1-4c",
  /PROVIDER_CREDIT_UNIT_TYPE = "provider_credit"/.test(helperSrc) &&
    /unit_type: PROVIDER_CREDIT_UNIT_TYPE/.test(helperSrc),
  "the helper records unit_type='provider_credit'",
);
check(
  "CA1-4d",
  /return `\$\{provider\}:\$\{actionType\}:\$\{aiJobId\}:\$\{task\}`/.test(helperSrc) &&
    /providerTaskId[\s\S]*?"job"/.test(helperSrc),
  "the idempotency key spans provider, action type, ai job and provider task, with a stable `job` fallback",
);
check(
  "CA1-4e",
  /provider_task_id: input\.providerTaskId/.test(helperSrc) &&
    /job_type: input\.jobType/.test(helperSrc),
  "metadata records provider_task_id and job_type",
);
check(
  "CA1-4f",
  /currency: null/.test(helperSrc) &&
    /pricing_source: null/.test(helperSrc) &&
    /pricing_version: null/.test(helperSrc) &&
    /pricing_effective_at: null/.test(helperSrc) &&
    /provider_cost: null/.test(helperSrc) &&
    /internal_cost: null/.test(helperSrc),
  "currency, every pricing_* field and both cost columns stay null — no dollar conversion is stored",
);
check(
  "CA1-4g",
  !/owner|is_platform_owner|unrestricted|plan|entitlement|quota|subscription|stripe/i.test(helperCode),
  "the helper contains no owner bypass and no plan/entitlement/quota/billing logic",
);
check(
  "CA1-4h",
  /return \{ recorded: false, duplicate: true \}/.test(helperSrc) &&
    /console\.error\("usage-accounting/.test(helperSrc) &&
    !/throw /.test(helperSrc),
  "a duplicate is a success no-op and any other accounting error is server-logged without throwing into the generation path",
);

// --------------------------------------------------------------- 5. writers
for (const [label, src] of [["sticker-ai", stickerSrc], ["sticker-motion-ai", motionSrc]] as const) {
  check(
    `CA1-5:${label}`,
    /import \{ recordProviderCreditUsage \} from "\.\.\/_shared\/usage-accounting\.ts";/.test(src) &&
      /await recordProviderCreditUsage\(admin, \{/.test(src),
    `${label} imports and uses the shared accounting helper`,
  );
  check(
    `CA1-5b:${label}`,
    !/from\("usage_ledger"\)/.test(src),
    `${label} no longer writes usage_ledger directly — DB uniqueness is authoritative, not an app-side ai_job_id pre-check`,
  );
  check(
    `CA1-5c:${label}`,
    /provider: typeof job\.provider === "string"/.test(src) &&
      /providerModel: typeof job\.provider_model === "string"/.test(src) &&
      /providerTaskId: typeof job\.provider_task_id === "string"/.test(src),
    `${label} takes provider, model and task id from the live ai_jobs row rather than duplicating constants`,
  );
  check(
    `CA1-5d:${label}`,
    /credits,/.test(src),
    `${label} still passes the raw provider-reported credits as units`,
  );
}

// ------------------------------------------------- 6. non-activation tripwires
check(
  "CA1-6a",
  /export const APPROVED_OFFICIAL_ARTIFACT_ID = "cartel-fixed-erc20-v1" as const;/.test(read(EVIDENCE)),
  "APPROVED_OFFICIAL_ARTIFACT_ID remains exactly cartel-fixed-erc20-v1",
);
check(
  "CA1-6b",
  /MAINNET_LIQUIDITY_TX_ENABLED = false as const/.test(read(REGISTRY)),
  "MAINNET_LIQUIDITY_TX_ENABLED remains false",
);

console.log(
  failures === 0
    ? "\nCost Accounting Phase 1 regression: ALL CHECKS PASSED"
    : `\nCost Accounting Phase 1 regression: ${failures} CHECK(S) FAILED`,
);
if (failures > 0) process.exit(1);
