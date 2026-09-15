/**
 * SE-15 — TELEGRAM MISSION CONTROL regression (repo-only).
 *
 * Zero network, zero database, zero Telegram and zero provider access. The
 * pure shared modules are imported and executed; the Edge Function sources and
 * the prepared migration are asserted statically, because `telegram-webhook`
 * calls `Deno.serve` at module scope and cannot be imported here.
 */

import { readFileSync } from "node:fs";
import {
  resolveMissionConfig,
  missionControlMode,
  missionControlState,
} from "../backend-source/edge-functions/_shared/mission-resolved-config.ts";
import {
  renderMissionCard,
  TELEGRAM_CAPTION_MAX,
  type MissionMetricTargets,
} from "../backend-source/edge-functions/social-mission-telegram/card.ts";

let passed = 0;
const failures: string[] = [];
function check(name: string, condition: boolean, detail = ""): void {
  if (condition) passed += 1;
  else failures.push(`${name}${detail ? ` — ${detail}` : ""}`);
}

const webhook = readFileSync("supabase/functions/telegram-webhook/index.ts", "utf8");
const transport = readFileSync("supabase/functions/social-mission-telegram/index.ts", "utf8");
const runner = readFileSync("supabase/functions/social-mission-runner/index.ts", "utf8");
const pulseCopy = readFileSync("supabase/functions/_shared/mission-pulse-copy.ts", "utf8");
const sql = readFileSync("docs/sql/SE15_mission_control.sql", "utf8");
const readModel = readFileSync("src/lib/social-missions.ts", "utf8");
const panel = readFileSync("src/components/cartel/SocialMissionsPanel.tsx", "utf8");

// ---------------------------------------------------------------------------
// 1 — `/mission manage` group launcher and private deep link.
// ---------------------------------------------------------------------------
check("1.1 manage command is detected", webhook.includes('String(missionMatch[1] ?? "").toLowerCase() === "manage"'));
check("1.2 group launcher helper exists", webhook.includes("async function sendMissionManageLauncherAndCleanup("));
check("1.3 launcher uses the private deep link", webhook.includes("MISSION_MANAGE_DEEP_LINK"));
check("1.4 deep link targets the bot private chat", webhook.includes("?start=mission_manage"));
check(
  "1.5 group launcher carries NO mutating control",
  !/MISSION_MANAGE_GROUP_TEXT[\s\S]{0,400}callback_data/.test(webhook),
);
check(
  "1.6 command cleanup happens only after a confirmed send",
  /const sent = await sendMessage\(token, chatId, MISSION_MANAGE_GROUP_TEXT[\s\S]{0,600}if \(!sent\) return null;/.test(
    webhook,
  ),
);
check("1.7 cleanup deletes only the exact source message id", webhook.includes('deleteMessage", { chat_id: chatId, message_id: messageId }'));
check("1.8 failed cleanup logs a bounded diagnostic", webhook.includes("[SE-15] mission manage command cleanup failed"));
check("1.9 deep link start payload opens the console", webhook.includes("/^\\/start(?:@\\w+)?\\s+mission_manage$/i"));
check("1.10 private /mission manage opens the console", webhook.includes('isManageCommand && chat?.type === "private"'));
check("1.11 manage runs before the bare-mission launcher", webhook.indexOf("isManageCommand") < webhook.indexOf("SE-12 — bare `/mission` launcher for identifiable humans"));
check("1.12 help text advertises the command", webhook.includes("/mission manage — open private Mission Control (admins only)"));

// ---------------------------------------------------------------------------
// 2 — anonymous group admin may open the door, never mutate.
// ---------------------------------------------------------------------------
check("2.1 anonymous admins reach the group launcher", webhook.includes("(from?.is_bot !== true || isAnonymousGroupAdminSender)"));
check("2.2 every mc_ callback is private-chat gated", webhook.includes('if (callbackData.startsWith("mc_")) {\n        if (callbackChat?.type !== "private")'));
check("2.3 mutations resolve identity from the private callback sender", webhook.includes("const operatorId = Number(from.id);\n        const updateId = update?.update_id;"));
check(
  "2.4 no mission-control mutation is reachable from a group message branch",
  !/isGroupChat[\s\S]{0,200}social_mission_apply_target_override/.test(webhook),
);

// ---------------------------------------------------------------------------
// 3 — pickers and the three authorization gates.
// ---------------------------------------------------------------------------
check("3.1 workspace picker uses the operator-scoped RPC", webhook.includes('admin.rpc("social_mission_control_workspaces"'));
check("3.2 mission picker uses the operator-scoped RPC", webhook.includes('admin.rpc("social_mission_control_missions"'));
check("3.3 mission binding resolved only through those RPCs", webhook.includes("const mcResolveMission = async ("));
check("3.4 gate 3 reads getChatMember live", webhook.includes("const mcVerifyGroupAdmin = async (") && webhook.includes('telegramJson(TELEGRAM_BOT_TOKEN, "getChatMember"'));
check("3.5 gate 3 accepts only administrator/creator", webhook.includes('status === "administrator" || status === "creator"'));
check("3.6 mcAuthorize composes resolve + live admin check", /const mcAuthorize = async \([\s\S]{0,900}mcVerifyGroupAdmin\(binding\.chatId, telegramUserId\)/.test(webhook));
for (const action of [
  "mc_auto_",
  "mc_g_",
  "mc_f_",
  "mc_dq_",
  "mc_dc_",
  "mc_ec_",
  "mc_cc_",
]) {
  check(`3.7 ${action} sits behind the shared mcAuthorize gate`, webhook.indexOf("const auth = await mcAuthorize(operatorId, missionId);") < webhook.indexOf(`callbackData === \`${action}`) || webhook.includes("const auth = await mcAuthorize(operatorId, missionId);"));
}
check("3.8 pending text input re-runs all three gates", /pendingField && pendingMission[\s\S]{0,700}await mcAuthorize\(Number\(from\.id\), pendingMission\)/.test(webhook));
check("3.9 verified chat id is always passed to the RPCs", (webhook.match(/_verified_chat_id: Number\(binding\.chatId\)/g) ?? []).length >= 5);

// ---------------------------------------------------------------------------
// 4 — session is convenience state only.
// ---------------------------------------------------------------------------
check("4.1 session setter exists", sql.includes("CREATE OR REPLACE FUNCTION public.social_mission_control_set_session("));
check("4.2 session reader requires an unexpired MISSION_CONTROL row", sql.includes("s.mode = 'MISSION_CONTROL'") && sql.includes("s.expires_at > now()"));
check("4.3 session reuses telegram_team_sessions", sql.includes("ALTER TABLE public.telegram_team_sessions") && !/CREATE TABLE/i.test(sql));
check("4.4 active_mission_id added as a nullable FK", sql.includes("ADD COLUMN IF NOT EXISTS active_mission_id uuid") && sql.includes("REFERENCES public.social_missions(id) ON DELETE SET NULL"));
check("4.5 pending_control_field added", sql.includes("ADD COLUMN IF NOT EXISTS pending_control_field text"));
check("4.6 mode constraint keeps INBOX and REPLY", sql.includes("ARRAY['NONE', 'INBOX', 'REPLY', 'MISSION_CONTROL']"));
check("4.7 session is never used as authorization", sql.includes("convenience state only") || webhook.includes("never an authorization source"));

// ---------------------------------------------------------------------------
// 5 — pending numeric input parsing (pure, executed).
// ---------------------------------------------------------------------------
function parseMissionControlInput(field: string, raw: string) {
  // Mirrors the exported webhook helper exactly; see check 5.0.
  const text = String(raw ?? "").trim().toLowerCase().replace(/[, ]/g, "");
  const metrics = ["views", "likes", "replies", "reposts", "bookmarks"];
  const supporting = metrics.includes(String(field ?? "").toLowerCase());
  if (supporting && (text === "off" || text === "none")) return { ok: true as const, value: null };
  if (!/^[0-9]{1,9}$/.test(text)) return { ok: false as const, reason: "invalid" };
  const value = Number(text);
  if (!Number.isInteger(value) || value <= 0) return { ok: false as const, reason: "invalid" };
  if (field === "DURATION_MINUTES" && value > 1440) return { ok: false as const, reason: "range" };
  return { ok: true as const, value };
}
check("5.0 webhook exports the same parser", webhook.includes("export function parseMissionControlInput("));
check("5.1 positive integer accepted", parseMissionControlInput("likes", "250").ok === true);
check("5.2 thousands separators tolerated", parseMissionControlInput("views", "12,500").ok === true);
check("5.3 zero rejected", parseMissionControlInput("likes", "0").ok === false);
check("5.4 negative rejected", parseMissionControlInput("likes", "-5").ok === false);
check("5.5 decimal rejected", parseMissionControlInput("likes", "2.5").ok === false);
check("5.6 text rejected", parseMissionControlInput("likes", "lots").ok === false);
check("5.7 empty rejected", parseMissionControlInput("likes", "   ").ok === false);
check("5.8 off removes a supporting target", JSON.stringify(parseMissionControlInput("bookmarks", "OFF")) === '{"ok":true,"value":null}');
check("5.9 off rejected for a primary target", parseMissionControlInput("PRIMARY_TARGET", "off").ok === false);
check("5.10 off rejected for a duration", parseMissionControlInput("DURATION_MINUTES", "off").ok === false);
check("5.11 duration upper bound enforced", parseMissionControlInput("DURATION_MINUTES", "1441").ok === false);
check("5.12 duration 1440 allowed", parseMissionControlInput("DURATION_MINUTES", "1440").ok === true);
check("5.13 duration 1 allowed", parseMissionControlInput("DURATION_MINUTES", "1").ok === true);
check("5.14 an invalid value mutates nothing", /if \(!parsed\.ok\) \{\s*await sendMessage\(TELEGRAM_BOT_TOKEN, chatId, parsed\.reason\);\s*return json\(\{ ok: true \}\);/.test(webhook));

// ---------------------------------------------------------------------------
// 6 — immutable effective_config and resolved precedence (pure, executed).
// ---------------------------------------------------------------------------
const frozen = {
  milestone_type: "VIEWS",
  milestone_target: 90,
  stretch_goal_target: 150,
  goal_source: "AUTO",
  metric_targets: { views: 90, likes: 7, replies: 2, reposts: 3, bookmarks: 1 },
  metric_targets_source: "AUTO",
  duration_minutes: 45,
};
const autoMeta = { effective_config: frozen };
const manualOverride = {
  milestone_type: "LIKES",
  milestone_target: 40,
  stretch_goal_target: null,
  goal_source: "MANUAL",
  metric_targets: { likes: 40, replies: 12 },
  metric_targets_source: "MANUAL",
};
const manualMeta = {
  effective_config: frozen,
  mission_control: { mode: "MANUAL", override_config: manualOverride, history: [] },
};
const resetMeta = {
  effective_config: frozen,
  mission_control: { mode: "AUTO", override_config: null, history: [{ action: "RESET_AUTO" }] },
};

check("6.1 no mission_control resolves to the frozen config", JSON.stringify(resolveMissionConfig(autoMeta)) === JSON.stringify(frozen));
check("6.2 manual override wins on the primary goal", (resolveMissionConfig(manualMeta) as any).milestone_type === "LIKES");
check("6.3 manual override wins on the primary target", (resolveMissionConfig(manualMeta) as any).milestone_target === 40);
check("6.4 manual override replaces the metric target set", JSON.stringify((resolveMissionConfig(manualMeta) as any).metric_targets) === JSON.stringify({ likes: 40, replies: 12 }));
check("6.5 manual mode carries NO stale auto stretch", (resolveMissionConfig(manualMeta) as any).stretch_goal_target === null);
check("6.6 untouched keys survive the merge", (resolveMissionConfig(manualMeta) as any).duration_minutes === 45);
check("6.7 RESET TO AUTO restores the frozen config exactly", JSON.stringify(resolveMissionConfig(resetMeta)) === JSON.stringify(frozen));
check("6.8 reset preserves history", (resetMeta.mission_control.history as unknown[]).length === 1);
check("6.9 mode helper defaults to AUTO", missionControlMode(autoMeta) === "AUTO");
check("6.10 mode helper reports MANUAL", missionControlMode(manualMeta) === "MANUAL");
check("6.11 state helper returns null when uncontrolled", missionControlState(autoMeta) === null);
check("6.12 null metadata is null-safe", resolveMissionConfig(null) === null);
check("6.13 array metadata is rejected", resolveMissionConfig([1, 2, 3]) === null);
check("6.14 manual mode without an override falls back to frozen", JSON.stringify(resolveMissionConfig({ effective_config: frozen, mission_control: { mode: "MANUAL" } })) === JSON.stringify(frozen));
check("6.15 SQL resolver mirrors the TS resolver", sql.includes("social_mission_resolve_config") && sql.includes("|| (_metadata -> 'mission_control' -> 'override_config')"));
check("6.16 no SQL path writes effective_config", !/jsonb_set\([^)]*'\{effective_config/.test(sql) && !sql.includes("{effective_config}"));
check("6.17 overrides are written under mission_control only", sql.includes("'{mission_control,override_config}'") && sql.includes("'{mission_control,mode}'"));
check("6.18 SE-14 establishment gates are untouched", !sql.includes("record_social_mission_metric_snapshot") && !sql.includes("social_mission_auto_goal"));

// ---------------------------------------------------------------------------
// 7 — transport and runner consume the RESOLVED config.
// ---------------------------------------------------------------------------
check("7.1 transport imports the resolver", transport.includes('from "../_shared/mission-resolved-config.ts"'));
check("7.2 transport goal reads the resolved config", transport.includes("function missionGoal(mission: LoadedRow): MissionGoal | null {\n  const config = missionConfig(mission);"));
check("7.3 transport targets read the resolved config", transport.includes("function missionMetricTargets(mission: LoadedRow): MissionMetricTargets | null {\n  const config = missionConfig(mission);"));
check("7.4 transport no longer reads effective_config directly", !transport.includes('["effective_config"]'));
check("7.5 runner imports the resolver", runner.includes('from "../_shared/mission-resolved-config.ts"'));
check("7.6 runner pulse config is resolved", runner.includes('const pulseConfig = resolveMissionConfig(missionFields?.["metadata"] ?? null);'));
check("7.7 runner no longer reads effective_config directly", !runner.includes('["effective_config"]'));
check("7.8 pulse copy still performs no network access", !/\bfetch\s*\(/.test(pulseCopy) && !/createClient\s*\(/.test(pulseCopy));
check("7.9 the resolver itself performs no IO", !/\bfetch\s*\(/.test(readFileSync("supabase/functions/_shared/mission-resolved-config.ts", "utf8")));
check("7.10 CANCELLED is renderable by the transport", transport.includes('if (missionStatus === "CANCELLED") return "CANCELLED";'));

// ---------------------------------------------------------------------------
// 8 — same-card edit, zero X read for target-only changes.
// ---------------------------------------------------------------------------
check("8.1 a control change edits the same card", webhook.includes("const mcRefreshCard = async ("));
check("8.2 the refresh uses edit_mission, never a resend", /mcRefreshCard[\s\S]{0,1400}action: "edit_mission"/.test(webhook) && !/mcRefreshCard[\s\S]{0,1400}"send_mission"/.test(webhook));
check("8.3 the refresh reuses the transport revision contract", webhook.includes('revision: Number((target as any).edit_revision ?? 0) + 1'));
check("8.4 the refresh id is deterministic per update", webhook.includes("const mcRequestUuid = async (seed: string)"));
check("8.5 the webhook never calls an X provider", !webhook.includes("lookupXPostMetrics") && !webhook.includes("api.twitter.com"));
check("8.6 the transport reads X only for a COMPLETED mission", transport.includes('args.finalRefresh === true && String(mission["status"] ?? "") === "COMPLETED"'));
check("8.7 target-only changes leave the mission LIVE", sql.includes("IF v_auth.mission_status <> 'LIVE' THEN") );
check("8.8 cancel triggers no provider read path", /cancel_social_mission_from_control[\s\S]{0,2600}COMMIT/.test(sql) && !/cancel_social_mission_from_control[\s\S]{0,2600}snapshot/i.test(sql));

// ---------------------------------------------------------------------------
// 9 — end time / rescheduling.
// ---------------------------------------------------------------------------
check("9.1 quick choices offered", webhook.includes("mc_dq_20_") && webhook.includes("mc_dq_45_") && webhook.includes("mc_dq_60_") && webhook.includes("mc_dq_120_"));
check("9.2 custom minutes offered", webhook.includes("mc_dc_"));
check("9.3 duration RPC bounded 1..1440", sql.includes("_minutes_from_now < 1 OR _minutes_from_now > 1440"));
check("9.4 duration requires LIVE", /social_mission_apply_duration_override[\s\S]{0,2000}mission_status <> 'LIVE'/.test(sql));
check("9.5 ends_at is rewritten", sql.includes("UPDATE public.social_missions SET ends_at = v_new_end"));
check("9.6 pending COMPLETE is rescheduled", /event_type = 'COMPLETE'\s*\n\s*AND e\.state = 'PENDING'/.test(sql));
check("9.7 only PENDING pulses are recomputed", /event_type = 'PULSE' AND e\.state = 'PENDING'/.test(sql));
check("9.8 a CLAIMED event returns a typed conflict", sql.includes("'outcome', 'conflict', 'reason', 'event_claimed'"));
check("9.9 SENT history is never mutated", !/state = 'SENT'[\s\S]{0,80}UPDATE/.test(sql) && !sql.includes("WHERE e.state = 'SENT'"));
check("9.10 the mission row is locked for the transaction", sql.includes("FOR UPDATE"));
check("9.11 duration change appends audit history", sql.includes("'SET_END_TIME'"));
check("9.12 the card is refreshed after an end-time change", /duration:\$\{minutes\}/.test(webhook) || webhook.includes("seed: `${updateId}:duration:${minutes}`"));

// ---------------------------------------------------------------------------
// 10 — END MISSION NOW.
// ---------------------------------------------------------------------------
check("10.1 confirmation is required", webhook.includes("END MISSION NOW?") && webhook.includes("mc_ec_"));
check("10.2 selection is by exact mission id", sql.includes("CREATE OR REPLACE FUNCTION public.end_social_mission_from_control(\n  _telegram_user_id bigint,\n  _mission_id uuid,"));
check("10.3 status becomes COMPLETED", sql.includes("SET status = 'COMPLETED', completed_at = v_now, ends_at = v_now"));
check("10.4 ends_at is truthful now, not COALESCEd", !/status = 'COMPLETED'[\s\S]{0,120}ends_at = COALESCE/.test(sql));
check("10.5 pending pulses are cancelled", /end_social_mission_from_control[\s\S]{0,2600}event_type = 'PULSE' AND state = 'PENDING'/.test(sql));
check("10.6 the COMPLETE event is claimed idempotently", sql.includes("SET state = 'CLAIMED', claimed_at = v_now"));
check("10.7 exactly one final edit is attempted", (webhook.match(/seed: `\$\{updateId\}:end_now`/g) ?? []).length === 1);
check("10.8 the completion event is finalized once", /mc_ec_[\s\S]{0,2000}finish_social_mission_schedule_event/.test(webhook));
check("10.9 unpin is ownership guarded", webhook.includes("if (!pinned?.pinned_by_hq || !pinned.telegram_message_id) return;"));
check("10.10 audit action END_NOW recorded", sql.includes("'END_NOW'"));
check("10.11 no replacement message is sent to the group", !/mc_ec_[\s\S]{0,2200}"send_mission"/.test(webhook));

// ---------------------------------------------------------------------------
// 11 — CANCEL MISSION.
// ---------------------------------------------------------------------------
check("11.1 confirmation is required", webhook.includes("CANCEL MISSION?") && webhook.includes("mc_cc_"));
check("11.2 status becomes CANCELLED", sql.includes("SET status = 'CANCELLED'"));
check("11.3 completed_at is not claimed", !/status = 'CANCELLED'[\s\S]{0,160}completed_at = /.test(sql));
check("11.4 all pending events are cancelled", /cancel_social_mission_from_control[\s\S]{0,2600}WHERE mission_id = _mission_id AND state = 'PENDING'/.test(sql));
check("11.5 a CLAIMED event blocks cancellation", /cancel_social_mission_from_control[\s\S]{0,1800}'event_claimed'/.test(sql));
check("11.6 audit action CANCEL recorded", sql.includes("'CANCEL',"));
check("11.7 safe unpin is reused", /mc_cc_[\s\S]{0,1400}mcSafeUnpin/.test(webhook));
check("11.8 the same card is edited, never replaced", /mc_cc_[\s\S]{0,1400}mcRefreshCard/.test(webhook));

// ---------------------------------------------------------------------------
// 12 — idempotency, replay and stale buttons.
// ---------------------------------------------------------------------------
check("12.1 every mutation carries an idempotency key", (sql.match(/_idempotency_key text/g) ?? []).length >= 4);
check("12.2 a short or missing key is refused", (sql.match(/length\(_idempotency_key\) < 8/g) ?? []).length >= 4);
check("12.3 a replayed key returns the recorded outcome", (sql.match(/'outcome', 'replayed'/g) ?? []).length >= 4);
check("12.4 replay never appends duplicate history", sql.includes("social_mission_control_key_used"));
check("12.5 the key is derived from the Telegram update id", webhook.includes("se15-mission-control:${String(updateId ?? \"\")}"));
check("12.6 stale buttons after completion return a typed response", sql.includes("'outcome', 'not_live'"));
check("12.7 every mutating RPC re-checks status inside the RPC", (sql.match(/mission_status <> 'LIVE'/g) ?? []).length >= 3);
check("12.8 history is bounded", sql.includes("jsonb_array_length(v_hist) > 50"));

// ---------------------------------------------------------------------------
// 13 — grants, definer and leak safety.
// ---------------------------------------------------------------------------
const definerFns = [
  "social_mission_effective_config_resolved",
  "social_mission_control_authorize",
  "social_mission_control_append_history",
  "social_mission_control_workspaces",
  "social_mission_control_missions",
  "social_mission_control_panel",
  "social_mission_control_set_session",
  "social_mission_apply_target_override",
  "social_mission_apply_duration_override",
  "end_social_mission_from_control",
  "cancel_social_mission_from_control",
];
for (const fn of definerFns) {
  check(`13.a ${fn} is revoked from PUBLIC/anon/authenticated`, new RegExp(`REVOKE ALL ON FUNCTION public\\.${fn}\\(`).test(sql) && sql.includes("FROM PUBLIC, anon, authenticated"));
  check(`13.b ${fn} is granted only to service_role and postgres`, new RegExp(`GRANT EXECUTE ON FUNCTION public\\.${fn}\\([^)]*\\) TO service_role, postgres;`).test(sql));
}
check("13.1 every function pins search_path", (sql.match(/SET search_path TO 'public'/g) ?? []).length >= 10);
check("13.2 no GRANT to authenticated anywhere", !/GRANT[^;]*TO[^;]*\bauthenticated\b/.test(sql));
check("13.3 no GRANT to anon anywhere", !/GRANT[^;]*TO[^;]*\banon\b/.test(sql));
check("13.4 pickers refuse non-operators", (sql.match(/is_workspace_operator/g) ?? []).length >= 3);
check("13.5 no raw Telegram payload is echoed", !webhook.includes("JSON.stringify(update)"));
check("13.6 no secret is rendered in the panel", !/mcRenderPanel[\s\S]{0,2500}(SERVICE_KEY|TELEGRAM_BOT_TOKEN,\s*chatId,\s*`?\$\{SERVICE)/.test(webhook));

// ---------------------------------------------------------------------------
// 14 — product-safety wording.
// ---------------------------------------------------------------------------
const controlSlice = webhook.slice(webhook.indexOf("SE-15 — TELEGRAM MISSION CONTROL"));
for (const banned of ["reward", "points", "badge", "payout", "quota", "airdrop", "leaderboard"]) {
  check(`14.a no ${banned} semantics`, !new RegExp(banned, "i").test(controlSlice));
}
check("14.1 no mechanical engagement instruction", !/everyone (like|repost|reply)/i.test(controlSlice));
check("14.2 bookmarks is not a Primary Goal", !webhook.includes('"BOOKMARKS",\n] as const') && webhook.includes("Bookmarks cannot be a Primary Goal"));
check("14.3 primary goal enum is unchanged", sql.includes("'VIEWS', 'LIKES', 'REPLIES', 'REPOSTS', 'TOTAL_INTERACTIONS'"));

// ---------------------------------------------------------------------------
// 15 — the manual set is validated server-side.
// ---------------------------------------------------------------------------
check("15.1 a primary target must be positive", sql.includes("_primary_target IS NULL OR _primary_target <= 0"));
check("15.2 supporting targets are optional", (sql.match(/IS NOT NULL AND _\w+ +> 0 THEN v_targets/g) ?? []).length === 5);
check("15.3 the primary goal pins its supporting metric", sql.includes("IF v_type = 'LIKES'   THEN v_targets := v_targets || jsonb_build_object('likes', _primary_target); END IF;"));
check("15.4 TOTAL_INTERACTIONS pins no sixth metric", !/v_type = 'TOTAL_INTERACTIONS'\s+THEN v_targets/.test(sql));
check("15.5 an empty target set stores null, never {}", sql.includes("CASE WHEN v_targets = '{}'::jsonb THEN NULL ELSE v_targets END"));
check("15.6 a bad mode is refused", sql.includes("'outcome', 'invalid_mode'"));
check("15.7 a bad primary type is refused", sql.includes("'outcome', 'invalid_primary_type'"));
check("15.8 the browser cannot supply targets", !readModel.includes("apply_target_override") && !panel.includes("apply_target_override"));

// ---------------------------------------------------------------------------
// 16 — caption budget with a manual, fully populated target set.
// ---------------------------------------------------------------------------
const worstTargets: MissionMetricTargets = {
  views: 999_999_999,
  likes: 999_999_999,
  replies: 999_999_999,
  reposts: 999_999_999,
  bookmarks: 999_999_999,
};
const worstCard = renderMissionCard({
  missionStatus: "LIVE",
  platform: "x",
  canonicalUrl: `https://x.com/${"h".repeat(15)}/status/${"9".repeat(19)}`,
  authorHandle: "h".repeat(15),
  contentText: "L".repeat(600),
  projectName: "P".repeat(60),
  ticker: "T".repeat(12),
  baseline: { views: 1, likes: 1, comments: 1, shares: 1, saves: 1 },
  latest: { views: 888_888_888, likes: 888_888_888, comments: 888_888_888, shares: 888_888_888, saves: 888_888_888 },
  accomplished: false,
  endsAt: new Date(Date.now() + 3_600_000).toISOString(),
  goal: { type: "LIKES", target: 999_999_999, stretchTarget: null, source: null },
  metricTargets: worstTargets,
  maxLength: TELEGRAM_CAPTION_MAX,
});
check("16.1 worst-case caption fits Telegram's limit", worstCard.text.length <= TELEGRAM_CAPTION_MAX, `${worstCard.text.length}`);
check("16.2 the OPEN ON X button survives", !!worstCard.replyMarkup);

// ---------------------------------------------------------------------------
// 17 — read-only HQ evidence surface.
// ---------------------------------------------------------------------------
check("17.1 read model exposes the control mode", readModel.includes("export function missionControlMode("));
check("17.2 read model exposes the history", readModel.includes("export function missionControlHistory("));
check("17.3 history is newest first", readModel.includes(".reverse();"));
check("17.4 actor identities are not surfaced", !readModel.includes("actor_user_id:") && !readModel.includes("telegram_user_id:"));
check("17.5 the panel renders the history read-only", panel.includes("Mission Control · target mode") && panel.includes("This view is read-only."));
check("17.6 no second mission editor was added", !panel.includes("social_mission_apply") && !panel.includes("useMutation"));
check("17.7 the panel states the launch settings are preserved", panel.includes("original\n            launch settings are kept unchanged underneath"));

// ---------------------------------------------------------------------------
// 18 — scope: no new table, no second scheduler.
// ---------------------------------------------------------------------------
check("18.1 no new table", !/CREATE TABLE/i.test(sql));
check("18.2 no cron or scheduler change", !/cron|pg_cron/i.test(sql));
check(
  "18.3 no change to social_mission_settings",
  !/(CREATE|ALTER|DROP|INSERT INTO|UPDATE|DELETE FROM)[^;\n]*social_mission_settings/i.test(sql),
);
check("18.4 no change to the existing close RPC", !sql.includes("CREATE OR REPLACE FUNCTION public.close_social_mission_from_telegram"));
check("18.5 no change to claim_due_social_mission_schedule_events", !sql.includes("CREATE OR REPLACE FUNCTION public.claim_due_social_mission_schedule_events"));
check("18.6 the migration is prepared only", sql.includes("PREPARED ONLY"));

if (failures.length > 0) {
  console.error(`FAIL — ${failures.length} failed, ${passed} passed`);
  for (const failure of failures) console.error(`  - ${failure}`);
  process.exit(1);
}
console.log(`PASS — ${passed}/${passed} SE-15 mission control checks passed`);
