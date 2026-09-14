-- SE-7 — X Link Finder reliability: real source message id, non-terminal
-- START, and post-success finalization.
--
-- Re-runnable. Creates no new table. Adds exactly one nullable column and
-- replaces three functions.

BEGIN;

-- ---------------------------------------------------------------------------
-- 1. Which mission a candidate actually produced. NULL until the mission
--    genuinely reached a delivered card, which makes the finalizer idempotent.
-- ---------------------------------------------------------------------------
ALTER TABLE public.social_mission_link_candidates
  ADD COLUMN IF NOT EXISTS mission_id uuid REFERENCES public.social_missions(id) ON DELETE SET NULL;

-- ---------------------------------------------------------------------------
-- 2. resolve_social_mission_link_candidate — START authorizes WITHOUT
--    consuming; IGNORE still consumes.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.resolve_social_mission_link_candidate(
  _candidate_id uuid,
  _telegram_user_id bigint,
  _decision text,
  _verified_chat_id bigint
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_candidate public.social_mission_link_candidates%ROWTYPE;
  v_actor_user_id uuid;
  v_decision text := upper(btrim(coalesce(_decision, '')));
BEGIN
  IF _candidate_id IS NULL OR _telegram_user_id IS NULL OR _verified_chat_id IS NULL
     OR v_decision NOT IN ('START', 'IGNORE') THEN
    RETURN jsonb_build_object('outcome', 'REJECTED', 'reason', 'invalid_arguments');
  END IF;

  SELECT * INTO v_candidate
    FROM public.social_mission_link_candidates
   WHERE id = _candidate_id
   FOR UPDATE;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('outcome', 'REJECTED', 'reason', 'candidate_not_found');
  END IF;

  -- The live admin check must have been performed in THIS candidate's chat.
  IF v_candidate.telegram_chat_id <> _verified_chat_id THEN
    RETURN jsonb_build_object('outcome', 'REJECTED', 'reason', 'chat_mismatch');
  END IF;

  IF v_candidate.state <> 'PENDING' THEN
    RETURN jsonb_build_object('outcome', 'ALREADY_RESOLVED', 'state', v_candidate.state);
  END IF;

  IF v_candidate.expires_at <= now() THEN
    UPDATE public.social_mission_link_candidates
       SET state = 'EXPIRED', resolved_at = now()
     WHERE id = _candidate_id AND state = 'PENDING';
    RETURN jsonb_build_object('outcome', 'EXPIRED');
  END IF;

  SELECT tc.user_id INTO v_actor_user_id
    FROM public.telegram_connections tc
   WHERE tc.telegram_user_id = _telegram_user_id
   LIMIT 1;
  IF v_actor_user_id IS NULL THEN
    RETURN jsonb_build_object('outcome', 'REJECTED', 'reason', 'actor_not_linked');
  END IF;

  IF NOT public.is_workspace_operator(v_candidate.workspace_id, v_actor_user_id) THEN
    RETURN jsonb_build_object('outcome', 'REJECTED', 'reason', 'actor_not_operator');
  END IF;

  -- IGNORE is terminal immediately: the suggestion is declined and only the
  -- transient prompt is removed by the caller. The member's X post is kept.
  IF v_decision = 'IGNORE' THEN
    UPDATE public.social_mission_link_candidates
       SET state = 'IGNORED',
           resolved_at = now(),
           resolved_by = v_actor_user_id
     WHERE id = _candidate_id AND state = 'PENDING';
  END IF;
  -- START deliberately writes NOTHING. The candidate stays PENDING until
  -- finalize_social_mission_link_candidate_start confirms a delivered mission.

  RETURN jsonb_build_object(
    'outcome', v_decision,
    'candidate_id', _candidate_id,
    'workspace_id', v_candidate.workspace_id,
    'actor_user_id', v_actor_user_id,
    'telegram_chat_id', v_candidate.telegram_chat_id,
    'telegram_message_id', v_candidate.telegram_message_id,
    'prompt_message_id', v_candidate.prompt_message_id,
    'canonical_url', v_candidate.canonical_url,
    'external_post_id', v_candidate.external_post_id,
    'author_handle', v_candidate.author_handle
  );
END;
$$;

REVOKE ALL ON FUNCTION public.resolve_social_mission_link_candidate(uuid, bigint, text, bigint)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.resolve_social_mission_link_candidate(uuid, bigint, text, bigint) TO service_role;
GRANT EXECUTE ON FUNCTION public.resolve_social_mission_link_candidate(uuid, bigint, text, bigint) TO postgres;

-- ---------------------------------------------------------------------------
-- 3. finalize_social_mission_link_candidate_start — the ONLY path that makes a
--    candidate terminal STARTED.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.finalize_social_mission_link_candidate_start(
  _candidate_id uuid,
  _telegram_user_id bigint,
  _verified_chat_id bigint,
  _mission_id uuid
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_candidate public.social_mission_link_candidates%ROWTYPE;
  v_actor_user_id uuid;
  v_mission_workspace uuid;
  v_target_chat bigint;
  v_target_id uuid;
  v_delivery_state text;
  v_ends_at timestamptz;
  v_schedule_active boolean;

BEGIN
  IF _candidate_id IS NULL OR _telegram_user_id IS NULL
     OR _verified_chat_id IS NULL OR _mission_id IS NULL THEN
    RETURN jsonb_build_object('outcome', 'REJECTED', 'reason', 'invalid_arguments');
  END IF;

  SELECT * INTO v_candidate
    FROM public.social_mission_link_candidates
   WHERE id = _candidate_id
   FOR UPDATE;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('outcome', 'REJECTED', 'reason', 'candidate_not_found');
  END IF;

  IF v_candidate.telegram_chat_id <> _verified_chat_id THEN
    RETURN jsonb_build_object('outcome', 'REJECTED', 'reason', 'chat_mismatch');
  END IF;

  -- ALREADY_FINALIZED is reported ONLY for the very mission this candidate is
  -- already bound to.
  IF v_candidate.state = 'STARTED' THEN
    IF v_candidate.mission_id IS DISTINCT FROM _mission_id THEN
      RETURN jsonb_build_object('outcome', 'REJECTED', 'reason', 'mission_mismatch');
    END IF;
    RETURN jsonb_build_object(
      'outcome', 'ALREADY_FINALIZED',
      'candidate_id', _candidate_id,
      'mission_id', v_candidate.mission_id
    );
  END IF;

  IF v_candidate.state <> 'PENDING' THEN
    RETURN jsonb_build_object('outcome', 'ALREADY_RESOLVED', 'state', v_candidate.state);
  END IF;

  SELECT tc.user_id INTO v_actor_user_id
    FROM public.telegram_connections tc
   WHERE tc.telegram_user_id = _telegram_user_id
   LIMIT 1;
  IF v_actor_user_id IS NULL THEN
    RETURN jsonb_build_object('outcome', 'REJECTED', 'reason', 'actor_not_linked');
  END IF;

  IF NOT public.is_workspace_operator(v_candidate.workspace_id, v_actor_user_id) THEN
    RETURN jsonb_build_object('outcome', 'REJECTED', 'reason', 'actor_not_operator');
  END IF;

  -- The mission must genuinely belong to this candidate's workspace AND have a
  -- target in this candidate's own chat.
  SELECT m.workspace_id, t.telegram_chat_id, t.id, t.delivery_state, m.ends_at
    INTO v_mission_workspace, v_target_chat, v_target_id, v_delivery_state, v_ends_at
    FROM public.social_missions m
    JOIN public.social_mission_targets t
      ON t.mission_id = m.id AND t.workspace_id = m.workspace_id
   WHERE m.id = _mission_id
     AND t.telegram_chat_id = v_candidate.telegram_chat_id
   LIMIT 1;

  IF v_mission_workspace IS NULL OR v_mission_workspace <> v_candidate.workspace_id
     OR v_target_chat IS DISTINCT FROM v_candidate.telegram_chat_id THEN
    RETURN jsonb_build_object('outcome', 'REJECTED', 'reason', 'mission_not_bound');
  END IF;

  IF v_delivery_state IS DISTINCT FROM 'SENT' THEN
    RETURN jsonb_build_object('outcome', 'REJECTED', 'reason', 'card_not_sent');
  END IF;

  IF v_ends_at IS NULL THEN
    RETURN jsonb_build_object('outcome', 'REJECTED', 'reason', 'schedule_not_active');
  END IF;

  SELECT EXISTS (
    SELECT 1
      FROM public.social_mission_schedule_events e
     WHERE e.mission_id = _mission_id
       AND e.target_id = v_target_id
       AND e.event_type = 'COMPLETE'
  ) INTO v_schedule_active;

  IF NOT COALESCE(v_schedule_active, false) THEN
    RETURN jsonb_build_object('outcome', 'REJECTED', 'reason', 'schedule_not_active');
  END IF;


  UPDATE public.social_mission_link_candidates
     SET state = 'STARTED',
         resolved_at = now(),
         resolved_by = v_actor_user_id,
         mission_id = _mission_id
   WHERE id = _candidate_id AND state = 'PENDING';

  RETURN jsonb_build_object(
    'outcome', 'FINALIZED',
    'candidate_id', _candidate_id,
    'workspace_id', v_candidate.workspace_id,
    'mission_id', _mission_id
  );
END;
$$;

REVOKE ALL ON FUNCTION public.finalize_social_mission_link_candidate_start(uuid, bigint, bigint, uuid)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.finalize_social_mission_link_candidate_start(uuid, bigint, bigint, uuid) TO service_role;
GRANT EXECUTE ON FUNCTION public.finalize_social_mission_link_candidate_start(uuid, bigint, bigint, uuid) TO postgres;

-- ---------------------------------------------------------------------------
-- 4. create_social_mission_from_telegram_link — retry-safe claim.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.create_social_mission_from_telegram_link(
  _telegram_update_id bigint,
  _telegram_chat_id bigint,
  _telegram_message_id bigint,
  _telegram_user_id bigint,
  _canonical_url text,
  _external_post_id text,
  _author_handle text,
  _source text DEFAULT 'telegram_mission_command'
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_claimed boolean := false;
  v_claim_rows integer := 0;
  v_update_present boolean := false;
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
  v_settings public.social_mission_settings%ROWTYPE;
  v_config jsonb;
  v_handle text := lower(btrim(coalesce(_author_handle, '')));
  v_url text := btrim(coalesce(_canonical_url, ''));
  v_post_external text := btrim(coalesce(_external_post_id, ''));
  v_source text := CASE
    WHEN lower(btrim(coalesce(_source, ''))) = 'telegram_link_finder' THEN 'telegram_link_finder'
    ELSE 'telegram_mission_command'
  END;
BEGIN
  -- 1. Structural validation. Nothing here touches the network.
  IF _telegram_update_id IS NULL OR _telegram_chat_id IS NULL
     OR _telegram_message_id IS NULL OR _telegram_user_id IS NULL THEN
    RETURN jsonb_build_object('outcome', 'REJECTED', 'reason', 'invalid_telegram_identifiers');
  END IF;

  -- A real Telegram message id is mandatory.
  IF _telegram_message_id <= 0 THEN
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

  -- 2. Atomic idempotency claim. Bare ON CONFLICT DO NOTHING so BOTH unique
  --    constraints are absorbed.
  INSERT INTO public.telegram_inbound_updates (
    telegram_update_id, update_kind, telegram_chat_id, telegram_message_id, telegram_user_id, status
  )
  VALUES (
    _telegram_update_id, 'MESSAGE', _telegram_chat_id, _telegram_message_id, _telegram_user_id, 'RECEIVED'
  )
  ON CONFLICT DO NOTHING;

  GET DIAGNOSTICS v_claim_rows = ROW_COUNT;
  v_claimed := v_claim_rows = 1;

  IF NOT v_claimed THEN
    SELECT true, tiu.telegram_chat_id, tiu.telegram_user_id
      INTO v_update_present, v_existing_update_chat, v_existing_update_user
      FROM public.telegram_inbound_updates tiu
     WHERE tiu.telegram_update_id = _telegram_update_id;

    IF COALESCE(v_update_present, false) THEN
      -- Same Telegram update delivered twice. Never act twice.
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

    -- Otherwise the (chat, message) pair was recorded by an EARLIER attempt on
    -- the same source message under a different update id. Fall through.
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

  -- 6b. CONCURRENCY GUARD: transaction-scoped advisory lock on
  --     (workspace, post, chat). Released automatically at COMMIT/ROLLBACK.
  PERFORM pg_advisory_xact_lock(
    hashtextextended(v_workspace_id::text || ':' || v_post_external || ':' || _telegram_chat_id::text, 0)
  );

  -- 7. Get-or-create the social post. An existing row is PRESERVED as-is.

  INSERT INTO public.social_posts (
    workspace_id, platform, external_post_id, canonical_url, author_handle, content_text, metadata
  )
  VALUES (
    v_workspace_id, 'x', v_post_external, v_url, v_handle, NULL,
    jsonb_build_object('source', v_source)
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

  -- 8. One post + one community = one mission. Never duplicate.
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

  -- 9. Snapshot the EFFECTIVE configuration into the mission.
  SELECT * INTO v_settings
    FROM public.social_mission_settings
   WHERE workspace_id = v_workspace_id;

  v_config := public.social_mission_preset_config(COALESCE(v_settings.default_preset, 'STANDARD'))
    || jsonb_build_object(
         'live_metrics_enabled', COALESCE(v_settings.live_metrics_enabled, true),
         'auto_pin_mission', COALESCE(v_settings.auto_pin_mission, true),
         'delete_command_after_send', COALESCE(v_settings.delete_command_after_send, true),
         'milestone_type', COALESCE(v_settings.milestone_type, 'NONE'),
         'milestone_target', v_settings.milestone_target
       );

  -- 10. Create exactly one LIVE mission and one PENDING target.
  INSERT INTO public.social_missions (
    workspace_id, social_post_id, status, started_at, created_by, metadata
  )
  VALUES (
    v_workspace_id, v_post_id, 'LIVE', now(), v_actor_user_id,
    jsonb_build_object(
      'source', v_source,
      'telegram_update_id', _telegram_update_id,
      'telegram_chat_id', _telegram_chat_id,
      'telegram_message_id', _telegram_message_id,
      'telegram_user_id', _telegram_user_id,
      'effective_config', v_config
    )
  )
  RETURNING id INTO v_mission_id;

  INSERT INTO public.social_mission_targets (
    workspace_id, mission_id, group_connection_id, telegram_chat_id, delivery_state, command_message_id
  )
  VALUES (
    v_workspace_id, v_mission_id, v_connection_id, _telegram_chat_id, 'PENDING',
    CASE WHEN v_source = 'telegram_mission_command' THEN _telegram_message_id ELSE NULL END
  )
  RETURNING id, delivery_state INTO v_target_id, v_delivery_state;

  UPDATE public.telegram_inbound_updates
     SET status = 'PROCESSED', processed_at = now(), updated_at = now()
   WHERE telegram_update_id = _telegram_update_id;

  RETURN jsonb_build_object(
    'outcome', 'CREATED',
    'reason', 'created',
    'source', v_source,
    'actor_user_id', v_actor_user_id,
    'workspace_id', v_workspace_id,
    'mission_id', v_mission_id,
    'target_id', v_target_id,
    'delivery_state', v_delivery_state,
    'effective_config', v_config
  );
END;
$$;

REVOKE ALL ON FUNCTION public.create_social_mission_from_telegram_link(
  bigint, bigint, bigint, bigint, text, text, text, text
) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.create_social_mission_from_telegram_link(
  bigint, bigint, bigint, bigint, text, text, text, text
) TO service_role;
GRANT EXECUTE ON FUNCTION public.create_social_mission_from_telegram_link(
  bigint, bigint, bigint, bigint, text, text, text, text
) TO postgres;

COMMIT;