# Cartel HQ G2A — Conversational Guide secure foundation

**Status:** G2A.1 STAGED FOR REVIEW ONLY, **NOT DEPLOYED OR CONNECTED**. No customer-visible change, model request, migration, or usage charge. G2A.2 security gates and G2B conversational UI are NOT authorized by this branch.

## Existing product placement (locked)
The conversational Guide will extend the **existing** Setup Help panel, launched by **Help with this step** inside `/onboarding` and **Help with this page** in `AppShell`. It will not be a separate chatbot route, duplicate wizard, dashboard tool, or Telegram bot. Existing deterministic `src/lib/setup-help.ts` and `searchDocs()` remain the default and fallback. No changes to these files in G2A.1.

## Verified source-of-truth mapping
- Auth and session: existing external Supabase Auth; the staged function validates a caller JWT with `auth.getUser` (never trusts a client-supplied identity).
- Workspace: `workspaces` and `workspace_members`; the server checks the verified user's membership/ownership for the exact selected UUID. Service Partner **managed** scopes in `partner_client_access` are a separate permission system, not membership, and are intentionally unsupported in G2A.1.
- Goals and progress: `src/lib/workspace-goal.ts`, `src/lib/onboarding.ts` (read-only when added in G2B). Goal does not authorize financial actions.
- Knowledge: public Help Center `docs-data.ts` via `docs-content.ts`, `articleById`, `docsHref`, `searchDocs`. Global review date is **2026-09-30** with partially updated articles. G2B must build a versioned, approved, customer-safe article allowlist; do not pass internal Lovable project knowledge, unpublished plans, or model-invented action instructions.
- Existing AI patterns: live `sticker-concepts` Edge Function v30 uses JWT, membership, `can_use_project_tools`, `evaluate_commercial_access` and records usage after generation.
- **Important drift:** the deployed sticker-concepts embedded commercial guard describes no-plan observe/allow, while the Git repository's newer `supabase/functions/_shared/commercial-access.ts` describes a virtual-free enforcement mode. Neither is adopted as proof of budget enforcement.
- `usage_ledger` has raw usage metrics, but records do not establish a hard monetary limit. The shared writer explicitly does not perform plan, quota, or billing enforcement.

## Staged G2A.1 code contract
- `supabase/functions/_shared/cartel-guide-contract.ts`: pure parser + fail-closed request evaluation.
- `supabase/functions/cartel-guide/index.ts`: source-only Edge entry. Lovable TanStack editor refused creating a new Supabase Edge Function; therefore staged in a GitHub **review branch**, not through Lovable and not deployed.
- `scripts/cartel-guide-g2a-regression.ts`: offline boundary checks.
- Browser request contract: POST JSON; only `question` (2–500 chars), `selectedWorkspaceId` UUID and optional `requestId` UUID; <=2 KB body. Unknown client keys rejected (including `userId`, `isOwner`, `messages`, `context`, `system`). Auth token verified against Supabase Auth. Server checks exact workspace ownership/membership, no client role input. Managed clients are denied until separately audited.
- Strictly allowlisted browser origins via `CARTEL_GUIDE_ALLOWED_ORIGINS` (no wildcard). `verify_jwt=true` must be enforced if ever deployed.
- **No provider code exists**. When `CARTEL_GUIDE_ENABLED` is absent/false, any otherwise-valid request receives HTTP 503 `GUIDE_NOT_ENABLED`. Even if explicitly set to `true`, still HTTP 503 `PROVIDER_NOT_CONFIGURED`. No provider/model/API key, database mutation, usage charge, conversation storage, or Telegram call. Data never echoed; no question logging. Headers prevent caching.
- A feature flag alone must NEVER be treated as permission to enable a provider in the future.

## G2A.2 — required BEFORE first paid AI request (NOT in this PR)
1. **Database-atomic budget reservation** in separately reviewed SQL migration: service-role-only procedures inside a transaction (row locks/advisory lock as appropriate), explicit user/workspace/global limits, concurrent request reservation, max pending requests, UTC billing period. App read-then-write checks are insufficient.
2. **Global hard stop and monetary ceiling**: check platform emergency stop **before** authorizing any request; applies to the platform owner, even when exempt from customer plan/quotas. Enforce per-user/workspace/month + app-global worst-case exposure.
3. **Worst-case budget estimate** from immutable model, max input/output tokens, pricing version, provider. Unknown/unverified price or quota means deny; never fake provider costs in `usage_ledger`.
4. **Reserve, settle, release**: reserve maximum worst-case liability atomically before provider call; settle actual measured usage, release unused hold; conservative handling of ambiguous provider results; TTL cleanup and durable idempotency to bound exposure under network failures.
5. **Commercial authority**: Add an explicit Guide feature key and plan entitlements **with** migration review; enforce server-side not UI-only; no-assignment must be checked against live current semantics and fail closed for paid Guide calls. Platform owner bypasses customer subscription and user quotas via existing server-authoritative role RPC, **not email checks**, but cannot bypass platform emergency stop/global cap.
6. **Partner permissions**: never treat managed Service Partner as project owner/member; audit exact scope grants and authorize only permitted guide content. No cross-tenant information.
7. **Grounding**: only verified, published, audience-appropriate article snippets and safe server-derived context. Avoid arbitrary database browsing, private Telegram messages, wallet/signing/treasury/PCART mainnet data, and privileged tools. Answers cite article IDs and link to Help Center; unsupported questions state uncertainty instead of guessing. Do not escalate to Telegram Project Inbox.
8. **Cost and reliability**: bound prompt/output, timeout, concurrent calls, and provider retries (no blind retries after ambiguous result); prohibit client-controlled model IDs, token limits, destinations, or provider URL.
9. **Security QA**: test RLS/grants under anon/authenticated/service roles; cross-tenant, managed partner, owner, invalid auth, race/parallel reservation, stalled/failed/ambiguous provider, stale/pricing switches, emergency stop, docs prompt injection, and active frontend route guard. Production deployment requires separate owner approval.

## Deployment gate
Do **not** merge or deploy this PR as a production feature. Review the G2A.1 contract first; next develop the G2A.2 transaction/permission plan and test against an isolated test environment. Verify actual deployed function and configuration explicitly. This PR neither adds a Supabase migration nor changes `supabase/config.toml`. The deterministic Setup Help already tested remains unchanged.
