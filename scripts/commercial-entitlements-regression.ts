/**
 * COMMERCIAL FOUNDATION A — repo-only regression.
 * Zero network, zero database. Reads migration files from disk only.
 */
import { readdirSync, readFileSync } from "node:fs";

const MIGRATIONS = "supabase/migrations";
const POST_GATE = [
  "20260922070921_40548af2-4afe-4876-bcaa-f22868f5942d.sql",
  "20260922141917_c47c2384-73c4-4bbf-8cc2-495112d64990.sql",
  "20260922142803_fedec44c-654f-4e1a-a117-30d027601e03.sql",
  "20260922161918_ef6e322a-d993-4970-9d48-3b4f93afa222.sql",
  "20260923170038_eaa2a24d-9c13-49c9-9aa3-6a5a8e18c300.sql",
  "20260924005521_b9fca846-4db3-4e8f-bf91-bdb4bd863228.sql",
  "20260924021801_e48c0c41-9053-4f77-a267-04fbba8d206d.sql",
  "20260927013341_1f8494c2-8155-4e9d-832a-4e387a8f56b4.sql",  "20260927141715_pcart_l3_rehearsal_and_mainnet_isolation.sql",
  "20260927170206_commercial_c1_pro_provider_safety_ceilings.sql",
  "20260927171231_commercial_c2_self_service_workspace.sql",
  "20260927173127_commercial_c3a_usage_free_record_fix.sql",
  "20260928110628_b2fff4d6-4c76-4505-8980-6e527123a82b.sql",
  "20260928170228_partner_program_phase_1a_foundation.sql",
  "20260928170613_partner_program_phase_1a_rls_fk_hardening.sql",
  "20260928170917_partner_program_phase_1a_new_workspace_attribution.sql",
];
const COMMERCIAL = POST_GATE[4];
const LEAST_PRIVILEGE = POST_GATE[7];

let failed = 0;
let passed = 0;
function check(id: string, ok: boolean, detail = "") {
  if (ok) passed++;
  else {
    failed++;
    console.error(`FAIL ${id}${detail ? ` — ${detail}` : ""}`);
  }
}

const migrations = readdirSync(MIGRATIONS).filter((f) => f.endsWith(".sql")).sort();
check("C-1.1 migration count exactly 100", migrations.length === 100, String(migrations.length));
const postGate = migrations.filter((f) => f >= "20260922");
check("C-1.2 exact sixteen authorized post-gate migrations", JSON.stringify(postGate) === JSON.stringify(POST_GATE), postGate.join(","));
check("C-1.3 commercial A, then Commercial Foundation B, then the Stripe/Free billing migration, then least-privilege, then authorized later migrations", migrations[migrations.length - 12] === COMMERCIAL && migrations[migrations.length - 11] === POST_GATE[5] && migrations[migrations.length - 10] === POST_GATE[6] && migrations[migrations.length - 9] === LEAST_PRIVILEGE && migrations[migrations.length - 1] === POST_GATE[15]);

const raw = readFileSync(`${MIGRATIONS}/${COMMERCIAL}`, "utf8");
const sql = raw.replace(/^\s*--.*$/gm, "");
const norm = sql.replace(/\s+/g, " ");

/* 2. tables */
for (const t of ["commercial_plans", "commercial_plan_entitlements", "workspace_commercial_assignments"]) {
  check(`C-2 ${t} created`, norm.includes(`CREATE TABLE public.${t} (`));
  check(`C-2 ${t} RLS`, norm.includes(`ALTER TABLE public.${t} ENABLE ROW LEVEL SECURITY`));
  check(`C-2 ${t} authenticated SELECT only`, norm.includes(`GRANT SELECT ON public.${t} TO authenticated;`));
  check(`C-2 ${t} revoke anon`, norm.includes(`REVOKE ALL ON public.${t} FROM PUBLIC, anon, authenticated;`));
  check(`C-2 ${t} service_role`, norm.includes(`GRANT ALL ON public.${t} TO service_role;`));
}
check("C-2.1 exactly three tables", (norm.match(/CREATE TABLE/g) ?? []).length === 3);
check("C-2.2 no anon grant anywhere", !/TO [^;]*\banon\b/.test(norm));
check("C-2.3 no authenticated write grant", !/GRANT (INSERT|UPDATE|DELETE|ALL)[^;]*TO authenticated/.test(norm));
check("C-2.4 no write policies", !/CREATE POLICY[^;]*FOR (INSERT|UPDATE|DELETE|ALL)/.test(norm));
check("C-2.5 policies are SELECT-only (3)", (norm.match(/FOR SELECT TO authenticated/g) ?? []).length === 3);

const plans = norm.slice(norm.indexOf("CREATE TABLE public.commercial_plans ("), norm.indexOf("REVOKE ALL ON public.commercial_plans"));
for (const frag of [
  "version integer NOT NULL CHECK (version > 0)",
  "status text NOT NULL CHECK (status IN ('draft','active','retired'))",
  "price_cents integer NOT NULL CHECK (price_cents >= 0)",
  "currency text NOT NULL",
  "billing_interval text NOT NULL CHECK (billing_interval IN ('month','year','none'))",
  "UNIQUE (code, version)",
]) check(`C-2p ${frag}`, plans.includes(frag));

const ents = norm.slice(norm.indexOf("CREATE TABLE public.commercial_plan_entitlements ("), norm.indexOf("REVOKE ALL ON public.commercial_plan_entitlements"));
for (const frag of [
  "REFERENCES public.commercial_plans(id) ON DELETE RESTRICT",
  "kind text NOT NULL CHECK (kind IN ('feature','quota'))",
  "enabled boolean NOT NULL DEFAULT true",
  "limit_value integer NULL CHECK (limit_value IS NULL OR limit_value >= 0)",
  "period text NOT NULL CHECK (period IN ('none','calendar_month_utc','day_utc'))",
  "customer_visible boolean NOT NULL DEFAULT true",
  "metadata jsonb NOT NULL DEFAULT '{}'::jsonb",
  "PRIMARY KEY (plan_id, feature_key)",
]) check(`C-2e ${frag}`, ents.includes(frag));

const asg = norm.slice(norm.indexOf("CREATE TABLE public.workspace_commercial_assignments ("), norm.indexOf("CREATE UNIQUE INDEX"));
for (const frag of [
  "workspace_id uuid NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE",
  "plan_id uuid NOT NULL REFERENCES public.commercial_plans(id) ON DELETE RESTRICT",
  "status text NOT NULL CHECK (status IN ('active','trialing','past_due','suspended','ended'))",
  "enforcement_mode text NOT NULL DEFAULT 'observe' CHECK (enforcement_mode IN ('observe','enforce'))",
  "billing_owner_user_id uuid NULL REFERENCES auth.users(id) ON DELETE SET NULL",
  "channel text NOT NULL DEFAULT 'direct' CHECK (channel IN ('direct','affiliate','reseller','internal'))",
  "channel_partner_ref text NULL",
  "assignment_source text NOT NULL DEFAULT 'manual' CHECK (assignment_source IN ('manual','stripe','reseller','internal'))",
  "external_ref text NULL",
  "assigned_by uuid NULL REFERENCES auth.users(id) ON DELETE SET NULL",
  "CHECK (ends_at IS NULL OR ends_at >= starts_at)",
]) check(`C-2a ${frag}`, asg.includes(frag));
check("C-2a billing owner separate from workspace owner", !/owner_id/.test(asg.replace(/billing_owner_user_id/g, "")));
check("C-2a one open assignment per workspace", norm.includes("ON public.workspace_commercial_assignments (workspace_id) WHERE ends_at IS NULL"));
check("C-2a member/unrestricted read policy",
  norm.includes("USING (public.is_workspace_member(workspace_id, auth.uid()) OR public.has_platform_unrestricted_access(auth.uid()))"));
check("C-2a reuses set_updated_at", norm.includes("EXECUTE FUNCTION public.set_updated_at()"));
check("C-2a no new generic trigger helper", !/CREATE (OR REPLACE )?FUNCTION public\.set_updated_at/.test(norm));

/* 3. seed */
const planInserts = norm.match(/INSERT INTO public\.commercial_plans/g) ?? [];
check("C-3.1 exactly one plan insert", planInserts.length === 1);
check("C-3.2 cartel_49 v1 4900 USD month",
  norm.includes("VALUES ('cartel_49', 1, 'Cartel HQ Pro', 'active', 4900, 'USD', 'month')"));
check("C-3.3 static 100/month", norm.includes("('static_ai_generations', 'quota', 100, 'calendar_month_utc', true)"));
check("C-3.4 motion 10/month", norm.includes("('motion_ai_generations', 'quota', 10, 'calendar_month_utc', true)"));
check("C-3.5 x_missions 100/month", norm.includes("('x_missions', 'quota', 100, 'calendar_month_utc', true)"));
check("C-3.6 exactly three quotas", (norm.match(/'quota',/g) ?? []).length === 3);
const FEATURES = ["static_ai_tools", "concept_generation", "telegram_motion_prep", "x_reads", "sticker_drops",
  "community_tools", "sticker_auto_posting", "launch_watch", "official_broadcasts", "project_inbox", "public_project_profile"];
for (const f of FEATURES) {
  const vis = f === "x_reads" ? "false" : "true";
  check(`C-3f ${f}`, new RegExp(`\\('${f}',\\s*'feature',\\s*NULL::integer,\\s*'none',\\s*${vis}\\)`).test(norm));
}
check("C-3.7 no concept quota", !/'concept_generation',\s*'quota'/.test(norm));
check("C-3.8 no assignment insert", !/INSERT INTO public\.workspace_commercial_assignments[^;]*VALUES \('?[0-9a-f-]{36}/.test(norm) &&
  (norm.match(/INSERT INTO public\.workspace_commercial_assignments/g) ?? []).length === 1 &&
  norm.indexOf("INSERT INTO public.workspace_commercial_assignments") > norm.indexOf("FUNCTION public.set_workspace_commercial_assignment"));

/* 4. usage authority */
const fnBody = (name: string) => {
  const start = norm.indexOf(`FUNCTION public.${name}(`);
  const end = norm.indexOf("$$;", start);
  return norm.slice(start, end);
};
const usage = fnBody("commercial_feature_usage");
check("C-4.1 usage reads ai_jobs + social_missions", usage.includes("public.ai_jobs") && usage.includes("public.social_missions"));
check("C-4.2 static = sticker_generate", usage.includes("j.job_type = 'sticker_generate'"));
check("C-4.3 motion = sticker_motion_generate", usage.includes("j.job_type = 'sticker_motion_generate'"));
check("C-4.4 no status filter anywhere in usage", !/status/.test(usage));
check("C-4.5 no remove_background / telegram prep", !/remove_background|sticker_motion_telegram_prepare/.test(usage));
check("C-4.6 unmetered => 0", usage.includes("ELSE 0::bigint"));
check("C-4.7 usage STABLE SECURITY DEFINER search_path", usage.includes("STABLE SECURITY DEFINER SET search_path = public"));
check("C-4.8 usage service-only grant",
  norm.includes("REVOKE ALL ON FUNCTION public.commercial_feature_usage(uuid, text, timestamptz, timestamptz) FROM PUBLIC, anon, authenticated;") &&
  norm.includes("GRANT EXECUTE ON FUNCTION public.commercial_feature_usage(uuid, text, timestamptz, timestamptz) TO service_role, postgres;"));
check("C-4.9 usage_ledger never referenced", !/usage_ledger/.test(sql));
check("C-4.10 no provider credit/cost quota source", !/provider_credit|provider_cost|internal_cost|units/.test(sql));

/* 5. evaluator order */
const ev = fnBody("evaluate_commercial_access");
const idx = (s: string) => ev.indexOf(s);
const iInvalid = idx("'INVALID_CONTEXT'");
const iMismatch = idx("'ACTOR_MISMATCH'");
const iBypass = idx("has_platform_unrestricted_access(v_effective)");
const iMember = idx("is_workspace_member(_workspace_id, v_effective)");
const iAssign = idx("FROM public.workspace_commercial_assignments");
const iEnt = idx("FROM public.commercial_plan_entitlements");
const iUsage = idx("commercial_feature_usage(");
check("C-5.1 order invalid<mismatch<bypass<member<assignment<entitlement<usage",
  iInvalid > 0 && iInvalid < iMismatch && iMismatch < iBypass && iBypass < iMember && iMember < iAssign && iAssign < iEnt && iEnt < iUsage);
check("C-5.2 bypass returns UNRESTRICTED/unrestricted", /'reason', 'UNRESTRICTED', 'mode', 'unrestricted'/.test(ev));
check("C-5.3 no assignment => allowed observe", /'allowed', true, 'reason', 'NO_PLAN_ASSIGNED', 'mode', 'observe', 'would_block', false/.test(ev));
check("C-5.4 status reason ASSIGNMENT_<UPPER>", ev.includes("'ASSIGNMENT_' || upper(v_assign.status)"));
check("C-5.5 FEATURE_NOT_INCLUDED observe/enforce", /'allowed', v_mode = 'observe', 'reason', 'FEATURE_NOT_INCLUDED', 'would_block', true/.test(ev));
check("C-5.6 PLAN_LIMIT_REACHED observe/enforce", /'allowed', v_mode = 'observe', 'reason', 'PLAN_LIMIT_REACHED', 'would_block', true/.test(ev));
check("C-5.7 UTC calendar month", ev.includes("date_trunc('month', now() AT TIME ZONE 'UTC') AT TIME ZONE 'UTC'") && ev.includes("interval '1 month'"));
check("C-5.8 NULL limit unlimited", ev.includes("v_ent.limit_value IS NULL OR v_used < v_ent.limit_value"));
for (const k of ["allowed", "reason", "mode", "would_block", "plan_code", "plan_version", "feature_key", "kind", "enabled",
  "used", "limit", "period", "period_start", "period_end", "assignment_status", "enforcement_mode"]) {
  check(`C-5k key ${k}`, ev.includes(`'${k}',`));
}
check("C-5.9 evaluator grants", norm.includes("REVOKE ALL ON FUNCTION public.evaluate_commercial_access(uuid, text, uuid) FROM PUBLIC, anon;") &&
  norm.includes("GRANT EXECUTE ON FUNCTION public.evaluate_commercial_access(uuid, text, uuid) TO authenticated, service_role, postgres;"));

/* 6. usage RPC */
const wu = fnBody("get_workspace_commercial_usage");
check("C-6.1 self-only", wu.includes("'ACTOR_MISMATCH'"));
check("C-6.2 unrestricted or member", wu.includes("public.has_platform_unrestricted_access(v_effective) OR public.is_workspace_member(_workspace_id, v_effective)"));
check("C-6.3 exactly three counters", wu.includes("ARRAY['static_ai_generations','motion_ai_generations','x_missions']"));
check("C-6.4 observe when unassigned", wu.includes("ELSE 'observe' END"));
check("C-6.5 grants", norm.includes("REVOKE ALL ON FUNCTION public.get_workspace_commercial_usage(uuid, uuid) FROM PUBLIC, anon;") &&
  norm.includes("GRANT EXECUTE ON FUNCTION public.get_workspace_commercial_usage(uuid, uuid) TO authenticated, service_role, postgres;"));

/* 7. assignment RPC */
const sa = fnBody("set_workspace_commercial_assignment");
check("C-7.1 authenticated caller must be unrestricted", sa.includes("IF NOT public.has_platform_unrestricted_access(v_caller) THEN RAISE EXCEPTION 'NOT_AUTHORIZED'"));
check("C-7.2 service path without email", sa.includes("auth.role()") && !/@/.test(sa));
for (const e of ["WORKSPACE_NOT_FOUND", "PLAN_NOT_FOUND", "INVALID_STATUS", "INVALID_ENFORCEMENT_MODE", "INVALID_CHANNEL", "INVALID_ASSIGNMENT_SOURCE"])
  check(`C-7v ${e}`, sa.includes(`'${e}'`));
check("C-7.3 ends open assignment constraint-safe", sa.includes("SET status = 'ended'") && sa.includes("GREATEST(a.starts_at,"));
check("C-7.4 assigned_by = caller", sa.includes("v_now, _ends_at, v_caller"));
check("C-7.5 grants", /REVOKE ALL ON FUNCTION public\.set_workspace_commercial_assignment\([^)]*\) FROM PUBLIC, anon;/.test(norm) &&
  /GRANT EXECUTE ON FUNCTION public\.set_workspace_commercial_assignment\([^)]*\) TO authenticated, service_role, postgres;/.test(norm));

/* 8. isolation / hygiene */
check("C-8.1 no email literal", !/[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[a-z]{2,}/.test(raw));
check("C-8.2 no stripe calls/imports", !/stripe\.|import .*stripe|stripe_customer|stripe_subscription|http_post|net\.http/i.test(sql));
check("C-8.3 no PCART/chain/liquidity", !/pcart|launch_chain|liquidity|treasury|wallet|safe_|mainnet|token_deploy/i.test(sql));
check("C-8.4 no partner payout/tax/white-label", !/payout|commission|tax|white_label|whitelabel/i.test(sql));
check("C-8.5 no destructive DDL", !/\bDROP\b|\bTRUNCATE\b|\bDELETE FROM\b/i.test(sql));
check("C-8.6 no ALTER of existing tables", !/ALTER TABLE public\.(?!commercial_plans|commercial_plan_entitlements|workspace_commercial_assignments)/.test(norm));
check("C-8.7 no dollar-cost logic in evaluator", !/price_cents|provider_cost/.test(ev));
check("C-8.8 self hygiene: no fetch/createClient here", !/\bfetch\(|createClient\(/.test(readFileSync(new URL(import.meta.url), "utf8").replace(/check\("C-8\.8[^\n]*\n/, "")));

/* 9. least-privilege migration: neutralize direct authenticated plan-table access */
const lpRaw = readFileSync(`${MIGRATIONS}/${LEAST_PRIVILEGE}`, "utf8");
const lp = lpRaw.replace(/^\s*--.*$/gm, "").replace(/\s+/g, " ");
check("C-9.1 drops plans allow-all policy", lp.includes('DROP POLICY IF EXISTS "Authenticated users can read commercial plans" ON public.commercial_plans;'));
check("C-9.2 drops entitlements allow-all policy", lp.includes('DROP POLICY IF EXISTS "Authenticated users can read commercial plan entitlements" ON public.commercial_plan_entitlements;'));
check("C-9.3 revokes authenticated SELECT on plans", lp.includes("REVOKE SELECT ON public.commercial_plans FROM authenticated;"));
check("C-9.4 revokes authenticated SELECT on entitlements", lp.includes("REVOKE SELECT ON public.commercial_plan_entitlements FROM authenticated;"));
check("C-9.5 no new grants in least-privilege migration", !/\bGRANT\b/.test(lp));
check("C-9.6 no new policies in least-privilege migration", !/CREATE POLICY/.test(lp));
check("C-9.7 RLS not disabled", !/DISABLE ROW LEVEL SECURITY/.test(lp));
check("C-9.8 service_role untouched", !/service_role/.test(lp));
check("C-9.9 anon/public untouched", !/\banon\b|\bPUBLIC\b/.test(lp.replace(/public\./g, "")));
check("C-9.10 no data-destructive DDL or DML", !/\bDROP (TABLE|SCHEMA|COLUMN)\b|\bTRUNCATE\b|\bDELETE\b|\bINSERT\b|\bUPDATE\b/i.test(lp));
check("C-9.11 exactly four statements", lp.split(";").map((s) => s.trim()).filter(Boolean).length === 4);

console.log(`commercial-entitlements-regression: ${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
