-- Phase 9A — service-private platform moderation override
CREATE TABLE IF NOT EXISTS public.project_network_moderation (
  project_profile_id uuid PRIMARY KEY REFERENCES public.project_profiles(id) ON DELETE CASCADE,
  is_hidden boolean NOT NULL DEFAULT false,
  internal_reason text,
  hidden_at timestamptz,
  hidden_by uuid,
  restored_at timestamptz,
  restored_by uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

REVOKE ALL ON public.project_network_moderation FROM PUBLIC;
REVOKE ALL ON public.project_network_moderation FROM anon;
REVOKE ALL ON public.project_network_moderation FROM authenticated;
GRANT ALL ON public.project_network_moderation TO service_role;

ALTER TABLE public.project_network_moderation ENABLE ROW LEVEL SECURITY;

DROP TRIGGER IF EXISTS set_project_network_moderation_updated_at ON public.project_network_moderation;
CREATE TRIGGER set_project_network_moderation_updated_at
BEFORE UPDATE ON public.project_network_moderation
FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

CREATE INDEX IF NOT EXISTS project_network_moderation_hidden_idx
  ON public.project_network_moderation (project_profile_id)
  WHERE is_hidden;

-- ---------------------------------------------------------------------------
-- RPC A — owner moderation directory
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.get_platform_network_moderation()
RETURNS TABLE(
  project_profile_id uuid,
  project_name text,
  public_slug text,
  ticker text,
  primary_chain text,
  discovery_status text,
  is_hidden boolean,
  internal_reason text,
  hidden_at timestamptz,
  restored_at timestamptz,
  verification_status text,
  launch_count bigint
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
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
    COALESCE(m.is_hidden, false),
    m.internal_reason,
    m.hidden_at,
    m.restored_at,
    CASE WHEN r.status = 'verified' THEN 'verified' ELSE COALESCE(r.status, 'unverified') END,
    (SELECT count(*) FROM public.launches l WHERE l.project_profile_id = p.id)::bigint
  FROM public.project_profiles p
  LEFT JOIN public.project_network_moderation m ON m.project_profile_id = p.id
  LEFT JOIN public.project_platform_reviews r ON r.project_profile_id = p.id
  ORDER BY COALESCE(m.is_hidden, false) DESC, p.project_name ASC, p.public_slug ASC;
END;
$function$;

REVOKE ALL ON FUNCTION public.get_platform_network_moderation() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.get_platform_network_moderation() FROM anon;
GRANT EXECUTE ON FUNCTION public.get_platform_network_moderation() TO authenticated;

-- ---------------------------------------------------------------------------
-- RPC B — owner hide / restore
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.set_project_network_moderation(
  _project_profile_id uuid,
  _hidden boolean,
  _internal_reason text DEFAULT NULL
)
RETURNS TABLE(
  project_profile_id uuid,
  is_hidden boolean,
  internal_reason text,
  hidden_at timestamptz,
  restored_at timestamptz
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_reason text := nullif(btrim(coalesce(_internal_reason, '')), '');
BEGIN
  IF NOT public.is_platform_owner(auth.uid()) THEN
    RAISE EXCEPTION 'not authorized' USING ERRCODE = '42501';
  END IF;

  IF _hidden IS NULL THEN
    RAISE EXCEPTION 'moderation state is required' USING ERRCODE = '22023';
  END IF;

  IF NOT EXISTS (SELECT 1 FROM public.project_profiles p WHERE p.id = _project_profile_id) THEN
    RAISE EXCEPTION 'project profile not found' USING ERRCODE = 'P0002';
  END IF;

  IF v_reason IS NOT NULL THEN
    v_reason := left(v_reason, 500);
  END IF;

  IF _hidden THEN
    INSERT INTO public.project_network_moderation AS m
      (project_profile_id, is_hidden, internal_reason, hidden_at, hidden_by,
       restored_at, restored_by, updated_at)
    VALUES
      (_project_profile_id, true, v_reason, now(), auth.uid(), NULL, NULL, now())
    ON CONFLICT (project_profile_id) DO UPDATE
      SET is_hidden = true,
          internal_reason = v_reason,
          hidden_at = now(),
          hidden_by = auth.uid(),
          restored_at = NULL,
          restored_by = NULL,
          updated_at = now();
  ELSE
    -- Restore preserves the moderation history row. The prior internal reason is
    -- kept unless the caller intentionally supplies a new non-empty reason.
    INSERT INTO public.project_network_moderation AS m
      (project_profile_id, is_hidden, internal_reason, restored_at, restored_by, updated_at)
    VALUES
      (_project_profile_id, false, v_reason, now(), auth.uid(), now())
    ON CONFLICT (project_profile_id) DO UPDATE
      SET is_hidden = false,
          internal_reason = COALESCE(v_reason, m.internal_reason),
          restored_at = now(),
          restored_by = auth.uid(),
          updated_at = now();
  END IF;

  RETURN QUERY
  SELECT m.project_profile_id, m.is_hidden, m.internal_reason, m.hidden_at, m.restored_at
    FROM public.project_network_moderation m
   WHERE m.project_profile_id = _project_profile_id;
END;
$function$;

REVOKE ALL ON FUNCTION public.set_project_network_moderation(uuid, boolean, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.set_project_network_moderation(uuid, boolean, text) FROM anon;
GRANT EXECUTE ON FUNCTION public.set_project_network_moderation(uuid, boolean, text) TO authenticated;

-- ---------------------------------------------------------------------------
-- Public Cartel Network RPCs — add platform-hidden suppression only
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.get_cartel_network_summary()
 RETURNS TABLE(published_projects bigint, upcoming_launches bigint, live_launches bigint)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  select
    (select count(*) from public.project_profiles p
      where p.discovery_status = 'published'
        and not exists (select 1 from public.project_network_moderation m
                         where m.project_profile_id = p.id and m.is_hidden))::bigint,
    (select count(*)
       from public.launches l
       join public.project_profiles p on p.id = l.project_profile_id
      where p.discovery_status = 'published'
        and not exists (select 1 from public.project_network_moderation m
                         where m.project_profile_id = p.id and m.is_hidden)
        and l.status = any (array['ANNOUNCED','WATCHLIST_OPEN','LAUNCH_APPROACHING','CONTRACT_PENDING','OFFICIAL_CONTRACT_REGISTERED']))::bigint,
    (select count(*)
       from public.launches l
       join public.project_profiles p on p.id = l.project_profile_id
      where p.discovery_status = 'published'
        and not exists (select 1 from public.project_network_moderation m
                         where m.project_profile_id = p.id and m.is_hidden)
        and l.status = 'LIVE')::bigint;
$function$;

CREATE OR REPLACE FUNCTION public.get_cartel_network_project(_slug text)
 RETURNS TABLE(public_slug text, project_name text, ticker text, primary_chain text, description text, website_url text, telegram_url text, x_url text, has_logo boolean, verification_status text, verified_at timestamp with time zone)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  select p.public_slug, p.project_name, p.ticker, p.primary_chain, p.description,
         p.website_url, p.telegram_url, p.x_url, (p.logo_asset_id is not null) as has_logo,
         case when r.status = 'verified' then 'verified' else 'unverified' end as verification_status,
         case when r.status = 'verified' then r.reviewed_at end as verified_at
    from public.project_profiles p
    left join public.project_platform_reviews r on r.project_profile_id = p.id
   where p.discovery_status = 'published'
     and not exists (select 1 from public.project_network_moderation m
                      where m.project_profile_id = p.id and m.is_hidden)
     and p.public_slug = lower(btrim(_slug))
   limit 1;
$function$;

CREATE OR REPLACE FUNCTION public.get_cartel_network_project_launches(_project_slug text)
 RETURNS TABLE(public_slug text, token_name text, ticker text, chain text, status text, launch_at timestamp with time zone, launch_window_start timestamp with time zone, launch_window_end timestamp with time zone, timezone text, official_contract_address text, contract_registered_at timestamp with time zone, announced_at timestamp with time zone, watchlist_opened_at timestamp with time zone, live_at timestamp with time zone, completed_at timestamp with time zone, join_launch_watch_url text)
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
    l.announced_at, l.watchlist_opened_at, l.live_at, l.completed_at,
    case when l.status = any(array['WATCHLIST_OPEN','LAUNCH_APPROACHING','CONTRACT_PENDING','OFFICIAL_CONTRACT_REGISTERED'])
               and l.launch_watch_token is not null
         then 'https://t.me/PepeCartelHQBot?start=lw_' || l.launch_watch_token else null end
  from public.launches l
  join public.project_profiles p on p.id = l.project_profile_id
  where p.discovery_status = 'published'
    and not exists (select 1 from public.project_network_moderation m
                     where m.project_profile_id = p.id and m.is_hidden)
    and p.public_slug = lower(btrim(_project_slug))
    and l.status <> 'DRAFT'
  order by (l.status <> 'COMPLETED') desc, l.updated_at desc, l.created_at desc, l.id desc;
$function$;

CREATE OR REPLACE FUNCTION public.get_cartel_network_launch(_slug text)
 RETURNS TABLE(public_slug text, token_name text, ticker text, chain text, status text, launch_at timestamp with time zone, launch_window_start timestamp with time zone, launch_window_end timestamp with time zone, timezone text, official_contract_address text, contract_registered_at timestamp with time zone, announced_at timestamp with time zone, watchlist_opened_at timestamp with time zone, launch_approaching_at timestamp with time zone, contract_pending_at timestamp with time zone, live_at timestamp with time zone, completed_at timestamp with time zone, join_launch_watch_url text, project_public_slug text, project_name text, project_ticker text, project_primary_chain text, project_description text, website_url text, telegram_url text, x_url text, has_logo boolean, verification_status text, verified_at timestamp with time zone)
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
    case when r.status = 'verified' then 'verified' else 'unverified' end as verification_status,
    case when r.status = 'verified' then r.reviewed_at end as verified_at
  from public.launches l
  join public.project_profiles p on p.id = l.project_profile_id
  left join public.project_platform_reviews r on r.project_profile_id = p.id
  where p.discovery_status = 'published'
    and not exists (select 1 from public.project_network_moderation m
                     where m.project_profile_id = p.id and m.is_hidden)
    and l.status <> 'DRAFT'
    and l.public_slug = lower(btrim(_slug))
  limit 1;
$function$;

CREATE OR REPLACE FUNCTION public.get_cartel_network_projects(_search text DEFAULT NULL::text, _chain text DEFAULT NULL::text, _limit integer DEFAULT 24, _offset integer DEFAULT 0, _verified_only boolean DEFAULT false)
 RETURNS TABLE(public_slug text, project_name text, ticker text, primary_chain text, description text, website_url text, telegram_url text, x_url text, has_logo boolean, current_launch_slug text, current_launch_token_name text, current_launch_ticker text, current_launch_chain text, current_launch_status text, current_launch_at timestamp with time zone, current_launch_window_start timestamp with time zone, current_launch_window_end timestamp with time zone, current_launch_timezone text, verification_status text, verified_at timestamp with time zone, total_count bigint)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  with params as (
    select
      nullif(left(btrim(coalesce(_search, '')), 120), '') as search_term,
      nullif(left(btrim(coalesce(_chain, '')), 64), '') as chain_term,
      coalesce(_verified_only, false) as verified_only
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
      case when r.status = 'verified' then 'verified' else 'unverified' end as verification_status,
      case when r.status = 'verified' then r.reviewed_at end as verified_at,
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
      and not exists (select 1 from public.project_network_moderation m
                       where m.project_profile_id = p.id and m.is_hidden)
      and (not x.verified_only or r.status = 'verified')
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
    f.verification_status, f.verified_at,
    count(*) over()::bigint as total_count
  from filtered f
  order by f.updated_at desc, f.project_name asc
  limit greatest(1, least(coalesce(_limit, 24), 50))
  offset greatest(0, coalesce(_offset, 0));
$function$;

CREATE OR REPLACE FUNCTION public.get_cartel_network_upcoming_launches(_search text DEFAULT NULL::text, _chain text DEFAULT NULL::text, _limit integer DEFAULT 24, _offset integer DEFAULT 0)
 RETURNS TABLE(public_slug text, token_name text, ticker text, chain text, status text, launch_at timestamp with time zone, launch_window_start timestamp with time zone, launch_window_end timestamp with time zone, timezone text, announced_at timestamp with time zone, watchlist_opened_at timestamp with time zone, join_launch_watch_url text, project_public_slug text, project_name text, project_ticker text, project_primary_chain text, has_logo boolean, verification_status text, verified_at timestamp with time zone, total_count bigint)
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
      case when r.status = 'verified' then 'verified' else 'unverified' end as verification_status,
      case when r.status = 'verified' then r.reviewed_at end as verified_at,
      coalesce(l.launch_at, l.launch_window_start) as sort_at,
      l.updated_at
    from public.launches l
    join public.project_profiles p on p.id = l.project_profile_id
    cross join params x
    left join public.project_platform_reviews r on r.project_profile_id = p.id
    where p.discovery_status = 'published'
      and not exists (select 1 from public.project_network_moderation m
                       where m.project_profile_id = p.id and m.is_hidden)
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
    f.verification_status, f.verified_at,
    count(*) over()::bigint as total_count
  from filtered f
  order by f.sort_at asc nulls last, f.updated_at desc, f.token_name asc
  limit greatest(1, least(coalesce(_limit, 24), 50))
  offset greatest(0, coalesce(_offset, 0));
$function$;

CREATE OR REPLACE FUNCTION public.get_cartel_network_signals(_chain text DEFAULT NULL::text, _limit integer DEFAULT 24, _offset integer DEFAULT 0)
 RETURNS TABLE(signal_type text, occurred_at timestamp with time zone, launch_public_slug text, token_name text, ticker text, chain text, status text, official_contract_address text, project_public_slug text, project_name text, project_primary_chain text, has_logo boolean, total_count bigint)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  with params as (
    select
      nullif(left(btrim(coalesce(_chain, '')), 64), '') as chain_filter,
      least(greatest(coalesce(_limit, 24), 1), 50) as lim,
      greatest(coalesce(_offset, 0), 0) as off
  ),
  base as (
    select l.*, p.public_slug as project_public_slug, p.project_name,
           p.primary_chain as project_primary_chain,
           (p.logo_asset_id is not null) as has_logo
    from public.launches l
    join public.project_profiles p on p.id = l.project_profile_id
    cross join params pr
    where p.discovery_status = 'published'
      and not exists (select 1 from public.project_network_moderation m
                       where m.project_profile_id = p.id and m.is_hidden)
      and l.status <> 'DRAFT'
      and (pr.chain_filter is null or lower(l.chain) = lower(pr.chain_filter))
  ),
  events as (
    select 'LAUNCH_ANNOUNCED'::text as signal_type, b.announced_at as occurred_at, b.* from base b where b.announced_at is not null
    union all
    select 'WATCHLIST_OPENED', b.watchlist_opened_at, b.* from base b where b.watchlist_opened_at is not null
    union all
    select 'OFFICIAL_CONTRACT_REGISTERED', b.contract_registered_at, b.* from base b where b.contract_registered_at is not null
    union all
    select 'LAUNCH_LIVE', b.live_at, b.* from base b where b.live_at is not null
    union all
    select 'LAUNCH_COMPLETED', b.completed_at, b.* from base b where b.completed_at is not null
  ),
  ranked as (
    select
      e.signal_type,
      e.occurred_at,
      e.public_slug as launch_public_slug,
      e.token_name,
      e.ticker,
      e.chain,
      e.status,
      case when e.contract_registered_at is not null
                 and e.status = any(array['OFFICIAL_CONTRACT_REGISTERED','LIVE','COMPLETED'])
           then e.official_contract_address else null end as official_contract_address,
      e.project_public_slug,
      e.project_name,
      e.project_primary_chain,
      e.has_logo,
      count(*) over ()::bigint as total_count
    from events e
  )
  select r.*
  from ranked r
  cross join params pr
  order by r.occurred_at desc, r.launch_public_slug asc, r.signal_type asc
  offset (select off from params)
  limit (select lim from params);
$function$;