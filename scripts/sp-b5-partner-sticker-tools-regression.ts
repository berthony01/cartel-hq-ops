/*
 * SP-B5 V1 Partner Sticker Tools (Sticker Drops management) regression.
 * 1) Static checks on staged SQL, staged sticker-drop-config Edge source,
 *    untouched worker/AI/publish functions, frontend and changed-file scope.
 * 2) Throwaway LOCAL Postgres in /tmp (never Supabase): reuses the SP-B4 base
 *    shim, loads SP-A + SP-B3 (identity core) + SP-B5 with role-faithful
 *    authenticated/anon callers, plus a copy of the live
 *    validate_sticker_drop_schedule trigger. The SP-B0 commercial core is
 *    stubbed by a controllable table, so allow/deny/limit mapping is exercised;
 *    the real evaluator is not.
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
const B5 = read("docs/sql/SP_B5_partner_sticker_tools.sql");
const EDGE_PATH = "backend-source/edge-functions/sticker-drop-config/index.ts";
const EDGE = read(EDGE_PATH);
const RUNBOOK = read("docs/SP_B5_PARTNER_STICKER_TOOLS_RUNBOOK.md");
const LIB = read("src/lib/partner-client-access.ts");
const SLIB = read("src/lib/partner-sticker-drops.ts");
const PANEL = read("src/components/cartel/PartnerStickerDropsPanel.tsx");
const TG = read("src/routes/_authenticated/telegram.tsx");
const code = B5.replace(/--.*$/gm, "");
const PLAN_COMMIT = "0251aa7c92c33f3ff9e8f13a011800c9a9becda3";
const EDGE_BASELINE_CHARS = 11879; // repo == deployed v29 at start gate

const FNS = ["partner_list_sticker_drop_packs", "partner_list_sticker_drop_state", "partner_authorize_sticker_drop_action"];
const bodyOf = (name: string) => { const i = code.indexOf(`FUNCTION public.${name}(`); return code.slice(i, code.indexOf("$function$;", i)); };

/* ---------- Static: SQL ---------- */
check("S-1 staged only, not in supabase/migrations", B5.includes("STAGED ONLY. NOT APPLIED.") && !readdirSync("supabase/migrations").some((f) => /sp_b5|sticker_tools/i.test(f)));
check("S-2 creates exactly the 3 partner RPCs", [...code.matchAll(/CREATE OR REPLACE FUNCTION public\.(\w+)/g)].map((m) => m[1]).sort().join(",") === [...FNS].sort().join(","));
check("S-3 no table/RLS/storage/trigger/membership/DML/helper change", !/CREATE TABLE|ALTER TABLE|CREATE POLICY|DROP |CREATE TRIGGER|INSERT INTO|UPDATE public\.|DELETE FROM|storage\.|GRANT (SELECT|INSERT|UPDATE|DELETE|ALL) ON (TABLE )?public\.|FUNCTION public\.(is_workspace_(member|operator)|can_use_project_tools|project_identity_ready|validate_sticker_drop_schedule)\(/i.test(code));
check("S-4 SECURITY DEFINER + empty search_path + auth.uid + sticker_tools scope", FNS.every((f) => { const b = bodyOf(f); return /SECURITY DEFINER\n SET search_path TO ''/.test(b) && b.includes("auth.uid()") && b.includes("public.partner_has_scope(_workspace_id, 'sticker_tools')"); }));
check("S-5 scope precedes every table read", FNS.every((f) => { const b = bodyOf(f); const s = b.indexOf("partner_has_scope"); const t = b.search(/FROM public\.(telegram_|sticker)/); return s > 0 && t > s; }));
check("S-6 PUBLIC/anon revoked, authenticated+service_role granted, postgres owner", FNS.every((f) => new RegExp(`REVOKE ALL ON FUNCTION public\\.${f}\\([^)]*\\) FROM PUBLIC, anon;`).test(code) && new RegExp(`GRANT EXECUTE ON FUNCTION public\\.${f}\\([^)]*\\) TO authenticated, service_role;`).test(code) && new RegExp(`ALTER FUNCTION public\\.${f}\\([^)]*\\) OWNER TO postgres;`).test(code)));
check("S-7 authorize: exact action allow-list, targets in workspace, ungated disable/delete, identity then sticker_drops, no bypass", (() => { const b = bodyOf("partner_authorize_sticker_drop_action"); const a = b.indexOf("NOT IN ('save_schedule', 'set_schedule_enabled', 'delete_schedule')"), g = b.indexOf("g.workspace_id = _workspace_id"), p = b.indexOf("p.telegram_set_name IS NOT NULL"), sc = b.indexOf("d.workspace_id = _workspace_id"), u = b.indexOf("_enabled IS NOT TRUE"), i = b.indexOf("project_identity_ready"), c = b.indexOf("commercial_evaluate_workspace_feature(_workspace_id, 'sticker_drops'"); return a > 0 && g > a && p > g && sc > p && u > sc && i > u && c > i && !/unrestricted|is_platform_owner|evaluate_commercial_access\(/.test(b); })());
check("S-8 read outputs never include Telegram/storage sensitive keys", ["partner_list_sticker_drop_packs", "partner_list_sticker_drop_state"].every((f) => { const outs = [...bodyOf(f).matchAll(/jsonb_build_object\(([\s\S]*?)\)/g)].map((m) => m[1]).join(" "); return !/'(telegram_chat_id|username|metadata|telegram_message_id|telegram_file_id|telegram_set_name|telegram_set_url|created_by|image_asset_id|storage_path|object_path)'/.test(outs); }));

/* ---------- Static: Edge ---------- */
const edgeBase = execFileSync("git", ["show", `${PLAN_COMMIT}:${EDGE_PATH}`], { encoding: "utf8" });
check("E-0 staging baseline equals start-gate size (deployed v29; file adds one trailing newline)", edgeBase.replace(/\n$/, "").length === EDGE_BASELINE_CHARS, String(edgeBase.length));
check("E-1 partner branch only for non-member + save/enable/delete; others FORBIDDEN", EDGE.includes('if (action !== "save_schedule" && action !== "set_schedule_enabled" && action !== "delete_schedule") return respond({ error: "FORBIDDEN"') && EDGE.indexOf("let partnerStickerAuthorized = false;") < EDGE.indexOf('if (action === "status") return respond(await loadState());'));
check("E-2 partner gate uses user-JWT client RPC", EDGE.includes('userClient.rpc("partner_authorize_sticker_drop_action"'));
check("E-3 Gate B skipped only for partner-authorized requests", EDGE.includes('if (!partnerStickerAuthorized && (action === "save_schedule" || (action === "set_schedule_enabled" && body.enabled === true))) {'));
check("E-4 kill switch never reachable by partner (non-member returns before it)", !/partnerStickerAuthorized[^\n]*kill/.test(EDGE) && EDGE.includes('if (action === "set_kill_switch") {'));
check("E-5 partner responses omit loadState", ["saved: true, scheduleId: saved.id", "updated: true, scheduleId: data.id", "deleted: true, scheduleId"].every((s) => EDGE.includes(`if (partnerStickerAuthorized) return respond({ ${s}`)) && !/if \(partnerStickerAuthorized\) return respond\([^\n]*loadState/.test(EDGE));
check("E-6 owner validation unchanged (interval 15..720, cap 1..24, tz, hours, approved_only, disabled insert, created_by)", ["intervalMinutes < 15 || intervalMinutes > 720", "dailyCap < 1 || dailyCap > 24", "if (!validTimezone(timezone))", "if (!validTime(activeStart) || !validTime(activeEnd))", "approved_only: true,", "created_by: authData.user.id, enabled: false"].every((s) => EDGE.includes(s) && edgeBase.includes(s)));
const base = edgeBase.split("\n"), now = EDGE.split("\n");
const removed = base.filter((l) => !now.includes(l));
check("E-7 only 5 owner lines replaced (membership deny, canManage, role, Gate B condition) — rest additive", removed.length <= 5 && removed.every((l) => /if \(!membership\) return respond|const canManage = membership\.role|role: membership\.role|if \(action === "save_schedule" \|\| \(action === "set_schedule_enabled"/.test(l)), removed.join(" | "));
check("E-8 one write path per action (no duplicate engine)", (EDGE.match(/\.insert\(\{ \.\.\.mutableFields/g) ?? []).length === 1 && (EDGE.match(/from\("sticker_drop_schedules"\)\s*\.delete\(/g) ?? []).length === 1);
const untouched = ["sticker-drops", "telegram-stickers", "sticker-ai", "sticker-motion-ai", "sticker-motion-telegram", "sticker-concepts", "telegram-group"].map((f) => `backend-source/edge-functions/${f}/index.ts`);
check("E-9 worker, publish/test-send, all paid AI and telegram-group functions byte-identical", untouched.every((p) => execFileSync("git", ["show", `${PLAN_COMMIT}:${p}`], { encoding: "utf8" }) === read(p)));
const WORKER = read("backend-source/edge-functions/sticker-drops/index.ts");
check("E-10 worker still sends via sendSticker; no sendDocument fallback", WORKER.includes('"sendSticker"') && !WORKER.includes("sendDocument"));

/* ---------- Static: frontend ---------- */
check("F-1 sticker_tools active; missions inactive", LIB.includes('ACTIVE_PARTNER_SCOPES: readonly PartnerClientScope[] = ["project_identity", "project_inbox", "launch_watcher_comms", "broadcasts", "community_management", "sticker_tools"]'));
check("F-2 /telegram unlocked for sticker_tools", LIB.includes('{ path: "/telegram", scope: "sticker_tools" }'));
check("F-3 browser: partner RPCs + existing Edge actions only; no direct table/storage access", SLIB.includes('"partner_list_sticker_drop_packs"') && SLIB.includes('"partner_list_sticker_drop_state"') && SLIB.includes('invoke("sticker-drop-config"') && !/from\(|storage\.|set_kill_switch|"status"/.test(SLIB + PANEL));
check("F-4 panel: no AI/publish/upload/test-send/kill-switch/images/raw ids", !/sticker-ai|motion|concept|generate|publish\(|upload|send_test|killSwitch|set_kill_switch|<img|image_asset|telegram_file_id|telegram_chat_id|signedUrl/i.test(PANEL.replace(/\/\*[\s\S]*?\*\//g, "")));
check("F-5 panel: 15..720, 1..24, confirm dialog, disabled-by-default copy", PANEL.includes("DROP_INTERVAL_MIN") && PANEL.includes("DROP_DAILY_CAP_MAX") && PANEL.includes("AlertDialog") && PANEL.includes("New schedules start switched off"));
check("F-6 managed /telegram composes Sticker Drops tab; owner page unchanged", TG.includes("<PartnerStickerDropsPanel />") && TG.includes('scopes.includes("sticker_tools")') && TG.includes("if (!isManaged) return <TelegramPage />;"));
check("F-7 runbook orders SQL + EDGE + publish checkpoints", ["CP-SPB5-SQL", "CP-SPB5-EDGE", "CP-SPB5-PUBLISH"].every((c) => RUNBOOK.includes(c)));

const ALLOW = new Set([
  "docs/sql/SP_B5_partner_sticker_tools.sql", EDGE_PATH, "src/lib/partner-sticker-drops.ts",
  "src/components/cartel/PartnerStickerDropsPanel.tsx", "src/routes/_authenticated/telegram.tsx", "src/lib/partner-client-access.ts",
  "src/components/cartel/ManagedAccessGuard.tsx", "src/components/cartel/SidebarNav.tsx", "src/components/cartel/ServicePartnerAccessPanel.tsx",
  "scripts/sp-b5-partner-sticker-tools-regression.ts", "docs/SP_B5_PARTNER_STICKER_TOOLS_RUNBOOK.md",
  "scripts/sp-a-managed-client-access-regression.ts", "scripts/sp-b1-partner-inbox-regression.ts", "scripts/sp-b2-partner-launch-comms-regression.ts",
  "scripts/sp-b3-partner-group-broadcasts-regression.ts", "scripts/sp-b4-partner-community-management-regression.ts",
  "scripts/public-discovery-seo-regression.ts", "roadmap.md", ".lovable/plan.md",
]);
const changed = [
  ...execFileSync("git", ["diff", "--name-only", PLAN_COMMIT], { encoding: "utf8" }).split("\n"),
  ...execFileSync("git", ["ls-files", "--others", "--exclude-standard"], { encoding: "utf8" }).split("\n"),
].filter(Boolean);
const outside = changed.filter((f) => !ALLOW.has(f));
check("F-8 changed files within SP-B5 allowlist", outside.length === 0, outside.join(", "));
check("F-9 no migrations / supabase integration / other Edge function edits", !changed.some((f) => f.startsWith("supabase/") || f.includes("integrations/supabase") || (f.startsWith("backend-source/") && f !== EDGE_PATH)));

/* ---------- Local Postgres ---------- */
const hasPg = spawnSync("sh", ["-c", "command -v initdb && command -v pg_ctl && command -v psql"]).status === 0;
if (!hasPg) {
  check("DB-0 local Postgres available", false, "initdb/pg_ctl/psql not found");
} else {
  const B4SRC = read("scripts/sp-b4-partner-community-management-regression.ts");
  const baseShim = B4SRC.slice(B4SRC.indexOf("const shim = `") + "const shim = `".length, B4SRC.indexOf("CREATE TABLE public.launch_events", B4SRC.indexOf("const shim = `")));
  const dir = mkdtempSync(join(tmpdir(), "spb5-"));
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
    const OWNER = "00000000-0000-0000-0000-00000000000a", SP = "00000000-0000-0000-0000-00000000000b", OTHER = "00000000-0000-0000-0000-00000000000c", SP2 = "00000000-0000-0000-0000-00000000000d", PLAT = "00000000-0000-0000-0000-00000000000e";
    const WS = "10000000-0000-0000-0000-000000000001", WS2 = "10000000-0000-0000-0000-000000000002";
    const G = "30000000-0000-0000-0000-000000000001", G2 = "30000000-0000-0000-0000-000000000002", GR = "30000000-0000-0000-0000-000000000003";
    const P = "60000000-0000-0000-0000-000000000001", P2 = "60000000-0000-0000-0000-000000000002", PU = "60000000-0000-0000-0000-000000000003";
    const S1 = "70000000-0000-0000-0000-000000000001", S2 = "70000000-0000-0000-0000-000000000002", SX = "70000000-0000-0000-0000-000000000009", SU = "70000000-0000-0000-0000-000000000003";
    const D = "80000000-0000-0000-0000-000000000001", D2 = "80000000-0000-0000-0000-000000000002";
    const PP = "50000000-0000-0000-0000-000000000001";
    const shim = baseShim + `
      CREATE TABLE public.sticker_packs (id uuid PRIMARY KEY, workspace_id uuid NOT NULL, title text, theme text, status text, telegram_set_name text, telegram_set_url text, telegram_published_at timestamptz, reference_asset_id uuid, archived_at timestamptz, updated_at timestamptz DEFAULT now());
      CREATE TABLE public.stickers (id uuid PRIMARY KEY, pack_id uuid NOT NULL, sort_order int, label text, emoji_list text[], status text, image_asset_id uuid, telegram_file_id text);
      CREATE TABLE public.sticker_drop_schedules (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), workspace_id uuid NOT NULL, group_connection_id uuid NOT NULL, pack_id uuid NOT NULL, created_by uuid, enabled boolean NOT NULL DEFAULT false, interval_minutes int NOT NULL CHECK (interval_minutes BETWEEN 15 AND 720), timezone text NOT NULL DEFAULT 'UTC', active_start time NOT NULL DEFAULT '08:00', active_end time NOT NULL DEFAULT '23:00', daily_cap smallint NOT NULL CHECK (daily_cap BETWEEN 1 AND 24), silent boolean NOT NULL DEFAULT true, approved_only boolean NOT NULL DEFAULT true CHECK (approved_only = true), no_immediate_repeat boolean NOT NULL DEFAULT true, selected_sticker_ids uuid[] NOT NULL DEFAULT '{}', last_sticker_id uuid, last_sent_at timestamptz, next_run_at timestamptz, consecutive_failures int NOT NULL DEFAULT 0, paused_reason text, created_at timestamptz DEFAULT now(), updated_at timestamptz DEFAULT now(), UNIQUE (workspace_id, group_connection_id));
      CREATE TABLE public.sticker_drop_events (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), schedule_id uuid, workspace_id uuid NOT NULL, group_connection_id uuid, pack_id uuid, sticker_id uuid, status text, local_date date, telegram_message_id bigint, error_message text, created_at timestamptz DEFAULT now());
      CREATE TABLE public.sticker_drop_workspace_controls (workspace_id uuid PRIMARY KEY, kill_switch boolean NOT NULL DEFAULT false, updated_by uuid, updated_at timestamptz DEFAULT now());
      ALTER TABLE public.sticker_packs ENABLE ROW LEVEL SECURITY; ALTER TABLE public.stickers ENABLE ROW LEVEL SECURITY;
      ALTER TABLE public.sticker_drop_schedules ENABLE ROW LEVEL SECURITY; ALTER TABLE public.sticker_drop_events ENABLE ROW LEVEL SECURITY; ALTER TABLE public.sticker_drop_workspace_controls ENABLE ROW LEVEL SECURITY;
      -- Copy of the live ownership trigger (enforced for every writer).
      CREATE FUNCTION public.validate_sticker_drop_schedule() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $v$
      declare _pw uuid; _ps text; _pn text; _gw uuid; _bad int;
      begin
        select workspace_id, status, telegram_set_name into _pw, _ps, _pn from public.sticker_packs where id = new.pack_id;
        if _pw is null or _pw <> new.workspace_id then raise exception 'Sticker pack does not belong to this workspace.'; end if;
        if _ps <> 'published' or _pn is null then raise exception 'Sticker Drops require a published Telegram sticker pack.'; end if;
        select workspace_id into _gw from public.telegram_group_connections where id = new.group_connection_id;
        if _gw is null or _gw <> new.workspace_id then raise exception 'Telegram group does not belong to this workspace.'; end if;
        if cardinality(new.selected_sticker_ids) > 0 then
          select count(*) into _bad from unnest(new.selected_sticker_ids) sid left join public.stickers s on s.id = sid
          where s.id is null or s.pack_id <> new.pack_id or s.status <> 'published' or s.telegram_file_id is null;
          if _bad > 0 then raise exception 'Selected Sticker Drop items must be published Telegram stickers from this pack.'; end if;
        end if;
        return new;
      end $v$;
      CREATE TRIGGER validate_sticker_drop_schedule_before_write BEFORE INSERT OR UPDATE ON public.sticker_drop_schedules FOR EACH ROW EXECUTE FUNCTION public.validate_sticker_drop_schedule();
      CREATE TABLE public.telegram_group_announcements_x (id int);
      CREATE TABLE public.launch_events (id uuid PRIMARY KEY DEFAULT gen_random_uuid());
      CREATE TABLE public.launch_notification_deliveries (id uuid PRIMARY KEY DEFAULT gen_random_uuid());
      CREATE TABLE public.project_conversations (id uuid PRIMARY KEY DEFAULT gen_random_uuid());
      CREATE TABLE public.ai_jobs (id uuid PRIMARY KEY DEFAULT gen_random_uuid());
      CREATE TABLE public.usage_ledger (id uuid PRIMARY KEY DEFAULT gen_random_uuid());
      INSERT INTO auth.users VALUES ('${OWNER}','owner@example.test'),('${SP}','partner@example.test'),('${OTHER}','other@example.test'),('${SP2}','partner2@example.test'),('${PLAT}','plat@example.test');
      INSERT INTO public.workspaces VALUES ('${WS}','Client One','client-one','${OWNER}',now()),('${WS2}','Other Co','other-co','${OTHER}',now());
      INSERT INTO public.workspace_members VALUES ('${WS}','${OWNER}','owner'),('${WS2}','${OTHER}','owner');
      INSERT INTO public.partners (user_id, is_service_partner, status) VALUES ('${SP}',true,'approved'),('${SP2}',true,'approved');
      INSERT INTO public.partner_program_terms (status, service_partner_applications_open) VALUES ('active', true);
      INSERT INTO public.platform_unrestricted VALUES ('${PLAT}');
      INSERT INTO public.project_profiles (id, workspace_id, public_slug, project_name, discovery_status) VALUES ('${PP}','${WS}','client-one','Client One','published');
      INSERT INTO public.project_profiles (workspace_id, public_slug, project_name) VALUES ('${WS2}','other-co','Other Co');
      INSERT INTO public.telegram_group_connections (id, workspace_id, telegram_chat_id, title, username, chat_type, bot_is_admin, metadata) VALUES
        ('${G}','${WS}',-1001111,'Client Main','clientmain','supergroup',true,'{"member_count":999}'),
        ('${G2}','${WS2}',-1002222,'Other Main','othermain','supergroup',true,'{}'),
        ('${GR}','${WS}',-1003333,'Client Removed',NULL,'group',false,'{"last_member_status":"kicked"}');
      INSERT INTO public.sticker_packs (id, workspace_id, title, theme, status, telegram_set_name, telegram_set_url, telegram_published_at, reference_asset_id) VALUES
        ('${P}','${WS}','Client Pack','noir','published','clientpack_by_bot','https://t.me/addstickers/clientpack_by_bot',now(),'${S1}'),
        ('${P2}','${WS2}','Other Pack','x','published','otherpack_by_bot',NULL,now(),NULL),
        ('${PU}','${WS}','Draft Pack','x','draft',NULL,NULL,NULL,NULL);
      INSERT INTO public.stickers VALUES
        ('${S1}','${P}',1,'Wave',ARRAY['👋'],'published','${D}','FILEID_SECRET_1'),
        ('${S2}','${P}',2,'Nod',ARRAY['🙂'],'published',NULL,'FILEID_SECRET_2'),
        ('${SU}','${P}',3,'Unpub',ARRAY['😶'],'draft',NULL,NULL),
        ('${SX}','${P2}',1,'OtherS',ARRAY['🐸'],'published',NULL,'FILEID_SECRET_X');
      INSERT INTO public.sticker_drop_schedules (id, workspace_id, group_connection_id, pack_id, created_by, interval_minutes, daily_cap) VALUES
        ('${D}','${WS}','${G}','${P}','${OWNER}',60,8),('${D2}','${WS2}','${G2}','${P2}','${OTHER}',60,8);
      INSERT INTO public.sticker_drop_events (schedule_id, workspace_id, group_connection_id, pack_id, sticker_id, status, local_date, telegram_message_id, error_message) VALUES
        ('${D}','${WS}','${G}','${P}','${S1}','sent',current_date,424242,NULL),('${D2}','${WS2}','${G2}','${P2}','${SX}','sent',current_date,515151,NULL);
      INSERT INTO public.commercial_stub VALUES ('${WS}', false, 'FEATURE_NOT_INCLUDED', 'sticker_drops');`;
    check("DB-0 shim loads", psql(shim).ok, psql("SELECT 1").err);
    check("DB-1 SP-A + SP-B3 (identity core) apply", psql(SPA).ok && psql(B3).ok);
    const applied = psql(B5);
    check("DB-2 SP-B5 applies", applied.ok, applied.err.slice(0, 200));

    const calls = (ws: string) => [
      `SELECT public.partner_list_sticker_drop_packs('${ws}');`,
      `SELECT public.partner_list_sticker_drop_state('${ws}');`,
      `SELECT public.partner_authorize_sticker_drop_action('${ws}','delete_schedule',NULL,NULL,'${D}');`,
    ];
    const allDenied = (uid: string | null, msg: string, ws = WS) => calls(ws).every((q) => err(as(uid, q), msg));
    check("DB-3 anon denied on all 3", allDenied(null, "permission denied"));
    check("DB-4 partner with no grant denied", allDenied(SP, "Not authorized"));
    check("DB-5 workspace owner (not a partner) denied on partner RPCs", allDenied(OWNER, "Not authorized"));
    check("DB-6 platform owner gets NO partner bypass", allDenied(PLAT, "Not authorized"));

    const inv = as(OWNER, `SELECT public.owner_invite_service_partner('${WS}','partner@example.test','{project_identity,sticker_tools}');`);
    const accessId = inv.out.split("\n").pop() ?? "";
    check("DB-7 pending invite denied", allDenied(SP, "Not authorized"));
    as(SP, `SELECT public.partner_respond_client_invite('${accessId}', true);`);
    as(OWNER, `SELECT public.owner_update_partner_scopes('${accessId}','{project_identity,broadcasts,community_management}');`);
    check("DB-8 active grant WITHOUT sticker_tools denied", allDenied(SP, "Not authorized"));
    as(OWNER, `SELECT public.owner_update_partner_scopes('${accessId}','{project_identity,sticker_tools}');`);
    check("DB-9 cross-workspace denied scope-first", allDenied(SP, "Not authorized", WS2));

    const packs = as(SP, `SELECT public.partner_list_sticker_drop_packs('${WS}')::text;`);
    const pj = packs.ok ? JSON.parse(packs.out) : [];
    check("DB-10 packs: only client published Telegram-ready packs", packs.ok && pj.length === 1 && pj[0].pack_id === P && pj[0].sticker_count === 2, packs.out || packs.err);
    check("DB-11 packs: published stickers only, labels/emoji only", pj[0]?.stickers?.length === 2 && Object.keys(pj[0].stickers[0]).sort().join(",") === "emoji_list,label,sort_order,sticker_id" && Object.keys(pj[0]).sort().join(",") === "pack_id,published_at,sticker_count,stickers,theme,title");
    check("DB-12 packs output has no file id / set name / url / asset id", !/FILEID|clientpack_by_bot|addstickers|image_asset|reference_asset|Other Pack|Draft Pack/.test(packs.out));

    const st = as(SP, `SELECT public.partner_list_sticker_drop_state('${WS}')::text;`);
    const sj = st.ok ? JSON.parse(st.out) : {};
    check("DB-13 state: client groups/schedules/events only", st.ok && sj.groups.length === 2 && sj.schedules.length === 1 && sj.schedules[0].id === D && sj.events.length === 1 && sj.kill_switch === false, st.out || st.err);
    check("DB-14 state has no chat id / username / metadata / message id / file id / created_by", !/-100|clientmain|member_count|424242|FILEID|created_by|metadata|username|telegram_/.test(st.out) && Object.keys(sj.groups[0]).sort().join(",") === "bot_is_admin,chat_type,group_connection_id,operational,title" && Object.keys(sj.events[0]).sort().join(",") === "created_at,error_message,group_title,local_date,status,sticker_label");
    check("DB-15 removed-bot group not operational", sj.groups.some((g: any) => g.title === "Client Removed" && g.operational === false) && sj.groups.some((g: any) => g.title === "Client Main" && g.operational === true));
    psql(`INSERT INTO public.sticker_drop_workspace_controls VALUES ('${WS}', true, '${OWNER}', now());`);
    check("DB-16 kill switch visible read-only", JSON.parse(as(SP, `SELECT public.partner_list_sticker_drop_state('${WS}')::text;`).out).kill_switch === true);

    const auth = (a: string, g: string | null, p: string | null, s: string | null, en: string = "NULL") => as(SP, `SELECT public.partner_authorize_sticker_drop_action('${WS}',${a === "NULL" ? "NULL" : `'${a}'`},${g ? `'${g}'` : "NULL"},${p ? `'${p}'` : "NULL"},${s ? `'${s}'` : "NULL"},${en})::text;`);
    const code_ = (r: { out: string }) => { try { return JSON.parse(r.out).code; } catch { return "?"; } };
    const allowed = (r: { out: string }) => { try { return JSON.parse(r.out).allowed === true; } catch { return false; } };
    check("DB-17 invalid actions denied (kill switch, status, publish, send_test, AI)", ["set_kill_switch", "status", "publish", "send_test", "refresh", "replace_version", "release_motion", "start", "start_variation", "NULL"].every((a) => code_(auth(a, G, P, null)) === "ACTION_NOT_ALLOWED"));
    check("DB-18 save requires group + pack", code_(auth("save_schedule", G, null, null)) === "GROUP_AND_PACK_REQUIRED" && code_(auth("save_schedule", null, P, null)) === "GROUP_AND_PACK_REQUIRED");
    check("DB-19 other-workspace group denied", code_(auth("save_schedule", G2, P, null)) === "GROUP_NOT_FOUND");
    check("DB-20 other-workspace pack denied", code_(auth("save_schedule", G, P2, null)) === "PACK_NOT_FOUND");
    check("DB-21 unpublished / not Telegram-ready pack denied", code_(auth("save_schedule", G, PU, null)) === "PACK_NOT_PUBLISHED");
    check("DB-22 other-workspace schedule denied", code_(auth("delete_schedule", null, null, D2)) === "SCHEDULE_NOT_FOUND" && code_(auth("set_schedule_enabled", null, null, D2, "false")) === "SCHEDULE_NOT_FOUND");
    check("DB-23 enable/delete require a schedule", code_(auth("delete_schedule", null, null, null)) === "SCHEDULE_REQUIRED");
    check("DB-24 client free plan: save + enable denied FEATURE_NOT_INCLUDED", code_(auth("save_schedule", G, P, null)) === "FEATURE_NOT_INCLUDED" && code_(auth("set_schedule_enabled", null, null, D, "true")) === "FEATURE_NOT_INCLUDED");
    check("DB-25 disable + delete allowed without paid entitlement", allowed(auth("set_schedule_enabled", null, null, D, "false")) && allowed(auth("delete_schedule", null, null, D)));
    psql(`INSERT INTO public.platform_unrestricted VALUES ('${SP}');`);
    check("DB-26 partner flagged unrestricted still denied by CLIENT plan (no bypass)", code_(auth("save_schedule", G, P, null)) === "FEATURE_NOT_INCLUDED");
    psql(`DELETE FROM public.platform_unrestricted WHERE user_id='${SP}';`);
    const setStub = (ok: boolean, reason: string | null, feature = "sticker_drops") => psql(`UPDATE public.commercial_stub SET allowed=${ok}, reason=${reason ? `'${reason}'` : "NULL"}, feature='${feature}' WHERE workspace_id='${WS}';`);
    setStub(true, null);
    const ok = auth("save_schedule", G, P, null);
    check("DB-27 paid client plan (fixture): save + enable allowed, minimal response", allowed(ok) && allowed(auth("set_schedule_enabled", null, null, D, "true")) && Object.keys(JSON.parse(ok.out)).sort().join(",") === "allowed,code" && !/secret_plan|used|limit/.test(ok.out));
    setStub(true, null, "community_basic");
    check("DB-28 evaluated feature is sticker_drops (other feature does not allow)", !allowed(auth("save_schedule", G, P, null)));
    setStub(false, "PLAN_LIMIT_REACHED"); check("DB-29 PLAN_LIMIT_REACHED mapped (Edge → 429)", code_(auth("save_schedule", G, P, null)) === "PLAN_LIMIT_REACHED");
    setStub(false, "ASSIGNMENT_EXPIRED"); check("DB-30 ASSIGNMENT_* → PLAN_ACCESS_INACTIVE", code_(auth("save_schedule", G, P, null)) === "PLAN_ACCESS_INACTIVE");
    setStub(false, "WHATEVER"); check("DB-31 unknown deny → COMMERCIAL_ACCESS_DENIED", code_(auth("save_schedule", G, P, null)) === "COMMERCIAL_ACCESS_DENIED");
    setStub(true, null);
    psql(`UPDATE public.project_profiles SET public_slug='Bad!' WHERE workspace_id='${WS}';`);
    check("DB-32 client without Project Identity → PROJECT_IDENTITY_REQUIRED (disable still allowed)", code_(auth("save_schedule", G, P, null)) === "PROJECT_IDENTITY_REQUIRED" && allowed(auth("set_schedule_enabled", null, null, D, "false")));
    psql(`UPDATE public.project_profiles SET public_slug='client-one' WHERE workspace_id='${WS}';`);

    // Ownership trigger backstop (what the shared Edge write relies on for every caller).
    check("DB-33 trigger: cross-workspace group/pack and foreign/unpublished stickers rejected; valid accepted", !psql(`INSERT INTO public.sticker_drop_schedules (workspace_id, group_connection_id, pack_id, interval_minutes, daily_cap) VALUES ('${WS}','${G2}','${P}',60,8);`).ok && !psql(`UPDATE public.sticker_drop_schedules SET pack_id='${P2}' WHERE id='${D}';`).ok && !psql(`UPDATE public.sticker_drop_schedules SET selected_sticker_ids=ARRAY['${SX}']::uuid[] WHERE id='${D}';`).ok && !psql(`UPDATE public.sticker_drop_schedules SET selected_sticker_ids=ARRAY['${SU}']::uuid[] WHERE id='${D}';`).ok && psql(`UPDATE public.sticker_drop_schedules SET selected_sticker_ids=ARRAY['${S2}']::uuid[] WHERE id='${D}';`).ok);
    check("DB-34 boundaries: interval 14/721 + cap 0/25 rejected, 15/720 + 1/24 accepted, approved_only forced", ["interval_minutes=14", "interval_minutes=721", "daily_cap=0", "daily_cap=25", "approved_only=false"].every((s) => !psql(`UPDATE public.sticker_drop_schedules SET ${s} WHERE id='${D}';`).ok) && ["interval_minutes=15", "interval_minutes=720", "daily_cap=1", "daily_cap=24"].every((s) => psql(`UPDATE public.sticker_drop_schedules SET ${s} WHERE id='${D}';`).ok));

    const snap = () => psql(`SELECT md5(coalesce((SELECT string_agg(row_to_json(x)::text,'|' ORDER BY id) FROM public.sticker_drop_schedules x),'')) || md5(coalesce((SELECT string_agg(row_to_json(x)::text,'|' ORDER BY id) FROM public.sticker_packs x),'')) || md5(coalesce((SELECT string_agg(row_to_json(x)::text,'|' ORDER BY id) FROM public.stickers x),'')) || md5(coalesce((SELECT string_agg(row_to_json(x)::text,'|' ORDER BY id) FROM public.telegram_group_connections x),'')) || (SELECT count(*) FROM public.sticker_drop_events) || (SELECT count(*) FROM public.sticker_drop_workspace_controls) || (SELECT count(*) FROM public.launch_events) || (SELECT count(*) FROM public.launch_notification_deliveries) || (SELECT count(*) FROM public.project_conversations) || (SELECT count(*) FROM public.ai_jobs) || (SELECT count(*) FROM public.usage_ledger) || (SELECT count(*) FROM public.workspace_members);`).out;
    const s0 = snap();
    for (const q of [...calls(WS), `SELECT public.partner_authorize_sticker_drop_action('${WS}','save_schedule','${G}','${P}',NULL,NULL);`, `SELECT public.partner_authorize_sticker_drop_action('${WS}','set_schedule_enabled',NULL,NULL,'${D}',true);`]) as(SP, q);
    check("DB-35 partner RPCs mutate nothing (schedules, packs, stickers, groups, events, kill switch, launch/watcher/inbox, AI jobs, usage, members)", s0.length > 128 && snap() === s0);

    as(OWNER, `SELECT public.owner_revoke_service_partner('${accessId}');`);
    check("DB-36 revoke immediately blocks next read + authorization", allDenied(SP, "Not authorized"));
    const inv2 = as(OWNER, `SELECT public.owner_invite_service_partner('${WS}','partner2@example.test','{sticker_tools}');`);
    as(SP2, `SELECT public.partner_respond_client_invite('${(inv2.out.split("\n").pop() ?? "")}', false);`);
    check("DB-37 declined invite denied", allDenied(SP2, "Not authorized"));
    const inv3 = as(OWNER, `SELECT public.owner_invite_service_partner('${WS}','partner2@example.test','{sticker_tools}');`);
    as(SP2, `SELECT public.partner_respond_client_invite('${(inv3.out.split("\n").pop() ?? "")}', true);`);
    check("DB-38 accepted sticker_tools-only grant can read", as(SP2, `SELECT jsonb_array_length(public.partner_list_sticker_drop_packs('${WS}'));`).out === "1");
    psql(`UPDATE public.partners SET status='suspended' WHERE user_id='${SP2}';`);
    check("DB-39 suspended Service Partner denied", allDenied(SP2, "Not authorized"));
    check("DB-40 partners never became workspace members/operators", psql(`SELECT count(*) FROM public.workspace_members WHERE user_id IN ('${SP}','${SP2}');`).out === "0");
    check("DB-41 ACLs: no PUBLIC/anon on the 3 RPCs", psql(`SELECT count(*) FROM pg_proc WHERE proname IN ('${FNS.join("','")}') AND (array_to_string(proacl::text[], ',') ~ '(^|,)=X' OR array_to_string(proacl::text[], ',') LIKE '%anon=%');`).out === "0");
    check("DB-42 all 3 SECURITY DEFINER, empty search_path, postgres owner", psql(`SELECT count(*) FROM pg_proc WHERE proname IN ('${FNS.join("','")}') AND prosecdef AND proconfig = ARRAY['search_path=""'] AND pg_get_userbyid(proowner)='postgres';`).out === "3");
    check("DB-43 no table grants to authenticated/anon on sticker tables", psql(`SELECT count(*) FROM information_schema.role_table_grants WHERE grantee IN ('authenticated','anon') AND table_name IN ('sticker_packs','stickers','sticker_drop_schedules','sticker_drop_events','sticker_drop_workspace_controls');`).out === "0");
  } catch (e) {
    check("DB-X harness", false, String(e).slice(0, 300));
  } finally {
    try { sh(`${asPg}pg_ctl -D ${dir}/data -m immediate stop >/dev/null`); } catch { /* ignore */ }
    rmSync(dir, { recursive: true, force: true });
  }
}

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
