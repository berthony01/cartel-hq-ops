# SP-A Managed Client Access — Runbook

Status: STAGED. SQL is in `docs/sql/SP_A_partner_client_access.sql`. It has NOT been applied to production. Nothing has been published.

## What SP-A does
- A project owner invites an approved, active Service Partner using that partner's sign-in email.
- Nothing is shared until the partner accepts. The owner can edit permissions or revoke access at any time.
- Revoking only changes the access row's status. Client data, settings, history, subscription and communities are untouched, and no row is ever deleted.
- Service Partners are never added to `workspace_members`. `is_workspace_member`, `is_workspace_operator`, `can_use_project_tools`, the platform-owner bypass and every existing RLS policy stay unchanged.
- Access requires all of the following: the access row is active, the scope is granted, the partner is approved, the partner is a Service Partner, and an active terms row has the Service Partner track open. Suspending the partner or retiring the terms removes all managed access immediately.
- Only `project_identity` is enforced end-to-end. It covers name, ticker, chain, tagline, description and official links, all through `partner_update_project_profile`. It gives no control over the slug, discovery status, logo, verification, or profile creation.
- The six other scopes are stored and shown as "Coming soon". They grant nothing (SP-B).
- Always denied: billing/subscription, ownership transfer, wallet/treasury/private keys, chain deployment/launch execution, platform admin.

## Production order (each step needs explicit owner approval)
1. **read-only preflight**: confirm `partner_client_access` does not exist; record the security advisor baseline (lint 0028 / 0029 counts); confirm backups/PITR. On the Free plan backups cannot be confirmed, so the owner must accept that risk explicitly.
2. **Stage and review**: review the diff and run `bun scripts/sp-a-managed-client-access-regression.ts` (local throwaway DB).
3. **Publish the SP-A frontend** first (CP-SPA-PUBLISH). Without the RPCs it fails closed: no managed projects, no invitations, the owner panel says "not available yet", and owner/member behavior is unchanged. This is why publishing may safely come before the migration.
4. **Apply the SP-A migration** (CP-SPA-SQL) using the migration tool with the exact staged file contents.
5. **Verify schema**: RLS enabled; `authenticated` has only SELECT on the table; no anon EXECUTE on any SP-A function; `partner_client_access_eligible` and `partner_client_scopes_valid` are service_role only. Regenerate types. Rerun the advisors: lint 0029 (authenticated SECURITY DEFINER) should rise only by the reviewed SP-A functions (`partner_has_scope`, `owner_invite_service_partner`, `partner_respond_client_invite`, `owner_revoke_service_partner`, `owner_update_partner_scopes`, `list_my_managed_workspaces`, `list_my_partner_invites`, `owner_list_partner_access`, `partner_get_project_profile`, `partner_update_project_profile`). Lint 0028 (anon) must not change. Any other new finding is a STOP.
6. **Live smoke tests**, using a test owner project and a test approved Service Partner:
   - S1 The owner invites by email. A wrong email shows the generic "not available" message.
   - S2 The partner sees the pending invite; the project is not yet in the switcher.
   - S3 The partner accepts. The project appears under "Managed client projects" with a Managed badge.
   - S4 The partner edits Project Profile fields. There are no slug, publish or hide controls.
   - S5 The partner opens HQ, Launch Control, Community Command, Settings/Billing and Owner Console and sees the no-access state for each.
   - S6 The owner removes `project_identity`, and the partner's editor shows no access.
   - S7 The owner revokes. The project disappears from the partner's switcher, and the owner's data is unchanged.
   - S8 The Affiliate Program still shows Deferred/Closed.

## Rollback / close
- One partner: the owner revokes (`owner_revoke_service_partner`).
- All partners at once: retire the active Service Partner terms. Every managed access check then fails closed.
- Rows in `partner_client_access` are never deleted — never delete them. History is preserved.
- A frontend-only rollback is safe: the table stays and grants nothing without the UI.

## Known risks
- An owner of any project can learn whether an email belongs to an active Service Partner (by whether the invite succeeds). Errors are generic and no directory exists; rate limiting is deferred to SP-B.
- Closing Service Partner applications (retiring the terms) also pauses all managed access. This is intended fail-closed behavior.
- There is no attorney review.

## Deferred to SP-B
Enforcement of community_management, broadcasts, launch_watcher_comms, sticker_tools, missions and project_inbox; partner access through Edge Functions; profile creation, publish and slug changes; logo/media; invite notifications (email/Telegram); invite rate limiting and expiry; an audit log view; usage attribution.
