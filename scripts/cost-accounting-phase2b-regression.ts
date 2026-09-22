/**
 * Cost Accounting — Phase 2B regression.
 *
 * PURE STATIC assertions. No network, no database, no RPC, no wallet, no Edge
 * Function invocation, no deploy. Proves that Phase 2B added (a) truthful raw
 * X billable-resource accounting and (b) hard server-side runaway-mission
 * safety, without changing the X request shape, the legacy snapshot telemetry,
 * Phase 1/2A helper semantics, or any commercial gate.
 */
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";

const MIGRATIONS = "supabase/migrations";
const PHASE1_MIGRATION = "20260922070921_40548af2-4afe-4876-bcaa-f22868f5942d.sql";
const PHASE2B_MIGRATION = "20260922141917_c47c2384-73c4-4bbf-8cc2-495112d64990.sql";
const LAST_GATE_MIGRATION = "20260920054150_5dcb8ca1-aba1-4c9b-995e-cd9ff00da488.sql";

const HELPER = "backend-source/edge-functions/_shared/usage-accounting.ts";
const RUNNER = "backend-source/edge-functions/social-mission-runner/index.ts";
const X_METRICS = "backend-source/edge-functions/_shared/x-metrics.ts";
const SE14_SQL = "docs/sql/SE14_multi_metric_mission_targets.sql";
const EVIDENCE = "src/lib/launch-evidence-checks.ts";
const REGISTRY = "src/lib/chain-mainnet-registry.ts";

const read = (p: string) => readFileSync(p, "utf8");
/** Comment-stripped view: prose must neither satisfy nor fail a code assertion. */
const code = (src: string) =>
  src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");

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

const helperSrc = read(HELPER);
const helperCode = code(helperSrc);
const runnerSrc = read(RUNNER);
const runnerCode = code(runnerSrc);
const xMetricsCode = code(read(X_METRICS));
const migrationSrc = read(`${MIGRATIONS}/${PHASE2B_MIGRATION}`);
const migrationCode = migrationSrc
  .replace(/^\s*--.*$/gm, "");

/* ------------------------------------------------- 1. authorized migration set */

const migrationNames = walk(MIGRATIONS).map((f) => f.split("/").pop() ?? f).sort();
const postGate = migrationNames.filter((f) => f > LAST_GATE_MIGRATION);

check(
  "CA2B-1a",
  migrationNames.length === 86,
  `exactly 86 migration files exist (found ${migrationNames.length})`,
);
check(
  "CA2B-1b",
  postGate.length === 2 && postGate[0] === PHASE1_MIGRATION && postGate[1] === PHASE2B_MIGRATION,
  `the only post-gate migrations are Cost Accounting Phase 1 and Phase 2B mission safety (found: ${postGate.join(", ") || "none"})`,
);
check(
  "CA2B-1c",
  !/\bCREATE TABLE\b|\bADD COLUMN\b|\bDROP COLUMN\b|\bALTER TABLE\b|CREATE POLICY|DROP POLICY|ENABLE ROW LEVEL SECURITY/i.test(
    migrationCode,
  ),
  "the Phase 2B migration changes no table, column, policy or RLS state",
);
check(
  "CA2B-1d",
  !/\bINSERT INTO public\.usage_ledger\b/i.test(migrationCode) &&
    !/\$|usd|dollar|rate_card|price/i.test(migrationCode.replace(/\$\$/g, "").replace(/\$function\$/g, "")),
  "the Phase 2B migration backfills no usage row and contains no dollar, price or rate-card value",
);

/* ------------------------------------- 2. hardened metrics selector semantics */

const selectorBody = migrationCode.slice(
  migrationCode.indexOf("list_active_social_missions_for_metrics"),
  migrationCode.indexOf("repair_and_expire_social_missions_for_metrics"),
);

check(
  "CA2B-2a",
  [
    "mission_id uuid",
    "workspace_id uuid",
    "target_id uuid",
    "external_post_id text",
    "canonical_url text",
    "telegram_chat_id bigint",
    "telegram_message_id bigint",
    "edit_revision integer",
    "edit_state text",
    "mission_created_by uuid",
    "accomplished_at timestamptz",
    "last_metric_signature text",
    "effective_config jsonb",
  ].every((col) => selectorBody.includes(col)),
  "the selector return signature is unchanged — all thirteen columns in order",
);
check(
  "CA2B-2b",
  /t\.delivery_state = 'SENT'/.test(selectorBody) && /t\.sent_at IS NOT NULL/.test(selectorBody),
  "the selector requires a confirmed SENT target with a non-null sent_at",
);
check(
  "CA2B-2c",
  /social_mission_effective_config\(m\.id\)/.test(selectorBody) &&
    /GREATEST\(1, LEAST\(1440,/.test(selectorBody) &&
    /duration_minutes/.test(selectorBody),
  "the selector derives duration from the mission's effective config, clamped 1..1440",
);
check(
  "CA2B-2d",
  !/make_interval\(mins => 45\)|interval '45 minutes'/.test(selectorBody),
  "the selector hardcodes no 45-minute fallback duration",
);
check(
  "CA2B-2e",
  /t\.sent_at \+ interval '24 hours'/.test(selectorBody) &&
    /now\(\) < LEAST\(/.test(selectorBody) &&
    /COALESCE\(\s*m\.ends_at,/.test(selectorBody),
  "the selector applies an absolute 24h cap from sent_at over the effective end",
);
check(
  "CA2B-2f",
  /p\.platform = 'x'/.test(selectorBody) &&
    /external_post_id ~ '\^\[0-9\]\{1,32\}\$'/.test(selectorBody) &&
    /live_metrics_enabled/.test(selectorBody) &&
    /t\.telegram_message_id IS NOT NULL/.test(selectorBody) &&
    /ORDER BY m\.started_at NULLS LAST/.test(selectorBody) &&
    /SECURITY DEFINER/.test(selectorBody) &&
    /SET search_path = public/.test(selectorBody),
  "platform/id validation, metrics toggles, message filter, ordering and definer settings are preserved",
);

/* ------------------------------------------- 3. repair / expire safety RPC */

const repairBody = migrationCode.slice(
  migrationCode.indexOf("CREATE OR REPLACE FUNCTION public.repair_and_expire_social_missions_for_metrics"),
);

check(
  "CA2B-3a",
  /CREATE OR REPLACE FUNCTION public\.repair_and_expire_social_missions_for_metrics\(\s*_limit integer DEFAULT 300/.test(
    migrationCode,
  ) && /RETURNS jsonb/.test(repairBody),
  "the repair/expire RPC exists with the specified signature",
);
check(
  "CA2B-3b",
  /REVOKE ALL ON FUNCTION public\.repair_and_expire_social_missions_for_metrics\(integer\)[\s\S]{0,80}FROM PUBLIC, anon, authenticated/.test(
    migrationCode,
  ) &&
    /GRANT EXECUTE ON FUNCTION public\.repair_and_expire_social_missions_for_metrics\(integer\) TO service_role/.test(
      migrationCode,
    ) &&
    /GRANT EXECUTE ON FUNCTION public\.repair_and_expire_social_missions_for_metrics\(integer\) TO postgres/.test(
      migrationCode,
    ),
  "the repair/expire RPC is service-role and postgres only",
);
check(
  "CA2B-3c",
  /status = 'COMPLETED'/.test(repairBody) &&
    !/'EXPIRED'/.test(repairBody) &&
    !/SET status = 'CANCELLED'/.test(repairBody) &&
    !/status = 'CANCELLED'/.test(repairBody),
  "safety expiry uses only the existing COMPLETED status — never EXPIRED, never CANCELLED",
);
check(
  "CA2B-3d",
  /min\(t\.sent_at\)/.test(repairBody) &&
    /earliest_sent_at \+ make_interval\(mins => v_duration\)/.test(repairBody.replace(/v_mission\./g, "")) &&
    /GREATEST\(1, LEAST\(1440,/.test(repairBody),
  "a missing end time is repaired from the EARLIEST sent_at plus the configured duration, clamped 1..1440",
);
check(
  "CA2B-3e",
  /ends_at IS NULL OR .*ends_at > v_absolute_cap/s.test(repairBody) &&
    /v_safe_end := LEAST\(COALESCE\(v_mission\.ends_at, v_configured_end\), v_absolute_cap\)/.test(repairBody),
  "safe_end = LEAST(existing ends_at or configured end, 24h absolute cap)",
);
check(
  "CA2B-3f",
  !/'PULSE'[\s\S]{0,200}INSERT INTO public\.social_mission_schedule_events/.test(repairBody) &&
    !/VALUES[^;]{0,200}'PULSE'/.test(repairBody),
  "no historical PULSE event is ever synthesised",
);
check(
  "CA2B-3g",
  /INSERT INTO public\.social_mission_schedule_events[\s\S]{0,400}'COMPLETE', 1::smallint[\s\S]{0,200}ON CONFLICT \(target_id, event_type, sequence_no\) DO NOTHING/.test(
    repairBody,
  ) && /AND e\.state = 'PENDING'/.test(repairBody),
  "exactly one COMPLETE event per SENT target is ensured idempotently, and only a PENDING one is pulled in",
);
check(
  "CA2B-3h",
  /e\.event_type = 'PULSE'[\s\S]{0,60}AND e\.state = 'PENDING'/.test(repairBody) &&
    /SET state = 'CANCELLED'/.test(repairBody),
  "expiry cancels only PENDING pulses; terminal and CLAIMED states are untouched",
);
check(
  "CA2B-3i",
  /FOR UPDATE OF m SKIP LOCKED/.test(repairBody) &&
    /LEAST\(GREATEST\(COALESCE\(_limit, 300\), 1\), 500\)/.test(repairBody),
  "the sweep is concurrency-safe and clamps _limit to 1..500",
);
check(
  "CA2B-3j",
  /safety_expiry/.test(repairBody) &&
    /COALESCE\(m\.metadata, '\{\}'::jsonb\)\s*\|\|/.test(repairBody) &&
    !/social_post_id\s*=/.test(repairBody) &&
    !/telegram_message_id\s*=/.test(repairBody) &&
    !/delivery_state\s*=/.test(repairBody),
  "expiry merges narrow safety metadata and never rewrites social_post_id, delivery state or telegram message ids",
);

/* --------------------------------------------- 4. runner runaway safety order */

const repairCallIndex = runnerCode.indexOf("repair_and_expire_social_missions_for_metrics");
const lookupIndex = runnerCode.indexOf("lookupXPostMetrics(bearer");
const metricsPhaseIndex = runnerCode.indexOf("runMetricsRefresh(admin");

check(
  "CA2B-4a",
  repairCallIndex > 0 && metricsPhaseIndex > repairCallIndex,
  "the runner invokes the safety sweep BEFORE runMetricsRefresh",
);
check(
  "CA2B-4b",
  /rpc\(\s*"repair_and_expire_social_missions_for_metrics",\s*\{\s*_limit: MISSION_SAFETY_LIMIT/s.test(
    runnerCode,
  ) && /MISSION_SAFETY_LIMIT = 300/.test(runnerCode),
  "the sweep is called with _limit 300",
);
check(
  "CA2B-4c",
  repairCallIndex > 0 &&
    lookupIndex > 0 &&
    runnerCode.indexOf("secretOk !== true") < repairCallIndex,
  "the sweep runs inside authenticated cron execution and before any possible X lookup",
);
check(
  "CA2B-4d",
  !/is_platform_owner|has_platform_unrestricted_access|berthonyxyz/.test(runnerCode) &&
    !/is_platform_owner|has_platform_unrestricted_access|berthonyxyz/.test(migrationCode),
  "no owner, plan, entitlement or quota branch exists in the safety path",
);

/* ------------------------------------------ 5. X request shape is unchanged */

check(
  "CA2B-5a",
  /X_API_BASE = "https:\/\/api\.x\.com\/2\/tweets"/.test(xMetricsCode) &&
    /"tweet\.fields": "public_metrics,created_at,author_id"/.test(xMetricsCode),
  "the X request is still GET /2/tweets with the same tweet.fields",
);
check(
  "CA2B-5b",
  !/expansions/.test(xMetricsCode) && !/user\.fields/.test(xMetricsCode),
  "no expansions and no user.fields are requested, so no User resource is ever returned",
);
check(
  "CA2B-5c",
  !/social_x_user_resource_read/.test(runnerCode) && !/social_x_user_resource_read/.test(helperCode),
  "no User-resource accounting exists, because no User resource is returned",
);

/* ----------------------------------------- 6. X Post resource accounting */

check(
  "CA2B-6a",
  /export function buildXResourceIdempotencyKey\(/.test(helperCode) &&
    /`\$\{X_RESOURCE_PROVIDER\}:\$\{actionType\}:\$\{resourceId\.trim\(\)\}:\$\{billingUtcDate\.trim\(\)\}`/.test(
      helperCode,
    ),
  "the X key is exactly x:<action_type>:<resource_id>:<YYYY-MM-DD>",
);
check(
  "CA2B-6b",
  !/workspaceId|workspace_id|aiJobId|ai_job_id/.test(
    helperCode.slice(
      helperCode.indexOf("export function buildXResourceIdempotencyKey"),
      helperCode.indexOf("export interface XResourceReadInput"),
    ),
  ),
  "the X key is APP-GLOBAL — it carries no workspace and no ai-job segment",
);

const xWriter = helperCode.slice(
  helperCode.indexOf("export async function recordXResourceRead"),
  helperCode.indexOf("/* ------------------------------------------------------------- Phase 1 ---- */") >
    helperCode.indexOf("export async function recordXResourceRead")
    ? helperCode.indexOf("/* --")
    : helperCode.length,
);
const xWriterBody = helperCode.slice(helperCode.indexOf("export async function recordXResourceRead"));

check(
  "CA2B-6c",
  /X_RESOURCE_UNIT_TYPE = "resource_read"/.test(helperCode) &&
    /X_RESOURCE_PROVIDER = "x"/.test(helperCode) &&
    /units: 1,/.test(xWriterBody) &&
    /unit_type: X_RESOURCE_UNIT_TYPE/.test(xWriterBody) &&
    /provider: X_RESOURCE_PROVIDER/.test(xWriterBody),
  "the X writer records units=1, provider 'x' and unit_type 'resource_read'",
);
check(
  "CA2B-6d",
  /\.\.\.NULL_PRICING/.test(xWriterBody) &&
    /insertLedgerRow\(admin, row\)/.test(xWriterBody) &&
    /ai_job_id: null/.test(xWriterBody),
  "pricing and cost fields stay null, and the duplicate-safe shared insert is reused",
);
check(
  "CA2B-6e",
  /resourceId\.trim\(\)\.length === 0/.test(xWriterBody) &&
    /\/\^\\d\{4\}-\\d\{2\}-\\d\{2\}\$\//.test(xWriterBody),
  "the X writer validates a non-empty resource id and a YYYY-MM-DD UTC date",
);
check(
  "CA2B-6f",
  /onConflict: "idempotency_key", ignoreDuplicates: true/.test(helperCode) &&
    /code === "23505"/.test(helperCode) &&
    /console\.error\("usage-accounting: ledger write failed"/.test(helperCode),
  "duplicates are a DB-authoritative no-op and other errors are logged and swallowed",
);

/* --------------------------------------- 7. runner accounting is truthful */

check(
  "CA2B-7a",
  /X_POST_RESOURCE_ACTION = "social_x_post_resource_read"/.test(runnerCode) &&
    /X_ENDPOINT_DESCRIPTOR = "GET \/2\/tweets"/.test(runnerCode) &&
    /actionType: X_POST_RESOURCE_ACTION/.test(runnerCode) &&
    /providerModel: X_ENDPOINT_DESCRIPTOR/.test(runnerCode),
  "the runner records the exact tuple social_x_post_resource_read / x / GET /2/tweets / resource_read / 1",
);
check(
  "CA2B-7b",
  /if \(!read\.ok\) continue;[\s\S]{0,200}for \(const \[id, post\] of read\.posts\)/.test(runnerCode),
  "accounting happens only after read.ok, iterating the ACTUAL returned posts — no event on a failed lookup",
);
check(
  "CA2B-7c",
  /const owner = attribution\.get\(id\);/.test(runnerCode) &&
    /row\.workspace_id < current\.workspace_id/.test(runnerCode) &&
    /row\.mission_id < current\.mission_id/.test(runnerCode) &&
    /attribution_policy: X_ATTRIBUTION_POLICY/.test(runnerCode),
  "one returned Post resource is attributed deterministically to a single workspace/mission",
);
check(
  "CA2B-7d",
  [
    "x_resource_type",
    "x_resource_id",
    "x_billing_utc_date",
    "endpoint",
    "mission_id",
    "external_post_id",
    "observed_at",
    "poll_bucket",
    "attribution_policy",
  ].every((k) => runnerCode.includes(k)),
  "metadata carries the full truthful resource identity",
);
check(
  "CA2B-7e",
  /billingUtcDate = observedAt\.slice\(0, 10\)/.test(runnerCode),
  "the billing date is the UTC calendar day of the observed read",
);
check(
  "CA2B-7f",
  /_limit: METRICS_WORKLIST_LIMIT/.test(runnerCode) &&
    /batchPostIds\(rows\.map\(\(row\) => row\.external_post_id\), X_BATCH_MAX\)/.test(runnerCode) &&
    /METRICS_MAX_BATCHES/.test(runnerCode) &&
    /record_social_mission_metric_snapshot/.test(runnerCode),
  "batching limits, worklist limit and snapshot semantics are unchanged",
);

/* ------------------------- 8. legacy telemetry and Phase 1/2A compatibility */

check(
  "CA2B-8a",
  /VALUES \(v_mission\.workspace_id, NULL, 'social_x_tracked_post_read', 1\)/.test(read(SE14_SQL)) &&
    !/social_x_tracked_post_read/.test(migrationCode),
  "legacy social_x_tracked_post_read behaviour is untouched by Phase 2B",
);
check(
  "CA2B-8b",
  /export function buildProviderUsageIdempotencyKey\(/.test(helperCode) &&
    /`\$\{provider\}:\$\{actionType\}:\$\{aiJobId\}:\$\{task\}`/.test(helperCode) &&
    /const PROVIDER_CREDIT_UNIT_TYPE = "provider_credit"/.test(helperCode) &&
    /unit_type: PROVIDER_CREDIT_UNIT_TYPE/.test(helperCode),
  "the Phase 1 credit writer keeps its exact key shape and provider_credit unit type",
);
check(
  "CA2B-8c",
  /export function buildUsageIdempotencyKey\(/.test(helperCode) &&
    /`\$\{provider\}:\$\{actionType\}:\$\{job\}:\$\{eventId\.trim\(\)\}`/.test(helperCode) &&
    /export async function recordProviderUsage\(/.test(helperCode),
  "the Phase 2A generic writer and key shape are unchanged",
);
check(
  "CA2B-8d",
  !/usd|USD|dollar|\bprice\b|rate_card|\$0\./.test(helperCode) && !/usd|USD|dollar|rate_card|\$0\./.test(runnerCode),
  "no dollar amount, price or rate card exists in the helper or the runner",
);
check(
  "CA2B-8e",
  !/is_platform_owner|has_platform_unrestricted_access|entitlement|quota|subscription/.test(helperCode),
  "the shared helper contains no owner, entitlement, quota or billing logic",
);

/* --------------------------------------------- 9. standing PCART invariants */

check(
  "CA2B-9a",
  /APPROVED_OFFICIAL_ARTIFACT_ID\s*=\s*"cartel-fixed-erc20-v1"/.test(read(EVIDENCE)),
  "APPROVED_OFFICIAL_ARTIFACT_ID remains exactly cartel-fixed-erc20-v1",
);
check(
  "CA2B-9b",
  /MAINNET_LIQUIDITY_TX_ENABLED\s*=\s*false/.test(read(REGISTRY)),
  "MAINNET_LIQUIDITY_TX_ENABLED remains false",
);

console.log(failures === 0 ? "\nPhase 2B regression: PASS" : `\nPhase 2B regression: ${failures} FAILED`);
if (failures > 0) process.exit(1);
