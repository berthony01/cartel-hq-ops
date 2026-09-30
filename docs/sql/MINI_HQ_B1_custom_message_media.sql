-- MINI-HQ B1 — prepared custom message media selection (STAGED, NOT APPLIED).
-- Revision 2 (B1 review correction): positive-only IS TRUE predicates, live
-- commercial RPC schema, exact generated asset path/extension checks.
--
-- Adds TWO service-only helpers. No table, column, RLS, user grant, trigger
-- or constraint change. Stores the selection atomically in the existing
-- brand_kits.metadata under key 'custom_message_media' without touching any
-- other metadata key. No sender reads this yet (sending integration pending).
--
-- Rollback:
--   DROP FUNCTION IF EXISTS public.set_workspace_custom_message_media(uuid, uuid, text, uuid);
--   DROP FUNCTION IF EXISTS public.custom_media_gate_ok(jsonb);
--   -- optional data cleanup (only this key):
--   -- UPDATE public.brand_kits SET metadata = metadata - 'custom_message_media'
--   --  WHERE metadata ? 'custom_message_media';

-- Mirrors customMediaEntitled() in src/lib/custom-message-media.ts EXACTLY.
-- Every comparison is combined with AND and wrapped in COALESCE(..., false)
-- so a NULL/missing/mistyped field can never yield TRUE.
CREATE OR REPLACE FUNCTION public.custom_media_gate_ok(_g jsonb)
RETURNS boolean
LANGUAGE sql
IMMUTABLE
SET search_path TO ''
AS $$
  SELECT COALESCE(
    _g IS NOT NULL
    AND jsonb_typeof(_g) = 'object'
    AND jsonb_typeof(_g->'allowed') = 'boolean' AND (_g->>'allowed')::boolean IS TRUE
    AND (
      ( (_g->>'reason') = 'UNRESTRICTED' AND (_g->>'mode') = 'unrestricted' )
      OR (
        jsonb_typeof(_g->'would_block') = 'boolean' AND (_g->>'would_block')::boolean IS FALSE
        AND (_g->>'reason') = 'FEATURE_INCLUDED'
        AND (_g->>'feature_key') = 'official_broadcasts'
        AND (_g->>'plan_code') = 'cartel_49'
        AND (_g->>'kind') = 'feature'
        AND jsonb_typeof(_g->'enabled') = 'boolean' AND (_g->>'enabled')::boolean IS TRUE
        AND (_g->>'assignment_status') IN ('active', 'trialing')
        AND (_g->>'mode') IN ('enforce', 'observe')
        AND (_g->>'enforcement_mode') = (_g->>'mode')
      )
    ),
  false);
$$;

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
  v_ext text;
  v_authorized boolean;
  v_asset_ok boolean;
BEGIN
  IF _workspace_id IS NULL OR _actor_user_id IS NULL OR _slot IS NULL
     OR _slot NOT IN ('mission', 'broadcast') THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'INVALID_INPUT');
  END IF;

  v_authorized := COALESCE(public.has_platform_unrestricted_access(_actor_user_id), false) IS TRUE
               OR COALESCE(public.is_workspace_operator(_workspace_id, _actor_user_id), false) IS TRUE;
  IF v_authorized IS NOT TRUE THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'FORBIDDEN');
  END IF;

  IF _asset_id IS NULL THEN
    v_entry := NULL; -- clearing a selection is always allowed for operators
  ELSE
    -- Pro gate (defense in depth; the bridge also checks). Positive-only.
    v_gate := public.evaluate_commercial_access(_workspace_id, 'official_broadcasts', _actor_user_id);
    IF public.custom_media_gate_ok(v_gate) IS NOT TRUE THEN
      RETURN jsonb_build_object('ok', false, 'reason', 'PRO_REQUIRED');
    END IF;

    SELECT id, workspace_id, asset_type, mime_type, file_size_bytes, storage_path, width, height, metadata
      INTO v_asset
      FROM public.media_assets
     WHERE id = _asset_id
       AND workspace_id = _workspace_id;
    IF NOT FOUND THEN
      RETURN jsonb_build_object('ok', false, 'reason', 'ASSET_NOT_FOUND');
    END IF;

    v_ext := CASE v_asset.mime_type
               WHEN 'image/png' THEN 'png'
               WHEN 'image/jpeg' THEN 'jpg'
               WHEN 'image/gif' THEN 'gif'
             END;

    v_asset_ok := COALESCE(
          v_ext IS NOT NULL
      AND v_asset.id = _asset_id
      AND v_asset.workspace_id = _workspace_id
      AND v_asset.asset_type = 'other'
      AND jsonb_typeof(v_asset.metadata) = 'object'
      AND (v_asset.metadata->>'purpose') = 'custom_message_media'
      AND v_asset.file_size_bytes > 0 AND v_asset.file_size_bytes <= 2097152
      AND v_asset.width > 0 AND v_asset.width <= 4096
      AND v_asset.height > 0 AND v_asset.height <= 4096
      AND v_asset.storage_path = (_workspace_id::text || '/custom-message-media/' || _asset_id::text || '.' || v_ext),
      false);
    IF v_asset_ok IS NOT TRUE THEN
      RETURN jsonb_build_object('ok', false, 'reason', 'ASSET_NOT_FOUND');
    END IF;

    v_entry := jsonb_build_object(
      'asset_id', v_asset.id,
      'mime_type', v_asset.mime_type,
      'animated', (v_asset.metadata->'animated') = 'true'::jsonb,
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

ALTER FUNCTION public.custom_media_gate_ok(jsonb) OWNER TO postgres;
REVOKE ALL ON FUNCTION public.custom_media_gate_ok(jsonb) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.custom_media_gate_ok(jsonb) TO service_role;

ALTER FUNCTION public.set_workspace_custom_message_media(uuid, uuid, text, uuid) OWNER TO postgres;
REVOKE ALL ON FUNCTION public.set_workspace_custom_message_media(uuid, uuid, text, uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.set_workspace_custom_message_media(uuid, uuid, text, uuid) TO service_role;
