-- REVIEW-ONLY STAGED MIGRATION. DO NOT APPLY WITHOUT EXPLICIT OWNER APPROVAL.
-- Durable exact-post Mission Control launcher cleanup. The fast path claims
-- one due job after about five seconds; the existing minute runner remains the
-- durable retry fallback. Prepared/abandoned launchers expire after 15 minutes.

alter table public.telegram_message_cleanup_jobs
  drop constraint if exists telegram_message_cleanup_jobs_cleanup_kind_check;
alter table public.telegram_message_cleanup_jobs
  drop constraint if exists telegram_message_cleanup_jobs_cleanup_kind_ck;
alter table public.telegram_message_cleanup_jobs
  add constraint telegram_message_cleanup_jobs_cleanup_kind_ck
  check (cleanup_kind in ('launch_watch_cta', 'social_mission_pulse', 'social_mission_card', 'mission_control_launcher'));
revoke all on table public.telegram_message_cleanup_jobs from public, anon, authenticated;
grant all on table public.telegram_message_cleanup_jobs to service_role;

create table public.mission_control_launcher_bindings (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  group_connection_id uuid not null references public.telegram_group_connections(id) on delete cascade,
  telegram_chat_id bigint not null check (telegram_chat_id < 0),
  close_token_hash text not null unique,
  telegram_message_id bigint,
  cleanup_job_id uuid references public.telegram_message_cleanup_jobs(id),
  status text not null default 'prepared' check (status in ('prepared', 'confirmed', 'cleanup_queued', 'expired')),
  expires_at timestamptz not null default (now() + interval '15 minutes'),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
revoke all on table public.mission_control_launcher_bindings from public, anon, authenticated;
grant all on table public.mission_control_launcher_bindings to service_role;
alter table public.mission_control_launcher_bindings enable row level security;

create or replace function public.prepare_mission_control_launcher_binding(
  _binding_id uuid,
  _group_connection_id uuid,
  _close_token_hash text
) returns boolean
language plpgsql security definer set search_path = public
as $$
declare v_connection public.telegram_group_connections%rowtype;
begin
  if _binding_id is null or _group_connection_id is null
     or _close_token_hash !~ '^[0-9a-f]{64}$' then return false; end if;
  select * into v_connection from public.telegram_group_connections
  where id = _group_connection_id and telegram_chat_id < 0 and bot_is_admin = true
    and coalesce(metadata->>'bot_removed_at', '') = '';
  if not found then return false; end if;
  insert into public.mission_control_launcher_bindings
    (id, workspace_id, group_connection_id, telegram_chat_id, close_token_hash)
  values (_binding_id, v_connection.workspace_id, v_connection.id,
          v_connection.telegram_chat_id, _close_token_hash);
  return true;
end;
$$;

create or replace function public.confirm_mission_control_launcher_binding(
  _binding_id uuid,
  _telegram_message_id bigint
) returns uuid
language plpgsql security definer set search_path = public
as $$
declare v public.mission_control_launcher_bindings%rowtype;
declare v_job_id uuid;
begin
  if _telegram_message_id is null or _telegram_message_id <= 0 then return null; end if;
  select b.* into v from public.mission_control_launcher_bindings b
  join public.telegram_group_connections c
    on c.id = b.group_connection_id
   and c.workspace_id = b.workspace_id
   and c.telegram_chat_id = b.telegram_chat_id
   and c.telegram_chat_id < 0
   and c.bot_is_admin = true
   and coalesce(c.metadata->>'bot_removed_at', '') = ''
  where b.id = _binding_id and b.status = 'prepared' and b.expires_at > now()
  for update of b;
  if not found then return null; end if;

  select j.id into v_job_id from public.telegram_message_cleanup_jobs j
  where j.telegram_chat_id = v.telegram_chat_id
    and j.telegram_message_id = _telegram_message_id;
  if found then return null; end if;

  insert into public.telegram_message_cleanup_jobs (
    workspace_id, group_connection_id, telegram_chat_id, telegram_message_id,
    cleanup_kind, status, delete_after, next_attempt_at
  ) values (
    v.workspace_id, v.group_connection_id, v.telegram_chat_id, _telegram_message_id,
    'mission_control_launcher', 'pending', v.expires_at, v.expires_at
  ) returning id into v_job_id;

  update public.mission_control_launcher_bindings
  set telegram_message_id = _telegram_message_id, cleanup_job_id = v_job_id,
      status = 'confirmed', updated_at = now()
  where id = v.id;
  return v_job_id;
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
) returns uuid
language plpgsql security definer set search_path = public, extensions
as $$
declare v_binding public.mission_control_launcher_bindings%rowtype;
declare v_uid uuid;
declare v_due timestamptz := now() + interval '5 seconds';
begin
  if length(_close_token) < 22 or length(_close_token) > 64 then return null; end if;
  select b.* into v_binding
  from public.mission_control_launcher_bindings b
  join public.telegram_group_connections c
    on c.id = b.group_connection_id
   and c.workspace_id = b.workspace_id
   and c.telegram_chat_id = b.telegram_chat_id
   and c.telegram_chat_id < 0
   and c.bot_is_admin = true
   and coalesce(c.metadata->>'bot_removed_at', '') = ''
  where b.group_connection_id = _group_connection_id
    and b.close_token_hash = encode(extensions.digest(_close_token, 'sha256'), 'hex')
    and b.status in ('confirmed', 'cleanup_queued') and b.expires_at > now()
    and b.telegram_message_id is not null and b.cleanup_job_id is not null
  for update of b;
  if not found then return null; end if;
  select user_id into v_uid from public.telegram_connections
  where telegram_user_id = _telegram_user_id limit 1;
  if v_uid is null or not public.is_workspace_operator(v_binding.workspace_id, v_uid) then return null; end if;

  update public.telegram_message_cleanup_jobs
  set delete_after = least(delete_after, v_due), next_attempt_at = least(next_attempt_at, v_due), updated_at = now()
  where id = v_binding.cleanup_job_id
    and workspace_id = v_binding.workspace_id
    and group_connection_id = v_binding.group_connection_id
    and telegram_chat_id = v_binding.telegram_chat_id
    and telegram_message_id = v_binding.telegram_message_id
    and cleanup_kind = 'mission_control_launcher'
    and status in ('pending', 'retry');
  if not found and v_binding.status <> 'cleanup_queued' then return null; end if;
  update public.mission_control_launcher_bindings set status = 'cleanup_queued', updated_at = now() where id = v_binding.id;
  return v_binding.cleanup_job_id;
end;
$$;

create or replace function public.claim_mission_control_launcher_cleanup_job(_job_id uuid)
returns table(job_id uuid, telegram_chat_id bigint, telegram_message_id bigint, cleanup_kind text, attempt_count integer)
language plpgsql security definer set search_path = public
as $$
begin
  return query
  with claimed as (
    select j.id from public.telegram_message_cleanup_jobs j
    where j.id = _job_id and j.cleanup_kind = 'mission_control_launcher'
      and j.attempt_count < 5
      and ((j.status in ('pending','retry') and j.delete_after <= now() and j.next_attempt_at <= now())
        or (j.status = 'processing' and j.claimed_at < now() - interval '5 minutes'))
    for update skip locked
  )
  update public.telegram_message_cleanup_jobs j
  set status = 'processing', claimed_at = now(), attempt_count = j.attempt_count + 1, updated_at = now()
  from claimed where j.id = claimed.id
  returning j.id, j.telegram_chat_id, j.telegram_message_id, j.cleanup_kind, j.attempt_count;
end;
$$;

revoke all on function public.prepare_mission_control_launcher_binding(uuid, uuid, text) from public, anon, authenticated;
revoke all on function public.confirm_mission_control_launcher_binding(uuid, bigint) from public, anon, authenticated;
revoke all on function public.abandon_mission_control_launcher_binding(uuid) from public, anon, authenticated;
revoke all on function public.request_mission_control_launcher_cleanup(bigint, uuid, text) from public, anon, authenticated;
revoke all on function public.claim_mission_control_launcher_cleanup_job(uuid) from public, anon, authenticated;
grant execute on function public.prepare_mission_control_launcher_binding(uuid, uuid, text) to service_role;
grant execute on function public.confirm_mission_control_launcher_binding(uuid, bigint) to service_role;
grant execute on function public.abandon_mission_control_launcher_binding(uuid) to service_role;
grant execute on function public.request_mission_control_launcher_cleanup(bigint, uuid, text) to service_role;
grant execute on function public.claim_mission_control_launcher_cleanup_job(uuid) to service_role;