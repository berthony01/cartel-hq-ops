/**
 * Project Identity Gate B regression (repo-only, zero network, zero database).
 * Community / Telegram / X project-tool enforcement.
 */
import { createHash } from "node:crypto";
import { readdirSync, readFileSync } from "node:fs";

let passed = 0;
const failures: string[] = [];
function check(name: string, ok: boolean, detail = ""): void {
  if (ok) passed += 1;
  else failures.push(`${name}${detail ? ` — ${detail}` : ""}`);
}
const read = (p: string) => readFileSync(p, "utf8");
const sha = (p: string) => createHash("sha256").update(readFileSync(p)).digest("hex");
const EF = "backend-source/edge-functions";

/** Source of `if (action === "<name>")` block up to the next top-level action branch. */
function actionBlock(src: string, name: string): string {
  const start = src.indexOf(`if (action === "${name}")`);
  if (start < 0) return "";
  const rest = src.slice(start + 10);
  const next = rest.search(/\n {4}if \(action === "/);
  return next < 0 ? rest : rest.slice(0, next);
}

// 1 — migrations.
const migrations = readdirSync("supabase/migrations").filter((f) => f.endsWith(".sql")).sort();
check("1.1 migration count exactly 100", migrations.length === 100, String(migrations.length));
const POST_GATE = [
  "20260922070921_40548af2-4afe-4876-bcaa-f22868f5942d.sql",
  "20260922141917_c47c2384-73c4-4bbf-8cc2-495112d64990.sql",
  "20260922142803_fedec44c-654f-4e1a-a117-30d027601e03.sql",
  "20260922161918_ef6e322a-d993-4970-9d48-3b4f93afa222.sql",
  "20260923170038_eaa2a24d-9c13-49c9-9aa3-6a5a8e18c300.sql",
  "20260924005521_b9fca846-4db3-4e8f-bf91-bdb4bd863228.sql",
  "20260924021801_e48c0c41-9053-4f77-a267-04fbba8d206d.sql",  "20260927013341_1f8494c2-8155-4e9d-832a-4e387a8f56b4.sql",
  "20260927141715_pcart_l3_rehearsal_and_mainnet_isolation.sql",
  "20260927170206_commercial_c1_pro_provider_safety_ceilings.sql",
  "20260927171231_commercial_c2_self_service_workspace.sql",
  "20260927173127_commercial_c3a_usage_free_record_fix.sql",
  "20260928110628_b2fff4d6-4c76-4505-8980-6e527123a82b.sql",
  "20260928170228_partner_program_phase_1a_foundation.sql",
  "20260928170613_partner_program_phase_1a_rls_fk_hardening.sql",
  "20260928170917_partner_program_phase_1a_new_workspace_attribution.sql",
];
const postGate = migrations.filter((f) => f >= "20260922");
check("1.2 exact authorized post-gate migration set", JSON.stringify(postGate) === JSON.stringify(POST_GATE), postGate.join(","));

// 2 — shared authority + parity.
check("2.1 shared helper mirror byte-identical",
  sha(`${EF}/_shared/project-identity.ts`) === sha("supabase/functions/_shared/project-identity.ts"));
check("2.2 telegram-webhook deployable byte-identical",
  sha(`${EF}/telegram-webhook/index.ts`) === sha("supabase/functions/telegram-webhook/index.ts"));
check("2.3 parity suite lists _shared/project-identity.ts",
  read("scripts/social-mission-deploy-parity-regression.ts").includes('"_shared/project-identity.ts"'));

const GATE_FILES = [
  `${EF}/telegram-group/index.ts`, `${EF}/telegram-stickers/index.ts`,
  `${EF}/sticker-motion-telegram/index.ts`, `${EF}/sticker-drop-config/index.ts`,
  `${EF}/telegram-webhook/index.ts`,
  "src/lib/social-read.functions.ts", "src/lib/social-mission-metrics.functions.ts",
];
for (const f of GATE_FILES) {
  const s = read(f);
  check(`2.4 no email literal: ${f}`, !/[A-Za-z0-9._%+-]+@(gmail|[a-z0-9-]+\.(com|xyz|io))/i.test(s));
  check(`2.5 no second profile predicate: ${f}`, !/from\("project_profiles"\)[\s\S]{0,200}public_slug/.test(s) || f.includes("telegram-group"));
  check(`2.6 no plan/quota/stripe logic added: ${f}`, !/stripe|subscription_tier|quota_limit/i.test(s));
}
for (const f of GATE_FILES.slice(0, 5)) {
  check(`2.7 imports shared helper: ${f}`, read(f).includes('import { requireProjectToolAccess } from "../_shared/project-identity.ts";'));
}

// 3 — telegram-group.
const tg = read(`${EF}/telegram-group/index.ts`);
const tgSet = tg.match(/PROJECT_IDENTITY_GATED_ACTIONS = new Set\((\[[^\]]*\])\)/);
const tgGated = tgSet ? (JSON.parse(tgSet[1]!) as string[]).sort() : [];
check("3.1 telegram-group exact gated set", JSON.stringify(tgGated) === JSON.stringify(
  ["assign_pack", "distribute_pack", "send_group_test", "save_welcome_settings", "send_welcome_test", "send_group_announcement", "send_official_contract_broadcast", "send_official_contract_correction_broadcast"].sort()));
for (const u of ["status", "distribution_status", "welcome_settings", "broadcast_launch_options"]) {
  check(`3.2 telegram-group ungated: ${u}`, !tgGated.includes(u));
}
const tgMember = tg.indexOf('from("workspace_members")');
const tgGate = tg.indexOf("requireProjectToolAccess(admin, user.id, workspaceId)");
const tgFirstAction = tg.indexOf('if (action === "status")');
check("3.3 telegram-group gate after membership, before any action", tgMember > 0 && tgGate > tgMember && tgGate < tgFirstAction);

// 4 — telegram-stickers.
const ts = read(`${EF}/telegram-stickers/index.ts`);
const tsSet = ts.match(/PROJECT_IDENTITY_GATED_ACTIONS = new Set\((\[[^\]]*\])\)/);
const tsGated = tsSet ? (JSON.parse(tsSet[1]!) as string[]).sort() : [];
check("4.1 telegram-stickers exact gated set", JSON.stringify(tsGated) === JSON.stringify(["publish", "refresh", "send_test", "replace_version", "release_motion"].sort()));
check("4.2 telegram-stickers config ungated", !tsGated.includes("config"));
const tsGate = ts.indexOf("requireProjectToolAccess(admin, user.id, gateWorkspaceId)");
check("4.3 stickers gate after member helper + membership, before actions",
  tsGate > ts.indexOf("const member = async") && ts.slice(ts.indexOf("PROJECT_IDENTITY_GATED_ACTIONS.has"), tsGate).includes("await member(gateWorkspaceId)") && tsGate < ts.indexOf('if (action === "config")'));

// 5 — sticker-motion-telegram.
const mt = read(`${EF}/sticker-motion-telegram/index.ts`);
// Commercial Foundation B (G2): exactly two gate calls — start + retry_normalization.
check("5.1 motion: exactly two gate calls (start + retry_normalization)", mt.split("requireProjectToolAccess(").length - 1 === 2);
const mtStart = actionBlock(mt, "start");
check("5.2 motion start gated after isMember", mtStart.indexOf("requireProjectToolAccess(") > mtStart.indexOf("isMember(workspaceId)") && mtStart.indexOf("isMember(workspaceId)") > 0);
const mtRetry = actionBlock(mt, "retry_normalization");
check("5.2b motion retry_normalization gated after isMember, before source read",
  mtRetry.indexOf("isMember(workspaceId)") > 0 &&
  mtRetry.indexOf("requireProjectToolAccess(") > mtRetry.indexOf("isMember(workspaceId)") &&
  mtRetry.indexOf("requireProjectToolAccess(") < mtRetry.indexOf('from("ai_jobs")'));
check("5.3 motion sync ungated", !actionBlock(mt, "sync").includes("requireProjectToolAccess"));
check("5.4 motion config ungated", !mt.slice(mt.indexOf('if (action === "config")'), mt.indexOf('if (action === "start")')).includes("requireProjectToolAccess"));

// 6 — sticker-drop-config.
const dc = read(`${EF}/sticker-drop-config/index.ts`);
check("6.1 drop: exactly one gate call", dc.split("requireProjectToolAccess(").length - 1 === 1);
check("6.2 drop gate condition = save_schedule or ENABLE only",
  dc.includes('if (action === "save_schedule" || (action === "set_schedule_enabled" && body.enabled === true))'));
const dcGate = dc.indexOf("requireProjectToolAccess(");
check("6.3 drop gate after status + manager check, before save", dcGate > dc.indexOf("MANAGER_REQUIRED") && dcGate < dc.indexOf('if (action === "save_schedule") {'));
for (const u of ["delete_schedule", "set_kill_switch"]) check(`6.4 drop ungated: ${u}`, !actionBlock(dc, u).includes("requireProjectToolAccess"));

// 7 — telegram-webhook.
const wh = read(`${EF}/telegram-webhook/index.ts`);
// Re-pinned for Commercial Foundation B: exactly TWO call sites — mission START
// preflight and Project Inbox bot team reply preflight — each before its own
// commercial guard and mutation RPC; capture paths stay ungated.
{
  const sites = wh.split("requireProjectToolAccess(").length - 1;
  const mGate = wh.indexOf("requireProjectToolAccess(admin, actorUserId, connection.workspace_id)");
  const mCom = wh.indexOf('requireCommercialAccess(admin, actorUserId, connection.workspace_id, "x_missions")');
  const mRpc = wh.indexOf('admin.rpc("create_social_mission_from_telegram_link"');
  const iGate = wh.indexOf("requireProjectToolAccess(admin, inboxActorUserId, inboxWorkspaceId)");
  const iCom = wh.indexOf('requireCommercialAccess(admin, inboxActorUserId, inboxWorkspaceId, "project_inbox")');
  const iRpc = wh.indexOf('admin.rpc("bot_inbox_create_team_reply"');
  const launchCap = wh.indexOf('admin.rpc("capture_project_inbox_launch_reply"');
  const memberCap = wh.indexOf('"capture_project_inbox_member_message"');
  check("7.1 webhook: exactly two gate call sites (mission start + inbox team reply)", sites === 2 && mGate > 0 && iGate > 0);
  check("7.1a mission gate < x_missions guard < create RPC", mGate < mCom && mCom < mRpc);
  check("7.1b inbox gate < project_inbox guard < team-reply RPC, gate close to its branch", iGate < iCom && iCom < iRpc && iRpc - iGate < 1500);
  check("7.1c launch/member capture after both gates and not preceded by a gate in their branch",
    launchCap > iRpc && memberCap > launchCap && !wh.slice(iRpc, memberCap + 200).includes("requireProjectToolAccess("));
}
const whGate = wh.indexOf("requireProjectToolAccess(admin, actorUserId, connection.workspace_id)");
const whRpc = wh.indexOf('admin.rpc("create_social_mission_from_telegram_link"');
check("7.2 webhook gate before mission-create RPC", whGate > 0 && whRpc > whGate);
check("7.3 single create RPC call site", wh.split('rpc("create_social_mission_from_telegram_link"').length - 1 === 1);
const pre = wh.slice(wh.indexOf("Project Identity Gate B — mission START preflight"), whGate);
check("7.4 actor mapping telegram_connections telegram_user_id -> user_id",
  pre.includes('.from("telegram_connections")') && pre.includes('.select("user_id")') && pre.includes('.eq("telegram_user_id", telegramUserId)'));
check("7.5 ambiguous/absent mapping fails closed", pre.includes("actorRows.length === 1") && pre.includes("if (!actorUserId)") && /if \(!actorUserId\) \{[\s\S]*?return;/.test(pre));
const denial = wh.slice(whGate, whRpc);
check("7.6 denial returns before RPC", /if \(!identityGate\.allowed\) \{[\s\S]*?return;/.test(denial));
check("7.7 gate is after the mission-close branch", whGate > wh.indexOf("This Social Mission is closed."));
check("7.8 close RPC ungated", !wh.slice(wh.indexOf("close_social_mission_from_telegram") - 2000, wh.indexOf("close_social_mission_from_telegram")).includes("requireProjectToolAccess"));
check("7.9 no global gate in request handler (gate not near Deno.serve)", whGate > wh.indexOf("Deno.serve") + 5000 || wh.indexOf("Deno.serve") < 0);

// 8 — server functions.
const sr = read("src/lib/social-read.functions.ts");
const srOp = sr.indexOf('rpc("is_workspace_operator"'), srId = sr.indexOf('"can_use_project_tools"'), srProv = sr.indexOf('import("./social-read-router.server")');
check("8.1 social-read gate after operator, before provider", srOp > 0 && srId > srOp && srProv > srId);
check("8.2 social-read fails closed", sr.includes("if (identityError || canUseTools !== true)"));
const sm = read("src/lib/social-mission-metrics.functions.ts");
const smOp = sm.indexOf('"is_workspace_operator"'), smId = sm.indexOf('"can_use_project_tools"'), smProv = sm.indexOf("socialReadRouter.fetchPostMetrics");
check("8.3 metrics gate after operator, before paid read", smOp > 0 && smId > smOp && smProv > smId);
check("8.4 metrics fails closed", sm.includes("if (identityError || canUseTools !== true)"));
check("8.5 metrics request shape unchanged", sm.includes("socialReadRouter.fetchPostMetrics({ url: METRIC_CAPTURE_CANONICAL_URL })"));

// 9 — background / transport untouched.
for (const f of ["sticker-drops", "social-mission-runner", "social-mission-telegram", "telegram-message-cleanup", "launch-notifications", "project-inbox-delivery"]) {
  let s = "";
  try { s = read(`${EF}/${f}/index.ts`); } catch { s = ""; }
  check(`9.1 no identity gate in ${f}`, !s.includes("requireProjectToolAccess") && !s.includes("can_use_project_tools"));
}

// 10 — UI.
const shell = read("src/components/cartel/AppShell.tsx");
const fn = shell.slice(shell.indexOf("function isProjectIdentityGatedPath"), shell.indexOf("export function AppShell"));
for (const p of ['"/sticker-lab"', '"/sticker-lab/"', '"/telegram"', '"/distribution"']) check(`10.1 AppShell gates ${p}`, fn.includes(p));
for (const p of ["/launch-control", "/watchlist", "/project-profile", "/brand-kit", "/assets", "/settings", "/admin", "/analytics", "/operations", "/operatives", "/cartel-shield", "/chain-launcher", "/mainnet-canary", "/auth"]) {
  check(`10.2 AppShell does not gate ${p}`, !fn.includes(`"${p}`));
}
check("10.3 exactly four path literals", (fn.match(/"\/[^"]*"/g) ?? []).length === 4);

// 11 — PCART protection.
const pcartFiles = readdirSync("src/lib").filter((f) => f.startsWith("chain-")).map((f) => read(`src/lib/${f}`)).join("\n");
check("11.1 MAINNET_LIQUIDITY_TX_ENABLED not true", !/MAINNET_LIQUIDITY_TX_ENABLED\s*=\s*true/.test(pcartFiles));

// 12 — self hygiene.
const self = read("scripts/project-identity-gate-b-regression.ts");
check("12.1 no fetch calls", !/\bfetch\s*\(/.test(self));
check("12.2 no supabase client", !/createClient\s*\(/.test(self));

if (failures.length) {
  console.error(`FAIL — ${failures.length} failed, ${passed} passed`);
  for (const f of failures) console.error(`  - ${f}`);
  process.exit(1);
}
console.log(`PASS — ${passed}/${passed} Gate B checks passed`);
