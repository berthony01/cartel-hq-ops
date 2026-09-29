# SP-A: Managed Client Access (Service Partner) — Plan

Start gate verified: HEAD `92daddfc2e1a45707acfa95bbb3ce3f2b9aa7b27`.

## Decision: separate access table only, NOT `workspace_members` role='service_partner'

Live read-only audit shows:
- `is_workspace_member(ws, uid)` = any row in `workspace_members` (no role filter). It is used by 16 RLS policies (including direct write policies) and 14 DB functions.
- `is_workspace_operator` = owner/admin; used by 46 functions.
- The only role in use today is `owner`.

A `service_partner` row in `workspace_members` would instantly pass `is_workspace_member` everywhere: read access to every workspace table plus the direct member write policies (project_profiles, brand_kits, media_assets, project_profile_videos, sticker_packs) and all 14 member-gated functions. Closing that would mean rewriting ~30 surfaces in one turn. That is the high-risk path.

A separate table leaves every existing policy and function untouched: partners get **zero** access by default. Each scope then grants access on purpose, one surface at a time. Owner/admin/member behavior and the platform-owner bypass stay the same.

## What SP-A delivers (the smallest safe unit)

1. The access relation: invite, accept, decline, revoke, and edit scopes.
2. The Partner dashboard's "Managed Projects" and "Pending invitations" lists.
3. The owner's "Service Partner access" panel in Settings.
4. The project switcher lists managed projects, with a "Managed" badge, once access is accepted.
5. One scope actually enforced end-to-end: `project_identity`. The partner can read and edit the Project Profile only through a server function.
6. A single server helper that every later scope reuses.

The other six scopes can be stored and edited in SP-A but grant nothing yet. The UI labels them "Coming soon". Each gets its own SP-B slice.

## Database (one additive migration)

Table `public.partner_client_access`:
- id, workspace_id (FK workspaces), partner_id (FK partners), partner_user_id
- status: `pending | active | declined | revoked`
- scopes `text[]`, checked by a validation trigger against the 7 allowed values
- invited_by, invited_at, responded_at, revoked_at, revoked_by, created_at, updated_at
- Partial unique index on (workspace_id, partner_id) where status in (pending, active)
- Grants: SELECT to authenticated, ALL to service_role. No INSERT/UPDATE/DELETE grant to authenticated, so all writes go through RPCs.
- RLS SELECT: the workspace owner (`workspaces.owner_id = auth.uid()`) or `partner_user_id = auth.uid()`.
- No history is ever deleted. Revoke only changes status.

Helper functions (SECURITY DEFINER, `SET search_path TO ''`, fail closed):
- `partner_has_scope(_workspace_id, _scope, _user_id default auth.uid())`: true only when the row is active, the scope is in `scopes`, the partner is still approved and not suspended, and Service Partner is enabled.
- `partner_is_denied_area(_area)`: a constant deny list (billing, ownership, wallet_treasury, chain_deployment, platform_admin). It returns true for all partner callers, whatever their scopes.

RPCs (authenticated only, no anon grant, REVOKE from PUBLIC):
- `owner_invite_service_partner(_workspace_id, _partner_ref, _scopes)`: caller must be `workspaces.owner_id`. The target must be an approved, active Service Partner. Rejects self-invites and duplicate pending/active invites.
- `partner_respond_client_invite(_access_id, _accept boolean)`: caller must be the invited partner, and the invite must be pending.
- `owner_revoke_service_partner(_access_id)`: owner only. Takes effect at once (status revoked). Touches no other table.
- `owner_update_partner_scopes(_access_id, _scopes)`: owner only, for pending or active rows.
- `list_my_managed_workspaces()`: returns id, name, and scopes for the caller's active rows only.
- `list_my_partner_invites()` / `owner_list_partner_access(_workspace_id)`: return a display name only, with no emails or other personal data.
- `partner_get_project_profile(_ws)` / `partner_update_project_profile(_ws, fields)`: require `partner_has_scope(_ws,'project_identity')`. They reuse the existing profile validation. They cannot publish or hide the profile or change its slug (owner-only, deferred).

Partner suspension (existing owner-only suspend): `partner_has_scope` checks partner status, so a suspended partner loses all access at once without any row being deleted.

**Unchanged:** `is_workspace_member`, `is_workspace_operator`, `can_use_project_tools`, `is_platform_owner`, `has_platform_unrestricted_access`, and all existing RLS policies. No existing policy needs tightening because partners are never added to `workspace_members`.

## Frontend

- `src/lib/partner-client-access.ts` (new): typed RPC wrappers and query keys.
- `src/lib/workspace-context.tsx`: merge `list_my_managed_workspaces()` into the list as `{ ..., access: 'member' | 'managed', scopes }`. Owned projects come first. Stored selection is still checked against this merged list.
- `src/components/cartel/WorkspaceSwitcher.tsx`: separate "Managed client projects" group with a badge.
- `src/components/cartel/SidebarNav.tsx`: when the active project is managed, show only scope-backed items. In SP-A that is Project Profile plus an overview.
- `src/routes/_authenticated/partners.tsx`: Managed Projects and Pending Invitations sections (accept/decline), for approved Service Partners only.
- `src/components/cartel/ServicePartnerAccessPanel.tsx` (new), mounted in `src/routes/_authenticated/settings.tsx` for the owner only: invite by partner reference, scope checkboxes, edit, revoke with confirmation.
- `src/routes/_authenticated/project-profile.tsx` (or its current file): when managed, read and save through the partner RPCs, with publish, hide and slug controls hidden.
- Other gated pages, if a managed project is active: show "Your access to this project doesn't include this area" instead of empty or broken screens.

## Flows

```text
Owner invites (scopes) -> pending -> Partner accepts -> active -> appears in switcher
                                   -> Partner declines -> declined
Owner edits scopes (pending/active) -> takes effect on next request
Owner revokes -> revoked -> removed from switcher; server checks fail at once
```

## Backward-compatibility risks

- Workspace list merge: owner-only users must see an identical list, so managed rows are added only from a separate RPC.
- `selectWorkspace` invalidates all queries. Member-only pages may hit empty RLS results for managed projects, so they get guard components.
- Existing partner summary and applications are unchanged.
- The advisor baseline gains new SECURITY DEFINER findings (authenticated only). The migration notes must list them as reviewed.

## Deferred to SP-B (intentionally)

- Enforcing each remaining scope: community_management, broadcasts, launch_watcher_comms, sticker_tools, missions, project_inbox. Each needs its own RPC/Edge path and review.
- Partner access to Edge Functions (telegram-group, sticker-ai, etc.).
- Profile publish/hide and slug changes by partners.
- Email or Telegram invite notifications, partner search directory, an audit log UI, expiring invites.
- Any usage/billing attribution for work partners do.

## Migration order

1. Build turn: write the SQL as `docs/sql/SP_A_partner_client_access.sql` (staged, not applied) and put the frontend behind a feature check: if `list_my_managed_workspaces` is missing, fall back to today's behavior.
2. Run the regressions on a throwaway local DB.
3. With separate owner approval: apply the migration to production, verify grants/RLS/advisors, regenerate types.
4. Publishing is a separate approval. The frontend is safe either way because it fails closed when the RPCs are absent.

## Regression tests (`scripts/sp-a-managed-client-access-regression.ts`, local DB)

- Only the owner can invite. An admin, member, stranger or the partner itself is rejected. Non-approved, suspended or affiliate-only partners are rejected.
- Pending grants nothing. Accept only by the invited partner. A second accept or a replayed decline is rejected.
- After accept: `partner_has_scope` is true only for granted scopes. `is_workspace_member` and `is_workspace_operator` stay false for the partner.
- The partner cannot select or write projects, brand_kits, media_assets, sticker_packs, launches or billing tables directly (RLS still denies).
- Denied areas stay false even with every scope granted. The partner cannot call any `is_workspace_operator`-gated RPC.
- Revoke works at once, leaves the other tables' row counts unchanged, and does not re-grant.
- Scope edits apply. Invalid scopes are rejected.
- Suspending the partner removes access.
- The platform-owner bypass is unchanged. anon cannot run any SP-A RPC.
- Existing suites still pass: Service Partner 75/0, Partner 1A/1B, public discovery (D-24 allowlist update), commercial entitlements.

Smoke tests (after approval, live): owner invites the test partner, the partner accepts, the project appears as Managed, the profile edit saves, the partner is blocked from billing and Launch Control, the owner revokes, and the project disappears.

## Build-turn file allowlist

- docs/sql/SP_A_partner_client_access.sql (new)
- docs/SP_A_MANAGED_CLIENT_ACCESS_RUNBOOK.md (new)
- src/lib/partner-client-access.ts (new)
- src/components/cartel/ServicePartnerAccessPanel.tsx (new)
- src/components/cartel/ManagedAccessGuard.tsx (new)
- src/lib/workspace-context.tsx
- src/components/cartel/WorkspaceSwitcher.tsx
- src/components/cartel/SidebarNav.tsx
- src/components/cartel/AppShell.tsx (guard mount only)
- src/routes/_authenticated/partners.tsx
- src/routes/_authenticated/settings.tsx
- Project Profile route/component file (exact path confirmed at build start)
- scripts/sp-a-managed-client-access-regression.ts (new)
- scripts/public-discovery-seo-regression.ts (D-24 allowlist only)
- roadmap.md

Forbidden: Stripe/billing, affiliate, launcher/chain/treasury, Edge Functions, existing RLS/helpers, owner bypass, publish.
