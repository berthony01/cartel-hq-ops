/**
 * Project Identity Gate A regression.
 *
 * PURE STATIC assertions. No network, no database, no RPC, no wallet, no Edge
 * Function invocation, no deploy. Proves that Gate A introduced exactly one
 * centralized server authority, gated only the Sticker Lab surface in the UI,
 * and enforced provider-spend actions server-side in the three sticker
 * functions — without touching accounting, commercial gating, or PCART.
 */
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";

const MIGRATIONS = "supabase/migrations";
const LAST_GATE_MIGRATION = "20260920054150_5dcb8ca1-aba1-4c9b-995e-cd9ff00da488.sql";
const PHASE1_MIGRATION = "20260922070921_40548af2-4afe-4876-bcaa-f22868f5942d.sql";
const PHASE2B_MIGRATION = "20260922141917_c47c2384-73c4-4bbf-8cc2-495112d64990.sql";
const PHASE2B_DURATION_MIGRATION = "20260922142803_fedec44c-654f-4e1a-a117-30d027601e03.sql";
const IDENTITY_MIGRATION = "20260922161918_ef6e322a-d993-4970-9d48-3b4f93afa222.sql";
const COMMERCIAL_A_MIGRATION = "20260923170038_eaa2a24d-9c13-49c9-9aa3-6a5a8e18c300.sql";

const EDGE_HELPER = "backend-source/edge-functions/_shared/project-identity.ts";
const BROWSER_AUTHORITY = "src/lib/project-identity.ts";
const GATE_COMPONENT = "src/components/cartel/ProjectIdentityGate.tsx";
const APP_SHELL = "src/components/cartel/AppShell.tsx";
const PROFILE_ROUTE = "src/routes/_authenticated/project-profile.tsx";
const ACCOUNTING_HELPER = "backend-source/edge-functions/_shared/usage-accounting.ts";
const DEPLOYABLE_ACCOUNTING_HELPER = "supabase/functions/_shared/usage-accounting.ts";
const REGISTRY = "src/lib/chain-mainnet-registry.ts";
const EVIDENCE = "src/lib/launch-evidence-checks.ts";

const STICKER_FUNCTIONS = [
  "backend-source/edge-functions/sticker-ai/index.ts",
  "backend-source/edge-functions/sticker-concepts/index.ts",
  "backend-source/edge-functions/sticker-motion-ai/index.ts",
];

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

const migrationNames = readdirSync(MIGRATIONS)
  .filter((f) => f.endsWith(".sql"))
  .sort();
const postGate = migrationNames.filter((f) => f > LAST_GATE_MIGRATION);
const migrationSrc = read(`${MIGRATIONS}/${IDENTITY_MIGRATION}`);
const migrationCode = migrationSrc.replace(/^\s*--.*$/gm, "");

/* ------------------------------------------------ 1. authorized migration set */
check(
  "PIG-1a",
  migrationNames.length === 89,
  `exactly 89 migration files exist (found ${migrationNames.length})`,
);
check(
  "PIG-1b",
  postGate.length === 5 &&
    postGate[0] === PHASE1_MIGRATION &&
    postGate[1] === PHASE2B_MIGRATION &&
    postGate[2] === PHASE2B_DURATION_MIGRATION &&
    postGate[3] === IDENTITY_MIGRATION &&
    postGate[4] === COMMERCIAL_A_MIGRATION,
  `the only post-gate migrations are Cost Accounting Phase 1, the two Phase 2B mission-safety migrations and the Project Identity Gate A function-only migration and the Commercial Foundation A migration (found: ${postGate.join(", ") || "none"})`,
);
check(
  "PIG-1c",
  !/\b(CREATE|ALTER|DROP)\s+TABLE\b/i.test(migrationCode) &&
    !/\bCREATE\s+(UNIQUE\s+)?INDEX\b/i.test(migrationCode) &&
    !/\b(CREATE|ALTER|DROP)\s+POLICY\b/i.test(migrationCode) &&
    !/\bROW LEVEL SECURITY\b/i.test(migrationCode) &&
    !/\b(INSERT|UPDATE|DELETE|TRUNCATE)\s+/i.test(migrationCode) &&
    !/\bCREATE\s+TRIGGER\b/i.test(migrationCode),
  "the migration is function-only: no table, column, index, policy, RLS, trigger or data change",
);

/* ------------------------------------------- 2. the centralized SQL authority */
check(
  "PIG-2a",
  /CREATE OR REPLACE FUNCTION public\.can_use_project_tools\(_workspace_id uuid, _user_id uuid DEFAULT auth\.uid\(\)\)/.test(
    migrationCode,
  ) && /RETURNS boolean/i.test(migrationCode),
  "can_use_project_tools(_workspace_id uuid, _user_id uuid DEFAULT auth.uid()) RETURNS boolean",
);
check(
  "PIG-2b",
  /\bSTABLE\b/.test(migrationCode) &&
    /\bSECURITY DEFINER\b/.test(migrationCode) &&
    /SET search_path = public/.test(migrationCode),
  "the function is STABLE SECURITY DEFINER with search_path pinned to public",
);
check(
  "PIG-2c",
  /REVOKE ALL ON FUNCTION public\.can_use_project_tools\(uuid, uuid\) FROM PUBLIC/.test(migrationCode) &&
    /REVOKE ALL ON FUNCTION public\.can_use_project_tools\(uuid, uuid\) FROM anon/.test(migrationCode) &&
    /GRANT EXECUTE ON FUNCTION public\.can_use_project_tools\(uuid, uuid\) TO authenticated/.test(migrationCode) &&
    /GRANT EXECUTE ON FUNCTION public\.can_use_project_tools\(uuid, uuid\) TO service_role/.test(migrationCode) &&
    /GRANT EXECUTE ON FUNCTION public\.can_use_project_tools\(uuid, uuid\) TO postgres/.test(migrationCode),
  "PUBLIC and anon are revoked; authenticated, service_role and postgres are granted",
);
check(
  "PIG-2d",
  /_workspace_id IS NULL OR _effective IS NULL[\s\S]{0,80}RETURN false/i.test(migrationCode),
  "a NULL workspace or NULL effective user returns false",
);
check(
  "PIG-2e",
  /_caller IS NOT NULL AND _user_id IS NOT NULL AND _user_id <> _caller[\s\S]{0,80}RETURN false/i.test(
    migrationCode,
  ),
  "an authenticated direct caller may only test itself",
);

/* ------------------------- 3. owner bypass precedes the profile requirement */
const unrestrictedAt = migrationCode.indexOf("has_platform_unrestricted_access");
const membershipAt = migrationCode.indexOf("is_workspace_member");
const profileAt = migrationCode.indexOf("project_profiles");
check(
  "PIG-3a",
  unrestrictedAt > -1 &&
    membershipAt > unrestrictedAt &&
    profileAt > unrestrictedAt,
  "has_platform_unrestricted_access is evaluated BEFORE the membership and profile requirements",
);
check(
  "PIG-3b",
  /IF public\.has_platform_unrestricted_access\(_effective\) THEN\s*RETURN true;/.test(migrationCode),
  "unrestricted access short-circuits to true",
);
check(
  "PIG-3c",
  !/@|berthonyxyz|gmail/i.test(migrationCode),
  "no email literal anywhere in the authority",
);
check(
  "PIG-3d",
  /IF NOT public\.is_workspace_member\(_workspace_id, _effective\) THEN\s*RETURN false;/.test(migrationCode),
  "the ordinary path requires workspace membership",
);

/* ------------------------------ 4. minimum identity is name + slug ONLY */
check(
  "PIG-4a",
  /char_length\(btrim\(p\.project_name\)\) >= 1/.test(migrationCode) &&
    /p\.public_slug ~ '\^\[a-z0-9\]\+\(\?:-\[a-z0-9\]\+\)\*\$'/.test(migrationCode) &&
    /char_length\(p\.public_slug\) >= 2/.test(migrationCode) &&
    /char_length\(p\.public_slug\) <= 64/.test(migrationCode),
  "minimum identity is a non-empty project_name plus a canonical public_slug",
);
check(
  "PIG-4b",
  !/discovery_status|published/i.test(migrationCode),
  "publication status is never required — a draft profile satisfies the gate",
);
check(
  "PIG-4c",
  !/ticker|primary_chain|contract|token|launch|logo_asset|website_url|telegram|twitter|description/i.test(
    migrationCode,
  ),
  "no ticker, chain, token, contract, launch, logo, links or description requirement",
);
check(
  "PIG-4d",
  /p\.workspace_id = _workspace_id/.test(migrationCode),
  "the gate is workspace-scoped, never user-global",
);

/* --------------------------------------------- 5. shared Edge helper contract */
const edgeHelper = read(EDGE_HELPER);
const edgeHelperCode = code(edgeHelper);
check(
  "PIG-5a",
  /export const PROJECT_IDENTITY_REQUIRED = "PROJECT_IDENTITY_REQUIRED"/.test(edgeHelperCode) &&
    /Create Project Identity first\. Token launch is not required\./.test(edgeHelper),
  "the helper exports the stable PROJECT_IDENTITY_REQUIRED code and its guidance copy",
);
check(
  "PIG-5b",
  /export async function requireProjectToolAccess\(/.test(edgeHelperCode) &&
    /rpc\("can_use_project_tools", \{\s*_workspace_id:[\s\S]{0,80}_user_id:/.test(edgeHelperCode),
  "requireProjectToolAccess calls can_use_project_tools with an explicit workspace and user",
);
check(
  "PIG-5c",
  /status: 403/.test(edgeHelperCode),
  "a denial maps to HTTP 403",
);
check(
  "PIG-5d",
  /=== true/.test(edgeHelperCode) && /denied/.test(edgeHelperCode),
  "an RPC error or any non-true answer fails closed",
);
check(
  "PIG-5e",
  !/stripe|subscription|invoice|checkout|payment_intent|plan_entitlement|quota|credit|price/i.test(
    edgeHelperCode,
  ) &&
    !/usage_ledger|recordProvider/.test(edgeHelperCode) &&
    !/fetch\(/.test(edgeHelperCode),
  "the helper performs no commercial, accounting or provider work",
);

/* ------------------------- 6. server enforcement in the provider functions */
for (const file of STICKER_FUNCTIONS) {
  const name = file.split("/").slice(-2, -1)[0];
  const src = read(file);
  const srcCode = code(src);
  check(
    `PIG-6-${name}-import`,
    /import \{ requireProjectToolAccess \} from "\.\.\/_shared\/project-identity\.ts";/.test(srcCode),
    `${name} imports the single shared Gate A helper`,
  );
  check(
    `PIG-6-${name}-membership`,
    /workspace_members/.test(srcCode),
    `${name} still performs its own workspace membership check`,
  );
  check(
    `PIG-6-${name}-denial`,
    /PROJECT_IDENTITY_DENIAL_BODY|access\.body|conceptAccess\.body/.test(srcCode),
    `${name} returns the stable shared denial body`,
  );
  check(
    `PIG-6-${name}-accounting`,
    /recordProvider(CreditUsage|Usage)/.test(srcCode),
    `${name} still records provider usage accounting unchanged`,
  );
  check(
    `PIG-6-${name}-no-commerce`,
    !/stripe|subscription|invoice|checkout|payment_intent|plan_entitlement|quota_remaining/i.test(srcCode),
    `${name} introduces no subscription, plan or quota gating`,
  );
  check(
    `PIG-6-${name}-no-email`,
    !/berthonyxyz|gmail/i.test(srcCode),
    `${name} contains no hardcoded owner email`,
  );
}

/** Gate placement: every gated call site sits after membership, before spend. */
const stickerAi = code(read(STICKER_FUNCTIONS[0]!));
const stickerConcepts = code(read(STICKER_FUNCTIONS[1]!));
const stickerMotion = code(read(STICKER_FUNCTIONS[2]!));

check(
  "PIG-6a",
  (stickerAi.match(/await identityDenial\(/g) ?? []).length === 3,
  "sticker-ai gates start/candidate/variation, review retry and sync — every provider-spending action",
);
check(
  "PIG-6b",
  (stickerMotion.match(/await identityDenial\(/g) ?? []).length === 3,
  "sticker-motion-ai gates set_current, start and sync",
);
check(
  "PIG-6c",
  /const conceptAccess = await requireProjectToolAccess\(admin, user\.id, workspaceId\);/.test(
    stickerConcepts,
  ) &&
    stickerConcepts.indexOf("conceptAccess") < stickerConcepts.indexOf("await fetch("),
  "sticker-concepts gates before its single billable provider request",
);
check(
  "PIG-6d",
  stickerAi.indexOf('action === "config"') < stickerAi.indexOf("await identityDenial(") &&
    stickerMotion.indexOf('action === "config"') < stickerMotion.indexOf("await identityDenial("),
  "the read-only `config` action stays ungated so the UI can still render",
);

/* ------------------------------------------------- 7. browser-side authority */
const browserSrc = read(BROWSER_AUTHORITY);
const browserCode = code(browserSrc);
check(
  "PIG-7a",
  /supabase\.rpc\("can_use_project_tools"/.test(browserCode),
  "the browser asks the server authority instead of re-implementing the predicate",
);
check(
  "PIG-7b",
  !/project_profiles/.test(browserCode),
  "the browser never duplicates the minimum-identity profile predicate",
);
check(
  "PIG-7c",
  /export function isSafeInternalRedirect/.test(browserCode) &&
    /startsWith\("\/\/"\)/.test(browserCode) &&
    /\^\\\/\[a-z0-9\+\.-\]\*:/.test(browserCode),
  "only a single-slash internal path is accepted as a return destination",
);

/* ------------------------------------- 8. UI gate scope is Gate A + Gate B */
const shellSrc = read(APP_SHELL);
const shellCode = code(shellSrc);
const gatedPathFn = shellCode.slice(
  shellCode.indexOf("isProjectIdentityGatedPath"),
  shellCode.indexOf("isProjectIdentityGatedPath") + 400,
);
check(
  "PIG-8a",
  /pathname === "\/sticker-lab"/.test(gatedPathFn) &&
    /pathname\.startsWith\("\/sticker-lab\/"\)/.test(gatedPathFn) &&
    /pathname === "\/telegram"/.test(gatedPathFn) &&
    /pathname === "\/distribution"/.test(gatedPathFn),
  "the UI gate matches exactly /sticker-lab(+descendants), /telegram and /distribution",
);
check(
  "PIG-8b",
  !/\/launch-control|\/watchlist|\/project-profile|\/brand-kit|\/assets|\/settings|\/admin|\/analytics|\/operations|\/operatives|\/cartel-shield|\/chain-launcher|\/mainnet-canary/.test(
    gatedPathFn,
  ),
  "no other surface is Project Identity gated",
);
check(
  "PIG-8c",
  /<ProjectIdentityGate>/.test(shellSrc),
  "the shell renders the gate around gated routes only",
);

const gateSrc = read(GATE_COMPONENT);
const gateCode = code(gateSrc);
check(
  "PIG-8d",
  /Create your Project Identity first/.test(gateSrc) &&
    /Create Project Identity/.test(gateSrc) &&
    /optional and is not required/.test(gateSrc),
  "the guided state explains that a token launch is optional",
);
check(
  "PIG-8e",
  /safeInternalRedirect\(/.test(gateCode) && /to="\/project-profile"/.test(gateCode),
  "the CTA routes to /project-profile preserving a validated internal destination",
);
check(
  "PIG-8f",
  !/berthonyxyz|gmail|is_platform_owner/.test(gateCode),
  "the component derives the owner bypass only from the server authority",
);

/* --------------------------------------------- 9. Project Profile return flow */
const profileSrc = read(PROFILE_ROUTE);
const profileCode = code(profileSrc);
check(
  "PIG-9a",
  /validateSearch:/.test(profileCode) && /safeInternalRedirect\(search\["redirect"\]\)/.test(profileCode),
  "the project-profile route validates the optional internal redirect search param",
);
check(
  "PIG-9b",
  /const wasNew = !profile;/.test(profileCode) && /if \(wasNew && destination\)/.test(profileCode),
  "only a NEWLY created profile auto-returns to the preserved destination",
);
check(
  "PIG-9c",
  /projectToolAccessQueryKey\(workspaceId\)/.test(profileCode),
  "saving the identity invalidates the workspace-scoped gate answer",
);

/* ------------------------------- 10. accounting and PCART remain untouched */
check(
  "PIG-10a",
  read(ACCOUNTING_HELPER) === read(DEPLOYABLE_ACCOUNTING_HELPER),
  "the accounting helper and its deployable mirror remain byte-for-byte identical",
);
check(
  "PIG-10b",
  /export const APPROVED_OFFICIAL_ARTIFACT_ID = "cartel-fixed-erc20-v1"/.test(read(EVIDENCE)),
  "the approved PCART official artifact is unchanged",
);
check(
  "PIG-10c",
  /MAINNET_LIQUIDITY_TX_ENABLED\s*=\s*false/.test(read(REGISTRY)),
  "MAINNET_LIQUIDITY_TX_ENABLED remains false",
);

/* --------------------------- 11. no commercial gating introduced anywhere */
const authoredGateFiles = [EDGE_HELPER, BROWSER_AUTHORITY, GATE_COMPONENT];
check(
  "PIG-11a",
  authoredGateFiles.every(
    (f) =>
      !/stripe|subscription|invoice|checkout|payment_intent|plan_entitlement|quota|credit_balance|trial/i.test(
        code(read(f)),
      ),
  ),
  "Gate A introduces no subscription, plan, quota, payment or trial logic",
);
check(
  "PIG-11b",
  walk("backend-source/edge-functions/_shared").filter((f) => f.endsWith("project-identity.ts"))
    .length === 1,
  "exactly one shared Edge identity helper exists",
);

console.log(failures === 0 ? "\nALL CHECKS PASSED" : `\n${failures} CHECK(S) FAILED`);
process.exit(failures === 0 ? 0 : 1);
