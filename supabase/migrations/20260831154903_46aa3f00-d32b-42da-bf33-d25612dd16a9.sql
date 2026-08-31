CREATE OR REPLACE FUNCTION public.get_platform_launch_analytics()
RETURNS TABLE (
  projects_total bigint,
  projects_published bigint,
  projects_operator_hidden bigint,
  projects_platform_hidden bigint,
  projects_verified bigint,
  verification_pending bigint,
  launches_total bigint,
  launches_scheduled bigint,
  contracts_registered bigint,
  launches_by_status jsonb,
  watch_active bigint,
  watch_stopped bigint,
  reminders_enabled bigint,
  reminders_muted bigint,
  launches_with_active_watchers bigint,
  opt_ins_7d bigint,
  opt_ins_30d bigint,
  launch_events_total bigint,
  deliveries_sent bigint,
  deliveries_pending bigint,
  deliveries_failed bigint,
  deliveries_retried bigint,
  deliveries_by_status jsonb,
  connected_groups bigint,
  welcomes_enabled bigint,
  launch_watch_cta_enabled bigint,
  per_launch jsonb
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF auth.uid() IS NULL OR NOT public.is_platform_owner(auth.uid()) THEN
    RAISE EXCEPTION 'Platform owner access required' USING ERRCODE = '42501';
  END IF;

  RETURN QUERY
  WITH proj AS (
    SELECT
      count(*)::bigint AS total,
      count(*) FILTER (WHERE p.discovery_status = 'published')::bigint AS published,
      count(*) FILTER (WHERE p.discovery_status = 'hidden')::bigint AS operator_hidden
    FROM public.project_profiles p
  ),
  plat_hidden AS (
    SELECT count(*)::bigint AS c FROM public.project_network_moderation m WHERE m.is_hidden
  ),
  reviews AS (
    SELECT
      count(*) FILTER (WHERE r.status = 'verified')::bigint AS verified,
      count(*) FILTER (WHERE r.status = 'pending')::bigint AS pending
    FROM public.project_platform_reviews r
  ),
  lch AS (
    SELECT
      count(*)::bigint AS total,
      count(*) FILTER (WHERE l.launch_at IS NOT NULL)::bigint AS scheduled,
      count(*) FILTER (WHERE l.contract_registered_at IS NOT NULL)::bigint AS contracts
    FROM public.launches l
  ),
  lch_status AS (
    SELECT COALESCE(jsonb_object_agg(s.status, s.c), '{}'::jsonb) AS j
    FROM (SELECT l.status, count(*)::bigint AS c FROM public.launches l GROUP BY l.status) s
  ),
  subs AS (
    SELECT
      count(*) FILTER (WHERE s.is_active)::bigint AS active,
      count(*) FILTER (WHERE NOT s.is_active)::bigint AS stopped,
      count(*) FILTER (WHERE s.is_active AND s.reminders_enabled)::bigint AS rem_on,
      count(*) FILTER (WHERE s.is_active AND NOT s.reminders_enabled)::bigint AS rem_off,
      count(DISTINCT s.launch_id) FILTER (WHERE s.is_active)::bigint AS launches_with_watchers,
      count(*) FILTER (WHERE s.subscribed_at >= now() - interval '7 days')::bigint AS d7,
      count(*) FILTER (WHERE s.subscribed_at >= now() - interval '30 days')::bigint AS d30
    FROM public.launch_watch_subscriptions s
  ),
  evts AS (
    SELECT count(*)::bigint AS c FROM public.launch_events e
  ),
  dlv AS (
    SELECT
      count(*) FILTER (WHERE d.status = 'sent')::bigint AS sent,
      count(*) FILTER (WHERE d.status IN ('pending','processing','retry'))::bigint AS pending,
      count(*) FILTER (WHERE d.status = 'failed')::bigint AS failed,
      count(*) FILTER (WHERE d.attempt_count > 1)::bigint AS retried
    FROM public.launch_notification_deliveries d
  ),
  dlv_status AS (
    SELECT COALESCE(jsonb_object_agg(x.status, x.c), '{}'::jsonb) AS j
    FROM (SELECT d.status, count(*)::bigint AS c FROM public.launch_notification_deliveries d GROUP BY d.status) x
  ),
  groups AS (
    SELECT count(*)::bigint AS c FROM public.telegram_group_connections g WHERE g.bot_is_admin
  ),
  settings AS (
    SELECT
      count(*) FILTER (WHERE cs.welcome_enabled)::bigint AS welcomes,
      count(*) FILTER (WHERE cs.launch_watch_cta_enabled)::bigint AS ctas
    FROM public.telegram_community_settings cs
    JOIN public.telegram_group_connections g ON g.id = cs.group_connection_id AND g.bot_is_admin
  ),
  per AS (
    SELECT COALESCE(jsonb_agg(t.obj ORDER BY t.active_watchers DESC, t.created_at DESC), '[]'::jsonb) AS j
    FROM (
      SELECT
        l.created_at,
        COALESCE(aw.c, 0)::bigint AS active_watchers,
        jsonb_build_object(
          'launch_public_slug', l.public_slug,
          'project_public_slug', pp.public_slug,
          'project_name', pp.project_name,
          'token_name', l.token_name,
          'ticker', l.ticker,
          'chain', l.chain,
          'status', l.status,
          'launch_at', l.launch_at,
          'active_watchers', COALESCE(aw.c, 0),
          'muted_watchers', COALESCE(aw.muted, 0),
          'events_total', COALESCE(ev.c, 0),
          'deliveries_sent', COALESCE(dd.sent, 0),
          'deliveries_pending', COALESCE(dd.pending, 0),
          'deliveries_failed', COALESCE(dd.failed, 0)
        ) AS obj
      FROM public.launches l
      JOIN public.project_profiles pp ON pp.id = l.project_profile_id
      LEFT JOIN (
        SELECT s.launch_id,
               count(*)::bigint AS c,
               count(*) FILTER (WHERE NOT s.reminders_enabled)::bigint AS muted
        FROM public.launch_watch_subscriptions s WHERE s.is_active GROUP BY s.launch_id
      ) aw ON aw.launch_id = l.id
      LEFT JOIN (
        SELECT e.launch_id, count(*)::bigint AS c FROM public.launch_events e GROUP BY e.launch_id
      ) ev ON ev.launch_id = l.id
      LEFT JOIN (
        SELECT d.launch_id,
               count(*) FILTER (WHERE d.status = 'sent')::bigint AS sent,
               count(*) FILTER (WHERE d.status IN ('pending','processing','retry'))::bigint AS pending,
               count(*) FILTER (WHERE d.status = 'failed')::bigint AS failed
        FROM public.launch_notification_deliveries d GROUP BY d.launch_id
      ) dd ON dd.launch_id = l.id
      ORDER BY COALESCE(aw.c, 0) DESC, l.created_at DESC
      LIMIT 50
    ) t
  )
  SELECT
    proj.total, proj.published, proj.operator_hidden, plat_hidden.c, reviews.verified, reviews.pending,
    lch.total, lch.scheduled, lch.contracts, lch_status.j,
    subs.active, subs.stopped, subs.rem_on, subs.rem_off, subs.launches_with_watchers, subs.d7, subs.d30,
    evts.c, dlv.sent, dlv.pending, dlv.failed, dlv.retried, dlv_status.j,
    groups.c, settings.welcomes, settings.ctas,
    per.j
  FROM proj, plat_hidden, reviews, lch, lch_status, subs, evts, dlv, dlv_status, groups, settings, per;
END;
$$;

REVOKE ALL ON FUNCTION public.get_platform_launch_analytics() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.get_platform_launch_analytics() FROM anon;
GRANT EXECUTE ON FUNCTION public.get_platform_launch_analytics() TO authenticated;