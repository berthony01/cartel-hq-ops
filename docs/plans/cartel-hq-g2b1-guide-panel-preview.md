# CARTEL HQ — G2B.1 Question Interface (Draft, Non-AI Preview)

**Release state: SOURCE ONLY, behind a hard-OFF gate. NOT merged, deployed or live.**

## User experience intent
- Preserve the **single existing Setup Help sheet**: no second launcher, modal, router destination or duplicate onboarding path.
- Stage an accessible, responsive question-and-reference interface inside `SetupHelpPanel`. The existing selected-project next step, goal-aware setup, topic links and Help Center search remain in place, unchanged.
- Public-only deterministic retrieval from the **eight approved articles** copied into `supabase/functions/_shared/cartel-guide-public-knowledge.ts` by G2B.0.
- Explicitly label the feature **"Ask Cartel HQ — preview"** and explain that it returns Help Center articles **not generated AI answers**. The preview does not inspect the private project or account.
- User questions are local React state (max 500 chars), source references are limited to 3 per question, visible history to 5 exchanges and is cleared on unmount. Both outer sheet and preview are keyed by selected workspace; switching tenant closes/unmounts the help view.
- No HTTP request, Supabase client, provider SDK, billing, telemetry, token send, action execution, database write or local/browser persistent storage occurs.
- Help Center documentation was last fully reviewed **2026-09-30**. Citations link to existing `/docs?article=...`. Re-audit the content against today's app before ever using it to answer customers with AI.

## Files
1. `src/lib/cartel-guide-ui-gate.ts`: exports a literal `CARTEL_GUIDE_PREVIEW_UI_ENABLED = false`. This cannot be flipped by a URL, Vite environment variable, browser storage or user input. Enabling it is a *separately approved release decision*.
2. `src/components/cartel/GuideConversationPreview.tsx`: local-only accessible Q&A/citations component, lazy-loaded by the existing panel; uses the existing `Button`, `Textarea`, and `HelpTopic` UI architecture.
3. `src/components/cartel/SetupHelpPanel.tsx`: three surgical additions (React lazy/Suspense, import/definition, and gated JSX insertion), restricted to a signed-in workspace member with ready setup context. Managed-only Service Partner workspaces stay excluded until independent permission review.
4. `scripts/cartel-guide-g2b1-panel-regression.ts`: static protection checks, no runtime network.
5. This plan/report.

**Do not modify** `SetupHelp.tsx`, UI entry buttons, production Supabase client credentials, docs, Telegram, launch, Stripe, RLS, mainnet contracts or existing Setup Help functionality for this step.

## Observed QA (2026-10-13 UTC)
- GitHub source checks: **28/28 PASS**, executed in a V8 JS environment from the exact committed source and assertions (TypeScript test annotations removed only in-memory). These assert hard-off gate, managed-scope exclusion, workspace reset, no network or persistence in preview, original Help Center flow intact, bounded input/transcript and safe document links.
- Existing G2B.0 deterministic evidence regression: **19/19 PASS** in previous checks. This source does not change retrieval logic.
- **Not yet run:** a complete `tsc`/Vite build from a dependency-installed checkout, browser desktop/mobile visual/accessibility QA, and real staging Supabase Auth JWT/CORS success-path tests. Do not represent source checks as full UI/build QA.

## Why it stays hard OFF
The STAGING `cartel-guide` Edge endpoint currently rejects every authorized request by design and never calls a model; the staging Auth project has zero genuine test users and email confirmation is required. Production has no Guide endpoint or Guide spending tables. This UI preview is a **non-network developmental shell**, not a deployed conversational AI service.

**Next prioritized step:** obtain a genuine, verified **staging-only** Auth session via official Supabase signup (may require one email-confirmation action by the owner) and run signed-in member/cross-workspace/CORS QA. In parallel, the draft PR should receive TypeScript/Vite build and visual QA before any release proposal. Provider/model/cost decisions and production rollout require a separate approval gate.
