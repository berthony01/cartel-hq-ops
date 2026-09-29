/*
 * SP-B1 Partner Project Inbox regression.
 * 1) Static checks on staged SQL + frontend.
 * 2) Throwaway LOCAL Postgres in /tmp (never Supabase): loads SP-A, SP-B0 and
 *    SP-B1 staged SQL with role-faithful `authenticated`/`anon` callers.
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
const SPA = read("docs/sql/SP_A_partner_client_access.sql");
const B0 = read("docs/sql/SP_B0_commercial_workspace_entitlement_core.sql");
const B1 = read("docs/sql/SP_B1_partner_project_inbox.sql");
const RUNBOOK = read("docs/SP_B1_PARTNER_INBOX_RUNBOOK.md");
const LIB = read("src/lib/partner-client-access.ts");
const INBOX = read("src/lib/project-inbox.ts");
const PANEL = read("src/components/cartel/ProjectInboxPanel.tsx");
const TG = read("src/routes/_authenticated/telegram.tsx");
const NAV = read("src/components/cartel/SidebarNav.tsx");
const GUARD = read("src/components/cartel/ManagedAccessGuard.tsx");
const code = B1.replace(/--.*$/gm, "");

const FNS = ["partner_inbox_summary", "partner_inbox_list_conversations", "partner_inbox_get_conversation", "partner_inbox_list_messages", "partner_inbox_create_reply", "partner_inbox_update_status", "partner_inbox_ack_uncertainty"];
const OWNER_FNS = ["get_project_inbox_summary", "list_project_inbox_conversations", "get_project_inbox_conversation", "list_project_conversation_messages", "create_project_inbox_team_reply", "update_project_conversation_status", "acknowledge_project_inbox_delivery_uncertainty", "set_project_inbox_settings", "set_project_inbox_replies_enabled", "set_project_inbox_new_conversations_enabled", "set_project_inbox_contact_blocked", "set_project_inbox_conversation_contact_blocked"];
const bodyOf = (name: string) => { const i = code.indexOf(`FUNCTION public.${name}(`); return code.slice(i, code.indexOf("$function$;", i)); };

/* ---------- Static: SQL ---------- */
check("S-1 staged only, not in supabase/migrations", B1.includes("STAGED ONLY. NOT APPLIED.") && !readdirSync("supabase/migrations").some((f) => /sp_b1|partner_inbox/i.test(f)));
check("S-2 exactly the seven partner RPCs are created", [...code.matchAll(/CREATE OR REPLACE FUNCTION public\.(\w+)/g)].map((m) => m[1]).sort().join(",") === [...FNS].sort().join(","));
check("S-3 no owner inbox RPC is redefined (B0 or B1)", OWNER_FNS.every((f) => !B1.includes(`FUNCTION public.${f}(`) && !B0.includes(`FUNCTION public.${f}(`)));
check("S-4 no table/RLS/constraint/trigger/membership change", !/CREATE TABLE|ALTER TABLE|CREATE POLICY|DROP |CREATE TRIGGER|workspace_members|is_workspace_member|is_workspace_operator/i.test(code));
check("S-5 every RPC: SECURITY DEFINER + empty search_path + auth.uid + scope", FNS.every((f) => { const b = bodyOf(f); return /SECURITY DEFINER\n SET search_path TO ''/.test(b) && b.includes("auth.uid()") && b.includes("public.partner_has_scope(_workspace_id, 'project_inbox')"); }));
check("S-6 every conversation/message RPC cross-checks workspace", FNS.filter((f) => f !== "partner_inbox_summary").every((f) => /workspace_id = _workspace_id/.test(bodyOf(f))));
check("S-7 PUBLIC/anon revoked, authenticated granted, per RPC", FNS.every((f) => new RegExp(`REVOKE ALL ON FUNCTION public\\.${f}\\([^)]*\\) FROM PUBLIC, anon;`).test(code) && new RegExp(`GRANT EXECUTE ON FUNCTION public\\.${f}\\([^)]*\\) TO authenticated, service_role;`).test(code)));
check("S-8 no settings/block wrapper; no Telegram ids returned", !/set_project_inbox|blocked_at|telegram_user_id\s*[,)]\s*$/m.test(code.replace(/v_contact\.telegram_user_id|telegram_user_id, status, next_attempt_at/g, "")) && !/RETURNS TABLE\([^)]*telegram/i.test(code));
const reply = bodyOf("partner_inbox_create_reply");
check("S-9 reply keeps every owner guard", ["partner_evaluate_commercial_access(_workspace_id, 'project_inbox')", "COMMERCIAL_ACCESS_DENIED", "between 1 and 3500", "already used for a different reply", "FOR UPDATE", "This conversation is resolved", "This member is blocked", "not settled yet", "Save your Project Profile name", "too long to deliver", "OFFICIAL PROJECT RESPONSE"].every((s) => reply.includes(s)));
check("S-10 reply scope check precedes commercial check", reply.indexOf("partner_has_scope") < reply.indexOf("partner_evaluate_commercial_access"));
check("S-11 status limited to the four operational statuses", bodyOf("partner_inbox_update_status").includes("NOT IN ('OPEN', 'WAITING_ON_TEAM', 'WAITING_ON_MEMBER', 'RESOLVED')"));
check("S-12 ack only for ambiguous deliveries", bodyOf("partner_inbox_ack_uncertainty").includes("IF v_status <> 'ambiguous'"));

/* ---------- Static: frontend ---------- */
check("F-1 project_inbox active; other SP-B scopes still inactive", /ACTIVE_PARTNER_SCOPES: readonly PartnerClientScope\[\] = \["project_identity", "project_inbox"\]/.test(LIB));
check("F-2 /telegram allowed for managed only with project_inbox scope", LIB.includes('"/telegram"') && LIB.includes("project_inbox") && /isManagedAllowedPath\(pathname: string, scopes/.test(LIB));
check("F-3 partner wrappers call only partner_inbox_* RPCs", FNS.every((f) => INBOX.includes(`"${f}"`)));
check("F-4 panel partner mode hides settings + block", PANEL.includes('mode === "partner"') && /isPartner \? null|!isPartner &&/.test(PANEL));
check("F-5 /telegram renders only partner inbox for managed projects", TG.includes('mode="partner"') && TG.includes("<PartnerInboxPage />") && TG.includes("isManaged"));
check("F-6 nav + guard are scope-aware", NAV.includes("workspace?.scopes") && GUARD.includes("workspace?.scopes"));
check("F-7 runbook orders B0 before B1 and publish before SQL", (() => { const a = RUNBOOK.indexOf("CP-SPB1-PUBLISH"), b = RUNBOOK.indexOf("CP-SPB0-SQL"), c = RUNBOOK.indexOf("CP-SPB1-SQL"); return a >= 0 && b > a && c > b; })());

/* ---------- Local DB ---------- */
const hasPg = spawnSync("sh", ["-c", "command -v initdb && command -v pg_ctl && command -v psql"]).status === 0;
if (!hasPg) {
  check("DB-0 local Postgres available", false, "initdb/pg_ctl/psql not found");
} else {
  const dir = mkdtempSync(join(tmpdir(), "spb1-"));
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
    const CT = "40000000-0000-0000-0000-000000000001", CT2 = "40000000-0000-0000-0000-000000000002", CTB = "40000000-0000-0000-0000-000000000003";
    const CV = "50000000-0000-0000-0000-000000000001", CV2 = "50000000-0000-0000-0000-000000000002", CVB = "50000000-0000-0000-0000-000000000003";
    const FREE = "30000000-0000-0000-0000-000000000001";
    const shim = `
      CREATE ROLE anon NOLOGIN; CREATE ROLE authenticated NOLOGIN; CREATE ROLE service_role NOLOGIN BYPASSRLS;
      CREATE SCHEMA auth; GRANT USAGE ON SCHEMA auth, public TO anon, authenticated, service_role;
      CREATE TABLE auth.users (id uuid PRIMARY KEY, email text);
      CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS $$ SELECT nullif(current_setting('request.jwt.claims', true)::jsonb->>'sub','')::uuid $$;
      GRANT EXECUTE ON FUNCTION auth.uid() TO anon, authenticated, service_role;
      CREATE TABLE public.workspaces (id uuid PRIMARY KEY, name text, slug text, owner_id uuid, created_at timestamptz DEFAULT now());
      CREATE TABLE public.workspace_members (workspace_id uuid, user_id uuid, role text);
      CREATE TABLE public.platform_user_roles (user_id uuid, role text);
      CREATE FUNCTION public.is_workspace_member(_workspace_id uuid, _user_id uuid) RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public' AS $f$ SELECT EXISTS (SELECT 1 FROM public.workspace_members wm WHERE wm.workspace_id=_workspace_id AND wm.user_id=_user_id) $f$;
      CREATE FUNCTION public.is_workspace_operator(_workspace_id uuid, _user_id uuid) RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public' AS $f$ SELECT EXISTS (SELECT 1 FROM public.workspace_members wm WHERE wm.workspace_id=_workspace_id AND wm.user_id=_user_id AND wm.role IN ('owner','admin')) $f$;
      CREATE FUNCTION public.is_platform_owner(_user_id uuid) RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'pg_catalog','public' AS $f$ select _user_id is not null and (auth.uid() is null or auth.uid() = _user_id) and exists (select 1 from public.platform_user_roles pur where pur.user_id=_user_id and pur.role='owner') $f$;
      CREATE FUNCTION public.has_platform_unrestricted_access(_user_id uuid) RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'pg_catalog','public' AS $f$ select public.is_platform_owner(_user_id) $f$;
      GRANT EXECUTE ON FUNCTION public.is_workspace_member(uuid,uuid), public.is_workspace_operator(uuid,uuid) TO authenticated;
      GRANT SELECT ON public.workspaces TO authenticated;
      ALTER TABLE public.workspaces ENABLE ROW LEVEL SECURITY;
      CREATE POLICY ws_sel ON public.workspaces FOR SELECT TO authenticated USING (public.is_workspace_member(id, auth.uid()));
      CREATE TABLE public.partners (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), user_id uuid UNIQUE, is_affiliate boolean DEFAULT false, is_service_partner boolean DEFAULT false, status text);
      CREATE TABLE public.partner_program_terms (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), status text, service_partner_applications_open boolean DEFAULT false);
      CREATE TABLE public.project_profiles (workspace_id uuid PRIMARY KEY, public_slug text, project_name text NOT NULL, ticker text, primary_chain text, tagline varchar(140), description text, website_url text, telegram_url text, x_url text, discovery_status text DEFAULT 'draft', logo_asset_id uuid, updated_at timestamptz DEFAULT now());
      CREATE TABLE public.profiles (id uuid PRIMARY KEY, display_name text);
      CREATE TABLE public.commercial_plans (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), code text NOT NULL, version integer NOT NULL, name text NOT NULL, status text NOT NULL, price_cents integer NOT NULL, currency text NOT NULL, billing_interval text NOT NULL);
      CREATE TABLE public.commercial_plan_entitlements (plan_id uuid NOT NULL, feature_key text NOT NULL, kind text NOT NULL, enabled boolean NOT NULL DEFAULT true, limit_value integer, period text NOT NULL);
      CREATE TABLE public.workspace_commercial_assignments (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), workspace_id uuid NOT NULL, plan_id uuid NOT NULL, status text NOT NULL, enforcement_mode text NOT NULL DEFAULT 'observe', starts_at timestamptz NOT NULL DEFAULT now(), ends_at timestamptz);
      CREATE FUNCTION public.commercial_feature_usage(_w uuid, _f text, _s timestamptz, _e timestamptz) RETURNS bigint LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public' AS $f$ SELECT 0::bigint $f$;
      REVOKE ALL ON FUNCTION public.commercial_feature_usage(uuid,text,timestamptz,timestamptz) FROM PUBLIC;
      CREATE TABLE public.project_inbox_contacts (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), workspace_id uuid NOT NULL, telegram_user_id bigint NOT NULL, member_ref text NOT NULL, status text NOT NULL DEFAULT 'ACTIVE', blocked_at timestamptz, blocked_by uuid, last_contact_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(), UNIQUE (id, workspace_id));
      CREATE TABLE public.project_conversations (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), workspace_id uuid NOT NULL, contact_id uuid NOT NULL, origin_type text NOT NULL DEFAULT 'MEMBER_INITIATED', origin_title_snapshot text, origin_text_snapshot text, category text NOT NULL DEFAULT 'GENERAL', status text NOT NULL DEFAULT 'WAITING_ON_TEAM' CHECK (status IN ('OPEN','WAITING_ON_TEAM','WAITING_ON_MEMBER','RESOLVED')), priority text NOT NULL DEFAULT 'NORMAL', assigned_to uuid REFERENCES public.profiles(id), opened_at timestamptz NOT NULL DEFAULT now(), last_message_at timestamptz NOT NULL DEFAULT now(), resolved_at timestamptz, created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(),
        FOREIGN KEY (contact_id, workspace_id) REFERENCES public.project_inbox_contacts(id, workspace_id),
        CONSTRAINT resolution_shape CHECK ((status='RESOLVED' AND resolved_at IS NOT NULL) OR (status<>'RESOLVED' AND resolved_at IS NULL)));
      CREATE TABLE public.project_conversation_messages (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), conversation_id uuid NOT NULL REFERENCES public.project_conversations(id), author_type text NOT NULL, channel text NOT NULL, team_user_id uuid REFERENCES public.profiles(id), body text NOT NULL CHECK (length(btrim(body)) BETWEEN 1 AND 4096), reply_to_message_id uuid, telegram_chat_id bigint, telegram_message_id bigint, client_request_id uuid, created_at timestamptz NOT NULL DEFAULT now(),
        CONSTRAINT author_shape CHECK ((author_type='TEAM' AND team_user_id IS NOT NULL) OR (author_type IN ('MEMBER','SYSTEM') AND team_user_id IS NULL)),
        CONSTRAINT channel_shape CHECK ((author_type='SYSTEM' AND channel='SYSTEM') OR (channel='WEB' AND author_type='TEAM') OR (channel='TELEGRAM' AND author_type IN ('MEMBER','TEAM'))));
      CREATE TABLE public.project_inbox_deliveries (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), conversation_id uuid NOT NULL REFERENCES public.project_conversations(id), message_id uuid NOT NULL, telegram_user_id bigint NOT NULL, status text NOT NULL DEFAULT 'pending', attempt_count integer NOT NULL DEFAULT 0, next_attempt_at timestamptz NOT NULL DEFAULT now(), sent_at timestamptz, template_version text, project_name_snapshot text, ticker_snapshot text, delivered_text_snapshot text, uncertainty_acknowledged_at timestamptz, uncertainty_acknowledged_by uuid, updated_at timestamptz NOT NULL DEFAULT now());
      CREATE FUNCTION public.project_inbox_apply_message_state() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $f$
      BEGIN
        UPDATE public.project_conversations c SET last_message_at = GREATEST(c.last_message_at, NEW.created_at),
          status = CASE WHEN c.status='RESOLVED' THEN c.status WHEN NEW.author_type='MEMBER' THEN 'WAITING_ON_TEAM' ELSE c.status END, updated_at = now()
         WHERE c.id = NEW.conversation_id;
        RETURN NEW;
      END $f$;
      CREATE TRIGGER project_conversation_messages_apply_state AFTER INSERT ON public.project_conversation_messages FOR EACH ROW EXECUTE FUNCTION public.project_inbox_apply_message_state();
      INSERT INTO auth.users VALUES ('${OWNER}','owner@example.test'),('${SP}','partner@example.test'),('${OTHER}','other@example.test'),('${SP2}','partner2@example.test');
      INSERT INTO public.profiles VALUES ('${OWNER}','Owner'),('${SP}','Agency Partner'),('${OTHER}','Other'),('${SP2}','Partner Two');
      INSERT INTO public.workspaces VALUES ('${WS}','Client One','client-one','${OWNER}',now()),('${WS2}','Other Co','other-co','${OTHER}',now());
      INSERT INTO public.workspace_members VALUES ('${WS}','${OWNER}','owner'),('${WS2}','${OTHER}','owner');
      INSERT INTO public.partners (user_id, is_service_partner, status) VALUES ('${SP}',true,'approved'),('${SP2}',true,'approved');
      INSERT INTO public.partner_program_terms (status, service_partner_applications_open) VALUES ('active', true);
      INSERT INTO public.project_profiles (workspace_id, public_slug, project_name, ticker) VALUES ('${WS}','client-one','Client One','CLI'),('${WS2}','other-co','Other Co',NULL);
      INSERT INTO public.commercial_plans (id, code, version, name, status, price_cents, currency, billing_interval) VALUES ('${FREE}','cartel_free',1,'Free','active',0,'usd','none');
      INSERT INTO public.commercial_plan_entitlements VALUES ('${FREE}','project_inbox','feature',true,NULL,'none');
      INSERT INTO public.project_inbox_contacts (id, workspace_id, telegram_user_id, member_ref) VALUES ('${CT}','${WS}',111111,'AAAA1111'),('${CTB}','${WS}',333333,'BBBB3333'),('${CT2}','${WS2}',222222,'CCCC2222');
      UPDATE public.project_inbox_contacts SET status='BLOCKED', blocked_at=now() WHERE id='${CTB}';
      INSERT INTO public.project_conversations (id, workspace_id, contact_id) VALUES ('${CV}','${WS}','${CT}'),('${CVB}','${WS}','${CTB}'),('${CV2}','${WS2}','${CT2}');
      INSERT INTO public.project_conversation_messages (conversation_id, author_type, channel, body, telegram_chat_id) VALUES ('${CV}','MEMBER','TELEGRAM','gm team', 111111),('${CV2}','MEMBER','TELEGRAM','other project msg', 222222);`;
    check("DB-0 shim loads", psql(shim).ok);
    check("DB-1 SP-A applies", psql(SPA).ok);
    const b0 = psql(B0); check("DB-2 SP-B0 applies", b0.ok, b0.err.slice(0, 300));
    const b1 = psql(B1); check("DB-3 SP-B1 applies", b1.ok, b1.err.slice(0, 300));
    check("DB-3b SP-B1 re-runnable", psql(B1).ok);

    const as = (uid: string | null, sql: string) => psql(`BEGIN; SET LOCAL ROLE ${uid ? "authenticated" : "anon"}; SET LOCAL request.jwt.claims = '${uid ? JSON.stringify({ sub: uid, role: "authenticated" }) : "{}"}';\n${sql}\nCOMMIT;`);
    const err = (r: { ok: boolean; err: string }, s: string) => !r.ok && r.err.includes(s);
    const R1 = "60000000-0000-0000-0000-000000000001", R2 = "60000000-0000-0000-0000-000000000002";

    for (const f of ["partner_inbox_summary('" + WS + "')", `partner_inbox_list_conversations('${WS}')`, `partner_inbox_get_conversation('${WS}','${CV}')`]) {
      if (!err(as(null, `SELECT * FROM public.${f};`), "permission denied")) check(`DB-4 anon denied ${f}`, false);
    }
    check("DB-4 anon cannot execute partner RPCs", err(as(null, `SELECT * FROM public.partner_inbox_create_reply('${WS}','${CV}','hi','${R1}');`), "permission denied"));
    const all = (uid: string) => [
      as(uid, `SELECT * FROM public.partner_inbox_summary('${WS}');`),
      as(uid, `SELECT * FROM public.partner_inbox_list_conversations('${WS}');`),
      as(uid, `SELECT * FROM public.partner_inbox_get_conversation('${WS}','${CV}');`),
      as(uid, `SELECT * FROM public.partner_inbox_list_messages('${WS}','${CV}');`),
      as(uid, `SELECT * FROM public.partner_inbox_create_reply('${WS}','${CV}','hi','${R1}');`),
      as(uid, `SELECT * FROM public.partner_inbox_update_status('${WS}','${CV}','OPEN');`),
      as(uid, `SELECT * FROM public.partner_inbox_ack_uncertainty('${WS}','${CV}','${R1}');`),
    ].every((r) => err(r, "Not authorized"));
    check("DB-5 partner with no grant denied on all 7", all(SP));
    check("DB-6 workspace owner (not a partner) denied on partner RPCs", all(OWNER));

    const inv = as(OWNER, `SELECT public.owner_invite_service_partner('${WS}','partner@example.test','{project_identity}');`);
    const accessId = inv.out.split("\n").pop() ?? "";
    as(SP, `SELECT public.partner_respond_client_invite('${accessId}', true);`);
    check("DB-7 active grant WITHOUT project_inbox denied on all 7", all(SP));
    as(OWNER, `SELECT public.owner_update_partner_scopes('${accessId}','{project_identity,project_inbox}');`);

    const sum = as(SP, `SELECT concat_ws('|', open_count, waiting_on_team_count, waiting_on_member_count, resolved_count, blocked_contact_count) FROM public.partner_inbox_summary('${WS}');`);
    check("DB-8 summary scoped to client workspace", sum.out === "0|2|0|0|1", sum.out || sum.err);
    const list = as(SP, `SELECT row_to_json(x)::text FROM public.partner_inbox_list_conversations('${WS}') x;`);
    check("DB-9 list shows only this workspace, no Telegram ids", list.ok && list.out.split("\n").length === 2 && !list.out.includes("CCCC2222") && !/111111|telegram|contact_id/.test(list.out), list.out || list.err);
    check("DB-10 invalid status filter rejected", err(as(SP, `SELECT * FROM public.partner_inbox_list_conversations('${WS}','BOGUS');`), "Invalid status"));
    check("DB-11 cross-workspace conversation denied (get/messages/status/reply)", [
      as(SP, `SELECT * FROM public.partner_inbox_get_conversation('${WS}','${CV2}');`),
      as(SP, `SELECT * FROM public.partner_inbox_list_messages('${WS}','${CV2}');`),
      as(SP, `SELECT * FROM public.partner_inbox_update_status('${WS}','${CV2}','OPEN');`),
      as(SP, `SELECT * FROM public.partner_inbox_create_reply('${WS}','${CV2}','x','${R2}');`),
      as(SP, `SELECT * FROM public.partner_inbox_summary('${WS2}');`),
    ].every((r) => err(r, "Not authorized")));
    const msgs = as(SP, `SELECT row_to_json(x)::text FROM public.partner_inbox_list_messages('${WS}','${CV}') x;`);
    check("DB-12 messages readable, no Telegram ids", msgs.ok && msgs.out.includes("gm team") && !/111111|telegram_chat/.test(msgs.out), msgs.out || msgs.err);

    const rep = as(SP, `SELECT concat_ws('|', delivery_status, conversation_status, idempotent_replay) FROM public.partner_inbox_create_reply('${WS}','${CV}','  Hello from the team  ','${R1}');`);
    check("DB-13 partner reply queued once", rep.out === "pending|WAITING_ON_TEAM|f", rep.out || rep.err);
    const replay = as(SP, `SELECT concat_ws('|', delivery_status, idempotent_replay) FROM public.partner_inbox_create_reply('${WS}','${CV}','Hello from the team','${R1}');`);
    check("DB-14 same request id replays original, no second send", replay.out === "pending|t" && psql(`SELECT count(*) FROM public.project_inbox_deliveries;`).out === "1", replay.out || replay.err);
    check("DB-15 same id different body rejected", err(as(SP, `SELECT * FROM public.partner_inbox_create_reply('${WS}','${CV}','changed','${R1}');`), "different reply"));
    check("DB-16 unsettled earlier delivery blocks new reply", err(as(SP, `SELECT * FROM public.partner_inbox_create_reply('${WS}','${CV}','again','${R2}');`), "not settled yet"));
    const dv = psql(`SELECT concat_ws('|', m.author_type, m.channel, m.team_user_id, d.telegram_user_id, d.delivered_text_snapshot LIKE 'Client One · CLI%OFFICIAL PROJECT RESPONSE%Hello from the team%') FROM public.project_conversation_messages m JOIN public.project_inbox_deliveries d ON d.message_id=m.id;`);
    check("DB-17 reply stored as TEAM/WEB by partner user, delivered to conversation contact with project branding", dv.out === `TEAM|WEB|${SP}|111111|t`, dv.out);
    check("DB-18 blocked member cannot be replied to", err(as(SP, `SELECT * FROM public.partner_inbox_create_reply('${WS}','${CVB}','hi','${R2}');`), "This member is blocked"));
    check("DB-19 body length enforced", err(as(SP, `SELECT * FROM public.partner_inbox_create_reply('${WS}','${CV}','   ','${R2}');`), "between 1 and 3500"));

    const msgId = psql(`SELECT message_id FROM public.project_inbox_deliveries LIMIT 1;`).out;
    check("DB-20 ack rejected for non-ambiguous delivery", err(as(SP, `SELECT * FROM public.partner_inbox_ack_uncertainty('${WS}','${CV}','${msgId}');`), "Only an uncertain delivery"));
    psql(`UPDATE public.project_inbox_deliveries SET status='ambiguous';`);
    const ack = as(SP, `SELECT delivery_status FROM public.partner_inbox_ack_uncertainty('${WS}','${CV}','${msgId}');`);
    check("DB-21 ack of uncertain delivery; recorded by partner; nothing resent", ack.out === "ambiguous" && psql(`SELECT concat_ws('|', status, uncertainty_acknowledged_by, (SELECT count(*) FROM public.project_inbox_deliveries)) FROM public.project_inbox_deliveries;`).out === `ambiguous|${SP}|1`, ack.out || ack.err);
    check("DB-22 ack cross-workspace denied", err(as(SP, `SELECT * FROM public.partner_inbox_ack_uncertainty('${WS2}','${CV}','${msgId}');`), "Not authorized"));

    check("DB-23 status: invalid rejected", err(as(SP, `SELECT * FROM public.partner_inbox_update_status('${WS}','${CV}','ARCHIVED');`), "Invalid status"));
    const res = as(SP, `SELECT status||'|'||(resolved_at IS NOT NULL) FROM public.partner_inbox_update_status('${WS}','${CV}','RESOLVED');`);
    check("DB-24 status resolve sets resolved_at", res.out === "RESOLVED|true", res.out || res.err);
    check("DB-25 resolved conversation blocks reply", err(as(SP, `SELECT * FROM public.partner_inbox_create_reply('${WS}','${CV}','late','${R2}');`), "resolved"));
    const reo = as(SP, `SELECT status||'|'||(resolved_at IS NULL) FROM public.partner_inbox_update_status('${WS}','${CV}','OPEN');`);
    check("DB-26 reopen clears resolved_at", reo.out === "OPEN|true", reo.out || reo.err);

    psql(`INSERT INTO public.workspace_commercial_assignments (workspace_id, plan_id, status, enforcement_mode) VALUES ('${WS}','${FREE}','suspended','enforce');`);
    check("DB-27 client plan controls partner reply (suspended assignment denies)", err(as(SP, `SELECT * FROM public.partner_inbox_create_reply('${WS}','${CV}','plan test','${R2}');`), "COMMERCIAL_ACCESS_DENIED: ASSIGNMENT_SUSPENDED"));
    psql(`DELETE FROM public.workspace_commercial_assignments; UPDATE public.commercial_plan_entitlements SET enabled=false;`);
    check("DB-28 feature not in client plan denies partner reply", err(as(SP, `SELECT * FROM public.partner_inbox_create_reply('${WS}','${CV}','plan test','${R2}');`), "FEATURE_NOT_INCLUDED"));
    psql(`UPDATE public.commercial_plan_entitlements SET enabled=true;`);
    const svc = psql(`BEGIN; SET LOCAL ROLE service_role; SET LOCAL request.jwt.claims = '${JSON.stringify({ sub: SP })}'; SELECT public.partner_evaluate_commercial_access('${WS}','x_missions')::text || public.partner_evaluate_commercial_access('${WS}','project_inbox')::text; COMMIT;`);
    check("DB-29 adapter: other feature keys rejected; project_inbox follows client plan", svc.ok && svc.out.includes('"reason": "INVALID_CONTEXT"') && svc.out.includes('"reason": "FEATURE_INCLUDED"'), svc.out || svc.err);
    const svc2 = psql(`BEGIN; SET LOCAL ROLE service_role; SET LOCAL request.jwt.claims = '${JSON.stringify({ sub: SP2 })}'; SELECT public.partner_evaluate_commercial_access('${WS}','project_inbox')::text; COMMIT;`);
    check("DB-30 adapter: no scope -> deny without plan internals", svc2.ok && svc2.out.includes("NOT_PARTNER_SCOPE") && !svc2.out.includes("plan_code"), svc2.out || svc2.err);
    psql(`INSERT INTO public.platform_user_roles VALUES ('${SP2}','owner');`);
    const svc3 = psql(`BEGIN; SET LOCAL ROLE service_role; SET LOCAL request.jwt.claims = '${JSON.stringify({ sub: SP2 })}'; SELECT public.partner_evaluate_commercial_access('${WS}','project_inbox')::text; COMMIT;`);
    check("DB-31 adapter: no unrestricted bypass without partner scope", svc3.out.includes("NOT_PARTNER_SCOPE"), svc3.out);

    psql(`UPDATE public.partners SET status='suspended' WHERE user_id='${SP}';`);
    check("DB-32 partner suspension removes inbox access immediately", err(as(SP, `SELECT * FROM public.partner_inbox_summary('${WS}');`), "Not authorized"));
    psql(`UPDATE public.partners SET status='approved' WHERE user_id='${SP}';`);
    const before = psql(`SELECT concat((SELECT count(*) FROM public.project_conversation_messages), '|', (SELECT count(*) FROM public.project_inbox_deliveries), '|', (SELECT count(*) FROM public.project_conversations));`).out;
    as(OWNER, `SELECT public.owner_revoke_service_partner('${accessId}');`);
    check("DB-33 revoke is immediate on all 7", all(SP));
    check("DB-34 revoke keeps inbox history", psql(`SELECT concat((SELECT count(*) FROM public.project_conversation_messages), '|', (SELECT count(*) FROM public.project_inbox_deliveries), '|', (SELECT count(*) FROM public.project_conversations));`).out === before);
    check("DB-35 partner never became workspace member/operator", psql(`SELECT count(*) FROM public.workspace_members WHERE user_id IN ('${SP}','${SP2}');`).out === "0" && as(SP, `SELECT public.is_workspace_member('${WS}','${SP}')::text || public.is_workspace_operator('${WS}','${SP}')::text;`).out === "falsefalse");
    check("DB-36 partner RPC ACLs: no PUBLIC/anon", psql(`SELECT count(*) FROM pg_proc WHERE proname LIKE 'partner_inbox_%' AND (array_to_string(proacl::text[], ',') ~ '(^|,)=X' OR array_to_string(proacl::text[], ',') LIKE '%anon=%');`).out === "0");
    check("DB-37 partner RPCs pin empty search_path", psql(`SELECT count(*) FROM pg_proc WHERE proname LIKE 'partner_inbox_%' AND prosecdef AND proconfig = ARRAY['search_path=""'];`).out === "7");
  } catch (e) {
    check("DB-X harness", false, String(e).slice(0, 300));
  } finally {
    try { sh(`${asPg}pg_ctl -D ${dir}/data -m immediate stop >/dev/null`); } catch { /* ignore */ }
    rmSync(dir, { recursive: true, force: true });
  }
}

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
