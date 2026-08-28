# Private Beta / Early Access Acquisition Layer for @PepeCartelHQBot

Goal: anyone who finds the bot before Cartel HQ launches gets an intentional Private Beta message and an opt-in path, instead of a silent or broken experience. Sticker generation, publishing, personal linking, group linking and distribution stay byte-for-byte unchanged.

## Verified current state

- Telegram Edge Functions (`telegram-link`, `telegram-group`, `telegram-stickers`, and the webhook) live only in the external Supabase project `ocoinbnjgstkmnwwvnhi`. Their source is not in this repo, so all bot-side work is Supabase-side and must be authorised separately.
- Existing tables: `telegram_connections` (one row per linked Cartel HQ user, unique `user_id`, holds `telegram_user_id`), `telegram_group_connections` (per workspace group, `telegram_chat_id`, `chat_type`, `connected_by`, `metadata`), `telegram_link_requests` (one-time hashed tokens, `status`, `expires_at`, `metadata`).
- The webhook is already the authoritative writer for link consumption and group verification, so it is the correct and only place to add beta routing.
- Frontend has no bot-discovery surface: `src/routes/_authenticated/telegram.tsx` is authenticated-only.

## 1) Private `/start` UX

Webhook branches on `chat.type === 'private'`:

- **Payload present** (`/start <token>`) → existing link-consumption path, untouched. No beta message.
- **No payload, sender already in `telegram_connections`** → short "You're already connected to Cartel HQ" card with `Open Cartel HQ` + `/help`. No lead row.
- **No payload, unknown sender** → Private Beta card:
  - Copy states plainly: Cartel HQ is in private beta, sticker tooling is live for beta workspaces, more modules are coming. No claims that unbuilt features work.
  - Inline buttons: `Join Early Access` (callback), `What's Coming` (callback), `Open Cartel HQ` (URL to the app).

`Join Early Access` writes/updates the lead row and replies with a one-line confirmation by editing the same message (no new message spam).

## 2) Group-install UX

On `my_chat_member` where the bot's new status becomes `member`/`administrator`:

- If the chat already exists in `telegram_group_connections` (a real Cartel HQ workspace group link) → current verification flow only, **no beta message**.
- Otherwise → one concise group intro posted once: what the bot is, that it's private beta, and inline buttons `Join Early Access` (deep-links the installer to the bot in private, carrying source context) and `Open Cartel HQ`.
- Never DM group members unprompted; only the person who taps the button starts a private chat.

## 3) Commands and buttons

- `/start` — as above.
- `/help` — short command list plus current beta status.
- `/roadmap` — same content as the `What's Coming` button: shipped (sticker packs, group distribution) vs planned (Brand Kit, Assets, Operations, Clearance) clearly separated.
- Inline buttons: `Join Early Access`, `What's Coming`, `Open Cartel HQ`.
- Register the command list once via `setMyCommands` (private scope + group scope).

## 4) Lead-capture data model

One new table is justified; existing tables all require an authenticated Cartel HQ user and cannot hold anonymous prospects.

`public.telegram_leads`
- `id uuid pk`
- `telegram_user_id bigint not null unique` — dedupe key, one row per person
- `telegram_username`, `first_name`, `last_name` (nullable, refreshed on each touch)
- `source text not null` — `private_start` | `group_install` | `group_button`
- `source_chat_id bigint null`, `source_chat_title text null`, `source_chat_type text null`
- `opted_in boolean not null default false`, `opted_in_at timestamptz null` — opt-in only flips true on an explicit `Join Early Access` tap
- `is_linked_user boolean not null default false` — set when the same `telegram_user_id` later appears in `telegram_connections`
- `welcome_sent_at timestamptz null`, `last_seen_at timestamptz not null default now()`
- `metadata jsonb not null default '{}'`, `created_at`, `updated_at` + `set_updated_at` trigger

Access: `GRANT ALL ... TO service_role` only. No `anon`/`authenticated` grants — writes come from the webhook (service role). RLS enabled with no permissive policies (owner-read later via a dedicated admin view if requested).

Dedupe: `upsert ... on conflict (telegram_user_id)` — never insert twice; only refresh names, `last_seen_at`, and first-write `source`/`source_chat_*`.

## 5) Distinguishing linked users from prospects

Single service-role lookup at the top of the private-message branch: `select 1 from telegram_connections where telegram_user_id = $1`. Hit → treat as a Cartel HQ user (no beta pitch, no lead). Miss → prospect path. For group events, additionally check `telegram_group_connections.telegram_chat_id` to skip beta messaging in real workspace groups.

## 6) Group-sourced context

The group-install `Join Early Access` button is a `t.me/PepeCartelHQBot?start=beta_g<chat_id>` URL. The webhook parses the `beta_` prefix as a **non-secret beta source token** (explicitly distinct from the existing hashed link tokens, which stay untouched) and records `source = 'group_button'`, `source_chat_id`, `source_chat_title`, `source_chat_type`. Installer identity comes from `my_chat_member.from` and is recorded as a `group_install` lead when unknown.

## 7) No duplicate welcomes / leads

- Private: welcome sent only when `welcome_sent_at is null` or older than 7 days; timestamp written in the same upsert.
- Group: intro posted only when no lead/message record exists for that `chat_id` — tracked in `metadata` on the lead row of the installer plus a guard on `telegram_group_connections` existence; a re-add within 7 days stays silent.
- Telegram retries the same `update_id`; the webhook must remain idempotent on it (same guard style already used for link consumption).
- All lead writes are upserts on `telegram_user_id`.

## 8) Preserving existing workflows

- Beta routing is added as branches **before** falling through to today's handlers, and only on paths that currently produce no response: payload-less private `/start`, unknown-chat `my_chat_member`.
- Zero changes to `telegram-link`, `telegram-group`, `telegram-stickers`, `sticker_packs`, `stickers`, storage, or any frontend file.
- Regression invariants: personal link via deep link still connects; group add still verifies and appears in `TelegramGroupCard`; publish + multi-group distribution unchanged.

## 9) Deferred

Broadcast/newsletter sending, email capture, waitlist ranking or invite codes, an admin leads dashboard in Cartel HQ, Mini App, inline mode, referral attribution, analytics dashboards, any token/billing tie-in.

## 10) Phases and QA

**Phase B-0 (migration only)** — create `telegram_leads` with grants, RLS, trigger. Accept: table exists, `service_role` can upsert, `anon`/`authenticated` cannot select.

**Phase B-1 (webhook: private beta)** — prospect detection, beta card, `Join Early Access`, `/help`, `/roadmap`, `setMyCommands`. Accept:
1. Fresh Telegram account sends `/start` → beta card once; second `/start` within 7 days → no duplicate welcome.
2. Linked Cartel HQ user sends `/start` → "already connected", zero rows in `telegram_leads`.
3. `Join Early Access` → `opted_in = true`, `opted_in_at` set, exactly one row.
4. Existing deep-link `/start <token>` still links the account (unchanged behaviour).

**Phase B-2 (webhook: group install)** — group intro, source token parsing. Accept:
5. Add bot to a fresh group → one intro message; remove and re-add → no second intro.
6. Add bot to a group already in `telegram_group_connections` → no intro, verification still succeeds.
7. Tapping `Join Early Access` from a group → lead has `source = 'group_button'` with the correct `source_chat_id`/title.

**Phase B-3 (regression gate)** — publish a pack and distribute to a connected group; confirm identical behaviour and no new errors in function logs.

Stop after each phase and report the resulting commit/state. No publish, no billing, no new project, no frontend change in any phase.
