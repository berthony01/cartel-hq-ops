/**
 * Cartel HQ Guide G2D Pro policy — OFFLINE, source-only audit.
 * Run: node scripts/cartel-guide-g2d-pro-policy-regression.mjs
 * No db, API, network, paid AI, or migrations.
 * This guards the candidate contract only; it is NOT DB/runtime verification.
 */
import { readFileSync } from "node:fs";

const sql = readFileSync("docs/sql/G2D_CARTEL_GUIDE_PRO_100_WORKSPACE_POLICY_CANDIDATE.sql", "utf8");
const commercial = readFileSync("supabase/functions/_shared/commercial-access.ts", "utf8");
const ui = readFileSync("src/lib/cartel-guide-ui-gate.ts", "utf8");
const guideEdge = readFileSync("supabase/functions/cartel-guide/index.ts", "utf8");
let passed = 0, failed = 0;
const failures = [];
function check(name, ok) {
  if (ok) passed++;
  else { failed++; failures.push(name); }
}
check("unapplied draft statement", /UNAPPLIED DRAFT SQL/.test(sql));
check("transaction guard", /^BEGIN;\s*$/m.test(sql) && /^COMMIT;\s*$/m.test(sql));
check("exact Pro 49 plan guard", /code = 'cartel_49'[\s\S]{0,180}price_cents = 4900/.test(sql));
check("free stays zero-cost", /code = 'cartel_free'[\s\S]{0,140}price_cents = 0/.test(sql));
check("free paid Guide entitlement refused", /GUIDE_FREE_MUST_NOT_GET_PAID_CHAT/.test(sql));
check("Pro-only entitlement inserted", /'guide_conversation','feature',true,NULL,'none',false/.test(sql));
check("no grant of Guide to free plan", !/SELECT id,'guide_conversation'[^\n]*[\s\S]*?FROM public\.commercial_plans[\s\S]*?WHERE code='cartel_free'/.test(sql));
check("atomic budget existing function reused", /CREATE OR REPLACE FUNCTION public\.cartel_guide_reserve_budget\(/.test(sql));
check("new workspace request column checked", /ADD COLUMN IF NOT EXISTS customer_workspace_month_requests integer[\s\S]{0,100}CHECK \(customer_workspace_month_requests > 0\)/.test(sql));
check("workspace 100 cap configured only disabled", /SET customer_workspace_month_requests = 100[\s\S]{0,200}WHERE singleton = true AND enabled = false/.test(sql));
check("workspace count variable declared", /v_workspace_requests bigint;/.test(sql));
check("workspace count uses same reservation query", /INTO v_workspace_month, v_workspace_requests FROM public\.cartel_guide_budget_reservations/.test(sql));
check("100 checked before budget insert", sql.indexOf("v_workspace_requests >= v_cfg.customer_workspace_month_requests") <
  sql.indexOf("INSERT INTO public.cartel_guide_budget_reservations"));
check("workspace cap fail-closed when absent", /v_cfg.customer_workspace_month_requests IS NULL/.test(sql));
check("global stop preserved", /v_cfg.emergency_stop IS DISTINCT FROM false/.test(sql));
check("global spend caps preserved", /global_day_cap_micro_usd - v_global_day/.test(sql) &&
 /global_month_cap_micro_usd - v_global_month/.test(sql));
check("per-user budget guard preserved", /v_user_requests >= v_cfg.customer_user_month_requests/.test(sql));
check("atomic advisory lock preserved", /pg_catalog\.pg_advisory_xact_lock\(4127, 2202\)/.test(sql));
check("duplicate request deny preserved", /DUPLICATE_REQUEST/.test(sql));
check("owner still subject to global stop", sql.indexOf("v_cfg.emergency_stop") < sql.indexOf("v_owner := public.has_platform_unrestricted_access"));
check("no paid model quote/activation", !/UPDATE\s+public\.cartel_guide_budget_controls[^;]*?SET\s+(?:enabled|emergency_stop|customer_pilot_enabled)\s*=/.test(sql));
check("commercial allowlist recognizes Guide", commercial.includes('"guide_conversation"'));
check("UI preview still hard OFF", ui.includes("CARTEL_GUIDE_PREVIEW_UI_ENABLED = false"));
check("server Guide still has no Kie network caller", !guideEdge.includes("kie-chat-contract") && !/api\.kie\.ai/.test(guideEdge));
check("migration targets only existing plan/Guide objects", !/CREATE TABLE|CREATE EXTENSION|DROP TABLE|ALTER ROLE|GRANT .* TO anon|INSERT INTO auth\.users/i.test(sql));
console.log("G2D guide Pro policy OFFLINE checks:",passed,"PASS,",failed,"FAIL");
if(failed) { console.error(failures.join("\n")); process.exitCode=1; }
