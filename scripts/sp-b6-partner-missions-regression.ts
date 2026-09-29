/*
 * SP-B6 V1 Partner Missions (read + FUTURE defaults) regression.
 * 1) Static checks on staged SQL, untouched mission Edge/runner/webhook, frontend
 *    and changed-file scope.
 * 2) Throwaway LOCAL Postgres in /tmp (never Supabase): reuses the SP-B4 base
 *    shim, loads SP-A + SP-B3 (identity core) + SP-B6 with role-faithful
 *    authenticated/anon callers and schema-faithful mission tables/constraints.
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
const B3 = read("docs/sql/SP_B3_partner_group_broadcasts.sql");
const B6 = read("docs/sql/SP_B6_partner_missions.sql");
const RUNBOOK = read("docs/SP_B6_PARTNER_MISSIONS_RUNBOOK.md");
const LIB = read("src/lib/partner-client-access.ts");
const MLIB = read("src/lib/partner-missions.ts");
const PANEL = read("src/components/cartel/PartnerMissionsPanel.tsx");
const TG = read("src/routes/_authenticated/telegram.tsx");
const SETTINGS_LIB = read("src/lib/social-mission-settings.ts");
const code = B6.replace(/--.*$/gm, "");
const BASE_COMMIT = "9ec63ce9";

const FNS = ["partner_list_mission_state", "partner_save_mission_settings"];
const bodyOf = (name: string) => { const i = code.indexOf(`FUNCTION public.${name}(`); return code.slice(i, code.indexOf("$function$;", i)); };

/* ---------- Static: SQL ---------- */
check("S-1 staged only, not in supabase/migrations", B6.includes("STAGED ONLY. NOT APPLIED.") && !readdirSync("supabase/migrations").some((f) => /sp_b6|partner_missions/i.test(f)));
check("S-2 creates exactly the 2 partner RPCs", [...code.matchAll(/CREATE OR REPLACE FUNCTION public\.(\w+)/g)].map((m) => m[1]).sort().join(",") === [...FNS].sort().join(","));
check("S-3 no table/RLS/trigger/membership/grant/helper change", !/CREATE TABLE|ALTER TABLE|CREATE POLICY|DROP |CREATE TRIGGER|UPDATE public\.|DELETE FROM|storage\.|GRANT (SELECT|INSERT|UPDATE|DELETE|ALL) ON (TABLE )?public\.|FUNCTION public\.(is_workspace_(member|operator)|project_identity_ready|partner_has_scope)\(/i.test(code));
check("S-4 SECURITY DEFINER + empty search_path + auth.uid + missions scope", FNS.every((f) => { const b = bodyOf(f); return /SECURITY DEFINER\n SET search_path TO ''/.test(b) && b.includes("auth.uid()") && b.includes("public.partner_has_scope(_workspace_id, 'missions')"); }));
check("S-5 scope precedes every table read/write", FNS.every((f) => { const b = bodyOf(f); const s = b.indexOf("partner_has_scope"); const t = b.search(/(FROM|INTO) public\.social_/); return s > 0 && t > s; }));
check("S-6 PUBLIC/anon revoked, authenticated+service_role granted, postgres owner", FNS.every((f) => new RegExp(`REVOKE ALL ON FUNCTION public\\.${f}\\([^)]*\\) FROM PUBLIC, anon;`).test(code) && new RegExp(`GRANT EXECUTE ON FUNCTION public\\.${f}\\([^)]*\\) TO authenticated, service_role;`).test(code) && new RegExp(`ALTER FUNCTION public\\.${f}\\([^)]*\\) OWNER TO postgres;`).test(code)));
check("S-7 save: identity after scope, only social_mission_settings written, no commercial/bypass", (() => { const b = bodyOf("partner_save_mission_settings"); return b.indexOf("project_identity_ready(_workspace_id)") > b.indexOf("partner_has_scope") && (b.match(/INSERT INTO public\.(\w+)/g) ?? []).join() === "INSERT INTO public.social_mission_settings" && !/commercial|x_missions|unrestricted|is_platform_owner|usage_ledger|social_metric_snapshots/.test(b); })());
check("S-8 list is STABLE and writes nothing", /STABLE SECURITY DEFINER/.test(bodyOf("partner_list_mission_state")) && !/INSERT|UPDATE |DELETE/.test(bodyOf("partner_list_mission_state")));
check("S-9 list output keys exclude Telegram ids / payloads / created_by / request ids / errors", !/'(telegram_chat_id|telegram_user_id|telegram_message_id|metadata|availability|created_by|client_request_id|send_client_request_id|last_error|message_text_snapshot|command_message_id)'/.test(bodyOf("partner_list_mission_state")) && !/\b(m|t|e|s|p)\.(telegram_\w+|metadata|availability|created_by|last_error)\b/.test(bodyOf("partner_list_mission_state")));
check("S-10 save mirrors presets + milestone types exactly", ["'STANDARD', 'QUICK', 'MAJOR_ANNOUNCEMENT', 'LAUNCH'", "'NONE', 'VIEWS', 'LIKES', 'REPLIES', 'REPOSTS', 'TOTAL_INTERACTIONS'"].every((s) => bodyOf("partner_save_mission_settings").includes(s)) && SETTINGS_LIB.includes('["STANDARD", "QUICK", "MAJOR_ANNOUNCEMENT", "LAUNCH"]'));

/* ---------- Static: Edge untouched ---------- */
const edgeFiles = execFileSync("git", ["ls-files", "backend-source/edge-functions"], { encoding: "utf8" }).split("\n").filter(Boolean);
check("E-1 every Edge/shared file byte-identical to baseline (social-mission-telegram, runner, webhook, _shared)", edgeFiles.every((p) => execFileSync("git", ["show", `${BASE_COMMIT}:${p}`], { encoding: "utf8" }) === read(p)));
check("E-2 transport still owner/admin-membership gated (no partner branch)", !/partner/i.test(read("backend-source/edge-functions/social-mission-telegram/index.ts")) && read("backend-source/edge-functions/social-mission-telegram/index.ts").includes('if (role !== "owner" && role !== "admin")'));

/* ---------- Static: frontend ---------- */
check("F-1 all seven scopes active; none inactive", LIB.includes('ACTIVE_PARTNER_SCOPES: readonly PartnerClientScope[] = ["project_identity", "project_inbox", "launch_watcher_comms", "broadcasts", "community_management", "sticker_tools", "missions"]'));
check("F-2 /telegram unlocked for missions", LIB.includes('{ path: "/telegram", scope: "missions" }'));
check("F-3 browser: partner RPCs only; no table/Edge/Telegram/X access", MLIB.includes('"partner_list_mission_state"') && MLIB.includes('"partner_save_mission_settings"') && !/\.from\(|functions\.invoke|storage\./.test(MLIB + PANEL));
check("F-4 panel: no start/close/end/cancel/resurface/Mission Control/X connect/raw ids", !/send_mission|edit_mission|resurface|close_social|end_social|cancel_social|mission_control|Start mission|Close mission|End mission|Cancel mission|oauth|bearer|telegram_chat_id|telegram_user_id|telegram_message_id/i.test(PANEL.replace(/\/\*[\s\S]*?\*\//g, "")));
check("F-5 panel reuses validateMissionSettings and states future-only", PANEL.includes("validateMissionSettings(") && PANEL.includes("apply only to missions started after you save"));
check("F-6 managed /telegram composes Missions tab; owner page unchanged", TG.includes("<PartnerMissionsPanel />") && TG.includes('scopes.includes("missions")') && TG.includes("if (!isManaged) return <TelegramPage />;") && TG.includes("if (missions) return <PartnerMissionsPage />;"));
check("F-7 owner MissionSettingsCard and settings lib unchanged", ["src/components/cartel/MissionSettingsCard.tsx", "src/lib/social-mission-settings.ts"].every((p) => execFileSync("git", ["show", `${BASE_COMMIT}:${p}`], { encoding: "utf8" }) === read(p)));
check("F-8 runbook: staged, SQL→publish→types order, start/close deferred", RUNBOOK.includes("CP-SPB6-SQL") && RUNBOOK.includes("CP-SPB6-PUBLISH") && RUNBOOK.includes("SP-B6.1"));
const ALLOW = new Set([
  "docs/sql/SP_B6_partner_missions.sql", "src/lib/partner-missions.ts", "src/components/cartel/PartnerMissionsPanel.tsx",
  "src/routes/_authenticated/telegram.tsx", "src/lib/partner-client-access.ts",
  "src/components/cartel/ManagedAccessGuard.tsx", "src/components/cartel/SidebarNav.tsx", "src/components/cartel/ServicePartnerAccessPanel.tsx",
  "scripts/sp-b6-partner-missions-regression.ts", "docs/SP_B6_PARTNER_MISSIONS_RUNBOOK.md",
  "scripts/sp-a-managed-client-access-regression.ts", "scripts/sp-b1-partner-inbox-regression.ts", "scripts/sp-b2-partner-launch-comms-regression.ts",
  "scripts/sp-b3-partner-group-broadcasts-regression.ts", "scripts/sp-b4-partner-community-management-regression.ts",
  "scripts/sp-b5-partner-sticker-tools-regression.ts", "scripts/public-discovery-seo-regression.ts", "roadmap.md", ".lovable/plan.md",
]);
const changed = [
  ...execFileSync("git", ["diff", "--name-only", BASE_COMMIT], { encoding: "utf8" }).split("\n"),
  ...execFileSync("git", ["ls-files", "--others", "--exclude-standard"], { encoding: "utf8" }).split("\n"),
].filter(Boolean);
const outside = changed.filter((f) => !ALLOW.has(f));
check("F-9 changed files within SP-B6 allowlist", outside.length === 0, outside.join(", "));
check("F-10 no migrations / supabase integration / backend-source edits", !changed.some((f) => f.startsWith("supabase/") || f.includes("integrations/supabase") || f.startsWith("backend-source/")));

/* ---------- Local Postgres ---------- */
const hasPg = spawnSync("sh", ["-c", "command -v initdb && command -v pg_ctl && command -v psql"]).status === 0;
if (!hasPg) {
  check("DB-0 local Postgres available", false, "initdb/pg_ctl/psql not found");
} else {
  const B4SRC = read("scripts/sp-b4-partner-community-management-regression.ts");
  const baseShim = B4SRC.slice(B4SRC.indexOf("const shim = `") + "const shim = `".length, B4SRC.indexOf("CREATE TABLE public.launch_events", B4SRC.indexOf("const shim = `")));
  const dir = mkdtempSync(join(tmpdir(), "spb6-"));
  const port = 55000 + Math.floor(Math.random() * 5000);
  const env = { ...process.env, PGHOST: dir, PGPORT: String(port), PGUSER: "postgres", PGDATABASE: "postgres" };
  const sh = (cmd: string) => execSync(cmd, { env, stdio: "pipe", encoding: "utf8" });
  const asPg = process.getuid?.() === 0 ? "setpriv --reuid=1000 --regid=1000 --clear-groups " : "";
  try {
    if (process.getuid?.() === 0) sh(`chmod 777 ${dir}`);
    sh(`${asPg}initdb -D ${dir}/data -U postgres -A trust -E UTF8 --locale=C >/dev/null`);
    sh(`${asPg}pg_ctl -D ${dir}/data -o "-k ${dir} -p ${port} -c listen_addresses=''" -l ${dir}/log -w start >/dev/null`);
    const psql = (sql: string) => {
      const f = join(dir, `q${Math.random().toString(36).slice(2)}.sql`);
      writeFileSync(f, sql);
      const r = spawnSync("psql", ["-v", "ON_ERROR_STOP=1", "-qtAX", "-f", f], { env, encoding: "utf8" });
      return { ok: r.status === 0, out: (r.stdout ?? "").trim(), err: (r.stderr ?? "").trim() };
    };
    const as = (uid: string | null, sql: string) => psql(`BEGIN; SET LOCAL ROLE ${uid ? "authenticated" : "anon"}; SET LOCAL request.jwt.claims = '${uid ? JSON.stringify({ sub: uid, role: "authenticated" }) : "{}"}';\n${sql}\nCOMMIT;`);
    const err = (r: { ok: boolean; err: string }, s: string) => !r.ok && r.err.includes(s);
    const OWNER = "00000000-0000-0000-0000-00000000000a", SP = "00000000-0000-0000-0000-00000000000b", OTHER = "00000000-0000-0000-0000-00000000000c", SP2 = "00000000-0000-0000-0000-00000000000d", PLAT = "00000000-0000-0000-0000-00000000000e", MEM = "00000000-0000-0000-0000-00000000000f";
    const WS = "10000000-0000-0000-0000-000000000001", WS2 = "10000000-0000-0000-0000-000000000002";
    const G = "30000000-0000-0000-0000-000000000001", G2 = "30000000-0000-0000-0000-000000000002";
    const PO = "40000000-0000-0000-0000-000000000001", PO2 = "40000000-0000-0000-0000-000000000002";
    const M = "90000000-0000-0000-0000-000000000001", M2 = "90000000-0000-0000-0000-000000000002";
    const PP = "50000000-0000-0000-0000-000000000001";
    const shim = baseShim + `
      CREATE TABLE public.social_posts (id uuid PRIMARY KEY, workspace_id uuid NOT NULL, canonical_url text, author_handle text, metadata jsonb DEFAULT '{}');
      CREATE TABLE public.social_missions (id uuid PRIMARY KEY, workspace_id uuid NOT NULL, social_post_id uuid, status text NOT NULL, started_at timestamptz, ends_at timestamptz, completed_at timestamptz, accomplished_at timestamptz, created_by uuid, metadata jsonb DEFAULT '{}', created_at timestamptz DEFAULT now(), updated_at timestamptz DEFAULT now());
      CREATE TABLE public.social_mission_targets (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), workspace_id uuid NOT NULL, mission_id uuid NOT NULL, group_connection_id uuid, telegram_chat_id bigint, telegram_message_id bigint, delivery_state text, last_error text, sent_at timestamptz, send_client_request_id uuid, message_text_snapshot text, command_message_id bigint, created_at timestamptz DEFAULT now());
      CREATE TABLE public.social_metric_snapshots (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), workspace_id uuid NOT NULL, mission_id uuid NOT NULL, provider text, observed_at timestamptz, views bigint, likes bigint, comments bigint, shares bigint, saves bigint, availability jsonb, metadata jsonb, created_at timestamptz DEFAULT now());
      CREATE TABLE public.social_mission_schedule_events (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), workspace_id uuid NOT NULL, mission_id uuid NOT NULL, event_type text, sequence_no smallint, due_at timestamptz, state text, client_request_id uuid, telegram_message_id bigint, finished_at timestamptz, last_error text);
      CREATE TABLE public.social_mission_settings (
        workspace_id uuid PRIMARY KEY, default_preset text NOT NULL DEFAULT 'STANDARD', live_metrics_enabled boolean NOT NULL DEFAULT true,
        link_finder_enabled boolean NOT NULL DEFAULT true, delete_command_after_send boolean NOT NULL DEFAULT true, auto_pin_mission boolean NOT NULL DEFAULT true,
        milestone_type text NOT NULL DEFAULT 'NONE', milestone_target integer, created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(),
        CHECK (default_preset IN ('STANDARD','QUICK','MAJOR_ANNOUNCEMENT','LAUNCH')),
        CHECK (milestone_type IN ('NONE','VIEWS','LIKES','REPLIES','REPOSTS','TOTAL_INTERACTIONS')),
        CHECK ((milestone_type = 'NONE' AND milestone_target IS NULL) OR (milestone_type <> 'NONE' AND milestone_target IS NOT NULL AND milestone_target > 0)));
      GRANT SELECT, INSERT, UPDATE ON public.social_mission_settings TO authenticated;
      ALTER TABLE public.social_mission_settings ENABLE ROW LEVEL SECURITY; ALTER TABLE public.social_mission_settings FORCE ROW LEVEL SECURITY;
      CREATE POLICY sms_sel ON public.social_mission_settings FOR SELECT TO authenticated USING (public.is_workspace_member(workspace_id, auth.uid()));
      CREATE POLICY sms_ins ON public.social_mission_settings FOR INSERT TO authenticated WITH CHECK (public.is_workspace_operator(workspace_id, auth.uid()));
      CREATE POLICY sms_upd ON public.social_mission_settings FOR UPDATE TO authenticated USING (public.is_workspace_operator(workspace_id, auth.uid())) WITH CHECK (public.is_workspace_operator(workspace_id, auth.uid()));
      ALTER TABLE public.social_missions ENABLE ROW LEVEL SECURITY; ALTER TABLE public.social_mission_targets ENABLE ROW LEVEL SECURITY;
      ALTER TABLE public.social_metric_snapshots ENABLE ROW LEVEL SECURITY; ALTER TABLE public.social_mission_schedule_events ENABLE ROW LEVEL SECURITY; ALTER TABLE public.social_posts ENABLE ROW LEVEL SECURITY;
      CREATE FUNCTION public.social_mission_preset_config(_p text) RETURNS jsonb LANGUAGE sql IMMUTABLE AS $f$ SELECT jsonb_build_object('preset', coalesce(_p,'STANDARD'), 'duration_minutes', 45, 'pulse_offsets', jsonb_build_array(3,8)) $f$;
      CREATE FUNCTION public.social_mission_effective_config(_mission_id uuid) RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public' AS $f$
        DECLARE v jsonb; BEGIN SELECT metadata -> 'effective_config' INTO v FROM public.social_missions WHERE id = _mission_id;
        IF v IS NULL OR jsonb_typeof(v) <> 'object' THEN RETURN public.social_mission_preset_config('STANDARD'); END IF; RETURN v; END $f$;
      REVOKE ALL ON FUNCTION public.social_mission_effective_config(uuid) FROM PUBLIC;
      CREATE TABLE public.usage_ledger (id uuid PRIMARY KEY DEFAULT gen_random_uuid());
      INSERT INTO auth.users VALUES ('${OWNER}','owner@example.test'),('${SP}','partner@example.test'),('${OTHER}','other@example.test'),('${SP2}','partner2@example.test'),('${PLAT}','plat@example.test'),('${MEM}','member@example.test');
      INSERT INTO public.workspaces VALUES ('${WS}','Client One','client-one','${OWNER}',now()),('${WS2}','Other Co','other-co','${OTHER}',now());
      INSERT INTO public.workspace_members VALUES ('${WS}','${OWNER}','owner'),('${WS2}','${OTHER}','owner'),('${WS}','${MEM}','member');
      INSERT INTO public.partners (user_id, is_service_partner, status) VALUES ('${SP}',true,'approved'),('${SP2}',true,'approved');
      INSERT INTO public.partner_program_terms (status, service_partner_applications_open) VALUES ('active', true);
      INSERT INTO public.platform_unrestricted VALUES ('${PLAT}');
      INSERT INTO public.project_profiles (id, workspace_id, public_slug, project_name, discovery_status) VALUES ('${PP}','${WS}','client-one','Client One','published');
      INSERT INTO public.telegram_group_connections (id, workspace_id, telegram_chat_id, title, username, chat_type, bot_is_admin, metadata) VALUES
        ('${G}','${WS}',-1001111,'Client Main','clientmain','supergroup',true,'{}'),('${G2}','${WS2}',-1002222,'Other Main','othermain','supergroup',true,'{}');
      INSERT INTO public.social_posts VALUES ('${PO}','${WS}','https://x.com/client/status/1','client','{"raw":"PROVIDER_RAW"}'),('${PO2}','${WS2}','https://x.com/other/status/2','other','{}');
      INSERT INTO public.social_missions (id, workspace_id, social_post_id, status, started_at, ends_at, completed_at, created_by, metadata) VALUES
        ('${M}','${WS}','${PO}','COMPLETED',now()-interval '2 hour',now()-interval '1 hour',now()-interval '1 hour','${OWNER}','{"telegram_update_id":777001,"effective_config":{"preset":"QUICK","duration_minutes":20,"pulse_offsets":[2],"milestone_type":"VIEWS","milestone_target":500}}'),
        ('${M2}','${WS2}','${PO2}','COMPLETED',now(),now(),now(),'${OTHER}','{}');
      INSERT INTO public.social_mission_targets (workspace_id, mission_id, group_connection_id, telegram_chat_id, telegram_message_id, delivery_state, last_error, sent_at, send_client_request_id, message_text_snapshot, command_message_id) VALUES
        ('${WS}','${M}','${G}',-1001111,888001,'SENT','TG_INTERNAL_ERR',now(),gen_random_uuid(),'SNAPSHOT_TEXT',999001),('${WS2}','${M2}','${G2}',-1002222,888002,'SENT',NULL,now(),NULL,NULL,NULL);
      INSERT INTO public.social_metric_snapshots (workspace_id, mission_id, provider, observed_at, views, likes, comments, shares, saves, availability, metadata) VALUES
        ('${WS}','${M}','x',now()-interval '90 min',100,5,1,1,0,'{"raw":"AVAIL_BLOB"}','{"raw":"SNAP_META"}'),('${WS}','${M}','x',now()-interval '61 min',640,30,4,3,2,'{}','{}'),('${WS2}','${M2}','x',now(),9,9,9,9,9,'{}','{}');
      INSERT INTO public.social_mission_schedule_events (workspace_id, mission_id, event_type, sequence_no, due_at, state, client_request_id, telegram_message_id, finished_at, last_error) VALUES
        ('${WS}','${M}','PULSE',1,now()-interval '100 min','SENT',gen_random_uuid(),888111,now()-interval '100 min','EVT_INTERNAL_ERR'),('${WS2}','${M2}','PULSE',1,now(),'SENT',NULL,NULL,NULL,NULL);`;
    const loaded = psql(shim);
    check("DB-0 shim loads", loaded.ok, loaded.err.slice(0, 300));
    check("DB-1 SP-A + SP-B3 (identity core) apply", psql(SPA).ok && psql(B3).ok);
    const applied = psql(B6);
    check("DB-2 SP-B6 applies", applied.ok, applied.err.slice(0, 300));

    const good = `'{"default_preset":"LAUNCH","live_metrics_enabled":false,"link_finder_enabled":true,"delete_command_after_send":false,"auto_pin_mission":true,"milestone_type":"LIKES","milestone_target":250}'::jsonb`;
    const calls = (ws: string) => [`SELECT public.partner_list_mission_state('${ws}');`, `SELECT public.partner_save_mission_settings('${ws}', ${good});`];
    const allDenied = (uid: string | null, msg: string, ws = WS) => calls(ws).every((q) => err(as(uid, q), msg));
    check("DB-3 anon denied on both", allDenied(null, "permission denied"));
    check("DB-4 partner with no grant denied", allDenied(SP, "Not authorized"));
    check("DB-5 workspace owner (not a partner) denied on partner RPCs", allDenied(OWNER, "Not authorized"));
    check("DB-6 platform owner gets NO partner bypass", allDenied(PLAT, "Not authorized"));

    const inv = as(OWNER, `SELECT public.owner_invite_service_partner('${WS}','partner@example.test','{project_identity,missions}');`);
    const accessId = inv.out.split("\n").pop() ?? "";
    check("DB-7 pending invite denied", allDenied(SP, "Not authorized"));
    const decl = as(OWNER, `SELECT public.owner_invite_service_partner('${WS}','partner2@example.test','{project_identity,missions}');`).out.split("\n").pop() ?? "";
    as(SP2, `SELECT public.partner_respond_client_invite('${decl}', false);`);
    check("DB-8 declined invite denied", allDenied(SP2, "Not authorized"));
    as(SP, `SELECT public.partner_respond_client_invite('${accessId}', true);`);
    as(OWNER, `SELECT public.owner_update_partner_scopes('${accessId}','{project_identity,broadcasts,sticker_tools}');`);
    check("DB-9 active grant WITHOUT missions denied", allDenied(SP, "Not authorized"));
    as(OWNER, `SELECT public.owner_update_partner_scopes('${accessId}','{project_identity,missions}');`);
    check("DB-10 cross-workspace denied scope-first", allDenied(SP, "Not authorized", WS2));

    const counts = () => psql(`SELECT (SELECT count(*) FROM public.social_missions)||','||(SELECT count(*) FROM public.social_mission_targets)||','||(SELECT count(*) FROM public.social_metric_snapshots)||','||(SELECT count(*) FROM public.social_mission_schedule_events)||','||(SELECT count(*) FROM public.usage_ledger)||','||(SELECT md5(string_agg(t::text, '' ORDER BY id)) FROM public.social_missions t)||(SELECT md5(string_agg(t::text, '' ORDER BY id)) FROM public.social_mission_targets t);`).out;
    const before = counts();
    const st = as(SP, `SELECT public.partner_list_mission_state('${WS}')::text;`);
    const sj = st.ok ? JSON.parse(st.out) : { missions: [], settings: {} };
    check("DB-11 list: only client missions", st.ok && sj.missions.length === 1 && sj.missions[0].id === M, st.out || st.err);
    check("DB-12 list: latest metrics mapped (replies/reposts/bookmarks)", sj.missions[0]?.latest_metrics?.views === 640 && sj.missions[0].latest_metrics.replies === 4 && sj.missions[0].latest_metrics.reposts === 3 && sj.missions[0].latest_metrics.bookmarks === 2);
    check("DB-13 list: snapshotted goal", sj.missions[0]?.goal?.preset === "QUICK" && sj.missions[0].goal.milestone_type === "VIEWS" && sj.missions[0].goal.milestone_target === 500);
    check("DB-14 list: group title + opaque id only; other-workspace group never shown", sj.missions[0]?.targets?.length === 1 && sj.missions[0].targets[0].group_title === "Client Main" && Object.keys(sj.missions[0].targets[0]).sort().join(",") === "delivery_state,group_connection_id,group_title,sent_at" && !st.out.includes("Other Main"));
    check("DB-15 list: timeline safe keys", Object.keys(sj.missions[0]?.timeline?.[0] ?? {}).sort().join(",") === "due_at,event_type,finished_at,sequence_no,state");
    check("DB-16 no Telegram ids / message ids / payloads / errors / created_by / request ids", !/-100|888|999001|777001|PROVIDER_RAW|AVAIL_BLOB|SNAP_META|INTERNAL_ERR|SNAPSHOT_TEXT|created_by|telegram_|metadata|availability|client_request_id|last_error|clientmain/.test(st.out) && !st.out.includes(OWNER));
    check("DB-17 system defaults when no settings row", sj.settings?.default_preset === "STANDARD" && sj.settings.milestone_type === "NONE" && sj.settings.milestone_target === null && sj.settings.saved === false && sj.settings.live_metrics_enabled === true);
    check("DB-18 list is read-only (no row/usage/snapshot change)", counts() === before);

    const save = (json: string) => as(SP, `SELECT public.partner_save_mission_settings('${WS}', '${json}'::jsonb)::text;`);
    const base = { default_preset: "STANDARD", live_metrics_enabled: true, link_finder_enabled: true, delete_command_after_send: true, auto_pin_mission: true, milestone_type: "NONE", milestone_target: null as unknown };
    const v = (o: Record<string, unknown>) => JSON.stringify({ ...base, ...o });
    check("DB-19 invalid preset rejected", err(save(v({ default_preset: "HUGE" })), "INVALID_PRESET") && err(save(v({ default_preset: null })), "INVALID_PRESET"));
    check("DB-20 invalid milestone type rejected", err(save(v({ milestone_type: "FOLLOWERS", milestone_target: 5 })), "INVALID_MILESTONE_TYPE"));
    check("DB-21 NONE with target rejected (owner: 'Turn the Primary Goal on')", err(save(v({ milestone_target: 5 })), "INVALID_MILESTONE_TARGET"));
    check("DB-22 goal target boundaries: 0, -1, 1.5, string, missing rejected", [0, -1, 1.5, "10", null].every((t) => err(save(v({ milestone_type: "VIEWS", milestone_target: t })), "INVALID_MILESTONE_TARGET")));
    check("DB-23 goal target over int range rejected", err(save(v({ milestone_type: "VIEWS", milestone_target: 2147483648 })), "INVALID_MILESTONE_TARGET"));
    check("DB-24 non-boolean / missing toggle rejected", err(save(v({ live_metrics_enabled: "yes" })), "INVALID_TOGGLE") && err(save(JSON.stringify({ default_preset: "STANDARD", milestone_type: "NONE" })), "INVALID_TOGGLE"));
    check("DB-25 target 1 and 2147483647 accepted", save(v({ milestone_type: "REPLIES", milestone_target: 1 })).ok && save(v({ milestone_type: "TOTAL_INTERACTIONS", milestone_target: 2147483647 })).ok);
    const ok = as(SP, `SELECT public.partner_save_mission_settings('${WS}', ${good})::text;`);
    const oj = ok.ok ? JSON.parse(ok.out) : {};
    check("DB-26 valid save returns saved + normalized settings only", ok.ok && oj.saved === true && oj.settings.default_preset === "LAUNCH" && oj.settings.milestone_target === 250 && Object.keys(oj).sort().join(",") === "saved,settings", ok.out || ok.err);
    const row = psql(`SELECT default_preset||','||live_metrics_enabled||','||milestone_type||','||milestone_target||','||(SELECT count(*) FROM public.social_mission_settings) FROM public.social_mission_settings WHERE workspace_id='${WS}';`).out;
    check("DB-27 exactly one client settings row upserted", row === "LAUNCH,false,LIKES,250,1", row);
    check("DB-28 save mutated no mission/target/snapshot/schedule/usage row", counts() === before);
    check("DB-29 list reflects saved defaults", JSON.parse(as(SP, `SELECT public.partner_list_mission_state('${WS}')::text;`).out).settings.saved === true);
    psql(`UPDATE public.project_profiles SET project_name = NULL WHERE workspace_id='${WS}';`);
    check("DB-30 Project Identity required to save", err(save(v({})), "PROJECT_IDENTITY_REQUIRED"));
    psql(`UPDATE public.project_profiles SET project_name = 'Client One' WHERE workspace_id='${WS}';`);
    psql(`INSERT INTO public.platform_unrestricted VALUES ('${SP}');`);
    as(OWNER, `SELECT public.owner_update_partner_scopes('${accessId}','{project_identity}');`);
    check("DB-31 unrestricted flag does not bypass missing scope", allDenied(SP, "Not authorized"));
    psql(`DELETE FROM public.platform_unrestricted WHERE user_id='${SP}';`);
    as(OWNER, `SELECT public.owner_update_partner_scopes('${accessId}','{project_identity,missions}');`);

    check("DB-32 partner has no direct table access (RLS: not a member)", as(SP, `SELECT count(*) FROM public.social_mission_settings;`).out === "0" && !as(SP, `INSERT INTO public.social_mission_settings (workspace_id) VALUES ('${WS}') ON CONFLICT (workspace_id) DO UPDATE SET default_preset='QUICK';`).ok);
    check("DB-33 owner direct table write still works", as(OWNER, `UPDATE public.social_mission_settings SET default_preset='MAJOR_ANNOUNCEMENT' WHERE workspace_id='${WS}';`).ok && psql(`SELECT default_preset FROM public.social_mission_settings WHERE workspace_id='${WS}';`).out === "MAJOR_ANNOUNCEMENT");
    check("DB-34 non-operator member stays read-only", as(MEM, `SELECT count(*) FROM public.social_mission_settings;`).out === "1" && as(MEM, `UPDATE public.social_mission_settings SET default_preset='QUICK' WHERE workspace_id='${WS}' RETURNING 1;`).out === "" && err(as(MEM, `SELECT public.partner_list_mission_state('${WS}');`), "Not authorized"));
    check("DB-35 partner stays outside workspace_members", psql(`SELECT count(*) FROM public.workspace_members WHERE user_id='${SP}';`).out === "0");

    as(OWNER, `SELECT public.owner_revoke_partner_access('${accessId}');`);
    check("DB-36 revoke immediately blocks next read + save", allDenied(SP, "Not authorized"));
    psql(`UPDATE public.partner_client_access SET status='active', revoked_at=NULL WHERE id='${accessId}';`);
    const susp = psql(`UPDATE public.partners SET status='suspended' WHERE user_id='${SP}';`);
    check("DB-37 suspended partner denied", susp.ok && allDenied(SP, "Not authorized"));

    const mcFns = ["create_social_mission_from_telegram_link", "close_social_mission_from_telegram", "end_social_mission_from_control", "cancel_social_mission_from_control", "social_mission_apply_target_override", "social_mission_apply_duration_override", "record_social_mission_metric_snapshot"];
    check("DB-38 SP-B6 grants no Mission Control / start / close / snapshot function", !mcFns.some((f) => code.includes(f)));
    check("DB-39 exactly 2 new authenticated-executable definer RPCs (advisor 0029 +2)", psql(`SELECT count(*) FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname='public' AND p.proname LIKE 'partner_%mission%' AND p.prosecdef AND has_function_privilege('authenticated', p.oid, 'EXECUTE') AND NOT has_function_privilege('anon', p.oid, 'EXECUTE');`).out === "2");
  } finally {
    try { sh(`${asPg}pg_ctl -D ${dir}/data -m immediate stop >/dev/null`); } catch { /* ignore */ }
    rmSync(dir, { recursive: true, force: true });
  }
}

console.log(`\n${passed} passed, ${failed} failed`);
if (failed) process.exit(1);
