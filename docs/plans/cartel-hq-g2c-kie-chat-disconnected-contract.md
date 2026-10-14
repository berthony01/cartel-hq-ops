# Cartel HQ G2C — Kie.ai Chat Contract Only (DRAFT, DISCONNECTED)

**Scope authorized:** Prepare the already-existing Cartel HQ Guide to use the existing Kie.ai service for conversational assistance, but leave AI fully disabled. NO new provider, secrets, paid requests, deployment, Supabase migration, CI run, mainline merge or Lovable credits.

## What this actually delivers
- One pure, import-free Supabase shared module (`cartel-guide-kie-chat-contract.ts`) that constructs a **text-only** non-streaming request shape for Kie.ai's Gemini 3.8 Flash OpenAI-compatible chat endpoint.
- One pure parser that rejects HTTP errors, **HTTP 200 error objects** (`code != 200`), missing or partial answers, and missing actual metering values. Provider credits are recorded as *provider credits, not dollars*.
- One offline regression script exercising validated and rejected requests/replies.
- The model endpoint is pinned to `https://api.kie.ai/gemini-3-8-flash-openai/v1/chat/completions`. Kie documentation: https://docs.kie.ai/market/gemini/gemini-3-8-flash-openai . Kie marks it **chat only / not agent-ready**.
- No `fetch`, SDK, API key, secrets, environment reads, DB, browser, routes, UI changes or tools in the added adapter. It is **NOT wired** to the current `cartel-guide` Edge Function.
- Only a user question and up to three server-curated public Help Center excerpts and local citations are contemplated. **Do not include** workspace account data, Telegram identities, private channels, billing, wallets, images or user-selected external URLs. Source excerpts are **untrusted data**, never system instructions.

## Boundaries / release gates
1. **Keep production, staging and draft Guide OFF.** Existing production G1 Setup Help is unchanged; the G2A.1 `cartel-guide` handler still returns 503, and G2B.1 preview UI remains hard disabled.
2. **No paid calls yet.** The contract cannot make network requests. No provider secrets were inspected, copied or deployed.
3. **Auth and workspace validation are prerequisite:** G2A.3 genuine signed-in staging JWT/CORS/member-versus-other-project checks remain unverified. Preserve RLS and deny delegated/managed scope until separately audited.
4. **Cost and usage:** G2A.2 atomic *pre-spend* budget reservation and global emergency stop must be checked and integrated BEFORE any network calls. The helper is not a reservation system. Cap output, retries, requests and budgets at the actual server execution boundary; documentation does not establish the chosen model accepts any particular max-output parameter.
5. **Grounding:** choose public evidence on the server from the reviewed 12-article Guide corpus; the future caller must not accept user-provided evidence or arbitrary URLs.
6. **Privacy and quality:** explicitly approve sending the user's question and grounded public docs to Kie.ai; avoid sensitive context. Test real answer quality and metering with a separately approved tiny Kie credit budget.
7. **No autonomous actions:** never enable tools, Google Search, model-executed actions, agent frameworks, or unauthorized writes.
8. **TypeScript/Vite and authenticated desktop/mobile QA remain pending.** No full dependency-installed build or provider API integration test was executed.

## Surgical file allowlist
- `supabase/functions/_shared/cartel-guide-kie-chat-contract.ts` (NEW, pure module)
- `scripts/cartel-guide-g2c-kie-contract-regression.ts` (NEW, local regression only)
- `docs/plans/cartel-hq-g2c-kie-chat-disconnected-contract.md` (NEW, this doc)

**Forbidden:** `main`, `pcart-*`, Launch Control/Sticker Lab/Sticker Drops, `supabase/functions/cartel-guide/index.ts`, database SQL, Supabase secrets, API calls, Lovable, deployments, PR merge, GitHub workflows.

## Verification
Committed-source offline regression evaluated in JavaScript (TypeScript annotations adapted without changing logic): **31 PASS / 0 FAIL**. This is **not** a full TypeScript/Vite build, not real signed-in QA and not live Kie compatibility proof.

## One next step
Obtain approval for the *next* minimal server-side, auth- and atomic-budget-gated wiring plan after the pending security and build gates. Do not turn on a model or spend any Kie credits under this draft-only authorization.
