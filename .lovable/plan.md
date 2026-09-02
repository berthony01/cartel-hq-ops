# C7.3E Start-Gate Audit — Member-Initiated Project Inbox

Read-only audit. No code, database, secret, webhook, deploy, or publish action was taken.

Repository state: HEAD `8b6597b4d6cf39dfbd584af7a5746704d41c58e8` (`8b6597b Added reply thread continuity`), tree clean. Disclosure: this is past the reported D3 checkpoint `da6f135…` — platform auto-commit drift, no content difference found in the audited surfaces.

## 1. Inbound Telegram DM handler

- `supabase/functions/telegram-webhook/index.ts` (1649 lines) — deployed source; byte-identical to `backend-source/edge-functions/telegram-webhook/index.ts` (diff empty).
- Capture block is the LAST branch in the private-message path (lines ~1608-1643), after every command/deep-link/callback branch has returned. `if (text.startsWith("/")) return json({ ok: true })` precedes it, so unknown slash commands can never become project messages.
- Guard `capturable` requires: `chat.type === "private"`, `from.is_bot !== true`, and positive safe integers for `update_id`, `message_id`, **`reply_to_message.message_id`**, `from.id`, plus `chat.id === from.id`.
- Only call made: `admin.rpc("capture_project_inbox_launch_reply", {...})`. This path sends no Telegram message.

Consequence: a DM with **no** `reply_to_message` is currently dropped silently before any RPC — it is not even recorded in `telegram_inbound_updates`.

## 2. Existing C7.3A-D Inbox surface

Files: `src/lib/project-inbox.ts` (sole browser API, RPC-only), `src/components/cartel/ProjectInboxPanel.tsx`, `backend-source/edge-functions/project-inbox-delivery/index.ts` (outbound TEAM reply worker), webhook pair above. Migrations `20260902191618` → `20260902221543` (10 files).

`project_conversations.origin_type` CHECK already allows `LAUNCH_DELIVERY | LAUNCH_CONFIRMATION | MEMBER_INITIATED | COMMUNITY_BROADCAST`. `MEMBER_INITIATED` appears in **no** database function today (verified against `pg_proc.prosrc`) — it is a declared-but-unused value.

Reply routing (`capture_project_inbox_launch_reply(bigint,bigint,bigint,bigint,bigint,text)`, SECURITY DEFINER, ACL `postgres=X, service_role=X` only): atomically records the inbound update, then counts candidate targets across (a) launch notification deliveries, (b) Launch Watch confirmations, (c) confirmed TEAM/WEB `project_inbox_deliveries` with `status='sent'` matching `telegram_message_id` + same-workspace ACTIVE contact. Exactly one match required, else `unknown_reply_target` / ambiguous → IGNORED. Workspace is therefore derived **entirely from the replied-to message**, never from the sender.

## 3. Settings semantics as implemented

`project_inbox_settings`: PK `workspace_id`; `replies_enabled boolean default false`; `new_conversations_enabled boolean default false`; `security_warning_version` default `'v1'`.

- `replies_enabled` — enforced in both capture branches; false/missing row ⇒ IGNORED `replies_disabled`.
- `new_conversations_enabled` — read and written by `get_project_inbox_settings` / `set_project_inbox_settings` only. **No capture or routing code reads it.** The UI wrapper `setProjectInboxRepliesEnabled` deliberately passes the current value through unchanged, so today it is a stored-but-inert flag reserved for C7.3E.

Live data: 0 rows in `project_inbox_settings`, 0 contacts, 0 conversations, 1 workspace, 3 launch watch subscriptions.

## 4. Telegram member → workspace mapping that actually exists

- `project_inbox_contacts` — `(workspace_id, telegram_user_id)` UNIQUE, opaque `member_ref`, ACTIVE/BLOCKED. Rows are created **only** inside the capture RPC after a workspace has already been resolved from a reply target. It is a consequence of contact, not a source of eligibility.
- `launch_watch_subscriptions` — `telegram_user_id` + `launch_id`; workspace reachable via `launches.workspace_id`. This is the only genuine "member belongs to this project" signal in the schema.
- `telegram_beta_contacts` — global platform contact rows; no workspace column.
- `telegram_connections` — links a Telegram user to a **HQ auth user** (`user_id`), i.e. operators, not members.
- `telegram_group_connections` — workspace ↔ group; membership of an individual Telegram user in that group is not persisted anywhere.

No table today expresses "this Telegram user is an eligible member of workspace X" outside of launch-watch subscriptions.

## 5. Multi-workspace ambiguity

Schema permits one `telegram_user_id` to hold subscriptions across launches in different workspaces (`launch_watch_subscriptions` has no workspace uniqueness). Current live data has 0 such collisions only because there is 1 workspace.

There is **no** deterministic project-selection or chooser mechanism anywhere in the product: no `/start` project payload for inbox, no inline project picker, no "active project" per Telegram user. The existing design deliberately resolves workspace from the replied-to message precisely to avoid this decision.

## 6. Uniqueness / idempotency today

- `telegram_inbound_updates` PK `telegram_update_id` — atomic insert is the dedupe primitive; status CHECK enforces RECEIVED/PROCESSED/IGNORED/FAILED shape.
- `project_inbox_contacts` — UNIQUE `(workspace_id, telegram_user_id)`, `(workspace_id, member_ref)`, `(id, workspace_id)`; capture uses `ON CONFLICT DO NOTHING` then `SELECT … FOR UPDATE` to serialize against block/unblock.
- `project_conversations` — PK only; **no uniqueness on (workspace_id, contact_id, open state)**. Nothing prevents two concurrent opens for the same contact; today that is safe only because conversation creation always follows a single-match reply target inside one transaction keyed on the update id.
- `project_conversation_messages` — PK + `(id, conversation_id)`; author/channel shape CHECKs (`MEMBER`+`TELEGRAM`, `TEAM`+`WEB|TELEGRAM`, `SYSTEM`+`SYSTEM`); body 1..4096.
- Race risk for C7.3E: two member DMs arriving concurrently with no prior conversation would both pass the "no open conversation" read and create duplicates. Serialization must come from the contact row `FOR UPDATE` (already the established pattern) or a partial unique index.

## 7. RLS / tenant isolation

`project_inbox_settings`, `project_inbox_contacts`, `project_conversations`, `project_conversation_messages`, `project_inbox_deliveries`, `telegram_inbound_updates`, `telegram_team_sessions`, `project_inbox_team_preferences`: RLS enabled, **zero policies, zero table grants to anon/authenticated/service_role**. All access is via SECURITY DEFINER RPCs; capture/worker RPCs are `service_role`-only, operator RPCs are `authenticated` and authorize the workspace inside the function. Model is intact and must be preserved.

## 8. Smallest allowlist IF C7.3E is authorized (not proposed for execution now)

- One migration: new service-only RPC (e.g. `capture_project_inbox_member_message`) + a partial unique index guarding one non-RESOLVED MEMBER_INITIATED conversation per contact. No change to `capture_project_inbox_launch_reply`.
- `supabase/functions/telegram-webhook/index.ts` and its `backend-source/` mirror: relax the capture branch to also handle a private text DM with no `reply_to_message`, routing to the new RPC.
- `src/integrations/supabase/types.ts` (regenerated only).
- No UI change strictly required; the panel already renders `MEMBER_INITIATED` via `conversationOriginLabel`.

## 9. Available verification

`bunx tsgo --noEmit`, `bun run build`, `bun run lint` (eslint), rollback-only SQL QA scripts executed through read/query. There is **no** vitest/test runner in `package.json` and no test files in the repo.

## 10. Blockers requiring product decisions

1. **Eligibility source is undefined.** The only member↔workspace signal is `launch_watch_subscriptions`. Whether that alone confers inbox eligibility (and whether `is_active` / `unsubscribed_at` matter) is a product rule, not derivable from source.
2. **Project selection for multi-eligible members has no existing mechanism.** Choosing "most recent subscription", "only if exactly one", or building a chooser are all inventions.
3. **Sender-derived workspace resolution is a new trust path.** Every current inbox write derives workspace from an authenticated project artifact; C7.3E would be the first path where an unsolicited sender influences which tenant a row lands in.
4. Secondary, answerable once 1-3 are fixed: whether a DM must be silently ignored or acknowledged when `new_conversations_enabled` is false (no Telegram send exists in this path today), and whether an existing non-resolved LAUNCH_* conversation should absorb a bare DM instead of opening MEMBER_INITIATED.

## Recommendation

**NO-GO for C7.3E implementation as currently specified.**

Reason: the code and schema are structurally ready (origin_type value, inert `new_conversations_enabled`, RPC-only isolation, mirrored webhook), but there is no existing, deterministic definition of member eligibility or of project selection for a bare DM. Implementing now would require inventing tenant-routing policy for unsolicited inbound messages — exactly the class of decision the protocol forbids the executor to make.

**GO becomes available** once you specify, literally: (a) the authoritative eligibility source and predicate, (b) the exact behavior when zero / one / multiple candidate workspaces resolve, and (c) the silent-vs-acknowledged behavior when new conversations are disabled or the contact is BLOCKED.
