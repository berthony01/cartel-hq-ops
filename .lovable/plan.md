# Stage 1 — Public Entry (plan only)

Start gate: HEAD `b28d0950b999e0881ee904b777ebe665ffd2491b`, clean tree (confirmed). Stop if it differs.

## Goal
`https://pepecartelhq.com/` becomes a public product landing page. The private command center moves to `/dashboard`. Sign-in stays private-beta, sign-in only. No billing, Stripe, secrets, Supabase functions, database, Telegram, or PCART changes.

## Current state (verified)
- `/` is served by `src/routes/_authenticated/index.tsx` (`createFileRoute("/_authenticated/")`), so anonymous visitors are sent to `/auth`.
- No top-level `src/routes/index.tsx` exists.
- Links and redirects that assume `/` means the dashboard:
  - `src/routes/auth.tsx` `safeRedirect` falls back to `"/"` on 3 lines (default sign-in destination)
  - `src/routes/auth_.callback.tsx:75` `navigate({ to: "/" })` after invite/recovery
  - `src/lib/nav.ts:48` HQ item `to: "/"` (sidebar + mobile tab bar)
  - `src/components/cartel/SidebarNav.tsx:67` logo link `to="/"`
  - `src/components/cartel/AppShell.tsx:59` `dashboard = pathname === "/"` (dashboard-only layout)
  - `src/components/cartel-network/NetworkShell.tsx:63,93,119` "Back to CARTEL HQ" `to="/"`
  - `src/routes/__root.tsx:29,73` and `src/lib/error-page.ts:28` "Go home" (these can stay `/`, since the public page makes sense there)

## Route collision risk (most important)
Keeping `_authenticated/index.tsx` and adding `src/routes/index.tsx` together creates two routes for `/`, and the route generator then fails the whole app. The move must be one step: rename `_authenticated/index.tsx` to `_authenticated/dashboard.tsx` and create the new public `src/routes/index.tsx` in the same batch, before any build runs. `routeTree.gen.ts` rebuilds itself and is never edited by hand.

## Changes (exact files)
1. `mv src/routes/_authenticated/index.tsx src/routes/_authenticated/dashboard.tsx`. Change its route id to `createFileRoute("/_authenticated/dashboard")`. Update its `head()` title to "Dashboard — CARTEL HQ". No other logic changes.
2. New `src/routes/index.tsx` (public, SSR-rendered, no Supabase queries, no session reads when rendering):
   - Top bar: CARTEL HQ mark, "Explore the network" (`/network`), "Sign in" (`/auth`).
   - Hero: CARTEL HQ as the operating layer for crypto project teams. Primary CTA "Sign in", secondary "Explore the network".
   - Feature grid, factual and current only: Project Profile, Launch Control (lifecycle, schedule, official contract registration), Launch Watch + Telegram reminders, Community Command (welcome, Launch Watch card, Sticker Drops), Sticker Lab. Trust wording: "Official contract registered by the authenticated project". No safety, audit or endorsement claims.
   - Pricing overview: Free ($0: Project Identity and profile, 1 Telegram group, welcome setup) and Cartel HQ Pro ($49/month, using the existing BillingSection wording). No buy button. The note reads "Private beta — sign in to manage your plan."
   - Footer: private beta note.
   - Its own `head()` with title, description, og:title, og:description, og:type, twitter:card. No og:image.
   - Uses existing tokens and fonts (Bebas Neue/Sora, black/charcoal/gold/ivory) and existing `Button`/`buttonVariants`. No new dependencies, no generated images.
3. `src/routes/auth.tsx`: the 3 `safeRedirect` fallbacks become `"/dashboard"`. Also map an explicit `redirect="/"` to `/dashboard` so old bookmarks still land in the app.
4. `src/routes/auth_.callback.tsx:75`: `to: "/dashboard"`.
5. `src/lib/nav.ts:48`: HQ `to: "/dashboard"`.
6. `src/components/cartel/SidebarNav.tsx:67`: logo `to="/dashboard"`.
7. `src/components/cartel/AppShell.tsx:59`: `pathname === "/dashboard"`.
8. `src/components/cartel-network/NetworkShell.tsx` (3 links): keep `to="/"`. The landing page is the right "Back to CARTEL HQ" target for public visitors, and signed-in users reach the dashboard with one click. This file is listed for review only and does not change.

Not changed: `__root.tsx` 404/error "Go home", `error-page.ts`, `_authenticated/route.tsx` gate, `/tg`, `/network`, billing, everything else.

## Risks
- Duplicate `/` route: handled by doing the rename and the new file in one step (see above).
- Hidden `"/"` assumptions: before finishing, re-run `rg 'to="/"|to: "/"|pathname === "/"'` and confirm only the intended public links remain.
- Signed-in users opening `/` now see the landing page, not the dashboard. Proposed: a small client-only effect that shows "Open Dashboard" instead of "Sign in" when a session exists. It is a label swap only, not an auto-redirect, and exposes no data. Say if you'd rather skip this.
- Old deep links/bookmarks to `/` for operators: they now hit the landing page, which is one click away from the dashboard. `redirect=/` is mapped as described in step 3.
- `preview-server-bundle-regression.ts` renders `/` against the built server. It should now render the public page. Expected to still pass, but it must be re-run.
- Private data: the public route imports no Supabase client queries or workspace context. Verified by source check.
- Telegram Mini App (`/tg`) and Supabase email links are not affected (the callback path is unchanged).

## Verification
- `git diff --check`
- `bunx tsgo --noEmit`
- `bun run build`
- `bun scripts/preview-server-bundle-regression.ts`
- `bun scripts/p1a-project-journey-regression.ts`
- `bun scripts/project-identity-gate-regression.ts`
- `bun scripts/project-identity-gate-b-regression.ts`
- `bun scripts/community-command-center-unification-regression.ts` (nav)
- Source checks: exactly one route resolves to `/`; `src/routes/index.tsx` has no supabase/workspace imports; allowlist diff matches the 7 edited/renamed files plus 1 new file.
- Browser: signed out, `/` renders the landing page at 1440/768/390, `/dashboard` redirects to `/auth?redirect=/dashboard`, `/network` still works. Signed-in checks are unavailable (external auth) and will be reported as a limitation.
- Not published. Stop after Stage 1 verification.
