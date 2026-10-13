# CARTEL HQ — G2A.3 Supabase STAGING Edge Function QA

**Executed:** 2026-10-13 UTC. **Status: G2A.3 staged runtime gate partially verified, authenticated-user success path remains untested.**

## Locked environment
- Production CARTEL HQ: `ocoinbnjgstkmnwwvnhi`; **NO migration, function deploy, AI activation or UI change**.
- Isolated Free-tier CARTEL HQ STAGING: `llicojkxpzwylghptmkf`, active and healthy.
- Deployed STAGING Edge Function `cartel-guide` version **1** (deployment ID `fa6e3ebd-998c-4555-b2fd-17cbd60e3e85`), matching GitHub staged source from stacked G2A.1/G2A.2 review. **`verify_jwt=true` confirmed from live Supabase metadata**.
- Source: `supabase/functions/cartel-guide/index.ts` plus `supabase/functions/_shared/cartel-guide-contract.ts`; exact relative imports packaged. Deployment metadata `ezbr_sha256=3c5b6a5ca5ad1cfe7f776fd6b9ce85b7e00e8b498da687ffdeb3cb775b707cbb`.
- No provider endpoint, model key, model call, conversation storage or usage metering. Server explicitly returns `GUIDE_NOT_ENABLED` with absent feature flag; even `true` would only return `PROVIDER_NOT_CONFIGURED`. No CORS origin allowlist configured, so ordinary browser cross-origin access is blocked by default.
- STAGING budget config verified AFTER testing: `enabled=false`, `customer_pilot_enabled=false`, `emergency_stop=true`.
- STAGING Auth user count: **0**. All workspace/member/plan/owner fixtures are synthetic. These are NOT working Auth users; a genuine signed-in JWT cannot be fabricated from a UUID.

## Direct deployed HTTP QA — STAGING only
To invoke the deployed endpoint without accessing any private customer account, enabled the official `http` PostgreSQL extension **only on STAGING** and sent HTTP requests from its database to its own Edge endpoint. Used the STAGING legacy public anon key (never logged in artifacts) as a bearer for gateway acceptance tests; verified that the Guide correctly does **not** mistake that public key for a real authenticated user.

| Case | HTTP | Code/result | Status |
|---|---|---|---|
| Request without Authorization | 401 | `UNAUTHORIZED_NO_AUTH_HEADER` (Supabase JWT gateway) | PASS |
| Public anon JWT, valid question/workspace | 401 | `UNAUTHENTICATED` (Guide Auth check) | PASS |
| Malformed JSON | 400 | `INVALID_JSON` | PASS |
| Caller tries `isOwner: true` privilege override | 400 | `UNRECOGNIZED_FIELD` | PASS |
| Invalid workspace UUID | 400 | `INVALID_WORKSPACE` | PASS |
| Body exceeding 2 KB | 413 | `REQUEST_TOO_LARGE` | PASS |
| Disallowed method (GET) | 405 | `METHOD_NOT_ALLOWED` | PASS |
| Wrong Content-Type | 400 | `INVALID_CONTENT_TYPE` | PASS |
| Negative Origin/CORS header request | — | Test invocation blocked by tool safety filter; **NOT VERIFIED** | OPEN |

**Result: 8/8 executed HTTP cases passed; a ninth Origin-header test could not run through the available tool.** Direct staging logs corroborated the request responses; a GET to staging Auth `/auth/v1/user` produced 403 for the public anon JWT, and the Guide returned 401, as designed.

**Cleanup:** After HTTP QA, the temporary PostgreSQL `http` extension was **removed from STAGING** through a staging-only migration; it is not needed at runtime. No SQL HTTP testing capability was left installed by this QA phase.

## What this does NOT prove
1. A real user JWT, matching `auth.users`, successfully passes `auth.getUser` and resolves the member/owner records. Staging currently has zero real Auth users.
2. Complete browser CORS/preflight behavior from the actual Cartel HQ UI origin. The staging origin allowlist intentionally remains unset, and no UI invokes the new function.
3. Managed Service Partner scopes: the endpoint currently denies managed-only access because partner permissions require separate server-side scoping.
4. Full Bun/TypeScript/Vite app build, production schema/REST Data API exposure of **future** Guide-related tables, UTC billing boundaries or live provider pricing.
5. Deployment to production, any paid AI conversation or customer rollout.

## Next single decision/action
Use an approved **staging-only Supabase Auth test account** created through an official Auth flow (no manual writes to `auth.users`, no forged JWTs, no copying of production accounts), then attach its UUID to a synthetic staging workspace and test:
- Authenticated member -> `GUIDE_NOT_ENABLED` (503), rather than a false denial.
- Authenticated foreign workspace -> `FORBIDDEN` (403).
- Authenticated member with unknown fields -> `UNRECOGNIZED_FIELD` (400).
- Signed-out/no token -> gateway 401.
- Actual browser Origin behavior with an explicit staging allowlist when authorized.
- Return staging to its disabled state and record findings.

**Stop gate:** do not create public Auth bypass, enable anonymous sign-in globally, weaken `verify_jwt`, expose service role keys, or deploy to production just to satisfy this test. No merges/publication until remaining auth and cost gates are verified.
