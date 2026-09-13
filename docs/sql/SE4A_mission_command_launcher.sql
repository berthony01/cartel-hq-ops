-- SE-4A — Telegram `/mission <X link>` zero-X-read mission launcher
-- PREPARE ONLY. Lovable does NOT apply this migration.
-- Apply externally through the authoritative Supabase connector
-- (project ocoinbnjgstkmnwwvnhi) after diff review.
--
-- Scope: exactly one service-role-only SECURITY DEFINER RPC.
-- Creates NO table, NO column, NO policy change, NO grant change on any table.
--
-- Model: the command supplies ONLY an already-canonicalised public X status
-- URL. No X API read happens anywhere in this path, so the created post row
-- carries the URL-derived identifiers and NOTHING invented: content_text,
-- author_display_name, published_at and every baseline metric stay NULL.
--
-- Authorization is re-established INSIDE the function and never trusted from
-- the caller: telegram_connections -> app user, current workspace owner/admin,
-- exact telegram_group_connections binding, and an independent server-side
-- re-check that the handle in the link is the workspace's official
-- project_profiles.x_url account.
--
-- Idempotency: telegram_inbound_updates.telegram_update_id is the atomic
-- command claim. The raw Telegram payload is never stored.

BEGIN;

CREATE OR REPLACE FUNCTION public.create_social_mission_from_telegram_link(
  _telegram_update_id bigint,
  _telegram_chat_id bigint,
  _telegram_message_id bigint,
  _telegram_user_id bigint,
  _canonical_url text,
  _external_post_id text,
  _author_handle text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_claimed boolean := false;
  v_workspace_id uuid;
  v_connection_id uuid;
  v_actor_user_id uuid;
  v_official_handle text;
  v_x_url text;
  v_post_id uuid;
  v_mission_id uuid;
  v_target_id uuid;
  v_delivery_state text;
  v_existing_update_chat bigint;
  v_existing_update_user bigint;
  v_handle text := lower(btrim(coalesce(_author_handle, '')));
  v_url text := btrim(coalesce(_canonical_url, ''));
  v_post_external text := btrim(coalesce(_external_post_id, ''));
BEGIN
  -- 1. Structural validation. Nothing here touches the network.
  IF _telegram_update_id IS NULL OR _telegram_chat_id IS NULL
     OR _telegram_message_id IS NULL OR _telegram_user_id IS NULL THEN
    RETURN jsonb_build_object('outcome', 'REJECTED', 'reason', 'invalid_telegram_identifiers');
  END IF;

  IF v_post_external !~ '^[0-9]{1,32}$' THEN
    RETURN jsonb_build_object('outcome', 'REJECTED', 'reason', 'invalid_post_id');
  END IF;

  IF v_handle !~ '^[a-z0-9_]{1,15}$' THEN
    RETURN jsonb_build_object('outcome', 'REJECTED', 'reason', 'invalid_handle');
  END IF;

  IF v_url <> ('https://x.com/' || v_handle || '/status/' || v_post_external)
     OR char_length(v_url) > 2048 THEN
    RETURN jsonb_build_object('outcome', 'REJECTED', 'reason', 'invalid_canonical_url');
  END IF;

  -- 2. Atomic command-idempotency claim on the Telegram update id.
  --    Raw payload is never stored: identifiers only.
  INSERT INTO public.telegram_inbound_updates (
    telegram_update_id, update_kind, telegram_chat_id, telegram_message_id, telegram_user_id, status
  )
  VALUES (
    _telegram_update_id, 'MESSAGE', _telegram_chat_id, _telegram_message_id, _telegram_user_id, 'RECEIVED'
  )
  ON CONFLICT (telegram_update_id) DO NOTHING;

  GET DIAGNOSTICS v_claimed = ROW_COUNT;

  IF NOT v_claimed THEN
    -- Duplicate delivery of the SAME Telegram update. Return the already
    -- created mission only when provenance matches exactly; otherwise this is
    -- an unrelated/unresolved replay and nothing new is created.
    SELECT tiu.telegram_chat_id, tiu.telegram_user_id
      INTO v_existing_update_chat, v_existing_update_user
      FROM public.telegram_inbound_updates tiu
     WHERE tiu.telegram_update_id = _telegram_update_id;

    IF v_existing_update_chat IS DISTINCT FROM _telegram_chat_id
       OR v_existing_update_user IS DISTINCT FROM _telegram_user_id THEN
      RETURN jsonb_build_object('outcome', 'DUPLICATE_UPDATE', 'reason', 'provenance_mismatch');
    END IF;

    SELECT m.id, t.id, t.delivery_state, m.workspace_id
      INTO v_mission_id, v_target_id, v_delivery_state, v_workspace_id
      FROM public.social_missions m
      JOIN public.social_mission_targets t
        ON t.mission_id = m.id AND t.workspace_id = m.workspace_id
     WHERE t.telegram_chat_id = _telegram_chat_id
       AND m.metadata ->> 'source' = 'telegram_mission_command'
       AND m.metadata ->> 'telegram_update_id' = _telegram_update_id::text
     LIMIT 1;

    IF v_mission_id IS NULL THEN
      RETURN jsonb_build_object('outcome', 'DUPLICATE_UPDATE', 'reason', 'already_claimed');
    END IF;

    RETURN jsonb_build_object(
      'outcome', 'EXISTING',
      'reason', 'duplicate_update',
      'workspace_id', v_workspace_id,
      'mission_id', v_mission_id,
      'target_id', v_target_id,
      'delivery_state', v_delivery_state
    );
  END IF;

  -- 3. Exact Telegram group binding -> one workspace.
  SELECT gc.id, gc.workspace_id
    INTO v_connection_id, v_workspace_id
    FROM public.telegram_group_connections gc
   WHERE gc.telegram_chat_id = _telegram_chat_id
   LIMIT 1;

  IF v_connection_id IS NULL THEN
    UPDATE public.telegram_inbound_updates
       SET status = 'IGNORED', processed_at = now(), updated_at = now()
     WHERE telegram_update_id = _telegram_update_id;
    RETURN jsonb_build_object('outcome', 'REJECTED', 'reason', 'group_not_connected');
  END IF;

  -- 4. Linked application user.
  SELECT tc.user_id INTO v_actor_user_id
    FROM public.telegram_connections tc
   WHERE tc.telegram_user_id = _telegram_user_id
   LIMIT 1;

  IF v_actor_user_id IS NULL THEN
    UPDATE public.telegram_inbound_updates
       SET status = 'IGNORED', processed_at = now(), updated_at = now()
     WHERE telegram_update_id = _telegram_update_id;
    RETURN jsonb_build_object('outcome', 'REJECTED', 'reason', 'actor_not_linked');
  END IF;

  -- 5. Re-authorize CURRENT workspace owner/admin inside the RPC.
  IF NOT public.is_workspace_operator(v_workspace_id, v_actor_user_id) THEN
    UPDATE public.telegram_inbound_updates
       SET status = 'IGNORED', processed_at = now(), updated_at = now()
     WHERE telegram_update_id = _telegram_update_id;
    RETURN jsonb_build_object('outcome', 'REJECTED', 'reason', 'actor_not_operator');
  END IF;

  -- 6. Independent server-side official-handle verification.
  SELECT pp.x_url INTO v_x_url
    FROM public.project_profiles pp
   WHERE pp.workspace_id = v_workspace_id
   LIMIT 1;

  v_official_handle := lower(
    (regexp_match(
      coalesce(v_x_url, ''),
      '^https?://(?:www\.|mobile\.)?(?:x|twitter)\.com/@?([A-Za-z0-9_]{1,15})(?:[/?#].*)?$'
    ))[1]
  );

  IF v_official_handle IS NULL THEN
    UPDATE public.telegram_inbound_updates
       SET status = 'IGNORED', processed_at = now(), updated_at = now()
     WHERE telegram_update_id = _telegram_update_id;
    RETURN jsonb_build_object('outcome', 'REJECTED', 'reason', 'official_x_account_missing');
  END IF;

  IF v_official_handle <> v_handle THEN
    UPDATE public.telegram_inbound_updates
       SET status = 'IGNORED', processed_at = now(), updated_at = now()
     WHERE telegram_update_id = _telegram_update_id;
    RETURN jsonb_build_object('outcome', 'REJECTED', 'reason', 'handle_not_official');
  END IF;

  -- 7. Get-or-create the social post. An existing row is PRESERVED as-is: a
  --    richer post captured by another path must never be downgraded by this
  --    zero-read command.
  INSERT INTO public.social_posts (
    workspace_id, platform, external_post_id, canonical_url, author_handle, content_text, metadata
  )
  VALUES (
    v_workspace_id, 'x', v_post_external, v_url, v_handle, NULL,
    jsonb_build_object(
      'source', 'telegram_mission_command',
      'x_api_reads_at_start', 0
    )
  )
  ON CONFLICT (workspace_id, platform, external_post_id) DO NOTHING;

  SELECT sp.id INTO v_post_id
    FROM public.social_posts sp
   WHERE sp.workspace_id = v_workspace_id
     AND sp.platform = 'x'
     AND sp.external_post_id = v_post_external;

  IF v_post_id IS NULL THEN
    UPDATE public.telegram_inbound_updates
       SET status = 'FAILED', last_error = 'social post unresolved', updated_at = now()
     WHERE telegram_update_id = _telegram_update_id;
    RETURN jsonb_build_object('outcome', 'UNRESOLVED', 'reason', 'post_unresolved');
  END IF;

  -- 8. One post + one community = one mission in V1. Never duplicate.
  SELECT m.id, t.id, t.delivery_state
    INTO v_mission_id, v_target_id, v_delivery_state
    FROM public.social_missions m
    JOIN public.social_mission_targets t
      ON t.mission_id = m.id AND t.workspace_id = m.workspace_id
   WHERE m.workspace_id = v_workspace_id
     AND m.social_post_id = v_post_id
     AND t.telegram_chat_id = _telegram_chat_id
   ORDER BY m.created_at DESC
   LIMIT 1;

  IF v_mission_id IS NOT NULL THEN
    UPDATE public.telegram_inbound_updates
       SET status = 'PROCESSED', processed_at = now(), updated_at = now()
     WHERE telegram_update_id = _telegram_update_id;
    RETURN jsonb_build_object(
      'outcome', 'EXISTING',
      'reason', 'mission_already_exists',
      'actor_user_id', v_actor_user_id,
      'workspace_id', v_workspace_id,
      'mission_id', v_mission_id,
      'target_id', v_target_id,
      'delivery_state', v_delivery_state
    );
  END IF;

  -- 9. Create exactly one LIVE mission and one PENDING target.
  --    Baseline metrics stay NULL: no X read happened.
  INSERT INTO public.social_missions (
    workspace_id, social_post_id, status, started_at, created_by, metadata
  )
  VALUES (
    v_workspace_id, v_post_id, 'LIVE', now(), v_actor_user_id,
    jsonb_build_object(
      'source', 'telegram_mission_command',
      'telegram_update_id', _telegram_update_id,
      'telegram_chat_id', _telegram_chat_id,
      'telegram_message_id', _telegram_message_id,
      'telegram_user_id', _telegram_user_id,
      'x_api_reads_at_start', 0
    )
  )
  RETURNING id INTO v_mission_id;

  INSERT INTO public.social_mission_targets (
    workspace_id, mission_id, group_connection_id, telegram_chat_id, delivery_state
  )
  VALUES (
    v_workspace_id, v_mission_id, v_connection_id, _telegram_chat_id, 'PENDING'
  )
  RETURNING id, delivery_state INTO v_target_id, v_delivery_state;

  UPDATE public.telegram_inbound_updates
     SET status = 'PROCESSED', processed_at = now(), updated_at = now()
   WHERE telegram_update_id = _telegram_update_id;

  RETURN jsonb_build_object(
    'outcome', 'CREATED',
    'reason', 'created',
    'actor_user_id', v_actor_user_id,
    'workspace_id', v_workspace_id,
    'mission_id', v_mission_id,
    'target_id', v_target_id,
    'delivery_state', v_delivery_state
  );
END;
$$;

-- Service-role-only ACL. The browser can never reach this launcher.
REVOKE ALL ON FUNCTION public.create_social_mission_from_telegram_link(
  bigint, bigint, bigint, bigint, text, text, text
) FROM PUBLIC, anon, authenticated;

GRANT EXECUTE ON FUNCTION public.create_social_mission_from_telegram_link(
  bigint, bigint, bigint, bigint, text, text, text
) TO service_role;

GRANT EXECUTE ON FUNCTION public.create_social_mission_from_telegram_link(
  bigint, bigint, bigint, bigint, text, text, text
) TO postgres;

COMMIT;
