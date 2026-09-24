/**
 * MINI-HQ-1B.1 — Bot -> Owner Mini App Inbox handoff (source regression).
 * Run: bun scripts/mini-hq-1b1-bot-handoff-regression.ts
 */
import { readFileSync } from "node:fs";

const src = readFileSync("supabase/functions/telegram-webhook/index.ts", "utf8");
let pass = 0;
let fail = 0;
const check = (name: string, ok: boolean) => {
  if (ok) pass++;
  else fail++;
  console.log(`${ok ? "PASS" : "FAIL"} ${name}`);
};
const between = (start: string, end: string) => {
  const i = src.indexOf(start);
  const j = src.indexOf(end, i + start.length);
  return i >= 0 && j > i ? src.slice(i, j) : "";
};

const builder = between("const buildInboxWebAppUrl", "const inboxListMarkup");
const listMarkup = between("const inboxListMarkup", "const renderInboxList");
const resolver = between("const resolveAlertInboxWebAppUrl", "const notifyTeamOfCapture");
const notify = between("const notifyTeamOfCapture", "} catch (alertError)");

// URL construction
check("1.1 base reuses MISSION_CONTROL_WEBAPP_URL", /new URL\(MISSION_CONTROL_WEBAPP_URL\)/.test(builder));
check("1.2 base constant unchanged", src.includes('const MISSION_CONTROL_WEBAPP_URL = "https://cartel-hq-ops.lovable.app/tg";'));
check("1.3 uses URLSearchParams", /new URLSearchParams\(/.test(builder));
check("1.4 tab=inbox", /tab:\s*"inbox"/.test(builder));
check("1.5 workspace + conversation params", /workspace:\s*workspaceId/.test(builder) && /conversation:\s*conversationId/.test(builder));
check("1.6 UUID gate on both inputs before URL", /!INBOX_UUID_RE\.test\(workspaceId\)\s*\|\|\s*!INBOX_UUID_RE\.test\(conversationId\)\)\s*return null/.test(builder));
check("1.7 strict UUID regex", src.includes("const INBOX_UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;"));
check("1.8 no telegram identifiers in URL params", !/telegram|chat|operator|user_id|message_id|username/i.test(builder.replace(/\/\*\*[\s\S]*?\*\//, "")));
check("1.9 no string concat of query", !/\?tab=|&workspace=|&conversation=/.test(builder));

// Inbox list
check("2.1 list markup takes workspaceId", /inboxListMarkup = \(rows: any\[\], workspaceId: string\)/.test(listMarkup));
check("2.2 list row uses web_app", /web_app:\s*\{\s*url\s*\}/.test(listMarkup));
check("2.3 list row falls back to pi_c only when URL unsafe", /url\s*\?\s*\{ text, web_app/.test(listMarkup) && /callback_data: `pi_c_/.test(listMarkup));
check("2.4 close stays callback", /callback_data: "pi_x"/.test(listMarkup));
check("2.5 renderInboxList passes authorized workspaceId", /inboxListMarkup\(rows, workspaceId\)/.test(src));
check("2.6 workspace picker stays pi_w callback", /callback_data: `pi_w_\$\{String\(w\.workspace_id\)\}`/.test(src));
check("2.7 list copy no longer primary reply mode", !src.includes("Pick a conversation to read and reply."));

// Alert resolution
check("3.1 exact project_conversations.id lookup", /from\("project_conversations"\)[\s\S]*?\.select\("workspace_id"\)[\s\S]*?\.eq\("id", conversationId\)[\s\S]*?\.maybeSingle\(\)/.test(resolver));
check("3.2 re-authorizes via bot_inbox_operator_workspaces", /admin\.rpc\("bot_inbox_operator_workspaces", \{\s*_telegram_user_id: operatorId/.test(resolver));
check("3.3 workspace must be in operator set", /String\(w\.workspace_id\) === workspaceId/.test(resolver) && /if \(!allowed\) return null/.test(resolver));
check("3.4 resolver fails soft (try/catch -> null)", /catch \{\s*return null;/.test(resolver));
check("3.5 conversation UUID gated before lookup", resolver.indexOf("INBOX_UUID_RE.test(conversationId)") < resolver.indexOf("project_conversations"));
check("3.6 alert RPC unchanged", /admin\.rpc\("bot_inbox_capture_alert_targets", \{\s*_telegram_update_id: updateId/.test(notify));
check("3.7 alert uses web_app when resolved", /\{ text: "📥 Open Inbox", web_app: \{ url: webAppUrl \} \}/.test(notify));
check("3.8 alert falls back to legacy pi_c", /: \{ text: "📖 Open conversation", callback_data: `pi_c_\$\{conversationId\}` \}/.test(notify));
check("3.9 headings preserved", notify.includes("🆕 NEW PROJECT INBOX MESSAGE") && notify.includes("📥 PROJECT INBOX MESSAGE"));
check("3.10 alert still sent to operator private chat", /String\(operatorId\)/.test(notify));

// Backward compatibility
check("4.1 pi_c parser retained", src.includes("callbackData.match(/^pi_c_([0-9a-f-]{36})$/i)"));
check("4.2 openInboxConversation retained", src.includes("const openInboxConversation = async"));
check("4.3 bot_inbox_open_conversation retained", src.includes('admin.rpc("bot_inbox_open_conversation"'));
check("4.4 30-minute reply mode copy retained", src.includes("Reply mode is on for 30 minutes."));
check("4.5 /cancel retained", src.includes("/cancel"));
check("4.6 reply idempotency helper retained", src.includes("pi-bot-reply:${updateId}"));
check("4.7 mission control button unchanged", src.includes('[{ text: "📲 Open Mission Control", web_app: { url: MISSION_CONTROL_WEBAPP_URL } }]'));

console.log(`\n${pass}/${pass + fail} passed`);
if (fail > 0) process.exit(1);
