/**
 * SE-4B regression — source/SQL/fixture only.
 *
 * ZERO network, ZERO database, ZERO secrets, ZERO Telegram and ZERO X calls.
 * Every assertion is a static source/SQL check or a pure computation over the
 * frozen schedule rules.
 *
 * Run: bun scripts/se4b-mission-lifecycle-pulse-regression.ts
 */

import { readFileSync } from "node:fs";

let passed = 0;
const failures: string[] = [];
function check(name: string, condition: boolean): void {
  if (condition) passed += 1;
  else failures.push(name);
}

const SQL_PATH = "docs/sql/SE4B_mission_lifecycle_pulse.sql";
const RUNNER_PATH = "backend-source/edge-functions/social-mission-runner/index.ts";
const TRANSPORT_PATH = "backend-source/edge-functions/social-mission-telegram/index.ts";
const WEBHOOK_PATH = "supabase/functions/telegram-webhook/index.ts";
const STALE_WEBHOOK_PATH = "backend-source/edge-functions/telegram-webhook/index.ts";
const CLEANUP_WORKER_PATH = "backend-source/edge-functions/telegram-message-cleanup/index.ts";
const DOC_PATH = "docs/SE4B_MISSION_LIFECYCLE_PULSE.md";

const sql = readFileSync(SQL_PATH, "utf8");
const runnerSrc = readFileSync(RUNNER_PATH, "utf8");
const transportSrc = readFileSync(TRANSPORT_PATH, "utf8");
const webhookSrc = readFileSync(WEBHOOK_PATH, "utf8");
const staleWebhookSrc = readFileSync(STALE_WEBHOOK_PATH, "utf8");
const cleanupWorkerSrc = readFileSync(CLEANUP_WORKER_PATH, "utf8");
const docSrc = readFileSync(DOC_PATH, "utf8");

function stripComments(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
}
const runnerCode = stripComments(runnerSrc);
const transportCode = stripComments(transportSrc);
const webhookCode = stripComments(webhookSrc);
const sqlCode = sql.replace(/^\s*--.*$/gm, "");

// ---------------------------------------------------------------------------
// 1. Frozen schedule arithmetic (pure)
// ---------------------------------------------------------------------------

const PULSE_OFFSETS = [3, 8, 15, 25, 35];
const COMPLETE_OFFSET = 45;

function scheduleFrom(sentAtIso: string) {
  const base = new Date(sentAtIso).getTime();
  return {
    pulses: PULSE_OFFSETS.map((m) => new Date(base + m * 60_000).toISOString()),
    complete: new Date(base + COMPLETE_OFFSET * 60_000).toISOString(),
  };
}

const SENT_AT = "2026-09-13T12:00:00.000Z";
const schedule = scheduleFrom(SENT_AT);
check("1.1 exactly five pulse offsets", schedule.pulses.length === 5);
check("1.2 pulse offsets are exactly 3, 8, 15, 25, 35", PULSE_OFFSETS.join(",") === "3,8,15,25,35");
check("1.3 first pulse is sent_at + 3 minutes", schedule.pulses[0] === "2026-09-13T12:03:00.000Z");
check("1.4 last pulse is sent_at + 35 minutes", schedule.pulses[4] === "2026-09-13T12:35:00.000Z");
check("1.5 completion is sent_at + 45 minutes", schedule.complete === "2026-09-13T12:45:00.000Z");
check("1.6 every pulse is strictly before completion", schedule.pulses.every((p) => p < schedule.complete));
check("1.7 pulse offsets are strictly increasing", PULSE_OFFSETS.every((m, i) => i === 0 || m > PULSE_OFFSETS[i - 1]));
check("1.8 the schedule is anchored to sent_at, not command time", scheduleFrom("2026-01-01T00:00:00.000Z").complete === "2026-01-01T00:45:00.000Z");

// ---------------------------------------------------------------------------
// 2. Schedule table shape and isolation
// ---------------------------------------------------------------------------

check("2.1 the single schedule table exists", /CREATE TABLE IF NOT EXISTS public\.social_mission_schedule_events/.test(sqlCode));
check("2.2 no separate pulse table is created", !/CREATE TABLE[^;]*social_mission_pulses/i.test(sqlCode));
check("2.3 no separate completion table is created", !/CREATE TABLE[^;]*social_mission_completions/i.test(sqlCode));
check("2.4 event_type is constrained to PULSE and COMPLETE", /event_type IN \('PULSE', 'COMPLETE'\)/.test(sqlCode));
check("2.5 state is constrained to the six legal values", /state IN \('PENDING', 'CLAIMED', 'SENT', 'FAILED', 'AMBIGUOUS', 'CANCELLED'\)/.test(sqlCode));
check("2.6 default state is PENDING", /state text NOT NULL DEFAULT 'PENDING'/.test(sqlCode));
check("2.7 client_request_id is stored once with a default uuid", /client_request_id uuid NOT NULL DEFAULT gen_random_uuid\(\)/.test(sqlCode));
check("2.8 uniqueness is (target_id, event_type, sequence_no)", /UNIQUE \(target_id, event_type, sequence_no\)/.test(sqlCode));
check("2.9 pulse sequence is 1..5 and completion is 1", /sequence_no BETWEEN 1 AND 5/.test(sqlCode) && /event_type = 'COMPLETE' AND sequence_no = 1/.test(sqlCode));
check("2.10 only a pulse may own a telegram message id", /telegram_message_id IS NULL OR event_type = 'PULSE'/.test(sqlCode));
check("2.11 mission FK is workspace-composite with cascade", /REFERENCES public\.social_missions\(id, workspace_id\)\s*\n\s*ON DELETE CASCADE/.test(sqlCode));
check("2.12 target FK is workspace-composite with cascade", /REFERENCES public\.social_mission_targets\(id, workspace_id\)\s*\n\s*ON DELETE CASCADE/.test(sqlCode));
check("2.13 RLS is enabled and forced", /ALTER TABLE public\.social_mission_schedule_events ENABLE ROW LEVEL SECURITY/.test(sqlCode) && /ALTER TABLE public\.social_mission_schedule_events FORCE ROW LEVEL SECURITY/.test(sqlCode));
check("2.14 authenticated holds SELECT only", /GRANT SELECT ON TABLE public\.social_mission_schedule_events TO authenticated/.test(sqlCode) && !/GRANT[^;]*INSERT[^;]*social_mission_schedule_events TO authenticated/i.test(sqlCode));
check("2.15 anon is revoked", /REVOKE ALL ON TABLE public\.social_mission_schedule_events FROM PUBLIC, anon, authenticated/.test(sqlCode));
check("2.16 the only policy is a member SELECT policy", (sqlCode.match(/CREATE POLICY [a-z_]+\s+ON public\.social_mission_schedule_events/g) ?? []).length === 1 && /FOR SELECT\s*\n\s*TO authenticated/.test(sqlCode));
check("2.17 last_error is bounded", /char_length\(last_error\) <= 1000/.test(sqlCode));
check("2.18 claim indexes exist for the runner queries", /social_mission_schedule_events_due_idx/.test(sqlCode) && /social_mission_schedule_events_claimed_idx/.test(sqlCode));

// ---------------------------------------------------------------------------
// 3. Activation RPC
// ---------------------------------------------------------------------------

check("3.1 activation RPC exists", /FUNCTION public\.activate_social_mission_schedule\(\s*_mission_id uuid,\s*_target_id uuid\s*\)/.test(sqlCode));
check("3.2 activation requires a confirmed SENT delivery", /v_target\.delivery_state <> 'SENT'/.test(sqlCode) && /v_target\.sent_at IS NULL/.test(sqlCode));
check("3.3 activation requires the target to be bound to the mission and workspace", /AND mission_id = _mission_id\s*\n\s*AND workspace_id = v_mission\.workspace_id/.test(sqlCode));
check("3.4 activation requires a LIVE mission", /v_mission\.status <> 'LIVE'/.test(sqlCode));
check("3.5 ends_at is sent_at + 45 minutes", /v_ends := v_target\.sent_at \+ interval '45 minutes'/.test(sqlCode));
check("3.6 an existing started_at is preserved", /started_at = COALESCE\(started_at, v_target\.sent_at\)/.test(sqlCode));
check("3.7 an existing ends_at is preserved", /ends_at = COALESCE\(ends_at, v_ends\)/.test(sqlCode));
check("3.8 seeding is idempotent", (sqlCode.match(/ON CONFLICT \(target_id, event_type, sequence_no\) DO NOTHING/g) ?? []).length >= 3);
check("3.9 the pulse offsets are seeded from the frozen array", /ARRAY\[3, 8, 15, 25, 35\]/.test(sqlCode));
check("3.10 activation is service-role only", /REVOKE ALL ON FUNCTION public\.activate_social_mission_schedule\(uuid, uuid\)\s*\n\s*FROM PUBLIC, anon, authenticated/.test(sqlCode));

// ---------------------------------------------------------------------------
// 4. Claim RPC — database-first completion, no pulse resend
// ---------------------------------------------------------------------------

check("4.1 claim RPC exists", /FUNCTION public\.claim_due_social_mission_schedule_events\(/.test(sqlCode));
check("4.2 claims use FOR UPDATE SKIP LOCKED", (sqlCode.match(/FOR UPDATE SKIP LOCKED/g) ?? []).length >= 2);
check("4.3 a stale CLAIMED pulse becomes AMBIGUOUS, never PENDING", /e\.event_type = 'PULSE'\s*\n\s*AND e\.state = 'CLAIMED'/.test(sqlCode) && /SET state = 'AMBIGUOUS'/.test(sqlCode));
check("4.4 pulses are never returned to PENDING", !/event_type = 'PULSE'[\s\S]{0,400}SET state = 'PENDING'/.test(sqlCode));
check("4.5 claiming COMPLETE transitions the mission to COMPLETED first", /UPDATE public\.social_missions m\s*\n\s*SET status = 'COMPLETED'/.test(sqlCode));
check("4.6 completion sets completed_at idempotently", /completed_at = COALESCE\(m\.completed_at, now\(\)\)/.test(sqlCode));
check("4.7 remaining PENDING pulses are cancelled on completion", /SET state = 'CANCELLED'/.test(sqlCode) && /p\.event_type = 'PULSE'\s*\n\s*AND p\.state = 'PENDING'/.test(sqlCode));
check("4.8 a stale CLAIMED completion is reclaimable after 5 minutes", /e\.state = 'CLAIMED' AND e\.claimed_at IS NOT NULL AND e\.claimed_at < v_stale/.test(sqlCode));
check("4.9 the stale window is 5 minutes", /v_stale timestamptz := now\(\) - interval '5 minutes'/.test(sqlCode));
check("4.10 a second completion event is never created by the claim", !/INSERT INTO public\.social_mission_schedule_events[\s\S]{0,200}'COMPLETE'[\s\S]{0,200}FROM due/.test(sqlCode));
check("4.11 pulses are claimed only while the mission is LIVE and the target SENT", /m\.status = 'LIVE'\s*\n\s*AND t\.delivery_state = 'SENT'/.test(sqlCode));
check("4.12 the claim returns the authoritative binding fields", /e\.client_request_id,/.test(sqlCode) && /t\.telegram_chat_id,/.test(sqlCode) && /t\.telegram_message_id,/.test(sqlCode) && /m\.created_by,/.test(sqlCode) && /p\.canonical_url/.test(sqlCode));
check("4.13 the claim RPC is service-role only", /REVOKE ALL ON FUNCTION public\.claim_due_social_mission_schedule_events\(integer\)/.test(sqlCode));

// ---------------------------------------------------------------------------
// 5. Finalizer — legal transitions only
// ---------------------------------------------------------------------------

check("5.1 finalizer exists", /FUNCTION public\.finish_social_mission_schedule_event\(/.test(sqlCode));
check("5.2 only SENT, FAILED and AMBIGUOUS are accepted", /_state NOT IN \('SENT', 'FAILED', 'AMBIGUOUS'\)/.test(sqlCode));
check("5.3 only a CLAIMED event may be finalized", /AND e\.state = 'CLAIMED';/.test(sqlCode));
check("5.4 AMBIGUOUS can never be returned to PENDING or CLAIMED", !/_state IN \([^)]*'PENDING'/.test(sqlCode) && !/_state = 'CLAIMED'/.test(sqlCode));
check("5.5 last_error is truncated", /left\(_last_error, 1000\)/.test(sqlCode));
check("5.6 the finalizer is service-role only", /REVOKE ALL ON FUNCTION public\.finish_social_mission_schedule_event\(uuid, text, bigint, text\)/.test(sqlCode));

// ---------------------------------------------------------------------------
// 6. Close RPC — re-authorization and single completion
// ---------------------------------------------------------------------------

check("6.1 close RPC exists", /FUNCTION public\.close_social_mission_from_telegram\(\s*_telegram_chat_id bigint,\s*_telegram_user_id bigint\s*\)/.test(sqlCode));
check("6.2 the exact chat binding is re-checked", /FROM public\.telegram_group_connections gc\s*\n\s*WHERE gc\.telegram_chat_id = _telegram_chat_id/.test(sqlCode));
check("6.3 the Telegram user must be linked", /FROM public\.telegram_connections tc\s*\n\s*WHERE tc\.telegram_user_id = _telegram_user_id/.test(sqlCode));
check("6.4 the actor must be a current workspace operator", /public\.is_workspace_operator\(v_workspace_id, v_actor_user_id\)/.test(sqlCode));
check("6.5 the operator helper uses the live two-argument signature", !/is_workspace_operator\(\s*v_workspace_id\s*\)/.test(sqlCode));
check("6.6 at most one LIVE mission for that exact chat is closed", /m\.status = 'LIVE'\s*\n\s*AND t\.telegram_chat_id = _telegram_chat_id/.test(sqlCode) && /LIMIT 1\s*\n\s*FOR UPDATE OF m/.test(sqlCode));
check("6.7 close completes the mission in the database first", /UPDATE public\.social_missions\s*\n\s*SET status = 'COMPLETED'/.test(sqlCode));
check("6.8 close cancels future pending pulses", /SET state = 'CANCELLED',\s*\n\s*finished_at = now\(\)\s*\n\s*WHERE target_id = v_target\.id/.test(sqlCode));
check("6.9 close gets-or-creates exactly one COMPLETE event", /VALUES \(\s*\n\s*v_mission\.workspace_id, v_mission\.id, v_target\.id, 'COMPLETE', 1::smallint, now\(\)\s*\n\s*\)\s*\n\s*ON CONFLICT/.test(sqlCode));
check("6.10 a duplicate close returns the existing completion state", /'outcome', 'ALREADY_COMPLETED'/.test(sqlCode));
check("6.11 close returns the deterministic request id and revision", /'client_request_id', v_event\.client_request_id/.test(sqlCode) && /'edit_revision', COALESCE\(v_target\.edit_revision, 0\)/.test(sqlCode));
check("6.12 close never creates a mission", !/INSERT INTO public\.social_missions/.test(sqlCode));
check("6.13 close is service-role only", /REVOKE ALL ON FUNCTION public\.close_social_mission_from_telegram\(bigint, bigint\)/.test(sqlCode));

// ---------------------------------------------------------------------------
// 7. Cleanup-kind widening; the cleanup worker is untouched
// ---------------------------------------------------------------------------

check("7.1 the widened CHECK allows both kinds", /CHECK \(cleanup_kind IN \('launch_watch_cta', 'social_mission_pulse'\)\)/.test(sqlCode));
check("7.2 launch_watch_cta is preserved", /'launch_watch_cta'/.test(sqlCode));
check("7.3 the cleanup worker source has no mission-specific logic", !cleanupWorkerSrc.includes("social_mission") && !cleanupWorkerSrc.includes("mission_pulse"));
check("7.4 no cleanup job table is recreated", !/CREATE TABLE[^;]*telegram_message_cleanup_jobs/i.test(sqlCode));

// ---------------------------------------------------------------------------
// 8. Scheduler secret, invoke function, cron
// ---------------------------------------------------------------------------

check("8.1 the Vault secret is created only when missing", /IF NOT EXISTS \(SELECT 1 FROM vault\.secrets WHERE name = 'social_mission_scheduler_secret'\)/.test(sqlCode));
check("8.2 the secret value is generated inside the database", /vault\.create_secret\(\s*\n\s*encode\(extensions\.gen_random_bytes\(32\), 'hex'\)/.test(sqlCode));
check("8.3 no literal secret value is embedded", !/social_mission_scheduler_secret'\s*,\s*'[A-Za-z0-9+/=]{16,}'/.test(sqlCode));
check("8.4 the secret-match RPC reads vault.decrypted_secrets", /FUNCTION public\.social_mission_scheduler_secret_matches\(p_secret text\)/.test(sqlCode) && /FROM vault\.decrypted_secrets/.test(sqlCode));
check("8.5 the secret-match RPC is not callable by the browser", /REVOKE ALL ON FUNCTION public\.social_mission_scheduler_secret_matches\(text\)\s*\n\s*FROM PUBLIC, anon, authenticated/.test(sqlCode));
check("8.6 the invoke function posts through pg_net to the authoritative project URL", /net\.http_post\(/.test(sqlCode) && /https:\/\/ocoinbnjgstkmnwwvnhi\.supabase\.co\/functions\/v1\/social-mission-runner/.test(sqlCode));
check("8.7 the scheduler header name matches the runner", /'x-cartel-social-mission-scheduler-secret', v_secret/.test(sqlCode) && runnerCode.includes('"x-cartel-social-mission-scheduler-secret"'));
check("8.8 cron registration is idempotent and one-minute", /WHERE jobname = 'cartel-social-mission-runner'/.test(sqlCode) && /'\* \* \* \* \*'/.test(sqlCode));
check("8.9 no existing cron job is altered", !/cron\.unschedule/.test(sqlCode) && !/cartel-telegram-message-cleanup-runner/.test(sqlCode) && !/cartel-launch-notifications-runner/.test(sqlCode));

// ---------------------------------------------------------------------------
// 9. Runner behaviour
// ---------------------------------------------------------------------------

check("9.1 the runner authenticates through the DB secret RPC", runnerCode.includes('"social_mission_scheduler_secret_matches"'));
check("9.2 an invalid secret is rejected with 401", /secretError \|\| secretOk !== true/.test(runnerCode) && runnerCode.includes('json({ error: "Unauthorized" }, 401)'));
check("9.3 the presented secret is never logged or returned", !/console\.(log|error|warn)\([^)]*presented/.test(runnerCode) && !/presented[^;]*json\(/.test(runnerCode));
check("9.4 the runner never logs anything at all", !/console\./.test(runnerCode));
// SE-6 re-pin: pulses are threshold crossings, sent by the shared ephemeral
// sender. Still exactly one sendMessage, never sendPhoto.
check("9.5 a pulse is sent with sendMessage", /callTelegram\(botToken, "sendMessage"/.test(runnerCode) && !/"sendPhoto"/.test(runnerCode));
check("9.6 the runner never calls sendPhoto", !runnerCode.includes("sendPhoto"));
check("9.7 the runner never calls editMessageCaption or editMessageText directly", !runnerCode.includes("editMessageCaption") && !runnerCode.includes("editMessageText"));
check("9.8 the pulse replies to the canonical mission card", /reply_to_message_id: row\.telegram_message_id/.test(runnerCode));
check("9.9 the pulse carries an OPEN ON X button from the authoritative canonical URL", runnerCode.includes('text: "OPEN ON X"') && /pulseKeyboard\(row\.canonical_url\)/.test(runnerCode));
check("9.10 the OPEN ON X button is omitted when the URL is not a canonical X status link", /isCanonicalXStatusUrl\(canonicalUrl\)/.test(runnerCode));
check("9.11 the pulse cleanup job uses the new cleanup kind", /cleanup_kind: "social_mission_pulse"/.test(runnerCode));
check("9.12 the pulse lifetime is 120 seconds", /PULSE_LIFETIME_SECONDS = 120/.test(runnerCode) && /PULSE_LIFETIME_SECONDS \* 1000/.test(runnerCode));
check("9.13 a pulse with no durable cleanup is deleted immediately", /cleanup_kind: "social_mission_pulse"[\s\S]{0,400}"deleteMessage"/.test(runnerCode));
check("9.14 an uncertain pulse outcome is finalized AMBIGUOUS", /_state: "AMBIGUOUS"/.test(runnerCode));
check("9.15 a definite rejection is finalized FAILED", /_state: "FAILED"/.test(runnerCode));
// SE-5 re-pin: the runner now also performs one official metrics lookup per
// batch. The frozen rule is unchanged — nothing is ever re-attempted inside a
// single invocation.
check("9.16 the runner contains no retry loop", !/while\s*\(/.test(runnerCode) && !/setTimeout/.test(runnerCode) && !/\bretry\(|retryCount|maxRetries/i.test(runnerCode));
check("9.17 completion uses edit_mission only, never send_mission", runnerCode.includes('action: "edit_mission"') && !runnerCode.includes('"send_mission"'));
check("9.18 completion sends the runner internal source header", runnerCode.includes('"X-Cartel-Internal-Source": INTERNAL_SOURCE_HEADER_VALUE') && runnerCode.includes('INTERNAL_SOURCE_HEADER_VALUE = "social-mission-runner"'));
check("9.19 completion uses the service bearer and created_by actor", /Authorization: `Bearer \$\{SERVICE_KEY\}`/.test(runnerCode) && /"X-Cartel-Actor-User-Id": event\.mission_created_by/.test(runnerCode));
check("9.20 completion uses the stored deterministic request id", /clientRequestId: event\.client_request_id/.test(runnerCode));
check("9.21 completion bumps the revision by exactly one", /revision: Number\(event\.edit_revision \?\? 0\) \+ 1/.test(runnerCode));
check("9.22 a duplicate EDITED result counts as success", /editState === "EDITED"/.test(runnerCode));
// SE-5 re-pin: the runner may READ `social_missions.accomplished_at` for the
// pulse text. It still never writes mission status; lifecycle stays in the RPCs.
check("9.23 the runner never writes mission status directly", !/from\("social_missions"\)[\s\S]{0,200}\.(update|insert|upsert|delete)\(/.test(runnerCode) && !/status:\s*"(LIVE|COMPLETED)"/.test(runnerCode));
check("9.24 the runner makes zero X/provider calls", !/api\.twitter\.com|api\.x\.com|googleapis|refetcher/i.test(runnerSrc));
check("9.25 the only Telegram host is the fixed official API", /TELEGRAM_API = "https:\/\/api\.telegram\.org"/.test(runnerCode) && (runnerCode.match(/https:\/\/api\.telegram\.org/g) ?? []).length === 1);
check("9.26 429 and 5xx are treated as uncertain, never definite", /response\.status === 429 \|\| response\.status >= 500/.test(runnerCode));
check("9.27 the pulse copy promises no reward, quota or mandatory engagement", !/point|reward|quota|streak|must like|must repost|airdrop/i.test(runnerCode.match(/PULSE_TEXT =[\s\S]*?;/)?.[0] ?? ""));
check("9.28 the pulse copy states the mission is still active", /still active/.test(runnerSrc));
check("9.29 the runner rejects non-POST calls", /request\.method !== "POST"/.test(runnerCode));

// ---------------------------------------------------------------------------
// 10. Transport internal-source allowlist (both callers, no weakening)
// ---------------------------------------------------------------------------

check("10.1 the webhook internal source constant is preserved", transportCode.includes('const INTERNAL_SOURCE = "telegram-webhook"'));
check("10.2 the runner internal source constant is added", transportCode.includes('const INTERNAL_SOURCE_RUNNER = "social-mission-runner"'));
check("10.3 the allowlist contains exactly those two callers", /INTERNAL_SOURCES: readonly string\[\] = \[INTERNAL_SOURCE, INTERNAL_SOURCE_RUNNER\]/.test(transportCode));
check("10.3b the internal check is a single exact allowlist expression", transportCode.includes("const isInternalCaller = INTERNAL_SOURCES.includes(internalSource) && bearerToken === serviceKey;"));
check("10.4 every internal caller still needs the exact service bearer", (transportCode.match(/bearerToken === serviceKey/g) ?? []).length >= 1 && !/isInternalCaller = true/.test(transportCode));
check("10.5 the internal actor must still be a UUID", /uuid\(request\.headers\.get\("X-Cartel-Actor-User-Id"\)\)/.test(transportCode));
check("10.6 the JWT path is unchanged", transportCode.includes("const authClient = createClient(supabaseUrl, anonKey"));
check("10.7 the owner/admin membership gate is still applied to every caller", /workspace_members/.test(transportCode));
check("10.8 no third internal source exists", (transportCode.match(/INTERNAL_SOURCE_[A-Z]+ = "/g) ?? []).length === 1);

// ---------------------------------------------------------------------------
// 11. Webhook: activation, /mission close, help copy
// ---------------------------------------------------------------------------

check("11.1 activation runs only after a confirmed SENT delivery", /transportState === "SENT"[\s\S]{0,400}activate_social_mission_schedule/.test(webhookCode));
check("11.2 activation is called exactly once", (webhookCode.match(/activate_social_mission_schedule/g) ?? []).length === 1);
check("11.3 a failed activation never resends the mission card", !/activateError[\s\S]{0,400}action: "send_mission"/.test(webhookCode));
check("11.4 a failed activation replies with a concise admin diagnostic", webhookSrc.includes("45-minute schedule could not be activated"));
check("11.5 the close branch exists", /const isClose = String\(argument \?\? ""\)\.trim\(\)\.toLowerCase\(\) === "close"/.test(webhookCode));
check("11.6 close reads no X link", /const parsed = isClose \? null : parseXStatusUrl\(argument\)/.test(webhookCode));
check("11.7 close runs after the same connected-group, linked-account and operator checks", webhookCode.indexOf("if (isClose) {") > webhookCode.indexOf('admin.rpc("is_workspace_operator"'));
check("11.8 close runs after the live Telegram administrator check", webhookCode.indexOf("if (isClose) {") > webhookCode.indexOf('memberStatus !== "administrator"'));
check("11.9 close calls the close RPC", /admin\.rpc\("close_social_mission_from_telegram"/.test(webhookCode));
check("11.10 close makes exactly one edit_mission transport call", (webhookCode.match(/action: "edit_mission"/g) ?? []).length === 1);
check("11.11 close uses the deterministic request id returned by the RPC", /clientRequestId: closeResult\.client_request_id/.test(webhookCode));
check("11.12 close bumps the revision by exactly one", /revision: Number\(closeResult\.edit_revision \?\? 0\) \+ 1/.test(webhookCode));
check("11.13 a failed close edit never sends a replacement message", /could not be updated in place; do not resend/.test(webhookSrc));
check("11.14 a failed close edit never reverts completion", !/close[\s\S]{0,600}status: "LIVE"/.test(webhookCode));
check("11.15 no active mission is reported plainly", webhookSrc.includes("There is no active Social Mission in this community."));
check("11.16 group help documents /mission close", webhookSrc.includes("/mission close — close the active Social Mission (admins only)"));
check("11.17 the original /mission help line is preserved", webhookSrc.includes("/mission &lt;X link&gt; — start a Social Mission (admins only)"));
check("11.18 the webhook still makes zero X API calls", !/api\.twitter\.com|api\.x\.com/i.test(webhookSrc));
check("11.19 the stale backend-source webhook copy was NOT modified", !staleWebhookSrc.includes("close_social_mission_from_telegram") && !staleWebhookSrc.includes("activate_social_mission_schedule"));

// ---------------------------------------------------------------------------
// 12. Phase boundary
// ---------------------------------------------------------------------------

for (const [index, forbidden] of ["ACCOMPLISHED", "/mission refresh", "/mission latest"].entries()) {
  check(`12.${index + 1} ${forbidden} is absent from SQL`, !sqlCode.includes(forbidden));
  // SE-5 re-pin: ACCOMPLISHED is a derived PRODUCT state rendered in the card
  // and the pulse. It must still never be a database mission status.
  check(
    `12.${index + 1}b ${forbidden} is not a runner mission status`,
    forbidden === "ACCOMPLISHED"
      ? !/status[^\n]{0,20}ACCOMPLISHED/.test(runnerCode)
      : !runnerCode.includes(forbidden),
  );
  check(`12.${index + 1}c ${forbidden} is absent from the webhook`, !webhookCode.includes(forbidden));
}
check("12.4 no contributor recognition, points or billing in this phase", !/contributor_badge|points_awarded|billing/i.test(runnerCode + sqlCode));
// SE-5 re-pin: stored snapshots are now read and written by the metrics phase.
// The frozen rule that survives is that the PULSE path never fetches.
// SE-6 re-pin: the pulse body comes from the DB crossing evaluation over
// stored snapshots, never from a provider read taken at send time.
check("12.5 the pulse text is built only from a stored snapshot", /buildCrossingPulseText\(crossings\)/.test(runnerCode) && /evaluate_social_mission_pulse/.test(runnerCode) && !/lookupXPostMetrics[\s\S]{0,200}sendEphemeralMissionMessage/.test(runnerCode));
check("12.6 the documentation exists and states the DB-first completion rule", docSrc.includes("COMPLETED") && /database[- ]first/i.test(docSrc));
check("12.7 the documentation records that the SQL is prepare-only", /prepare[- ]only/i.test(docSrc) && /PREPARE ONLY/i.test(sql));

// ---------------------------------------------------------------------------
// 13. SE-4B hardening pass
// ---------------------------------------------------------------------------

// 13.1-13.5 invocation-scoped claims
check("13.1 claim ownership is accumulated in a local array", /v_claimed uuid\[\] := ARRAY\[\]::uuid\[\]/.test(sqlCode));
check("13.2 both claiming UPDATEs RETURN their own ids", (sqlCode.match(/claimed AS \(\s*\n\s*UPDATE public\.social_mission_schedule_events e[\s\S]{0,300}RETURNING e\.id\s*\n\s*\)/g) ?? []).length === 2);
check("13.3 the claimed ids are aggregated into the invocation batch", (sqlCode.match(/SELECT COALESCE\(array_agg\(claimed\.id\), ARRAY\[\]::uuid\[\]\) INTO v_batch FROM claimed;/g) ?? []).length === 2 && (sqlCode.match(/v_claimed := v_claimed \|\| v_batch;/g) ?? []).length === 2);
check("13.4 only this invocation's own claims are returned", /WHERE e\.id = ANY\(v_claimed\)/.test(sqlCode));
check("13.5 ownership is never inferred from a timestamp window", !/claimed_at >= now\(\) - interval '30 seconds'/.test(sqlCode) && !/claimed_at >= now\(\)/.test(sqlCode));
check("13.6 SKIP LOCKED is preserved on both claim queries", (sqlCode.match(/FOR UPDATE SKIP LOCKED/g) ?? []).length === 2);
check("13.7 an empty batch returns no rows", /IF array_length\(v_claimed, 1\) IS NULL THEN\s*\n\s*RETURN;/.test(sqlCode));
check("13.8 reclaiming a stale completion never rewrites client_request_id", !/SET[^;]*client_request_id\s*=/.test(sqlCode));
check("13.9 the claim never inserts a schedule event", !/claim_due_social_mission_schedule_events[\s\S]*?INSERT INTO public\.social_mission_schedule_events[\s\S]*?finish_social_mission_schedule_event/.test(sqlCode));

// 13.10-13.16 close terminal-state safety and actor
check("13.10 a CLAIMED completion returns UNRESOLVED without a state change", /IF v_event\.state = 'CLAIMED' THEN[\s\S]{0,400}'outcome', 'UNRESOLVED'/.test(sqlCode));
check("13.11 FAILED, AMBIGUOUS and CANCELLED are terminal for close", /IF v_event\.state IN \('FAILED', 'AMBIGUOUS', 'CANCELLED'\) THEN[\s\S]{0,400}'outcome', 'COMPLETED_UNSYNCED'/.test(sqlCode));
check("13.12 only a PENDING completion event may be claimed by close", /IF v_event\.state <> 'PENDING' THEN/.test(sqlCode) && /WHERE id = v_event\.id\s*\n\s*AND state = 'PENDING';/.test(sqlCode));
check("13.13 close never unconditionally reopens an event", !/WHERE id = v_event\.id;/.test(sqlCode));
check("13.14 manual close is attributed to the current authorized closer", /'actor_user_id', v_actor_user_id/.test(sqlCode) && !/'actor_user_id', COALESCE\(v_mission\.created_by/.test(sqlCode));
check("13.15 automatic completion still uses mission.created_by", /m\.created_by,/.test(sqlCode) && /"X-Cartel-Actor-User-Id": event\.mission_created_by/.test(runnerCode));
check("13.16 the runner fails closed when created_by is missing", /!event\.mission_created_by[\s\S]{0,200}_state: "FAILED"/.test(runnerCode));

// 13.17-13.22 manual-close finalizer
check("13.17 close returns the event id", /'event_id', v_event\.id/.test(sqlCode));
check("13.18 the webhook close result carries event_id", /event_id\?: string;/.test(webhookCode));
check("13.19 the webhook finalizes its own completion event exactly once", (webhookCode.match(/finish_social_mission_schedule_event/g) ?? []).length === 1);
check("13.20 EDITED maps to SENT, FAILED to FAILED, everything else to AMBIGUOUS", /closeEditState === "EDITED" \? "SENT" : closeEditState === "FAILED" \? "FAILED" : "AMBIGUOUS"/.test(webhookCode));
check("13.21 a finalizer failure never triggers a second Telegram attempt", (webhookCode.match(/action: "edit_mission"/g) ?? []).length === 1 && /finalizedOk[\s\S]{0,400}delivery record could not be saved/.test(webhookCode));
check("13.22 the webhook handles UNRESOLVED and COMPLETED_UNSYNCED without retrying", webhookCode.includes('closeResult.outcome === "UNRESOLVED"') && webhookCode.includes('closeResult.outcome === "COMPLETED_UNSYNCED"'));

// 13.23-13.28 pulse hardening
check("13.23 a pulse never falls back to a non-reply message", !runnerCode.includes("allow_sending_without_reply"));
// SE-6 re-pin: a legacy scheduled PULSE row is retired to CANCELLED and is
// never delivered or reposted.
check("13.24 a legacy scheduled pulse is retired, never reposted", /event_type === "PULSE"[\s\S]{0,600}retire_legacy_social_mission_pulse_event/.test(runnerCode) && !/event_type === "PULSE"[\s\S]{0,1200}sendMessage/.test(runnerCode));
check("13.25 the pulse URL validator is narrow and pure", /export function isCanonicalXStatusUrl/.test(runnerCode) && /url\.username \|\| url\.password \|\| url\.port/.test(runnerCode));
check("13.26 the pulse URL validator pins the exact X hosts", /PULSE_X_HOSTS = \["x\.com", "www\.x\.com", "twitter\.com", "www\.twitter\.com", "mobile\.twitter\.com"\]/.test(runnerCode));
check("13.27 the pulse URL validator requires handle/status/numeric-id", /segments\.length !== 3/.test(runnerCode) && /!== "status"/.test(runnerCode) && /\^\[0-9\]\{1,32\}\$/.test(runnerCode));
const validatorBody = runnerCode.match(/export function isCanonicalXStatusUrl[\s\S]*?\n}\n/)?.[0] ?? "";
check("13.28 the pulse URL validator makes no network call", validatorBody.length > 0 && !/fetch\(|await /.test(validatorBody));

// pure behaviour of the mirrored validator
const PULSE_X_HOSTS = ["x.com", "www.x.com", "twitter.com", "www.twitter.com", "mobile.twitter.com"];
function isCanonicalXStatusUrl(value: unknown): value is string {
  if (typeof value !== "string") return false;
  const raw = value.trim();
  if (!raw || raw.length > 2048) return false;
  let url: URL;
  try { url = new URL(raw); } catch { return false; }
  if (url.protocol !== "https:") return false;
  if (url.username || url.password || url.port) return false;
  if (!PULSE_X_HOSTS.includes(url.hostname.toLowerCase())) return false;
  const segments = url.pathname.split("/").filter((segment) => segment.length > 0);
  if (segments.length !== 3) return false;
  const handle = String(segments[0]).toLowerCase();
  if (!/^[a-z0-9_]{1,15}$/.test(handle) || handle === "i") return false;
  if (String(segments[1]).toLowerCase() !== "status") return false;
  return /^[0-9]{1,32}$/.test(String(segments[2]));
}
check("13.29 a canonical X status URL is accepted", isCanonicalXStatusUrl("https://x.com/pepecarteltoken/status/2098827349470961903"));
check("13.30 an arbitrary https URL is refused", !isCanonicalXStatusUrl("https://evil.com/anything"));
check("13.31 an X profile URL without a status is refused", !isCanonicalXStatusUrl("https://x.com/pepecarteltoken"));
check("13.32 a lookalike host is refused", !isCanonicalXStatusUrl("https://x.com.evil.com/a/status/1"));
check("13.33 credentials and ports are refused", !isCanonicalXStatusUrl("https://u:p@x.com/a/status/1") && !isCanonicalXStatusUrl("https://x.com:8443/a/status/1"));
check("13.34 http is refused", !isCanonicalXStatusUrl("http://x.com/a/status/1"));
check("13.35 a non-numeric status id is refused", !isCanonicalXStatusUrl("https://x.com/a/status/abc"));

// 13.36-13.39 SQL precision
check("13.36 only the exact live cleanup constraint is dropped", /DROP CONSTRAINT IF EXISTS telegram_message_cleanup_jobs_cleanup_kind_check;/.test(sqlCode));
check("13.37 the widened constraint drop makes the migration rerunnable", /DROP CONSTRAINT IF EXISTS telegram_message_cleanup_jobs_cleanup_kind_ck;/.test(sqlCode));
check("13.38 no loop drops arbitrary cleanup_kind checks", !/pg_get_constraintdef\(oid\) ILIKE '%cleanup_kind%'/.test(sqlCode));
check("13.39 random bytes are schema-qualified to extensions", /extensions\.gen_random_bytes\(32\)/.test(sqlCode) && !/[^.]\bgen_random_bytes\(32\)/.test(sqlCode.replace(/extensions\.gen_random_bytes\(32\)/g, "")));

// ---------------------------------------------------------------------------

console.log(`SE-4B regression: ${passed} passed, ${failures.length} failed`);
if (failures.length > 0) {
  for (const failure of failures) console.log(`  FAIL ${failure}`);
  process.exit(1);
}
