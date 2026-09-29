# SP-B5 Sticker Tools — Audit and Plan (plan only, no edits)

Baseline: HEAD `17e370b7`, production `ocoinbnjgstkmnwwvnhi`. Nothing applied, deployed or published.

## 1. Current sticker architecture (verified this turn)

Server functions (repo `backend-source/edge-functions/`; none are in `supabase/functions/`):

| Function | Actions | Access today | Gate B (identity + plan key) | Cost |
|---|---|---|---|---|
| `sticker-ai` | config, start, start_candidate, start_variation, retry_review_background, sync | workspace member | identity + `static_ai_generations` / `static_ai_tools` | Kie paid |
| `sticker-motion-ai` | config, start, sync, set_current | member | identity + `motion_ai_generations` | paid |
| `sticker-motion-telegram` | config, start, retry_normalization, sync | member | identity + `telegram_motion_prep` | paid (conversion) |
| `sticker-concepts` | generate (default), config | member | identity + `concept_generation` | paid LLM |
| `telegram-stickers` | config, publish, refresh, replace_version, release_motion, send_test | member (`workspace_members` row, any role) | identity + `sticker_auto_posting` | free Telegram API |
| `sticker-drop-config` | status, save_schedule, set_schedule_enabled, delete_schedule, set_kill_switch | read: any member; writes: owner/admin | identity + `sticker_drops` on save/enable only; disable/delete/kill switch ungated | free |
| `sticker-drops` (cron worker) | runs due schedules | scheduler secret (`sticker_drop_scheduler_secret_matches`) | kill switch, auto-pause after failures | free |

Key facts:
- `publish` creates the Telegram set owned by the **caller's own** `telegram_connections.telegram_user_id`. `send_test` DMs the caller's own Telegram. A partner running these would either own the client's sticker set or need owner impersonation.
- Sticker Drops worker sends with `sendSticker` using stored `telegram_file_id` (send-as-sticker; no file fallback seen). It consumes trusted `sticker_drop_schedules` rows; it has no idea who created a schedule, so it can be reused unchanged.
- `save_schedule` forces `approved_only=true`, creates new schedules `enabled=false`, validates interval 15..720, daily cap 1..24, timezone, active hours; one schedule per group (upsert by group).
- `status` returns groups including `username` and `metadata`, plus events including `telegram_message_id`, and stickers with `telegram_file_id` — not safe for partners as-is.
- RLS: `sticker_packs`, `stickers` (via `can_access_pack`), `media_assets`, `sticker_versions`, drop tables all `is_workspace_member`. Storage `workspace-assets` objects: member-only by first folder = workspace id. No partner path exists anywhere.
- No `client_request_id` on sticker generation or drops; drops dedupe via schedule-per-group and worker events.

## 2. Classification

| Action | Class | Reason |
|---|---|---|
| List published packs + publishable stickers (safe fields) | B | new partner read RPC |
| Sticker Drops: list schedules/history (safe fields) | B | new partner read RPC |
| Sticker Drops: save_schedule, enable, disable, delete | B | fall-through in `sticker-drop-config`, client `sticker_drops` gate |
| Workspace Sticker Drops kill switch | C | workspace-wide emergency control stays owner/admin |
| Pack create/edit metadata, sticker rows, upload assets | D | needs storage/RLS widening to non-members; separate phase |
| Telegram publish / refresh / replace_version / release_motion | C | set is owned by caller's Telegram identity — STOP condition |
| send_test | C | sends to caller's own DM |
| All AI: sticker-ai, motion-ai, motion-telegram, concepts | D | paid; separate cost approval (possible SP-B5.1) |
| Pack delete/archive, group assign/distribute (telegram-group) | C/D | owner-only in V1 |
| Group connect/disconnect, bot/secrets, raw IDs | C | never |

## 3. Recommended SP-B5 V1 — "Sticker Drops management"

A partner with active `sticker_tools` on a client can:
- see the client's already published sticker packs and their published stickers (label, emoji, preview via existing safe asset URL mechanism only if already signed server-side; otherwise label/emoji only);
- see connected groups (safe names only);
- create/edit one Sticker Drop schedule per group using existing stickers, enable, disable, delete;
- see schedule status and recent drop history (status, time, group title, sticker label, error text);
- lose all of it immediately on revoke.

Not included: any AI generation, uploads, pack editing, Telegram publishing, test sends, kill switch.

AI/cost actions kept out (all D): `static_ai_generations`, `static_ai_tools`, `motion_ai_generations`, `telegram_motion_prep`, `concept_generation`. Optional future SP-B5.1 only: these already have client-workspace quotas (C1 ceilings) and usage ledger, so a partner path evaluating the CLIENT plan via SP-B0 is technically possible — requires separate approval.

## 4. Database (staged `docs/sql/SP_B5_partner_sticker_tools.sql`)

All: SECURITY DEFINER, postgres owner, `SET search_path TO ''`, explicit `auth.uid()`, `partner_has_scope(_workspace_id,'sticker_tools')` first, REVOKE PUBLIC/anon, GRANT authenticated + service_role. No table/RLS/storage changes; no membership helper changes.
1. `partner_list_sticker_drop_packs(_workspace_id)` — published packs with `telegram_set_name` not null in this workspace; fields: pack id, title, theme, sticker count, published_at, plus published stickers (id, label, emoji_list, sort_order). No `telegram_file_id`, set name, storage path.
2. `partner_list_sticker_drop_state(_workspace_id)` — groups (id, title, chat_type, bot_is_admin, operational), schedules (id, group id, pack id, interval, timezone, hours, cap, silent, no_immediate_repeat, selected ids, enabled, paused_reason, next/last run), kill_switch boolean, last 50 events (status, local_date, created_at, group title, sticker label, error_message). No chat id, username, metadata, `telegram_message_id`, `created_by`.
3. `partner_authorize_sticker_drop_action(_workspace_id,_action,_group_connection_id,_pack_id,_schedule_id)` — actions exactly save_schedule / set_schedule_enabled / delete_schedule; group, pack (published, same workspace) and schedule must belong to workspace; save/enable require `project_identity_ready` + `commercial_evaluate_workspace_feature(_workspace_id,'sticker_drops',…)` on CLIENT plan, no bypass; disable/delete ungated (mirrors owner). Returns `{allowed, code}` only.

## 5. Edge (staged source only)

Modify only `backend-source/edge-functions/sticker-drop-config/index.ts`, SP-B3/B4 fall-through pattern:
- member path unchanged byte-for-byte;
- non-member: `status` → FORBIDDEN (partners read via RPCs); save/enable/disable/delete → call partner authorize with user JWT; if allowed set `partnerStickerAuthorized`, skip owner Gate B, pass `canManage` for these 3 actions only; `set_kill_switch` and unknown → FORBIDDEN;
- partner responses omit `state` (loadState leaks username/metadata/message ids) — return `{saved|updated|deleted, scheduleId}` only;
- also add (for both paths only if missing — verify first) group/pack workspace validation in save_schedule; if owner path lacks it, the partner RPC enforces it and owner change is reported separately, not silently made.
- `created_by` = real partner user id. Worker `sticker-drops` untouched and reused.
- Pre-edit gate: deployed `sticker-drop-config` version must match repo md5 (to be captured).

## 6. Frontend

Create `src/lib/partner-sticker-drops.ts`, `src/components/cartel/PartnerStickerDropsPanel.tsx`. Update as needed `src/routes/_authenticated/telegram.tsx` (Stickers tab), `src/lib/partner-client-access.ts` (activate `sticker_tools`, allow /telegram), and only if required `ManagedAccessGuard.tsx`, `SidebarNav.tsx`, `ServicePartnerAccessPanel.tsx`. Sticker Lab routes stay denied for partners. 44px targets, noir/gold.

## 7. Strict allowlist

The SQL file; `sticker-drop-config/index.ts`; the two new frontend files; the five frontend files above (as needed); `scripts/sp-b5-partner-sticker-tools-regression.ts`; `docs/SP_B5_PARTNER_STICKER_TOOLS_RUNBOOK.md`; expectation-only updates to SP-A, SP-B1, SP-B2, SP-B3, SP-B4 regressions and public-discovery D-24; `roadmap.md`.

## 8. Regression matrix

- ACTIVE scopes add exactly `sticker_tools`; `missions` inactive.
- Cross-workspace list/state/authorize denied scope-first; no scope/pending/declined/revoked/suspended/anon denied.
- Pack isolation: other-workspace, unpublished, no-set packs denied. Group isolation: other-workspace group denied. Schedule isolation.
- Outputs contain no telegram_chat_id, username, metadata, telegram_file_id, set name, telegram_message_id, created_by, storage path.
- Owner validation mirrored (interval 14/15/720/721, cap 0/1/24/25, timezone, hours); approved_only forced true; new schedule starts disabled.
- Client `sticker_drops` deny/allow mapping; no owner bypass; disable/delete ungated.
- Kill switch, status, publish, send_test, every AI action denied to partner (Edge code read + RPC).
- Worker source unchanged; sendSticker path unchanged; no AI function files changed.
- No announcements, launch_events, watcher deliveries, inbox rows touched.
- Revoke blocks next authorize. Owner Edge path unchanged. All prior suites, TypeScript, build, diff check.

## 9. Production smoke (rolled back, no real sticker)

In one transaction: temporary approved partner + access with `sticker_tools`; list packs/state (safe fields); authorize save on current client plan; wrong group/pack/workspace and invalid action denied; revoke then deny; ROLLBACK; verify counts (schedules, events, packs, stickers, access 0, approved partners 0). No Edge call, no schedule enabled.

## 10. Activation order and rollback

CP-SPB5-SQL (+ smoke) → verify deployed md5 → CP-SPB5-EDGE (owner schedule save first) → CP-SPB5-PUBLISH → types sync. Rollback: redeploy previous Edge version; drop the 3 RPCs; revert frontend; scope deactivation in `partner-client-access.ts`.

Expected advisor: 0028 unchanged at 9; 0029 +3 (129 → 132); mutable search path unchanged at 1.

## 11. STOP conditions

Stop if: delegation needs workspace membership or storage/RLS widening; partner publish/test needs owner Telegram identity; any paid AI path becomes reachable; group/pack ownership cannot be enforced before write; deployed Edge differs from repo; worker needs partner-specific privileges or a second sticker sender.

## Open decisions

1. Allow partners to delete schedules (owner's disable/delete are ungated safety actions) — recommended yes.
2. Kill switch owner-only — recommended yes.
3. Sticker previews: labels/emoji only in V1 (no image URLs) — recommended yes.
