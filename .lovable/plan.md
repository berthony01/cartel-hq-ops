# Contextual Setup Help Panel — Read-only review and plan

## Baseline (verified read-only)
- HEAD `a865a361e840517fafbb8516ab5573ac99ee72d3`, working tree clean.
- Discrepancy: HEAD is newer than the last reported G1.1 commit (`2dc9cb90`). Sequence is `ebafb6d7` -> `2dc9cb90` -> `05211388 "Fixed G1.1 dashboard copy"` -> `a865a361 "Work in progress"`. Before any build, diff `05211388..a865a361` and decide whether to accept it as the new checkpoint.
- No files, data or settings were changed during this review.

## What exists today (reused, not rebuilt)
- Guided setup at `/onboarding`: goal chooser plus goal-filtered steps (`useOnboardingProgress(workspaceId, goal)`, `onboardingStepKeysForGoal`).
- Saved goal: `useWorkspaceGoal`, with values community / launch / both / unset.
- Project journey (`project-journey.ts`), already filtered for community-only projects.
- Help Center at `/docs`: 60+ articles in `docs-data.ts`, deep links through `docsHref(id)`, and offline search through `searchDocs()`.
- App frame (`AppShell.tsx`): top bar with the project switcher and user menu. There is no help entry point inside the app today.

## Help content discrepancies
1. Help content is marked verified on `2026-09-30`, which is earlier than G1 (the goal choice and goal-based steps). No article mentions the project goal, the `/onboarding` guide, or community-only mode.
2. `getting-started` / `first-session` say "follow the next incomplete setup step relevant to your goals," but never explain how the goal is chosen or that only the owner can change it.
3. The screenshots are from 30 Sep and are labelled "Production example". The wording is accurate, but they come before the G1 dashboard copy ("Community readiness").
4. `launch-schedule` / `create-launch` read as if every project must create a launch. That conflicts with the community-only path.
5. Fixing these is a content edit to `docs-data.ts` and is proposed as a separate step (H0) from the panel itself.

## Proposed design (H1, first iteration)
A "Setup help" panel that slides in from the right. It opens from a button in the top bar, inside the signed-in area only.
- Context comes only from data the user can already see: the active project, the saved goal, onboarding progress (the current step and steps still to do), and the current page.
- Deterministic answers: a fixed, pre-written table links each (page, step key, goal) to 1–3 existing Help Center article IDs plus a one-line next-step hint. There is no model or AI call and no network request beyond queries the app already makes.
- Includes a search box that uses the existing `searchDocs()` and works offline on the bundled content.
- Every link points to a page that already exists (`/onboarding`, `/project-profile`, `/telegram`, `/launch-control`, `/docs?article=`). No new pages or routes.
- Text-only guidance. There are no action buttons that change data, and no launch, wallet, Safe or permit controls.
- Unset goal shows the standard guide's hints. Community-only with no launch never suggests creating a launch. A real launch keeps its launch articles whatever the goal.
- If a query fails, the panel says "Progress unavailable" and still shows help articles. It never shows a step as complete when the data is unknown.

## Privacy and role isolation
- No new database reads, tables, functions or grants. The panel reuses existing project-scoped queries, so the existing access rules apply unchanged.
- Partner-managed projects: the panel shows read-only hints and never offers "Change goal". That control stays owner-only, as in G1.
- Nothing is stored. No analytics, logging of questions, or saving search text to the browser.
- The owner's permanent full access is unaffected because the panel has no gating.

## Accessibility
- Built on the existing slide-in sheet component, so it has a focus trap, closes with Esc, and has a labelled title.
- The trigger button has a text label and keeps the 44px minimum tap size. It is reachable on mobile in the top bar.
- Search results are announced through a polite screen-reader message. Status uses wording such as "Done / To do / Unknown", not color alone.

## Files required (H1 allowlist)
- New: `src/lib/setup-help.ts` (a pure mapping and selector: context -> articles + hint).
- New: `src/components/cartel/SetupHelpPanel.tsx`.
- Edit: `src/components/cartel/AppShell.tsx` (the trigger button and mounting the panel; nothing else).
- Optional new: `scripts/setup-help-regression.ts`, following the pattern of the existing `scripts/*-regression.ts` files.
- H0 (separate gate): `src/lib/docs-data.ts` content plus the `verifiedAt` date.
- Forbidden: all pcart-* files, launch/P9 code, migrations, generated types, billing, Telegram sending, the project-journey/onboarding logic files (read-only use only).

## Test matrix
| Case | Expected |
|---|---|
| Goal unset, no profile | Identity hint + project-identity article; no hang |
| Community, no launch | No launch articles or create-launch hint |
| Community + real launch | Launch articles kept |
| Launch / both | Launch-basics articles appear in step order |
| Every mapped article ID | Exists in `articleById` (fails if any is missing) |
| Progress query error | "Unknown" shown, never "Done" |
| Partner-managed viewer | No owner-only controls |
| No workspace | Points to the dashboard to create a project |
| Search | Matches `searchDocs()` results exactly |
| Static | Panel module imports no AI/fetch client and no pcart module |
| Typecheck + build | Clean |
| Browser check | Panel opens and closes, Esc works, mobile width at 390px |

## Risks
- The help content goes stale again. The test that checks every article ID exists catches missing articles but not outdated wording, so the `verifiedAt` date needs reviewing on each release.
- Adding the trigger to the top bar can crowd it on narrow phones. This needs a 390px check.
- The unreviewed "Work in progress" commit could change behaviour that the panel relies on.

## One next action
Review and accept `05211388..a865a361` as the new checkpoint (or revert it). Then authorize H1 with the allowlist above. H0 help-content corrections are a separate gate.
