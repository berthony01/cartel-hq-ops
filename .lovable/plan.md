# SE-15 Telegram Mission Control — read-only audit and proposed architecture

Audit start HEAD `004f41acf1d52197df3706f7aab349983133122a`, working tree clean. No file
was edited, nothing deployed, no SQL applied.

## 1. Where today's mission commands live

All of it is in one handler, `supabase/functions/telegram-webhook/index.ts` (3472 lines,
authoritative; `backend-source/edge-functions/telegram-webhook` is stale). Dispatch order
inside the handler: `callback_query` (2103) -> `my_chat_member` (2649) -> `message` (2782).

- `/mission <X link>`: `runMissionCommand` (~684-1331). Chain: group -> workspace via
  `telegram_group_connections`; Telegram user -> HQ user via `telegram_connections`;
  `is_workspace_operator` RPC; live `getChatMember` requiring administrator/creator;
  live bot-permission preflight `readBotChatPermissions`; then
  `create_social_mission_from_telegram_link`, transport call to `social-mission-telegram`,
  `activate_social_mission_schedule`, optional command cleanup, canonical pin.
- Bare `/mission`: `sendBareMissionLauncherAndCleanup(token, chatId, sourceMessageId)` (271).
- `/mission close`: same auth chain, then `close_social_mission_from_telegram`,
  same-card edit through the transport, `finish_social_mission_schedule_event`, and a
  safe unpin gated on `social_mission_targets.pinned_by_hq`.
- Anonymous admins: `linkFinderSender` (2988) accepts `sender_chat` only when
  type is group/supergroup AND `sender_chat.id === chat.id`; `posterId` is null, so the
  command is routed into `offerLinkFinderCandidate`, never a direct launch.
- Link Finder buttons: `sm_lf_start_<uuid>` / `sm_lf_ignore_<uuid>` (2120-2426).
  Authorization at tap time is the strong pattern: read-only `peek_...` -> chat binding
  check (`candidateChatId === callbackChatId`) -> live `getChatMember` -> mutating
  `resolve_social_mission_link_candidate` with `_verified_chat_id`. Idempotency lives in
  the candidate row (`ALREADY_RESOLVED`) plus `missionRequestUuid(update_id)`.
- Pin/unpin: `ensureCanonicalMissionPin` (765) and the close-path unpin (973), both
  persisted through `record_social_mission_target_pin`.

## 2. Existing DM control pattern (reuse it)

Yes — the Project Inbox team console is exactly the pattern SE-15 needs:
`/inbox` (3318) -> `openInboxCommand` (1992) -> `bot_inbox_operator_workspaces` ->
workspace picker `pi_w_<uuid>` -> list -> `pi_c_<uuid>` -> `pi_x` to exit, plus
`bot_inbox_set_session` for convenience state. Every callback is private-chat-gated and
re-authorizes inside a service-only RPC; `telegram_team_sessions` is explicitly never an
authorization source. Identity mapping: `telegram_connections` (telegram_user_id -> user_id),
`workspace_members`, `is_workspace_operator`. `platform_user_roles` is not used by the bot.

## 3. Existing HQ surfaces to extend, not duplicate

- `src/components/cartel/MissionSettingsCard.tsx` + `src/lib/social-mission-settings.ts`
  (workspace defaults: preset, milestone_type/target, auto_pin, link_finder, cleanup).
- `src/components/cartel/SocialMissionsPanel.tsx` + `src/lib/social-missions.ts` — the
  read-only Missions tab in Community Command Center, already renders status, timeline,
  snapshots and final results. SE-15 overrides/history belong here as extra read-only rows.

## 4. Lifecycle facts that constrain editing a LIVE mission

- `ends_at` is set once via `COALESCE` in `activate_social_mission_schedule`; completion is
  NOT driven by `ends_at`. All PULSE and the single COMPLETE `due_at` are precomputed as
  absolute timestamps at activation from `sent_at + offsets`. Changing `ends_at` alone
  desynchronizes the displayed end from the real completion trigger.
- Completion happens by *claiming* the COMPLETE event in
  `claim_due_social_mission_schedule_events`, which atomically flips LIVE->COMPLETED and
  cancels sibling PENDING pulses. A stale CLAIMED pulse is retired to AMBIGUOUS, never resent.
- `effective_config` (milestone_type/target, stretch, metric_targets, goal_source) is
  establish-once, guarded by `WHERE <field unset>`. `metric_targets` today is AUTO-only,
  derived from the first durable `x-official` snapshot.
- `CANCELLED` exists in the `social_missions` status enum and the card renders it, but no
  RPC anywhere writes it. There is no cancel path and no config-history table.

## 5. Smallest safe SE-15 architecture

**Surface.** New `/mission manage` command, private-DM console modelled byte-for-byte on
the `/inbox` pattern. In a group, `/mission manage` replies with a deep link to the bot DM
(this also solves the anonymous-admin problem: the DM forces a real, identifiable user).

**Authorization (three gates, all inside one new service-only RPC family).**
1. `telegram_connections` -> HQ user.
2. `is_workspace_operator(workspace_id, user_id)`.
3. live `getChatMember` administrator/creator in the mission's own target chat, verified at
   the moment of each mutating tap, passing `_verified_chat_id` exactly as the Link Finder does.

**Flow.** `mm_ws_<uuid>` workspace picker (only if >1) -> `mm_m_<uuid>` mission picker
(LIVE first) -> panel with `mm_mode_auto|mm_mode_manual`, `mm_t_<metric>_<missionId>`
prompts, `mm_dur_<mins>`, `mm_end_<id>` (End Now), `mm_cancel_<id>`, `mm_x`. Manual target
entry reuses the existing reply-session mechanism (`bot_inbox_set_session` equivalent) so
the next plain DM message is read as the number — no second conversation-state system.

**Config changes without rewriting history.** Keep `effective_config` immutable. Add an
`overrides` array (or a `config_version` counter plus `override_history`) inside
`social_missions.metadata`, appended never rewritten, each entry recording actor user id,
telegram user id, timestamp, field, previous value, new value. The *effective* value is read
as "latest override, else effective_config". This avoids a new table.

**Duration change.** Must be an RPC that rewrites `ends_at` AND reschedules the pending
schedule events in the same transaction: shift the COMPLETE `due_at`, cancel PENDING pulses
whose new `due_at` is in the past, never touch CLAIMED/SENT rows. Do not expose a raw
`ends_at` setter.

**End Mission Now.** Reuse `close_social_mission_from_telegram`'s body via a new
`end_social_mission_from_control(mission_id, ...)` RPC (same COMPLETED + cancel-pulses +
COMPLETE-event claim), then the webhook performs one final metrics read through the existing
`social-mission-telegram` `edit_mission` with `finalRefresh: true`, then the existing safe
unpin gated on `pinned_by_hq`.

**Cancel Mission.** New `cancel_social_mission_from_control` — sets the currently-dead
`CANCELLED` status, cancels all PENDING/CLAIMED-stale schedule events, no final X read,
same-card edit to CANCELLED (card already supports it), safe unpin.

**Not in scope, explicitly:** points, rewards, badges, per-user engagement tracking, a second
scheduler, a second settings system, widening the Primary Goal enum.

## 6. Files and SQL likely touched

Repo: `supabase/functions/telegram-webhook/index.ts` (+ backend-source parity copy),
`supabase/functions/social-mission-telegram/{index.ts,card.ts}` (render override/manual
provenance and CANCELLED), `supabase/functions/_shared/mission-pulse-copy.ts` (targets read
from effective-with-overrides), `src/lib/social-missions.ts` +
`src/components/cartel/SocialMissionsPanel.tsx` (read-only override history),
`docs/sql/SE15_mission_control.sql` (prepared only).

New SQL: `social_mission_control_workspaces`, `social_mission_control_missions`,
`social_mission_apply_target_override`, `social_mission_apply_duration_override`,
`end_social_mission_from_control`, `cancel_social_mission_from_control`, and a
`social_mission_effective_config_resolved` reader that folds overrides over the frozen
config. All SECURITY DEFINER, REVOKE PUBLIC/anon/authenticated, GRANT service_role+postgres.
**No new table is necessary** — overrides ride in `social_missions.metadata`.

## 7. Hazards and required regressions

Hazards: anonymous-admin identity (solved by DM-only mutation); stale inline keyboards
re-tapped after a mission completes (every RPC must re-check status and return a typed
outcome, never assume); double-tap racing (idempotency key derived from callback/update id,
plus `WHERE status = 'LIVE'` guards); duration change racing the runner's claim (do the
reschedule in the same transaction, skip CLAIMED rows); a manual Primary Goal target of zero
or a non-integer; overriding a target on a COMPLETED/CANCELLED mission; unpinning a pin HQ
never set; leaking a workspace id to a non-operator through the picker.

Regressions to add (`scripts/se15-mission-control-regression.ts`) plus the full existing
stack (SE-14, SE-13, Step 1, SE-5, SE-4B, SE-4A, SE-3, SE-3.1, SE-3.3L, Community, parity,
`tsgo`, build): DM-only gating of every `mm_*` callback; three-gate authorization; anonymous
tap refused; override append never rewrites `effective_config`; resolved-config precedence;
Primary Goal must be positive while supporting targets stay optional; duration change
reschedules COMPLETE and leaves CLAIMED untouched; End Now = one final X read, one same-card
edit, pulses cancelled, unpin only when `pinned_by_hq`; Cancel = zero X reads, CANCELLED
status, all pending events cancelled; caption stays under 1024; no points/rewards strings.

Stopping after this report as instructed. No code, SQL, deployment or production change.
