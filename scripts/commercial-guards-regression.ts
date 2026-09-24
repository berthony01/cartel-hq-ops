/**
 * COMMERCIAL FOUNDATION B — repo-only regression for $49 entitlement + usage
 * guard wiring. Zero network, zero database.
 */
import { readdirSync, readFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { execSync } from "node:child_process";

const MIG = "supabase/migrations";
const EF = "backend-source/edge-functions";
const START_GATE = "78e3f591b6a4ddb62b63d79063b46f9ce68f5831";
const POST_GATE = [
  "20260922070921_40548af2-4afe-4876-bcaa-f22868f5942d.sql",
  "20260922141917_c47c2384-73c4-4bbf-8cc2-495112d64990.sql",
  "20260922142803_fedec44c-654f-4e1a-a117-30d027601e03.sql",
  "20260922161918_ef6e322a-d993-4970-9d48-3b4f93afa222.sql",
  "20260923170038_eaa2a24d-9c13-49c9-9aa3-6a5a8e18c300.sql",
  "20260924005521_b9fca846-4db3-4e8f-bf91-bdb4bd863228.sql",
];
const B_MIGRATION = POST_GATE[5]!;

let passed = 0;
let failed = 0;
function check(id: string, ok: boolean, detail = "") {
  if (ok) passed++;
  else {
    failed++;
    console.error(`FAIL ${id}${detail ? ` — ${detail}` : ""}`);
  }
}
const read = (p: string) => readFileSync(p, "utf8");
const sha = (s: string) => createHash("sha256").update(s).digest("hex");
const atGate = (p: string) => {
  try {
    return execSync(`git show ${START_GATE}:${p}`, { encoding: "utf8", maxBuffer: 64 * 1024 * 1024 });
  } catch {
    return null;
  }
};
function actionBlock(src: string, name: string): string {
  const start = src.indexOf(`if (action === "${name}")`);
  if (start < 0) return "";
  const rest = src.slice(start + 10);
  const next = rest.search(/\n {4}if \(action === "/);
  return next < 0 ? rest : rest.slice(0, next);
}
const before = (src: string, a: string, b: string) => {
  const i = src.indexOf(a);
  const j = src.indexOf(b);
  return i >= 0 && j >= 0 && i < j;
};

// 1 — migrations.
const migrations = readdirSync(MIG).filter((f) => f.endsWith(".sql")).sort();
check("1.1 migration count exactly 90", migrations.length === 90, String(migrations.length));
const postGate = migrations.filter((f) => f >= "20260922");
check("1.2 exact six authorized post-gate migrations", JSON.stringify(postGate) === JSON.stringify(POST_GATE), postGate.join(","));

const msql = read(`${MIG}/${B_MIGRATION}`).replace(/^\s*--.*$/gm, "");
const created = [...msql.matchAll(/CREATE OR REPLACE FUNCTION public\.(\w+)\(/g)].map((m) => m[1]).sort();
check("1.3 migration replaces exactly the four authorized functions", JSON.stringify(created) === JSON.stringify(
  ["create_project_inbox_team_reply", "notify_launch_watchers_official_contract", "set_project_inbox_replies_enabled", "transition_launch_status"]));
check("1.4 no table/schema/policy/grant/data DDL",
  !/\b(CREATE|ALTER|DROP)\s+(TABLE|POLICY|SCHEMA|TYPE|INDEX|TRIGGER|VIEW)\b/i.test(msql) &&
  !/\b(GRANT|REVOKE|TRUNCATE)\b/i.test(msql) &&
  !/\bSECURITY INVOKER\b/i.test(msql));
check("1.5 exactly four SECURITY DEFINER + search_path public", (msql.match(/SECURITY DEFINER/g) ?? []).length === 4 && (msql.match(/SET search_path TO 'public'/g) ?? []).length === 4);
check("1.6 no usage_ledger/email/stripe in migration", !/usage_ledger|[a-z0-9._-]+@[a-z0-9-]+\.[a-z]|stripe/i.test(msql));

function fnBody(name: string): string {
  const s = msql.indexOf(`FUNCTION public.${name}(`);
  const e = msql.indexOf("$function$;", s);
  return msql.slice(s, e);
}
const tr = fnBody("transition_launch_status");
check("2.1 transition guard after operator check, before update",
  before(tr, "is_workspace_operator", "evaluate_commercial_access") && before(tr, "evaluate_commercial_access", "update public.launches"));
check("2.2 transition guards WATCHLIST_OPEN only", /if normalized_target = 'WATCHLIST_OPEN' then\s+v_commercial := public\.evaluate_commercial_access\(launch_row\.workspace_id, 'launch_watch', auth\.uid\(\)\)/.test(tr)
  && (tr.match(/evaluate_commercial_access/g) ?? []).length === 1);
const nt = fnBody("notify_launch_watchers_official_contract");
check("2.3 notify guard after owner check, before launch_events insert",
  before(nt, "is_workspace_owner", "evaluate_commercial_access") && before(nt, "evaluate_commercial_access", "insert into public.launch_events") && nt.includes("'official_broadcasts'"));
const si = fnBody("set_project_inbox_replies_enabled");
check("2.4 inbox enable guard only when _enabled=true, after operator, before insert",
  /IF COALESCE\(_enabled, false\) = true THEN\s+v_commercial := public\.evaluate_commercial_access\(_workspace_id, 'project_inbox', auth\.uid\(\)\)/.test(si) &&
  before(si, "is_workspace_operator", "evaluate_commercial_access") && before(si, "evaluate_commercial_access", "INSERT INTO public.project_inbox_settings"));
check("2.5 inbox disable path ungated (single guarded branch)", (si.match(/evaluate_commercial_access/g) ?? []).length === 1);
const cr = fnBody("create_project_inbox_team_reply");
check("2.6 team reply guard after operator, before any insert",
  before(cr, "is_workspace_operator", "evaluate_commercial_access") && before(cr, "evaluate_commercial_access", "INSERT INTO public.project_conversation_messages") && cr.includes("'project_inbox'"));
for (const [n, b] of [["transition", tr], ["notify", nt], ["inbox_enable", si], ["team_reply", cr]] as const) {
  check(`2.7 ${n} aborts with stable COMMERCIAL_ACCESS_DENIED + reason`, /COMMERCIAL_ACCESS_DENIED: %', coalesce\(v_commercial->>'reason'/i.test(b));
}

// 3 — shared helper.
const helper = read(`${EF}/_shared/commercial-access.ts`);
const helperCode = helper.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
const rpcs = [...helperCode.matchAll(/\.rpc\("(\w+)"/g)].map((m) => m[1]);
check("3.1 helper calls only evaluate_commercial_access", rpcs.length === 1 && rpcs[0] === "evaluate_commercial_access");
check("3.2 helper has no stripe/email/usage_ledger/pricing", !/stripe|usage_ledger|@[a-z]|price|amount_cents|\$49/i.test(helperCode));
check("3.3 PLAN_LIMIT_REACHED -> 429", /PLAN_LIMIT_REACHED"\) return deny\(429, "PLAN_LIMIT_REACHED", "Monthly plan limit reached\."\)/.test(helperCode));
check("3.4 FEATURE_NOT_INCLUDED -> 403", helperCode.includes('deny(403, "FEATURE_NOT_INCLUDED", "This feature is not included in the current plan.")'));
check("3.5 ASSIGNMENT_* -> PLAN_ACCESS_INACTIVE", helperCode.includes('r.startsWith("ASSIGNMENT_")) return deny(403, "PLAN_ACCESS_INACTIVE", "Plan access is not active.")'));
check("3.6 other -> COMMERCIAL_ACCESS_DENIED", helperCode.includes('deny(403, "COMMERCIAL_ACCESS_DENIED", "This action is not available for this workspace.")'));
check("3.7 RPC failure -> 503 UNAVAILABLE", helperCode.includes('deny(503, "COMMERCIAL_ACCESS_UNAVAILABLE", "Plan access could not be verified. Try again.")'));
check("3.8 allowed only on explicit true", helperCode.includes("data.allowed === true") && helperCode.includes('typeof data.allowed !== "boolean"'));

// 4 — parity.
check("4.1 helper mirrors byte-identical", sha(helper) === sha(read("supabase/functions/_shared/commercial-access.ts")));
check("4.2 telegram-webhook mirrors byte-identical", sha(read(`${EF}/telegram-webhook/index.ts`)) === sha(read("supabase/functions/telegram-webhook/index.ts")));
check("4.3 parity suite includes commercial helper", read("scripts/social-mission-deploy-parity-regression.ts").includes('"_shared/commercial-access.ts"'));

// 5 — edge mapping.
const ai = read(`${EF}/sticker-ai/index.ts`);
const aiStart = actionBlock(ai, "start\" || action === \"start_candidate\" || action === \"start_variation");
check("5.1 sticker-ai start quota after identity + variation idempotency, before job insert",
  before(aiStart, "identityDenial(workspaceId)", 'commercialDenial(workspaceId, "static_ai_generations")') &&
  before(aiStart, "existingVersion", 'commercialDenial(workspaceId, "static_ai_generations")') &&
  before(aiStart, 'commercialDenial(workspaceId, "static_ai_generations")', 'from("ai_jobs").insert'));
const aiRetry = actionBlock(ai, "retry_review_background");
check("5.2 retry_review_background static_ai_tools before provider",
  before(aiRetry, "identityDenial(workspaceId)", '"static_ai_tools"') && before(aiRetry, '"static_ai_tools"', "kieRequest("));
check("5.3 sticker-ai sync ungated", !actionBlock(ai, "sync").includes("commercialDenial"));
check("5.4 sticker-ai exactly two commercial call sites", (ai.match(/commercialDenial\(workspaceId/g) ?? []).length === 2);

const mo = read(`${EF}/sticker-motion-ai/index.ts`);
const moStart = actionBlock(mo, "start");
check("5.5 motion start quota after identity + reuse, before job insert",
  before(moStart, "identityDenial(workspaceId)", '"motion_ai_generations"') && before(moStart, "readActiveJob()", '"motion_ai_generations"') && before(moStart, '"motion_ai_generations"', 'from("ai_jobs").insert'));
check("5.6 motion sync/set_current ungated", !actionBlock(mo, "sync").includes("requireCommercialAccess") && !actionBlock(mo, "set_current").includes("requireCommercialAccess"));

const co = read(`${EF}/sticker-concepts/index.ts`);
check("5.7 concepts concept_generation after identity, before provider body",
  before(co, "requireProjectToolAccess(admin, user.id, workspaceId)", '"concept_generation"') && before(co, '"concept_generation"', "const existing = Array.isArray"));

const mt = read(`${EF}/sticker-motion-telegram/index.ts`);
const mtStart = actionBlock(mt, "start");
check("5.8 motion-telegram start telegram_motion_prep after identity", before(mtStart, "requireProjectToolAccess(", '"telegram_motion_prep"'));
const mtRetry = actionBlock(mt, "retry_normalization");
check("5.9 G2 retry_normalization identity + commercial before source/provider/job",
  before(mtRetry, "isMember(workspaceId)", "requireProjectToolAccess(") &&
  before(mtRetry, "requireProjectToolAccess(", '"telegram_motion_prep"') &&
  before(mtRetry, '"telegram_motion_prep"', 'from("ai_jobs")'));
check("5.10 motion-telegram sync/config ungated", !actionBlock(mt, "sync").includes("requireCommercialAccess") &&
  !mt.slice(mt.indexOf('if (action === "config")'), mt.indexOf('if (action === "start")')).includes("requireCommercialAccess"));

const dc = read(`${EF}/sticker-drop-config/index.ts`);
const dcGate = dc.slice(dc.indexOf('if (action === "save_schedule" || (action === "set_schedule_enabled" && body.enabled === true))'), dc.indexOf('if (action === "save_schedule") {'));
check("5.11 drops sticker_drops only save/enable, after identity", before(dcGate, "requireProjectToolAccess(", '"sticker_drops"') && (dc.match(/requireCommercialAccess\(/g) ?? []).length === 1);
for (const a of ["delete_schedule", "set_kill_switch", "status"]) check(`5.12 drops ${a} ungated`, !actionBlock(dc, a).includes("requireCommercialAccess"));

const tg = read(`${EF}/telegram-group/index.ts`);
const tgSet = tg.match(/PROJECT_IDENTITY_GATED_ACTIONS = new Set\((\[[^\]]*\])\)/);
const tgGated = tgSet ? (JSON.parse(tgSet[1]!) as string[]) : [];
check("5.13 G1 correction broadcast identity-gated", tgGated.includes("send_official_contract_correction_broadcast"));
const mapBlock = tg.slice(tg.indexOf("COMMERCIAL_ACTION_FEATURES"), tg.indexOf("};", tg.indexOf("COMMERCIAL_ACTION_FEATURES")));
const expected: Record<string, string> = {
  assign_pack: "sticker_auto_posting", distribute_pack: "sticker_auto_posting",
  send_group_test: "community_tools", save_welcome_settings: "community_tools", send_welcome_test: "community_tools",
  send_group_announcement: "official_broadcasts", send_official_contract_broadcast: "official_broadcasts",
  send_official_contract_correction_broadcast: "official_broadcasts",
};
const got = Object.fromEntries([...mapBlock.matchAll(/(\w+): "(\w+)"/g)].map((m) => [m[1], m[2]]));
check("5.14 telegram-group exact commercial map", JSON.stringify(Object.keys(got).sort().map((k) => [k, got[k]])) === JSON.stringify(Object.keys(expected).sort().map((k) => [k, expected[k]])));
check("5.15 telegram-group map keys == identity set", JSON.stringify(Object.keys(got).sort()) === JSON.stringify([...tgGated].sort()));
check("5.16 telegram-group commercial after identity, before first action",
  before(tg, "requireProjectToolAccess(admin, user.id, workspaceId)", "requireCommercialAccess(admin, user.id, workspaceId, featureKey)") &&
  before(tg, "requireCommercialAccess(admin, user.id, workspaceId, featureKey)", 'if (action === "status")'));
for (const u of ["status", "distribution_status", "welcome_settings", "broadcast_launch_options"]) check(`5.17 telegram-group ${u} ungated`, !(u in got));

const ts = read(`${EF}/telegram-stickers/index.ts`);
check("5.18 telegram-stickers sticker_auto_posting after identity, before config",
  before(ts, "requireProjectToolAccess(admin, user.id, gateWorkspaceId)", '"sticker_auto_posting"') && before(ts, '"sticker_auto_posting"', 'if (action === "config")'));

// 6 — webhook.
const wh = read(`${EF}/telegram-webhook/index.ts`);
check("6.1 mission x_missions after identity, before onStartAccepted + create RPC",
  before(wh, "requireProjectToolAccess(admin, actorUserId, connection.workspace_id)", 'requireCommercialAccess(admin, actorUserId, connection.workspace_id, "x_missions")') &&
  before(wh, '"x_missions"', "await args.onStartAccepted?.()") &&
  before(wh, '"x_missions"', 'admin.rpc("create_social_mission_from_telegram_link"'));
const teamIdx = wh.indexOf('admin.rpc("bot_inbox_create_team_reply"');
const teamPre = wh.slice(wh.indexOf('bot_inbox_active_reply_session", {'), teamIdx);
check("6.2 bot team reply: actor mapping + identity + project_inbox before RPC",
  teamPre.includes('.from("telegram_connections")') && teamPre.includes('.eq("telegram_user_id", Number(from.id))') &&
  before(teamPre, "requireProjectToolAccess(admin, inboxActorUserId, inboxWorkspaceId)", '"project_inbox"'));
check("6.3 exactly two commercial call sites in webhook (mission + team reply)", (wh.match(/requireCommercialAccess\(/g) ?? []).length === 2);
check("6.4 inbound capture/launch reply RPCs not preceded by commercial guard in the same branch", !/requireCommercialAccess[\s\S]{0,400}bot_inbox_capture|requireCommercialAccess[\s\S]{0,400}capture_project_inbox/.test(wh));

// 7 — X reads.
const sr = read("src/lib/social-read.functions.ts");
check("7.1 social-read x_reads after identity, before router import",
  before(sr, '"can_use_project_tools"', '_feature_key: "x_reads"') && before(sr, '_feature_key: "x_reads"', 'import("./social-read-router.server")'));
const sm = read("src/lib/social-mission-metrics.functions.ts");
check("7.2 metrics x_reads after identity, before router import",
  before(sm, '"can_use_project_tools"', '_feature_key: "x_reads"') && before(sm, '_feature_key: "x_reads"', 'import("./social-read-router.server")'));

// 8 — negative tripwires: untouched runners/transport/cleanup.
for (const p of [
  "social-mission-runner/index.ts", "social-mission-telegram/index.ts", "sticker-drops/index.ts",
  "telegram-message-cleanup/index.ts", "launch-notifications/index.ts", "project-inbox-delivery/index.ts",
]) {
  const cur = (() => { try { return read(`${EF}/${p}`); } catch { return null; } })();
  if (cur === null) continue;
  check(`8.1 untouched + ungated: ${p}`, cur === atGate(`${EF}/${p}`) && !cur.includes("commercial-access"));
}

// 9 — provider shapes / cost action types unchanged (usage-accounting untouched).
for (const p of [`${EF}/_shared/usage-accounting.ts`, "supabase/functions/_shared/usage-accounting.ts", "src/lib/social-read-router.server.ts", "src/lib/social-read-x.server.ts"]) {
  check(`9.1 unchanged: ${p}`, read(p) === atGate(p));
}

// 10 — PCART / chain / liquidity isolation.
const changed = execSync(`git diff --name-only ${START_GATE}`, { encoding: "utf8" }).split("\n").filter(Boolean);
const untracked = execSync("git ls-files --others --exclude-standard", { encoding: "utf8" }).split("\n").filter(Boolean);
check("10.1 no PCART/chain/liquidity/launcher/wallet file changed",
  ![...changed, ...untracked].some((f) => /chain-|pcart|pepecartel|treasury|liquidity|wallet|launcher|contracts\//i.test(f) && !f.startsWith("scripts/")));
check("10.2 MAINNET_LIQUIDITY_TX_ENABLED remains false", /MAINNET_LIQUIDITY_TX_ENABLED\s*=\s*false/.test(read("src/lib/chain-mainnet-registry.ts")));

console.log(`commercial-guards: ${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
