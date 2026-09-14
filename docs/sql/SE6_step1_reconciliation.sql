-- ---------------------------------------------------------------------------
-- SE-6 (Step 1 reconciliation) — PREPARED ONLY. NOT APPLIED BY LOVABLE.
--
-- Target project: ocoinbnjgstkmnwwvnhi (external Supabase, sole system of
-- record). Apply AFTER `docs/sql/SE5_social_mission_engine.sql`.
--
-- This file SUPERSEDES the withdrawn tier/threshold migration
-- (`SE6_mission_tiers_pulse_presets.sql`, deleted). It creates NO preset
-- table, NO tier machinery, NO pulse-mark table and NO duplicate history
-- table: Step 1 history is read from the existing `social_missions`,
-- `social_mission_targets`, `social_mission_schedule_events` and
-- `social_metric_snapshots`.
--
-- It does exactly three things:
--   1. Internal-only X read telemetry on `usage_ledger`, written ONLY when a
--      brand-new metric snapshot row was actually inserted, so a webhook or
--      runner retry can never multiply usage. No billing, no limits, no
--      entitlement, no dollar pricing.
--   2. `peek_social_mission_link_candidate` — a READ-ONLY preflight for the X
--      Link Finder buttons. It mutates nothing, so an unauthorized tap can
--      never consume a candidate before live Telegram admin verification.
--   3. `resolve_social_mission_link_candidate` gains a REQUIRED verified-chat
--      argument, so the consuming call can only be made by a caller that has
--      just verified administrator/creator status in that candidate's own
--      chat.
--
-- Re-runnable. Additive. No table is dropped and no data is deleted.
-- ---------------------------------------------------------------------------

BEGIN;

-- ---------------------------------------------------------------------------
-- 1. record_social_mission_metric_snapshot — unchanged semantics plus
--    INTERNAL-ONLY provider read telemetry.
--
--    UNIT: one row of `usage_ledger` with
--      action_type = 'social_x_tracked_post_read'
--      units       = 1
--    means "one tracked X post was read into a new stored snapshot for this
--    workspace" — written ONLY for the official X provider, whose snapshots
--    carry the exact runtime constant `x-official`.
--    workspace". It is OPERATIONAL TELEMETRY, not billable usage and not an
--    exact invoice cost: the official X batch endpoint reads up to 100 posts
--    per HTTP call, and that call cannot be truthfully split across
--    workspaces. `provider_cost` and `internal_cost` are deliberately left
--    NULL — no dollar pricing is encoded anywhere.
--
--    IDEMPOTENCY: the ledger row is written only when the snapshot INSERT
--    actually created a row. `social_metric_snapshots` is unique on
--    (mission_id, provider, poll_bucket), so a retried webhook delivery, a
--    duplicated cron invocation and an overlapping manual close all collapse
--    onto the same bucket and produce at most one ledger row.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.record_social_mission_metric_snapshot(
  _mission_id uuid,
  _provider text,
  _observed_at timestamptz,
  _poll_bucket timestamptz,
  _views bigint DEFAULT NULL,
  _likes bigint DEFAULT NULL,
  _comments bigint DEFAULT NULL,
  _shares bigint DEFAULT NULL,
  _saves bigint DEFAULT NULL,
  _availability jsonb DEFAULT '{}'::jsonb,
  _metadata jsonb DEFAULT '{}'::jsonb
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_mission public.social_missions%ROWTYPE;
  v_config jsonb;
  v_type text;
  v_target_value integer;
  v_progress bigint;
  v_rows integer := 0;
  v_snapshot_inserted boolean := false;
  v_baseline_written boolean := false;
  v_accomplished_now boolean := false;
BEGIN
  IF _mission_id IS NULL OR coalesce(btrim(_provider), '') = '' THEN
    RETURN jsonb_build_object('outcome', 'REJECTED', 'reason', 'invalid_arguments');
  END IF;

  SELECT * INTO v_mission FROM public.social_missions WHERE id = _mission_id FOR UPDATE;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('outcome', 'REJECTED', 'reason', 'mission_not_found');
  END IF;

  INSERT INTO public.social_metric_snapshots (
    mission_id, workspace_id, provider, observed_at, poll_bucket,
    views, likes, comments, shares, saves, availability, metadata
  )
  VALUES (
    _mission_id, v_mission.workspace_id, _provider,
    COALESCE(_observed_at, now()), COALESCE(_poll_bucket, date_trunc('minute', now())),
    _views, _likes, _comments, _shares, _saves,
    COALESCE(_availability, '{}'::jsonb), COALESCE(_metadata, '{}'::jsonb)
  )
  ON CONFLICT (mission_id, provider, poll_bucket) DO NOTHING;
  GET DIAGNOSTICS v_rows = ROW_COUNT;
  v_snapshot_inserted := v_rows = 1;

  -- Internal-only telemetry, tied to the durable snapshot idempotency fact.
  -- PROVIDER GATE: the official X adapter is the ONLY metered provider. It
  -- writes snapshots under the exact runtime constant X_PROVIDER = 'x-official'
  -- (backend-source/edge-functions/_shared/x-metrics.ts). No other provider
  -- string is metered.
  IF v_snapshot_inserted AND _provider = 'x-official' THEN
    INSERT INTO public.usage_ledger (workspace_id, user_id, action_type, units)
    VALUES (v_mission.workspace_id, NULL, 'social_x_tracked_post_read', 1);
  END IF;

  -- Baseline is written exactly once, and only into columns still NULL.
  IF v_mission.baseline_views IS NULL
     AND v_mission.baseline_likes IS NULL
     AND v_mission.baseline_comments IS NULL
     AND v_mission.baseline_shares IS NULL
     AND v_mission.baseline_saves IS NULL THEN
    UPDATE public.social_missions
       SET baseline_views = _views,
           baseline_likes = _likes,
           baseline_comments = _comments,
           baseline_shares = _shares,
           baseline_saves = _saves,
           baseline_observed_at = COALESCE(baseline_observed_at, COALESCE(_observed_at, now()))
     WHERE id = _mission_id
       AND baseline_views IS NULL
       AND baseline_likes IS NULL
       AND baseline_comments IS NULL
       AND baseline_shares IS NULL
       AND baseline_saves IS NULL;
    GET DIAGNOSTICS v_rows = ROW_COUNT;
    v_baseline_written := v_rows = 1;
  END IF;

  -- Milestone. Absolute public metrics only; never a per-user requirement and
  -- never a reward. TOTAL_INTERACTIONS excludes views and bookmarks. Unknown
  -- stays unknown: a NULL metric never counts as 0.
  v_config := public.social_mission_effective_config(_mission_id);
  v_type := upper(coalesce(v_config ->> 'milestone_type', 'NONE'));
  v_target_value := NULLIF(v_config ->> 'milestone_target', '')::integer;

  IF v_mission.accomplished_at IS NULL AND v_type <> 'NONE'
     AND v_target_value IS NOT NULL AND v_target_value > 0 THEN
    v_progress := CASE v_type
      WHEN 'VIEWS' THEN _views
      WHEN 'LIKES' THEN _likes
      WHEN 'REPLIES' THEN _comments
      WHEN 'REPOSTS' THEN _shares
      -- NULL-HONEST: computable ONLY when ALL THREE components are known.
      -- Any NULL component makes the total unknown, so a partial interaction
      -- set can never accomplish the milestone.
      WHEN 'TOTAL_INTERACTIONS' THEN
        CASE
          WHEN _likes IS NULL OR _comments IS NULL OR _shares IS NULL THEN NULL
          ELSE _likes + _comments + _shares
        END
      ELSE NULL
    END;

    IF v_progress IS NOT NULL AND v_progress >= v_target_value THEN
      UPDATE public.social_missions
         SET accomplished_at = COALESCE(_observed_at, now())
       WHERE id = _mission_id
         AND accomplished_at IS NULL;
      GET DIAGNOSTICS v_rows = ROW_COUNT;
      v_accomplished_now := v_rows = 1;
    END IF;
  END IF;

  RETURN jsonb_build_object(
    'outcome', 'RECORDED',
    'mission_id', _mission_id,
    'workspace_id', v_mission.workspace_id,
    'snapshot_inserted', v_snapshot_inserted,
    'baseline_written', v_baseline_written,
    'accomplished_now', v_accomplished_now,
    'accomplished_at', (SELECT accomplished_at FROM public.social_missions WHERE id = _mission_id)
  );
END;
$$;

REVOKE ALL ON FUNCTION public.record_social_mission_metric_snapshot(
  uuid, text, timestamptz, timestamptz, bigint, bigint, bigint, bigint, bigint, jsonb, jsonb
) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.record_social_mission_metric_snapshot(
  uuid, text, timestamptz, timestamptz, bigint, bigint, bigint, bigint, bigint, jsonb, jsonb
) TO service_role;
GRANT EXECUTE ON FUNCTION public.record_social_mission_metric_snapshot(
  uuid, text, timestamptz, timestamptz, bigint, bigint, bigint, bigint, bigint, jsonb, jsonb
) TO postgres;

-- ---------------------------------------------------------------------------
-- 2. X Link Finder — READ-ONLY preflight.
--    Mutates NOTHING. It answers "may this Telegram user be offered this
--    candidate, and in which chat must their live admin status be checked?".
--    An unauthorized tap therefore leaves the candidate PENDING for an
--    authorized admin.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.peek_social_mission_link_candidate(
  _candidate_id uuid,
  _telegram_user_id bigint
)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_candidate public.social_mission_link_candidates%ROWTYPE;
  v_actor_user_id uuid;
BEGIN
  IF _candidate_id IS NULL OR _telegram_user_id IS NULL THEN
    RETURN jsonb_build_object('outcome', 'REJECTED', 'reason', 'invalid_arguments');
  END IF;

  SELECT * INTO v_candidate
    FROM public.social_mission_link_candidates
   WHERE id = _candidate_id;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('outcome', 'REJECTED', 'reason', 'candidate_not_found');
  END IF;

  IF v_candidate.state <> 'PENDING' THEN
    RETURN jsonb_build_object('outcome', 'ALREADY_RESOLVED', 'state', v_candidate.state);
  END IF;

  -- Expiry is REPORTED here, never written: this function stays read-only.
  IF v_candidate.expires_at <= now() THEN
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

  RETURN jsonb_build_object(
    'outcome', 'ELIGIBLE',
    'candidate_id', v_candidate.id,
    'workspace_id', v_candidate.workspace_id,
    'actor_user_id', v_actor_user_id,
    -- The chat the webhook MUST run getChatMember against.
    'telegram_chat_id', v_candidate.telegram_chat_id,
    'telegram_message_id', v_candidate.telegram_message_id,
    'prompt_message_id', v_candidate.prompt_message_id,
    'canonical_url', v_candidate.canonical_url
  );
END;
$$;

REVOKE ALL ON FUNCTION public.peek_social_mission_link_candidate(uuid, bigint)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.peek_social_mission_link_candidate(uuid, bigint) TO service_role;
GRANT EXECUTE ON FUNCTION public.peek_social_mission_link_candidate(uuid, bigint) TO postgres;

-- ---------------------------------------------------------------------------
-- 3. resolve_social_mission_link_candidate — consuming resolver, now REQUIRING
--    the chat id whose live Telegram administrator/creator status the caller
--    just verified. The old 3-argument signature is dropped so no caller can
--    keep consuming a candidate without that proof.
--
--    Every authorization fact is revalidated here, inside the same
--    transaction that consumes the candidate.
-- ---------------------------------------------------------------------------
DROP FUNCTION IF EXISTS public.resolve_social_mission_link_candidate(uuid, bigint, text);

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

  UPDATE public.social_mission_link_candidates
     SET state = CASE WHEN v_decision = 'START' THEN 'STARTED' ELSE 'IGNORED' END,
         resolved_at = now(),
         resolved_by = v_actor_user_id
   WHERE id = _candidate_id AND state = 'PENDING';

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

COMMIT;
