-- REVIEW-ONLY STAGED MIGRATION. DO NOT APPLY WITHOUT EXPLICIT OWNER APPROVAL.
-- Durable, exact-post Mission Control launcher cleanup binding.
-- Existing cleanup worker remains authoritative; its one-minute schedule means
-- deletion is due about five seconds after acknowledgement but may execute on
-- the next worker tick. Abandoned launchers expire after 15 minutes.

alter table public.telegram_message_cleanup_jobs
  drop constraint if exists telegram_message_cleanup_jobs_cleanup_kind_check;
alter table public.telegram_message_cleanup_jobs
  add constraint telegram_message_cleanup_jobs_cleanup_kind_check
  check (cleanup_kind in ('launch_watch_cta', 'social_mission_pulse', 'social_mission_card', 'mission_control_launcher'));

create table public.mission_control_launcher_bindings (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null,
  group_connection_id uuid not null references public.telegram_group_connections(id) on delete cascade,
  close_token_hash text not null unique,
  telegram_message_id bigint,
  status text not null default 'prepared' check (status in ('prepared', 'confirmed', 'cleanup_queued', 'expired')),
  expires_at timestamptz not null default (now() + interval '15 minutes'),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
grant all on public.mission_control_launcher_bindings to service_role;
alter table public.mission_control_launcher_bindings enable row level security;

create or replace function public.request_mission_control_launcher_cleanup(
  _telegram_user_id bigint,
  _group_connection_id uuid,
  _close_token text
) returns boolean
language plpgsql security definer set search_path = public
as $$
declare
  v_binding public.mission_control_launcher_bindings%rowtype;
  v_workspace uuid;
  v_due timestamptz := now() + interval '5 seconds';
begin
  if length(_close_token) < 22 or length(_close_token) > 64 then return false; end if;
  select b.*, g.workspace_id into v_binding
  from public.mission_control_launcher_bindings b
  join public.telegram_group_connections g on g.id = b.group_connection_id
  where b.group_connection_id = _group_connection_id
    and b.close_token_hash = encode(digest(_close_token, 'sha256'), 'hex')
    and b.status = 'confirmed' and b.expires_at > now()
    and b.telegram_message_id is not null
  for update;
  if not found then return false; end if;
  v_workspace := v_binding.workspace_id;
  if not public.is_telegram_workspace_operator(_telegram_user_id, v_workspace) then return false; end if;
  insert into public.telegram_message_cleanup_jobs (
    workspace_id, group_connection_id, telegram_chat_id, telegram_message_id,
    cleanup_kind, delete_after, next_attempt_at
  )
  select v_workspace, g.id, g.telegram_chat_id, v_binding.telegram_message_id,
    'mission_control_launcher', v_due, v_due
  from public.telegram_group_connections g
  where g.id = _group_connection_id and g.workspace_id = v_workspace and g.bot_is_admin = true
  on conflict (telegram_chat_id, telegram_message_id) do nothing;
  update public.mission_control_launcher_bindings
  set status = 'cleanup_queued', updated_at = now()
  where id = v_binding.id;
  return true;
end;
$$;
revoke all on function public.request_mission_control_launcher_cleanup(bigint, uuid, text) from public, anon, authenticated;
grant execute on function public.request_mission_control_launcher_cleanup(bigint, uuid, text) to service_role;