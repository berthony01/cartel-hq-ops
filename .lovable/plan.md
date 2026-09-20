# SE-16.3R — Rolling Canonical Mission Card: Audit Report

Read-only audit. Nothing edited, deployed, published, or sent to Telegram.

**HEAD `04efad236e3f0d479ce26b48fb189501aa913fa7` · working tree clean.**

**Verdict: PASS — safe to implement, but it requires one new SQL migration. It cannot be done repo-only.**

---

## A) Current canonical card lifecycle (traced)

- **Send** — `social-mission-telegram` action `send_mission` (index.ts:758-948). Workspace logo decides `transport_kind` (`PHOTO` → `sendPhoto`, else `TEXT` → `sendMessage`) before any claim. Compare-and-set claim writes `SENDING` + `send_client_request_id` + `send_text_intent`; exactly one Telegram call; confirmation writes `SENT`, `telegram_message_id`, `sent_at`, `message_text_snapshot`. Rejection → `FAILED`, timeout/429/5xx → `AMBIGUOUS`.
- **Edit** — action `edit_mission` (index.ts:954-1128). Requires `SENT` + non-null `telegram_message_id`. Idempotent on `edit_client_request_id`; `revision` must equal `edit_revision + 1`. Uses `editMessageCaption` (PHOTO) or `editMessageText` (TEXT) chosen from the stored `transport_kind`, never probed. "message is not modified" counts as confirmed.
- **Pulses** — runner sends one `sendMessage` with `reply_to_message_id` = canonical card, then queues a `telegram_message_cleanup_jobs` row (`cleanup_kind = 'social_mission_pulse'`, delete after 120s). Never a resend of the card.
- **Metric refresh** — `claim_social_mission_card_refresh(_target_id, _signature)` is an atomic compare-and-set on `last_metric_signature`; signature covers status + five metrics only, not targets or end time.
- **Complete / cancel** — DB status leads; the card is edited in place exactly once via `edit_mission`. Never deleted, never reposted.
- **Cleanup worker** — `telegram_message_cleanup_jobs` + `claim_telegram_message_cleanup_jobs`, `deleteMessage`, "not found" treated as success, backoff `[60,300,900,3600]`s, max 5 attempts. Note: this function exists only under `backend-source/edge-functions/telegram-message-cleanup/` — there is no copy under `supabase/functions/`.

## B) Existing resurface primitive: none

Grep across functions, `src`, and `docs/sql` for `resurface|replace_mission|rotate|repost|resend` returns only prose and X-terminology. Every `deleteMessage` call site targets ephemeral content (pulses, welcome CTA, Link Finder prompts) — none touches the canonical mission card. There is no message counter, activity counter, or `last_activity` column anywhere.

## C) New action vs extending `edit_mission` — **new action `resurface_mission`**

Dispatch is a hard two-value check (index.ts:662-665) then a single branch. Extending `edit_mission` is wrong here: SE-3's CHECK constraints (`social_mission_targets_confirmed_shape_ck`, `..._edit_shape_ck`) assume one durable `telegram_message_id` for the target's whole life, and `edit_state`/`edit_revision` encode "same message, monotonic edits". Send-new-then-delete-old is a different lifecycle with its own two-phase failure surface. It belongs in its own action with its own claim columns, leaving the send and edit invariants untouched.

## D) Durable state — new columns required

`social_mission_targets` today: base (SE1) + SE3 transport/edit columns + `last_metric_signature` (SE5) + `transport_kind` (SE33). No counter, no resurface timestamp. `telegram_group_connections` has no `can_delete_messages` column — live permissions live only inside its `metadata` JSON. `telegram_inbound_updates` exists with unique `telegram_update_id`, but is written only by specific mission-command / inbox RPCs, not by every group message.

Minimal proposed addition (one migration, `social_mission_targets` only):

| Column | Purpose |
| --- | --- |
| `activity_message_count int not null default 0` | qualifying human messages since current canonical card |
| `last_resurface_at timestamptz null` | cooldown anchor |
| `resurface_state text not null default 'IDLE'` | `IDLE`/`CLAIMED`/`SENT`/`FAILED`/`AMBIGUOUS` |
| `resurface_client_request_id uuid null` | idempotency (unique partial index with `workspace_id`) |
| `resurface_pending_message_id bigint null` | new message id recorded before old-card delete |
| `resurface_revision bigint not null default 0` | monotonic replacement counter |
| `resurface_last_error text null` | bounded diagnostic |

Plus two service-only `SECURITY DEFINER` RPCs:

- `social_mission_note_chat_activity(_chat_id bigint, _update_id bigint)` — single statement, increments the counter for the LIVE target bound to that exact chat, and atomically claims a resurface (`IDLE` → `CLAIMED`, mints request id) when `activity_message_count >= 6 AND (last_resurface_at IS NULL OR now() - last_resurface_at >= interval '3 minutes')`. Returns the claim or nothing. Because claim and increment are one `UPDATE ... RETURNING` under the row lock, concurrent updates cannot double-claim.
- `social_mission_finish_resurface(...)` — narrow finalizer: `CLAIMED` → `SENT` (sets new `telegram_message_id`, resets counter to 0, sets `last_resurface_at`, bumps revision, resets `edit_state`/`edit_revision` for the new message) or `FAILED`/`AMBIGUOUS` (old id untouched).

## E) Message-trigger path

Webhook-triggered, as you prefer. Today an ordinary group text message falls through every branch and hits `return json({ ok: true })` with **zero DB writes** (index.ts:4130, 4828) — a deliberate cost control. Counting rules to add at that fall-through point, after all existing branches:

- skip unless `from.is_bot !== true` (bot and service posts never count, including our own card and pulses);
- skip service updates (`new_chat_members`, `left_chat_member`, and any non-`message` update);
- skip anything already consumed by a command / mission-control / Link Finder branch — counting happens only on the unmatched fall-through, so admin-system traffic is excluded by construction;
- pass `update_id` into the RPC so a Telegram retry is a no-op (dedupe row or `update_id`-guarded increment);
- no provider/X read anywhere on this path.

Cost note: this turns "no write per group message" into "one RPC per group message in chats that have a connected group". The RPC must therefore be a single round-trip and should early-exit cheaply when no LIVE target is bound to the chat.

## F) Replacement transport failure matrix

Order is strictly: **render → send new → record new id → delete old → reset counters.**

| Situation | Behavior |
| --- | --- |
| Send rejected | `resurface_state = FAILED`, old card stays canonical, nothing deleted, counter not reset (cooldown set to avoid hot-looping) |
| Send ambiguous/timeout | `AMBIGUOUS`, old card stays canonical, nothing deleted, no automatic retry — a duplicate is worse than a stale card |
| Send confirmed, DB canonical-id update fails | New message is live but not canonical. `resurface_pending_message_id` is written in the SAME statement that flips state; if that statement fails, the next claim is blocked by `CLAIMED` state and an operator-visible `resurface_last_error` — the old card stays canonical and the orphan new card is reported, never silently duplicated |
| DB update succeeds, delete old fails | Enqueue the old message into the existing `telegram_message_cleanup_jobs` (new `cleanup_kind = 'social_mission_card'`, `delete_after = now()`) and let the proven cleanup worker retry with its backoff. No new delete machinery |
| Retry of the same claim | Same `resurface_client_request_id` short-circuits and returns the recorded state — no second send |

Delete permission (H) is checked **before** the send: if `readBotChatPermissions` says the bot cannot delete, the resurface is abandoned (no send at all, so no duplicate), `resurface_last_error` records `MISSING_DELETE_RIGHTS`, and the existing permission-warning pattern (`telegram-webhook` index.ts:1223-1256 / `showPermissionPrompt` index.ts:2980-2996) surfaces it to admins. Pinning is never read or written.

## G) Admin-edit integration

Smallest safe change: leave `edit_mission` exactly as-is for status/metric refresh, and route only the **committed admin mutations** (Mini App `withCardRefresh` and the bot's `mcRefreshCard`) to `resurface_mission`. That preserves SE-16.2P's mutation-truthfulness contract unchanged — the bridge already distinguishes committed DB success from refresh outcome, and `edited/replayed/ambiguous/failed` map onto the resurface outcomes one-for-one. END/CANCEL stay bot-owned and keep using in-place `edit_mission`.

## H) Recommended build sequence

Three units, each separately gated:

1. **SE-16.3R-1 (SQL)** — new `docs/sql/SE16_3R_rolling_mission_card.sql`, PREPARE ONLY, applied externally after your diff review. Columns, constraints, the widened `cleanup_kind` check, and the two RPCs.
2. **SE-16.3R-2 (transport)** — `resurface_mission` action in `social-mission-telegram` + both `backend-source` and `supabase/functions` copies (deploy parity is byte-for-byte pinned for these files).
3. **SE-16.3R-3 (webhook + admin edit)** — activity counting at the webhook fall-through, permission preflight, and repointing admin edits at the new action.

### Proposed allowlist for unit 1 only

- `docs/sql/SE16_3R_rolling_mission_card.sql` (new, prepare-only)
- `scripts/se163r-rolling-mission-card-regression.ts` (new — justified: no existing script covers replacement semantics; SE-3/SE-4B/SE-5/SE-15 suites assert one-message-for-life invariants and must stay unweakened)
- `docs/SE16_3R_ROLLING_MISSION_CARD.md`

Units 2 and 3 additionally touch `supabase/functions/social-mission-telegram/index.ts` + its `backend-source` mirror, `scripts/social-mission-deploy-parity-regression.ts`, `supabase/functions/telegram-webhook/index.ts`, and `src/lib/telegram-miniapp-bridge.functions.ts`.

## Blockers and open items

- **SQL is unavoidable.** No existing column can carry the counter or cooldown.
- `telegram_message_cleanup_jobs` has no `CREATE TABLE` in `docs/sql`; its shape was read from generated types. The migration must therefore only `ALTER`/widen, never recreate.
- Per-message webhook accounting is a real cost change and should be acknowledged explicitly before unit 3.
- `left_chat_member` handling was not located in the webhook; confirm before finalizing the service-message exclusion list.
- Everything above is static repo evidence — production function bodies were not queried this turn.

**STOP — audit only. No implementation performed.**
