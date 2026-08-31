-- Phase 8A reconciliation: evolve the private review record into the canonical
-- project verification state machine. No parallel model, no auto-verification.

ALTER TABLE public.project_platform_reviews
  ADD COLUMN status text NOT NULL DEFAULT 'verified',
  ADD COLUMN requested_at timestamptz,
  ADD COLUMN internal_note text,
  ADD COLUMN updated_at timestamptz NOT NULL DEFAULT now();

ALTER TABLE public.project_platform_reviews
  ALTER COLUMN reviewed_at DROP NOT NULL,
  ALTER COLUMN reviewed_at DROP DEFAULT,
  ALTER COLUMN reviewed_by DROP NOT NULL,
  ALTER COLUMN status DROP DEFAULT;

ALTER TABLE public.project_platform_reviews
  ADD CONSTRAINT project_platform_reviews_status_check
  CHECK (status IN ('pending', 'verified', 'rejected', 'revoked'));

REVOKE ALL ON public.project_platform_reviews FROM PUBLIC;
REVOKE ALL ON public.project_platform_reviews FROM anon;
REVOKE ALL ON public.project_platform_reviews FROM authenticated;
GRANT ALL ON public.project_platform_reviews TO service_role;

-- Stale protection: a material identity/official-link change invalidates both an
-- in-flight request and an existing verification. Rejected/revoked history stays.
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
     WHERE r.project_profile_id = NEW.id
       AND r.status IN ('pending', 'verified');
  END IF;
  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION public.clear_project_platform_review_on_identity_change() FROM PUBLIC;

-- ---------------------------------------------------------------------------
-- Workspace-scoped verification state (no internal note, no reviewer identity)
-- ---------------------------------------------------------------------------
DROP FUNCTION IF EXISTS public.get_project_verification_state(uuid);
CREATE FUNCTION public.get_project_verification_state(_project_profile_id uuid)
RETURNS TABLE(
  project_authenticated boolean,
  verification_status text,
  requested_at timestamptz,
  verified_at timestamptz,
  reviewed_at timestamptz
)
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $$
  SELECT
    true AS project_authenticated,
    COALESCE(r.status, 'unverified') AS verification_status,
    r.requested_at,
    CASE WHEN r.status = 'verified' THEN r.reviewed_at END AS verified_at,
    r.reviewed_at
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

-- ---------------------------------------------------------------------------
-- Operator request (never able to set 'verified')
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.request_project_verification(_project_profile_id uuid)
RETURNS TABLE(verification_status text, requested_at timestamptz)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  p public.project_profiles%ROWTYPE;
  v_current text;
  v_requested timestamptz;
BEGIN
  SELECT * INTO p FROM public.project_profiles WHERE id = _project_profile_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'project profile not found' USING ERRCODE = 'P0002';
  END IF;

  IF NOT public.is_workspace_member(p.workspace_id, auth.uid()) THEN
    RAISE EXCEPTION 'not authorized' USING ERRCODE = '42501';
  END IF;

  IF p.discovery_status <> 'published' THEN
    RAISE EXCEPTION 'Publish the project profile before requesting verification.'
      USING ERRCODE = '22023';
  END IF;

  IF COALESCE(btrim(p.project_name), '') = ''
     OR COALESCE(btrim(p.public_slug), '') = ''
     OR COALESCE(btrim(p.primary_chain), '') = '' THEN
    RAISE EXCEPTION 'Project name, public slug and primary chain are required before requesting verification.'
      USING ERRCODE = '22023';
  END IF;

  IF COALESCE(btrim(p.website_url), '') = ''
     AND COALESCE(btrim(p.telegram_url), '') = ''
     AND COALESCE(btrim(p.x_url), '') = '' THEN
    RAISE EXCEPTION 'Add at least one official link (website, Telegram or X) before requesting verification.'
      USING ERRCODE = '22023';
  END IF;

  SELECT r.status INTO v_current
    FROM public.project_platform_reviews r
   WHERE r.project_profile_id = _project_profile_id;

  IF v_current = 'pending' THEN
    RAISE EXCEPTION 'A verification request is already pending review.' USING ERRCODE = '22023';
  END IF;

  IF v_current = 'verified' THEN
    RAISE EXCEPTION 'This project is already verified.' USING ERRCODE = '22023';
  END IF;

  INSERT INTO public.project_platform_reviews AS r
    (project_profile_id, status, requested_at, reviewed_at, reviewed_by, internal_note, updated_at)
  VALUES
    (_project_profile_id, 'pending', now(), NULL, NULL, NULL, now())
  ON CONFLICT (project_profile_id) DO UPDATE
    SET status = 'pending',
        requested_at = now(),
        reviewed_at = NULL,
        reviewed_by = NULL,
        internal_note = NULL,
        updated_at = now()
  RETURNING r.requested_at INTO v_requested;

  RETURN QUERY SELECT 'pending'::text, v_requested;
END;
$$;

REVOKE ALL ON FUNCTION public.request_project_verification(uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.request_project_verification(uuid) FROM anon;
GRANT EXECUTE ON FUNCTION public.request_project_verification(uuid) TO authenticated;

-- ---------------------------------------------------------------------------
-- Owner review directory
-- ---------------------------------------------------------------------------
DROP FUNCTION IF EXISTS public.get_platform_project_verifications();
CREATE FUNCTION public.get_platform_project_verifications()
RETURNS TABLE(
  project_profile_id uuid,
  project_name text,
  public_slug text,
  ticker text,
  primary_chain text,
  discovery_status text,
  workspace_name text,
  website_url text,
  telegram_url text,
  x_url text,
  verification_status text,
  requested_at timestamptz,
  reviewed_at timestamptz,
  verified_at timestamptz,
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
    p.website_url,
    p.telegram_url,
    p.x_url,
    COALESCE(r.status, 'unverified'),
    r.requested_at,
    r.reviewed_at,
    CASE WHEN r.status = 'verified' THEN r.reviewed_at END,
    p.updated_at
  FROM public.project_profiles p
  JOIN public.workspaces w ON w.id = p.workspace_id
  LEFT JOIN public.project_platform_reviews r ON r.project_profile_id = p.id
  ORDER BY
    CASE WHEN r.status = 'pending' THEN 0 ELSE 1 END,
    r.requested_at ASC NULLS LAST,
    p.project_name ASC,
    p.public_slug ASC;
END;
$$;

REVOKE ALL ON FUNCTION public.get_platform_project_verifications() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.get_platform_project_verifications() FROM anon;
GRANT EXECUTE ON FUNCTION public.get_platform_project_verifications() TO authenticated;

-- ---------------------------------------------------------------------------
-- Owner review action (verify / reject / revoke) replaces the boolean setter
-- ---------------------------------------------------------------------------
DROP FUNCTION IF EXISTS public.set_project_platform_review(uuid, boolean);

CREATE OR REPLACE FUNCTION public.review_project_verification(
  _project_profile_id uuid,
  _action text,
  _internal_note text DEFAULT NULL
)
RETURNS TABLE(verification_status text, verified_at timestamptz, reviewed_at timestamptz)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_current text;
  v_requested timestamptz;
  v_new text;
  v_reviewed_at timestamptz;
  v_note text := nullif(btrim(coalesce(_internal_note, '')), '');
BEGIN
  IF NOT public.is_platform_owner(auth.uid()) THEN
    RAISE EXCEPTION 'not authorized' USING ERRCODE = '42501';
  END IF;

  IF _action NOT IN ('verify', 'reject', 'revoke') THEN
    RAISE EXCEPTION 'unsupported verification action' USING ERRCODE = '22023';
  END IF;

  IF NOT EXISTS (SELECT 1 FROM public.project_profiles p WHERE p.id = _project_profile_id) THEN
    RAISE EXCEPTION 'project profile not found' USING ERRCODE = 'P0002';
  END IF;

  SELECT r.status, r.requested_at INTO v_current, v_requested
    FROM public.project_platform_reviews r
   WHERE r.project_profile_id = _project_profile_id;

  IF _action = 'reject' AND COALESCE(v_current, 'unverified') <> 'pending' THEN
    RAISE EXCEPTION 'Only a pending verification request can be rejected.' USING ERRCODE = '22023';
  END IF;

  IF _action = 'revoke' AND COALESCE(v_current, 'unverified') <> 'verified' THEN
    RAISE EXCEPTION 'Only a verified project can be revoked.' USING ERRCODE = '22023';
  END IF;

  IF _action = 'verify' AND COALESCE(v_current, 'unverified') = 'verified' THEN
    RAISE EXCEPTION 'This project is already verified.' USING ERRCODE = '22023';
  END IF;

  v_new := CASE _action
             WHEN 'verify' THEN 'verified'
             WHEN 'reject' THEN 'rejected'
             ELSE 'revoked'
           END;

  INSERT INTO public.project_platform_reviews AS r
    (project_profile_id, status, requested_at, reviewed_at, reviewed_by, internal_note, updated_at)
  VALUES
    (_project_profile_id, v_new, v_requested, now(), auth.uid(), v_note, now())
  ON CONFLICT (project_profile_id) DO UPDATE
    SET status = v_new,
        reviewed_at = now(),
        reviewed_by = auth.uid(),
        internal_note = v_note,
        updated_at = now()
  RETURNING r.reviewed_at INTO v_reviewed_at;

  RETURN QUERY
  SELECT v_new,
         CASE WHEN v_new = 'verified' THEN v_reviewed_at END,
         v_reviewed_at;
END;
$$;

REVOKE ALL ON FUNCTION public.review_project_verification(uuid, text, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.review_project_verification(uuid, text, text) FROM anon;
GRANT EXECUTE ON FUNCTION public.review_project_verification(uuid, text, text) TO authenticated;

-- ---------------------------------------------------------------------------
-- Public read model: verification_status ('verified' | 'unverified') + verified_at
-- ---------------------------------------------------------------------------

DROP FUNCTION public.get_cartel_network_project(text);
CREATE FUNCTION public.get_cartel_network_project(_slug text)
RETURNS TABLE(public_slug text, project_name text, ticker text, primary_chain text, description text, website_url text, telegram_url text, x_url text, has_logo boolean, verification_status text, verified_at timestamptz)
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
     and p.public_slug = lower(btrim(_slug))
   limit 1;
$function$;
REVOKE ALL ON FUNCTION public.get_cartel_network_project(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_cartel_network_project(text) TO anon, authenticated, service_role;

DROP FUNCTION public.get_cartel_network_projects(text, text, integer, integer);
CREATE FUNCTION public.get_cartel_network_projects(_search text DEFAULT NULL::text, _chain text DEFAULT NULL::text, _limit integer DEFAULT 24, _offset integer DEFAULT 0, _verified_only boolean DEFAULT false)
RETURNS TABLE(public_slug text, project_name text, ticker text, primary_chain text, description text, website_url text, telegram_url text, x_url text, has_logo boolean, current_launch_slug text, current_launch_token_name text, current_launch_ticker text, current_launch_chain text, current_launch_status text, current_launch_at timestamp with time zone, current_launch_window_start timestamp with time zone, current_launch_window_end timestamp with time zone, current_launch_timezone text, verification_status text, verified_at timestamptz, total_count bigint)
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
REVOKE ALL ON FUNCTION public.get_cartel_network_projects(text, text, integer, integer, boolean) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_cartel_network_projects(text, text, integer, integer, boolean) TO anon, authenticated, service_role;

DROP FUNCTION public.get_cartel_network_launch(text);
CREATE FUNCTION public.get_cartel_network_launch(_slug text)
RETURNS TABLE(public_slug text, token_name text, ticker text, chain text, status text, launch_at timestamp with time zone, launch_window_start timestamp with time zone, launch_window_end timestamp with time zone, timezone text, official_contract_address text, contract_registered_at timestamp with time zone, announced_at timestamp with time zone, watchlist_opened_at timestamp with time zone, launch_approaching_at timestamp with time zone, contract_pending_at timestamp with time zone, live_at timestamp with time zone, completed_at timestamp with time zone, join_launch_watch_url text, project_public_slug text, project_name text, project_ticker text, project_primary_chain text, project_description text, website_url text, telegram_url text, x_url text, has_logo boolean, verification_status text, verified_at timestamptz)
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
    and l.status <> 'DRAFT'
    and l.public_slug = lower(btrim(_slug))
  limit 1;
$function$;
REVOKE ALL ON FUNCTION public.get_cartel_network_launch(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_cartel_network_launch(text) TO anon, authenticated, service_role;

DROP FUNCTION public.get_cartel_network_upcoming_launches(text, text, integer, integer);
CREATE FUNCTION public.get_cartel_network_upcoming_launches(_search text DEFAULT NULL::text, _chain text DEFAULT NULL::text, _limit integer DEFAULT 24, _offset integer DEFAULT 0)
RETURNS TABLE(public_slug text, token_name text, ticker text, chain text, status text, launch_at timestamp with time zone, launch_window_start timestamp with time zone, launch_window_end timestamp with time zone, timezone text, announced_at timestamp with time zone, watchlist_opened_at timestamp with time zone, join_launch_watch_url text, project_public_slug text, project_name text, project_ticker text, project_primary_chain text, has_logo boolean, verification_status text, verified_at timestamptz, total_count bigint)
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
REVOKE ALL ON FUNCTION public.get_cartel_network_upcoming_launches(text, text, integer, integer) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_cartel_network_upcoming_launches(text, text, integer, integer) TO anon, authenticated, service_role;