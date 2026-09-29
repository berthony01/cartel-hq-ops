/*
 * SP-B2 V1 Partner Launch Watcher Communications regression.
 * 1) Static checks on staged SQL + frontend + changed-file scope.
 * 2) Throwaway LOCAL Postgres in /tmp (never Supabase): loads SP-A and SP-B2
 *    staged SQL with role-faithful `authenticated`/`anon` callers, plus a copy
 *    of the live enqueue trigger so opt-out/fan-out behavior is exercised.
 * No network, no secrets, no production access.
 */
import { readFileSync, mkdtempSync, writeFileSync, rmSync, readdirSync } from "node:fs";
import { execSync, execFileSync, spawnSync } from "node:child_process";
import { tmpdir } from "node:os";
import { join } from "node:path";

let passed = 0, failed = 0;
function check(id: string, ok: boolean, detail = "") {
  if (ok) { passed++; console.log(`PASS ${id}`); } else { failed++; console.log(`FAIL ${id}${detail ? " — " + detail : ""}`); }
}
const read = (p: string) => readFileSync(p, "utf8");
const SPA = read("docs/sql/SP_A_partner_client_access.sql");
const B2 = read("docs/sql/SP_B2_partner_launch_watcher_comms.sql");
const RUNBOOK = read("docs/SP_B2_PARTNER_LAUNCH_COMMS_RUNBOOK.md");
const LIB = read("src/lib/partner-client-access.ts");
const COMMS = read("src/lib/partner-launch-comms.ts");
const PANEL = read("src/components/cartel/PartnerLaunchCommsPanel.tsx");
const TG = read("src/routes/_authenticated/telegram.tsx");
const code = B2.replace(/--.*$/gm, "");

const FNS = ["partner_list_launches_for_comms", "partner_launch_watcher_stats", "partner_list_launch_watcher_updates", "partner_create_launch_watcher_update"];
const OWNER_FNS = ["create_launch_watcher_update", "get_launch_watcher_update_stats", "list_launch_watcher_updates", "get_launch_audience_summary", "notify_launch_watchers_official_contract", "notify_launch_watchers_official_contract_correction", "send_launch_schedule_communication", "dismiss_launch_schedule_communication", "transition_launch_status", "enqueue_launch_event_deliveries", "is_workspace_member", "is_workspace_operator"];
const bodyOf = (name: string) => { const i = code.indexOf(`FUNCTION public.${name}(`); return code.slice(i, code.indexOf("$function$;", i)); };

/* ---------- Static: SQL ---------- */
check("S-1 staged only, not in supabase/migrations", B2.includes("STAGED ONLY. NOT APPLIED.") && !readdirSync("supabase/migrations").some((f) => /sp_b2|launch_watcher_comms|partner_launch/i.test(f)));
check("S-2 exactly the four partner RPCs are created", [...code.matchAll(/CREATE OR REPLACE FUNCTION public\.(\w+)/g)].map((m) => m[1]).sort().join(",") === [...FNS].sort().join(","));
check("S-3 no owner/helper function redefined", OWNER_FNS.every((f) => !code.includes(`FUNCTION public.${f}(`)));
check("S-4 no table/RLS/constraint/trigger/membership/DML-on-launches change", !/CREATE TABLE|ALTER TABLE|CREATE POLICY|DROP |CREATE TRIGGER|workspace_members|is_workspace_member|is_workspace_operator|UPDATE public\.launches|DELETE FROM|GRANT (SELECT|INSERT|UPDATE|DELETE|ALL) ON (TABLE )?public\./i.test(code));
check("S-5 every RPC: SECURITY DEFINER + empty search_path + auth.uid + scope", FNS.every((f) => { const b = bodyOf(f); return /SECURITY DEFINER\n SET search_path TO ''/.test(b) && b.includes("auth.uid()") && b.includes("public.partner_has_scope(_workspace_id, 'launch_watcher_comms')"); }));
check("S-6 scope check precedes every launch read", FNS.every((f) => { const b = bodyOf(f); return b.indexOf("partner_has_scope") < b.indexOf("FROM public.launches"); }));
check("S-7 every launch action pins workspace_id = _workspace_id and PROJECT kind", FNS.every((f) => /workspace_id = _workspace_id/.test(bodyOf(f)) && bodyOf(f).includes("launch_kind = 'PROJECT'")));
check("S-8 PUBLIC/anon revoked, authenticated+service_role granted, per RPC", FNS.every((f) => new RegExp(`REVOKE ALL ON FUNCTION public\\.${f}\\([^)]*\\) FROM PUBLIC, anon;`).test(code) && new RegExp(`GRANT EXECUTE ON FUNCTION public\\.${f}\\([^)]*\\) TO authenticated, service_role;`).test(code)));
check("S-9 no sensitive columns returned", FNS.every((f) => { const m = bodyOf(f).match(/RETURNS (TABLE\([^)]*\)|\w+)/); return !!m && !/telegram|chat_id|subscription|contract|wallet|treasury|deploy|token_created|launch_watch_token|internal_notes/i.test(m[1]); }));
const create = bodyOf("partner_create_launch_watcher_update");
check("S-10 create keeps every owner guard", ["A client request id is required.", "FOR UPDATE", "'WATCHLIST_OPEN'", "'LAUNCH_APPROACHING'", "'CONTRACT_PENDING'", "'OFFICIAL_CONTRACT_REGISTERED'", "'LIVE'", "Publish the Project Profile before sending watcher updates.", "Title must be 120 characters or fewer.", "Update text is required.", "Update text must be 2200 characters or fewer.", "s.is_active = true", "s.updates_enabled = true", "No active watchers currently allow project updates.", "interval '60 seconds'", "Please wait a minute between watcher updates.", "interval '24 hours'", "_daily >= 20", "WHEN unique_violation"].every((s) => create.includes(s)));
check("S-11 create inserts only WATCHER_UPDATE/operator with partner audit fields", /INSERT INTO public\.launch_events[\s\S]*'WATCHER_UPDATE',\s*'operator'/.test(create) && create.includes("'actor', 'service_partner'") && create.includes("'partner_access_id', _access_id") && (create.match(/INSERT INTO/g) ?? []).length === 1);
check("S-12 no commercial gate added (matches owner) and decision recorded", !/evaluate_commercial|commercial_evaluate/i.test(code) && /no commercial gate/i.test(RUNBOOK));
check("S-13 history clamp 1..20, WATCHER_UPDATE only", bodyOf("partner_list_launch_watcher_updates").includes("LEAST(GREATEST(COALESCE(_limit, 10), 1), 20)") && bodyOf("partner_list_launch_watcher_updates").includes("e.event_type = 'WATCHER_UPDATE'"));

/* ---------- Static: frontend + scope ---------- */
check("F-1 launch_watcher_comms active", LIB.includes('"project_identity", "project_inbox", "launch_watcher_comms"]'));
check("F-2 /telegram unlocked for launch_watcher_comms", LIB.includes('{ path: "/telegram", scope: "launch_watcher_comms" }') && LIB.includes('{ path: "/telegram", scope: "project_inbox" }'));
check("F-3 browser calls only partner launch comms RPCs", FNS.every((f) => COMMS.includes(`"${f}"`)) && !/"create_launch_watcher_update"|"get_launch_watcher_update_stats"|"list_launch_watcher_updates"|from\("launch/.test(COMMS + PANEL));
check("F-4 panel has preview confirm + per-draft request id + no identities", PANEL.includes("AlertDialog") && PANEL.includes("crypto.randomUUID()") && !/telegram_user_id|subscription_id/.test(PANEL));
check("F-5 managed /telegram routes by scope; owner page unchanged path", TG.includes("<PartnerInboxPage />") && TG.includes("<PartnerLaunchCommsPage />") && TG.includes("<PartnerManagedCommsPage />") && TG.includes("if (!isManaged) return <TelegramPage />;"));
check("F-6 panel mounts no owner Launch Control / status / contract controls", !/transitionLaunch|registerContract|BroadcastsPanel|LaunchControl|sendLaunchScheduleCommunication/.test(PANEL));
check("F-7 runbook orders publish before SQL", (() => { const a = RUNBOOK.indexOf("CP-SPB2-PUBLISH"), b = RUNBOOK.indexOf("CP-SPB2-SQL"); return a >= 0 && b > a; })());

const ALLOW = new Set([
  "docs/sql/SP_B2_partner_launch_watcher_comms.sql", "docs/SP_B2_PARTNER_LAUNCH_COMMS_RUNBOOK.md", "scripts/sp-b2-partner-launch-comms-regression.ts",
  "scripts/sp-a-managed-client-access-regression.ts", "scripts/public-discovery-seo-regression.ts", "src/lib/partner-launch-comms.ts",
  "src/components/cartel/PartnerLaunchCommsPanel.tsx", "src/routes/_authenticated/telegram.tsx", "src/components/cartel/ManagedAccessGuard.tsx",
  "src/components/cartel/SidebarNav.tsx", "src/lib/partner-client-access.ts", "src/components/cartel/ServicePartnerAccessPanel.tsx", "roadmap.md", ".lovable/plan.md",
]);
const since = "780f5e1ebaea8a603503a06823618e861aaa8f05";
const changed = [
  ...execFileSync("git", ["diff", "--name-only", since], { encoding: "utf8" }).split("\n"),
  ...execFileSync("git", ["status", "--short"], { encoding: "utf8" }).split("\n").map((l) => l.slice(3)),
].map((s) => s.trim()).filter(Boolean);
check("F-8 only allowlisted files changed since plan commit", changed.every((f) => ALLOW.has(f)), changed.filter((f) => !ALLOW.has(f)).join(","));
check("F-9 no Edge Function / migration / types change", !changed.some((f) => f.startsWith("supabase/") || f.includes("integrations/supabase")));

/* ---------- Local DB ---------- */
const hasPg = spawnSync("sh", ["-c", "command -v initdb && command -v pg_ctl && command -v psql"]).status === 0;
if (!hasPg) {
  check("DB-0 local Postgres available", false, "initdb/pg_ctl/psql not found");
} else {
  const dir = mkdtempSync(join(tmpdir(), "spb2-"));
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
    const OWNER = "00000000-0000-0000-0000-00000000000a", SP = "00000000-0000-0000-0000-00000000000b", OTHER = "00000000-0000-0000-0000-00000000000c", SP2 = "00000000-0000-0000-0000-00000000000d";
    const WS = "10000000-0000-0000-0000-000000000001", WS2 = "10000000-0000-0000-0000-000000000002";
    const PP = "20000000-0000-0000-0000-000000000001", PP2 = "20000000-0000-0000-0000-000000000002";
    const L = "70000000-0000-0000-0000-000000000001", L2 = "70000000-0000-0000-0000-000000000002", LD = "70000000-0000-0000-0000-000000000003", LT = "70000000-0000-0000-0000-000000000004";
    const shim = `
      CREATE ROLE anon NOLOGIN; CREATE ROLE authenticated NOLOGIN; CREATE ROLE service_role NOLOGIN BYPASSRLS;
      CREATE SCHEMA auth; GRANT USAGE ON SCHEMA auth, public TO anon, authenticated, service_role;
      CREATE TABLE auth.users (id uuid PRIMARY KEY, email text);
      CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS $$ SELECT nullif(current_setting('request.jwt.claims', true)::jsonb->>'sub','')::uuid $$;
      GRANT EXECUTE ON FUNCTION auth.uid() TO anon, authenticated, service_role;
      CREATE TABLE public.workspaces (id uuid PRIMARY KEY, name text, slug text, owner_id uuid, created_at timestamptz DEFAULT now());
      CREATE TABLE public.workspace_members (workspace_id uuid, user_id uuid, role text);
      CREATE FUNCTION public.is_workspace_member(_workspace_id uuid, _user_id uuid) RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public' AS $f$ SELECT EXISTS (SELECT 1 FROM public.workspace_members wm WHERE wm.workspace_id=_workspace_id AND wm.user_id=_user_id) $f$;
      CREATE FUNCTION public.is_workspace_operator(_workspace_id uuid, _user_id uuid) RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public' AS $f$ SELECT EXISTS (SELECT 1 FROM public.workspace_members wm WHERE wm.workspace_id=_workspace_id AND wm.user_id=_user_id AND wm.role IN ('owner','admin')) $f$;
      GRANT EXECUTE ON FUNCTION public.is_workspace_member(uuid,uuid), public.is_workspace_operator(uuid,uuid) TO authenticated;
      GRANT SELECT ON public.workspaces TO authenticated;
      ALTER TABLE public.workspaces ENABLE ROW LEVEL SECURITY;
      CREATE POLICY ws_sel ON public.workspaces FOR SELECT TO authenticated USING (public.is_workspace_member(id, auth.uid()));
      CREATE TABLE public.partners (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), user_id uuid UNIQUE, is_affiliate boolean DEFAULT false, is_service_partner boolean DEFAULT false, status text);
      CREATE TABLE public.partner_program_terms (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), status text, service_partner_applications_open boolean DEFAULT false);
      CREATE TABLE public.project_profiles (id uuid UNIQUE DEFAULT gen_random_uuid(), workspace_id uuid PRIMARY KEY, public_slug text, project_name text NOT NULL, ticker text, primary_chain text, tagline varchar(140), description text, website_url text, telegram_url text, x_url text, discovery_status text DEFAULT 'draft', logo_asset_id uuid, updated_at timestamptz DEFAULT now());
      CREATE TABLE public.launches (id uuid PRIMARY KEY, workspace_id uuid NOT NULL, project_profile_id uuid, token_name text NOT NULL, ticker text, chain text, status text NOT NULL, launch_at timestamptz, official_contract_address text, internal_notes text, launch_watch_token text, launch_kind text NOT NULL DEFAULT 'PROJECT', created_at timestamptz DEFAULT now(), updated_at timestamptz DEFAULT now());
      CREATE TABLE public.launch_watch_subscriptions (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), launch_id uuid NOT NULL, telegram_user_id bigint NOT NULL, is_active boolean NOT NULL DEFAULT true, updates_enabled boolean NOT NULL DEFAULT true, reminders_enabled boolean NOT NULL DEFAULT true);
      CREATE TABLE public.launch_events (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), launch_id uuid NOT NULL REFERENCES public.launches(id), event_type text NOT NULL CHECK (event_type IN ('REMINDER_24H','REMINDER_1H','OFFICIAL_CONTRACT_REGISTERED','LAUNCH_LIVE','WATCHER_UPDATE','OFFICIAL_CONTRACT_CORRECTED')), source text NOT NULL CHECK (source IN ('reminder_runner','lifecycle','operator')), scheduled_for timestamptz NOT NULL, payload jsonb NOT NULL DEFAULT '{}', created_at timestamptz NOT NULL DEFAULT now(), UNIQUE (launch_id, event_type, scheduled_for));
      CREATE UNIQUE INDEX launch_events_watcher_update_request_uniq ON public.launch_events (launch_id, ((payload ->> 'client_request_id'))) WHERE event_type = 'WATCHER_UPDATE';
      CREATE TABLE public.launch_notification_deliveries (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), event_id uuid NOT NULL, launch_id uuid NOT NULL, subscription_id uuid NOT NULL, telegram_user_id bigint NOT NULL, status text NOT NULL, next_attempt_at timestamptz, created_at timestamptz DEFAULT now(), updated_at timestamptz DEFAULT now(), UNIQUE (event_id, subscription_id));
      -- Copy of the LIVE enqueue trigger function (read-only reference).
      CREATE FUNCTION public.enqueue_launch_event_deliveries() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $f$
      begin
        insert into public.launch_notification_deliveries (event_id, launch_id, subscription_id, telegram_user_id, status, next_attempt_at)
        select new.id, new.launch_id, s.id, s.telegram_user_id, 'pending', now()
        from public.launch_watch_subscriptions s
        where s.launch_id = new.launch_id and s.is_active = true
          and (new.event_type not in ('REMINDER_24H','REMINDER_1H') or s.reminders_enabled = true)
          and (new.event_type <> 'WATCHER_UPDATE' or s.updates_enabled = true)
        on conflict (event_id, subscription_id) do nothing;
        return new;
      end $f$;
      CREATE TRIGGER launch_events_enqueue_deliveries AFTER INSERT ON public.launch_events FOR EACH ROW EXECUTE FUNCTION public.enqueue_launch_event_deliveries();
      INSERT INTO auth.users VALUES ('${OWNER}','owner@example.test'),('${SP}','partner@example.test'),('${OTHER}','other@example.test'),('${SP2}','partner2@example.test');
      INSERT INTO public.workspaces VALUES ('${WS}','Client One','client-one','${OWNER}',now()),('${WS2}','Other Co','other-co','${OTHER}',now());
      INSERT INTO public.workspace_members VALUES ('${WS}','${OWNER}','owner'),('${WS2}','${OTHER}','owner');
      INSERT INTO public.partners (user_id, is_service_partner, status) VALUES ('${SP}',true,'approved'),('${SP2}',true,'approved');
      INSERT INTO public.partner_program_terms (status, service_partner_applications_open) VALUES ('active', true);
      INSERT INTO public.project_profiles (id, workspace_id, public_slug, project_name, ticker, discovery_status) VALUES ('${PP}','${WS}','client-one','Client One','CLI','published'),('${PP2}','${WS2}','other-co','Other Co',NULL,'published');
      INSERT INTO public.launches (id, workspace_id, project_profile_id, token_name, ticker, status, official_contract_address, internal_notes, launch_watch_token, launch_kind) VALUES
        ('${L}','${WS}','${PP}','Client Token','CLI','WATCHLIST_OPEN','0xSECRETCA','secret notes','abcdefabcdefabcdefabcdef','PROJECT'),
        ('${L2}','${WS2}','${PP2}','Other Token','OTH','WATCHLIST_OPEN',NULL,NULL,NULL,'PROJECT'),
        ('${LD}','${WS}','${PP}','Draft Token','DRF','DRAFT',NULL,NULL,NULL,'PROJECT'),
        ('${LT}','${WS}','${PP}','Internal Test','TST','WATCHLIST_OPEN',NULL,NULL,NULL,'INTERNAL_TEST');
      INSERT INTO public.launch_watch_subscriptions (launch_id, telegram_user_id, is_active, updates_enabled) VALUES
        ('${L}',900001,true,true),('${L}',900002,true,true),('${L}',900003,true,false),('${L}',900004,false,true),
        ('${L2}',900005,true,true),('${LD}',900006,true,true),('${LT}',900007,true,true);`;
    check("DB-0 shim loads", psql(shim).ok);
    check("DB-1 SP-A applies", psql(SPA).ok);
    const b2 = psql(B2); check("DB-2 SP-B2 applies", b2.ok, b2.err.slice(0, 300));
    check("DB-2b SP-B2 re-runnable", psql(B2).ok);

    const as = (uid: string | null, sql: string) => psql(`BEGIN; SET LOCAL ROLE ${uid ? "authenticated" : "anon"}; SET LOCAL request.jwt.claims = '${uid ? JSON.stringify({ sub: uid, role: "authenticated" }) : "{}"}';\n${sql}\nCOMMIT;`);
    const err = (r: { ok: boolean; err: string }, s: string) => !r.ok && r.err.includes(s);
    const R = (n: number) => `80000000-0000-0000-0000-${String(n).padStart(12, "0")}`;
    const launchHash = () => psql(`SELECT md5(string_agg(row_to_json(l)::text, '|' ORDER BY id)) FROM public.launches l;`).out;
    const H0 = launchHash();
    const calls = (ws: string, launch: string, rid: string) => [
      `SELECT * FROM public.partner_list_launches_for_comms('${ws}');`,
      `SELECT * FROM public.partner_launch_watcher_stats('${ws}','${launch}');`,
      `SELECT * FROM public.partner_list_launch_watcher_updates('${ws}','${launch}',10);`,
      `SELECT public.partner_create_launch_watcher_update('${ws}','${launch}','${rid}',NULL,'hello');`,
    ];
    const allDenied = (uid: string | null, msg: string, ws = WS, launch = L) => calls(ws, launch, R(99)).every((q) => err(as(uid, q), msg));

    check("DB-3 anon denied on all 4 (no EXECUTE)", allDenied(null, "permission denied"));
    check("DB-4 partner with no grant denied on all 4", allDenied(SP, "Not authorized"));
    check("DB-5 workspace owner (not a partner) denied on partner RPCs", allDenied(OWNER, "Not authorized"));

    const inv = as(OWNER, `SELECT public.owner_invite_service_partner('${WS}','partner@example.test','{project_identity,launch_watcher_comms}');`);
    const accessId = inv.out.split("\n").pop() ?? "";
    check("DB-6 pending invite (not accepted) denied on all 4", allDenied(SP, "Not authorized"));
    as(SP, `SELECT public.partner_respond_client_invite('${accessId}', true);`);
    as(OWNER, `SELECT public.owner_update_partner_scopes('${accessId}','{project_identity,project_inbox}');`);
    check("DB-7 active grant WITHOUT launch_watcher_comms denied on all 4", allDenied(SP, "Not authorized"));
    as(OWNER, `SELECT public.owner_update_partner_scopes('${accessId}','{project_identity,launch_watcher_comms}');`);

    const list = as(SP, `SELECT row_to_json(x)::text FROM public.partner_list_launches_for_comms('${WS}') x;`);
    check("DB-8 launch list: own PROJECT launches only, safe fields only", list.ok && list.out.split("\n").length === 2 && list.out.includes("Client Token") && list.out.includes("Draft Token") && !/Other Token|Internal Test|0xSECRETCA|secret notes|abcdefabcdef|contract|internal_notes|token_created/.test(list.out), list.out || list.err);
    check("DB-9 launch list can_send reflects status (draft false)", /"Draft Token".*"can_send":false/.test(list.out) && /"Client Token".*"can_send":true/.test(list.out));
    const st = as(SP, `SELECT concat_ws('|', active_watchers, updates_enabled_watchers, updates_muted_watchers) FROM public.partner_launch_watcher_stats('${WS}','${L}');`);
    check("DB-10 stats aggregate only (3 active / 2 updates / 1 muted)", st.out === "3|2|1", st.out || st.err);
    check("DB-11 cross-workspace: other launch via own workspace denied", [
      as(SP, `SELECT * FROM public.partner_launch_watcher_stats('${WS}','${L2}');`),
      as(SP, `SELECT * FROM public.partner_list_launch_watcher_updates('${WS}','${L2}',10);`),
      as(SP, `SELECT public.partner_create_launch_watcher_update('${WS}','${L2}','${R(1)}',NULL,'x');`),
    ].every((r) => err(r, "Not authorized")));
    check("DB-12 cross-workspace: other workspace id denied on all 4", allDenied(SP, "Not authorized", WS2, L2));
    check("DB-13 internal test launch denied", err(as(SP, `SELECT public.partner_create_launch_watcher_update('${WS}','${LT}','${R(2)}',NULL,'x');`), "Not authorized"));

    check("DB-14 null request id rejected", err(as(SP, `SELECT public.partner_create_launch_watcher_update('${WS}','${L}',NULL,NULL,'x');`), "client request id is required"));
    check("DB-15 empty body rejected", err(as(SP, `SELECT public.partner_create_launch_watcher_update('${WS}','${L}','${R(3)}',NULL,'   ');`), "Update text is required."));
    check("DB-16 2201-char body rejected", err(as(SP, `SELECT public.partner_create_launch_watcher_update('${WS}','${L}','${R(3)}',NULL,repeat('a',2201));`), "2200 characters or fewer"));
    check("DB-17 121-char title rejected", err(as(SP, `SELECT public.partner_create_launch_watcher_update('${WS}','${L}','${R(3)}',repeat('t',121),'x');`), "120 characters or fewer"));
    check("DB-18 DRAFT launch blocked", err(as(SP, `SELECT public.partner_create_launch_watcher_update('${WS}','${LD}','${R(3)}',NULL,'x');`), "not available at this lifecycle stage"));
    psql(`UPDATE public.project_profiles SET discovery_status='draft' WHERE id='${PP}';`);
    check("DB-19 unpublished profile blocked", err(as(SP, `SELECT public.partner_create_launch_watcher_update('${WS}','${L}','${R(3)}',NULL,'x');`), "Publish the Project Profile"));
    psql(`UPDATE public.project_profiles SET discovery_status='published' WHERE id='${PP}';`);

    const s1 = as(SP, `SELECT public.partner_create_launch_watcher_update('${WS}','${L}','${R(4)}','  Title  ',repeat('b',2200));`);
    const ev1 = s1.out.split("\n").pop() ?? "";
    check("DB-20 boundary send (120/2200) queued", s1.ok && /^[0-9a-f-]{36}$/.test(ev1), s1.err);
    const dl = psql(`SELECT string_agg(telegram_user_id::text, ',' ORDER BY telegram_user_id) || '|' || count(*) || '|' || bool_and(status='pending') FROM public.launch_notification_deliveries WHERE event_id='${ev1}';`);
    check("DB-21 exactly one delivery per eligible watcher; muted/inactive excluded", dl.out === "900001,900002|2|t", dl.out);
    const ev = psql(`SELECT concat_ws('|', event_type, source, payload->>'actor', (payload->>'partner_access_id') = '${accessId}', payload->>'title', launch_id) FROM public.launch_events WHERE id='${ev1}';`);
    check("DB-22 event WATCHER_UPDATE/operator with partner audit, trimmed title, client launch", ev.out === `WATCHER_UPDATE|operator|service_partner|t|Title|${L}`, ev.out);
    const rp = as(SP, `SELECT public.partner_create_launch_watcher_update('${WS}','${L}','${R(4)}','other','other');`);
    check("DB-23 same request id replays same event, no second delivery set", rp.out.split("\n").pop() === ev1 && psql(`SELECT count(*) FROM public.launch_notification_deliveries;`).out === "2" && psql(`SELECT count(*) FROM public.launch_events;`).out === "1", rp.out || rp.err);
    check("DB-24 60-second cooldown enforced", err(as(SP, `SELECT public.partner_create_launch_watcher_update('${WS}','${L}','${R(5)}',NULL,'again');`), "wait a minute"));
    psql(`UPDATE public.launch_events SET created_at = now() - interval '2 hours';
          INSERT INTO public.launch_events (launch_id, event_type, source, scheduled_for, payload, created_at)
          SELECT '${L}','WATCHER_UPDATE','operator', now() - (g || ' minutes')::interval, jsonb_build_object('client_request_id', gen_random_uuid()::text,'body','x'), now() - interval '3 hours' - (g || ' minutes')::interval FROM generate_series(1,19) g;`);
    check("DB-25 20 per 24h cap enforced (shared with owner sends)", err(as(SP, `SELECT public.partner_create_launch_watcher_update('${WS}','${L}','${R(6)}',NULL,'cap');`), "Daily watcher update limit"));
    const hist = as(SP, `SELECT row_to_json(x)::text FROM public.partner_list_launch_watcher_updates('${WS}','${L}',999) x;`);
    check("DB-26 history clamped to 20, counts only, no identities", hist.ok && hist.out.split("\n").length === 20 && !/9000\d\d|telegram|subscription/.test(hist.out), hist.err);
    check("DB-27 history limit floor 1", as(SP, `SELECT count(*) FROM public.partner_list_launch_watcher_updates('${WS}','${L}',0);`).out === "1");
    psql(`INSERT INTO public.launch_events (launch_id, event_type, source, scheduled_for) VALUES ('${L}','LAUNCH_LIVE','lifecycle',now());`);
    check("DB-28 history shows WATCHER_UPDATE only", !as(SP, `SELECT string_agg(event_id::text, ',') FROM public.partner_list_launch_watcher_updates('${WS}','${L}',20);`).out.includes(psql(`SELECT id FROM public.launch_events WHERE event_type='LAUNCH_LIVE';`).out));
    psql(`DELETE FROM public.launch_events WHERE event_type='LAUNCH_LIVE';`);
    check("DB-29 wrapper created no non-WATCHER_UPDATE event", psql(`SELECT count(*) FROM public.launch_events WHERE event_type <> 'WATCHER_UPDATE';`).out === "0");
    check("DB-30 launch rows unchanged before/after", launchHash() === H0);

    psql(`UPDATE public.launch_events SET created_at = now() - interval '2 days';`);
    psql(`UPDATE public.partners SET status='suspended' WHERE user_id='${SP}';`);
    check("DB-31 suspended partner denied on all 4", allDenied(SP, "Not authorized"));
    psql(`UPDATE public.partners SET status='approved' WHERE user_id='${SP}';`);
    check("DB-32 reinstated partner can send again", as(SP, `SELECT public.partner_create_launch_watcher_update('${WS}','${L}','${R(7)}',NULL,'back');`).ok);
    psql(`UPDATE public.launch_events SET created_at = now() - interval '2 days';`);
    as(OWNER, `SELECT public.owner_revoke_service_partner('${accessId}');`);
    check("DB-33 revoke immediately blocks the next operation (all 4)", allDenied(SP, "Not authorized"));
    const inv2 = as(OWNER, `SELECT public.owner_invite_service_partner('${WS}','partner2@example.test','{launch_watcher_comms}');`);
    as(SP2, `SELECT public.partner_respond_client_invite('${(inv2.out.split("\n").pop() ?? "")}', false);`);
    check("DB-34 declined invite denied on all 4", allDenied(SP2, "Not authorized"));
    check("DB-35 partners never became workspace member/operator", psql(`SELECT count(*) FROM public.workspace_members WHERE user_id IN ('${SP}','${SP2}');`).out === "0" && as(SP, `SELECT public.is_workspace_member('${WS}','${SP}')::text || public.is_workspace_operator('${WS}','${SP}')::text;`).out === "falsefalse");
    check("DB-36 ACLs: no PUBLIC/anon on the 4 RPCs", psql(`SELECT count(*) FROM pg_proc WHERE proname IN ('${FNS.join("','")}') AND (array_to_string(proacl::text[], ',') ~ '(^|,)=X' OR array_to_string(proacl::text[], ',') LIKE '%anon=%');`).out === "0");
    check("DB-37 all 4 SECURITY DEFINER with empty search_path", psql(`SELECT count(*) FROM pg_proc WHERE proname IN ('${FNS.join("','")}') AND prosecdef AND proconfig = ARRAY['search_path=""'];`).out === "4");
    check("DB-38 authenticated has no table DML on launch tables", psql(`SELECT count(*) FROM information_schema.role_table_grants WHERE grantee IN ('authenticated','anon') AND table_name IN ('launches','launch_events','launch_watch_subscriptions','launch_notification_deliveries');`).out === "0");
  } catch (e) {
    check("DB-X harness", false, String(e).slice(0, 300));
  } finally {
    try { sh(`${asPg}pg_ctl -D ${dir}/data -m immediate stop >/dev/null`); } catch { /* ignore */ }
    rmSync(dir, { recursive: true, force: true });
  }
}

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
