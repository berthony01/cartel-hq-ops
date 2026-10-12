# Cartel HQ Contextual Guide — Foundation Record (H0)

Status: architecture record only. No guide UI is built yet. H1 needs separate authorization.

## Placement
- The primary home is the existing Guided setup (`/onboarding`) step experience.
- The same shared help is optionally available through a compact "Help with this page" entry in the existing authenticated AppShell.
- Not: a scattered dashboard widget, a separate page, a second wizard, or a new backend.

## Iterations
- G1 (H1 build): deterministic and reactive, with zero AI/model API requests. A fixed mapping (route, onboarding step key, project goal) -> existing Help Center article IDs plus a short hint. Search reuses `searchDocs()` over the bundled content.
- G2: model-based conversation. It needs separate later permission.

## Source mapping (reuse only)
| Need | Existing source |
|---|---|
| Goal | `useWorkspaceGoal` (`src/lib/workspace-goal.ts`), values community / launch / both / null |
| Step order and progress | `onboardingStepKeysForGoal`, `useOnboardingProgress` (`src/lib/onboarding.ts`) |
| Current page | router location |
| Wider status | `project-journey.ts` (read-only, display only) |
| Articles and search | `docs-content.ts` (`articleById`, `docsHref`, `searchDocs`) over `docs-data.ts` |
| Pages linked | `/onboarding`, `/project-profile`, `/telegram`, `/launch-control`, `/dashboard`, `/docs` (all exist) |

## Loading rule
Context queries run only when help is opened. They add no global queries to every page, and reuse cached queries already present on the page.

## Role and workspace isolation
- No new tables, functions, grants or reads beyond existing project-scoped queries. Existing RLS (workspace owner update, member select) is the boundary.
- Fail closed: an unknown or errored query shows "Unknown" and never "Done".
- Only the owner can change the goal. A managed Service Partner sees read-only hints and never sees another workspace's data.
- No sensitive launch, wallet, Safe, permit or treasury data is shown. There are no action controls.
- No storage, analytics or logging of help questions.

## Help content freshness (partial)
- The global `verifiedAt` stays `2026-09-30`. Most articles were not re-reviewed after G1.
- H0 corrected only the `first-session` and `create-project` articles (goal-based onboarding) and two onboarding step descriptions (welcome/Launch Watch eligibility, opt-in reminders).
- Known not yet reviewed: `create-launch` / `launch-schedule` may read as if every project needs a launch, and screenshots come before G1.

## Planned H1 tests
- Every mapped article ID exists in `articleById`.
- Goal null -> standard guide hints. Community with no launch -> no launch articles. Community with a real launch -> launch articles kept. Launch only -> no Telegram requirement.
- Query error -> Unknown, never Done. Partner viewer -> no owner controls. No workspace -> dashboard pointer.
- Static: the guide module imports no AI/fetch client and no pcart module.
- Typecheck, production build, and a browser check at 390px and desktop (focus trap, Esc closes).
