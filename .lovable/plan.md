# Cartel HQ UI Phase 2 — Dashboard

## Scope
- Redesign only the authenticated HQ Dashboard and any dashboard-only presentation components it requires.
- Preserve every existing query, route, workspace boundary, owner filter, lifecycle rule, and operational safety state.
- Keep the existing 16-stage Project Journey as the sole source of progress and next-action truth.

## Implementation
1. Compose a premium command-center dashboard with:
   - project/workspace heading and context
   - compact active-launch status surface
   - journey progress and one authoritative next-action control
   - three live metric surfaces for Launch Watch, Communities, and Sticker Drops
   - a 2:1 lower layout for Launch Readiness, Operator Focus, and Live Operations
2. Add a dashboard-specific journey presentation that reuses `useProjectJourney`, preserves stage status/dependency wording, deep links, and primary launch selection, and keeps completed stages expandable.
3. Retain real attention alerts and recent sticker packs lower in the hierarchy.
4. Preserve truthful loading, unavailable, no-project, no-profile, no-launch, blocked, and completed states. No mock metrics or invented actions.
5. Keep the existing brand tokens unchanged and make the dashboard stack cleanly on mobile with 44px controls, safe wrapping, focus visibility, and reduced-motion support.

## Technical boundaries
- Allowed: `src/routes/_authenticated/index.tsx`, new dashboard-only files under `src/components/cartel/`, and only minimal opt-in presentation props in the explicitly allowed shared components if necessary.
- No data-layer, backend, schema, RLS, migration, Edge Function, secret, billing, Telegram, launch-control, contract, wallet, treasury, chain, or liquidity changes.
- No dependencies, fake search, publishing, or deployment.

## Verification
- Run the TypeScript check and production build.
- Run `scripts/p1a-project-journey-regression.ts` and `scripts/p2c2-launch-isolation-regression.ts`.
- Review the authenticated dashboard at desktop and 390px mobile when preview authentication is available.
- Inspect truthful loading/empty/unavailable/blocked/completed rendering without mutating live data.
- Report the exact changed files, verification outputs, starting/resulting commits, and preview status; then stop.
