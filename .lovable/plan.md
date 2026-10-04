# Launch Control Simplification — Phase 1

## Confirmed baseline
- Authoritative local HEAD matches `43742db3b4c3d08c03b87bcd979b9d4ec6eee271`; working tree is clean.
- Canonical PCART already uses the existing five-stage readiness model and working signer/Safe flow.
- A second hard-coded PCART progress strip currently duplicates that model in Deploy & Contract.
- The global save bar currently renders across every selected-launch section, including canonical PCART Overview and Deploy & Contract.
- Safe internals already remain collapsed under Technical details; no Safe or wallet implementation needs modification.

## Implementation
1. Refine `PcartLaunchSetupGuide` into a compact, mobile-safe “Launch setup” surface using the same Token → Auction → Treasury → Review → Launch readiness data and one clearly emphasized next action.
2. Remove the duplicate hard-coded PCART progress strip from Deploy & Contract. Keep signer and Safe controls intact and ordered before collapsed technical material.
3. Add one read-only canonical-PCART “Review & Launch” summary at the end of Deploy & Contract. Populate it only from the selected launch, frozen PCART intent, and readiness state: name, ticker, chain, fixed supply, treasury, rehearsal, auction, and mainnet lock. Its launch button remains disabled and has no handler.
4. Hide the persistent “Save launch details” bar only on canonical PCART Overview and Deploy & Contract. Preserve it on Details and Schedule, and preserve all generic-launch behavior.
5. Extend the existing focused regression to enforce the single stepper, authoritative summary fields, disabled/no-handler launch action, contextual save visibility, and unchanged protected surfaces.

## Allowed files
- `src/routes/_authenticated/launch-control.tsx`
- `src/components/cartel/PcartLaunchSetupGuide.tsx`
- `src/components/cartel/PcartReviewLaunchSummary.tsx` (new, presentation-only)
- `scripts/pcart-launch-simplification-regression.ts`

## Verification and stop point
- Run the requested focused regression, TypeScript check, production build, and `git diff --check`.
- Inspect the final diff and confirm no backend, security, wallet, Safe, artifact, contract, execution-control, package, SQL, deployment, or publication surface changed.
- Stop after this local UI-only phase; do not create a Safe, rehearse/deploy PCART, implement auctions, transact, or publish.
