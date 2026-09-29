/*
 * SP-B3 V1 Partner Community Broadcasts regression.
 * 1) Static checks on staged SQL, staged telegram-group Edge source, frontend
 *    and changed-file scope.
 * 2) Throwaway LOCAL Postgres in /tmp (never Supabase): loads SP-A + SP-B3 with
 *    role-faithful authenticated/anon callers. The SP-B0 commercial core is
 *    stubbed by a controllable table so allow/deny/limit mapping is exercised.
 *    can_use_project_tools equivalence is proven against the captured LIVE
 *    pre-SP-B3 definition.
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
const EDGE = read("backend-source/edge-functions/telegram-group/index.ts");
const RUNBOOK = read("docs/SP_B3_PARTNER_BROADCASTS_RUNBOOK.md");
const LIB = read("src/lib/partner-client-access.ts");
const BLIB = read("src/lib/partner-group-broadcasts.ts");
const PANEL = read("src/components/cartel/PartnerGroupBroadcastPanel.tsx");
const TG = read("src/routes/_authenticated/telegram.tsx");
const code = B3.replace(/--.*$/gm, "");
const PLAN_COMMIT = "ed945d964fcc71f3cac52b8eb3d41993f590297b";
const EDGE_BASELINE_MD5 = "68e8d0892b3c235307914bdb47ed9353"; // repo == deployed v48 at start gate

const FNS = ["partner_list_broadcast_groups", "partner_list_group_broadcasts", "partner_authorize_group_broadcast"];
const bodyOf = (name: string) => { const i = code.indexOf(`FUNCTION public.${name}(`); return code.slice(i, code.indexOf("$function$;", i)); };

/* ---------- Static: SQL ---------- */
check("S-1 staged only, not in supabase/migrations", B3.includes("STAGED ONLY. NOT APPLIED.") && !readdirSync("supabase/migrations").some((f) => /sp_b3|group_broadcast/i.test(f)));
check("S-2 creates exactly identity core + can_use_project_tools + 3 partner RPCs", [...code.matchAll(/CREATE OR REPLACE FUNCTION public\.(\w+)/g)].map((m) => m[1]).sort().join(",") === ["can_use_project_tools", "project_identity_ready", ...FNS].sort().join(","));
check("S-3 no table/RLS/trigger/membership/DML change", !/CREATE TABLE|ALTER TABLE|CREATE POLICY|DROP |CREATE TRIGGER|INSERT INTO|UPDATE public\.|DELETE FROM|GRANT (SELECT|INSERT|UPDATE|DELETE|ALL) ON (TABLE )?public\.|FUNCTION public\.is_workspace_(member|operator)\(/i.test(code));
check("S-4 partner RPCs: SECURITY DEFINER + empty search_path + auth.uid + broadcasts scope", FNS.every((f) => { const b = bodyOf(f); return /SECURITY DEFINER\n SET search_path TO ''/.test(b) && b.includes("auth.uid()") && b.includes("public.partner_has_scope(_workspace_id, 'broadcasts')"); }));
check("S-5 scope precedes every table read", FNS.every((f) => { const b = bodyOf(f); const s = b.indexOf("partner_has_scope"); const t = b.search(/FROM public\.telegram_group_/); return s > 0 && t > s; }));
check("S-6 PUBLIC/anon revoked, authenticated+service_role granted", FNS.every((f) => new RegExp(`REVOKE ALL ON FUNCTION public\\.${f}\\([^)]*\\) FROM PUBLIC, anon;`).test(code) && new RegExp(`GRANT EXECUTE ON FUNCTION public\\.${f}\\([^)]*\\) TO authenticated, service_role;`).test(code)));
check("S-7 identity core service_role only", /REVOKE ALL ON FUNCTION public\.project_identity_ready\(uuid\) FROM PUBLIC, anon, authenticated;/.test(code) && /GRANT EXECUTE ON FUNCTION public\.project_identity_ready\(uuid\) TO service_role;/.test(code));
check("S-8 can_use_project_tools grants not changed by this file", !/ON FUNCTION public\.can_use_project_tools/.test(code));
check("S-9 authorize: group-in-workspace, identity core, SP-B0 core, no unrestricted bypass", (() => { const b = bodyOf("partner_authorize_group_broadcast"); const g = b.indexOf("g.workspace_id = _workspace_id"), i = b.indexOf("project_identity_ready"), c = b.indexOf("commercial_evaluate_workspace_feature"); return g > 0 && i > g && c > i && !/unrestricted|is_platform_owner|evaluate_commercial_access/.test(b); })());
check("S-10 history: OPERATOR_TEXT only, limit clamp 1..20", bodyOf("partner_list_group_broadcasts").includes("a.announcement_kind = 'OPERATOR_TEXT'") && bodyOf("partner_list_group_broadcasts").includes("least(greatest(coalesce(_limit, 10), 1), 20)"));
const outCols = (f: string) => (bodyOf(f).match(/RETURNS TABLE\(([^)]*)\)/)?.[1] ?? "");
check("S-11 outputs never include chat id / message id / requested_by / username / metadata", FNS.slice(0, 2).every((f) => outCols(f) && !/telegram_chat_id|telegram_message_id|requested_by|username|metadata|member/.test(outCols(f))));

/* ---------- Static: Edge ---------- */
const edgeBase = execFileSync("git", ["show", `${PLAN_COMMIT}:backend-source/edge-functions/telegram-group/index.ts`], { encoding: "utf8" });
check("E-0 staging baseline equals start-gate md5 (deployed v48)", execFileSync("md5sum", { input: edgeBase, encoding: "utf8" }).startsWith(EDGE_BASELINE_MD5));
const diffLines = execFileSync("git", ["diff", "--unified=0", PLAN_COMMIT, "--", "backend-source/edge-functions/telegram-group/index.ts"], { encoding: "utf8" }).split("\n").filter((l) => /^[+-][^+-]/.test(l));
const removed = diffLines.filter((l) => l.startsWith("-"));
check("E-1 only 7 baseline lines changed (SP-B3: 2 imports, membership, canManage, gate, send guard; SP-B4: non-member guard)", removed.length === 7, String(removed.length));
check("E-2 partner branch only for non-member + send_group_announcement", EDGE.includes('if (!membership && !partnerCommunityAuthorized) {\n    if (action !== "send_group_announcement") return respond({ error: "FORBIDDEN"'));
check("E-3 partner gate uses user-JWT client RPC", EDGE.includes('userClient.rpc("partner_authorize_group_broadcast"'));
check("E-4 plain text forced", EDGE.includes("body.brandingEnabled = false;") && EDGE.includes("body.ctaEnabled = false;") && EDGE.includes("delete body.ctaLaunchId;"));
check("E-5 owner identity/commercial gate skipped only for partner-authorized request", EDGE.includes("if (PROJECT_IDENTITY_GATED_ACTIONS.has(action) && !partnerBroadcastAuthorized && !partnerCommunityAuthorized) {"));
check("E-6 only send_group_announcement guard widened; options/official guards unchanged", (EDGE.match(/!canManageCommunity && !partnerBroadcastAuthorized/g) ?? []).length === 1 && EDGE.indexOf("!canManageCommunity && !partnerBroadcastAuthorized") > EDGE.indexOf('if (action === "send_group_announcement") {'));
check("E-7 single send engine: one ledger insert per announcement kind unchanged", (EDGE.match(/from\("telegram_group_announcements"\)\.insert\(/g) ?? []).length === (edgeBase.match(/from\("telegram_group_announcements"\)\.insert\(/g) ?? []).length);
check("E-8 requested_by stays user.id; group lookup id+workspace", EDGE.includes("requested_by: user.id,") && EDGE.includes('.eq("id", id).eq("workspace_id", workspaceId)'));
check("E-9 denial mapping uses shared commercialDenialFor + identity body", EDGE.includes('commercialDenialFor(code === "PLAN_ACCESS_INACTIVE"') && EDGE.includes("respond(PROJECT_IDENTITY_DENIAL_BODY, 403)"));
check("E-10 3500 limit unchanged in shared path", EDGE.includes("messageText.length > 3500"));

/* ---------- Static: frontend ---------- */
check("F-1 broadcasts active (community_management SP-B4, sticker_tools SP-B5); missions inactive", LIB.includes('ACTIVE_PARTNER_SCOPES: readonly PartnerClientScope[] = ["project_identity", "project_inbox", "launch_watcher_comms", "broadcasts", "community_management", "sticker_tools"]'));
check("F-2 /telegram unlocked for broadcasts", LIB.includes('{ path: "/telegram", scope: "broadcasts" }'));
check("F-3 browser: partner RPCs + plain-text send only", BLIB.includes('"partner_list_broadcast_groups"') && BLIB.includes('"partner_list_group_broadcasts"') && BLIB.includes("brandingEnabled: false") && BLIB.includes("ctaEnabled: false") && !/ctaLaunchId|reviewedLogo|from\("telegram_group/.test(BLIB + PANEL));
check("F-4 panel: preview confirm, per-draft UUID, 3500 counter, no ids", PANEL.includes("AlertDialog") && PANEL.includes("crypto.randomUUID()") && PANEL.includes("PARTNER_BROADCAST_MAX") && !/telegram_chat_id|requested_by|telegram_message_id/.test(PANEL + BLIB));
check("F-5 panel mounts no owner broadcast/branding/CTA/group-management controls", !/BroadcastsPanel|GroupAnnouncementComposer|TelegramGroupCard|OfficialContract|sendGroupAnnouncement/.test(PANEL));
check("F-6 managed /telegram composes panels by scope; owner page unchanged", TG.includes("<PartnerBroadcastPage />") && TG.includes("<PartnerGroupBroadcastPanel />") && TG.includes("if (!isManaged) return <TelegramPage />;"));
check("F-7 runbook orders SQL + EDGE + publish checkpoints", ["CP-SPB3-SQL", "CP-SPB3-EDGE", "CP-SPB3-PUBLISH"].every((c) => RUNBOOK.includes(c)));

const ALLOW = new Set([
  "docs/sql/SP_B3_partner_group_broadcasts.sql", "backend-source/edge-functions/telegram-group/index.ts", "src/lib/partner-group-broadcasts.ts",
  "src/components/cartel/PartnerGroupBroadcastPanel.tsx", "src/routes/_authenticated/telegram.tsx", "src/lib/partner-client-access.ts",
  "src/components/cartel/ManagedAccessGuard.tsx", "src/components/cartel/SidebarNav.tsx", "src/components/cartel/ServicePartnerAccessPanel.tsx",
  "scripts/sp-b3-partner-group-broadcasts-regression.ts", "docs/SP_B3_PARTNER_BROADCASTS_RUNBOOK.md",
  "scripts/sp-a-managed-client-access-regression.ts", "scripts/sp-b1-partner-inbox-regression.ts", "scripts/sp-b2-partner-launch-comms-regression.ts",
  "scripts/public-discovery-seo-regression.ts", "roadmap.md", ".lovable/plan.md",
  // Approved post-production generated-types sync (SP-B3 activation).
  "src/integrations/supabase/types.ts",
  // SP-B4 staged files (approved later phase).
  "docs/sql/SP_B4_partner_community_management.sql", "docs/SP_B4_PARTNER_COMMUNITY_RUNBOOK.md", "scripts/sp-b4-partner-community-management-regression.ts", "src/components/cartel/PartnerCommunityPanel.tsx", "src/lib/partner-community-management.ts",
  "docs/sql/SP_B5_partner_sticker_tools.sql", "docs/SP_B5_PARTNER_STICKER_TOOLS_RUNBOOK.md", "scripts/sp-b5-partner-sticker-tools-regression.ts", "src/components/cartel/PartnerStickerDropsPanel.tsx", "src/lib/partner-sticker-drops.ts", "backend-source/edge-functions/sticker-drop-config/index.ts",
]);
const changed = [
  ...execFileSync("git", ["diff", "--name-only", PLAN_COMMIT], { encoding: "utf8" }).split("\n"),
  ...execFileSync("git", ["status", "--short"], { encoding: "utf8" }).split("\n").map((l) => l.slice(3)),
].map((s) => s.trim()).filter(Boolean);
check("F-8 only allowlisted files changed since plan commit", changed.every((f) => ALLOW.has(f)), changed.filter((f) => !ALLOW.has(f)).join(","));
check("F-9 no deployed-function dir / migration / non-generated supabase integration change", !changed.some((f) => f.startsWith("supabase/") || (f.includes("integrations/supabase") && f !== "src/integrations/supabase/types.ts")));

/* ---------- Local DB ---------- */
// Captured LIVE pre-SP-B3 definition (read-only query at audit time).
const CUPT_ORIGINAL = `CREATE OR REPLACE FUNCTION public.can_use_project_tools(_workspace_id uuid, _user_id uuid DEFAULT auth.uid())
 RETURNS boolean LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE
  _caller uuid := auth.uid();
  _effective uuid := COALESCE(_user_id, auth.uid());
BEGIN
  IF _workspace_id IS NULL OR _effective IS NULL THEN RETURN false; END IF;
  IF _caller IS NOT NULL AND _user_id IS NOT NULL AND _user_id <> _caller THEN RETURN false; END IF;
  IF public.has_platform_unrestricted_access(_effective) THEN RETURN true; END IF;
  IF NOT public.is_workspace_member(_workspace_id, _effective) THEN RETURN false; END IF;
  RETURN EXISTS (
    SELECT 1 FROM public.project_profiles p
    WHERE p.workspace_id = _workspace_id
      AND char_length(btrim(p.project_name)) >= 1
      AND char_length(p.public_slug) >= 2
      AND char_length(p.public_slug) <= 64
      AND p.public_slug ~ '^[a-z0-9]+(?:-[a-z0-9]+)*$'
  );
END;
$function$;
GRANT EXECUTE ON FUNCTION public.can_use_project_tools(uuid, uuid) TO authenticated, service_role;`;

const hasPg = spawnSync("sh", ["-c", "command -v initdb && command -v pg_ctl && command -v psql"]).status === 0;
if (!hasPg) {
  check("DB-0 local Postgres available", false, "initdb/pg_ctl/psql not found");
} else {
  const dir = mkdtempSync(join(tmpdir(), "spb3-"));
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
    const WS = "10000000-0000-0000-0000-000000000001", WS2 = "10000000-0000-0000-0000-000000000002", WS3 = "10000000-0000-0000-0000-000000000003";
    const G = "30000000-0000-0000-0000-000000000001", G2 = "30000000-0000-0000-0000-000000000002", GR = "30000000-0000-0000-0000-000000000003";
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
      CREATE TABLE public.telegram_group_announcements (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), workspace_id uuid NOT NULL, group_connection_id uuid, telegram_chat_id bigint NOT NULL, group_title text NOT NULL, requested_by uuid, client_request_id uuid NOT NULL, message_text text NOT NULL, status text NOT NULL, telegram_message_id bigint, last_error text, requested_at timestamptz NOT NULL DEFAULT now(), sent_at timestamptz, delivery_kind text NOT NULL DEFAULT 'TEXT', delivered_text_snapshot text NOT NULL DEFAULT '', announcement_kind text NOT NULL DEFAULT 'OPERATOR_TEXT', launch_id uuid, UNIQUE (workspace_id, client_request_id));
      ALTER TABLE public.telegram_group_connections ENABLE ROW LEVEL SECURITY;
      ALTER TABLE public.telegram_group_announcements ENABLE ROW LEVEL SECURITY;
      CREATE TABLE public.commercial_stub (workspace_id uuid PRIMARY KEY, allowed boolean, reason text);
      CREATE FUNCTION public.commercial_evaluate_workspace_feature(_workspace_id uuid, _feature_key text, _base jsonb) RETURNS jsonb LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO '' AS $f$
        SELECT _base || jsonb_build_object('allowed', coalesce(s.allowed,false), 'reason', s.reason, 'plan_code','secret_plan','used',7,'limit',5)
        FROM (SELECT 1) x LEFT JOIN public.commercial_stub s ON s.workspace_id=_workspace_id $f$;
      REVOKE ALL ON FUNCTION public.commercial_evaluate_workspace_feature(uuid,text,jsonb) FROM PUBLIC, anon, authenticated;
      GRANT EXECUTE ON FUNCTION public.commercial_evaluate_workspace_feature(uuid,text,jsonb) TO service_role;
      CREATE TABLE public.launch_events (id uuid PRIMARY KEY DEFAULT gen_random_uuid());
      CREATE TABLE public.launch_notification_deliveries (id uuid PRIMARY KEY DEFAULT gen_random_uuid());
      INSERT INTO auth.users VALUES ('${OWNER}','owner@example.test'),('${SP}','partner@example.test'),('${OTHER}','other@example.test'),('${SP2}','partner2@example.test'),('${PLAT}','plat@example.test');
      INSERT INTO public.workspaces VALUES ('${WS}','Client One','client-one','${OWNER}',now()),('${WS2}','Other Co','other-co','${OTHER}',now()),('${WS3}','No Profile','np','${OWNER}',now());
      INSERT INTO public.workspace_members VALUES ('${WS}','${OWNER}','owner'),('${WS2}','${OTHER}','owner'),('${WS3}','${OWNER}','owner');
      INSERT INTO public.partners (user_id, is_service_partner, status) VALUES ('${SP}',true,'approved'),('${SP2}',true,'approved');
      INSERT INTO public.partner_program_terms (status, service_partner_applications_open) VALUES ('active', true);
      INSERT INTO public.platform_unrestricted VALUES ('${PLAT}');
      INSERT INTO public.project_profiles (workspace_id, public_slug, project_name) VALUES ('${WS}','client-one','Client One'),('${WS2}','Bad Slug!','Other Co');
      INSERT INTO public.telegram_group_connections (id, workspace_id, telegram_chat_id, title, username, chat_type, bot_is_admin, metadata) VALUES
        ('${G}','${WS}',-1001111,'Client Main','clientmain','supergroup',true,'{"member_count":999}'),
        ('${G2}','${WS2}',-1002222,'Other Main','othermain','supergroup',true,'{}'),
        ('${GR}','${WS}',-1003333,'Client Removed',NULL,'group',false,'{"last_member_status":"kicked"}');
      INSERT INTO public.telegram_group_announcements (workspace_id, group_connection_id, telegram_chat_id, group_title, requested_by, client_request_id, message_text, status, telegram_message_id, announcement_kind) VALUES
        ('${WS}','${G}',-1001111,'Client Main','${OWNER}',gen_random_uuid(),'owner post','SENT',42,'OPERATOR_TEXT'),
        ('${WS}','${G}',-1001111,'Client Main','${SP}',gen_random_uuid(),'partner post','SENDING',NULL,'OPERATOR_TEXT'),
        ('${WS}','${G}',-1001111,'Client Main','${OWNER}',gen_random_uuid(),'contract post','SENT',43,'OFFICIAL_CONTRACT'),
        ('${WS2}','${G2}',-1002222,'Other Main','${OTHER}',gen_random_uuid(),'other post','SENT',44,'OPERATOR_TEXT');
      INSERT INTO public.commercial_stub VALUES ('${WS}', true, NULL);`;
    check("DB-0 shim loads", psql(shim).ok);
    check("DB-1 SP-A applies", psql(SPA).ok);
    check("DB-1b captured live can_use_project_tools loads", psql(CUPT_ORIGINAL).ok);

    // Equivalence matrix: every (caller, workspace, _user_id) shape.
    const cases: Array<[string | null, string, string]> = [];
    for (const caller of [null, OWNER, SP, OTHER, PLAT]) for (const ws of [WS, WS2, WS3, "NULL"]) for (const u of [OWNER, SP, OTHER, PLAT, "NULL", "DEFAULT"]) cases.push([caller, ws, u]);
    const runMatrix = () => cases.map(([caller, ws, u]) => {
      const wsArg = ws === "NULL" ? "NULL" : `'${ws}'`;
      const q = u === "DEFAULT" ? `SELECT public.can_use_project_tools(${wsArg})::text;` : `SELECT public.can_use_project_tools(${wsArg}, ${u === "NULL" ? "NULL" : `'${u}'`})::text;`;
      const r = caller ? as(caller, q) : psql(`BEGIN; SET LOCAL ROLE service_role; ${q} COMMIT;`);
      return r.ok ? r.out : "ERR";
    }).join(",");
    const before = runMatrix();
    const aclBefore = psql(`SELECT array_to_string(proacl::text[], ',') FROM pg_proc WHERE proname='can_use_project_tools';`).out;
    const b3 = psql(B3); check("DB-2 SP-B3 applies", b3.ok, b3.err.slice(0, 300));
    check("DB-2b SP-B3 re-runnable", psql(B3).ok);
    const after = runMatrix();
    check(`DB-3 can_use_project_tools output identical across ${cases.length} cases`, before === after && before.includes("true") && before.includes("false"), before === after ? "" : "diff");
    check("DB-3b can_use_project_tools ACL unchanged", psql(`SELECT array_to_string(proacl::text[], ',') FROM pg_proc WHERE proname='can_use_project_tools';`).out === aclBefore);
    check("DB-3c identity core not callable by authenticated/anon", err(as(OWNER, `SELECT public.project_identity_ready('${WS}');`), "permission denied") && err(as(null, `SELECT public.project_identity_ready('${WS}');`), "permission denied"));

    const calls = (ws: string, g: string) => [
      `SELECT * FROM public.partner_list_broadcast_groups('${ws}');`,
      `SELECT * FROM public.partner_list_group_broadcasts('${ws}', 10);`,
      `SELECT public.partner_authorize_group_broadcast('${ws}','${g}');`,
    ];
    const allDenied = (uid: string | null, msg: string, ws = WS, g = G) => calls(ws, g).every((q) => err(as(uid, q), msg));
    check("DB-4 anon denied on all 3", allDenied(null, "permission denied"));
    check("DB-5 partner with no grant denied", allDenied(SP, "Not authorized"));
    check("DB-6 workspace owner (not a partner) denied on partner RPCs", allDenied(OWNER, "Not authorized"));
    check("DB-6b platform owner gets NO partner bypass", allDenied(PLAT, "Not authorized"));

    const inv = as(OWNER, `SELECT public.owner_invite_service_partner('${WS}','partner@example.test','{project_identity,broadcasts}');`);
    const accessId = inv.out.split("\n").pop() ?? "";
    check("DB-7 pending invite denied", allDenied(SP, "Not authorized"));
    as(SP, `SELECT public.partner_respond_client_invite('${accessId}', true);`);
    as(OWNER, `SELECT public.owner_update_partner_scopes('${accessId}','{project_identity,launch_watcher_comms}');`);
    check("DB-8 active grant WITHOUT broadcasts denied", allDenied(SP, "Not authorized"));
    as(OWNER, `SELECT public.owner_update_partner_scopes('${accessId}','{project_identity,broadcasts}');`);

    const groups = as(SP, `SELECT row_to_json(x)::text FROM public.partner_list_broadcast_groups('${WS}') x;`);
    check("DB-9 lists only the client's groups", groups.ok && groups.out.includes("Client Main") && groups.out.includes("Client Removed") && !groups.out.includes("Other Main"));
    check("DB-10 group output has no chat id / username / metadata / member count", groups.ok && !/-100|clientmain|member_count|telegram_chat_id|metadata|999/.test(groups.out));
    check("DB-11 removed-bot group marked not operational", groups.out.split("\n").some((l) => l.includes("Client Removed") && l.includes('"operational":false')) && groups.out.split("\n").some((l) => l.includes("Client Main") && l.includes('"operational":true')));
    const hist = as(SP, `SELECT row_to_json(x)::text FROM public.partner_list_group_broadcasts('${WS}', 10) x;`);
    check("DB-12 history: OPERATOR_TEXT only, own workspace only", hist.ok && hist.out.includes("owner post") && hist.out.includes("partner post") && !hist.out.includes("contract post") && !hist.out.includes("other post"));
    check("DB-13 history hides chat id, message id, requested_by UUID", hist.ok && !/-100|telegram_message_id|telegram_chat_id|requested_by|00000000-0000-0000-0000-00000000000/.test(hist.out) && hist.out.split("\n").every((l) => Object.keys(JSON.parse(l)).sort().join(",") === "actor_kind,announcement_id,delivery_kind,group_title,message_text,requested_at,sent_at,status"));
    check("DB-14 history actor_kind derived, SENDING shown as AMBIGUOUS", hist.out.includes('"actor_kind":"project_team"') && hist.out.includes('"actor_kind":"you"') && hist.out.includes('"status":"AMBIGUOUS"'));
    check("DB-15 history limit clamp", as(SP, `SELECT count(*) FROM public.partner_list_group_broadcasts('${WS}', 0);`).out === "1" && as(SP, `SELECT count(*) FROM public.partner_list_group_broadcasts('${WS}', 500);`).out === "2");

    const auth = (g: string, ws = WS) => as(SP, `SELECT public.partner_authorize_group_broadcast('${ws}','${g}')::text;`);
    check("DB-16 authorize allowed for own group with plan", auth(G).out === '{"code": null, "allowed": true}', auth(G).out);
    check("DB-17 group from another workspace → GROUP_NOT_FOUND", auth(G2).out.includes('"GROUP_NOT_FOUND"'));
    check("DB-18 cross-workspace call denied", err(auth(G2, WS2), "Not authorized"));
    const out = auth(G).out;
    check("DB-19 authorize result exposes no plan/usage internals", !/plan_code|secret_plan|used|limit|period/.test(out));
    const setStub = (allowed: boolean, reason: string | null) => psql(`UPDATE public.commercial_stub SET allowed=${allowed}, reason=${reason ? `'${reason}'` : "NULL"} WHERE workspace_id='${WS}';`);
    setStub(false, "FEATURE_NOT_INCLUDED"); check("DB-20 FEATURE_NOT_INCLUDED mapped", auth(G).out.includes('"FEATURE_NOT_INCLUDED"') && auth(G).out.includes("false"));
    setStub(false, "PLAN_LIMIT_REACHED"); check("DB-21 PLAN_LIMIT_REACHED mapped (Edge → 429)", auth(G).out.includes('"PLAN_LIMIT_REACHED"'));
    setStub(false, "ASSIGNMENT_EXPIRED"); check("DB-22 ASSIGNMENT_* → PLAN_ACCESS_INACTIVE", auth(G).out.includes('"PLAN_ACCESS_INACTIVE"'));
    setStub(false, "WHATEVER"); check("DB-23 unknown deny → COMMERCIAL_ACCESS_DENIED", auth(G).out.includes('"COMMERCIAL_ACCESS_DENIED"'));
    psql(`INSERT INTO public.platform_unrestricted VALUES ('${SP}');`);
    check("DB-24 partner flagged unrestricted still denied by CLIENT plan (no bypass)", auth(G).out.includes('"COMMERCIAL_ACCESS_DENIED"'));
    psql(`DELETE FROM public.platform_unrestricted WHERE user_id='${SP}';`);
    setStub(true, null);
    psql(`UPDATE public.project_profiles SET public_slug='Bad!' WHERE workspace_id='${WS}';`);
    check("DB-25 client without Project Identity → PROJECT_IDENTITY_REQUIRED", auth(G).out.includes('"PROJECT_IDENTITY_REQUIRED"'));
    psql(`UPDATE public.project_profiles SET public_slug='client-one' WHERE workspace_id='${WS}';`);

    const snap = () => psql(`SELECT md5(coalesce((SELECT string_agg(row_to_json(g)::text,'|' ORDER BY id) FROM public.telegram_group_connections g),'')) || md5(coalesce((SELECT string_agg(row_to_json(a)::text,'|' ORDER BY id) FROM public.telegram_group_announcements a),'')) || (SELECT count(*) FROM public.launch_events) || (SELECT count(*) FROM public.launch_notification_deliveries) || (SELECT count(*) FROM public.workspace_members);`).out;
    const s0 = snap();
    for (const q of calls(WS, G)) as(SP, q);
    check("DB-26 partner RPCs mutate nothing (groups, ledger, launch events, deliveries, members)", snap() === s0);

    as(OWNER, `SELECT public.owner_revoke_service_partner('${accessId}');`);
    check("DB-27 revoke immediately blocks next authorization + reads", allDenied(SP, "Not authorized"));
    const inv2 = as(OWNER, `SELECT public.owner_invite_service_partner('${WS}','partner2@example.test','{broadcasts}');`);
    as(SP2, `SELECT public.partner_respond_client_invite('${(inv2.out.split("\n").pop() ?? "")}', false);`);
    check("DB-28 declined invite denied", allDenied(SP2, "Not authorized"));
    const inv3 = as(OWNER, `SELECT public.owner_invite_service_partner('${WS}','partner2@example.test','{broadcasts}');`);
    as(SP2, `SELECT public.partner_respond_client_invite('${(inv3.out.split("\n").pop() ?? "")}', true);`);
    psql(`UPDATE public.partners SET status='suspended' WHERE user_id='${SP2}';`);
    check("DB-29 suspended Service Partner denied", allDenied(SP2, "Not authorized"));
    check("DB-30 partners never became workspace members/operators", psql(`SELECT count(*) FROM public.workspace_members WHERE user_id IN ('${SP}','${SP2}');`).out === "0");
    check("DB-31 ACLs: no PUBLIC/anon on the 3 RPCs", psql(`SELECT count(*) FROM pg_proc WHERE proname IN ('${FNS.join("','")}') AND (array_to_string(proacl::text[], ',') ~ '(^|,)=X' OR array_to_string(proacl::text[], ',') LIKE '%anon=%');`).out === "0");
    check("DB-32 all 3 SECURITY DEFINER with empty search_path", psql(`SELECT count(*) FROM pg_proc WHERE proname IN ('${FNS.join("','")}') AND prosecdef AND proconfig = ARRAY['search_path=""'];`).out === "3");
    check("DB-33 no table DML grants to authenticated/anon on group tables", psql(`SELECT count(*) FROM information_schema.role_table_grants WHERE grantee IN ('authenticated','anon') AND table_name IN ('telegram_group_connections','telegram_group_announcements');`).out === "0");
  } catch (e) {
    check("DB-X harness", false, String(e).slice(0, 300));
  } finally {
    try { sh(`${asPg}pg_ctl -D ${dir}/data -m immediate stop >/dev/null`); } catch { /* ignore */ }
    rmSync(dir, { recursive: true, force: true });
  }
}

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
