-- Cartel HQ presentation preference only. Never an entitlement, execution permit,
-- deployment attestation, verified contract, or on-chain token state.
-- NULL preserves each existing workspace's legacy onboarding/journey behavior.
ALTER TABLE public.workspaces
  ADD COLUMN IF NOT EXISTS launch_path text NULL;

ALTER TABLE public.workspaces
  ADD CONSTRAINT workspaces_launch_path_check
  CHECK (launch_path IN ('external_planned','external_live','cartel_supported','management_only'));

COMMENT ON COLUMN public.workspaces.launch_path IS
  'Owner-chosen display/onboarding path only. NULL keeps legacy behavior. External-live is owner-reported, never on-chain verification. No token creation or launch authorization.';
