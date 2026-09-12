# SE-1 Start Gate — Read-Only Audit Report and Proposed Schema/RLS Shape

No edits, migrations, provider calls, Telegram calls or runtime changes were made in this turn. Database access was read-only (`information_schema` / `pg_proc`).

## 1. Repo state

- HEAD: `d90e54e43c9dc4ed69ff4a2b22e03049bf4f08e3` — matches the expected SE-0 checkpoint exactly.
- `git status --porcelain`: empty. Clean tree.

## 2. SE-0 lock intact, no social drift

- `docs/SE0_SOCIAL_ENGINE_ARCHITECTURE_LOCK.md` present, 405 lines.
- Repo-wide search for `social_sources|social_posts|social_missions|SocialReadProvider`: the only hit is the SE-0 lock document itself. No code, no types, no migration.
- Live database: `select table_name from information_schema.tables where table_schema='public' and table_name like 'social%'` returns zero rows.
- Conclusion: no equivalent social schema or runtime was introduced since SE-0.

## 3. Confirmed current conventions (to be reused verbatim)

- Tenancy: `workspaces(id, owner_id)` + `workspace_members(workspace_id, user_id, role text default 'member')`.
- Authorization helpers, all `sql stable security definer set search_path`:
  - `public.is_workspace_member(_workspace_id, _user_id)`
  - `public.is_workspace_owner(_workspace_id, _user_id)`
  - `public.is_workspace_operator(_workspace_id, _user_id)` — verified live: true only when `role in ('owner','admin')`. This is the exact owner/admin write gate SE-1 needs; no new role machinery.
- Table style (latest migration `20260912131512`, and `telegram_group_announcements`):
  - `id uuid primary key default gen_random_uuid()`
  - `workspace_id uuid not null references public.workspaces(id) on delete cascade`
  - `created_at timestamptz not null default now()`, `updated_at timestamptz not null default now()`
  - `before update ... execute function public.set_updated_at()` (verified live)
  - **No Postgres enums anywhere** — `Enums: { [_ in never]: never }` in generated types. Status/kind columns are `text` (or `varchar(n)`) plus a named `_ck` CHECK constraint. SE-1 will follow this, per the request.
  - Named constraints: `<table>_<thing>_ck` / `<table>_<thing>_unique`.
  - Grants/RLS order: `enable row level security` (+ `force` on high-risk tables), `revoke all ... from public, anon, authenticated, service_role`, then explicit `grant` to `authenticated` and `grant all` to `service_role`, then per-verb policies scoped `to authenticated`.
  - Child tables authorize by `exists (select 1 from parent p where p.id = child.parent_id and public.is_workspace_member(p.workspace_id, (select auth.uid())))`.
  - Indexes created explicitly: `(workspace_id, created_at desc)`, plus unique idempotency indexes.
- `telegram_group_connections`: `id uuid` PK, `workspace_id`, `telegram_chat_id bigint`, `bot_is_admin`, `verified_at`. Existing precedent for referencing it is `telegram_group_announcements.group_connection_id uuid null references ... on delete set null` alongside a denormalized `telegram_chat_id bigint not null` so history survives disconnection.
- `usage_ledger`: `id, workspace_id, user_id, action_type text, units, provider_cost numeric null, internal_cost numeric null, ai_job_id uuid null → ai_jobs, created_at`. RLS: member SELECT only; `grant select` to authenticated, `grant all` to service_role; index `(workspace_id, created_at)`. No `updated_at`, no generic reference columns, no idempotency key.

## 4. Minimal SE-1 migration shape (proposal only)

One migration, five new tables, all following the conventions above. `text` + CHECK, no new enums.

- `social_sources` — workspace FK; `platform text` CHECK in `('x','instagram','tiktok','youtube','facebook')`; `source_type text` CHECK in `('public_profile')` (leaves room for `oauth_account`); `canonical_url text not null`; `handle`, `external_account_id`, `provider_preference` nullable; `auto_detect_enabled boolean not null default false`; `polling_interval_seconds integer not null default 900` with a sane-bounds CHECK; `last_checked_at`, `provider_cursor`, `last_external_post_id` nullable; `metadata jsonb not null default '{}'`; unique `(workspace_id, platform, canonical_url)`.
- `social_posts` — workspace FK; `social_source_id` FK (`on delete cascade`); `platform` (same CHECK); `external_post_id text not null`; `canonical_url`; author/caption snapshot columns; `media_type text null` with CHECK; `published_at timestamptz null`; `metadata jsonb`; unique `(workspace_id, platform, external_post_id)`.
- `social_missions` — workspace FK; `social_post_id` FK (`on delete restrict`, history preservation); `status text not null default 'DRAFT'` CHECK in `('DRAFT','LIVE','COMPLETED','CANCELLED','FAILED')`; nullable baseline metric columns; `started_at`, `ends_at`, `completed_at`; mission copy columns with length CHECKs; `created_by uuid null references auth.users(id) on delete set null`; timestamps + `set_updated_at` trigger.
- `social_mission_targets` — workspace FK; `mission_id` FK cascade; `group_connection_id uuid null references public.telegram_group_connections(id) on delete set null` plus denormalized `telegram_chat_id bigint not null` (mirrors the announcements precedent); `telegram_message_id bigint null`; `delivery_state text` CHECK in `('PENDING','SENDING','SENT','FAILED','AMBIGUOUS')`; `last_error text` with length CHECK; `sent_at`, `updated_at`; unique `(mission_id, group_connection_id)`.
- `social_metric_snapshots` — workspace FK; `mission_id` FK cascade; `provider text not null`; `observed_at timestamptz not null default now()`; nullable `views/likes/comments/shares/saves` (bigint, never coerced to zero); `availability jsonb not null default '{}'`; `poll_bucket text not null`; unique `(mission_id, provider, poll_bucket)` as the charged-snapshot idempotency guard. Insert-only, no `updated_at` trigger.

`usage_ledger` extension: **not required for SE-1.** `action_type` already carries operation identity and `workspace_id` already scopes cost. An idempotency/reference column may be genuinely needed at SE-2 when real provider calls exist; deferring it avoids adding an unused nullable column now. Recommend deciding it in SE-2 against real adapter behavior.

## 5. Must NOT be duplicated

- No new tenancy, role, or membership table — use `workspaces`, `workspace_members`, `is_workspace_member` / `is_workspace_operator`.
- No new Telegram group-connection table, no second bot, no new chat identity model — FK to `telegram_group_connections`.
- No parallel broadcast/delivery ledger — `social_mission_targets` reuses the `telegram_group_announcements` status vocabulary and idempotency pattern; it does not replace or alter that table.
- No second cost ledger — reuse `usage_ledger`.
- No new enums, no new `updated_at` helper, no new `gen_random_uuid` wrapper, no new project-identity table.
- No Lovable Cloud or parallel backend; Supabase `ocoinbnjgstkmnwwvnhi` remains sole system of record.

## 6. Proposed RLS boundaries (not implemented)

- `social_sources`, `social_missions`, `social_mission_targets`:
  - SELECT `to authenticated` using `public.is_workspace_member(workspace_id, (select auth.uid()))`.
  - INSERT / UPDATE / DELETE `to authenticated` using and with check `public.is_workspace_operator(workspace_id, (select auth.uid()))` — owner/admin only, exactly the SE-0 role matrix.
  - Child rows resolve `workspace_id` directly (denormalized column) so no recursive policy lookups.
- `social_posts`, `social_metric_snapshots` — provider-observation tables:
  - SELECT for workspace members.
  - **No authenticated INSERT/UPDATE/DELETE policy at all.** Writes only via `service_role` grant. This enforces the worker boundary structurally rather than by convention.
- Grants: `revoke all ... from public, anon, authenticated, service_role`, then `grant select, insert, update, delete` to `authenticated` on the three operator-writable tables, `grant select` only on the two observation tables, `grant all` to `service_role` on all five. No `anon` grant on any social table.
- `force row level security` on all five, matching the launcher tables' posture.
- Browser never receives provider secrets, bot token or service-role key; nothing in this shape changes that.

## 7. Conflicts / risk flags

None material. Specific notes:
- No name collisions — no existing `social*` object in repo or live DB.
- Workspace `role` is free-text with only a default; `is_workspace_operator` hard-codes `('owner','admin')`. SE-1 inherits that contract unchanged; it does not widen or weaken it.
- `telegram_group_connections` rows can be removed on disconnect, so mission history must not depend on that FK surviving — hence the `on delete set null` + denormalized `telegram_chat_id`.
- Generated `src/integrations/supabase/types.ts` will change once (and only once) an SE-1 migration is authorized and applied. That is expected drift, to be disclosed.

## 8. Stop point

Audit only. Awaiting explicit authorization before writing any SE-1 migration. No schema, RLS, function, cron, Edge Function, provider, Telegram, UI, dependency or secret change was made.
