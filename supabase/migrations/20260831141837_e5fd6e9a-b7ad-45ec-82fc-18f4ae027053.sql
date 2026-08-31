-- Phase 8A: layered trust signals (Platform Reviewed)

CREATE TABLE public.project_platform_reviews (
  project_profile_id uuid PRIMARY KEY REFERENCES public.project_profiles(id) ON DELETE CASCADE,
  reviewed_at timestamptz NOT NULL DEFAULT now(),
  reviewed_by uuid NOT NULL
);

REVOKE ALL ON public.project_platform_reviews FROM PUBLIC;
REVOKE ALL ON public.project_platform_reviews FROM anon;
REVOKE ALL ON public.project_platform_reviews FROM authenticated;
GRANT ALL ON public.project_platform_reviews TO service_role;

ALTER TABLE public.project_platform_reviews ENABLE ROW LEVEL SECURITY;

-- Stale-review protection: clear review when material identity changes.
CREATE OR REPLACE FUNCTION public.clear_project_platform_review_on_identity_change()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
BEGIN
  IF (NEW.public_slug     IS DISTINCT FROM OLD.public_slug)
  OR (NEW.project_name    IS DISTINCT FROM OLD.project_name)
  OR (NEW.ticker          IS DISTINCT FROM OLD.ticker)
  OR (NEW.primary_chain   IS DISTINCT FROM OLD.primary_chain)
  OR (NEW.description     IS DISTINCT FROM OLD.description)
  OR (NEW.logo_asset_id   IS DISTINCT FROM OLD.logo_asset_id)
  OR (NEW.website_url     IS DISTINCT FROM OLD.website_url)
  OR (NEW.telegram_url    IS DISTINCT FROM OLD.telegram_url)
  OR (NEW.x_url           IS DISTINCT FROM OLD.x_url)
  THEN
    DELETE FROM public.project_platform_reviews r
     WHERE r.project_profile_id = NEW.id;
  END IF;
  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION public.clear_project_platform_review_on_identity_change() FROM PUBLIC;

CREATE TRIGGER project_profiles_clear_platform_review
AFTER UPDATE ON public.project_profiles
FOR EACH ROW
EXECUTE FUNCTION public.clear_project_platform_review_on_identity_change();

-- RPC A: workspace-scoped verification state
CREATE OR REPLACE FUNCTION public.get_project_verification_state(_project_profile_id uuid)
RETURNS TABLE(project_authenticated boolean, platform_reviewed boolean, platform_reviewed_at timestamptz)
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $$
  SELECT
    true AS project_authenticated,
    (r.project_profile_id IS NOT NULL) AS platform_reviewed,
    r.reviewed_at AS platform_reviewed_at
  FROM public.project_profiles p
  LEFT JOIN public.project_platform_reviews r ON r.project_profile_id = p.id
  WHERE p.id = _project_profile_id
    AND (
      public.is_workspace_member(p.workspace_id, auth.uid())
      OR public.is_platform_owner(auth.uid())
    )
  LIMIT 1;
$$;

REVOKE ALL ON FUNCTION public.get_project_verification_state(uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.get_project_verification_state(uuid) FROM anon;
GRANT EXECUTE ON FUNCTION public.get_project_verification_state(uuid) TO authenticated;

-- RPC B: owner review directory
CREATE OR REPLACE FUNCTION public.get_platform_project_verifications()
RETURNS TABLE(
  project_profile_id uuid,
  project_name text,
  public_slug text,
  ticker text,
  primary_chain text,
  discovery_status text,
  workspace_name text,
  platform_reviewed boolean,
  platform_reviewed_at timestamptz,
  profile_updated_at timestamptz
)
LANGUAGE plpgsql
STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $$
BEGIN
  IF NOT public.is_platform_owner(auth.uid()) THEN
    RAISE EXCEPTION 'not authorized' USING ERRCODE = '42501';
  END IF;

  RETURN QUERY
  SELECT
    p.id,
    p.project_name,
    p.public_slug,
    p.ticker,
    p.primary_chain,
    p.discovery_status,
    w.name,
    (r.project_profile_id IS NOT NULL),
    r.reviewed_at,
    p.updated_at
  FROM public.project_profiles p
  JOIN public.workspaces w ON w.id = p.workspace_id
  LEFT JOIN public.project_platform_reviews r ON r.project_profile_id = p.id
  ORDER BY p.project_name ASC, p.public_slug ASC;
END;
$$;

REVOKE ALL ON FUNCTION public.get_platform_project_verifications() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.get_platform_project_verifications() FROM anon;
GRANT EXECUTE ON FUNCTION public.get_platform_project_verifications() TO authenticated;

-- RPC C: owner set/revoke review
CREATE OR REPLACE FUNCTION public.set_project_platform_review(_project_profile_id uuid, _reviewed boolean)
RETURNS TABLE(platform_reviewed boolean, platform_reviewed_at timestamptz)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_reviewed_at timestamptz;
BEGIN
  IF NOT public.is_platform_owner(auth.uid()) THEN
    RAISE EXCEPTION 'not authorized' USING ERRCODE = '42501';
  END IF;

  IF NOT EXISTS (SELECT 1 FROM public.project_profiles p WHERE p.id = _project_profile_id) THEN
    RAISE EXCEPTION 'project profile not found' USING ERRCODE = 'P0002';
  END IF;

  IF _reviewed IS TRUE THEN
    INSERT INTO public.project_platform_reviews AS r (project_profile_id, reviewed_at, reviewed_by)
    VALUES (_project_profile_id, now(), auth.uid())
    ON CONFLICT (project_profile_id)
    DO UPDATE SET reviewed_at = now(), reviewed_by = auth.uid()
    RETURNING r.reviewed_at INTO v_reviewed_at;

    RETURN QUERY SELECT true, v_reviewed_at;
  ELSE
    DELETE FROM public.project_platform_reviews r WHERE r.project_profile_id = _project_profile_id;
    RETURN QUERY SELECT false, NULL::timestamptz;
  END IF;
END;
$$;

REVOKE ALL ON FUNCTION public.set_project_platform_review(uuid, boolean) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.set_project_platform_review(uuid, boolean) FROM anon;
GRANT EXECUTE ON FUNCTION public.set_project_platform_review(uuid, boolean) TO authenticated;

-- Public read model: add platform_reviewed / platform_reviewed_at

DROP FUNCTION public.get_cartel_network_project(text);
CREATE FUNCTION public.get_cartel_network_project(_slug text)
RETURNS TABLE(public_slug text, project_name text, ticker text, primary_chain text, description text, website_url text, telegram_url text, x_url text, has_logo boolean, platform_reviewed boolean, platform_reviewed_at timestamptz)
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $function$
  select p.public_slug, p.project_name, p.ticker, p.primary_chain, p.description,
         p.website_url, p.telegram_url, p.x_url, (p.logo_asset_id is not null) as has_logo,
         (r.project_profile_id is not null) as platform_reviewed,
         r.reviewed_at as platform_reviewed_at
    from public.project_profiles p
    left join public.project_platform_reviews r on r.project_profile_id = p.id
   where p.discovery_status = 'published'
     and p.public_slug = lower(btrim(_slug))
   limit 1;
$function$;
REVOKE ALL ON FUNCTION public.get_cartel_network_project(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_cartel_network_project(text) TO anon, authenticated, service_role;

DROP FUNCTION public.get_cartel_network_projects(text, text, integer, integer);
CREATE FUNCTION public.get_cartel_network_projects(_search text DEFAULT NULL::text, _chain text DEFAULT NULL::text, _limit integer DEFAULT 24, _offset integer DEFAULT 0)
RETURNS TABLE(public_slug text, project_name text, ticker text, primary_chain text, description text, website_url text, telegram_url text, x_url text, has_logo boolean, current_launch_slug text, current_launch_token_name text, current_launch_ticker text, current_launch_chain text, current_launch_status text, current_launch_at timestamp with time zone, current_launch_window_start timestamp with time zone, current_launch_window_end timestamp with time zone, current_launch_timezone text, platform_reviewed boolean, platform_reviewed_at timestamptz, total_count bigint)
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $function$
  with params as (
    select
      nullif(left(btrim(coalesce(_search, '')), 120), '') as search_term,
      nullif(left(btrim(coalesce(_chain, '')), 64), '') as chain_term
  ), filtered as (
    select
      p.public_slug,
      p.project_name,
      p.ticker,
      p.primary_chain,
      p.description,
      p.website_url,
      p.telegram_url,
      p.x_url,
      (p.logo_asset_id is not null) as has_logo,
      cl.public_slug as current_launch_slug,
      cl.token_name as current_launch_token_name,
      cl.ticker as current_launch_ticker,
      cl.chain as current_launch_chain,
      cl.status as current_launch_status,
      cl.launch_at as current_launch_at,
      cl.launch_window_start as current_launch_window_start,
      cl.launch_window_end as current_launch_window_end,
      cl.timezone as current_launch_timezone,
      (r.project_profile_id is not null) as platform_reviewed,
      r.reviewed_at as platform_reviewed_at,
      p.updated_at
    from public.project_profiles p
    cross join params x
    left join public.project_platform_reviews r on r.project_profile_id = p.id
    left join lateral (
      select l.public_slug, l.token_name, l.ticker, l.chain, l.status,
             l.launch_at, l.launch_window_start, l.launch_window_end, l.timezone
        from public.launches l
       where l.project_profile_id = p.id
         and l.status <> 'DRAFT'
       order by (l.status <> 'COMPLETED') desc, l.updated_at desc, l.created_at desc, l.id desc
       limit 1
    ) cl on true
    where p.discovery_status = 'published'
      and (
        x.search_term is null
        or p.project_name ilike '%' || x.search_term || '%'
        or coalesce(p.ticker, '') ilike '%' || x.search_term || '%'
        or coalesce(p.description, '') ilike '%' || x.search_term || '%'
      )
      and (
        x.chain_term is null
        or lower(coalesce(p.primary_chain, '')) = lower(x.chain_term)
      )
  )
  select
    f.public_slug, f.project_name, f.ticker, f.primary_chain, f.description,
    f.website_url, f.telegram_url, f.x_url, f.has_logo,
    f.current_launch_slug, f.current_launch_token_name, f.current_launch_ticker,
    f.current_launch_chain, f.current_launch_status, f.current_launch_at,
    f.current_launch_window_start, f.current_launch_window_end,
    f.current_launch_timezone,
    f.platform_reviewed, f.platform_reviewed_at,
    count(*) over()::bigint as total_count
  from filtered f
  order by f.updated_at desc, f.project_name asc
  limit greatest(1, least(coalesce(_limit, 24), 50))
  offset greatest(0, coalesce(_offset, 0));
$function$;
REVOKE ALL ON FUNCTION public.get_cartel_network_projects(text, text, integer, integer) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_cartel_network_projects(text, text, integer, integer) TO anon, authenticated, service_role;

DROP FUNCTION public.get_cartel_network_launch(text);
CREATE FUNCTION public.get_cartel_network_launch(_slug text)
RETURNS TABLE(public_slug text, token_name text, ticker text, chain text, status text, launch_at timestamp with time zone, launch_window_start timestamp with time zone, launch_window_end timestamp with time zone, timezone text, official_contract_address text, contract_registered_at timestamp with time zone, announced_at timestamp with time zone, watchlist_opened_at timestamp with time zone, launch_approaching_at timestamp with time zone, contract_pending_at timestamp with time zone, live_at timestamp with time zone, completed_at timestamp with time zone, join_launch_watch_url text, project_public_slug text, project_name text, project_ticker text, project_primary_chain text, project_description text, website_url text, telegram_url text, x_url text, has_logo boolean, platform_reviewed boolean, platform_reviewed_at timestamptz)
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $function$
  select
    l.public_slug, l.token_name, l.ticker, l.chain, l.status,
    l.launch_at, l.launch_window_start, l.launch_window_end, l.timezone,
    case when l.contract_registered_at is not null
               and l.status = any(array['OFFICIAL_CONTRACT_REGISTERED','LIVE','COMPLETED'])
         then l.official_contract_address else null end,
    case when l.contract_registered_at is not null
               and l.status = any(array['OFFICIAL_CONTRACT_REGISTERED','LIVE','COMPLETED'])
         then l.contract_registered_at else null end,
    l.announced_at, l.watchlist_opened_at, l.launch_approaching_at,
    l.contract_pending_at, l.live_at, l.completed_at,
    case when l.status = any(array['WATCHLIST_OPEN','LAUNCH_APPROACHING','CONTRACT_PENDING','OFFICIAL_CONTRACT_REGISTERED'])
               and l.launch_watch_token is not null
         then 'https://t.me/PepeCartelHQBot?start=lw_' || l.launch_watch_token else null end,
    p.public_slug, p.project_name, p.ticker, p.primary_chain, p.description,
    p.website_url, p.telegram_url, p.x_url,
    (p.logo_asset_id is not null) as has_logo,
    (r.project_profile_id is not null) as platform_reviewed,
    r.reviewed_at as platform_reviewed_at
  from public.launches l
  join public.project_profiles p on p.id = l.project_profile_id
  left join public.project_platform_reviews r on r.project_profile_id = p.id
  where p.discovery_status = 'published'
    and l.status <> 'DRAFT'
    and l.public_slug = lower(btrim(_slug))
  limit 1;
$function$;
REVOKE ALL ON FUNCTION public.get_cartel_network_launch(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_cartel_network_launch(text) TO anon, authenticated, service_role;

DROP FUNCTION public.get_cartel_network_upcoming_launches(text, text, integer, integer);
CREATE FUNCTION public.get_cartel_network_upcoming_launches(_search text DEFAULT NULL::text, _chain text DEFAULT NULL::text, _limit integer DEFAULT 24, _offset integer DEFAULT 0)
RETURNS TABLE(public_slug text, token_name text, ticker text, chain text, status text, launch_at timestamp with time zone, launch_window_start timestamp with time zone, launch_window_end timestamp with time zone, timezone text, announced_at timestamp with time zone, watchlist_opened_at timestamp with time zone, join_launch_watch_url text, project_public_slug text, project_name text, project_ticker text, project_primary_chain text, has_logo boolean, platform_reviewed boolean, platform_reviewed_at timestamptz, total_count bigint)
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $function$
  with params as (
    select
      nullif(left(btrim(coalesce(_search, '')), 120), '') as search_term,
      nullif(left(btrim(coalesce(_chain, '')), 64), '') as chain_term
  ), filtered as (
    select
      l.public_slug, l.token_name, l.ticker, l.chain, l.status,
      l.launch_at, l.launch_window_start, l.launch_window_end, l.timezone,
      l.announced_at, l.watchlist_opened_at,
      case when l.status = any(array['WATCHLIST_OPEN','LAUNCH_APPROACHING','CONTRACT_PENDING','OFFICIAL_CONTRACT_REGISTERED'])
                 and l.launch_watch_token is not null
           then 'https://t.me/PepeCartelHQBot?start=lw_' || l.launch_watch_token else null end as join_launch_watch_url,
      p.public_slug as project_public_slug, p.project_name,
      p.ticker as project_ticker, p.primary_chain as project_primary_chain,
      (p.logo_asset_id is not null) as has_logo,
      (r.project_profile_id is not null) as platform_reviewed,
      r.reviewed_at as platform_reviewed_at,
      coalesce(l.launch_at, l.launch_window_start) as sort_at,
      l.updated_at
    from public.launches l
    join public.project_profiles p on p.id = l.project_profile_id
    cross join params x
    left join public.project_platform_reviews r on r.project_profile_id = p.id
    where p.discovery_status = 'published'
      and l.status = any(array['ANNOUNCED','WATCHLIST_OPEN','LAUNCH_APPROACHING','CONTRACT_PENDING','OFFICIAL_CONTRACT_REGISTERED'])
      and (
        x.search_term is null
        or l.token_name ilike '%' || x.search_term || '%'
        or l.ticker ilike '%' || x.search_term || '%'
        or p.project_name ilike '%' || x.search_term || '%'
        or coalesce(p.ticker, '') ilike '%' || x.search_term || '%'
      )
      and (x.chain_term is null or lower(l.chain) = lower(x.chain_term))
  )
  select
    f.public_slug, f.token_name, f.ticker, f.chain, f.status,
    f.launch_at, f.launch_window_start, f.launch_window_end, f.timezone,
    f.announced_at, f.watchlist_opened_at, f.join_launch_watch_url,
    f.project_public_slug, f.project_name, f.project_ticker,
    f.project_primary_chain, f.has_logo,
    f.platform_reviewed, f.platform_reviewed_at,
    count(*) over()::bigint as total_count
  from filtered f
  order by f.sort_at asc nulls last, f.updated_at desc, f.token_name asc
  limit greatest(1, least(coalesce(_limit, 24), 50))
  offset greatest(0, coalesce(_offset, 0));
$function$;
REVOKE ALL ON FUNCTION public.get_cartel_network_upcoming_launches(text, text, integer, integer) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_cartel_network_upcoming_launches(text, text, integer, integer) TO anon, authenticated, service_role;