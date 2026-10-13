# CARTEL HQ — G2B.0: Safe Public Help Center Grounding (Review Only)

**Status:** Staged on a GitHub development branch. **NOT integrated into the Guide endpoint, customer UI or paid model calls.**

## Why this is the correct next increment
G2A.3 deployed a provider-disabled `cartel-guide` only in Supabase STAGING. Eight real HTTP authentication/input-boundary cases passed. However, the **genuine signed-in** path cannot yet be exercised unattended: live staging Auth has zero users; the public Auth settings report `external.anonymous_users=false` and `mailer_autoconfirm=false` (hosted email confirmation required). Do not disable confirmation, enable anonymous sign-in, forge JWTs, or hand-edit `auth.users` to pass the gate. A legitimate staging Auth user must be introduced through an official, approved sign-up flow; **no test user was created**. The temporary STAGING HTTP testing extension used for the read-only settings check was removed after that check.

## Scope of G2B.0
A small, deterministic, **read-only public Help Center knowledge pack** staged from `src/lib/docs-data.ts` at blob SHA `ea5f7ef7b2de64700cff82e2fd15926418f5dd5c`, `verifiedAt=2026-09-30`.
- Eight explicitly allowlisted, public articles: first session, account sign-in, project selection, project identity, Telegram personal account, Telegram group installation, bot permissions, and welcome messages.
- Exact article content compiled from the existing public Help Center source; no invented steps, private workspace data, billing records, conversations, Telegram identifiers, secrets or contract details.
- Pure function `findGuidePublicEvidence(question, maxArticles)`; no Supabase client, provider SDK, network calls, writes or side effects.
- Bounds input to 500 chars, max 14 unique meaningful query words, max 4 matching articles, and 1,350 chars per excerpt. Prefers exact Help Center title-term matches, then deterministic conservative relevance. Cites canonical local `/docs?article=<id>` links with the source review date.
- **This is evidence retrieval, not model-generated answers.** Retrieved docs are untrusted data to any future model and must never be promoted to system/tool instructions.

## Tests
- 19/19 offline retrieval assertions passed in V8 with temporary in-memory TypeScript annotation removal (not a Bun/tsc checkout run). Cases: source allowlist, source freshness, Telegram account/group, account, identity, no-match behavior, input/citation limits, injection cannot become evidence, deterministic repeats.
- Canonical title query results: `create account -> create-account`; `connect Telegram group -> connect-group`; `set project identity -> project-identity`; `connect Telegram account -> connect-telegram-account`.
- A **real** Bun/TypeScript app build and authenticated Edge+UI integration are still **NOT RUN**.

## Required release gates
1. Review the eight Help Center articles against the CURRENT Cartel HQ UI. These docs were last reviewed September 30; onboarding has since changed. Don't train or instruct an AI from stale steps.
2. Verify the staging authenticated-user token journey and origin/CORS preflight through a genuine Supabase Auth session. Prefer existing browser QA or an explicit staging-only email test account, no shortcuts.
3. Design a strict *server-only* user/workspace goal/progress context allowlist; avoid direct model access to customer messages, financial data, wallets, or model-editable instruction text.
4. Connect retrieval to a separately reviewed G2B server handler AFTER G2A.2 atomic budget pre-spend enforcement is deployed and confirmed. Continue to return deterministic Setup Help while model work is OFF.
5. Obtain separate approval before paid provider setup, production migration or Edge deployment.

**Release safety:** main/prod/PCART launch/Telegram/Lovable UI remain unchanged. Existing staging Guide stays disabled and emergency stopped.
