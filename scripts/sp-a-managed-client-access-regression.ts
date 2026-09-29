/*
 * SP-A Managed Client Access regression.
 * 1) Static contract checks on the staged SQL, frontend and docs.
 * 2) Executes the STAGED SQL against a throwaway LOCAL Postgres cluster in /tmp
 *    (never the Supabase project) with role-faithful `authenticated`/`anon`
 *    callers and request.jwt.claims, so RLS and SECURITY DEFINER behave as deployed.
 * No network calls, no secrets, no production access.
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
const SQL = read("docs/sql/SP_A_partner_client_access.sql");
const RUNBOOK = read("docs/SP_A_MANAGED_CLIENT_ACCESS_RUNBOOK.md");
const LIB = read("src/lib/partner-client-access.ts");
const CTX = read("src/lib/workspace-context.tsx");
const SWITCH = read("src/components/cartel/WorkspaceSwitcher.tsx");
const NAV = read("src/components/cartel/SidebarNav.tsx");
const GUARD = read("src/components/cartel/ManagedAccessGuard.tsx");
const PANEL = read("src/components/cartel/ServicePartnerAccessPanel.tsx");
const PROFILE = read("src/routes/_authenticated/project-profile.tsx");
const PARTNERS = read("src/routes/_authenticated/partners.tsx");
const SETTINGS = read("src/routes/_authenticated/settings.tsx");
const code = SQL.replace(/--.*$/gm, "");

/* ---------- Static: staged SQL ---------- */
check("S-1 staged only, not in supabase/migrations", SQL.includes("STAGED ONLY. NOT APPLIED.") && !readdirSync("supabase/migrations").some((f) => /partner_client_access|sp_a/i.test(f)));
check("S-2 no destructive statements", !/\bDROP\b|\bTRUNCATE\b|\bDELETE\s+FROM\b|DISABLE ROW LEVEL SECURITY/i.test(code));
check("S-3 never touches workspace_members or existing helpers", !/workspace_members|is_workspace_member|is_workspace_operator|can_use_project_tools|is_platform_owner|has_platform_unrestricted_access/.test(code));
check("S-4 no billing/wallet/launch/affiliate surfaces", !/commercial_|stripe|launch_chain|treasury|wallet|commission|payout|referral|launches\b/i.test(code));
check("S-5 every SECURITY DEFINER pins empty search_path", (code.match(/SECURITY DEFINER/g) ?? []).length === (code.match(/SECURITY DEFINER\n SET search_path TO ''/g) ?? []).length && (code.match(/SECURITY DEFINER/g) ?? []).length >= 10);
check("S-6 no anon grant anywhere", !/TO\s+(?:[a-z_, ]*\b)?anon\b/i.test(code.replace(/FROM PUBLIC, anon(, authenticated)?;/g, "")));
check("S-7 table: SELECT only for authenticated, no direct writes", code.includes("REVOKE ALL ON public.partner_client_access FROM PUBLIC, anon, authenticated;") && code.includes("GRANT SELECT ON public.partner_client_access TO authenticated;") && !/GRANT (INSERT|UPDATE|DELETE)[^;]*partner_client_access TO authenticated/i.test(code));
check("S-8 RLS enabled with owner-or-partner select policy", code.includes("ALTER TABLE public.partner_client_access ENABLE ROW LEVEL SECURITY;") && code.includes("FOR SELECT TO authenticated"));
check("S-9 every created function revokes PUBLIC", [...code.matchAll(/CREATE OR REPLACE FUNCTION public\.(\w+)/g)].every((m) => code.includes(`REVOKE ALL ON FUNCTION public.${m[1]}(`)));
check("S-10 revoke never deletes history", /SET status = 'revoked'/.test(code));
check("S-11 email never returned by list RPCs", !/RETURNS TABLE[^)]*email/i.test(code));
check("S-12 exactly seven scopes allowed", ["community_management", "broadcasts", "launch_watcher_comms", "sticker_tools", "missions", "project_inbox", "project_identity"].every((s) => code.includes(`'${s}'`)));
check("S-13 partner profile update excludes slug/status/logo", !/public_slug|discovery_status\s*=|logo_asset_id/.test(code.slice(code.indexOf("partner_update_project_profile("))));

/* ---------- Static: frontend ---------- */
check("F-1 managed list fails closed to []", /fetchManagedWorkspaces[\s\S]*?if \(error \|\| !Array\.isArray\(data\)\) return \[\];[\s\S]*?catch \{\s*return \[\];/.test(LIB));
check("F-2 active scopes: project_identity (SP-A) + project_inbox (SP-B1) + launch_watcher_comms (SP-B2) + broadcasts (SP-B3) + community_management (SP-B4) + sticker_tools (SP-B5) + missions (SP-B6) only", LIB.includes('ACTIVE_PARTNER_SCOPES: readonly PartnerClientScope[] = ["project_identity", "project_inbox", "launch_watcher_comms", "broadcasts", "community_management", "sticker_tools", "missions"]'));
check("F-3 workspace list: members first, managed separate and labelled", CTX.includes("[...own, ...managed]") && CTX.includes('access: "managed" as const') && CTX.includes(".from(\"workspaces\")"));
check("F-4 switcher separates Managed client projects", SWITCH.includes("Managed client projects") && SWITCH.includes('w.access === "managed"'));
check("F-5 nav filtered for managed projects", NAV.includes("isManagedAllowedPath(item.to, managedScopes)"));
check("F-6 guard shows no-access and lists denied areas", GUARD.includes("doesn't include this area") && GUARD.includes("PARTNER_DENIED_AREAS"));
check("F-7 managed allowed paths limited", LIB.includes('MANAGED_ALLOWED_PATHS = ["/project-profile", "/partners"] as const'));
check("F-8 owner panel owner-only, invite by email, revoke confirmation", PANEL.includes("workspace.owner_id === user.id") && PANEL.includes('type="email"') && PANEL.includes("Revoke Service Partner access?"));
check("F-9 settings mounts owner panel", SETTINGS.includes("<ServicePartnerAccessPanel />"));
check("F-10 partner dashboard shows invitations + managed projects", PARTNERS.includes("<ManagedProjectsSection />") && PANEL.includes("Pending invitations") && PANEL.includes("Managed projects"));
check("F-11 managed profile uses SP-A RPCs only, no slug/publish controls", PROFILE.includes("isManaged ? <ManagedProjectProfile /> : <OwnerProjectProfilePage />") && (() => { const m = PROFILE.slice(PROFILE.indexOf("function ManagedProjectProfile")); return m.includes("fetchManagedProfile") && m.includes("saveManagedProfile") && !/supabase\.|public_slug|setDiscovery|publish\(/.test(m); })());
check("F-12 no email shown in partner lists", !/\.email\b/.test(PANEL));

/* ---------- Static: runbook ---------- */
const order = ["read-only preflight", "Stage and review", "Publish the SP-A frontend", "Apply the SP-A migration", "Verify schema", "Live smoke tests"].map((s) => RUNBOOK.indexOf(s));
check("R-1 runbook safe order present", order.every((i) => i >= 0) && order.every((v, i) => i === 0 || v > order[i - 1]), order.join(","));
check("R-2 runbook rollback never deletes", RUNBOOK.includes("never delete") && RUNBOOK.includes("owner_revoke_service_partner"));

/* ---------- Local DB execution ---------- */
const hasPg = spawnSync("sh", ["-c", "command -v initdb && command -v pg_ctl && command -v psql"]).status === 0;
if (!hasPg) {
  check("DB-0 local Postgres available", false, "initdb/pg_ctl/psql not found");
} else {
  const dir = mkdtempSync(join(tmpdir(), "spa-"));
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
    const OWNER = "00000000-0000-0000-0000-00000000000a", SP = "00000000-0000-0000-0000-00000000000b",
      OTHER = "00000000-0000-0000-0000-00000000000c", SUSP = "00000000-0000-0000-0000-00000000000d",
      AFF = "00000000-0000-0000-0000-00000000000e";
    const WS = "10000000-0000-0000-0000-000000000001", WS2 = "10000000-0000-0000-0000-000000000002";
    const shim = `
      CREATE ROLE anon NOLOGIN; CREATE ROLE authenticated NOLOGIN; CREATE ROLE service_role NOLOGIN BYPASSRLS;
      CREATE SCHEMA auth; GRANT USAGE ON SCHEMA auth, public TO anon, authenticated, service_role;
      CREATE TABLE auth.users (id uuid PRIMARY KEY, email text);
      CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS $$ SELECT nullif(current_setting('request.jwt.claims', true)::jsonb->>'sub','')::uuid $$;
      GRANT EXECUTE ON FUNCTION auth.uid() TO anon, authenticated, service_role;
      CREATE TABLE public.workspaces (id uuid PRIMARY KEY, name text, slug text, owner_id uuid, created_at timestamptz DEFAULT now());
      CREATE TABLE public.workspace_members (workspace_id uuid, user_id uuid, role text);
      CREATE FUNCTION public.is_workspace_member(_w uuid, _u uuid) RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public' AS $$ SELECT EXISTS (SELECT 1 FROM public.workspace_members wm WHERE wm.workspace_id=_w AND wm.user_id=_u) $$;
      CREATE FUNCTION public.is_workspace_operator(_w uuid, _u uuid) RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public' AS $$ SELECT EXISTS (SELECT 1 FROM public.workspace_members wm WHERE wm.workspace_id=_w AND wm.user_id=_u AND wm.role IN ('owner','admin')) $$;
      GRANT EXECUTE ON FUNCTION public.is_workspace_member(uuid,uuid), public.is_workspace_operator(uuid,uuid) TO authenticated;
      GRANT SELECT ON public.workspaces TO authenticated;
      ALTER TABLE public.workspaces ENABLE ROW LEVEL SECURITY;
      CREATE POLICY ws_sel ON public.workspaces FOR SELECT TO authenticated USING (public.is_workspace_member(id, auth.uid()));
      CREATE TABLE public.partners (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), user_id uuid UNIQUE, is_affiliate boolean DEFAULT false, is_service_partner boolean DEFAULT false, status text);
      CREATE TABLE public.partner_program_terms (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), status text, service_partner_applications_open boolean DEFAULT false);
      CREATE TABLE public.project_profiles (workspace_id uuid PRIMARY KEY, public_slug text, project_name text NOT NULL CHECK (char_length(btrim(project_name)) BETWEEN 1 AND 120), ticker text, primary_chain text, tagline varchar(140), description text, website_url text, telegram_url text, x_url text, discovery_status text DEFAULT 'draft', logo_asset_id uuid, updated_at timestamptz DEFAULT now());
      GRANT SELECT ON public.project_profiles TO authenticated;
      ALTER TABLE public.project_profiles ENABLE ROW LEVEL SECURITY;
      CREATE POLICY pp_sel ON public.project_profiles FOR SELECT TO authenticated USING (public.is_workspace_member(workspace_id, auth.uid()));
      INSERT INTO auth.users VALUES ('${OWNER}','owner@example.test'),('${SP}','Partner@Example.test'),('${OTHER}','other@example.test'),('${SUSP}','susp@example.test'),('${AFF}','aff@example.test');
      INSERT INTO public.workspaces VALUES ('${WS}','Client One','client-one','${OWNER}',now()),('${WS2}','Other Co','other-co','${OTHER}',now());
      INSERT INTO public.workspace_members VALUES ('${WS}','${OWNER}','owner'),('${WS2}','${OTHER}','owner');
      INSERT INTO public.partners (user_id, is_service_partner, is_affiliate, status) VALUES ('${SP}',true,false,'approved'),('${SUSP}',true,false,'suspended'),('${AFF}',false,true,'approved');
      INSERT INTO public.partner_program_terms (status, service_partner_applications_open) VALUES ('active', true);
      INSERT INTO public.project_profiles (workspace_id, public_slug, project_name, discovery_status) VALUES ('${WS}','client-one','Client One','published'),('${WS2}','other-co','Other Co','draft');`;
    const s1 = psql(shim);
    check("DB-0 shim loads", s1.ok, s1.err.slice(0, 300));
    const s2 = psql(SQL);
    check("DB-1 staged SP-A SQL applies cleanly", s2.ok, s2.err.slice(0, 400));
    const s3 = psql(SQL.replace(/CREATE TABLE public\.partner_client_access[\s\S]*?\n\);\n/, "").replace(/CREATE (UNIQUE )?INDEX[^;]*;/g, "").replace(/CREATE POLICY[^;]*;/g, "").replace(/CREATE TRIGGER[^;]*;/g, ""));
    check("DB-1b functions/grants re-runnable (CREATE OR REPLACE)", s3.ok, s3.err.slice(0, 200));

    const as = (uid: string | null, sql: string) => psql(`BEGIN; SET LOCAL ROLE ${uid ? "authenticated" : "anon"}; SET LOCAL request.jwt.claims = '${uid ? JSON.stringify({ sub: uid, role: "authenticated" }) : "{}"}';\n${sql}\nCOMMIT;`);
    const err = (r: { ok: boolean; err: string }, code: string) => !r.ok && r.err.includes(code);
    const counts = () => psql(`SELECT concat_ws('|', (SELECT count(*) FROM public.workspaces), (SELECT count(*) FROM public.workspace_members), (SELECT count(*) FROM public.project_profiles), (SELECT md5(string_agg(project_name||coalesce(ticker,''), ',' ORDER BY workspace_id)) FROM public.project_profiles));`).out;

    check("DB-2 anon cannot invite/list/scope-check", err(as(null, `SELECT public.owner_invite_service_partner('${WS}','partner@example.test','{project_identity}');`), "permission denied") && err(as(null, `SELECT * FROM public.list_my_managed_workspaces();`), "permission denied") && err(as(null, `SELECT public.partner_has_scope('${WS}','project_identity');`), "permission denied"));
    check("DB-3 anon cannot read access table", err(as(null, `SELECT count(*) FROM public.partner_client_access;`), "permission denied"));
    check("DB-4 non-owner cannot invite", err(as(OTHER, `SELECT public.owner_invite_service_partner('${WS}','partner@example.test','{project_identity}');`), "WORKSPACE_OWNER_REQUIRED"));
    check("DB-5 partner cannot invite itself into client project", err(as(SP, `SELECT public.owner_invite_service_partner('${WS}','partner@example.test','{project_identity}');`), "WORKSPACE_OWNER_REQUIRED"));
    check("DB-6 unknown email -> generic error", err(as(OWNER, `SELECT public.owner_invite_service_partner('${WS}','nobody@example.test','{project_identity}');`), "SERVICE_PARTNER_NOT_AVAILABLE"));
    check("DB-7 suspended partner -> generic error", err(as(OWNER, `SELECT public.owner_invite_service_partner('${WS}','susp@example.test','{project_identity}');`), "SERVICE_PARTNER_NOT_AVAILABLE"));
    check("DB-8 affiliate-only partner -> generic error", err(as(OWNER, `SELECT public.owner_invite_service_partner('${WS}','aff@example.test','{project_identity}');`), "SERVICE_PARTNER_NOT_AVAILABLE"));
    check("DB-9 owner self-invite rejected", err(as(OWNER, `SELECT public.owner_invite_service_partner('${WS}','owner@example.test','{project_identity}');`), "SERVICE_PARTNER_NOT_AVAILABLE"));
    check("DB-10 invalid scope rejected", err(as(OWNER, `SELECT public.owner_invite_service_partner('${WS}','partner@example.test','{billing}');`), "INVALID_SCOPES"));
    check("DB-10b direct authenticated insert denied", err(as(OWNER, `INSERT INTO public.partner_client_access (workspace_id, partner_id, partner_user_id, invited_by) SELECT '${WS}', id, user_id, '${OWNER}' FROM public.partners WHERE user_id='${SP}';`), "permission denied"));
    const before = counts();
    const inv = as(OWNER, `SELECT public.owner_invite_service_partner('${WS}','  PARTNER@example.test ','{project_identity,broadcasts}');`);
    check("DB-11 owner invites by case-insensitive email", inv.ok, inv.err);
    const accessId = inv.out.split("\n").pop() ?? "";
    check("DB-12 duplicate open invite rejected", err(as(OWNER, `SELECT public.owner_invite_service_partner('${WS}','partner@example.test','{project_identity}');`), "ACCESS_ALREADY_EXISTS"));
    check("DB-13 pending grants nothing", as(SP, `SELECT public.partner_has_scope('${WS}','project_identity');`).out === "f" && err(as(SP, `SELECT public.partner_get_project_profile('${WS}');`), "PARTNER_SCOPE_REQUIRED"));
    const invites = as(SP, `SELECT workspace_name FROM public.list_my_partner_invites();`);
    check("DB-14 partner sees pending invite (name only)", invites.out === "Client One", invites.out || invites.err);
    const ol = as(OWNER, `SELECT row_to_json(x)::text FROM public.owner_list_partner_access('${WS}') x;`);
    check("DB-15 owner list has reference, no email", ol.ok && ol.out.includes('"partner_reference":"SP-') && !/@/.test(ol.out), ol.out || ol.err);
    check("DB-16 other user cannot list owner access", err(as(OTHER, `SELECT * FROM public.owner_list_partner_access('${WS}');`), "WORKSPACE_OWNER_REQUIRED"));
    check("DB-17 other user cannot accept someone else's invite", err(as(OTHER, `SELECT public.partner_respond_client_invite('${accessId}', true);`), "INVITE_NOT_FOUND"));
    check("DB-18 invited partner accepts", as(SP, `SELECT public.partner_respond_client_invite('${accessId}', true);`).ok);
    check("DB-19 replayed accept rejected", err(as(SP, `SELECT public.partner_respond_client_invite('${accessId}', true);`), "INVITE_NOT_FOUND"));
    const mw = as(SP, `SELECT workspace_name||':'||array_to_string(scopes, ',') FROM public.list_my_managed_workspaces();`);
    check("DB-20 managed list shows accepted project", mw.out === "Client One:project_identity,broadcasts" || mw.out === "Client One:broadcasts,project_identity", mw.out || mw.err);
    check("DB-21 partner is NOT a workspace member or operator", as(SP, `SELECT public.is_workspace_member('${WS}','${SP}')::text || public.is_workspace_operator('${WS}','${SP}')::text;`).out === "falsefalse");
    check("DB-22 partner cannot read workspace/profile rows directly (RLS)", as(SP, `SELECT (SELECT count(*) FROM public.workspaces)::text || (SELECT count(*) FROM public.project_profiles)::text;`).out === "00");
    check("DB-23 scope true only for granted scopes", as(SP, `SELECT public.partner_has_scope('${WS}','project_identity')::text||public.partner_has_scope('${WS}','missions')::text||public.partner_has_scope('${WS2}','project_identity')::text;`).out === "truefalsefalse");
    check("DB-24 denied areas are not scopes", err(as(OWNER, `SELECT public.owner_update_partner_scopes('${accessId}','{wallet_treasury}');`), "INVALID_SCOPES"));
    const gp = as(SP, `SELECT public.partner_get_project_profile('${WS}')::text;`);
    check("DB-25 partner reads permitted profile fields only", gp.ok && gp.out.includes('"project_name": "Client One"') && !gp.out.includes("public_slug") && !gp.out.includes("logo_asset_id"), gp.out || gp.err);
    check("DB-26 partner cannot read another project's profile", err(as(SP, `SELECT public.partner_get_project_profile('${WS2}');`), "PARTNER_SCOPE_REQUIRED"));
    check("DB-27 partner updates permitted fields", as(SP, `SELECT public.partner_update_project_profile('${WS}','Client One Updated','CLI','Base','Tag','Desc','https://c.example','https://t.me/c','');`).ok);
    const pr = psql(`SELECT concat_ws('|', project_name, ticker, public_slug, discovery_status, coalesce(x_url,'null')) FROM public.project_profiles WHERE workspace_id='${WS}';`);
    check("DB-28 slug + discovery status unchanged by partner update", pr.out === "Client One Updated|CLI|client-one|published|null", pr.out);
    check("DB-29 unsafe URL rejected", err(as(SP, `SELECT public.partner_update_project_profile('${WS}','X','','','','','javascript:alert(1)','','');`), "INVALID_URL"));
    check("DB-30 partner cannot edit scopes or revoke", err(as(SP, `SELECT public.owner_update_partner_scopes('${accessId}','{project_identity,missions}');`), "ACCESS_NOT_FOUND") && err(as(SP, `SELECT public.owner_revoke_service_partner('${accessId}');`), "ACCESS_NOT_FOUND"));
    check("DB-31 owner edits scopes; removal takes effect", as(OWNER, `SELECT public.owner_update_partner_scopes('${accessId}','{broadcasts}');`).ok && err(as(SP, `SELECT public.partner_get_project_profile('${WS}');`), "PARTNER_SCOPE_REQUIRED"));
    as(OWNER, `SELECT public.owner_update_partner_scopes('${accessId}','{project_identity}');`);
    psql(`UPDATE public.partners SET status='suspended' WHERE user_id='${SP}';`);
    check("DB-32 suspension removes access immediately", as(SP, `SELECT public.partner_has_scope('${WS}','project_identity');`).out === "f" && as(SP, `SELECT count(*) FROM public.list_my_managed_workspaces();`).out === "0");
    psql(`UPDATE public.partners SET status='approved' WHERE user_id='${SP}';`);
    psql(`UPDATE public.partner_program_terms SET status='retired';`);
    check("DB-33 closing the Service Partner track removes access", as(SP, `SELECT public.partner_has_scope('${WS}','project_identity');`).out === "f");
    psql(`UPDATE public.partner_program_terms SET status='active';`);
    check("DB-34 access restored when eligible again (row untouched)", as(SP, `SELECT public.partner_has_scope('${WS}','project_identity');`).out === "t");
    const beforeRevoke = counts();
    check("DB-35 owner revokes", as(OWNER, `SELECT public.owner_revoke_service_partner('${accessId}');`).ok);
    check("DB-36 revoke is immediate", as(SP, `SELECT public.partner_has_scope('${WS}','project_identity');`).out === "f" && as(SP, `SELECT count(*) FROM public.list_my_managed_workspaces();`).out === "0");
    check("DB-37 revoke keeps history row and other data", psql(`SELECT status FROM public.partner_client_access WHERE id='${accessId}';`).out === "revoked" && counts() === beforeRevoke);
    check("DB-38 revoked cannot be re-accepted or re-revoked", err(as(SP, `SELECT public.partner_respond_client_invite('${accessId}', true);`), "INVITE_NOT_FOUND") && err(as(OWNER, `SELECT public.owner_revoke_service_partner('${accessId}');`), "ACCESS_NOT_FOUND"));
    check("DB-39 workspace ownership + membership unchanged throughout", psql(`SELECT owner_id FROM public.workspaces WHERE id='${WS}';`).out === OWNER && psql(`SELECT count(*) FROM public.workspace_members WHERE user_id='${SP}';`).out === "0" && counts().split("|").slice(0, 2).join("|") === before.split("|").slice(0, 2).join("|"));
    const inv2 = as(OWNER, `SELECT public.owner_invite_service_partner('${WS}','partner@example.test','{project_identity}');`);
    const id2 = inv2.out.split("\n").pop() ?? "";
    check("DB-40 re-invite after revoke allowed; decline grants nothing", inv2.ok && as(SP, `SELECT public.partner_respond_client_invite('${id2}', false);`).ok && as(SP, `SELECT public.partner_has_scope('${WS}','project_identity');`).out === "f");
    check("DB-41 partner sees only own rows; other owner sees none", as(SP, `SELECT count(*) FROM public.partner_client_access;`).out === "2" && as(OTHER, `SELECT count(*) FROM public.partner_client_access;`).out === "0");
    check("DB-42 internal eligibility helper not callable by authenticated", err(as(SP, `SELECT public.partner_client_access_eligible(gen_random_uuid());`), "permission denied"));
  } catch (e) {
    check("DB-X harness", false, String(e).slice(0, 300));
  } finally {
    try { sh(`${asPg}pg_ctl -D ${dir}/data -m immediate stop >/dev/null`); } catch { /* ignore */ }
    rmSync(dir, { recursive: true, force: true });
  }
}

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
