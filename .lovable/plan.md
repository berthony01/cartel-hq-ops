# Community Command Center — Unification Audit (read-only)

No files were edited. No Supabase, Telegram, X, deploy or publish action was taken.

## 0. Gate check — DRIFT DISCLOSED

- Expected start gate: `e286a496ace1000e21826ee4331e5f158bb2cc51`
- Actual HEAD: `99458c4ce3193db9b831cdb81c93f25b3da583dd` ("Work in progress", gpt-engineer-app bot, 2026-09-13 21:44 UTC)
- Working tree: clean.
- Diff `e286a49..HEAD` = exactly one file: `src/integrations/supabase/types.ts`, +116/−0 — generated types picking up the now-installed SE-4B schema (`social_mission_schedule_events`, `claim_due_social_mission_schedule_events`, etc.).

This is platform type regeneration after the live SQL apply, not hand-authored code drift. No source, config, SQL or script file changed. Audit proceeds on `99458c4`; confirm this SHA as the new start gate before any build.

## 1. Current surfaces

Route: `/telegram` — `src/routes/_authenticated/telegram.tsx` (556 lines), titled **Community Command**, workspace-scoped via `useWorkspace()`, with validated search params `tab` / `launch` / `conversation`.

Six tabs (`TABS`, lines 98–105):

| Tab | Content | Backing component |
|---|---|---|
| Overview | Launch readiness callout, pending schedule-change decisions, community state metrics, attention list, next step | `LaunchReadinessCallout`, `Section`, `StatusBadge` |
| Broadcasts | Watcher updates + one official community post per launch | `BroadcastsPanel` |
| Audience | Launch Watch watcher aggregates per launch | `AudiencePanel` |
| Inbox | Project Inbox conversations (private replies to bot messages) | `ProjectInboxPanel` |
| Communities | Connected Telegram groups, connect/link flows (`forceMount`) | `TelegramGroupCard` + `useTelegramGroupSetup`, `useTelegramSetup` |
| History | Placeholder only, no data | `ComingSoonPanel` (local) |

Related but separate routes/nav entries (`src/lib/nav.ts`):
- Community section: `Community Command` → `/telegram`; `Sticker Drops` → `/distribution` (subordinate).
- Network section: `My Watchlist` → `/watchlist` (personal opt-ins, read-only RPCs); `Cartel Network` → `/network` (public).
- Owner Tools (ownerOnly, presentation gate only): `/admin`, `/chain-launcher`, `/mainnet-canary`.
- `/analytics` and `/operations` exist as `PlaceholderPage` routes but are **not** in nav at all.

Social Mission UI today: **none for customers.** The only mission UI is two owner-console panels rendered at the bottom of `/admin`: `SocialMissionTestControl` and `BrandedSocialMissionTestControl`, both hard-pinned to the single fixture (`pepe_cartel_community_v1`, one X URL, one group title). Mission creation for customers happens entirely in Telegram via `/mission <X link>` and `/mission close`.

## 2. Who sees what today

Project owners/admins (workspace operators):
- Telegram connection health, connect/link flow, welcome + Launch Watch CTA config, Sticker Drops.
- Broadcasts (watcher updates, one official group post), Audience aggregates, Inbox conversations.
- Launch readiness guidance; personal Launch Watch list at `/watchlist`.
- Zero visibility into Social Missions — no status, no history, no close control in HQ.

Platform owner only (`usePlatformAccess`, server-verified, fails closed):
- `/admin`: platform metrics, verification review, production request queue, platform message editor, scheduler health, and the two fixture-pinned mission test controls.

The gap this phase closes: missions are live in Telegram and in the database, but a customer admin has no product surface at all — and the only existing surface is the diagnostics console they must never be sent to.

## 3. Where Social Missions belong

Inside `/telegram` as a **new tab between Broadcasts and Audience**, not a new route. Rationale: Community Command is already the workspace-scoped umbrella with launch/conversation search-param plumbing, the same Telegram group data missions target, and the same operator authorization surface. A separate `/missions` route would duplicate the group/workspace context and split the community story.

No duplicate systems: the mission tab is **read-only over existing tables**. Creation stays `/mission <X link>` in Telegram; closing stays `/mission close`. HQ observes.

## 4. Smallest V1 unification

Keep the route and URL (`/telegram`, all existing `to="/telegram"` links unchanged). Retitle the page to **Community Command Center** and set the tab set to:

`Overview | Telegram | Missions | Broadcasts | Inbox | Launch Watch | Analytics`

Mapping — mostly renames of existing tabs, one new tab, one moved placeholder:

- **Overview** — unchanged, plus one compact read-only mission strip (active mission count, next pulse, last completion) linking into Missions.
- **Telegram** — the current `Communities` tab content, renamed. `forceMount` behavior preserved exactly.
- **Missions** — NEW. Read-only list from `social_missions` joined to `social_mission_targets` (+ `social_posts` for the canonical URL) for the active workspace: status, started/ends, delivery + edit state, target community, and per-mission pulse timeline from `social_mission_schedule_events`. No send, no close, no create, no polling, no provider call. Explicit copy: missions are started and closed with `/mission` in Telegram.
- **Broadcasts** — unchanged.
- **Inbox** — unchanged.
- **Launch Watch** — the current `Audience` tab renamed (it already shows Launch Watch watcher aggregates).
- **Analytics** — read-only summary placeholder built from data already loaded on the page (community counts, mission counts by status, watcher aggregates). No new queries, no new backend.

Dropped from the tab bar: `History` (placeholder with nothing behind it; its copy is superseded by Missions' own timeline). Keep `TAB_KEYS` backward-compatible so `?tab=audience`, `?tab=communities` and `?tab=history` still resolve instead of 404-ing into Overview silently.

Out of scope, explicitly: Contributors, Connect X / OAuth, pricing/billing, any new Telegram send, any mutation of mission state from the browser.

## 5. Reuse

Already present, reuse as-is:
- `useWorkspace()` / `WorkspaceProvider` — workspace scoping and multi-project switching.
- `useTelegramSetup`, `useTelegramGroupSetup`, `TelegramGroupCard`.
- `BroadcastsPanel`, `AudiencePanel`, `ProjectInboxPanel`, `LaunchReadinessCallout`.
- Presentation kit: `Section`, `StatusBadge`, `InlineRow`, `EmptyState`, `PageHeader`, `RelatedLinks`, `Tabs`.
- `usePlatformAccess` — stays confined to `/admin`; not used to gate anything customer-facing here.

Data access — no new backend required. RLS + grants already allow the browser to read everything Missions needs as a workspace member:
- `social_missions` — `GRANT SELECT ... TO authenticated`, policy `social_missions_select_member` (`is_workspace_member`).
- `social_mission_targets` — same pattern (`social_mission_targets_select_member`).
- `social_mission_schedule_events` — `GRANT SELECT`, policy `social_mission_schedule_events_select_member` (installed with SE-4B, now live).
- `social_posts`, `social_metric_snapshots` — member SELECT policies for canonical URL and any metric display.

So a single new read module (`src/lib/social-missions.ts`) with TanStack Query is sufficient. Mission `status`, `started_at`, `ends_at`, `completed_at`, `created_by`, `metadata` all exist in the generated types.

## 6. Proposed build contract (for approval, not yet executed)

Start gate: `99458c4ce3193db9b831cdb81c93f25b3da583dd`, clean tree.

Allowlist (edit only):
- `src/routes/_authenticated/telegram.tsx`
- `src/components/cartel/SocialMissionsPanel.tsx` (new)
- `src/components/cartel/CommunityAnalyticsPanel.tsx` (new)
- `src/lib/social-missions.ts` (new, read-only queries + query keys)
- `src/lib/nav.ts` (label only: "Community Command" → "Community Command Center"; mobile label unchanged)
- `scripts/` — one new source-level regression script for this phase
- `docs/` — one new phase document

Prohibited:
- Any SQL, migration, RPC, RLS, grant, storage, secret or cron change.
- Any edit to `src/integrations/supabase/types.ts`, `supabase/functions/**`, `backend-source/edge-functions/**`, `supabase/config.toml`.
- Any edit to `/admin`, the two mission test controls, `BroadcastsPanel`, `AudiencePanel`, `ProjectInboxPanel` internals, Launch Control, Sticker, watchlist or network routes.
- Any write to mission tables from the browser; any Telegram send, X/provider call, OAuth, polling loop, contributor or billing surface.
- No deploy, no publish, no package/lockfile change.

Tests to run at the end:
- `bun scripts/<new>-regression.ts`
- `bun scripts/se4b-mission-lifecycle-pulse-regression.ts`
- `bun scripts/se4a-mission-command-regression.ts`
- `bunx tsgo --noEmit`
- `bun run build`

Stop point: report exact pass counts, changed files and the resulting commit SHA, then STOP. No deploy, no publish, no live verification in that phase.

## 7. Unresolved / needs your decision

1. Confirm `99458c4` as the start gate given the types-only drift.
2. Confirm dropping the `History` tab (vs. keeping it as a seventh placeholder).
3. Confirm the nav label change is wanted, or keep "Community Command" in the sidebar and only retitle the page.
