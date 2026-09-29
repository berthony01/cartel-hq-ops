-- SP-B4 V1 — Service Partner community management (routine welcome settings).
-- STAGED ONLY. NOT APPLIED. Apply only under CP-SPB4-SQL.
--
-- Activates the stored partner scope `community_management` through three
-- least-privilege wrappers. Saves and welcome tests stay in the EXISTING Edge
-- actions `telegram-group` / save_welcome_settings and send_welcome_test (one
-- validation + upsert path, one preview sender). This file adds NO table, NO
-- column, NO constraint, NO RLS policy, NO trigger, NO DML grant and NO change
-- to is_workspace_member / is_workspace_operator / can_use_project_tools.
--
-- Defaults below mirror the Edge loadSettings() defaults exactly.
-- Launch Watch CTA configuration is owner-controlled; partners get a read-only
-- summary (enabled + display name/ticker), never a token or launch UUID.
--
-- Rollback: DROP the three functions below.

BEGIN;

-- 1) Safe group list -----------------------------------------------------------
CREATE OR REPLACE FUNCTION public.partner_list_community_groups(_workspace_id uuid)
 RETURNS TABLE(group_connection_id uuid, title text, chat_type text, bot_is_admin boolean, operational boolean, verified_at timestamptz)
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
BEGIN
  IF auth.uid() IS NULL OR _workspace_id IS NULL
     OR NOT public.partner_has_scope(_workspace_id, 'community_management') THEN
    RAISE EXCEPTION 'Not authorized' USING ERRCODE = '42501';
  END IF;
  -- No telegram_chat_id, username, member count, raw metadata or connector ids.
  RETURN QUERY
  SELECT g.id, g.title, g.chat_type, g.bot_is_admin,
         (g.bot_is_admin IS TRUE
           AND coalesce(g.metadata ->> 'last_member_status', '') NOT IN ('left', 'kicked')
           AND coalesce((g.metadata ->> 'bot_can_change_info')::boolean, true)) AS operational,
         g.verified_at
  FROM public.telegram_group_connections g
  WHERE g.workspace_id = _workspace_id
  ORDER BY g.connected_at DESC NULLS LAST, g.id;
END;
$function$;

-- 2) Safe welcome settings read -------------------------------------------------
CREATE OR REPLACE FUNCTION public.partner_get_welcome_settings(_workspace_id uuid, _group_connection_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
DECLARE
  s public.telegram_community_settings%ROWTYPE;
  v_found boolean := false;
  v_label text := NULL;
  v_ticker text := NULL;
  v_available boolean := false;
BEGIN
  IF auth.uid() IS NULL OR _workspace_id IS NULL
     OR NOT public.partner_has_scope(_workspace_id, 'community_management') THEN
    RAISE EXCEPTION 'Not authorized' USING ERRCODE = '42501';
  END IF;
  IF _group_connection_id IS NULL OR NOT EXISTS (
    SELECT 1 FROM public.telegram_group_connections g
    WHERE g.id = _group_connection_id AND g.workspace_id = _workspace_id) THEN
    RAISE EXCEPTION 'Group not found' USING ERRCODE = 'P0002';
  END IF;

  SELECT * INTO s FROM public.telegram_community_settings t
  WHERE t.group_connection_id = _group_connection_id AND t.workspace_id = _workspace_id;
  v_found := FOUND;

  IF NOT v_found THEN
    -- Exact Edge defaults (DEFAULT_WELCOME_MESSAGE, mention on, auto-delete 45s).
    RETURN jsonb_build_object(
      'has_saved_settings', false,
      'welcome_enabled', false,
      'welcome_message', E'\U0001F44B Welcome {first_name} to {community_name}!\n\nPlease check the pinned messages and official links before getting started.',
      'mention_member', true,
      'auto_delete_enabled', true,
      'auto_delete_seconds', 45,
      'launch_watch_cta_enabled', false,
      'launch_watch_available', false,
      'launch_watch_label', NULL,
      'launch_watch_ticker', NULL);
  END IF;

  IF s.launch_watch_cta_enabled AND s.launch_watch_launch_id IS NOT NULL THEN
    -- Same eligibility as the Edge loadEligibleLaunchRows(); display fields only.
    SELECT p.project_name, l.ticker, true INTO v_label, v_ticker, v_available
    FROM public.launches l
    JOIN public.project_profiles p ON p.id = l.project_profile_id
    WHERE l.id = s.launch_watch_launch_id
      AND l.workspace_id = _workspace_id
      AND p.workspace_id = _workspace_id
      AND p.discovery_status = 'published'
      AND l.status IN ('WATCHLIST_OPEN', 'LAUNCH_APPROACHING', 'CONTRACT_PENDING', 'OFFICIAL_CONTRACT_REGISTERED')
      AND coalesce(l.launch_watch_token, '') ~ '^[0-9a-f]{24}$';
    IF NOT coalesce(v_available, false) THEN
      v_label := NULL; v_ticker := NULL; v_available := false;
    END IF;
  END IF;

  RETURN jsonb_build_object(
    'has_saved_settings', true,
    'welcome_enabled', s.welcome_enabled,
    'welcome_message', s.welcome_message,
    'mention_member', s.mention_member,
    'auto_delete_enabled', s.auto_delete_enabled,
    'auto_delete_seconds', s.auto_delete_seconds,
    'launch_watch_cta_enabled', s.launch_watch_cta_enabled,
    'launch_watch_available', v_available,
    'launch_watch_label', v_label,
    'launch_watch_ticker', v_ticker);
END;
$function$;

-- 3) Action authorization (called by telegram-group with the PARTNER's JWT) ----
CREATE OR REPLACE FUNCTION public.partner_authorize_community_action(_workspace_id uuid, _group_connection_id uuid, _action text)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
DECLARE
  v_uid uuid := auth.uid();
  v_eval jsonb;
  v_reason text;
  v_base jsonb := jsonb_build_object(
    'allowed', false, 'reason', NULL, 'mode', NULL, 'would_block', false,
    'plan_code', NULL, 'plan_version', NULL, 'feature_key', 'community_basic',
    'kind', NULL, 'enabled', NULL, 'used', NULL, 'limit', NULL, 'period', NULL,
    'period_start', NULL, 'period_end', NULL, 'assignment_status', NULL, 'enforcement_mode', NULL);
BEGIN
  -- 1. Scope FIRST.
  IF v_uid IS NULL OR _workspace_id IS NULL
     OR NOT public.partner_has_scope(_workspace_id, 'community_management') THEN
    RAISE EXCEPTION 'Not authorized' USING ERRCODE = '42501';
  END IF;
  -- 2. Exact action allow-list.
  IF _action IS NULL OR _action NOT IN ('save_welcome_settings', 'send_welcome_test') THEN
    RETURN jsonb_build_object('allowed', false, 'code', 'ACTION_NOT_ALLOWED');
  END IF;
  -- 3. Target group must belong to the client workspace.
  IF _group_connection_id IS NULL OR NOT EXISTS (
    SELECT 1 FROM public.telegram_group_connections g
    WHERE g.id = _group_connection_id AND g.workspace_id = _workspace_id) THEN
    RETURN jsonb_build_object('allowed', false, 'code', 'GROUP_NOT_FOUND');
  END IF;
  -- 4. Client Project Identity through the one shared core. No partner bypass.
  IF NOT public.project_identity_ready(_workspace_id) THEN
    RETURN jsonb_build_object('allowed', false, 'code', 'PROJECT_IDENTITY_REQUIRED');
  END IF;
  -- 5. CLIENT workspace entitlement through the SP-B0 core. No owner/unrestricted bypass.
  v_eval := public.commercial_evaluate_workspace_feature(_workspace_id, 'community_basic', v_base);
  IF v_eval IS NULL OR jsonb_typeof(v_eval -> 'allowed') IS DISTINCT FROM 'boolean' THEN
    RETURN jsonb_build_object('allowed', false, 'code', 'COMMERCIAL_ACCESS_UNAVAILABLE');
  END IF;
  IF (v_eval ->> 'allowed')::boolean THEN
    RETURN jsonb_build_object('allowed', true, 'code', NULL);
  END IF;
  v_reason := coalesce(v_eval ->> 'reason', '');
  RETURN jsonb_build_object('allowed', false, 'code',
    CASE
      WHEN v_reason = 'PLAN_LIMIT_REACHED' THEN 'PLAN_LIMIT_REACHED'
      WHEN v_reason = 'FEATURE_NOT_INCLUDED' THEN 'FEATURE_NOT_INCLUDED'
      WHEN v_reason LIKE 'ASSIGNMENT\_%' THEN 'PLAN_ACCESS_INACTIVE'
      ELSE 'COMMERCIAL_ACCESS_DENIED'
    END);
END;
$function$;

ALTER FUNCTION public.partner_list_community_groups(uuid) OWNER TO postgres;
ALTER FUNCTION public.partner_get_welcome_settings(uuid, uuid) OWNER TO postgres;
ALTER FUNCTION public.partner_authorize_community_action(uuid, uuid, text) OWNER TO postgres;

REVOKE ALL ON FUNCTION public.partner_list_community_groups(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.partner_list_community_groups(uuid) TO authenticated, service_role;
REVOKE ALL ON FUNCTION public.partner_get_welcome_settings(uuid, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.partner_get_welcome_settings(uuid, uuid) TO authenticated, service_role;
REVOKE ALL ON FUNCTION public.partner_authorize_community_action(uuid, uuid, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.partner_authorize_community_action(uuid, uuid, text) TO authenticated, service_role;

COMMIT;
