# P2-A1 Premium Foundation + HQ

## Audit findings
- **Global system:** The noir palette and semantic tokens are sound, but surface depth, border strength, typography roles, and feedback states need clearer separation.
- **Shell:** Navigation architecture and five mobile slots are correct. Active states, grouping, workspace framing, owner-tool separation, and mobile polish need stronger hierarchy.
- **Mobile:** Current shared spacing and 44px targets are largely sound. The redesign will preserve bottom-bar clearance and prevent long headings/statuses from forcing overflow.
- **Status and feedback:** StatusBadge is the right shared primitive; loading/error/empty treatments remain fragmented and will be standardized only where P2-A1 already renders them.
- **Generic surfaces:** HQ currently reads as stacked cards with similar visual weight. Settings/placeholders and feature-specific screens remain later-phase work.
- **Strong surfaces:** Project Journey logic, Launch Control structure, Community tabs, Sticker Lab workflows, and specialized owner tools should not be rewritten in this slice.

## Build
1. Refine existing semantic tokens and utilities for page canvas, quiet/elevated surfaces, restrained gold emphasis, status contrast, focus, shadows, typography, and spacing.
2. Upgrade PageHeader, Section, StatusBadge, EmptyState, RelatedLinks, and ProjectJourney presentation without changing their interfaces or behavior.
3. Polish AppShell, SidebarNav, and MobileTabBar while preserving destinations, permissions, owner gating, and exactly five mobile slots.
4. Recompose the existing HQ data into one premium command-center hierarchy: project identity, journey/next action, real launch state, attention, and existing operational summaries. No fake metrics or new reads.
5. Add a focused presentation regression only if needed to pin mobile slots and forbidden-path boundaries.

## Technical boundaries
- Presentation files only; no functional libraries, database code, generated types, migrations, edge functions, wallet/chain/Telegram behavior, flags, mutations, or publishing.
- Preserve the unified 16-stage Project Journey and all P0/P1 navigation and action semantics.
- Validate diff, types, journey regression, relevant UI checks, build, desktop layout, and 360px layout.
