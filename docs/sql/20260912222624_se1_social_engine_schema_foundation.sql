-- PARITY COPY ONLY - ALREADY APPLIED TO AUTHORITATIVE SUPABASE AS 20260912222624_se1_social_engine_schema_foundation - DO NOT REAPPLY BLINDLY
-- Source-of-truth for this migration is the Supabase project; this file exists only for repository audit/parity.
-- SE-1 Cartel Social Engine schema/RLS foundation only.
-- No provider calls, cron, Edge Functions, Telegram behavior, secrets, or billing.
-- NOTE: the social_mission_targets policies below are the INTERMEDIATE state. They were
-- immediately corrected by 20260912222700_se1_social_engine_target_integrity_hardening.
-- Evaluate the FINAL COMBINED state, not this file alone.

alter table public.telegram_group_connections
  add constraint telegram_group_connections_id_workspace_unique unique (id, workspace_id);

create table public.social_sources (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  platform text not null,
  source_type text not null default 'public_profile',
  canonical_url text not null,
  handle text,
  external_account_id text,
  provider_preference text,
  auto_detect_enabled boolean not null default false,
  polling_interval_seconds integer not null default 900,
  last_checked_at timestamptz,
  provider_cursor text,
  last_external_post_id text,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint social_sources_platform_ck check (platform in ('x','instagram','tiktok','youtube','facebook')),
  constraint social_sources_source_type_ck check (source_type = 'public_profile'),
  constraint social_sources_canonical_url_ck check (char_length(btrim(canonical_url)) between 1 and 2048),
  constraint social_sources_handle_len_ck check (handle is null or char_length(handle) <= 255),
  constraint social_sources_external_account_id_len_ck check (external_account_id is null or char_length(external_account_id) <= 512),
  constraint social_sources_provider_preference_len_ck check (provider_preference is null or char_length(provider_preference) <= 128),
  constraint social_sources_poll_interval_ck check (polling_interval_seconds between 300 and 86400),
  constraint social_sources_metadata_object_ck check (jsonb_typeof(metadata) = 'object'),
  constraint social_sources_workspace_platform_url_unique unique (workspace_id, platform, canonical_url),
  constraint social_sources_id_workspace_unique unique (id, workspace_id)
);

create table public.social_posts (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  social_source_id uuid,
  platform text not null,
  external_post_id text not null,
  canonical_url text not null,
  author_handle text,
  author_display_name text,
  content_text text,
  media_type text,
  published_at timestamptz,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint social_posts_source_workspace_fkey
    foreign key (social_source_id, workspace_id)
    references public.social_sources(id, workspace_id)
    on delete set null (social_source_id),
  constraint social_posts_platform_ck check (platform in ('x','instagram','tiktok','youtube','facebook')),
  constraint social_posts_external_post_id_ck check (char_length(btrim(external_post_id)) between 1 and 512),
  constraint social_posts_canonical_url_ck check (char_length(btrim(canonical_url)) between 1 and 2048),
  constraint social_posts_author_handle_len_ck check (author_handle is null or char_length(author_handle) <= 255),
  constraint social_posts_author_display_name_len_ck check (author_display_name is null or char_length(author_display_name) <= 512),
  constraint social_posts_content_text_len_ck check (content_text is null or char_length(content_text) <= 20000),
  constraint social_posts_media_type_len_ck check (media_type is null or char_length(media_type) <= 64),
  constraint social_posts_metadata_object_ck check (jsonb_typeof(metadata) = 'object'),
  constraint social_posts_workspace_platform_external_unique unique (workspace_id, platform, external_post_id),
  constraint social_posts_id_workspace_unique unique (id, workspace_id)
);

create table public.social_missions (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  social_post_id uuid not null,
  status text not null default 'DRAFT',
  baseline_views bigint,
  baseline_likes bigint,
  baseline_comments bigint,
  baseline_shares bigint,
  baseline_saves bigint,
  baseline_observed_at timestamptz,
  started_at timestamptz,
  ends_at timestamptz,
  completed_at timestamptz,
  created_by uuid references auth.users(id) on delete set null,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint social_missions_post_workspace_fkey
    foreign key (social_post_id, workspace_id)
    references public.social_posts(id, workspace_id)
    on delete restrict,
  constraint social_missions_status_ck check (status in ('DRAFT','LIVE','COMPLETED','CANCELLED','FAILED')),
  constraint social_missions_baseline_metrics_ck check (
    (baseline_views is null or baseline_views >= 0) and
    (baseline_likes is null or baseline_likes >= 0) and
    (baseline_comments is null or baseline_comments >= 0) and
    (baseline_shares is null or baseline_shares >= 0) and
    (baseline_saves is null or baseline_saves >= 0)
  ),
  constraint social_missions_time_order_ck check (
    (started_at is null or ends_at is null or ends_at >= started_at) and
    (started_at is null or completed_at is null or completed_at >= started_at)
  ),
  constraint social_missions_metadata_object_ck check (jsonb_typeof(metadata) = 'object'),
  constraint social_missions_id_workspace_unique unique (id, workspace_id)
);

create table public.social_mission_targets (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  mission_id uuid not null,
  group_connection_id uuid,
  telegram_chat_id bigint not null,
  telegram_message_id bigint,
  delivery_state text not null default 'PENDING',
  last_error text,
  sent_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint social_mission_targets_mission_workspace_fkey
    foreign key (mission_id, workspace_id)
    references public.social_missions(id, workspace_id)
    on delete cascade,
  constraint social_mission_targets_group_workspace_fkey
    foreign key (group_connection_id, workspace_id)
    references public.telegram_group_connections(id, workspace_id)
    on delete set null (group_connection_id),
  constraint social_mission_targets_delivery_state_ck check (delivery_state in ('PENDING','SENDING','SENT','FAILED','AMBIGUOUS')),
  constraint social_mission_targets_last_error_len_ck check (last_error is null or char_length(last_error) <= 1000),
  constraint social_mission_targets_sent_shape_ck check (
    ((delivery_state = 'SENT') and telegram_message_id is not null and sent_at is not null)
    or
    ((delivery_state <> 'SENT') and telegram_message_id is null and sent_at is null)
  ),
  constraint social_mission_targets_mission_chat_unique unique (mission_id, telegram_chat_id)
);

create table public.social_metric_snapshots (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  mission_id uuid not null,
  provider text not null,
  observed_at timestamptz not null default now(),
  poll_bucket timestamptz not null,
  views bigint,
  likes bigint,
  comments bigint,
  shares bigint,
  saves bigint,
  availability jsonb not null default '{}'::jsonb,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  constraint social_metric_snapshots_mission_workspace_fkey
    foreign key (mission_id, workspace_id)
    references public.social_missions(id, workspace_id)
    on delete cascade,
  constraint social_metric_snapshots_provider_ck check (char_length(btrim(provider)) between 1 and 128),
  constraint social_metric_snapshots_metrics_ck check (
    (views is null or views >= 0) and
    (likes is null or likes >= 0) and
    (comments is null or comments >= 0) and
    (shares is null or shares >= 0) and
    (saves is null or saves >= 0)
  ),
  constraint social_metric_snapshots_availability_object_ck check (jsonb_typeof(availability) = 'object'),
  constraint social_metric_snapshots_metadata_object_ck check (jsonb_typeof(metadata) = 'object'),
  constraint social_metric_snapshots_mission_provider_bucket_unique unique (mission_id, provider, poll_bucket)
);

create trigger social_sources_set_updated_at before update on public.social_sources for each row execute function public.set_updated_at();
create trigger social_posts_set_updated_at before update on public.social_posts for each row execute function public.set_updated_at();
create trigger social_missions_set_updated_at before update on public.social_missions for each row execute function public.set_updated_at();
create trigger social_mission_targets_set_updated_at before update on public.social_mission_targets for each row execute function public.set_updated_at();

create index social_sources_workspace_created_idx on public.social_sources(workspace_id, created_at desc);
create index social_sources_workspace_auto_detect_idx on public.social_sources(workspace_id, auto_detect_enabled, updated_at desc);
create index social_posts_workspace_published_idx on public.social_posts(workspace_id, published_at desc nulls last, created_at desc);
create index social_posts_source_published_idx on public.social_posts(social_source_id, published_at desc nulls last) where social_source_id is not null;
create index social_missions_workspace_status_created_idx on public.social_missions(workspace_id, status, created_at desc);
create index social_mission_targets_workspace_created_idx on public.social_mission_targets(workspace_id, created_at desc);
create index social_mission_targets_group_connection_idx on public.social_mission_targets(group_connection_id) where group_connection_id is not null;
create index social_metric_snapshots_mission_observed_idx on public.social_metric_snapshots(mission_id, observed_at desc);
create index social_metric_snapshots_workspace_observed_idx on public.social_metric_snapshots(workspace_id, observed_at desc);

alter table public.social_sources enable row level security;
alter table public.social_sources force row level security;
alter table public.social_posts enable row level security;
alter table public.social_posts force row level security;
alter table public.social_missions enable row level security;
alter table public.social_missions force row level security;
alter table public.social_mission_targets enable row level security;
alter table public.social_mission_targets force row level security;
alter table public.social_metric_snapshots enable row level security;
alter table public.social_metric_snapshots force row level security;

revoke all on table public.social_sources from public, anon, authenticated, service_role;
revoke all on table public.social_posts from public, anon, authenticated, service_role;
revoke all on table public.social_missions from public, anon, authenticated, service_role;
revoke all on table public.social_mission_targets from public, anon, authenticated, service_role;
revoke all on table public.social_metric_snapshots from public, anon, authenticated, service_role;

grant select, insert, update, delete on table public.social_sources to authenticated;
grant select on table public.social_posts to authenticated;
grant select, insert, update, delete on table public.social_missions to authenticated;
grant select, insert, update, delete on table public.social_mission_targets to authenticated;
grant select on table public.social_metric_snapshots to authenticated;

grant all privileges on table public.social_sources to service_role;
grant select, insert, update on table public.social_posts to service_role;
grant all privileges on table public.social_missions to service_role;
grant all privileges on table public.social_mission_targets to service_role;
grant select, insert on table public.social_metric_snapshots to service_role;

create policy social_sources_select_member on public.social_sources for select to authenticated using (public.is_workspace_member(workspace_id, (select auth.uid())));
create policy social_sources_insert_operator on public.social_sources for insert to authenticated with check (public.is_workspace_operator(workspace_id, (select auth.uid())));
create policy social_sources_update_operator on public.social_sources for update to authenticated using (public.is_workspace_operator(workspace_id, (select auth.uid()))) with check (public.is_workspace_operator(workspace_id, (select auth.uid())));
create policy social_sources_delete_operator on public.social_sources for delete to authenticated using (public.is_workspace_operator(workspace_id, (select auth.uid())));
create policy social_posts_select_member on public.social_posts for select to authenticated using (public.is_workspace_member(workspace_id, (select auth.uid())));
create policy social_missions_select_member on public.social_missions for select to authenticated using (public.is_workspace_member(workspace_id, (select auth.uid())));
create policy social_missions_insert_operator on public.social_missions for insert to authenticated with check (public.is_workspace_operator(workspace_id, (select auth.uid())));
create policy social_missions_update_operator on public.social_missions for update to authenticated using (public.is_workspace_operator(workspace_id, (select auth.uid()))) with check (public.is_workspace_operator(workspace_id, (select auth.uid())));
create policy social_missions_delete_draft_operator on public.social_missions for delete to authenticated using (public.is_workspace_operator(workspace_id, (select auth.uid())) and status = 'DRAFT');
create policy social_mission_targets_select_member on public.social_mission_targets for select to authenticated using (public.is_workspace_member(workspace_id, (select auth.uid())));
create policy social_mission_targets_insert_operator on public.social_mission_targets for insert to authenticated with check (public.is_workspace_operator(workspace_id, (select auth.uid())) and group_connection_id is not null and exists (select 1 from public.telegram_group_connections g where g.id = group_connection_id and g.workspace_id = workspace_id and g.telegram_chat_id = telegram_chat_id));
create policy social_mission_targets_update_operator on public.social_mission_targets for update to authenticated using (public.is_workspace_operator(workspace_id, (select auth.uid()))) with check (public.is_workspace_operator(workspace_id, (select auth.uid())) and (group_connection_id is null or exists (select 1 from public.telegram_group_connections g where g.id = group_connection_id and g.workspace_id = workspace_id and g.telegram_chat_id = telegram_chat_id)));
create policy social_mission_targets_delete_draft_operator on public.social_mission_targets for delete to authenticated using (public.is_workspace_operator(workspace_id, (select auth.uid())) and exists (select 1 from public.social_missions m where m.id = mission_id and m.workspace_id = workspace_id and m.status = 'DRAFT'));
create policy social_metric_snapshots_select_member on public.social_metric_snapshots for select to authenticated using (public.is_workspace_member(workspace_id, (select auth.uid())));
