# Legal identity and U.S.-beta policy completion

## Scope
- Update the four draft policy texts with the confirmed sole-proprietor identity, brand status, U.S.-beta scope, contacts, Texas dispute process, liability period, and restrained privacy wording.
- Keep every document draft/not effective and preserve fail-closed activation checks.
- Synchronize the release checklist’s legal gates without weakening technical or approval gates.
- Update only the two allowlisted regression scripts for the confirmed facts and preserved protections.
- Adjust roadmap wording only if needed to reflect the remaining review and operational blockers.

## Boundaries
- Repository and preview build only.
- No publishing, deployment, SQL application, policy activation, Stripe call, Supabase change, email/DNS change, secret change, or product/billing behavior change.
- No files outside the user’s allowlist will be modified.

## Verification
- Confirm the final diff contains only authorized files and passes `git diff --check`.
- Run TypeScript, the preview build, Phase 1B regressions 1–4, release regression, and Phase 1A regression.
- Report exact start/result commits, changed files, test counts, and unrelated pre-existing failures separately.
