-- REVIEW-ONLY STAGED MIGRATION. DO NOT APPLY WITHOUT ROOT REVIEW.
-- Candidate-scoped review state and atomic explicit-start handoff. No browser grants.
begin;

alter table public.social_mission_link_candidates
  add column if not exists reviewed_targets jsonb not null default '{}'::jsonb,
  add column if not exists setup_request_id uuid,
  add column if not exists setup_started_at timestamptz,
  add column if not exists setup_mission_id uuid references public.social_missions(id) on delete set null;

create or replace function public.create_social_mission_setup_candidate(
  _telegram_chat_id bigint, _telegram_message_id bigint, _telegram_user_id bigint,
  _canonical_url text, _external_post_id text, _author_handle text, _ttl_minutes integer default 15
) returns jsonb language plpgsql security definer set search_path = pg_catalog as $$
declare v_workspace uuid; v_connection uuid; v_x text; v_official text; v_handle text:=lower(btrim(coalesce(_author_handle,''))); v_post text:=btrim(coalesce(_external_post_id,'')); v_url text:=btrim(coalesce(_canonical_url,'')); v_id uuid;
begin
  if _telegram_chat_id is null or _telegram_chat_id>=0 or _telegram_message_id is null or _telegram_message_id<=0 or v_post !~ '^[0-9]{1,32}$' or v_handle !~ '^[a-z0-9_]{1,15}$' or v_url<>('https://x.com/'||v_handle||'/status/'||v_post) then return jsonb_build_object('outcome','REJECTED','reason','invalid_arguments'); end if;
  select c.id,c.workspace_id into strict v_connection,v_workspace from public.telegram_group_connections c where c.telegram_chat_id=_telegram_chat_id and c.bot_is_admin is true and coalesce(c.metadata->>'bot_removed_at','')='';
  select p.x_url into v_x from public.project_profiles p where p.workspace_id=v_workspace limit 1;
  v_official:=lower((regexp_match(coalesce(v_x,''),'^https?://(?:www\.|mobile\.)?(?:x|twitter)\.com/@?([A-Za-z0-9_]{1,15})(?:[/?#].*)?$'))[1]);
  if v_official is null or v_official<>v_handle then return jsonb_build_object('outcome','REJECTED','reason','handle_not_official'); end if;
  insert into public.social_mission_link_candidates(workspace_id,group_connection_id,telegram_chat_id,telegram_message_id,telegram_user_id,canonical_url,external_post_id,author_handle,expires_at)
  values(v_workspace,v_connection,_telegram_chat_id,_telegram_message_id,_telegram_user_id,v_url,v_post,v_handle,now()+make_interval(mins=>greatest(1,least(60,coalesce(_ttl_minutes,15)))))
  on conflict(telegram_chat_id,telegram_message_id) do nothing returning id into v_id;
  return jsonb_build_object('outcome',case when v_id is null then 'EXISTING' else 'CREATED' end,'candidate_id',v_id,'workspace_id',v_workspace,'canonical_url',v_url);
exception when no_data_found or too_many_rows then return jsonb_build_object('outcome','REJECTED','reason','group_not_connected');
end $$;

create or replace function public.social_mission_setup_targets_valid(_targets jsonb)
returns boolean language plpgsql immutable set search_path = pg_catalog as $$
declare k text; v jsonb; n numeric;
begin
  if _targets is null or jsonb_typeof(_targets) is distinct from 'object' or _targets='{}'::jsonb then return false; end if;
  for k,v in select key,value from jsonb_each(_targets) loop
    if k not in ('likes','replies','reposts','bookmarks') or jsonb_typeof(v) is distinct from 'number' then return false; end if;
    begin n := (v #>> '{}')::numeric; exception when others then return false; end;
    if n <> trunc(n) or n < 1 or n > 2147483647 then return false; end if;
  end loop;
  return true;
end $$;

create or replace function public.read_social_mission_candidate_setup(
  _candidate_id uuid, _group_connection_id uuid, _telegram_user_id bigint,
  _verified_chat_id bigint, _close_token text default null
) returns jsonb language plpgsql security definer set search_path = pg_catalog as $$
declare v public.social_mission_link_candidates%rowtype; v_uid uuid; v_targets jsonb; v_cleanup boolean:=false;
begin
  if _candidate_id is null or _group_connection_id is null or _telegram_user_id is null or _verified_chat_id is null or _verified_chat_id>=0 then return jsonb_build_object('outcome','REJECTED','reason','invalid_arguments'); end if;
  select * into v from public.social_mission_link_candidates where id=_candidate_id;
  if not found or v.group_connection_id is distinct from _group_connection_id or v.telegram_chat_id is distinct from _verified_chat_id then return jsonb_build_object('outcome','REJECTED','reason','candidate_unavailable'); end if;
  if not exists(select 1 from public.telegram_group_connections c where c.id=_group_connection_id and c.workspace_id=v.workspace_id and c.telegram_chat_id=_verified_chat_id and c.bot_is_admin is true and coalesce(c.metadata->>'bot_removed_at','')='') then return jsonb_build_object('outcome','REJECTED','reason','candidate_unavailable'); end if;
  select tc.user_id into strict v_uid from public.telegram_connections tc where tc.telegram_user_id=_telegram_user_id;
  if public.is_workspace_operator(v.workspace_id,v_uid) is not true then return jsonb_build_object('outcome','REJECTED','reason','candidate_unavailable'); end if;
  if v.setup_mission_id is null and (v.state<>'PENDING' or v.expires_at<=now()) then return jsonb_build_object('outcome','REJECTED','reason','candidate_unavailable'); end if;
  if _close_token ~ '^[A-Za-z0-9_-]{22,64}$' then
    select exists(select 1 from public.mission_control_launcher_bindings b where b.group_connection_id=_group_connection_id and b.telegram_chat_id=_verified_chat_id and b.close_token_hash=encode(extensions.digest(_close_token,'sha256'),'hex') and b.status in('confirmed','cleanup_queued') and b.expires_at>now()) into v_cleanup;
  end if;
  v_targets:=v.reviewed_targets;
  if v.setup_mission_id is not null then select coalesce(m.metadata->'effective_config'->'metric_targets','{}'::jsonb) into v_targets from public.social_missions m where m.id=v.setup_mission_id and m.workspace_id=v.workspace_id; end if;
  return jsonb_build_object('outcome',case when v.state='STARTED' then 'STARTED' when v.setup_mission_id is not null then 'STARTING' else 'READY' end,'workspace_id',v.workspace_id,'group_connection_id',v.group_connection_id,'canonical_url',v.canonical_url,'external_post_id',v.external_post_id,'author_handle',v.author_handle,'expires_at',v.expires_at,'reviewed_targets',coalesce(v_targets,'{}'::jsonb),'mission_id',v.setup_mission_id,'cleanup_confirmed',v_cleanup);
exception when no_data_found or too_many_rows then return jsonb_build_object('outcome','REJECTED','reason','candidate_unavailable');
end $$;

create or replace function public.save_social_mission_candidate_setup(
  _candidate_id uuid, _group_connection_id uuid, _telegram_user_id bigint,
  _verified_chat_id bigint, _request_id uuid, _targets jsonb
) returns jsonb language plpgsql security definer set search_path = pg_catalog as $$
declare v public.social_mission_link_candidates%rowtype; v_uid uuid;
begin
  if _candidate_id is null or _group_connection_id is null or _telegram_user_id is null or _verified_chat_id is null or _verified_chat_id>=0 or _request_id is null or public.social_mission_setup_targets_valid(_targets) is not true then return jsonb_build_object('outcome','REJECTED','reason','invalid_arguments'); end if;
  select * into v from public.social_mission_link_candidates where id=_candidate_id for update;
  if not found or v.group_connection_id is distinct from _group_connection_id or v.telegram_chat_id is distinct from _verified_chat_id or v.state<>'PENDING' or v.expires_at<=now() or v.setup_mission_id is not null then return jsonb_build_object('outcome','REJECTED','reason','candidate_unavailable'); end if;
  if not exists(select 1 from public.telegram_group_connections c where c.id=_group_connection_id and c.workspace_id=v.workspace_id and c.telegram_chat_id=_verified_chat_id and c.bot_is_admin is true and coalesce(c.metadata->>'bot_removed_at','')='') then return jsonb_build_object('outcome','REJECTED','reason','candidate_unavailable'); end if;
  select tc.user_id into strict v_uid from public.telegram_connections tc where tc.telegram_user_id=_telegram_user_id;
  if public.is_workspace_operator(v.workspace_id,v_uid) is not true then return jsonb_build_object('outcome','REJECTED','reason','candidate_unavailable'); end if;
  update public.social_mission_link_candidates set reviewed_targets=_targets where id=v.id;
  return jsonb_build_object('outcome','SAVED','reviewed_targets',_targets);
exception when no_data_found or too_many_rows then return jsonb_build_object('outcome','REJECTED','reason','candidate_unavailable');
end $$;

create or replace function public.start_social_mission_candidate_setup(
  _candidate_id uuid, _group_connection_id uuid, _telegram_user_id bigint,
  _verified_chat_id bigint, _request_id uuid, _targets jsonb
) returns jsonb language plpgsql security definer set search_path = pg_catalog as $$
declare v public.social_mission_link_candidates%rowtype; v_uid uuid; v_x text; v_handle text; v_post uuid; v_mission uuid; v_target uuid; v_delivery text; v_settings public.social_mission_settings%rowtype; v_config jsonb; v_access jsonb; v_winner_targets jsonb; v_winner_request uuid;
begin
  if _candidate_id is null or _group_connection_id is null or _telegram_user_id is null or _verified_chat_id is null or _verified_chat_id>=0 or _request_id is null or public.social_mission_setup_targets_valid(_targets) is not true then return jsonb_build_object('outcome','REJECTED','reason','invalid_arguments'); end if;
  select * into v from public.social_mission_link_candidates where id=_candidate_id for update;
  if not found or v.group_connection_id is distinct from _group_connection_id or v.telegram_chat_id is distinct from _verified_chat_id then return jsonb_build_object('outcome','REJECTED','reason','candidate_unavailable'); end if;
  if not exists(select 1 from public.telegram_group_connections c where c.id=_group_connection_id and c.workspace_id=v.workspace_id and c.telegram_chat_id=_verified_chat_id and c.bot_is_admin is true and coalesce(c.metadata->>'bot_removed_at','')='') then return jsonb_build_object('outcome','REJECTED','reason','candidate_unavailable'); end if;
  select tc.user_id into strict v_uid from public.telegram_connections tc where tc.telegram_user_id=_telegram_user_id;
  if public.is_workspace_operator(v.workspace_id,v_uid) is not true then return jsonb_build_object('outcome','REJECTED','reason','candidate_unavailable'); end if;
  if public.can_use_project_tools(v.workspace_id,v_uid) is not true then return jsonb_build_object('outcome','REJECTED','reason','project_identity_required'); end if;
  v_access:=public.evaluate_commercial_access(v.workspace_id,'x_missions',v_uid);
  if coalesce((v_access->>'allowed')::boolean,false) is not true or coalesce((v_access->>'would_block')::boolean,false) is true then return jsonb_build_object('outcome','REJECTED','reason','commercial_access_denied'); end if;
  if v.setup_mission_id is not null then
    select t.id,t.delivery_state,coalesce(m.metadata->'effective_config'->'metric_targets','{}'::jsonb),(m.metadata->>'setup_request_id')::uuid into v_target,v_delivery,v_winner_targets,v_winner_request from public.social_missions m join public.social_mission_targets t on t.mission_id=m.id and t.workspace_id=m.workspace_id where m.id=v.setup_mission_id and m.workspace_id=v.workspace_id and t.group_connection_id=_group_connection_id and t.telegram_chat_id=_verified_chat_id limit 1;
    return jsonb_build_object('outcome',case when v.state='STARTED' then 'FINALIZED' else 'EXISTING' end,'mission_id',v.setup_mission_id,'target_id',v_target,'delivery_state',v_delivery,'request_id',v_winner_request,'reviewed_targets',v_winner_targets,'auto_pin_mission',coalesce((select (m.metadata->'effective_config'->>'auto_pin_mission')::boolean from public.social_missions m where m.id=v.setup_mission_id),true),'prompt_message_id',v.prompt_message_id,'source_message_id',v.telegram_message_id,'source_deleted_at',v.source_deleted_at);
  end if;
  if v.state<>'PENDING' or v.expires_at<=now() then return jsonb_build_object('outcome','REJECTED','reason','candidate_unavailable'); end if;
  select x_url into v_x from public.project_profiles where workspace_id=v.workspace_id limit 1;
  v_handle:=lower((regexp_match(coalesce(v_x,''),'^https?://(?:www\.|mobile\.)?(?:x|twitter)\.com/@?([A-Za-z0-9_]{1,15})(?:[/?#].*)?$'))[1]);
  if v_handle is null or v_handle<>v.author_handle then return jsonb_build_object('outcome','REJECTED','reason','official_identity_changed'); end if;
  perform pg_advisory_xact_lock(hashtextextended(v.workspace_id::text||':'||v.external_post_id||':'||v.telegram_chat_id::text,0));
  insert into public.social_posts(workspace_id,platform,external_post_id,canonical_url,author_handle,content_text,metadata) values(v.workspace_id,'x',v.external_post_id,v.canonical_url,v.author_handle,null,jsonb_build_object('source','telegram_link_finder_setup')) on conflict(workspace_id,platform,external_post_id) do nothing;
  select id into v_post from public.social_posts where workspace_id=v.workspace_id and platform='x' and external_post_id=v.external_post_id;
  select m.id,t.id,t.delivery_state,coalesce(m.metadata->'effective_config'->'metric_targets','{}'::jsonb),(m.metadata->>'setup_request_id')::uuid into v_mission,v_target,v_delivery,v_winner_targets,v_winner_request from public.social_missions m join public.social_mission_targets t on t.mission_id=m.id and t.workspace_id=m.workspace_id where m.workspace_id=v.workspace_id and m.social_post_id=v_post and t.telegram_chat_id=v.telegram_chat_id and m.status in('DRAFT','LIVE') order by m.created_at desc limit 1;
  if v_mission is null then
    select * into v_settings from public.social_mission_settings where workspace_id=v.workspace_id;
    v_winner_targets:=_targets; v_winner_request:=_request_id;
    v_config:=public.social_mission_preset_config(coalesce(v_settings.default_preset,'STANDARD'))||jsonb_build_object('live_metrics_enabled',coalesce(v_settings.live_metrics_enabled,true),'auto_pin_mission',coalesce(v_settings.auto_pin_mission,true),'delete_command_after_send',true,'milestone_type','NONE','milestone_target',null,'goal_source','REVIEWED_TARGETS','metric_targets',v_winner_targets,'metric_targets_source','REVIEWED');
    insert into public.social_missions(workspace_id,social_post_id,status,started_at,created_by,metadata) values(v.workspace_id,v_post,'LIVE',now(),v_uid,jsonb_build_object('source','telegram_link_finder_setup','candidate_id',v.id,'telegram_chat_id',v.telegram_chat_id,'telegram_message_id',v.telegram_message_id,'telegram_user_id',_telegram_user_id,'setup_request_id',v_winner_request,'effective_config',v_config)) returning id into v_mission;
    insert into public.social_mission_targets(workspace_id,mission_id,group_connection_id,telegram_chat_id,delivery_state) values(v.workspace_id,v_mission,v.group_connection_id,v.telegram_chat_id,'PENDING') returning id,delivery_state into v_target,v_delivery;
  end if;
  if v_winner_request is null then return jsonb_build_object('outcome','REJECTED','reason','existing_mission_not_setup_managed'); end if;
  update public.social_mission_link_candidates set reviewed_targets=v_winner_targets,setup_request_id=v_winner_request,setup_started_at=coalesce(setup_started_at,now()),setup_mission_id=v_mission where id=v.id;
  return jsonb_build_object('outcome',case when v_winner_request=_request_id then 'CREATED' else 'EXISTING' end,'mission_id',v_mission,'target_id',v_target,'delivery_state',v_delivery,'request_id',v_winner_request,'reviewed_targets',v_winner_targets,'auto_pin_mission',coalesce((select (m.metadata->'effective_config'->>'auto_pin_mission')::boolean from public.social_missions m where m.id=v_mission),true),'prompt_message_id',v.prompt_message_id,'source_message_id',v.telegram_message_id,'source_deleted_at',v.source_deleted_at);
exception when no_data_found or too_many_rows then return jsonb_build_object('outcome','REJECTED','reason','candidate_unavailable');
end $$;

revoke all on function public.create_social_mission_setup_candidate(bigint,bigint,bigint,text,text,text,integer) from public,anon,authenticated;
revoke all on function public.social_mission_setup_targets_valid(jsonb) from public,anon,authenticated;
revoke all on function public.read_social_mission_candidate_setup(uuid,uuid,bigint,bigint,text) from public,anon,authenticated;
revoke all on function public.save_social_mission_candidate_setup(uuid,uuid,bigint,bigint,uuid,jsonb) from public,anon,authenticated;
revoke all on function public.start_social_mission_candidate_setup(uuid,uuid,bigint,bigint,uuid,jsonb) from public,anon,authenticated;
grant execute on function public.create_social_mission_setup_candidate(bigint,bigint,bigint,text,text,text,integer) to service_role,postgres;
grant execute on function public.social_mission_setup_targets_valid(jsonb) to service_role,postgres;
grant execute on function public.read_social_mission_candidate_setup(uuid,uuid,bigint,bigint,text) to service_role,postgres;
grant execute on function public.save_social_mission_candidate_setup(uuid,uuid,bigint,bigint,uuid,jsonb) to service_role,postgres;
grant execute on function public.start_social_mission_candidate_setup(uuid,uuid,bigint,bigint,uuid,jsonb) to service_role,postgres;
commit;
