# C7.3E Hardening Pass — Plan

Start commit verified: `4453b9f1d17d28b66a0833c4dfb7583c9a537c20`, working tree clean. Read-only investigation only; nothing was edited, deployed, published, or sent to Telegram.

## A) New member-initiated capture RPC

`public.capture_project_inbox_member_message(
  _telegram_update_id bigint,
  _telegram_user_id bigint,
  _telegram_chat_id bigint,
  _telegram_message_id bigint,
  _body text
) returns text` — SECURITY DEFINER, `set search_path = public`, `language plpgsql`, mirroring the shape/style of `capture_project_inbox_launch_reply` (verified signature: 6 bigint/text args, `prosecdef = true`).

Return is a single lowercase outcome token, never data: `captured` | `duplicate` | `invalid_input` | `no_candidate_workspace` | `ambiguous_workspace` | `new_conversations_disabled` | `contact_blocked`. No workspace id, conversation id, or member identity is returned.

Order inside ONE transaction (the whole function body is the transaction — any unexpected exception rolls back the inbound-update insert, so Telegram retry can retry):

1. Structural validation: all four ids positive, `_telegram_chat_id = _telegram_user_id`, `btrim(_body)` length between 1 and 4096. Fail → `invalid_input`, nothing written.
2. Candidate workspaces (server-side evidence only, no client input):
   - `project_inbox_contacts` for this `telegram_user_id`: `ACTIVE` rows add their workspace; `BLOCKED` rows record an exclusion set.
   - `launch_watch_subscriptions` where `is_active` and `telegram_user_id` matches, joined `launches.workspace_id`.
   - Subtract the blocked set.
3. Keep only workspaces with `project_inbox_settings.new_conversations_enabled = true` (missing row = false, via inner join).
4. Count: 0 → `no_candidate_workspace` / `new_conversations_disabled` (distinguished by whether step 2 produced anything); >1 → `ambiguous_workspace`. Both return with zero writes and no guessing.
5. Dedupe: `insert into telegram_inbound_updates (telegram_update_id, update_kind='MESSAGE', chat/message/user ids, status='RECEIVED') on conflict (telegram_update_id) do nothing returning 1`. No row returned → `duplicate`, nothing else happens.
6. Contact: `insert ... on conflict (workspace_id, telegram_user_id) do nothing`, then `select ... for update` to serialize against block/unblock (the established pattern in the launch-reply RPC). If the locked row is not `ACTIVE`, mark the inbound update `IGNORED` with `last_error='contact_blocked'` and return `contact_blocked`. A BLOCKED contact is never reactivated.
7. Conversation: select the single unresolved `MEMBER_INITIATED` row (`status in ('OPEN','WAITING_ON_TEAM','WAITING_ON_MEMBER')`) for `(workspace_id, contact_id)` `for update`; if none, insert `MEMBER_INITIATED` / `GENERAL` / `NORMAL` / `WAITING_ON_TEAM`. A `unique_violation` on the existing partial index `project_conversations_member_initiated_unresolved_key` is caught and resolved by re-reading the winner. That index is preserved unchanged; migration `20260902233008` is not rewritten.
8. Message: one `project_conversation_messages` row (`MEMBER` / `TELEGRAM`, telegram update/chat/message ids, `telegram_reply_to_message_id = null`). Its unique indexes on `telegram_update_id` and `(chat_id, message_id)` are the final duplicate guard; a `unique_violation` here returns `duplicate`. The existing `project_inbox_apply_message_state()` trigger keeps `last_message_at`/status/contact activity consistent — no duplicate hand-written state updates.
9. Mark the inbound update `PROCESSED` only after the message insert succeeds; return `captured`.

No Telegram send anywhere in this function or path.

Grants: `revoke all on function ... from public, anon, authenticated;` then `grant execute ... to service_role;` — identical posture to the existing capture RPC.

Webhook change: the C7.3E block collapses from ~10 service-role table calls to shape validation (private chat, non-bot sender, no `reply_to_message`, safe positive ids, `chat_id = from.id`, 1..4096 text) plus one `admin.rpc("capture_project_inbox_member_message", {...})`. Ordering is untouched: unknown `/` commands still return above, and the C7.3B/D reply branch still returns before this point.

## B) Setter contract

```
public.set_project_inbox_replies_enabled(_workspace_id uuid, _enabled boolean)
public.set_project_inbox_new_conversations_enabled(_workspace_id uuid, _enabled boolean)
```
Both: SECURITY DEFINER, `set search_path = public`, return the same row shape the UI already consumes (`workspace_id, replies_enabled, new_conversations_enabled, security_warning_version, updated_at`).

Behavior: authorize first with `is_workspace_operator(_workspace_id, auth.uid())` (verified signature `(_workspace_id uuid, _user_id uuid)`) and raise a generic exception otherwise; then `insert into project_inbox_settings (workspace_id, <own column>, updated_by) values (...) on conflict (workspace_id) do update set <own column> = excluded.<own column>, updated_by = auth.uid(), updated_at = now()`. The other setting takes its column default on insert and is never referenced on update, so a stale browser value can no longer overwrite it.

Grants: `revoke all ... from public, anon;` `grant execute ... to authenticated;`

`set_project_inbox_settings` stays in place untouched for compatibility, but `src/lib/project-inbox.ts` stops calling it: `setProjectInboxRepliesEnabled` and `setProjectInboxNewConversationsEnabled` lose their "current other value" parameter and call their own RPC. `ProjectInboxPanel.tsx` mutations drop the cached cross-setting argument.

## C) The `telegram_beta_contacts` gate should be REMOVED

Evidence from current source and live data:
- The Launch Watch deep-link handler (`/start lw_<token>`, webhook lines 1519-1568) calls `resolveLaunchWatch` → `launchWatchSubscribe` → confirmation send. It never calls `touchUserContact`, so joining Launch Watch does not create a `telegram_beta_contacts` row. `touchUserContact` is only reached from beta/roadmap/start-menu/group-install branches.
- Live: 3 active launch-watch subscriptions, **2 of which have no `subject_type='user'` beta contact row**. The gate today silently disqualifies two thirds of real subscribers.

`launch_watch_subscriptions.telegram_user_id` is itself the authenticated project-relationship evidence; `telegram_beta_contacts` is a global platform contact table with no workspace column and adds no tenant safety. Removing the gate restores intended C7.3E eligibility without broadening it. (Separately noted, not fixed here: the webhook currently queries that table with a string id against a `bigint` column.)

## D) Files changed in the build turn

Inside the allowlist, no additions required:
1. `supabase/functions/telegram-webhook/index.ts` — replace the C7.3E block with shape check + one RPC call.
2. `backend-source/edge-functions/telegram-webhook/index.ts` — sync the same block only; `diff` of the two files must then be empty.
3. `src/lib/project-inbox.ts` — two independent setter wrappers.
4. `src/components/cartel/ProjectInboxPanel.tsx` — setter wiring + copy fixes (item 3 below).
5. `src/integrations/supabase/types.ts` — regenerated only, for the three new RPC signatures.
6. ONE new migration: the capture RPC, the two setters, and their grants. No change to `20260902233008`, no destructive schema change, no row writes.

Copy corrections in the panel (and nowhere else): the header/description, the security block at ~lines 449-455, the switch helper text, and the empty states at ~lines 616 and 623 currently claim only explicit Launch Watch replies can ever appear and that a direct DM can "only" start a thread. New wording: explicit private replies to official bot messages are captured when reply capture is on; a plain direct DM can start a MEMBER_INITIATED thread only when "Allow new member conversations" is on and exactly one project can be identified; commands and group messages are never captured.

## E) Verification before declaring done

- `git diff --name-only` proves only the six allowlisted files changed.
- `bunx tsgo --noEmit`, `bun run build`, `bun run lint`.
- `diff` the two webhook copies → empty; grep proves the unknown-`/` return and the reply-capture branch both still precede the bare-DM branch.
- SQL checks against live catalog (read-only): `prosecdef`, `proconfig` search_path, and `proacl` for all three new functions — service_role-only execute on the capture RPC, authenticated-only on the setters, no anon/public anywhere. Re-confirm the partial unique index still exists and Inbox tables still have zero browser policies/grants.
- Rollback-only DB test script (BEGIN … ROLLBACK, synthetic fixtures only, no production rows touched) covering: 0 candidates; 2 candidates → ambiguous; `new_conversations_enabled=false`; BLOCKED contact; launch-watch-only subscriber with no beta contact → captured; duplicate `telegram_update_id` → `duplicate` and no second message; second DM continues the same unresolved thread; RESOLVED thread → new conversation; each setter leaves the other column untouched; non-operator caller rejected.
- No Telegram send exists on this path (assert by grep in the diff). No deploy, no publish, no C7.4/C8 work.

## Known limitation

The migration tool applies migrations to the live external Supabase project on approval; the new functions will exist in production immediately, but they are unreachable until the webhook is redeployed — which this phase does not do. The hardened path stays runtime-unproven by design.
