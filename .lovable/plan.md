# Documentation package implementation

## Scope
- Replace the existing `/docs` page with the supplied help center while preserving the same route.
- Add the supplied static documentation data/helpers and copy the nine screenshots byte-for-byte.
- Make only documentation-local compatibility fixes required by strict TypeScript or the existing layout.

## Guardrails
- Change only `src/routes/docs.tsx`, `src/lib/docs-content.ts`, `src/lib/docs-data.ts`, and `public/docs/screenshots/*.jpg`.
- Do not change shared components, dependencies, backend systems, product behavior, legal text, or operational UI copy.
- Do not publish, deploy, send messages, or mutate any account or production data.

## Verification
- Validate 46 unique guides, 14 categories, all category/related links, 12 legacy anchors, and nine screenshot references/checksums.
- Run the strict TypeScript check, production build, and diff/path checks.
- Browser-test desktop and mobile landing/category/article/search/no-results/TOC/image dialog/legacy-anchor/invalid-guide/history behavior.
- Report exact changed paths, checks, preview URL, limitations, and final repository revision; then stop for review.
