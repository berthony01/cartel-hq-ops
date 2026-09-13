# SE-4A Start-Gate / Parity Audit — findings only (no edits made)

## 1. Start gate

- HEAD: `eceeaa001630508142e0d1c3daaa3565f6809d9a` — matches expected.
- `git status --porcelain`: empty (clean tree).
- Project remains unpublished. No build, deploy, migration, Telegram, X, or DB write performed. All database access was read-only `SELECT`.

## 2. Telegram webhook parity

Important structural finding: the repository holds **two** copies of the webhook.

| Path | Lines |
|---|---|
| `backend-source/edge-functions/telegram-webhook/index.ts` | 1692 |
| `supabase/functions/telegram-webhook/index.ts` | 2059 |

Diff between them: **+370 / −3 lines**. `deno.json` is byte-identical in both.

`supabase/functions/...` is the newer copy. `backend-source/...` is **behind** and is missing, at minimum:

- The full new `CARTEL HQ • ECOSYSTEM ROADMAP` text (built foundation / current production work / next layers / vision). `backend-source` still carries the old short "PRIVATE BETA ROADMAP".
- The entire C7.3 Project Inbox team console block (~185 lines): `renderInboxList`, `openInboxCommand`, `openInboxConversation`, `inboxListMarkup`, deterministic `replyRequestId`.
- Team console callbacks `pi_w_<uuid>`, `pi_c_<uuid>`, `pi_x`, and the session clear/reply branches.
- RPC calls `bot_inbox_operator_workspaces`, `bot_inbox_list_conversations`, `bot_inbox_open_conversation`, `bot_inbox_set_session`, `bot_inbox_active_reply_session`, `bot_inbox_create_team_reply`, `bot_inbox_capture_alert_targets` (new-message alert fan-out to team operators).

Live comparison limit (stated honestly): no tool available here can read the **deployed** source of `telegram-webhook` v65, so I cannot byte-prove either repo copy equals live. Evidence indicates `supabase/functions/telegram-webhook/index.ts` is the closest representation of v65 (it contains exactly the mature Launch Watch + Project Inbox/team-console behaviour you describe as live-only). `backend-source/edge-functions/telegram-webhook/index.ts` is a **stale copy and must never be deployed**.

Recommendation: SE-4A must not touch or attempt to reconcile `backend-source/edge-functions/telegram-webhook/index.ts`. If a repo webhook change is needed, it belongs in the newer `supabase/functions/telegram-webhook/index.ts` only, and only after you confirm that file is live parity.

## 3. `social-mission-telegram` parity

- Repo copy exists only at `backend-source/edge-functions/social-mission-telegram/` (`index.ts` 797 lines, `card.ts` 244 lines, `deno.json`). There is **no** `supabase/functions/social-mission-telegram/` copy, so there is no second divergent copy to reconcile.
- `card.ts` carries the SE-3.4 LIVE copy (`🎯 COMMUNITY MISSION`, "Open the official post, read it, and join the conversation.", optional-participation line, `📊 LIVE RESULTS`) and the SE-3.4 comment-parity header from commit `c165a83`.
- Deployed v5 source is not readable from here, so parity is **asserted by deployment record, not byte-proven**. If you want byte proof, the cheapest route is you pulling v5 source externally and diffing against these three files.

## 4. Service-role SECURITY DEFINER RPC pattern (confirmed live)

Every webhook-facing RPC follows one consistent pattern:

- `prosecdef = true` (SECURITY DEFINER)
- `proconfig = search_path=public` (scheduler-facing ones add `vault`, `net`)
- ACL exactly `postgres=X/postgres | service_role=X/postgres` — **no** `authenticated`, **no** `anon`, **no** PUBLIC

Confirmed for: `bot_inbox_operator_workspaces`, `bot_inbox_list_conversations`, `bot_inbox_open_conversation`, `bot_inbox_set_session`, `bot_inbox_active_reply_session`, `bot_inbox_create_team_reply`, `bot_inbox_capture_alert_targets`, `capture_project_inbox_member_message`, `capture_project_inbox_launch_reply`, `claim_project_inbox_deliveries`, `claim_telegram_message_cleanup_jobs`, `claim_launch_notification_deliveries`.

Re-authorization inside those RPCs resolves `telegram_connections` → application user → **current** `workspace_members`; `telegram_team_sessions` is convenience state only, never an authorization source. `is_workspace_operator(_workspace_id uuid, _user_id uuid)` is granted to both `authenticated` and `service_role` and remains the single operator helper (still no one-argument overload).

## 5. Social Engine constraints relevant to an atomic launcher

`social_posts`
- `UNIQUE (workspace_id, platform, external_post_id)` — exists, so get-or-create is a safe `ON CONFLICT` target.
- `UNIQUE (id, workspace_id)` for composite FKs; `platform` limited to x/instagram/tiktok/youtube/facebook; canonical_url 1..2048; external_post_id 1..512.

`social_missions`
- `social_post_id` NOT NULL; `status` default `DRAFT`, CHECK in DRAFT/LIVE/COMPLETED/CANCELLED/FAILED; `metadata` jsonb NOT NULL default `{}` with object check; `UNIQUE (id, workspace_id)`.
- No uniqueness on `(workspace_id, social_post_id)` — nothing in the schema prevents two LIVE missions for the same post. SE-4A must enforce "don't relaunch the same post" in RPC logic, not rely on a constraint.

`social_mission_targets`
- `UNIQUE (mission_id, telegram_chat_id)` — one target per group per mission.
- Composite FK `(group_connection_id, workspace_id, telegram_chat_id)` → `telegram_group_connections`.
- PENDING shape enforced: `send_intent_shape_ck` forces PENDING rows to have null `send_client_request_id` / `send_text_intent`; `sent_shape_ck` and `confirmed_shape_ck` forbid message id / sent_at / snapshot unless SENT; `edit_shape_ck` forces the IDLE shape.
- `transport_kind` CHECK TEXT|PHOTO, default `TEXT`; `authenticated` has no grant on it, so service-role transport alone can promote to PHOTO.

`telegram_inbound_updates` has `telegram_update_id` NOT NULL and is the natural idempotency anchor for a `/mission` command retry.

## 6. Safest minimal allowlist for SE-4A

Proposed (for your approval, not yet authorized):

- `docs/sql/SE4A_mission_command_launcher.sql` — PREPARE ONLY, one new service-role-only SECURITY DEFINER RPC (`search_path=public`, EXECUTE granted only to `service_role`) that atomically: validates group connection + linked Telegram identity + workspace owner/admin + canonical Project Profile `x_url` handle match, upserts `social_posts` on `(workspace_id, platform, external_post_id)`, refuses if a LIVE/SENT mission already exists for that post+chat, and creates one LIVE mission + one PENDING target keyed by `telegram_update_id`. You apply it externally.
- `supabase/functions/telegram-webhook/index.ts` — add the `/mission` command branch only (live Telegram admin/creator check + one RPC call + reuse of existing branded transport). No other branch touched.
- `scripts/se4a-mission-command-regression.ts` — new fixture-only regression, zero network/DB/Telegram/X calls.
- `docs/SE4A_MISSION_COMMAND.md` — new doc.

Prohibited for SE-4A: `backend-source/edge-functions/telegram-webhook/index.ts` (stale, do not revive), `social-mission-telegram` transport sources (`index.ts`/`card.ts` — reuse, never duplicate sendPhoto), package.json/lockfile, generated Supabase types, any applied migration, any deploy/publish, any X read, any wallet/chain file, unrelated routes/components.

Rollback point: `eceeaa001630508142e0d1c3daaa3565f6809d9a`.

Stop point: this audit. No SE-4A implementation until you approve.
