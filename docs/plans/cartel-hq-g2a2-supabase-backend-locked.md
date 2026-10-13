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
1. Three new Guide-only tables: versioned provider/model quotes, a singleton **OFF + STOP ON** control row with positive caps, and one durable reservation per `(user_id, workspace_id, request_id)`.
2. Transaction-scoped PostgreSQL advisory lock serializes reservations, so a second concurrent request cannot slip past the global/per-customer caps. For a low-volume pilot, this deliberately prioritizes correctness over throughput.
3. Reserve **worst-case micro-USD** from server-owned quote/token ceilings (not a caller-supplied price), counting *all* unresolved holds plus applicable settled spending. Includes UTC global daily/monthly, customer workspace/user monthly, customer request count and global pending-call count.
4. Owner/customer role determined in the DB, not by email or frontend role. Global controls checked **before** owner bypass. Customers additionally require explicit pilot enablement and a `guide_conversation` entitlement verified through existing commercial access.
5. Transition `held -> in_flight` **before** any future provider request, rechecking global stop; release ONLY while `held`, before dispatch. After dispatch/ambiguous outcome, keep hold unresolved pending manual review; never blindly expire or release it.
6. Settlement is idempotent. Missing token usage settles at worst-case reservation. Reported usage in excess of cap triggers emergency stop and requires operator investigation.
7. Tables have RLS enabled and browser roles have no direct grants; the four SECURITY DEFINER RPCs are explicit **service_role-only** with fixed search paths. No provider model/secrets or network calls in this candidate.

## Known candidate gaps (review gate)
- The quote price version is unique and recorded per reservation, but this candidate does **not yet enforce quote-row immutability using a database trigger**; admin-only quote edits must be prohibited or a separate price-version mutation guard added before deployment.
- Global hard ceilings are **Guide-only**: this proposal does not modify pre-existing Sticker AI or other provider services. Do not claim it stops those costs.
- The SQL has **not been parsed or transaction-tested** in disposable Postgres, and its SECURITY DEFINER permissions have not been verified under impersonated roles. Do not apply until those checks pass.

## Required *pre-deployment* validation (NOT completed)
- Independent review of SQL parser/syntax, schema, grants, SECURITY DEFINER privilege context, role-specific RLS, and existing commercial RPC behavior in a **disposable non-production Postgres/Supabase environment**.
- Exercise owner with enabled/disabled stop, non-owner with/without pilot entitlement, service-role-only grants, unauthorized workspace and managed partner denial; simulated overlapping requests with two independent connections to prove serialized reservations.
- Check day/month boundaries, duplicate request idempotency, quote price version preservation, global cap exhaustion, 2+ concurrent reservers, stale/ambiguous `in_flight` hold, safe pre-dispatch release, duplicate settlement, missing usage and provider-token overrun.
- Verify control can never be enabled without configured price and positive global ceilings; test that emergency stop blocks *mark in flight* after an earlier reservation.
- Review real provider pricing, hard token budgets, provider retry policy and cost attribution; **no model is chosen yet**.
- Verify G2A.1 boundary unit tests, G2A.2 static tests, real TypeScript checks and full build after a feature branch can be run in an isolated checkout/CI. Static inspection is **not** a concurrency or SQL integration test.
- Before any migration, generate a canonical Supabase migration through the installed CLI, reconcile schema with live DB, obtain separate production approval, then apply and verify. The candidate in `docs/sql` must **never** be applied blindly.
- Before any provider calls, stage a separately reviewed G2B code integration that invokes the reservation RPC, marks in flight, settles accurately and fails closed. The existing Setup Help panel is the only Guide UI.

## Critical separation
Draft source code in GitHub is **not** live deployment. The existing G2A.1 endpoint is permanently provider-disabled. No migration, Edge deployment, secrets, `config.toml`, commercial plan changes or UI activation in this G2A.2 candidate. PCART launch and operational Telegram functions are strictly out of scope.

**Next decision gate:** run isolated SQL privilege + parallel reservation tests and review G2A.1 draft PR before any merge/deploy.
