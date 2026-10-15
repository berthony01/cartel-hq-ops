# Cartel HQ G2D — Approved Pro-only Guide pilot policy / public Kie price audit

**Owner authorization:** Proceed with the agreed product direction on October 14, 2026. Basic Setup Help remains Free; conversational Guide belongs to existing Cartel HQ Pro $49/month, initially **100 user-submitted Guide requests shared per Pro workspace per UTC calendar month**. Platform owner subscription exemption remains; the platform-wide spend ceiling/emergency stop ALWAYS applies. Do not enable/advertise this benefit until runtime/quality/release gates pass.

**NO release authorization:** Everything here is development DRAFT only. The files do not create a subscription, alter Stripe prices, update production or staging Supabase, deploy Edge functions, call Kie.ai, consume AI credits, or launch GitHub Actions.

## Public provider costs — checked 2026-10-14

Provider: existing **Kie.ai** account. Proposed *chat-only* model: **Gemini 3.8 Flash**, endpoint `POST /gemini-3-8-flash-openai/v1/chat/completions` (already staged in disconnected G2C contract). Kie public listing: **45 credits/1M input tokens (~$0.225)** and **225 credits/1M output tokens (~$1.125)**, promotional through **December 31, 2026 at 06:00 UTC**. Kie warns prices can change, and model-specific final costs may differ from simple token arithmetic. Do not commit these rates as an evergreen live model quote.

References:
- https://kie.ai/gemini-3-8-flash (current model prices and promotional deadline)
- https://docs.kie.ai/market/gemini/gemini-3-8-flash-openai (chat-only API and returned `usage`, `credits_consumed`)
- https://docs.kie.ai/common-api/get-account-credits (account credit balance requires private API key; not accessed)
- https://kie.ai/pricing (general rate changes)

**Arithmetic:** input tokens × 0.225 / 1,000,000 + output tokens × 1.125 / 1,000,000 in USD, excluding minimum charges, hidden reasoning, retries, hosting, other operations and rate changes.

| Estimated input/output per answered question | Estimated USD per question | 100 questions / workspace | 1,000 fully-utilizing Pro workspaces |
|---|---:|---:|---:|
| 2,000 / 350 | $0.00084375 | $0.084375 | $84.375 |
| 8,000 / 1,500 | $0.0034875 | $0.34875 | $348.75 |
| 16,000 / 4,096 | $0.008208 | $0.8208 | $820.80 |

These are **illustrative scenarios**, not customer measurements, guaranteed invoices, hard max charges or promised capacity. `total_tokens` may differ from `prompt_tokens + completion_tokens`; provider-reported `credits_consumed` is essential. Model-specific token price post-promotion unknown until republished/confirmed. No Kie account balance or API compatibility proof was retrieved.

## Existing architecture reused / gap corrected

- Production is still G1 deterministic Setup Help. It stays available to Free and Pro at zero paid-model usage.
- Production plan rows were read from existing Supabase: `cartel_free` $0 and `cartel_49` $49/month. Neither has a live `guide_conversation` entitlement yet; so there is nothing customer-visible/activated to reverse.
- Existing `evaluate_commercial_access` checks entitlement for workspace and owner unrestricted pass. The shared Edge allowlist lacked `guide_conversation` and has **one draft-only string addition**.
- Existing `commercial_feature_usage` returns zero for unrecognized keys. Setting the Pro entitlement to `kind='quota', limit_value=100` WITHOUT extending its counter would falsely show unused allowance forever. Do NOT do this.
- The already-staged G2A.2 Guide budget reservation guard correctly serializes reservations under advisory lock, prevents duplicate request IDs, checks owner/workspace and a platform emergency stop. It previously capped user-month requests, NOT shared workspace requests.
- This G2D **follow-on** SQL candidate adds `customer_workspace_month_requests = 100` and counts existing Guide reservations *within the same atomic reservation transaction*, before any paid provider dispatch. Pro entitlement is `kind='feature'`; true workspace-count enforcement is in the Guard. `commercial_feature_usage` and Stripe are unchanged. Free has **no** Guide entitlement.
- Ambiguous in-flight and held requests conservatively reserve budget and capacity; requests definitively released before any dispatch are excluded. Actual customer-facing copy must not promise 100 successful answers when a provider could charge for a failed request.
- The global emergency stop, day/month USD budgets, per-user limits and platform-owner billing bypass remain intact. Enabling the Guide still requires separate config/pricing and owner approval. Adding an entitlement alone does not override the stop.
- Already-existing STAGING G2A.2 DB objects mean this must be treated as a **follow-on** database migration rather than re-applying the original G2A.2 candidate. The new SQL file is explicitly UNAPPLIED.

## Surgical allowlist / no action outside it

1. `docs/sql/G2D_CARTEL_GUIDE_PRO_100_WORKSPACE_POLICY_CANDIDATE.sql` — NEW; draft-only follow-on migration proposal.
2. `supabase/functions/_shared/commercial-access.ts` — add exactly `"guide_conversation",` to existing server allowlist.
3. `scripts/cartel-guide-g2d-pro-policy-regression.mjs` — NEW; offline source-only safety checks.
4. `docs/plans/cartel-hq-g2d-guide-pro-policy.md` — NEW; audit and release boundaries.

**Forbidden under this turn:** Running the SQL in Supabase, live price/Stripe modifications, production/main branch merges, Lovable credits, deploying an Edge function, changing Guide flags, Kie API key reads or provider model requests, broadening Free plan, touching PCART, Telegram, Sticker Lab or Sticker Drops.

## Validation and pending release gates

- Committed-source offline regression: **25/25 PASS** (source contract/static checks, not a PostgreSQL dry-run or deployed integration).
- Production read-only entitlement/routine inspection: confirmed currently missing `guide_conversation`, confirmed virtual Free and owner commercial semantics, confirmed `commercial_feature_usage` unknown key defaults to zero.
- **Not tested/approved:** apply migration even on staging; real authenticated Guide JWT/Origin QA; full dependency-installed TypeScript/Vite build; 100/101 request concurrency tests against a disposable staged workspace; UI meter; Kie key/credit balance; real model output/quality, release or live customer subscription effects.
- **Next authorized safety gate:** perform genuine staging Auth and browser Origin/CORS Guide HTTP QA with the existing confirmed staging account and safe origin setup, without weakening `verify_jwt`, exposing credentials or calling paid AI. Request a distinct approval before applying SQL, spending on a pilot, merging or deploying anything.
