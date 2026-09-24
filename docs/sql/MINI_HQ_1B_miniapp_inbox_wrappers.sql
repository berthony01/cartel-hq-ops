-- =============================================================================
-- MINI-HQ-1B — Service-only Mini App Project Inbox wrappers
-- STATUS: APPLIED. Historical source record only. Applied externally to
-- Supabase ocoinbnjgstkmnwwvnhi as migration 20260924151436 named
-- mini_hq_1b_miniapp_inbox_wrappers. Do not re-run; no further review gate.
--
-- Purpose
--   The Telegram owner Mini App has validated Telegram initData but no Supabase
--   user JWT, so the existing Project Inbox RPCs (which authorize via
--   auth.uid()) cannot be called directly. These wrappers:
--     1. are EXECUTE-able by service_role ONLY (the TanStack bridge, after it
--        has validated initData and derived the Telegram user id from the
--        signature);
--     2. map the Telegram user id -> platform user through the existing
--        public.telegram_connections table (never accept a platform user id);
--     3. verify that user is owner/admin of the claimed workspace, and (for
--        conversation-scoped calls) that the conversation belongs to that
--        workspace, BEFORE any auth context is set or any RPC is called;
--     4. set a TRANSACTION-LOCAL JWT subject claim so auth.uid() inside the
--        UNCHANGED existing RPC resolves to the mapped platform user;
--     5. delegate to the unchanged existing RPC and pass its privacy-safe
--        result shape through verbatim.
--
-- Auth context proof
--   Production auth.uid() resolves (verified live on ocoinbnjgstkmnwwvnhi):
--     coalesce(current_setting('request.jwt.claim.sub', true),
--              current_setting('request.jwt.claims', true)::jsonb ->> 'sub')::uuid
--   set_config(name, value, is_local => true) scopes the value to the CURRENT
--   TRANSACTION only. PostgREST executes each RPC call in its own transaction,
--   so the impersonated subject can never leak into another request/caller.
--   The existing RPCs then run their own full authorization again (workspace
--   role, commercial access + owner bypass, idempotency, locks, blocked/
--   resolved checks, delivery queue semantics). NO business logic is copied.
--
-- Fail-closed contract
--   Missing Telegram link, wrong workspace, non-operator, or a conversation not
--   in the workspace all raise the SAME generic error:
--     'not_found' (ERRCODE P0002)
--   so existence is never revealed.
--
-- Privacy
--   No wrapper returns any Telegram user id, chat id, message id, username,
--   contact_id or provider payload. Return shapes are identical to the
--   existing browser RPCs, which expose only the opaque member_ref.
--
-- No new tables. No RLS change. No change to existing RPCs.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- Internal binder: Telegram user -> platform user, workspace operator check,
-- optional conversation-in-workspace check, then transaction-local auth claim.
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.miniapp_inbox_bind_operator(
  _telegram_user_id bigint,
  _workspace_id uuid,
  _conversation_id uuid DEFAULT NULL
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid uuid;
BEGIN
  IF _telegram_user_id IS NULL OR _telegram_user_id <= 0 OR _workspace_id IS NULL THEN
    RAISE EXCEPTION 'not_found' USING ERRCODE = 'P0002';
  END IF;

  SELECT tc.user_id INTO v_uid
    FROM public.telegram_connections tc
   WHERE tc.telegram_user_id = _telegram_user_id
   LIMIT 1;

  IF v_uid IS NULL OR NOT EXISTS (
    SELECT 1 FROM public.workspace_members wm
     WHERE wm.workspace_id = _workspace_id
       AND wm.user_id = v_uid
       AND wm.role IN ('owner', 'admin')
  ) THEN
    RAISE EXCEPTION 'not_found' USING ERRCODE = 'P0002';
  END IF;

  IF _conversation_id IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM public.project_conversations pc
     WHERE pc.id = _conversation_id
       AND pc.workspace_id = _workspace_id
  ) THEN
    RAISE EXCEPTION 'not_found' USING ERRCODE = 'P0002';
  END IF;

  -- TRANSACTION-LOCAL (is_local = true) subject claim. auth.uid() reads
  -- request.jwt.claim.sub first, then request.jwt.claims->>'sub'; both are set
  -- so either resolution path yields the mapped platform user.
  PERFORM set_config('request.jwt.claim.sub', v_uid::text, true);
  PERFORM set_config('request.jwt.claim.role', 'authenticated', true);
  PERFORM set_config(
    'request.jwt.claims',
    json_build_object('sub', v_uid::text, 'role', 'authenticated')::text,
    true
  );

  RETURN v_uid;
END;
$$;

-- -----------------------------------------------------------------------------
-- Reads
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.miniapp_inbox_summary(
  _telegram_user_id bigint,
  _workspace_id uuid
)
RETURNS TABLE(open_count integer, waiting_on_team_count integer, waiting_on_member_count integer,
              resolved_count integer, blocked_contact_count integer)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  PERFORM public.miniapp_inbox_bind_operator(_telegram_user_id, _workspace_id, NULL);
  RETURN QUERY SELECT s.* FROM public.get_project_inbox_summary(_workspace_id) s;
END;
$$;

CREATE OR REPLACE FUNCTION public.miniapp_inbox_list_conversations(
  _telegram_user_id bigint,
  _workspace_id uuid,
  _status text DEFAULT NULL,
  _limit integer DEFAULT 50
)
RETURNS TABLE(conversation_id uuid, member_ref text, contact_status text, category text, status text,
              priority text, origin_type text, origin_title_snapshot text, latest_message_preview text,
              last_message_at timestamptz, opened_at timestamptz, assigned_to uuid, assigned_display_name text)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  PERFORM public.miniapp_inbox_bind_operator(_telegram_user_id, _workspace_id, NULL);
  RETURN QUERY SELECT c.* FROM public.list_project_inbox_conversations(
    _workspace_id, _status, LEAST(GREATEST(COALESCE(_limit, 50), 1), 100)
  ) c;
END;
$$;

CREATE OR REPLACE FUNCTION public.miniapp_inbox_get_conversation(
  _telegram_user_id bigint,
  _workspace_id uuid,
  _conversation_id uuid
)
RETURNS TABLE(conversation_id uuid, member_ref text, contact_status text, category text, status text,
              priority text, origin_type text, origin_title_snapshot text, origin_text_snapshot text,
              last_message_at timestamptz, opened_at timestamptz, resolved_at timestamptz,
              assigned_to uuid, assigned_display_name text)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  PERFORM public.miniapp_inbox_bind_operator(_telegram_user_id, _workspace_id, _conversation_id);
  RETURN QUERY SELECT c.* FROM public.get_project_inbox_conversation(_workspace_id, _conversation_id) c;
END;
$$;

CREATE OR REPLACE FUNCTION public.miniapp_inbox_list_messages(
  _telegram_user_id bigint,
  _workspace_id uuid,
  _conversation_id uuid,
  _limit integer DEFAULT 200
)
RETURNS TABLE(message_id uuid, author_type text, channel text, body text, team_display_name text,
              created_at timestamptz, reply_to_message_id uuid, delivery_status text,
              delivery_sent_at timestamptz, delivery_uncertainty_acknowledged_at timestamptz)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  -- The existing messages RPC is conversation-scoped only; the binder proves
  -- the conversation belongs to the claimed, operator-authorized workspace.
  PERFORM public.miniapp_inbox_bind_operator(_telegram_user_id, _workspace_id, _conversation_id);
  RETURN QUERY SELECT m.* FROM public.list_project_conversation_messages(
    _conversation_id, LEAST(GREATEST(COALESCE(_limit, 200), 1), 200)
  ) m;
END;
$$;

-- -----------------------------------------------------------------------------
-- Writes (all business rules remain inside the existing RPCs)
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.miniapp_inbox_update_status(
  _telegram_user_id bigint,
  _workspace_id uuid,
  _conversation_id uuid,
  _status text
)
RETURNS TABLE(conversation_id uuid, status text, resolved_at timestamptz, updated_at timestamptz)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  PERFORM public.miniapp_inbox_bind_operator(_telegram_user_id, _workspace_id, _conversation_id);
  RETURN QUERY SELECT r.* FROM public.update_project_conversation_status(_conversation_id, _status) r;
END;
$$;

CREATE OR REPLACE FUNCTION public.miniapp_inbox_set_blocked(
  _telegram_user_id bigint,
  _workspace_id uuid,
  _conversation_id uuid,
  _blocked boolean
)
RETURNS TABLE(conversation_id uuid, member_ref text, contact_status text, blocked_at timestamptz)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  PERFORM public.miniapp_inbox_bind_operator(_telegram_user_id, _workspace_id, _conversation_id);
  RETURN QUERY SELECT r.* FROM public.set_project_inbox_conversation_contact_blocked(
    _workspace_id, _conversation_id, _blocked
  ) r;
END;
$$;

CREATE OR REPLACE FUNCTION public.miniapp_inbox_create_team_reply(
  _telegram_user_id bigint,
  _workspace_id uuid,
  _conversation_id uuid,
  _body text,
  _client_request_id uuid
)
RETURNS TABLE(message_id uuid, delivery_status text, created_at timestamptz,
              conversation_status text, idempotent_replay boolean)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  -- Commercial access + owner bypass, 1..3500 bound, idempotency by
  -- client_request_id, locking, blocked/resolved/unsettled refusal and the
  -- durable delivery queue are ALL enforced by the unchanged existing RPC.
  PERFORM public.miniapp_inbox_bind_operator(_telegram_user_id, _workspace_id, _conversation_id);
  RETURN QUERY SELECT r.* FROM public.create_project_inbox_team_reply(
    _workspace_id, _conversation_id, _body, _client_request_id
  ) r;
END;
$$;

CREATE OR REPLACE FUNCTION public.miniapp_inbox_ack_uncertainty(
  _telegram_user_id bigint,
  _workspace_id uuid,
  _conversation_id uuid,
  _message_id uuid
)
RETURNS TABLE(message_id uuid, delivery_status text, uncertainty_acknowledged_at timestamptz)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  -- Bookkeeping only: nothing is resent.
  PERFORM public.miniapp_inbox_bind_operator(_telegram_user_id, _workspace_id, _conversation_id);
  RETURN QUERY SELECT r.* FROM public.acknowledge_project_inbox_delivery_uncertainty(
    _workspace_id, _conversation_id, _message_id
  ) r;
END;
$$;

-- -----------------------------------------------------------------------------
-- Grants: service_role ONLY. Explicit revokes from PUBLIC, anon, authenticated.
-- -----------------------------------------------------------------------------
REVOKE ALL ON FUNCTION public.miniapp_inbox_bind_operator(bigint, uuid, uuid) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.miniapp_inbox_summary(bigint, uuid) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.miniapp_inbox_list_conversations(bigint, uuid, text, integer) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.miniapp_inbox_get_conversation(bigint, uuid, uuid) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.miniapp_inbox_list_messages(bigint, uuid, uuid, integer) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.miniapp_inbox_update_status(bigint, uuid, uuid, text) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.miniapp_inbox_set_blocked(bigint, uuid, uuid, boolean) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.miniapp_inbox_create_team_reply(bigint, uuid, uuid, text, uuid) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.miniapp_inbox_ack_uncertainty(bigint, uuid, uuid, uuid) FROM PUBLIC, anon, authenticated;

GRANT EXECUTE ON FUNCTION public.miniapp_inbox_bind_operator(bigint, uuid, uuid) TO service_role;
GRANT EXECUTE ON FUNCTION public.miniapp_inbox_summary(bigint, uuid) TO service_role;
GRANT EXECUTE ON FUNCTION public.miniapp_inbox_list_conversations(bigint, uuid, text, integer) TO service_role;
GRANT EXECUTE ON FUNCTION public.miniapp_inbox_get_conversation(bigint, uuid, uuid) TO service_role;
GRANT EXECUTE ON FUNCTION public.miniapp_inbox_list_messages(bigint, uuid, uuid, integer) TO service_role;
GRANT EXECUTE ON FUNCTION public.miniapp_inbox_update_status(bigint, uuid, uuid, text) TO service_role;
GRANT EXECUTE ON FUNCTION public.miniapp_inbox_set_blocked(bigint, uuid, uuid, boolean) TO service_role;
GRANT EXECUTE ON FUNCTION public.miniapp_inbox_create_team_reply(bigint, uuid, uuid, text, uuid) TO service_role;
GRANT EXECUTE ON FUNCTION public.miniapp_inbox_ack_uncertainty(bigint, uuid, uuid, uuid) TO service_role;

-- -----------------------------------------------------------------------------
-- Post-apply verification (run read-only after an authorized apply):
--   SELECT p.proname,
--          has_function_privilege('anon', p.oid, 'EXECUTE')          AS anon_exec,
--          has_function_privilege('authenticated', p.oid, 'EXECUTE') AS auth_exec,
--          has_function_privilege('service_role', p.oid, 'EXECUTE')  AS svc_exec,
--          p.prosecdef, p.proconfig
--     FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
--    WHERE n.nspname = 'public' AND p.proname LIKE 'miniapp_inbox_%';
--   Expected: anon_exec=false, auth_exec=false, svc_exec=true, prosecdef=true,
--             proconfig contains search_path=public.
-- Local-scope proof (single transaction, then a new one):
--   BEGIN; SELECT set_config('request.jwt.claim.sub', gen_random_uuid()::text, true);
--          SELECT auth.uid();  -- non-null inside
--   COMMIT; SELECT current_setting('request.jwt.claim.sub', true); -- '' / NULL after
-- =============================================================================
