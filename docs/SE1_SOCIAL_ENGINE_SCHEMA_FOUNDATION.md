# SE-1 — Cartel Social Engine Schema / RLS Foundation

Status: **APPLIED TO AUTHORITATIVE SUPABASE, REPOSITORY RECONCILED**
Phase: SE-1 (schema + RLS only)
Architecture authority: `docs/SE0_SOCIAL_ENGINE_ARCHITECTURE_LOCK.md` (frozen, unmodified)

External Supabase `ocoinbnjgstkmnwwvnhi` remains the only backend system of record.
The migrations were applied by the owner through the Supabase connector. This repository
turn performed **no database writes** — Supabase access was read-only verification only.

---

## 1. Applied migrations

| Remote version | Name |
| --- | --- |
| `20260912222624` | `se1_social_engine_schema_foundation` |
| `20260912222700` | `se1_social_engine_target_integrity_hardening` |

### Repository parity note

Direct writes into `supabase/migrations/` are blocked by the build platform, which
reserves that directory for its own migration tool. Faithful parity copies are therefore
stored alongside the project's existing parity SQL:

- `docs/sql/20260912222624_se1_social_engine_schema_foundation.sql`
- `docs/sql/20260912222700_se1_social_engine_target_integrity_hardening.sql`

Both files are audit copies only and must never be reapplied blindly.

---

## 2. Tables introduced

`social_sources`, `social_posts`, `social_missions`, `social_mission_targets`,
`social_metric_snapshots` — all `public` schema, all workspace-scoped, `text` + named
CHECK constraints (no new Postgres enums), `set_updated_at` triggers where mutable.

## 3. Authorization boundary (verified live)

- Member SELECT on all five tables via `public.is_workspace_member`.
- Owner/admin writes via `public.is_workspace_operator` on `social_sources`,
  `social_missions` and `social_mission_targets`.
- Mission delete and mission-target delete restricted to `status = 'DRAFT'`.
- `social_posts` and `social_metric_snapshots` are observation tables: authenticated has
  SELECT only and **no write policy exists**; writes are structurally service-role only
  (`social_posts`: SELECT/INSERT/UPDATE, `social_metric_snapshots`: SELECT/INSERT).
- RLS enabled **and forced** on all five tables. No `anon` grant on any of them.

## 4. Mission-target integrity (final state)

The hardening migration replaced the intermediate policy text from the first migration.
Final enforcement:

- Composite FK `(group_connection_id, workspace_id, telegram_chat_id)` →
  `telegram_group_connections(id, workspace_id, telegram_chat_id)`
  `ON DELETE SET NULL (group_connection_id)` — same workspace and exact Telegram chat are
  enforced by the database, not by policy text.
- Insert requires a non-null group connection.
- Mission history survives a community disconnect because `telegram_chat_id` is retained.

QA must evaluate the **final combined state**; the first migration's unqualified
correlated policy names are intentional historical parity, immediately corrected.

## 5. Verified live invariants (read-only)

- All five tables exist; zero rows in each at reconciliation time.
- `relrowsecurity` and `relforcerowsecurity` true on all five.
- Grant ACLs match the intent above; no `anon` entry on any social table.
- `usage_ledger` unchanged (9 columns, original ACL). No SE-1 ledger extension.
- `auto_detect_enabled` defaults `false`. No cron job, no provider adapter, no Edge
  Function, no Telegram behavior and no UI exists for the Social Engine.

## 6. Regression

`scripts/se1-social-engine-schema-regression.ts` — source-only, no database access.
54 checks covering table presence, forced RLS, anon exclusion, member reads, the
operator write boundary, DRAFT-only deletes, the observation-table read-only boundary,
the hardened composite FK, nullable metrics, snapshot idempotency and scope lock
(no cron, no HTTP, no SECURITY DEFINER, no enums, no `usage_ledger` change).
Result: all checks passed.

## 7. Stop point

SE-1 is schema and RLS only. Do not proceed to SE-2 (`SocialReadProvider` foundation and
one approved read-provider adapter) without a separate start gate. No provider selection,
pricing, cost ceiling or polling behavior is approved by this phase.
