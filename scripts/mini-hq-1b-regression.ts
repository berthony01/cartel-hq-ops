/** MINI-HQ-1B focused repository regression. No network or database access. */
import { existsSync, readFileSync } from "node:fs";

let passed = 0;
const failures: string[] = [];
function check(name: string, condition: boolean): void {
  if (condition) passed += 1;
  else failures.push(name);
}

const paths = {
  sql: "docs/sql/MINI_HQ_1B_miniapp_inbox_wrappers.sql",
  bridge: "src/lib/telegram-miniapp-bridge.functions.ts",
  inbox: "src/components/telegram-miniapp/MiniAppInbox.tsx",
  home: "src/routes/tg.index.tsx",
  webInbox: "src/lib/project-inbox.ts",
};
for (const [name, path] of Object.entries(paths)) check(`file exists: ${name}`, existsSync(path));

const sql = readFileSync(paths.sql, "utf8");
const bridge = readFileSync(paths.bridge, "utf8");
const inbox = readFileSync(paths.inbox, "utf8");
const home = readFileSync(paths.home, "utf8");
const sqlCode = sql.replace(/--.*$/gm, "");

const WRAPPERS: Record<string, string> = {
  miniapp_inbox_bind_operator: "bigint, uuid, uuid",
  miniapp_inbox_summary: "bigint, uuid",
  miniapp_inbox_list_conversations: "bigint, uuid, text, integer",
  miniapp_inbox_get_conversation: "bigint, uuid, uuid",
  miniapp_inbox_list_messages: "bigint, uuid, uuid, integer",
  miniapp_inbox_update_status: "bigint, uuid, uuid, text",
  miniapp_inbox_set_blocked: "bigint, uuid, uuid, boolean",
  miniapp_inbox_create_team_reply: "bigint, uuid, uuid, text, uuid",
  miniapp_inbox_ack_uncertainty: "bigint, uuid, uuid, uuid",
};
const DELEGATES: Record<string, string> = {
  miniapp_inbox_summary: "get_project_inbox_summary",
  miniapp_inbox_list_conversations: "list_project_inbox_conversations",
  miniapp_inbox_get_conversation: "get_project_inbox_conversation",
  miniapp_inbox_list_messages: "list_project_conversation_messages",
  miniapp_inbox_update_status: "update_project_conversation_status",
  miniapp_inbox_set_blocked: "set_project_inbox_conversation_contact_blocked",
  miniapp_inbox_create_team_reply: "create_project_inbox_team_reply",
  miniapp_inbox_ack_uncertainty: "acknowledge_project_inbox_delivery_uncertainty",
};

function fnBody(name: string): string {
  const start = sqlCode.indexOf(`FUNCTION public.${name}(`);
  if (start < 0) return "";
  const end = sqlCode.indexOf("$$;", start);
  return sqlCode.slice(start, end);
}

// --- Staged SQL: grants / definer / search_path
for (const [name, sig] of Object.entries(WRAPPERS)) {
  const body = fnBody(name);
  check(`${name}: defined`, body.length > 0);
  check(`${name}: SECURITY DEFINER`, /SECURITY DEFINER/.test(body));
  check(`${name}: fixed search_path`, /SET search_path = public/.test(body));
  check(
    `${name}: revoked from PUBLIC, anon, authenticated`,
    sqlCode.includes(`REVOKE ALL ON FUNCTION public.${name}(${sig}) FROM PUBLIC, anon, authenticated;`),
  );
  check(
    `${name}: service_role EXECUTE only`,
    sqlCode.includes(`GRANT EXECUTE ON FUNCTION public.${name}(${sig}) TO service_role;`),
  );
}
check("no grant to anon/authenticated", !/GRANT[^;]*TO[^;]*(anon|authenticated)/i.test(sqlCode));
check("no new tables / RLS / policy changes", !/CREATE TABLE|ALTER TABLE|CREATE POLICY|DROP POLICY|DISABLE ROW/i.test(sqlCode));
check(
  "existing inbox RPCs are not redefined",
  Object.values(DELEGATES).every((d) => !new RegExp(`FUNCTION public\\.${d}\\(`).test(sqlCode)),
);

// --- Binder: mapping, operator check before claim, transaction-local claim
const binder = fnBody("miniapp_inbox_bind_operator");
check("binder maps via telegram_connections", /FROM public\.telegram_connections tc[\s\S]*tc\.telegram_user_id = _telegram_user_id/.test(binder));
check("binder verifies owner/admin", /wm\.role IN \('owner', 'admin'\)/.test(binder));
check("binder verifies conversation workspace", /pc\.id = _conversation_id[\s\S]*pc\.workspace_id = _workspace_id/.test(binder));
const claimAt = binder.indexOf("set_config('request.jwt.claim.sub'");
check("binder sets request.jwt.claim.sub", claimAt > 0);
check(
  "claim is set only AFTER all authorization checks",
  claimAt > binder.lastIndexOf("RAISE EXCEPTION 'not_found'"),
);
check(
  "all set_config calls are transaction-local (is_local = true)",
  (binder.match(/set_config\(/g) ?? []).length === 3 &&
    (binder.match(/set_config\([\s\S]*?,\s*true\s*\)/g) ?? []).length === 3,
);
check("generic fail-closed error only", (binder.match(/RAISE EXCEPTION '([^']+)'/g) ?? []).every((m) => m.includes("'not_found'")));
check("comments prove auth.uid() resolution + local scope", /request\.jwt\.claim\.sub/.test(sql) && /TRANSACTION-LOCAL/.test(sql) && /is_local => true/.test(sql));

// --- Each wrapper binds first, then delegates to the unchanged RPC
for (const [wrapper, delegate] of Object.entries(DELEGATES)) {
  const body = fnBody(wrapper);
  const bindAt = body.indexOf("miniapp_inbox_bind_operator(");
  const delegateAt = body.indexOf(`public.${delegate}(`);
  check(`${wrapper}: binds before delegating to ${delegate}`, bindAt > 0 && delegateAt > bindAt);
  check(`${wrapper}: no direct inbox table access`, !/FROM public\.project_(conversations|conversation_messages|inbox_)/.test(body) || wrapper === "miniapp_inbox_bind_operator");
  check(`${wrapper}: no business logic duplication`, !/INSERT|UPDATE public|DELETE|FOR UPDATE|evaluate_commercial|pg_advisory/i.test(body));
}
const scopedWrappers = ["get_conversation", "list_messages", "update_status", "set_blocked", "create_team_reply", "ack_uncertainty"];
check(
  "conversation-scoped wrappers pass the conversation id to the binder",
  scopedWrappers.every((w) => /bind_operator\(_telegram_user_id, _workspace_id, _conversation_id\)/.test(fnBody(`miniapp_inbox_${w}`))),
);

// --- Privacy: no raw provider identifiers in returned shapes
const identifierPattern = /telegram_user_id|telegram_chat_id|chat_id|provider_message_id|telegram_message_id|username|contact_id/i;
const returnClauses = sqlCode.match(/RETURNS TABLE\([\s\S]*?\)\s*\n/g) ?? [];
check("wrapper return shapes carry no provider identifiers", returnClauses.length === 8 && returnClauses.every((r) => !identifierPattern.test(r)));
const inboxSection = (() => { const rest = bridge.slice(bridge.indexOf("MINI-HQ-1B PROJECT INBOX")); const b1 = rest.indexOf("MINI-HQ B1 — prepared custom message media"); return b1 >= 0 ? rest.slice(0, b1) : rest; })(); // B1 media section is tested by mini-hq-b1-custom-media-regression
const typeSection = inboxSection.slice(0, inboxSection.indexOf("const MINIAPP_INBOX_SAFE_ERRORS"));
check("bridge result types carry no provider identifiers", !identifierPattern.test(typeSection.replace(/_telegram_user_id/g, "")));
check("UI never renders provider identifiers", !identifierPattern.test(inbox) && !/telegram_user_id|chat_id|contact_id/.test(home));

// --- Bridge: initData first, bounded inputs, service-only wrappers only
check("bridge section exists", inboxSection.length > 0);
check("inbox gate validates initData before anything", /async function inboxGate[\s\S]{0,300}validateTelegramInitData[\s\S]{0,200}isUuid\(workspaceId\)/.test(inboxSection));
check("every inbox server fn uses the gate", (inboxSection.match(/createServerFn/g) ?? []).length === (inboxSection.match(/await inboxGate\(/g) ?? []).length);
check("telegram user id comes from the signature only", /telegramUserId: auth\.user\.id/.test(inboxSection) && !/data\.telegramUserId|data\?\.telegramUserId/.test(inboxSection));
check("reply body bounded 1..3500", /MINIAPP_REPLY_MAX_CHARS = 3500/.test(bridge) && /body\.length > MINIAPP_REPLY_MAX_CHARS/.test(inboxSection));
check("reply requires UUID client request id", /isUuid\(data\?\.clientRequestId\)/.test(inboxSection));
check("status is allow-listed", /isInboxStatus\(data\?\.status\)/.test(inboxSection));
check("bridge only calls miniapp_inbox_* wrappers", Object.values(DELEGATES).every((d) => !inboxSection.includes(`"${d}"`)));
check("no direct inbox table reads in bridge", !/from\("project_(conversations|conversation_messages|inbox_)/.test(bridge));
check("no TS duplication of reply rules", !/idempotent_replay\s*=|client_request_id\s*=|evaluate_commercial|FOR UPDATE/.test(inboxSection));
check("wrong workspace/nonexistent maps to generic not_found", /not_found\|Not authorized/.test(inboxSection));

// --- UI truth + reply semantics
check("five filters present", ["All", "Needs reply", "Waiting on member", "Open", "Resolved"].every((l) => inbox.includes(`label: "${l}"`)));
check("delivery labels truthful", ["Sending", "Sent via Telegram", "Not sent", "Delivery uncertain"].every((l) => inbox.includes(`"${l}"`)));
check("one frozen request id per attempt", /setAttempt\(frozen\)/.test(inbox) && /if \(attempt\) \{\s*reply\.mutate\(attempt\)/.test(inbox));
check("network uncertainty keeps attempt frozen", /onError: \(\) => \{[\s\S]{0,300}setUncertainNetwork\(true\)/.test(inbox) && !/onError: \(\) => \{[^}]*setAttempt\(null\)/.test(inbox));
check("success copy says queued, not delivered", /Reply queued/.test(inbox) && !/Reply delivered/.test(inbox));
check("ack copy says it does not resend", /does NOT resend/.test(inbox));
check("no resend control", !/Resend|resend\(/.test(inbox));
check("resolve/reopen + block/unblock present", /"resolve"/.test(inbox) && /"reopen"/.test(inbox) && /"block"/.test(inbox) && /"unblock"/.test(inbox));
check("no direct supabase/browser inbox RPCs", !/@\/integrations\/supabase|@\/lib\/project-inbox/.test(inbox + home));

// --- Deep link + 1A preservation
check("search is validated", /validateSearch: parseMiniAppHomeSearch/.test(home));

// --- Workspace deep-link: bounded parsing + authorized-list-only preselection
check("search type carries optional workspace", /workspace\?: string/.test(home));
check(
  "workspace query is length+UUID bounded and lowercased",
  /typeof workspace === "string" && workspace\.length === 36 && CONVERSATION_UUID\.test\(workspace\)/.test(home) &&
    /out\.workspace = workspace\.toLowerCase\(\)/.test(home),
);
check(
  "conversation query still forces inbox tab",
  /out\.conversation = conversation\.toLowerCase\(\);\s*out\.tab = "inbox";/.test(home),
);
check(
  "workspace resolver only returns ids from the authorized list",
  /export function resolveAuthorizedWorkspace/.test(home) &&
    /authorized\.find\(\(w\) => w\.workspaceId\.toLowerCase\(\) === requested\)/.test(home) &&
    /return match \? match\.workspaceId : null;/.test(home),
);
check(
  "preselection is fed only from miniAppListMissionWorkspaces result",
  /resolveAuthorizedWorkspace\(requestedWorkspace, workspaces\)/.test(home) &&
    /workspacesQuery\.data\?\.ok \? workspacesQuery\.data\.workspaces : \[\]/.test(home),
);
check(
  "no-query behavior preserved: single auto-select, multiple require choice",
  /if \(workspaces\.length === 1\) \{[\s\S]{0,120}only\.workspaceId[\s\S]{0,60}return null;/.test(home),
);
check("raw workspace query never set directly", !/setWorkspaceId\(search\.workspace/.test(home) && !/setWorkspaceId\(requestedWorkspace/.test(home));
check("tab is allow-listed", /MINI_APP_TABS as readonly string\[\]\)\.includes\(tab\)/.test(home));
check("conversation must be a UUID", /CONVERSATION_UUID\.test\(conversation\)/.test(home));
check("inbox tab is functional", /<MiniAppInbox/.test(home) && !/Inbox is coming next/.test(home));
check("home needs-attention uses summary truthfully", /inboxSummary && inboxSummary\.waitingOnTeam > 0/.test(home));
check("Home/Missions/mission detail preserved", /activeTab === "home"/.test(home) && /activeTab === "missions"/.test(home) && /to="\/tg\/mission\/\$missionId"/.test(home));
check("no finalization controls", !/End Mission|Cancel Mission|miniAppEndMission|miniAppCancelMission/.test(home + inbox));
check("no hard-coded customer brand", !/PEPECARTEL|PepeCartel|pepecartel/.test(home + inbox + sql));

// --- Applied: the SQL source record names the applied migration/version
check(
  "sql source record names the applied migration",
  sql.includes("20260924151436") && sql.includes("mini_hq_1b_miniapp_inbox_wrappers"),
);
check("sql header no longer claims unapplied", !/NOT APPLIED/i.test(sql));

if (failures.length > 0) {
  console.error(`FAIL — ${failures.length} failed, ${passed} passed`);
  failures.forEach((f) => console.error(`  - ${f}`));
  process.exit(1);
}
console.log(`PASS — ${passed}/${passed} MINI-HQ-1B checks passed`);
