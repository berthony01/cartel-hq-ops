# SE-4A — Telegram `/mission <X link>` zero-X-read launcher

Repository implementation + prepared SQL only. Lovable does **not** apply the
migration, deploy either function, or send anything to Telegram.

## What it is

The cheapest possible way to start a Cartel Social Mission:

```text
/mission https://x.com/<official-project-handle>/status/<numeric-id>
```

An authorized community admin types the link. The mission is created from that
exact link and delivered through the existing branded `social-mission-telegram`
transport. **Zero X API reads happen anywhere in this path.** Content and
metrics are not fetched at launch — `content_text`, `author_display_name`,
`published_at` and every baseline metric stay NULL, and the provenance records
`x_api_reads_at_start = 0`.

Not in this phase: `/mission latest`, `/mission refresh`, `/mission close`,
polling, auto-detection, usage ledger, rewards.

## Authorization chain

A command acts only when **all** of these hold:

1. The message is in a group or supergroup.
2. That exact chat has a `telegram_group_connections` row resolving one workspace.
3. The sender's Telegram account is linked via `telegram_connections` to an app user.
4. That app user is a **current** workspace owner/admin (`is_workspace_operator`).
5. The sender is a **current** Telegram administrator/creator, verified live with
   `getChatMember` before any mission row is created.
6. The handle in the link matches the workspace's canonical
   `project_profiles.x_url` account, case-insensitively.
7. The URL is a plain public X/Twitter status URL: HTTPS only; host in
   `x.com`, `www.x.com`, `twitter.com`, `www.twitter.com`, `mobile.twitter.com`;
   no credentials, no port; path exactly `/<handle>/status/<numeric-id>`.
   Trailing slash and query string are canonicalised away. `i/web/status`,
   profile URLs, non-status paths and mismatched handles are rejected.

Checks 2–4 run before the live Telegram round trip, so the only network call in
the rejection path is cheap. Every one of 2–6 is then **re-established
independently inside the RPC**; the webhook's result is never trusted as the
authorization.

The browser never supplies workspace id, group id, logo, caption, transport
kind, bot token or mission card text. All of it is server-resolved.

## Atomic RPC

`docs/sql/SE4A_mission_command_launcher.sql` prepares exactly one
service-role-only `SECURITY DEFINER` function with `SET search_path = public`:

`public.create_social_mission_from_telegram_link(bigint, bigint, bigint, bigint, text, text, text) -> jsonb`

It creates no table, column, policy or table grant. Behaviour:

- structural validation of Telegram ids, post id, handle and canonical URL;
- atomic command-idempotency claim on `telegram_inbound_updates.telegram_update_id`
  (`MESSAGE`, `RECEIVED` then `PROCESSED` in the same transaction); the raw
  Telegram payload is never stored;
- duplicate delivery of the same update returns the already-created
  mission/target when provenance matches, otherwise a safe duplicate/unresolved
  outcome — never a second mission;
- `social_posts` get-or-create with
  `ON CONFLICT (workspace_id, platform, external_post_id) DO NOTHING`, so a
  richer post captured by another path is preserved, never downgraded;
- one post + one Telegram chat = **one** mission in V1: an existing pair returns
  the existing mission/target state instead of duplicating;
- otherwise one LIVE mission and one PENDING target are inserted transactionally;
- returns `outcome`, `reason`, `actor_user_id`, `workspace_id`, `mission_id`,
  `target_id`, `delivery_state`;
- `REVOKE ALL ... FROM PUBLIC, anon, authenticated`;
  `GRANT EXECUTE ... TO service_role` (and `postgres`).

## Internal transport authentication

`social-mission-telegram` keeps `verify_jwt=true` and the existing end-user
owner/admin JWT path unchanged. SE-4A adds **one** server-only internal caller
shape, recognised only when **both**:

- `Authorization: Bearer <SUPABASE_SERVICE_ROLE_KEY>` exactly, and
- `X-Cartel-Internal-Source: telegram-webhook` exactly,

plus a UUID actor in `X-Cartel-Actor-User-Id`. That actor is a **claim, not an
authorization**: the existing owner/admin membership gate, every authoritative
row-binding check (mission, target, connection, chat), idempotency and live
group verification all run identically. No second transport endpoint exists, the
service key never reaches the browser, and send/edit idempotency, branded photo
behaviour, same-message edits, ambiguous-outcome rules and the card renderer are
untouched.

## Delivery semantics

- `clientRequestId` is **deterministic**, derived from the Telegram `update_id`,
  so a Telegram webhook retry is absorbed by the transport's own idempotency
  instead of producing a second card.
- A confirmed `SENT` card is the confirmation — no separate success text.
- An existing `SENT` mission for the same post + chat: no transport call, one
  reply saying the post already has a mission here.
- `SENDING` / `AMBIGUOUS`: reported as unresolved, explicitly "do not retry
  immediately". Never auto-retried.
- `FAILED`: a new explicit `/mission` command may re-attempt through the
  existing transport semantics. Never automatic.

## Repo parity note

`backend-source/edge-functions/telegram-webhook/index.ts` is **stale** and was
deliberately not touched. The authoritative webhook parity copy is
`supabase/functions/telegram-webhook/index.ts`.
`backend-source/edge-functions/social-mission-telegram/` remains the canonical
copy for the live transport.

## Verification

`scripts/se4a-mission-command-regression.ts` — deterministic, zero network,
zero database, zero Telegram, zero X.
