# Project Inbox Two-Way Audit (read-only)

HEAD `e433385fa639e6d52103ca71007b0271c319e692`, working tree clean. No file, migration, deployment, Telegram send, or database write was performed for this audit; this plan file is the only write.

## 1. Team-side Telegram Bot Console — MISSING (not implemented, not live)

No executable team-inbox path exists in the bot.

- `supabase/functions/telegram-webhook/index.ts` registers exactly three commands (lines 265-268): `start`, `help`, `roadmap`. There is no `/inbox`, `/reply`, `/conversations`, or equivalent.
- Callback routing (lines 1004-1090) handles only `beta_join`, `beta_roadmap`, `start_stickers`, and the launch-watch/reminder callbacks `lw_unwatch_`, `lw_rewatch_`, `ln_reminders_off/on_`, `ln_updates_off/on_`. No conversation-selection or reply callback data exists.
- Line 1695: `if (text.startsWith("/")) return json({ ok: true });` — any unknown command is dropped before inbox logic.
- Inbound private text falls through to member-side capture only: `capture_project_inbox_launch_reply` (line 1712) and `capture_project_inbox_member_message` (line 1751).
- There is no dispatch of a "new member message" notification to any team operator DM anywhere in the webhook.

## 2. `telegram_team_sessions` — DORMANT (schema only)

Every reference is non-executable:

- `supabase/migrations/20260902191618_...sql:310-330` — table creation with `mode IN ('NONE','INBOX','REPLY')`, `selected_workspace_id`, `active_conversation_id`; service-role-only grants, RLS enabled.
- `src/integrations/supabase/types.ts:2724+` — generated types only.
- `src/lib/project-inbox.ts:10` — a comment asserting the table has zero browser exposure.

Zero reads and zero writes in any Edge Function or application code. The `INBOX`/`REPLY` modes are unused.

## 3. Dormant vs live

- LIVE: member -> workspace capture (both bare DM and launch-reply), web Project Inbox read/reply UI, `project_inbox_settings` gating.
- DORMANT: `telegram_team_sessions` and the whole bot-console concept; `backend-source/edge-functions/project-inbox-delivery/index.ts` is committed but explicitly "NOT deployed and NOT scheduled" (file header, lines 6-9) and `supabase/functions/` contains only `telegram-webhook`, so outbound team replies have no live worker in this repository's deploy surface.

## 4. Web Project Inbox freshness — MISSING for inbound messages

`src/components/cartel/ProjectInboxPanel.tsx`:

- No Supabase Realtime anywhere in `src/` (`supabase.channel` / `postgres_changes`: zero matches).
- `settingsQuery` (173), `summaryQuery` (180), `conversationsQuery` (186), `detailQuery` (198) have no `refetchInterval` — they refresh only on mount/window-focus defaults and on explicit `invalidateQueries` after a local mutation.
- `messagesQuery` (215-226) polls at 3s **only** while a message in the loaded thread has an in-flight delivery status; otherwise `refetchInterval` returns `false`.

Exact behavior: with the Project Inbox already open and idle, a newly captured inbound Telegram message appears in neither the conversation list nor the open thread until the operator refocuses the window, switches filters/threads, or sends a reply.

## 5. Existing work — none

No repository change addresses either gap; the only inbox-adjacent uncommitted or recent work is the member-capture path already described. No duplicate build risk.

## 6. Smallest surgical fix (not implemented)

Two independent, separable items — the second is far smaller and directly fixes the observed live symptom.

**Item A (recommended first, frontend-only): web freshness.**
Add bounded polling to the already workspace-bound RPC queries: `refetchInterval` on `conversationsQuery` and `summaryQuery`, and an unconditional floor interval on `messagesQuery` while a conversation is open, plus `refetchOnWindowFocus`. No schema, RPC, RLS, or Telegram change.
Allowlist: `src/components/cartel/ProjectInboxPanel.tsx` only.

**Item B (larger, separate phase): team-side bot console.**
Requires new webhook command/callback handlers, `telegram_team_sessions` read/write, operator-identity resolution through `telegram_connections` + `workspace_members`, a team-notification dispatch on capture, and the currently undeployed `project-inbox-delivery` worker for outbound replies. This is a full phase, not a surgical fix, and is out of scope for the current defect.

Recommendation: authorize Item A alone as the surgical phase; treat Item B as a separately contracted phase.
