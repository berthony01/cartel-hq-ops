# Project Profile premium recomposition

## Scope
- Recompose only the authenticated Project Profile presentation, using the existing Dashboard and Launch Control visual system.
- Keep all seven studio views mounted with their existing IDs and preserve every query, mutation, validation rule, redirect, and public-profile behavior.
- Do not change Supabase, backend logic, packages, routes, billing, auth, Telegram, launch lifecycle, or deployment state.

## Implementation
1. Strengthen the top identity control-room surface with the current form logo, project name, ticker, chain, discovery state, network address, primary save action, and secondary public-page action.
2. Refine the controlled studio navigation into a compact workflow rail without changing its controlled behavior or Launch Control styling.
3. Rebalance each working view into a dominant editing surface with quieter supporting details; separate trust, launch, visibility, and media hierarchy.
4. Keep the unsaved-form Network preview explicit and compact, with a useful wide-screen editor/preview split and clean mobile stacking.
5. Preserve 44px controls, focus states, wrapping, reduced-motion behavior, and no horizontal overflow.

## Technical boundaries
- Primary file: `src/routes/_authenticated/project-profile.tsx`.
- Shared presentation edits only if essential and behavior-neutral.
- Regression files change only if a new presentation invariant needs locking.
- No dependencies and no data-contract changes.

## Verification
- Run diff validation, TypeScript checking, production build, and the profile data/shell/rich/media regressions.
- Confirm the seven mounted WorkingViews, unsaved-form preview bindings, and unchanged query/mutation names.
- Visually inspect the authenticated page at desktop, tablet, and approximately 390px mobile when preview authentication permits.
- Report exact changed files, start/result SHAs, test results, preview URL, and confirm no publish.
