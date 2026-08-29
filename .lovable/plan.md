# Phase 1D Start-Gate Audit — Distribution Center + Sticker Pack Manager

Read-only. No files were edited. This is an audit and a proposed scope, not an implementation.

## 1. Repository state

- HEAD: `ecc9096` ("Update plan"), preceded by `af920df`, `9e739ea`.
- Working tree: clean (`git status --porcelain` empty).
- Phase 1C-8 containment work is in history; no uncommitted drift.

## 2. Current Distribution route and pack management UI

- `src/routes/_authenticated/distribution.tsx` — 37 lines, renders `PlaceholderPage` only. Status string `"Planned — not active"`, `availableNow` = ["Route and navigation entry", "Roadmap placement in OPERATIONS"], `plannedLater` = campaign/creator/outcome bullets. No data queries, no Telegram wiring.
- `src/lib/nav.ts` — Distribution still carries `status: "planned"`.
- There is no Sticker Pack Manager route. Pack surfaces today:
  - `sticker-lab.index.tsx` — workspace pack list via `listWorkspacePacks`, workflow rail, live/future capability copy.
  - `sticker-lab.new.tsx` — the 5-step builder (concepts → generation → review/export → Telegram publish → multi-group distribute).
  - There is no per-pack detail route; a pack is only reachable by re-entering the builder.

## 3. Telegram components and data helpers that already exist

- `src/components/cartel/TelegramGroupCard.tsx` (928 lines) — owns `useTelegramGroupSetup()` (query key `["telegram-group-link", workspaceId]`), `GroupReadiness` derivation (chat type, bot admin, change-info, `can_set_sticker_set`, member count, official-sticker eligibility), group linking/polling, and the 50-group selection cap persisted in `localStorage` under `cartelhq.telegram.groupTargets.<workspaceId>`.
- `src/components/cartel/TelegramConnectionCard.tsx` — personal account linking.
- `src/lib/telegram-group.ts` — `fetchTelegramGroupStatus`, `assignPackToGroup`, `sendGroupTestSticker`, `distributePackToGroups` (cap `MAX_DISTRIBUTION_TARGETS = 50`), `fetchPackGroupDistribution` → `TelegramPackGroupTarget[]` (status, last_error, announced_at, assigned_at, last_attempt_at).
- `src/lib/telegram-stickers.ts` — config/publish/refresh/send-test plus `loadPackTelegramState` (pack set name/url/publish error/published_at + per-sticker telegram state).
- `src/lib/sticker-packs.ts` — `listWorkspacePacks` (PackSummary with total/ready/active), `loadPack`, `loadPackStickers`, `loadAssets`, `hydrateDraftFromPack`, `classifyProviderError`, `loadLatestJobs`.
- `src/lib/media.ts` — `signedUrl` / `signedUrlMap` for private storage previews.
- Backend tables available read-side: `sticker_packs`, `stickers`, `telegram_group_connections`, `sticker_pack_group_targets` (SELECT only; INSERT/UPDATE/DELETE denied — the webhook / Edge Functions are the authoritative writers).

## 4. Phase 1C responsive primitives available for reuse

`PageHeader`, `Section` (primary/surface/plain), `InlineRow` (min-h-11, bounded meta/trailing), `StatusBadge` (gold/green/red/muted, self-truncating), `ScrollRail` (mask fade + snap), `StickyActionBar` (fixed above `--bottom-nav-h`), `EmptyState`, `PlaceholderPage`, `MobileTabBar` + `MOBILE_PRIMARY_ITEMS`, `AppShell`. Grid containers use `[&>*]:min-w-0`.

## 5. Scope reality check — what is buildable frontend-only

Buildable now against existing data:

- Connected groups roster with live readiness (reuse `useTelegramGroupSetup`).
- Per-pack distribution state from `sticker_pack_group_targets` (`fetchPackGroupDistribution`): assigned / announced / failed, last attempt, last error.
- Activity feed derived from `assigned_at` / `announced_at` / `last_attempt_at` / `updated_at`, sorted desc.
- "Sends today" as a derived count of target rows whose `assigned_at`/`announced_at` falls in the current UTC day.
- Manual re-distribute / assign / send-test using existing Edge Function actions.
- Published/draft pack overview and sticker gallery from `listWorkspacePacks`, `loadPackStickers`, `loadAssets`, `signedUrlMap`, `loadPackTelegramState`.

Not buildable frontend-only (blockers to state before design freeze):

- **Drop schedules, "next drop", recurring sends, pause/kill controls** have no backing table, no scheduler, and no Edge Function action. `sticker_pack_group_targets` is a one-shot distribution ledger with no schedule, cadence, next_run_at, or enabled flag. Delivering these as UI now would be demoware.
- **Per-group configuration** likewise has no writable store (`telegram_group_connections` is INSERT/UPDATE/DELETE denied to the client).

Recommendation: split Phase 1D.

- **1D-A (frontend-only, safe):** Distribution Center built strictly on real distribution-ledger + group-readiness data, plus the Sticker Pack Manager. No scheduling UI, no fake counters, no controls that do not map to an existing server action.
- **1D-B (requires an authorized backend contract):** drop schedules table + scheduler Edge Function + per-group config writes + pause/kill state machine. Frontend follows only after that contract exists.

## 6. Recommended frontend changes (1D-A)

Distribution Center (`/distribution`):

- Replace the placeholder with a live module page: `PageHeader` (eyebrow "Operations", status "Live Beta").
- Summary strip (`ScrollRail` on mobile, grid at lg): connected groups, distribution-ready groups, packs distributed, sends today — every tile derived from real rows, with an explicit empty state instead of zeros-as-decoration.
- Connected groups list: `InlineRow` per group, title/username, chat-type badge, readiness badge, last distribution outcome. Reuses `useTelegramGroupSetup` — no new Telegram logic.
- Per-pack distribution panel: pack selector limited to Telegram-published packs, then `fetchPackGroupDistribution` rows as assigned/announced/failed with error text collapsed behind a disclosure.
- Actions limited to existing server actions: re-run distribution for selected groups (`distributePackToGroups`, 50 cap preserved), assign as group set (`assignPackToGroup`), send test sticker (`sendGroupTestSticker`).
- Activity feed: chronological derived events from the target rows, `InlineRow` based, capped list length.
- Scheduling / pause / kill surfaces: represented as an explicit, honestly labelled "not yet available" note, not as disabled fake controls — or omitted entirely until 1D-B.

Sticker Pack Manager (`/sticker-lab/$packId`, new leaf under the existing `sticker-lab` layout):

- Pack header: title, theme, size, status badge (draft / ready / published), Telegram set link when present.
- Sticker gallery: 2-col mobile / 4-col lg, signed-URL thumbnails via `signedUrlMap`, per-sticker status and telegram publish state.
- Actions: open in builder (existing `hydrateDraftFromPack` path), open Telegram set, jump to Distribution for that pack. No new mutations.
- Pack list on `sticker-lab.index.tsx` gains rows linking into the manager.

## 7. Stale copy / status corrections

- `distribution.tsx`: "Planned — not active", the two `availableNow` roadmap bullets, and the placeholder framing are all stale once the module is live.
- `src/lib/nav.ts`: Distribution `status: "planned"` must drop once 1D-A ships. All other planned modules stay planned.
- `sticker-lab.index.tsx`: "Multi-group Telegram distribution" capability line should point at the new Distribution Center.
- Consider whether Distribution earns a `mobilePrimary` tab slot; the bar is already at five destinations, so this is a deliberate trade, not an automatic add.

## 8. Files that would change (1D-A)

- `src/routes/_authenticated/distribution.tsx` (rewrite)
- `src/routes/_authenticated/sticker-lab.$packId.tsx` (new)
- `src/routes/_authenticated/sticker-lab.index.tsx` (link rows into manager, copy)
- `src/lib/nav.ts` (status only)
- Possibly one new presentational component (e.g. `DistributionActivityFeed.tsx`) and one small read-only helper file for date/derivation utilities.
- Possibly `src/lib/telegram-group.ts` — only if a read-only "all packs" distribution query is required; if it is, it is a new read helper over an existing action, and if no such action exists server-side, that is a 1D-B blocker, not an improvisation.

## 9. Must NOT change

- Sticker generation pipeline, prompts, KIE/provider calls, `sticker-ai.ts`.
- Transparency validation and cutout logic (`sticker-export.ts`).
- Telegram publish, connect, link, launcher, webhook contracts, install URLs, polling, capability derivation, the 50-group cap, payload shapes, or any Edge Function.
- Auth, RLS, grants, schema, migrations, storage buckets, secrets.
- Existing route paths for `/sticker-lab`, `/sticker-lab/new`, `/telegram`.
- No publish/deploy.

## Stop point

Audit complete at `ecc9096`, tree clean. Awaiting a decision on the 1D-A / 1D-B split before any implementation contract is issued.
