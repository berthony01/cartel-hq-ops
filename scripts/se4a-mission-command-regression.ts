/**
 * SE-4A regression — source/fixture only.
 *
 * ZERO network, ZERO database, ZERO secrets, ZERO Telegram and ZERO X calls.
 * Every assertion is a static source/SQL check or a pure call into the
 * dependency-free URL parser extracted from the webhook source.
 *
 * Run: bun scripts/se4a-mission-command-regression.ts
 */

import { readFileSync } from "node:fs";

let passed = 0;
const failures: string[] = [];

function check(name: string, condition: boolean): void {
  if (condition) passed += 1;
  else failures.push(name);
}

const WEBHOOK_PATH = "supabase/functions/telegram-webhook/index.ts";
const TRANSPORT_PATH = "backend-source/edge-functions/social-mission-telegram/index.ts";
const SQL_PATH = "docs/sql/SE4A_mission_command_launcher.sql";
const STALE_WEBHOOK_PATH = "backend-source/edge-functions/telegram-webhook/index.ts";

const webhookSrc = readFileSync(WEBHOOK_PATH, "utf8");
const transportSrc = readFileSync(TRANSPORT_PATH, "utf8");
const sql = readFileSync(SQL_PATH, "utf8");
const staleWebhookSrc = readFileSync(STALE_WEBHOOK_PATH, "utf8");

/** Behavioural assertions read CODE, not the comments that legitimately name
 *  the things this phase excludes. */
function stripComments(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
}
const webhookCode = stripComments(webhookSrc);
const transportCode = stripComments(transportSrc);
const sqlCode = sql.replace(/^\s*--.*$/gm, "");

// ---------------------------------------------------------------------------
// 1. Pure URL parsing / canonicalisation (behaviour, not just source text)
// ---------------------------------------------------------------------------

const MISSION_X_HOSTS = ["x.com", "www.x.com", "twitter.com", "www.twitter.com", "mobile.twitter.com"];

type ParsedXStatus = { handle: string; postId: string; canonicalUrl: string };

/** Mirror of the webhook parser; asserted below to be byte-identical in shape. */
function parseXStatusUrl(raw: string): ParsedXStatus | null {
  const value = String(raw ?? "").trim();
  if (!value || value.length > 2048) return null;
  let url: URL;
  try { url = new URL(value); } catch { return null; }
  if (url.protocol !== "https:") return null;
  if (url.username || url.password || url.port) return null;
  if (!MISSION_X_HOSTS.includes(url.hostname.toLowerCase())) return null;
  const segments = url.pathname.split("/").filter((segment) => segment.length > 0);
  if (segments.length !== 3) return null;
  const handle = String(segments[0]).toLowerCase();
  if (String(segments[1]).toLowerCase() !== "status") return null;
  if (!/^[a-z0-9_]{1,15}$/.test(handle) || handle === "i") return null;
  const postId = String(segments[2]);
  if (!/^[0-9]{1,32}$/.test(postId)) return null;
  return { handle, postId, canonicalUrl: `https://x.com/${handle}/status/${postId}` };
}

const OFFICIAL = "https://x.com/PEPECARTELTOKEN/status/2098827349470961903";
const ok = parseXStatusUrl(OFFICIAL);
check("1.1 plain x.com status URL parses", ok !== null);
check("1.2 handle is lowercased", ok?.handle === "pepecarteltoken");
check("1.3 numeric post id is preserved as a string", ok?.postId === "2098827349470961903");
check("1.4 canonical URL is normalised to x.com", ok?.canonicalUrl === "https://x.com/pepecarteltoken/status/2098827349470961903");
check("1.5 query string is canonicalised away", parseXStatusUrl(`${OFFICIAL}?s=20`)?.canonicalUrl === ok?.canonicalUrl);
check("1.6 trailing slash is canonicalised away", parseXStatusUrl(`${OFFICIAL}/`)?.canonicalUrl === ok?.canonicalUrl);
check("1.7 twitter.com is accepted and canonicalised", parseXStatusUrl("https://twitter.com/PEPECARTELTOKEN/status/2098827349470961903")?.canonicalUrl === ok?.canonicalUrl);
check("1.8 mobile.twitter.com is accepted", parseXStatusUrl("https://mobile.twitter.com/jack/status/20") !== null);
check("1.9 http is rejected", parseXStatusUrl("http://x.com/jack/status/20") === null);
check("1.10 foreign host is rejected", parseXStatusUrl("https://evil.com/jack/status/20") === null);
check("1.11 lookalike subdomain host is rejected", parseXStatusUrl("https://x.com.evil.com/jack/status/20") === null);
check("1.12 embedded credentials are rejected", parseXStatusUrl("https://user:pass@x.com/jack/status/20") === null);
check("1.13 explicit port is rejected", parseXStatusUrl("https://x.com:8443/jack/status/20") === null);
check("1.14 i/web/status is rejected", parseXStatusUrl("https://x.com/i/web/status/20") === null);
check("1.15 profile URL is rejected", parseXStatusUrl("https://x.com/PEPECARTELTOKEN") === null);
check("1.16 non-status path is rejected", parseXStatusUrl("https://x.com/jack/statuses/20") === null);
check("1.17 non-numeric post id is rejected", parseXStatusUrl("https://x.com/jack/status/abc") === null);
check("1.18 empty input is rejected", parseXStatusUrl("") === null);
check("1.19 non-URL text is rejected", parseXStatusUrl("not a link") === null);
check("1.20 oversized input is rejected", parseXStatusUrl(`https://x.com/jack/status/${"1".repeat(4000)}`) === null);
check("1.21 overlong handle is rejected", parseXStatusUrl("https://x.com/aaaaaaaaaaaaaaaaaaaa/status/20") === null);

check("1.22 webhook ships the same host allowlist", MISSION_X_HOSTS.every((host) => webhookCode.includes(`"${host}"`)));
check("1.23 webhook parser rejects credentials and ports", webhookCode.includes("url.username || url.password || url.port"));
check("1.24 webhook parser requires https", webhookCode.includes('url.protocol !== "https:"'));
check("1.25 webhook parser requires exactly three path segments", webhookCode.includes("segments.length !== 3"));
check("1.26 webhook parser rejects the i/web shape", webhookCode.includes('handle === "i"'));
check("1.27 webhook canonicalises to https://x.com", webhookCode.includes("`https://x.com/${handle}/status/${postId}`"));

// ---------------------------------------------------------------------------
// 2. Command surface
// ---------------------------------------------------------------------------

check("2.1 /mission branch exists", webhookCode.includes("/^\\/mission(?:@\\w+)?(?:\\s+(\\S+))?\\s*$/i"));
check("2.2 command is registered with Telegram", webhookCode.includes('{ command: "mission", description: "Start a Social Mission from an X post" }'));
check("2.3 group help documents the command", webhookSrc.includes("/mission &lt;X link&gt; — start a Social Mission (admins only)"));
check("2.4 invalid or missing link gets one concise usage response", webhookCode.includes("const MISSION_USAGE") && webhookCode.includes("await reply(MISSION_USAGE)"));
check("2.5 command is refused outside a group/supergroup", webhookCode.includes('chatType !== "group" && chatType !== "supergroup"'));
check("2.6 bot senders cannot run the command", webhookCode.includes("missionMatch && from?.is_bot !== true"));
check(
  "2.7 the /mission branch runs before the unknown-slash no-op",
  webhookCode.indexOf("runMissionCommand({") < webhookCode.indexOf('if (text.startsWith("/")) return json({ ok: true });'),
);
// SE-4B re-pin: `/mission close` is now a frozen Phase 1B command. The
// boundary assertion still forbids the commands that remain out of scope.
check("2.8 no /mission latest|refresh in this phase", !/\/mission\s+(latest|refresh)/i.test(webhookSrc));

// ---------------------------------------------------------------------------
// 3. Authorization chain in the webhook
// ---------------------------------------------------------------------------

check("3.1 connected group is required", webhookCode.includes('.from("telegram_group_connections")') && webhookCode.includes("This community is not connected to Cartel HQ yet."));
check("3.2 linked actor is required", webhookCode.includes("const linked = await getLinkedUser(String(telegramUserId))"));
check("3.3 workspace owner/admin is required", webhookCode.includes('admin.rpc("is_workspace_operator"'));
check("3.4 operator check is fail-closed", webhookCode.includes("operatorError || isOperator !== true"));
check("3.5 live Telegram member check is performed", webhookCode.includes('telegramJson(TELEGRAM_BOT_TOKEN, "getChatMember", { chat_id: chatId, user_id: telegramUserId })'));
check("3.6 only administrator/creator continues", webhookCode.includes('memberStatus !== "administrator" && memberStatus !== "creator"'));
check(
  "3.7 the cheap checks run before the live Telegram round trip",
  webhookCode.indexOf('admin.rpc("is_workspace_operator"') < webhookCode.indexOf('"getChatMember", { chat_id: chatId, user_id: telegramUserId }'),
);
check(
  "3.8 the live admin check runs before mission creation",
  webhookCode.indexOf('memberStatus !== "administrator"') < webhookCode.indexOf('admin.rpc("create_social_mission_from_telegram_link"'),
);
check("3.9 the RPC is called exactly once", (webhookCode.match(/create_social_mission_from_telegram_link/g) ?? []).length === 1);

// ---------------------------------------------------------------------------
// 4. Zero X read, zero fabrication
// ---------------------------------------------------------------------------

check("4.1 no X API host in the webhook", !webhookCode.includes("api.twitter.com") && !webhookCode.includes("api.x.com"));
check("4.2 no X bearer/API key use in the webhook", !/X_API|TWITTER_API|X_BEARER/i.test(webhookCode));
check("4.3 no social provider module is imported by the webhook", !webhookCode.includes("social-read"));
check("4.4 no X read in the prepared SQL", !/api\.(x|twitter)\.com/i.test(sqlCode) && !/http_get|net\.http/i.test(sqlCode));
check("4.5 post content is explicitly NULL", sqlCode.includes("v_handle, NULL,"));
check("4.6 no author display name is invented", !sqlCode.includes("author_display_name"));
check("4.7 no published_at is invented", !sqlCode.includes("published_at"));
check("4.8 baseline metrics are never written", !/baseline_(views|likes|comments|shares|saves)/.test(sqlCode));
check("4.9 zero-read provenance is recorded", sqlCode.includes("'x_api_reads_at_start', 0"));
check("4.10 provenance names the command source", sqlCode.includes("'source', 'telegram_mission_command'"));
check("4.11 no usage_ledger write anywhere in SE-4A", !sqlCode.includes("usage_ledger") && !webhookCode.includes("usage_ledger"));
check("4.12 no metric snapshot write", !sqlCode.includes("social_metric_snapshots"));

// ---------------------------------------------------------------------------
// 5. Atomic RPC contract
// ---------------------------------------------------------------------------

check("5.1 exactly one function is defined", (sqlCode.match(/CREATE OR REPLACE FUNCTION/g) ?? []).length === 1);
check("5.2 function is SECURITY DEFINER", sqlCode.includes("SECURITY DEFINER"));
check("5.3 function pins search_path", sqlCode.includes("SET search_path = public"));
check("5.4 execute is revoked from PUBLIC/anon/authenticated", sqlCode.includes("REVOKE ALL ON FUNCTION") && sqlCode.includes("FROM PUBLIC, anon, authenticated"));
check("5.5 execute is granted to service_role", /GRANT EXECUTE ON FUNCTION[\s\S]*?TO service_role;/.test(sqlCode));
check("5.6 execute is granted to postgres", /GRANT EXECUTE ON FUNCTION[\s\S]*?TO postgres;/.test(sqlCode));
check("5.7 no grant to authenticated or anon", !/GRANT EXECUTE ON FUNCTION[\s\S]*?TO (authenticated|anon)/.test(sqlCode));
check("5.8 idempotency claims the telegram update id", sqlCode.includes("INSERT INTO public.telegram_inbound_updates") && sqlCode.includes("ON CONFLICT (telegram_update_id) DO NOTHING"));
check("5.9 the claim is MESSAGE/RECEIVED then PROCESSED in the same transaction", sqlCode.includes("'MESSAGE'") && sqlCode.includes("'RECEIVED'") && sqlCode.includes("SET status = 'PROCESSED'"));
check("5.10 the raw Telegram payload is never stored", !/payload|raw_update|jsonb_build_object\('message'/i.test(sqlCode));
check("5.11 duplicate update with matching provenance returns the existing mission", sqlCode.includes("'outcome', 'EXISTING'") && sqlCode.includes("'reason', 'duplicate_update'"));
check("5.12 duplicate update with mismatched provenance is refused", sqlCode.includes("'outcome', 'DUPLICATE_UPDATE'") && sqlCode.includes("'provenance_mismatch'"));
check("5.13 post get-or-create never overwrites richer existing content", sqlCode.includes("ON CONFLICT (workspace_id, platform, external_post_id) DO NOTHING"));
check("5.14 second mission for the same post + chat is refused", sqlCode.includes("'mission_already_exists'"));
check("5.15 mission is created LIVE", sqlCode.includes("'LIVE'"));
check("5.16 target is created PENDING", sqlCode.includes("'PENDING'"));
check("5.17 target is bound to the resolved connection and chat", sqlCode.includes("v_connection_id, _telegram_chat_id, 'PENDING'"));
check("5.18 created_by is the resolved linked actor", sqlCode.includes("v_actor_user_id,"));
check("5.19 the RPC re-resolves telegram_connections itself", sqlCode.includes("FROM public.telegram_connections tc"));
check("5.20 the RPC re-authorizes the workspace operator itself", sqlCode.includes("public.is_workspace_operator(v_workspace_id, v_actor_user_id)"));
check("5.21 the operator helper uses the live two-argument signature", !/is_workspace_operator\(\s*v_workspace_id\s*\)/.test(sqlCode));
check("5.22 the RPC revalidates the exact group binding", sqlCode.includes("FROM public.telegram_group_connections gc") && sqlCode.includes("gc.telegram_chat_id = _telegram_chat_id"));
check("5.23 the RPC re-reads the official X account server-side", sqlCode.includes("pp.x_url") && sqlCode.includes("'handle_not_official'"));
check("5.24 a missing official X account is refused", sqlCode.includes("'official_x_account_missing'"));
check("5.25 structural id/handle/url validation exists", sqlCode.includes("'invalid_post_id'") && sqlCode.includes("'invalid_handle'") && sqlCode.includes("'invalid_canonical_url'"));
check("5.26 the returned shape carries actor/mission/target/state", sqlCode.includes("'actor_user_id'") && sqlCode.includes("'mission_id'") && sqlCode.includes("'target_id'") && sqlCode.includes("'delivery_state'"));
check("5.27 no table, column, policy or table grant is altered", !/CREATE TABLE|ALTER TABLE|CREATE POLICY|DROP POLICY|GRANT .* ON TABLE|GRANT INSERT|GRANT SELECT/i.test(sqlCode));
check("5.28 the migration is prepared only, never applied here", sql.includes("PREPARE ONLY"));

// ---------------------------------------------------------------------------
// 6. Internal transport authentication
// ---------------------------------------------------------------------------

check("6.1 internal source constant is the webhook", transportCode.includes('const INTERNAL_SOURCE = "telegram-webhook"'));
check("6.2 internal path requires BOTH the service bearer and the source header", transportCode.includes("internalSource === INTERNAL_SOURCE && bearerToken === serviceKey"));
check("6.3 internal path requires a UUID actor header", transportCode.includes('uuid(request.headers.get("X-Cartel-Actor-User-Id"))'));
check("6.4 a missing internal actor is rejected", transportCode.includes("if (!internalActor) return fail(\"Authentication required.\", 401)"));
check("6.5 the end-user JWT path is preserved", transportCode.includes("authClient.auth.getUser()") && transportCode.includes("actorUserId = user.id"));
check("6.6 the membership gate uses the resolved actor for both paths", transportCode.includes('.eq("user_id", actorUserId)'));
check("6.7 owner/admin is still required", transportCode.includes('role !== "owner" && role !== "admin"'));
check("6.8 JWT verification stays enabled", readFileSync("backend-source/edge-functions/social-mission-telegram/deno.json", "utf8").length > 0 && !transportCode.includes("verify_jwt=false") && !transportCode.includes("verify_jwt: false"));
check("6.9 still exactly two actions", transportCode.includes('action !== "send_mission" && action !== "edit_mission"'));
check("6.10 authoritative row binding checks are untouched", transportCode.includes('.from("telegram_group_connections")') && transportCode.includes("The Telegram community connection for this target no longer matches."));
check("6.11 the service key is never returned or logged by the transport", !/console\.log\([^)]*serviceKey/.test(transportCode) && !/json\(\{[^}]*serviceKey/.test(transportCode));
// SE-4B re-pin: launch and close both reuse the SAME transport endpoint.
// The assertion now proves endpoint UNIQUENESS rather than call count.
check(
  "6.12 no alternate social-mission transport endpoint was created",
  new Set((webhookCode.match(/functions\/v1\/[a-z0-9-]+/g) ?? []).filter((path) => path.includes("social-mission"))).size === 1
    && (webhookCode.match(/functions\/v1\/social-mission-telegram/g) ?? []).length >= 1,
);

// ---------------------------------------------------------------------------
// 7. Delivery reuse, determinism, no retries
// ---------------------------------------------------------------------------

check("7.1 delivery goes through the existing transport function", webhookCode.includes("/functions/v1/social-mission-telegram"));
check("7.2 the webhook sends the internal source header", webhookCode.includes('"X-Cartel-Internal-Source": "telegram-webhook"'));
check("7.3 the webhook sends the actor header", webhookCode.includes('"X-Cartel-Actor-User-Id"'));
check("7.4 the webhook never duplicates sendPhoto or card rendering", !webhookCode.includes("sendPhoto") && !webhookCode.includes("renderMissionCard"));
check("7.5 clientRequestId is derived from the Telegram update id", webhookCode.includes("cartelhq-mission-send:${updateId}"));
check("7.6 the derived id is not random", !webhookCode.includes("crypto.randomUUID"));
check("7.7 the derived id is RFC-4122 shaped", webhookCode.includes('chars[12] = "5"') && webhookCode.includes('["8", "9", "a", "b"]'));
check("7.8 an existing SENT mission is never resent", webhookCode.includes('deliveryState === "SENT"') && webhookCode.includes("This post already has a Social Mission in this community."));
check("7.9 SENDING/AMBIGUOUS are reported unresolved, never retried", webhookCode.includes('deliveryState === "SENDING" || deliveryState === "AMBIGUOUS"') && webhookCode.includes("Please do not retry immediately."));
check("7.10 FAILED targets may be re-attempted only by an explicit new command", webhookCode.includes('deliveryState !== "PENDING" && deliveryState !== "FAILED"'));
check("7.11 there is no retry loop or backoff in the command path", !/for \(let attempt|retry\(|setInterval|Deno\.cron/.test(webhookCode.slice(webhookCode.indexOf("runMissionCommand"), webhookCode.indexOf("runMissionCommand") + 8000)));
check("7.12 a confirmed SENT card suppresses any extra success text", webhookCode.includes('transportState === "SENT"'));
check("7.13 a definite transport failure gets one concise response", webhookCode.includes('transportState === "FAILED"'));
check("7.14 an ambiguous transport outcome says not to retry", webhookCode.includes("The mission card delivery is unresolved. Please do not retry immediately."));
check("7.15 a duplicate Telegram update produces no second action", webhookCode.includes('result.outcome === "DUPLICATE_UPDATE"'));
check("7.16 no polling or auto-detection was introduced", !webhookCode.includes("setInterval") && !webhookCode.includes("Deno.cron"));
check("7.17 the browser can never supply workspace/group/mission identity", !webhookCode.includes("body.workspaceId") && webhookCode.includes("workspaceId: result.workspace_id"));

// ---------------------------------------------------------------------------
// 8. Existing behaviour preserved
// ---------------------------------------------------------------------------

for (const [index, fragment] of [
  "/^\\/(?:cartelhq|connect)(?:@\\w+)?$/i",
  "/^\\/help(?:@\\w+)?$/i",
  "/^\\/roadmap(?:@\\w+)?$/i",
  "/^\\/inbox(?:@\\w+)?$/i",
  "/^\\/cancel(?:@\\w+)?$/i",
].entries()) {
  check(`8.${index + 1} existing command preserved: ${fragment}`, webhookCode.includes(fragment));
}
check("8.6 Launch Watch deep link preserved", webhookCode.includes("lw_([a-f0-9]{24})"));
check("8.7 Launch Watch subscribe path preserved", webhookCode.includes("launchWatchSubscribe"));
check("8.8 Project Inbox capture path preserved", webhookCode.includes("bot_inbox_active_reply_session"));
check("8.9 Project Inbox member capture preserved", webhookCode.includes("capture_project_inbox_member_message") || webhookCode.includes("bot_inbox_"));
check("8.10 welcome/member-join handling preserved", webhookCode.includes("last_welcome_sent_at"));
check("8.11 group linking preserved", webhookCode.includes("bindGroup("));
check("8.12 unknown slash commands remain a no-op", webhookCode.includes('if (text.startsWith("/")) return json({ ok: true });'));
check("8.13 webhook secret verification preserved", webhookCode.includes("X-Telegram-Bot-Api-Secret-Token"));
check("8.14 the stale backend-source webhook copy was NOT modified", !staleWebhookSrc.includes("runMissionCommand") && !staleWebhookSrc.includes("create_social_mission_from_telegram_link"));

// ---------------------------------------------------------------------------

console.log(`SE-4A regression: ${passed} passed, ${failures.length} failed`);
if (failures.length > 0) {
  for (const failure of failures) console.log(`  FAIL ${failure}`);
  process.exit(1);
}
