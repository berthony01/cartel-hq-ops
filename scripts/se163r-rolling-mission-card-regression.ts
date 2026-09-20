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

console.log(`SE-16.3R-1 regression: ${passed} passed, ${failures.length} failed`);
if (failures.length > 0) {
  for (const failure of failures) console.log(`  FAIL ${failure}`);
  process.exit(1);
}
