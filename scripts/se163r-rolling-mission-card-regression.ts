/**
 * SE-16.3R-1 regression — SQL contract only.
 *
 * ZERO network, ZERO database, ZERO secrets, ZERO Telegram and ZERO X calls.
 * Every assertion is a static check over the prepared-only SQL contract and
 * the pre-existing SE-3 transport migration it must not disturb.
 *
 * Run: bun scripts/se163r-rolling-mission-card-regression.ts
 */

import { readFileSync } from "node:fs";

let passed = 0;
const failures: string[] = [];
function check(name: string, condition: boolean): void {
  if (condition) passed += 1;
  else failures.push(name);
}

const SQL_PATH = "docs/sql/SE16_3R_rolling_mission_card.sql";
const SE3_PATH = "docs/sql/SE3_social_mission_telegram_transport.sql";
const SE4B_PATH = "docs/sql/SE4B_mission_lifecycle_pulse.sql";

const sqlRaw = readFileSync(SQL_PATH, "utf8");
const se3Raw = readFileSync(SE3_PATH, "utf8");
const se4bRaw = readFileSync(SE4B_PATH, "utf8");

/** SQL with every `--` comment line removed, so prose can never satisfy a check. */
function stripSqlComments(source: string): string {
  return source.replace(/^\s*--.*$/gm, "");
}
const sql = stripSqlComments(sqlRaw);
const se3 = stripSqlComments(se3Raw);
const se4b = stripSqlComments(se4bRaw);

/** The body of one CREATE OR REPLACE FUNCTION, isolated by name. */
function functionBody(name: string): string {
  const start = sql.indexOf(`CREATE OR REPLACE FUNCTION public.${name}(`);
  if (start < 0) return "";
  const end = sql.indexOf("\n$$;", start);
  return end < 0 ? sql.slice(start) : sql.slice(start, end + 4);
}

const activityFn = functionBody("social_mission_note_chat_activity");
const finalizeFn = functionBody("social_mission_finalize_resurface");

// ---------------------------------------------------------------------------
// 1. Prepare-only framing
// ---------------------------------------------------------------------------

check("1.1 file is marked PREPARED ONLY", /PREPARED ONLY/.test(sqlRaw));
check("1.2 names the authoritative Supabase project", sqlRaw.includes("ocoinbnjgstkmnwwvnhi"));
check("1.3 wrapped in a single transaction", /\bBEGIN;/.test(sql) && /\bCOMMIT;/.test(sql));
check("1.4 no ROLLBACK", !/\bROLLBACK\b/.test(sql));

// ---------------------------------------------------------------------------
// 2. Exactly the eight new columns, additive, with the required types
// ---------------------------------------------------------------------------

const NEW_COLUMNS: Array<[string, RegExp]> = [
  ["activity_message_count", /ADD COLUMN IF NOT EXISTS activity_message_count integer NOT NULL DEFAULT 0/],
  ["last_activity_message_id", /ADD COLUMN IF NOT EXISTS last_activity_message_id bigint NULL/],
  ["last_resurface_at", /ADD COLUMN IF NOT EXISTS last_resurface_at timestamptz NULL/],
  ["last_resurface_attempt_at", /ADD COLUMN IF NOT EXISTS last_resurface_attempt_at timestamptz NULL/],
  ["resurface_state", /ADD COLUMN IF NOT EXISTS resurface_state text NOT NULL DEFAULT 'IDLE'/],
  ["resurface_client_request_id", /ADD COLUMN IF NOT EXISTS resurface_client_request_id uuid NULL/],
  ["resurface_revision", /ADD COLUMN IF NOT EXISTS resurface_revision bigint NOT NULL DEFAULT 0/],
  ["resurface_last_error", /ADD COLUMN IF NOT EXISTS resurface_last_error text NULL/],
];

for (const [name, pattern] of NEW_COLUMNS) {
  check(`2.a column added idempotently: ${name}`, pattern.test(sql));
}

check(
  "2.1 exactly eight columns are added",
  (sql.match(/ADD COLUMN IF NOT EXISTS/g) ?? []).length === NEW_COLUMNS.length,
);
check("2.2 every added column uses IF NOT EXISTS", !/ADD COLUMN(?! IF NOT EXISTS)/.test(sql));
check("2.3 only social_mission_targets gains columns", !/ALTER TABLE public\.(?!social_mission_targets|telegram_message_cleanup_jobs)/.test(sql));
check(
  "2.4 claim request ids are unique per workspace",
  /CREATE UNIQUE INDEX IF NOT EXISTS social_mission_targets_resurface_request_unique[\s\S]{0,220}\(workspace_id, resurface_client_request_id\)/.test(sql),
);

// ---------------------------------------------------------------------------
// 3. No table creation / recreation, no destructive schema work
// ---------------------------------------------------------------------------

check("3.1 no CREATE TABLE", !/CREATE\s+TABLE/i.test(sql));
check("3.2 no DROP TABLE", !/DROP\s+TABLE/i.test(sql));
check("3.3 no DROP COLUMN", !/DROP\s+COLUMN/i.test(sql));
check("3.4 no TRUNCATE", !/TRUNCATE/i.test(sql));
check("3.5 no column rename", !/RENAME/i.test(sql));
check("3.6 no DELETE statement anywhere", !/\bDELETE\s+FROM\b/i.test(sql));
check("3.7 no RLS toggling", !/ROW LEVEL SECURITY/i.test(sql));
check("3.8 no policy changes", !/CREATE POLICY|DROP POLICY/i.test(sql));

// ---------------------------------------------------------------------------
// 4. Constraints — required shape, rerunnable, non-destructive to SE-3
// ---------------------------------------------------------------------------

check("4.1 activity count is non-negative", /social_mission_targets_activity_count_ck[\s\S]{0,160}activity_message_count >= 0/.test(sql));
check("4.2 resurface revision is non-negative", /social_mission_targets_resurface_revision_ck[\s\S]{0,160}resurface_revision >= 0/.test(sql));
check(
  "4.3 resurface_state is exactly the five allowed values",
  /resurface_state IN \('IDLE', 'CLAIMED', 'RESURFACED', 'FAILED', 'AMBIGUOUS'\)/.test(sql),
);
check(
  "4.4 bounded error text",
  /resurface_last_error IS NULL OR char_length\(resurface_last_error\) BETWEEN 1 AND 1000/.test(sql),
);
check(
  "4.5 last_activity_message_id is positive when set",
  /last_activity_message_id IS NULL OR last_activity_message_id > 0/.test(sql),
);
check(
  "4.6 IDLE shape pins request id null, revision 0, no attempt timestamp",
  /resurface_state = 'IDLE'\s*\n\s*AND resurface_client_request_id IS NULL\s*\n\s*AND resurface_revision = 0\s*\n\s*AND last_resurface_attempt_at IS NULL/.test(sql),
);
check(
  "4.7 non-IDLE shape requires request id, revision >= 1 and an attempt timestamp",
  /resurface_state <> 'IDLE'\s*\n\s*AND resurface_client_request_id IS NOT NULL\s*\n\s*AND resurface_revision >= 1\s*\n\s*AND last_resurface_attempt_at IS NOT NULL/.test(sql),
);
check(
  "4.8 last_resurface_at is NOT forced non-null for FAILED/AMBIGUOUS",
  !/last_resurface_at IS NOT NULL/.test(sql),
);

const droppedConstraints = [...sql.matchAll(/DROP CONSTRAINT IF EXISTS (\w+)/g)].map((m) => m[1]);
const ALLOWED_DROPS = new Set([
  "social_mission_targets_activity_count_ck",
  "social_mission_targets_resurface_revision_ck",
  "social_mission_targets_resurface_state_ck",
  "social_mission_targets_resurface_error_ck",
  "social_mission_targets_activity_message_id_ck",
  "social_mission_targets_resurface_shape_ck",
  "telegram_message_cleanup_jobs_cleanup_kind_check",
  "telegram_message_cleanup_jobs_cleanup_kind_ck",
]);
check("4.9 every constraint drop is IF EXISTS", (sql.match(/DROP CONSTRAINT/g) ?? []).length === droppedConstraints.length);
check("4.10 only allowlisted constraints are dropped", droppedConstraints.every((c) => ALLOWED_DROPS.has(c)));
check("4.11 no dynamic constraint dropping", !/pg_get_constraintdef|EXECUTE format/i.test(sql));

// ---------------------------------------------------------------------------
// 5. SE-3 send/edit lane is untouched
// ---------------------------------------------------------------------------

const SEND_EDIT_COLUMNS = [
  "delivery_state",
  "sent_at",
  "send_client_request_id",
  "send_text_intent",
  "transport_kind",
  "edit_state",
  "edit_revision",
  "edit_client_request_id",
  "edit_text_snapshot",
  "edit_last_error",
  "last_edit_at",
];
for (const col of SEND_EDIT_COLUMNS) {
  check(`5.a send/edit column is never dropped or renamed: ${col}`, !new RegExp(`(DROP|RENAME)[^\\n]*\\b${col}\\b`, "i").test(sql));
}
const SE3_CONSTRAINTS = [
  "social_mission_targets_send_intent_shape_ck",
  "social_mission_targets_confirmed_shape_ck",
  "social_mission_targets_edit_state_ck",
  "social_mission_targets_edit_revision_ck",
  "social_mission_targets_edit_shape_ck",
  "social_mission_targets_last_edit_at_ck",
  "social_mission_targets_text_length_ck",
];
for (const c of SE3_CONSTRAINTS) {
  check(`5.b SE-3 constraint untouched: ${c}`, !sql.includes(c) && se3.includes(c));
}
check("5.1 the finalizer never writes edit_state", !/SET[\s\S]{0,700}edit_state\s*=/.test(finalizeFn));
check("5.2 the finalizer never writes edit_revision", !/edit_revision\s*=/.test(finalizeFn));
check("5.3 the finalizer never writes sent_at", !/sent_at\s*=/.test(finalizeFn));
check("5.4 the finalizer never writes delivery_state", !/delivery_state\s*=/.test(finalizeFn));
check("5.5 the finalizer never writes transport_kind", !/transport_kind\s*=/.test(finalizeFn));
check("5.6 the finalizer never writes pinned_by_hq", !/pinned_by_hq\s*=/.test(finalizeFn));

// ---------------------------------------------------------------------------
// 6. Cleanup queue widening only
// ---------------------------------------------------------------------------

check(
  "6.1 widened cleanup kind keeps both prior values and adds the card kind",
  /cleanup_kind IN \('launch_watch_cta', 'social_mission_pulse', 'social_mission_card'\)/.test(sql),
);
check("6.2 the original live constraint name is dropped first", sql.includes("DROP CONSTRAINT IF EXISTS telegram_message_cleanup_jobs_cleanup_kind_check;"));
check("6.3 the SE-4B constraint name is dropped so the migration is rerunnable", sql.includes("DROP CONSTRAINT IF EXISTS telegram_message_cleanup_jobs_cleanup_kind_ck;"));
check("6.4 SE-4B's two kinds remain the baseline", se4b.includes("'launch_watch_cta', 'social_mission_pulse'"));
check("6.5 the cleanup table is not recreated", !/CREATE TABLE[\s\S]*telegram_message_cleanup_jobs/i.test(sql));
check("6.6 the cleanup worker's claim RPC is not redefined", !/claim_telegram_message_cleanup_jobs/.test(sql));

// ---------------------------------------------------------------------------
// 7. Activity RPC — privilege posture
// ---------------------------------------------------------------------------

check("7.1 activity RPC exists", activityFn.length > 0);
check("7.2 activity RPC signature is (bigint, bigint)", /social_mission_note_chat_activity\(\s*\n?\s*_telegram_chat_id bigint,\s*\n?\s*_telegram_message_id bigint/.test(sql));
check("7.3 activity RPC returns jsonb", /RETURNS jsonb/.test(activityFn));
check("7.4 activity RPC is SECURITY DEFINER", /SECURITY DEFINER/.test(activityFn));
check("7.5 activity RPC pins search_path to public", /SET search_path TO 'public'/.test(activityFn));
check(
  "7.6 activity RPC revokes PUBLIC/anon/authenticated",
  /REVOKE ALL ON FUNCTION public\.social_mission_note_chat_activity\(bigint, bigint\) FROM PUBLIC, anon, authenticated;/.test(sql),
);
check(
  "7.7 activity RPC grants only service_role and postgres",
  /GRANT EXECUTE ON FUNCTION public\.social_mission_note_chat_activity\(bigint, bigint\) TO service_role, postgres;/.test(sql),
);

// ---------------------------------------------------------------------------
// 8. Activity RPC — semantics
// ---------------------------------------------------------------------------

check("8.1 rejects non-positive / null message ids", /_telegram_message_id <= 0[\s\S]{0,140}'invalid_input'/.test(activityFn));
check("8.2 binds by exact telegram_chat_id", /t\.telegram_chat_id = _telegram_chat_id/.test(activityFn));
check("8.3 requires a SENT canonical target", /t\.delivery_state = 'SENT'/.test(activityFn) && /t\.telegram_message_id IS NOT NULL/.test(activityFn));
check("8.4 requires mission status LIVE", /m\.status = 'LIVE'/.test(activityFn));
check("8.5 joins mission on workspace as well as id", /m\.workspace_id = t\.workspace_id/.test(activityFn));
check("8.6 zero matches is a bounded no_live ignore", /v_matches = 0[\s\S]{0,140}'no_live'/.test(activityFn));
check("8.7 more than one match refuses instead of guessing", /v_matches > 1[\s\S]{0,180}'ambiguous_live_targets'/.test(activityFn));
check(
  "8.7a candidate id resolves through a UUID-safe aggregate",
  /min\(t\.id::text\)::uuid/.test(activityFn),
);
check(
  "8.7b bare min(id) on UUID is forbidden (no min(uuid) aggregate exists)",
  !/min\(\s*t?\.?\s*id\s*\)/.test(activityFn),
);
check("8.8 locks the target row", /FOR UPDATE/.test(activityFn));
check("8.9 re-checks LIVE under the lock", /v_status IS DISTINCT FROM 'LIVE'/.test(activityFn));
check("8.10 never counts the card itself or anything before it", /_telegram_message_id <= coalesce\(v_row\.telegram_message_id, 0\)/.test(activityFn));
check("8.11 dedupes Telegram retries by monotonic message id", /_telegram_message_id <= coalesce\(v_row\.last_activity_message_id, 0\)/.test(activityFn));
check("8.12 increments by exactly one", /activity_message_count = activity_message_count \+ 1/.test(activityFn));
check("8.13 advances the dedupe watermark", /last_activity_message_id = _telegram_message_id/.test(activityFn));
check("8.14 threshold is six qualifying messages", /v_count >= 6/.test(activityFn));
check("8.15 cooldown is three minutes", /interval '3 minutes'/.test(activityFn));
check(
  "8.16 cooldown anchors on sent_at, last success and last attempt",
  /GREATEST\(\s*\n?\s*v_row\.sent_at,\s*\n?\s*v_row\.last_resurface_at,\s*\n?\s*v_row\.last_resurface_attempt_at\)/.test(activityFn),
);
check("8.17 CLAIMED and AMBIGUOUS block a new signal", /resurface_state NOT IN \('CLAIMED', 'AMBIGUOUS'\)/.test(activityFn));
check("8.18 returns the bounded signal payload", /'should_resurface', v_should/.test(activityFn));
const ACTIVITY_RETURN_KEYS = ["target_id", "workspace_id", "mission_id", "telegram_chat_id", "activity_message_count"];
for (const key of ACTIVITY_RETURN_KEYS) {
  check(`8.b activity payload exposes ${key}`, activityFn.includes(`'${key}'`));
}
check("8.19 the activity RPC never claims", !/resurface_state\s*=\s*'CLAIMED'/.test(activityFn));
check("8.20 the activity RPC never mints a request id", !/resurface_client_request_id\s*=/.test(activityFn));
check("8.21 the activity RPC writes no cleanup job", !/telegram_message_cleanup_jobs/.test(activityFn));
check("8.22 the activity RPC trusts no user identity", !/telegram_user_id|auth\.uid\(\)|actor/.test(activityFn));

// ---------------------------------------------------------------------------
// 9. Finalizer — privilege posture
// ---------------------------------------------------------------------------

check("9.1 finalizer exists", finalizeFn.length > 0);
check("9.2 finalizer is SECURITY DEFINER", /SECURITY DEFINER/.test(finalizeFn));
check("9.3 finalizer pins search_path to public", /SET search_path TO 'public'/.test(finalizeFn));
check(
  "9.4 finalizer revokes PUBLIC/anon/authenticated",
  /REVOKE ALL ON FUNCTION public\.social_mission_finalize_resurface\(uuid, uuid, bigint, text\) FROM PUBLIC, anon, authenticated;/.test(sql),
);
check(
  "9.5 finalizer grants only service_role and postgres",
  /GRANT EXECUTE ON FUNCTION public\.social_mission_finalize_resurface\(uuid, uuid, bigint, text\) TO service_role, postgres;/.test(sql),
);

// ---------------------------------------------------------------------------
// 10. Finalizer — semantics
// ---------------------------------------------------------------------------

check("10.1 validates both identifiers", /_target_id IS NULL OR _client_request_id IS NULL/.test(finalizeFn));
check("10.2 validates a positive new message id", /_new_message_id IS NULL OR _new_message_id <= 0/.test(finalizeFn));
check("10.3 bounds the rendered text to 1..4096", /char_length\(_message_text\) < 1 OR char_length\(_message_text\) > 4096/.test(finalizeFn));
check("10.4 locks the exact target row by id", /WHERE id = _target_id\s*\n\s*FOR UPDATE/.test(finalizeFn));
check(
  "10.5 replays a matching RESURFACED request without side effects",
  /v_row\.resurface_client_request_id = _client_request_id\s*\n\s*AND v_row\.resurface_state = 'RESURFACED'[\s\S]{0,320}'replayed'/.test(finalizeFn),
);
check(
  "10.6 otherwise requires CLAIMED with the matching request id",
  /v_row\.resurface_state <> 'CLAIMED'\s*\n\s*OR v_row\.resurface_client_request_id IS DISTINCT FROM _client_request_id/.test(finalizeFn),
);
check("10.7 re-checks LIVE before the canonical swap", /v_status IS DISTINCT FROM 'LIVE'[\s\S]{0,140}'not_live'/.test(finalizeFn));
check(
  "10.8 the not_live branch returns before any mutation",
  finalizeFn.indexOf("'not_live'") < finalizeFn.indexOf("INSERT INTO public.telegram_message_cleanup_jobs"),
);
check("10.9 requires a SENT canonical binding", /v_row\.delivery_state <> 'SENT'/.test(finalizeFn));
check("10.10 requires positive existing canonical id", /v_row\.telegram_message_id <= 0/.test(finalizeFn));
check(
  "10.11 requires group connection, chat and workspace",
  /v_row\.group_connection_id IS NULL/.test(finalizeFn) &&
    /v_row\.telegram_chat_id IS NULL/.test(finalizeFn) &&
    /v_row\.workspace_id IS NULL/.test(finalizeFn),
);
check("10.12 refuses when the new id equals the old id", /_new_message_id = v_old_message_id[\s\S]{0,140}'same_message_id'/.test(finalizeFn));
check(
  "10.13 enqueues the OLD id for cleanup with the card kind",
  /INSERT INTO public\.telegram_message_cleanup_jobs[\s\S]{0,400}v_old_message_id,\s*\n?\s*'social_mission_card', 'pending', v_now, v_now\)/.test(finalizeFn),
);
check(
  "10.14 the enqueue is guarded so an existing job is never duplicated or regressed",
  /IF NOT EXISTS \(\s*\n\s*SELECT 1 FROM public\.telegram_message_cleanup_jobs/.test(finalizeFn),
);
check(
  "10.15 enqueue happens before the canonical swap in the same function",
  finalizeFn.indexOf("INSERT INTO public.telegram_message_cleanup_jobs") <
    finalizeFn.indexOf("SET telegram_message_id = _new_message_id"),
);
check("10.16 canonical id is swapped to the new message", /SET telegram_message_id = _new_message_id/.test(finalizeFn));
check("10.17 the authoritative rendered text is stored", /message_text_snapshot = _message_text/.test(finalizeFn));
check("10.18 state becomes RESURFACED", /resurface_state = 'RESURFACED'/.test(finalizeFn));
check("10.19 success timestamp is recorded", /last_resurface_at = v_now/.test(finalizeFn));
check("10.20 the activity counter resets to zero", /activity_message_count = 0/.test(finalizeFn));
check("10.21 the dedupe watermark moves to the new card", /last_activity_message_id = _new_message_id/.test(finalizeFn));
check("10.22 the previous error is cleared", /resurface_last_error = NULL/.test(finalizeFn));
check("10.23 a failed swap aborts the whole call", /RAISE EXCEPTION 'social_mission_finalize_resurface/.test(finalizeFn));
check("10.24 returns the bounded finalized payload", /'outcome', 'finalized'/.test(finalizeFn) && /'old_message_id', v_old_message_id/.test(finalizeFn) && /'new_message_id', _new_message_id/.test(finalizeFn) && /'pinned_by_hq'/.test(finalizeFn));
check("10.25 the finalizer never deletes a Telegram message itself", !/deleteMessage|api\.telegram\.org/i.test(finalizeFn));
check("10.26 the finalizer never deletes a cleanup job row", !/DELETE\s+FROM/i.test(finalizeFn));

// ---------------------------------------------------------------------------
// 11. Global prohibitions
// ---------------------------------------------------------------------------

const grants = [...sql.matchAll(/GRANT[^;]*;/g)].map((m) => m[0]);
check("11.1 exactly two execute grants", grants.length === 2);
check("11.2 no grant reaches anon or authenticated", grants.every((g) => !/\banon\b|\bauthenticated\b/.test(g)));
check("11.3 every function is revoked before it is granted", (sql.match(/REVOKE ALL ON FUNCTION/g) ?? []).length === 2);
check("11.4 exactly two functions are defined", (sql.match(/CREATE OR REPLACE FUNCTION/g) ?? []).length === 2);
check("11.5 no third claim RPC in this unit", !/CLAIMED'\s*,?\s*\n?[\s\S]{0,40}resurface_revision = resurface_revision \+ 1/.test(sql));
check("11.6 no pin or unpin SQL", !/pinMessage|unpinMessage|pinned_by_hq\s*=/i.test(sql));
check("11.7 no Telegram network reference", !/api\.telegram\.org|https?:\/\//i.test(sql));
check("11.8 no X / provider reference", !/twitter|x\.com|bearer|X_API/i.test(sql));
check("11.9 no secret or vault reference", !/vault|service_role_key|SUPABASE_SERVICE/i.test(sql));
check("11.10 no cron scheduling", !/cron\.schedule|net\.http_post/i.test(sql));
check("11.11 no SECURITY INVOKER function", !/SECURITY INVOKER/i.test(sql));
check("11.12 both functions pin an explicit search_path", (sql.match(/SET search_path TO 'public'/g) ?? []).length === 2);

// ---------------------------------------------------------------------------


// ---------------------------------------------------------------------------
// 12. SE-16.3R-2 — replacement transport (`resurface_mission`)
//
// Static assertions over the deployable Edge Function source and its
// byte-identical backend mirror. ZERO network, ZERO database, ZERO Telegram.
// ---------------------------------------------------------------------------

const TRANSPORT_DEPLOY = "supabase/functions/social-mission-telegram/index.ts";
const TRANSPORT_SOURCE = "backend-source/edge-functions/social-mission-telegram/index.ts";

const transport = readFileSync(TRANSPORT_DEPLOY, "utf8");
const transportMirror = readFileSync(TRANSPORT_SOURCE, "utf8");

check("12.1 deployable and source transport copies are byte-identical", transport === transportMirror);

/** The replacement lane only: everything from its banner to end of file. */
const RESURFACE_BANNER = "// resurface_mission — SE-16.3R-2 rolling canonical replacement";
const resurfaceStart = transport.indexOf(RESURFACE_BANNER);
check("12.2 the replacement lane exists and is clearly delimited", resurfaceStart > 0);
const lane = resurfaceStart > 0 ? transport.slice(resurfaceStart) : "";

/** The send and edit lanes, so their behaviour can be proven unchanged. */
const sendLane = transport.slice(
  transport.indexOf("async function handleSend"),
  transport.indexOf("async function handleEdit"),
);
const editLane = transport.slice(transport.indexOf("async function handleEdit"), resurfaceStart);

/** The single dispatch handler body of the replacement action. */
const handler = lane.slice(lane.indexOf("async function handleResurface"));

// --- 12a. Action allowlist -------------------------------------------------

check(
  "12.3 exactly three actions are accepted",
  transport.includes(
    'action !== "send_mission" && action !== "edit_mission" && action !== "resurface_mission"',
  ),
);
const laneGuard =
  transport.match(/if \(action !== "[a-z_]+"(?: && action !== "[a-z_]+")*\) \{/)?.[0] ?? "";
check(
  "12.4 no fourth action is in the allowlist",
  [...laneGuard.matchAll(/"([a-z_]+)"/g)].length === 3,
);
check("12.5 an unsupported action is rejected", transport.includes('return fail("Unsupported action.", 400)'));
check(
  "12.6 replacement dispatch is a single explicit branch",
  (transport.match(/if \(action === "resurface_mission"\) \{/g) ?? []).length === 1,
);
check(
  "12.7 the replacement path requires no caller-supplied revision",
  transport.indexOf('action === "resurface_mission"') < transport.indexOf('const revision = body["revision"]'),
);
check("12.8 the replacement handler never reads a revision input", !handler.includes('body["revision"]'));

// --- 12b. Entry preconditions ---------------------------------------------

check("12.9 mission must be exactly LIVE", /String\(mission\["status"\] \?\? ""\) !== "LIVE"/.test(handler));
check(
  "12.10 target must be exactly SENT with a positive canonical id",
  /String\(t\["delivery_state"\] \?\? ""\) !== "SENT" \|\| oldMessageId === null \|\| oldMessageId <= 0/.test(handler),
);
check(
  "12.11 both preconditions are checked before the duplicate short-circuit",
  handler.indexOf('!== "LIVE"') < handler.indexOf('t["resurface_client_request_id"] === clientRequestId'),
);
check(
  "12.12 the owner/admin gate and row binding still precede the replacement branch",
  transport.indexOf('role !== "owner" && role !== "admin"') < transport.indexOf('action === "resurface_mission"') &&
    transport.indexOf('from("telegram_group_connections")') < transport.indexOf('action === "resurface_mission"'),
);

// --- 12c. Duplicate short-circuit -----------------------------------------

check(
  "12.13 a repeated request id short-circuits on the recorded state",
  /t\["resurface_client_request_id"\] === clientRequestId/.test(handler),
);
check(
  "12.14 the duplicate short-circuit precedes every Telegram call",
  handler.indexOf('t["resurface_client_request_id"] === clientRequestId') <
    handler.indexOf("verifyResurfacePermissions(botToken"),
);
check("12.15 the duplicate response is marked duplicate", /duplicate: true/.test(handler));

// --- 12d. Claim admissibility and compare-and-set --------------------------

check(
  "12.16 only IDLE / RESURFACED / FAILED may start a fresh claim",
  /resurfaceState !== "IDLE" && resurfaceState !== "RESURFACED" && resurfaceState !== "FAILED"/.test(handler),
);
check(
  "12.17 CLAIMED and AMBIGUOUS are refused rather than re-claimed",
  !/resurfaceState === "CLAIMED"[\s\S]{0,200}update\(/.test(handler) &&
    !/resurfaceState !== "AMBIGUOUS"/.test(handler),
);
check(
  "12.18 the claim compare-and-set binds id and workspace",
  /\.eq\("id", targetId\)\s*\n\s*\.eq\("workspace_id", workspaceId\)/.test(handler),
);
check("12.19 the CAS includes the observed resurface state", /\.eq\("resurface_state", resurfaceState\)/.test(handler));
check("12.20 the CAS includes the observed revision", /\.eq\("resurface_revision", currentRevision\)/.test(handler));
check(
  "12.21 the CAS includes the observed canonical message id",
  /\.eq\("telegram_message_id", oldMessageId\)/.test(handler),
);
check("12.22 the claim writes CLAIMED", /resurface_state: "CLAIMED"/.test(handler));
check("12.23 the claim records this request id", /resurface_client_request_id: clientRequestId/.test(handler));
check("12.24 the claim increments the revision by exactly one", /resurface_revision: currentRevision \+ 1/.test(handler));
check("12.25 the claim stamps the attempt time", /last_resurface_attempt_at: new Date\(\)\.toISOString\(\)/.test(handler));
check("12.26 the claim clears the previous error", /resurface_last_error: null/.test(handler));
check(
  "12.27 a zero-row claim stops before Telegram",
  /if \(claimError \|\| !claimedRow\) \{[\s\S]{0,300}Could not claim this card for replacement/.test(handler),
);
check(
  "12.28 the claim precedes the permission preflight",
  handler.indexOf('resurface_state: "CLAIMED"') < handler.indexOf("verifyResurfacePermissions(botToken"),
);

// --- 12e. The fail / ambiguous helper --------------------------------------

const marker = lane.slice(lane.indexOf("async function markResurfaceClaim"), lane.indexOf("async function verifyResurfacePermissions"));
check("12.29 a narrow claim-settling helper exists", marker.length > 0);
check("12.30 the helper only ever writes FAILED or AMBIGUOUS", /nextState: "FAILED" \| "AMBIGUOUS"/.test(marker));
check("12.31 the helper is bound to the exact target and workspace", /\.eq\("id", targetId\)/.test(marker) && /\.eq\("workspace_id", workspaceId\)/.test(marker));
check("12.32 the helper only settles a CLAIMED row", /\.eq\("resurface_state", "CLAIMED"\)/.test(marker));
check("12.33 the helper only settles THIS request's claim", /\.eq\("resurface_client_request_id", clientRequestId\)/.test(marker));
check("12.34 the helper bounds the stored error to 1000 chars", /reason\.slice\(0, 1000\)/.test(marker));
check("12.35 the helper proves persistence by returning a row", /\.select\("id"\)/.test(marker));
for (const forbidden of [
  "telegram_message_id",
  "delivery_state",
  "sent_at",
  "edit_state",
  "edit_revision",
  "transport_kind",
  "pinned_by_hq",
  "message_text_snapshot",
]) {
  check(`12.f the claim helper never writes ${forbidden}`, !new RegExp(`${forbidden}:`).test(marker));
}

// --- 12f. Live permission preflight ----------------------------------------

const preflight = lane.slice(
  lane.indexOf("async function verifyResurfacePermissions"),
  lane.indexOf("async function deleteOneMessage"),
);
check("12.36 a replacement-specific preflight helper exists", preflight.length > 0);
check("12.37 the existing verifyGroup contract is not reused or widened", !handler.includes("verifyGroup("));
check("12.38 verifyGroup itself is unchanged in shape", transport.includes("async function verifyGroup("));
check("12.39 preflight verifies the bot identity", /callTelegram\(token, "getMe"/.test(preflight));
check("12.40 preflight verifies the chat", /callTelegram\(token, "getChat"/.test(preflight));
check("12.41 preflight verifies bot membership", /callTelegram\(token, "getChatMember"/.test(preflight));
check(
  "12.42 the bot must be administrator or creator",
  /status !== "administrator" && status !== "creator"/.test(preflight),
);
check("12.43 a creator implicitly holds every right", /if \(status === "creator"\) return \{ ok: true \}/.test(preflight));
check("12.44 delete permission is required on every replacement", /canDelete === false/.test(preflight));
check(
  "12.45 an unconfirmable delete right is uncertain, not assumed",
  /typeof canDelete !== "boolean"[\s\S]{0,160}definite: false/.test(preflight),
);
check("12.46 pin permission is required only when HQ owns the pin", /if \(requirePin\) \{[\s\S]{0,400}can_pin_messages/.test(preflight));
check(
  "12.47 an unconfirmable pin right is uncertain, not assumed",
  /typeof canPin !== "boolean"[\s\S]{0,160}definite: false/.test(preflight),
);
check(
  "12.48 a definitely missing permission fails the claim",
  /permitted\.definite \? "FAILED" : "AMBIGUOUS"/.test(handler),
);
check(
  "12.49 no card is sent before permissions are confirmed",
  handler.indexOf("verifyResurfacePermissions(botToken") < handler.indexOf('"sendPhoto"') &&
    handler.indexOf("verifyResurfacePermissions(botToken") < handler.indexOf('callTelegram(botToken, "sendMessage"'),
);

// --- 12g. Zero provider reads, LIVE re-read, durable transport kind --------

for (const provider of ["lookupXPostMetrics", "attemptLaunchMetricsRead", "attemptFinalMetricsRead", "X_API_BEARER_TOKEN", "record_social_mission_metric_snapshot"]) {
  check(`12.g the replacement lane performs no provider read: ${provider}`, !lane.includes(provider));
}
check("12.50 the mission is re-read after the claim", /reloadMissionRow\(admin, workspaceId, mission\["id"\]\)/.test(handler));
check(
  "12.51 the re-read must still be LIVE before anything is rendered or sent",
  /String\(refreshedMission\["status"\] \?\? ""\) !== "LIVE"/.test(handler),
);
check(
  "12.52 the LIVE re-read precedes the render and the send",
  handler.indexOf("refreshedMission") < handler.indexOf("renderAuthoritativeCard") &&
    handler.indexOf('String(refreshedMission["status"] ?? "") !== "LIVE"') < handler.indexOf('"sendPhoto"'),
);
check(
  "12.53 the send method comes from the DURABLE transport kind",
  /const transportKind: TransportKind = t\["transport_kind"\] === "PHOTO" \? "PHOTO" : "TEXT"/.test(handler),
);
check(
  "12.54 a PHOTO card whose logo cannot be resolved FAILS before Telegram",
  /if \(transportKind === "PHOTO"\) \{[\s\S]{0,400}if \(!logo\) \{[\s\S]{0,300}"FAILED"/.test(handler),
);
check(
  "12.55 a PHOTO card never silently degrades to TEXT",
  !/logo \? "PHOTO" : "TEXT"/.test(handler) && !/desiredTransportKind/.test(handler),
);
check(
  "12.56 the logo resolution failure happens before any send",
  handler.indexOf("The project logo for this branded card could not be resolved") < handler.indexOf('"sendPhoto"'),
);
check("12.57 the card is rendered by the existing authoritative renderer", /renderAuthoritativeCard\(admin, workspaceId, refreshedMission, transportKind\)/.test(handler));

// --- 12h. Exactly one send, honest outcome classification ------------------

check("12.58 exactly one sendPhoto call in the replacement lane", (handler.match(/"sendPhoto"/g) ?? []).length === 1);
check("12.59 exactly one sendMessage call in the replacement lane", (handler.match(/"sendMessage"/g) ?? []).length === 1);
check(
  "12.60 photo and text sends are mutually exclusive branches",
  /if \(logo\) \{[\s\S]{0,800}"sendPhoto"[\s\S]{0,200}\} else \{[\s\S]{0,400}"sendMessage"/.test(handler),
);
check("12.61 no companion or probe message is sent", (handler.match(/callTelegram\(botToken, "send/g) ?? []).length === 2);
check(
  "12.62 a rejected send FAILS the claim and leaves the old canonical alone",
  /outcome\.kind === "rejected"[\s\S]{0,300}settle\("FAILED", outcome\.description/.test(handler),
);
check(
  "12.63 an uncertain send is AMBIGUOUS with no retry",
  /outcome\.kind === "uncertain"[\s\S]{0,300}settle\("AMBIGUOUS", outcome\.description/.test(handler),
);
check(
  "12.64 a missing or unusable message id is AMBIGUOUS",
  /typeof newMessageIdRaw !== "number" \|\| !Number\.isInteger\(newMessageIdRaw\) \|\| newMessageIdRaw <= 0[\s\S]{0,200}"AMBIGUOUS"/.test(handler),
);
/**
 * Prose may legitimately say "never retried"; executable code may not loop or
 * schedule. Comments are stripped so only real constructs are judged.
 */
const handlerCode = handler
  .replace(/\/\*[\s\S]*?\*\//g, "")
  .replace(/^\s*\/\/.*$/gm, "")
  .replace(/\s\/\/.*$/gm, "");
check(
  "12.65 no automatic retry loop or scheduler exists in the lane",
  !/\bfor\s*\(|\bwhile\s*\(|\bdo\s*\{|setTimeout|setInterval|\.retry\(/.test(handlerCode),
);

// --- 12i. Pin preservation --------------------------------------------------

check("12.66 pin ownership is read from the durable target flag", /const pinnedByHq = t\["pinned_by_hq"\] === true/.test(handler));
check(
  "12.67 pinChatMessage is called only inside the HQ-pin branch",
  /if \(pinnedByHq\) \{[\s\S]{0,600}pinChatMessage/.test(handler) &&
    (handler.match(/pinChatMessage/g) ?? []).length === 1,
);
check("12.68 the new card is pinned silently", /disable_notification: true/.test(handler));
check("12.69 the pin targets the NEW message", /message_id: newMessageId,\s*\n\s*disable_notification: true/.test(handler));
check(
  "12.70 the pin happens before canonical finalization",
  handler.indexOf("pinChatMessage") < handler.indexOf("social_mission_finalize_resurface"),
);
check(
  "12.71 an already-set pin counts as confirmed",
  /isPinAlreadySet\(pinned\.description\)/.test(handler) && /function isPinAlreadySet/.test(lane),
);
check(
  "12.72 an unconfirmed pin withdraws the NEW card, never the old one",
  /if \(!pinConfirmed\) \{[\s\S]{0,300}abandonNewCard/.test(handler),
);
check(
  "12.73 the withdrawal helper only ever deletes the newly sent card",
  /const abandonNewCard = async[\s\S]{0,400}deleteOneMessage\(botToken, chatId, newMessageId\)/.test(handler),
);
check(
  "12.74 a confirmed withdrawal is FAILED, an uncertain one AMBIGUOUS",
  /if \(removal\.retired\) \{[\s\S]{0,200}settle\("FAILED"[\s\S]{0,400}settle\(\s*\n?\s*"AMBIGUOUS"/.test(handler),
);
check("12.75 no unpin call exists anywhere in the lane", !lane.includes("unpinChatMessage"));
check("12.76 pinned_by_hq itself is never rewritten", !/pinned_by_hq:/.test(lane));
check("12.77 a non-pinned target never touches a Telegram pin API", !/pinnedByHq === false[\s\S]{0,200}pinChatMessage/.test(handler));

// --- 12j. Canonical finalization -------------------------------------------

check("12.78 finalization goes through the live service-only RPC", /admin\.rpc\(\s*\n?\s*"social_mission_finalize_resurface"/.test(handler));
check("12.79 the RPC receives the exact target id", /_target_id: targetId/.test(handler));
check("12.80 the RPC receives this request id", /_client_request_id: clientRequestId/.test(handler));
check("12.81 the RPC receives the NEW confirmed message id", /_new_message_id: newMessageId/.test(handler));
check("12.82 the RPC receives the exact authoritative rendered text", /_message_text: rendered\.text/.test(handler));
check(
  "12.83 only finalized or replayed is accepted",
  /finalizeOutcome !== "finalized" && finalizeOutcome !== "replayed"/.test(handler),
);
check(
  "12.84 an RPC error withdraws the NEW card and keeps the OLD canonical",
  /if \(finalizeError \|\| !finalizeData[\s\S]{0,200}abandonNewCard/.test(handler),
);
check(
  "12.85 a non-accepted outcome withdraws the NEW card",
  /finalizeOutcome !== "finalized" && finalizeOutcome !== "replayed"[\s\S]{0,400}abandonNewCard/.test(handler),
);
check("12.86 an RPC exception is contained and withdraws the NEW card", /\} catch \{[\s\S]{0,200}abandonNewCard/.test(handler));
check(
  "12.87 the transport never performs the canonical swap itself",
  !/telegram_message_id: newMessageId/.test(handler) && !/telegram_message_id:/.test(handler),
);

// --- 12k. Old-card retirement ----------------------------------------------

check(
  "12.88 the OLD card is deleted only AFTER an accepted finalization",
  handler.indexOf('finalizeOutcome !== "finalized"') <
    handler.indexOf("deleteOneMessage(botToken, chatId, previousMessageId)"),
);
check(
  "12.89 the OLD message id comes from the finalizer, not the caller",
  /const old = payload\["old_message_id"\]/.test(handler),
);
check("12.90 exactly one delete attempt on the old card", (handler.match(/deleteOneMessage\(botToken, chatId, previousMessageId\)/g) ?? []).length === 1);
check(
  "12.91 a missing old message counts as retired",
  /function isMessageAlreadyGone/.test(lane) && /message to delete not found/.test(lane) && /message_id_invalid/.test(lane),
);
check("12.92 a failed retirement reports cleanupPending instead of rolling back", /cleanupPending = !retired\.retired/.test(handler));
check("12.93 a failed retirement never resends", (handler.match(/callTelegram\(botToken, "send/g) ?? []).length === 2);
check(
  "12.94 the transport never mutates a cleanup job row directly",
  !lane.includes("telegram_message_cleanup_jobs"),
);
check("12.95 the cleanup worker RPC is not called from the transport", !lane.includes("claim_telegram_message_cleanup_jobs"));

// --- 12l. Bounded response --------------------------------------------------

check("12.96 the success response reports RESURFACED", /resurfaceState: "RESURFACED"/.test(handler));
check("12.97 the response carries the durable revision", /resurfaceRevision: revision/.test(handler));
check("12.98 the response carries the new canonical id", /telegramMessageId: newMessageId/.test(handler));
check("12.99 the response carries the previous id", /previousMessageId,/.test(handler));
check("12.100 the response carries the cleanup flag", /cleanupPending,/.test(handler));
for (const leak of ["botToken,", "serviceKey", "outcome.result,", "request.headers", "TELEGRAM_BOT_TOKEN"]) {
  check(`12.l the response never leaks ${leak}`, !new RegExp(`json\\(\\{[^}]*${leak.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}`).test(handler));
}
check("12.101 no raw Telegram payload is returned", !handler.includes("result: outcome.result"));
check("12.102 nothing is logged from the lane", !/console\./.test(lane));

// --- 12m. Existing lanes untouched -------------------------------------------

check("12.103 the send lane still claims SENDING before transport", sendLane.indexOf('delivery_state: "SENDING"') < sendLane.indexOf('"sendPhoto"'));
check("12.104 the send lane still uses the original verifyGroup", sendLane.includes("verifyGroup(botToken, chatId)"));
check("12.105 the send lane has exactly one send of each kind", (sendLane.match(/"sendPhoto"/g) ?? []).length === 1 && (sendLane.match(/"sendMessage"/g) ?? []).length === 1);
check("12.106 the edit lane still edits in place and never sends", !editLane.includes("sendMessage") && !editLane.includes("sendPhoto"));
check("12.107 the edit lane still uses the original verifyGroup", editLane.includes("verifyGroup(botToken, chatId)"));
check("12.108 the edit lane still requires a caller revision", editLane.includes("revision !== currentRevision + 1"));
check("12.109 the replacement lane never touches send or edit state", !/delivery_state:/.test(lane) && !/edit_state:/.test(lane) && !/edit_revision:/.test(lane));
check("12.110 the replacement lane adds no new network host", (lane.match(/https?:\/\//g) ?? []).length === 0);

// ---------------------------------------------------------------------------

console.log(`SE-16.3R regression: ${passed} passed, ${failures.length} failed`);
if (failures.length > 0) {
  for (const failure of failures) console.log(`  FAIL ${failure}`);
  process.exit(1);
}
