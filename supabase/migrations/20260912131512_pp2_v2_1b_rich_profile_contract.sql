alter table public.project_profiles
  add column if not exists tagline varchar(140),
  add column if not exists about_long varchar(6000),
  add column if not exists highlights varchar(120)[],
  add column if not exists docs_url varchar(500),
  add column if not exists github_url varchar(500);

alter table public.project_profiles
  drop constraint if exists project_profiles_highlights_count,
  add constraint project_profiles_highlights_count
    check (highlights is null or cardinality(highlights) <= 6);

create table public.project_profile_videos (
  id uuid primary key default gen_random_uuid(),
  project_profile_id uuid not null references public.project_profiles(id) on delete cascade,
  youtube_video_id varchar(11) not null,
  title varchar(120),
  position smallint not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint project_profile_videos_youtube_id_format
    check (youtube_video_id ~ '^[A-Za-z0-9_-]{11}$'),
  constraint project_profile_videos_position_range
    check (position between 0 and 5),
  constraint project_profile_videos_profile_video_unique
    unique (project_profile_id, youtube_video_id),
  constraint project_profile_videos_profile_position_unique
    unique (project_profile_id, position)
);

alter table public.project_profile_videos enable row level security;

revoke all on table public.project_profile_videos from public, anon, authenticated, service_role;
grant select, insert, update, delete on table public.project_profile_videos to authenticated;
grant all on table public.project_profile_videos to service_role;

create policy project_profile_videos_select_member
on public.project_profile_videos
for select
to authenticated
using (
  exists (
    select 1
    from public.project_profiles p
    where p.id = project_profile_videos.project_profile_id
      and public.is_workspace_member(p.workspace_id, (select auth.uid()))
  )
);

create policy project_profile_videos_insert_member
on public.project_profile_videos
for insert
to authenticated
with check (
  exists (
    select 1
    from public.project_profiles p
    where p.id = project_profile_videos.project_profile_id
      and public.is_workspace_member(p.workspace_id, (select auth.uid()))
  )
);

create policy project_profile_videos_update_member
on public.project_profile_videos
for update
to authenticated
using (
  exists (
    select 1
    from public.project_profiles p
    where p.id = project_profile_videos.project_profile_id
      and public.is_workspace_member(p.workspace_id, (select auth.uid()))
  )
)
with check (
  exists (
    select 1
    from public.project_profiles p
    where p.id = project_profile_videos.project_profile_id
      and public.is_workspace_member(p.workspace_id, (select auth.uid()))
  )
);

create policy project_profile_videos_delete_member
on public.project_profile_videos
for delete
to authenticated
using (
  exists (
    select 1
    from public.project_profiles p
    where p.id = project_profile_videos.project_profile_id
      and public.is_workspace_member(p.workspace_id, (select auth.uid()))
  )
);

create trigger project_profile_videos_set_updated_at
before update on public.project_profile_videos
for each row execute function public.set_updated_at();

create or replace function public.clear_project_platform_review_on_identity_change()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $$
begin
  if (new.public_slug   is distinct from old.public_slug)
  or (new.project_name  is distinct from old.project_name)
  or (new.ticker        is distinct from old.ticker)
  or (new.primary_chain is distinct from old.primary_chain)
  or (new.description   is distinct from old.description)
  or (new.logo_asset_id is distinct from old.logo_asset_id)
  or (new.website_url   is distinct from old.website_url)
  or (new.telegram_url  is distinct from old.telegram_url)
  or (new.x_url         is distinct from old.x_url)
  or (new.tagline       is distinct from old.tagline)
  or (new.about_long    is distinct from old.about_long)
  or (new.highlights    is distinct from old.highlights)
  or (new.docs_url      is distinct from old.docs_url)
  or (new.github_url    is distinct from old.github_url)
  then
    delete from public.project_platform_reviews r
    where r.project_profile_id = new.id
      and r.status in ('pending', 'verified');
  end if;
  return new;
end;
$$;

drop function public.get_cartel_network_project(text);

create function public.get_cartel_network_project(_slug text)
returns table(
  public_slug text,
  project_name text,
  ticker text,
  primary_chain text,
  description text,
  tagline text,
  about_long text,
  highlights text[],
  website_url text,
  telegram_url text,
  x_url text,
  docs_url text,
  github_url text,
  has_logo boolean,
  verification_status text,
  verified_at timestamptz
)
language sql
stable
security definer
set search_path to 'public'
as $$
  select
    p.public_slug,
    p.project_name,
    p.ticker,
    p.primary_chain,
    p.description,
    p.tagline::text,
    p.about_long::text,
    p.highlights::text[],
    p.website_url,
    p.telegram_url,
    p.x_url,
    p.docs_url::text,
    p.github_url::text,
    (p.logo_asset_id is not null) as has_logo,
    case when r.status = 'verified' then 'verified' else 'unverified' end as verification_status,
    case when r.status = 'verified' then r.reviewed_at end as verified_at
  from public.project_profiles p
  left join public.project_platform_reviews r on r.project_profile_id = p.id
  where p.discovery_status = 'published'
    and not exists (
      select 1 from public.project_network_moderation m
      where m.project_profile_id = p.id and m.is_hidden
    )
    and p.public_slug = lower(btrim(_slug))
  limit 1;
$$;

revoke all on function public.get_cartel_network_project(text) from public, anon, authenticated, service_role;
grant execute on function public.get_cartel_network_project(text) to anon, authenticated, service_role;

create function public.get_cartel_network_project_videos(_project_slug text)
returns table(
  youtube_video_id text,
  title text,
  "position" integer
)
language sql
stable
security definer
set search_path to 'public'
as $$
  select
    v.youtube_video_id::text,
    v.title::text,
    v.position::integer
  from public.project_profile_videos v
  join public.project_profiles p on p.id = v.project_profile_id
  where p.discovery_status = 'published'
    and not exists (
      select 1 from public.project_network_moderation m
      where m.project_profile_id = p.id and m.is_hidden
    )
    and p.public_slug = lower(btrim(_project_slug))
  order by v.position asc, v.created_at asc, v.id asc;
$$;

revoke all on function public.get_cartel_network_project_videos(text) from public, anon, authenticated, service_role;
grant execute on function public.get_cartel_network_project_videos(text) to anon, authenticated, service_role;