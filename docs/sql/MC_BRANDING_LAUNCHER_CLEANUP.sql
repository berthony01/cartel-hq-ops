-- REVIEW-ONLY STAGED MIGRATION. DO NOT APPLY WITHOUT EXPLICIT OWNER APPROVAL.
-- Durable, exact-post Mission Control launcher cleanup binding.
-- Existing cleanup worker remains authoritative; its one-minute schedule means
-- deletion is due about five seconds after acknowledgement but may execute on
-- the next worker tick. Abandoned launchers expire after 15 minutes.

alter table public.telegram_message_cleanup_jobs
  drop constraint if exists telegram_message_cleanup_jobs_cleanup_kind_ck;
alter table public.telegram_message_cleanup_jobs
  add constraint telegram_message_cleanup_jobs_cleanup_kind_ck
  check (cleanup_kind in ('launch_watch_cta', 'social_mission_pulse', 'social_mission_card', 'mission_control_launcher'));

create table public.mission_control_launcher_bindings (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
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

create or replace function public.prepare_mission_control_launcher_binding(
  _binding_id uuid,
  _group_connection_id uuid,
  _close_token_hash text
) returns boolean
language plpgsql security definer set search_path = public
as $$
declare v_workspace uuid;
begin
  if _binding_id is null or _group_connection_id is null
     or _close_token_hash !~ '^[0-9a-f]{64}$' then return false; end if;
  select workspace_id into v_workspace from public.telegram_group_connections
  where id = _group_connection_id and bot_is_admin = true;
  if v_workspace is null then return false; end if;
  insert into public.mission_control_launcher_bindings
    (id, workspace_id, group_connection_id, close_token_hash)
  values (_binding_id, v_workspace, _group_connection_id, _close_token_hash);
  return true;
end;
$$;

create or replace function public.confirm_mission_control_launcher_binding(
  _binding_id uuid,
  _telegram_message_id bigint
) returns boolean
language plpgsql security definer set search_path = public
as $$
declare v public.mission_control_launcher_bindings%rowtype;
declare v_chat_id bigint;
declare v_delete_after timestamptz;
begin
  if _telegram_message_id is null or _telegram_message_id <= 0 then return false; end if;
  update public.mission_control_launcher_bindings
  set telegram_message_id = _telegram_message_id, status = 'confirmed', updated_at = now()
  where id = _binding_id and status = 'prepared' and expires_at > now()
  returning * into v;
  if not found then return false; end if;
  select telegram_chat_id into v_chat_id from public.telegram_group_connections
  where id = v.group_connection_id and workspace_id = v.workspace_id and bot_is_admin = true;
  if v_chat_id is null then return false; end if;
  v_delete_after := v.expires_at;
  insert into public.telegram_message_cleanup_jobs (
    workspace_id, group_connection_id, telegram_chat_id, telegram_message_id,
    cleanup_kind, delete_after, next_attempt_at
  ) values (
    v.workspace_id, v.group_connection_id, v_chat_id, _telegram_message_id,
    'mission_control_launcher', v_delete_after, v_delete_after
  ) on conflict (telegram_chat_id, telegram_message_id) do nothing;
  return true;
end;
$$;

create or replace function public.abandon_mission_control_launcher_binding(_binding_id uuid)
returns void language sql security definer set search_path = public
as $$
  update public.mission_control_launcher_bindings
  set status = 'expired', updated_at = now()
  where id = _binding_id and status = 'prepared'
$$;

create or replace function public.request_mission_control_launcher_cleanup(
  _telegram_user_id bigint,
  _group_connection_id uuid,
  _close_token text
) returns boolean
language plpgsql security definer set search_path = public
as $$
declare
  v_binding public.mission_control_launcher_bindings%rowtype;
  v_uid uuid;
  v_due timestamptz := now() + interval '5 seconds';
begin
  if length(_close_token) < 22 or length(_close_token) > 64 then return false; end if;
  select b.* into v_binding
  from public.mission_control_launcher_bindings b
  where b.group_connection_id = _group_connection_id
    and b.close_token_hash = encode(digest(_close_token, 'sha256'), 'hex')
    and b.status = 'confirmed' and b.expires_at > now()
    and b.telegram_message_id is not null
  for update;
  if not found then return false; end if;
  select user_id into v_uid from public.telegram_connections
  where telegram_user_id = _telegram_user_id limit 1;
  if v_uid is null or not public.is_workspace_operator(v_binding.workspace_id, v_uid) then return false; end if;
  update public.telegram_message_cleanup_jobs
  set delete_after = least(delete_after, v_due),
      next_attempt_at = least(next_attempt_at, v_due),
      updated_at = now()
  where group_connection_id = v_binding.group_connection_id
    and telegram_message_id = v_binding.telegram_message_id
    and cleanup_kind = 'mission_control_launcher'
    and status in ('pending', 'retry');
  if not found then return false; end if;
  update public.mission_control_launcher_bindings
  set status = 'cleanup_queued', updated_at = now()
  where id = v_binding.id;
  return true;
end;
$$;
revoke all on function public.request_mission_control_launcher_cleanup(bigint, uuid, text) from public, anon, authenticated;
grant execute on function public.request_mission_control_launcher_cleanup(bigint, uuid, text) to service_role;
revoke all on function public.prepare_mission_control_launcher_binding(uuid, uuid, text) from public, anon, authenticated;
revoke all on function public.confirm_mission_control_launcher_binding(uuid, bigint) from public, anon, authenticated;
revoke all on function public.abandon_mission_control_launcher_binding(uuid) from public, anon, authenticated;
grant execute on function public.prepare_mission_control_launcher_binding(uuid, uuid, text) to service_role;
grant execute on function public.confirm_mission_control_launcher_binding(uuid, bigint) to service_role;
grant execute on function public.abandon_mission_control_launcher_binding(uuid) to service_role;