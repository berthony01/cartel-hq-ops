# CARTEL HQ S2: Full authenticated preview readiness and isolation gate
**Status:** PREVIEW NOT SAFE TO BOOT. Read-only live state verified 2026-10-13. **No hosting, database migration, production canary or release is authorized by this report.**
**Scope:** GitHub PR #8 `feature/sticker-pack-private-thumbnails-s2-20261013`, existing Lovable Cartel Command Center, existing Supabase projects.

## Verified current state
- Production Lovable HEAD: `2411d12ef84738ea6d659ac90ce2a1eb24930471`. S2 PR #8 is a separate, DRAFT and UNMERGED branch; it is **not** the app served by the existing Lovable preview.
- Production Supabase: `ocoinbnjgstkmnwwvnhi` (`CARTEL HQ`), `ACTIVE_HEALTHY`.
- Existing staging Supabase: `llicojkxpzwylghptmkf` (`CARTEL HQ STAGING`), `ACTIVE_HEALTHY`.
- Stage `public` has only ten Cartel Guide/commercial/workspace tables, and **no** `media_assets`, `sticker_packs`, `stickers`, `sticker_versions`, or private `workspace-assets` bucket. It also contains 3 `s2_fixture` synthetic Sticker Lab tables.
- Stage `public.workspaces` and `public.workspace_members` already contain two rows each and have RLS enabled **without any SELECT policies**. The S2 test users are mapped to synthetic test workspaces in the separate `s2_fixture` schema. Existing `public` tables were not created by this S2 preview task and **must not be overwritten**.
- Production `public` contains 86 app tables, including relevant Sticker Lab models.
- The actual candidate source `src/integrations/supabase/client.ts` contains a **hardcoded PRODUCTION Supabase URL and public/anon key**. It is labeled auto-generated. Simply deploying the PR branch would point a new preview at the **LIVE production database**. This is the critical stop condition.
- `src/integrations/supabase/previewAuthStorage.ts` may broker the session with Lovable editor on Lovable preview domains. A test preview must never reuse or forward a production auth session; it requires isolated staging-only session persistence.
- The authenticated app route uses a real Supabase session and mounts `WorkspaceProvider`/`AppShell`, which in turn depend on more app data than the isolated S2 fixture tables.
- Prior S2 controls: user-reported 20/20 real staging Auth/private Storage access checks, user-reported hosted WASM alpha encode PASS, directly verified stage codec function restored to inert version 5 / HTTP 410; GitHub synthetic real-pack route 12/12 PASS at 390px and 1366px (run 38448089099). **None constitutes a full authenticated application preview.**

## Why a Lovable Remix or branch deploy is NOT yet safe
1. Remix copies app source with the hardcoded production backend target; a new URL, a private preview audience, or a new Lovable project does **not** isolate data.
2. Current staging lacks the app's core Sticker Lab `public` schema, row-level permissions and `workspace-assets` storage contract. Redirecting the frontend to it without an audited schema leads to auth/dashboard errors, not meaningful QA.
3. The existing staging `public` namespace is shared with other Cartel HQ development activity. Importing production migrations wholesale or replacing `workspaces` policies could disrupt unrelated staging work.
4. Production contains many PCART/Launch, Telegram and commercial systems. **Do not** replicate customer data, active jobs, provider credentials, scheduler state or production auth tokens into a preview.
5. A new Lovable project, preview host, Supabase branch/project, or additional usage must undergo a cost/quota check before execution.

## Safest implementation path: preview only after independent isolation
### Gate A: Prepare preview-client isolation in a temporary branch/build
- Work from PR #8 HEAD. Keep `main` unchanged.
- Derive a **preview-only build/config**, never altering the canonical production-generated client in main.
- Build must hard fail unless the resolved Supabase host/ref and publishable key belong **only** to staging `llicojkxpzwylghptmkf`. Check client **and SSR/server artifacts** for `ocoinbnjgstkmnwwvnhi`; fail on any production API endpoint/reachable calls.
- Disable the Lovable cross-preview auth broker **for this test build**; isolate sessions. Never paste passwords/tokens into GitHub logs or workflows.
- Default-deny mutation paths, and block live Telegram, paid AI, Stripe, PCART and production Chain endpoints from the test preview.

### Gate B: Resolve schema/tenant conflict without production data
- Read-only inventory of the minimal direct and indirect app-query dependencies for `/_authenticated/sticker-lab/$packId`, `WorkspaceProvider`, and `AppShell`.
- Provide an allowlisted synthetic staging schema migration with only required tables, constraints and workspace-scoped RLS. Because `public.workspaces` already exists, first identify its owner/use and obtain explicit consent before editing any shared public table or policy.
- If separation within the current staging database cannot be proven (for example, exposed custom PostgREST schema routing/policy separation cannot be verified), **STOP** and choose a genuinely independent database under a separately approved cost/quota plan.
- Use only the two owner-created staging Auth test accounts and fictional workspace records. Create zero real customer/production sticker assets, no Telegram accounts.
- Do not enable cron/schedulers/webhooks or expose paid provider integrations.

### Gate C: Host strictly private candidate app and run authenticated browser QA
- Hosting target must be isolated and nonproduction; restrict access. A preview URL is **not** sufficient evidence of backend isolation.
- On 390px and desktop widths, test full sign-in/out, workspace switching, pack loading, 12 synthetic transparent images, signed Storage GETs, thumbnail/pointer validity, missing WebP -> original PNG fallback, broken original -> placeholder, cross-workspace denied, and refresh. Capture console/network logs **without secrets**.
- Reconcile image byte counts against only synthetic expected baseline in test; do **not** claim actual production bandwidth/quality improvement.
- Require no production network calls and no writes to real production DB/Storage/Telegram. Stop on failed RLS or provenance uncertainty.

### Gate D: Separate owner sign-offs
1. Full isolated authenticated preview has a complete pass report.
2. Explicit, separately approved **one existing-production-sticker canary** with allowlist, baseline, safe WebP derivative, rollback/no overwrite, and quality comparison.
3. Only after canary: separately approved bounded existing-sticker backfill (maximum 12), and S2 frontend/backend release. Do not enable background sticker generation or Telegram sends as part of thumbnail QA.

## Current gate decision
**BLOCKED: do not provision/merge/deploy yet.** Exact blockers are production-hardcoded Supabase client, staging/public schema and RLS incompatibility, shared staging namespace, and absence of a vetted private preview host/cost boundary.

**One prioritized next owner decision:** Approve a **bounded isolated full-app preview setup** that (a) repoints only an ephemeral candidate build to existing staging, (b) does not alter shared staging `public` schema until an allowlist and isolation audit passes, and (c) stops for separate consent before creating any billable resource. This authorization must not be interpreted as permission to merge PR #8 or touch the 12 production images.


## 2026-10-13: Isolated build preflight, fail-closed result
- Added **CI-only** S2 staging-target build script `scripts/sticker-s2-stage-client-build-preflight.mjs` and a final draft-PR check in `.github/workflows/sticker-s2-draft-qa.yml`. It temporarily replaces only an ephemeral GitHub runner checkout's production URL/key references, `.env`, `supabase/config.toml`, generated client, Lovable auth-storage broker and known logo/MCP modules. All touched files are restored in a `finally` block. No app source changes have been committed to main; no customer hosting or API/database/Storage calls are performed.
- **Confirmed hidden production references while auditing candidate preview compilation**:
  - Initial build run `38455915426` blocked due 13 compiled artifacts still referencing production `ocoinbnjgstkmnwwvnhi` (primarily original `.env` and MCP client).
  - Second run `38456573347` blocked on the hardcoded `src/lib/cartel-network.ts` production logo URL (3 compiled artifacts).
  - Third run `38457098787` blocked on one remaining compiled router module.
  - Added fail-fast source scan and corrected its extension filter. **Latest run `38457710239` failed as expected, identifying `src/lib/mcp/index.ts` and `src/routes/tg.tsx` as unresolved production project references.** Crucially it stops *before* staging build when any runtime source can still access production. No real production requests were attempted.
- The latest workflow's other blocking checks **passed**, including Deno synthetic WASM, full pack-route Chrome synthetic QA, original component Chrome QA, TypeScript, and normal app build. Only the new **isolation gate** failed; three known preexisting backend Deno-check typing errors remain nonblocking, and are not an Edge readiness pass.
- **Decision:** Do not bypass, disable or relax production URL scan. Do not run a private preview until every executable source module and server environment points only at a reviewed staging backend, including OAuth/MCP and Telegram web routes. The appropriate next step is a bounded source audit of those two unresolved modules and their downstream dependencies, *not* new deployment resources. Do not keep triggering costly full Actions jobs merely to discover one path per run.
- Even after code-only isolation passes, current staging lacks live Sticker Lab public tables/RLS; it is shared with Cartel Guide, so an authenticated full-app preview is STILL BLOCKED until a separately approved schema/hosting isolation plan.
