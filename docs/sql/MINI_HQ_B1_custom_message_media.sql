-- MINI-HQ B1 — prepared custom message media selection (STAGED, NOT APPLIED).
-- Adds ONE service-only helper. No table, column, RLS, grant-to-user, trigger
-- or constraint change. Stores the selection atomically in the existing
-- brand_kits.metadata under key 'custom_message_media' without touching any
-- other metadata key. No sender reads this yet (sending integration pending).
--
-- Rollback:
--   DROP FUNCTION IF EXISTS public.set_workspace_custom_message_media(uuid, uuid, text, uuid);
--   -- optional data cleanup (only this key):
--   -- UPDATE public.brand_kits SET metadata = metadata - 'custom_message_media'
--   --  WHERE metadata ? 'custom_message_media';

CREATE OR REPLACE FUNCTION public.set_workspace_custom_message_media(
  _workspace_id uuid,
  _actor_user_id uuid,
  _slot text,
  _asset_id uuid
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO ''
AS $$
DECLARE
  v_asset record;
  v_gate jsonb;
  v_entry jsonb;
  v_meta jsonb;
BEGIN
  IF _workspace_id IS NULL OR _actor_user_id IS NULL OR _slot IS NULL
     OR _slot NOT IN ('mission', 'broadcast') THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'INVALID_INPUT');
  END IF;

  IF NOT (public.has_platform_unrestricted_access(_actor_user_id)
          OR public.is_workspace_operator(_workspace_id, _actor_user_id)) THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'FORBIDDEN');
  END IF;

  IF _asset_id IS NULL THEN
    v_entry := NULL; -- clearing a selection is always allowed for operators
  ELSE
    -- Pro gate (defense in depth; the bridge also checks). Fail closed.
    v_gate := public.evaluate_commercial_access(_workspace_id, 'official_broadcasts', _actor_user_id);
    IF v_gate IS NULL OR (v_gate->>'allowed') IS DISTINCT FROM 'true' OR NOT (
         ((v_gate->>'reason') = 'UNRESTRICTED' AND (v_gate->>'mode') = 'unrestricted')
         OR ((v_gate->>'would_block') IS DISTINCT FROM 'true' AND (v_gate->>'plan_code') = 'cartel_49')
       ) THEN
      RETURN jsonb_build_object('ok', false, 'reason', 'PRO_REQUIRED');
    END IF;

    SELECT id, mime_type, file_size_bytes, storage_path, width, height, metadata
      INTO v_asset
      FROM public.media_assets
     WHERE id = _asset_id
       AND workspace_id = _workspace_id
       AND asset_type = 'other'
       AND metadata->>'purpose' = 'custom_message_media';
    IF NOT FOUND
       OR v_asset.mime_type NOT IN ('image/png', 'image/jpeg', 'image/gif')
       OR v_asset.file_size_bytes IS NULL OR v_asset.file_size_bytes <= 0
       OR v_asset.file_size_bytes > 2097152
       OR v_asset.storage_path NOT LIKE (_workspace_id::text || '/custom-message-media/%') THEN
      RETURN jsonb_build_object('ok', false, 'reason', 'ASSET_NOT_FOUND');
    END IF;

    v_entry := jsonb_build_object(
      'asset_id', v_asset.id,
      'mime_type', v_asset.mime_type,
      'animated', COALESCE((v_asset.metadata->>'animated')::boolean, false),
      'selected_by', _actor_user_id,
      'selected_at', now()
    );
  END IF;

  UPDATE public.brand_kits
     SET metadata = jsonb_set(
           COALESCE(metadata, '{}'::jsonb),
           '{custom_message_media}',
           CASE WHEN v_entry IS NULL
                THEN COALESCE(metadata->'custom_message_media', '{}'::jsonb) - _slot
                ELSE COALESCE(metadata->'custom_message_media', '{}'::jsonb) || jsonb_build_object(_slot, v_entry)
           END,
           true),
         updated_at = now()
   WHERE workspace_id = _workspace_id
  RETURNING metadata INTO v_meta;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'BRAND_KIT_REQUIRED');
  END IF;

  RETURN jsonb_build_object('ok', true, 'selection', COALESCE(v_meta->'custom_message_media', '{}'::jsonb));
END;
$$;

ALTER FUNCTION public.set_workspace_custom_message_media(uuid, uuid, text, uuid) OWNER TO postgres;
REVOKE ALL ON FUNCTION public.set_workspace_custom_message_media(uuid, uuid, text, uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.set_workspace_custom_message_media(uuid, uuid, text, uuid) TO service_role;
