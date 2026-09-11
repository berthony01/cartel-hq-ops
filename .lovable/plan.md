# HQ Journey Audit — Steps 14-16 fidelity (read-only)

## 1. Gate
- HEAD: `83827d166040afed23a58a03de0fae237584bcdc`
- `git status --short`: empty (clean tree)

## 2. What renders this screen
- `src/routes/_authenticated/index.tsx` — HQ dashboard. Renders a hero "Next in Launch Control" block (line ~494), then `<ProjectJourneyPanel />` (line 514), then Attention/Snapshot/Recent sections.
- `src/components/cartel/ProjectJourney.tsx` — the whole progress experience: `ProgressBar`, `NextActionBlock`, one shared `StageRow` for all 16 stages, `JourneyLink`, `blockedGuidance`, `reviewLabel`.
- `src/lib/project-journey.ts` — read-only authority for stage status/copy/labels (`STAGE_COPY`, `computeProjectJourney`). No writes.

## 3. Are 15/16 intentionally generic?
Yes — and no special UX exists anywhere else. Every one of the 16 stages goes through the same `StageRow`. There is no contract-registration or launch-live specific card component in the codebase; the only contract-specific UI lives inside Launch Control (`VerifiedContractRegistrationPanel`, `OfficialContractNotifyPanel`, `OfficialContractGroupBroadcastPanel`), never on the homepage. So no prior build was silently reverted: the premium treatment for 15/16 was never implemented at the journey-card level.

Root cause of the "plain" look:
- `blockedGuidance()` (ProjectJourney.tsx:131) falls back to the literal string "Complete the required earlier stage before this becomes available." whenever the stage's `detail` is `null`. For step 15 waiting, `detail` is `null` (project-journey.ts:670-676) → generic sentence.
- `reviewLabel()` (line 219) special-cases only `deployment`; everything else becomes `Review ${stage.title}`, producing the ungrammatical "Review Official contract registered" and "Review Launch live".
- Blocked rows use the dimmest style (`border-border/60 bg-surface-raised/30`) with no dependency naming, so the user cannot tell *what* unblocks them.

## 4. UX defects on this screen
1. Triple next-step duplication: hero "Next in Launch Control" + `NextActionBlock` + the gold `StageRow` for step 14 all state the same action, with three different phrasings (hero uses lifecycle-derived text, not journey text — they can disagree).
2. Blocked copy names no dependency ("earlier stage" — which one?).
3. CTA grammar: "Review Official contract registered", "Review Launch live" read as broken sentences.
4. Blocked CTAs are equal-weight buttons at `min-h-11` full width on mobile — three near-identical outline buttons compete with the one real action.
5. Steps 1-13 DONE rows carry no value at all (description hidden when complete), so 13 of 16 rows are pure noise consuming the top of the panel; no "collapse completed" affordance.
6. Two-column grid + `sm:col-span-2` on the NEXT row makes sequencing hard to read: order numbers run down-then-across, so 14/15/16 do not visually read as a final phase. The `phase` field ("Contract") exists in the model but is never rendered.
7. Mobile: each incomplete row stacks icon + title + long guidance + badge + full-width button ≈ tall; blocked rows waste the most height for the least value.
8. Step 15 detail is truthful but silent about the real gate (verified mainnet deployment evidence), which is exactly the information that makes the state understandable.

## 5. Routing check (inspection only, nothing clicked)
- Step 14 `Request production deployment` → `stage.to === "/launch-control"`, `LAUNCH_SECTION_BY_STAGE.deployment === "lc-contract"` → `/launch-control?launch=<primaryLaunchId>&section=lc-contract`. That section mounts `ProductionDeploymentRequestPanel` (launch-control.tsx:2878) — the B1/B2/B3 handoff request flow. Correct.
- Step 15 → same `lc-contract` section, which mounts `VerifiedContractRegistrationPanel` (line 2943) — the evidence-bound registration flow. Correct.
- Step 16 `launch_live` → `lc-overview` (lifecycle authority). Correct.
Wiring is right; only the presentation is wrong.

## 6. Other generic elements in the same component
- `ErrorState` is a bare sentence + Retry, no premium framing.
- `ProjectJourneyCallout` returns `null` when blocked (`nextAction.stage === null`), so other surfaces show nothing at all in exactly the state the user is in now.
- Hero "Next in Launch Control" derives from lifecycle only and can contradict the journey model.

## 7. Minimal correction scope (presentation only)

Allowlist, exactly two files:
1. `src/components/cartel/ProjectJourney.tsx`
2. `src/lib/project-journey.ts` — copy/label fields only (`STAGE_COPY` strings, blocked-reason strings). No status derivation, no thresholds, no query changes.

Changes:
- Add a per-stage blocked reason (data-derived, truthful) so 15 reads "Waiting on verified mainnet deployment evidence" and 16 reads "Waiting on the official contract registration".
- Fix `reviewLabel` per stage: "Review contract registration", "Review launch lifecycle", "Review deployment evidence".
- Render the `phase` grouping so 14-16 read as a final "Contract" phase, and give blocked-but-imminent stages a distinct step-locked treatment (dependency chip pointing at step 14) rather than uniform dim.
- Collapse completed stages behind a "13 completed" disclosure, expanded on demand.
- Remove the hero duplication: keep `NextActionBlock` as the single next-step statement in the journey panel and reduce the step-14 row to a marker, or drop the hero mini-block — one choice, not both.

Explicitly unchanged: stage status derivation, actionability rules, routes/search params, Launch Control, all panels, backend, RPCs, lifecycle, registration, Telegram, wallet, chain.

## 8. Acceptance criteria
- Diff touches only the two allowlisted files.
- Step 15 blocked text names the deployment-evidence dependency; step 16 names registration; neither contains the generic "earlier stage" sentence.
- No CTA label reads "Review <sentence-cased stage title>"; 15/16 use fixed grammatical labels.
- Exactly one "next action" statement is visible on the homepage.
- Step 14 CTA still resolves to `/launch-control?launch=<id>&section=lc-contract`; step 15 same; step 16 `lc-overview`.
- Completed stages collapsed by default with an accessible expand control; progress count unchanged.
- `bunx tsgo --noEmit`, `bun run build`, `git diff --check` pass; P1-A journey regression and P2-C2 isolation regression pass unchanged.

## 9. Static vs visual verification
Statically verifiable: file scope, copy strings, CTA labels, route/search wiring, collapse markup and ARIA, typecheck/build, regressions.
Needs authenticated visual QA (currently unavailable — Supabase is `external_unmanaged`, `/` redirects to sign-in): actual gold/dim hierarchy, phase grouping legibility, mobile stacking height, and that the live PEPECARTEL state renders 13 DONE / 14 NEXT / 15-16 blocked as described.

STOP — no build performed, no files changed, no backend or migration action taken.
