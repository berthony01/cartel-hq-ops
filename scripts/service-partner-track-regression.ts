/*
 * Service Partner track separation regression.
 * 1) Static contract + copy checks (always).
 * 2) Executes the STAGED SQL against a throwaway LOCAL Postgres cluster in
 *    /tmp (never the Supabase project): shim auth/roles -> Phase 1A contract ->
 *    staged track separation -> role-faithful cases run as `authenticated`
 *    with request.jwt.claims, so RLS and SECURITY DEFINER behave as deployed.
 * No network calls, no secrets, no production access.
 */
import { readFileSync, mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { execSync, spawnSync } from "node:child_process";
import { tmpdir } from "node:os";
import { join } from "node:path";

let passed = 0, failed = 0;
function check(id: string, ok: boolean, detail = "") {
  if (ok) { passed++; console.log(`PASS ${id}`); } else { failed++; console.log(`FAIL ${id}${detail ? " — " + detail : ""}`); }
}
const read = (p: string) => readFileSync(p, "utf8");
const SQL = read("docs/sql/SERVICE_PARTNER_track_separation.sql");
const PAGE = read("src/routes/_authenticated/partners.tsx");
const PUB = read("src/routes/partner-program.tsx");
const ADMIN = read("src/components/cartel/PartnerAdminSection.tsx");
const LIB = read("src/lib/partners.ts");
const DOCS = read("src/routes/docs.tsx");
const HOME = read("src/routes/index.tsx");

/* ---------- Static: staged SQL contract ---------- */
check("S-1 staged only (not in supabase/migrations)", SQL.includes("STAGED ONLY. NOT APPLIED.") && !execSync("ls supabase/migrations", { encoding: "utf8" }).includes("service_partner_track"));
check("S-2 independent non-null track switches default false", /service_partner_applications_open boolean NOT NULL DEFAULT false/.test(SQL) && /affiliate_applications_open boolean NOT NULL DEFAULT false/.test(SQL));
check("S-3 affiliate hard-deferred in trigger", SQL.includes("RAISE EXCEPTION 'AFFILIATE_PROGRAM_DEFERRED'"));
check("S-4 no destructive statements", !/\bDROP\b|\bTRUNCATE\b|\bDELETE\s+FROM\b|DISABLE ROW LEVEL SECURITY/i.test(SQL.replace(/--.*$/gm, "")));
check("S-5 SECURITY DEFINER functions pin search_path", (SQL.match(/SECURITY DEFINER/g) ?? []).length === (SQL.match(/SECURITY DEFINER\n SET search_path TO ''/g) ?? []).length);
check("S-6 anon receives only the public status RPC", (SQL.match(/TO anon/g) ?? []).length === 1 && SQL.includes("get_partner_program_status() TO anon, authenticated, service_role"));

/* ---------- Static: UI follows database authority ---------- */
check("U-1 dashboard reads independent flags", PAGE.includes("s?.service_partner_applications_open === true") && PAGE.includes("s?.affiliate_applications_open === true"));
check("U-2 affiliate checkbox only when affiliate open", /\{affiliateOpen \? \(\s*<label/.test(PAGE));
check("U-3 ledger/payout/referral only for affiliates", PAGE.includes("{isAffiliate ? (\n                <>\n                  <Section title=\"Balances\">") && PAGE.includes("isAffiliate && partner.referral_code"));
check("U-4 no active economics on dashboard/public when affiliate closed", !/DraftEconomicsPanel|DRAFT_ECONOMICS|\d+%/.test(PAGE + PUB) && !/45-day|45 days|\$50|first 12/i.test(PUB));
check("U-5 closed-track errors mapped", LIB.includes("SERVICE_PARTNER_APPLICATIONS_CLOSED:") && LIB.includes("AFFILIATE_APPLICATIONS_CLOSED:"));
check("U-6 service-only owner draft needs no financial fields", ADMIN.includes("ownerSaveServiceTermsDraft({") && !/commissionBps|intOrNaN/.test(ADMIN));
check("U-7 typed activation says service only, no affiliate/financial", ADMIN.includes("phrase={serviceActivationPhrase(draft.version)}") && ADMIN.includes("does not open the Affiliate Program and creates no commission"));
check("U-8 owner sees Affiliate Deferred/Closed", ADMIN.includes("Deferred / Closed"));
check("U-9 public page: no-fee, no purchase, no leads/earnings, no access, no secrets", ["No fee to apply", "No CARTEL HQ purchase is required", "no leads, employment, wages, commissions or guaranteed earnings", "grants no access to any client account or workspace", "seed phrases"].every((x) => PUB.includes(x)));
check("U-10 public affiliate card not open, no application CTA", PUB.includes("Not open · planned later") && PUB.includes("No application available") && !/Apply as an Affiliate|affiliate application form/i.test(PUB));
check("U-11 no earnings hype", !/make \$|replace your income|guaranteed side hustle|easy money|passive income/i.test(PUB + DOCS + HOME + PAGE));
check("U-12 public status is database-backed and fails closed", PUB.includes("fetchPartnerProgramStatus") && LIB.includes("return CLOSED_PROGRAM_STATUS"));
check("U-13 docs FAQ: no commission, no leads, affiliate closed", DOCS.includes("There is no commission, referral credit or payout") && DOCS.includes("You find your own clients") && DOCS.includes("The Affiliate Program is closed"));
check("U-14 homepage mobile Partners link is visible", /to="\/partner-program"\s*className=\{cn\(buttonVariants\(\{ variant: "ghost", size: "sm" \}\), "min-h-11 px-2 sm:px-3"\)\}/.test(HOME));

/* ---------- Executed: local throwaway Postgres ---------- */
const hasPg = spawnSync("bash", ["-lc", "command -v initdb && command -v pg_ctl && command -v psql"]).status === 0;
if (!hasPg) {
  check("DB-0 local postgres available", false, "initdb/pg_ctl/psql not found; executed cases skipped");
} else {
  const dir = mkdtempSync(join(tmpdir(), "svc-partner-pg-"));
  const port = 55432 + Math.floor(Math.random() * 500);
  const env = { ...process.env, PGHOST: dir, PGPORT: String(port), PGUSER: "postgres", PGDATABASE: "postgres", PGPASSWORD: "" };
  const sh = (cmd: string) => execSync(cmd, { env, stdio: "pipe", encoding: "utf8" });
  try {
    // initdb refuses root; run the server as an unprivileged user when needed.
    if (process.getuid?.() === 0) { sh(`chmod 777 ${dir}`); }
    const asPg = process.getuid?.() === 0 ? "setpriv --reuid=65534 --regid=65534 --clear-groups " : "";
    sh(`${asPg}initdb -D ${dir}/data -U postgres -A trust >/dev/null`);
    sh(`${asPg}pg_ctl -D ${dir}/data -o "-k ${dir} -p ${port} -c listen_addresses=''" -l ${dir}/log -w start >/dev/null`);
    const psql = (sql: string) => {
      const f = join(dir, `q${Math.random().toString(36).slice(2)}.sql`);
      writeFileSync(f, sql);
      const r = spawnSync("psql", ["-v", "ON_ERROR_STOP=1", "-qtAX", "-f", f], { env, encoding: "utf8" });
      return { ok: r.status === 0, out: (r.stdout ?? "").trim(), err: (r.stderr ?? "").trim() };
    };
    const shim = `
      CREATE ROLE anon NOLOGIN; CREATE ROLE authenticated NOLOGIN; CREATE ROLE service_role NOLOGIN BYPASSRLS;
      CREATE SCHEMA auth; GRANT USAGE ON SCHEMA auth, public TO anon, authenticated, service_role;
      CREATE TABLE auth.users (id uuid PRIMARY KEY);
      CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS $$ SELECT nullif(current_setting('request.jwt.claims', true)::jsonb->>'sub','')::uuid $$;
      GRANT EXECUTE ON FUNCTION auth.uid() TO anon, authenticated, service_role;
      CREATE TABLE public.workspaces (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), created_at timestamptz DEFAULT now());
      CREATE TABLE public.commercial_plans (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), code text);
      CREATE TABLE public.workspace_commercial_assignments (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), workspace_id uuid, plan_id uuid, channel text, channel_partner_ref text, assignment_source text, status text, starts_at timestamptz, ends_at timestamptz);
      CREATE TABLE public.owners (user_id uuid PRIMARY KEY);
      CREATE FUNCTION public.is_platform_owner(u uuid) RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path='' AS $$ SELECT EXISTS (SELECT 1 FROM public.owners o WHERE o.user_id = u) $$;
      CREATE FUNCTION public.is_workspace_owner(w uuid, u uuid) RETURNS boolean LANGUAGE sql STABLE AS $$ SELECT false $$;
      CREATE FUNCTION public.is_workspace_member(w uuid, u uuid) RETURNS boolean LANGUAGE sql STABLE AS $$ SELECT false $$;
      GRANT EXECUTE ON FUNCTION public.is_platform_owner(uuid) TO authenticated;
      INSERT INTO auth.users VALUES ('00000000-0000-0000-0000-00000000000a'),('00000000-0000-0000-0000-00000000000b'),('00000000-0000-0000-0000-00000000000c'),('00000000-0000-0000-0000-00000000000d');
      INSERT INTO public.owners VALUES ('00000000-0000-0000-0000-00000000000a');`;
    const s1 = psql(shim);
    const s2 = s1.ok ? psql(read("docs/sql/PARTNER_1A_foundation.sql")) : s1;
    check("DB-0 shim + Phase 1A contract load", s1.ok && s2.ok, (s1.err || s2.err).slice(0, 400));
    const s3 = psql(SQL);
    check("DB-1 staged track separation applies cleanly", s3.ok, s3.err.slice(0, 400));

    const OWNER = "00000000-0000-0000-0000-00000000000a", U1 = "00000000-0000-0000-0000-00000000000b", U2 = "00000000-0000-0000-0000-00000000000c", U3 = "00000000-0000-0000-0000-00000000000d";
    const as = (uid: string | null, sql: string) => psql(`BEGIN; SET LOCAL ROLE ${uid ? "authenticated" : "anon"}; SELECT set_config('request.jwt.claims', '${uid ? JSON.stringify({ sub: uid, role: "authenticated" }) : "{}"}', true);\n${sql}\nCOMMIT;`);
    const expectErr = (r: { ok: boolean; err: string }, code: string) => !r.ok && r.err.includes(code);
    const PITCH = "'Setup and training for launch teams; five years community ops; small projects; X and Telegram.'";

    check("DB-2 both closed: service application rejected", expectErr(as(U1, `SELECT public.submit_partner_application(false, true, ${PITCH});`), "SERVICE_PARTNER_APPLICATIONS_CLOSED"));
    check("DB-3 both closed: affiliate application rejected", expectErr(as(U1, `SELECT public.submit_partner_application(true, false, ${PITCH});`), "AFFILIATE_APPLICATIONS_CLOSED"));
    check("DB-4 non-owner cannot save terms", expectErr(as(U1, `SELECT public.owner_save_service_partner_terms_draft(1, 'x', 'y');`), "PLATFORM_OWNER_REQUIRED"));
    check("DB-5 anon cannot call owner draft", expectErr(as(null, `SELECT public.owner_save_service_partner_terms_draft(1, 'x', 'y');`), "permission denied"));
    check("DB-6 owner saves service-only draft (null economics)", as(OWNER, `SELECT public.owner_save_service_partner_terms_draft(1, 'Service Partner Agreement v1', 'Independent CARTEL HQ Service Partner.');`).ok);
    const row = psql(`SELECT concat_ws('|', service_partner_applications_open, affiliate_applications_open, coalesce(commission_bps::text,'null'), coalesce(currency,'null'), coalesce(commission_duration_invoices::text,'null')) FROM public.partner_program_terms WHERE version = 1;`);
    check("DB-7 draft forces affiliate closed + economics null", row.out === "true|false|null|null|null", row.out);
    check("DB-8 non-owner cannot activate", expectErr(as(U1, `SELECT public.owner_activate_partner_terms(1);`), "PLATFORM_OWNER_REQUIRED"));
    check("DB-9 service-only activation permits null affiliate economics", as(OWNER, `SELECT public.owner_activate_partner_terms(1);`).ok);
    const st = as(null, `SELECT public.get_partner_program_status()::text;`);
    check("DB-10 anon public status shows service open, affiliate closed", st.ok && st.out.includes('"service_partner_applications_open": true') && st.out.includes('"affiliate_applications_open": false'), st.out || st.err);
    check("DB-11 anon cannot read terms table or summary", expectErr(as(null, `SELECT count(*) FROM public.partner_program_terms;`), "permission denied") && expectErr(as(null, `SELECT public.get_my_partner_summary();`), "permission denied"));
    check("DB-12 unauthenticated cannot apply", expectErr(as(null, `SELECT public.submit_partner_application(false, true, ${PITCH});`), "permission denied"));
    check("DB-13 affiliate application rejected while affiliate closed", expectErr(as(U1, `SELECT public.submit_partner_application(true, false, ${PITCH});`), "AFFILIATE_APPLICATIONS_CLOSED"));
    check("DB-14 dual application rejected while affiliate closed", expectErr(as(U1, `SELECT public.submit_partner_application(true, true, ${PITCH});`), "AFFILIATE_APPLICATIONS_CLOSED"));
    check("DB-15 service-only application succeeds when service open", as(U1, `SELECT public.submit_partner_application(false, true, ${PITCH});`).ok);
    check("DB-16 duplicate pending application blocked", expectErr(as(U1, `SELECT public.submit_partner_application(false, true, ${PITCH});`), "partner_applications_one_pending"));
    const summ = as(U1, `SELECT public.get_my_partner_summary()::text;`);
    check("DB-17 summary returns both flags, program_open true", summ.ok && summ.out.includes('"program_open": true') && summ.out.includes('"service_partner_applications_open": true') && summ.out.includes('"affiliate_applications_open": false'), summ.out || summ.err);
    const appId = psql(`SELECT id FROM public.partner_applications WHERE user_id = '${U1}';`).out;
    check("DB-18 non-owner cannot review applications", expectErr(as(U2, `SELECT public.owner_review_partner_application('${appId}', true);`), "PLATFORM_OWNER_REQUIRED"));
    check("DB-19 owner approves service-only application", as(OWNER, `SELECT public.owner_review_partner_application('${appId}', true, 'ok');`).ok);
    const p = psql(`SELECT concat_ws('|', is_service_partner, is_affiliate, coalesce(referral_code,'null'), status) FROM public.partners WHERE user_id = '${U1}';`);
    check("DB-20 service partner: no referral code, not affiliate", p.out === "true|false|null|approved", p.out);
    check("DB-21 service partner accepts agreement", as(U1, `SELECT public.accept_partner_agreement(1);`).ok);
    check("DB-22 service partner cannot request payout", expectErr(as(U1, `SELECT public.request_partner_payout(5000);`), "PARTNER_NOT_AFFILIATE"));
    const attr = as(U2, `SELECT public.record_referral_attribution('abcdefghij')::text;`);
    check("DB-23 referral attribution closed while affiliate closed", attr.ok && attr.out.includes("PROGRAM_NOT_OPEN"), attr.out || attr.err);
    psql(`INSERT INTO public.partner_applications (user_id, wants_affiliate, wants_service_partner, pitch, terms_version) VALUES ('${U3}', true, false, 'legacy affiliate app', 1);`);
    const legacy = psql(`SELECT id FROM public.partner_applications WHERE user_id = '${U3}';`).out;
    check("DB-24 owner cannot approve affiliate application while closed", expectErr(as(OWNER, `SELECT public.owner_review_partner_application('${legacy}', true);`), "AFFILIATE_APPLICATIONS_CLOSED"));
    const affDraft = psql(`INSERT INTO public.partner_program_terms (version, status, service_partner_applications_open, affiliate_applications_open, commission_bps, attribution_window_days, hold_days, min_payout_cents, currency, commission_duration_invoices, agreement_text, disclosure_text) VALUES (2, 'draft', true, true, 2000, 30, 45, 5000, 'usd', 12, 'a', 'd');`);
    check("DB-25 affiliate activation fails closed even with full economics", affDraft.ok && expectErr(as(OWNER, `SELECT public.owner_activate_partner_terms(2);`), "AFFILIATE_PROGRAM_DEFERRED"));
    const still = psql(`SELECT status FROM public.partner_program_terms WHERE version = 1;`);
    check("DB-26 failed affiliate activation left service terms active", still.out === "active", still.out);
    psql(`INSERT INTO public.partner_program_terms (version, status, agreement_text, disclosure_text) VALUES (3, 'draft', 'a', 'd');`);
    check("DB-27 activation with no open track rejected", expectErr(as(OWNER, `SELECT public.owner_activate_partner_terms(3);`), "PARTNER_TERMS_NO_TRACK_OPEN"));
    check("DB-28 active terms frozen", expectErr(psql(`UPDATE public.partner_program_terms SET affiliate_applications_open = true WHERE version = 1;`), "AFFILIATE_PROGRAM_DEFERRED"));
    check("DB-29 authenticated cannot write terms directly", expectErr(as(OWNER, `UPDATE public.partner_program_terms SET agreement_text = 'x' WHERE version = 3;`), "permission denied"));
    check("DB-30 retire closes service applications", as(OWNER, `SELECT public.owner_retire_partner_terms(1);`).ok && expectErr(as(U2, `SELECT public.submit_partner_application(false, true, ${PITCH});`), "SERVICE_PARTNER_APPLICATIONS_CLOSED"));
    const rls = psql(`SELECT bool_and(relrowsecurity) FROM pg_class WHERE relname IN ('partner_program_terms','partners','partner_applications','partner_agreement_acceptances','partner_referrals','partner_payout_requests','partner_commission_ledger');`);
    check("DB-31 RLS still enabled on all partner tables", rls.out === "t", rls.out);
  } catch (e) {
    check("DB-X harness error", false, String(e).slice(0, 400));
  } finally {
    spawnSync("bash", ["-lc", `${process.getuid?.() === 0 ? "setpriv --reuid=65534 --regid=65534 --clear-groups " : ""}pg_ctl -D ${dir}/data -m immediate stop`], { env, stdio: "ignore" });
    rmSync(dir, { recursive: true, force: true });
  }
}

console.log(`service-partner-track-regression: ${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
