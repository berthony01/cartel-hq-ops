# Phase 1C — Responsive Application System (audit + plan)

Read-only audit complete. No files were edited.

## 1. Current-state inventory

### Shell and global
- `src/routes/_authenticated/route.tsx` — auth gate, `WorkspaceProvider`, `AppShell`.
- `src/components/cartel/AppShell.tsx` — fixed 64-wide desktop sidebar (`lg:flex`), mobile `Sheet` drawer, `TopBar` (hamburger, mark, `WorkspaceSwitcher`, disabled search input, disabled bell, `UserMenu`), main `max-w-6xl px-4 py-8 md:px-6 lg:py-10`. Footer copy hard-codes "Phase 1A. Sticker Lab, Brand Kit and Assets are wired to the backend."
- `src/components/cartel/SidebarNav.tsx` + `src/lib/nav.ts` — single nav source, 15 items in 5 sections, `status: "next" | "planned"` flags.
- `src/styles.css` — Tailwind v4 `@theme inline`, full oklch black/gold/red/green palette, `cartel-panel`, `hover-lift`, `rise-in`, Bebas/Sora fonts. Tokens are healthy; no mobile-specific tokens (gutter, safe-area, touch target, density).

### Routes (all under `/_authenticated`)
| Route | State | Mobile issues |
|---|---|---|
| `/` (index, 349 ln) | Live data (packs, ai_jobs count, telegram_connections) | Stale `status="Phase 1A · Foundation live"`; 3 giant quick-action cards; "Telegram publishing is not configured in this phase" (false); 5-card roadmap block marks Telegram/Brand Kit/Assets "Planned" though live |
| `/sticker-lab` index (198 ln) | Live | `status="Live · Telegram pending"` stale; horizontal 5-step arrow flow wraps badly |
| `/sticker-lab/new` (2878 ln) | Live, 5-step builder | Wrap-flex stepper, 12–24 full concept forms stacked, non-sticky Back/Continue at page bottom, `md:grid-cols-2` form stacks, always-expanded diagnostics |
| `/brand-kit` (455 ln) | Live | `md:grid-cols-2/3` form grids collapse to long single column |
| `/assets` (243 ln) | Live | `md:grid-cols-[220px_1fr]` uploader, 4-col gallery |
| `/telegram` (87 ln) | Live | Hosts `TelegramConnectionCard` (315 ln) + `TelegramGroupCard` (910 ln) — the densest mobile surface |
| `/settings` + 10 module routes | Placeholder via `PlaceholderPage` | Two equal-weight cards, no mobile density rule |

### Shared components
`PageHeader`, `PlaceholderPage`, `EmptyState`, `StatusBadge`, `AssetUploader`, `WorkspaceSwitcher`, `UserMenu`, `TelegramConnectionCard`, `TelegramGroupCard`, plus builder-local `Stepper`, `StepCard`, `Notice`, `Pipeline`, `SummaryRow`, `SummaryStat`, `FailureBlock`.

### Breakpoint / density findings
- Only `sm/md/lg/xl` used; no `xs`-first reasoning — layouts are desktop grids that degrade to one long column.
- Every content block is a `Card.cartel-panel`, so nothing reads as primary vs secondary on a phone.
- No bottom navigation, no sticky action bars, no safe-area insets, no scroll-snap rails.
- Touch targets are mostly `min-h-11` already (good baseline to keep).

### Authoritative statuses already available (replaces hard-coded phase copy)
- `sticker_packs` rows + `status` column (per-workspace, already queried on `/` and `/sticker-lab`).
- `ai_jobs` count (already queried).
- `telegram_connections` row for the user (already queried on `/`) — gives real Linked/Not linked.
- `telegram-link` `group_status` and `telegram-stickers` pack metadata (already used in `TelegramGroupCard` / builder step 5) — gives real group + published state.
- `NAV_SECTIONS[].status` — single source for module state; the HQ roadmap block duplicates it wrongly and should read from it.

## 2. Proposed shared system

New files (small, token-driven, no logic):
- `src/components/cartel/MobileTabBar.tsx` — fixed bottom nav: HQ / Sticker Lab / Assets / Telegram / More; "More" opens the existing `Sheet` with the full `SidebarNav`. Driven by `src/lib/nav.ts` (add a `mobilePrimary` flag — data only).
- `src/components/cartel/StickyActionBar.tsx` — bottom-docked action container with safe-area padding, sits above the tab bar; used by the builder and any future form.
- `src/components/cartel/Section.tsx` — surface hierarchy primitive: `variant="primary" | "surface" | "plain"`, so secondary content becomes inline rows instead of cards on mobile.
- `src/components/cartel/InlineRow.tsx` — label / value / status row (recent packs, roadmap, diagnostics).
- `src/components/cartel/ScrollRail.tsx` — horizontal snap rail for references/steps/thumbnails.

Token additions in `src/styles.css` (additive only): `--gutter-mobile: 1rem`, `--tap-min: 2.75rem`, `--bottom-nav-h`, `@utility app-gutter`, `@utility safe-bottom`, `@utility touch-target`.

Modified shared components: `AppShell` (mobile tab bar + bottom padding + compact 56px top bar; desktop unchanged), `PageHeader` (compact mobile variant, smaller display type, status inline), `PlaceholderPage` (single-column inline lists on mobile), `StatusBadge` (compact size).

## 3. Route migration matrix
| Route | Change |
|---|---|
| `_authenticated/route.tsx` | none |
| `/` | compact workspace summary, 2-col quick actions, small metric row, recent packs as `InlineRow`s, roadmap collapsed and sourced from `NAV_SECTIONS`; replace stale phase/Telegram copy with live query state |
| `/sticker-lab` | `ScrollRail` workflow strip, data-derived status, pack list as inline rows |
| `/sticker-lab/new` | compact progress rail + current-step label, `StickyActionBar` for Back/Continue, `ScrollRail` references, collapsible concept rows, gallery grid on step 4, step 5 summary with diagnostics in an accordion |
| `/brand-kit`, `/assets` | gutter + grid pass, uploader stacks cleanly, gallery `grid-cols-2` on mobile |
| `/telegram` | group/connection cards adopt `Section` + collapsed diagnostics; **no change to link/group/publish logic** |
| `/settings` + 10 placeholders | inherit new `PlaceholderPage` — zero per-route edits |

## 4. Risk areas and regression checks
- **Highest risk:** `sticker-lab.new.tsx` (2878 ln). Presentation-only edits; every handler, query key, Supabase call, KIE call and Telegram invocation stays byte-identical. Verify by diffing that no `supabase.`/`invoke(` line changed.
- `TelegramGroupCard.tsx` (910 ln): only wrappers/visibility change; polling, launcher, 50-group cap, `can_set_sticker_set` logic untouched.
- Sticky bars must not cover the last form control (bottom padding equal to bar + safe area).
- Checks per phase: `tsgo` typecheck, production build, and browser passes at 390px / 768px / 1440px on `/`, `/sticker-lab/new` (all 5 steps), `/telegram`, `/assets`.

## 5. Phased implementation order
1. **1C-1 Tokens + shell** — styles.css additions, `AppShell`, `MobileTabBar`, nav flag, compact top bar.
2. **1C-2 Shared primitives** — `Section`, `InlineRow`, `ScrollRail`, `StickyActionBar`, `PageHeader`/`PlaceholderPage`/`StatusBadge` responsive variants. Ships the whole placeholder set for free.
3. **1C-3 HQ dashboard** — layout rework + stale-copy removal using existing queries and `NAV_SECTIONS`.
4. **1C-4 Sticker Lab index + Brand Kit + Assets** — rail, grids, gutters.
5. **1C-5 Sticker Lab builder** — progress rail, sticky actions, collapsible concepts, gallery, collapsed diagnostics. Largest phase, done last against a proven system.
6. **1C-6 Telegram surfaces** — `Section` adoption and diagnostics collapse.

Each phase is its own commit with typecheck + build + viewport verification; nothing is published.

Constraints honoured: no backend/schema/contract/Edge Function/storage/auth changes, no route URL changes, no feature removal, shared components over one-off CSS.
