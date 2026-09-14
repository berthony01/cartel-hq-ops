-- ===========================================================================
-- SE-9 — LINK FINDER CANONICAL FLOW CORRECTION
--
-- PREPARED ONLY. NOT APPLIED. External Supabase `ocoinbnjgstkmnwwvnhi` remains
-- the sole production system of record and nothing in this file has been run
-- against it.
--
-- Three surgical changes, no new subsystem:
--
--   1. Durable source-cleanup state on the EXISTING candidate row. The original
--      X-link message is now deleted at DETECTION time, immediately after the
--      transient START/IGNORE prompt is confirmed sent and attached. The
--      candidate must remember that outcome so a retry neither re-deletes a
--      message that is already gone nor pretends a failure succeeded. The real
--      `telegram_message_id` stays untouched as provenance.
--
--   2. `resolve_social_mission_link_candidate` returns that state so the
--      webhook can skip a pointless Telegram call on START. No authorization,
--      chat binding, expiry or consumption semantics change at all.
--
--   3. `create_social_mission_from_telegram_link` step 8 blocks a duplicate
--      only while a NON-TERMINAL mission exists for the same
--      (workspace, social post, Telegram chat). Terminal history no longer
--      blocks a fresh mission.
--
-- Everything else — the authorization chain, workspace isolation, the official
-- handle verification, the advisory-lock concurrency guard, the retry-safe
-- claim, the effective-config snapshot and the SE-7 finalizer — is carried over
-- byte-for-byte from SE-7.
-- ===========================================================================

BEGIN;

-- ---------------------------------------------------------------------------
-- 1. Durable Link Finder source-cleanup state.
--
--    `source_deleted_at` is set exactly once, when the original X-link message
--    is confirmed gone. `source_cleanup_error` holds a BOUNDED, non-sensitive
--    diagnostic for the last failed attempt: never a token, key, header or raw
--    payload. `telegram_message_id` is deliberately left alone so the real
--    original message id survives deletion as provenance.
-- ---------------------------------------------------------------------------
ALTER TABLE public.social_mission_link_candidates
  ADD COLUMN IF NOT EXISTS source_deleted_at timestamptz;
ALTER TABLE public.social_mission_link_candidates
  ADD COLUMN IF NOT EXISTS source_cleanup_error text;

-- ---------------------------------------------------------------------------
-- 2. record_social_mission_link_candidate_source_cleanup
--
--    Idempotent. A candidate already recorded as cleaned stays cleaned and its
--    timestamp is never rewritten, so webhook retries cannot move it. A failure
--    records only a bounded reason and leaves the candidate retryable. It never
--    changes `state`, never resolves the candidate and never touches missions.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.record_social_mission_link_candidate_source_cleanup(
  _candidate_id uuid,
  _deleted boolean,
  _reason text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_existing timestamptz;
  v_reason text := NULLIF(btrim(coalesce(_reason, '')), '');
BEGIN
  IF _candidate_id IS NULL THEN
    RETURN jsonb_build_object('outcome', 'REJECTED', 'reason', 'invalid_arguments');
  END IF;

  SELECT source_deleted_at INTO v_existing
    FROM public.social_mission_link_candidates
   WHERE id = _candidate_id
   FOR UPDATE;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('outcome', 'REJECTED', 'reason', 'candidate_not_found');
  END IF;

  -- Already clean: terminal and immutable.
  IF v_existing IS NOT NULL THEN
    RETURN jsonb_build_object('outcome', 'ALREADY_CLEAN', 'source_deleted_at', v_existing);
  END IF;

  IF COALESCE(_deleted, false) THEN
    UPDATE public.social_mission_link_candidates
       SET source_deleted_at = now(),
           source_cleanup_error = NULL
     WHERE id = _candidate_id;
    RETURN jsonb_build_object('outcome', 'CLEAN');
  END IF;

  UPDATE public.social_mission_link_candidates
     SET source_cleanup_error = left(coalesce(v_reason, 'source deletion failed'), 200)
   WHERE id = _candidate_id;
  RETURN jsonb_build_object('outcome', 'RETRYABLE');
END;
$$;

REVOKE ALL ON FUNCTION public.record_social_mission_link_candidate_source_cleanup(uuid, boolean, text)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.record_social_mission_link_candidate_source_cleanup(uuid, boolean, text)
  TO service_role;
GRANT EXECUTE ON FUNCTION public.record_social_mission_link_candidate_source_cleanup(uuid, boolean, text)
  TO postgres;

-- ---------------------------------------------------------------------------
-- 3. resolve_social_mission_link_candidate — SE-7 behaviour, plus the durable
--    source-cleanup state in the response. START still authorizes WITHOUT
--    consuming; IGNORE still consumes and still leaves the (already deleted)
--    source post alone: IGNORE removes only the transient prompt and never
--    restores or reposts anything.
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
    'source_deleted_at', v_candidate.source_deleted_at,
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
-- 4. create_social_mission_from_telegram_link — SE-7 behaviour with the SE-9
--    duplicate rule in step 8. `finalize_social_mission_link_candidate_start`
--    from SE-7 is unchanged and is deliberately NOT redefined here.
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

  -- A real Telegram message id is mandatory. The old NULL -> 0 Link Finder
  -- path is refused outright rather than colliding on (chat, 0).
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
    -- the same source message under a different update id. Fall through: this
    -- is the retry path, and step 8 guarantees it cannot duplicate a mission.
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

  -- 6b. CONCURRENCY GUARD. The bare ON CONFLICT DO NOTHING claim above is what
  --     makes a retry possible, so it can no longer be relied on to serialize
  --     two simultaneous callbacks for the same post in the same chat. There is
  --     no unique constraint on (workspace, post, chat) across missions, so a
  --     transaction-scoped advisory lock keyed on exactly that tuple serializes
  --     them: the loser waits, then sees the winner's mission at step 8 and
  --     returns EXISTING. The lock is released automatically at COMMIT or
  --     ROLLBACK. No new table, no new scheduler, no new state.
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

  -- 8. SE-9 DUPLICATE RULE.
  --
  --    One post + one community may hold AT MOST ONE NON-TERMINAL mission at a
  --    time. `DRAFT` and `LIVE` are non-terminal; ACCOMPLISHED is a derived
  --    state of a LIVE mission (`accomplished_at`), so it is covered by `LIVE`
  --    and still blocks a duplicate. `COMPLETED`, `CANCELLED` and `FAILED` are
  --    terminal: once every prior mission for this (workspace, post, chat) is
  --    terminal, a genuinely NEW mission, target, card and schedule are
  --    allowed. Historical rows are never read destructively, mutated or
  --    deleted here — only ignored for the duplicate decision.
  --
  --    This is what stops a later START from recovering and pinning an OLD
  --    completed card instead of posting a fresh one at the current position.
  SELECT m.id, t.id, t.delivery_state
    INTO v_mission_id, v_target_id, v_delivery_state
    FROM public.social_missions m
    JOIN public.social_mission_targets t
      ON t.mission_id = m.id AND t.workspace_id = m.workspace_id
   WHERE m.workspace_id = v_workspace_id
     AND m.social_post_id = v_post_id
     AND t.telegram_chat_id = _telegram_chat_id
     AND m.status IN ('DRAFT', 'LIVE')
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
