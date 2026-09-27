/**
 * MINI-HQ-1C — Mini App lifecycle parity + Telegram menu simplification.
 * Static/source + pure-logic checks against production-used modules.
 */
import { readFileSync } from "node:fs";
import { classifyLifecycleResult } from "../src/lib/telegram-miniapp-client";

let pass = 0;
const fails: string[] = [];
function check(name: string, ok: boolean) {
  if (ok) pass++;
  else fails.push(name);
}
const read = (p: string) => readFileSync(p, "utf8");
const bridge = read("src/lib/telegram-miniapp-bridge.functions.ts");
const mission = read("src/routes/tg.mission.$missionId.tsx");
const home = read("src/routes/tg.index.tsx");
const inbox = read("src/components/telegram-miniapp/MiniAppInbox.tsx");
const hooks = ["supabase/functions/telegram-webhook/index.ts", "backend-source/edge-functions/telegram-webhook/index.ts"].map(read);

const fin = bridge.slice(bridge.indexOf("async function miniAppFinalize"), bridge.indexOf("export const miniAppEndMission"));
const edit = bridge.slice(bridge.indexOf("async function miniAppFinalCardEdit"), bridge.indexOf("async function miniAppSafeUnpin"));
const unpin = bridge.slice(bridge.indexOf("async function miniAppSafeUnpin"), bridge.indexOf("async function miniAppFinalize"));

// 1. signed authorization + server-derived bindings
check("1.1 request id validated before anything", /if \(!isRequestId\(data\?\.requestId\)\) return fail\("invalid_request_id"\);/.test(fin));
check("1.2 initData -> operator binding -> live admin gate", /const gate = await authorizeLifecycle\(data\?\.initData, data\?\.missionId\);/.test(fin));
check("1.3 validators accept only initData/missionId/requestId", (bridge.match(/inputValidator\(\(input: \{ initData: string; missionId: string; requestId: string \}\) => input\)/g) ?? []).length === 2);
check("1.4 chat id is server-derived", /_verified_chat_id: Number\(binding\.chatId\)/.test(fin));
check("1.5 no entitlement/billing gate added", !/entitlement|billing|has_platform_unrestricted_access/i.test(fin));
// 2. RPC reuse + idempotency
check("2.1 end reuses end_social_mission_from_control", /endNow: "end_social_mission_from_control"/.test(bridge));
check("2.2 cancel reuses cancel_social_mission_from_control", /cancel: "cancel_social_mission_from_control"/.test(bridge));
check("2.3 deterministic idempotency key per action+request", /miniAppIdempotencyKey\(telegramUserId, action, data!\.requestId\)/.test(fin));
check("2.4 no new SQL", !/CREATE (TABLE|FUNCTION|POLICY)/i.test(bridge));
// 3. final card edit semantics
check("3.1 uses existing edit_mission lane", /action: MINIAPP_FINAL_TRANSPORT_ACTION/.test(edit) && /MINIAPP_FINAL_TRANSPORT_ACTION = "edit_mission"/.test(bridge));
check("3.2 deterministic transport id", /miniAppRefreshRequestUuid\(\s*telegramUserId,\s*args\.action,\s*args\.requestId,\s*\)/.test(edit));
check("3.3 same-request retry reuses recorded revision (transport duplicate)", /const revision = alreadyBound \? currentRevision : currentRevision \+ 1;/.test(edit));
check("3.4 bridge performs zero X/provider reads", !/api\.x\.com|api\.twitter\.com|fetchMetrics|social-read/i.test(bridge));
check("3.5 transport outcome mapped truthfully", /if \(state === "EDITED"\) return payload\?\.\["duplicate"\] === true \? "replayed" : "edited";/.test(edit) && /return "ambiguous";\s*\} catch \{\s*return "ambiguous";/.test(edit));
check("3.6 replay also heals card + unpin", /if \(outcome !== "ok" && outcome !== "replayed"\) return \{ ok: true, outcome \};/.test(fin));
// 4. schedule-event ownership + unpin
check("4.1 finishes schedule event only when owned and only for end", /action === "end_now" && outcome === "ok" && row\["event_owned"\] === true && row\["schedule_event_id"\]/.test(fin));
check("4.2 safe unpin guarded by pinned_by_hq on exact chat", /pinned_by_hq/.test(unpin) && /\.eq\("telegram_chat_id", Number\(binding\.chatId\)\)/.test(unpin));

// 4b. MINI-HQ-1C follow-up: non-LIVE retry reachability + exact actor/target
const lcRes = bridge.slice(bridge.indexOf("async function resolveLifecycleCandidates"), bridge.indexOf("type LifecycleAuthority"));
const lcAuth = bridge.slice(bridge.indexOf("async function authorizeLifecycle"), bridge.indexOf("function hexDigest"));
const listMissions = bridge.slice(bridge.indexOf("async function resolveBinding"), bridge.indexOf("async function authorizeMission"));
const sqlSe15 = read("docs/sql/SE15_mission_control.sql");
const authSql = sqlSe15.slice(sqlSe15.indexOf("FUNCTION public.social_mission_control_authorize"), sqlSe15.indexOf("REVOKE ALL ON FUNCTION public.social_mission_control_authorize"));
check("4b.1 lifecycle resolver does not use the LIVE-only missions RPC", lcRes.length > 0 && !/MINIAPP_RPC\.missions/.test(lcRes) && !/LIVE/.test(lcRes.replace(/\/\*\*[\s\S]*?\*\//g, "")));
check("4b.2 lifecycle resolver scopes by operator workspaces of the validated user", /MINIAPP_RPC\.workspaces/.test(lcRes) && /\.in\("workspace_id", \[\.\.\.names\.keys\(\)\]\)/.test(lcRes));
check("4b.3 SQL authorize has no status filter (non-LIVE capable)", authSql.length > 0 && !/status\s*=\s*'LIVE'/.test(authSql));
check("4b.4 normal list-missions path still LIVE-only RPC", /MINIAPP_RPC\.missions/.test(listMissions) && /AND m\.status = 'LIVE'/.test(sqlSe15));
check("4b.5 lifecycle gate keeps fresh getChatMember check", /isCurrentChatAdmin\(token, candidate, auth\.user\.id\)/.test(lcAuth) && /if \(!chatId\) return fail\("not_group_admin"\);/.test(lcAuth));
check("4b.6 lifecycle gate calls authorize with server-derived chat", /admin\.rpc\(MINIAPP_RPC\.authorize/.test(lcAuth) && /_verified_chat_id: Number\(chatId\)/.test(lcAuth));
check("4b.7 authorize outcome/actor/target/workspace/status validated before RPC", /outcome"\] \?\? ""\) !== "ok"/.test(lcAuth) && /!isUuid\(actorUserId\)/.test(lcAuth) && /!isUuid\(targetId\)/.test(lcAuth) && /workspaceId !== candidates\.workspaceId/.test(lcAuth) && /missionStatus\.length === 0/.test(lcAuth));
check("4b.8 authorize precedes lifecycle RPC", fin.indexOf("authorizeLifecycle") < fin.indexOf("MINIAPP_RPC.endNow"));
check("4b.9 exact actor/target passed to final edit", /binding,\s*actorUserId,\s*targetId,\s*action,/.test(fin));
check("4b.10 exact target passed to safe unpin", /miniAppSafeUnpin\(admin, binding, targetId\)/.test(fin));
check("4b.11 no first-target fallback in edit or unpin", !/limit\(1\)|order\("created_at"/.test(edit) && !/limit\(1\)|order\("created_at"/.test(unpin) && /\.eq\("id", targetId\)/.test(edit) && /\.eq\("id", targetId\)/.test(unpin));
check("4b.12 actor header always sent on authorized final edit", /"X-Cartel-Actor-User-Id": actorUserId,/.test(edit) && !/isUuid\(actorUserId\) \?/.test(edit) && /if \(!isUuid\(actorUserId\) \|\| !isUuid\(targetId\)\) return "failed";/.test(edit));
check("4b.13 edit does not re-authorize or guess (stale comment removed)", !/MINIAPP_RPC\.authorize/.test(edit) && !/may refuse a no-longer-LIVE/.test(bridge));
check("4b.14 same-request replay after non-LIVE: replayed still heals, schedule only on ok", /outcome !== "ok" && outcome !== "replayed"/.test(fin) && /action === "end_now" && outcome === "ok"/.test(fin));
check("4b.15 same-request replay reuses deterministic idempotency + card id", /miniAppIdempotencyKey\(telegramUserId, action, data!\.requestId\)/.test(fin) && /alreadyBound \? currentRevision/.test(edit));
check("4b.16 cancel path performs no X read in bridge", !/api\.x\.com|twitter|social-read/i.test(fin + edit));
check("4.3 unpin recorded via existing RPC", /MINIAPP_RPC\.recordPin/.test(unpin) && /recordPin: "record_social_mission_target_pin"/.test(bridge));
check("4.4 unpin never throws into finalization", /catch \{\s*\/\/ A pin problem/.test(unpin));
// 5. UI
check("5.1 two-step confirmation", /openLifecycleConfirm\("end_now"\)/.test(mission) && /confirmLifecycle\(editor\)/.test(mission));
check("5.2 retry replays same request", /function retryLifecycle\(\) \{\s*if \(lifecycleRetry\) lifecycleMutation\.mutate\(lifecycleRetry\);/.test(mission));
check("5.3 network error never claims success", /Could not confirm whether the mission was finalized/.test(mission));
check("5.4 confirm disabled while an uncertain request awaits replay", /disabled=\{lifecycleRetry !== null\}/.test(mission));
check("5.5 inbox wording unambiguous", /Resolve conversation/.test(inbox) && /Reopen conversation/.test(inbox));
check("5.6 Brand/More use existing routes only", ["/project-profile", "/brand-kit", "/launch-control", "/telegram", "/distribution", "/dashboard", "/settings"].every((r) => home.includes(`to="${r}"`)));
// 6. classification
const e = classifyLifecycleResult("end_now", { ok: true, outcome: "ok", refresh: "edited" });
check("6.1 committed + edited = success final", e.tone === "success" && e.finalized && !e.retry);
const a = classifyLifecycleResult("cancel", { ok: true, outcome: "ok", refresh: "ambiguous" });
check("6.2 committed + ambiguous card = warning, final, no resend", a.tone === "warning" && a.finalized && !a.retry && /could not be confirmed/.test(a.message));
const nl = classifyLifecycleResult("end_now", { ok: true, outcome: "not_live" });
check("6.3 not_live never success", nl.tone === "warning" && !nl.committed && !nl.finalized);
const nf = classifyLifecycleResult("end_now", { ok: false, reason: "not_found" });
check("6.4 post-finalize not_found is honest", !nf.committed && /may already be finalized/.test(nf.message));
const c = classifyLifecycleResult("end_now", { ok: true, outcome: "conflict" });
check("6.5 conflict retryable, uncommitted", c.retry && !c.committed);
// 7. bot menu simplification (both copies)
hooks.forEach((w, i) => {
  const kb = w.match(/const mcPanelKeyboard = \(missionId: string\) => \(\{[\s\S]{0,700}?\n  \}\);/)?.[0] ?? "";
  check(`7.${i}.1 new panel: only Mini App + Exit`, kb.includes("web_app") && kb.includes('"mc_x"') && !/mc_t_|mc_d_|mc_e_|mc_c_/.test(kb));
  check(`7.${i}.2 mission URL UUID-validated`, /if \(!MC_MISSION_UUID_RE\.test\(missionId\)\) return null;/.test(w));
  check(`7.${i}.3 legacy handlers retained`, ["mc_t_", "mc_d_", "mc_ec_", "mc_cc_"].every((cb) => w.includes(`callbackData === \`${cb}\${missionId}\``)));
  check(`7.${i}.4 Link Finder START/IGNORE untouched`, /START MISSION/i.test(w) && /IGNORE/i.test(w));
});

console.log(fails.length ? `FAIL — ${fails.length} failed, ${pass} passed` : `PASS — ${pass}/${pass} MINI-HQ-1C checks passed`);
for (const f of fails) console.log("  - " + f);
if (fails.length) process.exit(1);
