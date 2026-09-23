/**
 * Cost Accounting — Phase 2A regression.
 *
 * PURE STATIC assertions. No network, no database, no RPC, no wallet, no
 * Edge Function invocation, no deploy. Proves that Phase 2A added truthful
 * raw-usage accounting for Kie Gemini concepts, fal.ai background removal and
 * CloudConvert normalization on the EXISTING Phase 1 schema, changed nothing
 * about provider behaviour, and activated nothing else.
 */
import { execFileSync } from "node:child_process";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";

const START_GATE = "aa9789f9c94bb48679574d31fbe9c79da19bb859";
const MIGRATIONS = "supabase/migrations";
const PHASE1_MIGRATION = "20260922070921_40548af2-4afe-4876-bcaa-f22868f5942d.sql";
const LAST_GATE_MIGRATION = "20260920054150_5dcb8ca1-aba1-4c9b-995e-cd9ff00da488.sql";

const HELPER = "backend-source/edge-functions/_shared/usage-accounting.ts";
const HELPER_MIRROR = "supabase/functions/_shared/usage-accounting.ts";
const CONCEPTS = "backend-source/edge-functions/sticker-concepts/index.ts";
const MOTION_TG = "backend-source/edge-functions/sticker-motion-telegram/index.ts";
const STICKER_AI = "backend-source/edge-functions/sticker-ai/index.ts";
const MOTION_AI = "backend-source/edge-functions/sticker-motion-ai/index.ts";
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
const conceptsSrc = read(CONCEPTS);
const conceptsCode = code(conceptsSrc);
const motionTgSrc = read(MOTION_TG);
const motionTgCode = code(motionTgSrc);

/* ------------------------------------------------------- 1. no schema change */

const migrationNames = walk(MIGRATIONS).map((f) => f.split("/").pop() ?? f).sort();
const postGate = migrationNames.filter((f) => f > LAST_GATE_MIGRATION);
check(
  "CA2A-1a",
  migrationNames.length === 89,
  "migration count is exactly 89 — Phase 2A itself adds no migration",
);
check(
  "CA2A-1b",
  postGate.length === 5 &&
    postGate[0] === PHASE1_MIGRATION &&
    postGate[1] === "20260922141917_c47c2384-73c4-4bbf-8cc2-495112d64990.sql" &&
    postGate[2] === "20260922142803_fedec44c-654f-4e1a-a117-30d027601e03.sql" &&
    postGate[3] === "20260922161918_ef6e322a-d993-4970-9d48-3b4f93afa222.sql" &&
    postGate[4] === "20260923170038_eaa2a24d-9c13-49c9-9aa3-6a5a8e18c300.sql",
  `the post-gate migrations are exactly Phase 1, the two Phase 2B mission-safety migrations and the Project Identity Gate A function-only migration and the Commercial Foundation A migration (found: ${postGate.join(", ") || "none"})`,
);

/* -------------------------------------------------- 2. shared generic writer */

// Phase 2B deployment-parity re-pin: authoritative source in backend-source
// plus exactly ONE byte-for-byte identical deployable mirror.
const helperCopies = walk("backend-source/edge-functions")
  .concat(walk("src"))
  .concat(walk("supabase/functions"))
  .filter((f) => /usage-accounting\.ts$/.test(f))
  .sort();
check(
  "CA2A-2a",
  helperCopies.length === 2 &&
    helperCopies.includes(HELPER) &&
    helperCopies.includes(HELPER_MIRROR) &&
    readFileSync(HELPER).equals(readFileSync(HELPER_MIRROR)),
  `the shared accounting helper still exists at exactly ${HELPER} (authoritative) plus exactly one byte-for-byte identical deployable mirror at ${HELPER_MIRROR}, and nowhere else`,
);
check(
  "CA2A-2b",
  /export async function recordProviderUsage\(/.test(helperCode) &&
    /unitType: string;/.test(helperCode) &&
    /eventId: string;/.test(helperCode) &&
    /aiJobId: string \| null;/.test(helperCode),
  "a generic recordProviderUsage writer exists taking unitType, eventId and a nullable aiJobId",
);
check(
  "CA2A-2c",
  /\.upsert\(\s*row,\s*\{\s*onConflict:\s*"idempotency_key",\s*ignoreDuplicates:\s*true\s*\}\s*\)/.test(
    helperSrc,
  ) && !/\.onConflict\(/.test(helperSrc),
  "the shared writer still uses the duplicate-safe Supabase upsert on the existing idempotency index",
);
check(
  "CA2A-2d",
  /return `\$\{provider\}:\$\{actionType\}:\$\{job\}:\$\{eventId\.trim\(\)\}`/.test(helperCode) &&
    /"no-job"/.test(helperCode),
  "the generic key is provider:action:ai_job_id-or-no-job:event_id",
);
check(
  "CA2A-2e",
  /!Number\.isFinite\(input\.units\) \|\| input\.units < 0/.test(helperCode),
  "non-finite and negative units are skipped, never recorded",
);
check(
  "CA2A-2f",
  /currency: null/.test(helperCode) &&
    /pricing_source: null/.test(helperCode) &&
    /pricing_version: null/.test(helperCode) &&
    /pricing_effective_at: null/.test(helperCode) &&
    /provider_cost: null/.test(helperCode) &&
    /internal_cost: null/.test(helperCode),
  "currency, every pricing_* field and both cost columns stay null for every writer",
);
check(
  "CA2A-2g",
  /console\.error\("usage-accounting/.test(helperCode) && !/throw /.test(helperCode),
  "non-duplicate accounting errors are logged and swallowed — accounting never throws into a provider flow",
);
check(
  "CA2A-2h",
  !/owner|is_platform_owner|unrestricted|plan|entitlement|quota|subscription|stripe/i.test(helperCode),
  "the helper still contains no owner bypass and no plan/entitlement/quota/billing logic",
);

/* ------------------------------------------- 3. Phase 1 compatibility intact */

check(
  "CA2A-3a",
  /export async function recordProviderCreditUsage\(/.test(helperCode) &&
    /return `\$\{provider\}:\$\{actionType\}:\$\{aiJobId\}:\$\{task\}`/.test(helperCode) &&
    /providerTaskId[\s\S]*?"job"/.test(helperCode),
  "recordProviderCreditUsage still exists and preserves the exact Phase 1 key shape",
);
check(
  "CA2A-3b",
  /PROVIDER_CREDIT_UNIT_TYPE = "provider_credit"/.test(helperCode) &&
    /unit_type: PROVIDER_CREDIT_UNIT_TYPE/.test(helperCode),
  "the Phase 1 credit path still records unit_type='provider_credit'",
);
/**
 * Re-pinned for Project Identity Gate A. These two functions are no longer
 * byte-identical to the Phase 2A start gate, because Gate A legitimately added
 * server-side identity enforcement. The Phase 2A invariant that still matters
 * is that NOTHING was removed and every added line is Gate A identity code —
 * so no accounting, provider, idempotency or membership line changed.
 */
const IDENTITY_GATE_ADDITION =
  /^(\s*)(\/\/.*|\/\*\*?.*|\*.*|\*\/|import \{ requireProjectToolAccess \} from "\.\.\/_shared\/project-identity\.ts";|const identityDenial = async \(workspaceId: string\) => \{|const access = await requireProjectToolAccess\(admin, user\.id, workspaceId\);|return access\.allowed \? null : respond\(access\.body, access\.status\);|\};|const \w*[Ii]dentityBlocked = await identityDenial\(.*\);|if \(\w*[Ii]dentityBlocked\) return \w*[Ii]dentityBlocked;|)$/;
for (const [label, path] of [["sticker-ai", STICKER_AI], ["sticker-motion-ai", MOTION_AI]] as const) {
  const gateLines = execFileSync("git", ["show", `${START_GATE}:${path}`], {
    encoding: "utf8",
  }).split("\n");
  const nowLines = read(path).split("\n");
  // Every gate-era line must still be present, in order, unmodified.
  let cursor = 0;
  const added: string[] = [];
  for (const line of nowLines) {
    if (cursor < gateLines.length && line === gateLines[cursor]) cursor += 1;
    else added.push(line);
  }
  check(
    `CA2A-3c:${label}`,
    cursor === gateLines.length,
    `${label} still contains every Phase 2A start-gate line unmodified and in order`,
  );
  check(
    `CA2A-3d:${label}`,
    added.every((l) => IDENTITY_GATE_ADDITION.test(l)),
    `${label} adds only Project Identity Gate A enforcement lines (offending: ${
      added.filter((l) => !IDENTITY_GATE_ADDITION.test(l)).join(" | ") || "none"
    })`,
  );
}

/* ----------------------------------------------------- 4. sticker-concepts */

check(
  "CA2A-4a",
  /import \{ recordProviderUsage \} from "\.\.\/_shared\/usage-accounting\.ts";/.test(conceptsCode),
  "sticker-concepts imports the shared generic writer",
);
check(
  "CA2A-4b",
  /actionType: "sticker_concepts_generate"/.test(conceptsCode) &&
    /provider: "kie"/.test(conceptsCode) &&
    /providerModel: CHAT_MODEL/.test(conceptsCode) &&
    /const CHAT_MODEL = "gemini-2\.5-flash";/.test(conceptsCode),
  "concepts records exactly kie / gemini-2.5-flash / sticker_concepts_generate",
);
check(
  "CA2A-4c",
  /unitType: totalTokens == null \? "api_request" : "token"/.test(conceptsCode) &&
    /units: totalTokens \?\? 1/.test(conceptsCode),
  "concepts records unit_type='token' with the exact total_tokens, falling back to api_request=1",
);
check(
  "CA2A-4d",
  /payload\["id"\]/.test(conceptsCode) && /usageObj\?\.\["total_tokens"\]/.test(conceptsCode),
  "concepts reads payload.id and payload.usage.total_tokens",
);
check(
  "CA2A-4e",
  /const serverInvocationId = crypto\.randomUUID\(\);/.test(conceptsCode) &&
    /eventId: providerResponseId \?\? serverInvocationId/.test(conceptsCode) &&
    /identity_source: providerResponseId \? "provider_response_id" : "server_invocation_id"/.test(
      conceptsCode,
    ),
  "concepts has a server invocation UUID fallback and states which identity source was used",
);
{
  const fetchIdx = conceptsCode.indexOf("await fetch(`${KIE_BASE}${CHAT_PATH}`");
  const uuidIdx = conceptsCode.indexOf("const serverInvocationId = crypto.randomUUID();");
  const notOkIdx = conceptsCode.indexOf("if (!response.ok)");
  const recordIdx = conceptsCode.indexOf("await recordProviderUsage(admin, {");
  const choicesIdx = conceptsCode.indexOf('const choices = payload["choices"]');
  check(
    "CA2A-4f",
    uuidIdx > 0 && fetchIdx > uuidIdx,
    "the server invocation id is minted BEFORE the outbound provider request",
  );
  check(
    "CA2A-4g",
    recordIdx > notOkIdx && notOkIdx > 0 && choicesIdx > recordIdx,
    "usage is recorded after the non-2xx guard and BEFORE downstream choices/content validation",
  );
}
check(
  "CA2A-4h",
  !/provider_credit/.test(conceptsCode),
  "concepts never records provider_credit — Kie chat completions report no credits",
);
{
  const gate = execFileSync("git", ["show", `${START_GATE}:${CONCEPTS}`], { encoding: "utf8" });
  const stable = (src: string) =>
    code(src)
      .split("\n")
      .filter((l) => l.trim())
      .join("\n");
  const gateStable = stable(gate);
  check(
    "CA2A-4i",
    [
      'const CHAT_PATH = "/gemini-2.5-flash/v1/chat/completions";',
      'const KIE_BASE = "https://api.kie.ai";',
      "stream: false,",
      "include_thoughts: false,",
      'json_schema: { name: "sticker_concepts", strict: true, schema },',
      'respond({ concepts, model: CHAT_MODEL, usage });',
    ].every((needle) => gateStable.includes(needle) && stable(conceptsSrc).includes(needle)),
    "the concepts endpoint, model, request body and UI response contract are unchanged",
  );
}

/* ------------------------------------------------------------- 5. fal.ai */

check(
  "CA2A-5a",
  /import \{ recordProviderUsage \} from "\.\.\/_shared\/usage-accounting\.ts";/.test(motionTgCode),
  "sticker-motion-telegram imports the shared generic writer",
);
check(
  "CA2A-5b",
  /actionType: "motion_telegram_background_removal"/.test(motionTgCode) &&
    /provider: "fal"/.test(motionTgCode) &&
    /providerModel: FAL_MODEL/.test(motionTgCode) &&
    /const FAL_MODEL = "veed\/video-background-removal\/fast";/.test(motionTgCode) &&
    /unitType: "api_request",\n\s+provider: "fal"/.test(motionTgCode) &&
    /units: 1,\n\s+unitType: "api_request",\n\s+provider: "fal"/.test(motionTgCode),
  "fal records exactly fal / veed video-background-removal / api_request with units=1",
);
check(
  "CA2A-5c",
  /eventId: requestId,/.test(motionTgCode) && /metadata: \{ fal_request_id: requestId \}/.test(motionTgCode),
  "the fal event id is the fal request id and is recorded in metadata",
);
check(
  "CA2A-5d",
  !/credits|seconds|frames|duration_seconds/.test(
    motionTgCode.slice(
      motionTgCode.indexOf('actionType: "motion_telegram_background_removal"'),
      motionTgCode.indexOf('metadata: { fal_request_id: requestId }') + 60,
    ),
  ),
  "the fal row fabricates no credits, seconds or frames",
);
{
  const retryIdx = motionTgCode.indexOf('if (action === "retry_normalization")');
  const falIdx = motionTgCode.indexOf('actionType: "motion_telegram_background_removal"');
  const falCount = motionTgCode.split('actionType: "motion_telegram_background_removal"').length - 1;
  check(
    "CA2A-5e",
    retryIdx > 0 && falCount === 1 && falIdx < retryIdx,
    "there is exactly ONE fal accounting site and it is absent from the retry_normalization path",
  );
}

/* ------------------------------------------------------- 6. CloudConvert */

check(
  "CA2A-6a",
  /actionType: "motion_telegram_normalize"/.test(motionTgCode) &&
    /provider: "cloudconvert"/.test(motionTgCode) &&
    /providerModel: NORMALIZE_CONTRACT_VERSION/.test(motionTgCode) &&
    /const NORMALIZE_CONTRACT_VERSION = "telegram-motion-v1";/.test(motionTgCode),
  "CloudConvert records exactly cloudconvert / telegram-motion-v1 / motion_telegram_normalize",
);
check(
  "CA2A-6b",
  /const creditsReported = reportedTaskCredits\.length > 0;/.test(motionTgCode) &&
    /units: creditsReported \? creditsTotal : 1/.test(motionTgCode) &&
    /unitType: creditsReported \? "provider_credit" : "api_request"/.test(motionTgCode),
  "provider_credit is used only when task credits are actually reported, otherwise api_request=1",
);
check(
  "CA2A-6c",
  /\.filter\(\(t\) => t\.credits != null && t\.credits >= 0\)/.test(motionTgCode) &&
    !/creditsTotal \|\| null/.test(motionTgCode),
  "a genuine reported 0 is preserved as 0 and is not coerced to unreported/null in the ledger",
);
check(
  "CA2A-6d",
  /eventId: ccJobId,/.test(motionTgCode) &&
    /cloudconvert_job_id: ccJobId,/.test(motionTgCode) &&
    /cloudconvert_tag:/.test(motionTgCode) &&
    /task_credits: reportedTaskCredits,/.test(motionTgCode) &&
    /credits_reported: creditsReported,/.test(motionTgCode),
  "the CloudConvert event id is the actual CloudConvert job id, with tag, per-task breakdown and credits_reported in metadata",
);
{
  const gate = execFileSync("git", ["show", `${START_GATE}:${MOTION_TG}`], { encoding: "utf8" });
  const unchanged = [
    "const FFMPEG_ARGUMENTS =",
    '"import-motion": { operation: "import/url", url: alphaUrl, filename: "motion-alpha.webm" }',
    "const tag = `cartelhq-motion-telegram-${aiJobId}`;",
    '"X-Fal-No-Retry": "1",',
    'output_codec: "vp9",',
    "const NORMALIZATION_RETRYABLE_CODES = [",
    "cloudconvert_credits: ccCredits || null,",
  ];
  check(
    "CA2A-6e",
    unchanged.every((needle) => gate.includes(needle) && motionTgSrc.includes(needle)),
    "the fal payload/no-retry policy, ffmpeg contract, task structure, tag, retry eligibility and legacy cloudconvert_credits semantics are unchanged",
  );
}

/* ------------------------------------------------------- 7. key separation */

check(
  "CA2A-7",
  /provider: "fal"/.test(motionTgCode) &&
    /provider: "cloudconvert"/.test(motionTgCode) &&
    "fal:motion_telegram_background_removal" !== "cloudconvert:motion_telegram_normalize",
  "fal and CloudConvert keys differ in both the provider and action segments, so two rows for one ai_job cannot collide",
);

/* ------------------------------------------------ 8. non-activation tripwires */

for (const [label, src] of [
  ["helper", helperCode],
  ["concepts", conceptsCode],
  ["motion-telegram", motionTgCode],
] as const) {
  check(
    `CA2A-8a:${label}`,
    !/\$\s?\d|\busd\b|price|rate_card|cost_per|dollar/i.test(
      src.replace(/provider_cost|internal_cost|pricing_source|pricing_version|pricing_effective_at/g, ""),
    ),
    `${label} contains no hardcoded dollar price or provider rate card`,
  );
}
check(
  "CA2A-8b",
  !/is_platform_owner|unrestricted_access|entitlement|quota|subscription|stripe/i.test(
    conceptsCode + motionTgCode,
  ),
  "no owner/plan/entitlement/quota/billing bypass in either instrumented function",
);
check(
  "CA2A-8c",
  /export const APPROVED_OFFICIAL_ARTIFACT_ID = "cartel-fixed-erc20-v1" as const;/.test(read(EVIDENCE)),
  "APPROVED_OFFICIAL_ARTIFACT_ID remains exactly cartel-fixed-erc20-v1",
);
check(
  "CA2A-8d",
  /MAINNET_LIQUIDITY_TX_ENABLED = false as const/.test(read(REGISTRY)),
  "MAINNET_LIQUIDITY_TX_ENABLED remains false",
);

console.log(
  failures === 0
    ? "\nCost Accounting Phase 2A regression: ALL CHECKS PASSED"
    : `\nCost Accounting Phase 2A regression: ${failures} CHECK(S) FAILED`,
);
if (failures > 0) process.exit(1);
