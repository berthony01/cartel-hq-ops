ALTER TABLE public.workspaces
  ADD COLUMN IF NOT EXISTS project_goal text NULL
  CONSTRAINT workspaces_project_goal_check CHECK (project_goal IN ('community','launch','both'));
COMMENT ON COLUMN public.workspaces.project_goal IS
  'Owner presentation/onboarding preference only (community|launch|both). NULL = not chosen (legacy journey). Never an entitlement or launch/mainnet authorization.';