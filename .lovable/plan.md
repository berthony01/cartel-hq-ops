# SP-B0 Commercial Entitlement Adapter — Audit and Plan

Starting state: HEAD after the SP-B1 prebuild stop. The only file changed is the roadmap blocker line. No SQL, no publish. Plan only.

## Audit findings (checked live, read-only)

`evaluate_commercial_access(_workspace_id uuid, _feature_key text, _user_id uuid DEFAULT auth.uid())` returns jsonb. It is SECURITY DEFINER with `search_path = public`, and EXECUTE is granted to authenticated and service_role. It runs these steps in order:
1. Missing context → `INVALID_CONTEXT`.
2. Actor mismatch (caller not null and `_user_id` differs from caller) → `ACTOR_MISMATCH`.
3. `has_platform_unrestricted_access(effective user)` → `UNRESTRICTED`. This is the owner bypass.
4. `is_workspace_member(workspace, effective user)` fails → `NOT_MEMBER`.
5. Steps 5–10 look only at the workspace: the current assignment, or the virtual `cartel_free` v1 set to enforce; assignment status; the plan entitlement; feature vs quota; the quota period; `commercial_feature_usage(...)`; and the limit decision.

Steps 5–10 never use the user. So the workspace-level entitlement logic can move out cleanly, without a billing rewrite.

`commercial_feature_usage` is SECURITY DEFINER, and only service_role (plus postgres) can run it.

The `project_inbox` entitlement row found is kind `feature`, period `none`. So for inbox there is no quota or usage counting today, and the result depends only on the assignment and entitlement.

Existing callers of `evaluate_commercial_access` (all keep calling it unchanged):
- In the database: `create_project_inbox_team_reply`, `set_project_inbox_replies_enabled`, `notify_launch_watchers_official_contract`, `transition_launch_status`.
- Server/app code: `src/lib/social-read.functions.ts`, `src/lib/social-mission-metrics.functions.ts`, `src/lib/telegram-miniapp-bridge.functions.ts`.
- Edge Functions: `supabase/functions/_shared/commercial-access.ts`, mirrored in `backend-source/.../_shared/commercial-access.ts`.
- Regressions: `commercial-entitlements`, `commercial-guards`, `commercial-billing`, `commercial-c1/c3/c3a`, `partner-program-1a`.

## Decision

Accept the adapter, with the narrowest shape. The risk is low because steps 5–10 are a pure, self-contained block. It is only acceptable if the old function's output stays identical. The regression matrix below proves that before anything ships.

### New internal core
`public.commercial_evaluate_workspace_feature(_workspace_id uuid, _feature_key text, _base jsonb) RETURNS jsonb`
- LANGUAGE plpgsql, STABLE, SECURITY DEFINER, `SET search_path TO 'public'`. This matches the evaluator it came from, so name resolution stays byte-identical.
- The body is steps 5–10 exactly as they are today (text moved, not rewritten). It starts from `_base`, the pre-built result object, so JSON key order and content are unchanged.
- It does no user authorization and does not check for unrestricted access.
- `REVOKE ALL FROM PUBLIC, anon, authenticated`. `GRANT EXECUTE TO service_role` only. SECURITY DEFINER callers owned by postgres can still call it.

**Unrestricted access stays only in `evaluate_commercial_access`.** The core gets no actor parameter, so it cannot become a way to bypass the plan check.

### `evaluate_commercial_access` (same signature, grants, owner and search_path)
Steps 1–4 are unchanged. It then does `RETURN public.commercial_evaluate_workspace_feature(_workspace_id, _feature_key, v_result);`. It is replaced with `CREATE OR REPLACE`, and its ACL is re-asserted to exactly what it is today.

### New partner entitlement adapter
`public.partner_evaluate_commercial_access(_workspace_id uuid, _feature_key text) RETURNS jsonb`
- SECURITY DEFINER, `SET search_path TO ''`, fully qualified names.
- Requires `auth.uid()` and `public.partner_has_scope(_workspace_id, _feature_key)`. Otherwise it returns the same base object with reason `NOT_PARTNER_SCOPE` (allowed false).
- Allows only `_feature_key = 'project_inbox'` in SP-B0/B1; any other key → `INVALID_CONTEXT`.
- Then delegates to the core, so the client's own plan decides.
- No unrestricted bypass for partners: a platform owner acting as a partner is not a case to handle.
- Not granted to authenticated. It is internal only (service_role), and called only from `partner_inbox_create_reply`.

The partner reply wrapper in SP-B1 then calls this adapter where the owner reply calls the evaluator, and reproduces every other owner check exactly.

## Regression matrix (throwaway local Postgres with the live definitions)

Snapshot the old `evaluate_commercial_access` output, apply SP-B0, and require byte-equal JSON for each of these:
- missing workspace / feature / user → INVALID_CONTEXT
- `_user_id` different from the caller → ACTOR_MISMATCH
- platform owner, both member and non-member → UNRESTRICTED
- non-member → NOT_MEMBER
- member with no assignment → virtual cartel_free, enforce
- assignment in each status: active, trialing, past_due, canceled, suspended; each in observe and enforce
- feature not included / disabled
- feature included
- quota under and at the limit, for each period (calendar month UTC, day UTC, none); limit null
- service_role caller (auth.uid null) passing `_user_id`

Also:
- the evaluator's ACL, search_path and owner are unchanged
- the core cannot be run by anon or authenticated
- partner adapter: no scope, revoked grant, suspended partner, or wrong feature → denied; with scope → equals the core's result for that workspace
- `workspace_members` is unchanged, and `is_workspace_member` / `is_workspace_operator` are byte-identical
- all existing commercial suites and partner-1a pass unchanged

## SP-B0 + resumed SP-B1 allowlist
- docs/sql/SP_B0_commercial_workspace_entitlement_core.sql (new; staged only)
- docs/sql/SP_B1_partner_project_inbox.sql
- docs/SP_B1_PARTNER_INBOX_RUNBOOK.md (covers the B0 → B1 apply order)
- scripts/sp-b0-commercial-core-regression.ts (new)
- scripts/sp-b1-partner-inbox-regression.ts
- scripts/sp-a-managed-client-access-regression.ts (update the active-scope assertion only)
- scripts/public-discovery-seo-regression.ts (D-24 allowlist only)
- src/lib/partner-client-access.ts, src/lib/project-inbox.ts
- src/components/cartel/ProjectInboxPanel.tsx, ManagedAccessGuard.tsx, SidebarNav.tsx, ServicePartnerAccessPanel.tsx
- src/routes/_authenticated/telegram.tsx
- roadmap.md

Prohibited: plans, entitlements, assignments, usage, Stripe; Edge Functions and `_shared/commercial-access.ts`; the existing commercial regression files; owner inbox functions; membership helpers; production SQL; publish.

## Production order
1. Stage and review the build.
2. CP-SPB1-PUBLISH: the frontend fails closed.
3. CP-SPB0-SQL: apply the core and the new evaluator, then confirm evaluator output matches on live samples read-only (owner, member, non-member).
4. CP-SPB1-SQL: apply the partner inbox functions.
5. Separate turn: regenerate types.
6. Two-account smoke test.

Rollback for B0: re-apply the captured original `evaluate_commercial_access` body and drop the core. B1 comes out by revoking execute on the partner functions.

## Reasons to reject (none found; re-check at build)
Reject if any of these turn out true:
- steps 5–10 depend on the user or on `auth.uid()` anywhere
- the byte-equality matrix shows any difference
- the live evaluator body differs from the latest repository migration (C1 `20260927170206`), meaning it has drifted. If so, STOP and fall back to read-only SP-B1 (read, status, acknowledge; no replies).
