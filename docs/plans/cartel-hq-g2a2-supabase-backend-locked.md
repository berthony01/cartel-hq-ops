# CARTEL HQ — Locked Backend Authority and G2A.2 Review

**Locked by platform owner (2026-10-12).** Existing PEPE CARTEL / CARTEL HQ application, **no new backend**:
- **External Supabase project `ocoinbnjgstkmnwwvnhi`** is authoritative for database, authentication, authorization/RLS, storage, Edge Functions, server credentials, billing and usage data.
- **Lovable** is the product UI builder/integration surface. Lovable Cloud must remain disabled. The TanStack editor may refuse to *create* Supabase Edge Functions, but **that is an editor limitation, not a Supabase disconnection**.
- **GitHub** maintains reviewed, auditable source with branches and draft PRs. New Supabase Edge Function source may be staged here, then deployed through the already connected Supabase service *only after separate owner approval*.
- **ChatGPT** coordinates architecture, source review, direct read-only Supabase audits, security QA, and authorized implementation. No assumption that GitHub staging deploys to Supabase.
- PCART mainnet, treasury, emergency stop, wallets, launch state, Telegram, live billing, and existing Setup Help remain untouched by the Guide budget effort.
- Owner retains unrestricted customer entitlements and quotas via `public.has_platform_unrestricted_access`. **All conversational Guide provider calls, including owner pilots**, must respect the Guide-wide emergency stop and hard spending ceilings. Existing Sticker AI calls are not covered by this Guide-only candidate; a cross-feature cap would require separate, explicitly approved integration.

## Live baseline verified via Supabase (read-only)
- CARTEL HQ Supabase connection status: `ACTIVE_HEALTHY` (PostgreSQL 17).
- Existing server role predicates: `public.has_platform_unrestricted_access(uuid)` returns boolean; `public.evaluate_commercial_access(uuid,text,uuid)` returns jsonb. Both accessible to `service_role`.
- Public `workspaces.owner_id` and `workspace_members` are the project access authorities. Managed Service Partner scopes are **not** workspace membership; G2A.1 denies them until independently audited.
- Existing plan entitlements include Sticker AI but **not** `guide_conversation`. No user should be charged for Guide conversations before it is deliberately introduced.
- Existing `usage_ledger.provider_cost` contains **no populated provider cost rows**. It cannot be used as an atomic hard spend guard.
- Existing `cartel-guide` function is **not deployed**. G2A.1 source exists only on draft PR #3. Existing H1 help functionality remains available on production/source `main`.

## G2A.2 staged candidate
File: `docs/sql/G2A2_CARTEL_GUIDE_ATOMIC_BUDGET_CANDIDATE.sql` (REVIEW ONLY, NOT an applied migration).

Its intended database contract:
1. Three new Guide-only tables: immutable, versioned provider/model quotes (database trigger prevents editing/deleting a quote), a singleton **OFF + STOP ON** control row with positive caps, and one durable reservation per `(user_id, workspace_id, request_id)`.
2. Transaction-scoped PostgreSQL advisory lock serializes reservations, so a second concurrent request cannot slip past the global/per-customer caps. For a low-volume pilot, this deliberately prioritizes correctness over throughput.
3. Reserve **worst-case micro-USD** from server-owned quote/token ceilings (not a caller-supplied price), counting *all* unresolved holds plus applicable settled spending. Includes UTC global daily/monthly, customer workspace/user monthly, customer request count and global pending-call count.
4. Owner/customer role determined in the DB, not by email or frontend role. Global controls checked **before** owner bypass. Owner usage remains in global cap accounting, but its snapshot is excluded from customer workspace quota accounting. Customers additionally require explicit pilot enablement and a `guide_conversation` entitlement verified through existing commercial access.
5. Transition `held -> in_flight` **before** any future provider request, rechecking global stop; release ONLY while `held`, before dispatch. After dispatch/ambiguous outcome, keep hold unresolved pending manual review; never blindly expire or release it.
6. Settlement is idempotent. Missing token usage settles at worst-case reservation. Reported usage in excess of cap triggers emergency stop and requires operator investigation.
7. Tables have RLS enabled and browser roles have no direct grants; the four SECURITY DEFINER RPCs are explicit **service_role-only** with fixed search paths. No provider model/secrets or network calls in this candidate.

## Known candidate gaps (review gate)
- Earlier staging testing found that owner pilot spending incorrectly consumed customers' workspace allowance. The candidate now snapshots `owner_quota_exempt` per reservation and excludes those rows from customer workspace caps; the corrected behavior passed a live staging retest.
- The price version is now enforced immutable through a database trigger. A live staging UPDATE and DELETE test confirmed changes are rejected.
- Global hard ceilings are **Guide-only**: this proposal does not modify pre-existing Sticker AI or other provider services. Do not claim it stops those costs.
- The candidate has now parsed and executed in standalone Supabase staging. Four RPCs and all three RLS tables were confirmed. Browser-role privileges were checked via `has_*_privilege`, **but actual authenticated Supabase JWT/Edge invocation and full production-schema parity remain untested**. Do not apply to production yet.

## Required *pre-deployment* validation (NOT completed)
- Perform final schema-parity review against the actual production `workspaces`/commercial RPC definitions and permissions; staging uses synthetic fixtures (no real data). PostgreSQL syntax and transactions already passed in staging.
- Complete end-to-end authenticated Supabase JWT/Edge verification, cross-tenant managed Service Partner scenarios, and role-switch testing. SQL owner/stop/entitlement/cross-tenant and two-backend simultaneous reservation tests have passed in staging.
- Still test UTC day/month boundaries and stale-`in_flight` long-run handling; duplicate requests, quota isolation, concurrent global cap, safe release, replay settlement, missing usage and overrun emergency stop passed in staging.
- Verify control can never be enabled without configured price and positive global ceilings; test that emergency stop blocks *mark in flight* after an earlier reservation.
- Review real provider pricing, hard token budgets, provider retry policy and cost attribution; **no model is chosen yet**.
- G2A.1 request tests passed 55/55 using in-memory type stripping and G2A.2 static tests passed 41/41. A real Bun/TypeScript CI run and full build have **not** yet run on this branch; staging SQL tests are separate and do not replace them.
- Before any migration, generate a canonical Supabase migration through the installed CLI, reconcile schema with live DB, obtain separate production approval, then apply and verify. The candidate in `docs/sql` must **never** be applied blindly.
- Before any provider calls, stage a separately reviewed G2B code integration that invokes the reservation RPC, marks in flight, settles accurately and fails closed. The existing Setup Help panel is the only Guide UI.

## Critical separation
Draft source code in GitHub is **not** live deployment. The existing G2A.1 endpoint is permanently provider-disabled. No migration, Edge deployment, secrets, `config.toml`, commercial plan changes or UI activation in this G2A.2 candidate. PCART launch and operational Telegram functions are strictly out of scope.

**Next decision gate:** complete production-schema parity and end-to-end JWT/Edge checks, run clean Bun/typecheck/build on this branch, then review G2A.1/G2A.2 draft PRs before any merge/deploy.


## Live staging QA evidence — 2026-10-12
- **STAGING project:** `llicojkxpzwylghptmkf` (PEPECARTEL Free organization, cost quote `$0/month`). **Production:** `ocoinbnjgstkmnwwvnhi`, untouched.
- Applied *test-only* migrations inside STAGING: `g2a2_staging_synthetic_dependencies`, `g2a2_staging_budget_candidate_validation`, `g2a2_staging_fix_owner_quota_and_quote_immutability`. They are **not** production migrations and do not clone production accounts, keys, messages or data.
- Verified default OFF+STOP ON, RLS for 3/3 Guide tables, 4/4 RPCs restricted to service_role (anon and authenticated cannot execute), no browser SELECT privilege on Guide tables, and 4 Guide budget RPCs present.
- Verified disabled-owner denies, foreign workspace denies, non-member/managed-like account denies, customers denied before pilot and without guide entitlement, owner reservation succeeds, duplicate request denied, and valid customer entitled requests obey customer caps.
- **Two distinct PostgreSQL backends** (observed PIDs 16377 and 16379) attempted budget reservations simultaneously with the global limit allowing only one: first allowed, second returned `GLOBAL_BUDGET_LIMIT`.
- Verified mark-before-provider, release of unstarted holds, refusal to release in-flight calls, emergency stop before dispatch, idempotent settlement, conservative settlement when provider usage missing, and overrun causing a global Guide stop.
- First customer quota retest exposed an isolation defect: owner's test activity reduced a customer's workspace cap. The SQL candidate was patched, staging migration applied and retested: second customer call was correctly allowed and third denied.
- Immutable quote trigger rejected both UPDATE and DELETE; the quote remained unchanged.
- Supabase staging advisors returned INFO-level RLS-no-policy (expected for server-only tables) and unindexed FK for synthetic fixtures; investigate if warning applies to future real production schema.
- **Final staging control state:** `enabled=false`, `customer_pilot_enabled=false`, `emergency_stop=true`. No Edge Function, model secret, provider API call or customer UI deployed.
- Remaining: test with real authentication/Edge transport, full production schema parity (staging commercial RPCs are **test stubs**), UTC boundary cases and real Bun/build checks. These unresolved items prohibit production deployment.


## Production-permission parity verification — 2026-10-13 UTC (staging only)
- Read **production function definitions** without data mutation and copied the five relevant canonical function bodies into STAGING: `is_platform_owner`, `is_workspace_member`, `has_platform_unrestricted_access`, `commercial_evaluate_workspace_feature`, and `evaluate_commercial_access`. A subsequent SQL comparison confirmed **5/5 function bodies identical** in production and staging.
- STAGING contains only synthetic `platform_user_roles`, `commercial_plans`, assigned workspace, membership, and entitlement records. No production user records, authorization tokens, or billing rows were copied. **`commercial_feature_usage` is a synthetic stub** because unrelated existing AI/social tables are out of scope; for `guide_conversation` fixtures the entitlement kind is `feature`, so no fake quota count is used. This is not a full production database clone.
- Under the canonical RPCs: test owner returned `UNRESTRICTED`; genuine test member's Guide feature returned `FEATURE_INCLUDED`; foreign workspace returned `NOT_MEMBER`; synthetic virtual free plan returned `FEATURE_NOT_INCLUDED`.
- STAGING budget RPC integration retest: an entitled test member successfully reserved, disabling the entitlement denied subsequent member reservations, while the owner remained exempt from the customer entitlement. The Guide-global caps and stop still apply to that owner.
- **Real PostgreSQL role-switch denial:** `SET LOCAL ROLE anon` and `SET LOCAL ROLE authenticated` followed by a Guide budget RPC call each failed with Postgres error `42501: permission denied for function cartel_guide_reserve_budget`. Privilege inspection had previously confirmed service_role-only EXECUTE and table access.
- Source audit of the existing `SetupHelp.tsx`/`SetupHelpPanel.tsx` confirms the single shared Sheet, preserved focus restoration, tenant switch reset, and docs search; the future Guide input should be integrated **inside this same panel**, not as another page or separate chatbot.
- **Still unverified:** a real authenticated browser JWT invoking a deployed STAGING Guide Edge Function, managed Service Partner client behavior using actual grants (currently deny), complete Vite/Bun production build, UTC calendar-boundary/cap rollover, pilot provider costs and evidence-grade customer-safe answer grounding. **No Edge deployment performed at this stage.**
- STAGING controls were returned to `enabled=false`, `customer_pilot_enabled=false`, `emergency_stop=true`. No live provider calls, production SQL writes, customer UI changes, or GitHub merges.
