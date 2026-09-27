/** COMMERCIAL SAFETY C1 — static checks on the staged SQL + guard source. */
import { readFileSync } from "node:fs";
import { execSync } from "node:child_process";

let pass = 0;
const fails: string[] = [];
const check = (n: string, ok: boolean) => (ok ? pass++ : fails.push(n));
const sql = readFileSync("docs/sql/COMMERCIAL_C1_pro_provider_safety_ceilings.sql", "utf8");
const body = sql.split("-- ROLLBACK")[0].replace(/^--.*$/gm, "");
const n = body.replace(/\s+/g, " ");
const guard = readFileSync("supabase/functions/_shared/commercial-access.ts", "utf8");

check("1 exact 100/100/10", /\('concept_generation', 100\), \('static_ai_tools', 100\), \('telegram_motion_prep', 10\)/.test(n));
check("2 quota monthly hidden", /kind = 'quota'/.test(n) && /period = 'calendar_month_utc'/.test(n) && /customer_visible = false/.test(n));
check("3 scoped to cartel_49 v1 only", /p\.code = 'cartel_49' AND p\.version = 1/.test(n));
check("4 free plan untouched", !/cartel_free/.test(body));
check("5 x_reads untouched", !/x_reads/.test(body));
check("6 only one UPDATE, no INSERT/DELETE/DROP", (body.match(/\bUPDATE\b/g) ?? []).length === 1 && !/\b(INSERT|DELETE|DROP|TRUNCATE)\b/.test(body));
check("7 concept counter = usage_ledger sticker_concepts_generate",
  /WHEN 'concept_generation' THEN \( SELECT count\(\*\) FROM public\.usage_ledger u WHERE u\.workspace_id = _workspace_id AND u\.action_type = 'sticker_concepts_generate'/.test(n));
check("8 static tools counter = ai_jobs remove_background",
  /WHEN 'static_ai_tools' THEN \( SELECT count\(\*\) FROM public\.ai_jobs j WHERE j\.workspace_id = _workspace_id AND j\.job_type = 'remove_background'/.test(n));
check("9 motion prep counter = ai_jobs sticker_motion_telegram_prepare",
  /WHEN 'telegram_motion_prep' THEN \( SELECT count\(\*\) FROM public\.ai_jobs j WHERE j\.workspace_id = _workspace_id AND j\.job_type = 'sticker_motion_telegram_prepare'/.test(n));
check("10 existing branches preserved",
  /WHEN 'static_ai_generations'.*job_type = 'sticker_generate'/.test(n) &&
  /WHEN 'motion_ai_generations'.*job_type = 'sticker_motion_generate'/.test(n) &&
  /WHEN 'x_missions' THEN \( SELECT count\(\*\) FROM public\.social_missions m/.test(n) &&
  /WHEN 'telegram_groups' THEN \( SELECT count\(\*\) FROM public\.telegram_group_connections g WHERE g\.workspace_id = _workspace_id\)/.test(n));
check("11 signature/security unchanged", /commercial_feature_usage\(_workspace_id uuid, _feature_key text, _period_start timestamp with time zone, _period_end timestamp with time zone\) RETURNS bigint LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public'/.test(n));
check("12 evaluator not redefined (owner bypass intact)", !/evaluate_commercial_access|is_platform_owner|has_platform_unrestricted_access/.test(body));
check("13 edge guard still fail-closed", /return UNAVAILABLE\(\);[\s\S]*typeof data\.allowed !== "boolean"[\s\S]*return UNAVAILABLE\(\);/.test(guard) && /threw; denying/.test(guard));
check("14 transactional", /^[\s\S]*BEGIN;[\s\S]*COMMIT;/.test(body));

const changed = execSync("git status --porcelain && git diff --name-only HEAD", { encoding: "utf8" });
check("15 no launcher/PCART/chain/liquidity/Stripe/billing files changed",
  !/chain|pcart|launch|liquidity|treasury|stripe|billing|canary/i.test(changed));

console.log(fails.length ? `FAIL — ${fails.length} failed, ${pass} passed` : `PASS — ${pass}/${pass} C1 checks passed`);
for (const f of fails) console.log("  - " + f);
if (fails.length) process.exit(1);
