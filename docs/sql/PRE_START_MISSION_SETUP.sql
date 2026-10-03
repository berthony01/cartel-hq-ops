-- REVIEW-ONLY STAGED MIGRATION. DO NOT APPLY WITHOUT ROOT REVIEW.
-- Adds reviewable Link Finder setup state and an atomic candidate -> mission start.
-- No public/browser grants. Existing RLS and transport ownership remain unchanged.

begin;

alter table public.social_mission_link_candidates
  add column if not exists reviewed_targets jsonb not null default '{}'::jsonb,
  add column if not exists setup_request_id uuid,
  add column if not exists setup_started_at timestamptz,
  add column if not exists setup_mission_id uuid references public.social_missions(id) on delete set null;

create or replace function public.social_mission_setup_targets_valid(_targets jsonb)
returns boolean language sql immutable set search_path = pg_catalog as $$
  select jsonb_typeof(_targets) = 'object'
    and not exists (select 1 from jsonb_object_keys(_targets) k where k not in ('likes','replies','reposts','bookmarks'))
    and exists (select 1 from jsonb_each(_targets) e where jsonb_typeof(e.value) = 'number' and (e.value #>> '{}')::bigint between 1 and 2147483647)
    and not exists (select 1 from jsonb_each(_targets) e where jsonb_typeof(e.value) <> 'number' or (e.value #>> '{}')::numeric <> trunc((e.value #>> '{}')::numeric) or (e.value #>> '{}')::numeric not between 1 and 2147483647)
$$;

create or replace function public.read_social_mission_candidate_setup(
  _candidate_id uuid, _telegram_user_id bigint, _verified_chat_id bigint
) returns jsonb language plpgsql security definer set search_path = pg_catalog as $$
declare v public.social_mission_link_candidates%rowtype; v_uid uuid;
begin
  if _candidate_id is null or _telegram_user_id is null or _verified_chat_id is null then
    return jsonb_build_object('outcome','REJECTED','reason','invalid_arguments');
  end if;
  select * into v from public.social_mission_link_candidates where id = _candidate_id;
  if not found or v.state <> 'PENDING' or v.expires_at <= now() or v.telegram_chat_id <> _verified_chat_id then
    return jsonb_build_object('outcome','REJECTED','reason','candidate_unavailable');
  end if;
  if not exists (select 1 from public.telegram_group_connections c where c.id=v.group_connection_id and c.workspace_id=v.workspace_id and c.telegram_chat_id=v.telegram_chat_id and c.telegram_chat_id<0 and c.bot_is_admin=true and coalesce(c.metadata->>'bot_removed_at','')='') then
    return jsonb_build_object('outcome','REJECTED','reason','candidate_unavailable');
  end if;
  select user_id into v_uid from public.telegram_connections where telegram_user_id=_telegram_user_id limit 1;
  if v_uid is null or not public.is_workspace_operator(v.workspace_id,v_uid) then
    return jsonb_build_object('outcome','REJECTED','reason','candidate_unavailable');
  end if;
  return jsonb_build_object('outcome','READY','workspace_id',v.workspace_id,'group_connection_id',v.group_connection_id,'canonical_url',v.canonical_url,'author_handle',v.author_handle,'expires_at',v.expires_at,'reviewed_targets',v.reviewed_targets);
end $$;

create or replace function public.save_social_mission_candidate_setup(
  _candidate_id uuid, _telegram_user_id bigint, _verified_chat_id bigint, _request_id uuid, _targets jsonb
) returns jsonb language plpgsql security definer set search_path = pg_catalog as $$
declare v public.social_mission_link_candidates%rowtype; v_uid uuid;
begin
  if _request_id is null or not public.social_mission_setup_targets_valid(_targets) then return jsonb_build_object('outcome','REJECTED'); end if;
  select * into v from public.social_mission_link_candidates where id=_candidate_id for update;
  if not found or v.state<>'PENDING' or v.expires_at<=now() or v.telegram_chat_id<>_verified_chat_id or v.setup_started_at is not null then return jsonb_build_object('outcome','REJECTED'); end if;
  if not exists (select 1 from public.telegram_group_connections c where c.id=v.group_connection_id and c.workspace_id=v.workspace_id and c.telegram_chat_id=v.telegram_chat_id and c.telegram_chat_id<0 and c.bot_is_admin=true and coalesce(c.metadata->>'bot_removed_at','')='') then return jsonb_build_object('outcome','REJECTED'); end if;
  select user_id into v_uid from public.telegram_connections where telegram_user_id=_telegram_user_id limit 1;
  if v_uid is null or not public.is_workspace_operator(v.workspace_id,v_uid) then return jsonb_build_object('outcome','REJECTED'); end if;
  update public.social_mission_link_candidates set reviewed_targets=_targets where id=v.id;
  return jsonb_build_object('outcome','SAVED','reviewed_targets',_targets);
end $$;

create or replace function public.start_social_mission_candidate_setup(
  _candidate_id uuid, _telegram_user_id bigint, _verified_chat_id bigint, _request_id uuid, _targets jsonb
) returns jsonb language plpgsql security definer set search_path = pg_catalog as $$
declare v public.social_mission_link_candidates%rowtype; v_uid uuid; v_x text; v_handle text; v_post uuid; v_mission uuid; v_target uuid; v_delivery text; v_settings public.social_mission_settings%rowtype; v_config jsonb;
begin
  if _request_id is null or not public.social_mission_setup_targets_valid(_targets) then return jsonb_build_object('outcome','REJECTED','reason','invalid_targets'); end if;
  select * into v from public.social_mission_link_candidates where id=_candidate_id for update;
  if not found or v.telegram_chat_id<>_verified_chat_id then return jsonb_build_object('outcome','REJECTED','reason','candidate_unavailable'); end if;
  if v.setup_mission_id is not null then
    select t.id,t.delivery_state into v_target,v_delivery from public.social_mission_targets t where t.mission_id=v.setup_mission_id and t.telegram_chat_id=v.telegram_chat_id limit 1;
    return jsonb_build_object('outcome',case when v.state='STARTED' then 'FINALIZED' else 'EXISTING' end,'mission_id',v.setup_mission_id,'target_id',v_target,'delivery_state',v_delivery,'prompt_message_id',v.prompt_message_id);
  end if;
  if v.state<>'PENDING' or v.expires_at<=now() then return jsonb_build_object('outcome','REJECTED','reason','candidate_unavailable'); end if;
  if not exists (select 1 from public.telegram_group_connections c where c.id=v.group_connection_id and c.workspace_id=v.workspace_id and c.telegram_chat_id=v.telegram_chat_id and c.telegram_chat_id<0 and c.bot_is_admin=true and coalesce(c.metadata->>'bot_removed_at','')='') then return jsonb_build_object('outcome','REJECTED','reason','candidate_unavailable'); end if;
  select user_id into v_uid from public.telegram_connections where telegram_user_id=_telegram_user_id limit 1;
  if v_uid is null or not public.is_workspace_operator(v.workspace_id,v_uid) then return jsonb_build_object('outcome','REJECTED','reason','candidate_unavailable'); end if;
  if not public.can_use_project_tools(v.workspace_id,v_uid) then return jsonb_build_object('outcome','REJECTED','reason','project_identity_required'); end if;
  select x_url into v_x from public.project_profiles where workspace_id=v.workspace_id limit 1;
  v_handle:=lower((regexp_match(coalesce(v_x,''),'^https?://(?:www\.|mobile\.)?(?:x|twitter)\.com/@?([A-Za-z0-9_]{1,15})(?:[/?#].*)?$'))[1]);
  if v_handle is null or v_handle<>v.author_handle then return jsonb_build_object('outcome','REJECTED','reason','official_identity_changed'); end if;
  perform pg_advisory_xact_lock(hashtextextended(v.workspace_id::text||':'||v.external_post_id||':'||v.telegram_chat_id::text,0));
  insert into public.social_posts(workspace_id,platform,external_post_id,canonical_url,author_handle,content_text,metadata) values(v.workspace_id,'x',v.external_post_id,v.canonical_url,v.author_handle,null,jsonb_build_object('source','telegram_link_finder_setup')) on conflict(workspace_id,platform,external_post_id) do nothing;
  select id into v_post from public.social_posts where workspace_id=v.workspace_id and platform='x' and external_post_id=v.external_post_id;
  select m.id,t.id,t.delivery_state into v_mission,v_target,v_delivery from public.social_missions m join public.social_mission_targets t on t.mission_id=m.id and t.workspace_id=m.workspace_id where m.workspace_id=v.workspace_id and m.social_post_id=v_post and t.telegram_chat_id=v.telegram_chat_id and m.status in('DRAFT','LIVE') order by m.created_at desc limit 1;
  if v_mission is null then
    select * into v_settings from public.social_mission_settings where workspace_id=v.workspace_id;
    v_config:=public.social_mission_preset_config(coalesce(v_settings.default_preset,'STANDARD'))||jsonb_build_object('live_metrics_enabled',coalesce(v_settings.live_metrics_enabled,true),'auto_pin_mission',coalesce(v_settings.auto_pin_mission,true),'delete_command_after_send',coalesce(v_settings.delete_command_after_send,true),'milestone_type','NONE','milestone_target',null,'metric_targets',_targets,'metric_targets_source','REVIEWED');
    insert into public.social_missions(workspace_id,social_post_id,status,started_at,created_by,metadata) values(v.workspace_id,v_post,'LIVE',now(),v_uid,jsonb_build_object('source','telegram_link_finder_setup','candidate_id',v.id,'telegram_chat_id',v.telegram_chat_id,'telegram_message_id',v.telegram_message_id,'telegram_user_id',_telegram_user_id,'effective_config',v_config)) returning id into v_mission;
    insert into public.social_mission_targets(workspace_id,mission_id,group_connection_id,telegram_chat_id,delivery_state) values(v.workspace_id,v_mission,v.group_connection_id,v.telegram_chat_id,'PENDING') returning id,delivery_state into v_target,v_delivery;
  end if;
  update public.social_mission_link_candidates set reviewed_targets=_targets,setup_request_id=_request_id,setup_started_at=coalesce(setup_started_at,now()),setup_mission_id=v_mission where id=v.id;
  return jsonb_build_object('outcome',case when v.setup_started_at is null then 'CREATED' else 'EXISTING' end,'mission_id',v_mission,'target_id',v_target,'delivery_state',v_delivery,'prompt_message_id',v.prompt_message_id);
end $$;

revoke all on function public.social_mission_setup_targets_valid(jsonb) from public,anon,authenticated;
revoke all on function public.read_social_mission_candidate_setup(uuid,bigint,bigint) from public,anon,authenticated;
revoke all on function public.save_social_mission_candidate_setup(uuid,bigint,bigint,uuid,jsonb) from public,anon,authenticated;
revoke all on function public.start_social_mission_candidate_setup(uuid,bigint,bigint,uuid,jsonb) from public,anon,authenticated;
grant execute on function public.social_mission_setup_targets_valid(jsonb) to service_role,postgres;
grant execute on function public.read_social_mission_candidate_setup(uuid,bigint,bigint) to service_role,postgres;
grant execute on function public.save_social_mission_candidate_setup(uuid,bigint,bigint,uuid,jsonb) to service_role,postgres;
grant execute on function public.start_social_mission_candidate_setup(uuid,bigint,bigint,uuid,jsonb) to service_role,postgres;

commit;