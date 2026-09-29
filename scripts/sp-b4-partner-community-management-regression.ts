/*
 * SP-B4 V1 Partner Community Management regression.
 * 1) Static checks on staged SQL, staged telegram-group Edge source, frontend
 *    and changed-file scope.
 * 2) Throwaway LOCAL Postgres in /tmp (never Supabase): loads SP-A + SP-B3
 *    (identity core) + SP-B4 with role-faithful authenticated/anon callers. The
 *    SP-B0 commercial core is stubbed by a controllable table so allow/deny/limit
 *    mapping is exercised; the real evaluator is not.
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
const B4 = read("docs/sql/SP_B4_partner_community_management.sql");
const EDGE = read("backend-source/edge-functions/telegram-group/index.ts");
const RUNBOOK = read("docs/SP_B4_PARTNER_COMMUNITY_RUNBOOK.md");
const LIB = read("src/lib/partner-client-access.ts");
const CLIB = read("src/lib/partner-community-management.ts");
const PANEL = read("src/components/cartel/PartnerCommunityPanel.tsx");
const TG = read("src/routes/_authenticated/telegram.tsx");
const code = B4.replace(/--.*$/gm, "");
const PLAN_COMMIT = "688b085b18927c4745f5ba5fe14428b71297bb02";
const EDGE_BASELINE_MD5 = "3ea60946a4125e6d78623c49e82f53ad"; // repo == deployed v49 at start gate

const FNS = ["partner_list_community_groups", "partner_get_welcome_settings", "partner_authorize_community_action"];
const bodyOf = (name: string) => { const i = code.indexOf(`FUNCTION public.${name}(`); return code.slice(i, code.indexOf("$function$;", i)); };

/* ---------- Static: SQL ---------- */
check("S-1 staged only, not in supabase/migrations", B4.includes("STAGED ONLY. NOT APPLIED.") && !readdirSync("supabase/migrations").some((f) => /sp_b4|community_management/i.test(f)));
check("S-2 creates exactly the 3 partner RPCs", [...code.matchAll(/CREATE OR REPLACE FUNCTION public\.(\w+)/g)].map((m) => m[1]).sort().join(",") === [...FNS].sort().join(","));
check("S-3 no table/RLS/trigger/membership/DML/helper change", !/CREATE TABLE|ALTER TABLE|CREATE POLICY|DROP |CREATE TRIGGER|INSERT INTO|UPDATE public\.|DELETE FROM|GRANT (SELECT|INSERT|UPDATE|DELETE|ALL) ON (TABLE )?public\.|FUNCTION public\.(is_workspace_(member|operator)|can_use_project_tools|project_identity_ready)\(/i.test(code));
check("S-4 SECURITY DEFINER + empty search_path + auth.uid + community_management scope", FNS.every((f) => { const b = bodyOf(f); return /SECURITY DEFINER\n SET search_path TO ''/.test(b) && b.includes("auth.uid()") && b.includes("public.partner_has_scope(_workspace_id, 'community_management')"); }));
check("S-5 scope precedes every table read", FNS.every((f) => { const b = bodyOf(f); const s = b.indexOf("partner_has_scope"); const t = b.search(/FROM public\.(telegram_|launches)/); return s > 0 && t > s; }));
check("S-6 PUBLIC/anon revoked, authenticated+service_role granted, postgres owner", FNS.every((f) => new RegExp(`REVOKE ALL ON FUNCTION public\\.${f}\\([^)]*\\) FROM PUBLIC, anon;`).test(code) && new RegExp(`GRANT EXECUTE ON FUNCTION public\\.${f}\\([^)]*\\) TO authenticated, service_role;`).test(code) && new RegExp(`ALTER FUNCTION public\\.${f}\\([^)]*\\) OWNER TO postgres;`).test(code)));
check("S-7 authorize: action allow-list, group-in-workspace, identity core, SP-B0 core community_basic, no bypass", (() => { const b = bodyOf("partner_authorize_community_action"); const a = b.indexOf("NOT IN ('save_welcome_settings', 'send_welcome_test')"), g = b.indexOf("g.workspace_id = _workspace_id"), i = b.indexOf("project_identity_ready"), c = b.indexOf("commercial_evaluate_workspace_feature(_workspace_id, 'community_basic'"); return a > 0 && g > a && i > g && c > i && !/unrestricted|is_platform_owner|evaluate_commercial_access\(/.test(b); })());
check("S-8 get settings never selects launch token/UUID into output", (() => { const b = bodyOf("partner_get_welcome_settings"); const outs = [...b.matchAll(/jsonb_build_object\(([\s\S]*?)\);/g)].map((m) => m[1]).join(" "); return outs.length > 0 && !/launch_watch_token'|launch_watch_launch_id'|telegram_chat_id|metadata|username|member/.test(outs); })());
check("S-9 group list outputs no chat id/username/metadata/member", !/telegram_chat_id|username|metadata|member/.test(bodyOf("partner_list_community_groups").match(/RETURNS TABLE\(([^)]*)\)/)?.[1] ?? "x"));
check("S-10 defaults mirror Edge loadSettings defaults", EDGE.includes("welcome_enabled: false, welcome_message: DEFAULT_WELCOME_MESSAGE, mention_member: true, auto_delete_enabled: true, auto_delete_seconds: 45") && bodyOf("partner_get_welcome_settings").includes("'auto_delete_seconds', 45") && bodyOf("partner_get_welcome_settings").includes("Please check the pinned messages and official links before getting started."));

/* ---------- Static: Edge ---------- */
const edgeBase = execFileSync("git", ["show", `${PLAN_COMMIT}:backend-source/edge-functions/telegram-group/index.ts`], { encoding: "utf8" });
check("E-0 staging baseline equals start-gate md5 (deployed v49)", execFileSync("md5sum", { input: edgeBase, encoding: "utf8" }).startsWith(EDGE_BASELINE_MD5));
const diffLines = execFileSync("git", ["diff", "--unified=0", PLAN_COMMIT, "--", "backend-source/edge-functions/telegram-group/index.ts"], { encoding: "utf8" }).split("\n").filter((l) => /^[+-][^+-]/.test(l));
const removed = diffLines.filter((l) => l.startsWith("-"));
check("E-1 only 3 baseline lines changed (non-member guard, Gate B condition, save/test guard)", removed.length === 3, removed.join(" | "));
check("E-2 partner branch only for non-member + save_welcome_settings/send_welcome_test", EDGE.includes('if (!membership && (action === "save_welcome_settings" || action === "send_welcome_test")) {') && EDGE.includes("if (!membership && !partnerCommunityAuthorized) {"));
check("E-3 partner gate uses user-JWT client RPC", EDGE.includes('userClient.rpc("partner_authorize_community_action"'));
check("E-4 Gate B skipped only for partner-authorized requests", EDGE.includes("if (PROJECT_IDENTITY_GATED_ACTIONS.has(action) && !partnerBroadcastAuthorized && !partnerCommunityAuthorized) {"));
check("E-5 only the welcome save/test guard accepts partnerCommunityAuthorized", (EDGE.match(/!canManageCommunity && !partnerCommunityAuthorized/g) ?? []).length === 1 && EDGE.indexOf("!canManageCommunity && !partnerCommunityAuthorized") > EDGE.indexOf('if (action === "welcome_settings") {'));
const saveStart = EDGE.indexOf('if (action === "save_welcome_settings") {');
const force = EDGE.indexOf("if (partnerCommunityAuthorized) {", saveStart);
const validate = EDGE.indexOf("const welcomeMessage = typeof raw.welcomeMessage", saveStart);
check("E-6 partner save forces all six launch_watch_* inputs to stored values BEFORE validation", force > saveStart && force < validate && ["launchWatchCtaEnabled", "launchWatchLaunchId", "launchWatchShowWebsite", "launchWatchShowTelegram", "launchWatchShowX", "launchWatchCtaAutoDeleteSeconds"].every((k) => EDGE.slice(force, validate).includes(`raw.${k} =`)));
check("E-7 forced defaults match DB/Edge defaults", EDGE.slice(force, validate).includes(": false;") && EDGE.slice(force, validate).includes(": LW_CTA_LIFETIME_DEFAULT;") && EDGE.includes("const LW_CTA_LIFETIME_DEFAULT = 900;"));
check("E-8 one save upsert, one preview sender (no duplicate engine)", (EDGE.match(/from\("telegram_community_settings"\)\.upsert\(/g) ?? []).length === 1 && (EDGE.match(/CARTEL HQ welcome preview/g) ?? []).length === (edgeBase.match(/CARTEL HQ welcome preview/g) ?? []).length);
check("E-9 owner validation unchanged (empty, 3500, booleans, 10..120)", ['if (!welcomeMessage) return respond({ error: "INVALID_MESSAGE"', "welcomeMessage.length > 3500", 'typeof raw.welcomeEnabled !== "boolean"', "seconds < 10 || seconds > 120"].every((s) => EDGE.includes(s) && edgeBase.includes(s)));
check("E-10 partner responses omit message ids + launch fields", EDGE.includes("if (partnerCommunityAuthorized) return respond({ sent: true, autoDeleteSeconds:") && !/if \(partnerCommunityAuthorized\) return respond\(\{ sent: true[^\n]*messageId/.test(EDGE) && /if \(partnerCommunityAuthorized\) return respond\(\{ saved: true, settings: \{ welcome_enabled[^\n]*\} \}\);/.test(EDGE));
check("E-11 denial mapping uses shared commercialDenialFor(community_basic) + identity body", EDGE.includes('"ASSIGNMENT_INACTIVE" : code, "community_basic")'));
check("E-12 status/welcome_settings/sticker/broadcast actions stay member-only for partner", !/partnerCommunityAuthorized[^\n]*(status|assign_pack|distribute_pack|send_group_test|broadcast_launch_options|official_contract)/.test(EDGE));

/* ---------- Static: frontend ---------- */
check("F-1 community_management active; sticker_tools/missions inactive", LIB.includes('ACTIVE_PARTNER_SCOPES: readonly PartnerClientScope[] = ["project_identity", "project_inbox", "launch_watcher_comms", "broadcasts", "community_management"]'));
check("F-2 /telegram unlocked for community_management", LIB.includes('{ path: "/telegram", scope: "community_management" }'));
check("F-3 browser: partner RPCs + five editable fields only", CLIB.includes('"partner_list_community_groups"') && CLIB.includes('"partner_get_welcome_settings"') && !/launchWatch[A-Z]\w*:/.test(CLIB) && !/from\("telegram_/.test(CLIB + PANEL));
check("F-4 panel: no ids, no owner/group-management/sticker/broadcast controls", !/telegram_chat_id|requested_by|messageId|TelegramGroupCard|CommunityWelcomeDialog|disconnect|reconnect|sticker|Broadcast/i.test(PANEL.replace(/Launch Watch card/g, "")));
check("F-5 panel: 3500 counter, 10..120 seconds, confirm dialog, Owner controlled label", PANEL.includes("WELCOME_MESSAGE_MAX") && PANEL.includes("WELCOME_AUTO_DELETE_MIN") && PANEL.includes("AlertDialog") && PANEL.includes("Owner controlled"));
check("F-6 managed /telegram composes Community tab; owner page unchanged", TG.includes("<PartnerCommunityPanel />") && TG.includes('scopes.includes("community_management")') && TG.includes("if (!isManaged) return <TelegramPage />;"));
check("F-7 runbook orders SQL + EDGE + publish checkpoints", ["CP-SPB4-SQL", "CP-SPB4-EDGE", "CP-SPB4-PUBLISH"].every((c) => RUNBOOK.includes(c)));

const ALLOW = new Set([
  "docs/sql/SP_B4_partner_community_management.sql", "backend-source/edge-functions/telegram-group/index.ts", "src/lib/partner-community-management.ts",
  "src/components/cartel/PartnerCommunityPanel.tsx", "src/routes/_authenticated/telegram.tsx", "src/lib/partner-client-access.ts",
  "src/components/cartel/ManagedAccessGuard.tsx", "src/components/cartel/SidebarNav.tsx", "src/components/cartel/ServicePartnerAccessPanel.tsx",
  "scripts/sp-b4-partner-community-management-regression.ts", "docs/SP_B4_PARTNER_COMMUNITY_RUNBOOK.md",
  "scripts/sp-a-managed-client-access-regression.ts", "scripts/sp-b1-partner-inbox-regression.ts", "scripts/sp-b2-partner-launch-comms-regression.ts",
  "scripts/sp-b3-partner-group-broadcasts-regression.ts", "scripts/public-discovery-seo-regression.ts", "roadmap.md", ".lovable/plan.md",
]);
const changed = [
  ...execFileSync("git", ["diff", "--name-only", PLAN_COMMIT], { encoding: "utf8" }).split("\n"),
  ...execFileSync("git", ["ls-files", "--others", "--exclude-standard"], { encoding: "utf8" }).split("\n"),
].filter(Boolean);
const outside = changed.filter((f) => !ALLOW.has(f));
check("F-8 changed files within SP-B4 allowlist", outside.length === 0, outside.join(", "));
check("F-9 no migrations / supabase integration / other Edge function edits", !changed.some((f) => f.startsWith("supabase/") || f.startsWith("src/integrations/supabase/") || (f.startsWith("backend-source/") && f !== "backend-source/edge-functions/telegram-group/index.ts")));

/* ---------- Local Postgres ---------- */
const hasPg = spawnSync("sh", ["-c", "command -v initdb && command -v pg_ctl && command -v psql"]).status === 0;
if (!hasPg) {
  check("DB-0 local Postgres available", false, "initdb/pg_ctl/psql not found");
} else {
  const dir = mkdtempSync(join(tmpdir(), "spb4-"));
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
    const as = (uid: string | null, sql: string) => psql(`BEGIN; SET LOCAL ROLE ${uid ? "authenticated" : "anon"}; SET LOCAL request.jwt.claims = '${uid ? JSON.stringify({ sub: uid, role: "authenticated" }) : "{}"}';\n${sql}\nCOMMIT;`);
    const err = (r: { ok: boolean; err: string }, s: string) => !r.ok && r.err.includes(s);
    const OWNER = "00000000-0000-0000-0000-00000000000a", SP = "00000000-0000-0000-0000-00000000000b", OTHER = "00000000-0000-0000-0000-00000000000c", SP2 = "00000000-0000-0000-0000-00000000000d", PLAT = "00000000-0000-0000-0000-00000000000e";
    const WS = "10000000-0000-0000-0000-000000000001", WS2 = "10000000-0000-0000-0000-000000000002";
    const G = "30000000-0000-0000-0000-000000000001", G2 = "30000000-0000-0000-0000-000000000002", GR = "30000000-0000-0000-0000-000000000003", GN = "30000000-0000-0000-0000-000000000004";
    const L = "40000000-0000-0000-0000-000000000001", PP = "50000000-0000-0000-0000-000000000001";
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
      CREATE TABLE public.platform_unrestricted (user_id uuid PRIMARY KEY);
      CREATE FUNCTION public.has_platform_unrestricted_access(_u uuid) RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public' AS $f$ SELECT EXISTS (SELECT 1 FROM public.platform_unrestricted WHERE user_id=_u) $f$;
      GRANT SELECT ON public.workspaces TO authenticated;
      ALTER TABLE public.workspaces ENABLE ROW LEVEL SECURITY;
      CREATE POLICY ws_sel ON public.workspaces FOR SELECT TO authenticated USING (public.is_workspace_member(id, auth.uid()));
      CREATE TABLE public.partners (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), user_id uuid UNIQUE, is_affiliate boolean DEFAULT false, is_service_partner boolean DEFAULT false, status text);
      CREATE TABLE public.partner_program_terms (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), status text, service_partner_applications_open boolean DEFAULT false);
      CREATE TABLE public.project_profiles (id uuid UNIQUE DEFAULT gen_random_uuid(), workspace_id uuid PRIMARY KEY, public_slug text, project_name text NOT NULL, ticker text, primary_chain text, tagline varchar(140), description text, website_url text, telegram_url text, x_url text, discovery_status text DEFAULT 'draft', logo_asset_id uuid, updated_at timestamptz DEFAULT now());
      CREATE TABLE public.telegram_group_connections (id uuid PRIMARY KEY, workspace_id uuid NOT NULL, connected_by uuid, telegram_chat_id bigint NOT NULL, title text, username text, chat_type text, bot_is_admin boolean, can_set_sticker_set boolean, connected_at timestamptz DEFAULT now(), verified_at timestamptz, metadata jsonb DEFAULT '{}', created_at timestamptz DEFAULT now());
      CREATE TABLE public.telegram_group_announcements (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), workspace_id uuid NOT NULL, group_connection_id uuid, telegram_chat_id bigint NOT NULL, group_title text NOT NULL, requested_by uuid, client_request_id uuid NOT NULL, message_text text NOT NULL, status text NOT NULL, telegram_message_id bigint, requested_at timestamptz NOT NULL DEFAULT now(), sent_at timestamptz, delivery_kind text NOT NULL DEFAULT 'TEXT', announcement_kind text NOT NULL DEFAULT 'OPERATOR_TEXT');
      CREATE TABLE public.telegram_community_settings (group_connection_id uuid PRIMARY KEY, workspace_id uuid NOT NULL, welcome_enabled boolean NOT NULL DEFAULT false, welcome_message text NOT NULL DEFAULT 'x', mention_member boolean NOT NULL DEFAULT true, auto_delete_enabled boolean NOT NULL DEFAULT true, auto_delete_seconds integer NOT NULL DEFAULT 45, launch_watch_cta_enabled boolean NOT NULL DEFAULT false, launch_watch_launch_id uuid, launch_watch_show_website boolean NOT NULL DEFAULT true, launch_watch_show_telegram boolean NOT NULL DEFAULT false, launch_watch_show_x boolean NOT NULL DEFAULT true, launch_watch_cta_auto_delete_seconds integer NOT NULL DEFAULT 900, metadata jsonb NOT NULL DEFAULT '{}', created_at timestamptz DEFAULT now(), updated_at timestamptz DEFAULT now());
      CREATE TABLE public.launches (id uuid PRIMARY KEY, workspace_id uuid, project_profile_id uuid, token_name text, ticker text, chain text, status text, launch_watch_token text);
      ALTER TABLE public.telegram_group_connections ENABLE ROW LEVEL SECURITY;
      ALTER TABLE public.telegram_community_settings ENABLE ROW LEVEL SECURITY;
      ALTER TABLE public.launches ENABLE ROW LEVEL SECURITY;
      CREATE TABLE public.commercial_stub (workspace_id uuid PRIMARY KEY, allowed boolean, reason text, feature text);
      CREATE FUNCTION public.commercial_evaluate_workspace_feature(_workspace_id uuid, _feature_key text, _base jsonb) RETURNS jsonb LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO '' AS $f$
        SELECT _base || jsonb_build_object('allowed', coalesce(s.allowed,false) AND s.feature = _feature_key, 'reason', s.reason, 'plan_code','secret_plan','used',7,'limit',5)
        FROM (SELECT 1) x LEFT JOIN public.commercial_stub s ON s.workspace_id=_workspace_id $f$;
      REVOKE ALL ON FUNCTION public.commercial_evaluate_workspace_feature(uuid,text,jsonb) FROM PUBLIC, anon, authenticated;
      GRANT EXECUTE ON FUNCTION public.commercial_evaluate_workspace_feature(uuid,text,jsonb) TO service_role;
      CREATE TABLE public.launch_events (id uuid PRIMARY KEY DEFAULT gen_random_uuid());
      CREATE TABLE public.launch_notification_deliveries (id uuid PRIMARY KEY DEFAULT gen_random_uuid());
      CREATE TABLE public.sticker_pack_group_targets (id uuid PRIMARY KEY DEFAULT gen_random_uuid());
      CREATE TABLE public.telegram_message_cleanup_jobs (id uuid PRIMARY KEY DEFAULT gen_random_uuid());
      INSERT INTO auth.users VALUES ('${OWNER}','owner@example.test'),('${SP}','partner@example.test'),('${OTHER}','other@example.test'),('${SP2}','partner2@example.test'),('${PLAT}','plat@example.test');
      INSERT INTO public.workspaces VALUES ('${WS}','Client One','client-one','${OWNER}',now()),('${WS2}','Other Co','other-co','${OTHER}',now());
      INSERT INTO public.workspace_members VALUES ('${WS}','${OWNER}','owner'),('${WS2}','${OTHER}','owner');
      INSERT INTO public.partners (user_id, is_service_partner, status) VALUES ('${SP}',true,'approved'),('${SP2}',true,'approved');
      INSERT INTO public.partner_program_terms (status, service_partner_applications_open) VALUES ('active', true);
      INSERT INTO public.platform_unrestricted VALUES ('${PLAT}');
      INSERT INTO public.project_profiles (id, workspace_id, public_slug, project_name, discovery_status) VALUES ('${PP}','${WS}','client-one','Client One','published');
      INSERT INTO public.project_profiles (workspace_id, public_slug, project_name) VALUES ('${WS2}','other-co','Other Co');
      INSERT INTO public.launches VALUES ('${L}','${WS}','${PP}','Client Token','CLT','solana','WATCHLIST_OPEN','0123456789abcdef01234567');
      INSERT INTO public.telegram_group_connections (id, workspace_id, telegram_chat_id, title, username, chat_type, bot_is_admin, metadata) VALUES
        ('${G}','${WS}',-1001111,'Client Main','clientmain','supergroup',true,'{"member_count":999}'),
        ('${G2}','${WS2}',-1002222,'Other Main','othermain','supergroup',true,'{}'),
        ('${GR}','${WS}',-1003333,'Client Removed',NULL,'group',false,'{"last_member_status":"kicked"}'),
        ('${GN}','${WS}',-1004444,'Client New',NULL,'supergroup',true,'{}');
      INSERT INTO public.telegram_community_settings (group_connection_id, workspace_id, welcome_enabled, welcome_message, mention_member, auto_delete_enabled, auto_delete_seconds, launch_watch_cta_enabled, launch_watch_launch_id, launch_watch_show_telegram, launch_watch_cta_auto_delete_seconds, metadata) VALUES
        ('${G}','${WS}',true,'Hi {first_name}',false,true,30,true,'${L}',true,1800,'{"secret":"meta"}'),
        ('${G2}','${WS2}',true,'Other welcome',true,true,45,false,NULL,false,900,'{}');
      INSERT INTO public.commercial_stub VALUES ('${WS}', true, NULL, 'community_basic');`;
    check("DB-0 shim loads", psql(shim).ok);
    check("DB-1 SP-A + SP-B3 (identity core) apply", psql(SPA).ok && psql(B3).ok);
    check("DB-2 SP-B4 applies", psql(B4).ok, psql(B4).err.slice(0, 200));

    const calls = (ws: string, g: string) => [
      `SELECT * FROM public.partner_list_community_groups('${ws}');`,
      `SELECT public.partner_get_welcome_settings('${ws}','${g}');`,
      `SELECT public.partner_authorize_community_action('${ws}','${g}','save_welcome_settings');`,
    ];
    const allDenied = (uid: string | null, msg: string, ws = WS, g = G) => calls(ws, g).every((q) => err(as(uid, q), msg));
    check("DB-3 anon denied on all 3", allDenied(null, "permission denied"));
    check("DB-4 partner with no grant denied", allDenied(SP, "Not authorized"));
    check("DB-5 workspace owner (not a partner) denied on partner RPCs", allDenied(OWNER, "Not authorized"));
    check("DB-6 platform owner gets NO partner bypass", allDenied(PLAT, "Not authorized"));

    const inv = as(OWNER, `SELECT public.owner_invite_service_partner('${WS}','partner@example.test','{project_identity,community_management}');`);
    const accessId = inv.out.split("\n").pop() ?? "";
    check("DB-7 pending invite denied", allDenied(SP, "Not authorized"));
    as(SP, `SELECT public.partner_respond_client_invite('${accessId}', true);`);
    as(OWNER, `SELECT public.owner_update_partner_scopes('${accessId}','{project_identity,broadcasts}');`);
    check("DB-8 active grant WITHOUT community_management denied", allDenied(SP, "Not authorized"));
    as(OWNER, `SELECT public.owner_update_partner_scopes('${accessId}','{project_identity,community_management}');`);

    const groups = as(SP, `SELECT row_to_json(x)::text FROM public.partner_list_community_groups('${WS}') x;`);
    check("DB-9 lists only the client's groups", groups.ok && groups.out.includes("Client Main") && groups.out.includes("Client Removed") && !groups.out.includes("Other Main"), groups.err);
    check("DB-10 group output has no chat id / username / metadata / member count", groups.ok && !/-100|clientmain|member_count|telegram_chat_id|metadata|999/.test(groups.out) && groups.out.split("\n").every((l) => Object.keys(JSON.parse(l)).sort().join(",") === "bot_is_admin,chat_type,group_connection_id,operational,title,verified_at"));
    check("DB-11 removed-bot group not operational", groups.out.split("\n").some((l) => l.includes("Client Removed") && l.includes('"operational":false')) && groups.out.split("\n").some((l) => l.includes("Client Main") && l.includes('"operational":true')));

    const get = (g: string, ws = WS) => as(SP, `SELECT public.partner_get_welcome_settings('${ws}','${g}')::text;`);
    const saved = get(G);
    const sj = saved.ok ? JSON.parse(saved.out) : {};
    check("DB-12 get returns stored editable values", sj.welcome_enabled === true && sj.welcome_message === "Hi {first_name}" && sj.mention_member === false && sj.auto_delete_seconds === 30 && sj.has_saved_settings === true, saved.out || saved.err);
    check("DB-13 get returns safe Launch Watch summary only", sj.launch_watch_cta_enabled === true && sj.launch_watch_available === true && sj.launch_watch_label === "Client One" && sj.launch_watch_ticker === "CLT");
    check("DB-14 get output has no token / launch UUID / metadata / chat id / CTA config", !/0123456789abcdef|40000000-|secret|meta|telegram_chat_id|-100|launch_watch_launch_id|launch_watch_show|cta_auto_delete/.test(saved.out) && Object.keys(sj).sort().join(",") === "auto_delete_enabled,auto_delete_seconds,has_saved_settings,launch_watch_available,launch_watch_cta_enabled,launch_watch_label,launch_watch_ticker,mention_member,welcome_enabled,welcome_message");
    const def = get(GN); const dj = def.ok ? JSON.parse(def.out) : {};
    check("DB-15 get returns exact Edge defaults when no row", dj.has_saved_settings === false && dj.welcome_enabled === false && dj.mention_member === true && dj.auto_delete_enabled === true && dj.auto_delete_seconds === 45 && dj.launch_watch_cta_enabled === false && dj.welcome_message === "\u{1F44B} Welcome {first_name} to {community_name}!\n\nPlease check the pinned messages and official links before getting started.", def.out);
    psql(`UPDATE public.launches SET status='LIVE' WHERE id='${L}';`);
    const stale = get(G).ok ? JSON.parse(get(G).out) : {};
    check("DB-16 stale/ineligible launch → enabled + unavailable, no label", stale.launch_watch_cta_enabled === true && stale.launch_watch_available === false && stale.launch_watch_label === null && stale.launch_watch_ticker === null);
    psql(`UPDATE public.launches SET status='WATCHLIST_OPEN' WHERE id='${L}';`);
    check("DB-17 group from another workspace → not found", err(get(G2), "Group not found"));
    check("DB-18 cross-workspace call denied scope-first", err(get(G2, WS2), "Not authorized"));

    const auth = (g: string, action = "save_welcome_settings", ws = WS) => as(SP, `SELECT public.partner_authorize_community_action('${ws}','${g}',${action === "NULL" ? "NULL" : `'${action}'`})::text;`);
    check("DB-19 save authorized for own group with plan", auth(G).out === '{"code": null, "allowed": true}', auth(G).out || auth(G).err);
    check("DB-20 welcome test authorized for own group", auth(G, "send_welcome_test").out === '{"code": null, "allowed": true}');
    check("DB-21 every other action rejected", ["status", "welcome_settings", "send_group_announcement", "assign_pack", "distribute_pack", "send_group_test", "connect_group", "disconnect_group", "", "NULL"].every((a) => auth(G, a).out.includes('"ACTION_NOT_ALLOWED"')));
    check("DB-22 group from another workspace → GROUP_NOT_FOUND", auth(G2).out.includes('"GROUP_NOT_FOUND"'));
    check("DB-23 cross-workspace authorize denied", err(auth(G2, "save_welcome_settings", WS2), "Not authorized"));
    check("DB-24 authorize exposes no plan/usage internals", !/plan_code|secret_plan|used|limit|period/.test(auth(G).out));
    psql(`UPDATE public.commercial_stub SET feature='official_broadcasts' WHERE workspace_id='${WS}';`);
    check("DB-25 evaluated feature is community_basic (other feature does not allow)", !auth(G).out.includes('"allowed": true'));
    psql(`UPDATE public.commercial_stub SET feature='community_basic' WHERE workspace_id='${WS}';`);
    const setStub = (allowed: boolean, reason: string | null) => psql(`UPDATE public.commercial_stub SET allowed=${allowed}, reason=${reason ? `'${reason}'` : "NULL"} WHERE workspace_id='${WS}';`);
    setStub(false, "FEATURE_NOT_INCLUDED"); check("DB-26 FEATURE_NOT_INCLUDED mapped", auth(G).out.includes('"FEATURE_NOT_INCLUDED"'));
    setStub(false, "PLAN_LIMIT_REACHED"); check("DB-27 PLAN_LIMIT_REACHED mapped (Edge → 429)", auth(G).out.includes('"PLAN_LIMIT_REACHED"'));
    setStub(false, "ASSIGNMENT_EXPIRED"); check("DB-28 ASSIGNMENT_* → PLAN_ACCESS_INACTIVE", auth(G).out.includes('"PLAN_ACCESS_INACTIVE"'));
    setStub(false, "WHATEVER"); check("DB-29 unknown deny → COMMERCIAL_ACCESS_DENIED", auth(G).out.includes('"COMMERCIAL_ACCESS_DENIED"'));
    psql(`INSERT INTO public.platform_unrestricted VALUES ('${SP}');`);
    check("DB-30 partner flagged unrestricted still denied by CLIENT plan (no bypass)", auth(G).out.includes('"COMMERCIAL_ACCESS_DENIED"'));
    psql(`DELETE FROM public.platform_unrestricted WHERE user_id='${SP}';`);
    setStub(true, null);
    psql(`UPDATE public.project_profiles SET public_slug='Bad!' WHERE workspace_id='${WS}';`);
    check("DB-31 client without Project Identity → PROJECT_IDENTITY_REQUIRED", auth(G).out.includes('"PROJECT_IDENTITY_REQUIRED"'));
    psql(`UPDATE public.project_profiles SET public_slug='client-one' WHERE workspace_id='${WS}';`);

    const snap = () => psql(`SELECT md5(coalesce((SELECT string_agg(row_to_json(g)::text,'|' ORDER BY id) FROM public.telegram_group_connections g),'')) || md5(coalesce((SELECT string_agg(row_to_json(s)::text,'|' ORDER BY group_connection_id) FROM public.telegram_community_settings s),'')) || md5(coalesce((SELECT string_agg(row_to_json(l)::text,'|' ORDER BY id) FROM public.launches l),'')) || (SELECT count(*) FROM public.telegram_group_announcements) || (SELECT count(*) FROM public.launch_events) || (SELECT count(*) FROM public.launch_notification_deliveries) || (SELECT count(*) FROM public.sticker_pack_group_targets) || (SELECT count(*) FROM public.telegram_message_cleanup_jobs) || (SELECT count(*) FROM public.workspace_members);`).out;
    const s0 = snap();
    for (const q of [...calls(WS, G), `SELECT public.partner_authorize_community_action('${WS}','${G}','send_welcome_test');`]) as(SP, q);
    check("DB-32 partner RPCs mutate nothing (groups, settings, launches, announcements, events, deliveries, stickers, cleanup, members)", snap() === s0);

    as(OWNER, `SELECT public.owner_revoke_service_partner('${accessId}');`);
    check("DB-33 revoke immediately blocks next read + authorization", allDenied(SP, "Not authorized"));
    const inv2 = as(OWNER, `SELECT public.owner_invite_service_partner('${WS}','partner2@example.test','{community_management}');`);
    as(SP2, `SELECT public.partner_respond_client_invite('${(inv2.out.split("\n").pop() ?? "")}', false);`);
    check("DB-34 declined invite denied", allDenied(SP2, "Not authorized"));
    const inv3 = as(OWNER, `SELECT public.owner_invite_service_partner('${WS}','partner2@example.test','{community_management}');`);
    as(SP2, `SELECT public.partner_respond_client_invite('${(inv3.out.split("\n").pop() ?? "")}', true);`);
    check("DB-35 accepted community_management-only grant can read", as(SP2, `SELECT count(*) FROM public.partner_list_community_groups('${WS}');`).out === "3");
    psql(`UPDATE public.partners SET status='suspended' WHERE user_id='${SP2}';`);
    check("DB-36 suspended Service Partner denied", allDenied(SP2, "Not authorized"));
    check("DB-37 partners never became workspace members/operators", psql(`SELECT count(*) FROM public.workspace_members WHERE user_id IN ('${SP}','${SP2}');`).out === "0");
    check("DB-38 ACLs: no PUBLIC/anon on the 3 RPCs", psql(`SELECT count(*) FROM pg_proc WHERE proname IN ('${FNS.join("','")}') AND (array_to_string(proacl::text[], ',') ~ '(^|,)=X' OR array_to_string(proacl::text[], ',') LIKE '%anon=%');`).out === "0");
    check("DB-39 all 3 SECURITY DEFINER, empty search_path, postgres owner", psql(`SELECT count(*) FROM pg_proc WHERE proname IN ('${FNS.join("','")}') AND prosecdef AND proconfig = ARRAY['search_path=""'] AND pg_get_userbyid(proowner)='postgres';`).out === "3");
    check("DB-40 no table grants to authenticated/anon on community tables", psql(`SELECT count(*) FROM information_schema.role_table_grants WHERE grantee IN ('authenticated','anon') AND table_name IN ('telegram_group_connections','telegram_community_settings','launches');`).out === "0");
  } catch (e) {
    check("DB-X harness", false, String(e).slice(0, 300));
  } finally {
    try { sh(`${asPg}pg_ctl -D ${dir}/data -m immediate stop >/dev/null`); } catch { /* ignore */ }
    rmSync(dir, { recursive: true, force: true });
  }
}

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
