# Owner-Only Telegram System Message Editor — Start-Gate Audit

Read-only audit. No files, schema, functions, data, or settings were changed.

Start gate: HEAD `2dfb6c7cfc9841aaf31aab6a2fc8a0bc6b267e28`, working tree clean.

## A) System-of-record map

| Layer | Authority | Notes |
| --- | --- | --- |
| Code | This repository (main) | Edge Function sources are snapshots under `backend-source/edge-functions/`, staged to `supabase/functions/` only at deploy time |
| Database / auth / RLS | External Supabase `ocoinbnjgstkmnwwvnhi` | Only approved backend |
| Owner identity | `public.platform_user_roles` + `is_platform_owner()` (SECURITY DEFINER) | No client-readable path |
| Owner Console read path | Edge Function `platform-admin` (`POST {action:"status"}`, verify_jwt true) | Verifies caller JWT with anon client, then uses service role |
| Telegram runtime | Edge Function `telegram-webhook` (verify_jwt false, own secret-token check) | Service role client, no user JWT |
| Recorded live inventory | `backend-source/edge-functions/README.md` | platform-admin v2 / verify_jwt true / hash `3fb151d8…e141ce`; telegram-webhook v26 / verify_jwt false / hash `53f64f9d…706baee`. These are the last independently verified values; live version/hash readback is not exposed by the tools available here and must be re-verified out of band before and after any deploy. |

## B) What already exists and is reusable

- `is_platform_owner(_user_id)` and `has_platform_unrestricted_access(_user_id)` — SECURITY DEFINER, already used by `platform-admin`.
- `platform_user_roles`: RLS enabled, **zero policies**, no Data API grants → direct authenticated clients cannot read or write it. Fail-closed already proven.
- `platform-admin/index.ts`: exact pattern to extend — Bearer check → `userClient.auth.getUser()` → `admin.rpc("is_platform_owner")` → non-owner gets a stripped payload. Currently rejects any action other than `status`.
- `src/lib/platform.ts` (`fetchPlatformStatus`, tolerant normalizers, `platformErrorMessage`, formatters) and `usePlatformAccess` (session-keyed, fails closed).
- `/admin` route: 16 `Section` blocks using `Section`, `InlineRow`, `StatusBadge`, `EmptyState`, `Button` — a new Section drops in with no layout work.
- Webhook copy helpers already isolated: `communityConnectedText` (line ~300), `botInstalledText` (~326), `accountFoundText` (~350); call sites at lines ~458 and ~548-549. State selection logic is separate from copy, so copy can be swapped without touching state logic.
- `escapeHtml` in the webhook, used by all three helpers for group titles.
- No existing global/platform settings or message-template table. `telegram_community_settings` is per-community and member-scoped; it must NOT be reused for platform copy.

## C) Proposed table and RLS

One narrow table, no generic automation architecture.

```sql
create table public.platform_message_templates (
  key text primary key,                    -- 'bot_installed' | 'account_found' | 'community_connected'
  draft_body text not null default '',
  published_body text,                     -- null = use hardcoded fallback
  draft_updated_at timestamptz,
  published_at timestamptz,
  updated_by uuid references auth.users(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
-- NO grants to anon or authenticated (owner path is service role only)
grant all on public.platform_message_templates to service_role;
alter table public.platform_message_templates enable row level security;
-- intentionally zero policies: direct client access fails closed
create trigger platform_message_templates_set_updated_at
  before update on public.platform_message_templates
  for each row execute function public.set_updated_at();
insert into public.platform_message_templates (key) values
  ('bot_installed'), ('account_found'), ('community_connected');
```

Design notes:
- Key set is fixed and seeded; the editor never creates keys, so state logic stays code-owned.
- `published_body` null or blank → webhook uses the hardcoded copy.
- Bodies are Telegram HTML with a single `{group_title}` placeholder, escaped at render time.
- CTA control: none in v1. The existing `groupAcquisitionKeyboard` stays hardcoded in the webhook (it encodes chat-scoped deep links and is security-relevant). No button builder.

## D) platform-admin actions (additive only)

Existing `status` action unchanged. After the existing owner check, add:

1. `templates_list` → owner-only. Returns all three rows: `key, draft_body, published_body, draft_updated_at, published_at, updated_at`. Non-owner: 403.
2. `templates_save_draft` → `{ key, body }`. Validates key against the fixed allowlist and body length (e.g. 1–3500 chars). Writes `draft_body`, `draft_updated_at`, `updated_by`. Never touches `published_body`.
3. `templates_publish` → `{ key, body? }`. Copies the supplied/current draft into `published_body`, sets `published_at`, `updated_by`.
4. `templates_restore_default` → `{ key }`. Sets `draft_body` to the server-side hardcoded default for that key; does not publish. (Defaults live in a small shared constant block inside `platform-admin`, mirroring the webhook fallbacks.)

All four go through the same `is_platform_owner` gate before any service-role write. verify_jwt stays `true`.

## E) Telegram webhook read strategy

- Add one cached read helper: on first need per invocation, `admin.from('platform_message_templates').select('key,published_body')`.
- `renderTemplate(key, groupTitle)`: if `published_body` is a non-empty string, substitute `{group_title}` with `escapeHtml(title)` and return; on any error, missing row, or empty published body, return the existing hardcoded helper output verbatim.
- The three current helpers stay in the file unchanged as the fallback source of truth.
- Call sites (lines ~458 and ~548-549) change from direct helper calls to `await renderTemplate(...)`. State selection, keyboards, throttling, contact tracking, welcome diagnostics, and secret validation are untouched.
- Drafts are never read by the webhook.
- verify_jwt stays `false`.

## F) Owner Console UI plan

- `src/lib/platform.ts`: add `PlatformMessageTemplate` type plus `listMessageTemplates`, `saveTemplateDraft`, `publishTemplate`, `restoreTemplateDefault` — all thin `supabase.functions.invoke("platform-admin", …)` wrappers, same error handling as `fetchPlatformStatus`.
- New `src/components/cartel/PlatformMessageEditor.tsx`, rendered inside a new `Section` on `/admin` only, and only when `usePlatformAccess().isPlatformOwner === true` (the route already renders a locked state otherwise, so community owners never see it).
- Per template: tab or accordion for the three keys; textarea for the draft; read-only preview panel rendering the HTML with a sample group title; status line showing Published / Draft ahead of published / Using built-in default; `Last published` and `Last draft saved` timestamps via `formatTimestamp`; buttons `Restore Default`, `Save Draft`, `Publish` (publish behind a confirm, since it changes live Telegram).
- No new routes, no nav changes.

## G) Files that would change

- New migration: `platform_message_templates` (table, grants, RLS, trigger, seed).
- `backend-source/edge-functions/platform-admin/index.ts` — four new actions + defaults block.
- `backend-source/edge-functions/telegram-webhook/index.ts` — template read helper + two call sites.
- `src/lib/platform.ts` — types + four client wrappers.
- `src/routes/_authenticated/admin.tsx` — one new owner-gated Section.
- `src/components/cartel/PlatformMessageEditor.tsx` — new.
- `backend-source/edge-functions/README.md` — inventory rows after verified deploys.
- Generated `src/integrations/supabase/types.ts` refreshes after the migration.

## H) Prohibited changes

Sticker Lab, Sticker Drops, community welcome automation, group-link/bind security, `telegram_community_settings`, workspace RLS, auth, existing Owner Console metrics/sections, nav, routes, secrets, verify_jwt values, other Edge Functions, dependencies, and any client-side grant on the new table.

## I) Verification and rollback

Verification, in order:
1. `bunx tsgo --noEmit` and `bun run build`.
2. Read-only SQL: confirm table exists, RLS enabled, zero policies, no anon/authenticated grants, three seeded rows.
3. Negative test: authenticated non-owner client `select` on the table must fail; `platform-admin` non-owner call to each new action must return 403.
4. `platform-admin` owner path: list → save draft → confirm webhook output unchanged → publish → confirm new copy.
5. Live Telegram check on a disposable test group for `bot_installed`.
6. Unauthenticated POST to `telegram-webhook` must still return `403 {"ok":false}`.
7. Re-read live version/verify_jwt/hash for both functions and update README.

Rollback: set `published_body = null` for a key to instantly revert that message to the hardcoded default without a deploy; revert the function snapshots and redeploy for a full rollback; the table can be dropped without affecting any existing flow.

## J) Stop

No changes made. Awaiting implementation authorization before any migration, code edit, or deploy.
