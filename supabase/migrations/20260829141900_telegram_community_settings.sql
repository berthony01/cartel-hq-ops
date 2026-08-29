-- Source-control snapshot of the migration already applied to the authoritative
-- CARTEL HQ Supabase project. Not executed from this repository.

create table if not exists public.telegram_community_settings (
  group_connection_id uuid primary key references public.telegram_group_connections(id) on delete cascade,
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  welcome_enabled boolean not null default false,
  welcome_message text not null default '👋 Welcome {first_name} to {community_name}!\n\nPlease check the pinned messages and official links before getting started.',
  mention_member boolean not null default true,
  auto_delete_enabled boolean not null default true,
  auto_delete_seconds smallint not null default 45 check (auto_delete_seconds between 10 and 120),
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint telegram_community_settings_message_length check (char_length(welcome_message) between 1 and 3500),
  constraint telegram_community_settings_workspace_group_unique unique (workspace_id, group_connection_id)
);

create index if not exists telegram_community_settings_workspace_idx
  on public.telegram_community_settings(workspace_id);

alter table public.telegram_community_settings enable row level security;

grant select on public.telegram_community_settings to authenticated;
grant all on public.telegram_community_settings to service_role;

create policy "telegram_community_settings_select_member"
on public.telegram_community_settings
for select
to authenticated
using (public.is_workspace_member(workspace_id, auth.uid()));

create trigger telegram_community_settings_set_updated_at
before update on public.telegram_community_settings
for each row execute function public.set_updated_at();
