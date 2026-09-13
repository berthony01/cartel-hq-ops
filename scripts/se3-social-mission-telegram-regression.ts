/**
 * SE-3 regression — source/fixture only.
 *
 * ZERO network, ZERO database, ZERO secrets. Every assertion is either a pure
 * call into the dependency-free card renderer or a static source/SQL check.
 *
 * Run: bun scripts/se3-social-mission-telegram-regression.ts
 */

import { readFileSync } from "node:fs";
import { createHash } from "node:crypto";
import {
  renderMissionCard,
  renderMetricLines,
  metricLabels,
  buttonLabel,
  EMPTY_METRICS,
  TELEGRAM_TEXT_MAX,
  COMPLETED_OBSERVED_PHRASE,
  NO_CAUSATION_CAVEAT,
  type CanonicalMetrics,
  type MissionCardInput,
} from "../backend-source/edge-functions/social-mission-telegram/card.ts";

let passed = 0;
const failures: string[] = [];

function check(name: string, condition: boolean): void {
  if (condition) {
    passed += 1;
  } else {
    failures.push(name);
  }
}

const FN_DIR = "backend-source/edge-functions/social-mission-telegram";
const indexSrc = readFileSync(`${FN_DIR}/index.ts`, "utf8");
const cardSrc = readFileSync(`${FN_DIR}/card.ts`, "utf8");
const denoJson = readFileSync(`${FN_DIR}/deno.json`, "utf8");
const clientSrc = readFileSync("src/lib/social-mission-telegram.ts", "utf8");
const sql = readFileSync("docs/sql/SE3_social_mission_telegram_transport.sql", "utf8");
const telegramGroupSrc = readFileSync("backend-source/edge-functions/telegram-group/index.ts", "utf8");

// ---------------------------------------------------------------------------
// 1. Existing Telegram transport untouched
// ---------------------------------------------------------------------------

const TELEGRAM_GROUP_MD5 = "b5cb9a894a95f4ef749e105e2675d174";
check(
  "1.1 telegram-group source byte-unchanged by SE-3",
  createHash("md5").update(readFileSync("backend-source/edge-functions/telegram-group/index.ts")).digest("hex") ===
    TELEGRAM_GROUP_MD5,
);
check("1.2 telegram-group not referenced/imported by the new function", !indexSrc.includes("telegram-group"));
check("1.3 telegram-group still defines its own transport", telegramGroupSrc.includes("api.telegram.org"));
check("1.4 new function is a separate module, not an extension", indexSrc.includes("Deno.serve"));

// ---------------------------------------------------------------------------
// 2. Exactly two actions
// ---------------------------------------------------------------------------

check("2.1 send_mission action exists", indexSrc.includes('"send_mission"'));
check("2.2 edit_mission action exists", indexSrc.includes('"edit_mission"'));
check(
  "2.3 unsupported actions rejected",
  indexSrc.includes('action !== "send_mission" && action !== "edit_mission"') &&
    indexSrc.includes("Unsupported action."),
);
const actionLiterals = [...indexSrc.matchAll(/action\s*===?\s*"([a-z_]+)"/g)].map((m) => m[1]);
check(
  "2.4 no third action literal",
  actionLiterals.every((a) => a === "send_mission" || a === "edit_mission"),
);
check("2.5 no status/broadcast/delete/resend action", !/"(resend|delete_mission|broadcast|status)"/.test(indexSrc));

// ---------------------------------------------------------------------------
// 3. Auth + owner/admin gate before any transport
// ---------------------------------------------------------------------------

check("3.1 bearer token required", indexSrc.includes('authHeader.startsWith("Bearer ")'));
check("3.2 caller identity verified", indexSrc.includes("auth.getUser()"));
check("3.3 workspace membership loaded", indexSrc.includes('from("workspace_members")'));
check(
  "3.4 only owner/admin may run transport",
  indexSrc.includes('role !== "owner" && role !== "admin"'),
);
check(
  "3.5 membership gate precedes Telegram transport",
  indexSrc.indexOf('role !== "owner"') < indexSrc.indexOf("async function handleSend"),
);
check("3.6 service role used for authoritative rows", indexSrc.includes("SUPABASE_SERVICE_ROLE_KEY"));
check("3.7 UUID validation applied to all ids", (indexSrc.match(/uuid\(body\["/g) ?? []).length === 4);
check("3.8 revision validated as positive integer", indexSrc.includes("Number.isInteger(revision)"));

// ---------------------------------------------------------------------------
// 4. Telegram transport constraints
// ---------------------------------------------------------------------------

check("4.1 fixed Telegram host", indexSrc.includes('const TG_BASE = "https://api.telegram.org"'));
check("4.2 no alternate Telegram host", (indexSrc.match(/api\.telegram\.org/g) ?? []).length === 1);
check("4.3 10 second timeout", indexSrc.includes("TELEGRAM_TIMEOUT_MS = 10_000"));
check("4.4 timeout enforced via AbortController", indexSrc.includes("controller.abort()"));
check("4.5 bot token read server-side only", indexSrc.includes('Deno.env.get("TELEGRAM_BOT_TOKEN")'));
check("4.6 token never logged", !/console\.(log|info|warn|error)/.test(indexSrc));
check("4.7 no raw Telegram payload returned", !indexSrc.includes("outcome.result }"));
check("4.8 no second bot token name", !/TELEGRAM_[A-Z_]*BOT[A-Z_]*TOKEN_2|SECOND_BOT/.test(indexSrc));

// ---------------------------------------------------------------------------
// 5. Forbidden scope
// ---------------------------------------------------------------------------

for (const forbidden of [
  "usage_ledger",
  "api.x.com",
  "refetcher",
  "Refetcher",
  "social-read",
  "googleapis.com",
  "cron",
  "setInterval",
  "pg_cron",
  "oauth",
  "OAuth",
  "sendReaction",
  "setMessageReaction",
]) {
  check(`5.x no forbidden reference: ${forbidden}`, !indexSrc.includes(forbidden));
}
check("5.1 no connection metadata mutation", !indexSrc.includes('from("telegram_group_connections")\n    .update'));
check("5.2 no UI import", !clientSrc.includes("react") && !indexSrc.includes("tsx"));
check("5.3 client exposes only two methods", (clientSrc.match(/^export function /gm) ?? []).length === 2);
check("5.4 client never renders copy", !clientSrc.includes("Observed") && !clientSrc.includes("inline_keyboard"));
check("5.5 client has no bot token", !clientSrc.includes("TELEGRAM_BOT_TOKEN"));
check("5.6 client targets the new function only", clientSrc.includes('invoke("social-mission-telegram"'));

// ---------------------------------------------------------------------------
// 6. SQL hardening
// ---------------------------------------------------------------------------

for (const column of [
  "send_client_request_id uuid NULL",
  "send_text_intent text NULL",
  "message_text_snapshot text NULL",
  "edit_state text NOT NULL DEFAULT 'IDLE'",
  "edit_client_request_id uuid NULL",
  "edit_revision bigint NOT NULL DEFAULT 0",
  "edit_text_snapshot text NULL",
  "edit_last_error text NULL",
  "last_edit_at timestamptz NULL",
]) {
  check(`6.x SQL adds column: ${column}`, sql.includes(column));
}
check(
  "6.1 partial unique index on send request id",
  sql.includes("(workspace_id, send_client_request_id)") && sql.includes("WHERE send_client_request_id IS NOT NULL"),
);
check(
  "6.2 partial unique index on edit request id",
  sql.includes("(workspace_id, edit_client_request_id)") && sql.includes("WHERE edit_client_request_id IS NOT NULL"),
);
check("6.3 edit_state enumeration check", sql.includes("'IDLE', 'EDITING', 'EDITED', 'FAILED', 'AMBIGUOUS'"));
check("6.4 edit_revision non-negative", sql.includes("edit_revision >= 0"));
check("6.5 IDLE shape check", sql.includes("edit_state = 'IDLE'") && sql.includes("edit_revision = 0"));
check("6.6 non-IDLE shape check", sql.includes("edit_state <> 'IDLE'") && sql.includes("edit_revision >= 1"));
check(
  "6.7 last_edit_at only for EDITED",
  sql.includes("(edit_state = 'EDITED' AND last_edit_at IS NOT NULL)") &&
    sql.includes("(edit_state <> 'EDITED' AND last_edit_at IS NULL)"),
);
check("6.8 text length bounds 1..4096", (sql.match(/BETWEEN 1 AND 4096/g) ?? []).length === 3);
check("6.9 error length bound 1000", sql.includes("BETWEEN 1 AND 1000"));
check(
  "6.10 PENDING carries no send claim",
  sql.includes("delivery_state = 'PENDING'") && sql.includes("send_text_intent IS NULL"),
);
check(
  "6.11 SENT requires message id, sent_at and confirmed snapshot",
  sql.includes("delivery_state = 'SENT'") &&
    sql.includes("telegram_message_id IS NOT NULL") &&
    sql.includes("message_text_snapshot IS NOT NULL"),
);
check(
  "6.12 non-SENT has no confirmed text",
  sql.includes("delivery_state <> 'SENT'") && sql.includes("message_text_snapshot IS NULL"),
);
check("6.13 authenticated UPDATE revoked", sql.includes("REVOKE UPDATE ON public.social_mission_targets FROM authenticated"));
check(
  "6.14 broad update policy dropped",
  sql.includes("DROP POLICY IF EXISTS social_mission_targets_update_operator"),
);
check("6.15 authenticated INSERT revoked", sql.includes("REVOKE INSERT ON public.social_mission_targets FROM authenticated"));
check(
  "6.16 safe-column INSERT grant only",
  sql.includes("GRANT INSERT (workspace_id, mission_id, group_connection_id, telegram_chat_id)"),
);
check("6.17 INSERT policy requires operator", sql.includes("public.is_workspace_operator(workspace_id)"));
check("6.18 INSERT policy pins default transport shape", sql.includes("AND edit_state = 'IDLE'"));
check("6.19 service role remains authoritative", sql.includes("GRANT ALL ON public.social_mission_targets TO service_role"));
check("6.20 usage_ledger untouched", !sql.includes("usage_ledger"));
check("6.21 no DELETE/SELECT policy change", !sql.includes("DROP POLICY IF EXISTS social_mission_targets_select"));
check("6.22 SQL is prepare-only, not applied", sql.includes("PREPARE ONLY"));

// ---------------------------------------------------------------------------
// 7. Exact binding
// ---------------------------------------------------------------------------

check("7.1 mission bound to workspace", indexSrc.includes('.eq("id", missionId)\n    .eq("workspace_id", workspaceId)'));
check(
  "7.2 target bound to workspace + mission",
  indexSrc.includes('.eq("id", targetId)') && indexSrc.includes('.eq("mission_id", missionId)'),
);
check(
  "7.3 connection rechecked on id + workspace + chat",
  indexSrc.includes('.eq("telegram_chat_id", chatId)') && indexSrc.includes('from("telegram_group_connections")'),
);
check("7.4 DRAFT mission never sent or edited", indexSrc.includes("A draft mission cannot be sent or edited."));
check("7.5 unbound target refused", indexSrc.includes("no longer bound to a Telegram community"));

// ---------------------------------------------------------------------------
// 8. send_mission state machine
// ---------------------------------------------------------------------------

const sendBlock = indexSrc.slice(indexSrc.indexOf("async function handleSend"), indexSrc.indexOf("async function handleEdit"));

check("8.1 duplicate send request id short-circuits", sendBlock.includes('t["send_client_request_id"] === clientRequestId'));
check(
  "8.2 duplicate check precedes verification and transport",
  sendBlock.indexOf('t["send_client_request_id"] === clientRequestId') < sendBlock.indexOf("verifyGroup"),
);
check("8.3 fresh send allowed only from PENDING or FAILED", sendBlock.includes('state !== "PENDING" && state !== "FAILED"'));
check("8.4 SENT is refused", sendBlock.includes("This target was already sent."));
check("8.5 SENDING/AMBIGUOUS refused as unresolved", sendBlock.includes("A previous send attempt is unresolved"));
check(
  "8.6 claim before transport",
  sendBlock.indexOf('delivery_state: "SENDING"') < sendBlock.indexOf('"sendMessage"'),
);
check("8.7 claim records the exact intent text", sendBlock.includes("send_text_intent: rendered.text"));
check("8.8 claim clears confirmed fields", sendBlock.includes("message_text_snapshot: null"));
check("8.9 claim is state-guarded (compare-and-set)", sendBlock.includes('.eq("delivery_state", state)'));
check("8.10 live verification after claim", sendBlock.indexOf("verifyGroup") > sendBlock.indexOf('delivery_state: "SENDING"'));
check("8.11 exactly one sendMessage call path", (indexSrc.match(/"sendMessage"/g) ?? []).length === 1);
check("8.12 preview disabled", sendBlock.includes("disable_web_page_preview: true"));
check("8.13 SENT requires numeric message id", sendBlock.includes('typeof messageId !== "number"'));
check("8.14 SENT persists confirmed snapshot", sendBlock.includes("message_text_snapshot: rendered.text"));
check("8.15 definite rejection is FAILED", sendBlock.includes('delivery_state: "FAILED"'));
check("8.16 inconclusive outcome is AMBIGUOUS", sendBlock.includes('delivery_state: "AMBIGUOUS"'));
check(
  "8.17 DB finalize failure returns AMBIGUOUS without resending",
  sendBlock.includes("could not be recorded") && (sendBlock.match(/"sendMessage"/g) ?? []).length === 1,
);
check("8.18 no retry loop around transport", !/for\s*\(|while\s*\(/.test(sendBlock));

// ---------------------------------------------------------------------------
// 9. edit_mission state machine
// ---------------------------------------------------------------------------

const editBlock = indexSrc.slice(indexSrc.indexOf("async function handleEdit"));

check("9.1 edit requires SENT with message id", editBlock.includes("Only a confirmed sent target can be edited."));
check("9.2 duplicate edit request id short-circuits", editBlock.includes('t["edit_client_request_id"] === clientRequestId'));
check(
  "9.3 duplicate check precedes transport",
  editBlock.indexOf('t["edit_client_request_id"] === clientRequestId') < editBlock.indexOf("verifyGroup"),
);
check(
  "9.4 same id with different revision conflicts",
  editBlock.includes("already bound to a different revision"),
);
check(
  "9.5 EDITING/AMBIGUOUS block the next revision",
  editBlock.includes('editState === "EDITING" || editState === "AMBIGUOUS"'),
);
check("9.6 revision must be exactly +1", editBlock.includes("revision !== currentRevision + 1"));
check("9.7 stale revision refused without Telegram", editBlock.indexOf("Stale or conflicting edit revision.") < editBlock.indexOf("verifyGroup"));
check("9.8 claim EDITING before transport", editBlock.indexOf('edit_state: "EDITING"') < editBlock.indexOf('"editMessageText"'));
check("9.9 claim records exact edit intent", editBlock.includes("edit_text_snapshot: rendered.text"));
check("9.10 claim clears prior error and last_edit_at", editBlock.includes("edit_last_error: null") && editBlock.includes("last_edit_at: null"));
check("9.11 claim is revision-guarded", editBlock.includes('.eq("edit_revision", currentRevision)'));
check("9.12 exactly one editMessageText call path", (indexSrc.match(/"editMessageText"/g) ?? []).length === 1);
check("9.13 no replacement send inside edit", !editBlock.includes("sendMessage"));
check("9.14 'message is not modified' is success", indexSrc.includes('includes("message is not modified")') && editBlock.includes("isNotModified"));
check("9.15 EDITED updates the confirmed snapshot", editBlock.includes('edit_state: "EDITED"') && editBlock.includes("message_text_snapshot: rendered.text"));
check("9.16 EDITED sets last_edit_at", editBlock.includes("last_edit_at: editedAt"));
check("9.17 definite rejection is edit FAILED", editBlock.includes('edit_state: "FAILED"'));
check("9.18 inconclusive is edit AMBIGUOUS", editBlock.includes('edit_state: "AMBIGUOUS"'));
check(
  "9.19 FAILED/AMBIGUOUS edits never touch confirmed text",
  !/edit_state: "FAILED",[\s\S]{0,200}message_text_snapshot/.test(editBlock) &&
    !/edit_state: "AMBIGUOUS",[\s\S]{0,200}message_text_snapshot/.test(editBlock),
);
check("9.20 DB finalize failure leaves EDITING and blocks future revisions", editBlock.includes("could not be recorded"));

// ---------------------------------------------------------------------------
// 10. Uncertainty classification
// ---------------------------------------------------------------------------

check("10.1 429 is uncertain", indexSrc.includes("response.status === 429"));
check("10.2 5xx is uncertain", indexSrc.includes("response.status >= 500"));
check("10.3 unreadable body is uncertain", indexSrc.includes("unreadable response"));
check("10.4 inconclusive body is uncertain", indexSrc.includes("inconclusive response"));
check("10.5 timeout/network is uncertain", indexSrc.includes("did not respond in time"));
check("10.6 explicit ok:false is a definite rejection", indexSrc.includes("payload.ok === false"));
check("10.7 verification distinguishes definite vs uncertain", indexSrc.includes("definite: boolean"));
check("10.8 verification requires group/supergroup", indexSrc.includes('chatType !== "group" && chatType !== "supergroup"'));
check("10.9 verification requires admin/creator", indexSrc.includes('status !== "administrator" && status !== "creator"'));
check("10.10 verification uses getMe + getChat + getChatMember", indexSrc.includes('"getMe"') && indexSrc.includes('"getChat"') && indexSrc.includes('"getChatMember"'));

// ---------------------------------------------------------------------------
// 11. Renderer — pure fixture behaviour
// ---------------------------------------------------------------------------

check("11.1 card.ts is dependency free", !cardSrc.includes("import "));
check("11.2 card.ts never fetches", !cardSrc.includes("fetch("));
check("11.3 deno.json is strict", denoJson.includes('"strict": true'));

const baseline: CanonicalMetrics = { views: 100, likes: 10, comments: 2, shares: 3, saves: null };
const latest: CanonicalMetrics = { views: 180, likes: 10, comments: 5, shares: null, saves: null };

const liveInput: MissionCardInput = {
  missionStatus: "LIVE",
  platform: "x",
  canonicalUrl: "https://x.com/PEPECARTELTOKEN/status/2098827349470961903",
  authorHandle: "PEPECARTELTOKEN",
  contentText: "WEEKEND WITH THE CARTEL",
  projectName: "PEPE CARTEL",
  ticker: "$PCART",
  baseline,
  latest,
};

const liveCard = renderMissionCard(liveInput);

check("11.4 LIVE copy invites perspective", liveCard.text.includes("Read the update and add your perspective."));
check("11.5 LIVE card shows project name and ticker", liveCard.text.includes("PEPE CARTEL") && liveCard.text.includes("$PCART"));
check("11.6 null metric omitted (saves)", !liveCard.text.includes("Bookmarks"));
check("11.7 null latest with non-null baseline shows baseline, no delta", liveCard.text.includes("Reposts: 3") && !liveCard.text.includes("Reposts: 3 ("));
check("11.8 delta rendered when both sides exist", liveCard.text.includes("Views: 180 (+80)"));
check("11.9 zero delta rendered without suffix", liveCard.text.includes("Likes: 10\n"));
check("11.10 X labels correct", JSON.stringify(metricLabels("x")) === JSON.stringify({ views: "Views", likes: "Likes", comments: "Replies", shares: "Reposts", saves: "Bookmarks" }));
check("11.11 X button label", buttonLabel("x") === "OPEN ON X");
check("11.12 exactly one inline button", liveCard.replyMarkup !== null && liveCard.replyMarkup.inline_keyboard.length === 1 && liveCard.replyMarkup.inline_keyboard[0]!.length === 1);
check("11.13 button points at the stored canonical URL", liveCard.replyMarkup!.inline_keyboard[0]![0]!.url === liveInput.canonicalUrl);
check("11.14 no reward/quota/manipulation copy", !/reward|points|payout|airdrop|quota|must like|guaranteed/i.test(liveCard.text));
check("11.15 LIVE card has no causation caveat", !liveCard.text.includes(NO_CAUSATION_CAVEAT));
check("11.16 card within Telegram limit", liveCard.text.length <= TELEGRAM_TEXT_MAX);

const completedCard = renderMissionCard({ ...liveInput, missionStatus: "COMPLETED" });
check("11.17 COMPLETED contains the exact observed phrase", completedCard.text.includes(COMPLETED_OBSERVED_PHRASE));
check("11.18 COMPLETED contains the causation caveat", completedCard.text.includes(NO_CAUSATION_CAVEAT));
check("11.19 COMPLETED states the window is closed", completedCard.text.includes("This mission window is closed."));

const cancelledCard = renderMissionCard({ ...liveInput, missionStatus: "CANCELLED" });
check("11.20 CANCELLED truthful terminal copy", cancelledCard.text.includes("cancelled before it completed"));
check("11.21 CANCELLED keeps observed metrics", cancelledCard.text.includes("Views: 180"));
check("11.22 CANCELLED carries the caveat", cancelledCard.text.includes(NO_CAUSATION_CAVEAT));

const failedCard = renderMissionCard({ ...liveInput, missionStatus: "FAILED" });
check("11.23 FAILED truthful terminal copy", failedCard.text.includes("failed state"));
check("11.24 FAILED carries the caveat", failedCard.text.includes(NO_CAUSATION_CAVEAT));

const emptyCard = renderMissionCard({
  ...liveInput,
  baseline: { ...EMPTY_METRICS },
  latest: null,
  authorHandle: null,
  contentText: null,
  projectName: null,
  ticker: null,
});
check("11.25 all-null metrics render no metric block", !emptyCard.text.includes("Views") && !emptyCard.text.includes("Likes"));
check("11.26 all-null metrics never become zero", !/: 0(\s|$)/m.test(emptyCard.text));
check("11.27 card still renders without project/author/excerpt", emptyCard.text.includes("CARTEL SOCIAL MISSION"));

const longCard = renderMissionCard({ ...liveInput, contentText: "x".repeat(5000) });
check("11.28 long content truncated safely", longCard.text.length <= TELEGRAM_TEXT_MAX && longCard.text.includes("\u2026"));

const badUrlCard = renderMissionCard({ ...liveInput, canonicalUrl: "javascript:alert(1)" });
check("11.29 non-http URL produces no button", badUrlCard.replyMarkup === null);

check("11.30 renderMetricLines omits nulls only", renderMetricLines("x", { ...EMPTY_METRICS }, null).length === 0);
check(
  "11.31 renderMetricLines uses generic labels off-X",
  renderMetricLines("youtube", { views: 5, likes: null, comments: null, shares: null, saves: null }, null)[0] === "Views: 5",
);
check("11.32 negative delta rendered truthfully", renderMetricLines("x", { views: 200, likes: null, comments: null, shares: null, saves: null }, { views: 150, likes: null, comments: null, shares: null, saves: null })[0] === "Views: 150 (-50)");

// ---------------------------------------------------------------------------
// 12. Snapshot honesty in the function
// ---------------------------------------------------------------------------

check("12.1 intent and confirmed snapshot are distinct columns", indexSrc.includes("send_text_intent") && indexSrc.includes("message_text_snapshot"));
check(
  "12.2 confirmed snapshot only written on SENT or EDITED",
  (indexSrc.match(/message_text_snapshot: rendered\.text/g) ?? []).length === 2,
);
check(
  "12.3 failed send never claims confirmed text",
  !/delivery_state: "FAILED",[\s\S]{0,200}message_text_snapshot: rendered/.test(indexSrc),
);
check(
  "12.4 ambiguous send never claims confirmed text",
  !/delivery_state: "AMBIGUOUS",[\s\S]{0,200}message_text_snapshot: rendered/.test(indexSrc),
);
check("12.5 card rendered server-side only", !clientSrc.includes("renderMissionCard"));
check("12.6 no operator free text accepted", !indexSrc.includes('body["text"]') && !indexSrc.includes('body["message"]'));

// ---------------------------------------------------------------------------

console.log(`SE-3 regression: ${passed} passed, ${failures.length} failed`);
if (failures.length > 0) {
  for (const failure of failures) console.log(`  FAIL ${failure}`);
  process.exit(1);
}
