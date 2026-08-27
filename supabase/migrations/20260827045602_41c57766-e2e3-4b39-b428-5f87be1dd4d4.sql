-- ============ helpers ============
CREATE OR REPLACE FUNCTION public.set_updated_at()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$;

-- ============ profiles ============
CREATE TABLE public.profiles (
  id uuid PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  display_name text,
  avatar_url text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, UPDATE ON public.profiles TO authenticated;
GRANT ALL ON public.profiles TO service_role;
ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;
CREATE POLICY "profiles_select_own" ON public.profiles FOR SELECT TO authenticated USING (id = auth.uid());
CREATE POLICY "profiles_update_own" ON public.profiles FOR UPDATE TO authenticated USING (id = auth.uid()) WITH CHECK (id = auth.uid());
CREATE TRIGGER profiles_set_updated_at BEFORE UPDATE ON public.profiles FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  INSERT INTO public.profiles (id, display_name, avatar_url)
  VALUES (
    NEW.id,
    NULLIF(NEW.raw_user_meta_data ->> 'display_name', ''),
    NULLIF(NEW.raw_user_meta_data ->> 'avatar_url', '')
  )
  ON CONFLICT (id) DO NOTHING;
  RETURN NEW;
END;
$$;

CREATE TRIGGER on_auth_user_created
AFTER INSERT ON auth.users
FOR EACH ROW EXECUTE FUNCTION public.handle_new_user();

-- ============ workspaces ============
CREATE TABLE public.workspaces (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL,
  slug text UNIQUE,
  owner_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE RESTRICT,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.workspaces TO authenticated;
GRANT ALL ON public.workspaces TO service_role;
ALTER TABLE public.workspaces ENABLE ROW LEVEL SECURITY;
CREATE INDEX idx_workspaces_owner_id ON public.workspaces(owner_id);
CREATE TRIGGER workspaces_set_updated_at BEFORE UPDATE ON public.workspaces FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- ============ workspace_members ============
CREATE TABLE public.workspace_members (
  workspace_id uuid NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  role text NOT NULL DEFAULT 'member' CHECK (role IN ('owner','admin','member')),
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (workspace_id, user_id)
);
GRANT SELECT ON public.workspace_members TO authenticated;
GRANT ALL ON public.workspace_members TO service_role;
ALTER TABLE public.workspace_members ENABLE ROW LEVEL SECURITY;
CREATE INDEX idx_workspace_members_user_id ON public.workspace_members(user_id);

-- non-recursive membership helper
CREATE OR REPLACE FUNCTION public.is_workspace_member(_workspace_id uuid, _user_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.workspace_members wm
    WHERE wm.workspace_id = _workspace_id AND wm.user_id = _user_id
  );
$$;

CREATE OR REPLACE FUNCTION public.is_workspace_owner(_workspace_id uuid, _user_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.workspaces w
    WHERE w.id = _workspace_id AND w.owner_id = _user_id
  );
$$;

-- workspaces policies (after helpers)
CREATE POLICY "workspaces_select_member" ON public.workspaces FOR SELECT TO authenticated
  USING (owner_id = auth.uid() OR public.is_workspace_member(id, auth.uid()));
CREATE POLICY "workspaces_insert_own" ON public.workspaces FOR INSERT TO authenticated
  WITH CHECK (owner_id = auth.uid());
CREATE POLICY "workspaces_update_owner" ON public.workspaces FOR UPDATE TO authenticated
  USING (owner_id = auth.uid()) WITH CHECK (owner_id = auth.uid());
CREATE POLICY "workspaces_delete_owner" ON public.workspaces FOR DELETE TO authenticated
  USING (owner_id = auth.uid());

CREATE POLICY "workspace_members_select_member" ON public.workspace_members FOR SELECT TO authenticated
  USING (public.is_workspace_member(workspace_id, auth.uid()));

-- owner membership trigger
CREATE OR REPLACE FUNCTION public.handle_new_workspace()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  INSERT INTO public.workspace_members (workspace_id, user_id, role)
  VALUES (NEW.id, NEW.owner_id, 'owner')
  ON CONFLICT (workspace_id, user_id) DO NOTHING;
  RETURN NEW;
END;
$$;

CREATE TRIGGER on_workspace_created
AFTER INSERT ON public.workspaces
FOR EACH ROW EXECUTE FUNCTION public.handle_new_workspace();

-- ============ brand_kits ============
CREATE TABLE public.brand_kits (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL UNIQUE REFERENCES public.workspaces(id) ON DELETE CASCADE,
  brand_name text NOT NULL,
  ticker text,
  description text,
  website_url text,
  x_url text,
  telegram_url text,
  colors jsonb NOT NULL DEFAULT '[]'::jsonb,
  fonts jsonb NOT NULL DEFAULT '[]'::jsonb,
  ai_style_notes text,
  approved_phrases jsonb NOT NULL DEFAULT '[]'::jsonb,
  prohibited_styles jsonb NOT NULL DEFAULT '[]'::jsonb,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.brand_kits TO authenticated;
GRANT ALL ON public.brand_kits TO service_role;
ALTER TABLE public.brand_kits ENABLE ROW LEVEL SECURITY;
CREATE TRIGGER brand_kits_set_updated_at BEFORE UPDATE ON public.brand_kits FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();
CREATE POLICY "brand_kits_select_member" ON public.brand_kits FOR SELECT TO authenticated
  USING (public.is_workspace_member(workspace_id, auth.uid()));
CREATE POLICY "brand_kits_insert_member" ON public.brand_kits FOR INSERT TO authenticated
  WITH CHECK (public.is_workspace_member(workspace_id, auth.uid()));
CREATE POLICY "brand_kits_update_member" ON public.brand_kits FOR UPDATE TO authenticated
  USING (public.is_workspace_member(workspace_id, auth.uid()))
  WITH CHECK (public.is_workspace_member(workspace_id, auth.uid()));
CREATE POLICY "brand_kits_delete_member" ON public.brand_kits FOR DELETE TO authenticated
  USING (public.is_workspace_member(workspace_id, auth.uid()));

-- ============ media_assets ============
CREATE TABLE public.media_assets (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
  uploaded_by uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
  storage_path text NOT NULL UNIQUE,
  asset_type text NOT NULL CHECK (asset_type IN ('logo','mascot','reference_image','generated_sticker','other')),
  mime_type text,
  width integer CHECK (width IS NULL OR width > 0),
  height integer CHECK (height IS NULL OR height > 0),
  file_size_bytes bigint CHECK (file_size_bytes IS NULL OR file_size_bytes >= 0),
  transparency_valid boolean,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.media_assets TO authenticated;
GRANT ALL ON public.media_assets TO service_role;
ALTER TABLE public.media_assets ENABLE ROW LEVEL SECURITY;
CREATE INDEX idx_media_assets_workspace_type ON public.media_assets(workspace_id, asset_type);
CREATE POLICY "media_assets_select_member" ON public.media_assets FOR SELECT TO authenticated
  USING (public.is_workspace_member(workspace_id, auth.uid()));
CREATE POLICY "media_assets_insert_member" ON public.media_assets FOR INSERT TO authenticated
  WITH CHECK (public.is_workspace_member(workspace_id, auth.uid()));
CREATE POLICY "media_assets_update_member" ON public.media_assets FOR UPDATE TO authenticated
  USING (public.is_workspace_member(workspace_id, auth.uid()))
  WITH CHECK (public.is_workspace_member(workspace_id, auth.uid()));
CREATE POLICY "media_assets_delete_member" ON public.media_assets FOR DELETE TO authenticated
  USING (public.is_workspace_member(workspace_id, auth.uid()));

-- ============ telegram_connections ============
CREATE TABLE public.telegram_connections (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL UNIQUE REFERENCES public.profiles(id) ON DELETE CASCADE,
  telegram_user_id bigint NOT NULL UNIQUE,
  telegram_username text,
  first_name text,
  last_name text,
  connected_at timestamptz NOT NULL DEFAULT now(),
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.telegram_connections TO authenticated;
GRANT ALL ON public.telegram_connections TO service_role;
ALTER TABLE public.telegram_connections ENABLE ROW LEVEL SECURITY;
CREATE POLICY "telegram_connections_select_own" ON public.telegram_connections FOR SELECT TO authenticated USING (user_id = auth.uid());
CREATE POLICY "telegram_connections_insert_own" ON public.telegram_connections FOR INSERT TO authenticated WITH CHECK (user_id = auth.uid());
CREATE POLICY "telegram_connections_update_own" ON public.telegram_connections FOR UPDATE TO authenticated USING (user_id = auth.uid()) WITH CHECK (user_id = auth.uid());
CREATE POLICY "telegram_connections_delete_own" ON public.telegram_connections FOR DELETE TO authenticated USING (user_id = auth.uid());

-- ============ sticker_packs ============
CREATE TABLE public.sticker_packs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
  created_by uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
  title text NOT NULL,
  theme text NOT NULL DEFAULT 'custom',
  pack_size smallint NOT NULL CHECK (pack_size IN (6,12,24)),
  status text NOT NULL DEFAULT 'draft' CHECK (status IN ('draft','generating','review','ready','publishing','published','failed')),
  telegram_set_name text,
  telegram_set_url text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.sticker_packs TO authenticated;
GRANT ALL ON public.sticker_packs TO service_role;
ALTER TABLE public.sticker_packs ENABLE ROW LEVEL SECURITY;
CREATE INDEX idx_sticker_packs_workspace_status ON public.sticker_packs(workspace_id, status);
CREATE TRIGGER sticker_packs_set_updated_at BEFORE UPDATE ON public.sticker_packs FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();
CREATE POLICY "sticker_packs_select_member" ON public.sticker_packs FOR SELECT TO authenticated
  USING (public.is_workspace_member(workspace_id, auth.uid()));
CREATE POLICY "sticker_packs_insert_member" ON public.sticker_packs FOR INSERT TO authenticated
  WITH CHECK (public.is_workspace_member(workspace_id, auth.uid()));
CREATE POLICY "sticker_packs_update_member" ON public.sticker_packs FOR UPDATE TO authenticated
  USING (public.is_workspace_member(workspace_id, auth.uid()))
  WITH CHECK (public.is_workspace_member(workspace_id, auth.uid()));
CREATE POLICY "sticker_packs_delete_member" ON public.sticker_packs FOR DELETE TO authenticated
  USING (public.is_workspace_member(workspace_id, auth.uid()));

-- ============ stickers ============
CREATE TABLE public.stickers (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  pack_id uuid NOT NULL REFERENCES public.sticker_packs(id) ON DELETE CASCADE,
  sort_order integer NOT NULL CHECK (sort_order >= 0),
  label text NOT NULL,
  prompt text,
  action_description text,
  emoji_list text[] NOT NULL DEFAULT '{}'::text[],
  keyword_list text[] NOT NULL DEFAULT '{}'::text[],
  status text NOT NULL DEFAULT 'draft' CHECK (status IN ('draft','queued','generating','ready','failed','published')),
  image_asset_id uuid REFERENCES public.media_assets(id) ON DELETE SET NULL,
  telegram_file_id text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (pack_id, sort_order)
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.stickers TO authenticated;
GRANT ALL ON public.stickers TO service_role;
ALTER TABLE public.stickers ENABLE ROW LEVEL SECURITY;
CREATE INDEX idx_stickers_pack_status ON public.stickers(pack_id, status);
CREATE TRIGGER stickers_set_updated_at BEFORE UPDATE ON public.stickers FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

CREATE OR REPLACE FUNCTION public.can_access_pack(_pack_id uuid, _user_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.sticker_packs p
    JOIN public.workspace_members wm
      ON wm.workspace_id = p.workspace_id AND wm.user_id = _user_id
    WHERE p.id = _pack_id
  );
$$;

CREATE POLICY "stickers_select_member" ON public.stickers FOR SELECT TO authenticated
  USING (public.can_access_pack(pack_id, auth.uid()));
CREATE POLICY "stickers_insert_member" ON public.stickers FOR INSERT TO authenticated
  WITH CHECK (public.can_access_pack(pack_id, auth.uid()));
CREATE POLICY "stickers_update_member" ON public.stickers FOR UPDATE TO authenticated
  USING (public.can_access_pack(pack_id, auth.uid()))
  WITH CHECK (public.can_access_pack(pack_id, auth.uid()));
CREATE POLICY "stickers_delete_member" ON public.stickers FOR DELETE TO authenticated
  USING (public.can_access_pack(pack_id, auth.uid()));

-- ============ ai_jobs ============
CREATE TABLE public.ai_jobs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
  user_id uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
  pack_id uuid REFERENCES public.sticker_packs(id) ON DELETE SET NULL,
  sticker_id uuid REFERENCES public.stickers(id) ON DELETE SET NULL,
  job_type text NOT NULL,
  provider text,
  provider_model text,
  provider_task_id text,
  status text NOT NULL DEFAULT 'queued' CHECK (status IN ('queued','running','succeeded','failed','cancelled')),
  input_json jsonb NOT NULL DEFAULT '{}'::jsonb,
  output_json jsonb NOT NULL DEFAULT '{}'::jsonb,
  provider_cost numeric(12,6) CHECK (provider_cost IS NULL OR provider_cost >= 0),
  error_code text,
  error_message text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  completed_at timestamptz
);
GRANT SELECT ON public.ai_jobs TO authenticated;
GRANT ALL ON public.ai_jobs TO service_role;
ALTER TABLE public.ai_jobs ENABLE ROW LEVEL SECURITY;
CREATE INDEX idx_ai_jobs_workspace_status ON public.ai_jobs(workspace_id, status);
CREATE INDEX idx_ai_jobs_provider_task_id ON public.ai_jobs(provider_task_id) WHERE provider_task_id IS NOT NULL;
CREATE TRIGGER ai_jobs_set_updated_at BEFORE UPDATE ON public.ai_jobs FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();
CREATE POLICY "ai_jobs_select_member" ON public.ai_jobs FOR SELECT TO authenticated
  USING (public.is_workspace_member(workspace_id, auth.uid()));

-- ============ usage_ledger ============
CREATE TABLE public.usage_ledger (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
  user_id uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
  ai_job_id uuid REFERENCES public.ai_jobs(id) ON DELETE SET NULL,
  action_type text NOT NULL,
  units numeric(14,4) NOT NULL DEFAULT 1 CHECK (units >= 0),
  provider_cost numeric(12,6) CHECK (provider_cost IS NULL OR provider_cost >= 0),
  internal_cost numeric(12,6) CHECK (internal_cost IS NULL OR internal_cost >= 0),
  created_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT ON public.usage_ledger TO authenticated;
GRANT ALL ON public.usage_ledger TO service_role;
ALTER TABLE public.usage_ledger ENABLE ROW LEVEL SECURITY;
CREATE INDEX idx_usage_ledger_workspace_created ON public.usage_ledger(workspace_id, created_at);
CREATE POLICY "usage_ledger_select_member" ON public.usage_ledger FOR SELECT TO authenticated
  USING (public.is_workspace_member(workspace_id, auth.uid()));