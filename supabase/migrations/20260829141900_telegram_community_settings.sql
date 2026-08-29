-- SOURCE-CONTROL SNAPSHOT ONLY. This migration was already applied directly to the
-- authoritative external Supabase project; it is committed here for version control.

CREATE TABLE IF NOT EXISTS public.telegram_community_settings (
  group_connection_id uuid PRIMARY KEY REFERENCES public.telegram_group_connections(id) ON DELETE CASCADE,
  workspace_id uuid NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
  welcome_enabled boolean NOT NULL DEFAULT false,
  welcome_message text NOT NULL DEFAULT '👋 Welcome {first_name} to {community_name}!

Please check the pinned messages and official links before getting started.',
  mention_member boolean NOT NULL DEFAULT true,
  auto_delete_enabled boolean NOT NULL DEFAULT true,
  auto_delete_seconds smallint NOT NULL DEFAULT 45,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT telegram_community_settings_seconds_check CHECK (auto_delete_seconds BETWEEN 10 AND 120),
  CONSTRAINT telegram_community_settings_message_check CHECK (char_length(welcome_message) BETWEEN 1 AND 3500)
);

CREATE INDEX IF NOT EXISTS telegram_community_settings_workspace_idx
  ON public.telegram_community_settings (workspace_id);

GRANT SELECT ON public.telegram_community_settings TO authenticated;
GRANT ALL ON public.telegram_community_settings TO service_role;

ALTER TABLE public.telegram_community_settings ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Workspace members can read community settings"
  ON public.telegram_community_settings
  FOR SELECT
  TO authenticated
  USING (public.is_workspace_member(workspace_id, auth.uid()));

CREATE TRIGGER telegram_community_settings_set_updated_at
  BEFORE UPDATE ON public.telegram_community_settings
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();
