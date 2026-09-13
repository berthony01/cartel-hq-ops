# SE-3 — Telegram Mission Send/Edit Lifecycle

Status: repository implementation COMPLETE. Migration application, Edge Function
deployment and live Telegram validation are **NOT** performed by Lovable in this
phase and await authoritative external execution.

- Start HEAD: `6f7e65d1b43ad20659f0b86a320bb1dd81514d69`
- Final HEAD: recorded in the completion report for this phase.
- Backend system of record: external Supabase `ocoinbnjgstkmnwwvnhi`.
- Stop point: SE-3 repository implementation only. SE-4 is not started.

## 1. Platform block and approved resolution

The originally specified path `supabase/functions/social-mission-telegram/`
is blocked by the build platform for new Edge Functions in this TanStack
project. The architecture is unchanged: a **separate authenticated Edge
Function** named `social-mission-telegram` with `verify_jwt=true`. Only its
repository parity location moved, to the existing external-backend source area
already used for authoritative function copies:

```
backend-source/edge-functions/social-mission-telegram/index.ts
backend-source/edge-functions/social-mission-telegram/card.ts
backend-source/edge-functions/social-mission-telegram/deno.json
```

These exact sources are deployed externally after diff review.

## 2. Audit and transport decision

- No pre-existing `social-mission-telegram` function, client, renderer or doc.
- `social_mission_targets` already carries the composite FK
  `(group_connection_id, workspace_id, telegram_chat_id)` to the authoritative
  Telegram connection, a `delivery_state` check
  (`PENDING|SENDING|SENT|FAILED|AMBIGUOUS`), a SENT-shape check and forced RLS.
- Live `telegram-group` is v30 and large/mature.

Decision: **do not extend `telegram-group`.** SE-3 adds one narrow function that
reuses its proven patterns — auth plus owner/admin gate, live group verification,
one fixed Telegram host, 10-second timeout, SENT / FAILED / AMBIGUOUS honesty —
without changing any existing Telegram behaviour, connection metadata, bot,
webhook, broadcast, Launch Watch, inbox or sticker flow. The repository copy of
`telegram-group/index.ts` is byte-unchanged (md5 pinned in the regression).

## 3. Schema hardening (prepare only)

`docs/sql/SE3_social_mission_telegram_transport.sql` extends
`public.social_mission_targets` with transport-owned columns:
`send_client_request_id`, `send_text_intent`, `message_text_snapshot`,
`edit_state`, `edit_client_request_id`, `edit_revision`, `edit_text_snapshot`,
`edit_last_error`, `last_edit_at`.

Idempotency: partial unique indexes on `(workspace_id, send_client_request_id)`
and `(workspace_id, edit_client_request_id)` where the id is non-null. A request
id cannot be reused across targets inside a workspace.

Shape checks enforce, at the database level:

- PENDING carries no send claim; any non-PENDING delivery state carries both a
  send request id and a send text intent.
- SENT requires `telegram_message_id`, `sent_at` **and** a confirmed
  `message_text_snapshot`; every non-SENT state has all three null.
- `IDLE` implies no edit request id, revision 0, and null edit text/error/time.
- Non-`IDLE` implies a request id, revision >= 1 and an edit text snapshot.
- `last_edit_at` exists for `EDITED` only.
- Text fields are 1..4096; errors <= 1000.

Browser hardening: authenticated table-level `UPDATE` is revoked and the broad
`social_mission_targets_update_operator` policy is dropped; authenticated
`INSERT` is revoked and re-granted only on the safe intent columns
`(workspace_id, mission_id, group_connection_id, telegram_chat_id)`; the INSERT
policy requires an owner/admin operator plus the exact default transport shape.
SELECT and DRAFT-only DELETE policies are preserved. Draft target changes remain
possible with DELETE + INSERT. Service role remains authoritative for every
transport write. `usage_ledger` is untouched.

## 4. Confirmed vs intent

`send_text_intent` and `edit_text_snapshot` are **intent**: exactly what the
server rendered and durably claimed *before* any Telegram call.
`message_text_snapshot` is **confirmed**: only ever written when Telegram
definitively acknowledged the message (SENT) or the edit (EDITED). A failed or
ambiguous attempt never overwrites confirmed text. This removes the earlier
semantic conflict between "claim before transport" and "snapshot means truth".

## 5. `send_mission` state machine

Input: `workspaceId`, `missionId`, `targetId`, `clientRequestId`.

1. Authenticated JWT, then owner/admin workspace membership.
2. Mission + target + Telegram connection rebound and rechecked server-side.
   DRAFT missions are refused.
3. Idempotency resolved **before** live verification and **before** Telegram:
   the same `send_client_request_id` returns the recorded outcome and never
   sends again. A request id already bound elsewhere conflicts on the partial
   unique index.
4. A fresh request may claim `PENDING`, or retry a definitively `FAILED` target
   (FAILED proves nothing was delivered). `SENDING`, `AMBIGUOUS` and `SENT` are
   refused so a duplicate message cannot be produced.
5. The card is rendered from authoritative rows, then the row is claimed
   `SENDING` with the request id and the exact intent, clearing confirmed
   fields. The claim is a compare-and-set on the previous delivery state.
6. Live verification (`getMe` + `getChat` + `getChatMember`): group/supergroup
   only, bot must be administrator or creator.
7. Exactly one `sendMessage`: plain text, `disable_web_page_preview: true`, one
   inline URL button.
8. `SENT` only on a numeric `message_id`; confirmed snapshot = intent.
   Definite pre-send verification failure or a definite Telegram rejection =>
   `FAILED`. Timeout, network failure, 429, 5xx, unreadable or inconclusive
   body => `AMBIGUOUS`.
9. If the final DB write fails after transport, the response is `AMBIGUOUS`, the
   durable `SENDING` claim stays, and no second Telegram call is ever made.

## 6. `edit_mission` state machine

Input: `workspaceId`, `missionId`, `targetId`, `clientRequestId`, `revision`.

1. Target must be `SENT` with a message id; mission must not be DRAFT.
2. Same edit request id + same revision returns the recorded outcome and never
   edits again; same id with a different revision conflicts.
3. `EDITING` or `AMBIGUOUS` blocks any new revision, so an uncertain edit can
   never be followed by a reordered update.
4. A new intent must use exactly `edit_revision + 1`. New edits may proceed from
   `IDLE`, `EDITED` or a definitively `FAILED` edit.
5. The current card is rendered server-side, then claimed `EDITING` with the
   request id, revision and exact edit intent (revision-guarded compare-and-set).
6. Live verification runs again.
7. Exactly one `editMessageText` for the stored chat/message with the same single
   inline URL button. There is no replacement-send fallback anywhere in the edit
   path.
8. Telegram "message is not modified" is an idempotent `EDITED` success.
   `EDITED` updates the confirmed snapshot, clears the edit error and sets
   `last_edit_at`. Definite rejection => `FAILED`; timeout/429/5xx/unreadable =>
   `AMBIGUOUS`. Neither touches the confirmed snapshot.
9. A failed final DB write leaves the row `EDITING`; future revisions stay
   blocked and nothing is resent.

## 7. Copy and safety rules

The renderer is pure and dependency-free and never accepts operator free text.
LIVE cards invite legitimate participation ("Read the update and add your
perspective.") with no promise, reward, points, payout or quota. Terminal cards
are truthful, use the exact phrase **"Observed during the mission window"** and
state that observed change is not proof Telegram caused the growth. Metrics with
a null canonical value are omitted — null never becomes zero — and a delta is
shown only when baseline and latest both exist. X labels are Views, Likes,
Replies, Reposts, Bookmarks. Output is plain text under 4096 characters with no
parse mode, and exactly one inline URL button (`OPEN ON X` for X) pointing at
the stored canonical post URL.

## 8. Tests

`scripts/se3-social-mission-telegram-regression.ts` — source/fixture only, zero
network, DB or secrets. Covers: telegram-group byte-unchanged; exactly two
actions; auth and owner/admin gate before transport; fixed host, server-only
token, 10s timeout, no logging; absence of X/provider/Refetcher/usage_ledger/
cron/OAuth/engagement code; every SQL column, check, partial index, revoke and
policy; exact workspace/mission/target/chat binding; the full send and edit state
machines including claim-before-transport, duplicate request ids, FAILED retry,
blocked SENDING/AMBIGUOUS/SENT, exact +1 revision, stale conflict, single
sendMessage and single editMessageText paths, "message is not modified" as
success, and DB-finalization ambiguity; confirmed-vs-intent snapshot honesty; and
renderer behaviour including null omission, deltas, labels, terminal copy,
caveats and the single post button.

## 9. Not performed by Lovable

No migration applied, no SQL executed, no Supabase read or write, no Edge
Function deployment, no live Telegram call, no X/provider call, no secret change,
no cron or scheduler, and no UI. SE-5 owns dashboard presentation; SE-4 owns
polling and automation.
