-- PARITY COPY ONLY - ALREADY APPLIED TO AUTHORITATIVE SUPABASE AS 20260908121317_private_beta_publication_hardening - DO NOT REAPPLY BLINDLY
-- Source-of-truth for this migration is the Supabase project; this file exists only for repository audit/parity.

-- Temporary private-beta gate: only the platform owner may self-provision a new workspace.
-- This should be replaced by a proper invite/entitlement model before opening public sign-up.
create or replace function public.can_create_private_beta_workspace()
returns boolean
language sql
stable
security definer
set search_path = pg_catalog, public
as $$
  select auth.uid() is not null and public.is_platform_owner(auth.uid()) is true;
$$;

comment on function public.can_create_private_beta_workspace() is
  'Temporary private-beta workspace provisioning gate. Returns true only for the platform owner. Replace with invite/entitlement model before public sign-up.';

revoke all on function public.can_create_private_beta_workspace() from public;
revoke all on function public.can_create_private_beta_workspace() from anon;
grant execute on function public.can_create_private_beta_workspace() to authenticated;

drop policy if exists workspaces_insert_own on public.workspaces;
drop policy if exists workspaces_insert_private_beta on public.workspaces;

create policy workspaces_insert_private_beta
on public.workspaces
for insert
to authenticated
with check (
  owner_id = auth.uid()
  and public.can_create_private_beta_workspace()
);

comment on policy workspaces_insert_private_beta on public.workspaces is
  'Temporary private-beta insert policy: workspace creation is restricted to the platform owner. Replace with invite/entitlement model before public sign-up.';

-- Reduce accidental exposure of the RLS auto-enable helper used by the ensure_rls event trigger.
revoke execute on function public.rls_auto_enable() from public;
revoke execute on function public.rls_auto_enable() from anon;
revoke execute on function public.rls_auto_enable() from authenticated;
