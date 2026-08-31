# Phase 9 — Owner Console Moderation + Launch Analytics (implementation contract)

Start gate verified: HEAD `f25bc8b207992b65b44dd08fddf443f4c5ebccee`, clean tree. Zero edits made in this planning turn (only this plan file is written).

## Audit findings (verified this turn)

- `/admin` (`src/routes/_authenticated/admin.tsx`, 924 lines) is owner-gated by `usePlatformAccess()` and already contains: Unrestricted Platform Access, Project Verification (Phase 8A), Operational Controls, Telegram Bot Integration, Sticker Automation, Recent Drop Activity, Platform overview, Workspaces, Users, and message templates. Section pattern = `<Section>` + `InlineRow` + explicit loading/empty states.
- Owner authorization exists twice: server-side `public.is_platform_owner(uuid)` (SECURITY DEFINER over `platform_user_roles`) used by Phase 8A RPCs, and the `platform-admin` Edge Function used by `src/lib/platform.ts`. Phase 8A RPCs are the newer, cheaper pattern and are the one to reuse.
- Every public network RPC (`get_cartel_network_projects`, `..._project`, `..._project_launches`, `..._upcoming_launches`, `..._launch`, `..._signals`, `..._summary`) filters on `p.discovery_status = 'published'`. So suppressing a project at profile level already suppresses its project page, launch pages, upcoming list, signals rows and summary counts. No launch-level public surface bypasses it.
- `project_profiles.discovery_status` is **operator-writable** from `/project-profile` via `saveProjectProfile()` — the workspace owner can set it back to `published` at will.
- `project_platform_reviews` is the existing service-private, owner-only review table with a state machine (`pending|verified|rejected|revoked`) and a trigger that clears stale reviews on material identity change.
- Analytics-capable tables already exist: `project_profiles`, `launches` (lifecycle timestamps), `launch_watch_subscriptions` (`is_active`, `reminders_enabled`, `subscribed_at`, `confirmation_status`), `launch_events`, `launch_notification_deliveries` (`status`, `attempt_count`), `telegram_group_connections`, `telegram_community_settings`. Existing `get_platform_owner_dashboard_metrics()` covers stickers/AI/usage but has **no** launch, watch, delivery or network-visibility metrics.

## 1. Recommended moderation model — Option B (service-private record)

Do **not** overload `discovery_status = 'hidden'`. It is operator-owned state; a moderated project could immediately re-publish itself, and the owner could not distinguish "operator chose hidden" from "platform hid this". Instead add a separate service-private table:

`public.project_network_moderation`
- `project_profile_id uuid pk references project_profiles(id) on delete cascade`
- `is_hidden boolean not null default false`
- `internal_reason text` (never public)
- `hidden_at timestamptz`, `hidden_by uuid`, `restored_at timestamptz`, `restored_by uuid`
- `created_at`, `updated_at`

RLS enabled, **no grants to `anon` or `authenticated`** (same shape as `project_platform_reviews`); only SECURITY DEFINER RPCs and `service_role` touch it. Hiding writes a row; restoring flips `is_hidden=false` and keeps history. Nothing is deleted, so launches, watch subscriptions, notification history, verification, sticker and Telegram data are untouched.

**Launch-level moderation: not needed.** Project-level hiding already suppresses every public surface (verified above). No extra state.

## 2. Exact new/changed database functions

New (all `SECURITY DEFINER`, `SET search_path = public`, owner derived from `auth.uid()` via `is_platform_owner`, `EXECUTE` granted to `authenticated` only):
- `public.set_project_network_moderation(_project_profile_id uuid, _hidden boolean, _internal_reason text default null)` → returns the resulting moderation row fields. Fails closed with `42501` for non-owners; `P0002` if the profile does not exist.
- `public.get_platform_network_moderation()` → owner-only directory: project slug, name, ticker, chain, `discovery_status`, `is_hidden`, `internal_reason`, `hidden_at`, `restored_at`, verification status, launch count. No user ids, no workspace ids.
- `public.get_platform_launch_analytics()` → single owner-only aggregate payload (section 5).

Changed (add one predicate each — public visibility must respect hiding immediately):
`get_cartel_network_projects`, `get_cartel_network_project`, `get_cartel_network_project_launches`, `get_cartel_network_upcoming_launches`, `get_cartel_network_launch`, `get_cartel_network_signals`, `get_cartel_network_summary` — each gains
`and not exists (select 1 from public.project_network_moderation m where m.project_profile_id = p.id and m.is_hidden)`.
Signatures, return columns and all other logic stay byte-identical otherwise.

## 3. Frontend files likely to change

- `src/lib/platform-moderation.ts` (new) — typed fetch/mutate wrappers over the two moderation RPCs.
- `src/lib/platform-analytics.ts` (new) — typed wrapper over the analytics RPC.
- `src/routes/_authenticated/admin.tsx` — two new `<Section>`s: **Network Moderation** (list, Hide/Restore with confirmation dialog + optional internal reason, loading/error+Retry/empty states) and **Launch Analytics** (aggregate metric tiles + per-launch table, same state discipline). Placed after Project Verification. No redesign of existing sections.
- `src/integrations/supabase/types.ts` — regenerated after the migration (generated file, not hand-edited).

## 4. Migration required

Yes — one migration: create the table + grants (`service_role` only) + RLS, create the three new RPCs, and `CREATE OR REPLACE` the seven public network RPCs with the added predicate.

## 5. Launch analytics metrics and backing conditions

Network / projects
- projects total; published (`discovery_status='published'`); hidden by operator (`='hidden'`); hidden by platform (`project_network_moderation.is_hidden`); verified (`project_platform_reviews.status='verified'`); pending review.

Launches
- total launches; count grouped by each lifecycle `status`; launches with a scheduled `launch_at`; launches with `official_contract_address` registered.

Launch Watch (aggregates only)
- active subscriptions (`is_active`), inactive/stopped, reminders enabled vs muted, distinct launches with at least one active watcher, opt-ins in last 7/30 days (`subscribed_at`).

Notifications
- `launch_events` count total and per launch; `launch_notification_deliveries` grouped by `status` (sent / pending / failed) and count with `attempt_count > 1`.

Per-launch table (top N by active watchers)
- launch slug, token name, chain, status, `launch_at`, active watchers, muted watchers, events emitted, deliveries sent/failed.

Community readiness (already available, cheap)
- connected groups total; groups with `welcome_enabled`; groups with `launch_watch_cta_enabled`.

Explicitly excluded: price, volume, market cap, PnL, engagement scores, social metrics, risk/safety scores.

## 6. Privacy / security rules

- No `telegram_user_id`, subscription id, user id or workspace id ever leaves the RPCs — counts and public slugs only.
- `internal_reason` is returned only by the owner-only moderation RPC, never by any public RPC.
- Owner enforcement is inside every RPC body (`is_platform_owner(auth.uid())`), not by hiding buttons.
- Hide/restore is reversible and non-destructive; restoring changes visibility only — it never sets verification status or touches launch lifecycle.
- All new functions pin `search_path`, are `STABLE`/`VOLATILE` as appropriate, and fail closed.

## 7. Test / acceptance checklist

- `bunx tsgo --noEmit` and `bun run build` pass.
- Live DB: confirm the three new functions exist with `SECURITY DEFINER` + pinned `search_path`; confirm `project_network_moderation` has RLS on and zero `anon`/`authenticated` grants.
- Authorization: non-owner call to each new RPC raises `42501`.
- Visibility: hide a published project → `get_cartel_network_projects`, `..._project`, `..._launch`, `..._signals`, `..._summary` all stop returning it; restore → all return it again with unchanged verification status and lifecycle.
- Data preservation: row counts for `launches`, `launch_watch_subscriptions`, `launch_notification_deliveries`, `project_platform_reviews` unchanged across hide/restore.
- Analytics payload contains no id-like or Telegram fields (explicit key inspection).
- UI: loading, error+Retry, and genuine empty states render in both new sections; responsive at 375px.
- CARTEL HQ remains unpublished; no Edge Function deploy.

## 8. Prohibited scope

No parallel admin role or second backend; no Lovable Cloud. No delete/suspend/ban, no risk or safety scores, no KYC/KYB, no blacklists, no automated enforcement. No edits to project-authored profile or launch content. No changes to Launch Watch subscription behavior, launch lifecycle semantics, Telegram flows/webhook, Sticker Lab, Sticker Drops, auth, billing, or the public marketing site. No publish, no deploy, no package/lockfile changes, no changes to existing sections of `/admin` beyond adding the two new ones.

## 9. Recommended atomic subphases

- **9A — Moderation backend**: migration (table + grants + RLS + `set_project_network_moderation` + `get_platform_network_moderation` + the seven public RPC predicate updates), types regen, live visibility verification. No UI.
- **9B — Moderation UI**: `src/lib/platform-moderation.ts` + the Network Moderation section in `/admin` with confirmation dialog.
- **9C — Launch analytics backend**: migration adding `get_platform_launch_analytics`, types regen, payload privacy inspection.
- **9D — Launch analytics UI**: `src/lib/platform-analytics.ts` + the Launch Analytics section in `/admin`.

Each subphase ends at its own checkpoint; 9A must pass live visibility checks before 9B.

## 10. Zero edits confirmation

No code, database, migration, Edge Function, config, data or deployment change was made in this turn. The only file written is `.lovable/plan.md`.
