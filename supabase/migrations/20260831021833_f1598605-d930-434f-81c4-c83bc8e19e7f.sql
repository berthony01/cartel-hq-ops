-- 1. Additive archive columns
ALTER TABLE public.sticker_packs
  ADD COLUMN IF NOT EXISTS archived_at timestamptz NULL,
  ADD COLUMN IF NOT EXISTS archived_by uuid NULL REFERENCES public.profiles(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS sticker_packs_active_idx
  ON public.sticker_packs (workspace_id, updated_at DESC)
  WHERE archived_at IS NULL;

-- 2. Remove raw client delete ability (server-enforced deletion only)
DROP POLICY IF EXISTS sticker_packs_delete_member ON public.sticker_packs;

-- 3. Archive invariant trigger: operator-only, safe state, atomic schedule pause
CREATE OR REPLACE FUNCTION public.enforce_sticker_pack_archive_rules()
RETURNS trigger
LANGUAGE plpgsql
SET search_path TO 'public'
AS $$
BEGIN
  IF new.archived_at IS NOT DISTINCT FROM old.archived_at THEN
    -- archived_by may not drift independently of archived_at
    IF new.archived_by IS DISTINCT FROM old.archived_by THEN
      new.archived_by := old.archived_by;
    END IF;
    RETURN new;
  END IF;

  IF auth.uid() IS NULL
     OR NOT public.is_workspace_operator(new.workspace_id, auth.uid()) THEN
    RAISE EXCEPTION 'Only project owners and admins can archive or restore a pack.'
      USING errcode = '42501';
  END IF;

  IF old.archived_at IS NULL AND new.archived_at IS NOT NULL THEN
    IF new.status IN ('generating', 'publishing') THEN
      RAISE EXCEPTION 'This pack is busy. Wait for generation or publishing to finish before archiving.'
        USING errcode = '22023';
    END IF;
    new.archived_at := now();
    new.archived_by := auth.uid();
  ELSE
    new.archived_at := NULL;
    new.archived_by := NULL;
  END IF;

  RETURN new;
END;
$$;

DROP TRIGGER IF EXISTS enforce_sticker_pack_archive_rules_trigger ON public.sticker_packs;
CREATE TRIGGER enforce_sticker_pack_archive_rules_trigger
  BEFORE UPDATE ON public.sticker_packs
  FOR EACH ROW EXECUTE FUNCTION public.enforce_sticker_pack_archive_rules();

CREATE OR REPLACE FUNCTION public.pause_sticker_drops_on_pack_archive()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
BEGIN
  IF old.archived_at IS NULL AND new.archived_at IS NOT NULL THEN
    UPDATE public.sticker_drop_schedules
    SET enabled = false,
        next_run_at = NULL,
        paused_reason = 'pack_archived',
        updated_at = now()
    WHERE pack_id = new.id
      AND (enabled = true OR next_run_at IS NOT NULL);
  END IF;
  RETURN new;
END;
$$;

DROP TRIGGER IF EXISTS pause_sticker_drops_on_pack_archive_trigger ON public.sticker_packs;
CREATE TRIGGER pause_sticker_drops_on_pack_archive_trigger
  AFTER UPDATE OF archived_at ON public.sticker_packs
  FOR EACH ROW EXECUTE FUNCTION public.pause_sticker_drops_on_pack_archive();

-- Archived packs may not have their Sticker Drops re-enabled until restored
CREATE OR REPLACE FUNCTION public.block_sticker_drops_for_archived_pack()
RETURNS trigger
LANGUAGE plpgsql
SET search_path TO 'public'
AS $$
BEGIN
  IF new.enabled = true
     AND EXISTS (
       SELECT 1 FROM public.sticker_packs p
       WHERE p.id = new.pack_id AND p.archived_at IS NOT NULL
     ) THEN
    RAISE EXCEPTION 'This pack is archived. Restore the pack before enabling Sticker Drops.'
      USING errcode = '22023';
  END IF;
  RETURN new;
END;
$$;

DROP TRIGGER IF EXISTS block_sticker_drops_for_archived_pack_trigger ON public.sticker_drop_schedules;
CREATE TRIGGER block_sticker_drops_for_archived_pack_trigger
  BEFORE INSERT OR UPDATE ON public.sticker_drop_schedules
  FOR EACH ROW EXECUTE FUNCTION public.block_sticker_drops_for_archived_pack();

-- 4. Lifecycle RPCs
CREATE OR REPLACE FUNCTION public.archive_sticker_pack(_pack_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  pack_row public.sticker_packs;
BEGIN
  SELECT * INTO pack_row FROM public.sticker_packs WHERE id = _pack_id FOR UPDATE;
  IF pack_row.id IS NULL THEN
    RAISE EXCEPTION 'Pack not found.' USING errcode = 'P0002';
  END IF;
  IF NOT public.is_workspace_operator(pack_row.workspace_id, auth.uid()) THEN
    RAISE EXCEPTION 'Only project owners and admins can archive a pack.' USING errcode = '42501';
  END IF;
  IF pack_row.archived_at IS NOT NULL THEN
    RETURN jsonb_build_object('archived', true, 'already', true);
  END IF;

  UPDATE public.sticker_packs SET archived_at = now() WHERE id = _pack_id;

  RETURN jsonb_build_object(
    'archived', true,
    'already', false,
    'schedules_paused', (
      SELECT count(*) FROM public.sticker_drop_schedules
      WHERE pack_id = _pack_id AND paused_reason = 'pack_archived'
    )
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.restore_sticker_pack(_pack_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  pack_row public.sticker_packs;
BEGIN
  SELECT * INTO pack_row FROM public.sticker_packs WHERE id = _pack_id FOR UPDATE;
  IF pack_row.id IS NULL THEN
    RAISE EXCEPTION 'Pack not found.' USING errcode = 'P0002';
  END IF;
  IF NOT public.is_workspace_operator(pack_row.workspace_id, auth.uid()) THEN
    RAISE EXCEPTION 'Only project owners and admins can restore a pack.' USING errcode = '42501';
  END IF;
  IF pack_row.archived_at IS NULL THEN
    RETURN jsonb_build_object('restored', true, 'already', true);
  END IF;

  UPDATE public.sticker_packs SET archived_at = NULL WHERE id = _pack_id;

  RETURN jsonb_build_object(
    'restored', true,
    'already', false,
    'schedules_still_paused', (
      SELECT count(*) FROM public.sticker_drop_schedules
      WHERE pack_id = _pack_id AND paused_reason = 'pack_archived'
    )
  );
END;
$$;

-- Shared eligibility evaluation, used by both inspect and delete.
CREATE OR REPLACE FUNCTION public.sticker_pack_lifecycle_state(_pack_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  pack_row public.sticker_packs;
  can_manage boolean;
  reasons text[] := ARRAY[]::text[];
BEGIN
  SELECT * INTO pack_row FROM public.sticker_packs WHERE id = _pack_id;
  IF pack_row.id IS NULL THEN
    RAISE EXCEPTION 'Pack not found.' USING errcode = 'P0002';
  END IF;
  IF NOT public.is_workspace_member(pack_row.workspace_id, auth.uid()) THEN
    RAISE EXCEPTION 'You do not have access to this pack.' USING errcode = '42501';
  END IF;

  can_manage := public.is_workspace_operator(pack_row.workspace_id, auth.uid());

  IF pack_row.telegram_set_name IS NOT NULL
     OR pack_row.telegram_set_url IS NOT NULL
     OR pack_row.telegram_published_at IS NOT NULL THEN
    reasons := reasons || 'telegram_published';
  END IF;
  IF pack_row.status IN ('published', 'publishing', 'generating') THEN
    reasons := reasons || 'pack_status_' || pack_row.status;
  END IF;
  IF EXISTS (SELECT 1 FROM public.stickers s WHERE s.pack_id = _pack_id AND s.telegram_file_id IS NOT NULL) THEN
    reasons := reasons || 'telegram_stickers_exist';
  END IF;
  IF EXISTS (SELECT 1 FROM public.sticker_pack_group_targets t WHERE t.pack_id = _pack_id) THEN
    reasons := reasons || 'community_delivery_history';
  END IF;
  IF EXISTS (SELECT 1 FROM public.sticker_drop_schedules d WHERE d.pack_id = _pack_id) THEN
    reasons := reasons || 'sticker_drop_schedules';
  END IF;
  IF EXISTS (SELECT 1 FROM public.sticker_drop_events e WHERE e.pack_id = _pack_id) THEN
    reasons := reasons || 'sticker_drop_history';
  END IF;
  IF EXISTS (
    SELECT 1 FROM public.ai_jobs j
    WHERE j.pack_id = _pack_id AND j.status IN ('queued', 'running', 'processing', 'pending')
  ) THEN
    reasons := reasons || 'active_ai_jobs';
  END IF;

  RETURN jsonb_build_object(
    'pack_id', pack_row.id,
    'title', pack_row.title,
    'status', pack_row.status,
    'archived', pack_row.archived_at IS NOT NULL,
    'archived_at', pack_row.archived_at,
    'can_manage', can_manage,
    'blocking_reasons', to_jsonb(reasons),
    'can_delete', can_manage AND pack_row.archived_at IS NULL AND cardinality(reasons) = 0,
    'can_archive', can_manage AND pack_row.archived_at IS NULL
                   AND pack_row.status NOT IN ('generating', 'publishing'),
    'can_restore', can_manage AND pack_row.archived_at IS NOT NULL
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.delete_sticker_pack_if_eligible(_pack_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  pack_row public.sticker_packs;
  state jsonb;
  asset_ids uuid[];
  paths text[];
BEGIN
  SELECT * INTO pack_row FROM public.sticker_packs WHERE id = _pack_id FOR UPDATE;
  IF pack_row.id IS NULL THEN
    RAISE EXCEPTION 'Pack not found.' USING errcode = 'P0002';
  END IF;

  state := public.sticker_pack_lifecycle_state(_pack_id);

  IF NOT (state ->> 'can_manage')::boolean THEN
    RAISE EXCEPTION 'Only project owners and admins can delete a pack.' USING errcode = '42501';
  END IF;

  IF NOT (state ->> 'can_delete')::boolean THEN
    RETURN jsonb_build_object(
      'deleted', false,
      'archive_required', true,
      'blocking_reasons', state -> 'blocking_reasons'
    );
  END IF;

  -- Only generated sticker images owned exclusively by this pack.
  SELECT coalesce(array_agg(DISTINCT m.id), ARRAY[]::uuid[]),
         coalesce(array_agg(DISTINCT m.storage_path), ARRAY[]::text[])
    INTO asset_ids, paths
  FROM public.media_assets m
  JOIN public.stickers s ON s.image_asset_id = m.id
  WHERE s.pack_id = _pack_id
    AND m.workspace_id = pack_row.workspace_id
    AND m.asset_type = 'generated_sticker'
    AND NOT EXISTS (
      SELECT 1 FROM public.stickers s2
      WHERE s2.image_asset_id = m.id AND s2.pack_id <> _pack_id
    )
    AND NOT EXISTS (
      SELECT 1 FROM public.sticker_packs p2 WHERE p2.reference_asset_id = m.id
    )
    AND NOT EXISTS (
      SELECT 1 FROM public.project_profiles pp WHERE pp.logo_asset_id = m.id
    );

  DELETE FROM public.sticker_packs WHERE id = _pack_id;

  IF cardinality(asset_ids) > 0 THEN
    DELETE FROM public.media_assets m
    WHERE m.id = ANY(asset_ids)
      AND NOT EXISTS (SELECT 1 FROM public.stickers s WHERE s.image_asset_id = m.id)
      AND NOT EXISTS (SELECT 1 FROM public.sticker_packs p WHERE p.reference_asset_id = m.id)
      AND NOT EXISTS (SELECT 1 FROM public.project_profiles pp WHERE pp.logo_asset_id = m.id);
  END IF;

  RETURN jsonb_build_object(
    'deleted', true,
    'archive_required', false,
    'storage_paths', to_jsonb(paths)
  );
END;
$$;

GRANT EXECUTE ON FUNCTION public.archive_sticker_pack(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.restore_sticker_pack(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.sticker_pack_lifecycle_state(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.delete_sticker_pack_if_eligible(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.archive_sticker_pack(uuid) TO service_role;
GRANT EXECUTE ON FUNCTION public.restore_sticker_pack(uuid) TO service_role;
GRANT EXECUTE ON FUNCTION public.sticker_pack_lifecycle_state(uuid) TO service_role;
GRANT EXECUTE ON FUNCTION public.delete_sticker_pack_if_eligible(uuid) TO service_role;