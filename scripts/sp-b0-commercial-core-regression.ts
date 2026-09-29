/*
 * SP-B0 Commercial workspace entitlement core — equivalence regression.
 * 1) Static checks on docs/sql/SP_B0_commercial_workspace_entitlement_core.sql.
 * 2) Throwaway LOCAL Postgres in /tmp (never Supabase): loads the canonical
 *    evaluate_commercial_access from migration 20260924021801 (verified equal to
 *    live), records its JSON output over the approved matrix, applies SP-B0,
 *    re-runs the identical matrix and requires byte-equal output.
 * No network, no secrets, no production access.
 */
import { readFileSync, mkdtempSync, writeFileSync, rmSync, readdirSync } from "node:fs";
import { execSync, spawnSync } from "node:child_process";
import { tmpdir } from "node:os";
import { join } from "node:path";

let passed = 0, failed = 0;
function check(id: string, ok: boolean, detail = "") {
  if (ok) { passed++; console.log(`PASS ${id}`); } else { failed++; console.log(`FAIL ${id}${detail ? " — " + detail : ""}`); }
}
const read = (p: string) => readFileSync(p, "utf8");
const B0 = read("docs/sql/SP_B0_commercial_workspace_entitlement_core.sql");
const CANON_MIG = read("supabase/migrations/20260924021801_e48c0c41-9053-4f77-a267-04fbba8d206d.sql");
const fnFrom = (src: string, name: string) => {
  const i = src.indexOf(`CREATE OR REPLACE FUNCTION public.${name}(`);
  if (i < 0) return "";
  const j = src.indexOf("$function$;", src.indexOf("AS $function$", i) + 13);
  return src.slice(i, j + "$function$;".length);
};
const ORIGINAL = fnFrom(CANON_MIG, "evaluate_commercial_access");
const code = B0.replace(/--.*$/gm, "");

/* ---------- Static ---------- */
check("S-1 staged only, not in supabase/migrations", B0.includes("STAGED ONLY. NOT APPLIED.") && !readdirSync("supabase/migrations").some((f) => /sp_b0|workspace_entitlement_core/i.test(f)));
check("S-2 canonical original evaluator found", ORIGINAL.length > 4000 && ORIGINAL.includes("-- 5. current assignment"));
check("S-3 no destructive / data statements", !/\bDROP\b|\bTRUNCATE\b|\bDELETE\b|\bINSERT\b|\bUPDATE\s+public\.|ALTER TABLE/i.test(code));
check("S-4 no plan/price/stripe/assignment writes", !/stripe|price_cents\s*=|INSERT INTO public\.commercial|UPDATE public\.(commercial|workspace_commercial)/i.test(code));
const orig5to10 = ORIGINAL.slice(ORIGINAL.indexOf("  -- 5. current assignment"), ORIGINAL.lastIndexOf("END;\n$function$"));
const core = fnFrom(B0, "commercial_evaluate_workspace_feature");
check("S-5 core contains steps 5-10 verbatim", orig5to10.length > 2000 && core.includes(orig5to10));
check("S-6 core has no actor/unrestricted/membership logic", !/auth\.uid|has_platform_unrestricted_access|is_platform_owner|is_workspace_member|is_workspace_operator|_user_id/.test(core));
const newEval = fnFrom(B0, "evaluate_commercial_access");
const orig1to4 = ORIGINAL.slice(0, ORIGINAL.indexOf("  -- 5. current assignment"));
check("S-7 evaluator header + steps 1-4 byte-identical", newEval.startsWith(orig1to4));
check("S-8 evaluator delegates to core", newEval.includes("RETURN public.commercial_evaluate_workspace_feature(_workspace_id, _feature_key, v_result);"));
check("S-9 core not granted to anon/authenticated/PUBLIC", code.includes("REVOKE ALL ON FUNCTION public.commercial_evaluate_workspace_feature(uuid, text, jsonb) FROM PUBLIC, anon, authenticated;") && !/GRANT EXECUTE ON FUNCTION public\.commercial_evaluate_workspace_feature[^;]*authenticated/.test(code));
const adapter = fnFrom(B0, "partner_evaluate_commercial_access");
check("S-10 adapter: project_inbox only, scope first, no unrestricted bypass, internal only", adapter.includes("_feature_key <> 'project_inbox'") && adapter.indexOf("partner_has_scope(_workspace_id, 'project_inbox')") > 0 && adapter.indexOf("partner_has_scope") < adapter.indexOf("commercial_evaluate_workspace_feature(") && !/has_platform_unrestricted_access|is_platform_owner/.test(adapter) && adapter.includes("SET search_path TO ''") && code.includes("REVOKE ALL ON FUNCTION public.partner_evaluate_commercial_access(uuid, text) FROM PUBLIC, anon, authenticated;"));
check("S-11 evaluator grants re-asserted exactly (authenticated, service_role)", code.includes("GRANT EXECUTE ON FUNCTION public.evaluate_commercial_access(uuid, text, uuid) TO authenticated, service_role;"));

/* ---------- Local DB ---------- */
const hasPg = spawnSync("sh", ["-c", "command -v initdb && command -v pg_ctl && command -v psql"]).status === 0;
if (!hasPg) {
  check("DB-0 local Postgres available", false, "initdb/pg_ctl/psql not found");
} else {
  const dir = mkdtempSync(join(tmpdir(), "spb0-"));
  const port = 55000 + Math.floor(Math.random() * 5000);
  const env = { ...process.env, PGHOST: dir, PGPORT: String(port), PGUSER: "postgres", PGDATABASE: "postgres" };
  const sh = (cmd: string) => execSync(cmd, { env, stdio: "pipe", encoding: "utf8" });
  const asPg = process.getuid?.() === 0 ? "setpriv --reuid=1000 --regid=1000 --clear-groups " : "";
  try {
    if (process.getuid?.() === 0) sh(`chmod 777 ${dir}`);
    sh(`${asPg}initdb -D ${dir}/data -U postgres -A trust >/dev/null`);
    sh(`${asPg}pg_ctl -D ${dir}/data -o "-k ${dir} -p ${port} -c listen_addresses=''" -l ${dir}/log -w start >/dev/null`);
    const psql = (sql: string) => {
      const f = join(dir, `q${Math.random().toString(36).slice(2)}.sql`);
      writeFileSync(f, sql);
      const r = spawnSync("psql", ["-v", "ON_ERROR_STOP=1", "-qtAX", "-f", f], { env, encoding: "utf8" });
      return { ok: r.status === 0, out: (r.stdout ?? "").trim(), err: (r.stderr ?? "").trim() };
    };
    const OWNERP = "00000000-0000-0000-0000-0000000000f1", MEM = "00000000-0000-0000-0000-0000000000f2", NON = "00000000-0000-0000-0000-0000000000f3";
    const WSA = "20000000-0000-0000-0000-00000000000a", WSB = "20000000-0000-0000-0000-00000000000b", WSV = "20000000-0000-0000-0000-00000000000c";
    const shim = `
      CREATE ROLE anon NOLOGIN; CREATE ROLE authenticated NOLOGIN; CREATE ROLE service_role NOLOGIN BYPASSRLS;
      CREATE SCHEMA auth; GRANT USAGE ON SCHEMA auth, public TO anon, authenticated, service_role;
      CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS $$ SELECT nullif(current_setting('request.jwt.claims', true)::jsonb->>'sub','')::uuid $$;
      GRANT EXECUTE ON FUNCTION auth.uid() TO anon, authenticated, service_role;
      CREATE TABLE public.workspace_members (workspace_id uuid NOT NULL, user_id uuid NOT NULL, role text NOT NULL DEFAULT 'member');
      CREATE TABLE public.platform_user_roles (user_id uuid, role text);
      CREATE OR REPLACE FUNCTION public.is_workspace_member(_workspace_id uuid, _user_id uuid) RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public' AS $f$ SELECT EXISTS (SELECT 1 FROM public.workspace_members wm WHERE wm.workspace_id = _workspace_id AND wm.user_id = _user_id); $f$;
      CREATE OR REPLACE FUNCTION public.is_workspace_operator(_workspace_id uuid, _user_id uuid) RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public' AS $f$ select exists (select 1 from public.workspace_members wm where wm.workspace_id = _workspace_id and wm.user_id = _user_id and wm.role in ('owner', 'admin')); $f$;
      CREATE OR REPLACE FUNCTION public.is_platform_owner(_user_id uuid) RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'pg_catalog', 'public' AS $f$ select _user_id is not null and (auth.uid() is null or auth.uid() = _user_id) and exists (select 1 from public.platform_user_roles pur where pur.user_id = _user_id and pur.role = 'owner'); $f$;
      CREATE OR REPLACE FUNCTION public.has_platform_unrestricted_access(_user_id uuid) RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'pg_catalog', 'public' AS $f$ select public.is_platform_owner(_user_id); $f$;
      CREATE TABLE public.commercial_plans (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), code text NOT NULL, version integer NOT NULL, name text NOT NULL, status text NOT NULL, price_cents integer NOT NULL, currency text NOT NULL, billing_interval text NOT NULL, created_at timestamptz NOT NULL DEFAULT now());
      CREATE TABLE public.commercial_plan_entitlements (plan_id uuid NOT NULL, feature_key text NOT NULL, kind text NOT NULL CHECK (kind IN ('feature','quota')), enabled boolean NOT NULL DEFAULT true, limit_value integer, period text NOT NULL CHECK (period IN ('none','calendar_month_utc','day_utc')), customer_visible boolean NOT NULL DEFAULT true, metadata jsonb NOT NULL DEFAULT '{}', created_at timestamptz NOT NULL DEFAULT now());
      CREATE TABLE public.workspace_commercial_assignments (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), workspace_id uuid NOT NULL, plan_id uuid NOT NULL, status text NOT NULL CHECK (status IN ('active','trialing','past_due','suspended','ended')), enforcement_mode text NOT NULL DEFAULT 'observe' CHECK (enforcement_mode IN ('observe','enforce')), starts_at timestamptz NOT NULL DEFAULT now(), ends_at timestamptz, updated_at timestamptz DEFAULT now());
      CREATE TABLE public.ai_jobs (workspace_id uuid, job_type text, created_at timestamptz DEFAULT now());
      CREATE TABLE public.social_missions (workspace_id uuid, created_at timestamptz DEFAULT now());
      CREATE TABLE public.telegram_group_connections (workspace_id uuid);
      CREATE TABLE public.usage_ledger (workspace_id uuid, action_type text, created_at timestamptz DEFAULT now());
    `;
    // commercial_feature_usage: live definition (read-only inspected), reproduced exactly.
    const usage = `CREATE OR REPLACE FUNCTION public.commercial_feature_usage(_workspace_id uuid, _feature_key text, _period_start timestamp with time zone, _period_end timestamp with time zone)
 RETURNS bigint LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public' AS $function$
  SELECT CASE _feature_key
    WHEN 'static_ai_generations' THEN (SELECT count(*) FROM public.ai_jobs j WHERE j.workspace_id = _workspace_id AND j.job_type = 'sticker_generate' AND j.created_at >= _period_start AND j.created_at < _period_end)
    WHEN 'motion_ai_generations' THEN (SELECT count(*) FROM public.ai_jobs j WHERE j.workspace_id = _workspace_id AND j.job_type = 'sticker_motion_generate' AND j.created_at >= _period_start AND j.created_at < _period_end)
    WHEN 'x_missions' THEN (SELECT count(*) FROM public.social_missions m WHERE m.workspace_id = _workspace_id AND m.created_at >= _period_start AND m.created_at < _period_end)
    WHEN 'telegram_groups' THEN (SELECT count(*) FROM public.telegram_group_connections g WHERE g.workspace_id = _workspace_id)
    WHEN 'concept_generation' THEN (SELECT count(*) FROM public.usage_ledger u WHERE u.workspace_id = _workspace_id AND u.action_type = 'sticker_concepts_generate' AND u.created_at >= _period_start AND u.created_at < _period_end)
    WHEN 'static_ai_tools' THEN (SELECT count(*) FROM public.ai_jobs j WHERE j.workspace_id = _workspace_id AND j.job_type = 'remove_background' AND j.created_at >= _period_start AND j.created_at < _period_end)
    WHEN 'telegram_motion_prep' THEN (SELECT count(*) FROM public.ai_jobs j WHERE j.workspace_id = _workspace_id AND j.job_type = 'sticker_motion_telegram_prepare' AND j.created_at >= _period_start AND j.created_at < _period_end)
    ELSE 0::bigint END;
$function$;
REVOKE ALL ON FUNCTION public.commercial_feature_usage(uuid,text,timestamptz,timestamptz) FROM PUBLIC; GRANT EXECUTE ON FUNCTION public.commercial_feature_usage(uuid,text,timestamptz,timestamptz) TO service_role;`;
    const seed = `
      INSERT INTO public.platform_user_roles VALUES ('${OWNERP}','owner');
      INSERT INTO public.workspace_members VALUES ('${WSA}','${MEM}','member'),('${WSB}','${MEM}','owner'),('${WSV}','${MEM}','admin');
      INSERT INTO public.commercial_plans (id, code, version, name, status, price_cents, currency, billing_interval) VALUES
        ('30000000-0000-0000-0000-000000000001','cartel_free',1,'Free','active',0,'usd','none'),
        ('30000000-0000-0000-0000-000000000002','cartel_pro',1,'Pro','active',4900,'usd','month');
      INSERT INTO public.commercial_plan_entitlements (plan_id, feature_key, kind, enabled, limit_value, period) VALUES
        ('30000000-0000-0000-0000-000000000001','project_inbox','feature',true,NULL,'none'),
        ('30000000-0000-0000-0000-000000000001','x_missions','quota',true,1,'calendar_month_utc'),
        ('30000000-0000-0000-0000-000000000001','motion_ai_generations','quota',false,5,'day_utc'),
        ('30000000-0000-0000-0000-000000000002','project_inbox','feature',true,NULL,'none'),
        ('30000000-0000-0000-0000-000000000002','x_missions','quota',true,2,'calendar_month_utc'),
        ('30000000-0000-0000-0000-000000000002','static_ai_generations','quota',true,1,'day_utc'),
        ('30000000-0000-0000-0000-000000000002','telegram_groups','quota',true,3,'none'),
        ('30000000-0000-0000-0000-000000000002','concept_generation','quota',true,NULL,'calendar_month_utc'),
        ('30000000-0000-0000-0000-000000000002','motion_ai_generations','feature',false,NULL,'none');
      INSERT INTO public.social_missions VALUES ('${WSA}', now()),('${WSA}', now()),('${WSB}', now());
      INSERT INTO public.ai_jobs VALUES ('${WSA}','sticker_generate', now());
      INSERT INTO public.telegram_group_connections VALUES ('${WSA}'),('${WSA}');
      INSERT INTO public.usage_ledger VALUES ('${WSA}','sticker_concepts_generate', now());
      INSERT INTO public.workspace_commercial_assignments (workspace_id, plan_id, status, enforcement_mode) VALUES
        ('${WSA}','30000000-0000-0000-0000-000000000002','active','enforce'),
        ('${WSB}','30000000-0000-0000-0000-000000000002','active','observe');`;
    check("DB-0 shim loads", psql(shim + usage).ok);
    const orig = psql(ORIGINAL + `\nREVOKE ALL ON FUNCTION public.evaluate_commercial_access(uuid,text,uuid) FROM PUBLIC, anon; GRANT EXECUTE ON FUNCTION public.evaluate_commercial_access(uuid,text,uuid) TO authenticated, service_role;`);
    check("DB-1 canonical original evaluator loads", orig.ok, orig.err.slice(0, 300));
    check("DB-2 seed loads", psql(seed).ok);

    const FEATURES = ["project_inbox", "x_missions", "static_ai_generations", "telegram_groups", "concept_generation", "motion_ai_generations", "missing_feature"];
    const call = (caller: string | null, role: string, args: string) =>
      `BEGIN; SET LOCAL ROLE ${role}; SET LOCAL request.jwt.claims = '${caller ? JSON.stringify({ sub: caller, role: "authenticated" }) : "{}"}'; SELECT public.evaluate_commercial_access(${args})::text; COMMIT;`;
    const matrix = (): string => {
      const parts: string[] = [];
      const add = (id: string, sql: string) => parts.push(`\\echo ${id}`, sql);
      add("invalid-null-ws", call(MEM, "authenticated", `NULL, 'project_inbox', '${MEM}'`));
      add("invalid-null-feature", call(MEM, "authenticated", `'${WSA}', NULL, '${MEM}'`));
      add("invalid-blank-feature", call(MEM, "authenticated", `'${WSA}', '  ', '${MEM}'`));
      add("invalid-service-no-user", call(null, "service_role", `'${WSA}', 'project_inbox', NULL`));
      add("actor-mismatch", call(MEM, "authenticated", `'${WSA}', 'project_inbox', '${NON}'`));
      add("unrestricted-owner-nonmember", call(OWNERP, "authenticated", `'${WSA}', 'x_missions', '${OWNERP}'`));
      add("unrestricted-owner-default-user", call(OWNERP, "authenticated", `'${WSV}', 'missing_feature'`));
      add("service-owner", call(null, "service_role", `'${WSA}', 'x_missions', '${OWNERP}'`));
      add("non-member", call(NON, "authenticated", `'${WSA}', 'project_inbox', '${NON}'`));
      add("non-member-default", call(NON, "authenticated", `'${WSA}', 'project_inbox'`));
      for (const f of FEATURES) {
        add(`virtual-free-${f}`, call(MEM, "authenticated", `'${WSV}', '${f}', '${MEM}'`));
        add(`observe-wsb-${f}`, call(MEM, "authenticated", `'${WSB}', '${f}', '${MEM}'`));
        add(`service-member-${f}`, call(null, "service_role", `'${WSB}', '${f}', '${MEM}'`));
      }
      for (const st of ["active", "trialing", "past_due", "suspended", "ended"]) for (const mode of ["observe", "enforce"]) {
        parts.push(`UPDATE public.workspace_commercial_assignments SET status='${st}', enforcement_mode='${mode}' WHERE workspace_id='${WSA}';`);
        for (const f of FEATURES) add(`wsa-${st}-${mode}-${f}`, call(MEM, "authenticated", `'${WSA}', '${f}', '${MEM}'`));
      }
      parts.push(`UPDATE public.workspace_commercial_assignments SET status='active', enforcement_mode='enforce', starts_at=now()+interval '1 day' WHERE workspace_id='${WSA}';`);
      add("future-assignment-falls-to-virtual", call(MEM, "authenticated", `'${WSA}', 'x_missions', '${MEM}'`));
      parts.push(`UPDATE public.workspace_commercial_assignments SET starts_at=now()-interval '2 day', ends_at=now()-interval '1 day' WHERE workspace_id='${WSA}';`);
      add("ended-window-falls-to-virtual", call(MEM, "authenticated", `'${WSA}', 'project_inbox', '${MEM}'`));
      parts.push(`UPDATE public.commercial_plans SET status='retired' WHERE code='cartel_free';`);
      add("no-commercial-plan", call(MEM, "authenticated", `'${WSV}', 'project_inbox', '${MEM}'`));
      parts.push(`UPDATE public.commercial_plans SET status='active' WHERE code='cartel_free';`);
      parts.push(`UPDATE public.workspace_commercial_assignments SET status='active', enforcement_mode='enforce', starts_at=now()-interval '1 hour', ends_at=NULL WHERE workspace_id='${WSA}';`);
      return psql(parts.join("\n")).out;
    };
    const meta = () => psql(`SELECT concat_ws('|', pg_get_function_identity_arguments(p.oid), pg_get_function_result(p.oid), p.prosecdef, p.provolatile, pg_get_userbyid(p.proowner), array_to_string(p.proconfig, ','), array_to_string(p.proacl::text[], ',')) FROM pg_proc p WHERE p.proname='evaluate_commercial_access';`).out;
    const helpers = () => psql(`SELECT string_agg(md5(pg_get_functiondef(oid)), ',' ORDER BY proname) FROM pg_proc WHERE proname IN ('is_workspace_member','is_workspace_operator','has_platform_unrestricted_access','is_platform_owner','commercial_feature_usage');`).out;
    const data = () => psql(`SELECT md5(concat((SELECT string_agg(t::text, ',' ORDER BY t::text) FROM public.commercial_plans t), (SELECT string_agg(t::text, ',' ORDER BY t::text) FROM public.commercial_plan_entitlements t), (SELECT string_agg(concat_ws(':',workspace_id,plan_id,status,enforcement_mode), ',' ORDER BY workspace_id) FROM public.workspace_commercial_assignments t), (SELECT count(*) FROM public.workspace_members)));`).out;

    const beforeOut = matrix(), beforeMeta = meta(), beforeHelpers = helpers(), beforeData = data();
    const caseCount = beforeOut.split("\n").filter((l) => l.startsWith("{")).length;
    check("DB-3 baseline matrix captured", caseCount >= 90, `cases=${caseCount}`);
    const reasons = new Set([...beforeOut.matchAll(/"reason": "([A-Z_]+)"/g)].map((m) => m[1]));
    const needed = ["INVALID_CONTEXT", "ACTOR_MISMATCH", "UNRESTRICTED", "NOT_MEMBER", "FEATURE_INCLUDED", "FEATURE_NOT_INCLUDED", "WITHIN_LIMIT", "PLAN_LIMIT_REACHED", "ASSIGNMENT_PAST_DUE", "ASSIGNMENT_SUSPENDED", "ASSIGNMENT_ENDED", "NO_COMMERCIAL_PLAN"];
    check("DB-4 matrix covers every evaluator outcome", needed.every((r) => reasons.has(r)), [...needed].filter((r) => !reasons.has(r)).join(","));

    const ap = psql(B0);
    check("DB-5 SP-B0 SQL applies cleanly", ap.ok, ap.err.slice(0, 400));
    check("DB-6 SP-B0 re-runnable", psql(B0).ok);
    const afterOut = matrix();
    check("DB-7 evaluator JSON byte-equal before/after for every case", afterOut === beforeOut, (() => { const a = beforeOut.split("\n"), b = afterOut.split("\n"); const i = a.findIndex((l, k) => l !== b[k]); return i < 0 ? "" : `${a[i - 1]} :: ${a[i]} != ${b[i]}`; })());
    check("DB-8 evaluator signature/result/SECURITY DEFINER/volatility/owner/search_path/ACL unchanged", meta() === beforeMeta, `${beforeMeta} -> ${meta()}`);
    check("DB-9 membership/owner-bypass/usage helpers unchanged", helpers() === beforeHelpers);
    check("DB-10 no commercial data or membership mutation", data() === beforeData);
    const as = (uid: string | null, sql: string) => psql(`BEGIN; SET LOCAL ROLE ${uid ? "authenticated" : "anon"}; SET LOCAL request.jwt.claims = '${uid ? JSON.stringify({ sub: uid }) : "{}"}';\n${sql}\nCOMMIT;`);
    const denied = (r: { ok: boolean; err: string }) => !r.ok && r.err.includes("permission denied");
    check("DB-11 core not executable by anon/authenticated", denied(as(null, `SELECT public.commercial_evaluate_workspace_feature('${WSA}','project_inbox','{}');`)) && denied(as(MEM, `SELECT public.commercial_evaluate_workspace_feature('${WSA}','project_inbox','{}');`)));
    check("DB-12 partner adapter not executable by anon/authenticated", denied(as(null, `SELECT public.partner_evaluate_commercial_access('${WSA}','project_inbox');`)) && denied(as(MEM, `SELECT public.partner_evaluate_commercial_access('${WSA}','project_inbox');`)));
    check("DB-13 core ACL service_role only", /^postgres=X\/postgres,service_role=X\/postgres$/.test(psql(`SELECT array_to_string(proacl::text[], ',') FROM pg_proc WHERE proname='commercial_evaluate_workspace_feature';`).out));
    check("DB-14 anon still cannot run evaluator", denied(as(null, `SELECT public.evaluate_commercial_access('${WSA}','project_inbox','${MEM}');`)));
  } catch (e) {
    check("DB-X harness", false, String(e).slice(0, 300));
  } finally {
    try { sh(`${asPg}pg_ctl -D ${dir}/data -m immediate stop >/dev/null`); } catch { /* ignore */ }
    rmSync(dir, { recursive: true, force: true });
  }
}

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
